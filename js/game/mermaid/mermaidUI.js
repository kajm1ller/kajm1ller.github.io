/**
 * js/game/mermaid/mermaidUI.js
 *
 * The DOM side of Mermaid World: fades, the character creator / wardrobe (tabs, locks, saved looks),
 * the HUD (quest tracker, money, pearls, compass, minimap, time of day), prompts, captions,
 * toasts, dialogue with choices, the wedding planner, shops (with gifts for friends), the journal,
 * the fast-travel map, the pause menu and the photo viewfinder. Everything lives under one
 * #mermaid-ui root above the game's own HUD (which is hidden while the trip lasts).
 */

import {
    HAIR_STYLES, HAIR_COLORS, HAIR_TIPS, SKIN_TONES, EYE_COLORS, EYE_SHAPES, BROWS, LASHES, MOUTHS, LIPSTICKS, EYESHADOWS, BLUSHES, FACE_PAINTS, EARS,
    BUILDS, TAIL_COLORS, TAIL_PATTERNS, FIN_STYLES, TOPS, TOP_COLORS, BOTTOMS, CAPES, HEAD_ACCS, NECK_ACCS, EAR_ACCS, ARM_ACCS, AURAS, PETS, PRESETS,
    LOCKED, isUnlocked, randomLook, normalizeLook, SHOPS, ITEMS, ACHIEVEMENTS, AREAS
} from './mermaidData.js';

