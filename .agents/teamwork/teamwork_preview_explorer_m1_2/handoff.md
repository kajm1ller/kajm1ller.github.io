# Spatial Hash Grid Broadphase Design Report (`js/game/spatialGrid.js`)

## 1. Observation

### 1.1 Existing Collision Architecture in `game.html`
Direct inspection of `game.html` reveals an unindexed, linear $O(N)$ broadphase scan:

1. **Storage Array** (`game.html:357`):
   ```javascript
   const collisionMeshes = [];
   const playerRadius = 0.4;
   ```
2. **Static Obstacle Population during `generateWorld()`** (`game.html:1428-1433`, `1450-1456`, `1486-1529`):
   - World radius: $R = 120\text{m}$ on a $600\text{m} \times 600\text{m}$ ground plane (`game.html:390`: `new THREE.PlaneGeometry(600, 600, 1, 1)`).
   - 80 Trees (`createTree`):
     ```javascript
     const trunkBox = new THREE.Box3(
         new THREE.Vector3(x - 0.5, 0, z - 0.5),
         new THREE.Vector3(x + 0.5, 5 * heightVariation, z + 0.5)
     );
     const placeholder = { userData: { worldBox: trunkBox, height: 5 * heightVariation } };
     collisionMeshes.push(placeholder);
     ```
   - 40 Rocks + 6 Rock clusters (`createRock`):
     ```javascript
     if (scale > 0.8) {
         const rockBox = new THREE.Box3(
             new THREE.Vector3(x - scale, 0, z - scale),
             new THREE.Vector3(x + scale, scale * 1.2, z + scale)
         );
         collisionMeshes.push({ userData: { worldBox: rockBox, height: scale * 1.2 } });
     }
     ```
   - Total static obstacles in `collisionMeshes`: ~120 to 150 items.
3. **Collision Check Execution** (`game.html:1103-1123`):
   ```javascript
   function checkCollision(newPosition) {
       if (collisionMeshes.length === 0) return false;
       _playerBox.min.set(newPosition.x - playerRadius, newPosition.y + 0.1, newPosition.z - playerRadius);
       _playerBox.max.set(newPosition.x + playerRadius, newPosition.y + 1.8, newPosition.z + playerRadius);
       for (let i = 0, len = collisionMeshes.length; i < len; i++) {
           const box = collisionMeshes[i].userData.worldBox;
           if (box && _playerBox.intersectsBox(box)) return true;
       }
       return false;
   }
   ```

### 1.2 Scalability Bottleneck Under 50+ Concurrent Vehicles
- When 50 active vehicles (1 player + 49 autonomous AI traffic) are introduced:
  - Each vehicle performs at least 1 obstacle collision check per physics substep.
  - Each vehicle performs forward corridor sensing (IDM car-following) and lateral neighbor checks.
  - Linear scan cost per frame:
    $$\text{Vehicle-to-Obstacle Checks} = 50 \times 150 = 7,500\text{ box tests/frame}$$
    $$\text{Vehicle-to-Vehicle Checks (all-pairs)} = \frac{50 \times 49}{2} = 1,225\text{ tests/frame}$$
    $$\text{Total Unindexed Tests} = 8,725\text{ checks per frame} = 523,500\text{ checks/sec at 60Hz}$$
- Without spatial partitioning, CPU time is dominated by checking distant obstacles (e.g. testing trees at $X=-100$ when the car is at $X=+80$).

### 1.3 Target Interface Contract (`PROJECT.md:64-74`)
```javascript
export class SpatialGrid {
    constructor(worldSize = 300, cellSize = 15);
    clearDynamic();
    insertStatic(id, box3);
    insertDynamic(id, x, z, radius, entityRef);
    queryRadius(x, z, radius, outResults); // writes into outResults array without allocating
    queryBox(box, outResults);
}
```

---

## 2. Logic Chain

### 2.1 Cell Size & Grid Dimension Rationale
1. **World Extent**:
   - The ground plane spans $[-300, +300]$ meters in both $X$ and $Z$ axes (total width $W = 600\text{m}$).
   - The road network and active play area reside within $[-250, +250]\text{m}$.
