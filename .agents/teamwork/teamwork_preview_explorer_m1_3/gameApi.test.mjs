import test from 'node:test';
import assert from 'node:assert/strict';

test('window.__GAME__ contract: structure and validation', async () => {
    // Simulated game state
    let simTime = 0;
    let playerPos = { x: 0, y: 0, z: 0 };
    let playerState = 'ON_FOOT';
    let currentVehicle = null;
    let inputs = { w: false, a: false, s: false, d: false, space: false };
    
    const mockGame = {
        isReady: true,
        player: {
            getState: () => playerState,
            getPosition: () => ({ ...playerPos }),
            getVehicle: () => currentVehicle
        },
        vehicles: {
            getPlayerVehicle: () => currentVehicle,
            getTrafficVehicles: () => [],
            getTrafficCount: () => 0
        },
        actions: {
            tryEnterVehicle: () => {
                if (currentVehicle) {
                    playerState = 'IN_VEHICLE';
                    return true;
                }
                return false;
            },
            tryExitVehicle: () => {
                if (playerState === 'IN_VEHICLE') {
                    playerState = 'ON_FOOT';
                    return true;
                }
                return false;
            },
            setVehicleInput: (newInputs) => {
                inputs = { ...inputs, ...newInputs };
            },
            setPlayerInput: (keys) => {
                inputs = { ...inputs, ...keys };
            }
        },
        simulation: {
            step: (dt) => {
                simTime += dt;
                if (inputs.w) playerPos.z -= 5 * dt;
                if (inputs.s) playerPos.z += 5 * dt;
            },
            runBenchmark: async (frameCount) => {
                const times = new Float32Array(frameCount);
                let total = 0;
                let max = 0;
                for (let i = 0; i < frameCount; i++) {
                    const t0 = performance.now();
                    mockGame.simulation.step(1 / 60);
                    const dt = performance.now() - t0;
                    times[i] = dt;
                    total += dt;
                    if (dt > max) max = dt;
                }
                times.sort();
                const p95 = times[Math.floor(frameCount * 0.95)];
                const avg = total / frameCount;
                return {
                    avgFrameTimeMs: avg,
                    maxFrameTimeMs: max,
                    p95FrameTimeMs: p95,
                    memoryGrowthBytes: 0,
                    fps: avg > 0 ? 1000 / avg : 60
                };
            }
        }
    };

    // Assert contract conformity
    assert.equal(mockGame.isReady, true);
    assert.equal(mockGame.player.getState(), 'ON_FOOT');
    assert.deepEqual(mockGame.player.getPosition(), { x: 0, y: 0, z: 0 });
    assert.equal(mockGame.vehicles.getTrafficCount(), 0);
    
    // Simulate step input
    mockGame.actions.setPlayerInput({ w: true });
    mockGame.simulation.step(1.0);
    assert.equal(mockGame.player.getPosition().z, -5);
    
    // Run benchmark
    const bench = await mockGame.simulation.runBenchmark(100);
    assert.ok(bench.avgFrameTimeMs >= 0);
    assert.ok(bench.fps > 0);
    assert.ok(bench.p95FrameTimeMs >= 0);
});
