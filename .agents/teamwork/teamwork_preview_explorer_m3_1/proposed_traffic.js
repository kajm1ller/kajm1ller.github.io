/**
 * js/game/traffic.js
 * 
 * Autonomous AI Traffic Fleet Management, Pure Pursuit Steering, and
 * Intelligent Driver Model (IDM) Car-Following for Kaj Simulator.
 * 
 * Milestone 3 Specification & Interface Contract:
 * - Pure Pursuit Steering:
 *     L_d = max(4.0, 0.4 * v), clamped to [4.0, 16.0]m.
 *     delta = atan2(2 * L * sin(alpha), L_d).
 *     Wheelbase L = 2.8m.
 *     Smooth multi-lane traversal without waypoint runaway.
 * - Intelligent Driver Model (IDM) Car-Following:
 *     v_dot = a * [ 1 - (v / v0)^4 - (s*(v, delta_v) / s)^2 ].
 *     s*(v, delta_v) = s0 + max(0, v * T + (v * delta_v) / (2 * sqrt(a * b))).
 *     Parameters: v0 = 12.0 - 16.0 m/s (~43 - 58 km/h), T = 1.5s, s0 = 2.5m,
 *                 a = 1.5 m/s^2, b = 2.0 m/s^2.
 *     Smooth braking to complete stop behind obstacles, lead cars, or red/yield zones.
 * - Forward Sector Spatial Sensing:
 *     SpatialGrid forward corridor query (up to 45m).
 *     Lane alignment and oncoming traffic disambiguation.
 * - Intersection Yellow-Box Management:
 *     Virtual stop-line obstacles preventing gridlock and collisions at intersections.
 * - Fleet Management & Scalability:
 *     Dynamic fleet sizing: default 50 vehicles (scalable from 10 to 60+).
 *     Uniform distribution across roadNetwork.getSpawnPoints(count).
 *     Anti-deadlock watchdog: 8s nudge, 15s soft respawn.
 *     Elastic separation impulses preventing overlapping states.
 *     Zero GC allocations during active 60Hz physics stepping.
 * 
 * Conforms to PROJECT.md § Interface Contracts (5. TrafficManager Interface).
 */

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Vehicle } from './vehicle.js';
import { RoadNetwork, ROAD_CONFIG, Lane } from './roadNetwork.js';
import { SpatialGrid } from './spatialGrid.js';

// ============================================================================
// CONFIGURATION & TUNING CONSTANTS
// ============================================================================

export const TRAFFIC_CONFIG = Object.freeze({
    // Fleet Sizing & Spawning
    DEFAULT_FLEET_SIZE: 50,
    MIN_FLEET_SIZE: 10,
    MAX_FLEET_SIZE: 75,
    SPAWN_MIN_SPACING: 12.0,            // Minimum distance between initial spawns (m)
    INITIAL_SPEED: 10.0,                 // Initial longitudinal speed at spawn (m/s)

    // Pure Pursuit Steering Parameters
    LOOKAHEAD_MIN: 4.0,                  // Minimum lookahead distance (m)
    LOOKAHEAD_KV: 0.4,                   // Speed-dependent lookahead scaling: L_d = max(4.0, 0.4 * v)
    LOOKAHEAD_MAX: 16.0,                 // Maximum lookahead clamp (m)
    WHEELBASE: 2.8,                      // Bicycle model axle-to-axle distance L (m)
    STEER_KP: 1.0,                       // Steering proportional gain

    // Intelligent Driver Model (IDM) Parameters
    IDM_DESIRED_SPEED: 14.0,             // v0: Free-flow cruising velocity in m/s (~50.4 km/h)
    IDM_DESIRED_SPEED_MIN: 12.0,         // Lower bound for randomized cruising speed (~43.2 km/h)
    IDM_DESIRED_SPEED_MAX: 16.0,         // Upper bound for randomized cruising speed (~57.6 km/h)
    IDM_INTERSECTION_SPEED: 6.0,         // Free-flow velocity in intersection zones (m/s)
    IDM_TIME_HEADWAY: 1.5,               // T: Safe time headway (seconds)
    IDM_MIN_GAP: 2.5,                    // s0: Standstill bumper-to-bumper distance (meters)
    IDM_MAX_ACCEL: 1.5,                  // a: Maximum comfortable acceleration (m/s^2)
    IDM_COMFORT_BRAKE: 2.0,              // b: Comfortable braking deceleration (m/s^2)
    IDM_DELTA: 4.0,                      // Acceleration exponent delta

    // Forward Sector Sensing & Filtering
    SENSING_RANGE_MIN: 35.0,             // Minimum forward detection distance (m)
    SENSING_RANGE_KV: 2.5,               // Speed-dependent sensing range factor (s)
    CORRIDOR_HALF_WIDTH: 1.9,            // Half-width of active driving corridor (m)
    VEHICLE_LENGTH: 4.5,                 // Effective bumper-to-bumper vehicle length (m)
    VEHICLE_RADIUS: 2.25,                // Bounding radius for spatial broadphase (m)

    // Yellow-Box Intersection Management
    INTERSECTION_BOX_RADIUS: 7.5,        // Clearance zone radius around intersection center (m)
    INTERSECTION_APPROACH_DIST: 12.0,    // Distance before junction to initiate yielding check (m)

    // Anti-Deadlock Watchdog & Elastic Separation
    WATCHDOG_NUDGE_TIME: 8.0,            // Time stationary before gentle forward nudge (seconds)
    WATCHDOG_RESPAWN_TIME: 15.0,         // Time stationary before soft respawn (seconds)
    ELASTIC_SEPARATION_DIST: 4.2,        // Pairwise threshold for soft repulsion displacement (m)
    ELASTIC_SEPARATION_STRENGTH: 6.0     // Repulsion impulse velocity multiplier

});

