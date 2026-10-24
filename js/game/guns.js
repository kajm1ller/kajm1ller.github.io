/**
 * js/game/guns.js
 *
 * The gun arsenal for Kaj Simulator: 30 guns and their ammunition, registered as items
 * (items.js), with:
 * - stats: damage, rate of fire, magazine, ammo type, reload, spread, range, recoil, fire mode
 *   (semi, auto, burst, pump / bolt action, minigun spin-up), pellets, scopes, explosives
 * - procedural 3D models (one builder, a blueprint per gun) used both in the player's hands and
 *   lying in the world as pickups
 * - side-profile icons for the hotbar, drawn from the same blueprints
 * - sound: each gun picks a recorded shot from /media and plays it pitched and layered with a
 *   synthesized body (deep boom for big calibres, sharp crack for rifles, a muffled pfft when
 *   suppressed); reload, dry-fire and bolt sounds are synthesized
 *
 * Gun local space: -Z is the muzzle direction, +Y up, origin at the grip where the hand holds it.
 */

import * as THREE from 'three';
import { registerItem, getItemDef, allItemDefs } from './items.js';

// ================================================================================================
// Ammunition
// ================================================================================================

export const AMMO = Object.freeze({
    '9mm': { name: '9mm', maxStack: 300, color: '#d9b45a' },
    '45acp': { name: '.45 ACP', maxStack: 250, color: '#c99a3c' },
    '50ae': { name: '.50 AE', maxStack: 100, color: '#e0c060' },
    '357': { name: '.357 Magnum', maxStack: 120, color: '#cfa64a' },
    '57mm': { name: '5.7mm', maxStack: 300, color: '#b8b8b8' },
    '556': { name: '5.56mm', maxStack: 360, color: '#c8a050' },
    '762': { name: '7.62mm', maxStack: 400, color: '#b88a3a' },
    '12ga': { name: '12 Gauge', maxStack: 100, color: '#c0392b' },
    '3006': { name: '.30-06', maxStack: 80, color: '#d4a84a' },
    '338': { name: '.338 Lapua', maxStack: 60, color: '#a8a8a8' },
    '50bmg': { name: '.50 BMG', maxStack: 60, color: '#8d8d8d' },
    rocket: { name: 'Rocket', maxStack: 10, color: '#5a6b3b' },
    '40mm': { name: '40mm Grenade', maxStack: 24, color: '#6b7b3b' }
});

for (const [id, a] of Object.entries(AMMO)) {
    registerItem({ id: `ammo_${id}`, name: `${a.name} Ammo`, kind: 'ammo', ammoType: id, stackable: true, maxStack: a.maxStack, hotbar: false, iconColor: a.color });
}

// ================================================================================================
// Guns
// ================================================================================================

/**
 * Gun fields (old weapon fields kept so the rest of the game reads them unchanged):
 * name, type: 'gun', damage (per pellet), fireRate (ms between shots), range (m), spread, pellets,
 * projectileSpeed (tracer m per 60 Hz frame), automatic, explosive, sound (recorded shot path)
 * plus: category, mode ('semi'|'auto'|'burst'|'pump'|'bolt'|'spin'), burst, magSize, ammo,
 * reloadTime (s), reloadOne (s per round for shell-by-shell reloads), recoil (rad), adsZoom,
 * scope, suppressed, blastRadius, gravity, spinUp (s), voice (sound character), model (blueprint).
 */
const S = {
    pistol: '/media/mp3/pistol_fire3.mp3',
    smg: '/media/hl2-smg-shot.mp3',
    shotgun: '/media/mp3/shotgun.mp3',
    rifle: '/media/mp3/Gunshot Sound Effect Single Shot.mp3',
    gun: '/media/mp3/gun.mp3',
    boom: '/media/explosion-meme_dTCfAHs.mp3'
};

// Finishes: main body, accent (grips, furniture), metal (barrel / slide)
const FINISH = {
    black: [0x1d1e20, 0x2b2c2f, 0x3a3c40],
    polymer: [0x232427, 0x1a1b1d, 0x4a4d52],
    tan: [0xb59a6c, 0x2b2b2b, 0x3a3c40],
    od: [0x4b5232, 0x2b2b2b, 0x3a3c40],
    wood: [0x2a2b2e, 0x6b3f1d, 0x3d3f43],
    blued: [0x22262e, 0x5a3418, 0x2c3038],
    chrome: [0xb9bcc0, 0x1f1f1f, 0xd0d3d6],
    gold: [0xc9a43a, 0x1f1f1f, 0xd8b44a],
    stainless: [0x9ea2a6, 0x24201c, 0xb4b8bc],
    green: [0x3b4d2b, 0x4a2f18, 0x4a5d3b]
};

