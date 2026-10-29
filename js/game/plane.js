/**
 * js/game/plane.js
 *
 * Flyable light aircraft: procedural mesh + arcade flight model.
 *
 * The Plane is duck-typed to the Vehicle interface (getPosition / getYaw / getSpeed /
 * setInputs / setPlayerControlled / update / collisionCircles / mesh) so PlayerController,
 * CameraController, the radio and the spatial grid treat it like any other drivable vehicle.
 *
 * Project coordinate frame: yaw=0 points along -Z, positive yaw turns left.
 *   Euler order 'YXZ': rotation.y = yaw, rotation.x = pitch (+ = nose up),
 *   rotation.z = -roll (roll is positive when banking right).
 *
 * Controls (routed from PlayerController keys by game.html):
 *   W / S        throttle up / down
 *   A / D        roll left / right (in the air) or nose-wheel steering (on the ground)
 *   Arrow Up/Dn  pitch nose down / up
 *   Space        wheel brake
 */

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { AIRCRAFT, buildAircraft } from './aircraft.js';

const GRAVITY = 9.8;
const _scratchCollisionResults = [];

// ============================================================================
// MESH
// ============================================================================
let _geos = null;
let _mats = null;

function getGeos() {
    if (!_geos) {
        const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 12);
        wheelGeo.rotateZ(Math.PI / 2);
        const noseGeo = new THREE.CylinderGeometry(0.62, 0.78, 1.4, 12);
        noseGeo.rotateX(Math.PI / 2);
        const strutGeo = new THREE.BoxGeometry(0.1, 0.9, 0.12);
        _geos = {
            fuselage: new THREE.BoxGeometry(1.5, 1.5, 6.2),
            tail: new THREE.BoxGeometry(0.9, 0.9, 3.0),
            nose: noseGeo,
            wing: new THREE.BoxGeometry(11.0, 0.16, 1.7),
            stabilizer: new THREE.BoxGeometry(3.6, 0.12, 0.9),
            fin: new THREE.BoxGeometry(0.12, 1.5, 1.2),
            windshield: new THREE.BoxGeometry(1.3, 0.7, 0.06),
            sideWindow: new THREE.BoxGeometry(0.05, 0.6, 1.5),
            propHub: new THREE.CylinderGeometry(0.16, 0.2, 0.3, 8),
            propBlade: new THREE.BoxGeometry(0.16, 2.5, 0.05),
            wheel: wheelGeo,
            strut: strutGeo,
            wingStrut: new THREE.BoxGeometry(0.08, 1.35, 0.08),
            light: new THREE.BoxGeometry(0.2, 0.12, 0.2)
        };
    }
    return _geos;
}

function getMats() {
    if (!_mats) {
        _mats = {
            trim: new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.35, metalness: 0.3 }),
            glass: new THREE.MeshStandardMaterial({ color: 0x6fa4c4, transparent: true, opacity: 0.55, depthWrite: false, roughness: 0.05, metalness: 0.3, envMapIntensity: 1.3 }),
            dark: new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.2 }),
            metal: new THREE.MeshStandardMaterial({ color: 0x9a9da3, roughness: 0.35, metalness: 0.9 }),
            prop: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.4 }),
            lightRed: new THREE.MeshBasicMaterial({ color: 0xff2222 }),
            lightGreen: new THREE.MeshBasicMaterial({ color: 0x22ff44 })
        };
    }
    return _mats;
}

const _bodyMats = new Map();
function getBodyMat(color) {
    if (!_bodyMats.has(color)) {
        _bodyMats.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.3, envMapIntensity: 1.0 }));
    }
    return _bodyMats.get(color);
}

/**
 * Builds a high-wing single-engine prop plane. Nose points toward -Z, wheels rest on y=0.
 * @returns {{ root: THREE.Group, propeller: THREE.Group }}
 */
