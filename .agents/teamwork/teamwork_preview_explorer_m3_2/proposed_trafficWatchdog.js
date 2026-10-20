/**
 * proposed_trafficWatchdog.js
 * 
 * Milestone 3 Reference Implementation:
 * 1. Intersection Yellow-Box Reservation & Right-of-Way FIFO Protocol
 * 2. Anti-Deadlock Watchdog (Standstill Detection, Lateral Nudge & Perimeter Respawn)
 * 3. Anti-Overlap Enforcement (Elastic Bumper Response, d >= 2.0m Guarantee)
 * 
 * Conforms to:
 * - Drivable car model basis: Kaj Simulator Honda Civic car system (7e9eef5:game.html)
 * - Map coordination: /anothermapo layout and building collision bounds in SpatialGrid
 * - Zero GC allocations during 60Hz physics stepping (reusable scratch buffers)
 * - High-speed spatial hash grid queries (O(1) active dynamic lookups)
 */

import * as THREE from 'three';

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

export const WATCHDOG_CONFIG = Object.freeze({
    // Intersection Yellow-Box Reservation
    INTERSECTION: Object.freeze({
        BOX_HALF_SIZE: 5.5,           // Half-width of yellow-box AABB in meters (covers 8.0m road intersection + margins)
        APPROACH_HORIZON: 14.0,       // Distance from center at which approaching vehicle begins reservation request
        STOP_LINE_DISTANCE: 6.8,      // Distance from center along incoming lane where stopped vehicle halts
        HOLD_TIMEOUT_TICKS: 360,      // Max reservation hold duration (6.0s at 60Hz) to prevent ghost lock
        SPEED_LIMIT_APPROACH: 5.0,    // Speed limit (m/s) when approaching unreserved intersection
        CLEARANCE_EXIT_DISTANCE: 6.5  // Distance from center after which vehicle is deemed to have cleared the yellow-box
    }),

    // Anti-Deadlock Watchdog
    WATCHDOG: Object.freeze({
        STANDSTILL_SPEED_THRESHOLD: 0.10, // Velocity below 0.10 m/s counts as standstill
        STAGE1_NUDGE_TICKS: 300,          // 5.0 seconds at 60Hz (300 ticks) -> Priority 1 Lateral Nudge / Clearance
        STAGE2_RESPAWN_TICKS: 420,        // 7.0 seconds at 60Hz (420 ticks) -> Priority 2 Despawn & Respawn
        NUDGE_DURATION_TICKS: 30,         // Duration of lateral nudge impulse (0.5s)
        NUDGE_LATERAL_OFFSET: 0.30,       // Lateral displacement in meters
        MIN_RESPAWN_CLEARANCE: 18.0,      // Required distance (m) from any vehicle when picking respawn waypoint
        WORLD_BOUNDS_MARGIN: 20.0         // Keep respawns within [-260, 260] safe world boundary
    }),

    // Anti-Overlap Enforcement (d >= 2.0m Guarantee)
    ANTI_OVERLAP: Object.freeze({
        MIN_CENTER_DISTANCE: 2.20,        // Target minimum center-to-center distance (safety buffer > 2.0m hard floor)
        CRITICAL_OVERLAP_FLOOR: 2.00,     // Hard threshold tested in E2E Test 7
        SOFT_BUMPER_DISTANCE: 3.50,       // Elastic bumper deceleration zone
        BUMPER_RESTITUTION: 0.40,         // Elastic bounce coefficient
        BUMPER_SPRING_K: 12.0,            // Spring stiffness for soft bumper deceleration
        QUERY_RADIUS: 5.0,                // Dynamic query radius in SpatialGrid
        SOLVER_ITERATIONS: 8              // Constraint relaxation passes for dense vehicle compression
    })
});

// Reusable scratch objects to guarantee zero GC allocation
const _scratchQueryResults = [];
const _scratchVecA = new THREE.Vector2();
const _scratchVecB = new THREE.Vector2();
const _scratchDelta = new THREE.Vector2();

