/**
 * js/game/mermaid/mermaidGames.js
 *
 * The DOM minigames of Mermaid World:
 *   RhythmGame   falling notes on four lanes (D F J K), timed against the music (Gerald's battle, the Grotto, the Arcade)
 *   MemoryGame   flip shells and match the pairs (Clam Arcade)
 *   BubbleGame   pop bubbles before they escape, avoid the urchins (Clam Arcade)
 *   GlyphGame    the temple's Simon-says: watch the glyphs light up, repeat them
 * Each has start() -> Promise (the result), onKey(e) (forwarded by the world, which owns the keyboard)
 * and cancel().
 */

import { mulberry32, clamp, shade } from './mermaidKit.js';
import { GLYPHS } from './mermaidData.js';

const el = (tag, style, text) => {
    const e = document.createElement(tag);
    if (style) e.style.cssText = style;
    if (text !== undefined) e.textContent = text;
    return e;
};

const BTN = 'pointer-events:auto;font:inherit;color:#20124d;cursor:pointer;border:none;background:linear-gradient(135deg,#ff7eb3,#7afcff);border-radius:12px;padding:10px 22px;font-weight:700;font-size:17px;margin:6px;';
const TITLE = 'font-size:26px;font-weight:700;text-shadow:0 2px 8px rgba(0,0,0,0.5);margin:12px 0 4px;text-align:center;';

class Game {
    constructor(host, audio) {
        this.host = host;
        this.audio = audio;
        this.done = false;
        this._resolve = null;
        this.raf = 0;
    }

    start() {
        return new Promise((res) => {
            this._resolve = res;
            this.setup();
        });
    }

    finish(result) {
        if (this.done) return;
        this.done = true;
        cancelAnimationFrame(this.raf);
        this.cleanup && this.cleanup();
        this._resolve(result);
    }

    cancel() {
        this.finish({ cancelled: true });
    }

    onKey() {}
}

// ================================================================================================
// Rhythm
// ================================================================================================
const LANES = ['D', 'F', 'J', 'K'];
const LANE_COLORS = ['#ff7eb3', '#feca57', '#48dbfb', '#55efc4'];

export function makeChart(song) {
    const rnd = mulberry32(song.seed);
    const notes = [];
    let last = -1, lastBeat = -9;
    for (let b = 4; b < song.beats; b++) {
        for (const off of [0, 0.5]) {
            const t = b + off;
            if (rnd() < song.density * (off ? 0.55 : 1) * (b % 4 === 0 ? 1.3 : 1) && t - lastBeat >= 0.5) {
                let lane = Math.floor(rnd() * 4);
                if (lane === last && rnd() < 0.7) lane = (lane + 1 + Math.floor(rnd() * 3)) % 4;
                notes.push({ beat: t, lane, hit: false, missed: false });
                last = lane;
                lastBeat = t;
            }
        }
    }
    return notes;
}

export class RhythmGame extends Game {
    constructor(host, audio, song, opts = {}) {
        super(host, audio);
        this.song = song;
        this.opts = opts;
        this.notes = makeChart(song);
        this.stats = { perfect: 0, good: 0, miss: 0, combo: 0, maxCombo: 0, score: 0 };
        this.popups = [];
        this.pressed = [0, 0, 0, 0];
        this.travel = 1.7;
    }

    now() {
        return this.audio ? this.audio.now() : performance.now() / 1000;
    }

