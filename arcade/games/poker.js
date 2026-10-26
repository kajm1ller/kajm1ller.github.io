/**
 * Texas Hold'em: no-limit, you against three regulars. Buy in at one of three tables; your stack
 * goes back into your wallet when you stand up. Bots weigh their hand (preflop chart, then Monte
 * Carlo equity against the players still in) against the price of calling, each with their own
 * tightness, aggression and taste for bluffing. All-ins make side pots.
 */

import { newDeck, shuffle, evaluatePoker, describePoker, pokerEquity, preflopStrength, cardText } from '../cards.js';

export const TABLES = [
    { id: 'low', name: 'Low', sb: 1, bb: 2, min: 40, max: 200 },
    { id: 'mid', name: 'Mid', sb: 5, bb: 10, min: 200, max: 1000 },
    { id: 'high', name: 'High Roller', sb: 25, bb: 50, min: 1000, max: 5000 }
];

const BOTS = [
    { name: 'Big Tony', avatar: '🧔', tight: 0.5, aggr: 0.7, bluff: 0.12 },
    { name: 'Grandma Rosa', avatar: '👵', tight: 0.85, aggr: 0.3, bluff: 0.03 },
    { name: 'Crypto Chad', avatar: '😎', tight: 0.2, aggr: 0.9, bluff: 0.25 },
    { name: 'Dr. Patel', avatar: '👩‍⚕️', tight: 0.7, aggr: 0.55, bluff: 0.08 },
    { name: 'Lucky Lou', avatar: '🤠', tight: 0.35, aggr: 0.5, bluff: 0.18 },
    { name: 'Silent Mei', avatar: '🥷', tight: 0.6, aggr: 0.8, bluff: 0.15 },
    { name: 'Frat Kyle', avatar: '🧢', tight: 0.15, aggr: 0.6, bluff: 0.3 }
];

/**
 * Splits the pot by contributions: [{ amount, eligible: [seat indexes] }] (main pot first).
 * @param {Array<{total:number, folded:boolean}>} seats
 */
export function buildPots(seats) {
    const levels = [...new Set(seats.filter((s) => !s.folded && s.total > 0).map((s) => s.total))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const lvl of levels) {
        let amount = 0;
        for (const s of seats) amount += Math.max(0, Math.min(s.total, lvl) - prev);
        const eligible = seats.map((s, i) => i).filter((i) => !seats[i].folded && seats[i].total >= lvl);
        if (amount > 0) pots.push({ amount, eligible });
        prev = lvl;
    }
    // Folded players' money above the last live level still belongs in the last pot
    let leftover = 0;
    for (const s of seats) leftover += Math.max(0, s.total - prev);
    if (leftover > 0 && pots.length) pots[pots.length - 1].amount += leftover;
    return pots;
}