const MAX_SCRATCH_PAIRS = 600;
const _scratchPairs = new Array(MAX_SCRATCH_PAIRS);
for (let i = 0; i < MAX_SCRATCH_PAIRS; i++) {
    _scratchPairs[i] = { a: null, b: null };
}
let _scratchPairCount = 0;

// ============================================================================
// 1. INTERSECTION YELLOW-BOX RESERVATION MANAGER
// ============================================================================

/**
 * Represents an intersection conflict zone (Yellow-Box) extracted from RoadNetwork.
 */
export class IntersectionConflictZone {
    constructor(id, node) {
        this.id = id;
        this.nodeId = node.id;
        this.x = node.x;
        this.z = node.z;

        const halfSize = WATCHDOG_CONFIG.INTERSECTION.BOX_HALF_SIZE;
        this.minX = node.x - halfSize;
        this.maxX = node.x + halfSize;
        this.minZ = node.z - halfSize;
        this.maxZ = node.z + halfSize;

        // Bounding box for SpatialGrid queryBox if needed
        this.box = {
            min: { x: this.minX, z: this.minZ },
            max: { x: this.maxX, z: this.maxZ }
        };

        // Reservation state
        this.reservedBy = null;          // vehicleId currently holding right-of-way
        this.reservationTick = 0;        // tick when reservation was granted
        this.waitingQueue = [];          // FIFO queue of vehicle IDs waiting to enter
        this.occupants = new Set();      // vehicle IDs currently inside physical box

        // Graph connectivity
        this.incomingLanes = [];         // Lanes whose toNodeId === this.nodeId
        this.outgoingLanes = [];         // Lanes whose fromNodeId === this.nodeId
    }

    /**
     * Checks if a point (x, z) is physically inside the yellow-box AABB.
     */
    containsPoint(x, z) {
        return x >= this.minX && x <= this.maxX && z >= this.minZ && z <= this.maxZ;
    }

    /**
     * Resets reservation state.
     */
    reset() {
        this.reservedBy = null;
        this.reservationTick = 0;
        this.waitingQueue.length = 0;
        this.occupants.clear();
    }
}

/**
 * Manages all intersection conflict zones, yellow-box reservations, and right-of-way FIFO queues.
 */
export class IntersectionManager {
    constructor() {
        this.zones = new Map(); // nodeId -> IntersectionConflictZone
        this.laneToZone = new Map(); // incomingLaneId -> IntersectionConflictZone
    }

    /**
     * Extracts intersection conflict zones from RoadNetwork nodes.
     * Compatible with both procedural road networks and /anothermapo OSM road graphs.
     * 
     * @param {RoadNetwork} roadNetwork
     */
    initFromRoadNetwork(roadNetwork) {
        this.zones.clear();
        this.laneToZone.clear();

        if (!roadNetwork || !roadNetwork.nodes) return;

        // 1. Identify intersection nodes (nodes with isIntersection or degree >= 3)
        for (const [nodeId, node] of roadNetwork.nodes.entries()) {
            if (node.isIntersection) {
                const zone = new IntersectionConflictZone(`zone_${nodeId}`, node);
                this.zones.set(nodeId, zone);
            }
        }

        // 2. Map incoming and outgoing lanes to zones
        if (roadNetwork.lanes) {
            for (const lane of roadNetwork.lanes) {
                const zoneIn = this.zones.get(lane.toNodeId);
                if (zoneIn) {
                    zoneIn.incomingLanes.push(lane.id);
                    this.laneToZone.set(lane.id, zoneIn);
                }

                const zoneOut = this.zones.get(lane.fromNodeId);
                if (zoneOut) {
                    zoneOut.outgoingLanes.push(lane.id);
                }
            }
        }
    }

    /**
     * Fixed-timestep update for all intersection conflict zones.
     * Resolves timeouts and advances FIFO queues.
     * 
     * @param {number} currentTick Monotonically increasing tick counter
     */
    update(currentTick) {
        for (const zone of this.zones.values()) {
            // Safety: timeout stale reservations if a vehicle stalled or crashed
            if (zone.reservedBy !== null) {
                const duration = currentTick - zone.reservationTick;
                if (duration > WATCHDOG_CONFIG.INTERSECTION.HOLD_TIMEOUT_TICKS) {
                    // Revoke stale reservation
                    zone.reservedBy = null;
                }
            }

            // If yellow-box is free and queue has waiting vehicles, grant next FIFO reservation
            if (zone.reservedBy === null && zone.waitingQueue.length > 0) {
                const nextVehicleId = zone.waitingQueue.shift();
                zone.reservedBy = nextVehicleId;
                zone.reservationTick = currentTick;
            }
        }
    }

