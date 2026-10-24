/**
 * tools/buildStreetSigns.mjs
 *
 * Bakes street-name signs from the OSM extract /mapfinal was exported from
 * (newmap2/OSM2World-latest-bin/map.osm), the same streets as StreetNames.png:
 *   - every junction where two differently named streets meet gets a corner post with one blade
 *     per street, each blade running parallel to the street it names
 *   - long stretches between named junctions get an extra post every ~250 m
 *   - posts stand just off the rendered asphalt (rasterized from /mapfinal, like buildCityNav)
 *     and never inside a building
 * Names use US sign abbreviations ("East Wooster Street" -> "E Wooster St").
 *
 * Usage: node tools/buildStreetSigns.mjs  ->  js/game/data/streetSigns.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OSM_FILE = path.join(ROOT, 'newmap2/OSM2World-latest-bin/map.osm');
const OBJ_DIR = path.join(ROOT, 'mapfinal');
const OUT_FILE = path.join(ROOT, 'js/game/data/streetSigns.json');

// Must match ANOTHERMAPO_CONFIG.MAP_OFFSET in js/game/mapLoader.js
const MAP_OFFSET = { x: -2324.73, z: -748.02 };

// Named streets that get signs (motorways and their ramps don't)
const SIGNED = new Set([
    'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
    'primary_link', 'secondary_link', 'tertiary_link'
]);
const JUNCTION_MERGE = 22;      // same pair of names within this many metres is one junction
const MID_BLOCK = 250;          // a post every this many metres along long named stretches
const CURB = 1.1;               // post stands this far beyond the asphalt edge

function hash32(n) {
    let h = (n | 0) ^ 0x9e3779b9;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------------------------
// Street name abbreviations, as on US street signs
// ---------------------------------------------------------------------------------------------
const DIRS = { North: 'N', South: 'S', East: 'E', West: 'W', Northeast: 'NE', Northwest: 'NW', Southeast: 'SE', Southwest: 'SW' };
const SUFFIX = {
    Street: 'St', Avenue: 'Ave', Road: 'Rd', Drive: 'Dr', Boulevard: 'Blvd', Lane: 'Ln', Court: 'Ct',
    Place: 'Pl', Circle: 'Cir', Highway: 'Hwy', Parkway: 'Pkwy', Terrace: 'Ter', Trail: 'Trl',
    Square: 'Sq', Way: 'Way', Pike: 'Pike', Point: 'Pt', Crossing: 'Xing', Expressway: 'Expy'
};
function signName(name) {
    const words = name.trim().split(/\s+/);
    // "East Wooster Street" -> "E Wooster St", but "South Street" stays "South St"
    if (words.length > 2 && DIRS[words[0]]) words[0] = DIRS[words[0]];
    const last = words.length - 1;
    if (last > 0 && SUFFIX[words[last]]) words[last] = SUFFIX[words[last]];
    // "Bowling Green Road East" -> "Bowling Green Rd E"
    if (last > 1 && DIRS[words[last]] && SUFFIX[words[last - 1]]) {
        words[last - 1] = SUFFIX[words[last - 1]];
        words[last] = DIRS[words[last]];
    }
    return words.join(' ');
}

// ---------------------------------------------------------------------------------------------
// 1. Parse OSM (same projection as buildCityNav)
// ---------------------------------------------------------------------------------------------
console.time('parse osm');
const osm = fs.readFileSync(OSM_FILE, 'utf8');
const bm = /<bounds minlat="([-\d.]+)" minlon="([-\d.]+)" maxlat="([-\d.]+)" maxlon="([-\d.]+)"/.exec(osm);
const LAT0 = (parseFloat(bm[1]) + parseFloat(bm[3])) / 2;
const LON0 = (parseFloat(bm[2]) + parseFloat(bm[4])) / 2;
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
    const re = /<tag k="([^"]*)" v="([^"]*)"\s*\/>/g;
    let m;
    while ((m = re.exec(body))) tags[m[1]] = m[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    return tags;
}

const nodeIndex = new Map();
const NX = [], NZ = [];
{
    const re = /<node id="(\d+)" lat="([-\d.]+)" lon="([-\d.]+)"/g;
    let m;
    while ((m = re.exec(osm))) {
        const [x, z] = project(parseFloat(m[2]), parseFloat(m[3]));
        nodeIndex.set(m[1], NX.length);
        NX.push(x);
        NZ.push(z);
    }
}
const streets = [];
const buildingRings = [];
{
    const re = /<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g;
    let m;
    while ((m = re.exec(osm))) {
        const tags = parseTags(m[2]);
        const isStreet = tags.highway && SIGNED.has(tags.highway) && tags.name && tags.area !== 'yes';
        const isBuilding = tags.building && tags.building !== 'no' && tags.building !== 'roof';
        if (!isStreet && !isBuilding) continue;
        const refs = [];
        const nre = /<nd ref="(\d+)"\/>/g;
        let n;
        while ((n = nre.exec(m[2]))) {
            const idx = nodeIndex.get(n[1]);
            if (idx !== undefined) refs.push(idx);
        }
        if (refs.length < 2) continue;
        if (isStreet) streets.push({ refs, name: signName(tags.name), hw: tags.highway });
        if (isBuilding && refs.length >= 4) {
            const ring = [];
            for (const r of refs) ring.push(NX[r], NZ[r]);
            buildingRings.push(ring);
        }
    }
}
console.timeEnd('parse osm');
console.log(`named streets ${streets.length}, buildings ${buildingRings.length}`);

// ---------------------------------------------------------------------------------------------
// 2. Rendered asphalt (1 m bitset) and buildings (grid), to keep posts off roads and out of houses
// ---------------------------------------------------------------------------------------------
console.time('asphalt raster');
const RX0 = Math.floor(bMinX) - 64, RZ0 = Math.floor(bMinZ) - 64;
const RW = Math.ceil(bMaxX - bMinX) + 128, RH = Math.ceil(bMaxZ - bMinZ) + 128;
const asphalt = new Uint8Array(Math.ceil((RW * RH) / 8));
function setCell(x, z) {
    if (x < RX0 || z < RZ0 || x >= RX0 + RW || z >= RZ0 + RH) return;
    const i = (z - RZ0) * RW + (x - RX0);
    asphalt[i >> 3] |= 1 << (i & 7);
}
function isAsphalt(x, z) {
    const cx = Math.floor(x), cz = Math.floor(z);
    if (cx < RX0 || cz < RZ0 || cx >= RX0 + RW || cz >= RZ0 + RH) return false;
    const i = (cz - RZ0) * RW + (cx - RX0);
    return (asphalt[i >> 3] & (1 << (i & 7))) !== 0;
}
let rasterOk = false;
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
                    rasterOk = true;
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
if (!rasterOk) console.warn('No /mapfinal asphalt found: posts are placed from estimated road widths');

const BCELL = 50;
const bgrid = new Map();
buildingRings.forEach((ring, i) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < ring.length; k += 2) {
        x0 = Math.min(x0, ring[k]); x1 = Math.max(x1, ring[k]);
        z0 = Math.min(z0, ring[k + 1]); z1 = Math.max(z1, ring[k + 1]);
    }
    for (let gx = Math.floor(x0 / BCELL); gx <= Math.floor(x1 / BCELL); gx++) {
        for (let gz = Math.floor(z0 / BCELL); gz <= Math.floor(z1 / BCELL); gz++) {
            const key = gx * 100003 + gz;
            if (!bgrid.has(key)) bgrid.set(key, []);
            bgrid.get(key).push(i);
        }
    }
});
function pointInRing(px, pz, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
        if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
}
function inBuilding(x, z) {
    // A little margin: test the post and four points 0.6 m around it
    for (const [ox, oz] of [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]) {
        const list = bgrid.get(Math.floor((x + ox) / BCELL) * 100003 + Math.floor((z + oz) / BCELL));
        if (list && list.some((i) => pointInRing(x + ox, z + oz, buildingRings[i]))) return true;
    }
    return false;
}
const ROAD_HALF = { trunk: 7, primary: 6.5, secondary: 6, tertiary: 5, unclassified: 4.2, residential: 4, living_street: 3 };
function onRoad(x, z) {
    if (rasterOk) {
        // The post and the space a pedestrian needs around it
        for (const [ox, oz] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) if (isAsphalt(x + ox, z + oz)) return true;
        return false;
    }
    return false;
}

// ---------------------------------------------------------------------------------------------
// 3. Where named streets meet
// ---------------------------------------------------------------------------------------------
// node -> [{ name, dx, dz, hw }] (street direction at the node)
const atNode = new Map();
for (const s of streets) {
    for (let i = 0; i < s.refs.length; i++) {
        const a = s.refs[Math.max(0, i - 1)], b = s.refs[Math.min(s.refs.length - 1, i + 1)];
        let dx = NX[b] - NX[a], dz = NZ[b] - NZ[a];
        const L = Math.hypot(dx, dz) || 1;
        dx /= L; dz /= L;
        const r = s.refs[i];
        if (!atNode.has(r)) atNode.set(r, []);
        atNode.get(r).push({ name: s.name, dx, dz, hw: s.hw });
    }
}

const names = [];
const nameId = new Map();
function nid(n) {
    if (!nameId.has(n)) {
        nameId.set(n, names.length);
        names.push(n);
    }
    return nameId.get(n);
}

const signs = [];     // { x, z, blades: [[nameId, angle], ...] }
const placedPairs = new Map(); // "a|b" -> [[x, z]]

/** Tries the four corners of a junction (then wider) for a dry, building-free spot. */
function placeAt(jx, jz, A, B, seed) {
    const order = [0, 1, 2, 3].sort((p, q) => hash32(seed * 7 + p) - hash32(seed * 7 + q));
    for (const quad of order) {
        const sa = quad & 1 ? 1 : -1, sb = quad & 2 ? 1 : -1;
        // Diagonal between the two streets in this quadrant
        let ux = A.dx * sa + B.dx * sb, uz = A.dz * sa + B.dz * sb;
        const L = Math.hypot(ux, uz);
        if (L < 0.3) continue;
        ux /= L; uz /= L;
        // Walk out from the junction until clear of asphalt, then step onto the verge
        const start = rasterOk ? 2 : (ROAD_HALF[A.hw] || 4) + (ROAD_HALF[B.hw] || 4) * 0.5;
        for (let d = start; d < 26; d += 0.5) {
            const x = jx + ux * d, z = jz + uz * d;
            if (onRoad(x, z)) continue;
            const px = jx + ux * (d + CURB), pz = jz + uz * (d + CURB);
            if (onRoad(px, pz) || inBuilding(px, pz)) break;
            return { x: px, z: pz };
        }
    }
    return null;
}