const CSS = `
.pk-room { flex: 1; position: relative; display: flex; flex-direction: column; background: radial-gradient(ellipse at 50% 30%, #2a1838, #120c1a 70%); overflow: hidden; }
.pk-table { position: absolute; left: 50%; top: 47%; transform: translate(-50%, -50%); width: min(78%, 720px); aspect-ratio: 2.1 / 1;
  border-radius: 999px; background: radial-gradient(ellipse at 50% 40%, #157a50, #0d5236 60%, #0a3a27);
  box-shadow: 0 0 0 14px #4a2a14, 0 0 0 17px #2a170a, 0 20px 50px rgba(0,0,0,0.6), inset 0 0 40px rgba(0,0,0,0.5); }
.pk-board { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; gap: 6px; --cw: clamp(40px, 6vw, 62px); }
.pk-slot { width: var(--cw); height: calc(var(--cw) * 1.4); border-radius: 6px; border: 2px dashed rgba(255,255,255,0.12); }
.pk-pot { position: absolute; left: 50%; top: 18%; transform: translateX(-50%); }
.pk-seat { position: absolute; display: flex; flex-direction: column; align-items: center; gap: 4px; width: 150px; transform: translate(-50%, -50%); z-index: 2; }
.pk-seat .cards { display: flex; gap: 3px; --cw: 44px; height: 62px; }
.pk-seat.you .cards { --cw: 64px; height: 90px; }
.pk-seat .plate { display: flex; align-items: center; gap: 8px; background: rgba(12,9,18,0.92); border: 2px solid rgba(255,255,255,0.08);
  border-radius: 999px; padding: 4px 12px 4px 4px; min-width: 132px; }
.pk-seat.turn .plate { border-color: var(--cz-gold); box-shadow: 0 0 14px rgba(246,197,68,0.5); }
.pk-seat.folded { opacity: 0.45; }
.pk-seat .av { width: 34px; height: 34px; border-radius: 50%; background: #2a2240; display: grid; place-items: center; font-size: 20px; flex: none; }
.pk-seat .nm { font-weight: 800; font-size: 12px; white-space: nowrap; }
.pk-seat .st { font-size: 12px; color: var(--cz-green); font-weight: 800; font-variant-numeric: tabular-nums; }
.pk-seat .act { min-height: 20px; font-size: 12px; font-weight: 800; color: var(--cz-gold); text-transform: uppercase; letter-spacing: 1px; text-align: center; }
.pk-bet { position: absolute; transform: translate(-50%, -50%); font-size: 12px; z-index: 1; }
.pk-btn { position: absolute; width: 22px; height: 22px; border-radius: 50%; background: #fff; color: #111; font-weight: 900; font-size: 11px;
  display: grid; place-items: center; transform: translate(-50%, -50%); box-shadow: 0 2px 4px rgba(0,0,0,0.5); z-index: 3; transition: left 0.4s, top 0.4s; }
.pk-log { position: absolute; left: 10px; bottom: 10px; font-size: 11px; color: var(--cz-dim); max-width: 46%; line-height: 1.5; pointer-events: none; }
.pk-raise input[type=range] { width: 100%; accent-color: #f6c544; }
`;

// Seat positions on the stage (percent) for 4 players: you at the bottom, then clockwise
const SEAT_POS = [[50, 86], [11, 47], [50, 10], [89, 47]];
const BET_POS = [[50, 66], [27, 47], [50, 28], [73, 47]];

