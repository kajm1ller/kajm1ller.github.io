/**
 * js/game/traffic.js
 * 
 * Autonomous AI traffic for Kaj Simulator.
 *
 * Features:
 * - Cars drive kinematically along their lanes and through smooth junction turn paths
 *   (trafficNet.js), so they never slide or drift off the road
 * - Intelligent Driver Model (IDM) car-following along the route, slowing for bends ahead
 * - Right of way at junctions: OSM traffic signals and stop signs, minor streets giving way to
 *   major ones, turns across oncoming traffic yielding, crossing paths reserved, and no entering
 *   a junction without room on the far side
 * - Going around cars stalled in the lane (dead drivers, parked cars)
 * - Optional GPU InstancedVehicleFleet integration (7 draw calls for 50+ Honda Civics)
 */

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Vehicle } from './vehicle.js';
import { pickCarModel, pickCarColor } from './carModels.js';
import { InstancedVehicleFleet } from './instancedFleet.js';
import { TrafficNet, NET_CONFIG, LIGHT } from './trafficNet.js';

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

const CAR_LEN = NET_CONFIG.CAR_LENGTH;
const HALF_LEN = CAR_LEN * 0.5;
const _fr = { x: 0, z: 0, dx: 0, dz: -1 };
const _rr = { x: 0, z: 0, dx: 0, dz: -1 };
const _c1 = { x: 0, z: 0, dx: 0, dz: -1 };
const _c2 = { x: 0, z: 0, dx: 0, dz: -1 };
const _route = [null, null, null, null];
const _obstacle = { gap: Infinity, speed: 0, id: null, dLong: 0 };
// IDM always keeps its jam distance to whatever it follows; a stop line isn't a car, so the gap
// to it is padded to bring the front bumper to rest just short of the line
const LINE_PAD = TRAFFIC_CONFIG.IDM_MIN_GAP - 0.5;

function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
}

function removeFrom(list, item) {
    const i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
}

/**
 * One AI car. It drives kinematically along its route (lane drive paths joined by junction turn
 * paths): speed comes from the IDM car-following model, the pose straight from the path, so it
 * never slides. Before each junction it asks for right of way (signals, stop signs, giving way,
 * crossing paths, room on the far side) and holds at the stop line until it gets it.
 */
export class TrafficAgent {
    constructor(vehicle, laneId, waypointIndex, desiredSpeed = TRAFFIC_CONFIG.IDM_DESIRED_SPEED) {
        this.vehicle = vehicle;
        vehicle._trafficAgent = this;
        this.laneId = laneId;
        this.waypointIndex = waypointIndex;
        this.desiredSpeed = desiredSpeed;

        this.net = null;
        this.piece = null;      // lane drive path or junction connector the car is on
        this.prevPiece = null;
        this.s = 0;             // arc length of the car's centre along `piece`
        this.plan = [];         // upcoming lane ids after the lane the car is on / turning into

        this.committed = null;  // junction the car has right of way through
        this.conn = null;       // connector it is committed to
        this.stopDone = null;   // junction whose stop sign it has already stopped for
        this.stopTimer = 0;
        this.waitTime = 0;      // seconds held at the current stop line

        this.passOffset = 0;    // sideways shift to the left while going around a stalled car
        this.passTarget = 0;
        this.passUntil = 0;
        this.passIgnore = null;
        this.blockedTime = 0;

        this.blendX = 0;        // shove from a collision, eased back out
        this.blendZ = 0;
        this.lastX = NaN;
        this.lastZ = NaN;
        this.lastYaw = vehicle.yaw || 0;

        this.stuckTime = 0;     // seconds spent crawling (< 1 m/s); used to recycle gridlocked cars
        this.retired = false;   // the player took the car (or got out of it): no longer AI driven

        this.detectedLeadGap = Infinity;
        this.detectedLeadSpeed = 0;
        this.commandedAccel = 0;
    }

