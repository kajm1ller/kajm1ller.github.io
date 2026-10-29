/**
 * js/game/aircraft.js
 *
 * The aircraft catalogue: every flyable type's name, flight tuning, exterior mesh and its own
 * cockpit / cabin interior, seen from the pilot's seat (first person in the camera).
 *
 *   planes:  cub (the original), biplane, twin (turboprop), bizjet, fighter
 *   helis:   light (the original), rescue, news, military
 *
 * Nose points toward -Z, wheels / skids rest on y=0. `buildAircraft(type, color, id)` returns
 *   { root, propellers, spinners, interior, eye, spec }
 * where `propellers` spin about Z, `spinners` are { obj, axis, k } (angle += rpm * k * dt) and
 * `interior.update(state)` redraws the live instruments and moves the controls with the inputs.
 */

import * as THREE from 'three';
import { createHelicopterMesh } from './helicopter.js';

// ---- small helpers ---------------------------------------------------------------------------
const mats = new Map();
function mat(color, o = {}) {
    const key = color + JSON.stringify(o);
    if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.55, metalness: 0.15 }, o)));
    return mats.get(key);
}
const M = {
    dark: () => mat(0x202226, { roughness: 0.8 }),
    panel: () => mat(0x2b2d31, { roughness: 0.7 }),
    leather: () => mat(0x6b4a2f, { roughness: 0.85 }),
    leatherGrey: () => mat(0x8d8f93, { roughness: 0.85 }),
    cream: () => mat(0xd9cdb4, { roughness: 0.9 }),
    metal: () => mat(0x9a9da3, { roughness: 0.35, metalness: 0.9 }),
    brass: () => mat(0xb08d3c, { roughness: 0.4, metalness: 0.8 }),
    wood: () => mat(0x8a5a2b, { roughness: 0.7 }),
    glass: () => mat(0x8fbad4, { transparent: true, opacity: 0.28, depthWrite: false, roughness: 0.05, metalness: 0.3, side: THREE.DoubleSide }),
    black: () => mat(0x111111, { roughness: 0.6 }),
    red: () => mat(0xcc2222, { roughness: 0.5 }),
    yellow: () => mat(0xf2c200, { roughness: 0.6 }),
    olive: () => mat(0x4d5a3a, { roughness: 0.8 }),
    white: () => mat(0xf0f0f0, { roughness: 0.5 })
};

const geoCache = new Map();
function geo(key, make) {
    if (!geoCache.has(key)) geoCache.set(key, make());
    return geoCache.get(key);
}
const boxGeo = (w, h, d) => geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cylGeo = (rt, rb, h, seg = 12) => geo(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const sphGeo = () => geo('sph', () => new THREE.SphereGeometry(1, 16, 12));

function box(parent, w, h, d, material, x, y, z, rot) {
    const m = new THREE.Mesh(boxGeo(w, h, d), material);
    m.position.set(x, y, z);
    if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    parent.add(m);
    return m;
}
/** Cylinder along an axis ('x' | 'y' | 'z'). */
function cyl(parent, r, len, material, x, y, z, axis = 'y', rb = r, seg = 12) {
    const m = new THREE.Mesh(cylGeo(r, rb, len, seg), material);
    if (axis === 'z') m.rotation.x = Math.PI / 2;
    if (axis === 'x') m.rotation.z = Math.PI / 2;
    m.position.set(x, y, z);
    parent.add(m);
    return m;
}
function ball(parent, sx, sy, sz, material, x, y, z) {
    const m = new THREE.Mesh(sphGeo(), material);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
}
function shadows(root) {
    root.traverse((c) => {
        if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
        }
    });
}
const bodyMat = (color) => mat(color, { roughness: 0.35, metalness: 0.3 });

/** A 2D canvas (a do-nothing stand-in under Node, where the unit tests build aircraft without a DOM). */
function makeCanvas() {
    if (typeof document !== 'undefined') return document.createElement('canvas');
    const noop = new Proxy({}, { get: () => () => {}, set: () => true });
    return { width: 0, height: 0, getContext: () => noop };
}

// ---- live instrument panels (canvas textures) -------------------------------------------------
/** Steam gauges: airspeed, attitude, altimeter, rpm/throttle. Returns { mesh, draw(state) }. */
function makeAnalogPanel(w, h, style = {}) {
    const cv = makeCanvas();
    cv.width = 512;
    cv.height = Math.round(512 * h / w);
    const ctx = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const dial = (cx, cy, r, label, frac, ticks) => {
        ctx.fillStyle = '#101214';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = style.rim || '#888';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 2;
        for (let i = 0; i <= ticks; i++) {
            const a = Math.PI * 0.75 + (i / ticks) * Math.PI * 1.5;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82);
            ctx.lineTo(cx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.95);
            ctx.stroke();
        }
        ctx.fillStyle = '#aaa';
        ctx.font = `${Math.round(r * 0.22)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(label, cx, cy + r * 0.55);
        const a = Math.PI * 0.75 + Math.max(0, Math.min(1, frac)) * Math.PI * 1.5;
        ctx.strokeStyle = '#ffb000';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * r * 0.75, cy + Math.sin(a) * r * 0.75);
        ctx.stroke();
    };
    const horizon = (cx, cy, r, pitch, roll) => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.translate(cx, cy);
        ctx.rotate(-roll);
        const off = pitch * r * 1.6;
        ctx.fillStyle = '#4a86c8';
        ctx.fillRect(-r, -r * 2 + off, r * 2, r * 2);
        ctx.fillStyle = '#7a5230';
        ctx.fillRect(-r, off, r * 2, r * 2);
        ctx.fillStyle = '#fff';
        ctx.fillRect(-r, off - 1, r * 2, 2);
        ctx.restore();
        ctx.strokeStyle = '#ffb000';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.5, cy);
        ctx.lineTo(cx - r * 0.15, cy);
        ctx.lineTo(cx, cy + r * 0.12);
        ctx.lineTo(cx + r * 0.15, cy);
        ctx.lineTo(cx + r * 0.5, cy);
        ctx.stroke();
        ctx.strokeStyle = style.rim || '#888';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
    };
    const draw = (s) => {
        ctx.fillStyle = style.bg || '#1b1c1f';
        ctx.fillRect(0, 0, cv.width, cv.height);
        const r = cv.height * 0.2, y1 = cv.height * 0.27, y2 = cv.height * 0.73;
        const xs = [cv.width * 0.2, cv.width * 0.5, cv.width * 0.8];
        dial(xs[0], y1, r, 'KT', s.speed / (s.maxSpeed || 80), 10);
        horizon(xs[1], y1, r, s.pitch, s.roll);
        dial(xs[2], y1, r, 'ALT', (s.alt % 1000) / 1000, 10);
        dial(xs[0], y2, r, 'RPM', s.rpm, 8);
        dial(xs[1], y2, r, 'CLIMB', 0.5 + Math.max(-1, Math.min(1, s.vs / 15)) * 0.5, 8);
        dial(xs[2], y2, r, 'THR', s.throttle, 8);
        if (s.alarm && s.flash) {
            ctx.fillStyle = 'rgba(255,20,20,0.55)';
            ctx.fillRect(0, 0, cv.width, cv.height);
        }
        tex.needsUpdate = true;
    };
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
    draw({ speed: 0, pitch: 0, roll: 0, alt: 0, rpm: 0, vs: 0, throttle: 0 });
    return { mesh, draw };
}

/** Glass cockpit: artificial horizon with speed and altitude tapes (and a HUD variant, green on clear). */
function makeGlassPanel(w, h, hud = false) {
    const cv = makeCanvas();
    cv.width = 512;
    cv.height = Math.round(512 * h / w);
    const ctx = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const W = cv.width, H = cv.height;
    const draw = (s) => {
        ctx.clearRect(0, 0, W, H);
        const g = hud ? '#5dff8a' : '#fff';
        if (!hud) {
            ctx.save();
            ctx.translate(W / 2, H / 2);
            ctx.rotate(-s.roll);
            const off = s.pitch * H * 1.3;
            ctx.fillStyle = '#2d6db5';
            ctx.fillRect(-W, -H * 3 + off, W * 2, H * 3);
            ctx.fillStyle = '#7b5a3a';
            ctx.fillRect(-W, off, W * 2, H * 3);
            ctx.restore();
        } else {
            ctx.save();
            ctx.translate(W / 2, H / 2);
            ctx.rotate(-s.roll);
            ctx.strokeStyle = g;
            ctx.lineWidth = 2;
            ctx.font = '16px monospace';
            ctx.fillStyle = g;
            for (let d = -30; d <= 30; d += 10) {
                const y = d === 0 ? 0 : (-d / 57.3 + s.pitch) * H * 1.3;
                ctx.beginPath();
                ctx.moveTo(-60, y);
                ctx.lineTo(-20, y);
                ctx.moveTo(20, y);
                ctx.lineTo(60, y);
                ctx.stroke();
                if (d) ctx.fillText(String(Math.abs(d)), 64, y + 5);
            }
            ctx.restore();
        }
        ctx.strokeStyle = hud ? g : '#ffd400';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(W / 2 - 40, H / 2);
        ctx.lineTo(W / 2 - 12, H / 2);
        ctx.lineTo(W / 2, H / 2 + 8);
        ctx.lineTo(W / 2 + 12, H / 2);
        ctx.lineTo(W / 2 + 40, H / 2);
        ctx.stroke();
        // tapes
        ctx.fillStyle = hud ? 'rgba(0,0,0,0)' : 'rgba(10,12,16,0.7)';
        if (!hud) {
            ctx.fillRect(0, 0, W * 0.16, H);
            ctx.fillRect(W * 0.84, 0, W * 0.16, H);
        }
        ctx.fillStyle = g;
        ctx.font = `bold ${Math.round(H * 0.07)}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(String(Math.round(s.speed * 1.944)), W * 0.08, H * 0.53);
        ctx.fillText(String(Math.round(s.alt * 3.281)), W * 0.92, H * 0.53);
        ctx.font = `${Math.round(H * 0.045)}px monospace`;
        ctx.fillText('KT', W * 0.08, H * 0.1);
        ctx.fillText('FT', W * 0.92, H * 0.1);
        ctx.fillText(`THR ${Math.round(s.throttle * 100)}`, W * 0.5, H * 0.94);
        const hdg = (((-s.yaw * 180 / Math.PI) % 360) + 360) % 360;
        ctx.fillText(`HDG ${String(Math.round(hdg)).padStart(3, '0')}`, W * 0.5, H * 0.07);
        if (s.alarm) {
            if (s.flash) {
                ctx.fillStyle = 'rgba(255,20,20,0.6)';
                ctx.fillRect(0, 0, W, H);
            }
            ctx.fillStyle = s.flash ? '#fff' : '#ff3030';
            ctx.font = `bold ${Math.round(H * 0.1)}px monospace`;
            ctx.fillText('CABIN PRESSURE', W * 0.5, H * 0.3);
        }
        tex.needsUpdate = true;
    };
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: hud, depthWrite: !hud });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    draw({ speed: 0, pitch: 0, roll: 0, alt: 0, throttle: 0, yaw: 0 });
    return { mesh, draw };
}

