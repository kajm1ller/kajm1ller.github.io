/**
 * Video poker, Jacks or Better (9/6 pay table): deal five, hold what you like, draw once.
 */

import { newDeck, shuffle, evaluatePoker } from '../cards.js';

export const PAYTABLE = [
    ['Royal Flush', 800], ['Straight Flush', 50], ['Four of a Kind', 25], ['Full House', 9], ['Flush', 6],
    ['Straight', 4], ['Three of a Kind', 3], ['Two Pair', 2], ['Jacks or Better', 1]
];

/** [name, multiplier] of a final five-card hand, or null. */
export function videoPokerResult(cards) {
    const e = evaluatePoker(cards);
    if (e.cat >= 2) return PAYTABLE.find(([n]) => n === e.name) || null;
    if (e.cat === 1) {
        const pairRank = Math.floor(e.score / 15 ** 4) % 15;
        if (pairRank >= 11) return PAYTABLE[PAYTABLE.length - 1];
    }
    return null;
}

const CSS = `
.vp-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; padding: 18px;
  background: linear-gradient(180deg, #08164a, #050a24); }
.vp-pay { width: min(100%, 520px); border: 3px solid #f6c544; border-radius: 10px; background: #0b1f6b; font-weight: 800; font-size: clamp(11px, 1.6vw, 14px);
  font-variant-numeric: tabular-nums; color: #ffe36b; overflow: hidden; }
.vp-pay div { display: flex; justify-content: space-between; padding: 3px 14px; }
.vp-pay div.hit { background: #f6c544; color: #0b1f6b; animation: vpBlink 0.5s steps(2) 4; }
@keyframes vpBlink { 50% { background: transparent; color: #ffe36b; } }
.vp-cards { display: flex; gap: clamp(6px, 1.4vw, 14px); --cw: clamp(56px, 11vw, 112px); }
.vp-slot { display: flex; flex-direction: column; align-items: center; gap: 6px; cursor: pointer; }
.vp-held { font-weight: 900; color: #ffe36b; letter-spacing: 2px; font-size: 13px; height: 18px; }
.vp-msg { font-weight: 900; font-size: 20px; color: #fff; min-height: 26px; letter-spacing: 1px; }
`;

export default {
    id: 'videopoker', name: 'Video Poker', cat: 'Cards', icon: '🃏', tint: ['#1e3c72', '#0b1640'],
    blurb: 'Jacks or Better. Hold your best cards and draw once.',
    mount(stage, ctx) {
        const { el, cardEl } = ctx;
        if (!document.getElementById('vp-css')) { const s = el('style'); s.id = 'vp-css'; s.textContent = CSS; document.head.append(s); }
        const bet = ctx.betPanel({ initial: 5, min: 0.1 });
        const btn = ctx.button('DEAL', 'go big', () => (state === 'hold' ? drawCards() : deal()));
        const info = el('div', 'cz-info');
        info.innerHTML = 'Click cards to <b>hold</b> them, then draw. A pair of <b>Jacks or better</b> gets your bet back; a Royal Flush pays <b>800×</b>.';
        ctx.side.append(bet, btn, info);

        const wrap = el('div', 'vp-wrap');
        const pay = el('div', 'vp-pay');
        const rows = PAYTABLE.map(([n, m]) => {
            const r = el('div');
            r.append(el('span', '', n.toUpperCase()), el('span', '', `${m}×`));
            pay.append(r);
            return r;
        });
        const cardsEl = el('div', 'vp-cards');
        const msg = el('div', 'vp-msg', 'PLACE YOUR BET');
        wrap.append(pay, cardsEl, msg);
        stage.append(wrap);

        let state = 'idle', hand = [], held = [false, false, false, false, false], deck = [], stake = 0;
        const show = (down = []) => {
            cardsEl.textContent = '';
            hand.forEach((c, i) => {
                const slot = el('div', 'vp-slot');
                const h = el('div', 'vp-held', held[i] ? 'HELD' : '');
                slot.append(h, cardEl(c, { down: down.includes(i) }));
                slot.onclick = () => {
                    if (state !== 'hold') return;
                    held[i] = !held[i];
                    h.textContent = held[i] ? 'HELD' : '';
                    ctx.sfx.play('click');
                };
                cardsEl.append(slot);
            });
        };
        // Face-down placeholders to start
        hand = [null, null, null, null, null];
        show([0, 1, 2, 3, 4]);

        async function deal() {
            if (state === 'busy') return;
            stake = bet.value;
            if (!ctx.wager(stake, 0.1)) return;
            state = 'busy';
            btn.disabled = true;
            bet.lock(true);
            for (const r of rows) r.classList.remove('hit');
            deck = shuffle(newDeck(), ctx.rand);
            hand = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
            held = [false, false, false, false, false];
            show();
            ctx.sfx.play('card');
            await ctx.wait(350);
            const r = videoPokerResult(hand);
            msg.textContent = r ? r[0].toUpperCase() : 'HOLD AND DRAW';
            state = 'hold';
            btn.disabled = false;
            btn.textContent = 'DRAW';
        }

        async function drawCards() {
            state = 'busy';
            btn.disabled = true;
            const fresh = [];
            for (let i = 0; i < 5; i++) if (!held[i]) { hand[i] = deck.pop(); fresh.push(i); }
            show(fresh);
            await ctx.wait(80);
            for (const i of fresh) {
                cardsEl.children[i].lastChild.classList.remove('down');
                ctx.sfx.play('flip');
                await ctx.wait(110);
            }
            const r = videoPokerResult(hand);
            const ret = r ? stake * r[1] : 0;
            ctx.payout(ret, stake);
            if (r) {
                rows[PAYTABLE.indexOf(r)].classList.add('hit');
                msg.textContent = `${r[0].toUpperCase()}: WIN ${ctx.money(ret)}`;
                ctx.banner(r[0], ret, { mult: `${r[1]}×`, big: r[1] >= 25 });
            } else {
                msg.textContent = 'GAME OVER';
                ctx.sfx.play('lose');
            }
            state = 'idle';
            btn.disabled = false;
            btn.textContent = 'DEAL';
            bet.lock(false);
        }

        return { busy: () => state !== 'idle' };
    }
};
