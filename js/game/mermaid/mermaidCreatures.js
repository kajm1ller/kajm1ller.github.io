/**
 * js/game/mermaid/mermaidCreatures.js
 *
 * The animals of Mermaid World. Each builder returns a THREE.Group facing +Z whose
 * userData.update(t, speed) animates it (speed 0..1: how hard it is swimming), so the world can
 * move any of them the same way:
 *   buildFish(...)          clownfish, angelfish, tang, grouper, lanternfish, generic reef fish
 *   buildDolphin / buildTurtle / buildManta / buildJelly / buildOctopus / buildSeahorse
 *   buildCrab / buildShark / buildWhale / buildPuffer / buildAngler
 * plus schoolFishGeometry() for the instanced schools.
 */

import * as THREE from 'three';
import { mat, mesh, joint, lerpColor, shade, glowSprite, makeSway, canvasTexture, mulberry32, lerp, clamp, SWAY, merge } from './mermaidKit.js';
import { panelTexture } from './mermaidFace.js';

const sphereG = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);

// ---- Shared pieces -----------------------------------------------------------------------------
/**
 * A body of revolution along z (nose at +z), coloured per vertex by colorFn(t, up, side, v)
 * where t is 0 at the nose and 1 at the tail, up is -1 (belly) to 1 (back).
 */
function lathedBody(L, R, profile, colorFn, sx = 1, sy = 1, rad = 28, seg = 24) {
    const pts = [];
    for (let i = 0; i <= seg; i++) {
        const t = i / seg;
        pts.push(new THREE.Vector2(Math.max(0.0001, profile(t) * R), (0.5 - t) * L));
    }
    const g = new THREE.LatheGeometry(pts, rad);
    g.rotateX(Math.PI / 2);
    g.scale(sx, sy, 1);
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const t = 0.5 - z / L;
        const rr = Math.max(1e-4, profile(clamp(t, 0, 1)) * R * sy);
        c.set(colorFn(clamp(t, 0, 1), clamp(y / rr, -1, 1), x / Math.max(1e-4, profile(clamp(t, 0, 1)) * R * sx), z));
        col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
}

const bodyMat = (o = {}) => new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.38, metalness: 0.08 }, o));

/** A fin plane hanging from its top edge (use rotation to place it). */
function finPlane(kind, a, b, w, h, sway = 0.15, freq = 3) {
    const g = new THREE.PlaneGeometry(1, 1, 5, 8);
    g.translate(0, -0.5, 0);
    const m = new THREE.Mesh(g, makeSway(new THREE.MeshStandardMaterial({
        map: panelTexture(kind, a, b), transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.05, roughness: 0.35
    }), { axis: '-y', amp: sway, freq, speed: 2.4 }));
    m.scale.set(w, h, 1);
    return m;
}

function eyes(parent, r, x, y, z, color = 0xffffff, pupil = 0x101018) {
    for (const s of [-1, 1]) {
        const e = mesh(sphereG(r, 12, 10), mat(color, { r: 0.2 }), s * x, y, z);
        parent.add(e);
        const p = mesh(sphereG(r * 0.62, 10, 8), mat(pupil, { r: 0.1 }), s * (x + r * 0.35), y, z + r * 0.18);
        parent.add(p);
        const h = mesh(sphereG(r * 0.2, 6, 5), mat(0xffffff, { e: 1 }), s * (x + r * 0.5), y + r * 0.25, z + r * 0.58);
        parent.add(h);
    }
}

// ================================================================================================
// Fish
// ================================================================================================
const FISH_STYLES = {
    clown: { len: 1.0, h: 0.34, w: 0.26, dorsal: 'fin_classic', tail: 'fin_fan' },
    angel: { len: 0.9, h: 0.62, w: 0.12, dorsal: 'cape_fin', tail: 'fin_classic' },
    tang: { len: 1.0, h: 0.46, w: 0.14, dorsal: 'fin_classic', tail: 'fin_double' },
    grouper: { len: 1.25, h: 0.46, w: 0.4, dorsal: 'fin_ruffle', tail: 'fin_fan' },
    lantern: { len: 1.0, h: 0.36, w: 0.3, dorsal: 'fin_classic', tail: 'fin_classic' },
    reef: { len: 1.0, h: 0.4, w: 0.2, dorsal: 'fin_classic', tail: 'fin_classic' }
};

/**
 * @param {number} color body colour, @param {number} stripe second colour
 * @param {number} size overall scale, @param {boolean} glow bioluminescent (lanternfish)
 * @param {'clown'|'angel'|'tang'|'grouper'|'lantern'|'reef'} kind
 */
