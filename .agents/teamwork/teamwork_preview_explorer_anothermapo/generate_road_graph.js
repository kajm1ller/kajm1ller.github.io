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

// Target streets forming the primary neighborhood circuit
const targetWayIds = new Set([
    '19309747',   // Scott Hamilton Drive (West part)
    '19309797',   // Burrwood Drive
    '160270259',  // Briarwood Drive
    '160270260',  // Brookwood Drive
    '160270261',  // South Mercer Road (North/Central part)
    '160270262'   // Bentwood Lane
]);

const wayRegex = /<way id="(\d+)"[\s\S]*?<\/way>/g;
let wayMatch;
const targetWays = [];

while ((wayMatch = wayRegex.exec(content)) !== null) {
    const wayXml = wayMatch[0];
    const wayId = wayMatch[1];
    if (!targetWayIds.has(wayId)) continue;

    const nameMatch = wayXml.match(/<tag k="name" v="([^"]+)"/);
    const hwMatch = wayXml.match(/<tag k="highway" v="([^"]+)"/);

    const ndRegex = /<nd ref="(\d+)"/g;
    let m;
    const pts = [];
    while ((m = ndRegex.exec(wayXml)) !== null) {
        const pt = allNodes.get(m[1]);
        if (pt) pts.push({ id: m[1], x: pt.x, z: pt.z });
    }

    targetWays.push({
        wayId,
        name: nameMatch ? nameMatch[1] : 'unnamed',
        type: hwMatch ? hwMatch[1] : 'residential',
        pts
    });
}

console.log('Found target ways:', targetWays.map(w => `${w.name} (${w.pts.length} pts)`));

// Output road graph description
const roadNetworkData = {
    metadata: {
        source: 'anothermapo/map.osm',
        origin: { lat: 41.36928, lon: -83.62857, ele: 0 },
        projection: 'Equirectangular / Mercator local tangent (R=6378137)',
        northDirection: [0, 0, -1],
        units: 'meters'
    },
    ways: targetWays
};

fs.writeFileSync('.agents/teamwork/teamwork_preview_explorer_anothermapo/osm_neighborhood_roads.json', JSON.stringify(roadNetworkData, null, 2));
console.log('Saved .agents/teamwork/teamwork_preview_explorer_anothermapo/osm_neighborhood_roads.json');
