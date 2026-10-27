/**
 * js/game/carCrash.js
 *
 * Car crashes. CrashSystem watches every car near the player (the player's, traffic, parked,
 * spawned, police) and, when two of them meet hard enough:
 *   - exchanges momentum along the contact (heavier cars push lighter ones) with a spin from where
 *     they were struck; a traffic car hit hard becomes a wreck: its driver loses control, it slides
 *     and spins to a stop and stays there
 *   - crumples both cars where they touched: the body panels are dented in (each car gets its own
 *     copy of its geometry the first time), windows on that side break (carInterior.js
 *     GlassShatterSystem), sparks fly and bits of trim, plastic and glass scatter on the road
 *   - accumulates damage: a battered car smokes from under the bonnet, and the player's car loses
 *     power (vehicle.js reads `damage`)
 *   - plays a crash built from the impact (CrashAudio): a low body thump, crunching metal, panels
 *     ringing, glass, debris tinkling down afterwards
 *
 * CrashAudio also has the sounds of someone being hit by a car (a heavy, wet thunk, the bonnet
 * denting, something cracking) and of the people who see it screaming (recordings of real screams,
 * media/screams, CC0; see CREDITS.txt there).
 *
 * Car frame (as vehicle.js): forward is (-sin yaw, -cos yaw), right is (cos yaw, -sin yaw).
 */

import * as THREE from 'three';

export const CRASH_CONFIG = Object.freeze({
    RANGE: 140,              // cars further than this from the listener aren't checked
    MIN_IMPACT: 2.0,         // m/s closing speed for a crash at all
    MAX_TRACK_SPEED: 70,     // m/s; a bigger jump between frames is a teleport, not driving
    WRECK_IMPACT: 6.5,       // a traffic car hit this hard loses its driver's control
    MASS: 1400,
    RESTITUTION: 0.18,
    WRECK_FRICTION: 6.5,     // m/s^2 a wreck slides to a stop with
    PAIR_COOLDOWN: 0.5,
    SMOKE_FROM: 0.5          // damage (0..1+) at which the bonnet smokes
});
const C = CRASH_CONFIG;
const SCREAM_CLIPS = 11;      // media/screams/scream_01.mp3 .. scream_11.mp3

// ================================================================================================
// Sounds
// ================================================================================================
export class CrashAudio {
    constructor() {
        this.ctx = null;
        this.out = null;
        this._noise = null;
    }

    setContext(ctx) {
        if (this.ctx || !ctx) return;
        this.ctx = ctx;
        this.out = ctx.createGain();
        this.out.gain.value = 1;
        this.out.connect(ctx.destination);
        const len = ctx.sampleRate * 2;
        this._noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const ch = this._noise.getChannelData(0);
        for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
        this._loadScreams();
    }

    _ok() { return this.ctx && this.ctx.state === 'running'; }

    /** A bus for one sound at `distance` m: quieter and duller further off. */
    _bus(distance, gain = 1) {
        const far = Math.max(0, Math.min(1, distance / 150));
        const g = this.ctx.createGain();
        g.gain.value = gain * (1 - far * 0.92);
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 18000 - far * 15500;
        g.connect(lp);
        lp.connect(this.out);
        return g;
    }