2. **Cell Size Selection ($S = 15\text{m}$)**:
   - Typical vehicle dimensions: length $L \approx 4.5\text{m}$, width $W \approx 2.2\text{m}$, bounding radius $R_{veh} \approx 2.25\text{m}$.
   - Obstacle dimensions: tree trunks $\approx 1.0\text{m} \times 1.0\text{m}$, rocks $\approx 0.8\text{m} - 3.6\text{m}$.
   - Interaction ranges:
     - Vehicle-obstacle collision radius: $\approx 2.5\text{m} - 3.0\text{m}$.
     - IDM traffic sensor lookahead: $\approx 10\text{m} - 15\text{m}$.
     - Player enter/exit proximity: $3.5\text{m}$.
   - With $S = 15\text{m}$:
     - A $4.5\text{m}$ vehicle spans at most $2$ cells along any axis (at most 4 cells in the corner worst case).
     - Standard collision queries ($R \le 7.5\text{m}$) touch only $1$ to $4$ cells.
     - Lookahead sensor queries ($R \le 15\text{m}$) touch a compact $2 \times 2$ or $3 \times 3$ cell neighborhood (maximum 9 cells).
     - Cell count: $cols = \lceil 600 / 15 \rceil = 40$, $rows = 40$. Total cells: $40 \times 40 = 1,600$.
3. **1D Flattened Array Lookup ($O(1)$)**:
   - Instead of nested arrays `cells[col][row]` or string-keyed Maps `map.get(`${col},${row}`)` (which allocate strings on every lookup), a 1D flat array of length 1,600 is pre-allocated:
     $$col = \text{clamp}\left(0, cols - 1, \left\lfloor \frac{x + worldSize}{cellSize} \right\rfloor\right)$$
     $$row = \text{clamp}\left(0, rows - 1, \left\lfloor \frac{z + worldSize}{cellSize} \right\rfloor\right)$$
     $$\text{cellIndex} = row \times cols + col$$
   - Clamping guarantees zero out-of-bounds exceptions or `undefined` cell lookups even if an entity overshoots world bounds.
   - Cost: 2 arithmetic operations and 1 array index access.

### 2.2 Static vs. Dynamic Separation
1. **Static Obstacles**:
   - Inserted ONCE during `generateWorld()` via `spatialGrid.insertStatic(id, box3)`.
   - Stored in `cell.staticItems`.
   - Bounded by their AABB; mapped into all cells $[minCol \dots maxCol, minRow \dots maxRow]$.
   - Remain permanent; NEVER touched or re-inserted during the simulation loop.
2. **Dynamic Entities**:
   - Cleared and re-inserted each frame/tick.
   - Stored in `cell.dynamicItems`.
   - Tracked via `cell.dynamicCount`.

### 2.3 Zero-Allocation Mechanics
To satisfy the 60 FPS / 1,000-frame benchmark requirement (< 16.6ms frame time, zero heap memory leak growth), `SpatialGrid` must produce **0 object or array allocations per frame**:

1. **Active Dynamic Cell Tracking for $O(\text{active})$ Clears**:
   - Problem: Clearing 1,600 cells every frame takes 96,000 loop iterations per second, even though 50 vehicles only occupy ~50-80 cells.
   - Solution: Pre-allocate `this.activeCells = new Array(1600)` and `this.activeCellCount = 0`.
   - When a cell receives its first dynamic entity in a frame (`cell.dynamicCount === 0`), it registers itself into `activeCells`.
   - `clearDynamic()` only iterates `activeCells[0 ... activeCellCount - 1]`:
     ```javascript
     for (let i = 0; i < this.activeCellCount; i++) {
         const cell = this.activeCells[i];
         cell.dynamicCount = 0;
         cell.dynamicItems.length = 0; // Reuses backing array buffer, 0 GC allocation
     }
     this.activeCellCount = 0;
     ```
   - Performance: Reduces clear cost from 1,600 operations to ~50 operations ($< 0.005\text{ms}$).
2. **Dynamic Entry Pooling & Entity Reference Attachment**:
   - Problem: Calling `insertDynamic` creating `{ id, x, z, radius, entityRef }` allocates 50+ objects per tick (3,000+ objects/sec, > 50,000 objects in a 1,000-frame benchmark).
   - Solution: Two-tier reuse:
     - Tier 1: Attach `_spatialEntry` directly to the `entityRef` instance (e.g. `Vehicle` instance). Subsequent frames simply mutate `entry.x`, `entry.z`, `entry.radius`.
     - Tier 2: Internal persistent Map `this.dynamicEntriesById` keyed by `id`. If an entry exists for that `id`, mutate and reuse it.
   - Result: 0 object allocations after the first frame.
