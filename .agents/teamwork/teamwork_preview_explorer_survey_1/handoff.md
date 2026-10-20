# Codebase & Architecture Survey Report

## 1. Observation

### 1.1 Fatal Startup Exception in `game.html` on Branch `Game-test`
Running `game.html` in headless Microsoft Edge via Chrome DevTools Protocol (CDP) yielded an immediate fatal unhandled exception at startup:
```text
RUNTIME EXCEPTION: {"exceptionId":1,"text":"Uncaught","lineNumber":928,"columnNumber":27,"scriptId":"3","url":"http://localhost:3456/game.html","exception":{"type":"object","subtype":"error","className":"ReferenceError","description":"ReferenceError: viewmodelScene is not defined\n    at initViewmodelScene (http://localhost:3456/game.html:929:28)\n    at http://localhost:3456/game.html:1542:9","objectId":"621010953598345983.1.1"},"executionContextId":1}
```

Git history inspection (`git log -n 5 -- game.html` and `git diff 5304235 50f7488 -- game.html`) revealed that merge commit `50f7488` ("Merge branch 'Game-test'") accidentally corrupted `game.html`:
- At line 543, `sprayAtTarget()` was chopped in half and filled with ease-out camera panning code referencing an undeclared variable `t` (lines 548-559).
- Lines 562 to 926 contain orphaned combat and house interior functions (`enterHouse`, `exitHouse`, `checkHouseEntry`, `updateHouseMovement`, `startCombat`, `enemyAttack`, `remoroAttack`, `handlePlayerAction`, etc.) from an older RPG experiment.
- The original variable declarations for the spray viewmodel (`let viewmodelScene = null;`, `let viewmodelCamera = null;`, `let viewmodelSprayCan = null;`, `let viewmodelBobTime = 0;`, `let sprayParticleTime = 0;`) were deleted.
- Because `game.html` uses `<script type="module">` (strict mode is always active), assigning `viewmodelScene = new THREE.Scene()` without `let` in `initViewmodelScene()` throws `ReferenceError: viewmodelScene is not defined` when invoked at line 1542, before `animate()` (line 1727) is ever reached.
- As a direct result, **`game.html` currently does not render or run at all** on `origin/Game-test`.

---

### 1.2 Canvas Setup, Resolution, Scale, and Render Loop
Direct examination of `game.html` (lines 343-397, 1691-1727):
- **Library / Version**: Three.js v0.160.0 loaded via browser importmap:
  ```html
  <script type="importmap">
  {
      "imports": {
          "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
          "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
      }
  }
  </script>
  ```
- **Renderer**:
  - `const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });`
  - Dimensions: `renderer.setSize(window.innerWidth, window.innerHeight);`
  - DPI cap: `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));`
  - Color management: `renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.4; renderer.outputColorSpace = THREE.SRGBColorSpace;`
  - Shadows: Disabled globally (no shadow map calculation overhead).
- **Scene & Fog**:
  - Sky color: `0xa8d8f0`.
  - Linear fog: `scene.fog = new THREE.Fog(0xa8d8f0, 80, 250);` (starts at 80m, obscures beyond 250m).
- **Camera**:
  - Main camera: `const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 300);`
  - Dev fly mode expands `camera.far = 5000;`, normal mode keeps it at 300 or 600.
  - Viewmodel camera (for held spray can overlay): `viewmodelCamera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 10);`
- **Lighting**:
  - Hemisphere light (`0x87ceeb`, `0x556b2f`, intensity 0.8) at (0, 200, 0).
  - Ambient fill (`0xffffff`, 0.5).
  - Main sun directional light (`0xfff5e6`, 1.8) at (80, 180, 60).
  - Secondary fill directional light (`0xc4deff`, 0.5) at (-60, 100, -80).
- **Ground & Scale**:
  - Ground plane: `THREE.PlaneGeometry(600, 600, 1, 1)` rotated `-Math.PI / 2` at Y=0.
  - World coordinate system: 1 unit = 1 meter.
  - Eye level: `camera.position.copy(myPosition).add(new THREE.Vector3(0, 1.7, 0))`.
  - Player radius: `playerRadius = 0.4` (0.8m diameter, 1.7m bounding box height).
