/**
 * js/game/mermaid/mermaidModel.js
 *
 * The mermaids (the player, friends, the wedding partner, townsfolk).
 *
 * buildMermaid(look) makes a smooth, jointed model from a look (mermaidData.js): a lathe-shaped
 * torso, a painted face (mermaidFace.js) that blinks and talks, hair in twelve styles with ombre
 * tips and strands that drift in the water, an iridescent scaled tail with six kinds of fin,
 * and layers of clothes and accessories (tops, belts and skirts, capes and wings, crowns,
 * necklaces, earrings, bracelets, auras). The root sits at the hips; the body goes up +Y, the
 * tail hangs down -Y in a chain of segments, and the model faces +Z.
 *
 * animateMermaid(m, t, o) poses it: tail undulation (faster and deeper when swimming), arm
 * strokes, hair drifting, blinking, and actions (wave, eat, dance, talk, hold, cheer, photo, dig...).
 */

import * as THREE from 'three';
import { TAIL_COLORS } from './mermaidData.js';
import { mat, mesh, joint, lerpColor, shade, starGeometry, makeSway, SWAY, clamp, mulberry32, glowSprite, glowTexture, lerp, mergeStatic } from './mermaidKit.js';
import { faceTextures, scaleTexture, panelTexture } from './mermaidFace.js';
import { buildHair, HEAD_R, HEAD_S } from './mermaidHair.js';

const HEAD_Y = 0.135;

export { starGeometry };

// ---- Cached geometry ---------------------------------------------------------------------------
const _geo = new Map();
function cached(key, make) {
    let g = _geo.get(key);
    if (!g) {
        g = make();
        _geo.set(key, g);
    }
    return g;
}
const sphereGeo = (r, w = 16, h = 12) => cached(`s${r}|${w}|${h}`, () => new THREE.SphereGeometry(r, w, h));
const cylGeo = (rt, rb, h, seg = 12) => cached(`c${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const torusGeo = (r, t, rs = 6, ts = 20, arc = Math.PI * 2) => cached(`t${r}|${t}|${rs}|${ts}|${arc}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc));
const capsuleGeo = (r, len) => cached(`k${r}|${len}`, () => new THREE.CapsuleGeometry(r, len, 6, 14));

function ball(parent, r, color, x, y, z, opts, sx = 1, sy = 1, sz = 1) {
    const m = mesh(sphereGeo(r), mat(color, opts), x, y, z);
    m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
}
function cyl(parent, rt, rb, h, color, x, y, z, opts, seg = 12) {
    const m = mesh(cylGeo(rt, rb, h, seg), mat(color, opts), x, y, z);
    parent.add(m);
    return m;
}
function box(parent, w, h, d, color, x, y, z, opts) {
    const m = mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts), x, y, z);
    parent.add(m);
    return m;
}

// ---- Torso shape -------------------------------------------------------------------------------
// Control points of the torso's radius by height (hips at 0, neck base at 0.585); each takes a
// multiplier from the build.
const TORSO = [[0, 0.147, 'hip'], [0.09, 0.131, 'hip'], [0.2, 0.108, 'waist'], [0.31, 0.127, 'waist'], [0.42, 0.146, 'bust'], [0.5, 0.15, 'sh'], [0.55, 0.108, 'sh'], [0.585, 0.052, 'sh']];
const BUILDS = [
    { hip: 0.93, waist: 0.93, bust: 0.95, sh: 0.97 },
    { hip: 1, waist: 1, bust: 1, sh: 1 },
    { hip: 1.1, waist: 0.98, bust: 1.08, sh: 1.0 }
];
const MALE_BUILD = { hip: 0.98, waist: 1.1, bust: 1.1, sh: 1.28 };
const TORSO_DEPTH = 0.64;

function torsoRadius(y, k) {
    for (let i = 0; i < TORSO.length - 1; i++) {
        const a = TORSO[i], b = TORSO[i + 1];
        if (y <= b[0] || i === TORSO.length - 2) {
            const t = clamp((y - a[0]) / (b[0] - a[0]), 0, 1);
            const s = t * t * (3 - 2 * t);
            return lerp(a[1] * k[a[2]], b[1] * k[b[2]], s);
        }
    }
    return 0.05;
}

function latheBand(k, y0, y1, off, seg = 28) {
    const pts = [];
    const n = Math.max(2, Math.round((y1 - y0) / 0.015));
    for (let i = 0; i <= n; i++) {
        const y = y0 + (y1 - y0) * (i / n);
        pts.push(new THREE.Vector2(torsoRadius(y, k) + off, y));
    }
    return new THREE.LatheGeometry(pts, seg);
}

// ---- Accessories ---------------------------------------------------------------------------------
const GOLD = { m: 0.85, r: 0.25 };
function crescentGeo(r = 0.06) {
    const s = new THREE.Shape();
    s.absarc(0, 0, r, Math.PI * 0.12, Math.PI * 1.88, false);
    s.absarc(r * 0.35, 0, r * 0.78, Math.PI * 1.8, Math.PI * 0.2, true);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 });
    g.translate(0, 0, -0.006);
    return g;
}

