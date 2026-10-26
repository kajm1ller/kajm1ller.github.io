/**
 * js/game/drugs.js
 *
 * Drugs: inventory items (they never spawn in the world) that the player holds like any other
 * item and uses with a click. Each one has
 * - an item definition (kind 'drug', a stack of doses / hits) and an inventory icon,
 * - a first-person model and a use animation that fits how it's taken: lighting and smoking a
 *   cigarette or joint, pulling on a vape or dab pen, hitting a bong, snorting a line or a key
 *   bump, heating a crack stem or a meth bulb with a torch, chasing fentanyl on foil, injecting
 *   heroin, dropping an LSD tab, eating mushrooms, sipping lean from a double cup,
 * - an effect profile: how fast it comes on, how long it peaks and fades (and for stimulants, the
 *   crash after), and what it does while it's in your system. Effects stack and mix.
 *
 * DrugEffects turns the doses in your system into one effect state each frame: screen channels for
 * the post-processing pass (drugFx.js: colour, blur, warping, trails, double vision, kaleidoscope,
 * tunnel vision, nodding off, paranoid shadows...), camera channels (sway, roll, shake, FOV), and
 * gameplay channels (walking speed, mouse sensitivity / lag, damage taken, health regen or drain,
 * music speed). Too many opioids or stimulants at once is an overdose that drains health.
 */

import * as THREE from 'three';
import { registerItem, getItemDef } from './items.js';

// ================================================================================================
// Definitions
// ================================================================================================
// Effect channels per unit of intensity. Colours are [r, g, b] tints.
const WEED = { sat: 0.35, tint: [1.0, 0.92, 0.72], tintAmt: 0.12, blur: 0.5, wave: 0.12, breathe: 0.08, chroma: 0.15, trail: 0.15,
    fovAdd: 4, moveScale: -0.12, mouseScale: -0.25, sway: 0.15, musicRate: -0.2 };
const OPIOID = { tint: [1.0, 0.78, 0.55], tintAmt: 0.22, sat: -0.15, blur: 1.1, vignette: 0.45, sway: 0.45, moveScale: -0.4,
    mouseScale: -0.35, damageScale: -0.5, regen: 0.5, nod: 1, muffle: 0.7, fovAdd: -3, musicRate: -0.45 };
const STIM = { contrast: 0.25, bright: 0.05, sat: 0.15, shake: 0.45, moveScale: 0.3, mouseScale: 0.3, damageScale: -0.25,
    heartbeat: 1, vignette: 0.08, fovAdd: -4, musicRate: -0.1 };
const CRASH = { sat: -0.35, bright: -0.07, vignette: 0.25, moveScale: -0.2, mouseScale: -0.1, blur: 0.25, musicRate: -0.25 };

/**
 * method: how it's taken (picks the model and the animation)
 * doses: how many come in the stack you start with (max stack)
 * onset / peak / fade / crash: seconds
 * fx / crashFx: channels at full intensity
 * opioid / stim: overdose load per dose at full intensity
 */
export const DRUGS = {
    cigarettes: {
        name: 'Cigarettes', method: 'cigarette', doses: 20, color: 0xf2f2f2,
        desc: 'Nicotine buzz, steadier nerves',
        onset: 3, peak: 15, fade: 45,
        fx: { vignette: 0.12, sway: 0.05, bright: -0.02, damageScale: -0.05, musicRate: -0.05, label: 'Buzzed' }
    },
    vape: {
        name: 'Vape', method: 'vape', doses: 60, color: 0x29b6f6,
        desc: 'Quick nicotine head rush',
        onset: 1, peak: 6, fade: 25,
        fx: { vignette: 0.1, sway: 0.06, fovAdd: 1.5, musicRate: -0.08, label: 'Head rush' }
    },
    dabpen: {
        name: 'Weed (Dab Pen)', method: 'dabpen', doses: 40, color: 0x43a047,
        desc: 'Fast-hitting concentrate high',
        onset: 4, peak: 70, fade: 90, strength: 0.9,
        fx: Object.assign({}, WEED, { label: 'High' })
    },
    joint: {
        name: 'Weed (Joint)', method: 'joint', doses: 6, color: 0x7cb342,
        desc: 'Mellow, giggly, hungry',
        onset: 8, peak: 90, fade: 110, strength: 0.85,
        fx: Object.assign({}, WEED, { label: 'High' })
    },
    bong: {
        name: 'Weed (Bong)', method: 'bong', doses: 10, color: 0x26a69a,
        desc: 'Big rip. Cough. Couch-locked.',
        onset: 3, peak: 110, fade: 130, strength: 1.3,
        fx: Object.assign({}, WEED, { label: 'Baked' })
    },
    cocaine: {
        name: 'Cocaine', method: 'line', doses: 10, color: 0xf5f5f5,
        desc: 'Fast, confident, wired; then the comedown',
        onset: 4, peak: 70, fade: 45, crash: 70,
        fx: Object.assign({}, STIM, { label: 'Wired' }), crashFx: Object.assign({}, CRASH, { label: 'Comedown' }),
        stim: 0.6
    },
    crack: {
        name: 'Crack Cocaine', method: 'stem', doses: 10, color: 0xe8dcc0,
        desc: 'A huge, short rush and a hard crash',
        onset: 1, peak: 22, fade: 25, crash: 80, strength: 1.4,
        fx: Object.assign({}, STIM, { shake: 0.8, chroma: 0.35, flash: 1, label: 'Rushing' }),
        crashFx: Object.assign({}, CRASH, { sat: -0.5, label: 'Crashing' }),
        stim: 0.85
    },
    heroin: {
        name: 'Heroin', method: 'syringe', doses: 5, color: 0x8d6e63,
        desc: 'Warm, numb, nodding off',
        onset: 6, peak: 130, fade: 100,
        fx: Object.assign({}, OPIOID, { label: 'Nodding' }),
        opioid: 0.7
    },
    fentanyl: {
        name: 'Fentanyl', method: 'foil', doses: 5, color: 0x90caf9,
        desc: 'Far stronger than heroin. Two is an overdose.',
        onset: 3, peak: 100, fade: 90, strength: 1.5,
        fx: Object.assign({}, OPIOID, { label: 'Sedated' }),
        opioid: 0.95
    },
    meth: {
        name: 'Crystal Meth', method: 'bulb', doses: 10, color: 0xb3e5fc,
        desc: 'Hours awake, twitchy, paranoid',
        onset: 2, peak: 240, fade: 120, crash: 140,
        fx: Object.assign({}, STIM, { contrast: 0.32, shake: 0.6, grain: 0.35, paranoia: 1, label: 'Tweaking' }),
        crashFx: Object.assign({}, CRASH, { label: 'Crashing' }),
        stim: 0.7
    },
    ketamine: {
        name: 'Ketamine', method: 'key', doses: 10, color: 0xeeeeee,
        desc: 'Detached, slow, the world far away',
        onset: 3, peak: 70, fade: 60, strength: 1,
        fx: { ghost: 1, fovAdd: 16, wave: 0.22, mouseLag: 0.85, moveScale: -0.45, muffle: 0.6, ring: 0.5, sat: -0.25,
            trail: 0.45, vignette: 0.3, roll: 0.35, sway: 0.3, musicRate: -0.55, label: 'In a K-hole' }
    },
    lsd: {
        name: 'LSD', method: 'tab', doses: 5, color: 0xff7043,
        desc: 'The colours start to change... then you go somewhere else entirely',
        // The colours shift and then stop; the trip itself is Mermaid World (game.html startLsdTrip)
        onset: 3, peak: 8, fade: 3, trip: 'mermaid',
        fx: { hueCycle: 1.4, sat: 0.7, wave: 0.2, breathe: 0.25, trail: 0.3, kaleido: 0.15, chroma: 0.3, contrast: 0.1, musicRate: -0.3, label: 'Colours shifting' }
    },
    psilocybin: {
        name: 'Psilocybin', method: 'mushrooms', doses: 5, color: 0xa1887f,
        desc: 'Breathing walls, warm colours, the giggles',
        onset: 30, peak: 200, fade: 150,
        fx: { sat: 0.45, tint: [1.0, 0.95, 0.8], tintAmt: 0.1, wave: 0.28, breathe: 0.45, trail: 0.3, kaleido: 0.18, hueCycle: 0.25,
            sway: 0.2, chroma: 0.3, musicRate: -0.35, label: 'Shrooming' }
    },
    // Alcohol: no fixed curve; each drink adds `alcohol` units to your blood (DrugEffects.drink).
    // A beer is one unit, a shot of whiskey a bit more, a shot of vodka more again.
    beer: {
        name: 'Beer', method: 'bottle', doses: 6, color: 0xc8892a, alcohol: 1.0,
        desc: 'A cold one. Takes the edge off.', onset: 1, peak: 1, fade: 1
    },
    whiskey: {
        name: 'Whiskey', method: 'shot', doses: 5, color: 0xb5651d, alcohol: 1.6, liquid: 0xc07a28,
        desc: 'A shot of whiskey. Warm all the way down.', onset: 1, peak: 1, fade: 1
    },
    vodka: {
        name: 'Vodka', method: 'shot', doses: 5, color: 0xdfe9f2, alcohol: 2.1, liquid: 0xeef6ff,
        desc: 'A shot of vodka. Hits harder than it tastes.', onset: 1, peak: 1, fade: 1
    },
    lean: {
        name: 'Lean', method: 'cup', doses: 4, color: 0x8e24aa,
        desc: 'Purple, slow, everything chopped and screwed',
        onset: 8, peak: 150, fade: 120,
        fx: { tint: [0.72, 0.45, 1.0], tintAmt: 0.55, sat: -0.1, blur: 0.7, sway: 0.55, roll: 0.3, moveScale: -0.3, mouseScale: -0.3,
            musicRate: -0.5, muffle: 0.35, damageScale: -0.15, vignette: 0.25, label: 'Leaned' },
        opioid: 0.35
    }
};
export const DRUG_IDS = Object.keys(DRUGS);
export const ALCOHOL_IDS = DRUG_IDS.filter((id) => DRUGS[id].alcohol);

