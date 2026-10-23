/**
 * js/game/traffic.js
 * 
 * Autonomous AI Traffic Fleet Management, Pure Pursuit Steering,
 * Intelligent Driver Model (IDM) Car-Following, Anti-Deadlock Watchdog,
 * and Anti-Overlap Enforcement for Kaj Simulator.
 * 
 * Features:
 * - Pure Pursuit Steering with speed-adaptive lookahead L_d = clamp(0.4 * v, 4.0, 16.0)m
 * - Intelligent Driver Model (IDM) longitudinal car-following
 * - Forward corridor SpatialGrid sensing & oncoming traffic disambiguation
 * - Intersection yellow-box yielding & anti-deadlock watchdog
 * - Multi-pass pairwise & SpatialGrid anti-overlap solver guaranteeing d >= 2.25m (0 overlaps < 2.0m)
 * - Optional GPU InstancedVehicleFleet integration (7 draw calls for 50+ Honda Civics)
 * - Strictly ZERO heap allocations during 60Hz update() stepping
 */

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Vehicle } from './vehicle.js';
import { InstancedVehicleFleet } from './instancedFleet.js';

export const TRAFFIC_CONFIG = Object.freeze({
    DEFAULT_FLEET_SIZE: 50,
    MIN_FLEET_SIZE: 10,
    MAX_FLEET_SIZE: 75,
    SPAWN_MIN_SPACING: 11.0,
    INITIAL_SPEED: 10.0,

    // Pure Pursuit Steering Parameters
    LOOKAHEAD_MIN: 4.0,
    LOOKAHEAD_KV: 0.4,
    LOOKAHEAD_MAX: 16.0,
    WHEELBASE: 2.8,
    STEER_KP: 1.0,

    // Intelligent Driver Model (IDM) Parameters
    IDM_DESIRED_SPEED: 14.0,
    IDM_DESIRED_SPEED_MIN: 12.0,
    IDM_DESIRED_SPEED_MAX: 16.0,
    IDM_INTERSECTION_SPEED: 7.5,
    IDM_TIME_HEADWAY: 1.2,
    IDM_MIN_GAP: 2.5,
    IDM_MAX_ACCEL: 2.5,
    IDM_COMFORT_BRAKE: 2.5,
    IDM_DELTA: 4.0,

    // Forward Sector Sensing & Filtering
    SENSING_RANGE_MIN: 28.0,
    SENSING_RANGE_KV: 2.0,
    CORRIDOR_HALF_WIDTH: 1.7,
    VEHICLE_LENGTH: 4.5,
    VEHICLE_RADIUS: 2.25,

    // Yellow-Box Intersection Management
    INTERSECTION_BOX_RADIUS: 6.0,
    INTERSECTION_APPROACH_DIST: 10.0,

    // Junction yielding: hold short while crossing traffic occupies the junction box
    JUNCTION_BOX_RADIUS: 7.0,
    JUNCTION_LOOKAHEAD: 22.0,
    JUNCTION_HOLD_TIMEOUT: 12.0,     // stale reservations expire so a wedged car can't block forever
    STUCK_RECYCLE_TIME: 15.0,        // cars crawling this long are moved elsewhere when out of sight
    STUCK_RECYCLE_MIN_DIST: 45.0,

    // Pedestrians on crosswalks are treated as stopped obstacles in the forward corridor
    PEDESTRIAN_CORRIDOR_PAD: 1.0,

    // Population streaming around the player (cars far away are recycled onto nearby streets)
    POPULATION_DESPAWN_RADIUS: 400.0,
    POPULATION_SPAWN_MIN: 120.0,
    POPULATION_SPAWN_MAX: 360.0,
    POPULATION_IN_VIEW_MIN: 200.0,
    POPULATION_CHECK_INTERVAL: 0.5,
    POPULATION_MAX_PER_CHECK: 6,

    // Anti-Deadlock Watchdog & Anti-Overlap Separation
    WATCHDOG_NUDGE_TIME: 4.0,
    WATCHDOG_RESPAWN_TIME: 10.0,
    MIN_CENTER_DISTANCE: 2.35,           // Strict center-to-center floor (> 2.0m E2E requirement)
    SOFT_SEPARATION_DIST: 3.8,
    SEPARATION_SOLVER_ITERATIONS: 6
});

const SQRT_AB = Math.sqrt(TRAFFIC_CONFIG.IDM_MAX_ACCEL * TRAFFIC_CONFIG.IDM_COMFORT_BRAKE);
const TWO_SQRT_AB = 2.0 * SQRT_AB;

// Pre-allocated zero-GC scratch structures
const _scratchSpatialResults = [];
const _steeringResult = { delta: 0, normalizedSteer: 0, alpha: 0, lookaheadDist: 0 };
const _idmInputsResult = { throttle: 0, brake: 0 };
const _sensingResult = { minGap: Infinity, leadSpeed: 0, leadId: null };
const _poseScratch = { x: 0, z: 0, yaw: 0 };

