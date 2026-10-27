/**
 * js/game/mermaid/mermaidKit.js
 *
 * Small shared helpers for Mermaid World: random / maths, cached materials, canvas textures,
 * value noise, geometry helpers and the shared "water sway" shader hook used by kelp, fins, hair
 * ribbons and anything else that should ripple.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const TWO_PI = Math.PI * 2;
export const rand = Math.random;
export const between = (a, b) => a + rand() * (b - a);
export const pick = (a) => a[Math.floor(rand() * a.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, v) => {
    const t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
};
export const angleDiff = (a, b) => {
    let d = (b - a) % TWO_PI;
    if (d > Math.PI) d -= TWO_PI;
    if (d < -Math.PI) d += TWO_PI;
    return d;
};
export const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
export const lerpColor = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
export const shade = (c, k) => {
    // k < 0 darkens towards black, k > 0 lightens towards white
    return k < 0 ? lerpColor(c, 0x000000, -k) : lerpColor(c, 0xffffff, k);
};

/** Deterministic random numbers (so the world looks the same every trip). */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---- Value noise -------------------------------------------------------------------------------
const _perm = (() => {
    const r = mulberry32(1234);
    const p = new Uint8Array(512);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 256; i++) p[i + 256] = p[i];
    return p;
})();
const _grad = (h, x, y) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);
/** Smooth 2D noise in roughly [-1, 1]. */
export function noise2(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = x * x * x * (x * (x * 6 - 15) + 10), v = y * y * y * (y * (y * 6 - 15) + 10);
    const A = _perm[X] + Y, B = _perm[X + 1] + Y;
    const l = (a, b, t) => a + t * (b - a);
    return l(l(_grad(_perm[A], x, y), _grad(_perm[B], x - 1, y), u), l(_grad(_perm[A + 1], x, y - 1), _grad(_perm[B + 1], x - 1, y - 1), u), v);
}
export function fbm(x, y, oct = 4) {
    let s = 0, a = 0.5, f = 1;
    for (let i = 0; i < oct; i++) {
        s += a * noise2(x * f, y * f);
        a *= 0.5;
        f *= 2;
    }
    return s;
}

// ---- Materials ---------------------------------------------------------------------------------
const _mats = new Map();
/** Cached MeshStandardMaterial: opts { r roughness, m metalness, e emissive intensity (emissive = colour), o opacity, side, flat } */
export function mat(color, opts) {
    opts = opts || {};
    const key = `${color}|${opts.e || 0}|${opts.o ?? 1}|${opts.m ?? 0}|${opts.r ?? 0.6}|${opts.side || 0}|${opts.vc ? 1 : 0}|${opts.warm || 0}`;
    let m = _mats.get(key);
    if (!m) {
        m = new THREE.MeshStandardMaterial({
            color, roughness: opts.r ?? 0.6, metalness: opts.m ?? 0,
            emissive: opts.e ? new THREE.Color(color).lerp(new THREE.Color(0xff9a80), opts.warm || 0) : new THREE.Color(0), emissiveIntensity: opts.e || 0,
            transparent: (opts.o ?? 1) < 1, opacity: opts.o ?? 1, depthWrite: (opts.o ?? 1) >= 1,
            side: opts.side ?? ((opts.o ?? 1) < 1 ? THREE.DoubleSide : THREE.FrontSide),
            vertexColors: !!opts.vc
        });
        _mats.set(key, m);
    }
    return m;
}
/** Uncached material (when a mesh needs its own). */
export function std(color, o = {}) {
    return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.7, metalness: 0.05 }, o));
}
export function mesh(geo, material, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    return m;
}
export function joint(parent, x, y, z) {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    return o;
}

// ---- Canvas textures ---------------------------------------------------------------------------
export function canvasTexture(w, h, draw, opts = {}) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    if (opts.repeat) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(opts.repeat[0], opts.repeat[1]);
    }
    t.anisotropy = opts.aniso || 4;
    return t;
}

