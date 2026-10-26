/**
 * js/game/mermaid/mermaidUI.js
 *
 * The DOM side of Mermaid World: fades, the mermaid creator, the task list, interaction prompts,
 * fish dialogue, captions, the wedding planner and the mall's shops. Everything lives under one
 * #mermaid-ui root that sits above the game's own HUD (which is hidden while the trip lasts).
 */

import {
    HAIR_STYLES, HAIR_COLORS, SKIN_TONES, EYE_COLORS, EYE_SHAPES, LIPSTICKS, EYESHADOWS, TAIL_COLORS, TOPS, TOP_COLORS,
    ACCESSORIES, randomLook
} from './mermaidData.js';

const CSS = `
body.mermaid-mode > *:not(canvas):not(#mermaid-ui) { visibility: hidden !important; }
#mermaid-ui { position: fixed; inset: 0; z-index: 900; pointer-events: none; font-family: 'Trebuchet MS', 'Segoe UI', sans-serif; color: #fff; }
#mermaid-ui * { box-sizing: border-box; }
#mermaid-ui .mw-panel { pointer-events: auto; background: linear-gradient(160deg, rgba(20,90,140,0.82), rgba(120,60,150,0.78)); border: 1px solid rgba(255,255,255,0.35);
    border-radius: 18px; box-shadow: 0 10px 40px rgba(0,20,60,0.45), inset 0 1px 0 rgba(255,255,255,0.25); backdrop-filter: blur(6px); }
#mermaid-ui h2 { margin: 0 0 4px; font-size: 22px; letter-spacing: 0.5px; text-shadow: 0 2px 6px rgba(0,0,0,0.35); }
#mermaid-ui h3 { margin: 12px 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: 1.5px; opacity: 0.85; }
#mermaid-ui .mw-sub { font-size: 13px; opacity: 0.85; margin-bottom: 8px; }
#mermaid-ui button { pointer-events: auto; font: inherit; color: #fff; cursor: pointer; border: 1px solid rgba(255,255,255,0.45); background: rgba(255,255,255,0.12);
    border-radius: 12px; padding: 7px 12px; margin: 3px; font-size: 13px; transition: background 0.15s, transform 0.1s; }
#mermaid-ui button:hover { background: rgba(255,255,255,0.28); }
#mermaid-ui button:active { transform: scale(0.97); }
#mermaid-ui button.on { background: linear-gradient(135deg, #ff9ff3, #48dbfb); border-color: #fff; color: #1b1b3a; font-weight: 700; }
#mermaid-ui button.big { font-size: 17px; padding: 11px 22px; font-weight: 700; background: linear-gradient(135deg, #ff7eb3, #7afcff); color: #20124d; border: none; }
#mermaid-ui button:disabled { opacity: 0.4; cursor: default; }
#mermaid-ui .mw-swatches { display: flex; flex-wrap: wrap; gap: 6px; }
#mermaid-ui .mw-sw { width: 28px; height: 28px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.5); cursor: pointer; pointer-events: auto; position: relative; }
#mermaid-ui .mw-sw.on { border: 3px solid #fff; box-shadow: 0 0 0 2px #ff9ff3, 0 0 12px #fff; }
#mermaid-ui .mw-sw.none::after { content: ''; position: absolute; left: 3px; right: 3px; top: 50%; height: 2px; background: #ff6b81; transform: rotate(-45deg); }
#mermaid-ui .mw-tabs { display: flex; flex-wrap: wrap; margin: 6px 0 4px; }
#mermaid-ui input[type=text] { pointer-events: auto; font: inherit; font-size: 15px; padding: 7px 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.5);
    background: rgba(255,255,255,0.15); color: #fff; width: 100%; }
#mermaid-ui input[type=range] { pointer-events: auto; width: 100%; accent-color: #ff9ff3; }
#mw-fade { position: fixed; inset: 0; background: #000; opacity: 0; transition-property: opacity; pointer-events: none; }
#mw-creator { position: absolute; left: 24px; top: 24px; bottom: 24px; width: 380px; padding: 18px; overflow-y: auto; }
#mw-creator-go { position: absolute; right: 36px; bottom: 36px; }
#mw-tasks { position: absolute; left: 18px; top: 18px; width: 300px; padding: 12px 16px; font-size: 13px; }
#mw-tasks .t { margin: 6px 0 2px; font-weight: 700; font-size: 14px; }
#mw-tasks .t.done { text-decoration: line-through; opacity: 0.65; }
#mw-tasks .s { margin-left: 18px; opacity: 0.85; }
#mw-tasks .s.done { opacity: 0.5; }
#mw-money { position: absolute; right: 18px; top: 18px; padding: 8px 14px; font-weight: 700; font-size: 15px; }
#mw-prompt { position: absolute; left: 50%; bottom: 120px; transform: translateX(-50%); padding: 9px 18px; font-size: 16px; font-weight: 700; display: none; }
#mw-prompt kbd { background: #fff; color: #20124d; border-radius: 6px; padding: 1px 7px; margin-right: 6px; }
#mw-caption { position: absolute; left: 50%; top: 70px; transform: translateX(-50%); font-size: 26px; font-weight: 700; text-align: center;
    text-shadow: 0 2px 10px rgba(0,0,0,0.6), 0 0 22px rgba(255,159,243,0.8); opacity: 0; transition: opacity 0.6s; white-space: pre-line; max-width: 80%; }
#mw-dialog { position: absolute; left: 50%; bottom: 28px; transform: translateX(-50%); width: min(760px, 92%); padding: 16px 22px; display: none; }
#mw-dialog .who { font-weight: 700; font-size: 15px; color: #ffeaa7; margin-bottom: 4px; }
#mw-dialog .what { font-size: 17px; line-height: 1.4; }
#mw-dialog .more { font-size: 12px; opacity: 0.7; text-align: right; margin-top: 6px; }
#mw-help { position: absolute; right: 18px; bottom: 18px; padding: 8px 12px; font-size: 12px; opacity: 0.9; }
#mw-modal { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(820px, 94%); max-height: 88%; overflow-y: auto; padding: 22px; display: none; }
#mw-modal .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; margin: 8px 0; }
#mw-modal .card { pointer-events: auto; cursor: pointer; border-radius: 14px; padding: 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.35); transition: background 0.15s; }
#mw-modal .card:hover { background: rgba(255,255,255,0.22); }
#mw-modal .card.on { background: linear-gradient(135deg, rgba(255,159,243,0.55), rgba(72,219,251,0.55)); border: 2px solid #fff; }
#mw-modal .card .n { font-weight: 700; font-size: 15px; }
#mw-modal .card .d { font-size: 12px; opacity: 0.85; margin-top: 3px; }
#mw-modal .card .p { font-weight: 700; color: #ffeaa7; margin-top: 6px; }
#mw-modal .nav { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; }
#mw-modal .dots span { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: rgba(255,255,255,0.35); margin: 0 3px; }
#mw-modal .dots span.on { background: #fff; }
`;

