/**
 * Baccarat (punto banco): bet Player, Banker (pays 0.95:1), Tie (8:1) or either pair (11:1); the
 * cards are drawn by the tableau, nobody decides anything.
 */

import { Shoe, playBaccarat, bacTotal } from '../cards.js';
import { CHIP_COLORS } from '../arcadeUI.js';

export const BAC_PAYS = { player: 2, banker: 1.95, tie: 9, ppair: 12, bpair: 12 }; // returns, stake included

/** What the bets return (stake included) for a finished coup. Ties push Player and Banker bets. */
export function settleBaccarat(bets, coup) {
    let ret = 0;
    if (coup.winner === 'tie') ret += (bets.player || 0) + (bets.banker || 0) + (bets.tie || 0) * BAC_PAYS.tie;
    else ret += (bets[coup.winner] || 0) * BAC_PAYS[coup.winner];
    if (coup.player[0].r === coup.player[1].r) ret += (bets.ppair || 0) * BAC_PAYS.ppair;
    if (coup.banker[0].r === coup.banker[1].r) ret += (bets.bpair || 0) * BAC_PAYS.bpair;
    return ret;
}

const CSS = `
.bc-table { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: space-between; padding: 18px 14px; gap: 14px; }
.bc-hands { display: flex; gap: clamp(14px, 4vw, 60px); justify-content: center; width: 100%; }
.bc-hand { display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 150px; }
.bc-hand h3 { margin: 0; font-family: Georgia, serif; letter-spacing: 3px; font-size: 18px; }
.bc-hand.p h3 { color: #6db7ff; } .bc-hand.b h3 { color: #ff6b81; }
.bc-cards { display: flex; gap: 6px; height: calc(var(--cw) * 1.4); --cw: clamp(52px, 7vw, 74px); }
.bc-cards .cz-card:nth-child(3) { transform: rotate(90deg); margin-left: calc(var(--cw) * 0.2); }
.bc-total { font-size: 34px; font-weight: 900; min-height: 40px; }
.bc-hand.won .bc-total { color: var(--cz-gold); text-shadow: 0 0 14px rgba(246,197,68,0.6); }
.bc-spots { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; width: min(100%, 640px); }
.bc-spot { position: relative; border: 2px solid rgba(255,255,255,0.35); border-radius: 14px; padding: 12px 6px; text-align: center; background: rgba(0,0,0,0.12);
  cursor: pointer; transition: background 0.15s; min-height: 78px; }
.bc-spot:hover { background: rgba(255,255,255,0.08); }
.bc-spot .n { font-weight: 900; letter-spacing: 2px; font-size: 15px; }
.bc-spot .o { font-size: 11px; color: rgba(255,255,255,0.65); font-weight: 700; }
.bc-spot .amt { margin-top: 4px; font-weight: 900; color: var(--cz-gold); min-height: 18px; font-variant-numeric: tabular-nums; }
.bc-spot.player { border-color: #6db7ff; } .bc-spot.banker { border-color: #ff6b81; } .bc-spot.tie { border-color: #2fe39a; }
.bc-spot.win { background: rgba(246,197,68,0.25); }
.bc-spot.small { min-height: 56px; padding: 8px 6px; }
.bc-road { display: grid; grid-auto-flow: column; grid-template-rows: repeat(6, 18px); grid-auto-columns: 18px; gap: 3px; padding: 8px; background: rgba(0,0,0,0.25);
  border-radius: 10px; max-width: 100%; overflow: hidden; justify-content: start; }
.bc-road span { border-radius: 50%; font-size: 10px; font-weight: 900; display: grid; place-items: center; color: #fff; }
.bc-road .P { background: #2f7fe0; } .bc-road .B { background: #d93554; } .bc-road .T { background: #19b877; }
`;

