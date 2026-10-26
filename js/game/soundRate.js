/**
 * js/game/soundRate.js
 *
 * One speed for every sound in the game (drugs slow the world's audio down, pitch and all).
 * installSoundRate() wraps the browser's audio sources once, so nothing else has to know about it:
 *
 *   - <audio> / Audio elements: `playbackRate` keeps meaning "the rate the game asked for"; the rate
 *     that reaches the element is that times the global rate (pitch follows the speed)
 *   - Web Audio oscillators and buffer sources: their `detune` is raised / lowered by the equivalent
 *     number of cents, `stop()` times are stretched to match, and sounds already playing follow
 *     when the rate changes
 *
 *   setSoundRate(0.7)   everything plays at 70 % speed (1 = normal)
 *   getSoundRate()
 */

let rate = 1;
let installed = false;
const media = new Set();     // elements that are playing (or were started) and not yet ended
const sources = new Set();   // started Web Audio sources not yet ended

const cents = () => 1200 * Math.log2(rate);

export function getSoundRate() { return rate; }

function applyMedia(el, nativeSet) {
    const base = el.__baseRate === undefined ? 1 : el.__baseRate;
    nativeSet.call(el, Math.max(0.0625, Math.min(16, base * rate)));
    try { el.preservesPitch = Math.abs(rate - 1) < 1e-3; } catch (e) { /* not supported */ }
}

function applySource(node) {
    try { node.detune.value = (node.__detuneBase || 0) + cents(); } catch (e) { /* closed */ }
}

export function setSoundRate(r) {
    r = Math.max(0.25, Math.min(1.5, r));
    if (Math.abs(r - rate) < 0.004) return;
    rate = r;
    if (!installed) return;
    for (const el of media) el.playbackRate = el.__baseRate === undefined ? 1 : el.__baseRate;   // re-applies through the setter
    for (const n of sources) applySource(n);
}

export function installSoundRate() {
    if (installed || typeof window === 'undefined') return;
    installed = true;

    const M = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
    const desc = M && Object.getOwnPropertyDescriptor(M, 'playbackRate');
    if (desc && desc.set && desc.get) {
        Object.defineProperty(M, 'playbackRate', {
            configurable: true,
            enumerable: desc.enumerable,
            get() { return this.__baseRate === undefined ? desc.get.call(this) : this.__baseRate; },
            set(v) {
                this.__baseRate = Number(v) || 1;
                applyMedia(this, desc.set);
            }
        });
        const play = M.play;
        M.play = function (...args) {
            if (!this.__tracked) {
                this.__tracked = true;
                const done = () => { media.delete(this); this.__tracked = false; };
                this.addEventListener('ended', done, { once: true });
            }
            // Browsers put the native rate back to normal when a new src loads (the radio changes track)
            if (!this.__reapplyBound) {
                this.__reapplyBound = true;
                const reapply = () => { if (rate !== 1) this.playbackRate = this.__baseRate === undefined ? 1 : this.__baseRate; };
                this.addEventListener('loadstart', reapply);
                this.addEventListener('playing', reapply);
            }
            media.add(this);
            if (rate !== 1 || this.__baseRate !== undefined) this.playbackRate = this.__baseRate === undefined ? 1 : this.__baseRate;
            return play.apply(this, args);
        };
    }

    const A = window.AudioScheduledSourceNode && window.AudioScheduledSourceNode.prototype;
    if (A) {
        // Buffer sources have their own start() (with offset / duration), so wrap each that exists
        for (const proto of [A, window.AudioBufferSourceNode && window.AudioBufferSourceNode.prototype]) {
            if (!proto || !Object.prototype.hasOwnProperty.call(proto, 'start')) continue;
            const start = proto.start;
            proto.start = function (...args) {
                if (this.detune && !this.__tracked) {
                    this.__tracked = true;
                    this.__detuneBase = this.detune.value;
                    sources.add(this);
                    this.addEventListener('ended', () => sources.delete(this), { once: true });
                    if (rate !== 1) applySource(this);
                }
                return start.apply(this, args);
            };
        }
        const stop = A.stop;
        A.stop = function (when = 0) {
            // A slower sound lasts longer: stretch the time left until it stops
            if (rate !== 1 && this.context && when > 0) {
                const now = this.context.currentTime;
                if (when > now) when = now + (when - now) / rate;
            }
            return stop.call(this, when);
        };
    }
}
