/**
 * E2E Functional Test Suite for Kaj Simulator Vehicle & AI Traffic System
 * 
 * Tests Acceptance Criteria:
 * 1. Clean startup: game.html loads with zero uncaught console errors or page exceptions.
 * 2. /mapfinal map loading & spatial collision registration:
 *    - Verify window.__GAME__.map.isLoaded === true and model parts mounted into scene
 *    - Verify building collision bounding boxes registered in spatialGrid
 * 3. Kaj Simulator Honda Civic car basis & HUD:
 *    - Verify car mesh structure contains Honda Civic components (sedan body, cabin, windshield, headlights, taillights, 4 wheels)
 *    - Verify HUD elements #car-indicator and #car-speed-hud reflect vehicle speed and boarding state
 * 4. Player vehicle interaction:
 *    - Enter nearby vehicle
 *    - Accelerate and steer (position & yaw delta)
 *    - Collide with obstacle without NaN / infinite corruption
 *    - Clean exit back to on-foot state
 * 5. AI traffic navigation:
 *    - Fleet spawn & active progression along paths
 *    - Zero permanent deadlocks or invalid vehicle overlaps
 * 6. Adversarial & boundary resilience:
 *    - Rapid contradictory control inputs
 *    - Safe boundary enforcement
 */

const path = require('path');
const { createHarness } = require('./harness.js');

class TestContext {
  constructor(suiteName) {
    this.suiteName = suiteName;
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
    this.skipped = 0;
    this.errors = [];
  }

  async test(name, fn) {
    const start = Date.now();
    try {
      await fn();
      const duration = Date.now() - start;
      this.passed++;
      this.tests.push({ name, status: 'PASS', duration });
      console.log(`  \x1b[32m✔\x1b[0m ${name} (${duration}ms)`);
    } catch (err) {
      const duration = Date.now() - start;
      this.failed++;
      this.tests.push({ name, status: 'FAIL', duration, error: err.message });
      this.errors.push({ name, error: err });
      console.log(`  \x1b[31m✖\x1b[0m ${name} (${duration}ms)`);
      console.log(`    \x1b[31mError: ${err.message}\x1b[0m`);
    }
  }

  skip(name, reason) {
    this.skipped++;
    this.tests.push({ name, status: 'SKIP', reason });
    console.log(`  \x1b[33m- [SKIPPED]\x1b[0m ${name}: ${reason}`);
  }