export function signTexture(text, bg, fg = '#ffffff', w = 512, h = 128) {
    return canvasTexture(w, h, (g) => {
        const grd = g.createLinearGradient(0, 0, w, h);
        grd.addColorStop(0, bg);
        grd.addColorStop(1, '#ffffff33');
        g.fillStyle = grd;
        g.beginPath();
        g.roundRect(4, 4, w - 8, h - 8, 30);
        g.fill();
        g.strokeStyle = '#ffffffcc';
        g.lineWidth = 6;
        g.stroke();
        g.fillStyle = fg;
        let size = Math.floor(h * 0.48);
        g.font = `bold ${size}px "Trebuchet MS", sans-serif`;
        while (g.measureText(text).width > w - 40 && size > 12) {
            size -= 2;
            g.font = `bold ${size}px "Trebuchet MS", sans-serif`;
        }
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.shadowColor = 'rgba(0,0,0,0.45)';
        g.shadowBlur = 8;
        g.fillText(text, w / 2, h / 2 + 2);
    });
}

export function labelSprite(text, bg = '#0984e3', scale = 5) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(text, bg), transparent: true, depthTest: false, fog: false }));
    s.scale.set(scale, scale / 4, 1);
    s.renderOrder = 10;
    return s;
}

/** A soft round glow sprite texture (shared). */
let _glowTex = null;
export function glowTexture() {
    if (!_glowTex) {
        _glowTex = canvasTexture(64, 64, (g, w, h) => {
            const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
            grd.addColorStop(0, 'rgba(255,255,255,1)');
            grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
            grd.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = grd;
            g.fillRect(0, 0, w, h);
        });
    }
    return _glowTex;
}
export function glowSprite(color, size, opacity = 0.9) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.scale.set(size, size, 1);
    return s;
}

// ---- Geometry ----------------------------------------------------------------------------------
export function merge(list) {
    const g = list.map((x) => (x.index ? x.toNonIndexed() : x));
    for (const x of g) {
        for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) x.deleteAttribute(k);
        if (!x.attributes.uv) x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2));
    }
    return mergeGeometries(g, false);
}
/** Paints every vertex of a geometry one colour (for merged, vertex-coloured props). */
export function paint(geo, color) {
    const c = new THREE.Color(color);
    const n = geo.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return geo;
}
/** Merges geometries that were each painted with paint(). */
export function mergePainted(parts) {
    return merge(parts);
}

/** A star (starfish, topper). */
export function starGeometry(r = 0.05, depth = 0.015) {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * 0.45;
        if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: depth * 0.4, bevelSize: depth * 0.4, bevelSegments: 1 });
    g.translate(0, 0, -depth / 2);
    return g;
}

// ---- Shared sway shader ------------------------------------------------------------------------
/** One uniform for every swaying thing; the world advances it each frame. */
export const SWAY = { time: { value: 0 } };
/**
 * Makes a material ripple: vertices move sideways with a wave that grows with distance from the
 * root (local y or the `axis` given), so kelp, fins and capes flutter.
 *  opts { axis: 'y' | '-y' | 'x', amp, freq, phaseFromInstance, speed }
 */