    /** Puts the car on lane `laneId` at the lane's waypoint `index`. */
    place(net, laneId, index) {
        this.net = net;
        this._leaveJunction();
        let piece = net.lanePiece(laneId);
        if (!piece) {
            const v = this.vehicle;
            const wp = net.roadNetwork.getNearestWaypoint(v.position.x, v.position.z);
            piece = wp ? net.lanePiece(wp.laneId) : null;
            index = wp ? wp.index : 0;
        }
        this.piece = piece;
        this.prevPiece = null;
        this.s = piece ? net.driveS(piece, index) : 0;
        this.plan.length = 0;
        this.stopDone = null;
        this.stopTimer = 0;
        this.waitTime = 0;
        this.passOffset = this.passTarget = 0;
        this.passIgnore = null;
        this.blockedTime = 0;
        this.blendX = this.blendZ = 0;
        this.stuckTime = 0;
        this.lastX = NaN;
        if (piece) this._applyPose(0);
    }

    // ---- Route ----------------------------------------------------------------------------------

    _baseLane() {
        return this.piece.kind === 'lane' ? this.piece : this.piece.to;
    }

    _validNext(lanePiece, id) {
        return id && lanePiece.lane.nextLanes.includes(id) && this.net.lanePiece(id);
    }

    _pickNext(lanePiece) {
        const next = lanePiece.lane.nextLanes;
        if (!next || next.length === 0) return null;
        for (let tries = 0; tries < 4; tries++) {
            const id = next[(Math.random() * next.length) | 0];
            if (this.net.lanePiece(id)) return id;
        }
        for (const id of next) if (this.net.lanePiece(id)) return id;
        return null;
    }

    /** Makes sure the next two lanes after the base lane are chosen and still valid. */
    _ensurePlan() {
        let from = this._baseLane();
        for (let i = 0; i < 2; i++) {
            if (!this._validNext(from, this.plan[i])) {
                this.plan.length = i;
                const id = this._pickNext(from);
                if (!id) return;
                this.plan.push(id);
            }
            from = this.net.lanePiece(this.plan[i]);
        }
    }

    /** Fills `out` with the current piece and the next three along the route (null past a dead end). */
    _routeAhead(out) {
        const net = this.net;
        this._ensurePlan();
        const p0 = this.plan[0] ? net.lanePiece(this.plan[0]) : null;
        const p1 = this.plan[1] ? net.lanePiece(this.plan[1]) : null;
        out[0] = this.piece;
        if (this.piece.kind === 'lane') {
            out[1] = p0 ? net.connector(this.piece, p0) : null;
            out[2] = p0;
            out[3] = p0 && p1 ? net.connector(p0, p1) : null;
        } else {
            const lane = this.piece.to;
            out[1] = lane;
            out[2] = p0 ? net.connector(lane, p0) : null;
            out[3] = p0;
        }
        return out;
    }

    /** Point on the route `ds` metres ahead of (or behind) the car's centre. */
    _sampleRoute(ds, route, out) {
        let t = this.s + ds;
        if (t < 0 && this.prevPiece) return this.prevPiece.path.sample(this.prevPiece.len + t, out);
        let k = 0;
        while (t > route[k].len && k < 3 && route[k + 1]) {
            t -= route[k].len;
            k++;
        }
        return route[k].path.sample(t, out);
    }

    /** The connector this car will take out of lane piece `lp` (its current lane or the next one). */
    plannedConnector(lp) {
        this._ensurePlan();
        if (this.piece.kind === 'conn') return this.piece;
        if (lp === this.piece && this.plan[0]) {
            const next = this.net.lanePiece(this.plan[0]);
            return next ? this.net.connector(lp, next) : null;
        }
        return null;
    }

    // ---- Junctions -----------------------------------------------------------------------------

    _commit(j, conn) {
        if (this.committed === j && this.conn === conn) return;
        this._leaveJunction();
        this.committed = j;
        this.conn = conn;
        j.occupants.push(this);
        removeFrom(j.queue, this);
        this.waitTime = 0;
    }

    _leaveJunction() {
        if (this.committed) {
            removeFrom(this.committed.occupants, this);
            removeFrom(this.committed.queue, this);
        }
        if (this.stopDone && this.stopDone !== this.committed) removeFrom(this.stopDone.queue, this);
        this.committed = null;
        this.conn = null;
    }