export default {
    id: 'baccarat', name: 'Baccarat', cat: 'Table', icon: '🎴', tint: ['#8e0e00', '#1f1c18'],
    blurb: 'Player or Banker, closest to nine wins. The high rollers\' favourite.',
    mount(stage, ctx) {
        const { el, cardEl } = ctx;
        if (!document.getElementById('bc-css')) { const s = el('style'); s.id = 'bc-css'; s.textContent = CSS; document.head.append(s); }
        const shoe = new Shoe(8, ctx.rand, 0.8);
        const bets = { player: 0, banker: 0, tie: 0, ppair: 0, bpair: 0 };
        let lastBets = null, busy = false, chip = 25;
        const road = [];

        const chips = el('div', 'cz-chips');
        for (const c of [1, 5, 25, 100, 500, 1000]) {
            const b = el('button', 'cz-chip' + (c === chip ? ' sel' : ''), c >= 1000 ? c / 1000 + 'K' : String(c));
            b.style.setProperty('--c', CHIP_COLORS[c]);
            b.onclick = () => {
                chip = c;
                for (const o of chips.children) o.classList.toggle('sel', o === b);
                ctx.sfx.play('chip');
            };
            chips.append(b);
        }
        const totalStat = ctx.stat('Total bet', '$0');
        const dealBtn = ctx.button('DEAL', 'go big', () => deal());
        const clearBtn = ctx.button('Clear', '', () => { if (!busy) { for (const k in bets) bets[k] = 0; renderBets(); } });
        const rebetBtn = ctx.button('Rebet', '', () => {
            if (busy || !lastBets) return;
            for (const k in bets) bets[k] = lastBets[k];
            renderBets();
        });
        const row = el('div', 'cz-row'); row.append(clearBtn, rebetBtn);
        const info = el('div', 'cz-info');
        info.innerHTML = 'Pick a chip, then click a spot to bet. Cards count face value, tens and faces are 0, only the last digit counts. <b>Banker</b> pays 0.95:1, <b>Tie</b> 8:1 (Player and Banker bets push), <b>pairs</b> 11:1.';
        ctx.side.append(ctx.label('Chip'), chips, totalStat, dealBtn, row, info);

        const table = el('div', 'bc-table cz-felt');
        const hands = el('div', 'bc-hands');
        const mkHand = (cls, name) => {
            const h = el('div', 'bc-hand ' + cls);
            const cards = el('div', 'bc-cards');
            const total = el('div', 'bc-total', '');
            h.append(el('h3', '', name), cards, total);
            hands.append(h);
            return { h, cards, total };
        };
        const P = mkHand('p', 'PLAYER');
        const B = mkHand('b', 'BANKER');
        const spots = el('div', 'bc-spots');
        const spotEls = {};
        const mkSpot = (key, name, odds, cls) => {
            const s = el('div', 'bc-spot ' + cls);
            const amt = el('div', 'amt', '');
            s.append(el('div', 'n', name), el('div', 'o', odds), amt);
            s.onclick = () => {
                if (busy) return;
                const total = Object.values(bets).reduce((a, b) => a + b, 0);
                if (total + chip > ctx.wallet.balance) { ctx.toast('Not enough money for that chip'); return; }
                bets[key] += chip;
                ctx.sfx.play('chip');
                renderBets();
            };
            s.oncontextmenu = (e) => { e.preventDefault(); if (!busy) { bets[key] = 0; renderBets(); } };
            spotEls[key] = { s, amt };
            return s;
        };
        spots.append(mkSpot('ppair', 'P PAIR', '11:1', 'player small'), mkSpot('tie', 'TIE', '8:1', 'tie small'), mkSpot('bpair', 'B PAIR', '11:1', 'banker small'),
            mkSpot('player', 'PLAYER', '1:1', 'player'), el('div'), mkSpot('banker', 'BANKER', '0.95:1', 'banker'));
        const roadEl = el('div', 'bc-road');
        table.append(hands, spots, roadEl);
        stage.append(table);

        function renderBets() {
            let total = 0;
            for (const k in bets) {
                spotEls[k].amt.textContent = bets[k] ? ctx.money(bets[k]) : '';
                total += bets[k];
            }
            totalStat.set(ctx.money(total));
        }
        function renderRoad() {
            roadEl.textContent = '';
            for (const r of road.slice(-60)) roadEl.append(el('span', r, r));
        }

        async function deal() {
            if (busy) return;
            const total = Object.values(bets).reduce((a, b) => a + b, 0);
            if (total <= 0) { ctx.toast('Place a bet first: pick a chip and click Player, Banker or Tie'); return; }
            if (!ctx.wager(total)) return;
            busy = true;
            dealBtn.disabled = true;
            lastBets = { ...bets };
            if (shoe.needsShuffle) shoe.shuffle();
            for (const s of Object.values(spotEls)) s.s.classList.remove('win');
            P.h.classList.remove('won'); B.h.classList.remove('won');
            P.cards.textContent = B.cards.textContent = '';
            P.total.textContent = B.total.textContent = '';
            ctx.emit('deal');
            const coup = playBaccarat(() => shoe.draw());
            // Player, banker, player, banker, then any third cards
            const order = [[P, coup.player[0]], [B, coup.banker[0]], [P, coup.player[1]], [B, coup.banker[1]]];
            for (const [h, c] of order) {
                await ctx.wait(420);
                h.cards.append(cardEl(c));
                ctx.sfx.play('card');
            }
            P.total.textContent = String(bacTotal(coup.player.slice(0, 2)));
            B.total.textContent = String(bacTotal(coup.banker.slice(0, 2)));
            if (coup.player[2]) {
                await ctx.wait(800);
                P.cards.append(cardEl(coup.player[2]));
                ctx.sfx.play('card');
                P.total.textContent = String(coup.pt);
            }
            if (coup.banker[2]) {
                await ctx.wait(800);
                B.cards.append(cardEl(coup.banker[2]));
                ctx.sfx.play('card');
                B.total.textContent = String(coup.bt);
            }
            await ctx.wait(500);
            const ret = settleBaccarat(bets, coup);
            if (coup.winner === 'player') P.h.classList.add('won');
            if (coup.winner === 'banker') B.h.classList.add('won');
            spotEls[coup.winner].s.classList.add('win');
            if (coup.player[0].r === coup.player[1].r) spotEls.ppair.s.classList.add('win');
            if (coup.banker[0].r === coup.banker[1].r) spotEls.bpair.s.classList.add('win');
            road.push(coup.winner === 'player' ? 'P' : coup.winner === 'banker' ? 'B' : 'T');
            renderRoad();
            ctx.payout(ret, total);
            const title = coup.winner === 'tie' ? `TIE ${coup.pt}–${coup.bt}` : `${coup.winner.toUpperCase()} WINS ${Math.max(coup.pt, coup.bt)}–${Math.min(coup.pt, coup.bt)}`;
            if (ret > total) ctx.banner(title, ret - total, { mult: `returned ${ctx.money(ret)}` });
            else if (ret === total) ctx.banner(title, 'PUSH');
            else { ctx.banner(title, -(total - ret), { lose: true }); ctx.sfx.play('lose'); }
            for (const k in bets) bets[k] = 0;
            renderBets();
            busy = false;
            dealBtn.disabled = false;
        }

        renderBets();
        return { busy: () => busy };
    }
};