function buildHeadAcc(look, hc) {
    const a = look.headAcc;
    const top = HEAD_R * 1.08;
    if (a === 'tiara') {
        for (let i = -3; i <= 3; i++) {
            const ang = i * 0.28;
            const c = mesh(cylGeo(0, 0.014, 0.06 - Math.abs(i) * 0.009, 6), mat(0xff7675, { m: 0.3, r: 0.3 }), Math.sin(ang) * top * 0.93, Math.cos(ang) * 0.1 + 0.07, 0.07 - Math.abs(i) * 0.006);
            c.rotation.z = -ang;
            hc.add(c);
        }
        const band = mesh(torusGeo(HEAD_R * 1.02, 0.007, 6, 28, Math.PI * 0.75), mat(0xffd700, GOLD), 0, 0.045, 0.02);
        band.rotation.set(Math.PI / 2 - 0.28, 0, Math.PI * 0.125);
        hc.add(band);
    } else if (a === 'crown') {
        for (let i = 0; i < 7; i++) {
            const ang = (i / 7) * Math.PI * 2;
            const s = mesh(cylGeo(0, 0.026, 0.075, 6), mat(0xfff1e6, { r: 0.2, m: 0.2 }), Math.sin(ang) * 0.1, 0.125, Math.cos(ang) * 0.1);
            s.rotation.set(Math.cos(ang) * 0.3, 0, -Math.sin(ang) * 0.3);
            hc.add(s);
            ball(hc, 0.01, 0xffffff, Math.sin(ang) * 0.103, 0.165, Math.cos(ang) * 0.103, { r: 0.1, m: 0.5 });
        }
        const ring = mesh(torusGeo(0.099, 0.012, 6, 28), mat(0xffb8d1, { m: 0.3, r: 0.3 }), 0, 0.105, 0);
        ring.rotation.x = Math.PI / 2;
        hc.add(ring);
    } else if (a === 'starfish') {
        const s = mesh(starGeometry(0.05, 0.016), mat(0xff9f43, { r: 0.55 }), 0.118, 0.1, 0.05);
        s.rotation.y = Math.PI / 2;
        hc.add(s);
        for (let i = 0; i < 5; i++) ball(hc, 0.004, 0xffffff, 0.126, 0.1 + Math.sin(i * 1.256) * 0.025, 0.05 + Math.cos(i * 1.256) * 0.025, { r: 0.3 });
    } else if (a === 'flower') {
        for (let i = 0; i < 6; i++) {
            const ang = (i / 6) * Math.PI * 2;
            const p = ball(hc, 0.026, 0xff6b81, -0.122, 0.1 + Math.sin(ang) * 0.032, 0.055 + Math.cos(ang) * 0.032, { r: 0.45 }, 0.5, 1.2, 1);
            p.rotation.x = -ang;
        }
        ball(hc, 0.018, 0xffd32a, -0.128, 0.1, 0.055, { r: 0.4, e: 0.3 });
        ball(hc, 0.022, 0x2ecc71, -0.115, 0.07, 0.04, { r: 0.5 }, 0.5, 0.8, 1.6);
    } else if (a === 'headband') {
        for (let i = 0; i < 15; i++) {
            const ang = -1.35 + (i / 14) * 2.7;
            ball(hc, 0.012, 0xffffff, Math.sin(ang) * top * 0.97, Math.cos(ang) * top * 1.05 * 0.95 - 0.005, 0.02 + (Math.abs(ang) < 0.3 ? 0.004 : 0), { r: 0.08, m: 0.5, e: 0.15 });
        }
    } else if (a === 'coral') {
        for (const s of [-1, 1]) {
            const stem = joint(hc, s * 0.06, 0.13, -0.01);
            stem.rotation.z = -s * 0.35;
            cyl(stem, 0.012, 0.018, 0.12, 0xff6f91, 0, 0.06, 0, { r: 0.55 }, 6);
            for (const [y, ang, len] of [[0.07, 0.7, 0.07], [0.11, -0.6, 0.06], [0.04, -0.7, 0.05]]) {
                const br = joint(stem, 0, y, 0);
                br.rotation.z = ang * s;
                cyl(br, 0.008, 0.012, len, 0xff8fa3, 0, len / 2, 0, { r: 0.55 }, 6);
                ball(br, 0.011, 0xffeaa7, 0, len, 0, { r: 0.4, e: 0.3 });
            }
            ball(stem, 0.014, 0xffeaa7, 0, 0.125, 0, { r: 0.4, e: 0.3 });
        }
    } else if (a === 'pearlpins') {
        for (let i = 0; i < 6; i++) {
            const ang = -0.9 + i * 0.36;
            const x = Math.sin(ang) * 0.115, z = Math.cos(ang) * 0.115 * 0.8 - 0.02;
            ball(hc, 0.014, 0xffffff, x, 0.1 + Math.cos(ang) * 0.04, z, { r: 0.08, m: 0.4, e: 0.15 });
            cyl(hc, 0.004, 0.004, 0.05, 0xf1c40f, x, 0.08 + Math.cos(ang) * 0.04, z, GOLD, 4);
        }
    } else if (a === 'moonCrown') {
        const c = mesh(crescentGeo(0.08), mat(0xfff3b0, { e: 1.2, m: 0.3, r: 0.25 }), 0, 0.2, 0.03);
        c.rotation.z = Math.PI / 2 - 0.2;
        hc.add(c);
        for (let i = 0; i < 5; i++) {
            const ang = -0.9 + i * 0.45;
            ball(hc, 0.012, 0xfff3b0, Math.sin(ang) * 0.115, 0.12 + Math.cos(ang) * 0.03, 0.05, { e: 1, r: 0.2 });
        }
        const band = mesh(torusGeo(HEAD_R * 1.03, 0.007, 6, 28, Math.PI * 0.8), mat(0xe8d38a, { m: 0.8, r: 0.25 }), 0, 0.05, 0.02);
        band.rotation.set(Math.PI / 2 - 0.25, 0, Math.PI * 0.1);
        hc.add(band);
        const glow = glowSprite(0xfff3b0, 0.35, 0.5);
        glow.position.set(0, 0.2, 0.05);
        hc.add(glow);
    }
}

function buildEars(look, hc) {
    const tc = TAIL_COLORS[look.tail % TAIL_COLORS.length] || TAIL_COLORS[0];
    const skin = look.skin;
    for (const s of [-1, 1]) {
        const ear = joint(hc, s * 0.115, -0.005, -0.005);
        if (look.ears === 'fin') {
            const g = new THREE.PlaneGeometry(0.11, 0.12);
            g.translate(0.055, 0, 0);
            const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: panelTexture('ear', tc.a, tc.b), transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.05, roughness: 0.35, emissive: tc.b, emissiveIntensity: 0.12 }));
            m.scale.x = s;
            m.rotation.set(0, s * -1.0, s * 0.35);
            m.position.x = s * 0.004;
            ear.add(m);
        } else if (look.ears === 'pointed') {
            const c = mesh(cylGeo(0, 0.026, 0.1, 6), mat(skin, { r: 0.6, e: 0.06 }), s * 0.04, 0.03, 0);
            c.scale.z = 0.35;
            c.rotation.z = -s * 1.25;
            ear.add(c);
        } else {
            ball(ear, 0.024, skin, s * 0.005, 0, 0, { r: 0.6, e: 0.06 }, 0.5, 1.1, 0.9);
        }
        const lobe = joint(hc, s * 0.121, -0.035, -0.002);
        if (look.earAcc === 'pearls') ball(lobe, 0.012, 0xffffff, 0, 0, 0.005, { r: 0.08, m: 0.4, e: 0.15 });
        else if (look.earAcc === 'shells') {
            const c = mesh(cylGeo(0.0, 0.016, 0.04, 6), mat(0xffc0cb, { r: 0.3, m: 0.2 }), 0, -0.03, 0.005);
            c.rotation.x = Math.PI;
            lobe.add(c);
            ball(lobe, 0.008, 0xf1c40f, 0, -0.005, 0.005, GOLD);
        } else if (look.earAcc === 'hoops') {
            const t = mesh(torusGeo(0.02, 0.003, 6, 18), mat(0xf1c40f, GOLD), 0, -0.02, 0.004);
            t.rotation.y = Math.PI / 2;
            lobe.add(t);
        }
    }
}