    /** Whether the far side of `conn` has room for this car (don't block the box). */
    _exitClear(conn, j) {
        const T = conn.to;
        let need = Math.min(CAR_LEN + 1.5, T.len);
        let rear = Infinity, rearSpeed = 0;
        for (let i = 0; i < T.occ.length; i++) {
            const o = T.occ[i];
            if (o === this) continue;
            const r = o.s - HALF_LEN;
            if (r < rear) {
                rear = r;
                rearSpeed = o.vehicle.speed;
            }
        }
        for (let i = 0; i < j.occupants.length; i++) {
            const o = j.occupants[i];
            if (o !== this && o.conn && o.conn.to === T) need += CAR_LEN + 1;
        }
        return rear >= need || (rear > HALF_LEN && rearSpeed > 3.0);
    }

    /** Right of way into junction `j` along connector `conn`; the car is `frontGap` from the line. */
    _mayEnter(j, conn, frontGap) {
        const net = this.net;
        const P = this.piece;
        const v = this.vehicle.speed;

        if (P.signalGroup >= 0 && j.signal) {
            const light = net.lightState(j.signal, P.signalGroup);
            if (light === LIGHT.RED) return false;
            // Amber: stop if that can be done comfortably
            if (light === LIGHT.YELLOW && frontGap > (v * v) / 8 + 0.5) return false;
        }
        if (P.stopSign && this.stopDone !== j) return false;

        const patient = this.waitTime < 40;
        // All-way stop: first to stop goes first
        if (P.stopSign && j.control === 'allway' && patient) {
            for (let i = 0; i < j.queue.length; i++) {
                const q = j.queue[i];
                if (q === this) break;
                if (q.committed || q.retired || q.vehicle.driverDead) continue;
                const qc = q.plannedConnector(q.piece);
                if (qc && net.conflicts(qc, conn)) return false;
            }
        }

        // Give way to approaching traffic: minor streets to major ones, turns across oncoming traffic
        const minor = P.yieldMinor || (P.stopSign && j.control !== 'allway');
        const crossing = conn.turn === 'left' || conn.turn === 'uturn';
        if (patient && (minor || crossing)) {
            P.path.sample(P.len, _c1);
            for (let i = 0; i < j.inLanes.length; i++) {
                const LP = net.lanePiece(j.inLanes[i].id);
                if (!LP || LP === P || LP.junction !== j || LP.occ.length === 0) continue;
                if (minor) {
                    if (LP.stopSign || LP.yieldMinor) continue;
                } else {
                    LP.path.sample(LP.len, _c2);
                    if (_c1.dx * _c2.dx + _c1.dz * _c2.dz > -0.7) continue; // only oncoming traffic
                }
                if (LP.signalGroup >= 0 && j.signal && net.lightState(j.signal, LP.signalGroup) === LIGHT.RED) continue;
                for (let k = 0; k < LP.occ.length; k++) {
                    const o = LP.occ[k];
                    if (o.committed === j || o.vehicle.driverDead) continue;
                    const rem = LP.len - o.s - HALF_LEN;
                    if (rem > 40) continue;
                    const os = o.vehicle.speed;
                    if (os < 0.5 && rem > 2) continue;               // held up further back
                    if (rem / Math.max(os, 0.5) > 5.5) continue;      // too far off to matter
                    const oc = o.plannedConnector(LP);
                    if (!oc || (crossing && !minor && oc.turn === 'left')) continue;
                    if (net.conflicts(oc, conn)) return false;
                }
            }
        }

        // Nothing already crossing our path
        for (let i = 0; i < j.occupants.length; i++) {
            const o = j.occupants[i];
            if (o === this || o.vehicle.driverDead || o.retired) continue;
            if (o.conn && net.conflicts(o.conn, conn)) return false;
        }
        return !patient || this._exitClear(conn, j);
    }

    // ---- Sensing --------------------------------------------------------------------------------

