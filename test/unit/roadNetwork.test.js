import test from 'node:test';
import assert from 'node:assert/strict';
import { RoadNetwork, ROAD_CONFIG } from '../../js/game/roadNetwork.js';

test('RoadNetwork graph topology: dimensions, node counts, and ~1,200m centerline extent', () => {
    const rn = new RoadNetwork();

    // Verify nodes
    assert.equal(rn.nodes.size, 21, 'Should have exactly 21 graph nodes');

    // Verify total road centerline length (~1,220m)
    assert(
        rn.totalCenterlineLength >= 1200 && rn.totalCenterlineLength <= 1250,
        `Expected road extent ~1,200m, got ${rn.totalCenterlineLength.toFixed(1)}m`
    );
    assert.equal(rn.totalCenterlineLength, 1220, 'Exact centerline length should be 1,220m');

    // Verify bidirectional segments
    assert.equal(rn.segments.length, 32, 'Should have 32 road segments');

    // Verify dual lanes (64 directed lanes)
    assert.equal(rn.lanes.length, 64, 'Should have 64 directed lanes (2 per segment)');
    assert.equal(rn.lanesById.size, 64);

    // Verify total waypoint count
    assert(rn.waypoints.length > 500, `Expected >500 waypoints, got ${rn.waypoints.length}`);

    // Verify all waypoints have finite coordinates and headings
    for (const wp of rn.waypoints) {
        assert(Number.isFinite(wp.x), `Waypoint X must be finite: ${wp.x}`);
        assert(Number.isFinite(wp.z), `Waypoint Z must be finite: ${wp.z}`);
        assert(Number.isFinite(wp.yaw), `Waypoint yaw must be finite: ${wp.yaw}`);
        assert(typeof wp.laneId === 'string' && wp.laneId.length > 0);
        assert(Number.isInteger(wp.index) && wp.index >= 0);
        assert(wp.speedLimit > 0);
    }
});

test('RoadNetwork dual-lane lateral offsets and right-hand traffic heading', () => {
    const rn = new RoadNetwork();

    // Check central N-S street: seg_30_C_S_CENTER (from (0, -25) to (0, 0))
    const segCenter = rn.segments.find(s => s.fromNode.id === 'C_S' && s.toNode.id === 'CENTER');
    assert(segCenter, 'Segment C_S -> CENTER must exist');

    const laneFwd = rn.getLane(`${segCenter.id}_fwd`);
    const laneRev = rn.getLane(`${segCenter.id}_rev`);
    assert(laneFwd && laneRev, 'Both forward and reverse lanes must exist');

    const fwdX = laneFwd.waypoints[0].x;
    const revX = laneRev.waypoints[0].x;

    // Both lanes should be offset by 1.8m from centerline (3.6m apart)
    assert.equal(Math.abs(fwdX - revX).toFixed(1), '3.6', 'Dual lanes must be separated by 3.6m');
    assert.equal(Math.abs(fwdX).toFixed(1), '1.8', 'Forward lane must be 1.8m from centerline');
    assert.equal(Math.abs(revX).toFixed(1), '1.8', 'Reverse lane must be 1.8m from centerline');
});

test('RoadNetwork isNearRoad() obstacle clearance masking', () => {
    const rn = new RoadNetwork();

    // Center of road: (0, 0) is an intersection
    assert.equal(rn.isNearRoad(0, 0, 5.0), true, '(0, 0) is an intersection, should be near road');

    // Point on lane centerline: (-25, 10) is on West Avenue
    assert.equal(rn.isNearRoad(-25, 10, 5.0), true, 'Point on West Avenue should be near road');

    // Point exactly at road edge (4.0m from centerline): (-25 + 4.0 = -21, 10)
    assert.equal(rn.isNearRoad(-21, 10, 5.0), true, 'Point at road shoulder (4.0m) is within 5.0m clearance');

    // Point at 8.5m from road centerline (4.0m road + 4.5m < 5.0m clearance)
    assert.equal(rn.isNearRoad(-25 + 8.5, 10, 5.0), true, 'Point 8.5m from centerline is within 5.0m clearance (threshold 9.0m)');

    // Point at 9.5m from road centerline (4.0m road + 5.5m > 5.0m clearance)
    assert.equal(rn.isNearRoad(-25 + 9.5, 10, 5.0), false, 'Point 9.5m from centerline is beyond 5.0m clearance (threshold 9.0m)');

    // Point far in the park quadrant: (12, 12)
    assert.equal(rn.isNearRoad(12, 12, 5.0), false, 'Point (12, 12) is safely in park >9.0m from any road');

    // Point completely outside world network: (100, 100)
    assert.equal(rn.isNearRoad(100, 100, 5.0), false, 'Point (100, 100) is far outside network');
});