- **Render Loop**:
  - Driven by `requestAnimationFrame(animate)`.
  - Executes:
    1. `updateMobileJoystick()`
    2. `devMode ? updateDevFlyCamera() : updatePlayer()`
    3. `updateViewmodel()`
    4. `renderer.render(scene, camera)`
    5. Secondary pass for viewmodel: `renderer.autoClear = false; renderer.clearDepth(); renderer.render(viewmodelScene, viewmodelCamera); renderer.autoClear = true;`
  - **No delta time (`dt`) exists**: Frame-rate dependent updates. Movement uses hardcoded `fpMoveSpeed = 0.12` per frame.

---

### 1.3 Existing Player Implementation
Lines 398-406, 1159-1295, 1342-1365:
- **State variables**:
  - `myPosition = new THREE.Vector3()`
  - `fpCameraYaw = 0; fpCameraPitch = 0;`
  - `fpKeys = { w: false, a: false, s: false, d: false };`
  - `gameStarted = false;` (starts when player enters name and clicks "Join Game").
- **Controls & Keybindings**:
  - Movement: `W` (forward), `S` (backward), `A` (left), `D` (right).
  - Wall sliding: When collision occurs, evaluates movement on X-axis only, then Z-axis only.
  - Camera rotation: Pointer Lock API via `mousemove` (`event.movementX`, `event.movementY`), sensitivity `0.002`, pitch clamped to `[-1.47, 1.47]`.
  - Actions:
    - Left Click: Spray can decal or paste image.
    - Mouse Wheel: Adjust spray or decal size.
    - `C`: Toggle color picker palette.
    - `V`: Toggle mode (spray paint vs image decal paste).
    - `F12`: Toggle Dev Fly Mode (noclip flight with WASD, Space, Shift, Ctrl).
  - Mobile touch:
    - `#mobile-joystick`: calculates directional vector (`joystickDx`, `joystickDy`).
    - `#mobile-look`: touch swipe camera look.
    - Touch action buttons for Spray, Mode, Upload, Color.
- **Visuals**:
  - Local player has no third-person mesh in the world; rendering is purely first-person.
  - The held spray can and arm are rendered in `viewmodelScene`.

---

### 1.4 Existing Entity System, Obstacles, and World Representation
Lines 357-359, 1099-1123, 1367-1540:
- **World representation**:
  - Procedural generation within radius of 120m (`generateWorld()`) using seeded random (`seededRandom(42)`):
    - 80 Trees (`createTree(x, z)`): trunk (Cylinder) + canopy (Sphere).
    - 40 Rocks (`createRock(x, z, scale)`): Dodecahedron geometries.
    - 300 Grass clumps (`createGrassClump(x, z)`): Plane geometries.
    - 6 Rock clusters.
- **Obstacle & Collision representation**:
  - Stored in a single flat array: `const collisionMeshes = [];`.
  - Each tree adds its trunk AABB: `new THREE.Box3(new THREE.Vector3(x - 0.5, 0, z - 0.5), new THREE.Vector3(x + 0.5, 5 * heightVariation, z + 0.5))`.
  - Each rock with `scale > 0.8` adds its bounding box: `new THREE.Box3(new THREE.Vector3(x - scale, 0, z - scale), new THREE.Vector3(x + scale, scale * 1.2, z + scale))`.
  - Collision check (`checkCollision(newPosition)`):
    - Constructs player AABB: `_playerBox.min` and `_playerBox.max`.
    - Iterates over all elements in `collisionMeshes` with linear loop (`for (let i = 0; i < collisionMeshes.length; i++)`).
- **Entity System**:
  - **No entity system currently exists.**
  - There is no base `Entity` class, no list of active dynamic actors, and no update loop for dynamic objects outside the local player camera and spray particles.

---

### 1.5 Code Organization, Bundler, and Package Management
- **File Structure**:
  - `game.html` is 100% monolithic (1,731 lines combining HTML, embedded CSS styles, importmap, and inline module script).
  - No bundler (Vite, Rollup, Webpack) is used.
- **Dependencies (`package.json`)**:
  ```json
  {
    "dependencies": {
      "@dimforge/rapier3d-compat": "^0.19.3",
      "express": "^5.2.1",
      "google-tts-api": "^2.0.2",
      "ring-client-api": "^14.2.0",
      "three": "^0.182.0",
      "ws": "^8.19.0"
    }
  }
  ```
  - Note: `three` v0.182.0 is in `node_modules`, but `game.html` currently loads `three@0.160.0` from unpkg CDN.
  - `@dimforge/rapier3d-compat` is installed in `node_modules` but completely unused in `game.html`.

---

## 2. Logic Chain

