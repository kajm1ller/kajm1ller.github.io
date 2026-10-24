/**
 * js/game/engineAudio.js
 *
 * Synthesized engine, road and wind sound for the car the player is in (Web Audio, no samples).
 *
 * Each car model names an engine voice (carModels.js engine.sound). The voice is built from
 * oscillators at the firing frequency (rpm / 60 * cylinders / 2) and its harmonics, an amplitude
 * "lope" at a fraction of it (the uneven burble of a cross-plane V8), a soft-clipping waveshaper
 * for grit and a resonant low-pass that opens with revs and throttle. On top of that: intake roar,
 * turbo spool and blow-off, supercharger whine, exhaust pops on lift-off, a dip at each gear
 * change, tyre roar and wind that grow with speed, a starter-motor crank, and a cabin filter that
 * muffles everything from the driver's seat.
 */

/**
 * Engine voices.
 * harm: gains of the fundamental, half-order (sub), 2nd and 3rd harmonic; wave: fundamental
 * waveform; lope / lopeRatio: depth and frequency (x firing freq) of the amplitude lope; drive:
 * waveshaper grit 0..1; cutoff / cutoffK / q: body low-pass base, Hz per Hz of firing frequency
 * and resonance; intake: intake roar level; turbo / whine / pops / rasp: extras (0 = none).
 */
export const ENGINE_VOICES = Object.freeze({
    i4: { harm: [1, 0.12, 0.45, 0.18], wave: 'sawtooth', lope: 0.05, lopeRatio: 0.5, drive: 0.3, cutoff: 240, cutoffK: 4.5, q: 1.6, intake: 0.07, volume: 0.17, pops: 0, turbo: 0, whine: 0, rasp: 0.04 },
    i4soft: { harm: [1, 0.1, 0.3, 0.08], wave: 'sawtooth', lope: 0.03, lopeRatio: 0.5, drive: 0.15, cutoff: 200, cutoffK: 3.0, q: 1.0, intake: 0.04, volume: 0.14, pops: 0, turbo: 0, whine: 0, rasp: 0 },
    i3: { harm: [1, 0.35, 0.3, 0.2], wave: 'sawtooth', lope: 0.22, lopeRatio: 0.333, drive: 0.35, cutoff: 220, cutoffK: 4.0, q: 2.2, intake: 0.06, volume: 0.16, pops: 0, turbo: 0, whine: 0, rasp: 0.08 },
    i4van: { harm: [1, 0.1, 0.25, 0.05], wave: 'triangle', lope: 0.04, lopeRatio: 0.5, drive: 0.2, cutoff: 170, cutoffK: 2.4, q: 0.9, intake: 0.03, volume: 0.15, pops: 0, turbo: 0, whine: 0, rasp: 0 },
    turbo6: { harm: [1, 0.08, 0.55, 0.3], wave: 'sawtooth', lope: 0.04, lopeRatio: 0.5, drive: 0.45, cutoff: 320, cutoffK: 5.5, q: 2.6, intake: 0.09, volume: 0.17, pops: 0.9, turbo: 1, whine: 0, rasp: 0.12 },
    v6: { harm: [1, 0.3, 0.3, 0.1], wave: 'sawtooth', lope: 0.12, lopeRatio: 0.5, drive: 0.3, cutoff: 200, cutoffK: 3.2, q: 1.3, intake: 0.05, volume: 0.16, pops: 0, turbo: 0, whine: 0, rasp: 0.03 },
    v8muscle: { harm: [1, 0.7, 0.25, 0.08], wave: 'sawtooth', lope: 0.55, lopeRatio: 0.25, drive: 0.7, cutoff: 150, cutoffK: 2.6, q: 2.0, intake: 0.08, volume: 0.2, pops: 1, turbo: 0, whine: 1, rasp: 0.1 },
    v8truck: { harm: [1, 0.6, 0.2, 0.06], wave: 'sawtooth', lope: 0.4, lopeRatio: 0.25, drive: 0.55, cutoff: 130, cutoffK: 2.0, q: 1.5, intake: 0.06, volume: 0.19, pops: 0.3, turbo: 0, whine: 0, rasp: 0.06 },
    v8cruiser: { harm: [1, 0.5, 0.25, 0.08], wave: 'sawtooth', lope: 0.3, lopeRatio: 0.25, drive: 0.45, cutoff: 160, cutoffK: 2.8, q: 1.6, intake: 0.07, volume: 0.18, pops: 0.2, turbo: 0, whine: 0, rasp: 0.05 },
    prop: { harm: [1, 0.25, 0.35, 0.15], wave: 'sawtooth', lope: 0.18, lopeRatio: 0.5, drive: 0.35, cutoff: 260, cutoffK: 2.0, q: 1.0, intake: 0.08, volume: 0.17, pops: 0, turbo: 0, whine: 0, rasp: 0.05 }
});