for (const id of DRUG_IDS) {
    const d = DRUGS[id];
    registerItem({
        id, name: d.name, kind: 'drug', type: 'drug', method: d.method,
        stackable: true, maxStack: d.doses, hotbar: true, desc: d.desc, iconColor: d.color,
        damage: 0, fireRate: 0, range: 0, spread: 0, projectileSpeed: 0, sound: null
    });
}

export function isDrug(def) {
    return !!def && def.kind === 'drug';
}

// ================================================================================================
// Inventory icons
// ================================================================================================
function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
}

/** Draws a drug's inventory icon onto a 2D canvas context of w x h. */
export function drawDrugIcon(g, def, w, h) {
    const m = def.method;
    const cx = w / 2, cy = h / 2, s = Math.min(w / 120, h / 48);
    g.save();
    g.translate(cx, cy);
    g.scale(s, s);
    const fill = (c) => { g.fillStyle = c; };
    switch (m) {
        case 'cigarette':
            fill('#c62828'); rr(g, -30, -16, 40, 32, 4); g.fill();          // pack
            fill('#fafafa'); rr(g, -30, -16, 40, 10, 3); g.fill();
            fill('#f5f5f5'); g.fillRect(14, -4, 34, 7);                       // a cigarette
            fill('#e0a060'); g.fillRect(14, -4, 10, 7);
            fill('#ff7043'); g.fillRect(46, -4, 3, 7);
            break;
        case 'vape':
            fill('#263238'); rr(g, -36, -10, 62, 20, 6); g.fill();
            fill('#29b6f6'); rr(g, -30, -6, 22, 12, 3); g.fill();
            fill('#111'); rr(g, 24, -5, 14, 10, 3); g.fill();
            break;
        case 'dabpen':
            fill('#212121'); rr(g, -42, -5, 70, 10, 5); g.fill();
            fill('#ffb300'); rr(g, 24, -5, 18, 10, 3); g.fill();
            fill('#43a047'); g.beginPath(); g.arc(-30, 0, 2.5, 0, Math.PI * 2); g.fill();
            break;
        case 'joint':
            fill('#f1ead2'); g.beginPath(); g.moveTo(-40, -4); g.lineTo(28, -9); g.lineTo(28, 9); g.lineTo(-40, 4); g.closePath(); g.fill();
            fill('#c8b88a'); g.fillRect(-44, -4, 8, 8);
            fill('#7cb342'); g.fillRect(28, -6, 6, 12);
            break;
        case 'bong':
            fill('rgba(150,220,210,0.85)'); rr(g, -8, -22, 16, 34, 5); g.fill();
            g.beginPath(); g.arc(0, 14, 13, 0, Math.PI * 2); g.fill();
            fill('rgba(70,140,200,0.9)'); g.beginPath(); g.arc(0, 16, 9, 0, Math.PI); g.fill();
            fill('#90a4ae'); g.save(); g.rotate(-0.8); g.fillRect(8, 6, 18, 4); g.restore();
            break;
        case 'line':
            fill('#90a4ae'); rr(g, -42, -14, 84, 28, 3); g.fill();
            fill('#fafafa'); g.fillRect(-30, -6, 44, 4); g.fillRect(-26, 3, 40, 4);
            fill('#eceff1'); rr(g, 22, -10, 10, 22, 2); g.fill();
            break;
        case 'stem':
            fill('rgba(220,235,240,0.9)'); rr(g, -42, -4, 72, 8, 4); g.fill();
            fill('#e8dcc0'); g.beginPath(); g.arc(36, 0, 6, 0, Math.PI * 2); g.fill();
            fill('#d7ccc8'); g.beginPath(); g.arc(46, 6, 4, 0, Math.PI * 2); g.fill();
            break;
        case 'syringe':
            fill('#eceff1'); rr(g, -26, -6, 50, 12, 2); g.fill();
            fill('#8d6e63'); g.fillRect(-10, -4, 30, 8);
            fill('#b0bec5'); g.fillRect(24, -1, 22, 2);
            fill('#607d8b'); g.fillRect(-40, -2, 14, 4); g.fillRect(-44, -8, 4, 16);
            break;
        case 'foil':
            fill('#cfd8dc'); g.beginPath(); g.moveTo(-44, -8); g.lineTo(40, -14); g.lineTo(44, 6); g.lineTo(-40, 12); g.closePath(); g.fill();
            fill('#4e342e'); g.fillRect(-10, -3, 26, 3);
            fill('#90caf9'); g.beginPath(); g.arc(-28, 0, 6, 0, Math.PI * 2); g.fill();
            break;
        case 'bulb':
            fill('rgba(225,245,254,0.9)'); g.fillRect(-44, -3, 54, 6);
            g.beginPath(); g.arc(22, 0, 14, 0, Math.PI * 2); g.fill();
            fill('#b3e5fc'); g.beginPath(); g.arc(24, 6, 5, 0, Math.PI * 2); g.fill();
            break;
        case 'key':
            fill('#bdbdbd'); g.beginPath(); g.arc(-26, 0, 12, 0, Math.PI * 2); g.fill();
            fill('#424242'); g.beginPath(); g.arc(-26, 0, 4, 0, Math.PI * 2); g.fill();
            fill('#bdbdbd'); g.fillRect(-16, -4, 50, 8); g.fillRect(22, 4, 4, 6); g.fillRect(30, 4, 4, 5);
            fill('#fafafa'); g.beginPath(); g.ellipse(26, -6, 7, 3, 0, 0, Math.PI * 2); g.fill();
            break;
        case 'tab': {
            fill('#fff3e0'); g.fillRect(-18, -18, 36, 36);
            const cols = ['#ff7043', '#ab47bc', '#29b6f6', '#66bb6a', '#ffee58'];
            for (let i = 0; i < 5; i++) { fill(cols[i]); g.beginPath(); g.arc(0, 0, 16 - i * 3, 0, Math.PI * 2); g.fill(); }
            g.strokeStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.moveTo(0, -18); g.lineTo(0, 18); g.moveTo(-18, 0); g.lineTo(18, 0); g.stroke();
            break;
        }
        case 'mushrooms':
            for (const [x, y, r] of [[-16, 2, 13], [12, -2, 11]]) {
                fill('#efe6d8'); g.fillRect(x - 3, y, 6, 16);
                fill('#a1887f'); g.beginPath(); g.ellipse(x, y, r, r * 0.6, 0, Math.PI, 0); g.fill();
            }
            break;
        case 'cup':
            fill('#fafafa'); g.beginPath(); g.moveTo(-16, -20); g.lineTo(16, -20); g.lineTo(12, 22); g.lineTo(-12, 22); g.closePath(); g.fill();
            fill('#eeeeee'); g.beginPath(); g.moveTo(-17, -14); g.lineTo(17, -14); g.lineTo(13, 22); g.lineTo(-13, 22); g.closePath(); g.fill();
            fill('#8e24aa'); g.beginPath(); g.ellipse(0, -18, 14, 3, 0, 0, Math.PI * 2); g.fill();
            break;
        case 'bottle':
            fill('#5d3a12'); rr(g, -9, -6, 18, 30, 4); g.fill();                 // brown glass
            fill('#5d3a12'); g.fillRect(-4, -22, 8, 18);                         // neck
            fill('#cfd8dc'); g.fillRect(-5, -25, 10, 4);                         // cap
            fill('#f2e3b3'); g.fillRect(-9, 2, 18, 11);                          // label
            fill('#c62828'); g.fillRect(-9, 6, 18, 3);
            break;
        case 'shot': {
            const liq = '#' + ((DRUGS[def.id] && DRUGS[def.id].liquid) || 0xc07a28).toString(16).padStart(6, '0');
            fill('rgba(220,240,245,0.55)'); g.beginPath(); g.moveTo(-13, -18); g.lineTo(13, -18); g.lineTo(10, 18); g.lineTo(-10, 18); g.closePath(); g.fill();
            fill(liq); g.beginPath(); g.moveTo(-12, -6); g.lineTo(12, -6); g.lineTo(10, 14); g.lineTo(-10, 14); g.closePath(); g.fill();
            fill('rgba(255,255,255,0.8)'); g.fillRect(-10, 14, 20, 4);          // thick base
            break;
        }
        default:
            fill('#' + def.iconColor.toString(16).padStart(6, '0')); g.beginPath(); g.arc(0, 0, 14, 0, Math.PI * 2); g.fill();
    }
    g.restore();
}

// ================================================================================================
// First-person models (built in the viewmodel's frame: camera at the origin looking down -Z)
// ================================================================================================
const SKIN = 0xffcc99;
const _mats = new Map();
function mat(color, opts = {}) {
    const key = `${color}|${JSON.stringify(opts)}`;
    if (!_mats.has(key)) {
        _mats.set(key, opts.basic
            ? new THREE.MeshBasicMaterial(Object.assign({ color }, opts.params))
            : new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0.05 }, opts.params)));
    }
    return _mats.get(key);
}
function mesh(geo, material, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    return m;
}
const glass = () => mat(0xdff3f5, { params: { transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.1, depthWrite: false } });

/** A loose fist around the thing held, the forearm running down and back out of view. */
function hand(x = 0, y = -0.02, z = 0.015) {
    const g = new THREE.Group();
    const skin = mat(SKIN);
    g.add(mesh(new THREE.BoxGeometry(0.046, 0.032, 0.046), skin, 0, 0, 0));
    g.add(mesh(new THREE.BoxGeometry(0.014, 0.014, 0.03), skin, -0.024, 0.016, -0.006));
    const arm = mesh(new THREE.BoxGeometry(0.046, 0.04, 0.2), mat(0x2b2b30), 0, -0.07, 0.07);
    arm.rotation.x = 0.95;
    g.add(arm);
    g.position.set(x, y, z);
    return g;
}