1. **Bug Resolution Pre-requisite**:
   - Because `initViewmodelScene()` assigns to undeclared `viewmodelScene` in strict mode at line 929, the script crashes before `animate()` is called.
   - Therefore, no vehicle or traffic feature can run until `game.html` is cleaned up by declaring the missing viewmodel variables and removing the dead merge conflict lines (548-926).

2. **Decoupled Physics & Delta Time**:
   - The original request mandates supporting 50+ concurrent active entities at 60 FPS (<16.6ms per frame) and deterministic headless simulation.
   - The current loop has no `deltaTime`, meaning tick rates are tied to display refresh rates.
   - Therefore, a fixed timestep accumulator (`FIXED_TIMESTEP = 1/60`) must be introduced so physics and traffic logic run stably and deterministically regardless of framerate or background execution.

3. **Collision Performance Bottleneck & Spatial Partitioning**:
   - Currently, `collisionMeshes` has ~110 static obstacles tested linearly O(N).
   - If 50 moving vehicles are added, an all-pairs check is $50 \times 49 / 2 = 1,225$ vehicle-to-vehicle checks plus $50 \times 110 = 5,500$ vehicle-to-obstacle checks per frame ($>6,700$ AABB intersections per frame).
   - Testing 6,700 pairs every frame causes CPU spikes and GC pressure if allocations occur.
   - Therefore, a 2D Spatial Hash Grid (cell size ~15m across the 240m world) is required. Each query only checks the 9 neighboring cells ($O(1)$ lookup time), reducing collision checks by over 90%.

4. **Road Network & Waypoint Graph for AI Traffic**:
   - The current world only has grass, trees, and rocks; there are no roads or pathing structures.
   - AI vehicles must spawn and navigate along valid paths without permanent deadlocks (Requirement R2).
   - Therefore, a procedural road network (e.g. an outer two-lane loop with intersecting cross streets, lanes marked at Y=0.02) must be generated.
   - The road network directly provides directed waypoints with lane offsets (right-hand traffic).
   - AI vehicles follow these waypoints using Pure Pursuit / steering behaviors and sensor sweeps to avoid collisions with vehicles ahead.

5. **Player Vehicle Interaction (Enter/Exit Architecture)**:
   - To fulfill Requirement R1, the player needs a seamless transition between on-foot and in-vehicle states.
   - Proximity detection: When on foot within 3.5m of a vehicle, an interaction prompt ("Press [E] to Drive") appears.
   - On enter:
     - Player state becomes `IN_VEHICLE`.
     - Player is bound as `vehicle.driver`.
     - Camera switches to a third-person chase camera smoothly interpolated behind the vehicle.
     - Controls map to vehicle acceleration (`W`), braking/reversing (`S`), steering (`A`/`D`), and handbrake (`Space`).
   - On exit:
     - Pressing `E` dismounts the player to a clear lateral position beside the vehicle.
     - Player state returns to `ON_FOOT` (first-person camera).
     - The vehicle coasts to a stop with natural drag and rolling friction.

6. **File Organization Strategy**:
   - A 1,731-line monolithic HTML file is prone to merge errors (as demonstrated by commit `50f7488`).
   - Standard browser-native ES module imports (`type="module"`) allow splitting the architecture into focused modules without requiring complex bundler build steps or breaking `game.html` as the entry point.

---

## 3. Caveats

1. **Multiplayer Server Context**:
   - `server.js` contains WebSocket multiplayer handling for positions and shooting, but `game.html` is currently offline/client-side. The vehicle and AI traffic implementation should focus on the single-player/client-side engine first, with entity state designed so multiplayer replication can be cleanly layered on later if desired.
2. **CDN vs Local Dependencies**:
   - `game.html` currently uses unpkg CDN for Three.js. For headless browser tests in environments with restricted internet access, fallback or local resolution to `node_modules/three` is beneficial.
3. **Physics Model Choice**:
   - `@dimforge/rapier3d-compat` exists in `package.json`, but a custom arcade raycast/wheel kinematic physics model is recommended over full Rapier 3D WASM for this application:
     - Zero WASM loading delay or initialization failure modes.
     - Guaranteed zero memory leaks over long sessions.
     - Predictable collision resolution and trivial tuning for arcade vehicle handling (acceleration, drift, braking, obstacle bounce).

---

## 4. Conclusion & Architectural Recommendation

### Recommended Module Layout (Native ES Modules)

Keep `game.html` as the HTML & UI entry point, importing `js/game/main.js`:

