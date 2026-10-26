/**
 * Mines: 25 tiles, some of them bombs. Every gem you turn over raises the multiplier (the fair
 * odds of having avoided the bombs so far, less 1%); hit a bomb and it's gone. Cash out any time.
 */

const HOUSE = 0.99;

/** Multiplier after `gems` safe picks with `mines` bombs on the board. */
export function minesMult(mines, gems) {
    let m = 1;
    for (let i = 0; i < gems; i++) m *= (25 - i) / (25 - mines - i);
    return gems ? Math.floor(m * HOUSE * 100) / 100 : 1;
}

const CSS = `
.mn-wrap { flex: 1; display: grid; place-items: center; padding: 16px; background: radial-gradient(ellipse at 50% 30%, #1d2f45, #0d131d 70%); }
.mn-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: clamp(6px, 1.2vw, 12px); width: min(100%, 470px, 70vh); aspect-ratio: 1; }
.mn-tile { border-radius: 12px; background: linear-gradient(180deg, #3a4a66, #2b3850); box-shadow: 0 5px 0 #1b2436; font-size: clamp(22px, 5vw, 42px);
  display: grid; place-items: center; transition: transform 0.1s, background 0.2s; }
.mn-tile:hover:not(:disabled) { transform: translateY(-3px); background: linear-gradient(180deg, #4a5d80, #34446a); }
.mn-tile.open { background: #101826; box-shadow: inset 0 0 0 2px rgba(255,255,255,0.05); animation: mnPop 0.25s; }
.mn-tile.gem { box-shadow: inset 0 0 0 3px rgba(47,227,154,0.6), 0 0 18px rgba(47,227,154,0.25); }
.mn-tile.boom { background: #4a0f1b; box-shadow: inset 0 0 0 3px #ff4f6e, 0 0 24px rgba(255,79,110,0.5); animation: mnShake 0.4s; }
.mn-tile.ghost { opacity: 0.45; }
@keyframes mnPop { from { transform: scale(0.6); } }
@keyframes mnShake { 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }
`;

export default {
    id: 'mines', name: 'Mines', cat: 'Originals', icon: '💣', tint: ['#11998e', '#0b3d3a'], hot: true,
    blurb: 'Find the gems, dodge the bombs. Cash out before you blow up.',
    mount(stage, ctx) {
        const { el } = ctx;
        if (!document.getElementById('mn-css')) { const s = el('style'); s.id = 'mn-css'; s.textContent = CSS; document.head.append(s); }
        let mines = 3;
        const bet = ctx.betPanel({ initial: 10, min: 0.1 });
        const minesLabel = ctx.label('Mines', String(mines));
        const minesRange = el('input');
        minesRange.type = 'range'; minesRange.min = '1'; minesRange.max = '24'; minesRange.value = String(mines);
        minesRange.style.cssText = 'width:100%;accent-color:#ff4f6e';
        minesRange.oninput = () => { mines = Number(minesRange.value); minesLabel.right.textContent = String(mines); refresh(); };
        const playBtn = ctx.button('BET', 'go big', () => (playing ? cashOut() : begin()));
        const randBtn = ctx.button('Pick random tile', '', () => pickRandom());
        const nextStat = ctx.stat('Next gem', '');
        const profitStat = ctx.stat('Profit', '$0');
        const info = el('div', 'cz-info');
        info.innerHTML = 'Turn over tiles. Each <b>💎</b> raises your multiplier; a <b>💣</b> loses the bet. More mines, bigger multipliers.';
        ctx.side.append(bet, minesLabel, minesRange, playBtn, randBtn, nextStat, profitStat, info);

        const wrap = el('div', 'mn-wrap');
        const grid = el('div', 'mn-grid');
        wrap.append(grid);
        stage.append(wrap);
        const tiles = [];
        for (let i = 0; i < 25; i++) {
            const t = el('button', 'mn-tile');
            t.onclick = () => reveal(i);
            grid.append(t);
            tiles.push(t);
        }

        let playing = false, stake = 0, board = [], opened = new Set();
        const refresh = () => {
            const gems = opened.size;
            nextStat.set(`${minesMult(mines, gems + 1).toFixed(2)}×`);
            profitStat.set(ctx.money(playing ? stake * minesMult(mines, gems) - stake : 0));
            playBtn.textContent = playing ? (gems ? `CASH OUT ${ctx.money(stake * minesMult(mines, gems))}` : 'Pick a tile') : 'BET';
            playBtn.className = 'cz-btn big ' + (playing ? 'gold' : 'go');
            playBtn.disabled = playing && gems === 0;
            randBtn.disabled = !playing;
            minesRange.disabled = playing;
            bet.lock(playing);
            for (let i = 0; i < 25; i++) tiles[i].disabled = !playing || opened.has(i);
        };

        function begin() {
            stake = bet.value;
            if (!ctx.wager(stake, 0.1)) return;
            const idx = [...Array(25).keys()];
            for (let i = 24; i > 0; i--) { const j = Math.floor(ctx.rand() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
            board = new Array(25).fill(false);
            for (let k = 0; k < mines; k++) board[idx[k]] = true;
            opened = new Set();
            for (const t of tiles) { t.className = 'mn-tile'; t.textContent = ''; }
            playing = true;
            refresh();
        }

        function showAll() {
            board.forEach((bomb, i) => {
                if (opened.has(i)) return;
                tiles[i].className = 'mn-tile open ghost';
                tiles[i].textContent = bomb ? '💣' : '💎';
            });
        }

        function reveal(i) {
            if (!playing || opened.has(i)) return;
            opened.add(i);
            const t = tiles[i];
            if (board[i]) {
                t.className = 'mn-tile open boom';
                t.textContent = '💣';
                ctx.sfx.play('boom');
                playing = false;
                ctx.payout(0, stake);
                ctx.banner('BOOM', -stake, { lose: true });
                showAll();
            } else {
                t.className = 'mn-tile open gem';
                t.textContent = '💎';
                ctx.sfx.play('gem', { freq: 600 + opened.size * 45 });
                if (opened.size === 25 - mines) return cashOut();
            }
            refresh();
        }

        function pickRandom() {
            const free = [...Array(25).keys()].filter((i) => !opened.has(i));
            if (free.length) reveal(free[Math.floor(ctx.rand() * free.length)]);
        }

        function cashOut() {
            if (!playing || opened.size === 0) return;
            const m = minesMult(mines, opened.size);
            const ret = stake * m;
            ctx.payout(ret, stake);
            ctx.sfx.play('cashout');
            ctx.banner('CASHED OUT', ret, { mult: `${m.toFixed(2)}×`, big: m >= 10 });
            playing = false;
            showAll();
            refresh();
        }

        refresh();
        return {
            busy: () => playing,
            leave: () => {
                if (!playing) return;
                ctx.payout(stake * minesMult(mines, opened.size), stake);
                playing = false;
            }
        };
    }
};
