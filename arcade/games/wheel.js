/**
 * Wheel: thirty segments, spin, win what the pointer lands on. Low risk pays small and often;
 * high risk is one 29.7× segment and twenty-nine blanks. Every wheel pays back 99%.
 */

export const WHEELS = {
    low: [1.5, 1.2, 1.2, 1.2, 0, 1.2, 1.2, 1.2, 1.2, 0, 1.5, 1.2, 1.2, 1.2, 0, 1.2, 1.2, 1.2, 1.2, 0, 1.5, 1.2, 1.2, 1.2, 0, 1.2, 1.2, 1.2, 1.2, 0],
    medium: [0, 1.5, 0, 2, 0, 1.5, 0, 2, 0, 3, 0, 1.5, 0, 2, 0, 1.7, 0, 2, 0, 1.5, 0, 2, 0, 4, 0, 1.5, 0, 2, 0, 1.5],
    high: [29.7, ...new Array(29).fill(0)]
};

const COLOR = { 0: '#3a3550', 1.2: '#c9d1e6', 1.5: '#2fe39a', 1.7: '#f6c544', 2: '#4fa3ff', 3: '#c86bff', 4: '#ff8a3d', 29.7: '#ff3d5e' };

export default {
    id: 'wheel', name: 'Wheel', cat: 'Originals', icon: '🎯', tint: ['#f7971e', '#7a2a00'],
    blurb: 'Spin the wheel. Choose how risky the slices are.',
    mount(stage, ctx) {
        const { el } = ctx;
        let risk = 'medium', spinning = false;
        const bet = ctx.betPanel({ initial: 10, min: 0.1 });
        const riskSeg = ctx.segmented({ low: 'Low', medium: 'Medium', high: 'High' }, risk, (v) => { risk = v; draw(); legend(); });
        const spinBtn = ctx.button('SPIN', 'go big', () => spin());
        const leg = el('div');
        leg.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
        const info = el('div', 'cz-info');
        info.innerHTML = 'Whatever slice stops under the pointer is your multiplier. Every wheel pays back <b>99%</b> on average; risk changes how lumpy it is.';
        ctx.side.append(bet, ctx.label('Risk'), riskSeg, spinBtn, ctx.label('Slices'), leg, info);

        const canvas = el('canvas');
        canvas.style.cssText = 'width:100%;height:100%;display:block;flex:1;min-height:320px;background:radial-gradient(ellipse at 50% 40%, #3b2410, #120a04 70%)';
        stage.append(canvas);
        const g = canvas.getContext('2d');
        let W = 0, H = 0, angle = 0, result = null;
        const resize = () => {
            const r = canvas.getBoundingClientRect();
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            canvas.width = Math.max(1, r.width * dpr); canvas.height = Math.max(1, r.height * dpr);
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            W = r.width; H = r.height;
            draw();
        };
        window.addEventListener('resize', resize);

        function legend() {
            leg.textContent = '';
            const counts = new Map();
            for (const m of WHEELS[risk]) counts.set(m, (counts.get(m) || 0) + 1);
            for (const [m, n] of [...counts].sort((a, b) => a[0] - b[0])) {
                const d = el('div', 'cz-pill', `${m.toFixed(2)}× · ${n}/30`);
                d.style.background = COLOR[m];
                d.style.color = m === 0 ? '#fff' : '#111';
                leg.append(d);
            }
        }

        function draw() {
            if (!W) return;
            const segs = WHEELS[risk];
            const R = Math.min(W, H) * 0.42, cx = W / 2, cy = H / 2 + 10;
            const step = (Math.PI * 2) / segs.length;
            g.clearRect(0, 0, W, H);
            g.save();
            g.translate(cx, cy);
            g.fillStyle = '#1a1a24';
            g.beginPath(); g.arc(0, 0, R + 12, 0, Math.PI * 2); g.fill();
            g.rotate(angle);
            segs.forEach((m, i) => {
                const a0 = i * step - Math.PI / 2 - step / 2;
                g.fillStyle = COLOR[m];
                g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R, a0, a0 + step); g.closePath(); g.fill();
                g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2; g.stroke();
            });
            g.fillStyle = '#1a1a24';
            g.beginPath(); g.arc(0, 0, R * 0.62, 0, Math.PI * 2); g.fill();
            g.restore();
            // Lights around the rim
            for (let i = 0; i < 30; i++) {
                const a = (i / 30) * Math.PI * 2;
                g.fillStyle = (Math.floor(performance.now() / 300) + i) % 2 ? '#ffe9a3' : '#8a6a20';
                g.beginPath(); g.arc(cx + Math.cos(a) * (R + 6), cy + Math.sin(a) * (R + 6), 3, 0, Math.PI * 2); g.fill();
            }
            // Pointer
            g.fillStyle = '#fff';
            g.beginPath(); g.moveTo(cx, cy - R + 18); g.lineTo(cx - 14, cy - R - 16); g.lineTo(cx + 14, cy - R - 16); g.closePath(); g.fill();
            // Centre readout
            g.fillStyle = result === null ? '#fff' : result > 0 ? '#2fe39a' : '#ff4f6e';
            g.font = `900 ${Math.round(R * 0.26)}px Segoe UI, sans-serif`;
            g.textAlign = 'center';
            g.fillText(result === null ? 'SPIN' : `${result.toFixed(2)}×`, cx, cy + R * 0.09);
        }

        async function spin() {
            if (spinning) return;
            const stake = bet.value;
            if (!ctx.wager(stake, 0.1)) return;
            spinning = true;
            spinBtn.disabled = true;
            riskSeg.lock(true);
            result = null;
            ctx.emit('spin');
            const segs = WHEELS[risk];
            const idx = Math.floor(ctx.rand() * segs.length);
            const step = (Math.PI * 2) / segs.length;
            const a0 = angle;
            // Segment idx is at the top when angle = -idx * step (mod 2pi); a little jitter inside it
            const base = -idx * step + (ctx.rand() - 0.5) * step * 0.7;
            let a1 = base;
            while (a1 < a0 + Math.PI * 2 * 4) a1 += Math.PI * 2;
            const dur = 4.2;
            let lastSeg = -1;
            await new Promise((res) => ctx.loop((dt, t) => {
                const k = Math.min(1, t / dur);
                angle = a0 + (a1 - a0) * (1 - (1 - k) ** 3);
                const seg = Math.floor(((-angle / step + 0.5) % segs.length + segs.length) % segs.length);
                if (seg !== lastSeg) { lastSeg = seg; ctx.sfx.play('tick', { freq: 2000 }); }
                draw();
                if (k >= 1) { res(); return false; }
            }));
            angle %= Math.PI * 2;
            const m = segs[idx];
            result = m;
            draw();
            ctx.payout(stake * m, stake);
            if (m > 0) ctx.banner(`${m.toFixed(2)}×`, stake * m, { big: m >= 10, lose: m < 1 });
            else { ctx.sfx.play('lose'); }
            spinning = false;
            spinBtn.disabled = false;
            riskSeg.lock(false);
        }

        // Idle shimmer of the rim lights
        ctx.loop(() => { if (!spinning) draw(); });
        legend();
        requestAnimationFrame(resize);
        return { busy: () => spinning, destroy: () => window.removeEventListener('resize', resize) };
    }
};