function lighter(torch = false) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.025, 0.06, 0.012), mat(torch ? 0x212121 : 0xe53935), 0, 0, 0));
    g.add(mesh(new THREE.BoxGeometry(0.02, 0.012, 0.012), mat(0x9e9e9e, { params: { metalness: 0.8, roughness: 0.3 } }), 0, 0.036, 0));
    const flame = new THREE.Group();
    const outer = mesh(new THREE.ConeGeometry(torch ? 0.006 : 0.008, torch ? 0.045 : 0.028, 8), mat(torch ? 0x4fc3f7 : 0xffa726, { basic: true, params: { transparent: true, opacity: 0.85 } }), 0, 0.016, 0);
    flame.add(outer);
    flame.add(mesh(new THREE.ConeGeometry(0.004, 0.014, 6), mat(torch ? 0xe1f5fe : 0xfff59d, { basic: true }), 0, 0.008, 0));
    flame.position.y = 0.045;
    if (torch) flame.rotation.z = 0;
    flame.visible = false;
    g.add(flame);
    g.add(hand(0, -0.03, 0.012));
    g.userData.flame = flame;
    return g;
}

function ember(r = 0.006) {
    return mesh(new THREE.SphereGeometry(r, 8, 6), mat(0xff5722, { basic: true, params: { transparent: true, opacity: 0.0 } }));
}

/**
 * The first-person model for a drug: { group, main, aux, parts } where `main` is what the lead
 * hand holds and `aux` the other hand's thing (lighter, torch, syringe...) if any.
 */
export function buildDrugViewmodel(id) {
    const def = DRUGS[id];
    const group = new THREE.Group();
    group.name = `viewmodel_${id}`;
    const main = new THREE.Group();
    group.add(main);
    let aux = null;
    const parts = {};
    switch (def.method) {
        case 'cigarette':
        case 'joint': {
            const joint = def.method === 'joint';
            const body = joint
                ? mesh(new THREE.CylinderGeometry(0.0065, 0.0042, 0.085, 10), mat(0xf1ead2))
                : mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.08, 10), mat(0xf5f5f5));
            body.rotation.x = Math.PI / 2;
            main.add(body);
            if (!joint) {
                const filter = mesh(new THREE.CylinderGeometry(0.0047, 0.0047, 0.024, 10), mat(0xe0a060), 0, 0, 0.03);
                filter.rotation.x = Math.PI / 2;
                main.add(filter);
            }
            parts.ember = ember(joint ? 0.0068 : 0.005);
            parts.ember.position.z = -0.043;
            main.add(parts.ember);
            main.add(hand(0.01, -0.025, 0.02));
            aux = lighter();
            break;
        }
        case 'vape':
        case 'dabpen': {
            const pen = def.method === 'dabpen';
            const body = pen
                ? mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.12, 12), mat(0x212121, { params: { metalness: 0.6, roughness: 0.3 } }))
                : mesh(new THREE.BoxGeometry(0.035, 0.012, 0.09), mat(0x263238, { params: { metalness: 0.5, roughness: 0.35 } }));
            if (pen) body.rotation.x = Math.PI / 2;
            main.add(body);
            const tip = pen
                ? mesh(new THREE.CylinderGeometry(0.0055, 0.0065, 0.02, 12), mat(0xffb300), 0, 0, -0.068)
                : mesh(new THREE.BoxGeometry(0.018, 0.009, 0.02), mat(0x111111), 0, 0, -0.054);
            if (pen) tip.rotation.x = Math.PI / 2;
            main.add(tip);
            parts.led = mesh(new THREE.SphereGeometry(pen ? 0.003 : 0.004, 6, 4), mat(pen ? 0x76ff03 : 0x29b6f6, { basic: true, params: { transparent: true, opacity: 0.25 } }), 0, pen ? 0.006 : 0.007, 0.03);
            main.add(parts.led);
            main.add(hand(0, -0.028, 0.03));
            break;
        }
        case 'bong': {
            const tinted = mat(0x80cbc4, { params: { transparent: true, opacity: 0.5, roughness: 0.05, metalness: 0.1, depthWrite: false } });
            main.add(mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.012, 16, 1, true), mat(0x26a69a), 0, -0.004, 0));
            main.add(mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.24, 16, 1, true), tinted, 0, -0.12, 0));
            main.add(mesh(new THREE.SphereGeometry(0.055, 16, 12), tinted, 0, -0.27, 0));
            parts.water = mesh(new THREE.SphereGeometry(0.05, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat(0x4fc3f7, { params: { transparent: true, opacity: 0.65 } }), 0, -0.27, 0);
            main.add(parts.water);
            const stem = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.09, 8), mat(0x90a4ae, { params: { metalness: 0.7 } }), 0, -0.24, -0.05);
            stem.rotation.x = 0.9;
            main.add(stem);
            main.add(mesh(new THREE.CylinderGeometry(0.016, 0.008, 0.02, 10), mat(0x90a4ae, { params: { metalness: 0.7 } }), 0, -0.205, -0.088));
            parts.bowl = ember(0.012);
            parts.bowl.position.set(0, -0.196, -0.088);
            main.add(parts.bowl);
            parts.smoke = mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.22, 12), mat(0xeceff1, { params: { transparent: true, opacity: 0, depthWrite: false } }), 0, -0.12, 0);
            main.add(parts.smoke);
            main.add(hand(0.03, -0.2, 0.02));
            aux = lighter();
            break;
        }
        case 'line': {
            // A pocket mirror with two lines and a rolled bill
            main.add(mesh(new THREE.BoxGeometry(0.12, 0.004, 0.08), mat(0xb0bec5, { params: { metalness: 0.9, roughness: 0.1 } })));
            parts.lines = [mesh(new THREE.BoxGeometry(0.07, 0.004, 0.008), mat(0xffffff, { basic: true }), -0.005, 0.004, -0.012),
                mesh(new THREE.BoxGeometry(0.06, 0.004, 0.008), mat(0xffffff, { basic: true }), -0.005, 0.004, 0.012)];
            for (const l of parts.lines) main.add(l);
            main.add(hand(0.07, -0.02, 0.03));
            aux = new THREE.Group();
            const bill = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 8), mat(0x81c784));
            bill.rotation.z = Math.PI / 2;
            aux.add(bill);
            aux.add(hand(-0.01, -0.02, 0.012));
            break;
        }
        case 'key': {
            main.scale.setScalar(1.6);
            main.add(mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.004, 14), mat(0xbdbdbd, { params: { metalness: 0.9, roughness: 0.25 } }), 0, 0, 0.025));
            main.children[0].rotation.x = Math.PI / 2;
            main.add(mesh(new THREE.BoxGeometry(0.009, 0.003, 0.05), mat(0xbdbdbd, { params: { metalness: 0.9, roughness: 0.25 } }), 0, 0, -0.01));
            parts.powder = mesh(new THREE.SphereGeometry(0.006, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xfafafa), 0, 0.002, -0.028);
            main.add(parts.powder);
            main.add(hand(0, -0.025, 0.035));
            break;
        }
        case 'stem': {
            const tube = mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.1, 10, 1, true), glass());
            tube.rotation.x = Math.PI / 2;
            main.add(tube);
            parts.rock = ember(0.004);
            parts.rock.material = mat(0xe8dcc0, { params: { emissive: 0xff6d00, emissiveIntensity: 0 } }).clone();
            parts.rock.position.z = -0.044;
            main.add(parts.rock);
            parts.smoke = mesh(new THREE.CylinderGeometry(0.0038, 0.0038, 0.098, 8), mat(0xffffff, { params: { transparent: true, opacity: 0, depthWrite: false } }));
            parts.smoke.rotation.x = Math.PI / 2;
            main.add(parts.smoke);
            main.add(hand(0, -0.022, 0.03));
            aux = lighter(true);
            break;
        }
        case 'bulb': {
            const stem = mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.1, 10, 1, true), glass());
            stem.rotation.x = Math.PI / 2;
            main.add(stem);
            main.add(mesh(new THREE.SphereGeometry(0.02, 16, 12), glass(), 0, 0, -0.065));
            parts.crystal = mesh(new THREE.OctahedronGeometry(0.006), mat(0xe1f5fe, { params: { transparent: true, opacity: 0.9 } }), 0, -0.012, -0.065);
            main.add(parts.crystal);
            parts.vapor = mesh(new THREE.SphereGeometry(0.018, 12, 10), mat(0xffffff, { params: { transparent: true, opacity: 0, depthWrite: false } }), 0, 0, -0.065);
            main.add(parts.vapor);
            main.add(hand(0, -0.022, 0.032));
            aux = lighter(true);
            break;
        }
        case 'foil': {
            const foil = mesh(new THREE.BoxGeometry(0.03, 0.001, 0.13), mat(0xcfd8dc, { params: { metalness: 0.95, roughness: 0.25 } }));
            main.add(foil);
            parts.bead = mesh(new THREE.SphereGeometry(0.004, 8, 6), mat(0x4e342e), 0, 0.002, 0.03);
            main.add(parts.bead);
            parts.trail = mesh(new THREE.BoxGeometry(0.004, 0.001, 1), mat(0x3e2723), 0, 0.0012, 0.03);
            parts.trail.scale.z = 0.001;
            main.add(parts.trail);
            main.add(hand(0.02, -0.015, 0.06));
            // A straw for the smoke, held in the teeth (shown with the foil)
            parts.straw = mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.09, 8), mat(0xffffff), 0, 0.05, -0.02);
            parts.straw.rotation.x = 1.0;
            main.add(parts.straw);
            aux = lighter();
            break;
        }
        case 'syringe': {
            const barrel = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 10), mat(0xeceff1, { params: { transparent: true, opacity: 0.7 } }));
            barrel.rotation.x = Math.PI / 2;
            main.add(barrel);
            parts.liquid = mesh(new THREE.CylinderGeometry(0.0052, 0.0052, 0.05, 10), mat(0x8d6e63));
            parts.liquid.rotation.x = Math.PI / 2;
            parts.liquid.position.z = -0.008;
            main.add(parts.liquid);
            const needle = mesh(new THREE.CylinderGeometry(0.0008, 0.0008, 0.035, 6), mat(0xb0bec5, { params: { metalness: 0.9 } }), 0, 0, -0.052);
            needle.rotation.x = Math.PI / 2;
            main.add(needle);
            parts.plunger = new THREE.Group();
            const rod = mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.05, 6), mat(0x607d8b));
            rod.rotation.x = Math.PI / 2;
            parts.plunger.add(rod);
            parts.plunger.add(mesh(new THREE.BoxGeometry(0.02, 0.003, 0.003), mat(0x607d8b), 0, 0, 0.025));
            parts.plunger.position.z = 0.045;
            main.add(parts.plunger);
            main.add(hand(0, -0.02, 0.05));
            // The other forearm, sleeve pushed up, with a belt tied above the elbow
            aux = new THREE.Group();
            aux.add(mesh(new THREE.BoxGeometry(0.06, 0.05, 0.32), mat(SKIN)));
            aux.add(mesh(new THREE.BoxGeometry(0.066, 0.056, 0.05), mat(0x5d4037), 0, 0, 0.12));
            aux.add(mesh(new THREE.BoxGeometry(0.068, 0.058, 0.12), mat(0x2b2b30), 0, 0, 0.2));
            break;
        }
        case 'tab': {
            parts.tab = mesh(new THREE.BoxGeometry(0.02, 0.0015, 0.02), mat(0xff7043), 0, 0.02, -0.022);
            main.add(parts.tab);
            main.add(hand(0, -0.012, 0.02));
            break;
        }
        case 'mushrooms': {
            for (const [x, z, r] of [[-0.012, -0.012, 0.011], [0.01, -0.004, 0.009], [0, 0.01, 0.008]]) {
                main.add(mesh(new THREE.CylinderGeometry(0.003, 0.004, 0.022, 6), mat(0xefe6d8), x, 0.008, z));
                main.add(mesh(new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xa1887f), x, 0.018, z));
            }
            main.add(hand(0, -0.018, 0.02));
            break;
        }
        case 'cup': {
            // Double styrofoam cup of purple drank
            main.add(mesh(new THREE.CylinderGeometry(0.038, 0.028, 0.11, 18, 1, true), mat(0xfafafa, { params: { side: THREE.DoubleSide } })));
            main.add(mesh(new THREE.CylinderGeometry(0.0395, 0.03, 0.09, 18, 1, true), mat(0xeeeeee, { params: { side: THREE.DoubleSide } }), 0, -0.012, 0));
            parts.drank = mesh(new THREE.CircleGeometry(0.034, 18), mat(0x8e24aa), 0, 0.04, 0);
            parts.drank.rotation.x = -Math.PI / 2;
            main.add(parts.drank);
            main.add(hand(0.0, -0.01, 0.04));
            break;
        }
        case 'bottle': {
            // A brown beer bottle, neck up
            const brown = mat(0x4a2c0c, { params: { roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92 } });
            main.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 16), brown, 0, 0, 0));
            main.add(mesh(new THREE.CylinderGeometry(0.012, 0.03, 0.04, 16), brown, 0, 0.08, 0));
            main.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 12), brown, 0, 0.125, 0));
            main.add(mesh(new THREE.CylinderGeometry(0.0135, 0.0135, 0.008, 12), mat(0xcfd8dc, { params: { metalness: 0.8, roughness: 0.3 } }), 0, 0.152, 0));
            main.add(mesh(new THREE.CylinderGeometry(0.0305, 0.0305, 0.05, 16, 1, true), mat(0xf2e3b3), 0, -0.005, 0));
            main.add(hand(0.0, -0.03, 0.035));
            break;
        }
        case 'shot': {
            // A shot glass, filled
            main.add(mesh(new THREE.CylinderGeometry(0.022, 0.018, 0.06, 16, 1, true), glass()));
            main.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 16), glass(), 0, -0.026, 0));
            parts.drank = mesh(new THREE.CircleGeometry(0.02, 16), mat(def.liquid || 0xc07a28, { params: { transparent: true, opacity: 0.9 } }), 0, 0.016, 0);
            parts.drank.rotation.x = -Math.PI / 2;
            main.add(parts.drank);
            main.add(hand(0.0, -0.02, 0.03));
            break;
        }
        default:
            break;
    }
    if (aux) group.add(aux);
    group.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
    return { group, main, aux, parts, method: def.method };
}

