/**
 * js/game/weaponWheel.js
 *
 * Weapon wheel and weapon HUD.
 *
 * - Hold Tab: the wheel opens at the top of the screen with one segment per kind of weapon
 *   (fists, pistols, SMGs, rifles, shotguns, snipers, heavy, spray can, drugs). Point the mouse at a
 *   segment, scroll to change which weapon of that kind it offers, and let go of Tab (or click)
 *   to hold it. The game keeps the pointer locked, so the wheel follows mouse movement with its
 *   own cursor; with a free mouse (or on a touch screen) the segments are simply clicked.
 * - Along the bottom of the screen, the inventory: everything carried (every weapon with the
 *   rounds in its magazine, the ammunition), clickable to hold a weapon.
 * - Bottom HUD while playing: the held weapon's icon, name, magazine / reserve ammo, fire mode,
 *   reload progress and a control hint.
 */

import { getItemDef } from './items.js';
import { itemIcon } from './guns.js';

export const WHEEL_SEGMENTS = Object.freeze([
    { label: 'Fists', match: (d) => d.kind === 'hands' },
    { label: 'Pistols', match: (d) => d.category === 'Pistol' },
    { label: 'SMGs', match: (d) => d.category === 'SMG' },
    { label: 'Rifles', match: (d) => d.category === 'Rifle' },
    { label: 'Shotguns', match: (d) => d.category === 'Shotgun' },
    { label: 'Snipers', match: (d) => d.category === 'Sniper' },
    { label: 'Heavy', match: (d) => d.category === 'Heavy' },
    { label: 'Spray Can', match: (d) => d.kind === 'tool' },
    { label: 'Drugs', match: (d) => d.kind === 'drug' }
]);

const R_OUT = 230, R_IN = 82;

const CSS = `
#ww-hud { display: flex; align-items: center; gap: 10px; justify-content: center; }
#ww-hud img { width: 84px; height: 34px; object-fit: contain; }
#ww-hud .ww-name { font-weight: 700; font-size: 14px; }
#ww-hud .ww-ammo { font-weight: 700; font-size: 18px; margin-left: 4px; }
#ww-hud .ww-ammo.low { color: #ff6b5b; }
#ww-hud .ww-mode { font-size: 11px; opacity: 0.7; text-transform: uppercase; margin-left: 4px; }
#ww-reload { height: 3px; margin: 4px auto 0; width: 200px; background: rgba(255,255,255,0.15); border-radius: 2px; overflow: hidden; display: none; }
#ww-reload > div { height: 100%; width: 0; background: #ffc04d; }
#ww-overlay { position: fixed; inset: 0; z-index: 320; display: none; user-select: none;
    background: radial-gradient(circle at 50% 40%, rgba(0,0,0,0.35), rgba(0,0,0,0.7));
    font-family: var(--ui-font, Arial, sans-serif); color: var(--ui-fg, #fff); }
#ww-wheel { position: absolute; left: 50%; top: 16px; width: ${R_OUT * 2}px; height: ${R_OUT * 2}px; transform-origin: 50% 0; transform: translateX(-50%); }
#ww-wheel svg { position: absolute; inset: 0; overflow: visible; }
#ww-wheel path { fill: rgba(10,12,16,0.72); stroke: rgba(255,255,255,0.18); stroke-width: 1.5; cursor: pointer; }
#ww-wheel path.hover { fill: rgba(255,192,77,0.32); stroke: #ffc04d; }
#ww-wheel path.held { stroke: #ffffff; stroke-width: 2.5; }
#ww-wheel path.empty { fill: rgba(10,12,16,0.35); }
.ww-seg { position: absolute; width: 112px; transform: translate(-50%, -50%); text-align: center; pointer-events: none; }
.ww-seg img { width: 100px; height: 40px; object-fit: contain; display: block; margin: 0 auto; }
.ww-seg .ww-cat { font-size: 10px; letter-spacing: 1.2px; text-transform: uppercase; opacity: 0.65; }
.ww-seg .ww-gun { font-size: 12px; font-weight: 700; white-space: nowrap; }
.ww-seg .ww-idx { font-size: 10px; opacity: 0.6; }
#ww-center { position: absolute; left: 50%; top: 50%; width: ${R_IN * 2 - 10}px; transform: translate(-50%, -50%); text-align: center; pointer-events: none; }
#ww-center .ww-cname { font-size: 13px; font-weight: 700; }
#ww-center .ww-cammo { font-size: 18px; font-weight: 700; margin-top: 2px; }
#ww-center .ww-cstats { font-size: 10px; opacity: 0.7; margin-top: 3px; }
#ww-hint { position: absolute; left: 50%; transform: translateX(-50%); font-size: 12px; opacity: 0.75; white-space: nowrap; }
#ww-inv { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); width: min(1240px, calc(100vw - 32px));
    box-sizing: border-box; background: rgba(0,0,0,0.82); border-radius: 8px; padding: 8px 10px; }
#ww-inv h3 { margin: 0 0 6px; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; opacity: 0.8; }
#ww-inv .ww-grid { display: flex; flex-wrap: wrap; gap: 3px; justify-content: center; }
.ww-slot { position: relative; width: 54px; height: 34px; border-radius: 5px; background: rgba(255,255,255,0.06);
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12); cursor: pointer; }
.ww-slot.ammo { cursor: default; background: rgba(127,211,107,0.08); }
.ww-slot.hover { box-shadow: inset 0 0 0 2px #ffc04d; }
.ww-slot.held { box-shadow: inset 0 0 0 2px #fff; }
.ww-slot img { position: absolute; left: 3px; top: 3px; width: 48px; height: 20px; object-fit: contain; }
.ww-slot span { position: absolute; right: 4px; bottom: 1px; font-size: 10px; font-weight: 700; }
.ww-slot span.empty { color: #ff6b5b; }
#ww-cursor { position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%;
    background: #fff; box-shadow: 0 0 0 2px rgba(0,0,0,0.6); pointer-events: none; }
body.is-mobile #ww-cursor { display: none; }
`;

