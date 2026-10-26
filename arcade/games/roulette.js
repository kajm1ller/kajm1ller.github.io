/**
 * European roulette: single zero. Straight numbers pay 35:1, dozens and columns 2:1, the even
 * money bets 1:1.
 */

import { CHIP_COLORS } from '../arcadeUI.js';

export const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
export const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

/** What a bet on `key` returns (stake included) per unit when `n` comes up. */
export function rouletteReturn(key, n) {
    if (key.startsWith('n')) return Number(key.slice(1)) === n ? 36 : 0;
    if (n === 0) return 0;
    switch (key) {
        case 'red': return REDS.has(n) ? 2 : 0;
        case 'black': return REDS.has(n) ? 0 : 2;
        case 'odd': return n % 2 ? 2 : 0;
        case 'even': return n % 2 ? 0 : 2;
        case 'low': return n <= 18 ? 2 : 0;
        case 'high': return n >= 19 ? 2 : 0;
        case 'd1': return n <= 12 ? 3 : 0;
        case 'd2': return n >= 13 && n <= 24 ? 3 : 0;
        case 'd3': return n >= 25 ? 3 : 0;
        case 'c1': return n % 3 === 1 ? 3 : 0;
        case 'c2': return n % 3 === 2 ? 3 : 0;
        case 'c3': return n % 3 === 0 ? 3 : 0;
        default: return 0;
    }
}

const colorOf = (n) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');

const CSS = `
.rl-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 14px; overflow: auto; }
.rl-top { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; justify-content: center; }
.rl-wheel { width: clamp(220px, 30vw, 300px); aspect-ratio: 1; }
.rl-result { display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 120px; }
.rl-num { width: 84px; height: 84px; border-radius: 50%; display: grid; place-items: center; font-size: 36px; font-weight: 900; border: 4px solid rgba(255,255,255,0.8); }
.rl-num.red, .rl-board .red { background: #c8102e; } .rl-num.black, .rl-board .black { background: #16161c; } .rl-num.green, .rl-board .green { background: #0a8f4f; }
.rl-board { display: grid; grid-template-columns: 0.9fr repeat(12, 1fr) 0.9fr; grid-template-rows: repeat(3, clamp(30px, 5.2vh, 44px)) repeat(2, clamp(28px, 4.6vh, 38px));
  gap: 3px; width: min(100%, 760px); }
.rl-cell { position: relative; border-radius: 6px; display: grid; place-items: center; font-weight: 900; font-size: clamp(11px, 1.5vw, 15px); cursor: pointer;
  border: 1px solid rgba(255,255,255,0.18); background: rgba(0,0,0,0.15); transition: filter 0.1s; }
.rl-cell:hover { filter: brightness(1.3); }
.rl-cell.hit { box-shadow: 0 0 0 3px var(--cz-gold), 0 0 16px rgba(246,197,68,0.7); z-index: 1; }
.rl-cell .chipv { position: absolute; right: -4px; top: -6px; min-width: 22px; height: 22px; padding: 0 4px; border-radius: 11px; background: var(--c, #e0a526); color: #fff;
  font-size: 10px; display: grid; place-items: center; box-shadow: 0 0 0 2px #fff, 0 2px 4px rgba(0,0,0,0.5); z-index: 2; }
`;