export function createPlaneMesh(color = 0xf2f2f2, id = 'plane') {
    const g = getGeos();
    const m = getMats();
    const body = getBodyMat(color);

    const root = new THREE.Group();
    root.name = `plane_${id}`;
    root.userData.isPlane = true;

    const add = (geo, mat, name, x, y, z) => {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = name;
        mesh.position.set(x, y, z);
        root.add(mesh);
        return mesh;
    };

    add(g.fuselage, body, 'plane_fuselage', 0, 1.45, 0.2);
    add(g.tail, body, 'plane_tail_cone', 0, 1.55, 3.9).rotation.x = 0.06;
    add(g.nose, m.trim, 'plane_nose', 0, 1.35, -3.6);
    add(g.wing, body, 'plane_wing', 0, 2.35, -0.3);
    add(g.stabilizer, body, 'plane_stabilizer', 0, 1.75, 5.2);
    add(g.fin, m.trim, 'plane_fin', 0, 2.5, 5.0);
    add(g.windshield, m.glass, 'plane_windshield', 0, 2.05, -1.95).rotation.x = -0.35;
    add(g.sideWindow, m.glass, 'plane_window_left', -0.77, 2.0, -0.75);
    add(g.sideWindow, m.glass, 'plane_window_right', 0.77, 2.0, -0.75);
    // Wing struts and wingtip navigation lights
    for (const side of [-1, 1]) {
        const strut = add(g.wingStrut, m.metal, `plane_wing_strut_${side}`, side * 2.2, 1.55, -0.3);
        strut.rotation.z = side * 0.9;
    }
    add(g.light, m.lightRed, 'plane_nav_left', -5.5, 2.35, -0.3);
    add(g.light, m.lightGreen, 'plane_nav_right', 5.5, 2.35, -0.3);

    // Landing gear: nose wheel + two main wheels
    add(g.strut, m.metal, 'plane_strut_nose', 0, 0.78, -3.0);
    add(g.wheel, m.dark, 'plane_wheel_nose', 0, 0.34, -3.0);
    for (const side of [-1, 1]) {
        add(g.strut, m.metal, `plane_strut_main_${side}`, side * 1.1, 0.8, -0.2).rotation.z = side * 0.3;
        add(g.wheel, m.dark, `plane_wheel_main_${side}`, side * 1.2, 0.34, -0.2);
    }

    // Propeller (spins about the Z axis in front of the nose)
    const propeller = new THREE.Group();
    propeller.name = 'plane_propeller';
    propeller.position.set(0, 1.35, -4.4);
    const hub = new THREE.Mesh(g.propHub, m.metal);
    hub.rotation.x = Math.PI / 2;
    propeller.add(hub);
    propeller.add(new THREE.Mesh(g.propBlade, m.prop));
    const blade2 = new THREE.Mesh(g.propBlade, m.prop);
    blade2.rotation.z = Math.PI / 2;
    propeller.add(blade2);
    root.add(propeller);

    root.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });

    return { root, propeller };
}

// ============================================================================
// FLIGHT MODEL
// ============================================================================
export const PLANE_CONFIG = Object.freeze({
    MAX_SPEED: 75.0,          // m/s at full throttle in level flight (~168 mph)
    STALL_SPEED: 24.0,        // below this the wings stop producing full lift
    ROTATE_SPEED: 26.0,       // minimum ground speed to lift the nose
    ACCEL: 11.0,              // m/s^2 toward the throttle's target speed
    THROTTLE_RATE: 0.55,      // throttle change per second while W/S held
    MAX_PITCH: 0.62,          // rad
    PITCH_RATE: 0.9,          // rad/s at full control authority
    MAX_BANK: 1.0,            // rad
    ROLL_RATE: 1.8,           // rad/s
    TURN_RATE_SCALE: 1.4,     // multiplier on the coordinated-turn rate
    GROUND_BRAKE: 14.0,       // m/s^2
    GROUND_FRICTION: 1.6,     // m/s^2 rolling resistance with the engine off
    STALL_SINK: 16.0,         // m/s of extra sink at zero airspeed (scaled by lost lift)
    GLIDE_SINK: 4.0,          // m/s of sink with the engine at idle
    MAX_ALTITUDE: 900,
    CRASH_SINK_RATE: 9.0,     // descending faster than this on touchdown is a hard landing
    STABILITY: 0.35,          // how firmly the nose settles to its trim attitude when the stick is let go
    ROLL_STAB: 0.7,           // dihedral: how fast a released bank rolls back to level
    RUDDER_RATE: 0.45,        // rad/s of yaw at full rudder
    TURB: 1.0                 // how much the air shoves it around
});
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** Moves cur toward target at `up` per second when pushing away from centre, `down` when returning. */
const slew = (cur, target, up, down, dt) => {
    const rate = Math.abs(target) > Math.abs(cur) ? up : down;
    return cur + clamp(target - cur, -rate * dt, rate * dt);
};

