/**
 * js/game/mermaid/mermaidEnv.js
 *
 * The sea itself: terrain with biomes, caustics, the rippling surface far above, light shafts,
 * drifting marine snow, bubble vents, and a few thousand plants / corals / rocks, plus the
 * tide cycle (day, dusk, night) that colours the water and lights and brings the glow up at night.
 */

import * as THREE from 'three';
import {
    TWO_PI, between, pick, clamp, lerp, smooth, mulberry32, noise2, fbm, std, mesh, canvasTexture, glowTexture, makeSway, SWAY, merge, paint, lerpColor, shade
} from './mermaidKit.js';
import { WORLD_R, SURFACE_Y, AREAS, areaById } from './mermaidData.js';
import { panelTexture } from './mermaidFace.js';

const A = (id) => areaById(id).at;
const dist2 = (x, z, p) => Math.hypot(x - p[0], z - p[1]);

// ================================================================================================
// Terrain height
// ================================================================================================
export const TRENCH = { x: 0, z: 340, r: 75, depth: 52 };
export const CAVE = { x: -260, z: -210, r: 62, h: 4 };
const TEMPLE_PLATE = 5.5;

/** Height of the seabed at (x, z). */
export function floorHeight(x, z) {
    const r = Math.hypot(x, z);
    // Gentle ripples everywhere, rolling hills further out
    let h = Math.sin(x * 0.045) * 1.0 + Math.cos(z * 0.06) * 0.8 + Math.sin((x + z) * 0.11) * 0.3;
    const far = smooth(70, 190, r);
    h = lerp(h * 0.45, h + fbm(x * 0.007 + 3, z * 0.007 + 8, 4) * 26 * far + Math.abs(noise2(x * 0.012, z * 0.012)) * 9 * far, far);
    // The town's shelf
    const shelf = smooth(150, 80, r);
    h = lerp(h, Math.sin(x * 0.045) * 0.5 + Math.cos(z * 0.06) * 0.4, shelf);
    // Features
    const cave = dist2(x, z, [CAVE.x, CAVE.z]);
    h += CAVE.h * Math.pow(smooth(CAVE.r * 1.4, CAVE.r * 0.2, cave), 1.3);
    const temple = dist2(x, z, A('temple'));
    h = lerp(h, TEMPLE_PLATE + Math.sin(x * 0.2) * 0.1, smooth(70, 46, temple));
    const grotto = dist2(x, z, A('grotto'));
    h = lerp(h, -3 + Math.sin(x * 0.1) * 0.12, smooth(56, 34, grotto));            // a flat bowl for the amphitheatre
    h += 6 * smooth(78, 62, grotto) * smooth(46, 62, grotto);                      // a rocky rim around it
    const lagoon = dist2(x, z, A('lagoon'));
    h = lerp(h, -2.0 + Math.sin(x * 0.07) * 0.4, smooth(78, 40, lagoon));
    const trench = dist2(x, z, [TRENCH.x, TRENCH.z]);
    h -= TRENCH.depth * Math.pow(smooth(TRENCH.r, 10, trench), 1.6);
    // The edge of the world: the seabed climbs into the haze
    h += Math.pow(smooth(WORLD_R - 40, WORLD_R + 60, r), 1.5) * 90;
    return h;
}

/** Biome weights at (x, z): how kelpy, reefy, rocky, deep, ruined... */
export function biome(x, z) {
    const kelpD = dist2(x, z, A('kelp'));
    const lagD = dist2(x, z, A('lagoon'));
    const reefN = fbm(x * 0.012 + 40, z * 0.012 - 7, 3);
    return {
        kelp: smooth(70, 25, kelpD),
        reef: clamp(Math.max(smooth(110, 50, lagD), smooth(0.05, 0.3, reefN) * 0.9), 0, 1),
        rock: clamp(smooth(0.1, 0.5, Math.abs(noise2(x * 0.02 + 5, z * 0.02))) * smooth(60, 160, Math.hypot(x, z)) + smooth(CAVE.r * 1.5, CAVE.r * 0.6, dist2(x, z, [CAVE.x, CAVE.z])), 0, 1),
        deep: smooth(TRENCH.r + 25, TRENCH.r * 0.4, dist2(x, z, [TRENCH.x, TRENCH.z])),
        temple: smooth(62, 40, dist2(x, z, A('temple'))),
        cave: smooth(CAVE.r * 1.2, CAVE.r * 0.5, dist2(x, z, [CAVE.x, CAVE.z])),
        town: smooth(120, 60, Math.hypot(x, z))
    };
}

/** True where nothing natural should be scattered (buildings, paths). */
const CLEAR = ['plaza', 'vanity', 'chapel', 'mall', 'arcade', 'garden', 'petnook', 'temple', 'grotto'];
export function blocked(x, z, pad = 0) {
    for (const id of CLEAR) {
        const a = areaById(id);
        if (dist2(x, z, a.at) < a.r * 0.95 + pad) return true;
    }
    if (Math.abs(x) < 10 + pad && z < -20 && z > -75) return true;      // the chapel avenue
    if (x > 20 && x < 70 && z > -4 - pad && z < 22 + pad) return true;  // the mall road
    if (dist2(x, z, [-260, -210]) < 48 + pad) return true;              // inside the cave dome
    return false;
}