export function buildFish(color, stripe = 0xffffff, size = 1, glow = false, kind = 'reef') {
    const S = FISH_STYLES[kind] || FISH_STYLES.reef;
    const g = new THREE.Group();
    const L = S.len * size * 0.9;
    const colorFn = (t, up, side) => {
        let c = lerpColor(color, shade(color, 0.35), clamp(-up * 0.6 + 0.3, 0, 1) * 0.55);
        c = lerpColor(c, shade(color, -0.25), clamp(up, 0, 1) * 0.5);
        if (kind === 'clown') {
            for (const [a, b] of [[0.2, 0.3], [0.5, 0.58], [0.83, 0.87]]) {
                if (t > a - 0.02 && t < b + 0.02) c = (t > a && t < b) ? stripe : shade(0x111111, 0.05);
            }
        } else if (kind === 'angel') {
            const band = Math.abs(((t * 5.2) % 1) - 0.5);
            if (band < 0.12 && t > 0.15 && t < 0.9) c = lerpColor(c, stripe, 0.85);
        } else if (kind === 'tang') {
            if (t > 0.25 && t < 0.78 && up > -0.2 && Math.abs(up - 0.1 - Math.sin(t * 9) * 0.25) < 0.22) c = lerpColor(c, 0x0b1a4a, 0.9);
            if (t > 0.88) c = stripe;
        } else if (kind === 'grouper') {
            const n = Math.sin(t * 26 + up * 5) * Math.sin(t * 17 - side * 4);
            if (n > 0.35) c = lerpColor(c, stripe, 0.7);
        } else if (kind === 'lantern') {
            if (up < -0.35 && Math.sin(t * 55) > 0.82) c = 0x9ff4ff;
        } else if (stripe !== 0xffffff) {
            if (Math.sin(t * 14) > 0.7) c = lerpColor(c, stripe, 0.6);
        }
        return c;
    };
    const prof = (t) => Math.pow(Math.sin(Math.pow(t, 0.72) * Math.PI), 0.8) * (1 - 0.58 * smoothstep(0.62, 1, t)) * 0.5 + 0.02;
    const body = new THREE.Mesh(lathedBody(L, 1, prof, colorFn, S.w * size / (L * 0.5) * 0.5, S.h * size / (L * 0.5) * 0.5), bodyMat());
    body.scale.set(1, 1, 1);
    g.add(body);
    // Fins
    const fa = color, fb = kind === 'clown' ? 0x151515 : shade(stripe === 0xffffff ? color : stripe, kind === 'angel' ? 0.1 : -0.1);
    const tailJ = joint(g, 0, 0, -L * 0.46);
    const tail = finPlane(S.tail, fa, fb, S.h * size * 0.9, L * 0.34, 0.12, 4);
    tail.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    tailJ.add(tail);
    const dorsal = finPlane(S.dorsal, fa, fb, L * (kind === 'angel' ? 0.34 : 0.52), S.h * size * (kind === 'angel' ? 0.95 : 0.5), 0.08, 3);
    dorsal.rotation.set(0, Math.PI / 2, Math.PI);
    dorsal.position.set(0, S.h * size * 0.45, -L * 0.02);
    g.add(dorsal);
    if (kind === 'angel') {
        const anal = finPlane('cape_fin', fa, fb, L * 0.3, S.h * size * 0.9, 0.08, 3);
        anal.rotation.set(0, Math.PI / 2, 0);
        anal.position.set(0, -S.h * size * 0.42, -L * 0.04);
        g.add(anal);
    }
    const pecs = [];
    for (const s of [-1, 1]) {
        const p = finPlane('ear', fa, fb, L * 0.2, L * 0.2, 0.1, 3);
        const pj = joint(g, s * S.w * size * 0.46, -S.h * size * 0.08, L * 0.12);
        p.rotation.set(0, s * 1.2, s * 1.3);
        pj.add(p);
        pecs.push([pj, s]);
    }
    eyes(g, 0.05 * size * (kind === 'grouper' ? 1.15 : 1), S.w * size * 0.4, S.h * size * 0.1, L * 0.34);
    // Lips
    const lip = mesh(sphereG(0.06 * size, 8, 6), mat(shade(color, -0.1), { r: 0.4 }), 0, -S.h * size * 0.08, L * 0.5);
    lip.scale.set(1.0 + (kind === 'grouper' ? 1 : 0), 0.7, 0.8);
    g.add(lip);
    if (glow || kind === 'lantern') {
        const lure = mesh(sphereG(0.06 * size, 10, 8), mat(0x48dbfb, { e: 2.5 }), 0, S.h * size * 0.95, L * 0.4);
        g.add(lure);
        const stalk = mesh(new THREE.CylinderGeometry(0.006 * size, 0.01 * size, 0.4 * size, 4), mat(shade(color, 0.1)), 0, S.h * size * 0.7, L * 0.3);
        stalk.rotation.x = 0.7;
        g.add(stalk);
        const gs = glowSprite(0x48dbfb, 1.4 * size, 0.7);
        gs.position.copy(lure.position);
        g.add(gs);
    }
    g.userData.kind = 'fish';
    g.userData.update = (t, speed = 0.3) => {
        tailJ.rotation.y = Math.sin(t * (4 + speed * 6)) * (0.35 + speed * 0.25);
        g.rotation.z = Math.sin(t * 2) * 0.03;
        for (const [pj, s] of pecs) pj.rotation.y = Math.sin(t * 5 + s) * 0.25;
    };
    g.userData.tail = tailJ;
    return g;
}

function smoothstep(a, b, v) {
    const t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
}

/** Builds a talking fish from its TALKING_FISH entry. */
export function buildTalkingFish(d) {
    const s = d.size * 1.6;
    switch (d.id) {
        case 'bubbles': return buildFish(0xff7f27, 0xffffff, s, false, 'clown');
        case 'sage': return buildFish(0x7b7a5c, 0xb6b38a, s, false, 'grouper');
        case 'zip': return buildFish(0xf9e79f, 0x2e86c1, s, false, 'angel');
        case 'dory': return buildFish(0x2874f0, 0xf4d03f, s, false, 'tang');
        case 'luna': return buildFish(0x34495e, 0x48dbfb, s, true, 'lantern');
        case 'puff': return buildPuffer(s * 0.85, 0.5);
        case 'dolph': return buildDolphin(s * 0.8);
        case 'tilda': return buildTurtle(s * 0.9, 0x6ab04c);
        default: return buildFish(d.color, d.stripe, s, !!d.glow, 'reef');
    }
}

