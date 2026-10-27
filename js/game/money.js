/**
 * js/game/money.js
 *
 * The player's money. One Wallet holds the balance (kept in localStorage, so it survives a reload),
 * and everything that costs or pays goes through it: cash picked up off
 * people who died in the street, the hospital bill when you're wasted and the fine when you're
 * busted.
 *
 *   wallet.balance                  dollars (cents are kept)
 *   wallet.spend(amount, reason)    false (and nothing taken) when you can't afford it
 *   wallet.add(amount, reason)
 *   wallet.onChange(fn)             fn(balance, delta, reason); returns an unsubscribe function
 *
 * MoneyHUD shows the balance with +/- popups; CashDrops are the bills left where people fell.
 * Only the HUD and drops touch the DOM / three.js; the Wallet itself is plain JS (unit tested).
 */

import * as THREE from 'three';

export const MONEY_CONFIG = Object.freeze({
    START: 1000,
    STORAGE_KEY: 'kajsim.wallet.v1',
    HOSPITAL_MIN: 100,           // wasted: the bill is 5% of what you have, at least this much
    HOSPITAL_SHARE: 0.05,
    BUSTED_MIN: 250,             // busted: bail is 10%, at least this much
    BUSTED_SHARE: 0.10,
    DROP_PICKUP_RADIUS: 1.7,
    DROP_LIFETIME: 150,          // seconds before an uncollected drop is gone
    MAX_DROPS: 40
});

const round2 = (n) => Math.round(n * 100) / 100;

/** "$1,234" or "$1,234.50"; `sign` adds + for positive amounts. */
export function formatMoney(n, { sign = false, cents = 'auto' } = {}) {
    const v = round2(Number(n) || 0);
    const abs = Math.abs(v);
    const showCents = cents === true || (cents === 'auto' && Math.abs(abs - Math.round(abs)) > 0.004);
    const body = abs.toLocaleString('en-US', {
        minimumFractionDigits: showCents ? 2 : 0,
        maximumFractionDigits: showCents ? 2 : 0
    });
    const pre = v < 0 ? '-' : (sign && v > 0 ? '+' : '');
    return `${pre}$${body}`;
}

function defaultStorage() {
    try {
        if (typeof localStorage !== 'undefined') return localStorage;
    } catch (e) { /* blocked */ }
    return null;
}

export class Wallet {
    /**
     * @param {Object} [o]
     * @param {Storage|null} [o.storage] where the balance is saved (localStorage by default; null = not saved)
     * @param {string} [o.key]
     * @param {number} [o.start] balance for a new player
     */
    constructor({ storage = defaultStorage(), key = MONEY_CONFIG.STORAGE_KEY, start = MONEY_CONFIG.START } = {}) {
        this.storage = storage;
        this.key = key;
        this._listeners = new Set();
        this.stats = { earned: 0, spent: 0, biggestWin: 0, hands: 0 };
        this._balance = start;
        let saved = null;
        try {
            saved = storage ? JSON.parse(storage.getItem(key) || 'null') : null;
        } catch (e) { saved = null; }
        if (saved && Number.isFinite(saved.balance)) {
            this._balance = round2(Math.max(0, saved.balance));
            if (saved.stats) Object.assign(this.stats, saved.stats);
        }
    }

    get balance() { return this._balance; }

    canAfford(amount) {
        return Number.isFinite(amount) && amount >= 0 && round2(amount) <= this._balance + 1e-9;
    }

    /** Takes `amount` if there's enough; returns whether it was taken. */
    spend(amount, reason = '') {
        amount = round2(amount);
        if (!(amount > 0) || !this.canAfford(amount)) return false;
        this._balance = round2(this._balance - amount);
        this.stats.spent = round2(this.stats.spent + amount);
        this._changed(-amount, reason);
        return true;
    }

    /** Takes up to `amount` (fines and bills don't care whether you can afford them); returns what was taken. */
    charge(amount, reason = '') {
        amount = round2(Math.min(Math.max(0, amount), this._balance));
        if (amount <= 0) return 0;
        this._balance = round2(this._balance - amount);
        this.stats.spent = round2(this.stats.spent + amount);
        this._changed(-amount, reason);
        return amount;
    }

    add(amount, reason = '') {
        amount = round2(amount);
        if (!(amount > 0)) return 0;
        this._balance = round2(this._balance + amount);
        this.stats.earned = round2(this.stats.earned + amount);
        this._changed(amount, reason);
        return amount;
    }

    /** Remembers a round's result for the stats (net win of one round). */
    recordWin(net) {
        if (net > this.stats.biggestWin) this.stats.biggestWin = round2(net);
        this.stats.hands++;
        this._save();
    }

    set(amount, reason = 'set') {
        const before = this._balance;
        this._balance = round2(Math.max(0, amount));
        this._changed(this._balance - before, reason);
    }

