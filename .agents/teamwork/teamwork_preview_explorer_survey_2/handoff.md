# Handoff Report: Physics & Collision Survey for Player-Drivable Vehicles (R1)

**Agent ID**: `adf5540b-038f-4f1a-820d-1b9909ef07ee`  
**Role**: `teamwork_preview_explorer_survey_2`  
**Task**: Physics & Collision Survey for Player-Drivable Vehicles  
**Target Repository**: `C:\Users\potat\kajm1ller.github.io-1` (`Game-test` branch)  
**File**: `game.html`  

---

## 1. Observation

### 1.1 Existing Physics and Movement in `game.html`
- **File**: `game.html`
- **Current Physics Loop**:
  - `animate()` runs via `requestAnimationFrame(animate)` (lines 1703–1727).
  - Physics updates do **NOT** use `deltaTime`. Scalar increments are applied directly each frame:
    - Line 403: `const fpMoveSpeed = 0.12;`
    - Lines 1166–1169:
      ```javascript
      if (fpKeys.w) newPos.add(forward.clone().multiplyScalar(fpMoveSpeed));
      if (fpKeys.s) newPos.add(forward.clone().multiplyScalar(-fpMoveSpeed));
      if (fpKeys.a) newPos.add(right.clone().multiplyScalar(-fpMoveSpeed));
      if (fpKeys.d) newPos.add(right.clone().multiplyScalar(fpMoveSpeed));
      ```
  - Movement is strictly kinematic with instant position updates (`myPosition.copy(newPos)`). There is no acceleration curve, momentum, or inertia for the on-foot player.

### 1.2 Collision Detection & Response in `game.html`
- **Collision Registration & Meshes**:
  - Line 357: `const collisionMeshes = [];`
  - Line 358: `const playerRadius = 0.4;`
  - Obstacles are registered as plain objects containing a `THREE.Box3`:
    - Tree trunk collider (lines 1428–1433):
      ```javascript
      const trunkBox = new THREE.Box3(
          new THREE.Vector3(x - 0.5, 0, z - 0.5),
          new THREE.Vector3(x + 0.5, 5 * heightVariation, z + 0.5)
      );
      const placeholder = { userData: { worldBox: trunkBox, height: 5 * heightVariation } };
      collisionMeshes.push(placeholder);
      ```
    - Rock collider (lines 1451–1455): Only rocks with `scale > 0.8` are added:
      ```javascript
      const rockBox = new THREE.Box3(
          new THREE.Vector3(x - scale, 0, z - scale),
          new THREE.Vector3(x + scale, scale * 1.2, z + scale)
      );
      collisionMeshes.push({ userData: { worldBox: rockBox, height: scale * 1.2 } });
      ```
- **Collision Checking Method**:
  - Lines 1100–1123:
    ```javascript
    const _playerBox = new THREE.Box3();
    const _playerHalfSize = new THREE.Vector3(playerRadius, 0.9, playerRadius);
    
    function checkCollision(newPosition) {
        if (collisionMeshes.length === 0) return false;
        
        _playerBox.min.set(
            newPosition.x - playerRadius,
            newPosition.y + 0.1,
            newPosition.z - playerRadius
        );
        _playerBox.max.set(
            newPosition.x + playerRadius,
            newPosition.y + 1.8,
            newPosition.z + playerRadius
        );
        
        for (let i = 0, len = collisionMeshes.length; i < len; i++) {
            const box = collisionMeshes[i].userData.worldBox;
            if (box && _playerBox.intersectsBox(box)) return true;
        }
        return false;
    }
    ```
- **Spatial Partitioning**:
  - **None**. `checkCollision` performs an $O(N)$ linear scan over `collisionMeshes` (length ~100–120 in default procedural generation).
- **Collision Response (Wall Sliding)**:
  - Lines 1171–1191: Discrete try-and-revert. If diagonal movement collides, it tests X-axis movement alone, then Z-axis movement alone.

