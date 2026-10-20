import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import { SpatialGrid } from '../../js/game/spatialGrid.js';

function verifyEntryIntegrity(entries, label = '') {
    const ids = new Set();
    for (let i = 0; i < entries.length; i++) {
        const item = entries[i];
        assert.ok(item, `${label} Entry [${i}] must be defined`);
        assert.ok(Number.isFinite(item.x), `${label} Entry ${item.id} .x must be finite, got ${item.x}`);
        assert.ok(Number.isFinite(item.z), `${label} Entry ${item.id} .z must be finite, got ${item.z}`);
        assert.ok(Number.isFinite(item.radius), `${label} Entry ${item.id} .radius must be finite, got ${item.radius}`);
        assert.ok(Number.isFinite(item.minX), `${label} Entry ${item.id} .minX must be finite, got ${item.minX}`);
        assert.ok(Number.isFinite(item.maxX), `${label} Entry ${item.id} .maxX must be finite, got ${item.maxX}`);
        assert.ok(Number.isFinite(item.minZ), `${label} Entry ${item.id} .minZ must be finite, got ${item.minZ}`);
        assert.ok(Number.isFinite(item.maxZ), `${label} Entry ${item.id} .maxZ must be finite, got ${item.maxZ}`);
        assert.ok(!ids.has(item.id), `${label} Duplicate entry found with ID: ${item.id}`);
        ids.add(item.id);
    }
}

test('1. Extreme Coordinates & Out-of-Bounds Handling (+/-10,000m, extreme limits)', () => {
    const grid = new SpatialGrid(300, 15);
    const scratch = [];

    // Test coordinates far beyond [-300, 300]m
    grid.insertDynamic('far_ne', 10000, 10000, 2.0, {});
    grid.insertDynamic('far_sw', -10000, -10000, 2.0, {});
    grid.insertDynamic('far_nw', -50000, 50000, 2.0, {});
    grid.insertDynamic('far_se', 50000, -50000, 2.0, {});
    grid.insertDynamic('world_edge_max', 300, 300, 2.0, {});
    grid.insertDynamic('world_edge_min', -300, -300, 2.0, {});
    grid.insertDynamic('center_normal', 0, 0, 2.0, {});

    // Far Northeast queries
    grid.queryRadius(10000, 10000, 5, scratch);
    assert.equal(scratch.length, 1);
    assert.equal(scratch[0].id, 'far_ne');
    verifyEntryIntegrity(scratch, 'far_ne query');

    // Query center should NOT return far entities
    grid.queryRadius(0, 0, 50, scratch);
    assert.equal(scratch.length, 1);
    assert.equal(scratch[0].id, 'center_normal');
    verifyEntryIntegrity(scratch, 'center query');

    // Query Northwest
    grid.queryRadius(-50000, 50000, 10, scratch);
    assert.equal(scratch.length, 1);
    assert.equal(scratch[0].id, 'far_nw');
    verifyEntryIntegrity(scratch, 'far_nw query');

    // Box query covering extreme coordinates
    grid.queryBox({ min: { x: 9990, z: 9990 }, max: { x: 10010, z: 10010 } }, scratch);
    assert.equal(scratch.length, 1);
    assert.equal(scratch[0].id, 'far_ne');
    verifyEntryIntegrity(scratch, 'box far_ne query');

    // Static items at extreme coordinates
    grid.insertStatic('far_static', {
        min: { x: 9990, y: 0, z: 9990 },
        max: { x: 10010, y: 5, z: 10010 }
    });
    grid.queryRadius(10000, 10000, 25, scratch, 'STATIC');
    assert.equal(scratch.length, 1);
    assert.equal(scratch[0].id, 'far_static');
    verifyEntryIntegrity(scratch, 'far_static query');
});

