const fs = require('fs');

const R = 6378137;
const lat0 = 41.36928;
const lon0 = -83.62857;
const lat0Rad = lat0 * Math.PI / 180;

function latLonToWorld(lat, lon) {
    const dLat = (lat - lat0) * Math.PI / 180;
    const dLon = (lon - lon0) * Math.PI / 180;
    const x = dLon * R * Math.cos(lat0Rad);
    const z = - dLat * R;
    return { x, z };
}

console.log('Reading anothermapo/map.osm...');
const content = fs.readFileSync('anothermapo/map.osm', 'utf8');

// Parse all nodes into map: id -> { lat, lon, x, z }
const allNodes = new Map();
const nodeRegex = /<node id="(\d+)"[^>]*lat="([^"]+)" lon="([^"]+)"/g;
let match;
while ((match = nodeRegex.exec(content)) !== null) {
    const id = match[1];
    const lat = parseFloat(match[2]);
    const lon = parseFloat(match[3]);
    const { x, z } = latLonToWorld(lat, lon);
    allNodes.set(id, { lat, lon, x, z });
}
console.log('Total OSM nodes parsed:', allNodes.size);

// Parse all ways
const wayRegex = /<way id="(\d+)"[\s\S]*?<\/way>/g;
let wayMatch;
const roadWays = [];
const buildingWays = [];

while ((wayMatch = wayRegex.exec(content)) !== null) {
    const wayXml = wayMatch[0];
    const wayId = wayMatch[1];
    const hwMatch = wayXml.match(/<tag k="highway" v="([^"]+)"/);
    const bldgMatch = wayXml.match(/<tag k="building"/);
    const nameMatch = wayXml.match(/<tag k="name" v="([^"]+)"/);
    const onewayMatch = wayXml.match(/<tag k="oneway" v="([^"]+)"/);
    const lanesMatch = wayXml.match(/<tag k="lanes" v="([^"]+)"/);
    const surfaceMatch = wayXml.match(/<tag k="surface" v="([^"]+)"/);

    const ndRegex = /<nd ref="(\d+)"/g;
    let m;
    const nodeRefs = [];
    while ((m = ndRegex.exec(wayXml)) !== null) {
        nodeRefs.push(m[1]);
    }

    if (hwMatch) {
        const waypoints = [];
        for (const ref of nodeRefs) {
            const nd = allNodes.get(ref);
            if (nd) waypoints.push({ id: ref, x: nd.x, z: nd.z });
        }
        roadWays.push({
            id: wayId,
            type: hwMatch[1],
            name: nameMatch ? nameMatch[1] : null,
            oneway: onewayMatch ? onewayMatch[1] === 'yes' : false,
            lanes: lanesMatch ? parseInt(lanesMatch[1], 10) : 2,
            surface: surfaceMatch ? surfaceMatch[1] : null,
            waypoints
        });
    }

    if (bldgMatch) {
        buildingWays.push({ id: wayId, nodeRefs });
    }
}

console.log('Total road ways found:', roadWays.length);
console.log('Total building ways found:', buildingWays.length);

// Road types breakdown
const roadTypeCounts = {};
for (const rw of roadWays) {
    roadTypeCounts[rw.type] = (roadTypeCounts[rw.type] || 0) + 1;
}
console.log('Road types breakdown:', roadTypeCounts);

// Find drivable roads (excluding footway, steps, path, cycleway)
const drivableTypes = new Set([
    'residential', 'service', 'tertiary', 'secondary', 'primary',
    'trunk', 'motorway', 'unclassified', 'living_street'
]);

const drivableRoads = roadWays.filter(r => drivableTypes.has(r.type));
console.log('Total drivable road segments:', drivableRoads.length);

// Find drivable roads within 250m of player start pos (-120.1, 64.0)
const nearRoads = drivableRoads.filter(r => {
    return r.waypoints.some(wp => Math.hypot(wp.x - (-120.1), wp.z - 64.0) < 250);
});
console.log('Drivable roads within 250m of player start (-120.1, 64.0):', nearRoads.length);
for (const r of nearRoads) {
    console.log(`- Way ${r.id}: name="${r.name}", type=${r.type}, waypoints=${r.waypoints.length}, oneway=${r.oneway}`);
    if (r.waypoints.length > 0) {
        const p0 = r.waypoints[0];
        const pLast = r.waypoints[r.waypoints.length - 1];
        console.log(`  start: (${p0.x.toFixed(1)}, ${p0.z.toFixed(1)}), end: (${pLast.x.toFixed(1)}, ${pLast.z.toFixed(1)})`);
    }
}
