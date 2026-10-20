# Project: Autonomous Vehicles, Traffic & Performance Optimization in Kaj Simulator

## Architecture
- **Engine Core**: Fixed 60Hz timestep accumulator (`stepSimulation(dt)`), window.__GAME__ testing API hook.
- **World Map**: `/anothermapo` city environment (`materials.mtl` + `part0000.obj` .. `part0029.obj`, `map.osm`) with fast async streaming, frustum culling, and building/obstacle AABB indexing into `SpatialGrid`.
- **Road Network**: Directed multi-lane waypoint graph aligned with `/anothermapo` city streets, waypoint lookaheads, clearance masking.
- **Player-Drivable Vehicles**: Kaj Simulator Honda Civic car system (`createHondaCivic()` from `7e9eef5:game.html`) optimized with Extended Kinematic Bicycle physics, speed-sensitive steering, power curves, 3-circle capsule collision response against `SpatialGrid`, HUD (`#car-indicator`, `#car-speed-hud`), and smooth camera transitions.
- **Autonomous AI Traffic**: Pure Pursuit steering, IDM car-following, intersection yellow-box reservation, anti-deadlock watchdog, anti-overlap ($d \ge 2.0\text{m}$).
- **Scalability**: 50+ concurrent active entities, instanced mesh rendering for vehicle bodies and wheels (≤ 3 draw calls), zero-allocation physics/update loop maintaining < 16.6ms avg frame time (60 FPS) and < 2.0MB heap growth over 1,000 frames.

## Feature Inventory
| # | Feature | Description | Milestone | Status |
|---|---------|-------------|-----------|--------|
| 1 | Startup Error Remediation | Fix merge conflict and missing viewmodel declarations in game.html | M1 | DONE |
| 2 | Fixed 60Hz Timestep Loop | Decouple physics/traffic simulation from monitor refresh rate | M1 | DONE |
| 3 | Spatial Hash Grid | 15m 2D broadphase partitioning for O(1) queries with zero allocations | M1 | DONE |
| 4 | Testing Automation API | Expose window.__GAME__ API for headless CDP and benchmark runners | M1 | DONE |
| 5 | /anothermapo City Map | Asynchronous loading of OBJ/MTL parts with SpatialGrid building collision | M2/M3 | IN_PROGRESS |
| 6 | Kaj Simulator Honda Civic | Exact Honda Civic 3D mesh & HUD from 7e9eef5:game.html with kinematic physics | M2/M3 | IN_PROGRESS |
| 7 | Road Network Graph | Directed multi-lane waypoint graph with road geometry & clearance masking | M2 | DONE |
| 8 | Player-Vehicle Interaction | 3.5m boarding range, safe multi-candidate exit, camera transition, HUD | M2 | DONE |
| 9 | Autonomous AI Traffic Fleet | IDM car-following and Pure Pursuit steering along road network | M3 | IN_PROGRESS |
| 10 | Intersection & Anti-Deadlock | Yellow-box FIFO reservation, watchdog recovery, anti-overlap d >= 2.0m | M3 | IN_PROGRESS |
| 11 | Instanced Scalability & 60 FPS | InstancedMesh rendering, zero-allocation physics, 50+ vehicles < 16.6ms | M3 | IN_PROGRESS |
| 12 | Headless Browser Automation | Zero-dependency native CDP runner for Edge & Chrome via WebSocket | E2E | DONE |
| 13 | 1000-Frame Stress Benchmark | 50+ entities, 1000 frames, avg tick < 16.6ms, heap growth < 2.0MB | E2E | DONE |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Engine Core & Spatial Grid | Features 1, 2, 3, 4 | none | DONE |
| 2 | Road Network & Drivable Vehicles | Features 6, 7, 8 | M1 | DONE |
| 3 | Anothermapo City & Autonomous AI Traffic | Features 5, 9, 10, 11 | M2 | IN_PROGRESS |
| 4 | Final Milestone & Adversarial Hardening | 100% E2E test pass + Tier 5 coverage | M3 | PLANNED |
