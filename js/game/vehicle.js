/**
 * js/game/vehicle.js
 *
 * High-performance Vehicle Physics, Collision Response, and Kaj Simulator car meshes.
 *
 * Conforms to:
 * - Multiple car models from js/game/carModels.js (Civic, hatchback, sports coupe, muscle car,
 *   SUV, pickup, van, cruiser, taxi): each sets the body, dimensions, physics, gearbox and engine
 *   sound; the default is Kaj's Honda Civic, whose handling is unchanged
 * - Extended Kinematic Bicycle model with slip angle and lateral grip damping
 * - Simulated automatic gearbox and engine RPM (drives the tachometer and the engine sound)
 * - Project coordinate frame: yaw=0 points along -Z (Three.js standard camera & roadNetwork convention)
 * - 2D planar collision detection (3-circle decomposition sized to each model)
 * - Contact normal MTV separation and impulse reflection against SpatialGrid obstacles
 * - World boundary clamping at the edge of the map (CONFIG.WORLD.SAFE_BOUNDS)
 * - Defensive Number.isFinite() validation with lastSafePosition corruption recovery
 * - Zero GC allocation during active 60Hz physics stepping
 * - PROJECT.md § Interface Contracts (3. Vehicle Interface)
 */

import * as THREE from 'three';
import { CONFIG } from './config.js';
import {
    getCarModel, buildCarMesh, cabinShape, getModelGeometry, buildCabinFrame,
    getPartMaterials, getPaintMaterial, DEFAULT_CAR_MODEL
} from './carModels.js';

// Pre-allocated reusable scratch vectors for zero-allocation physics stepping
const _scratchForward = new THREE.Vector3();
const _scratchRight = new THREE.Vector3();
const _scratchImpulse = new THREE.Vector3();
const _scratchCollisionResults = [];

// Handling every model starts from (Kaj's Civic); models override what differs
const BASE_PHYSICS = Object.freeze({
    maxForwardSpeed: 28.0,            // Max forward velocity (m/s)
    maxReverseSpeed: -9.0,            // Max reverse velocity (m/s)
    baseAccel: 9.5,                   // Stall forward acceleration (m/s^2)
    reverseAccel: 5.0,                // Reverse gear acceleration (m/s^2)
    brakeDecel: 16.0,                 // Braking deceleration (m/s^2)
    handbrakeDecel: 24.0,             // Handbrake deceleration (m/s^2)
    rollingFriction: 0.6,             // Rolling resistance (m/s^2)
    dragCoeff: 0.0035,                // Aerodynamic drag coefficient
    normalGrip: 36.0,                 // High normal lateral tire grip so cars track road without drifting (s^-1)
    handbrakeGrip: 2.5,               // Drifting lateral grip damping factor (s^-1)
    maxSteerAngle: 0.55,              // Maximum wheel turn angle (~31.5 deg)
    steerSpeed: 4.5,                  // Steering turn rate (rad/s)
    steerCenterSpeed: 6.0             // Steering auto-centering rate (rad/s)
});

// ============================================================================
// Legacy pools (kept for callers of the old Civic-only API)
// ============================================================================
export class CivicGeometryPool {
    static get() {
        return getModelGeometry(DEFAULT_CAR_MODEL);
    }

    static disposeAll() {}
}

export class CivicMaterialPool {
    static getCommon() {
        return getPartMaterials();
    }

    static getBodyMaterial(colorHex = 0x111111) {
        return getPaintMaterial(colorHex);
    }

    static disposeAll() {}
}

/**
 * Builds a car mesh hierarchy with steerable front wheels, rolling wheels and an opening door.
 *
 * @param {number} [color=0x111111] Body paint color hex (0x111111 is Kaj Simulator black)
 * @param {string|number} [id='civic'] Vehicle ID
 * @param {string} [modelId='civic'] Car model (see carModels.js)
 * @returns {{ root: THREE.Group, wheelPivots: object, wheels: object, leftDoorPivot: THREE.Group, cabinAnchor: THREE.Group }}
 */
export function createOptimizedHondaCivic(color = 0x111111, id = 'civic', modelId = DEFAULT_CAR_MODEL) {
    return buildCarMesh(modelId, color, id);
}

export const createHondaCivic = (color = 0x111111, id = 'civic', modelId = DEFAULT_CAR_MODEL) => createOptimizedHondaCivic(color, id, modelId).root;
export const createCarMesh = createHondaCivic;

