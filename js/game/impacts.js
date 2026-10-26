/**
 * js/game/impacts.js
 *
 * What gunfire and explosions leave behind:
 * - bullet holes on the map (walls, floors, roofs), on car bodies (they ride along with the car)
 *   and on people (they follow the body part that was hit, through walking and ragdolls)
 * - blood: a spray of droplets from every wound, splatters painted on whatever wall, car or floor
 *   is close enough behind the person, and drops on the ground
 * - burnt-out cars: charred black frames with the glass and tyres gone, burning and then smoking
 * - scorch marks where explosives go off
 *
 * Decals are instanced (one draw call per kind) in ring buffers, so the oldest marks are recycled.
 * Hits against the map are raycast through per-tile BVHs (three-mesh-bvh, loaded on demand; plain
 * triangle raycasts if it is unavailable). The ground is also treated as the plane y = 0.
 */

import * as THREE from 'three';

let bvhLib = null;
import('three-mesh-bvh')
    .then((m) => { bvhLib = m; })
    .catch((err) => console.warn('[Impacts] three-mesh-bvh unavailable, using plain raycasts:', err));

const GROUND_Y = 0;
const PREBUILD_RADIUS = 120; // m around the player whose tile BVHs are built ahead of time
const _ray = new THREE.Ray();
const _localRay = new THREE.Ray();
const _inv = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qSpin = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _Z = new THREE.Vector3(0, 0, 1);
const _raycaster = new THREE.Raycaster();
const _hits = [];