export default {
    id: 'poker', name: "Texas Hold'em", cat: 'Cards', icon: '♠️', tint: ['#1f4037', '#0b1a14'], hot: true,
    blurb: "No-limit Hold'em against three regulars. Buy in, play, cash out.",
    mount(stage, ctx) {
        const { el, cardEl } = ctx;
        if (!document.getElementById('pk-css')) { const s = el('style'); s.id = 'pk-css'; s.textContent = CSS; document.head.append(s); }

        let table = TABLES[0];
        let seats = [];          // [{ name, avatar, stack, bot, p, hole, folded, allIn, bet, total, acted, last }]
        let seated = false, inHand = false, button = 0, board = [], deck = [];
        let playerTurn = null;   // resolve() of the action we're waiting on
        let standAfter = false;  // asked to stand up mid-hand: happens when the hand is over
        let handStart = 0;
        const log = [];

        // ---- Side panel: buy-in, then actions ----
        const lobbyBox = el('div');
        const tableSeg = ctx.segmented(Object.fromEntries(TABLES.map((t, i) => [i, t.name])), 0, (i) => { table = TABLES[i]; syncBuyIn(); });
        const blindsStat = ctx.stat('Blinds', '');
        const buyLabel = ctx.label('Buy-in', '');
        const buyRange = el('input');
        buyRange.type = 'range';
        const buyBtn = ctx.button('SIT DOWN', 'go big', () => sitDown());
        const syncBuyIn = () => {
            blindsStat.set(`${ctx.money(table.sb)} / ${ctx.money(table.bb)}`);
            const max = Math.min(table.max, Math.floor(ctx.wallet.balance));
            buyRange.min = String(table.min);
            buyRange.max = String(Math.max(table.min, max));
            buyRange.step = String(table.bb);
            buyRange.value = String(Math.max(table.min, max));
            buyLabel.right.textContent = ctx.money(Number(buyRange.value));
            buyBtn.disabled = max < table.min;
            buyBtn.textContent = max < table.min ? `NEED ${ctx.money(table.min)}` : 'SIT DOWN';
        };
        buyRange.oninput = () => { buyLabel.right.textContent = ctx.money(Number(buyRange.value)); };
        const pRange = el('div', 'pk-raise'); pRange.append(buyRange);
        lobbyBox.append(ctx.label('Table'), tableSeg, el('div', '', ''), blindsStat, buyLabel, pRange, buyBtn);
        lobbyBox.style.display = 'flex';
        lobbyBox.style.flexDirection = 'column';
        lobbyBox.style.gap = '10px';

        const actBox = el('div');
        actBox.style.cssText = 'display:none;flex-direction:column;gap:10px';
        const stackStat = ctx.stat('Your stack', '');
        const foldBtn = ctx.button('Fold', 'red', () => act({ type: 'fold' }));
        const callBtn = ctx.button('Check', 'blue', () => act({ type: 'call' }));
        const raiseLabel = ctx.label('Raise to', '');
        const raiseRange = el('input');
        raiseRange.type = 'range';
        const raiseWrap = el('div', 'pk-raise'); raiseWrap.append(raiseRange);
        const presets = el('div', 'cz-row');
        const raiseBtn = ctx.button('Raise', 'gold', () => act({ type: 'raise', to: Number(raiseRange.value) }));
        const standBtn = ctx.button('Cash out & stand up', '', () => standUp());
        raiseRange.oninput = () => { raiseLabel.right.textContent = ctx.money(Number(raiseRange.value)); };
        const r1 = el('div', 'cz-row'); r1.append(foldBtn, callBtn);
        actBox.append(stackStat, r1, raiseLabel, raiseWrap, presets, raiseBtn, standBtn);
        const info = el('div', 'cz-info');
        info.innerHTML = 'Two cards each, five on the board, best five-card hand wins. Bots rebuy when they bust. Your stack returns to your wallet when you stand up.';
        ctx.side.append(lobbyBox, actBox, info);

        // ---- Table ----
        const room = el('div', 'pk-room');
        const tableEl = el('div', 'pk-table');
        const boardEl = el('div', 'pk-board');
        const potEl = el('div', 'pk-pot cz-pill', '');
        const btnEl = el('div', 'pk-btn', 'D');
        const logEl = el('div', 'pk-log');
        tableEl.append(boardEl, potEl);
        room.append(tableEl, btnEl, logEl);
        stage.append(room);
        const seatEls = SEAT_POS.map((pos, i) => {
            const s = el('div', 'pk-seat' + (i === 0 ? ' you' : ''));
            s.style.left = pos[0] + '%';
            s.style.top = pos[1] + '%';
            const cards = el('div', 'cards');
            const plate = el('div', 'plate');
            const av = el('div', 'av');
            const txt = el('div');
            const nm = el('div', 'nm'); const st = el('div', 'st');
            txt.append(nm, st);
            plate.append(av, txt);
            const actEl = el('div', 'act');
            if (i === 0) s.append(actEl, cards, plate); else s.append(plate, cards, actEl);
            const betEl = el('div', 'pk-bet cz-pill', '');
            betEl.style.left = BET_POS[i][0] + '%';
            betEl.style.top = BET_POS[i][1] + '%';
            room.append(s, betEl);
            return { s, cards, av, nm, st, actEl, betEl };
        });

        const say = (t) => {
            log.push(t);
            while (log.length > 5) log.shift();
            logEl.textContent = '';
            for (const l of log) logEl.append(el('div', '', l));
        };
        const pot = () => seats.reduce((t, s) => t + s.total, 0);
        const render = (turn = -1, showAll = false) => {
            seats.forEach((p, i) => {
                const e = seatEls[i];
                e.s.style.display = '';
                e.av.textContent = p.avatar;
                e.nm.textContent = p.name;
                e.st.textContent = p.allIn ? 'ALL IN' : ctx.money(p.stack);
                e.s.classList.toggle('turn', i === turn);
                e.s.classList.toggle('folded', p.folded);
                e.actEl.textContent = p.last || '';
                e.betEl.textContent = p.bet > 0 ? ctx.money(p.bet) : '';
                e.betEl.style.display = p.bet > 0 ? '' : 'none';
                if (e.cards.dataset.key !== p.key + (showAll || !p.bot ? 'u' : 'd') + p.hole.length) {
                    e.cards.textContent = '';
                    for (const c of p.hole) e.cards.append(cardEl(c, { down: p.bot && !showAll }));
                    e.cards.dataset.key = p.key + (showAll || !p.bot ? 'u' : 'd') + p.hole.length;
                }
            });
            for (let i = seats.length; i < 4; i++) { seatEls[i].s.style.display = 'none'; seatEls[i].betEl.style.display = 'none'; }
            potEl.textContent = `Pot ${ctx.money(pot())}`;
            potEl.style.display = pot() > 0 ? '' : 'none';
            const bp = SEAT_POS[button] || SEAT_POS[0];
            btnEl.style.left = (bp[0] + (button === 0 ? 9 : button === 2 ? -9 : 0)) + '%';
            btnEl.style.top = (bp[1] + (button === 1 || button === 3 ? 12 : 0)) + '%';
            if (seats[0]) stackStat.set(ctx.money(seats[0].stack));
        };
        const renderBoard = () => {
            boardEl.textContent = '';
            for (let i = 0; i < 5; i++) boardEl.append(board[i] ? cardEl(board[i]) : el('div', 'pk-slot'));
        };

        let botPool = shuffle(BOTS.slice(), ctx.rand);
        let keySeq = 1;
        const newBot = () => {
            const b = botPool.length ? botPool.pop() : BOTS[Math.floor(ctx.rand() * BOTS.length)];
            if (!botPool.length) botPool = shuffle(BOTS.slice(), ctx.rand);
            const stack = Math.round(table.bb * (60 + ctx.rand() * 90));
            return { name: b.name, avatar: b.avatar, p: b, bot: true, stack, hole: [], key: keySeq++ };
        };

        function sitDown() {
            const amount = Math.round(Number(buyRange.value));
            if (!ctx.wager(amount, table.min)) return;
            seats = [{ name: 'You', avatar: '🙂', bot: false, stack: amount, hole: [], key: keySeq++ }, newBot(), newBot(), newBot()];
            seated = true;
            button = Math.floor(ctx.rand() * 4);
            lobbyBox.style.display = 'none';
            actBox.style.display = 'flex';
            tableSeg.lock(true);
            say(`You sit down with ${ctx.money(amount)}.`);
            playLoop();
        }

        function cashOut() {
            if (!seated) return;
            seated = false;
            const me = seats[0];
            const amount = me ? me.stack : 0;
            ctx.payout(amount, 0);
            return amount;
        }

        function standUp() {
            if (inHand) {
                standAfter = !standAfter;
                standBtn.textContent = standAfter ? 'Standing up after this hand…' : 'Cash out & stand up';
                return;
            }
            standAfter = false;
            standBtn.textContent = 'Cash out & stand up';
            const amount = cashOut();
            say(`You cash out ${ctx.money(amount)}.`);
            ctx.banner('CASHED OUT', amount);
            lobbyBox.style.display = 'flex';
            actBox.style.display = 'none';
            tableSeg.lock(false);
            syncBuyIn();
        }

        async function playLoop() {
            while (seated && ctx.alive) {
                await playHand();
                if (!seated || !ctx.alive) return;
                if (standAfter) return standUp();
                if (seats[0].stack < table.bb) {
                    say('You\'re out of chips.');
                    seated = false;
                    ctx.banner('BUSTED', 'Buy in again?', { lose: true });
                    lobbyBox.style.display = 'flex';
                    actBox.style.display = 'none';
                    tableSeg.lock(false);
                    syncBuyIn();
                    return;
                }
                await ctx.wait(1800);
            }
        }

        async function playHand() {
            // Busted bots leave and someone new sits down
            for (let i = 1; i < seats.length; i++) {
                if (seats[i].stack < table.bb) {
                    seats[i] = newBot();
                    say(`${seats[i].name} sits down.`);
                }
            }
            for (const s of seats) Object.assign(s, { hole: [], folded: false, allIn: false, bet: 0, total: 0, acted: false, last: '' });
            const n = seats.length;
            button = (button + 1) % n;
            handStart = seats[0].stack;
            deck = shuffle(newDeck(), ctx.rand);
            board = [];
            renderBoard();
            inHand = true;
            const sbI = (button + 1) % n, bbI = (button + 2) % n;
            post(sbI, table.sb, 'SB');
            post(bbI, table.bb, 'BB');
            for (let k = 0; k < 2; k++) {
                for (let j = 1; j <= n; j++) {
                    seats[(button + j) % n].hole.push(deck.pop());
                    render();
                    ctx.sfx.play('card');
                    await ctx.wait(120);
                }
            }
            const streets = [[0, 'Preflop'], [3, 'Flop'], [1, 'Turn'], [1, 'River']];
            for (const [deal, name] of streets) {
                if (deal) {
                    await ctx.wait(500);
                    for (let k = 0; k < deal; k++) board.push(deck.pop());
                    ctx.sfx.play('card');
                    renderBoard();
                    say(`${name}: ${board.map(cardText).join(' ')}`);
                }
                const first = name === 'Preflop' ? (bbI + 1) % n : (button + 1) % n;
                const done = await bettingRound(first, name === 'Preflop');
                if (done) return;   // everyone else folded
            }
            await showdown();
        }

        function post(i, amount, tag) {
            const s = seats[i];
            const a = Math.min(amount, s.stack);
            s.stack -= a; s.bet += a; s.total += a;
            if (s.stack === 0) s.allIn = true;
            s.last = tag;
            ctx.sfx.play('chip');
        }

        const live = () => seats.filter((s) => !s.folded);
        const canAct = () => seats.filter((s) => !s.folded && !s.allIn);

        /** Returns true when the hand ended with one player left. */
        async function bettingRound(first, preflop) {
            const n = seats.length;
            let currentBet = Math.max(...seats.map((s) => s.bet));
            let minRaise = table.bb;
            for (const s of seats) { s.acted = false; if (!preflop) s.last = s.folded ? 'Fold' : s.allIn ? 'All in' : ''; }
            let i = first;
            let guard = 0;
            while (guard++ < 200) {
                if (live().length === 1) return winByFold();
                const pending = seats.filter((s) => !s.folded && !s.allIn && (!s.acted || s.bet < currentBet));
                if (pending.length === 0) break;
                if (canAct().length === 1 && canAct()[0].bet >= currentBet) break;
                const s = seats[i];
                if (!s.folded && !s.allIn && (!s.acted || s.bet < currentBet)) {
                    render(i);
                    const toCall = currentBet - s.bet;
                    const a = s.bot
                        ? await botDecide(s, toCall, currentBet, minRaise, preflop)
                        : await playerDecide(s, toCall, currentBet, minRaise);
                    if (!ctx.alive) return true;
                    if (a.type === 'fold') {
                        s.folded = true;
                        s.last = 'Fold';
                        say(`${s.name} folds.`);
                    } else if (a.type === 'call') {
                        const pay = Math.min(toCall, s.stack);
                        s.stack -= pay; s.bet += pay; s.total += pay;
                        if (s.stack === 0) s.allIn = true;
                        s.last = s.allIn ? 'All in' : toCall === 0 ? 'Check' : 'Call';
                        if (pay) ctx.sfx.play('chip');
                        say(`${s.name} ${toCall === 0 ? 'checks' : `calls ${ctx.money(pay)}`}.`);
                    } else {
                        const to = Math.min(s.stack + s.bet, Math.max(a.to, currentBet + minRaise));
                        const pay = to - s.bet;
                        s.stack -= pay; s.bet = to; s.total += pay;
                        if (to - currentBet >= minRaise) {
                            minRaise = to - currentBet;
                            for (const o of seats) if (o !== s) o.acted = false;
                        }
                        currentBet = Math.max(currentBet, to);
                        if (s.stack === 0) s.allIn = true;
                        s.last = s.allIn ? 'All in' : 'Raise';
                        ctx.sfx.play('chip');
                        say(`${s.name} ${s.allIn ? 'goes all in' : 'raises to'} ${ctx.money(to)}.`);
                    }
                    s.acted = true;
                    render();
                }
                i = (i + 1) % n;
            }
            // Bets into the pot
            await ctx.wait(300);
            for (const s of seats) s.bet = 0;
            render();
            return false;
        }

        function winByFold() {
            const w = live()[0];
            const amount = pot();
            w.stack += amount;
            say(`${w.name} wins ${ctx.money(amount)}.`);
            for (const s of seats) { s.bet = 0; s.total = 0; }
            endHand();
            return true;
        }

        async function showdown() {
            render(-1, true);
            const ranks = seats.map((s) => (s.folded ? null : evaluatePoker([...s.hole, ...board])));
            seats.forEach((s, i) => { if (!s.folded) s.last = describePoker([...s.hole, ...board]); });
            render(-1, true);
            for (const p of buildPots(seats)) {
                let best = -1, winners = [];
                for (const i of p.eligible) {
                    const sc = ranks[i].score;
                    if (sc > best) { best = sc; winners = [i]; } else if (sc === best) winners.push(i);
                }
                const share = Math.floor(p.amount / winners.length);
                winners.forEach((i, k) => {
                    const amt = share + (k === 0 ? p.amount - share * winners.length : 0);
                    seats[i].stack += amt;
                });
                say(`${winners.map((i) => seats[i].name).join(' & ')} win${winners.length === 1 ? 's' : ''} ${ctx.money(p.amount)} with ${ranks[winners[0]].name}.`);
                for (const i of winners) seatEls[i].cards.querySelectorAll('.cz-card').forEach((c) => c.classList.add('win'));
            }
            for (const s of seats) { s.total = 0; s.bet = 0; }
            await ctx.wait(400);
            endHand();
        }

        function endHand() {
            inHand = false;
            render(-1, true);
            const net = seats[0].stack - handStart;
            ctx.wallet.recordWin(net);
            if (net > 0) ctx.banner('YOU WIN THE POT', net, { mult: seats[0].last || '' });
            else if (!seats[0].folded && net < 0) ctx.sfx.play('lose');
        }

        // ---- Decisions ----
        function playerDecide(s, toCall, currentBet, minRaise) {
            const minTo = Math.min(s.stack + s.bet, currentBet + minRaise);
            const maxTo = s.stack + s.bet;
            callBtn.textContent = toCall === 0 ? 'Check' : toCall >= s.stack ? `Call all in ${ctx.money(s.stack)}` : `Call ${ctx.money(toCall)}`;
            const canRaise = maxTo > currentBet && s.stack > toCall;
            raiseRange.min = String(minTo);
            raiseRange.max = String(maxTo);
            raiseRange.step = String(table.sb);
            raiseRange.value = String(minTo);
            raiseLabel.right.textContent = ctx.money(minTo);
            raiseBtn.textContent = currentBet === 0 ? 'Bet' : 'Raise';
            raiseRange.disabled = raiseBtn.disabled = !canRaise;
            presets.textContent = '';
            const p = pot();
            for (const [label, to] of [['½ Pot', currentBet + Math.round((p + toCall) / 2)], ['Pot', currentBet + p + toCall], ['All in', maxTo]]) {
                const b = el('button', 'cz-btn', label);
                b.style.padding = '8px 4px';
                b.style.fontSize = '12px';
                b.disabled = !canRaise;
                b.onclick = () => {
                    const v = Math.max(minTo, Math.min(maxTo, to));
                    raiseRange.value = String(v);
                    raiseLabel.right.textContent = ctx.money(v);
                };
                presets.append(b);
            }
            foldBtn.disabled = callBtn.disabled = false;
            ctx.sfx.play('tick');
            return new Promise((res) => { playerTurn = res; });
        }

        function act(a) {
            if (!playerTurn) return;
            const r = playerTurn;
            playerTurn = null;
            foldBtn.disabled = callBtn.disabled = raiseBtn.disabled = true;
            r(a);
        }

        async function botDecide(s, toCall, currentBet, minRaise, preflop) {
            await ctx.wait(500 + ctx.rand() * 900);
            const opp = live().length - 1;
            const p = s.p;
            const potNow = pot();
            const noise = (ctx.rand() - 0.5) * 0.12;
            let strength;
            if (preflop) strength = preflopStrength(s.hole[0], s.hole[1]) * (1 - 0.06 * (opp - 1));
            else strength = pokerEquity(s.hole, board, opp, 220, ctx.rand);
            strength += noise;
            const odds = toCall / (potNow + toCall || 1);
            const raiseTo = (frac) => currentBet + Math.max(minRaise, Math.round((potNow + toCall) * frac / table.sb) * table.sb);
            const strongBar = preflop ? 0.62 - p.aggr * 0.08 : 0.72 - p.aggr * 0.1;
            if (strength > strongBar + 0.15 && ctx.rand() < 0.35 + p.aggr * 0.3) return { type: 'raise', to: s.stack + s.bet };
            if (strength > strongBar) return ctx.rand() < 0.4 + p.aggr * 0.5 ? { type: 'raise', to: raiseTo(preflop ? 0.9 : 0.6 + ctx.rand() * 0.4) } : { type: 'call' };
            const callBar = preflop ? 0.36 + p.tight * 0.14 : odds + 0.04 + p.tight * 0.08;
            if (toCall === 0) {
                if (ctx.rand() < p.bluff * (preflop ? 0.5 : 1) || (strength > 0.5 && ctx.rand() < p.aggr * 0.5)) return { type: 'raise', to: raiseTo(0.5) };
                return { type: 'call' };
            }
            if (strength > callBar || (preflop && toCall <= table.bb && strength > 0.28 - (1 - p.tight) * 0.1)) {
                if (ctx.rand() < p.bluff * 0.3) return { type: 'raise', to: raiseTo(0.7) };
                return { type: 'call' };
            }
            if (ctx.rand() < p.bluff * 0.25 && toCall < s.stack * 0.2) return { type: 'raise', to: raiseTo(1) };
            return { type: 'fold' };
        }

        syncBuyIn();
        renderBoard();
        for (let i = 0; i < 4; i++) { seatEls[i].s.style.display = 'none'; seatEls[i].betEl.style.display = 'none'; }
        potEl.style.display = 'none';
        say('Pick a table and sit down.');

        return {
            busy: () => seated,
            // Walking away folds the hand in progress and cashes out the stack
            leave: () => { if (inHand && seats[0]) seats[0].folded = true; cashOut(); },
            destroy: () => cashOut()
        };
    }
};
