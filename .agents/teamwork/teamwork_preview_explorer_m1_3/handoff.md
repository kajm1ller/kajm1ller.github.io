# Milestone 1: Testing API Hook & Modular Integration Architecture - Handoff Report

## 1. Observation

### 1.1 Startup Defect & Strict Mode Failure in `game.html`
- **Location**: `C:\Users\potat\kajm1ller.github.io-1\game.html:929` and `game.html:1542`
- **Verbatim Error**: Directly observed via headless Chrome CDP (`verify_headless_boot.js`):
  ```
  [BROWSER EXCEPTION] Uncaught ReferenceError: viewmodelScene is not defined
      at initViewmodelScene (http://localhost:3457/game.html:929:28)
      at http://localhost:3457/game.html:1542:9
  ```
- **Root Cause**: `game.html` executes under `<script type="module">` (line 342), which enforces strict mode (`"use strict"`). The variables `viewmodelScene`, `viewmodelCamera`, and `viewmodelSprayCan` are assigned without declaration at lines 929, 930, 938:
  ```javascript
  928: function initViewmodelScene() {
  929:     viewmodelScene = new THREE.Scene();
  930:     viewmodelCamera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 10);
  ...
  938:     viewmodelSprayCan = createSprayCanViewmodel();
  ```
  Similarly, `viewmodelBobTime` (line 1007) and `sprayParticleTime` (line 1020) are modified without declaration (`viewmodelBobTime += 0.12`, `sprayParticleTime += 16`).
- **Mangled Function in Merge Commit `50f7488`**: Lines 543-560 in `game.html`:
  `function sprayAtTarget()` was corrupted by a merge conflict that replaced its body with orphaned camera pan interpolation code referencing undeclared `t`, `cameraPanStartYaw`, `cameraPanTargetYaw`, `cameraPanActive`. The original, correct implementation exists in commit `5304235` (lines 543-580).

### 1.2 Performance Bottleneck in Existing Collision Routine
- **Location**: `C:\Users\potat\kajm1ller.github.io-1\game.html:1118-1121`
- **Current Logic**:
  ```javascript
  for (let i = 0, len = collisionMeshes.length; i < len; i++) {
      const box = collisionMeshes[i].userData.worldBox;
      if (box && _playerBox.intersectsBox(box)) return true;
  }
  ```
  In lines 1488-1526, `generateWorld()` populates 80 trees, 40 large rocks, and 24 cluster rocks (~144 static AABBs).
  In Milestone 3 (50 vehicles), an unpartitioned check would perform $50 \times 144 = 7,200$ static checks plus $50 \times 50 = 2,500$ vehicle-to-vehicle checks per frame ($9,700$ checks/frame $\approx 582,000$ checks/sec at 60Hz), severely violating the 16.6ms frame budget.

### 1.3 Node.js & Module Compatibility
- **Node Version**: v24.12.0 installed.
- **Root `package.json`**: Root uses CommonJS (`server.js` uses `require('express')`).
- **Resolution**: A scoped `package.json` with `{"type": "module"}` inside `test/` or `js/game/` enables native ES module execution and `node --test` without modifying root `package.json` or breaking `server.js`.
- **Prototype Benchmark Result**: Running `spatialGrid.test.mjs` with 1,000 static obstacles and 100 dynamic entities:
  `10,000 spatial queries completed in 5.62ms (0.56µs per query)` with zero runtime heap allocations during queries.

---

## 2. Logic Chain

1. **Clean Boot Requirement**: Acceptance Criteria requires `game.html` to load cleanly with zero uncaught console errors. Fixing the undeclared module variables (`viewmodelScene`, `viewmodelCamera`, `viewmodelSprayCan`, `viewmodelBobTime`, `sprayParticleTime`) and restoring `sprayAtTarget` from commit `5304235` resolves the fatal boot exception and restores spray mechanics.
2. **Deterministic Execution for Headless Automation**: The existing game loop relies on variable `requestAnimationFrame(animate)` without timestep delta accumulation. To support automated test execution and stress benchmarking without race conditions or display refresh coupling:
   - A 60Hz fixed-timestep accumulator (`FIXED_DT = 1/60`, `MAX_ACCUMULATOR = 0.1`) must decouple physics from rendering.
   - `window.__GAME__.simulation` must provide `step(dt)` (advancing simulation ticks deterministically) and `setPaused(boolean)` (pausing automatic RAF accumulation during test-driven steps).
3. **Broadphase Scalability**: By partitioning the 600m world into $40 \times 40$ cells ($15\text{m}$ each) via `SpatialGrid`:
   - Static obstacles (trees, rocks, buildings) are inserted once into static cell arrays.
   - Dynamic entities insert into dynamic cell arrays each tick, and `clearDynamic()` clears only active dynamic cell buckets in $O(\text{active cells})$ without allocating new arrays.
   - Queries write directly into caller-provided arrays using an integer query ID tag (`_lastQueryId === queryId`) for instant deduplication, maintaining strictly 0 garbage-collection overhead.