    _noiseHit(dest, t, dur, type, freq, q, gain, attack = 0.002) {
        const c = this.ctx;
        const src = c.createBufferSource();
        src.buffer = this._noise;
        src.playbackRate.value = 0.8 + Math.random() * 0.4;
        const f = c.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f).connect(g).connect(dest);
        src.start(t, Math.random() * 1.5, dur + 0.05);
    }

    _tone(dest, t, f0, f1, dur, gain, type = 'sine') {
        const c = this.ctx;
        const o = c.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(dest);
        o.start(t);
        o.stop(t + dur + 0.05);
    }

    /**
     * Two cars meeting. `s` 0 (a bump) .. 1 (a wreck); `glass` adds breaking windows.
     */
    impact(s, distance, { glass = false } = {}) {
        if (!this._ok()) return;
        const t = this.ctx.currentTime + 0.005;
        const bus = this._bus(distance, 0.55 + s * 0.65);
        // The thump of two tonnes of car
        this._tone(bus, t, 75 + s * 25, 32, 0.25 + s * 0.35, 0.9);
        this._noiseHit(bus, t, 0.18 + s * 0.3, 'lowpass', 260 + s * 200, 0.7, 0.9);
        // Crunching metal and plastic: a burst of short, gritty crackles
        const n = 4 + Math.round(s * 14);
        for (let i = 0; i < n; i++) {
            const dt = Math.random() * (0.05 + s * 0.32);
            this._noiseHit(bus, t + dt, 0.025 + Math.random() * 0.07, 'bandpass', 600 + Math.random() * 3200, 2 + Math.random() * 5, 0.25 + s * 0.45);
        }
        // Panels ringing out
        for (let i = 0; i < 2 + Math.round(s * 2); i++) {
            const f = 170 + Math.random() * 650;
            this._tone(bus, t + Math.random() * 0.05, f, f * (0.94 + Math.random() * 0.04), 0.35 + s * 0.9, 0.04 + s * 0.07, 'triangle');
        }
        // Glass going
        if (glass) {
            this._noiseHit(bus, t + 0.01, 0.12, 'highpass', 3500, 0.8, 0.5);
            for (let i = 0; i < 14; i++) this._noiseHit(bus, t + 0.04 + Math.random() * 0.55, 0.02 + Math.random() * 0.05, 'bandpass', 4500 + Math.random() * 4000, 6, 0.18);
        }
        // Bits landing on the road afterwards
        if (s > 0.25) {
            for (let i = 0; i < 3 + Math.round(s * 6); i++) {
                this._noiseHit(bus, t + 0.35 + Math.random() * 0.9, 0.03, 'bandpass', 1800 + Math.random() * 2500, 4, 0.08 + s * 0.08);
            }
        }
    }

    /** Metal grinding along metal (a car scraping along another or a wall), for a moment. */
    scrape(s, distance) {
        if (!this._ok()) return;
        const t = this.ctx.currentTime + 0.005;
        const bus = this._bus(distance, 0.3 + s * 0.4);
        this._noiseHit(bus, t, 0.25, 'bandpass', 1400 + Math.random() * 1200, 3, 0.35, 0.03);
        this._tone(bus, t, 900 + Math.random() * 500, 700, 0.25, 0.03, 'sawtooth');
    }

    /**
     * Someone hit by a car: a deep, wet thunk of a body, the bonnet denting under them and
     * something giving way inside. `s` grows with the car's speed.
     */
    bodyHit(s, distance) {
        if (!this._ok()) return;
        const t = this.ctx.currentTime + 0.004;
        const bus = this._bus(distance, 0.7 + s * 0.5);
        // The body: a low, heavy, dull thud with a short ring of the chest
        this._tone(bus, t, 110, 38, 0.24, 1.0);
        this._tone(bus, t + 0.01, 60, 30, 0.35, 0.6);
        this._noiseHit(bus, t, 0.12, 'lowpass', 700, 0.7, 0.9);
        this._noiseHit(bus, t + 0.005, 0.18, 'bandpass', 350, 1.2, 0.55);
        // Flesh: a wet slap
        this._noiseHit(bus, t + 0.01, 0.06, 'bandpass', 1500, 1.5, 0.45);
        // The bonnet buckling under them
        this._noiseHit(bus, t + 0.02, 0.08, 'bandpass', 1100, 4, 0.35);
        this._tone(bus, t + 0.02, 260, 190, 0.3, 0.07, 'triangle');
        // Bones (the harder the hit, the more)
        for (let i = 0; i < 1 + Math.round(s * 3); i++) {
            this._noiseHit(bus, t + 0.015 + Math.random() * 0.06, 0.012, 'highpass', 2600 + Math.random() * 2000, 0.8, 0.35 + s * 0.3);
        }
    }

    /** A body landing on a bonnet / windscreen / the road. */
    bodyLand(s, distance, onCar = true) {
        if (!this._ok()) return;
        const t = this.ctx.currentTime + 0.004;
        const bus = this._bus(distance, 0.5 + s * 0.5);
        this._tone(bus, t, 90, 40, 0.2, 0.8);
        this._noiseHit(bus, t, 0.1, 'lowpass', 600, 0.7, 0.7);
        if (onCar) {
            this._noiseHit(bus, t + 0.01, 0.09, 'bandpass', 900, 4, 0.35);
            this._tone(bus, t, 230, 170, 0.35, 0.06, 'triangle');
        }
    }

    /** Loads the scream recordings (media/screams, CC0; see CREDITS.txt) once the context exists. */
    _loadScreams() {
        if (this._screamsLoading || !this.ctx) return;
        this._screamsLoading = true;
        this.screams = [];
        for (let i = 1; i <= SCREAM_CLIPS; i++) {
            const url = `./media/screams/scream_${String(i).padStart(2, '0')}.mp3`;
            fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(url))))
                .then((data) => this.ctx.decodeAudioData(data))
                .then((buf) => {
                    this.screams.push(buf);
                    const waiting = this._pendingScreams;
                    if (waiting && waiting.length) {
                        this._pendingScreams = [];
                        for (const [d, s, dl] of waiting) this.scream(d, s, dl);
                    }
                })
                .catch(() => { /* missing clip: the others still play */ });
        }
    }

    /**
     * Someone screaming: one of the recorded screams (a different one each time if it can),
     * pitched a little up or down so the same person doesn't keep coming round. `delay` is
     * seconds from now. Nothing plays until the recordings have loaded.
     */
    scream(distance, seed = Math.random(), delay = 0) {
        if (!this._ok()) return;
        this._loadScreams();
        const list = this.screams;
        if (!list || !list.length) {
            // Still loading: remember it and play when the first clip is decoded
            (this._pendingScreams ||= []).push([distance, seed, delay]);
            if (this._pendingScreams.length > 6) this._pendingScreams.shift();
            return;
        }
        let i = Math.floor(Math.abs(seed * 9973)) % list.length;
        if (list.length > 1 && i === this._lastScream) i = (i + 1) % list.length;
        this._lastScream = i;
        const c = this.ctx;
        const t = c.currentTime + 0.01 + delay;
        const src = c.createBufferSource();
        src.buffer = list[i];
        src.playbackRate.value = 0.92 + ((seed * 7.31) % 1 + 1) % 1 * 0.16;
        const g = c.createGain();
        g.gain.value = 0.9;
        src.connect(g).connect(this._bus(distance, 0.85));
        src.start(t);
    }
}

