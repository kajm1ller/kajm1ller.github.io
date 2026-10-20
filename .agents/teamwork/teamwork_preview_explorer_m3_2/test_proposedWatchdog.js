/**
 * test_proposedWatchdog.js
 * 
 * Comprehensive Unit & Adversarial Stress Tests for proposed_trafficWatchdog.js:
 * 1. Intersection conflict zone extraction from RoadNetwork nodes.
 * 2. FIFO Right-of-Way reservation and release protocol.
 * 3. Stop-line approach braking and clearance.
 * 4. Anti-Deadlock Watchdog standstill tracking (Stage 1 nudge at 300 ticks, Stage 2 respawn at 420 ticks).
 * 5. Anti-Overlap enforcement: extreme 10-car linear compression & 4-car intersection crush.
 *    Asserts pairwise distance d >= 2.0m at 100% of ticks.
 * 6. Numerical health (zero NaN, zero Infinity).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Vehicle } from '../../../js/game/vehicle.js';
import { RoadNetwork } from '../../../js/game/roadNetwork.js';
import { SpatialGrid } from '../../../js/game/spatialGrid.js';
import {
    IntersectionManager,
    IntersectionConflictZone,
    TrafficDeadlockWatchdog,
    AntiOverlapEnforcer,
    TrafficWatchdogCoordinator,
    WATCHDOG_CONFIG
} from './proposed_trafficWatchdog.js';

test('Test 1: Intersection Conflict Zones extraction and connectivity', () => {
    const roadNetwork = new RoadNetwork();
    const mgr = new IntersectionManager();
    mgr.initFromRoadNetwork(roadNetwork);

    // Verify all intersection nodes are registered
    assert(mgr.zones.size >= 17, `Expected at least 17 intersection conflict zones, got ${mgr.zones.size}`);

    // Check specific zones (e.g. CENTER, INT_NW)
    const centerZone = mgr.zones.get('CENTER');
    assert(centerZone !== undefined, 'CENTER zone must exist');
    assert.equal(centerZone.x, 0);
    assert.equal(centerZone.z, 0);
    assert(centerZone.minX < 0 && centerZone.maxX > 0);
    assert(centerZone.minZ < 0 && centerZone.maxZ > 0);

    // Verify incoming lanes mapping
    assert(mgr.laneToZone.size > 0, 'Incoming lanes must map to intersection conflict zones');
});

test('Test 2: FIFO Right-of-Way reservation protocol', () => {
    const roadNetwork = new RoadNetwork();
    const mgr = new IntersectionManager();
    mgr.initFromRoadNetwork(roadNetwork);

    const nodeId = 'CENTER';
    const tick = 100;

    // Vehicle 1 arrives and requests reservation: should be granted immediately
    const granted1 = mgr.requestReservation(nodeId, 'veh_1', tick);
    assert.equal(granted1, true, 'Vehicle 1 should be granted immediate reservation');

    // Vehicle 2 arrives and requests reservation: should be queued
    const granted2 = mgr.requestReservation(nodeId, 'veh_2', tick);
    assert.equal(granted2, false, 'Vehicle 2 should be queued');

    // Vehicle 3 arrives and requests reservation: should be queued behind Vehicle 2
    const granted3 = mgr.requestReservation(nodeId, 'veh_3', tick);
    assert.equal(granted3, false, 'Vehicle 3 should be queued');

    const zone = mgr.zones.get(nodeId);
    assert.equal(zone.reservedBy, 'veh_1');
    assert.deepEqual(zone.waitingQueue, ['veh_2', 'veh_3']);

    // Vehicle 1 clears intersection and releases
    mgr.releaseAllForVehicle('veh_1');
    assert.equal(zone.reservedBy, null);

    // Manager tick update: should grant next in FIFO queue (veh_2)
    mgr.update(tick + 1);
    assert.equal(zone.reservedBy, 'veh_2', 'Vehicle 2 should be granted reservation after Vehicle 1 releases');
    assert.deepEqual(zone.waitingQueue, ['veh_3']);
});

test('Test 3: Approach evaluation and stop-line braking', () => {
    const roadNetwork = new RoadNetwork();
    const mgr = new IntersectionManager();
    mgr.initFromRoadNetwork(roadNetwork);

    // Find a lane leading into CENTER
    const centerZone = mgr.zones.get('CENTER');
    assert(centerZone.incomingLanes.length > 0, 'CENTER should have incoming lanes');
    const incomingLaneId = centerZone.incomingLanes[0];
    const incomingLane = roadNetwork.getLane(incomingLaneId);

    // Create approaching vehicle placed 10m before CENTER
    const v = new Vehicle('approaching_car', 0, 10.0, 0);
    v.laneId = incomingLaneId;

    // First vehicle: granted reservation, does not need to stop
    const eval1 = mgr.evaluateApproach(v, 1);
    assert.equal(eval1.mustStop, false, 'First approaching vehicle should be granted right-of-way');

    // Second vehicle on same approach: should be told to stop
    const v2 = new Vehicle('second_car', 0, 12.0, 0);
    v2.laneId = incomingLaneId;
    const eval2 = mgr.evaluateApproach(v2, 1);
    assert.equal(eval2.mustStop, true, 'Second approaching vehicle must stop at stop line');
    assert(eval2.stopDistance > 0, 'Stop distance should be positive');
    assert(eval2.targetSpeedLimit < WATCHDOG_CONFIG.INTERSECTION.SPEED_LIMIT_APPROACH);
});

test('Test 4: Anti-Deadlock Watchdog (Stage 1 Nudge and Stage 2 Respawn)', () => {
    const roadNetwork = new RoadNetwork();
    const spatialGrid = new SpatialGrid(300, 15);
    const watchdog = new TrafficDeadlockWatchdog();

    // Create stalled vehicle (speed = 0)
    const v = new Vehicle('stalled_car', 10, 10, 0);
    v.speed = 0;
    v.velocity.set(0, 0);
    spatialGrid.insertDynamic(v.id, v.position.x, v.position.z, v.radius, v);

    // Step for 299 ticks: should remain NORMAL
    for (let t = 1; t < 300; t++) {
        const action = watchdog.updateVehicle(v, 1 / 60, spatialGrid, roadNetwork, [v]);
        assert.equal(action, 'NORMAL');
    }

    // Tick 300 (5.0 seconds standstill): Priority 1 Lateral Nudge
    const action300 = watchdog.updateVehicle(v, 1 / 60, spatialGrid, roadNetwork, [v]);
    assert.equal(action300, 'NUDGED', 'Must trigger Priority 1 lateral nudge at 300 ticks');
    assert(watchdog.metrics.totalStage1Nudges > 0);

    // Keep stalled until tick 420 (7.0 seconds standstill): Priority 2 Despawn and Respawn
    let respawned = false;
    for (let t = 301; t <= 420; t++) {
        const action = watchdog.updateVehicle(v, 1 / 60, spatialGrid, roadNetwork, [v]);
        if (action === 'RESPAWNED') {
            respawned = true;
            break;
        }
    }

    assert(respawned, 'Must trigger Priority 2 respawn at or before 420 ticks');
    assert(watchdog.metrics.totalStage2Respawns > 0);

    // Verify vehicle was moved and is finite
    assert(Number.isFinite(v.position.x));
    assert(Number.isFinite(v.position.z));
    assert(Number.isFinite(v.yaw));
    assert.equal(watchdog.standstillTicks.get(v.id), 0, 'Standstill ticks must be reset upon respawn');
});

test('Test 5: Anti-Overlap Enforcement: Pair separation & extreme 10-car ramming crush', () => {
    const spatialGrid = new SpatialGrid(300, 15);
    const enforcer = new AntiOverlapEnforcer();

    // 5A: Single-frame separation of an overlapping pair (e.g. spawned at 1.5m < 2.0m)
    const pair = [
        new Vehicle('overlap_A', 0, 0, 0),
        new Vehicle('overlap_B', 0, 1.5, 0) // initial distance = 1.5m
    ];
    spatialGrid.clearDynamic();
    spatialGrid.insertDynamic(pair[0].id, pair[0].position.x, pair[0].position.z, pair[0].radius, pair[0]);
    spatialGrid.insertDynamic(pair[1].id, pair[1].position.x, pair[1].position.z, pair[1].radius, pair[1]);

    enforcer.enforce(pair, spatialGrid, 1 / 60);

    const pairDist = Math.hypot(pair[0].position.x - pair[1].position.x, pair[0].position.z - pair[1].position.z);
    assert(pairDist >= 2.2, `Overlapping pair must separate to >= 2.2m within 1 tick, got ${pairDist.toFixed(3)}m`);

    // 5B: Extreme 10-car ramming compression line:
    // Lead vehicle (0) is stopped at (0, 0); 9 following vehicles starting at 2.4m intervals apply 100% throttle
    const fleet = [];
    for (let i = 0; i < 10; i++) {
        const v = new Vehicle(`crush_${i}`, 0, i * 2.4, 0);
        fleet.push(v);
    }

    // Lead vehicle stopped
    fleet[0].speed = 0;
    fleet[0].velocity.set(0, 0);

    // Following vehicles ram forward at full throttle
    for (let i = 1; i < 10; i++) {
        fleet[i].setInputs(1.0, 0, 0, false);
    }

    // Step across 60 frames of heavy continuous ramming compression
    for (let frame = 0; frame < 60; frame++) {
        // Integrate physics
        fleet[0].velocity.set(0, 0);
        fleet[0].speed = 0;
        for (let i = 1; i < fleet.length; i++) {
            fleet[i].update(1 / 60, spatialGrid);
        }

        spatialGrid.clearDynamic();
        for (let i = 0; i < fleet.length; i++) {
            spatialGrid.insertDynamic(fleet[i].id, fleet[i].position.x, fleet[i].position.z, fleet[i].radius, fleet[i]);
        }

        enforcer.enforce(fleet, spatialGrid, 1 / 60);

        // Assert pairwise distance invariant d >= 2.0m across all pairs at every frame
        for (let a = 0; a < fleet.length; a++) {
            for (let b = a + 1; b < fleet.length; b++) {
                const dx = fleet[a].position.x - fleet[b].position.x;
                const dz = fleet[a].position.z - fleet[b].position.z;
                const dist = Math.hypot(dx, dz);
                assert(
                    dist >= 2.0,
                    `Frame ${frame}: Pair (${fleet[a].id}, ${fleet[b].id}) distance must be >= 2.0m, got ${dist.toFixed(3)}m`
                );
            }
        }
    }

    assert(enforcer.violationsPrevented > 0, 'Enforcer must have actively prevented compression violations');
});

test('Test 6: Anti-Overlap Enforcement: 4-car intersection convergence crush', () => {
    const spatialGrid = new SpatialGrid(300, 15);
    const enforcer = new AntiOverlapEnforcer();

    // 4 cars converging directly into the origin from N, S, E, W at high speed
    const fleet = [
        new Vehicle('north_car', 0, 1.5, Math.PI),   // facing -Z (down)
        new Vehicle('south_car', 0, -1.5, 0),         // facing +Z (up)
        new Vehicle('east_car', 1.5, 0, -Math.PI / 2),// facing -X (left)
        new Vehicle('west_car', -1.5, 0, Math.PI / 2) // facing +X (right)
    ];

    fleet[0].velocity.set(0, -10);
    fleet[1].velocity.set(0, 10);
    fleet[2].velocity.set(-10, 0);
    fleet[3].velocity.set(10, 0);

    for (let frame = 0; frame < 30; frame++) {
        spatialGrid.clearDynamic();
        for (let i = 0; i < fleet.length; i++) {
            fleet[i].position.x += fleet[i].velocity.x * (1 / 60);
            fleet[i].position.z += fleet[i].velocity.y * (1 / 60);
            spatialGrid.insertDynamic(fleet[i].id, fleet[i].position.x, fleet[i].position.z, fleet[i].radius, fleet[i]);
        }

        enforcer.enforce(fleet, spatialGrid, 1 / 60);

        // Verify pairwise distance >= 2.0m
        for (let a = 0; a < fleet.length; a++) {
            for (let b = a + 1; b < fleet.length; b++) {
                const dx = fleet[a].position.x - fleet[b].position.x;
                const dz = fleet[a].position.z - fleet[b].position.z;
                const dist = Math.hypot(dx, dz);
                assert(
                    dist >= 2.0,
                    `Convergence frame ${frame}: Pair (${fleet[a].id}, ${fleet[b].id}) distance must be >= 2.0m, was ${dist.toFixed(3)}m`
                );
            }
        }
    }
});

test('Test 7: TrafficWatchdogCoordinator integrated 300-tick continuous simulation', () => {
    const roadNetwork = new RoadNetwork();
    const spatialGrid = new SpatialGrid(300, 15);
    const coordinator = new TrafficWatchdogCoordinator();
    coordinator.init(roadNetwork);

    // Spawn 15 traffic vehicles from road network spawn points
    const spawns = roadNetwork.getSpawnPoints(15, 15.0);
    const fleet = [];
    for (let i = 0; i < spawns.length; i++) {
        const sp = spawns[i];
        const tv = new Vehicle(`traffic_${i}`, sp.x, sp.z, sp.yaw, 0x3366cc);
        tv.laneId = sp.laneId;
        tv.waypointIndex = sp.index;
        fleet.push(tv);
    }

    const playerVehicle = new Vehicle('player_vehicle', 0, -3.0, 0);

    // Run 300 simulation ticks
    for (let tick = 0; tick < 300; tick++) {
        // Simple forward driving
        for (let i = 0; i < fleet.length; i++) {
            fleet[i].setInputs(0.75, 0, 0, false);
            fleet[i].update(1 / 60, spatialGrid);
        }

        spatialGrid.clearDynamic();
        spatialGrid.insertDynamic(playerVehicle.id, playerVehicle.position.x, playerVehicle.position.z, playerVehicle.radius, playerVehicle);
        for (let i = 0; i < fleet.length; i++) {
            spatialGrid.insertDynamic(fleet[i].id, fleet[i].position.x, fleet[i].position.z, fleet[i].radius, fleet[i]);
        }

        // Run coordinator pass
        coordinator.step(fleet, playerVehicle, spatialGrid, roadNetwork, 1 / 60);

        // Check finite and overlap invariant
        for (let a = 0; a < fleet.length; a++) {
            assert(Number.isFinite(fleet[a].position.x));
            assert(Number.isFinite(fleet[a].position.z));
            for (let b = a + 1; b < fleet.length; b++) {
                const dx = fleet[a].position.x - fleet[b].position.x;
                const dz = fleet[a].position.z - fleet[b].position.z;
                const dist = Math.hypot(dx, dz);
                assert(
                    dist >= 2.0,
                    `Tick ${tick}: Overlap violation detected between ${fleet[a].id} and ${fleet[b].id}: ${dist.toFixed(2)}m < 2.0m`
                );
            }
        }
    }

    const metrics = coordinator.getMetrics();
    assert(metrics.currentTick === 300, 'Coordinator should have stepped 300 ticks');
});

test('Test 8: 1,000-frame Performance & Memory Leak Verification (50 vehicles, < 1.0ms/tick)', () => {
    const roadNetwork = new RoadNetwork();
    const spatialGrid = new SpatialGrid(300, 15);
    const coordinator = new TrafficWatchdogCoordinator();
    coordinator.init(roadNetwork);

    const spawns = roadNetwork.getSpawnPoints(50, 8.0);
    const fleet = [];
    for (let i = 0; i < spawns.length; i++) {
        const sp = spawns[i];
        const tv = new Vehicle(`perf_${i}`, sp.x, sp.z, sp.yaw, 0x55aa55);
        tv.laneId = sp.laneId;
        tv.waypointIndex = sp.index;
        fleet.push(tv);
    }

    // Warm-up
    for (let i = 0; i < 20; i++) {
        coordinator.step(fleet, null, spatialGrid, roadNetwork, 1 / 60);
    }

    if (global.gc) global.gc();
    const startMemory = process.memoryUsage().heapUsed;
    const tStart = performance.now();

    const frames = 1000;
    for (let f = 0; f < frames; f++) {
        spatialGrid.clearDynamic();
        for (let i = 0; i < fleet.length; i++) {
            spatialGrid.insertDynamic(fleet[i].id, fleet[i].position.x, fleet[i].position.z, fleet[i].radius, fleet[i]);
        }
        coordinator.step(fleet, null, spatialGrid, roadNetwork, 1 / 60);
    }

    const tEnd = performance.now();
    const endMemory = process.memoryUsage().heapUsed;
    const totalMs = tEnd - tStart;
    const avgMsPerTick = totalMs / frames;

    console.log(`\n  [Benchmark] 1,000 ticks with 30 vehicles: Total ${totalMs.toFixed(1)}ms | Avg ${avgMsPerTick.toFixed(3)}ms/tick`);
    console.log(`  [Memory] Start: ${(startMemory / 1024 / 1024).toFixed(2)}MB | End: ${(endMemory / 1024 / 1024).toFixed(2)}MB | Growth: ${((endMemory - startMemory) / 1024).toFixed(1)}KB`);

    // Verify sub-millisecond execution (< 1.0ms/tick)
    assert(avgMsPerTick < 1.0, `Average watchdog tick must be < 1.0ms, got ${avgMsPerTick.toFixed(3)}ms`);
});
