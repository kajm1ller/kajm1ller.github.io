/**
 * js/game/mermaid/mermaidAudio.js
 *
 * Procedural music, ambience and sound effects for Mermaid World (Web Audio, nothing to download).
 * Everything is heard "through water" (a low-pass filter), and the music changes with where you are:
 * a harp lullaby in town, a bouncy lounge at the mall, glassy bells over the reef, a slow drone in the
 * wreck, mystic bells in the temple, drips and wobble in the caves, a bass groove at the grotto...
 * The same engine plays the wedding music and the rhythm game's backing tracks.
 */

import { between } from './mermaidKit.js';

// Interval sets (semitones from the root)
const MAJ7 = [0, 4, 7, 11], MIN7 = [0, 3, 7, 10], DOM7 = [0, 4, 7, 10], SUS = [0, 5, 7, 12], MINOR = [0, 3, 7, 12], DIM = [0, 3, 6, 9];
const hz = (root, semi) => root * Math.pow(2, semi / 12);

/**
 * Each style: bpm, root (Hz), prog = [[semitone offset of the chord root, chord type], ...] one per bar,
 * layers: which parts play ('pad', 'arp', 'bass', 'kick', 'hat', 'snare', 'bell', 'drone', 'drip', 'steel', 'choir', 'siren')
 */
const STYLES = {
    town: { bpm: 76, root: 261.6, prog: [[0, MAJ7], [-3, MIN7], [-7, MAJ7], [-5, DOM7]], layers: ['pad', 'arp'], arpOct: 2, vol: 1 },
    mall: { bpm: 104, root: 293.7, prog: [[0, MAJ7], [5, MAJ7], [-3, MIN7], [-5, DOM7]], layers: ['pad', 'arp', 'bass', 'hat'], arpOct: 2, arpWave: 'triangle', vol: 0.9 },
    reef: { bpm: 70, root: 329.6, prog: [[0, MAJ7], [4, MIN7], [5, MAJ7], [7, SUS]], layers: ['pad', 'bell'], vol: 1 },
    kelp: { bpm: 60, root: 220, prog: [[0, MIN7], [-2, MAJ7], [-4, MAJ7], [-5, MIN7]], layers: ['pad', 'drone', 'bell'], vol: 0.95 },
    wreck: { bpm: 54, root: 196, prog: [[0, MINOR], [-4, MINOR], [-2, DIM], [-5, MINOR]], layers: ['drone', 'drip', 'bell'], vol: 0.9 },
    ruins: { bpm: 62, root: 233, prog: [[0, MIN7], [2, MIN7], [-2, MAJ7], [0, SUS]], layers: ['pad', 'bell', 'drone'], arpOct: 2, vol: 0.95 },
    cave: { bpm: 50, root: 174.6, prog: [[0, MINOR], [-1, DIM], [-3, MINOR], [-6, MINOR]], layers: ['drone', 'drip'], vol: 0.9 },
    grotto: { bpm: 112, root: 220, prog: [[0, MIN7], [-4, MAJ7], [-2, MAJ7], [-5, DOM7]], layers: ['bass', 'kick', 'hat', 'snare', 'arp'], arpOct: 2, arpWave: 'sawtooth', vol: 0.9 },
    deep: { bpm: 44, root: 110, prog: [[0, MINOR], [-2, DIM]], layers: ['drone'], vol: 0.8 },
    festival: { bpm: 118, root: 293.7, prog: [[0, MAJ7], [5, MAJ7], [-3, MIN7], [-5, DOM7]], layers: ['pad', 'arp', 'bass', 'kick', 'hat', 'steel'], arpOct: 2, arpWave: 'triangle', vol: 1 },
    // wedding and minigame styles
    whales: { bpm: 72, root: 261.6, prog: [[0, MAJ7], [-3, MIN7], [-7, MAJ7], [-5, DOM7]], layers: ['choir'], vol: 1 },
    dj: { bpm: 124, root: 261.6, prog: [[0, MAJ7], [-3, MIN7], [-7, MAJ7], [-5, DOM7]], layers: ['kick', 'hat', 'snare', 'bass'], vol: 1 },
    crabs: { bpm: 112, root: 261.6, prog: [[0, MAJ7], [-3, MIN7], [-7, MAJ7], [-5, DOM7]], layers: ['steel', 'bass'], vol: 1 },
    sirens: { bpm: 80, root: 261.6, prog: [[0, MAJ7], [-3, MIN7], [-7, MAJ7], [-5, DOM7]], layers: ['pad', 'siren', 'arp'], arpOct: 2, vol: 1 },
    silent: { bpm: 60, root: 220, prog: [[0, MAJ7]], layers: [], vol: 0 }
};