4. **Integration Architecture**:
   - `game.html` remains the entry point (`<script type="importmap">` mapping bare `"three"` specifier, followed by `<script type="module" src="./js/game/main.js"></script>`).
   - All ES module imports must use explicit `.js` extensions (e.g. `import { SpatialGrid } from './spatialGrid.js'`) for cross-compatibility between modern browsers and Node.js.
   - `main.js` bootstraps the engine, initializes `SpatialGrid`, populates static map obstacles into the grid, binds the fixed-timestep loop, and attaches the complete `window.__GAME__` object.

---

## 3. Caveats

- **Scope Boundary**: Milestone 1 implements F1 (Startup fix), F2 (Fixed-timestep loop), F3 (2D SpatialGrid), and F4 (Testing API hook). Vehicle physics (F6), Road Network (F5), and Player Enter/Exit (F8) are scheduled for Milestone 2.
- **Contract Placeholders**: In Milestone 1, `window.__GAME__.player.getState()` returns `'ON_FOOT'`, `getVehicle()` returns `null`, `vehicles.getPlayerVehicle()` returns `null`, `vehicles.getTrafficVehicles()` returns `[]`, and `vehicles.getTrafficCount()` returns `0`. The API methods exist and adhere to the contract so test runners and downstream milestones have a stable target.
- **Memory Telemetry in Chromium**: `performance.memory` is non-standard but available in Chromium-based browsers (Chrome/Edge). If running in environments where it is undefined, `memoryGrowthBytes` defaults safely to `0`.

---

## 4. Conclusion & Concrete Recommendations

### 4.1 Concrete Contract for `window.__GAME__`
Place in `js/game/main.js`:
```javascript
window.__GAME__ = {
    version: '1.0.0-m1',
    isReady: false, // set to true once world generation and grid setup are finished
    
    player: {
        getState: () => (playerController ? playerController.getState() : 'ON_FOOT'),
        getPosition: () => ({ x: myPosition.x, y: myPosition.y, z: myPosition.z }),
        getVehicle: () => (playerController ? playerController.getVehicle() : null)
    },
    
    vehicles: {
        getPlayerVehicle: () => (playerController ? playerController.getVehicle() : null),
        getTrafficVehicles: () => (trafficManager ? trafficManager.getActiveVehicles() : []),
        getTrafficCount: () => (trafficManager ? trafficManager.getActiveVehicles().length : 0)
    },
    
    actions: {
        tryEnterVehicle: () => (playerController ? playerController.enterNearbyVehicle() : false),
        tryExitVehicle: () => (playerController ? playerController.exitVehicle() : false),
        setVehicleInput: (inputs) => {
            if (activeVehicle) activeVehicle.setInputs(inputs);
        },
        setPlayerInput: (keys) => {
            Object.assign(fpKeys, keys);
        }
    },
    
    simulation: {
        isPaused: false,
        setPaused: (paused) => { window.__GAME__.simulation.isPaused = !!paused; },
        step: (dt = 1 / 60) => {
            stepSimulation(dt);
        },
        runBenchmark: async (frameCount = 1000) => {
            const frameTimes = new Float32Array(frameCount);
            const startMem = (performance.memory && performance.memory.usedJSHeapSize) || 0;
            let totalTime = 0;
            let maxTime = 0;

            // Warm up
            for (let w = 0; w < 10; w++) {
                stepSimulation(1 / 60);
                render();
            }

            const tStart = performance.now();
            for (let i = 0; i < frameCount; i++) {
                const t0 = performance.now();
                stepSimulation(1 / 60);
                render();
                const dtMs = performance.now() - t0;
                
                frameTimes[i] = dtMs;
                totalTime += dtMs;
                if (dtMs > maxTime) maxTime = dtMs;

                if (i % 100 === 0) {
                    await new Promise(r => setTimeout(r, 0)); // yield to event loop
                }
            }
            const tEnd = performance.now();
            const endMem = (performance.memory && performance.memory.usedJSHeapSize) || 0;

            frameTimes.sort();
            const p95 = frameTimes[Math.floor(frameCount * 0.95)];
            const avg = totalTime / frameCount;

            return {
                avgFrameTimeMs: avg,
                maxFrameTimeMs: maxTime,
                p95FrameTimeMs: p95,
                memoryGrowthBytes: Math.max(0, endMem - startMem),
                fps: avg > 0 ? 1000 / avg : 60,
                frameCount,
                totalDurationMs: tEnd - tStart
            };
        }
    },
    
    spatialGrid: spatialGridInstance,
    raw: { scene, camera, renderer }
};
```

### 4.2 Module Structure & `game.html` Entry
1. **`js/game/config.js`**:
   Centralizes physics, grid, and performance parameters:
   ```javascript
   export const CONFIG = {
       WORLD_SIZE: 600,
       WORLD_BOUNDS: [-280, 280],
       CELL_SIZE: 15,
       FIXED_DT: 1 / 60,
       MAX_ACCUMULATOR: 0.1,
       PLAYER: {
           RADIUS: 0.4,
           EYE_HEIGHT: 1.7,
           MOVE_SPEED: 7.2 // m/s (equivalent to 0.12 * 60)
       }
   };
   ```
