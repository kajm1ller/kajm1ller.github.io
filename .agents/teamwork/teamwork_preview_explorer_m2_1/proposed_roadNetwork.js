/**
 * js/game/roadNetwork.js (Proposed Implementation for Milestone 2)
 * 
 * Directed Dual-Lane Waypoint Graph & Procedural Road Surface Generator for Kaj Simulator.
 * 
 * Features:
 * - Perimeter loop + cross grid topology (~1,220m total road centerline extent).
 * - Dual directed lanes (right-hand traffic, 3.6m lane width + 0.4m shoulders = 8.0m road width).
 * - High-speed spatial point-to-segment distance checking for world obstacle clearance (isNearRoad).
 * - Smooth waypoint lookahead traversal across lane boundaries for Pure Pursuit steering.
 * - Intersection yellow-box avoidance and collision-spaced spawn point distribution.
 * - Optimized procedural Three.js road geometry generation (asphalt at y=0.02, markings at y=0.024)
 *   batched into exactly 2 draw calls.
 * 
 * Conforms to PROJECT.md § Interface Contracts (RoadNetwork).
 */

export const ROAD_CONFIG = Object.freeze({
    LANE_WIDTH: 3.6,          // Width of a single driving lane in meters
    SHOULDER_WIDTH: 0.4,      // Width of shoulder on each side in meters
    TOTAL_WIDTH: 8.0,         // Total road surface width (2 * 3.6 + 2 * 0.4)
    HALF_WIDTH: 4.0,          // Half-width from road centerline to outer shoulder
    DEFAULT_CLEARANCE: 5.0,   // Clearance distance required for trees/rocks
    WAYPOINT_STEP: 2.5,       // Arc-length sampling interval for waypoints in meters
    ELEVATION_ROAD: 0.02,     // Elevation above grass ground to eliminate z-fighting
    ELEVATION_MARKINGS: 0.024,// Elevation of dashed centerlines and edge markings
    COLOR_ASPHALT: 0x242426,  // Dark charcoal asphalt
    COLOR_MARKINGS: 0xffcc00, // Highway yellow centerline
    COLOR_EDGELINE: 0xffffff, // Crisp white edge lines
    DASH_LENGTH: 2.5,         // Length of centerline dash
    DASH_GAP: 2.5,            // Length of gap between dashes
    DASH_WIDTH: 0.18,         // Width of centerline dash
    DEFAULT_SPEED_LIMIT: 12.0,// Default lane speed limit in m/s (~43 km/h)
    INTERSECTION_SPEED_LIMIT: 6.0 // Speed limit when approaching/traversing intersections
});

/**
 * Represents a directed lane in the road network graph.
 */
export class Lane {
    constructor(id, roadId, fromNodeId, toNodeId) {
        this.id = id;
        this.roadId = roadId;
        this.fromNodeId = fromNodeId;
        this.toNodeId = toNodeId;
        this.waypoints = [];     // Array of { x, z, yaw, laneId, index, speedLimit, s }
        this.length = 0;         // Total length in meters
        this.speedLimit = ROAD_CONFIG.DEFAULT_SPEED_LIMIT;
        this.nextLanes = [];     // Successor lane IDs
        this.prevLanes = [];     // Predecessor lane IDs
        this.isIntersection = false;
    }
}

/**
 * Directed Road Network Manager
 */
export class RoadNetwork {
    constructor() {
        this.config = ROAD_CONFIG;
        this.nodes = new Map();         // nodeId -> { id, x, z, isIntersection, isCorner }
        this.segments = [];             // Array of { id, fromNode, toNode, length, ux, uz, nx, nz, minX, maxX, minZ, maxZ }
        this.lanes = [];                // Array of Lane instances
        this.lanesById = new Map();     // laneId -> Lane
        this.waypoints = [];            // Flat list of all waypoints across all lanes
        this.totalCenterlineLength = 0; // Total length of unique road segments

        this._buildNetworkGraph();
    }