// ================================================================================================
// Tide cycle
// ================================================================================================
// tod: 0..1, 0 = dawn, 0.25 = noon, 0.5 = dusk, 0.75 = midnight
const KEYS = [
    // t,     fogColor,  skyTop,    hemiSky,   hemiGround, sunColor,  sunI, hemiI, fogDens, day
    [0.00, 0x2a8fb8, 0xf7b89a, 0x9fd8e8, 0x1a3a50, 0xffd9b0, 0.7, 0.8, 0.0125, 0.55],
    [0.12, 0x1388b8, 0xcdf5ff, 0xa8ecff, 0x0f3550, 0xe8fbff, 1.05, 0.95, 0.0108, 0.9],
    [0.25, 0x0f7fb0, 0xd9f6ff, 0xb4f0ff, 0x0a3050, 0xf2fdff, 1.25, 1.0, 0.0100, 1.0],
    [0.40, 0x1a7fb0, 0xf4d6b8, 0xa8ddea, 0x14344c, 0xffe3c0, 0.95, 0.88, 0.0110, 0.8],
    [0.50, 0x2e5f9c, 0xc58fd0, 0x7f9fdc, 0x152a4a, 0xffb898, 0.7, 0.9, 0.0125, 0.45],
    [0.62, 0x0d2b57, 0x3c5ca8, 0x4a66b0, 0x0a1a38, 0x9fb8ff, 0.5, 0.65, 0.0140, 0.15],
    [0.75, 0x061a3d, 0x203878, 0x3a56a6, 0x050f26, 0x8fa8ff, 0.45, 0.6, 0.0148, 0.05],
    [0.88, 0x0a2a55, 0x3a58a0, 0x4a6cb4, 0x0a1a38, 0xa8b8ff, 0.5, 0.7, 0.0140, 0.15],
    [1.00, 0x2a8fb8, 0xf7b89a, 0x9fd8e8, 0x1a3a50, 0xffd9b0, 0.9, 1.0, 0.0125, 0.55]
];
const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _dark = new THREE.Color(0x02060c);
function sampleKeys(t) {
    t = ((t % 1) + 1) % 1;
    let i = 0;
    while (i < KEYS.length - 2 && t > KEYS[i + 1][0]) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const k = clamp((t - a[0]) / (b[0] - a[0]), 0, 1);
    const col = (ia) => _c1.set(a[ia]).lerp(_c2.set(b[ia]), k).clone();
    return {
        fog: col(1), sky: col(2), hemiSky: col(3), hemiGround: col(4), sun: col(5),
        sunI: lerp(a[6], b[6], k), hemiI: lerp(a[7], b[7], k), fogDens: lerp(a[8], b[8], k), day: lerp(a[9], b[9], k)
    };
}

// ================================================================================================
// Geometry helpers for props
// ================================================================================================
function noisyGeo(geo, amp, freq, seed = 0) {
    const p = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const n = noise2(v.x * freq + seed, v.z * freq + v.y * freq * 0.7) * 0.7 + noise2(v.x * freq * 2.3 + seed, v.y * freq * 2.3 + v.z * freq) * 0.3;
        v.multiplyScalar(1 + n * amp);
        p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    return geo;
}

function branchingCoralGeo(seed = 1) {
    const rnd = mulberry32(seed);
    const parts = [];
    const grow = (base, dir, len, r, depth) => {
        const g = new THREE.CylinderGeometry(r * 0.7, r, len, 6);
        g.translate(0, len / 2, 0);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        g.applyQuaternion(q);
        g.translate(base.x, base.y, base.z);
        parts.push(paint(g, lerpColor(0xffffff, 0xcfcfcf, 1 - depth / 3)));
        const end = base.clone().add(dir.clone().normalize().multiplyScalar(len));
        if (depth > 0) {
            const n = depth === 3 ? 3 : 2;
            for (let i = 0; i < n; i++) {
                const nd = dir.clone().normalize().add(new THREE.Vector3((rnd() - 0.5) * 1.2, 0.5 + rnd() * 0.3, (rnd() - 0.5) * 1.2)).normalize();
                grow(end, nd, len * (0.65 + rnd() * 0.15), r * 0.7, depth - 1);
            }
        } else {
            const tip = new THREE.SphereGeometry(r * 0.95, 6, 5);
            tip.translate(end.x, end.y, end.z);
            parts.push(paint(tip, 0xffffff));
        }
    };
    grow(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 0.5, 0.11, 3);
    return merge(parts);
}

function brainCoralGeo() {
    const g = new THREE.SphereGeometry(0.8, 28, 14, 0, TWO_PI, 0, Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const groove = Math.sin(x * 14 + Math.sin(z * 9) * 2) * Math.cos(z * 12 + Math.sin(x * 8)) * 0.045;
        const l = Math.hypot(x, y, z) || 1;
        const k = (l + groove) / l;
        p.setXYZ(i, x * k, y * k * 0.75, z * k);
    }
    g.computeVertexNormals();
    return g;
}

function tableCoralGeo() {
    const top = new THREE.CylinderGeometry(1.2, 1.0, 0.18, 14, 1);
    top.translate(0, 1.0, 0);
    noisyGeo(top, 0.08, 3, 2);
    const stalk = new THREE.CylinderGeometry(0.16, 0.28, 1.0, 7);
    stalk.translate(0, 0.5, 0);
    return merge([top, stalk]);
}

