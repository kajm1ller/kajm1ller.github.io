/**
 * test/stress-simulation.test.js
 * 
 * Empirical Stress Test Harness for Milestone 1:
 * Headless Simulation Loop & Performance Verification
 * 
 * Objectives:
 * 1. Challenge window.__GAME__.simulation.step(dt) with erratic/chaotic dt values
 *    (e.g., 0.0001s, 0.5s, 0s, negative dt, undefined dt, random noise).
 * 2. Stress test the 1,000-frame benchmark over multiple consecutive runs (3,000+ frames total).
 * 3. Monitor heap delta and frame time to verify zero memory leak growth and consistent < 16.6ms frame time.
 */

const { createHarness } = require('./harness.js');

function toMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

class StressReporter {
  constructor(name) {
    this.name = name;
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
    this.skipped = 0;
    this.errors = [];
  }

  async runTest(title, testFn) {
    const t0 = performance.now();
    try {
      await testFn();
      const dur = (performance.now() - t0).toFixed(1);
      this.passed++;
      this.tests.push({ title, status: 'PASS', durationMs: dur });
      console.log(`  \x1b[32m✔ PASS\x1b[0m [${dur}ms] ${title}`);
    } catch (err) {
      const dur = (performance.now() - t0).toFixed(1);
      this.failed++;
      this.tests.push({ title, status: 'FAIL', durationMs: dur, error: err.message });
      this.errors.push({ title, error: err });
      console.log(`  \x1b[31m✖ FAIL\x1b[0m [${dur}ms] ${title}`);
      console.log(`    \x1b[31mError: ${err.message}\x1b[0m`);
    }
  }

  summary() {
    console.log(`\n======================================================`);
    console.log(`STRESS TEST SUMMARY: ${this.name}`);
    console.log(`Total: ${this.tests.length} | Passed: \x1b[32m${this.passed}\x1b[0m | Failed: \x1b[31m${this.failed}\x1b[0m | Skipped: ${this.skipped}`);
    console.log(`======================================================\n`);
    return {
      passed: this.passed,
      failed: this.failed,
      total: this.tests.length,
      errors: this.errors
    };
  }
}

