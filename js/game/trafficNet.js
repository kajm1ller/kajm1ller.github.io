/**
 * js/game/trafficNet.js
 *
 * Driving geometry and right-of-way for AI traffic, built on top of the lane graph:
 * - Drive paths: each lane cut back to a stop line short of the junction it runs into.
 * - Connectors: smooth turn paths (cubic Béziers) through a junction from one lane's stop line to
 *   the start of the next lane, classified as straight / left / right / U-turn, with lazily cached
 *   pairwise conflicts (paths that cross or merge into the same lane).
 * - Junction control from OSM: traffic signals (neighbouring signalized nodes, e.g. the two halves
 *   of a divided-road crossing, share one controller and phase clock), all-way stops, and stop
 *   signs on individual approaches. Junctions without either give way by street class.
 *
 * Car local space: forward is (-sin yaw, -cos yaw); the right of travel direction (ux, uz) is
 * (-uz, ux).
 */

export const NET_CONFIG = Object.freeze({
    CAR_LENGTH: 4.5,
    JUNCTION_MIN_RADIUS: 4.5,
    JUNCTION_MAX_RADIUS: 14.0,
    JUNCTION_MARGIN: 1.2,       // stop line this far back from the crossing street's edge
    SPLIT_TRIM: 2.0,            // lanes are cut back this much where a street just continues (degree 2)
    DEAD_END_TRIM: 3.0,
    CONFLICT_CLEARANCE: 2.3,    // turn paths closer than this conflict
    SIGNAL_CLUSTER_RADIUS: 35.0,
    // Signal cycle: green A, yellow A, all red, green B, yellow B, all red
    SIGNAL_GREEN: 16.0,
    SIGNAL_YELLOW: 3.5,
    SIGNAL_ALL_RED: 2.0
});

export const LIGHT = Object.freeze({ RED: 0, YELLOW: 1, GREEN: 2 });

/** Polyline with cumulative arc length. */
export class DrivePath {
    constructor(xs, zs) {
        const n = xs.length;
        this.x = Float32Array.from(xs);
        this.z = Float32Array.from(zs);
        this.s = new Float32Array(n);
        for (let i = 1; i < n; i++) this.s[i] = this.s[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
        this.len = n > 0 ? this.s[n - 1] : 0;
    }

    /** Point and unit direction at arc length s (clamped); out = { x, z, dx, dz }. */
    sample(s, out) {
        const n = this.x.length;
        if (n < 2 || this.len <= 0) {
            out.x = n ? this.x[0] : 0;
            out.z = n ? this.z[0] : 0;
            if (out.dx === undefined) { out.dx = 0; out.dz = -1; }
            return out;
        }
        if (s <= 0) s = 0;
        else if (s >= this.len) s = this.len;
        // Binary search for the segment containing s
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (this.s[mid] <= s) lo = mid;
            else hi = mid;
        }
        // Skip zero-length segments for the direction
        let a = lo, b = lo + 1;
        while (b < n - 1 && this.s[b] - this.s[a] < 1e-4) b++;
        while (a > 0 && this.s[b] - this.s[a] < 1e-4) a--;
        const segLen = this.s[b] - this.s[a];
        const t = segLen > 1e-4 ? (s - this.s[a]) / segLen : 0;
        const dx = this.x[b] - this.x[a], dz = this.z[b] - this.z[a];
        out.x = this.x[a] + dx * t;
        out.z = this.z[a] + dz * t;
        if (segLen > 1e-4) {
            out.dx = dx / segLen;
            out.dz = dz / segLen;
        }
        return out;
    }
}

function segSegDist(ax, az, bx, bz, cx, cz, dx, dz) {
    // Proper intersection -> 0
    const r1 = bx - ax, s1 = bz - az, r2 = dx - cx, s2 = dz - cz;
    const den = r1 * s2 - s1 * r2;
    if (Math.abs(den) > 1e-9) {
        const t = ((cx - ax) * s2 - (cz - az) * r2) / den;
        const u = ((cx - ax) * s1 - (cz - az) * r1) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
    }
    const pd = (px, pz, qx, qz, wx, wz) => {
        const vx = wx - qx, vz = wz - qz;
        const l2 = vx * vx + vz * vz;
        let t = l2 > 0 ? ((px - qx) * vx + (pz - qz) * vz) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (qx + vx * t), pz - (qz + vz * t));
    };
    return Math.min(pd(ax, az, cx, cz, dx, dz), pd(bx, bz, cx, cz, dx, dz), pd(cx, cz, ax, az, bx, bz), pd(dx, dz, ax, az, bx, bz));
}

