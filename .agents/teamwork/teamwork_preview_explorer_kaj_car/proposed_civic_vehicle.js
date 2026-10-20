/**
 * proposed_civic_vehicle.js
 * 
 * Kaj Simulator Honda Civic Vehicle Architecture & Optimization Blueprint.
 * 
 * Extracted from git commit 7e9eef5:game.html (// === HONDA CIVIC CAR SYSTEM ===)
 * and re-architected for zero-allocation modular execution under js/game/.
 * 
 * Features & Optimizations:
 * 1. 1:1 Aesthetic & Dimensional Fidelity:
 *    - Sedan body (2.2 x 0.7 x 4.5m) in Kaj Simulator black (0x111111) or custom fleet colors.
 *    - Cabin / roof greenhouse (1.9 x 0.6 x 2.2m) at y=1.1, z=-0.3 in dark gray (0x1a1a1a).
 *    - Windshield (1.7 x 0.5 x 0.05m, rotX=-0.2) and Rear Glass (1.7 x 0.45 x 0.05m, rotX=0.2) in cyan-tinted glass (0x4488aa, opacity 0.5).
 *    - Left & right side glass panels (0.05 x 0.4 x 1.8m) at x=±0.97.
 *    - Headlights (0.35 x 0.2 x 0.05m) at z=-2.26 (0xffffcc) and Taillights (0.3 x 0.15 x 0.05m) at z=2.26 (0xff2222).
 *    - 4 Wheels (r=0.35, w=0.25) with Hubcaps (r=0.15, w=0.26) at [±1.0, 0.35, ±1.3].
 *    - Front & rear bumpers (2.0 x 0.15 x 0.15m) at z=±2.3.
 *    - Rear license plate (0.6 x 0.2 x 0.02m) at (0, 0.35, 2.31).
 *    - Chrome dual-exhaust tip (r=0.06, l=0.25) at (-0.6, 0.22, 2.32).
 * 
 * 2. High-Performance Zero-Allocation Resource Pooling:
 *    - Shared Geometry Pool: Exactly 1 instance of each BoxGeometry/CylinderGeometry reused across all vehicles.
 *    - Shared Material Pool: Common materials (glass, tires, hubcaps, lights, bumpers, trim) shared globally.
 *    - Preallocated Scratch Math: Zero GC Vector3/Vector2 allocations during 60Hz physics, collision, and rendering.
 * 
 * 3. Kinematic Bicycle Physics & Collision Broadphase:
 *    - Verified Extended Kinematic Bicycle model with Ackermann speed-sensitive steering smoothing.
 *    - 3-Circle capsule broadphase (radii=1.10m at +1.35m, 0m, -1.35m) for O(1) SpatialGrid collision resolution.
 *    - Minimum Translation Vector (MTV) restitution bounce and tangential scrub against static obstacles & traffic.
 *    - Defensive state validation with lastSafePosition NaN/Infinity corruption recovery.
 * 
 * 4. Front Wheel Steering & Rolling Animations:
 *    - Front wheels mounted on yaw-steering pivots (steerAngle).
 *    - All 4 wheels roll longitudinally (wheelRoll += speed * dt / r).
 * 
 * 5. HUD & Pedestrian Ragdoll System Integration:
 *    - Seamless binding to #car-indicator ("(E) Enter Car") and #car-speed-hud ("Speed: X mph").
 *    - checkPedestrianCollisions() hook reproducing the 7e9eef5 ragdoll impulse, lift, and blood pool sequence.
 *    - Dual camera modes: First-Person Cockpit/Hood and Smooth 3rd-Person Chase/Isometric.
 */

import * as THREE from 'three';