test('1b. NaN & Invalid Coordinate Guards', () => {
    const grid = new SpatialGrid(300, 15);
    const scratch = [];

    // Inserting dynamic with NaN coordinates
    assert.doesNotThrow(() => {
        grid.insertDynamic('nan_dynamic_x', NaN, 0, 2.0, {});
        grid.insertDynamic('nan_dynamic_z', 0, NaN, 2.0, {});
        grid.insertDynamic('nan_dynamic_both', NaN, NaN, 2.0, {});
        grid.insertDynamic('nan_dynamic_radius', 0, 0, NaN, {});
    });

    // Inserting static with NaN coordinates
    assert.doesNotThrow(() => {
        grid.insertStatic('nan_static_1', { min: { x: NaN, y: 0, z: 0 }, max: { x: 10, y: 2, z: 10 } });
        grid.insertStatic('nan_static_2', { min: { x: 0, y: 0, z: NaN }, max: { x: 10, y: 2, z: 10 } });
        grid.insertStatic('nan_static_3', { min: { x: 0, y: 0, z: 0 }, max: { x: NaN, y: 2, z: 10 } });
    });

    // Valid entity for baseline
    grid.insertDynamic('valid_center', 0, 0, 2.0, {});

    // Querying with NaN coordinates or radius must never throw and must return empty or safe results
    assert.doesNotThrow(() => {
        grid.queryRadius(NaN, 0, 10, scratch);
    });
    assert.equal(scratch.length, 0);

    assert.doesNotThrow(() => {
        grid.queryRadius(0, NaN, 10, scratch);
    });
    assert.equal(scratch.length, 0);

    assert.doesNotThrow(() => {
        grid.queryRadius(0, 0, NaN, scratch);
    });
    assert.equal(scratch.length, 0);

    assert.doesNotThrow(() => {
        grid.queryBox({ min: { x: NaN, z: 0 }, max: { x: 10, z: 10 } }, scratch);
    });
    assert.equal(scratch.length, 0);

    // Normal query still works and does not return corrupted NaN entries
    grid.queryRadius(0, 0, 10, scratch);
    assert.equal(scratch.length, 1);
    assert.equal(scratch[0].id, 'valid_center');
    verifyEntryIntegrity(scratch, 'after NaN tests');

    // Negative radius query
    grid.queryRadius(0, 0, -10, scratch);
    assert.equal(scratch.length, 0);

    // Inverted queryBox (min > max)
    grid.queryBox({ min: { x: 50, z: 50 }, max: { x: -50, z: -50 } }, scratch);
    assert.equal(scratch.length, 0);
});

test('2. Dense Clusters (100+ entities at exact same point/cell)', () => {
    const grid = new SpatialGrid(300, 15);
    const scratch = [];
    const CLUSTER_SIZE = 100;
    const CLUSTER_X = 42.5;
    const CLUSTER_Z = 87.2;

    // Insert 100 dynamic entities at the exact same point
    for (let i = 0; i < CLUSTER_SIZE; i++) {
        const entity = { id: `dense_veh_${i}`, x: CLUSTER_X, z: CLUSTER_Z };
        grid.insertDynamic(entity.id, entity.x, entity.z, 2.0, entity);
    }

    // Query at cluster point
    grid.queryRadius(CLUSTER_X, CLUSTER_Z, 5, scratch);
    assert.equal(scratch.length, CLUSTER_SIZE, `Expected ${CLUSTER_SIZE} items, got ${scratch.length}`);
    verifyEntryIntegrity(scratch, 'Dense cluster query');

    // Query 15m away (should find none of them with radius 2)
    grid.queryRadius(CLUSTER_X + 15, CLUSTER_Z + 15, 2, scratch);
    assert.equal(scratch.length, 0);

    // Box query covering the dense cluster
    grid.queryBox({
        min: { x: CLUSTER_X - 1, z: CLUSTER_Z - 1 },
        max: { x: CLUSTER_X + 1, z: CLUSTER_Z + 1 }
    }, scratch);
    assert.equal(scratch.length, CLUSTER_SIZE);
    verifyEntryIntegrity(scratch, 'Dense cluster box query');

    // Clear dynamic and verify cluster is completely emptied
    grid.clearDynamic();
    grid.queryRadius(CLUSTER_X, CLUSTER_Z, 10, scratch);
    assert.equal(scratch.length, 0, 'Cell should be empty after clearDynamic');

    // Re-insert at a different position and verify no stale references
    for (let i = 0; i < CLUSTER_SIZE; i++) {
        const entity = { id: `dense_veh_${i}`, x: -50, z: -50 };
        grid.insertDynamic(entity.id, entity.x, entity.z, 2.0, entity);
    }
    grid.queryRadius(CLUSTER_X, CLUSTER_Z, 10, scratch);
    assert.equal(scratch.length, 0, 'Old location must remain empty');

    grid.queryRadius(-50, -50, 5, scratch);
    assert.equal(scratch.length, CLUSTER_SIZE, 'New location must have all 100 items');
    verifyEntryIntegrity(scratch, 'Re-inserted dense cluster');

    // Mixed cluster: 50 static + 50 dynamic at same coordinate
    for (let i = 0; i < 50; i++) {
        grid.insertStatic(`static_cluster_${i}`, {
            min: { x: 100, y: 0, z: 100 },
            max: { x: 102, y: 3, z: 102 }
        });
        grid.insertDynamic(`dyn_cluster_${i}`, 101, 101, 2.0, {});
    }
    grid.queryRadius(101, 101, 5, scratch, 'ALL');
    assert.equal(scratch.length, 100);
    verifyEntryIntegrity(scratch, 'Mixed 50 static + 50 dynamic cluster');

    grid.queryRadius(101, 101, 5, scratch, 'STATIC');
    assert.equal(scratch.length, 50);

    grid.queryRadius(101, 101, 5, scratch, 'DYNAMIC');
    assert.equal(scratch.length, 50);
});