const _p = { x: 0, z: 0, dx: 0, dz: -1 };

export class TrafficNet {
    /**
     * @param {Object} roadNetwork OSMRoadNetwork (lanes with startNode / endNode from the city nav)
     */
    constructor(roadNetwork) {
        this.roadNetwork = roadNetwork;
        const nav = roadNetwork.cityNav || null;
        this.pieces = new Map();      // lane id -> lane piece
        this.junctions = new Map();   // road node id -> junction
        this.connectors = new Map();  // `${from}>${to}` -> connector piece
        this.signals = [];            // signal controllers
        this.time = 0;

        const lanes = roadNetwork.lanes || [];
        // Junctions (any lane end with a node id)
        for (const lane of lanes) {
            if (lane.endNode === undefined) continue;
            this._junction(lane.endNode, lane.endX, lane.endZ, lane.endDegree).inLanes.push(lane);
            if (lane.waypoints.length) {
                const w0 = lane.waypoints[0];
                const j = this._junction(lane.startNode, nav ? nav.roadNodeX[lane.startNode] : w0.x,
                    nav ? nav.roadNodeZ[lane.startNode] : w0.z, lane.startDegree);
                j.outLanes.push(lane);
            }
        }
        for (const j of this.junctions.values()) {
            let w = 0;
            for (const l of j.inLanes) w = Math.max(w, l.halfWidth || 4);
            for (const l of j.outLanes) w = Math.max(w, l.halfWidth || 4);
            j.radius = j.degree >= 3
                ? Math.max(NET_CONFIG.JUNCTION_MIN_RADIUS, Math.min(NET_CONFIG.JUNCTION_MAX_RADIUS, w + NET_CONFIG.JUNCTION_MARGIN))
                : (j.degree <= 1 ? NET_CONFIG.DEAD_END_TRIM : NET_CONFIG.SPLIT_TRIM);
        }

        // Lane pieces: lanes trimmed back to their stop lines
        for (const lane of lanes) {
            if (!lane.waypoints || lane.waypoints.length < 2) continue;
            this.pieces.set(lane.id, this._buildLanePiece(lane));
        }

        this._setupControl(nav);
    }

    _junction(id, x, z, degree) {
        let j = this.junctions.get(id);
        if (!j) {
            j = {
                id, x, z,
                degree: degree || 0,
                radius: 0,
                inLanes: [],
                outLanes: [],
                control: 'none',      // 'none' | 'signal' | 'allway'
                signal: null,
                occupants: [],        // agents committed to a connector through this junction
                queue: []             // agents stopped at a stop sign, in arrival order
            };
            this.junctions.set(id, j);
        }
        return j;
    }

    _buildLanePiece(lane) {
        const wps = lane.waypoints;
        const n = wps.length;
        const cum = new Float32Array(n);
        for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(wps[i].x - wps[i - 1].x, wps[i].z - wps[i - 1].z);
        const total = cum[n - 1];
        const startJ = lane.startNode !== undefined ? this.junctions.get(lane.startNode) : null;
        const endJ = lane.endNode !== undefined ? this.junctions.get(lane.endNode) : null;
        let t0 = startJ ? startJ.radius : 0;
        let t1 = endJ ? endJ.radius : 0;
        // Short lanes (e.g. between the two halves of a divided-road crossing) keep at least 1 m
        if (t0 + t1 > total - 1) {
            const k = Math.max(0, total - 1) / Math.max(1e-3, t0 + t1);
            t0 *= k;
            t1 *= k;
        }
        const xs = [], zs = [];
        const at = (s) => {
            let i = 0;
            while (i < n - 2 && cum[i + 1] < s) i++;
            const L = cum[i + 1] - cum[i];
            const t = L > 1e-6 ? (s - cum[i]) / L : 0;
            xs.push(wps[i].x + (wps[i + 1].x - wps[i].x) * t);
            zs.push(wps[i].z + (wps[i + 1].z - wps[i].z) * t);
        };
        at(t0);
        for (let i = 0; i < n; i++) {
            if (cum[i] > t0 + 0.05 && cum[i] < total - t1 - 0.05) {
                xs.push(wps[i].x);
                zs.push(wps[i].z);
            }
        }
        at(total - t1);
        const path = new DrivePath(xs, zs);
        const junction = endJ && endJ.degree >= 3 ? endJ : null;
        return {
            kind: 'lane',
            key: lane.id,
            lane,
            path,
            len: path.len,
            trimStart: t0,
            wpS: cum,                 // arc length of each lane waypoint (spawn points are waypoints)
            junction,                 // junction this lane's stop line is at (null: none)
            stopSign: false,
            yieldMinor: false,        // gives way to bigger streets at an uncontrolled junction
            signalGroup: -1,
            rank: (lane.spawnWeight || 1) * 10 + (lane.speedLimit || 10) * 0.1,
            occ: []                   // agents on this piece this frame
        };
    }