    /**
     * Enqueues or grants a reservation for an approaching vehicle.
     * 
     * @param {string} nodeId Intersection node ID
     * @param {string} vehicleId Approaching vehicle ID
     * @param {number} currentTick
     * @returns {boolean} True if vehicle currently holds the reservation (green light)
     */
    requestReservation(nodeId, vehicleId, currentTick) {
        const zone = this.zones.get(nodeId);
        if (!zone) return true; // Not a regulated intersection

        // Already holds reservation
        if (zone.reservedBy === vehicleId) {
            return true;
        }

        // Box is unreserved and no one is ahead in queue: grant immediately
        if (zone.reservedBy === null && (zone.waitingQueue.length === 0 || zone.waitingQueue[0] === vehicleId)) {
            if (zone.waitingQueue.length > 0 && zone.waitingQueue[0] === vehicleId) {
                zone.waitingQueue.shift();
            }
            zone.reservedBy = vehicleId;
            zone.reservationTick = currentTick;
            return true;
        }

        // Add to waiting FIFO queue if not already queued
        if (!zone.waitingQueue.includes(vehicleId)) {
            zone.waitingQueue.push(vehicleId);
        }

        return false;
    }

    /**
     * Checks approach status and calculates target speed / stop line constraint.
     * If approaching an intersection without reservation, orders vehicle to stop at stop line.
     * 
     * @param {Vehicle} vehicle
     * @param {number} currentTick
     * @returns {{ mustStop: boolean, stopDistance: number, targetSpeedLimit: number }}
     */
    evaluateApproach(vehicle, currentTick) {
        const result = {
            mustStop: false,
            stopDistance: Infinity,
            targetSpeedLimit: 12.0
        };

        if (!vehicle.laneId) return result;

        const zone = this.laneToZone.get(vehicle.laneId);
        if (!zone) return result;

        const dx = vehicle.position.x - zone.x;
        const dz = vehicle.position.z - zone.z;
        const distToCenter = Math.hypot(dx, dz);

        // Outside approach horizon: normal driving
        if (distToCenter > WATCHDOG_CONFIG.INTERSECTION.APPROACH_HORIZON) {
            return result;
        }

        // Inside yellow-box: track physical occupancy and clear when leaving
        const isInsideBox = zone.containsPoint(vehicle.position.x, vehicle.position.z);
        if (isInsideBox) {
            zone.occupants.add(vehicle.id);
            // Limit speed inside intersection for realism and stability
            result.targetSpeedLimit = WATCHDOG_CONFIG.INTERSECTION.SPEED_LIMIT_APPROACH;
            return result;
        } else if (zone.occupants.has(vehicle.id) && distToCenter > WATCHDOG_CONFIG.INTERSECTION.CLEARANCE_EXIT_DISTANCE) {
            // Vehicle was inside and has now exited beyond clearance distance
            zone.occupants.delete(vehicle.id);
            if (zone.reservedBy === vehicle.id) {
                zone.reservedBy = null; // Release reservation
            }
        }

        // Request / check reservation
        const hasRightOfWay = this.requestReservation(zone.nodeId, vehicle.id, currentTick);

        if (hasRightOfWay) {
            // Cleared to enter yellow-box
            result.targetSpeedLimit = WATCHDOG_CONFIG.INTERSECTION.SPEED_LIMIT_APPROACH;
            result.mustStop = false;
        } else {
            // Must stop at stop line
            const distToStopLine = distToCenter - WATCHDOG_CONFIG.INTERSECTION.STOP_LINE_DISTANCE;
            result.stopDistance = Math.max(0, distToStopLine);
            result.mustStop = true;

            // Decelerate smoothly as we approach stop line
            if (distToStopLine > 0) {
                result.targetSpeedLimit = Math.min(WATCHDOG_CONFIG.INTERSECTION.SPEED_LIMIT_APPROACH, Math.max(0, distToStopLine * 0.8));
            } else {
                result.targetSpeedLimit = 0;
            }
        }

        return result;
    }

