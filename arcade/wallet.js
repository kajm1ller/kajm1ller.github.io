/**
 * arcade/wallet.js — the Kaj Arcade balance: plain JS (no three.js), saved in localStorage.
 * Same shape as the Wallet in js/game/money.js, but with its own save slot and start balance.
 */

export const WALLET_CONFIG = Object.freeze({ START: 1000, STORAGE_KEY: 'kajarcade.wallet.v1' });

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
    constructor({ storage = defaultStorage(), key = WALLET_CONFIG.STORAGE_KEY, start = WALLET_CONFIG.START } = {}) {
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

    /** Remembers a casino result for the stats (net win of one round). */
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
