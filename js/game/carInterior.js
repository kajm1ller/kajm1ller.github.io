/**
 * js/game/carInterior.js
 *
 * First-person cockpit for the Honda Civic:
 * - Detailed interior built into whichever car the player drives: dashboard with a binnacle,
 *   working speedometer and tachometer, centre stack with an infotainment screen and vents,
 *   console with shifter, handbrake and cupholders, seats with headrests and belts, door cards,
 *   headliner, pillars, sun visors, rear-view and side mirrors, pedals, and the driver's arms on
 *   a steering wheel that turns with the front wheels.
 * - Hood and trunk shells visible from the driver's seat, since the exterior body (whose top
 *   would otherwise fill the cabin at seat height) is hidden while in the cockpit; an invisible
 *   stand-in keeps its shadow.
 * - Driver's window that shatters (shards, jagged edges, synthesized glass sound).
 *
 * Car local space: -Z is the front, -X the driver's (left) side, y = 0 at road level.
 */

import * as THREE from 'three';

// Invisible stand-in that keeps the hidden body casting its shadow while the camera is inside
const SHADOW_ONLY_MATERIAL = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

// Driver eye point in car space; CameraController.cockpitOffset uses the same value
export const DRIVER_EYE = Object.freeze({ x: -0.4, y: 1.15, z: -0.22 });

const STEERING_RATIO = 4.4; // steering wheel turns per radian of front-wheel angle

let _mats = null;
function materials() {
    if (_mats) return _mats;
    const std = (color, roughness = 0.8, metalness = 0.0, extra = {}) =>
        new THREE.MeshStandardMaterial(Object.assign({ color, roughness, metalness }, extra));
    _mats = {
        dash: std(0x18191b, 0.85),
        dashTop: std(0x101113, 0.95),
        trim: std(0x2a2c30, 0.7),
        piano: std(0x0b0b0c, 0.25, 0.1),
        chrome: std(0xb8bcc2, 0.25, 0.9),
        seat: std(0x2b2e34, 0.95),
        seatInsert: std(0x3a3e46, 0.95),
        headliner: std(0x77736c, 0.95),
        carpet: std(0x161616, 1.0),
        doorCard: std(0x232529, 0.85),
        speaker: std(0x0e0e0f, 0.9),
        vent: std(0x0a0a0a, 0.6),
        wheel: std(0x121212, 0.6),
        skin: std(0xe0ac69, 0.75),
        sleeve: std(0x2b2b30, 0.9),
        belt: std(0x1e1f22, 0.9),
        mirror: std(0xcfd8de, 0.05, 1.0),
        red: new THREE.MeshBasicMaterial({ color: 0xc81e1e }),
        glow: new THREE.MeshBasicMaterial({ color: 0x7fd3ff }),
        needle: new THREE.MeshBasicMaterial({ color: 0xff3b1f })
    };
    return _mats;
}

function box(parent, mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, name = '') {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    if (name) m.name = name;
    parent.add(m);
    return m;
}

function cyl(parent, mat, rt, rb, h, x, y, z, rx = 0, ry = 0, rz = 0, seg = 16) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
}