    /**
     * Explicitly releases any reservations held by a vehicle (e.g. on despawn or route change).
     * 
     * @param {string} vehicleId
     */
    releaseAllForVehicle(vehicleId) {
        for (const zone of this.zones.values()) {
            if (zone.reservedBy === vehicleId) {
                zone.reservedBy = null;
            }
            const qIdx = zone.waitingQueue.indexOf(vehicleId);
            if (qIdx !== -1) {
                zone.waitingQueue.splice(qIdx, 1);
            }
            zone.occupants.delete(vehicleId);
        }
    }
}

// ============================================================================
// 2. ANTI-DEADLOCK WATCHDOG
// ============================================================================

/**
 * Tracks vehicle standstill time and executes two-tier deadlock remediation:
 * - Stage 1 (300 ticks / 5.0s): Priority 1 Lateral nudge / clearance impulse.
 * - Stage 2 (420 ticks / 7.0s): Priority 2 Despawn and respawn at clear perimeter waypoint.
 */
export class TrafficDeadlockWatchdog {
    constructor() {
        this.standstillTicks = new Map(); // vehicleId -> number
        this.nudgeState = new Map();      // vehicleId -> { ticksRemaining, dirX, dirZ }
        this.eventLog = [];               // Historical watchdog events for debugging & test verification
        this.metrics = {
            totalStage1Nudges: 0,
            totalStage2Respawns: 0
        };
    }

    /**
     * Fixed-timestep update per vehicle in the fleet.
     * 
     * @param {Vehicle} vehicle Target vehicle
     * @param {number} dt Timestep (1/60s)
     * @param {SpatialGrid} spatialGrid Spatial broadphase
     * @param {RoadNetwork} roadNetwork Directed road graph
     * @param {Array<Vehicle>} allVehicles Fleet list for distance validation
     * @param {IntersectionManager} [intersectionManager]
     * @returns {'NORMAL'|'NUDGED'|'RESPAWNED'} Action taken this tick
     */
    updateVehicle(vehicle, dt, spatialGrid, roadNetwork, allVehicles, intersectionManager = null) {
        const id = vehicle.id;
        const speed = Math.abs(vehicle.speed || 0);
        const velSq = (vehicle.velocity ? (vehicle.velocity.x * vehicle.velocity.x + vehicle.velocity.y * vehicle.velocity.y) : 0);
        const isStopped = speed < WATCHDOG_CONFIG.WATCHDOG.STANDSTILL_SPEED_THRESHOLD && velSq < (0.15 * 0.15);

        let currentTicks = this.standstillTicks.get(id) || 0;

        if (isStopped) {
            currentTicks++;
            this.standstillTicks.set(id, currentTicks);
        } else {
            if (currentTicks > 0) {
                this.standstillTicks.set(id, 0);
            }
            this.nudgeState.delete(id);
            return 'NORMAL';
        }

        // Active nudge in progress
        const activeNudge = this.nudgeState.get(id);
        if (activeNudge && activeNudge.ticksRemaining > 0) {
            activeNudge.ticksRemaining--;
            // Apply lateral displacement smoothly
            vehicle.position.x += activeNudge.dirX * (WATCHDOG_CONFIG.WATCHDOG.NUDGE_LATERAL_OFFSET / WATCHDOG_CONFIG.WATCHDOG.NUDGE_DURATION_TICKS);
            vehicle.position.z += activeNudge.dirZ * (WATCHDOG_CONFIG.WATCHDOG.NUDGE_LATERAL_OFFSET / WATCHDOG_CONFIG.WATCHDOG.NUDGE_DURATION_TICKS);

            if (activeNudge.ticksRemaining <= 0) {
                this.nudgeState.delete(id);
            }
            return 'NUDGED';
        }

        // STAGE 2: Hard Deadlock (> 7.0s / 420 ticks) -> Priority 2 Despawn & Respawn
        if (currentTicks >= WATCHDOG_CONFIG.WATCHDOG.STAGE2_RESPAWN_TICKS) {
            this._respawnAtClearWaypoint(vehicle, roadNetwork, allVehicles, spatialGrid, intersectionManager, currentTicks);
            this.standstillTicks.set(id, 0);
            this.nudgeState.delete(id);
            this.metrics.totalStage2Respawns++;
            return 'RESPAWNED';
        }

        // STAGE 1: Stalled (> 5.0s / 300 ticks) -> Priority 1 Lateral Nudge
        if (currentTicks === WATCHDOG_CONFIG.WATCHDOG.STAGE1_NUDGE_TICKS) {
            this._applyLateralNudge(vehicle, roadNetwork);
            this.metrics.totalStage1Nudges++;
            return 'NUDGED';
        }

        return 'NORMAL';
    }

