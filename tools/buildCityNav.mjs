/**
 * tools/buildCityNav.mjs
 *
 * Bakes the city-wide navigation data used by traffic and pedestrians from the same OSM extract
 * that /mapfinal was exported from (newmap2/OSM2World-latest-bin/map.osm):
 *   - roads:     drivable street graph (split at junctions) with measured asphalt half-widths
 *   - walk:      pedestrian graph = mapped OSM sidewalks/footways + synthesized sidewalks along
 *                urban streets that have none mapped, stitched together with corner links and
 *                crosswalks (edges that cross a street are flagged so NPCs look before crossing)
 *   - furniture: lawn chairs in front yards, café patio sets, park and bus-stop benches
 *   - seats:     sittable spots on that furniture
 *   - hangouts:  open grass in parks, greens and front lawns where groups gather
 *
 * Usage: node tools/buildCityNav.mjs   ->  js/game/data/cityNav.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OSM_FILE = path.join(ROOT, 'newmap2/OSM2World-latest-bin/map.osm');
const OBJ_DIR = path.join(ROOT, 'mapfinal');
const OUT_FILE = path.join(ROOT, 'js/game/data/cityNav.json');

// Must match ANOTHERMAPO_CONFIG.MAP_OFFSET in js/game/mapLoader.js
const MAP_OFFSET = { x: -2324.73, z: -748.02 };

// ---------------------------------------------------------------------------------------------
// Small deterministic helpers
// ---------------------------------------------------------------------------------------------
function hash32(n) {
    let h = (n | 0) ^ 0x9e3779b9;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function segSegIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
    const r1 = bx - ax, s1 = bz - az, r2 = dx - cx, s2 = dz - cz;
    const den = r1 * s2 - s1 * r2;
    if (Math.abs(den) < 1e-9) return false;
    const t = ((cx - ax) * s2 - (cz - az) * r2) / den;
    const u = ((cx - ax) * s1 - (cz - az) * r1) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function pointSegDist(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function pointInRing(px, pz, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
        if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
}

function ringArea(ring) {
    let a = 0;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        a += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
    }
    return Math.abs(a) * 0.5;
}

function ringCentroid(ring) {
    let x = 0, z = 0;
    const n = ring.length / 2;
    for (let i = 0; i < ring.length; i += 2) { x += ring[i]; z += ring[i + 1]; }
    return { x: x / n, z: z / n };
}

/** Uniform hash grid of items with bounding boxes. */
class BoxGrid {
    constructor(cell) {
        this.cell = cell;
        this.map = new Map();
    }
    _k(cx, cz) { return cx * 100003 + cz; }
    insert(item, minX, minZ, maxX, maxZ) {
        const c = this.cell;
        for (let cx = Math.floor(minX / c); cx <= Math.floor(maxX / c); cx++) {
            for (let cz = Math.floor(minZ / c); cz <= Math.floor(maxZ / c); cz++) {
                const k = this._k(cx, cz);
                let arr = this.map.get(k);
                if (!arr) { arr = []; this.map.set(k, arr); }
                arr.push(item);
            }
        }
    }
    query(minX, minZ, maxX, maxZ, out, stamp) {
        const c = this.cell;
        out.length = 0;
        for (let cx = Math.floor(minX / c); cx <= Math.floor(maxX / c); cx++) {
            for (let cz = Math.floor(minZ / c); cz <= Math.floor(maxZ / c); cz++) {
                const arr = this.map.get(this._k(cx, cz));
                if (!arr) continue;
                for (const it of arr) {
                    if (it._stamp === stamp) continue;
                    it._stamp = stamp;
                    out.push(it);
                }
            }
        }
        return out;
    }
}
let _stamp = 0;
const _q = [];
const nextStamp = () => ++_stamp;

// ---------------------------------------------------------------------------------------------
// 1. Parse OSM
// ---------------------------------------------------------------------------------------------
console.time('parse osm');
const osm = fs.readFileSync(OSM_FILE, 'utf8');
const bm = /<bounds minlat="([-\d.]+)" minlon="([-\d.]+)" maxlat="([-\d.]+)" maxlon="([-\d.]+)"/.exec(osm);
const LAT0 = (parseFloat(bm[1]) + parseFloat(bm[3])) / 2;
const LON0 = (parseFloat(bm[2]) + parseFloat(bm[4])) / 2;

// OSM2World's MetricMapProjection (Mercator scaled at the origin latitude), then the /mapfinal offset
const R = 6378137, D2R = Math.PI / 180;
const K = R * Math.cos(LAT0 * D2R);
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
const Y0 = mercY(LAT0);
function project(lat, lon) {
    return [(lon - LON0) * D2R * K + MAP_OFFSET.x, -(mercY(lat) - Y0) * K + MAP_OFFSET.z];
}
const [bMinX, bMaxZ] = project(parseFloat(bm[1]), parseFloat(bm[2]));
const [bMaxX, bMinZ] = project(parseFloat(bm[3]), parseFloat(bm[4]));

