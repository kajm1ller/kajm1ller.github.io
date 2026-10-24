/**
 * js/game/carInterior.js
 *
 * First-person cockpit for every car model:
 * - Detailed interior built into whichever car the player drives, laid out to fit that model's
 *   cabin (seat position, raked windshield, roof line, rear bench if one fits) and styled by its
 *   theme: dashboard with a binnacle, working speedometer, tachometer and gear indicator, centre
 *   stack with an infotainment screen and vents, console with an automatic, manual or column
 *   shifter, seats (standard or sports buckets) with headrests and belts, door cards, headliner,
 *   pillars, sun visors, rear-view and side mirrors, pedals, and the driver's arms on a steering
 *   wheel (modern, sport, classic wood or truck) that turns with the front wheels. Extras per theme:
 *   wood or carbon trim, LED ambient strips, a taxi meter, a muscle car's gauge pod, police laptop.
 * - The car body is hollow around the cabin (carModels.js), so nothing has to be hidden while in
 *   the driver's seat.
 * - Windows that shatter (shards, jagged edges, synthesized glass sound), following each model's
 *   raked glass.
 *
 * Car local space: -Z is the front, -X the driver's (left) side, y = 0 at road level.
 */

import * as THREE from 'three';
import { getCarModel, cabinShape, getWindowFrames, buildCabinFrame, polySpanAt, pointInPoly, mergeGeometries } from './carModels.js';

// Driver eye point of the Civic in car space; other models use vehicle.driverEye (cabinShape().eye)
export const DRIVER_EYE = Object.freeze(Object.assign({}, cabinShape('civic').eye));

const STEERING_RATIO = 4.4; // steering wheel turns per radian of front-wheel angle

// ================================================================================================
// Themes
// ================================================================================================

const CLUSTER_STYLES = {
    modern: { bg: '#050607', face: '#0c0f12', ring: '#3a4a55', tick: '#e8f4ff', num: '#e8f4ff', label: '#7fd3ff', red: '#ff3b30', info: 'ECON', infoColor: '#2ecc71' },
    city: { bg: '#0a0c0e', face: '#11151a', ring: '#58b4ae', tick: '#e8fffd', num: '#e8fffd', label: '#58b4ae', red: '#ff5a4f', info: 'ECO', infoColor: '#8fdc5a' },
    sport: { bg: '#020202', face: '#0a0a0a', ring: '#c81d25', tick: '#ffffff', num: '#ffffff', label: '#ff3b30', red: '#ff1a1a', info: 'SPORT+', infoColor: '#ff3b30', ringWidth: 5 },
    chrome: { bg: '#0d0c0a', face: '#efe6cf', ring: '#d9dde2', tick: '#1a1a1a', num: '#1a1a1a', label: '#7a1f1f', red: '#c21d1d', info: 'S/C', infoColor: '#ffb703', ringWidth: 7 },
    white: { bg: '#07090b', face: '#f2f4f5', ring: '#9aa3ab', tick: '#111418', num: '#111418', label: '#2c5d8f', red: '#d0021b', info: '4x4', infoColor: '#f5a623' },
    amber: { bg: '#060504', face: '#0f0c08', ring: '#5a4a32', tick: '#ffb347', num: '#ffb347', label: '#ffb347', red: '#ff5a1f', info: 'CRUISE', infoColor: '#ffb347' }
};

const SCREEN_STYLES = {
    blue: { top: '#0d1b2a', bottom: '#03070c', text: '#9fb3c8', title: '#ffffff', dim: '#6c7a89', bar: '#26323f', accent: '#4ea8de', btn: '#24384d', btnHover: '#3d6d96', btnPress: '#7fd3ff', edge: '#5b7894' },
    teal: { top: '#0f2a2a', bottom: '#041010', text: '#a7d8d4', title: '#ffffff', dim: '#5f8a87', bar: '#1f3b3a', accent: '#58b4ae', btn: '#1d3d3b', btnHover: '#2f6b67', btnPress: '#8fe3dc', edge: '#4f8f8a' },
    red: { top: '#1c0b0c', bottom: '#060202', text: '#d6a3a3', title: '#ffffff', dim: '#7a5454', bar: '#3a1d1f', accent: '#ff3b30', btn: '#3a1517', btnHover: '#6b2427', btnPress: '#ff8a80', edge: '#8f4a4d' },
    amber: { top: '#1d1305', bottom: '#080500', text: '#e8b766', title: '#ffd27a', dim: '#8a6a33', bar: '#3a2a10', accent: '#ffb347', btn: '#33240c', btnHover: '#5c4116', btnPress: '#ffd27a', edge: '#8a6a33' },
    green: { top: '#0c1a10', bottom: '#030805', text: '#a6cfa9', title: '#ffffff', dim: '#5f7f62', bar: '#1d3322', accent: '#5fd16e', btn: '#1a3320', btnHover: '#2c5a35', btnPress: '#9ff0a8', edge: '#4f7f56' }
};

/**
 * Interior themes. Colours: dash, dashTop, trim, accent (trim strip), seat, seatInsert, headliner,
 * carpet, doorCard, belt; styles: wheel, shifter, seats, cluster, screen; extras list.
 */