export class MermaidAudio {
    constructor(ctx) {
        this.ctx = ctx;
        this.out = ctx.createGain();
        this.out.gain.value = 0;
        this.out.connect(ctx.destination);
        // Music bus, heard through water
        this.musicGain = ctx.createGain();
        this.musicGain.gain.value = 0.55;
        this.musicGain.connect(this.out);
        this.lp = ctx.createBiquadFilter();
        this.lp.type = 'lowpass';
        this.lp.frequency.value = 2600;
        this.lp.connect(this.musicGain);
        // A little echo
        this.delay = ctx.createDelay(1.0);
        this.delay.delayTime.value = 0.32;
        const fb = ctx.createGain();
        fb.gain.value = 0.28;
        const wet = ctx.createGain();
        wet.gain.value = 0.22;
        this.lp.connect(this.delay);
        this.delay.connect(fb);
        fb.connect(this.delay);
        this.delay.connect(wet);
        wet.connect(this.musicGain);
        // SFX bus
        this.sfxGain = ctx.createGain();
        this.sfxGain.gain.value = 0.9;
        this.sfxGain.connect(this.out);
        // Noise bed for ambience and percussion
        const len = ctx.sampleRate * 3;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const ch = buf.getChannelData(0);
        let b = 0;
        for (let i = 0; i < len; i++) {
            b = 0.985 * b + 0.015 * (Math.random() * 2 - 1);
            ch[i] = b * 8;
        }
        this.noise = buf;
        const amb = ctx.createBufferSource();
        amb.buffer = buf;
        amb.loop = true;
        const af = ctx.createBiquadFilter();
        af.type = 'lowpass';
        af.frequency.value = 380;
        this.ambGain = ctx.createGain();
        this.ambGain.gain.value = 0.2;
        amb.connect(af);
        af.connect(this.ambGain);
        this.ambGain.connect(this.out);
        amb.start();
        this.amb = amb;
        this.ambFilter = af;
        this.next = ctx.currentTime + 0.3;
        this.beat = 0;
        this.styleName = 'town';
        this.cfg = STYLES.town;
        this.bubbleT = 1;
        this.callT = 25;
        this.muted = false;
        this.musicLevel = 1;
    }

    now() {
        return this.ctx.currentTime;
    }

    fadeTo(v, sec = 1.5) {
        this.out.gain.setTargetAtTime(v, this.ctx.currentTime, sec / 3);
    }

    setMusicLevel(v) {
        this.musicLevel = v;
        this.musicGain.gain.setTargetAtTime(0.55 * v, this.ctx.currentTime, 0.2);
    }