function parseTags(body) {
    const tags = {};
    if (!body) return tags;
    const re = /<tag k="([^"]*)" v="([^"]*)"\s*\/>/g;
    let m;
    while ((m = re.exec(body))) tags[m[1]] = m[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    return tags;
}

const nodeIndex = new Map();
const NX = [], NZ = [];
const taggedNodes = [];
{
    const re = /<node id="(\d+)" lat="([-\d.]+)" lon="([-\d.]+)"[^>]*?(\/>|>([\s\S]*?)<\/node>)/g;
    let m;
    while ((m = re.exec(osm))) {
        const [x, z] = project(parseFloat(m[2]), parseFloat(m[3]));
        const idx = NX.length;
        nodeIndex.set(m[1], idx);
        NX.push(x); NZ.push(z);
        if (m[5]) {
            const tags = parseTags(m[5]);
            if (Object.keys(tags).length) taggedNodes.push({ idx, tags });
        }
    }
}
const ways = [];
{
    const re = /<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g;
    let m;
    while ((m = re.exec(osm))) {
        const refs = [];
        const nre = /<nd ref="(\d+)"\/>/g;
        let n;
        while ((n = nre.exec(m[2]))) {
            const idx = nodeIndex.get(n[1]);
            if (idx !== undefined) refs.push(idx);
        }
        if (refs.length < 2) continue;
        ways.push({ id: +m[1], refs, tags: parseTags(m[2]) });
    }
}
console.timeEnd('parse osm');
console.log(`nodes ${NX.length}, ways ${ways.length}, tagged nodes ${taggedNodes.length}`);

// ---------------------------------------------------------------------------------------------
// 2. Rasterize rendered asphalt (1 m bitset) to measure real street widths
// ---------------------------------------------------------------------------------------------
console.time('asphalt raster');
const RX0 = Math.floor(bMinX) - 64, RZ0 = Math.floor(bMinZ) - 64;
const RW = Math.ceil(bMaxX - bMinX) + 128, RH = Math.ceil(bMaxZ - bMinZ) + 128;
const asphalt = new Uint8Array(Math.ceil((RW * RH) / 8));
function setCell(x, z) {
    const i = (z - RZ0) * RW + (x - RX0);
    if (x < RX0 || z < RZ0 || x >= RX0 + RW || z >= RZ0 + RH) return;
    asphalt[i >> 3] |= 1 << (i & 7);
}
function isAsphalt(x, z) {
    const cx = Math.floor(x), cz = Math.floor(z);
    if (cx < RX0 || cz < RZ0 || cx >= RX0 + RW || cz >= RZ0 + RH) return false;
    const i = (cz - RZ0) * RW + (cx - RX0);
    return (asphalt[i >> 3] & (1 << (i & 7))) !== 0;
}
let asphaltTris = 0;
if (fs.existsSync(OBJ_DIR)) {
    for (const f of fs.readdirSync(OBJ_DIR).filter((f) => f.endsWith('.obj'))) {
        const lines = fs.readFileSync(path.join(OBJ_DIR, f), 'utf8').split('\n');
        const V = [];
        let on = false;
        for (const L of lines) {
            if (L.charCodeAt(0) === 118 && L.charCodeAt(1) === 32) {
                const p = L.split(/\s+/);
                V.push(+p[1] + MAP_OFFSET.x, +p[3] + MAP_OFFSET.z);
            } else if (L.startsWith('usemtl')) {
                on = L.includes('ASPHALT');
            } else if (on && L.startsWith('f ')) {
                const p = L.trim().split(/\s+/).slice(1).map((t) => {
                    const i = parseInt(t, 10);
                    return (i < 0 ? V.length / 2 + i : i - 1) * 2;
                });
                for (let k = 1; k + 1 < p.length; k++) {
                    const ax = V[p[0]], az = V[p[0] + 1], bx = V[p[k]], bz = V[p[k] + 1], cx = V[p[k + 1]], cz = V[p[k + 1] + 1];
                    const minx = Math.floor(Math.min(ax, bx, cx)), maxx = Math.floor(Math.max(ax, bx, cx));
                    const minz = Math.floor(Math.min(az, bz, cz)), maxz = Math.floor(Math.max(az, bz, cz));
                    if ((maxx - minx + 1) * (maxz - minz + 1) > 250000) continue;
                    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
                    if (Math.abs(d) < 1e-9) continue;
                    asphaltTris++;
                    for (let x = minx; x <= maxx; x++) {
                        for (let z = minz; z <= maxz; z++) {
                            const px = x + 0.5, pz = z + 0.5;
                            const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d;
                            const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
                            if (l1 >= -0.02 && l2 >= -0.02 && 1 - l1 - l2 >= -0.02) setCell(x, z);
                        }
                    }
                }
            }
        }
    }
}
console.timeEnd('asphalt raster');
console.log(`asphalt triangles ${asphaltTris}`);

// ---------------------------------------------------------------------------------------------
// 3. Classify ways
// ---------------------------------------------------------------------------------------------
const ROAD_CLASSES = {
    trunk: { speed: 20.0, weight: 3.0, sidewalk: false },
    trunk_link: { speed: 13.0, weight: 1.0, sidewalk: false },
    primary: { speed: 15.6, weight: 3.0, sidewalk: true },
    primary_link: { speed: 11.0, weight: 1.0, sidewalk: true },
    secondary: { speed: 15.6, weight: 2.5, sidewalk: true },
    secondary_link: { speed: 11.0, weight: 1.0, sidewalk: true },
    tertiary: { speed: 13.4, weight: 2.0, sidewalk: true },
    tertiary_link: { speed: 11.0, weight: 1.0, sidewalk: true },
    unclassified: { speed: 13.4, weight: 1.2, sidewalk: true },
    residential: { speed: 11.2, weight: 1.0, sidewalk: true },
    living_street: { speed: 6.7, weight: 0.5, sidewalk: true }
};
const WALK_TYPES = new Set(['footway', 'pedestrian', 'path', 'steps', 'cycleway']);
const GREEN_LEISURE = new Set(['park', 'playground', 'recreation_ground', 'common', 'dog_park', 'pitch', 'village_green']);
const GREEN_LANDUSE = new Set(['grass', 'recreation_ground', 'village_green']);
const PATIO_AMENITIES = new Set(['cafe', 'restaurant', 'fast_food', 'bar', 'pub', 'ice_cream', 'biergarten']);
const HOUSE_TYPES = new Set(['house', 'detached', 'residential', 'yes', 'semidetached_house', 'bungalow']);

function isOn(v) { return v === 'yes' || v === '1' || v === 'true'; }
function ringOf(way) {
    if (way.refs[0] !== way.refs[way.refs.length - 1] || way.refs.length < 4) return null;
    const ring = [];
    for (const r of way.refs) ring.push(NX[r], NZ[r]);
    return ring;
}
function parseSpeed(v, fallback) {
    if (!v) return fallback;
    const n = parseFloat(v);
    if (!isFinite(n)) return fallback;
    const ms = /mph/.test(v) ? n * 0.44704 : n / 3.6;
    return Math.max(5, Math.min(25, ms));
}

const roadWays = [], walkWays = [], serviceWays = [];
const buildings = [], blockers = [], greens = [], amenities = [];
for (const w of ways) {
    const t = w.tags;
    const hw = t.highway;
    if (hw && ROAD_CLASSES[hw] && t.area !== 'yes' && t.access !== 'private' && t.access !== 'no' && t.indoor !== 'yes') {
        roadWays.push(w);
    } else if (hw && WALK_TYPES.has(hw) && t.footway !== 'access_aisle' && t.indoor !== 'yes' &&
        (!t.level || t.level === '0') && t.access !== 'private' && t.access !== 'no') {
        walkWays.push(w);
    } else if (hw === 'service') {
        serviceWays.push(w);
    }
    if (t.building && t.building !== 'no' && t.building !== 'roof') {
        const ring = ringOf(w);
        if (ring) buildings.push({ ring, way: w, house: HOUSE_TYPES.has(t.building) });
    }
    if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin' ||
        t.amenity === 'parking' || t.landuse === 'railway' || t.leisure === 'swimming_pool') {
        const ring = ringOf(w);
        if (ring) blockers.push({ ring });
    }
    if ((t.leisure && GREEN_LEISURE.has(t.leisure)) || (t.landuse && GREEN_LANDUSE.has(t.landuse))) {
        const ring = ringOf(w);
        if (ring) greens.push({ ring, park: t.leisure === 'park' || t.leisure === 'playground' || t.leisure === 'recreation_ground' });
    }
    if (t.amenity && PATIO_AMENITIES.has(t.amenity)) {
        const ring = ringOf(w);
        if (ring) amenities.push(ringCentroid(ring));
    }
}
const busStops = [];
const osmBenches = [];
for (const n of taggedNodes) {
    if (n.tags.amenity && PATIO_AMENITIES.has(n.tags.amenity)) amenities.push({ x: NX[n.idx], z: NZ[n.idx] });
    if (n.tags.highway === 'bus_stop') busStops.push({ x: NX[n.idx], z: NZ[n.idx] });
    if (n.tags.amenity === 'bench' || n.tags.leisure === 'picnic_table') osmBenches.push({ x: NX[n.idx], z: NZ[n.idx] });
}
console.log(`roads ${roadWays.length}, walkways ${walkWays.length}, buildings ${buildings.length}, greens ${greens.length}, amenities ${amenities.length}`);

// Polygon grids
function bboxOfRing(ring) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
        minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
        minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]);
    }
    return { minX, minZ, maxX, maxZ };
}
const buildingGrid = new BoxGrid(40);
const buildingCentroidGrid = new BoxGrid(60);
for (const b of buildings) {
    b.bb = bboxOfRing(b.ring);
    b.c = ringCentroid(b.ring);
    b.area = ringArea(b.ring);
    buildingGrid.insert(b, b.bb.minX, b.bb.minZ, b.bb.maxX, b.bb.maxZ);
    buildingCentroidGrid.insert(b, b.c.x, b.c.z, b.c.x, b.c.z);
}
const blockerGrid = new BoxGrid(60);
for (const b of blockers) {
    b.bb = bboxOfRing(b.ring);
    blockerGrid.insert(b, b.bb.minX, b.bb.minZ, b.bb.maxX, b.bb.maxZ);
}

