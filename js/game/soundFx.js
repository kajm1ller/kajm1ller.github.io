/**
 * js/game/soundFx.js
 *
 * A master effects bus for the game's sound, so a state of mind can colour it all at once (being
 * very drunk: everything echoes and rings out in a big reverb).
 *
 * installSoundFx(ctx) puts the bus between the game's AudioContext and the speakers:
 *   - any Web Audio node connected to ctx.destination is connected to the bus instead
 *   - long-running <audio> elements (music, the radio, loops) join the bus when they play while an
 *     effect is on. Short one-shot clips (often a fresh clone per play) stay as they are: an
 *     element routed into Web Audio stays captured for good, and capturing every clone piled up
 *     nodes until the audio broke up.
 * The reverb and the echo are only wired in while they're turned up, so being sober costs nothing
 * (a convolver running all the time on everything made the audio crackle and drop out).
 *
 *   installSoundFx(ctx)                 once, right after the AudioContext is made
 *   setSoundFx({ reverb: 0..1, echo: 0..1, pulse: 0..1, pulseRate: Hz })
 *   captureMedia(el)                    route an element that was already playing through it too
 */

let bus = null;

/** A decaying stereo noise burst: the impulse response of a big, wet room. */
function hallImpulse(ctx, seconds = 2.2, decay = 2.8) {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
        const ch = buf.getChannelData(c);
        for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return buf;
}

/** Music-length elements that are worth routing through the bus. */
function longRunning(el) {
    if (el.loop) return true;
    if (Number.isFinite(el.duration) && el.duration > 20) return true;
    const src = el.currentSrc || el.src || '';
    return /music|radio|ambien|barmusic|Crowd/i.test(src);
}

export function installSoundFx(ctx) {
    if (bus || !ctx || typeof window === 'undefined') return bus;
    const dest = ctx.destination;
    const nativeConnect = AudioNode.prototype.connect;
    const input = ctx.createGain();
    const dry = ctx.createGain();
    const verb = ctx.createConvolver();
    verb.buffer = hallImpulse(ctx);
    const verbGain = ctx.createGain();
    verbGain.gain.value = 0;
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.34;
    const feedback = ctx.createGain();
    feedback.gain.value = 0;
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 2400;
    const echoGain = ctx.createGain();
    echoGain.gain.value = 0;
    // Pulsing (a DMT come-up's buzzing vibration): an LFO beating the dry level, off (depth 0) by default
    const pulse = ctx.createGain();
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    lfo.frequency.value = 4;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0;
    nativeConnect.call(lfo, lfoDepth);
    nativeConnect.call(lfoDepth, pulse.gain);
    lfo.start();
    nativeConnect.call(input, pulse);
    nativeConnect.call(pulse, dry);
    nativeConnect.call(dry, dest);
    // The wet paths' insides are wired once; their inputs only while they're in use (see setSoundFx)
    nativeConnect.call(verb, verbGain);
    nativeConnect.call(verbGain, dest);
    nativeConnect.call(delay, echoTone);
    nativeConnect.call(echoTone, feedback);
    nativeConnect.call(feedback, delay);
    nativeConnect.call(echoTone, echoGain);
    nativeConnect.call(echoGain, dest);
    bus = { ctx, input, dry, verb, verbGain, delay, feedback, echoGain, pulse, lfo, lfoDepth, verbOn: false, echoOn: false, active: false, offAt: 0, nativeConnect, nativeSource: null };

    // Everything bound for the speakers goes through the bus
    AudioNode.prototype.connect = function (target, ...rest) {
        if (target === dest && this !== dry && this !== verbGain && this !== echoGain && this.context === ctx) return nativeConnect.call(this, input, ...rest);
        return nativeConnect.call(this, target, ...rest);
    };
    // Elements the game sources itself (bars.js) are already in the graph
    const nativeSource = ctx.createMediaElementSource.bind(ctx);
    bus.nativeSource = nativeSource;
    ctx.createMediaElementSource = (el) => { el.__fxRouted = true; return nativeSource(el); };
    const M = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
    if (M && M.play) {
        const nativePlay = M.play;
        M.play = function (...args) {
            // The world muted (broken through on DMT): nothing of the game's own plays, bar what's kept audible
            if (bus && bus.worldMuted && !this.__keepAudible) return Promise.resolve();
            // Only long-running sounds, only while an effect is on, only while the context runs
            // (an element routed into a suspended context would go silent)
            if (!this.__fxRouted && bus && bus.active && bus.ctx.state === 'running' && longRunning(this)) {
                this.__fxRouted = true;
                try { nativeConnect.call(nativeSource(this), input); } catch (e) { /* cross-origin or already sourced */ }
            }
            return nativePlay.apply(this, args);
        };
    }
    return bus;
}