2. **`js/game/spatialGrid.js`**:
   Zero-allocation, $O(1)$ spatial hash grid using typed active cell index tracking and query ID deduplication (prototype fully validated in `.agents/teamwork/teamwork_preview_explorer_m1_3/spatialGrid.prototype.js`).
3. **`js/game/main.js`**:
   Instantiates `SpatialGrid`, sets up scene/camera/renderer, registers static obstacles, manages the fixed timestep loop, and publishes `window.__GAME__`.
4. **`game.html`**:
   Retains HUD, Canvas, and styles, imports `main.js`:
   ```html
   <script type="importmap">
   {
       "imports": {
           "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
           "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
       }
   }
   </script>
   <script type="module" src="./js/game/main.js"></script>
   ```

### 4.3 Proposed Patch for F1 Startup Defect (`game.html`)
- In module scope (top of viewmodel section):
  ```javascript
  let viewmodelScene, viewmodelCamera, viewmodelSprayCan;
  let viewmodelBobTime = 0;
  let sprayParticleTime = 0;
  ```
- Replace corrupted lines 543-560 in `sprayAtTarget` with the verified implementation from commit `5304235`:
  ```javascript
  function sprayAtTarget() {
      const now = Date.now();
      if (now - lastSprayTime < sprayRate) return;
      lastSprayTime = now;
      
      sprayRaycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      sprayRaycaster.far = 20;
      const intersects = sprayRaycaster.intersectObjects(sprayTargetMeshes, false);
      if (intersects.length === 0) return;
      
      const hit = intersects[0];
      if (!hit.face) return;
      
      const normal = hit.face.normal.clone();
      if (hit.object.matrixWorld) {
          const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
          normal.applyMatrix3(normalMatrix).normalize();
      }
      
      const jitter = spraySize * 0.3;
      const tangent = new THREE.Vector3().crossVectors(normal, new THREE.Vector3(0, 1, 0));
      if (tangent.length() < 0.01) tangent.crossVectors(normal, new THREE.Vector3(1, 0, 0));
      tangent.normalize();
      const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
      
      const offsetX = (Math.random() - 0.5) * jitter;
      const offsetY = (Math.random() - 0.5) * jitter;
      const sprayPos = hit.point.clone()
          .add(normal.clone().multiplyScalar(0.01))
          .add(tangent.clone().multiplyScalar(offsetX))
          .add(bitangent.clone().multiplyScalar(offsetY));
      
      const sizeVariation = spraySize * (0.7 + Math.random() * 0.6);
      const decalMat = new THREE.MeshBasicMaterial({
          color: currentSprayColor,
          map: sprayTexture,
          transparent: true,
          opacity: 0.6 + Math.random() * 0.3,
          depthWrite: false,
          side: THREE.DoubleSide
      });
      const decal = new THREE.Mesh(sharedDecalGeo, decalMat);
      decal.scale.set(sizeVariation, sizeVariation, 1);
      decal.position.copy(sprayPos);
      decal.lookAt(sprayPos.clone().add(normal));
      decal.rotateZ(Math.random() * Math.PI * 2);
      scene.add(decal);
      sprayDecals.push(decal);
      if (sprayDecals.length > maxDecals) {
          const old = sprayDecals.shift();
          scene.remove(old);
          old.material.dispose();
      }
  }
  ```

---

## 5. Verification Method

### 5.1 Automated Unit Tests (Node.js)
Execute the unit test suite with Node's built-in test runner:
```powershell
node --test .agents/teamwork/teamwork_preview_explorer_m1_3/spatialGrid.test.mjs
node --test .agents/teamwork/teamwork_preview_explorer_m1_3/gameApi.test.mjs
```
**Expected Output**:
- 6/6 tests passing in `spatialGrid.test.mjs` with 10,000 queries in < 10ms.
- 1/1 tests passing in `gameApi.test.mjs` verifying contract conformancy.

### 5.2 Headless Browser Zero-Error Boot Test
Run the CDP test runner against headless Chrome or Edge:
```powershell
node .agents/teamwork/teamwork_preview_explorer_m1_3/verify_headless_boot.js
```
**Pass Criteria**: Zero `[BROWSER EXCEPTION]` events, zero `[BROWSER CONSOLE] error` messages, and `window.__GAME__.isReady === true`.

### 5.3 Invalidation Conditions
- If any dynamic entity query allocates new memory in the inner loop (e.g. creating intermediate arrays or `Set` objects).
- If `window.__GAME__.simulation.step()` mutates state non-deterministically between runs with identical inputs.
- If importing `js/game/main.js` from `game.html` throws any MIME type, CORS, or module path resolution error in a clean headless browser boot.