function ringEdgeDist(px, pz, ring) {
    let d = Infinity;
    for (let i = 0; i + 3 < ring.length; i += 2) d = Math.min(d, pointSegDist(px, pz, ring[i], ring[i + 1], ring[i + 2], ring[i + 3]));
    return d;
}
function inBuilding(x, z, margin = 0) {
    const s = nextStamp();
    for (const b of buildingGrid.query(x - margin, z - margin, x + margin, z + margin, _q, s)) {
        if (x < b.bb.minX - margin || x > b.bb.maxX + margin || z < b.bb.minZ - margin || z > b.bb.maxZ + margin) continue;
        if (pointInRing(x, z, b.ring)) return true;
        if (margin > 0 && ringEdgeDist(x, z, b.ring) < margin) return true;
    }
    return false;
}
function inBlocker(x, z) {
    const s = nextStamp();
    for (const b of blockerGrid.query(x, z, x, z, _q, s)) {
        if (x < b.bb.minX || x > b.bb.maxX || z < b.bb.minZ || z > b.bb.maxZ) continue;
        if (pointInRing(x, z, b.ring)) return true;
    }
    return false;
}
function nearBuildings(x, z, r) {
    const s = nextStamp();
    let n = 0;
    for (const b of buildingCentroidGrid.query(x - r, z - r, x + r, z + r, _q, s)) {
        if (Math.hypot(b.c.x - x, b.c.z - z) <= r) n++;
    }
    return n;
}

// ---------------------------------------------------------------------------------------------
// 4. Road graph (split at junctions), measured widths
// ---------------------------------------------------------------------------------------------
console.time('roads');
const roadNodeUse = new Map();
for (const w of roadWays) {
    w.refs.forEach((r, i) => {
        const isEnd = i === 0 || i === w.refs.length - 1;
        roadNodeUse.set(r, (roadNodeUse.get(r) || 0) + (isEnd ? 1 : 2));
    });
}
const graphNodeId = new Map(); // osm node idx -> compact road graph node id
const graphNodes = [];
function gnode(idx) {
    let id = graphNodeId.get(idx);
    if (id === undefined) {
        id = graphNodes.length;
        graphNodeId.set(idx, id);
        graphNodes.push({ idx, x: NX[idx], z: NZ[idx], edges: [] });
    }
    return id;
}
const roadEdges = [];
for (const w of roadWays) {
    const t = w.tags;
    const cls = ROAD_CLASSES[t.highway];
    let oneway = 0;
    if (isOn(t.oneway) || t.junction === 'roundabout') oneway = 1;
    else if (t.oneway === '-1') oneway = -1;
    const refs = oneway === -1 ? [...w.refs].reverse() : w.refs;
    const lanes = parseInt(t.lanes, 10) || (oneway ? 1 : 2);
    const speed = parseSpeed(t.maxspeed, cls.speed);
    let start = 0;
    for (let i = 1; i < refs.length; i++) {
        const use = roadNodeUse.get(refs[i]) || 0;
        if (i === refs.length - 1 || use > 2) {
            const pts = refs.slice(start, i + 1);
            const e = {
                id: roadEdges.length,
                type: t.highway,
                cls,
                oneway: oneway ? 1 : 0,
                lanes,
                speed,
                pts,
                a: gnode(pts[0]),
                b: gnode(pts[pts.length - 1]),
                halfW: 3.5,
                taggedWidth: parseFloat(t.width) || 0
            };
            roadEdges.push(e);
            graphNodes[e.a].edges.push(e.id);
            graphNodes[e.b].edges.push(e.id);
            start = i;
        }
    }
}

const roadSegGrid = new BoxGrid(30);
const roadSegs = [];
for (const e of roadEdges) {
    for (let i = 0; i + 1 < e.pts.length; i++) {
        const a = e.pts[i], b = e.pts[i + 1];
        const s = { e, ax: NX[a], az: NZ[a], bx: NX[b], bz: NZ[b] };
        roadSegs.push(s);
        roadSegGrid.insert(s, Math.min(s.ax, s.bx), Math.min(s.az, s.bz), Math.max(s.ax, s.bx), Math.max(s.az, s.bz));
    }
}

// Measure rendered half-width by probing the asphalt raster perpendicular to the centreline
function edgeLength(e) {
    let L = 0;
    for (let i = 0; i + 1 < e.pts.length; i++) L += Math.hypot(NX[e.pts[i + 1]] - NX[e.pts[i]], NZ[e.pts[i + 1]] - NZ[e.pts[i]]);
    return L;
}
let measured = 0;
for (const e of roadEdges) {
    const fallback = e.taggedWidth > 0 ? e.taggedWidth / 2 : Math.max(2.75, e.lanes * 1.75);
    const samples = [];
    const total = edgeLength(e);
    let acc = 0;
    for (let i = 0; i + 1 < e.pts.length; i++) {
        const ax = NX[e.pts[i]], az = NZ[e.pts[i]], bx = NX[e.pts[i + 1]], bz = NZ[e.pts[i + 1]];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 0.5) { acc += L; continue; }
        const ux = (bx - ax) / L, uz = (bz - az) / L;
        for (let s = 2; s < L; s += 6) {
            const along = acc + s;
            if (along < 9 || along > total - 9) continue;
            const px = ax + ux * s, pz = az + uz * s;
            if (!isAsphalt(px, pz)) continue;
            const side = (sgn) => {
                for (let d = 0.5; d <= 12; d += 0.5) {
                    if (!isAsphalt(px - uz * d * sgn, pz + ux * d * sgn)) return d;
                }
                return 12;
            };
            samples.push(Math.min(side(1), side(-1)) + 0.25);
        }
        acc += L;
    }
    if (samples.length >= 2) {
        samples.sort((p, q) => p - q);
        e.halfW = Math.max(2.5, Math.min(8.5, samples[samples.length >> 1]));
        measured++;
    } else {
        e.halfW = fallback;
    }
}
console.timeEnd('roads');
console.log(`road edges ${roadEdges.length}, measured widths ${measured}`);

function nearestRoad(x, z, r) {
    const s = nextStamp();
    let best = null, bestD = Infinity;
    for (const seg of roadSegGrid.query(x - r, z - r, x + r, z + r, _q, s)) {
        const d = pointSegDist(x, z, seg.ax, seg.az, seg.bx, seg.bz);
        if (d < bestD) { bestD = d; best = seg; }
    }
    return best ? { seg: best, d: bestD } : null;
}
/** True if the point sits at least `extra` metres outside every street's asphalt. */
function clearOfRoads(x, z, extra) {
    const s = nextStamp();
    const r = 9 + extra;
    for (const seg of roadSegGrid.query(x - r, z - r, x + r, z + r, _q, s)) {
        if (pointSegDist(x, z, seg.ax, seg.az, seg.bx, seg.bz) < seg.e.halfW + extra) return false;
    }
    return true;
}
/** Road edges a segment crosses (by centreline). */
function roadsCrossed(ax, az, bx, bz, out) {
    out.length = 0;
    const s = nextStamp();
    const hits = [];
    for (const seg of roadSegGrid.query(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), hits, s)) {
        if (segSegIntersect(ax, az, bx, bz, seg.ax, seg.az, seg.bx, seg.bz)) {
            if (!out.includes(seg.e)) out.push(seg.e);
        }
    }
    return out;
}

