/**
 * js/game/footMotion.js
 *
 * How walking feels in first person (game.html updatePlayer drives it):
 *   - velocity, not teleporting: you build up to speed and coast to a stop, turn around a bit quicker
 *     than you start, and diagonal input is no longer ~41% faster
 *   - a stride: the step phase advances with the distance actually covered, so the head bob, the
 *     weight shifting from foot to foot and the footstep sounds all follow the feet (a step lands every
 *     half cycle; walking into a wall stops the steps)
 *   - the camera bobs (dipping on each heel strike), sways over the planted foot, leans into strafes
 *     and quick turns, nods when you set off or pull up, and breathes when you stand still
 */

export const FOOT_CONFIG = Object.freeze({
    ACCEL: 30,          // m/s^2 getting up to speed
    RUN_ACCEL: 24,      // ... into a sprint (slower to build)
    DECEL: 34,          // letting go of the keys
    REVERSE: 46,        // changing direction (counter-strafing)
    STRIDE: 2.6,        // metres per step (matches the old footstep cadence at both speeds)
    BOB_WALK: 0.045,    // heel-strike dip of the head (m)
    BOB_RUN: 0.075,
    SWAY: 0.022,        // side to side over the planted foot (m)
    ROLL_SWAY: 0.007,   // the head rolls with the sway (rad)
    STRAFE_LEAN: 0.0035, // rad per m/s of sideways speed
    TURN_LEAN: 0.006,   // rad per rad/s of turning
    NOD: 0.0018         // rad per m/s^2 of forward acceleration
});

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class FootMotion {
    constructor() {
        this.vx = 0;
        this.vz = 0;
        this.phase = 0;        // step phase (radians; a step lands every PI)
        this.time = 0;
        this.speed = 0;        // current ground speed (m/s)
        this.runK = 0;         // 0 walking .. 1 sprinting (smoothed)
        this.cam = { y: 0, side: 0, roll: 0, pitch: 0 };
        this._lean = 0;
        this._turn = 0;
        this._nod = 0;
        this._lastYaw = null;
        this._lastFwd = 0;
    }

    /**
     * Velocity for this step. input: { fwd, side (-1..1 each), yaw (camera), speed (m/s at full
     * input), running }. Returns { dx, dz } to try moving by (game.html resolves collisions).
     */
    update(dt, input) {
        const C = FOOT_CONFIG;
        this.time += dt;
        const fx = -Math.sin(input.yaw), fz = -Math.cos(input.yaw);
        const rx = Math.cos(input.yaw), rz = -Math.sin(input.yaw);
        let wx = fx * (input.fwd || 0) + rx * (input.side || 0);
        let wz = fz * (input.fwd || 0) + rz * (input.side || 0);
        const len = Math.hypot(wx, wz);
        if (len > 1) { wx /= len; wz /= len; }   // diagonals are no faster
        const tx = wx * input.speed, tz = wz * input.speed;
        // Accelerate towards the wanted velocity: faster when turning round or stopping
        const dvx = tx - this.vx, dvz = tz - this.vz;
        const dv = Math.hypot(dvx, dvz);
        if (dv > 1e-6) {
            const reversing = this.vx * tx + this.vz * tz < 0;
            const rate = len < 1e-3 ? C.DECEL : reversing ? C.REVERSE : (input.running ? C.RUN_ACCEL : C.ACCEL);
            const step = Math.min(dv, rate * dt);
            this.vx += (dvx / dv) * step;
            this.vz += (dvz / dv) * step;
        }
        this.runK += ((input.running && len > 0.1 ? 1 : 0) - this.runK) * Math.min(1, dt * 4);
        // Leaning: into strafes and quick turns
        const lat = this.vx * rx + this.vz * rz;
        let yawRate = 0;
        if (this._lastYaw !== null) {
            let d = input.yaw - this._lastYaw;
            d = Math.atan2(Math.sin(d), Math.cos(d));
            yawRate = d / Math.max(dt, 1e-4);
        }
        this._lastYaw = input.yaw;
        const k = Math.min(1, dt * 7);
        this._lean += (clamp(-lat * C.STRAFE_LEAN, -0.035, 0.035) - this._lean) * k;
        this._turn += (clamp(yawRate * C.TURN_LEAN * Math.min(1, this.speed / 3), -0.025, 0.025) - this._turn) * Math.min(1, dt * 5);
        // Nod when setting off or pulling up
        const fwdSpeed = this.vx * fx + this.vz * fz;
        const acc = (fwdSpeed - this._lastFwd) / Math.max(dt, 1e-4);
        this._lastFwd = fwdSpeed;
        this._nod += (clamp(-acc * C.NOD, -0.03, 0.03) - this._nod) * Math.min(1, dt * 6);
        return { dx: this.vx * dt, dz: this.vz * dt };
    }

    /**
     * After collisions: what actually happened (dx, dz moved this step). Walls eat velocity, and the
     * stride advances with real distance. Returns true when a foot lands this step.
     */
    afterMove(dx, dz, dt) {
        const C = FOOT_CONFIG;
        if (dt > 0) {
            // What the wall took away doesn't come back next step
            const ax = dx / dt, az = dz / dt;
            if (Math.abs(ax) < Math.abs(this.vx) - 0.05) this.vx = ax;
            if (Math.abs(az) < Math.abs(this.vz) - 0.05) this.vz = az;
        }
        const dist = Math.hypot(dx, dz);
        this.speed = dt > 0 ? dist / dt : 0;
        const before = Math.floor(this.phase / Math.PI);
        this.phase += (dist / C.STRIDE) * Math.PI;
        const landed = Math.floor(this.phase / Math.PI) > before;
        // When stopping, finish the step onto both feet rather than freezing mid-stride
        if (this.speed < 0.2) {
            const rest = Math.round(this.phase / Math.PI) * Math.PI;
            this.phase += (rest - this.phase) * Math.min(1, dt * 6);
        }
        this._cameraOffsets();
        return landed;
    }

    _cameraOffsets() {
        const C = FOOT_CONFIG;
        const moving = clamp(this.speed / 4, 0, 1);
        const amp = (C.BOB_WALK + (C.BOB_RUN - C.BOB_WALK) * this.runK) * moving;
        const s = Math.sin(this.phase);
        // Highest mid-step, a sharp dip as the heel strikes
        this.cam.y = amp * (Math.abs(s) - 1) + (1 - moving) * Math.sin(this.time * 1.7) * 0.005;
        this.cam.side = C.SWAY * s * moving * (1 - this.runK * 0.4);
        this.cam.roll = C.ROLL_SWAY * s * moving + this._lean - this._turn;
        this.cam.pitch = this._nod + (1 - moving) * Math.sin(this.time * 1.7 + 0.5) * 0.002;
    }

    /** Stops dead (teleports, getting in a car, a dive). */
    reset() {
        this.vx = this.vz = 0;
        this.speed = 0;
        this._lastYaw = null;
        this._lastFwd = 0;
    }
}