    /**
     * Constructs the perimeter loop + cross grid node/segment/lane graph.
     * Dimensions: [-70, 70] in X and Z.
     * Total road centerline extent: exactly 1,220 meters.
     */
    _buildNetworkGraph() {
        // -------------------------------------------------------------
        // 1. Define Graph Nodes (21 total nodes)
        // -------------------------------------------------------------
        const nodeDefs = [
            // Perimeter corners
            { id: 'NW', x: -70, z: 70, isCorner: true },
            { id: 'NE', x: 70, z: 70, isCorner: true },
            { id: 'SE', x: 70, z: -70, isCorner: true },
            { id: 'SW', x: -70, z: -70, isCorner: true },

            // Perimeter T-junctions
            { id: 'N_W', x: -25, z: 70, isIntersection: true },
            { id: 'N_E', x: 25, z: 70, isIntersection: true },
            { id: 'S_W', x: -25, z: -70, isIntersection: true },
            { id: 'S_E', x: 25, z: -70, isIntersection: true },
            { id: 'W_S', x: -70, z: -25, isIntersection: true },
            { id: 'W_N', x: -70, z: 25, isIntersection: true },
            { id: 'E_S', x: 70, z: -25, isIntersection: true },
            { id: 'E_N', x: 70, z: 25, isIntersection: true },

            // Interior 4-way intersections
            { id: 'INT_SW', x: -25, z: -25, isIntersection: true },
            { id: 'INT_SE', x: 25, z: -25, isIntersection: true },
            { id: 'INT_NW', x: -25, z: 25, isIntersection: true },
            { id: 'INT_NE', x: 25, z: 25, isIntersection: true },

            // Central cross T-junctions
            { id: 'C_W', x: -25, z: 0, isIntersection: true },
            { id: 'C_E', x: 25, z: 0, isIntersection: true },
            { id: 'C_S', x: 0, z: -25, isIntersection: true },
            { id: 'C_N', x: 0, z: 25, isIntersection: true },

            // Center 4-way intersection (player spawn plaza)
            { id: 'CENTER', x: 0, z: 0, isIntersection: true }
        ];

        for (const n of nodeDefs) {
            this.nodes.set(n.id, {
                id: n.id,
                x: n.x,
                z: n.z,
                isIntersection: !!n.isIntersection,
                isCorner: !!n.isCorner,
                connectedSegments: []
            });
        }

        // -------------------------------------------------------------
        // 2. Define Road Segments (32 bidirectional segments)
        // -------------------------------------------------------------
        const segmentDefs = [
            // North perimeter (140m total)
            ['NW', 'N_W'], ['N_W', 'N_E'], ['N_E', 'NE'],
            // South perimeter (140m total)
            ['SW', 'S_W'], ['S_W', 'S_E'], ['S_E', 'SE'],
            // West perimeter (140m total)
            ['SW', 'W_S'], ['W_S', 'W_N'], ['W_N', 'NW'],
            // East perimeter (140m total)
            ['SE', 'E_S'], ['E_S', 'E_N'], ['E_N', 'NE'],

            // West N-S Avenue (X = -25, 140m total)
            ['S_W', 'INT_SW'], ['INT_SW', 'C_W'], ['C_W', 'INT_NW'], ['INT_NW', 'N_W'],
            // East N-S Avenue (X = 25, 140m total)
            ['S_E', 'INT_SE'], ['INT_SE', 'C_E'], ['C_E', 'INT_NE'], ['INT_NE', 'N_E'],
            // South E-W Avenue (Z = -25, 140m total)
            ['W_S', 'INT_SW'], ['INT_SW', 'C_S'], ['C_S', 'INT_SE'], ['INT_SE', 'E_S'],
            // North E-W Avenue (Z = 25, 140m total)
            ['W_N', 'INT_NW'], ['INT_NW', 'C_N'], ['C_N', 'INT_NE'], ['INT_NE', 'E_N'],

            // Central N-S Street (X = 0, 50m total)
            ['C_S', 'CENTER'], ['CENTER', 'C_N'],
            // Central E-W Street (Z = 0, 50m total)
            ['C_W', 'CENTER'], ['CENTER', 'C_E']
        ];

        this.totalCenterlineLength = 0;
        let segIdx = 0;

        for (const [fromId, toId] of segmentDefs) {
            const nA = this.nodes.get(fromId);
            const nB = this.nodes.get(toId);
            if (!nA || !nB) continue;

            const dx = nB.x - nA.x;
            const dz = nB.z - nA.z;
            const length = Math.hypot(dx, dz);
            const ux = dx / length;
            const uz = dz / length;
            // Right-hand normal: rotate direction 90 deg clockwise in 2D (Z-down)
            // (ux, uz) -> (-uz, ux)
            const nx = -uz;
            const nz = ux;

            const seg = {
                id: `seg_${segIdx++}_${fromId}_${toId}`,
                fromNode: nA,
                toNode: nB,
                length,
                ux, uz,
                nx, nz,
                // Bounding box with clearance allowance
                minX: Math.min(nA.x, nB.x),
                maxX: Math.max(nA.x, nB.x),
                minZ: Math.min(nA.z, nB.z),
                maxZ: Math.max(nA.z, nB.z)
            };

            this.segments.push(seg);
            nA.connectedSegments.push(seg);
            nB.connectedSegments.push(seg);
            this.totalCenterlineLength += length;

            // Create dual directed lanes
            // Lane A->B (Forward, offset to right +1.8m)
            const laneAB = this._createLane(seg, nA, nB, +1.8, `${seg.id}_fwd`);
            // Lane B->A (Backward, offset to right +1.8m relative to B->A, which is -1.8m relative to A->B)
            const laneBA = this._createLane(seg, nB, nA, -1.8, `${seg.id}_rev`);

            this.lanes.push(laneAB, laneBA);
            this.lanesById.set(laneAB.id, laneAB);
            this.lanesById.set(laneBA.id, laneBA);
        }

        // -------------------------------------------------------------
        // 3. Connect Lane Successors at Nodes
        // -------------------------------------------------------------
        this._connectLaneSuccessors();
    }