### 1.3 Raycasting Mechanisms
- Lines 500–503:
  ```javascript
  sprayRaycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  sprayRaycaster.far = 20;
  const intersects = sprayRaycaster.intersectObjects(sprayTargetMeshes, false);
  ```
- Used solely for spray can decals and image pasting. No raycasting is currently used for vehicle wheels, ground suspension, or pathfinding line-of-sight.

### 1.4 Environment Boundaries and World Representation
- **Ground Plane**:
  - Lines 390–396:
    ```javascript
    const groundGeometry = new THREE.PlaneGeometry(600, 600, 1, 1);
    const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x5a8f2a });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.name = 'ground';
    scene.add(ground);
    ```
- **Boundary Colliders**:
  - **None**. The world has no edge walls or boundary checks. Players and vehicles can travel beyond $[-300, 300]$ into empty sky.
- **Procedural Distribution**:
  - Line 1487: `mapRadius = 120`. 80 trees, 40 rocks, and 300 grass clumps are scattered within radius 120 around $(0, 0, 0)$.

### 1.5 Analysis of Prior Vehicle Implementation in Git History (`7e9eef5`)
Prior commit `7e9eef5` contained an early prototype car implementation that was replaced in commit `5304235`:
- **Model Construction**:
  - `createHondaCivic()` procedurally assembled a sedan from Three.js primitives (`BoxGeometry`, `CylinderGeometry`) with body (2.2 x 0.7 x 4.5), cabin, windshield, lights, bumpers, and 4 wheels.
- **Physics Variables & Constants**:
  - `carMaxSpeed = 0.8;`
  - `carAcceleration = 0.015;`
  - `carBrakeForce = 0.03;`
  - `carFriction = 0.005;`
  - `carTurnSpeed = 0.03;`
  - `carEnterDistance = 4;`
- **Key Defects Discovered in `7e9eef5` Vehicle Physics**:
  1. **AABB Rotation Blindness**:
     In `7e9eef5:game.html` lines 934–941:
     ```javascript
     const carBox = new THREE.Box3().setFromCenterAndSize(
         newCarPos.clone().setY(0.5),
         new THREE.Vector3(2.4, 1.2, 4.7)
     );
     if (carBox.intersectsBox(mesh.userData.worldBox)) { carHitBuilding = true; }
     ```
     `THREE.Box3` is an **Axis-Aligned Bounding Box (AABB)**. When the vehicle turned by 90 degrees (facing along X instead of Z), the collision box did **not** rotate; it stayed 2.4 units wide along X and 4.7 units long along Z. This caused massive phantom collisions on the sides and allowed the nose and rear of the vehicle to clip completely through obstacles.
  2. **Unsafe Rebound & Tunneling**:
     In `7e9eef5:game.html` lines 975–980:
     ```javascript
     carSpeed *= -0.3;
     carMesh.position.add(forward.clone().multiplyScalar(-0.5));
     ```
     Moving the vehicle backwards along `forward` by a fixed scalar `-0.5` causes two severe bugs:
     - If the vehicle was reversing when it collided, `-forward * -0.5` pushes it **further into** the obstacle.
     - If penetration depth is $> 0.5$, the vehicle remains inside the obstacle next frame, oscillating endlessly or tunneling through.
  3. **No Zero-Vector Guard (NaN / Infinity vulnerability)**:
     Vector normalization was performed without checking for near-zero magnitude, e.g.:
     `const impulse = forward.clone().normalize().multiplyScalar(...);`
     If direction vectors collapse or position overlaps exactly ($d=0$), normalization yields `(NaN, NaN, NaN)`, which irreversibly corrupts Three.js matrix transforms.
  4. **Unchecked Exit Placement**:
     Player exit placed the player at a fixed offset:
     ```javascript
     const exitOffset = new THREE.Vector3(Math.cos(carYaw) * 3, 0, -Math.sin(carYaw) * 3);
     myPosition.copy(carMesh.position).add(exitOffset);
     ```
     There was no collision verification on `myPosition`. If the vehicle parked alongside a building or rock, the player was teleported inside the obstacle with no way to escape.
  5. **Dead / Orphan Code in Current `game.html`**:
     Lines 548–926 of `game.html` contain fragmented remnant methods from an old house combat system (`enterHouse`, `checkHouseEntry`, `rollDamage`, `remoroAttack`, etc.) with reference errors (e.g. line 549 uses undefined variable `t`).