// ---- controls: yoke / stick / throttle that move with the inputs ----------------------------
function makeInterior(root, eye) {
    const g = new THREE.Group();
    g.name = 'aircraft_interior';
    root.add(g);
    const it = { group: g, eye, panels: [], yokes: [], levers: [], collectives: [], extra: [] };
    it.update = (s) => {
        if (s.redraw !== false) for (const p of it.panels) p.draw(s);
        for (const y of it.yokes) {
            y.obj.rotation.z = -s.steer * 0.7 * y.k;
            y.obj.position.z = y.z0 + s.pitchIn * 0.06;
            if (y.stick) y.obj.rotation.x = -s.pitchIn * 0.35;
        }
        for (const l of it.levers) l.obj.position.z = l.z0 - s.throttle * l.travel;
        for (const c of it.collectives) c.obj.rotation.x = c.r0 - s.collective * 0.5;
        for (const fn of it.extra) fn(s);
    };
    return it;
}
/** Thin lining so the cabin has a floor, lower walls, a roof and a rear bulkhead (windows stay open). */
function shell(g, o) {
    const m = o.mat || M.cream();
    const w = o.half * 2, len = o.z1 - o.z0, cz = (o.z0 + o.z1) / 2;
    box(g, w, 0.05, len, M.dark(), 0, o.floor, cz);
    for (const side of [-1, 1]) box(g, 0.05, o.belt - o.floor, len, m, side * o.half, (o.belt + o.floor) / 2, cz);
    if (o.roof) box(g, w, 0.05, len, m, 0, o.roof, cz);
    if (o.rear !== false) box(g, w, o.belt - o.floor + 0.6, 0.05, m, 0, (o.belt + o.floor) / 2 + 0.3, o.z1);
}
function addSeat(parent, x, y, z, material, face = 1) {
    box(parent, 0.5, 0.12, 0.5, material, x, y, z);
    box(parent, 0.5, 0.65, 0.1, material, x, y + 0.36, z + 0.27 * face);
    box(parent, 0.3, 0.2, 0.08, material, x, y + 0.8, z + 0.28 * face);
}
function addYoke(it, x, y, z, kind = 'yoke') {
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    if (kind === 'yoke') {
        cyl(grp, 0.02, 0.5, M.dark(), 0, -0.05, 0.25, 'z');
        cyl(grp, 0.015, 0.32, M.black(), 0, 0.1, 0, 'x');
        for (const side of [-1, 1]) box(grp, 0.03, 0.2, 0.03, M.black(), side * 0.16, 0.0, 0);
        it.group.add(grp);
        it.yokes.push({ obj: grp, k: 1, z0: z });
    } else { // stick
        cyl(grp, 0.018, 0.35, M.black(), 0, 0.15, 0, 'y');
        ball(grp, 0.035, 0.035, 0.035, M.black(), 0, 0.34, 0);
        it.group.add(grp);
        it.yokes.push({ obj: grp, k: 0.6, z0: z, stick: true });
    }
    return grp;
}
function addThrottle(it, x, y, z, travel = 0.12, material = M.red()) {
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    cyl(grp, 0.012, 0.1, M.metal(), 0, 0.05, 0);
    ball(grp, 0.025, 0.025, 0.025, material, 0, 0.11, 0);
    it.group.add(grp);
    it.levers.push({ obj: grp, z0: z + travel * 0.5, travel });
    return grp;
}
function addPanelBoard(it, w, h, x, y, z, tilt, style, glass = false) {
    const panel = glass ? makeGlassPanel(w, h) : makeAnalogPanel(w, h, style);
    panel.mesh.position.set(x, y, z);
    panel.mesh.rotation.x = tilt;
    it.group.add(panel.mesh);
    it.panels.push(panel);
    return panel;
}

// ---- the pilot's own body, rudder pedals, window frames and the odds and ends that make a cockpit ----
const _up = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
const _v = new THREE.Vector3();
function seg(m, A, B) {
    _d.subVectors(B, A);
    const len = _d.length() || 1e-3;
    m.position.copy(A).addScaledVector(_d, 0.5);
    m.scale.set(1, len, 1);
    m.quaternion.setFromUnitVectors(_up, _d.multiplyScalar(1 / len));
}
function makeLimb(g, mat, r, endMat, endSize) {
    const a = new THREE.Mesh(cylGeo(r, r * 0.88, 1, 8), mat);
    const b = new THREE.Mesh(cylGeo(r * 0.88, r * 0.78, 1, 8), mat);
    const end = new THREE.Mesh(boxGeo(endSize[0], endSize[1], endSize[2]), endMat);
    g.add(a, b, end);
    return { a, b, end };
}
function fixedSkin() { return mat(0xc99a7a, { roughness: 0.8 }); }

/**
 * o.frame: window pillars and rails; o.hands: [{ yoke|lever|coll: i, off }, ...] for the right and left hand
 * (null rests on the thigh); o.sleeve / o.glove / o.trouser colours; o.floor: height of the cabin floor.
 */