    /**
     * Generates waypoints along a directed lane.
     */
    _createLane(segment, fromNode, toNode, normalOffset, laneId) {
        const lane = new Lane(laneId, segment.id, fromNode.id, toNode.id);
        const length = segment.length;
        lane.length = length;

        const isForward = (fromNode.id === segment.fromNode.id);
        const dirX = isForward ? segment.ux : -segment.ux;
        const dirZ = isForward ? segment.uz : -segment.uz;
        const yaw = Math.atan2(-dirX, -dirZ); // Three.js camera/vehicle yaw convention

        // Number of waypoint steps
        const step = ROAD_CONFIG.WAYPOINT_STEP;
        const count = Math.max(2, Math.ceil(length / step) + 1);

        for (let i = 0; i < count; i++) {
            const t = Math.min(1.0, (i * step) / length);
            const s = t * length;

            // Base position on centerline
            const baseX = isForward
                ? segment.fromNode.x + t * (segment.toNode.x - segment.fromNode.x)
                : segment.toNode.x + t * (segment.fromNode.x - segment.toNode.x);
            const baseZ = isForward
                ? segment.fromNode.z + t * (segment.toNode.z - segment.fromNode.z)
                : segment.toNode.z + t * (segment.fromNode.z - segment.toNode.z);

            // Apply lateral offset (+1.8m to the right of travel direction)
            // If forward: offset along (segment.nx, segment.nz) * normalOffset
            // If backward: normalOffset was passed as -1.8, offset along (segment.nx, segment.nz) * -1.8
            const wpX = baseX + segment.nx * normalOffset;
            const wpZ = baseZ + segment.nz * normalOffset;

            // Slow down near intersections
            const distFromStart = s;
            const distFromEnd = length - s;
            const nearJunction = (toNode.isIntersection && distFromEnd < 8.0) || (fromNode.isIntersection && distFromStart < 8.0);
            const speedLimit = nearJunction ? ROAD_CONFIG.INTERSECTION_SPEED_LIMIT : ROAD_CONFIG.DEFAULT_SPEED_LIMIT;

            const wp = {
                x: wpX,
                z: wpZ,
                yaw,
                laneId: lane.id,
                index: i,
                speedLimit,
                s
            };

            lane.waypoints.push(wp);
            this.waypoints.push(wp);

            if (t >= 1.0) break;
        }

        return lane;
    }