// Pre-computed mathematical constants for zero runtime overhead
const SQRT_AB = Math.sqrt(TRAFFIC_CONFIG.IDM_MAX_ACCEL * TRAFFIC_CONFIG.IDM_COMFORT_BRAKE); // 2 * sqrt(a * b)
const TWO_SQRT_AB = 2.0 * SQRT_AB;

// Pre-allocated reusable scratch data structures to guarantee zero GC allocations
const _scratchForward = new THREE.Vector3();
const _scratchRight = new THREE.Vector3();
const _scratchSpatialResults = [];
const _scratchNeighborResults = [];

// Palette of vehicle colors inspired by Kaj Simulator traffic
const TRAFFIC_PALETTE = [
    0x2266dd, // Royal Blue
    0xdd3322, // Crimson Red
    0xdd8822, // Sunset Orange
    0x22aa44, // Forest Green
    0xaa22aa, // Violet Purple
    0x33bbee, // Cyan Sky
    0xddbb22, // Taxi Yellow
    0x2a2a2a, // Obsidian Black
    0xeeeeee, // Pearl White
    0x777777, // Slate Grey
    0x883311, // Auburn Brown
    0x228888, // Deep Teal
    0x882244, // Wine Berry
    0x334466  // Midnight Navy
];

// ============================================================================
// PURE PURSUIT STEERING CONTROLLER
// ============================================================================

export class PurePursuitController {
    /**
     * Computes the lookahead distance based on current speed.
     * Formula: L_d = max(LOOKAHEAD_MIN, LOOKAHEAD_KV * v), clamped to LOOKAHEAD_MAX.
     * 
     * @param {number} speed Signed or unsigned longitudinal speed (m/s)
     * @returns {number} Clamped lookahead distance (m)
     */
    static getLookaheadDistance(speed) {
        const v = Math.max(0, speed);
        const ld = Math.max(TRAFFIC_CONFIG.LOOKAHEAD_MIN, TRAFFIC_CONFIG.LOOKAHEAD_KV * v);
        return Math.min(TRAFFIC_CONFIG.LOOKAHEAD_MAX, ld);
    }

    /**
     * Calculates the target steering angle delta and normalized steering input [-1, 1].
     * Formula:
     *   alpha = wrapAngle(theta_target - theta_vehicle)
     *   delta = atan2(2 * L * sin(alpha), L_d)
     * 
     * @param {Object} vehiclePose Vehicle pose { x, z, yaw } (Three.js yaw=0 faces -Z)
     * @param {Object} targetPoint Target lookahead point { x, z }
     * @param {number} speed Current vehicle speed (m/s)
     * @param {number} maxSteerAngle Vehicle maximum mechanical steering angle (rad, default ~0.55)
     * @returns {{ delta: number, normalizedSteer: number, alpha: number, lookaheadDist: number }}
     */
    static calculateSteering(vehiclePose, targetPoint, speed, maxSteerAngle = 0.55) {
        const L_d = this.getLookaheadDistance(speed);
        const dx = targetPoint.x - vehiclePose.x;
        const dz = targetPoint.z - vehiclePose.z;

        // In Three.js: yaw=0 faces -Z, so targetYaw = atan2(-dx, -dz)
        const targetYaw = Math.atan2(-dx, -dz);

        // Alpha: heading error angle wrapped to [-PI, PI]
        let alpha = (targetYaw - vehiclePose.yaw) % (Math.PI * 2);
        if (alpha < -Math.PI) alpha += Math.PI * 2;
        if (alpha > Math.PI) alpha -= Math.PI * 2;

        // Pure pursuit steering curvature: kappa = 2 * sin(alpha) / L_d
        // Steering angle: delta = atan2(2 * L * sin(alpha), L_d)
        const delta = Math.atan2(2.0 * TRAFFIC_CONFIG.WHEELBASE * Math.sin(alpha), L_d);

        // Account for vehicle speed-sensitive steering factor (from vehicle.js)
        const speedSteerFactor = 1.0 / (1.0 + 0.05 * Math.abs(speed));
        const effectiveMaxSteer = Math.max(1e-4, maxSteerAngle * speedSteerFactor);

        // Normalized inputSteer in [-1, 1]: positive is left, negative is right
        const normalizedSteer = Math.max(-1.0, Math.min(1.0, delta / effectiveMaxSteer));

        return {
            delta,
            normalizedSteer,
            alpha,
            lookaheadDist: L_d
        };
    }
}

// ============================================================================
// INTELLIGENT DRIVER MODEL (IDM) CONTROLLER
// ============================================================================

