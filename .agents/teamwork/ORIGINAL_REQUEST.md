# Original User Request

## 2026-10-19T21:27:33Z

Add both player-drivable vehicles and autonomous AI traffic to `game.html` (on the `Game-test` git branch), and optimize the rendering and physics loop to smoothly support a high number of concurrent entities on screen.

Working directory: C:\Users\potat\kajm1ller.github.io-1
Integrity mode: development

## Requirements

### R1. Player-Drivable Vehicles
Players must be able to enter and exit vehicles seamlessly, and drive them with responsive physics and controls (acceleration, braking/reversing, steering) including proper collision detection and response against the environment, obstacles, and other entities.

### R2. Autonomous AI Traffic
Autonomous vehicles must spawn and navigate along roads or valid paths in the game world, following traffic/pathing logic and reacting appropriately to obstacles, other vehicles, and the player.

### R3. Rendering & Physics Loop Optimization
Optimize the game's update, collision/physics, and rendering pipelines so that it supports a large number of concurrent active vehicles and entities on screen simultaneously without frame drops or stuttering. The team may split files or introduce libraries/bundlers if helpful, while keeping `game.html` as the working entry point.

## Acceptance Criteria

### Functional Vehicle & Traffic Verification (Automated Headless Browser Test)
- [ ] `game.html` loads cleanly in a headless browser with zero uncaught console errors or page exceptions.
- [ ] Automated test script verifies player vehicle interaction: player can enter a nearby vehicle, accelerate/steer to change position and heading over simulated ticks, collide with an obstacle without NaN/infinite state corruption, and exit the vehicle back to on-foot state.
- [ ] Automated test script verifies AI traffic: multiple autonomous vehicles spawn and actively progress along paths over time without getting permanently stuck or overlapping each other in invalid collision states.

### Performance & Scalability Verification (Automated Benchmark)
- [ ] Under an automated stress benchmark with high concurrent entity/vehicle counts (e.g., 50+ active vehicles/entities updating and rendering simultaneously), average frame/tick processing time stays within a 60 FPS budget (< 16.6ms per frame) with no memory leak growth over 1,000+ frames.


## 2026-10-19T23:10:33Z

CRITICAL USER REQUIREMENT UPDATE — APPLY IMMEDIATELY:

The user just clarified two mandatory requirements for `game.html` in `C:\Users\potat\kajm1ller.github.io-1`:
1. **Use the Kaj Simulator basis for the cars that you drive, and optimize them**:
   - In git history of this repo, commit `7e9eef5` (`git show 7e9eef5:game.html`) contains the full "Kaj Simulator" implementation, which has the original `// === HONDA CIVIC CAR SYSTEM ===` (`createHondaCivic()` with sedan body, cabin, windshield, rear/side glass, headlights, taillights, wheels/hubcaps, bumpers, `#car-indicator` `(E) Enter Car`, `#car-speed-hud` `Speed: X mph`, `enterCar()`, `exitCar()`, `updateCarDriving()` supporting both first-person and isometric/chase views, pedestrian hit/ragdoll interactions, etc.).
   - Merge commit `50f7488` had partially overwritten `7e9eef5` with the spray-paint test (`5304235`).
   - You MUST use the Kaj Simulator car design/basis from `7e9eef5:game.html` for the cars you drive, and optimize those cars (shared geometries/materials, zero-allocation physics/collision updates via `SpatialGrid`, smooth handling, HUD integration).
2. **The map MUST be the one stored in `/anothermapo` (and optimized)**:
   - Instead of only the procedural grass/trees test world from `5304235`, `game.html` must load and use the actual map stored in `/anothermapo/` (`materials.mtl` + `part0000.obj` through `part0029.obj`, plus `/anothermapo/map.osm` for road/waypoint coordinates, just as in `7e9eef5:game.html`), and optimize the `/anothermapo` map loading/rendering/collision (e.g., registering `/anothermapo` building/wall bounding boxes into `SpatialGrid` instead of O(N) brute-force `collisionMeshes` iteration, optimizing materials/culling/draw calls so `/anothermapo` runs at 60 FPS alongside the drivable Kaj Simulator cars and AI traffic).

Please immediately update `ORIGINAL_REQUEST.md` and `PROJECT.md`, and forward this directive to the active Orchestrator (`d16b4fcb-cc0f-419f-b27d-df8ab76a97e3` or current generation successor) so that Milestone 3 / remediation incorporates the `/anothermapo` map and the `7e9eef5:game.html` Kaj Simulator car basis, and ensure the E2E tests and Victory Auditor verify both!