    /**
     * Connects departing lanes to incoming lanes at intersections/corners.
     * Prevents immediate U-turns.
     */
    _connectLaneSuccessors() {
        for (const laneIn of this.lanes) {
            const junctionNodeId = laneIn.toNodeId;

            for (const laneOut of this.lanes) {
                // Must depart from the junction node that laneIn arrives at
                if (laneOut.fromNodeId !== junctionNodeId) continue;

                // Forbid immediate U-turn (do not return straight back to where we came from)
                if (laneOut.toNodeId === laneIn.fromNodeId) continue;

                laneIn.nextLanes.push(laneOut.id);
                laneOut.prevLanes.push(laneIn.id);
            }

            // Fallback for isolated single-segment endpoints (if any)
            if (laneIn.nextLanes.length === 0) {
                for (const laneOut of this.lanes) {
                    if (laneOut.fromNodeId === junctionNodeId) {
                        laneIn.nextLanes.push(laneOut.id);
                        break;
                    }
                }
            }
        }
    }

    /**
     * Checks if a world coordinate (x, z) is within clearance distance of any road surface.
     * Used by generateWorld() to ensure trees and rocks never spawn on or near roadways.
     * 
     * @param {number} x World X coordinate
     * @param {number} z World Z coordinate
     * @param {number} clearance Additional margin beyond road half-width (default 5.0m)
     * @returns {boolean} True if within road corridor
     */
    isNearRoad(x, z, clearance = ROAD_CONFIG.DEFAULT_CLEARANCE) {
        const threshold = ROAD_CONFIG.HALF_WIDTH + clearance; // e.g. 4.0 + 5.0 = 9.0m
        const thresholdSq = threshold * threshold;

        for (let i = 0; i < this.segments.length; i++) {
            const seg = this.segments[i];

            // Fast AABB bounding check
            if (x < seg.minX - threshold || x > seg.maxX + threshold ||
                z < seg.minZ - threshold || z > seg.maxZ + threshold) {
                continue;
            }

            // Point-to-segment squared distance
            const ax = seg.fromNode.x;
            const az = seg.fromNode.z;
            const bx = seg.toNode.x;
            const bz = seg.toNode.z;

            const dx = bx - ax;
            const dz = bz - az;
            const segLenSq = dx * dx + dz * dz;

            if (segLenSq === 0) continue;

            // Project query point onto line segment
            let t = ((x - ax) * dx + (z - az) * dz) / segLenSq;
            t = Math.max(0, Math.min(1, t));

            const projX = ax + t * dx;
            const projZ = az + t * dz;

            const distSq = (x - projX) * (x - projX) + (z - projZ) * (z - projZ);
            if (distSq < thresholdSq) {
                return true;
            }
        }

        return false;
    }

    /**
     * Finds the nearest waypoint across all lanes in the network.
     * 
     * @param {number} x Query X
     * @param {number} z Query Z
     * @returns {{ x: number, z: number, yaw: number, laneId: string, index: number, distance: number }}
     */
    getNearestWaypoint(x, z) {
        let nearest = null;
        let minDistSq = Infinity;

        for (let i = 0; i < this.waypoints.length; i++) {
            const wp = this.waypoints[i];
            const dx = wp.x - x;
            const dz = wp.z - z;
            const dSq = dx * dx + dz * dz;
            if (dSq < minDistSq) {
                minDistSq = dSq;
                nearest = wp;
            }
        }

        if (!nearest) {
            return { x: 0, z: 0, yaw: 0, laneId: '', index: 0, distance: 0 };
        }

        return {
            x: nearest.x,
            z: nearest.z,
            yaw: nearest.yaw,
            laneId: nearest.laneId,
            index: nearest.index,
            distance: Math.sqrt(minDistSq)
        };
    }

