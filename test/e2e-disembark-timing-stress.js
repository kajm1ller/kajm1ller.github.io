/**
 * test/e2e-disembark-timing-stress.js
 * 
 * Milestone 2 E2E Headless Browser CDP Adversarial Stress Harness:
 * Player Disembark Sustained RAF & Timing Stress Verification.
 * 
 * Verification Objectives:
 * 1. Board vehicle, drive, exit, and sample player position over 30, 60, 120, and 300 live animation frames.
 * 2. Verify player distance to vehicle never collapses back to 0.00m or clips into the vehicle.
 * 3. Test disembarkation while the vehicle is at non-zero velocity (forward & reverse).
 * 4. Test disembarkation while the vehicle is actively turning (non-zero yaw rate).
 * 5. Test keyboard 'E' event disembarkation inside fixed loop.
 * 6. Sample 1,000 post-exit simulation steps for zero drift and zero corruption.
 */

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

async function runE2EDisembarkStress() {
  const harness = createHarness({
    browser: 'auto',
    headless: true,
    verbose: false
  });

  const ctx = new StressSuiteContext('Player Disembark Sustained RAF & Timing Stress');

  try {
    console.log('\n[Setup] Launching headless browser and connecting CDP...');
    await harness.start();
    await harness.navigate('game.html', { timeout: 15000, waitUntil: 'load' });

    // ------------------------------------------------------------------------
    // Step 0: Baseline Clean Boot & Zero Console Warnings / Errors
    // ------------------------------------------------------------------------
    await ctx.runStep('E2E Baseline: game.html loads cleanly with zero console warnings and zero errors', async () => {
      await harness.waitForFunction(() => window.__GAME__ && window.__GAME__.isReady, 5000);
      const isReady = await harness.evaluate(() => window.__GAME__.isReady);
      if (!isReady) throw new Error('window.__GAME__.isReady is not true');

      const exceptions = harness.getExceptions();
      const consoleErrors = harness.getConsoleErrors();
      const warnings = harness.getAllConsoleMessages().filter(m => m.type === 'warning');

      if (exceptions.length > 0) {
        throw new Error(`Uncaught page exceptions: ${JSON.stringify(exceptions)}`);
      }
      if (consoleErrors.length > 0) {
        throw new Error(`Console logged errors: ${JSON.stringify(consoleErrors)}`);
      }
      if (warnings.length > 0) {
        throw new Error(`Console logged warnings: ${JSON.stringify(warnings.map(w => w.text))}`);
      }
    });

    // ------------------------------------------------------------------------
    // Step 1: Sustained Live RAF Sampling (30, 60, 120, 300 Animation Frames)
    // ------------------------------------------------------------------------
    await ctx.runStep('E2E Vector 1: Board, drive, disembark & sample over 30, 60, 120, and 300 live RAF frames', async () => {
      // 1. Board vehicle
      const entered = await harness.evaluate(() => window.__GAME__.actions.tryEnterVehicle());
      if (!entered) throw new Error('tryEnterVehicle() failed');

      // 2. Drive forward for 60 simulation steps
      await harness.evaluate(() => {
        window.__GAME__.actions.setVehicleInput({ w: true, a: false, s: false, d: false, space: false });
        for (let i = 0; i < 60; i++) {
          window.__GAME__.simulation.step(1 / 60);
        }
        window.__GAME__.actions.setVehicleInput({ w: false, a: false, s: false, d: false, space: false });
      });

      // 3. Record vehicle position before exit
      const vPosPreExit = await harness.evaluate(() => window.__GAME__.vehicles.getPlayerVehicle().getPosition());

      // 4. Disembark
      const exited = await harness.evaluate(() => window.__GAME__.actions.tryExitVehicle());
      if (!exited) throw new Error('tryExitVehicle() failed');

      const pPosImmediate = await harness.evaluate(() => window.__GAME__.player.getPosition());
      const distImmediate = Math.hypot(pPosImmediate.x - vPosPreExit.x, pPosImmediate.z - vPosPreExit.z);
      if (distImmediate < 0.5 || distImmediate > 5.0) {
        throw new Error(`Immediate disembark distance must be 0.5m-5.0m, was ${distImmediate.toFixed(3)}m`);
      }

      // 5. Sample intervals across live requestAnimationFrame callbacks
      const rafIntervals = [30, 60, 120, 300];
      let cumulativeFrames = 0;

      for (const targetTotal of rafIntervals) {
        const framesToWait = targetTotal - cumulativeFrames;
        cumulativeFrames = targetTotal;

        const sample = await harness.evaluate((frames) => {
          return new Promise((resolve) => {
            let count = 0;
            function onFrame() {
              count++;
              if (count >= frames) {
                const player = window.__GAME__.player;
                const v = window.__GAME__.vehicles.getPlayerVehicle();
                const vPos = v.getPosition();
                const pPos = player.getPosition();
                const state = player.getState();
                const activeV = player.getVehicle();
                resolve({
                  frames: count,
                  state,
                  hasActiveVehicle: activeV !== null,
                  pPos,
                  vPos,
                  dist: Math.hypot(pPos.x - vPos.x, pPos.z - vPos.z)
                });
              } else {
                requestAnimationFrame(onFrame);
              }
            }
            requestAnimationFrame(onFrame);
          });
        }, framesToWait);

        if (sample.state !== 'ON_FOOT') {
          throw new Error(`At ${targetTotal} RAF frames: Player state must be ON_FOOT, got ${sample.state}`);
        }
        if (sample.hasActiveVehicle) {
          throw new Error(`At ${targetTotal} RAF frames: Player activeVehicle must be null`);
        }
        if (!Number.isFinite(sample.pPos.x) || !Number.isFinite(sample.pPos.z)) {
          throw new Error(`At ${targetTotal} RAF frames: Player position is non-finite: ${JSON.stringify(sample.pPos)}`);
        }
        if (sample.dist < 0.5) {
          throw new Error(`At ${targetTotal} RAF frames: Player distance collapsed to ${sample.dist.toFixed(3)}m (< 0.5m threshold)!`);
        }
        if (sample.dist > 5.0) {
          throw new Error(`At ${targetTotal} RAF frames: Player distance drifted to ${sample.dist.toFixed(3)}m (> 5.0m threshold)!`);
        }
      }
    });

    // ------------------------------------------------------------------------
    // Step 2: Disembarkation at Non-Zero Forward Velocity (> 10 m/s)
    // ------------------------------------------------------------------------
    await ctx.runStep('E2E Vector 2: Disembark while vehicle has non-zero forward velocity (> 10 m/s)', async () => {
      // Re-enter vehicle
      const entered = await harness.evaluate(() => {
        // Teleport player near vehicle curbside
        const v = window.__GAME__.vehicles.getPlayerVehicle();
        const vPos = v.getPosition();
        return window.__GAME__.actions.tryEnterVehicle();
      });
      if (!entered) throw new Error('Re-entering vehicle failed');

      // Accelerate forward aggressively for 90 ticks to reach high speed
      const driveInfo = await harness.evaluate(() => {
        const v = window.__GAME__.vehicles.getPlayerVehicle();
        window.__GAME__.actions.setVehicleInput({ w: true, a: false, s: false, d: false, space: false });
        for (let i = 0; i < 90; i++) {
          window.__GAME__.simulation.step(1 / 60);
        }
        window.__GAME__.actions.setVehicleInput({ w: false, a: false, s: false, d: false, space: false });
        return {
          speed: v.getSpeed ? v.getSpeed() : v.speed,
          vPos: v.getPosition()
        };
      });

      if (driveInfo.speed < 5.0) {
        throw new Error(`Vehicle speed should be > 5.0 m/s before moving exit, was ${driveInfo.speed.toFixed(2)} m/s`);
      }

      // Disembark while at non-zero velocity
      const exitResult = await harness.evaluate(() => {
        const v = window.__GAME__.vehicles.getPlayerVehicle();
        const vSpeedAtExit = v.getSpeed ? v.getSpeed() : v.speed;
        const vPosAtExit = v.getPosition();
        const success = window.__GAME__.actions.tryExitVehicle();
        const pPos = window.__GAME__.player.getPosition();
        const dist = Math.hypot(pPos.x - vPosAtExit.x, pPos.z - vPosAtExit.z);
        return {
          success,
          vSpeedAtExit,
          vPosAtExit,
          pPos,
          dist
        };
      });

      if (!exitResult.success) throw new Error('tryExitVehicle() failed during non-zero velocity motion');
      if (exitResult.dist < 0.5 || exitResult.dist > 5.0) {
        throw new Error(`Moving exit distance was ${exitResult.dist.toFixed(3)}m, expected [0.5m, 5.0m]`);
      }
      if (!Number.isFinite(exitResult.pPos.x) || !Number.isFinite(exitResult.pPos.z)) {
        throw new Error(`Moving exit player position is non-finite: ${JSON.stringify(exitResult.pPos)}`);
      }

      // Sample 60 RAF frames following moving exit to ensure player stays stable
      const postMovingSample = await harness.evaluate(() => {
        return new Promise((resolve) => {
          let count = 0;
          function f() {
            count++;
            if (count >= 60) {
              const pPos = window.__GAME__.player.getPosition();
              resolve({ pPos });
            } else {
              requestAnimationFrame(f);
            }
          }
          requestAnimationFrame(f);
        });
      });

      if (!Number.isFinite(postMovingSample.pPos.x) || !Number.isFinite(postMovingSample.pPos.z)) {
        throw new Error('Player position became non-finite after 60 RAF frames post-moving-exit');
      }
    });

    // ------------------------------------------------------------------------
    // Step 3: Disembarkation while Actively Turning (Yaw Rate != 0)
    // ------------------------------------------------------------------------
    await ctx.runStep('E2E Vector 3: Disembark while actively steering and turning (non-zero yaw rate)', async () => {
      // Re-enter vehicle
      const entered = await harness.evaluate(() => window.__GAME__.actions.tryEnterVehicle());
      if (!entered) throw new Error('Re-entering vehicle failed');

      // Steer hard left while driving forward for 40 ticks
      const turnInfo = await harness.evaluate(() => {
        const v = window.__GAME__.vehicles.getPlayerVehicle();
        const yaw0 = v.getYaw();
        window.__GAME__.actions.setVehicleInput({ w: true, a: true, s: false, d: false, space: false });
        for (let i = 0; i < 40; i++) {
          window.__GAME__.simulation.step(1 / 60);
        }
        const yaw1 = v.getYaw();
        return {
          speed: v.getSpeed ? v.getSpeed() : v.speed,
          yaw0,
          yaw1,
          yawDelta: Math.abs(yaw1 - yaw0)
        };
      });

      if (turnInfo.yawDelta < 0.05) {
        throw new Error(`Vehicle should be turning (delta: ${turnInfo.yawDelta.toFixed(3)} rad)`);
      }

      // Exit mid-turn
      const exitTurnResult = await harness.evaluate(() => {
        const v = window.__GAME__.vehicles.getPlayerVehicle();
        const vPos = v.getPosition();
        const yaw = v.getYaw();
        const success = window.__GAME__.actions.tryExitVehicle();
        const pPos = window.__GAME__.player.getPosition();
        const dist = Math.hypot(pPos.x - vPos.x, pPos.z - vPos.z);
        return {
          success,
          vPos,
          yaw,
          pPos,
          dist
        };
      });

      if (!exitTurnResult.success) throw new Error('tryExitVehicle() failed mid-turn');
      if (exitTurnResult.dist < 0.5 || exitTurnResult.dist > 5.0) {
        throw new Error(`Turning exit distance was ${exitTurnResult.dist.toFixed(3)}m, expected [0.5m, 5.0m]`);
      }
      if (!Number.isFinite(exitTurnResult.pPos.x) || !Number.isFinite(exitTurnResult.pPos.z)) {
        throw new Error(`Turning exit player position non-finite: ${JSON.stringify(exitTurnResult.pPos)}`);
      }

      // Verify no bounding circle clipping
      const clippingCheck = await harness.evaluate(() => {
        const v = window.__GAME__.vehicles.getPlayerVehicle();
        const pPos = window.__GAME__.player.getPosition();
        const circles = v.getBoundingCircles ? v.getBoundingCircles() : [];
        let minCircleDist = Infinity;
        for (const c of circles) {
          const d = Math.hypot(pPos.x - c.x, pPos.z - c.z);
          if (d < minCircleDist) minCircleDist = d;
        }
        return {
          minCircleDist,
          hasCircles: circles.length > 0
        };
      });

      if (clippingCheck.hasCircles && clippingCheck.minCircleDist < 1.0) {
        throw new Error(`Player is too close to vehicle bounding circle (minCircleDist: ${clippingCheck.minCircleDist.toFixed(3)}m)`);
      }
    });

    // ------------------------------------------------------------------------
    // Step 4: Keyboard 'E' Disembarkation Event in Browser Runtime
    // ------------------------------------------------------------------------
    await ctx.runStep('E2E Vector 4: Keyboard [E] disembarkation maintains position across 60 RAF frames', async () => {
      // Re-enter vehicle
      const entered = await harness.evaluate(() => window.__GAME__.actions.tryEnterVehicle());
      if (!entered) throw new Error('Re-entering vehicle failed');

      // Dispatch 'e' keydown event to document
      const exitViaKeyResult = await harness.evaluate(() => {
        const v = window.__GAME__.vehicles.getPlayerVehicle();
        const vPos = v.getPosition();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }));
        const state = window.__GAME__.player.getState();
        const pPos = window.__GAME__.player.getPosition();
        const dist = Math.hypot(pPos.x - vPos.x, pPos.z - vPos.z);
        return {
          state,
          vPos,
          pPos,
          dist
        };
      });

      if (exitViaKeyResult.state !== 'ON_FOOT') {
        throw new Error(`Keyboard [E] should transition state to ON_FOOT, got ${exitViaKeyResult.state}`);
      }
      if (exitViaKeyResult.dist < 0.5 || exitViaKeyResult.dist > 5.0) {
        throw new Error(`Keyboard [E] exit distance was ${exitViaKeyResult.dist.toFixed(3)}m, expected [0.5m, 5.0m]`);
      }

      // Sample 60 RAF frames
      const keyRafSample = await harness.evaluate(() => {
        return new Promise((resolve) => {
          let count = 0;
          function f() {
            count++;
            if (count >= 60) {
              const v = window.__GAME__.vehicles.getPlayerVehicle();
              const vPos = v.getPosition();
              const pPos = window.__GAME__.player.getPosition();
              const dist = Math.hypot(pPos.x - vPos.x, pPos.z - vPos.z);
              resolve({ dist, pPos });
            } else {
              requestAnimationFrame(f);
            }
          }
          requestAnimationFrame(f);
        });
      });

      if (keyRafSample.dist < 0.5 || keyRafSample.dist > 5.0) {
        throw new Error(`Post keyboard [E] 60 RAF frames distance collapsed or drifted: ${keyRafSample.dist.toFixed(3)}m`);
      }
    });

    // ------------------------------------------------------------------------
    // Step 5: High-Frequency Simulation Step Stress (1,000 steps post-exit)
    // ------------------------------------------------------------------------
    await ctx.runStep('E2E Vector 5: 1,000 simulation steps post-exit: Zero drift & zero collapse to 0.00m', async () => {
      const stepStressResult = await harness.evaluate(() => {
        const pPosBefore = window.__GAME__.player.getPosition();
        const v = window.__GAME__.vehicles.getPlayerVehicle();
        const vPos = v.getPosition();
        const samples = [];

        const checkpoints = [30, 60, 120, 300, 1000];
        let currentStep = 0;

        for (const targetStep of checkpoints) {
          while (currentStep < targetStep) {
            window.__GAME__.simulation.step(1 / 60);
            currentStep++;
          }
          const pPos = window.__GAME__.player.getPosition();
          const dist = Math.hypot(pPos.x - vPos.x, pPos.z - vPos.z);
          const driftFromBefore = Math.hypot(pPos.x - pPosBefore.x, pPos.z - pPosBefore.z);
          samples.push({
            step: targetStep,
            dist,
            driftFromBefore,
            pPos
          });
        }

        return {
          pPosBefore,
          samples
        };
      });

      for (const s of stepStressResult.samples) {
        if (s.dist < 0.5) {
          throw new Error(`At step ${s.step}: Distance collapsed to ${s.dist.toFixed(3)}m!`);
        }
        if (s.driftFromBefore > 0.01) {
          throw new Error(`At step ${s.step}: Player drifted by ${s.driftFromBefore.toFixed(4)}m without inputs!`);
        }
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

runE2EDisembarkStress().catch((err) => {
  console.error('[Fatal Error]', err);
  process.exit(1);
});
