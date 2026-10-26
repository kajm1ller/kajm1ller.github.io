/**
 * js/game/streetLamps.js
 *
 * Street lamps for the day/night cycle, baked by tools/buildStreetLamps.mjs
 * (js/game/data/streetLamps.json):
 *   - mapLamps: the OSM lamps OSM2World already modelled into /mapfinal (only lit here)
 *   - lamps:    new cobra-head lamps along every lit street (modelled and lit here)
 *
 * Each lamp switches on at its own point in the dusk (like real photocells) and off again at dawn.
 * Lit lamps get a glowing lens, an additive halo billboard and a soft fake pool of light on the
 * ground. The handful of lamps closest to the camera also get real SpotLights (fading in and out
 * as they are handed between lamps) so cars, people and buildings next to them are actually lit;
 * their fake ground pool fades out at the same time so the two never double up.
 *
 * Only lamps within DRAW_DISTANCE of the camera are written to the instanced meshes, rebuilt as the
 * camera moves, so the whole city costs four draw calls.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const DM = 0.1, MR = 0.001;
const CELL = 64;                    // lamp lookup grid (metres)
const DRAW_DISTANCE = 520;          // lamps further than this aren't drawn
const POOL_DISTANCE = 320;          // ground pools further than this aren't drawn
const REBUILD_MOVE = 24;            // re-gather visible lamps after the camera moves this far
const MAX_VISIBLE = 2600;
const POLE_H = 7.6;                 // new lamps: head height
const ARM = 1.9;                    // new lamps: how far the head reaches out over the road
const LIGHT_INTENSITY = 260;      // SpotLight candela for the nearest lamps
const LAMP_COLOR = new THREE.Color(0xffc98a);
const LENS_OFF = new THREE.Color(0x8e8a80);
const LENS_ON = new THREE.Color(0xfff1d6).multiplyScalar(2.2);

function hash01(n) {
    let h = (n | 0) ^ 0x9e3779b9;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Galvanised pole with a cobra-head on an arm reaching along +Z, base at the origin. */
function buildPoleGeometry() {
    const parts = [];
    const base = new THREE.CylinderGeometry(0.16, 0.2, 0.5, 8);
    base.translate(0, 0.25, 0);
    parts.push(base);
    const pole = new THREE.CylinderGeometry(0.075, 0.11, POLE_H - 0.1, 8);
    pole.translate(0, (POLE_H - 0.1) / 2, 0);
    parts.push(pole);
    // Arm rising slightly as it reaches out
    const arm = new THREE.CylinderGeometry(0.045, 0.055, ARM + 0.1, 6);
    arm.rotateX(Math.PI / 2 - 0.08);
    arm.translate(0, POLE_H + 0.02, (ARM + 0.1) / 2 - 0.05);
    parts.push(arm);
    // Cobra head housing
    const head = new THREE.BoxGeometry(0.34, 0.16, 0.75);
    head.translate(0, POLE_H + 0.1, ARM);
    parts.push(head);
    const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
    g.computeVertexNormals();
    return g;
}

/** The lens under the head (faces down). */
function buildLensGeometry() {
    const g = new THREE.PlaneGeometry(0.28, 0.6);
    g.rotateX(Math.PI / 2);
    g.translate(0, POLE_H + 0.015, ARM);
    return g;
}

const GLOW_VERTEX = /* glsl */ `
    attribute float aOn;
    uniform float uSize;
    varying vec2 vUv;
    varying float vOn;
    varying float vFade;
    uniform float uFadeNear;
    uniform float uFadeFar;
    void main() {
        vUv = uv * 2.0 - 1.0;
        vOn = aOn;
        vec4 centre = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        float dist = distance(centre.xyz, cameraPosition);
        // Far halos grow a little so distant streets still read as strings of lights
        float size = uSize * (1.0 + clamp(dist / 260.0, 0.0, 1.6));
        vec3 worldPos = centre.xyz + (camRight * position.x + camUp * position.y) * size;
        vFade = 1.0 - smoothstep(uFadeNear, uFadeFar, dist);
        // Pull the halo towards the camera so it isn't swallowed by the lamp head
        vec4 mv = viewMatrix * vec4(worldPos, 1.0);
        mv.xyz += normalize(-mv.xyz) * 0.6;
        gl_Position = projectionMatrix * mv;
    }
`;