function finish(it, o) {
    const g = it.group, e = it.eye;
    const fm = o.frameMat || M.dark();
    const f = o.frame;
    const gl = M.glass();
    const pane = (w, h, x, y, z, rx, ry) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), gl);
        m.position.set(x, y, z);
        m.rotation.set(rx || 0, ry || 0, 0);
        g.add(m);
        return m;
    };
    if (f) {
        const T = f.tilt === undefined ? 0.45 : f.tilt;
        const H = f.yt - f.yb;
        const zTop = f.zf + H * Math.tan(T);                       // the windscreen leans back toward the pilot
        const zMid = (f.zf + zTop) / 2, yMid = (f.yb + f.yt) / 2;
        for (const side of [-1, 1]) {
            box(g, 0.05, H / Math.cos(T), 0.05, fm, side * f.x0, yMid, zMid, [T, 0, side * 0.06]);               // A-pillar
            box(g, 0.05, 0.05, f.zr - zTop, fm, side * f.x0, f.yt - 0.03, (zTop + f.zr) / 2);                   // roof rail
            box(g, 0.05, 0.05, f.zr - f.zf, fm, side * f.x0, f.yb, (f.zf + f.zr) / 2);                           // sill
            for (const z of f.mids || []) box(g, 0.06, H, 0.06, fm, side * f.x0, yMid, z);
            box(g, 0.34, 0.02, 0.2, M.dark(), side * f.x0 * 0.5, f.yt - 0.07, zTop + 0.14, [0.3, 0, 0]);          // sun visor
            box(g, 0.03, 0.03, 0.3, M.metal(), side * (f.x0 - 0.04), f.yt - 0.12, zTop + 0.7);                     // grab handle
            // side window glass between the pillars, from the windscreen back to the rear of the cabin
            pane(f.zr - zTop, H, side * f.x0, yMid, (zTop + f.zr) / 2, 0, Math.PI / 2);
        }
        box(g, f.x0 * 2, 0.07, 0.07, fm, 0, f.yt - 0.02, zTop);                                                   // windscreen header
        box(g, 0.06, H / Math.cos(T), 0.05, fm, 0, yMid, zMid, [T, 0, 0]);                                         // centre post
        // the windscreen itself, filling the frame
        pane(f.x0 * 2, H / Math.cos(T), 0, yMid, zMid, T, 0);
        // roof glass over the pilot's head
        if (f.roofGlass) pane(f.x0 * 2, f.zr - zTop, 0, f.yt - 0.03, (zTop + f.zr) / 2, -Math.PI / 2, 0);
    }
    if (o.wind) {                                                                                                // a lone windscreen (open cockpits)
        const w = o.wind, H2 = w.yt - w.yb;
        pane(w.x0 * 2, H2 / Math.cos(w.tilt), 0, (w.yb + w.yt) / 2, w.z + (H2 * Math.tan(w.tilt)) / 2, w.tilt, 0);
        for (const side of [-1, 1]) box(g, 0.025, H2 / Math.cos(w.tilt), 0.025, fm, side * w.x0, (w.yb + w.yt) / 2, w.z + (H2 * Math.tan(w.tilt)) / 2, [w.tilt, 0, 0]);
        box(g, w.x0 * 2, 0.025, 0.025, fm, 0, w.yt, w.z + H2 * Math.tan(w.tilt));
    }
    // compass on the glare shield, radio stack, a clock
    if (o.radio) {
        const [rx, ry, rz] = o.radio;
        for (let i = 0; i < 3; i++) {
            box(g, 0.2, 0.045, 0.1, M.black(), rx, ry + i * 0.055, rz);
            box(g, 0.1, 0.012, 0.01, mat(0x39ff7a, { emissive: 0x39ff7a, emissiveIntensity: 0.9 }), rx - 0.02, ry + i * 0.055, rz - 0.052);
            cyl(g, 0.01, 0.02, M.metal(), rx + 0.07, ry + i * 0.055, rz - 0.055, 'z');
        }
    }
    if (o.compass) ball(g, 0.03, 0.03, 0.03, M.brass(), o.compass[0], o.compass[1], o.compass[2]);
    // rudder pedals the feet rest on
    const fl = o.floor;
    const pedals = [-1, 1].map((sd) => {
        const ped = box(g, 0.11, 0.04, 0.12, M.metal(), e.x + sd * 0.17, fl + 0.08, e.z - 0.8);
        ped.rotation.x = 0.5;
        box(g, 0.05, 0.12, 0.03, M.dark(), e.x + sd * 0.17, fl + 0.04, e.z - 0.72);
        return ped;
    });
    // the pilot: arms to the controls, legs to the pedals (hidden from outside only by the body)
    const sleeve = mat(o.sleeve || 0xe8e8e8, { roughness: 0.9 });
    const glove = o.glove ? mat(o.glove, { roughness: 0.7 }) : fixedSkin();
    const trouser = mat(o.trouser || 0x23283a, { roughness: 0.9 });
    const arms = [1, -1].map((sd) => makeLimb(g, sleeve, 0.045, glove, [0.07, 0.05, 0.1]));      // right, left
    const legs = [1, -1].map((sd) => makeLimb(g, trouser, 0.075, mat(0x151515), [0.1, 0.07, 0.24]));
    const S = [new THREE.Vector3(), new THREE.Vector3()], E = [new THREE.Vector3(), new THREE.Vector3()], H = [new THREE.Vector3(), new THREE.Vector3()];
    const hip = new THREE.Vector3(), knee = new THREE.Vector3(), foot = new THREE.Vector3();
    it.pedals = pedals;
    // harness: two shoulder straps, a lap belt and the buckle (shown while buckled)
    const strapMat = mat(0x1d1d1d, { roughness: 0.9 });
    const harness = new THREE.Group();
    harness.visible = false;
    g.add(harness);
    const strap = (A, B) => {
        const m = new THREE.Mesh(boxGeo(0.07, 1, 0.015), strapMat);
        seg(m, A, B);
        harness.add(m);
    };
    for (const sd of [-1, 1]) {
        strap(new THREE.Vector3(e.x + sd * 0.17, e.y - 0.12, e.z + 0.2), new THREE.Vector3(e.x - sd * 0.04, e.y - 0.78, e.z - 0.02));
        strap(new THREE.Vector3(e.x + sd * 0.22, e.y - 0.8, e.z + 0.1), new THREE.Vector3(e.x + sd * 0.03, e.y - 0.78, e.z - 0.04));
    }
    box(harness, 0.07, 0.07, 0.03, M.brass(), e.x, e.y - 0.78, e.z - 0.05);
    it.harness = harness;
    // master warning row: dark until the cabin loses pressure, then flashing red
    const warnMats = [];
    if (o.warn) {
        for (let i = 0; i < 7; i++) {
            const wm = new THREE.MeshBasicMaterial({ color: 0x2a0606 });
            warnMats.push(wm);
            const b = new THREE.Mesh(boxGeo(0.045, 0.02, 0.03), wm);
            b.position.set(e.x - 0.24 + i * 0.08, o.warn[0], o.warn[1]);
            g.add(b);
        }
    }
    it.extra.push((st) => {
        const on = st.alarm && st.flash;
        for (const wm of warnMats) wm.color.setHex(on ? 0xff2020 : 0x2a0606);
    });
    it.extra.push((st) => {
        const rud = st.rudder || 0;
        pedals[0].position.z = e.z - 0.8 + 0.05 * (rud > 0 ? -rud : 0) + 0.02 * (rud < 0 ? -rud : 0);
        pedals[1].position.z = e.z - 0.8 + 0.05 * (rud < 0 ? rud : 0) - 0.02 * (rud > 0 ? rud : 0);
        for (let i = 0; i < 2; i++) {
            const sd = i === 0 ? 1 : -1;                                                           // 0 = right
            S[i].set(e.x + sd * 0.2, e.y - 0.32, e.z + 0.12);
            const src = (o.hands || [])[i];
            if (!src) {
                H[i].set(e.x + sd * 0.2, e.y - 0.78, e.z - 0.12);
            } else if (src.yoke !== undefined) {
                const y = it.yokes[src.yoke].obj;
                H[i].set(src.off[0], src.off[1], src.off[2]).applyEuler(y.rotation).add(y.position);
            } else if (src.lever !== undefined) {
                const l = it.levers[src.lever].obj;
                H[i].copy(l.position).add(_v.set(0, 0.11, 0));
            } else if (src.coll !== undefined) {
                const c = it.collectives[src.coll].obj;
                H[i].set(0, 0.02, -0.38).applyEuler(c.rotation).add(c.position);
            }
            E[i].copy(S[i]).add(H[i]).multiplyScalar(0.5).add(_v.set(sd * 0.13, -0.14, 0.07));
            seg(arms[i].a, S[i], E[i]);
            seg(arms[i].b, E[i], H[i]);
            arms[i].end.position.copy(H[i]);
            hip.set(e.x + sd * 0.12, e.y - 0.82, e.z + 0.5);
            knee.set(e.x + sd * 0.15, e.y - 0.6, e.z - 0.12);
            foot.set(pedals[i === 0 ? 1 : 0].position.x, fl + 0.14, pedals[i === 0 ? 1 : 0].position.z - 0.02);
            seg(legs[i].a, hip, knee);
            seg(legs[i].b, knee, foot);
            legs[i].end.position.copy(foot).add(_v.set(0, 0.0, -0.06));
        }
    });
    it.update({ rudder: 0, redraw: false, steer: 0, pitchIn: 0, throttle: 0, collective: 0 });
    return it;
}