export class Vehicle {
    /**
     * @param {string|number} id Unique identifier
     * @param {number} [x=0] Initial X coordinate
     * @param {number} [z=0] Initial Z coordinate
     * @param {number} [yaw=0] Initial heading in radians (0 = facing -Z)
     * @param {number} [color=0x111111] Body color hex (defaults to Kaj Simulator black 0x111111)
     * @param {boolean} [isPlayer=false] Whether this vehicle is player-driven
     * @param {string} [modelId='civic'] Car model (see carModels.js)
     */
    constructor(id, x = 0, z = 0, yaw = 0, color = 0x111111, isPlayer = false, modelId = DEFAULT_CAR_MODEL) {
        const model = getCarModel(modelId);
        this.id = id;
        this.isPlayer = !!isPlayer;
        this.isHondaCivic = true; // every drivable car shares the Civic's interfaces (cockpit, windows, carjacking)
        this.model = model;
        this.modelId = model.id;
        this.modelName = model.name;
        this.color = color;
        this.bodyColor = color;

        // Pose
        this.position = new THREE.Vector3(x, 0, z);
        this.velocity = new THREE.Vector2(0, 0); // Horizontal world velocity [vx, vz]
        this.yaw = yaw;                         // Heading angle in radians (0 = -Z)
        this.speed = 0;                         // Signed longitudinal speed (m/s)
        this.steerAngle = 0;                    // Current front wheel steer angle (radians)
        this.bumpHeave = 0;                     // Visual-only suspension jolt (m), see bump()
        this.bumpPitch = 0;                     // ... and nose-up pitch (radians)
        this._bumpVel = 0;
        this._pitchVel = 0;

        // Physical dimensions from the model (the Civic keeps CONFIG.VEHICLE's 4.5 x 2.2)
        this.length = model.length;
        this.width = model.width;
        this.height = model.cabin.roof;
        this.radius = Math.max(this.length, this.width) / 2;       // Bounding circle for broadphase
        this.circleRadius = this.width / 2;                         // 3-circle decomposition radius
        const circleOffset = this.length / 2 - this.circleRadius + 0.2;
        this._circleOffsets = [circleOffset, 0.0, -circleOffset];   // Front, centre, rear along heading
        this.wheelRadius = model.wheels.radius;
        const civicChassis = model.id === DEFAULT_CAR_MODEL || model.base === DEFAULT_CAR_MODEL;
        this.wheelbase = civicChassis ? 2.8 : (model.wheels.rear - model.wheels.front) + 0.2; // Axle-to-axle kinematic wheelbase (m)
        this.halfWheelbase = this.wheelbase / 2;                    // CoM to axle distance (lf = lr)

        // Dynamics constants (see BASE_PHYSICS)
        Object.assign(this, BASE_PHYSICS, model.physics);

        // Driver's eye in car space (cockpit camera) and the gearbox / engine
        this.driverEye = Object.freeze(Object.assign({}, cabinShape(model).eye));
        this.engineSpec = model.engine;
        this.gear = 1;                          // -1 reverse, 0 neutral (engine off), 1..n drive
        this.rpm = model.engine.idle;
        this.throttleSmoothed = 0;
        this.shiftCount = 0;
        this._shiftTimer = 0;
        this._rpmWobble = 0;

        // Defensive snapshot for NaN/Infinity corruption recovery
        this.lastSafePosition = new THREE.Vector3(x, 0, z);
        this.lastSafeYaw = yaw;

        // Input state
        this.inputThrottle = 0;
        this.inputSteer = 0;
        this.inputBrake = 0;
        this.inputHandbrake = false;

        // Drift boost state (player only): drifting under handbrake charges a boost released with the handbrake
        this.driftCharge = 0;                   // Accumulated drift charge (0..driftChargeMax)
        this.driftChargeMax = 3.0;
        this.handbrakeHeldTime = 0;             // Seconds the handbrake has been held continuously
        this.driftCancelled = false;            // Set when held >3s or stopped; boost is lost until release
        this.boostTimer = 0;                    // Seconds of boost remaining
        this.boostAccel = 34.0;                 // Extra forward acceleration while boosting (m/s^2)
        this.boostSpeedMultiplier = 1.7;        // Top speed multiplier while boosting
        this._prevHandbrake = false;

        // Collision scratch buffers (reusable across ticks)
        this.collisionCircles = [
            { x: 0, z: 0, radius: this.circleRadius },
            { x: 0, z: 0, radius: this.circleRadius },
            { x: 0, z: 0, radius: this.circleRadius }
        ];
        this._syncCollisionCircles();

        // 3D car mesh
        const carData = buildCarMesh(model.id, color, id);
        this.mesh = carData.root;
        this.mesh.userData.vehicle = this;
        this.wheelPivots = carData.wheelPivots;
        this.wheels = carData.wheels;
        this.leftDoorPivot = carData.leftDoorPivot || null;
        this.cabinAnchor = carData.cabinAnchor;
        this.doorOpenAngle = 0;
        this.wheelRoll = 0;
        this._updateMeshTransform(0);
    }

    /** Gear shown on the dash: 'P' with the engine off, 'R', 'N', or the gear number. */
    get gearLabel() {
        if (this.engineOn === false) return 'P';
        if (this.gear < 0) return 'R';
        if (this.gear === 0) return 'N';
        return String(this.gear);
    }

    /**
     * Sets driver side door open angle in radians (0 = closed, ~1.15 rad = wide open).
     * @param {number} angle
     */
    setDoorAngle(angle = 0) {
        this.doorOpenAngle = angle;
        if (this.leftDoorPivot) {
            // Positive Y rotation swings the front-hinged left door outward
            this.leftDoorPivot.rotation.y = -Math.abs(angle);
        }
        this.setCabinSeeThrough(Math.abs(angle) > 0.01);
    }

