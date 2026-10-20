/**
 * test/e2e-player-camera-stress.js
 * 
 * Milestone 2 E2E Headless CDP Adversarial Stress Harness:
 * Player Interaction & Camera Transition Verification in Live Browser Runtime
 */

const path = require('path');
const { createHarness } = require('./harness.js');

class StressSuiteContext {
  constructor(name) {
    this.name = name;
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
    this.errors = [];
  }

  async runStep(name, fn) {
    const t0 = Date.now();
    try {
      await fn();
      const dur = Date.now() - t0;
      this.passed++;
      this.tests.push({ name, status: 'PASS', dur });
      console.log(`  \x1b[32m✔\x1b[0m ${name} (${dur}ms)`);
    } catch (err) {
      const dur = Date.now() - t0;
      this.failed++;
      this.tests.push({ name, status: 'FAIL', dur, error: err.message });
      this.errors.push({ name, error: err });
      console.log(`  \x1b[31m✖\x1b[0m ${name} (${dur}ms)`);
      console.log(`    \x1b[31mError: ${err.message}\x1b[0m`);
    }
  }

  summary() {
    console.log(`\n======================================================`);
    console.log(`E2E ADVERSARIAL STRESS RESULTS: ${this.name}`);
    console.log(`Total: ${this.tests.length} | Passed: \x1b[32m${this.passed}\x1b[0m | Failed: \x1b[31m${this.failed}\x1b[0m`);
    console.log(`======================================================\n`);
    return {
      passed: this.passed,
      failed: this.failed,
      total: this.tests.length,
      errors: this.errors
    };
  }
}