// ---- interiors -------------------------------------------------------------------------------
/** Original Cessna-style: basic cream cabin, steam gauges, yokes, two seats. */
export function buildCubInterior(root) {
    const it = makeInterior(root, new THREE.Vector3(-0.38, 2.02, -0.55));
    const g = it.group;
    shell(g, { half: 0.72, floor: 0.74, belt: 1.55, roof: 2.17, z0: -1.9, z1: 2.4 });
    box(g, 1.4, 0.35, 0.6, M.panel(), 0, 1.62, -1.7);          // dash
    box(g, 1.4, 0.04, 0.3, M.black(), 0, 1.84, -1.85, [0.12, 0, 0]); // glare shield
    addPanelBoard(it, 0.62, 0.38, -0.4, 1.7, -1.4, -0.45, { rim: '#999' });
    addPanelBoard(it, 0.34, 0.2, 0.25, 1.68, -1.4, -0.45, { rim: '#999' });
    addYoke(it, -0.38, 1.3, -1.0);
    addYoke(it, 0.38, 1.3, -1.0);
    addThrottle(it, 0.0, 1.38, -1.35);
    box(g, 0.28, 0.5, 0.5, M.panel(), 0, 1.05, -0.8);          // centre console
    addSeat(g, -0.38, 0.95, 0.15, M.leatherGrey());
    addSeat(g, 0.38, 0.95, 0.15, M.leatherGrey());
    box(g, 1.3, 0.04, 1.4, M.cream(), 0, 0.7, 1.6);            // rear bay
    return finish(it, { floor: 0.74, frame: { x0: 0.74, zf: -1.78, zr: 1.5, yb: 1.55, yt: 2.17, mids: [0.3], tilt: 0.5 }, warn: [1.835, -1.62], hands: [{ yoke: 0, off: [0.16, 0.04, 0] }, { yoke: 0, off: [-0.16, 0.04, 0] }], sleeve: 0xdde3ea, trouser: 0x3a3f4a, radio: [0.62, 1.58, -1.62], compass: [0, 1.88, -1.78] });
}

/** Biplane: open cockpit, wooden coaming, a stick and a handful of dials. */
function buildBiplaneInterior(root) {
    const it = makeInterior(root, new THREE.Vector3(0, 1.85, 0.45));
    const g = it.group;
    shell(g, { half: 0.46, floor: 0.7, belt: 1.55, z0: -0.1, z1: 1.2, mat: M.leather(), rear: false });
    box(g, 0.75, 0.08, 0.1, M.leather(), 0, 1.62, 1.06);        // padded coaming (rear)
    box(g, 0.1, 0.08, 0.75, M.leather(), -0.38, 1.62, 0.7);
    box(g, 0.1, 0.08, 0.75, M.leather(), 0.38, 1.62, 0.7);
    box(g, 0.75, 0.22, 0.05, M.wood(), 0, 1.58, -0.12);          // wooden panel
    addPanelBoard(it, 0.48, 0.3, 0, 1.68, -0.1, -0.5, { rim: '#b08d3c', bg: '#241d12' });
    addYoke(it, 0, 1.0, 0.3, 'stick');
    addThrottle(it, -0.32, 1.1, 0.45, 0.1, M.brass());
    addSeat(g, 0, 0.9, 0.78, M.leather());
    cyl(g, 0.012, 0.5, M.black(), 0.3, 1.55, -0.35, 'x');       // goggles strap hook
    box(g, 0.2, 0.1, 0.02, M.brass(), 0.28, 1.55, 0.02);        // plaque
    return finish(it, { floor: 0.7, frame: null, wind: { x0: 0.3, yb: 1.62, yt: 1.98, z: -0.25, tilt: 0.7 }, hands: [{ yoke: 0, off: [0, 0.36, 0] }, { lever: 0 }], sleeve: 0x5a3a22, glove: 0x2a1c10, trouser: 0x4a3a28, frameMat: M.brass(), compass: [0.22, 1.74, -0.1] });
}

/** Twin turboprop: wide panel, dual yokes, two-lever quadrant, overhead panel, 4 club seats. */
function buildTwinInterior(root) {
    const it = makeInterior(root, new THREE.Vector3(-0.42, 2.25, -1.75));
    const g = it.group;
    shell(g, { half: 0.92, floor: 0.82, belt: 1.95, roof: 2.62, z0: -3.2, z1: 4.6 });
    box(g, 1.7, 0.4, 0.55, M.panel(), 0, 1.7, -2.5);
    box(g, 1.7, 0.04, 0.25, M.black(), 0, 1.94, -2.62, [0.1, 0, 0]);
    addPanelBoard(it, 0.7, 0.42, -0.45, 1.78, -2.2, -0.5, { rim: '#ccc', bg: '#17191c' });
    addPanelBoard(it, 0.42, 0.26, 0.28, 1.76, -2.2, -0.5, { rim: '#ccc', bg: '#17191c' });
    addPanelBoard(it, 0.34, 0.22, 0.7, 1.74, -2.2, -0.5, { rim: '#ccc', bg: '#17191c' });
    box(g, 0.5, 0.06, 0.9, M.panel(), 0, 2.28, -2.0);           // overhead switch panel
    for (let i = 0; i < 6; i++) box(g, 0.04, 0.03, 0.03, i % 2 ? M.red() : M.yellow(), -0.2 + i * 0.08, 2.24, -2.0);
    box(g, 0.34, 0.42, 0.9, M.panel(), 0, 1.15, -1.9);          // pedestal
    addThrottle(it, -0.06, 1.4, -2.05, 0.14, M.black());
    addThrottle(it, 0.06, 1.4, -2.05, 0.14, M.black());
    addYoke(it, -0.42, 1.4, -1.55);
    addYoke(it, 0.42, 1.4, -1.55);
    addSeat(g, -0.42, 1.0, -0.95, M.leatherGrey());
    addSeat(g, 0.42, 1.0, -0.95, M.leatherGrey());
    for (const z of [0.5, 1.9]) {                               // club seating
        addSeat(g, -0.55, 1.0, z, M.leather(), -1);
        addSeat(g, 0.55, 1.0, z, M.leather(), -1);
    }
    box(g, 0.5, 0.05, 0.6, M.wood(), 0, 1.15, 1.2);            // table
    box(g, 0.1, 0.2, 0.05, M.black(), 0, 1.1, 1.2);
    return finish(it, { floor: 0.82, frame: { x0: 0.94, zf: -3.15, zr: 1.6, yb: 1.95, yt: 2.6, mids: [-1.3, 0.2], tilt: 0.55, roofGlass: true }, warn: [1.945, -2.42], hands: [{ yoke: 0, off: [0.16, 0.04, 0] }, { yoke: 0, off: [-0.16, 0.04, 0] }], sleeve: 0xf4f4f4, trouser: 0x1c2a4a, radio: [0.0, 1.55, -2.1], compass: [0.1, 1.98, -2.4] });
}

/** Business jet: glass cockpit, sidesticks, white leather cabin with a divan and a galley. */
function buildBizjetInterior(root) {
    const it = makeInterior(root, new THREE.Vector3(-0.42, 2.05, -4.6));
    const g = it.group;
    shell(g, { half: 1.1, floor: 0.68, belt: 1.65, roof: 2.65, z0: -5.7, z1: 6.0, mat: M.white() });
    box(g, 1.7, 0.45, 0.6, M.panel(), 0, 1.45, -5.55);
    box(g, 1.7, 0.04, 0.25, M.black(), 0, 1.7, -5.7, [0.12, 0, 0]);
    addPanelBoard(it, 0.5, 0.4, -0.6, 1.62, -5.5, -0.35, null, true);
    addPanelBoard(it, 0.5, 0.4, -0.05, 1.62, -5.5, -0.35, null, true);
    addPanelBoard(it, 0.5, 0.4, 0.5, 1.62, -5.5, -0.35, null, true);
    addPanelBoard(it, 0.34, 0.26, 0.0, 1.3, -5.3, -0.8, null, true);
    box(g, 0.3, 0.3, 1.3, M.panel(), 0, 1.0, -4.5);             // pedestal
    addThrottle(it, -0.06, 1.2, -4.6, 0.16, M.dark());
    addThrottle(it, 0.06, 1.2, -4.6, 0.16, M.dark());
    addYoke(it, -0.8, 1.15, -4.55, 'stick');
    addYoke(it, 0.8, 1.15, -4.55, 'stick');
    addSeat(g, -0.42, 0.85, -3.95, M.leatherGrey());
    addSeat(g, 0.42, 0.85, -3.95, M.leatherGrey());
    for (const z of [-2.2, -0.6, 1.0]) {                        // cabin: facing pairs of white leather
        addSeat(g, -0.7, 0.8, z, M.white());
        addSeat(g, 0.7, 0.8, z, M.white());
    }
    box(g, 0.5, 0.05, 1.8, M.wood(), 0, 1.0, -1.4);             // fold-out table
    box(g, 0.9, 0.35, 1.6, M.white(), 0, 0.55, 4.0);            // divan
    box(g, 0.9, 0.5, 0.15, M.white(), 0, 0.85, 4.9);
    box(g, 0.9, 1.1, 0.8, M.wood(), -0.2, 0.7, 5.8);            // galley / lavatory
    return finish(it, { floor: 0.68, frame: { x0: 1.08, zf: -6.0, zr: -0.9, yb: 1.66, yt: 2.74, mids: [-4.4, -2.9, -1.7], tilt: 0.8 }, warn: [1.7, -5.62], hands: [{ yoke: 0, off: [0, 0.36, 0] }, { lever: 0 }], sleeve: 0xf4f4f4, trouser: 0x151d33, radio: [0.0, 1.0, -4.9] });
}