function shaperCurve(drive) {
    const k = 1 + drive * 9;
    const n = 1024;
    const c = new Float32Array(n);
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        c[i] = Math.tanh(k * x) / norm;
    }
    return c;
}

export class EngineSound {
    /**
     * @param {AudioContext} ctx
     * @param {AudioNode} [destination=ctx.destination]
     */
    constructor(ctx, destination = null) {
        this.ctx = ctx;
        this.voiceId = null;
        this.voice = ENGINE_VOICES.i4;
        this.spool = 0;
        this._prevThrottle = 0;
        this._prevShift = 0;
        this._popCooldown = 0;
        this._startUntil = 0;
        this.lastFireHz = 0;
        const now = ctx.currentTime;

        // Output: everything passes the cabin filter (muffled from the driver's seat)
        this.output = ctx.createGain();
        this.output.gain.value = 1;
        this.cabin = ctx.createBiquadFilter();
        this.cabin.type = 'lowpass';
        this.cabin.frequency.value = 9000;
        this.cabin.connect(this.output);
        this.output.connect(destination || ctx.destination);

        // Engine: oscillators -> lope -> waveshaper -> body low-pass -> engine gain
        this.engineGain = ctx.createGain();
        this.engineGain.gain.value = 0;
        this.engineGain.connect(this.cabin);
        this.body = ctx.createBiquadFilter();
        this.body.type = 'lowpass';
        this.body.connect(this.engineGain);
        this.shaper = ctx.createWaveShaper();
        this.shaper.oversample = '2x';
        this.shaper.connect(this.body);
        this.pre = ctx.createGain();          // keeps the sum of the oscillators in the shaper's range
        this.pre.gain.value = 0.45;
        this.pre.connect(this.shaper);
        this.lope = ctx.createGain();
        this.lope.gain.value = 1;
        this.lope.connect(this.pre);

        this.oscs = [];
        this.oscGains = [];
        const mults = [1, 0.5, 2, 3];
        for (let i = 0; i < 4; i++) {
            const o = ctx.createOscillator();
            o.type = i === 1 ? 'square' : (i === 3 ? 'sine' : 'sawtooth');
            o.frequency.value = 30 * mults[i];
            const g = ctx.createGain();
            g.gain.value = 0;
            o.connect(g).connect(this.lope);
            o.start(now);
            this.oscs.push(o);
            this.oscGains.push(g);
        }
        this.mults = mults;
        // Amplitude lope: an LFO on the lope gain
        this.lfo = ctx.createOscillator();
        this.lfo.type = 'sine';
        this.lfo.frequency.value = 8;
        this.lfoDepth = ctx.createGain();
        this.lfoDepth.gain.value = 0;
        this.lfo.connect(this.lfoDepth).connect(this.lope.gain);
        this.lfo.start(now);

        // Shared noise: intake roar, exhaust rasp, tyre roar, wind
        const len = ctx.sampleRate * 2;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuffer = buf;
        const noise = ctx.createBufferSource();
        noise.buffer = buf;
        noise.loop = true;
        noise.start(now);
        this.noise = noise;
        const band = (type, f, q, gain, dest) => {
            const flt = ctx.createBiquadFilter();
            flt.type = type;
            flt.frequency.value = f;
            flt.Q.value = q;
            const g = ctx.createGain();
            g.gain.value = gain;
            noise.connect(flt).connect(g).connect(dest);
            return { filter: flt, gain: g };
        };
        this.intake = band('bandpass', 400, 1.2, 0, this.cabin);
        // Rasp: noise gated at the firing frequency (the crackle under a loud exhaust)
        this.raspGate = ctx.createGain();
        this.raspGate.gain.value = 0;
        this.raspGate.connect(this.engineGain);
        this.rasp = band('bandpass', 1800, 0.8, 0, this.raspGate);
        this.raspGate.gain.value = 0.5;
        this.raspLfoDepth = ctx.createGain();
        this.raspLfoDepth.gain.value = 0.5;
        this.oscs[0].connect(this.raspLfoDepth).connect(this.raspGate.gain);
        this.road = band('lowpass', 320, 0.7, 0, this.output);
        this.wind = band('bandpass', 850, 0.4, 0, this.output);

        // Turbo whistle and supercharger whine
        this.turboOsc = ctx.createOscillator();
        this.turboOsc.type = 'sine';
        this.turboOsc.frequency.value = 2000;
        this.turboGain = ctx.createGain();
        this.turboGain.gain.value = 0;
        this.turboOsc.connect(this.turboGain).connect(this.cabin);
        this.turboOsc.start(now);
        this.whineOsc = ctx.createOscillator();
        this.whineOsc.type = 'triangle';
        this.whineOsc.frequency.value = 800;
        this.whineGain = ctx.createGain();
        this.whineGain.gain.value = 0;
        this.whineOsc.connect(this.whineGain).connect(this.cabin);
        this.whineOsc.start(now);

        this.setVoice('i4');
    }

