/**
 * js/game/brawl.js
 *
 * The player's side of a fist fight (game.html wires it to input, the viewmodel and pedestrians.js):
 *   - PUNCH_MOVES: jab, cross, hook, uppercut and the stomp. Each move winds up, strikes and recovers;
 *     the blow lands partway through the strike.
 *   - Brawler: picks the next move of a combo (jab, cross, hook, uppercut, with some variety), buffers a
 *     click made during the recovery, steps the move, and poses the two fists (guard sway, breathing,
 *     walking bob, lag behind the mouse, the move itself) and the stomping leg, plus a camera kick.
 *   - findWallAhead: the nearest solid wall along a direction (spatial grid static boxes), for pinning
 *     someone against it.
 *
 * Fist poses are offsets in the hands viewmodel's own space (built with the lead fist on +X; game.html
 * mirrors it for left-handed Kaj). `sx` is +1 for the lead fist, -1 for the rear one, so "towards
 * the middle" is -sx.
 */

export const PUNCH_MOVES = {
    //            hand    windup strike recover  damage    reach  knockdown
    jab: { hand: 'lead', w: 0.06, s: 0.08, r: 0.16, dmg: [13, 17], reach: 1.8, knock: 0.02 },
    cross: { hand: 'rear', w: 0.10, s: 0.09, r: 0.20, dmg: [21, 27], reach: 1.75, knock: 0.07 },
    hook: { hand: 'lead', w: 0.14, s: 0.11, r: 0.24, dmg: [25, 31], reach: 1.6, knock: 0.18 },
    uppercut: { hand: 'rear', w: 0.16, s: 0.11, r: 0.26, dmg: [29, 37], reach: 1.55, knock: 0.3 },
    stomp: { hand: 'leg', w: 0.22, s: 0.10, r: 0.30, dmg: [26, 34], reach: 1.6, knock: 0 }
};

const COMBO = ['jab', 'cross', 'hook', 'uppercut'];
const COMBO_WINDOW = 0.55;   // seconds after a move ends that a click still continues the combo

/** The next move of a combo after `prev` (null = fresh). `rand` in [0, 1). */
export function comboNext(prev, sinceEnd, rand = Math.random()) {
    if (!prev || prev === 'stomp' || sinceEnd > COMBO_WINDOW) return rand < 0.15 ? 'cross' : 'jab';
    if (prev === 'jab' && rand < 0.25) return 'jab';              // double jab
    if (prev === 'cross' && rand < 0.2) return 'uppercut';        // straight to the uppercut
    const i = COMBO.indexOf(prev);
    return COMBO[(i + 1) % COMBO.length];
}

// Wind-up pose (W) and strike pose (H) for the striking fist: [x, y, z] position and [rx, ry, rz]
// rotation offsets, functions of the side sign sx. `off` is what the other fist does, `twist` turns the
// whole pair (shoulders rotating into it), `kick` the camera at the moment of impact [yaw, pitch, roll].
const SHAPES = {
    jab: (sx) => ({
        W: [sx * 0.01, -0.01, 0.05, 0.1, 0, 0], H: [-sx * 0.07, 0.06, -0.31, -0.15, 0, -sx * 0.55],
        off: [0, 0.02, 0.04, 0.1, 0, 0], twist: 0.05, arc: 0, kick: [-sx * 0.006, 0.004, sx * 0.01]
    }),
    cross: (sx) => ({
        W: [sx * 0.03, -0.02, 0.07, 0.15, 0, sx * 0.2], H: [-sx * 0.12, 0.07, -0.34, -0.2, sx * 0.25, -sx * 0.95],
        off: [-sx * 0.05, 0.05, 0.07, 0.3, 0, 0], twist: 0.11, arc: 0, kick: [-sx * 0.012, 0.006, sx * 0.02]
    }),
    hook: (sx) => ({
        W: [sx * 0.13, 0.0, 0.03, 0, sx * 0.5, sx * 0.3], H: [-sx * 0.15, 0.09, -0.16, 0, sx * 1.2, -sx * 1.4],
        off: [-sx * 0.04, 0.05, 0.06, 0.3, 0, 0], twist: 0.18, arc: -0.1, kick: [-sx * 0.03, 0.0, sx * 0.045]
    }),
    uppercut: (sx) => ({
        W: [sx * 0.02, -0.13, 0.04, 0.5, 0, 0], H: [-sx * 0.11, 0.21, -0.2, -1.1, 0, -sx * 0.3],
        off: [-sx * 0.03, 0.04, 0.06, 0.3, 0, 0], twist: 0.1, arc: 0, kick: [0, 0.03, sx * 0.015]
    })
};