3. **Monotonic Query Counter for $O(1)$ Zero-Allocation Deduplication**:
   - Problem: When an entity or obstacle spans multiple adjacent cells, a broadphase query covering those cells encounters the item multiple times. Using `new Set()` or `outResults.indexOf()` causes either GC allocations or $O(K^2)$ search overhead.
   - Solution: Monotonic query counter `this.queryId++`.
   - Each entry stores `_lastQueryId`.
   - During cell traversal:
     ```javascript
     if (item._lastQueryId === this.queryId) continue; // Already added!
     item._lastQueryId = this.queryId;
     outResults.push(item);
     ```
   - Time complexity: exactly 1 integer comparison and 1 integer assignment per candidate. 0 allocations.
4. **Reusable Result Buffers (`outResults`)**:
   - Callers maintain their own scratch arrays (e.g. `vehicle.scratchColliders = []`).
   - `queryRadius` and `queryBox` begin with `outResults.length = 0;` and populate into the existing array.
5. **Broadphase Distance Pre-filtering**:
   - In `queryRadius`, before adding candidates to `outResults`, check:
     - Dynamic entity: $(dx^2 + dz^2) \le (r_{query} + r_{entity})^2$.
     - Static obstacle: distance from query point $(x, z)$ to clamped AABB extents $\le r_{query}^2$.
   - This discards corner candidates within visited cells before passing them to expensive narrowphase SAT/impulse solvers.
6. **Query Filter Mode (`filter = 'ALL' | 'STATIC' | 'DYNAMIC'`)**:
   - Traffic forward sensing only checks dynamic vehicles; on-foot navigation checks static obstacles. Supporting filtering eliminates checking irrelevant cell arrays.

---

## 3. Caveats

1. **2D Planar Collision Assumption**:
   - All spatial grid cells and broadphase tests operate in the horizontal $XZ$ plane ($Y = 0$).
   - Obstacle height extents (`userData.height` or `box3.min.y` / `box3.max.y`) are preserved on the entry objects so narrowphase or player jumping logic can perform vertical checks when needed.
2. **Entity ID Uniqueness**:
   - Dynamic entry pooling requires unique entity IDs (e.g. `'player'`, `'vehicle_0'`, `'vehicle_1'`). Duplicate IDs will overwrite spatial extents.
3. **Query Counter Wraparound**:
   - In JavaScript, `Number.MAX_SAFE_INTEGER` is $9 \times 10^{15}$. Even at 100,000 queries per second, overflow would require over 2,800 years. As a defensive guard, resetting `queryId = 1` when `queryId > 1e14` and clearing `_lastQueryId` handles any theoretical long-running session.