// ================================================================================================
// Use animations: keyframed poses for the lead hand (main) and the other hand (aux)
// ================================================================================================
// Rest: held low on the lead side. Mouth: just under the centre of the view, close.
const REST = { p: [0.19, -0.2, -0.36], r: [0.25, 0.4, 0.15] };
const AUX_HIDE = { p: [-0.25, -0.45, -0.3], r: [0, 0, 0] };

/** [time, main {p, r}, aux {p, r} | null, event?, look-down radians] */
function kf(t, p, r, ap = null, ar = null, ev = null, lk = 0) {
    return { t, p, r, ap, ar, ev, lk };
}
const MOUTH_STICK = [0.02, -0.085, -0.19];
const ANIMS = {
    cigarette: [
        kf(0, REST.p, REST.r, AUX_HIDE.p, AUX_HIDE.r),
        kf(0.7, MOUTH_STICK, [0.05, 0.1, 0.05], [-0.06, -0.16, -0.26], [0, 0, 0.2]),
        kf(1.0, MOUTH_STICK, [0.05, 0.1, 0.05], [-0.015, -0.13, -0.2], [0, 0, 0.1], 'flick'),
        kf(1.9, MOUTH_STICK, [0.05, 0.1, 0.05], [-0.015, -0.13, -0.2], [0, 0, 0.1], 'inhale'),
        kf(2.3, MOUTH_STICK, [0.05, 0.1, 0.05], AUX_HIDE.p, AUX_HIDE.r, 'dose'),
        kf(3.4, MOUTH_STICK, [0.05, 0.1, 0.05], AUX_HIDE.p, AUX_HIDE.r),
        kf(4.0, [0.17, -0.17, -0.33], [0.2, 0.35, 0.1], AUX_HIDE.p, AUX_HIDE.r, 'exhale'),
        kf(5.4, [0.18, -0.19, -0.35], REST.r, AUX_HIDE.p, AUX_HIDE.r)
    ],
    vape: [
        kf(0, REST.p, REST.r),
        kf(0.6, [0.01, -0.09, -0.18], [0.1, 0.0, 0.0], null, null, 'inhale'),
        kf(0.8, [0.01, -0.09, -0.18], [0.1, 0.0, 0.0], null, null, 'dose'),
        kf(2.4, [0.01, -0.09, -0.18], [0.1, 0.0, 0.0]),
        kf(2.9, [0.17, -0.18, -0.33], REST.r, null, null, 'exhaleBig'),
        kf(4.4, REST.p, REST.r)
    ],
    bong: [
        kf(0, [0.16, -0.13, -0.48], [0.1, 0, 0.1], AUX_HIDE.p, AUX_HIDE.r),
        kf(0.8, [0.0, -0.08, -0.2], [0.45, 0, 0], [-0.07, -0.33, -0.36], [0, 0, 0.3], null, 0.35),
        kf(1.2, [0.0, -0.08, -0.2], [0.45, 0, 0], [-0.03, -0.3, -0.33], [0, 0, 0.6], 'flick', 0.35),
        kf(1.4, [0.0, -0.08, -0.2], [0.45, 0, 0], [-0.03, -0.3, -0.33], [0, 0, 0.6], 'bubble', 0.35),
        kf(3.8, [0.0, -0.08, -0.2], [0.45, 0, 0], [-0.03, -0.3, -0.33], [0, 0, 0.6], 'dose', 0.35),
        kf(4.2, [0.0, -0.08, -0.2], [0.45, 0, 0], AUX_HIDE.p, AUX_HIDE.r, 'clear', 0.2),
        kf(5.2, [0.16, -0.13, -0.48], [0.1, 0, 0.1], AUX_HIDE.p, AUX_HIDE.r, 'exhaleBig'),
        kf(6.0, [0.16, -0.13, -0.48], [0.1, 0, 0.1], AUX_HIDE.p, AUX_HIDE.r, 'cough'),
        kf(8.0, [0.16, -0.13, -0.48], [0.1, 0, 0.1], AUX_HIDE.p, AUX_HIDE.r)
    ],
    line: [
        kf(0, [0.12, -0.24, -0.36], [0.5, 0, 0], AUX_HIDE.p, AUX_HIDE.r),
        kf(0.7, [0.02, -0.15, -0.26], [0.75, 0, 0], [-0.04, -0.13, -0.26], [0, 0.6, 0], null, 0.5),
        kf(1.2, [0.02, -0.14, -0.22], [0.75, 0, 0], [-0.02, -0.105, -0.2], [0, 0.6, 0.4], 'snort', 0.55),
        kf(2.0, [0.02, -0.14, -0.22], [0.75, 0, 0], [-0.02, -0.105, -0.2], [0, 0.6, 0.4], 'dose', 0.45),
        kf(2.6, [0.12, -0.24, -0.36], [0.5, 0, 0], AUX_HIDE.p, AUX_HIDE.r, 'sniff'),
        kf(3.6, [0.12, -0.24, -0.36], [0.5, 0, 0], AUX_HIDE.p, AUX_HIDE.r)
    ],
    key: [
        kf(0, REST.p, [0.3, 0.3, 0]),
        kf(0.7, [0.0, -0.1, -0.16], [0.35, 0, 0], null, null, null, 0.25),
        kf(0.9, [0.0, -0.095, -0.15], [0.35, 0, 0], null, null, 'snort', 0.25),
        kf(1.2, [0.0, -0.095, -0.15], [0.35, 0, 0], null, null, 'dose', 0.1),
        kf(1.9, REST.p, [0.3, 0.3, 0], null, null, 'sniff'),
        kf(2.8, REST.p, [0.3, 0.3, 0])
    ],
    stem: [
        kf(0, REST.p, REST.r, AUX_HIDE.p, AUX_HIDE.r),
        kf(0.7, [0.025, -0.09, -0.19], [0.08, 0.15, 0], [-0.05, -0.17, -0.2], [0, 0, 0.5]),
        kf(1.0, [0.025, -0.09, -0.19], [0.08, 0.15, 0], [-0.02, -0.135, -0.2], [0, 0, 0.9], 'torch'),
        kf(1.4, [0.025, -0.09, -0.19], [0.08, 0.15, 0], [-0.02, -0.135, -0.2], [0, 0, 0.9], 'inhale'),
        kf(3.0, [0.025, -0.09, -0.19], [0.08, 0.15, 0], [-0.02, -0.135, -0.2], [0, 0, 0.9], 'dose'),
        kf(3.4, [0.025, -0.09, -0.19], [0.08, 0.15, 0], AUX_HIDE.p, AUX_HIDE.r, 'clear'),
        kf(4.2, REST.p, REST.r, AUX_HIDE.p, AUX_HIDE.r, 'exhaleBig'),
        kf(6.0, REST.p, REST.r, AUX_HIDE.p, AUX_HIDE.r)
    ],
    bulb: [
        kf(0, REST.p, REST.r, AUX_HIDE.p, AUX_HIDE.r),
        kf(0.7, [0.03, -0.085, -0.2], [0.0, 0.25, 0], [-0.07, -0.19, -0.24], [0, 0, 0.3]),
        kf(1.0, [0.03, -0.085, -0.2], [0.0, 0.25, 0], [-0.035, -0.12, -0.23], [0, 0, 0], 'torch'),
        kf(3.6, [0.03, -0.085, -0.2], [0.0, 0.25, 0], [-0.035, -0.12, -0.23], [0, 0, 0], 'inhale'),
        kf(4.6, [0.03, -0.085, -0.2], [0.0, 0.25, 0], AUX_HIDE.p, AUX_HIDE.r, 'dose'),
        kf(5.0, [0.03, -0.085, -0.2], [0.0, 0.25, 0], AUX_HIDE.p, AUX_HIDE.r, 'clear'),
        kf(5.7, REST.p, REST.r, AUX_HIDE.p, AUX_HIDE.r, 'exhaleBig'),
        kf(7.2, REST.p, REST.r, AUX_HIDE.p, AUX_HIDE.r)
    ],
    foil: [
        kf(0, [0.12, -0.25, -0.36], [0.2, 0, 0], AUX_HIDE.p, AUX_HIDE.r),
        kf(0.8, [0.02, -0.1, -0.22], [0.75, 0, 0], [-0.03, -0.2, -0.24], [0, 0, 0], null, 0.5),
        kf(1.1, [0.02, -0.1, -0.22], [0.75, 0, 0], [0.0, -0.165, -0.22], [0, 0, 0], 'flick', 0.55),
        kf(1.3, [0.02, -0.1, -0.22], [0.75, 0, 0], [0.0, -0.165, -0.22], [0, 0, 0], 'inhale', 0.55),
        kf(4.2, [0.02, -0.1, -0.22], [0.75, 0, 0], [0.0, -0.165, -0.25], [0, 0, 0], 'dose', 0.55),
        kf(4.6, [0.02, -0.1, -0.22], [0.75, 0, 0], AUX_HIDE.p, AUX_HIDE.r, 'clear', 0.3),
        kf(5.3, [0.12, -0.25, -0.36], [0.2, 0, 0], AUX_HIDE.p, AUX_HIDE.r, 'exhale'),
        kf(6.4, [0.12, -0.25, -0.36], [0.2, 0, 0], AUX_HIDE.p, AUX_HIDE.r)
    ],
    syringe: [
        kf(0, REST.p, [0, 0.3, 0], AUX_HIDE.p, [0, 1.4, 0]),
        kf(1.0, [0.12, -0.12, -0.28], [0.3, 0.9, 0.2], [-0.02, -0.21, -0.3], [0.1, 1.45, 0], null, 0.45),
        kf(1.6, [0.05, -0.155, -0.29], [0.35, 1.0, 0.25], [-0.02, -0.21, -0.3], [0.1, 1.45, 0], 'pierce', 0.5),
        kf(2.0, [0.05, -0.155, -0.29], [0.35, 1.0, 0.25], [-0.02, -0.21, -0.3], [0.1, 1.45, 0], 'push', 0.5),
        kf(3.8, [0.05, -0.155, -0.29], [0.35, 1.0, 0.25], [-0.02, -0.21, -0.3], [0.1, 1.45, 0], 'dose', 0.5),
        kf(4.4, [0.12, -0.12, -0.28], [0.3, 0.9, 0.2], [-0.02, -0.21, -0.3], [0.1, 1.45, 0], null, 0.3),
        kf(5.4, REST.p, [0, 0.3, 0], AUX_HIDE.p, [0, 1.4, 0], 'sigh'),
        kf(6.0, REST.p, [0, 0.3, 0], AUX_HIDE.p, [0, 1.4, 0])
    ],
    tab: [
        kf(0, REST.p, [0.2, 0, 0]),
        kf(0.6, [0.0, -0.08, -0.15], [0.1, 0, 0]),
        kf(0.9, [0.0, -0.075, -0.13], [0.1, 0, 0], null, null, 'dose'),
        kf(1.6, REST.p, [0.2, 0, 0]),
        kf(2.2, REST.p, [0.2, 0, 0])
    ],
    mushrooms: [
        kf(0, REST.p, [0.2, 0, 0]),
        kf(0.7, [0.0, -0.085, -0.16], [0.2, 0, 0]),
        kf(0.9, [0.0, -0.08, -0.14], [0.2, 0, 0], null, null, 'dose'),
        kf(1.5, REST.p, [0.2, 0, 0], null, null, 'chew'),
        kf(3.6, REST.p, [0.2, 0, 0])
    ],
    cup: [
        kf(0, REST.p, [0, 0, 0.1]),
        kf(0.8, [0.0, -0.11, -0.19], [-0.6, 0, 0]),
        kf(1.0, [0.0, -0.105, -0.17], [-0.85, 0, 0], null, null, 'sip'),
        kf(1.8, [0.0, -0.105, -0.17], [-0.85, 0, 0], null, null, 'dose'),
        kf(2.3, [0.04, -0.12, -0.2], [-0.2, 0, 0]),
        kf(2.8, [0.0, -0.105, -0.17], [-0.85, 0, 0], null, null, 'sip'),
        kf(3.4, [0.0, -0.105, -0.17], [-0.85, 0, 0]),
        kf(4.2, REST.p, [0, 0, 0.1], null, null, 'ahh'),
        kf(4.6, REST.p, [0, 0, 0.1])
    ]
};
// Swig from a bottle: up, tip it back, a couple of gulps
ANIMS.bottle = [
    kf(0, REST.p, [0, 0, 0.1]),
    kf(0.7, [0.0, -0.1, -0.2], [-0.9, 0, 0]),
    kf(1.0, [0.0, -0.09, -0.17], [-1.5, 0, 0], null, null, 'sip', -0.15),
    kf(1.9, [0.0, -0.09, -0.17], [-1.7, 0, 0], null, null, 'dose', -0.25),
    kf(2.4, [0.03, -0.12, -0.21], [-0.6, 0, 0], null, null, 'ahh'),
    kf(2.9, REST.p, [0, 0, 0.1])
];
// Knock back a shot: quick up, head back, down
ANIMS.shot = [
    kf(0, REST.p, [0, 0, 0]),
    kf(0.45, [0.0, -0.09, -0.17], [-0.3, 0, 0]),
    kf(0.7, [0.0, -0.075, -0.14], [-1.9, 0, 0], null, null, 'dose', -0.3),
    kf(1.0, [0.0, -0.075, -0.14], [-2.1, 0, 0], null, null, 'gulp', -0.3),
    kf(1.5, [0.04, -0.14, -0.24], [0, 0, 0], null, null, 'ahh'),
    kf(1.9, REST.p, [0, 0, 0])
];
ANIMS.joint = ANIMS.cigarette.map((k) => Object.assign({}, k, { t: k.t * 1.1 }));
ANIMS.dabpen = ANIMS.vape;