const ease = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - (1 - t) * (1 - t);

export class Brawler {
    constructor() {
        this.act = null;          // { move, sx, t, dur, hitAt, hit, speed, pinned }
        this.last = null;         // last move name
        this.sinceEnd = 99;
        this.queued = null;       // a click made during the recovery: { opts }
        this.time = 0;
        this.kick = [0, 0, 0];    // camera kick (decays)
        this._kickVel = [0, 0, 0];
        this.lagX = 0;            // fists trail the mouse
        this.lagY = 0;
        this.rand = Math.random;  // (tests pin it)
        this.hitStop = 0;         // seconds the swing hangs at the moment of contact
        this.lunge = 0;           // metres to step in (game.html takes it with takeLunge)
        // The fists follow their poses on springs (a touch under-damped): they whip past and settle
        this._sp = new Float32Array(14);
        this._sv = new Float32Array(14);
        this._spInit = false;
    }

    /** Distance to step forward into the punch since last asked. */
    takeLunge() {
        const l = this.lunge;
        this.lunge = 0;
        return l;
    }

    /** Called when a swing finds nothing: it over-reaches and takes longer to pull back. */
    whiff() {
        const a = this.act;
        if (!a || a.whiff || a.move === 'stomp') return;
        a.whiff = true;
        a.dur += (PUNCH_MOVES[a.move].r * 0.35) / a.speed;
    }

    get busy() {
        return !!this.act;
    }

    /** Mouse movement this frame (pixels), for the fists' lag. */
    look(dx, dy) {
        this.lagX = Math.max(-1, Math.min(1, this.lagX + dx * 0.004));
        this.lagY = Math.max(-1, Math.min(1, this.lagY + dy * 0.004));
    }

    /**
     * A click. opts: { stomp: bool (a downed person at your feet), pinned: bool (faster, harder),
     * rearBusy: bool (one hand holds someone: everything comes from the lead) }.
     * Returns the move started (or queued), or null.
     */
    request(opts = {}) {
        if (this.act) {
            const a = this.act;
            // Late in the swing a click is remembered and thrown as soon as this one finishes
            if (a.t > a.hitAt) {
                this.queued = opts;
                return 'queued';
            }
            return null;
        }
        return this._start(opts);
    }

    _start(opts) {
        let name;
        if (opts.stomp) name = 'stomp';
        else name = comboNext(this.last, this.sinceEnd, this.rand());
        const M = PUNCH_MOVES[name];
        let hand = M.hand;
        if (opts.rearBusy && hand === 'rear') hand = 'lead';
        // No two punches alike: a little higher or lower, a different angle, quicker or lazier
        const r = this.rand;
        const vary = { dx: (r() - 0.5) * 0.035, dy: (r() - 0.5) * 0.05, rz: (r() - 0.5) * 0.35, sp: 0.88 + r() * 0.24 };
        const speed = (opts.pinned ? 1.3 : 1) * (name === 'stomp' ? 1 : vary.sp);
        const dur = (M.w + M.s + M.r) / speed;
        this.act = {
            move: name, hand, sx: hand === 'rear' ? -1 : 1, t: 0, speed, dur, vary,
            hitAt: (M.w + M.s * 0.6) / speed, hit: false, pinned: !!opts.pinned, opts, stepped: false,
            step: { jab: 0.04, cross: 0.12, hook: 0.14, uppercut: 0.1, stomp: 0 }[name] || 0
        };
        this.last = name;
        return name;
    }