/** Dial faces for the instrument cluster (speedometer left, tachometer right). */
function makeClusterTexture() {
    const W = 512, H = 200;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#050607';
    g.fillRect(0, 0, W, H);
    const dial = (cx, cy, r, max, step, label, redFrom) => {
        g.fillStyle = '#0c0f12';
        g.beginPath();
        g.arc(cx, cy, r + 6, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#3a4a55';
        g.lineWidth = 3;
        g.stroke();
        const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
        for (let v = 0; v <= max; v += step / 2) {
            const major = v % step === 0;
            const a = a0 + (v / max) * (a1 - a0);
            g.strokeStyle = redFrom !== null && v >= redFrom ? '#ff3b30' : '#e8f4ff';
            g.lineWidth = major ? 3 : 1.5;
            g.beginPath();
            g.moveTo(cx + Math.cos(a) * r * (major ? 0.8 : 0.88), cy + Math.sin(a) * r * (major ? 0.8 : 0.88));
            g.lineTo(cx + Math.cos(a) * r * 0.97, cy + Math.sin(a) * r * 0.97);
            g.stroke();
            if (major) {
                g.fillStyle = '#e8f4ff';
                g.font = 'bold 15px Arial';
                g.textAlign = 'center';
                g.textBaseline = 'middle';
                g.fillText(String(v / (max > 1000 ? 1000 : 1) | 0), cx + Math.cos(a) * r * 0.64, cy + Math.sin(a) * r * 0.64);
            }
        }
        g.fillStyle = '#7fd3ff';
        g.font = '13px Arial';
        g.fillText(label, cx, cy + r * 0.45);
    };
    dial(128, 100, 88, 140, 20, 'MPH', null);
    dial(384, 100, 88, 8000, 1000, 'x1000 r/min', 6500);
    // Centre info strip
    g.fillStyle = '#7fd3ff';
    g.font = 'bold 14px Arial';
    g.textAlign = 'center';
    g.fillText('D', 256, 178);
    g.fillStyle = '#2ecc71';
    g.fillText('ECON', 256, 30);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

// Touch buttons along the bottom of the screen, in canvas pixels (canvas is 256 x 160)
export const SCREEN_BUTTONS = Object.freeze([
    { id: 'rewind', x0: 14, x1: 82 },
    { id: 'playpause', x0: 94, x1: 162 },
    { id: 'skip', x0: 174, x1: 242 }
]);
const BUTTON_Y0 = 108, BUTTON_Y1 = 150;

/** Infotainment screen: radio track, clock, and rewind / play-pause / skip touch buttons. */
class InfoScreen {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 256;
        this.canvas.height = 160;
        this.ctx = this.canvas.getContext('2d');
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.lastKey = '';
        this.draw('', false, -1, -1);
    }

    draw(title, playing, hover = -1, pressed = -1) {
        const now = new Date();
        const clock = `${((now.getHours() + 11) % 12) + 1}:${String(now.getMinutes()).padStart(2, '0')}`;
        const key = `${title}|${playing}|${clock}|${hover}|${pressed}|${playing ? now.getSeconds() : 0}`;
        if (key === this.lastKey) return;
        this.lastKey = key;
        const g = this.ctx;
        const grd = g.createLinearGradient(0, 0, 0, 160);
        grd.addColorStop(0, '#0d1b2a');
        grd.addColorStop(1, '#03070c');
        g.fillStyle = grd;
        g.fillRect(0, 0, 256, 160);
        g.fillStyle = '#9fb3c8';
        g.font = '14px Arial';
        g.textAlign = 'right';
        g.fillText(clock, 246, 20);
        g.textAlign = 'left';
        g.fillText('KAJ RADIO', 10, 20);
        g.fillStyle = playing ? '#ffffff' : '#6c7a89';
        g.font = 'bold 18px Arial';
        const text = title || 'Radio off';
        g.fillText(text.length > 22 ? text.slice(0, 21) + '…' : text, 10, 62);
        g.fillStyle = '#26323f';
        g.fillRect(10, 82, 236, 3);
        g.fillStyle = '#4ea8de';
        g.fillRect(10, 82, playing ? 236 * ((now.getSeconds() % 60) / 60) : 0, 3);

        // Buttons
        SCREEN_BUTTONS.forEach((btn, i) => {
            const w = btn.x1 - btn.x0, h = BUTTON_Y1 - BUTTON_Y0;
            g.fillStyle = i === pressed ? '#7fd3ff' : i === hover ? '#3d6d96' : '#24384d';
            g.fillRect(btn.x0, BUTTON_Y0, w, h);
            g.strokeStyle = i === hover ? '#ffffff' : '#5b7894';
            g.lineWidth = 2;
            g.strokeRect(btn.x0 + 1, BUTTON_Y0 + 1, w - 2, h - 2);
            g.fillStyle = '#ffffff';
            const cx = (btn.x0 + btn.x1) / 2, cy = (BUTTON_Y0 + BUTTON_Y1) / 2;
            const tri = (x, dir) => {
                g.beginPath();
                g.moveTo(x, cy - 9);
                g.lineTo(x + dir * 13, cy);
                g.lineTo(x, cy + 9);
                g.closePath();
                g.fill();
            };
            if (btn.id === 'rewind') {
                g.fillRect(cx - 14, cy - 9, 3, 18);
                tri(cx + 1, -1);
                tri(cx + 13, -1);
            } else if (btn.id === 'skip') {
                tri(cx - 13, 1);
                tri(cx - 1, 1);
                g.fillRect(cx + 11, cy - 9, 3, 18);
            } else if (playing) {
                g.fillRect(cx - 8, cy - 10, 5, 20);
                g.fillRect(cx + 3, cy - 10, 5, 20);
            } else {
                tri(cx - 5, 1);
            }
        });
        this.texture.needsUpdate = true;
    }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/**
 * Interior for one car. Built once per vehicle and reused whenever the player gets back in.
 */
export class CarInterior {
    constructor(vehicle) {
        this.vehicle = vehicle;
        const root = new THREE.Group();
        root.name = 'civic_interior';
        this.root = root;
        this.cockpitOnly = new THREE.Group(); // hood/trunk shells only shown from the driver's seat
        this.cockpitOnly.name = 'civic_cockpit_shell';
        this.cockpitOnly.visible = false;
        root.add(this.cockpitOnly);
        this._build();
        root.traverse((o) => {
            if (o.isMesh) {
                o.castShadow = false;
                o.receiveShadow = true;
            }
        });
        vehicle.mesh.add(root);
        this.cockpitActive = false;
    }

    _build() {
        const M = materials();
        const R = this.root;
        const ex = DRIVER_EYE.x;

        // ---------- Floor, firewall, sills ----------
        box(R, M.carpet, 1.84, 0.04, 2.15, 0, 0.36, -0.28);
        box(R, M.carpet, 1.84, 0.5, 0.05, 0, 0.6, -1.36, -0.5);                 // firewall / footwell
        box(R, M.trim, 0.12, 0.12, 2.1, -0.88, 0.42, -0.28);                   // sills
        box(R, M.trim, 0.12, 0.12, 2.1, 0.88, 0.42, -0.28);

        // ---------- Dashboard ----------
        box(R, M.dashTop, 1.86, 0.06, 0.5, 0, 0.95, -1.12, 0.08);              // dash top pad
        box(R, M.dash, 1.86, 0.26, 0.18, 0, 0.82, -0.92);                       // dash face
        box(R, M.dash, 1.86, 0.12, 0.35, 0, 0.7, -1.08);                        // lower dash
        box(R, M.piano, 1.5, 0.025, 0.012, 0.15, 0.9, -0.83);                   // trim strip
        // Instrument binnacle and cluster
        box(R, M.dashTop, 0.52, 0.05, 0.22, ex, 1.07, -0.95, -0.25);            // hood over gauges
        box(R, M.dash, 0.04, 0.14, 0.18, ex - 0.24, 0.99, -0.95);
        box(R, M.dash, 0.04, 0.14, 0.18, ex + 0.24, 0.99, -0.95);
        const clusterMat = new THREE.MeshBasicMaterial({ map: makeClusterTexture() });
        const cluster = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.17), clusterMat);
        cluster.position.set(ex, 1.0, -0.99);
        cluster.rotation.x = -0.12;
        R.add(cluster);
        this.cluster = cluster;
        // Needles pivot at each dial centre (dial centres sit at 25% / 75% across the face)
        const needleGeo = new THREE.BoxGeometry(0.004, 0.064, 0.002);
        needleGeo.translate(0, 0.028, 0.002);
        const mkNeedle = (u) => {
            const pivot = new THREE.Group();
            pivot.position.set((u - 0.5) * 0.44, 0.005, 0.002);
            pivot.add(new THREE.Mesh(needleGeo, M.needle));
            const cap = new THREE.Mesh(new THREE.CircleGeometry(0.008, 12), M.trim);
            cap.position.z = 0.004;
            pivot.add(cap);
            cluster.add(pivot);
            return pivot;
        };
        this.speedNeedle = mkNeedle(0.25);
        this.tachNeedle = mkNeedle(0.75);

        // Vents (driver side, centre pair, passenger side)
        const vent = (x, w) => {
            box(R, M.vent, w, 0.07, 0.03, x, 0.85, -0.83);
            for (let i = 0; i < 4; i++) box(R, M.trim, w - 0.01, 0.006, 0.035, x, 0.825 + i * 0.016, -0.82);
        };
        vent(-0.82, 0.12);
        vent(-0.08, 0.1);
        vent(0.08, 0.1);
        vent(0.82, 0.12);
        // Centre stack with infotainment screen, hazard button and climate knobs
        box(R, M.dash, 0.38, 0.36, 0.12, 0, 0.72, -0.86, -0.12);
        this.screen = new InfoScreen();
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.1875), new THREE.MeshBasicMaterial({ map: this.screen.texture }));
        screen.name = 'infotainment_screen';
        screen.position.set(0, 1.0, -0.895);
        screen.rotation.x = -0.18;
        R.add(screen);
        this.screenMesh = screen;
        this.hoverButton = -1;
        this.pressedButton = -1;
        this._pressTimer = 0;
        box(R, M.piano, 0.33, 0.21, 0.015, 0, 1.0, -0.905, -0.18);              // screen bezel
        box(R, M.red, 0.03, 0.02, 0.01, 0, 0.84, -0.795);                         // hazard button
        for (const kx of [-0.09, 0.09]) cyl(R, M.chrome, 0.022, 0.022, 0.025, kx, 0.74, -0.79, Math.PI / 2 - 0.12);
        box(R, M.piano, 0.22, 0.03, 0.01, 0, 0.66, -0.79, -0.12);               // climate display strip
        // Glovebox outline and passenger dash
        box(R, M.trim, 0.42, 0.005, 0.01, 0.48, 0.79, -0.83);
        box(R, M.trim, 0.005, 0.12, 0.01, 0.27, 0.73, -0.83);
        box(R, M.trim, 0.005, 0.12, 0.01, 0.69, 0.73, -0.83);

        // ---------- Steering column and wheel ----------
        cyl(R, M.trim, 0.045, 0.06, 0.3, ex, 0.87, -0.82, Math.PI / 2 - 0.42);
        const wheelMount = new THREE.Group();
        wheelMount.position.set(ex, 0.92, -0.64);
        wheelMount.rotation.x = -0.42; // top of the wheel leans away from the driver
        R.add(wheelMount);
        const wheel = new THREE.Group();
        wheel.name = 'steering_wheel';
        wheelMount.add(wheel);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.019, 10, 40), M.wheel);
        wheel.add(rim);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.05, 20), M.wheel);
        hub.rotation.x = Math.PI / 2;
        hub.position.z = 0.02;
        wheel.add(hub);
        const logo = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.005, 16), M.chrome);
        logo.rotation.x = Math.PI / 2;
        logo.position.z = 0.047;
        wheel.add(logo);
        for (const a of [Math.PI / 2 + Math.PI, 0, Math.PI]) { // bottom, right, left spokes
            const sp = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.035, 0.018), M.wheel);
            sp.position.set(Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.01);
            sp.rotation.z = a;
            wheel.add(sp);
        }
        // Buttons on the spokes
        box(wheel, M.trim, 0.03, 0.02, 0.006, -0.1, 0.0, 0.022);
        box(wheel, M.trim, 0.03, 0.02, 0.006, 0.1, 0.0, 0.022);
        this.wheel = wheel;
        // Hands grip at roughly 10 and 2 o'clock; they ride on the rim as the wheel turns
        this.gripL = new THREE.Object3D();
        this.gripL.position.set(-Math.sin(1.0) * 0.185, Math.cos(1.0) * 0.185, 0.0);
        this.gripR = new THREE.Object3D();
        this.gripR.position.set(Math.sin(1.0) * 0.185, Math.cos(1.0) * 0.185, 0.0);
        wheelMount.add(this.gripL, this.gripR);

        // Driver's arms (hand on the grip, forearm + upper arm back to the shoulder)
        const arm = (side) => {
            const g = new THREE.Group();
            const hand = box(g, M.skin, 0.06, 0.075, 0.045, 0, 0, 0);
            const fore = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1), M.sleeve);
            R.add(g, fore);
            // Pointing pose (index finger out), used when reaching for the screen
            const point = new THREE.Group();
            box(point, M.skin, 0.055, 0.045, 0.07, 0, 0, 0);                    // fist
            box(point, M.skin, 0.016, 0.016, 0.06, side * 0.016, 0.008, -0.06);  // index finger
            point.visible = false;
            R.add(point);
            return { side, hand: g, handMesh: hand, fore, point };
        };
        this.armL = arm(-1);
        this.armR = arm(1);

        // ---------- Pedals ----------
        box(R, M.chrome, 0.07, 0.11, 0.02, ex + 0.12, 0.47, -1.2, -0.5);       // accelerator
        box(R, M.trim, 0.11, 0.08, 0.02, ex - 0.04, 0.5, -1.18, -0.5);         // brake

        // ---------- Centre console ----------
        box(R, M.trim, 0.26, 0.22, 0.9, 0, 0.52, -0.32);
        box(R, M.dash, 0.24, 0.03, 0.88, 0, 0.64, -0.32);
        box(R, M.piano, 0.12, 0.01, 0.16, 0, 0.66, -0.55);                     // shifter surround
        cyl(R, M.trim, 0.012, 0.014, 0.16, 0, 0.73, -0.55, 0.15);              // shift lever
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 10), M.piano);
        knob.position.set(0, 0.82, -0.54);
        knob.scale.set(1, 0.85, 1.15);
        R.add(knob);
        box(R, M.chrome, 0.018, 0.006, 0.06, 0, 0.84, -0.54);
        box(R, M.trim, 0.045, 0.035, 0.22, 0.0, 0.69, -0.18, -0.25);           // handbrake lever
        box(R, M.red, 0.012, 0.012, 0.012, 0.0, 0.72, -0.08);
        for (const cz of [-0.02, 0.1]) cyl(R, M.piano, 0.038, 0.034, 0.01, 0.0, 0.655, cz + 0.1);   // cupholders
        box(R, M.seat, 0.24, 0.08, 0.3, 0, 0.7, 0.22);                         // armrest

        // ---------- Seats ----------
        const seat = (x, z, rear = false) => {
            const w = rear ? 1.6 : 0.52;
            box(R, M.seat, w, 0.13, 0.52, x, 0.58, z);                           // cushion
            box(R, M.seatInsert, w * (rear ? 0.98 : 0.6), 0.02, 0.4, x, 0.655, z - 0.02);
            if (!rear) {
                box(R, M.seat, 0.08, 0.16, 0.5, x - 0.24, 0.66, z);              // side bolsters
                box(R, M.seat, 0.08, 0.16, 0.5, x + 0.24, 0.66, z);
            }
            const back = box(R, M.seat, w, 0.62, 0.13, x, 0.94, z + 0.3, 0.2);
            if (!rear) box(R, M.seatInsert, w * 0.6, 0.5, 0.02, x, 0.93, z + 0.23, 0.2);
            const heads = rear ? [-0.55, 0, 0.55] : [0];
            for (const hx of heads) {
                box(R, M.seat, 0.26, 0.18, 0.1, x + hx, 1.3, z + 0.37, 0.12);
                cyl(R, M.chrome, 0.008, 0.008, 0.06, x + hx - 0.07, 1.2, z + 0.36);
                cyl(R, M.chrome, 0.008, 0.008, 0.06, x + hx + 0.07, 1.2, z + 0.36);
            }
            return back;
        };
        seat(ex, -0.02);
        seat(0.4, -0.02);
        seat(0, 0.62, true);
        // Seat belts (B-pillar anchor diagonally across the seats)
        box(R, M.belt, 0.05, 0.75, 0.01, -0.62, 1.0, 0.24, 0, 0, -0.55);
        box(R, M.belt, 0.05, 0.75, 0.01, 0.62, 1.0, 0.24, 0, 0, 0.55);

        // ---------- Door cards ----------
        for (const s of [-1, 1]) {
            const x = s * 0.92;
            box(R, M.doorCard, 0.05, 0.5, 1.3, x, 0.66, -0.5);
            box(R, M.trim, 0.1, 0.05, 0.5, x - s * 0.03, 0.79, -0.42);           // armrest
            box(R, M.dashTop, 0.06, 0.06, 1.3, x, 0.93, -0.5);                  // window sill
            box(R, M.chrome, 0.02, 0.03, 0.09, x - s * 0.04, 0.88, -0.78);       // door handle
            box(R, M.piano, 0.05, 0.015, 0.12, x - s * 0.05, 0.82, -0.4);        // window switches
            const spk = new THREE.Mesh(new THREE.CircleGeometry(0.07, 18), M.speaker);
            spk.position.set(x - s * 0.026, 0.52, -0.85);
            spk.rotation.y = -s * Math.PI / 2;
            R.add(spk);
            box(R, M.doorCard, 0.05, 0.45, 0.7, x, 0.66, 0.5);                  // rear door card
            box(R, M.dashTop, 0.06, 0.06, 0.7, x, 0.93, 0.5);
        }

        // ---------- Pillars, headliner, visors, mirrors ----------
        box(R, M.headliner, 1.86, 0.03, 2.15, 0, 1.385, -0.3);
        for (const s of [-1, 1]) {
            box(R, M.headliner, 0.07, 0.56, 0.08, s * 0.86, 1.14, -1.3, 0.62, 0, 0);   // A-pillar
            box(R, M.headliner, 0.08, 0.5, 0.12, s * 0.92, 1.15, 0.05);                // B-pillar
            box(R, M.headliner, 0.08, 0.5, 0.1, s * 0.9, 1.15, 0.75, -0.4);            // C-pillar
            box(R, M.headliner, 0.36, 0.02, 0.16, s * 0.42, 1.36, -1.12, 0.12);        // sun visor
            box(R, M.dash, 0.06, 0.08, 0.12, s * 1.08, 1.0, -1.02);                    // side mirror housing
            const sm = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.065), M.mirror);
            sm.position.set(s * 1.08, 1.0, -0.955);
            R.add(sm);
        }
        box(R, M.dash, 0.02, 0.06, 0.02, 0, 1.35, -1.2);                       // mirror stem
        box(R, M.dash, 0.26, 0.075, 0.03, 0, 1.3, -1.19);                      // rear-view mirror
        const rv = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.06), M.mirror);
        rv.position.set(0, 1.3, -1.174);
        R.add(rv);
        box(R, M.trim, 0.12, 0.03, 0.06, 0, 1.37, -1.0);                        // dome light
        box(R, M.glow, 0.08, 0.005, 0.03, 0, 1.354, -1.0);

        // ---------- Hood and trunk as seen from inside ----------
        const bodyMesh = this.vehicle.mesh.getObjectByName('sedan_body');
        const paint = bodyMesh ? bodyMesh.material : M.dash;
        const hood = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.06, 0.84), paint);
        hood.position.set(0, 0.87, -1.84);
        hood.rotation.x = 0.04;
        this.cockpitOnly.add(hood);
        const trunk = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.06, 1.42), paint);
        trunk.position.set(0, 0.87, 1.52);
        this.cockpitOnly.add(trunk);
        for (const s of [-1, 1]) {
            const fender = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 4.4), paint);
            fender.position.set(s * 1.07, 0.75, 0);
            this.cockpitOnly.add(fender);
        }
    }

    /** Hides the car body (keeping its shadow) and shows the hood/trunk shells while in the cockpit. */
    setCockpitActive(active) {
        if (active === this.cockpitActive) return;
        this.cockpitActive = active;
        this.cockpitOnly.visible = active;
        const body = this.vehicle.mesh.getObjectByName('sedan_body');
        if (!body) return;
        if (!this.shadowProxy) {
            this.shadowProxy = new THREE.Mesh(body.geometry, SHADOW_ONLY_MATERIAL);
            this.shadowProxy.name = 'sedan_body_shadow_proxy';
            this.shadowProxy.position.copy(body.position);
            this.shadowProxy.castShadow = true;
            this.shadowProxy.receiveShadow = false;
            body.parent.add(this.shadowProxy);
        }
        body.visible = !active;
        this.shadowProxy.visible = active;
    }

    /**
     * @param {number} dt
     * @param {Object} info { aiming: 0..1 (right hand leaves the wheel), radioTitle, radioPlaying }
     */
    update(dt, info = {}) {
        const v = this.vehicle;
        const wheelRot = (v.steerAngle || 0) * STEERING_RATIO;
        this.wheel.rotation.z = wheelRot;
        // Hands turn with the wheel up to ~40 degrees, after that the rim slides through them
        const handRot = Math.max(-0.7, Math.min(0.7, wheelRot));
        for (const [grip, base] of [[this.gripL, 1.0], [this.gripR, -1.0]]) {
            const a = base + handRot;
            grip.position.set(-Math.sin(a) * 0.185, Math.cos(a) * 0.185, 0.0);
            grip.rotation.z = handRot;
        }

        // Gauges: speedometer 0-140 mph, tachometer through a 6-speed box
        const mph = Math.abs(v.speed || 0) * 2.23694;
        const sweep = Math.PI * 1.5;
        // Dials start at 7:30 and sweep 270 degrees clockwise
        this.speedNeedle.rotation.z = -Math.PI * 1.25 - Math.min(1, mph / 140) * sweep;
        const gearTop = [0, 12, 24, 38, 55, 75, 140];
        let gear = 1;
        while (gear < 6 && mph > gearTop[gear]) gear++;
        const lo = gearTop[gear - 1], hi = gearTop[gear];
        const running = v.engineOn !== false;
        let rpm = running ? 800 + ((mph - lo) / Math.max(1, hi - lo)) * 5200 : 0;
        if (running && (v.inputThrottle || 0) > 0.1 && mph < 3) rpm = 800 + v.inputThrottle * 2500;
        this._rpm = this._rpm === undefined ? rpm : this._rpm + (rpm - this._rpm) * Math.min(1, dt * 8);
        this.tachNeedle.rotation.z = -Math.PI * 1.25 - Math.min(1, this._rpm / 8000) * sweep;

        // Screen (redraws only when something on it changes)
        if (this._pressTimer > 0) {
            this._pressTimer -= dt;
            if (this._pressTimer <= 0) this.pressedButton = -1;
        }
        this.screen.draw(info.radioTitle || '', !!info.radioPlaying, this.hoverButton, this.pressedButton);

        // Arms. Kaj is left-handed: the left hand leaves the wheel to hold the gun, the right hand
        // stays on the wheel unless it reaches out to press something
        this.root.updateMatrixWorld(true);
        this._placeArm(this.armL, this.gripL);
        this._placeArm(this.armR, this.gripR);
        const leftOff = !!info.leftHandOff;
        this.armL.hand.visible = this.armL.fore.visible = !leftOff;

        const reachTarget = info.reach ? 1 : 0;
        this._reach = (this._reach || 0) + (reachTarget - (this._reach || 0)) * Math.min(1, dt * 12);
        if (this._reach > 0.01 && info.reachPoint) this._placeReach(this.armR, info.reachPoint, this._reach);
        else this.armR.point.visible = false;
        if (this._reach <= 0.01) this.armR.hand.visible = true;
    }

    /**
     * The touch-screen button under a ray (e.g. from the camera through the crosshair), or null.
     * @returns {{index: number, id: string, point: THREE.Vector3}|null}
     */
    pickScreenButton(raycaster) {
        const hit = raycaster.intersectObject(this.screenMesh, false)[0];
        if (!hit || !hit.uv) return null;
        const px = hit.uv.x * 256, py = (1 - hit.uv.y) * 160;
        if (py < BUTTON_Y0 || py > BUTTON_Y1) return null;
        for (let i = 0; i < SCREEN_BUTTONS.length; i++) {
            const b = SCREEN_BUTTONS[i];
            if (px >= b.x0 && px <= b.x1) return { index: i, id: b.id, point: hit.point.clone() };
        }
        return null;
    }

    setHoverButton(index) {
        this.hoverButton = index;
    }

    /** Lights a button up briefly as it is pressed. */
    flashButton(index) {
        this.pressedButton = index;
        this._pressTimer = 0.25;
    }

    /** Right hand leaves the wheel and points at (world) `point`, limited by arm length. */
    _placeReach(arm, point, amount) {
        const R = this.root;
        _v1.copy(point);
        R.worldToLocal(_v1);
        const sx = DRIVER_EYE.x + 0.2, sy = DRIVER_EYE.y - 0.3, sz = DRIVER_EYE.z + 0.05;
        let dx = _v1.x - sx, dy = _v1.y - sy, dz = _v1.z - sz;
        const dl = Math.hypot(dx, dy, dz) || 1;
        const reachLen = Math.min(dl, 0.68) - 0.05; // fingertip lands on the target
        dx /= dl; dy /= dl; dz /= dl;
        const tx = sx + dx * reachLen, ty = sy + dy * reachLen, tz = sz + dz * reachLen;
        // Blend from the wheel grip to the reach pose
        const gx = arm.hand.position.x, gy = arm.hand.position.y, gz = arm.hand.position.z;
        const hx = gx + (tx - gx) * amount, hy = gy + (ty - gy) * amount, hz = gz + (tz - gz) * amount;
        arm.point.position.set(hx, hy, hz);
        _v2.set(hx + dx, hy + dy, hz + dz).applyMatrix4(R.matrixWorld);
        arm.point.lookAt(_v2);
        arm.point.rotateY(Math.PI); // finger along -Z of the fist faces the target
        arm.point.visible = true;
        arm.hand.visible = false;
        // Forearm trails back from the wrist towards the shoulder
        const len = 0.3;
        arm.fore.position.set(hx - dx * len * 0.5, hy - dy * len * 0.5, hz - dz * len * 0.5);
        arm.fore.scale.set(1, 1, len);
        _v2.set(hx, hy, hz).applyMatrix4(R.matrixWorld);
        arm.fore.lookAt(_v2);
    }

    _placeArm(arm, grip) {
        const R = this.root;
        // Hand on the grip point (interior space), turned with the hands' share of the wheel
        grip.getWorldPosition(_v1);
        R.worldToLocal(_v1);
        arm.hand.position.copy(_v1);
        arm.hand.quaternion.copy(grip.parent.quaternion);
        arm.hand.rotateZ(grip.rotation.z);
        // Forearm runs from the wrist back and down towards the elbow, out of view below the camera
        const hx = _v1.x, hy = _v1.y, hz = _v1.z;
        let dx = DRIVER_EYE.x + arm.side * 0.3 - hx;
        let dy = DRIVER_EYE.y - 0.6 - hy;
        let dz = DRIVER_EYE.z + 0.15 - hz;
        const dl = Math.hypot(dx, dy, dz) || 1;
        const len = 0.3;
        dx = (dx / dl) * len; dy = (dy / dl) * len; dz = (dz / dl) * len;
        arm.fore.position.set(hx + dx * 0.5, hy + dy * 0.5, hz + dz * 0.5 + 0.01);
        arm.fore.scale.set(1, 1, len);
        _v2.set(hx + dx, hy + dy, hz + dz).applyMatrix4(R.matrixWorld);
        arm.fore.lookAt(_v2);
    }
}

