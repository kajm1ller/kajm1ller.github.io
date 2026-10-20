import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialGrid } from './spatialGrid.prototype.js';

test('SpatialGrid: initialization and dimensions', () => {
    const grid = new SpatialGrid(600, 15);
    assert.equal(grid.worldSize, 600);
    assert.equal(grid.cellSize, 15);
    assert.equal(grid.cols, 40);
    assert.equal(grid.rows, 40);
    assert.equal(grid.numCells, 1600);
    assert.equal(grid.staticCells.length, 1600);
    assert.equal(grid.dynamicCells.length, 1600);
});

test('SpatialGrid: coordinate clamping handles out-of-bounds cleanly', () => {
    const grid = new SpatialGrid(600, 15);
    // At center
    assert.equal(grid._coordToCellX(0), 20);
    assert.equal(grid._coordToCellZ(0), 20);
    
    // Bounds edges (-300 to +300)
    assert.equal(grid._coordToCellX(-300), 0);
    assert.equal(grid._coordToCellX(299.9), 39);
    
    // Far out of bounds
    assert.equal(grid._coordToCellX(-1000), 0);
    assert.equal(grid._coordToCellX(1000), 39);
    assert.equal(grid._coordToCellZ(-9999), 0);
    assert.equal(grid._coordToCellZ(9999), 39);
});

test('SpatialGrid: static insertion and query', () => {
    const grid = new SpatialGrid(600, 15);
    const box = {
        min: { x: 5, y: 0, z: 5 },
        max: { x: 10, y: 5, z: 10 }
    };
    grid.insertStatic('rock1', box);
    
    const results = [];
    grid.queryRadius(7, 7, 5, results);
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'rock1');
    assert.equal(results[0].isStatic, true);
    
    // Far query should not find rock1
    grid.queryRadius(100, 100, 10, results);
    assert.equal(results.length, 0);
});

test('SpatialGrid: dynamic insertion, deduplication across cells, and clearDynamic', () => {
    const grid = new SpatialGrid(600, 15);
    // Insert an entity that spans across cell boundary (cell boundary at x=0, z=0)
    // x=-2, z=-2, radius=5 spans x in [-7, 3] and z in [-7, 3]
    grid.insertDynamic('car1', -2, -2, 5, { name: 'PlayerCar' });
    
    const results = [];
    grid.queryRadius(0, 0, 10, results);
    assert.equal(results.length, 1, 'Entity spanning multiple cells should be deduplicated to exactly 1 result');
    assert.equal(results[0].id, 'car1');
    assert.equal(results[0].entityRef.name, 'PlayerCar');
    
    // Static items are preserved while dynamic are cleared
    grid.insertStatic('tree1', { min: { x: -5, y: 0, z: -5 }, max: { x: -3, y: 4, z: -3 } });
    
    grid.clearDynamic();
    grid.queryRadius(0, 0, 10, results);
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'tree1', 'Static tree must remain after clearDynamic');
});

test('SpatialGrid: zero-allocation query reuse', () => {
    const grid = new SpatialGrid(600, 15);
    grid.insertDynamic('e1', 10, 10, 2, {});
    grid.insertDynamic('e2', 12, 12, 2, {});
    
    const buffer = [];
    const res1 = grid.queryRadius(11, 11, 5, buffer);
    assert.equal(res1, buffer, 'Must return the same buffer instance');
    assert.equal(buffer.length, 2);
    
    const res2 = grid.queryRadius(200, 200, 5, buffer);
    assert.equal(res2, buffer);
    assert.equal(buffer.length, 0, 'Buffer must be cleared for subsequent queries');
});

test('SpatialGrid: high-performance stress benchmark (1,000 statics, 100 dynamics, 10,000 queries)', () => {
    const grid = new SpatialGrid(600, 15);
    
    // 1,000 static obstacles
    for (let i = 0; i < 1000; i++) {
        const x = (Math.random() - 0.5) * 500;
        const z = (Math.random() - 0.5) * 500;
        grid.insertStatic(`static_${i}`, {
            min: { x: x - 1, y: 0, z: z - 1 },
            max: { x: x + 1, y: 3, z: z + 1 }
        });
    }
    
    // 100 dynamic entities
    for (let i = 0; i < 100; i++) {
        const x = (Math.random() - 0.5) * 500;
        const z = (Math.random() - 0.5) * 500;
        grid.insertDynamic(`dyn_${i}`, x, z, 2.5, { id: i });
    }
    
    const queryBuffer = [];
    const t0 = performance.now();
    for (let q = 0; q < 10000; q++) {
        const qx = (Math.random() - 0.5) * 500;
        const qz = (Math.random() - 0.5) * 500;
        grid.queryRadius(qx, qz, 15, queryBuffer);
    }
    const t1 = performance.now();
    const durationMs = t1 - t0;
    
    console.log(`10,000 spatial queries completed in ${durationMs.toFixed(2)}ms (${(durationMs / 10000 * 1000).toFixed(2)}µs per query)`);
    assert.ok(durationMs < 100, `10,000 queries should take < 100ms, actual: ${durationMs.toFixed(2)}ms`);
});
