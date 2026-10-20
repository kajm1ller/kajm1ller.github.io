/**
 * js/game/vehicle.js
 * 
 * High-performance Vehicle Physics, Collision Response, and Procedural Mesh
 * for Kaj Simulator.
 * 
 * Conforms to:
 * - Extended Kinematic Bicycle model with slip angle and lateral grip damping
 * - Project coordinate frame: yaw=0 points along -Z (Three.js standard camera & roadNetwork convention)
 * - Power-curve acceleration (max 28 m/s ~ 100.8 km/h)
 * - Progressive braking vs reverse gear (max -9 m/s)
 * - Rolling friction and aerodynamic drag
 * - Speed-sensitive steering smoothing with dynamic Ackermann angle scaling
 * - 2D planar collision detection (3-circle decomposition with zero-gap capsule coverage)
 * - Contact normal MTV separation and impulse reflection against SpatialGrid obstacles
 * - World boundary clamping within [-280, 280]
 * - Defensive Number.isFinite() validation with lastSafePosition corruption recovery
 * - Procedural 3D Three.js mesh with animated turning front wheels and spinning tires
 * - Zero GC allocation during active 60Hz physics stepping
 * 
 * Note: When deployed to `js/game/vehicle.js`, import is `./config.js`.
 */

import * as THREE from 'three';
import { CONFIG } from '../../../js/game/config.js';

// Pre-allocated reusable scratch vectors for zero-allocation physics stepping
const _scratchForward = new THREE.Vector3();
const _scratchRight = new THREE.Vector3();
const _scratchCollisionResults = [];
// Circle offsets along heading: Front (+1.35m fwd), Center (0m), Rear (-1.35m fwd)
const _circleOffsets = [1.35, 0.0, -1.35];

export class Vehicle {
    /**
     * @param {string|number} id Unique identifier
     * @param {number} x Initial X coordinate
     * @param {number} z Initial Z coordinate
     * @param {number} [yaw=0] Initial heading in radians (0 = facing -Z)
     * @param {number} [color=0xcc2222] Body color hex
     */
    constructor(id, x = 0, z = 0, yaw = 0, color = 0xcc2222) {
        this.id = id;
        
        // Pose
        this.position = new THREE.Vector3(x, 0, z);
        this.velocity = new THREE.Vector2(0, 0); // Horizontal world velocity [vx, vz]
        this.yaw = yaw;                         // Heading angle in radians (0 = -Z)
        this.speed = 0;                         // Signed longitudinal speed (m/s)
        this.steerAngle = 0;                    // Current front wheel steer angle (radians)

        // Physical dimensions & limits (derived from CONFIG.VEHICLE)
        this.length = (CONFIG.VEHICLE && CONFIG.VEHICLE.LENGTH) || 4.5;
        this.width = (CONFIG.VEHICLE && CONFIG.VEHICLE.WIDTH) || 2.2;
        this.height = (CONFIG.VEHICLE && CONFIG.VEHICLE.HEIGHT) || 1.4;
        this.radius = (CONFIG.VEHICLE && CONFIG.VEHICLE.RADIUS) || 2.25;
        this.wheelbase = 2.8;                   // Axle-to-axle distance (m)
        this.halfWheelbase = 1.4;               // CoM to axle distance (lf = lr = 1.4m)
        this.circleRadius = 1.10;               // 3-circle decomposition radius

        // Dynamics constants
        this.maxForwardSpeed = 28.0;            // Max forward velocity (m/s)
        this.maxReverseSpeed = -9.0;            // Max reverse velocity (m/s)
        this.baseAccel = 9.5;                   // Stall forward acceleration (m/s^2)
        this.reverseAccel = 5.0;                // Reverse gear acceleration (m/s^2)
        this.brakeDecel = 16.0;                 // Braking deceleration (m/s^2)
        this.handbrakeDecel = 24.0;             // Handbrake deceleration (m/s^2)
        this.rollingFriction = 0.6;             // Rolling resistance (m/s^2)
        this.dragCoeff = 0.0035;                // Aerodynamic drag coefficient
        this.normalGrip = 14.0;                 // Normal lateral grip damping factor (s^-1)
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

        // 3D Procedural Mesh
        this.mesh = this._createProceduralMesh(color);
        this.wheelRoll = 0;
        this._updateMeshTransform(0);
    }