    /**
     * From outside, the cabin is a solid tinted block behind the glass. While a door is open
     * (or the glass is shot out) it gives way to its pillars and roof edges so the interior shows.
     * @param {boolean} see
     */
    setCabinSeeThrough(see) {
        if (!this.mesh) return;
        const cabin = this.mesh.getObjectByName('cabin_roof');
        if (!cabin) return;
        const permanent = !!(this.interior && this.interior.cabinExposed);
        if (see || permanent) {
            if (!this.cabinFrame) {
                this.cabinFrame = buildCabinFrame(this.modelId);
                this.cabinFrame.name = 'cabin_frame';
                this.cabinFrame.castShadow = this.cabinFrame.receiveShadow = true;
                this.mesh.add(this.cabinFrame);
            }
            this.cabinFrame.visible = true;
            cabin.visible = false;
        } else {
            if (this.cabinFrame) this.cabinFrame.visible = false;
            cabin.visible = true;
        }
        if (this.interior && typeof this.interior.updateVisibility === 'function') this.interior.updateVisibility();
    }

    /**
     * Synchronizes the 3 bounding circles with current position and yaw.
     */
    _syncCollisionCircles() {
        const sinYaw = Math.sin(this.yaw);
        const cosYaw = Math.cos(this.yaw);
        const fwdX = -sinYaw;
        const fwdZ = -cosYaw;
        for (let i = 0; i < 3; i++) {
            const offset = this._circleOffsets[i];
            const circle = this.collisionCircles[i];
            circle.x = this.position.x + offset * fwdX;
            circle.z = this.position.z + offset * fwdZ;
        }
    }

    /**
     * Initializes mesh into the scene.
     * @param {THREE.Scene} scene
     * @param {Object} [sharedMaterials]
     */
    initMesh(scene, sharedMaterials = null) {
        if (scene && this.mesh && !this.mesh.parent) {
            scene.add(this.mesh);
        }
        return this.mesh;
    }

    /**
     * Sets player-controlled status.
     * @param {boolean} isControlled
     */
    setPlayerControlled(isControlled) {
        this.isPlayer = !!isControlled;
    }

    /**
     * Sets control inputs for the vehicle.
     * Robustly resolves contradictory inputs (e.g. simultaneous W+S or A+D).
     * 
     * @param {boolean|number} throttle Forward throttle demand [0, 1]
     * @param {number|{left: boolean, right: boolean}} steer Steering demand [-1, 1] (negative = right, positive = left)
     * @param {boolean|number} brake Braking / reverse demand [0, 1]
     * @param {boolean} [handbrake=false] Handbrake state
     */
    setInputs(throttle, steer, brake, handbrake = false) {
        if (typeof steer === 'object' && steer !== null) {
            const left = !!steer.left;
            const right = !!steer.right;
            this.inputSteer = (left ? 1 : 0) - (right ? 1 : 0);
        } else if (typeof steer === 'number') {
            this.inputSteer = Math.max(-1, Math.min(1, steer));
        } else {
            this.inputSteer = 0;
        }

        this.inputThrottle = typeof throttle === 'number' ? Math.max(0, Math.min(1, throttle)) : (throttle ? 1 : 0);
        this.inputBrake = typeof brake === 'number' ? Math.max(0, Math.min(1, brake)) : (brake ? 1 : 0);
        this.inputHandbrake = !!handbrake;

        // Contradictory Input Safety: braking takes priority over simultaneous throttle
        if (this.inputThrottle > 0 && this.inputBrake > 0) {
            this.inputThrottle = 0;
        }
        // A smashed-up car (carCrash.js `damage`) has lost power; a wreck barely limps
        const dmg = this.damage || 0;
        if (dmg > 0.3) this.inputThrottle *= Math.max(0.2, 1 - (dmg - 0.3) * 0.8);
    }