const GUN_LIST = [
    // ---------------- Pistols ----------------
    { id: 'pistol', name: 'Pistol', category: 'Pistol', ammo: '9mm', damage: 100, fireRate: 350, magSize: 17, reloadTime: 1.3, spread: 0.015, range: 120, projectileSpeed: 2.2, recoil: 0.035, mode: 'semi', sound: S.pistol, voice: { rate: 1.0, gain: 0.6, body: 'pistol' },
        model: { family: 'pistol', len: 0.19, h: 0.035, finish: 'polymer' } },
    { id: 'm1911', name: 'M1911', category: 'Pistol', ammo: '45acp', damage: 110, fireRate: 300, magSize: 7, reloadTime: 1.4, spread: 0.014, range: 110, projectileSpeed: 2.2, recoil: 0.045, mode: 'semi', sound: S.pistol, voice: { rate: 0.88, gain: 0.65, body: 'pistol' },
        model: { family: 'pistol', len: 0.21, h: 0.033, finish: 'blued', woodGrip: true } },
    { id: 'deagle', name: 'Desert Eagle', category: 'Pistol', ammo: '50ae', damage: 190, fireRate: 450, magSize: 7, reloadTime: 1.6, spread: 0.012, range: 140, projectileSpeed: 2.6, recoil: 0.09, mode: 'semi', sound: S.gun, voice: { rate: 0.7, gain: 0.8, body: 'boom' },
        model: { family: 'pistol', len: 0.26, h: 0.045, finish: 'gold', triangular: true } },
    { id: 'revolver', name: '.357 Revolver', category: 'Pistol', ammo: '357', damage: 170, fireRate: 420, magSize: 6, reloadTime: 2.2, spread: 0.01, range: 130, projectileSpeed: 2.5, recoil: 0.08, mode: 'semi', sound: S.gun, voice: { rate: 0.82, gain: 0.75, body: 'boom' },
        model: { family: 'revolver', len: 0.24, finish: 'stainless' } },
    { id: 'autopistol', name: 'Auto Pistol', category: 'Pistol', ammo: '9mm', damage: 45, fireRate: 55, magSize: 20, reloadTime: 1.4, spread: 0.05, range: 90, projectileSpeed: 2.2, recoil: 0.02, mode: 'auto', sound: S.pistol, voice: { rate: 1.15, gain: 0.5, body: 'pistol' },
        model: { family: 'pistol', len: 0.19, h: 0.035, finish: 'polymer', extMag: true, selector: true } },
    { id: 'silenced', name: 'Silenced Pistol', category: 'Pistol', ammo: '9mm', damage: 90, fireRate: 320, magSize: 15, reloadTime: 1.3, spread: 0.015, range: 110, projectileSpeed: 2.2, recoil: 0.025, mode: 'semi', suppressed: true, sound: S.pistol, voice: { rate: 1.3, gain: 0.25, body: 'suppressed' },
        model: { family: 'pistol', len: 0.2, h: 0.034, finish: 'black', suppressor: 0.14 } },

    // ---------------- SMGs ----------------
    { id: 'mp5', name: 'MP5', category: 'SMG', ammo: '9mm', damage: 55, fireRate: 75, magSize: 30, reloadTime: 1.8, spread: 0.028, range: 120, projectileSpeed: 2.4, recoil: 0.018, mode: 'auto', sound: S.smg, voice: { rate: 1.05, gain: 0.5, body: 'smg' },
        model: { family: 'smg', len: 0.3, finish: 'black', mag: 'curved', stock: 'fixed', barrel: 0.06, handguard: 0.12 } },
    { id: 'uzi', name: 'Uzi', category: 'SMG', ammo: '9mm', damage: 50, fireRate: 60, magSize: 32, reloadTime: 1.7, spread: 0.04, range: 100, projectileSpeed: 2.3, recoil: 0.02, mode: 'auto', sound: S.smg, voice: { rate: 1.15, gain: 0.5, body: 'smg' },
        model: { family: 'smg', len: 0.26, finish: 'blued', mag: 'grip', stock: 'folding', barrel: 0.05, boxy: true } },
    { id: 'mac10', name: 'MAC-10', category: 'SMG', ammo: '45acp', damage: 55, fireRate: 50, magSize: 30, reloadTime: 1.6, spread: 0.06, range: 80, projectileSpeed: 2.2, recoil: 0.025, mode: 'auto', sound: S.smg, voice: { rate: 1.25, gain: 0.5, body: 'smg' },
        model: { family: 'smg', len: 0.2, finish: 'black', mag: 'grip', stock: 'none', barrel: 0.04, boxy: true, suppressor: 0 } },
    { id: 'p90', name: 'P90', category: 'SMG', ammo: '57mm', damage: 50, fireRate: 67, magSize: 50, reloadTime: 2.2, spread: 0.025, range: 130, projectileSpeed: 2.6, recoil: 0.014, mode: 'auto', sound: S.smg, voice: { rate: 1.2, gain: 0.48, body: 'smg' },
        model: { family: 'bullpup', len: 0.36, finish: 'tan', mag: 'top', sight: 'reddot' } },
    { id: 'vector', name: 'Vector', category: 'SMG', ammo: '45acp', damage: 52, fireRate: 50, magSize: 25, reloadTime: 1.9, spread: 0.022, range: 110, projectileSpeed: 2.3, recoil: 0.012, mode: 'auto', sound: S.smg, voice: { rate: 1.1, gain: 0.5, body: 'smg' },
        model: { family: 'smg', len: 0.32, finish: 'black', mag: 'box', stock: 'skeleton', barrel: 0.07, sight: 'reddot', angular: true } },

    // ---------------- Rifles ----------------
    { id: 'rifle', name: 'Rifle', category: 'Rifle', ammo: '556', damage: 80, fireRate: 85, magSize: 30, reloadTime: 2.0, spread: 0.012, range: 220, projectileSpeed: 3.0, recoil: 0.02, mode: 'auto', automatic: true, sound: S.smg, voice: { rate: 0.95, gain: 0.55, body: 'rifle' },
        model: { family: 'rifle', len: 0.42, finish: 'black', mag: 'box', stock: 'fixed', barrel: 0.16, handguard: 0.22, sight: 'reddot', carry: false } },
    { id: 'ak47', name: 'AK-47', category: 'Rifle', ammo: '762', damage: 95, fireRate: 100, magSize: 30, reloadTime: 2.3, spread: 0.02, range: 220, projectileSpeed: 3.0, recoil: 0.03, mode: 'auto', sound: S.rifle, voice: { rate: 0.9, gain: 0.6, body: 'rifle' },
        model: { family: 'rifle', len: 0.44, finish: 'wood', mag: 'curved', stock: 'wood', barrel: 0.2, handguard: 0.18, woodGuard: true } },
    { id: 'scar', name: 'SCAR-H', category: 'Rifle', ammo: '762', damage: 100, fireRate: 100, magSize: 20, reloadTime: 2.3, spread: 0.014, range: 240, projectileSpeed: 3.1, recoil: 0.032, mode: 'auto', sound: S.rifle, voice: { rate: 0.85, gain: 0.62, body: 'rifle' },
        model: { family: 'rifle', len: 0.45, finish: 'tan', mag: 'box', stock: 'folding', barrel: 0.17, handguard: 0.24, sight: 'reddot' } },
    { id: 'famas', name: 'FAMAS', category: 'Rifle', ammo: '556', damage: 72, fireRate: 60, burst: 3, burstDelay: 330, magSize: 25, reloadTime: 2.1, spread: 0.012, range: 210, projectileSpeed: 3.0, recoil: 0.018, mode: 'burst', sound: S.rifle, voice: { rate: 1.05, gain: 0.55, body: 'rifle' },
        model: { family: 'bullpup', len: 0.46, finish: 'black', mag: 'box', carry: true } },
    { id: 'g36', name: 'G36C', category: 'Rifle', ammo: '556', damage: 74, fireRate: 80, magSize: 30, reloadTime: 2.0, spread: 0.016, range: 200, projectileSpeed: 3.0, recoil: 0.018, mode: 'auto', sound: S.smg, voice: { rate: 0.98, gain: 0.55, body: 'rifle' },
        model: { family: 'rifle', len: 0.38, finish: 'od', mag: 'box', stock: 'skeleton', barrel: 0.1, handguard: 0.16, carry: true } },
    { id: 'm16', name: 'M16A4', category: 'Rifle', ammo: '556', damage: 82, fireRate: 70, burst: 3, burstDelay: 300, magSize: 30, reloadTime: 2.1, spread: 0.009, range: 260, projectileSpeed: 3.2, recoil: 0.02, mode: 'burst', sound: S.rifle, voice: { rate: 1.0, gain: 0.58, body: 'rifle' },
        model: { family: 'rifle', len: 0.48, finish: 'black', mag: 'box', stock: 'fixed', barrel: 0.24, handguard: 0.22, carry: true } },
    { id: 'tommy', name: 'Tommy Gun', category: 'Rifle', ammo: '45acp', damage: 62, fireRate: 80, magSize: 50, reloadTime: 3.0, spread: 0.035, range: 120, projectileSpeed: 2.3, recoil: 0.022, mode: 'auto', sound: S.smg, voice: { rate: 0.8, gain: 0.6, body: 'smg' },
        model: { family: 'rifle', len: 0.4, finish: 'blued', mag: 'drum', stock: 'wood', barrel: 0.14, handguard: 0.08, woodGuard: true, foregrip: true, fins: true } },

    // ---------------- Shotguns ----------------
    { id: 'shotgun', name: 'Shotgun', category: 'Shotgun', ammo: '12ga', damage: 45, pellets: 8, fireRate: 750, magSize: 8, reloadOne: 0.45, spread: 0.07, range: 70, projectileSpeed: 2.5, recoil: 0.09, mode: 'pump', sound: S.shotgun, voice: { rate: 1.0, gain: 0.65, body: 'shotgun' },
        model: { family: 'shotgun', len: 0.34, finish: 'wood', barrel: 0.3, tube: true, pump: true, stock: 'wood' } },
    { id: 'doublebarrel', name: 'Double Barrel', category: 'Shotgun', ammo: '12ga', damage: 45, pellets: 9, fireRate: 180, magSize: 2, reloadTime: 1.8, spread: 0.09, range: 60, projectileSpeed: 2.5, recoil: 0.12, mode: 'semi', sound: S.shotgun, voice: { rate: 0.9, gain: 0.7, body: 'shotgun' },
        model: { family: 'shotgun', len: 0.26, finish: 'wood', barrel: 0.4, double: true, stock: 'wood' } },
    { id: 'aa12', name: 'Auto Shotgun', category: 'Shotgun', ammo: '12ga', damage: 32, pellets: 7, fireRate: 200, magSize: 20, reloadTime: 3.0, spread: 0.085, range: 60, projectileSpeed: 2.5, recoil: 0.07, mode: 'auto', sound: S.shotgun, voice: { rate: 1.1, gain: 0.62, body: 'shotgun' },
        model: { family: 'rifle', len: 0.42, finish: 'black', mag: 'drum', stock: 'fixed', barrel: 0.14, handguard: 0.2, carry: true, fat: true } },
    { id: 'sawedoff', name: 'Sawed-Off', category: 'Shotgun', ammo: '12ga', damage: 40, pellets: 10, fireRate: 150, magSize: 2, reloadTime: 1.6, spread: 0.16, range: 35, projectileSpeed: 2.4, recoil: 0.15, mode: 'semi', sound: S.shotgun, voice: { rate: 0.85, gain: 0.75, body: 'shotgun' },
        model: { family: 'shotgun', len: 0.2, finish: 'blued', barrel: 0.18, double: true, stock: 'pistol' } },

    // ---------------- Marksman & sniper ----------------
    { id: 'hunting', name: 'Hunting Rifle', category: 'Sniper', ammo: '3006', damage: 160, fireRate: 1100, magSize: 5, reloadOne: 0.5, spread: 0.003, range: 400, projectileSpeed: 4.5, recoil: 0.1, mode: 'bolt', adsZoom: 3, scope: true, sound: S.rifle, voice: { rate: 0.8, gain: 0.7, body: 'crack' },
        model: { family: 'sniper', len: 0.36, finish: 'wood', barrel: 0.36, stock: 'wood', sight: 'scope', bolt: true } },
    { id: 'sniper', name: 'Sniper Rifle', category: 'Sniper', ammo: '338', damage: 250, fireRate: 1400, magSize: 5, reloadTime: 2.8, spread: 0.001, range: 600, projectileSpeed: 6.0, recoil: 0.14, mode: 'bolt', adsZoom: 6, scope: true, sound: S.rifle, voice: { rate: 0.7, gain: 0.8, body: 'crack' },
        model: { family: 'sniper', len: 0.42, finish: 'od', barrel: 0.42, stock: 'skeleton', sight: 'bigscope', bolt: true, bipod: true, brake: true } },
    { id: 'barrett', name: 'Barrett .50', category: 'Sniper', ammo: '50bmg', damage: 400, fireRate: 600, magSize: 10, reloadTime: 3.2, spread: 0.002, range: 700, projectileSpeed: 6.5, recoil: 0.22, mode: 'semi', adsZoom: 5, scope: true, sound: S.gun, voice: { rate: 0.55, gain: 0.9, body: 'boom' },
        model: { family: 'sniper', len: 0.5, finish: 'black', barrel: 0.48, stock: 'fixed', sight: 'bigscope', mag: 'box', bipod: true, brake: true, fat: true } },
    { id: 'dmr', name: 'Marksman Rifle', category: 'Sniper', ammo: '762', damage: 120, fireRate: 250, magSize: 10, reloadTime: 2.4, spread: 0.004, range: 400, projectileSpeed: 4.0, recoil: 0.05, mode: 'semi', adsZoom: 3, scope: true, sound: S.rifle, voice: { rate: 0.88, gain: 0.65, body: 'crack' },
        model: { family: 'rifle', len: 0.46, finish: 'tan', mag: 'box', stock: 'fixed', barrel: 0.26, handguard: 0.26, sight: 'scope' } },

    // ---------------- Heavy ----------------
    { id: 'minigun', name: 'Minigun', category: 'Heavy', ammo: '762', damage: 55, fireRate: 25, magSize: 200, reloadTime: 5.0, spread: 0.04, range: 220, projectileSpeed: 3.0, recoil: 0.012, mode: 'spin', spinUp: 0.6, sound: S.smg, voice: { rate: 1.35, gain: 0.45, body: 'rifle' },
        model: { family: 'minigun', len: 0.55, finish: 'black' } },
    { id: 'lmg', name: 'M249 SAW', category: 'Heavy', ammo: '556', damage: 72, fireRate: 70, magSize: 100, reloadTime: 4.5, spread: 0.03, range: 220, projectileSpeed: 3.0, recoil: 0.02, mode: 'auto', sound: S.rifle, voice: { rate: 1.05, gain: 0.58, body: 'rifle' },
        model: { family: 'rifle', len: 0.5, finish: 'od', mag: 'boxbelt', stock: 'fixed', barrel: 0.24, handguard: 0.16, carry: true, bipod: true, fat: true } },
    { id: 'rpg', name: 'RPG', category: 'Heavy', ammo: 'rocket', damage: 250, fireRate: 1600, magSize: 1, reloadTime: 2.5, spread: 0, range: 300, projectileSpeed: 1.2, recoil: 0.1, mode: 'semi', explosive: true, blastRadius: 6, sound: S.boom, voice: { rate: 1.0, gain: 0.6, body: 'launch' },
        model: { family: 'launcher', len: 0.6, finish: 'green' } },
    { id: 'gl', name: 'Grenade Launcher', category: 'Heavy', ammo: '40mm', damage: 200, fireRate: 700, magSize: 6, reloadOne: 0.6, spread: 0.004, range: 200, projectileSpeed: 1.0, recoil: 0.09, mode: 'semi', explosive: true, blastRadius: 5, gravity: 0.011, sound: S.boom, voice: { rate: 1.0, gain: 0.5, body: 'thunk' },
        model: { family: 'grenadelauncher', len: 0.4, finish: 'od' } }
];