// ---- Tops --------------------------------------------------------------------------------------
function scallopGeo(r) {
    return cached(`scallop${r}`, () => {
        const g = new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
        g.rotateX(Math.PI / 2);   // dome towards +z
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
            const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
            const ang = Math.atan2(y, x);
            const k = 1 + 0.07 * Math.cos(ang * 9) * (z / r);
            p.setXYZ(i, x * k, y * k, z * (1 + 0.04 * Math.cos(ang * 9)));
        }
        g.computeVertexNormals();
        return g;
    });
}

function buildTop(look, torso, tg, k, male) {
    const tc = look.topColor;
    const top = male ? 'none' : look.top;
    const band = (y0, y1, off, color, opts, parent = tg) => {
        const m = new THREE.Mesh(latheBand(k, y0, y1, off), mat(color, Object.assign({ r: 0.5, side: THREE.DoubleSide }, opts)));
        parent.add(m);
        return m;
    };
    const bz = TORSO_DEPTH;
    const bust = 0.4;
    if (top === 'shells') {
        for (const s of [-1, 1]) {
            const sh = mesh(scallopGeo(0.075), mat(tc, { r: 0.3, m: 0.15 }), s * 0.064, bust + 0.002, 0.07);
            sh.rotation.set(-0.12, s * 0.28, 0);
            sh.scale.set(1, 0.95, 0.9);
            torso.add(sh);
        }
        band(0.435, 0.455, 0.004, shade(tc, -0.15), { m: 0.2 });
    } else if (top === 'bandeau') {
        band(0.355, 0.465, 0.006, tc, { r: 0.55 });
        band(0.455, 0.47, 0.01, shade(tc, 0.25), { m: 0.3 });
    } else if (top === 'crop') {
        band(0.31, 0.5, 0.007, tc, { r: 0.65 });
        for (const s of [-1, 1]) ball(torso, 0.05, tc, s * 0.2 * (k.sh), 0.5, 0, { r: 0.65 }, 1, 0.8, 1);
    } else if (top === 'tank') {
        band(0.14, 0.52, 0.007, tc, { r: 0.65 });
        band(0.52, 0.56, 0.004, tc, { r: 0.65 });
    } else if (top === 'halter') {
        band(0.34, 0.47, 0.007, tc, { r: 0.5 });
        for (const s of [-1, 1]) {
            const st = mesh(cylGeo(0.008, 0.008, 0.2, 5), mat(tc, { r: 0.5 }), s * 0.04, 0.55, 0.075);
            st.rotation.z = s * 0.14;
            torso.add(st);
        }
        const ring = mesh(torusGeo(0.05, 0.006, 5, 14), mat(0xf1c40f, GOLD), 0, 0.64, 0.045);
        torso.add(ring);
    } else if (top === 'seaweed') {
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + 0.3;
            const w = mesh(new THREE.PlaneGeometry(0.09, 0.2, 1, 6), makeSway(new THREE.MeshStandardMaterial({ color: i % 2 ? tc : lerpColor(tc, 0x1e8449, 0.45), roughness: 0.6, side: THREE.DoubleSide }), { axis: '-y', amp: 0.08 }));
            w.geometry = w.geometry.clone();
            w.geometry.translate(0, -0.1, 0);
            const r = torsoRadius(0.42, k) + 0.012;
            w.position.set(Math.sin(a) * r, 0.5, Math.cos(a) * r * bz);
            w.rotation.y = a;
            torso.add(w);
        }
        band(0.4, 0.48, 0.006, lerpColor(tc, 0x1e8449, 0.3), { r: 0.7 });
    } else if (top === 'pearls') {
        for (let row = 0; row < 4; row++) {
            const y = 0.35 + row * 0.04;
            const r = torsoRadius(y, k) + 0.012;
            for (let i = 0; i < 18; i++) {
                const a = (i / 18) * Math.PI * 2;
                if (Math.cos(a) < -0.2) continue;
                ball(torso, 0.0135, 0xffffff, Math.sin(a) * r, y, Math.cos(a) * r * bz, { r: 0.08, m: 0.4, e: 0.1 });
            }
        }
    } else if (top === 'starfish') {
        for (const s of [-1, 1]) {
            const st = mesh(starGeometry(0.07, 0.025), mat(tc, { r: 0.55 }), s * 0.063, bust + 0.004, 0.075);
            st.rotation.set(-0.12, s * 0.2, s * 0.3);
            torso.add(st);
            ball(torso, 0.008, 0xffffff, s * 0.063, bust + 0.004, 0.095, { r: 0.3 });
        }
        const cord = mesh(torusGeo(torsoRadius(0.4, k) + 0.006, 0.004, 4, 28), mat(shade(tc, -0.2), { r: 0.5 }), 0, 0.4, 0);
        cord.rotation.x = Math.PI / 2;
        cord.scale.set(1, bz, 1);
        torso.add(cord);
    } else if (top === 'corset') {
        band(0.1, 0.46, 0.008, tc, { r: 0.28, m: 0.2 });
        for (let i = 0; i < 9; i++) {
            const y = 0.12 + i * 0.04;
            box(torso, 0.012, 0.012, 0.01, 0xf1c40f, -0.015 + (i % 2) * 0.03, y, torsoRadius(y, k) * bz + 0.01, GOLD);
        }
        for (let i = 0; i < 5; i++) {
            const y = 0.14 + i * 0.07;
            const r = torsoRadius(y, k) + 0.012;
            for (const s of [-1, 1]) ball(torso, 0.011, 0xffffff, s * r * 0.82, y, r * bz * 0.58, { r: 0.1, m: 0.4, e: 0.1 });
        }
    }
}

