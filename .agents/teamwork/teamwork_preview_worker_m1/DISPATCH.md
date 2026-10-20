## 2026-10-19T21:48:21Z

You are teamwork_preview_worker_m1.
Your working directory is: C:\Users\potat\kajm1ller.github.io-1\.agents\teamwork\teamwork_preview_worker_m1
The original user request is stored at: C:\Users\potat\kajm1ller.github.io-1\.agents\teamwork\ORIGINAL_REQUEST.md
You MUST read ORIGINAL_REQUEST.md before starting work.
The project scope document is: C:\Users\potat\kajm1ller.github.io-1\.agents\teamwork\PROJECT.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your task is: Milestone 1 Implementation - Engine Core, Startup Defect Fix & Spatial Hash Grid.
Write Ownership: You exclusively own and may edit or create:
- game.html
- js/game/config.js
- js/game/spatialGrid.js
- js/game/main.js
- test/unit/ (if adding unit tests)

Input Specifications to Read:
1. C:\Users\potat\kajm1ller.github.io-1\.agents\teamwork\teamwork_preview_explorer_m1_1\handoff.md
2. C:\Users\potat\kajm1ller.github.io-1\.agents\teamwork\teamwork_preview_explorer_m1_2\handoff.md
3. C:\Users\potat\kajm1ller.github.io-1\.agents\teamwork\teamwork_preview_explorer_m1_3\handoff.md
4. C:\Users\potat\kajm1ller.github.io-1\TEST_READY.md

Requirements:
1. Fix the startup exception in game.html: declare the missing viewmodel variables (viewmodelScene, viewmodelCamera, viewmodelSprayCan, viewmodelBobTime, sprayParticleTime) and clean up sprayAtTarget(). Ensure game.html boots with ZERO console errors.
2. Implement js/game/spatialGrid.js using the zero-allocation 2D spatial hash grid architecture with 15m cells covering the 600m world, static vs dynamic separation, entry pooling, and monotonic query ID deduplication.
3. Integrate the fixed 60Hz timestep accumulator loop (fixedDelta = 1/60, maxSubSteps = 5, frameTime clamp = 0.1) in game loop.
4. Expose the full window.__GAME__ API conforming to PROJECT.md § Testing Automation API so test runners can query game status, step simulation, and run benchmarks.
5. Verification: Run `node test/run-all-tests.js --suite=functional` and any unit tests. Verify that Test 1 (Clean Startup) passes with 0 uncaught errors and that downlevel tests skip cleanly.
6. Deliver handoff report to:
C:\Users\potat\kajm1ller.github.io-1\.agents\teamwork\teamwork_preview_worker_m1\handoff.md
Follow the Handoff Protocol (Observation, Logic Chain, Caveats, Conclusion, Verification Method). When finished, send a message to orchestrator with your summary and handoff path.