export const GUNS = {};
for (const g of GUN_LIST) {
    const def = Object.assign({
        kind: 'gun',
        type: 'gun',
        pellets: 1,
        burst: 1,
        burstDelay: 0,
        reloadTime: 0,
        reloadOne: 0,
        adsZoom: g.category === 'Pistol' ? 1.15 : 1.35,
        stackable: false,
        hotbar: true
    }, g);
    def.automatic = def.mode === 'auto' || def.mode === 'spin';
    def.ammoItem = `ammo_${def.ammo}`;
    def.createData = () => ({ mag: def.magSize, chambered: true });
    GUNS[def.id] = registerItem(def);
}
export const GUN_IDS = Object.freeze(GUN_LIST.map((g) => g.id));

// Non-gun held items
registerItem({ id: 'hands', name: 'Hands', kind: 'hands', type: 'hands', damage: 0, fireRate: 350, range: 1.5, spread: 0, projectileSpeed: 0, sound: null, droppable: false });
registerItem({ id: 'spraycan', name: 'Spray Can', kind: 'tool', type: 'spray', damage: 0, fireRate: 50, range: 20, spread: 0, projectileSpeed: 0, sound: null });

export function getGun(id) {
    return GUNS[id] || null;
}

/** Every held weapon definition: hands, spray can and the 30 guns. */
export function allWeaponDefs() {
    return [getItemDef('hands'), getItemDef('spraycan'), ...GUN_IDS.map((id) => GUNS[id])];
}