test('3. 100,000 Queries in Tight Loops: 0 Heap Growth & Performance', () => {
    const grid = new SpatialGrid(300, 15);
    const scratch = [];

    // Populate realistic world: 200 static obstacles + 60 dynamic entities
    for (let i = 0; i < 200; i++) {
        const x = ((i * 37) % 560) - 280;
        const z = ((i * 53) % 560) - 280;
        grid.insertStatic(`obs_${i}`, {
            min: { x: x - 1.5, y: 0, z: z - 1.5 },
            max: { x: x + 1.5, y: 3, z: z + 1.5 }
        });
    }

    const entities = [];
    for (let i = 0; i < 60; i++) {
        const ent = {
            id: `v_${i}`,
            x: ((i * 29) % 500) - 250,
            z: ((i * 41) % 500) - 250,
            radius: 2.25
        };
        entities.push(ent);
        grid.insertDynamic(ent.id, ent.x, ent.z, ent.radius, ent);
    }

    const reusableBox = { min: { x: 0, z: 0 }, max: { x: 0, z: 0 } };

    // Warm-up JIT with 10,000 queries to stabilize V8 compiler & internal inline caches
    for (let i = 0; i < 10000; i++) {
        const ent = entities[i % entities.length];
        grid.queryRadius(ent.x, ent.z, 15, scratch);
        if (i % 5 === 0) {
            reusableBox.min.x = ent.x - 10;
            reusableBox.min.z = ent.z - 10;
            reusableBox.max.x = ent.x + 10;
            reusableBox.max.z = ent.z + 10;
            grid.queryBox(reusableBox, scratch);
        }
    }

    // Force multiple GC sweeps to settle heap before measuring
    if (global.gc) {
        global.gc();
        global.gc();
    }
    const heapBefore = process.memoryUsage().heapUsed;
    const t0 = performance.now();

    const QUERY_COUNT = 100000;
    // Epoch 1: 100,000 queries
    for (let q = 0; q < QUERY_COUNT; q++) {
        const ent = entities[q % entities.length];
        const mod = q % 4;
        if (mod === 0) {
            grid.queryRadius(ent.x, ent.z, 15, scratch, 'ALL');
        } else if (mod === 1) {
            grid.queryRadius(ent.x, ent.z, 20, scratch, 'DYNAMIC');
        } else if (mod === 2) {
            grid.queryRadius(ent.x, ent.z, 25, scratch, 'STATIC');
        } else {
            reusableBox.min.x = ent.x - 12;
            reusableBox.min.z = ent.z - 12;
            reusableBox.max.x = ent.x + 12;
            reusableBox.max.z = ent.z + 12;
            grid.queryBox(reusableBox, scratch);
        }
    }

    const elapsedMs = performance.now() - t0;
    if (global.gc) {
        global.gc();
        global.gc();
    }
    const heapAfterEpoch1 = process.memoryUsage().heapUsed;

    // Epoch 2: Another 100,000 queries to measure ongoing per-epoch heap delta
    for (let q = 0; q < QUERY_COUNT; q++) {
        const ent = entities[q % entities.length];
        const mod = q % 4;
        if (mod === 0) {
            grid.queryRadius(ent.x, ent.z, 15, scratch, 'ALL');
        } else if (mod === 1) {
            grid.queryRadius(ent.x, ent.z, 20, scratch, 'DYNAMIC');
        } else if (mod === 2) {
            grid.queryRadius(ent.x, ent.z, 25, scratch, 'STATIC');
        } else {
            reusableBox.min.x = ent.x - 12;
            reusableBox.min.z = ent.z - 12;
            reusableBox.max.x = ent.x + 12;
            reusableBox.max.z = ent.z + 12;
            grid.queryBox(reusableBox, scratch);
        }
    }

    if (global.gc) {
        global.gc();
        global.gc();
    }
    const heapAfterEpoch2 = process.memoryUsage().heapUsed;
    const epochDeltaBytes = heapAfterEpoch2 - heapAfterEpoch1;
    const opsPerSec = (QUERY_COUNT / (elapsedMs / 1000)).toFixed(0);

    console.log(`\n--- 100,000 Query Stress Benchmark Results ---`);
    console.log(`Total Time (100k):  ${elapsedMs.toFixed(2)} ms`);
    console.log(`Throughput:         ${opsPerSec} queries/sec`);
    console.log(`Avg Latency:        ${((elapsedMs / QUERY_COUNT) * 1000).toFixed(2)} µs/query`);
    console.log(`Heap Baseline:      ${(heapBefore / 1024).toFixed(2)} KB`);
    console.log(`Heap After Epoch 1: ${(heapAfterEpoch1 / 1024).toFixed(2)} KB`);
    console.log(`Heap After Epoch 2: ${(heapAfterEpoch2 / 1024).toFixed(2)} KB`);
    console.log(`Epoch 2 Delta:      ${(epochDeltaBytes / 1024).toFixed(2)} KB`);

    // Verify sustained heap delta across 100,000 queries is effectively 0 (< 256KB background node:test churn)
    // Any real leak of even 1 object per query would exceed 4.8MB (100,000 * 48B).
    assert.ok(
        epochDeltaBytes < 256 * 1024,
        `Memory leak detected! Heap grew by ${epochDeltaBytes} bytes across 100,000 queries`
    );

    // Verify query performance exceeds 100,000 queries/sec (> 100 queries/ms)
    assert.ok(
        elapsedMs < 1000,
        `Performance failure: 100,000 queries took ${elapsedMs.toFixed(2)}ms (expected < 1000ms)`
    );
});