function tubeSpongeGeo() {
    const parts = [];
    for (let i = 0; i < 5; i++) {
        const h = 0.9 + Math.random() * 1.1, r = 0.16 + Math.random() * 0.08;
        const g = new THREE.CylinderGeometry(r * 1.2, r, h, 10, 1, true);
        g.translate(0, h / 2, 0);
        g.translate((i - 2) * 0.28, 0, Math.sin(i * 1.7) * 0.2);
        parts.push(g);
        const ring = new THREE.RingGeometry(r * 0.5, r * 1.15, 10);
        ring.rotateX(-Math.PI / 2);
        ring.translate((i - 2) * 0.28, h, Math.sin(i * 1.7) * 0.2);
        parts.push(ring);
    }
    return merge(parts);
}

function anemoneGeo() {
    const parts = [];
    const base = new THREE.CylinderGeometry(0.28, 0.34, 0.3, 12);
    base.translate(0, 0.15, 0);
    parts.push(paint(base, 0xb0707e));
    for (let i = 0; i < 18; i++) {
        const a = (i / 18) * TWO_PI, r = 0.12 + (i % 3) * 0.07;
        const t = new THREE.CylinderGeometry(0.012, 0.04, 0.7, 5, 4);
        t.translate(0, 0.35, 0);
        t.rotateZ(Math.sin(a) * 0.5);
        t.rotateX(Math.cos(a) * 0.5);
        t.translate(Math.sin(a) * r, 0.25, Math.cos(a) * r);
        const p = t.attributes.position;
        const col = new Float32Array(p.count * 3);
        const c = new THREE.Color();
        for (let k = 0; k < p.count; k++) {
            const y = p.getY(k);
            c.set(lerpColor(0xffffff, 0xfff2a8, clamp((y - 0.3) / 0.7, 0, 1)));
            col.set([c.r, c.g, c.b], k * 3);
        }
        t.setAttribute('color', new THREE.BufferAttribute(col, 3));
        parts.push(t);
    }
    return merge(parts);
}

function shellGeo(kind) {
    if (kind === 'spiral') {
        const parts = [];
        for (let i = 0; i < 6; i++) {
            const s = new THREE.SphereGeometry(0.2 - i * 0.025, 10, 8);
            s.scale(1, 0.7, 1);
            s.translate(Math.sin(i * 1.0) * 0.06, 0.12 + i * 0.1, Math.cos(i * 1.0) * 0.06);
            parts.push(s);
        }
        return merge(parts);
    }
    const g = new THREE.SphereGeometry(0.25, 14, 8, 0, TWO_PI, 0, Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const ang = Math.atan2(z, x);
        const k = 1 + 0.08 * Math.cos(ang * 10);
        p.setXYZ(i, x * k, y * 0.6, z * k);
    }
    g.computeVertexNormals();
    return g;
}

// ================================================================================================
// The environment
// ================================================================================================
export class Environment {
    constructor(scene, renderer, opts = {}) {
        this.scene = scene;
        this.renderer = renderer;
        this.time = 0;
        this.tod = 0.2;
        this.nightness = 0;
        this.day = 1;
        this.glows = [];           // { mat, base, night }: emissive materials that come up at night
        this.lampSprites = [];     // glow sprites that fade in at night
        this.quality = opts.quality || 'high';
        this.shadows = !!opts.shadows;
        this._snowRoot = new THREE.Vector3();
        this._build();
    }

    _build() {
        const scene = this.scene;
        scene.background = new THREE.Color(0x0a5a8a);
        scene.fog = new THREE.FogExp2(0x0c6896, 0.0105);
        this.hemi = new THREE.HemisphereLight(0xa8ecff, 0x0a2a48, 1.35);
        scene.add(this.hemi);
        this.sun = new THREE.DirectionalLight(0xd9f6ff, 1.6);
        this.sun.position.set(30, 100, 20);
        if (this.shadows) {
            this.sun.castShadow = true;
            this.sun.shadow.mapSize.set(2048, 2048);
            const c = this.sun.shadow.camera;
            c.left = -45; c.right = 45; c.top = 45; c.bottom = -45; c.near = 10; c.far = 220;
            this.sun.shadow.bias = -0.0006;
            this.sun.shadow.normalBias = 0.05;
        }
        scene.add(this.sun, this.sun.target);
        this.ambient = new THREE.AmbientLight(0x3a7bb0, 0.35);
        scene.add(this.ambient);
        this._buildSeabed();
        this._buildSurface();
        this._buildRays();
        this._buildSnow();
        this._buildBubbles();
        this._scatter();
        this.setTime(this.tod);
    }