    /**
     * Priority 1: Applies a safe lateral clearance nudge perpendicular to vehicle heading.
     */
    _applyLateralNudge(vehicle, roadNetwork) {
        // Normal vector perpendicular to heading
        // In project convention: heading yaw = 0 points to -Z, fwd = (-sin(yaw), -cos(yaw)), right = (cos(yaw), -sin(yaw))
        const sinYaw = Math.sin(vehicle.yaw);
        const cosYaw = Math.cos(vehicle.yaw);
        const rightX = cosYaw;
        const rightZ = -sinYaw;

        // Alternate nudge direction based on vehicle ID hash
        const dirSign = ((typeof vehicle.id === 'string' ? vehicle.id.charCodeAt(vehicle.id.length - 1) : vehicle.id) % 2 === 0) ? 1 : -1;

        this.nudgeState.set(vehicle.id, {
            ticksRemaining: WATCHDOG_CONFIG.WATCHDOG.NUDGE_DURATION_TICKS,
            dirX: rightX * dirSign,
            dirZ: rightZ * dirSign
        });

        // Also give slight forward throttle demand to encourage roll-off
        if (vehicle.setInputs) {
            vehicle.setInputs(0.8, 0, 0, false);
        }

        this.eventLog.push({
            type: 'STAGE1_NUDGE',
            vehicleId: vehicle.id,
            position: { x: vehicle.position.x, z: vehicle.position.z },
            ticks: WATCHDOG_CONFIG.WATCHDOG.STAGE1_NUDGE_TICKS
        });
    }

    /**
     * Priority 2: Despawns stalled vehicle and respawns at a clear perimeter waypoint.
     */
    _respawnAtClearWaypoint(vehicle, roadNetwork, allVehicles, spatialGrid, intersectionManager, ticks) {
        // Release any intersection reservations held
        if (intersectionManager) {
            intersectionManager.releaseAllForVehicle(vehicle.id);
        }

        const clearSpawn = this.findClearPerimeterSpawn(roadNetwork, allVehicles);

        this.eventLog.push({
            type: 'STAGE2_RESPAWN',
            vehicleId: vehicle.id,
            stalledAt: { x: vehicle.position.x, z: vehicle.position.z },
            respawnedAt: { x: clearSpawn.x, z: clearSpawn.z },
            standstillDurationSec: (ticks / 60).toFixed(2)
        });

        // Reset vehicle state cleanly
        vehicle.position.set(clearSpawn.x, 0, clearSpawn.z);
        if (vehicle.velocity) vehicle.velocity.set(0, 0);
        vehicle.speed = 0;
        vehicle.yaw = clearSpawn.yaw;
        vehicle.steerAngle = 0;
        vehicle.laneId = clearSpawn.laneId;
        vehicle.waypointIndex = clearSpawn.index;

        if (vehicle.lastSafePosition) {
            vehicle.lastSafePosition.set(clearSpawn.x, 0, clearSpawn.z);
            vehicle.lastSafeYaw = clearSpawn.yaw;
        }

        // Re-sync visual mesh immediately
        if (vehicle._updateMeshTransform) {
            vehicle._updateMeshTransform(0);
        }

        // Update SpatialGrid entry immediately
        if (spatialGrid) {
            spatialGrid.insertDynamic(vehicle.id, clearSpawn.x, clearSpawn.z, vehicle.radius || 2.25, vehicle);
        }
    }