const serviceSegGrid = new BoxGrid(30);
for (const w of serviceWays) {
    for (let i = 0; i + 1 < w.refs.length; i++) {
        const s = { ax: NX[w.refs[i]], az: NZ[w.refs[i]], bx: NX[w.refs[i + 1]], bz: NZ[w.refs[i + 1]] };
        serviceSegGrid.insert(s, Math.min(s.ax, s.bx), Math.min(s.az, s.bz), Math.max(s.ax, s.bx), Math.max(s.az, s.bz));
    }
}
function nearService(x, z, r) {
    const s = nextStamp();
    for (const seg of serviceSegGrid.query(x - r, z - r, x + r, z + r, _q, s)) {
        if (pointSegDist(x, z, seg.ax, seg.az, seg.bx, seg.bz) < r) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------------------------
// 5. Walk graph
// ---------------------------------------------------------------------------------------------
console.time('walk graph');
const WX = [], WZ = [], WADJ = [];
const walkGrid = new Map();
const WCELL = 8;
function wkey(cx, cz) { return cx * 100003 + cz; }
function addWalkNode(x, z, snap = 0) {
    if (snap > 0) {
        const cx = Math.floor(x / WCELL), cz = Math.floor(z / WCELL);
        let best = -1, bestD = snap;
        for (let i = cx - 1; i <= cx + 1; i++) {
            for (let j = cz - 1; j <= cz + 1; j++) {
                const arr = walkGrid.get(wkey(i, j));
                if (!arr) continue;
                for (const n of arr) {
                    const d = Math.hypot(WX[n] - x, WZ[n] - z);
                    if (d < bestD) { bestD = d; best = n; }
                }
            }
        }
        if (best >= 0) return best;
    }
    const id = WX.length;
    WX.push(x); WZ.push(z); WADJ.push([]);
    const k = wkey(Math.floor(x / WCELL), Math.floor(z / WCELL));
    let arr = walkGrid.get(k);
    if (!arr) { arr = []; walkGrid.set(k, arr); }
    arr.push(id);
    return id;
}
function hasEdge(a, b) {
    for (const [n] of WADJ[a]) if (n === b) return true;
    return false;
}
function addWalkEdge(a, b, kind) {
    if (a === b || hasEdge(a, b)) return;
    WADJ[a].push([b, kind]);
    WADJ[b].push([a, kind]);
}
const _crossed = [];
function edgeKind(ax, az, bx, bz) {
    return roadsCrossed(ax, az, bx, bz, _crossed).length > 0 ? 1 : 0;
}
/** Parameter ranges [t0, t1] of segment a->b that lie over a street's asphalt, merged. */
function crossingIntervals(ax, az, bx, bz, L) {
    const iv = [];
    const s = nextStamp();
    const hits = [];
    for (const seg of roadSegGrid.query(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), hits, s)) {
        const r1 = bx - ax, s1 = bz - az, r2 = seg.bx - seg.ax, s2 = seg.bz - seg.az;
        const den = r1 * s2 - s1 * r2;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((seg.ax - ax) * s2 - (seg.az - az) * r2) / den;
        const u = ((seg.ax - ax) * s1 - (seg.az - az) * r1) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const sinA = Math.abs(den) / ((L || 1) * (Math.hypot(r2, s2) || 1));
        const w = (seg.e.halfW + 1.0) / Math.max(0.35, sinA) / (L || 1);
        iv.push([Math.max(0, t - w), Math.min(1, t + w)]);
    }
    iv.sort((p, q) => p[0] - q[0]);
    const merged = [];
    for (const v of iv) {
        if (merged.length && v[0] <= merged[merged.length - 1][1]) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], v[1]);
        else merged.push(v);
    }
    return merged;
}
/** Adds a plain (non-crossing) stretch, subdividing it so spawns and paths have regular nodes. */
function addPlainStretch(a, b) {
    const L = Math.hypot(WX[b] - WX[a], WZ[b] - WZ[a]);
    const n = Math.max(1, Math.ceil(L / 10));
    let prev = a;
    for (let k = 1; k < n; k++) {
        const t = k / n;
        const mid = addWalkNode(WX[a] + (WX[b] - WX[a]) * t, WZ[a] + (WZ[b] - WZ[a]) * t);
        addWalkEdge(prev, mid, 0);
        prev = mid;
    }
    addWalkEdge(prev, b, 0);
}
/** Adds a polyline; only the parts of each edge that lie over a street become crossing edges. */
function addWalkPolyline(nodeIds) {
    for (let i = 0; i + 1 < nodeIds.length; i++) {
        const a = nodeIds[i], b = nodeIds[i + 1];
        const ax = WX[a], az = WZ[a], bx = WX[b], bz = WZ[b];
        const L = Math.hypot(bx - ax, bz - az);
        const iv = crossingIntervals(ax, az, bx, bz, L);
        if (iv.length === 0) { addPlainStretch(a, b); continue; }
        let prev = a, prevT = 0;
        const at = (t) => (t <= 0 ? a : t >= 1 ? b : addWalkNode(ax + (bx - ax) * t, az + (bz - az) * t));
        for (const [t0, t1] of iv) {
            // Plain run up to the curb, then the crossing itself
            const n0 = (t0 - prevT) * L < 0.6 ? prev : at(t0);
            if (n0 !== prev) addPlainStretch(prev, n0);
            const n1 = (1 - t1) * L < 0.6 ? b : at(t1);
            addWalkEdge(n0, n1, 1);
            prev = n1;
            prevT = n1 === b ? 1 : t1;
        }
        if (prev !== b) addPlainStretch(prev, b);
    }
}

// 5a. Mapped footways and sidewalks
const osmWalkNode = new Map();
const mappedSegGrid = new BoxGrid(20);
for (const w of walkWays) {
    const ids = w.refs.map((r) => {
        let id = osmWalkNode.get(r);
        if (id === undefined) {
            id = addWalkNode(NX[r], NZ[r]);
            osmWalkNode.set(r, id);
        }
        return id;
    });
    addWalkPolyline(ids);
    const isCrossingWay = w.tags.footway === 'crossing' || w.tags.highway === 'crossing';
    for (let i = 0; i + 1 < w.refs.length; i++) {
        const s = { ax: NX[w.refs[i]], az: NZ[w.refs[i]], bx: NX[w.refs[i + 1]], bz: NZ[w.refs[i + 1]], crossing: isCrossingWay };
        mappedSegGrid.insert(s, Math.min(s.ax, s.bx), Math.min(s.az, s.bz), Math.max(s.ax, s.bx), Math.max(s.az, s.bz));
    }
}
const mappedNodeCount = WX.length;
function nearMappedWalk(x, z, r) {
    const s = nextStamp();
    for (const seg of mappedSegGrid.query(x - r, z - r, x + r, z + r, _q, s)) {
        if (seg.crossing) continue;
        if (pointSegDist(x, z, seg.ax, seg.az, seg.bx, seg.bz) < r) return true;
    }
    return false;
}