const SVG_NS = 'http://www.w3.org/2000/svg';

function sectorPath(i, n) {
    const a0 = -Math.PI / 2 + ((i - 0.5) / n) * Math.PI * 2 + 0.015;
    const a1 = -Math.PI / 2 + ((i + 0.5) / n) * Math.PI * 2 - 0.015;
    const c = R_OUT;
    const p = (r, a) => `${(c + Math.cos(a) * r).toFixed(1)} ${(c + Math.sin(a) * r).toFixed(1)}`;
    return `M ${p(R_IN, a0)} L ${p(R_OUT, a0)} A ${R_OUT} ${R_OUT} 0 0 1 ${p(R_OUT, a1)} L ${p(R_IN, a1)} A ${R_IN} ${R_IN} 0 0 0 ${p(R_IN, a0)} Z`;
}

export class WeaponWheel {
    /**
     * @param {Object} opts
     * @param {Inventory} opts.inventory
     * @param {HTMLElement} opts.hud element for the bottom weapon HUD
     * @param {Function} opts.reserveFor (gunDef) -> rounds of its ammo carried
     * @param {Function} [opts.onOpenChange] (open)
     */
    constructor(opts) {
        this.inv = opts.inventory;
        this.hud = opts.hud;
        this.reserveFor = opts.reserveFor || (() => 0);
        this.onOpenChange = opts.onOpenChange || null;
        this.isOpen = false;
        this.help = '';
        this.choice = new Array(WHEEL_SEGMENTS.length).fill(-1);   // slot offered by each segment
        this.hoverSeg = -1;
        this.hoverSlot = -1;
        this.cursor = { x: 0, y: 0 };
        this._key = '';
        if (typeof document === 'undefined') return;
        if (!document.getElementById('ww-style')) {
            const st = document.createElement('style');
            st.id = 'ww-style';
            st.textContent = CSS;
            document.head.appendChild(st);
        }
        this._buildOverlay();
        this.inv.onChange(() => this.render(true));
    }