export class Plane {
    /**
     * @param {string|number} id
     * @param {number} x
     * @param {number} z
     * @param {number} yaw heading in radians (0 = facing -Z)
     * @param {number} color body paint
     */
    constructor(id, x = 0, z = 0, yaw = 0, color = 0xf2f2f2, type = 'cub') {
        const spec = AIRCRAFT[type] || AIRCRAFT.cub;
        this.id = id;
        this.aircraftType = AIRCRAFT[type] ? type : 'cub';
        this.modelName = spec.name;
        this.cfg = Object.assign({}, PLANE_CONFIG, spec.kind === 'plane' ? spec.stats : {});
        this.isJet = !!spec.jet;
        this.harness = false;             // buckled in: a depressurised cabin can't pull you out
        this.canopyBroken = false;
        this.open = !!spec.open;          // open windows: you can shoot out of it; sealed cabins lose pressure instead
        this.isPlane = true;
        this.isPlayer = false;
        this.color = color;
        this.bodyColor = color;

        this.position = new THREE.Vector3(x, 0, z);
        this.velocity = new THREE.Vector2(0, 0); // horizontal world velocity [vx, vz]
        this.verticalSpeed = 0;
        this.yaw = yaw;
        this.pitch = 0;
        this.roll = 0;           // positive = banked right
        this.speed = 0;          // airspeed / ground speed along the heading
        this.throttle = 0;       // 0..1 engine power setting
        this.steerAngle = 0;     // nose-wheel steering (compat with Vehicle)
        this.onGround = true;
        this.crashed = false;    // set on the frame of a hard landing / building hit
        this.wrecked = false;    // set by the game once the crash has blown the plane up

        // Dimensions. `width` is the distance the player is placed to the side when exiting,
        // so it is kept just inside the wingspan (the player stands under the wing).
        this.length = spec.dims.length;
        this.width = Math.min(spec.dims.width, 7.0);
        this.height = spec.dims.height;
        this.radius = spec.dims.radius;
        this.circleRadius = spec.dims.circleRadius;
        this._circleOffsets = [this.length * 0.3, 0, -this.length * 0.3];
        this.interactionRadius = Math.max(8.0, this.radius + 2.5);
        // Aircraft are big: the chase camera sits farther back and higher than for a car
        this.chaseCamera = Object.assign({}, spec.chase);
        this.maxForwardSpeed = this.cfg.MAX_SPEED || 75;
        this.maxReverseSpeed = 0;

        // Compat with Vehicle inputs
        this.inputThrottle = 0;
        this.inputBrake = 0;
        this.inputSteer = 0;
        this.inputHandbrake = false;
        this.inputPitch = 0;     // +1 = nose up (set by the game from the arrow keys)
        this.inputYaw = 0;       // rudder: +1 = yaw left (arrow keys)

        // Flight state beyond attitude: smoothed stick, angular rates, engine spool, sensations for the camera
        this.ctl = { r: 0, p: 0, y: 0 };
        this.rollRate = 0;
        this.pitchRate = 0;
        this.power = 0;          // engine output, lags the throttle lever
        this.stalled = false;
        this.stallSide = 1;
        this.gLoad = 1;
        this.vibration = 0;      // 0..1 shake felt in the cockpit
        this.thump = 0;          // touchdown jolt, decays
        this.accelLong = 0;
        this.accelLat = 0;
        this.airbrake = 0;
        this._t = Math.random() * 100;
        this._prev = { x: x, y: 0, z: z, yaw: yaw, pitch: 0, roll: 0 };

        this.lastSafePosition = new THREE.Vector3(x, 0, z);
        this.lastSafeYaw = yaw;

        this.collisionCircles = [
            { x: 0, z: 0, radius: this.circleRadius },
            { x: 0, z: 0, radius: this.circleRadius },
            { x: 0, z: 0, radius: this.circleRadius }
        ];
        this._syncCollisionCircles();

        let built;
        if (this.aircraftType === 'cub') {
            const b = createPlaneMesh(color, id);
            built = { root: b.root, propellers: [b.propeller], spinners: [], interior: spec.interior(b.root) };
        } else {
            built = buildAircraft(this.aircraftType, color, id);
        }
        this.mesh = built.root;
        this.mesh.userData.vehicle = this;
        this.propeller = built.propellers[0] || null;
        this.propellers = built.propellers;
        this.spinners = built.spinners;
        this.interior = built.interior;
        // Where the pilot's eyes are (camera.js reads `driverEye` in the aircraft's local space)
        this.driverEye = built.interior.eye.clone();
        this.propAngle = 0;
        this._instrumentT = 0;
        this._updateMeshTransform(0);
    }

    // ---- Vehicle-interface helpers -------------------------------------------------

    setDoorAngle() {}

    /** The pilot can only climb out when the plane is on the ground and nearly stopped. */
    canExit() {
        return this.position.y <= 0.05 && Math.abs(this.speed) < 6;
    }

