/**
 * js/game/mermaid/mermaidModel.js
 *
 * Low-poly mermaids (the player, friends, the wedding partner) and fish.
 *
 * buildMermaid(look) makes a jointed model from a look (mermaidData.js): hair style and colour,
 * skin, eye colour and shape, lashes, eyeshadow, lipstick, blush, tail size and colours, top and
 * accessory, and optionally a wedding outfit. The root sits at the hips; the body goes up +Y, the
 * tail hangs down -Y in a chain of segments, and the model faces +Z.
 *
 * animateMermaid(m, t, o) poses it: tail undulation (faster and deeper when swimming), arm strokes,
 * hair drifting, and a few actions (wave, eat, dance, talk).
 */

import * as THREE from 'three';
import { TAIL_COLORS } from './mermaidData.js';

const _mats = new Map();
function mat(color, opts) {
    opts = opts || {};
    const key = `${color}|${opts.e || 0}|${opts.o ?? 1}|${opts.m ?? 0}|${opts.r ?? 0.6}`;
    if (!_mats.has(key)) {
        const m = new THREE.MeshStandardMaterial({
            color, roughness: opts.r ?? 0.6, metalness: opts.m ?? 0,
            emissive: opts.e ? new THREE.Color(color) : new THREE.Color(0), emissiveIntensity: opts.e || 0,
            transparent: (opts.o ?? 1) < 1, opacity: opts.o ?? 1, depthWrite: (opts.o ?? 1) >= 1,
            side: (opts.o ?? 1) < 1 ? THREE.DoubleSide : THREE.FrontSide
        });
        _mats.set(key, m);
    }
    return _mats.get(key);
}

function box(w, h, d, color, x = 0, y = 0, z = 0, opts) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
    m.position.set(x, y, z);
    return m;
}
function sphere(r, color, x = 0, y = 0, z = 0, opts, sx = 1, sy = 1, sz = 1) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat(color, opts));
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    return m;
}
function cyl(rt, rb, h, color, x = 0, y = 0, z = 0, opts, seg = 12) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color, opts));
    m.position.set(x, y, z);
    return m;
}
function joint(parent, x, y, z) {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    return o;
}
const lerpColor = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

/** A five-pointed star (starfish accessory, cake topper). */
export function starGeometry(r = 0.05, depth = 0.015) {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * 0.45;
        if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
    g.translate(0, 0, -depth / 2);
    return g;
}

/**
 * @param {Object} look see mermaidData.defaultLook(); extra: male (no top, broader), wedding
 *   { style, color } outfit, trident (bool)
 */