/** Fighter: bubble canopy, HUD glass, centre stick, side throttle, ejection seat, missile switches. */
function buildFighterInterior(root) {
    const it = makeInterior(root, new THREE.Vector3(0, 1.6, -1.55));
    const g = it.group;
    shell(g, { half: 0.64, floor: 0.86, belt: 1.45, z0: -2.5, z1: 0.1, mat: M.dark() });
    box(g, 0.9, 0.4, 0.8, M.dark(), 0, 1.1, -2.5, [-0.25, 0, 0]);
    addPanelBoard(it, 0.34, 0.26, 0, 1.28, -2.3, -0.65, null, true);        // MFD
    addPanelBoard(it, 0.22, 0.22, -0.3, 1.25, -2.3, -0.65, { rim: '#999', bg: '#0e1013' });
    addPanelBoard(it, 0.22, 0.22, 0.3, 1.25, -2.3, -0.65, { rim: '#999', bg: '#0e1013' });
    const hud = makeGlassPanel(0.36, 0.26, true);                            // head-up display
    hud.mesh.position.set(0, 1.68, -2.0);
    hud.mesh.rotation.x = -0.2;
    g.add(hud.mesh);
    it.panels.push(hud);
    box(g, 0.5, 0.05, 0.05, M.metal(), 0, 1.5, -2.2);                        // HUD combiner frame
    box(g, 0.02, 0.3, 0.02, M.metal(), -0.2, 1.62, -2.0);
    box(g, 0.02, 0.3, 0.02, M.metal(), 0.2, 1.62, -2.0);
    addYoke(it, 0, 0.78, -1.5, 'stick');
    box(g, 0.2, 0.3, 1.0, M.dark(), -0.5, 0.95, -1.6);                       // left console
    box(g, 0.2, 0.3, 1.0, M.dark(), 0.5, 0.95, -1.6);
    addThrottle(it, -0.5, 1.12, -1.55, 0.3, M.red());
    for (let i = 0; i < 4; i++) box(g, 0.04, 0.02, 0.04, i % 2 ? M.red() : M.yellow(), 0.42 + (i % 2) * 0.08, 1.12, -1.8 + Math.floor(i / 2) * 0.1);
    box(g, 0.7, 0.12, 0.7, M.dark(), 0, 0.7, -0.8);                          // ejection seat
    box(g, 0.6, 1.0, 0.12, M.dark(), 0, 1.25, -0.4);
    box(g, 0.34, 0.25, 0.1, M.dark(), 0, 1.9, -0.35);
    box(g, 0.1, 0.1, 0.1, M.yellow(), 0, 1.5, -0.3);                         // pull handle
    cyl(g, 0.025, 0.7, M.black(), 0, 1.78, -0.9, 'z', 0.025);                // canopy bow
    box(g, 0.08, 0.06, 1.4, M.metal(), -0.62, 1.55, -1.3);                   // canopy rails
    box(g, 0.08, 0.06, 1.4, M.metal(), 0.62, 1.55, -1.3);
    return finish(it, { floor: 0.86, frame: { x0: 0.62, zf: -2.45, zr: 0.3, yb: 1.45, yt: 2.35, mids: [-1.4], tilt: 0.8, roofGlass: true }, warn: [1.46, -2.38], hands: [{ yoke: 0, off: [0, 0.36, 0] }, { lever: 0 }], sleeve: 0x55603f, glove: 0x1a1a1a, trouser: 0x55603f, compass: null });
}

// ---- helicopter interiors ---------------------------------------------------------------------
function addCollective(it, x, y, z) {
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    grp.rotation.x = -0.3;
    cyl(grp, 0.018, 0.5, M.black(), 0, 0, -0.2, 'z');
    it.group.add(grp);
    it.collectives.push({ obj: grp, r0: -0.3 });
}
function addHeliFront(it, deco) {
    const g = it.group;
    shell(g, { half: deco.half || 0.88, floor: 0.7, belt: 1.35, roof: 2.3, z0: -1.1, z1: deco.len || 1.5, mat: deco.lining });
    box(g, 1.5, 0.3, 0.5, M.panel(), 0, 1.35, -1.55);
    box(g, 1.5, 0.04, 0.25, M.black(), 0, 1.52, -1.66, [0.1, 0, 0]);
    addPanelBoard(it, 0.55, 0.34, -0.38, 1.45, -1.3, -0.5, deco.style || { rim: '#bbb' });
    addPanelBoard(it, 0.32, 0.2, 0.25, 1.43, -1.3, -0.5, deco.style || { rim: '#bbb' });
    addYoke(it, -0.38, 0.75, -0.9, 'stick');                  // cyclic between the pilot's knees
    addYoke(it, 0.38, 0.75, -0.9, 'stick');
    addCollective(it, -0.78, 0.82, -0.4);
    addCollective(it, 0.78, 0.82, -0.4);
    addSeat(g, -0.38, 0.62, -0.1, deco.seat);
    addSeat(g, 0.38, 0.62, -0.1, deco.seat);
    box(g, 0.2, 0.05, 0.35, M.metal(), 0, 1.6, -0.9);          // overhead circuit-breaker row
}

function buildLightHeliInterior(root) {
    const it = makeInterior(root, new THREE.Vector3(-0.38, 1.9, -0.5));
    addHeliFront(it, { seat: M.leatherGrey(), style: { rim: '#aaa' }, len: 1.6 });
    box(it.group, 1.3, 0.1, 0.8, M.cream(), 0, 0.7, 1.1);      // bench seat
    box(it.group, 1.3, 0.55, 0.1, M.cream(), 0, 1.0, 1.55);
    return finish(it, { floor: 0.7, frame: { x0: 0.72, zf: -1.62, zr: 0.7, yb: 1.5, yt: 2.3, mids: [], tilt: 0.5 }, warn: [1.535, -1.6], hands: [{ yoke: 0, off: [0, 0.36, 0] }, { coll: 0 }], sleeve: 0xdde3ea, trouser: 0x3a3f4a, radio: [0.0, 1.62, -0.9] });
}

/** Rescue: stretcher, oxygen, monitor and a winch above the sliding door. */
function buildRescueInterior(root) {
    const it = makeInterior(root, new THREE.Vector3(-0.45, 1.9, -0.5));
    addHeliFront(it, { seat: M.dark(), style: { rim: '#ff8a65', bg: '#14181c' }, len: 3.0, half: 1.05, lining: M.white() });
    const g = it.group;
    box(g, 0.7, 0.12, 2.0, M.white(), 0.35, 0.85, 1.9);        // stretcher
    box(g, 0.66, 0.08, 1.9, M.red(), 0.35, 0.93, 1.9);
    box(g, 0.5, 0.22, 0.4, M.white(), 0.35, 1.08, 1.0);         // pillow
    box(g, 0.5, 0.5, 0.35, M.dark(), -0.7, 1.15, 1.0);          // monitor rack
    box(g, 0.36, 0.26, 0.04, M.black(), -0.7, 1.3, 0.8);
    cyl(g, 0.08, 0.5, M.white(), -0.8, 0.95, 2.6);              // oxygen bottles
    cyl(g, 0.08, 0.5, M.white(), -0.62, 0.95, 2.6);
    box(g, 0.5, 0.45, 0.45, M.red(), -0.7, 0.75, 1.9);          // medical bags
    cyl(g, 0.12, 0.3, M.metal(), 1.0, 2.35, 0.9, 'z');          // rescue winch
    box(g, 0.05, 0.5, 0.05, M.black(), 1.0, 2.0, 0.9);
    addSeat(g, -0.65, 0.62, 3.0, M.dark(), -1);
    return finish(it, { floor: 0.7, frame: { x0: 0.78, zf: -1.62, zr: 0.8, yb: 1.5, yt: 2.3, mids: [], tilt: 0.5 }, warn: [1.535, -1.6], hands: [{ yoke: 0, off: [0, 0.36, 0] }, { coll: 0 }], sleeve: 0xff7a1a, trouser: 0xff7a1a, radio: [0.0, 1.62, -0.9] });
}

