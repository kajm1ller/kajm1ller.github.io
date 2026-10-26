/**
 * Crash: a rocket takes off and the multiplier climbs until it blows up at a random point. Cash
 * out before it does. The crash point is 0.99 / (1 - U), so whatever you aim for, the game keeps
 * 1%. Rounds run back to back with a short betting window; other players at the table are bots.
 */

export const GROWTH = 0.085; // multiplier = e^(GROWTH * seconds)

export function crashPoint(u) {
    return Math.max(1, Math.floor((0.99 / (1 - u)) * 100) / 100);
}
export const multAt = (t) => Math.exp(GROWTH * t);
export const timeFor = (m) => Math.log(m) / GROWTH;

const NAMES = ['xXSlayerXx', 'moonboi', 'kaj_fan_42', 'grandmaGambles', 'BGSU_Falcon', 'diamondhands', 'ratking', 'lucky7', 'notmyrent',
    'quickflip', 'cryptochad', 'sk8rgrl', 'Big_Tony', 'just1more', 'rocketman', 'yolo_yusuf', 'hodl_harriet', 'bets4days'];

const CSS = `
.cr-wrap { flex: 1; display: flex; min-height: 0; }
.cr-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.cr-canvas { flex: 1; min-height: 260px; width: 100%; display: block; }
.cr-players { width: 210px; flex: none; border-left: 1px solid var(--cz-line); padding: 10px; overflow: auto; font-size: 12px; }
.cr-players h4 { margin: 0 0 8px; font-size: 12px; color: var(--cz-dim); display: flex; justify-content: space-between; }
.cr-p { display: flex; justify-content: space-between; padding: 4px 6px; border-radius: 6px; font-variant-numeric: tabular-nums; }
.cr-p.out { background: rgba(47,227,154,0.12); color: var(--cz-green); }
.cr-p.you { font-weight: 900; }
@media (max-width: 760px) { .cr-players { display: none; } }
`;