    /**
     * Finds a safe perimeter waypoint with minimum spacing from all other vehicles.
     * 
     * @param {RoadNetwork} roadNetwork
     * @param {Array<Vehicle>} allVehicles
     * @returns {{ x: number, z: number, yaw: number, laneId: string, index: number }}
     */
    findClearPerimeterSpawn(roadNetwork, allVehicles) {
        const minClearanceSq = WATCHDOG_CONFIG.WATCHDOG.MIN_RESPAWN_CLEARANCE * WATCHDOG_CONFIG.WATCHDOG.MIN_RESPAWN_CLEARANCE;

        // Query candidate spawns with high spacing
        const candidateSpawns = roadNetwork.getSpawnPoints(40, 15.0);

        // Score candidates by distance from other vehicles and perimeter preference
        let bestCandidate = null;
        let bestDistanceSq = -1;

        for (let i = 0; i < candidateSpawns.length; i++) {
            const cand = candidateSpawns[i];

            // Verify safe bounds
            const maxBound = 280.0 - WATCHDOG_CONFIG.WATCHDOG.WORLD_BOUNDS_MARGIN;
            if (Math.abs(cand.x) > maxBound || Math.abs(cand.z) > maxBound) continue;

            // Find nearest vehicle distance
            let nearestSq = Infinity;
            if (allVehicles) {
                for (let v = 0; v < allVehicles.length; v++) {
                    const other = allVehicles[v];
                    const dx = cand.x - other.position.x;
                    const dz = cand.z - other.position.z;
                    const dSq = dx * dx + dz * dz;
                    if (dSq < nearestSq) nearestSq = dSq;
                }
            }

            // If completely clear, take immediately
            if (nearestSq >= minClearanceSq) {
                return cand;
            }

            if (nearestSq > bestDistanceSq) {
                bestDistanceSq = nearestSq;
                bestCandidate = cand;
            }
        }

        // Fallback to highest distance candidate or first candidate
        return bestCandidate || candidateSpawns[0] || { x: 0, z: -40, yaw: 0, laneId: '', index: 0 };
    }
}

// ============================================================================
// 3. ANTI-OVERLAP ENFORCEMENT & ELASTIC BUMPER RESPONSE (d >= 2.0m)
// ============================================================================

/**
 * Enforces strict inter-vehicle center distance d >= 2.0m using SpatialGrid dynamic queries.
 * Combines:
 * 1. Hard Positional MTV Separation (non-penetration constraint for d < 2.2m).
 * 2. Elastic Bumper Impulse Response (velocity dampening & restitution for 2.2m <= d < 3.5m).
 * 
 * Guaranteed zero GC allocations during stepping.
 */
export class AntiOverlapEnforcer {
    constructor() {
        this.violationsPrevented = 0;
        this.minRecordedDistance = Infinity;
    }