    // ------------------------------------------------------------------ inventory queries

    /** Inventory slots holding weapons of segment i, in slot order. */
    segmentSlots(i) {
        const seg = WHEEL_SEGMENTS[i];
        const out = [];
        this.inv.slots.forEach((s, idx) => {
            const d = s && getItemDef(s.id);
            if (d && d.hotbar !== false && seg.match(d)) out.push(idx);
        });
        return out;
    }

    /** The slot segment i offers right now (its last choice, else its first weapon), or -1. */
    segmentSlot(i) {
        const slots = this.segmentSlots(i);
        if (!slots.length) return -1;
        return slots.includes(this.choice[i]) ? this.choice[i] : slots[0];
    }

    segmentOfSlot(slot) {
        const s = this.inv.slots[slot];
        const d = s && getItemDef(s.id);
        if (!d) return 0;
        return Math.max(0, WHEEL_SEGMENTS.findIndex((g) => g.match(d)));
    }

    /**
     * Number keys: hold segment i's weapon; pressing the key of the segment already held moves on
     * to the next weapon of that kind.
     * @returns {number} the slot now held, or -1
     */
    selectSegment(i) {
        const slots = this.segmentSlots(i);
        if (!slots.length) return -1;
        let slot = this.segmentSlot(i);
        if (this.segmentOfSlot(this.inv.selected) === i && slots.includes(this.inv.selected)) {
            slot = slots[(slots.indexOf(this.inv.selected) + 1) % slots.length];
        }
        this.choice[i] = slot;
        this.inv.select(slot);
        return slot;
    }

    // ------------------------------------------------------------------ HUD

    setHelp(text) {
        if (text !== this.help) {
            this.help = text;
            this.render(true);
        }
    }

    /** Reload bar: 0..1 while reloading, < 0 hides it. */
    setReload(p) {
        if (!this.reloadBar) return;
        this.reloadBar.parentElement.style.display = p >= 0 ? 'block' : 'none';
        if (p >= 0) this.reloadBar.style.width = `${Math.round(p * 100)}%`;
    }

    _ammoText(stack, def) {
        return `${stack.data.mag} / ${this.reserveFor(def)}`;
    }

    /** Redraws the bottom HUD (only when something on it changed, unless forced). */
    render(force = false) {
        if (!this.hud) return;
        const held = this.inv.selectedItem();
        const def = held ? getItemDef(held.id) : getItemDef('hands');
        const isGun = def && def.kind === 'gun';
        const isDrug = def && def.kind === 'drug';
        const key = `${def ? def.id : ''}|${isGun ? this._ammoText(held, def) : ''}|${isDrug ? held.count : ''}|${held ? held.data.mode : ''}|${this.help}`;
        if (!force && key === this._key) return;
        this._key = key;
        const row = document.createElement('div');
        row.id = 'ww-hud';
        const img = document.createElement('img');
        img.src = itemIcon(def ? def.id : 'hands', 168, 68);
        img.alt = '';
        const name = document.createElement('span');
        name.className = 'ww-name';
        name.textContent = def ? def.name : 'Hands';
        row.append(img, name);
        if (isGun) {
            const ammo = document.createElement('span');
            ammo.className = 'ww-ammo' + (held.data.mag <= Math.ceil(def.magSize * 0.25) ? ' low' : '');
            ammo.textContent = this._ammoText(held, def);
            const mode = document.createElement('span');
            mode.className = 'ww-mode';
            mode.textContent = held.data.mode || def.mode;
            row.append(ammo, mode);
        } else if (isDrug) {
            const left = document.createElement('span');
            left.className = 'ww-ammo';
            left.textContent = `× ${held.count}`;
            row.appendChild(left);
        }
        const reload = document.createElement('div');
        reload.id = 'ww-reload';
        const fill = document.createElement('div');
        reload.appendChild(fill);
        this.reloadBar = fill;
        const help = document.createElement('div');
        help.className = 'weapon-help';
        help.textContent = this.help;
        this.hud.replaceChildren(row, reload, help);
        if (this.isOpen) this._renderOverlay();
    }