---

## 2. Logic Chain

```
[Observation 1.1: requestAnimationFrame without deltaTime]
  │
  ▼
[Inference 2.1: Frame-rate dependency] ──▶ Simulation will run at different speeds across 60Hz, 144Hz,
                                           and headless test environments.
  │
  ▼
[Conclusion 4.1: Physics must integrate via explicit deltaTime with fixed/clamped step]

[Observation 1.2 & 1.5.1: AABB used for rotating car]
  │
  ▼
[Inference 2.2: Bounding volume deformation] ──▶ At non-zero yaw, AABB either under-covers or
                                                 over-covers the rotated vehicle geometry.
  │
  ▼
[Conclusion 4.2: Must use 2D Oriented Bounding Box (OBB) with SAT or Multi-Circle approximation]

[Observation 1.2: O(N) linear scan over collisionMeshes]
  │
  ▼
[Inference 2.3: Quadratic scaling bottleneck] ──▶ 50+ concurrent vehicles performing linear scans
                                                  yields 50 * (100 + 50) = 7,500 tests/frame.
  │
  ▼
[Conclusion 4.3: Broadphase spatial hash grid is required for R3 performance]

[Observation 1.5.2 & 1.5.3: Fixed bounce back and unguarded normalizations]
  │
  ▼
[Inference 2.4: Physics state corruption] ──▶ Reverse-ramming embeds vehicles deeper;
                                             zero-vector normalization creates NaNs.
  │
  ▼
[Conclusion 4.4: MTV contact normal separation + finite number validation with recovery state]

[Observation 1.5.4: Fixed exit offset without collision test]
  │
  ▼
[Inference 2.5: Player trap vulnerability] ──▶ Exiting next to an obstacle traps player inside.
  │
  ▼
[Conclusion 4.5: Multi-candidate lateral exit validation (Left -> Right -> Rear)]
```

---

## 3. Caveats

1. **Terrain Planarity**:
   - The current game world is purely planar at $y=0$ (ground plane). If non-flat 3D terrain with hills or ramps is introduced in the future, vertical suspension raycasting (e.g., 4-wheel raycast spring-damper model) will be needed. For the flat ground in `game.html`, a 2D planar physics model ($X, Z$) is both optimal and computationally superior.
2. **Pedestrian Ragdolls**:
   - While `7e9eef5` had pedestrian ragdoll collision, the current `game.html` has no active pedestrians. Vehicle-to-pedestrian collision is omitted unless pedestrians are re-introduced.
3. **Sound / Audio**:
   - Engine acceleration sounds and impact sound effects improve immersion, but acceptance criteria focus on headless functional verification and 60 FPS performance benchmark. Audio should be non-blocking.

---

## 4. Conclusion & Technical Specifications for R1

### 4.1 Vehicle State Machine
Each vehicle entity must maintain an explicit state:
```
           ┌───────────────────────────────────────────────┐
           │                                               │
           ▼                                               │
      ┌─────────┐         Player Enters (E)          ┌──────────┐
      │ PARKED  │ ─────────────────────────────────▶ │ OCCUPIED │
      └─────────┘                                    └──────────┘
           ▲                                               │
           │                                               │ Gas/Brake Input
           │           Player Exits (E)                    ▼
           └──────────────────────────────────────── ┌──────────┐
               (|v| < 5.0 m/s & clear exit)          │ DRIVING  │
                                                     └──────────┘
```
- **`VehicleState.PARKED`**:
  - `driver = null`
  - Engine idle, wheels stationary, speed decays to 0 via rolling friction.
  - Interactivity: Can be entered if player is within `ENTER_RADIUS = 3.5m`.
