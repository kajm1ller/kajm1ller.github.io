/**
 * arcade/sfx.js
 *
 * Arcade sounds, synthesized with WebAudio (no files): chips, cards, reel ticks, wins, losses,
 * explosions. The context is created on the first sound (always after a click in the arcade, so
 * the browser lets it play).
 */

export class ArcadeSfx {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.muted = false;
        this._noise = null;
    }

    _ensure() {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
            return this.ctx;
        }
        const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (!AC) return null;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        // One second of white noise for swishes and bangs
        const len = this.ctx.sampleRate;
        this._noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this._noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        return this.ctx;
    }

    _tone(freq, t0, dur, { type = 'sine', vol = 0.3, slide = 0, attack = 0.005 } = {}) {
        const c = this.ctx;
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t0);
        if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + dur);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g).connect(this.master);
        o.start(t0);
        o.stop(t0 + dur + 0.05);
    }

    _noiseBurst(t0, dur, { vol = 0.3, freq = 3000, q = 1, type = 'bandpass', sweep = 0 } = {}) {
        const c = this.ctx;
        const src = c.createBufferSource();
        src.buffer = this._noise;
        const f = c.createBiquadFilter();
        f.type = type;
        f.frequency.setValueAtTime(freq, t0);
        if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t0 + dur);
        f.Q.value = q;
        const g = c.createGain();
        g.gain.setValueAtTime(vol, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(f).connect(g).connect(this.master);
        src.start(t0, Math.random() * 0.5);
        src.stop(t0 + dur + 0.05);
    }

    play(name, opts = {}) {
        if (this.muted || !this._ensure()) return;
        const t = this.ctx.currentTime + 0.01;
        switch (name) {
            case 'click':
                this._tone(1800, t, 0.04, { type: 'square', vol: 0.06 });
                break;
            case 'chip':
                this._tone(3200 + Math.random() * 400, t, 0.06, { type: 'triangle', vol: 0.12 });
                this._tone(4700, t + 0.025, 0.05, { type: 'triangle', vol: 0.08 });
                this._noiseBurst(t, 0.05, { vol: 0.12, freq: 6000, q: 2 });
                break;
            case 'card':
                this._noiseBurst(t, 0.09, { vol: 0.25, freq: 2500, q: 0.8, sweep: 2 });
                break;
            case 'flip':
                this._noiseBurst(t, 0.06, { vol: 0.2, freq: 4000, q: 1.2 });
                this._tone(700, t, 0.05, { type: 'triangle', vol: 0.05 });
                break;
            case 'tick':
                this._tone(opts.freq || 2400, t, 0.025, { type: 'square', vol: 0.05 });
                break;
            case 'reel':
                this._tone(140, t, 0.12, { type: 'sine', vol: 0.3, slide: 0.6 });
                this._noiseBurst(t, 0.06, { vol: 0.15, freq: 900 });
                break;
            case 'gem': {
                const f = opts.freq || 880;
                this._tone(f, t, 0.25, { type: 'sine', vol: 0.2 });
                this._tone(f * 1.5, t + 0.05, 0.3, { type: 'sine', vol: 0.12 });
                break;
            }
            case 'step':
                this._tone(320, t, 0.07, { type: 'triangle', vol: 0.12, slide: 0.7 });
                break;
            case 'win': {
                const notes = [523, 659, 784, 1047];
                notes.forEach((f, i) => this._tone(f, t + i * 0.07, 0.22, { type: 'triangle', vol: 0.16 }));
                break;
            }
            case 'bigwin': {
                const notes = [523, 659, 784, 1047, 784, 1047, 1319, 1568];
                notes.forEach((f, i) => this._tone(f, t + i * 0.09, 0.3, { type: 'square', vol: 0.07 }));
                notes.forEach((f, i) => this._tone(f / 2, t + i * 0.09, 0.3, { type: 'triangle', vol: 0.1 }));
                for (let i = 0; i < 14; i++) this._tone(3000 + Math.random() * 2500, t + 0.1 + i * 0.06, 0.06, { type: 'triangle', vol: 0.05 });
                break;
            }
            case 'cashout':
                for (let i = 0; i < 6; i++) this._tone(2600 + i * 180, t + i * 0.045, 0.09, { type: 'triangle', vol: 0.08 });
                break;
            case 'lose':
                this._tone(330, t, 0.25, { type: 'sawtooth', vol: 0.07, slide: 0.7 });
                this._tone(247, t + 0.18, 0.4, { type: 'sawtooth', vol: 0.07, slide: 0.6 });
                break;
            case 'boom':
                this._noiseBurst(t, 0.9, { vol: 0.6, freq: 900, q: 0.5, type: 'lowpass', sweep: 0.08 });
                this._tone(90, t, 0.6, { type: 'sine', vol: 0.5, slide: 0.3 });
                break;
            case 'splat':
                this._noiseBurst(t, 0.25, { vol: 0.4, freq: 600, q: 0.7, type: 'lowpass', sweep: 0.3 });
                this._tone(180, t, 0.2, { type: 'square', vol: 0.08, slide: 0.4 });
                break;
            case 'honk':
                this._tone(415, t, 0.35, { type: 'sawtooth', vol: 0.08 });
                this._tone(523, t, 0.35, { type: 'sawtooth', vol: 0.06 });
                break;
            case 'peg':
                this._tone(1200 + (opts.pitch || 0) * 60, t, 0.05, { type: 'sine', vol: 0.06 });
                break;
            case 'rise':
                this._tone(opts.freq || 400, t, 0.12, { type: 'sine', vol: 0.05 });
                break;
            default:
                break;
        }
    }
}