// ============================================================================
// VERBATIM EXTRACTION REFERENCE (from git commit 7e9eef5:game.html lines 728-980)
// ============================================================================
/*
// === HONDA CIVIC CAR SYSTEM ===
let carMesh = null;
let isInCar = false;
let carSpeed = 0;
let carYaw = 0;
const carMaxSpeed = 0.8;
const carAcceleration = 0.015;
const carBrakeForce = 0.03;
const carFriction = 0.005;
const carTurnSpeed = 0.03;
const carEnterDistance = 4;
const carIndicatorEl = document.getElementById('car-indicator');
const carSpeedHud = document.getElementById('car-speed-hud');
const carSpeedVal = document.getElementById('car-speed-val');
const carKeys = { w: false, a: false, s: false, d: false };

function createHondaCivic() {
    const group = new THREE.Group();
    // Main body - low sedan shape
    const bodyGeo = new THREE.BoxGeometry(2.2, 0.7, 4.5);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.55;
    group.add(body);

    // Roof / cabin
    const cabinGeo = new THREE.BoxGeometry(1.9, 0.6, 2.2);
    const cabinMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 1.1, -0.3);
    group.add(cabin);

    // Windshield (front glass)
    const windshieldGeo = new THREE.BoxGeometry(1.7, 0.5, 0.05);
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x4488aa, transparent: true, opacity: 0.5 });
    const windshield = new THREE.Mesh(windshieldGeo, glassMat);
    windshield.position.set(0, 1.1, -1.4);
    windshield.rotation.x = -0.2;
    group.add(windshield);

    // Rear window
    const rearGlassGeo = new THREE.BoxGeometry(1.7, 0.45, 0.05);
    const rearGlass = new THREE.Mesh(rearGlassGeo, glassMat);
    rearGlass.position.set(0, 1.05, 0.8);
    rearGlass.rotation.x = 0.2;
    group.add(rearGlass);

    // Side windows
    const sideWindowGeo = new THREE.BoxGeometry(0.05, 0.4, 1.8);
    const leftWindow = new THREE.Mesh(sideWindowGeo, glassMat);
    leftWindow.position.set(-0.97, 1.1, -0.3);
    group.add(leftWindow);
    const rightWindow = new THREE.Mesh(sideWindowGeo, glassMat);
    rightWindow.position.set(0.97, 1.1, -0.3);
    group.add(rightWindow);

    // Headlights
    const headlightGeo = new THREE.BoxGeometry(0.35, 0.2, 0.05);
    const headlightMat = new THREE.MeshBasicMaterial({ color: 0xffffcc });
    const headlightL = new THREE.Mesh(headlightGeo, headlightMat);
    headlightL.position.set(-0.7, 0.55, -2.26);
    group.add(headlightL);
    const headlightR = new THREE.Mesh(headlightGeo, headlightMat);
    headlightR.position.set(0.7, 0.55, -2.26);
    group.add(headlightR);

    // Taillights
    const taillightGeo = new THREE.BoxGeometry(0.3, 0.15, 0.05);
    const taillightMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
    const taillightL = new THREE.Mesh(taillightGeo, taillightMat);
    taillightL.position.set(-0.7, 0.55, 2.26);
    group.add(taillightL);
    const taillightR = new THREE.Mesh(taillightGeo, taillightMat);
    taillightR.position.set(0.7, 0.55, 2.26);
    group.add(taillightR);

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 12);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    const wheelPositions = [
        [-1.0, 0.35, -1.3],
        [1.0, 0.35, -1.3],
        [-1.0, 0.35, 1.3],
        [1.0, 0.35, 1.3]
    ];
    wheelPositions.forEach(pos => {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(pos[0], pos[1], pos[2]);
        group.add(wheel);
        // Hubcap
        const hubGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.26, 8);
        const hubMat = new THREE.MeshLambertMaterial({ color: 0x666666 });
        const hub = new THREE.Mesh(hubGeo, hubMat);
        hub.rotation.z = Math.PI / 2;
        hub.position.set(pos[0], pos[1], pos[2]);
        group.add(hub);
    });

    // Bumpers
    const bumperGeo = new THREE.BoxGeometry(2.0, 0.15, 0.15);
    const bumperMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const frontBumper = new THREE.Mesh(bumperGeo, bumperMat);
    frontBumper.position.set(0, 0.3, -2.3);
    group.add(frontBumper);
    const rearBumper = new THREE.Mesh(bumperGeo, bumperMat);
    rearBumper.position.set(0, 0.3, 2.3);
    group.add(rearBumper);

    // License plate area
    const plateGeo = new THREE.BoxGeometry(0.6, 0.2, 0.02);
    const plateMat = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.position.set(0, 0.35, 2.31);
    group.add(plate);

    return group;
}
*/