// 5b. Synthesized sidewalks along urban streets without mapped ones.
// Chains run through degree-2 graph nodes so bends get proper mitred offsets.
const edgeUsedInChain = new Uint8Array(roadEdges.length);
function otherEnd(e, n) { return e.a === n ? e.b : e.a; }
const chains = [];
for (const e0 of roadEdges) {
    if (edgeUsedInChain[e0.id] || !e0.cls.sidewalk) continue;
    edgeUsedInChain[e0.id] = 1;
    // Walk backwards then forwards through degree-2 nodes
    const seq = [{ e: e0, fwd: true }];
    for (const dir of [-1, 1]) {
        let cur = e0;
        let node = dir === 1 ? e0.b : e0.a;
        for (;;) {
            const gn = graphNodes[node];
            if (gn.edges.length !== 2) break;
            const nextId = gn.edges[0] === cur.id ? gn.edges[1] : gn.edges[0];
            const nx = roadEdges[nextId];
            if (edgeUsedInChain[nx.id] || !nx.cls.sidewalk || nx === cur) break;
            edgeUsedInChain[nx.id] = 1;
            const fwd = dir === 1 ? nx.a === node : nx.b === node;
            if (dir === 1) seq.push({ e: nx, fwd });
            else seq.unshift({ e: nx, fwd });
            node = otherEnd(nx, node);
            cur = nx;
        }
    }
    // Flatten to a point list with per-point half width
    const pts = [];
    for (const { e, fwd } of seq) {
        const ids = fwd ? e.pts : [...e.pts].reverse();
        for (let i = 0; i < ids.length; i++) {
            if (pts.length && i === 0) continue;
            pts.push({ x: NX[ids[i]], z: NZ[ids[i]], hw: e.halfW });
        }
    }
    const first = seq[0], last = seq[seq.length - 1];
    const startNode = first.fwd ? first.e.a : first.e.b;
    const endNode = last.fwd ? last.e.b : last.e.a;
    chains.push({ pts, startNode, endNode, edgeIds: new Set(seq.map((q) => q.e.id)) });
}

function trimForNode(nodeId, ownEdges) {
    const gn = graphNodes[nodeId];
    if (gn.edges.length < 3 && gn.edges.every((id) => ownEdges.has(id))) return 0;
    let maxHw = 0;
    for (const id of gn.edges) if (!ownEdges.has(id)) maxHw = Math.max(maxHw, roadEdges[id].halfW);
    return maxHw > 0 ? maxHw + 2.2 : 0;
}

let synthPieces = 0;
const SIDEWALK_GAP = 1.6;
for (const ch of chains) {
    const P = ch.pts;
    if (P.length < 2) continue;
    // Offset both sides with mitred joins
    for (const side of [1, -1]) {
        const off = [];
        for (let i = 0; i < P.length; i++) {
            const p = P[i];
            const prev = P[Math.max(0, i - 1)], next = P[Math.min(P.length - 1, i + 1)];
            let n1x = 0, n1z = 0, n2x = 0, n2z = 0;
            if (i > 0) { const L = Math.hypot(p.x - prev.x, p.z - prev.z) || 1; n1x = -(p.z - prev.z) / L; n1z = (p.x - prev.x) / L; }
            if (i < P.length - 1) { const L = Math.hypot(next.x - p.x, next.z - p.z) || 1; n2x = -(next.z - p.z) / L; n2z = (next.x - p.x) / L; }
            if (i === 0) { n1x = n2x; n1z = n2z; }
            if (i === P.length - 1) { n2x = n1x; n2z = n1z; }
            let mx = n1x + n2x, mz = n1z + n2z;
            const ml = Math.hypot(mx, mz) || 1;
            mx /= ml; mz /= ml;
            const d = p.hw + SIDEWALK_GAP;
            const cosA = Math.max(0.5, mx * n1x + mz * n1z);
            off.push({ x: p.x + mx * side * d / cosA, z: p.z + mz * side * d / cosA });
        }
        // Resample along arc length (<= 8 m) and trim at junction ends
        let total = 0;
        const cum = [0];
        for (let i = 1; i < off.length; i++) { total += Math.hypot(off[i].x - off[i - 1].x, off[i].z - off[i - 1].z); cum.push(total); }
        const ownEdges = ch.edgeIds;
        const tStart = trimForNode(ch.startNode, ownEdges);
        const tEnd = trimForNode(ch.endNode, ownEdges);
        if (total - tStart - tEnd < 4) continue;
        const n = Math.max(1, Math.ceil((total - tStart - tEnd) / 8));
        const samples = [];
        let seg = 0;
        for (let k = 0; k <= n; k++) {
            const s = tStart + ((total - tStart - tEnd) * k) / n;
            while (seg < off.length - 2 && cum[seg + 1] < s) seg++;
            const L = cum[seg + 1] - cum[seg] || 1;
            const t = Math.max(0, Math.min(1, (s - cum[seg]) / L));
            samples.push({ x: off[seg].x + (off[seg + 1].x - off[seg].x) * t, z: off[seg].z + (off[seg + 1].z - off[seg].z) * t });
        }
        // Keep only valid points: urban, clear of other streets, buildings, water and mapped sidewalks
        const keep = samples.map((p) =>
            clearOfRoads(p.x, p.z, 0.9) &&
            !inBuilding(p.x, p.z, 0.6) &&
            !inBlocker(p.x, p.z) &&
            !nearMappedWalk(p.x, p.z, 4.5) &&
            nearBuildings(p.x, p.z, 55) >= 1
        );
        let run = [];
        const flush = () => {
            if (run.length >= 2) {
                addWalkPolyline(run.map((p) => addWalkNode(p.x, p.z, 0.8)));
                synthPieces++;
            }
            run = [];
        };
        for (let i = 0; i < samples.length; i++) {
            if (keep[i]) run.push(samples[i]);
            else flush();
        }
        flush();
    }
}
console.log(`mapped walk nodes ${mappedNodeCount}, synthesized sidewalk pieces ${synthPieces}, total nodes ${WX.length}`);

