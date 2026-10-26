/**
 * js/game/cityNav.js
 *
 * City-wide navigation data for Kaj Simulator, baked from the /mapfinal OSM extract by
 * tools/buildCityNav.mjs into js/game/data/cityNav.json:
 * - Drivable street graph (consumed by OSMRoadNetwork to build traffic lanes for the whole map)
 * - Pedestrian graph of sidewalks, footpaths and crosswalks (edges that cross a street are flagged)
 * - Street furniture (lawn chairs, café patio sets, benches), the seats on it, and grassy
 *   hangout spots where groups gather
 *
 * Positions arrive in decimetres and angles in milliradians; everything here is metres/radians.
 */

export const WALK_EDGE = Object.freeze({ PLAIN: 0, CROSSING: 1 });
export const FURNITURE = Object.freeze({ LAWN_CHAIR: 0, PATIO_CHAIR: 1, PATIO_TABLE: 2, BENCH: 3 });

/** Bucketed point index: cell -> list of item indices. */
class PointGrid {
    constructor(cellSize) {
        this.cell = cellSize;
        this.cells = new Map();
    }

    _key(cx, cz) {
        return cx * 73856093 + cz;
    }

    insert(index, x, z) {
        const k = this._key(Math.floor(x / this.cell), Math.floor(z / this.cell));
        let arr = this.cells.get(k);
        if (!arr) {
            arr = [];
            this.cells.set(k, arr);
        }
        arr.push(index);
    }

    /** Calls fn(index) for every item in cells overlapping the square around (x, z). */
    forEachNear(x, z, r, fn) {
        const c = this.cell;
        const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
        const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
        for (let cx = x0; cx <= x1; cx++) {
            for (let cz = z0; cz <= z1; cz++) {
                const arr = this.cells.get(this._key(cx, cz));
                if (!arr) continue;
                for (let i = 0; i < arr.length; i++) fn(arr[i]);
            }
        }
    }
}

/** Minimal binary min-heap keyed by float priority, used by A*. */
class NodeHeap {
    constructor() {
        this.nodes = [];
        this.prios = [];
    }

    get size() {
        return this.nodes.length;
    }

    clear() {
        this.nodes.length = 0;
        this.prios.length = 0;
    }

    push(node, prio) {
        const n = this.nodes, p = this.prios;
        let i = n.length;
        n.push(node);
        p.push(prio);
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (p[parent] <= prio) break;
            n[i] = n[parent];
            p[i] = p[parent];
            i = parent;
        }
        n[i] = node;
        p[i] = prio;
    }

    pop() {
        const n = this.nodes, p = this.prios;
        const top = n[0];
        const lastN = n.pop();
        const lastP = p.pop();
        if (n.length > 0) {
            let i = 0;
            const len = n.length;
            for (;;) {
                const l = i * 2 + 1;
                if (l >= len) break;
                const r = l + 1;
                const c = (r < len && p[r] < p[l]) ? r : l;
                if (p[c] >= lastP) break;
                n[i] = n[c];
                p[i] = p[c];
                i = c;
            }
            n[i] = lastN;
            p[i] = lastP;
        }
        return top;
    }
}