const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
};

export class MermaidUI {
    constructor() {
        this.root = null;
        this.dialogResolve = null;
        this.modalOpen = false;
        this._captionTimer = 0;
    }

    _build() {
        if (this.root) return;
        const style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);
        const r = el('div');
        r.id = 'mermaid-ui';
        r.style.display = 'none';
        r.innerHTML = `
            <div id="mw-tasks" class="mw-panel" style="display:none"></div>
            <div id="mw-money" class="mw-panel" style="display:none"></div>
            <div id="mw-prompt" class="mw-panel"></div>
            <div id="mw-caption"></div>
            <div id="mw-dialog" class="mw-panel"><div class="who"></div><div class="what"></div><div class="more">E / click to continue</div></div>
            <div id="mw-help" class="mw-panel" style="display:none">WASD swim · Mouse look (click to grab) · Space up · C down · Shift sprint · E interact</div>
            <div id="mw-modal" class="mw-panel"></div>
            <div id="mw-creator" class="mw-panel" style="display:none"></div>
            <div id="mw-creator-go" style="display:none"></div>
            <div id="mw-fade"></div>`;
        document.body.appendChild(r);
        this.root = r;
        this.$ = (id) => r.querySelector('#' + id);
        this.$('mw-dialog').addEventListener('click', () => this.advance());
    }

    show() {
        this._build();
        this.root.style.display = 'block';
        document.body.classList.add('mermaid-mode');
    }

    hide() {
        if (!this.root) return;
        this.root.style.display = 'none';
        document.body.classList.remove('mermaid-mode');
        this.closeModal();
        this.closeCreator();
        this.setPrompt(null);
        this.$('mw-dialog').style.display = 'none';
    }

    /** Fades the screen to `opacity` of `color` over `ms`. */
    fade(opacity, ms = 1000, color = '#000') {
        this._build();
        const f = this.$('mw-fade');
        f.style.background = color;
        f.style.transitionDuration = `${ms}ms`;
        void f.offsetWidth;
        f.style.opacity = String(opacity);
        return new Promise((res) => setTimeout(res, ms));
    }

    showHud(on) {
        for (const id of ['mw-tasks', 'mw-money', 'mw-help']) this.$(id).style.display = on ? 'block' : 'none';
    }

    setTasks(tasks) {
        const t = this.$('mw-tasks');
        t.innerHTML = '<div style="font-weight:700;font-size:15px;margin-bottom:4px">🧜 Mermaid Tasks</div>' + tasks.map((k, i) =>
            `<div class="t ${k.done ? 'done' : ''}">${k.done ? '✅' : `${i + 1}.`} ${k.title}</div>` +
            (k.done ? '' : (k.sub || []).map((s) => `<div class="s ${s.done ? 'done' : ''}">${s.done ? '✔' : '○'} ${s.text}</div>`).join(''))
        ).join('');
    }

    setMoney(n) {
        this.$('mw-money').textContent = `🐚 ${n} sand dollars`;
    }

    setPrompt(text) {
        if (!this.root) return;
        const p = this.$('mw-prompt');
        if (!text) {
            p.style.display = 'none';
            return;
        }
        p.innerHTML = `<kbd>E</kbd>${text}`;
        p.style.display = 'block';
    }

    caption(text, ms = 3000) {
        const c = this.$('mw-caption');
        c.textContent = text;
        c.style.opacity = '1';
        clearTimeout(this._captionTimer);
        this._captionTimer = setTimeout(() => { c.style.opacity = '0'; }, ms);
    }

    get dialogOpen() {
        return !!this.dialogResolve;
    }

    /** Shows a line of dialogue; resolves when the player continues. */
    say(who, what) {
        const d = this.$('mw-dialog');
        d.querySelector('.who').textContent = who;
        d.querySelector('.what').textContent = what;
        d.style.display = 'block';
        return new Promise((res) => { this.dialogResolve = res; });
    }

    advance() {
        if (!this.dialogResolve) return;
        const r = this.dialogResolve;
        this.dialogResolve = null;
        this.$('mw-dialog').style.display = 'none';
        r();
    }

    async conversation(who, lines) {
        for (const l of lines) await this.say(who, l);
    }

    // ---- Creator --------------------------------------------------------------------------------
    openCreator(look, onChange, onDone) {
        this._build();
        const panel = this.$('mw-creator');
        panel.style.display = 'block';
        const go = this.$('mw-creator-go');
        go.style.display = 'block';
        go.innerHTML = '';
        const goBtn = el('button', 'big', 'Dive In! 🌊');
        goBtn.addEventListener('click', () => {
            this.closeCreator();
            onDone(look);
        });
        go.appendChild(goBtn);
        let tab = 'Hair';
        const set = (patch) => {
            Object.assign(look, patch);
            onChange(look);
            render();
        };
        const swatches = (list, current, key) => {
            const w = el('div', 'mw-swatches');
            for (const c of list) {
                const s = el('div', 'mw-sw' + (c === current ? ' on' : '') + (c == null ? ' none' : ''));
                s.style.background = c == null ? 'rgba(255,255,255,0.15)' : hex(c);
                s.title = c == null ? 'None' : hex(c);
                s.addEventListener('click', () => set({ [key]: c }));
                w.appendChild(s);
            }
            return w;
        };
        const buttons = (list, current, key) => {
            const w = el('div');
            for (const o of list) {
                const b = el('button', o.id === current ? 'on' : '', o.name);
                b.addEventListener('click', () => set({ [key]: o.id }));
                w.appendChild(b);
            }
            return w;
        };
        const toggle = (label, key) => {
            const b = el('button', look[key] ? 'on' : '', `${label}: ${look[key] ? 'On' : 'Off'}`);
            b.addEventListener('click', () => set({ [key]: !look[key] }));
            return b;
        };
        const render = () => {
            panel.innerHTML = '';
            panel.appendChild(el('h2', '', '🧜‍♀️ Create Your Mermaid'));
            panel.appendChild(el('div', 'mw-sub', 'Drag on the right to spin her around.'));
            const name = el('input');
            name.type = 'text';
            name.value = look.name;
            name.maxLength = 18;
            name.placeholder = 'Mermaid name';
            name.addEventListener('input', () => { look.name = name.value || 'Mermaid'; });
            panel.appendChild(name);
            const tabs = el('div', 'mw-tabs');
            for (const t of ['Hair', 'Face', 'Makeup', 'Tail', 'Clothes']) {
                const b = el('button', t === tab ? 'on' : '', t);
                b.addEventListener('click', () => { tab = t; render(); });
                tabs.appendChild(b);
            }
            panel.appendChild(tabs);
            const h = (t) => panel.appendChild(el('h3', '', t));
            if (tab === 'Hair') {
                h('Style');
                panel.appendChild(buttons(HAIR_STYLES, look.hairStyle, 'hairStyle'));
                h('Colour');
                panel.appendChild(swatches(HAIR_COLORS, look.hairColor, 'hairColor'));
            } else if (tab === 'Face') {
                h('Skin tone');
                panel.appendChild(swatches(SKIN_TONES, look.skin, 'skin'));
                h('Eye colour');
                panel.appendChild(swatches(EYE_COLORS, look.eyeColor, 'eyeColor'));
                h('Eye shape');
                panel.appendChild(buttons(EYE_SHAPES, look.eyeShape, 'eyeShape'));
                h('Lashes');
                panel.appendChild(toggle('Lashes', 'lashes'));
            } else if (tab === 'Makeup') {
                h('Lipstick');
                panel.appendChild(swatches(LIPSTICKS, look.lipstick, 'lipstick'));
                h('Eyeshadow');
                panel.appendChild(swatches(EYESHADOWS, look.eyeshadow, 'eyeshadow'));
                h('Blush');
                panel.appendChild(toggle('Blush', 'blush'));
            } else if (tab === 'Tail') {
                h(`Tail size (${Math.round(look.tailSize * 100)}%)`);
                const r = el('input');
                r.type = 'range';
                r.min = '0.7';
                r.max = '1.45';
                r.step = '0.01';
                r.value = String(look.tailSize);
                r.addEventListener('input', () => {
                    look.tailSize = parseFloat(r.value);
                    onChange(look);
                    panel.querySelector('h3').textContent = `Tail size (${Math.round(look.tailSize * 100)}%)`;
                });
                panel.appendChild(r);
                h('Tail colour');
                const w = el('div', 'mw-swatches');
                TAIL_COLORS.forEach((tc, i) => {
                    const s = el('div', 'mw-sw' + (i === look.tail ? ' on' : ''));
                    s.style.background = `linear-gradient(180deg, ${hex(tc.a)}, ${hex(tc.b)})`;
                    s.style.width = s.style.height = '34px';
                    s.title = tc.name;
                    s.addEventListener('click', () => set({ tail: i }));
                    w.appendChild(s);
                });
                panel.appendChild(w);
            } else {
                h('Top');
                panel.appendChild(buttons(TOPS, look.top, 'top'));
                h('Top colour');
                panel.appendChild(swatches(TOP_COLORS, look.topColor, 'topColor'));
                h('Accessory');
                panel.appendChild(buttons(ACCESSORIES, look.accessory, 'accessory'));
            }
            const rnd = el('button', '', '🎲 Randomize');
            rnd.style.marginTop = '14px';
            rnd.addEventListener('click', () => {
                const name0 = look.name;
                Object.assign(look, randomLook(), { name: name0 });
                onChange(look);
                render();
            });
            panel.appendChild(rnd);
        };
        render();
    }

    closeCreator() {
        if (!this.root) return;
        this.$('mw-creator').style.display = 'none';
        this.$('mw-creator-go').style.display = 'none';
    }

    // ---- Modal (planner, shops) ------------------------------------------------------------------
    closeModal() {
        if (!this.root) return;
        this.$('mw-modal').style.display = 'none';
        this.modalOpen = false;
    }

    _modal() {
        const m = this.$('mw-modal');
        m.innerHTML = '';
        m.style.display = 'block';
        this.modalOpen = true;
        return m;
    }

    /** The wedding planner: one step per category; resolves with the choices. */
    openPlanner(steps, onFinish) {
        const choices = {};
        for (const s of steps) {
            if (s.type === 'many') choices[s.id] = new Set();
            else if (s.type === 'cake') choices[s.id] = { tiers: 3, flavor: s.flavors[0].id, topper: s.toppers[0].id };
            else choices[s.id] = { id: s.options[0].id, color: s.colors ? s.colors[0] : null };
        }
        let i = 0;
        const card = (title, desc, on, onClick, color) => {
            const c = el('div', 'card' + (on ? ' on' : ''));
            if (color != null) c.style.borderLeft = `8px solid ${hex(color)}`;
            c.appendChild(el('div', 'n', title));
            if (desc) c.appendChild(el('div', 'd', desc));
            c.addEventListener('click', onClick);
            return c;
        };
        const render = () => {
            const m = this._modal();
            const s = steps[i];
            m.appendChild(el('h2', '', `💒 Wedding Planner — ${s.title}`));
            m.appendChild(el('div', 'mw-sub', `Coralie the seahorse: "${s.hint}"`));
            const cards = el('div', 'cards');
            if (s.type === 'one') {
                for (const o of s.options) {
                    cards.appendChild(card(o.name, o.desc, choices[s.id].id === o.id, () => { choices[s.id].id = o.id; render(); }, o.color));
                }
                m.appendChild(cards);
                if (s.colors) {
                    m.appendChild(el('h3', '', 'Colour'));
                    const w = el('div', 'mw-swatches');
                    for (const c of s.colors) {
                        const sw = el('div', 'mw-sw' + (choices[s.id].color === c ? ' on' : ''));
                        sw.style.background = hex(c);
                        sw.addEventListener('click', () => { choices[s.id].color = c; render(); });
                        w.appendChild(sw);
                    }
                    m.appendChild(w);
                }
            } else if (s.type === 'many') {
                for (const o of s.options) {
                    const set = choices[s.id];
                    cards.appendChild(card((set.has(o.id) ? '✔ ' : '') + o.name, o.desc, set.has(o.id), () => {
                        if (set.has(o.id)) set.delete(o.id);
                        else set.add(o.id);
                        render();
                    }));
                }
                m.appendChild(cards);
            } else if (s.type === 'cake') {
                const c = choices[s.id];
                m.appendChild(el('h3', '', 'Tiers'));
                const tw = el('div');
                for (const n of s.tiers) {
                    const b = el('button', c.tiers === n ? 'on' : '', `${n} tiers`);
                    b.addEventListener('click', () => { c.tiers = n; render(); });
                    tw.appendChild(b);
                }
                m.appendChild(tw);
                m.appendChild(el('h3', '', 'Flavour'));
                const fl = el('div', 'cards');
                for (const f of s.flavors) fl.appendChild(card(f.name, '', c.flavor === f.id, () => { c.flavor = f.id; render(); }, f.color));
                m.appendChild(fl);
                m.appendChild(el('h3', '', 'Topper'));
                const tp = el('div', 'cards');
                for (const t of s.toppers) tp.appendChild(card(t.name, '', c.topper === t.id, () => { c.topper = t.id; render(); }));
                m.appendChild(tp);
            }
            const nav = el('div', 'nav');
            const back = el('button', '', '← Back');
            back.disabled = i === 0;
            back.addEventListener('click', () => { i--; render(); });
            const dots = el('div', 'dots');
            steps.forEach((_, k) => dots.appendChild(el('span', k === i ? 'on' : '')));
            const last = i === steps.length - 1;
            const next = el('button', last ? 'big' : '', last ? 'Hold the Wedding! 💍' : 'Next →');
            if (s.type === 'many' && s.id === 'moments' && choices.moments.size === 0) next.disabled = true;
            next.addEventListener('click', () => {
                if (last) {
                    this.closeModal();
                    onFinish(choices);
                } else {
                    i++;
                    render();
                }
            });
            nav.append(back, dots, next);
            m.appendChild(nav);
        };
        render();
    }

    /**
     * A shop. onBuy(item) returns true if bought. onClose() when the player leaves.
     * @param {Object} state { money, owned: Set }
     */
    openShop(shop, state, onBuy, onClose) {
        const render = () => {
            const m = this._modal();
            m.appendChild(el('h2', '', `🛍️ ${shop.name}`));
            m.appendChild(el('div', 'mw-sub', shop.greeting));
            m.appendChild(el('div', '', `You have 🐚 ${state.money} sand dollars`));
            const cards = el('div', 'cards');
            for (const it of shop.items) {
                const owned = state.owned.has(it.id) && !it.food;
                const c = el('div', 'card' + (owned ? ' on' : ''));
                const col = it.food ?? it.apply?.topColor ?? it.apply?.hairColor;
                if (col != null) c.style.borderLeft = `8px solid ${hex(col)}`;
                c.appendChild(el('div', 'n', it.name));
                c.appendChild(el('div', 'p', `🐚 ${it.price}`));
                const b = el('button', '', owned ? 'Wearing it ✨' : it.food ? 'Order for the table' : 'Buy & wear');
                b.disabled = owned || state.money < it.price;
                b.addEventListener('click', () => {
                    if (onBuy(it)) render();
                });
                c.appendChild(b);
                cards.appendChild(c);
            }
            m.appendChild(cards);
            const nav = el('div', 'nav');
            nav.appendChild(el('div'));
            const close = el('button', 'big', 'Leave shop');
            close.addEventListener('click', () => {
                this.closeModal();
                onClose();
            });
            nav.appendChild(close);
            m.appendChild(nav);
        };
        render();
    }
}