// ================================================================================================
// Crashes
// ================================================================================================
const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _rootInv = new THREE.Matrix4();
const _dir = new THREE.Vector3();
const _n3 = new THREE.Matrix3();

const GLASS_NAMES = /glass|windshield/i;

export class CrashSystem {
    /**
     * @param {Object} o
     * @param {THREE.Scene} o.scene
     * @param {Object} [o.glass] GlassShatterSystem (carInterior.js) to break windows
     * @param {Object} [o.smoke] SmokePuffs (drugFx.js) for smoking engines
     * @param {Function} [o.audioCtx] () => AudioContext (made on demand)
     * @param {Object} [o.spatialGrid] wrecks stop against buildings
     */
    constructor({ scene, glass = null, smoke = null, audioCtx = null, spatialGrid = null }) {
        this.scene = scene;
        this.glass = glass;
        this.smoke = smoke;
        this.audioCtx = audioCtx;
        this.spatialGrid = spatialGrid;
        this.audio = new CrashAudio();
        this.track = new Map();          // vehicle -> { x, z, vx, vz, pvx, pvz }
        this.pairs = new Map();          // "idA|idB" -> time of last impact
        this.wrecks = new Set();
        this.mounted = new Set();        // traffic cars shown with their own (dented) mesh
        this.time = 0;
        this.onPlayerImpact = null;      // (closingSpeed, severity, other) => void
        this.onCrash = null;             // (a, b, closingSpeed, point) => void
        this._sparks = [];
        this._debris = [];
        this._sparkGeo = new THREE.BoxGeometry(0.03, 0.03, 0.12);
        this._sparkMat = new THREE.MeshBasicMaterial({ color: 0xffc860, toneMapped: false });
        this._debrisGeo = new THREE.BoxGeometry(0.16, 0.04, 0.1);
        this.stats = { crashes: 0, wrecks: 0 };
    }

