/**
 * js/game/gunMotion.js
 *
 * How a gun moves in your hands (the first-person viewmodel in game.html): carried at the hip with
 * a walking bob, swung low and canted across the body at a sprint, raised to the eye to aim, trailing
 * the mouse and leaning into a strafe, kicking on a shot. Every part rides on springs, and heavier
 * guns are slower and swing more. Also the choreography of handling it:
 * - reloads (`reloadPlan` / `reloadPose`): tilt the gun, drop the magazine, bring the new one up and
 *   slap it home, rack the slide or charging handle when it ran empty; or shell by shell
 * - switching weapons (`startSwitch`): the one in hand is lowered out of sight, the next one drawn
 *   and brought up with a little overshoot
 *
 * game.html feeds it the walking state each frame and applies the pose to the gun's viewmodel
 * (named parts from guns.js buildGunModel: gun_mag, gun_slide, gun_bolt, gun_rocket).
 */

export const GUN_MOTION = {
    HIP: [0.21, -0.21, -0.36],
    ADS: [0, -0.135, -0.36],
    SPRING_K: 260,          // stiffness of the light guns' springs (heavy ones get less)
    SPRING_DAMP: 2 * 0.82,  // damping ratio * 2
    SPRINT_IN: 5.5,         // 1/s into the sprint pose
    SPRINT_OUT: 9,          // 1/s back out of it (firing / aiming gets the gun up fast)
    SWAY_YAW: 0.012,        // gun trailing the mouse: rad per rad/s of turning
    SWAY_MAX: 0.12
};

/** 0 (a pistol) .. 1 (a minigun): slows the springs, deepens the swing, lengthens draws. */
export function gunWeight(gun) {
    if (!gun) return 0.3;
    const c = gun.category;
    if (c === 'Pistol') return 0.15;
    if (c === 'SMG') return 0.35;
    if (c === 'Rifle') return 0.55;
    if (c === 'Shotgun') return 0.6;
    if (c === 'Sniper') return 0.7;
    if (c === 'Heavy') return gun.mode === 'spin' ? 1 : 0.85;
    return 0.4;
}

/**
 * The stages of a magazine-style reload (seconds from the start): `out` the old magazine drops,
 * `seat` the new one is slapped home (the rounds go in then), `rack` the slide / charging handle /
 * bolt is worked (only after running dry), `done`. Shell-by-shell guns (reloadOne) don't use this.
 */
export function reloadPlan(gun, empty) {
    const T = gun.reloadTime || 1.5;
    // A reload with one still chambered skips racking it and is quicker
    const total = empty ? T : T * 0.8;
    const out = total * (empty ? 0.16 : 0.2);
    const seat = total * (empty ? 0.62 : 0.78);
    const rack = empty ? total * 0.8 : -1;
    return { total, out, seat, rack, done: total, empty, kind: gun.model && gun.model.family === 'launcher' ? 'rocket' : 'mag' };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const span = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
// Out, a little past, and back (draws)
const backOut = (x) => { x = clamp(x, 0, 1); const s = 1.7; return 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2); };

/** Damped spring per channel: position x y z, rotation x y z. */
class Springs {
    constructor(n) {
        this.v = new Float32Array(n);
        this.x = new Float32Array(n);
    }
    step(target, k, c, dt) {
        // (sub-stepped: stable at long frames)
        const n = Math.max(1, Math.ceil(dt / (1 / 120)));
        const h = dt / n;
        const d = c * Math.sqrt(k);
        for (let s = 0; s < n; s++) {
            for (let i = 0; i < this.x.length; i++) {
                const a = (target[i] - this.x[i]) * k - this.v[i] * d;
                this.v[i] += a * h;
                this.x[i] += this.v[i] * h;
            }
        }
    }
}

