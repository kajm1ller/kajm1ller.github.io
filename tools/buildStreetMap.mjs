/**
 * tools/buildStreetMap.mjs
 *
 * Bakes what the in-game map (js/game/cityMap.js) draws from the OSM extract /mapfinal was
 * exported from (newmap2/OSM2World-latest-bin/map.osm), in world metres:
 *   - roads: every street with its class, name (or ref) and a simplified centre line
 *   - rails, water and parks as simplified lines / polygons
 *   - labels: one entry per street name per stretch (longest way, at its middle, with the angle of
 *     the road there) so the map can write the names along the streets
 *
 * Usage: node tools/buildStreetMap.mjs  ->  js/game/data/streetMap.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OSM_FILE = path.join(ROOT, 'newmap2/OSM2World-latest-bin/map.osm');
const OUT_FILE = path.join(ROOT, 'js/game/data/streetMap.json');
const MAP_OFFSET = { x: -2324.73, z: -748.02 };   // = ANOTHERMAPO_CONFIG.MAP_OFFSET in mapLoader.js

// Road classes, in drawing order (index = `c` in the output)
const CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service'];
const classOf = (hw) => CLASSES.indexOf(hw.replace(/_link$/, ''));

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

/** Douglas-Peucker on [x, z] points. */
function simplify(pts, tol) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
        const [a, b] = stack.pop();
        let worst = -1, wd = tol;
        const [ax, az] = pts[a], [bx, bz] = pts[b];
        const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
        for (let i = a + 1; i < b; i++) {
            const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / l;
            if (d > wd) { wd = d; worst = i; }
        }
        if (worst >= 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
    }
    return pts.filter((_, i) => keep[i]);
}

const nodes = new Map();
{
    const re = /<node id="(\d+)" lat="([-\d.]+)" lon="([-\d.]+)"/g;
    let m;
    while ((m = re.exec(osm))) nodes.set(m[1], project(parseFloat(m[2]), parseFloat(m[3])));
}

const flat = (pts) => pts.flatMap(([x, z]) => [Math.round(x), Math.round(z)]);
const roads = [], rails = [], water = [], parks = [];
{
    const re = /<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g;
    let m;
    while ((m = re.exec(osm))) {
        const t = parseTags(m[2]);
        const raw = [...m[2].matchAll(/<nd ref="(\d+)"\/>/g)].map((n) => nodes.get(n[1])).filter(Boolean);
        if (raw.length < 2) continue;
        if (t.highway && classOf(t.highway) >= 0) {
            const pts = simplify(raw, 3);
            roads.push({ n: t.name || t.ref || '', c: classOf(t.highway), p: flat(pts), o: t.oneway === 'yes' ? 1 : 0 });
        } else if (t.railway === 'rail' && t.service !== 'yard') {
            rails.push(flat(simplify(raw, 5)));
        } else if (raw.length > 3) {
            const area = t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir';
            const park = t.leisure === 'park' || t.leisure === 'golf_course' || t.landuse === 'recreation_ground' || t.landuse === 'cemetery';
            if (area) water.push(flat(simplify(raw, 4)));
            else if (park) parks.push(flat(simplify(raw, 4)));
        } else if (t.waterway === 'river' || t.waterway === 'stream') {
            water.push({ line: flat(simplify(raw, 5)) });
        }
    }
}

// Street names: for each name, the longest way of each stretch, labelled at its middle
function wayLength(p) {
    let l = 0;
    for (let i = 2; i < p.length; i += 2) l += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    return l;
}
function pointAlong(p, d) {
    for (let i = 2; i < p.length; i += 2) {
        const seg = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
        if (d <= seg || i === p.length - 2) {
            const k = seg ? Math.min(1, d / seg) : 0;
            return { x: p[i - 2] + (p[i] - p[i - 2]) * k, z: p[i - 1] + (p[i + 1] - p[i - 1]) * k, a: Math.atan2(p[i + 1] - p[i - 1], p[i] - p[i - 2]) };
        }
        d -= seg;
    }
    return { x: p[0], z: p[1], a: 0 };
}
const labels = [];
for (const r of roads) {
    if (!r.n || r.c > 7) continue;
    const len = wayLength(r.p);
    if (len < 45) continue;
    const mid = pointAlong(r.p, len / 2);
    let a = mid.a;
    if (a > Math.PI / 2) a -= Math.PI;
    if (a < -Math.PI / 2) a += Math.PI;      // text reads left to right
    labels.push({ n: r.n, c: r.c, x: Math.round(mid.x), z: Math.round(mid.z), a: +a.toFixed(2), len: Math.round(len) });
}
// A name repeated within 200 m (a street cut into ways) is written once, on the longest piece
labels.sort((a, b) => b.len - a.len);
const kept = [];
for (const l of labels) if (!kept.some((k) => k.n === l.n && Math.hypot(k.x - l.x, k.z - l.z) < 200)) kept.push(l);

const out = {
    classes: CLASSES,
    bounds: [Math.round(project(parseFloat(bm[1]), parseFloat(bm[2]))[0]), Math.round(project(parseFloat(bm[3]), parseFloat(bm[4]))[1]),
        Math.round(project(parseFloat(bm[3]), parseFloat(bm[4]))[0]), Math.round(project(parseFloat(bm[1]), parseFloat(bm[2]))[1])],
    roads: roads.map((r) => (r.o ? r : { n: r.n, c: r.c, p: r.p })).map(({ n, c, p }) => ({ n, c, p })),
    rails, water: water.filter((w) => Array.isArray(w)), rivers: water.filter((w) => !Array.isArray(w)).map((w) => w.line), parks,
    labels: kept.map(({ n, c, x, z, a }) => ({ n, c, x, z, a }))
};
fs.writeFileSync(OUT_FILE, JSON.stringify(out));
console.log(`roads ${roads.length}, labels ${kept.length}, rails ${rails.length}, water ${out.water.length}+${out.rivers.length}, parks ${parks.length}, ${(fs.statSync(OUT_FILE).size / 1024).toFixed(0)} KB`);