    /** Buckle / unbuckle the pilot's harness (B); the straps show in the cockpit while it's on. */
    setHarness(on) {
        this.harness = !!on;
        if (this.interior && this.interior.harness) this.interior.harness.visible = this.harness;
    }

    setPlayerControlled(isControlled) {
        if (isControlled && !this.isPlayer) {
            this.setHarness(false);
            this.hintPending = true;   // (game.html tells the pilot about the harness once)
        }
        this.isPlayer = !!isControlled;
        if (!this.isPlayer) {
            this.setInputs(false, 0, false, false);
            this.inputPitch = 0;
        }
    }

    /**
     * W = throttle up, S = throttle down, A/D = roll/steer, Space = wheel brake.
     * Signature mirrors Vehicle.setInputs so PlayerController can drive it unchanged.
     */
    setInputs(throttle, steer, brake, handbrake = false) {
        if (typeof steer === 'object' && steer !== null) {
            this.inputSteer = (steer.left ? 1 : 0) - (steer.right ? 1 : 0);
        } else if (typeof steer === 'number') {
            this.inputSteer = Math.max(-1, Math.min(1, steer));
        } else {
            this.inputSteer = 0;
        }
        this.inputThrottle = throttle ? 1 : 0;
        this.inputBrake = brake ? 1 : 0;
        this.inputHandbrake = !!handbrake;
    }

    /** The state before this step, so the renderer can draw between steps (see renderInterp). */
    _snapshotPrev() {
        const q = this._prev;
        q.x = this.position.x; q.y = this.position.y; q.z = this.position.z;
        q.yaw = this.yaw; q.pitch = this.pitch; q.roll = this.roll;
    }

    /**
     * Draws the aircraft `alpha` (0..1) of the way from the previous step to the current one. The sim runs
     * at a fixed 60 Hz; a jet covers metres per step, so without this the cockpit view would judder.
     */
    renderInterp(alpha) {
        if (!this.mesh || this.wrecked) return;
        const q = this._prev, a = Math.max(0, Math.min(1, alpha));
        this.mesh.position.set(q.x + (this.position.x - q.x) * a, q.y + (this.position.y - q.y) * a, q.z + (this.position.z - q.z) * a);
        let dy = this.yaw - q.yaw;
        if (dy > Math.PI) dy -= 2 * Math.PI;
        if (dy < -Math.PI) dy += 2 * Math.PI;
        this.mesh.rotation.order = 'YXZ';
        this.mesh.rotation.y = q.yaw + dy * a;
        this.mesh.rotation.x = q.pitch + (this.pitch - q.pitch) * a;
        this.mesh.rotation.z = -(q.roll + (this.roll - q.roll) * a);
        this.mesh.updateMatrixWorld(true);
    }

    setYawInput(y) {
        this.inputYaw = Math.max(-1, Math.min(1, y || 0));
    }

    setPitchInput(p) {
        this.inputPitch = Math.max(-1, Math.min(1, p || 0));
    }

    get altitude() {
        return this.position.y;
    }

    getPosition() {
        return { x: this.position.x, y: this.position.y, z: this.position.z };
    }
    getYaw() { return this.yaw; }
    getSpeed() { return this.speed; }
    getVelocity() { return { x: this.velocity.x, z: this.velocity.y }; }
    getBoundingCircles() { return this.collisionCircles; }
    getMesh() { return this.mesh; }

    initMesh(scene) {
        if (scene && this.mesh && !this.mesh.parent) scene.add(this.mesh);
        return this.mesh;
    }

    destroy() {
        if (this.mesh && this.mesh.parent) this.mesh.parent.remove(this.mesh);
    }

    _syncCollisionCircles() {
        const fwdX = -Math.sin(this.yaw);
        const fwdZ = -Math.cos(this.yaw);
        for (let i = 0; i < 3; i++) {
            this.collisionCircles[i].x = this.position.x + this._circleOffsets[i] * fwdX;
            this.collisionCircles[i].z = this.position.z + this._circleOffsets[i] * fwdZ;
        }
    }

    // ---- Simulation ----------------------------------------------------------------