- **`VehicleState.OCCUPIED`**:
  - `driver = player`
  - Headlights turn on, on-foot player model hidden, camera snaps to vehicle follow mode.
  - Zero velocity, waiting for throttle.
- **`VehicleState.DRIVING`**:
  - Responsive acceleration, braking, reversing, Ackermann steering, wheel rotation, body pitch/roll heave.

### 4.2 Mathematical Vehicle Physics Model (Bicycle Kinematic Model)
To ensure smooth 60 FPS performance across 50+ concurrent vehicles without rigid-body physics solver overhead or numerical jitter, implement an **Extended Kinematic Bicycle Model with Momentum and Drag**:

#### Parameters:
| Constant | Value | Description |
|---|---|---|
| `WHEELBASE` ($L$) | $2.6\text{ m}$ | Distance between front and rear axle |
| `TRACK_WIDTH` ($W$) | $1.8\text{ m}$ | Vehicle body width |
| `VEHICLE_LENGTH` | $4.5\text{ m}$ | Total bumper-to-bumper length |
| `MAX_SPEED_FWD` ($v_{max}$) | $28.0\text{ m/s}$ ($\sim 62\text{ mph}$) | Maximum forward velocity |
| `MAX_SPEED_REV` ($v_{rev}$) | $9.0\text{ m/s}$ ($\sim 20\text{ mph}$) | Maximum reverse velocity |
| `ACCEL_RATE` ($a_0$) | $14.0\text{ m/s}^2$ | Base acceleration rate |
| `BRAKE_RATE` ($a_{brk}$) | $22.0\text{ m/s}^2$ | Braking deceleration rate |
| `REVERSE_ACCEL` | $8.0\text{ m/s}^2$ | Reverse gear acceleration rate |
| `ROLLING_FRICTION` | $1.8\text{ m/s}^2$ | Natural rolling resistance deceleration |
| `AIR_DRAG_COEFF` | $0.0018$ | Quadratic aerodynamic drag coefficient |
| `MAX_STEER_ANGLE` ($\delta_{max}$) | $0.58\text{ rad}$ ($\sim 33^\circ$) | Maximum front wheel steering angle |
| `STEER_RATE` | $4.5\text{ rad/s}$ | Steering input response speed |
| `LATERAL_GRIP` | $9.0$ | Lateral velocity damping factor |

#### Physics Update Step (per frame with $\Delta t \le 0.05\text{s}$):
1. **Throttle & Speed Integration**:
   - Let throttle input $u_{th} \in [-1, 1]$ (W = $+1$, S = $-1$, None = $0$).
   - If $u_{th} > 0$:
     - Forward acceleration with power curve:
       $$a = a_0 \cdot \left(1.0 - \frac{v}{v_{max}}\right)$$
       $$v \leftarrow \min(v_{max}, v + a \cdot \Delta t)$$
   - If $u_{th} < 0$:
     - If $v > 0.1\text{ m/s}$ (moving forward): apply braking:
       $$v \leftarrow \max(0, v - a_{brk} \cdot \Delta t)$$
     - Else (stopped or reversing): apply reverse gear acceleration:
       $$v \leftarrow \max(-v_{rev}, v - a_{rev} \cdot \Delta t)$$
   - If $u_{th} == 0$:
     - Rolling resistance: $v \leftarrow v - \text{sign}(v) \cdot a_{roll} \cdot \Delta t$
     - Aerodynamic drag: $v \leftarrow v - \text{sign}(v) \cdot c_{drag} \cdot v^2 \cdot \Delta t$
     - Deadband: If $|v| < 0.02\text{ m/s}$, clamp $v = 0$.