function nearPair(key, x, z, dist) {
    const list = placedPairs.get(key);
    return !!list && list.some(([px, pz]) => Math.hypot(px - x, pz - z) < dist);
}

let junctions = 0, unplaced = 0;
for (const [node, list] of atNode) {
    // One entry per distinct name (the first direction seen)
    const byName = new Map();
    for (const e of list) if (!byName.has(e.name)) byName.set(e.name, e);
    if (byName.size < 2) continue;
    const entries = [...byName.values()];
    const jx = NX[node], jz = NZ[node];
    // Two biggest streets at the junction name the sign (a third gets its own blade if room)
    const rank = { trunk: 0, primary: 1, secondary: 2, tertiary: 3, unclassified: 4, residential: 5, living_street: 6 };
    entries.sort((a, b) => (rank[a.hw.replace('_link', '')] ?? 9) - (rank[b.hw.replace('_link', '')] ?? 9));
    const [A, B] = entries;
    if (Math.abs(A.dx * B.dz - A.dz * B.dx) < 0.25) continue; // nearly parallel: a fork, not a crossing
    const key = [A.name, B.name].sort().join('|');
    if (nearPair(key, jx, jz, JUNCTION_MERGE)) continue;
    const spot = placeAt(jx, jz, A, B, node);
    if (!spot) {
        unplaced++;
        continue;
    }
    junctions++;
    if (!placedPairs.has(key)) placedPairs.set(key, []);
    placedPairs.get(key).push([jx, jz]);
    const blades = [[nid(A.name), Math.atan2(A.dx, A.dz)], [nid(B.name), Math.atan2(B.dx, B.dz)]];
    if (entries[2] && Math.abs(entries[2].dx * A.dz - entries[2].dz * A.dx) > 0.25 &&
        Math.abs(entries[2].dx * B.dz - entries[2].dz * B.dx) > 0.25) {
        blades.push([nid(entries[2].name), Math.atan2(entries[2].dx, entries[2].dz)]);
    }
    signs.push({ x: spot.x, z: spot.z, blades });
}