/** Rounds a full reload from empty would load (ammo the gun can use). */
export function ammoDef(gun) {
    return getItemDef(gun.ammoItem);
}

// ================================================================================================
// 3D models
// ================================================================================================

const _mats = new Map();
function mat(color, roughness = 0.45, metalness = 0.55) {
    const key = `${color}|${roughness}|${metalness}`;
    if (!_mats.has(key)) _mats.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
    return _mats.get(key);
}

/**
 * Builds a gun. Returns { group, muzzle (local point), length }.
 * Blueprints are short descriptions per family; everything is boxes and cylinders.
 */
export function buildGunModel(gunOrId) {
    const gun = typeof gunOrId === 'string' ? GUNS[gunOrId] : gunOrId;
    const m = gun.model;
    const [cMain, cAccent, cMetal] = FINISH[m.finish] || FINISH.black;
    const body = mat(cMain, m.finish === 'chrome' || m.finish === 'gold' || m.finish === 'stainless' ? 0.25 : 0.5, m.finish === 'polymer' || m.finish === 'tan' || m.finish === 'od' ? 0.15 : 0.6);
    const accent = mat(cAccent, 0.6, cAccent === 0x2b2b2b || cAccent === 0x1f1f1f ? 0.2 : 0.05);
    const metal = mat(cMetal, 0.35, 0.8);
    const dark = mat(0x111214, 0.5, 0.4);
    const glass = mat(0x223344, 0.05, 0.9);
    const red = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
    const g = new THREE.Group();
    g.name = `gun_${gun.id}`;
    const box = (w, h, d, x, y, z, mt, rx = 0, ry = 0, rz = 0) => {
        const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mt);
        o.position.set(x, y, z);
        o.rotation.set(rx, ry, rz);
        g.add(o);
        return o;
    };
    const cyl = (r, len, x, y, z, mt, seg = 12, r2 = r) => {
        const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r2, len, seg), mt);
        o.rotation.x = Math.PI / 2;
        o.position.set(x, y, z);
        g.add(o);
        return o;
    };
    let muzzleZ = 0, muzzleY = 0.03;

    const addSight = (type, y, z, len = 0.12) => {
        if (type === 'reddot') {
            box(0.03, 0.03, 0.05, 0, y + 0.02, z, dark);
            box(0.026, 0.022, 0.004, 0, y + 0.025, z - 0.024, glass);
            box(0.004, 0.004, 0.002, 0, y + 0.025, z - 0.02, red);
        } else if (type === 'scope' || type === 'bigscope') {
            const r = type === 'bigscope' ? 0.024 : 0.019;
            box(0.012, 0.03, 0.02, 0, y + 0.012, z - len * 0.3, dark);
            box(0.012, 0.03, 0.02, 0, y + 0.012, z + len * 0.3, dark);
            cyl(r * 0.8, len, 0, y + 0.04, z, dark, 14);
            cyl(r, 0.04, 0, y + 0.04, z - len / 2 - 0.01, dark, 14, r * 0.8);
            cyl(r * 0.9, 0.03, 0, y + 0.04, z + len / 2 + 0.01, dark, 14);
            const lens = new THREE.Mesh(new THREE.CircleGeometry(r * 0.9, 14), glass);
            lens.position.set(0, y + 0.04, z - len / 2 - 0.031);
            lens.rotation.y = Math.PI;
            g.add(lens);
        } else {
            box(0.006, 0.014, 0.006, 0, y + 0.007, z, dark);
        }
    };
    const addStock = (type, y, z0, h) => {
        if (type === 'wood') {
            box(0.04, h * 1.05, 0.2, 0, y - 0.015, z0 + 0.1, accent, -0.08);
        } else if (type === 'fixed') {
            box(0.036, h * 0.9, 0.18, 0, y - 0.01, z0 + 0.09, body);
            box(0.04, h * 1.2, 0.02, 0, y - 0.015, z0 + 0.185, dark);
        } else if (type === 'folding' || type === 'skeleton') {
            box(0.01, 0.01, 0.17, -0.015, y + 0.01, z0 + 0.085, metal);
            box(0.01, 0.01, 0.17, -0.015, y - 0.035, z0 + 0.085, metal);
            box(0.03, h, 0.015, -0.01, y - 0.012, z0 + 0.175, body);
        } else if (type === 'pistol') {
            box(0.03, 0.08, 0.05, 0, y - 0.05, z0 + 0.03, accent, 0.5);
        }
    };
    const addMag = (type, z, y) => {
        if (type === 'curved') {
            for (let i = 0; i < 4; i++) box(0.026, 0.035, 0.04, 0, y - 0.03 - i * 0.03, z - i * 0.012, dark, 0.25);
        } else if (type === 'box') {
            box(0.024, 0.11, 0.035, 0, y - 0.06, z, dark, 0.08);
        } else if (type === 'drum') {
            const d = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.045, 18), dark);
            d.rotation.z = Math.PI / 2;
            d.position.set(0, y - 0.06, z);
            g.add(d);
        } else if (type === 'boxbelt') {
            box(0.06, 0.07, 0.07, 0.02, y - 0.05, z, mat(0x3d4430, 0.7, 0.1));
        }
    };

    switch (m.family) {
        case 'pistol': {
            const L = m.len, H = m.h;
            box(0.03, H, L, 0, 0.035, -L / 2 + 0.03, m.finish === 'polymer' ? metal : body);               // slide
            box(0.028, 0.022, L * 0.75, 0, 0.007, -L * 0.375 + 0.02, body);                                 // frame
            box(0.028, 0.09, 0.04, 0, -0.04, 0.0, m.woodGrip ? accent : (m.finish === 'gold' ? dark : accent), -0.25); // grip
            box(0.024, 0.008, 0.035, 0, -0.005, -0.04, body);                                              // trigger guard
            if (m.extMag) box(0.022, 0.06, 0.03, 0, -0.105, 0.015, dark, -0.25);
            if (m.triangular) box(0.03, 0.012, L * 0.6, 0, 0.06, -L / 2 + 0.03, body);
            addSight('iron', 0.052, -L + 0.04);
            addSight('iron', 0.052, 0.01);
            muzzleZ = -L + 0.03;
            muzzleY = 0.035;
            if (m.suppressor) {
                cyl(0.016, m.suppressor, 0, 0.035, muzzleZ - m.suppressor / 2, dark, 14);
                muzzleZ -= m.suppressor;
            }
            break;
        }
        case 'revolver': {
            const L = m.len;
            cyl(0.011, L * 0.6, 0, 0.04, -L * 0.45, metal);                                                 // barrel
            box(0.012, 0.01, L * 0.6, 0, 0.055, -L * 0.45, metal);                                          // rib
            const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.045, 6), metal);
            cylinder.rotation.x = Math.PI / 2;
            cylinder.position.set(0, 0.035, -0.035);
            g.add(cylinder);
            box(0.026, 0.05, 0.06, 0, 0.03, 0.0, body);                                                     // frame
            box(0.028, 0.09, 0.035, 0, -0.04, 0.025, accent, -0.35);                                        // grip
            box(0.006, 0.016, 0.012, 0, 0.06, 0.03, metal, 0.4);                                            // hammer
            muzzleZ = -L * 0.75;
            muzzleY = 0.04;
            break;
        }
        case 'smg':
        case 'rifle': {
            const L = m.len;
            const H = m.fat ? 0.07 : (m.boxy ? 0.06 : 0.05);
            box(m.boxy ? 0.045 : 0.035, H, L, 0, 0.03, -L / 2 + 0.06, body);                                // receiver
            if (m.angular) box(0.035, 0.03, L * 0.4, 0, 0.0, -L * 0.25, body, 0.35);
            box(0.03, 0.085, 0.035, 0, -0.035, 0.03, accent, -0.22);                                        // pistol grip
            box(0.024, 0.008, 0.04, 0, -0.005, -0.015, body);                                               // trigger guard
            const hg = m.handguard || 0;
            if (hg) box(0.036, H * 0.85, hg, 0, 0.026, -L + 0.06 - hg / 2, m.woodGuard ? accent : body);    // handguard
            const bLen = m.barrel || 0.1;
            const bz = -L + 0.06 - hg;
            cyl(0.008, bLen, 0, 0.032, bz - bLen / 2, metal);
            muzzleZ = bz - bLen;
            muzzleY = 0.032;
            if (m.fins) for (let i = 0; i < 5; i++) cyl(0.014, 0.006, 0, 0.032, bz - 0.01 - i * 0.012, metal);
            if (m.foregrip) box(0.025, 0.06, 0.03, 0, -0.02, -L + 0.06 - 0.04, accent, 0.2);
            if (m.mag === 'grip') box(0.024, 0.05, 0.03, 0, -0.1, 0.035, dark, -0.22);
            else addMag(m.mag, -L * 0.42, 0.01);
            addStock(m.stock, 0.03, 0.06, H);
            if (m.carry) {
                box(0.016, 0.022, L * 0.45, 0, 0.068, -L * 0.25, body);
                box(0.012, 0.03, 0.012, 0, 0.065, bz + 0.02, body);
            }
            if (m.sight) addSight(m.sight, 0.055 + (m.carry ? 0.02 : 0), -L * 0.3, 0.14);
            else if (!m.carry) {
                addSight('iron', 0.055, -L + 0.05);
                addSight('iron', 0.055, 0.0);
            }
            if (m.bipod) {
                box(0.006, 0.09, 0.006, -0.02, -0.02, bz + 0.02, metal, 0.4, 0, 0.2);
                box(0.006, 0.09, 0.006, 0.02, -0.02, bz + 0.02, metal, 0.4, 0, -0.2);
            }
            break;
        }
        case 'bullpup': {
            const L = m.len;
            box(0.045, 0.075, L, 0, 0.02, -L / 2 + 0.15, body);                                             // body
            box(0.03, 0.08, 0.035, 0, -0.04, -0.03, accent, -0.2);                                          // grip
            box(0.03, 0.05, 0.03, 0, -0.03, -0.12, accent, 0.3);                                            // front grip / guard
            if (m.mag === 'top') box(0.035, 0.018, L * 0.6, 0, 0.066, -L / 2 + 0.17, mat(0x2b2f33, 0.2, 0.3));
            else addMag(m.mag, 0.09, 0.0);
            if (m.carry) box(0.016, 0.03, L * 0.55, 0, 0.075, -L / 2 + 0.12, body);
            if (m.sight) addSight(m.sight, 0.075, -0.05, 0.1);
            cyl(0.008, 0.06, 0, 0.03, -L + 0.12, metal);
            muzzleZ = -L + 0.09;
            muzzleY = 0.03;
            break;
        }
        case 'shotgun': {
            const L = m.len;
            box(0.04, 0.05, 0.14, 0, 0.025, -0.04, body);                                                   // receiver
            box(0.028, 0.08, 0.035, 0, -0.03, 0.04, accent, -0.3);                                          // grip (wrist)
            const bl = m.barrel;
            if (m.double) {
                cyl(0.011, bl, -0.011, 0.035, -0.11 - bl / 2, metal);
                cyl(0.011, bl, 0.011, 0.035, -0.11 - bl / 2, metal);
                box(0.03, 0.02, bl * 0.8, 0, 0.015, -0.11 - bl * 0.4, accent);
            } else {
                cyl(0.011, bl, 0, 0.04, -0.11 - bl / 2, metal);
                if (m.tube) cyl(0.009, bl * 0.8, 0, 0.018, -0.11 - bl * 0.4, metal);
                if (m.pump) box(0.034, 0.03, 0.1, 0, 0.02, -0.11 - bl * 0.35, accent);
            }
            addStock(m.stock, 0.02, 0.03, 0.06);
            addSight('iron', 0.05, -0.11 - bl + 0.01);
            muzzleZ = -0.11 - bl;
            muzzleY = 0.035;
            break;
        }
        case 'sniper': {
            const L = m.len;
            const H = m.fat ? 0.065 : 0.045;
            box(0.034, H, L, 0, 0.03, -L / 2 + 0.06, body);                                                 // receiver / stock body
            box(0.03, 0.085, 0.035, 0, -0.035, 0.03, accent, -0.22);
            if (m.stock === 'wood') box(0.04, 0.06, 0.22, 0, 0.0, 0.17, accent, -0.06);
            else addStock(m.stock, 0.03, 0.06, H);
            const bl = m.barrel;
            const bz = -L + 0.06;
            cyl(m.fat ? 0.012 : 0.009, bl, 0, 0.035, bz - bl / 2, metal);
            muzzleZ = bz - bl;
            muzzleY = 0.035;
            if (m.brake) {
                box(0.03, 0.025, 0.05, 0, 0.035, muzzleZ - 0.02, dark);
                muzzleZ -= 0.045;
            }
            if (m.bolt) {
                box(0.008, 0.008, 0.04, 0.025, 0.04, -0.02, metal, 0, 0.5);
                const knob = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), metal);
                knob.position.set(0.042, 0.03, -0.01);
                g.add(knob);
            }
            if (m.mag) addMag(m.mag, -0.07, 0.01);
            addSight(m.sight, 0.06, -L * 0.25, m.sight === 'bigscope' ? 0.2 : 0.16);
            if (m.bipod) {
                box(0.006, 0.1, 0.006, -0.02, -0.02, bz + 0.03, metal, 0.4, 0, 0.2);
                box(0.006, 0.1, 0.006, 0.02, -0.02, bz + 0.03, metal, 0.4, 0, -0.2);
            }
            break;
        }
        case 'minigun': {
            const L = m.len;
            box(0.09, 0.09, 0.2, 0, 0.02, 0.02, body);                                                      // motor housing
            const barrels = new THREE.Group();
            barrels.name = 'minigun_barrels';
            barrels.position.set(0, 0.02, -0.08);
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2;
                const b = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, L * 0.75, 8), metal);
                b.rotation.x = Math.PI / 2;
                b.position.set(Math.cos(a) * 0.026, Math.sin(a) * 0.026, -L * 0.375);
                barrels.add(b);
            }
            for (const z of [-0.05, -L * 0.6]) {
                const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.015, 14), dark);
                ring.rotation.x = Math.PI / 2;
                ring.position.z = z;
                barrels.add(ring);
            }
            g.add(barrels);
            box(0.025, 0.1, 0.03, 0, -0.06, 0.05, accent, -0.2);                                            // grip
            box(0.03, 0.03, 0.12, 0, 0.09, 0.0, dark);                                                      // carry handle
            box(0.07, 0.09, 0.09, 0.07, -0.02, 0.05, mat(0x3d4430, 0.7, 0.1));                              // ammo box
            muzzleZ = -0.08 - L * 0.75;
            muzzleY = 0.02;
            break;
        }
        case 'launcher': {
            cyl(0.035, 0.55, 0, 0.02, -0.1, body, 14);
            cyl(0.048, 0.08, 0, 0.02, 0.2, body, 14, 0.035);
            const cone = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 12), mat(0x4a5d3b, 0.4, 0.6));
            cone.rotation.x = -Math.PI / 2;
            cone.position.set(0, 0.02, -0.44);
            g.add(cone);
            cyl(0.03, 0.04, 0, 0.02, -0.36, mat(0x4a5d3b, 0.4, 0.6), 12);
            box(0.03, 0.08, 0.04, 0, -0.04, -0.04, accent, 0.2);
            box(0.03, 0.08, 0.04, 0, -0.04, 0.08, accent, 0.2);
            box(0.02, 0.04, 0.05, 0.04, 0.05, -0.02, dark);
            muzzleZ = -0.52;
            muzzleY = 0.02;
            break;
        }
        case 'grenadelauncher': {
            const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 6), body);
            drum.rotation.x = Math.PI / 2;
            drum.position.set(0, 0.02, -0.08);
            g.add(drum);
            cyl(0.024, 0.2, 0, 0.02, -0.24, metal, 14);
            box(0.03, 0.085, 0.035, 0, -0.04, 0.03, accent, -0.22);
            box(0.03, 0.06, 0.03, 0, -0.03, -0.2, accent, 0.25);
            addStock('folding', 0.02, 0.05, 0.05);
            addSight('reddot', 0.06, -0.1);
            muzzleZ = -0.34;
            muzzleY = 0.02;
            break;
        }
        default:
            box(0.03, 0.05, 0.25, 0, 0.03, -0.1, body);
            muzzleZ = -0.23;
    }
    g.traverse((o) => {
        if (o.isMesh) {
            o.castShadow = true;
        }
    });
    const bbox = new THREE.Box3().setFromObject(g);
    return { group: g, muzzle: new THREE.Vector3(0, muzzleY, muzzleZ), length: bbox.max.z - bbox.min.z };
}