// ---- Tail --------------------------------------------------------------------------------------
const FIN_KINDS = { classic: 'fin_classic', ruffle: 'fin_ruffle', double: 'fin_double', sword: 'fin_sword', fan: 'fin_fan', whale: 'fin_whale' };

function buildTail(look, body, k, sx) {
    const tc = TAIL_COLORS[look.tail % TAIL_COLORS.length] || TAIL_COLORS[0];
    const ts = look.tailSize || 1;
    const N = 8;
    const segLen = 0.19 * ts;
    const seams = [];
    const pattern = look.tailPattern || 'scales';
    const map = scaleTexture(pattern);
    const r0 = torsoRadius(0, k) * 1.0;
    let parent = joint(body, 0, 0, 0);
    seams.push(parent);
    const tailJoints = [];
    for (let i = 0; i < N; i++) {
        const k0 = i / N, k1 = (i + 1) / N;
        const rA = lerp(r0, 0.04, Math.pow(k0, 0.82)) * (0.9 + 0.1 * ts);
        const rB = lerp(r0, 0.04, Math.pow(k1, 0.82)) * (0.9 + 0.1 * ts);
        let color = lerpColor(tc.a, tc.b, Math.pow(k0 + 0.05, 0.9));
        if (pattern === 'stripes') color = shade(color, i % 2 ? -0.22 : 0.08);
        if (pattern === 'ombre') color = lerpColor(tc.a, tc.b, k0 * 1.25);
        const material = new THREE.MeshPhysicalMaterial({
            color, map, roughness: 0.3, metalness: 0.08, clearcoat: 0.6, clearcoatRoughness: 0.28,
            iridescence: pattern === 'plain' ? 0.35 : 0.65, iridescenceIOR: 1.4,
            emissive: look.tailGlow ? tc.b : 0x000000, emissiveIntensity: look.tailGlow ? 0.45 : 0
        });
        const seg = new THREE.Mesh(cylGeo(+rA.toFixed(4), +rB.toFixed(4), +(segLen * 1.12).toFixed(4), 26), material);
        seg.position.y = -segLen / 2;
        const z = lerp(0.66, 0.44, k0);
        seg.scale.set(sx, 1, z);
        parent.add(seg);
        const knob = new THREE.Mesh(sphereGeo(+rB.toFixed(4), 18, 10), material);
        knob.position.y = -segLen;
        knob.scale.set(sx, 0.5, lerp(0.66, 0.44, k1));
        parent.add(knob);
        parent = joint(parent, 0, -segLen, 0);
        seams.push(parent);
        tailJoints.push(seg);
    }
    // The fin
    const fin = parent;
    const kind = FIN_KINDS[look.finStyle] || 'fin_classic';
    const fa = lerpColor(tc.b, tc.a, 0.3), fb = lerpColor(tc.b, 0xffffff, 0.25);
    const finGeo = new THREE.PlaneGeometry(1, 1, 8, 12);
    finGeo.translate(0, -0.5, 0);
    const finMat = makeSway(new THREE.MeshStandardMaterial({
        map: panelTexture(kind, fa, fb, !!look.tailGlow), transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.04, roughness: 0.3, metalness: 0.1,
        emissive: look.tailGlow ? tc.b : 0x000000, emissiveIntensity: look.tailGlow ? 0.5 : 0
    }), { axis: '-y', amp: 0.2, freq: 3, speed: 2.2 });
    const finMesh = new THREE.Mesh(finGeo, finMat);
    const fw = (kind === 'fin_fan' ? 0.6 : kind === 'fin_whale' ? 0.66 : 0.52) * ts, fh = (kind === 'fin_sword' ? 0.58 : kind === 'fin_whale' ? 0.38 : 0.44) * ts;
    finMesh.scale.set(fw, fh, 1);
    finMesh.position.y = 0.02;
    if (kind === 'fin_whale') finMesh.rotation.x = Math.PI / 2 - 0.15;
    fin.add(finMesh);
    if (kind === 'fin_double') {
        const f2 = new THREE.Mesh(finGeo, finMat);
        f2.scale.set(fw * 0.8, fh * 0.8, 1);
        f2.rotation.set(0.5, 0, 0);
        f2.position.y = 0.04;
        fin.add(f2);
    }
    if (look.tailGlow) {
        const g = glowSprite(tc.b, 0.9 * ts, 0.35);
        g.position.set(0, -fh * 0.7, 0);
        fin.add(g);
    }
    seams.push(fin);
    return { seams, fin: finMesh, root: seams[0], N };
}

