/**
 * Map editor (game.html?mapedit=1, then Dev menu > Map editor). Fly around (F12 camera), aim the crosshair at
 * an object of the map and use the keys listed in the panel to scale / move / copy / place / delete it.
 * Changes show as boxes (the merged map meshes can't be edited live); Save rewrites the OBJ parts in
 * mapfinal/ through POST /api/mapedit (js/game/mapEditCore.js) and reloads the page.
 *
 * Objects are the loader's editBlocks: { part, ord, name, box: [minX, minY, minZ, maxX, maxY, maxZ] } in world space.
 * Entities the game places itself (gas stations, street signs, road signs) are added as blocks with an
 * `entity` field ({ type, index | key }), a `pivot` [x, z] and optionally `rotStep`; they are saved to their
 * data files instead of the OBJ parts.
 */
import * as THREE from 'three';

const RANGE = 400;
const COLORS = { hover: 0x44ddff, selected: 0xffee33, moved: 0xff9933, copy: 0x44ff66, deleted: 0xff3333 };

export class MapEditor {
    constructor({ scene, camera, blocks, tiles, ensureFlyCam, getEntities, onActive }) {
        this.getEntities = getEntities;
        this.onActive = onActive;
        this.scene = scene;
        this.camera = camera;
        this.blocks = blocks;
        this.tiles = tiles || [];
        this.ensureFlyCam = ensureFlyCam;
        this.active = false;
        this.items = [];      // edits: { kind: 'orig' | 'copy', block, s, d, deleted }
        this.sel = null;
        this.hover = null;    // { block } or { item }
        this.clip = null;     // { block, s }
        this.step = 1;
        this.undoStack = [];
        this.group = new THREE.Group();
        this.group.name = 'map_editor';
        scene.add(this.group);
        this._hoverTimer = 0;
        this._ray = new THREE.Raycaster();
        this._dir = new THREE.Vector3();
        this._buildPanel();
        window.addEventListener('keydown', (e) => this._key(e), true);
        window.addEventListener('mousedown', (e) => this._mouse(e), true);
        this.setActive(false);
    }

    setActive(on) {
        this.active = on;
        this.panel.style.display = on ? 'block' : 'none';
        this.group.visible = on;
        if (on) {
            if (!this._entitiesAdded && this.getEntities) {
                this._entitiesAdded = true;
                for (const e of this.getEntities()) this.blocks.push(e);
            }
            this.ensureFlyCam();
            this._status('Aim at an object and click to select it');
        }
        if (this.onActive) this.onActive(on);
        this._refresh();
    }

    // ---- geometry helpers ----
    _pivot(b) { return b.pivot ? [b.pivot[0], b.box[1], b.pivot[1]] : [(b.box[0] + b.box[3]) / 2, b.box[1], (b.box[2] + b.box[5]) / 2]; }

    _boxOf(it) {
        const b = it.block.box, p = this._pivot(it.block), s = it.s, d = it.d;
        const c = Math.cos(it.r), sn = Math.sin(it.r);
        const box = new THREE.Box3();
        for (const x of [b[0], b[3]]) for (const z of [b[2], b[5]]) {
            const ax = (x - p[0]) * s, az = (z - p[2]) * s;
            box.expandByPoint(new THREE.Vector3(p[0] + ax * c + az * sn + d[0], p[1] + (b[1] - p[1]) * s + d[1], p[2] - ax * sn + az * c + d[2]));
            box.expandByPoint(new THREE.Vector3(p[0] + ax * c + az * sn + d[0], p[1] + (b[4] - p[1]) * s + d[1], p[2] - ax * sn + az * c + d[2]));
        }
        return box;
    }

    _itemFor(block) { return this.items.find((it) => it.kind === 'orig' && it.block === block); }