// 5c. Stitch dangling ends: corner links (no street crossed) and crosswalks (exactly one street crossed)
function segClearOfBuildings(ax, az, bx, bz) {
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(L / 1.0));
    for (let k = 1; k < n; k++) {
        const t = k / n;
        if (inBuilding(ax + (bx - ax) * t, az + (bz - az) * t, 0.2)) return false;
    }
    return true;
}
function graphNear(a, b, hops) {
    // BFS limited to `hops` from a; true if b reached
    let frontier = [a];
    const seen = new Set([a]);
    for (let h = 0; h < hops; h++) {
        const nf = [];
        for (const n of frontier) {
            for (const [m] of WADJ[n]) {
                if (m === b) return true;
                if (!seen.has(m)) { seen.add(m); nf.push(m); }
            }
        }
        frontier = nf;
    }
    return false;
}
let corners = 0, crosswalks = 0;
const dangling = [];
for (let i = 0; i < WX.length; i++) if (WADJ[i].length <= 1) dangling.push(i);
for (const p of dangling) {
    const px = WX[p], pz = WZ[p];
    const cx = Math.floor(px / WCELL), cz = Math.floor(pz / WCELL);
    let bestCorner = -1, bestCornerD = 9;
    const bestCross = new Map();
    for (let i = cx - 3; i <= cx + 3; i++) {
        for (let j = cz - 3; j <= cz + 3; j++) {
            const arr = walkGrid.get(wkey(i, j));
            if (!arr) continue;
            for (const q of arr) {
                if (q === p) continue;
                const d = Math.hypot(WX[q] - px, WZ[q] - pz);
                if (d > 22 || d < 0.3) continue;
                const crossed = roadsCrossed(px, pz, WX[q], WZ[q], _crossed);
                if (crossed.length === 0) {
                    if (d < bestCornerD && !graphNear(p, q, 4) && segClearOfBuildings(px, pz, WX[q], WZ[q])) {
                        bestCornerD = d;
                        bestCorner = q;
                    }
                } else if (crossed.length === 1) {
                    const road = crossed[0];
                    if (d > road.halfW * 2 + 7) continue;
                    if (!clearOfRoads(WX[q], WZ[q], 0.5)) continue;
                    // Crosswalks run roughly square to the street they cross
                    const rn = nearestRoad((px + WX[q]) / 2, (pz + WZ[q]) / 2, 12);
                    if (!rn) continue;
                    const sx = rn.seg.bx - rn.seg.ax, sz = rn.seg.bz - rn.seg.az;
                    const cosA = Math.abs(((WX[q] - px) * sx + (WZ[q] - pz) * sz) / (d * (Math.hypot(sx, sz) || 1)));
                    if (cosA > 0.6) continue;
                    const prev = bestCross.get(road.id);
                    if (!prev || d < prev.d) bestCross.set(road.id, { q, d });
                }
            }
        }
    }
    if (bestCorner >= 0) { addWalkEdge(p, bestCorner, 0); corners++; }
    const crossList = [...bestCross.values()].sort((a, b) => a.d - b.d).slice(0, 2);
    for (const c of crossList) {
        if (!hasEdge(p, c.q)) { addWalkEdge(p, c.q, 1); crosswalks++; }
    }
}
console.log(`stitched corners ${corners}, crosswalks ${crosswalks}`);

// 5d. Drop tiny islands
const comp = new Int32Array(WX.length).fill(-1);
const compSize = [];
for (let i = 0; i < WX.length; i++) {
    if (comp[i] >= 0) continue;
    const c = compSize.length;
    let size = 0;
    const stack = [i];
    comp[i] = c;
    while (stack.length) {
        const n = stack.pop();
        size++;
        for (const [m] of WADJ[n]) if (comp[m] < 0) { comp[m] = c; stack.push(m); }
    }
    compSize.push(size);
}
const remap = new Int32Array(WX.length).fill(-1);
const outX = [], outZ = [];
for (let i = 0; i < WX.length; i++) {
    if (compSize[comp[i]] < 8) continue;
    remap[i] = outX.length;
    outX.push(WX[i]); outZ.push(WZ[i]);
}
const outEdges = [];
let crossingEdgeCount = 0;
for (let i = 0; i < WX.length; i++) {
    if (remap[i] < 0) continue;
    for (const [j, kind] of WADJ[i]) {
        if (j > i && remap[j] >= 0) {
            outEdges.push(remap[i], remap[j], kind);
            if (kind === 1) crossingEdgeCount++;
        }
    }
}
console.timeEnd('walk graph');
console.log(`walk graph: ${outX.length} nodes, ${outEdges.length / 3} edges (${crossingEdgeCount} crossings)`);