  summary() {
    console.log(`\n--- ${this.suiteName} Results ---`);
    console.log(`Total: ${this.tests.length} | Passed: \x1b[32m${this.passed}\x1b[0m | Failed: \x1b[31m${this.failed}\x1b[0m | Skipped: \x1b[33m${this.skipped}\x1b[0m`);
    return {
      name: this.suiteName,
      passed: this.passed,
      failed: this.failed,
      skipped: this.skipped,
      total: this.tests.length,
      tests: this.tests,
      errors: this.errors
    };
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message ? message + ' - ' : ''}Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertFiniteNumber(value, name) {
  assert(
    typeof value === 'number' && Number.isFinite(value) && !Number.isNaN(value),
    `Expected ${name} to be a finite number, got ${value}`
  );
}

/**
 * Run the E2E Functional Test Suite
 * @param {object} options
 * @returns {Promise<{ passed: number, failed: number, skipped: number, total: number }>}
 */
async function runFunctionalTests(options = {}) {
  const browserType = options.browser || 'auto';
  const targetPage = options.targetPage || 'game.html';
  console.log(`\n======================================================`);
  console.log(`Running E2E Functional Test Suite (Target: ${targetPage}, Browser: ${browserType})`);
  console.log(`======================================================\n`);

  const ctx = new TestContext('E2E Functional Tests');
  const harness = createHarness({
    browser: browserType,
    headless: options.headless !== false,
    verbose: options.verbose || false
  });

  try {
    console.log('[Setup] Launching browser and establishing CDP session...');
    await harness.start();

    // ------------------------------------------------------------------------
    // Test 1: Clean Startup Acceptance Criteria
    // ------------------------------------------------------------------------
    await ctx.test(`Startup: ${targetPage} loads with zero uncaught console errors or page exceptions`, async () => {
      harness.clearLogs();
      await harness.navigate(targetPage, { timeout: 15000, waitUntil: 'load' });

      // Give scripts a moment to initialize
      await new Promise(r => setTimeout(r, 1000));

      const exceptions = harness.getExceptions();
      const consoleErrors = harness.getConsoleErrors();

      if (exceptions.length > 0) {
        const errorDescriptions = exceptions.map(e => `[line ${e.lineNumber}] ${e.description}`).join('; ');
        throw new Error(`Page threw uncaught exceptions: ${errorDescriptions}`);
      }

      if (consoleErrors.length > 0) {
        const errorTexts = consoleErrors.map(e => e.text).join('; ');
        throw new Error(`Console logged error messages: ${errorTexts}`);
      }

      // Verify DOM canvas mounted
      const hasCanvas = await harness.evaluate(() => {
        const canvas = document.querySelector('canvas');
        return !!canvas && canvas.width > 0 && canvas.height > 0;
      });
      assert(hasCanvas, 'Three.js WebGL canvas element must be mounted in DOM');

      // Verify Testing API exposed
      const gameApiPresent = await harness.evaluate(() => {
        return typeof window.__GAME__ === 'object' && window.__GAME__ !== null;
      });
      assert(gameApiPresent, 'window.__GAME__ automation API must be exposed on window');

      // Verify game isReady
      const isReady = await harness.evaluate(() => window.__GAME__.isReady === true);
      assert(isReady, 'window.__GAME__.isReady must be true after game initialization');
    });

    // Check if vehicle system is ready before attempting downstream vehicle interaction tests (pending Milestone 2)
    const canTestGameApi = await harness.evaluate(() => {
      return typeof window.__GAME__ === 'object' && window.__GAME__ !== null && window.__GAME__.isReady === true && window.__GAME__.hasVehicles === true;
    }).catch(() => false);

    if (!canTestGameApi) {
      const reason = 'Vehicle mechanics and AI traffic are pending Milestone 2 & 3';
      ctx.skip('Player Vehicle: Player boards nearby vehicle and switches state to IN_VEHICLE', reason);
      ctx.skip('Player Vehicle: Throttle and steering update vehicle position and yaw', reason);
      ctx.skip('Player Vehicle: Obstacle collision preserves state without NaN/infinite values', reason);
      ctx.skip('Player Vehicle: Clean vehicle exit returns player to on-foot state adjacent to vehicle', reason);
      ctx.skip('AI Traffic: Multi-vehicle fleet spawns and progresses along road network', reason);
      ctx.skip('AI Traffic: Vehicles maintain collision spacing with zero overlaps or permanent deadlocks', reason);
      ctx.skip('Adversarial: Contradictory driving inputs handled gracefully without desync', reason);
      ctx.skip('Adversarial: No invisible walls inside the map; vehicles stay within the map edge', reason);

      await harness.close();
      return ctx.summary();
    }

    const isStrict = options.strict || process.argv.includes('--strict');

    // ========================================================================
    // TIER: /mapfinal Map Loading & Spatial Collision Registration
    // ========================================================================
    const hasMapSystem = await harness.evaluate(() => {
      return typeof window.__GAME__ === 'object' && window.__GAME__ !== null && !!window.__GAME__.map;
    }).catch(() => false);

    if (hasMapSystem || isStrict) {
      await ctx.test('Map: /mapfinal loads every part and texture and mounts the map tiles into scene', async () => {
        await harness.waitForFunction(
          () => typeof window.__GAME__ === 'object' && window.__GAME__.map && window.__GAME__.map.isLoaded === true,
          { timeout: 600000, pollInterval: 1000 }
        );

        const mapStatus = await harness.evaluate(() => {
          const map = window.__GAME__.map;
          if (!map) return { hasMap: false };
          const scene = (window.__GAME__.raw && window.__GAME__.raw.scene) || null;

          let partsCount = 0;
          if (map.parts && Array.isArray(map.parts)) {
            partsCount = map.parts.length;
          } else if (typeof map.loadedPartsCount === 'number') {
            partsCount = map.loadedPartsCount;
          }

          let mountedSceneCount = 0;
          let hasOldProceduralGround = false;
          let hasOldProceduralRoads = false;
          let hasTerrainParts = false;
          if (scene && scene.children) {
            scene.traverse(obj => {
              const name = (obj.name || '').toLowerCase();
              if (name === 'ground') hasOldProceduralGround = true;
              if (name === 'road_asphalt_mesh' || name === 'road_markings_mesh') hasOldProceduralRoads = true;
              if (obj.userData && obj.userData.isTerrainTile) hasTerrainParts = true;
              if (
                name.includes('part') || name.includes('map') || name.includes('anothermapo') ||
                (obj.userData && (obj.userData.isMapPart || obj.userData.partName || obj.userData.isMap))
              ) {
                mountedSceneCount++;
              }
            });
          }

          return {
            hasMap: true,
            isLoaded: map.isLoaded,
            partsCount,
            totalParts: map.totalParts,
            failedParts: map.failedParts || [],
            textureFailures: map.textureFailures || [],
            hasAllTerrainParts: Array.isArray(map.parts) &&
              Array.from({ length: 27 }, (_, i) => `part${String(594 + i).padStart(4, '0')}.obj`).every(n => map.parts.includes(n)),
            mountedSceneCount,
            hasOldProceduralGround,
            hasOldProceduralRoads,
            hasTerrainParts,
            hasScene: !!scene
          };
        });

        assert(mapStatus.hasMap, 'window.__GAME__.map must be defined');
        assertEqual(mapStatus.isLoaded, true, 'window.__GAME__.map.isLoaded must be true');
        assert(!mapStatus.hasOldProceduralGround, 'Old procedural ground plane must be removed');
        assert(!mapStatus.hasOldProceduralRoads, 'Old procedural road meshes must be removed');
        assert(mapStatus.hasTerrainParts, '/mapfinal terrain tiles must be mounted');
        assert(mapStatus.hasAllTerrainParts, '/mapfinal terrain parts (part0594.obj .. part0620.obj) must all be loaded');
        assertEqual(mapStatus.totalParts, 621, '/mapfinal must request every part (part0000.obj .. part0620.obj)');
        assertEqual(mapStatus.partsCount, mapStatus.totalParts, 'Every /mapfinal part must load');
        assertEqual(mapStatus.failedParts.length, 0, `No /mapfinal parts may fail to load (failed: ${mapStatus.failedParts.join(', ')})`);
        assertEqual(mapStatus.textureFailures.length, 0, `No /mapfinal textures may fail to load (failed: ${mapStatus.textureFailures.join(', ')})`);
        assert(
          mapStatus.partsCount > 0 || mapStatus.mountedSceneCount > 0,
          `Map model parts must be loaded and mounted into scene (partsCount: ${mapStatus.partsCount}, mountedSceneCount: ${mapStatus.mountedSceneCount})`
        );
      });

      await ctx.test('Map: /mapfinal building collision bounding boxes are registered in spatialGrid', async () => {
        const gridReport = await harness.evaluate(() => {
          const grid = window.__GAME__.spatialGrid;
          if (!grid || !grid.cells) {
            return { hasGrid: false };
          }

          const seenIds = new Set();
          const buildingObstacles = [];
          let invalidBoxCount = 0;

          for (const cell of grid.cells) {
            for (const item of cell.staticItems) {
              if (!seenIds.has(item.id)) {
                seenIds.add(item.id);
                const isBuilding = (item.userData && (item.userData.type === 'building' || item.userData.isBuilding)) ||
                                   (typeof item.id === 'string' && (item.id.includes('building') || item.id.includes('part')));

                if (isBuilding) {
                  const b = item.box || (item.userData && item.userData.worldBox);
                  if (b && b.min && b.max) {
                    const valid = Number.isFinite(b.min.x) && Number.isFinite(b.max.x) &&
                                  Number.isFinite(b.min.z) && Number.isFinite(b.max.z) &&
                                  b.max.x >= b.min.x && b.max.z >= b.min.z;
                    if (valid) {
                      buildingObstacles.push({
                        id: item.id,
                        minX: b.min.x,
                        maxX: b.max.x,
                        minZ: b.min.z,
                        maxZ: b.max.z,
                        height: b.max.y !== undefined && b.min.y !== undefined ? (b.max.y - b.min.y) : (item.userData.height || 0)
                      });
                    } else {
                      invalidBoxCount++;
                    }
                  }
                }
              }
            }
          }

          let testQueryCount = 0;
          if (buildingObstacles.length > 0) {
            const first = buildingObstacles[0];
            const qx = (first.minX + first.maxX) * 0.5;
            const qz = (first.minZ + first.maxZ) * 0.5;
            const qOut = [];
            grid.queryRadius(qx, qz, 10.0, qOut);
            testQueryCount = qOut.length;
          }

          return {
            hasGrid: true,
            totalStaticItems: seenIds.size,
            buildingCount: buildingObstacles.length,
            invalidBoxCount,
            testQueryCount
          };
        });

        assert(gridReport.hasGrid, 'window.__GAME__.spatialGrid must be initialized');
        assert(
          gridReport.buildingCount > 0,
          `Building collision bounding boxes must be registered in spatialGrid (found ${gridReport.buildingCount} building obstacles)`
        );
        assertEqual(gridReport.invalidBoxCount, 0, 'All registered building bounding boxes must have valid finite extents');
        assert(gridReport.testQueryCount > 0, 'spatialGrid.queryRadius() must retrieve registered building collision obstacles');
      });
    } else {
      const mapReason = '/mapfinal map loader pending implementation in game.html';
      ctx.skip('Map: /mapfinal loads every part and texture and mounts the map tiles into scene', mapReason);
      ctx.skip('Map: /mapfinal building collision bounding boxes are registered in spatialGrid', mapReason);
    }

    // ========================================================================
    // TIER: Kaj Simulator Honda Civic Car Basis & HUD Verification
    // ========================================================================
    const hasCivicMesh = await harness.evaluate(() => {
      const v = (window.__GAME__.vehicles && window.__GAME__.vehicles.getPlayerVehicle()) ||
                (window.__GAME__.player && window.__GAME__.player.getVehicle());
      if (!v || !v.mesh) return false;
      const mesh = v.mesh;
      const name = (mesh.name || '').toLowerCase();
      return v.isHondaCivic === true ||
             name.includes('civic') ||
             (mesh.userData && mesh.userData.isHondaCivic === true) ||
             (mesh.children && mesh.children.some(c => (c.name || '').includes('windshield') || (c.name || '').includes('sedan')));
    }).catch(() => false);

    if (hasCivicMesh || isStrict) {
      await ctx.test('Honda Civic: Vehicle mesh hierarchy contains authentic Kaj Simulator components', async () => {
        const meshStructure = await harness.evaluate(() => {
          const v = (window.__GAME__.vehicles && window.__GAME__.vehicles.getPlayerVehicle()) ||
                    (window.__GAME__.player && window.__GAME__.player.getVehicle());
          if (!v || !v.mesh) {
            return { hasMesh: false };
          }

          const mesh = v.mesh;
          let hasBody = false;
          let hasCabin = false;
          let hasWindshield = false;
          let headlightCount = 0;
          let taillightCount = 0;
          let wheelCount = 0;

          mesh.traverse(child => {
            const name = (child.name || '').toLowerCase();
            // Sedan body / chassis
            if (name.includes('body') || name.includes('chassis') || (child.geometry && child.geometry.type === 'BoxGeometry' && child.position.y < 0.8)) {
              hasBody = true;
            }
            // Cabin / roof
            if (name.includes('cabin') || name.includes('roof') || (child.geometry && child.geometry.type === 'BoxGeometry' && child.position.y > 0.9)) {
              hasCabin = true;
            }
            // Windshield (front glass)
            if (name.includes('windshield') || (name.includes('glass') && child.position.z < 0) || (child.material && (child.material.transparent || (child.material.opacity !== undefined && child.material.opacity < 1.0)) && child.position.z < 0)) {
              hasWindshield = true;
            }
            // Headlights
            if (name.includes('headlight') || name.includes('lighthead') || (name.includes('light') && child.position.z < 0)) {
              headlightCount++;
            }
            // Taillights
            if (name.includes('taillight') || name.includes('lighttail') || (name.includes('light') && child.position.z > 0)) {
              taillightCount++;
            }
            // Wheels
            if (name.includes('wheel') || (child.geometry && child.geometry.type && child.geometry.type.includes('Cylinder'))) {
              wheelCount++;
            }
          });

          if (v.wheels) {
            const keys = Object.keys(v.wheels);
            if (keys.length >= 4) wheelCount = Math.max(wheelCount, keys.length);
          }

          return {
            hasMesh: true,
            hasBody,
            hasCabin,
            hasWindshield,
            headlightCount,
            taillightCount,
            wheelCount
          };
        });

        assert(meshStructure.hasMesh, 'Player vehicle 3D mesh must be mounted');
        assert(meshStructure.hasBody, 'Vehicle mesh must contain sedan body/chassis component');
        assert(meshStructure.hasCabin, 'Vehicle mesh must contain cabin/roof component');
        assert(meshStructure.hasWindshield, 'Vehicle mesh must contain windshield/glass component');
        assert(meshStructure.headlightCount >= 2, `Vehicle mesh must contain at least 2 headlights (found ${meshStructure.headlightCount})`);
        assert(meshStructure.taillightCount >= 2, `Vehicle mesh must contain at least 2 taillights (found ${meshStructure.taillightCount})`);
        assert(meshStructure.wheelCount >= 4, `Vehicle mesh must contain 4 wheels (found ${meshStructure.wheelCount})`);
      });
    } else {
      ctx.skip('Honda Civic: Vehicle mesh hierarchy contains authentic Kaj Simulator components', 'Kaj Simulator Honda Civic car basis pending integration into vehicle.js');
    }

    const hasCarHud = await harness.evaluate(() => {
      return !!document.getElementById('car-indicator') && !!document.getElementById('car-speed-hud');
    }).catch(() => false);

    if (hasCarHud || isStrict) {
      await ctx.test('Honda Civic: HUD elements #car-indicator and #car-speed-hud reflect vehicle speed and boarding state', async () => {
        // 1. Initial State (ON_FOOT near car)
        const initialHud = await harness.evaluate(() => {
          const indicator = document.getElementById('car-indicator');
          const speedHud = document.getElementById('car-speed-hud');
          const speedVal = document.getElementById('car-speed-val');
          return {
            hasIndicator: !!indicator,
            hasSpeedHud: !!speedHud,
            hasSpeedVal: !!speedVal,
            indicatorVisible: indicator ? window.getComputedStyle(indicator).display !== 'none' : false,
            indicatorText: indicator ? indicator.innerText || indicator.textContent : '',
            speedHudVisible: speedHud ? window.getComputedStyle(speedHud).display !== 'none' : false
          };
        });

        assert(initialHud.hasIndicator, 'DOM element #car-indicator must exist');
        assert(initialHud.hasSpeedHud, 'DOM element #car-speed-hud must exist');
        assert(initialHud.indicatorVisible, '#car-indicator must be visible when player is near car on-foot');
        assert(initialHud.indicatorText.includes('Enter'), `#car-indicator text must contain 'Enter' (got: "${initialHud.indicatorText}")`);
        assert(!initialHud.speedHudVisible, '#car-speed-hud must be hidden when on-foot');

        // 2. Board Vehicle
        const entered = await harness.evaluate(() => window.__GAME__.actions.tryEnterVehicle());
        assert(entered, 'Player enters vehicle');

        // Verify HUD in vehicle
        const boardedHud = await harness.evaluate(() => {
          const indicator = document.getElementById('car-indicator');
          const speedHud = document.getElementById('car-speed-hud');
          const speedVal = document.getElementById('car-speed-val');
          return {
            indicatorVisible: indicator ? window.getComputedStyle(indicator).display !== 'none' : true,
            speedHudVisible: speedHud ? window.getComputedStyle(speedHud).display !== 'none' : false,
            speedText: speedVal ? speedVal.innerText || speedVal.textContent : (speedHud ? speedHud.innerText : '')
          };
        });

        assert(!boardedHud.indicatorVisible, '#car-indicator must be hidden when driving');
        assert(boardedHud.speedHudVisible, '#car-speed-hud must be visible when driving');

        // 3. Accelerate and test speed reflection
        await harness.evaluate(() => {
          window.__GAME__.actions.setVehicleInput({ w: true, a: false, s: false, d: false, space: false });
          for (let i = 0; i < 60; i++) {
            window.__GAME__.simulation.step(1 / 60);
          }
          window.__GAME__.actions.setVehicleInput({ w: false, a: false, s: false, d: false, space: false });
        });

        const movingHud = await harness.evaluate(() => {
          const v = window.__GAME__.player.getVehicle();
          const speedMps = v.getSpeed ? v.getSpeed() : 0;
          const speedVal = document.getElementById('car-speed-val');
          const speedHud = document.getElementById('car-speed-hud');
          const rawVal = speedVal ? speedVal.innerText || speedVal.textContent : (speedHud ? speedHud.innerText : '');
          const numericSpeed = parseFloat(rawVal.replace(/[^0-9.]/g, '')) || 0;
          return {
            speedMps,
            rawVal,
            numericSpeed
          };
        });

        assert(movingHud.speedMps > 0.5, `Vehicle physical speed must be > 0.5 m/s (got ${movingHud.speedMps.toFixed(2)})`);
        assert(
          movingHud.numericSpeed > 0,
          `#car-speed-hud must display non-zero speed value while moving (got: "${movingHud.rawVal}", parsed: ${movingHud.numericSpeed})`
        );

        // 4. Clean exit and verify HUD returns to on-foot state
        await harness.evaluate(() => window.__GAME__.actions.tryExitVehicle());

        const postExitHud = await harness.evaluate(() => {
          const indicator = document.getElementById('car-indicator');
          const speedHud = document.getElementById('car-speed-hud');
          return {
            speedHudVisible: speedHud ? window.getComputedStyle(speedHud).display !== 'none' : true,
            indicatorVisible: indicator ? window.getComputedStyle(indicator).display !== 'none' : false
          };
        });

        assert(!postExitHud.speedHudVisible, '#car-speed-hud must be hidden after exiting vehicle');
        assert(postExitHud.indicatorVisible, '#car-indicator must reappear when adjacent to vehicle on-foot');
      });
    } else {
      ctx.skip('Honda Civic: HUD elements #car-indicator and #car-speed-hud reflect vehicle speed and boarding state', 'Honda Civic HUD elements pending integration into game.html');
    }

    // ------------------------------------------------------------------------
    // Test: Player Vehicle Interaction - Boarding
    // ------------------------------------------------------------------------
    await ctx.test('Player Vehicle: Player boards nearby vehicle and switches state to IN_VEHICLE', async () => {
      // Check initial state is ON_FOOT
      const initialState = await harness.evaluate(() => window.__GAME__.player.getState());
      assertEqual(initialState, 'ON_FOOT', 'Initial player state must be ON_FOOT');

      // Check player initial position
      const initialPos = await harness.evaluate(() => window.__GAME__.player.getPosition());
      assertFiniteNumber(initialPos.x, 'initialPos.x');
      assertFiniteNumber(initialPos.y, 'initialPos.y');
      assertFiniteNumber(initialPos.z, 'initialPos.z');

      // Attempt to enter vehicle
      const entered = await harness.evaluate(() => window.__GAME__.actions.tryEnterVehicle());
      assert(entered, 'window.__GAME__.actions.tryEnterVehicle() must return true when near vehicle');

      // Verify state changed to IN_VEHICLE
      const newState = await harness.evaluate(() => window.__GAME__.player.getState());
      assertEqual(newState, 'IN_VEHICLE', 'Player state must transition to IN_VEHICLE');

      // Verify player vehicle reference exists
      const hasVehicle = await harness.evaluate(() => {
        const v = window.__GAME__.player.getVehicle();
        return v !== null && typeof v === 'object';
      });
      assert(hasVehicle, 'window.__GAME__.player.getVehicle() must return the active Vehicle');
    });

    // ------------------------------------------------------------------------
    // Test 3: Player Vehicle Interaction - Driving Controls (Throttle & Steering)
    // ------------------------------------------------------------------------
    await ctx.test('Player Vehicle: Throttle and steering update vehicle position and yaw', async () => {
      // Record starting pose
      const startPose = await harness.evaluate(() => {
        const v = window.__GAME__.player.getVehicle();
        const pos = v.getPosition();
        return { x: pos.x, z: pos.z, yaw: v.getYaw() };
      });

      // Apply forward throttle (W) and steer left (A)
      await harness.evaluate(() => {
        window.__GAME__.actions.setVehicleInput({ w: true, a: true, s: false, d: false, space: false });
      });

      // Step simulation for 60 ticks (1.0 second at 60Hz)
      await harness.evaluate(() => {
        for (let i = 0; i < 60; i++) {
          window.__GAME__.simulation.step(1 / 60);
        }
      });

      // Release inputs
      await harness.evaluate(() => {
        window.__GAME__.actions.setVehicleInput({ w: false, a: false, s: false, d: false, space: false });
      });

      // Query new pose
      const endPose = await harness.evaluate(() => {
        const v = window.__GAME__.player.getVehicle();
        const pos = v.getPosition();
        return {
          x: pos.x,
          z: pos.z,
          yaw: v.getYaw(),
          speed: v.getSpeed ? v.getSpeed() : 0
        };
      });

      assertFiniteNumber(endPose.x, 'endPose.x');
      assertFiniteNumber(endPose.z, 'endPose.z');
      assertFiniteNumber(endPose.yaw, 'endPose.yaw');

      // Verify position displaced
      const dx = endPose.x - startPose.x;
      const dz = endPose.z - startPose.z;
      const distanceTraveled = Math.sqrt(dx * dx + dz * dz);
      assert(
        distanceTraveled > 0.5,
        `Vehicle should displace forward after 60 ticks of throttle (traveled: ${distanceTraveled.toFixed(2)}m)`
      );

      // Verify yaw changed due to steering
      const yawDelta = Math.abs(endPose.yaw - startPose.yaw);
      assert(
        yawDelta > 0.02,
        `Vehicle yaw should rotate during steering (delta: ${yawDelta.toFixed(3)} rad)`
      );
    });

    // ------------------------------------------------------------------------
    // Test 4: Player Vehicle Interaction - Obstacle Collision & NaN Guard
    // ------------------------------------------------------------------------
    await ctx.test('Player Vehicle: Obstacle collision preserves state without NaN/infinite values', async () => {
      // Simulate heavy acceleration and collision into an obstacle or boundary
      const collisionResult = await harness.evaluate(() => {
        const v = window.__GAME__.player.getVehicle();

        // Drive forward aggressively for 120 ticks
        window.__GAME__.actions.setVehicleInput({ w: true, a: false, s: false, d: false, space: false });
        for (let i = 0; i < 120; i++) {
          window.__GAME__.simulation.step(1 / 60);
        }
        window.__GAME__.actions.setVehicleInput({ w: false, a: false, s: false, d: false, space: false });

        const pos = v.getPosition();
        const vel = v.getVelocity ? v.getVelocity() : { x: 0, z: 0 };
        return {
          x: pos.x,
          y: pos.y,
          z: pos.z,
          vx: vel.x,
          vz: vel.z,
          yaw: v.getYaw()
        };
      });

      assertFiniteNumber(collisionResult.x, 'collisionResult.x');
      assertFiniteNumber(collisionResult.y, 'collisionResult.y');
      assertFiniteNumber(collisionResult.z, 'collisionResult.z');
      assertFiniteNumber(collisionResult.vx, 'collisionResult.vx');
      assertFiniteNumber(collisionResult.vz, 'collisionResult.vz');
      assertFiniteNumber(collisionResult.yaw, 'collisionResult.yaw');

      // Bounds sanity check
      assert(
        Math.abs(collisionResult.x) <= 280 && Math.abs(collisionResult.z) <= 280,
        `Vehicle position must stay within world bounds [-280, 280], got (${collisionResult.x}, ${collisionResult.z})`
      );
    });

    // ------------------------------------------------------------------------
    // Test 5: Player Vehicle Interaction - Clean Vehicle Exit
    // ------------------------------------------------------------------------
    await ctx.test('Player Vehicle: Clean vehicle exit returns player to on-foot state adjacent to vehicle', async () => {
      // Get vehicle position before exit
      const vehiclePos = await harness.evaluate(() => {
        return window.__GAME__.player.getVehicle().getPosition();
      });

      // Attempt exit
      const exitSuccess = await harness.evaluate(() => window.__GAME__.actions.tryExitVehicle());
      assert(exitSuccess, 'tryExitVehicle() must return true');

      // Verify state changed back to ON_FOOT
      const postState = await harness.evaluate(() => window.__GAME__.player.getState());
      assertEqual(postState, 'ON_FOOT', 'Player state must revert to ON_FOOT');

      // Verify player vehicle reference is cleared
      const postVehicle = await harness.evaluate(() => window.__GAME__.player.getVehicle());
      assertEqual(postVehicle, null, 'Active vehicle must be null after exiting');

      // Verify player position is placed adjacent to vehicle (within 0.5m - 5.0m)
      const playerPos = await harness.evaluate(() => window.__GAME__.player.getPosition());
      assertFiniteNumber(playerPos.x, 'playerPos.x');
      assertFiniteNumber(playerPos.z, 'playerPos.z');

      const dx = playerPos.x - vehiclePos.x;
      const dz = playerPos.z - vehiclePos.z;
      const distFromVehicle = Math.sqrt(dx * dx + dz * dz);
      assert(
        distFromVehicle >= 0.5 && distFromVehicle <= 5.0,
        `Exit position must be placed safely beside the vehicle (0.5m - 5.0m), was ${distFromVehicle.toFixed(2)}m`
      );

      // Verify getNearbyVehicle and getNearestVehicle API aliases detect vehicle in range
      const nearbyVehicles = await harness.evaluate(() => {
        const vNearby = window.__GAME__.vehicles.getNearbyVehicle ? window.__GAME__.vehicles.getNearbyVehicle() : null;
        const vNearest = window.__GAME__.vehicles.getNearestVehicle ? window.__GAME__.vehicles.getNearestVehicle() : null;
        return {
          hasNearby: vNearby !== null,
          hasNearest: vNearest !== null
        };
      });
      assert(nearbyVehicles.hasNearby, 'vehicles.getNearbyVehicle() should find vehicle within interaction range');
      assert(nearbyVehicles.hasNearest, 'vehicles.getNearestVehicle() alias should find vehicle within interaction range');

      // Verify disembark position remains safely placed across multiple animation frames (RAF and simulation steps)
      await new Promise(r => setTimeout(r, 120));
      await harness.evaluate(() => {
        for (let i = 0; i < 30; i++) {
          window.__GAME__.simulation.step(1 / 60);
        }
      });
      const playerPosPostRaf = await harness.evaluate(() => window.__GAME__.player.getPosition());
      assertFiniteNumber(playerPosPostRaf.x, 'playerPosPostRaf.x');
      assertFiniteNumber(playerPosPostRaf.z, 'playerPosPostRaf.z');

      const dxPost = playerPosPostRaf.x - vehiclePos.x;
      const dzPost = playerPosPostRaf.z - vehiclePos.z;
      const distPostRaf = Math.sqrt(dxPost * dxPost + dzPost * dzPost);
      assert(
        distPostRaf >= 0.5 && distPostRaf <= 5.0,
        `Exit position must remain safely placed beside vehicle across animation frames (0.5m - 5.0m), was ${distPostRaf.toFixed(2)}m`
      );

      // Park disembarked vehicle safely back at its spawn zone so it does not bottleneck AI traffic in downstream tests
      await harness.evaluate(() => {
        const v = window.__GAME__.vehicles.getPlayerVehicle();
        if (v) {
          v.position.set(-118, 0, 66);
          if (v.lastSafePosition) v.lastSafePosition.set(-118, 0, 66);
          v.speed = 0;
          v.velocity.set(0, 0);
          v.yaw = 0;
          if (v.mesh) v.mesh.position.set(-118, 0, 66);
          window.__GAME__.player.setPosition(-120, 0, 66);
        }
      });
    });

    // ------------------------------------------------------------------------
    // Test 6: AI Traffic - Fleet Spawn & Progression
    // ------------------------------------------------------------------------
    await ctx.test('AI Traffic: Multi-vehicle fleet spawns and progresses along road network', async () => {
      // Query initial traffic count
      const trafficCount = await harness.evaluate(() => window.__GAME__.vehicles.getTrafficCount());
      assert(trafficCount >= 10, `Expected at least 10 active traffic vehicles, got ${trafficCount}`);

      // Snapshot starting positions of all vehicles
      const initialPositions = await harness.evaluate(() => {
        return window.__GAME__.vehicles.getTrafficVehicles().map(v => {
          const p = v.getPosition();
          return { x: p.x, z: p.z };
        });
      });

      // Step simulation for 360 ticks (6 seconds at 60Hz)
      await harness.evaluate(() => {
        for (let i = 0; i < 360; i++) {
          window.__GAME__.simulation.step(1 / 60);
        }
      });

      // Snapshot new positions
      const newPositions = await harness.evaluate(() => {
        return window.__GAME__.vehicles.getTrafficVehicles().map(v => {
          const p = v.getPosition();
          return { x: p.x, z: p.z };
        });
      });

      // Verify vehicles progressed
      let movingCount = 0;
      let totalDisplacement = 0;
      for (let i = 0; i < initialPositions.length; i++) {
        const dx = newPositions[i].x - initialPositions[i].x;
        const dz = newPositions[i].z - initialPositions[i].z;
        const d = Math.sqrt(dx * dx + dz * dz);
        totalDisplacement += d;
        if (d > 1.0) movingCount++;
      }

      assert(
        movingCount >= Math.floor(initialPositions.length * 0.7),
        `At least 70% of traffic vehicles must actively progress along roads (${movingCount}/${initialPositions.length} moved)`
      );
      assert(
        totalDisplacement > 50.0,
        `Traffic fleet must accumulate continuous forward distance (total: ${totalDisplacement.toFixed(1)}m)`
      );
    });

    // ------------------------------------------------------------------------
    // Test 7: AI Traffic - Collision Spacing & Anti-Overlap
    // ------------------------------------------------------------------------
    await ctx.test('AI Traffic: Vehicles maintain collision spacing with zero overlaps or permanent deadlocks', async () => {
      // Check pairwise distances across 100 simulation ticks
      const checkResults = await harness.evaluate(() => {
        let minPairwiseDistance = Infinity;
        let overlapViolations = 0;

        for (let step = 0; step < 100; step++) {
          window.__GAME__.simulation.step(1 / 60);

          const vehicles = window.__GAME__.vehicles.getTrafficVehicles();
          for (let i = 0; i < vehicles.length; i++) {
            const p1 = vehicles[i].getPosition();
            for (let j = i + 1; j < vehicles.length; j++) {
              const p2 = vehicles[j].getPosition();
              const dx = p1.x - p2.x;
              const dz = p1.z - p2.z;
              const dist = Math.sqrt(dx * dx + dz * dz);

              if (dist < minPairwiseDistance) {
                minPairwiseDistance = dist;
              }

              // Less than 2.0m indicates bounding geometry penetration/overlap
              if (dist < 2.0) {
                overlapViolations++;
              }
            }
          }
        }

        return { minPairwiseDistance, overlapViolations };
      });

      assert(
        checkResults.overlapViolations === 0,
        `Detected ${checkResults.overlapViolations} vehicle overlap violations (min distance: ${checkResults.minPairwiseDistance.toFixed(2)}m)`
      );
    });

    // ------------------------------------------------------------------------
    // Test 8: Adversarial - Contradictory Control Inputs
    // ------------------------------------------------------------------------
    await ctx.test('Adversarial: Contradictory driving inputs handled gracefully without desync', async () => {
      // Board vehicle
      await harness.evaluate(() => window.__GAME__.actions.tryEnterVehicle());

      // Send contradictory inputs (W and S at the same time, A and D at the same time, plus handbrake)
      const result = await harness.evaluate(() => {
        window.__GAME__.actions.setVehicleInput({ w: true, s: true, a: true, d: true, space: true });
        for (let i = 0; i < 30; i++) {
          window.__GAME__.simulation.step(1 / 60);
        }
        window.__GAME__.actions.setVehicleInput({ w: false, s: false, a: false, d: false, space: false });

        const v = window.__GAME__.player.getVehicle();
        const p = v.getPosition();
        return { x: p.x, y: p.y, z: p.z, yaw: v.getYaw() };
      });

      assertFiniteNumber(result.x, 'adversarial.x');
      assertFiniteNumber(result.y, 'adversarial.y');
      assertFiniteNumber(result.z, 'adversarial.z');
      assertFiniteNumber(result.yaw, 'adversarial.yaw');

      // Exit back
      await harness.evaluate(() => window.__GAME__.actions.tryExitVehicle());
    });

    // ------------------------------------------------------------------------
    // Test 9: Adversarial - World Boundary Constraints
    // ------------------------------------------------------------------------
    await ctx.test('Adversarial: No invisible walls inside the map; vehicles stay within the map edge', async () => {
      const hasPerimeterWalls = await harness.evaluate(() => {
        const grid = window.__GAME__.spatialGrid;
        for (const cell of grid.cells) {
          for (const item of cell.staticItems) {
            if (typeof item.id === 'string' && item.id.startsWith('wall_')) return true;
          }
        }
        return false;
      });
      assert(!hasPerimeterWalls, 'The old +-280m perimeter walls must not be registered in spatialGrid');

      const boundaryStatus = await harness.evaluate(() => {
        const bounds = window.__GAME__.raw.config.WORLD.SAFE_BOUNDS;
        const vehicles = window.__GAME__.vehicles.getTrafficVehicles();
        let allInBounds = true;
        for (const v of vehicles) {
          const p = v.getPosition();
          if (p.x < bounds.MIN_X || p.x > bounds.MAX_X || p.z < bounds.MIN_Z || p.z > bounds.MAX_Z) {
            allInBounds = false;
            break;
          }
        }
        return allInBounds;
      });

      assert(boundaryStatus, 'All traffic and player vehicles must stay within the map edge (CONFIG.WORLD.SAFE_BOUNDS)');
    });

    // ------------------------------------------------------------------------
    // Test 10: WebGL Draw-Call Optimization & Reduced Traffic Density
    // ------------------------------------------------------------------------
    await ctx.test('Performance: Coalesced /mapfinal draw calls (< 500) and streamed road traffic (25-75 cars)', async () => {
      const perfStatus = await harness.evaluate(() => {
        const renderer = window.__GAME__.raw && window.__GAME__.raw.renderer;
        const scene = window.__GAME__.raw && window.__GAME__.raw.scene;
        const camera = window.__GAME__.raw && window.__GAME__.raw.camera;
        if (renderer && scene && camera) {
          renderer.render(scene, camera);
        }
        const drawCalls = renderer && renderer.info && renderer.info.render ? renderer.info.render.calls : 99999;
        const trafficCount = window.__GAME__.vehicles.getTrafficCount();
        return { drawCalls, trafficCount };
      });

      assert(
        perfStatus.drawCalls < 500,
        `Expected coalesced WebGL draw calls < 500 (down from 22,980), got ${perfStatus.drawCalls}`
      );
      // The fleet is streamed around the player (far cars are recycled onto nearby streets),
      // so a larger fleet stays affordable
      assert(
        perfStatus.trafficCount >= 25 && perfStatus.trafficCount <= 75,
        `Expected streamed road traffic count between 25 and 75, got ${perfStatus.trafficCount}`
      );
    });

    // ------------------------------------------------------------------------
    // Test 11: Pedestrians, Guns, /media Gunshot Audio & Blood Pools
    // ------------------------------------------------------------------------
    await ctx.test('Gameplay: Pedestrians walk around, guns fire with /media sounds, and shot pedestrians die with blood pools', async () => {
      const combatReport = await harness.evaluate(() => {
        // Copy: the live list changes as people stream in and out around the player
        const peds = window.__GAME__.pedestrians.getAll().slice();
        const initialPedCount = peds.length;
        if (initialPedCount === 0) return { initialPedCount: 0 };

        // Snapshot pedestrian positions and step 60 frames to verify walking
        const startPos = peds.map(p => ({ x: p.position.x, z: p.position.z }));
        for (let i = 0; i < 60; i++) {
          window.__GAME__.simulation.step(1 / 60);
        }
        let walkingCount = 0;
        for (let i = 0; i < peds.length; i++) {
          const d = Math.hypot(peds[i].position.x - startPos[i].x, peds[i].position.z - startPos[i].z);
          if (d > 0.1) walkingCount++;
        }

        // Verify all weapons (Spray Can, Pistol, Rifle, Shotgun, RPG) exist
        const allWeapons = window.__GAME__.weapons.getAll().map(w => ({ name: w.name, sound: w.sound }));

        // Equip Pistol and aim camera directly at the first living pedestrian within 8m
        const targetPed = peds.find(p => !p.isDead);
        const camera = window.__GAME__.raw.camera;
        camera.position.set(targetPed.position.x, targetPed.position.y + 1.7, targetPed.position.z + 5.0);
        camera.lookAt(targetPed.position.x, targetPed.position.y + 1.0, targetPed.position.z);
        camera.updateMatrixWorld(true);

        window.__GAME__.actions.selectWeapon('Pistol');
        const activeWeapon = window.__GAME__.weapons.getCurrentWeapon();
        const shotResult = window.__GAME__.actions.shootWeapon();

        // Shot pedestrians stagger clutching the wound, then ragdoll to the ground and bleed
        const targetDeadOnHit = targetPed.isDead;
        const targetDyingState = targetPed.state;
        for (let i = 0; i < 300; i++) {
          window.__GAME__.simulation.step(1 / 60);
        }
        const bodyUp = { x: 0, y: 1, z: 0 };
        {
          const q = targetPed.mesh.quaternion;
          // y component of the body's up axis after rotation: 1 - 2(x^2 + z^2)
          bodyUp.y = 1 - 2 * (q.x * q.x + q.z * q.z);
        }

        const bloodPools = window.__GAME__.pedestrians.getBloodPools();
        return {
          initialPedCount,
          walkingCount,
          weaponNames: allWeapons.map(w => w.name),
          activeWeaponName: activeWeapon ? activeWeapon.name : null,
          shotFired: shotResult && shotResult.fired,
          lastPlayedSound: window.__GAME__.weapons.getLastPlayedSound(),
          targetDead: targetPed.isDead,
          targetDeadOnHit,
          targetDyingState,
          targetFinalState: targetPed.state,
          targetUpY: bodyUp.y,
          bloodPoolCount: bloodPools.length
        };
      });

      assert(combatReport.initialPedCount >= 15, `Expected at least 15 pedestrians spawned, got ${combatReport.initialPedCount}`);
      assert(combatReport.walkingCount >= 10, `Expected pedestrians to actively walk around, ${combatReport.walkingCount} moved`);
      assert(
        combatReport.weaponNames.includes('Spray Can') &&
        combatReport.weaponNames.includes('Pistol') &&
        combatReport.weaponNames.includes('Rifle') &&
        combatReport.weaponNames.includes('Shotgun') &&
        combatReport.weaponNames.includes('RPG'),
        `Expected Spray Can, Pistol, Rifle, Shotgun, and RPG weapons, got: ${combatReport.weaponNames.join(', ')}`
      );
      assertEqual(combatReport.activeWeaponName, 'Pistol', 'Expected Pistol to be equipped');
      assert(combatReport.shotFired, 'Expected shootWeapon() to fire');
      assert(
        typeof combatReport.lastPlayedSound === 'string' && combatReport.lastPlayedSound.startsWith('/media/'),
        `Expected gunshot audio from /media folder, got ${combatReport.lastPlayedSound}`
      );
      assertEqual(combatReport.targetDead, true, 'Shot pedestrian must die');
      assert(combatReport.targetDeadOnHit, 'Shot pedestrian must count as dead as soon as the shot lands');
      assertEqual(combatReport.targetDyingState, 'dying', 'Shot pedestrian must stagger (dying) before falling');
      assertEqual(combatReport.targetFinalState, 'dead', 'Shot pedestrian must ragdoll to the ground and come to rest');
      assert(Math.abs(combatReport.targetUpY) < 0.3, `Dead pedestrian must lie flat on the ground (up.y=${combatReport.targetUpY.toFixed(2)})`);
      assert(combatReport.bloodPoolCount >= 1, `Dead pedestrian must leave a pool of blood, found ${combatReport.bloodPoolCount}`);
    });

    // ------------------------------------------------------------------------
    // Test 12: Sidewalk Clipping & Sub-Terrain Void Fix
    // ------------------------------------------------------------------------
    await ctx.test('Map: Sidewalk meshes sit flush with terrain at y=0 and map holes are filled without a stretched ground texture', async () => {
      const sidewalkReport = await harness.evaluate(() => {
        const scene = window.__GAME__.raw && window.__GAME__.raw.scene;
        const mapRoot = scene && (scene.getObjectByName('anothermapo_world_root') || scene.getObjectByName('anothermapo_root'));
        if (!mapRoot) return { hasMapRoot: false };

        let hasSubTerrainBase = false;
        let subTerrainY = null;
        let filler = null;
        let concreteCount = 0;
        let concreteAllFlush = true;

        mapRoot.traverse(obj => {
          if (!obj.isMesh) return;
          if (obj.userData && obj.userData.isTerrainFiller) {
            const pos = obj.geometry.attributes.position;
            const uv = obj.geometry.attributes.uv;
            filler = {
              y: pos.getY(0),
              // Texture must tile once per metre like the terrain itself, not stretch across the map
              uvPerMetreX: Math.abs((uv.getX(2) - uv.getX(0)) / (pos.getX(2) - pos.getX(0))),
              uvPerMetreZ: Math.abs((uv.getY(2) - uv.getY(0)) / (pos.getZ(2) - pos.getZ(0)))
            };
          }
          if (obj.name === 'anothermapo_subterrain_base' || (obj.userData && (obj.userData.isSubTerrainBase || obj.userData.isSubTerrain))) {
            hasSubTerrainBase = true;
            subTerrainY = obj.position.y;
          }
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          const hasConcrete = mats.some(m => m && (m.name || '').toUpperCase().includes('CONCRETE'));
          if (hasConcrete) {
            concreteCount++;
            if (Math.abs(obj.position.y) > 0.005) {
              concreteAllFlush = false;
            }
          }
        });

        return {
          hasMapRoot: true,
          hasSubTerrainBase,
          subTerrainY,
          filler,
          concreteCount,
          concreteAllFlush
        };
      });

      assert(sidewalkReport.hasMapRoot, 'anothermapo_root must exist in scene');
      assert(!sidewalkReport.hasSubTerrainBase, 'The stretched sub-terrain plane must not be mounted (it z-fought through the terrain in dev fly mode)');
      assert(sidewalkReport.filler, 'Terrain hole filler must be mounted beneath the terrain');
      assert(sidewalkReport.filler.y < 0, `Terrain hole filler must sit below y=0, got ${sidewalkReport.filler.y}`);
      assert(Math.abs(sidewalkReport.filler.uvPerMetreX - 1) < 1e-3 && Math.abs(sidewalkReport.filler.uvPerMetreZ - 1) < 1e-3,
        `Terrain hole filler texture must tile at terrain scale, got ${sidewalkReport.filler.uvPerMetreX}/${sidewalkReport.filler.uvPerMetreZ} uv per metre`);
      assert(sidewalkReport.concreteCount > 0, 'Sidewalk CONCRETE_0 meshes must be present');
      assert(sidewalkReport.concreteAllFlush, 'Sidewalk CONCRETE_0 meshes must sit flush at y=0 without vertical gaps');
    });

    // ------------------------------------------------------------------------
    // Test 13: AI Cars Stay Strictly on Road Without Off-Road Drifting
    // ------------------------------------------------------------------------
    await ctx.test('AI Traffic: All traffic cars stay on the road network without drifting off-road', async () => {
      const roadTrackingReport = await harness.evaluate(() => {
        let offRoadViolations = 0;
        let maxLateralDrift = 0;
        const vehicles = window.__GAME__.vehicles.getTrafficVehicles();

        for (let step = 0; step < 240; step++) {
          window.__GAME__.simulation.step(1 / 60);
        }

        // Verify all AI vehicles are still near their road lane
        for (let i = 0; i < vehicles.length; i++) {
          const v = vehicles[i];
          const p = v.getPosition();
          // Verify velocity direction matches heading (no sideways drifting)
          const spd = Math.hypot(v.velocity.x, v.velocity.y);
          if (spd > 1.0) {
            const fwdX = -Math.sin(v.getYaw());
            const fwdZ = -Math.cos(v.getYaw());
            const rightX = Math.cos(v.getYaw());
            const rightZ = -Math.sin(v.getYaw());
            const latSpeed = Math.abs(v.velocity.x * rightX + v.velocity.y * rightZ);
            if (latSpeed > maxLateralDrift) maxLateralDrift = latSpeed;
            if (latSpeed > 0.5) offRoadViolations++;
          }
          if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) {
            offRoadViolations++;
          }
        }

        return {
          vehicleCount: vehicles.length,
          offRoadViolations,
          maxLateralDrift
        };
      });

      assert(roadTrackingReport.vehicleCount >= 10, 'Traffic fleet must be active');
      assertEqual(
        roadTrackingReport.offRoadViolations,
        0,
        `AI cars must not drift sideways off the road (max lateral drift speed: ${roadTrackingReport.maxLateralDrift.toFixed(3)} m/s)`
      );
    });

    // ------------------------------------------------------------------------
    // Test 14: Hold Shift to Run, Press E to Talk to Pedestrian, Shotgun.mp3
    // ------------------------------------------------------------------------
    await ctx.test('Gameplay: Holding Shift doubles running speed, pressing E talks to pedestrians, and Shotgun plays /media/mp3/shotgun.mp3', async () => {
      const featureReport = await harness.evaluate(() => {
        // Ensure on foot at open road
        if (window.__GAME__.player.getState() === 'IN_VEHICLE') {
          window.__GAME__.actions.tryExitVehicle();
        }

        // 1. Test Walking vs Running (Holding Shift)
        const p0 = window.__GAME__.player.getPosition();
        window.__GAME__.actions.setPlayerInput({ w: true, a: false, s: false, d: false, shift: false });
        for (let i = 0; i < 20; i++) window.__GAME__.simulation.step(1 / 60);
        const pWalk = window.__GAME__.player.getPosition();
        const walkDist = Math.hypot(pWalk.x - p0.x, pWalk.z - p0.z);

        window.__GAME__.actions.setPlayerInput({ w: true, a: false, s: false, d: false, shift: true });
        for (let i = 0; i < 20; i++) window.__GAME__.simulation.step(1 / 60);
        const pRun = window.__GAME__.player.getPosition();
        const runDist = Math.hypot(pRun.x - pWalk.x, pRun.z - pWalk.z);
        window.__GAME__.actions.setPlayerInput({ w: false, a: false, s: false, d: false, shift: false });

        // 2. Test Talking to a Pedestrian with [E] / talkToNearbyPedestrian()
        const alivePed = window.__GAME__.pedestrians.getAll().find(p => !p.isDead);
        // Move pedestrian right next to player so we can talk to them
        const curPos = window.__GAME__.player.getPosition();
        alivePed.mesh.position.set(curPos.x + 1.5, 0, curPos.z + 1.5);
        window.__GAME__.simulation.step(1 / 60);

        const talkIndicator = document.getElementById('ped-talk-indicator');
        const talkPromptVisible = talkIndicator ? window.getComputedStyle(talkIndicator).display !== 'none' : false;

        const dialogResult = window.__GAME__.actions.talkToNearbyPedestrian();
        const dialogEl = document.getElementById('ped-dialog');
        const dialogVisible = dialogEl ? window.getComputedStyle(dialogEl).display !== 'none' : false;
        const dialogText = dialogEl ? (dialogEl.innerText || dialogEl.textContent) : '';

        // 3. Test Shotgun sound is /media/mp3/shotgun.mp3
        window.__GAME__.actions.selectWeapon('Shotgun');
        const shotgunWeapon = window.__GAME__.weapons.getCurrentWeapon();
        // Wait or reset cooldown by stepping and shooting
        const shotgunSoundConfig = shotgunWeapon ? shotgunWeapon.sound : null;

        return {
          walkDist,
          runDist,
          speedRatio: walkDist > 0 ? runDist / walkDist : 0,
          talkPromptVisible,
          pedStateAfterTalk: alivePed.state,
          dialogResult,
          dialogVisible,
          dialogText,
          shotgunSoundConfig
        };
      });

      assert(
        featureReport.speedRatio > 1.75 && featureReport.speedRatio < 2.25,
        `Holding Shift must double player running speed (walk=${featureReport.walkDist.toFixed(2)}m, run=${featureReport.runDist.toFixed(2)}m, ratio=${featureReport.speedRatio.toFixed(2)}x)`
      );
      assert(featureReport.talkPromptVisible, '#ped-talk-indicator "(E) Talk" must appear when near a living pedestrian');
      assertEqual(featureReport.pedStateAfterTalk, 'talking', 'Pedestrian state must change to "talking" when spoken to');
      assert(featureReport.dialogResult && featureReport.dialogResult.text, 'talkToNearbyPedestrian() must return dialogue data');
      assert(featureReport.dialogVisible, '#ped-dialog must be visible when talking to a pedestrian');
      assertEqual(
        featureReport.shotgunSoundConfig,
        '/media/mp3/shotgun.mp3',
        `Shotgun firing sound must be /media/mp3/shotgun.mp3, got ${featureReport.shotgunSoundConfig}`
      );
    });

    // ------------------------------------------------------------------------
    // Test 15: Alternating SpongeBob Footstep Sounds (Speeding Up When Running)
    // ------------------------------------------------------------------------
    await ctx.test('Audio: Walking plays alternating spongebobwalk1.mp3 and spongebobwalk2.mp3, speeding up when running', async () => {
      const footstepReport = await harness.evaluate(() => {
        if (window.__GAME__.player.getState() === 'IN_VEHICLE') {
          window.__GAME__.actions.tryExitVehicle();
        }
        // Stop movement to reset footstep timer
        window.__GAME__.actions.setPlayerInput({ w: false, a: false, s: false, d: false, shift: false });
        window.__GAME__.simulation.step(1 / 60);

        const historyBeforeWalk = window.__GAME__.player.getFootstepHistory().length;

        // Walk for 60 frames (1.0 second)
        window.__GAME__.actions.setPlayerInput({ w: true, a: false, s: false, d: false, shift: false });
        for (let i = 0; i < 60; i++) {
          window.__GAME__.simulation.step(1 / 60);
        }
        const walkSteps = window.__GAME__.player.getFootstepHistory().slice(historyBeforeWalk);

        // Stop briefly to reset cadence
        window.__GAME__.actions.setPlayerInput({ w: false, a: false, s: false, d: false, shift: false });
        window.__GAME__.simulation.step(1 / 60);

        const historyBeforeRun = window.__GAME__.player.getFootstepHistory().length;

        // Run (Shift held) for 60 frames (1.0 second)
        window.__GAME__.actions.setPlayerInput({ w: true, a: false, s: false, d: false, shift: true });
        for (let i = 0; i < 60; i++) {
          window.__GAME__.simulation.step(1 / 60);
        }
        const runSteps = window.__GAME__.player.getFootstepHistory().slice(historyBeforeRun);
        window.__GAME__.actions.setPlayerInput({ w: false, a: false, s: false, d: false, shift: false });

        // Check strict alternation between /media/spongebobwalk1.mp3 and /media/spongebobwalk2.mp3
        const allSteps = [...walkSteps, ...runSteps];
        let strictlyAlternating = allSteps.length >= 4;
        for (let i = 1; i < allSteps.length; i++) {
          if (allSteps[i].sound === allSteps[i - 1].sound) {
            strictlyAlternating = false;
          }
        }

        return {
          walkStepCount: walkSteps.length,
          runStepCount: runSteps.length,
          walkSounds: walkSteps.map(s => s.sound),
          runSounds: runSteps.map(s => s.sound),
          walkRate: walkSteps[0] ? walkSteps[0].playbackRate : 0,
          runRate: runSteps[0] ? runSteps[0].playbackRate : 0,
          strictlyAlternating
        };
      });

      assert(footstepReport.walkStepCount >= 2, `Walking for 1s must trigger at least 2 footstep sounds (got ${footstepReport.walkStepCount})`);
      assert(
        footstepReport.runStepCount > footstepReport.walkStepCount,
        `Running must trigger footsteps faster than walking (walk=${footstepReport.walkStepCount}, run=${footstepReport.runStepCount})`
      );
      assert(
        footstepReport.runRate > footstepReport.walkRate,
        `Running footstep playbackRate (${footstepReport.runRate}) must be faster than walking (${footstepReport.walkRate})`
      );
      assert(
        footstepReport.walkSounds.includes('/media/spongebobwalk1.mp3') &&
        footstepReport.walkSounds.includes('/media/spongebobwalk2.mp3'),
        `Footsteps must use /media/spongebobwalk1.mp3 and /media/spongebobwalk2.mp3 (got ${footstepReport.walkSounds.join(', ')})`
      );
      assert(footstepReport.strictlyAlternating, 'Footstep sounds must strictly alternate between spongebobwalk1.mp3 and spongebobwalk2.mp3');
    });

    // ------------------------------------------------------------------------
    // Test 16: Carjacking Moving Cars, Sun in Sky, Shadows & Shaders
    // ------------------------------------------------------------------------
    await ctx.test('Visuals & Gameplay: Sun in sky, shadows/shaders enabled, and carjacking animation on moving cars (door opens, gun pointed, driver forced out & runs away)', async () => {
      const carjackAndVisualsReport = await harness.evaluate(() => {
        const renderer = window.__GAME__.raw && window.__GAME__.raw.renderer;
        const scene = window.__GAME__.raw && window.__GAME__.raw.scene;

        // 1. Check shadows, custom shaders (AtmosphericSkyShader & SunCoronaShader), and 3D Sun in the sky
        const shadowsEnabled = !!(renderer && renderer.shadowMap && renderer.shadowMap.enabled);
        const skyDome = scene ? scene.getObjectByName('sky_shader_dome') : null;
        const hasSkyShader = !!(skyDome && skyDome.material && skyDome.material.type === 'ShaderMaterial');
        const sunGroup = scene ? scene.getObjectByName('sky_sun') : null;
        const sunCore = scene ? scene.getObjectByName('sun_core_sphere') : null;
        const sunHalo = scene ? scene.getObjectByName('sun_corona_halo') : null;
        const hasSunInSky = !!(sunGroup && sunCore && sunHalo && sunHalo.material && sunHalo.material.type === 'ShaderMaterial' && sunGroup.position.y > 500);
        const sunLight = scene ? scene.getObjectByName('sun_directional_light') : null;
        const sunCastsShadow = !!(sunLight && sunLight.castShadow);

        // 2. Test carjacking a moving AI traffic vehicle
        if (window.__GAME__.player.getState() === 'IN_VEHICLE') {
          window.__GAME__.actions.tryExitVehicle();
        }
        const trafficVehicles = window.__GAME__.vehicles.getTrafficVehicles();
        const movingCar = trafficVehicles.find(v => !v.isPlayer) || trafficVehicles[0];
        movingCar.speed = 10.0;

        // Trigger carjacking on moving car
        window.__GAME__.actions.carjackVehicle(movingCar);
        const stateStart = Object.assign({}, window.__GAME__.player.getCarjackState());
        const weaponDuringJack = window.__GAME__.weapons.getCurrentWeapon();

        // Step 20 ticks (~0.33s) -> Phase 1: opening door & pointing gun
        for (let i = 0; i < 20; i++) window.__GAME__.simulation.step(1 / 60);
        const stateDoorOpen = Object.assign({}, window.__GAME__.player.getCarjackState());
        const doorAnglePhase1 = stateDoorOpen.doorAngle;

        // Step 30 ticks (~0.83s total) -> Phase 2: forcing driver out of car
        for (let i = 0; i < 30; i++) window.__GAME__.simulation.step(1 / 60);
        const stateForcingOut = Object.assign({}, window.__GAME__.player.getCarjackState());
        const driverExitedMid = stateForcingOut.driverExited;

        // Step 50 ticks (~1.66s total) -> Completed: driver running away & player driving car
        for (let i = 0; i < 50; i++) window.__GAME__.simulation.step(1 / 60);
        const stateEnd = Object.assign({}, window.__GAME__.player.getCarjackState());
        const driverPed = stateEnd.driverPed;
        const driverPosBeforeRun = driverPed ? { x: driverPed.position.x, z: driverPed.position.z } : null;

        // Step 30 more ticks to verify ejected driver actively runs away
        for (let i = 0; i < 30; i++) window.__GAME__.simulation.step(1 / 60);
        const driverRunDist = (driverPed && driverPosBeforeRun)
          ? Math.hypot(driverPed.position.x - driverPosBeforeRun.x, driverPed.position.z - driverPosBeforeRun.z)
          : 0;

        const finalPlayerState = window.__GAME__.player.getState();
        const finalActiveVehicleId = window.__GAME__.player.getVehicle() ? window.__GAME__.player.getVehicle().id : null;

        return {
          shadowsEnabled,
          hasSkyShader,
          hasSunInSky,
          sunCastsShadow,
          initialPhase: stateStart.phase,
          gunPointed: stateStart.gunPointed,
          weaponTypeDuringJack: weaponDuringJack ? weaponDuringJack.type : null,
          doorAnglePhase1,
          driverExitedMid,
          completedPhase: stateEnd.phase,
          driverStateAfter: driverPed ? driverPed.state : null,
          driverRunDist,
          finalPlayerState,
          finalActiveVehicleId,
          targetVehicleId: movingCar.id
        };
      });

      assert(carjackAndVisualsReport.shadowsEnabled, 'WebGLRenderer shadowMap must be enabled');
      assert(carjackAndVisualsReport.sunCastsShadow, 'Directional sun light must cast shadows');
      assert(carjackAndVisualsReport.hasSkyShader, 'Atmospheric custom GLSL ShaderMaterial sky dome must be active');
      assert(carjackAndVisualsReport.hasSunInSky, '3D Sun core sphere and GLSL solar corona shader must be present in the sky');
      assertEqual(carjackAndVisualsReport.initialPhase, 'opening_door', 'Carjacking must begin in opening_door phase');
      assert(carjackAndVisualsReport.gunPointed && carjackAndVisualsReport.weaponTypeDuringJack === 'gun', 'Player must point a gun at the driver during carjacking');
      assert(carjackAndVisualsReport.doorAnglePhase1 > 0.3, `Driver door must swing open during carjacking (angle=${carjackAndVisualsReport.doorAnglePhase1.toFixed(2)} rad)`);
      assert(carjackAndVisualsReport.driverExitedMid, 'Driver must be forced out of the vehicle');
      assertEqual(carjackAndVisualsReport.completedPhase, 'completed', 'Carjacking sequence must complete');
      assertEqual(carjackAndVisualsReport.driverStateAfter, 'fleeing', 'Ejected driver must enter fleeing state');
      assert(carjackAndVisualsReport.driverRunDist > 1.0, `Ejected driver must run away from the hijacked car (ran ${carjackAndVisualsReport.driverRunDist.toFixed(2)}m)`);
      assertEqual(carjackAndVisualsReport.finalPlayerState, 'IN_VEHICLE', 'Player must transition into IN_VEHICLE after carjacking completes');
      assertEqual(carjackAndVisualsReport.finalActiveVehicleId, carjackAndVisualsReport.targetVehicleId, 'Player must be driving the carjacked vehicle');
    });

    // ------------------------------------------------------------------------
    // Test 17: Speed-Scaled NPC Ragdoll on Vehicle Impact & Car Driving/Accelerating/Braking Audio
    // ------------------------------------------------------------------------
    await ctx.test('Physics & Audio: NPCs hit by cars ragdoll forward scaled by vehicle speed, and car accelerating/braking/driving audio plays', async () => {
      const ragdollAndCarAudioReport = await harness.evaluate(() => {
        // Ensure player is in vehicle
        if (window.__GAME__.player.getState() !== 'IN_VEHICLE') {
          window.__GAME__.actions.tryEnterVehicle();
        }
        const car = window.__GAME__.player.getVehicle() || window.__GAME__.vehicles.getPlayerVehicle();
        const peds = window.__GAME__.pedestrians.getAll().filter(p => !p.isDead && p.state !== 'ragdoll');
        const pedSlow = peds[0];
        const pedFast = peds[1];

        // 1. Test Low-Speed Impact (6 m/s) -> forward ragdoll
        car.position.set(-100, 0, 50);
        car.yaw = 0; // facing -Z
        car.speed = 6.0;
        car.velocity.set(0, -6.0);
        pedSlow.mesh.position.set(-100, 0, 49.0); // directly in front of car (-Z)

        window.__GAME__.simulation.step(1 / 60);
        const slowInitialState = pedSlow.state;
        const slowInitialVelZ = pedSlow.ragdollVel ? pedSlow.ragdollVel.z : 0;

        // Step 60 frames so pedSlow completes its forward ragdoll trajectory
        car.speed = 0;
        car.velocity.set(0, 0);
        for (let i = 0; i < 60; i++) window.__GAME__.simulation.step(1 / 60);
        const slowForwardDistance = pedSlow.ragdollDisplacement || 0;
        const slowFinalDead = pedSlow.isDead;

        // 2. Test High-Speed Impact (22 m/s) -> significantly farther forward ragdoll
        car.position.set(-100, 0, 20);
        car.yaw = 0; // facing -Z
        car.speed = 22.0;
        car.velocity.set(0, -22.0);
        pedFast.mesh.position.set(-100, 0, 19.0); // directly in front of car (-Z)

        window.__GAME__.simulation.step(1 / 60);
        const fastInitialState = pedFast.state;
        const fastInitialVelZ = pedFast.ragdollVel ? pedFast.ragdollVel.z : 0;

        car.speed = 0;
        car.velocity.set(0, 0);
        for (let i = 0; i < 90; i++) window.__GAME__.simulation.step(1 / 60);
        const fastForwardDistance = pedFast.ragdollDisplacement || 0;
        const fastFinalDead = pedFast.isDead;

        // 3. Test Car Accelerating, Driving, and Braking Audio States
        // Accelerate (W held)
        window.__GAME__.actions.setVehicleInput({ w: true, a: false, s: false, d: false, space: false });
        for (let i = 0; i < 20; i++) window.__GAME__.simulation.step(1 / 60);
        const audioAccel = Object.assign({}, window.__GAME__.vehicles.getCarAudioState());

        // Coast / Drive (no throttle, moving > 1 m/s)
        window.__GAME__.actions.setVehicleInput({ w: false, a: false, s: false, d: false, space: false });
        for (let i = 0; i < 5; i++) window.__GAME__.simulation.step(1 / 60);
        const audioDriving = Object.assign({}, window.__GAME__.vehicles.getCarAudioState());

        // Brake (S + Space held while moving)
        car.speed = 12.0;
        car.velocity.set(0, -12.0);
        window.__GAME__.actions.setVehicleInput({ w: false, a: false, s: true, d: false, space: true });
        window.__GAME__.simulation.step(1 / 60);
        const audioBraking = Object.assign({}, window.__GAME__.vehicles.getCarAudioState());

        window.__GAME__.actions.setVehicleInput({ w: false, a: false, s: false, d: false, space: false });

        return {
          slowInitialState,
          slowInitialVelZ,
          slowForwardDistance,
          slowFinalDead,
          fastInitialState,
          fastInitialVelZ,
          fastForwardDistance,
          fastFinalDead,
          audioAccel,
          audioDriving,
          audioBraking
        };
      });

      assertEqual(ragdollAndCarAudioReport.slowInitialState, 'ragdoll', 'Pedestrian hit at 6 m/s must enter ragdoll state');
      assert(ragdollAndCarAudioReport.slowInitialVelZ < -5.0, `Pedestrian hit by car facing -Z must ragdoll forward in -Z direction (vz=${ragdollAndCarAudioReport.slowInitialVelZ.toFixed(2)})`);
      assertEqual(ragdollAndCarAudioReport.fastInitialState, 'ragdoll', 'Pedestrian hit at 22 m/s must enter ragdoll state');
      assert(
        ragdollAndCarAudioReport.fastForwardDistance > ragdollAndCarAudioReport.slowForwardDistance * 2.0,
        `High-speed car impact must launch pedestrian much farther forward than low-speed impact (fast=${ragdollAndCarAudioReport.fastForwardDistance.toFixed(2)}m vs slow=${ragdollAndCarAudioReport.slowForwardDistance.toFixed(2)}m)`
      );
      assert(ragdollAndCarAudioReport.slowFinalDead && ragdollAndCarAudioReport.fastFinalDead, 'Ragdolled pedestrians must land, die, and spawn blood pools');
      assertEqual(ragdollAndCarAudioReport.audioAccel.mode, 'accelerating', 'Car audio must enter accelerating mode when throttling');
      assert(ragdollAndCarAudioReport.audioAccel.engineFreqHz > 70, `Engine frequency must rise during acceleration (got ${ragdollAndCarAudioReport.audioAccel.engineFreqHz.toFixed(1)} Hz)`);
      assertEqual(ragdollAndCarAudioReport.audioDriving.mode, 'driving', 'Car audio must enter driving mode when coasting at speed');
      assertEqual(ragdollAndCarAudioReport.audioBraking.mode, 'braking', 'Car audio must enter braking mode when braking at speed');
      assert(ragdollAndCarAudioReport.audioBraking.brakeScreechGain > 0, 'Braking audio gain must be active when braking');
    });

    // ------------------------------------------------------------------------
    // Test 18: Continuous Looping Background Music (/media/music.mp3)
    // ------------------------------------------------------------------------
    await ctx.test('Audio: /media/music.mp3 is configured as looping background music regardless of game state', async () => {
      const bgmReport = await harness.evaluate(() => {
        const bgmOnFoot = window.__GAME__.audio && window.__GAME__.audio.getBackgroundMusic
          ? window.__GAME__.audio.getBackgroundMusic()
          : null;
        window.__GAME__.actions.tryEnterVehicle();
        window.__GAME__.simulation.step(1 / 60);
        const bgmInCar = window.__GAME__.audio.getBackgroundMusic();
        window.__GAME__.actions.tryExitVehicle();
        window.__GAME__.simulation.step(1 / 60);
        return {
          hasBgm: !!bgmOnFoot,
          src: bgmOnFoot ? bgmOnFoot.src : null,
          loopOnFoot: bgmOnFoot ? bgmOnFoot.loop : false,
          loopInCar: bgmInCar ? bgmInCar.loop : false,
          volume: bgmOnFoot ? bgmOnFoot.volume : 0
        };
      });

      assert(bgmReport.hasBgm, 'Background music state must be exposed on window.__GAME__.audio.getBackgroundMusic()');
      assertEqual(bgmReport.src, '/media/music.mp3', 'Background music source must be /media/music.mp3');
      assertEqual(bgmReport.loopOnFoot, true, 'Background music must have loop=true while on foot');
      assertEqual(bgmReport.loopInCar, true, 'Background music must remain loop=true while in a vehicle');
      assert(bgmReport.volume > 0, 'Background music volume must be > 0');
    });

    // ------------------------------------------------------------------------
    // Test 19: In-Car Radio with Bottom-Left HUD and Background Music Arbitration
    // ------------------------------------------------------------------------
    await ctx.test('Radio: In-car radio plays /media/radio/ tracks, stops background music, bottom-left UI controls work, and background music resumes on pause/exit', async () => {
      const radioReport = await harness.evaluate(() => {
        const radioApi = window.__GAME__.audio.getRadio ? window.__GAME__.audio.getRadio() : null;
        const bgmApi = window.__GAME__.audio.getBackgroundMusic ? window.__GAME__.audio.getBackgroundMusic() : null;
        const radioUIEl = document.getElementById('radio-ui');
        const titleEl = document.getElementById('radio-track-title');
        const pauseBtn = document.getElementById('radio-btn-pause');
        const skipBtn = document.getElementById('radio-btn-skip');
        const restartBtn = document.getElementById('radio-btn-restart');
        const volSlider = document.getElementById('radio-volume-slider');
        const volVal = document.getElementById('radio-volume-val');

        // Ensure vehicle is stationary and player is positioned right beside it
        const car = window.__GAME__.vehicles.getPlayerVehicle();
        if (car) {
          car.speed = 0;
          car.velocity.set(0, 0);
          window.__GAME__.player.setPosition(car.position.x - 1.5, 0, car.position.z);
          window.__GAME__.simulation.step(1 / 60);
        }

        // State while on foot
        const onFootVisible = radioUIEl ? (radioUIEl.style.display !== 'none') : false;
        const onFootRadioPlaying = radioApi ? radioApi.isPlaying : false;

        // Enter vehicle
        const enterResult = window.__GAME__.actions.tryEnterVehicle();
        window.__GAME__.simulation.step(1 / 60);

        const inCarVisible = radioUIEl ? (radioUIEl.style.display !== 'none') : false;
        const inCarRadioState = window.__GAME__.audio.getRadio();
        const inCarBgmState = window.__GAME__.audio.getBackgroundMusic();
        const trackTitle0 = titleEl ? titleEl.textContent : '';

        // Test Skip track button
        if (skipBtn) skipBtn.click();
        window.__GAME__.simulation.step(1 / 60);
        const skippedTrackState = window.__GAME__.audio.getRadio();
        const trackTitle1 = titleEl ? titleEl.textContent : '';

        // Test Restart track button
        if (restartBtn) restartBtn.click();
        window.__GAME__.simulation.step(1 / 60);
        const restartedCurrentTime = (window.__GAME__.audio.getRadio() && window.__GAME__.audio.getRadio().audioElement)
          ? window.__GAME__.audio.getRadio().audioElement.currentTime
          : 0;

        // Test Volume slider
        if (volSlider) {
          volSlider.value = '0.75';
          volSlider.dispatchEvent(new Event('input', { bubbles: true }));
        }
        window.__GAME__.simulation.step(1 / 60);
        const updatedVolState = window.__GAME__.audio.getRadio();
        const updatedVolText = volVal ? volVal.textContent : '';

        // Test Pause button: Radio pauses, background music resumes
        if (pauseBtn) pauseBtn.click();
        window.__GAME__.simulation.step(1 / 60);
        const pausedRadioState = window.__GAME__.audio.getRadio();
        const pausedBgmState = window.__GAME__.audio.getBackgroundMusic();
        const pausedBtnText = pauseBtn ? pauseBtn.textContent : '';

        // Test Play button (unpause): Radio plays, background music stops
        if (pauseBtn) pauseBtn.click();
        window.__GAME__.simulation.step(1 / 60);
        const resumedRadioState = window.__GAME__.audio.getRadio();
        const resumedBgmState = window.__GAME__.audio.getBackgroundMusic();
        const resumedBtnText = pauseBtn ? pauseBtn.textContent : '';

        // Test Exit vehicle: Radio stops, radio UI hides, background music resumes
        window.__GAME__.actions.tryExitVehicle();
        window.__GAME__.simulation.step(1 / 60);
        const exitedRadioVisible = radioUIEl ? (radioUIEl.style.display !== 'none') : false;
        const exitedRadioState = window.__GAME__.audio.getRadio();
        const exitedBgmState = window.__GAME__.audio.getBackgroundMusic();

        return {
          hasRadioApi: !!radioApi,
          trackCount: (radioApi && radioApi.tracks) ? radioApi.tracks.length : 0,
          tracks: (radioApi && radioApi.tracks) ? radioApi.tracks.map(t => t.file) : [],
          onFootVisible,
          onFootRadioPlaying,
          inCarVisible,
          inCarRadioPlaying: inCarRadioState ? inCarRadioState.isPlaying : false,
          inCarTrackSrc: (inCarRadioState && inCarRadioState.currentTrack) ? inCarRadioState.currentTrack.file : '',
          trackTitle0,
          inCarBgmPaused: inCarBgmState ? inCarBgmState.paused : false,
          skippedIndex: skippedTrackState ? skippedTrackState.currentTrackIndex : -1,
          trackTitle1,
          restartedCurrentTime,
          volumeValue: updatedVolState ? updatedVolState.volume : 0,
          updatedVolText,
          radioPausedByUser: pausedRadioState ? pausedRadioState.isUserPaused : false,
          pausedBgmResumed: pausedBgmState ? !pausedBgmState.paused : false,
          pausedBtnText,
          radioResumedPlaying: resumedRadioState ? resumedRadioState.isPlaying : false,
          resumedBgmStopped: resumedBgmState ? resumedBgmState.paused : false,
          resumedBtnText,
          exitedRadioVisible,
          exitedRadioPlaying: exitedRadioState ? exitedRadioState.isPlaying : false,
          exitedBgmResumed: exitedBgmState ? !exitedBgmState.paused : false
        };
      });

      assert(radioReport.hasRadioApi, 'window.__GAME__.audio.getRadio() must return radio state');
      assertEqual(radioReport.trackCount, 8, 'Radio playlist must contain 8 tracks from /media/radio/');
      assert(radioReport.tracks.every(t => t.startsWith('/media/radio/')), 'All tracks must be sourced from /media/radio/');
      assertEqual(radioReport.onFootVisible, false, 'Radio UI must be hidden when player is on foot');
      assertEqual(radioReport.inCarVisible, true, 'Radio UI must be visible when player is in vehicle');
      assertEqual(radioReport.inCarRadioPlaying, true, 'Radio must start playing when player enters vehicle');
      assertEqual(radioReport.inCarBgmPaused, true, 'Background music must stop/pause when radio starts');
      assert(radioReport.trackTitle0.length > 0, 'Track title must be rendered in radio HUD');
      assertEqual(radioReport.skippedIndex, 1, 'Skip button must advance to track index 1');
      assert(radioReport.trackTitle1 !== radioReport.trackTitle0, 'Track title must update when skipping track');
      assertEqual(radioReport.restartedCurrentTime, 0, 'Restart button must reset track currentTime to 0');
      assertEqual(radioReport.volumeValue, 0.75, 'Volume slider must update radio volume to 0.75');
      assertEqual(radioReport.updatedVolText, '75%', 'Volume percent display must show 75%');
      assertEqual(radioReport.radioPausedByUser, true, 'Pause button must pause radio playback');
      assertEqual(radioReport.pausedBgmResumed, true, 'Background music must resume when radio is paused');
      assert(radioReport.pausedBtnText.includes('Play'), 'Pause button text must show Play when paused');
      assertEqual(radioReport.radioResumedPlaying, true, 'Unpausing must resume radio playback');
      assertEqual(radioReport.resumedBgmStopped, true, 'Background music must stop again when radio resumes');
      assert(radioReport.resumedBtnText.includes('Pause'), 'Pause button text must show Pause when playing');
      assertEqual(radioReport.exitedRadioVisible, false, 'Radio UI must hide when exiting vehicle');
      assertEqual(radioReport.exitedRadioPlaying, false, 'Radio must stop when exiting vehicle');
      assertEqual(radioReport.exitedBgmResumed, true, 'Background music must resume when exiting vehicle');
    });

    // ------------------------------------------------------------------------
    // Test 24: Vehicle Tire Smoke on Space Drift
    // ------------------------------------------------------------------------
    await ctx.test('Vehicles: Tires emit billowing smoke when pressing space to drift', async () => {
      const smokeReport = await harness.evaluate(() => {
        // Ensure player is inside vehicle
        if (window.__GAME__.player.getState() !== 'IN_VEHICLE') {
          window.__GAME__.actions.tryEnterVehicle();
        }
        const car = window.__GAME__.player.getVehicle() || window.__GAME__.vehicles.getPlayerVehicle();
        
        // Reset smoke pool for clean test baseline
        window.__GAME__.smoke.reset();
        const initialSpawnCount = window.__GAME__.smoke.getTotalSpawned();
        const initialActiveCount = window.__GAME__.smoke.getActiveCount();

        // 1. Move vehicle forward with throttle
        car.position.set(0, 0, 0);
        car.yaw = 0;
        car.speed = 14.0;
        car.velocity.set(0, -14.0);

        // Press space to drift (handbrake) while moving
        window.__GAME__.actions.setVehicleInput({ w: true, a: false, s: false, d: false, space: true });

        // Step simulation 20 frames
        for (let i = 0; i < 20; i++) {
          window.__GAME__.simulation.step(1 / 60);
        }

        const driftingActiveCount = window.__GAME__.smoke.getActiveCount();
        const driftingTotalSpawned = window.__GAME__.smoke.getTotalSpawned();
        const activeParticles = window.__GAME__.smoke.getActiveParticles().map(p => ({
          x: p.mesh.position.x,
          y: p.mesh.position.y,
          z: p.mesh.position.z,
          scale: p.mesh.scale.x,
          opacity: p.mesh.material.opacity,
          visible: p.mesh.visible
        }));

        // 2. Release space and stop vehicle
        window.__GAME__.actions.setVehicleInput({ w: false, a: false, s: false, d: false, space: false });
        car.speed = 0;
        car.velocity.set(0, 0);

        // Step 60 frames so active smoke particles fade away
        for (let i = 0; i < 60; i++) {
          window.__GAME__.simulation.step(1 / 60);
        }

        const stoppedActiveCount = window.__GAME__.smoke.getActiveCount();

        return {
          initialActiveCount,
          driftingActiveCount,
          driftingTotalSpawned: driftingTotalSpawned - initialSpawnCount,
          stoppedActiveCount,
          sampleParticle: activeParticles.length > 0 ? activeParticles[0] : null
        };
      });

      assertEqual(smokeReport.initialActiveCount, 0, 'No tire smoke before drifting');
      assert(smokeReport.driftingActiveCount > 0, `Tires must emit active smoke particles while drifting (got ${smokeReport.driftingActiveCount})`);
      assert(smokeReport.driftingTotalSpawned >= 4, `At least 4 smoke puffs must spawn during drift (got ${smokeReport.driftingTotalSpawned})`);
      assert(smokeReport.sampleParticle !== null, 'Active smoke particle must exist');
      assert(smokeReport.sampleParticle.visible, 'Active smoke particle must be visible');
      assert(smokeReport.sampleParticle.opacity > 0 && smokeReport.sampleParticle.opacity <= 1.0, 'Smoke opacity must be between 0 and 1');
      assert(smokeReport.sampleParticle.scale > 0, 'Smoke particle must have positive scale');
      assertEqual(smokeReport.stoppedActiveCount, 0, 'All tire smoke must dissipate after stopping');
    });

    // ------------------------------------------------------------------------
    // Test 25: Police System (Shooting & Vehicular Homicide Crimes)
    // ------------------------------------------------------------------------
    await ctx.test('Police System: Shooting someone or running someone over with car triggers wanted level & police pursuit', async () => {
      const policeReport = await harness.evaluate(() => {
        // Reset police state to clean baseline
        window.__GAME__.police.clearWantedLevel();
        const initialWanted = window.__GAME__.police.getWantedLevel();
        const initialPoliceCount = window.__GAME__.police.getPoliceCount();
        const hudEl = document.getElementById('wanted-hud');
        const initialHudVisible = hudEl ? hudEl.style.display !== 'none' : false;

        // 1. Commit Crime 1: Shoot a pedestrian
        const peds = window.__GAME__.pedestrians.getAll().filter(p => !p.isDead);
        const pedTarget = peds[0];
        const camera = window.__GAME__.raw.camera;
        camera.position.set(pedTarget.position.x, pedTarget.position.y + 1.7, pedTarget.position.z + 4.0);
        camera.lookAt(pedTarget.position.x, pedTarget.position.y + 1.0, pedTarget.position.z);
        camera.updateMatrixWorld(true);

        window.__GAME__.actions.selectWeapon('Pistol');
        window.__GAME__.actions.shootWeapon();

        // Step a frame for crime dispatch
        window.__GAME__.simulation.step(1 / 60);

        const shotWanted = window.__GAME__.police.getWantedLevel();
        const shotPoliceCount = window.__GAME__.police.getPoliceCount();
        const shotHudVisible = hudEl ? hudEl.style.display !== 'none' : false;
        const shotState = window.__GAME__.police.getState();

        // 2. Verify Police Cruiser spawned and pursues player
        const policeCars = window.__GAME__.police.getPoliceCars();
        const pCar = policeCars.length > 0 ? policeCars[0] : null;
        const hasPoliceCar = !!pCar;
        const isPoliceTag = pCar ? !!pCar.isPolice : false;
        const hasLightbar = pCar ? !!pCar.lightbarGroup : false;
        const hasDoorDecals = pCar && pCar.getMesh() ? !!pCar.getMesh().getObjectByName('police_door_left') : false;

        // Snapshot police car initial position and step 30 frames to verify pursuit towards player
        const pCarStartPos = pCar ? { x: pCar.position.x, z: pCar.position.z } : null;
        for (let i = 0; i < 30; i++) {
          window.__GAME__.simulation.step(1 / 60);
        }
        const pCarEndPos = pCar ? { x: pCar.position.x, z: pCar.position.z } : null;
        const pCarMoved = (pCarStartPos && pCarEndPos) 
          ? Math.hypot(pCarEndPos.x - pCarStartPos.x, pCarEndPos.z - pCarStartPos.z)
          : 0;

        // 3. Commit Crime 2: Vehicular Homicide (Run someone over with player's car)
        if (window.__GAME__.player.getState() !== 'IN_VEHICLE') {
          window.__GAME__.actions.tryEnterVehicle();
        }
        const playerCar = window.__GAME__.player.getVehicle() || window.__GAME__.vehicles.getPlayerVehicle();
        const livePeds = window.__GAME__.pedestrians.getAll().filter(p => !p.isDead && p.state !== 'ragdoll');
        const pedToRunOver = livePeds[0];

        // Impact pedestrian with vehicle at 15 m/s
        playerCar.position.set(-50, 0, -50);
        playerCar.yaw = 0;
        playerCar.speed = 15.0;
        playerCar.velocity.set(0, -15.0);
        pedToRunOver.mesh.position.set(-50, 0, -51.0);

        window.__GAME__.simulation.step(1 / 60);

        const vehicularWanted = window.__GAME__.police.getWantedLevel();
        const vehicularState = window.__GAME__.police.getState();

        // Cleanup
        window.__GAME__.police.clearWantedLevel();
        const clearedWanted = window.__GAME__.police.getWantedLevel();
        const clearedPoliceCount = window.__GAME__.police.getPoliceCount();
        const clearedHudVisible = hudEl ? hudEl.style.display !== 'none' : false;

        return {
          initialWanted,
          initialPoliceCount,
          initialHudVisible,
          shotWanted,
          shotPoliceCount,
          shotHudVisible,
          shotLastCrime: shotState ? shotState.lastCrime : null,
          hasPoliceCar,
          isPoliceTag,
          hasLightbar,
          hasDoorDecals,
          pCarMoved,
          vehicularWanted,
          vehicularLastCrime: vehicularState ? vehicularState.lastCrime : null,
          clearedWanted,
          clearedPoliceCount,
          clearedHudVisible
        };
      });

      assertEqual(policeReport.initialWanted, 0, 'Initial wanted level must be 0');
      assertEqual(policeReport.initialPoliceCount, 0, 'No police cars initial');
      assertEqual(policeReport.initialHudVisible, false, 'Wanted HUD hidden initially');
      assert(policeReport.shotWanted >= 1, `Wanted level must increase when shooting someone (got ${policeReport.shotWanted})`);
      assert(policeReport.shotPoliceCount >= 1, `Police car must be dispatched on shooting (got ${policeReport.shotPoliceCount})`);
      assertEqual(policeReport.shotHudVisible, true, 'Wanted HUD must become visible after shooting');
      assertEqual(policeReport.shotLastCrime, 'shooting', 'Last crime must be shooting');
      assertEqual(policeReport.hasPoliceCar, true, 'Police cruiser instance must exist');
      assertEqual(policeReport.isPoliceTag, true, 'Police vehicle must be tagged isPolice');
      assertEqual(policeReport.hasLightbar, true, 'Police car must have roof emergency lightbar');
      assertEqual(policeReport.hasDoorDecals, true, 'Police car must have white door decals');
      assert(policeReport.pCarMoved > 0.1, `Police car must actively drive/pursue towards player (moved ${policeReport.pCarMoved.toFixed(2)}m)`);
      assert(policeReport.vehicularWanted >= 2, `Wanted level must increase when running someone over (got ${policeReport.vehicularWanted})`);
      assertEqual(policeReport.vehicularLastCrime, 'vehicular_homicide', 'Last crime must be vehicular_homicide');
      assertEqual(policeReport.clearedWanted, 0, 'Wanted level must clear to 0');
      assertEqual(policeReport.clearedPoliceCount, 0, 'Police cars must despawn on cleared wanted level');
      assertEqual(policeReport.clearedHudVisible, false, 'Wanted HUD must hide when cleared');
    });

    // ------------------------------------------------------------------------
    // Test 26: Armed Police Officers & Increasing Stars on Officer Kill
    // ------------------------------------------------------------------------
    await ctx.test('Police Officers: Armed officers deploy on foot, shoot at player, and killing officers grants additional wanted stars', async () => {
      const officerReport = await harness.evaluate(() => {
        // Clear any previous state
        window.__GAME__.police.clearWantedLevel();

        // 1. Trigger wanted level 1
        window.__GAME__.police.setWantedLevel(1);

        // Position player on foot at (0, 0, 0)
        window.__GAME__.player.setPosition(0, 0, 0);
        if (window.__GAME__.player.getState() === 'IN_VEHICLE') {
          window.__GAME__.actions.tryExitVehicle();
        }

        // Spawn a police cruiser close enough to deploy officers (< 30m)
        const cruiser = window.__GAME__.police.spawnPoliceCar({ x: 12, z: 12 });
        cruiser.position.set(12, 0, 12);

        // Step simulation so officer disembarks
        window.__GAME__.simulation.step(1 / 60);

        const officers = window.__GAME__.police.getOfficers();
        const hasOfficer = officers.length > 0;
        const officer1 = officers[0];
        const isOfficerTag = officer1 ? !!officer1.isPoliceOfficer : false;
        const hasPistol = officer1 && officer1.mesh ? !!officer1.mesh.getObjectByName('officer_pistol') : false;

        // Force officer shoot timer to 0 and step to verify officer shooting at player
        if (officer1) officer1.shootCooldown = 0;
        
        for (let i = 0; i < 10; i++) {
          window.__GAME__.simulation.step(1 / 60);
        }

        const wantedBeforeKill = window.__GAME__.police.getWantedLevel();

        // 2. Kill the police officer using player weapon
        // Aim camera directly at officer
        const camera = window.__GAME__.raw.camera;
        camera.position.set(officer1.position.x, officer1.position.y + 1.2, officer1.position.z + 2.5);
        camera.lookAt(officer1.position.x, officer1.position.y + 1.0, officer1.position.z);
        camera.updateMatrixWorld(true);

        if (window.__GAME__.actions.resetWeaponCooldown) {
          window.__GAME__.actions.resetWeaponCooldown();
        }
        window.__GAME__.actions.selectWeapon('Pistol');
        window.__GAME__.actions.shootWeapon();

        // Step simulation for kill processing and blood pool expansion
        for (let i = 0; i < 15; i++) {
          window.__GAME__.simulation.step(1 / 60);
        }

        const officerDead = officer1 ? officer1.isDead : false;
        const wantedAfterKill = window.__GAME__.police.getWantedLevel();
        const officerRotX = officer1 && officer1.mesh ? officer1.mesh.rotation.x : 0;

        // 3. Cleanup
        window.__GAME__.police.clearWantedLevel();
        const clearedOfficerCount = window.__GAME__.police.getOfficerCount();

        return {
          hasOfficer,
          isOfficerTag,
          hasPistol,
          wantedBeforeKill,
          officerDead,
          wantedAfterKill,
          officerRotX,
          clearedOfficerCount
        };
      });

      assertEqual(officerReport.hasOfficer, true, 'Police cruiser must deploy armed police officer on foot');
      assertEqual(officerReport.isOfficerTag, true, 'Officer must be tagged isPoliceOfficer');
      assertEqual(officerReport.hasPistol, true, 'Police officer mesh must have drawn service pistol');
      assertEqual(officerReport.wantedBeforeKill, 1, 'Initial wanted level before kill is 1');
      assertEqual(officerReport.officerDead, true, 'Officer must die when shot by player');
      assert(Math.abs(officerReport.officerRotX - Math.PI / 2) < 0.05, 'Dead officer must fall flat on ground');
      assert(
        officerReport.wantedAfterKill > officerReport.wantedBeforeKill,
        `Killing a police officer MUST increase wanted stars (before=${officerReport.wantedBeforeKill}, after=${officerReport.wantedAfterKill})`
      );
      assertEqual(officerReport.clearedOfficerCount, 0, 'Officers must despawn when wanted level clears');
    });

    // ------------------------------------------------------------------------
    // Test 27: In-Car Aiming, Smooth 3rd-to-1st Camera Transition & 360 Aiming
    // ------------------------------------------------------------------------
    await ctx.test('Drive-by: Aiming pistol transitions smoothly between 3rd and 1st person with 360 aim while driving normally', async () => {
      const aimReport = await harness.evaluate(() => {
        // 1. Ensure player is in a vehicle
        const pState = window.__GAME__.player.getState();
        if (pState !== 'IN_VEHICLE') {
          const v = window.__GAME__.vehicles.getPlayerVehicle();
          window.__GAME__.player.setPosition(v.position.x - 1, 0, v.position.z);
          window.__GAME__.actions.tryEnterVehicle();
        }

        const car = window.__GAME__.player.getVehicle() || window.__GAME__.vehicles.getPlayerVehicle();
        car.position.set(0, 0, 0);
        car.speed = 0;
        car.velocity.set(0, 0);

        // Step a tick in 3rd person chase
        window.__GAME__.simulation.step(1 / 60);

        const initialTransition = window.__GAME__.actions.getAimTransition();
        const camera = window.__GAME__.raw.camera;
        const initCamDist = Math.hypot(camera.position.x - car.position.x, camera.position.z - car.position.z);

        // 2. Start Aiming: simulate holding right mouse
        window.__GAME__.actions.setVehicleAiming(true);

        // Step simulation for 30 frames (~0.5s) to verify smooth transition
        const transitions = [];
        for (let i = 0; i < 30; i++) {
          window.__GAME__.simulation.step(1 / 60);
          transitions.push(window.__GAME__.actions.getAimTransition());
        }

        const endAimTransition = window.__GAME__.actions.getAimTransition();
        const cockpitCamDist = Math.hypot(camera.position.x - car.position.x, camera.position.z - car.position.z);
        const camHeightInCockpit = camera.position.y;

        // 3. Test 360-degree aiming while driving
        window.__GAME__.actions.setAimAngles(Math.PI * 0.75, 0); // Aiming towards rear-left
        window.__GAME__.simulation.step(1 / 60);
        const aimAngles = window.__GAME__.actions.getAimAngles();

        // 4. Drive normally while aiming
        window.__GAME__.actions.setVehicleInput({ w: true, a: false, s: false, d: false, space: false });
        for (let i = 0; i < 30; i++) {
          window.__GAME__.simulation.step(1 / 60);
        }
        window.__GAME__.actions.setVehicleInput({ w: false, a: false, s: false, d: false, space: false });
        const drivenSpeed = car.getSpeed ? car.getSpeed() : car.speed;
        const carMoved = car.position.length();

        // 5. Release Right Mouse: smooth transition back to third person
        window.__GAME__.actions.setVehicleAiming(false);
        const exitTransitions = [];
        for (let i = 0; i < 30; i++) {
          window.__GAME__.simulation.step(1 / 60);
          exitTransitions.push(window.__GAME__.actions.getAimTransition());
        }
        const returnTransition = window.__GAME__.actions.getAimTransition();
        const returnCamDist = Math.hypot(camera.position.x - car.position.x, camera.position.z - car.position.z);

        return {
          initialTransition,
          initCamDist,
          transitions,
          endAimTransition,
          cockpitCamDist,
          camHeightInCockpit,
          aimAngles,
          drivenSpeed,
          carMoved,
          exitTransitions,
          returnTransition,
          returnCamDist
        };
      });

      assertEqual(aimReport.initialTransition, 0, 'Initial aim transition is 0 in 3rd person');
      assert(aimReport.initCamDist > 3.0, `Chase camera should sit behind car (>3m), got ${aimReport.initCamDist.toFixed(2)}m`);
      assert(aimReport.endAimTransition > 0.8, `Aim transition should smoothly approach 1.0, got ${aimReport.endAimTransition.toFixed(2)}`);
      assert(aimReport.cockpitCamDist < 1.25, `Camera should be inside vehicle cockpit (<1.25m from center), got ${aimReport.cockpitCamDist.toFixed(2)}m`);
      assert(Math.abs(aimReport.camHeightInCockpit - 1.25) < 0.35, `Camera height in cockpit should be at eye level ~1.25m, got ${aimReport.camHeightInCockpit.toFixed(2)}m`);
      assert(Math.abs(aimReport.aimAngles.yaw - Math.PI * 0.75) < 0.05, 'Aim yaw supports 360-degree aiming');
      assert(aimReport.carMoved > 1.0, `Car must still drive normally while in shooting mode (moved ${aimReport.carMoved.toFixed(2)}m)`);
      assert(aimReport.returnTransition < 0.2, `Releasing right mouse must smoothly return transition to 0 (got ${aimReport.returnTransition.toFixed(2)})`);
      assert(aimReport.returnCamDist > 3.0, `Camera must return to 3rd person distance (>3m), got ${aimReport.returnCamDist.toFixed(2)}m`);
    });

    // ------------------------------------------------------------------------
    // Test 28: Shooting Car Front & Back Windows Kills Drivers & Blood Splatters
    // ------------------------------------------------------------------------
    await ctx.test('Vehicle Windows: Shooting front and back windows kills drivers, escalates stars, and covers windows in blood splatters', async () => {
      const windowReport = await harness.evaluate(() => {
        window.__GAME__.police.clearWantedLevel();

        // 1. Spawn a target car in front of camera
        const targetCar1 = new (window.__GAME__.vehicles.getPlayerVehicle().constructor)('target_sedan_front', 0, 0, -8);
        targetCar1.yaw = 0;
        targetCar1.position.set(0, 0, -8);
        targetCar1.initMesh(window.__GAME__.raw.scene);
        targetCar1.mesh.position.set(0, 0, -8);
        window.__GAME__.raw.scene.add(targetCar1.mesh);

        // Aim camera from in front of car (z = -12) directly at targetCar1 front windshield (world Z = -9.4)
        const camera = window.__GAME__.raw.camera;
        camera.position.set(0, 1.15, -12.0);
        camera.lookAt(0, 1.1, -8.0);
        camera.updateMatrixWorld(true);

        if (window.__GAME__.actions.resetWeaponCooldown) {
          window.__GAME__.actions.resetWeaponCooldown();
        }
        window.__GAME__.actions.selectWeapon('Pistol');
        window.__GAME__.actions.shootWeapon();
        window.__GAME__.simulation.step(1 / 60);

        const frontDriverDead = window.__GAME__.vehicles.isDriverDead(targetCar1);
        const frontHasBlood = window.__GAME__.vehicles.hasWindowBlood(targetCar1, 'front');
        const frontWinMesh = targetCar1.mesh.getObjectByName('windshield');
        const frontDecalMesh = frontWinMesh ? frontWinMesh.getObjectByName('window_blood_decal') : null;

        // 2. Spawn second target car and shoot its back window
        const targetCar2 = new (window.__GAME__.vehicles.getPlayerVehicle().constructor)('target_sedan_rear', 0, 0, 8);
        targetCar2.yaw = 0;
        targetCar2.position.set(0, 0, 8);
        targetCar2.initMesh(window.__GAME__.raw.scene);
        targetCar2.mesh.position.set(0, 0, 8);
        window.__GAME__.raw.scene.add(targetCar2.mesh);

        // Aim camera from behind car (z = 12) directly at targetCar2 back window (local Z = 0.8, world Z = 8.8)
        camera.position.set(0, 1.1, 12.0);
        camera.lookAt(0, 1.05, 8.0);
        camera.updateMatrixWorld(true);

        if (window.__GAME__.actions.resetWeaponCooldown) {
          window.__GAME__.actions.resetWeaponCooldown();
        }
        window.__GAME__.actions.shootWeapon();
        window.__GAME__.simulation.step(1 / 60);

        const backDriverDead = window.__GAME__.vehicles.isDriverDead(targetCar2);
        const backHasBlood = window.__GAME__.vehicles.hasWindowBlood(targetCar2, 'back');
        const rearWinMesh = targetCar2.mesh.getObjectByName('rear_glass');
        const rearDecalMesh = rearWinMesh ? rearWinMesh.getObjectByName('window_blood_decal') : null;

        // 3. Shoot Police Cruiser window and verify wanted level escalation
        window.__GAME__.police.setWantedLevel(1);
        const wantedBefore = window.__GAME__.police.getWantedLevel();
        const pCruiser = window.__GAME__.police.spawnPoliceCar({ x: 30, z: 30 });
        pCruiser.position.set(30, 0, 30);
        pCruiser.yaw = 0;
        if (pCruiser.mesh) pCruiser.mesh.position.set(30, 0, 30);

        camera.position.set(30, 1.15, 26.0);
        camera.lookAt(30, 1.1, 30.0);
        camera.updateMatrixWorld(true);

        if (window.__GAME__.actions.resetWeaponCooldown) {
          window.__GAME__.actions.resetWeaponCooldown();
        }
        window.__GAME__.actions.shootWeapon();
        window.__GAME__.simulation.step(1 / 60);

        const policeDriverDead = window.__GAME__.vehicles.isDriverDead(pCruiser);
        const policeHasBlood = window.__GAME__.vehicles.hasWindowBlood(pCruiser, 'front');
        const wantedAfter = window.__GAME__.police.getWantedLevel();

        // Cleanup
        window.__GAME__.police.clearWantedLevel();
        window.__GAME__.raw.scene.remove(targetCar1.mesh);
        window.__GAME__.raw.scene.remove(targetCar2.mesh);

        return {
          frontDriverDead,
          frontHasBlood,
          hasFrontDecal: !!frontDecalMesh,
          backDriverDead,
          backHasBlood,
          hasBackDecal: !!rearDecalMesh,
          wantedBefore,
          policeDriverDead,
          policeHasBlood,
          wantedAfter
        };
      });

      assertEqual(windowReport.frontDriverDead, true, 'Shooting front windshield must kill the driver');
      assertEqual(windowReport.frontHasBlood, true, 'Front windshield must have blood splatter flag');
      assertEqual(windowReport.hasFrontDecal, true, 'Front windshield must mount blood splatter decal');

      assertEqual(windowReport.backDriverDead, true, 'Shooting rear window must kill the driver');
      assertEqual(windowReport.backHasBlood, true, 'Rear window must have blood splatter flag');
      assertEqual(windowReport.hasBackDecal, true, 'Rear window must mount blood splatter decal');

      assertEqual(windowReport.wantedBefore, 1, 'Initial police wanted level is 1');
      assertEqual(windowReport.policeDriverDead, true, 'Police cruiser driver must die when window is shot');
      assertEqual(windowReport.policeHasBlood, true, 'Police cruiser window must have blood splatters');
      assert(
        windowReport.wantedAfter > windowReport.wantedBefore,
        `Killing police cruiser driver must increase wanted stars (before=${windowReport.wantedBefore}, after=${windowReport.wantedAfter})`
      );
    });

  } finally {
    console.log('\n[Teardown] Shutting down browser session...');
    await harness.close();
  }

  return ctx.summary();
}

// Direct execution entry point
if (require.main === module) {
  const browserArg = process.argv.find(a => a.startsWith('--browser='));
  const browser = browserArg ? browserArg.split('=')[1] : 'auto';
  const verbose = process.argv.includes('--verbose');

  runFunctionalTests({ browser, verbose })
    .then(summary => {
      process.exit(summary.failed > 0 ? 1 : 0);
    })
    .catch(err => {
      console.error('Fatal Test Suite Error:', err);
      process.exit(1);
    });
}

module.exports = {
  runFunctionalTests
};
