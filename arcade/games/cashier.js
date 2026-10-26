/**
 * The bank: your balance and record, a game guide, and, when you're broke, a
 * handful of free chips from the house (once every few minutes).
 */

const COMP_AMOUNT = 500;
const COMP_BELOW = 25;
const COMP_COOLDOWN_MS = 3 * 60 * 1000;
const COMP_KEY = 'kajarcade.comp';

const GUIDE = [
    ['Table games', "Blackjack, Baccarat, Roulette and Texas Hold'em"],
    ['Slots & video poker', "Kaj's Fortune machines and Jacks or Better"],
    ['Kaj Originals', 'Crash, Plinko, Mines, Penguin Cross, Higher or Lower, Dragon Towers, Dice, Keno and Coin Flip'],
    ['Prize Wheel', 'One spin, big multipliers']
];

const CSS = `
.cs-wrap { flex: 1; display: flex; flex-direction: column; gap: 14px; padding: 18px; overflow: auto;
  background: linear-gradient(160deg, rgba(59,29,110,0.6), rgba(107,31,91,0.5) 55%, rgba(162,52,31,0.45)); }
.cs-bal { font-family: Georgia, serif; font-size: clamp(34px, 6vw, 56px); font-weight: 700; color: #8dffbe; font-variant-numeric: tabular-nums; }
.cs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.cs-guide div { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.08); }
.cs-guide b { display: block; }
.cs-guide span { color: var(--cz-dim); font-size: 13px; }
`;

export default {
    id: 'cashier', name: 'Bank', cat: 'House', icon: '💵', tint: ['#2e9e5b', '#0b3d22'],
    blurb: 'Your balance, your record, and free chips when you\'re broke.',
    mount(stage, ctx) {
        const { el } = ctx;
        if (!document.getElementById('cs-css')) { const s = el('style'); s.id = 'cs-css'; s.textContent = CSS; document.head.append(s); }
        const w = ctx.wallet;
        const comp = ctx.button(`Free chips: ${ctx.money(COMP_AMOUNT)}`, 'gold big', () => claim());
        const note = el('div', 'cz-info');
        ctx.side.append(ctx.label('The house'), comp, note);

        const wrap = el('div', 'cs-wrap');
        const bal = el('div', 'cs-bal');
        const grid = el('div', 'cs-grid');
        const s1 = ctx.stat('Rounds played'), s2 = ctx.stat('Biggest win'), s3 = ctx.stat('Won all time'), s4 = ctx.stat('Spent all time');
        grid.append(s1, s2, s3, s4);
        const guide = el('div', 'cs-guide');
        for (const [a, b] of GUIDE) { const d = el('div'); d.append(el('b', '', a), el('span', '', b)); guide.append(d); }
        wrap.append(ctx.label('Your balance'), bal, grid, ctx.label('The games'), guide);
        stage.append(wrap);

        const lastClaim = () => { try { return Number(localStorage.getItem(COMP_KEY)) || 0; } catch (e) { return 0; } };
        function refresh() {
            bal.textContent = ctx.money(w.balance, { cents: true });
            s1.set(String(w.stats.hands || 0));
            s2.set(ctx.money(w.stats.biggestWin || 0));
            s3.set(ctx.money(w.stats.earned || 0));
            s4.set(ctx.money(w.stats.spent || 0));
            const wait = lastClaim() + COMP_COOLDOWN_MS - Date.now();
            comp.disabled = w.balance >= COMP_BELOW || wait > 0;
            note.innerHTML = w.balance >= COMP_BELOW
                ? `The house helps out players with less than <b>${ctx.money(COMP_BELOW)}</b>. Good luck out there.`
                : wait > 0 ? `Come back in <b>${Math.ceil(wait / 1000)}s</b> for more free chips.`
                    : 'Down on your luck? Have some chips on the house.';
        }
        function claim() {
            if (w.balance >= COMP_BELOW || lastClaim() + COMP_COOLDOWN_MS > Date.now()) return;
            try { localStorage.setItem(COMP_KEY, String(Date.now())); } catch (e) { /* no storage */ }
            w.add(COMP_AMOUNT, 'free chips');
            ctx.sfx.play('cashout');
            ctx.banner('ON THE HOUSE', COMP_AMOUNT);
            refresh();
        }
        refresh();
        const t = setInterval(refresh, 1000);
        return { destroy: () => clearInterval(t) };
    }
};
