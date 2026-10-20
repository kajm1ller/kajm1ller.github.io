import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialGrid } from '../../js/game/spatialGrid.js';
import { CONFIG } from '../../js/game/config.js';

test('SpatialGrid initialization dimensions and cell counts', () => {
    const grid = new SpatialGrid(CONFIG.GRID.WORLD_HALF_SIZE, CONFIG.GRID.CELL_SIZE);
    assert.equal(grid.cols, 40);
    assert.equal(grid.rows, 40);
    assert.equal(grid.totalCells, 1600);
    assert.equal(grid.cells.length, 1600);

    // Verify cell 0 extents
    const cell0 = grid.cells[0];
    assert.equal(cell0.col, 0);
    assert.equal(cell0.row, 0);
    assert.equal(cell0.minX, -300);
    assert.equal(cell0.maxX, -285);
    assert.equal(cell0.minZ, -300);
    assert.equal(cell0.maxZ, -285);
});

test('SpatialGrid coordinate clamping beyond world extents', () => {
    const grid = new SpatialGrid(300, 15);
    assert.equal(grid._getCol(-1000), 0);
    assert.equal(grid._getCol(1000), 39);
    assert.equal(grid._getRow(-500), 0);
    assert.equal(grid._getRow(500), 39);
    assert.equal(grid._getCol(0), 20);
    assert.equal(grid._getRow(0), 20);
});

test('SpatialGrid static insertion and single deduplication', () => {
    const grid = new SpatialGrid(300, 15);
    const box = {
        min: { x: -5, y: 0, z: -5 },
        max: { x: 5, y: 3, z: 5 }
    };
    grid.insertStatic('center_tree', box, { height: 3 });

    const scratch = [];
    grid.queryRadius(0, 0, 15, scratch);

    // Spans across cell borders at (0, 0), but should only appear ONCE in scratch
    assert.equal(scratch.length, 1);
    assert.equal(scratch[0].id, 'center_tree');
    assert.equal(scratch[0].isStatic, true);
    assert.equal(scratch[0].userData.height, 3);
});

test('SpatialGrid dynamic insertion, pooling, and query', () => {
    const grid = new SpatialGrid(300, 15);
    const mockVehicle = { id: 'veh_1', x: 10, z: 10, radius: 2.25 };

    const entry1 = grid.insertDynamic(mockVehicle.id, mockVehicle.x, mockVehicle.z, mockVehicle.radius, mockVehicle);
    assert.equal(entry1.id, 'veh_1');
    assert.equal(entry1.isStatic, false);

    const scratch = [];
    grid.queryRadius(10, 10, 5, scratch);
    assert.equal(scratch.length, 1);
    assert.equal(scratch[0].id, 'veh_1');

    // Move vehicle and re-insert: must reuse existing entry object without new allocation
    grid.clearDynamic();
    mockVehicle.x = 25;
    mockVehicle.z = 25;
    const entry2 = grid.insertDynamic(mockVehicle.id, mockVehicle.x, mockVehicle.z, mockVehicle.radius, mockVehicle);
    assert.equal(entry1, entry2, 'Dynamic entry should be pooled and reused');

    // Previous location should now be empty
    grid.queryRadius(10, 10, 5, scratch);
    assert.equal(scratch.length, 0);

    // New location should find it
    grid.queryRadius(25, 25, 5, scratch);
    assert.equal(scratch.length, 1);
    assert.equal(scratch[0].id, 'veh_1');
});

test('SpatialGrid clearDynamic leaves static items untouched', () => {
    const grid = new SpatialGrid(300, 15);
    grid.insertStatic('rock_1', { min: { x: 50, y: 0, z: 50 }, max: { x: 52, y: 2, z: 52 } });
    grid.insertDynamic('player', 50, 50, 0.4, {});

    const scratch = [];
    grid.queryRadius(50, 50, 10, scratch);
    assert.equal(scratch.length, 2);

    grid.clearDynamic();

    grid.queryRadius(50, 50, 10, scratch);
    assert.equal(scratch.length, 1);
    assert.equal(scratch[0].id, 'rock_1');
});

test('SpatialGrid filter modes ALL, STATIC, DYNAMIC', () => {
    const grid = new SpatialGrid(300, 15);
    grid.insertStatic('rock', { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 2, z: 2 } });
    grid.insertDynamic('car', 1, 1, 2, {});

    const scratch = [];
    grid.queryRadius(1, 1, 5, scratch, 'ALL');
    assert.equal(scratch.length, 2);

    grid.queryRadius(1, 1, 5, scratch, 'STATIC');
    assert.equal(scratch.length, 1);
    assert.equal(scratch[0].id, 'rock');

    grid.queryRadius(1, 1, 5, scratch, 'DYNAMIC');
    assert.equal(scratch.length, 1);
    assert.equal(scratch[0].id, 'car');
});

test('SpatialGrid queryBox accurately bounds candidate shapes', () => {
    const grid = new SpatialGrid(300, 15);
    grid.insertStatic('near_box', { min: { x: 5, y: 0, z: 5 }, max: { x: 10, y: 2, z: 10 } });
    grid.insertStatic('far_box', { min: { x: 100, y: 0, z: 100 }, max: { x: 110, y: 2, z: 110 } });

    const scratch = [];
    grid.queryBox({ min: { x: 0, z: 0 }, max: { x: 20, z: 20 } }, scratch);
    assert.equal(scratch.length, 1);
    assert.equal(scratch[0].id, 'near_box');
});

test('SpatialGrid 1,000-frame stress benchmark (150 static + 50 dynamic entities)', () => {
    const grid = new SpatialGrid(300, 15);
    // Populate 150 static obstacles
    for (let i = 0; i < 150; i++) {
        const x = ((i * 17) % 500) - 250;
        const z = ((i * 31) % 500) - 250;
        grid.insertStatic(`obs_${i}`, { min: { x: x - 1, y: 0, z: z - 1 }, max: { x: x + 1, y: 3, z: z + 1 } });
    }

    // Populate 50 vehicles
    const vehicles = [];
    for (let i = 0; i < 50; i++) {
        vehicles.push({
            id: `v_${i}`,
            x: ((i * 23) % 400) - 200,
            z: ((i * 37) % 400) - 200,
            radius: 2.25,
            scratch: []
        });
    }

    const FRAMES = 1000;
    const t0 = performance.now();

    for (let f = 0; f < FRAMES; f++) {
        grid.clearDynamic();
        for (let i = 0; i < 50; i++) {
            const v = vehicles[i];
            v.x += 0.05;
            v.z += 0.05;
            grid.insertDynamic(v.id, v.x, v.z, v.radius, v);
        }
        for (let i = 0; i < 50; i++) {
            const v = vehicles[i];
            grid.queryRadius(v.x, v.z, 15, v.scratch);
        }
    }

    const elapsedMs = performance.now() - t0;
    const avgPerFrame = elapsedMs / FRAMES;

    assert.ok(avgPerFrame < 1.0, `SpatialGrid 50-entity frame time too high: ${avgPerFrame.toFixed(4)}ms (limit: 1.0ms)`);
});