    /** Switch the music (and its mood). 'silent' stops it. */
    setStyle(name) {
        if (name === this.styleName || !STYLES[name]) return;
        this.styleName = name;
        this.cfg = STYLES[name];
        this.beat = 0;
        this.next = Math.max(this.next, this.ctx.currentTime + 0.25);
        // Tighter water filter in the depths, brighter in the shallows
        const f = { cave: 1300, deep: 800, wreck: 1800, ruins: 2200 }[name] || 2600;
        this.lp.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.5);
        this.ambFilter.frequency.setTargetAtTime(name === 'deep' ? 220 : name === 'cave' ? 280 : 380, this.ctx.currentTime, 0.5);
    }
    // audio.style = 'whales' works too
    set style(v) {
        this.setStyle(v);
    }
    get style() {
        return this.styleName;
    }

    // ---- Voices -------------------------------------------------------------------------------
    _note(t, f, dur, g, type = 'sine', dest = this.lp, attack = 0.02) {
        const c = this.ctx;
        const o = c.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f, t);
        const e = c.createGain();
        e.gain.setValueAtTime(0.0001, t);
        e.gain.linearRampToValueAtTime(g, t + attack);
        e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(e);
        e.connect(dest);
        o.start(t);
        o.stop(t + dur + 0.05);
        return o;
    }

    _noiseHit(t, dur, freq, g, type = 'highpass', dest = this.lp) {
        const c = this.ctx;
        const s = c.createBufferSource();
        s.buffer = this.noise;
        const f = c.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        const e = c.createGain();
        e.gain.setValueAtTime(g, t);
        e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(f);
        f.connect(e);
        e.connect(dest);
        s.start(t, Math.random() * 2);
        s.stop(t + dur + 0.05);
    }

    // ---- Effects ------------------------------------------------------------------------------
    bubble() {
        const t = this.ctx.currentTime;
        for (let i = 0; i < 4; i++) {
            const o = this._note(t + i * 0.06, 300 + Math.random() * 500, 0.08, 0.05, 'sine', this.sfxGain, 0.005);
            o.frequency.exponentialRampToValueAtTime(900 + Math.random() * 600, t + i * 0.06 + 0.08);
        }
    }
    chime() {
        const t = this.ctx.currentTime;
        [1046.5, 1318.5, 1568, 2093].forEach((f, i) => this._note(t + i * 0.09, f, 1.2, 0.08, 'sine', this.sfxGain, 0.005));
    }
    pickup(pitch = 0) {
        const t = this.ctx.currentTime;
        const f = 880 * Math.pow(2, pitch / 12);
        this._note(t, f, 0.25, 0.07, 'sine', this.sfxGain, 0.004);
        this._note(t + 0.07, f * 1.5, 0.35, 0.06, 'sine', this.sfxGain, 0.004);
    }
    ring(ok = true, pitch = 0) {
        const t = this.ctx.currentTime;
        const f = 660 * Math.pow(2, pitch / 12);
        if (ok) {
            this._note(t, f, 0.3, 0.09, 'triangle', this.sfxGain, 0.004);
            this._note(t + 0.08, f * 1.25, 0.4, 0.07, 'triangle', this.sfxGain, 0.004);
            this._note(t + 0.16, f * 1.5, 0.5, 0.06, 'triangle', this.sfxGain, 0.004);
        } else {
            const o = this._note(t, 220, 0.4, 0.08, 'sawtooth', this.sfxGain, 0.01);
            o.frequency.exponentialRampToValueAtTime(110, t + 0.35);
        }
    }
    success() {
        const t = this.ctx.currentTime;
        [523.3, 659.3, 784, 1046.5, 1318.5].forEach((f, i) => this._note(t + i * 0.11, f, 0.9, 0.08, 'triangle', this.sfxGain, 0.01));
    }
    fail() {
        const t = this.ctx.currentTime;
        [392, 349.2, 293.7].forEach((f, i) => this._note(t + i * 0.18, f, 0.5, 0.07, 'triangle', this.sfxGain, 0.01));
    }
    click() {
        this._note(this.ctx.currentTime, 1200, 0.06, 0.04, 'sine', this.sfxGain, 0.002);
    }
    shutter() {
        const t = this.ctx.currentTime;
        this._noiseHit(t, 0.05, 3000, 0.25, 'highpass', this.sfxGain);
        this._noiseHit(t + 0.09, 0.07, 1800, 0.2, 'bandpass', this.sfxGain);
    }
    dig() {
        this._noiseHit(this.ctx.currentTime, 0.18, 500, 0.3, 'lowpass', this.sfxGain);
    }
    coin() {
        const t = this.ctx.currentTime;
        this._note(t, 1568, 0.18, 0.06, 'square', this.sfxGain, 0.002);
        this._note(t + 0.06, 2093, 0.3, 0.06, 'square', this.sfxGain, 0.002);
    }
    sparkle() {
        const t = this.ctx.currentTime;
        for (let i = 0; i < 6; i++) this._note(t + i * 0.05, 1800 + Math.random() * 1600, 0.3, 0.03, 'sine', this.sfxGain, 0.003);
    }
    splash() {
        this._noiseHit(this.ctx.currentTime, 0.4, 900, 0.22, 'bandpass', this.sfxGain);
    }
    whaleCall(low = true) {
        const t = this.ctx.currentTime;
        const o = this._note(t, low ? 90 : 160, 4.5, 0.12, 'sine', this.sfxGain, 1.0);
        o.frequency.linearRampToValueAtTime(low ? 190 : 260, t + 1.8);
        o.frequency.linearRampToValueAtTime(low ? 80 : 140, t + 4.2);
    }
    /** A note for the rhythm game / instruments: lane 0-3, a pentatonic ladder. */
    laneNote(lane, perfect = true) {
        const t = this.ctx.currentTime;
        const f = [523.3, 587.3, 659.3, 784][lane] * (perfect ? 1 : 0.5);
        this._note(t, f, 0.35, 0.09, 'triangle', this.sfxGain, 0.004);
    }

    // ---- Music --------------------------------------------------------------------------------
    update(dt) {
        const c = this.ctx;
        const now = c.currentTime;
        this.bubbleT -= dt;
        if (this.bubbleT <= 0) {
            this.bubbleT = between(2, 6);
            this.bubble();
        }
        this.callT -= dt;
        if (this.callT <= 0) {
            this.callT = between(40, 90);
            if (this.styleName !== 'silent') this.whaleCall(Math.random() < 0.7);
        }
        const S = this.cfg;
        if (!S || !S.layers.length) {
            this.next = now + 0.5;
            return;
        }
        const spb = 60 / S.bpm;
        while (this.next < now + 0.5) {
            this._beat(this.next, this.beat, spb, S);
            this.next += spb;
            this.beat++;
        }
    }

    _beat(t, beat, spb, S) {
        const bar = Math.floor(beat / 4) % S.prog.length;
        const [off, type] = S.prog[bar];
        const R = hz(S.root, off);
        const chord = type.map((s) => hz(R, s));
        const L = S.layers;
        const v = (S.vol ?? 1);
        const b4 = beat % 4;
        if (L.includes('pad') && b4 === 0) {
            for (const f of chord) this._note(t, f / 2, spb * 4.2, 0.034 * v, 'sine', this.lp, 0.6);
        }
        if (L.includes('arp')) {
            const oct = S.arpOct || 2;
            const arp = [chord[0], chord[1], chord[2], chord[3], chord[2] * 2, chord[1] * 2, chord[2], chord[1]];
            this._note(t, arp[beat % 8] * oct, 1.3, 0.05 * v, S.arpWave || 'sine', this.lp, 0.005);
            this._note(t + spb / 2, arp[(beat + 4) % 8] * oct, 1.1, 0.034 * v, S.arpWave || 'sine', this.lp, 0.005);
        }
        if (L.includes('bell') && (b4 === 0 || b4 === 2)) {
            const f = chord[(beat * 3) % chord.length] * 2 * (Math.random() < 0.3 ? 2 : 1);
            this._note(t + (Math.random() < 0.5 ? 0 : spb / 2), f, 2.4, 0.04 * v, 'sine', this.lp, 0.005);
            this._note(t, f * 2.76, 1.0, 0.012 * v, 'sine', this.lp, 0.005);
        }
        if (L.includes('drone') && b4 === 0 && bar % 2 === 0) {
            const o = this._note(t, R / 2, spb * 8, 0.09 * v, 'sine', this.lp, 1.6);
            o.frequency.linearRampToValueAtTime(R / 2 * 1.02, t + spb * 6);
            this._note(t, R / 4, spb * 8, 0.07 * v, 'triangle', this.lp, 2);
        }
        if (L.includes('drip') && Math.random() < 0.35) {
            const f = chord[Math.floor(Math.random() * chord.length)] * 4;
            const o = this._note(t + Math.random() * spb, f, 0.5, 0.035 * v, 'sine', this.lp, 0.003);
            o.frequency.exponentialRampToValueAtTime(f * 0.6, t + spb + 0.4);
        }
        if (L.includes('bass')) {
            const pat = [1, 0, 0, 1, 0, 1, 0, 0];
            if (pat[beat % 8]) this._note(t, R / 2, spb * 0.9, 0.14 * v, 'triangle', this.lp, 0.01);
            if (L.includes('kick') === false && b4 === 2) this._note(t + spb / 2, R / 2 * 1.5, spb * 0.4, 0.08 * v, 'triangle', this.lp, 0.01);
        }
        if (L.includes('kick')) {
            const k = this._note(t, 120, 0.25, 0.4 * v, 'sine', this.lp, 0.003);
            k.frequency.exponentialRampToValueAtTime(45, t + 0.15);
        }
        if (L.includes('hat')) this._noiseHit(t + spb / 2, 0.05, 7000, 0.1 * v);
        if (L.includes('snare') && b4 % 2 === 1) this._noiseHit(t, 0.12, 2500, 0.1 * v, 'bandpass');
        if (L.includes('steel')) {
            const pent = [chord[0], chord[1], chord[2], chord[0] * 2, chord[1] * 2];
            const pattern = [1, 0, 1, 1, 0, 1, 0, 1];
            for (let s = 0; s < 2; s++) {
                if (pattern[(beat * 2 + s) % 8]) {
                    const f = pent[(beat * 3 + s) % 5] * 2;
                    this._note(t + s * spb / 2, f, 0.5, 0.07 * v, 'sine', this.lp, 0.002);
                    this._note(t + s * spb / 2, f * 2.01, 0.25, 0.025 * v, 'sine', this.lp, 0.002);
                }
            }
            this._note(t, R / 2, spb * 0.8, 0.1 * v, 'triangle', this.lp, 0.01);
        }
        if (L.includes('choir')) {
            if (beat % 8 === 0) {
                const o = this._note(t, 110, spb * 7, 0.12, 'sine', this.lp, 1.2);
                o.frequency.linearRampToValueAtTime(180, t + spb * 3);
                o.frequency.linearRampToValueAtTime(95, t + spb * 7);
            }
            if (b4 === 2) for (const f of chord) this._note(t, f / 2, spb * 4, 0.025, 'sine', this.lp, 0.8);
        }
        if (L.includes('siren') && beat % 2 === 0) {
            this._note(t, chord[2] * 2, spb * 1.8, 0.04, 'triangle', this.lp, 0.2);
            if (beat % 4 === 0) this._note(t, chord[1] * 2, spb * 3, 0.035, 'triangle', this.lp, 0.3);
        }
    }

    stop() {
        const t = this.ctx.currentTime;
        this.out.gain.setTargetAtTime(0, t, 0.3);
        setTimeout(() => {
            try {
                this.amb.stop();
                this.out.disconnect();
            } catch (e) { /* already stopped */ }
        }, 1500);
    }
}

export const MUSIC_STYLES = Object.keys(STYLES);
