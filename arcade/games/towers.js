/**
 * Towers: climb nine floors by picking a safe door on each. Easy floors have one trap in four,
 * Master floors only one safe door in four. Cash out on any floor, or reach the top for the egg.
 */

export const TOWER_FLOORS = 9;
export const TOWER_MODES = {
    easy: { name: 'Easy', doors: 4, traps: 1 },
    medium: { name: 'Medium', doors: 3, traps: 1 },
    hard: { name: 'Hard', doors: 2, traps: 1 },
    expert: { name: 'Expert', doors: 3, traps: 2 },
    master: { name: 'Master', doors: 4, traps: 3 }
};
const HOUSE = 0.98;

export function towerMult(mode, floors) {
    if (floors <= 0) return 1;
    const m = TOWER_MODES[mode];
    const p = (m.doors - m.traps) / m.doors;
    return Math.floor((HOUSE / p ** floors) * 100) / 100;
}

const CSS = `
.tw-wrap { flex: 1; display: grid; place-items: center; padding: 14px; background: linear-gradient(180deg, #2b0f3a, #120617); }
.tw-tower { display: flex; flex-direction: column-reverse; gap: 6px; width: min(100%, 440px); padding: 12px; border-radius: 16px;
  background: linear-gradient(180deg, #4b2a14, #2c170a); box-shadow: 0 0 0 4px #1a0d05, 0 10px 30px rgba(0,0,0,0.5); }
.tw-floor { display: flex; gap: 6px; align-items: center; }
.tw-floor .m { width: 64px; flex: none; font-size: 12px; font-weight: 800; color: var(--cz-dim); text-align: right; font-variant-numeric: tabular-nums; }
.tw-floor.cur .m { color: var(--cz-gold); }
.tw-door { flex: 1; height: clamp(30px, 5.4vh, 46px); border-radius: 8px; background: #6b4423; box-shadow: inset 0 -4px 0 rgba(0,0,0,0.3);
  font-size: 20px; display: grid; place-items: center; }
.tw-floor.cur .tw-door:not(:disabled) { background: #a8692f; animation: twGlow 1s ease-in-out infinite alternate; }
@keyframes twGlow { to { background: #c98a45; } }
.tw-door.safe { background: #1d5a3c; } .tw-door.trap { background: #6b1626; } .tw-door.ghost { opacity: 0.5; }
.tw-top { text-align: center; font-size: 34px; margin-bottom: 4px; }
`;

export default {
    id: 'towers', name: 'Dragon Towers', cat: 'Originals', icon: '🐉', tint: ['#a83279', '#2a0845'],
    blurb: 'Pick a safe door on each floor and climb. Cash out before the dragon wakes.',
    mount(stage, ctx) {
        const { el } = ctx;
        if (!document.getElementById('tw-css')) { const s = el('style'); s.id = 'tw-css'; s.textContent = CSS; document.head.append(s); }
        let mode = 'medium';
        const bet = ctx.betPanel({ initial: 10, min: 0.1 });
        const modeSeg = ctx.segmented(Object.fromEntries(Object.entries(TOWER_MODES).map(([k, v]) => [k, v.name])), mode, (v) => { mode = v; build(); });
        const playBtn = ctx.button('BET', 'go big', () => (playing ? cashOut() : begin()));
        const nextStat = ctx.stat('Next floor', '');
        const info = el('div', 'cz-info');
        info.innerHTML = 'Choose one door per floor, starting at the bottom. Safe doors take you up and raise the multiplier; a trap ends the climb.';
        ctx.side.append(bet, ctx.label('Difficulty'), modeSeg, playBtn, nextStat, info);

        const wrap = el('div', 'tw-wrap');
        const tower = el('div', 'tw-tower');
        const top = el('div', 'tw-top', '🥚');
        wrap.append(tower);
        stage.append(wrap);

        let playing = false, stake = 0, floor = 0, traps = [], floorsEl = [];

        function build() {
            tower.textContent = '';
            floorsEl = [];
            const m = TOWER_MODES[mode];
            for (let f = 0; f < TOWER_FLOORS; f++) {
                const row = el('div', 'tw-floor');
                const doors = [];
                for (let d = 0; d < m.doors; d++) {
                    const b = el('button', 'tw-door');
                    b.onclick = () => pick(f, d);
                    doors.push(b);
                    row.append(b);
                }
                row.append(el('div', 'm', `${towerMult(mode, f + 1).toFixed(2)}×`));
                tower.append(row);
                floorsEl.push({ row, doors });
            }
            tower.append(top);
            refresh();
        }

        function refresh() {
            floorsEl.forEach((f, i) => {
                f.row.classList.toggle('cur', playing && i === floor);
                for (const d of f.doors) d.disabled = !(playing && i === floor);
            });
            nextStat.set(floor < TOWER_FLOORS ? `${towerMult(mode, floor + 1).toFixed(2)}×` : '—');
            playBtn.textContent = playing ? (floor ? `CASH OUT ${ctx.money(stake * towerMult(mode, floor))}` : 'Pick a door') : 'BET';
            playBtn.className = 'cz-btn big ' + (playing ? 'gold' : 'go');
            playBtn.disabled = playing && floor === 0;
            modeSeg.lock(playing);
            bet.lock(playing);
        }

        function begin() {
            stake = bet.value;
            if (!ctx.wager(stake, 0.1)) return;
            const m = TOWER_MODES[mode];
            traps = [];
            for (let f = 0; f < TOWER_FLOORS; f++) {
                const idx = [...Array(m.doors).keys()].sort(() => ctx.rand() - 0.5);
                traps.push(new Set(idx.slice(0, m.traps)));
            }
            build();
            playing = true;
            floor = 0;
            refresh();
        }

        function showAll() {
            floorsEl.forEach((f, i) => f.doors.forEach((d, k) => {
                if (d.textContent) return;
                d.classList.add(traps[i].has(k) ? 'trap' : 'safe', 'ghost');
                d.textContent = traps[i].has(k) ? '🔥' : '🪙';
            }));
        }

        function pick(f, d) {
            if (!playing || f !== floor) return;
            const door = floorsEl[f].doors[d];
            if (traps[f].has(d)) {
                door.classList.add('trap');
                door.textContent = '🐉';
                ctx.sfx.play('boom');
                playing = false;
                ctx.payout(0, stake);
                ctx.banner('THE DRAGON WOKE UP', -stake, { lose: true });
                showAll();
                refresh();
                return;
            }
            door.classList.add('safe');
            door.textContent = '🪙';
            floor++;
            ctx.sfx.play('gem', { freq: 500 + floor * 70 });
            if (floor >= TOWER_FLOORS) return cashOut();
            refresh();
        }

        function cashOut() {
            if (!playing || floor === 0) return;
            const m = towerMult(mode, floor);
            const ret = stake * m;
            ctx.payout(ret, stake);
            ctx.sfx.play('cashout');
            ctx.banner(floor >= TOWER_FLOORS ? 'TOP OF THE TOWER!' : 'CASHED OUT', ret, { mult: `${m.toFixed(2)}×`, big: m >= 10 });
            playing = false;
            showAll();
            refresh();
        }

        build();
        return {
            busy: () => playing,
            leave: () => { if (playing) { ctx.payout(stake * towerMult(mode, floor), stake); playing = false; } }
        };
    }
};