    /**
     * Executes a single fixed physics simulation step.
     * Guaranteed zero garbage collection allocations.
     * 
     * @param {number} dt Timestep in seconds (e.g. 1/60)
     * @param {SpatialGrid|Object} [spatialGridOrInput=null] Spatial hash grid broadphase or input object
     * @param {SpatialGrid} [spatialGrid=null] Spatial hash grid broadphase
     * @param {Object} [roadNetwork=null] Road network graph
     */
    update(dt, spatialGridOrInput = null, spatialGrid = null, roadNetwork = null) {
        if (!dt || dt <= 0) return;

        let grid = spatialGrid;
        if (spatialGridOrInput && typeof spatialGridOrInput.queryRadius === 'function') {
            grid = spatialGridOrInput;
        } else if (spatialGridOrInput && typeof spatialGridOrInput === 'object') {
            this.setInputs(
                spatialGridOrInput.throttle !== undefined ? spatialGridOrInput.throttle : spatialGridOrInput.w,
                spatialGridOrInput.steer !== undefined ? spatialGridOrInput.steer : { left: !!spatialGridOrInput.a, right: !!spatialGridOrInput.d },
                spatialGridOrInput.brake !== undefined ? spatialGridOrInput.brake : spatialGridOrInput.s,
                spatialGridOrInput.handbrake !== undefined ? spatialGridOrInput.handbrake : spatialGridOrInput.space
            );
        }

        // 1. Speed-sensitive steering smoothing
        const speedMagnitude = Math.abs(this.speed);
        const speedSteerFactor = 1.0 / (1.0 + 0.05 * speedMagnitude);
        const effectiveMaxSteer = this.maxSteerAngle * speedSteerFactor;
        const targetSteer = this.inputSteer * effectiveMaxSteer;

        const steerRate = (this.inputSteer === 0) ? this.steerCenterSpeed : this.steerSpeed;
        const steerDelta = targetSteer - this.steerAngle;
        const maxSteerStep = steerRate * dt;
        this.steerAngle += Math.max(-maxSteerStep, Math.min(maxSteerStep, steerDelta));

        // 2. Longitudinal acceleration & transmission state machine
        let accel = 0;

        if (this.inputHandbrake) {
            if (speedMagnitude > 0.1) {
                accel = -Math.sign(this.speed) * this.handbrakeDecel;
            } else {
                this.speed = 0;
            }
        } else {
            if (this.inputThrottle > 0) {
                if (this.speed < -0.5) {
                    accel = this.brakeDecel;
                } else {
                    const speedRatio = Math.max(0, Math.min(1, this.speed / this.maxForwardSpeed));
                    const powerCurve = Math.max(0, 1.0 - Math.pow(speedRatio, 1.2));
                    accel = this.inputThrottle * this.baseAccel * powerCurve;
                }
            } else if (this.inputBrake > 0) {
                if (this.speed > 0.3) {
                    accel = -this.inputBrake * this.brakeDecel;
                } else {
                    const reverseRatio = Math.max(0, Math.min(1, Math.abs(this.speed) / Math.abs(this.maxReverseSpeed)));
                    const reverseCurve = Math.max(0, 1.0 - reverseRatio * 0.8);
                    accel = -this.inputBrake * this.reverseAccel * reverseCurve;
                }
            } else {
                if (speedMagnitude > 0.05) {
                    const drag = this.dragCoeff * this.speed * speedMagnitude;
                    const friction = Math.sign(this.speed) * this.rollingFriction;
                    accel = -(friction + drag);
                } else {
                    this.speed = 0;
                }
            }
        }

        // Drift boost: release (handbrake -> off) with enough charge fires the boost
        if (this.isPlayer) {
            if (this._prevHandbrake && !this.inputHandbrake) {
                if (!this.driftCancelled && this.driftCharge >= 0.3 && this.speed > 1.0) {
                    this.boostTimer = 0.5 + this.driftCharge * 0.6;
                    this.speed += 6.0 + this.driftCharge * 2.0;
                }
                this.driftCharge = 0;
                this.handbrakeHeldTime = 0;
                this.driftCancelled = false;
            }
            this._prevHandbrake = this.inputHandbrake;
        }

        const boosting = this.boostTimer > 0;
        if (boosting) {
            this.boostTimer = Math.max(0, this.boostTimer - dt);
            if (!this.inputHandbrake && this.speed >= 0) accel += this.boostAccel;
        }
        const speedCap = boosting ? this.maxForwardSpeed * this.boostSpeedMultiplier : this.maxForwardSpeed;

        // Integrate longitudinal speed
        const prevSpeed = this.speed;
        this.speed += accel * dt;

        // Bleed off boost overspeed once the boost ends
        if (!boosting && this.speed > this.maxForwardSpeed) {
            this.speed = Math.max(this.maxForwardSpeed, this.speed - 14.0 * dt);
        }

        // Zero-crossing snap when braking to prevent reverse oscillation
        if ((prevSpeed > 0 && this.speed < 0 && this.inputThrottle === 0 && this.inputBrake > 0 && prevSpeed < 2.0) ||
            (prevSpeed < 0 && this.speed > 0 && this.inputThrottle > 0 && this.inputBrake === 0 && prevSpeed > -2.0)) {
            this.speed = 0;
        }

        // Clamp to physical speed limits
        this.speed = Math.max(this.maxReverseSpeed, Math.min(speedCap, this.speed));

        // Gearbox and engine revs follow the road speed
        this._updateDrivetrain(dt);

        // 3. Extended Kinematic Bicycle model equations
        const tanDelta = Math.tan(this.steerAngle);
        const beta = Math.atan((this.halfWheelbase / this.wheelbase) * tanDelta);

        if (Math.abs(this.speed) > 0.01) {
            const yawRate = (this.speed / this.wheelbase) * Math.cos(beta) * tanDelta;
            this.yaw += yawRate * dt;

            while (this.yaw > Math.PI) this.yaw -= 2 * Math.PI;
            while (this.yaw < -Math.PI) this.yaw += 2 * Math.PI;
        }

        // Unit heading vectors (Three.js standard: yaw=0 faces -Z)
        const sinYaw = Math.sin(this.yaw);
        const cosYaw = Math.cos(this.yaw);
        _scratchForward.set(-sinYaw, 0, -cosYaw);
        _scratchRight.set(cosYaw, 0, -sinYaw);

        // Decompose velocity into longitudinal and lateral components
        let vLong = this.speed;
        let vLat = this.velocity.x * _scratchRight.x + this.velocity.y * _scratchRight.z;

        // Drift charge: sideways slip while the handbrake is held builds the boost
        if (this.isPlayer && this.inputHandbrake) {
            this.handbrakeHeldTime += dt;
            if (this.handbrakeHeldTime > 3.0 || Math.abs(this.speed) < 0.3) {
                this.driftCancelled = true;
            }
            if (this.driftCancelled) {
                this.driftCharge = 0;
            } else {
                this.driftCharge = Math.min(this.driftChargeMax, this.driftCharge + Math.min(Math.abs(vLat), 12.0) * dt * 0.25);
            }
        }

        // Lateral grip damping
        const gripFactor = this.inputHandbrake ? this.handbrakeGrip : this.normalGrip;
        vLat *= Math.max(0, 1.0 - gripFactor * dt);

        // Reconstruct world velocity
        this.velocity.x = vLong * _scratchForward.x + vLat * _scratchRight.x;
        this.velocity.y = vLong * _scratchForward.z + vLat * _scratchRight.z;

        // 4. Integrate horizontal position
        this.position.x += this.velocity.x * dt;
        this.position.z += this.velocity.y * dt;

        // 5. Collision detection & response against SpatialGrid obstacles
        if (grid) {
            this._resolveCollisions(grid);
        } else {
            this._syncCollisionCircles();
        }

        // 6. Hard world boundary clamping at the edge of the map
        this._enforceWorldBounds();

        // 7. Defensive validation & lastSafePosition recovery
        this._validateState();

        // 8. Update visual 3D mesh transforms
        this._updateMeshTransform(dt);
    }