    // --------------------------------------------------------------------------------------------
    /**
     * @param {number} dt
     * @param {Array} vehicles every car that can crash (duplicates and nulls are fine)
     * @param {{x,z}} listener camera position
     * @param {Object} playerCar the car the player is driving (or null)
     */
    update(dt, vehicles, listener, playerCar = null) {
        if (!dt) return;
        this.time += dt;
        const near = this._near || (this._near = []);
        near.length = 0;
        const seen = this._seen || (this._seen = new Set());
        seen.clear();
        for (const v of vehicles) {
            if (!v || seen.has(v) || v.isPlane || !v.position) continue;
            seen.add(v);
            if (Math.abs(v.position.x - listener.x) > C.RANGE || Math.abs(v.position.z - listener.z) > C.RANGE) continue;
            near.push(v);
            // Velocity from how far it moved (works for every kind of car); keep last frame's too:
            // by the time we look, the push-apart of a collision has already eaten the closing speed
            let tr = this.track.get(v);
            if (!tr) { tr = { x: v.position.x, z: v.position.z, vx: 0, vz: 0, pvx: 0, pvz: 0, at: this.time }; this.track.set(v, tr); }
            const mx = v.position.x - tr.x, mz = v.position.z - tr.z;
            tr.pvx = tr.vx; tr.pvz = tr.vz;
            // Teleported, re-parked into a stall, or back in range after a while: not a real speed
            // (these read as 300 m/s rams and wrecked whole rows of parked cars)
            const stale = this.time - tr.at > dt * 1.5;
            tr.at = this.time;
            if (stale || mx * mx + mz * mz > 100 || mx * mx + mz * mz > (C.MAX_TRACK_SPEED * dt) ** 2) {
                // Teleported (respawned / recycled): forget the old dents
                tr.vx = tr.vz = tr.pvx = tr.pvz = 0;
                if (mx * mx + mz * mz > 100 && this.mounted.has(v) && !this.wrecks.has(v)) this._restore(v);
            } else {
                tr.vx = mx / dt;
                tr.vz = mz / dt;
            }
            if (v === playerCar && v.velocity) { tr.vx = v.velocity.x; tr.vz = v.velocity.y; }
            tr.x = v.position.x;
            tr.z = v.position.z;
        }

        // Pairs
        for (let i = 0; i < near.length; i++) {
            const a = near[i];
            for (let j = i + 1; j < near.length; j++) {
                const b = near[j];
                const ra = (a.length || 4.5) / 2 + 0.3, rb = (b.length || 4.5) / 2 + 0.3;
                const dx = a.position.x - b.position.x, dz = a.position.z - b.position.z;
                if (dx * dx + dz * dz > (ra + rb) * (ra + rb)) continue;
                const c = this._contact(a, b);
                if (!c) continue;
                const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
                const last = this.pairs.get(key);
                if (last !== undefined && this.time - last < C.PAIR_COOLDOWN) continue;
                const ta = this.track.get(a), tb = this.track.get(b);
                // Closing speed along the contact normal (n points from b to a), before the push-apart
                const avx = Math.abs(ta.pvx) > Math.abs(ta.vx) ? ta.pvx : ta.vx, avz = Math.abs(ta.pvz) > Math.abs(ta.vz) ? ta.pvz : ta.vz;
                const bvx = Math.abs(tb.pvx) > Math.abs(tb.vx) ? tb.pvx : tb.vx, bvz = Math.abs(tb.pvz) > Math.abs(tb.vz) ? tb.pvz : tb.vz;
                const closing = -((avx - bvx) * c.nx + (avz - bvz) * c.nz);
                if (closing < C.MIN_IMPACT) continue;
                this.pairs.set(key, this.time);
                this._impact(a, b, c, closing, { avx, avz, bvx, bvz }, listener, playerCar);
            }
        }

        // Wrecks slide and spin to a stop; dented traffic cars keep their own mesh in step
        for (const v of this.wrecks) this._slide(v, dt);
        for (const v of this.mounted) this._syncMesh(v);
        this._effects(dt, listener);
    }

    /** Deepest overlap between the two cars' 3-circle footprints: { x, z, nx, nz, depth } or null. */
    _contact(a, b) {
        const ca = this._circles(a, this._ca || (this._ca = [{}, {}, {}]));
        const cb = this._circles(b, this._cb || (this._cb = [{}, {}, {}]));
        let best = null, bestPen = -0.12;    // a little slack: the push-apart may have just separated them
        for (const p of ca) for (const q of cb) {
            const dx = p.x - q.x, dz = p.z - q.z;
            const d = Math.hypot(dx, dz);
            const pen = p.r + q.r - d;
            if (pen > bestPen) {
                bestPen = pen;
                const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
                best = { x: q.x + nx * q.r, z: q.z + nz * q.r, nx, nz, depth: pen };
            }
        }
        return best;
    }