export default {
    id: 'roulette', name: 'Roulette', cat: 'Table', icon: '🎡', tint: ['#c31432', '#240b36'],
    blurb: 'European single-zero roulette. Red or black, or go straight up for 35:1.',
    mount(stage, ctx) {
        const { el } = ctx;
        if (!document.getElementById('rl-css')) { const s = el('style'); s.id = 'rl-css'; s.textContent = CSS; document.head.append(s); }
        let chip = 5, spinning = false;
        const bets = new Map();
        const history = [];   // placed-bet undo stack: [key, amount]
        let lastBets = null;

        const chips = el('div', 'cz-chips');
        for (const c of [1, 5, 25, 100, 500, 1000]) {
            const b = el('button', 'cz-chip' + (c === chip ? ' sel' : ''), c >= 1000 ? c / 1000 + 'K' : String(c));
            b.style.setProperty('--c', CHIP_COLORS[c]);
            b.onclick = () => { chip = c; for (const o of chips.children) o.classList.toggle('sel', o === b); ctx.sfx.play('chip'); };
            chips.append(b);
        }
        const totalStat = ctx.stat('Total bet', '$0');
        const spinBtn = ctx.button('SPIN', 'go big', () => spin());
        const undoBtn = ctx.button('Undo', '', () => { if (spinning) return; const h = history.pop(); if (h) { addBet(h[0], -h[1], false); } });
        const clearBtn = ctx.button('Clear', '', () => { if (spinning) return; bets.clear(); history.length = 0; render(); });
        const dblBtn = ctx.button('2×', '', () => {
            if (spinning) return;
            if (total() * 2 > ctx.wallet.balance) return ctx.toast('Not enough money to double');
            for (const [k, v] of [...bets]) addBet(k, v);
        });
        const rebetBtn = ctx.button('Rebet', '', () => {
            if (spinning || !lastBets) return;
            bets.clear();
            for (const [k, v] of lastBets) bets.set(k, v);
            render();
        });
        const r1 = el('div', 'cz-row'); r1.append(undoBtn, clearBtn);
        const r2 = el('div', 'cz-row'); r2.append(dblBtn, rebetBtn);
        const info = el('div', 'cz-info');
        info.innerHTML = 'Pick a chip and click the table to bet (right-click removes). Numbers pay <b>35:1</b>, dozens and columns <b>2:1</b>, red/black, odd/even and halves <b>1:1</b>.';
        ctx.side.append(ctx.label('Chip'), chips, totalStat, spinBtn, r1, r2, info);

        const wrap = el('div', 'rl-wrap cz-felt');
        const top = el('div', 'rl-top');
        const canvas = el('canvas', 'rl-wheel');
        const result = el('div', 'rl-result');
        const num = el('div', 'rl-num green', '–');
        const hist = ctx.history(10);
        hist.style.flexWrap = 'wrap';
        hist.style.maxWidth = '160px';
        hist.style.justifyContent = 'center';
        result.append(num, hist);
        top.append(canvas, result);
        const board = el('div', 'rl-board');
        wrap.append(top, board);
        stage.append(wrap);

        // ---- Board ----
        const cells = new Map();
        const cell = (key, label, cls, col, row, colSpan = 1, rowSpan = 1) => {
            const c = el('div', 'rl-cell ' + (cls || ''), label);
            c.style.gridColumn = `${col} / span ${colSpan}`;
            c.style.gridRow = `${row} / span ${rowSpan}`;
            c.onclick = () => addBet(key, chip);
            c.oncontextmenu = (e) => { e.preventDefault(); if (!spinning && bets.has(key)) { bets.delete(key); render(); } };
            board.append(c);
            cells.set(key, c);
        };
        cell('n0', '0', 'green', 1, 1, 1, 3);
        for (let n = 1; n <= 36; n++) {
            const col = 2 + Math.floor((n - 1) / 3);
            const row = 3 - ((n - 1) % 3);
            cell('n' + n, String(n), colorOf(n), col, row);
        }
        cell('c3', '2:1', '', 14, 1); cell('c2', '2:1', '', 14, 2); cell('c1', '2:1', '', 14, 3);
        cell('d1', '1st 12', '', 2, 4, 4); cell('d2', '2nd 12', '', 6, 4, 4); cell('d3', '3rd 12', '', 10, 4, 4);
        cell('low', '1–18', '', 2, 5, 2); cell('even', 'EVEN', '', 4, 5, 2); cell('red', '◆', 'red', 6, 5, 2);
        cell('black', '◆', 'black', 8, 5, 2); cell('odd', 'ODD', '', 10, 5, 2); cell('high', '19–36', '', 12, 5, 2);

        const total = () => [...bets.values()].reduce((a, b) => a + b, 0);
        function addBet(key, amount, record = true) {
            if (spinning) return;
            if (amount > 0 && total() + amount > ctx.wallet.balance) { ctx.toast('Not enough money for that chip'); return; }
            const v = (bets.get(key) || 0) + amount;
            if (v <= 0) bets.delete(key); else bets.set(key, v);
            if (record && amount > 0) history.push([key, amount]);
            ctx.sfx.play('chip');
            render();
        }
        function render() {
            for (const [key, c] of cells) {
                let tag = c.querySelector('.chipv');
                const v = bets.get(key);
                if (!v) { if (tag) tag.remove(); continue; }
                if (!tag) { tag = el('span', 'chipv'); c.append(tag); }
                tag.textContent = v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'K' : String(v);
                const tier = [1000, 500, 100, 25, 5, 1].find((t) => v >= t) || 1;
                tag.style.setProperty('--c', CHIP_COLORS[tier]);
            }
            totalStat.set(ctx.money(total()));
        }

        // ---- Wheel ----
        const g = canvas.getContext('2d');
        let size = 0;
        const resize = () => {
            const r = canvas.getBoundingClientRect();
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            canvas.width = Math.max(1, r.width * dpr); canvas.height = Math.max(1, r.width * dpr);
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            size = r.width;
        };
        resize();
        window.addEventListener('resize', resize);
        const SEG = (Math.PI * 2) / WHEEL.length;
        let wheelA = 0, ballA = 0, ballR = 1;   // ballR: 1 = outer track, 0 = in the pocket
        let anim = null;

        const drawWheel = () => {
            if (!size) resize();
            const R = size / 2;
            g.clearRect(0, 0, size, size);
            g.save();
            g.translate(R, R);
            // Rim
            g.fillStyle = '#4a2a14';
            g.beginPath(); g.arc(0, 0, R - 2, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#2c170a';
            g.beginPath(); g.arc(0, 0, R * 0.86, 0, Math.PI * 2); g.fill();
            // Pockets
            g.save();
            g.rotate(wheelA);
            for (let i = 0; i < WHEEL.length; i++) {
                const a0 = i * SEG - SEG / 2 - Math.PI / 2;
                const n = WHEEL[i];
                g.fillStyle = n === 0 ? '#0a8f4f' : REDS.has(n) ? '#c8102e' : '#16161c';
                g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R * 0.82, a0, a0 + SEG); g.closePath(); g.fill();
                g.save();
                g.rotate(i * SEG);
                g.fillStyle = '#fff';
                g.font = `800 ${Math.max(8, R * 0.075)}px Segoe UI, sans-serif`;
                g.textAlign = 'center';
                g.fillText(String(n), 0, -R * 0.71);
                g.restore();
            }
            g.fillStyle = '#7a4a22';
            g.beginPath(); g.arc(0, 0, R * 0.55, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#c99a4a';
            g.beginPath(); g.arc(0, 0, R * 0.16, 0, Math.PI * 2); g.fill();
            for (let k = 0; k < 4; k++) {
                g.rotate(Math.PI / 2);
                g.fillStyle = '#e8c27a';
                g.fillRect(-R * 0.025, 0, R * 0.05, R * 0.42);
            }
            g.restore();
            // Ball
            const br = R * (0.62 + 0.3 * ballR);
            g.fillStyle = '#fff';
            g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 4;
            g.beginPath(); g.arc(Math.sin(ballA) * br, -Math.cos(ballA) * br, Math.max(4, R * 0.04), 0, Math.PI * 2); g.fill();
            g.shadowBlur = 0;
            g.restore();
        };
        ballA = 0.3;
        drawWheel();

        async function spin() {
            if (spinning) return;
            const stake = total();
            if (stake <= 0) { ctx.toast('Place a bet first: pick a chip and click the table'); return; }
            if (!ctx.wager(stake)) return;
            spinning = true;
            spinBtn.disabled = true;
            lastBets = new Map(bets);
            for (const c of cells.values()) c.classList.remove('hit');
            ctx.emit('spin');
            const n = WHEEL[Math.floor(ctx.rand() * WHEEL.length)];
            const idx = WHEEL.indexOf(n);
            const dur = 5.2;
            const w0 = wheelA, w1 = wheelA + Math.PI * 2 * (2 + ctx.rand());
            const b0 = ballA;
            // The ball ends in the pocket: its angle relative to the wheel is idx * SEG
            let b1 = w1 + idx * SEG;
            while (b1 > b0 - Math.PI * 2 * 5) b1 -= Math.PI * 2;
            let ticks = 0;
            await new Promise((res) => {
                ctx.loop((dt, t) => {
                    const k = Math.min(1, t / dur);
                    const ease = 1 - (1 - k) ** 3;
                    wheelA = w0 + (w1 - w0) * ease;
                    ballA = b0 + (b1 - b0) * (1 - (1 - k) ** 2.2);
                    ballR = k < 0.6 ? 1 : Math.max(0, 1 - (k - 0.6) / 0.3);
                    if (k > 0.55 && Math.floor(k * 40) > ticks) { ticks = Math.floor(k * 40); ctx.sfx.play('tick', { freq: 1400 }); }
                    drawWheel();
                    if (k >= 1) { res(); return false; }
                });
            });
            ballA = wheelA + idx * SEG;
            num.textContent = String(n);
            num.className = 'rl-num ' + colorOf(n);
            hist.push(String(n), n === 0 ? 'g' : REDS.has(n) ? 'r' : '');
            cells.get('n' + n).classList.add('hit');
            let ret = 0;
            for (const [k, v] of bets) {
                const r = rouletteReturn(k, n);
                if (r) cells.get(k).classList.add('hit');
                ret += v * r;
            }
            ctx.payout(ret, stake);
            const title = `${n} ${colorOf(n).toUpperCase()}`;
            if (ret > stake) ctx.banner(title, ret - stake, { mult: `returned ${ctx.money(ret)}`, big: ret >= stake * 10 });
            else if (ret > 0) ctx.banner(title, ret - stake, { mult: `returned ${ctx.money(ret)}`, lose: ret < stake });
            else { ctx.banner(title, -stake, { lose: true }); ctx.sfx.play('lose'); }
            bets.clear();
            history.length = 0;
            render();
            spinning = false;
            spinBtn.disabled = false;
        }

        render();
        return {
            busy: () => spinning,
            destroy: () => window.removeEventListener('resize', resize)
        };
    }
};