    /**
     * Automatic gearbox: picks a gear from road speed and throttle and sets the engine RPM. Purely
     * for the gauges and the engine sound; it doesn't change the car's acceleration.
     * @param {number} dt
     */
    _updateDrivetrain(dt) {
        const e = this.engineSpec;
        const idle = e.idle, red = e.redline;
        this.throttleSmoothed += ((this.inputThrottle || 0) - this.throttleSmoothed) * Math.min(1, dt * 10);
        if (this.engineOn === false) {
            this.gear = 0;
            this.rpm = Math.max(0, this.rpm - 2500 * dt);
            return;
        }
        const t = this.throttleSmoothed;
        const spd = this.speed;
        const vTop = Math.max(1, this.maxForwardSpeed * 1.04);
        const n = e.gears.length;
        let target;
        if (spd < -0.3 || (this.inputBrake > 0 && spd < 0.3)) {
            this.gear = -1;
            target = idle + (red - idle) * Math.min(1, -spd / (vTop * 0.28)) * 0.75 + this.inputBrake * 400;
        } else {
            if (this.gear < 1) this.gear = 1;
            const rpmIn = (g) => red * Math.max(0, spd) / (e.gears[g - 1] * vTop);
            if (this._shiftTimer > 0) {
                this._shiftTimer -= dt;
            } else {
                // Short shifts when cruising, revs it out at full throttle; the downshift only
                // happens when the lower gear wouldn't immediately shift back up
                const up = idle + (red - idle) * (0.42 + 0.53 * t);
                const down = idle + (red - idle) * (0.12 + 0.26 * t);
                if (this.gear < n && rpmIn(this.gear) > up) {
                    this.gear++;
                    this.shiftCount++;
                    this._shiftTimer = 0.35;
                } else if (this.gear > 1 && rpmIn(this.gear) < down && rpmIn(this.gear - 1) < up * 0.9) {
                    this.gear--;
                    this._shiftTimer = 0.3;
                }
            }
            target = Math.max(idle, rpmIn(this.gear));
            // Torque converter slip pulling away
            if (this.gear === 1) target = Math.max(target, idle + t * (red - idle) * 0.42);
        }
        if (this.inputHandbrake) target = idle + t * (red - idle) * 0.9; // clutch in: free revs
        if (this.boostTimer > 0) {
            this._rpmWobble += dt * 38;
            target = red * (0.95 + 0.03 * Math.sin(this._rpmWobble));
        }
        target = Math.min(red * 1.01, target);
        const rate = target > this.rpm ? 7 + 5 * t : 5;
        this.rpm += (target - this.rpm) * Math.min(1, dt * rate);
        if (!Number.isFinite(this.rpm)) this.rpm = idle;
    }