    /** Nearest object under the crosshair: a copy's box, or one of the map's objects (not the ones deleted). */
    _pick() {
        const o = this.camera.position;
        const dir = this.camera.getWorldDirection(this._dir);
        const slab = (min, max) => {
            let t0 = 0.5, t1 = RANGE;
            for (let a = 0; a < 3; a++) {
                const oa = a === 0 ? o.x : a === 1 ? o.y : o.z, da = a === 0 ? dir.x : a === 1 ? dir.y : dir.z;
                const lo = min[a] - 0.15, hi = max[a] + 0.15;
                if (Math.abs(da) < 1e-9) { if (oa < lo || oa > hi) return -1; continue; }
                let ta = (lo - oa) / da, tb = (hi - oa) / da;
                if (ta > tb) { const t = ta; ta = tb; tb = t; }
                if (ta > t0) t0 = ta;
                if (tb < t1) t1 = tb;
                if (t0 > t1) return -1;
            }
            return t0;
        };
        let best = null, bestT = Infinity, bestVol = Infinity;
        const consider = (t, vol, hit) => {
            if (t < 0) return;
            if (t < bestT - 0.5 || (Math.abs(t - bestT) <= 0.5 && vol < bestVol)) { best = hit; bestT = t; bestVol = vol; }
        };
        for (const it of this.items) {
            if (it.deleted) continue;
            const bx = this._boxOf(it);
            const v = bx.max.clone().sub(bx.min);
            consider(slab([bx.min.x, bx.min.y, bx.min.z], [bx.max.x, bx.max.y, bx.max.z]), v.x * v.y * v.z, { item: it });
        }
        const edited = new Set(this.items.filter((i) => i.kind === 'orig').map((i) => i.block));
        for (const block of this.blocks) {
            if (edited.has(block)) continue;
            const b = block.box;
            const t = slab([b[0], b[1], b[2]], [b[3], b[4], b[5]]);
            if (t >= 0 && t <= bestT + 0.5) consider(t, (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2]), { block });
        }
        return best;
    }

    _groundPoint() {
        this._ray.set(this.camera.position, this.camera.getWorldDirection(this._dir));
        this._ray.far = RANGE;
        const hits = this._ray.intersectObjects(this.tiles, false);
        return hits.length ? hits[0].point : null;
    }

    // ---- input ----
    _mouse(e) {
        if (!this.active || e.target.closest?.('#map-editor')) return;
        e.stopImmediatePropagation();
        if (e.button !== 0) return;
        const hit = this._pick();
        if (!hit) { this.sel = null; this._status('Nothing there'); }
        else if (hit.item) this.sel = hit.item;
        else this.sel = this._itemFor(hit.block) || this._newItem('orig', hit.block);
        if (this.sel && !this.items.includes(this.sel)) this.items.push(this.sel);
        if (this.sel) this._status(`Selected ${this.sel.block.name} (${this.sel.block.part})`);
        this._refresh();
    }

    _newItem(kind, block, s = 1, d = [0, 0, 0], r = 0) { return { kind, block, s, d, r, deleted: false }; }

    _snapshot() {
        this.undoStack.push(JSON.stringify(this.items.map((i) => ({ k: i.kind, b: this.blocks.indexOf(i.block), s: i.s, d: i.d, r: i.r, x: i.deleted }))));
        if (this.undoStack.length > 100) this.undoStack.shift();
    }

    _undo() {
        const snap = this.undoStack.pop();
        if (!snap) return this._status('Nothing to undo');
        this.items = JSON.parse(snap).map((r) => ({ kind: r.k, block: this.blocks[r.b], s: r.s, d: r.d, r: r.r, deleted: r.x }));
        this.sel = null;
        this._status('Undone');
        this._refresh();
    }

    _key(e) {
        if (!this.active || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
        const k = e.key.toLowerCase();
        const sel = this.sel;
        const consume = () => { e.preventDefault(); e.stopImmediatePropagation(); };
        if (e.ctrlKey && k === 's') { consume(); this.save(); return; }
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        if (k === 'z') { consume(); this._undo(); return; }
        if (k === ',' || k === '.') {
            consume();
            const steps = [0.1, 0.5, 1, 5, 10];
            const i = Math.max(0, steps.indexOf(this.step)) + (k === '.' ? 1 : -1);
            this.step = steps[Math.min(steps.length - 1, Math.max(0, i))];
            this._status(`Step ${this.step} m`);
            return;
        }
        if (k === 'c') { consume(); if (sel) { if (sel.block.entity?.type === 'roadSign') return this._status('Road signs can be moved, turned and deleted, not copied'); this.clip = { block: sel.block, s: sel.s, r: sel.r }; this._status(`Copied ${sel.block.name}`); } return; }
        if (k === 'v') {
            consume();
            if (!this.clip) return this._status('Copy something first (C)');
            const p = this._groundPoint();
            if (!p) return this._status('Aim at the ground to place');
            this._snapshot();
            const c = this._pivot(this.clip.block);
            const item = this._newItem('copy', this.clip.block, this.clip.s, [p.x - c[0], p.y - c[1], p.z - c[2]], this.clip.r);
            this.items.push(item);
            this.sel = item;
            this._status(`Placed ${item.block.name}`);
            this._refresh();
            return;
        }
        if (!sel) return;
        if (k === 'x' || k === 'delete') {
            consume();
            this._snapshot();
            if (sel.kind === 'copy') this.items.splice(this.items.indexOf(sel), 1);
            else sel.deleted = true;
            this.sel = null;
            this._status('Deleted');
        } else if (k === 'r' || k === 't') {
            consume();
            this._snapshot();
            const deg = { 0.1: 1, 0.5: 5, 1: 15, 5: 45, 10: 90 }[this.step] || 15;
            const a = Math.max(deg * Math.PI / 180, sel.block.rotStep || 0);
            sel.r = +(sel.r + (k === 'r' ? a : -a)).toFixed(5);
            this._status(`Turned ${Math.round(sel.r * 180 / Math.PI)}°`);
        } else if ((k === '[' || k === ']') && sel.block.entity) {
            consume();
            return this._status('Signs and gas stations cannot be scaled');
        } else if (k === '[' || k === ']') {
            consume();
            this._snapshot();
            sel.s = Math.max(0.05, +(sel.s * (k === ']' ? 1.1 : 1 / 1.1)).toFixed(4));
            this._status(`Scale ${sel.s}`);
        } else if (['i', 'j', 'k', 'l', 'u', 'o'].includes(k)) {
            consume();
            const f = this.camera.getWorldDirection(this._dir);
            // Camera-relative on the ground plane, snapped to the nearest axis
            const fwd = Math.abs(f.x) > Math.abs(f.z) ? [Math.sign(f.x), 0] : [0, Math.sign(f.z)];
            const right = [-fwd[1], fwd[0]];
            if (sel.block.entity && (k === 'u' || k === 'o')) return;
            const v = { i: [fwd[0], 0, fwd[1]], k: [-fwd[0], 0, -fwd[1]], l: [right[0], 0, right[1]], j: [-right[0], 0, -right[1]], u: [0, 1, 0], o: [0, -1, 0] }[k];
            if (!v) return;
            this._snapshot();
            for (let a = 0; a < 3; a++) sel.d[a] = +(sel.d[a] + v[a] * this.step).toFixed(4);
        } else return;
        this._refresh();
    }

    // ---- display ----
    update(dt) {
        if (!this.active) return;
        this._hoverTimer -= dt;
        if (this._hoverTimer > 0) return;
        this._hoverTimer = 0.1;
        const h = this._pick();
        const key = h ? (h.item || h.block) : null;
        if (key !== this._hoverKey) { this._hoverKey = key; this.hover = h; this._refresh(); }
    }

    _refresh() {
        for (const c of this.group.children.slice()) { this.group.remove(c); c.geometry?.dispose(); c.material?.dispose(); }
        if (!this.active) return;
        const add = (box, color) => {
            const h = new THREE.Box3Helper(box, color);
            h.material.depthTest = false;
            h.renderOrder = 999;
            this.group.add(h);
        };
        for (const it of this.items) {
            const changed = this._changed(it);
            if (!changed && it !== this.sel) continue;
            if (it === this.sel) add(this._boxOf(it), COLORS.selected);
            else add(this._boxOf(it), it.deleted ? COLORS.deleted : it.kind === 'copy' ? COLORS.copy : COLORS.moved);
            if (it.kind === 'orig' && !it.deleted && changed) {
                const b = it.block.box;
                add(new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5])), COLORS.deleted); // where it was
            }
        }
        const h = this.hover;
        if (h && h.block) {
            const b = h.block.box;
            add(new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5])), COLORS.hover);
        } else if (h && h.item && h.item !== this.sel) add(this._boxOf(h.item), COLORS.hover);
        const n = this.items.filter((i) => this._changed(i)).length;
        this.count.textContent = `${n} pending change${n === 1 ? '' : 's'} · step ${this.step} m` + (this.clip ? ` · clipboard: ${this.clip.block.name}` : '');
    }

    _changed(i) { return i.kind === 'copy' || i.deleted || i.s !== 1 || i.r !== 0 || i.d.some((x) => x !== 0); }

    _status(t) { if (this.statusEl) this.statusEl.textContent = t; }

    _buildPanel() {
        const p = document.createElement('div');
        p.id = 'map-editor';
        p.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:50;background:rgba(10,14,20,.85);color:#e8eef6;font:12px/1.5 monospace;padding:10px 12px;border-radius:6px;max-width:330px;pointer-events:auto';
        p.innerHTML = '<b>MAP EDITOR</b> <span style="opacity:.6">(fly with WASD / Space / Shift)</span><br>' +
            'Click select · <b>[ ]</b> scale · <b>R T</b> turn · <b>I J K L</b> move · <b>U O</b> up/down · <b>, .</b> step<br>' +
            '<b>C</b> copy · <b>V</b> place at crosshair · <b>X</b>/Del delete · <b>Z</b> undo<br>' +
            '<span id="me-count"></span><br><span id="me-status" style="color:#9fd"></span><br>' +
            '<button id="me-save">Save to map files (Ctrl+S)</button> <button id="me-discard">Discard</button> <button id="me-close">Close</button>';
        document.body.appendChild(p);
        this.panel = p;
        this.count = p.querySelector('#me-count');
        this.statusEl = p.querySelector('#me-status');
        p.querySelector('#me-save').onclick = () => this.save();
        p.querySelector('#me-discard').onclick = () => { this._snapshot(); this.items = []; this.sel = null; this._refresh(); this._status('Discarded'); };
        p.querySelector('#me-close').onclick = () => this.setActive(false);
    }

    // ---- save ----
    async save() {
        const ops = [], entityOps = [];
        for (const it of this.items) {
            if (!this._changed(it)) continue;
            const e = it.block.entity;
            if (e) {
                const file = { gas: 'gasStations', streetSign: 'streetSigns', roadSign: 'roadSignEdits' }[e.type];
                const op = { file, dx: it.d[0], dz: it.d[2], dyaw: it.r };
                if (e.type === 'roadSign') op.key = e.key; else if (it.kind === 'copy') { op.add = true; op.src = e.index; } else op.index = e.index;
                if (it.deleted) op.deleted = true;
                entityOps.push(op);
                continue;
            }
            const { part, ord } = it.block;
            if (it.kind === 'orig') ops.push({ part, ord, type: 'delete' });
            if (!it.deleted) ops.push({ part, ord, type: 'put', s: it.s, r: it.r, d: it.d });
        }
        if (!ops.length && !entityOps.length) return this._status('Nothing to save');
        this._status('Saving...');
        try {
            const r = await fetch('/api/mapedit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops, entityOps }) });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || r.status);
            try { sessionStorage.setItem('mapedit.reload', JSON.stringify(j.parts)); } catch (e) { /* the browser may keep the old copy for a day */ }
            this._status(`Saved ${j.parts.length} map file(s). Reloading...`);
            setTimeout(() => location.reload(), 600);
        } catch (e) {
            this._status('Save failed: ' + e.message);
        }
    }
}