2. **Steering & Yaw Rate (Ackermann Steering)**:
   - Let steer input $u_{st} \in [-1, 1]$ (A = $+1$, D = $-1$, None = $0$).
   - Target steer angle: $\delta_{target} = u_{st} \cdot \delta_{max} \cdot \max\left(0.35, 1.0 - \frac{|v|}{v_{max}} \cdot 0.5\right)$ (speed-sensitive steering).
   - Smooth steering angle: $\delta \leftarrow \text{lerp}(\delta, \delta_{target}, 1.0 - e^{-\text{STEER\_RATE} \cdot \Delta t})$.
   - Yaw angular velocity:
     $$\omega = \frac{v}{L} \cdot \tan(\delta)$$
   - Heading update:
     $$\theta \leftarrow \theta + \omega \cdot \Delta t$$
     Normalize $\theta \in [-\pi, \pi]$.
3. **Displacement & Lateral Velocity**:
   - Forward unit vector: $\vec{f} = (-\sin\theta, 0, -\cos\theta)$
   - Right unit vector: $\vec{r} = (\cos\theta, 0, -\sin\theta)$
   - Damped lateral velocity: $\vec{v}_{lat} \leftarrow \vec{v}_{lat} \cdot \max(0.0, 1.0 - \text{LATERAL\_GRIP} \cdot \Delta t)$
   - Displacement: $\Delta\vec{p} = (\vec{f} \cdot v + \vec{v}_{lat}) \cdot \Delta t$
   - Tentative position: $\vec{p}_{new} = \vec{p} + \Delta\vec{p}$

### 4.3 Collision Detection: 2D OBB with SAT & Multi-Circle Formulation
Because the terrain is flat ($y=0$), all collision checks are performed in the 2D horizontal plane ($X, Z$).

#### Approach A: 2D Oriented Bounding Box (OBB) vs AABB via SAT (Exact)
- An obstacle AABB is defined by $\text{min}(x, z)$ and $\text{max}(x, z)$.
- The vehicle OBB is defined by center $(x, z)$, half-extents $(W/2 = 0.9, L/2 = 2.25)$, and orientation vectors $\vec{u}_{long} = (-\sin\theta, -\cos\theta)$ and $\vec{u}_{lat} = (\cos\theta, -\sin\theta)$.
- Test 4 separating axes:
  1. $\vec{A}_1 = (1, 0)$ (AABB X-axis)
  2. $\vec{A}_2 = (0, 1)$ (AABB Z-axis)
  3. $\vec{A}_3 = \vec{u}_{long}$ (Vehicle longitudinal axis)
  4. $\vec{A}_4 = \vec{u}_{lat}$ (Vehicle lateral axis)
- For each axis, compute 1D interval projections. If an axis has disjoint intervals, return `{ hit: false }`.
- If all 4 axes overlap, collision occurs. Find the axis with **minimum overlap depth**; this gives the **Minimum Translation Vector (MTV)** and contact normal $\vec{N}$.

#### Approach B: 3-Circle Approximation (Ultra-Fast for 50+ Vehicles)
- Decompose vehicle into 3 overlapping circles:
  - Center: $\vec{c}_0 = \vec{p}$, $R = 1.05\text{ m}$
  - Front: $\vec{c}_1 = \vec{p} + \vec{f} \cdot 1.25\text{ m}$, $R = 1.05\text{ m}$
  - Rear: $\vec{c}_2 = \vec{p} - \vec{f} \cdot 1.25\text{ m}$, $R = 1.05\text{ m}$
- **Circle vs Obstacle AABB**:
  - For each circle $k \in \{0, 1, 2\}$:
    - Closest point on box: $q_x = \text{clamp}(c_{k.x}, \text{box.min.x}, \text{box.max.x})$, $q_z = \text{clamp}(c_{k.z}, \text{box.min.z}, \text{box.max.z})$.
    - Distance squared: $d^2 = (c_{k.x} - q_x)^2 + (c_{k.z} - q_z)^2$.
    - If $d^2 < R^2$: collision with depth $R - d$ and normal $\frac{\vec{c}_k - \vec{q}}{d}$.
