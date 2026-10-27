/**
 * js/game/mermaid/mermaidHair.js
 *
 * Hair for the mermaids: a hairline-shaped skull cap, a swinging curtain behind the head, and
 * ribbons of strands (flat crossed quads with a streaked alpha texture and a colour gradient from
 * the roots to the tips) that drift in the water. Twelve styles; ombre tips and highlights.
 */

import * as THREE from 'three';
import { mat, mesh, joint, lerpColor, shade, canvasTexture, mulberry32, lerp } from './mermaidKit.js';

export const HEAD_R = 0.125;
export const HEAD_S = [0.93, 1.08, 0.98];

const PI = Math.PI;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

let _strandTex = null;
/** Streaks of hair, fading out at the sides so ribbons look like strands, not paper. */
function strandTexture() {
    if (_strandTex) return _strandTex;
    const rnd = mulberry32(8);
    _strandTex = canvasTexture(128, 256, (g, w, h) => {
        g.clearRect(0, 0, w, h);
        for (let x = 0; x < w; x++) {
            const u = x / (w - 1);
            const edge = Math.min(1, Math.min(u, 1 - u) / 0.14);
            const streak = 0.72 + 0.28 * Math.sin(x * 1.7 + rnd() * 2) * Math.sin(x * 0.31);
            const a = Math.max(0, edge * (0.6 + 0.4 * rnd()));
            const v = Math.round(255 * Math.min(1, streak));
            g.fillStyle = `rgba(${v},${v},${v},${a > 0.5 ? 1 : a * 1.4})`;
            g.fillRect(x, 0, 1, h);
        }
        // the odd lighter stripe, like light catching a lock
        for (let i = 0; i < 5; i++) {
            g.fillStyle = 'rgba(255,255,255,0.22)';
            g.fillRect(12 + rnd() * (w - 24), 0, 2 + rnd() * 3, h);
        }
    });
    _strandTex.wrapS = _strandTex.wrapT = THREE.RepeatWrapping;
    return _strandTex;
}

let _strandMat = null;
function strandMaterial() {
    if (!_strandMat) {
        _strandMat = new THREE.MeshStandardMaterial({
            map: strandTexture(), vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.38, metalness: 0.06
        });
    }
    return _strandMat;
}
let _capMat = null;
function capMaterial() {
    if (!_capMat) _capMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.06, side: THREE.DoubleSide });
    return _capMat;
}