    // ---- Seabed -------------------------------------------------------------------------------
    _buildSeabed() {
        const SIZE = 1100, SEG = 220;
        const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
        geo.rotateX(-Math.PI / 2);
        const pos = geo.attributes.position;
        const colors = new Float32Array(pos.count * 3);
        const c = new THREE.Color(), tmp = new THREE.Color();
        const sand = new THREE.Color(0xe6d4a2), sand2 = new THREE.Color(0xc4ae7c), pink = new THREE.Color(0xeab8a2), mud = new THREE.Color(0x7d8250),
            rock = new THREE.Color(0x8a867c), dark = new THREE.Color(0x24324a), cave = new THREE.Color(0x4a4450), stone = new THREE.Color(0xcfc7b4);
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), z = pos.getZ(i);
            const h = floorHeight(x, z);
            pos.setY(i, h);
            const b = biome(x, z);
            const n = 0.5 + 0.5 * Math.sin(x * 0.2) * Math.cos(z * 0.17);
            c.copy(sand).lerp(sand2, n * 0.5);
            c.lerp(pink, b.reef * 0.45);
            c.lerp(mud, b.kelp * 0.55);
            c.lerp(rock, b.rock * 0.7);
            c.lerp(stone, b.temple * 0.8);
            c.lerp(cave, b.cave * 0.7);
            // deeper = darker and bluer; steep slopes show rock
            c.lerp(tmp.set(0x2a4a6a), clamp(-h / 40, 0, 0.6));
            c.lerp(dark, b.deep * 0.85);
            colors.set([c.r, c.g, c.b], i * 3);
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.computeVertexNormals();
        // Sand ripples
        const ripple = canvasTexture(256, 256, (g, w, h) => {
            g.fillStyle = '#c8c8c8';
            g.fillRect(0, 0, w, h);
            const rnd = mulberry32(2);
            for (let i = 0; i < 90; i++) {
                const y = rnd() * h;
                g.strokeStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '90,90,90'},${0.1 + rnd() * 0.2})`;
                g.lineWidth = 1 + rnd() * 2.5;
                g.beginPath();
                g.moveTo(0, y);
                for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 5);
                g.stroke();
            }
            for (let i = 0; i < 260; i++) {
                g.fillStyle = `rgba(0,0,0,${rnd() * 0.12})`;
                g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
            }
        }, { repeat: [90, 90], linear: false });
        ripple.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.MeshStandardMaterial({ vertexColors: true, map: ripple, bumpMap: ripple, bumpScale: 1.2, roughness: 0.95 });
        this.causticStrength = { value: 1 };
        material.onBeforeCompile = (sh) => {
            sh.uniforms.uCt = SWAY.time;
            sh.uniforms.uCaStr = this.causticStrength;
            sh.vertexShader = sh.vertexShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
                .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
            sh.fragmentShader = sh.fragmentShader
                .replace('#include <common>', `#include <common>
                    varying vec3 vWPos; uniform float uCt; uniform float uCaStr;
                    float caustic(vec2 p, float t) {
                        vec2 i = p; float c = 1.0; float inten = 0.006;
                        for (int n = 0; n < 4; n++) {
                            float tt = t * (1.0 - (3.5 / float(n + 1)));
                            i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
                            c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
                        }
                        c /= 4.0;
                        c = 1.17 - pow(c, 1.4);
                        return pow(abs(c), 8.0);
                    }`)
                .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
                    float cDepth = clamp(1.0 - (vWPos.y + 4.0) / 44.0, 0.0, 1.0);
                    float cau = clamp(caustic(mod(vWPos.xz * 0.085, 6.28318) - 250.0, uCt * 0.55), 0.0, 1.5);
                    totalEmissiveRadiance += vec3(0.5, 0.75, 0.85) * cau * uCaStr * cDepth * 0.3;`);
        };
        material.customProgramCacheKey = () => 'seabed-caustics';
        this.seabed = new THREE.Mesh(geo, material);
        this.seabed.receiveShadow = true;
        scene_add(this.scene, this.seabed);
    }

    // ---- Water surface and light shafts ---------------------------------------------------------
    _buildSurface() {
        const g = new THREE.PlaneGeometry(1600, 1600, 1, 1);
        g.rotateX(Math.PI / 2);
        this.surfaceUniforms = { uT: SWAY.time, uSun: { value: new THREE.Vector3(0.3, 1, 0.2) }, uDay: { value: 1 }, uCam: { value: new THREE.Vector3() } };
        const m = new THREE.ShaderMaterial({
            uniforms: this.surfaceUniforms, side: THREE.DoubleSide, fog: false,
            vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
            fragmentShader: `
                varying vec3 vW; uniform float uT; uniform vec3 uSun; uniform float uDay; uniform vec3 uCam;
                float h(vec2 p){ return sin(p.x*0.9+uT*0.8)*sin(p.y*1.1-uT*0.6)+sin((p.x+p.y)*0.5+uT*0.5)*0.8+sin(p.x*2.1-p.y*1.7+uT*1.3)*0.4; }
                void main(){
                    vec3 V = normalize(vW - uCam);
                    vec2 p = vW.xz * 0.12;
                    float w = h(p) * 0.3 + 0.5; float w2 = h(p * 2.3 + 7.0) * 0.3 + 0.5;
                    vec3 deep = mix(vec3(0.02,0.07,0.17), vec3(0.18,0.62,0.84), uDay);
                    vec3 bright = mix(vec3(0.05,0.14,0.30), vec3(0.78,0.98,1.0), uDay);
                    float fres = pow(1.0 - abs(V.y), 2.2);
                    vec3 col = mix(bright, deep, fres * 0.7);
                    col += vec3(0.55,0.85,1.0) * pow(clamp(w * w2, 0.0, 1.0), 3.0) * 0.9 * uDay;
                    float sd = max(dot(V, normalize(uSun)), 0.0);
                    col += vec3(1.0,0.95,0.8) * pow(sd, 30.0) * 1.8 * uDay;
                    // moonlight at night
                    col += vec3(0.5,0.6,1.0) * pow(sd, 60.0) * 0.8 * (1.0 - uDay);
                    gl_FragColor = vec4(col, 1.0);
                }`
        });
        this.surface = new THREE.Mesh(g, m);
        this.surface.position.y = SURFACE_Y;
        this.surface.frustumCulled = false;
        this.scene.add(this.surface);
    }

    _buildRays() {
        const tex = canvasTexture(64, 256, (g, w, h) => {
            const grd = g.createLinearGradient(0, 0, 0, h);
            grd.addColorStop(0, 'rgba(255,255,255,0.9)');
            grd.addColorStop(0.5, 'rgba(255,255,255,0.28)');
            grd.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = grd;
            g.fillRect(0, 0, w, h);
            const gx = g.createLinearGradient(0, 0, w, 0);
            gx.addColorStop(0, 'rgba(0,0,0,1)');
            gx.addColorStop(0.5, 'rgba(0,0,0,0)');
            gx.addColorStop(1, 'rgba(0,0,0,1)');
            g.globalCompositeOperation = 'destination-out';
            g.fillStyle = gx;
            g.fillRect(0, 0, w, h);
        });
        this.rays = [];
        this.rayMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, color: 0xd6fbff });
        const rnd = mulberry32(3);
        for (let i = 0; i < 26; i++) {
            const g = new THREE.CylinderGeometry(2 + rnd() * 3, 7 + rnd() * 6, SURFACE_Y + 10, 12, 1, true);
            g.translate(0, -(SURFACE_Y + 10) / 2, 0);
            const m = new THREE.Mesh(g, this.rayMat);
            m.position.set((rnd() - 0.5) * 420, SURFACE_Y, (rnd() - 0.5) * 420);
            m.userData.phase = rnd() * 10;
            m.frustumCulled = false;
            this.scene.add(m);
            this.rays.push(m);
        }
    }

    _buildSnow() {
        const N = this.quality === 'low' ? 250 : 800;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(N * 3);
        const rnd = mulberry32(12);
        for (let i = 0; i < N; i++) pos.set([rnd() * 50, rnd() * 50, rnd() * 50], i * 3);
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const m = new THREE.PointsMaterial({ map: glowTexture(), size: 0.12, color: 0xdff6ff, transparent: true, opacity: 0.55, depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending });
        m.onBeforeCompile = (sh) => {
            sh.uniforms.uSnowT = SWAY.time;
            sh.vertexShader = sh.vertexShader
                .replace('#include <common>', '#include <common>\nuniform float uSnowT;')
                .replace('#include <begin_vertex>', `vec3 transformed = position;
                    transformed.y -= uSnowT * 0.28 + sin(uSnowT * 0.5 + position.x) * 0.3;
                    transformed.x += sin(uSnowT * 0.2 + position.z) * 0.6;
                    transformed = mod(transformed + 25.0, 50.0) - 25.0;`);
        };
        this.snow = new THREE.Points(geo, m);
        this.snow.frustumCulled = false;
        this.scene.add(this.snow);
    }

    _buildBubbles() {
        const N = 520;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(N * 3);
        this.bubbleVents = [];
        const rnd = mulberry32(14);
        for (let i = 0; i < 18; i++) {
            let x, z;
            do { x = (rnd() - 0.5) * 380; z = (rnd() - 0.5) * 380; } while (blocked(x, z, 6));
            this.bubbleVents.push([x, z]);
        }
        for (let i = 0; i < N; i++) {
            const v = this.bubbleVents[i % this.bubbleVents.length];
            pos.set([v[0] + (rnd() - 0.5) * 2, rnd() * SURFACE_Y, v[1] + (rnd() - 0.5) * 2], i * 3);
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this.bubbleTex = canvasTexture(32, 32, (g) => {
            g.strokeStyle = 'rgba(255,255,255,0.95)';
            g.lineWidth = 2.5;
            g.beginPath();
            g.arc(16, 16, 12, 0, TWO_PI);
            g.stroke();
            g.fillStyle = 'rgba(255,255,255,0.8)';
            g.beginPath();
            g.arc(11, 11, 3, 0, TWO_PI);
            g.fill();
        });
        this.bubbles = new THREE.Points(geo, new THREE.PointsMaterial({ map: this.bubbleTex, size: 0.45, transparent: true, depthWrite: false, opacity: 0.8 }));
        this.bubbles.frustumCulled = false;
        this.scene.add(this.bubbles);
    }

    // ---- Plants, corals, rocks ------------------------------------------------------------------
    _scatter() {
        const rnd = mulberry32(77);
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
        const up = new THREE.Vector3(0, 1, 0);
        const place = (mesh, i, x, y, z, sc, scy = sc, tilt = 0) => {
            q.setFromEuler(new THREE.Euler((rnd() - 0.5) * tilt, rnd() * TWO_PI, (rnd() - 0.5) * tilt));
            p.set(x, y, z);
            s.set(sc, scy, sc);
            m4.compose(p, q, s);
            mesh.setMatrixAt(i, m4);
        };
        const sample = (accept, tries = 40) => {
            for (let k = 0; k < tries; k++) {
                const a = rnd() * TWO_PI, r = Math.sqrt(rnd()) * (WORLD_R + 20);
                const x = Math.cos(a) * r, z = Math.sin(a) * r;
                if (blocked(x, z)) continue;
                const b = biome(x, z);
                if (rnd() < accept(b, x, z)) return [x, z, b];
            }
            return null;
        };
        const low = this.quality === 'low';
        const k = low ? 0.5 : 1;

        // Kelp: tall ribbons, dense in the forest, scattered elsewhere
        const kelpGeo = new THREE.PlaneGeometry(1, 1, 1, 10);
        kelpGeo.translate(0, 0.5, 0);
        const kelpMat = makeSway(new THREE.MeshStandardMaterial({ map: panelTexture('kelp', 0xffffff, 0xffffff), color: 0xffffff, side: THREE.DoubleSide, roughness: 0.75, alphaTest: 0.4 }), { axis: 'y', amp: 0.034, freq: 0.19, speed: 1.1, instanced: true });
        const kelpN = Math.round(900 * k);
        const kelp = new THREE.InstancedMesh(kelpGeo, kelpMat, kelpN);
        let n = 0;
        for (let i = 0; i < kelpN * 3 && n < kelpN; i++) {
            const pt = sample((b) => 0.04 + b.kelp * 0.95 - b.deep);
            if (!pt) continue;
            const h = pt[2].kelp > 0.3 ? between(14, 30) : between(5, 12);
            q.setFromEuler(new THREE.Euler(0, rnd() * Math.PI, 0));
            p.set(pt[0], floorHeight(pt[0], pt[1]) - 0.3, pt[1]);
            s.set(between(2.4, 4.2), h, 1);
            m4.compose(p, q, s);
            kelp.setMatrixAt(n, m4);
            kelp.setColorAt(n, col.setHex(pick([0x2e8b3c, 0x3fa34d, 0x6b8e23, 0x2f7d32, 0x8fbc3f, 0x1f6f4a])));
            n++;
        }
        kelp.count = n;
        kelp.castShadow = false;
        kelp.frustumCulled = false;
        this.scene.add(kelp);

        // Seagrass tufts
        const blade = new THREE.PlaneGeometry(0.16, 1, 1, 4);
        blade.translate(0, 0.5, 0);
        const tuft = merge([0, 1, 2, 3, 4].map((i) => {
            const g = blade.clone();
            g.rotateY((i / 5) * Math.PI);
            g.translate(Math.sin(i * 2.3) * 0.15, 0, Math.cos(i * 2.3) * 0.15);
            g.scale(1, 0.6 + (i % 3) * 0.3, 1);
            return g;
        }));
        const grassMat = makeSway(new THREE.MeshStandardMaterial({ color: 0x7fbf5a, side: THREE.DoubleSide, roughness: 0.8 }), { axis: 'y', amp: 0.18, freq: 1.6, speed: 1.4, instanced: true });
        const grassN = Math.round(1700 * k);
        const grass = new THREE.InstancedMesh(tuft, grassMat, grassN);
        n = 0;
        for (let i = 0; i < grassN * 3 && n < grassN; i++) {
            const pt = sample((b) => 0.18 + b.reef * 0.3 + b.kelp * 0.2 - b.rock * 0.2 - b.deep);
            if (!pt) continue;
            place(grass, n, pt[0], floorHeight(pt[0], pt[1]) - 0.05, pt[1], between(0.8, 1.7), between(1.2, 3.0));
            grass.setColorAt(n, col.setHex(pick([0x7fbf5a, 0x58a64a, 0xa3cf5a, 0x4f9a6a])));
            n++;
        }
        grass.count = n;
        grass.frustumCulled = false;
        this.scene.add(grass);

        // Corals
        const coralColors = [0xff6f91, 0xff9671, 0xffc75f, 0xd65db1, 0x845ec2, 0x4ffbdf, 0xf9f871, 0xff4f79, 0x00c9a7, 0xffa5d8];
        const coralMat = () => new THREE.MeshStandardMaterial({ vertexColors: false, roughness: 0.65, side: THREE.DoubleSide });
        const kinds = [
            [branchingCoralGeo(3), Math.round(300 * k), 0.9, 2.4, (b) => 0.1 + b.reef * 0.9],
            [branchingCoralGeo(9), Math.round(180 * k), 0.8, 2.0, (b) => 0.06 + b.reef * 0.7],
            [brainCoralGeo(), Math.round(170 * k), 0.8, 2.2, (b) => 0.1 + b.reef * 0.7],
            [tableCoralGeo(), Math.round(90 * k), 1.0, 2.4, (b) => 0.04 + b.reef * 0.6],
            [tubeSpongeGeo(), Math.round(110 * k), 0.7, 1.8, (b) => 0.04 + b.reef * 0.5 + b.rock * 0.1]
        ];
        for (const [geo, N, s0, s1, acc] of kinds) {
            const im = new THREE.InstancedMesh(geo, coralMat(), N);
            n = 0;
            for (let i = 0; i < N * 4 && n < N; i++) {
                const pt = sample((b) => acc(b) - b.deep);
                if (!pt) continue;
                place(im, n, pt[0], floorHeight(pt[0], pt[1]) - 0.1, pt[1], between(s0, s1), between(s0, s1), 0.25);
                im.setColorAt(n, col.setHex(pick(coralColors)));
                n++;
            }
            im.count = n;
            im.castShadow = this.shadows;
            im.frustumCulled = false;
            this.scene.add(im);
        }

        // Sea fans: flat plates with a net pattern, swaying
        const fanTex = canvasTexture(128, 128, (g, w, h) => {
            g.clearRect(0, 0, w, h);
            g.strokeStyle = '#ffffff';
            g.lineWidth = 3;
            for (let i = 0; i < 11; i++) {
                const a = -1.1 + i * 0.22;
                g.beginPath();
                g.moveTo(w / 2, h - 2);
                g.lineTo(w / 2 + Math.sin(a) * w * 0.52, h - Math.cos(a) * h * 0.95);
                g.stroke();
            }
            g.lineWidth = 1.6;
            for (let r = 20; r < 120; r += 14) {
                g.beginPath();
                g.arc(w / 2, h - 2, r, -Math.PI / 2 - 1.15, -Math.PI / 2 + 1.15);
                g.stroke();
            }
        });
        const fanG = new THREE.PlaneGeometry(1.4, 1.4, 4, 4);
        fanG.translate(0, 0.7, 0);
        const fanMat = makeSway(new THREE.MeshStandardMaterial({ map: fanTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.6 }), { axis: 'y', amp: 0.07, freq: 2.5, speed: 1.2, instanced: true });
        const fanN = Math.round(150 * k);
        const fans = new THREE.InstancedMesh(fanG, fanMat, fanN);
        n = 0;
        for (let i = 0; i < fanN * 4 && n < fanN; i++) {
            const pt = sample((b) => 0.05 + b.reef * 0.7 + b.rock * 0.2 - b.deep);
            if (!pt) continue;
            place(fans, n, pt[0], floorHeight(pt[0], pt[1]) - 0.05, pt[1], between(1.0, 2.6), between(1.0, 2.6));
            fans.setColorAt(n, col.setHex(pick([0xff6f91, 0xd65db1, 0xffc75f, 0xff9671, 0x845ec2])));
            n++;
        }
        fans.count = n;
        fans.frustumCulled = false;
        this.scene.add(fans);

        // Anemones
        const anemMat = makeSway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide }), { axis: 'y', amp: 0.22, freq: 5, speed: 1.6, instanced: true });
        const anemN = Math.round(220 * k);
        const anem = new THREE.InstancedMesh(anemoneGeo(), anemMat, anemN);
        n = 0;
        for (let i = 0; i < anemN * 4 && n < anemN; i++) {
            const pt = sample((b) => 0.05 + b.reef * 0.6 - b.deep);
            if (!pt) continue;
            place(anem, n, pt[0], floorHeight(pt[0], pt[1]) - 0.05, pt[1], between(0.9, 2.4), between(0.9, 2.4));
            anem.setColorAt(n, col.setHex(pick([0xff6f91, 0xc56bff, 0x58e0c0, 0xffb347, 0xff8fd0])));
            n++;
        }
        anem.count = n;
        anem.frustumCulled = false;
        this.scene.add(anem);

        // Rocks: noisy blobs, three shapes
        const rockMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: false, vertexColors: false });
        for (let v = 0; v < 3; v++) {
            const geo = noisyGeo(new THREE.IcosahedronGeometry(1, 3), 0.35 + v * 0.1, 1.4 + v * 0.4, v * 11);
            const N = Math.round((v === 0 ? 170 : v === 1 ? 110 : 60) * k);
            const im = new THREE.InstancedMesh(geo, rockMat, N);
            n = 0;
            for (let i = 0; i < N * 4 && n < N; i++) {
                const pt = sample((b) => 0.06 + b.rock * 0.9);
                if (!pt) continue;
                const sc = v === 0 ? between(0.6, 2.6) : v === 1 ? between(2, 5.5) : between(5, 12);
                place(im, n, pt[0], floorHeight(pt[0], pt[1]) + sc * 0.2, pt[1], sc, sc * between(0.55, 0.95), 0.6);
                im.setColorAt(n, col.setHex(pick([0x8d8577, 0x6f6a60, 0x9b8f7a, 0x7a7466, 0x6d7280])));
                n++;
            }
            im.count = n;
            im.castShadow = this.shadows;
            im.receiveShadow = true;
            im.frustumCulled = false;
            this.scene.add(im);
        }

        // Shells, starfish and urchins on the sand
        const shellSpiral = new THREE.InstancedMesh(shellGeo('spiral'), std(0xffffff, { roughness: 0.4 }), Math.round(160 * k));
        const shellFan = new THREE.InstancedMesh(shellGeo('fan'), std(0xffffff, { roughness: 0.35, metalness: 0.1 }), Math.round(180 * k));
        const star = new THREE.InstancedMesh(new THREE.ExtrudeGeometry(starShape(0.28), { depth: 0.07, bevelEnabled: false }).rotateX(-Math.PI / 2), std(0xffffff, { roughness: 0.7 }), Math.round(120 * k));
        const urchinG = merge([new THREE.SphereGeometry(0.16, 8, 6), ...Array.from({ length: 22 }, (_, i) => {
            const c = new THREE.ConeGeometry(0.014, 0.2, 4);
            const a = i * 2.4, e = Math.acos(1 - ((i + 0.5) / 22) * 2);
            const d = new THREE.Vector3(Math.sin(e) * Math.cos(a), Math.cos(e), Math.sin(e) * Math.sin(a));
            c.translate(0, 0.1, 0);
            c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
            return c;
        })]);
        const urchin = new THREE.InstancedMesh(urchinG, std(0xffffff, { roughness: 0.6 }), Math.round(130 * k));
        const smalls = [[shellSpiral, [0xf6e0c8, 0xffc3d2, 0xe8d5f5, 0xcdeccf]], [shellFan, [0xffd1dc, 0xfff0b3, 0xffc4a3, 0xd4f1f9]], [star, [0xff9f43, 0xff6b81, 0xfeca57, 0xff7f50]], [urchin, [0x6c5ce7, 0x2d3436, 0x8e44ad, 0xb33771]]];
        for (const [im, pal] of smalls) {
            n = 0;
            for (let i = 0; i < im.count * 4 && n < im.count; i++) {
                const pt = sample((b) => 0.35 + b.reef * 0.4 - b.deep * 0.4);
                if (!pt) continue;
                place(im, n, pt[0], floorHeight(pt[0], pt[1]) + 0.02, pt[1], between(0.8, 1.9));
                im.setColorAt(n, col.setHex(pick(pal)));
                n++;
            }
            im.count = n;
            im.frustumCulled = false;
            this.scene.add(im);
        }

        // Rock arches and coral spires as landmarks of the seascape
        for (const [x, z, sc, ry] of [[-150, -140, 1.0, 0.6], [175, 60, 1.3, 2.4], [60, -170, 0.9, 1.2], [-190, 20, 1.1, 0.2], [20, 230, 1.2, 0.9]]) {
            const geo = noisyGeo(new THREE.TorusGeometry(8, 3.2, 14, 28, Math.PI), 0.35, 0.35, x);
            const arch = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x7b7568, roughness: 0.95 }));
            arch.position.set(x, floorHeight(x, z) + 0.5, z);
            arch.rotation.y = ry;
            arch.scale.setScalar(sc);
            arch.castShadow = this.shadows;
            this.scene.add(arch);
            this.archPos = this.archPos || [];
            this.archPos.push({ x, z, r: 11 * sc });
        }
    }

    // ---- Time and lighting ------------------------------------------------------------------------
    setTime(t) {
        this.tod = ((t % 1) + 1) % 1;
        const k = sampleKeys(this.tod);
        this.scene.fog.color.copy(k.fog);
        this.baseFogDensity = k.fogDens;
        this.scene.background.copy(k.fog);
        this.hemi.color.copy(k.hemiSky);
        this.hemi.groundColor.copy(k.hemiGround);
        this.hemi.intensity = k.hemiI;
        this.sun.color.copy(k.sun);
        this.sun.intensity = k.sunI;
        this.ambient.intensity = lerp(0.1, 0.22, k.day);
        this.day = k.day;
        this.nightness = clamp(1 - k.day * 1.5, 0, 1);
        this.causticStrength.value = lerp(0.25, 1, k.day);
        this.surfaceUniforms.uDay.value = k.day;
        this.rayMat.opacity = 0.02 + 0.08 * k.day;
        // the sun / moon wanders slowly across the sky
        const a = this.tod * TWO_PI;
        this.sunDir = (this.sunDir || new THREE.Vector3()).set(Math.cos(a) * 70, 60 + Math.sin(a * 0.5) * 40, Math.sin(a * 0.7) * 30 + 20).normalize();
        this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 100);
        this.surfaceUniforms.uSun.value.copy(this.sunDir);
        this._base = { hemi: k.hemiI, sun: k.sunI, amb: this.ambient.intensity, caus: this.causticStrength.value, ray: this.rayMat.opacity, fog: k.fog.clone() };
        for (const g of this.glows) {
            g.mat.emissiveIntensity = g.base + g.night * this.nightness;
        }
        for (const s of this.lampSprites) s.material.opacity = s.userData.base * (0.15 + 0.85 * this.nightness);
    }

    /** Darkness inside the caves (k 0..1): dims every light and the sea itself. Call every frame after setTime. */
    applyCave(k) {
        const b = this._base;
        if (!b) return;
        this._caveK = k;
        this.hemi.intensity = b.hemi * (1 - 0.9 * k);
        this.sun.intensity = b.sun * (1 - 0.9 * k);
        this.ambient.intensity = b.amb * (1 - 0.7 * k);
        this.causticStrength.value = b.caus * (1 - k);
        this.rayMat.opacity = b.ray * (1 - k);
        this.scene.fog.color.copy(b.fog).lerp(_dark, k * 0.9);
        this.scene.background.copy(b.fog).lerp(_dark, k * 0.9);
        this.surface.visible = k < 0.5;
    }

    /** A material whose glow comes up at night. */
    registerGlow(material, base, night) {
        this.glows.push({ mat: material, base, night });
        material.emissiveIntensity = base + night * this.nightness;
    }

    registerLamp(sprite, base = 0.9) {
        sprite.userData.base = base;
        this.lampSprites.push(sprite);
        sprite.material.opacity = base * (0.15 + 0.85 * this.nightness);
    }

    /** Fog gets denser and bluer the deeper you swim. */
    update(dt, camPos, focus) {
        this.time += dt;
        const t = this.time;
        SWAY.time.value = t;
        const depth = clamp(-camPos.y / 40, 0, 1);
        const trenchK = clamp(1 - Math.hypot(camPos.x - TRENCH.x, camPos.z - TRENCH.z) / (TRENCH.r * 1.2), 0, 1) * clamp(-camPos.y / 14, 0, 1);
        this.scene.fog.density = this.baseFogDensity * (1 + depth * 0.8 + trenchK * 2.2) * (1 + (this._caveK || 0) * 1.5);
        this.surfaceUniforms.uCam.value.copy(camPos);
        for (const ray of this.rays) {
            ray.rotation.z = Math.sin(t * 0.15 + ray.userData.phase) * 0.12;
        }
        this.snow.position.copy(camPos);
        // Bubbles rise and wobble, and start again at the vents
        const bp = this.bubbles.geometry.attributes.position;
        for (let i = 0; i < bp.count; i++) {
            let y = bp.getY(i) + dt * (1.2 + (i % 7) * 0.25);
            if (y > SURFACE_Y) {
                const v = this.bubbleVents[i % this.bubbleVents.length];
                bp.setXYZ(i, v[0] + between(-1, 1), floorHeight(v[0], v[1]), v[1] + between(-1, 1));
                continue;
            }
            bp.setY(i, y);
            bp.setX(i, bp.getX(i) + Math.sin(t * 2 + i) * dt * 0.3);
        }
        bp.needsUpdate = true;
        // Shadows follow the player
        if (this.shadows && focus) {
            this.sun.target.position.copy(focus);
            this.sun.position.copy(focus).addScaledVector(this.sunDir, 100);
        }
    }
}

function scene_add(scene, obj) {
    scene.add(obj);
}

function starShape(r) {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * 0.42;
        if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    return s;
}
