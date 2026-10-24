/**
 * js/game/vehicleTransition.js
 *
 * First-person animations for getting into and out of a car.
 *
 * Getting in: walk up to the driver's door, swing it open, duck under the roof line into the seat
 * while turning to face the road, pull the door shut. Getting out is the reverse, ending on foot
 * beside the car looking the way it faces (where the first-person camera takes over). If the
 * driver's side is blocked the player climbs out of the passenger side instead.
 *
 * The camera path is laid out in car space each frame, so it stays attached to a car that is still
 * rolling. The game drives one transition at a time and blocks the player's controls while it runs.
 */

import * as THREE from 'three';
import { cabinShape, getCarModel } from './carModels.js';

const STAND_EYE = 1.7;      // eye height on foot
const DOOR_OPEN = 1.15;     // driver's door fully open (radians)

const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();

const smooth = (x) => {
    const t = Math.max(0, Math.min(1, x));
    return t * t * (3 - 2 * t);
};
const span = (t, t0, t1) => (t1 <= t0 ? (t >= t1 ? 1 : 0) : Math.max(0, Math.min(1, (t - t0) / (t1 - t0))));

/** Car space -> world for a vehicle pose (yaw = 0 faces -Z). */
function toWorld(v, local, out) {
    const c = Math.cos(v.yaw || 0), s = Math.sin(v.yaw || 0);
    return out.set(
        v.position.x + local.x * c + local.z * s,
        (v.position.y || 0) + local.y,
        v.position.z - local.x * s + local.z * c
    );
}

function toLocal(v, world, out) {
    const c = Math.cos(v.yaw || 0), s = Math.sin(v.yaw || 0);
    const dx = world.x - v.position.x, dz = world.z - v.position.z;
    return out.set(dx * c - dz * s, world.y - (v.position.y || 0), dx * s + dz * c);
}

/** Camera orientation at `pos` looking at `target` (both world). */
function lookQuat(pos, target, out) {
    _m.lookAt(pos, target, _up);
    return out.setFromRotationMatrix(_m);
}

/** Quadratic Bezier. */
function bezier(p0, c, p1, t, out) {
    const u = 1 - t;
    return out.set(
        u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
        u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
        u * u * p0.z + 2 * u * t * c.z + t * t * p1.z
    );
}

/**
 * Key points of the climb in car space for a side (-1 driver, +1 passenger):
 * stand (outside the door, standing eye), duck (head in the door opening under the roof),
 * duckCtrl (Bezier control: ducks before passing the roof edge), seat (driver's eye).
 */
function climbPoints(vehicle, side) {
    const model = getCarModel(vehicle.model || 'civic');
    const S = cabinShape(model);
    const eye = vehicle.driverEye || S.eye;
    const half = model.width / 2;
    const ground = 0;
    const seatX = side < 0 ? eye.x : -eye.x;
    const doorZ = S.bPillar - 0.12;
    const duckY = Math.min(eye.y + 0.06, S.roof - 0.16);
    return {
        half,
        halfLen: model.length / 2,
        stand: new THREE.Vector3(side * (half + 0.55), ground + STAND_EYE, doorZ),
        duckCtrl: new THREE.Vector3(side * (half + 0.15), duckY + 0.05, (doorZ + eye.z) / 2),
        duck: new THREE.Vector3(side * (S.halfW - 0.12), duckY, eye.z + 0.08),
        seat: new THREE.Vector3(seatX, eye.y, eye.z),
        // Where the eyes go along the way
        lookSeat: new THREE.Vector3(seatX, eye.y - 0.25, eye.z - 0.1),
        lookDash: new THREE.Vector3(seatX * 0.5, eye.y - 0.3, eye.z - 1.4),
        lookOut: new THREE.Vector3(side * (half + 3), STAND_EYE - 0.3, eye.z - 1.0),
        lookRoad: new THREE.Vector3(seatX, eye.y - 1.5, eye.z - 25)
    };
}

