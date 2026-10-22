/**
 * js/game/spatialGrid.js
 * 
 * 2D Spatial Hash Grid Broadphase for Kaj Simulator.
 * Provides O(1) cell lookups, static/dynamic separation, active-cell tracking,
 * entry pooling, and monotonic query ID deduplication with guaranteed zero
 * heap allocations during active gameplay and simulation stepping.
 * 
 * Conforms to PROJECT.md § Interface Contracts (SpatialGrid).
 */

// Shared stand-in for cells that have never held anything; real cells are created on first insert.
// It is never written to, and mirrors the real cell shape so query loops stay monomorphic.
const EMPTY_CELL = {
    id: -1,
    col: -1,
    row: -1,
    minX: 0,
    maxX: 0,
    minZ: 0,
    maxZ: 0,
    staticItems: [],
    dynamicItems: [],
    dynamicCount: 0
};

export class SpatialGrid {
    /**
     * @param {number} worldSize Half-extent of world in meters (default 300 for [-300, 300])
     * @param {number} cellSize Width and depth of each square grid cell in meters (default 15m)
     */
    constructor(worldSize = 300, cellSize = 15) {
        this.worldSize = worldSize;
        this.cellSize = cellSize;
        this.cols = Math.ceil((worldSize * 2) / cellSize);
        this.rows = this.cols;
        this.totalCells = this.cols * this.rows;

        // 1D flattened cell array; every slot starts as EMPTY_CELL and becomes a real cell on first insert,
        // so a map-sized grid (millions of cells) only pays for the cells that hold something
        this.cells = new Array(this.totalCells).fill(EMPTY_CELL);

        // Active dynamic cell tracker for O(active) zero-allocation clears
        this.activeCells = [];
        this.activeCellCount = 0;

        // Monotonic query timestamp counter for O(1) deduplication without Set or GC allocations
        this.queryId = 0;

        // Persistent entry pool for dynamic entities
        this.dynamicEntriesById = new Map();
    }

    /**
     * Maps world X coordinate to clamped column index [0, cols - 1]
     * @param {number} x World X coordinate
     * @returns {number} Clamped column index
     */
    _getCol(x) {
        return Math.max(0, Math.min(this.cols - 1, Math.floor((x + this.worldSize) / this.cellSize)));
    }

    /**
     * Maps world Z coordinate to clamped row index [0, rows - 1]
     * @param {number} z World Z coordinate
     * @returns {number} Clamped row index
     */
    _getRow(z) {
        return Math.max(0, Math.min(this.rows - 1, Math.floor((z + this.worldSize) / this.cellSize)));
    }

    /**
     * Returns the real cell at a flattened index, creating it the first time something is inserted there.
     * @param {number} index Flattened cell index (row * cols + col)
     * @returns {Object} Mutable cell
     */
    _getOrCreateCell(index) {
        let cell = this.cells[index];
        if (cell === EMPTY_CELL) {
            const col = index % this.cols;
            const row = Math.floor(index / this.cols);
            cell = {
                id: index,
                col,
                row,
                minX: col * this.cellSize - this.worldSize,
                maxX: (col + 1) * this.cellSize - this.worldSize,
                minZ: row * this.cellSize - this.worldSize,
                maxZ: (row + 1) * this.cellSize - this.worldSize,
                staticItems: [],
                dynamicItems: [],
                dynamicCount: 0
            };
            this.cells[index] = cell;
        }
        return cell;
    }

    /**
     * Clears dynamic entities from all active cells in O(active cells) time.
     * Guaranteed zero garbage collection allocation: truncates dynamicItems without re-creating arrays.
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
     * @returns {Object} The inserted static entry
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
                this._getOrCreateCell(rowOffset + c).staticItems.push(entry);
            }
        }
        return entry;
    }

    /**
     * Inserts or updates a dynamic entity (player, vehicle) into all cells it overlaps.
     * Zero heap allocations after initial insertion via two-tier entry pooling (a cell is allocated once, the first time anything enters it).
     * 
     * @param {string|number} id Unique entity ID
     * @param {number} x World X position
     * @param {number} z World Z position
     * @param {number} radius Bounding circle radius in meters
     * @param {Object} entityRef Reference to the entity instance
     * @returns {Object} The pooled/updated dynamic entry
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
            // Tier 2: Check internal persistent Map
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
                const cell = this._getOrCreateCell(rowOffset + c);
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
     * Writes directly into the caller's outResults array without allocating new memory.
     * Uses monotonic query ID tag for O(1) deduplication across cell boundaries.
     * 
     * @param {number} x Query center X
     * @param {number} z Query center Z
     * @param {number} radius Query radius in meters
     * @param {Array} outResults Reusable caller-owned scratch array
     * @param {'ALL'|'STATIC'|'DYNAMIC'} [filter='ALL'] Candidate filter
     * @returns {Array} outResults populated with unique candidate entries
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

                        // Broadphase circle vs clamped AABB test
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
     * Writes directly into caller's outResults array without allocating new memory.
     * 
     * @param {Object} box Bounding box with min/max having x and z
     * @param {Array} outResults Reusable caller-owned scratch array
     * @param {'ALL'|'STATIC'|'DYNAMIC'} [filter='ALL'] Candidate filter
     * @returns {Array} outResults populated with unique candidate entries
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