const CSS = `
body.mermaid-mode > *:not(canvas):not(#mermaid-ui) { visibility: hidden !important; }
#mermaid-ui { position: fixed; inset: 0; z-index: 900; pointer-events: none; font-family: 'Trebuchet MS', 'Segoe UI', sans-serif; color: #fff; user-select: none; }
#mermaid-ui * { box-sizing: border-box; }
#mermaid-ui .mw-panel { pointer-events: auto; background: linear-gradient(160deg, rgba(14,70,120,0.86), rgba(96,48,140,0.82)); border: 1px solid rgba(255,255,255,0.32);
    border-radius: 18px; box-shadow: 0 10px 40px rgba(0,20,60,0.5), inset 0 1px 0 rgba(255,255,255,0.28); backdrop-filter: blur(8px); }
#mermaid-ui .mw-flat { background: rgba(8,30,60,0.55); border-radius: 12px; border: 1px solid rgba(255,255,255,0.18); backdrop-filter: blur(4px); }
#mermaid-ui h2 { margin: 0 0 4px; font-size: 22px; letter-spacing: 0.5px; text-shadow: 0 2px 6px rgba(0,0,0,0.35); }
#mermaid-ui h3 { margin: 14px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 1.6px; opacity: 0.85; }
#mermaid-ui .mw-sub { font-size: 13px; opacity: 0.85; margin-bottom: 8px; }
#mermaid-ui button { pointer-events: auto; font: inherit; color: #fff; cursor: pointer; border: 1px solid rgba(255,255,255,0.42); background: rgba(255,255,255,0.12);
    border-radius: 11px; padding: 6px 11px; margin: 2px; font-size: 13px; transition: background 0.15s, transform 0.1s; }
#mermaid-ui button:hover { background: rgba(255,255,255,0.28); }
#mermaid-ui button:active { transform: scale(0.97); }
#mermaid-ui button.on { background: linear-gradient(135deg, #ff9ff3, #48dbfb); border-color: #fff; color: #1b1b3a; font-weight: 700; }
#mermaid-ui button.big { font-size: 17px; padding: 11px 22px; font-weight: 700; background: linear-gradient(135deg, #ff7eb3, #7afcff); color: #20124d; border: none; }
#mermaid-ui button.danger { background: rgba(255,90,100,0.35); border-color: #ff8a8a; }
#mermaid-ui button:disabled { opacity: 0.4; cursor: default; }
#mermaid-ui button.locked { opacity: 0.45; position: relative; }
#mermaid-ui .mw-swatches { display: flex; flex-wrap: wrap; gap: 6px; }
#mermaid-ui .mw-sw { width: 27px; height: 27px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.5); cursor: pointer; pointer-events: auto; position: relative; }
#mermaid-ui .mw-sw.on { border: 3px solid #fff; box-shadow: 0 0 0 2px #ff9ff3, 0 0 12px #fff; }
#mermaid-ui .mw-sw.none::after { content: ''; position: absolute; left: 3px; right: 3px; top: 50%; height: 2px; background: #ff6b81; transform: rotate(-45deg); }
#mermaid-ui .mw-tabs { display: flex; flex-wrap: wrap; margin: 6px 0 4px; }
#mermaid-ui input[type=text] { pointer-events: auto; font: inherit; font-size: 15px; padding: 7px 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.5); background: rgba(255,255,255,0.15); color: #fff; width: 100%; }
#mermaid-ui input[type=range] { pointer-events: auto; width: 100%; accent-color: #ff9ff3; }
#mermaid-ui kbd { background: #fff; color: #20124d; border-radius: 6px; padding: 1px 7px; margin-right: 6px; font-weight: 700; }
#mw-fade { position: fixed; inset: 0; background: #000; opacity: 0; transition-property: opacity; pointer-events: none; z-index: 5; }
#mw-vignette { position: fixed; inset: 0; pointer-events: none; background: radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,20,50,0.55) 100%); }
#mw-creator { position: absolute; left: 22px; top: 22px; bottom: 22px; width: 410px; padding: 16px 18px; overflow-y: auto; }
#mw-creator-go { position: absolute; right: 36px; bottom: 36px; }
#mw-creator-cam { position: absolute; left: 50%; bottom: 28px; transform: translateX(-50%); padding: 6px 10px; }
#mw-tasks { position: absolute; left: 16px; top: 16px; width: 300px; padding: 10px 14px; font-size: 13px; }
#mw-tasks .t { margin: 6px 0 2px; font-weight: 700; font-size: 14px; }
#mw-tasks .t.done { text-decoration: line-through; opacity: 0.6; }
#mw-tasks .s { margin-left: 18px; opacity: 0.9; }
#mw-tasks .s.done { opacity: 0.5; }
#mw-stats { position: absolute; right: 16px; top: 16px; padding: 8px 14px; font-weight: 700; font-size: 14px; line-height: 1.5; text-align: right; }
#mw-compass { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); width: 520px; height: 36px; border-radius: 18px; overflow: hidden; }
#mw-minimap { position: absolute; left: 16px; bottom: 16px; width: 172px; height: 172px; border-radius: 50%; border: 3px solid rgba(255,255,255,0.6); box-shadow: 0 4px 20px rgba(0,0,0,0.45); overflow: hidden; background: rgba(6,40,70,0.7); }
#mw-run { position: absolute; left: 50%; top: 56px; transform: translateX(-50%); padding: 6px 16px; font-weight: 700; font-size: 15px; display: none; white-space: nowrap; }
#mw-prompt { position: absolute; left: 50%; bottom: 128px; transform: translateX(-50%); padding: 9px 18px; font-size: 16px; font-weight: 700; display: none; }
#mw-prompt .bar { height: 5px; margin-top: 6px; border-radius: 3px; background: rgba(255,255,255,0.25); overflow: hidden; display: none; }
#mw-prompt .bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #ff9ff3, #48dbfb); }
#mw-caption { position: absolute; left: 50%; top: 72px; transform: translateX(-50%); font-size: 26px; font-weight: 700; text-align: center;
    text-shadow: 0 2px 10px rgba(0,0,0,0.6), 0 0 22px rgba(255,159,243,0.8); opacity: 0; transition: opacity 0.6s; white-space: pre-line; max-width: 80%; }
#mw-toasts { position: absolute; right: 16px; top: 80px; width: 280px; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
#mw-toasts .toast { padding: 9px 14px; font-size: 14px; border-radius: 12px; max-width: 280px; animation: mwtoast 0.35s ease-out; background: linear-gradient(135deg, rgba(255,159,243,0.9), rgba(72,219,251,0.9)); color: #1b1b3a; font-weight: 700; box-shadow: 0 6px 18px rgba(0,0,0,0.35); }
@keyframes mwtoast { from { transform: translateX(40px); opacity: 0; } to { transform: none; opacity: 1; } }
#mw-dialog { position: absolute; left: 50%; bottom: 26px; transform: translateX(-50%); width: min(780px, 92%); padding: 16px 22px; display: none; }
#mw-dialog .who { font-weight: 700; font-size: 15px; color: #ffeaa7; margin-bottom: 4px; }
#mw-dialog .what { font-size: 17px; line-height: 1.45; min-height: 50px; }
#mw-dialog .more { font-size: 12px; opacity: 0.7; text-align: right; margin-top: 6px; }
#mw-dialog .choices { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
#mw-help { position: absolute; right: 16px; bottom: 16px; padding: 8px 12px; font-size: 12px; opacity: 0.92; line-height: 1.5; max-width: 330px; text-align: right; }
#mw-modal { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(880px, 95%); max-height: 90%; overflow-y: auto; padding: 22px; display: none; }
#mw-modal .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(176px, 1fr)); gap: 10px; margin: 8px 0; }
#mw-modal .card { pointer-events: auto; cursor: pointer; border-radius: 14px; padding: 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.35); transition: background 0.15s; }
#mw-modal .card:hover { background: rgba(255,255,255,0.22); }
#mw-modal .card.on { background: linear-gradient(135deg, rgba(255,159,243,0.55), rgba(72,219,251,0.55)); border: 2px solid #fff; }
#mw-modal .card .n { font-weight: 700; font-size: 15px; }
#mw-modal .card .d { font-size: 12px; opacity: 0.85; margin-top: 3px; }
#mw-modal .card .p { font-weight: 700; color: #ffeaa7; margin-top: 6px; }
#mw-modal .card .tags { font-size: 11px; opacity: 0.8; margin-top: 3px; }
#mw-modal .nav { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; }
#mw-modal .dots span { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: rgba(255,255,255,0.35); margin: 0 3px; }
#mw-modal .dots span.on { background: #fff; }
#mw-modal .q { margin: 8px 0; padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,0.09); }
#mw-modal .q .qt { font-weight: 700; font-size: 15px; }
#mw-modal .q .qs { font-size: 13px; margin-left: 12px; opacity: 0.9; }
#mw-modal .q.done { opacity: 0.6; }
#mw-modal .bar { height: 8px; background: rgba(255,255,255,0.2); border-radius: 4px; overflow: hidden; margin: 4px 0; }
#mw-modal .bar i { display: block; height: 100%; background: linear-gradient(90deg, #ff9ff3, #48dbfb); }
#mw-modal .photos { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
#mw-modal .photos .ph { border-radius: 10px; overflow: hidden; background: rgba(0,0,0,0.3); position: relative; aspect-ratio: 16/10; display: flex; align-items: center; justify-content: center; font-size: 28px; }
#mw-modal .photos .ph img { width: 100%; height: 100%; object-fit: cover; }
#mw-modal .photos .ph span { position: absolute; left: 0; right: 0; bottom: 0; font-size: 11px; padding: 2px 6px; background: rgba(0,0,0,0.55); }
#mw-map { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 12px; display: none; }
#mw-map canvas { border-radius: 12px; display: block; cursor: pointer; }
#mermaid-ui.photo #mw-tasks, #mermaid-ui.photo #mw-stats, #mermaid-ui.photo #mw-help, #mermaid-ui.photo #mw-minimap, #mermaid-ui.photo #mw-compass { display: none !important; }
#mw-finder { position: absolute; inset: 0; display: none; pointer-events: none; }
#mw-finder .corner { position: absolute; width: 60px; height: 60px; border: 4px solid rgba(255,255,255,0.9); }
#mw-finder .c1 { left: 12%; top: 12%; border-right: none; border-bottom: none; } #mw-finder .c2 { right: 12%; top: 12%; border-left: none; border-bottom: none; }
#mw-finder .c3 { left: 12%; bottom: 12%; border-right: none; border-top: none; } #mw-finder .c4 { right: 12%; bottom: 12%; border-left: none; border-top: none; }
#mw-finder .ring { position: absolute; left: 50%; top: 50%; width: 120px; height: 120px; margin: -60px; border: 2px solid rgba(255,255,255,0.6); border-radius: 50%; }
#mw-finder .hint { position: absolute; left: 50%; bottom: 8%; transform: translateX(-50%); font-weight: 700; text-shadow: 0 2px 8px #000; text-align: center; }
#mw-flash { position: fixed; inset: 0; background: #fff; opacity: 0; pointer-events: none; transition: opacity 0.35s ease-out; z-index: 4; }
#mw-game { position: absolute; inset: 0; display: none; background: rgba(4,14,40,0.82); z-index: 3; pointer-events: auto; }
`;