    /**
     * @param {number} dt seconds
     * @param {SpatialGrid} [grid] static obstacles are only hit while flying below their roofline
     */
    update(dt, grid = null) {
        if (!dt || dt <= 0) return;
        this._snapshotPrev();
        this.crashed = false;
        if (this.wrecked) {
            // Exploded: the game hides the mesh; keep the husk motionless where it blew up
            this.speed = 0;
            this.throttle = 0;
            this.velocity.set(0, 0);
            this.verticalSpeed = 0;
            return;
        }
        const C = this.cfg;
        const occupied = this.isPlayer;
        this._t += dt;

        // 1. Controls. The stick takes time to move and to come back; the engine takes time to spool.
        const ctl = this.ctl;
        ctl.r = slew(ctl.r, occupied ? -this.inputSteer : 0, 3.2, 4.5, dt);
        ctl.p = slew(ctl.p, occupied ? this.inputPitch : 0, 2.6, 4.0, dt);
        ctl.y = slew(ctl.y, occupied ? this.inputYaw : 0, 3.0, 5.0, dt);
        if (occupied) {
            if (this.inputThrottle > 0) this.throttle = Math.min(1, this.throttle + C.THROTTLE_RATE * dt);
            if (this.inputBrake > 0 && !this.onGround) this.throttle = Math.max(0, this.throttle - C.THROTTLE_RATE * dt);
        } else {
            this.throttle = 0;
        }
        const spool = this.isJet ? 0.9 : 2.5;
        this.power += (this.throttle - this.power) * Math.min(1, dt * (this.throttle > this.power ? spool : spool * 1.6));
        const brakingOnGround = this.onGround && (this.inputHandbrake || (occupied && this.inputBrake > 0 && this.throttle <= 0.02));
        // Space in the air: speed brake / flaps down (drag, nose pitches up a touch)
        this.airbrake += ((!this.onGround && occupied && this.inputHandbrake ? 1 : 0) - this.airbrake) * Math.min(1, dt * 2);

        // 2. Airspeed. Thrust pulls toward the lever's speed, drag and gravity do the rest.
        const targetSpeed = this.power * C.MAX_SPEED;
        const cosR = Math.max(0.25, Math.cos(this.roll));
        let accel;
        if (this.power > 0.03) {
            accel = clamp((targetSpeed - this.speed) * 0.9, -C.ACCEL * 0.5, C.ACCEL);
        } else {
            accel = -(this.onGround ? C.GROUND_FRICTION : 0.8 + this.speed * 0.02);
        }
        if (!this.onGround) {
            accel -= Math.sin(this.pitch) * GRAVITY * 0.9;
            accel -= (1 / cosR - 1) * 4.0;              // hauling it round a tight turn costs energy
            accel -= this.airbrake * (4 + this.speed * 0.06);
        }
        if (brakingOnGround) accel -= C.GROUND_BRAKE;
        this.speed += accel * dt;
        if (this.speed < 0) this.speed = 0;
        if (this.speed > C.MAX_SPEED * 1.35) this.speed = C.MAX_SPEED * 1.35;
        this.accelLong += (accel - this.accelLong) * Math.min(1, dt * 4);

        // 3. Attitude. Authority grows with airspeed; the air is never quite smooth.
        const authority = this.onGround ? Math.min(1, this.speed / C.ROTATE_SPEED) : 0.25 + 0.75 * Math.min(1, this.speed / C.ROTATE_SPEED);
        const lift = Math.min(1, this.speed / C.STALL_SPEED);
        const liftFactor = lift * lift;
        const gustAmp = occupied && !this.onGround ? C.TURB * (0.25 + 0.75 * Math.max(0, 1 - this.position.y / 500)) * (0.4 + 0.6 * Math.min(1, this.speed / C.MAX_SPEED)) : 0;
        const t = this._t;
        const gR = (Math.sin(t * 1.3) + 0.6 * Math.sin(t * 2.9 + 1.2) + 0.4 * Math.sin(t * 5.3 + 0.4)) * gustAmp;
        const gP = (Math.sin(t * 1.1 + 2) + 0.5 * Math.sin(t * 3.7) + 0.3 * Math.sin(t * 6.1 + 1)) * gustAmp;

        if (this.onGround) {
            this.roll += (0 - this.roll) * Math.min(1, 8 * dt);
            this.rollRate = 0;
            this.pitchRate = 0;
            this.stalled = false;
            // Nose-up only once there is enough speed to rotate
            if (ctl.p > 0.05 && this.speed >= C.ROTATE_SPEED * 0.92) {
                this.pitch = Math.min(C.MAX_PITCH, this.pitch + C.PITCH_RATE * 0.8 * authority * ctl.p * dt);
            } else {
                this.pitch += (0 - this.pitch) * Math.min(1, 4 * dt);
            }
            // Steering: the nose wheel at taxi speed, the rudder as the airflow builds. A prop's torque tugs it left.
            const steerAuth = Math.min(1, this.speed / 4) * Math.max(0.25, 1 - this.speed / 40);
            const steerIn = clamp(-ctl.r + ctl.y, -1, 1);
            this.steerAngle = steerIn * 0.6;
            this.yaw += steerIn * 0.85 * steerAuth * dt;
            if (!this.isJet && this.power > 0.5) this.yaw += 0.1 * this.power * Math.max(0, 1 - this.speed / C.ROTATE_SPEED) * dt;
        } else {
            // Pitch: rate follows the stick with inertia; let go and it settles toward trim for the current speed
            const wantRate = ctl.p * C.PITCH_RATE * authority;
            this.pitchRate += (wantRate - this.pitchRate) * Math.min(1, dt * 4);
            const trim = clamp((this.speed - C.MAX_SPEED * 0.55) * 0.004, -0.2, 0.14) + this.airbrake * 0.08;
            const hands = 1 - Math.min(1, Math.abs(ctl.p) * 2);
            this.pitchRate += (trim - this.pitch) * C.STABILITY * hands * dt * 8;
            this.pitchRate -= (1 - Math.cos(this.roll)) * 2.7 * dt * (1 - Math.min(1, ctl.p * 2));   // the nose drops in a bank
            this.pitchRate += gP * 0.25 * dt * 4;
            // Stall: the nose falls through and a wing drops, buffeting all the way
            const wasStalled = this.stalled;
            this.stalled = this.speed < C.STALL_SPEED * (wasStalled ? 1.08 : 0.92);
            if (this.stalled) {
                if (!wasStalled) this.stallSide = Math.abs(this.roll) > 0.05 ? Math.sign(this.roll) : (Math.random() < 0.5 ? -1 : 1);
                const deficit = 1 - liftFactor;
                this.pitchRate -= deficit * 3.3 * dt;
                this.rollRate += this.stallSide * deficit * 1.8 * dt;
            }
            this.pitch += this.pitchRate * dt;
            if (Math.abs(this.pitch) > C.MAX_PITCH) {
                this.pitch = Math.sign(this.pitch) * C.MAX_PITCH;
                this.pitchRate *= 0.3;
            }

            // Roll: also a rate with inertia; dihedral rolls a released bank back toward level
            const wantRoll = ctl.r * C.ROLL_RATE * authority;
            this.rollRate += (wantRoll - this.rollRate) * Math.min(1, dt * 3.2);
            this.rollRate += -this.roll * C.ROLL_STAB * (1 - Math.min(1, Math.abs(ctl.r) * 2.5)) * dt * 1.2;
            this.rollRate += gR * 0.4 * dt * 4;
            this.roll += this.rollRate * dt;
            if (Math.abs(this.roll) > C.MAX_BANK) {
                this.roll = Math.sign(this.roll) * C.MAX_BANK;
                if (Math.sign(this.rollRate) === Math.sign(this.roll)) this.rollRate *= 0.2;
            }

            // Heading: a banked wing turns it (pulling back tightens it); rudder and adverse yaw on top
            const turnSpeed = Math.max(this.speed, 12);
            const pull = 1 + Math.max(0, ctl.p) * 0.5;
            this.yaw += -Math.tan(this.roll) * (GRAVITY / turnSpeed) * C.TURN_RATE_SCALE * authority * pull * dt;
            this.yaw += ctl.y * C.RUDDER_RATE * authority * dt + this.rollRate * 0.06 * dt;
            if (!this.isJet && this.power > 0.5) this.yaw += 0.04 * this.power * dt;
            this.steerAngle = 0;
        }
        while (this.yaw > Math.PI) this.yaw -= 2 * Math.PI;
        while (this.yaw < -Math.PI) this.yaw += 2 * Math.PI;
        this.gLoad = clamp(1 / cosR + this.pitchRate * this.speed / GRAVITY, -3, 9);
        this.accelLat += ((-Math.sin(this.roll) * this.gLoad) - this.accelLat) * Math.min(1, dt * 3);

        // 4. Integrate position. Vertical speed follows the pitch with some inertia, minus sink when under-speed.
        const cosP = Math.cos(this.pitch);
        const fwdX = -Math.sin(this.yaw);
        const fwdZ = -Math.cos(this.yaw);
        this.velocity.x = fwdX * this.speed * cosP;
        this.velocity.y = fwdZ * this.speed * cosP;

        // Below ~45% throttle there isn't enough power to hold height: the plane glides down
        const glideSink = C.GLIDE_SINK * (1 - Math.min(1, this.power / 0.45));
        let vy = Math.sin(this.pitch) * this.speed - (1 - liftFactor) * C.STALL_SINK - glideSink + gP * 0.8
            - (1 - cosR) * this.speed * 0.16 * (1 - clamp(this.pitch / 0.3, 0, 1));
        if (this.onGround) vy = Math.max(0, vy);
        else vy = this.verticalSpeed + (vy - this.verticalSpeed) * Math.min(1, dt * 2.5);
        this.verticalSpeed = vy;

        this.position.x += this.velocity.x * dt;
        this.position.z += this.velocity.y * dt;
        this.position.y += vy * dt;

        // What the pilot feels through the seat
        const rough = this.onGround ? Math.min(1, this.speed / 25) * 0.45 : 0.1 + 0.35 * Math.min(1, this.speed / C.MAX_SPEED) + gustAmp * 0.12;
        const hole = this.canopyBroken && occupied ? 0.55 * Math.min(1, this.speed / 50) : 0;      // wind tearing through a broken canopy
        const shake = clamp(rough * (occupied ? 1 : 0) * (0.35 + this.power * 0.65) + (this.stalled ? 0.5 : 0) + hole, 0, 1);
        this.vibration += (shake - this.vibration) * Math.min(1, dt * 5);
        this.thump *= Math.exp(-dt * 6);

        // 5. Ground contact
        if (this.position.y <= 0) {
            let bounced = false;
            if (!this.onGround) {
                const hard = vy < -C.CRASH_SINK_RATE || Math.abs(this.roll) > 0.55 || this.pitch < -0.35;
                if (hard) {
                    this.crashed = true;
                    this.speed *= 0.45;
                    this.throttle = 0;
                }
                this.thump = Math.min(1, Math.abs(vy) / 6);
                // Touch down hard-ish and it skips back into the air once
                if (!hard && vy < -2.5 && this.speed > C.STALL_SPEED * 0.9) {
                    this.verticalSpeed = -vy * 0.28;
                    this.position.y = 0.05;
                    bounced = true;
                } else {
                    this.onGround = true;
                }
            }
            if (!bounced) {
                this.position.y = 0;
                this.verticalSpeed = 0;
            }
            if (this.pitch < 0) this.pitch = 0;
        } else if (this.onGround && vy > 0) {
            this.onGround = false;
        }
        if (this.position.y > C.MAX_ALTITUDE) {
            this.position.y = C.MAX_ALTITUDE;
            if (this.pitch > 0) this.pitch = 0;
        }

        // 6. Obstacles, world bounds, sanity
        this._syncCollisionCircles();
        if (grid) this._resolveStaticCollisions(grid);
        this._enforceWorldBounds();
        this._validateState();
        this._updateMeshTransform(dt);
    }