- **Circle vs Circle (Vehicle vs Vehicle)**:
  - Single distance check between center points: $(x_a - x_b)^2 + (z_a - z_b)^2 < (R_a + R_b)^2$.

### 4.4 Defensive Collision Response & NaN/Infinity Prevention
To guarantee zero uncaught exceptions and prevent NaN matrix corruption:
1. **Zero-Vector / Overlap Safeguard**:
   ```javascript
   let dist = Math.hypot(normalX, normalZ);
   if (dist < 1e-5) {
       // Complete center overlap: push along vehicle lateral or reverse
       normalX = Math.cos(vehicle.yaw);
       normalZ = -Math.sin(vehicle.yaw);
       depth = 0.1;
   } else {
       normalX /= dist;
       normalZ /= dist;
   }
   ```
2. **Positional Separation along Contact Normal**:
   ```javascript
   const pushDist = depth + 0.01; // small margin prevents re-sticking
   vehicle.position.x += normalX * pushDist;
   vehicle.position.z += normalZ * pushDist;
   ```
3. **Impulse & Velocity Reflection**:
   ```javascript
   // Project velocity onto normal
   const vDotN = vehicle.velocity.x * normalX + vehicle.velocity.z * normalZ;
   if (vDotN < 0) { // moving into obstacle
       const restitution = 0.25; // slight elastic rebound
       const impulse = -(1.0 + restitution) * vDotN;
       vehicle.velocity.x += normalX * impulse;
       vehicle.velocity.z += normalZ * impulse;
       
       // Recompute forward speed from reflected velocity
       const fwdX = -Math.sin(vehicle.yaw);
       const fwdZ = -Math.cos(vehicle.yaw);
       vehicle.speed = vehicle.velocity.x * fwdX + vehicle.velocity.z * fwdZ;
   }
   ```
4. **NaN Integrity Validator**:
   ```javascript
   if (!Number.isFinite(vehicle.position.x) || !Number.isFinite(vehicle.position.z) || !Number.isFinite(vehicle.speed)) {
       console.error("Collision produced non-finite values! Restoring last safe position.");
       vehicle.position.copy(vehicle.lastSafePosition);
       vehicle.speed = 0;
       vehicle.velocity.set(0, 0);
   } else {
       vehicle.lastSafePosition.copy(vehicle.position);
   }
   ```
5. **Environment World Boundaries Clamping**:
   - World boundaries: $X \in [-280, 280]$, $Z \in [-280, 280]$.
   ```javascript
   const BOUND = 280.0;
   if (Math.abs(vehicle.position.x) > BOUND) {
       vehicle.position.x = Math.sign(vehicle.position.x) * BOUND;
       vehicle.speed *= -0.2;
   }
   if (Math.abs(vehicle.position.z) > BOUND) {
       vehicle.position.z = Math.sign(vehicle.position.z) * BOUND;
       vehicle.speed *= -0.2;
   }
   ```

### 4.5 Enter & Exit Mechanics Specification
- **Interaction Distance**: `ENTER_DISTANCE = 3.5m`.
- **HUD Indicator**: When player is on foot and within 3.5m of an unoccupied vehicle, display `"Press [E] to Drive"`.
- **Enter Action (`E` key press)**:
  1. Verify `player.currentVehicle === null` and `vehicle.driver === null` and `distance < ENTER_DISTANCE`.
  2. Preserve player on-foot inventory, spray settings, and camera angles.
  3. Set `vehicle.driver = player`, `player.currentVehicle = vehicle`.
  4. Hide player avatar / disable first-person spray viewmodel.
  5. Show speedometer HUD element.
  6. Switch active controls to Vehicle Driving input mode.