const THEMES = {
    modern: {
        dash: 0x18191b, dashTop: 0x101113, trim: 0x2a2c30, accent: 0x0b0b0c, seat: 0x2b2e34, seatInsert: 0x3a3e46,
        headliner: 0x77736c, carpet: 0x161616, doorCard: 0x232529, glow: 0x7fd3ff,
        wheel: 'modern', shifter: 'auto', seats: 'standard', cluster: 'modern', screen: 'blue', brand: 'KAJ RADIO', maxMph: 140, extras: []
    },
    city: {
        dash: 0x2a2d31, dashTop: 0x1a1c1f, trim: 0x8f969c, accent: 0x58b4ae, seat: 0x33363a, seatInsert: 0x2f7f79,
        headliner: 0x9a978f, carpet: 0x1c1c1c, doorCard: 0x3a3e43, glow: 0x58b4ae,
        wheel: 'modern', shifter: 'auto', seats: 'standard', cluster: 'city', screen: 'teal', brand: 'VOLTA AUDIO', maxMph: 120, extras: ['colorPanel']
    },
    sport: {
        dash: 0x101010, dashTop: 0x0a0a0a, trim: 0x1e1e20, accent: 0x2b2b2e, seat: 0x141414, seatInsert: 0x8f1018,
        headliner: 0x1d1d1f, carpet: 0x0e0e0e, doorCard: 0x161618, glow: 0xff2a2a,
        wheel: 'sport', shifter: 'manual', seats: 'bucket', cluster: 'sport', screen: 'red', brand: 'KAZE SOUND', maxMph: 200, extras: ['carbon', 'ambient', 'clutch']
    },
    muscle: {
        dash: 0x151515, dashTop: 0x0f0f0f, trim: 0x2a2a2a, accent: 0xb8bcc2, seat: 0x4a1212, seatInsert: 0x5e1a1a,
        headliner: 0x1b1b1b, carpet: 0x1a1210, doorCard: 0x3a1010, glow: 0xffb703,
        wheel: 'classic', shifter: 'manual', seats: 'standard', cluster: 'chrome', screen: 'amber', brand: 'STALLION AM/FM', maxMph: 180, extras: ['gaugePod', 'clutch', 'brushed']
    },
    suv: {
        dash: 0x1f1c19, dashTop: 0x141210, trim: 0x3b352f, accent: 0x5a3b22, seat: 0xb9a88a, seatInsert: 0xa8977a,
        headliner: 0xc9c2b4, carpet: 0x2a241e, doorCard: 0x8f826c, glow: 0xffd8a0,
        wheel: 'modern', shifter: 'auto', seats: 'standard', cluster: 'white', screen: 'green', brand: 'RIDGELINE NAV', maxMph: 140, extras: ['wood', 'ambient']
    },
    truck: {
        dash: 0x26282a, dashTop: 0x1c1d1f, trim: 0x45484c, accent: 0x9aa0a6, seat: 0x55585c, seatInsert: 0x4a4d51,
        headliner: 0x8d8a84, carpet: 0x202020, doorCard: 0x3c3f43, glow: 0xffb347,
        wheel: 'truck', shifter: 'column', seats: 'standard', cluster: 'white', screen: 'amber', brand: 'RAM-TOUGH', maxMph: 120, extras: ['grabHandles']
    },
    van: {
        dash: 0x5d6166, dashTop: 0x3e4246, trim: 0x8a8f95, accent: 0x6d7278, seat: 0x3e4248, seatInsert: 0x4f555c,
        headliner: 0xa8a6a0, carpet: 0x2a2a2a, doorCard: 0x6a6e73, glow: 0x9fd3ff,
        wheel: 'truck', shifter: 'column', seats: 'standard', cluster: 'modern', screen: 'blue', brand: 'COURIER', maxMph: 110, extras: ['clipboard']
    },
    cruiser: {
        dash: 0x141516, dashTop: 0x0d0e0f, trim: 0x26282b, accent: 0x0b0b0c, seat: 0x1f2124, seatInsert: 0x2a2d31,
        headliner: 0x5c5a56, carpet: 0x121212, doorCard: 0x1c1e21, glow: 0x9fd3ff,
        wheel: 'truck', shifter: 'column', seats: 'standard', cluster: 'white', screen: 'blue', brand: 'INTERCEPTOR', maxMph: 160, extras: ['policeGear']
    },
    taxi: {
        dash: 0x18191b, dashTop: 0x101113, trim: 0x2a2c30, accent: 0x0b0b0c, seat: 0x9a8a6a, seatInsert: 0x8a7a5c,
        headliner: 0x8a867e, carpet: 0x161616, doorCard: 0x2d2a26, glow: 0xffd84d,
        wheel: 'modern', shifter: 'auto', seats: 'standard', cluster: 'amber', screen: 'amber', brand: 'KAJ CAB', maxMph: 120, extras: ['taxiMeter', 'beads']
    }
};

const _themeMats = new Map();
function themeMaterials(themeId) {
    if (_themeMats.has(themeId)) return _themeMats.get(themeId);
    const T = THEMES[themeId] || THEMES.modern;
    const std = (color, roughness = 0.8, metalness = 0.0, extra = {}) =>
        new THREE.MeshStandardMaterial(Object.assign({ color, roughness, metalness }, extra));
    const M = {
        dash: std(T.dash, 0.85),
        dashTop: std(T.dashTop, 0.95),
        trim: std(T.trim, 0.7),
        accent: std(T.accent, 0.3, T.accent > 0x888888 ? 0.8 : 0.2),
        piano: std(0x0b0b0c, 0.25, 0.1),
        chrome: std(0xb8bcc2, 0.25, 0.9),
        seat: std(T.seat, 0.95),
        seatInsert: std(T.seatInsert, 0.95),
        headliner: std(T.headliner, 0.95),
        carpet: std(T.carpet, 1.0),
        doorCard: std(T.doorCard, 0.85),
        speaker: std(0x0e0e0f, 0.9),
        vent: std(0x0a0a0a, 0.6),
        wheel: std(0x121212, 0.6),
        wood: std(0x5a3418, 0.45, 0.05),
        carbon: std(0x1c1d20, 0.3, 0.6),
        skin: std(0xe0ac69, 0.75),
        sleeve: std(0x2b2b30, 0.9),
        belt: std(0x1e1f22, 0.9),
        mirror: std(0xcfd8de, 0.05, 1.0),
        red: new THREE.MeshBasicMaterial({ color: 0xc81e1e }),
        glow: new THREE.MeshBasicMaterial({ color: T.glow }),
        needle: new THREE.MeshBasicMaterial({ color: 0xff3b1f })
    };
    _themeMats.set(themeId, M);
    return M;
}

// Interior geometry helpers. Every box gets its own geometry (interiors are built once per car)
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

/** Box running from a to b ([x, y, z]) with a w x d cross-section. */
function beam(parent, mat, a, b, w, d = w) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, A.distanceTo(B), d), mat);
    m.position.addVectors(A, B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.sub(A).normalize());
    parent.add(m);
    return m;
}

// ================================================================================================
// Instrument cluster and infotainment screen
// ================================================================================================

/** Dial faces (speedometer left, tachometer right) with a gear indicator between them. */
class Cluster {
    constructor(theme, engine, modelName) {
        this.style = CLUSTER_STYLES[theme.cluster] || CLUSTER_STYLES.modern;
        this.maxMph = theme.maxMph;
        this.maxRpm = Math.ceil((engine.redline + 900) / 1000) * 1000;
        this.redline = engine.redline;
        this.modelName = modelName;
        this.canvas = document.createElement('canvas');
        this.canvas.width = 512;
        this.canvas.height = 200;
        this.ctx = this.canvas.getContext('2d');
        this.bg = this._drawBackground();
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.lastKey = '';
        this.draw('P');
    }

    _drawBackground() {
        const S = this.style;
        const c = document.createElement('canvas');
        c.width = 512;
        c.height = 200;
        const g = c.getContext('2d');
        g.fillStyle = S.bg;
        g.fillRect(0, 0, 512, 200);
        const dial = (cx, cy, r, max, step, label, redFrom, div) => {
            g.fillStyle = S.face;
            g.beginPath();
            g.arc(cx, cy, r + 6, 0, Math.PI * 2);
            g.fill();
            g.strokeStyle = S.ring;
            g.lineWidth = S.ringWidth || 3;
            g.stroke();
            const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
            if (redFrom !== null) {
                g.strokeStyle = S.red;
                g.lineWidth = 6;
                g.beginPath();
                g.arc(cx, cy, r * 0.93, a0 + (redFrom / max) * (a1 - a0), a1);
                g.stroke();
            }
            for (let v = 0; v <= max + 1e-6; v += step / 2) {
                const major = Math.abs(v % step) < 1e-6;
                const a = a0 + (v / max) * (a1 - a0);
                g.strokeStyle = redFrom !== null && v >= redFrom ? S.red : S.tick;
                g.lineWidth = major ? 3 : 1.5;
                g.beginPath();
                g.moveTo(cx + Math.cos(a) * r * (major ? 0.8 : 0.88), cy + Math.sin(a) * r * (major ? 0.8 : 0.88));
                g.lineTo(cx + Math.cos(a) * r * 0.97, cy + Math.sin(a) * r * 0.97);
                g.stroke();
                if (major) {
                    g.fillStyle = S.num;
                    g.font = 'bold 15px Arial';
                    g.textAlign = 'center';
                    g.textBaseline = 'middle';
                    g.fillText(String(Math.round(v / div)), cx + Math.cos(a) * r * 0.64, cy + Math.sin(a) * r * 0.64);
                }
            }
            g.fillStyle = S.label;
            g.font = '13px Arial';
            g.textAlign = 'center';
            g.fillText(label, cx, cy + r * 0.45);
        };
        const speedStep = this.maxMph > 150 ? 20 : this.maxMph > 120 ? 20 : 10;
        dial(128, 100, 88, this.maxMph, speedStep, 'MPH', null, 1);
        dial(384, 100, 88, this.maxRpm, 1000, 'x1000 r/min', Math.floor(this.redline / 500) * 500, 1000);
        g.fillStyle = S.infoColor;
        g.font = 'bold 14px Arial';
        g.textAlign = 'center';
        g.fillText(S.info, 256, 30);
        g.fillStyle = S.label;
        g.font = '10px Arial';
        g.fillText(this.modelName.toUpperCase(), 256, 192);
        return c;
    }