    /**
     * Buildings and trees only matter while the plane is lower than their roofline.
     */
    _resolveStaticCollisions(grid) {
        grid.queryRadius(this.position.x, this.position.z, this.radius + 3.0, _scratchCollisionResults, 'STATIC');
        let mtvX = 0;
        let mtvZ = 0;
        let hits = 0;
        const bottom = this.position.y;
        const top = this.position.y + this.height;
        for (let i = 0, len = _scratchCollisionResults.length; i < len; i++) {
            const item = _scratchCollisionResults[i];
            if (!item.isStatic || !item.box) continue;
            const maxY = item.box.max ? item.box.max.y : Infinity;
            const minY = item.box.min ? item.box.min.y : -Infinity;
            // Above the roof, below a floating box, or a low curb/kerb the wheels roll over: no contact
            if (bottom >= maxY - 1.0 || top <= minY) continue;

            for (let c = 0; c < 3; c++) {
                const circle = this.collisionCircles[c];
                const cx = Math.max(item.minX, Math.min(circle.x, item.maxX));
                const cz = Math.max(item.minZ, Math.min(circle.z, item.maxZ));
                const dx = circle.x - cx;
                const dz = circle.z - cz;
                const distSq = dx * dx + dz * dz;
                if (distSq < this.circleRadius * this.circleRadius) {
                    const dist = Math.sqrt(distSq);
                    if (dist < 1e-4) {
                        // Circle centre inside the box: push out along the shortest axis
                        const dMinX = circle.x - item.minX;
                        const dMaxX = item.maxX - circle.x;
                        const dMinZ = circle.z - item.minZ;
                        const dMaxZ = item.maxZ - circle.z;
                        const minD = Math.min(dMinX, dMaxX, dMinZ, dMaxZ);
                        if (minD === dMinX) mtvX -= this.circleRadius + dMinX;
                        else if (minD === dMaxX) mtvX += this.circleRadius + dMaxX;
                        else if (minD === dMinZ) mtvZ -= this.circleRadius + dMinZ;
                        else mtvZ += this.circleRadius + dMaxZ;
                    } else {
                        const pen = this.circleRadius - dist;
                        mtvX += (dx / dist) * pen;
                        mtvZ += (dz / dist) * pen;
                    }
                    hits++;
                }
            }
        }
        if (hits > 0) {
            this.position.x += mtvX;
            this.position.z += mtvZ;
            if (this.speed > 6) this.crashed = true;
            this.speed *= 0.35;
            this.throttle = Math.min(this.throttle, 0.2);
            this._syncCollisionCircles();
        }
    }

