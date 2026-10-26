#!/usr/bin/env node

/**
 * Kaj Simulator E2E Test Suite Master Runner
 * 
 * Entry point for running all E2E functional tests and performance benchmarks.
 * Returns exit code 0 if all tests pass, exit code 1 if any failure occurs.
 * 
 * Usage:
 *   node test/run-all-tests.js [options]
 * 
 * Options:
 *   --browser=edge|chrome|auto  Select browser executable (default: auto)
 *   --suite=all|functional|benchmark  Run specific suite (default: all)
 *   --frames=N                  Benchmark frame count (default: 1000)
 *   --self-test                 Run harness integrity verification test
 *   --verbose                   Enable verbose CDP logging
 *   --help                      Show help text
 */

const path = require('path');
const { createHarness, findBrowserPath } = require('./harness.js');
const { runFunctionalTests } = require('./e2e-functional.test.js');
const { runBenchmark } = require('./e2e-benchmark.test.js');

/**
 * Harness Self-Test: Verifies CDP communication, evaluation, event tracking,
 * and memory profiling on an isolated clean page.
 */
async function runHarnessSelfTest(options = {}) {
  console.log(`\n======================================================`);
  console.log(`Running Harness Integrity Self-Test`);
  console.log(`======================================================\n`);

  const harness = createHarness({
    browser: options.browser || 'auto',
    headless: true,
    verbose: options.verbose || false
  });

  let passed = true;

  try {
    console.log('[Self-Test] Starting CDP harness...');
    await harness.start();

    // 1. Evaluate basic JavaScript
    console.log('[Self-Test] Checking JavaScript evaluation...');
    const mathResult = await harness.evaluate((a, b) => a * b + 2, 7, 6);
    if (mathResult !== 44) {
      console.error(`\x1b[31m✖ Evaluation failed: expected 44, got ${mathResult}\x1b[0m`);
      passed = false;
    } else {
      console.log('  \x1b[32m✔\x1b[0m JavaScript evaluation working (7 * 6 + 2 = 44)');
    }

    // 2. Exception tracking
    console.log('[Self-Test] Checking exception tracking...');
    harness.clearLogs();
    try {
      await harness.evaluate(() => {
        setTimeout(() => {
          throw new Error('SelfTestControlledException');
        }, 10);
      });
      await new Promise(r => setTimeout(r, 200));
      const exceptions = harness.getExceptions();
      const caught = exceptions.some(e => e.description && e.description.includes('SelfTestControlledException'));
      if (!caught) {
        console.error('\x1b[31m✖ Exception tracking failed: expected controlled exception to be captured\x1b[0m');
        passed = false;
      } else {
        console.log('  \x1b[32m✔\x1b[0m Runtime exception capturing working');
      }
    } catch (e) {
      console.error('\x1b[31m✖ Exception test error:\x1b[0m', e.message);
      passed = false;
    }

    // 3. Memory metric querying
    console.log('[Self-Test] Checking memory metrics...');
    const memory = await harness.evaluate(() => {
      if (window.performance && window.performance.memory) {
        return window.performance.memory.usedJSHeapSize;
      }
      return -1;
    });
    console.log(`  \x1b[32m✔\x1b[0m Heap size query: ${memory > 0 ? (memory / (1024 * 1024)).toFixed(2) + ' MB' : 'available'}`);

    console.log(`\nSelf-Test Result: ${passed ? '\x1b[32m✔ ALL SELF-TESTS PASSED\x1b[0m' : '\x1b[31m✖ SELF-TEST FAILED\x1b[0m'}\n`);
    return passed;
  } finally {
    await harness.close();
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Kaj Simulator E2E Test Suite Master Runner

Usage: node test/run-all-tests.js [options]

Options:
  --browser=<name>   Target browser: 'edge', 'chrome', or 'auto' (default: auto)
  --suite=<suite>    Suite to execute: 'all', 'functional', 'benchmark' (default: all)
  --frames=<num>     Benchmark frame count (default: 1000)
  --self-test        Run harness integrity self-verification
  --verbose          Enable verbose CDP logging
  --help, -h         Show this help message
`);
    process.exit(0);
  }

  const browserArg = args.find(a => a.startsWith('--browser='));
  const browser = browserArg ? browserArg.split('=')[1] : 'auto';
  const suiteArg = args.find(a => a.startsWith('--suite='));
  const suite = suiteArg ? suiteArg.split('=')[1] : 'all';
  const framesArg = args.find(a => a.startsWith('--frames='));
  const frames = framesArg ? parseInt(framesArg.split('=')[1], 10) : 1000;
  const targetArg = args.find(a => a.startsWith('--target='));
  const isMock = args.includes('--mock');
  const targetPage = isMock ? 'test/mock-game.html' : (targetArg ? targetArg.slice(targetArg.indexOf('=') + 1) : 'game.html?time=12'); // noon: the day/night cycle otherwise follows the wall clock
  const isSelfTest = args.includes('--self-test');
  const verbose = args.includes('--verbose');

  console.log(`======================================================`);
  console.log(`Kaj Simulator E2E Test Runner`);
  console.log(`Target Page:    ${targetPage}`);
  console.log(`Target Browser: ${browser}`);
  console.log(`Suite Scope:    ${suite}`);
  console.log(`======================================================`);

  let browserPath;
  try {
    browserPath = findBrowserPath(browser);
    console.log(`Browser Binary: ${browserPath}\n`);
  } catch (err) {
    console.error(`\x1b[31mFatal Error: ${err.message}\x1b[0m`);
    process.exit(1);
  }

  const startTime = Date.now();
  let overallSuccess = true;

  // Run Self-Test if explicitly requested
  if (isSelfTest) {
    const selfTestPass = await runHarnessSelfTest({ browser, verbose });
    if (!selfTestPass) {
      overallSuccess = false;
    }
  }

  let functionalSummary = null;
  let benchmarkSummary = null;

  // 1. Run Functional Tests
  if (suite === 'all' || suite === 'functional') {
    try {
      functionalSummary = await runFunctionalTests({ browser, verbose, targetPage });
      if (functionalSummary.failed > 0) {
        overallSuccess = false;
      }
    } catch (err) {
      console.error('\x1b[31mError during Functional Test execution:\x1b[0m', err);
      overallSuccess = false;
    }
  }

  // 2. Run Benchmark Tests
  if (suite === 'all' || suite === 'benchmark') {
    try {
      benchmarkSummary = await runBenchmark({ browser, frames, verbose, targetPage });
      if (!benchmarkSummary.passed && !benchmarkSummary.skipped) {
        overallSuccess = false;
      }
    } catch (err) {
      console.error('\x1b[31mError during Benchmark execution:\x1b[0m', err);
      overallSuccess = false;
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n======================================================`);
  console.log(`MASTER TEST SUITE SUMMARY`);
  console.log(`Elapsed Time: ${durationSec}s`);
  console.log(`======================================================`);

  if (functionalSummary) {
    console.log(`Functional Tests: ${functionalSummary.passed} Passed, ${functionalSummary.failed} Failed, ${functionalSummary.skipped} Skipped`);
  }
  if (benchmarkSummary) {
    if (benchmarkSummary.skipped) {
      console.log(`Benchmark:        [SKIPPED] ${benchmarkSummary.reason}`);
    } else {
      console.log(`Benchmark:        ${benchmarkSummary.passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'} (Frames: ${benchmarkSummary.metrics ? benchmarkSummary.metrics.frames : 0})`);
    }
  }

  console.log(`Overall Result:   ${overallSuccess ? '\x1b[32m✔ ALL SUITES PASSED\x1b[0m' : '\x1b[31m✖ TEST FAILURES DETECTED\x1b[0m'}`);
  console.log(`======================================================\n`);

  process.exit(overallSuccess ? 0 : 1);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal Unhandled Runner Error:', err);
    process.exit(1);
  });
}

module.exports = {
  main,
  runHarnessSelfTest
};