export class IDMController {
    /**
     * Computes the longitudinal acceleration according to the Intelligent Driver Model (IDM).
     * Formula:
     *   v_dot = a * [ 1 - (v / v0)^4 - (s*(v, delta_v) / s)^2 ]
     *   s*(v, delta_v) = s0 + max(0, v * T + (v * delta_v) / (2 * sqrt(a * b)))
     * 
     * @param {number} v Current ego speed (m/s)
     * @param {number} v0 Desired free-flow speed (m/s)
     * @param {number} s Bumper-to-bumper gap to lead vehicle (m, Infinity if no obstacle)
     * @param {number} deltaV Relative speed (v - v_lead) in m/s
     * @returns {number} Commanded acceleration v_dot in m/s^2
     */
    static computeAcceleration(v, v0, s, deltaV) {
        const egoSpeed = Math.max(0, v);
        const desiredSpeed = Math.max(0.5, v0);

        // Free-road term: 1 - (v / v0)^4
        const ratio = egoSpeed / desiredSpeed;
        const freeTerm = 1.0 - (ratio * ratio * ratio * ratio);

        // Car-following term: (s* / s)^2
        let followTerm = 0;
        if (Number.isFinite(s) && s > 0) {
            // Dynamic desired gap s*(v, delta_v)
            const dynamicGap = egoSpeed * TRAFFIC_CONFIG.IDM_TIME_HEADWAY +
                (egoSpeed * deltaV) / TWO_SQRT_AB;
            const sStar = TRAFFIC_CONFIG.IDM_MIN_GAP + Math.max(0, dynamicGap);

            const gapRatio = sStar / Math.max(0.1, s);
            followTerm = gapRatio * gapRatio;
        }

        const aCmd = TRAFFIC_CONFIG.IDM_MAX_ACCEL * (freeTerm - followTerm);
        return aCmd;
    }

    /**
     * Maps the continuous acceleration demand aCmd to discrete vehicle inputs (throttle, brake).
     * 
     * @param {number} aCmd Commanded acceleration from IDM (m/s^2)
     * @param {number} currentSpeed Current vehicle speed (m/s)
     * @param {number} netGap Bumper-to-bumper gap to lead obstacle (m)
     * @returns {{ throttle: number, brake: number }}
     */
    static mapToInputs(aCmd, currentSpeed, netGap) {
        // Critical safety standstill hold: if gap <= s0 or stopped with negative acceleration
        if (netGap <= TRAFFIC_CONFIG.IDM_MIN_GAP && currentSpeed < 0.5) {
            return { throttle: 0, brake: 1.0 };
        }

        if (currentSpeed < 0.05 && aCmd <= 0) {
            return { throttle: 0, brake: 1.0 };
        }

        if (aCmd >= 0) {
            // Forward drive: scale throttle proportionally
            const throttle = Math.max(0, Math.min(1.0, aCmd / TRAFFIC_CONFIG.IDM_MAX_ACCEL));
            return { throttle, brake: 0 };
        } else {
            // Braking demand: smooth progressive deceleration up to emergency max
            const decel = -aCmd;
            // 4.0 m/s^2 maps to full service brake, higher triggers emergency clamping
            const brake = Math.max(0, Math.min(1.0, decel / 4.0));
            return { throttle: 0, brake };
        }
    }
}

// ============================================================================
// TRAFFIC AGENT
// ============================================================================

/**
 * Represents an individual autonomous AI driver navigating the road network.
 */
export class TrafficAgent {
    /**
     * @param {Vehicle} vehicle Physical vehicle instance
     * @param {string} laneId Initial road network lane ID
     * @param {number} waypointIndex Initial waypoint index within lane
     * @param {number} [desiredSpeed=14.0] Free-flow cruising speed (m/s)
     */
    constructor(vehicle, laneId, waypointIndex, desiredSpeed = TRAFFIC_CONFIG.IDM_DESIRED_SPEED) {
        this.vehicle = vehicle;
        this.laneId = laneId;
        this.waypointIndex = waypointIndex;
        this.desiredSpeed = desiredSpeed;

        // Anti-deadlock and intersection watchdog timers
        this.stationaryTimer = 0;
        this.inIntersection = false;
        this.reservedIntersectionId = null;

        // Lookahead and sensing caches
        this.lookaheadTarget = { x: 0, z: 0, yaw: 0, laneId: '', index: 0 };
        this.detectedLeadGap = Infinity;
        this.detectedLeadSpeed = 0;
        this.commandedAccel = 0;
    }

    /**
     * Projects the vehicle position onto the current lane segment and updates waypointIndex.
     * Transitions smoothly to a successor lane when reaching the end of the current lane.
     * 
     * @param {RoadNetwork} roadNetwork
     */
    updateLaneProgress(roadNetwork) {
        let lane = roadNetwork.getLane(this.laneId);
        if (!lane || lane.waypoints.length === 0) {
            // Fallback: recover to nearest waypoint in the entire network
            const nearest = roadNetwork.getNearestWaypoint(this.vehicle.position.x, this.vehicle.position.z);
            this.laneId = nearest.laneId;
            this.waypointIndex = nearest.index;
            lane = roadNetwork.getLane(this.laneId);
            if (!lane) return;
        }

        const waypoints = lane.waypoints;
        const totalWps = waypoints.length;
        const px = this.vehicle.position.x;
        const pz = this.vehicle.position.z;

        // Search in a forward window of 3 waypoints around current index
        let currIdx = Math.max(0, Math.min(totalWps - 2, this.waypointIndex));

        while (currIdx < totalWps - 1) {
            const p1 = waypoints[currIdx];
            const p2 = waypoints[currIdx + 1];

            const dx = p2.x - p1.x;
            const dz = p2.z - p1.z;
            const segLenSq = dx * dx + dz * dz;

            if (segLenSq > 1e-4) {
                // Projection parameter t along segment [p1, p2]
                const t = ((px - p1.x) * dx + (pz - p1.z) * dz) / segLenSq;
                if (t >= 1.0) {
                    // Vehicle has advanced past p2, increment index
                    currIdx++;
                    this.waypointIndex = currIdx;
                } else {
                    // Still along segment [p1, p2]
                    this.waypointIndex = currIdx;
                    break;
                }
            } else {
                currIdx++;
                this.waypointIndex = currIdx;
            }
        }

        // Check if reached or exceeded the end of the current lane
        if (this.waypointIndex >= totalWps - 1) {
            if (lane.nextLanes && lane.nextLanes.length > 0) {
                // Deterministically or pseudo-randomly pick a successor lane
                // Using vehicle ID to maintain consistent branching decisions
                const branchIdx = Math.abs(this._hashId(this.vehicle.id)) % lane.nextLanes.length;
                this.laneId = lane.nextLanes[branchIdx];
                this.waypointIndex = 0;
            } else {
                // Dead-end safeguard: loop back or find nearest
                const nearest = roadNetwork.getNearestWaypoint(px, pz);
                this.laneId = nearest.laneId;
                this.waypointIndex = nearest.index;
            }
        }
    }