export class CityNav {
    constructor(data) {
        const DM = 0.1, MR = 0.001;

        // ---- Streets ----
        const rn = data.roadNodes;
        this.roadNodeX = new Float32Array(rn.length / 2);
        this.roadNodeZ = new Float32Array(rn.length / 2);
        for (let i = 0; i < rn.length; i += 2) {
            this.roadNodeX[i / 2] = rn[i] * DM;
            this.roadNodeZ[i / 2] = rn[i + 1] * DM;
        }
        this.roadNodeDegree = new Uint8Array(this.roadNodeX.length);
        this.roads = data.roads.map((r, i) => {
            const flat = r[7];
            const pts = new Float32Array(flat.length);
            for (let k = 0; k < flat.length; k++) pts[k] = flat[k] * DM;
            this.roadNodeDegree[r[0]]++;
            this.roadNodeDegree[r[1]]++;
            return {
                id: i,
                a: r[0],
                b: r[1],
                oneway: r[2] === 1,
                halfWidth: r[3] * DM,
                lanes: r[4],
                speedLimit: r[5] * DM,
                spawnWeight: r[6] * DM,
                pts
            };
        });

        // ---- Traffic control (from OSM): signalized junctions, all-way stops, stop-sign approaches ----
        const ctl = data.control || {};
        this.signalNodes = new Set(ctl.signals || []);
        this.allWayStopNodes = new Set(ctl.allWayStops || []);
        this.stopApproaches = [];
        const st = ctl.stops || [];
        for (let i = 0; i + 1 < st.length; i += 2) this.stopApproaches.push({ road: st[i], end: st[i + 1] });

        // ---- Pedestrian graph (CSR adjacency) ----
        const wx = data.walk.x, wz = data.walk.z, we = data.walk.e;
        const n = wx.length;
        this.nodeCount = n;
        this.nodeX = new Float32Array(n);
        this.nodeZ = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            this.nodeX[i] = wx[i] * DM;
            this.nodeZ[i] = wz[i] * DM;
        }
        const degree = new Int32Array(n);
        for (let i = 0; i < we.length; i += 3) {
            degree[we[i]]++;
            degree[we[i + 1]]++;
        }
        this.adjStart = new Int32Array(n + 1);
        for (let i = 0; i < n; i++) this.adjStart[i + 1] = this.adjStart[i] + degree[i];
        const total = this.adjStart[n];
        this.adjNode = new Int32Array(total);
        this.adjKind = new Uint8Array(total);
        this.adjLen = new Float32Array(total);
        const fill = this.adjStart.slice(0, n);
        for (let i = 0; i < we.length; i += 3) {
            const a = we[i], b = we[i + 1], kind = we[i + 2];
            const len = Math.hypot(this.nodeX[b] - this.nodeX[a], this.nodeZ[b] - this.nodeZ[a]);
            let s = fill[a]++;
            this.adjNode[s] = b; this.adjKind[s] = kind; this.adjLen[s] = len;
            s = fill[b]++;
            this.adjNode[s] = a; this.adjKind[s] = kind; this.adjLen[s] = len;
        }
        this.walkGrid = new PointGrid(24);
        for (let i = 0; i < n; i++) this.walkGrid.insert(i, this.nodeX[i], this.nodeZ[i]);

        // ---- Furniture ----
        const f = data.furniture;
        const fc = f.length / 4;
        this.furnitureCount = fc;
        this.furnType = new Uint8Array(fc);
        this.furnX = new Float32Array(fc);
        this.furnZ = new Float32Array(fc);
        this.furnYaw = new Float32Array(fc);
        this.furnitureGrid = new PointGrid(32);
        for (let i = 0; i < fc; i++) {
            this.furnType[i] = f[i * 4];
            this.furnX[i] = f[i * 4 + 1] * DM;
            this.furnZ[i] = f[i * 4 + 2] * DM;
            this.furnYaw[i] = f[i * 4 + 3] * MR;
            this.furnitureGrid.insert(i, this.furnX[i], this.furnZ[i]);
        }

        // ---- Seats ----
        const s = data.seats;
        const sc = s.length / 6;
        this.seatCount = sc;
        this.seatX = new Float32Array(sc);
        this.seatZ = new Float32Array(sc);
        this.seatYaw = new Float32Array(sc);
        this.seatAccess = new Int32Array(sc);
        this.seatCluster = new Int32Array(sc);
        this.seatType = new Uint8Array(sc);
        this.seatGrid = new PointGrid(32);
        for (let i = 0; i < sc; i++) {
            this.seatX[i] = s[i * 6] * DM;
            this.seatZ[i] = s[i * 6 + 1] * DM;
            this.seatYaw[i] = s[i * 6 + 2] * MR;
            this.seatAccess[i] = s[i * 6 + 3];
            this.seatCluster[i] = s[i * 6 + 4];
            this.seatType[i] = s[i * 6 + 5];
            this.seatGrid.insert(i, this.seatX[i], this.seatZ[i]);
        }

        // ---- Hangout spots ----
        const h = data.hangouts;
        const hc = h.length / 3;
        this.hangoutCount = hc;
        this.hangX = new Float32Array(hc);
        this.hangZ = new Float32Array(hc);
        this.hangAccess = new Int32Array(hc);
        this.hangoutGrid = new PointGrid(32);
        for (let i = 0; i < hc; i++) {
            this.hangX[i] = h[i * 3] * DM;
            this.hangZ[i] = h[i * 3 + 1] * DM;
            this.hangAccess[i] = h[i * 3 + 2];
            this.hangoutGrid.insert(i, this.hangX[i], this.hangZ[i]);
        }