    // ------------------------------------------------------------------ wheel

    _buildOverlay() {
        const o = document.createElement('div');
        o.id = 'ww-overlay';
        const wheel = document.createElement('div');
        wheel.id = 'ww-wheel';
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', `0 0 ${R_OUT * 2} ${R_OUT * 2}`);
        this.paths = WHEEL_SEGMENTS.map((_, i) => {
            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('d', sectorPath(i, WHEEL_SEGMENTS.length));
            path.addEventListener('mouseenter', () => this._hover(i, -1));
            path.addEventListener('click', (e) => {
                e.stopPropagation();
                this._hover(i, -1);
                this.close(true);
            });
            path.addEventListener('wheel', (e) => {
                e.preventDefault();
                this.scroll(e.deltaY > 0 ? 1 : -1);
            }, { passive: false });
            svg.appendChild(path);
            return path;
        });
        wheel.appendChild(svg);
        this.segEls = WHEEL_SEGMENTS.map((_, i) => {
            const el = document.createElement('div');
            el.className = 'ww-seg';
            const a = -Math.PI / 2 + (i / WHEEL_SEGMENTS.length) * Math.PI * 2;
            const r = (R_IN + R_OUT) / 2 + 4;
            el.style.left = `${R_OUT + Math.cos(a) * r}px`;
            el.style.top = `${R_OUT + Math.sin(a) * r}px`;
            wheel.appendChild(el);
            return el;
        });
        this.centerEl = document.createElement('div');
        this.centerEl.id = 'ww-center';
        wheel.appendChild(this.centerEl);
        this.wheelEl = wheel;
        const hint = document.createElement('div');
        hint.id = 'ww-hint';
        hint.textContent = 'Point at a weapon · scroll to switch within a kind · release Tab or click to equip';
        const inv = document.createElement('div');
        inv.id = 'ww-inv';
        this.invEl = inv;
        this.cursorEl = document.createElement('div');
        this.cursorEl.id = 'ww-cursor';
        o.append(wheel, hint, inv, this.cursorEl);
        this.hintEl = hint;
        window.addEventListener('resize', () => { if (this.isOpen) this._layout(); });
        o.addEventListener('mousedown', (e) => e.stopPropagation());
        o.addEventListener('mousemove', (e) => {
            if (!document.pointerLockElement) this.setCursor(e.clientX, e.clientY);
        });
        // A click on the backdrop (not on a weapon) just closes the wheel
        o.addEventListener('click', (e) => {
            if (e.target === o) this.close(false);
        });
        document.body.appendChild(o);
        this.overlay = o;
    }

    open() {
        if (!this.overlay || this.isOpen) return;
        this.isOpen = true;
        this.overlay.style.display = 'block';
        this._renderOverlay();
        this._layout();
        // Start with the held weapon highlighted
        const seg = this.segmentOfSlot(this.inv.selected);
        if (this.inv.selectedItem()) this.choice[seg] = this.inv.selected;
        const r = this.wheelEl.getBoundingClientRect();
        this.cursor.x = r.left + r.width / 2;
        this.cursor.y = r.top + r.height / 2;
        this.hoverSeg = -1;
        this.hoverSlot = -1;
        this._renderOverlay();
        this._placeCursor();
        if (this.onOpenChange) this.onOpenChange(true);
    }

    /** Closes the wheel, holding the highlighted weapon if `equip`. */
    close(equip = true) {
        if (!this.isOpen) return;
        if (equip) {
            let slot = -1;
            if (this.hoverSlot >= 0) slot = this.hoverSlot;
            else if (this.hoverSeg >= 0) slot = this.segmentSlot(this.hoverSeg);
            if (slot >= 0) {
                this.choice[this.segmentOfSlot(slot)] = slot;
                this.inv.select(slot);
            }
        }
        this.isOpen = false;
        this.overlay.style.display = 'none';
        if (this.onOpenChange) this.onOpenChange(false);
    }