export default {
    id: 'crash', name: 'Crash', cat: 'Originals', icon: '🚀', tint: ['#ff512f', '#3b0a45'], hot: true,
    blurb: 'Ride the rocket. Cash out before it blows up.',
    mount(stage, ctx) {
        const { el } = ctx;
        if (!document.getElementById('cr-css')) { const s = el('style'); s.id = 'cr-css'; s.textContent = CSS; document.head.append(s); }
        const bet = ctx.betPanel({ initial: 10, min: 0.1 });
        const autoLabel = ctx.label('Auto cash out at', '');
        const autoField = el('div', 'cz-field');
        const autoInput = el('input');
        autoInput.type = 'number'; autoInput.min = '1.01'; autoInput.step = '0.01'; autoInput.value = '2.00';
        autoField.append(autoInput, el('span', 'pre', '×'));
        autoField.lastChild.style.paddingRight = '12px';
        const mainBtn = ctx.button('BET', 'go big', () => press());
        const info = el('div', 'cz-info');
        info.innerHTML = 'Bet during the countdown. The multiplier climbs until the rocket <b>crashes</b>; cash out before then to win your bet × the multiplier. Set an <b>auto cash out</b> to bail at a target (0 = off).';
        ctx.side.append(bet, autoLabel, autoField, mainBtn, info);

        const wrap = el('div', 'cr-wrap');
        const main = el('div', 'cr-main');
        const hist = ctx.history(16);
        const canvas = el('canvas', 'cr-canvas');
        main.append(hist, canvas);
        const players = el('div', 'cr-players');
        wrap.append(main, players);
        stage.append(wrap);
        const g = canvas.getContext('2d');
        let W = 0, H = 0;
        const resize = () => {
            const r = canvas.getBoundingClientRect();
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            canvas.width = Math.max(1, r.width * dpr); canvas.height = Math.max(1, r.height * dpr);
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            W = r.width; H = r.height;
        };
        resize();
        window.addEventListener('resize', resize);

        // Round state
        let phase = 'betting', timer = 5, t = 0, crashAt = 2, m = 1;
        let mine = null;          // { stake, auto, out: null | multiplier }
        let queued = false;       // bet placed for the next round while this one flies
        let bots = [];
        let sparks = [];
        const history = [];

        const newBots = () => {
            const n = 6 + Math.floor(ctx.rand() * 7);
            const pool = NAMES.slice().sort(() => ctx.rand() - 0.5);
            bots = pool.slice(0, n).map((name) => ({
                name, stake: Math.round((5 + ctx.rand() ** 2 * 800) * 100) / 100,
                target: Math.round((1.1 + ctx.rand() ** 2.2 * 12) * 100) / 100, out: null
            }));
        };
        newBots();

        const renderPlayers = () => {
            players.textContent = '';
            const total = bots.length + (mine ? 1 : 0);
            const h = el('h4');
            h.append(el('span', '', `${total} playing`), el('span', '', ''));
            players.append(h);
            const list = mine ? [{ name: 'You', stake: mine.stake, out: mine.out, you: true }, ...bots] : bots;
            for (const p of list) {
                const r = el('div', 'cr-p' + (p.out ? ' out' : '') + (p.you ? ' you' : ''));
                r.append(el('span', '', p.name), el('span', '', p.out ? `${p.out.toFixed(2)}× ${ctx.money(p.stake * p.out)}` : ctx.money(p.stake)));
                players.append(r);
            }
        };
        renderPlayers();

        const refresh = () => {
            if (phase === 'flying' && mine && !mine.out) {
                mainBtn.textContent = `CASH OUT ${ctx.money(mine.stake * m)}`;
                mainBtn.className = 'cz-btn big gold';
                mainBtn.disabled = false;
            } else if (phase === 'betting') {
                mainBtn.textContent = mine ? 'BET PLACED' : 'BET';
                mainBtn.className = 'cz-btn big go';
                mainBtn.disabled = !!mine;
            } else {
                mainBtn.textContent = queued ? 'Cancel (next round)' : 'BET (next round)';
                mainBtn.className = 'cz-btn big ' + (queued ? 'red' : 'go');
                mainBtn.disabled = false;
            }
            bet.lock(!!mine || queued);
        };

        function place() {
            const stake = bet.value;
            if (!ctx.wager(stake, 0.1)) return false;
            const a = Number(autoInput.value);
            mine = { stake, auto: a >= 1.01 ? a : 0, out: null };
            renderPlayers();
            return true;
        }

        function press() {
            if (phase === 'betting' && !mine) place();
            else if (phase === 'flying' && mine && !mine.out) cashOut();
            else if (phase !== 'betting') queued = !queued;
            refresh();
        }

        function cashOut(at = m) {
            if (!mine || mine.out) return;
            mine.out = at;
            const ret = mine.stake * at;
            ctx.payout(ret, mine.stake);
            ctx.sfx.play('cashout');
            ctx.banner('CASHED OUT', ret, { mult: `${at.toFixed(2)}×`, big: at >= 10 });
            renderPlayers();
            refresh();
        }

        const roundRect = (x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); };
        let lastTick = 1;

        ctx.loop((dt) => {
            if (!W) resize();
            if (phase === 'betting') {
                timer -= dt;
                if (timer <= 0) {
                    phase = 'flying';
                    t = 0; m = 1; lastTick = 1;
                    crashAt = crashPoint(ctx.rand());
                    ctx.sfx.play('rise', { freq: 300 });
                }
            } else if (phase === 'flying') {
                t += dt;
                m = multAt(t);
                if (m >= crashAt) {
                    m = crashAt;
                    // Auto cash outs exactly at the crash point still count
                    if (mine && !mine.out && mine.auto && mine.auto <= crashAt) cashOut(mine.auto);
                    for (const b of bots) if (!b.out && b.target <= crashAt) b.out = b.target;
                    phase = 'crashed';
                    timer = 3;
                    ctx.sfx.play('boom');
                    for (let i = 0; i < 40; i++) sparks.push({ a: ctx.rand() * Math.PI * 2, v: 40 + ctx.rand() * 220, life: 1 });
                    if (mine && !mine.out) { ctx.payout(0, mine.stake); ctx.banner(`CRASHED @ ${crashAt.toFixed(2)}×`, -mine.stake, { lose: true }); }
                    history.push(crashAt);
                    hist.push(`${crashAt.toFixed(2)}×`, crashAt >= 10 ? 'y' : crashAt >= 2 ? 'g' : 'r');
                    renderPlayers();
                } else {
                    if (mine && !mine.out && mine.auto && m >= mine.auto) cashOut(mine.auto);
                    let changed = false;
                    for (const b of bots) if (!b.out && m >= b.target) { b.out = b.target; changed = true; }
                    if (changed) renderPlayers();
                    if (Math.floor(m * 4) > Math.floor(lastTick * 4)) ctx.sfx.play('tick', { freq: 900 + Math.min(2000, m * 120) });
                    lastTick = m;
                }
            } else if (phase === 'crashed') {
                timer -= dt;
                if (timer <= 0) {
                    phase = 'betting';
                    timer = 6;
                    mine = null;
                    newBots();
                    if (queued) { queued = false; place(); }
                    renderPlayers();
                }
            }
            refresh();

            // ---- Paint ----
            g.clearRect(0, 0, W, H);
            const padL = 46, padB = 30, padT = 20, padR = 20;
            const gw = W - padL - padR, gh = H - padT - padB;
            const tMax = Math.max(8, t * 1.15), mMax = Math.max(2, m * 1.2);
            const X = (tt) => padL + (tt / tMax) * gw;
            const Y = (mm) => padT + gh - ((mm - 1) / (mMax - 1)) * gh;
            g.strokeStyle = 'rgba(255,255,255,0.07)';
            g.fillStyle = 'rgba(255,255,255,0.45)';
            g.font = '600 11px Segoe UI, sans-serif';
            g.lineWidth = 1;
            const step = mMax > 20 ? 5 : mMax > 6 ? 1 : mMax > 3 ? 0.5 : 0.25;
            for (let v = 1; v <= mMax; v += step) {
                g.beginPath(); g.moveTo(padL, Y(v)); g.lineTo(W - padR, Y(v)); g.stroke();
                g.textAlign = 'right';
                g.fillText(`${v.toFixed(v < 10 ? 2 : 0)}×`, padL - 6, Y(v) + 4);
            }
            for (let s = 0; s <= tMax; s += tMax > 40 ? 10 : tMax > 16 ? 4 : 2) {
                g.textAlign = 'center';
                g.fillText(`${s}s`, X(s), H - 10);
            }
            if (phase !== 'betting') {
                // Curve, filled underneath
                const crashed = phase === 'crashed';
                g.beginPath();
                g.moveTo(X(0), Y(1));
                const n = 60;
                for (let i = 1; i <= n; i++) { const tt = (t * i) / n; g.lineTo(X(tt), Y(multAt(tt))); }
                const tipX = X(t), tipY = Y(m);
                g.lineTo(tipX, Y(1));
                g.closePath();
                const grad = g.createLinearGradient(0, tipY, 0, Y(1));
                grad.addColorStop(0, crashed ? 'rgba(255,79,110,0.35)' : 'rgba(246,197,68,0.35)');
                grad.addColorStop(1, 'rgba(0,0,0,0)');
                g.fillStyle = grad;
                g.fill();
                g.beginPath();
                g.moveTo(X(0), Y(1));
                for (let i = 1; i <= n; i++) { const tt = (t * i) / n; g.lineTo(X(tt), Y(multAt(tt))); }
                g.strokeStyle = crashed ? '#ff4f6e' : '#f6c544';
                g.lineWidth = 4;
                g.stroke();
                // Rocket at the tip (or the explosion)
                if (!crashed) {
                    const ang = Math.atan2(Y(multAt(t)) - Y(multAt(Math.max(0, t - 0.3))), X(t) - X(Math.max(0, t - 0.3)));
                    g.save();
                    g.translate(tipX, tipY);
                    g.rotate(ang + Math.PI / 4);
                    g.font = '30px serif';
                    g.textAlign = 'center';
                    g.fillText('🚀', 0, 10);
                    g.restore();
                } else {
                    for (const s of sparks) {
                        s.life -= dt * 0.8;
                        const d = s.v * (1 - s.life);
                        g.fillStyle = `rgba(255,${120 + Math.floor(s.v / 2)},60,${Math.max(0, s.life)})`;
                        g.beginPath(); g.arc(tipX + Math.cos(s.a) * d, tipY + Math.sin(s.a) * d, 3, 0, Math.PI * 2); g.fill();
                    }
                    sparks = sparks.filter((s) => s.life > 0);
                }
            }
            // Big number
            g.textAlign = 'center';
            if (phase === 'betting') {
                g.fillStyle = '#fff';
                g.font = '900 20px Segoe UI, sans-serif';
                g.fillText('NEXT ROUND IN', W / 2, H / 2 - 30);
                g.font = '900 54px Segoe UI, sans-serif';
                g.fillText(`${Math.max(0, timer).toFixed(1)}s`, W / 2, H / 2 + 26);
                // countdown bar
                g.fillStyle = 'rgba(255,255,255,0.12)';
                roundRect(W / 2 - 120, H / 2 + 46, 240, 8, 4); g.fill();
                g.fillStyle = '#2fe39a';
                roundRect(W / 2 - 120, H / 2 + 46, 240 * Math.max(0, timer / 6), 8, 4); g.fill();
            } else {
                g.fillStyle = phase === 'crashed' ? '#ff4f6e' : '#fff';
                g.font = '900 64px Segoe UI, sans-serif';
                g.fillText(`${m.toFixed(2)}×`, W / 2, H / 2);
                if (phase === 'crashed') {
                    g.font = '900 18px Segoe UI, sans-serif';
                    g.fillText('CRASHED', W / 2, H / 2 + 30);
                }
            }
        });

        refresh();
        return {
            busy: () => !!(mine && !mine.out && phase !== 'crashed'),
            // Leaving mid-flight cashes out at the current multiplier; before take-off the bet is returned
            leave: () => {
                if (!mine || mine.out) return;
                if (phase === 'flying') { mine.out = m; ctx.payout(mine.stake * m, mine.stake); }
                else if (phase === 'betting') ctx.wallet.add(mine.stake, 'crash refund');
            },
            destroy: () => window.removeEventListener('resize', resize)
        };
    }
};