const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
const h = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    if (props) {
        for (const [k, v] of Object.entries(props)) {
            if (k === 'class') e.className = v;
            else if (k === 'style') e.style.cssText = v;
            else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
            else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
        }
    }
    for (const k of kids.flat()) {
        if (k === null || k === undefined || k === false) continue;
        e.append(k.nodeType ? k : document.createTextNode(String(k)));
    }
    return e;
};

/** Where an item that unlocks something is sold (for the lock tooltips). */
function sellerOf(id) {
    if (id.startsWith('reward:')) return 'Reward from a quest';
    for (const s of SHOPS) for (const it of s.items) if ((it.unlock || []).includes(id)) return `Sold at ${s.name}`;
    return 'Locked';
}

export class MermaidUI {
    constructor() {
        this.root = null;
        this.dialogResolve = null;
        this.modalOpen = false;
        this.mapOpen = false;
        this.finderOn = false;
        this._captionTimer = 0;
        this.choiceResolve = null;
        this.typeTimer = 0;
        this.onClick = null;
    }

    _build() {
        if (this.root) return;
        const style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);
        const r = h('div', { id: 'mermaid-ui', style: 'display:none' });
        r.innerHTML = `
            <div id="mw-vignette"></div>
            <canvas id="mw-compass" class="mw-flat" width="520" height="36" style="display:none"></canvas>
            <div id="mw-run" class="mw-panel"></div>
            <div id="mw-tasks" class="mw-panel" style="display:none"></div>
            <div id="mw-stats" class="mw-panel" style="display:none"></div>
            <div id="mw-minimap" style="display:none"><canvas width="172" height="172"></canvas></div>
            <div id="mw-toasts"></div>
            <div id="mw-prompt" class="mw-panel"><div class="txt"></div><div class="bar"><i></i></div></div>
            <div id="mw-caption"></div>
            <div id="mw-finder"><div class="corner c1"></div><div class="corner c2"></div><div class="corner c3"></div><div class="corner c4"></div><div class="ring"></div><div class="hint"></div></div>
            <div id="mw-dialog" class="mw-panel"><div class="who"></div><div class="what"></div><div class="choices"></div><div class="more">E / click to continue</div></div>
            <div id="mw-help" class="mw-panel" style="display:none"></div>
            <div id="mw-game"></div>
            <div id="mw-modal" class="mw-panel"></div>
            <div id="mw-map" class="mw-panel"></div>
            <div id="mw-creator" class="mw-panel" style="display:none"></div>
            <div id="mw-creator-cam" class="mw-panel" style="display:none"></div>
            <div id="mw-creator-go" style="display:none"></div>
            <div id="mw-flash"></div>
            <div id="mw-fade"></div>`;
        document.body.appendChild(r);
        this.root = r;
        this.$ = (id) => r.querySelector('#' + id);
        this.compass = this.$('mw-compass');
        this.mini = this.$('mw-minimap').querySelector('canvas');
        this.$('mw-dialog').addEventListener('click', (e) => { if (!e.target.closest('button')) this.advance(); });
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
        this.closeMap();
        this.closeGame();
        this.setPrompt(null);
        this.$('mw-dialog').style.display = 'none';
        this.setFinder(false);
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

    flash() {
        const f = this.$('mw-flash');
        f.style.transition = 'none';
        f.style.opacity = '0.9';
        void f.offsetWidth;
        f.style.transition = 'opacity 0.45s ease-out';
        f.style.opacity = '0';
    }

    showHud(on) {
        for (const id of ['mw-tasks', 'mw-stats', 'mw-help']) this.$(id).style.display = on ? 'block' : 'none';
        this.$('mw-minimap').style.display = on ? 'block' : 'none';
        this.compass.style.display = on ? 'block' : 'none';
        if (on) this.$('mw-help').innerHTML = 'WASD swim · Mouse look (click to grab) · Space up · C down · Shift sprint<br><kbd>E</kbd>interact <kbd>F</kbd>photo <kbd>J</kbd>journal <kbd>M</kbd>map <kbd>Esc</kbd>/<kbd>P</kbd>menu <kbd>H</kbd>hide';
    }

    toggleHelp() {
        const e = this.$('mw-help');
        e.style.display = e.style.display === 'none' ? 'block' : 'none';
    }

    /** Tracked quests: [{ title, done, sub: [{ text, done }] }] */
    setTasks(tasks) {
        const t = this.$('mw-tasks');
        t.innerHTML = '<div style="font-weight:700;font-size:15px;margin-bottom:2px">🧜 Dream Journal <span style="opacity:.6;font-size:11px">(J)</span></div>' + tasks.map((k, i) =>
            `<div class="t ${k.done ? 'done' : ''}">${k.done ? '✅' : '◆'} ${k.title}</div>` +
            (k.done ? '' : (k.sub || []).map((s) => `<div class="s ${s.done ? 'done' : ''}">${s.done ? '✔' : '○'} ${s.text}</div>`).join(''))
        ).join('');
    }

    setStats({ money, pearls, pearlTotal, depth, clock, night }) {
        this.$('mw-stats').innerHTML = `🐚 ${money} sand dollars<br>🦪 ${pearls}/${pearlTotal} pearls<br><span style="opacity:.8;font-size:12px">${night ? '🌙' : '☀️'} ${clock} · ${Math.max(0, Math.round(depth))} m deep</span>`;
    }

    setRunHud(text) {
        const e = this.$('mw-run');
        e.style.display = text ? 'block' : 'none';
        if (text) e.textContent = text;
    }

    setPrompt(text, progress = null) {
        if (!this.root) return;
        const p = this.$('mw-prompt');
        if (!text) {
            p.style.display = 'none';
            return;
        }
        p.querySelector('.txt').innerHTML = `<kbd>E</kbd>${text}`;
        p.style.display = 'block';
        const bar = p.querySelector('.bar');
        bar.style.display = progress == null ? 'none' : 'block';
        if (progress != null) bar.firstChild.style.width = `${Math.round(progress * 100)}%`;
    }

    caption(text, ms = 3000) {
        const c = this.$('mw-caption');
        c.textContent = text;
        c.style.opacity = '1';
        clearTimeout(this._captionTimer);
        this._captionTimer = setTimeout(() => { c.style.opacity = '0'; }, ms);
    }