        // ---- Building doors (kind: districts.js DOOR_KIND) ----
        const d = data.doors || [];
        const dc = d.length / 4;
        this.doorCount = dc;
        this.doorX = new Float32Array(dc);
        this.doorZ = new Float32Array(dc);
        this.doorAccess = new Int32Array(dc);
        this.doorKind = new Uint8Array(dc);
        this.doorGrid = new PointGrid(32);
        for (let i = 0; i < dc; i++) {
            this.doorX[i] = d[i * 4] * DM;
            this.doorZ[i] = d[i * 4 + 1] * DM;
            this.doorAccess[i] = d[i * 4 + 2];
            this.doorKind[i] = d[i * 4 + 3];
            this.doorGrid.insert(i, this.doorX[i], this.doorZ[i]);
        }

        // ---- Parking stalls (car centre and heading) ----
        const p = data.parking || [];
        const pc = p.length / 3;
        this.stallCount = pc;
        this.stallX = new Float32Array(pc);
        this.stallZ = new Float32Array(pc);
        this.stallYaw = new Float32Array(pc);
        this.stallGrid = new PointGrid(32);
        for (let i = 0; i < pc; i++) {
            this.stallX[i] = p[i * 3] * DM;
            this.stallZ[i] = p[i * 3 + 1] * DM;
            this.stallYaw[i] = p[i * 3 + 2] * MR;
            this.stallGrid.insert(i, this.stallX[i], this.stallZ[i]);
        }

        // ---- Drive-through lanes (points in driving order) ----
        this.driveThrus = (data.driveThrus || []).map((flat) => {
            const pts = new Float32Array(flat.length);
            for (let k = 0; k < flat.length; k++) pts[k] = flat[k] * DM;
            return pts;
        });