    /** Nearest non-traffic obstacle (player, police, parked cars, pedestrians) straight ahead. */
    _senseObstacles(spatialGrid, pedestrians, out) {
        const v = this.vehicle;
        out.gap = Infinity;
        out.speed = 0;
        out.id = null;
        out.dLong = 0;
        if (!spatialGrid) return out;
        const range = Math.max(TRAFFIC_CONFIG.SENSING_RANGE_MIN, v.speed * TRAFFIC_CONFIG.SENSING_RANGE_KV);
        const fwdX = -Math.sin(v.yaw), fwdZ = -Math.cos(v.yaw);
        const rightX = -fwdZ, rightZ = fwdX;
        const half = TRAFFIC_CONFIG.CORRIDOR_HALF_WIDTH;
        spatialGrid.queryRadius(v.position.x, v.position.z, range, _scratchSpatialResults, 'DYNAMIC');
        for (let i = 0, len = _scratchSpatialResults.length; i < len; i++) {
            const item = _scratchSpatialResults[i];
            const other = item.entityRef;
            if (!other || other === v || !other.position) continue;
            if (other._trafficAgent && !other._trafficAgent.retired) continue; // handled along the route
            if (this.passIgnore === item.id) continue;
            if (other.isPlane && other.position.y > 3) continue;
            const dx = other.position.x - v.position.x, dz = other.position.z - v.position.z;
            const dLong = dx * fwdX + dz * fwdZ;
            if (dLong < 0.5 || dLong > range) continue;
            const r = other.radius || TRAFFIC_CONFIG.VEHICLE_RADIUS;
            const dLat = Math.abs(dx * rightX + dz * rightZ);
            if (dLat > half + 0.3) continue;
            // Oncoming or crossing cars only count when squarely in front
            if (typeof other.getYaw === 'function' && dLat > 1.35) {
                const oy = other.getYaw();
                if (-Math.sin(oy) * fwdX - Math.cos(oy) * fwdZ < 0.2) continue;
            }
            const gap = Math.max(0.1, dLong - HALF_LEN - Math.min(r, HALF_LEN));
            if (gap < out.gap) {
                out.gap = gap;
                out.speed = typeof other.getSpeed === 'function' ? Math.max(0, other.getSpeed()) : 0;
                out.id = item.id;
                out.dLong = dLong;
            }
        }
        if (pedestrians) {
            const pad = TRAFFIC_CONFIG.PEDESTRIAN_CORRIDOR_PAD;
            for (let i = 0, len = pedestrians.length; i < len; i++) {
                const p = pedestrians[i];
                const dx = p.x - v.position.x, dz = p.z - v.position.z;
                const dLong = dx * fwdX + dz * fwdZ;
                if (dLong < 0.5 || dLong > range) continue;
                if (Math.abs(dx * rightX + dz * rightZ) > half + pad) continue;
                const gap = Math.max(0.1, dLong - HALF_LEN - pad);
                if (gap < out.gap) {
                    out.gap = gap;
                    out.speed = 0;
                    out.id = 'pedestrian';
                    out.dLong = dLong;
                }
            }
        }
        return out;
    }

    // ---- Step -----------------------------------------------------------------------------------