    setup() {
        const H = this.host;
        H.innerHTML = '';
        H.appendChild(el('div', TITLE, `🎵 ${this.song.name}`));
        H.appendChild(el('div', 'text-align:center;opacity:.85;margin-bottom:6px', 'Press D F J K as the notes reach the line (or click the lanes). Esc to give up.'));
        this.canvas = el('canvas', 'display:block;margin:0 auto;border-radius:16px;border:2px solid rgba(255,255,255,0.4);background:#0b1636;pointer-events:auto;');
        this.canvas.width = 560;
        this.canvas.height = Math.min(520, window.innerHeight - 160);
        H.appendChild(this.canvas);
        this.canvas.addEventListener('pointerdown', (e) => {
            const r = this.canvas.getBoundingClientRect();
            const lane = clamp(Math.floor(((e.clientX - r.left) / r.width) * 4), 0, 3);
            this.press(lane);
        });
        // Music: start the style and begin the chart four beats after its first beat
        let spb = 60 / this.song.bpm;
        if (this.audio) {
            this.audio.setStyle(this.song.style);
            this.audio.beat = 0;
            this.audio.next = this.audio.now() + 0.3;
            spb = 60 / this.audio.cfg.bpm;
            this.t0 = this.audio.next;
        } else {
            this.t0 = performance.now() / 1000 + 0.3;
        }
        this.spb = spb;
        this.endT = this.t0 + (this.song.beats + 3) * spb;
        const loop = () => {
            this.raf = requestAnimationFrame(loop);
            this.frame();
        };
        loop();
    }

    beatTime(b) {
        return this.t0 + b * this.spb;
    }

    press(lane) {
        if (this.done) return;
        this.pressed[lane] = 0.12;
        const now = this.now();
        // the nearest unhit note in this lane
        let best = null, bd = 1e9;
        for (const n of this.notes) {
            if (n.hit || n.missed || n.lane !== lane) continue;
            const d = Math.abs(this.beatTime(n.beat) - now);
            if (d < bd) {
                bd = d;
                best = n;
            }
        }
        if (!best || bd > 0.16) {
            if (this.audio) this.audio.laneNote(lane, false);
            return;
        }
        best.hit = true;
        const S = this.stats;
        if (bd <= 0.075) {
            S.perfect++;
            S.score += 100 + S.combo * 2;
            this.pop(lane, 'PERFECT', '#ffeaa7');
        } else {
            S.good++;
            S.score += 50;
            this.pop(lane, 'GOOD', '#74b9ff');
        }
        S.combo++;
        S.maxCombo = Math.max(S.maxCombo, S.combo);
        if (this.audio) this.audio.laneNote(lane, true);
    }

    pop(lane, text, color) {
        this.popups.push({ lane, text, color, t: 0 });
    }

    onKey(e) {
        if (e.type !== 'keydown' || e.repeat) return;
        const k = e.key.toLowerCase();
        if (k === 'escape') {
            this.finish({ cancelled: true });
            return;
        }
        const lane = ['d', 'f', 'j', 'k'].indexOf(k);
        if (lane >= 0) this.press(lane);
    }

