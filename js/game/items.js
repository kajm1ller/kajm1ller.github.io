/**
 * js/game/items.js
 *
 * Item system: things the player can carry and hold.
 *
 * - Item definitions (registerItem) describe a kind of thing: guns, tools like the spray can, the
 *   player's fists, ammunition. Definitions are shared; what the player owns are item stacks.
 * - An item stack is one owned thing (or a pile of a stackable thing such as ammo):
 *   { uid, id (definition id), count, data } where `data` holds per-item state, e.g. the rounds
 *   loaded in a gun's magazine and its selected fire mode.
 * - The Inventory holds stacks in slots (the first `hotbarSize` take things that can be held
 *   first, the backpack after them). The selected slot is what the player holds; an empty slot is
 *   bare hands. The weapon wheel (weaponWheel.js) picks what to hold.
 *
 * No three.js here: rendering lives with the item kinds (guns.js) and the UI (weaponWheel.js).
 */

const DEFS = new Map();
let _uid = 1;

/**
 * Registers an item definition.
 * @param {Object} def { id, name, kind: 'gun'|'tool'|'hands'|'ammo', stackable, maxStack,
 *   hotbar (may go in the hotbar), droppable, ... kind-specific fields }
 */
export function registerItem(def) {
    if (!def || !def.id) throw new Error('item needs an id');
    const full = Object.assign({
        stackable: false,
        maxStack: 1,
        hotbar: def.kind !== 'ammo',
        droppable: def.kind !== 'hands'
    }, def);
    DEFS.set(full.id, full);
    return full;
}

export function getItemDef(id) {
    return DEFS.get(id) || null;
}

/** Definition by display name (case-insensitive). */
export function findItemDefByName(name) {
    if (!name) return null;
    const lower = String(name).toLowerCase();
    for (const d of DEFS.values()) if (d.name.toLowerCase() === lower) return d;
    return null;
}

export function allItemDefs(kind = null) {
    const out = [];
    for (const d of DEFS.values()) if (!kind || d.kind === kind) out.push(d);
    return out;
}

/**
 * New item stack of a definition. Guns start with a full magazine unless `data` says otherwise.
 */
export function createItem(id, count = 1, data = {}) {
    const def = DEFS.get(id);
    if (!def) throw new Error(`unknown item ${id}`);
    const base = typeof def.createData === 'function' ? def.createData() : {};
    return { uid: _uid++, id, count: def.stackable ? Math.max(1, Math.min(def.maxStack, count)) : 1, data: Object.assign(base, data) };
}

export class Inventory {
    /**
     * @param {Object} [opts] { hotbarSize = 9, bagSize = 24 }
     */
    constructor(opts = {}) {
        this.hotbarSize = opts.hotbarSize ?? 9;
        this.bagSize = opts.bagSize ?? 24;
        this.slots = new Array(this.hotbarSize + this.bagSize).fill(null);
        this.selected = 0;
        this._listeners = [];
        // () => true while the held item can't be put away (a shotgun half pumped); set by the game
        this.lock = null;
    }

    /** Called with (inventory) after anything changes. */
    onChange(fn) {
        this._listeners.push(fn);
        return () => { this._listeners = this._listeners.filter((f) => f !== fn); };
    }

    _changed() {
        for (const fn of this._listeners) fn(this);
    }

    isHotbar(i) {
        return i >= 0 && i < this.hotbarSize;
    }

    get(i) {
        return this.slots[i] || null;
    }

    /** The stack in the selected hotbar slot (null = bare hands). */
    selectedItem() {
        return this.slots[this.selected] || null;
    }

    selectedDef() {
        const s = this.selectedItem();
        return s ? DEFS.get(s.id) : null;
    }

    /** Holds whatever is in slot i (any slot; an empty one means bare hands). */
    select(i) {
        if (this.lock && this.lock()) return this.selectedItem();
        const n = this.slots.length;
        this.selected = ((i % n) + n) % n;
        this._changed();
        return this.selectedItem();
    }