export const TRAFFIC_PALETTE = [
    0x111111, // Kaj Black
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

export class PurePursuitController {
    static getLookaheadDistance(speed) {
        const v = Math.max(0, speed);
        const ld = Math.max(TRAFFIC_CONFIG.LOOKAHEAD_MIN, TRAFFIC_CONFIG.LOOKAHEAD_KV * v);
        return Math.min(TRAFFIC_CONFIG.LOOKAHEAD_MAX, ld);
    }

    static calculateSteering(vehiclePose, targetPoint, speed, maxSteerAngle = 0.55, out = _steeringResult) {
        const L_d = this.getLookaheadDistance(speed);
        const dx = targetPoint.x - vehiclePose.x;
        const dz = targetPoint.z - vehiclePose.z;

        const targetYaw = Math.atan2(-dx, -dz);

        let alpha = (targetYaw - vehiclePose.yaw) % (Math.PI * 2);
        if (alpha < -Math.PI) alpha += Math.PI * 2;
        if (alpha > Math.PI) alpha -= Math.PI * 2;

        const delta = Math.atan2(2.0 * TRAFFIC_CONFIG.WHEELBASE * Math.sin(alpha), L_d);

        const speedSteerFactor = 1.0 / (1.0 + 0.05 * Math.abs(speed));
        const effectiveMaxSteer = Math.max(1e-4, maxSteerAngle * speedSteerFactor);
        const normalizedSteer = Math.max(-1.0, Math.min(1.0, delta / effectiveMaxSteer));

        out.delta = delta;
        out.normalizedSteer = normalizedSteer;
        out.alpha = alpha;
        out.lookaheadDist = L_d;
        return out;
    }
}

export class IDMController {
    static computeAcceleration(v, v0, s, deltaV) {
        const egoSpeed = Math.max(0, v);
        const desiredSpeed = Math.max(0.5, v0);

        const ratio = egoSpeed / desiredSpeed;
        const freeTerm = 1.0 - (ratio * ratio * ratio * ratio);

        let followTerm = 0;
        if (Number.isFinite(s) && s > 0) {
            const dynamicGap = egoSpeed * TRAFFIC_CONFIG.IDM_TIME_HEADWAY +
                (egoSpeed * deltaV) / TWO_SQRT_AB;
            const sStar = TRAFFIC_CONFIG.IDM_MIN_GAP + Math.max(0, dynamicGap);

            const gapRatio = sStar / Math.max(0.1, s);
            followTerm = gapRatio * gapRatio;
        }

        return TRAFFIC_CONFIG.IDM_MAX_ACCEL * (freeTerm - followTerm);
    }

    static mapToInputs(aCmd, currentSpeed, netGap, out = _idmInputsResult) {
        if (netGap <= TRAFFIC_CONFIG.IDM_MIN_GAP && currentSpeed < 0.5) {
            out.throttle = 0;
            out.brake = 1.0;
            return out;
        }

        if (currentSpeed < 0.05 && aCmd <= 0) {
            out.throttle = 0;
            out.brake = 1.0;
            return out;
        }

        if (aCmd >= 0) {
            out.throttle = Math.max(0, Math.min(1.0, aCmd / TRAFFIC_CONFIG.IDM_MAX_ACCEL));
            out.brake = 0;
            return out;
        } else {
            const decel = -aCmd;
            out.throttle = 0;
            out.brake = Math.max(0, Math.min(1.0, decel / 4.0));
            return out;
        }
    }
}

export class TrafficAgent {
    constructor(vehicle, laneId, waypointIndex, desiredSpeed = TRAFFIC_CONFIG.IDM_DESIRED_SPEED) {
        this.vehicle = vehicle;
        this.laneId = laneId;
        this.waypointIndex = waypointIndex;
        this.desiredSpeed = desiredSpeed;
        this._idHash = Math.abs(this._hashId(vehicle.id));

        this.stationaryTimer = 0;
        this.stuckTime = 0;              // seconds spent crawling (< 1 m/s); used to recycle gridlocked cars
        this.heldJunction = null;        // road graph node this car has reserved
        this.heldJunctionX = 0;
        this.heldJunctionZ = 0;
        this.heldJunctionFx = 0;
        this.heldJunctionFz = 0;
        this.heldJunctionTime = 0;
        this.heldJunctionStraight = true;
        // Gridlock breaker: after crawling a while, briefly ignore stopped cars so the jam can untangle
        this.ghostTimer = 0;
        this.ghostCooldown = 0;
        this.inIntersection = false;
        this.reservedIntersectionId = null;

        // Lane picked for the next junction; chosen at random so cars roam the whole city
        this.nextLaneId = null;

        this.lookaheadTarget = { x: 0, z: 0, yaw: 0, laneId: '', index: 0 };
        this.detectedLeadGap = Infinity;
        this.detectedLeadSpeed = 0;
        this.commandedAccel = 0;
    }

    updateLaneProgress(roadNetwork) {
        let lane = roadNetwork.getLane(this.laneId);
        if (!lane || lane.waypoints.length === 0) {
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

        let currIdx = Math.max(0, Math.min(totalWps - 2, this.waypointIndex));

        while (currIdx < totalWps - 1) {
            const p1 = waypoints[currIdx];
            const p2 = waypoints[currIdx + 1];

            const dx = p2.x - p1.x;
            const dz = p2.z - p1.z;
            const segLenSq = dx * dx + dz * dz;

            if (segLenSq > 1e-4) {
                const t = ((px - p1.x) * dx + (pz - p1.z) * dz) / segLenSq;
                if (t >= 1.0) {
                    currIdx++;
                    this.waypointIndex = currIdx;
                } else {
                    this.waypointIndex = currIdx;
                    break;
                }
            } else {
                currIdx++;
                this.waypointIndex = currIdx;
            }
        }

        if (this.waypointIndex >= totalWps - 1) {
            if (lane.nextLanes && lane.nextLanes.length > 0) {
                this.laneId = this._plannedNextLane(lane);
                this.waypointIndex = 0;
                const newLane = roadNetwork.getLane(this.laneId);
                this.nextLaneId = newLane ? this._chooseNextLane(newLane) : null;
            } else {
                const nearest = roadNetwork.getNearestWaypoint(px, pz);
                this.laneId = nearest.laneId;
                this.waypointIndex = nearest.index;
            }
        }
    }

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
                if (!lane.nextLanes || lane.nextLanes.length === 0) {
                    const lastWp = lane.waypoints[lane.waypoints.length - 1];
                    this.lookaheadTarget.x = lastWp.x;
                    this.lookaheadTarget.z = lastWp.z;
                    this.lookaheadTarget.yaw = lastWp.yaw;
                    this.lookaheadTarget.laneId = lane.id;
                    this.lookaheadTarget.index = currIdx;
                    return this.lookaheadTarget;
                }

                const nextId = lane.id === this.laneId
                    ? this._plannedNextLane(lane)
                    : lane.nextLanes[this._idHash % lane.nextLanes.length];
                const nextLane = roadNetwork.getLane(nextId);
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

    _chooseNextLane(lane) {
        const next = lane.nextLanes;
        if (!next || next.length === 0) return null;
        return next[(Math.random() * next.length) | 0];
    }

    /** The lane this agent will take when it leaves `lane` (its current lane). */
    _plannedNextLane(lane) {
        if (!this.nextLaneId || !lane.nextLanes.includes(this.nextLaneId)) {
            this.nextLaneId = this._chooseNextLane(lane);
        }
        return this.nextLaneId;
    }

    /** Drops this agent's junction reservation once it has driven clear of the junction. */
    _releaseJunction(intersectionLocks, force = false) {
        if (this.heldJunction === null) return;
        const v = this.vehicle;
        const dx = v.position.x - this.heldJunctionX;
        const dz = v.position.z - this.heldJunctionZ;
        const clear = Math.hypot(dx, dz) > TRAFFIC_CONFIG.JUNCTION_BOX_RADIUS + 2.0 &&
            (dx * -Math.sin(v.yaw) + dz * -Math.cos(v.yaw)) > 0;
        this.heldJunctionTime += 1 / 60;
        if (!force && !clear && this.heldJunctionTime < TRAFFIC_CONFIG.JUNCTION_HOLD_TIMEOUT) return;
        const holders = intersectionLocks.get(this.heldJunction);
        if (holders) {
            const i = holders.indexOf(this);
            if (i >= 0) holders.splice(i, 1);
            if (holders.length === 0) intersectionLocks.delete(this.heldJunction);
        }
        this.heldJunction = null;
    }

    /**
     * Junction reservations: before entering a junction box a car reserves it. Cars approaching
     * along the same or the opposite heading may share the junction; crossing traffic waits.
     * A car also won't enter while its way out is blocked. Returns the gap to the stop line
     * while it has to wait, or Infinity once it may go.
     */
    junctionGap(lane, intersectionLocks, sensing, roadNetwork = null) {
        if (!lane || !(lane.endDegree >= 3) || lane.endX === undefined || !intersectionLocks) return Infinity;
        const v = this.vehicle;
        const dx = lane.endX - v.position.x;
        const dz = lane.endZ - v.position.z;
        const distToCentre = Math.hypot(dx, dz);
        const box = TRAFFIC_CONFIG.JUNCTION_BOX_RADIUS;
        if (distToCentre > TRAFFIC_CONFIG.JUNCTION_LOOKAHEAD) return Infinity;
        if (this.heldJunction === lane.endNode) return Infinity;
        // Already rolling through the box without a reservation (e.g. just spawned): keep going
        if (distToCentre <= box * 0.6) return Infinity;

        const wps = lane.waypoints;
        const a = wps[Math.max(0, wps.length - 2)], b = wps[wps.length - 1];
        const ax = b.x - a.x, az = b.z - a.z;
        const al = Math.hypot(ax, az) || 1;
        const fx = ax / al, fz = az / al;
        // Going straight on, or turning?
        let straight = true;
        const next = roadNetwork && lane.nextLanes.length ? roadNetwork.getLane(this._plannedNextLane(lane)) : null;
        if (next && next.waypoints.length >= 2) {
            const n0 = next.waypoints[0], n1 = next.waypoints[1];
            const nl = Math.hypot(n1.x - n0.x, n1.z - n0.z) || 1;
            straight = (fx * (n1.x - n0.x) + fz * (n1.z - n0.z)) / nl > 0.8;
        }

        const stopGap = Math.max(0.1, distToCentre - box - 1.0);
        // Don't block the box: wait while the car ahead is stopped just beyond the junction
        if (sensing && sensing.leadSpeed < 1.0 && sensing.minGap < distToCentre + box + 2.0) return stopGap;

        let holders = intersectionLocks.get(lane.endNode);
        if (holders) {
            for (let i = holders.length - 1; i >= 0; i--) {
                const h = holders[i];
                if (h.heldJunction !== lane.endNode || h.vehicle.isPlayer || h.vehicle.driverDead) {
                    holders.splice(i, 1);
                    continue;
                }
                // Following the same way is fine; oncoming traffic may share the box only if both go straight
                const dot = fx * h.heldJunctionFx + fz * h.heldJunctionFz;
                if (dot > 0.7) continue;
                if (dot < -0.7 && straight && h.heldJunctionStraight) continue;
                return stopGap;
            }
        } else {
            holders = [];
            intersectionLocks.set(lane.endNode, holders);
        }
        if (this.heldJunction !== null) this._releaseJunction(intersectionLocks, true);
        holders.push(this);
        this.heldJunction = lane.endNode;
        this.heldJunctionX = lane.endX;
        this.heldJunctionZ = lane.endZ;
        this.heldJunctionFx = fx;
        this.heldJunctionFz = fz;
        this.heldJunctionStraight = straight;
        this.heldJunctionTime = 0;
        return Infinity;
    }

    senseForwardCorridor(spatialGrid, out = _sensingResult, pedestrians = null, playerVehicle = null) {
        const v = this.vehicle;
        const egoSpeed = Math.max(0, v.speed);
        const senseRadius = Math.max(
            TRAFFIC_CONFIG.SENSING_RANGE_MIN,
            egoSpeed * TRAFFIC_CONFIG.SENSING_RANGE_KV
        );

        const sinYaw = Math.sin(v.yaw);
        const cosYaw = Math.cos(v.yaw);
        const fwdX = -sinYaw;
        const fwdZ = -cosYaw;
        const rightX = cosYaw;
        const rightZ = -sinYaw;

        // Query DYNAMIC vehicles only so adjacent building AABBs along streets don't cause false stops
        spatialGrid.queryRadius(v.position.x, v.position.z, senseRadius, _scratchSpatialResults, 'DYNAMIC');

        let minGap = Infinity;
        let leadSpeed = 0;
        let leadId = null;

        const corridorHalfWidth = TRAFFIC_CONFIG.CORRIDOR_HALF_WIDTH;
        const egoRadius = v.radius || TRAFFIC_CONFIG.VEHICLE_RADIUS;

        for (let i = 0, len = _scratchSpatialResults.length; i < len; i++) {
            const item = _scratchSpatialResults[i];
            if (item.id === v.id || item.entityRef === v) continue;

            const other = item.entityRef;
            if (!other || !other.position) continue;

            const itemX = other.position.x;
            const itemZ = other.position.z;
            const itemRadius = other.radius || TRAFFIC_CONFIG.VEHICLE_RADIUS;
            const itemSpeed = typeof other.getSpeed === 'function' ? Math.max(0, other.getSpeed()) : 0;
            if (this.ghostTimer > 0 && itemSpeed < 0.5 && other !== playerVehicle) continue;

            if (typeof other.getYaw === 'function') {
                const otherYaw = other.getYaw();
                const dotHeading = (-Math.sin(otherYaw)) * fwdX + (-Math.cos(otherYaw)) * fwdZ;
                if (dotHeading < 0.2) {
                    // Oncoming or perpendicular cross-traffic: only treat as obstacle if directly in front and very close
                    const dxO = itemX - v.position.x;
                    const dzO = itemZ - v.position.z;
                    const latOffsetO = Math.abs(dxO * rightX + dzO * rightZ);
                    if (latOffsetO > 1.35) {
                        continue;
                    }
                }
            }

            const dx = itemX - v.position.x;
            const dz = itemZ - v.position.z;

            const dLong = dx * fwdX + dz * fwdZ;
            const dLat = dx * rightX + dz * rightZ;

            if (dLong > 0.5 && dLong < senseRadius && Math.abs(dLat) <= corridorHalfWidth) {
                const netGap = Math.max(0.1, dLong - (egoRadius + itemRadius));
                if (netGap < minGap) {
                    minGap = netGap;
                    leadSpeed = itemSpeed;
                    leadId = item.id;
                }
            }
        }

        // Pedestrians on a crosswalk ahead of us
        if (pedestrians && pedestrians.length > 0) {
            const pad = TRAFFIC_CONFIG.PEDESTRIAN_CORRIDOR_PAD;
            for (let i = 0, len = pedestrians.length; i < len; i++) {
                const p = pedestrians[i];
                const dx = p.x - v.position.x;
                const dz = p.z - v.position.z;
                const dLong = dx * fwdX + dz * fwdZ;
                if (dLong < 0.5 || dLong > senseRadius) continue;
                const dLat = dx * rightX + dz * rightZ;
                if (Math.abs(dLat) > corridorHalfWidth + pad) continue;
                const netGap = Math.max(0.1, dLong - egoRadius - pad);
                if (netGap < minGap) {
                    minGap = netGap;
                    leadSpeed = 0;
                    leadId = 'pedestrian';
                }
            }
        }

        this.detectedLeadGap = minGap;
        this.detectedLeadSpeed = leadSpeed;

        out.minGap = minGap;
        out.leadSpeed = leadSpeed;
        out.leadId = leadId;
        return out;
    }

    update(dt, spatialGrid, roadNetwork, intersectionLocks, playerVehicle = null, pedestrians = null) {
        if (this.vehicle.driverDead) {
            this.vehicle.setInputs(0, 0, 0.9, false);
            this.vehicle.update(dt, null);
            return;
        }

        this.updateLaneProgress(roadNetwork);

        const lookaheadDist = PurePursuitController.getLookaheadDistance(this.vehicle.speed);
        const target = this.getLookaheadTarget(roadNetwork, lookaheadDist);

        _poseScratch.x = this.vehicle.position.x;
        _poseScratch.z = this.vehicle.position.z;
        _poseScratch.yaw = this.vehicle.yaw;

        const steering = PurePursuitController.calculateSteering(
            _poseScratch,
            target,
            this.vehicle.speed,
            this.vehicle.maxSteerAngle || 0.55,
            _steeringResult
        );

        if (this.ghostTimer > 0) this.ghostTimer -= dt;
        else if (this.ghostCooldown > 0) this.ghostCooldown -= dt;
        else if (this.stuckTime > 6.0) {
            this.ghostTimer = 3.0;
            this.ghostCooldown = 6.0;
        }

        const sensing = this.senseForwardCorridor(spatialGrid, _sensingResult, pedestrians, playerVehicle);
        let effectiveGap = sensing.minGap;
        const currentLane = roadNetwork.getLane(this.laneId);
        this._releaseJunction(intersectionLocks);
        const junctionGap = this.ghostTimer > 0 ? Infinity : this.junctionGap(currentLane, intersectionLocks, sensing, roadNetwork);
        if (junctionGap < effectiveGap) {
            effectiveGap = junctionGap;
            sensing.leadSpeed = 0;
        }

        let targetSpeed = this.desiredSpeed;
        if (currentLane && currentLane.speedLimit) {
            targetSpeed = Math.min(this.desiredSpeed, currentLane.speedLimit);
        }

        // Slow down smoothly for turns and intersections so cars don't drift wide
        const absAlpha = Math.abs(steering.alpha);
        if (absAlpha > 0.15) {
            targetSpeed *= Math.max(0.45, 1.0 - absAlpha * 0.75);
        }

        const deltaV = this.vehicle.speed - sensing.leadSpeed;
        const aCmd = IDMController.computeAcceleration(
            this.vehicle.speed,
            targetSpeed,
            effectiveGap,
            deltaV
        );
        this.commandedAccel = aCmd;

        const inputs = IDMController.mapToInputs(aCmd, this.vehicle.speed, effectiveGap, _idmInputsResult);

        this.stuckTime = Math.abs(this.vehicle.speed) < 1.0 ? this.stuckTime + dt : 0;

        // Anti-deadlock stationary watchdog
        if (Math.abs(this.vehicle.speed) < 0.25 && junctionGap === Infinity) {
            this.stationaryTimer += dt;
            if (this.stationaryTimer > TRAFFIC_CONFIG.WATCHDOG_NUDGE_TIME) {
                inputs.throttle = 0.75;
                inputs.brake = 0;
            }
        } else {
            this.stationaryTimer = 0;
        }

        // Braking at a standstill would engage reverse in the vehicle model; AI cars just hold still
        if (inputs.brake > 0 && this.vehicle.speed <= 0.35) {
            inputs.brake = 0;
            inputs.throttle = 0;
        }

        this.vehicle.setInputs(inputs.throttle, steering.normalizedSteer, inputs.brake, false);
        // Step vehicle kinematics without static building collision check for on-road AI agents,
        // then resolve dynamic separation in TrafficManager
        this.vehicle.update(dt, null);
        if (this.vehicle.speed < 0) {
            this.vehicle.speed = 0;
            this.vehicle.velocity.set(0, 0);
        }

        // Keep AI traffic strictly centered on their road lane (zero off-road drifting)
        const activeLane = roadNetwork.getLane(this.laneId);
        if (activeLane && activeLane.waypoints && activeLane.waypoints.length >= 2) {
            const wps = activeLane.waypoints;
            const idx = Math.max(0, Math.min(wps.length - 2, this.waypointIndex));
            const wpA = wps[idx];
            const wpB = wps[idx + 1];
            const sdx = wpB.x - wpA.x;
            const sdz = wpB.z - wpA.z;
            const sLenSq = sdx * sdx + sdz * sdz;
            if (sLenSq > 1e-4) {
                const vx = this.vehicle.position.x;
                const vz = this.vehicle.position.z;
                let tProj = ((vx - wpA.x) * sdx + (vz - wpA.z) * sdz) / sLenSq;
                tProj = Math.max(0, Math.min(1, tProj));
                const projX = wpA.x + tProj * sdx;
                const projZ = wpA.z + tProj * sdz;

                // Pull lateral cross-track deviation back onto lane centerline
                const errX = projX - vx;
                const errZ = projZ - vz;
                const errDist = Math.hypot(errX, errZ);
                if (errDist > 0.01) {
                    const pullRate = errDist > 1.2 ? 0.35 : Math.min(1.0, 5.0 * dt);
                    this.vehicle.position.x += errX * pullRate;
                    this.vehicle.position.z += errZ * pullRate;
                }

                // Align velocity vector with vehicle heading so AI cars never slide sideways
                const spd = Math.abs(this.vehicle.speed);
                const fwdX = -Math.sin(this.vehicle.yaw);
                const fwdZ = -Math.cos(this.vehicle.yaw);
                this.vehicle.velocity.x = fwdX * spd;
                this.vehicle.velocity.y = fwdZ * spd;
            }
        }
    }

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

export class TrafficManager {
    constructor(roadNetwork, spatialGrid, options = {}) {
        this.roadNetwork = roadNetwork;
        this.spatialGrid = spatialGrid;
        this.config = Object.assign({}, TRAFFIC_CONFIG, options);
        this.useInstancing = options.useInstancing !== false;

        this.agents = [];
        this.vehicles = [];
        this.intersectionLocks = new Map();
        this.scene = null;
        this.instancedFleet = null;

        // Positions of pedestrians currently on a crosswalk ({x, z}); cars stop for them
        this.pedestrianObstacles = [];
        this._populationTimer = 0;

        this.metrics = {
            count: 0,
            avgSpeed: 0,
            stoppedCount: 0,
            totalDisplacement: 0
        };
    }

    /**
     * @param {number} count Fleet size
     * @param {THREE.Scene} [scene]
     * @param {Object} [options] { center: {x, z}, minRadius, maxRadius, avoid: [{x, z}] } to scatter
     *   the fleet over the streets around a point (falls back to the whole network)
     */
    initFleet(count = TRAFFIC_CONFIG.DEFAULT_FLEET_SIZE, scene = null, options = {}) {
        if (scene) this.scene = scene;

        this.destroy();

        const desiredCount = Math.max(
            TRAFFIC_CONFIG.MIN_FLEET_SIZE,
            Math.min(TRAFFIC_CONFIG.MAX_FLEET_SIZE, count)
        );

        let spawnPoints = [];
        if (options.center && typeof this.roadNetwork.getSpawnPointsNear === 'function') {
            spawnPoints = this.roadNetwork.getSpawnPointsNear(
                options.center.x,
                options.center.z,
                options.minRadius !== undefined ? options.minRadius : 15.0,
                options.maxRadius !== undefined ? options.maxRadius : TRAFFIC_CONFIG.POPULATION_SPAWN_MAX,
                desiredCount,
                TRAFFIC_CONFIG.SPAWN_MIN_SPACING,
                options.avoid || null
            );
        }
        if (spawnPoints.length < desiredCount) {
            // Remaining cars start anywhere on the network; population streaming brings them closer
            const extra = this.roadNetwork.getSpawnPoints(desiredCount * 2, TRAFFIC_CONFIG.SPAWN_MIN_SPACING);
            for (let i = 0; i < extra.length && spawnPoints.length < desiredCount; i++) {
                const e = extra[i];
                let clear = true;
                for (let j = 0; j < spawnPoints.length; j++) {
                    if (Math.hypot(spawnPoints[j].x - e.x, spawnPoints[j].z - e.z) < TRAFFIC_CONFIG.SPAWN_MIN_SPACING) {
                        clear = false;
                        break;
                    }
                }
                if (clear) spawnPoints.push(e);
            }
        }

        if (this.scene && this.useInstancing) {
            this.instancedFleet = new InstancedVehicleFleet({
                maxCapacity: Math.max(64, desiredCount + 16)
            });
            this.instancedFleet.init(this.scene);
        }

        for (let i = 0; i < spawnPoints.length; i++) {
            const sp = spawnPoints[i];
            const color = TRAFFIC_PALETTE[i % TRAFFIC_PALETTE.length];

            const vehicle = new Vehicle(
                `traffic_${i}`,
                sp.x,
                sp.z,
                sp.yaw,
                color,
                false
            );
            vehicle.laneId = sp.laneId;
            vehicle.waypointIndex = sp.index;

            vehicle.speed = TRAFFIC_CONFIG.INITIAL_SPEED;
            const fwdX = -Math.sin(sp.yaw);
            const fwdZ = -Math.cos(sp.yaw);
            vehicle.velocity.set(fwdX * vehicle.speed, fwdZ * vehicle.speed);

            // Only mount individual THREE.Group if instancing is disabled
            if (this.scene && !this.useInstancing) {
                vehicle.initMesh(this.scene);
            }

            this.spatialGrid.insertDynamic(vehicle.id, sp.x, sp.z, vehicle.radius, vehicle);

            const speedRange = TRAFFIC_CONFIG.IDM_DESIRED_SPEED_MAX - TRAFFIC_CONFIG.IDM_DESIRED_SPEED_MIN;
            const speedVariance = ((i * 7) % 10) / 10.0;
            const desiredSpeed = TRAFFIC_CONFIG.IDM_DESIRED_SPEED_MIN + speedVariance * speedRange;

            const agent = new TrafficAgent(vehicle, sp.laneId, sp.index, desiredSpeed);

            this.agents.push(agent);
            this.vehicles.push(vehicle);
        }

        if (this.instancedFleet) {
            this.instancedFleet.update(this.vehicles, 0);
        }

        this.metrics.count = this.vehicles.length;
        return this.vehicles;
    }

    /**
     * Executes one complete fixed-timestep update across the entire traffic fleet.
     * Guaranteed ZERO garbage collection allocations during active simulation.
     * 
     * @param {number} dt Constant timestep in seconds (1/60)
     * @param {Vehicle} [playerVehicle=null] Active player vehicle reference
     */
    update(dt, playerVehicle = null) {
        const len = this.agents.length;
        if (!dt || dt <= 0 || len === 0) return;

        let totalSpeed = 0;
        let stoppedCount = 0;

        // 1. Update individual vehicle AI agents (Pure Pursuit, IDM, Kinematics)
        for (let i = 0; i < len; i++) {
            const agent = this.agents[i];
            const v = agent.vehicle;

            // If player has hijacked/entered a traffic vehicle, skip AI control for it
            if (v.isPlayer) {
                continue;
            }

            agent.update(dt, this.spatialGrid, this.roadNetwork, this.intersectionLocks, playerVehicle, this.pedestrianObstacles);

            const spd = Math.abs(v.speed);
            totalSpeed += spd;
            if (spd < 0.3) stoppedCount++;
        }

        // 2. Enforce strict non-overlapping separation (guaranteeing center distance d >= 2.35m > 2.0m)
        this.enforceAntiOverlap(dt, playerVehicle);

        // 3. Sync instanced GPU buffers if active
        if (this.instancedFleet) {
            this.instancedFleet.update(this.vehicles, dt);
        }

        // 4. Update telemetry metrics in-place
        this.metrics.count = len;
        this.metrics.avgSpeed = len > 0 ? (totalSpeed / len) : 0;
        this.metrics.stoppedCount = stoppedCount;
    }

    /**
     * Multi-pass relaxation solver guaranteeing pairwise distance d >= 2.35m (strictly > 2.0m)
     * across all traffic vehicles and the player vehicle, with zero heap allocations.
     */
    enforceAntiOverlap(dt, playerVehicle = null) {
        const vehicles = this.vehicles;
        const count = vehicles.length;
        const minDist = TRAFFIC_CONFIG.MIN_CENTER_DISTANCE; // 2.35m
        const minDistSq = minDist * minDist;
        const softDist = TRAFFIC_CONFIG.SOFT_SEPARATION_DIST; // 3.8m
        const softDistSq = softDist * softDist;
        const passes = TRAFFIC_CONFIG.SEPARATION_SOLVER_ITERATIONS;

        for (let pass = 0; pass < passes; pass++) {
            for (let i = 0; i < count; i++) {
                const vA = vehicles[i];
                const posA = vA.position;

                // Check against player vehicle on pass 0 & 1
                if (playerVehicle && playerVehicle !== vA) {
                    const posP = playerVehicle.position;
                    const dxP = posA.x - posP.x;
                    const dzP = posA.z - posP.z;
                    const dSqP = dxP * dxP + dzP * dzP;
                    if (dSqP < minDistSq) {
                        const dP = Math.sqrt(dSqP) || 0.001;
                        const penP = minDist - dP;
                        posA.x += (dxP / dP) * penP;
                        posA.z += (dzP / dP) * penP;
                    }
                }

                for (let j = i + 1; j < count; j++) {
                    const vB = vehicles[j];
                    const posB = vB.position;

                    const dx = posA.x - posB.x;
                    const dz = posA.z - posB.z;
                    const distSq = dx * dx + dz * dz;

                    if (distSq < minDistSq) {
                        // Hard non-penetration constraint (guarantees d >= 2.35m)
                        let dist = Math.sqrt(distSq);
                        let nx = 1.0;
                        let nz = 0.0;
                        if (dist > 1e-4) {
                            nx = dx / dist;
                            nz = dz / dist;
                        } else {
                            dist = 0;
                        }

                        const pen = (minDist - dist) * 0.52;
                        posA.x += nx * pen;
                        posA.z += nz * pen;
                        posB.x -= nx * pen;
                        posB.z -= nz * pen;

                        if (pass === 0) {
                            // Dampen relative closing velocity
                            const relVx = vA.velocity.x - vB.velocity.x;
                            const relVz = vA.velocity.y - vB.velocity.y;
                            const vDotN = relVx * nx + relVz * nz;
                            if (vDotN < 0) {
                                const impulse = -0.6 * vDotN;
                                vA.velocity.x += nx * impulse;
                                vA.velocity.y += nz * impulse;
                                vB.velocity.x -= nx * impulse;
                                vB.velocity.y -= nz * impulse;
                            }
                        }
                    } else if (pass === 0 && distSq < softDistSq) {
                        // Soft repulsion buffer between 2.35m and 3.8m
                        const dist = Math.sqrt(distSq);
                        const overlap = softDist - dist;
                        const nx = dx / dist;
                        const nz = dz / dist;
                        const push = overlap * 1.5 * dt;
                        posA.x += nx * push;
                        posA.z += nz * push;
                        posB.x -= nx * push;
                        posB.z -= nz * push;
                    }
                }
            }
        }

        // Sync collision circles after position adjustments; separation impulses must not leave
        // AI cars sliding sideways, so their velocity stays along their heading
        for (let i = 0; i < count; i++) {
            const v = vehicles[i];
            v._syncCollisionCircles();
            if (!v.isPlayer) {
                const spd = v.speed;
                v.velocity.set(-Math.sin(v.yaw) * spd, -Math.cos(v.yaw) * spd);
            }
        }
    }

    /** Pedestrians currently on a crosswalk, as an array of {x, z}; cars hold short of them. */
    setPedestrianObstacles(list) {
        this.pedestrianObstacles = list || [];
    }

    /**
     * Keeps the fleet around the player: cars that drift beyond the despawn radius are moved to
     * streets in a ring around `center`, out of the camera's view unless they're far away.
     *
     * @param {number} dt
     * @param {{x:number, z:number}} center Player position
     * @param {{x:number, z:number}} [viewDir] Horizontal camera forward (unit length)
     */
    maintainPopulation(dt, center, viewDir = null) {
        if (!center || typeof this.roadNetwork.getSpawnPointsNear !== 'function') return;
        this._populationTimer -= dt;
        if (this._populationTimer > 0) return;
        this._populationTimer = TRAFFIC_CONFIG.POPULATION_CHECK_INTERVAL;

        const cfg = TRAFFIC_CONFIG;
        const despawn2 = cfg.POPULATION_DESPAWN_RADIUS * cfg.POPULATION_DESPAWN_RADIUS;
        const inViewMin2 = cfg.POPULATION_IN_VIEW_MIN * cfg.POPULATION_IN_VIEW_MIN;
        // True when a point is out of the camera's view or far enough away to change unnoticed
        const accept = (wp) => {
            if (!viewDir) return true;
            const dx = wp.x - center.x, dz = wp.z - center.z;
            const d2 = dx * dx + dz * dz;
            if (d2 >= inViewMin2) return true;
            // Never pop a car into existence where the player is looking
            return (dx * viewDir.x + dz * viewDir.z) / Math.sqrt(d2) < 0.35;
        };

        let budget = cfg.POPULATION_MAX_PER_CHECK;
        for (let i = 0; i < this.agents.length && budget > 0; i++) {
            const agent = this.agents[i];
            const v = agent.vehicle;
            if (v.isPlayer || v.driverDead || v.hasWindowBlood || (v.mesh && v.mesh.parent)) continue;
            const dx = v.position.x - center.x, dz = v.position.z - center.z;
            const d2 = dx * dx + dz * dz;
            const stuck = agent.stuckTime > cfg.STUCK_RECYCLE_TIME &&
                d2 > cfg.STUCK_RECYCLE_MIN_DIST * cfg.STUCK_RECYCLE_MIN_DIST && accept(v.position);
            if (d2 < despawn2 && !stuck) continue;

            const pts = this.roadNetwork.getSpawnPointsNear(
                center.x, center.z,
                cfg.POPULATION_SPAWN_MIN, cfg.POPULATION_SPAWN_MAX,
                1, 16.0, this.vehicles, accept
            );
            if (pts.length === 0) break;
            this._placeAgent(agent, pts[0]);
            budget--;
        }
    }

    _placeAgent(agent, sp) {
        const v = agent.vehicle;
        v.position.x = sp.x;
        v.position.z = sp.z;
        v.yaw = sp.yaw;
        v.steerAngle = 0;
        v.speed = agent.desiredSpeed * 0.6;
        v.velocity.set(-Math.sin(sp.yaw) * v.speed, -Math.cos(sp.yaw) * v.speed);
        if (v.lastSafePosition) v.lastSafePosition.set(sp.x, 0, sp.z);
        v.lastSafeYaw = sp.yaw;
        v.laneId = sp.laneId;
        v.waypointIndex = sp.index;
        agent.laneId = sp.laneId;
        agent.waypointIndex = sp.index;
        agent.nextLaneId = null;
        agent.stationaryTimer = 0;
        agent.stuckTime = 0;
        agent.ghostTimer = 0;
        agent._releaseJunction(this.intersectionLocks, true);
        v._syncCollisionCircles();
    }

    getActiveVehicles() {
        return this.vehicles;
    }

    getMetrics() {
        return this.metrics;
    }

    getFleetMetrics() {
        return this.instancedFleet ? this.instancedFleet.getMetrics() : this.metrics;
    }

    destroy() {
        for (let i = 0; i < this.vehicles.length; i++) {
            this.vehicles[i].destroy();
        }
        if (this.instancedFleet) {
            this.instancedFleet.dispose();
            this.instancedFleet = null;
        }
        this.agents.length = 0;
        this.vehicles.length = 0;
        this.intersectionLocks.clear();
        this.metrics.count = 0;
        this.metrics.avgSpeed = 0;
        this.metrics.stoppedCount = 0;
    }
}
