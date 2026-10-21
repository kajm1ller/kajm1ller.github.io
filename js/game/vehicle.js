/**
 * js/game/vehicle.js
 * 
 * High-performance Vehicle Physics, Collision Response, and Kaj Simulator
 * Honda Civic Procedural Mesh System (extracted from commit 7e9eef5:game.html).
 * 
 * Conforms to:
 * - Authentic Kaj Simulator Honda Civic car basis (sedan body 2.2x0.7x4.5, cabin 1.9x0.6x2.2,
 *   angled windshield & rear glass, side windows, headlights, taillights, bumpers, license plate,
 *   4 steerable/rolling wheels & hubcaps, #car-indicator & #car-speed-hud HUD integration)
 * - Shared CivicGeometryPool & CivicMaterialPool for zero duplicate shader/geometry allocations
 * - Extended Kinematic Bicycle model with slip angle and lateral grip damping
 * - Project coordinate frame: yaw=0 points along -Z (Three.js standard camera & roadNetwork convention)
 * - 2D planar collision detection (3-circle decomposition with zero-gap capsule coverage)
 * - Contact normal MTV separation and impulse reflection against SpatialGrid obstacles
 * - World boundary clamping within [-280, 280]
 * - Defensive Number.isFinite() validation with lastSafePosition corruption recovery
 * - Zero GC allocation during active 60Hz physics stepping
 * - PROJECT.md § Interface Contracts (3. Vehicle Interface)
 */

import * as THREE from 'three';
import { CONFIG } from './config.js';

// Pre-allocated reusable scratch vectors for zero-allocation physics stepping
const _scratchForward = new THREE.Vector3();
const _scratchRight = new THREE.Vector3();
const _scratchImpulse = new THREE.Vector3();
const _scratchCollisionResults = [];
// Circle offsets along heading: Front (+1.35m fwd), Center (0m), Rear (-1.35m fwd)
const _circleOffsets = [1.35, 0.0, -1.35];

// ============================================================================
// SHARED GEOMETRY POOL (Singleton cache across all Honda Civic instances)
// ============================================================================
export class CivicGeometryPool {
    static _pool = null;

    static get() {
        if (!this._pool) {
            const wheelTireGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 12);
            wheelTireGeo.rotateZ(Math.PI / 2);

            const wheelHubGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.26, 8);
            wheelHubGeo.rotateZ(Math.PI / 2);

            const exhaustGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.25, 8);
            exhaustGeo.rotateX(Math.PI / 2);

            this._pool = {
                body: new THREE.BoxGeometry(2.2, 0.7, 4.5),
                cabin: new THREE.BoxGeometry(1.9, 0.6, 2.2),
                windshield: new THREE.BoxGeometry(1.7, 0.5, 0.05),
                rearGlass: new THREE.BoxGeometry(1.7, 0.45, 0.05),
                sideWindow: new THREE.BoxGeometry(0.05, 0.4, 1.8),
                headlight: new THREE.BoxGeometry(0.35, 0.2, 0.05),
                taillight: new THREE.BoxGeometry(0.3, 0.15, 0.05),
                wheelTire: wheelTireGeo,
                wheelHub: wheelHubGeo,
                bumper: new THREE.BoxGeometry(2.0, 0.15, 0.15),
                licensePlate: new THREE.BoxGeometry(0.6, 0.2, 0.02),
                exhaust: exhaustGeo
            };
        }
        return this._pool;
    }

    static disposeAll() {
        if (this._pool) {
            Object.values(this._pool).forEach(geo => {
                if (geo && typeof geo.dispose === 'function') geo.dispose();
            });
            this._pool = null;
        }
    }
}

// ============================================================================
// SHARED MATERIAL POOL (Singleton cache across all Honda Civic instances)
// ============================================================================
export class CivicMaterialPool {
    static _materials = null;
    static _bodyColors = new Map();