/** News: swivel camera operator seat, monitors with a colourful test card, a gimbal camera arm. */
function buildNewsInterior(root) {
    const it = makeInterior(root, new THREE.Vector3(0.45, 1.9, -0.5));
    addHeliFront(it, { seat: M.leatherGrey(), style: { rim: '#4aa3ff', bg: '#111820' }, len: 2.5, half: 0.98 });
    const g = it.group;
    const cv = makeCanvas();
    cv.width = 128;
    cv.height = 72;
    const c = cv.getContext('2d');
    ['#fff', '#ff0', '#0ff', '#0f0', '#f0f', '#f00', '#00f'].forEach((col, i) => {
        c.fillStyle = col;
        c.fillRect(i * 18, 0, 18, 72);
    });
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.MeshBasicMaterial({ map: tex });
    box(g, 1.1, 0.7, 0.1, M.black(), -0.2, 1.65, 0.8);          // monitor wall
    for (let i = 0; i < 3; i++) {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.55 * 0.6), screen);
        s.position.set(-0.55 + i * 0.35, 1.65, 0.745);
        s.rotation.y = Math.PI;
        g.add(s);
    }
    addSeat(g, -0.45, 0.62, 1.3, M.leather(), -1);               // reporter
    addSeat(g, 0.45, 0.62, 1.3, M.dark(), -1);                   // camera operator
    box(g, 0.2, 0.05, 0.2, M.black(), 0.9, 1.25, 1.3);           // camera arm mounted at the door
    cyl(g, 0.02, 0.5, M.metal(), 0.9, 1.0, 1.3);
    ball(g, 0.12, 0.12, 0.2, M.black(), 0.9, 1.3, 1.1);
    box(g, 0.8, 0.12, 0.35, M.dark(), 0, 0.9, 2.1);              // equipment racks
    box(g, 0.8, 0.05, 0.6, M.white(), 0, 0.75, 2.4);
    return finish(it, { floor: 0.7, frame: { x0: 0.75, zf: -1.62, zr: 0.8, yb: 1.5, yt: 2.3, mids: [], tilt: 0.5 }, warn: [1.535, -1.6], hands: [{ yoke: 1, off: [0, 0.36, 0] }, null], sleeve: 0x1c2a40, trouser: 0x1c1c22, radio: [0.0, 1.62, -0.9] });
}

/** Military: bare ribbed cabin, red-webbing bench seats, door gun, ammo cans, NVG case. */
function buildMilitaryInterior(root) {
    const it = makeInterior(root, new THREE.Vector3(-0.45, 1.9, -0.5));
    addHeliFront(it, { seat: M.olive(), style: { rim: '#6f7b4d', bg: '#0f120c' }, len: 3.6, half: 1.2, lining: M.olive() });
    const g = it.group;
    for (const side of [-1, 1]) {
        box(g, 0.45, 0.07, 2.6, M.red(), side * 0.95, 0.75, 2.2);        // webbing bench along the wall
        box(g, 0.08, 0.5, 2.6, M.olive(), side * 1.2, 1.0, 2.2);
    }
    for (let i = 0; i < 4; i++) box(g, 0.05, 1.2, 0.08, M.dark(), 1.18 * (i % 2 ? 1 : -1), 1.5, 1.0 + Math.floor(i / 2) * 1.4); // ribs
    cyl(g, 0.035, 0.9, M.black(), 1.15, 1.35, 1.0, 'z');                // door gun on a pintle
    box(g, 0.1, 0.12, 0.35, M.black(), 1.15, 1.3, 0.75);
    box(g, 0.05, 0.4, 0.05, M.metal(), 1.15, 1.1, 1.0);
    box(g, 0.35, 0.25, 0.2, M.olive(), 0.95, 0.95, 1.1);                 // ammo cans
    box(g, 0.35, 0.25, 0.2, M.olive(), 0.95, 0.95, 1.4);
    box(g, 0.5, 0.35, 0.6, M.olive(), 0, 0.7, 3.4);                      // crates
    return finish(it, { floor: 0.7, frame: { x0: 0.82, zf: -1.62, zr: 0.9, yb: 1.5, yt: 2.3, mids: [], tilt: 0.5 }, warn: [1.535, -1.6], hands: [{ yoke: 0, off: [0, 0.36, 0] }, { coll: 0 }], sleeve: 0x4d5a3a, glove: 0x1a1a1a, trouser: 0x4d5a3a, frameMat: M.olive(), radio: [0.0, 1.62, -0.9] });
}

// ---- exteriors -------------------------------------------------------------------------------
function tailGroup(root, body, y, z, span = 3.4, finH = 1.5, finRot = 0) {
    box(root, span, 0.12, 0.9, body, 0, y, z);
    box(root, 0.12, finH, 1.2, body, 0, y + finH / 2, z - 0.1, [finRot, 0, 0]);
}
function addWheels(root, mains, nose, r = 0.34) {
    for (const [x, y, z] of mains) {
        cyl(root, r, 0.22, M.black(), x, y, z, 'x', r, 12);
        cyl(root, 0.04, y, M.metal(), x * 0.9, y + y * 0.5, z);
    }
    if (nose) {
        cyl(root, r * 0.85, 0.2, M.black(), nose[0], nose[1], nose[2], 'x', r * 0.85, 12);
        cyl(root, 0.04, nose[1] + 0.2, M.metal(), nose[0], nose[1] + 0.6, nose[2]);
    }
}
function makeProp(root, x, y, z, r = 1.1, blades = 2, color = M.black()) {
    const p = new THREE.Group();
    p.position.set(x, y, z);
    cyl(p, 0.14, 0.3, M.metal(), 0, 0, 0, 'z');
    for (let i = 0; i < blades; i++) {
        const b = new THREE.Mesh(boxGeo(0.15, r * 2, 0.05), color);
        b.rotation.z = (i * Math.PI) / blades;
        p.add(b);
    }
    root.add(p);
    return p;
}

function buildBiplane(color) {
    const root = new THREE.Group();
    const body = bodyMat(color);
    const wingMat = bodyMat(0xe8dcc0);
    box(root, 0.95, 1.05, 4.6, body, 0, 1.15, 0.5);
    box(root, 0.65, 0.65, 2.6, body, 0, 1.2, 3.6, [0.08, 0, 0]);
    cyl(root, 0.62, 1.0, M.dark(), 0, 1.15, -2.3, 'z', 0.55, 16);             // radial engine cowl
    for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        cyl(root, 0.07, 0.3, M.metal(), Math.cos(a) * 0.45, 1.15 + Math.sin(a) * 0.45, -2.85, 'z');
    }
    for (const [y, z, span] of [[2.25, -0.4, 8.6], [0.95, -0.2, 7.8]]) {      // two wings
        box(root, span, 0.12, 1.45, wingMat, 0, y, z);
        box(root, 0.5, 0.14, 1.45, M.red(), span * 0.42, y, z);
        box(root, 0.5, 0.14, 1.45, M.red(), -span * 0.42, y, z);
    }
    for (const side of [-1, 1]) {                                              // interplane struts + wires
        for (const z of [-0.8, 0.2]) box(root, 0.06, 1.4, 0.06, M.wood(), side * 2.6, 1.6, z);
        box(root, 0.04, 1.5, 0.04, M.metal(), side * 0.5, 1.7, -0.2, [0, 0, side * 0.5]);
    }
    tailGroup(root, body, 1.25, 4.8, 3.0, 1.3);
    addWheels(root, [[-0.85, 0.34, -1.1], [0.85, 0.34, -1.1]], null);
    cyl(root, 0.07, 0.2, M.black(), 0, 0.2, 5.0, 'x');                         // tail skid
    const props = [makeProp(root, 0, 1.15, -3.0, 1.2, 2, M.wood())];
    const interior = buildBiplaneInterior(root);
    shadows(root);
    return { root, propellers: props, spinners: [], interior };
}