// Mid-block reminders along long named streets
let midBlock = 0;
for (const s of streets) {
    let run = 0;
    for (let i = 1; i < s.refs.length; i++) {
        const a = s.refs[i - 1], b = s.refs[i];
        const seg = Math.hypot(NX[b] - NX[a], NZ[b] - NZ[a]);
        run += seg;
        if (run < MID_BLOCK) continue;
        run = 0;
        const dx = (NX[b] - NX[a]) / (seg || 1), dz = (NZ[b] - NZ[a]) / (seg || 1);
        const side = hash32(b) < 0.5 ? 1 : -1;
        const nx = -dz * side, nz = dx * side;
        const mx = (NX[a] + NX[b]) / 2, mz = (NZ[a] + NZ[b]) / 2;
        if (nearPair(s.name, mx, mz, MID_BLOCK * 0.6)) continue;
        let spot = null;
        for (let d = 2; d < 20 && !spot; d += 0.5) {
            const x = mx + nx * d, z = mz + nz * d;
            if (onRoad(x, z)) continue;
            const px = mx + nx * (d + CURB), pz = mz + nz * (d + CURB);
            if (onRoad(px, pz) || inBuilding(px, pz)) break;
            spot = { x: px, z: pz };
        }
        if (!spot) continue;
        if (!placedPairs.has(s.name)) placedPairs.set(s.name, []);
        placedPairs.get(s.name).push([mx, mz]);
        signs.push({ x: spot.x, z: spot.z, blades: [[nid(s.name), Math.atan2(dx, dz)]] });
        midBlock++;
    }
}

// ---------------------------------------------------------------------------------------------
// 4. Write (positions in decimetres, angles in milliradians)
// ---------------------------------------------------------------------------------------------
const dm = (v) => Math.round(v * 10);
const mr = (a) => Math.round(a * 1000);
const out = {
    version: 1,
    generated: new Date().toISOString().slice(0, 10),
    units: 'positions in decimetres, angles in milliradians',
    names,
    // Each sign: x, z, blade count, then [name index, angle] per blade
    signs: signs.flatMap((s) => [dm(s.x), dm(s.z), s.blades.length, ...s.blades.flatMap(([n, a]) => [n, mr(a)])])
};
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(out));
console.log(`junctions with no room for a post: ${unplaced}`);
console.log(`${signs.length} signs (${junctions} junctions, ${midBlock} mid-block), ${names.length} street names -> ${path.relative(ROOT, OUT_FILE)} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(0)} KB)`);