    frame() {
        const c = this.canvas.getContext('2d');
        const W = this.canvas.width, Hh = this.canvas.height;
        const now = this.now();
        const lineY = Hh - 90, laneW = W / 4;
        // misses
        for (const n of this.notes) {
            if (!n.hit && !n.missed && this.beatTime(n.beat) < now - 0.17) {
                n.missed = true;
                this.stats.miss++;
                this.stats.combo = 0;
                this.pop(n.lane, 'MISS', '#ff7675');
            }
        }
        c.clearRect(0, 0, W, Hh);
        const bg = c.createLinearGradient(0, 0, 0, Hh);
        bg.addColorStop(0, '#0b1636');
        bg.addColorStop(1, '#27135a');
        c.fillStyle = bg;
        c.fillRect(0, 0, W, Hh);
        for (let i = 0; i < 4; i++) {
            c.fillStyle = this.pressed[i] > 0 ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.04)';
            c.fillRect(i * laneW + 2, 0, laneW - 4, Hh);
            this.pressed[i] = Math.max(0, this.pressed[i] - 1 / 60);
        }
        // hit line and keys
        c.strokeStyle = 'rgba(255,255,255,0.8)';
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(0, lineY);
        c.lineTo(W, lineY);
        c.stroke();
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        for (let i = 0; i < 4; i++) {
            c.fillStyle = LANE_COLORS[i];
            c.globalAlpha = this.pressed[i] > 0 ? 1 : 0.6;
            c.beginPath();
            c.arc(i * laneW + laneW / 2, lineY, 26, 0, Math.PI * 2);
            c.fill();
            c.globalAlpha = 1;
            c.fillStyle = '#20124d';
            c.font = 'bold 20px "Trebuchet MS"';
            c.fillText(LANES[i], i * laneW + laneW / 2, lineY);
        }
        // notes
        for (const n of this.notes) {
            if (n.hit) continue;
            const dt = this.beatTime(n.beat) - now;
            if (dt > this.travel || dt < -0.4) continue;
            const y = lineY - (dt / this.travel) * (lineY + 30);
            c.globalAlpha = n.missed ? 0.3 : 1;
            c.fillStyle = LANE_COLORS[n.lane];
            c.beginPath();
            c.arc(n.lane * laneW + laneW / 2, y, 22, 0, Math.PI * 2);
            c.fill();
            c.strokeStyle = '#fff';
            c.lineWidth = 3;
            c.stroke();
            c.globalAlpha = 1;
        }
        // popups
        for (const p of this.popups) {
            p.t += 1 / 60;
            c.globalAlpha = clamp(1 - p.t * 1.6, 0, 1);
            c.fillStyle = p.color;
            c.font = 'bold 18px "Trebuchet MS"';
            c.fillText(p.text, p.lane * laneW + laneW / 2, lineY - 44 - p.t * 40);
            c.globalAlpha = 1;
        }
        this.popups = this.popups.filter((p) => p.t < 0.7);
        // HUD
        c.fillStyle = '#fff';
        c.textAlign = 'left';
        c.font = 'bold 20px "Trebuchet MS"';
        c.fillText(`Score ${this.stats.score}`, 12, 24);
        c.textAlign = 'right';
        c.fillText(`Combo ${this.stats.combo}`, W - 12, 24);
        const prog = clamp((now - this.t0) / (this.endT - this.t0), 0, 1);
        c.fillStyle = 'rgba(255,255,255,0.2)';
        c.fillRect(12, 40, W - 24, 6);
        c.fillStyle = '#ff9ff3';
        c.fillRect(12, 40, (W - 24) * prog, 6);
        if (now < this.beatTime(4) - 0.2 && now < this.t0 + this.spb * 3) {
            c.textAlign = 'center';
            c.font = 'bold 40px "Trebuchet MS"';
            c.fillStyle = '#fff';
            c.fillText(`${Math.max(1, Math.ceil((this.beatTime(4) - now) / this.spb))}`, W / 2, Hh / 2 - 40);
        }
        if (now >= this.endT) this.results();
    }

    results() {
        if (this.done || this.showing) return;
        this.showing = true;
        cancelAnimationFrame(this.raf);
        const S = this.stats;
        const total = this.notes.length || 1;
        const acc = (S.perfect + S.good * 0.6) / total;
        const grade = acc > 0.93 ? 'S' : acc > 0.82 ? 'A' : acc > 0.68 ? 'B' : acc > 0.5 ? 'C' : 'D';
        const passed = acc >= (this.opts.pass ?? 0.6);
        this.host.innerHTML = '';
        this.host.appendChild(el('div', TITLE, passed ? '🌟 Nicely played!' : '😅 Not quite...'));
        const box = el('div', 'margin:10px auto;max-width:420px;text-align:center;font-size:18px;line-height:1.7;background:rgba(255,255,255,0.1);border-radius:16px;padding:18px');
        box.innerHTML = `<div style="font-size:64px;font-weight:700">${grade}</div>Perfect ${S.perfect} · Good ${S.good} · Miss ${S.miss}<br>Max combo ${S.maxCombo}<br>Accuracy ${Math.round(acc * 100)}% · Score ${S.score}`;
        this.host.appendChild(box);
        const btn = el('button', BTN, passed ? 'Continue' : 'Back');
        btn.addEventListener('click', () => this.finish({ passed, accuracy: acc, grade, score: S.score, stats: S }));
        const wrap = el('div', 'text-align:center');
        wrap.appendChild(btn);
        this.host.appendChild(wrap);
        if (this.audio) this.audio[passed ? 'success' : 'fail']();
    }
}

// ================================================================================================
// Shell memory
// ================================================================================================
export class MemoryGame extends Game {
    constructor(host, audio, pairs = 8) {
        super(host, audio);
        this.pairs = pairs;
    }