    _enforceWorldBounds() {
        const b = CONFIG.WORLD.SAFE_BOUNDS;
        const m = this.radius;
        let clamped = false;
        if (this.position.x < b.MIN_X + m) { this.position.x = b.MIN_X + m; clamped = true; }
        else if (this.position.x > b.MAX_X - m) { this.position.x = b.MAX_X - m; clamped = true; }
        if (this.position.z < b.MIN_Z + m) { this.position.z = b.MIN_Z + m; clamped = true; }
        else if (this.position.z > b.MAX_Z - m) { this.position.z = b.MAX_Z - m; clamped = true; }
        if (clamped) this.speed *= 0.97;
    }

    _validateState() {
        const p = this.position;
        if (Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) &&
            Number.isFinite(this.speed) && Number.isFinite(this.yaw) &&
            Number.isFinite(this.pitch) && Number.isFinite(this.roll)) {
            this.lastSafePosition.copy(p);
            this.lastSafeYaw = this.yaw;
        } else {
            this.position.copy(this.lastSafePosition);
            this.yaw = this.lastSafeYaw;
            this.speed = 0;
            this.pitch = 0;
            this.roll = 0;
            this.throttle = 0;
            this.velocity.set(0, 0);
        }
    }

    _updateMeshTransform(dt) {
        if (!this.mesh) return;
        this.mesh.position.copy(this.position);
        this.mesh.rotation.order = 'YXZ';
        this.mesh.rotation.y = this.yaw;
        this.mesh.rotation.x = this.pitch;
        this.mesh.rotation.z = -this.roll;
        if (dt > 0 && this.propellers.length) {
            // Idle windmill when stopped, faster with throttle and airspeed
            const spin = 6 + this.throttle * 55 + this.speed * 0.3;
            this.propAngle += spin * dt;
            for (const p of this.propellers) p.rotation.z = this.propAngle;
        }
        this._updateInstruments(dt);
    }

    /** Live gauges and moving controls of the cabin (the aircraft someone is flying): needles glide, canvases repaint ~24 times a second. */
    _updateInstruments(dt) {
        if (!this.isPlayer || !this.interior) return;
        const s = this._instState || (this._instState = { speed: 0, alt: 0, rpm: 0, vs: 0, throttle: 0, pitch: 0, roll: 0, steer: 0, pitchIn: 0, collective: 0, rudder: 0 });
        const k = Math.min(1, (dt || 1 / 60) * 8);
        s.speed += (this.speed - s.speed) * k;
        s.alt += (this.position.y - s.alt) * k;
        s.vs += (this.verticalSpeed - s.vs) * k;
        const rpm = this.isHelicopter ? this.rotorRpm : 0.25 + this.power * 0.75;
        s.rpm += (rpm - s.rpm) * k;
        s.throttle += (this.throttle - s.throttle) * k;
        s.maxSpeed = this.cfg.MAX_SPEED || this.cfg.maxSpeed || 80;
        s.pitch = this.pitch;
        s.roll = this.roll;
        s.yaw = this.yaw;
        // the controls move at once, with the (already smoothed) stick
        s.steer = -this.ctl.r;
        s.pitchIn = this.ctl.p;
        s.rudder = this.isHelicopter ? this.ctl.r : this.ctl.y;
        s.collective = this.isHelicopter ? this.collective : (this.inputThrottle > 0 ? 1 : 0) - (this.inputBrake > 0 ? 1 : 0);
        this._instrumentT = (this._instrumentT || 0) - (dt || 0);
        s.alarm = this.canopyBroken && !this.open ? 1 : 0;
        s.flash = Math.floor(this._t * 4) % 2 === 0;
        s.redraw = this._instrumentT <= 0;
        if (s.redraw) this._instrumentT = 1 / 24;
        this.interior.update(s);
    }
}