export class VehicleTransition {
    /**
     * @param {Object} opts
     * @param {'enter'|'exit'} opts.kind
     * @param {Object} opts.vehicle
     * @param {THREE.Camera} opts.camera
     * @param {THREE.Vector3} [opts.exitPos] Ground position the player ends up at (exit)
     * @param {string} [opts.exitSide] Exit candidate name from PlayerController ('LEFT', 'RIGHT', ...)
     * @param {Function} [opts.onDoor] Called with 'open' / 'close' when the door latch moves
     * @param {boolean} [opts.doorStartsOpen] The door is already open (carjacking)
     * @param {number} [opts.speed=1] Playback rate (a hurried scramble in during a carjacking)
     */
    constructor(opts) {
        this.kind = opts.kind;
        this.vehicle = opts.vehicle;
        this.camera = opts.camera;
        this.onDoor = opts.onDoor || null;
        this.speed = opts.speed || 1;
        this.doorStartsOpen = !!opts.doorStartsOpen;
        this.done = false;
        this.time = 0;
        const v = this.vehicle;
        this.side = (opts.exitSide && /RIGHT/.test(opts.exitSide)) ? 1 : -1;
        this.usesDoor = this.side < 0 && !!v.leftDoorPivot;
        this.P = climbPoints(v, this.side);
        this._doorOpened = this.doorStartsOpen;
        this._doorClosed = false;

        // Start pose, kept in car space so it rides along with the car
        this.startPos = toLocal(v, this.camera.position, new THREE.Vector3());
        this.startQuat = this.camera.quaternion.clone();
        if (this.kind === 'enter') {
            // Walk round to the driver's door (around the nose or tail when coming from the far
            // side); the walk takes as long as the path is
            this._buildWalk();
            const w = this.walk;
            this.T = {
                doorOpen0: Math.max(0, w - 0.2), doorOpen1: w + 0.25,
                climb0: w + 0.1, duck: w + 0.55, seat: w + 0.85,
                doorClose0: w + 0.9, doorClose1: w + 1.2, end: w + 1.3
            };
        } else {
            this.exitGround = opts.exitPos ? opts.exitPos.clone() : null;
            // From the chase camera, first glide down into the seat
            const fromSeat = this.startPos.distanceTo(this.P.seat);
            const s0 = fromSeat > 0.5 ? 0.45 : 0.1;
            this.T = {
                toSeat: s0, doorOpen0: s0 + 0.05, doorOpen1: s0 + 0.5,
                duck: s0 + 0.85, stand: s0 + 1.4, step: s0 + 1.75,
                doorClose0: s0 + 1.55, doorClose1: s0 + 1.9, end: s0 + 2.0
            };
        }
        this.endQuat = new THREE.Quaternion();
    }

    /** Waypoints (car space, eye height) from the start to the spot outside the door. */
    _buildWalk() {
        const P = this.P;
        const S = this.startPos.clone();
        S.y = STAND_EYE;
        const pts = [S];
        const sideX = P.stand.x;
        const clearX = P.half + 0.55;
        const clearZ = P.halfLen + 0.7;
        if (Math.sign(S.x) !== Math.sign(sideX) || Math.abs(S.x) < P.half) {
            // Not on the door's side: go round whichever end of the car is nearer
            const endZ = S.z < 0 ? -clearZ : clearZ;
            if (Math.abs(S.z) < clearZ) pts.push(new THREE.Vector3(Math.sign(S.x || 1) * Math.max(Math.abs(S.x), clearX), STAND_EYE, endZ));
            pts.push(new THREE.Vector3(sideX, STAND_EYE, endZ));
        }
        pts.push(P.stand.clone());
        this.walkPts = pts;
        this.walkLens = [];
        let total = 0;
        for (let i = 1; i < pts.length; i++) {
            const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
            this.walkLens.push(d);
            total += d;
        }
        this.walkLen = total;
        this.walk = Math.max(0.3, Math.min(2.4, total / 3.4));
    }

    /** Position along the walk at fraction k (0..1) and the walking direction. */
    _walkAt(k, outPos, outDir) {
        let d = k * this.walkLen;
        const pts = this.walkPts;
        for (let i = 1; i < pts.length; i++) {
            const len = this.walkLens[i - 1];
            if (d <= len || i === pts.length - 1) {
                const f = len > 1e-6 ? Math.min(1, d / len) : 1;
                outPos.lerpVectors(pts[i - 1], pts[i], f);
                outDir.subVectors(pts[i], pts[i - 1]).setY(0);
                if (outDir.lengthSq() < 1e-6) outDir.set(0, 0, -1);
                outDir.normalize();
                return outPos;
            }
            d -= len;
        }
        return outPos.copy(pts[pts.length - 1]);
    }