// ---- Wardrobe layers (bottoms, capes) -------------------------------------------------------------
function buildBottom(look, body, k, sx) {
    const bc = look.bottomColor;
    const b = look.bottom;
    if (b === 'belt') {
        const r = torsoRadius(0.02, k) * sx + 0.006;
        const ring = mesh(torusGeo(torsoRadius(0.02, k) + 0.006, 0.014, 6, 30), mat(bc, { m: 0.5, r: 0.3 }), 0, 0.01, 0);
        ring.rotation.x = Math.PI / 2;
        ring.scale.set(1, TORSO_DEPTH, 1);
        body.add(ring);
        for (let i = 0; i < 5; i++) {
            const a = -0.9 + i * 0.45;
            const sh = mesh(scallopGeo(0.026), mat(shade(bc, 0.2), { r: 0.3, m: 0.2 }), Math.sin(a) * r, 0.0, Math.cos(a) * r * TORSO_DEPTH + 0.012);
            sh.rotation.y = a;
            body.add(sh);
        }
    } else if (b === 'pearlbelt') {
        for (let i = 0; i < 26; i++) {
            const a = (i / 26) * Math.PI * 2;
            ball(body, 0.014, 0xffffff, Math.sin(a) * (torsoRadius(0.02, k) + 0.008), 0.01 + Math.sin(a * 2) * 0.004, Math.cos(a) * (torsoRadius(0.02, k) + 0.008) * TORSO_DEPTH, { r: 0.08, m: 0.4, e: 0.1 });
        }
    } else if (b === 'sash') {
        const ring = mesh(torusGeo(torsoRadius(0.04, k) + 0.006, 0.02, 6, 30), mat(bc, { r: 0.4 }), 0, 0.02, 0);
        ring.rotation.x = Math.PI / 2;
        ring.scale.set(1, TORSO_DEPTH, 1);
        body.add(ring);
        for (const [x, w] of [[-0.12, 0.1], [0.12, 0.09]]) {
            const g = new THREE.PlaneGeometry(1, 1, 3, 8);
            g.translate(0, -0.5, 0);
            const m = new THREE.Mesh(g, makeSway(new THREE.MeshStandardMaterial({ map: panelTexture('sash', bc, shade(bc, 0.3)), transparent: true, side: THREE.DoubleSide, alphaTest: 0.04, roughness: 0.4 }), { axis: '-y', amp: 0.25, freq: 3 }));
            m.scale.set(w, 0.5, 1);
            m.position.set(x, 0.02, torsoRadius(0.04, k) * TORSO_DEPTH * 0.8);
            body.add(m);
        }
    } else if (b === 'skirt') {
        const pts = [new THREE.Vector2(torsoRadius(0.03, k) + 0.004, 0.04), new THREE.Vector2(0.17, -0.1), new THREE.Vector2(0.29, -0.32), new THREE.Vector2(0.4, -0.52)];
        const g = new THREE.LatheGeometry(pts, 32);
        const m = new THREE.Mesh(g, makeSway(new THREE.MeshStandardMaterial({ color: bc, transparent: true, opacity: 0.6, side: THREE.DoubleSide, roughness: 0.35, emissive: bc, emissiveIntensity: 0.1, depthWrite: false }), { axis: '-y', amp: 0.18, freq: 4, speed: 1.4 }));
        m.scale.z = 0.7;
        body.add(m);
        const hem = mesh(torusGeo(0.4, 0.008, 4, 36), mat(shade(bc, 0.3), { o: 0.8 }), 0, -0.52, 0);
        hem.rotation.x = Math.PI / 2;
        hem.scale.set(1, 0.7, 1);
        body.add(hem);
    } else if (b === 'ruffle') {
        for (let i = 0; i < 4; i++) {
            const y = 0.0 - i * 0.12;
            const r = torsoRadius(0.02, k) + 0.022 + i * 0.025;
            const t = mesh(torusGeo(r, 0.026, 6, 32), mat(i % 2 ? shade(bc, 0.2) : bc, { r: 0.45 }), 0, y, 0);
            t.rotation.x = Math.PI / 2;
            t.scale.set(1, TORSO_DEPTH + 0.1, 1);
            body.add(t);
        }
    }
}

function buildCape(look, torso, k) {
    const c = look.cape;
    if (!c || c === 'none') return null;
    const cc = look.capeColor;
    const out = [];
    const panelMat = (kind, w) => makeSway(new THREE.MeshStandardMaterial({ map: panelTexture(kind, cc, shade(cc, 0.35)), transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.04, roughness: 0.4, emissive: cc, emissiveIntensity: 0.08 }), { axis: '-y', amp: 0.18, freq: 3, speed: 1.6 });
    const zBack = -torsoRadius(0.4, k) * TORSO_DEPTH - 0.01;
    if (c === 'kelp') {
        for (let i = 0; i < 5; i++) {
            const g = new THREE.PlaneGeometry(1, 1, 3, 10);
            g.translate(0, -0.5, 0);
            const m = new THREE.Mesh(g, panelMat('kelp'));
            m.scale.set(0.22, 0.7 + (i % 2) * 0.15, 1);
            m.position.set((i - 2) * 0.07, 0.52 - Math.abs(i - 2) * 0.02, zBack - 0.01 * i);
            m.rotation.y = (i - 2) * 0.12;
            torso.add(m);
            out.push(m);
        }
    } else if (c === 'fins' || c === 'wings') {
        const wing = c === 'wings';
        for (const s of [-1, 1]) {
            const pivot = joint(torso, s * 0.06, 0.45, zBack);
            const g = new THREE.PlaneGeometry(1, 1, 6, 8);
            g.translate(0.5, -0.25, 0);
            const m = new THREE.Mesh(g, panelMat(wing ? 'wing' : 'cape_fin'));
            m.scale.set((wing ? 0.62 : 0.4) * s, wing ? 0.5 : 0.52, 1);
            pivot.rotation.set(wing ? 0.1 : 0.25, s * (wing ? -0.6 : -0.9), s * 0.12);
            pivot.add(m);
            out.push(pivot);
        }
    }
    return out;
}

// ---- The mermaid ---------------------------------------------------------------------------------
/**
 * @param {Object} look see mermaidData.defaultLook(); extra: male (broader, bare chest), wedding { style, color } outfit, trident (bool)
 */