    /**
     * Sets control inputs for the vehicle.
     * Robustly resolves contradictory inputs (e.g. simultaneous W+S or A+D).
     * 
     * @param {boolean|number} throttle Forward throttle demand [0, 1]
     * @param {number|{left: boolean, right: boolean}} steer Steering demand [-1, 1] (negative = left, positive = right)
     * @param {boolean|number} brake Braking / reverse demand [0, 1]
     * @param {boolean} [handbrake=false] Handbrake state
     */
    setInputs(throttle, steer, brake, handbrake = false) {
        // Resolve steering: left turns vehicle counter-clockwise (positive yaw), right turns clockwise (negative yaw)
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

        // Contradictory Input Safety:
        // When brake and throttle are pressed simultaneously, braking takes priority
        if (this.inputThrottle > 0 && this.inputBrake > 0) {
            this.inputThrottle = 0;
        }
    }

    /**
     * Executes a single fixed physics simulation step.
     * Guaranteed zero garbage collection allocations.
     * 
     * @param {number} dt Timestep in seconds (e.g. 1/60)
     * @param {SpatialGrid} [spatialGrid=null] Spatial hash grid broadphase
     */
    update(dt, spatialGrid = null) {
        if (!dt || dt <= 0) return;

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
            // Handbrake overrides all engine power
            if (speedMagnitude > 0.1) {
                accel = -Math.sign(this.speed) * this.handbrakeDecel;
            } else {
                this.speed = 0;
            }
        } else {
            // Forward throttle
            if (this.inputThrottle > 0) {
                if (this.speed < -0.5) {
                    // Moving reverse: W acts as heavy forward brake
                    accel = this.brakeDecel;
                } else {
                    // Normal forward acceleration with realistic torque/power curve
                    const speedRatio = Math.max(0, Math.min(1, this.speed / this.maxForwardSpeed));
                    const powerCurve = Math.max(0, 1.0 - Math.pow(speedRatio, 1.2));
                    accel = this.inputThrottle * this.baseAccel * powerCurve;
                }
            }
            // Braking vs Reverse gear
            else if (this.inputBrake > 0) {
                if (this.speed > 0.3) {
                    // Moving forward: S acts as brake
                    accel = -this.inputBrake * this.brakeDecel;
                } else {
                    // Stopped or reversing: S acts as reverse throttle
                    const revRatio = Math.max(0, Math.min(1, Math.abs(this.speed) / Math.abs(this.maxReverseSpeed)));
                    const revCurve = Math.max(0, 1.0 - revRatio);
                    accel = -this.inputBrake * this.reverseAccel * revCurve;
                }
            }

            // Resistive forces: Rolling resistance
            if (speedMagnitude > 0.05) {
                const rollDecel = Math.sign(this.speed) * this.rollingFriction;
                accel -= rollDecel;
            } else if (this.inputThrottle === 0 && this.inputBrake === 0) {
                this.speed = 0;
            }

            // Resistive forces: Aerodynamic drag
            accel -= this.dragCoeff * this.speed * speedMagnitude;
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
        // Slip angle beta at center of mass
        const tanDelta = Math.tan(this.steerAngle);
        const beta = Math.atan((this.halfWheelbase / this.wheelbase) * tanDelta);

        // Yaw rate: dTheta/dt = (v / L) * cos(beta) * tan(delta)
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

        // Decompose velocity into longitudinal and lateral components
        let vLong = this.velocity.x * _scratchForward.x + this.velocity.y * _scratchForward.z;
        let vLat = this.velocity.x * _scratchRight.x + this.velocity.y * _scratchRight.z;

        // Drive longitudinal speed
        vLong = this.speed;

        // Lateral grip damping (tire friction opposing sideways slide)
        const gripFactor = this.inputHandbrake ? this.handbrakeGrip : this.normalGrip;
        vLat *= Math.max(0, 1.0 - gripFactor * dt);

        // Reconstruct world velocity
        this.velocity.x = vLong * _scratchForward.x + vLat * _scratchRight.x;
        this.velocity.y = vLong * _scratchForward.z + vLat * _scratchRight.z;

        // 4. Integrate horizontal position
        this.position.x += this.velocity.x * dt;
        this.position.z += this.velocity.y * dt;

        // 5. Collision detection & response against SpatialGrid obstacles
        if (spatialGrid) {
            this._resolveCollisions(spatialGrid);
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
        // Forward unit vector: (-sinYaw, -cosYaw)
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

            // Avoid self-collision
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
                            // Deep penetration: find nearest box face
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
                // Outer bounding check
                const bDx = this.position.x - other.position.x;
                const bDz = this.position.z - other.position.z;
                if (bDx * bDx + bDz * bDz < (this.radius + other.radius) * (this.radius + other.radius)) {
                    // Check pairwise circle decomposition (3 x 3)
                    for (let c1 = 0; c1 < 3; c1++) {
                        const myC = this.collisionCircles[c1];
                        for (let c2 = 0; c2 < 3; c2++) {
                            const otherC = other.collisionCircles[c2];
                            const cDx = myC.x - otherC.x;
                            const cDz = myC.z - otherC.z;
                            const cDistSq = cDx * cDx + cDz * cDz;
                            const combinedR = this.circleRadius + other.circleRadius;

                            if (cDistSq < combinedR * combinedR && cDistSq > 1e-6) {
                                const cDist = Math.sqrt(cDistSq);
                                const cPen = (combinedR - cDist) * 0.5; // Shared separation
                                const cNx = cDx / cDist;
                                const cNz = cDz / cDist;

                                totalMtvX += cNx * cPen;
                                totalMtvZ += cNz * cPen;
                                collisionCount++;
                            }
                        }
                    }
                }
            }
        }