    static getCommon() {
        if (!this._materials) {
            this._materials = {
                cabin: new THREE.MeshLambertMaterial({ color: 0x1a1a1a }),
                glass: new THREE.MeshLambertMaterial({
                    color: 0x4488aa,
                    transparent: true,
                    opacity: 0.5,
                    depthWrite: false
                }),
                headlight: new THREE.MeshBasicMaterial({ color: 0xffffcc }),
                taillight: new THREE.MeshBasicMaterial({ color: 0xff2222 }),
                wheelTire: new THREE.MeshLambertMaterial({ color: 0x222222 }),
                wheelHub: new THREE.MeshLambertMaterial({ color: 0x666666 }),
                bumper: new THREE.MeshLambertMaterial({ color: 0x333333 }),
                licensePlate: new THREE.MeshLambertMaterial({ color: 0xeeeeee }),
                exhaust: new THREE.MeshLambertMaterial({ color: 0x888888 })
            };
        }
        return this._materials;
    }

    static getBodyMaterial(colorHex = 0x111111) {
        if (!this._bodyColors.has(colorHex)) {
            this._bodyColors.set(colorHex, new THREE.MeshLambertMaterial({ color: colorHex }));
        }
        return this._bodyColors.get(colorHex);
    }

    static disposeAll() {
        if (this._materials) {
            Object.values(this._materials).forEach(mat => {
                if (mat && typeof mat.dispose === 'function') mat.dispose();
            });
            this._materials = null;
        }
        this._bodyColors.forEach(mat => mat.dispose());
        this._bodyColors.clear();
    }
}

/**
 * Constructs the authentic Kaj Simulator Honda Civic mesh hierarchy (from 7e9eef5:game.html)
 * using pooled geometries and materials, with steerable front wheels and spin-capable wheel rollers.
 * 
 * @param {number} [color=0x111111] Body paint color hex (0x111111 is Kaj Simulator black)
 * @param {string|number} [id='civic'] Vehicle ID
 * @returns {{ root: THREE.Group, wheelPivots: object, wheels: object }}
 */