export function buildMermaid(look) {
    const root = new THREE.Group();
    root.name = 'mermaid';
    const skin = look.skin;
    const male = !!look.male;
    const k = male ? MALE_BUILD : (BUILDS[look.build ?? 1] || BUILDS[1]);
    const sx = 1;
    const skinM = (o) => mat(skin, Object.assign({ r: 0.58, e: 0.42, warm: 0.3 }, o));

    const body = joint(root, 0, 0, 0);
    // The whole figure scales with height (the tail follows tailSize separately)
    const H = look.height || 1;
    body.scale.setScalar(H);
    const torso = joint(body, 0, 0, 0);

    // Torso: lathe shape, flattened front to back
    const tg = new THREE.Group();
    tg.scale.set(1, 1, TORSO_DEPTH);
    torso.add(tg);
    tg.add(new THREE.Mesh(latheBand(k, 0, 0.585, 0, 32), skinM()));
    // (the bust comes from the torso's lathe profile; tops follow it)
    if (male) for (const s of [-1, 1]) ball(torso, 0.06, skin, s * 0.07, 0.43, 0.06, { r: 0.58, e: 0.42, warm: 0.3 }, 1.2, 0.8, 0.6);
    // Neck and head
    const neck = joint(torso, 0, 0.58, 0);
    cyl(neck, 0.042, 0.048, 0.1, skin, 0, 0.03, 0, { r: 0.58, e: 0.42, warm: 0.3 }, 14);
    const head = joint(neck, 0, 0.06, 0);
    head.scale.setScalar(1.12);
    const hm = mesh(sphereGeo(HEAD_R, 40, 30), skinM(), 0, HEAD_Y, 0);
    hm.scale.set(HEAD_S[0], HEAD_S[1], HEAD_S[2]);
    head.add(hm);
    const jaw = mesh(sphereGeo(0.088, 24, 16), skinM(), 0, HEAD_Y - 0.052, 0.01);
    jaw.scale.set(0.93, 0.82, 0.93);
    head.add(jaw);
    // Face plate: a patch of sphere just outside the skull, painted with the face textures
    const plateGeo = cached('plate', () => new THREE.SphereGeometry(HEAD_R * 1.005, 48, 32, Math.PI / 2 - 0.9, 1.8, Math.PI * 0.3, Math.PI * 0.5));
    const tex = faceTextures(look);
    const faceMat = new THREE.MeshStandardMaterial({ map: tex.open, transparent: true, roughness: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const plate = new THREE.Mesh(plateGeo, faceMat);
    plate.scale.set(HEAD_S[0], HEAD_S[1], HEAD_S[2]);
    plate.position.y = HEAD_Y;
    plate.userData.face = true;
    head.add(plate);
    // Nose
    ball(head, 0.0105, skin, 0, HEAD_Y - 0.028, 0.119, { r: 0.58, e: 0.42, warm: 0.3 }, 1, 0.85, 0.9);
    // Head centre group: hair, ears and head accessories hang off this
    const hc = joint(head, 0, HEAD_Y, 0);
    const flow = [];
    buildEars(look, hc);
    buildHair(look, hc, flow);
    buildHeadAcc(look, hc);

    // Neck accessory
    const na = look.neckAcc;
    if (na === 'necklace') {
        for (let i = 0; i < 11; i++) {
            const a = -Math.PI * 0.47 + (i / 10) * Math.PI * 0.94;
            ball(torso, 0.0145, 0xffffff, Math.sin(a) * 0.1, 0.545 - Math.cos(a) * 0.05, 0.085 * (0.5 + Math.cos(a) * 0.5) + 0.02, { r: 0.08, m: 0.4, e: 0.12 });
        }
    } else if (na === 'choker') {
        const t = mesh(torusGeo(0.052, 0.011, 6, 20), mat(0x2d3436, { r: 0.4 }), 0, 0.605, 0);
        t.rotation.x = Math.PI / 2;
        torso.add(t);
        const sh = mesh(scallopGeo(0.022), mat(0xffc0cb, { r: 0.3, m: 0.2 }), 0, 0.597, 0.056);
        torso.add(sh);
    } else if (na === 'pendant') {
        for (let i = 0; i < 11; i++) {
            const a = -Math.PI * 0.47 + (i / 10) * Math.PI * 0.94;
            ball(torso, 0.006, 0xe8d38a, Math.sin(a) * 0.08, 0.56 - Math.cos(a) * 0.075, 0.075 * (0.5 + Math.cos(a) * 0.5) + 0.018, { m: 0.8, r: 0.3 });
        }
        const c = mesh(crescentGeo(0.032), mat(0xfff3b0, { e: 1, m: 0.4, r: 0.25 }), 0, 0.46, 0.098);
        c.rotation.z = Math.PI / 2;
        torso.add(c);
    }

    // Top
    buildTop(look, torso, tg, k, male);

    // Arms
    const arms = [];
    for (const s of [-1, 1]) {
        const sh = joint(torso, s * (torsoRadius(0.5, k) + 0.012), 0.5, 0);
        ball(sh, 0.04, skin, 0, 0, 0, { r: 0.58, e: 0.42, warm: 0.3 });
        const up = mesh(capsuleGeo(0.034, 0.17), skinM(), 0, -0.13, 0);
        sh.add(up);
        const el = joint(sh, 0, -0.26, 0);
        ball(el, 0.031, skin, 0, 0, 0, { r: 0.58, e: 0.42, warm: 0.3 });
        const fo = mesh(capsuleGeo(0.029, 0.15), skinM(), 0, -0.12, 0);
        el.add(fo);
        const hand = ball(el, 0.034, skin, 0, -0.275, 0.004, { r: 0.58, e: 0.42, warm: 0.3 }, 1, 1.15, 0.7);
        void hand;
        for (let f = 0; f < 3; f++) ball(el, 0.011, skin, (f - 1) * 0.016, -0.315, 0.004, { r: 0.58, e: 0.42, warm: 0.3 }, 1, 1.5, 0.9);
        ball(el, 0.011, skin, s * -0.03, -0.285, 0.014, { r: 0.58, e: 0.42, warm: 0.3 }, 1, 1.5, 0.9);
        const aa = look.armAcc;
        if (aa === 'bracelets') {
            for (let i = 0; i < 3; i++) {
                const t = mesh(torusGeo(0.032, 0.005, 5, 14), mat([0xff6b81, 0xfeca57, 0x48dbfb][i], { r: 0.4 }), 0, -0.2 - i * 0.012, 0);
                t.rotation.x = Math.PI / 2;
                el.add(t);
            }
        } else if (aa === 'cuffs') {
            cyl(el, 0.034, 0.034, 0.05, 0xf1c40f, 0, -0.225, 0, GOLD, 16);
        } else if (aa === 'armfins') {
            const g = new THREE.PlaneGeometry(0.12, 0.14);
            g.translate(0.06 * s, -0.07, 0);
            const tcol = TAIL_COLORS[look.tail % TAIL_COLORS.length] || TAIL_COLORS[0];
            const m = new THREE.Mesh(g, makeSway(new THREE.MeshStandardMaterial({ map: panelTexture('ear', tcol.a, tcol.b), transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.05 }), { axis: '-y', amp: 0.3, freq: 5 }));
            m.position.set(s * 0.03, -0.08, 0);
            m.rotation.set(0, 0, 0);
            el.add(m);
        }
        arms.push({ sh, el, side: s });
    }

    // Capes and wings (behind the shoulders)
    const cape = buildCape(look, torso, k);

    // Tail
    const tail = buildTail(look, body, k, sx);
    buildBottom(look, body, k, sx);

    // ---- Wedding outfit ----
    if (look.wedding) {
        const wc = look.wedding.color ?? 0xffffff;
        const st = look.wedding.style;
        if (st === 'gown' || st === 'lace') {
            const col = st === 'lace' ? 0xf6e58d : wc;
            const pts = [new THREE.Vector2(torsoRadius(0.04, k) + 0.012, 0.0), new THREE.Vector2(0.2, -0.2), new THREE.Vector2(0.3, -0.55), new THREE.Vector2(0.42, -1.0)];
            const g = new THREE.LatheGeometry(pts, 36);
            const m = new THREE.Mesh(g, makeSway(new THREE.MeshStandardMaterial({ color: col, transparent: true, opacity: st === 'lace' ? 0.72 : 0.6, side: THREE.DoubleSide, roughness: 0.4, emissive: col, emissiveIntensity: 0.08, depthWrite: false }), { axis: '-y', amp: 0.1, freq: 3.2, speed: 1.3 }));
            m.scale.z = 0.72;
            body.add(m);
            const bodice = new THREE.Mesh(latheBand(k, 0.1, 0.47, 0.009), mat(col, { r: 0.35, side: THREE.DoubleSide }));
            tg.add(bodice);
        }
        if (st === 'veil' || st === 'gown') {
            const g = new THREE.PlaneGeometry(1, 1, 4, 10);
            g.translate(0, -0.5, 0);
            const v = new THREE.Mesh(g, makeSway(new THREE.MeshStandardMaterial({ map: panelTexture('veil', wc, wc), transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.03, roughness: 0.4 }), { axis: '-y', amp: 0.12, freq: 2.5 }));
            v.scale.set(0.42, 1.3, 1);
            v.position.set(0, 0.1, -0.12);
            v.rotation.x = 0.08;
            hc.add(v);
        }
        if (st === 'bodice') {
            const bd = new THREE.Mesh(latheBand(k, 0.1, 0.47, 0.01), mat(wc, { r: 0.22, m: 0.35, side: THREE.DoubleSide }));
            tg.add(bd);
            for (let i = 0; i < 7; i++) {
                const y = 0.18 + i * 0.04;
                ball(torso, 0.016, 0xffffff, ((i % 3) - 1) * 0.06, y, torsoRadius(y, k) * TORSO_DEPTH + 0.02, { r: 0.1, m: 0.5, e: 0.15 });
            }
            const g = new THREE.PlaneGeometry(1, 1, 4, 10);
            g.translate(0, -0.5, 0);
            const train = new THREE.Mesh(g, makeSway(new THREE.MeshStandardMaterial({ map: panelTexture('veil', lerpColor(wc, 0xa29bfe, 0.15), wc), transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.03 }), { axis: '-y', amp: 0.16, freq: 2.4 }));
            train.scale.set(0.55, 1.5, 1);
            train.position.set(0, 0.0, -0.16);
            body.add(train);
        }
    }
    if (look.trident) {
        const tr = new THREE.Group();
        cyl(tr, 0.012, 0.012, 1.3, 0xf1c40f, 0, 0, 0, GOLD, 6);
        for (const dx of [-0.05, 0, 0.05]) cyl(tr, 0.0, 0.012, 0.14, 0xf1c40f, dx, 0.7, 0, GOLD, 6);
        box(tr, 0.12, 0.015, 0.02, 0xf1c40f, 0, 0.63, 0, GOLD);
        tr.position.set(0, -0.3, 0.04);
        arms[1].el.add(tr);
    }

    // Aura: sparkles, a ring of bubbles or a soft glow
    let aura = null;
    if (look.aura === 'sparkles') {
        const n = 36;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
        const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTexture(), size: 0.09, color: 0xfff3b0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.95 }));
        pts.frustumCulled = false;
        body.add(pts);
        aura = { kind: 'sparkles', obj: pts, n };
    } else if (look.aura === 'bubbles') {
        const g = new THREE.Group();
        const rnd = mulberry32(5);
        const bubbleMat = new THREE.MeshStandardMaterial({ color: 0xbfefff, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.2, emissive: 0x9fdfff, emissiveIntensity: 0.25, depthWrite: false });
        for (let i = 0; i < 12; i++) {
            const b = new THREE.Mesh(sphereGeo(0.03 + rnd() * 0.04, 12, 8), bubbleMat);
            b.userData.ph = rnd() * 6.28;
            b.userData.r = 0.3 + rnd() * 0.18;
            b.userData.h = rnd();
            g.add(b);
        }
        body.add(g);
        aura = { kind: 'bubbles', obj: g };
    } else if (look.aura === 'glow') {
        const g = glowSprite(0xa8e6ff, 2.2, 0.42);
        g.position.set(0, 0.3, 0);
        body.add(g);
        aura = { kind: 'glow', obj: g };
    }

    root.traverse((o) => {
        if (o.isMesh) {
            o.castShadow = !o.material.transparent;
            o.receiveShadow = false;
        }
    });
    mergeStatic(root);
    return {
        root, body, torso, neck, head, hair: hc, flow, arms, seams: tail.seams, fin: tail.fin, look, cape, aura,
        face: { mat: faceMat, tex }, phase: Math.random() * 10, _blink: 0, _nextBlink: 1.5 + Math.random() * 3, _frame: 'open'
    };
}