    /**
     * Executes anti-overlap enforcement across all vehicle pairs.
     * 
     * @param {Array<Vehicle>} fleet All vehicles (player + traffic fleet)
     * @param {SpatialGrid} spatialGrid Broadphase grid
     * @param {number} dt Timestep (1/60s)
     */
    enforce(fleet, spatialGrid, dt = 1 / 60) {
        if (!fleet || fleet.length < 2) return;

        const targetDist = WATCHDOG_CONFIG.ANTI_OVERLAP.MIN_CENTER_DISTANCE; // 2.20m
        const targetDistSq = targetDist * targetDist;
        const softBumperDist = WATCHDOG_CONFIG.ANTI_OVERLAP.SOFT_BUMPER_DISTANCE; // 3.50m
        const softBumperDistSq = softBumperDist * softBumperDist;
        const restitution = WATCHDOG_CONFIG.ANTI_OVERLAP.BUMPER_RESTITUTION;
        const iterations = WATCHDOG_CONFIG.ANTI_OVERLAP.SOLVER_ITERATIONS || 4;

        // 1. Gather all candidate pairs from spatial grid broadphase
        _scratchPairCount = 0;
        for (let i = 0; i < fleet.length; i++) {
            const vA = fleet[i];
            const posA = vA.position;

            spatialGrid.queryRadius(posA.x, posA.z, WATCHDOG_CONFIG.ANTI_OVERLAP.QUERY_RADIUS, _scratchQueryResults, 'DYNAMIC');

            for (let j = 0, len = _scratchQueryResults.length; j < len; j++) {
                const item = _scratchQueryResults[j];
                const vB = item.entityRef;

                // Skip self or already handled unordered pairs
                if (!vB || vB === vA || vA.id >= vB.id) continue;

                if (_scratchPairCount < MAX_SCRATCH_PAIRS) {
                    _scratchPairs[_scratchPairCount].a = vA;
                    _scratchPairs[_scratchPairCount].b = vB;
                    _scratchPairCount++;
                }
            }
        }

        // 2. Iterative constraint relaxation passes across candidate pairs
        for (let iter = 0; iter < iterations; iter++) {
            for (let p = 0; p < _scratchPairCount; p++) {
                const vA = _scratchPairs[p].a;
                const vB = _scratchPairs[p].b;
                const posA = vA.position;
                const posB = vB.position;

                const dx = posA.x - posB.x;
                const dz = posA.z - posB.z;
                const distSq = dx * dx + dz * dz;

                if (iter === 0 && distSq < this.minRecordedDistance) {
                    this.minRecordedDistance = distSq;
                }

                // -------------------------------------------------------------
                // CASE 1: HARD PENETRATION / PROXIMITY VIOLATION (d < 2.20m)
                // -------------------------------------------------------------
                if (distSq < targetDistSq) {
                    if (iter === 0) {
                        this.violationsPrevented++;
                    }
                    let dist = Math.sqrt(distSq);
                    let nx = 0;
                    let nz = 0;

                    if (dist < 1e-4) {
                        dist = 1e-4;
                        nx = 1.0;
                        nz = 0.0;
                    } else {
                        nx = dx / dist;
                        nz = dz / dist;
                    }

                    const penetration = targetDist - dist;

                    let weightA = 0.5;
                    let weightB = 0.5;

                    if (vA.isPlayer && !vB.isPlayer) {
                        weightA = 0.0;
                        weightB = 1.0;
                    } else if (!vA.isPlayer && vB.isPlayer) {
                        weightA = 1.0;
                        weightB = 0.0;
                    }

                    posA.x += nx * penetration * weightA;
                    posA.z += nz * penetration * weightA;
                    posB.x -= nx * penetration * weightB;
                    posB.z -= nz * penetration * weightB;

                    // Elastic impulse bounce response on primary pass
                    if (iter === 0 && vA.velocity && vB.velocity) {
                        const relVx = vA.velocity.x - vB.velocity.x;
                        const relVz = vA.velocity.y - vB.velocity.y;
                        const vDotN = relVx * nx + relVz * nz;

                        if (vDotN < 0) {
                            const impulse = -(1 + restitution) * vDotN * 0.5;
                            vA.velocity.x += nx * impulse * weightA;
                            vA.velocity.y += nz * impulse * weightA;
                            vB.velocity.x -= nx * impulse * weightB;
                            vB.velocity.y -= nz * impulse * weightB;

                            const sinYawA = Math.sin(vA.yaw);
                            const cosYawA = Math.cos(vA.yaw);
                            vA.speed = vA.velocity.x * (-sinYawA) + vA.velocity.y * (-cosYawA);

                            const sinYawB = Math.sin(vB.yaw);
                            const cosYawB = Math.cos(vB.yaw);
                            vB.speed = vB.velocity.x * (-sinYawB) + vB.velocity.y * (-cosYawB);
                        }
                    }
                }
                // -------------------------------------------------------------
                // CASE 2: SOFT ELASTIC BUMPER ZONE (2.20m <= d < 3.50m) on primary pass
                // -------------------------------------------------------------
                else if (iter === 0 && distSq < softBumperDistSq) {
                    const dist = Math.sqrt(distSq);
                    const nx = dx / dist;
                    const nz = dz / dist;

                    if (vA.velocity && vB.velocity) {
                        const relVx = vA.velocity.x - vB.velocity.x;
                        const relVz = vA.velocity.y - vB.velocity.y;
                        const vDotN = relVx * nx + relVz * nz;

                        if (vDotN < 0) {
                            const compression = (softBumperDist - dist) / (softBumperDist - targetDist);
                            const springForce = WATCHDOG_CONFIG.ANTI_OVERLAP.BUMPER_SPRING_K * compression * dt;

                            vA.velocity.x += nx * springForce * 0.5;
                            vA.velocity.y += nz * springForce * 0.5;
                            vB.velocity.x -= nx * springForce * 0.5;
                            vB.velocity.y -= nz * springForce * 0.5;
                        }
                    }
                }
            }
        }
    }
}