// Grid over final walk nodes for access-node lookups
const finalGrid = new Map();
const FCELL = 16;
for (let i = 0; i < outX.length; i++) {
    const k = wkey(Math.floor(outX[i] / FCELL), Math.floor(outZ[i] / FCELL));
    let arr = finalGrid.get(k);
    if (!arr) { arr = []; finalGrid.set(k, arr); }
    arr.push(i);
}
/** Nearest walk node reachable from (x, z) in a straight line without crossing a street or a building. */
function accessNode(x, z, maxD = 35) {
    const cx = Math.floor(x / FCELL), cz = Math.floor(z / FCELL);
    const r = Math.ceil(maxD / FCELL);
    const cand = [];
    for (let i = cx - r; i <= cx + r; i++) {
        for (let j = cz - r; j <= cz + r; j++) {
            const arr = finalGrid.get(wkey(i, j));
            if (!arr) continue;
            for (const n of arr) {
                const d = Math.hypot(outX[n] - x, outZ[n] - z);
                if (d <= maxD) cand.push([d, n]);
            }
        }
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (let k = 0; k < Math.min(cand.length, 8); k++) {
        const n = cand[k][1];
        if (roadsCrossed(x, z, outX[n], outZ[n], _crossed).length) continue;
        if (!segClearOfBuildings(x, z, outX[n], outZ[n])) continue;
        return n;
    }
    return -1;
}

// ---------------------------------------------------------------------------------------------
// 6. Furniture, seats and hangout spots
// ---------------------------------------------------------------------------------------------
console.time('places');
const FURN = { LAWN_CHAIR: 0, PATIO_CHAIR: 1, PATIO_TABLE: 2, BENCH: 3 };
const furniture = []; // [type, x, z, yaw]
const seats = [];     // [x, z, yaw, access, cluster, furnitureType]
const hangouts = [];  // [x, z, access]
const placedGrid = new BoxGrid(10);
let clusterId = 0;
function spotFree(x, z, r) {
    const s = nextStamp();
    for (const p of placedGrid.query(x - r, z - r, x + r, z + r, _q, s)) {
        if (Math.hypot(p.x - x, p.z - z) < r) return false;
    }
    return true;
}
function markPlaced(x, z) {
    placedGrid.insert({ x, z }, x, z, x, z);
}
const facing = (fx, fz) => Math.atan2(fx, fz); // yaw that makes a +Z-forward model face (fx, fz)
function groundOk(x, z, buildingMargin = 0.8, roadExtra = 1.2) {
    return !inBuilding(x, z, buildingMargin) && !inBlocker(x, z) && clearOfRoads(x, z, roadExtra) && !isAsphalt(x, z);
}

// 6a. Front-yard lawn chairs and front-lawn hangouts at houses facing a street
let lawnSets = 0, yardHangouts = 0;
for (const b of buildings) {
    if (!b.house || b.area < 50 || b.area > 450) continue;
    const roll = hash32(b.way.id);
    if (roll > 0.42) continue;
    const near = nearestRoad(b.c.x, b.c.z, 45);
    if (!near || near.d < 6) continue;
    const seg = near.seg;
    // Foot point on the street
    const sx = seg.bx - seg.ax, sz = seg.bz - seg.az;
    const sl2 = sx * sx + sz * sz || 1;
    const t = Math.max(0, Math.min(1, ((b.c.x - seg.ax) * sx + (b.c.z - seg.az) * sz) / sl2));
    const fx = seg.ax + sx * t, fz = seg.az + sz * t;
    const vx = (fx - b.c.x) / near.d, vz = (fz - b.c.z) / near.d;
    // March from the house centre to its front wall
    let ex = b.c.x, ez = b.c.z, s = 0;
    while (s < near.d && pointInRing(ex, ez, b.ring)) { s += 0.5; ex = b.c.x + vx * s; ez = b.c.z + vz * s; }
    const yardDepth = near.d - s - seg.e.halfW - SIDEWALK_GAP - 1.0;
    if (yardDepth < 4) continue;
    if (roll < 0.28) {
        // Two lawn chairs a couple of metres in front of the house, facing the street; slide along
        // the front of the house to keep clear of the driveway
        const lx = -vz, lz = vx;
        let spots = null, cx = 0, cz = 0;
        for (const shift of [0, 2.5, -2.5, 4.5, -4.5]) {
            cx = ex + vx * 2.4 + lx * shift;
            cz = ez + vz * 2.4 + lz * shift;
            const cand = [[cx + lx * 0.6, cz + lz * 0.6], [cx - lx * 0.6, cz - lz * 0.6]];
            if (cand.every(([x, z]) => groundOk(x, z, 0.9, 3.0) && !nearService(x, z, 2.0) && spotFree(x, z, 2))) {
                spots = cand;
                break;
            }
        }
        if (!spots) continue;
        const acc = accessNode(cx, cz);
        if (acc < 0) continue;
        const yaw = facing(vx, vz);
        const cl = clusterId++;
        for (const [x, z] of spots) {
            furniture.push([FURN.LAWN_CHAIR, x, z, yaw]);
            seats.push([x, z, yaw, acc, cl, FURN.LAWN_CHAIR]);
            markPlaced(x, z);
        }
        lawnSets++;
    } else {
        const hx = ex + vx * Math.min(yardDepth * 0.5, 6), hz = ez + vz * Math.min(yardDepth * 0.5, 6);
        if (!groundOk(hx, hz, 2.0, 3.0) || nearService(hx, hz, 3) || !spotFree(hx, hz, 6)) continue;
        const acc = accessNode(hx, hz);
        if (acc < 0) continue;
        hangouts.push([hx, hz, acc]);
        markPlaced(hx, hz);
        yardHangouts++;
    }
}

// 6b. Café / restaurant patio sets on the sidewalk side of the building
let patios = 0;
for (const am of amenities) {
    const acc0 = accessNode(am.x, am.z, 60);
    let n = acc0;
    if (n < 0) {
        // Building centroids are inside walls, so fall back to the nearest node regardless of line of sight
        let best = -1, bestD = 60;
        const cx = Math.floor(am.x / FCELL), cz = Math.floor(am.z / FCELL);
        for (let i = cx - 4; i <= cx + 4; i++) for (let j = cz - 4; j <= cz + 4; j++) {
            const arr = finalGrid.get(wkey(i, j));
            if (arr) for (const q of arr) { const d = Math.hypot(outX[q] - am.x, outZ[q] - am.z); if (d < bestD) { bestD = d; best = q; } }
        }
        n = best;
    }
    if (n < 0) continue;
    const dx = am.x - outX[n], dz = am.z - outZ[n];
    const dl = Math.hypot(dx, dz) || 1;
    const vx = dx / dl, vz = dz / dl;
    let placed = 0;
    for (const dist of [2.6, 3.4, 4.2]) {
        for (const lat of [0, 3, -3, 6, -6]) {
            if (placed >= 2) break;
            const tx = outX[n] + vx * dist + -vz * lat, tz = outZ[n] + vz * dist + vx * lat;
            const chairs = [[0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]];
            const pts = chairs.map(([a, c]) => [tx + -vz * a + vx * c, tz + vx * a + vz * c]);
            if (!groundOk(tx, tz, 0.9, 1.6) || !pts.every(([x, z]) => groundOk(x, z, 0.4, 1.4)) || !spotFree(tx, tz, 2.6)) continue;
            const acc = accessNode(tx, tz, 20);
            if (acc < 0) continue;
            const cl = clusterId++;
            furniture.push([FURN.PATIO_TABLE, tx, tz, facing(vx, vz)]);
            const nChairs = hash32(Math.floor(tx * 7 + tz * 13)) < 0.5 ? 2 : 4;
            for (let k = 0; k < nChairs; k++) {
                const [x, z] = pts[k];
                const yaw = facing(tx - x, tz - z);
                furniture.push([FURN.PATIO_CHAIR, x, z, yaw]);
                seats.push([x, z, yaw, acc, cl, FURN.PATIO_CHAIR]);
            }
            markPlaced(tx, tz);
            placed++;
            patios++;
        }
    }
}

// 6c. Park benches along paths through green spaces, bus-stop benches
const greenGrid = new BoxGrid(60);
for (const g of greens) {
    g.bb = bboxOfRing(g.ring);
    g.area = ringArea(g.ring);
    greenGrid.insert(g, g.bb.minX, g.bb.minZ, g.bb.maxX, g.bb.maxZ);
}
function inGreen(x, z) {
    const s = nextStamp();
    for (const g of greenGrid.query(x, z, x, z, _q, s)) {
        if (x < g.bb.minX || x > g.bb.maxX || z < g.bb.minZ || z > g.bb.maxZ) continue;
        if (pointInRing(x, z, g.ring)) return g;
    }
    return null;
}
function tooCloseToOsmBench(x, z) {
    for (const b of osmBenches) if (Math.abs(b.x - x) < 3 && Math.abs(b.z - z) < 3) return true;
    return false;
}
function placeBench(x, z, yaw, acc) {
    const ax = Math.cos(yaw), az = -Math.sin(yaw); // bench long axis (model +X)
    const cl = clusterId++;
    furniture.push([FURN.BENCH, x, z, yaw]);
    seats.push([x + ax * 0.45, z + az * 0.45, yaw, acc, cl, FURN.BENCH]);
    seats.push([x - ax * 0.45, z - az * 0.45, yaw, acc, cl, FURN.BENCH]);
    markPlaced(x, z);
}
let benches = 0;
for (const w of walkWays) {
    if (w.tags.footway === 'sidewalk' || w.tags.footway === 'crossing') continue;
    let acc = 0;
    for (let i = 0; i + 1 < w.refs.length; i++) {
        const ax = NX[w.refs[i]], az = NZ[w.refs[i]], bx = NX[w.refs[i + 1]], bz = NZ[w.refs[i + 1]];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 1) continue;
        const ux = (bx - ax) / L, uz = (bz - az) / L;
        for (let s = (40 - acc % 40); s < L; s += 40) {
            const px = ax + ux * s, pz = az + uz * s;
            const g = inGreen(px, pz);
            if (!g || !g.park) continue;
            const side = hash32(Math.floor(px * 3 + pz * 5)) < 0.5 ? 1 : -1;
            const nx = -uz * side, nz = ux * side;
            const x = px + nx * 1.5, z = pz + nz * 1.5;
            if (!groundOk(x, z, 1.2, 3) || !spotFree(x, z, 12) || tooCloseToOsmBench(x, z)) continue;
            const node = osmWalkNode.get(w.refs[i]);
            const acc2 = node !== undefined && remap[node] >= 0 ? remap[node] : accessNode(x, z, 20);
            if (acc2 < 0) continue;
            placeBench(x, z, facing(-nx, -nz), acc2);
            benches++;
        }
        acc += L;
    }
}
for (const st of busStops) {
    const near = nearestRoad(st.x, st.z, 20);
    if (!near) continue;
    const seg = near.seg;
    const sx = seg.bx - seg.ax, sz = seg.bz - seg.az;
    const sl = Math.hypot(sx, sz) || 1;
    let nx = -sz / sl, nz = sx / sl;
    if ((st.x - seg.ax) * nx + (st.z - seg.az) * nz < 0) { nx = -nx; nz = -nz; }
    const t = ((st.x - seg.ax) * sx + (st.z - seg.az) * sz) / (sl * sl);
    const fx = seg.ax + sx * t, fz = seg.az + sz * t;
    const d = seg.e.halfW + SIDEWALK_GAP + 2.2;
    const x = fx + nx * d, z = fz + nz * d;
    if (!groundOk(x, z, 0.8, 1.5) || !spotFree(x, z, 4) || tooCloseToOsmBench(x, z)) continue;
    const acc = accessNode(x, z, 20);
    if (acc < 0) continue;
    placeBench(x, z, facing(-nx, -nz), acc);
    benches++;
}

