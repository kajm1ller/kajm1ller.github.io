/**
 * Blackjack: six-deck shoe, dealer stands on soft 17, blackjack pays 3:2, double on any first two
 * cards, split pairs up to four hands (split aces get one card each).
 */

import { Shoe, bjTotal, isBlackjack } from '../cards.js';

/** Dealer draws to 17, standing on soft 17. */
export function dealerPlays(cards, draw) {
    while (bjTotal(cards).total < 17) cards.push(draw());
    return cards;
}

/** What a finished hand returns (stake included) against the dealer's hand. */
export function settleHand(hand, dealer) {
    const p = bjTotal(hand.cards).total;
    const d = bjTotal(dealer).total;
    const natural = !hand.split && isBlackjack(hand.cards);
    const dealerBJ = isBlackjack(dealer);
    if (p > 21) return { ret: 0, result: 'Bust' };
    if (natural && !dealerBJ) return { ret: hand.bet * 2.5, result: 'Blackjack' };
    if (dealerBJ && !natural) return { ret: 0, result: 'Dealer blackjack' };
    if (natural && dealerBJ) return { ret: hand.bet, result: 'Push' };
    if (d > 21 || p > d) return { ret: hand.bet * 2, result: 'Win' };
    if (p === d) return { ret: hand.bet, result: 'Push' };
    return { ret: 0, result: 'Lose' };
}

const CSS = `
.bj-table { flex: 1; display: flex; flex-direction: column; justify-content: space-between; padding: 22px 16px 18px; position: relative; overflow: hidden; }
.bj-arc { position: absolute; left: 50%; top: 46%; transform: translate(-50%, -50%); width: min(80%, 560px); text-align: center; pointer-events: none;
  color: rgba(255,255,255,0.22); font-family: Georgia, serif; font-weight: 700; letter-spacing: 2px; font-size: clamp(11px, 1.6vw, 15px); line-height: 1.7; }
.bj-arc b { display: block; color: rgba(246,197,68,0.55); font-size: 1.25em; }
.bj-area { display: flex; flex-direction: column; align-items: center; gap: 8px; min-height: 150px; }
.bj-cards { display: flex; justify-content: center; }
.bj-cards .cz-card + .cz-card { margin-left: calc(var(--cw, 74px) * -0.42); }
.bj-hands { display: flex; gap: 26px; justify-content: center; flex-wrap: wrap; }
.bj-hand { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 10px; border-radius: 12px; border: 2px solid transparent; transition: border-color 0.2s; }
.bj-hand.active { border-color: rgba(246,197,68,0.8); background: rgba(0,0,0,0.12); }
.bj-hand .res { font-weight: 900; font-size: 13px; letter-spacing: 1px; text-transform: uppercase; min-height: 18px; }
.bj-hand .res.w { color: var(--cz-green); } .bj-hand .res.l { color: var(--cz-red); } .bj-hand .res.p { color: var(--cz-gold); }
.bj-shoe { position: absolute; right: 16px; top: 16px; width: 54px; height: 70px; border-radius: 8px; background: #2b1d10;
  box-shadow: inset 0 0 0 3px #4a3420, 0 4px 10px rgba(0,0,0,0.4); }
.bj-shoe::after { content: ''; position: absolute; left: 8px; right: 8px; top: 10px; bottom: 6px; border-radius: 4px;
  background: repeating-linear-gradient(45deg, #b32646 0 5px, #8d1733 5px 10px); border: 2px solid #fff; }
`;