// ================================================================================================
// Pufferfish
// ================================================================================================
export function buildPuffer(size = 1, inflate = 0.4) {
    const g = new THREE.Group();
    const R = 0.34 * size;
    const bodyG = new THREE.SphereGeometry(R, 28, 20);
    const p = bodyG.attributes.position;
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
        const y = p.getY(i) / R, z = p.getZ(i) / R, x = p.getX(i) / R;
        c.set(lerpColor(0xe9d8a6, 0xfff7dc, clamp(-y, 0, 1)));
        if (y > 0.2) c.lerp(new THREE.Color(0x94795d), clamp((y - 0.2) * 1.2, 0, 0.8));
        if (y > 0.3 && Math.sin(x * 14) * Math.sin(z * 12) > 0.5) c.set(0x5d4a36);
        col.set([c.r, c.g, c.b], i * 3);
    }
    bodyG.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const body = new THREE.Mesh(bodyG, bodyMat({ roughness: 0.55 }));
    body.scale.set(1, 0.9, 1.05);
    const inner = joint(g, 0, 0, 0);
    inner.add(body);
    // spikes
    const spike = new THREE.ConeGeometry(0.016 * size, 0.09 * size, 5);
    const sm = mat(0xdcc9a0, { r: 0.6 });
    const rnd = mulberry32(4);
    const spikes = [];
    for (let i = 0; i < 70; i++) {
        const a = rnd() * Math.PI * 2, e = Math.acos(1 - 2 * rnd());
        const dir = new THREE.Vector3(Math.sin(e) * Math.cos(a), Math.cos(e), Math.sin(e) * Math.sin(a));
        if (dir.z > 0.7 && Math.abs(dir.x) < 0.5) continue; // not on the face
        const s = new THREE.Mesh(spike, sm);
        s.position.copy(dir).multiplyScalar(R * 0.98);
        s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        inner.add(s);
        spikes.push(s);
    }
    eyes(inner, 0.085 * size, R * 0.5, R * 0.28, R * 0.78);
    const mouth = mesh(sphereG(0.05 * size, 8, 6), mat(0xd9a89a, { r: 0.5 }), 0, -R * 0.12, R * 1.0);
    mouth.scale.set(1, 0.6, 0.7);
    inner.add(mouth);
    const tailJ = joint(g, 0, 0, -R * 0.95);
    const tail = finPlane('fin_fan', 0xe9d8a6, 0x94795d, 0.34 * size, 0.3 * size, 0.1, 4);
    tail.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    tailJ.add(tail);
    const fins = [];
    for (const s of [-1, 1]) {
        const j = joint(inner, s * R * 0.95, -R * 0.05, R * 0.1);
        const f = finPlane('ear', 0xe9d8a6, 0xbfa77a, 0.2 * size, 0.2 * size, 0.1, 3);
        f.rotation.set(0, s * 1.2, s * 1.4);
        j.add(f);
        fins.push([j, s]);
    }
    g.userData.inflate = inflate;
    g.userData.setInflate = (k) => {
        g.userData.inflate = k;
        inner.scale.setScalar(0.85 + k * 0.5);
        for (const s of spikes) s.visible = k > 0.15;
    };
    g.userData.setInflate(inflate);
    g.userData.update = (t, speed = 0.2) => {
        tailJ.rotation.y = Math.sin(t * 6) * 0.35;
        for (const [j, s] of fins) j.rotation.z = Math.sin(t * 9 + s) * 0.3;
    };
    g.userData.tail = tailJ;
    return g;
}

// ================================================================================================
// Dolphin, shark, whale: streamlined bodies
// ================================================================================================
function streamlined(L, R, top, belly, opts = {}) {
    const prof = opts.profile || ((t) => Math.pow(Math.sin(Math.pow(t, 0.65) * Math.PI * 0.98), 0.85) * (1 - 0.7 * smoothstep(0.55, 1, t)) * 0.5 + 0.02);
    const colorFn = (t, up) => {
        const split = opts.split ?? 0.05;
        const k = smoothstep(split - 0.12, split + 0.12, up);
        let c = lerpColor(belly, top, k);
        if (opts.extra) c = opts.extra(t, up, c) ?? c;
        return c;
    };
    return new THREE.Mesh(lathedBody(L, R, prof, colorFn, opts.sx ?? 1, opts.sy ?? 1, 30, 30), bodyMat({ roughness: opts.rough ?? 0.35, metalness: 0.04 }));
}

export function buildDolphin(size = 1) {
    const g = new THREE.Group();
    const L = 2.4 * size, R = 0.62 * size;
    const root = joint(g, 0, 0, 0);
    root.add(streamlined(L, R, 0x7f8fa6, 0xf3f6fa, { sx: 0.78, sy: 0.9, split: 0.1 }));
    // beak
    const beak = mesh(new THREE.CylinderGeometry(0.06 * size, 0.1 * size, 0.38 * size, 12), mat(0x95a3b8, { r: 0.4 }), 0, -0.05 * size, L * 0.52);
    beak.rotation.x = Math.PI / 2;
    root.add(beak);
    eyes(root, 0.045 * size, 0.2 * size, 0.1 * size, L * 0.32, 0xf5f5f5);
    const dorsal = finPlane('cape_fin', 0x6c7a90, 0x4c5a70, 0.34 * size, 0.42 * size, 0.04, 2);
    dorsal.rotation.set(0, Math.PI / 2, Math.PI);
    dorsal.position.set(0, R * 0.78, -L * 0.04);
    root.add(dorsal);
    const flips = [];
    for (const s of [-1, 1]) {
        const j = joint(root, s * R * 0.7, -R * 0.35, L * 0.2);
        const f = finPlane('cape_fin', 0x7f8fa6, 0x5a6a80, 0.34 * size, 0.5 * size, 0.04, 2);
        f.rotation.set(0.3, s * 0.2, s * 1.35);
        j.add(f);
        flips.push([j, s]);
    }
    const tailJ = joint(root, 0, 0, -L * 0.45);
    const fluke = finPlane('fin_whale', 0x6c7a90, 0xa7b4c8, 0.9 * size, 0.55 * size, 0.1, 3);
    fluke.rotation.x = Math.PI / 2;
    tailJ.add(fluke);
    g.userData.update = (t, speed = 0.4) => {
        const f = 3 + speed * 4;
        root.rotation.x = Math.sin(t * f) * 0.06 * (0.5 + speed);
        tailJ.rotation.x = Math.sin(t * f - 0.9) * (0.35 + speed * 0.3);
        for (const [j, s] of flips) j.rotation.z = s * (1.35 + Math.sin(t * 3 + s) * 0.15);
    };
    g.userData.tail = tailJ;
    return g;
}