    /**
     * Traverses along a lane's waypoints by lookaheadDist for Pure Pursuit steering.
     * Smoothly transitions into successor lanes at intersections.
     * 
     * @param {string} laneId Current lane identifier
     * @param {number} currentIndex Current waypoint index
     * @param {number} lookaheadDist Desired lookahead distance in meters (e.g. 6.0m - 10.0m)
     * @returns {{ x: number, z: number, yaw: number, laneId: string, index: number }}
     */
    getLookaheadWaypoint(laneId, currentIndex, lookaheadDist = 8.0) {
        let lane = this.lanesById.get(laneId);
        if (!lane || lane.waypoints.length === 0) {
            return this.getNearestWaypoint(0, 0);
        }

        let currIdx = Math.max(0, Math.min(lane.waypoints.length - 1, currentIndex));
        let accumulated = 0;
        let safetyCounter = 0;

        while (accumulated < lookaheadDist && safetyCounter++ < 50) {
            if (currIdx + 1 < lane.waypoints.length) {
                const p1 = lane.waypoints[currIdx];
                const p2 = lane.waypoints[currIdx + 1];
                const segDist = Math.hypot(p2.x - p1.x, p2.z - p1.z);

                if (accumulated + segDist >= lookaheadDist) {
                    const remain = lookaheadDist - accumulated;
                    const alpha = segDist > 0 ? (remain / segDist) : 0;
                    return {
                        x: p1.x + alpha * (p2.x - p1.x),
                        z: p1.z + alpha * (p2.z - p1.z),
                        yaw: p2.yaw,
                        laneId: lane.id,
                        index: currIdx + 1
                    };
                }

                accumulated += segDist;
                currIdx++;
            } else {
                // Reached end of current lane, transition to a connected successor lane
                if (!lane.nextLanes || lane.nextLanes.length === 0) {
                    const lastWp = lane.waypoints[lane.waypoints.length - 1];
                    return { x: lastWp.x, z: lastWp.z, yaw: lastWp.yaw, laneId: lane.id, index: currIdx };
                }

                // Deterministically take first successor lane
                const nextLaneId = lane.nextLanes[0];
                const nextLane = this.lanesById.get(nextLaneId);
                if (!nextLane || nextLane.waypoints.length === 0) {
                    const lastWp = lane.waypoints[lane.waypoints.length - 1];
                    return { x: lastWp.x, z: lastWp.z, yaw: lastWp.yaw, laneId: lane.id, index: currIdx };
                }

                lane = nextLane;
                currIdx = 0;
            }
        }

        const wp = lane.waypoints[currIdx];
        return { x: wp.x, z: wp.z, yaw: wp.yaw, laneId: lane.id, index: currIdx };
    }

    /**
     * Distributes collision-spaced spawn points across the road network.
     * Avoids placing vehicles inside intersections (yellow-box clearance).
     * 
     * @param {number} count Number of spawn points requested (e.g. 50)
     * @param {number} minSpacing Minimum distance between any two spawn points (default 15.0m)
     * @returns {Array<{ x: number, z: number, yaw: number, laneId: string, index: number }>}
     */
    getSpawnPoints(count = 50, minSpacing = 12.0) {
        const spawns = [];
        const minSpacingSq = minSpacing * minSpacing;

        // Collect all viable candidate waypoints away from intersection centers
        const candidates = [];
        for (const lane of this.lanes) {
            for (let i = 1; i < lane.waypoints.length - 1; i++) {
                const wp = lane.waypoints[i];

                // Check distance to intersection nodes
                let inJunction = false;
                for (const node of this.nodes.values()) {
                    if (node.isIntersection) {
                        const dSq = (wp.x - node.x) * (wp.x - node.x) + (wp.z - node.z) * (wp.z - node.z);
                        if (dSq < 5.0 * 5.0) {
                            inJunction = true;
                            break;
                        }
                    }
                }

                if (!inJunction) {
                    candidates.push(wp);
                }
            }
        }

        // Evenly sample across candidates to distribute throughout the network
        // Stride sampling with full fallback pass
        const stride = 7; // Coprime with most lengths
        const visited = new Uint8Array(candidates.length);

        for (let pass = 0; pass < 2 && spawns.length < count; pass++) {
            for (let iter = 0; iter < candidates.length && spawns.length < count; iter++) {
                const idx = pass === 0 ? (iter * stride) % candidates.length : iter;
                if (visited[idx]) continue;
                visited[idx] = 1;

                const cand = candidates[idx];

                // Verify minimum spacing from already selected spawn points
                let tooClose = false;
                for (let s = 0; s < spawns.length; s++) {
                    const sp = spawns[s];
                    const dSq = (cand.x - sp.x) * (cand.x - sp.x) + (cand.z - sp.z) * (cand.z - sp.z);
                    if (dSq < minSpacingSq) {
                        tooClose = true;
                        break;
                    }
                }

                if (!tooClose) {
                    spawns.push({
                        x: cand.x,
                        z: cand.z,
                        yaw: cand.yaw,
                        laneId: cand.laneId,
                        index: cand.index
                    });
                }
            }
        }

        return spawns;
    }