        // Apply MTV separation and impulse response
        if (collisionCount > 0) {
            // Apply positional correction
            this.position.x += totalMtvX;
            this.position.z += totalMtvZ;

            // Normalize contact normal
            const mtvLen = Math.hypot(totalMtvX, totalMtvZ);
            if (mtvLen > 1e-4) {
                const normX = totalMtvX / mtvLen;
                const normZ = totalMtvZ / mtvLen;

                // Relative velocity against static surface
                const vDotN = this.velocity.x * normX + this.velocity.y * normZ;

                if (vDotN < 0) {
                    const restitution = 0.20; // Slight elastic bounce
                    const friction = 0.50;    // Tangential friction damping

                    const vNormX = vDotN * normX;
                    const vNormZ = vDotN * normZ;
                    const vTangX = this.velocity.x - vNormX;
                    const vTangZ = this.velocity.y - vNormZ;

                    this.velocity.x = vTangX * (1 - friction) - vNormX * restitution;
                    this.velocity.y = vTangZ * (1 - friction) - vNormZ * restitution;

                    // Re-project longitudinal speed
                    this.speed = this.velocity.x * fwdX + this.velocity.y * fwdZ;
                }
            }
        }
    }

    /**
     * Enforces world bounds clamping within [-280, 280] meters.
     */
    _enforceWorldBounds() {
        const bound = 280.0;
        const margin = this.circleRadius; // 1.10m safety hull margin

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
            // State is healthy: update recovery snapshot
            this.lastSafePosition.set(px, py, pz);
            this.lastSafeYaw = yaw;
        } else {
            // Corruption detected: revert to recovery snapshot
            console.warn(`[Vehicle ${this.id}] Detected non-finite state! Reverting to lastSafePosition.`);
            this.position.copy(this.lastSafePosition);
            this.velocity.set(0, 0);
            this.speed = 0;
            this.yaw = this.lastSafeYaw;
            this.steerAngle = 0;
        }
    }

    /**
     * Constructs the 3D procedural vehicle mesh hierarchy.
     * Oriented such that -Z is forward, matching camera and road network.
     * 
     * @param {number} color Hex color for car body
     * @returns {THREE.Group}
     */
    _createProceduralMesh(color) {
        const root = new THREE.Group();
        root.name = `vehicle_${this.id}`;

        // Shared materials
        const bodyMat = new THREE.MeshLambertMaterial({ color });
        const darkBodyMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
        const glassMat = new THREE.MeshStandardMaterial({ 
            color: 0x152238, 
            roughness: 0.1, 
            metalness: 0.8,
            transparent: true,
            opacity: 0.85
        });
        const wheelMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
        const rimMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8, roughness: 0.3 });
        const lightHeadMat = new THREE.MeshBasicMaterial({ color: 0xffffee });
        const lightTailMat = new THREE.MeshBasicMaterial({ color: 0xff1111 });

        // 1. Lower Chassis
        const chassisGeo = new THREE.BoxGeometry(2.1, 0.55, 4.4);
        const chassis = new THREE.Mesh(chassisGeo, bodyMat);
        chassis.position.y = 0.55;
        root.add(chassis);

        // Bumper trims (Front at -2.1, Rear at +2.1)
        const bumperGeo = new THREE.BoxGeometry(2.14, 0.25, 0.4);
        const frontBumper = new THREE.Mesh(bumperGeo, darkBodyMat);
        frontBumper.position.set(0, 0.35, -2.1);
        root.add(frontBumper);

        const rearBumper = new THREE.Mesh(bumperGeo, darkBodyMat);
        rearBumper.position.set(0, 0.35, 2.1);
        root.add(rearBumper);

        // 2. Cabin Greenhouse
        const cabinGeo = new THREE.BoxGeometry(1.8, 0.65, 2.3);
        const cabin = new THREE.Mesh(cabinGeo, bodyMat);
        cabin.position.set(0, 1.15, 0.2); // shifted slightly toward rear
        root.add(cabin);

        // Windshield (Front at -0.98, Rear at +1.38)
        const frontWindshieldGeo = new THREE.BoxGeometry(1.65, 0.55, 0.05);
        const frontWindshield = new THREE.Mesh(frontWindshieldGeo, glassMat);
        frontWindshield.position.set(0, 1.1, -0.98);
        frontWindshield.rotation.x = -0.4;
        root.add(frontWindshield);

        const rearWindshield = new THREE.Mesh(frontWindshieldGeo, glassMat);
        rearWindshield.position.set(0, 1.1, 1.38);
        rearWindshield.rotation.x = 0.4;
        root.add(rearWindshield);

        // Side windows
        const sideWindowGeo = new THREE.BoxGeometry(0.05, 0.45, 1.8);
        const leftWindow = new THREE.Mesh(sideWindowGeo, glassMat);
        leftWindow.position.set(-0.91, 1.15, 0.2);
        root.add(leftWindow);

        const rightWindow = new THREE.Mesh(sideWindowGeo, glassMat);
        rightWindow.position.set(0.91, 1.15, 0.2);
        root.add(rightWindow);

        // 3. Headlights (-2.21) & Taillights (+2.21)
        const headlightGeo = new THREE.BoxGeometry(0.35, 0.15, 0.1);
        const leftHeadlight = new THREE.Mesh(headlightGeo, lightHeadMat);
        leftHeadlight.position.set(-0.75, 0.55, -2.21);
        root.add(leftHeadlight);

        const rightHeadlight = new THREE.Mesh(headlightGeo, lightHeadMat);
        rightHeadlight.position.set(0.75, 0.55, -2.21);
        root.add(rightHeadlight);

        const taillightGeo = new THREE.BoxGeometry(0.35, 0.15, 0.1);
        const leftTaillight = new THREE.Mesh(taillightGeo, lightTailMat);
        leftTaillight.position.set(-0.75, 0.55, 2.21);
        root.add(leftTaillight);

        const rightTaillight = new THREE.Mesh(taillightGeo, lightTailMat);
        rightTaillight.position.set(0.75, 0.55, 2.21);
        root.add(rightTaillight);

        // 4. Wheels (FL, FR at z=-1.4; RL, RR at z=+1.4)
        const wheelRadius = 0.38;
        const wheelWidth = 0.28;
        const tireGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 16);
        const rimGeo = new THREE.CylinderGeometry(wheelRadius * 0.6, wheelRadius * 0.6, wheelWidth + 0.01, 12);

        this.wheels = [];
        const wheelConfigs = [
            { id: 'FL', x: -1.05, y: wheelRadius, z: -this.halfWheelbase, isFront: true },
            { id: 'FR', x: 1.05, y: wheelRadius, z: -this.halfWheelbase, isFront: true },
            { id: 'RL', x: -1.05, y: wheelRadius, z: this.halfWheelbase, isFront: false },
            { id: 'RR', x: 1.05, y: wheelRadius, z: this.halfWheelbase, isFront: false }
        ];

        for (const cfg of wheelConfigs) {
            const steerGroup = new THREE.Group();
            steerGroup.position.set(cfg.x, cfg.y, cfg.z);

            const rollGroup = new THREE.Group();
            const tire = new THREE.Mesh(tireGeo, wheelMat);
            tire.rotation.z = Math.PI / 2; // Orient cylinder along local X axis to roll on ground
            rollGroup.add(tire);

            const rim = new THREE.Mesh(rimGeo, rimMat);
            rim.rotation.z = Math.PI / 2;
            rollGroup.add(rim);

            steerGroup.add(rollGroup);
            root.add(steerGroup);

            this.wheels.push({
                isFront: cfg.isFront,
                steerGroup,
                rollGroup
            });
        }

        return root;
    }

    /**
     * Updates Three.js procedural mesh position, yaw, wheel steering, and roll rotation.
     * @param {number} dt Timestep
     */
    _updateMeshTransform(dt) {
        if (!this.mesh) return;

        // Position & heading
        this.mesh.position.set(this.position.x, this.position.y, this.position.z);
        this.mesh.rotation.y = this.yaw;

        // Animate wheel roll rotation (moving forward decreases rotation around X)
        const wheelRadius = 0.38;
        const rollDelta = (this.speed * dt) / wheelRadius;
        this.wheelRoll -= rollDelta;

        for (let i = 0; i < this.wheels.length; i++) {
            const w = this.wheels[i];
            // Front wheel steering
            if (w.isFront) {
                w.steerGroup.rotation.y = this.steerAngle;
            }
            // All wheels spin around local X-axis
            w.rollGroup.rotation.x = this.wheelRoll;
        }
    }

    // =========================================================================
    // Public API Methods conforming to PROJECT.md & E2E Test Suite
    // =========================================================================

    /**
     * @returns {{x: number, y: number, z: number}}
     */
    getPosition() {
        return {
            x: this.position.x,
            y: this.position.y,
            z: this.position.z
        };
    }

    /**
     * @returns {number} Heading in radians (0 = -Z)
     */
    getYaw() {
        return this.yaw;
    }

    /**
     * @returns {number} Longitudinal speed in m/s
     */
    getSpeed() {
        return this.speed;
    }

    /**
     * @returns {{x: number, z: number}}
     */
    getVelocity() {
        return {
            x: this.velocity.x,
            z: this.velocity.y
        };
    }

    /**
     * @returns {THREE.Group}
     */
    getMesh() {
        return this.mesh;
    }

    /**
     * Disposes geometries and materials to prevent WebGL memory leaks.
     */
    destroy() {
        if (this.mesh && this.mesh.parent) {
            this.mesh.parent.remove(this.mesh);
        }
        if (this.mesh) {
            this.mesh.traverse((child) => {
                if (child.isMesh) {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                }
            });
        }
    }
}