const GLOW_FRAGMENT = /* glsl */ `
    uniform vec3 uColor;
    uniform float uIntensity;
    varying vec2 vUv;
    varying float vOn;
    varying float vFade;
    void main() {
        float r = length(vUv);
        if (r > 1.0 || vOn < 0.01) discard;
        float core = exp(-r * r * 22.0);
        float halo = exp(-r * 4.2) * (1.0 - r);
        vec3 col = uColor * (halo * 0.55) + vec3(1.0, 0.96, 0.88) * core;
        gl_FragColor = vec4(col * uIntensity * vOn * vFade, 1.0);
    }
`;

const POOL_VERTEX = /* glsl */ `
    attribute float aOn;
    varying vec2 vUv;
    varying float vOn;
    varying float vFade;
    uniform float uFadeFar;
    void main() {
        vUv = uv * 2.0 - 1.0;
        vOn = aOn;
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vFade = 1.0 - smoothstep(uFadeFar * 0.7, uFadeFar, distance(wp.xyz, cameraPosition));
        gl_Position = projectionMatrix * viewMatrix * wp;
    }
`;

const POOL_FRAGMENT = /* glsl */ `
    uniform vec3 uColor;
    uniform float uIntensity;
    varying vec2 vUv;
    varying float vOn;
    varying float vFade;
    void main() {
        float r = length(vUv);
        if (r > 1.0 || vOn < 0.01) discard;
        float fall = pow(1.0 - r, 1.8);
        gl_FragColor = vec4(uColor * fall * uIntensity * vOn * vFade, 1.0);
    }
`;