// ================================================================================================
// Driver's window shattering
// ================================================================================================
const SHARD_COUNT = 90;

/** Glass shards flying out of a broken window, plus the jagged edges left in the frame. */
export class GlassShatterSystem {
    constructor(scene) {
        this.scene = scene;
        const shardGeo = new THREE.BufferGeometry();
        shardGeo.setAttribute('position', new THREE.Float32BufferAttribute([
            -0.5, -0.4, 0, 0.55, -0.2, 0, -0.1, 0.6, 0
        ], 3));
        shardGeo.computeVertexNormals();
        this.material = new THREE.MeshStandardMaterial({
            color: 0xcfe6f2, roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.75,
            side: THREE.DoubleSide, envMapIntensity: 1.5, depthWrite: false
        });
        this.mesh = new THREE.InstancedMesh(shardGeo, this.material, SHARD_COUNT * 3);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.frustumCulled = false;
        this.mesh.count = 0;
        this.mesh.name = 'glass_shards';
        scene.add(this.mesh);
        this.shards = [];
        this._m = new THREE.Matrix4();
        this._q = new THREE.Quaternion();
        this._e = new THREE.Euler();
        this._s = new THREE.Vector3();
        this._p = new THREE.Vector3();
    }

    /**
     * Breaks the driver's window of `vehicle`: hides the glass, leaves a rear quarter pane and
     * jagged edges, throws shards outward (and a few into the driver's lap), and plays the sound.
     */
    breakDriverWindow(vehicle, audioCtx = null) {
        if (!vehicle || !vehicle.mesh || vehicle.driverWindowBroken) return false;
        const glass = vehicle.mesh.getObjectByName('left_window_glass');
        if (!glass) return false;
        vehicle.driverWindowBroken = true;
        glass.visible = false;
        const root = vehicle.mesh;

        // The rear quarter pane behind the B-pillar survives
        const rearPane = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.42, 0.64), glass.material);
        rearPane.name = 'left_rear_quarter_glass';
        rearPane.position.set(-0.956, 1.1, 0.37);
        root.add(rearPane);

        // Jagged remains around the front frame
        const edges = new THREE.Group();
        edges.name = 'left_window_jagged_edges';
        const frame = { z0: -1.29, z1: 0.0, y0: 0.89, y1: 1.31 };
        const addShard = (y, z, w, h, rot) => {
            const m = new THREE.Mesh(this.mesh.geometry, this.material);
            m.position.set(-0.956, y, z);
            m.rotation.set(0, Math.PI / 2, rot);
            m.scale.set(w, h, 1);
            edges.add(m);
        };
        for (let i = 0; i < 9; i++) {
            const z = frame.z0 + 0.06 + Math.random() * (frame.z1 - frame.z0 - 0.12);
            addShard(frame.y0 + 0.03, z, 0.05 + Math.random() * 0.08, 0.06 + Math.random() * 0.1, (Math.random() - 0.5) * 0.6);
        }
        for (let i = 0; i < 4; i++) {
            const y = frame.y0 + 0.05 + Math.random() * 0.3;
            addShard(y, frame.z0 + 0.03, 0.05 + Math.random() * 0.05, 0.05 + Math.random() * 0.09, Math.PI / 2 + (Math.random() - 0.5));
            addShard(y, frame.z1 - 0.03, 0.05 + Math.random() * 0.05, 0.05 + Math.random() * 0.09, -Math.PI / 2 + (Math.random() - 0.5));
        }
        root.add(edges);

        // Flying shards in world space
        root.updateMatrixWorld(true);
        const yaw = vehicle.yaw || 0;
        const leftX = -Math.cos(yaw), leftZ = Math.sin(yaw);  // car's -X axis in world space
        const vx = vehicle.velocity ? vehicle.velocity.x : 0, vz = vehicle.velocity ? vehicle.velocity.y : 0;
        for (let i = 0; i < SHARD_COUNT; i++) {
            const lz = frame.z0 + Math.random() * (frame.z1 - frame.z0);
            const ly = frame.y0 + Math.random() * (frame.y1 - frame.y0);
            const inward = i < SHARD_COUNT * 0.2;
            this._p.set(-0.956, ly, lz).applyMatrix4(root.matrixWorld);
            const out = inward ? -(0.3 + Math.random() * 1.2) : 1.2 + Math.random() * 3.5;
            this.shards.push({
                x: this._p.x, y: this._p.y, z: this._p.z,
                vx: vx + leftX * out + (Math.random() - 0.5) * 1.4,
                vy: Math.random() * 1.6 - 0.2,
                vz: vz + leftZ * out + (Math.random() - 0.5) * 1.4,
                rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6,
                sx: (Math.random() - 0.5) * 30, sy: (Math.random() - 0.5) * 30, sz: (Math.random() - 0.5) * 30,
                size: 0.015 + Math.random() * 0.05,
                // Shards falling into the car settle on the seat/door sill and ride along with it
                vehicle: inward ? vehicle : null,
                floor: inward ? 0.62 : 0.015,
                life: inward ? 1e9 : 8 + Math.random() * 4,
                resting: false
            });
        }
        if (this.shards.length > SHARD_COUNT * 3) this.shards.splice(0, this.shards.length - SHARD_COUNT * 3);
        playGlassShatter(audioCtx);
        return true;
    }

    update(dt) {
        const list = this.shards;
        let n = 0;
        for (let i = list.length - 1; i >= 0; i--) {
            const s = list[i];
            s.life -= dt;
            if (s.life <= 0) {
                list.splice(i, 1);
                continue;
            }
            if (s.vehicle) {
                // Inward shards: simulate in car space so they land on the seat as the car drives
                if (!s.local) {
                    const inv = s.vehicle.mesh.matrixWorld.clone().invert();
                    this._p.set(s.x, s.y, s.z).applyMatrix4(inv);
                    s.local = { x: this._p.x, y: this._p.y, z: this._p.z, vx: 0.4 + Math.random() * 0.6, vy: s.vy * 0.5, vz: (Math.random() - 0.5) * 0.4 };
                }
                const L = s.local;
                if (!s.resting) {
                    L.vy -= 9.8 * dt;
                    L.x += L.vx * dt; L.y += L.vy * dt; L.z += L.vz * dt;
                    if (L.x > -0.2) { L.x = -0.2; L.vx = 0; }
                    s.rx += s.sx * dt; s.ry += s.sy * dt;
                    if (L.y <= s.floor) { L.y = s.floor; s.resting = true; s.rx = Math.PI / 2; }
                }
                this._p.set(L.x, L.y, L.z).applyMatrix4(s.vehicle.mesh.matrixWorld);
            } else {
                if (!s.resting) {
                    s.vy -= 9.8 * dt;
                    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
                    s.rx += s.sx * dt; s.ry += s.sy * dt; s.rz += s.sz * dt;
                    if (s.y <= s.floor) {
                        s.y = s.floor;
                        if (Math.abs(s.vy) > 1.2) {
                            s.vy = -s.vy * 0.25;
                            s.vx *= 0.5; s.vz *= 0.5;
                        } else {
                            s.resting = true;
                            s.rx = Math.PI / 2;
                            s.ry = 0;
                        }
                    }
                }
                this._p.set(s.x, s.y, s.z);
            }
            const fade = Math.min(1, s.life / 1.5);
            this._q.setFromEuler(this._e.set(s.rx, s.ry, s.rz));
            this._s.setScalar(s.size * fade);
            this._m.compose(this._p, this._q, this._s);
            this.mesh.setMatrixAt(n++, this._m);
        }
        this.mesh.count = n;
        if (n > 0) this.mesh.instanceMatrix.needsUpdate = true;
    }
}