    draw(gear) {
        if (gear === this.lastKey) return;
        this.lastKey = gear;
        const g = this.ctx;
        g.drawImage(this.bg, 0, 0);
        g.fillStyle = '#000000';
        g.fillRect(232, 150, 48, 30);
        g.fillStyle = gear === 'R' ? '#ff3b30' : this.style.label;
        g.font = 'bold 24px Arial';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(gear, 256, 166);
        this.texture.needsUpdate = true;
    }
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
    constructor(style = SCREEN_STYLES.blue, brand = 'KAJ RADIO') {
        this.style = style;
        this.brand = brand;
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
        const S = this.style;
        const g = this.ctx;
        const grd = g.createLinearGradient(0, 0, 0, 160);
        grd.addColorStop(0, S.top);
        grd.addColorStop(1, S.bottom);
        g.fillStyle = grd;
        g.fillRect(0, 0, 256, 160);
        g.fillStyle = S.text;
        g.font = '14px Arial';
        g.textAlign = 'right';
        g.fillText(clock, 246, 20);
        g.textAlign = 'left';
        g.fillText(this.brand, 10, 20);
        g.fillStyle = playing ? S.title : S.dim;
        g.font = 'bold 18px Arial';
        const text = title || 'Radio off';
        g.fillText(text.length > 22 ? text.slice(0, 21) + '…' : text, 10, 62);
        g.fillStyle = S.bar;
        g.fillRect(10, 82, 236, 3);
        g.fillStyle = S.accent;
        g.fillRect(10, 82, playing ? 236 * ((now.getSeconds() % 60) / 60) : 0, 3);

        // Buttons
        SCREEN_BUTTONS.forEach((btn, i) => {
            const w = btn.x1 - btn.x0, h = BUTTON_Y1 - BUTTON_Y0;
            g.fillStyle = i === pressed ? S.btnPress : i === hover ? S.btnHover : S.btn;
            g.fillRect(btn.x0, BUTTON_Y0, w, h);
            g.strokeStyle = i === hover ? '#ffffff' : S.edge;
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

/** Red LED taxi meter: the fare runs up with the distance driven. */
class TaxiMeter {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 128;
        this.canvas.height = 48;
        this.ctx = this.canvas.getContext('2d');
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.metres = 0;
        this.shown = -1;
        this.draw();
    }

    add(metres) {
        this.metres += metres;
        this.draw();
    }

    draw() {
        // $3.00 flag fall plus $0.50 every 200 m
        const cents = 300 + Math.floor(this.metres / 200) * 50;
        if (cents === this.shown) return;
        this.shown = cents;
        const g = this.ctx;
        g.fillStyle = '#120202';
        g.fillRect(0, 0, 128, 48);
        g.fillStyle = '#ff2a1a';
        g.font = 'bold 26px monospace';
        g.textAlign = 'right';
        g.textBaseline = 'middle';
        g.fillText(`$${(cents / 100).toFixed(2)}`, 122, 28);
        g.font = '9px Arial';
        g.textAlign = 'left';
        g.fillText('FARE', 6, 10);
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
        this.model = getCarModel(vehicle.model || 'civic');
        this.themeId = THEMES[this.model.interior] ? this.model.interior : 'modern';
        this.theme = THEMES[this.themeId];
        this.shape = cabinShape(this.model);
        this.eye = this.shape.eye;
        const root = new THREE.Group();
        root.name = 'civic_interior';
        this.root = root;
        this._build();
        this._mergeStatic(root);
        if (this.doorTrim) this._mergeStatic(this.doorTrim);
        for (const group of [root, this.doorTrim]) {
            if (!group) continue;
            group.traverse((o) => {
                if (o.isMesh) {
                    o.castShadow = false;
                    o.receiveShadow = true;
                }
            });
        }
        vehicle.mesh.add(root);
        this.cockpitActive = false;
        this.cabinExposed = false;
        this.setOccupied(false);
        this.updateVisibility();
    }

    /**
     * Merges the fixed parts of the cabin (dash, seats, trim, pillars...) into one mesh per
     * material: a hundred-odd boxes become a handful of draw calls. Parts that move or are picked
     * (gauges, screen, steering wheel, arms, textured faces) stay as they are.
     */
    _mergeStatic(group) {
        const keep = new Set([this.cluster, this.screenMesh]);
        for (const arm of [this.armL, this.armR]) if (arm) keep.add(arm.handMesh).add(arm.fore);
        const byMat = new Map();
        for (const o of group.children) {
            if (!o.isMesh || keep.has(o) || o.children.length || !o.material || o.material.map) continue;
            if (!byMat.has(o.material)) byMat.set(o.material, []);
            byMat.get(o.material).push(o);
        }
        for (const [mat, list] of byMat) {
            if (list.length < 2) continue;
            const geos = list.map((o) => {
                o.updateMatrix();
                return o.geometry.clone().applyMatrix4(o.matrix);
            });
            const merged = new THREE.Mesh(mergeGeometries(geos), mat);
            merged.name = 'interior_static';
            for (const o of list) {
                group.remove(o);
                o.geometry.dispose();
            }
            group.add(merged);
        }
    }

    /**
     * The cabin is only drawn when it can be seen: from the driver's seat, or from outside through
     * an open door or shot-out glass (otherwise the tinted greenhouse hides it).
     */
    updateVisibility() {
        const v = this.vehicle;
        const see = this.cockpitActive || this.occupied || this.cabinExposed || !!v.transitionActive ||
            (v.doorOpenAngle || 0) > 0.01 || !!(v.cabinFrame && v.cabinFrame.visible);
        this.root.visible = see;
    }

    _build() {
        const M = themeMaterials(this.themeId);
        const T = this.theme;
        const S = this.shape;
        const R = this.root;
        const extras = new Set(T.extras);
        if (this.vehicle.isPolice) extras.add('policeGear');
        else extras.delete('policeGear');

        // The layout below is the Civic's (cabin floor 0.36, driver's seat at z -0.02), moved to this
        // cabin: heights follow the floor, depths follow the driver's seat, widths the cabin
        const dy = S.floor - 0.36;
        const Y = (y) => y + dy;
        const Z = (z) => z + S.seatZ + 0.02;
        const sx = S.halfW / 0.95;
        const X = (x) => x * sx;
        const hw = S.halfW;
        const F = S.front, RR = S.rear;
        const ex = this.eye.x;
        // Keeps dash items behind the (raked) windshield
        const fz = (z, y, m = 0.03) => Math.max(z, S.frontGlassZ(y) + m);

        // ---------- Floor, firewall, sills ----------
        const cabinLen = RR - F;
        box(R, M.carpet, 2 * hw - 0.1, 0.04, cabinLen - 0.1, 0, S.floor, (F + RR) / 2);
        box(R, M.carpet, 2 * hw - 0.1, 0.5, 0.05, 0, Y(0.6), F + 0.12, -0.5);       // firewall / footwell
        for (const s of [-1, 1]) box(R, M.trim, 0.12, 0.12, cabinLen - 0.1, s * (hw - 0.07), Y(0.42), (F + RR) / 2); // sills

        // ---------- Dashboard ----------
        const dashBack = Z(-0.87);
        const padFront = S.frontGlassZ(Y(0.95)) + 0.02;
        const padDepth = Math.max(0.12, dashBack - padFront);
        box(R, M.dashTop, 2 * hw - 0.04, 0.06, padDepth, 0, Y(0.95), dashBack - padDepth / 2, 0.08);   // dash top pad
        box(R, M.dash, 2 * hw - 0.04, 0.26, 0.18, 0, Y(0.82), Z(-0.92));                                 // dash face
        const lowFront = F + 0.08;
        const lowDepth = Math.max(0.2, Z(-0.92) - lowFront);
        box(R, M.dash, 2 * hw - 0.04, 0.12, lowDepth, 0, Y(0.7), Z(-0.92) - lowDepth / 2);               // lower dash
        const stripMat = extras.has('wood') ? M.wood : extras.has('carbon') ? M.carbon : extras.has('brushed') ? M.chrome : M.piano;
        box(R, stripMat, X(1.5), 0.025, 0.012, X(0.15), Y(0.9), Z(-0.83));                            // trim strip
        if (extras.has('wood') || extras.has('carbon') || extras.has('colorPanel')) {
            box(R, extras.has('colorPanel') ? M.accent : stripMat, X(0.7), 0.06, 0.012, X(0.48), Y(0.86), Z(-0.828));  // passenger trim panel
        }
        // Instrument binnacle and cluster
        const binZ = fz(Z(-0.95), Y(1.09), 0.12);
        box(R, M.dashTop, 0.52, 0.05, 0.22, ex, Y(1.07), binZ, -0.25);                                   // hood over gauges
        box(R, M.dash, 0.04, 0.14, 0.18, ex - 0.24, Y(0.99), binZ);
        box(R, M.dash, 0.04, 0.14, 0.18, ex + 0.24, Y(0.99), binZ);
        this.clusterTex = new Cluster(T, this.model.engine, this.model.name);
        const cluster = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.17), new THREE.MeshBasicMaterial({ map: this.clusterTex.texture }));
        cluster.position.set(ex, Y(1.0), binZ - 0.04);
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
            box(R, M.vent, w, 0.07, 0.03, x, Y(0.85), Z(-0.83));
            for (let i = 0; i < 4; i++) box(R, M.trim, w - 0.01, 0.006, 0.035, x, Y(0.825 + i * 0.016), Z(-0.82));
        };
        vent(X(-0.82), 0.12);
        vent(-0.08, 0.1);
        vent(0.08, 0.1);
        vent(X(0.82), 0.12);
        // Centre stack with infotainment screen, hazard button and climate knobs
        box(R, M.dash, 0.38, 0.36, 0.12, 0, Y(0.72), Z(-0.86), -0.12);
        // The screen stands proud of the dash: any lower and the dash top hides its button row
        this.screen = new InfoScreen(SCREEN_STYLES[T.screen] || SCREEN_STYLES.blue, T.brand);
        const screenZ = fz(Z(-0.85), Y(1.17), 0.05);
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.1875), new THREE.MeshBasicMaterial({ map: this.screen.texture }));
        screen.name = 'infotainment_screen';
        screen.position.set(0, Y(1.07), screenZ);
        screen.rotation.x = -0.18;
        R.add(screen);
        this.screenMesh = screen;
        this.hoverButton = -1;
        this.pressedButton = -1;
        this._pressTimer = 0;
        box(R, M.piano, 0.33, 0.21, 0.015, 0, Y(1.07), screenZ - 0.01, -0.18);                          // screen bezel
        box(R, M.red, 0.03, 0.02, 0.01, 0, Y(0.84), Z(-0.795));                                          // hazard button
        for (const kx of [-0.09, 0.09]) cyl(R, M.chrome, 0.022, 0.022, 0.025, kx, Y(0.74), Z(-0.79), Math.PI / 2 - 0.12);
        box(R, M.piano, 0.22, 0.03, 0.01, 0, Y(0.66), Z(-0.79), -0.12);                                 // climate display strip
        // Glovebox outline and passenger dash
        box(R, M.trim, 0.42, 0.005, 0.01, X(0.48), Y(0.79), Z(-0.83));
        box(R, M.trim, 0.005, 0.12, 0.01, X(0.27), Y(0.73), Z(-0.83));
        box(R, M.trim, 0.005, 0.12, 0.01, X(0.69), Y(0.73), Z(-0.83));

        // ---------- Steering column and wheel ----------
        cyl(R, M.trim, 0.045, 0.06, 0.3, ex, Y(0.87), Z(-0.82), Math.PI / 2 - 0.42);
        const wheelMount = new THREE.Group();
        wheelMount.position.set(ex, Y(0.92), Z(-0.64));
        wheelMount.rotation.x = -0.42; // top of the wheel leans away from the driver
        R.add(wheelMount);
        const wheel = new THREE.Group();
        wheel.name = 'steering_wheel';
        wheelMount.add(wheel);
        this.wheelR = this._buildSteeringWheel(wheel, T.wheel, M);
        this.wheel = wheel;
        // Hands grip at roughly 10 and 2 o'clock; they ride on the rim as the wheel turns
        const gr = this.wheelR;
        this.gripL = new THREE.Object3D();
        this.gripL.position.set(-Math.sin(1.0) * gr, Math.cos(1.0) * gr, 0.0);
        this.gripR = new THREE.Object3D();
        this.gripR.position.set(Math.sin(1.0) * gr, Math.cos(1.0) * gr, 0.0);
        wheelMount.add(this.gripL, this.gripR);
        if (T.shifter === 'column') {
            // Column shifter stalk on the right of the column
            const stalk = beam(R, M.trim, [ex + 0.05, Y(0.88), Z(-0.74)], [ex + 0.2, Y(0.84), Z(-0.68)], 0.018);
            stalk.name = 'column_shifter';
            box(R, M.piano, 0.04, 0.03, 0.03, ex + 0.21, Y(0.84), Z(-0.68));
        }

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
        const pz = (z) => Math.max(Z(z), F + 0.1);
        box(R, M.chrome, 0.07, 0.11, 0.02, ex + 0.12, Y(0.47), pz(-1.2), -0.5);                          // accelerator
        box(R, M.trim, 0.11, 0.08, 0.02, ex - 0.04, Y(0.5), pz(-1.18), -0.5);                            // brake
        if (extras.has('clutch')) box(R, M.trim, 0.09, 0.08, 0.02, ex - 0.2, Y(0.5), pz(-1.18), -0.5);    // clutch

        // ---------- Centre console ----------
        box(R, M.trim, 0.26, 0.22, 0.9, 0, Y(0.52), Z(-0.32));
        box(R, M.dash, 0.24, 0.03, 0.88, 0, Y(0.64), Z(-0.32));
        this._buildShifter(T.shifter, M, Y, Z);
        if (T.shifter !== 'column') {
            box(R, M.trim, 0.045, 0.035, 0.22, 0.0, Y(0.69), Z(-0.18), -0.25);                           // handbrake lever
            box(R, M.red, 0.012, 0.012, 0.012, 0.0, Y(0.72), Z(-0.08));
        }
        for (const cz of [0.08, 0.2]) cyl(R, M.piano, 0.038, 0.034, 0.01, 0.0, Y(0.655), Z(cz));          // cupholders
        box(R, M.seat, 0.24, 0.08, 0.3, 0, Y(0.7), Z(0.22));                                              // armrest

        // ---------- Seats ----------
        this._buildSeat(ex, S.seatZ, T.seats, M, Y);
        this._buildSeat(-ex, S.seatZ, T.seats, M, Y);
        // Rear bench, if the roof line leaves room for heads behind the front seats
        let rearZ = null;
        if (S.rearSeats) {
            rearZ = Math.min(S.seatZ + 0.75, S.rearGlassZ(Y(1.31)) - 0.25);
            if (rearZ < S.seatZ + 0.5) rearZ = null;
        }
        if (rearZ !== null) {
            const bw = X(1.6);
            box(R, M.seat, bw, 0.13, 0.38, 0, Y(0.58), rearZ);                                           // cushion
            box(R, M.seatInsert, bw - 0.04, 0.02, 0.3, 0, Y(0.655), rearZ - 0.02);
            box(R, M.seat, bw, 0.6, 0.1, 0, Y(0.94), rearZ + 0.2, 0.12);                                  // back
            for (const hx of [-0.55, 0, 0.55]) box(R, M.seat, 0.26, 0.14, 0.08, X(hx), Y(1.28), rearZ + 0.23, 0.12); // headrests
            // Cargo floor / parcel shelf behind the bench
            const cargo = RR - (rearZ + 0.3);
            if (cargo > 0.15) box(R, M.carpet, 2 * hw - 0.12, 0.03, cargo - 0.05, 0, Y(0.62), rearZ + 0.3 + cargo / 2);
        } else {
            // Two-seater: parcel shelf behind the seats
            const z0 = S.seatZ + 0.42;
            if (RR - z0 > 0.1) box(R, M.carpet, 2 * hw - 0.12, 0.03, RR - z0 - 0.05, 0, Y(0.72), (z0 + RR) / 2);
        }
        // Seat belts (B-pillar anchor diagonally across the seats)
        box(R, M.belt, 0.05, 0.75, 0.01, X(-0.62), Y(1.0), Z(0.24), 0, 0, -0.55);
        box(R, M.belt, 0.05, 0.75, 0.01, X(0.62), Y(1.0), Z(0.24), 0, 0, 0.55);

        // ---------- Door cards ----------
        const frontDoor0 = Math.max(F + 0.25, Z(-1.15));
        const frontDoor1 = S.bPillar - 0.04;
        const rearDoor1 = rearZ !== null ? Math.min(RR - 0.08, rearZ + 0.3) : RR - 0.08;
        // The driver's door card hangs on the door, so it swings open with it
        const pivot = this.vehicle.leftDoorPivot;
        if (pivot) {
            this.doorTrim = new THREE.Group();
            this.doorTrim.name = 'driver_door_trim';
            this.doorTrim.position.copy(pivot.position).negate();
            pivot.add(this.doorTrim);
        }
        for (const s of [-1, 1]) {
            const D = s < 0 && this.doorTrim ? this.doorTrim : R;
            const x = s * (hw - 0.03);
            const len = frontDoor1 - frontDoor0;
            const zc = (frontDoor0 + frontDoor1) / 2;
            box(D, M.doorCard, 0.05, 0.5, len, x, Y(0.66), zc);
            box(D, M.trim, 0.1, 0.05, Math.min(0.5, len * 0.45), x - s * 0.03, Y(0.79), Z(-0.42));      // armrest
            box(D, M.dashTop, 0.06, 0.06, len, x, S.belt + 0.03, zc);                                     // window sill
            box(D, M.chrome, 0.02, 0.03, 0.09, x - s * 0.04, Y(0.88), Math.max(frontDoor0 + 0.06, Z(-0.78))); // door handle
            box(D, M.piano, 0.05, 0.015, 0.12, x - s * 0.05, Y(0.82), Z(-0.4));                          // window switches
            const spk = new THREE.Mesh(new THREE.CircleGeometry(0.07, 18), M.speaker);
            spk.position.set(x - s * 0.026, Y(0.52), Math.max(frontDoor0 + 0.1, Z(-0.85)));
            spk.rotation.y = -s * Math.PI / 2;
            D.add(spk);
            if (extras.has('ambient')) box(D, M.glow, 0.008, 0.008, len * 0.8, x - s * 0.03, Y(0.84), zc);
            const rl = rearDoor1 - (S.bPillar + 0.04);
            if (rl > 0.1) {
                box(R, M.doorCard, 0.05, 0.45, rl, x, Y(0.66), S.bPillar + 0.04 + rl / 2);              // rear door card
                box(R, M.dashTop, 0.06, 0.06, rl, x, S.belt + 0.03, S.bPillar + 0.04 + rl / 2);
            }
        }

        // ---------- Pillars, headliner, visors, mirrors ----------
        const roofY = S.roof;
        const hlF = S.frontGlassZ(roofY) + 0.02, hlR = S.rearGlassZ(roofY) - 0.02;
        box(R, M.headliner, 2 * S.sideX(roofY) - 0.04, 0.03, Math.max(0.2, hlR - hlF), 0, roofY - 0.03, (hlF + hlR) / 2);
        for (const s of [-1, 1]) {
            const xb = s * (S.sideX(S.belt) - 0.04), xt = s * (S.sideX(roofY) - 0.04);
            beam(R, M.headliner, [xb, S.belt, S.frontGlassZ(S.belt) + 0.05], [xt, roofY - 0.02, S.frontGlassZ(roofY) + 0.05], 0.07, 0.08); // A-pillar
            beam(R, M.headliner, [xb, S.belt, S.bPillar], [xt, roofY - 0.02, S.bPillar], 0.08, 0.12);    // B-pillar
            beam(R, M.headliner, [xb, S.belt, S.rearGlassZ(S.belt) - 0.05], [xt, roofY - 0.02, S.rearGlassZ(roofY) - 0.05], 0.08, 0.1); // C-pillar
            const visY = roofY - 0.06;
            box(R, M.headliner, X(0.36), 0.02, 0.16, s * X(0.42), visY, S.frontGlassZ(visY) + 0.12, 0.12); // sun visor
            if (extras.has('grabHandles')) box(R, M.trim, 0.03, 0.03, 0.2, s * (S.sideX(roofY) - 0.07), roofY - 0.08, S.seatZ - 0.05);
            // Glass of the door mirrors on the outside of the car
            const sm = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.09), M.mirror);
            sm.position.set(s * (hw + 0.2), S.belt + 0.1, F + 0.22 + 0.075);
            R.add(sm);
        }
        const mirY = roofY - 0.12;
        const mirZ = S.frontGlassZ(mirY) + 0.08;
        box(R, M.dash, 0.02, 0.1, 0.02, 0, roofY - 0.06, mirZ - 0.02);                                  // mirror stem
        box(R, M.dash, 0.26, 0.075, 0.03, 0, mirY, mirZ);                                               // rear-view mirror
        const rv = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.06), M.mirror);
        rv.position.set(0, mirY, mirZ + 0.016);
        R.add(rv);
        box(R, M.trim, 0.12, 0.03, 0.06, 0, roofY - 0.045, hlF + 0.28);                                 // dome light
        box(R, M.glow, 0.08, 0.005, 0.03, 0, roofY - 0.061, hlF + 0.28);

        // ---------- Theme extras ----------
        if (extras.has('ambient')) box(R, M.glow, X(1.4), 0.006, 0.006, 0, Y(0.875), Z(-0.822));
        if (extras.has('carbon')) {
            box(R, M.carbon, 0.2, 0.012, 0.6, 0, Y(0.66), Z(-0.3));                                     // console top
            box(R, M.accent, 0.012, 0.012, 0.6, 0.11, Y(0.665), Z(-0.3));
        }
        if (extras.has('gaugePod')) {
            // Oil pressure / volts / water under the centre stack, chrome-ringed
            for (let i = -1; i <= 1; i++) {
                const gx = i * 0.085;
                cyl(R, M.chrome, 0.036, 0.036, 0.03, gx, Y(0.58), Z(-0.78), Math.PI / 2 - 0.3);
                const face = new THREE.Mesh(new THREE.CircleGeometry(0.03, 16), new THREE.MeshBasicMaterial({ color: 0xefe6cf }));
                face.position.set(gx, Y(0.582), Z(-0.763));
                face.rotation.x = -0.3;
                R.add(face);
                box(R, M.needle, 0.003, 0.024, 0.002, gx, Y(0.586), Z(-0.758), -0.3, 0, 0.6 - i * 0.5);
            }
        }
        if (extras.has('taxiMeter')) {
            this.taxiMeter = new TaxiMeter();
            const mz = fz(Z(-0.9), Y(1.04), 0.08);
            box(R, M.piano, 0.2, 0.08, 0.1, X(0.3), Y(1.01), mz);
            const face = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.066), new THREE.MeshBasicMaterial({ map: this.taxiMeter.texture }));
            face.position.set(X(0.3), Y(1.01), mz + 0.051);
            R.add(face);
        }
        if (extras.has('beads')) {
            // Bead strand hanging off the rear-view mirror
            for (let i = 0; i < 6; i++) {
                const b = new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 4), i % 2 ? M.red : M.glow);
                b.position.set(Math.sin(i * 0.5) * 0.02, mirY - 0.05 - i * 0.022, mirZ + 0.01);
                R.add(b);
            }
        }
        if (extras.has('clipboard')) box(R, M.trim, 0.22, 0.01, 0.3, X(0.45), Y(0.98), Z(-1.0), 0.08, 0.3);
        if (extras.has('policeGear')) {
            // Mobile data terminal on a pole mount over the console, radio head under the stack
            cyl(R, M.trim, 0.012, 0.012, 0.3, 0.12, Y(0.78), Z(-0.55));
            const lap = new THREE.Group();
            lap.position.set(0.12, Y(0.95), Z(-0.55));
            lap.rotation.set(-0.35, -0.5, 0);
            box(lap, M.piano, 0.3, 0.02, 0.22, 0, 0, 0);
            box(lap, M.piano, 0.3, 0.2, 0.015, 0, 0.1, -0.11, 0.3);
            box(lap, M.glow, 0.27, 0.17, 0.002, 0, 0.1, -0.1, 0.3);
            R.add(lap);
            box(R, M.piano, 0.2, 0.06, 0.1, 0, Y(0.6), Z(-0.62));
            box(R, M.red, 0.04, 0.012, 0.004, -0.05, Y(0.6), Z(-0.569));
        }
    }

    /** Builds the steering wheel into `wheel` and returns its rim radius. */
    _buildSteeringWheel(wheel, style, M) {
        if (style === 'sport') {
            // Small, thick, flat-bottomed rim with a red top marker
            const r = 0.172;
            const gap = 1.1;
            const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.024, 10, 40, Math.PI * 2 - gap), M.wheel);
            rim.rotation.z = -Math.PI / 2 + gap / 2;
            wheel.add(rim);
            const half = Math.sin(gap / 2) * r;
            box(wheel, M.wheel, half * 2, 0.04, 0.035, 0, -Math.cos(gap / 2) * r, 0);
            box(wheel, M.red, 0.02, 0.03, 0.05, 0, r, 0);
            const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.05, 20), M.carbon);
            hub.rotation.x = Math.PI / 2;
            hub.position.z = 0.02;
            wheel.add(hub);
            for (const a of [0, Math.PI]) {
                const sp = box(wheel, M.wheel, 0.12, 0.04, 0.018, Math.cos(a) * 0.11, Math.sin(a) * 0.11, 0.01);
                sp.rotation.z = a;
            }
            box(wheel, M.chrome, 0.03, 0.09, 0.016, 0, -0.1, 0.012);
            box(wheel, M.red, 0.025, 0.025, 0.006, -0.1, 0.0, 0.022);
            box(wheel, M.trim, 0.025, 0.025, 0.006, 0.1, 0.0, 0.022);
            return r;
        }
        if (style === 'classic') {
            // Thin wood rim, three drilled chrome spokes, horn button
            const r = 0.2;
            const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.014, 10, 44), M.wood);
            wheel.add(rim);
            for (const a of [Math.PI * 1.5, 0, Math.PI]) {
                const sp = box(wheel, M.chrome, r - 0.04, 0.03, 0.006, Math.cos(a) * (r / 2), Math.sin(a) * (r / 2), 0.01);
                sp.rotation.z = a;
            }
            const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.04, 20), M.wheel);
            hub.rotation.x = Math.PI / 2;
            hub.position.z = 0.02;
            wheel.add(hub);
            const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.006, 18), M.red);
            horn.rotation.x = Math.PI / 2;
            horn.position.z = 0.042;
            wheel.add(horn);
            return r;
        }
        if (style === 'truck') {
            // Big four-spoke wheel with a boxy airbag hub
            const r = 0.205;
            const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.021, 10, 44), M.wheel);
            wheel.add(rim);
            for (const a of [-0.45, Math.PI + 0.45, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5]) {
                const sp = box(wheel, M.wheel, 0.13, 0.04, 0.018, Math.cos(a) * 0.13, Math.sin(a) * 0.13, 0.01);
                sp.rotation.z = a;
            }
            box(wheel, M.wheel, 0.15, 0.11, 0.05, 0, 0, 0.02);
            box(wheel, M.chrome, 0.05, 0.02, 0.005, 0, 0.01, 0.047);
            return r;
        }
        // Modern three-spoke
        const r = 0.185;
        const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.019, 10, 40), M.wheel);
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
        return r;
    }

    _buildShifter(style, M, Y, Z) {
        const R = this.root;
        if (style === 'column') {
            // Flat console with a storage bin instead of a shifter
            box(R, M.piano, 0.16, 0.012, 0.22, 0, Y(0.66), Z(-0.52));
            return;
        }
        if (style === 'manual') {
            // Leather boot, short stick, round knob with the shift pattern on top
            cyl(R, M.seat, 0.02, 0.06, 0.08, 0, Y(0.69), Z(-0.55));
            cyl(R, M.chrome, 0.009, 0.009, 0.14, 0, Y(0.78), Z(-0.55), 0.1);
            const knob = new THREE.Mesh(new THREE.SphereGeometry(0.033, 16, 12), this.themeId === 'muscle' ? M.chrome : M.piano);
            knob.position.set(0, Y(0.86), Z(-0.545));
            R.add(knob);
            const pat = new THREE.Mesh(new THREE.CircleGeometry(0.018, 14), M.glow);
            pat.rotation.x = -Math.PI / 2;
            pat.position.set(0, Y(0.892), Z(-0.545));
            R.add(pat);
            return;
        }
        box(R, M.piano, 0.12, 0.01, 0.16, 0, Y(0.66), Z(-0.55));                 // shifter surround
        cyl(R, M.trim, 0.012, 0.014, 0.16, 0, Y(0.73), Z(-0.55), 0.15);          // shift lever
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 10), M.piano);
        knob.position.set(0, Y(0.82), Z(-0.54));
        knob.scale.set(1, 0.85, 1.15);
        this.root.add(knob);
        box(R, M.chrome, 0.018, 0.006, 0.06, 0, Y(0.84), Z(-0.54));
    }

    _buildSeat(x, z, style, M, Y) {
        const R = this.root;
        if (style === 'bucket') {
            // Sports bucket: deep bolsters, integrated headrest with harness slots
            box(R, M.seat, 0.52, 0.12, 0.52, x, Y(0.56), z);
            box(R, M.seatInsert, 0.26, 0.02, 0.42, x, Y(0.63), z - 0.02);
            box(R, M.seat, 0.1, 0.24, 0.52, x - 0.23, Y(0.66), z, 0, 0, 0.12);
            box(R, M.seat, 0.1, 0.24, 0.52, x + 0.23, Y(0.66), z, 0, 0, -0.12);
            box(R, M.seat, 0.5, 0.7, 0.13, x, Y(0.97), z + 0.3, 0.18);
            box(R, M.seatInsert, 0.26, 0.46, 0.02, x, Y(0.92), z + 0.225, 0.18);
            for (const s of [-1, 1]) box(R, M.seat, 0.09, 0.56, 0.16, x + s * 0.22, Y(0.95), z + 0.29, 0.18, 0, -s * 0.15);
            for (const s of [-1, 1]) box(R, M.vent, 0.06, 0.03, 0.14, x + s * 0.08, Y(1.2), z + 0.35, 0.18);
            return;
        }
        box(R, M.seat, 0.52, 0.13, 0.52, x, Y(0.58), z);                         // cushion
        box(R, M.seatInsert, 0.31, 0.02, 0.4, x, Y(0.655), z - 0.02);
        box(R, M.seat, 0.08, 0.16, 0.5, x - 0.24, Y(0.66), z);                   // side bolsters
        box(R, M.seat, 0.08, 0.16, 0.5, x + 0.24, Y(0.66), z);
        box(R, M.seat, 0.52, 0.62, 0.13, x, Y(0.94), z + 0.3, 0.2);              // back
        box(R, M.seatInsert, 0.31, 0.5, 0.02, x, Y(0.93), z + 0.23, 0.2);
        box(R, M.seat, 0.26, 0.16, 0.1, x, Y(1.25), z + 0.37, 0.12);             // headrest
        cyl(R, M.chrome, 0.008, 0.008, 0.06, x - 0.07, Y(1.16), z + 0.36);
        cyl(R, M.chrome, 0.008, 0.008, 0.06, x + 0.07, Y(1.16), z + 0.36);
    }

    /** Kept for the game loop; the car body is hollow around the cabin so nothing is hidden. */
    setCockpitActive(active) {
        this.cockpitActive = !!active;
        this.updateVisibility();
    }

    /** Shows the driver's arms on the wheel while the player is in this car, hides them otherwise. */
    setOccupied(occupied) {
        this.occupied = occupied;
        if (this.root) this.updateVisibility();
        for (const arm of [this.armL, this.armR]) {
            arm.hand.visible = arm.fore.visible = occupied;
            arm.point.visible = false;
        }
    }

    /**
     * Lets the cabin be seen into from outside once a window is broken: the solid greenhouse gives
     * way to its pillars and roof edges, so the seats and whoever is in them show through the glass.
     */
    exposeCabin() {
        if (this.cabinExposed) return;
        const mesh = this.vehicle.mesh;
        const cabin = mesh.getObjectByName('cabin_roof');
        if (!cabin) return;
        this.cabinExposed = true;
        this.root.visible = true;
        if (typeof this.vehicle.setCabinSeeThrough === 'function') {
            this.vehicle.setCabinSeeThrough(true);
            return;
        }
        cabin.visible = false;
        const frame = buildCabinFrame(this.model.id);
        frame.name = 'cabin_frame';
        frame.castShadow = frame.receiveShadow = true;
        mesh.add(frame);
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
        const gr = this.wheelR;
        for (const [grip, base] of [[this.gripL, 1.0], [this.gripR, -1.0]]) {
            const a = base + handRot;
            grip.position.set(-Math.sin(a) * gr, Math.cos(a) * gr, 0.0);
            grip.rotation.z = handRot;
        }

        // Gauges: speedometer and tachometer read the car's gearbox (vehicle.rpm)
        const mph = Math.abs(v.speed || 0) * 2.23694;
        const sweep = Math.PI * 1.5;
        // Dials start at 7:30 and sweep 270 degrees clockwise
        this.speedNeedle.rotation.z = -Math.PI * 1.25 - Math.min(1, mph / this.clusterTex.maxMph) * sweep;
        const running = v.engineOn !== false;
        let rpm = Number.isFinite(v.rpm) ? v.rpm : (running ? 800 : 0);
        if (!running) rpm = 0;
        this._rpm = this._rpm === undefined ? rpm : this._rpm + (rpm - this._rpm) * Math.min(1, dt * 12);
        this.tachNeedle.rotation.z = -Math.PI * 1.25 - Math.min(1.02, this._rpm / this.clusterTex.maxRpm) * sweep;
        this.clusterTex.draw(v.gearLabel || (running ? 'D' : 'P'));
        if (this.taxiMeter && running) this.taxiMeter.add(Math.abs(v.speed || 0) * dt);

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
        this.armR.fore.visible = true;

        const reachTarget = info.reach ? 1 : 0;
        this._reach = (this._reach || 0) + (reachTarget - (this._reach || 0)) * Math.min(1, dt * 12);
        if (this._reach > 0.01 && info.reachPoint) this._placeReach(this.armR, info.reachPoint, this._reach);
        else this.armR.point.visible = false;
        if (this._reach <= 0.01) this.armR.hand.visible = true;
        // Seen from outside (chase camera) there is no body attached to the arms
        if (info.showArms === false) {
            for (const arm of [this.armL, this.armR]) arm.hand.visible = arm.fore.visible = arm.point.visible = false;
        }
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
        const E = this.eye;
        _v1.copy(point);
        R.worldToLocal(_v1);
        const sx = E.x + 0.2, sy = E.y - 0.3, sz = E.z + 0.05;
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
        const E = this.eye;
        // Hand on the grip point (interior space), turned with the hands' share of the wheel
        grip.getWorldPosition(_v1);
        R.worldToLocal(_v1);
        arm.hand.position.copy(_v1);
        arm.hand.quaternion.copy(grip.parent.quaternion);
        arm.hand.rotateZ(grip.rotation.z);
        // Forearm runs from the wrist back and down towards the elbow, out of view below the camera
        const hx = _v1.x, hy = _v1.y, hz = _v1.z;
        let dx = E.x + arm.side * 0.3 - hx;
        let dy = E.y - 0.6 - hy;
        let dz = E.z + 0.15 - hz;
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
// Window shattering
// ================================================================================================
const SHARD_COUNT = 90;
const MAX_SHARDS = SHARD_COUNT * 4;

// Window panes come from the car model (carModels.js getWindowFrames): each lies in a plane through
// `origin` spanned by U (across) and V (up the glass), with N pointing out of the car, and `poly`
// is the pane outline in (u, v). Side windows break forward of the B-pillar; the rear quarter pane
// behind it is separate glass and survives. `floor` is where shards that fall inside come to rest.
function windowPoint(w, u, v, target) {
    return target.copy(w.origin).addScaledVector(w.U, u).addScaledVector(w.V, v);
}

/** Random (u, v) inside the pane outline. */
function randomInPane(w, out) {
    for (let tries = 0; tries < 12; tries++) {
        out[0] = w.u0 + Math.random() * (w.u1 - w.u0);
        out[1] = w.v0 + Math.random() * (w.v1 - w.v0);
        if (pointInPoly(w.poly, out[0], out[1])) return out;
    }
    out[0] = (w.u0 + w.u1) / 2;
    out[1] = (w.v0 + w.v1) / 2;
    return out;
}

/** Glass shards flying out of broken windows, plus the jagged edges left in the frames. */
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
        this.mesh = new THREE.InstancedMesh(shardGeo, this.material, MAX_SHARDS);
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
        this._uv = [0, 0];
    }

    /** Smashes the driver's window outward (the driver leaning out to shoot). */
    breakDriverWindow(vehicle, audioCtx = null) {
        return this.breakWindow(vehicle, 'left', audioCtx, true);
    }

    isBroken(vehicle, which) {
        return !!(vehicle && vehicle.brokenWindows && vehicle.brokenWindows[which]);
    }

    /**
     * Breaks one window of `vehicle` ('front', 'back', 'left' or 'right'): hides the glass, leaves
     * jagged edges in the frame, throws shards and plays the sound. Struck from outside, most of
     * the shards fall into the car; from inside, most fly out.
     */
    breakWindow(vehicle, which, audioCtx = null, fromInside = false) {
        if (!vehicle || !vehicle.mesh || this.isBroken(vehicle, which)) return false;
        const w = getWindowFrames(vehicle.model || 'civic')[which];
        if (!w) return false;
        const glass = vehicle.mesh.getObjectByName(w.glass);
        if (!glass) return false;
        vehicle.brokenWindows = vehicle.brokenWindows || {};
        vehicle.brokenWindows[which] = true;
        if (which === 'left') vehicle.driverWindowBroken = true;
        glass.visible = false;
        const root = vehicle.mesh;
        const P = this._p;
        const shape = cabinShape(vehicle.model || 'civic');

        // Jagged remains along the bottom and up both sides of the frame, lying in the glass plane
        const edges = new THREE.Group();
        edges.name = `${which}_window_jagged_edges`;
        const basis = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(w.U, w.V, w.N));
        const spin = new THREE.Quaternion();
        const zAxis = new THREE.Vector3(0, 0, 1);
        const addShard = (u, v, sw, sh, rot) => {
            const m = new THREE.Mesh(this.mesh.geometry, this.material);
            windowPoint(w, u, v, m.position);
            m.quaternion.copy(basis).multiply(spin.setFromAxisAngle(zAxis, rot));
            m.scale.set(sw, sh, 1);
            edges.add(m);
        };
        const vb = w.v0 + 0.03;
        const bottom = polySpanAt(w.poly, vb) || [w.u0, w.u1];
        const span = bottom[1] - bottom[0];
        const bottomCount = Math.max(3, Math.round(9 * span / 1.37));
        for (let i = 0; i < bottomCount; i++) {
            const u = bottom[0] + 0.06 + Math.random() * Math.max(0, span - 0.12);
            addShard(u, vb, 0.05 + Math.random() * 0.08, 0.06 + Math.random() * 0.1, (Math.random() - 0.5) * 0.6);
        }
        for (let i = 0; i < 4; i++) {
            const v = w.v0 + 0.05 + Math.random() * (w.v1 - w.v0) * 0.6;
            const sp = polySpanAt(w.poly, v);
            if (!sp) continue;
            addShard(sp[0] + 0.03, v, 0.05 + Math.random() * 0.05, 0.05 + Math.random() * 0.09, Math.PI / 2 + (Math.random() - 0.5));
            addShard(sp[1] - 0.03, v, 0.05 + Math.random() * 0.05, 0.05 + Math.random() * 0.09, -Math.PI / 2 + (Math.random() - 0.5));
        }
        // The driver's door glass hangs on the door, so its broken edges do too
        const doorPivot = which === 'left' && vehicle.leftDoorPivot && glass.parent === vehicle.leftDoorPivot ? vehicle.leftDoorPivot : null;
        if (doorPivot) {
            edges.position.copy(doorPivot.position).negate();
            doorPivot.add(edges);
        } else {
            root.add(edges);
        }

        // Flying shards: outward ones in world space, inward ones in car space so they settle on the
        // seats / dash and ride along with the car
        root.updateMatrixWorld(true);
        const yaw = vehicle.yaw || 0;
        const cos = Math.cos(yaw), sin = Math.sin(yaw);
        const onX = w.N.x, onY = w.N.y, onZ = w.N.z;                                // outward, car space
        const outX = onX * cos + onZ * sin, outZ = -onX * sin + onZ * cos;          // outward, world space
        const vx = vehicle.velocity ? vehicle.velocity.x : 0, vz = vehicle.velocity ? vehicle.velocity.y : 0;
        const inwardShare = fromInside ? 0.2 : 0.75;
        const bounds = { x: shape.halfW - 0.12, z0: shape.front + 0.12, z1: shape.rear - 0.25 };
        for (let i = 0; i < SHARD_COUNT; i++) {
            const [u, v] = randomInPane(w, this._uv);
            const inward = i < SHARD_COUNT * inwardShare;
            const shard = {
                rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6,
                sx: (Math.random() - 0.5) * 30, sy: (Math.random() - 0.5) * 30, sz: (Math.random() - 0.5) * 30,
                size: 0.015 + Math.random() * 0.05,
                resting: false
            };
            if (inward) {
                windowPoint(w, u, v, P);
                const push = 0.4 + Math.random() * 1.2;
                shard.vehicle = vehicle;
                shard.floor = w.floor;
                shard.bounds = bounds;
                // Shards in the player's lap stay; ones shot into other cars are cleared after a minute
                shard.life = fromInside ? 1e9 : 60 + Math.random() * 10;
                shard.local = {
                    x: P.x, y: P.y, z: P.z,
                    vx: -onX * push + (Math.random() - 0.5) * 0.4,
                    vy: -onY * push * 0.5 + Math.random() * 0.8 - 0.1,
                    vz: -onZ * push + (Math.random() - 0.5) * 0.4
                };
            } else {
                windowPoint(w, u, v, P).applyMatrix4(root.matrixWorld);
                const out = 1.2 + Math.random() * 3.5;
                Object.assign(shard, {
                    x: P.x, y: P.y, z: P.z,
                    vx: vx + outX * out + (Math.random() - 0.5) * 1.4,
                    vy: Math.random() * 1.6 - 0.2 + onY * out * 0.5,
                    vz: vz + outZ * out + (Math.random() - 0.5) * 1.4,
                    vehicle: null,
                    floor: 0.015,
                    life: 8 + Math.random() * 4
                });
            }
            this.shards.push(shard);
        }
        if (this.shards.length > MAX_SHARDS) this.shards.splice(0, this.shards.length - MAX_SHARDS);
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
                // Inward shards: simulate in car space so they land inside as the car drives
                const L = s.local;
                const B = s.bounds;
                if (!s.resting) {
                    L.vy -= 9.8 * dt;
                    L.x += L.vx * dt; L.y += L.vy * dt; L.z += L.vz * dt;
                    // Stay inside the cabin
                    if (Math.abs(L.x) > B.x) { L.x = Math.sign(L.x) * B.x; L.vx = 0; }
                    if (L.z < B.z0 || L.z > B.z1) { L.z = Math.max(B.z0, Math.min(B.z1, L.z)); L.vz = 0; }
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
