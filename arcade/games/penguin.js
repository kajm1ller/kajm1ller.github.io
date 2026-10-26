/**
 * Penguin Cross: walk a penguin across twenty lanes of traffic. Each lane crossed multiplies the
 * bet; cash out before a snowplow flattens you. Harder modes have deadlier lanes and steeper
 * multipliers (3% edge). Drawn on a canvas.
 */

export const LANES = 20;
export const DIFFICULTY = {
    easy: { name: 'Easy', survive: 24 / 25 },
    medium: { name: 'Medium', survive: 22 / 25 },
    hard: { name: 'Hard', survive: 20 / 25 },
    daredevil: { name: 'Daredevil', survive: 15 / 25 }
};
const HOUSE = 0.97;

/** Multiplier after crossing `k` lanes. */
export function penguinMult(diff, k) {
    if (k <= 0) return 1;
    return Math.floor((HOUSE / DIFFICULTY[diff].survive ** k) * 100) / 100;
}

const CAR_COLORS = ['#ff4f6e', '#4fa3ff', '#f6c544', '#2fe39a', '#c86bff', '#ff8a3d', '#e8e8f0'];

export default {
    id: 'penguin', name: 'Penguin Cross', cat: 'Originals', icon: '🐧', tint: ['#36d1dc', '#2b3a8f'], hot: true,
    blurb: 'Waddle across the highway. Every lane stacks the multiplier: cash out before the plow.',
    mount(stage, ctx) {
        const { el } = ctx;
        const bet = ctx.betPanel({ initial: 10, min: 0.1 });
        let diff = 'medium';
        const diffSeg = ctx.segmented(Object.fromEntries(Object.entries(DIFFICULTY).map(([k, v]) => [k, v.name])), diff, (v) => { diff = v; refresh(); });
        const playBtn = ctx.button('PLAY', 'go big', () => (state === 'idle' || state === 'dead' || state === 'won' ? begin() : step()));
        const cashBtn = ctx.button('Cash out', 'gold', () => cashOut());
        const nextStat = ctx.stat('Next lane', '');
        const chanceStat = ctx.stat('Survival per lane', '');
        const info = el('div', 'cz-info');
        info.innerHTML = 'Each <b>GO</b> waddles one lane over. Make it and your multiplier grows; get hit and the bet is gone. <b>Cash out</b> whenever you like. Twenty lanes pays the jackpot.';
        ctx.side.append(bet, ctx.label('Difficulty'), diffSeg, playBtn, cashBtn, nextStat, chanceStat, info);

        const canvas = el('canvas');
        canvas.style.cssText = 'width:100%;height:100%;display:block;flex:1;min-height:320px';
        stage.append(canvas);
        const g = canvas.getContext('2d');

        let state = 'idle';     // idle | walk | ready | dead | won
        let lane = 0;           // lanes crossed (penguin stands in lane `lane`, 0 = the start pavement)
        let stake = 0;
        const peng = { x: 0, fromX: 0, toX: 0, t: 1, squash: 0, flat: false, wobble: 0 };
        let cam = 0;
        let cars = [];          // { lane, y, speed, color, len, killer, stopAt }
        let feathers = [];
        const barriers = new Set();
        let W = 0, H = 0, LW = 110, ROAD_T = 0, ROAD_B = 0;

        const laneX = (k) => 120 + (k - 0.5) * LW;      // centre of lane k (1..LANES); 0 = start
        const penguinX = (k) => (k === 0 ? 60 : laneX(k));

        const resize = () => {
            const r = canvas.getBoundingClientRect();
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            canvas.width = Math.max(1, r.width * dpr);
            canvas.height = Math.max(1, r.height * dpr);
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            W = r.width; H = r.height;
            LW = Math.max(84, Math.min(130, H * 0.26));
            ROAD_T = 40; ROAD_B = H - 30;
        };
        resize();
        const onResize = () => resize();
        window.addEventListener('resize', onResize);

        function refresh() {
            const s = DIFFICULTY[diff].survive;
            nextStat.set(lane < LANES ? `${penguinMult(diff, lane + 1).toFixed(2)}×` : '—');
            chanceStat.set(`${(s * 100).toFixed(0)}%`);
            const active = state === 'ready' || state === 'walk';
            playBtn.textContent = active ? 'GO' : 'PLAY';
            playBtn.disabled = state === 'walk';
            cashBtn.disabled = !(state === 'ready' && lane > 0);
            cashBtn.textContent = lane > 0 && active ? `Cash out ${ctx.money(stake * penguinMult(diff, lane))}` : 'Cash out';
            diffSeg.lock(active);
            bet.lock(active);
        }

        function begin() {
            stake = bet.value;
            if (!ctx.wager(stake, 0.1)) return;
            lane = 0;
            barriers.clear();
            cars = cars.filter((c) => !c.killer);
            feathers = [];
            Object.assign(peng, { x: penguinX(0), fromX: penguinX(0), toX: penguinX(0), t: 1, squash: 0, flat: false });
            state = 'ready';
            refresh();
        }

        function step() {
            if (state !== 'ready') return;
            const target = lane + 1;
            const survives = ctx.rand() < DIFFICULTY[diff].survive;
            state = 'walk';
            peng.fromX = peng.x;
            peng.toX = penguinX(target);
            peng.t = 0;
            ctx.sfx.play('step');
            refresh();
            const penY = (ROAD_T + ROAD_B) / 2;
            if (survives) {
                // A barrier drops at the top of the lane; traffic stops behind it
                barriers.add(target);
                peng.onArrive = () => {
                    lane = target;
                    ctx.sfx.play('gem', { freq: 520 + lane * 40 });
                    if (lane >= LANES) {
                        state = 'won';
                        const ret = stake * penguinMult(diff, lane);
                        ctx.payout(ret, stake);
                        ctx.banner('MADE IT ACROSS!', ret, { mult: `${penguinMult(diff, lane).toFixed(2)}×`, big: true });
                    } else state = 'ready';
                    refresh();
                };
            } else {
                // Here comes the plow, timed to arrive just after the penguin does
                const speed = 900;
                cars.push({ lane: target, y: penY - speed * 0.55 - 60, speed, color: '#f6c544', len: 74, killer: true, plow: true });
                peng.onArrive = null;
                peng.killAt = penY;
                ctx.wait(250).then(() => ctx.sfx.play('honk'));
            }
        }

        function die() {
            state = 'dead';
            peng.flat = true;
            ctx.sfx.play('splat');
            for (let i = 0; i < 18; i++) feathers.push({ x: peng.x, y: (ROAD_T + ROAD_B) / 2, vx: (ctx.rand() - 0.5) * 260, vy: (ctx.rand() - 0.8) * 260, r: ctx.rand() * 6, life: 1.2 });
            ctx.payout(0, stake);
            ctx.banner('SPLAT!', -stake, { lose: true });
            refresh();
        }

        function cashOut() {
            if (state !== 'ready' || lane <= 0) return;
            const m = penguinMult(diff, lane);
            const ret = stake * m;
            ctx.payout(ret, stake);
            ctx.sfx.play('cashout');
            ctx.banner('CASHED OUT', ret, { mult: `${m.toFixed(2)}×`, big: m >= 10 });
            state = 'won';
            refresh();
        }

        // ---- Drawing ----
        function drawPenguin(x, y, t) {
            g.save();
            g.translate(x, y);
            if (peng.flat) {
                g.scale(1.6, 0.22);
            } else {
                const hop = state === 'walk' ? Math.sin(peng.t * Math.PI) : 0;
                g.translate(0, -hop * 22);
                g.rotate(Math.sin(t * 9) * (state === 'walk' ? 0.18 : 0.04));
            }
            // feet
            g.fillStyle = '#ff9a1f';
            g.beginPath(); g.ellipse(-9, 26, 9, 4, 0, 0, Math.PI * 2); g.ellipse(9, 26, 9, 4, 0, 0, Math.PI * 2); g.fill();
            // body
            g.fillStyle = '#1b1f2e';
            g.beginPath(); g.ellipse(0, 4, 21, 26, 0, 0, Math.PI * 2); g.fill();
            // flippers
            g.beginPath(); g.ellipse(-20, 6, 6, 16, 0.35, 0, Math.PI * 2); g.ellipse(20, 6, 6, 16, -0.35, 0, Math.PI * 2); g.fill();
            // belly
            g.fillStyle = '#f4f6fb';
            g.beginPath(); g.ellipse(0, 9, 14, 19, 0, 0, Math.PI * 2); g.fill();
            // head
            g.fillStyle = '#1b1f2e';
            g.beginPath(); g.arc(0, -20, 15, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#f4f6fb';
            g.beginPath(); g.ellipse(-6, -21, 6, 7, 0, 0, Math.PI * 2); g.ellipse(6, -21, 6, 7, 0, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#111';
            g.beginPath(); g.arc(-5, -21, 2.6, 0, Math.PI * 2); g.arc(7, -21, 2.6, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#ff9a1f';
            g.beginPath(); g.moveTo(-5, -15); g.lineTo(5, -15); g.lineTo(0, -8); g.closePath(); g.fill();
            // scarf
            g.fillStyle = '#ff4f6e';
            g.fillRect(-13, -9, 26, 5);
            g.fillRect(6, -6, 5, 12);
            g.restore();
        }

        function drawCar(c, x) {
            const w = LW * 0.5, l = c.len;
            g.save();
            g.translate(x, c.y);
            g.fillStyle = 'rgba(0,0,0,0.3)';
            g.fillRect(-w / 2 + 4, -l / 2 + 6, w, l);
            g.fillStyle = c.color;
            roundRect(-w / 2, -l / 2, w, l, 9); g.fill();
            if (c.plow) {
                g.fillStyle = '#9aa3b5';
                roundRect(-w / 2 - 8, l / 2 - 6, w + 16, 12, 4); g.fill();
                g.fillStyle = '#ff8a3d';
                g.fillRect(-6, -l / 2 + 10, 12, 6);
            }
            g.fillStyle = 'rgba(20,30,50,0.85)';
            roundRect(-w / 2 + 5, l * 0.08, w - 10, l * 0.22, 4); g.fill();
            roundRect(-w / 2 + 5, -l * 0.34, w - 10, l * 0.16, 4); g.fill();
            g.fillStyle = '#fff6c4';
            g.fillRect(-w / 2 + 3, l / 2 - 5, 7, 4); g.fillRect(w / 2 - 10, l / 2 - 5, 7, 4);
            g.restore();
        }

        function roundRect(x, y, w, h, r) {
            g.beginPath();
            g.moveTo(x + r, y);
            g.arcTo(x + w, y, x + w, y + h, r);
            g.arcTo(x + w, y + h, x, y + h, r);
            g.arcTo(x, y + h, x, y, r);
            g.arcTo(x, y, x + w, y, r);
            g.closePath();
        }

        let spawnT = 0;
        ctx.loop((dt, t) => {
            if (!W) resize();
            // Penguin
            if (state === 'walk') {
                peng.t = Math.min(1, peng.t + dt / 0.38);
                peng.x = peng.fromX + (peng.toX - peng.fromX) * peng.t;
                if (peng.t >= 1 && peng.onArrive) { const f = peng.onArrive; peng.onArrive = null; f(); }
            }
            cam += (Math.max(0, peng.x - W * 0.32) - cam) * Math.min(1, dt * 5);
            // Traffic: cars come down every lane ahead
            spawnT -= dt;
            if (spawnT <= 0) {
                spawnT = 0.18 + ctx.rand() * 0.25;
                const k = 1 + Math.floor(ctx.rand() * LANES);
                if (!(state === 'walk' && k === lane + 1)) {
                    cars.push({ lane: k, y: ROAD_T - 120, speed: 260 + ctx.rand() * 380, color: CAR_COLORS[Math.floor(ctx.rand() * CAR_COLORS.length)], len: 58 + ctx.rand() * 26 });
                }
            }
            const penY = (ROAD_T + ROAD_B) / 2;
            for (const c of cars) {
                let ny = c.y + c.speed * dt;
                // Barriers stop the traffic above the penguin's path
                if (!c.killer && barriers.has(c.lane)) {
                    const stopY = penY - 70 - c.len / 2;
                    const ahead = cars.filter((o) => o !== c && o.lane === c.lane && o.y > c.y && !o.killer).reduce((m, o) => Math.min(m, o.y - o.len / 2 - 8 - c.len / 2), Infinity);
                    if (c.y <= stopY + 1) ny = Math.min(ny, stopY, ahead);
                }
                // Don't drive through the penguin while it's crossing this lane safely
                if (!c.killer && state === 'walk' && c.lane === lane + 1 && c.y < penY && ny > penY - 90 - c.len / 2) ny = Math.max(c.y, penY - 90 - c.len / 2);
                c.y = ny;
                if (c.killer && !peng.flat && state === 'walk' && c.y + c.len / 2 >= penY - 20 && peng.t >= 0.9) die();
            }
            cars = cars.filter((c) => c.y < H + 200);

            // ---- Paint ----
            g.clearRect(0, 0, W, H);
            g.save();
            g.translate(-cam, 0);
            // Snow banks and road
            g.fillStyle = '#e8f1fb';
            g.fillRect(cam, 0, W, H);
            g.fillStyle = '#3a4258';
            g.fillRect(120, ROAD_T, LANES * LW, ROAD_B - ROAD_T);
            // Start pavement and finish igloo
            g.fillStyle = '#cfe2f5';
            g.fillRect(0, ROAD_T, 120, ROAD_B - ROAD_T);
            const fx = 120 + LANES * LW;
            g.fillStyle = '#cfe2f5';
            g.fillRect(fx, ROAD_T, 200, ROAD_B - ROAD_T);
            g.fillStyle = '#ffffff';
            g.beginPath(); g.arc(fx + 90, penY + 10, 50, Math.PI, 0); g.fill();
            g.fillStyle = '#3a4258';
            g.beginPath(); g.arc(fx + 90, penY + 10, 18, Math.PI, 0); g.fill();
            g.fillStyle = '#f6c544';
            g.font = '900 16px Segoe UI, sans-serif';
            g.textAlign = 'center';
            g.fillText('JACKPOT', fx + 90, penY - 52);
            // Lanes
            for (let k = 1; k <= LANES; k++) {
                const x0 = 120 + (k - 1) * LW;
                if (k > 1) {
                    g.strokeStyle = 'rgba(255,255,255,0.55)';
                    g.lineWidth = 3;
                    g.setLineDash([22, 18]);
                    g.beginPath(); g.moveTo(x0, ROAD_T); g.lineTo(x0, ROAD_B); g.stroke();
                    g.setLineDash([]);
                }
                // Multiplier coin in the middle of each lane
                const x = laneX(k);
                const passed = k <= lane;
                g.fillStyle = passed ? 'rgba(47,227,154,0.95)' : k === lane + 1 ? 'rgba(246,197,68,0.95)' : 'rgba(20,24,38,0.75)';
                g.beginPath(); g.arc(x, penY + 52, 26, 0, Math.PI * 2); g.fill();
                g.fillStyle = passed || k === lane + 1 ? '#0c0a12' : '#e8f1fb';
                g.font = '800 13px Segoe UI, sans-serif';
                g.fillText(`${penguinMult(diff, k).toFixed(2)}×`, x, penY + 57);
                if (barriers.has(k)) {
                    g.fillStyle = '#9fd7ff';
                    roundRect(x - LW * 0.36, penY - 68, LW * 0.72, 18, 5); g.fill();
                    g.fillStyle = '#ff4f6e';
                    for (let i = 0; i < 3; i++) g.fillRect(x - LW * 0.3 + i * LW * 0.24, penY - 66, LW * 0.12, 14);
                }
            }
            for (const c of cars) drawCar(c, laneX(c.lane));
            // Feathers
            for (const f of feathers) {
                f.life -= dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 300 * dt;
                g.fillStyle = `rgba(30,30,40,${Math.max(0, f.life)})`;
                g.beginPath(); g.ellipse(f.x, f.y, 5, 2.5, f.r + t * 3, 0, Math.PI * 2); g.fill();
            }
            feathers = feathers.filter((f) => f.life > 0);
            drawPenguin(peng.x || penguinX(0), penY, t);
            g.restore();
            // Current multiplier
            if (state !== 'idle') {
                g.fillStyle = 'rgba(12,10,18,0.8)';
                roundRect(W / 2 - 90, 6, 180, 30, 10); g.fill();
                g.fillStyle = state === 'dead' ? '#ff4f6e' : '#2fe39a';
                g.font = '900 17px Segoe UI, sans-serif';
                g.textAlign = 'center';
                g.fillText(state === 'dead' ? 'BUSTED' : `${penguinMult(diff, lane).toFixed(2)}× · ${ctx.money(stake * penguinMult(diff, lane))}`, W / 2, 27);
            }
        });

        Object.assign(peng, { x: penguinX(0), fromX: penguinX(0), toX: penguinX(0) });
        refresh();
        return {
            busy: () => state === 'ready' || state === 'walk',
            // Walking away cashes out the lanes already crossed (mid-step, the step is settled first)
            leave: () => {
                if (state === 'walk') {
                    if (peng.onArrive) { lane += 1; } else { ctx.payout(0, stake); state = 'dead'; return; }
                }
                if (lane >= 1) ctx.payout(stake * penguinMult(diff, lane), stake);
                else ctx.payout(stake, stake);
                state = 'won';
            },
            destroy: () => window.removeEventListener('resize', onResize)
        };
    }
};