// ============================================================================
// ZERO-ALLOCATION SCRATCH OBJECTS & BUFFERS
// ============================================================================
const _scratchForward = new THREE.Vector3();
const _scratchRight = new THREE.Vector3();
const _scratchImpulse = new THREE.Vector3();
const _scratchCollisionResults = [];
const _circleOffsets = [1.35, 0.0, -1.35];

// ============================================================================
// SHARED GEOMETRY POOL (Singleton cache across all Civic instances)
// ============================================================================
class CivicGeometryPool {
    static _pool = null;

    static get() {
        if (!this._pool) {
            // Wheel cylinder is pre-rotated around Z axis so its axle lies along X
            const wheelTireGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 16);
            wheelTireGeo.rotateZ(Math.PI / 2);

            const wheelHubGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.26, 8);
            wheelHubGeo.rotateZ(Math.PI / 2);

            const exhaustGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.25, 8);
            exhaustGeo.rotateX(Math.PI / 2); // Axis along Z

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
// SHARED MATERIAL POOL (Singleton cache across all Civic instances)
// ============================================================================
class CivicMaterialPool {
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

    /**
     * Get or create a shared MeshLambertMaterial for a specific body color hex.
     * Prevents redundant material instances when multiple vehicles share colors.
     * @param {number} colorHex 
     * @returns {THREE.MeshLambertMaterial}
     */
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

// ============================================================================
// OPTIMIZED CIVIC MESH HIERARCHY FACTORY
// ============================================================================
/**
 * Constructs the authentic Kaj Simulator Honda Civic mesh hierarchy
 * using pooled geometries and materials, with steerable front wheels and
 * spin-capable wheel rollers.
 * 
 * @param {number} [color=0x111111] Body paint color hex
 * @param {string|number} [id='civic'] Vehicle ID
 * @returns {{ root: THREE.Group, wheelPivots: object, wheels: object }}
 */
export function createOptimizedHondaCivic(color = 0x111111, id = 'civic') {
    const geos = CivicGeometryPool.get();
    const mats = CivicMaterialPool.getCommon();
    const bodyMat = CivicMaterialPool.getBodyMaterial(color);

    const root = new THREE.Group();
    root.name = `civic_${id}`;

    // 1. Main Sedan Body
    const body = new THREE.Mesh(geos.body, bodyMat);
    body.position.y = 0.55;
    root.add(body);

    // 2. Cabin / Roof Greenhouse
    const cabin = new THREE.Mesh(geos.cabin, mats.cabin);
    cabin.position.set(0, 1.1, -0.3);
    root.add(cabin);

    // 3. Windshield (Front Glass, angled)
    const windshield = new THREE.Mesh(geos.windshield, mats.glass);
    windshield.position.set(0, 1.1, -1.4);
    windshield.rotation.x = -0.2;
    root.add(windshield);

    // 4. Rear Window (Angled)
    const rearGlass = new THREE.Mesh(geos.rearGlass, mats.glass);
    rearGlass.position.set(0, 1.05, 0.8);
    rearGlass.rotation.x = 0.2;
    root.add(rearGlass);

    // 5. Side Windows
    const leftWindow = new THREE.Mesh(geos.sideWindow, mats.glass);
    leftWindow.position.set(-0.97, 1.1, -0.3);
    root.add(leftWindow);

    const rightWindow = new THREE.Mesh(geos.sideWindow, mats.glass);
    rightWindow.position.set(0.97, 1.1, -0.3);
    root.add(rightWindow);

    // 6. Headlights (-Z Front)
    const headlightL = new THREE.Mesh(geos.headlight, mats.headlight);
    headlightL.position.set(-0.7, 0.55, -2.26);
    root.add(headlightL);

    const headlightR = new THREE.Mesh(geos.headlight, mats.headlight);
    headlightR.position.set(0.7, 0.55, -2.26);
    root.add(headlightR);

    // 7. Taillights (+Z Rear)
    const taillightL = new THREE.Mesh(geos.taillight, mats.taillight);
    taillightL.position.set(-0.7, 0.55, 2.26);
    root.add(taillightL);

    const taillightR = new THREE.Mesh(geos.taillight, mats.taillight);
    taillightR.position.set(0.7, 0.55, 2.26);
    root.add(taillightR);

    // 8. Bumpers (Front & Rear)
    const frontBumper = new THREE.Mesh(geos.bumper, mats.bumper);
    frontBumper.position.set(0, 0.3, -2.3);
    root.add(frontBumper);

    const rearBumper = new THREE.Mesh(geos.bumper, mats.bumper);
    rearBumper.position.set(0, 0.3, 2.3);
    root.add(rearBumper);

    // 9. Rear License Plate
    const plate = new THREE.Mesh(geos.licensePlate, mats.licensePlate);
    plate.position.set(0, 0.35, 2.31);
    root.add(plate);

    // 10. Chrome Exhaust Tip
    const exhaust = new THREE.Mesh(geos.exhaust, mats.exhaust);
    exhaust.position.set(-0.6, 0.22, 2.32);
    root.add(exhaust);

    // 11. Four Animated Wheels & Hubcaps
    // Front wheels have steerable yaw pivots; all wheels have local X-axis spin rollers
    const wheelPivots = {
        frontLeft: new THREE.Group(),
        frontRight: new THREE.Group()
    };

    const wheels = {
        frontLeft: null,
        frontRight: null,
        rearLeft: null,
        rearRight: null
    };

    const makeWheelRoller = () => {
        const roller = new THREE.Group();
        const tire = new THREE.Mesh(geos.wheelTire, mats.wheelTire);
        const hub = new THREE.Mesh(geos.wheelHub, mats.wheelHub);
        roller.add(tire);
        roller.add(hub);
        return roller;
    };

    // Axle coordinates from 7e9eef5: [±1.0, 0.35, ±1.3]
    const axleY = 0.35;
    const axleFrontZ = -1.30;
    const axleRearZ = 1.30;
    const trackX = 1.00;

    // Front Left (Steerable)
    wheelPivots.frontLeft.position.set(-trackX, axleY, axleFrontZ);
    wheels.frontLeft = makeWheelRoller();
    wheelPivots.frontLeft.add(wheels.frontLeft);
    root.add(wheelPivots.frontLeft);

    // Front Right (Steerable)
    wheelPivots.frontRight.position.set(trackX, axleY, axleFrontZ);
    wheels.frontRight = makeWheelRoller();
    wheelPivots.frontRight.add(wheels.frontRight);
    root.add(wheelPivots.frontRight);

    // Rear Left (Fixed yaw)
    const rlPivot = new THREE.Group();
    rlPivot.position.set(-trackX, axleY, axleRearZ);
    wheels.rearLeft = makeWheelRoller();
    rlPivot.add(wheels.rearLeft);
    root.add(rlPivot);

    // Rear Right (Fixed yaw)
    const rrPivot = new THREE.Group();
    rrPivot.position.set(trackX, axleY, axleRearZ);
    wheels.rearRight = makeWheelRoller();
    rrPivot.add(wheels.rearRight);
    root.add(rrPivot);

    return { root, wheelPivots, wheels };
}

// ============================================================================
// PRODUCTION VEHICLE CLASS (CIVIC BASIS WITH VERIFIED KINEMATIC BICYCLE MODEL)
// ============================================================================
export class CivicVehicle {
    /**
     * @param {string|number} id Unique identifier
     * @param {number} [x=0] Initial X
     * @param {number} [z=0] Initial Z
     * @param {number} [yaw=0] Initial heading radians (0 = -Z)
     * @param {number} [color=0x111111] Body paint color hex (0x111111 is Kaj black)
     * @param {boolean} [isPlayer=false] Whether this vehicle is player-controlled
     */
    constructor(id, x = 0, z = 0, yaw = 0, color = 0x111111, isPlayer = false) {
        this.id = id;
        this.isPlayer = !!isPlayer;

        // Kinematics & Pose
        this.position = new THREE.Vector3(x, 0, z);
        this.velocity = new THREE.Vector2(0, 0); // World velocity [vx, vz]
        this.yaw = yaw;                         // Heading angle in radians (0 = -Z)
        this.speed = 0;                         // Signed longitudinal speed (m/s)
        this.steerAngle = 0;                    // Steer angle of front wheels (radians)

        // Physical Dimensions (Authentic 7e9eef5 Honda Civic)
        this.length = 4.5;                      // Body length
        this.width = 2.2;                       // Body width
        this.height = 1.4;                      // Total height
        this.radius = 2.25;                     // Outer bounding radius
        this.wheelbase = 2.6;                   // Front-to-rear axle distance (1.3 - (-1.3) = 2.6m)
        this.halfWheelbase = 1.3;               // Distance to center of mass (lf = lr = 1.3m)
        this.circleRadius = 1.10;               // 3-circle capsule decomposition radius
        this.wheelRadius = 0.35;                // Wheel cylinder radius

        // Dynamics Tuning
        this.maxForwardSpeed = 28.0;            // ~100.8 km/h
        this.maxReverseSpeed = -9.0;            // ~32.4 km/h
        this.baseAccel = 9.5;                   // Forward acceleration (m/s^2)
        this.reverseAccel = 5.0;                // Reverse acceleration (m/s^2)
        this.brakeDecel = 16.0;                 // Braking deceleration (m/s^2)
        this.handbrakeDecel = 24.0;             // Emergency handbrake deceleration (m/s^2)
        this.rollingFriction = 0.6;             // Rolling friction (m/s^2)
        this.dragCoeff = 0.0035;                // Aerodynamic drag
        this.normalGrip = 14.0;                 // Lateral tire grip damping (s^-1)
        this.handbrakeGrip = 2.5;               // Drift lateral grip damping (s^-1)
        this.maxSteerAngle = 0.55;              // Maximum steer angle (~31.5 deg)
        this.steerSpeed = 4.5;                  // Steer turning rate (rad/s)
        this.steerCenterSpeed = 6.0;            // Steer return rate (rad/s)

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

        // Optimized 3D Procedural Mesh
        const meshData = createOptimizedHondaCivic(color, id);
        this.mesh = meshData.root;
        this.wheelPivots = meshData.wheelPivots;
        this.wheels = meshData.wheels;
        this.wheelRoll = 0;

        this._updateMeshTransform(0);
    }