export function buildShark(size = 1, top = 0x7f8c8d, belly = 0xeceff1) {
    const g = new THREE.Group();
    const L = 3.6 * size, R = 0.55 * size;
    const root = joint(g, 0, 0, 0);
    root.add(streamlined(L, R, top, belly, { sx: 0.82, sy: 0.95, split: 0.0 }));
    eyes(root, 0.05 * size, 0.2 * size, 0.1 * size, L * 0.34, 0xf2f2e2);
    const mouth = mesh(new THREE.TorusGeometry(0.18 * size, 0.012 * size, 4, 14, Math.PI), mat(0x3b3b3b), 0, -0.1 * size, L * 0.46);
    mouth.rotation.set(0.2, 0, Math.PI);
    root.add(mouth);
    const dorsal = finPlane('cape_fin', top, shade(top, -0.25), 0.7 * size, 0.85 * size, 0.04, 2);
    dorsal.rotation.set(0, Math.PI / 2, Math.PI);
    dorsal.position.set(0, R * 0.85, L * 0.04);
    root.add(dorsal);
    const flips = [];
    for (const s of [-1, 1]) {
        const j = joint(root, s * R * 0.6, -R * 0.4, L * 0.16);
        const f = finPlane('cape_fin', top, belly, 0.7 * size, 1.0 * size, 0.04, 2);
        f.rotation.set(0.4, s * 0.1, s * 1.2);
        j.add(f);
        flips.push([j, s]);
    }
    const tailJ = joint(root, 0, 0, -L * 0.46);
    const tf = finPlane('fin_classic', top, shade(top, -0.2), 1.1 * size, 1.1 * size, 0.1, 3);
    tf.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    tailJ.add(tf);
    g.userData.update = (t, speed = 0.3) => {
        const f = 2 + speed * 3;
        root.rotation.y = Math.sin(t * f) * 0.08;
        tailJ.rotation.y = Math.sin(t * f - 1) * 0.5;
        for (const [j, s] of flips) j.rotation.z = s * (1.2 + Math.sin(t * 1.5) * 0.06);
    };
    g.userData.tail = tailJ;
    return g;
}

export function buildWhale(size = 1) {
    const g = new THREE.Group();
    const L = 14 * size, R = 2.3 * size;
    const root = joint(g, 0, 0, 0);
    root.add(streamlined(L, R, 0x405a78, 0xd5dde8, {
        sx: 0.95, sy: 0.9, split: -0.05, extra: (t, up, c) => (t > 0.15 && t < 0.55 && up < -0.2 && Math.sin(t * 90) > 0.6 ? lerpColor(c, 0x8fa3bb, 0.6) : undefined)
    }));
    eyes(root, 0.14 * size, R * 0.75, -R * 0.1, L * 0.3, 0xf2f2e2);
    const mouth = mesh(new THREE.TorusGeometry(R * 0.75, 0.05 * size, 4, 20, Math.PI), mat(0x2d3c4d), 0, -R * 0.4, L * 0.28);
    mouth.rotation.set(1.3, 0, Math.PI);
    root.add(mouth);
    const flips = [];
    for (const s of [-1, 1]) {
        const j = joint(root, s * R * 0.85, -R * 0.4, L * 0.2);
        const f = finPlane('cape_fin', 0x405a78, 0x8fa3bb, 1.4 * size, 3.3 * size, 0.04, 2);
        f.rotation.set(0.3, s * 0.2, s * 1.3);
        j.add(f);
        flips.push([j, s]);
    }
    const tailJ = joint(root, 0, 0, -L * 0.46);
    const fluke = finPlane('fin_whale', 0x405a78, 0xa8b8cc, 5.5 * size, 3.0 * size, 0.08, 2);
    fluke.rotation.x = Math.PI / 2;
    tailJ.add(fluke);
    g.userData.update = (t, speed = 0.2) => {
        root.rotation.x = Math.sin(t * 0.6) * 0.03;
        tailJ.rotation.x = Math.sin(t * 0.8 - 0.8) * 0.3;
        for (const [j, s] of flips) j.rotation.z = s * (1.3 + Math.sin(t * 0.5 + s) * 0.1);
    };
    g.userData.tail = tailJ;
    return g;
}

// ================================================================================================
// Sea turtle
// ================================================================================================
let _shellTex = null;
function shellTexture() {
    if (!_shellTex) {
        _shellTex = canvasTexture(256, 256, (g, w, h) => {
            g.fillStyle = '#ffffff';
            g.fillRect(0, 0, w, h);
            g.strokeStyle = 'rgba(40,60,20,0.8)';
            g.lineWidth = 4;
            const s = 52;
            for (let r = -1; r < 6; r++) {
                for (let c = -1; c < 6; c++) {
                    const x = c * s * 0.98 + (r % 2 ? s / 2 : 0), y = r * s * 0.86;
                    g.beginPath();
                    for (let i = 0; i < 6; i++) {
                        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
                        const px = x + Math.cos(a) * s * 0.56, py = y + Math.sin(a) * s * 0.56;
                        if (i === 0) g.moveTo(px, py);
                        else g.lineTo(px, py);
                    }
                    g.closePath();
                    const gr = g.createRadialGradient(x, y, 2, x, y, s * 0.6);
                    gr.addColorStop(0, 'rgba(255,255,255,0.0)');
                    gr.addColorStop(1, 'rgba(0,0,0,0.25)');
                    g.fillStyle = gr;
                    g.fill();
                    g.stroke();
                }
            }
        }, { repeat: [2, 2] });
    }
    return _shellTex;
}

