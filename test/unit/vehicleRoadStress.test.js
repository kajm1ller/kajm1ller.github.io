/**
 * test/unit/vehicleRoadStress.test.js
 * 
 * Milestone 2 Adversarial Empirical Stress Verification:
 * Vehicle Physics, Collision Resilience & RoadNetwork Query Scalability.
 * 
 * Tests:
 * 1. Chaotic & Extreme Vehicle Inputs:
 *    - Sudden full reverse at maximum velocity (28 m/s)
 *    - Infinite & NaN inputs in setInputs()
 *    - Extreme dt spikes (5.0s, 100.0s, 0.00001s, 0s, negative dt, NaN, Infinity)
 *    - High-frequency adversarial input chatter
 * 2. High-Density Obstacle Fields & Perimeter Boundary Collisions at Max Velocity:
 *    - Collisions with dense static obstacle fields at 28 m/s
 *    - Deep penetration inside static obstacles
 *    - Opposing obstacle crushing vice (opposing MTVs)
 *    - Dynamic vehicle vs vehicle head-on collision at 56 m/s closing speed
 *    - World boundary clamping across all 4 cardinal directions and corners at the map edge (CONFIG.WORLD.SAFE_BOUNDS)
 *    - lastSafePosition recovery activation under numerical corruption
 * 3. RoadNetwork Waypoint Queries & Lookaheads (50,000 randomized queries):
 *    - 50,000 randomized getNearestWaypoint() queries over wide coordinate spaces
 *    - 50,000 randomized getLookaheadWaypoint() queries with multi-lane traversals
 *    - Memory leak verification (multi-epoch heap delta ~ 0 KB)
 *    - Execution throughput and latency verification
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Vehicle } from '../../js/game/vehicle.js';
import { CONFIG } from '../../js/game/config.js';

const BOUNDS = CONFIG.WORLD.SAFE_BOUNDS;
const inBoundsX = (x) => x >= BOUNDS.MIN_X && x <= BOUNDS.MAX_X;
const inBoundsZ = (z) => z >= BOUNDS.MIN_Z && z <= BOUNDS.MAX_Z;
import { RoadNetwork } from '../../js/game/roadNetwork.js';
import { SpatialGrid } from '../../js/game/spatialGrid.js';

// Helper to check if vehicle pose and velocity are strictly finite
function assertVehicleFinite(v, contextMsg = '') {
    const pos = v.getPosition();
    const vel = v.getVelocity();
    const spd = v.getSpeed();
    const yaw = v.getYaw();

    assert(Number.isFinite(pos.x), `${contextMsg}: pos.x must be finite, got ${pos.x}`);
    assert(Number.isFinite(pos.y), `${contextMsg}: pos.y must be finite, got ${pos.y}`);
    assert(Number.isFinite(pos.z), `${contextMsg}: pos.z must be finite, got ${pos.z}`);
    assert(Number.isFinite(vel.x), `${contextMsg}: vel.x must be finite, got ${vel.x}`);
    assert(Number.isFinite(vel.z), `${contextMsg}: vel.z must be finite, got ${vel.z}`);
    assert(Number.isFinite(spd), `${contextMsg}: speed must be finite, got ${spd}`);
    assert(Number.isFinite(yaw), `${contextMsg}: yaw must be finite, got ${yaw}`);
}

// -----------------------------------------------------------------------------
// 1. Chaotic & Extreme Vehicle Inputs
// -----------------------------------------------------------------------------

test('Challenger 1.1: Sudden full reverse at maximum forward speed (28 m/s)', () => {
    const v = new Vehicle('challenger_rev', 0, 0, 0);

    // Accelerate to top speed
    v.setInputs(1.0, 0, 0, false);
    for (let i = 0; i < 400; i++) {
        v.update(1 / 60);
    }
    const maxSpeedReached = v.getSpeed();
    assert(maxSpeedReached > 23.0, `Speed should reach near max (28 m/s), got ${maxSpeedReached}`);

    // Suddenly slam full reverse input
    v.setInputs(0, 0, 1.0, false);

    let reachedZero = false;
    let reachedReverse = false;

    for (let i = 0; i < 300; i++) {
        v.update(1 / 60);
        assertVehicleFinite(v, `Tick ${i} during sudden reverse`);

        const spd = v.getSpeed();
        if (Math.abs(spd) < 0.1) {
            reachedZero = true;
        }
        if (spd < -2.0) {
            reachedReverse = true;
        }
    }

    assert(reachedZero, 'Vehicle should have decelerated smoothly through zero speed');
    assert(reachedReverse, 'Vehicle should have engaged reverse gear and accelerated backwards');
    assert(v.getSpeed() >= v.maxReverseSpeed, `Reverse speed should not exceed limit (${v.maxReverseSpeed}), got ${v.getSpeed()}`);
});

test('Challenger 1.2: Infinite, NaN, and corrupt inputs in setInputs()', () => {
    const v = new Vehicle('challenger_nan', 10, 20, 0);
    
    // Initial movement to establish non-zero state
    v.setInputs(1.0, 0, 0);
    for (let i = 0; i < 30; i++) v.update(1 / 60);
    const safeX = v.getPosition().x;
    const safeZ = v.getPosition().z;
    assertVehicleFinite(v, 'Initial state');

    // Feed adversarial inputs: NaN, Infinities, garbage objects
    const adversarialInputs = [
        [NaN, NaN, NaN, NaN],
        [Infinity, -Infinity, Infinity, true],
        [-Infinity, Infinity, -Infinity, false],
        [undefined, null, 'invalid', {}],
        [{ left: NaN, right: Infinity }, 0, 0, false],
        [NaN, { left: true, right: true }, NaN, 'text']
    ];

    for (let i = 0; i < adversarialInputs.length; i++) {
        const [th, st, br, hb] = adversarialInputs[i];
        v.setInputs(th, st, br, hb);
        v.update(1 / 60);
        assertVehicleFinite(v, `Adversarial input case ${i}`);
    }

    // Run 60 consecutive ticks with all-NaN inputs
    v.setInputs(NaN, NaN, NaN, NaN);
    for (let i = 0; i < 60; i++) {
        v.update(1 / 60);
        assertVehicleFinite(v, `Continuous NaN tick ${i}`);
    }

    // Vehicle state must remain clean and bounded
    const finalPos = v.getPosition();
    assert(inBoundsX(finalPos.x));
    assert(inBoundsZ(finalPos.z));
});

test('Challenger 1.3: Extreme dt spikes (lag spikes, microsteps, negative dt, non-finite dt)', () => {
    const v = new Vehicle('challenger_dt', 0, 0, 0);
    v.setInputs(1.0, 0.2, 0, false);

    // Normal stepping
    for (let i = 0; i < 30; i++) v.update(1 / 60);
    assertVehicleFinite(v, 'Baseline');

    // 1. Extreme lag spike: dt = 5.0 seconds
    v.update(5.0);
    assertVehicleFinite(v, 'dt = 5.0s');
    assert(inBoundsX(v.getPosition().x));
    assert(inBoundsZ(v.getPosition().z));

    // 2. Huge lag spike: dt = 100.0 seconds (must clamp to bounds)
    v.update(100.0);
    assertVehicleFinite(v, 'dt = 100.0s');
    assert(inBoundsX(v.getPosition().x));
    assert(inBoundsZ(v.getPosition().z));

    // 3. Microsteps: dt = 0.000001 seconds
    for (let i = 0; i < 100; i++) {
        v.update(0.000001);
    }
    assertVehicleFinite(v, 'dt = 1e-6');

    // 4. Zero and negative dt (must safely ignore / return early without mutation or NaN)
    const posBefore = { ...v.getPosition() };
    const spdBefore = v.getSpeed();
    v.update(0);
    v.update(-0.016);
    v.update(-100.0);
    assert.equal(v.getPosition().x, posBefore.x, 'Negative dt must not move vehicle');
    assert.equal(v.getPosition().z, posBefore.z, 'Negative dt must not move vehicle');
    assert.equal(v.getSpeed(), spdBefore, 'Negative dt must not alter speed');

    // 5. Non-finite dt (NaN, Infinity)
    v.update(NaN);
    assertVehicleFinite(v, 'dt = NaN');
    v.update(Infinity);
    assertVehicleFinite(v, 'dt = Infinity');
});

test('Challenger 1.4: High-frequency adversarial input chatter (600 ticks)', () => {
    const v = new Vehicle('challenger_chatter', 0, 0, 0);

    for (let tick = 0; tick < 600; tick++) {
        // Rapid alternating chatter
        const throttle = (tick % 2 === 0) ? 1.0 : 0.0;
        const brake = (tick % 2 === 1) ? 1.0 : 0.0;
        const steer = (tick % 4 < 2) ? 1.0 : -1.0;
        const handbrake = (tick % 7 === 0);

        v.setInputs(throttle, steer, brake, handbrake);
        v.update(1 / 60);

        assertVehicleFinite(v, `Chatter tick ${tick}`);
    }

    assert(inBoundsX(v.getPosition().x));
    assert(inBoundsZ(v.getPosition().z));
});

// -----------------------------------------------------------------------------
// 2. High-Density Obstacle Fields & Perimeter Boundary Collisions at Max Velocity
// -----------------------------------------------------------------------------

test('Challenger 2.1: High-velocity obstacle impact at 28 m/s (MTV reflection & speed re-projection)', () => {
    const grid = new SpatialGrid(300, 15);
    // Large static rock at (0, -20)
    grid.insertStatic('rock_impact', {
        min: { x: -3, y: 0, z: -23 },
        max: { x: 3, y: 5, z: -17 }
    });

    const v = new Vehicle('rammer', 0, 0, 0);
    // Ram forward at max speed into rock
    v.speed = 28.0;
    v.velocity.set(0, -28.0);
    v.setInputs(1.0, 0, 0);

    for (let i = 0; i < 60; i++) {
        v.update(1 / 60, grid);
        assertVehicleFinite(v, `Impact tick ${i}`);
    }

    const pos = v.getPosition();
    // Bounding hull must be pushed outside rock surface (rock z max is -17)
    // Vehicle center + front circle offset (1.35) + circleRadius (1.10) = front bumper at z - 2.45
    assert(pos.z > -18.5, `Vehicle must be deflected outside obstacle: z=${pos.z}`);
    assert(inBoundsX(pos.x));
});

test('Challenger 2.2: Dense obstacle field traversal at max velocity (120+ static obstacles)', () => {
    const grid = new SpatialGrid(300, 15);
    // Place a grid of obstacles spaced 4m apart (gap = 2m, narrower than car width 2.2m)
    for (let x = -30; x <= 30; x += 4) {
        for (let z = -30; z <= 30; z += 4) {
            grid.insertStatic(`obs_${x}_${z}`, {
                min: { x: x - 1, y: 0, z: z - 1 },
                max: { x: x + 1, y: 3, z: z + 1 }
            });
        }
    }

    const v = new Vehicle('field_survivor', 0, 0, 0);
    v.speed = 28.0;
    v.velocity.set(0, -28.0);

    for (let tick = 0; tick < 600; tick++) {
        // Drive with steering sweep
        v.setInputs(1.0, Math.sin(tick * 0.1), 0, false);
        v.update(1 / 60, grid);
        assertVehicleFinite(v, `Dense field tick ${tick}`);
    }

    const pos = v.getPosition();
    assert(inBoundsX(pos.x));
    assert(inBoundsZ(pos.z));
});

test('Challenger 2.3: Opposing obstacle crushing vice (opposing MTV equilibrium)', () => {
    const grid = new SpatialGrid(300, 15);
    // Two static walls sandwiching X: 0 from left and right
    // Left wall from -5 to -0.5, Right wall from 0.5 to 5
    // Car width is 2.2m, squeezed into a 1.0m slot
    grid.insertStatic('left_wall', {
        min: { x: -5, y: 0, z: -20 },
        max: { x: -0.5, y: 4, z: 20 }
    });
    grid.insertStatic('right_wall', {
        min: { x: 0.5, y: 0, z: -20 },
        max: { x: 5, y: 4, z: 20 }
    });

    const v = new Vehicle('squished', 0, 0, 0);
    v.speed = 28.0;
    v.velocity.set(0, -28.0);

    for (let i = 0; i < 120; i++) {
        v.setInputs(1.0, 0, 0);
        v.update(1 / 60, grid);
        assertVehicleFinite(v, `Vice tick ${i}`);
    }

    // Vehicle must not explode out of the world or produce runaway velocity
    const pos = v.getPosition();
    assert(Math.abs(pos.x) < 1.0, `Vehicle should remain stably centered between walls, got x=${pos.x}`);
    assert(Math.abs(v.getVelocity().x) < 5.0, 'Lateral velocity must remain stable');
});

test('Challenger 2.4: Spawn inside static obstacle (deep penetration resolution)', () => {
    const grid = new SpatialGrid(300, 15);
    grid.insertStatic('boulder', {
        min: { x: -5, y: 0, z: -5 },
        max: { x: 5, y: 4, z: 5 }
    });

    // Spawn vehicle directly at center of boulder
    const v = new Vehicle('spawn_inside', 0, 0, 0);
    v.speed = 28.0;
    v.velocity.set(0, -28.0);

    for (let i = 0; i < 60; i++) {
        v.update(1 / 60, grid);
        assertVehicleFinite(v, `Deep penetration tick ${i}`);
    }

    const pos = v.getPosition();
    // Must have resolved out of the boulder along -Z
    assert(pos.z < -5.0 || pos.z > 5.0 || pos.x < -5.0 || pos.x > 5.0, `Vehicle should be ejected from boulder, got pos=(${pos.x}, ${pos.z})`);
});

test('Challenger 2.5: High-speed dynamic head-on vehicle collision at 56 m/s closing speed', () => {
    const grid = new SpatialGrid(300, 15);

    const v1 = new Vehicle('car_1', 0, 20, 0);      // Heading 0 faces -Z
    const v2 = new Vehicle('car_2', 0, -20, Math.PI);// Heading PI faces +Z

    v1.speed = 28.0;
    v1.velocity.set(0, -28.0);
    v2.speed = 28.0;
    v2.velocity.set(0, 28.0);

    for (let i = 0; i < 60; i++) {
        grid.clearDynamic();
        grid.insertDynamic(v1.id, v1.position.x, v1.position.z, v1.radius, v1);
        grid.insertDynamic(v2.id, v2.position.x, v2.position.z, v2.radius, v2);

        v1.update(1 / 60, grid);
        v2.update(1 / 60, grid);

        assertVehicleFinite(v1, `Head-on tick ${i} (v1)`);
        assertVehicleFinite(v2, `Head-on tick ${i} (v2)`);
    }

    // Both cars must have bounced apart and remain finite
    const p1 = v1.getPosition();
    const p2 = v2.getPosition();
    const dist = Math.hypot(p1.x - p2.x, p1.z - p2.z);
    assert(dist > 0.5, `Vehicles should bounce apart, distance=${dist}`);
});

test('Challenger 2.6: World boundary containment across all bounds and corners at the map edge', () => {
    const boundTests = [
        { name: 'North', x: 0, z: BOUNDS.MIN_Z + 10, yaw: 0, vx: 0, vz: -28 },
        { name: 'South', x: 0, z: BOUNDS.MAX_Z - 10, yaw: Math.PI, vx: 0, vz: 28 },
        { name: 'East', x: BOUNDS.MAX_X - 10, z: 0, yaw: -Math.PI / 2, vx: 28, vz: 0 },
        { name: 'West', x: BOUNDS.MIN_X + 10, z: 0, yaw: Math.PI / 2, vx: -28, vz: 0 },
        { name: 'Corner NE', x: BOUNDS.MAX_X - 5, z: BOUNDS.MIN_Z + 5, yaw: -Math.PI / 4, vx: 20, vz: -20 },
        { name: 'Corner SW', x: BOUNDS.MIN_X + 5, z: BOUNDS.MAX_Z - 5, yaw: 3 * Math.PI / 4, vx: -20, vz: 20 }
    ];

    for (const testCase of boundTests) {
        const v = new Vehicle(`bound_${testCase.name}`, testCase.x, testCase.z, testCase.yaw);
        v.speed = 28.0;
        v.velocity.set(testCase.vx, testCase.vz);

        for (let i = 0; i < 60; i++) {
            v.setInputs(1.0, 0, 0);
            v.update(1 / 60);
            assertVehicleFinite(v, `${testCase.name} bound tick ${i}`);
        }

        const p = v.getPosition();
        assert(inBoundsX(p.x), `${testCase.name}: X out of bounds: ${p.x}`);
        assert(inBoundsZ(p.z), `${testCase.name}: Z out of bounds: ${p.z}`);
    }
});

test('Challenger 2.7: lastSafePosition recovery activation upon state corruption', () => {
    const v = new Vehicle('corrupt_recovery', 45, 65, 1.2);
    
    // Move cleanly for 30 ticks
    v.setInputs(1.0, 0, 0);
    for (let i = 0; i < 30; i++) v.update(1 / 60);
    
    const safePos = { ...v.getPosition() };
    const safeYaw = v.getYaw();
    assertVehicleFinite(v, 'Before corruption');

    // Manually induce corruption into position
    v.position.x = NaN;
    v.velocity.x = Infinity;
    v.speed = NaN;

    // Next update tick must trigger recovery
    v.update(1 / 60);

    assertVehicleFinite(v, 'After recovery');
    const recoveredPos = v.getPosition();
    assert.equal(recoveredPos.x, safePos.x, `X must restore to lastSafePosition: ${recoveredPos.x} vs ${safePos.x}`);
    assert.equal(recoveredPos.z, safePos.z, `Z must restore to lastSafePosition: ${recoveredPos.z} vs ${safePos.z}`);
    assert.equal(v.getSpeed(), 0, 'Speed must reset to 0 after corruption recovery');
    assert.equal(v.getYaw(), safeYaw, 'Yaw must restore to lastSafeYaw');
});

// -----------------------------------------------------------------------------
// 3. RoadNetwork Waypoint Queries & Lookaheads at Scale (50,000 queries)
// -----------------------------------------------------------------------------

test('Challenger 3.1: 50,000 randomized getNearestWaypoint() queries across wide domain', () => {
    const rn = new RoadNetwork();
    let validCount = 0;

    const t0 = performance.now();
    for (let i = 0; i < 50000; i++) {
        // Random point across [-500, 500]
        const x = (Math.random() - 0.5) * 1000;
        const z = (Math.random() - 0.5) * 1000;

        const wp = rn.getNearestWaypoint(x, z);

        if (Number.isFinite(wp.x) &&
            Number.isFinite(wp.z) &&
            Number.isFinite(wp.yaw) &&
            Number.isFinite(wp.distance) &&
            typeof wp.laneId === 'string' &&
            wp.laneId.length > 0 &&
            Number.isInteger(wp.index)) {
            validCount++;
        }
    }
    const elapsed = performance.now() - t0;

    assert.equal(validCount, 50000, `All 50,000 queries must be valid, got ${validCount}`);
    assert(elapsed < 1000, `50,000 getNearestWaypoint queries should take <1000ms, took ${elapsed.toFixed(1)}ms`);
});

test('Challenger 3.2: 50,000 randomized getLookaheadWaypoint() queries with successor traversal', () => {
    const rn = new RoadNetwork();
    const lanes = rn.getAllLanes();
    const laneCount = lanes.length;
    assert(laneCount > 0);

    let validCount = 0;
    const t0 = performance.now();

    for (let i = 0; i < 50000; i++) {
        const lane = lanes[i % laneCount];
        // Random index: negative, 0, within lane, and beyond lane end
        const currIdx = Math.floor(Math.random() * (lane.waypoints.length + 10)) - 3;
        // Random lookahead distance: 0m to 150m (traversing multiple segments)
        const lookaheadDist = Math.random() * 150.0;

        const wp = rn.getLookaheadWaypoint(lane.id, currIdx, lookaheadDist);

        if (Number.isFinite(wp.x) &&
            Number.isFinite(wp.z) &&
            Number.isFinite(wp.yaw) &&
            typeof wp.laneId === 'string' &&
            wp.laneId.length > 0 &&
            Number.isFinite(wp.index)) {
            validCount++;
        }
    }
    const elapsed = performance.now() - t0;

    assert.equal(validCount, 50000, `All 50,000 queries must be valid, got ${validCount}`);
    assert(elapsed < 500, `50,000 getLookaheadWaypoint queries should take <500ms, took ${elapsed.toFixed(1)}ms`);
});

test('Challenger 3.3: Zero memory leak verification over 50,000 waypoint queries', () => {
    const rn = new RoadNetwork();
    const lanes = rn.getAllLanes();
    const laneCount = lanes.length;

    function runBatch(count) {
        for (let i = 0; i < count; i++) {
            const x = (i % 300) - 150;
            const z = ((i * 7) % 300) - 150;
            rn.getNearestWaypoint(x, z);

            const lane = lanes[i % laneCount];
            const currIdx = (i % (lane.waypoints.length + 2)) - 1;
            rn.getLookaheadWaypoint(lane.id, currIdx, (i % 30) + 2.0);
        }
    }

    // Warm-up JIT and populate caches
    runBatch(5000);
    if (global.gc) global.gc();

    const baselineHeap = process.memoryUsage().heapUsed;

    // Execute 50,000 continuous dual queries
    runBatch(50000);
    if (global.gc) {
        global.gc();
        const postHeap = process.memoryUsage().heapUsed;
        const deltaBytes = postHeap - baselineHeap;
        const deltaMb = deltaBytes / (1024 * 1024);
        assert(deltaMb < 1.0, `Heap growth after 50,000 queries with GC must be < 1.0 MB, got ${deltaMb.toFixed(3)} MB`);
    } else {
        const postHeap = process.memoryUsage().heapUsed;
        const deltaBytes = postHeap - baselineHeap;
        const deltaMb = deltaBytes / (1024 * 1024);
        assert(deltaMb < 15.0, `Heap growth without explicit GC must be bounded (< 15.0 MB), got ${deltaMb.toFixed(3)} MB`);
    }
});