    update(dt, manager) {
        const v = this.vehicle;
        if (this.retired) return;
        if (v.isPlayer || v.driverGone) {
            this.retire();
            return;
        }
        if (!this.piece) return;

        // A collision (the player's car, a police car) shoved us: keep the shove and ease it out
        if (!Number.isNaN(this.lastX)) {
            const ex = v.position.x - this.lastX, ez = v.position.z - this.lastZ;
            const e2 = ex * ex + ez * ez;
            if (e2 > 64) {
                // Moved far away (teleported): pick the road up again from where it now is
                const wp = this.net.roadNetwork.getNearestWaypoint(v.position.x, v.position.z);
                if (wp) {
                    this.place(this.net, wp.laneId, wp.index);
                    return;
                }
            } else if (e2 > 1e-4) {
                this.blendX += ex;
                this.blendZ += ez;
                if (e2 > 0.04) v.speed *= 0.7;
            }
        }
        const decay = Math.exp(-1.3 * dt);
        this.blendX *= decay;
        this.blendZ *= decay;

        const route = this._routeAhead(_route);
        let speed = Math.max(0, v.speed);

        if (v.driverDead) {
            // Dead driver: the car rolls to a stop and never moves again
            speed = Math.max(0, speed - 7 * dt);
            this._advance(speed * dt, route);
            v.speed = speed;
            this._applyPose(dt);
            return;
        }

        // Free-road speed: street limit, then slow for bends coming up
        const base = this._baseLane();
        let v0 = Math.min(this.desiredSpeed, base.lane.speedLimit || this.desiredSpeed);
        for (let d = 0; d <= 36; d += 6) {
            this._sampleRoute(d, route, _c1);
            const h1x = _c1.dx, h1z = _c1.dz;
            this._sampleRoute(d + 5, route, _c2);
            const ang = Math.abs(Math.atan2(h1x * _c2.dz - h1z * _c2.dx, h1x * _c2.dx + h1z * _c2.dz));
            const k = ang / 5;
            if (k > 1e-3) {
                const vc = Math.sqrt(2.6 / k);
                v0 = Math.min(v0, Math.sqrt(vc * vc + 2 * 2.2 * d));
            }
        }

        // Car ahead along the route
        let gap = Infinity, leadSpeed = 0, lead = null;
        {
            let dist = -this.s;
            const range = Math.max(40, speed * 4);
            for (let k = 0; k < 4 && route[k] && dist < range; k++) {
                const P = route[k];
                let best = Infinity, bestAgent = null;
                for (let i = 0; i < P.occ.length; i++) {
                    const o = P.occ[i];
                    if (o === this || o === this.passIgnore) continue;
                    if (k === 0 && (o.s < this.s || (o.s === this.s && o.vehicle.id < v.id))) continue;
                    const d = dist + o.s;
                    if (d < best) {
                        best = d;
                        bestAgent = o;
                    }
                }
                if (bestAgent) {
                    // Bumper to bumper: half of each car's own length
                    gap = Math.max(0.05, best - ((v.length || CAR_LEN) + (bestAgent.vehicle.length || CAR_LEN)) / 2);
                    leadSpeed = Math.max(0, bestAgent.vehicle.speed);
                    lead = bestAgent;
                    break;
                }
                dist += P.len;
            }
        }
        // Dead end: stop at the end of the lane
        if (!route[1]) {
            const g = Math.max(0.05, this.piece.len - this.s - HALF_LEN + LINE_PAD);
            if (g < gap) { gap = g; leadSpeed = 0; lead = null; }
        }
        const obs = this._senseObstacles(manager.spatialGrid, manager.pedestrianObstacles, _obstacle);
        let obstacleLead = false;
        if (obs.gap < gap) {
            gap = obs.gap;
            leadSpeed = obs.speed;
            lead = null;
            obstacleLead = true;
        }

        // Right of way at the junction ahead
        const P = this.piece;
        if (P.kind === 'lane' && P.junction && route[1] && this.committed !== P.junction) {
            const j = P.junction;
            const conn = route[1];
            const frontGap = P.len - this.s - HALF_LEN;
            if (frontGap < Math.max(35, (speed * speed) / 3 + 10)) {
                // Stop sign: come to a full stop at the line first
                if (P.stopSign && this.stopDone !== j) {
                    if (frontGap < 1.5 && speed < 0.3) {
                        this.stopTimer += dt;
                        if (this.stopTimer > 1.0) {
                            this.stopDone = j;
                            this.stopTimer = 0;
                            if (!j.queue.includes(this)) j.queue.push(this);
                        }
                    } else {
                        this.stopTimer = 0;
                    }
                }
                const go = this._mayEnter(j, conn, frontGap);
                if (go && frontGap < (speed * speed) / 5 + 3) {
                    this._commit(j, conn);
                } else if (!go) {
                    const g = Math.max(0.05, frontGap + LINE_PAD);
                    if (g < gap) {
                        gap = g;
                        leadSpeed = 0;
                        lead = null;
                        obstacleLead = false;
                    }
                    if (frontGap < 4 && speed < 0.3) this.waitTime += dt;
                }
            }
        }

        // Go around a car stalled in the lane (a dead driver, a parked car)
        const stalled = gap < 9 && speed < 0.3 && leadSpeed < 0.2 &&
            ((lead && lead.vehicle.driverDead) || (obstacleLead && obs.id !== 'pedestrian'));
        if (stalled && P.kind === 'lane' && this.passTarget === 0) {
            this.blockedTime += dt;
            const leadS = lead ? (lead.piece === P ? lead.s : Infinity) : this.s + obs.dLong;
            if (this.blockedTime > 2.5 && leadS + CAR_LEN + 8 < P.len) {
                this.passIgnore = lead || obs.id;
                this.passUntil = leadS + CAR_LEN + 2;
                this.passTarget = Math.max(2.8, Math.min(3.6, (P.lane.offset || 1.8) * 2));
                this.blockedTime = 0;
            }
        } else if (!stalled) {
            this.blockedTime = 0;
        }
        if (this.passTarget > 0 && (P.kind !== 'lane' || this.s > this.passUntil)) this.passTarget = 0;
        const passStep = 1.6 * dt;
        this.passOffset += Math.max(-passStep, Math.min(passStep, this.passTarget - this.passOffset));
        if (this.passTarget === 0 && this.passOffset < 0.02) {
            this.passOffset = 0;
            this.passIgnore = null;
        }

        // IDM longitudinal control
        let a = IDMController.computeAcceleration(speed, v0, gap, speed - leadSpeed);
        a = Math.max(-9, Math.min(TRAFFIC_CONFIG.IDM_MAX_ACCEL, a));
        this.commandedAccel = a;
        speed = Math.max(0, speed + a * dt);
        if (gap < 0.2) speed = Math.min(speed, leadSpeed);
        this.detectedLeadGap = gap;
        this.detectedLeadSpeed = leadSpeed;
        this.stuckTime = speed < 1.0 ? this.stuckTime + dt : 0;

        this._advance(speed * dt, route);
        v.speed = speed;

        // Clear of the junction once fully onto the next street
        if (this.committed && this.piece.kind === 'lane' && this.piece === this.conn.to && this.s > CAR_LEN) {
            this._leaveJunction();
            this.stopDone = null;
        }
        this._applyPose(dt);
    }