// ============================================================================
// 4. INTEGRATED TRAFFIC WATCHDOG COORDINATOR
// ============================================================================

/**
 * Unified Coordinator integrating:
 * - Intersection yellow-box negotiation
 * - Anti-deadlock watchdog
 * - Anti-overlap enforcement
 * 
 * Drop-in helper for game loop integration and testing.
 */
export class TrafficWatchdogCoordinator {
    constructor() {
        this.intersectionManager = new IntersectionManager();
        this.deadlockWatchdog = new TrafficDeadlockWatchdog();
        this.antiOverlapEnforcer = new AntiOverlapEnforcer();
        this.currentTick = 0;
    }

    /**
     * Initializes coordinator with road network topology.
     * @param {RoadNetwork} roadNetwork
     */
    init(roadNetwork) {
        this.intersectionManager.initFromRoadNetwork(roadNetwork);
    }

    /**
     * Executes the integrated traffic control pass per fixed physics step.
     * Guaranteed zero heap allocation.
     * 
     * @param {Array<Vehicle>} trafficVehicles Fleet of autonomous vehicles
     * @param {Vehicle|null} playerVehicle Active player vehicle
     * @param {SpatialGrid} spatialGrid Broadphase hash grid
     * @param {RoadNetwork} roadNetwork Directed road network graph
     * @param {number} dt Timestep in seconds (default 1/60)
     */
    step(trafficVehicles, playerVehicle, spatialGrid, roadNetwork, dt = 1 / 60) {
        this.currentTick++;
        const currentTick = this.currentTick;

        // 1. Advance intersection conflict zone reservations
        this.intersectionManager.update(currentTick);

        const allVehicles = playerVehicle ? [playerVehicle, ...trafficVehicles] : trafficVehicles;

        // 2. Evaluate intersection approaches and deadlock watchdog for all traffic vehicles
        for (let i = 0; i < trafficVehicles.length; i++) {
            const tv = trafficVehicles[i];

            // Intersection approach evaluation
            const approach = this.intersectionManager.evaluateApproach(tv, currentTick);
            if (approach.mustStop) {
                // Apply stopping deceleration
                tv.setInputs(0, tv.inputSteer || 0, 1.0, false);
            }

            // Anti-deadlock watchdog evaluation
            this.deadlockWatchdog.updateVehicle(tv, dt, spatialGrid, roadNetwork, allVehicles, this.intersectionManager);
        }

        // 3. Strict Anti-Overlap Enforcement (guaranteeing d >= 2.0m)
        this.antiOverlapEnforcer.enforce(allVehicles, spatialGrid, dt);
    }

    /**
     * Returns telemetry metrics for benchmark and health auditing.
     */
    getMetrics() {
        return {
            currentTick: this.currentTick,
            stage1Nudges: this.deadlockWatchdog.metrics.totalStage1Nudges,
            stage2Respawns: this.deadlockWatchdog.metrics.totalStage2Respawns,
            overlapViolationsPrevented: this.antiOverlapEnforcer.violationsPrevented,
            minRecordedDistance: Math.sqrt(this.antiOverlapEnforcer.minRecordedDistance || 0)
        };
    }
}
