/**
 * Higher or Lower: guess whether the next card is higher or lower (ties count for you). Every
 * right guess multiplies your win by the odds against it (1% edge); cash out whenever you like,
 * skip a card you don't fancy. Infinite deck: every card is a fresh draw, aces low.
 */

export const HOUSE = 0.99;

/** Chances for the next card given the current rank (1..13). */
export function hiloOdds(rank) {
    if (rank === 1) return { hi: 12 / 13, lo: 1 / 13, hiLabel: 'Higher', loLabel: 'Same' };
    if (rank === 13) return { hi: 1 / 13, lo: 12 / 13, hiLabel: 'Same', loLabel: 'Lower' };
    return { hi: (14 - rank) / 13, lo: rank / 13, hiLabel: 'Higher or same', loLabel: 'Lower or same' };
}

/** Whether `guess` ('hi' | 'lo') was right going from rank a to b. */
export function hiloRight(a, b, guess) {
    if (a === 1) return guess === 'hi' ? b > 1 : b === 1;
    if (a === 13) return guess === 'hi' ? b === 13 : b < 13;
    return guess === 'hi' ? b >= a : b <= a;
}

const CSS = `
.hl-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; padding: 18px;
  background: radial-gradient(ellipse at 50% 30%, #23314f, #0e1322 70%); }
.hl-main { display: flex; align-items: center; gap: clamp(14px, 4vw, 40px); }
.hl-side { display: flex; flex-direction: column; align-items: center; gap: 4px; color: var(--cz-dim); font-weight: 800; font-size: 13px; text-align: center; width: 110px; }
.hl-side .big { font-size: 26px; }
.hl-side b { color: var(--cz-text); font-size: 15px; }
.hl-card { --cw: clamp(110px, 15vw, 150px); }
@media (max-width: 420px) { .hl-side { width: 80px; } .hl-card { --cw: 96px; } }
.hl-mult { font-size: 42px; font-weight: 900; font-variant-numeric: tabular-nums; }
.hl-profit { color: var(--cz-green); font-weight: 800; }
.hl-trail { display: flex; gap: 6px; flex-wrap: nowrap; overflow: hidden; max-width: 100%; padding: 6px; --cw: 46px; }
.hl-trail > div { display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: 11px; font-weight: 800; }
.hl-trail .ok { color: var(--cz-green); } .hl-trail .no { color: var(--cz-red); } .hl-trail .sk { color: var(--cz-dim); }
`;