// 6d. Hangout spots on open grass in parks, greens and playing fields
let greenHangouts = 0;
for (const g of greens) {
    if (g.area < 250) continue;
    const step = 24;
    const ox = hash32(Math.floor(g.bb.minX)) * step, oz = hash32(Math.floor(g.bb.minZ)) * step;
    let count = 0;
    for (let x = g.bb.minX + ox; x <= g.bb.maxX && count < 10; x += step) {
        for (let z = g.bb.minZ + oz; z <= g.bb.maxZ && count < 10; z += step) {
            if (!pointInRing(x, z, g.ring)) continue;
            if (ringEdgeDist(x, z, g.ring) < 2.5) continue;
            if (!groundOk(x, z, 3, 5) || nearMappedWalk(x, z, 2) || !spotFree(x, z, 10)) continue;
            const acc = accessNode(x, z, 45);
            if (acc < 0) continue;
            hangouts.push([x, z, acc]);
            markPlaced(x, z);
            count++;
            greenHangouts++;
        }
    }
}
console.timeEnd('places');
console.log(`furniture ${furniture.length} (lawn sets ${lawnSets}, patios ${patios}, benches ${benches}), seats ${seats.length}, hangouts ${hangouts.length} (yards ${yardHangouts}, greens ${greenHangouts})`);

// ---------------------------------------------------------------------------------------------
// 7. Write compact JSON (positions in decimetres, angles in milliradians)
// ---------------------------------------------------------------------------------------------
const dm = (v) => Math.round(v * 10);
const mr = (v) => Math.round(v * 1000);
const roadsOut = roadEdges.map((e) => {
    const flat = [];
    let px = null, pz = null;
    for (const r of e.pts) {
        const x = dm(NX[r]), z = dm(NZ[r]);
        if (x === px && z === pz) continue;
        flat.push(x, z);
        px = x; pz = z;
    }
    return [e.a, e.b, e.oneway, dm(e.halfW), e.lanes, Math.round(e.speed * 10), Math.round(e.cls.weight * 10), flat];
}).filter((r) => r[7].length >= 4);

const out = {
    version: 1,
    generated: new Date().toISOString().slice(0, 10),
    units: 'positions in decimetres, angles in milliradians',
    bounds: [dm(bMinX), dm(bMinZ), dm(bMaxX), dm(bMaxZ)],
    roadNodes: graphNodes.map((n) => [dm(n.x), dm(n.z)]).flat(),
    // [nodeA, nodeB, oneway, halfWidth, lanes, speed(dm/s), spawnWeight(x10), [x,z,...]]
    roads: roadsOut,
    walk: {
        x: outX.map(dm),
        z: outZ.map(dm),
        // [a, b, kind] triplets, kind 1 = crosses a street
        e: outEdges
    },
    // [type, x, z, yaw]  type 0 lawn chair, 1 patio chair, 2 patio table, 3 bench
    furniture: furniture.map(([t, x, z, y]) => [t, dm(x), dm(z), mr(y)]).flat(),
    // [x, z, yaw, accessNode, cluster, furnitureType]
    seats: seats.map(([x, z, y, a, c, t]) => [dm(x), dm(z), mr(y), a, c, t]).flat(),
    // [x, z, accessNode]
    hangouts: hangouts.map(([x, z, a]) => [dm(x), dm(z), a]).flat()
};
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
const json = JSON.stringify(out);
fs.writeFileSync(OUT_FILE, json);
console.log(`wrote ${path.relative(ROOT, OUT_FILE)} (${(json.length / 1024 / 1024).toFixed(2)} MB)`);

// ---------------------------------------------------------------------------------------------
// Optional debug render: node tools/buildCityNav.mjs --debug <x> <z> <size> <out.png>
// ---------------------------------------------------------------------------------------------
const dbgAt = process.argv.indexOf('--debug');
if (dbgAt > 0) {
    const zlib = await import('zlib');
    const [cxs, czs, sizes, outPng] = process.argv.slice(dbgAt + 1);
    const CX = +cxs, CZ = +czs, SIZE = +sizes, PX = 1000;
    const scale = PX / SIZE;
    const img = new Uint8Array(PX * PX * 3).fill(0);
    const put = (x, z, r, g, b) => {
        const i = Math.floor((x - CX + SIZE / 2) * scale), j = Math.floor((z - CZ + SIZE / 2) * scale);
        if (i < 0 || j < 0 || i >= PX || j >= PX) return;
        const o = (j * PX + i) * 3;
        img[o] = r; img[o + 1] = g; img[o + 2] = b;
    };
    for (let j = 0; j < PX; j++) for (let i = 0; i < PX; i++) {
        const x = CX - SIZE / 2 + i / scale, z = CZ - SIZE / 2 + j / scale;
        const o = (j * PX + i) * 3;
        if (isAsphalt(x, z)) { img[o] = 70; img[o + 1] = 70; img[o + 2] = 70; }
        else if (inBuilding(x, z)) { img[o] = 120; img[o + 1] = 90; img[o + 2] = 60; }
        else if (inGreen(x, z)) { img[o] = 20; img[o + 1] = 70; img[o + 2] = 20; }
        else { img[o] = 25; img[o + 1] = 40; img[o + 2] = 25; }
    }
    const line = (ax, az, bx, bz, c) => {
        const n = Math.ceil(Math.hypot(bx - ax, bz - az) * scale * 2) + 1;
        for (let k = 0; k <= n; k++) put(ax + (bx - ax) * k / n, az + (bz - az) * k / n, ...c);
    };
    for (const s of roadSegs) line(s.ax, s.az, s.bx, s.bz, [200, 200, 0]);
    for (let i = 0; i < outEdges.length; i += 3) {
        const a = outEdges[i], b = outEdges[i + 1];
        line(outX[a], outZ[a], outX[b], outZ[b], outEdges[i + 2] === 1 ? [255, 40, 40] : (a < mappedNodeCount ? [120, 200, 255] : [255, 255, 255]));
    }
    const dot = (x, z, r, c) => { for (let dx = -r; dx <= r; dx += 0.2) for (let dz = -r; dz <= r; dz += 0.2) put(x + dx, z + dz, ...c); };
    for (const [t, x, z] of furniture) dot(x, z, 0.5, t === 3 ? [255, 140, 0] : t === 2 ? [255, 0, 255] : [0, 255, 255]);
    for (const [x, z] of hangouts) dot(x, z, 1.2, [0, 255, 0]);
    const raw = Buffer.alloc((PX * 3 + 1) * PX);
    for (let j = 0; j < PX; j++) { raw[j * (PX * 3 + 1)] = 0; Buffer.from(img.buffer, j * PX * 3, PX * 3).copy(raw, j * (PX * 3 + 1) + 1); }
    const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
    const crc = (buf) => { let c = -1; for (const b of buf) c = crcT[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
    const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(PX, 0); ihdr.writeUInt32BE(PX, 4); ihdr[8] = 8; ihdr[9] = 2;
    fs.writeFileSync(outPng, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
    console.log(`debug image -> ${outPng}`);
}
