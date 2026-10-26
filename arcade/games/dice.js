/**
 * Dice: roll 0.00–100.00. Slide the target, bet over or under it; the payout is 99 / win chance.
 */

export const diceMult = (chance) => Math.floor((99 / chance) * 10000) / 10000;

const CSS = `
.dc-wrap { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 40px; padding: 26px clamp(16px, 5vw, 60px);
  background: radial-gradient(ellipse at 50% 30%, #1f2a44, #0c111d 70%); }
.dc-track { position: relative; height: 16px; border-radius: 8px; }
.dc-track input { position: absolute; inset: -10px 0; width: 100%; opacity: 0; cursor: pointer; }
.dc-knob { position: absolute; top: 50%; width: 30px; height: 30px; border-radius: 8px; background: #5a6bff; transform: translate(-50%, -50%);
  box-shadow: 0 2px 8px rgba(0,0,0,0.5); pointer-events: none; display: grid; place-items: center; color: #fff; font-weight: 900; font-size: 12px; }
.dc-scale { display: flex; justify-content: space-between; color: var(--cz-dim); font-weight: 700; font-size: 12px; margin-top: 10px; }
.dc-roll { position: absolute; bottom: 26px; transform: translateX(-50%); transition: left 0.5s cubic-bezier(.2,1.3,.4,1); padding: 6px 10px;
  border-radius: 8px; font-weight: 900; font-size: 18px; background: #fff; color: #111; box-shadow: 0 4px 12px rgba(0,0,0,0.4); white-space: nowrap; }
.dc-roll::after { content: ''; position: absolute; left: 50%; bottom: -6px; transform: translateX(-50%) rotate(45deg); width: 12px; height: 12px; background: inherit; }
.dc-roll.w { background: var(--cz-green); color: #04331f; } .dc-roll.l { background: var(--cz-red); color: #fff; }
.dc-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.dc-stats .cz-stat { flex-direction: column; gap: 4px; }
`;

export default {
    id: 'dice', name: 'Dice', cat: 'Originals', icon: '🎲', tint: ['#4776e6', '#1b1f4b'],
    blurb: 'Pick your odds with a slider. Roll over or under.',
    mount(stage, ctx) {
        const { el } = ctx;
        if (!document.getElementById('dc-css')) { const s = el('style'); s.id = 'dc-css'; s.textContent = CSS; document.head.append(s); }
        let target = 50.5, over = true, busy = false;
        const bet = ctx.betPanel({ initial: 10, min: 0.1 });
        const dirSeg = ctx.segmented({ over: 'Roll over', under: 'Roll under' }, 'over', (v) => { over = v === 'over'; target = 100 - target; refresh(); });
        const rollBtn = ctx.button('ROLL', 'go big', () => roll());
        const autoSeg = ctx.segmented({ 0: 'Auto off', 10: '×10', 50: '×50' }, 0, (v) => { auto = v; if (v && !busy) roll(); });
        let auto = 0;
        const profitStat = ctx.stat('Profit on win', '');
        const info = el('div', 'cz-info');
        info.innerHTML = 'Drag the slider to set the target. The roll is a number from <b>0.00</b> to <b>100.00</b>. Lower odds pay more: <b>multiplier = 99 ÷ win chance</b>.';
        ctx.side.append(bet, dirSeg, rollBtn, ctx.label('Auto roll'), autoSeg, profitStat, info);

        const wrap = el('div', 'dc-wrap');
        const trackBox = el('div');
        trackBox.style.position = 'relative';
        trackBox.style.paddingTop = '60px';
        const track = el('div', 'dc-track');
        const input = el('input');
        input.type = 'range'; input.min = '2'; input.max = '98'; input.step = '0.01';
        const knob = el('div', 'dc-knob', '');
        const rollTag = el('div', 'dc-roll', '50.00');
        rollTag.style.left = '50%';
        rollTag.style.display = 'none';
        track.append(knob, input);
        const scale = el('div', 'dc-scale');
        for (const v of [0, 25, 50, 75, 100]) scale.append(el('span', '', String(v)));
        trackBox.append(rollTag, track, scale);
        const stats = el('div', 'dc-stats');
        const multS = ctx.stat('Multiplier', ''), targetS = ctx.stat('Roll over', ''), chanceS = ctx.stat('Win chance', '');
        stats.append(multS, targetS, chanceS);
        const hist = ctx.history(14);
        wrap.append(hist, trackBox, stats);
        stage.append(wrap);

        input.oninput = () => { target = Number(input.value); refresh(); };
        const chance = () => (over ? 100 - target : target);
        function refresh() {
            target = Math.max(2, Math.min(98, Math.round(target * 100) / 100));
            input.value = String(target);
            knob.style.left = target + '%';
            knob.textContent = '⇔';
            const win = over ? '#2fe39a' : '#ff4f6e', lose = over ? '#ff4f6e' : '#2fe39a';
            track.style.background = `linear-gradient(90deg, ${lose} ${target}%, ${win} ${target}%)`;
            const c = chance();
            multS.set(`${diceMult(c).toFixed(4)}×`);
            targetS.firstChild.textContent = over ? 'Roll over' : 'Roll under';
            targetS.set(target.toFixed(2));
            chanceS.set(`${c.toFixed(2)}%`);
            profitStat.set(ctx.money(bet.value * diceMult(c) - bet.value));
        }

        async function roll() {
            if (busy) return;
            const stake = bet.value;
            if (!ctx.wager(stake, 0.1)) { auto = 0; autoSeg.set(0); return; }
            busy = true;
            rollBtn.disabled = true;
            const r = Math.floor(ctx.rand() * 10001) / 100;
            const won = over ? r > target : r < target;
            rollTag.style.display = '';
            rollTag.className = 'dc-roll';
            rollTag.style.left = r + '%';
            ctx.sfx.play('flip');
            await ctx.wait(450);
            rollTag.textContent = r.toFixed(2);
            rollTag.className = 'dc-roll ' + (won ? 'w' : 'l');
            const m = diceMult(chance());
            ctx.payout(won ? stake * m : 0, stake);
            hist.push(r.toFixed(2), won ? 'g' : 'r');
            if (won) ctx.sfx.play(m >= 5 ? 'win' : 'gem');
            else ctx.sfx.play('tick', { freq: 300 });
            if (won && m >= 10) ctx.banner('WIN', stake * m, { mult: `${m.toFixed(2)}×`, big: true });
            busy = false;
            rollBtn.disabled = false;
            if (auto > 0) {
                auto--;
                if (auto <= 0) autoSeg.set(0);
                await ctx.wait(350);
                if (auto > 0) roll();
            }
        }

        // Profit-on-win follows the bet amount (chips, ½, 2× and typing all end in a click or change)
        bet.addEventListener('click', () => setTimeout(refresh));
        bet.addEventListener('change', refresh);
        refresh();
        return { busy: () => busy, leave: () => { auto = 0; } };
    }
};