export function buildMermaid(look) {
    const root = new THREE.Group();
    root.name = 'mermaid';
    const skin = look.skin;
    const tail = TAIL_COLORS[look.tail % TAIL_COLORS.length] || TAIL_COLORS[0];
    const ts = look.tailSize || 1;
    const male = !!look.male;

    // ---- Torso, head ----
    const body = joint(root, 0, 0, 0);
    const torso = joint(body, 0, 0, 0);
    const tw = male ? 0.4 : 0.34;
    const torsoMesh = box(tw, 0.52, 0.21, skin, 0, 0.27, 0);
    torso.add(torsoMesh);
    torso.add(box(tw * 0.85, 0.12, 0.2, skin, 0, 0.02, 0));
    const neck = joint(torso, 0, 0.55, 0);
    neck.add(box(0.09, 0.07, 0.09, skin, 0, 0.03, 0));
    const head = joint(neck, 0, 0.06, 0);
    head.add(box(0.22, 0.25, 0.22, skin, 0, 0.13, 0));
    head.add(box(0.035, 0.045, 0.035, skin, 0, 0.11, 0.12)); // nose

    // Eyes: whites, irises, pupils, sparkles; shape changes the proportions
    const shape = look.eyeShape || 'round';
    const ew = shape === 'big' ? 0.06 : shape === 'almond' ? 0.058 : 0.048;
    const eh = shape === 'big' ? 0.06 : shape === 'almond' ? 0.032 : shape === 'sleepy' ? 0.026 : 0.045;
    for (const sx of [-1, 1]) {
        const ex = sx * 0.052;
        head.add(box(ew, eh, 0.01, 0xffffff, ex, 0.15, 0.111));
        head.add(box(ew * 0.62, eh * 0.85, 0.012, look.eyeColor, ex, 0.148, 0.113));
        head.add(box(ew * 0.28, eh * 0.4, 0.013, 0x111111, ex, 0.147, 0.115));
        if (shape === 'big') head.add(box(0.012, 0.012, 0.014, 0xffffff, ex + 0.01, 0.16, 0.116));
        if (look.lashes) head.add(box(ew * 1.15, 0.008, 0.014, 0x111111, ex, 0.15 + eh / 2 + 0.003, 0.114));
        if (look.eyeshadow != null) head.add(box(ew * 1.1, 0.018, 0.008, look.eyeshadow, ex, 0.15 + eh / 2 + 0.014, 0.112, { r: 0.3 }));
        if (shape === 'sleepy') head.add(box(ew * 1.05, 0.016, 0.012, skin, ex, 0.15 + eh / 2 + 0.006, 0.113));
        if (look.blush) head.add(box(0.035, 0.018, 0.006, 0xff8fa3, sx * 0.075, 0.09, 0.111, { o: 0.7 }));
        // Brows
        head.add(box(ew * 1.1, 0.01, 0.01, look.hairColor, ex, 0.15 + eh / 2 + 0.03, 0.112));
    }
    head.add(box(0.07, 0.02, 0.01, look.lipstick != null ? look.lipstick : lerpColor(skin, 0xc0392b, 0.35), 0, 0.055, 0.112, { r: 0.3 }));
    if (look.lipstick != null) head.add(box(0.06, 0.012, 0.01, lerpColor(look.lipstick, 0x000000, 0.2), 0, 0.044, 0.112, { r: 0.3 }));

    // ---- Hair ----
    const hc = look.hairColor;
    const hair = joint(head, 0, 0, 0);
    const flow = []; // strands that drift in the water
    hair.add(box(0.236, 0.06, 0.24, hc, 0, 0.28, 0));                 // cap
    hair.add(box(0.24, 0.08, 0.05, hc, 0, 0.245, 0.1));                // fringe
    hair.add(box(0.03, 0.14, 0.2, hc, 0.12, 0.2, -0.01));
    hair.add(box(0.03, 0.14, 0.2, hc, -0.12, 0.2, -0.01));
    const style = look.hairStyle;
    if (style === 'long' || style === 'wavy') {
        const n = style === 'wavy' ? 5 : 4;
        let parent = joint(hair, 0, 0.22, -0.11);
        for (let i = 0; i < n; i++) {
            const seg = box(0.25 - i * 0.012, 0.16, 0.06, hc, (style === 'wavy' ? (i % 2 ? 0.015 : -0.015) : 0), -0.08, 0);
            parent.add(seg);
            flow.push(parent);
            parent = joint(parent, 0, -0.16, 0);
        }
        if (style === 'long') {
            for (const sx of [-1, 1]) hair.add(box(0.05, 0.3, 0.05, hc, sx * 0.1, 0.02, 0.07));
        }
    } else if (style === 'bun') {
        hair.add(sphere(0.085, hc, 0, 0.35, -0.04));
        hair.add(box(0.24, 0.12, 0.05, hc, 0, 0.18, -0.105));
    } else if (style === 'pigtails') {
        for (const sx of [-1, 1]) {
            const pt = joint(hair, sx * 0.14, 0.24, -0.04);
            pt.add(sphere(0.03, look.topColor, 0, 0, 0));
            const strand = joint(pt, 0, -0.02, 0);
            strand.add(cyl(0.045, 0.02, 0.3, hc, 0, -0.15, 0, null, 8));
            strand.rotation.z = sx * 0.3;
            flow.push(strand);
        }
        hair.add(box(0.24, 0.12, 0.05, hc, 0, 0.18, -0.105));
    } else if (style === 'bob') {
        hair.add(box(0.27, 0.16, 0.26, hc, 0, 0.16, -0.01));
        hair.children[hair.children.length - 1].position.z = -0.02;
    } else if (style === 'braid') {
        hair.add(box(0.24, 0.12, 0.05, hc, 0, 0.18, -0.105));
        let parent = joint(hair, 0, 0.12, -0.13);
        for (let i = 0; i < 7; i++) {
            parent.add(sphere(0.045 - i * 0.003, hc, 0, -0.05, 0));
            flow.push(parent);
            parent = joint(parent, 0, -0.075, 0);
        }
        parent.add(sphere(0.02, look.topColor, 0, 0, 0));
    } else if (style === 'pixie') {
        hair.add(box(0.25, 0.06, 0.04, hc, 0.02, 0.27, 0.1));
    }

    // ---- Accessories ----
    const acc = look.accessory;
    if (acc === 'tiara') {
        for (let i = -2; i <= 2; i++) head.add(cyl(0.0, 0.016, 0.06 - Math.abs(i) * 0.012, 0xff7675, i * 0.035, 0.335, 0.06, { m: 0.3, r: 0.3 }, 6));
        head.add(box(0.2, 0.015, 0.02, 0xffd700, 0, 0.31, 0.07, { m: 0.8, r: 0.25 }));
    } else if (acc === 'crown') {
        for (let i = 0; i < 7; i++) {
            const a = (i / 7) * Math.PI * 2;
            const sh = cyl(0.0, 0.025, 0.08, 0xfff1e6, Math.sin(a) * 0.1, 0.34, Math.cos(a) * 0.1, { r: 0.2, m: 0.2 }, 6);
            head.add(sh);
        }
    } else if (acc === 'starfish') {
        const s = new THREE.Mesh(starGeometry(0.045, 0.015), mat(0xff9f43));
        s.position.set(0.12, 0.27, 0.05);
        s.rotation.y = Math.PI / 2;
        head.add(s);
    } else if (acc === 'flower') {
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            head.add(sphere(0.022, 0xff6b81, -0.125, 0.27 + Math.sin(a) * 0.025, 0.05 + Math.cos(a) * 0.025));
        }
        head.add(sphere(0.016, 0xffd32a, -0.13, 0.27, 0.05));
    } else if (acc === 'necklace') {
        for (let i = 0; i < 9; i++) {
            const a = -Math.PI * 0.45 + (i / 8) * Math.PI * 0.9;
            torso.add(sphere(0.014, 0xf5f6fa, Math.sin(a) * 0.12, 0.5 - Math.cos(a) * 0.05, 0.11, { r: 0.15, m: 0.3 }));
        }
    }

    // ---- Top ----
    const tc = look.topColor;
    const top = male ? 'none' : look.top;
    if (top === 'shells') {
        for (const sx of [-1, 1]) {
            const sh = sphere(0.075, tc, sx * 0.075, 0.4, 0.1, { r: 0.35, m: 0.1 }, 1, 0.85, 0.45);
            torso.add(sh);
            for (let r = -1; r <= 1; r++) torso.add(box(0.008, 0.06, 0.01, lerpColor(tc, 0xffffff, 0.4), sx * 0.075 + r * 0.025, 0.4, 0.135));
        }
        torso.add(box(0.3, 0.012, 0.012, tc, 0, 0.44, 0.08));
    } else if (top === 'bandeau') {
        torso.add(box(tw + 0.012, 0.1, 0.225, tc, 0, 0.4, 0));
    } else if (top === 'crop') {
        torso.add(box(tw + 0.014, 0.2, 0.226, tc, 0, 0.42, 0));
        for (const sx of [-1, 1]) torso.add(box(0.06, 0.06, 0.12, tc, sx * 0.2, 0.49, 0));
    } else if (top === 'tank') {
        torso.add(box(tw + 0.014, 0.36, 0.226, tc, 0, 0.34, 0));
    } else if (top === 'seaweed') {
        for (let i = 0; i < 5; i++) torso.add(box(0.06, 0.24, 0.226, i % 2 ? tc : lerpColor(tc, 0x1e8449, 0.4), -0.14 + i * 0.07, 0.38, 0));
    } else if (top === 'pearls') {
        for (let row = 0; row < 3; row++) {
            for (let i = 0; i < 9; i++) torso.add(sphere(0.016, 0xffffff, -0.15 + i * 0.0375, 0.36 + row * 0.04, 0.113, { r: 0.1, m: 0.4 }));
        }
    }

    // ---- Arms ----
    const arms = [];
    for (const sx of [-1, 1]) {
        const sh = joint(torso, sx * (tw / 2 + 0.05), 0.49, 0);
        sh.add(box(0.09, 0.27, 0.1, skin, 0, -0.13, 0));
        const el = joint(sh, 0, -0.27, 0);
        el.add(box(0.08, 0.24, 0.09, skin, 0, -0.12, 0));
        el.add(box(0.075, 0.08, 0.05, skin, 0, -0.28, 0));
        if (acc === 'necklace' || acc === 'crown') el.add(box(0.09, 0.02, 0.1, 0xf5f6fa, 0, -0.2, 0, { m: 0.4, r: 0.2 }));
        arms.push({ sh, el, side: sx });
    }

    // ---- Tail: chain of segments down from the hips ----
    const seams = [];
    let parent = joint(body, 0, 0.0, 0);
    const N = 7;
    const segLen = 0.2 * ts;
    // Scale belt where skin meets tail
    parent.add(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 6, 18), mat(tail.b, { m: 0.5, r: 0.3 })));
    parent.children[parent.children.length - 1].rotation.x = Math.PI / 2;
    for (let i = 0; i < N; i++) {
        const k0 = i / N, k1 = (i + 1) / N;
        const r0 = (0.16 - 0.11 * Math.pow(k0, 0.9)) * (0.85 + 0.15 * ts) * (i === 0 ? 1 : 1);
        const r1 = (0.16 - 0.11 * Math.pow(k1, 0.9)) * (0.85 + 0.15 * ts);
        const color = lerpColor(tail.a, tail.b, k0);
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, segLen * 1.04, 14), mat(color, { m: 0.45, r: 0.28 }));
        seg.position.y = -segLen / 2;
        seg.scale.z = 0.8;
        parent.add(seg);
        // Scale rows (shimmer)
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r1 * 1.02, 0.008, 4, 14), mat(lerpColor(color, 0xffffff, 0.35), { m: 0.7, r: 0.2 }));
        ring.rotation.x = Math.PI / 2;
        ring.scale.y = 0.8;
        ring.position.y = -segLen;
        parent.add(ring);
        seams.push(parent);
        parent = joint(parent, 0, -segLen, 0);
    }
    // Fin: two lobes spreading out
    const finMat = mat(lerpColor(tail.b, 0xffffff, 0.15), { o: 0.85, m: 0.3, r: 0.3 });
    const fin = parent;
    for (const sx of [-1, 1]) {
        const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.2 * ts, 12, 8), finMat);
        lobe.scale.set(0.55, 1.0, 0.12);
        lobe.position.set(sx * 0.11 * ts, -0.15 * ts, 0);
        lobe.rotation.z = sx * 0.75;
        fin.add(lobe);
    }
    seams.push(fin);

    // ---- Wedding outfit ----
    if (look.wedding) {
        const wc = look.wedding.color ?? 0xffffff;
        const st = look.wedding.style;
        if (st === 'gown' || st === 'lace') {
            const g = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.42, 1.0, 18, 1, true), mat(st === 'lace' ? 0xf6e58d : wc, { o: st === 'lace' ? 0.7 : 0.55, r: 0.4 }));
            g.position.y = -0.35;
            body.add(g);
            torso.add(box(tw + 0.016, 0.3, 0.228, st === 'lace' ? 0xf6e58d : wc, 0, 0.36, 0));
        }
        if (st === 'veil' || st === 'gown') {
            const v = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 1.3), mat(wc, { o: 0.45 }));
            v.position.set(0, -0.4, -0.15);
            v.rotation.x = 0.12;
            head.add(v);
            for (let i = 0; i < 6; i++) head.add(sphere(0.012, 0xffffff, -0.1 + i * 0.04, 0.3, 0.06, { m: 0.4, r: 0.1 }));
        }
        if (st === 'bodice') {
            torso.add(box(tw + 0.016, 0.3, 0.228, wc, 0, 0.36, 0, { m: 0.4, r: 0.2 }));
            const train = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.6), mat(lerpColor(wc, 0xa29bfe, 0.15), { o: 0.6 }));
            train.position.set(0, -0.8, -0.18);
            train.rotation.x = 0.25;
            body.add(train);
        }
    }
    if (look.trident) {
        const tr = new THREE.Group();
        tr.add(cyl(0.012, 0.012, 1.3, 0xf1c40f, 0, 0, 0, { m: 0.8, r: 0.25 }, 6));
        for (const dx of [-0.05, 0, 0.05]) tr.add(cyl(0.0, 0.012, 0.14, 0xf1c40f, dx, 0.7, 0, { m: 0.8, r: 0.25 }, 6));
        tr.add(box(0.12, 0.015, 0.02, 0xf1c40f, 0, 0.63, 0, { m: 0.8, r: 0.25 }));
        tr.position.set(0, -0.3, 0.04);
        arms[1].el.add(tr);
    }

    root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    return { root, body, torso, neck, head, hair, flow, arms, seams, look, phase: Math.random() * 10 };
}

