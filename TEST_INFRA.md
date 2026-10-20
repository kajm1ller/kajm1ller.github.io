# Test Infrastructure Documentation

## Overview

The Kaj Simulator automated end-to-end (E2E) testing suite and benchmark harness provides opaque-box, deterministic verification of player vehicles, autonomous AI traffic, and engine rendering/physics scalability.

The runner connects directly to headless Microsoft Edge or Google Chrome via the Chrome DevTools Protocol (CDP) over native WebSockets (`ws`), requiring zero external browser drivers, Selenium, or heavy browser frameworks.

```
┌────────────────────────────────────────────────────────┐
│                   test/run-all-tests.js                │ (CLI Entry Point & Test Aggregator)
└───────────┬────────────────────────────────┬───────────┘
            │                                │
┌───────────▼──────────────┐   ┌─────────────▼───────────┐
│ test/e2e-functional.test.js │   │ test/e2e-benchmark.test.js │ (1,000 frames, 50+ entities)
└───────────┬──────────────┘   └─────────────┬───────────┘
            │                                │
            └───────────────┬────────────────┘
                            │ uses
            ┌───────────────▼───────────────┐
            │        test/harness.js        │
            │  - Dynamic OS HTTP Server     │
            │  - Headless Edge/Chrome Spawn │
            │  - Native CDP WebSocket (ws)  │
            │  - Exception & Console Spy    │
            └───────────────┬───────────────┘
                            │ CDP / HTTP
            ┌───────────────▼───────────────┐
            │    game.html / mock-game.html │
            │      window.__GAME__ API      │
            └───────────────────────────────┘
```

---

## 1. CDP Architecture & Communication Protocol

### Browser Selection & Launch
The test harness automatically discovers the installed browser binary on Windows:
- **Microsoft Edge**: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` or `C:\Program Files\Microsoft\Edge\Application\msedge.exe`
- **Google Chrome**: `C:\Program Files\Google\Chrome\Application\chrome.exe` or `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`
- **Custom Executable**: Configurable via the `BROWSER_PATH` environment variable.

The browser is spawned as a child process with modern headless flags:
```text
--headless=new
--remote-debugging-port=<dynamic_os_port>
--remote-allow-origins=*
--user-data-dir=<isolated_temp_directory>
--no-first-run
--no-default-browser-check
--disable-background-networking
--disable-sync
--disable-translate
--disable-default-apps
--disable-extensions
--mute-audio
--disable-gpu
--window-size=1280,720
about:blank
```

### Dynamic Static HTTP File Server
Because `game.html` uses native ES modules (`<script type="importmap">` and `<script type="module">`), navigating via `file:///` causes browser CORS errors.
`test/harness.js` starts an embedded, zero-dependency Node.js HTTP server on a dynamic port (`0.0.0.0` / port `0` assigned by OS). It serves:
- Proper MIME types (`application/javascript` for `.js`/`.mjs`, `text/html` for `.html`, etc.).
- `Cache-Control: no-store, no-cache, must-revalidate` to prevent stale script caching.
- `Access-Control-Allow-Origin: *` for unrestricted asset loading.

### WebSocket CDP Channel
1. The harness polls `http://127.0.0.1:<port>/json/list` until the browser target responds.
2. It extracts `webSocketDebuggerUrl` for the primary page target.
3. It opens a WebSocket connection using the project's installed `ws` package.
4. It enables CDP domains:
   - `Page.enable`: tracks lifecycle events (`Page.loadEventFired`).
   - `Runtime.enable`: captures uncaught exceptions (`Runtime.exceptionThrown`) and console logs (`Runtime.consoleAPICalled`).
   - `Console.enable`: captures console messages.

---

## 2. Test Harness API (`test/harness.js`)

| Method | Parameters | Return Type | Description |
|---|---|---|---|
| `createHarness(options)` | `{ browser, headless, rootDir, viewport, verbose }` | `CDPHarness` | Factory function to instantiate harness. |
| `harness.start()` | none | `Promise<CDPHarness>` | Starts HTTP server, spawns browser, connects CDP over WebSocket. |
| `harness.navigate(pathOrUrl, options)` | `target, { timeout, waitUntil }` | `Promise<void>` | Navigates to a page relative to workspace root or URL. |
| `harness.evaluate(script, ...args)` | `string \| Function, ...args` | `Promise<any>` | Evaluates code in page context; resolves promises and returns primitive values. |
| `harness.waitForFunction(fn, options)` | `Function \| string, { timeout, pollInterval }` | `Promise<any>` | Polls page until predicate returns truthy value. |
| `harness.waitForGameReady(timeout)` | `timeoutMs = 15000` | `Promise<boolean>` | Polls until `window.__GAME__.isReady === true`. |
| `harness.getExceptions()` | none | `Array<object>` | Returns all captured uncaught page exceptions with stack traces. |
| `harness.getConsoleErrors()` | none | `Array<object>` | Returns all `console.error` logs emitted by the page. |
| `harness.getAllConsoleMessages()` | none | `Array<object>` | Returns all console messages (`log`, `warn`, `error`, `info`). |
| `harness.clearLogs()` | none | `void` | Resets captured exception and console logs. |
| `harness.close()` | none | `Promise<void>` | Closes WebSocket, terminates browser process tree (`taskkill /pid /T /F`), deletes temp data dir, closes HTTP server. |

