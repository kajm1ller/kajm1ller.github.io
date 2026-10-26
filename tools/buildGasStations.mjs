/**
 * tools/buildGasStations.mjs
 *
 * Bakes the gas station sites from the OSM extract /mapfinal was exported from
 * (newmap2/OSM2World-latest-bin/map.osm): every public amenity=fuel node or area. Each site gets
 * the position of the OSM feature, its footprint (for areas) and `yaw`, the direction to the
 * nearest street, so the forecourt can face it.
 *
 * Usage: node tools/buildGasStations.mjs  ->  js/game/data/gasStations.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OSM_FILE = path.join(ROOT, 'newmap2/OSM2World-latest-bin/map.osm');
const OUT_FILE = path.join(ROOT, 'js/game/data/gasStations.json');
const MAP_OFFSET = { x: -2324.73, z: -748.02 };   // = ANOTHERMAPO_CONFIG.MAP_OFFSET in mapLoader.js
const ROAD = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']);

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

const nodes = new Map();
const sites = [];
{
    const re = /<node id="(\d+)" lat="([-\d.]+)" lon="([-\d.]+)"[^>]*?(\/>|>([\s\S]*?)<\/node>)/g;
    let m;
    while ((m = re.exec(osm))) {
        const [x, z] = project(parseFloat(m[2]), parseFloat(m[3]));
        nodes.set(m[1], [x, z]);
        const t = parseTags(m[5]);
        if (t.amenity === 'fuel') sites.push({ x, z, tags: t });
    }
}
const roads = [];
{
    const re = /<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g;
    let m;
    while ((m = re.exec(osm))) {
        const t = parseTags(m[2]);
        const pts = [...m[2].matchAll(/<nd ref="(\d+)"\/>/g)].map((n) => nodes.get(n[1])).filter(Boolean);
        if (t.amenity === 'fuel' && pts.length > 2) {
            const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
            sites.push({
                x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2,
                w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs), tags: t
            });
        } else if (ROAD.has(t.highway) && pts.length > 1) roads.push(pts);
    }
}

function nearestRoad(x, z) {
    let best = null, bd = Infinity;
    for (const pts of roads) {
        for (let i = 0; i + 1 < pts.length; i++) {
            const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
            const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
            const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
            const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(px - x, pz - z);
            if (d < bd) { bd = d; best = { x: px, z: pz, d }; }
        }
    }
    return best;
}

const out = [];
for (const s of sites) {
    if (s.tags.access === 'private' || /university|bgsu/i.test(`${s.tags.operator || ''}`)) continue;
    if (out.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < 30)) continue;
    const r = nearestRoad(s.x, s.z);
    const yaw = r ? Math.atan2(r.x - s.x, r.z - s.z) : 0;   // direction (x, z) = (sin, cos) to the street
    out.push({
        name: s.tags.name || s.tags.brand || 'Gas',
        x: +s.x.toFixed(1), z: +s.z.toFixed(1),
        w: s.w ? +s.w.toFixed(1) : 0, d: s.d ? +s.d.toFixed(1) : 0,
        yaw: +yaw.toFixed(3), roadDist: r ? +r.d.toFixed(1) : 0
    });
}
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1));
console.log(`${out.length} gas stations`);
console.log(out.map((o) => `${o.name} (${o.x}, ${o.z}) ${o.w}x${o.d} road ${o.roadDist}m`).join('\n'));