export function createOptimizedHondaCivic(color = 0x111111, id = 'civic') {
    const geos = CivicGeometryPool.get();
    const mats = CivicMaterialPool.getCommon();
    const bodyMat = CivicMaterialPool.getBodyMaterial(color);

    const root = new THREE.Group();
    root.name = `honda_civic_${id}`;
    root.userData.isHondaCivic = true;

    // 1. Main Sedan Body (2.2 x 0.7 x 4.5)
    const body = new THREE.Mesh(geos.body, bodyMat);
    body.name = 'sedan_body';
    body.position.y = 0.55;
    root.add(body);

    // 2. Cabin / Roof Greenhouse (1.9 x 0.6 x 2.2)
    const cabin = new THREE.Mesh(geos.cabin, mats.cabin);
    cabin.name = 'cabin_roof';
    cabin.position.set(0, 1.1, -0.3);
    root.add(cabin);

    // 3. Windshield (Front Glass, angled -0.2 rad)
    const windshield = new THREE.Mesh(geos.windshield, mats.glass);
    windshield.name = 'windshield';
    windshield.position.set(0, 1.1, -1.4);
    windshield.rotation.x = -0.2;
    root.add(windshield);

    // 4. Rear Window (Angled +0.2 rad)
    const rearGlass = new THREE.Mesh(geos.rearGlass, mats.glass);
    rearGlass.name = 'rear_glass';
    rearGlass.position.set(0, 1.05, 0.8);
    rearGlass.rotation.x = 0.2;
    root.add(rearGlass);

    // 5. Side Windows
    const leftWindow = new THREE.Mesh(geos.sideWindow, mats.glass);
    leftWindow.name = 'left_window_glass';
    leftWindow.position.set(-0.97, 1.1, -0.3);
    root.add(leftWindow);

    const rightWindow = new THREE.Mesh(geos.sideWindow, mats.glass);
    rightWindow.name = 'right_window_glass';
    rightWindow.position.set(0.97, 1.1, -0.3);
    root.add(rightWindow);

    // 6. Headlights (-Z Front)
    const headlightL = new THREE.Mesh(geos.headlight, mats.headlight);
    headlightL.name = 'headlight_left';
    headlightL.position.set(-0.7, 0.55, -2.26);
    root.add(headlightL);

    const headlightR = new THREE.Mesh(geos.headlight, mats.headlight);
    headlightR.name = 'headlight_right';
    headlightR.position.set(0.7, 0.55, -2.26);
    root.add(headlightR);

    // 7. Taillights (+Z Rear)
    const taillightL = new THREE.Mesh(geos.taillight, mats.taillight);
    taillightL.name = 'taillight_left';
    taillightL.position.set(-0.7, 0.55, 2.26);
    root.add(taillightL);

    const taillightR = new THREE.Mesh(geos.taillight, mats.taillight);
    taillightR.name = 'taillight_right';
    taillightR.position.set(0.7, 0.55, 2.26);
    root.add(taillightR);

    // 8. Bumpers (Front & Rear)
    const frontBumper = new THREE.Mesh(geos.bumper, mats.bumper);
    frontBumper.name = 'front_bumper';
    frontBumper.position.set(0, 0.3, -2.3);
    root.add(frontBumper);

    const rearBumper = new THREE.Mesh(geos.bumper, mats.bumper);
    rearBumper.name = 'rear_bumper';
    rearBumper.position.set(0, 0.3, 2.3);
    root.add(rearBumper);

    // 9. Rear License Plate
    const plate = new THREE.Mesh(geos.licensePlate, mats.licensePlate);
    plate.name = 'license_plate';
    plate.position.set(0, 0.35, 2.31);
    root.add(plate);

    // 10. Chrome Exhaust Tip
    const exhaust = new THREE.Mesh(geos.exhaust, mats.exhaust);
    exhaust.name = 'exhaust_tip';
    exhaust.position.set(-0.6, 0.22, 2.32);
    root.add(exhaust);

    // 11. Four Animated Wheels & Hubcaps
    const wheelPivots = {
        frontLeft: new THREE.Group(),
        frontRight: new THREE.Group()
    };
    wheelPivots.frontLeft.name = 'wheel_pivot_fl';
    wheelPivots.frontRight.name = 'wheel_pivot_fr';

    const wheels = {
        frontLeft: null,
        frontRight: null,
        rearLeft: null,
        rearRight: null
    };

    const makeWheelRoller = (label) => {
        const roller = new THREE.Group();
        roller.name = `wheel_roller_${label}`;
        const tire = new THREE.Mesh(geos.wheelTire, mats.wheelTire);
        tire.name = `wheel_tire_${label}`;
        const hub = new THREE.Mesh(geos.wheelHub, mats.wheelHub);
        hub.name = `wheel_hubcap_${label}`;
        roller.add(tire);
        roller.add(hub);
        return roller;
    };

    // Axle coordinates from 7e9eef5: [±1.0, 0.35, ±1.3]
    const axleY = 0.35;
    const axleFrontZ = -1.30;
    const axleRearZ = 1.30;
    const trackX = 1.00;

    // Front Left
    wheelPivots.frontLeft.position.set(-trackX, axleY, axleFrontZ);
    wheels.frontLeft = makeWheelRoller('fl');
    wheelPivots.frontLeft.add(wheels.frontLeft);
    root.add(wheelPivots.frontLeft);

    // Front Right
    wheelPivots.frontRight.position.set(trackX, axleY, axleFrontZ);
    wheels.frontRight = makeWheelRoller('fr');
    wheelPivots.frontRight.add(wheels.frontRight);
    root.add(wheelPivots.frontRight);

    // Rear Left
    const rlPivot = new THREE.Group();
    rlPivot.name = 'wheel_pivot_rl';
    rlPivot.position.set(-trackX, axleY, axleRearZ);
    wheels.rearLeft = makeWheelRoller('rl');
    rlPivot.add(wheels.rearLeft);
    root.add(rlPivot);

    // Rear Right
    const rrPivot = new THREE.Group();
    rrPivot.name = 'wheel_pivot_rr';
    rrPivot.position.set(trackX, axleY, axleRearZ);
    wheels.rearRight = makeWheelRoller('rr');
    rrPivot.add(wheels.rearRight);
    root.add(rrPivot);

    // Driver Side Door Pivot (Left side at x = -1.08, hinged at front z = -1.05) for Carjacking Animation
    const leftDoorPivot = new THREE.Group();
    leftDoorPivot.name = 'driver_door_pivot';
    leftDoorPivot.position.set(-1.08, 0.55, -1.05);
    const doorGeo = new THREE.BoxGeometry(0.08, 0.62, 1.15);
    const doorPanel = new THREE.Mesh(doorGeo, bodyMat);
    doorPanel.name = 'driver_door_panel';
    doorPanel.position.set(0, 0, 0.575);
    leftDoorPivot.add(doorPanel);
    root.add(leftDoorPivot);
    root.userData.leftDoorPivot = leftDoorPivot;

    root.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });

    return { root, wheelPivots, wheels, leftDoorPivot };
}