    setup() {
        const H = this.host;
        H.innerHTML = '';
        H.appendChild(el('div', TITLE, '🐚 Shell Match'));
        this.info = el('div', 'text-align:center;margin-bottom:8px;font-size:15px');
        H.appendChild(this.info);
        const icons = ['🦀', '🐠', '🐙', '🐢', '🦑', '🐚', '⭐', '🦞', '🐬', '🪸', '🦈', '🐡'].slice(0, this.pairs);
        const deck = [...icons, ...icons].map((v, i) => ({ v, i, up: false, done: false }));
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        this.deck = deck;
        this.first = null;
        this.lock = false;
        this.moves = 0;
        this.t0 = performance.now();
        const cols = 4;
        const grid = el('div', `display:grid;grid-template-columns:repeat(${cols},96px);gap:10px;justify-content:center;margin:8px auto`);
        deck.forEach((c) => {
            const b = el('div', 'pointer-events:auto;width:96px;height:96px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:46px;cursor:pointer;border:2px solid #fff;background:linear-gradient(135deg,#a29bfe,#fd79a8);transition:transform .15s;', '🐚');
            b.addEventListener('click', () => this.flip(c, b));
            c.el = b;
            grid.appendChild(b);
        });
        H.appendChild(grid);
        const quit = el('button', BTN + 'padding:6px 16px;font-size:14px', 'Quit');
        quit.addEventListener('click', () => this.cancel());
        const w = el('div', 'text-align:center');
        w.appendChild(quit);
        H.appendChild(w);
        this.update();
    }

    update() {
        this.info.textContent = `Moves: ${this.moves} · Pairs: ${this.deck.filter((c) => c.done).length / 2}/${this.pairs}`;
    }

    flip(c, b) {
        if (this.lock || c.up || c.done) return;
        c.up = true;
        b.textContent = c.v;
        b.style.background = 'linear-gradient(135deg,#ffeaa7,#fab1a0)';
        if (this.audio) this.audio.click();
        if (!this.first) {
            this.first = c;
            return;
        }
        this.moves++;
        const a = this.first;
        this.first = null;
        if (a.v === c.v) {
            a.done = c.done = true;
            if (this.audio) this.audio.pickup();
            a.el.style.opacity = c.el.style.opacity = '0.55';
            this.update();
            if (this.deck.every((x) => x.done)) {
                const secs = (performance.now() - this.t0) / 1000;
                const tickets = clamp(Math.round(14 - (this.moves - this.pairs) * 0.8 - secs / 25), 3, 14);
                setTimeout(() => this.showResult(tickets), 500);
            }
        } else {
            this.lock = true;
            setTimeout(() => {
                for (const x of [a, c]) {
                    x.up = false;
                    x.el.textContent = '🐚';
                    x.el.style.background = 'linear-gradient(135deg,#a29bfe,#fd79a8)';
                }
                this.lock = false;
                this.update();
            }, 700);
        }
        this.update();
    }

    showResult(tickets) {
        this.host.innerHTML = '';
        this.host.appendChild(el('div', TITLE, '🎉 All matched!'));
        const box = el('div', 'margin:10px auto;max-width:380px;text-align:center;font-size:19px;background:rgba(255,255,255,0.1);border-radius:16px;padding:18px;line-height:1.8');
        box.innerHTML = `Moves: ${this.moves}<br>🎟️ You won ${tickets} tickets!`;
        this.host.appendChild(box);
        const b = el('button', BTN, 'Collect tickets');
        b.addEventListener('click', () => this.finish({ tickets, moves: this.moves, passed: true }));
        const w = el('div', 'text-align:center');
        w.appendChild(b);
        this.host.appendChild(w);
        if (this.audio) this.audio.success();
    }
}

// ================================================================================================
// Bubble pop
// ================================================================================================
export class BubbleGame extends Game {
    constructor(host, audio, seconds = 30) {
        super(host, audio);
        this.seconds = seconds;
    }

