/**
 * Plinko: drop a ball through a triangle of pegs; it bounces left or right at every row and lands
 * in a bucket. Edge buckets pay big, the middle ones don't. 8, 12 or 16 rows at three risk levels.
 */

export const PLINKO = {
    8: {
        low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
        medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
        high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29]
    },
    12: {
        low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
        medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
        high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170]
    },
    16: {
        low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
        medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
        high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000]
    }
};

/** Bounces for one ball: array of 0 (left) / 1 (right), one per row. */
export function plinkoPath(rows, r) {
    const p = [];
    for (let i = 0; i < rows; i++) p.push(r() < 0.5 ? 0 : 1);
    return p;
}

const bucketColor = (m) => (m >= 100 ? '#ff2d55' : m >= 10 ? '#ff5a3c' : m >= 3 ? '#ff8a2a' : m >= 1.5 ? '#ffb020' : m >= 1 ? '#f6c544' : '#e8d24a');

export default {
    id: 'plinko', name: 'Plinko', cat: 'Originals', icon: '🔻', tint: ['#f857a6', '#5b2bd1'], hot: true,
    blurb: 'Drop the ball, watch it bounce. Edges pay up to 1000×.',
    mount(stage, ctx) {
        const { el } = ctx;
        let rows = 12, risk = 'medium';
        const bet = ctx.betPanel({ initial: 5, min: 0.1 });
        const riskSeg = ctx.segmented({ low: 'Low', medium: 'Medium', high: 'High' }, risk, (v) => { risk = v; });
        const rowSeg = ctx.segmented({ 8: '8 rows', 12: '12 rows', 16: '16 rows' }, rows, (v) => { rows = v; buckets.fill(0); });
        const dropBtn = ctx.button('DROP BALL', 'go big', () => drop());
        const autoSeg = ctx.segmented({ 0: 'Auto off', 10: '×10', 50: '×50' }, 0, (v) => { autoLeft = v; });
        const lastStat = ctx.stat('Last ball', '—');
        const info = el('div', 'cz-info');
        info.innerHTML = 'Every peg sends the ball left or right with even odds. <b>Higher risk</b> makes the middle pay less and the edges pay more.';
        ctx.side.append(bet, ctx.label('Risk'), riskSeg, ctx.label('Rows'), rowSeg, dropBtn, ctx.label('Auto drop'), autoSeg, lastStat, info);

        const canvas = el('canvas');
        canvas.style.cssText = 'width:100%;height:100%;display:block;flex:1;min-height:340px;background:radial-gradient(ellipse at 50% 0%, #2c1a4d, #0f0b1a 70%)';
        const hist = ctx.history(12);
        stage.append(hist, canvas);
        const g = canvas.getContext('2d');
        let W = 0, H = 0;
        const resize = () => {
            const r = canvas.getBoundingClientRect();
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            canvas.width = Math.max(1, r.width * dpr); canvas.height = Math.max(1, r.height * dpr);
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            W = r.width; H = r.height;
        };
        resize();
        window.addEventListener('resize', resize);

        let balls = [];   // { path, rows, risk, stake, row, t, x, y, done }
        let autoLeft = 0, autoT = 0;
        const buckets = new Array(17).fill(0); // bounce animation per bucket
        const ROW_TIME = 0.11;

        // Board geometry for the current size
        const geo = (nRows) => {
            const top = 34, bottom = H - 54;
            const gap = Math.min((W - 40) / (nRows + 2), (bottom - top) / nRows);
            const x0 = W / 2;
            return { top, gap, x0, pegY: (i) => top + i * gap, pegX: (i, j) => x0 + (j - (i + 2) / 2) * gap, bucketY: top + nRows * gap + 6 };
        };

        function drop() {
            const stake = bet.value;
            if (!ctx.wager(stake, 0.1)) { autoLeft = 0; autoSeg.set(0); return false; }
            balls.push({ path: plinkoPath(rows, ctx.rand), rows, risk, stake, row: -1, t: 0, rights: 0, done: false, jitter: (ctx.rand() - 0.5) * 0.3 });
            rowSeg.lock(true);
            riskSeg.lock(true);
            return true;
        }

        function land(b) {
            const table = PLINKO[b.rows][b.risk];
            const k = b.path.reduce((a, c) => a + c, 0);
            const m = table[k];
            const ret = b.stake * m;
            ctx.payout(ret, b.stake);
            buckets[k] = 1;
            lastStat.set(`${m}× · ${ctx.money(ret)}`);
            hist.push(`${m}×`, m >= 10 ? 'y' : m >= 1 ? 'g' : 'r');
            ctx.sfx.play(m >= 10 ? 'win' : m >= 1 ? 'gem' : 'tick', { freq: 500 + m * 20 });
            if (m >= 25) ctx.banner(`${m}×`, ret, { big: true, ms: 1200 });
        }

        ctx.loop((dt) => {
            if (!W) resize();
            // Auto drop
            if (autoLeft > 0) {
                autoT -= dt;
                if (autoT <= 0) {
                    autoT = 0.35;
                    if (drop()) { autoLeft--; if (autoLeft <= 0) autoSeg.set(0); }
                }
            }
            const G = geo(rows);
            // Move balls
            for (const b of balls) {
                b.t += dt / ROW_TIME;
                while (b.t >= 1 && !b.done) {
                    b.t -= 1;
                    b.row++;
                    if (b.row >= 0 && b.row < b.rows) {
                        b.rights += b.path[b.row];
                        ctx.sfx.play('peg', { pitch: b.row });
                    }
                    if (b.row >= b.rows) { b.done = true; land(b); }
                }
            }
            balls = balls.filter((b) => !b.done);
            if (!balls.length) { rowSeg.lock(false); riskSeg.lock(false); }
            for (let i = 0; i < buckets.length; i++) buckets[i] = Math.max(0, buckets[i] - dt * 3);

            // ---- Paint ----
            g.clearRect(0, 0, W, H);
            // Pegs: row i has i + 3 pegs
            g.fillStyle = '#ffffff';
            for (let i = 0; i < rows; i++) {
                for (let j = 0; j < i + 3; j++) {
                    g.beginPath(); g.arc(G.pegX(i, j), G.pegY(i), Math.max(2.5, G.gap * 0.09), 0, Math.PI * 2); g.fill();
                }
            }
            // Buckets
            const table = PLINKO[rows][risk];
            const bw = G.gap * 0.92;
            g.textAlign = 'center';
            g.font = `800 ${Math.max(9, Math.min(13, G.gap * 0.3))}px Segoe UI, sans-serif`;
            for (let k = 0; k <= rows; k++) {
                const x = G.pegX(rows - 1, k + 1) - G.gap / 2;
                const y = G.bucketY + buckets[k] * 8;
                g.fillStyle = bucketColor(table[k]);
                g.beginPath();
                if (g.roundRect) g.roundRect(x - bw / 2, y, bw, 26, 5); else g.rect(x - bw / 2, y, bw, 26);
                g.fill();
                g.fillStyle = '#2a0c00';
                g.fillText(table[k] >= 100 ? String(table[k]) : `${table[k]}×`, x, y + 17);
            }
            // Balls: hop from peg gap to peg gap
            for (const b of balls) {
                const G2 = geo(b.rows);
                const i = Math.min(b.row, b.rows - 1);
                const fromX = b.row < 0 ? G2.x0 : G2.x0 + (b.rights - (i + 1) / 2) * G2.gap;
                const nextRights = b.row + 1 < b.rows ? b.rights + b.path[b.row + 1] : b.rights;
                const toX = b.row + 1 >= b.rows ? fromX : G2.x0 + (nextRights - (b.row + 2) / 2) * G2.gap;
                const fromY = b.row < 0 ? G2.top - G2.gap * 0.8 : G2.pegY(b.row) - G2.gap * 0.35;
                const toY = b.row + 1 >= b.rows ? G2.bucketY + 8 : G2.pegY(b.row + 1) - G2.gap * 0.35;
                const tt = Math.min(1, b.t);
                const x = fromX + (toX - fromX) * tt;
                const y = fromY + (toY - fromY) * tt - Math.sin(tt * Math.PI) * G2.gap * 0.35;
                g.shadowColor = '#ff3d8e';
                g.shadowBlur = 12;
                g.fillStyle = '#ff3d8e';
                g.beginPath(); g.arc(x, y, Math.max(4, G2.gap * 0.2), 0, Math.PI * 2); g.fill();
                g.shadowBlur = 0;
            }
        });

        return {
            busy: () => balls.length > 0,
            // Balls still falling land where they were always going to
            leave: () => { for (const b of balls) if (!b.done) { b.done = true; land(b); } balls = []; autoLeft = 0; },
            destroy: () => window.removeEventListener('resize', resize)
        };
    }
};