export class StreetLamps {
    /**
     * @param {THREE.Scene} scene
     * @param {object} data parsed streetLamps.json
     * @param {object} options lightCount (real SpotLights near the camera), castShadow (poles)
     */
    constructor(scene, data, options = {}) {
        this.scene = scene;
        const mapL = data.mapLamps || [];
        const newL = data.lamps || [];
        const nMap = mapL.length / 3, nNew = newL.length / 3;
        const n = nMap + nNew;
        this.count = n;
        this.counts = { existing: nMap, added: nNew };

        // Per lamp: base position, light (head) position, arm yaw, whether it needs a pole, switch-on threshold
        this.baseX = new Float32Array(n);
        this.baseZ = new Float32Array(n);
        this.headX = new Float32Array(n);
        this.headY = new Float32Array(n);
        this.headZ = new Float32Array(n);
        this.yaw = new Float32Array(n);
        this.modelled = new Uint8Array(n); // 1 = we draw the pole (new lamp)
        this.threshold = new Float32Array(n);
        for (let i = 0; i < nMap; i++) {
            this.baseX[i] = this.headX[i] = mapL[i * 3] * DM;
            this.headY[i] = mapL[i * 3 + 1] * DM;
            this.baseZ[i] = this.headZ[i] = mapL[i * 3 + 2] * DM;
        }
        for (let k = 0; k < nNew; k++) {
            const i = nMap + k;
            const x = newL[k * 3] * DM, z = newL[k * 3 + 1] * DM, yaw = newL[k * 3 + 2] * MR;
            this.baseX[i] = x;
            this.baseZ[i] = z;
            this.yaw[i] = yaw;
            this.headX[i] = x + Math.sin(yaw) * ARM;
            this.headY[i] = POLE_H - 0.05;
            this.headZ[i] = z + Math.cos(yaw) * ARM;
            this.modelled[i] = 1;
        }
        for (let i = 0; i < n; i++) this.threshold[i] = 0.15 + hash01(i * 7 + 3) * 0.45;

        this.grid = new Map();
        for (let i = 0; i < n; i++) {
            const key = Math.floor(this.baseX[i] / CELL) * 100003 + Math.floor(this.baseZ[i] / CELL);
            let arr = this.grid.get(key);
            if (!arr) this.grid.set(key, (arr = []));
            arr.push(i);
        }

        // ---- Meshes ----
        const poleMat = new THREE.MeshStandardMaterial({ name: 'StreetLampPole', color: 0x7d8186, roughness: 0.55, metalness: 0.6 });
        this.poles = new THREE.InstancedMesh(buildPoleGeometry(), poleMat, MAX_VISIBLE);
        this.poles.name = 'street_lamp_poles';
        this.poles.castShadow = options.castShadow !== false;
        this.poles.receiveShadow = true;

        const lensMat = new THREE.MeshBasicMaterial({ name: 'StreetLampLens', color: 0xffffff, side: THREE.DoubleSide });
        this.lenses = new THREE.InstancedMesh(buildLensGeometry(), lensMat, MAX_VISIBLE);
        this.lenses.name = 'street_lamp_lenses';
        this.lenses.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_VISIBLE * 3), 3);

        const glowGeo = new THREE.PlaneGeometry(2, 2);
        this.glowOn = new THREE.InstancedBufferAttribute(new Float32Array(MAX_VISIBLE), 1);
        glowGeo.setAttribute('aOn', this.glowOn);
        this.glowMat = new THREE.ShaderMaterial({
            name: 'StreetLampGlow',
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
                uColor: { value: LAMP_COLOR.clone() },
                uIntensity: { value: 0 },
                uSize: { value: 1.6 },
                uFadeNear: { value: DRAW_DISTANCE * 0.7 },
                uFadeFar: { value: DRAW_DISTANCE }
            },
            vertexShader: GLOW_VERTEX,
            fragmentShader: GLOW_FRAGMENT
        });
        this.glows = new THREE.InstancedMesh(glowGeo, this.glowMat, MAX_VISIBLE);
        this.glows.name = 'street_lamp_glows';
        this.glows.renderOrder = 3;

        const poolGeo = new THREE.PlaneGeometry(2, 2);
        poolGeo.rotateX(-Math.PI / 2);
        this.poolOn = new THREE.InstancedBufferAttribute(new Float32Array(MAX_VISIBLE), 1);
        poolGeo.setAttribute('aOn', this.poolOn);
        this.poolMat = new THREE.ShaderMaterial({
            name: 'StreetLampPool',
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4,
            uniforms: {
                uColor: { value: LAMP_COLOR.clone() },
                uIntensity: { value: 0 },
                uFadeFar: { value: POOL_DISTANCE }
            },
            vertexShader: POOL_VERTEX,
            fragmentShader: POOL_FRAGMENT
        });
        this.pools = new THREE.InstancedMesh(poolGeo, this.poolMat, MAX_VISIBLE);
        this.pools.name = 'street_lamp_pools';
        this.pools.renderOrder = 2;

        for (const m of [this.poles, this.lenses, this.glows, this.pools]) {
            m.frustumCulled = false; // instances span hundreds of metres around the camera
            m.matrixAutoUpdate = false;
            m.count = 0;
            m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            scene.add(m);
        }
        this.glows.visible = this.pools.visible = false;

        // Visible set: lamp index per glow/pool instance, and per pole/lens instance
        this.visible = new Int32Array(MAX_VISIBLE);
        this.visibleCount = 0;
        this.poleLamp = new Int32Array(MAX_VISIBLE);
        this.poleCount = 0;
        this.poolSlot = new Int32Array(MAX_VISIBLE); // glow/pool instance -> pool instance (-1 = none)
        this._lastBuild = new THREE.Vector3(Infinity, 0, Infinity);
        this._matrix = new THREE.Matrix4();
        this._quat = new THREE.Quaternion();
        this._scale = new THREE.Vector3(1, 1, 1);
        this._pos = new THREE.Vector3();
        this._up = new THREE.Vector3(0, 1, 0);
        this._color = new THREE.Color();
        this._darkness = -1;
        this._lampOn = new Float32Array(n); // smoothed 0..1 per lamp (only maintained for visible ones)

        // ---- Real lights for the nearest lamps ----
        this.lightCount = options.lightCount !== undefined ? options.lightCount : 10;
        this.slots = [];
        for (let s = 0; s < this.lightCount; s++) {
            const light = new THREE.SpotLight(LAMP_COLOR, 0, 38, 1.1, 0.7, 2);
            light.name = `street_lamp_light_${s}`;
            light.visible = false;
            scene.add(light);
            scene.add(light.target);
            this.slots.push({ light, lamp: -1, level: 0 });
        }
        this._lightsOn = false;
        this._assignTimer = 0;
        this._want = new Set();
        this._near = [];
        this._lampSlot = new Map(); // lamp index -> slot
    }

    _gather(cam) {
        const cx = cam.x, cz = cam.z;
        const r = DRAW_DISTANCE;
        const x0 = Math.floor((cx - r) / CELL), x1 = Math.floor((cx + r) / CELL);
        const z0 = Math.floor((cz - r) / CELL), z1 = Math.floor((cz + r) / CELL);
        let nv = 0, np = 0, npool = 0;
        const m = this._matrix;
        for (let gx = x0; gx <= x1 && nv < MAX_VISIBLE; gx++) {
            for (let gz = z0; gz <= z1 && nv < MAX_VISIBLE; gz++) {
                const arr = this.grid.get(gx * 100003 + gz);
                if (!arr) continue;
                for (let k = 0; k < arr.length && nv < MAX_VISIBLE; k++) {
                    const i = arr[k];
                    const dx = this.baseX[i] - cx, dz = this.baseZ[i] - cz;
                    const d2 = dx * dx + dz * dz;
                    if (d2 > r * r) continue;
                    this.visible[nv] = i;
                    m.makeTranslation(this.headX[i], this.headY[i] - 0.12, this.headZ[i]);
                    this.glows.setMatrixAt(nv, m);
                    if (d2 < POOL_DISTANCE * POOL_DISTANCE) {
                        m.makeScale(9, 1, 9);
                        m.setPosition(this.headX[i], 0.12, this.headZ[i]);
                        this.pools.setMatrixAt(npool, m);
                        this.poolSlot[nv] = npool++;
                    } else {
                        this.poolSlot[nv] = -1;
                    }
                    if (this.modelled[i]) {
                        this._quat.setFromAxisAngle(this._up, this.yaw[i]);
                        this._pos.set(this.baseX[i], 0, this.baseZ[i]);
                        m.compose(this._pos, this._quat, this._scale);
                        this.poles.setMatrixAt(np, m);
                        this.lenses.setMatrixAt(np, m);
                        this.poleLamp[np++] = i;
                    }
                    nv++;
                }
            }
        }
        this.visibleCount = nv;
        this.poleCount = np;
        this.glows.count = nv;
        this.pools.count = npool;
        this.poles.count = this.lenses.count = np;
        for (const mesh of [this.glows, this.pools, this.poles, this.lenses]) mesh.instanceMatrix.needsUpdate = true;
        this._lastBuild.set(cx, 0, cz);
        this._writeStates();
    }

    /** Lens colours and halo/pool on-levels for the visible set. */
    _writeStates() {
        const dark = this._darkness;
        const c = this._color;
        for (let k = 0; k < this.poleCount; k++) {
            const on = this._isOn(this.poleLamp[k], dark);
            c.copy(LENS_OFF).lerp(LENS_ON, on);
            this.lenses.setColorAt(k, c);
        }
        if (this.lenses.instanceColor) this.lenses.instanceColor.needsUpdate = true;
        for (let k = 0; k < this.visibleCount; k++) {
            const i = this.visible[k];
            const on = this._isOn(i, dark);
            this.glowOn.array[k] = on;
            const p = this.poolSlot[k];
            if (p >= 0) {
                const slot = this._lampSlot.get(i);
                const real = slot !== undefined ? this.slots[slot].level : 0;
                this.poolOn.array[p] = on * (1 - real);
            }
        }
        this.glowOn.needsUpdate = true;
        this.poolOn.needsUpdate = true;
    }

    /** 0..1: lamp i is lit at this darkness (each one switches over a short band past its own threshold) */
    _isOn(i, dark) {
        const t = (dark - this.threshold[i]) / 0.06;
        return t <= 0 ? 0 : t >= 1 ? 1 : t;
    }

    /**
     * How much lamp light reaches a point (for things lit separately, like the first-person hands):
     * { level 0..~1.5, x, y, z } with (x, y, z) the unit direction from the point towards the light,
     * and `color` the lamp colour.
     */
    illuminationAt(x, y, z, out = { level: 0, x: 0, y: 1, z: 0, color: LAMP_COLOR }) {
        out.level = 0;
        out.x = 0;
        out.y = 0;
        out.z = 0;
        out.color = LAMP_COLOR;
        const dark = this._darkness || 0;
        if (dark <= 0.15) return out;
        const R = 18;
        for (let k = 0; k < this.visibleCount; k++) {
            const i = this.visible[k];
            const dx = this.headX[i] - x, dz = this.headZ[i] - z;
            if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
            const dy = this.headY[i] - y;
            const d = Math.hypot(dx, dy, dz);
            const horiz = Math.hypot(dx, dz);
            if (horiz > R) continue;
            const on = this._isOn(i, dark);
            if (on <= 0) continue;
            const w = on * Math.pow(1 - horiz / R, 2);
            out.level += w;
            out.x += (dx / d) * w;
            out.y += (dy / d) * w;
            out.z += (dz / d) * w;
        }
        const l = Math.hypot(out.x, out.y, out.z);
        if (l > 1e-6) {
            out.x /= l;
            out.y /= l;
            out.z /= l;
        } else {
            out.y = 1;
        }
        out.level = Math.min(1.5, out.level);
        return out;
    }

    /**
     * @param {number} dt seconds
     * @param {THREE.Vector3} cameraPos
     * @param {THREE.Vector3} lookDir horizontal camera forward (for choosing which lamps get real lights)
     * @param {number} darkness 0 = day, 1 = night (DayNightCycle.darkness)
     */
    update(dt, cameraPos, lookDir, darkness) {
        const prevDark = this._darkness;
        this._darkness = darkness;
        const anyOn = darkness > 0.15;
        this.glows.visible = this.pools.visible = anyOn;
        this.glowMat.uniforms.uIntensity.value = 1.0;
        this.poolMat.uniforms.uIntensity.value = 0.42;

        const dx = cameraPos.x - this._lastBuild.x, dz = cameraPos.z - this._lastBuild.z;
        if (dx * dx + dz * dz > REBUILD_MOVE * REBUILD_MOVE) {
            this._gather(cameraPos);
        } else if (Math.abs(darkness - prevDark) > 0.004 || (anyOn && this._lightsOn)) {
            this._writeStates();
        }

        this._updateLights(dt, cameraPos, lookDir, darkness);
    }

    _updateLights(dt, cameraPos, lookDir, darkness) {
        if (this.lightCount === 0) return;
        // Real lights only exist after dark (toggling them changes the shader light count once at dusk and dawn)
        const wantLights = darkness > 0.4;
        if (wantLights !== this._lightsOn) {
            this._lightsOn = wantLights;
            for (const s of this.slots) {
                s.light.visible = wantLights;
                if (!wantLights) {
                    s.lamp = -1;
                    s.level = 0;
                    s.light.intensity = 0;
                }
            }
            this._lampSlot.clear();
            this._assignTimer = 0;
        }
        if (!wantLights) return;

        this._assignTimer -= dt;
        if (this._assignTimer <= 0) {
            this._assignTimer = 0.25;
            // Nearest lit lamps to a point a little ahead of the camera
            const fx = cameraPos.x + lookDir.x * 14, fz = cameraPos.z + lookDir.z * 14;
            const near = this._near;
            near.length = 0;
            for (let k = 0; k < this.visibleCount; k++) {
                const i = this.visible[k];
                if (this._isOn(i, darkness) < 0.5) continue;
                const ddx = this.headX[i] - fx, ddz = this.headZ[i] - fz;
                const d2 = ddx * ddx + ddz * ddz;
                if (d2 < 90 * 90) near.push(d2, i);
            }
            // Partial selection of the lightCount closest (pairs of [d2, index])
            const pairs = [];
            for (let k = 0; k < near.length; k += 2) pairs.push([near[k], near[k + 1]]);
            pairs.sort((a, b) => a[0] - b[0]);
            this._want.clear();
            for (let k = 0; k < Math.min(this.lightCount, pairs.length); k++) this._want.add(pairs[k][1]);
            // Free slots whose lamp is no longer wanted fade out; free ones pick up new lamps
            for (const s of this.slots) if (s.lamp >= 0 && !this._want.has(s.lamp)) s.fading = true;
            for (const i of this._want) {
                if (this._lampSlot.has(i)) {
                    this.slots[this._lampSlot.get(i)].fading = false;
                    continue;
                }
                const s = this.slots.find((sl) => sl.lamp < 0);
                if (!s) break;
                s.lamp = i;
                s.level = 0;
                s.fading = false;
                s.light.position.set(this.headX[i], this.headY[i] - 0.1, this.headZ[i]);
                s.light.target.position.set(this.headX[i], 0, this.headZ[i]);
                s.light.target.updateMatrixWorld();
                this._lampSlot.set(i, this.slots.indexOf(s));
            }
        }

        for (const s of this.slots) {
            if (s.lamp < 0) continue;
            s.level = THREE.MathUtils.clamp(s.level + (s.fading ? -dt : dt) * 3, 0, 1);
            s.light.intensity = LIGHT_INTENSITY * s.level * this._isOn(s.lamp, darkness);
            if (s.fading && s.level <= 0) {
                this._lampSlot.delete(s.lamp);
                s.lamp = -1;
                s.light.intensity = 0;
            }
        }
    }
}

export async function loadStreetLamps(scene, url = './js/game/data/streetLamps.json', options = {}) {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return new StreetLamps(scene, await res.json(), options);
    } catch (err) {
        console.warn('[StreetLamps] lamp data unavailable:', err);
        return new StreetLamps(scene, { mapLamps: [], lamps: [] }, options);
    }
}
