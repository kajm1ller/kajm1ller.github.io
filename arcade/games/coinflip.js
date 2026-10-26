/**
 * Coin Flip: call heads or tails. Right doubles your money (1.98×); keep flipping to stack the
 * streak or cash out.
 */

export const FLIP_MULT = 1.98;

const CSS = `
.cf-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; padding: 18px; perspective: 900px;
  background: radial-gradient(ellipse at 50% 35%, #3d3218, #120e05 70%); }
.cf-coin { position: relative; width: clamp(150px, 22vw, 210px); aspect-ratio: 1; transform-style: preserve-3d; transition: transform 1.6s cubic-bezier(.2,.8,.25,1); }
.cf-face { position: absolute; inset: 0; border-radius: 50%; backface-visibility: hidden; display: grid; place-items: center;
  font-family: Georgia, serif; font-weight: 900; font-size: clamp(40px, 6vw, 64px); color: #6b4a06;
  background: radial-gradient(circle at 35% 30%, #fff3b0, #f6c544 45%, #b07a10); box-shadow: inset 0 0 0 8px #d9a52b, inset 0 0 0 12px #8a5d08; }
.cf-face.t { transform: rotateY(180deg); background: radial-gradient(circle at 35% 30%, #f2f2f2, #c0c4cc 45%, #7a7f8a); color: #3b3f48;
  box-shadow: inset 0 0 0 8px #a9adb6, inset 0 0 0 12px #5d616b; }
.cf-mult { font-size: 40px; font-weight: 900; font-variant-numeric: tabular-nums; }
.cf-streak { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; max-width: 520px; }
.cf-streak span { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-weight: 900; font-size: 12px; }
.cf-streak .H { background: #f6c544; color: #5a3d00; } .cf-streak .T { background: #c0c4cc; color: #2b2f38; } .cf-streak .x { outline: 3px solid #ff4f6e; }
`;

export default {
    id: 'coinflip', name: 'Coin Flip', cat: 'Originals', icon: '🪙', tint: ['#f6d365', '#a86b00'],
    blurb: 'Heads or tails at 1.98×. Let it ride or walk away.',
    mount(stage, ctx) {
        const { el } = ctx;
        if (!document.getElementById('cf-css')) { const s = el('style'); s.id = 'cf-css'; s.textContent = CSS; document.head.append(s); }
        const bet = ctx.betPanel({ initial: 10, min: 0.1 });
        const headsBtn = ctx.button('Heads', 'gold', () => flip('H'));
        const tailsBtn = ctx.button('Tails', '', () => flip('T'));
        const row = el('div', 'cz-row'); row.append(headsBtn, tailsBtn);
        const cashBtn = ctx.button('Cash out', 'go big', () => cashOut());
        const info = el('div', 'cz-info');
        info.innerHTML = 'Pick a side to flip. Each correct call multiplies your stake by <b>1.98×</b>; a wrong call loses it. <b>Cash out</b> to keep the streak\'s winnings.';
        ctx.side.append(bet, row, cashBtn, info);

        const wrap = el('div', 'cf-wrap');
        const coin = el('div', 'cf-coin');
        coin.append(el('div', 'cf-face h', 'K'), el('div', 'cf-face t', '★'));
        const mult = el('div', 'cf-mult', '1.00×');
        const streak = el('div', 'cf-streak');
        wrap.append(coin, mult, streak);
        stage.append(wrap);

        let playing = false, busy = false, stake = 0, m = 1, turns = 0;
        const refresh = () => {
            headsBtn.disabled = tailsBtn.disabled = busy;
            cashBtn.disabled = busy || !playing || m <= 1;
            cashBtn.textContent = playing && m > 1 ? `Cash out ${ctx.money(stake * m)}` : 'Cash out';
            mult.textContent = `${m.toFixed(2)}×`;
            bet.lock(playing);
        };

        async function flip(side) {
            if (busy) return;
            if (!playing) {
                stake = bet.value;
                if (!ctx.wager(stake, 0.1)) return;
                playing = true;
                m = 1;
                streak.textContent = '';
            }
            busy = true;
            refresh();
            const res = ctx.rand() < 0.5 ? 'H' : 'T';
            turns += 5 + Math.floor(ctx.rand() * 3);
            coin.style.transform = `rotateY(${turns * 360 + (res === 'T' ? 180 : 0)}deg) rotateX(12deg)`;
            ctx.sfx.play('flip');
            await ctx.wait(1650);
            const s = el('span', res, res);
            if (res === side) {
                m *= FLIP_MULT;
                ctx.sfx.play('gem', { freq: 600 + streak.children.length * 60 });
            } else {
                s.classList.add('x');
                ctx.payout(0, stake);
                ctx.sfx.play('lose');
                ctx.banner(res === 'H' ? 'HEADS' : 'TAILS', -stake, { lose: true });
                playing = false;
                m = 1;
            }
            streak.append(s);
            busy = false;
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

        refresh();
        return {
            busy: () => playing || busy,
            leave: () => { if (playing) { ctx.payout(stake * m, stake); playing = false; } }
        };
    }
};