    _circles(v, out) {
        const w = (v.width || 1.9) / 2, L = (v.length || 4.5) / 2;
        const off = L - w + 0.2;
        const fx = -Math.sin(v.yaw || 0), fz = -Math.cos(v.yaw || 0);
        for (let i = 0; i < 3; i++) {
            const o = (1 - i) * off;
            out[i].x = v.position.x + fx * o;
            out[i].z = v.position.z + fz * o;
            out[i].r = w;
        }
        return out;
    }

    _mass(v) {
        const m = v.mass || (v.model && v.model.physics && v.model.physics.mass);
        if (m) return m;
        return C.MASS * Math.max(0.7, Math.min(2.5, ((v.length || 4.5) * (v.width || 1.9)) / 8.5));
    }

    _impact(a, b, c, closing, V, listener, playerCar) {
        this.stats.crashes++;
        const ma = this._mass(a), mb = this._mass(b);
        const s = Math.max(0, Math.min(1, (closing - C.MIN_IMPACT) / 18));
        const point = new THREE.Vector3(c.x, 0.55, c.z);
        // Momentum: an impulse along the normal, with a little bounce
        const J = (1 + C.RESTITUTION) * closing / (1 / ma + 1 / mb);
        const dva = J / ma, dvb = J / mb;
        const ctx = this.audioCtx ? this.audioCtx() : null;
        if (ctx) this.audio.setContext(ctx);
        const dist = Math.hypot(c.x - listener.x, c.z - listener.z);
        // Which windows go: the side each car was hit on
        const glassA = this._breakGlass(a, c.x, c.z, s, ctx);
        const glassB = this._breakGlass(b, c.x, c.z, s, ctx);
        this.audio.impact(s, dist, { glass: glassA || glassB });
        for (const [v, sign, dv, vx, vz, share] of [[a, 1, dva, V.avx, V.avz, mb / (ma + mb)], [b, -1, dvb, V.bvx, V.bvz, ma / (ma + mb)]]) {
            const nx = c.nx * sign, nz = c.nz * sign;      // pushes this car away from the other
            // Crumple where it was hit, by its share of the energy
            this._dent(v, c.x, c.z, -nx, -nz, s * (0.5 + share));
            v.damage = (v.damage || 0) + s * (0.35 + share * 0.6);
            const wasMoving = Math.hypot(vx, vz);
            if (v === playerCar || v.isPolice) {
                // Cars with their own physics (yours, the police's): knocked along, still driven
                if (v.velocity) {
                    v.velocity.x = vx + nx * dv;
                    v.velocity.y = vz + nz * dv;
                    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
                    v.speed = v.velocity.x * fx + v.velocity.y * fz;
                }
                if (v === playerCar && this.onPlayerImpact) this.onPlayerImpact(closing, s, v === a ? b : a);
                continue;
            }
            if (v.isPlayer) continue;   // someone else's car (multiplayer): theirs to handle
            // Off-centre hits spin the car
            const rx = c.x - v.position.x, rz = c.z - v.position.z;
            const L = v.length || 4.5, W = v.width || 1.9;
            const I = this._mass(v) * (L * L + W * W) / 12;
            const spin = (rx * nz - rz * nx) * J / I;
            if (closing >= C.WRECK_IMPACT || this.wrecks.has(v) || v.driverDead || v.isParked) {
                this._wreck(v, vx + nx * dv, vz + nz * dv, -spin * 1.4);
            } else if (wasMoving < 0.5 && dv > 0.5) {
                // A stopped car nudged: shoved along (traffic.js eases the shove out)
                v.position.x += nx * Math.min(0.6, dv * 0.08);
                v.position.z += nz * Math.min(0.6, dv * 0.08);
            }
        }
        this._sparksAt(point, c.nx, c.nz, 6 + Math.round(s * 30));
        if (s > 0.15) this._debrisAt(point, a, b, 2 + Math.round(s * 10));
        if (this.onCrash) this.onCrash(a, b, closing, point);
    }