export const createHondaCivic = (color = 0x111111, id = 'civic') => createOptimizedHondaCivic(color, id).root;

export class Vehicle {
    /**
     * @param {string|number} id Unique identifier
     * @param {number} [x=0] Initial X coordinate
     * @param {number} [z=0] Initial Z coordinate
     * @param {number} [yaw=0] Initial heading in radians (0 = facing -Z)
     * @param {number} [color=0x111111] Body color hex (defaults to Kaj Simulator black 0x111111)
     * @param {boolean} [isPlayer=false] Whether this vehicle is player-driven
     */
    constructor(id, x = 0, z = 0, yaw = 0, color = 0x111111, isPlayer = false) {
        this.id = id;
        this.isPlayer = !!isPlayer;
        this.isHondaCivic = true;
        this.color = color;
        this.bodyColor = color;
        
        // Pose
        this.position = new THREE.Vector3(x, 0, z);
        this.velocity = new THREE.Vector2(0, 0); // Horizontal world velocity [vx, vz]
        this.yaw = yaw;                         // Heading angle in radians (0 = -Z)
        this.speed = 0;                         // Signed longitudinal speed (m/s)
        this.steerAngle = 0;                    // Current front wheel steer angle (radians)

        // Physical dimensions & limits (Authentic 7e9eef5 Honda Civic & CONFIG.VEHICLE)
        this.length = (CONFIG.VEHICLE && CONFIG.VEHICLE.LENGTH) || 4.5;
        this.width = (CONFIG.VEHICLE && CONFIG.VEHICLE.WIDTH) || 2.2;
        this.height = (CONFIG.VEHICLE && CONFIG.VEHICLE.HEIGHT) || 1.4;
        this.radius = (CONFIG.VEHICLE && CONFIG.VEHICLE.RADIUS) || 2.25;
        this.wheelbase = 2.8;                   // Axle-to-axle kinematic wheelbase (m)
        this.halfWheelbase = 1.4;               // CoM to axle distance (lf = lr = 1.4m)
        this.circleRadius = 1.10;               // 3-circle decomposition radius
        this.wheelRadius = 0.35;                // Honda Civic wheel cylinder radius

        // Dynamics constants
        this.maxForwardSpeed = 28.0;            // Max forward velocity (m/s)
        this.maxReverseSpeed = -9.0;            // Max reverse velocity (m/s)
        this.baseAccel = 9.5;                   // Stall forward acceleration (m/s^2)
        this.reverseAccel = 5.0;                // Reverse gear acceleration (m/s^2)
        this.brakeDecel = 16.0;                 // Braking deceleration (m/s^2)
        this.handbrakeDecel = 24.0;             // Handbrake deceleration (m/s^2)
        this.rollingFriction = 0.6;             // Rolling resistance (m/s^2)
        this.dragCoeff = 0.0035;                // Aerodynamic drag coefficient
        this.normalGrip = 36.0;                 // High normal lateral tire grip so cars track road without drifting (s^-1)
        this.handbrakeGrip = 2.5;               // Drifting lateral grip damping factor (s^-1)
        this.maxSteerAngle = 0.55;              // Maximum wheel turn angle (~31.5 deg)
        this.steerSpeed = 4.5;                  // Steering turn rate (rad/s)
        this.steerCenterSpeed = 6.0;            // Steering auto-centering rate (rad/s)

        // Defensive snapshot for NaN/Infinity corruption recovery
        this.lastSafePosition = new THREE.Vector3(x, 0, z);
        this.lastSafeYaw = yaw;

        // Input state
        this.inputThrottle = 0;
        this.inputSteer = 0;
        this.inputBrake = 0;
        this.inputHandbrake = false;

        // Collision scratch buffers (reusable across ticks)
        this.collisionCircles = [
            { x: 0, z: 0, radius: this.circleRadius },
            { x: 0, z: 0, radius: this.circleRadius },
            { x: 0, z: 0, radius: this.circleRadius }
        ];
        this._syncCollisionCircles();

        // 3D Optimized Honda Civic Mesh
        const civicData = createOptimizedHondaCivic(color, id);
        this.mesh = civicData.root;
        this.mesh.userData.vehicle = this;
        this.wheelPivots = civicData.wheelPivots;
        this.wheels = civicData.wheels;
        this.leftDoorPivot = civicData.leftDoorPivot || null;
        this.doorOpenAngle = 0;
        this.wheelRoll = 0;
        this._updateMeshTransform(0);
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
            const offset = _circleOffsets[i];
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

        // Integrate longitudinal speed
        const prevSpeed = this.speed;
        this.speed += accel * dt;

        // Zero-crossing snap when braking to prevent reverse oscillation
        if ((prevSpeed > 0 && this.speed < 0 && this.inputThrottle === 0 && this.inputBrake > 0 && prevSpeed < 2.0) ||
            (prevSpeed < 0 && this.speed > 0 && this.inputThrottle > 0 && this.inputBrake === 0 && prevSpeed > -2.0)) {
            this.speed = 0;
        }

        // Clamp to physical speed limits
        this.speed = Math.max(this.maxReverseSpeed, Math.min(this.maxForwardSpeed, this.speed));

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

        // 6. Hard world boundary clamping within [-280, 280]
        this._enforceWorldBounds();

        // 7. Defensive validation & lastSafePosition recovery
        this._validateState();

        // 8. Update visual 3D mesh transforms
        this._updateMeshTransform(dt);
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
            const offset = _circleOffsets[i];
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
     * Enforces world bounds clamping within [-280, 280] meters.
     */
    _enforceWorldBounds() {
        const bound = 280.0;
        const margin = this.circleRadius;

        if (this.position.x < -bound + margin) {
            this.position.x = -bound + margin;
            if (this.velocity.x < 0) this.velocity.x = -0.2 * this.velocity.x;
        } else if (this.position.x > bound - margin) {
            this.position.x = bound - margin;
            if (this.velocity.x > 0) this.velocity.x = -0.2 * this.velocity.x;
        }

        if (this.position.z < -bound + margin) {
            this.position.z = -bound + margin;
            if (this.velocity.y < 0) this.velocity.y = -0.2 * this.velocity.y;
        } else if (this.position.z > bound - margin) {
            this.position.z = bound - margin;
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
    _updateMeshTransform(dt) {
        if (!this.mesh) return;

        // Position & Heading rotation
        this.mesh.position.set(this.position.x, this.position.y, this.position.z);
        this.mesh.rotation.y = this.yaw;

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
        // Geometries and materials are pooled globally in CivicGeometryPool / CivicMaterialPool
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
            'color:#7cff7c;font-family:Arial,sans-serif;font-size:18px;font-weight:bold;' +
            'background:rgba(0,0,0,0.6);padding:8px 16px;border-radius:5px;z-index:140;pointer-events:none;';
        ind.innerHTML = "<span class='key-hint'>(E) </span>Enter Car";
        container.appendChild(ind);
    }

    if (!document.getElementById('car-speed-hud')) {
        const hud = document.createElement('div');
        hud.id = 'car-speed-hud';
        hud.style.cssText = 'display:none;position:absolute;bottom:20px;left:50%;transform:translateX(-50%);' +
            'color:white;background:rgba(0,0,0,0.7);padding:10px 20px;border-radius:5px;' +
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
        }
    }
}