    /** Door angle at the current time. */
    _door() {
        const T = this.T;
        const open = this.doorStartsOpen ? 1 : smooth(span(this.time, T.doorOpen0, T.doorOpen1));
        const close = smooth(span(this.time, T.doorClose0, T.doorClose1));
        if (!this._doorOpened && this.time >= T.doorOpen0) {
            this._doorOpened = true;
            if (this.onDoor) this.onDoor('open', this.vehicle);
        }
        if (!this._doorClosed && this.time >= T.doorClose1 - 0.02) {
            this._doorClosed = true;
            if (this.onDoor) this.onDoor('close', this.vehicle);
        }
        return DOOR_OPEN * open * (1 - close);
    }

    /**
     * Advances the animation and poses the camera.
     * @returns {boolean} true once finished
     */
    update(dt) {
        if (this.done) return true;
        this.time += dt * this.speed;
        const v = this.vehicle;
        const T = this.T;
        const P = this.P;
        const cam = this.camera;
        if (this.usesDoor && typeof v.setDoorAngle === 'function') v.setDoorAngle(this._door());
        else this._door();

        const pos = _a;
        const qA = new THREE.Quaternion(), qB = new THREE.Quaternion();
        const W = (local, out) => toWorld(v, local, out);
        const t = this.time;

        if (this.kind === 'enter') {
            if (t < T.climb0) {
                // Walk to the door looking where you're going, then turn to look in at the seat
                const k = smooth(span(t, 0, this.walk));
                this._walkAt(k, pos, _t);
                // Settle from the starting eye height and bob with the steps
                pos.y += (this.startPos.y - STAND_EYE) * (1 - span(t, 0, 0.25)) + Math.abs(Math.sin(k * this.walkLen * 2.2)) * 0.03 * (1 - k);
                W(pos, cam.position);
                _b.copy(pos).addScaledVector(_t, 4);
                _b.y -= 0.4;
                lookQuat(cam.position, W(_b, _c), qA);
                const turnIn = smooth(span(k, 0.65, 1));
                lookQuat(W(P.stand, _b), W(P.lookSeat, _c), qB);
                qA.slerp(qB, turnIn);
                cam.quaternion.slerpQuaternions(this.startQuat, qA, smooth(span(t, 0, Math.min(0.35, this.walk))));
            } else if (t < T.duck) {
                // Duck through the door opening
                const k = smooth(span(t, T.climb0, T.duck));
                bezier(P.stand, P.duckCtrl, P.duck, k, pos);
                W(pos, cam.position);
                lookQuat(W(P.stand, _b), W(P.lookSeat, _c), qA);
                lookQuat(W(P.duck, _b), W(P.lookDash, _c), qB);
                cam.quaternion.slerpQuaternions(qA, qB, k);
            } else {
                // Settle into the seat and face the road
                const k = smooth(span(t, T.duck, T.seat));
                pos.lerpVectors(P.duck, P.seat, k);
                pos.y -= Math.sin(k * Math.PI) * 0.04;
                W(pos, cam.position);
                lookQuat(W(P.duck, _b), W(P.lookDash, _c), qA);
                lookQuat(W(P.seat, _b), W(P.lookRoad, _c), qB);
                cam.quaternion.slerpQuaternions(qA, qB, k);
            }
        } else {
            const yaw = v.yaw || 0;
            if (t < T.toSeat) {
                // From wherever the camera was (chase view) into the seat, looking at the door
                const k = smooth(span(t, 0, T.toSeat));
                pos.lerpVectors(this.startPos, P.seat, k);
                W(pos, cam.position);
                lookQuat(W(P.seat, _b), W(P.lookOut, _c), qB);
                cam.quaternion.slerpQuaternions(this.startQuat, qB, k);
            } else if (t < T.duck) {
                // Turn to the door as it swings open, then lean out under the roof
                const k = smooth(span(t, T.doorOpen1 - 0.1, T.duck));
                pos.lerpVectors(P.seat, P.duck, k);
                W(pos, cam.position);
                lookQuat(W(P.seat, _b), W(P.lookOut, _c), qA);
                lookQuat(W(P.duck, _b), W(P.lookOut, _c), qB);
                cam.quaternion.slerpQuaternions(qA, qB, k);
            } else if (t < T.stand) {
                // Out under the roof and up onto your feet beside the car
                const k = smooth(span(t, T.duck, T.stand));
                bezier(P.duck, P.duckCtrl, P.stand, k, pos);
                W(pos, cam.position);
                lookQuat(W(P.duck, _b), W(P.lookOut, _c), qA);
                this._finalLook(W(P.stand, _b), yaw, qB);
                cam.quaternion.slerpQuaternions(qA, qB, k);
            } else {
                // Step clear (to the spot the exit check picked) while the door swings shut
                const k = smooth(span(t, T.stand, T.step));
                W(P.stand, _b);
                if (this.exitGround) {
                    _t.set(this.exitGround.x, this.exitGround.y + STAND_EYE, this.exitGround.z);
                    cam.position.lerpVectors(_b, _t, k);
                } else {
                    cam.position.copy(_b);
                }
                this._finalLook(cam.position, yaw, cam.quaternion);
            }
        }

        if (t >= T.end) {
            this.done = true;
            if (this.usesDoor && typeof v.setDoorAngle === 'function') v.setDoorAngle(0);
        }
        return this.done;
    }