async function runSimulationStressSuite(options = {}) {
  const browserType = options.browser || 'auto';
  const reporter = new StressReporter('Milestone 1 Headless Simulation & Loop Stress');

  console.log(`\n======================================================`);
  console.log(`Launching Headless Browser Stress Harness`);
  console.log(`Browser: ${browserType} | Target: game.html`);
  console.log(`======================================================\n`);

  const harness = createHarness({
    browser: browserType,
    headless: options.headless !== false,
    verbose: options.verbose || false
  });

  try {
    console.log('[Setup] Starting CDP browser session...');
    await harness.start();

    console.log('[Setup] Navigating to game.html...');
    await harness.navigate('game.html', { timeout: 15000, waitUntil: 'load' });

    // Pre-flight: Check startup exceptions
    const startupExceptions = harness.getExceptions();
    if (startupExceptions.length > 0) {
      throw new Error(`Startup exceptions detected: ${startupExceptions.map(e => e.description).join('; ')}`);
    }

    // Verify window.__GAME__ readiness
    await reporter.runTest('API Readiness: window.__GAME__ is exposed and isReady === true', async () => {
      const ready = await harness.evaluate(() => {
        return typeof window.__GAME__ === 'object' &&
               window.__GAME__ !== null &&
               window.__GAME__.isReady === true &&
               typeof window.__GAME__.simulation === 'object' &&
               typeof window.__GAME__.simulation.step === 'function';
      });
      if (!ready) throw new Error('window.__GAME__.simulation.step is not available');
    });

    // -------------------------------------------------------------------
    // CATEGORY 1: Erratic and Chaotic dt Timestep Stress
    // -------------------------------------------------------------------
    console.log('\n--- Category 1: Erratic & Chaotic Timestep Stress ---');

    await reporter.runTest('Erratic dt: dt = 0 preserves state without displacement or NaN', async () => {
      const result = await harness.evaluate(() => {
        // Pause natural RAF updates to isolate manual stepping
        window.__GAME__.simulation.setPaused(true);

        const posBefore = { ...window.__GAME__.player.getPosition() };
        window.__GAME__.simulation.step(0);
        const posAfter = { ...window.__GAME__.player.getPosition() };

        return {
          posBefore,
          posAfter,
          isEqual: posBefore.x === posAfter.x && posBefore.y === posAfter.y && posBefore.z === posAfter.z,
          allFinite: Number.isFinite(posAfter.x) && Number.isFinite(posAfter.y) && Number.isFinite(posAfter.z)
        };
      });

      if (!result.allFinite) throw new Error('Player coordinates became non-finite with dt = 0');
      if (!result.isEqual) throw new Error(`Player position changed on zero dt: before=${JSON.stringify(result.posBefore)} after=${JSON.stringify(result.posAfter)}`);
    });

    await reporter.runTest('Erratic dt: dt = 0.0001 (micro-step) executes smoothly with finite coordinates', async () => {
      const result = await harness.evaluate(() => {
        window.__GAME__.actions.setPlayerInput({ w: true });
        const posBefore = { ...window.__GAME__.player.getPosition() };

        window.__GAME__.simulation.step(0.0001);

        const posAfter = { ...window.__GAME__.player.getPosition() };
        window.__GAME__.actions.setPlayerInput({ w: false });

        return {
          posBefore,
          posAfter,
          allFinite: Number.isFinite(posAfter.x) && Number.isFinite(posAfter.y) && Number.isFinite(posAfter.z),
          deltaZ: Math.abs(posAfter.z - posBefore.z),
          deltaX: Math.abs(posAfter.x - posBefore.x)
        };
      });

      if (!result.allFinite) throw new Error('Player coordinates became non-finite with micro dt = 0.0001');
    });

    await reporter.runTest('Erratic dt: dt = 0.5 (large 500ms lag spike) executes without collision corruption or NaN', async () => {
      const result = await harness.evaluate(() => {
        window.__GAME__.actions.setPlayerInput({ w: true });
        const posBefore = { ...window.__GAME__.player.getPosition() };

        window.__GAME__.simulation.step(0.5);

        const posAfter = { ...window.__GAME__.player.getPosition() };
        window.__GAME__.actions.setPlayerInput({ w: false });

        // Query spatial grid around player to verify grid synchronization
        const queryResults = [];
        window.__GAME__.spatialGrid.queryRadius(posAfter.x, posAfter.z, 5.0, queryResults, 'DYNAMIC');
        const foundPlayer = queryResults.some(e => e.id === 'player');

        return {
          posBefore,
          posAfter,
          allFinite: Number.isFinite(posAfter.x) && Number.isFinite(posAfter.y) && Number.isFinite(posAfter.z),
          foundPlayer,
          activeCellCount: window.__GAME__.spatialGrid.activeCellCount
        };
      });

      if (!result.allFinite) throw new Error('Player coordinates became non-finite after large spike dt = 0.5');
      if (!result.foundPlayer) throw new Error('Player entity not found in spatial grid after large spike dt = 0.5');
    });

    await reporter.runTest('Erratic dt: Edge values (dt = 5.0, dt = -0.016, dt = undefined) preserve memory and state', async () => {
      const result = await harness.evaluate(() => {
        const errors = [];
        try {
          window.__GAME__.simulation.step(5.0); // 5 second massive spike
        } catch (e) {
          errors.push(`step(5.0): ${e.message}`);
        }

        try {
          window.__GAME__.simulation.step(-0.016); // negative dt
        } catch (e) {
          errors.push(`step(-0.016): ${e.message}`);
        }

        try {
          window.__GAME__.simulation.step(undefined); // default argument fallback
        } catch (e) {
          errors.push(`step(undefined): ${e.message}`);
        }

        const pos = window.__GAME__.player.getPosition();
        return {
          errors,
          pos,
          allFinite: Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z)
        };
      });

      if (result.errors.length > 0) throw new Error(result.errors.join('; '));
      if (!result.allFinite) throw new Error('Coordinates corrupted by edge dt values');
    });

    await reporter.runTest('Erratic dt: 500-step chaotic random dt sequence with dynamic inputs and collision checks', async () => {
      const result = await harness.evaluate(() => {
        const dts = [0, 0.00005, 0.0001, 0.005, 0.0166667, 0.0333333, 0.05, 0.1, 0.25, 0.5];
        let nonFiniteCount = 0;
        let spatialMismatchCount = 0;

        for (let i = 0; i < 500; i++) {
          // Chaotic inputs
          const input = {
            w: (i % 3 === 0),
            s: (i % 7 === 0),
            a: (i % 5 === 0),
            d: (i % 11 === 0)
          };
          window.__GAME__.actions.setPlayerInput(input);

          // Chaotic dt
          const chaoticDt = dts[i % dts.length];
          window.__GAME__.simulation.step(chaoticDt);

          const pos = window.__GAME__.player.getPosition();
          if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
            nonFiniteCount++;
          }

          // Check spatial grid integrity every 50 frames
          if (i % 50 === 0) {
            const queryOut = [];
            window.__GAME__.spatialGrid.queryRadius(pos.x, pos.z, 2.0, queryOut, 'DYNAMIC');
            if (!queryOut.some(e => e.id === 'player')) {
              spatialMismatchCount++;
            }
          }
        }

        window.__GAME__.actions.setPlayerInput({ w: false, a: false, s: false, d: false });
        return {
          nonFiniteCount,
          spatialMismatchCount,
          finalPos: window.__GAME__.player.getPosition()
        };
      });

      if (result.nonFiniteCount > 0) throw new Error(`Detected ${result.nonFiniteCount} frames with non-finite coordinates during chaotic dt sequence`);
      if (result.spatialMismatchCount > 0) throw new Error(`Detected ${result.spatialMismatchCount} spatial grid sync mismatches`);
    });

    // -------------------------------------------------------------------
    // CATEGORY 2: Multi-Run Consecutive Benchmark Stress (3,000 frames)
    // -------------------------------------------------------------------
    console.log('\n--- Category 2: Consecutive 1,000-Frame Benchmark Stress ---');

    await reporter.runTest('Consecutive Benchmarks: 3x 1,000 frames (3,000 frames total) - timing & heap stability', async () => {
      const runs = await harness.evaluate(async () => {
        const results = [];
        for (let r = 1; r <= 3; r++) {
          const runRes = await window.__GAME__.simulation.runBenchmark(1000);
          results.push({
            runIndex: r,
            frames: runRes.frames,
            avgFrameTimeMs: runRes.avgFrameTimeMs,
            p95FrameTimeMs: runRes.p95FrameTimeMs,
            maxFrameTimeMs: runRes.maxFrameTimeMs,
            fps: runRes.fps,
            startHeapBytes: runRes.startHeapBytes,
            endHeapBytes: runRes.endHeapBytes,
            memoryGrowthBytes: runRes.memoryGrowthBytes
          });
        }
        return results;
      });

      console.log('    Consecutive Benchmark Telemetry:');
      let totalGrowth = 0;
      for (const r of runs) {
        console.log(`      Run #${r.runIndex}: Avg=${r.avgFrameTimeMs.toFixed(3)}ms | p95=${r.p95FrameTimeMs.toFixed(3)}ms | Max=${r.maxFrameTimeMs.toFixed(3)}ms | Heap=${toMB(r.startHeapBytes)}MB -> ${toMB(r.endHeapBytes)}MB (Δ${toMB(r.memoryGrowthBytes)}MB)`);
        
        if (r.avgFrameTimeMs >= 16.6) {
          throw new Error(`Run #${r.runIndex} average frame time ${r.avgFrameTimeMs.toFixed(3)}ms exceeded 16.6ms budget`);
        }
        if (r.memoryGrowthBytes > 2.0 * 1024 * 1024) {
          throw new Error(`Run #${r.runIndex} memory growth ${toMB(r.memoryGrowthBytes)}MB exceeded 2.0MB limit`);
        }
      }

      const totalHeapDeltaBytes = runs[runs.length - 1].endHeapBytes - runs[0].startHeapBytes;
      console.log(`      Total Cumulative Heap Delta across 3 runs (3,000 frames): ${toMB(totalHeapDeltaBytes)} MB`);
      if (totalHeapDeltaBytes > 2.0 * 1024 * 1024) {
        throw new Error(`Cumulative heap delta across 3 consecutive benchmarks (${toMB(totalHeapDeltaBytes)}MB) exceeded 2.0MB limit`);
      }
    });

    // -------------------------------------------------------------------
    // CATEGORY 3: Continuous 3,000-Frame Active Simulation Profiling
    // -------------------------------------------------------------------
    console.log('\n--- Category 3: Sustained 3,000 Continuous Frames Profiling ---');

    await reporter.runTest('Sustained Profiling: 3,000 continuous frames with active player movement & periodic heap checkpoints', async () => {
      const profiling = await harness.evaluate(async () => {
        const TOTAL_FRAMES = 3000;
        const CHECKPOINT_INTERVAL = 250;
        const tickTimes = [];
        const checkpoints = [];

        const getHeap = () => (window.performance && window.performance.memory) ? window.performance.memory.usedJSHeapSize : 0;

        const initialHeap = getHeap();
        checkpoints.push({ frame: 0, heap: initialHeap });

        for (let f = 1; f <= TOTAL_FRAMES; f++) {
          // Dynamic steering inputs every 60 frames
          const keyCycle = Math.floor(f / 60) % 4;
          window.__GAME__.actions.setPlayerInput({
            w: keyCycle === 0 || keyCycle === 1,
            s: keyCycle === 2,
            a: keyCycle === 1,
            d: keyCycle === 3
          });

          const t0 = performance.now();
          window.__GAME__.simulation.step(1 / 60);
          const t1 = performance.now();
          tickTimes.push(t1 - t0);

          if (f % CHECKPOINT_INTERVAL === 0) {
            checkpoints.push({ frame: f, heap: getHeap() });
          }
        }

        window.__GAME__.actions.setPlayerInput({ w: false, a: false, s: false, d: false });

        const finalHeap = getHeap();
        const sum = tickTimes.reduce((a, b) => a + b, 0);
        const sorted = [...tickTimes].sort((a, b) => a - b);
        const avg = sum / TOTAL_FRAMES;
        const p95 = sorted[Math.floor(sorted.length * 0.95)];
        const max = Math.max(...tickTimes);

        // Calculate post-warmup heap growth (frame 250 -> 3000)
        const warmupHeap = checkpoints[1] ? checkpoints[1].heap : initialHeap;
        const postWarmupGrowth = Math.max(0, finalHeap - warmupHeap);

        return {
          totalFrames: TOTAL_FRAMES,
          avgFrameTimeMs: avg,
          p95FrameTimeMs: p95,
          maxFrameTimeMs: max,
          initialHeapBytes: initialHeap,
          finalHeapBytes: finalHeap,
          warmupHeapBytes: warmupHeap,
          postWarmupGrowthBytes: postWarmupGrowth,
          checkpoints
        };
      });

      console.log('    Sustained Profiling Telemetry:');
      console.log(`      Frames:                ${profiling.totalFrames}`);
      console.log(`      Avg Frame Time:        ${profiling.avgFrameTimeMs.toFixed(3)} ms (Limit: < 16.6ms)`);
      console.log(`      p95 Frame Time:        ${profiling.p95FrameTimeMs.toFixed(3)} ms`);
      console.log(`      Max Frame Time:        ${profiling.maxFrameTimeMs.toFixed(3)} ms`);
      console.log(`      Initial Heap (f=0):    ${toMB(profiling.initialHeapBytes)} MB`);
      console.log(`      Warmup Heap (f=250):   ${toMB(profiling.warmupHeapBytes)} MB`);
      console.log(`      Final Heap (f=3000):   ${toMB(profiling.finalHeapBytes)} MB`);
      console.log(`      Post-Warmup Growth:    ${toMB(profiling.postWarmupGrowthBytes)} MB (Limit: < 2.0MB)`);
      console.log('      Heap Checkpoints:');
      for (const cp of profiling.checkpoints) {
        console.log(`        Frame ${String(cp.frame).padStart(4)}: ${toMB(cp.heap)} MB`);
      }

      if (profiling.avgFrameTimeMs >= 16.6) {
        throw new Error(`Sustained average frame time ${profiling.avgFrameTimeMs.toFixed(3)}ms exceeded 16.6ms budget`);
      }
      if (profiling.postWarmupGrowthBytes > 2.0 * 1024 * 1024) {
        throw new Error(`Post-warmup heap growth ${toMB(profiling.postWarmupGrowthBytes)}MB exceeded 2.0MB threshold`);
      }
    });

    // -------------------------------------------------------------------
    // CATEGORY 4: Zero Console Exceptions / Errors during Stress Testing
    // -------------------------------------------------------------------
    console.log('\n--- Category 4: Page Integrity Verification ---');

    await reporter.runTest('Page Health: Zero unhandled console errors or runtime exceptions during entire stress run', async () => {
      const exceptions = harness.getExceptions();
      const consoleErrors = harness.getConsoleErrors();

      if (exceptions.length > 0) {
        throw new Error(`Page threw uncaught exceptions: ${exceptions.map(e => e.description).join('; ')}`);
      }
      if (consoleErrors.length > 0) {
        throw new Error(`Console logged errors: ${consoleErrors.map(e => e.text).join('; ')}`);
      }
    });

    // -------------------------------------------------------------------
    // CATEGORY 5: Adversarial Input Hardening & Edge Vulnerability Analysis
    // -------------------------------------------------------------------
    console.log('\n--- Category 5: Adversarial Input Hardening Analysis ---');

    await reporter.runTest('Adversarial Hardening: step(NaN) vulnerability analysis and isolation', async () => {
      const probe = await harness.evaluate(() => {
        window.__GAME__.actions.setPlayerInput({ w: true });
        window.__GAME__.simulation.step(NaN);
        const poisonedPos = window.__GAME__.player.getPosition();
        const isPoisoned = !Number.isFinite(poisonedPos.x) || !Number.isFinite(poisonedPos.z);

        // Attempt recovery via normal step
        window.__GAME__.simulation.step(1 / 60);
        const afterStep = window.__GAME__.player.getPosition();
        const unrecoverableWithoutReload = !Number.isFinite(afterStep.x) || !Number.isFinite(afterStep.z);

        return {
          isPoisoned,
          unrecoverableWithoutReload
        };
      });

      console.log(`      Adversarial Finding: step(NaN) without Number.isFinite() guard poisons coordinates: ${probe.isPoisoned}`);
      console.log(`      Irrecoverable in-memory without reload: ${probe.unrecoverableWithoutReload}`);
      if (!probe.isPoisoned) {
        throw new Error('Expected step(NaN) to trigger NaN behavior, but coordinates remained finite');
      }

      // Re-navigate to clean up state
      await harness.navigate('game.html', { timeout: 15000, waitUntil: 'load' });
    });

  } finally {
    console.log('[Teardown] Closing browser session...');
    await harness.close();
  }

  const summary = reporter.summary();
  return {
    passed: summary.failed === 0,
    summary
  };
}

// CLI Execution entry point
if (require.main === module) {
  const browserArg = process.argv.find(a => a.startsWith('--browser='));
  const browser = browserArg ? browserArg.split('=')[1] : 'auto';
  const verbose = process.argv.includes('--verbose');

  runSimulationStressSuite({ browser, verbose })
    .then(res => {
      process.exit(res.passed ? 0 : 1);
    })
    .catch(err => {
      console.error('Fatal Stress Suite Error:', err);
      process.exit(1);
    });
}

module.exports = {
  runSimulationStressSuite
};