// ================================================================================================
// Icons
// ================================================================================================

const _icons = new Map();

/** Side-profile icon (data URL) for an item: guns from their blueprint, ammo as a box of rounds. */
export function itemIcon(id, w = 120, h = 48) {
    const key = `${id}|${w}|${h}`;
    if (_icons.has(key)) return _icons.get(key);
    if (typeof document === 'undefined') return '';
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const def = getItemDef(id);
    if (def && def.kind === 'gun') drawGunIcon(g, def, w, h);
    else if (def && def.kind === 'ammo') drawAmmoIcon(g, def, w, h);
    else if (def && def.id === 'spraycan') drawSprayIcon(g, w, h);
    else if (def && def.id === 'hands') drawFistIcon(g, w, h);
    const url = c.toDataURL();
    _icons.set(key, url);
    return url;
}

function hex(c) {
    return '#' + c.toString(16).padStart(6, '0');
}

function drawGunIcon(g, gun, w, h) {
    // Project the 3D model onto its side: every mesh's bounding box as a filled rectangle (z -> x)
    const { group } = buildGunModel(gun);
    group.updateMatrixWorld(true);
    const parts = [];
    const bb = new THREE.Box3();
    const all = new THREE.Box3();
    group.traverse((o) => {
        if (!o.isMesh) return;
        bb.setFromObject(o);
        all.union(bb);
        parts.push({ z0: bb.min.z, z1: bb.max.z, y0: bb.min.y, y1: bb.max.y, color: o.material.color ? o.material.color.getHex() : 0x222222, x: bb.max.x });
    });
    const spanZ = all.max.z - all.min.z, spanY = all.max.y - all.min.y;
    const s = Math.min((w - 8) / spanZ, (h - 8) / spanY);
    const ox = (w - spanZ * s) / 2, oy = (h - spanY * s) / 2;
    // Draw back to front so near parts cover far ones
    parts.sort((a, b) => a.x - b.x);
    for (const p of parts) {
        const col = new THREE.Color(p.color);
        // Lift dark finishes so silhouettes read on the dark hotbar
        const lum = col.r * 0.3 + col.g * 0.59 + col.b * 0.11;
        if (lum < 0.25) col.lerp(new THREE.Color(0x8a9099), 0.55);
        g.fillStyle = '#' + col.getHexString();
        g.fillRect(ox + (all.max.z - p.z1) * s, oy + (all.max.y - p.y1) * s, Math.max(1, (p.z1 - p.z0) * s), Math.max(1, (p.y1 - p.y0) * s));
    }
}