    setVoice(id) {
        if (id === this.voiceId) return;
        const v = ENGINE_VOICES[id] || ENGINE_VOICES.i4;
        this.voiceId = id;
        this.voice = v;
        this.oscs[0].type = v.wave;
        this.shaper.curve = shaperCurve(v.drive);
        this.body.Q.value = v.q;
        const t = this.ctx.currentTime;
        for (let i = 0; i < 4; i++) this.oscGains[i].gain.setTargetAtTime(v.harm[i], t, 0.05);
        this.spool = 0;
    }

    /**
     * @param {Object} s { running, rpm, idle, redline, cylinders, throttle (0..1), speed (m/s),
     *   boost (drift boost active), inside (driver's seat), shiftCount, voice }
     */
    update(s, dt = 1 / 60) {
        const ctx = this.ctx;
        const t = ctx.currentTime;
        if (s.voice) this.setVoice(s.voice);
        const v = this.voice;
        const rpm = Math.max(0, s.rpm || 0);
        const idle = s.idle || 800, red = s.redline || 7000;
        const rpmN = Math.max(0, Math.min(1, (rpm - idle) / Math.max(1, red - idle)));
        const throttle = Math.max(0, Math.min(1, s.throttle || 0));
        let fire = (rpm / 60) * ((s.cylinders || 4) / 2);
        // Just after the starter catches the engine flares above idle
        if (t < this._startUntil) fire *= 1 + 0.9 * ((this._startUntil - t) / 0.7);
        this.lastFireHz = fire;
        const alive = s.running !== false && rpm > 150;

        const k = 0.03;
        for (let i = 0; i < 4; i++) this.oscs[i].frequency.setTargetAtTime(Math.max(5, fire * this.mults[i]), t, k);
        this.lfo.frequency.setTargetAtTime(Math.max(1, fire * v.lopeRatio), t, k);
        const lope = v.lope * (1 - 0.65 * rpmN);
        this.lfoDepth.gain.setTargetAtTime(lope, t, 0.08);
        this.lope.gain.setTargetAtTime(1 - lope * 0.5, t, 0.08);
        this.body.frequency.setTargetAtTime(Math.min(9000, v.cutoff + fire * v.cutoffK * (0.6 + 0.6 * throttle)), t, 0.04);

        // Gear change: a short dip in the engine note (and a turbo blow-off)
        const shifted = s.shiftCount !== undefined && s.shiftCount !== this._prevShift;
        this._prevShift = s.shiftCount;
        let level = alive ? v.volume * (0.55 + 0.45 * throttle) * (0.75 + 0.35 * rpmN) : 0;
        if (s.boost) level *= 1.35;
        if (shifted && alive) {
            this.engineGain.gain.setTargetAtTime(level * 0.35, t, 0.015);
            this.engineGain.gain.setTargetAtTime(level, t + 0.12, 0.05);
            if (v.turbo && this.spool > 0.4) this._blowOff(0.6 * this.spool);
        } else {
            this.engineGain.gain.setTargetAtTime(level, t, 0.04);
        }

        this.intake.filter.frequency.setTargetAtTime(300 + fire * 3, t, 0.05);
        this.intake.gain.gain.setTargetAtTime(alive ? v.intake * throttle * (0.3 + rpmN) : 0, t, 0.05);
        this.rasp.gain.gain.setTargetAtTime(alive ? v.rasp * (0.3 + throttle) * (0.4 + rpmN) : 0, t, 0.05);

        // Turbo spools with load and revs; lifting off at boost vents it
        const spoolTarget = alive && v.turbo ? throttle * Math.min(1, 0.2 + rpmN * 1.2) : 0;
        this.spool += (spoolTarget - this.spool) * Math.min(1, dt * (spoolTarget > this.spool ? 1.8 : 6));
        this.turboOsc.frequency.setTargetAtTime(1800 + this.spool * 5200, t, 0.05);
        this.turboGain.gain.setTargetAtTime(v.turbo * this.spool * this.spool * 0.035, t, 0.05);
        this.whineOsc.frequency.setTargetAtTime(200 + rpm * 0.42, t, 0.04);
        this.whineGain.gain.setTargetAtTime(alive ? v.whine * (0.15 + rpmN) * (0.4 + throttle) * 0.03 : 0, t, 0.05);

        // Lift-off: turbo blow-off and exhaust pops from high revs
        this._popCooldown = Math.max(0, this._popCooldown - dt);
        if (alive && this._prevThrottle > 0.6 && throttle < 0.15) {
            if (v.turbo && this.spool > 0.35) this._blowOff(this.spool);
            if (v.pops && rpmN > 0.45 && this._popCooldown <= 0) {
                this._pops(Math.round(2 + Math.random() * 4 * v.pops), v.pops);
                this._popCooldown = 0.8;
            }
        }
        this._prevThrottle = throttle;

        // Tyre roar and wind
        const spd = Math.abs(s.speed || 0);
        this.road.gain.gain.setTargetAtTime(Math.min(0.11, spd * 0.0038), t, 0.1);
        this.road.filter.frequency.setTargetAtTime(220 + spd * 9, t, 0.1);
        this.wind.gain.gain.setTargetAtTime(Math.min(0.09, spd * spd * 0.00009), t, 0.1);

        // From the driver's seat the cabin muffles the outside world
        this.cabin.frequency.setTargetAtTime(s.inside ? 2600 : 9000, t, 0.15);
    }

