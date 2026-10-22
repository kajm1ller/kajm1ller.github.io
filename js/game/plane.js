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

const GRAVITY = 9.8;
const _circleOffsets = [2.8, 0.0, -2.8];
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
            trim: new THREE.MeshLambertMaterial({ color: 0xcc2222 }),
            glass: new THREE.MeshLambertMaterial({ color: 0x4488aa, transparent: true, opacity: 0.55, depthWrite: false }),
            dark: new THREE.MeshLambertMaterial({ color: 0x222222 }),
            metal: new THREE.MeshLambertMaterial({ color: 0x888888 }),
            prop: new THREE.MeshLambertMaterial({ color: 0x1a1a1a }),
            lightRed: new THREE.MeshBasicMaterial({ color: 0xff2222 }),
            lightGreen: new THREE.MeshBasicMaterial({ color: 0x22ff44 })
        };
    }
    return _mats;
}

const _bodyMats = new Map();
function getBodyMat(color) {
    if (!_bodyMats.has(color)) {
        _bodyMats.set(color, new THREE.MeshLambertMaterial({ color }));
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
    CRASH_SINK_RATE: 9.0      // descending faster than this on touchdown is a hard landing
});

export class Plane {
    /**
     * @param {string|number} id
     * @param {number} x
     * @param {number} z
     * @param {number} yaw heading in radians (0 = facing -Z)
     * @param {number} color body paint
     */
    constructor(id, x = 0, z = 0, yaw = 0, color = 0xf2f2f2) {
        this.id = id;
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
        this.length = 9.5;
        this.width = 7.0;
        this.height = 3.0;
        this.radius = 5.6;
        this.circleRadius = 1.9;
        this.interactionRadius = 8.0;
        // Aircraft are big: the chase camera sits farther back and higher than for a car
        this.chaseCamera = { chaseDistance: 17.0, chaseHeight: 4.8, targetLookHeight: 1.8 };
        this.maxForwardSpeed = PLANE_CONFIG.MAX_SPEED;
        this.maxReverseSpeed = 0;

        // Compat with Vehicle inputs
        this.inputThrottle = 0;
        this.inputBrake = 0;
        this.inputSteer = 0;
        this.inputHandbrake = false;
        this.inputPitch = 0;     // +1 = nose up (set by the game from the arrow keys)

        this.lastSafePosition = new THREE.Vector3(x, 0, z);
        this.lastSafeYaw = yaw;

        this.collisionCircles = [
            { x: 0, z: 0, radius: this.circleRadius },
            { x: 0, z: 0, radius: this.circleRadius },
            { x: 0, z: 0, radius: this.circleRadius }
        ];
        this._syncCollisionCircles();

        const built = createPlaneMesh(color, id);
        this.mesh = built.root;
        this.mesh.userData.vehicle = this;
        this.propeller = built.propeller;
        this.propAngle = 0;
        this._updateMeshTransform(0);
    }

    // ---- Vehicle-interface helpers -------------------------------------------------

    setDoorAngle() {}

    /** The pilot can only climb out when the plane is on the ground and nearly stopped. */
    canExit() {
        return this.position.y <= 0.05 && Math.abs(this.speed) < 6;
    }