    lanePiece(laneId) {
        return this.pieces.get(laneId) || null;
    }

    /** Arc length on a lane's drive path of the lane's waypoint `index`. */
    driveS(piece, index) {
        const i = Math.max(0, Math.min(piece.wpS.length - 1, index | 0));
        return Math.max(0, Math.min(piece.len, piece.wpS[i] - piece.trimStart));
    }

    /** Turn path from `fromPiece`'s stop line to the start of `toPiece`. */
    connector(fromPiece, toPiece) {
        const key = `${fromPiece.key}>${toPiece.key}`;
        let c = this.connectors.get(key);
        if (c) return c;
        const a = fromPiece.path, b = toPiece.path;
        const n0 = a.x.length;
        a.sample(a.len, _p);
        const p0x = _p.x, p0z = _p.z, tax = _p.dx, taz = _p.dz;
        b.sample(0, _p);
        const p3x = _p.x, p3z = _p.z, tbx = _p.dx, tbz = _p.dz;
        const dist = Math.hypot(p3x - p0x, p3z - p0z);
        const dot = tax * tbx + taz * tbz;
        const cross = tax * tbz - taz * tbx; // > 0: turning right
        let turn;
        if (dot < -0.7) turn = 'uturn';
        else if (Math.abs(Math.atan2(cross, dot)) < 0.5) turn = 'straight';
        else turn = cross > 0 ? 'right' : 'left';
        const d = turn === 'uturn' ? Math.max(2.5, dist * 0.8) : dist * 0.42;
        const p1x = p0x + tax * d, p1z = p0z + taz * d;
        const p2x = p3x - tbx * d, p2z = p3z - tbz * d;
        const steps = Math.max(3, Math.ceil((dist + d) / 1.5));
        const xs = [], zs = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps, u = 1 - t;
            const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
            xs.push(w0 * p0x + w1 * p1x + w2 * p2x + w3 * p3x);
            zs.push(w0 * p0z + w1 * p1z + w2 * p2z + w3 * p3z);
        }
        const path = new DrivePath(xs, zs);
        // Comfortable cornering speed from the sharpest bend (lateral acceleration ~2.6 m/s^2)
        let maxK = 0;
        for (let i = 1; i + 1 < xs.length; i++) {
            const h1 = Math.atan2(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
            const h2 = Math.atan2(xs[i + 1] - xs[i], zs[i + 1] - zs[i]);
            let dh = h2 - h1;
            while (dh > Math.PI) dh -= Math.PI * 2;
            while (dh < -Math.PI) dh += Math.PI * 2;
            const ds = (path.s[i + 1] - path.s[i - 1]) * 0.5;
            if (ds > 1e-3) maxK = Math.max(maxK, Math.abs(dh) / ds);
        }
        c = {
            kind: 'conn',
            key,
            from: fromPiece,
            to: toPiece,
            junction: fromPiece.junction,
            turn,
            path,
            len: path.len,
            maxSpeed: maxK > 1e-3 ? Math.max(3.0, Math.sqrt(2.6 / maxK)) : 99,
            conflicts: new Map(),
            occ: []
        };
        this.connectors.set(key, c);
        return c;
    }

    /** Whether two turn paths through the same junction can't be driven at the same time. */
    conflicts(c1, c2) {
        if (c1 === c2 || c1.from === c2.from) return false; // same approach: plain car following
        if (c1.to === c2.to) return true;                   // merging into the same lane
        let r = c1.conflicts.get(c2.key);
        if (r !== undefined) return r;
        r = false;
        const a = c1.path, b = c2.path;
        const clr = NET_CONFIG.CONFLICT_CLEARANCE;
        for (let i = 0; i + 1 < a.x.length && !r; i++) {
            for (let k = 0; k + 1 < b.x.length; k++) {
                if (segSegDist(a.x[i], a.z[i], a.x[i + 1], a.z[i + 1], b.x[k], b.z[k], b.x[k + 1], b.z[k + 1]) < clr) {
                    r = true;
                    break;
                }
            }
        }
        c1.conflicts.set(c2.key, r);
        c2.conflicts.set(c1.key, r);
        return r;
    }