export function buildTurtle(size = 1, skin = 0x6ab04c) {
    const g = new THREE.Group();
    const root = joint(g, 0, 0, 0);
    const S = size;
    const shellG = new THREE.SphereGeometry(0.9 * S, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    const shell = new THREE.Mesh(shellG, new THREE.MeshStandardMaterial({ color: lerpColor(skin, 0x7a5a2a, 0.55), map: shellTexture(), roughness: 0.55 }));
    shell.scale.set(1, 0.55, 1.25);
    shell.position.y = 0.05 * S;
    root.add(shell);
    const belly = mesh(new THREE.CylinderGeometry(0.88 * S, 0.88 * S, 0.12 * S, 24), mat(0xf0e6c0, { r: 0.6 }), 0, 0.02 * S, 0);
    belly.scale.z = 1.25;
    root.add(belly);
    const rim = mesh(new THREE.TorusGeometry(0.9 * S, 0.05 * S, 6, 32), mat(shade(skin, -0.2), { r: 0.6 }), 0, 0.06 * S, 0);
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(1, 1.25, 1);
    root.add(rim);
    const neck = joint(root, 0, 0.05 * S, 1.05 * S);
    const head = mesh(sphereG(0.26 * S, 16, 12), mat(skin, { r: 0.5 }), 0, 0.02 * S, 0.22 * S);
    head.scale.set(1, 0.85, 1.2);
    neck.add(head);
    neck.add(mesh(new THREE.CylinderGeometry(0.14 * S, 0.17 * S, 0.3 * S, 10), mat(skin, { r: 0.5 }), 0, 0, 0.04 * S));
    neck.children[neck.children.length - 1].rotation.x = Math.PI / 2;
    eyes(neck, 0.05 * S, 0.17 * S, 0.1 * S, 0.34 * S);
    const flips = [];
    for (const [sx, sz, big] of [[-1, 0.5, 1], [1, 0.5, 1], [-1, -0.65, 0.65], [1, -0.65, 0.65]]) {
        const j = joint(root, sx * 0.78 * S, 0.0, sz * S);
        const f = mesh(sphereG(0.3 * S, 12, 8), mat(shade(skin, -0.05), { r: 0.5 }), sx * 0.45 * S * big, 0, 0);
        f.scale.set(big * 1.6, 0.18, big * 0.75);
        j.add(f);
        flips.push([j, sx, big]);
    }
    const tail = mesh(new THREE.ConeGeometry(0.08 * S, 0.3 * S, 6), mat(skin, { r: 0.5 }), 0, 0, -1.2 * S);
    tail.rotation.x = -Math.PI / 2;
    root.add(tail);
    g.userData.update = (t, speed = 0.3) => {
        const f = 1.6 + speed * 2.5;
        flips.forEach(([j, sx, big], i) => { j.rotation.z = sx * Math.sin(t * f + (i > 1 ? 1.2 : 0)) * (0.5 + 0.1 * big); });
        root.rotation.z = Math.sin(t * f) * 0.05;
        neck.rotation.x = Math.sin(t * 0.8) * 0.05;
    };
    return g;
}

// ================================================================================================
// Manta ray
// ================================================================================================
let _mantaTex = null;
function mantaTexture() {
    if (!_mantaTex) {
        _mantaTex = canvasTexture(256, 256, (g, w, h) => {
            g.clearRect(0, 0, w, h);
            // right half wing: root at left edge middle, tip towards the right
            g.beginPath();
            g.moveTo(0, h * 0.28);
            g.bezierCurveTo(w * 0.35, h * 0.12, w * 0.8, h * 0.3, w * 0.99, h * 0.62);
            g.bezierCurveTo(w * 0.7, h * 0.58, w * 0.35, h * 0.7, 0, h * 0.78);
            g.closePath();
            const gr = g.createLinearGradient(0, 0, w, 0);
            gr.addColorStop(0, '#32445e');
            gr.addColorStop(1, '#5b7391');
            g.fillStyle = gr;
            g.fill();
            g.fillStyle = 'rgba(255,255,255,0.8)';
            for (let i = 0; i < 7; i++) {
                g.beginPath();
                g.arc(w * (0.12 + i * 0.09), h * (0.4 + Math.sin(i * 1.7) * 0.07), 3 + (i % 3), 0, Math.PI * 2);
                g.fill();
            }
        });
    }
    return _mantaTex;
}

export function buildManta(size = 1) {
    const g = new THREE.Group();
    const S = size;
    const root = joint(g, 0, 0, 0);
    const body = mesh(sphereG(0.5 * S, 18, 12), bodyMat({ vertexColors: false, color: 0x3d5069, roughness: 0.45 }), 0, 0, 0);
    body.scale.set(0.8, 0.28, 1.4);
    root.add(body);
    const belly = mesh(sphereG(0.48 * S, 18, 12), mat(0xeef2f7, { r: 0.5 }), 0, -0.04 * S, 0);
    belly.scale.set(0.78, 0.22, 1.36);
    root.add(belly);
    // cephalic lobes and eyes
    for (const s of [-1, 1]) {
        const lobe = mesh(new THREE.ConeGeometry(0.07 * S, 0.4 * S, 6), mat(0x3d5069, { r: 0.45 }), s * 0.22 * S, -0.02 * S, 0.82 * S);
        lobe.rotation.x = Math.PI / 2;
        root.add(lobe);
        root.add(mesh(sphereG(0.04 * S, 8, 6), mat(0x101018, { r: 0.1 }), s * 0.34 * S, 0.06 * S, 0.5 * S));
    }
    const wings = [];
    for (const s of [-1, 1]) {
        const j = joint(root, s * 0.3 * S, 0, 0.1 * S);
        const j2 = joint(j, s * 1.0 * S, 0, 0);
        const make = (mx, mz, w, flipV) => {
            const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
            geo.rotateX(-Math.PI / 2);
            const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: mantaTexture(), transparent: true, alphaTest: 0.5, side: THREE.FrontSide, roughness: 0.5 }));
            m.scale.set(w * S * s, 1, 1.5 * S);
            m.position.set(mx * S, 0.0, mz * S);
            return m;
        };
        // top (dark) and bottom (light) skins
        const top = make(0.5 * (s > 0 ? 1 : -1) * 0, 0.1, 1.0, false);
        top.position.x = s * 0.5 * S;
        j.add(top);
        const bot = top.clone();
        bot.material = new THREE.MeshStandardMaterial({ map: mantaTexture(), color: 0xe6edf5, transparent: true, alphaTest: 0.5, side: THREE.BackSide, roughness: 0.5 });
        j.add(bot);
        wings.push([j, s]);
        void j2;
    }
    const tail = mesh(new THREE.CylinderGeometry(0.01 * S, 0.04 * S, 1.3 * S, 5), mat(0x3d5069, { r: 0.45 }), 0, 0, -1.35 * S);
    tail.rotation.x = Math.PI / 2;
    root.add(tail);
    g.userData.update = (t, speed = 0.3) => {
        const f = 1.4 + speed * 2;
        for (const [j, s] of wings) j.rotation.z = s * Math.sin(t * f) * 0.35;
        root.position.y = Math.sin(t * f) * 0.08;
        tail.rotation.y = Math.sin(t * f * 0.8) * 0.1;
    };
    return g;
}