    /** Makes a car a wreck: no one's driving it any more, it slides on with (vx, vz) and `spin`. */
    _wreck(v, vx, vz, spin) {
        if (!this.wrecks.has(v)) {
            this.wrecks.add(v);
            this.stats.wrecks++;
            v.crashed = true;
            v.driverGone = true;         // traffic.js retires its driver; parked cars leave it be
            v.inputThrottle = 0;
        }
        v.wreck = { vx, vz, spin: (v.wreck ? v.wreck.spin : 0) + spin };
        this._mount(v);
    }

    _slide(v, dt) {
        const w = v.wreck;
        if (!w) return;
        const sp = Math.hypot(w.vx, w.vz);
        if (sp > 0.01 || Math.abs(w.spin) > 0.01) {
            const dec = Math.max(0, sp - C.WRECK_FRICTION * dt);
            const k = sp > 1e-4 ? dec / sp : 0;
            w.vx *= k;
            w.vz *= k;
            w.spin *= Math.exp(-2.2 * dt);
            if (Math.abs(w.spin) < 0.02) w.spin = 0;
            const nx = v.position.x + w.vx * dt, nz = v.position.z + w.vz * dt;
            if (this._blocked(v, nx, nz)) { w.vx *= -0.2; w.vz *= -0.2; }
            else { v.position.x = nx; v.position.z = nz; }
            v.yaw += w.spin * dt;
            const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
            v.speed = w.vx * fx + w.vz * fz;
            if (v.velocity) { v.velocity.x = w.vx; v.velocity.y = w.vz; }
            v.wheelRoll = (v.wheelRoll || 0) + (v.speed * dt) / (v.wheelRadius || 0.33);
        } else {
            v.speed = 0;
            if (v.velocity) v.velocity.set(0, 0);
        }
    }

    /** Would the car's middle be inside a building at (x, z)? */
    _blocked(v, x, z) {
        const g = this.spatialGrid;
        if (!g || typeof g.queryRadius !== 'function') return false;
        const res = this._q || (this._q = []);
        g.queryRadius(x, z, 1.2, res, 'STATIC');
        for (const it of res) {
            if (it.box && x > it.minX - 0.8 && x < it.maxX + 0.8 && z > it.minZ - 0.8 && z < it.maxZ + 0.8 && (it.maxY === undefined || it.maxY > 0.5)) return true;
        }
        return false;
    }

    // --------------------------------------------------------------------------------------------
    // Crumpling
    // --------------------------------------------------------------------------------------------
    /** Shows a traffic car with its own mesh (instancedFleet.js hides its instance while it is). */
    _mount(v) {
        if (!v.mesh) return;
        if (!v.mesh.parent) {
            this.scene.add(v.mesh);
            v._crashMounted = true;
            this.mounted.add(v);
        }
        this._syncMesh(v);
    }

    _syncMesh(v) {
        if (!v._crashMounted || !v.mesh) return;
        v.mesh.position.set(v.position.x, v.position.y || 0, v.position.z);
        v.mesh.rotation.order = 'YXZ';
        v.mesh.rotation.y = v.yaw || 0;
    }

    /** Back to new (a recycled traffic car): original geometry, glass back, instanced again. */
    _restore(v) {
        if (!v.mesh) return;
        v.mesh.traverse((o) => {
            if (o.isMesh && o.userData.crashOrig) { o.geometry.dispose(); o.geometry = o.userData.crashOrig; o.userData.crashOrig = null; }
            if (o.isMesh && o.userData.crashHidden) { o.visible = true; o.userData.crashHidden = false; }
        });
        if (v._crashMounted && v.mesh.parent) v.mesh.parent.remove(v.mesh);
        v._crashMounted = false;
        v.damage = 0;
        this.mounted.delete(v);
        this.wrecks.delete(v);
    }