    _advance(ds, route) {
        this.s += ds;
        while (this.s > this.piece.len) {
            const next = route[1];
            if (!next) {
                this.s = this.piece.len;
                this.vehicle.speed = 0;
                return;
            }
            if (this.piece.kind === 'lane') {
                // Rolling into the junction: claim it if it wasn't already
                if (next.junction && this.committed !== next.junction) this._commit(next.junction, next);
                this.plan.shift();
            }
            this.s -= this.piece.len;
            this.prevPiece = this.piece;
            this.piece = next;
            this._routeAhead(route);
        }
    }

    _applyPose(dt) {
        const v = this.vehicle;
        const route = this._routeAhead(_route);
        this._sampleRoute(1.35, route, _fr);
        this._sampleRoute(-1.35, route, _rr);
        let dx = _fr.x - _rr.x, dz = _fr.z - _rr.z;
        const dl = Math.hypot(dx, dz);
        if (dl > 1e-4) {
            dx /= dl;
            dz /= dl;
        } else {
            dx = _fr.dx;
            dz = _fr.dz;
        }
        const yaw = Math.atan2(-dx, -dz);
        // Left of travel is (dz, -dx)
        const x = (_fr.x + _rr.x) * 0.5 + dz * this.passOffset + this.blendX;
        const z = (_fr.z + _rr.z) * 0.5 - dx * this.passOffset + this.blendZ;
        v.position.set(x, v.position.y || 0, z);
        v.yaw = yaw;
        const speed = Math.max(0, v.speed);
        v.velocity.set(-Math.sin(yaw) * speed, -Math.cos(yaw) * speed);
        // Front wheels: steer angle for the path's curvature
        if (dt > 0) {
            const dyaw = wrapAngle(yaw - this.lastYaw);
            const k = speed > 0.2 ? dyaw / (speed * dt) : 0;
            const target = Math.max(-0.6, Math.min(0.6, Math.atan(TRAFFIC_CONFIG.WHEELBASE * k)));
            v.steerAngle += (target - v.steerAngle) * Math.min(1, dt * 8);
        }
        this.lastYaw = yaw;
        const lane = this._baseLane();
        v.laneId = this.laneId = lane.key;
        if (v.lastSafePosition) v.lastSafePosition.set(x, 0, z);
        v.lastSafeYaw = yaw;
        v._syncCollisionCircles();
        v._updateMeshTransform(dt);
        this.lastX = v.position.x;
        this.lastZ = v.position.z;
    }

    /** The player took this car: AI lets go of it for good. */
    retire() {
        this._leaveJunction();
        this.retired = true;
    }
}