/** Synthesized safety-glass shatter: a crack, a noisy crunch and a spray of tinkles. */
export function playGlassShatter(ctx) {
    if (!ctx) return;
    try {
        if (ctx.state === 'suspended') ctx.resume();
        const t0 = ctx.currentTime + 0.01;
        const out = ctx.createGain();
        out.gain.value = 0.9;
        out.connect(ctx.destination);

        // Noise burst through a high-pass for the crunch
        const len = Math.floor(ctx.sampleRate * 0.5);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
        const noise = ctx.createBufferSource();
        noise.buffer = buf;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 2200;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(1.0, t0);
        ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.45);
        noise.connect(hp).connect(ng).connect(out);
        noise.start(t0);

        // Initial crack (low thump)
        const thump = ctx.createOscillator();
        thump.type = 'triangle';
        thump.frequency.setValueAtTime(180, t0);
        thump.frequency.exponentialRampToValueAtTime(60, t0 + 0.08);
        const tg = ctx.createGain();
        tg.gain.setValueAtTime(0.6, t0);
        tg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
        thump.connect(tg).connect(out);
        thump.start(t0);
        thump.stop(t0 + 0.15);

        // Tinkling pieces landing
        for (let i = 0; i < 26; i++) {
            const t = t0 + 0.03 + Math.random() * 0.9;
            const o = ctx.createOscillator();
            o.type = 'sine';
            o.frequency.value = 2500 + Math.random() * 6000;
            const g = ctx.createGain();
            const a = 0.05 + Math.random() * 0.12;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(a, t + 0.003);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05 + Math.random() * 0.12);
            o.connect(g).connect(out);
            o.start(t);
            o.stop(t + 0.2);
        }
    } catch (e) {
        // Audio is optional
    }
}