export class GunMotion {
    constructor() {
        this.springs = new Springs(6);
        this.sprint = 0;          // 0..1 in the sprint carry
        this.time = 0;
        this.sw = null;           // a weapon switch in progress
        this._target = new Float32Array(6);
        this.lastFire = -1;
        this.pose = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, mag: null, slide: 0, bolt: 0, rocket: null, switchShow: 'to' };
    }

    /** The gun fired: kick the springs (on top of game.html's own recoil). */
    kick(gun, ads = 0) {
        const w = gunWeight(gun);
        const r = (gun && gun.recoil) || 0.03;
        const s = this.springs.v;
        s[2] += (2.2 + r * 30) * (1 - 0.5 * ads);           // back into the shoulder
        s[3] += (3 + r * 60) * (1 - 0.4 * ads) * (1.2 - w * 0.5);   // muzzle up
        s[5] += (Math.random() - 0.5) * (2 + r * 30);          // a twist
        s[4] += (Math.random() - 0.5) * (1 + r * 10);
        this.lastFire = this.time;
    }

    /** A shell pushed into the tube / a round into the magazine. */
    pushShell() {
        this.springs.v[1] -= 0.6;
        this.springs.v[2] -= 0.4;
        this.springs.v[3] -= 1.2;
    }

    /**
     * Starts putting the held thing away for another. `fromGun` / `toGun` are gun defs (or null for
     * fists and the rest). Returns the switch; game.html swaps what's shown when `sw.swapped` flips.
     */
    startSwitch(fromGun, toGun) {
        const wa = gunWeight(fromGun), wb = gunWeight(toGun);
        const lower = fromGun ? 0.14 + 0.16 * wa : 0.12;
        const raise = toGun ? 0.24 + 0.3 * wb : 0.2;
        let t = 0;
        // Changing your mind mid-draw: put this one away from how far up it got
        if (this.sw && this.sw.swapped) t = lower * (1 - Math.min(1, (this.sw.t - this.sw.lower) / this.sw.raise));
        else if (this.sw) t = Math.min(this.sw.t, lower);
        this.sw = { t, lower, raise, swapped: false, toGun, fromGun };
        return this.sw;
    }

    get switching() { return !!this.sw; }
    /** Brought up far enough to shoot. */
    get ready() { return !this.sw || (this.sw.swapped && this.sw.t - this.sw.lower > this.sw.raise * 0.8); }

    /**
     * s: { dt, gun, speed (m/s), runK (0..1 sprinting), phase (stride, radians), side (m/s to the
     *      right), yawRate / pitchRate (rad/s of looking), ads (0..1), reload ({ plan, t } |
     *      { shell: true, t } | null), cycle (0..1 pump / bolt), firing (trigger held) }
     */
    update(s) {
        const dt = Math.min(0.05, s.dt);
        this.time += dt;
        const t = this.time;
        const w = gunWeight(s.gun);
        const ads = s.ads;
        const hip = 1 - ads;
        const T = this._target;
        const H = GUN_MOTION.HIP, A = GUN_MOTION.ADS;
        T[0] = H[0] * hip + A[0] * ads;
        T[1] = H[1] * hip + A[1] * ads;
        T[2] = H[2] * hip + A[2] * ads;
        T[3] = 0; T[4] = 0; T[5] = 0;

        // ---- Sprinting: the gun swings low and across the body (not while aiming, firing, reloading)
        const recentlyFired = t - this.lastFire < 0.45;
        const wantSprint = s.runK > 0.5 && s.speed > 4 && ads < 0.2 && !recentlyFired && !s.firing && !s.reload;
        this.sprint += ((wantSprint ? 1 : 0) - this.sprint) * Math.min(1, dt * (wantSprint ? GUN_MOTION.SPRINT_IN : GUN_MOTION.SPRINT_OUT));
        const sp = smooth(this.sprint);
        const heavy = 0.7 + w * 0.6;
        // (kept on its own side of the screen: the HUD sits in the middle of the bottom edge)
        T[0] += 0.015 * sp;
        T[1] += -0.012 * sp * heavy;
        T[2] += 0.02 * sp;
        T[3] += -0.3 * sp;
        T[4] += 0.42 * sp;
        T[5] += 0.32 * sp;

        // ---- Steps: a figure-eight at the hip, a heavier bounce and swing at a run, almost nothing aimed
        const ph = s.phase;
        const moveK = clamp(s.speed / 1.6, 0, 1) * (1 - 0.88 * ads);
        const runBob = smooth(this.sprint) * clamp(s.speed / 6, 0, 1.3);
        const walkAmp = (0.007 + 0.004 * w) * moveK * (1 - runBob);
        T[0] += Math.sin(ph) * walkAmp;
        T[1] += -Math.abs(Math.cos(ph)) * walkAmp * 0.9;
        T[5] += Math.sin(ph) * 0.018 * moveK * (1 - runBob);
        T[3] += Math.cos(ph * 2) * 0.006 * moveK;
        // (running: each footfall drops the gun and swings it side to side)
        T[0] += Math.sin(ph) * 0.018 * heavy * runBob;
        T[1] += -Math.abs(Math.cos(ph)) * 0.02 * heavy * runBob;
        T[4] += Math.sin(ph) * 0.06 * runBob;
        T[5] += Math.sin(ph) * 0.08 * runBob;
        T[3] += Math.cos(ph * 2) * 0.035 * runBob;

        // ---- Breathing when still
        const still = 1 - clamp(s.speed / 1.2, 0, 1);
        T[1] += Math.sin(t * 1.5) * 0.0025 * still * (1 - 0.6 * ads);
        T[3] += Math.sin(t * 1.5 - 0.6) * 0.006 * still * (1 - 0.7 * ads);
        T[4] += Math.sin(t * 0.7) * 0.004 * still * hip;

        // ---- Trailing the mouse and leaning into a strafe (the gun has weight)
        const swayK = (1 - 0.75 * ads) * (0.8 + w * 0.6);
        const yawS = clamp(s.yawRate * GUN_MOTION.SWAY_YAW, -GUN_MOTION.SWAY_MAX, GUN_MOTION.SWAY_MAX) * swayK;
        const pitchS = clamp(s.pitchRate * GUN_MOTION.SWAY_YAW, -GUN_MOTION.SWAY_MAX, GUN_MOTION.SWAY_MAX) * swayK;
        T[4] += yawS;
        T[0] += -yawS * 0.25;
        T[5] += yawS * 0.5;
        T[3] += -pitchS;
        T[1] += -pitchS * 0.2;
        const lean = clamp(s.side / 5, -1, 1) * (1 - 0.6 * ads);
        T[5] += -lean * 0.07;
        T[0] += lean * 0.012;

        // ---- Reloading / working the action
        const P = this.pose;
        P.mag = null; P.slide = 0; P.bolt = 0; P.rocket = null;
        if (s.reload) this._reload(s.reload, T, P, w);
        if (s.cycle > 0) {
            // Pump / bolt: the gun rolls and the support hand works it
            const c = s.cycle;
            T[5] += 0.22 * c;
            T[1] += -0.012 * c;
            T[2] += 0.02 * c;
            T[3] += 0.05 * c;
            P.bolt = c;
        }

        // ---- Springs (heavier: softer and slower)
        const k = GUN_MOTION.SPRING_K * (1 - w * 0.45) * (s.reload ? 1.3 : 1);
        this.springs.step(T, k, GUN_MOTION.SPRING_DAMP, dt);
        const x = this.springs.x;
        P.px = x[0]; P.py = x[1]; P.pz = x[2];
        P.rx = x[3]; P.ry = x[4]; P.rz = x[5];

        // ---- Switching: lower out of view, then draw the next one up
        P.switchShow = 'to';
        P.sw = 0;
        const sw = this.sw;
        if (sw) {
            sw.t += dt;
            let down;
            if (sw.t < sw.lower) {
                down = smooth(sw.t / sw.lower);
                P.switchShow = 'from';
            } else {
                if (!sw.swapped) sw.swapped = true;
                const r = (sw.t - sw.lower) / sw.raise;
                down = 1 - backOut(r);
                if (r >= 1) this.sw = null;
            }
            P.sw = down;
            // (a long gun comes up canted, a pistol straight)
            const cant = sw.swapped ? 0.35 + 0.5 * gunWeight(sw.toGun) : 0.3;
            P.py -= 0.3 * down;
            P.pz += 0.05 * down;
            P.rx -= 0.9 * down;
            P.rz += cant * down;
            P.px -= 0.04 * down;
        }
        return P;
    }

    _reload(r, T, P, w) {
        if (r.shell) {
            // Shell by shell: rolled over to show the loading port, muzzle a little up
            const k = smooth(r.t / 0.25);
            T[5] += 0.6 * k;
            T[3] += 0.18 * k;
            T[1] += 0.06 * k;
            T[0] += -0.05 * k;
            T[2] += 0.03 * k;
            return;
        }
        const pl = r.plan, t = r.t;
        const back = pl.empty ? pl.rack : pl.seat;
        // Brought up and in, tilted to bring the magazine well round, held there, back once it's done
        const tilt = smooth(t / (pl.out * 0.9)) * (1 - smooth(span(t, back + 0.05, pl.done)));
        T[5] += (0.45 - 0.15 * w) * tilt;
        T[3] += 0.1 * tilt;
        T[0] += -0.06 * tilt;
        T[1] += 0.07 * tilt;
        T[2] += 0.04 * tilt;
        // Reaching down for the next magazine: the gun dips a little
        const reach = Math.sin(span(t, pl.out, pl.seat) * Math.PI);
        T[1] += -0.02 * reach;
        T[3] += -0.05 * reach;
        if (pl.kind === 'rocket') {
            // A rocket slid into the front of the tube
            const k = span(t, pl.out, pl.seat);
            P.rocket = t < pl.out ? 0 : { z: -0.35 * (1 - smooth(k)), y: -0.12 * (1 - smooth(k)) };
            return;
        }
        // The old magazine drops away; the new one comes up from below and is slapped in
        if (t < pl.out) P.mag = { y: 0, rx: 0, visible: true };
        else if (t < pl.out + 0.35) {
            // (slides out, then drops)
            const f = t - pl.out;
            P.mag = { y: -0.15 * Math.min(f, 0.08) / 0.08 * 0.3 - 0.5 * 6 * Math.max(0, f - 0.08) ** 2, rx: f * 1.5, visible: true };
        } else {
            const k = span(t, (pl.out + 0.35 + pl.seat) / 2, pl.seat);
            P.mag = { y: -0.22 * (1 - smooth(k)), rx: 0.4 * (1 - smooth(k)), visible: t > (pl.out + 0.35 + pl.seat) / 2 };
        }
        // Racking it after an empty magazine: pulled back sharply, let fly forward
        if (pl.empty && pl.rack > 0) {
            const k = span(t, pl.rack - 0.12, pl.rack);
            const rel = span(t, pl.rack, pl.rack + 0.05);
            P.slide = k * (1 - rel);
            const twist = Math.sin(span(t, pl.rack - 0.18, pl.rack + 0.15) * Math.PI);
            T[4] += 0.25 * twist;
            T[5] += -0.25 * twist;
        }
    }

    /** The slap of a magazine seating / the action snapping forward. */
    jolt(amount = 1) {
        const v = this.springs.v;
        v[1] += 0.5 * amount;
        v[3] += 2.2 * amount;
        v[5] += (Math.random() - 0.5) * 1.5 * amount;
    }
}
