# Handoff Report: Anothermapo 3D Map & OSM Road Network Survey

## 1. Observation

### 1.1 `/anothermapo` Directory Survey
Direct inspection of `C:\Users\potat\kajm1ller.github.io-1\anothermapo\` reveals:
- **Total OBJ Parts**: Exactly 92 `.obj` files named `part0000.obj` through `part0091.obj`.
  - Parts 0000 to 0029 (first 30 parts): 43,074,069 bytes (~43.1 MB), 264,652 vertices, 348,903 triangular/quad faces.
  - All 92 parts combined: 131,144,398 bytes (~131.1 MB), 741,428 vertices, 1,041,968 faces.
- **Bounding Coordinates Across All Parts**:
  - $X \in [-1825.97, 1534.11]$ meters (~3,360 meters east-west span).
  - $Y \in [0.00, 34.75]$ meters (elevation/height span).
  - $Z \in [-5340.01, 1966.38]$ meters (~7,306 meters north-south span).
- **Coordinate Origin & Projection**:
  Header in `anothermapo/part0000.obj` lines 3-6 verbatim:
  ```
  # Coordinate origin (0,0,0): lat 41.36928, lon -83.62857, ele 0
  # North direction: (0.0, 0.0, -1.0)
  # 1 coordinate unit corresponds to roughly 1 m in reality
  ```
  The projection is an equirectangular tangent projection centered at Bowling Green State University (BGSU) in Ohio ($lat_0 = 41.36928^\circ, lon_0 = -83.62857^\circ$):
  - $X = (lon - lon_0) \times \frac{\pi}{180} \times R \times \cos(lat_0)$
  - $Z = -(lat - lat_0) \times \frac{\pi}{180} \times R$ (where $-Z$ is North)
  - Scale: exactly 1 unit = 1 meter ($R = 6,378,137\text{m}$).
- **Material & Texture Definitions**:
  - `anothermapo/materials.mtl`: 404,235 bytes, 12,147 lines, defining materials such as `ASPHALT_0`, `CONCRETE_0`, `STEEL_0`, `PAVING_STONE_0`, `ROAD_MARKING_DASHED_0`, `ROAD_MARKING_DASHED_1`, `TREE_BILLBOARD_BROAD_LEAVED_0`, `TREE_BILLBOARD_CONIFEROUS_0`, `WOOD_0`, `GRAVEL_0`, `GRASS_0`, and `PLASTIC_0`.
  - Texture references: point to `../newmap2/OSM2World-latest-bin/textures/` (e.g., `cc0textures/Asphalt010/Asphalt010_Color.png`, `cc0textures/Metal002/Metal002_Color.jpg`, `cc0textures/Concrete034/Concrete034_Color.jpg`). These image files are physically present in the repository at `newmap2\OSM2World-latest-bin\textures\`.
- **OpenStreetMap Source (`anothermapo/map.osm`)**:
  - 5,368,074 bytes, 75,012 lines of XML.
  - Bounds: `minlat="41.3638300" minlon="-83.6437200" maxlat="41.3747300" maxlon="-83.6134200"`.
  - Contains 24,000+ nodes and 178 highway ways including `residential`, `service`, `tertiary`, `secondary`, and `primary`.

### 1.2 Analysis of `7e9eef5:game.html`
In commit `7e9eef5:game.html`:
- **Map Loading**:
  - Lines 250-320 loaded all 92 parts via `MTLLoader` and `OBJLoader` using `Promise.all(mapParts.map(part => loadMapPart(part)))`.
  - Map parts were added to the Three.js root scene with **zero position offset** (`position.set(0, 0, 0)`), **zero rotation** (`rotation.set(0, 0, 0)`), and **unit scale** (`scale.set(1, 1, 1)`).
- **Player & Vehicle Initial Positions**:
  - Lines 245-248: `const playerStartPos = new THREE.Vector3(-120.1, 0, 64.0);`
  - Lines 420-425: `carMesh.position.set(playerStartPos.x + 6, 0, playerStartPos.z + 2);` -> placed at `(-114.1, 0, 66.0)` with `rotation.y = Math.PI / 4`.
  - `setupKajHouseLabel()`: searched for the building in `collisionMeshes` with `height > 2.5` closest to `playerStartPos`.
- **Collision Bottleneck**:
  - In `7e9eef5`, meshes with bounding box `height > 1.5` were pushed into a flat array `collisionMeshes`.
  - On-foot movement: `checkCollision(newPosition)` cast 24 rays (8 directions $\times$ 3 heights) using `ray.intersectObjects(collisionMeshes, false)`.
  - Car driving: `updateCarDriving()` allocated `new THREE.Box3().setFromCenterAndSize(...)` on every frame inside a `for (const mesh of collisionMeshes)` loop. With hundreds of meshes, this generated massive garbage collection pressure and $O(N)$ CPU load per frame.
- **OSM Waypoint Usage in `7e9eef5`**:
  - `buildSidewalkWaypoints()` did not parse `map.osm` directly; it traversed loaded Three.js meshes matching names/materials with regex `/sidewalk|footway|pavement|paving|footpath|walkway|kerb|curb/` and sampled grid points every 2 meters.

---

## 2. Logic Chain

1. **Mapping Coordinates to the Physical Neighborhood**:
   - Applying the projection formula to `map.osm` reveals that `playerStartPos = (-120.1, 0, 64.0)` sits at latitude $41.368705^\circ$ N, longitude $-83.630008^\circ$ W.
   - This exact location corresponds to a residential property driveway on **Brookwood Drive** in Bowling Green, Ohio.
   - Way `810006793` is the private service driveway connecting from `(-123.4, 78.3)` to `(-123.1, 57.4)`.
   - Directly south of the house at $Z \approx 78$ runs **Brookwood Drive** (Way `160270260`), spanning from $X = -217.3$ to $X = -59.1$.

2. **The Interconnected Residential Street Circuit**:
   - The neighborhood forms a complete, closed rectangular street grid comprising 6 residential roads and 8 junctions:
     * **Brookwood Drive** (Way `160270260`): $Z \approx 78$, length 158m
     * **Burrwood Drive** (Way `19309797`): $Z \approx -22$, length 159m
     * **Briarwood Drive** (Way `160270259`): $Z \approx 176$, length 160m
     * **Scott Hamilton Drive** (Way `19309747`): $Z \approx -121$, length 156m
     * **Bentwood Lane** (Way `160270262`): $X \approx -216$, length 299m (connecting Scott Hamilton, Burrwood, Brookwood, and Briarwood)
     * **South Mercer Road** (Way `160270261`): $X \approx -59$, length 299m (connecting Scott Hamilton, Burrwood, Brookwood, and Briarwood)
   - Total centerline length: $158 + 159 + 160 + 156 + 299 + 299 = 1,231$ meters.
   - This matches the 1,220m extent designed in `roadNetwork.js`, but directly follows the real asphalt roads in `/anothermapo`.

3. **Collision Optimization via Spatial Hash Grid**:
   - Group tags in OBJ files explicitly classify meshes: `g Building` (46 in first 30 parts), `g Wall` (7), `g PoleFence` (64), `g StreetLamp` (36), `g FireHydrant` (57), `g Tree` (98).
   - Across the first 30 parts, exactly 1,060 static obstacle AABBs are extracted.
   - Registering these 1,060 bounding boxes into `spatialGrid.insertStaticObstacle(x, z, halfWidth, halfDepth, type)` distributes them across 15m grid cells.
   - During vehicle and player physics updates, `spatialGrid.queryBox(carBox, queryResults, 'STATIC')` checks only the 1-3 obstacles in overlapping cells in $O(1)$ time, eliminating both the 24 raycasts and the linear `collisionMeshes` loop.
   - Zero heap allocations are required per tick when using the pre-allocated `queryBuffer`.

4. **Fast Loading & 60 FPS Strategy**:
   - Loading 92 parts concurrently in `7e9eef5` triggered 92 parallel network fetches (~131 MB) and unthrottled main-thread parsing.
   - The first 30 parts (`part0000.obj` through `part0029.obj`, ~43.1 MB) completely encapsulate the neighborhood block enclosing Kaj's house, all 6 residential streets, and all 8 intersections.
   - A chunked asynchronous pipeline with 4 concurrent download/parse workers delivers smooth loading with progress updates (0% to 100%) without locking the UI thread.
   - Applying `frustumCulled = true`, `material.side = THREE.FrontSide`, and `matrixAutoUpdate = false` on all static map meshes reduces per-frame Three.js scene-graph overhead to near zero.

---

## 3. Caveats

1. **Full World vs Neighborhood Scope**:
   Parts 0000 to 0029 provide full visual and collision coverage for the residential neighborhood around Kaj's house ($X \in [-250, 0]$, $Z \in [-150, 200]$). Parts 0030 to 0091 extend eastward and northward across the wider BGSU university campus. `AnothermapoLoader` defaults to parts 0000-0029 for fast loading, but accepts a configurable `endPart: 91` for full world loading if desired.
2. **Texture Loading Over Network**:
   In `materials.mtl`, relative paths point to `../newmap2/OSM2World-latest-bin/textures/`. If accessed over HTTP via a web server that does not serve the parent directory `../newmap2`, MTLLoader falls back to standard diffuse colors via `fallbackMaterial = new THREE.MeshLambertMaterial({ color: 0x888888 })` as handled in `AnothermapoLoader`.
3. **Terrain Elevation**:
   In this residential area, the ground elevation is flat ($Y = 0.0$ to $Y = 0.5$). Roads and driveway entrances are level with the plane, ensuring 2D planar physics and bicycle vehicle models operate without vertical instability.

---

## 4. Conclusion

- `/anothermapo` is an OSM2World export centered at $lat_0 = 41.36928, lon_0 = -83.62857$.
- In `7e9eef5:game.html`, the map was loaded at (0, 0, 0) unscaled and unrotated, placing the player start position `(-120.1, 0, 64.0)` and Honda Civic `(-114.1, 0, 66.0)` right at Kaj's driveway on Brookwood Drive.
- Brute-force $O(N)$ mesh collision in `7e9eef5` has been replaced with $O(1)$ `SpatialGrid` AABB registration:
  `spatialGrid.insertStaticObstacle(x, z, halfWidth, halfDepth, type)`.
- Road network waypoints have been aligned with the real asphalt streets from `map.osm`, forming a 1,231-meter closed circuit of 6 streets with 8 intersections.
- The reference loader and blueprint have been delivered to:
  `C:\Users\potat\kajm1ller.github.io-1\.agents\teamwork\teamwork_preview_explorer_anothermapo\proposed_map_loader.js`.

---

## 5. Verification Method

### 5.1 Verification Commands
1. **Syntax & Module Validation**:
   ```powershell
   node --check .agents/teamwork/teamwork_preview_explorer_anothermapo/proposed_map_loader.js
   ```
2. **OSM Projection & Road Network Verification**:
   ```powershell
   node .agents/teamwork/teamwork_preview_explorer_anothermapo/extract_roads.js
   ```
   *Expected output*: Verifies 6 target streets, coordinate bounds, and all 8 junction intersections matching `/anothermapo/map.osm`.
3. **Obstacle Extraction Benchmark**:
   ```powershell
   node .agents/teamwork/teamwork_preview_explorer_anothermapo/generate_road_graph.js
   ```

### 5.2 Files to Inspect
- `proposed_map_loader.js`: Contains `AnothermapoLoader`, `OSMRoadNetwork`, `createOptimizedHondaCivic`, and `VehicleSpatialCollider`.
- `osm_neighborhood_roads.json`: Clean, verified JSON of the 6 interconnected neighborhood streets and nodes.

### 5.3 Invalidation Conditions
- If the player start position `(-120.1, 0, 64.0)` is moved away from Brookwood Drive without updating the car spawn offset.
- If static obstacles are checked via raycasting against `collisionMeshes` instead of querying `SpatialGrid`.