const smooth = (x) => x * x * (3 - 2 * x);

/** Pose at the start of the method's animation (how the item sits in the hand when held). */
export function restPose(vm) {
    const k = ANIMS[vm.method][0];
    vm.main.position.set(...k.p);
    vm.main.rotation.set(...k.r);
    if (vm.aux) {
        vm.aux.position.set(...(k.ap || AUX_HIDE.p));
        vm.aux.rotation.set(...(k.ar || AUX_HIDE.r));
    }
    resetParts(vm);
}

function resetParts(vm) {
    const P = vm.parts;
    if (P.ember) P.ember.material.opacity = 0;
    if (P.led) P.led.material.opacity = 0.25;
    if (P.bowl) P.bowl.material.opacity = 0;
    if (P.smoke) P.smoke.material.opacity = 0;
    if (P.water) P.water.position.y = -0.1;
    if (P.lines) for (const l of P.lines) l.scale.x = 1;
    if (P.powder) P.powder.visible = true;
    if (P.rock) P.rock.material.emissiveIntensity = 0;
    if (P.vapor) P.vapor.material.opacity = 0;
    if (P.crystal) P.crystal.scale.setScalar(1);
    if (P.bead) P.bead.position.z = 0.03;
    if (P.trail) P.trail.scale.z = 0.001;
    if (P.plunger) P.plunger.position.z = 0.045;
    if (P.liquid) P.liquid.scale.y = 1;
    if (P.tab) P.tab.visible = true;
    if (P.drank) { P.drank.position.y = vm.method === 'shot' ? 0.016 : 0.04; P.drank.visible = true; }
    if (vm.aux && vm.aux.userData.flame) vm.aux.userData.flame.visible = false;
}