function drawAmmoIcon(g, def, w, h) {
    const n = 5;
    for (let i = 0; i < n; i++) {
        const x = w / 2 - n * 7 + i * 14;
        g.fillStyle = def.iconColor || '#c8a050';
        g.fillRect(x, h * 0.3, 9, h * 0.5);
        g.fillStyle = '#8a6a2a';
        g.beginPath();
        g.moveTo(x, h * 0.3);
        g.lineTo(x + 4.5, h * 0.12);
        g.lineTo(x + 9, h * 0.3);
        g.fill();
    }
}

function drawSprayIcon(g, w, h) {
    g.fillStyle = '#d9d9d9';
    g.fillRect(w / 2 - 9, h * 0.25, 18, h * 0.65);
    g.fillStyle = '#e74c3c';
    g.fillRect(w / 2 - 9, h * 0.45, 18, h * 0.2);
    g.fillStyle = '#555';
    g.fillRect(w / 2 - 4, h * 0.1, 8, h * 0.15);
}

function drawFistIcon(g, w, h) {
    g.fillStyle = '#e0ac69';
    g.beginPath();
    g.roundRect ? g.roundRect(w / 2 - 14, h * 0.2, 28, h * 0.6, 6) : g.rect(w / 2 - 14, h * 0.2, 28, h * 0.6);
    g.fill();
    g.strokeStyle = '#a8763c';
    for (let i = 1; i < 4; i++) {
        g.beginPath();
        g.moveTo(w / 2 - 14 + i * 7, h * 0.22);
        g.lineTo(w / 2 - 14 + i * 7, h * 0.45);
        g.stroke();
    }
}

