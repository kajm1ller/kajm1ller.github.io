/**
 * tools/buildStreetLamps.mjs
 *
 * Bakes street lamps for the day/night cycle from the OSM extract /mapfinal was exported from
 * (newmap2/OSM2World-latest-bin/map.osm):
 *   - the ~800 lamps OSM already maps are rendered by OSM2World into /mapfinal ("StreetLamp" OBJ
 *     objects, 5 m tall); their lantern positions are read straight out of the OBJ files so the game
 *     only has to light them
 *   - every other lit street (everything from residential up) gets cobra-head lamps every ~40-60 m,
 *     staggered from side to side, just off the rendered asphalt and never inside a building or
 *     right next to an existing lamp
 *
 * Usage: node tools/buildStreetLamps.mjs  ->  js/game/data/streetLamps.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OSM_FILE = path.join(ROOT, 'newmap2/OSM2World-latest-bin/map.osm');
const OBJ_DIR = path.join(ROOT, 'mapfinal');
const OUT_FILE = path.join(ROOT, 'js/game/data/streetLamps.json');

// Must match ANOTHERMAPO_CONFIG.MAP_OFFSET in js/game/mapLoader.js
const MAP_OFFSET = { x: -2324.73, z: -748.02 };

// Lamp spacing along each class of street (metres); sides alternate so it reads as staggered
const SPACING = {
    motorway: 70, trunk: 42, primary: 40, secondary: 42, tertiary: 48,
    unclassified: 55, residential: 52, living_street: 45,
    motorway_link: 50, trunk_link: 40, primary_link: 40, secondary_link: 42, tertiary_link: 45
};
const MIN_GAP = 17;   // no new lamp within this many metres of another lamp
const CURB = 0.9;     // pole stands this far beyond the asphalt edge

function hash32(n) {
    let h = (n | 0) ^ 0x9e3779b9;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------------------------
// 1. Parse OSM (same projection as buildCityNav / buildStreetSigns)
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
    while ((m = re.exec(body))) tags[m[1]] = m[2];
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
        const isStreet = tags.highway && SPACING[tags.highway] && tags.area !== 'yes' && tags.lit !== 'no' &&
            tags.tunnel !== 'yes' && tags.tunnel !== 'building_passage';
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
        if (isStreet) streets.push({ refs, hw: tags.highway, bridge: tags.bridge === 'yes', id: +m[1] });
        if (isBuilding && refs.length >= 4) {
            const ring = [];
            for (const r of refs) ring.push(NX[r], NZ[r]);
            buildingRings.push(ring);
        }
    }
}
console.timeEnd('parse osm');
console.log(`lit streets ${streets.length}, buildings ${buildingRings.length}`);

// ---------------------------------------------------------------------------------------------
// 2. /mapfinal: rendered asphalt (1 m bitset) and the OSM2World street lamps already in the map
// ---------------------------------------------------------------------------------------------
console.time('scan obj');
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
const mapLamps = []; // { x, z, y } lantern centre of each OSM2World lamp
let rasterOk = false;
if (fs.existsSync(OBJ_DIR)) {
    for (const f of fs.readdirSync(OBJ_DIR).filter((f) => f.endsWith('.obj'))) {
        const lines = fs.readFileSync(path.join(OBJ_DIR, f), 'utf8').split('\n');
        const V = [];
        let on = false;
        let lamp = null;
        const flushLamp = () => {
            if (lamp && lamp.y1 > lamp.y0) mapLamps.push({ x: (lamp.x0 + lamp.x1) / 2, z: (lamp.z0 + lamp.z1) / 2, y: lamp.y1 - 0.45 });
            lamp = null;
        };
        for (const L of lines) {
            if (L.charCodeAt(0) === 118 && L.charCodeAt(1) === 32) {
                const p = L.split(/\s+/);
                const x = +p[1] + MAP_OFFSET.x, y = +p[2], z = +p[3] + MAP_OFFSET.z;
                V.push(x, z);
                if (lamp) {
                    lamp.x0 = Math.min(lamp.x0, x); lamp.x1 = Math.max(lamp.x1, x);
                    lamp.y0 = Math.min(lamp.y0, y); lamp.y1 = Math.max(lamp.y1, y);
                    lamp.z0 = Math.min(lamp.z0, z); lamp.z1 = Math.max(lamp.z1, z);
                }
            } else if (L.startsWith('o ') || L.startsWith('g ')) {
                if (L.startsWith('o ') || !L.includes('StreetLamp')) flushLamp();
                if (L.startsWith('o ') && L.includes('StreetLamp')) {
                    lamp = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
                }
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
        flushLamp();
    }
}
console.timeEnd('scan obj');
if (!rasterOk) console.warn('No /mapfinal asphalt found: lamps are placed from estimated road widths');
console.log(`OSM2World street lamps in /mapfinal: ${mapLamps.length}`);

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
    for (const [ox, oz] of [[0, 0], [0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]]) {
        const list = bgrid.get(Math.floor((x + ox) / BCELL) * 100003 + Math.floor((z + oz) / BCELL));
        if (list && list.some((i) => pointInRing(x + ox, z + oz, buildingRings[i]))) return true;
    }
    return false;
}
const ROAD_HALF = { motorway: 8, trunk: 7, primary: 6.5, secondary: 6, tertiary: 5, unclassified: 4.2, residential: 4, living_street: 3 };
function onRoad(x, z) {
    for (const [ox, oz] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) if (isAsphalt(x + ox, z + oz)) return true;
    return false;
}

// Every lamp so far, bucketed for the spacing test
const LCELL = 32;
const lampGrid = new Map();
function addToGrid(x, z) {
    const key = Math.floor(x / LCELL) * 100003 + Math.floor(z / LCELL);
    if (!lampGrid.has(key)) lampGrid.set(key, []);
    lampGrid.get(key).push(x, z);
}
function lampNear(x, z, r) {
    const gx = Math.floor(x / LCELL), gz = Math.floor(z / LCELL);
    for (let a = gx - 1; a <= gx + 1; a++) {
        for (let b = gz - 1; b <= gz + 1; b++) {
            const list = lampGrid.get(a * 100003 + b);
            if (!list) continue;
            for (let i = 0; i < list.length; i += 2) {
                const dx = list[i] - x, dz = list[i + 1] - z;
                if (dx * dx + dz * dz < r * r) return true;
            }
        }
    }
    return false;
}
for (const l of mapLamps) addToGrid(l.x, l.z);

// ---------------------------------------------------------------------------------------------
// 3. New lamps along the lit streets
// ---------------------------------------------------------------------------------------------
const lamps = []; // { x, z, yaw } yaw points the arm out over the road
let skipped = 0;
// Bigger streets first so they claim the spacing at junctions
const RANK = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street'];
streets.sort((a, b) => RANK.indexOf(a.hw.replace('_link', '')) - RANK.indexOf(b.hw.replace('_link', '')));
for (const s of streets) {
    if (s.bridge && !rasterOk) continue;
    const spacing = SPACING[s.hw];
    let next = spacing * (0.3 + hash32(s.id) * 0.5); // distance along the way to the next lamp
    let along = 0;
    let side = hash32(s.id * 3) < 0.5 ? 1 : -1;
    for (let i = 1; i < s.refs.length; i++) {
        const a = s.refs[i - 1], b = s.refs[i];
        const ax = NX[a], az = NZ[a];
        const seg = Math.hypot(NX[b] - ax, NZ[b] - az);
        if (seg < 1e-3) continue;
        const dx = (NX[b] - ax) / seg, dz = (NZ[b] - az) / seg;
        while (along + seg >= next) {
            const t = next - along;
            const cx = ax + dx * t, cz = az + dz * t;
            next += spacing;
            // Walk out from the centreline until clear of asphalt, then step onto the verge
            let spot = null;
            for (const sd of [side, -side]) {
                const nx = -dz * sd, nz = dx * sd;
                const start = rasterOk ? 1.5 : (ROAD_HALF[s.hw.replace('_link', '')] || 4);
                for (let d = start; d < 16; d += 0.5) {
                    if (rasterOk && onRoad(cx + nx * d, cz + nz * d)) continue;
                    const px = cx + nx * (d + CURB), pz = cz + nz * (d + CURB);
                    if (onRoad(px, pz) || inBuilding(px, pz)) break;
                    spot = { x: px, z: pz, yaw: Math.atan2(-nx, -nz) };
                    break;
                }
                if (spot) break;
            }
            side = -side;
            if (!spot || lampNear(spot.x, spot.z, MIN_GAP)) {
                skipped++;
                continue;
            }
            addToGrid(spot.x, spot.z);
            lamps.push(spot);
        }
        along += seg;
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
    // OSM2World lamps already modelled in /mapfinal: lantern x, y, z (light only)
    mapLamps: mapLamps.flatMap((l) => [dm(l.x), dm(l.y), dm(l.z)]),
    // New cobra-head lamps: base x, z, arm yaw
    lamps: lamps.flatMap((l) => [dm(l.x), dm(l.z), mr(l.yaw)])
};
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(out));
console.log(`spots skipped (no verge or too close to another lamp): ${skipped}`);
console.log(`${mapLamps.length} existing + ${lamps.length} new street lamps -> ${path.relative(ROOT, OUT_FILE)} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(0)} KB)`);