test('4. Comprehensive Deduplication & Multi-Cell Straddling Verification', () => {
    const grid = new SpatialGrid(300, 15);
    const scratch = [];

    // Cell size is 15m. Place entity directly on 4-cell corner (x=0, z=0)
    // with radius 10m so it overlaps 4 cells: (19,19), (19,20), (20,19), (20,20)
    grid.insertDynamic('corner_straddler', 0, 0, 10, {});

    // Place giant static obstacle spanning 9 cells: [-20, 20] x [-20, 20]
    grid.insertStatic('giant_static', {
        min: { x: -20, y: 0, z: -20 },
        max: { x: 20, y: 10, z: 20 }
    });

    // Query covering all overlapping cells
    grid.queryRadius(0, 0, 25, scratch);

    // Even though both objects overlap multiple cells, scratch MUST have length 2 (deduplicated)
    assert.equal(scratch.length, 2, `Expected 2 deduplicated items, got ${scratch.length}`);
    const foundIds = scratch.map(s => s.id).sort();
    assert.deepEqual(foundIds, ['corner_straddler', 'giant_static']);
    verifyEntryIntegrity(scratch, 'Straddler queryRadius');

    // Box query covering the same region
    grid.queryBox({ min: { x: -25, z: -25 }, max: { x: 25, z: 25 } }, scratch);
    assert.equal(scratch.length, 2);
    assert.deepEqual(scratch.map(s => s.id).sort(), ['corner_straddler', 'giant_static']);
    verifyEntryIntegrity(scratch, 'Straddler queryBox');

    // Verify all returned numbers are strictly finite
    for (const item of scratch) {
        assert.ok(Number.isFinite(item.x));
        assert.ok(Number.isFinite(item.z));
        assert.ok(Number.isFinite(item.radius));
        assert.ok(Number.isFinite(item.minX));
        assert.ok(Number.isFinite(item.maxX));
        assert.ok(Number.isFinite(item.minZ));
        assert.ok(Number.isFinite(item.maxZ));
    }
});