// ================================================================================================
// Sound
// ================================================================================================

/**
 * Gun sounds through Web Audio: recorded shots (decoded once) pitched per gun, layered with a
 * synthesized body, plus reload / dry-fire / bolt mechanics. Plays at a distance for other
 * players' shots.
 */
export class GunAudio {
    constructor(ctx) {
        this.ctx = ctx;
        this.buffers = new Map();
        this.out = ctx.createGain();
        this.out.gain.value = 0.9;
        this.out.connect(ctx.destination);
        const len = ctx.sampleRate;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noise = buf;
        for (const path of new Set(Object.values(S))) this._load(path);
    }

    _load(path) {
        if (this.buffers.has(path)) return;
        this.buffers.set(path, null);
        fetch(encodeURI(path)).then((r) => r.arrayBuffer()).then((a) => this.ctx.decodeAudioData(a))
            .then((b) => this.buffers.set(path, b)).catch(() => {});
    }

    /**
     * A shot of `gun`. `distance` (m) muffles and quietens it (other players' shots).
     * @returns {boolean} false if the recording isn't loaded yet (the caller can fall back)
     */
    shot(gun, distance = 0) {
        const ctx = this.ctx;
        const v = gun.voice || { rate: 1, gain: 0.6, body: 'pistol' };
        const t0 = ctx.currentTime + 0.002;
        const far = Math.max(0, Math.min(1, distance / 250));
        const bus = ctx.createGain();
        bus.gain.value = (1 - far * 0.9);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = v.body === 'suppressed' ? 1800 : 16000 - far * 14000;
        bus.connect(lp).connect(this.out);
        const buf = this.buffers.get(gun.sound);
        let played = false;
        if (buf) {
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.playbackRate.value = v.rate * (0.97 + Math.random() * 0.06);
            const g = ctx.createGain();
            g.gain.value = v.gain;
            src.connect(g).connect(bus);
            src.start(t0);
            src.stop(t0 + Math.min(buf.duration / src.playbackRate.value, 2.5));
            played = true;
        }
        this._body(v.body, bus, t0, v.gain);
        return played;
    }