/**
 * Poses a mermaid. o: { swim 0..1 (how hard it's swimming), action ('wave'|'eat'|'dance'|'talk'|null), dt }
 */
export function animateMermaid(m, t, o = {}) {
    const swim = o.swim || 0;
    const tt = t + m.phase;
    // Tail wave: travels down the chain, bigger towards the fin
    const freq = 1.6 + swim * 3.2;
    const amp = 0.09 + swim * 0.16;
    for (let i = 0; i < m.seams.length; i++) {
        m.seams[i].rotation.x = Math.sin(tt * freq - i * 0.65) * amp * (0.35 + i / m.seams.length);
    }
    // Body bobs with the stroke
    m.body.position.y = Math.sin(tt * freq) * 0.02 * (1 + swim);
    m.torso.rotation.x = Math.sin(tt * freq + 1.2) * 0.04 * (1 + swim);
    // Hair floats and drifts behind
    for (let i = 0; i < m.flow.length; i++) {
        m.flow[i].rotation.x = -0.15 - swim * 0.35 + Math.sin(tt * 1.3 - i * 0.6) * 0.12;
        m.flow[i].rotation.z = Math.sin(tt * 0.9 - i * 0.5) * 0.08;
    }
    m.head.rotation.set(0, 0, 0);
    // Arms: streamlined back when swimming fast, slow paddling when hovering
    for (const a of m.arms) {
        const s = a.side;
        if (swim > 0.5) {
            a.sh.rotation.set(0.3 + Math.sin(tt * freq * 0.5) * 0.15, 0, s * 0.25);
            a.el.rotation.set(-0.2, 0, 0);
        } else {
            a.sh.rotation.set(Math.sin(tt * 1.4 + s) * 0.35 - 0.2, 0, s * (0.35 + Math.sin(tt * 1.4) * 0.15));
            a.el.rotation.set(-0.5 - Math.sin(tt * 1.4 + s) * 0.3, 0, 0);
        }
    }
    const R = m.arms.find((a) => a.side === 1), L = m.arms.find((a) => a.side === -1);
    switch (o.action) {
        case 'wave':
            R.sh.rotation.set(-0.2, 0, 2.6);
            R.el.rotation.set(0, 0, Math.sin(tt * 8) * 0.5);
            break;
        case 'eat': {
            const k = Math.max(0, Math.sin(tt * 2.2));
            R.sh.rotation.set(-1.2 - k * 0.6, 0, 0.35);
            R.el.rotation.set(-1.6 - k * 0.4, 0, 0);
            m.head.rotation.x = 0.1 * k;
            break;
        }
        case 'dance': {
            const b = Math.sin(tt * 4);
            m.body.rotation.y = Math.sin(tt * 1.5) * 0.6;
            R.sh.rotation.set(-2.6 + b * 0.3, 0, 0.4);
            L.sh.rotation.set(-2.6 - b * 0.3, 0, -0.4);
            R.el.rotation.set(-0.4, 0, 0);
            L.el.rotation.set(-0.4, 0, 0);
            break;
        }
        case 'talk':
            R.sh.rotation.set(-0.7 + Math.sin(tt * 3.3) * 0.2, 0, 0.45);
            R.el.rotation.set(-1.0 + Math.sin(tt * 4.7) * 0.3, 0, 0);
            m.head.rotation.x = Math.sin(tt * 2.4) * 0.06;
            break;
        case 'hold':
            R.sh.rotation.set(-1.0, 0, 0.2);
            L.sh.rotation.set(-1.0, 0, -0.2);
            R.el.rotation.set(-0.5, 0, 0);
            L.el.rotation.set(-0.5, 0, 0);
            break;
        default:
            if (o.action !== 'dance') m.body.rotation.y = 0;
            break;
    }
}