/** One tapering ribbon segment (two crossed quads), coloured top to bottom. */
function ribbonGeo(w0, w1, len, c0, c1, v0 = 0, crossed = true) {
    const pos = [], col = [], uv = [], idx = [];
    const a = new THREE.Color(c0), b = new THREE.Color(c1);
    const quads = crossed ? [0, 1.1] : [0];
    quads.forEach((ang, qi) => {
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const o = pos.length / 3;
        const vTop = v0, vBot = v0 + len * 4;
        for (const [x, y, c, v] of [[-w0, 0, a, vTop], [w0, 0, a, vTop], [-w1, -len, b, vBot], [w1, -len, b, vBot]]) {
            pos.push(x * ca, y, x * sa);
            col.push(c.r, c.g, c.b);
            uv.push(x < 0 ? 0 : 1, v);
        }
        idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
        void qi;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
}

/** A hanging chain of ribbon segments; returns its joints (they swing in animateMermaid). */
function chain(parent, o) {
    const joints = [];
    let p = joint(parent, o.x, o.y, o.z);
    p.rotation.z = o.angle || 0;
    p.rotation.x = o.pitch || 0;
    const m = strandMaterial();
    for (let i = 0; i < o.n; i++) {
        const k0 = i / o.n, k1 = (i + 1) / o.n;
        const w0 = lerp(o.w0, o.w1, k0), w1 = lerp(o.w0, o.w1, k1);
        const c0 = lerpColor(o.c0, o.c1, Math.pow(k0, 1.15)), c1 = lerpColor(o.c0, o.c1, Math.pow(k1, 1.15));
        const seg = new THREE.Mesh(ribbonGeo(w0, w1, o.len, c0, c1, i * 0.37 + (o.seed || 0), o.crossed !== false), m);
        seg.castShadow = false;
        p.add(seg);
        joints.push(p);
        const nx = joint(p, 0, -o.len, 0);
        if (o.wave) nx.rotation.z = (i % 2 ? 1 : -1) * o.wave;
        p = nx;
    }
    return joints;
}

/** A skull cap with a hairline: theta limits (radians from the crown) at the front, sides and back. */
function capGeo(front, side, back, top, bottom, radius, wseg = 44, hseg = 16) {
    const S = HEAD_S;
    const pos = [], col = [], idx = [];
    const ct = new THREE.Color(top), cb = new THREE.Color(bottom), c = new THREE.Color();
    for (let iy = 0; iy <= hseg; iy++) {
        const t = iy / hseg;
        for (let ix = 0; ix <= wseg; ix++) {
            const az = (ix / wseg) * PI * 2;
            const a = Math.abs(((az + PI) % (PI * 2)) - PI); // 0 at the front, PI at the back
            const lim = a < PI / 2 ? lerp(front, side, a / (PI / 2)) : lerp(side, back, (a - PI / 2) / (PI / 2));
            const theta = t * lim;
            const r = radius * (1 + 0.035 * Math.sin(Math.min(1, t * 1.5) * PI));
            pos.push(Math.sin(theta) * Math.sin(az) * r * S[0], Math.cos(theta) * r * S[1], Math.sin(theta) * Math.cos(az) * r * S[2]);
            c.copy(ct).lerp(cb, Math.pow(t, 1.3));
            col.push(c.r, c.g, c.b);
        }
    }
    for (let iy = 0; iy < hseg; iy++) {
        for (let ix = 0; ix < wseg; ix++) {
            const a = iy * (wseg + 1) + ix, b = a + 1, c2 = a + wseg + 1, d = c2 + 1;
            idx.push(a, c2, b, b, c2, d);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
}

/** The curtain of hair behind the head: part of a cylinder, coloured root to tip, hung from a swinging joint. */
function massGeo(rTop, rBot, len, arc, top, tip, taperTo = 1) {
    const g = new THREE.CylinderGeometry(rTop, rBot, len, 28, 8, true, PI - arc / 2, arc);
    g.translate(0, -len / 2, 0);
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    const ct = new THREE.Color(top), cb = new THREE.Color(tip), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
        const t = clamp01(-p.getY(i) / len);   // (a tiny negative here made a NaN colour, which blacked out the bloom)
        c.copy(ct).lerp(cb, Math.pow(t, 1.2));
        col.set([c.r, c.g, c.b], i * 3);
        if (taperTo !== 1) {
            // narrow towards the ends so the tips feel like strands
            const k = lerp(1, taperTo, t);
            p.setX(i, p.getX(i) * k);
        }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
}

function ball(parent, r, color, x, y, z, opts, sx = 1, sy = 1, sz = 1) {
    const m = mesh(new THREE.SphereGeometry(r, 14, 10), mat(color, opts), x, y, z);
    m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
}

/** Builds hair into hc (the head-centre group); strands that should drift are pushed onto flow. */
export function buildHair(look, hc, flow) {
    const base = look.hairColor, tip = look.hairTip != null ? look.hairTip : base;
    const style = look.hairStyle;
    const ombre = look.hairTip != null;
    const root = shade(base, -0.05);
    const mid = ombre ? lerpColor(base, tip, 0.3) : base;
    const capOf = (front, side, back, r = HEAD_R * 1.055, top = root, bottom = mid) => {
        const m = new THREE.Mesh(capGeo(front, side, back, top, bottom, r), capMaterial());
        hc.add(m);
        return m;
    };
    const bangs = (n = 5, spread = 0.1, y = 0.1) => {
        for (let i = 0; i < n; i++) {
            const k = n === 1 ? 0 : i / (n - 1) - 0.5;
            const b = ball(hc, 0.05, lerpColor(base, shade(base, -0.1), Math.abs(k)), k * spread * 2.2 + 0.012, y - Math.abs(k) * 0.03 + 0.006, 0.098 - Math.abs(k) * 0.03, { r: 0.4 }, 1.35, 0.62, 0.55);
            b.rotation.z = -k * 0.9;
        }
    };
    const mass = (rTop, rBot, len, arc, y, z, taper = 0.7, sway = true) => {
        const j = joint(hc, 0, y, z);
        const m = new THREE.Mesh(massGeo(rTop, rBot, len, arc, root, tip, taper), strandMaterial());
        // the curtain is open at the front: nudge it back so the neck shows through
        j.add(m);
        if (sway) flow.push(j);
        return j;
    };

    if (style === 'long' || style === 'wavy') {
        capOf(0.34 * PI, 0.66 * PI, 0.8 * PI);
        bangs();
        const wave = style === 'wavy' ? 0.26 : 0.025;
        mass(0.135, style === 'wavy' ? 0.23 : 0.2, 0.36, PI * 1.6, -0.01, -0.01, 0.85);
        mass(0.128, style === 'wavy' ? 0.19 : 0.16, 0.26, PI * 1.3, -0.02, -0.03, 0.8);
        for (let i = -2; i <= 2; i++) {
            flow.push(...chain(hc, { x: i * 0.055, y: -0.2, z: -0.125 - Math.abs(i) * 0.004, n: 4, len: 0.1, w0: 0.048, w1: 0.026, c0: lerpColor(base, tip, 0.35), c1: tip, wave, angle: i * 0.03, seed: i * 0.13 }));
        }
        for (const s of [-1, 1]) for (let i = 0; i < 3; i++) flow.push(...chain(hc, { x: s * (0.112 + i * 0.016), y: 0.03 - i * 0.01, z: 0.05 - i * 0.03, n: 5, len: 0.085, w0: 0.034, w1: 0.018, c0: base, c1: tip, wave: wave * 0.8, angle: s * (0.05 + i * 0.04), seed: s * 0.2 + i * 0.4 }));
    } else if (style === 'ponytail') {
        capOf(0.34 * PI, 0.62 * PI, 0.7 * PI);
        bangs(5, 0.09, 0.105);
        ball(hc, 0.032, look.topColor, 0, 0.14, -0.118, { r: 0.4 });
        for (let i = -1; i <= 1; i++) flow.push(...chain(hc, { x: i * 0.02, y: 0.14, z: -0.12, n: 7, len: 0.095, w0: 0.065, w1: 0.03, c0: base, c1: tip, wave: 0.1, pitch: 0.5, angle: i * 0.1, seed: i * 0.3 }));
    } else if (style === 'bun') {
        capOf(0.34 * PI, 0.6 * PI, 0.66 * PI);
        bangs(5, 0.09, 0.105);
        ball(hc, 0.088, base, 0, 0.17, -0.03, { r: 0.4 }, 1.05, 0.95, 1.05);
        const t = mesh(new THREE.TorusGeometry(0.07, 0.014, 6, 20), mat(look.topColor, { r: 0.4 }), 0, 0.12, -0.03);
        t.rotation.x = PI / 2;
        hc.add(t);
    } else if (style === 'spacebuns') {
        capOf(0.34 * PI, 0.6 * PI, 0.66 * PI);
        bangs(5, 0.09, 0.105);
        for (const s of [-1, 1]) {
            ball(hc, 0.07, lerpColor(base, tip, 0.2), s * 0.092, 0.145, -0.015, { r: 0.4 });
            const t = mesh(new THREE.TorusGeometry(0.052, 0.012, 6, 18), mat(look.topColor, { r: 0.4 }), s * 0.082, 0.12, -0.012);
            t.rotation.z = s * 0.8;
            hc.add(t);
        }
    } else if (style === 'pigtails') {
        capOf(0.34 * PI, 0.62 * PI, 0.72 * PI);
        bangs(5, 0.09, 0.105);
        for (const s of [-1, 1]) {
            ball(hc, 0.026, look.topColor, s * 0.118, 0.085, -0.03, { r: 0.4 });
            for (let i = -1; i <= 1; i++) flow.push(...chain(hc, { x: s * 0.124 + i * 0.012, y: 0.08, z: -0.03, n: 6, len: 0.08, w0: 0.045, w1: 0.022, c0: base, c1: tip, wave: 0.15, angle: s * 0.2 + i * 0.05, seed: i * 0.3 }));
        }
    } else if (style === 'bob') {
        capOf(0.34 * PI, 0.78 * PI, 0.82 * PI, HEAD_R * 1.13);
        bangs();
        mass(0.13, 0.15, 0.08, PI * 1.5, -0.06, -0.01, 0.9, false);
    } else if (style === 'braid' || style === 'sidebraid') {
        capOf(0.34 * PI, 0.62 * PI, 0.75 * PI);
        bangs(5, 0.09, 0.105);
        const side = style === 'sidebraid';
        const ox = side ? -0.095 : 0, oz = side ? 0.06 : -0.115, oy = side ? 0.04 : 0.02;
        let p = joint(hc, ox, oy, oz);
        for (let i = 0; i < 9; i++) {
            const col = lerpColor(base, tip, i / 9);
            const sc = 1 - i * 0.05;
            ball(p, 0.04 * sc, col, 0.017, -0.035, 0, { r: 0.42 }, 1, 1.15, 1);
            ball(p, 0.04 * sc, shade(col, -0.08), -0.017, -0.06, 0, { r: 0.42 }, 1, 1.15, 1);
            flow.push(p);
            p = joint(p, 0, -0.08, 0);
        }
        ball(p, 0.022, look.topColor, 0, 0, 0, { r: 0.4 });
    } else if (style === 'pixie') {
        capOf(0.3 * PI, 0.5 * PI, 0.58 * PI, HEAD_R * 1.05);
        const cone = (r, h, c) => new THREE.Mesh(new THREE.CylinderGeometry(0, r, h, 6), mat(c, { r: 0.45 }));
        for (let i = 0; i < 9; i++) {
            const k = i / 8 - 0.5;
            const c = cone(0.026, 0.09, lerpColor(base, tip, 0.4 + Math.abs(k)));
            c.position.set(k * 0.19, 0.125 - Math.abs(k) * 0.05, 0.085 - Math.abs(k) * 0.02);
            c.rotation.set(0.9, 0, -k * 1.5);
            hc.add(c);
        }
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * PI * 2;
            const c = cone(0.03, 0.08, base);
            c.position.set(Math.sin(a) * 0.075, 0.14, Math.cos(a) * 0.075 - 0.02);
            c.rotation.set(Math.cos(a) * 0.8, 0, -Math.sin(a) * 0.8);
            hc.add(c);
        }
    } else if (style === 'curly') {
        capOf(0.34 * PI, 0.6 * PI, 0.7 * PI);
        bangs(4, 0.1, 0.11);
        const rnd = mulberry32(21);
        for (let i = 0; i < 34; i++) {
            const a = rnd() * PI * 2, e = 0.2 + rnd() * 1.3;
            const r = 0.12 + rnd() * 0.03;
            ball(hc, 0.045 + rnd() * 0.025, lerpColor(base, tip, rnd() * 0.5), Math.sin(a) * Math.sin(e) * r * 1.1, Math.cos(e) * r + 0.02, Math.cos(a) * Math.sin(e) * r * 1.05 - 0.02, { r: 0.45 });
        }
        for (const s of [-1, 1]) {
            for (let i = 0; i < 5; i++) {
                const b = joint(hc, s * (0.125 + (i % 2) * 0.025), -0.02 - i * 0.065, -0.03);
                ball(b, 0.05 - i * 0.004, lerpColor(base, tip, i / 4), 0, 0, 0, { r: 0.45 });
                flow.push(b);
            }
        }
    } else if (style === 'crest') {
        capOf(0.3 * PI, 0.5 * PI, 0.6 * PI, HEAD_R * 1.05, shade(base, -0.2), base);
        for (let i = 0; i < 9; i++) {
            const t = i / 8;
            const ang = lerp(0.35, 2.9, t);   // from the forehead over the crown to the nape
            const r = HEAD_R * 1.05;
            const h = 0.12 * Math.sin(t * PI) + 0.04;
            const c = new THREE.Mesh(new THREE.CylinderGeometry(0, 0.05, h, 4), mat(lerpColor(base, tip, t), { r: 0.35, e: 0.12 }));
            c.scale.x = 0.25;
            c.position.set(0, Math.cos(ang) * r * 1.08 + 0.02, Math.sin(ang) * r - 0.005);
            c.rotation.x = ang - PI / 2;
            hc.add(c);
        }
        flow.push(...chain(hc, { x: 0, y: 0.0, z: -0.125, n: 4, len: 0.09, w0: 0.04, w1: 0.02, c0: base, c1: tip, seed: 0.5 }));
    } else {
        capOf(0.34 * PI, 0.66 * PI, 0.8 * PI);
        bangs();
    }
    if (look.highlights && !['pixie', 'crest'].includes(style)) {
        for (let i = 0; i < 4; i++) {
            const a = -0.8 + i * 0.55;
            const s = mesh(new THREE.SphereGeometry(0.012, 6, 4), mat(shade(base, 0.45), { r: 0.3, e: 0.15 }), Math.sin(a) * 0.12, 0.08, Math.cos(a) * 0.12);
            s.scale.set(0.7, 5, 0.5);
            s.rotation.z = -a * 0.5;
            hc.add(s);
        }
    }
}