    toggle() {
        if (this.isOpen) this.close(true);
        else this.open();
    }

    /** Wheel at the top, sized to the room left above the inventory along the bottom. */
    _layout() {
        const invH = this.invEl.getBoundingClientRect().height;
        const room = Math.min(window.innerHeight - invH - 16 - 16 - 40, window.innerWidth - 32);
        const scale = Math.max(0.45, Math.min(1, room / (R_OUT * 2)));
        this.wheelEl.style.transform = `translateX(-50%) scale(${scale})`;
        this.hintEl.style.top = `${16 + R_OUT * 2 * scale + 8}px`;
    }

    /** Pointer-locked mouse movement moves the wheel's own cursor. */
    moveCursor(dx, dy) {
        if (!this.isOpen) return;
        this.cursor.x = Math.max(0, Math.min(window.innerWidth, this.cursor.x + dx));
        this.cursor.y = Math.max(0, Math.min(window.innerHeight, this.cursor.y + dy));
        this._placeCursor();
        this._hoverFromCursor();
    }

    setCursor(x, y) {
        this.cursor.x = x;
        this.cursor.y = y;
        this._placeCursor();
        this._hoverFromCursor();
    }

    /** Scroll wheel: the hovered segment offers its next / previous weapon. */
    scroll(delta) {
        const i = this.hoverSeg >= 0 ? this.hoverSeg : this.segmentOfSlot(this.inv.selected);
        const slots = this.segmentSlots(i);
        if (slots.length < 2) return;
        const cur = slots.indexOf(this.segmentSlot(i));
        this.choice[i] = slots[(cur + delta + slots.length) % slots.length];
        this.hoverSeg = i;
        this.hoverSlot = -1;
        this._renderOverlay();
    }

    /** Mouse click while open: hold what's highlighted. */
    click() {
        this.close(true);
    }

    _placeCursor() {
        if (this.cursorEl) {
            this.cursorEl.style.left = `${this.cursor.x}px`;
            this.cursorEl.style.top = `${this.cursor.y}px`;
        }
    }

    _hoverFromCursor() {
        const r = this.wheelEl.getBoundingClientRect();
        const scale = r.width / (R_OUT * 2);
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const dx = this.cursor.x - cx, dy = this.cursor.y - cy;
        const d = Math.hypot(dx, dy) / scale;
        let seg = -1, slot = -1;
        if (d > R_IN * 0.6 && d < R_OUT * 1.35) {
            const a = Math.atan2(dy, dx) + Math.PI / 2;
            const n = WHEEL_SEGMENTS.length;
            seg = ((Math.round((a / (Math.PI * 2)) * n) % n) + n) % n;
        } else if (d >= R_OUT * 1.35) {
            for (const el of this.invEl.querySelectorAll('.ww-slot[data-slot]')) {
                const b = el.getBoundingClientRect();
                if (this.cursor.x >= b.left && this.cursor.x <= b.right && this.cursor.y >= b.top && this.cursor.y <= b.bottom) {
                    slot = +el.dataset.slot;
                    break;
                }
            }
        }
        // Moving the cursor off everything keeps the last highlight (like a flicked stick)
        if (seg >= 0 || slot >= 0) this._hover(seg, slot);
    }

    _hover(seg, slot) {
        if (seg === this.hoverSeg && slot === this.hoverSlot) return;
        this.hoverSeg = seg;
        this.hoverSlot = slot;
        this._renderOverlay();
    }