// ================================================================================================
// Jellyfish
// ================================================================================================
export function buildJelly(color = 0xff9ff3, size = 1) {
    const g = new THREE.Group();
    const S = size;
    const bellG = new THREE.SphereGeometry(0.7 * S, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.58);
    const p = bellG.attributes.position;
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const ang = Math.atan2(z, x);
        const rim = Math.max(0, -y / (0.7 * S) + 0.25);
        const k = 1 + 0.05 * Math.sin(ang * 8) * rim;
        p.setXYZ(i, x * k, y, z * k);
    }
    bellG.computeVertexNormals();
    const bellM = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.55, roughness: 0.15, emissive: color, emissiveIntensity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    const bell = new THREE.Mesh(bellG, bellM);
    const inner = mesh(sphereG(0.3 * S, 12, 8), new THREE.MeshStandardMaterial({ color: shade(color, 0.3), emissive: shade(color, 0.3), emissiveIntensity: 1.6, transparent: true, opacity: 0.8 }), 0, 0.15 * S, 0);
    inner.scale.y = 0.7;
    const bellJ = joint(g, 0, 0, 0);
    bellJ.add(bell, inner);
    const tentM = makeSway(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }), { axis: '-y', amp: 0.18, freq: 3, speed: 1.4 });
    for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const geo = new THREE.PlaneGeometry(0.035 * S, 1.5 * S * (0.8 + (i % 3) * 0.2), 1, 10);
        geo.translate(0, -0.75 * S, 0);
        const t = new THREE.Mesh(geo, tentM);
        t.position.set(Math.sin(a) * 0.45 * S, -0.05 * S, Math.cos(a) * 0.45 * S);
        t.rotation.y = a;
        g.add(t);
    }
    for (let i = 0; i < 4; i++) {
        const geo = new THREE.PlaneGeometry(0.16 * S, 1.0 * S, 1, 8);
        geo.translate(0, -0.5 * S, 0);
        const t = new THREE.Mesh(geo, tentM);
        t.position.set(Math.sin(i * 1.6) * 0.12 * S, 0, Math.cos(i * 1.6) * 0.12 * S);
        t.rotation.y = i * 1.6;
        g.add(t);
    }
    const gs = glowSprite(color, 3.2 * S, 0.4);
    g.add(gs);
    g.userData.glow = gs;
    g.userData.update = (t, speed = 0.3) => {
        const k = Math.sin(t * 2.4);
        bellJ.scale.set(1 - k * 0.08, 1 + k * 0.16, 1 - k * 0.08);
        inner.material.emissiveIntensity = 1.3 + Math.sin(t * 2.4) * 0.5;
    };
    return g;
}

// ================================================================================================
// Octopus
// ================================================================================================
export function buildOctopus(color = 0x9b59b6, size = 1) {
    const g = new THREE.Group();
    const S = size;
    const bodyM = new THREE.MeshStandardMaterial({ color, roughness: 0.45, emissive: color, emissiveIntensity: 0.12 });
    const head = new THREE.Mesh(sphereG(1.0 * S, 24, 18), bodyM);
    head.scale.set(1, 1.15, 1.05);
    head.position.y = 0.55 * S;
    g.add(head);
    const tex = mesh(sphereG(0.08 * S, 6, 5), mat(shade(color, 0.3)), 0, 0, 0);
    void tex;
    // eyes with horizontal pupils
    for (const s of [-1, 1]) {
        const e = mesh(sphereG(0.24 * S, 14, 10), mat(0xfff0c0, { r: 0.2 }), s * 0.52 * S, 0.45 * S, 0.78 * S);
        g.add(e);
        const pu = mesh(sphereG(0.12 * S, 10, 8), mat(0x101018, { r: 0.1 }), s * 0.55 * S, 0.45 * S, 0.96 * S);
        pu.scale.set(1.5, 0.45, 0.5);
        g.add(pu);
        const lid = mesh(sphereG(0.255 * S, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), bodyM, s * 0.52 * S, 0.47 * S, 0.78 * S);
        lid.rotation.x = 0.15;
        g.add(lid);
    }
    const arms = [];
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        let p = joint(g, Math.sin(a) * 0.55 * S, -0.1 * S, Math.cos(a) * 0.55 * S);
        p.rotation.y = a;
        p.rotation.x = -0.9;
        const joints = [];
        for (let k = 0; k < 7; k++) {
            const r0 = 0.2 * S * (1 - k / 7 * 0.85), r1 = 0.2 * S * (1 - (k + 1) / 7 * 0.85);
            const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1 * 1.05, r0, 0.52 * S, 8), bodyM);
            seg.position.y = -0.25 * S;
            p.add(seg);
            if (k < 3) p.add(mesh(sphereG(r0 * 0.35, 6, 4), mat(0xffd6e8, { r: 0.4 }), 0, -0.25 * S, r0 * 0.8));
            joints.push(p);
            p = joint(p, 0, -0.5 * S, 0);
        }
        arms.push({ joints, ph: i * 0.8 });
    }
    g.userData.update = (t, speed = 0.2) => {
        head.scale.y = 1.15 + Math.sin(t * 1.8) * 0.03;
        for (const a of arms) {
            a.joints.forEach((j, k) => {
                j.rotation.x = (k === 0 ? -0.9 : 0) * 0 + Math.sin(t * 2 + a.ph - k * 0.7) * 0.28 + (k === 0 ? -0.9 : -0.12);
                j.rotation.z = Math.sin(t * 1.5 + a.ph * 2 - k * 0.5) * 0.15;
            });
        }
    };
    return g;
}