export default {
    id: 'hilo', name: 'Higher or Lower', cat: 'Originals', icon: '⬆️', tint: ['#00b4db', '#0b3f7a'], hot: true,
    blurb: 'Call the next card. Each right guess stacks the multiplier.',
    mount(stage, ctx) {
        const { el, cardEl } = ctx;
        if (!document.getElementById('hl-css')) { const s = el('style'); s.id = 'hl-css'; s.textContent = CSS; document.head.append(s); }
        const bet = ctx.betPanel({ initial: 10, min: 0.1 });
        const startBtn = ctx.button('BET', 'go big', () => (playing ? cashOut() : begin()));
        const hiBtn = ctx.button('Higher', 'gold', () => guess('hi'));
        const loBtn = ctx.button('Lower', 'blue', () => guess('lo'));
        const skipBtn = ctx.button('Skip card', '', () => skip());
        const row = el('div', 'cz-row'); row.append(hiBtn, loBtn);
        const profitStat = ctx.stat('Profit on cash out', '$0');
        const info = el('div', 'cz-info');
        info.innerHTML = 'A card is drawn; call whether the next is <b>higher</b> or <b>lower</b> (equal counts for you). The less likely your call, the more it multiplies. <b>Cash out</b> any time, or skip a card.';
        ctx.side.append(bet, startBtn, row, skipBtn, profitStat, info);

        const wrap = el('div', 'hl-wrap');
        const main = el('div', 'hl-main');
        const sideHi = el('div', 'hl-side');
        const sideLo = el('div', 'hl-side');
        const cardBox = el('div', 'hl-card');
        main.append(sideLo, cardBox, sideHi);
        const mult = el('div', 'hl-mult', '1.00×');
        const profit = el('div', 'hl-profit', '');
        const trail = el('div', 'hl-trail');
        wrap.append(main, mult, profit, trail);
        stage.append(wrap);

        let playing = false, busy = false, stake = 0, m = 1, rank = 0, skips = 0;
        const drawRank = () => 1 + Math.floor(ctx.rand() * 13);
        const toCard = (r) => ({ r: r === 1 ? 14 : r, s: Math.floor(ctx.rand() * 4) });

        const refresh = () => {
            const o = hiloOdds(rank || 7);
            hiBtn.textContent = `${o.hiLabel} · ${(HOUSE / o.hi).toFixed(2)}×`;
            loBtn.textContent = `${o.loLabel} · ${(HOUSE / o.lo).toFixed(2)}×`;
            sideHi.innerHTML = '';
            sideHi.append(el('div', 'big', '⬆'), el('b', '', `${(o.hi * 100).toFixed(1)}%`), o.hiLabel);
            sideLo.innerHTML = '';
            sideLo.append(el('div', 'big', '⬇'), el('b', '', `${(o.lo * 100).toFixed(1)}%`), o.loLabel);
            hiBtn.disabled = loBtn.disabled = skipBtn.disabled = !playing || busy;
            startBtn.textContent = playing ? `CASH OUT ${ctx.money(stake * m)}` : 'BET';
            startBtn.className = 'cz-btn big ' + (playing ? 'gold' : 'go');
            startBtn.disabled = busy || (playing && m <= 1);
            mult.textContent = `${m.toFixed(2)}×`;
            profitStat.set(ctx.money(playing ? stake * m - stake : 0));
            profit.textContent = playing ? `Profit ${ctx.money(stake * m - stake, { sign: true })}` : '';
            bet.lock(playing);
        };
        const showCard = (r) => {
            cardBox.textContent = '';
            cardBox.append(cardEl(toCard(r)));
            ctx.sfx.play('card');
        };
        const addTrail = (r, cls, label) => {
            const d = el('div', cls);
            d.append(cardEl(toCard(r)), el('span', '', label));
            trail.append(d);
            while (trail.children.length > 12) trail.firstChild.remove();
        };

        function begin() {
            stake = bet.value;
            if (!ctx.wager(stake, 0.1)) return;
            playing = true;
            m = 1;
            skips = 0;
            trail.textContent = '';
            rank = drawRank();
            showCard(rank);
            addTrail(rank, 'sk', 'Start');
            refresh();
        }

        async function guess(g) {
            if (!playing || busy) return;
            busy = true;
            refresh();
            const o = hiloOdds(rank);
            const next = drawRank();
            await ctx.wait(220);
            showCard(next);
            const ok = hiloRight(rank, next, g);
            if (ok) {
                m *= HOUSE / (g === 'hi' ? o.hi : o.lo);
                addTrail(next, 'ok', `${m.toFixed(2)}×`);
                ctx.sfx.play('gem', { freq: 600 + Math.min(12, trail.children.length) * 60 });
                rank = next;
                busy = false;
                refresh();
            } else {
                addTrail(next, 'no', '✕');
                ctx.payout(0, stake);
                ctx.sfx.play('lose');
                ctx.banner('WRONG CALL', -stake, { lose: true });
                playing = false;
                busy = false;
                m = 1;
                rank = next;
                refresh();
            }
        }

        function skip() {
            if (!playing || busy) return;
            skips++;
            rank = drawRank();
            showCard(rank);
            addTrail(rank, 'sk', 'Skip');
            refresh();
        }

        function cashOut() {
            if (!playing || busy || m <= 1) return;
            const ret = stake * m;
            ctx.payout(ret, stake);
            ctx.sfx.play('cashout');
            ctx.banner('CASHED OUT', ret, { mult: `${m.toFixed(2)}×`, big: m >= 10 });
            playing = false;
            m = 1;
            refresh();
        }

        rank = drawRank();
        showCard(rank);
        refresh();
        return {
            busy: () => playing,
            // Walking away cashes out what's on the table (or gives the stake back before any call)
            leave: () => {
                if (!playing) return;
                ctx.payout(stake * m, stake);
                playing = false;
            }
        };
    }
};