/** One use of a drug: plays the animation and reports events ('dose', 'exhale', 'cough'...). */
export class DrugUse {
    constructor(vm, id) {
        this.vm = vm;
        this.id = id;
        this.keys = ANIMS[vm.method];
        this.t = 0;
        this.duration = this.keys[this.keys.length - 1].t;
        this.fired = new Set();
        this.done = false;
        this.flags = {};
        this.look = 0;      // radians the head tips down to watch the hands
        resetParts(vm);
    }

    /** Advances by dt; returns the events that happened. */
    update(dt) {
        const events = [];
        this.t = Math.min(this.duration, this.t + dt);
        const K = this.keys;
        for (let i = 0; i < K.length; i++) {
            if (K[i].ev && this.t >= K[i].t && !this.fired.has(i)) {
                this.fired.add(i);
                events.push(K[i].ev);
                this.flags[K[i].ev] = this.t;
            }
        }
        let i = 1;
        while (i < K.length - 1 && K[i].t < this.t) i++;
        const a = K[i - 1], b = K[i];
        const k = smooth(Math.min(1, Math.max(0, (this.t - a.t) / Math.max(1e-4, b.t - a.t))));
        const lerp3 = (out, u, v) => out.set(u[0] + (v[0] - u[0]) * k, u[1] + (v[1] - u[1]) * k, u[2] + (v[2] - u[2]) * k);
        this.look = (a.lk || 0) + ((b.lk || 0) - (a.lk || 0)) * k;
        const vm = this.vm;
        lerp3(vm.main.position, a.p, b.p);
        const r0 = a.r, r1 = b.r;
        vm.main.rotation.set(r0[0] + (r1[0] - r0[0]) * k, r0[1] + (r1[1] - r0[1]) * k, r0[2] + (r1[2] - r0[2]) * k);
        if (vm.aux) {
            const ap0 = a.ap || AUX_HIDE.p, ap1 = b.ap || AUX_HIDE.p, ar0 = a.ar || AUX_HIDE.r, ar1 = b.ar || AUX_HIDE.r;
            lerp3(vm.aux.position, ap0, ap1);
            vm.aux.rotation.set(ar0[0] + (ar1[0] - ar0[0]) * k, ar0[1] + (ar1[1] - ar0[1]) * k, ar0[2] + (ar1[2] - ar0[2]) * k);
        }
        this._parts(dt);
        if (this.t >= this.duration) this.done = true;
        return events;
    }

    _since(ev) {
        return this.flags[ev] === undefined ? -1 : this.t - this.flags[ev];
    }

    _parts(dt) {
        const P = this.vm.parts;
        const lit = this._since('flick') >= 0 || this._since('torch') >= 0;
        const inhaling = this._since('inhale') >= 0 && this._since('exhale') < 0 && this._since('exhaleBig') < 0 && this._since('clear') < 0;
        const flame = this.vm.aux && this.vm.aux.userData.flame;
        if (flame) {
            const on = lit && this._since('clear') < 0 && (this._since('dose') < 0 || this.vm.method === 'bulb' || this.vm.method === 'stem');
            const flickOnly = this.vm.method === 'cigarette' || this.vm.method === 'joint';
            flame.visible = flickOnly ? (this._since('flick') >= 0 && this._since('dose') < 0) : on;
            if (flame.visible) flame.scale.set(1, 0.8 + Math.random() * 0.4, 1);
        }
        if (P.ember) P.ember.material.opacity = lit ? (inhaling ? 1 : 0.55) : 0;
        if (P.led) P.led.material.opacity = this._since('inhale') >= 0 && this._since('exhaleBig') < 0 ? 1 : 0.25;
        if (P.bowl) P.bowl.material.opacity = lit && this._since('clear') < 0 ? 0.6 + Math.random() * 0.4 : 0;
        if (P.water) P.water.position.y = this._since('bubble') >= 0 && this._since('dose') < 0 ? -0.1 + Math.sin(this.t * 40) * 0.003 : -0.1;
        if (P.smoke && this.vm.method === 'bong') {
            const filling = this._since('bubble');
            P.smoke.material.opacity = filling >= 0 && this._since('clear') < 0 ? Math.min(0.75, filling * 0.3) : Math.max(0, P.smoke.material.opacity - dt * 3);
        }
        if (P.lines && this._since('snort') >= 0) {
            const k = Math.min(1, this._since('snort') / 0.7);
            P.lines[0].scale.x = Math.max(0.001, 1 - k);
            P.lines[1].scale.x = Math.max(0.001, 1 - Math.max(0, k - 0.3) / 0.7);
        }
        if (P.powder && this._since('snort') > 0.15) P.powder.visible = false;
        if (P.rock) P.rock.material.emissiveIntensity = lit && this._since('clear') < 0 ? 1.5 + Math.random() : 0;
        if (P.smoke && this.vm.method === 'stem') P.smoke.material.opacity = inhaling ? 0.6 : Math.max(0, P.smoke.material.opacity - dt * 2);
        if (P.vapor) {
            const heat = this._since('torch');
            P.vapor.material.opacity = heat >= 0 && this._since('clear') < 0 ? Math.min(0.7, heat * 0.3) : Math.max(0, P.vapor.material.opacity - dt * 2);
            if (P.crystal && heat >= 0) P.crystal.scale.setScalar(Math.max(0.2, 1 - heat * 0.25));
            this.vm.main.rotation.z += heat >= 0 && this._since('clear') < 0 ? Math.sin(this.t * 4) * 0.15 : 0;
        }
        if (P.bead) {
            const run = this._since('inhale');
            if (run >= 0) {
                const k = Math.min(1, run / 2.9);
                P.bead.position.z = 0.03 - k * 0.075;
                P.trail.scale.z = Math.max(0.001, k * 0.075);
                P.trail.position.z = 0.03 - k * 0.0375;
            }
        }
        if (P.plunger && this._since('push') >= 0) {
            const k = Math.min(1, this._since('push') / 1.8);
            P.plunger.position.z = 0.045 - k * 0.042;
            P.liquid.scale.y = Math.max(0.02, 1 - k);
            P.liquid.position.z = -0.008 - k * 0.024;
        }
        if (P.tab && this._since('dose') >= 0) P.tab.visible = false;
        if (P.drank && this._since('sip') >= 0) P.drank.position.y = 0.04 - Math.min(0.02, this._since('sip') * 0.006);
        if (P.drank && this.vm.method === 'shot') P.drank.visible = this._since('dose') < 0.15;
    }
}

// ================================================================================================
// Effects in your system
// ================================================================================================
const SCALAR = ['hueCycle', 'sat', 'contrast', 'bright', 'vignette', 'blur', 'wave', 'breathe', 'chroma', 'ghost', 'trail',
    'kaleido', 'flash', 'grain', 'paranoia', 'sway', 'roll', 'shake', 'fovAdd', 'mouseLag', 'regen', 'muffle', 'heartbeat', 'ring', 'nod',
    'stumble', 'spins', 'drunk'];

/**
 * Alcohol, in units in the blood (a beer is about one). It soaks in over half a minute or so and
 * leaves at ELIM a second. Past VOMIT you throw up; keep drinking after that and you pass out.
 */
export const ALCOHOL = Object.freeze({
    ABSORB: 22,          // seconds for most of a drink to reach the blood
    ELIM: 1 / 75,        // units a second the liver clears
    TIPSY: 1, DRUNK: 2.5, HAMMERED: 4.5, VOMIT: 6.5, PASS_OUT: 7.5,
    HANGOVER: 150        // seconds of hangover after you come round
});
const SCALED = ['moveScale', 'mouseScale', 'damageScale', 'musicRate']; // 1 + sum

function emptyState() {
    const s = { hue: 0, tint: [1, 1, 1], tintAmt: 0, dark: 0, drain: 0, figureX: 0, figureA: 0, overdose: 0, active: false };
    for (const k of SCALAR) s[k] = 0;
    for (const k of SCALED) s[k] = 1;
    return s;
}

export class DrugEffects {
    constructor() {
        this.doses = [];
        this.time = 0;
        this.stomach = 0;           // alcohol drunk but not in the blood yet
        this.bac = 0;               // units in the blood
        this.vomited = false;       // thrown up this session (one more drink and you're out)
        this.hangover = 0;          // seconds left
        this.events = [];           // 'hiccup', 'vomit', 'passout' for the game to act on
        this._hiccupT = 10;
        this._blinkT = 0;
        this.state = emptyState();
        this._hue = 0;
        this._figureT = 5;
        this._lagX = 0;
        this._lagY = 0;
    }

    dose(id) {
        const d = DRUGS[id];
        if (!d) return;
        if (d.alcohol) { this.drink(d.alcohol); return; }
        this.doses.push({ id, t: 0, strength: d.strength || 1 });
    }

    /** A drink goes down. Already sick and still drinking: that's the night over. */
    drink(units) {
        this.stomach += units;
        if (this.vomited && this.bac + this.stomach * 0.5 >= ALCOHOL.HAMMERED) this.events.push('passout');
    }

    /** After passing out: you come round on the pavement, still a little drunk and hungover. */
    wakeUp() {
        this.stomach = 0;
        this.bac = Math.min(this.bac, 1.2);
        this.vomited = false;
        this.hangover = ALCOHOL.HANGOVER;
    }

    clear() {
        this.stomach = this.bac = this.hangover = 0;
        this.vomited = false;
        this.doses.length = 0;
        this.state = emptyState();
        this._lagX = this._lagY = 0;
    }

    /** { main, crash } intensities (0..1) of a dose at its current age. */
    _curve(dose) {
        const d = DRUGS[dose.id];
        const t = dose.t;
        let main;
        if (t < d.onset) main = smooth(t / d.onset);
        else if (t < d.onset + d.peak) main = 1;
        else main = Math.max(0, 1 - (t - d.onset - d.peak) / d.fade);
        let crash = 0;
        if (d.crash) {
            const end = d.onset + d.peak;
            if (t > end) {
                const ct = t - end;
                crash = ct < d.fade ? smooth(ct / d.fade) : Math.max(0, 1 - (ct - d.fade) / d.crash);
            }
        }
        return { main, crash };
    }