    _setupControl(nav) {
        const lanePieceOf = (id) => this.pieces.get(id);
        // Signals: neighbouring signalized junctions share one controller
        const sigNodes = nav ? [...nav.signalNodes].filter((id) => {
            const j = this.junctions.get(id);
            return j && j.degree >= 3;
        }) : [];
        const assigned = new Set();
        for (const id of sigNodes) {
            if (assigned.has(id)) continue;
            const cluster = [id];
            assigned.add(id);
            for (let k = 0; k < cluster.length; k++) {
                const a = this.junctions.get(cluster[k]);
                for (const other of sigNodes) {
                    if (assigned.has(other)) continue;
                    const b = this.junctions.get(other);
                    if (Math.hypot(a.x - b.x, a.z - b.z) < NET_CONFIG.SIGNAL_CLUSTER_RADIUS) {
                        assigned.add(other);
                        cluster.push(other);
                    }
                }
            }
            const nodes = new Set(cluster);
            // Phase axis: along the busiest street into the cluster
            let best = null;
            for (const nid of cluster) {
                for (const lane of this.junctions.get(nid).inLanes) {
                    const p = lanePieceOf(lane.id);
                    if (p && (!best || p.rank > best.rank)) best = p;
                }
            }
            if (!best) continue;
            best.path.sample(best.len, _p);
            const ctrl = {
                nodes,
                axisX: _p.dx,
                axisZ: _p.dz,
                // Spread phase starts so neighbouring signals don't all change together
                offset: ((id * 2654435761) >>> 0) % 1000 / 1000 * 41,
                cycle: 2 * (NET_CONFIG.SIGNAL_GREEN + NET_CONFIG.SIGNAL_YELLOW + NET_CONFIG.SIGNAL_ALL_RED),
                x: 0, z: 0
            };
            for (const nid of cluster) {
                const j = this.junctions.get(nid);
                ctrl.x += j.x / cluster.length;
                ctrl.z += j.z / cluster.length;
                j.control = 'signal';
                j.signal = ctrl;
                for (const lane of j.inLanes) {
                    const p = lanePieceOf(lane.id);
                    if (!p || !p.junction) continue;
                    // Lanes inside the cluster (between its nodes) aren't signal controlled
                    if (nodes.has(lane.startNode)) continue;
                    p.path.sample(p.len, _p);
                    p.signalGroup = Math.abs(_p.dx * ctrl.axisX + _p.dz * ctrl.axisZ) >= Math.SQRT1_2 ? 0 : 1;
                }
            }
            this.signals.push(ctrl);
        }

        // All-way stops
        if (nav) {
            for (const id of nav.allWayStopNodes) {
                const j = this.junctions.get(id);
                if (!j || j.degree < 3 || j.control === 'signal') continue;
                j.control = 'allway';
                for (const lane of j.inLanes) {
                    const p = lanePieceOf(lane.id);
                    if (p && p.junction === j) p.stopSign = true;
                }
            }
            // Stop signs on individual approaches
            for (const { road, end } of nav.stopApproaches) {
                const p = lanePieceOf(end === 1 ? `lane_fwd_${road}` : `lane_rev_${road}`);
                if (!p || !p.junction || p.junction.control === 'signal') continue;
                p.stopSign = true;
            }
        }

        // Uncontrolled junctions: smaller streets give way to bigger ones
        for (const j of this.junctions.values()) {
            if (j.degree < 3 || j.control === 'signal') continue;
            let maxRank = 0;
            for (const lane of j.inLanes) {
                const p = lanePieceOf(lane.id);
                if (p) maxRank = Math.max(maxRank, p.rank);
            }
            for (const lane of j.inLanes) {
                const p = lanePieceOf(lane.id);
                if (p && p.junction === j && !p.stopSign && p.rank < maxRank - 0.5) p.yieldMinor = true;
            }
        }
    }

    /** Light shown to an approach in signal group `group` (0 or 1). */
    lightState(ctrl, group) {
        const G = NET_CONFIG.SIGNAL_GREEN, Y = NET_CONFIG.SIGNAL_YELLOW, R = NET_CONFIG.SIGNAL_ALL_RED;
        const half = G + Y + R;
        let t = (this.time + ctrl.offset) % ctrl.cycle;
        const mine = group === 0 ? t < half : t >= half;
        if (!mine) return LIGHT.RED;
        t %= half;
        if (t < G) return LIGHT.GREEN;
        if (t < G + Y) return LIGHT.YELLOW;
        return LIGHT.RED;
    }

    update(dt) {
        this.time += dt;
    }
}