    /**
     * Traverses along waypoints from current lane progress by lookaheadDist.
     * Computes exact interpolated lookahead target for Pure Pursuit steering.
     * 
     * @param {RoadNetwork} roadNetwork
     * @param {number} lookaheadDist Desired lookahead distance in meters
     * @returns {{ x: number, z: number, yaw: number, laneId: string, index: number }}
     */
    getLookaheadTarget(roadNetwork, lookaheadDist) {
        let lane = roadNetwork.getLane(this.laneId);
        if (!lane || lane.waypoints.length === 0) {
            return roadNetwork.getNearestWaypoint(this.vehicle.position.x, this.vehicle.position.z);
        }

        let currIdx = Math.max(0, Math.min(lane.waypoints.length - 1, this.waypointIndex));
        let accumulated = 0;
        let safetyCounter = 0;

        while (accumulated < lookaheadDist && safetyCounter++ < 40) {
            if (currIdx + 1 < lane.waypoints.length) {
                const p1 = lane.waypoints[currIdx];
                const p2 = lane.waypoints[currIdx + 1];
                const segDist = Math.hypot(p2.x - p1.x, p2.z - p1.z);

                if (accumulated + segDist >= lookaheadDist) {
                    const remain = lookaheadDist - accumulated;
                    const alpha = segDist > 0 ? (remain / segDist) : 0;
                    this.lookaheadTarget.x = p1.x + alpha * (p2.x - p1.x);
                    this.lookaheadTarget.z = p1.z + alpha * (p2.z - p1.z);
                    this.lookaheadTarget.yaw = p2.yaw;
                    this.lookaheadTarget.laneId = lane.id;
                    this.lookaheadTarget.index = currIdx + 1;
                    return this.lookaheadTarget;
                }

                accumulated += segDist;
                currIdx++;
            } else {
                // Seamlessly cross into successor lane
                if (!lane.nextLanes || lane.nextLanes.length === 0) {
                    const lastWp = lane.waypoints[lane.waypoints.length - 1];
                    this.lookaheadTarget.x = lastWp.x;
                    this.lookaheadTarget.z = lastWp.z;
                    this.lookaheadTarget.yaw = lastWp.yaw;
                    this.lookaheadTarget.laneId = lane.id;
                    this.lookaheadTarget.index = currIdx;
                    return this.lookaheadTarget;
                }

                const branchIdx = Math.abs(this._hashId(this.vehicle.id)) % lane.nextLanes.length;
                const nextLane = roadNetwork.getLane(lane.nextLanes[branchIdx]);
                if (!nextLane || nextLane.waypoints.length === 0) {
                    const lastWp = lane.waypoints[lane.waypoints.length - 1];
                    this.lookaheadTarget.x = lastWp.x;
                    this.lookaheadTarget.z = lastWp.z;
                    this.lookaheadTarget.yaw = lastWp.yaw;
                    this.lookaheadTarget.laneId = lane.id;
                    this.lookaheadTarget.index = currIdx;
                    return this.lookaheadTarget;
                }

                lane = nextLane;
                currIdx = 0;
            }
        }

        const wp = lane.waypoints[currIdx];
        this.lookaheadTarget.x = wp.x;
        this.lookaheadTarget.z = wp.z;
        this.lookaheadTarget.yaw = wp.yaw;
        this.lookaheadTarget.laneId = lane.id;
        this.lookaheadTarget.index = currIdx;
        return this.lookaheadTarget;
    }

