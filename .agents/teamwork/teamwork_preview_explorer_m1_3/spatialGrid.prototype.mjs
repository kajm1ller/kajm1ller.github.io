/**
 * Prototype 2D Spatial Hash Grid
 * For testing and verification of M1 spatialGrid architecture
 */

export class SpatialGrid {
    constructor(worldSize = 600, cellSize = 15) {
        this.worldSize = worldSize;
        this.cellSize = cellSize;
        this.halfWorld = worldSize / 2;
        this.cols = Math.ceil(worldSize / cellSize);
        this.rows = Math.ceil(worldSize / cellSize);
        this.numCells = this.cols * this.rows;
        
        // Static cells: array of arrays of static objects
        this.staticCells = new Array(this.numCells);
        // Dynamic cells: array of arrays of dynamic objects
        this.dynamicCells = new Array(this.numCells);
        for (let i = 0; i < this.numCells; i++) {
            this.staticCells[i] = [];
            this.dynamicCells[i] = [];
        }
        
        // Active dynamic cell indices to clear quickly
        this.activeDynamicIndices = [];
        this.activeDynamicIndexSet = new Uint8Array(this.numCells);
        
        // Query counter for zero-allocation deduplication
        this.queryId = 0;
    }
    
    _coordToCellX(x) {
        const cx = Math.floor((x + this.halfWorld) / this.cellSize);
        return Math.max(0, Math.min(this.cols - 1, cx));
    }
    
    _coordToCellZ(z) {
        const cz = Math.floor((z + this.halfWorld) / this.cellSize);
        return Math.max(0, Math.min(this.rows - 1, cz));
    }
    
    _cellIndex(cx, cz) {
        return cz * this.cols + cx;
    }
    
    clearDynamic() {
        for (let i = 0; i < this.activeDynamicIndices.length; i++) {
            const idx = this.activeDynamicIndices[i];
            this.dynamicCells[idx].length = 0;
            this.activeDynamicIndexSet[idx] = 0;
        }
        this.activeDynamicIndices.length = 0;
    }
    
    insertStatic(id, box3) {
        // box3 has min: {x, y, z}, max: {x, y, z}
        const minX = this._coordToCellX(box3.min.x);
        const maxX = this._coordToCellX(box3.max.x);
        const minZ = this._coordToCellZ(box3.min.z);
        const maxZ = this._coordToCellZ(box3.max.z);
        
        const item = { id, box3, _lastQueryId: 0, isStatic: true };
        
        for (let cz = minZ; cz <= maxZ; cz++) {
            for (let cx = minX; cx <= maxX; cx++) {
                const idx = this._cellIndex(cx, cz);
                this.staticCells[idx].push(item);
            }
        }
    }
    
    insertDynamic(id, x, z, radius, entityRef) {
        const minX = this._coordToCellX(x - radius);
        const maxX = this._coordToCellX(x + radius);
        const minZ = this._coordToCellZ(z - radius);
        const maxZ = this._coordToCellZ(z + radius);
        
        const item = { id, x, z, radius, entityRef, _lastQueryId: 0, isStatic: false };
        
        for (let cz = minZ; cz <= maxZ; cz++) {
            for (let cx = minX; cx <= maxX; cx++) {
                const idx = this._cellIndex(cx, cz);
                this.dynamicCells[idx].push(item);
                if (this.activeDynamicIndexSet[idx] === 0) {
                    this.activeDynamicIndexSet[idx] = 1;
                    this.activeDynamicIndices.push(idx);
                }
            }
        }
    }
    
    queryRadius(x, z, radius, outResults) {
        outResults.length = 0;
        this.queryId = (this.queryId + 1) | 0;
        if (this.queryId === 0) this.queryId = 1; // handle 32-bit overflow
        const qId = this.queryId;
        
        const minX = this._coordToCellX(x - radius);
        const maxX = this._coordToCellX(x + radius);
        const minZ = this._coordToCellZ(z - radius);
        const maxZ = this._coordToCellZ(z + radius);
        
        const r2 = radius * radius;
        
        for (let cz = minZ; cz <= maxZ; cz++) {
            for (let cx = minX; cx <= maxX; cx++) {
                const idx = this._cellIndex(cx, cz);
                
                // Static items
                const statics = this.staticCells[idx];
                for (let i = 0; i < statics.length; i++) {
                    const item = statics[i];
                    if (item._lastQueryId !== qId) {
                        item._lastQueryId = qId;
                        outResults.push(item);
                    }
                }
                
                // Dynamic items
                const dynamics = this.dynamicCells[idx];
                for (let i = 0; i < dynamics.length; i++) {
                    const item = dynamics[i];
                    if (item._lastQueryId !== qId) {
                        item._lastQueryId = qId;
                        // Narrowphase circle check
                        const dx = item.x - x;
                        const dz = item.z - z;
                        const combinedR = radius + item.radius;
                        if (dx * dx + dz * dz <= combinedR * combinedR) {
                            outResults.push(item);
                        }
                    }
                }
            }
        }
        return outResults;
    }
    
    queryBox(box, outResults) {
        outResults.length = 0;
        this.queryId = (this.queryId + 1) | 0;
        if (this.queryId === 0) this.queryId = 1;
        const qId = this.queryId;
        
        const minX = this._coordToCellX(box.min.x);
        const maxX = this._coordToCellX(box.max.x);
        const minZ = this._coordToCellZ(box.min.z);
        const maxZ = this._coordToCellZ(box.max.z);
        
        for (let cz = minZ; cz <= maxZ; cz++) {
            for (let cx = minX; cx <= maxX; cx++) {
                const idx = this._cellIndex(cx, cz);
                
                const statics = this.staticCells[idx];
                for (let i = 0; i < statics.length; i++) {
                    const item = statics[i];
                    if (item._lastQueryId !== qId) {
                        item._lastQueryId = qId;
                        // Box overlap check
                        if (box.intersectsBox ? box.intersectsBox(item.box3) : true) {
                            outResults.push(item);
                        }
                    }
                }
                
                const dynamics = this.dynamicCells[idx];
                for (let i = 0; i < dynamics.length; i++) {
                    const item = dynamics[i];
                    if (item._lastQueryId !== qId) {
                        item._lastQueryId = qId;
                        outResults.push(item);
                    }
                }
            }
        }
        return outResults;
    }
}
