/**
 * Slots: "Kaj's Fortune", five reels, three rows, ten paylines. Wilds stand in for anything but
 * the scatter; three or more scatters anywhere pay and start ten free spins at double pay.
 */

export const SYMBOLS = [
    { id: 'cherry', icon: '🍒', w: 25, pays: [10, 30, 80] },
    { id: 'lemon', icon: '🍋', w: 23, pays: [10, 30, 80] },
    { id: 'orange', icon: '🍊', w: 20, pays: [15, 40, 115] },
    { id: 'grape', icon: '🍇', w: 16, pays: [20, 60, 175] },
    { id: 'bell', icon: '🔔', w: 12, pays: [30, 95, 290] },
    { id: 'star', icon: '⭐', w: 9, pays: [50, 155, 485] },
    { id: 'gem', icon: '💎', w: 6, pays: [75, 290, 970] },
    { id: 'seven', icon: '7️⃣', w: 4, pays: [155, 580, 1940] },
    { id: 'wild', icon: '🃏', w: 3, pays: [200, 1000, 4000], wild: true },
    { id: 'scatter', icon: '🎰', w: 3, pays: [2, 10, 50], scatter: true } // × total bet
];
export const LINES = [
    [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
    [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [1, 0, 1, 2, 1]
];
export const FREE_SPINS = 10;
export const FREE_SPIN_MULT = 2;

const TOTAL_W = SYMBOLS.reduce((t, s) => t + s.w, 0);
function pickSymbol(r) {
    let x = r() * TOTAL_W;
    for (let i = 0; i < SYMBOLS.length; i++) {
        x -= SYMBOLS[i].w;
        if (x < 0) return i;
    }
    return 0;
}

/**
 * One spin. grid[reel][row] = symbol index.
 * @returns {{ grid, wins: Array<{line, sym, count, mult}>, lineMult, scatter: {count, mult}, freeSpins }}
 *   lineMult is in line bets (bet / 10), scatter.mult in total bets
 */
export function spinSlots(r) {
    const grid = [];
    for (let reel = 0; reel < 5; reel++) grid.push([pickSymbol(r), pickSymbol(r), pickSymbol(r)]);
    const wins = [];
    let lineMult = 0;
    LINES.forEach((line, li) => {
        const syms = line.map((row, reel) => grid[reel][row]);
        // Wilds alone at the start of the line
        let wildRun = 0;
        while (wildRun < 5 && SYMBOLS[syms[wildRun]].wild) wildRun++;
        const target = syms.find((s) => !SYMBOLS[s].wild);
        let best = null;
        if (wildRun >= 3) best = { sym: syms[0], count: wildRun, mult: SYMBOLS[syms[0]].pays[wildRun - 3] };
        if (target !== undefined && !SYMBOLS[target].scatter) {
            let n = 0;
            while (n < 5 && (syms[n] === target || SYMBOLS[syms[n]].wild)) n++;
            if (n >= 3) {
                const m = SYMBOLS[target].pays[n - 3];
                if (!best || m > best.mult) best = { sym: target, count: n, mult: m };
            }
        }
        if (best) {
            wins.push({ line: li, ...best });
            lineMult += best.mult;
        }
    });
    const scatterIdx = SYMBOLS.findIndex((s) => s.scatter);
    let count = 0;
    for (const reel of grid) for (const s of reel) if (s === scatterIdx) count++;
    const scatter = { count, mult: count >= 3 ? SYMBOLS[scatterIdx].pays[Math.min(5, count) - 3] : 0 };
    return { grid, wins, lineMult, scatter, freeSpins: count >= 3 ? FREE_SPINS : 0 };
}

/** What a spin pays, stake included, for a total bet. */
export const slotPayout = (res, bet, free = false) => bet * (res.lineMult / LINES.length + res.scatter.mult) * (free ? FREE_SPIN_MULT : 1);

const CSS = `
.sl-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 18px;
  background: radial-gradient(ellipse at 50% 0%, #4a1f6b, #1b1029 70%); }
.sl-title { font-family: Georgia, serif; font-size: clamp(22px, 3.4vw, 34px); font-weight: 700; letter-spacing: 3px; margin-bottom: 12px;
  background: linear-gradient(180deg, #fff1b8, #f6c544 50%, #b8780c); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 2px 0 #5a2b00); }
.sl-machine { position: relative; padding: 14px; border-radius: 22px; background: linear-gradient(180deg, #f6c544, #a8650b);
  box-shadow: 0 0 0 4px #5a2b00, 0 0 40px rgba(246,197,68,0.35), inset 0 2px 0 #fff3c4; width: min(100%, 620px); }
.sl-lights { position: absolute; inset: 4px; border-radius: 18px; pointer-events: none;
  background: radial-gradient(circle, #fff 0 2px, transparent 3px) 0 0 / 22px 22px; opacity: 0.55; animation: slLights 0.8s steps(2) infinite; }
@keyframes slLights { 50% { background-position: 11px 0; } }
.sl-reels { position: relative; display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; background: #12091d; border-radius: 12px; padding: 8px; }
.sl-reel { position: relative; overflow: hidden; height: calc(var(--cell) * 3); border-radius: 8px;
  background: linear-gradient(180deg, #e9e3f2, #fff 25%, #fff 75%, #e9e3f2); }
.sl-strip { position: absolute; left: 0; right: 0; top: 0; will-change: transform; }
.sl-cell { height: var(--cell); display: grid; place-items: center; font-size: calc(var(--cell) * 0.58); position: relative; }
.sl-cell.hit { animation: slHit 0.6s ease-in-out infinite alternate; }
.sl-cell.hit::after { content: ''; position: absolute; inset: 3px; border-radius: 10px; border: 3px solid #f6c544; box-shadow: 0 0 14px #f6c544; }
@keyframes slHit { to { transform: scale(1.12); } }
.sl-lines { position: absolute; inset: 8px; pointer-events: none; }
.sl-msg { margin-top: 14px; min-height: 28px; font-weight: 800; font-size: 18px; color: #fff; text-align: center; }
.sl-msg b { color: var(--cz-gold); }
.sl-free { position: absolute; top: -14px; left: 50%; transform: translateX(-50%); background: #ff3d8e; padding: 4px 12px; border-radius: 999px;
  font-weight: 900; font-size: 12px; letter-spacing: 1px; box-shadow: 0 2px 8px rgba(0,0,0,0.4); display: none; }
.sl-pay { display: grid; grid-template-columns: auto 1fr 1fr 1fr; gap: 4px 10px; font-size: 12px; font-variant-numeric: tabular-nums; }
.sl-pay div { color: var(--cz-dim); } .sl-pay .ic { font-size: 18px; }
`;

export default {
    id: 'slots', name: "Kaj's Fortune", cat: 'Slots', icon: '🎰', tint: ['#7b2ff7', '#f107a3'], hot: true,
    blurb: '5 reels, 10 lines, wilds, free spins at double pay.',
    mount(stage, ctx) {
        const { el } = ctx;
        if (!document.getElementById('sl-css')) { const s = el('style'); s.id = 'sl-css'; s.textContent = CSS; document.head.append(s); }
        const bet = ctx.betPanel({ initial: 10, min: 0.1 });
        let freeLeft = 0, spinning = false, auto = 0, lastStake = 0;
        let pending = null; // the spin on screen, paid when the reels stop
        const lastWin = ctx.stat('Last win', '$0');
        const freeStat = ctx.stat('Free spins', '0');
        const spinBtn = ctx.button('SPIN', 'go big', () => spin());
        const autoSeg = ctx.segmented({ 0: 'Auto off', 10: '×10', 25: '×25', 100: '×100' }, 0, (v) => { auto = v; if (v && !spinning) spin(); });
        const pay = el('div', 'sl-pay');
        pay.append(el('div', '', ''), el('div', '', '×3'), el('div', '', '×4'), el('div', '', '×5'));
        for (const s of SYMBOLS) {
            pay.append(el('div', 'ic', s.icon));
            for (const p of s.pays) pay.append(el('div', '', s.scatter ? `${p}× bet` : `${(p / LINES.length).toFixed(p < 10 ? 1 : 0)}×`));
        }
        const info = el('div', 'cz-info');
        info.innerHTML = '<b>🃏 Wild</b> replaces any symbol except 🎰. <b>3+ 🎰</b> anywhere pays and gives <b>10 free spins</b> with every win doubled. Line pays are × your total bet.';
        ctx.side.append(bet, spinBtn, ctx.label('Auto spin'), autoSeg, lastWin, freeStat, ctx.label('Paytable'), pay, info);

        const wrap = el('div', 'sl-wrap');
        const title = el('div', 'sl-title', "KAJ'S FORTUNE");
        const machine = el('div', 'sl-machine');
        const free = el('div', 'sl-free', 'FREE SPINS');
        const reelsEl = el('div', 'sl-reels');
        const svgNS = 'http://www.w3.org/2000/svg';
        const lines = document.createElementNS(svgNS, 'svg');
        lines.setAttribute('class', 'sl-lines');
        lines.setAttribute('viewBox', '0 0 500 300');
        lines.setAttribute('preserveAspectRatio', 'none');
        const msg = el('div', 'sl-msg', 'Good luck!');
        const reels = [];
        for (let i = 0; i < 5; i++) {
            const reel = el('div', 'sl-reel');
            const strip = el('div', 'sl-strip');
            reel.append(strip);
            reelsEl.append(reel);
            reels.push({ reel, strip, cells: [] });
        }
        reelsEl.append(lines);
        machine.append(el('div', 'sl-lights'), free, reelsEl);
        wrap.append(title, machine, msg);
        stage.append(wrap);

        const cellSize = () => Math.max(48, Math.min(104, (machine.clientWidth - 28 - 16 - 24) / 5));
        const setCell = () => machine.style.setProperty('--cell', cellSize() + 'px');
        const fill = (reelIdx, syms) => {
            const r = reels[reelIdx];
            r.strip.textContent = '';
            r.strip.style.transition = 'none';
            r.strip.style.transform = 'translateY(0)';
            r.cells = syms.map((s) => {
                const c = el('div', 'sl-cell', SYMBOLS[s].icon);
                r.strip.append(c);
                return c;
            });
        };
        const randomSym = () => Math.floor(ctx.rand() * (SYMBOLS.length - 2));
        setCell();
        for (let i = 0; i < 5; i++) fill(i, [randomSym(), randomSym(), randomSym()]);
        const onResize = () => setCell();
        window.addEventListener('resize', onResize);

        const clearWins = () => {
            lines.textContent = '';
            for (const r of reels) for (const c of r.cells) c.classList.remove('hit');
        };
        const drawLine = (li, color) => {
            const pts = LINES[li].map((row, reel) => `${reel * 100 + 50},${row * 100 + 50}`).join(' ');
            const p = document.createElementNS(svgNS, 'polyline');
            p.setAttribute('points', pts);
            p.setAttribute('fill', 'none');
            p.setAttribute('stroke', color);
            p.setAttribute('stroke-width', '6');
            p.setAttribute('stroke-linejoin', 'round');
            p.setAttribute('opacity', '0.85');
            p.setAttribute('vector-effect', 'non-scaling-stroke');
            lines.append(p);
        };
        const COLORS = ['#ff3d5e', '#2fe39a', '#4fa3ff', '#f6c544', '#c86bff', '#ff8a3d', '#3df2e0', '#ff6bd5', '#a3ff3d', '#ffffff'];

        async function spin() {
            if (spinning) return;
            const isFree = freeLeft > 0;
            const stake = bet.value;
            if (!isFree && !ctx.wager(stake, 0.1)) { auto = 0; autoSeg.set(0); return; }
            spinning = true;
            spinBtn.disabled = true;
            bet.lock(true);
            clearWins();
            if (isFree) { freeLeft--; freeStat.set(String(freeLeft)); }
            msg.textContent = isFree ? `Free spin! ${freeLeft} left` : 'Spinning...';
            const res = spinSlots(ctx.rand);
            lastStake = stake;
            pending = { res, stake, isFree };
            const cell = cellSize();
            const stops = [];
            for (let i = 0; i < 5; i++) {
                const n = 14 + i * 5;
                const syms = [];
                for (let k = 0; k < n; k++) syms.push(randomSym());
                const final = res.grid[i];
                fill(i, [...final, ...syms, randomSym(), randomSym(), randomSym()]);
                // Strip runs bottom-up: start showing the old random tail, end showing the result
                const r = reels[i];
                const total = r.cells.length;
                r.strip.style.transform = `translateY(${-(total - 3) * cell}px)`;
                void r.strip.offsetHeight;
                const dur = 700 + i * 260;
                r.strip.style.transition = `transform ${dur}ms cubic-bezier(.15,.6,.25,1.04)`;
                r.strip.style.transform = 'translateY(0)';
                stops.push(dur);
            }
            ctx.sfx.play('tick');
            let ticks = 0;
            const tickTimer = setInterval(() => { if (ticks++ < 30) ctx.sfx.play('tick', { freq: 1800 + Math.random() * 600 }); }, 60);
            for (let i = 0; i < 5; i++) {
                await ctx.wait(i === 0 ? stops[0] : stops[i] - stops[i - 1]);
                ctx.sfx.play('reel');
                // Keep just the three visible cells
                const final = res.grid[i];
                fill(i, final);
            }
            clearInterval(tickTimer);
            const win = Math.round(slotPayout(res, stake, isFree) * 100) / 100;
            pending = null;
            ctx.payout(win, isFree ? 0 : stake);
            lastWin.set(ctx.money(win));
            if (res.freeSpins) {
                freeLeft += res.freeSpins;
                freeStat.set(String(freeLeft));
            }
            free.style.display = freeLeft > 0 ? 'block' : 'none';
            if (win > 0 || res.freeSpins) {
                res.wins.forEach((w, k) => {
                    drawLine(w.line, COLORS[w.line % COLORS.length]);
                    LINES[w.line].slice(0, w.count).forEach((row, reel) => reels[reel].cells[row].classList.add('hit'));
                });
                if (res.scatter.count >= 3) {
                    const si = SYMBOLS.findIndex((s) => s.scatter);
                    res.grid.forEach((col, reel) => col.forEach((s, row) => { if (s === si) reels[reel].cells[row].classList.add('hit'); }));
                }
                const x = win / stake;
                msg.innerHTML = '';
                msg.append('WIN ', el('b', '', ctx.money(win)), ` · ${res.wins.length} line${res.wins.length === 1 ? '' : 's'}`);
                if (res.freeSpins) msg.append(` · +${res.freeSpins} FREE SPINS!`);
                if (win > 0) ctx.banner(x >= 20 ? 'MEGA WIN' : x >= 8 ? 'BIG WIN' : 'WIN', win, { mult: `${x.toFixed(2)}×`, big: x >= 8 });
                else ctx.sfx.play('bigwin');
            } else {
                msg.textContent = 'No win, spin again!';
            }
            spinning = false;
            spinBtn.disabled = false;
            bet.lock(freeLeft > 0);
            spinBtn.textContent = freeLeft > 0 ? `FREE SPIN (${freeLeft})` : 'SPIN';
            if (freeLeft > 0 || auto > 0) {
                if (freeLeft <= 0) { auto--; if (auto <= 0) autoSeg.set(0); }
                await ctx.wait(win > 0 ? 1500 : 450);
                if (freeLeft > 0 || auto > 0) spin();
            }
        }

        return {
            busy: () => spinning || freeLeft > 0,
            // Walking away settles up: the spin on screen and any free spins left are played out at once
            leave: () => {
                auto = 0;
                if (pending) {
                    const { res, stake, isFree } = pending;
                    pending = null;
                    ctx.payout(slotPayout(res, stake, isFree), isFree ? 0 : stake);
                    freeLeft += res.freeSpins;
                }
                while (freeLeft > 0) {
                    freeLeft--;
                    const res = spinSlots(ctx.rand);
                    freeLeft += res.freeSpins;
                    ctx.payout(slotPayout(res, lastStake, true), 0);
                }
            },
            destroy: () => window.removeEventListener('resize', onResize)
        };
    }
};