    setPlayerControlled(isControlled) {
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
            this.collisionCircles[i].x = this.position.x + _circleOffsets[i] * fwdX;
            this.collisionCircles[i].z = this.position.z + _circleOffsets[i] * fwdZ;
        }
    }

    // ---- Simulation ----------------------------------------------------------------

    /**
     * @param {number} dt seconds
     * @param {SpatialGrid} [grid] static obstacles are only hit while flying below their roofline
     */
    update(dt, grid = null) {
        if (!dt || dt <= 0) return;
        this.crashed = false;
        if (this.wrecked) {
            // Exploded: the game hides the mesh; keep the husk motionless where it blew up
            this.speed = 0;
            this.throttle = 0;
            this.velocity.set(0, 0);
            this.verticalSpeed = 0;
            return;
        }
        const C = PLANE_CONFIG;
        const occupied = this.isPlayer;

        // 1. Throttle lever. Unoccupied planes idle with the engine off.
        if (occupied) {
            if (this.inputThrottle > 0) this.throttle = Math.min(1, this.throttle + C.THROTTLE_RATE * dt);
            if (this.inputBrake > 0 && !this.onGround) this.throttle = Math.max(0, this.throttle - C.THROTTLE_RATE * dt);
        } else {
            this.throttle = 0;
        }
        const brakingOnGround = this.onGround && (this.inputHandbrake || (occupied && this.inputBrake > 0 && this.throttle <= 0.02));

        // 2. Airspeed. Pitch trades speed for height (climbing bleeds speed, diving gains it).
        const targetSpeed = this.throttle * C.MAX_SPEED;
        let accel = 0;
        if (this.throttle > 0.02) {
            accel = Math.sign(targetSpeed - this.speed) * C.ACCEL * (this.speed < targetSpeed ? 1 : 0.5);
            if (Math.abs(targetSpeed - this.speed) < 0.4) accel = 0;
        } else if (this.speed > 0) {
            accel = -(this.onGround ? C.GROUND_FRICTION : 1.0); // coast down with the engine off
        }
        if (!this.onGround) accel -= Math.sin(this.pitch) * GRAVITY * 0.9;
        if (brakingOnGround) accel -= C.GROUND_BRAKE;
        this.speed += accel * dt;
        if (this.speed < 0) this.speed = 0;
        if (this.speed > C.MAX_SPEED * 1.35) this.speed = C.MAX_SPEED * 1.35;

        // 3. Control surfaces. Authority grows with airspeed.
        const authority = Math.min(1, this.speed / C.ROTATE_SPEED);
        const lift = Math.min(1, (this.speed / C.STALL_SPEED));
        const liftFactor = lift * lift;

        if (this.onGround) {
            this.roll += (0 - this.roll) * Math.min(1, 8 * dt);
            // Nose-up only once there is enough speed to rotate
            if (this.inputPitch > 0 && this.speed >= C.ROTATE_SPEED) {
                this.pitch = Math.min(C.MAX_PITCH, this.pitch + C.PITCH_RATE * authority * dt);
            } else {
                this.pitch += (0 - this.pitch) * Math.min(1, 5 * dt);
            }
            // Nose-wheel steering, tighter at taxi speeds
            const steerAuth = Math.min(1, this.speed / 4) * Math.max(0.25, 1 - this.speed / 40);
            this.steerAngle = this.inputSteer * 0.6;
            this.yaw += this.inputSteer * 0.85 * steerAuth * dt;
        } else {
            // Pitch
            if (this.inputPitch !== 0) {
                this.pitch += this.inputPitch * C.PITCH_RATE * authority * dt;
            } else {
                this.pitch += (0 - this.pitch) * Math.min(1, 0.5 * dt); // gentle auto-level
            }
            // Stalled wings drop the nose
            if (liftFactor < 1) this.pitch -= (1 - liftFactor) * 0.7 * dt;
            this.pitch = Math.max(-C.MAX_PITCH, Math.min(C.MAX_PITCH, this.pitch));

            // Roll toward the commanded bank (A = left, D = right), self-levels when released
            const targetBank = -this.inputSteer * C.MAX_BANK;
            const rollStep = C.ROLL_RATE * dt;
            const dr = targetBank - this.roll;
            this.roll += Math.max(-rollStep, Math.min(rollStep, dr));

            // Coordinated turn: bank converts into a heading change
            const turnSpeed = Math.max(this.speed, 12);
            this.yaw += -Math.tan(this.roll) * (GRAVITY / turnSpeed) * C.TURN_RATE_SCALE * authority * dt;
            this.steerAngle = 0;
        }
        while (this.yaw > Math.PI) this.yaw -= 2 * Math.PI;
        while (this.yaw < -Math.PI) this.yaw += 2 * Math.PI;

        // 4. Integrate position. Vertical speed follows the pitch, minus sink when under-speed.
        const cosP = Math.cos(this.pitch);
        const fwdX = -Math.sin(this.yaw);
        const fwdZ = -Math.cos(this.yaw);
        this.velocity.x = fwdX * this.speed * cosP;
        this.velocity.y = fwdZ * this.speed * cosP;

        // Below ~45% throttle there isn't enough power to hold height: the plane glides down
        const glideSink = C.GLIDE_SINK * (1 - Math.min(1, this.throttle / 0.45));
        let vy = Math.sin(this.pitch) * this.speed - (1 - liftFactor) * C.STALL_SINK - glideSink;
        if (this.onGround) vy = Math.max(0, vy);
        this.verticalSpeed = vy;

        this.position.x += this.velocity.x * dt;
        this.position.z += this.velocity.y * dt;
        this.position.y += vy * dt;

        // 5. Ground contact
        if (this.position.y <= 0) {
            if (!this.onGround) {
                const hard = vy < -C.CRASH_SINK_RATE || Math.abs(this.roll) > 0.55 || this.pitch < -0.35;
                if (hard) {
                    this.crashed = true;
                    this.speed *= 0.45;
                    this.throttle = 0;
                }
                this.onGround = true;
            }
            this.position.y = 0;
            this.verticalSpeed = 0;
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
        if (dt > 0 && this.propeller) {
            // Idle windmill when stopped, faster with throttle and airspeed
            const spin = 6 + this.throttle * 55 + this.speed * 0.3;
            this.propAngle += spin * dt;
            this.propeller.rotation.z = this.propAngle;
        }
    }
}
