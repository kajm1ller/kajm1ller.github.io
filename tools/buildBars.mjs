/**
 * tools/buildBars.mjs
 *
 * Bakes the downtown bars from the OSM extract /mapfinal was exported from
 * (newmap2/OSM2World-latest-bin/map.osm): every amenity=bar / pub / nightclub inside the Downtown
 * Bars district. For each one it finds the OSM building it is in, and when several bars share one
 * building (a block of storefronts mapped as a single way) splits the building into storefronts
 * along the street. Bars listed in UPSTAIRS are the second floor of their building instead.
 * `face` is the side of the storefront that opens onto the street ('E', 'W', 'N' or 'S').
 * A bar mapped with its own outline inside a bigger building (Howard's) is that outline, and what's
 * left of the building becomes `fillers`: plain closed storefronts, since the whole building is cut
 * out of the map (`buildings`, what bars.js carves).
 *
 * Usage: node tools/buildBars.mjs  ->  js/game/data/bars.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OSM_FILE = path.join(ROOT, 'newmap2/OSM2World-latest-bin/map.osm');
const OUT_FILE = path.join(ROOT, 'js/game/data/bars.json');
const MAP_OFFSET = { x: -2324.73, z: -748.02 };   // = ANOTHERMAPO_CONFIG.MAP_OFFSET in mapLoader.js
// Downtown Bars district (districts.js BARS box, pixels -> world), with a little slack
const AREA = { minX: -1960, maxX: -1630, minZ: -2050, maxZ: -540 };
const KINDS = new Set(['bar', 'pub', 'nightclub']);
const UPSTAIRS = new Set(['Uptown Nightclub', 'The Attic']);
// Corner buildings whose door is on the other street than the nearest one (162 N Main St)
const FACE = { 'DownTown Sports Grill': 'W', 'Uptown Nightclub': 'W' };
const STREETS = new Set(['North Main Street', 'South Main Street', 'East Wooster Street', 'West Wooster Street', 'East Court Street', 'West Court Street']);

const osm = fs.readFileSync(OSM_FILE, 'utf8');
const bm = /<bounds minlat="([-\d.]+)" minlon="([-\d.]+)" maxlat="([-\d.]+)" maxlon="([-\d.]+)"/.exec(osm);
const LAT0 = (parseFloat(bm[1]) + parseFloat(bm[3])) / 2;
const LON0 = (parseFloat(bm[2]) + parseFloat(bm[4])) / 2;
const R = 6378137, D2R = Math.PI / 180, K = R * Math.cos(LAT0 * D2R);
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
const Y0 = mercY(LAT0);
const project = (lat, lon) => [(lon - LON0) * D2R * K + MAP_OFFSET.x, -(mercY(lat) - Y0) * K + MAP_OFFSET.z];

function parseTags(body) {
    const tags = {};
    const re = /<tag k="([^"]*)" v="([^"]*)"\s*\/>/g;
    let m;
    while (body && (m = re.exec(body))) tags[m[1]] = m[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    return tags;
}
const inArea = (x, z) => x > AREA.minX && x < AREA.maxX && z > AREA.minZ && z < AREA.maxZ;
const centroid = (pts) => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
function insidePoly(pts, x, z) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, zi] = pts[i], [xj, zj] = pts[j];
        if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
    }
    return c;
}
const bboxOf = (pts) => ({
    minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])),
    minZ: Math.min(...pts.map((p) => p[1])), maxZ: Math.max(...pts.map((p) => p[1]))
});

const nodes = new Map();
const found = [];   // { name, x, z, tags, pts? }
for (const m of osm.matchAll(/<node id="(\d+)" lat="([-\d.]+)" lon="([-\d.]+)"[^>]*?(\/>|>([\s\S]*?)<\/node>)/g)) {
    const [x, z] = project(parseFloat(m[2]), parseFloat(m[3]));
    nodes.set(m[1], [x, z]);
    const t = parseTags(m[5]);
    if (KINDS.has(t.amenity) && t.name && inArea(x, z)) found.push({ name: t.name, x, z, tags: t });
}
const buildings = [];
const streets = [];
for (const m of osm.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
    const t = parseTags(m[2]);
    const pts = [...m[2].matchAll(/<nd ref="(\d+)"\/>/g)].map((n) => nodes.get(n[1])).filter(Boolean);
    if (t.highway && STREETS.has(t.name) && pts.length > 1) streets.push(pts);
    if (pts.length < 3) continue;
    if (t.building) buildings.push({ id: m[1], pts, levels: parseInt(t['building:levels'], 10) || 0 });
    if (KINDS.has(t.amenity) && t.name) {
        const [x, z] = centroid(pts);
        if (inArea(x, z)) found.push({ name: t.name, x, z, tags: t, pts, levels: parseInt(t['building:levels'], 10) || 0 });
    }
}

/** Which way the street is from (x, z): the axis direction to the nearest point of a named street. */
function faceOf(x, z) {
    let best = Infinity, dx = 1, dz = 0;
    for (const pts of streets) {
        for (let i = 1; i < pts.length; i++) {
            const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
            const ex = bx - ax, ez = bz - az, L = ex * ex + ez * ez || 1;
            const u = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L));
            const px = ax + ex * u, pz = az + ez * u, d = Math.hypot(px - x, pz - z);
            if (d < best) { best = d; dx = px - x; dz = pz - z; }
        }
    }
    return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'E' : 'W') : (dz > 0 ? 'S' : 'N');
}