    _length(dose) {
        const d = DRUGS[dose.id];
        return d.onset + d.peak + d.fade + (d.crash || 0);
    }

    update(dt) {
        this.time += dt;
        const s = emptyState();
        let tintW = 0;
        const tint = [0, 0, 0];
        let opioid = 0, stim = 0;
        const apply = (fx, k) => {
            if (!fx || k <= 0) return;
            for (const key in fx) {
                if (key === 'tint' || key === 'label') continue;
                const v = fx[key] * k;
                if (key === 'tintAmt') {
                    const c = fx.tint || [1, 1, 1];
                    tint[0] += c[0] * v;
                    tint[1] += c[1] * v;
                    tint[2] += c[2] * v;
                    tintW += v;
                } else {
                    s[key] += v;
                }
            }
        };
        for (let i = this.doses.length - 1; i >= 0; i--) {
            const dose = this.doses[i];
            dose.t += dt;
            if (dose.t > this._length(dose)) {
                this.doses.splice(i, 1);
                continue;
            }
            const d = DRUGS[dose.id];
            const { main, crash } = this._curve(dose);
            const k = main * dose.strength;
            const fx = d.fx;
            // A crack hit is a white-out that fades in a few seconds
            if (fx.flash) s.flash += Math.max(0, 1 - dose.t / 3) * fx.flash;
            apply(Object.assign({}, fx, { flash: 0 }), k);
            apply(d.crashFx, crash * dose.strength);
            if (d.opioid) opioid += d.opioid * k;
            if (d.stim) stim += d.stim * k;
        }
        // ---- Alcohol ----
        const soak = Math.min(this.stomach, this.stomach * dt * 3 / ALCOHOL.ABSORB + dt * 0.01);
        this.stomach -= soak;
        this.bac = Math.max(0, this.bac + soak - ALCOHOL.ELIM * dt);
        const bac = this.bac;
        if (bac > 0.05) {
            const d = Math.min(1, bac / 7);                     // 0 sober .. 1 legless
            const over = (a, b) => Math.max(0, Math.min(1, (bac - a) / (b - a)));
            apply({ sway: 1.4, roll: 1.1, blur: 0.9, vignette: 0.4, tintAmt: 0.18, tint: [1.0, 0.86, 0.66], sat: 0.12,
                mouseLag: 0.45, moveScale: -0.28, mouseScale: -0.15, damageScale: -0.25, muffle: 0.28, musicRate: -0.06,
                stumble: 1, fovAdd: 3 }, d);
            s.ghost += 0.95 * over(ALCOHOL.TIPSY + 0.8, ALCOHOL.HAMMERED + 1);          // double vision
            s.spins += over(ALCOHOL.HAMMERED - 0.5, ALCOHOL.VOMIT + 0.5);                // the room turning
            s.wave += 0.12 * over(ALCOHOL.DRUNK, ALCOHOL.VOMIT);
            // Blackout blinks: the screen drops out for a moment when you're properly gone
            if (bac > ALCOHOL.HAMMERED) {
                this._blinkT -= dt;
                if (this._blinkT <= 0) this._blinkT = 5 + Math.random() * 9 - over(ALCOHOL.HAMMERED, ALCOHOL.PASS_OUT) * 3;
                if (this._blinkT < 0.6) s.dark += Math.sin((this._blinkT / 0.6) * Math.PI) * (0.55 + 0.4 * over(ALCOHOL.HAMMERED, ALCOHOL.PASS_OUT));
            }
            // Hiccups when you're merry
            if (bac > ALCOHOL.TIPSY && bac < ALCOHOL.VOMIT) {
                this._hiccupT -= dt;
                if (this._hiccupT <= 0) { this._hiccupT = 5 + Math.random() * 16; this.events.push('hiccup'); }
            }
            // Too much: it comes back up (once; more drink after that puts you on the floor)
            if (bac >= ALCOHOL.VOMIT && !this.vomited) {
                this.vomited = true;
                this.stomach = 0;
                this.bac -= 0.6;
                this.events.push('vomit');
            } else if (bac >= ALCOHOL.PASS_OUT + 1) this.events.push('passout');
            s.drunk = bac;
        }
        if (bac < ALCOHOL.DRUNK && this.vomited && this.stomach < 0.5) this.vomited = false;
        if (this.hangover > 0) {
            this.hangover = Math.max(0, this.hangover - dt);
            const h = Math.min(1, this.hangover / 40);
            apply({ sat: -0.35, bright: -0.06, blur: 0.45, vignette: 0.35, moveScale: -0.15, heartbeat: 0.3, sway: 0.25 }, h);
        }

        s.active = this.doses.length > 0 || bac > 0.05 || this.hangover > 0;
        if (tintW > 0) {
            s.tint = [tint[0] / tintW, tint[1] / tintW, tint[2] / tintW];
            s.tintAmt = Math.min(0.6, tintW);
        }

        // Nodding off: the screen sags to black now and then
        if (s.nod > 0) s.dark += Math.min(0.85, s.nod * 0.85) * Math.pow(Math.max(0, Math.sin(this.time * 0.45)), 14);

        // Overdose: too much opioid (breathing slows, the world goes dark) or too much stimulant
        // (heart racing out of control). Both drain health while they last.
        const odOpioid = Math.max(0, Math.min(1, (opioid - 1.15) / 0.5));
        const odStim = Math.max(0, Math.min(1, (stim - 1.4) / 0.6));
        s.overdose = Math.max(odOpioid, odStim);
        if (odOpioid > 0) {
            s.dark += 0.6 * odOpioid;
            s.drain += 7 * odOpioid;
            s.moveScale -= 0.5 * odOpioid;
            s.blur += 1.5 * odOpioid;
        }
        if (odStim > 0) {
            s.drain += 5 * odStim;
            s.heartbeat += 1.5 * odStim;
            s.shake += odStim;
            s.chroma += 0.5 * odStim;
        }

        // Paranoia: a shadowy figure at the edge of your eye, gone when you look
        if (s.paranoia > 0) {
            this._figureT -= dt;
            if (this._figureT <= 0) {
                this._figureT = 6 + Math.random() * 10;
                this._figure = { x: Math.random() < 0.5 ? 0.06 + Math.random() * 0.1 : 0.84 + Math.random() * 0.1, t: 0 };
            }
            if (this._figure) {
                this._figure.t += dt;
                const ft = this._figure.t;
                s.figureX = this._figure.x;
                s.figureA = Math.min(1, s.paranoia) * (ft < 1.2 ? ft / 1.2 : Math.max(0, 1 - (ft - 1.2) / 0.5)) * 0.85;
                if (ft > 1.7) this._figure = null;
            }
        }

        // Hue drifts round the colour wheel on psychedelics
        this._hue += dt * s.hueCycle * 0.7;
        s.hue = this._hue;

        // Clamp the gameplay channels
        s.moveScale = Math.max(0.3, Math.min(1.6, s.moveScale));
        s.mouseScale = Math.max(0.35, Math.min(1.6, s.mouseScale));
        s.damageScale = Math.max(0.3, Math.min(1.2, s.damageScale));
        // The speed of every sound (soundRate.js). Only heroin and crack drag it below 75%
        const dragsSound = this.doses.some((d) => d.id === 'heroin' || d.id === 'crack');
        s.musicRate = Math.max(dragsSound ? 0.4 : 0.75, Math.min(1.2, s.musicRate));
        s.mouseLag = Math.min(0.92, s.mouseLag);
        s.flash = Math.min(1, s.flash);
        s.dark = Math.min(0.97, s.dark);
        this.state = s;
        return s;
    }

    /** Mouse movement through the drugs: slower or faster, and laggy on ketamine. */
    filterMouse(dx, dy) {
        const s = this.state;
        dx *= s.mouseScale;
        dy *= s.mouseScale;
        if (s.mouseLag > 0) {
            this._lagX += dx * s.mouseLag;
            this._lagY += dy * s.mouseLag;
            dx *= 1 - s.mouseLag;
            dy *= 1 - s.mouseLag;
        }
        return [dx, dy];
    }

    /** Lagged mouse movement catching up this frame. */
    takeLaggedMouse(dt) {
        const k = Math.min(1, dt * 2.2);
        const x = this._lagX * k, y = this._lagY * k;
        this._lagX -= x;
        this._lagY -= y;
        return [x, y];
    }

    /** Involuntary drift of where you're looking (yaw, pitch), radians this frame. */
    aimDrift(dt) {
        const s = this.state;
        const t = this.time;
        const sway = s.sway * 0.06;
        const shake = s.shake * 0.004;
        // The spins: the room keeps slowly turning one way, then the other
        const spin = s.spins * 0.22 * Math.sin(t * 0.12) * dt;
        return [
            (Math.sin(t * 0.7) * 0.6 + Math.sin(t * 1.9) * 0.4) * sway * dt + (Math.random() - 0.5) * shake + spin,
            (Math.sin(t * 0.53 + 1) * 0.5 + Math.sin(t * 1.3) * 0.3) * sway * 0.6 * dt + (Math.random() - 0.5) * shake
        ];
    }

    /**
     * Drunk walking: a sideways lurch (metres a second, along your right) that wanders, with the
     * odd bigger stagger.
     */
    stumble() {
        const s = this.state;
        if (!(s.stumble > 0)) return 0;
        const t = this.time;
        const wander = Math.sin(t * 0.9) * 0.6 + Math.sin(t * 2.3 + 1) * 0.4;
        const stagger = Math.max(0, Math.sin(t * 0.37)) ** 16 * Math.sign(Math.sin(t * 0.11));
        return (wander * 0.9 + stagger * 2.2) * s.stumble;
    }

