import test from 'node:test';
import assert from 'node:assert/strict';
import { initGameAPI, CONFIG, SpatialGrid } from '../../js/game/main.js';

test('Simulation API: erratic dt handling and step forwarding', () => {
    global.window = {};
    global.performance = {
        now: () => Date.now(),
        memory: { usedJSHeapSize: 10 * 1024 * 1024 }
    };

    const recordedDts = [];
    const api = initGameAPI({
        scene: {},
        camera: {},
        renderer: {},
        playerPosition: { x: 0, y: 1.7, z: 0 },
        playerKeys: { w: false, a: false, s: false, d: false },
        stepSimulation: (dt) => {
            recordedDts.push(dt);
        },
        renderFrame: () => {}
    });

    // Test erratic dt values
    api.simulation.step(0);
    api.simulation.step(0.0001);
    api.simulation.step(0.5);
    api.simulation.step(5.0);
    api.simulation.step(undefined);

    assert.equal(recordedDts.length, 5);
    assert.equal(recordedDts[0], 0);
    assert.equal(recordedDts[1], 0.0001);
    assert.equal(recordedDts[2], 0.5);
    assert.equal(recordedDts[3], 5.0);
    assert.equal(recordedDts[4], CONFIG.SIMULATION.FIXED_DELTA);
});

test('Simulation API: pause state toggling', () => {
    global.window = {};
    const api = initGameAPI({
        scene: {}, camera: {}, renderer: {},
        playerPosition: { x: 0, y: 1.7, z: 0 },
        playerKeys: {},
        stepSimulation: () => {},
        renderFrame: () => {}
    });

    assert.equal(api.simulation.isPaused(), false);
    api.simulation.setPaused(true);
    assert.equal(api.simulation.isPaused(), true);
    api.simulation.setPaused(false);
    assert.equal(api.simulation.isPaused(), false);
});

test('Simulation API: consecutive 1,000-frame benchmarks (3,000 frames total)', async () => {
    let simulatedHeap = 10 * 1024 * 1024;
    const nativeNow = Date.now;
    global.window = {};
    global.performance = {
        now: () => nativeNow(),
        memory: {
            get usedJSHeapSize() {
                return simulatedHeap;
            }
        }
    };

    let totalSteps = 0;
    const api = initGameAPI({
        scene: {}, camera: {}, renderer: {},
        playerPosition: { x: 0, y: 1.7, z: 0 },
        playerKeys: {},
        stepSimulation: () => {
            totalSteps++;
        },
        renderFrame: () => {}
    });

    const bench1 = await api.simulation.runBenchmark(1000);
    const bench2 = await api.simulation.runBenchmark(1000);
    const bench3 = await api.simulation.runBenchmark(1000);

    // Warm-up is 10 frames per run, so totalSteps = 3 * (1000 + 10) = 3030
    assert.equal(totalSteps, 3030);

    assert.equal(bench1.frames, 1000);
    assert.equal(bench2.frames, 1000);
    assert.equal(bench3.frames, 1000);

    assert.ok(bench1.avgFrameTimeMs >= 0);
    assert.ok(bench2.avgFrameTimeMs >= 0);
    assert.ok(bench3.avgFrameTimeMs >= 0);

    assert.equal(bench1.memoryGrowthBytes, 0);
    assert.equal(bench2.memoryGrowthBytes, 0);
    assert.equal(bench3.memoryGrowthBytes, 0);
});