    setup() {
        const H = this.host;
        H.innerHTML = '';
        H.appendChild(el('div', TITLE, '🫧 Bubble Pop'));
        this.info = el('div', 'text-align:center;margin-bottom:6px;font-size:16px');
        H.appendChild(this.info);
        this.field = el('div', 'position:relative;width:min(640px,92vw);height:min(420px,60vh);margin:0 auto;border-radius:18px;border:2px solid rgba(255,255,255,0.5);background:linear-gradient(180deg,#0a4a7a,#0b2a5a);overflow:hidden;pointer-events:auto;');
        H.appendChild(this.field);
        this.bubbles = [];
        this.score = 0;
        this.popped = 0;
        this.timeLeft = this.seconds;
        this.spawnT = 0;
        this.last = performance.now();
        this.hint = el('div', 'text-align:center;opacity:.8;margin-top:8px;font-size:13px', 'Click bubbles to pop them. Golden ones are worth more, urchins cost you!');
        H.appendChild(this.hint);
        const loop = (now) => {
            this.raf = requestAnimationFrame(loop);
            const dt = Math.min(0.05, (now - this.last) / 1000);
            this.last = now;
            this.step(dt);
        };
        this.raf = requestAnimationFrame(loop);
    }

    spawn() {
        const r = Math.random();
        const kind = r < 0.1 ? 'gold' : r < 0.22 ? 'urchin' : 'normal';
        const size = kind === 'normal' ? 36 + Math.random() * 34 : 46;
        const b = el('div', `position:absolute;width:${size}px;height:${size}px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:${size * 0.6}px;`);
        if (kind === 'normal') b.style.cssText += 'background:radial-gradient(circle at 30% 30%,rgba(255,255,255,0.9),rgba(160,230,255,0.35));border:2px solid rgba(255,255,255,0.8);';
        else if (kind === 'gold') b.style.cssText += 'background:radial-gradient(circle at 30% 30%,#fff7c0,#f1c40f);border:2px solid #fff;box-shadow:0 0 14px #ffd54f;';
        else {
            b.textContent = '🦔';
            b.style.cssText += 'background:rgba(120,60,200,0.3);border:2px dashed #c9a8ff;';
        }
        const o = { el: b, x: Math.random() * (this.field.clientWidth - size), y: this.field.clientHeight + 10, vy: 60 + Math.random() * 90, size, kind, sway: Math.random() * 6 };
        b.addEventListener('pointerdown', () => this.pop(o));
        this.field.appendChild(b);
        this.bubbles.push(o);
    }

    pop(o) {
        if (o.dead) return;
        o.dead = true;
        o.el.remove();
        if (o.kind === 'urchin') {
            this.score = Math.max(0, this.score - 3);
            if (this.audio) this.audio.fail();
        } else {
            this.score += o.kind === 'gold' ? 5 : 1;
            this.popped++;
            if (this.audio) this.audio.bubble();
        }
    }

    step(dt) {
        this.timeLeft -= dt;
        this.spawnT -= dt;
        if (this.spawnT <= 0) {
            this.spawnT = 0.3 + Math.random() * 0.4;
            this.spawn();
        }
        for (const o of this.bubbles) {
            if (o.dead) continue;
            o.y -= o.vy * dt;
            o.sway += dt * 2;
            o.el.style.transform = `translate(${o.x + Math.sin(o.sway) * 10}px, ${o.y}px)`;
            o.el.style.left = '0px';
            o.el.style.top = '0px';
            if (o.y < -o.size) {
                o.dead = true;
                o.el.remove();
            }
        }
        this.bubbles = this.bubbles.filter((o) => !o.dead);
        this.info.textContent = `Time ${Math.max(0, Math.ceil(this.timeLeft))}s · Score ${this.score}`;
        if (this.timeLeft <= 0) this.end();
    }

    end() {
        if (this.ended) return;
        this.ended = true;
        cancelAnimationFrame(this.raf);
        const tickets = clamp(Math.round(this.score / 3), 1, 16);
        this.host.innerHTML = '';
        this.host.appendChild(el('div', TITLE, '⏰ Time!'));
        const box = el('div', 'margin:10px auto;max-width:380px;text-align:center;font-size:19px;background:rgba(255,255,255,0.1);border-radius:16px;padding:18px;line-height:1.8');
        box.innerHTML = `Bubbles popped: ${this.popped}<br>Score: ${this.score}<br>🎟️ ${tickets} tickets!`;
        this.host.appendChild(box);
        const b = el('button', BTN, 'Collect tickets');
        b.addEventListener('click', () => this.finish({ tickets, score: this.score, passed: true }));
        const w = el('div', 'text-align:center');
        w.appendChild(b);
        this.host.appendChild(w);
        if (this.audio) this.audio.success();
    }