export function makeSway(material, opts = {}) {
    const amp = (opts.amp ?? 0.2).toFixed(4);
    const freq = (opts.freq ?? 2.2).toFixed(4);
    const speed = (opts.speed ?? 1.1).toFixed(4);
    const axis = opts.axis || 'y';
    const k = axis === 'y' ? 'position.y' : axis === '-y' ? '(-position.y)' : 'abs(position.x)';
    const inst = opts.instanced ? 'instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21' : '0.0';
    material.onBeforeCompile = (sh) => {
        sh.uniforms.uSway = SWAY.time;
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nuniform float uSway;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                float swPh = ${inst};
                float swK = max(${k}, 0.0);
                transformed.x += sin(uSway * ${speed} + swPh + swK * ${freq}) * ${amp} * swK;
                transformed.z += cos(uSway * ${speed} * 0.8 + swPh + swK * ${freq} * 0.7) * ${amp} * 0.7 * swK;`);
    };
    material.customProgramCacheKey = () => `sway|${amp}|${freq}|${speed}|${axis}|${opts.instanced ? 1 : 0}`;
    return material;
}

/** Eases. */
export const easeInOut = (t) => t * t * (3 - 2 * t);
export const easeOut = (t) => 1 - (1 - t) * (1 - t);

/**
 * Collects static pieces and merges them into one mesh per material: add(geometry, material, matrix),
 * then build(parent). Keeps a whole building's worth of boxes and cones down to a few draw calls.
 */
export class Batch {
    constructor() {
        this.groups = new Map();
        this._m = new THREE.Matrix4();
        this._q = new THREE.Quaternion();
        this._e = new THREE.Euler();
        this._s = new THREE.Vector3();
        this._p = new THREE.Vector3();
    }

    /** Places geometry g (not modified) at x,y,z with rotation ry (and rx, rz) and scale sx,sy,sz. */
    add(g, material, x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0) {
        this._e.set(rx, ry, rz, 'YXZ');
        this._q.setFromEuler(this._e);
        this._p.set(x, y, z);
        this._s.set(sx, sy, sz);
        this._m.compose(this._p, this._q, this._s);
        const c = g.clone();
        c.applyMatrix4(this._m);
        let list = this.groups.get(material);
        if (!list) {
            list = [];
            this.groups.set(material, list);
        }
        list.push(c);
        return this;
    }

    build(parent, opts = {}) {
        const out = [];
        for (const [material, list] of this.groups) {
            const geo = list.length === 1 ? list[0] : merge(list);
            const m = new THREE.Mesh(geo, material);
            m.castShadow = opts.cast !== false && !material.transparent;
            m.receiveShadow = !!opts.receive;
            parent.add(m);
            out.push(m);
            for (const l of list) l.dispose();
        }
        this.groups.clear();
        return out;
    }
}

/**
 * Bakes rigid parts together: meshes that hang directly off the same joint and share a material
 * (pearls on a necklace, scales on a belt, a tail segment and its knob) become one mesh. Joints
 * (the things that animate) are untouched. Skips swaying materials, tagged meshes and instances.
 */
export function mergeStatic(root) {
    let removed = 0;
    root.updateMatrixWorld(true);
    const nodes = [];
    root.traverse((o) => nodes.push(o));
    for (const node of nodes) {
        const groups = new Map();
        for (const c of node.children) {
            if (!c.isMesh || c.isInstancedMesh || c.children.length || Object.keys(c.userData).length) continue;
            if (Array.isArray(c.material) || c.material.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey) continue;
            const g = c.geometry;
            const sig = Object.keys(g.attributes).sort().join(',') + (g.index ? 'i' : '');
            const key = c.material.uuid + '|' + sig + '|' + (c.castShadow ? 1 : 0) + (c.visible ? 1 : 0);
            let list = groups.get(key);
            if (!list) groups.set(key, (list = []));
            list.push(c);
        }
        for (const list of groups.values()) {
            if (list.length < 2) continue;
            const geos = list.map((m) => {
                m.updateMatrix();
                const g = m.geometry.clone();
                g.applyMatrix4(m.matrix);
                return g;
            });
            let merged;
            try {
                merged = merge(geos);
            } catch (e) {
                continue;
            }
            if (!merged) continue;
            const m0 = list[0];
            const out = new THREE.Mesh(merged, m0.material);
            out.castShadow = m0.castShadow;
            out.receiveShadow = m0.receiveShadow;
            out.visible = m0.visible;
            node.add(out);
            for (const m of list) node.remove(m);
            removed += list.length - 1;
        }
    }
    return removed;
}
