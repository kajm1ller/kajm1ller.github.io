/**
 * Keno: pick up to 10 numbers of 40; the house draws 10. The more of yours it draws, the more you
 * win (pay tables are set per number of picks, about 99% back).
 */

export const KENO_PAYS = {
    1: [0.4, 2.75],
    2: [0, 1.8, 5.1],
    3: [0, 0, 2.8, 50],
    4: [0, 0, 1.7, 10, 100],
    5: [0, 0, 1.4, 4, 14, 390],
    6: [0, 0, 0, 3, 9, 180, 710],
    7: [0, 0, 0, 2, 7, 30, 400, 800],
    8: [0, 0, 0, 2, 4, 11, 67, 400, 900],
    9: [0, 0, 0, 2, 2.5, 5, 15, 100, 500, 1000],
    10: [0, 0, 0, 1.6, 2, 4, 7, 26, 100, 500, 1000]
};

/** Chance of `hits` of `picks` numbers among 10 drawn from 40. */
export function kenoChance(picks, hits) {
    const C = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
    return (C(picks, hits) * C(40 - picks, 10 - hits)) / C(40, 10);
}

const CSS = `
.kn-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 14px;
  background: radial-gradient(ellipse at 50% 30%, #3a1f5c, #120a1f 70%); }
.kn-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 7px; width: min(100%, 600px); }
.kn-n { aspect-ratio: 1.15; border-radius: 10px; background: #2d2346; font-weight: 900; font-size: clamp(13px, 2vw, 18px); box-shadow: 0 4px 0 #1a142b;
  transition: transform 0.1s, background 0.15s; }
.kn-n:hover:not(:disabled) { transform: translateY(-2px); background: #3b2f5c; }
.kn-n.pick { background: #7b3fd0; box-shadow: 0 4px 0 #4a2385; }
.kn-n.drawn { background: #3a3a48; color: var(--cz-dim); box-shadow: 0 4px 0 #22222c; }
.kn-n.hit { background: linear-gradient(180deg, #3cf2a9, #19b877); color: #062a1a; box-shadow: 0 4px 0 #0e6b45; animation: knPop 0.3s; }
.kn-n.drawn, .kn-n.hit { animation: knPop 0.3s; }
@keyframes knPop { from { transform: scale(0.7); } }
.kn-pay { display: flex; gap: 4px; width: min(100%, 600px); flex-wrap: wrap; justify-content: center; }
.kn-pay div { background: var(--cz-panel3); border-radius: 8px; padding: 5px 8px; font-size: 11px; font-weight: 800; text-align: center; min-width: 50px; }
.kn-pay div span { display: block; color: var(--cz-dim); font-size: 10px; }
.kn-pay div.on { background: var(--cz-green); color: #062a1a; } .kn-pay div.on span { color: #0b4d32; }
`;

export default {
    id: 'keno', name: 'Keno', cat: 'Originals', icon: '🔢', tint: ['#8e2de2', '#3a0a6b'],
    blurb: 'Pick up to 10 numbers. Ten get drawn. Match big.',
    mount(stage, ctx) {
        const { el } = ctx;
        if (!document.getElementById('kn-css')) { const s = el('style'); s.id = 'kn-css'; s.textContent = CSS; document.head.append(s); }
        const picks = new Set();
        let busy = false;
        const bet = ctx.betPanel({ initial: 5, min: 0.1 });
        const playBtn = ctx.button('PLAY', 'go big', () => play());
        const quickBtn = ctx.button('Quick pick', '', () => { if (busy) return; picks.clear(); while (picks.size < 10) picks.add(1 + Math.floor(ctx.rand() * 40)); render(); });
        const clearBtn = ctx.button('Clear', '', () => { if (!busy) { picks.clear(); render(); } });
        const row = el('div', 'cz-row'); row.append(quickBtn, clearBtn);
        const info = el('div', 'cz-info');
        info.innerHTML = 'Click up to <b>10</b> numbers, then play. Ten numbers are drawn; the table underneath shows what each number of matches pays.';
        ctx.side.append(bet, playBtn, row, info);

        const wrap = el('div', 'kn-wrap');
        const grid = el('div', 'kn-grid');
        const btns = [];
        for (let n = 1; n <= 40; n++) {
            const b = el('button', 'kn-n', String(n));
            b.onclick = () => {
                if (busy) return;
                if (picks.has(n)) picks.delete(n);
                else if (picks.size < 10) picks.add(n);
                else return ctx.toast('Ten numbers at most');
                ctx.sfx.play('click');
                render();
            };
            grid.append(b);
            btns.push(b);
        }
        const pay = el('div', 'kn-pay');
        wrap.append(grid, pay);
        stage.append(wrap);

        function render(drawn = null) {
            btns.forEach((b, i) => {
                const n = i + 1;
                b.className = 'kn-n' + (drawn && drawn.has(n) ? (picks.has(n) ? ' hit' : ' drawn') : picks.has(n) ? ' pick' : '');
            });
            pay.textContent = '';
            const table = KENO_PAYS[picks.size];
            if (!table) { pay.append(el('div', '', 'Pick 1–10 numbers')); return; }
            const hits = drawn ? [...picks].filter((n) => drawn.has(n)).length : -1;
            table.forEach((m, h) => {
                const d = el('div', h === hits ? 'on' : '');
                d.append(`${m}×`, el('span', '', `${h} hit${h === 1 ? '' : 's'}`));
                pay.append(d);
            });
            playBtn.disabled = busy || !picks.size;
        }

        async function play() {
            if (busy || !picks.size) return;
            const stake = bet.value;
            if (!ctx.wager(stake, 0.1)) return;
            busy = true;
            render();
            const pool = [...Array(40).keys()].map((i) => i + 1);
            for (let i = 39; i > 0; i--) { const j = Math.floor(ctx.rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
            const drawn = new Set();
            for (const n of pool.slice(0, 10)) {
                await ctx.wait(160);
                drawn.add(n);
                render(drawn);
                ctx.sfx.play(picks.has(n) ? 'gem' : 'tick', { freq: picks.has(n) ? 700 + drawn.size * 40 : 1200 });
            }
            const hits = [...picks].filter((n) => drawn.has(n)).length;
            const m = KENO_PAYS[picks.size][hits];
            ctx.payout(stake * m, stake);
            if (m > 0) ctx.banner(`${hits} HIT${hits === 1 ? '' : 'S'}`, stake * m, { mult: `${m}×`, big: m >= 20, lose: m < 1 });
            else { ctx.banner(`${hits} HIT${hits === 1 ? '' : 'S'}`, -stake, { lose: true }); ctx.sfx.play('lose'); }
            busy = false;
            render(drawn);
        }

        render();
        return { busy: () => busy };
    }
};