function buildTwin(color) {
    const root = new THREE.Group();
    const body = bodyMat(color);
    const trim = bodyMat(0x1c3c78);
    box(root, 1.9, 1.9, 8.8, body, 0, 1.7, 0.4);
    box(root, 1.2, 1.2, 4.4, body, 0, 1.75, 6.2, [0.06, 0, 0]);
    cyl(root, 0.7, 1.6, body, 0, 1.5, -4.6, 'z', 0.95, 14);                    // nose
    for (const side of [-1, 1]) {
        box(root, 0.06, 0.5, 5.5, M.glass(), side * 0.96, 2.25, 0.9);          // cabin windows
        box(root, 7.2, 0.18, 2.0, body, side * 4.3, 1.1, 0.8);                // low wing halves
        box(root, 0.5, 0.14, 2.0, trim, side * 7.7, 1.1, 0.8);
        cyl(root, 0.5, 3.2, body, side * 3.3, 1.2, -0.2, 'z');                // engine nacelle
        cyl(root, 0.35, 0.6, M.dark(), side * 3.3, 1.2, -1.95, 'z', 0.5);
        box(root, 0.06, 0.1, 0.3, M.lightGreenRed(side), side * 7.9, 1.2, 0.8);
        addWheels(root, [[side * 3.3, 0.38, 0.5]], null, 0.38);
    }
    tailGroup(root, body, 2.0, 7.7, 4.4, 2.2);
    for (const side of [-1, 1]) box(root, 0.05, 0.14, 8.8, trim, side * 0.96, 1.25, 0.4); // cheat line
    addWheels(root, [], [0, 0.38, -3.4], 0.34);
    const props = [makeProp(root, -3.3, 1.2, -2.1, 1.4, 3, M.black()), makeProp(root, 3.3, 1.2, -2.1, 1.4, 3, M.black())];
    const interior = buildTwinInterior(root);
    shadows(root);
    return { root, propellers: props, spinners: [], interior };
}
M.lightGreenRed = (side) => mat(side < 0 ? 0xff2222 : 0x22ff44);

function buildBizjet(color) {
    const root = new THREE.Group();
    const body = bodyMat(color);
    const trim = bodyMat(0x23406b);
    const fus = new THREE.Mesh(cylGeo(1.15, 1.15, 12.5, 18), body);
    fus.rotation.x = Math.PI / 2;
    fus.position.set(0, 1.6, 0.3);
    root.add(fus);
    const nose = new THREE.Mesh(geo('nose12', () => new THREE.CylinderGeometry(0.12, 1.15, 3.4, 18, 1, true)), body);              // pointed nose
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, 1.55, -7.6);
    root.add(nose);
    const tail = new THREE.Mesh(geo('tail115', () => new THREE.CylinderGeometry(1.15, 0.35, 4.4, 18, 1, true)), body);
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(0, 1.75, 8.7);
    root.add(tail);
    for (let i = 0; i < 7; i++) for (const side of [-1, 1]) box(root, 0.04, 0.32, 0.45, M.glass(), side * 1.15, 1.95, -3.2 + i * 1.1);
    for (const side of [-1, 1]) {
        const w = box(root, 7.0, 0.14, 2.2, body, side * 4.6, 1.15, 1.6, [0, -side * 0.45, side * 0.03]); // swept wing
        w.position.z = 1.6 + 1.6;
        box(root, 0.8, 0.5, 0.06, M.dark(), side * 8.0, 1.5, 4.0, [0, 0, side * 0.3]);   // winglet
        cyl(root, 0.5, 2.6, body, side * 1.8, 2.0, 6.8, 'z', 0.42, 14);               // rear engine pods
        cyl(root, 0.4, 0.2, M.dark(), side * 1.8, 2.0, 5.5, 'z');
        cyl(root, 0.3, 0.2, mat(0xff6a1a, { emissive: 0x7a2000 }), side * 1.8, 2.0, 8.2, 'z');
        box(root, 0.35, 0.4, 1.4, body, side * 1.3, 1.9, 6.0);
    }
    box(root, 0.16, 2.8, 2.2, body, 0, 3.5, 9.6, [0.35, 0, 0]);                  // T-tail
    box(root, 4.2, 0.12, 1.4, body, 0, 4.9, 10.2);
    for (const side of [-1, 1]) box(root, 0.05, 0.16, 12.0, trim, side * 1.14, 1.35, 0.3);    // cheat line
    addWheels(root, [[-1.3, 0.4, 2.0], [1.3, 0.4, 2.0]], [0, 0.38, -5.0], 0.4);
    const interior = buildBizjetInterior(root);
    shadows(root);
    return { root, propellers: [], spinners: [], interior };
}

function buildFighter(color) {
    const root = new THREE.Group();
    const body = bodyMat(color);
    const dark = mat(0x2a2d33, { roughness: 0.5, metalness: 0.5 });
    const fus = new THREE.Mesh(cylGeo(0.75, 0.85, 11, 14), body);
    fus.rotation.x = Math.PI / 2;
    fus.position.set(0, 1.5, 2.5);
    root.add(fus);
    const nose = new THREE.Mesh(geo('nose06', () => new THREE.CylinderGeometry(0.06, 0.75, 4.0, 14, 1, true)), body);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, 1.5, -5.1);
    root.add(nose);
    box(root, 0.06, 0.06, 1.6, M.metal(), 0, 1.5, -7.6);                          // pitot boom
    const canopy = ball(root, 0.62, 0.55, 1.6, M.glass(), 0, 2.0, -1.5);          // bubble canopy
    canopy.rotation.x = 0.04;
    box(root, 2.6, 0.12, 1.3, dark, 0, 1.3, 6.0);                                  // inlet shadow
    for (const side of [-1, 1]) {
        box(root, 0.7, 0.9, 3.0, body, side * 0.95, 1.3, -0.6);                   // intakes
        box(root, 0.5, 0.6, 0.1, M.black(), side * 0.95, 1.3, -2.15);
        const wing = box(root, 4.6, 0.1, 3.6, body, side * 2.9, 1.25, 2.6, [0, -side * 0.55, 0]); // swept wings
        wing.position.z += 0.4;
        box(root, 0.08, 0.9, 1.5, body, side * 1.0, 2.3, 6.1, [0, 0, side * 0.35]); // twin canted fins
        box(root, 2.4, 0.08, 1.4, body, side * 1.9, 1.35, 6.9);                   // tailplanes
        box(root, 0.1, 0.12, 0.8, M.red(), side * 5.0, 1.3, 3.0);                 // wingtip missiles
        cyl(root, 0.1, 2.2, M.white(), side * 4.7, 1.15, 3.0, 'z', 0.1);
        cyl(root, 0.17, 0.5, mat(0xff7a1a, { emissive: 0xaa3300 }), side * 0.55, 1.5, 7.8, 'z', 0.3); // afterburner nozzles
    }
    cyl(root, 0.4, 0.9, dark, 0, 1.5, 6.4, 'z', 0.55);
    addWheels(root, [[-1.0, 0.36, 3.1], [1.0, 0.36, 3.1]], [0, 0.32, -2.6], 0.32);
    const interior = buildFighterInterior(root);
    shadows(root);
    return { root, propellers: [], spinners: [], interior };
}

function heliSpinners(h) {
    return [{ obj: h.rotor, axis: 'y', k: 45 }, { obj: h.tailRotor, axis: 'x', k: 100 }];
}
const HELI_SIZE = { light: { len: 1.8, width: 1.0 }, rescue: { len: 3.2, width: 1.25 }, news: { len: 2.6, width: 1.1 }, military: { len: 3.8, width: 1.35 } };
function buildHeli(type, color) {
    const h = createHelicopterMesh(color, type, HELI_SIZE[type]);
    const root = h.root;
    let interior;
    if (type === 'rescue') {
        // bigger cabin with a red cross, sliding door and a rescue light bar
        const s = bodyMat(0xf2f2f2);
        box(root, 2.2, 0.05, 4.6, M.red(), 0, 2.35, 0.8);
        box(root, 0.08, 0.7, 0.5, M.red(), 1.1, 1.6, 0.4);
        box(root, 0.5, 0.08, 0.5, M.red(), 1.1, 1.6, 0.4);
        box(root, 0.8, 0.12, 0.3, mat(0xff2200, { emissive: 0xaa1100 }), 0, 2.5, -0.9);
        box(root, 0.1, 1.0, 2.4, s, 1.1, 1.4, 1.8);
        interior = buildRescueInterior(root);
    } else if (type === 'news') {
        // gimbal camera ball under the nose and an antenna mast
        ball(root, 0.28, 0.28, 0.28, M.black(), 0, 0.55, -1.8);
        box(root, 0.06, 0.06, 0.6, M.black(), 0, 0.55, -2.0);
        cyl(root, 0.02, 0.9, M.metal(), 0, 2.7, 3.2);
        box(root, 1.0, 0.3, 0.06, M.white(), 0, 1.9, 2.2);
        interior = buildNewsInterior(root);
    } else if (type === 'military') {
        // door gun barrel, rocket pods and a darker olive paint
        cyl(root, 0.04, 1.3, M.black(), 1.2, 1.5, -0.3, 'z');
        for (const side of [-1, 1]) {
            cyl(root, 0.22, 1.6, M.olive(), side * 1.5, 1.0, 0.0, 'z');
            cyl(root, 0.15, 0.2, M.black(), side * 1.5, 1.0, -0.85, 'z');
        }
        interior = buildMilitaryInterior(root);
    } else {
        interior = buildLightHeliInterior(root);
    }
    shadows(root);
    return { root, propellers: [], spinners: heliSpinners(h), interior };
}