    /**
     * Dents the car in around the world point (x, z), pushing panels along (dx, dz) (into the
     * car) by up to `s` (0..1+) of the worst a crash does, a bit up and rumpled too.
     */
    _dent(v, x, z, dx, dz, s) {
        if (!v.mesh || s < 0.04) return;
        if (!v.isPlayer && !v.mesh.parent) this._mount(v);
        const root = v.mesh;
        root.updateMatrixWorld(true);
        _rootInv.copy(root.matrixWorld).invert();
        const hit = _p.set(x, (v.position.y || 0) + 0.65, z).applyMatrix4(_rootInv).clone();
        const dir = _dir.set(dx, 0, dz).transformDirection(_rootInv).clone();
        const R = 0.7 + Math.min(1.4, s) * 1.1;
        const depth = Math.min(0.55, 0.06 + s * 0.42);
        const seed = Math.random() * 100;
        root.traverse((o) => {
            if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
            if (GLASS_NAMES.test(o.name || '') || /wheel|tire|rim/i.test(o.name || '')) return;
            for (let p = o; p && p !== root; p = p.parent) if (/wheel|vehicle_driver_npc/i.test(p.name || '')) return;
            if (o.material && o.material.transparent) return;
            // Each car gets its own geometry the first time it's hurt
            if (!o.userData.crashOrig) { o.userData.crashOrig = o.geometry; o.geometry = o.geometry.clone(); }
            _m.copy(_rootInv).multiply(o.matrixWorld);          // part -> car
            _inv.copy(_m).invert();                              // car -> part
            _n3.setFromMatrix4(_inv);
            const pos = o.geometry.attributes.position;
            let moved = false;
            for (let i = 0; i < pos.count; i++) {
                _p.fromBufferAttribute(pos, i).applyMatrix4(_m);
                const ex = _p.x - hit.x, ey = (_p.y - hit.y) * 0.6, ez = _p.z - hit.z;
                const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
                if (d >= R) continue;
                const k = (1 - d / R) ** 2;
                // Rumple by where the vertex is (not its index): corners shared by several faces
                // are stored once per face and must all move together, or the panels tear apart
                const qx = Math.round(_p.x * 200), qy = Math.round(_p.y * 200), qz = Math.round(_p.z * 200);
                const h = Math.sin(qx * 12.9898 + qy * 78.233 + qz * 37.719 + seed) * 43758.5453;
                const n = h - Math.floor(h);
                const rumple = 0.6 + 0.8 * n;
                const push = depth * k * rumple;
                _p.x += dir.x * push;
                _p.z += dir.z * push;
                _p.y += push * 0.22 * (n > 0.4 ? 1 : -0.4);
                _p.applyMatrix4(_inv);
                pos.setXYZ(i, _p.x, _p.y, _p.z);
                moved = true;
            }
            if (moved) {
                pos.needsUpdate = true;
                o.geometry.computeVertexNormals();
                o.geometry.computeBoundingSphere();
            }
        });
    }

    /** Breaks the window on the side of `v` nearest (x, z) when the hit is hard enough. */
    _breakGlass(v, x, z, s, ctx) {
        if (!this.glass || s < 0.28 || !v.mesh) return false;
        const fx = -Math.sin(v.yaw || 0), fz = -Math.cos(v.yaw || 0);
        const rx = Math.cos(v.yaw || 0), rz = -Math.sin(v.yaw || 0);
        const dx = x - v.position.x, dz = z - v.position.z;
        const along = dx * fx + dz * fz, side = dx * rx + dz * rz;
        const L = (v.length || 4.5) / 2;
        let which;
        if (Math.abs(along) > L * 0.55) which = along > 0 ? 'front' : 'back';
        else which = side > 0 ? 'right' : 'left';
        // Only a big hit takes the windscreen out (it's laminated); side glass goes easier
        if ((which === 'front' || which === 'back') && s < 0.55) return false;
        try {
            if (!this.glass.isBroken(v, which)) return this.glass.breakWindow(v, which, ctx, false);
        } catch (e) { /* cars without modelled glass */ }
        return false;
    }

    // --------------------------------------------------------------------------------------------
    // Sparks, debris, smoke
    // --------------------------------------------------------------------------------------------
    _sparksAt(point, nx, nz, n) {
        for (let i = 0; i < n && this._sparks.length < 160; i++) {
            const m = new THREE.Mesh(this._sparkGeo, this._sparkMat);
            m.position.copy(point);
            m.position.y = 0.3 + Math.random() * 0.6;
            const tx = -nz, tz = nx;
            const side = (Math.random() - 0.5) * 2;
            const v = new THREE.Vector3(tx * side * 6 + nx * (Math.random() - 0.3) * 3, 1 + Math.random() * 3.5, tz * side * 6 + nz * (Math.random() - 0.3) * 3);
            m.userData.v = v;
            m.userData.life = 0.25 + Math.random() * 0.45;
            m.lookAt(m.position.clone().add(v));
            this.scene.add(m);
            this._sparks.push(m);
        }
    }