```text
C:\Users\potat\kajm1ller.github.io-1\
├── game.html                     # Entry point: canvas, HUD, importmap, imports main.js
└── js\
    └── game\
        ├── config.js             # Physics constants, vehicle tunings, world dimensions
        ├── spatialGrid.js        # 2D Spatial Hash Grid for high-performance collision
        ├── world.js              # Road network generation, terrain, obstacles, lighting
        ├── vehicle.js            # Vehicle class, procedural 3D car mesh, arcade physics
        ├── player.js             # Player state (on-foot vs in-vehicle), interaction prompt, input
        ├── traffic.js            # Waypoint path graph, AI traffic spawner, obstacle avoidance
        ├── camera.js             # Smooth camera controller (first-person ↔ 3rd-person chase)
        └── main.js               # Main game loop, fixed timestep substepping, render passes
```

### Detailed Component Designs

| Component | Responsibility | Performance Technique |
|---|---|---|
| **`SpatialGrid`** | Bucketing static obstacles and dynamic vehicles into 15m cells | $O(1)$ spatial queries; zero allocations during queries (reusable arrays) |
| **`Vehicle`** | Acceleration, braking, steering angle, lateral friction/drift, wheel spin | Reusable `THREE.Vector3` / `THREE.Box3`; simple ray/box collision response |
| **`World`** | Two-lane asphalt road circuit, tree/rock placement clear of roadways | Instanced road segment meshes / shared materials |
| **`PlayerController`** | On-foot movement, entry/exit detection (`[E]`), driving input delegation | Clean state machine (`ON_FOOT` vs `IN_VEHICLE`) |
| **`TrafficManager`** | Spawning, pooling, waypoint following, forward raycast braking | Object pooling (no runtime allocations); kinematic throttling at distance |
| **`CameraManager`** | Seamless first-person (on foot) to third-person chase camera (driving) | Spherical lerp / smooth damping behind vehicle heading |
| **`Main Loop`** | Fixed timestep substepping (1/60s) + variable rendering interpolation | Prevents physics tunneling, maintains 60 FPS under 50+ vehicles |

---

## 5. Verification Method

To independently verify the observations and architectural integrity:

1. **Reproduce the Fatal Startup Error**:
   Run the following Node command from repository root `C:\Users\potat\kajm1ller.github.io-1`:
   ```powershell
   node -e "
   const { spawn } = require('child_process');
   const http = require('http');
   const fs = require('fs');
   const path = require('path');
   const server = http.createServer((req, res) => {
     let p = path.join(process.cwd(), req.url === '/' ? 'game.html' : req.url.split('?')[0]);
     if (fs.existsSync(p) && fs.statSync(p).isFile()) {
       res.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html' : p.endsWith('.js') ? 'application/javascript' : 'text/plain' });
       fs.createReadStream(p).pipe(res);
     } else { res.writeHead(404); res.end(); }
   });
   server.listen(3456, () => {
     const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
       '--headless=new', '--remote-debugging-port=9333', '--disable-gpu', 'http://localhost:3456/game.html'
     ]);
     setTimeout(async () => {
       const resp = await fetch('http://127.0.0.1:9333/json');
       const tabs = await resp.json();
       const tab = tabs.find(t => t.url.includes('3456'));
       const WebSocket = require('ws');
       const ws = new WebSocket(tab.webSocketDebuggerUrl);
       ws.on('open', () => { ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' })); });
       ws.on('message', m => {
         const d = JSON.parse(m);
         if (d.method === 'Runtime.exceptionThrown') {
           console.log('CONFIRMED EXCEPTION:', d.params.exceptionDetails.exception.description);
           edge.kill(); server.close(); process.exit(0);
         }
       });
     }, 2000);
   });
   "
   ```
   **Expected Output**: `ReferenceError: viewmodelScene is not defined at initViewmodelScene (http://localhost:3456/game.html:929:28)`.

2. **Verify Git History of the Merge Conflict**:
   Run:
   ```powershell
   git diff 5304235 50f7488 -- game.html
   ```
   Inspect lines 545-926 to confirm deleted variable declarations and pasted house/combat functions.

3. **Verify Edge Binary Availability**:
   Run:
   ```powershell
   Test-Path "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
   ```
   Returns `True`. Automated test scripts for headless verification can invoke this directly.

4. **Verify Implementation Success Criteria**:
   - Zero console errors in headless browser on page load.
   - Player approaches vehicle, presses `E`, enters vehicle, steers/accelerates, hits obstacle without NaN coordinates, exits vehicle safely.
   - 50+ active AI vehicles spawn, navigate path loop, decelerate when following another vehicle, and maintain average tick/frame processing time $< 16.6\text{ms}$ over 1,000 frames.