// ================================================================================================
// Seahorse
// ================================================================================================
export function buildSeahorse(color = 0xff9ff3, size = 1) {
    const g = new THREE.Group();
    const S = size;
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.4, emissive: color, emissiveIntensity: 0.1 });
    const bodyJ = joint(g, 0, 0, 0);
    // belly and chest
    const chest = mesh(sphereG(0.3 * S, 16, 12), m, 0, 0.7 * S, 0.02 * S);
    chest.scale.set(0.85, 1.25, 0.9);
    bodyJ.add(chest);
    const belly = mesh(sphereG(0.25 * S, 14, 10), mat(shade(color, 0.3), { r: 0.4 }), 0, 0.5 * S, 0.12 * S);
    belly.scale.set(0.7, 1.2, 0.8);
    bodyJ.add(belly);
    // curled tail: a chain that curls forward
    const tailJ = [];
    let p = joint(bodyJ, 0, 0.35 * S, -0.1 * S);
    for (let i = 0; i < 9; i++) {
        const r = 0.2 * S * (1 - i / 10);
        p.add(mesh(sphereG(r, 10, 8), m, 0, -0.1 * S, 0));
        p.add(mesh(sphereG(r * 0.35, 6, 4), mat(shade(color, 0.35), { r: 0.3 }), 0, -0.05 * S, -r * 0.9));
        tailJ.push(p);
        p = joint(p, 0, -0.17 * S * (1 - i / 14), 0);
        p.rotation.x = 0.2 + i * 0.06;
    }
    // head with snout and a crown
    const headJ = joint(bodyJ, 0, 1.1 * S, 0.1 * S);
    headJ.rotation.x = -0.35;
    headJ.add(mesh(sphereG(0.22 * S, 14, 10), m, 0, 0.08 * S, 0));
    const snout = mesh(new THREE.CylinderGeometry(0.05 * S, 0.085 * S, 0.5 * S, 8), m, 0, 0.0, 0.34 * S);
    snout.rotation.x = Math.PI / 2 - 0.2;
    headJ.add(snout);
    eyes(headJ, 0.05 * S, 0.14 * S, 0.16 * S, 0.1 * S);
    for (let i = 0; i < 3; i++) {
        const c = mesh(new THREE.ConeGeometry(0.04 * S, 0.14 * S, 5), mat(shade(color, 0.25), { r: 0.4 }), 0, 0.28 * S, -0.04 * S - i * 0.06 * S);
        c.rotation.x = -0.4 - i * 0.2;
        headJ.add(c);
    }
    const dorsal = finPlane('ear', 0xffffff, color, 0.34 * S, 0.5 * S, 0.12, 5);
    dorsal.position.set(0, 0.95 * S, -0.22 * S);
    dorsal.rotation.set(0, Math.PI / 2, Math.PI);
    bodyJ.add(dorsal);
    g.userData.update = (t, speed = 0.2) => {
        bodyJ.rotation.z = Math.sin(t * 1.2) * 0.04;
        tailJ.forEach((j, i) => { j.rotation.z = Math.sin(t * 1.6 - i * 0.5) * 0.1; });
        headJ.rotation.x = -0.35 + Math.sin(t * 1.1) * 0.05;
        dorsal.rotation.x = Math.sin(t * 9) * 0.1;
    };
    return g;
}

// ================================================================================================
// Crab
// ================================================================================================
export function buildCrab(color = 0xe74c3c, size = 1) {
    const g = new THREE.Group();
    const S = size;
    const shellM = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1, emissive: color, emissiveIntensity: 0.08 });
    const body = new THREE.Mesh(sphereG(0.5 * S, 20, 12), shellM);
    body.scale.set(1.3, 0.55, 0.95);
    body.position.y = 0.3 * S;
    g.add(body);
    for (let i = 0; i < 5; i++) {
        const sp = mesh(new THREE.ConeGeometry(0.04 * S, 0.1 * S, 4), shellM, (i - 2) * 0.16 * S, 0.5 * S, 0.42 * S);
        sp.rotation.x = 1.1;
        g.add(sp);
    }
    for (const s of [-1, 1]) {
        const st = mesh(new THREE.CylinderGeometry(0.014 * S, 0.014 * S, 0.2 * S, 5), shellM, s * 0.16 * S, 0.55 * S, 0.34 * S);
        g.add(st);
        g.add(mesh(sphereG(0.07 * S, 10, 8), mat(0xffffff, { r: 0.2 }), s * 0.16 * S, 0.66 * S, 0.34 * S));
        g.add(mesh(sphereG(0.04 * S, 8, 6), mat(0x101018, { r: 0.1 }), s * 0.16 * S, 0.67 * S, 0.4 * S));
    }
    const claws = [];
    for (const s of [-1, 1]) {
        const arm = joint(g, s * 0.58 * S, 0.34 * S, 0.3 * S);
        arm.add(mesh(new THREE.CylinderGeometry(0.06 * S, 0.07 * S, 0.34 * S, 8), shellM, s * 0.12 * S, 0, 0.12 * S));
        arm.children[0].rotation.set(0.9, 0, s * 1.0);
        const claw = joint(arm, s * 0.2 * S, 0.0, 0.3 * S);
        const palm = mesh(sphereG(0.17 * S, 12, 8), shellM, 0, 0, 0.06 * S);
        palm.scale.set(1.1, 0.8, 1.2);
        claw.add(palm);
        const f1 = mesh(new THREE.ConeGeometry(0.07 * S, 0.3 * S, 6), shellM, 0.05 * S, 0.0, 0.25 * S);
        f1.rotation.x = Math.PI / 2;
        const f2 = f1.clone();
        f2.position.x = -0.05 * S;
        claw.add(f1, f2);
        claws.push([claw, s, f1, f2]);
    }
    const legs = [];
    for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
            const j = joint(g, s * 0.5 * S, 0.3 * S, (0.12 - i * 0.2) * S);
            const l1 = mesh(new THREE.CylinderGeometry(0.03 * S, 0.035 * S, 0.34 * S, 6), shellM, s * 0.14 * S, 0.04 * S, 0);
            l1.rotation.z = s * 1.2;
            j.add(l1);
            const l2 = mesh(new THREE.CylinderGeometry(0.015 * S, 0.03 * S, 0.34 * S, 6), shellM, s * 0.33 * S, -0.1 * S, 0);
            l2.rotation.z = -s * 0.4;
            j.add(l2);
            legs.push([j, s, i]);
        }
    }
    g.userData.update = (t, speed = 0.3) => {
        legs.forEach(([j, s, i]) => { j.rotation.y = Math.sin(t * (6 + speed * 8) + i * 1.3 + (s > 0 ? 1.5 : 0)) * 0.22 * (0.3 + speed); });
        for (const [claw, s, f1, f2] of claws) {
            claw.rotation.y = Math.sin(t * 2 + s) * 0.15 * s;
            f1.rotation.z = Math.sin(t * 3 + s) * 0.12;
            f2.rotation.z = -f1.rotation.z;
        }
        body.position.y = 0.3 * S + Math.abs(Math.sin(t * 6)) * 0.01 * speed * 5;
    };
    return g;
}