    /**
     * Senses obstacles and vehicles in the forward lane corridor via SpatialGrid.
     * Determines the closest lead vehicle, its bumper gap s, and relative speed deltaV.
     * 
     * @param {SpatialGrid} spatialGrid Broadphase spatial hash grid
     * @param {RoadNetwork} roadNetwork Road network graph
     * @param {Vehicle} [playerVehicle] Active player vehicle reference
     * @returns {{ minGap: number, leadSpeed: number, leadId: string|null }}
     */
    senseForwardCorridor(spatialGrid, roadNetwork, playerVehicle = null) {
        const v = this.vehicle;
        const egoSpeed = Math.max(0, v.speed);
        const senseRadius = Math.max(
            TRAFFIC_CONFIG.SENSING_RANGE_MIN,
            egoSpeed * TRAFFIC_CONFIG.SENSING_RANGE_KV
        );

        // Heading unit vectors (Three.js yaw=0 faces -Z)
        const sinYaw = Math.sin(v.yaw);
        const cosYaw = Math.cos(v.yaw);
        const fwdX = -sinYaw;
        const fwdZ = -cosYaw;
        const rightX = cosYaw;
        const rightZ = -sinYaw;

        // Query spatial broadphase within forward sense radius
        spatialGrid.queryRadius(v.position.x, v.position.z, senseRadius, _scratchSpatialResults, 'ALL');

        let minGap = Infinity;
        let leadSpeed = 0;
        let leadId = null;

        const corridorHalfWidth = TRAFFIC_CONFIG.CORRIDOR_HALF_WIDTH;
        const egoRadius = v.radius || TRAFFIC_CONFIG.VEHICLE_RADIUS;

        for (let i = 0, len = _scratchSpatialResults.length; i < len; i++) {
            const item = _scratchSpatialResults[i];

            // Ignore self
            if (item.id === v.id || item.entityRef === v) continue;

            let itemX = item.x;
            let itemZ = item.z;
            let itemRadius = item.radius || 1.5;
            let itemSpeed = 0;
            let isVehicle = false;

            if (!item.isStatic && item.entityRef) {
                const other = item.entityRef;
                itemX = other.position ? other.position.x : item.x;
                itemZ = other.position ? other.position.z : item.z;
                itemRadius = other.radius || TRAFFIC_CONFIG.VEHICLE_RADIUS;
                itemSpeed = typeof other.getSpeed === 'function' ? Math.max(0, other.getSpeed()) : 0;
                isVehicle = true;

                // Check relative heading: if traveling in opposite direction (head-on oncoming lane)
                if (typeof other.getYaw === 'function') {
                    const otherYaw = other.getYaw();
                    const dotHeading = (-Math.sin(otherYaw)) * fwdX + (-Math.cos(otherYaw)) * fwdZ;
                    // If traveling in opposite direction (dot < -0.3) and not dangerously in our lane, ignore
                    if (dotHeading < -0.3) {
                        const dxO = itemX - v.position.x;
                        const dzO = itemZ - v.position.z;
                        const latOffsetO = Math.abs(dxO * rightX + dzO * rightZ);
                        if (latOffsetO > 1.4) {
                            continue; // Safely in opposite oncoming lane
                        }
                    }
                }
            } else if (item.isStatic && item.box) {
                // Static obstacle (building, rock, tree, boundary wall)
                itemX = (item.minX + item.maxX) * 0.5;
                itemZ = (item.minZ + item.maxZ) * 0.5;
                itemRadius = Math.hypot(item.maxX - item.minX, item.maxZ - item.minZ) * 0.5;
                itemSpeed = 0;
            }

            // Longitudinal and lateral displacement relative to ego heading
            const dx = itemX - v.position.x;
            const dz = itemZ - v.position.z;

            const dLong = dx * fwdX + dz * fwdZ;
            const dLat = dx * rightX + dz * rightZ;

            // Must be in front (dLong > 0) and within sensing corridor
            if (dLong > 0.5 && dLong < senseRadius && Math.abs(dLat) <= (corridorHalfWidth + itemRadius * 0.5)) {
                // Net bumper-to-bumper distance
                const netGap = Math.max(0.1, dLong - (egoRadius + itemRadius));

                if (netGap < minGap) {
                    minGap = netGap;
                    leadSpeed = itemSpeed;
                    leadId = item.id;
                }
            }
        }

        this.detectedLeadGap = minGap;
        this.detectedLeadSpeed = leadSpeed;

        return { minGap, leadSpeed, leadId };
    }

    /**
     * Checks yellow-box intersection clearance and yields when conflicting traffic is present.
     * Treats an occupied intersection as a virtual stop line obstacle.
     * 
     * @param {RoadNetwork} roadNetwork
     * @param {Map<string, Object>} intersectionLocks
     * @param {number} currentMinGap Current physical obstacle gap
     * @returns {number} Effective gap considering yellow-box stop line
     */
    evaluateIntersectionYielding(roadNetwork, intersectionLocks, currentMinGap) {
        let effectiveGap = currentMinGap;
        const v = this.vehicle;
        const px = v.position.x;
        const pz = v.position.z;

        // Check if approaching any intersection node in the network
        for (const [nodeId, node] of roadNetwork.nodes) {
            if (!node.isIntersection) continue;

            const dx = node.x - px;
            const dz = node.z - pz;
            const dist = Math.hypot(dx, dz);

            const boxRadius = TRAFFIC_CONFIG.INTERSECTION_BOX_RADIUS;
            const approachDist = TRAFFIC_CONFIG.INTERSECTION_APPROACH_DIST;

            // Approaching intersection entrance
            if (dist < boxRadius + approachDist) {
                // Vector dot product: verify moving towards the intersection
                const sinYaw = Math.sin(v.yaw);
                const cosYaw = Math.cos(v.yaw);
                const fwdX = -sinYaw;
                const fwdZ = -cosYaw;
                const dot = dx * fwdX + dz * fwdZ;

                if (dot > 0) {
                    let lock = intersectionLocks.get(nodeId);
                    if (!lock) {
                        lock = { occupantId: null, queue: [] };
                        intersectionLocks.set(nodeId, lock);
                    }

                    if (dist <= boxRadius) {
                        // Inside the intersection box: claim occupant lock
                        if (!lock.occupantId || lock.occupantId === v.id) {
                            lock.occupantId = v.id;
                            this.inIntersection = true;
                            this.reservedIntersectionId = nodeId;
                        }
                    } else {
                        // Outside, approaching entry line
                        if (lock.occupantId && lock.occupantId !== v.id) {
                            // Intersection is occupied by another vehicle: treat stop line as virtual obstacle
                            const stopLineDist = Math.max(0.1, dist - boxRadius - 2.0);
                            if (stopLineDist < effectiveGap) {
                                effectiveGap = stopLineDist;
                                this.detectedLeadSpeed = 0; // Virtual obstacle is stationary
                            }
                        } else if (!lock.occupantId) {
                            // Reserve lock on approach
                            lock.occupantId = v.id;
                            this.reservedIntersectionId = nodeId;
                        }
                    }
                }
            } else if (this.reservedIntersectionId === nodeId && dist > boxRadius + 2.0) {
                // Cleared intersection: release lock
                const lock = intersectionLocks.get(nodeId);
                if (lock && lock.occupantId === v.id) {
                    lock.occupantId = null;
                }
                this.inIntersection = false;
                this.reservedIntersectionId = null;
            }
        }

        return effectiveGap;
    }

