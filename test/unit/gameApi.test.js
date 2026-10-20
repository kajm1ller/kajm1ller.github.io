import test from 'node:test';
import assert from 'node:assert/strict';
import { initGameAPI, spatialGrid, CONFIG } from '../../js/game/main.js';

test('window.__GAME__ API conformance', async () => {
    // Setup mock global window
    global.window = {};
    global.performance = {
        now: () => Date.now(),
        memory: { usedJSHeapSize: 1024 * 1024 }
    };

    let stepped = 0;
    const playerPos = { x: 12.5, y: 1.7, z: -45.0 };
    const playerKeys = { w: false, a: false, s: false, d: false };

    const api = initGameAPI({
        scene: {},
        camera: {},
        renderer: {},
        playerPosition: playerPos,
        playerKeys,
        stepSimulation: (dt) => { stepped++; },
        renderFrame: () => {}
    });

    assert.equal(global.window.__GAME__, api);
    assert.equal(global.window.__gameTestHooks, api);
    assert.equal(api.isReady, true);
    assert.equal(api.hasVehicles, false);

    // Audio & Radio API
    assert.equal(typeof api.audio.getBackgroundMusic, 'function');
    assert.equal(typeof api.audio.getRadio, 'function');
    assert.equal(typeof api.radio.getState, 'function');
    assert.equal(typeof api.radio.skip, 'function');
    assert.equal(typeof api.radio.restart, 'function');
    assert.equal(typeof api.radio.togglePause, 'function');
    assert.equal(typeof api.radio.setVolume, 'function');

    // Player API
    assert.equal(api.player.getState(), 'ON_FOOT');
    const pos = api.player.getPosition();
    assert.equal(pos.x, 12.5);
    assert.equal(pos.y, 1.7);
    assert.equal(pos.z, -45.0);
    assert.equal(api.player.getVehicle(), null);

    // Vehicle API
    assert.equal(api.vehicles.getPlayerVehicle(), null);
    assert.deepEqual(api.vehicles.getTrafficVehicles(), []);
    assert.equal(api.vehicles.getTrafficCount(), 0);
    assert.equal(typeof api.vehicles.getNearbyVehicle, 'function');
    assert.equal(typeof api.vehicles.getNearestVehicle, 'function');
    assert.equal(api.vehicles.getNearbyVehicle(), null);
    assert.equal(api.vehicles.getNearestVehicle(), null);

    // Actions API
    assert.equal(api.actions.tryEnterVehicle(), false);
    assert.equal(api.actions.tryExitVehicle(), false);
    api.actions.setPlayerInput({ w: true, a: true });
    assert.equal(playerKeys.w, true);
    assert.equal(playerKeys.a, true);

    // Simulation API
    api.simulation.step(1 / 60);
    assert.equal(stepped, 1);

    // Benchmark API
    const bench = await api.simulation.runBenchmark(20);
    assert.equal(bench.frames, 20);
    assert.ok(bench.avgFrameTimeMs >= 0);
    assert.ok(typeof bench.memoryGrowthBytes === 'number');

    // Spatial Grid reference
    assert.equal(api.spatialGrid, spatialGrid);
});
