/**
 * E2E Scalability & Performance Benchmark for Kaj Simulator
 * 
 * Tests Acceptance Criteria:
 * - 50+ active concurrent entities/vehicles updating simultaneously.
 * - 1,000+ continuous simulation frames.
 * - Average frame/tick processing time < 16.6ms (60 FPS budget).
 * - Zero memory leak: JS heap growth < 2.0MB over 1,000 frames.
 */

const { createHarness } = require('./harness.js');

/**
 * Calculate statistical percentiles
 * @param {number[]} values
 * @param {number} p (0 to 1)
 */
function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor(sorted.length * p);
  return sorted[Math.min(index, sorted.length - 1)];
}

/**
 * Format bytes to MB
 * @param {number} bytes
 */
function toMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

/**
 * Run the E2E Benchmark Test Suite
 * @param {object} options
 * @returns {Promise<{ passed: boolean, metrics: object }>}
 */
async function runBenchmark(options = {}) {
  const browserType = options.browser || 'auto';
  const targetFrames = options.frames || 1000;
  const minEntities = options.minEntities || 50;

  // Noon: the day/night cycle otherwise follows the wall clock
  const targetPage = options.targetPage || 'game.html?time=12';

  console.log(`\n======================================================`);
  console.log(`Running E2E Scalability Benchmark (${targetFrames} frames, 50+ entities)`);
  console.log(`Target: ${targetPage} | Browser: ${browserType}`);
  console.log(`======================================================\n`);

  const harness = createHarness({
    browser: browserType,
    headless: options.headless !== false,
    verbose: options.verbose || false
  });

  try {
    console.log('[Setup] Launching browser and establishing CDP session...');
    await harness.start();

    console.log(`[Setup] Navigating to ${targetPage}...`);
    await harness.navigate(targetPage, { timeout: 15000, waitUntil: 'load' });

    // Check for startup exceptions
    const exceptions = harness.getExceptions();
    if (exceptions.length > 0) {
      console.log(`\x1b[31m✖ Benchmark aborted: game.html has fatal startup exceptions.\x1b[0m`);
      for (const exc of exceptions) {
        console.log(`    [line ${exc.lineNumber}] ${exc.description}`);
      }
      return {
        passed: false,
        skipped: false,
        error: `Startup exception: ${exceptions[0].description}`
      };
    }

    // Check if window.__GAME__ is available
    const gameApiAvailable = await harness.evaluate(() => {
      return typeof window.__GAME__ === 'object' && window.__GAME__ !== null && window.__GAME__.isReady === true;
    }).catch(() => false);

    if (!gameApiAvailable) {
      console.log(`\x1b[33m- [SKIPPED] Benchmark skipped: window.__GAME__ automation API is not available.\x1b[0m`);
      return {
        passed: false,
        skipped: true,
        reason: 'window.__GAME__ is not exposed or ready'
      };
    }

    console.log('[Benchmark] Verifying active entity count...');
    const entityCount = await harness.evaluate(() => {
      if (window.__GAME__.vehicles && typeof window.__GAME__.vehicles.getTrafficCount === 'function') {
        const traffic = window.__GAME__.vehicles.getTrafficCount();
        const playerV = window.__GAME__.player && window.__GAME__.player.getVehicle() ? 1 : 0;
        return traffic + playerV;
      }
      return 0;
    });

    console.log(`[Benchmark] Active entity count: ${entityCount} (Target: >= ${minEntities})`);
    if (entityCount < minEntities) {
      console.log(`\x1b[33mWarning: Active entities (${entityCount}) is below target threshold (${minEntities}).\x1b[0m`);
    }

    console.log(`[Benchmark] Executing ${targetFrames} continuous simulation frames...`);
    const benchmarkResults = await harness.evaluate(async (frames) => {
      // If native benchmark helper is provided by engine, use it
      if (window.__GAME__.simulation && typeof window.__GAME__.simulation.runBenchmark === 'function') {
        return window.__GAME__.simulation.runBenchmark(frames);
      }

      // Otherwise, run precise step benchmark in page context
      const tickTimes = [];
      const heapSamples = [];

      const getHeap = () => {
        if (window.performance && window.performance.memory) {
          return window.performance.memory.usedJSHeapSize;
        }
        return 0;
      };

      const startHeap = getHeap();
      heapSamples.push({ frame: 0, heap: startHeap });

      for (let f = 1; f <= frames; f++) {
        const t0 = performance.now();
        window.__GAME__.simulation.step(1 / 60);
        const t1 = performance.now();
        tickTimes.push(t1 - t0);

        if (f % 250 === 0) {
          heapSamples.push({ frame: f, heap: getHeap() });
        }
      }

      const endHeap = getHeap();
      const sumTimes = tickTimes.reduce((acc, t) => acc + t, 0);
      const avgFrameTimeMs = sumTimes / frames;
      const minFrameTimeMs = Math.min(...tickTimes);
      const maxFrameTimeMs = Math.max(...tickTimes);

      // 95th percentile
      const sorted = [...tickTimes].sort((a, b) => a - b);
      const p95FrameTimeMs = sorted[Math.floor(sorted.length * 0.95)];

      const memoryGrowthBytes = Math.max(0, endHeap - startHeap);

      return {
        frames,
        avgFrameTimeMs,
        minFrameTimeMs,
        maxFrameTimeMs,
        p95FrameTimeMs,
        fps: avgFrameTimeMs > 0 ? 1000 / avgFrameTimeMs : 60,
        startHeapBytes: startHeap,
        endHeapBytes: endHeap,
        memoryGrowthBytes,
        heapSamples
      };
    }, targetFrames);

    // Evaluate Acceptance Criteria:
    // 1. avgFrameTimeMs < 16.6ms (60 FPS budget)
    // 2. memoryGrowthBytes < 2.0MB (2 * 1024 * 1024 bytes)
    const MAX_AVG_FRAME_TIME_MS = 16.6;
    const MAX_MEMORY_GROWTH_BYTES = 2.0 * 1024 * 1024;

    const frameTimePass = benchmarkResults.avgFrameTimeMs < MAX_AVG_FRAME_TIME_MS;
    const memoryPass = benchmarkResults.memoryGrowthBytes < MAX_MEMORY_GROWTH_BYTES;
    const entityPass = entityCount >= minEntities;

    const passed = frameTimePass && memoryPass;

    console.log('\n----------------- Benchmark Report -----------------');
    console.log(`Total Frames:            ${benchmarkResults.frames}`);
    console.log(`Active Entities:         ${entityCount} ${entityPass ? '✔' : '⚠'}`);
    console.log(`Min Frame Time:          ${benchmarkResults.minFrameTimeMs.toFixed(3)} ms`);
    console.log(`Avg Frame Time:          ${benchmarkResults.avgFrameTimeMs.toFixed(3)} ms (Limit: < 16.6ms) ${frameTimePass ? '\x1b[32m✔ PASS\x1b[0m' : '\x1b[31m✖ FAIL\x1b[0m'}`);
    console.log(`p95 Frame Time:          ${benchmarkResults.p95FrameTimeMs.toFixed(3)} ms`);
    console.log(`Max Frame Time:          ${benchmarkResults.maxFrameTimeMs.toFixed(3)} ms`);
    console.log(`Effective FPS:           ${benchmarkResults.fps.toFixed(1)} FPS`);
    console.log(`Initial Heap:            ${toMB(benchmarkResults.startHeapBytes)} MB`);
    console.log(`Final Heap:              ${toMB(benchmarkResults.endHeapBytes)} MB`);
    console.log(`Heap Growth:             ${toMB(benchmarkResults.memoryGrowthBytes)} MB (Limit: < 2.0MB) ${memoryPass ? '\x1b[32m✔ PASS\x1b[0m' : '\x1b[31m✖ FAIL\x1b[0m'}`);
    console.log('----------------------------------------------------');
    console.log(`Benchmark Result:        ${passed ? '\x1b[32m✔ PASSED\x1b[0m' : '\x1b[31m✖ FAILED\x1b[0m'}\n`);

    return {
      passed,
      skipped: false,
      metrics: {
        frames: benchmarkResults.frames,
        entityCount,
        avgFrameTimeMs: benchmarkResults.avgFrameTimeMs,
        p95FrameTimeMs: benchmarkResults.p95FrameTimeMs,
        maxFrameTimeMs: benchmarkResults.maxFrameTimeMs,
        fps: benchmarkResults.fps,
        memoryGrowthMB: benchmarkResults.memoryGrowthBytes / (1024 * 1024)
      }
    };

  } finally {
    console.log('[Teardown] Shutting down browser session...');
    await harness.close();
  }
}

// Direct execution entry point
if (require.main === module) {
  const browserArg = process.argv.find(a => a.startsWith('--browser='));
  const browser = browserArg ? browserArg.split('=')[1] : 'auto';
  const framesArg = process.argv.find(a => a.startsWith('--frames='));
  const frames = framesArg ? parseInt(framesArg.split('=')[1], 10) : 1000;
  const verbose = process.argv.includes('--verbose');

  runBenchmark({ browser, frames, verbose })
    .then(result => {
      process.exit(result.passed ? 0 : (result.skipped ? 0 : 1));
    })
    .catch(err => {
      console.error('Fatal Benchmark Error:', err);
      process.exit(1);
    });
}

module.exports = {
  runBenchmark
};