    /**
     * Executes one complete simulation and intelligence update for this vehicle.
     * 
     * @param {number} dt Timestep in seconds (e.g. 1/60)
     * @param {SpatialGrid} spatialGrid
     * @param {RoadNetwork} roadNetwork
     * @param {Map<string, Object>} intersectionLocks
     * @param {Vehicle} [playerVehicle]
     */
    update(dt, spatialGrid, roadNetwork, intersectionLocks, playerVehicle = null) {
        // 1. Advance lane tracking and progress along waypoints
        this.updateLaneProgress(roadNetwork);

        // 2. Pure Pursuit lookahead target calculation
        const lookaheadDist = PurePursuitController.getLookaheadDistance(this.vehicle.speed);
        const target = this.getLookaheadTarget(roadNetwork, lookaheadDist);

        // 3. Pure Pursuit steering angle computation
        const steering = PurePursuitController.calculateSteering(
            { x: this.vehicle.position.x, z: this.vehicle.position.z, yaw: this.vehicle.yaw },
            target,
            this.vehicle.speed,
            this.vehicle.maxSteerAngle || 0.55
        );

        // 4. Forward sector sensing & obstacle detection
        const sensing = this.senseForwardCorridor(spatialGrid, roadNetwork, playerVehicle);

        // 5. Yellow-box intersection yielding check
        const effectiveGap = this.evaluateIntersectionYielding(
            roadNetwork,
            intersectionLocks,
            sensing.minGap
        );

        // 6. Intelligent Driver Model (IDM) longitudinal control
        let targetSpeed = this.desiredSpeed;
        const currentLane = roadNetwork.getLane(this.laneId);
        if (currentLane && currentLane.speedLimit) {
            targetSpeed = Math.min(this.desiredSpeed, currentLane.speedLimit);
        }
        if (this.inIntersection || this.reservedIntersectionId) {
            targetSpeed = Math.min(targetSpeed, TRAFFIC_CONFIG.IDM_INTERSECTION_SPEED);
        }

        const deltaV = this.vehicle.speed - sensing.leadSpeed;
        const aCmd = IDMController.computeAcceleration(
            this.vehicle.speed,
            targetSpeed,
            effectiveGap,
            deltaV
        );
        this.commandedAccel = aCmd;

        const inputs = IDMController.mapToInputs(aCmd, this.vehicle.speed, effectiveGap);

        // 7. Anti-deadlock stationary watchdog monitoring
        if (Math.abs(this.vehicle.speed) < 0.2) {
            this.stationaryTimer += dt;

            // At 8s: apply gentle nudge if not intentionally waiting behind lead car or yellow-box
            if (this.stationaryTimer > TRAFFIC_CONFIG.WATCHDOG_NUDGE_TIME && effectiveGap > 8.0) {
                inputs.throttle = 0.5;
                inputs.brake = 0;
            }

            // At 15s: soft respawn to nearest free spawn point
            if (this.stationaryTimer > TRAFFIC_CONFIG.WATCHDOG_RESPAWN_TIME) {
                this.respawn(roadNetwork);
                this.stationaryTimer = 0;
                return;
            }
        } else {
            this.stationaryTimer = 0;
        }

        // 8. Apply inputs to vehicle physics and advance simulation
        this.vehicle.setInputs(inputs.throttle, steering.normalizedSteer, inputs.brake, false);
        this.vehicle.update(dt, spatialGrid);
    }

    /**
     * Softly respawns the vehicle at a clear road waypoint if permanently wedged.
     * @param {RoadNetwork} roadNetwork
     */
    respawn(roadNetwork) {
        const spawns = roadNetwork.getSpawnPoints(1, 15.0);
        if (spawns.length > 0) {
            const sp = spawns[0];
            this.vehicle.position.set(sp.x, 0, sp.z);
            this.vehicle.yaw = sp.yaw;
            this.vehicle.speed = TRAFFIC_CONFIG.INITIAL_SPEED;

            const fwdX = -Math.sin(sp.yaw);
            const fwdZ = -Math.cos(sp.yaw);
            this.vehicle.velocity.set(fwdX * this.vehicle.speed, fwdZ * this.vehicle.speed);

            this.laneId = sp.laneId;
            this.waypointIndex = sp.index;
            this.stationaryTimer = 0;
            this.inIntersection = false;
            this.reservedIntersectionId = null;
        }
    }