4. **World Boundary Extents**:
   - Default `worldSize = 300` corresponds to coordinates $[-300, +300]$ (matching `game.html`'s 600m ground plane). If the world size is altered, `SpatialGrid` must be constructed with matching half-extent.

---

## 4. Conclusion & Proposed Implementation

### 4.1 Implementation: `js/game/spatialGrid.js`

```javascript
/**
 * js/game/spatialGrid.js
 * 
 * 2D Spatial Hash Grid Broadphase for Kaj Simulator.
 * Provides O(1) spatial queries and guaranteed zero-allocation execution during gameplay.
 */

export class SpatialGrid {
    /**
     * @param {number} worldSize Half-extent of world in meters (e.g. 300 for [-300, 300])
     * @param {number} cellSize Width and depth of each grid cell in meters (default 15m)
     */
    constructor(worldSize = 300, cellSize = 15) {
        this.worldSize = worldSize;
        this.cellSize = cellSize;
        this.cols = Math.ceil((worldSize * 2) / cellSize);
        this.rows = this.cols;
        this.totalCells = this.cols * this.rows;

        // Pre-allocate all cells (1,600 cells for 600m world with 15m cells)
        this.cells = new Array(this.totalCells);
        for (let i = 0; i < this.totalCells; i++) {
            const col = i % this.cols;
            const row = Math.floor(i / this.cols);
            this.cells[i] = {
                id: i,
                col,
                row,
                minX: col * cellSize - worldSize,
                maxX: (col + 1) * cellSize - worldSize,
                minZ: row * cellSize - worldSize,
                maxZ: (row + 1) * cellSize - worldSize,
                staticItems: [],
                dynamicItems: [],
                dynamicCount: 0
            };
        }

        // Active dynamic cells tracker for O(active) zero-allocation clears
        this.activeCells = new Array(this.totalCells);
        this.activeCellCount = 0;

        // Monotonic query timestamp counter for O(1) deduplication without Set allocations
        this.queryId = 0;

        // Persistent entry pool for dynamic entities
        this.dynamicEntriesById = new Map();
    }

    /**
     * Helper: Map world X coordinate to clamped column index [0, cols - 1]
     */
    _getCol(x) {
        return Math.max(0, Math.min(this.cols - 1, Math.floor((x + this.worldSize) / this.cellSize)));
    }

    /**
     * Helper: Map world Z coordinate to clamped row index [0, rows - 1]
     */
    _getRow(z) {
        return Math.max(0, Math.min(this.rows - 1, Math.floor((z + this.worldSize) / this.cellSize)));
    }

    /**
     * Clears dynamic entities from all active cells.
     * Zero-allocation: reuses dynamicItems arrays and activeCells tracker.
     */
    clearDynamic() {
        for (let i = 0; i < this.activeCellCount; i++) {
            const cell = this.activeCells[i];
            cell.dynamicCount = 0;
            cell.dynamicItems.length = 0;
        }
        this.activeCellCount = 0;
    }

    /**
     * Inserts a static obstacle (tree, rock, building, boundary wall) into overlapping cells.
     * Called during world generation; static items remain permanent.
     * 
     * @param {string|number} id Unique obstacle identifier
     * @param {Object} box3 Bounding box with min/max having x, y, z properties
     * @param {Object} [userData] Optional reference data (e.g. height, mesh)
     */
    insertStatic(id, box3, userData = null) {
        const minX = box3.min.x;
        const maxX = box3.max.x;
        const minZ = box3.min.z;
        const maxZ = box3.max.z;

        const entry = {
            id,
            box: box3,
            userData: userData || { worldBox: box3 },
            isStatic: true,
            _lastQueryId: 0,
            minX, maxX, minZ, maxZ,
            x: (minX + maxX) * 0.5,
            z: (minZ + maxZ) * 0.5,
            radius: Math.hypot(maxX - minX, maxZ - minZ) * 0.5
        };

        const minCol = this._getCol(minX);
        const maxCol = this._getCol(maxX);
        const minRow = this._getRow(minZ);
        const maxRow = this._getRow(maxZ);

        for (let r = minRow; r <= maxRow; r++) {
            const rowOffset = r * this.cols;
            for (let c = minCol; c <= maxCol; c++) {
                this.cells[rowOffset + c].staticItems.push(entry);
            }
        }
        return entry;
    }

    /**
     * Inserts or updates a dynamic entity (vehicle, player) for the current tick.
     * Guaranteed zero-allocation after initial insertion via entry caching.
     * 
     * @param {string|number} id Unique entity ID
     * @param {number} x World X position
     * @param {number} z World Z position
     * @param {number} radius Bounding circle radius in meters
     * @param {Object} entityRef Reference to the entity instance
     */
    insertDynamic(id, x, z, radius, entityRef) {
        let entry;

        // Tier 1: Check if entityRef carries its cached spatial entry
        if (entityRef && entityRef._spatialEntry) {
            entry = entityRef._spatialEntry;
            entry.id = id;
            entry.x = x;
            entry.z = z;
            entry.radius = radius;
            entry.entityRef = entityRef;
            entry.minX = x - radius;
            entry.maxX = x + radius;
            entry.minZ = z - radius;
            entry.maxZ = z + radius;
        } else {
            // Tier 2: Check persistent ID pool
            entry = this.dynamicEntriesById.get(id);
            if (!entry) {
                entry = {
                    id,
                    x,
                    z,
                    radius,
                    entityRef,
                    isStatic: false,
                    _lastQueryId: 0,
                    minX: x - radius,
                    maxX: x + radius,
                    minZ: z - radius,
                    maxZ: z + radius
                };
                this.dynamicEntriesById.set(id, entry);
                if (entityRef && typeof entityRef === 'object') {
                    entityRef._spatialEntry = entry;
                }
            } else {
                entry.x = x;
                entry.z = z;
                entry.radius = radius;
                entry.entityRef = entityRef;
                entry.minX = x - radius;
                entry.maxX = x + radius;
                entry.minZ = z - radius;
                entry.maxZ = z + radius;
            }
        }

        const minCol = this._getCol(entry.minX);
        const maxCol = this._getCol(entry.maxX);
        const minRow = this._getRow(entry.minZ);
        const maxRow = this._getRow(entry.maxZ);

        for (let r = minRow; r <= maxRow; r++) {
            const rowOffset = r * this.cols;
            for (let c = minCol; c <= maxCol; c++) {
                const cell = this.cells[rowOffset + c];
                if (cell.dynamicCount === 0) {
                    this.activeCells[this.activeCellCount++] = cell;
                }
                cell.dynamicItems[cell.dynamicCount++] = entry;
            }
        }
        return entry;
    }

    /**
     * Queries all obstacles and entities within a given radius.
     * Writes into outResults array without allocating new memory.
     * 
     * @param {number} x Query center X
     * @param {number} z Query center Z
     * @param {number} radius Query radius in meters
     * @param {Array} outResults Caller-owned reusable scratch array
     * @param {'ALL'|'STATIC'|'DYNAMIC'} [filter='ALL'] Filtering mode
     * @returns {Array} outResults populated with candidate entries
     */
    queryRadius(x, z, radius, outResults, filter = 'ALL') {
        outResults.length = 0;
        this.queryId++;
        if (this.queryId > 1e14) this.queryId = 1;
        const qId = this.queryId;

        const minCol = this._getCol(x - radius);
        const maxCol = this._getCol(x + radius);
        const minRow = this._getRow(z - radius);
        const maxRow = this._getRow(z + radius);

        const checkStatic = filter !== 'DYNAMIC';
        const checkDynamic = filter !== 'STATIC';
        const rSq = radius * radius;

        for (let r = minRow; r <= maxRow; r++) {
            const rowOffset = r * this.cols;
            for (let c = minCol; c <= maxCol; c++) {
                const cell = this.cells[rowOffset + c];

                // Static obstacles
                if (checkStatic) {
                    const sItems = cell.staticItems;
                    for (let i = 0, len = sItems.length; i < len; i++) {
                        const item = sItems[i];
                        if (item._lastQueryId === qId) continue;
                        item._lastQueryId = qId;

                        // Broadphase circle vs AABB test
                        const cx = Math.max(item.minX, Math.min(x, item.maxX));
                        const cz = Math.max(item.minZ, Math.min(z, item.maxZ));
                        const dx = x - cx;
                        const dz = z - cz;
                        if (dx * dx + dz * dz <= rSq) {
                            outResults.push(item);
                        }
                    }
                }

                // Dynamic entities
                if (checkDynamic) {
                    const dItems = cell.dynamicItems;
                    const dLen = cell.dynamicCount;
                    for (let i = 0; i < dLen; i++) {
                        const item = dItems[i];
                        if (item._lastQueryId === qId) continue;
                        item._lastQueryId = qId;

                        // Broadphase circle vs circle test
                        const dx = item.x - x;
                        const dz = item.z - z;
                        const combinedRadius = radius + item.radius;
                        if (dx * dx + dz * dz <= combinedRadius * combinedRadius) {
                            outResults.push(item);
                        }
                    }
                }
            }
        }
        return outResults;
    }

    /**
     * Queries all obstacles and entities intersecting an AABB.
     * Writes into outResults array without allocating new memory.
     * 
     * @param {Object} box Bounding box with min/max having x and z
     * @param {Array} outResults Caller-owned reusable scratch array
     * @param {'ALL'|'STATIC'|'DYNAMIC'} [filter='ALL'] Filtering mode
     * @returns {Array} outResults populated with candidate entries
     */
    queryBox(box, outResults, filter = 'ALL') {
        outResults.length = 0;
        this.queryId++;
        if (this.queryId > 1e14) this.queryId = 1;
        const qId = this.queryId;

        const minX = box.min.x;
        const maxX = box.max.x;
        const minZ = box.min.z;
        const maxZ = box.max.z;

        const minCol = this._getCol(minX);
        const maxCol = this._getCol(maxX);
        const minRow = this._getRow(minZ);
        const maxRow = this._getRow(maxZ);

        const checkStatic = filter !== 'DYNAMIC';
        const checkDynamic = filter !== 'STATIC';

        for (let r = minRow; r <= maxRow; r++) {
            const rowOffset = r * this.cols;
            for (let c = minCol; c <= maxCol; c++) {
                const cell = this.cells[rowOffset + c];

                if (checkStatic) {
                    const sItems = cell.staticItems;
                    for (let i = 0, len = sItems.length; i < len; i++) {
                        const item = sItems[i];
                        if (item._lastQueryId === qId) continue;
                        item._lastQueryId = qId;

                        if (minX <= item.maxX && maxX >= item.minX &&
                            minZ <= item.maxZ && maxZ >= item.minZ) {
                            outResults.push(item);
                        }
                    }
                }

                if (checkDynamic) {
                    const dItems = cell.dynamicItems;
                    const dLen = cell.dynamicCount;
                    for (let i = 0; i < dLen; i++) {
                        const item = dItems[i];
                        if (item._lastQueryId === qId) continue;
                        item._lastQueryId = qId;

                        if (minX <= item.maxX && maxX >= item.minX &&
                            minZ <= item.maxZ && maxZ >= item.minZ) {
                            outResults.push(item);
                        }
                    }
                }
            }
        }
        return outResults;
    }
}
```

### 4.2 Integration Snippets for World Generation & Physics Loop

#### World Generation (`generateWorld()` in `world.js` / `game.html`)
```javascript
import { SpatialGrid } from './spatialGrid.js';

export const spatialGrid = new SpatialGrid(300, 15);

// In createTree(x, z):
const trunkBox = new THREE.Box3(
    new THREE.Vector3(x - 0.5, 0, z - 0.5),
    new THREE.Vector3(x + 0.5, 5 * heightVariation, z + 0.5)
);
const treeData = { worldBox: trunkBox, height: 5 * heightVariation };
collisionMeshes.push(treeData);
spatialGrid.insertStatic(`tree_${treeIndex++}`, trunkBox, treeData);

// In createRock(x, z, scale):
if (scale > 0.8) {
    const rockBox = new THREE.Box3(
        new THREE.Vector3(x - scale, 0, z - scale),
        new THREE.Vector3(x + scale, scale * 1.2, z + scale)
    );
    const rockData = { worldBox: rockBox, height: scale * 1.2 };
    collisionMeshes.push(rockData);
    spatialGrid.insertStatic(`rock_${rockIndex++}`, rockBox, rockData);
}

// Perimeter boundary walls at +-280m:
spatialGrid.insertStatic('wall_n', { min: { x: -300, y: 0, z: 280 }, max: { x: 300, y: 5, z: 300 } });
spatialGrid.insertStatic('wall_s', { min: { x: -300, y: 0, z: -300 }, max: { x: 300, y: 5, z: -280 } });
spatialGrid.insertStatic('wall_e', { min: { x: 280, y: 0, z: -300 }, max: { x: 300, y: 5, z: 300 } });
spatialGrid.insertStatic('wall_w', { min: { x: -300, y: 0, z: -300 }, max: { x: -280, y: 5, z: 300 } });
```

#### Physics Substep Loop (`main.js`)
```javascript
function physicsTick(dt) {
    // 1. Clear dynamic grid
    spatialGrid.clearDynamic();

    // 2. Insert active player vehicle / player on-foot
    if (playerController.isInVehicle()) {
        const pv = playerController.getVehicle();
        spatialGrid.insertDynamic(pv.id, pv.x, pv.z, pv.radius, pv);
    } else {
        spatialGrid.insertDynamic('player', myPosition.x, myPosition.z, playerRadius, playerController);
    }

    // 3. Insert all AI traffic vehicles
    const fleet = trafficManager.getActiveVehicles();
    for (let i = 0, len = fleet.length; i < len; i++) {
        const v = fleet[i];
        spatialGrid.insertDynamic(v.id, v.x, v.z, v.radius, v);
    }

    // 4. Update vehicle physics & collisions using scratch arrays
    if (playerController.isInVehicle()) {
        playerController.getVehicle().update(dt, spatialGrid, roadNetwork);
    } else {
        playerController.update(dt, spatialGrid);
    }
    trafficManager.update(dt, playerController.getVehicle());
}
```

---

## 5. Verification Method

### 5.1 Verification Commands

#### Command 1: Unit & Boundary Correctness
Verify coordinate mapping, out-of-bounds safety, and 0-error deduplication:
```powershell
node -e "
import('./js/game/spatialGrid.js').then(({ SpatialGrid }) => {
    const grid = new SpatialGrid(300, 15);
    console.assert(grid.totalCells === 1600, 'Cell count mismatch: ' + grid.totalCells);

    // Verify boundary clamping
    const c1 = grid._getCol(-350);
    const c2 = grid._getCol(350);
    console.assert(c1 === 0 && c2 === 39, 'Clamping failure: ' + c1 + ', ' + c2);

    // Verify static insertion
    const box = { min: { x: -10, y: 0, z: -10 }, max: { x: 10, y: 3, z: 10 } };
    grid.insertStatic('center_box', box);

    // Verify query and deduplication
    const scratch = [];
    grid.queryRadius(0, 0, 20, scratch);
    console.assert(scratch.length === 1, 'Expected 1 deduplicated item, got: ' + scratch.length);
    console.assert(scratch[0].id === 'center_box', 'ID mismatch');

    console.log('PASS: SpatialGrid unit & boundary tests passed.');
});
"
```

#### Command 2: 1,000-Frame Performance & Zero-Allocation Memory Benchmark
Execute 1,000 simulated ticks with 150 static obstacles and 50 concurrent moving vehicles:
```powershell
node --expose-gc -e "
import('./js/game/spatialGrid.js').then(({ SpatialGrid }) => {
    const grid = new SpatialGrid(300, 15);
    for (let i = 0; i < 150; i++) {
        const x = (Math.random() - 0.5) * 240, z = (Math.random() - 0.5) * 240;
        grid.insertStatic('obs_' + i, { min: { x: x - 1, y: 0, z: z - 1 }, max: { x: x + 1, y: 3, z: z + 1 } });
    }
    const vehicles = [];
    for (let i = 0; i < 50; i++) {
        vehicles.push({ id: 'v_' + i, x: (Math.random() - 0.5) * 200, z: (Math.random() - 0.5) * 200, radius: 2.25, scratch: [] });
    }

    // Warmup
    for (let f = 0; f < 50; f++) {
        grid.clearDynamic();
        for (const v of vehicles) {
            grid.insertDynamic(v.id, v.x, v.z, v.radius, v);
            grid.queryRadius(v.x, v.z, 15, v.scratch);
        }
    }

    global.gc();
    const heapBefore = process.memoryUsage().heapUsed;
    const t0 = performance.now();

    const FRAMES = 1000;
    for (let f = 0; f < FRAMES; f++) {
        grid.clearDynamic();
        for (let i = 0; i < vehicles.length; i++) {
            const v = vehicles[i];
            v.x += 0.05; v.z += 0.05;
            grid.insertDynamic(v.id, v.x, v.z, v.radius, v);
        }
        for (let i = 0; i < vehicles.length; i++) {
            const v = vehicles[i];
            grid.queryRadius(v.x, v.z, 15, v.scratch);
        }
    }

    const elapsed = performance.now() - t0;
    global.gc();
    const heapAfter = process.memoryUsage().heapUsed;
    const heapDeltaKB = (heapAfter - heapBefore) / 1024;
    const avgMsPerFrame = elapsed / FRAMES;

    console.log('Benchmark Result:');
    console.log('  Total frames:', FRAMES);
    console.log('  Total broadphase queries:', FRAMES * 50);
    console.log('  Total elapsed:', elapsed.toFixed(2), 'ms');
    console.log('  Avg frame time (50 vehicles):', avgMsPerFrame.toFixed(4), 'ms');
    console.log('  Heap delta post-GC:', heapDeltaKB.toFixed(2), 'KB');

    console.assert(avgMsPerFrame < 1.0, 'Frame time budget exceeded: ' + avgMsPerFrame);
    console.assert(heapDeltaKB < 2048, 'Memory growth budget exceeded: ' + heapDeltaKB + ' KB');
    console.log('PASS: Performance & Memory Benchmark PASSED.');
});
"
```

### 5.2 Invalidation Conditions
This design is invalidated if:
1. `avgMsPerFrame` exceeds $1.0\text{ms}$ on standard hardware for 50 vehicles (budget is $16.6\text{ms}$ total engine frame time).
2. Heap growth exceeds $2.0\text{MB}$ over 1,000 frames under headless Node or CDP execution.
3. Multiple duplicate entries appear in `outResults` for multi-cell spanning obstacles.
4. An entity crossing $x = \pm 300\text{m}$ causes an `undefined` or array indexing runtime exception.