export default {
    id: 'blackjack', name: 'Blackjack', cat: 'Table', icon: '🂡', tint: ['#0f6b45', '#06301f'], hot: true,
    blurb: 'Beat the dealer to 21. Blackjack pays 3:2, dealer stands on soft 17.',
    mount(stage, ctx) {
        const { el, cardEl } = ctx;
        if (!document.getElementById('bj-css')) { const s = el('style'); s.id = 'bj-css'; s.textContent = CSS; document.head.append(s); }
        const shoe = new Shoe(6, ctx.rand);
        let state = 'bet';   // bet | play | dealer | done
        let hands = [], dealer = [], active = 0;

        const bet = ctx.betPanel({ initial: 25, min: 1 });
        const deal = ctx.button('DEAL', 'go big', () => start());
        const hit = ctx.button('Hit', 'blue', () => doHit());
        const stand = ctx.button('Stand', 'gold', () => doStand());
        const dbl = ctx.button('Double', '', () => doDouble());
        const split = ctx.button('Split', '', () => doSplit());
        const row1 = el('div', 'cz-row'); row1.append(hit, stand);
        const row2 = el('div', 'cz-row'); row2.append(dbl, split);
        const info = el('div', 'cz-info');
        info.innerHTML = 'Get closer to <b>21</b> than the dealer without going over. Face cards are 10, aces 1 or 11.<br>Blackjack pays <b>3:2</b>; double down on any two cards; split pairs up to 4 hands.';
        const shoeStat = ctx.stat('Shoe', '');
        ctx.side.append(bet, deal, row1, row2, shoeStat, info);

        const table = el('div', 'bj-table cz-felt');
        const arc = el('div', 'bj-arc');
        arc.innerHTML = '<b>BLACKJACK PAYS 3 TO 2</b>DEALER MUST STAND ON ALL 17s · INSURANCE NOT OFFERED';
        const dealerArea = el('div', 'bj-area');
        const dealerCards = el('div', 'bj-cards');
        const dealerTotal = el('span', 'cz-pill', '');
        dealerArea.append(dealerCards, dealerTotal);
        const handsEl = el('div', 'bj-hands');
        table.append(el('div', 'bj-shoe'), arc, dealerArea, handsEl);
        stage.append(table);

        const totalText = (cards) => {
            const t = bjTotal(cards);
            if (cards.length === 2 && t.total === 21) return 'Blackjack';
            return t.soft && t.total < 21 ? `${t.total - 10} / ${t.total}` : String(t.total);
        };
        const refreshButtons = () => {
            const h = hands[active];
            const playing = state === 'play' && h;
            hit.disabled = stand.disabled = !playing;
            dbl.disabled = !(playing && h.cards.length === 2 && ctx.wallet.canAfford(h.bet));
            split.disabled = !(playing && h.cards.length === 2 && h.cards[0].r === h.cards[1].r && hands.length < 4 &&
                ctx.wallet.canAfford(h.bet) && !(h.splitAces));
            deal.disabled = state !== 'bet' && state !== 'done';
            bet.lock(!(state === 'bet' || state === 'done'));
            shoeStat.set(`${shoe.cards.length - shoe.dealt} cards left`);
        };
        const renderHands = () => {
            handsEl.textContent = '';
            hands.forEach((h, i) => {
                const box = el('div', 'bj-hand' + (i === active && state === 'play' && hands.length > 1 ? ' active' : ''));
                const cards = el('div', 'bj-cards');
                for (const c of h.cards) cards.append(h.els.get(c) || (h.els.set(c, cardEl(c)), h.els.get(c)));
                const res = el('div', 'res ' + (h.result ? (h.ret > h.bet ? 'w' : h.ret === h.bet ? 'p' : 'l') : ''), h.result || '');
                box.append(cards, el('span', 'cz-pill', `${totalText(h.cards)} · ${ctx.money(h.bet)}`), res);
                handsEl.append(box);
            });
        };
        const draw = () => shoe.draw();

        async function start() {
            if (state === 'play' || state === 'dealer') return;
            const stake = bet.value;
            if (!ctx.wager(stake, 1)) return;
            if (shoe.needsShuffle) { shoe.shuffle(); ctx.toast('Shuffling a fresh shoe'); }
            state = 'play';
            hands = [{ cards: [], bet: stake, els: new Map(), done: false }];
            dealer = [];
            active = 0;
            dealerCards.textContent = '';
            dealerTotal.textContent = '';
            renderHands();
            refreshButtons();
            hit.disabled = stand.disabled = dbl.disabled = split.disabled = true;
            ctx.emit('deal');
            // Player, dealer up, player, dealer hole card
            for (let k = 0; k < 4; k++) {
                await ctx.wait(330);
                ctx.sfx.play('card');
                if (k % 2 === 0) { hands[0].cards.push(draw()); renderHands(); }
                else {
                    const c = draw();
                    dealer.push(c);
                    dealerCards.append(cardEl(c, { down: k === 3 }));
                    if (k === 1) dealerTotal.textContent = totalText([c]);
                }
            }
            // Naturals end the hand at once
            if (isBlackjack(hands[0].cards) || isBlackjack(dealer)) {
                await ctx.wait(400);
                return finish();
            }
            refreshButtons();
        }

        function current() { return hands[active]; }

        async function nextHand() {
            current().done = true;
            while (active < hands.length && hands[active].done) active++;
            if (active >= hands.length) {
                active = hands.length - 1;
                return finish();
            }
            // A split hand gets its second card
            const h = current();
            if (h.cards.length === 1) {
                await ctx.wait(300);
                ctx.sfx.play('card');
                h.cards.push(draw());
                if (h.splitAces || bjTotal(h.cards).total === 21) {
                    renderHands();
                    return nextHand();
                }
            }
            renderHands();
            refreshButtons();
        }

        async function doHit() {
            if (state !== 'play') return;
            const h = current();
            ctx.sfx.play('card');
            h.cards.push(draw());
            renderHands();
            if (bjTotal(h.cards).total >= 21) {
                hit.disabled = stand.disabled = dbl.disabled = split.disabled = true;
                await ctx.wait(350);
                return nextHand();
            }
            refreshButtons();
        }

        function doStand() {
            if (state !== 'play') return;
            nextHand();
        }

        async function doDouble() {
            const h = current();
            if (state !== 'play' || h.cards.length !== 2 || !ctx.wager(h.bet)) return;
            h.bet *= 2;
            ctx.sfx.play('card');
            h.cards.push(draw());
            renderHands();
            hit.disabled = stand.disabled = dbl.disabled = split.disabled = true;
            await ctx.wait(450);
            nextHand();
        }

        async function doSplit() {
            const h = current();
            if (state !== 'play' || !ctx.wager(h.bet)) return;
            const second = h.cards.pop();
            const aces = h.cards[0].r === 14;
            const nh = { cards: [second], bet: h.bet, els: new Map([[second, h.els.get(second)]]), done: false, split: true, splitAces: aces };
            h.split = true;
            h.splitAces = aces;
            hands.splice(active + 1, 0, nh);
            await ctx.wait(250);
            ctx.sfx.play('card');
            h.cards.push(draw());
            renderHands();
            if (aces || bjTotal(h.cards).total === 21) {
                await ctx.wait(300);
                return nextHand();
            }
            refreshButtons();
        }

        async function finish() {
            state = 'dealer';
            refreshButtons();
            // Turn the hole card
            const hole = dealerCards.children[1];
            if (hole) { hole.classList.remove('down'); ctx.sfx.play('flip'); }
            dealerTotal.textContent = totalText(dealer);
            const live = hands.some((h) => bjTotal(h.cards).total <= 21 && !(!h.split && isBlackjack(h.cards)));
            if (live && !isBlackjack(dealer)) {
                while (bjTotal(dealer).total < 17) {
                    await ctx.wait(650);
                    const c = draw();
                    dealer.push(c);
                    ctx.sfx.play('card');
                    dealerCards.append(cardEl(c));
                    dealerTotal.textContent = totalText(dealer);
                }
            }
            await ctx.wait(400);
            let ret = 0, staked = 0;
            for (const h of hands) {
                const r = settleHand(h, dealer);
                h.ret = r.ret;
                h.result = r.result;
                ret += r.ret;
                staked += h.bet;
            }
            if (bjTotal(dealer).total > 21) dealerTotal.textContent = `${bjTotal(dealer).total} · Bust`;
            state = 'done';
            renderHands();
            refreshButtons();
            ctx.payout(ret, staked);
            if (ret > staked) ctx.banner(hands.some((h) => h.result === 'Blackjack') ? 'BLACKJACK!' : 'YOU WIN', ret - staked, { mult: `returned ${ctx.money(ret)}` });
            else if (ret === staked) ctx.banner('PUSH', ret, { mult: 'stake returned' });
            else { ctx.banner('DEALER WINS', -(staked - ret), { lose: true }); ctx.sfx.play('lose'); }
        }

        refreshButtons();
        return {
            busy: () => state === 'play' || state === 'dealer'
        };
    }
};