    /**
     * Resolves collisions using 3-circle decomposition against static AABBs and dynamic vehicles.
     * Guaranteed zero heap allocations.
     * 
     * @param {SpatialGrid} spatialGrid
     */
    _resolveCollisions(spatialGrid) {
        const sinYaw = Math.sin(this.yaw);
        const cosYaw = Math.cos(this.yaw);
        const fwdX = -sinYaw;
        const fwdZ = -cosYaw;

        // Update 3 collision circles along vehicle longitudinal centerline
        for (let i = 0; i < 3; i++) {
            const offset = this._circleOffsets[i];
            const circle = this.collisionCircles[i];
            circle.x = this.position.x + offset * fwdX;
            circle.z = this.position.z + offset * fwdZ;
        }

        // Broadphase query around vehicle bounding circle (2.25m + 3.0m margin)
        spatialGrid.queryRadius(this.position.x, this.position.z, this.radius + 3.0, _scratchCollisionResults, 'ALL');

        let totalMtvX = 0;
        let totalMtvZ = 0;
        let collisionCount = 0;

        for (let i = 0, len = _scratchCollisionResults.length; i < len; i++) {
            const item = _scratchCollisionResults[i];

            if (item.id === this.id || item.entityRef === this) continue;

            // --- STATIC OBSTACLE (AABB) ---
            if (item.isStatic && item.box) {
                const minX = item.minX;
                const maxX = item.maxX;
                const minZ = item.minZ;
                const maxZ = item.maxZ;

                for (let c = 0; c < 3; c++) {
                    const circle = this.collisionCircles[c];
                    const cx = Math.max(minX, Math.min(circle.x, maxX));
                    const cz = Math.max(minZ, Math.min(circle.z, maxZ));
                    const dx = circle.x - cx;
                    const dz = circle.z - cz;
                    const distSq = dx * dx + dz * dz;

                    if (distSq < this.circleRadius * this.circleRadius) {
                        let dist = Math.sqrt(distSq);
                        let nx = 0;
                        let nz = 0;
                        let penetration = 0;

                        if (dist < 1e-4) {
                            const dMinX = circle.x - minX;
                            const dMaxX = maxX - circle.x;
                            const dMinZ = circle.z - minZ;
                            const dMaxZ = maxZ - circle.z;
                            const minD = Math.min(dMinX, dMaxX, dMinZ, dMaxZ);

                            if (minD === dMinX) { nx = -1; nz = 0; penetration = this.circleRadius + dMinX; }
                            else if (minD === dMaxX) { nx = 1; nz = 0; penetration = this.circleRadius + dMaxX; }
                            else if (minD === dMinZ) { nx = 0; nz = -1; penetration = this.circleRadius + dMinZ; }
                            else { nx = 0; nz = 1; penetration = this.circleRadius + dMaxZ; }
                        } else {
                            nx = dx / dist;
                            nz = dz / dist;
                            penetration = this.circleRadius - dist;
                        }

                        totalMtvX += nx * penetration;
                        totalMtvZ += nz * penetration;
                        collisionCount++;
                    }
                }
            }
            // --- DYNAMIC VEHICLE (Circle vs Circle) ---
            else if (!item.isStatic && item.entityRef && item.entityRef.collisionCircles) {
                const other = item.entityRef;
                const dxV = other.position.x - this.position.x;
                const dzV = other.position.z - this.position.z;
                const combinedRadius = this.radius + (other.radius || 2.25);
                if (dxV * dxV + dzV * dzV > combinedRadius * combinedRadius) {
                    continue;
                }

                const otherCircles = other.collisionCircles;
                const minDist = this.circleRadius + other.circleRadius;
                const minDistSq = minDist * minDist;

                for (let c1 = 0; c1 < 3; c1++) {
                    const cA = this.collisionCircles[c1];
                    for (let c2 = 0; c2 < 3; c2++) {
                        const cB = otherCircles[c2];
                        const dx = cA.x - cB.x;
                        const dz = cA.z - cB.z;
                        const dSq = dx * dx + dz * dz;

                        if (dSq < minDistSq) {
                            let dist = Math.sqrt(dSq);
                            let nx = 0;
                            let nz = 0;
                            let penetration = 0;

                            if (dist < 1e-4) {
                                nx = 1; nz = 0;
                                penetration = minDist;
                            } else {
                                nx = dx / dist;
                                nz = dz / dist;
                                penetration = minDist - dist;
                            }

                            const halfPen = penetration * 0.5;
                            totalMtvX += nx * halfPen;
                            totalMtvZ += nz * halfPen;
                            collisionCount++;

                            other.position.x -= nx * halfPen * 0.5;
                            other.position.z -= nz * halfPen * 0.5;
                        }
                    }
                }
            }
        }

        // Apply Minimum Translation Vector (MTV) position correction and bounce impulse
        if (collisionCount > 0) {
            this.position.x += totalMtvX;
            this.position.z += totalMtvZ;

            const mtvLen = Math.hypot(totalMtvX, totalMtvZ);
            if (mtvLen > 1e-4) {
                const normX = totalMtvX / mtvLen;
                const normZ = totalMtvZ / mtvLen;
                const vDotN = this.velocity.x * normX + this.velocity.y * normZ;

                if (vDotN < 0) {
                    const restitution = 0.25;
                    const friction = 0.40;

                    const vNormX = vDotN * normX;
                    const vNormZ = vDotN * normZ;
                    const vTangX = this.velocity.x - vNormX;
                    const vTangZ = this.velocity.y - vNormZ;

                    this.velocity.x = vTangX * (1 - friction) - vNormX * restitution;
                    this.velocity.y = vTangZ * (1 - friction) - vNormZ * restitution;

                    this.speed = this.velocity.x * fwdX + this.velocity.y * fwdZ;
                }
            }
        }
    }