    /** On foot, looking the way the car faces (the first-person camera starts from there). */
    _finalLook(pos, yaw, out) {
        _c.set(pos.x - Math.sin(yaw) * 10, pos.y, pos.z - Math.cos(yaw) * 10);
        return lookQuat(pos, _c, out);
    }

    /** Ground position under the camera (where the player "is" during the animation). */
    groundPosition(out) {
        return out.set(this.camera.position.x, this.vehicle.position.y || 0, this.camera.position.z);
    }

    /** Snaps the door shut (e.g. the transition was cut short). */
    cancel() {
        if (this.usesDoor && typeof this.vehicle.setDoorAngle === 'function') this.vehicle.setDoorAngle(0);
        this.done = true;
    }
}

/**
 * Car door sounds: the latch clicking and the hinge for 'open', the slam for 'close' (heavier
 * for big vehicles).
 */
export function playCarDoor(ctx, kind, vehicle = null) {
    if (!ctx) return;
    try {
        if (ctx.state === 'suspended') ctx.resume();
        const heavy = vehicle && vehicle.model ? Math.min(1, Math.max(0, (vehicle.model.length - 4.0) / 1.6)) : 0.3;
        const t0 = ctx.currentTime + 0.005;
        const out = ctx.createGain();
        out.gain.value = 0.8;
        out.connect(ctx.destination);
        const noiseBurst = (start, dur, freq, q, peak, type = 'bandpass') => {
            const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
            const buf = ctx.createBuffer(1, len, ctx.sampleRate);
            const d = buf.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const f = ctx.createBiquadFilter();
            f.type = type;
            f.frequency.value = freq;
            f.Q.value = q;
            const g = ctx.createGain();
            g.gain.setValueAtTime(peak, start);
            g.gain.exponentialRampToValueAtTime(0.0005, start + dur);
            src.connect(f).connect(g).connect(out);
            src.start(start);
            src.stop(start + dur + 0.02);
        };
        const thump = (start, f0, f1, dur, peak) => {
            const o = ctx.createOscillator();
            o.type = 'sine';
            o.frequency.setValueAtTime(f0, start);
            o.frequency.exponentialRampToValueAtTime(f1, start + dur);
            const g = ctx.createGain();
            g.gain.setValueAtTime(peak, start);
            g.gain.exponentialRampToValueAtTime(0.0005, start + dur);
            o.connect(g).connect(out);
            o.start(start);
            o.stop(start + dur + 0.02);
        };
        if (kind === 'open') {
            // Handle pulled, latch releases (two clicks), seal pops
            noiseBurst(t0, 0.025, 3200, 2.5, 0.35);
            noiseBurst(t0 + 0.06, 0.03, 2400, 3, 0.4);
            thump(t0 + 0.07, 220 - heavy * 80, 120, 0.06, 0.25);
            noiseBurst(t0 + 0.1, 0.18, 900, 0.7, 0.08, 'lowpass');
        } else {
            // Door slams on the striker: deep body thud, latch clack, a little rattle
            thump(t0, 130 - heavy * 55, 45, 0.22 + heavy * 0.08, 0.75);
            noiseBurst(t0, 0.09, 600 - heavy * 200, 1.2, 0.55, 'lowpass');
            noiseBurst(t0 + 0.012, 0.03, 2600, 3, 0.35);
            noiseBurst(t0 + 0.05, 0.12, 1500, 1.5, 0.06);
        }
    } catch (e) {
        // Audio is optional
    }
}