    /** Steps time; returns the move whose blow lands this frame (or null). */
    update(dt) {
        this.time += dt;
        this.lagX *= Math.exp(-dt * 7);
        this.lagY *= Math.exp(-dt * 7);
        // camera kick: a stiff spring back to rest
        for (let i = 0; i < 3; i++) {
            this._kickVel[i] += (-160 * this.kick[i] - 18 * this._kickVel[i]) * Math.min(dt, 1 / 30);
            this.kick[i] += this._kickVel[i] * Math.min(dt, 1 / 30);
        }
        let landed = null;
        const a = this.act;
        if (!a) {
            this.sinceEnd += dt;
            return null;
        }
        // Hit-stop: the swing hangs for a beat when it lands
        let adt = dt;
        if (this.hitStop > 0) {
            this.hitStop -= dt;
            adt = dt * 0.1;
        }
        a.t += adt;
        // Weight goes into it as the strike starts: a half step in (not while holding someone)
        if (!a.stepped && a.t * a.speed >= PUNCH_MOVES[a.move].w) {
            a.stepped = true;
            if (!a.opts.rearBusy) this.lunge += a.step;
        }
        if (!a.hit && a.t >= a.hitAt) {
            a.hit = true;
            landed = a;
            const sh = SHAPES[a.move];
            if (sh) {
                const k = sh(a.sx).kick;
                for (let i = 0; i < 3; i++) this._kickVel[i] += k[i] * 22;
            } else if (a.move === 'stomp') {
                this._kickVel[1] -= 0.9;
            }
        }
        if (a.t >= a.dur) {
            this.act = null;
            this.sinceEnd = 0;
            if (this.queued) {
                const q = this.queued;
                this.queued = null;
                this._start(q);
            }
        }
        return landed;
    }

    /** The moment the blow lands also gives a little shove of the camera (call when it connects). */
    impact(strength = 1) {
        this._kickVel[1] -= 0.25 * strength;
        this.hitStop = Math.max(this.hitStop, 0.045 + 0.03 * strength);
    }

    /** 0..1 phases of the current move: [windupAmount, strikeAmount] for blending poses. */
    _phase(a) {
        const M = PUNCH_MOVES[a.move];
        const t = a.t * a.speed;
        if (t < M.w) return { wind: ease(t / M.w), hit: 0, u: 0 };
        if (t < M.w + M.s) {
            const u = (t - M.w) / M.s;
            return { wind: 1 - easeOut(u), hit: easeOut(u), u };
        }
        const r = Math.min(1, (t - M.w - M.s) / M.r);
        return { wind: 0, hit: 1 - ease(r), u: 1 };
    }