// ------------------------------------------------------------------------------------------------
// Procedural textures
// ------------------------------------------------------------------------------------------------
function canvasTexture(size, draw) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    draw(ctx, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

// Seeded so every load draws the same splatters
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/** Plaster / brick / concrete: a dark core in a ring of chipped, dusty material. */
function holeTexture() {
    return canvasTexture(128, (ctx, n) => {
        const c = n / 2, r = rng(7);
        let g = ctx.createRadialGradient(c, c, 0, c, c, c * 0.95);
        g.addColorStop(0, 'rgba(70,66,60,0.55)');
        g.addColorStop(0.5, 'rgba(120,114,104,0.25)');
        g.addColorStop(1, 'rgba(120,114,104,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, n, n);
        // Chipped crater
        ctx.fillStyle = 'rgba(48,44,40,0.9)';
        ctx.beginPath();
        for (let i = 0; i <= 14; i++) {
            const a = (i / 14) * Math.PI * 2, rr = c * (0.24 + r() * 0.12);
            ctx.lineTo(c + Math.cos(a) * rr, c + Math.sin(a) * rr);
        }
        ctx.fill();
        g = ctx.createRadialGradient(c, c, 0, c, c, c * 0.16);
        g.addColorStop(0, 'rgba(5,5,5,1)');
        g.addColorStop(1, 'rgba(15,14,12,0.95)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(c, c, c * 0.16, 0, Math.PI * 2);
        ctx.fill();
        // Hairline cracks
        ctx.strokeStyle = 'rgba(30,28,26,0.6)';
        ctx.lineWidth = 1.2;
        for (let i = 0; i < 6; i++) {
            let a = r() * Math.PI * 2, rr = c * 0.25;
            ctx.beginPath();
            ctx.moveTo(c + Math.cos(a) * rr, c + Math.sin(a) * rr);
            while (rr < c * (0.55 + r() * 0.3)) {
                rr += 4 + r() * 5;
                a += (r() - 0.5) * 0.5;
                ctx.lineTo(c + Math.cos(a) * rr, c + Math.sin(a) * rr);
            }
            ctx.stroke();
        }
    });
}

/** Sheet metal: a punched hole with a ring of bare, scratched steel where the paint flaked off. */
function metalHoleTexture() {
    return canvasTexture(128, (ctx, n) => {
        const c = n / 2;
        let g = ctx.createRadialGradient(c, c, c * 0.18, c, c, c * 0.5);
        g.addColorStop(0, 'rgba(205,208,212,1)');
        g.addColorStop(0.55, 'rgba(150,152,156,0.85)');
        g.addColorStop(1, 'rgba(150,152,156,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(c, c, c * 0.5, 0, Math.PI * 2);
        ctx.fill();
        // Petal-torn edge
        ctx.fillStyle = 'rgba(40,40,42,1)';
        ctx.beginPath();
        for (let i = 0; i <= 10; i++) {
            const a = (i / 10) * Math.PI * 2, rr = c * (i % 2 ? 0.2 : 0.27);
            ctx.lineTo(c + Math.cos(a) * rr, c + Math.sin(a) * rr);
        }
        ctx.fill();
        g = ctx.createRadialGradient(c, c, 0, c, c, c * 0.17);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(8,8,8,1)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(c, c, c * 0.17, 0, Math.PI * 2);
        ctx.fill();
    });
}

/** Entry wound on skin or clothes: dark hole, wet red ring. */
function woundTexture() {
    return canvasTexture(64, (ctx, n) => {
        const c = n / 2;
        const g = ctx.createRadialGradient(c, c, 0, c, c, c);
        g.addColorStop(0, 'rgba(20,0,0,1)');
        g.addColorStop(0.25, 'rgba(60,2,2,1)');
        g.addColorStop(0.55, 'rgba(120,8,8,0.9)');
        g.addColorStop(1, 'rgba(110,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, n, n);
        ctx.fillStyle = 'rgba(100,4,4,0.9)';
        ctx.fillRect(c - 3, c, 6, c * 0.85); // a run of blood down from it
    });
}

/** A blood splatter: heavy mass, spatter droplets, a few runs dripping down (+V of the decal). */
function bloodTexture(seed) {
    return canvasTexture(256, (ctx, n) => {
        const r = rng(seed), c = n / 2;
        const shades = ['#5c0000', '#7a0505', '#8f0a0a', '#450000'];
        for (let i = 0; i < 26; i++) {
            const a = r() * Math.PI * 2, d = Math.pow(r(), 1.6) * c * 0.38;
            ctx.fillStyle = shades[i % shades.length];
            ctx.beginPath();
            ctx.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, 8 + r() * 26, 0, Math.PI * 2);
            ctx.fill();
        }
        // Spatter flung outwards, elongated along its direction of travel
        for (let i = 0; i < 90; i++) {
            const a = r() * Math.PI * 2, d = c * (0.3 + r() * 0.62), rad = 1 + r() * 5;
            ctx.save();
            ctx.translate(c + Math.cos(a) * d, c + Math.sin(a) * d);
            ctx.rotate(a);
            ctx.fillStyle = shades[(i + 1) % shades.length];
            ctx.beginPath();
            ctx.ellipse(0, 0, rad * (1 + r() * 1.8), rad, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        // Runs (canvas y grows downwards = towards -V, which is down on a wall)
        for (let i = 0; i < 5; i++) {
            const x = c + (r() - 0.5) * c * 0.6, y = c + (r() - 0.2) * c * 0.3;
            const len = c * (0.25 + r() * 0.5), w = 2 + r() * 3;
            ctx.fillStyle = '#560000';
            ctx.fillRect(x - w / 2, y, w, len);
            ctx.beginPath();
            ctx.arc(x, y + len, w * 0.9, 0, Math.PI * 2);
            ctx.fill();
        }
    });
}

/** Soot burnt into the ground or a wall around a blast. */
function scorchTexture() {
    return canvasTexture(256, (ctx, n) => {
        const c = n / 2, r = rng(99);
        const g = ctx.createRadialGradient(c, c, 0, c, c, c);
        g.addColorStop(0, 'rgba(8,7,6,0.95)');
        g.addColorStop(0.45, 'rgba(15,13,11,0.8)');
        g.addColorStop(1, 'rgba(20,18,16,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, n, n);
        ctx.strokeStyle = 'rgba(10,9,8,0.55)';
        for (let i = 0; i < 40; i++) {
            const a = r() * Math.PI * 2;
            ctx.lineWidth = 1 + r() * 4;
            ctx.beginPath();
            ctx.moveTo(c + Math.cos(a) * c * 0.3, c + Math.sin(a) * c * 0.3);
            ctx.lineTo(c + Math.cos(a) * c * (0.6 + r() * 0.38), c + Math.sin(a) * c * (0.6 + r() * 0.38));
            ctx.stroke();
        }
    });
}

function softDotTexture() {
    return canvasTexture(64, (ctx, n) => {
        const c = n / 2;
        const g = ctx.createRadialGradient(c, c, 0, c, c, c);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, n, n);
    });
}

// ------------------------------------------------------------------------------------------------
// Instanced decal ring buffer
// ------------------------------------------------------------------------------------------------
/**
 * One kind of mark. A slot is either fixed in the world or anchored to an Object3D (a car part, a
 * person's joint) by its offset from the anchor, re-applied every frame.
 */
class DecalLayer {
    constructor(scene, material, capacity) {
        this.capacity = capacity;
        this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, capacity);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.frustumCulled = false; // instances span the whole map
        this.mesh.count = 0;
        this.mesh.renderOrder = 2;
        this.mesh.userData.isImpactDecal = true;
        scene.add(this.mesh);
        this.slots = new Array(capacity).fill(null);
        this.next = 0;
        this.anchored = 0;
    }

    add(world, anchor = null, owner = null) {
        const i = this.next;
        this.next = (this.next + 1) % this.capacity;
        if (this.mesh.count < this.capacity) this.mesh.count++;
        const old = this.slots[i];
        if (old && old.anchor) this.anchored--;
        if (anchor) {
            const local = new THREE.Matrix4().copy(anchor.matrixWorld).invert().multiply(world);
            this.slots[i] = { anchor, local, owner };
            this.anchored++;
        } else {
            this.slots[i] = null;
        }
        this.mesh.setMatrixAt(i, world);
        this.mesh.instanceMatrix.needsUpdate = true;
        return i;
    }

    /** Re-places anchored marks on their (already updated) anchors. */
    sync() {
        if (this.anchored === 0) return;
        for (let i = 0; i < this.capacity; i++) {
            const s = this.slots[i];
            if (!s) continue;
            _m.multiplyMatrices(s.anchor.matrixWorld, s.local);
            this.mesh.setMatrixAt(i, _m);
        }
        this.mesh.instanceMatrix.needsUpdate = true;
    }

    forEachOwner(fn) {
        for (let i = 0; i < this.capacity; i++) if (this.slots[i] && this.slots[i].owner) fn(this.slots[i].owner);
    }

    removeOwner(owner) {
        let changed = false;
        for (let i = 0; i < this.capacity; i++) {
            const s = this.slots[i];
            if (s && s.owner === owner) {
                this.slots[i] = null;
                this.anchored--;
                this.mesh.setMatrixAt(i, _zero);
                changed = true;
            }
        }
        if (changed) this.mesh.instanceMatrix.needsUpdate = true;
    }
}

// ------------------------------------------------------------------------------------------------
// Particles (blood droplets, dust, sparks, fire, smoke)
// ------------------------------------------------------------------------------------------------
const PARTICLE_VERT = `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
    vAlpha = aAlpha;
    vColor = aColor;
}`;
const PARTICLE_FRAG = `
uniform sampler2D map;
varying float vAlpha;
varying vec3 vColor;
void main() {
    float a = texture2D(map, gl_PointCoord).a * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
    #include <colorspace_fragment>
}`;

class ParticlePool {
    /** @param {object} o { capacity, additive, gravity, drag, fade, grow } */
    constructor(scene, map, o) {
        this.capacity = o.capacity;
        this.gravity = o.gravity || 0;
        this.drag = o.drag || 0;
        this.grow = o.grow || 0;
        this.onLand = null;
        const n = o.capacity;
        this.pos = new Float32Array(n * 3);
        this.size = new Float32Array(n);
        this.alpha = new Float32Array(n);
        this.color = new Float32Array(n * 3);
        this.vel = new Float32Array(n * 3);
        this.life = new Float32Array(n);
        this.maxLife = new Float32Array(n);
        this.alpha0 = new Float32Array(n);
        this.next = 0;
        this.live = 0;
        for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -1e5;
        const geo = new THREE.BufferGeometry();
        this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
        this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
        this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
        this.colorAttr = new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('position', this.posAttr);
        geo.setAttribute('aSize', this.sizeAttr);
        geo.setAttribute('aAlpha', this.alphaAttr);
        geo.setAttribute('aColor', this.colorAttr);
        const material = new THREE.ShaderMaterial({
            uniforms: { map: { value: map }, uScale: { value: 400 } },
            vertexShader: PARTICLE_VERT,
            fragmentShader: PARTICLE_FRAG,
            transparent: true,
            depthWrite: false,
            blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending
        });
        this.points = new THREE.Points(geo, material);
        this.points.frustumCulled = false;
        this.points.renderOrder = 3;
        const size = new THREE.Vector2();
        this.points.onBeforeRender = (renderer, scene2, camera) => {
            renderer.getDrawingBufferSize(size);
            material.uniforms.uScale.value = size.y * 0.5 * (camera.projectionMatrix.elements[5] || 1);
        };
        scene.add(this.points);
    }

    emit(x, y, z, vx, vy, vz, size, life, alpha, color) {
        const i = this.next;
        this.next = (this.next + 1) % this.capacity;
        if (this.life[i] <= 0) this.live++;
        const k = i * 3;
        this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
        this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
        this.color[k] = color.r; this.color[k + 1] = color.g; this.color[k + 2] = color.b;
        this.size[i] = size;
        this.life[i] = this.maxLife[i] = life;
        this.alpha[i] = this.alpha0[i] = alpha;
    }

    update(dt) {
        if (this.live === 0) return;
        const drag = Math.max(0, 1 - this.drag * dt);
        for (let i = 0; i < this.capacity; i++) {
            if (this.life[i] <= 0) continue;
            const k = i * 3;
            this.life[i] -= dt;
            if (this.life[i] <= 0) {
                this.live--;
                this.pos[k + 1] = -1e5;
                this.alpha[i] = 0;
                continue;
            }
            this.vel[k + 1] -= this.gravity * dt;
            this.vel[k] *= drag; this.vel[k + 1] *= drag; this.vel[k + 2] *= drag;
            this.pos[k] += this.vel[k] * dt;
            this.pos[k + 1] += this.vel[k + 1] * dt;
            this.pos[k + 2] += this.vel[k + 2] * dt;
            if (this.gravity > 0 && this.pos[k + 1] < GROUND_Y + 0.02) {
                // Landed
                if (this.onLand) this.onLand(this.pos[k], this.pos[k + 2], this.size[i]);
                this.life[i] = 0;
                this.live--;
                this.pos[k + 1] = -1e5;
                this.alpha[i] = 0;
                continue;
            }
            const t = this.life[i] / this.maxLife[i];
            this.alpha[i] = this.alpha0[i] * Math.min(1, t * 2.5);
            if (this.grow) this.size[i] += this.grow * dt;
        }
        this.posAttr.needsUpdate = true;
        this.alphaAttr.needsUpdate = true;
        this.colorAttr.needsUpdate = true;
        this.sizeAttr.needsUpdate = true;
    }
}

// ------------------------------------------------------------------------------------------------
// Burnt-out cars
// ------------------------------------------------------------------------------------------------
let _charMats = null;
function charMaterials() {
    if (_charMats) return _charMats;
    _charMats = {
        shell: new THREE.MeshStandardMaterial({ color: 0x1b1916, roughness: 0.96, metalness: 0.3 }),
        soot: new THREE.MeshStandardMaterial({ color: 0x0d0c0b, roughness: 1.0, metalness: 0.1 }),
        rust: new THREE.MeshStandardMaterial({ color: 0x2e1d14, roughness: 0.95, metalness: 0.25 }),
        rim: new THREE.MeshStandardMaterial({ color: 0x242220, roughness: 0.8, metalness: 0.6 })
    };
    return _charMats;
}

function isGlass(obj) {
    const n = obj.name || '';
    if (/glass|windshield|shard/i.test(n)) return true;
    const m = obj.material;
    return !!(m && !Array.isArray(m) && m.transparent && m.opacity < 0.95);
}

/**
 * Turns a car's mesh into a burnt-out wreck: every panel charred black (soot and rust patches),
 * glass blown out, tyres burnt off and the shell sunk onto its rims.
 */
export function charVehicleMesh(root, wheelRadius = 0.33) {
    if (!root || root.userData.charred) return;
    root.userData.charred = true;
    const M = charMaterials();
    const hide = [];
    root.traverse((o) => {
        if (o.isLight) { o.intensity = 0; return; }
        if (!o.isMesh && !o.isSprite) return;
        if (o.isSprite || isGlass(o)) { hide.push(o); return; }
        const n = o.name || '';
        if (n.startsWith('wheel_tire_')) { hide.push(o); return; }
        if (n.startsWith('wheel_hubcap_')) o.material = M.rim;
        else if (n === 'sedan_body' || n === 'driver_door_panel' || n === 'cabin_roof') o.material = M.shell;
        else o.material = (n.length + o.id) % 3 === 0 ? M.rust : M.soot;
        o.castShadow = true;
    });
    for (const o of hide) o.visible = false;
    // Sits on its rims: drop everything by the tyre wall
    const drop = wheelRadius * 0.35;
    for (const child of root.children) child.position.y -= drop;
}

// ------------------------------------------------------------------------------------------------
// The system
// ------------------------------------------------------------------------------------------------
const BLOOD_COLORS = [new THREE.Color(0x6a0000), new THREE.Color(0x8a0505), new THREE.Color(0x4a0000)];
const DUST_COLOR = new THREE.Color(0x8d877c);
const SPARK_COLOR = new THREE.Color(0xffd27a);
const _tmpColor = new THREE.Color();

export class ImpactSystem {
    constructor(scene) {
        this.scene = scene;
        this.tiles = [];
        this._bvhBuilt = 0;
        this._bvhScheduled = false;
        this._eye = new THREE.Vector3();
        this._tileBoxes = [];
        /** Optional: (owner) => boolean, false once a person or car has left the game. */
        this.ownerAlive = null;
        this._sweep = 0;
        this._roots = new Map(); // anchored owner -> { root, x, z }
        this.wrecks = [];
        this.stats = { holes: 0, wounds: 0, bloodSplats: 0, wrecks: 0 };

        const lit = (map, extra = {}) => new THREE.MeshLambertMaterial({
            map, transparent: true, depthWrite: false,
            polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, ...extra
        });
        const wet = (map) => new THREE.MeshStandardMaterial({
            map, transparent: true, depthWrite: false, roughness: 0.3, metalness: 0.0,
            polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
        });
        this.layers = {
            hole: new DecalLayer(scene, lit(holeTexture()), 500),
            metal: new DecalLayer(scene, lit(metalHoleTexture()), 300),
            wound: new DecalLayer(scene, wet(woundTexture()), 160),
            blood: [101, 202, 303].map((seed) => new DecalLayer(scene, wet(bloodTexture(seed)), 90)),
            scorch: new DecalLayer(scene, lit(scorchTexture()), 40)
        };

        const dot = softDotTexture();
        this.debris = new ParticlePool(scene, dot, { capacity: 900, gravity: 9.8, drag: 0.6 });
        this.debris.onLand = (x, z, size) => {
            // Some of the blood reaching the ground leaves drops
            if (size > 0.035 && size < 0.2 && Math.random() < 0.18) {
                this._placeBlood(new THREE.Vector3(x, GROUND_Y, z), new THREE.Vector3(0, 1, 0), 0.08 + Math.random() * 0.12, null);
            }
        };
        this.fire = new ParticlePool(scene, dot, { capacity: 500, additive: true, gravity: -1.5, drag: 0.8 });
        this.smoke = new ParticlePool(scene, dot, { capacity: 600, gravity: -0.6, drag: 0.35, grow: 1.4 });
    }

    // --------------------------------------------------------------------------------------------
    // World geometry
    // --------------------------------------------------------------------------------------------
    /**
     * The map tiles bullets can hit. BVHs are built on first hit, and ahead of time (only in real
     * idle time) for the tiles around the player, so shots rarely have to wait for one.
     */
    setWorldMeshes(meshes, near = null) {
        this.tiles = meshes.filter((m) => m && m.isMesh && m.geometry && m.geometry.attributes.position);
        this._tileBoxes = this.tiles.map((t) => {
            if (!t.geometry.boundingBox) t.geometry.computeBoundingBox();
            t.updateMatrixWorld(true);
            return t.geometry.boundingBox.clone().applyMatrix4(t.matrixWorld);
        });
        this._bvhBuilt = this.tiles.filter((t) => t.geometry.boundsTree).length;
        if (near) this._eye.copy(near);
        if (!this._bvhScheduled) this._scheduleBvh();
    }

    _scheduleBvh() {
        this._bvhScheduled = true;
        const idle = typeof requestIdleCallback === 'function'
            ? (fn) => requestIdleCallback(fn)
            : (fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 200);
        const work = (deadline) => {
            if (bvhLib) {
                while (deadline.timeRemaining() > 6) {
                    const tile = this._nextNearbyTile();
                    if (!tile) break;
                    this._ensureBvh(tile);
                }
            }
            // Nothing near left to build: look again in a second (the player may have moved on)
            setTimeout(() => idle(work), 1000);
        };
        idle(work);
    }

    /** Nearest tile within PREBUILD_RADIUS of the player that has no BVH yet. */
    _nextNearbyTile() {
        let best = null, bestD = PREBUILD_RADIUS;
        for (let i = 0; i < this.tiles.length; i++) {
            if (this.tiles[i].geometry.boundsTree) continue;
            const d = this._tileBoxes[i].distanceToPoint(this._eye);
            if (d < bestD) { bestD = d; best = this.tiles[i]; }
        }
        return best;
    }

    _ensureBvh(tile) {
        const g = tile.geometry;
        if (g.boundsTree || !bvhLib) return !!g.boundsTree;
        try {
            g.boundsTree = new bvhLib.MeshBVH(g, { maxLeafTris: 10 });
            this._bvhBuilt++;
        } catch (err) {
            console.warn('[Impacts] BVH build failed for', tile.name, err);
            g.boundsTree = null;
        }
        return !!g.boundsTree;
    }

    /**
     * First surface of the map (or the ground) along a ray.
     * @returns {{point, normal, distance, object, ground?}|null}
     */
    raycastWorld(origin, dir, far, noBuild = false) {
        let best = null;
        _ray.set(origin, dir);
        for (let i = 0; i < this.tiles.length; i++) {
            const box = this._tileBoxes[i];
            // (intersectBox gives the exit point when the ray starts inside the box, so measure the
            // gap to the box itself: tiles are big and shots usually start inside one)
            if (!_ray.intersectsBox(box)) continue;
            if (box.distanceToPoint(origin) > (best ? best.distance : far)) continue;
            const tile = this.tiles[i];
            // Per-frame callers (rockets in flight) must not stall on building a big tile's BVH
            if (noBuild && !tile.geometry.boundsTree) continue;
            let hit = null;
            if (this._ensureBvh(tile)) {
                _inv.copy(tile.matrixWorld).invert();
                _localRay.copy(_ray).applyMatrix4(_inv);
                const h = tile.geometry.boundsTree.raycastFirst(_localRay, THREE.DoubleSide);
                if (h) {
                    const point = h.point.clone().applyMatrix4(tile.matrixWorld);
                    const normal = h.face.normal.clone().transformDirection(tile.matrixWorld);
                    hit = { point, normal, distance: point.distanceTo(origin), object: tile };
                }
            } else {
                _raycaster.set(origin, dir);
                _raycaster.far = best ? best.distance : far;
                _hits.length = 0;
                tile.raycast(_raycaster, _hits);
                let h0 = null;
                for (const h of _hits) if (!h0 || h.distance < h0.distance) h0 = h;
                if (h0) {
                    const normal = h0.face.normal.clone().transformDirection(tile.matrixWorld);
                    hit = { point: h0.point.clone(), normal, distance: h0.distance, object: tile };
                }
            }
            if (hit && hit.distance <= far && (!best || hit.distance < best.distance)) best = hit;
        }
        if (dir.y < -1e-4) {
            const t = (GROUND_Y - origin.y) / dir.y;
            if (t > 0 && t <= far && (!best || t < best.distance)) {
                best = {
                    point: origin.clone().addScaledVector(dir, t),
                    normal: new THREE.Vector3(0, 1, 0),
                    distance: t,
                    object: null,
                    ground: true
                };
            }
        }
        if (best && best.normal.dot(dir) > 0) best.normal.negate();
        return best;
    }

    /**
     * First painted / metal surface of a car along a ray (glass and the people inside are left to
     * the window code). Cars drawn by the instanced fleet are tested through their own mesh.
     * @returns {{vehicle, point, normal, distance, object}|null}
     */
    raycastVehicles(vehicles, origin, dir, far) {
        let best = null;
        for (let i = 0; i < vehicles.length; i++) {
            const v = vehicles[i];
            if (!v || !v.mesh || v.isPlane || !v.position) continue;
            _p.set(v.position.x, (v.position.y || 0) + 0.8, v.position.z).sub(origin);
            const t = _p.dot(dir);
            const limit = best ? best.distance : far;
            if (t < -3.5 || t > limit + 3.5) continue;
            if (_p.lengthSq() - t * t > 3.4 * 3.4) continue;
            v.mesh.updateMatrixWorld(true);
            _raycaster.set(origin, dir);
            _raycaster.far = limit;
            _hits.length = 0;
            _raycaster.intersectObject(v.mesh, true, _hits);
            for (const h of _hits) {
                const o = h.object;
                if (!o.visible || isGlass(o) || !h.face || o.userData.isImpactDecal) continue;
                if (isDriverPart(o)) continue;
                const normal = h.face.normal.clone().transformDirection(o.matrixWorld);
                if (normal.dot(dir) > 0) normal.negate();
                best = { vehicle: v, point: h.point.clone(), normal, distance: h.distance, object: o };
                break;
            }
        }
        return best;
    }

    // --------------------------------------------------------------------------------------------
    // Marks
    // --------------------------------------------------------------------------------------------
    _matrix(point, normal, size, aspect = 1, spin = Math.random() * Math.PI * 2, lift = 0.006) {
        _q.setFromUnitVectors(_Z, normal);
        _qSpin.setFromAxisAngle(_Z, spin);
        _q.multiply(_qSpin);
        _p.copy(point).addScaledVector(normal, lift);
        _s.set(size * aspect, size, 1);
        return new THREE.Matrix4().compose(_p, _q, _s);
    }

    /** Spin that keeps a decal's +V pointing up the surface (blood runs downwards). */
    _uprightSpin(normal) {
        _q.setFromUnitVectors(_Z, normal);
        const up = _v.set(0, 1, 0).applyQuaternion(_q); // where +V points with no spin
        const worldUp = new THREE.Vector3(0, 1, 0).projectOnPlane(normal);
        if (worldUp.lengthSq() < 1e-4) return Math.random() * Math.PI * 2;
        worldUp.normalize();
        const cross = new THREE.Vector3().crossVectors(up, worldUp).dot(normal);
        return Math.atan2(cross, up.dot(worldUp)) + (Math.random() - 0.5) * 0.4;
    }

    _track(owner, root) {
        if (!owner || !root) return;
        if (!this._roots.has(owner)) {
            this._roots.set(owner, { root, x: root.position.x, z: root.position.z });
        }
    }

    /**
     * A bullet hole where a shot hit the map or a car.
     * @param {object} hit from raycastWorld / raycastVehicles
     * @param {THREE.Vector3} dir shot direction (dust or sparks bounce back against it)
     */
    addBulletHole(hit, dir = null) {
        const onCar = !!hit.vehicle;
        const size = onCar ? 0.075 + Math.random() * 0.02 : 0.11 + Math.random() * 0.05;
        const world = this._matrix(hit.point, hit.normal, size, 1, undefined, onCar ? 0.003 : 0.006);
        if (onCar) {
            this._track(hit.vehicle, hit.vehicle.mesh);
            this.layers.metal.add(world, hit.object, hit.vehicle);
        } else {
            this.layers.hole.add(world);
        }
        this.stats.holes++;
        // Puff of dust or a shower of sparks
        const n = hit.normal;
        const count = onCar ? 7 : 9;
        for (let i = 0; i < count; i++) {
            const sp = onCar ? 3 + Math.random() * 3 : 1 + Math.random() * 2;
            _v.set(n.x + (Math.random() - 0.5) * 1.2, n.y + (Math.random() - 0.3) * 1.2, n.z + (Math.random() - 0.5) * 1.2).normalize();
            if (dir && !onCar) _v.addScaledVector(dir, -0.3).normalize();
            this.debris.emit(hit.point.x, hit.point.y, hit.point.z, _v.x * sp, _v.y * sp, _v.z * sp,
                onCar ? 0.025 : 0.05 + Math.random() * 0.05, onCar ? 0.25 + Math.random() * 0.2 : 0.4 + Math.random() * 0.4,
                onCar ? 1 : 0.7, onCar ? SPARK_COLOR : DUST_COLOR);
        }
        if (!onCar) {
            for (let i = 0; i < 2; i++) {
                this.smoke.emit(hit.point.x + n.x * 0.1, hit.point.y + n.y * 0.1, hit.point.z + n.z * 0.1,
                    n.x * 0.6 + (Math.random() - 0.5) * 0.3, n.y * 0.6 + 0.2, n.z * 0.6 + (Math.random() - 0.5) * 0.3,
                    0.25, 0.9, 0.35, DUST_COLOR);
            }
        }
    }

    /**
     * Entry wound on a person, anchored to whichever of their joints is closest to the hit.
     * @param {object} ped pedestrian or police officer (jointed rig on ped.mesh.userData.rig)
     */
    addWound(ped, point, dir) {
        const rig = ped && ped.mesh && ped.mesh.userData.rig;
        if (!rig) return;
        ped.mesh.updateMatrixWorld(true);
        const joints = [rig.torso, rig.neck, rig.hips, rig.shoulderL, rig.shoulderR, rig.elbowL, rig.elbowR, rig.legL, rig.legR, rig.kneeL, rig.kneeR];
        let best = null, bestD = Infinity;
        for (const j of joints) {
            if (!j) continue;
            j.getWorldPosition(_v);
            // Joints sit at the top of their limb; compare against the limb's middle
            const d = (_v.x - point.x) ** 2 + ((_v.y - (j === rig.neck ? -0.12 : 0.22)) - point.y) ** 2 + (_v.z - point.z) ** 2;
            if (d < bestD) { bestD = d; best = j; }
        }
        if (!best) return;
        const normal = _p.copy(dir).negate();
        normal.y *= 0.3;
        normal.normalize();
        const world = this._matrix(point, normal.clone(), 0.07 + Math.random() * 0.03, 1, Math.PI + (Math.random() - 0.5) * 0.4, 0.004);
        this._track(ped, ped.mesh);
        this.layers.wound.add(world, best, ped);
        this.stats.wounds++;
    }

    _placeBlood(point, normal, size, hit) {
        const layer = this.layers.blood[(Math.random() * 3) | 0];
        const spin = Math.abs(normal.y) > 0.9 ? Math.random() * Math.PI * 2 : this._uprightSpin(normal);
        const world = this._matrix(point, normal, size, 0.85 + Math.random() * 0.4, spin, 0.007);
        if (hit && hit.vehicle) {
            this._track(hit.vehicle, hit.vehicle.mesh);
            layer.add(world, hit.object, hit.vehicle);
        } else {
            layer.add(world);
        }
        this.stats.bloodSplats++;
    }

    /**
     * Someone is shot: a spray of droplets out of the wound, splatters painted on any wall, car or
     * floor close enough behind them, and drops below.
     * @param {THREE.Vector3} point where the bullet went in
     * @param {THREE.Vector3} dir which way it was travelling
     * @param {object} [o] { amount (1 = one pistol round), vehicles (cars blood can land on) }
     */
    bleed(point, dir, o = {}) {
        const amount = o.amount || 1;
        const vehicles = o.vehicles || [];
        const exit = point.clone().addScaledVector(dir, 0.3);

        // Mist and droplets: most go out the back, some splash back towards the shooter
        const n = Math.round(22 * Math.min(3, amount));
        for (let i = 0; i < n; i++) {
            const back = i < n * 0.2;
            const sp = back ? 0.8 + Math.random() * 1.5 : 2 + Math.random() * 5;
            const sx = (back ? -dir.x : dir.x) + (Math.random() - 0.5) * 0.9;
            const sy = (back ? -dir.y : dir.y) + (Math.random() - 0.2) * 0.8;
            const sz = (back ? -dir.z : dir.z) + (Math.random() - 0.5) * 0.9;
            const c = BLOOD_COLORS[i % BLOOD_COLORS.length];
            this.debris.emit(point.x, point.y, point.z, sx * sp, sy * sp, sz * sp,
                0.03 + Math.random() * 0.07, 0.7 + Math.random() * 0.6, 0.95, c);
        }
        this.smoke.emit(point.x, point.y, point.z, dir.x * 0.8, dir.y * 0.8 + 0.1, dir.z * 0.8, 0.25, 0.35, 0.5, _tmpColor.set(0x7a0000));

        // Splatters on what is behind them: the bullet's line, plus a couple of rays fanned out
        const reach = 4.5;
        let painted = 0;
        const rays = 1 + Math.min(3, Math.round(amount * 1.5));
        for (let i = 0; i < rays; i++) {
            const d = dir.clone();
            if (i > 0) {
                d.x += (Math.random() - 0.5) * 0.5;
                d.y += (Math.random() - 0.5) * 0.35 - 0.05;
                d.z += (Math.random() - 0.5) * 0.5;
                d.normalize();
            }
            const wall = this.raycastWorld(exit, d, reach);
            const car = this.raycastVehicles(vehicles, exit, d, wall ? wall.distance : reach);
            const hit = car || wall;
            if (!hit) continue;
            // Closer walls get the heavier, tighter splatter
            const k = 1 - hit.distance / reach;
            const size = (i === 0 ? 0.55 : 0.3) * (0.6 + 0.8 * k) * Math.min(1.8, 0.7 + amount * 0.4) + Math.random() * 0.15;
            this._placeBlood(hit.point, hit.normal, size, hit);
            painted++;
        }

        // Drops on the floor below and just behind
        const fall = this.raycastWorld(
            new THREE.Vector3(exit.x + dir.x * (0.3 + Math.random() * 0.9), point.y + 0.2, exit.z + dir.z * (0.3 + Math.random() * 0.9)),
            new THREE.Vector3(0, -1, 0), 3
        );
        if (fall) this._placeBlood(fall.point, fall.normal, 0.25 + Math.random() * 0.2 * amount, null);
        return painted;
    }

    /** Soot left by a blast on the ground or on whatever it went off against. */
    addScorch(point, normal = null, radius = 3) {
        const n = normal || new THREE.Vector3(0, 1, 0);
        this.layers.scorch.add(this._matrix(point, n, radius * 1.4, 1, undefined, 0.012));
    }

    // --------------------------------------------------------------------------------------------
    // Burning wrecks
    // --------------------------------------------------------------------------------------------
    /** Chars a car's mesh and keeps it burning, then smouldering, for a while. */
    wreck(vehicle) {
        if (!vehicle || !vehicle.mesh) return;
        charVehicleMesh(vehicle.mesh, vehicle.wheelRadius || 0.33);
        // The paint holes and blood stay where they are, now on black metal
        this.wrecks.push({ vehicle, age: 0, burn: 18 + Math.random() * 12, smoulder: 70, acc: 0 });
        if (this.wrecks.length > 12) this.wrecks.shift();
        this.stats.wrecks++;
    }

    _updateWrecks(dt, eye) {
        for (let i = this.wrecks.length - 1; i >= 0; i--) {
            const w = this.wrecks[i];
            w.age += dt;
            if (w.age > w.smoulder) { this.wrecks.splice(i, 1); continue; }
            const v = w.vehicle;
            if (!v.position) continue;
            if (eye && Math.hypot(eye.x - v.position.x, eye.z - v.position.z) > 260) continue;
            const burning = w.age < w.burn;
            const heat = burning ? Math.min(1, 1.3 - w.age / w.burn) : 0;
            const yaw = v.yaw || 0, cy = Math.cos(yaw), sy = Math.sin(yaw);
            w.acc += dt * (burning ? 45 : 10 * (1 - w.age / w.smoulder));
            while (w.acc >= 1) {
                w.acc -= 1;
                // Somewhere over the shell (car space: x across, z along)
                const lx = (Math.random() - 0.5) * 1.5, lz = (Math.random() - 0.5) * 3.4;
                const x = v.position.x + lx * cy + lz * sy;
                const z = v.position.z - lx * sy + lz * cy;
                const y = (v.position.y || 0) + 0.6 + Math.random() * 0.6;
                if (burning && Math.random() < 0.75) {
                    _tmpColor.setRGB(1, 0.35 + Math.random() * 0.35, 0.08);
                    this.fire.emit(x, y, z, (Math.random() - 0.5) * 0.6, 1.2 + Math.random() * 1.8 * heat, (Math.random() - 0.5) * 0.6,
                        0.6 + Math.random() * 0.9 * heat, 0.45 + Math.random() * 0.5, 0.75, _tmpColor);
                } else {
                    const g = 0.08 + Math.random() * 0.08;
                    _tmpColor.setRGB(g, g, g);
                    this.smoke.emit(x, y + 0.6, z, (Math.random() - 0.5) * 0.5, 1.5 + Math.random(), (Math.random() - 0.5) * 0.5,
                        1.0 + Math.random(), 3 + Math.random() * 3, burning ? 0.55 : 0.4, _tmpColor);
                }
            }
        }
    }

    // --------------------------------------------------------------------------------------------
    // Per frame
    // --------------------------------------------------------------------------------------------
    /**
     * Moves anchored marks with their cars and people, steps particles and wreck fires.
     * Call right before rendering so marks sit exactly on this frame's poses.
     */
    update(dt, eye = null) {
        if (eye) this._eye.copy(eye);
        // Drop the marks of people and cars that left the game or were recycled somewhere else
        this._sweep -= dt;
        const sweeping = this._sweep <= 0;
        if (sweeping) this._sweep = 1;
        for (const [owner, r] of this._roots) {
            const moved = Math.hypot(r.root.position.x - r.x, r.root.position.z - r.z);
            const gone = (sweeping && this.ownerAlive && !this.ownerAlive(owner)) || moved > 25;
            if (gone) {
                this._removeOwner(owner);
                continue;
            }
            r.x = r.root.position.x;
            r.z = r.root.position.z;
            if (owner.mesh === r.root && owner.position && !owner.mesh.parent) {
                // Fleet-drawn car: its own mesh isn't in the scene, so place it ourselves
                r.root.position.set(owner.position.x, owner.position.y || 0, owner.position.z);
                r.root.rotation.y = owner.yaw || 0;
            }
            r.root.updateMatrixWorld(true);
        }
        this.layers.metal.sync();
        this.layers.wound.sync();
        for (const l of this.layers.blood) l.sync();

        this._updateWrecks(dt, eye);
        this.debris.update(dt);
        this.fire.update(dt);
        this.smoke.update(dt);
    }

    _removeOwner(owner) {
        this._roots.delete(owner);
        this.layers.metal.removeOwner(owner);
        this.layers.wound.removeOwner(owner);
        for (const l of this.layers.blood) l.removeOwner(owner);
    }

    getStats() {
        return { ...this.stats, wrecksBurning: this.wrecks.length, bvhPending: this.tiles.length - this._bvhBuilt, bvhReady: !!bvhLib };
    }
}

function isDriverPart(o) {
    for (let p = o; p; p = p.parent) {
        if (p.name === 'vehicle_driver_npc') return true;
    }
    return false;
}