    _renderOverlay() {
        if (!this.overlay) return;
        const held = this.inv.selected;
        WHEEL_SEGMENTS.forEach((seg, i) => {
            const slot = this.segmentSlot(i);
            const slots = this.segmentSlots(i);
            const path = this.paths[i];
            path.classList.toggle('hover', i === this.hoverSeg && this.hoverSlot < 0);
            path.classList.toggle('held', slot >= 0 && slot === held);
            path.classList.toggle('empty', slot < 0);
            const el = this.segEls[i];
            el.replaceChildren();
            const cat = document.createElement('div');
            cat.className = 'ww-cat';
            cat.textContent = seg.label;
            el.appendChild(cat);
            if (slot < 0) return;
            const st = this.inv.slots[slot];
            const def = getItemDef(st.id);
            const img = document.createElement('img');
            img.src = itemIcon(def.id, 200, 80);
            img.alt = '';
            const name = document.createElement('div');
            name.className = 'ww-gun';
            name.textContent = def.name;
            el.append(img, name);
            if (slots.length > 1) {
                const idx = document.createElement('div');
                idx.className = 'ww-idx';
                idx.textContent = `${slots.indexOf(slot) + 1} / ${slots.length}`;
                el.appendChild(idx);
            }
        });

        // Centre: what release / click would hold
        let focus = -1;
        if (this.hoverSlot >= 0) focus = this.hoverSlot;
        else if (this.hoverSeg >= 0) focus = this.segmentSlot(this.hoverSeg);
        else focus = held;
        const st = focus >= 0 ? this.inv.slots[focus] : null;
        const def = st ? getItemDef(st.id) : getItemDef('hands');
        this.centerEl.replaceChildren();
        const cn = document.createElement('div');
        cn.className = 'ww-cname';
        cn.textContent = def.name;
        this.centerEl.appendChild(cn);
        if (def.kind === 'gun') {
            const ca = document.createElement('div');
            ca.className = 'ww-cammo';
            ca.textContent = this._ammoText(st, def);
            const cs = document.createElement('div');
            cs.className = 'ww-cstats';
            cs.textContent = `${def.damage}${def.pellets > 1 ? '×' + def.pellets : ''} dmg · ${Math.round(60000 / def.fireRate)} rpm · ${def.mode}`;
            this.centerEl.append(ca, cs);
        } else if (def.kind === 'drug') {
            const ca = document.createElement('div');
            ca.className = 'ww-cammo';
            ca.textContent = `× ${st.count}`;
            const cs = document.createElement('div');
            cs.className = 'ww-cstats';
            cs.textContent = def.desc || '';
            this.centerEl.append(ca, cs);
        }

        // Inventory along the bottom: every weapon (click to hold), then the ammo
        const title = document.createElement('h3');
        title.textContent = 'Inventory';
        const grid = document.createElement('div');
        grid.className = 'ww-grid';
        const entries = this.inv.slots.map((s, idx) => [s, idx]).filter(([s]) => s);
        entries.sort(([a], [b]) => (getItemDef(a.id).kind === 'ammo') - (getItemDef(b.id).kind === 'ammo'));
        for (const [s, idx] of entries) {
            const d = getItemDef(s.id);
            const el = document.createElement('div');
            const ammo = d.kind === 'ammo';
            el.className = 'ww-slot' + (ammo ? ' ammo' : '') + (idx === held ? ' held' : '') + (idx === this.hoverSlot ? ' hover' : '');
            el.title = ammo ? `${d.name} × ${s.count}` : d.name;
            const img = document.createElement('img');
            img.src = itemIcon(d.id, 112, 48);
            img.alt = '';
            el.appendChild(img);
            const count = ammo || d.kind === 'drug' ? s.count : (d.kind === 'gun' ? s.data.mag : null);
            if (count !== null) {
                const c = document.createElement('span');
                if (!ammo && count === 0) c.className = 'empty';
                c.textContent = count;
                el.appendChild(c);
            }
            if (!ammo) {
                el.dataset.slot = idx;
                el.addEventListener('mouseenter', () => this._hover(-1, idx));
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._hover(-1, idx);
                    this.close(true);
                });
            }
            grid.appendChild(el);
        }
        this.invEl.replaceChildren(title, grid);
    }
}