    /** Silences everything (player out of the car). */
    mute() {
        const t = this.ctx.currentTime;
        this.engineGain.gain.setTargetAtTime(0, t, 0.05);
        for (const n of [this.intake.gain, this.rasp.gain, this.road.gain, this.wind.gain, this.turboGain, this.whineGain]) n.gain.setTargetAtTime(0, t, 0.05);
        this.spool = 0;
        this._prevThrottle = 0;
    }

    /** Starter motor cranking, then the engine catches with a flare of revs. */
    playStart(voiceId) {
        if (voiceId) this.setVoice(voiceId);
        const ctx = this.ctx;
        const t0 = ctx.currentTime + 0.01;
        const crank = 0.55 + Math.random() * 0.25;
        try {
            const src = ctx.createBufferSource();
            src.buffer = this.noiseBuffer;
            const bp = ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = 700;
            bp.Q.value = 1.4;
            const g = ctx.createGain();
            g.gain.value = 0;
            // Chug-chug: gain pulses at ~11 Hz while the starter turns
            const pulses = Math.floor(crank * 11);
            for (let i = 0; i < pulses; i++) {
                const tt = t0 + i / 11;
                g.gain.setValueAtTime(0.02, tt);
                g.gain.linearRampToValueAtTime(0.16, tt + 0.03);
                g.gain.linearRampToValueAtTime(0.03, tt + 0.08);
            }
            g.gain.linearRampToValueAtTime(0, t0 + crank + 0.05);
            src.connect(bp).connect(g).connect(this.cabin);
            src.start(t0);
            src.stop(t0 + crank + 0.1);
            const whirr = ctx.createOscillator();
            whirr.type = 'sawtooth';
            whirr.frequency.setValueAtTime(140, t0);
            whirr.frequency.linearRampToValueAtTime(190, t0 + crank);
            const wg = ctx.createGain();
            wg.gain.setValueAtTime(0.035, t0);
            wg.gain.linearRampToValueAtTime(0, t0 + crank);
            whirr.connect(wg).connect(this.cabin);
            whirr.start(t0);
            whirr.stop(t0 + crank + 0.05);
        } catch (e) {
            // Audio is optional
        }
        this._startUntil = t0 + crank + 0.7;
        return crank;
    }