        // A* scratch (stamped so nothing is cleared between searches)
        this._g = new Float32Array(n);
        this._from = new Int32Array(n);
        this._seen = new Uint32Array(n);
        this._closed = new Uint32Array(n);
        this._stamp = 0;
        this._heap = new NodeHeap();
    }

    /** Nearest walk node within maxDist, or -1. */
    nearestWalkNode(x, z, maxDist = 40) {
        let best = -1;
        let bestD = maxDist * maxDist;
        this.walkGrid.forEachNear(x, z, maxDist, (i) => {
            const dx = this.nodeX[i] - x, dz = this.nodeZ[i] - z;
            const d = dx * dx + dz * dz;
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        });
        return best;
    }

    /** Collects walk nodes whose distance from (x, z) lies in [minR, maxR]. */
    walkNodesInRing(x, z, minR, maxR, out) {
        out.length = 0;
        const min2 = minR * minR, max2 = maxR * maxR;
        this.walkGrid.forEachNear(x, z, maxR, (i) => {
            const dx = this.nodeX[i] - x, dz = this.nodeZ[i] - z;
            const d = dx * dx + dz * dz;
            if (d >= min2 && d <= max2) out.push(i);
        });
        return out;
    }

    seatsInRing(x, z, minR, maxR, out) {
        out.length = 0;
        const min2 = minR * minR, max2 = maxR * maxR;
        this.seatGrid.forEachNear(x, z, maxR, (i) => {
            const dx = this.seatX[i] - x, dz = this.seatZ[i] - z;
            const d = dx * dx + dz * dz;
            if (d >= min2 && d <= max2) out.push(i);
        });
        return out;
    }

    hangoutsInRing(x, z, minR, maxR, out) {
        out.length = 0;
        const min2 = minR * minR, max2 = maxR * maxR;
        this.hangoutGrid.forEachNear(x, z, maxR, (i) => {
            const dx = this.hangX[i] - x, dz = this.hangZ[i] - z;
            const d = dx * dx + dz * dz;
            if (d >= min2 && d <= max2) out.push(i);
        });
        return out;
    }

    /**
     * Moves door `i` to (x, z) (and its kind), re-linking it to the nearest walk node. Used when a
     * building is rebuilt with its door somewhere else (bars.js).
     */
    moveDoor(i, x, z, kind = this.doorKind[i]) {
        this.doorX[i] = x;
        this.doorZ[i] = z;
        this.doorKind[i] = kind;
        const node = this.nearestWalkNode(x, z, 40);
        if (node >= 0) this.doorAccess[i] = node;
        this._doorsMoved = true;
    }

    /** Re-files the doors in the lookup grid after moveDoor. */
    refreshDoors() {
        if (!this._doorsMoved) return;
        this._doorsMoved = false;
        this.doorGrid = new PointGrid(32);
        for (let i = 0; i < this.doorCount; i++) this.doorGrid.insert(i, this.doorX[i], this.doorZ[i]);
    }

    doorsInRing(x, z, minR, maxR, out) {
        out.length = 0;
        const min2 = minR * minR, max2 = maxR * maxR;
        this.doorGrid.forEachNear(x, z, maxR, (i) => {
            const dx = this.doorX[i] - x, dz = this.doorZ[i] - z;
            const d = dx * dx + dz * dz;
            if (d >= min2 && d <= max2) out.push(i);
        });
        return out;
    }

    stallsNear(x, z, r, out) {
        out.length = 0;
        const r2 = r * r;
        this.stallGrid.forEachNear(x, z, r, (i) => {
            const dx = this.stallX[i] - x, dz = this.stallZ[i] - z;
            if (dx * dx + dz * dz <= r2) out.push(i);
        });
        return out;
    }

    furnitureNear(x, z, r, out) {
        out.length = 0;
        const r2 = r * r;
        this.furnitureGrid.forEachNear(x, z, r, (i) => {
            const dx = this.furnX[i] - x, dz = this.furnZ[i] - z;
            if (dx * dx + dz * dz <= r2) out.push(i);
        });
        return out;
    }

    /** Kind of the edge a-b (WALK_EDGE), or -1 if they aren't adjacent. */
    edgeKind(a, b) {
        for (let k = this.adjStart[a]; k < this.adjStart[a + 1]; k++) {
            if (this.adjNode[k] === b) return this.adjKind[k];
        }
        return -1;
    }

    /**
     * A* over the pedestrian graph. Crosswalks cost a little extra so routes don't zig-zag
     * across streets for no reason. Returns an array of node ids (start..goal) or null.
     */
    findPath(start, goal, maxExpand = 6000) {
        if (start < 0 || goal < 0) return null;
        if (start === goal) return [start];
        const stamp = ++this._stamp;
        const g = this._g, from = this._from, seen = this._seen, closed = this._closed;
        const X = this.nodeX, Z = this.nodeZ;
        const gx = X[goal], gz = Z[goal];
        const heap = this._heap;
        heap.clear();
        seen[start] = stamp;
        g[start] = 0;
        from[start] = -1;
        heap.push(start, Math.hypot(X[start] - gx, Z[start] - gz));
        let expanded = 0;
        while (heap.size > 0) {
            const cur = heap.pop();
            if (closed[cur] === stamp) continue;
            closed[cur] = stamp;
            if (cur === goal) {
                const path = [];
                for (let c = goal; c !== -1; c = from[c]) path.push(c);
                path.reverse();
                return path;
            }
            if (++expanded > maxExpand) return null;
            const gc = g[cur];
            for (let k = this.adjStart[cur], end = this.adjStart[cur + 1]; k < end; k++) {
                const nb = this.adjNode[k];
                if (closed[nb] === stamp) continue;
                const cost = gc + this.adjLen[k] * (this.adjKind[k] === WALK_EDGE.CROSSING ? 1.5 : 1.0);
                if (seen[nb] !== stamp || cost < g[nb]) {
                    seen[nb] = stamp;
                    g[nb] = cost;
                    from[nb] = cur;
                    heap.push(nb, cost + Math.hypot(X[nb] - gx, Z[nb] - gz));
                }
            }
        }
        return null;
    }
}

/** Fetches and indexes the baked navigation data. Resolves to null if it can't be loaded. */
export async function loadCityNav(url = './js/game/data/cityNav.json') {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return new CityNav(await res.json());
    } catch (err) {
        console.warn('[CityNav] navigation data unavailable, falling back to the hand-built neighbourhood roads:', err);
        return null;
    }
}