// ================================================================================================
// Fish
// ================================================================================================
/** A single fish (talking fish, wedding guests): body, tail, fins, eyes; faces +Z. */
export function buildFish(color, stripe = 0xffffff, size = 1, glow = false) {
    const g = new THREE.Group();
    const s = size;
    const body = sphere(0.3 * s, color, 0, 0, 0, glow ? { e: 0.1 } : { r: 0.4 }, 0.55, 0.85, 1.25);
    g.add(body);
    for (const z of [0.1, -0.12]) {
        const st = sphere(0.302 * s, stripe, 0, 0, z * s, { r: 0.4 }, 0.56, 0.86, 0.12);
        g.add(st);
    }
    const tailJ = joint(g, 0, 0, -0.34 * s);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.2 * s, 0.32 * s, 4), mat(color, { r: 0.4 }));
    tail.rotation.x = Math.PI / 2;
    tail.scale.set(0.25, 1, 1);
    tail.position.z = -0.12 * s;
    tailJ.add(tail);
    const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.1 * s, 0.2 * s, 3), mat(stripe, { r: 0.4 }));
    dorsal.position.set(0, 0.27 * s, -0.02 * s);
    dorsal.scale.set(0.2, 1, 1.5);
    g.add(dorsal);
    for (const sx of [-1, 1]) {
        g.add(sphere(0.06 * s, 0xffffff, sx * 0.13 * s, 0.07 * s, 0.24 * s));
        g.add(sphere(0.035 * s, 0x111111, sx * 0.16 * s, 0.07 * s, 0.26 * s));
    }
    if (glow) {
        const lure = sphere(0.06 * s, 0x48dbfb, 0, 0.45 * s, 0.35 * s, { e: 2.5 });
        g.add(lure);
        g.add(cyl(0.008 * s, 0.008 * s, 0.25 * s, color, 0, 0.32 * s, 0.25 * s, null, 4));
        g.children[g.children.length - 1].rotation.x = 0.6;
        const light = new THREE.PointLight(0x48dbfb, 2, 8);
        light.position.copy(lure.position);
        g.add(light);
    }
    g.userData.tail = tailJ;
    return g;
}

/** One merged geometry for schooling fish (instanced; per-instance colour). */
export function schoolFishGeometry() {
    const parts = [];
    const b = new THREE.SphereGeometry(0.15, 8, 6);
    b.scale(0.45, 0.8, 1.3);
    parts.push(b);
    const t = new THREE.ConeGeometry(0.1, 0.16, 4);
    t.rotateX(-Math.PI / 2);
    t.scale(0.25, 1, 1);
    t.translate(0, 0, -0.26);
    parts.push(t);
    let count = 0;
    for (const p of parts) count += p.attributes.position.count;
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
    const idx = [];
    let off = 0;
    for (const p of parts) {
        const g = p;
        pos.set(g.attributes.position.array, off * 3);
        nor.set(g.attributes.normal.array, off * 3);
        if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.array[i] + off);
        off += g.attributes.position.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setIndex(idx);
    return out;
}