    _blowOff(amount) {
        const ctx = this.ctx;
        const t0 = ctx.currentTime;
        try {
            const src = ctx.createBufferSource();
            src.buffer = this.noiseBuffer;
            const hp = ctx.createBiquadFilter();
            hp.type = 'bandpass';
            hp.frequency.setValueAtTime(3200, t0);
            hp.frequency.exponentialRampToValueAtTime(1400, t0 + 0.35);
            hp.Q.value = 0.9;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(0.09 * amount + 0.001, t0 + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
            src.connect(hp).connect(g).connect(this.cabin);
            src.start(t0, Math.random());
            src.stop(t0 + 0.45);
        } catch (e) {
            // Audio is optional
        }
        this.spool *= 0.3;
    }

    _pops(count, strength) {
        const ctx = this.ctx;
        let t = ctx.currentTime + 0.05;
        try {
            for (let i = 0; i < count; i++) {
                t += 0.05 + Math.random() * 0.14;
                const src = ctx.createBufferSource();
                src.buffer = this.noiseBuffer;
                const bp = ctx.createBiquadFilter();
                bp.type = 'bandpass';
                bp.frequency.value = 500 + Math.random() * 700;
                bp.Q.value = 0.8;
                const g = ctx.createGain();
                const a = (0.12 + Math.random() * 0.18) * strength;
                g.gain.setValueAtTime(0.0001, t);
                g.gain.exponentialRampToValueAtTime(a, t + 0.004);
                g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06 + Math.random() * 0.05);
                src.connect(bp).connect(g).connect(this.cabin);
                src.start(t, Math.random() * 1.5);
                src.stop(t + 0.15);
                const thump = ctx.createOscillator();
                thump.type = 'sine';
                thump.frequency.setValueAtTime(110, t);
                thump.frequency.exponentialRampToValueAtTime(45, t + 0.06);
                const tg = ctx.createGain();
                tg.gain.setValueAtTime(a * 0.8, t);
                tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
                thump.connect(tg).connect(this.cabin);
                thump.start(t);
                thump.stop(t + 0.1);
            }
        } catch (e) {
            // Audio is optional
        }
    }
}