    _noise(dest, t0, dur, type, freq, q, peak) {
        const ctx = this.ctx;
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(peak, t0);
        g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
        src.connect(f).connect(g).connect(dest);
        src.start(t0, Math.random() * 0.5);
        src.stop(t0 + dur + 0.02);
    }

    _tone(dest, t0, f0, f1, dur, peak, type = 'sine') {
        const ctx = this.ctx;
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f0, t0);
        o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(peak, t0);
        g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
        o.connect(g).connect(dest);
        o.start(t0);
        o.stop(t0 + dur + 0.02);
    }

    _body(kind, dest, t0, gain) {
        switch (kind) {
            case 'boom':
                this._tone(dest, t0, 120, 38, 0.35, 0.55 * gain);
                this._noise(dest, t0, 0.25, 'lowpass', 900, 0.7, 0.4 * gain);
                break;
            case 'crack':
                this._noise(dest, t0, 0.06, 'highpass', 2500, 0.7, 0.5 * gain);
                this._tone(dest, t0, 95, 40, 0.4, 0.4 * gain);
                this._noise(dest, t0 + 0.05, 0.9, 'lowpass', 500, 0.5, 0.12 * gain);   // echo tail
                break;
            case 'rifle':
                this._noise(dest, t0, 0.05, 'highpass', 2000, 0.7, 0.25 * gain);
                this._tone(dest, t0, 140, 55, 0.14, 0.25 * gain);
                break;
            case 'shotgun':
                this._tone(dest, t0, 90, 35, 0.3, 0.45 * gain);
                break;
            case 'suppressed':
                this._noise(dest, t0, 0.07, 'bandpass', 900, 1.2, 0.5);
                this._tone(dest, t0, 180, 80, 0.05, 0.15);
                break;
            case 'launch':
                this._noise(dest, t0, 0.8, 'bandpass', 600, 0.5, 0.35);
                this._tone(dest, t0, 70, 30, 0.4, 0.4);
                break;
            case 'thunk':
                this._tone(dest, t0, 160, 60, 0.12, 0.6);
                this._noise(dest, t0, 0.1, 'lowpass', 700, 0.8, 0.3);
                break;
            case 'smg':
                this._tone(dest, t0, 160, 70, 0.08, 0.18 * gain);
                break;
            default:
                this._tone(dest, t0, 150, 60, 0.1, 0.2 * gain);
        }
    }

    /** Magazine out / in, slide or bolt, single shell, dry fire, minigun spin. */
    mechanic(kind) {
        const ctx = this.ctx;
        const t0 = ctx.currentTime + 0.002;
        const d = this.out;
        const click = (t, f, peak = 0.25) => this._noise(d, t, 0.03, 'bandpass', f, 3, peak);
        switch (kind) {
            case 'magOut': click(t0, 1400, 0.3); this._tone(d, t0, 400, 300, 0.05, 0.08, 'square'); break;
            case 'magIn': click(t0, 1100, 0.35); click(t0 + 0.05, 2400, 0.2); break;
            case 'slide': click(t0, 2000, 0.25); click(t0 + 0.09, 2800, 0.3); break;
            case 'shell': click(t0, 1700, 0.25); this._tone(d, t0, 600, 350, 0.04, 0.06, 'triangle'); break;
            case 'pump': click(t0, 900, 0.35); click(t0 + 0.12, 1300, 0.35); break;
            case 'bolt': click(t0, 1600, 0.3); click(t0 + 0.1, 1100, 0.25); click(t0 + 0.22, 2200, 0.3); break;
            case 'dry': click(t0, 3200, 0.3); break;
            case 'mode': click(t0, 2600, 0.2); break;
            case 'pickup': click(t0, 1200, 0.25); click(t0 + 0.06, 1800, 0.2); break;
            case 'spin': this._tone(d, t0, 60, 300, 0.6, 0.12, 'sawtooth'); break;
            default: click(t0, 1500);
        }
    }

    /** Rocket / grenade blast at a distance. */
    explosion(distance = 0) {
        const ctx = this.ctx;
        const t0 = ctx.currentTime + 0.002;
        const far = Math.max(0, Math.min(1, distance / 300));
        const bus = ctx.createGain();
        bus.gain.value = 1 - far * 0.85;
        bus.connect(this.out);
        this._tone(bus, t0, 80, 25, 1.2, 0.9);
        this._noise(bus, t0, 1.4, 'lowpass', 1200 - far * 900, 0.6, 0.8);
        const buf = this.buffers.get(S.boom);
        if (buf) {
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const g = ctx.createGain();
            g.gain.value = 0.5;
            src.connect(g).connect(bus);
            src.start(t0);
        }
    }
}

export { allItemDefs };