/**
 * Cuts all of the game's sound (everything through the bus, and one-shot clips don't start) while
 * on; elements marked `__keepAudible` (a trip's soundtrack) aren't touched.
 */
export function muteWorld(on) {
    if (!bus) return;
    bus.worldMuted = !!on;
    bus.input.gain.setTargetAtTime(on ? 0 : 1, bus.ctx.currentTime, 0.25);
}

/**
 * Routes an element that is already playing (the background music started before an effect came
 * on) through the bus from now on. Elements the game sources itself are left alone.
 */
export function captureMedia(el) {
    if (!bus || !el || el.__fxRouted || bus.ctx.state !== 'running') return;
    el.__fxRouted = true;
    try { bus.nativeConnect.call(bus.nativeSource(el), bus.input); } catch (e) { /* cross-origin or already sourced */ }
}

/**
 * reverb / echo: 0 (none) .. 1 (everything swimming). pulse: 0 .. 1 how deep everything throbs,
 * pulseRate: how fast (Hz).
 */
export function setSoundFx({ reverb = 0, echo = 0, pulse = 0, pulseRate = 4 } = {}) {
    if (!bus) return;
    reverb = Math.max(0, Math.min(1, reverb));
    echo = Math.max(0, Math.min(1, echo));
    pulse = Math.max(0, Math.min(0.95, pulse));
    const t = bus.ctx.currentTime;
    bus.pulse.gain.setTargetAtTime(1 - pulse * 0.5, t, 0.2);
    bus.lfoDepth.gain.setTargetAtTime(pulse * 0.5, t, 0.2);
    bus.lfo.frequency.setTargetAtTime(Math.max(0.5, Math.min(30, pulseRate)), t, 0.3);
    // Wire a wet path in as it's turned up; take it out once it has faded right down
    if (reverb > 0.01 && !bus.verbOn) { bus.nativeConnect.call(bus.input, bus.verb); bus.verbOn = true; }
    if (echo > 0.01 && !bus.echoOn) { bus.nativeConnect.call(bus.input, bus.delay); bus.echoOn = true; }
    if (reverb <= 0.01 && bus.verbOn && bus.verbGain.gain.value < 0.005) { try { bus.input.disconnect(bus.verb); } catch (e) { /* not connected */ } bus.verbOn = false; }
    if (echo <= 0.01 && bus.echoOn && bus.echoGain.gain.value < 0.005) { try { bus.input.disconnect(bus.delay); } catch (e) { /* not connected */ } bus.echoOn = false; }
    bus.active = bus.verbOn || bus.echoOn || pulse > 0.01;
    bus.verbGain.gain.setTargetAtTime(reverb * 0.9, t, 0.4);
    bus.dry.gain.setTargetAtTime(1 - reverb * 0.25, t, 0.4);
    bus.echoGain.gain.setTargetAtTime(echo * 0.55, t, 0.4);
    bus.feedback.gain.setTargetAtTime(echo * 0.48, t, 0.4);
}

/** For debugging: the bus's current levels (null before it's installed). */
export function soundFxState() {
    if (!bus) return null;
    return { reverb: bus.verbGain.gain.value, dry: bus.dry.gain.value, echo: bus.echoGain.gain.value, feedback: bus.feedback.gain.value,
        verbOn: bus.verbOn, echoOn: bus.echoOn, ctx: bus.ctx.state };
}