    /** Camera roll / jitter at render time (visual only), radians. */
    cameraOffsets() {
        const s = this.state;
        const t = this.time;
        return {
            roll: Math.sin(t * 0.6) * 0.05 * s.roll + Math.sin(t * 0.37) * 0.02 * s.sway + (Math.random() - 0.5) * 0.004 * s.shake,
            pitch: (Math.random() - 0.5) * 0.004 * s.shake
        };
    }

    /** Degrees added to the field of view (tunnel vision, a K-hole's stretch, breathing). */
    fovOffset() {
        const s = this.state;
        return s.fovAdd + Math.sin(this.time * 0.8) * s.breathe * 4;
    }

    /**
     * How out of it you look to other people: { drunk, high } each 0..1 (drunk 1 = hammered,
     * high = the strongest drug you're on; tobacco doesn't count), and `od` while overdosing.
     */
    intoxication() {
        let high = 0;
        for (const dose of this.doses) {
            if (dose.id === 'cigarettes' || dose.id === 'vape') continue;
            const { main, crash } = this._curve(dose);
            high = Math.max(high, main, crash * 0.6);
        }
        const drunk = Math.min(1, Math.max(0, this.bac / ALCOHOL.HAMMERED));
        return { drunk, high: Math.min(1, high), od: this.state.overdose || 0 };
    }

    /** What's in your system for the HUD: [{ name, label, phase, left }] */
    summary() {
        const out = [];
        for (const dose of this.doses) {
            const d = DRUGS[dose.id];
            const { main, crash } = this._curve(dose);
            let phase;
            if (dose.t < d.onset) phase = 'coming up';
            else if (dose.t < d.onset + d.peak) phase = d.fx.label;
            else if (crash > main) phase = (d.crashFx && d.crashFx.label) || 'coming down';
            else phase = 'coming down';
            out.push({ id: dose.id, name: d.name, phase, left: Math.max(0, this._length(dose) - dose.t), level: Math.max(main, crash) });
        }
        const bac = this.bac + this.stomach * 0.7;
        if (bac > 0.1) {
            const A = ALCOHOL;
            const phase = this.bac >= A.VOMIT || (this.vomited && bac > A.DRUNK) ? 'Wasted' : this.bac >= A.HAMMERED ? 'Hammered' : this.bac >= A.DRUNK ? 'Drunk' : this.bac >= A.TIPSY ? 'Tipsy' : 'Buzzed';
            out.push({ id: 'alcohol', name: `Alcohol (${this.bac.toFixed(1)} units)`, phase, left: this.bac / A.ELIM, level: Math.min(1, this.bac / 7) });
        }
        if (this.hangover > 0) out.push({ id: 'hangover', name: 'Hangover', phase: 'head pounding', left: this.hangover, level: Math.min(1, this.hangover / 40) });
        if (this.state.overdose > 0) out.unshift({ id: 'od', name: 'OVERDOSE', phase: 'get help', left: 0, level: this.state.overdose });
        return out;
    }
}

// ================================================================================================
// Sounds (procedural): lighter, torch, inhale, exhale, cough, bubbling, snort, sips, chewing; and
// the body's own: heartbeat on stimulants, ringing on ketamine, whispers when paranoid
// ================================================================================================
export class DrugAudio {
    constructor() {
        this.ctx = null;
        this.out = null;
        this._noise = null;
        this._beatT = 0;
        this._whisperT = 4;
        this._ring = null;
    }

    setContext(ctx) {
        if (this.ctx || !ctx) return;
        this.ctx = ctx;
        this.out = ctx.createGain();
        this.out.gain.value = 0.9;
        this.out.connect(ctx.destination);
        const len = ctx.sampleRate * 2;
        this._noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const ch = this._noise.getChannelData(0);
        let b = 0;
        for (let i = 0; i < len; i++) {
            b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); // soft (brownish) noise
            ch[i] = b * 6;
        }
    }

    _ok() {
        return this.ctx && this.ctx.state === 'running';
    }

    _noiseBurst(t, dur, f0, f1, gain, q = 0.8, type = 'bandpass') {
        const c = this.ctx;
        const src = c.createBufferSource();
        src.buffer = this._noise;
        src.loop = true;
        const f = c.createBiquadFilter();
        f.type = type;
        f.Q.value = q;
        f.frequency.setValueAtTime(f0, t);
        f.frequency.linearRampToValueAtTime(f1, t + dur);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(gain, t + Math.min(0.15, dur * 0.3));
        g.gain.setValueAtTime(gain, t + dur * 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f);
        f.connect(g);
        g.connect(this.out);
        src.start(t, Math.random());
        src.stop(t + dur + 0.05);
    }

    _tone(t, freq, dur, gain, type = 'sine', toFreq = null) {
        const c = this.ctx;
        const o = c.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
        const g = c.createGain();
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g);
        g.connect(this.out);
        o.start(t);
        o.stop(t + dur + 0.02);
    }

    play(ev) {
        if (!this._ok()) return;
        const t = this.ctx.currentTime;
        switch (ev) {
            case 'flick':
                this._noiseBurst(t, 0.06, 3000, 2000, 0.5, 2);
                this._noiseBurst(t + 0.05, 0.5, 900, 700, 0.12, 0.6);
                break;
            case 'torch':
                this._noiseBurst(t, 0.05, 3500, 3000, 0.4, 2);
                this._noiseBurst(t + 0.04, 2.5, 1600, 1500, 0.1, 0.5);
                break;
            case 'inhale':
                this._noiseBurst(t, 1.3, 600, 1400, 0.16, 0.7);
                break;
            case 'exhale':
                this._noiseBurst(t, 1.2, 900, 400, 0.14, 0.6);
                break;
            case 'exhaleBig':
                this._noiseBurst(t, 1.8, 1000, 350, 0.2, 0.5);
                break;
            case 'cough':
                for (let i = 0; i < 4; i++) {
                    this._noiseBurst(t + i * 0.32 + Math.random() * 0.08, 0.22, 500, 300, 0.45, 1.2);
                    this._tone(t + i * 0.32, 160, 0.16, 0.08, 'sawtooth', 110);
                }
                break;
            case 'bubble':
                for (let i = 0; i < 26; i++) this._tone(t + i * 0.09 + Math.random() * 0.05, 120 + Math.random() * 160, 0.07, 0.12, 'sine', 300 + Math.random() * 200);
                break;
            case 'snort':
                this._noiseBurst(t, 0.55, 2500, 4000, 0.3, 1.5, 'highpass');
                break;
            case 'sniff':
                this._noiseBurst(t, 0.18, 3000, 3500, 0.2, 1.5, 'highpass');
                this._noiseBurst(t + 0.25, 0.15, 3000, 3500, 0.15, 1.5, 'highpass');
                break;
            case 'sip':
                this._noiseBurst(t, 0.45, 1200, 2200, 0.12, 3);
                this._tone(t + 0.4, 220, 0.12, 0.05, 'sine', 160);
                break;
            case 'ahh':
                this._tone(t, 180, 0.6, 0.06, 'triangle', 130);
                break;
            case 'chew':
                for (let i = 0; i < 7; i++) this._noiseBurst(t + i * 0.28, 0.08, 1500, 1200, 0.18, 2);
                break;
            case 'gulp':
                this._tone(t, 160, 0.14, 0.09, 'sine', 90);
                this._noiseBurst(t + 0.05, 0.12, 700, 400, 0.1, 2);
                this._noiseBurst(t + 0.35, 0.5, 1800, 900, 0.08, 1);     // the burn: a rasp out
                break;
            case 'hiccup':
                this._tone(t, 420, 0.07, 0.12, 'triangle', 260);
                this._noiseBurst(t, 0.06, 1400, 900, 0.12, 2);
                break;
            case 'retch':
                // Heaves, then it comes up
                for (let i = 0; i < 3; i++) this._tone(t + i * 0.55, 120, 0.35, 0.12, 'sawtooth', 70);
                this._noiseBurst(t + 1.7, 1.4, 500, 250, 0.35, 0.6, 'lowpass');
                this._noiseBurst(t + 3.3, 0.8, 600, 300, 0.25, 0.6, 'lowpass');
                break;
            case 'pierce':
                this._tone(t, 1800, 0.05, 0.03, 'triangle');
                break;
            case 'sigh':
                this._noiseBurst(t, 1.6, 700, 300, 0.12, 0.5);
                break;
            default:
                break;
        }
    }

    /** Continuous body sounds from the effect state. */
    update(dt, s) {
        if (!this._ok()) return;
        const t = this.ctx.currentTime;
        // Heartbeat: lub-dub, faster and louder the more wired you are
        if (s.heartbeat > 0.05) {
            this._beatT -= dt;
            if (this._beatT <= 0) {
                const bpm = 70 + 70 * Math.min(1.5, s.heartbeat);
                this._beatT = 60 / bpm;
                const g = Math.min(0.5, 0.18 + 0.2 * s.heartbeat);
                this._tone(t, 62, 0.14, g, 'sine', 40);
                this._tone(t + 0.16, 55, 0.12, g * 0.7, 'sine', 38);
            }
        }
        // Ringing ears in a K-hole
        if (s.ring > 0.05 && !this._ring) {
            const o = this.ctx.createOscillator();
            o.frequency.value = 5200;
            const g = this.ctx.createGain();
            g.gain.value = 0;
            o.connect(g);
            g.connect(this.out);
            o.start();
            this._ring = { o, g };
        }
        if (this._ring) {
            this._ring.g.gain.setTargetAtTime(Math.min(0.02, s.ring * 0.025), t, 0.5);
            if (s.ring <= 0.01) {
                this._ring.o.stop(t + 1);
                this._ring = null;
            }
        }
        // Whispers when paranoid
        if (s.paranoia > 0.3) {
            this._whisperT -= dt;
            if (this._whisperT <= 0) {
                this._whisperT = 5 + Math.random() * 9;
                for (let i = 0; i < 5; i++) this._noiseBurst(t + i * 0.18, 0.15, 3000 + Math.random() * 2000, 2500, 0.05 * s.paranoia, 4);
            }
        }
    }
}

export function drugDef(id) {
    return getItemDef(id);
}