    onChange(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    _save() {
        if (!this.storage) return;
        try {
            this.storage.setItem(this.key, JSON.stringify({ balance: this._balance, stats: this.stats }));
        } catch (e) { /* full or blocked: the balance just isn't kept */ }
    }

    _changed(delta, reason) {
        this._save();
        for (const fn of this._listeners) {
            try { fn(this._balance, round2(delta), reason); } catch (e) { console.error(e); }
        }
    }
}

/** What the hospital charges when you're wasted. */
export function hospitalBill(balance) {
    return round2(Math.min(balance, Math.max(MONEY_CONFIG.HOSPITAL_MIN, balance * MONEY_CONFIG.HOSPITAL_SHARE)));
}

/** Bail when the police bust you. */
export function bailFine(balance) {
    return round2(Math.min(balance, Math.max(MONEY_CONFIG.BUSTED_MIN, balance * MONEY_CONFIG.BUSTED_SHARE)));
}

/** Cash someone was carrying (style: who they are, see districts.js looks). */
export function pocketCash(style, rand = Math.random) {
    const r = rand();
    switch (style) {
        case 'student': case 'partier': return Math.round(3 + r * r * 40);
        case 'older': return Math.round(10 + r * 70);
        case 'worker': case 'shopper': return Math.round(15 + r * r * 120);
        case 'cop': return Math.round(40 + r * 80);
        default: return Math.round(5 + r * r * 90);
    }
}

// ------------------------------------------------------------------------------------------------
// HUD
// ------------------------------------------------------------------------------------------------
export class MoneyHUD {
    /** @param {HTMLElement} el container (top-right HUD stack) @param {Wallet} wallet */
    constructor(el, wallet) {
        this.el = el;
        this.wallet = wallet;
        this.value = el.querySelector('.money-value');
        this.pops = el.querySelector('.money-pops');
        this._shown = wallet.balance;
        this._anim = null;
        this.value.textContent = formatMoney(wallet.balance);
        wallet.onChange((bal, delta) => this._update(bal, delta));
    }

    _update(bal, delta) {
        if (delta) {
            const pop = document.createElement('div');
            pop.className = 'money-pop ' + (delta > 0 ? 'up' : 'down');
            pop.textContent = formatMoney(delta, { sign: true });
            this.pops.appendChild(pop);
            setTimeout(() => pop.remove(), 1800);
            while (this.pops.children.length > 4) this.pops.firstChild.remove();
        }
        // Count to the new balance
        const from = this._shown, to = bal, t0 = performance.now();
        cancelAnimationFrame(this._anim);
        const step = () => {
            const t = Math.min(1, (performance.now() - t0) / 600);
            this._shown = from + (to - from) * (1 - (1 - t) ** 3);
            this.value.textContent = formatMoney(t >= 1 ? to : Math.round(this._shown));
            if (t < 1) this._anim = requestAnimationFrame(step);
        };
        step();
    }
}

// ------------------------------------------------------------------------------------------------
// Cash on the ground
// ------------------------------------------------------------------------------------------------
function makeBillTexture() {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#6fae6a';
    g.fillRect(0, 0, 128, 64);
    g.strokeStyle = '#2f5e2c';
    g.lineWidth = 4;
    g.strokeRect(4, 4, 120, 56);
    g.fillStyle = '#2f5e2c';
    g.beginPath();
    g.ellipse(64, 32, 16, 20, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#cfe6c4';
    g.font = 'bold 22px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('$', 64, 33);
    g.fillStyle = '#2f5e2c';
    g.font = 'bold 14px Georgia, serif';
    g.fillText('100', 22, 18);
    g.fillText('100', 106, 48);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

export class CashDrops {
    constructor(scene) {
        this.scene = scene;
        this.drops = [];
        const tex = makeBillTexture();
        this._geo = new THREE.BoxGeometry(0.34, 0.07, 0.16);
        const side = new THREE.MeshStandardMaterial({ color: 0x8fbf88, roughness: 0.9 });
        const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, emissive: 0x1d3a1a, emissiveIntensity: 0.6 });
        this._mats = [side, side, top, top, side, side];
        this._half = new THREE.Vector3(0.17, 0.035, 0.08);
        this.physics = null;   // PropPhysics (propPhysics.js), set by the game: the bills fall and land
    }

    /**
     * Leaves `amount` dollars at (x, z). `id` names it in multiplayer, where the server decides who gets it.
     * opts { y, vel, thrown }: `thrown` (the player's own) can't be picked up until they've stepped away.
     */
    drop(x, z, amount, id = null, opts = {}) {
        if (!(amount > 0)) return;
        if (id !== null && this.drops.some((d) => d.id === id)) return;
        const mesh = new THREE.Mesh(this._geo, this._mats);
        mesh.position.set(x, opts.y ?? 0.3, z);
        mesh.rotation.set(Math.random() - 0.5, Math.random() * 6, Math.random() - 0.5);
        mesh.castShadow = true;
        this.scene.add(mesh);
        const body = this.physics ? this.physics.add(mesh, this._half, opts.vel || null,
            new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(6)) : null;
        this.drops.push({ mesh, body, x, z, amount, age: 0, id, asked: 0, thrown: !!opts.thrown });
        while (this.drops.length > MONEY_CONFIG.MAX_DROPS) this._remove(0);
    }

    _remove(i) {
        this.scene.remove(this.drops[i].mesh);
        if (this.drops[i].body) this.physics.remove(this.drops[i].body);
        this.drops.splice(i, 1);
    }

    /** The server says somebody took it. */
    remove(id) {
        const i = this.drops.findIndex((d) => d.id === id);
        if (i >= 0) this._remove(i);
    }

    /**
     * Spins the bills and collects them when the player (on foot) walks over one.
     * Shared drops (with an id) are only asked for: `onTake(id)` and the server answers.
     * @returns {number} dollars picked up this step
     */
    update(dt, player, canCollect, onTake = null) {
        let got = 0;
        for (let i = this.drops.length - 1; i >= 0; i--) {
            const d = this.drops[i];
            d.age += dt;
            if (d.age > MONEY_CONFIG.DROP_LIFETIME) { this._remove(i); continue; }
            d.x = d.mesh.position.x;
            d.z = d.mesh.position.z;
            const near = Math.hypot(player.x - d.x, player.z - d.z) < MONEY_CONFIG.DROP_PICKUP_RADIUS;
            if (d.thrown) { d.thrown = near; continue; }
            if (canCollect && near) {
                if (d.id !== null && onTake) {
                    if (d.age - d.asked > 1) { d.asked = d.age; onTake(d.id); }
                } else {
                    got += d.amount;
                    this._remove(i);
                }
            }
        }
        return got;
    }
}