export class TrafficManager {
    constructor(roadNetwork, spatialGrid, options = {}) {
        this.roadNetwork = roadNetwork;
        this.spatialGrid = spatialGrid;
        this.config = Object.assign({}, TRAFFIC_CONFIG, options);
        this.useInstancing = options.useInstancing !== false;
        this.net = new TrafficNet(roadNetwork);

        this.agents = [];
        this.vehicles = [];
        this.scene = null;
        this.instancedFleet = null;
        this._occupied = [];

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
            // A mix of car models in their own colours (golden-ratio steps spread the picks evenly)
            const modelId = pickCarModel((i * 0.6180339887 + 0.137) % 1);
            const color = pickCarColor(modelId, (i * 0.3819660113 + 0.29) % 1);
            const vehicle = new Vehicle(`traffic_${i}`, sp.x, sp.z, sp.yaw, color, false, modelId);

            // Only mount individual THREE.Group if instancing is disabled
            if (this.scene && !this.useInstancing) {
                vehicle.initMesh(this.scene);
            }

            const speedRange = TRAFFIC_CONFIG.IDM_DESIRED_SPEED_MAX - TRAFFIC_CONFIG.IDM_DESIRED_SPEED_MIN;
            const speedVariance = ((i * 7) % 10) / 10.0;
            const desiredSpeed = TRAFFIC_CONFIG.IDM_DESIRED_SPEED_MIN + speedVariance * speedRange;
            const agent = new TrafficAgent(vehicle, sp.laneId, sp.index, desiredSpeed);
            vehicle.speed = TRAFFIC_CONFIG.INITIAL_SPEED;
            agent.place(this.net, sp.laneId, sp.index);
            this.spatialGrid.insertDynamic(vehicle.id, vehicle.position.x, vehicle.position.z, vehicle.radius, vehicle);

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
     *
     * @param {number} dt Constant timestep in seconds (1/60)
     * @param {Vehicle} [playerVehicle=null] Active player vehicle reference
     */
    update(dt, playerVehicle = null) {
        const len = this.agents.length;
        if (!dt || dt <= 0 || len === 0) return;
        this.net.update(dt);

        // Who is on which piece of road this frame
        const occupied = this._occupied;
        for (let i = 0; i < occupied.length; i++) occupied[i].occ.length = 0;
        occupied.length = 0;
        for (let i = 0; i < len; i++) {
            const a = this.agents[i];
            if (a.retired || !a.piece) continue;
            if (a.piece.occ.length === 0) occupied.push(a.piece);
            a.piece.occ.push(a);
        }

        let totalSpeed = 0;
        let stoppedCount = 0;
        for (let i = 0; i < len; i++) {
            const agent = this.agents[i];
            if (agent.retired) continue;
            agent.update(dt, this);
            const spd = Math.abs(agent.vehicle.speed);
            totalSpeed += spd;
            if (spd < 0.3) stoppedCount++;
        }

        if (this.instancedFleet) {
            this.instancedFleet.update(this.vehicles, dt);
        }

        this.metrics.count = len;
        this.metrics.avgSpeed = len > 0 ? (totalSpeed / len) : 0;
        this.metrics.stoppedCount = stoppedCount;
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
        const inView2 = cfg.POPULATION_IN_VIEW_MIN * cfg.POPULATION_IN_VIEW_MIN;
        const accept = (p) => {
            if (!viewDir) return true;
            const dx = p.x - center.x, dz = p.z - center.z;
            const d2 = dx * dx + dz * dz;
            if (d2 >= inView2) return true;
            // Never pop a car into existence where the player is looking
            return (dx * viewDir.x + dz * viewDir.z) / Math.sqrt(d2) < 0.35;
        };

        let budget = cfg.POPULATION_MAX_PER_CHECK;
        for (let i = 0; i < this.agents.length && budget > 0; i++) {
            const agent = this.agents[i];
            const v = agent.vehicle;
            if (agent.retired || v.isPlayer || v.driverDead || v.hasWindowBlood || (v.mesh && v.mesh.parent)) continue;
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
        v.steerAngle = 0;
        v.speed = agent.desiredSpeed * 0.6;
        agent.place(this.net, sp.laneId, sp.index);
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
        for (let i = 0; i < this.agents.length; i++) this.agents[i].retire();
        for (let i = 0; i < this.vehicles.length; i++) {
            this.vehicles[i].destroy();
        }
        if (this.instancedFleet) {
            this.instancedFleet.dispose();
            this.instancedFleet = null;
        }
        for (const p of this._occupied) p.occ.length = 0;
        this._occupied.length = 0;
        this.agents.length = 0;
        this.vehicles.length = 0;
        this.metrics.count = 0;
        this.metrics.avgSpeed = 0;
        this.metrics.stoppedCount = 0;
    }
}