    /**
     * Returns all lanes in the network.
     */
    getAllLanes() {
        return this.lanes;
    }

    /**
     * Retrieves a lane by ID.
     */
    getLane(laneId) {
        return this.lanesById.get(laneId) || null;
    }

    /**
     * Procedurally constructs and renders road surface geometry into the Three.js scene.
     * Batches all asphalt quads into 1 mesh and all markings into 1 mesh (2 draw calls total).
     * 
     * @param {THREE.Scene} scene Three.js scene
     * @param {Object} THREE Three.js library instance
     */
    init(scene, THREE) {
        if (!scene || !THREE) {
            console.warn('[RoadNetwork] Scene or THREE not provided to init()');
            return;
        }

        const asphaltPositions = [];
        const asphaltNormals = [];
        const asphaltIndices = [];

        const markingPositions = [];
        const markingNormals = [];
        const markingIndices = [];

        let asphaltVertexOffset = 0;
        let markingVertexOffset = 0;

        const hw = ROAD_CONFIG.HALF_WIDTH;
        const yRoad = ROAD_CONFIG.ELEVATION_ROAD;
        const yMarkings = ROAD_CONFIG.ELEVATION_MARKINGS;

        // -------------------------------------------------------------
        // 1. Build Asphalt Road Segments
        // -------------------------------------------------------------
        for (const seg of this.segments) {
            const ax = seg.fromNode.x;
            const az = seg.fromNode.z;
            const bx = seg.toNode.x;
            const bz = seg.toNode.z;

            // 4 corners of asphalt quad
            const p1x = ax + seg.nx * hw;
            const p1z = az + seg.nz * hw;

            const p2x = ax - seg.nx * hw;
            const p2z = az - seg.nz * hw;

            const p3x = bx - seg.nx * hw;
            const p3z = bz - seg.nz * hw;

            const p4x = bx + seg.nx * hw;
            const p4z = bz + seg.nz * hw;

            asphaltPositions.push(
                p1x, yRoad, p1z,
                p2x, yRoad, p2z,
                p3x, yRoad, p3z,
                p4x, yRoad, p4z
            );

            asphaltNormals.push(
                0, 1, 0,
                0, 1, 0,
                0, 1, 0,
                0, 1, 0
            );

            asphaltIndices.push(
                asphaltVertexOffset, asphaltVertexOffset + 1, asphaltVertexOffset + 2,
                asphaltVertexOffset, asphaltVertexOffset + 2, asphaltVertexOffset + 3
            );
            asphaltVertexOffset += 4;

            // ---------------------------------------------------------
            // 2. Dashed Yellow Centerline Markings
            // ---------------------------------------------------------
            const dashLen = ROAD_CONFIG.DASH_LENGTH;
            const dashGap = ROAD_CONFIG.DASH_GAP;
            const dashHw = ROAD_CONFIG.DASH_WIDTH / 2;
            const cycle = dashLen + dashGap;

            // Stop dashed markings 4.0m before intersections
            const startDist = seg.fromNode.isIntersection ? 4.0 : 0.5;
            const endDist = seg.toNode.isIntersection ? (seg.length - 4.0) : (seg.length - 0.5);

            for (let d = startDist; d + dashLen <= endDist; d += cycle) {
                const t1 = d / seg.length;
                const t2 = (d + dashLen) / seg.length;

                const c1x = ax + t1 * (bx - ax);
                const c1z = az + t1 * (bz - az);
                const c2x = ax + t2 * (bx - ax);
                const c2z = az + t2 * (bz - az);

                const m1x = c1x + seg.nx * dashHw;
                const m1z = c1z + seg.nz * dashHw;
                const m2x = c1x - seg.nx * dashHw;
                const m2z = c1z - seg.nz * dashHw;
                const m3x = c2x - seg.nx * dashHw;
                const m3z = c2z - seg.nz * dashHw;
                const m4x = c2x + seg.nx * dashHw;
                const m4z = c2z + seg.nz * dashHw;

                markingPositions.push(
                    m1x, yMarkings, m1z,
                    m2x, yMarkings, m2z,
                    m3x, yMarkings, m3z,
                    m4x, yMarkings, m4z
                );

                markingNormals.push(
                    0, 1, 0,
                    0, 1, 0,
                    0, 1, 0,
                    0, 1, 0
                );

                markingIndices.push(
                    markingVertexOffset, markingVertexOffset + 1, markingVertexOffset + 2,
                    markingVertexOffset, markingVertexOffset + 2, markingVertexOffset + 3
                );
                markingVertexOffset += 4;
            }
        }

        // -------------------------------------------------------------
        // 3. Build Intersection Sealing Patches
        // -------------------------------------------------------------
        for (const node of this.nodes.values()) {
            if (!node.isIntersection && !node.isCorner) continue;

            const patchHw = hw;
            const cx = node.x;
            const cz = node.z;

            asphaltPositions.push(
                cx - patchHw, yRoad, cz - patchHw,
                cx + patchHw, yRoad, cz - patchHw,
                cx + patchHw, yRoad, cz + patchHw,
                cx - patchHw, yRoad, cz + patchHw
            );

            asphaltNormals.push(
                0, 1, 0,
                0, 1, 0,
                0, 1, 0,
                0, 1, 0
            );

            asphaltIndices.push(
                asphaltVertexOffset, asphaltVertexOffset + 1, asphaltVertexOffset + 2,
                asphaltVertexOffset, asphaltVertexOffset + 2, asphaltVertexOffset + 3
            );
            asphaltVertexOffset += 4;
        }

        // -------------------------------------------------------------
        // 4. Assemble Three.js BufferGeometries and Meshes
        // -------------------------------------------------------------
        const asphaltGeo = new THREE.BufferGeometry();
        asphaltGeo.setAttribute('position', new THREE.Float32BufferAttribute(asphaltPositions, 3));
        asphaltGeo.setAttribute('normal', new THREE.Float32BufferAttribute(asphaltNormals, 3));
        asphaltGeo.setIndex(asphaltIndices);

        const asphaltMat = new THREE.MeshLambertMaterial({
            color: ROAD_CONFIG.COLOR_ASPHALT,
            roughness: 0.8
        });

        const asphaltMesh = new THREE.Mesh(asphaltGeo, asphaltMat);
        asphaltMesh.name = 'road_asphalt_mesh';
        asphaltMesh.receiveShadow = false;
        scene.add(asphaltMesh);

        if (markingPositions.length > 0) {
            const markingGeo = new THREE.BufferGeometry();
            markingGeo.setAttribute('position', new THREE.Float32BufferAttribute(markingPositions, 3));
            markingGeo.setAttribute('normal', new THREE.Float32BufferAttribute(markingNormals, 3));
            markingGeo.setIndex(markingIndices);

            const markingMat = new THREE.MeshBasicMaterial({
                color: ROAD_CONFIG.COLOR_MARKINGS,
                side: THREE.DoubleSide
            });

            const markingsMesh = new THREE.Mesh(markingGeo, markingMat);
            markingsMesh.name = 'road_markings_mesh';
            markingsMesh.receiveShadow = false;
            scene.add(markingsMesh);
        }
    }
}