    /**
     * Pedestrian hit and ragdoll impulse hook (from 7e9eef5:game.html).
     */
    checkPedestrianCollisions(pedestrians, createBloodPoolCallback = null) {
        if (!Array.isArray(pedestrians) || pedestrians.length === 0) return;

        const sinYaw = Math.sin(this.yaw);
        const cosYaw = Math.cos(this.yaw);
        _scratchForward.set(-sinYaw, 0, -cosYaw);

        const collisionRadius = 1.6;
        for (let i = 0, len = pedestrians.length; i < len; i++) {
            const ped = pedestrians[i];
            if (!ped || ped.isDead || !ped.mesh) continue;

            const pd = ped.mesh.position.distanceTo(this.position);
            if (pd < collisionRadius) {
                ped.isDead = true;
                ped.state = 'dead';

                const impulseMag = Math.max(0.5, Math.abs(this.speed)) * 18;
                _scratchImpulse.copy(_scratchForward).normalize().multiplyScalar(impulseMag);
                _scratchImpulse.y = 1.5 * Math.abs(this.speed);

                ped.ragdollVelocity = _scratchImpulse.clone();
                ped.mesh.position.y += 0.2;
                ped.mesh.rotation.x = 0;

                if (typeof createBloodPoolCallback === 'function') {
                    const hitPos = ped.mesh.position.clone();
                    setTimeout(() => createBloodPoolCallback(hitPos), 600);
                }
            }
        }
    }

    /**
     * Explicit collision check and response method (PROJECT.md §3).
     * @param {SpatialGrid} spatialGrid
     * @param {number} [dt=1/60]
     */
    checkCollisionAndRespond(spatialGrid, dt = 1 / 60) {
        if (spatialGrid) {
            this._resolveCollisions(spatialGrid);
        }
    }

    /**
     * Enforces world bounds clamping at the edge of the map (CONFIG.WORLD.SAFE_BOUNDS).
     */
    _enforceWorldBounds() {
        const bounds = CONFIG.WORLD.SAFE_BOUNDS;
        const margin = this.circleRadius;

        if (this.position.x < bounds.MIN_X + margin) {
            this.position.x = bounds.MIN_X + margin;
            if (this.velocity.x < 0) this.velocity.x = -0.2 * this.velocity.x;
        } else if (this.position.x > bounds.MAX_X - margin) {
            this.position.x = bounds.MAX_X - margin;
            if (this.velocity.x > 0) this.velocity.x = -0.2 * this.velocity.x;
        }

        if (this.position.z < bounds.MIN_Z + margin) {
            this.position.z = bounds.MIN_Z + margin;
            if (this.velocity.y < 0) this.velocity.y = -0.2 * this.velocity.y;
        } else if (this.position.z > bounds.MAX_Z - margin) {
            this.position.z = bounds.MAX_Z - margin;
            if (this.velocity.y > 0) this.velocity.y = -0.2 * this.velocity.y;
        }
    }

    /**
     * Validates state variables against NaN or Infinite corruption.
     * Instantly recovers to lastSafePosition if numerical failure occurs.
     */
    _validateState() {
        const px = this.position.x;
        const py = this.position.y;
        const pz = this.position.z;
        const vx = this.velocity.x;
        const vz = this.velocity.y;
        const spd = this.speed;
        const yaw = this.yaw;
        const str = this.steerAngle;

        if (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz) &&
            Number.isFinite(vx) && Number.isFinite(vz) &&
            Number.isFinite(spd) && Number.isFinite(yaw) && Number.isFinite(str)) {
            this.lastSafePosition.set(px, py, pz);
            this.lastSafeYaw = yaw;
        } else {
            console.warn(`[Vehicle ${this.id}] Detected non-finite state! Reverting to lastSafePosition.`);
            this.position.copy(this.lastSafePosition);
            this.velocity.set(0, 0);
            this.speed = 0;
            this.yaw = this.lastSafeYaw;
            this.steerAngle = 0;
        }
    }

    /**
     * Updates visual mesh transformation and wheel spin/turn animations.
     * @param {number} dt Delta time
     */
    /**
     * A wheel rolling over something (a body in the road): the car jolts up and pitches, and the
     * suspension soaks it up. Visual only (the mesh and the driver's eye), not the physics.
     * @param {number} lift how hard (m/s of upward kick at the wheel)
     * @param {boolean} front front axle (nose comes up) or rear (tail comes up)
     */
    bump(lift = 0.8, front = true) {
        this._bumpVel += lift;
        this._pitchVel += (front ? 1 : -1) * lift * 0.45;
    }

    _updateBump(dt) {
        if (dt <= 0 || (!this._bumpVel && !this.bumpHeave && !this._pitchVel && !this.bumpPitch)) return;
        const h = Math.min(dt, 1 / 30);
        const k = 260, c = 22; // stiff and well damped: one firm bounce
        this._bumpVel += (-k * this.bumpHeave - c * this._bumpVel) * h;
        this.bumpHeave += this._bumpVel * h;
        this._pitchVel += (-k * this.bumpPitch - c * this._pitchVel) * h;
        this.bumpPitch += this._pitchVel * h;
        if (Math.abs(this.bumpHeave) + Math.abs(this._bumpVel) + Math.abs(this.bumpPitch) + Math.abs(this._pitchVel) < 1e-4) {
            this.bumpHeave = this.bumpPitch = this._bumpVel = this._pitchVel = 0;
        }
    }

    _updateMeshTransform(dt) {
        if (!this.mesh) return;

        // Position & Heading rotation (plus any suspension jolt)
        this._updateBump(dt);
        this.mesh.position.set(this.position.x, this.position.y + this.bumpHeave, this.position.z);
        this.mesh.rotation.order = 'YXZ'; // pitch about the car's own axis, after the heading
        this.mesh.rotation.y = this.yaw;
        this.mesh.rotation.x = this.bumpPitch;

        // If this vehicle is rendered via InstancedVehicleFleet (not mounted directly in scene),
        // skip per-child group matrix updates to save CPU cycles.
        if (dt > 0 && !this.mesh.parent) {
            this.wheelRoll += (this.speed * dt) / this.wheelRadius;
            return;
        }

        if (this.wheelPivots) {
            this.wheelPivots.frontLeft.rotation.y = this.steerAngle;
            this.wheelPivots.frontRight.rotation.y = this.steerAngle;
        }

        if (dt > 0 && this.wheels) {
            const rollDelta = (this.speed * dt) / this.wheelRadius;
            this.wheelRoll += rollDelta;

            this.wheels.frontLeft.rotation.x = -this.wheelRoll;
            this.wheels.frontRight.rotation.x = -this.wheelRoll;
            this.wheels.rearLeft.rotation.x = -this.wheelRoll;
            this.wheels.rearRight.rotation.x = -this.wheelRoll;
        }
    }

    getPosition() {
        return {
            x: this.position.x,
            y: this.position.y,
            z: this.position.z
        };
    }

    getYaw() {
        return this.yaw;
    }

    getSpeed() {
        return this.speed;
    }

    getVelocity() {
        return {
            x: this.velocity.x,
            z: this.velocity.y
        };
    }

    getBoundingCircles() {
        return this.collisionCircles;
    }

    getMesh() {
        return this.mesh;
    }

    destroy() {
        if (this.mesh && this.mesh.parent) {
            this.mesh.parent.remove(this.mesh);
        }
        // Geometries and materials are shared per model (carModels.js)
    }
}