- **Exit Action (`E` key press)**:
  1. Verify vehicle speed is safe: $|v| < 5.0\text{ m/s}$ (prevent exiting at terminal velocity).
  2. Generate 4 candidate exit positions relative to vehicle:
     - Candidate 1 (Left / Driver door): $\vec{p} + \vec{r} \cdot (-2.0\text{m})$
     - Candidate 2 (Right / Passenger door): $\vec{p} + \vec{r} \cdot (+2.0\text{m})$
     - Candidate 3 (Rear): $\vec{p} - \vec{f} \cdot (3.0\text{m})$
     - Candidate 4 (Front): $\vec{p} + \vec{f} \cdot (3.0\text{m})$
  3. Test candidate positions against `checkCollision(candidatePos)`.
  4. Select the first non-colliding candidate position.
  5. Place player at validated exit position.
  6. Unbind driver: `vehicle.driver = null`, `player.currentVehicle = null`.
  7. Re-enable on-foot movement, restore first-person camera / viewmodel, hide speedometer HUD.

### 4.6 Input Mapping Matrix
| Control Action | Key / Mouse | On-Foot Mode | In-Vehicle Mode |
|---|---|---|---|
| Forward | `W` / `ArrowUp` | Walk forward | Accelerate forward |
| Reverse / Brake | `S` / `ArrowDown` | Walk backward | Brake / Reverse gear |
| Turn Left | `A` / `ArrowLeft` | Strafe left | Steer wheels left |
| Turn Right | `D` / `ArrowRight` | Strafe right | Steer wheels right |
| Handbrake | `Space` | (Jump / Dev Fly up) | Instant handbrake friction |
| Enter / Exit | `E` | Enter nearby vehicle | Exit vehicle to safe side |
| Camera Mode | `V` | Toggle Spray/Decal | Toggle 3rd-Person Chase / 1st-Person Cockpit |
| Look / Aim | Mouse Move | First-person look | Orbit / Pan vehicle camera |

### 4.7 Testing & Automated Verification Interface
To satisfy the automated headless browser acceptance criteria without fragile DOM scraping, expose a clean testing API on `window`:
```javascript
window.__GAME__ = {
    player: {
        getPosition: () => myPosition.clone(),
        isInVehicle: () => playerInVehicle,
        getVehicle: () => currentVehicle
    },
    vehicles: vehicleManager.vehicles,
    enterNearestVehicle: () => tryEnterVehicle(),
    exitCurrentVehicle: () => tryExitVehicle(),
    setVehicleInput: (inputObj) => { /* { w, a, s, d, space } */ },
    simulateTicks: (count, dt) => { /* step simulation deterministically */ },
    getMetrics: () => ({ fps, avgFrameTimeMs, activeVehicles: vehicleManager.vehicles.length })
};
```

---

## 5. Verification Method

### 5.1 Independent Code Verification
1. Inspect `game.html` lines 1099–1123 to verify current AABB collision implementation.
2. Inspect `game.html` lines 1427–1460 to verify tree and rock collider creation into `collisionMeshes`.
3. Run `git show 7e9eef5:game.html | grep -A 30 "function updateCarDriving"` to inspect prior vehicle code and confirm AABB rotation and bounce defects.

### 5.2 Automated Headless Browser Verification Command
When the implementation is built, verify against Playwright / Chromium headless using the local Node server:
```bash
# Start server
node server.js &
# Run headless test script
npx playwright test
```
The test must confirm:
1. Console error log has 0 uncaught exceptions or page errors.
2. Player moves within 3.5m of vehicle and enters via `E`.
3. Steering and acceleration change vehicle `position` and `yaw` over 60 simulated ticks.
4. Driving into a tree trunk results in velocity dampening and collision bounce without `position.x`, `position.z`, or `speed` becoming `NaN` or `Infinity`.
5. Exiting via `E` places the player adjacent to the vehicle with `inVehicle === false`.

### 5.3 Invalidation Conditions
This survey and its architectural model will be invalidated if:
- 3D uneven heightmapped terrain is added to `game.html` (requiring full 3D suspension raycasts).
- A 3D rigid body physics engine (e.g. Rapier) is mandated instead of the lightweight 2D kinematic bicycle model.