    /**
     * Deterministic string hash helper.
     * @param {string|number} str
     * @returns {number}
     */
    _hashId(str) {
        let hash = 0;
        const s = String(str);
        for (let i = 0; i < s.length; i++) {
            hash = (hash << 5) - hash + s.charCodeAt(i);
            hash |= 0;
        }
        return hash;
    }
}

// ============================================================================
// TRAFFIC MANAGER
// ============================================================================

export class TrafficManager {
    /**
     * @param {RoadNetwork} roadNetwork Directed road network graph instance
     * @param {SpatialGrid} spatialGrid Spatial hash grid broadphase instance
     * @param {Object} [options={}] Configuration overrides
     */
    constructor(roadNetwork, spatialGrid, options = {}) {
        this.roadNetwork = roadNetwork;
        this.spatialGrid = spatialGrid;
        this.config = Object.assign({}, TRAFFIC_CONFIG, options);

        this.agents = [];                       // Array of TrafficAgent instances
        this.vehicles = [];                     // Flat array of Vehicle instances
        this.intersectionLocks = new Map();     // nodeId -> { occupantId, queue }
        this.scene = null;

        // Telemetry metrics object (reused across ticks without GC allocation)
        this.metrics = {
            count: 0,
            avgSpeed: 0,
            stoppedCount: 0,
            totalDisplacement: 0
        };
    }

    /**
     * Initializes and spawns the autonomous AI traffic fleet across the road network.
     * 
     * @param {number} [count=50] Desired fleet size (default 50)
     * @param {THREE.Scene} [scene=null] Three.js scene instance
     * @returns {Array<Vehicle>} List of spawned active vehicles
     */
    initFleet(count = TRAFFIC_CONFIG.DEFAULT_FLEET_SIZE, scene = null) {
        if (scene) this.scene = scene;

        // Clear any pre-existing vehicles
        this.destroy();

        const desiredCount = Math.max(
            TRAFFIC_CONFIG.MIN_FLEET_SIZE,
            Math.min(TRAFFIC_CONFIG.MAX_FLEET_SIZE, count)
        );

        // Retrieve collision-spaced spawn points distributed throughout the network
        const spawnPoints = this.roadNetwork.getSpawnPoints(
            desiredCount,
            TRAFFIC_CONFIG.SPAWN_MIN_SPACING
        );

        for (let i = 0; i < spawnPoints.length; i++) {
            const sp = spawnPoints[i];
            const color = TRAFFIC_PALETTE[i % TRAFFIC_PALETTE.length];

            // Instantiate Vehicle with initial pose
            const vehicle = new Vehicle(
                `traffic_${i}`,
                sp.x,
                sp.z,
                sp.yaw,
                color,
                false // AI-controlled
            );

            // Initialize speed and velocity aligned to lane direction
            vehicle.speed = TRAFFIC_CONFIG.INITIAL_SPEED;
            const fwdX = -Math.sin(sp.yaw);
            const fwdZ = -Math.cos(sp.yaw);
            vehicle.velocity.set(fwdX * vehicle.speed, fwdZ * vehicle.speed);

            // Add mesh to scene if available
            if (this.scene) {
                vehicle.initMesh(this.scene);
            }

            // Register into spatial hash grid
            this.spatialGrid.insertDynamic(vehicle.id, sp.x, sp.z, vehicle.radius, vehicle);

            // Varied driver cruising speed between 12.0 and 16.0 m/s
            const speedRange = TRAFFIC_CONFIG.IDM_DESIRED_SPEED_MAX - TRAFFIC_CONFIG.IDM_DESIRED_SPEED_MIN;
            const speedVariance = ((i * 7) % 10) / 10.0;
            const desiredSpeed = TRAFFIC_CONFIG.IDM_DESIRED_SPEED_MIN + speedVariance * speedRange;

            const agent = new TrafficAgent(vehicle, sp.laneId, sp.index, desiredSpeed);

            this.agents.push(agent);
            this.vehicles.push(vehicle);
        }

        this.metrics.count = this.vehicles.length;
        return this.vehicles;
    }

    /**
     * Executes one complete fixed-timestep update across the entire traffic fleet.
     * Guaranteed zero garbage collection allocations during active simulation.
     * 
     * @param {number} dt Constant timestep in seconds (e.g. 1/60)
     * @param {Vehicle} [playerVehicle=null] Active player vehicle reference
     */
    update(dt, playerVehicle = null) {
        if (!dt || dt <= 0 || this.agents.length === 0) return;

        let totalSpeed = 0;
        let stoppedCount = 0;

        // 1. Update individual vehicle AI agents (Pure Pursuit, IDM, Yellow-Box, Physics)
        for (let i = 0, len = this.agents.length; i < len; i++) {
            const agent = this.agents[i];
            agent.update(dt, this.spatialGrid, this.roadNetwork, this.intersectionLocks, playerVehicle);

            const spd = Math.abs(agent.vehicle.speed);
            totalSpeed += spd;
            if (spd < 0.3) stoppedCount++;
        }

        // 2. Apply elastic separation impulses to guarantee zero vehicle overlap
        this.applyElasticSeparation(dt);

        // 3. Update spatial broadphase with active vehicle positions
        for (let i = 0, len = this.vehicles.length; i < len; i++) {
            const v = this.vehicles[i];
            this.spatialGrid.insertDynamic(v.id, v.position.x, v.position.z, v.radius, v);
        }

        // 4. Update telemetry metrics in-place
        this.metrics.count = this.vehicles.length;
        this.metrics.avgSpeed = this.metrics.count > 0 ? (totalSpeed / this.metrics.count) : 0;
        this.metrics.stoppedCount = stoppedCount;
    }