    /** Next / previous slot holding something that can be held (guns, tools, fists). */
    cycle(delta = 1) {
        if (this.lock && this.lock()) return this.selectedItem();
        const n = this.slots.length;
        for (let k = 1; k <= n; k++) {
            const i = ((this.selected + delta * k) % n + n) % n;
            const s = this.slots[i];
            const def = s && DEFS.get(s.id);
            if (def && def.hotbar !== false) return this.select(i);
        }
        return this.selectedItem();
    }

    /** First slot holding this definition (or matching `pred`), or -1. */
    find(idOrPred) {
        const pred = typeof idOrPred === 'function' ? idOrPred : (s) => s.id === idOrPred;
        return this.slots.findIndex((s) => s && pred(s));
    }

    count(id) {
        let n = 0;
        for (const s of this.slots) if (s && s.id === id) n += s.count;
        return n;
    }

    /**
     * Puts a stack in the inventory: tops up existing stacks of the same thing, then fills the
     * first empty slot (hotbar first for things that can be held, backpack first otherwise).
     * @param {Object} stack
     * @param {Object} [opts] { preferSlot }
     * @returns {number} how many could NOT be added (0 = all of it)
     */
    add(stack, opts = {}) {
        const def = DEFS.get(stack.id);
        if (!def) return stack.count;
        let left = stack.count;
        if (def.stackable) {
            for (const s of this.slots) {
                if (left <= 0) break;
                if (s && s.id === stack.id && s.count < def.maxStack) {
                    const take = Math.min(left, def.maxStack - s.count);
                    s.count += take;
                    left -= take;
                }
            }
        }
        const order = [];
        if (opts.preferSlot !== undefined && !this.slots[opts.preferSlot]) order.push(opts.preferSlot);
        const hot = [...Array(this.hotbarSize).keys()];
        const bag = [...Array(this.bagSize).keys()].map((i) => i + this.hotbarSize);
        order.push(...(def.hotbar ? hot.concat(bag) : bag.concat(hot)));
        for (const i of order) {
            if (left <= 0) break;
            if (this.slots[i]) continue;
            const n = def.stackable ? Math.min(left, def.maxStack) : 1;
            this.slots[i] = (n === stack.count && left === stack.count) ? stack : Object.assign({}, stack, { uid: _uid++, count: n, data: Object.assign({}, stack.data) });
            left -= n;
        }
        this._changed();
        return left;
    }

    /** Takes a whole stack (or `count` of it) out of slot i and returns it. */
    take(i, count = Infinity) {
        const s = this.slots[i];
        if (!s) return null;
        const def = DEFS.get(s.id);
        if (def && def.droppable === false) return null;
        if (count >= s.count) {
            this.slots[i] = null;
            this._changed();
            return s;
        }
        s.count -= count;
        this._changed();
        return Object.assign({}, s, { uid: _uid++, count, data: Object.assign({}, s.data) });
    }

    /** Uses up to `n` of a stackable item from anywhere; returns how many were taken. */
    consume(id, n) {
        let need = n;
        for (let i = this.slots.length - 1; i >= 0 && need > 0; i--) {
            const s = this.slots[i];
            if (!s || s.id !== id) continue;
            const take = Math.min(need, s.count);
            s.count -= take;
            need -= take;
            if (s.count <= 0) this.slots[i] = null;
        }
        if (need !== n) this._changed();
        return n - need;
    }

    /** Swaps two slots (or merges a stackable pile into another of the same thing). */
    move(from, to) {
        if (from === to) return;
        const a = this.slots[from], b = this.slots[to];
        const def = a ? DEFS.get(a.id) : null;
        if (a && b && a.id === b.id && def && def.stackable) {
            const take = Math.min(a.count, def.maxStack - b.count);
            b.count += take;
            a.count -= take;
            if (a.count <= 0) this.slots[from] = null;
        } else {
            if (a && def && def.hotbar === false && this.isHotbar(to)) return;
            if (b && DEFS.get(b.id) && DEFS.get(b.id).hotbar === false && this.isHotbar(from)) return;
            this.slots[from] = b;
            this.slots[to] = a;
        }
        this._changed();
    }

    /** Plain-data copy (e.g. for saving). */
    serialize() {
        return { selected: this.selected, slots: this.slots.map((s) => (s ? { id: s.id, count: s.count, data: s.data } : null)) };
    }
}