export const CivicVehicle = Vehicle;

// ============================================================================
// HUD INTEGRATION HELPERS (Verbatim 7e9eef5 styling & layouts)
// ============================================================================

/**
 * Ensures #car-indicator and #car-speed-hud exist in the DOM with authentic 7e9eef5 styles.
 * @param {HTMLElement} [container=document.body]
 */
export function ensureCivicHUD(container = (typeof document !== 'undefined' ? document.body : null)) {
    if (!container || typeof document === 'undefined') return;

    if (!document.getElementById('car-indicator')) {
        const ind = document.createElement('div');
        ind.id = 'car-indicator';
        ind.style.cssText = 'display:none;position:absolute;top:55%;left:50%;transform:translate(-50%,-50%);' +
            'color:#fff;font-family:Arial,sans-serif;font-size:15px;' +
            'background:rgba(0,0,0,0.55);padding:8px 12px;border-radius:6px;z-index:140;pointer-events:none;';
        ind.innerHTML = "<span class='key-hint'>(E) </span>Enter Car";
        container.appendChild(ind);
    }

    if (!document.getElementById('car-speed-hud')) {
        const hud = document.createElement('div');
        hud.id = 'car-speed-hud';
        hud.style.cssText = 'display:none;position:absolute;bottom:20px;left:50%;transform:translateX(-50%);' +
            'color:#fff;background:rgba(0,0,0,0.55);padding:8px 12px;border-radius:6px;' +
            'font-family:Arial,sans-serif;font-size:16px;z-index:100;pointer-events:none;';
        hud.innerHTML = 'Speed: <span id="car-speed-val">0</span> mph';
        container.appendChild(hud);
    }
}

/**
 * Updates DOM HUD indicators based on player proximity and vehicle status.
 * @param {Vehicle|null} vehicle Active or nearby vehicle
 * @param {boolean} isNear True if player within boarding distance
 * @param {boolean} isInCar True if player currently driving
 */
export function updateCivicHUD(vehicle, isNear, isInCar) {
    if (typeof document === 'undefined') return;

    const ind = document.getElementById('car-indicator');
    const hud = document.getElementById('car-speed-hud');
    const val = document.getElementById('car-speed-val');

    if (isInCar) {
        if (ind) ind.style.display = 'none';
        if (hud) hud.style.display = 'block';
        if (val && vehicle && typeof vehicle.getSpeed === 'function') {
            const mph = Math.abs(Math.round(vehicle.getSpeed() * 2.237));
            val.textContent = String(mph);
        }
    } else {
        if (hud) hud.style.display = 'none';
        if (ind) {
            ind.style.display = (isNear && vehicle) ? 'block' : 'none';
            // Name the car the player is about to get into
            const label = vehicle && vehicle.modelName && !vehicle.isPlane ? vehicle.modelName : 'Car';
            if (isNear && vehicle && ind.dataset.carLabel !== label) {
                ind.dataset.carLabel = label;
                ind.innerHTML = `<span class='key-hint'>(E) </span>Enter ${label}`;
            }
        }
    }
}