    /**
     * Pose of both fists and the leg. state: { moving (0..1), blocking (0..1),
     * grip ('none'|'drag'|'pin'|'neck'|'reach'|'collar'|'mount') }.
     * Returns { lead: [x,y,z,rx,ry,rz], rear: [...], twist, leg: null | { y, z, rx } } as offsets.
     */
    pose(state = {}) {
        const t = this.time;
        const lead = [0, 0, 0, 0, 0, 0], rear = [0, 0, 0, 0, 0, 0];
        // Guard: breathing, a loose figure-eight sway, the two fists out of step
        const sway = 1 - (state.blocking || 0) * 0.6;
        lead[0] += Math.sin(t * 1.3) * 0.009 * sway;
        lead[1] += Math.sin(t * 2.6) * 0.006 * sway + Math.sin(t * 1.9) * 0.004;
        lead[2] += Math.sin(t * 1.1 + 1) * 0.008 * sway;
        lead[5] += Math.sin(t * 1.3) * 0.05 * sway;
        rear[0] += Math.sin(t * 1.3 + 2.2) * 0.008 * sway;
        rear[1] += Math.sin(t * 2.6 + 1.7) * 0.006 * sway + Math.sin(t * 1.7 + 0.4) * 0.004;
        rear[2] += Math.sin(t * 1.05 + 2.5) * 0.007 * sway;
        rear[5] += Math.sin(t * 1.3 + 2.2) * 0.05 * sway;
        // Standing your ground: a boxer's bounce on the balls of the feet
        const mv = state.moving || 0;
        const bounce = Math.sin(t * 5.2) * 0.006 * (1 - mv) * sway;
        lead[1] += bounce;
        rear[1] += bounce;
        // Walking: fists rise and fall with the steps, a beat apart
        if (mv > 0) {
            const ph = state.walkPhase || 0;
            lead[1] += Math.sin(ph) * 0.012 * mv;
            rear[1] += Math.sin(ph + Math.PI) * 0.012 * mv;
            lead[0] += Math.cos(ph) * 0.006 * mv;
            rear[0] += Math.cos(ph) * 0.006 * mv;
        }
        // Lag behind the mouse
        for (const f of [lead, rear]) {
            f[0] += -this.lagX * 0.035;
            f[1] += this.lagY * 0.025;
            f[5] += this.lagX * 0.12;
        }
        let twist = Math.sin(t * 1.3) * 0.02;
        let leg = null;
        const a = this.act;
        if (a && a.move === 'stomp') {
            const ph = this._phase(a);
            // Leg rises into view, then drives down out of it; the fists pull in for balance
            // (the wind-up amount falls back to 0 through the strike, which is the leg driving down)
            // lifted into view (towards you), then driven down and away into the ground
            leg = { y: -0.95 + ph.wind * 0.68 + ph.hit * 0.45, z: -0.3 - ph.wind * 0.2 - ph.hit * 0.65, rx: 0.15 * ph.wind - 0.2 * ph.hit };
            for (const f of [lead, rear]) {
                f[1] += 0.04 * (ph.wind + ph.hit);
                f[2] += 0.05 * (ph.wind + ph.hit);
            }
        } else if (a) {
            const ph = this._phase(a);
            const sh = SHAPES[a.move](a.sx);
            const hand = a.sx > 0 ? lead : rear;
            const other = a.sx > 0 ? rear : lead;
            const v = a.vary;
            const reach = a.whiff ? 1.15 : 1;
            for (let i = 0; i < 6; i++) hand[i] += sh.W[i] * ph.wind + sh.H[i] * ph.hit * (i === 2 ? reach : 1);
            hand[0] += v.dx * ph.hit;
            hand[1] += v.dy * ph.hit - (a.whiff ? 0.035 * ph.hit : 0);   // a miss sags at the end
            hand[5] += v.rz * ph.hit;
            hand[2] += sh.arc * Math.sin(Math.PI * ph.u) * (ph.hit > 0 ? 1 : 0);
            for (let i = 0; i < 6; i++) other[i] += sh.off[i] * Math.max(ph.wind, ph.hit);
            twist += sh.twist * a.sx * (ph.hit - ph.wind * 0.4) * (a.whiff ? 1.3 : 1);
        }
        // Holding someone: the rear fist has them by the collar
        if (state.grip === 'pin') {
            // (forearm angled down and away, so it reads as an arm reaching out, not a slab in your face)
            rear[0] = 0.1 + rear[0] * 0.2;
            rear[1] = -0.04 + rear[1] * 0.2;
            rear[2] = -0.15 + rear[2] * 0.2;
            rear[3] = 0.45;
            rear[5] = -0.3;
        } else if (state.grip === 'neck') {
            // Arm out straight, hand round their throat at arm's length
            rear[0] = 0.13 + rear[0] * 0.2;
            rear[1] = 0.1 + rear[1] * 0.2;
            rear[2] = -0.34 + rear[2] * 0.2;
            rear[3] = -0.25;
            rear[5] = -0.15;
        } else if (state.grip === 'drag') {
            rear[0] = -0.12;
            rear[1] = -0.2;
            rear[2] = 0.18;
            rear[3] = 0.9;
        } else if (state.grip === 'reach') {
            // Diving at them: both arms thrown out ahead, wide, to wrap them up
            lead.splice(0, 6, -0.03, 0.07, -0.22, -0.45, 0, 0.35);
            rear.splice(0, 6, 0.03, 0.07, -0.22, -0.45, 0, -0.35);
        } else if (state.grip === 'collar') {
            // Taking them down: both fists balled in their shirt, riding them to the ground
            lead.splice(0, 6, -0.08, -0.07, -0.14, 0.55, 0, 0.15);
            rear.splice(0, 6, 0.08, -0.07, -0.07, 0.55, 0, -0.15);
        } else if (state.grip === 'mount') {
            // On top of them: one fist keeps hold of the collar, the other does the hitting
            rear[0] = 0.07 + rear[0] * 0.2;
            rear[1] = -0.08 + rear[1] * 0.2;
            rear[2] = -0.06 + rear[2] * 0.2;
            rear[3] = 0.6;
            rear[5] = -0.15;
        }
        return this._spring({ lead, rear, twist, leg }, state.dt || 1 / 60);
    }