// ---- catalogue --------------------------------------------------------------------------------
/**
 * Flight tuning is merged over PLANE_CONFIG (planes) or the Helicopter defaults.
 * `dims`: length / width / height / radius of the collision body; `eye`: where the pilot's head is;
 * `chase`: the third-person camera distance.
 */
export const AIRCRAFT = {
    cub: {
        name: 'Piper Cub', kind: 'plane', colors: [0xf2f2f2, 0xf5d142, 0x6fb7ff, 0xff8a65],
        dims: { length: 9.5, width: 7.0, height: 3.0, radius: 5.6, circleRadius: 1.9 },
        eye: [-0.38, 2.02, -0.55], chase: { chaseDistance: 17, chaseHeight: 4.8, targetLookHeight: 1.8 },
        stats: {}, interior: buildCubInterior, open: true
    },
    biplane: {
        name: 'Stunt Biplane', kind: 'plane', colors: [0xd8262b, 0xf2c200, 0x2e6bd1],
        dims: { length: 8.2, width: 6.5, height: 3.0, radius: 5.0, circleRadius: 1.7 },
        eye: [0, 1.85, 0.45], chase: { chaseDistance: 15, chaseHeight: 4.5, targetLookHeight: 1.6 },
        stats: { MAX_SPEED: 58, STALL_SPEED: 18, ROTATE_SPEED: 19, ACCEL: 9, PITCH_RATE: 1.4, ROLL_RATE: 3.2, MAX_BANK: 1.35, TURN_RATE_SCALE: 1.8, MAX_PITCH: 0.9, MAX_ALTITUDE: 700, STABILITY: 0.22, ROLL_STAB: 0.35, TURB: 1.4 },
        build: buildBiplane, open: true
    },
    twin: {
        name: 'Twin Turboprop', kind: 'plane', colors: [0xf2f2f2, 0xe9e3d1],
        dims: { length: 12.5, width: 14.8, height: 3.6, radius: 8.0, circleRadius: 2.4 },
        eye: [-0.42, 2.25, -1.75], chase: { chaseDistance: 23, chaseHeight: 6.2, targetLookHeight: 2.0 },
        stats: { MAX_SPEED: 100, STALL_SPEED: 30, ROTATE_SPEED: 32, ACCEL: 12, PITCH_RATE: 0.75, ROLL_RATE: 1.4, MAX_BANK: 0.9, MAX_ALTITUDE: 1800, CRASH_SINK_RATE: 8, STABILITY: 0.45, ROLL_STAB: 0.9, TURB: 0.7 },
        build: buildTwin
    },
    bizjet: {
        name: 'Business Jet', kind: 'plane', colors: [0xf4f4f4, 0xcfd8e3],
        dims: { length: 18.5, width: 16.0, height: 4.5, radius: 10.0, circleRadius: 2.8 },
        eye: [-0.42, 2.05, -4.6], chase: { chaseDistance: 30, chaseHeight: 7.5, targetLookHeight: 2.4 },
        stats: { MAX_SPEED: 170, STALL_SPEED: 42, ROTATE_SPEED: 48, ACCEL: 20, PITCH_RATE: 0.7, ROLL_RATE: 1.3, MAX_BANK: 0.85, TURN_RATE_SCALE: 1.2, GLIDE_SINK: 3, MAX_ALTITUDE: 3000, CRASH_SINK_RATE: 7, GROUND_BRAKE: 18, STABILITY: 0.5, ROLL_STAB: 1.0, TURB: 0.35, RUDDER_RATE: 0.3 },
        build: buildBizjet, jet: true
    },
    fighter: {
        name: 'Fighter Jet', kind: 'plane', colors: [0x7d8590, 0x4d5663, 0xb9c0c8],
        dims: { length: 15.0, width: 10.5, height: 3.8, radius: 8.5, circleRadius: 2.3 },
        eye: [0, 1.6, -1.55], chase: { chaseDistance: 26, chaseHeight: 6.0, targetLookHeight: 2.0 },
        stats: { MAX_SPEED: 270, STALL_SPEED: 55, ROTATE_SPEED: 60, ACCEL: 34, PITCH_RATE: 1.5, ROLL_RATE: 3.6, MAX_BANK: 1.45, TURN_RATE_SCALE: 1.6, MAX_PITCH: 1.0, GLIDE_SINK: 5, MAX_ALTITUDE: 3000, CRASH_SINK_RATE: 8, GROUND_BRAKE: 20, STABILITY: 0.08, ROLL_STAB: 0.12, TURB: 0.35, RUDDER_RATE: 0.6 },
        build: buildFighter, jet: true
    },
    light: {
        name: 'Light Helicopter', kind: 'heli', colors: [0xf2f2f2, 0xc62828, 0x1565c0],
        dims: { length: 9, width: 8.6, height: 3.2, radius: 4.5, circleRadius: 1.6 },
        eye: [-0.38, 1.9, -0.5], chase: { chaseDistance: 15, chaseHeight: 4.5, targetLookHeight: 2.0 },
        stats: { maxSpeed: 55, climb: 7, accel: 5, yawRate: 1.3 }, build: (c) => buildHeli('light', c)
    },
    rescue: {
        name: 'Rescue Helicopter', kind: 'heli', colors: [0xf2f2f2, 0xff7a1a],
        dims: { length: 11, width: 10, height: 3.4, radius: 5.2, circleRadius: 1.8 },
        eye: [-0.45, 1.9, -0.5], chase: { chaseDistance: 17, chaseHeight: 5, targetLookHeight: 2.2 },
        stats: { maxSpeed: 62, climb: 6, accel: 5.5, yawRate: 1.2 }, build: (c) => buildHeli('rescue', c)
    },
    news: {
        name: 'News Helicopter', kind: 'heli', colors: [0x1565c0, 0xf2f2f2, 0xc62828],
        dims: { length: 10, width: 9, height: 3.3, radius: 4.8, circleRadius: 1.7 },
        eye: [0.45, 1.9, -0.5], chase: { chaseDistance: 16, chaseHeight: 4.8, targetLookHeight: 2.0 },
        stats: { maxSpeed: 68, climb: 7.5, accel: 6.5, yawRate: 1.5 }, build: (c) => buildHeli('news', c)
    },
    military: {
        name: 'Military Helicopter', kind: 'heli', colors: [0x4d5a3a, 0x3a3f33],
        dims: { length: 12, width: 11, height: 3.6, radius: 5.6, circleRadius: 1.9 },
        eye: [-0.45, 1.9, -0.5], chase: { chaseDistance: 19, chaseHeight: 5.5, targetLookHeight: 2.2 },
        stats: { maxSpeed: 82, climb: 9, accel: 8, yawRate: 1.7 }, build: (c) => buildHeli('military', c)
    }
};
export const PLANE_TYPES = Object.keys(AIRCRAFT).filter((k) => AIRCRAFT[k].kind === 'plane');
export const HELI_TYPES = Object.keys(AIRCRAFT).filter((k) => AIRCRAFT[k].kind === 'heli');

/** Marks every window so a sealed cabin's canopy can be shot out (Plane.breakCanopy hides them). */
export function tagGlass(root) {
    const g = M.glass();
    root.traverse((c) => {
        if (c.isMesh && (c.material === g || (c.material && c.material.userData && c.material.userData.glass))) c.userData.glass = true;
    });
}

/** Builds the mesh + interior for any type except 'cub' (plane.js builds that one with createPlaneMesh). */
export function buildAircraft(type, color, id) {
    const spec = AIRCRAFT[type];
    const out = spec.build(color);
    out.root.name = `aircraft_${type}_${id}`;
    out.root.userData.isPlane = true;
    out.root.userData.aircraftType = type;
    out.spec = spec;
    out.eye = new THREE.Vector3(...spec.eye);
    tagGlass(out.root);
    return out;
}