// ================================================================================================
// Anglerfish
// ================================================================================================
export function buildAngler(size = 1) {
    const g = new THREE.Group();
    const S = size;
    const bodyM = new THREE.MeshStandardMaterial({ color: 0x2b2438, roughness: 0.5, emissive: 0x2b1f4a, emissiveIntensity: 0.25 });
    const body = new THREE.Mesh(sphereG(0.7 * S, 22, 16), bodyM);
    body.scale.set(0.95, 1.0, 1.15);
    g.add(body);
    const jaw = mesh(new THREE.SphereGeometry(0.62 * S, 20, 10, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), bodyM, 0, -0.1 * S, 0.12 * S);
    jaw.scale.set(1.0, 0.7, 1.1);
    g.add(jaw);
    const teethM = mat(0xf2f2e2, { r: 0.3 });
    for (let i = 0; i < 14; i++) {
        const a = -1.1 + (i / 13) * 2.2;
        for (const up of [1, -1]) {
            const t = mesh(new THREE.ConeGeometry(0.035 * S, 0.22 * S, 4), teethM, Math.sin(a) * 0.55 * S, up * 0.1 * S - 0.1 * S, Math.cos(a) * 0.62 * S + 0.12 * S);
            t.rotation.x = up > 0 ? Math.PI : 0;
            g.add(t);
        }
    }
    for (const s of [-1, 1]) {
        g.add(mesh(sphereG(0.12 * S, 10, 8), mat(0xffd54f, { e: 0.6 }), s * 0.38 * S, 0.32 * S, 0.55 * S));
        g.add(mesh(sphereG(0.06 * S, 8, 6), mat(0x101018), s * 0.4 * S, 0.33 * S, 0.65 * S));
    }
    const stalk = joint(g, 0, 0.62 * S, 0.3 * S);
    stalk.rotation.x = 0.6;
    stalk.add(mesh(new THREE.CylinderGeometry(0.012 * S, 0.025 * S, 0.9 * S, 6), bodyM, 0, 0.45 * S, 0));
    const bulb = mesh(sphereG(0.1 * S, 12, 10), mat(0x9ff4ff, { e: 3 }), 0, 0.95 * S, 0);
    stalk.add(bulb);
    const gs = glowSprite(0x9ff4ff, 3 * S, 0.8);
    gs.position.copy(bulb.position);
    stalk.add(gs);
    const tailJ = joint(g, 0, 0, -0.8 * S);
    const tf = finPlane('fin_ruffle', 0x2b2438, 0x4a3b6b, 0.7 * S, 0.7 * S, 0.1, 3);
    tf.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    tailJ.add(tf);
    g.userData.update = (t, speed = 0.1) => {
        tailJ.rotation.y = Math.sin(t * 3) * 0.4;
        stalk.rotation.x = 0.6 + Math.sin(t * 1.3) * 0.12;
        gs.material.opacity = 0.65 + Math.sin(t * 2.2) * 0.2;
    };
    g.userData.tail = tailJ;
    return g;
}

// ================================================================================================
// Schooling fish (instanced)
// ================================================================================================
/** One merged geometry for schooling fish (instanced; per-instance colour). */
export function schoolFishGeometry() {
    const b = new THREE.SphereGeometry(0.15, 10, 8);
    b.scale(0.4, 0.75, 1.35);
    const t = new THREE.ConeGeometry(0.1, 0.17, 4);
    t.rotateX(-Math.PI / 2);
    t.scale(0.2, 1.2, 1);
    t.translate(0, 0, -0.27);
    const d = new THREE.ConeGeometry(0.06, 0.12, 3);
    d.scale(0.2, 1, 1.6);
    d.translate(0, 0.14, -0.02);
    return merge([b, t, d]);
}

/** Creatures that roam the world, by photo id. */
export function buildRoamer(id, size = 1) {
    switch (id) {
        case 'turtle': return buildTurtle(1.4 * size);
        case 'manta': return buildManta(2.4 * size);
        case 'dolphin': return buildDolphin(1.3 * size);
        case 'jelly': return buildJelly(0xff9ff3, 1.8 * size);
        case 'octopus': return buildOctopus(0xd1558a, 1.3 * size);
        case 'shark': return buildShark(1.5 * size);
        case 'seahorse': return buildSeahorse(0xfeca57, 2.2 * size);
        case 'whale': return buildWhale(1.6 * size);
        case 'puffer': return buildPuffer(2 * size, 0.6);
        case 'angler': return buildAngler(1.5 * size);
        default: return buildFish(0x4bcffa, 0xffffff, 2 * size, false, 'reef');
    }
}