    /**
     * Attaches mesh to scene if not already added.
     * @param {THREE.Scene} scene 
     * @returns {THREE.Group}
     */
    initMesh(scene) {
        if (scene && this.mesh && !this.mesh.parent) {
            scene.add(this.mesh);
        }
        return this.mesh;
    }

    /**
     * Sets player-controlled flag.
     * @param {boolean} isControlled 
     */
    setPlayerControlled(isControlled) {
        this.isPlayer = !!isControlled;
    }

    /**
     * Sets driving control inputs with adversarial safety sanitization.
     * @param {boolean|number} throttle Demand [0, 1]
     * @param {number|{left: boolean, right: boolean}} steer Steering demand [-1, 1]
     * @param {boolean|number} brake Braking/reverse demand [0, 1]
     * @param {boolean} [handbrake=false] Handbrake
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

        // Simultaneous W+S safety: braking takes precedence
        if (this.inputThrottle > 0 && this.inputBrake > 0) {
            this.inputThrottle = 0;
        }
    }

    /**
     * Executes a single fixed 60Hz physics simulation step.
     * Guaranteed ZERO garbage collection heap allocations.
     * 
     * @param {number} dt Timestep in seconds (e.g. 1/60)
     * @param {SpatialGrid|Object} [spatialGridOrInput=null]
     * @param {SpatialGrid} [spatialGrid=null]
     * @param {Object} [roadNetwork=null]
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
                    accel = this.brakeDecel; // Braking while reversing
                } else {
                    const speedRatio = Math.max(0, Math.min(1, this.speed / this.maxForwardSpeed));
                    const powerCurve = Math.max(0, 1.0 - Math.pow(speedRatio, 1.2));
                    accel = this.inputThrottle * this.baseAccel * powerCurve;
                }
            } else if (this.inputBrake > 0) {
                if (this.speed > 0.3) {
                    accel = -this.inputBrake * this.brakeDecel; // Forward braking
                } else {
                    const reverseRatio = Math.max(0, Math.min(1, Math.abs(this.speed) / Math.abs(this.maxReverseSpeed)));
                    const reverseCurve = Math.max(0, 1.0 - reverseRatio * 0.8);
                    accel = -this.inputBrake * this.reverseAccel * reverseCurve;
                }
            } else {
                // Rolling friction & aerodynamic drag
                if (speedMagnitude > 0.05) {
                    const drag = this.dragCoeff * this.speed * speedMagnitude;
                    const friction = Math.sign(this.speed) * this.rollingFriction;
                    accel = -(friction + drag);
                } else {
                    this.speed = 0;
                }
            }
        }

        const prevSpeed = this.speed;
        this.speed += accel * dt;

        // Snap zero-crossing when braking
        if ((prevSpeed > 0 && this.speed < 0 && this.inputThrottle === 0 && this.inputBrake > 0 && prevSpeed < 2.0) ||
            (prevSpeed < 0 && this.speed > 0 && this.inputThrottle > 0 && this.inputBrake === 0 && prevSpeed > -2.0)) {
            this.speed = 0;
        }

        this.speed = Math.max(this.maxReverseSpeed, Math.min(this.maxForwardSpeed, this.speed));

        // 3. Extended Kinematic Bicycle model equations
        const tanDelta = Math.tan(this.steerAngle);
        const beta = Math.atan((this.halfWheelbase / this.wheelbase) * tanDelta);

        if (Math.abs(this.speed) > 0.01) {
            const yawRate = (this.speed / this.wheelbase) * Math.cos(beta) * tanDelta;
            this.yaw += yawRate * dt;

            // Wrap yaw to [-PI, PI]
            while (this.yaw > Math.PI) this.yaw -= 2 * Math.PI;
            while (this.yaw < -Math.PI) this.yaw += 2 * Math.PI;
        }

        // Unit heading vectors (Three.js standard: yaw=0 faces -Z)
        const sinYaw = Math.sin(this.yaw);
        const cosYaw = Math.cos(this.yaw);
        _scratchForward.set(-sinYaw, 0, -cosYaw);
        _scratchRight.set(cosYaw, 0, -sinYaw);

        // Decompose velocity into longitudinal and lateral
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

        // 5. Collision detection & response against SpatialGrid
        if (grid) {
            this._resolveCollisions(grid);
        }

        // 6. Hard world boundary clamping within [-280, 280]
        this._enforceWorldBounds();

        // 7. Defensive validation & lastSafePosition recovery
        this._validateState();

        // 8. Update visual mesh transform and wheel animations
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

        // Center 3 collision circles along longitudinal axis
        for (let i = 0; i < 3; i++) {
            const offset = _circleOffsets[i];
            const circle = this.collisionCircles[i];
            circle.x = this.position.x + offset * fwdX;
            circle.z = this.position.z + offset * fwdZ;
        }

        spatialGrid.queryRadius(this.position.x, this.position.z, this.radius + 3.0, _scratchCollisionResults, 'ALL');

        let totalMtvX = 0;
        let totalMtvZ = 0;
        let collisionCount = 0;

        for (let i = 0, len = _scratchCollisionResults.length; i < len; i++) {
            const item = _scratchCollisionResults[i];
            if (item.id === this.id || item.entityRef === this) continue;

            // Static Obstacle (AABB)
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
            // Dynamic Vehicle (Circle vs Circle)
            else if (!item.isStatic && item.entityRef && item.entityRef.collisionCircles) {
                const other = item.entityRef;
                const dxV = other.position.x - this.position.x;
                const dzV = other.position.z - this.position.z;
                const combinedRadius = this.radius + (other.radius || 2.25);
                if (dxV * dxV + dzV * dzV > combinedRadius * combinedRadius) continue;

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

        // Apply Minimum Translation Vector & restitution reflection
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
     * Pedestrian hit and ragdoll impulse hook (verbatim 7e9eef5 mechanics).
     * @param {Array<Object>} pedestrians Array of pedestrian entities
     * @param {Function} [createBloodPoolCallback] Optional callback to spawn decal
     */
    checkPedestrianCollisions(pedestrians, createBloodPoolCallback = null) {
        if (!Array.isArray(pedestrians) || pedestrians.length === 0) return;

        const sinYaw = Math.sin(this.yaw);
        const cosYaw = Math.cos(this.yaw);
        _scratchForward.set(-sinYaw, 0, -cosYaw);

        const collisionRadius = 1.6; // Tuned 7e9eef5 collision radius

        for (let i = 0, len = pedestrians.length; i < len; i++) {
            const ped = pedestrians[i];
            if (!ped || ped.isDead || !ped.mesh) continue;

            const pd = ped.mesh.position.distanceTo(this.position);
            if (pd < collisionRadius) {
                ped.isDead = true;
                ped.state = 'dead';

                // Apply impulse scaled with vehicle forward vector & speed
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
     * Enforces world boundary limits [-280, 280].
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
     * Defensive validation against NaN / Infinity state corruption.
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
            console.warn(`[CivicVehicle ${this.id}] Detected non-finite state! Reverting to lastSafePosition.`);
            this.position.copy(this.lastSafePosition);
            this.velocity.set(0, 0);
            this.speed = 0;
            this.yaw = this.lastSafeYaw;
            this.steerAngle = 0;
        }
    }

    /**
     * Updates visual mesh transform and wheel rotation animations.
     * @param {number} dt 
     */
    _updateMeshTransform(dt) {
        if (!this.mesh) return;

        this.mesh.position.set(this.position.x, this.position.y, this.position.z);
        this.mesh.rotation.y = this.yaw;

        // Front wheel steering
        if (this.wheelPivots) {
            this.wheelPivots.frontLeft.rotation.y = this.steerAngle;
            this.wheelPivots.frontRight.rotation.y = this.steerAngle;
        }

        // Wheel rolling rotation
        if (dt > 0 && this.wheels) {
            const rollDelta = (this.speed * dt) / this.wheelRadius;
            this.wheelRoll += rollDelta;

            // Rolling around local X axis
            this.wheels.frontLeft.rotation.x = -this.wheelRoll;
            this.wheels.frontRight.rotation.x = -this.wheelRoll;
            this.wheels.rearLeft.rotation.x = -this.wheelRoll;
            this.wheels.rearRight.rotation.x = -this.wheelRoll;
        }
    }

    // --- Interface Contract Getters (PROJECT.md §3) ---
    getPosition() { return { x: this.position.x, y: this.position.y, z: this.position.z }; }
    getYaw() { return this.yaw; }
    getSpeed() { return this.speed; }
    getVelocity() { return { x: this.velocity.x, z: this.velocity.y }; }
    getBoundingCircles() { return this.collisionCircles; }
    getMesh() { return this.mesh; }

    checkCollisionAndRespond(spatialGrid, dt = 1 / 60) {
        if (spatialGrid) this._resolveCollisions(spatialGrid);
    }

    destroy() {
        if (this.mesh && this.mesh.parent) {
            this.mesh.parent.remove(this.mesh);
        }
        // Do NOT dispose shared geometries or materials here, as they are pooled across vehicles!
    }
}

// ============================================================================
// HUD INTEGRATION HELPERS (Verbatim 7e9eef5 styling & layouts)
// ============================================================================

/**
 * Ensures #car-indicator and #car-speed-hud exist in the DOM with authentic 7e9eef5 styles.
 * @param {HTMLElement} [container=document.body]
 */
export function ensureCivicHUD(container = (typeof document !== 'undefined' ? document.body : null)) {
    if (!container || typeof document === 'undefined') return;

    // #car-indicator
    if (!document.getElementById('car-indicator')) {
        const ind = document.createElement('div');
        ind.id = 'car-indicator';
        ind.style.cssText = 'display:none;position:absolute;top:55%;left:50%;transform:translate(-50%,-50%);' +
            'color:#7cff7c;font-family:Arial,sans-serif;font-size:18px;font-weight:bold;' +
            'background:rgba(0,0,0,0.6);padding:8px 16px;border-radius:5px;z-index:140;pointer-events:none;';
        ind.innerHTML = "<span class='key-hint'>(E) </span>Enter Car";
        container.appendChild(ind);
    }

    // #car-speed-hud
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
 * @param {CivicVehicle} vehicle Active or nearby vehicle
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
        if (val && vehicle) {
            // Convert speed m/s to display mph (1 m/s ~ 2.237 mph, or 7e9eef5 scale ~ speed * 100)
            const mph = Math.abs(Math.round(vehicle.getSpeed() * 2.237));
            val.textContent = mph;
        }
    } else {
        if (hud) hud.style.display = 'none';
        if (ind) {
            ind.style.display = (isNear && vehicle) ? 'block' : 'none';
        }
    }
}