---

## 3. Test Suite Inventory

### 1. Functional Test Suite (`test/e2e-functional.test.js`)
Validates acceptance criteria across 9 distinct test cases:

1. **Clean Startup**:
   - `game.html` loads with zero uncaught exceptions and zero console errors.
   - Three.js WebGL canvas is mounted in the DOM.
   - Automation hook `window.__GAME__` is exposed and reports `isReady === true`.
2. **Player Vehicle Boarding**:
   - Player starts in `ON_FOOT` state.
   - Boarding nearby vehicle transitions player state to `IN_VEHICLE`.
   - `window.__GAME__.player.getVehicle()` returns active vehicle instance.
3. **Driving Controls (Throttle & Steering)**:
   - Driving inputs (`w: true, a: true`) simulated for 60 ticks (1.0s at 60Hz).
   - Vehicle undergoes position displacement ($\Delta d > 0.5\text{m}$).
   - Vehicle heading rotates due to steering ($|\Delta \psi| > 0.02\text{ rad}$).
   - Forward speed $> 0$.
4. **Obstacle Collision Integrity & NaN Safeguard**:
   - Vehicle accelerated into collision event.
   - Asserts position coordinates ($x, y, z$), linear velocity ($vx, vz$), and yaw remain valid finite real numbers (`Number.isFinite`).
   - Ensures no coordinate corruption or NaN propagation.
   - Asserts vehicle remains within world bounds ($[-280, 280]$).
5. **Clean Vehicle Exit**:
   - Player exits vehicle back to `ON_FOOT` state.
   - Active vehicle reference cleared (`null`).
   - Player placed safely adjacent to vehicle ($0.5\text{m} \le \text{dist} \le 5.0\text{m}$), without penetrating obstacle meshes.
6. **AI Traffic Fleet Progression**:
   - 10 to 50 autonomous vehicles spawn on designated road network.
   - Simulation stepped for 300 ticks (5.0s at 60Hz).
   - Verifies $\ge 70\%$ of fleet actively progresses along paths without getting permanently stuck.
7. **AI Traffic Collision Spacing & Anti-Overlap**:
   - Pairwise distance computed between all traffic vehicles across 100 simulation ticks:
     $$d(v_i, v_j) = \sqrt{(x_i - x_j)^2 + (z_i - z_j)^2}$$
   - Asserts zero overlap violations ($d(v_i, v_j) \ge 2.0\text{m}$ at all times).
8. **Adversarial Input Resilience**:
   - Sends contradictory simultaneous inputs (`w: true, s: true, a: true, d: true, space: true`).
   - Asserts physics remains deterministic and coordinates remain finite.
9. **World Boundary Constraints**:
   - Verifies all traffic and player vehicles are clamped within map extents ($[-280, 280]$).

### 2. Performance & Scalability Benchmark (`test/e2e-benchmark.test.js`)
Validates performance and memory criteria under continuous stress:
- **Entity Count**: $\ge 50$ concurrent active entities.
- **Duration**: 1,000 continuous simulation frames.
- **Time Budget**: Average frame/tick processing time $< 16.6\text{ms}$ (passing 60 FPS budget).
- **Memory Growth**: Total JS heap growth $< 2.0\text{MB}$ over 1,000 frames (proving zero memory leak).
- **Statistical Output**: Calculates min, average, 95th percentile, and max frame times, effective FPS, initial heap, final heap, and heap delta.

### 3. Master Test Runner (`test/run-all-tests.js`)
- Primary CLI entry point for developers and CI/CD pipelines.
- Supports flags:
  - `--browser=edge|chrome|auto`: Select target browser.
  - `--suite=all|functional|benchmark`: Filter which suite to execute.
  - `--frames=N`: Custom benchmark frame count.
  - `--target=<page>`: Target HTML page to load.
  - `--mock`: Runs suites against interface conformance mock (`test/mock-game.html`).
  - `--self-test`: Executes harness integrity checks.
  - `--verbose`: Detailed CDP logging.
- Exits with code `0` on all tests passing, code `1` on failure.

---

## 4. Verification Instructions

### Run All Tests
```powershell
node test/run-all-tests.js
```

### Run Test Suite Against Interface Conformance Mock (Self-Verification)
```powershell
node test/run-all-tests.js --mock
```

### Run Specific Test Suite
```powershell
# Run functional tests only
node test/e2e-functional.test.js

# Run benchmark only (1,000 frames)
node test/e2e-benchmark.test.js
```

### Run with Specific Browser
```powershell
node test/run-all-tests.js --browser=edge
node test/run-all-tests.js --browser=chrome
```