    /** Fists chase their target pose on stiff, slightly bouncy springs. */
    _spring(P, dt) {
        const tgt = [...P.lead, ...P.rear, P.twist, 0];
        const x = this._sp, v = this._sv;
        if (!this._spInit) {
            x.set(tgt);
            this._spInit = true;
        }
        const k = 1100, c = 37;   // about 5 Hz, damping ratio 0.55
        const n = Math.max(1, Math.ceil(Math.min(dt, 0.1) / (1 / 240)));
        const h = Math.min(dt, 0.1) / n;
        for (let s = 0; s < n; s++) {
            for (let i = 0; i < 13; i++) {
                v[i] += (k * (tgt[i] - x[i]) - c * v[i]) * h;
                x[i] += v[i] * h;
            }
        }
        return { lead: Array.from(x.subarray(0, 6)), rear: Array.from(x.subarray(6, 12)), twist: x[12], leg: P.leg };
    }
}

/**
 * The nearest solid wall from (x, z) along (fx, fz) within maxDist, at chest height y.
 * grid: SpatialGrid (static boxes). Returns { x, z, nx, nz, dist } (contact point on the wall face and
 * its outward normal) or null.
 */
export function findWallAhead(grid, x, z, fx, fz, y, maxDist = 2.5, out = []) {
    if (!grid) return null;
    const len = Math.hypot(fx, fz) || 1;
    fx /= len;
    fz /= len;
    grid.queryRadius(x + fx * maxDist * 0.5, z + fz * maxDist * 0.5, maxDist * 0.5 + 1, out, 'STATIC');
    let best = null;
    for (const it of out) {
        if (!it || it.minX === undefined) continue;
        const b = it.box;
        if (b && b.min && b.max && (b.max.y < y + 0.4 || b.min.y > y + 1.2)) continue; // a kerb, or overhead
        if (b && b.max && b.max.y - Math.max(b.min.y, y) < 1.0) continue;               // too low to pin someone to
        // Slab test of the ray against the box in XZ
        let t0 = 0, t1 = maxDist, nx = 0, nz = 0;
        let ok = true;
        for (const [o, d, lo, hi, ax] of [[x, fx, it.minX, it.maxX, 'x'], [z, fz, it.minZ, it.maxZ, 'z']]) {
            if (Math.abs(d) < 1e-8) {
                if (o < lo || o > hi) { ok = false; break; }
                continue;
            }
            let ta = (lo - o) / d, tb = (hi - o) / d;
            let n = -1;
            if (ta > tb) { const tt = ta; ta = tb; tb = tt; n = 1; }
            if (ta > t0) {
                t0 = ta;
                if (ax === 'x') { nx = n; nz = 0; } else { nz = n; nx = 0; }
            }
            if (tb < t1) t1 = tb;
            if (t0 > t1) { ok = false; break; }
        }
        if (!ok || (nx === 0 && nz === 0)) continue;   // starting inside a box: no face to hit
        if (!best || t0 < best.dist) best = { x: x + fx * t0, z: z + fz * t0, nx, nz, dist: t0 };
    }
    return best;
}
