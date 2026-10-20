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

const content = fs.readFileSync('anothermapo/map.osm', 'utf8');
const allNodes = new Map();
const nodeRegex = /<node id="(\d+)"[^>]*lat="([^"]+)" lon="([^"]+)"/g;
let match;
while ((match = nodeRegex.exec(content)) !== null) {
    allNodes.set(match[1], latLonToWorld(parseFloat(match[2]), parseFloat(match[3])));
}

const wayRegex = /<way id="(\d+)"[\s\S]*?<\/way>/g;
let wayMatch;
const neighborhoodRoads = [];

while ((wayMatch = wayRegex.exec(content)) !== null) {
    const wayXml = wayMatch[0];
    const wayId = wayMatch[1];
    const hwMatch = wayXml.match(/<tag k="highway" v="([^"]+)"/);
    const nameMatch = wayXml.match(/<tag k="name" v="([^"]+)"/);
    const onewayMatch = wayXml.match(/<tag k="oneway" v="([^"]+)"/);

    if (!hwMatch) continue;
    const hw = hwMatch[1];
    if (!['residential', 'service', 'tertiary', 'secondary', 'primary'].includes(hw)) continue;

    const ndRegex = /<nd ref="(\d+)"/g;
    let m;
    const pts = [];
    while ((m = ndRegex.exec(wayXml)) !== null) {
        const pt = allNodes.get(m[1]);
        if (pt) pts.push({ id: m[1], x: pt.x, z: pt.z });
    }

    // Check if any point is in our primary neighborhood [-260, 20] x [-160, 220]
    const inBox = pts.some(p => p.x >= -260 && p.x <= 20 && p.z >= -160 && p.z <= 220);
    if (inBox && hw !== 'service') {
        neighborhoodRoads.push({
            wayId,
            name: nameMatch ? nameMatch[1] : 'unnamed',
            type: hw,
            oneway: onewayMatch ? onewayMatch[1] === 'yes' : false,
            pts
        });
    }
}

console.log('Main residential roads in neighborhood:');
for (const r of neighborhoodRoads) {
    console.log(`- ${r.name} (Way ${r.wayId}, ${r.pts.length} pts): [${r.pts[0].x.toFixed(1)}, ${r.pts[0].z.toFixed(1)}] -> [${r.pts[r.pts.length-1].x.toFixed(1)}, ${r.pts[r.pts.length-1].z.toFixed(1)}]`);
}

// Check junction intersections: find shared node IDs between ways
const nodeToWays = new Map();
for (const r of neighborhoodRoads) {
    for (const pt of r.pts) {
        if (!nodeToWays.has(pt.id)) nodeToWays.set(pt.id, []);
        nodeToWays.get(pt.id).push(r.name);
    }
}

const junctions = [];
for (const [nodeId, wayNames] of nodeToWays.entries()) {
    const uniqueWays = Array.from(new Set(wayNames));
    if (uniqueWays.length > 1) {
        const pt = allNodes.get(nodeId);
        junctions.push({ nodeId, ways: uniqueWays, x: pt.x, z: pt.z });
    }
}

console.log('\nJunction intersections:');
for (const j of junctions) {
    console.log(`- Junction at (${j.x.toFixed(1)}, ${j.z.toFixed(1)}): ${j.ways.join(' <-> ')}`);
}