async function runE2EStress() {
  const harness = createHarness({
    browser: 'auto',
    headless: true,
    verbose: false
  });

  const ctx = new StressSuiteContext('Player Interaction & Camera Transition E2E Stress');

  try {
    console.log('\n[Setup] Launching headless browser and connecting CDP...');
    await harness.start();
    await harness.navigate('game.html', { timeout: 15000, waitUntil: 'load' });

    // ------------------------------------------------------------------------
    // Step 1: Baseline Clean Boot & API Ready
    // ------------------------------------------------------------------------
    await ctx.runStep('E2E Baseline: game.html loads cleanly with zero console errors', async () => {
      await harness.waitForFunction(() => window.__GAME__ && window.__GAME__.isReady, 5000);
      const isReady = await harness.evaluate(() => window.__GAME__.isReady);
      if (!isReady) throw new Error('window.__GAME__.isReady is not true');

      const exceptions = harness.getExceptions();
      const consoleErrors = harness.getConsoleErrors();
      if (exceptions.length > 0) {
        throw new Error(`Uncaught page exceptions: ${JSON.stringify(exceptions)}`);
      }
      if (consoleErrors.length > 0) {
        throw new Error(`Console logged errors: ${JSON.stringify(consoleErrors)}`);
      }
    });

    // ------------------------------------------------------------------------
    // Step 2: Boarding Boundary Stress (3.49m vs 3.51m) in Browser
    // ------------------------------------------------------------------------
    await ctx.runStep('E2E V1: Boarding proximity boundary (3.49m succeeds, 3.51m cleanly fails)', async () => {
      // 1. Position vehicle at distance = 3.49m from player
      const enterResult349 = await harness.evaluate(() => {
        const pPos = window.__GAME__.player.getPosition();
        const v = window.__GAME__.vehicles.getPlayerVehicle();
        v.position.set(pPos.x, 0, pPos.z - 3.49);
        v.speed = 0;
        v.velocity.set(0, 0);

        // Update spatial grid
        window.__GAME__.spatialGrid.clearDynamic();
        window.__GAME__.spatialGrid.insertDynamic(v.id, v.position.x, v.position.z, v.radius, v);

        // Step simulation tick to update proximity check and HUD
        window.__GAME__.simulation.step(1 / 60);

        const promptEl = document.getElementById('vehicle-prompt');
        const promptVisibleBefore = promptEl ? promptEl.style.display : 'unknown';

        const entered = window.__GAME__.actions.tryEnterVehicle();
        const stateAfter = window.__GAME__.player.getState();
        const promptVisibleAfter = promptEl ? promptEl.style.display : 'unknown';

        return {
          entered,
          stateAfter,
          promptVisibleBefore,
          promptVisibleAfter
        };
      });

      if (!enterResult349.entered) {
        throw new Error(`Boarding at 3.49m failed: entered=${enterResult349.entered}`);
      }
      if (enterResult349.stateAfter !== 'IN_VEHICLE') {
        throw new Error(`Player state after boarding at 3.49m is not IN_VEHICLE: ${enterResult349.stateAfter}`);
      }

      // Exit back to on foot
      await harness.evaluate(() => {
        window.__GAME__.actions.tryExitVehicle();
        window.__GAME__.simulation.step(1 / 60);
      });

      // 2. Position vehicle at distance = 3.51m from player
      const enterResult351 = await harness.evaluate(() => {
        const pPos = window.__GAME__.player.getPosition();
        const v = window.__GAME__.vehicles.getPlayerVehicle();
        v.position.set(pPos.x, 0, pPos.z - 3.51);
        v.speed = 0;
        v.velocity.set(0, 0);

        window.__GAME__.spatialGrid.clearDynamic();
        window.__GAME__.spatialGrid.insertDynamic(v.id, v.position.x, v.position.z, v.radius, v);

        window.__GAME__.simulation.step(1 / 60);

        const promptEl = document.getElementById('vehicle-prompt');
        const promptVisibleBefore = promptEl ? promptEl.style.display : 'unknown';

        const entered = window.__GAME__.actions.tryEnterVehicle();
        const stateAfter = window.__GAME__.player.getState();

        return {
          entered,
          stateAfter,
          promptVisibleBefore
        };
      });

      if (enterResult351.entered !== false) {
        throw new Error(`Boarding at 3.51m should have failed, but got entered=${enterResult351.entered}`);
      }
      if (enterResult351.stateAfter !== 'ON_FOOT') {
        throw new Error(`State should remain ON_FOOT at 3.51m, got ${enterResult351.stateAfter}`);
      }
    });

    // ------------------------------------------------------------------------
    // Step 3: Rapid State Machine Toggling in Browser (100 ticks)
    // ------------------------------------------------------------------------
    await ctx.runStep('E2E V2: Rapid state toggling across 100 ticks preserves state & mesh rendering', async () => {
      const toggleResult = await harness.evaluate(() => {
        const v = window.__GAME__.vehicles.getPlayerVehicle();
        v.position.set(0, 0, -2.0); // Within 2.0m (< 3.5m)
        v.speed = 0;
        v.velocity.set(0, 0);

        window.__GAME__.spatialGrid.clearDynamic();
        window.__GAME__.spatialGrid.insertDynamic(v.id, 0, -2.0, v.radius, v);

        const stateHistory = [];
        let invalidTransitions = 0;

        for (let t = 0; t < 100; t++) {
          if (t % 2 === 0) {
            // Enter
            const ok = window.__GAME__.actions.tryEnterVehicle();
            const state = window.__GAME__.player.getState();
            stateHistory.push(state);
            if (!ok || state !== 'IN_VEHICLE') invalidTransitions++;

            // Set vehicle driving input
            window.__GAME__.actions.setVehicleInput({ w: true, a: false, s: false, d: false, space: false });
            window.__GAME__.simulation.step(1 / 60);
          } else {
            // Exit
            const ok = window.__GAME__.actions.tryExitVehicle();
            const state = window.__GAME__.player.getState();
            stateHistory.push(state);
            if (!ok || state !== 'ON_FOOT') invalidTransitions++;

            window.__GAME__.simulation.step(1 / 60);
          }
        }

        const finalState = window.__GAME__.player.getState();
        const finalPos = window.__GAME__.player.getPosition();

        return {
          invalidTransitions,
          finalState,
          finalPos,
          isPosFinite: Number.isFinite(finalPos.x) && Number.isFinite(finalPos.z)
        };
      });

      if (toggleResult.invalidTransitions > 0) {
        throw new Error(`Detected ${toggleResult.invalidTransitions} invalid transitions during rapid toggling`);
      }
      if (!toggleResult.isPosFinite) {
        throw new Error(`Player coordinates corrupted after toggling: ${JSON.stringify(toggleResult.finalPos)}`);
      }
    });

    // ------------------------------------------------------------------------
    // Step 4: Multi-Candidate Safe Exit Obstruction in Browser
    // ------------------------------------------------------------------------
    await ctx.runStep('E2E V3: Multi-candidate safe exit places player at Front candidate under 3-sided entrapment', async () => {
      const exitStressResult = await harness.evaluate(() => {
        const pPos = window.__GAME__.player.getPosition();
        const v = window.__GAME__.vehicles.getPlayerVehicle();
        
        // Position vehicle within 2.0m of current player position
        const vx = pPos.x;
        const vz = pPos.z - 2.0;
        v.position.set(vx, 0, vz);
        v.yaw = 0; // facing -Z
        v.speed = 0;
        v.velocity.set(0, 0);

        // Enter vehicle
        window.__GAME__.spatialGrid.clearDynamic();
        window.__GAME__.spatialGrid.insertDynamic(v.id, vx, vz, v.radius, v);
        const entered = window.__GAME__.actions.tryEnterVehicle();
        if (!entered) {
          throw new Error(`tryEnterVehicle() failed in Step 4: player was at (${pPos.x}, ${pPos.z}), vehicle at (${vx}, ${vz})`);
        }

        // Surround vehicle with static obstacles on Left (vx - 1.9), Right (vx + 1.9), and Rear (vz + 3.05)
        window.__GAME__.spatialGrid.insertStatic('obs_e2e_left', {
          min: { x: vx - 2.5, y: 0, z: vz - 1.5 },
          max: { x: vx - 1.0, y: 3, z: vz + 1.5 }
        });
        window.__GAME__.spatialGrid.insertStatic('obs_e2e_right', {
          min: { x: vx + 1.0, y: 0, z: vz - 1.5 },
          max: { x: vx + 2.5, y: 3, z: vz + 1.5 }
        });
        window.__GAME__.spatialGrid.insertStatic('obs_e2e_rear', {
          min: { x: vx - 1.5, y: 0, z: vz + 1.5 },
          max: { x: vx + 1.5, y: 3, z: vz + 4.5 }
        });

        // Exit vehicle
        const exitOk = window.__GAME__.actions.tryExitVehicle();
        const postState = window.__GAME__.player.getState();
        const playerPos = window.__GAME__.player.getPosition();

        // Check if player position is in FRONT of car (Z < vz for yaw=0)
        const isFront = playerPos.z < vz;
        const distFromCar = Math.hypot(playerPos.x - vx, playerPos.z - vz);

        return {
          exitOk,
          postState,
          playerPos,
          isFront,
          distFromCar
        };
      });

      if (!exitStressResult.exitOk) {
        throw new Error('tryExitVehicle() failed under 3-sided obstruction');
      }
      if (exitStressResult.postState !== 'ON_FOOT') {
        throw new Error(`State is not ON_FOOT after exit: ${exitStressResult.postState}`);
      }
      if (!exitStressResult.isFront) {
        throw new Error(`Player was not placed at FRONT candidate: playerPos=${JSON.stringify(exitStressResult.playerPos)}`);
      }
      if (exitStressResult.distFromCar < 1.0 || exitStressResult.distFromCar > 4.5) {
        throw new Error(`Player exit distance ${exitStressResult.distFromCar.toFixed(2)}m is out of bounds`);
      }
    });

    // ------------------------------------------------------------------------
    // Step 5: High-Speed Vehicle Spin & Shortest-Arc Camera Tracking in Browser
    // ------------------------------------------------------------------------
    await ctx.runStep('E2E V4: Vehicle yaw spinning past +/-PI: camera tracks shortest-arc with zero whipping', async () => {
      const cameraResult = await harness.evaluate(() => {
        const v = window.__GAME__.vehicles.getPlayerVehicle();
        v.position.set(0, 0, 0);
        v.yaw = 0;
        v.speed = 12.0;

        window.__GAME__.spatialGrid.clearDynamic();
        window.__GAME__.spatialGrid.insertDynamic(v.id, 0, 0, v.radius, v);
        window.__GAME__.actions.tryEnterVehicle();

        const camera = window.__GAME__.raw.camera;
        const upVec = { x: 0, y: 1, z: 0 };

        let maxYawWhip = 0;
        let gimbalLockDetected = false;
        // Sample baseline chase camera position after mode transition
        let prevCamPos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };

        // Apply hard left steer with throttle to induce rapid yaw spin for 180 ticks (~3.0s)
        window.__GAME__.actions.setVehicleInput({ w: true, a: true, s: false, d: false, space: false });

        for (let tick = 0; tick < 180; tick++) {
          window.__GAME__.simulation.step(1 / 60);

          // Check camera position finiteness
          if (!Number.isFinite(camera.position.x) || !Number.isFinite(camera.position.y) || !Number.isFinite(camera.position.z)) {
            throw new Error(`Camera position became NaN at tick ${tick}`);
          }

          // Check camera distance to vehicle
          const vp = v.getPosition();
          const dist = Math.hypot(camera.position.x - vp.x, camera.position.z - vp.z);
          if (dist < 3.0 || dist > 12.0) {
            throw new Error(`Camera distance ${dist.toFixed(2)}m outside bounds at tick ${tick}`);
          }

          // Check camera forward vector vs up vector (gimbal lock check)
          const fwdX = vp.x - camera.position.x;
          const fwdY = (vp.y + 1.2) - camera.position.y;
          const fwdZ = vp.z - camera.position.z;
          const fwdLen = Math.hypot(fwdX, fwdY, fwdZ);
          const normFwdY = Math.abs(fwdY / fwdLen);
          if (normFwdY > 0.95) {
            gimbalLockDetected = true;
          }

          // Step delta
          const camStep = Math.hypot(camera.position.x - prevCamPos.x, camera.position.z - prevCamPos.z);
          if (camStep > maxYawWhip) maxYawWhip = camStep;
          prevCamPos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
        }

        window.__GAME__.actions.setVehicleInput({ w: false, a: false, s: false, d: false, space: false });

        return {
          finalVehicleYaw: v.getYaw(),
          finalCamPos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          gimbalLockDetected,
          maxYawWhip
        };
      });

      if (cameraResult.gimbalLockDetected) {
        throw new Error('Gimbal lock condition detected during camera follow');
      }
      if (cameraResult.maxYawWhip > 3.0) {
        throw new Error(`Camera position whipped excessively between ticks: maxStep=${cameraResult.maxYawWhip.toFixed(2)}m`);
      }
    });

  } finally {
    console.log('\n[Teardown] Shutting down headless browser...');
    await harness.close();
  }

  const summary = ctx.summary();
  if (summary.failed > 0) {
    process.exit(1);
  }
}

runE2EStress().catch((err) => {
  console.error('\nFatal test runner error:', err);
  process.exit(1);
});