    toast(text, ms = 3200) {
        const t = h('div', { class: 'toast' }, text);
        const box = this.$('mw-toasts');
        box.appendChild(t);
        while (box.children.length > 5) box.firstChild.remove();
        setTimeout(() => { t.style.transition = 'opacity 0.4s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 450); }, ms);
    }

    // ---- Dialogue ---------------------------------------------------------------------------
    get dialogOpen() {
        return !!this.dialogResolve || !!this.choiceResolve;
    }

    _typeText(el, text) {
        clearInterval(this.typeTimer);
        el.textContent = '';
        let i = 0;
        const step = Math.max(1, Math.ceil(text.length / 70));
        this.typing = true;
        this.typeTimer = setInterval(() => {
            i += step;
            el.textContent = text.slice(0, i);
            if (i >= text.length) {
                clearInterval(this.typeTimer);
                this.typing = false;
            }
        }, 16);
        this._finishTyping = () => {
            clearInterval(this.typeTimer);
            el.textContent = text;
            this.typing = false;
        };
    }

    /** Shows a line of dialogue; resolves when the player continues. */
    say(who, what) {
        const d = this.$('mw-dialog');
        d.querySelector('.who').textContent = who;
        this._typeText(d.querySelector('.what'), what);
        d.querySelector('.choices').innerHTML = '';
        d.querySelector('.more').style.display = 'block';
        d.style.display = 'block';
        return new Promise((res) => { this.dialogResolve = res; });
    }

    /** A line with buttons; resolves with the index chosen. */
    choice(who, what, options) {
        const d = this.$('mw-dialog');
        d.querySelector('.who').textContent = who;
        this._typeText(d.querySelector('.what'), what);
        const box = d.querySelector('.choices');
        box.innerHTML = '';
        d.querySelector('.more').style.display = 'none';
        d.style.display = 'block';
        return new Promise((res) => {
            this.choiceResolve = res;
            options.forEach((o, i) => box.appendChild(h('button', { onclick: () => this._pick(i) }, o)));
        });
    }

    _pick(i) {
        const r = this.choiceResolve;
        if (!r) return;
        this.choiceResolve = null;
        this.$('mw-dialog').style.display = 'none';
        r(i);
    }

    /** Continue: the first press shows the whole line, the next moves on. */
    advance() {
        if (this.choiceResolve || !this.dialogResolve) return;
        if (this.typing) {
            this._finishTyping();
            return;
        }
        const r = this.dialogResolve;
        this.dialogResolve = null;
        this.$('mw-dialog').style.display = 'none';
        r();
    }

    async conversation(who, lines) {
        for (const l of lines) await this.say(who, l);
    }

    // ---- Compass and minimap -------------------------------------------------------------------
    /** Draws the compass ribbon: yaw is the camera's heading (radians, 0 = +z), markers [{ bearing, icon, color }]. */
    drawCompass(yaw, markers) {
        const c = this.compass.getContext('2d');
        const W = this.compass.width, H = this.compass.height;
        c.clearRect(0, 0, W, H);
        const span = Math.PI * 0.9;
        const toX = (b) => {
            let d = b - yaw;
            d = Math.atan2(Math.sin(d), Math.cos(d));
            return W / 2 + (d / (span / 2)) * (W / 2);
        };
        c.font = 'bold 14px "Trebuchet MS"';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        const marks = [['N', Math.PI], ['E', Math.PI / 2], ['S', 0], ['W', -Math.PI / 2]];
        for (const [t, b] of marks) {
            const x = toX(b);
            if (x < 10 || x > W - 10) continue;
            c.fillStyle = t === 'N' ? '#ff9ff3' : '#fff';
            c.fillText(t, x, H / 2);
        }
        for (let i = 0; i < 24; i++) {
            const b = (i / 24) * Math.PI * 2 - Math.PI;
            const x = toX(b);
            if (x < 6 || x > W - 6) continue;
            c.fillStyle = 'rgba(255,255,255,0.35)';
            c.fillRect(x, H - 8, 1.5, 6);
        }
        for (const m of markers) {
            const x = clampN(toX(m.bearing), 14, W - 14);
            c.fillStyle = m.color || '#ffeaa7';
            c.font = '16px "Segoe UI Emoji", sans-serif';
            c.fillText(m.icon || '◆', x, H / 2 - 1);
        }
    }

    /** Heading-up minimap: dots for places and objectives around the player (world metres). */
    drawMinimap(player, yaw, dots, range = 150) {
        const c = this.mini.getContext('2d');
        const S = this.mini.width, R = S / 2;
        c.clearRect(0, 0, S, S);
        const grd = c.createRadialGradient(R, R, 10, R, R, R);
        grd.addColorStop(0, 'rgba(30,110,160,0.85)');
        grd.addColorStop(1, 'rgba(6,40,70,0.9)');
        c.fillStyle = grd;
        c.fillRect(0, 0, S, S);
        c.strokeStyle = 'rgba(255,255,255,0.12)';
        for (const r of [0.33, 0.66, 1]) {
            c.beginPath();
            c.arc(R, R, R * r - 2, 0, Math.PI * 2);
            c.stroke();
        }
        const cs = Math.cos(yaw), sn = Math.sin(yaw);
        for (const d of dots) {
            const dx = d.x - player.x, dz = d.z - player.z;
            // rotate so the camera heading points up the map
            const fx = dx * -sn + dz * -cs, rx = dx * cs + dz * -sn;
            let px = rx / range * R, py = -fx / range * R;
            const len = Math.hypot(px, py);
            let edge = false;
            if (len > R - 10) {
                px *= (R - 10) / len;
                py *= (R - 10) / len;
                edge = true;
            }
            c.globalAlpha = edge ? 0.7 : 1;
            c.fillStyle = d.color || '#fff';
            if (d.icon) {
                c.font = `${d.big ? 16 : 12}px "Segoe UI Emoji", sans-serif`;
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillText(d.icon, R + px, R + py);
            } else {
                c.beginPath();
                c.arc(R + px, R + py, d.big ? 5 : 3, 0, Math.PI * 2);
                c.fill();
            }
            c.globalAlpha = 1;
        }
        c.fillStyle = '#fff';
        c.beginPath();
        c.moveTo(R, R - 9);
        c.lineTo(R + 6, R + 7);
        c.lineTo(R, R + 3);
        c.lineTo(R - 6, R + 7);
        c.closePath();
        c.fill();
    }

    // ---- Creator / wardrobe -----------------------------------------------------------------------
    /**
     * @param {Object} look the working look (edited in place)
     * @param {Set} owned unlocked item ids
     * @param {Object} o { title, onChange(look), onDone(look), onCamera(mode), saved: [look|null x3], onSave(i, look), confirm }
     */
    openCreator(look, owned, o) {
        this._build();
        const panel = this.$('mw-creator');
        panel.style.display = 'block';
        const go = this.$('mw-creator-go');
        go.style.display = 'block';
        go.innerHTML = '';
        go.appendChild(h('button', { class: 'big', onclick: () => { this.closeCreator(); o.onDone(look); } }, o.confirm || 'Dive In! 🌊'));
        const cam = this.$('mw-creator-cam');
        cam.style.display = 'block';
        cam.innerHTML = '';
        for (const [id, label] of [['full', '🧜 Full'], ['face', '🙂 Face'], ['back', '↻ Back']]) cam.appendChild(h('button', { onclick: () => o.onCamera && o.onCamera(id) }, label));
        let tab = 'Presets';
        const set = (patch) => {
            Object.assign(look, patch);
            o.onChange(look);
            render();
        };
        const lockedTip = (kind, val) => {
            const need = LOCKED[kind] && LOCKED[kind][val];
            return need ? sellerOf(need) : '';
        };
        const buttons = (list, current, key) => h('div', null, list.map((it) => {
            const un = isUnlocked(key, it.id, owned);
            return h('button', {
                class: (it.id === current ? 'on ' : '') + (un ? '' : 'locked'), title: un ? '' : lockedTip(key, it.id),
                onclick: () => { if (un) set({ [key]: it.id }); else this.toast('🔒 ' + lockedTip(key, it.id)); }
            }, (un ? '' : '🔒 ') + it.name);
        }));
        const swatches = (list, current, key) => h('div', { class: 'mw-swatches' }, list.map((c) => h('div', {
            class: 'mw-sw' + (c === current ? ' on' : '') + (c == null ? ' none' : ''), title: c == null ? 'None' : hex(c),
            style: `background:${c == null ? 'rgba(255,255,255,0.15)' : hex(c)}`, onclick: () => set({ [key]: c })
        })));
        const toggle = (label, key) => h('button', { class: look[key] ? 'on' : '', onclick: () => set({ [key]: !look[key] }) }, `${label}: ${look[key] ? 'On' : 'Off'}`);
        const slider = (label, key, min, max, step) => {
            const title = h('h3', null, `${label} (${Math.round(look[key] * 100)}%)`);
            const r = h('input', { type: 'range', min, max, step, value: look[key], oninput: () => { look[key] = parseFloat(r.value); o.onChange(look); title.textContent = `${label} (${Math.round(look[key] * 100)}%)`; } });
            return [title, r];
        };
        const H = (t) => h('h3', null, t);
        const content = () => {
            if (tab === 'Presets') {
                const out = [H('Starting looks'), h('div', null, PRESETS.map((p) => h('button', { onclick: () => { const name = look.name; Object.assign(look, normalizeLook(Object.assign({}, p.look, { name }))); o.onChange(look); render(); } }, p.name)))];
                out.push(H('My saved looks'));
                const slots = o.saved || [];
                for (let i = 0; i < 3; i++) {
                    const sl = slots[i];
                    out.push(h('div', null,
                        h('button', { onclick: () => { if (sl) { const name = look.name; Object.assign(look, normalizeLook(Object.assign({}, sl, { name }))); o.onChange(look); render(); } } }, sl ? `Slot ${i + 1}: ${sl.name}` : `Slot ${i + 1}: empty`),
                        h('button', { onclick: () => { o.onSave && o.onSave(i, JSON.parse(JSON.stringify(look))); this.toast(`Look saved to slot ${i + 1}`); render(); } }, '💾 Save here')));
                }
                return out;
            }
            if (tab === 'Hair') return [H('Style'), buttons(HAIR_STYLES, look.hairStyle, 'hairStyle'), H('Colour'), swatches(HAIR_COLORS, look.hairColor, 'hairColor'), H('Tip colour (ombre)'), swatches(HAIR_TIPS, look.hairTip, 'hairTip'), H('Highlights'), toggle('Highlights', 'highlights')];
            if (tab === 'Face') return [H('Skin tone'), swatches(SKIN_TONES, look.skin, 'skin'), H('Eye colour'), swatches(EYE_COLORS, look.eyeColor, 'eyeColor'), H('Eye shape'), buttons(EYE_SHAPES, look.eyeShape, 'eyeShape'), H('Brows'), buttons(BROWS, look.brows, 'brows'), H('Lashes'), buttons(LASHES, look.lashes, 'lashes'), H('Mouth'), buttons(MOUTHS, look.mouth, 'mouth'), H('Ears'), buttons(EARS, look.ears, 'ears'), H('Freckles'), toggle('Freckles', 'freckles')];
            if (tab === 'Makeup') return [H('Lipstick'), swatches(LIPSTICKS, look.lipstick, 'lipstick'), H('Eyeshadow'), swatches(EYESHADOWS, look.eyeshadow, 'eyeshadow'), H('Blush'), swatches(BLUSHES, look.blush, 'blush'), H('Eyeliner / glitter'), h('div', null, toggle('Winged liner', 'eyeliner'), toggle('Face glitter', 'glitter')), H('Face paint'), buttons(FACE_PAINTS, look.facePaint, 'facePaint')];
            if (tab === 'Body') return [...slider('Height', 'height', 0.8, 1.2, 0.01), H('Build'), buttons(BUILDS, look.build, 'build'), ...slider('Tail length', 'tailSize', 0.7, 1.45, 0.01)];
            if (tab === 'Tail') {
                return [H('Tail colour'), h('div', { class: 'mw-swatches' }, TAIL_COLORS.map((tc, i) => h('div', {
                    class: 'mw-sw' + (i === look.tail ? ' on' : ''), title: tc.name, style: `width:34px;height:34px;background:linear-gradient(180deg, ${hex(tc.a)}, ${hex(tc.b)})`, onclick: () => set({ tail: i })
                }))), H('Pattern'), buttons(TAIL_PATTERNS, look.tailPattern, 'tailPattern'), H('Fin'), buttons(FIN_STYLES, look.finStyle, 'finStyle'), H('Glow'), toggle('Bioluminescent tail', 'tailGlow')];
            }
            if (tab === 'Outfit') return [H('Top'), buttons(TOPS, look.top, 'top'), H('Top colour'), swatches(TOP_COLORS, look.topColor, 'topColor'), H('Waist'), buttons(BOTTOMS, look.bottom, 'bottom'), H('Waist colour'), swatches(TOP_COLORS, look.bottomColor, 'bottomColor'), H('Cape / wings'), buttons(CAPES, look.cape, 'cape'), H('Cape colour'), swatches(TOP_COLORS, look.capeColor, 'capeColor')];
            if (tab === 'Extras') return [H('Head'), buttons(HEAD_ACCS, look.headAcc, 'headAcc'), H('Neck'), buttons(NECK_ACCS, look.neckAcc, 'neckAcc'), H('Ears'), buttons(EAR_ACCS, look.earAcc, 'earAcc'), H('Arms'), buttons(ARM_ACCS, look.armAcc, 'armAcc'), H('Aura'), buttons(AURAS, look.aura, 'aura')];
            return [];
        };
        const render = () => {
            const top = panel.scrollTop;
            panel.innerHTML = '';
            panel.appendChild(h('h2', null, o.title || '🧜‍♀️ Create Your Mermaid'));
            panel.appendChild(h('div', { class: 'mw-sub' }, 'Drag the world to spin her around. Everything can be changed again at the Dressing Shell.'));
            const name = h('input', { type: 'text', value: look.name, maxlength: 18, placeholder: 'Mermaid name', oninput: () => { look.name = name.value || 'Mermaid'; } });
            panel.appendChild(name);
            panel.appendChild(h('div', { class: 'mw-tabs' }, ['Presets', 'Hair', 'Face', 'Makeup', 'Body', 'Tail', 'Outfit', 'Extras'].map((t) => h('button', { class: t === tab ? 'on' : '', onclick: () => { tab = t; render(); panel.scrollTop = 0; } }, t))));
            for (const n of content()) panel.appendChild(n);
            panel.appendChild(h('div', { style: 'margin-top:14px' },
                h('button', { onclick: () => { const name0 = look.name; Object.assign(look, randomLook(Math.random, owned), { name: name0 }); o.onChange(look); render(); } }, '🎲 Randomize')));
            panel.scrollTop = top;
        };
        render();
    }

    closeCreator() {
        if (!this.root) return;
        this.$('mw-creator').style.display = 'none';
        this.$('mw-creator-go').style.display = 'none';
        this.$('mw-creator-cam').style.display = 'none';
    }

    get creatorOpen() {
        return !!this.root && this.$('mw-creator').style.display !== 'none';
    }

    // ---- Modal (planner, shops, journal, pause) -------------------------------------------------
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
    openPlanner(steps, onFinish, onCancel) {
        const choices = {};
        for (const s of steps) {
            if (s.type === 'many') choices[s.id] = new Set();
            else if (s.type === 'cake') choices[s.id] = { tiers: 3, flavor: s.flavors[0].id, topper: s.toppers[0].id };
            else choices[s.id] = { id: s.options[0].id, color: s.colors ? s.colors[0] : null };
        }
        let i = 0;
        const card = (title, desc, on, onClick, color) => h('div', { class: 'card' + (on ? ' on' : ''), style: color != null ? `border-left:8px solid ${hex(color)}` : '', onclick: onClick },
            h('div', { class: 'n' }, title), desc ? h('div', { class: 'd' }, desc) : null);
        const render = () => {
            const m = this._modal();
            const s = steps[i];
            m.appendChild(h('h2', null, `💒 Wedding Planner — ${s.title}`));
            m.appendChild(h('div', { class: 'mw-sub' }, `Coralie the seahorse: "${s.hint}"`));
            const cards = h('div', { class: 'cards' });
            if (s.type === 'one') {
                for (const o of s.options) cards.appendChild(card(o.name, o.desc, choices[s.id].id === o.id, () => { choices[s.id].id = o.id; render(); }, o.color));
                m.appendChild(cards);
                if (s.colors) {
                    m.appendChild(h('h3', null, 'Colour'));
                    m.appendChild(h('div', { class: 'mw-swatches' }, s.colors.map((c) => h('div', { class: 'mw-sw' + (choices[s.id].color === c ? ' on' : ''), style: `background:${hex(c)}`, onclick: () => { choices[s.id].color = c; render(); } }))));
                }
            } else if (s.type === 'many') {
                const set = choices[s.id];
                for (const o of s.options) cards.appendChild(card((set.has(o.id) ? '✔ ' : '') + o.name, o.desc, set.has(o.id), () => { if (set.has(o.id)) set.delete(o.id); else set.add(o.id); render(); }));
                m.appendChild(cards);
            } else if (s.type === 'cake') {
                const c = choices[s.id];
                m.appendChild(h('h3', null, 'Tiers'));
                m.appendChild(h('div', null, s.tiers.map((n) => h('button', { class: c.tiers === n ? 'on' : '', onclick: () => { c.tiers = n; render(); } }, `${n} tiers`))));
                m.appendChild(h('h3', null, 'Flavour'));
                m.appendChild(h('div', { class: 'cards' }, s.flavors.map((f) => card(f.name, '', c.flavor === f.id, () => { c.flavor = f.id; render(); }, f.color))));
                m.appendChild(h('h3', null, 'Topper'));
                m.appendChild(h('div', { class: 'cards' }, s.toppers.map((t) => card(t.name, '', c.topper === t.id, () => { c.topper = t.id; render(); }))));
            }
            const last = i === steps.length - 1;
            const next = h('button', {
                class: last ? 'big' : '', onclick: () => { if (last) { this.closeModal(); onFinish(choices); } else { i++; render(); } }
            }, last ? 'Hold the Wedding! 💍' : 'Next →');
            if (s.id === 'moments' && choices.moments.size === 0) next.disabled = true;
            m.appendChild(h('div', { class: 'nav' },
                h('div', null, h('button', { disabled: i === 0, onclick: () => { i--; render(); } }, '← Back'), h('button', { onclick: () => { this.closeModal(); onCancel && onCancel(); } }, 'Later')),
                h('div', { class: 'dots' }, steps.map((_, k) => h('span', { class: k === i ? 'on' : '' }))), next));
        };
        render();
    }

    /**
     * A shop. state: { money, owned: Set, friends: [{ id, name, gifted }], giftMode: bool, bought: Set }.
     * onBuy(item, forFriend|null) returns true if it went through.
     */
    openShop(shop, state, onBuy, onClose) {
        const render = () => {
            const m = this._modal();
            m.appendChild(h('h2', null, `🛍️ ${shop.name}`));
            m.appendChild(h('div', { class: 'mw-sub' }, shop.greeting));
            m.appendChild(h('div', null, `You have 🐚 ${state.money} sand dollars`));
            const cards = h('div', { class: 'cards' });
            for (const it of shop.items) {
                const ownedIt = (it.unlock && it.unlock.every((u) => state.owned.has(u))) && !it.food;
                const col = it.food ?? it.give?.topColor ?? it.give?.hairColor ?? it.give?.bottomColor ?? it.give?.capeColor;
                const buttons = [];
                const can = state.money >= it.price;
                if (!it.gift) {
                    const label = shop.kind === 'food' ? 'Order for the table' : it.grants ? 'Buy' : ownedIt ? 'Wear it again ✨' : 'Buy & wear';
                    buttons.push(h('button', { disabled: !can && !ownedIt, onclick: () => { if (onBuy(it, null)) render(); } }, label));
                }
                if (state.giftMode && shop.kind !== 'food') {
                    for (const f of state.friends) {
                        if (f.gifted) continue;
                        buttons.push(h('button', { disabled: !can, onclick: () => { if (onBuy(it, f.id)) render(); } }, `🎁 ${f.name}`));
                    }
                }
                cards.appendChild(h('div', { class: 'card' + (ownedIt ? ' on' : ''), style: col != null ? `border-left:8px solid ${hex(col)}` : '' },
                    h('div', { class: 'n' }, it.name),
                    it.tags ? h('div', { class: 'tags' }, it.tags.map((t) => '#' + t).join(' ')) : null,
                    h('div', { class: 'p' }, ownedIt ? 'Owned' : `🐚 ${it.price}`),
                    h('div', null, buttons)));
            }
            m.appendChild(cards);
            if (state.giftMode && shop.kind !== 'food') m.appendChild(h('div', { class: 'mw-sub' }, '🎁 Your friends are with you: buying a gift for one of them costs the same. They love things that match their style!'));
            m.appendChild(h('div', { class: 'nav' }, h('div'), h('button', { class: 'big', onclick: () => { this.closeModal(); onClose(); } }, 'Leave shop')));
        };
        this._rerenderShop = render;
        render();
    }

    /** Settings: sliders and toggles; onChange(key, value). */
    openSettings(settings, onChange, onBack) {
        const m = this._modal();
        m.appendChild(h('h2', null, '⚙ Settings'));
        const slider = (label, key, min, max, step) => {
            const t = h('div', { class: 'mw-sub' }, `${label}: ${Math.round(settings[key] * 100)}%`);
            const r = h('input', { type: 'range', min, max, step, value: settings[key], oninput: () => { onChange(key, parseFloat(r.value)); t.textContent = `${label}: ${Math.round(settings[key] * 100)}%`; } });
            return [t, r];
        };
        const tog = (label, key) => {
            const b = h('button', { class: settings[key] ? 'on' : '', onclick: () => { onChange(key, !settings[key]); b.className = settings[key] ? 'on' : ''; b.textContent = `${label}: ${settings[key] ? 'On' : 'Off'}`; } }, `${label}: ${settings[key] ? 'On' : 'Off'}`);
            return b;
        };
        m.appendChild(h('div', { style: 'max-width:380px' }, ...slider('Music volume', 'music', 0, 1, 0.05), ...slider('Mouse sensitivity', 'sens', 0.3, 2.2, 0.05),
            h('div', { style: 'margin-top:10px' }, tog('Invert look', 'invertY'), tog('Glow (bloom)', 'bloom'), tog('Shadows', 'shadows'))));
        m.appendChild(h('div', { class: 'nav' }, h('div'), h('button', { class: 'big', onclick: () => { this.closeModal(); onBack && onBack(); } }, 'Back')));
    }

    /** A simple menu: title, optional subtitle, list of [label, fn, class]. */
    openMenu(title, sub, items, onClose) {
        const m = this._modal();
        m.appendChild(h('h2', null, title));
        if (sub) m.appendChild(h('div', { class: 'mw-sub' }, sub));
        m.appendChild(h('div', { style: 'display:flex;flex-direction:column;gap:6px;max-width:360px' }, items.map(([label, fn, cls]) => h('button', { class: cls || '', onclick: () => { fn(); } }, label))));
        this._menuClose = onClose;
    }

    /** The journal: data { quests: [{ title, desc, done, tracked, sub: [{text,done}], id, side }], achievements: Set, album: [{ id, name, img }], stats } */
    openJournal(data, onTrack, onClose) {
        let tab = data.tab || 'Quests';
        const render = () => {
            const m = this._modal();
            m.appendChild(h('h2', null, '📖 Dream Journal'));
            m.appendChild(h('div', { class: 'mw-tabs' }, ['Quests', 'Collection', 'Achievements', 'Controls'].map((t) => h('button', { class: t === tab ? 'on' : '', onclick: () => { tab = t; render(); } }, t))));
            if (tab === 'Quests') {
                const section = (label, list) => {
                    if (!list.length) return;
                    m.appendChild(h('h3', null, label));
                    for (const q of list) {
                        m.appendChild(h('div', { class: 'q' + (q.done ? ' done' : '') },
                            h('div', { class: 'qt' }, `${q.done ? '✅' : '◆'} ${q.title} `, q.done ? null : h('button', { class: q.tracked ? 'on' : '', onclick: () => { onTrack(q.id); q.tracked = !q.tracked; render(); } }, q.tracked ? '📌 Tracked' : '📍 Track')),
                            h('div', { class: 'mw-sub' }, q.desc),
                            q.done ? null : q.sub.map((s) => h('div', { class: 'qs' }, `${s.done ? '✔' : '○'} ${s.text}`))));
                    }
                };
                section('Main story', data.quests.filter((q) => !q.side));
                section('Side quests', data.quests.filter((q) => q.side));
            } else if (tab === 'Collection') {
                const S = data.stats;
                m.appendChild(h('h3', null, 'Things you have found'));
                const bars = [['🦪 Pearls', S.pearls, S.pearlTotal], ['🐚 Rare shells', S.shells, S.shellTotal], ['📍 Landmarks', S.places, S.placeTotal], ['🐟 Fish friends', S.fish, S.fishTotal], ['📸 Creatures photographed', S.photos, S.photoTotal], ['🏴‍☠️ Treasures dug up', S.treasures, S.treasureTotal], ['🌱 Plants grown', S.plants, S.plantTotal]];
                for (const [label, n, tot] of bars) m.appendChild(h('div', { class: 'q' }, `${label}: ${n} / ${tot}`, h('div', { class: 'bar' }, h('i', { style: `width:${Math.round((n / Math.max(1, tot)) * 100)}%` }))));
                m.appendChild(h('h3', null, 'Photo album'));
                m.appendChild(h('div', { class: 'photos' }, data.album.map((p) => h('div', { class: 'ph' }, p.img ? h('img', { src: p.img }) : '📷', h('span', null, p.name)))));
                if (!data.album.length) m.appendChild(h('div', { class: 'mw-sub' }, 'Press F to raise your camera and photograph the creatures of the reef.'));
            } else if (tab === 'Achievements') {
                for (const a of ACHIEVEMENTS) {
                    const got = data.achievements.has(a.id);
                    m.appendChild(h('div', { class: 'q' + (got ? '' : ' done') }, h('div', { class: 'qt' }, `${got ? '🏆' : '🔒'} ${a.name}`), h('div', { class: 'mw-sub' }, a.desc)));
                }
            } else {
                m.appendChild(h('div', { class: 'q' }, h('div', { class: 'qs' }, [
                    'WASD — swim where the camera looks · Space / C — up / down · Shift — sprint',
                    'Mouse — look (click the world to grab the mouse) · Arrow keys also turn',
                    'E — talk, open, pick up, dig (hold) · F — camera (click or Space to shoot)',
                    'G — dance · H — hide / show this help · J — journal · M — map · Esc — pause menu',
                    'Tip: the map (M) lets you swim straight to any place you have discovered.'
                ].map((t) => h('div', null, t)))));
            }
            m.appendChild(h('div', { class: 'nav' }, h('div'), h('button', { class: 'big', onclick: () => { this.closeModal(); onClose && onClose(); } }, 'Close')));
        };
        render();
    }

    // ---- Map ------------------------------------------------------------------------------------
    /**
     * data: { terrain: canvas, player: {x,z,yaw}, places: [{ id, name, x, z, known, icon }], markers: [{ x, z, icon }] }
     * onTravel(placeId) when a discovered place is clicked.
     */
    openMap(data, onTravel, worldR) {
        this._build();
        const box = this.$('mw-map');
        box.style.display = 'block';
        this.mapOpen = true;
        box.innerHTML = '';
        const S = Math.min(window.innerHeight - 90, window.innerWidth - 60, 760);
        const cv = h('canvas', { width: S, height: S });
        box.appendChild(h('div', { style: 'font-weight:700;margin:0 0 6px 4px' }, '🗺️ Mermaid World — click a discovered place to swim there  (M to close)'));
        box.appendChild(cv);
        const c = cv.getContext('2d');
        const half = worldR + 20;
        const toPx = (x, z) => [(x + half) / (half * 2) * S, (z + half) / (half * 2) * S];
        let hover = null;
        const draw = () => {
            c.clearRect(0, 0, S, S);
            c.drawImage(data.terrain, 0, 0, S, S);
            c.strokeStyle = 'rgba(255,255,255,0.35)';
            c.lineWidth = 2;
            c.beginPath();
            c.arc(S / 2, S / 2, (worldR / (half * 2)) * S, 0, Math.PI * 2);
            c.stroke();
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            for (const p of data.places) {
                const [px, py] = toPx(p.x, p.z);
                c.font = '20px "Segoe UI Emoji", sans-serif';
                c.globalAlpha = p.known ? 1 : 0.35;
                c.fillText(p.known ? p.icon : '❔', px, py);
                c.globalAlpha = 1;
                if (p.known && (hover === p || S > 620)) {
                    c.font = 'bold 12px "Trebuchet MS"';
                    c.lineWidth = 3;
                    c.strokeStyle = 'rgba(0,0,0,0.7)';
                    c.strokeText(p.name, px, py + 18);
                    c.fillStyle = '#fff';
                    c.fillText(p.name, px, py + 18);
                }
            }
            for (const mk of data.markers) {
                const [px, py] = toPx(mk.x, mk.z);
                c.font = '22px "Segoe UI Emoji", sans-serif';
                c.fillText(mk.icon || '⭐', px, py - 4);
            }
            const [ux, uy] = toPx(data.player.x, data.player.z);
            c.save();
            c.translate(ux, uy);
            c.rotate(Math.PI - data.player.yaw);
            c.fillStyle = '#ff9ff3';
            c.strokeStyle = '#fff';
            c.lineWidth = 2;
            c.beginPath();
            c.moveTo(0, -11);
            c.lineTo(8, 9);
            c.lineTo(0, 5);
            c.lineTo(-8, 9);
            c.closePath();
            c.fill();
            c.stroke();
            c.restore();
        };
        const find = (e) => {
            const r = cv.getBoundingClientRect();
            const mx = (e.clientX - r.left) * (S / r.width), my = (e.clientY - r.top) * (S / r.height);
            let best = null, bd = 22;
            for (const p of data.places) {
                const [px, py] = toPx(p.x, p.z);
                const d = Math.hypot(px - mx, py - my);
                if (d < bd) {
                    bd = d;
                    best = p;
                }
            }
            return best;
        };
        cv.addEventListener('mousemove', (e) => { hover = find(e); draw(); });
        cv.addEventListener('click', (e) => {
            const p = find(e);
            if (p && p.known) {
                this.closeMap();
                onTravel(p.id);
            }
        });
        draw();
    }

    closeMap() {
        if (!this.root) return;
        this.$('mw-map').style.display = 'none';
        this.mapOpen = false;
    }

    // ---- Photo viewfinder -----------------------------------------------------------------------
    setFinder(on, hint = '') {
        if (!this.root) return;
        this.finderOn = on;
        this.root.classList.toggle('photo', on);
        const f = this.$('mw-finder');
        f.style.display = on ? 'block' : 'none';
        f.querySelector('.hint').textContent = hint;
    }

    // ---- Minigame overlay ---------------------------------------------------------------------------
    /** Returns the container for a minigame; the game fills it. */
    openGame() {
        this._build();
        const g = this.$('mw-game');
        g.innerHTML = '';
        g.style.display = 'block';
        return g;
    }

    closeGame() {
        if (!this.root) return;
        const g = this.$('mw-game');
        g.style.display = 'none';
        g.innerHTML = '';
    }

    get gameOpen() {
        return !!this.root && this.$('mw-game').style.display === 'block';
    }
}

function clampN(v, a, b) {
    return Math.max(a, Math.min(b, v));
}