    /**
     * Pairwise elastic repulsion impulse pass.
     * Enforces minimum collision spacing, ensuring bounding geometries never overlap (< 2.0m).
     * 
     * @param {number} dt Timestep
     */
    applyElasticSeparation(dt) {
        const threshold = TRAFFIC_CONFIG.ELASTIC_SEPARATION_DIST; // 4.2m center-to-center
        const thresholdSq = threshold * threshold;

        for (let i = 0, len = this.vehicles.length; i < len; i++) {
            const vA = this.vehicles[i];
            this.spatialGrid.queryRadius(vA.position.x, vA.position.z, threshold, _scratchNeighborResults, 'DYNAMIC');

            for (let j = 0, nLen = _scratchNeighborResults.length; j < nLen; j++) {
                const item = _scratchNeighborResults[j];
                if (item.id === vA.id || !item.entityRef) continue;

                const vB = item.entityRef;
                const dx = vA.position.x - vB.position.x;
                const dz = vA.position.z - vB.position.z;
                const distSq = dx * dx + dz * dz;

                if (distSq > 1e-4 && distSq < thresholdSq) {
                    const dist = Math.sqrt(distSq);
                    const overlap = threshold - dist;
                    const normX = dx / dist;
                    const normZ = dz / dist;

                    const push = overlap * 0.5 * TRAFFIC_CONFIG.ELASTIC_SEPARATION_STRENGTH * dt;

                    vA.position.x += normX * push;
                    vA.position.z += normZ * push;
                    vB.position.x -= normX * push;
                    vB.position.z -= normZ * push;
                }
            }
        }
    }

    /**
     * Dynamically adjusts the fleet size (e.g. from 10 to 60+).
     * 
     * @param {number} targetCount Desired number of active vehicles
     * @param {THREE.Scene} [scene]
     */
    setFleetSize(targetCount, scene = null) {
        if (scene) this.scene = scene;
        const currentCount = this.vehicles.length;

        if (targetCount === currentCount) return;

        if (targetCount < currentCount) {
            // Trim excess vehicles
            const toRemove = currentCount - targetCount;
            for (let i = 0; i < toRemove; i++) {
                const agent = this.agents.pop();
                const vehicle = this.vehicles.pop();
                if (vehicle) {
                    vehicle.destroy();
                }
            }
        } else {
            // Spawn additional vehicles
            const additionalCount = targetCount - currentCount;
            const spawns = this.roadNetwork.getSpawnPoints(targetCount + 10, TRAFFIC_CONFIG.SPAWN_MIN_SPACING);

            let spawned = 0;
            for (let i = 0; i < spawns.length && spawned < additionalCount; i++) {
                const sp = spawns[i];

                // Verify this spawn location is not occupied by an existing vehicle
                let occupied = false;
                for (let k = 0; k < this.vehicles.length; k++) {
                    const v = this.vehicles[k];
                    if (Math.hypot(v.position.x - sp.x, v.position.z - sp.z) < 8.0) {
                        occupied = true;
                        break;
                    }
                }
                if (occupied) continue;

                const color = TRAFFIC_PALETTE[(currentCount + spawned) % TRAFFIC_PALETTE.length];
                const vehicle = new Vehicle(
                    `traffic_${currentCount + spawned}`,
                    sp.x,
                    sp.z,
                    sp.yaw,
                    color,
                    false
                );
                vehicle.speed = TRAFFIC_CONFIG.INITIAL_SPEED;

                const fwdX = -Math.sin(sp.yaw);
                const fwdZ = -Math.cos(sp.yaw);
                vehicle.velocity.set(fwdX * vehicle.speed, fwdZ * vehicle.speed);

                if (this.scene) {
                    vehicle.initMesh(this.scene);
                }

                this.spatialGrid.insertDynamic(vehicle.id, sp.x, sp.z, vehicle.radius, vehicle);
                const agent = new TrafficAgent(vehicle, sp.laneId, sp.index, TRAFFIC_CONFIG.IDM_DESIRED_SPEED);

                this.agents.push(agent);
                this.vehicles.push(vehicle);
                spawned++;
            }
        }

        this.metrics.count = this.vehicles.length;
    }

    /**
     * Completely resets and respawns the traffic fleet.
     * 
     * @param {number} [count=50]
     * @param {THREE.Scene} [scene]
     */
    resetFleet(count = TRAFFIC_CONFIG.DEFAULT_FLEET_SIZE, scene = null) {
        return this.initFleet(count, scene || this.scene);
    }

    /**
     * Returns the array of active traffic vehicles conforming to PROJECT.md interface contract.
     * @returns {Array<Vehicle>}
     */
    getActiveVehicles() {
        return this.vehicles;
    }

    /**
     * Returns fleet performance metrics conforming to PROJECT.md interface contract.
     * @returns {{ count: number, avgSpeed: number, stoppedCount: number }}
     */
    getMetrics() {
        return this.metrics;
    }

    /**
     * Disposes all traffic vehicles, meshes, and resets state.
     */
    destroy() {
        for (let i = 0; i < this.vehicles.length; i++) {
            this.vehicles[i].destroy();
        }
        this.agents.length = 0;
        this.vehicles.length = 0;
        this.intersectionLocks.clear();
        this.metrics.count = 0;
        this.metrics.avgSpeed = 0;
        this.metrics.stoppedCount = 0;
    }
}