    _debrisAt(point, a, b, n) {
        const colors = [a.color, b.color, 0x111111, 0x1a1a1a, 0xdddddd, 0xb33a2a].filter((c) => c !== undefined);
        for (let i = 0; i < n; i++) {
            if (this._debris.length > 70) { const old = this._debris.shift(); this.scene.remove(old); old.material.dispose(); }
            const m = new THREE.Mesh(this._debrisGeo, new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.6, metalness: 0.3 }));
            m.position.copy(point);
            m.scale.set(0.5 + Math.random() * 1.5, 1, 0.5 + Math.random() * 1.5);
            m.userData.v = new THREE.Vector3((Math.random() - 0.5) * 7, 1.5 + Math.random() * 3, (Math.random() - 0.5) * 7);
            m.userData.w = new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10);
            m.userData.life = 40;
            m.castShadow = true;
            this.scene.add(m);
            this._debris.push(m);
        }
    }

    _effects(dt, listener) {
        for (let i = this._sparks.length - 1; i >= 0; i--) {
            const m = this._sparks[i];
            m.userData.life -= dt;
            m.userData.v.y -= 9.8 * dt;
            m.position.addScaledVector(m.userData.v, dt);
            if (m.position.y < 0.02) { m.position.y = 0.02; m.userData.v.y *= -0.3; m.userData.v.x *= 0.5; m.userData.v.z *= 0.5; }
            if (m.userData.life <= 0) { this.scene.remove(m); this._sparks.splice(i, 1); }
        }
        for (let i = this._debris.length - 1; i >= 0; i--) {
            const m = this._debris[i];
            const u = m.userData;
            u.life -= dt;
            if (u.v.lengthSq() > 0.001 || m.position.y > 0.03) {
                u.v.y -= 9.8 * dt;
                m.position.addScaledVector(u.v, dt);
                m.rotation.x += u.w.x * dt; m.rotation.y += u.w.y * dt; m.rotation.z += u.w.z * dt;
                if (m.position.y < 0.025) {
                    m.position.y = 0.025;
                    u.v.multiplyScalar(0.35);
                    u.v.y = Math.abs(u.v.y) > 0.6 ? -u.v.y * 0.4 : 0;
                    u.w.multiplyScalar(0.4);
                    m.rotation.x = 0; m.rotation.z = 0;
                    if (u.v.lengthSq() < 0.05) u.v.set(0, 0, 0);
                }
            }
            if (u.life <= 0) { this.scene.remove(m); m.material.dispose(); this._debris.splice(i, 1); }
        }
        // Smoke from under battered bonnets
        if (!this.smoke) return;
        this._smokeT = (this._smokeT || 0) - dt;
        if (this._smokeT > 0) return;
        this._smokeT = 0.12;
        for (const v of this.track.keys()) {
            const d = v.damage || 0;
            if (d < C.SMOKE_FROM || !v.position) continue;
            if (Math.abs(v.position.x - listener.x) > 120 || Math.abs(v.position.z - listener.z) > 120) continue;
            const fx = -Math.sin(v.yaw || 0), fz = -Math.cos(v.yaw || 0);
            const L = (v.length || 4.5) / 2;
            const o = new THREE.Vector3(v.position.x + fx * (L - 0.7), (v.position.y || 0) + 1.0, v.position.z + fz * (L - 0.7));
            const heavy = d > 1.0;
            this.smoke.spawn(o, new THREE.Vector3(0, 1, 0), heavy ? 2 : 1, { size: heavy ? 0.6 : 0.4, speed: 1.4, opacity: heavy ? 0.75 : 0.45, color: heavy ? 0x2a2a2a : 0x9a9a9a });
        }
    }

    getStats() {
        return { ...this.stats, wrecksNow: this.wrecks.size, dented: this.mounted.size, sparks: this._sparks.length, debris: this._debris.length };
    }
}