    onKey(e) {
        if (e.type === 'keydown' && e.key === 'Escape') this.cancel();
    }
}

// ================================================================================================
// The temple's glyph puzzle
// ================================================================================================
export class GlyphGame extends Game {
    /** onFlash(i, on) lights the matching pillar in the world. */
    constructor(host, audio, onFlash) {
        super(host, audio);
        this.onFlash = onFlash || (() => {});
        this.rounds = [3, 4, 5];
    }

    setup() {
        const H = this.host;
        H.innerHTML = '';
        H.appendChild(el('div', TITLE, '🗿 The Temple Wakes'));
        this.info = el('div', 'text-align:center;margin-bottom:10px;font-size:16px');
        H.appendChild(this.info);
        const row = el('div', 'display:flex;justify-content:center;gap:16px;flex-wrap:wrap');
        this.btns = GLYPHS.map((g, i) => {
            const b = el('div', `pointer-events:auto;width:120px;height:120px;border-radius:20px;border:3px solid ${g.color};background:#1d2240;color:${g.color};font-size:68px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .12s;`, g.char);
            b.addEventListener('click', () => this.input(i));
            row.appendChild(b);
            return b;
        });
        H.appendChild(row);
        const quit = el('button', BTN + 'padding:6px 16px;font-size:14px;margin-top:16px', 'Step away');
        quit.addEventListener('click', () => this.cancel());
        const w = el('div', 'text-align:center');
        w.appendChild(quit);
        H.appendChild(w);
        this.round = 0;
        this.beginRound();
    }

    light(i, on) {
        const b = this.btns[i];
        b.style.background = on ? GLYPHS[i].color : '#1d2240';
        b.style.color = on ? '#1d2240' : GLYPHS[i].color;
        b.style.transform = on ? 'scale(1.1)' : 'none';
        this.onFlash(i, on);
        if (on && this.audio) this.audio.laneNote(i, true);
    }

    async beginRound() {
        const len = this.rounds[this.round];
        this.seq = Array.from({ length: len }, () => Math.floor(Math.random() * 4));
        this.pos = 0;
        this.accepting = false;
        this.info.textContent = `Round ${this.round + 1} of ${this.rounds.length}: watch...`;
        await new Promise((r) => setTimeout(r, 900));
        for (const i of this.seq) {
            if (this.done) return;
            this.light(i, true);
            await new Promise((r) => setTimeout(r, 520));
            this.light(i, false);
            await new Promise((r) => setTimeout(r, 220));
        }
        if (this.done) return;
        this.accepting = true;
        this.info.textContent = `Round ${this.round + 1} of ${this.rounds.length}: your turn!`;
    }

    async input(i) {
        if (!this.accepting || this.done) return;
        this.light(i, true);
        setTimeout(() => this.light(i, false), 180);
        if (i !== this.seq[this.pos]) {
            this.accepting = false;
            this.info.textContent = 'The glyphs flicker and fade... try again.';
            if (this.audio) this.audio.fail();
            await new Promise((r) => setTimeout(r, 1200));
            if (!this.done) this.beginRound();
            return;
        }
        this.pos++;
        if (this.pos >= this.seq.length) {
            this.accepting = false;
            if (this.audio) this.audio.chime();
            this.round++;
            await new Promise((r) => setTimeout(r, 700));
            if (this.done) return;
            if (this.round >= this.rounds.length) {
                for (let k = 0; k < 4; k++) this.onFlash(k, true);
                if (this.audio) this.audio.success();
                this.finish({ passed: true });
            } else this.beginRound();
        }
    }

    cleanup() {
        for (let k = 0; k < 4; k++) this.onFlash(k, false);
    }

    onKey(e) {
        if (e.type !== 'keydown') return;
        if (e.key === 'Escape') this.cancel();
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= 4) this.input(n - 1);
    }
}