// Each bar -> the building it is in, and its own outline when it has one
const groups = new Map();
for (const b of found) {
    const parent = buildings.find((B) => insidePoly(B.pts, b.x, b.z));
    const own = b.pts && parent && bboxOf(b.pts).maxX - bboxOf(b.pts).minX < bboxOf(parent.pts).maxX - bboxOf(parent.pts).minX - 1 ||
        b.pts && parent && bboxOf(b.pts).maxZ - bboxOf(b.pts).minZ < bboxOf(parent.pts).maxZ - bboxOf(parent.pts).minZ - 1
        ? { id: 'own_' + b.name, pts: b.pts, levels: b.levels || parent.levels } : null;
    const bld = own || parent || (b.pts ? { id: 'bar_' + b.name, pts: b.pts, levels: b.levels } : null);
    if (!bld) { console.warn(`No building for ${b.name}`); continue; }
    if (!groups.has(bld.id)) groups.set(bld.id, { bld, parent: parent || bld, bars: [] });
    const g = groups.get(bld.id);
    if (!g.bars.some((o) => o.name === b.name)) g.bars.push(b);
}

const out = { buildings: [], bars: [], fillers: [] };
const r1 = (n) => Math.round(n * 10) / 10;
const parents = new Map();   // carved building id -> { index, covered: [rects] }
for (const { bld, parent, bars } of groups.values()) {
    if (!parents.has(parent.id)) {
        const pb = bboxOf(parent.pts);
        parents.set(parent.id, { index: out.buildings.length, box: pb, covered: [] });
        out.buildings.push({ id: parent.id, minX: r1(pb.minX), maxX: r1(pb.maxX), minZ: r1(pb.minZ), maxZ: r1(pb.maxZ), levels: parent.levels || bld.levels || 2 });
    }
    const P = parents.get(parent.id);
    const box = bboxOf(bld.pts);
    P.covered.push(box);
    const bi = P.index;
    const levels = bld.levels || parent.levels || 2;
    const [cx, cz] = centroid(bld.pts);
    const face = FACE[bars[0].name] || faceOf(cx, cz);
    const alongX = face === 'N' || face === 'S';    // storefronts sit side by side along this axis
    const ground = bars.filter((b) => !UPSTAIRS.has(b.name)).sort((a, b) => (alongX ? a.x - b.x : a.z - b.z));
    const lo = alongX ? box.minX : box.minZ, hi = alongX ? box.maxX : box.maxZ;
    ground.forEach((b, i) => {
        const key = (o) => (alongX ? o.x : o.z);
        const a = i === 0 ? lo : (key(ground[i - 1]) + key(b)) / 2;
        const c = i === ground.length - 1 ? hi : (key(b) + key(ground[i + 1])) / 2;
        const r = alongX ? { minX: a, maxX: c, minZ: box.minZ, maxZ: box.maxZ } : { minX: box.minX, maxX: box.maxX, minZ: a, maxZ: c };
        out.bars.push({ name: b.name, building: bi, level: 0, levels, face, minX: r1(r.minX), maxX: r1(r.maxX), minZ: r1(r.minZ), maxZ: r1(r.maxZ), shares: ground.length > 1 || bars.length > ground.length });
    });
    for (const b of bars.filter((o) => UPSTAIRS.has(o.name))) {
        out.bars.push({ name: b.name, building: bi, level: 1, levels, face, minX: r1(box.minX), maxX: r1(box.maxX), minZ: r1(box.minZ), maxZ: r1(box.maxZ), shares: true });
    }
}
// What's left of a carved building after its bars: closed storefronts, sliced across the long side
for (const P of parents.values()) {
    const b = P.box, longX = b.maxX - b.minX < b.maxZ - b.minZ;   // slice along the longer side
    const ivs = P.covered.map((c) => (longX ? [c.minZ, c.maxZ] : [c.minX, c.maxX])).sort((a, c) => a[0] - c[0]);
    let at = longX ? b.minZ : b.minX;
    const end = longX ? b.maxZ : b.maxX;
    const gaps = [];
    for (const [a, c] of ivs) { if (a - at > 1.5) gaps.push([at, a]); at = Math.max(at, c); }
    if (end - at > 1.5) gaps.push([at, end]);
    for (const [a, c] of gaps) {
        const r = longX ? { minX: b.minX, maxX: b.maxX, minZ: a, maxZ: c } : { minX: a, maxX: c, minZ: b.minZ, maxZ: b.maxZ };
        out.fillers.push({ building: P.index, face: faceOf((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2), levels: out.buildings[P.index].levels,
            minX: r1(r.minX), maxX: r1(r.maxX), minZ: r1(r.minZ), maxZ: r1(r.maxZ) });
    }
}
// Neighbouring OSM footprints often overlap by a metre or so: split each overlap down the middle
// so one storefront's party wall doesn't stand inside the next one's room
{
    const rects = [...out.bars, ...out.fillers];
    for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i], b = rects[j];
            if (a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ) continue;   // same storefront, two floors
            const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
            const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
            if (ox <= 0.05 || oz <= 0.05) continue;
            const twins = (r) => rects.filter((o) => o !== r && o.minX === r.minX && o.maxX === r.maxX && o.minZ === r.minZ && o.maxZ === r.maxZ);
            if (ox < oz) {
                const m = r1((Math.max(a.minX, b.minX) + Math.min(a.maxX, b.maxX)) / 2);
                const [lo, hi] = a.minX < b.minX ? [a, b] : [b, a];
                for (const r of [lo, ...twins(lo)]) r.maxX = m;
                for (const r of [hi, ...twins(hi)]) r.minX = m;
            } else {
                const m = r1((Math.max(a.minZ, b.minZ) + Math.min(a.maxZ, b.maxZ)) / 2);
                const [lo, hi] = a.minZ < b.minZ ? [a, b] : [b, a];
                for (const r of [lo, ...twins(lo)]) r.maxZ = m;
                for (const r of [hi, ...twins(hi)]) r.minZ = m;
            }
        }
    }
}
out.bars.sort((a, b) => a.minZ - b.minZ);
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1));
for (const b of out.bars) console.log(`${b.name.padEnd(30)} L${b.level} ${b.face} x[${b.minX},${b.maxX}] z[${b.minZ},${b.maxZ}]  ${(b.maxX - b.minX).toFixed(1)} x ${(b.maxZ - b.minZ).toFixed(1)}`);
for (const f of out.fillers) console.log(`  filler ${f.face} x[${f.minX},${f.maxX}] z[${f.minZ},${f.maxZ}]`);
console.log(`${out.bars.length} bars, ${out.fillers.length} fillers in ${out.buildings.length} buildings -> ${path.relative(ROOT, OUT_FILE)}`);