test('RoadNetwork getNearestWaypoint() queries', () => {
    const rn = new RoadNetwork();

    // Query near player spawn (0, 0)
    const nearCenter = rn.getNearestWaypoint(0, 0);
    assert(nearCenter.distance < 3.0, `Nearest waypoint to (0,0) should be < 3m, got ${nearCenter.distance}`);
    assert(Number.isFinite(nearCenter.x));
    assert(Number.isFinite(nearCenter.z));
    assert(Number.isFinite(nearCenter.yaw));

    // Query near perimeter (70, 70)
    const nearNE = rn.getNearestWaypoint(70, 70);
    assert(nearNE.distance < 3.0, `Nearest waypoint to (70,70) should be < 3m, got ${nearNE.distance}`);

    // Query far point (-150, -150)
    const farPoint = rn.getNearestWaypoint(-150, -150);
    assert(farPoint.distance > 100, `Distance should be >100m, got ${farPoint.distance}`);
});

test('RoadNetwork getLookaheadWaypoint() traversal across lane successors', () => {
    const rn = new RoadNetwork();

    const lane = rn.lanes[0];
    assert(lane && lane.waypoints.length > 5);

    // Lookahead of 5m from start of lane
    const target1 = rn.getLookaheadWaypoint(lane.id, 0, 5.0);
    assert(Number.isFinite(target1.x));
    assert(Number.isFinite(target1.z));
    assert(Number.isFinite(target1.yaw));

    // Lookahead of 60m (exceeds individual segment length ~45m, must traverse into successor lane!)
    const target2 = rn.getLookaheadWaypoint(lane.id, 0, 60.0);
    assert(Number.isFinite(target2.x));
    assert(Number.isFinite(target2.z));
    assert(Number.isFinite(target2.yaw));
    assert(typeof target2.laneId === 'string');
});

test('RoadNetwork getSpawnPoints() distribution and pairwise separation', () => {
    const rn = new RoadNetwork();

    const spawnCount = 50;
    const minSpacing = 12.0;
    const spawns = rn.getSpawnPoints(spawnCount, minSpacing);

    assert.equal(spawns.length, spawnCount, `Should generate exactly ${spawnCount} spawn points`);

    // Verify all points are valid and satisfy minimum spacing
    for (let i = 0; i < spawns.length; i++) {
        const s1 = spawns[i];
        assert(Number.isFinite(s1.x));
        assert(Number.isFinite(s1.z));
        assert(Number.isFinite(s1.yaw));

        // Pairwise distance check
        for (let j = i + 1; j < spawns.length; j++) {
            const s2 = spawns[j];
            const dist = Math.hypot(s1.x - s2.x, s1.z - s2.z);
            assert(
                dist >= minSpacing - 0.001,
                `Spawn point ${i} and ${j} violate min spacing: dist=${dist.toFixed(2)}m < ${minSpacing}m`
            );
        }
    }
});

test('RoadNetwork isNearRoad() 50,000 query stress benchmark', () => {
    const rn = new RoadNetwork();

    const t0 = performance.now();
    let hits = 0;
    for (let i = 0; i < 50000; i++) {
        const x = (i % 200) - 100;
        const z = ((i * 3) % 200) - 100;
        if (rn.isNearRoad(x, z, 5.0)) hits++;
    }
    const t1 = performance.now();
    const elapsed = t1 - t0;
    const throughput = (50000 / (elapsed / 1000)).toFixed(0);

    // Should process > 100,000 queries per second
    assert(elapsed < 250, `50,000 queries should take <250ms, took ${elapsed.toFixed(1)}ms (${throughput} qps)`);
});