test('5. Differential Ground-Truth Oracle Verification (500 Random Probes)', () => {
    const grid = new SpatialGrid(300, 15);
    const scratch = [];

    // Deterministic LCG pseudo-random generator for 100% reproducible test runs
    let seed = 123456789;
    function rand(min, max) {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        const normalized = seed / 4294967296;
        return min + normalized * (max - min);
    }

    // Generate 100 static obstacles
    const staticItems = [];
    for (let i = 0; i < 100; i++) {
        const cx = rand(-280, 280);
        const cz = rand(-280, 280);
        const hw = rand(0.5, 4.0);
        const hd = rand(0.5, 4.0);
        const box = {
            min: { x: cx - hw, y: 0, z: cz - hd },
            max: { x: cx + hw, y: 3, z: cz + hd }
        };
        const id = `stat_${i}`;
        staticItems.push({
            id,
            minX: box.min.x, maxX: box.max.x,
            minZ: box.min.z, maxZ: box.max.z
        });
        grid.insertStatic(id, box);
    }

    // Generate 100 dynamic entities (some beyond [-300, 300])
    const dynamicItems = [];
    for (let i = 0; i < 100; i++) {
        const id = `dyn_${i}`;
        const x = rand(-350, 350);
        const z = rand(-350, 350);
        const radius = rand(1.0, 3.5);
        const ent = { id, x, z, radius };
        dynamicItems.push(ent);
        grid.insertDynamic(id, x, z, radius, ent);
    }

    // Run 500 randomized queries and compare against ground truth linear scan
    for (let p = 0; p < 500; p++) {
        const qx = rand(-320, 320);
        const qz = rand(-320, 320);
        const qRadius = rand(5, 30);
        const qRadiusSq = qRadius * qRadius;

        // Ground-truth oracle evaluation
        const expectedIds = [];

        // Check statics against clamped AABB
        for (const item of staticItems) {
            const cx = Math.max(item.minX, Math.min(qx, item.maxX));
            const cz = Math.max(item.minZ, Math.min(qz, item.maxZ));
            const dx = qx - cx;
            const dz = qz - cz;
            if (dx * dx + dz * dz <= qRadiusSq) {
                expectedIds.push(item.id);
            }
        }

        // Check dynamics against circle-circle
        for (const item of dynamicItems) {
            const dx = item.x - qx;
            const dz = item.z - qz;
            const comb = qRadius + item.radius;
            if (dx * dx + dz * dz <= comb * comb) {
                expectedIds.push(item.id);
            }
        }

        // Execute spatial grid query
        grid.queryRadius(qx, qz, qRadius, scratch, 'ALL');

        // Verify entry validity and deduplication
        verifyEntryIntegrity(scratch, `Probe ${p}`);

        const actualIds = scratch.map(e => e.id).sort();
        expectedIds.sort();

        assert.deepEqual(
            actualIds,
            expectedIds,
            `Oracle mismatch at probe ${p} (qx=${qx.toFixed(1)}, qz=${qz.toFixed(1)}, r=${qRadius.toFixed(1)}):
             Expected ${expectedIds.length} items: ${JSON.stringify(expectedIds)}
             Actual ${actualIds.length} items: ${JSON.stringify(actualIds)}`
        );
    }
});