/**
 * Poses a mermaid. o: { swim 0..1 (how hard it's swimming), action ('wave'|'eat'|'dance'|'talk'|'hold'|'cheer'|'photo'|'dig'|'point'|null), dt }
 */
export function animateMermaid(m, t, o = {}) {
    const swim = o.swim || 0;
    const tt = t + m.phase;
    SWAY.time.value = t;
    // Tail wave: travels down the chain, bigger towards the fin
    const freq = 1.6 + swim * 3.2;
    const amp = 0.08 + swim * 0.15;
    const n = m.seams.length;
    for (let i = 1; i < n; i++) {
        m.seams[i].rotation.x = Math.sin(tt * freq - i * 0.6) * amp * (0.3 + i / n);
    }
    m.seams[0].rotation.x = Math.sin(tt * freq + 0.4) * amp * 0.25;
    m.body.position.y = Math.sin(tt * freq) * 0.02 * (1 + swim);
    m.torso.rotation.x = Math.sin(tt * freq + 1.2) * 0.04 * (1 + swim);
    for (let i = 0; i < m.flow.length; i++) {
        m.flow[i].rotation.x = -0.1 - swim * 0.3 + Math.sin(tt * 1.3 - i * 0.55) * 0.1;
        m.flow[i].rotation.z = Math.sin(tt * 0.9 - i * 0.45) * 0.07 + (m.flow[i].userData.base || 0);
    }
    m.head.rotation.set(0, 0, 0);
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
    if (m.cape) {
        for (let i = 0; i < m.cape.length; i++) {
            const c = m.cape[i];
            if (c.isObject3D && c.children.length && c.children[0].isMesh && m.look.cape !== 'kelp') {
                const s = i === 0 ? -1 : 1;
                c.rotation.y = s * (m.look.cape === 'wings' ? -0.6 : -0.9) + Math.sin(tt * 2.2 + i) * 0.14 * (1 + swim);
            }
        }
    }
    const R = m.arms.find((a) => a.side === 1), L = m.arms.find((a) => a.side === -1);
    let talking = false;
    switch (o.action) {
        case 'wave':
            R.sh.rotation.set(-0.2, 0, 2.6);
            R.el.rotation.set(0, 0, Math.sin(tt * 8) * 0.5);
            break;
        case 'eat': {
            const kk = Math.max(0, Math.sin(tt * 2.2));
            R.sh.rotation.set(-1.2 - kk * 0.6, 0, 0.35);
            R.el.rotation.set(-1.6 - kk * 0.4, 0, 0);
            m.head.rotation.x = 0.1 * kk;
            talking = kk > 0.7;
            break;
        }
        case 'dance': {
            const b = Math.sin(tt * 4);
            m.body.rotation.y = Math.sin(tt * 1.5) * 0.6;
            R.sh.rotation.set(-2.6 + b * 0.3, 0, 0.4);
            L.sh.rotation.set(-2.6 - b * 0.3, 0, -0.4);
            R.el.rotation.set(-0.4, 0, 0);
            L.el.rotation.set(-0.4, 0, 0);
            m.head.rotation.z = Math.sin(tt * 2) * 0.1;
            break;
        }
        case 'talk':
            R.sh.rotation.set(-0.7 + Math.sin(tt * 3.3) * 0.2, 0, 0.45);
            R.el.rotation.set(-1.0 + Math.sin(tt * 4.7) * 0.3, 0, 0);
            m.head.rotation.x = Math.sin(tt * 2.4) * 0.06;
            talking = true;
            break;
        case 'hold':
            R.sh.rotation.set(-1.0, 0, 0.2);
            L.sh.rotation.set(-1.0, 0, -0.2);
            R.el.rotation.set(-0.5, 0, 0);
            L.el.rotation.set(-0.5, 0, 0);
            break;
        case 'cheer':
            R.sh.rotation.set(-2.9 + Math.sin(tt * 7) * 0.2, 0, 0.3);
            L.sh.rotation.set(-2.9 - Math.sin(tt * 7) * 0.2, 0, -0.3);
            R.el.rotation.set(-0.2, 0, 0);
            L.el.rotation.set(-0.2, 0, 0);
            break;
        case 'photo':
            R.sh.rotation.set(-1.6, 0, 0.1);
            L.sh.rotation.set(-1.6, 0, -0.1);
            R.el.rotation.set(-1.4, 0, 0.5);
            L.el.rotation.set(-1.4, 0, -0.5);
            break;
        case 'dig': {
            const b = Math.sin(tt * 9);
            R.sh.rotation.set(-1.1 + b * 0.4, 0, 0.2);
            L.sh.rotation.set(-1.1 - b * 0.4, 0, -0.2);
            R.el.rotation.set(-0.6, 0, 0);
            L.el.rotation.set(-0.6, 0, 0);
            m.torso.rotation.x += 0.35;
            break;
        }
        case 'point':
            R.sh.rotation.set(-1.45, 0, 0.1);
            R.el.rotation.set(-0.1, 0, 0);
            break;
        default:
            if (o.action !== 'dance') m.body.rotation.y = 0;
            break;
    }
    // Face: blink every few seconds, mouth open while talking
    if (m.face) {
        m._nextBlink -= o.dt ?? 0.016;
        if (m._nextBlink <= 0) {
            m._blink = 0.13;
            m._nextBlink = 2 + Math.random() * 4;
        }
        if (m._blink > 0) m._blink -= o.dt ?? 0.016;
        const talkOpen = talking && Math.sin(tt * 13) > -0.2;
        const frame = m._blink > 0 ? 'blink' : talkOpen ? 'talk' : 'open';
        if (frame !== m._frame) {
            m._frame = frame;
            m.face.mat.map = m.face.tex[frame];
        }
    }
    if (m.aura) {
        const a = m.aura;
        if (a.kind === 'sparkles') {
            const p = a.obj.geometry.attributes.position;
            for (let i = 0; i < a.n; i++) {
                const ang = tt * (0.6 + (i % 5) * 0.12) + i * 2.4;
                const rr = 0.32 + (i % 7) * 0.035;
                const y = 0.9 - ((tt * 0.3 + i * 0.137) % 1.3);
                p.setXYZ(i, Math.sin(ang) * rr, y, Math.cos(ang) * rr * 0.8);
            }
            p.needsUpdate = true;
            a.obj.material.size = 0.07 + Math.sin(tt * 3) * 0.015;
        } else if (a.kind === 'bubbles') {
            a.obj.children.forEach((b, i) => {
                const ang = tt * 0.7 + b.userData.ph;
                b.position.set(Math.sin(ang) * b.userData.r, 0.8 - ((tt * 0.25 + b.userData.h) % 1) * 1.4, Math.cos(ang) * b.userData.r);
            });
        } else if (a.kind === 'glow') {
            a.obj.material.opacity = 0.34 + Math.sin(tt * 1.6) * 0.1;
        }
    }
}
