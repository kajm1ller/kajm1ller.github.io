/**
 * js/game/rotorcraft.js
 *
 * Flyable helicopters. A Helicopter is a Plane with a hover flight model, so everything that treats
 * aircraft as `isPlane` (camera, HUD, spawning, crashes, the radio) works unchanged.
 *
 * Controls (same keys as the planes):
 *   W / S        collective: climb / descend (let go to hover)
 *   A / D        tail rotor: turn left / right
 *   Arrow Up/Dn  cyclic: tilt the nose down / up to fly forward / slow down and back up
 *   Arrow Lt/Rt  cyclic: slide left / right
 *   Space        wheel brake (on the ground)
 * The rotor needs about three seconds to spool up after you get in; no lift before that. The machine
 * has momentum: it keeps sliding when you stop pushing, drifts through turns, gets shoved by gusts,
 * and shudders as it passes through transition speed.
 */

import { Plane } from './plane.js';
import { AIRCRAFT } from './aircraft.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Helicopter extends Plane {
    constructor(id, x = 0, z = 0, yaw = 0, color = 0xf2f2f2, type = 'light') {
        super(id, x, z, yaw, color, AIRCRAFT[type] && AIRCRAFT[type].kind === 'heli' ? type : 'light');
        this.isHelicopter = true;
        this.heli = Object.assign({ maxSpeed: 55, climb: 7, accel: 5, yawRate: 1.3 }, AIRCRAFT[this.aircraftType].stats);
        this.maxForwardSpeed = this.heli.maxSpeed;
        this.rotorRpm = 0;
        this.rotorAngle = 0;
        this.cfg = Object.assign({}, this.cfg, { MAX_SPEED: this.heli.maxSpeed, MAX_ALTITUDE: 1500 });
        this.collective = 0;
        this.vel = { x: 0, z: 0 };   // world velocity: it drifts, the heading doesn't pull it round at once
        this.yawRateNow = 0;
        this.lateral = 0;            // sideways speed (+ = left)
    }

    canExit() {
        return this.position.y <= 0.05 && Math.abs(this.speed) < 3;
    }

    update(dt, grid = null) {
        if (!dt || dt <= 0) return;
        this._snapshotPrev();
        this.crashed = false;
        if (this.wrecked) {
            this.speed = 0;
            this.throttle = 0;
            this.velocity.set(0, 0);
            this.verticalSpeed = 0;
            return;
        }
        const H = this.heli;
        const occupied = this.isPlayer;
        this._t += dt;

        // Rotor spools up while someone is aboard, down when empty
        const rpmWant = occupied ? 1 : 0;
        this.rotorRpm += (rpmWant - this.rotorRpm) * Math.min(1, dt * (rpmWant > this.rotorRpm ? 0.35 : 0.15));
        const lifting = this.rotorRpm > 0.92;
        const ctl = this.ctl;
        ctl.p = slewTo(ctl.p, occupied ? this.inputPitch : 0, 2.2, 3.0, dt);
        ctl.y = slewTo(ctl.y, occupied ? this.inputYaw : 0, 2.2, 3.0, dt);
        ctl.r = slewTo(ctl.r, occupied ? this.inputSteer : 0, 2.5, 3.5, dt);    // (tail rotor pedals: + is left)
        const vIn = (this.inputThrottle > 0 ? 1 : 0) - (occupied && this.inputBrake > 0 ? 1 : 0);
        this.collective += (vIn - this.collective) * Math.min(1, dt * 2.2);

        // Gusts: stronger low down and in a hover; they push the machine about
        const gustAmp = occupied && !this.onGround ? 0.6 * (0.4 + 0.6 * Math.max(0, 1 - this.position.y / 300)) : 0;
        const t = this._t;
        const gx = (Math.sin(t * 0.9) + 0.5 * Math.sin(t * 2.3 + 1)) * gustAmp;
        const gz = (Math.sin(t * 1.1 + 2) + 0.5 * Math.sin(t * 2.9 + 0.5)) * gustAmp;
        const gy = (Math.sin(t * 1.7 + 4) + 0.4 * Math.sin(t * 4.1)) * gustAmp;

        // Vertical: collective sets the climb rate (with lag); no input holds the hover; without lift it drops
        let vyWant;
        if (!lifting) vyWant = this.onGround ? 0 : -9 * (1 - this.rotorRpm * 0.6);
        else vyWant = this.collective * H.climb + gy * 0.8;
        this.verticalSpeed += (vyWant - this.verticalSpeed) * Math.min(1, dt * 1.3);
        if (this.onGround && this.verticalSpeed < 0) this.verticalSpeed = 0;

        // Horizontal: cyclic pushes the disc, the fuselage keeps its momentum and drag works slowly
        const yaw = this.yaw;
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        const lx = -Math.cos(yaw), lz = Math.sin(yaw);
        const fwd = lifting ? -ctl.p : 0;
        const lat = lifting ? ctl.y : 0;
        const grip = this.onGround ? 0.2 : 1;
        const a = fwd * H.accel * (fwd > 0 ? 1 : 0.7) * grip;
        const al = lat * H.accel * 0.6 * grip;
        this.vel.x += (fx * a + lx * al + gx * 1.2) * dt;
        this.vel.z += (fz * a + lz * al + gz * 1.2) * dt;
        const drag = this.onGround ? 3.0 : 0.3;
        const k = Math.exp(-drag * dt);
        this.vel.x *= k;
        this.vel.z *= k;
        // The fuselage weathervanes: sideways drift bleeds off unless you're asking for it
        let lateral = this.vel.x * lx + this.vel.z * lz;
        const bleed = (1 - Math.exp(-0.7 * dt)) * (1 - Math.min(1, Math.abs(lat) * 1.5));
        this.vel.x -= lx * lateral * bleed;
        this.vel.z -= lz * lateral * bleed;
        if (this.onGround && this.inputBrake > 0) { this.vel.x *= Math.max(0, 1 - 5 * dt); this.vel.z *= Math.max(0, 1 - 5 * dt); }
        const total = Math.hypot(this.vel.x, this.vel.z);
        if (total > H.maxSpeed) { this.vel.x *= H.maxSpeed / total; this.vel.z *= H.maxSpeed / total; }
        this.speed = this.vel.x * fx + this.vel.z * fz;
        lateral = this.vel.x * lx + this.vel.z * lz;
        this.lateral = lateral;
        this.accelLong += (a - this.accelLong) * Math.min(1, dt * 3);
        this.accelLat += ((lat * 0.5 + lateral * 0.05) - this.accelLat) * Math.min(1, dt * 3);

        // Tail rotor: turn on the spot; the torque of a big collective swings the nose a little
        const torque = lifting ? -(this.collective) * 0.05 : 0;
        const yawWant = lifting ? (ctl.r * H.yawRate + torque) : 0;
        this.yawRateNow += (yawWant - this.yawRateNow) * Math.min(1, dt * 2.6);
        this.yaw += this.yawRateNow * Math.min(1, this.rotorRpm) * dt;
        while (this.yaw > Math.PI) this.yaw -= 2 * Math.PI;
        while (this.yaw < -Math.PI) this.yaw += 2 * Math.PI;
        this.steerAngle = 0;

        // Attitude follows the forces: nose down accelerating, bank into slides and turns, wobble in the gusts
        const fl = this.onGround ? 0 : 1;
        const pitchWant = -(fwd * 0.2 + this.speed / H.maxSpeed * 0.16) * fl + gz * 0.02 * fl;
        this.pitch += (pitchWant - this.pitch) * Math.min(1, dt * 2.2);
        const rollWant = (-this.yawRateNow * clamp(Math.abs(this.speed) / 18 + 0.2, 0, 1) * 0.25 + lateral * -0.012 + lat * -0.12 + gx * 0.02) * fl;
        this.roll += (clamp(rollWant, -0.4, 0.4) - this.roll) * Math.min(1, dt * 2);
        this.rollRate = rollWant - this.roll;
        this.pitchRate = pitchWant - this.pitch;

        this.velocity.x = this.vel.x;
        this.velocity.y = this.vel.z;
        this.position.x += this.vel.x * dt;
        this.position.z += this.vel.z * dt;
        const vy = this.verticalSpeed;
        this.position.y += vy * dt;

        if (this.position.y <= 0) {
            if (!this.onGround) {
                this.thump = Math.min(1, Math.abs(vy) / 5);
                if (vy < -7 || Math.abs(this.roll) > 0.5) {
                    this.crashed = true;
                    this.vel.x *= 0.4;
                    this.vel.z *= 0.4;
                }
                this.onGround = true;
            }
            this.position.y = 0;
            this.verticalSpeed = 0;
        } else if (this.onGround && vy > 0) {
            this.onGround = false;
        }
        if (this.position.y > this.cfg.MAX_ALTITUDE) this.position.y = this.cfg.MAX_ALTITUDE;
        this.thump *= Math.exp(-dt * 6);

        // Cockpit shake: rotor beat, worst through transition speed (~10-15 m/s) and in a hard flare
        const trans = Math.exp(-(((Math.hypot(this.vel.x, this.vel.z) - 12) / 6) ** 2));
        const shake = this.rotorRpm * (0.16 + 0.22 * trans + 0.1 * Math.abs(this.collective) + gustAmp * 0.2) * (this.onGround && this.rotorRpm > 0.5 ? 0.7 : 1);
        this.vibration += (clamp(shake, 0, 1) - this.vibration) * Math.min(1, dt * 5);

        // What the HUD and the engine sound read as "throttle"
        this.throttle = this.rotorRpm * (0.55 + 0.45 * this.collective);
        this.gLoad = 1 + this.verticalSpeed * 0.03;

        this._syncCollisionCircles();
        if (grid) this._resolveStaticCollisions(grid);
        this._enforceWorldBounds();
        this._validateState();
        this._updateMeshTransform(dt);
    }

    _updateMeshTransform(dt) {
        if (!this.mesh) return;
        this.mesh.position.copy(this.position);
        this.mesh.rotation.order = 'YXZ';
        this.mesh.rotation.y = this.yaw;
        this.mesh.rotation.x = this.pitch;
        this.mesh.rotation.z = -this.roll;
        if (dt > 0) {
            this.rotorAngle += this.rotorRpm * dt;
            for (const sp of this.spinners) sp.obj.rotation[sp.axis] = this.rotorAngle * sp.k;
        }
        this._updateInstruments(dt);
    }
}

function slewTo(cur, target, up, down, dt) {
    const rate = Math.abs(target) > Math.abs(cur) ? up : down;
    return cur + clamp(target - cur, -rate * dt, rate * dt);
}
