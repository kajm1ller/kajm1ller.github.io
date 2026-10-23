/**
 * js/game/mapLoader.js
 *
 * High-Performance /mapfinal 3D Map Loader & Aligned OSM Road Network for Kaj Simulator.
 *
 * Key Capabilities:
 * 1. Fast Asynchronous Loading:
 *    - Loads /mapfinal/materials.mtl and every part (part0000.obj .. part0620.obj).
 *    - Concurrency-controlled chunked pipeline (6 concurrent workers).
 * 2. Spatial Hash Grid Collision Optimization:
 *    - Parses building, wall, fence, and obstacle geometry during loading.
 *    - Computes static AABB bounds and registers them into SpatialGrid.insertStatic()
 *      for O(1) broadphase collision queries with zero heap allocation during gameplay.
 * 3. 60 FPS Performance Pipeline:
 *    - Re-buckets all part geometry into square world tiles (one indexed mesh per tile),
 *      so frustum culling and view-distance culling skip everything off screen.
 *    - Collapses the ~2100 OSM2World materials into a few dozen shared batch materials
 *      (per-material Kd colour is baked into a vertex colour attribute).
 *    - Static matrix freeze (child.matrixAutoUpdate = false; child.updateMatrix()).
 */

import * as THREE from 'three';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

export const ANOTHERMAPO_CONFIG = Object.freeze({
    // Game world projection (world origin sits in Kaj's neighbourhood)
    PROJECTION: Object.freeze({
        ORIGIN_LAT: 41.36928,
        ORIGIN_LON: -83.62857,
        ORIGIN_ELE: 0,
        EARTH_RADIUS: 6378137,
        NORTH_VECTOR: [0.0, 0.0, -1.0],
        EAST_VECTOR: [1.0, 0.0, 0.0],
        UNITS_PER_METER: 1.0
    }),

    PATHS: Object.freeze({
        MAP_DIR: '/mapfinal/',
        MTL_FILE: 'materials.mtl',
        PART_PREFIX: 'part',
        PART_EXT: '.obj'
    }),

    // /mapfinal was exported by OSM2World around lat 41.376, lon -83.6564 rather than the game
    // world origin above. Translating its geometry by this offset keeps the world origin, spawn
    // points, road waypoints and boundary walls where they were. Measured by matching identical
    // building vertices in both exports (Building25 by Kaj's house, Frickers downtown).
    MAP_OFFSET: Object.freeze({ x: -2324.73, y: 0.0, z: -748.02 }),

    LOADING: Object.freeze({
        PART_COUNT: 621,
        // part0594 .. part0620 are the flat TERRAIN_DEFAULT ground strips
        TERRAIN_PART_START: 594,
        TERRAIN_PART_END: 620,
        CONCURRENT_CHUNKS: 6,
        TIMEOUT_MS: 30000
    }),

    RENDER: Object.freeze({
        TILE_SIZE: 400
    }),

    SPAWN: Object.freeze({
        PLAYER_START: Object.freeze({ x: -120.1, y: 0.0, z: 64.0 }),
        CIVIC_START: Object.freeze({ x: -118.0, y: 0.0, z: 66.0, yaw: Math.PI }),
        KAJ_HOUSE_CENTER: Object.freeze({ x: -124.0, y: 0.0, z: 52.0 })
    }),

    COLLISION: Object.freeze({
        MIN_OBSTACLE_HEIGHT: 1.5,
        MIN_PLANAR_SIZE: 0.3,
        IGNORED_MATERIALS: ['ASPHALT', 'ROAD_MARKING', 'GRAVEL', 'GRASS', 'PAVING_STONE', 'GROUND', 'WATER', 'TERRAIN', 'TREE_BILLBOARD', 'EARTH', 'SCRUB']
    })
});

export function latLonToWorld(lat, lon) {
    const { ORIGIN_LAT, ORIGIN_LON, EARTH_RADIUS } = ANOTHERMAPO_CONFIG.PROJECTION;
    const lat0Rad = (ORIGIN_LAT * Math.PI) / 180;
    const dLat = ((lat - ORIGIN_LAT) * Math.PI) / 180;
    const dLon = ((lon - ORIGIN_LON) * Math.PI) / 180;

    const x = dLon * EARTH_RADIUS * Math.cos(lat0Rad);
    const z = -dLat * EARTH_RADIUS;
    return { x, z };
}

export function worldToLatLon(x, z) {
    const { ORIGIN_LAT, ORIGIN_LON, EARTH_RADIUS } = ANOTHERMAPO_CONFIG.PROJECTION;
    const lat0Rad = (ORIGIN_LAT * Math.PI) / 180;

    const lat = ORIGIN_LAT - (z / EARTH_RADIUS) * (180 / Math.PI);
    const lon = ORIGIN_LON + (x / (EARTH_RADIUS * Math.cos(lat0Rad))) * (180 / Math.PI);
    return { lat, lon };
}

export const OSM_NEIGHBORHOOD_ROADS = [
    {
        id: '160270260',
        name: 'Brookwood Drive',
        type: 'residential',
        speedLimit: 11.0,
        nodes: [
            { id: '1723187164', x: -59.1, z: 79.6 },
            { id: '1723187166', x: -74.8, z: 79.1 },
            { id: '1723187168', x: -89.4, z: 78.9 },
            { id: '1723187171', x: -102.6, z: 78.7 },
            { id: '1723187173', x: -114.1, z: 78.5 },
            { id: '1723187175', x: -123.4, z: 78.3 },
            { id: '1723187177', x: -141.9, z: 77.9 },
            { id: '1723187179', x: -150.5, z: 77.8 },
            { id: '1723187181', x: -160.0, z: 77.6 },
            { id: '1723187183', x: -169.0, z: 77.4 },
            { id: '1723187185', x: -178.0, z: 77.2 },
            { id: '1723187187', x: -198.5, z: 76.8 },
            { id: '1723187189', x: -217.3, z: 76.4 }
        ]
    },
    {
        id: '19309797',
        name: 'Burrwood Drive',
        type: 'residential',
        speedLimit: 11.0,
        nodes: [
            { id: '200610426', x: -215.7, z: -23.4 },
            { id: '200610428', x: -195.0, z: -23.1 },
            { id: '200610430', x: -175.0, z: -22.8 },
            { id: '200610432', x: -155.0, z: -22.5 },
            { id: '200610434', x: -135.0, z: -22.2 },
            { id: '200610436', x: -115.0, z: -21.9 },
            { id: '200610438', x: -95.0, z: -21.6 },
            { id: '200610440', x: -75.0, z: -21.3 },
            { id: '200610442', x: -57.1, z: -21.0 }
        ]
    },
    {
        id: '160270259',
        name: 'Briarwood Drive',
        type: 'residential',
        speedLimit: 11.0,
        nodes: [
            { id: '1723187190', x: -219.9, z: 175.5 },
            { id: '1723187192', x: -195.0, z: 175.9 },
            { id: '1723187194', x: -165.0, z: 176.4 },
            { id: '1723187196', x: -135.0, z: 176.9 },
            { id: '1723187198', x: -105.0, z: 177.4 },
            { id: '1723187200', x: -75.0, z: 177.9 },
            { id: '1723187202', x: -59.3, z: 178.2 }
        ]
    },
    {
        id: '19309747',
        name: 'Scott Hamilton Drive',
        type: 'residential',
        speedLimit: 11.0,
        nodes: [
            { id: '200609874', x: -215.2, z: -123.3 },
            { id: '200609876', x: -180.0, z: -122.7 },
            { id: '200609878', x: -140.0, z: -122.0 },
            { id: '200609880', x: -100.0, z: -121.2 },
            { id: '200609882', x: -59.5, z: -120.4 }
        ]
    },
    {
        id: '160270262_s',
        name: 'Bentwood Lane South',
        type: 'residential',
        speedLimit: 11.0,
        nodes: [
            { id: '200609874', x: -215.2, z: -123.3 },
            { id: '1723187204', x: -215.4, z: -70.0 },
            { id: '200610426', x: -215.7, z: -23.4 }
        ]
    },
    {
        id: '160270262_m',
        name: 'Bentwood Lane Central',
        type: 'residential',
        speedLimit: 11.0,
        nodes: [
            { id: '200610426', x: -215.7, z: -23.4 },
            { id: '1723187206', x: -216.2, z: 25.0 },
            { id: '1723187189', x: -217.3, z: 76.4 }
        ]
    },
    {
        id: '160270262_n',
        name: 'Bentwood Lane North',
        type: 'residential',
        speedLimit: 11.0,
        nodes: [
            { id: '1723187189', x: -217.3, z: 76.4 },
            { id: '1723187208', x: -218.4, z: 125.0 },
            { id: '1723187190', x: -219.9, z: 175.5 }
        ]
    },
    {
        id: '160270261_s',
        name: 'South Mercer Road South',
        type: 'residential',
        speedLimit: 11.0,
        nodes: [
            { id: '200609882', x: -59.5, z: -120.4 },
            { id: '1723187210', x: -58.2, z: -70.0 },
            { id: '200610442', x: -57.1, z: -21.0 }
        ]
    },
    {
        id: '160270261_m',
        name: 'South Mercer Road Central',
        type: 'residential',
        speedLimit: 11.0,
        nodes: [
            { id: '200610442', x: -57.1, z: -21.0 },
            { id: '1723187212', x: -58.0, z: 30.0 },
            { id: '1723187164', x: -59.1, z: 79.6 }
        ]
    },
    {
        id: '160270261_n',
        name: 'South Mercer Road North',
        type: 'residential',
        speedLimit: 11.0,
        nodes: [
            { id: '1723187164', x: -59.1, z: 79.6 },
            { id: '1723187214', x: -59.2, z: 130.0 },
            { id: '1723187202', x: -59.3, z: 178.2 }
        ]
    }
];

// OSM2World material naming decides depth offset, culling side and alpha handling for each surface type
function classifyMapMaterial(mName, isTerrainPart) {
    if (isTerrainPart || mName.includes('TERRAIN')) return 'TERRAIN';
    if (
        mName.includes('GRASS') ||
        mName.includes('EARTH') ||
        mName.includes('GROUND') ||
        mName.includes('SCRUB') ||
        mName.includes('WATER')
    ) return 'GROUND';
    if (mName.includes('CONCRETE') || mName.includes('PAVING_STONE')) return 'PAVEMENT';
    if (mName.includes('ASPHALT') || mName.includes('GRAVEL') || mName.endsWith('_0')) return 'ROAD';
    if (!mName.endsWith('_0') && (mName.includes('ROAD_MARKING') || mName.endsWith('_1'))) return 'MARKING';
    if (mName.includes('TREE_BILLBOARD') || mName.includes('FENCE') || mName.includes('HEDGE')) return 'CUTOUT';
    return 'SOLID';
}

function applyMapMaterialClass(material, materialClass) {
    switch (materialClass) {
        case 'TERRAIN':
            material.side = THREE.DoubleSide;
            material.polygonOffset = true;
            material.polygonOffsetFactor = 2;
            material.polygonOffsetUnits = 2;
            break;
        case 'GROUND':
            material.side = THREE.DoubleSide;
            material.polygonOffset = true;
            material.polygonOffsetFactor = 1;
            material.polygonOffsetUnits = 1;
            break;
        case 'PAVEMENT':
            material.side = THREE.DoubleSide;
            material.polygonOffset = true;
            material.polygonOffsetFactor = -1;
            material.polygonOffsetUnits = -1;
            break;
        case 'ROAD':
            material.side = THREE.DoubleSide;
            break;
        case 'MARKING':
            material.side = THREE.DoubleSide;
            material.transparent = true;
            material.alphaTest = 0.1;
            material.depthWrite = false;
            material.polygonOffset = true;
            material.polygonOffsetFactor = -2;
            material.polygonOffsetUnits = -2;
            break;
        case 'CUTOUT':
            material.side = THREE.DoubleSide;
            material.alphaTest = 0.5;
            material.transparent = true;
            break;
        default:
            material.side = THREE.FrontSide;
            break;
    }
}

// Resolve a 1-based (or negative, relative) OBJ index to a 0-based index; -1 when absent
function resolveObjIndex(token, count) {
    const n = parseInt(token, 10);
    if (!Number.isFinite(n) || n === 0) return -1;
    return n > 0 ? n - 1 : count + n;
}

export class AnothermapoLoader {
    constructor(options = {}) {
        this.basePath = options.basePath || ANOTHERMAPO_CONFIG.PATHS.MAP_DIR;
        this.partCount = options.partCount !== undefined ? options.partCount : ANOTHERMAPO_CONFIG.LOADING.PART_COUNT;
        this.batchSize = options.batchSize || ANOTHERMAPO_CONFIG.LOADING.CONCURRENT_CHUNKS;
        this.tileSize = options.tileSize || ANOTHERMAPO_CONFIG.RENDER.TILE_SIZE;
        this.offset = options.offset || ANOTHERMAPO_CONFIG.MAP_OFFSET;
        this.freezeTransforms = options.freezeTransforms !== false;
        this.registerColliders = options.registerColliders !== false;
        this.roadNetwork = options.roadNetwork || null;
        this.collisionMeshes = options.collisionMeshes || null;
        // Cap on texture width/height in px (0 = full size). Mobile GPUs/tabs cannot hold the ~680MB of decoded 2048px textures.
        this.maxTextureSize = options.maxTextureSize || 0;

        this.materials = null;
        this.materialInfoCache = new Map();
        this.batchMaterials = new Map();
        this.tileBuckets = new Map();
        this.texturePromises = [];
        this.textureFailures = [];
        this.terrainBounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };

        this.mapRoot = new THREE.Group();
        this.mapRoot.name = 'anothermapo_world_root';
        this.mapRoot.userData.isMap = true;

        this.parts = [];
        this.failedParts = [];
        this.tiles = [];
        this.isLoaded = false;
        this.loadedCount = 0;
        this.totalParts = this.partCount;
        this.obstacleCount = 0;
        this.totalTriangles = 0;
    }

    _partName(partIndex) {
        const { PART_PREFIX, PART_EXT } = ANOTHERMAPO_CONFIG.PATHS;
        return `${PART_PREFIX}${String(partIndex).padStart(4, '0')}${PART_EXT}`;
    }

    _isTerrainPart(partIndex) {
        const { TERRAIN_PART_START, TERRAIN_PART_END } = ANOTHERMAPO_CONFIG.LOADING;
        return partIndex >= TERRAIN_PART_START && partIndex <= TERRAIN_PART_END;
    }

    async load(scene, spatialGrid = null, onProgress = null) {
        const report = (percent, statusText) => {
            if (typeof onProgress === 'function') {
                onProgress({
                    percent: Math.min(100, Math.max(0, Math.round(percent))),
                    loadedCount: this.loadedCount,
                    totalParts: this.totalParts,
                    statusText
                });
            }
        };

        report(5, 'Loading materials.mtl...');

        const mtlLoader = new MTLLoader();
        mtlLoader.setPath(this.basePath);

        try {
            this.materials = await new Promise((resolve) => {
                mtlLoader.load(
                    ANOTHERMAPO_CONFIG.PATHS.MTL_FILE,
                    (materials) => {
                        // Share a single Texture instance per texture URL across all materials to avoid thousands of duplicate HTTP requests,
                        // and track every texture so load() only resolves once they have all arrived
                        const texCache = new Map();
                        const texLoader = new THREE.TextureLoader(materials.manager);
                        materials.loadTexture = (url, mapping, onLoad, onProgress, onError) => {
                            if (texCache.has(url)) {
                                return texCache.get(url);
                            }
                            let settle;
                            this.texturePromises.push(new Promise((r) => { settle = r; }));
                            const texture = texLoader.load(
                                url,
                                (tex) => {
                                    this._downscaleTexture(tex);
                                    settle();
                                    if (onLoad) onLoad(tex);
                                },
                                onProgress,
                                (err) => {
                                    this.textureFailures.push(url);
                                    console.warn(`[AnothermapoLoader] Warning: texture ${url} failed to load:`, err);
                                    settle();
                                    if (onError) onError(err);
                                }
                            );
                            if (mapping !== undefined) texture.mapping = mapping;
                            texture.wrapS = THREE.RepeatWrapping;
                            texture.wrapT = THREE.RepeatWrapping;
                            texCache.set(url, texture);
                            return texture;
                        };
                        resolve(materials);
                    },
                    undefined,
                    (err) => {
                        console.warn('[AnothermapoLoader] Warning: materials.mtl failed to load:', err);
                        resolve(null);
                    }
                );
            });
        } catch (e) {
            this.materials = null;
        }

        report(15, `Loaded materials. Loading ${this.totalParts} map parts...`);

        let currentIndex = 0;
        const loadPartWorker = async () => {
            while (currentIndex < this.partCount) {
                const partIndex = currentIndex++;
                const partName = this._partName(partIndex);

                try {
                    const resp = await fetch(this.basePath + partName);
                    if (!resp.ok) {
                        throw new Error(`HTTP ${resp.status}`);
                    }
                    const rawText = await resp.text();
                    this._ingestObjText(rawText, partName, this._isTerrainPart(partIndex), spatialGrid);
                    this.parts.push(partName);
                } catch (err) {
                    this.failedParts.push(partName);
                    console.warn(`[AnothermapoLoader] Warning: part ${partName} skipped:`, err);
                } finally {
                    this.loadedCount++;
                    const pct = 15 + ((this.loadedCount / this.totalParts) * 75);
                    report(pct, `Loaded ${this.loadedCount}/${this.totalParts} map parts...`);
                }
                // Yield briefly to keep main thread responsive
                await new Promise((r) => setTimeout(r, 0));
            }
        };

        const workers = [];
        for (let w = 0; w < this.batchSize; w++) {
            workers.push(loadPartWorker());
        }
        await Promise.all(workers);

        report(90, 'Building map tiles...');
        await this._buildTileMeshes((built, total) => {
            report(90 + ((built / total) * 7), `Building map tiles ${built}/${total}...`);
        });

        report(97, `Loading ${this.texturePromises.length} map textures...`);
        await Promise.all(this.texturePromises);

        const terrainFiller = this._buildTerrainFiller();
        if (terrainFiller) {
            this.mapRoot.add(terrainFiller);
        }

        if (scene) {
            scene.add(this.mapRoot);
        }
        this.isLoaded = true;

        if (this.failedParts.length > 0 || this.textureFailures.length > 0) {
            console.warn(
                `[AnothermapoLoader] Map loaded with ${this.failedParts.length} failed parts and ${this.textureFailures.length} failed textures.`,
                this.failedParts,
                this.textureFailures
            );
        }

        report(100, `Map ready! ${this.parts.length}/${this.totalParts} parts loaded (${this.obstacleCount} colliders registered).`);

        return {
            isLoaded: true,
            mapRoot: this.mapRoot,
            parts: this.parts,
            tiles: this.tiles,
            failedParts: this.failedParts,
            textureFailures: this.textureFailures,
            loadedPartsCount: this.parts.length,
            loadedCount: this.loadedCount,
            obstacleCount: this.obstacleCount,
            totalTriangles: this.totalTriangles
        };
    }

    /**
     * The OSM2World export has a few genuine holes where no surface was generated. Fill them with a
     * ground sheet just below the terrain that uses the terrain's own batch material, colour and
     * world-scale texture mapping (vt = source x, -source z), so wherever it overlaps the terrain it
     * renders identical pixels and never shows as a separate, stretched texture.
     */
    _buildTerrainFiller() {
        const tb = this.terrainBounds;
        const terrainInfo = this.materialInfoCache.get('TERRAIN_DEFAULT_0|T');
        if (!terrainInfo || !Number.isFinite(tb.minX) || !Number.isFinite(tb.minZ)) return null;

        const corners = [
            [tb.minX, tb.minZ],
            [tb.minX, tb.maxZ],
            [tb.maxX, tb.maxZ],
            [tb.maxX, tb.minZ]
        ];
        const y = -0.05;
        const pos = new Float32Array(12);
        const nrm = new Int16Array(12);
        const uv = new Float32Array(8);
        const col = new Uint16Array(12);
        for (let i = 0; i < 4; i++) {
            const [x, z] = corners[i];
            pos[i * 3] = x;
            pos[i * 3 + 1] = y;
            pos[i * 3 + 2] = z;
            nrm[i * 3 + 1] = 32767;
            uv[i * 2] = x - this.offset.x;
            uv[i * 2 + 1] = -(z - this.offset.z);
            col[i * 3] = terrainInfo.r;
            col[i * 3 + 1] = terrainInfo.g;
            col[i * 3 + 2] = terrainInfo.b;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geometry.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
        // Counter-clockwise when seen from above so the face normal points up
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        const mesh = new THREE.Mesh(geometry, this.batchMaterials.get(terrainInfo.batchKey));
        mesh.name = 'anothermapo_terrain_filler';
        mesh.userData.isMapPart = true;
        mesh.userData.isTerrainFiller = true;
        mesh.frustumCulled = false;
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        return mesh;
    }

    /**
     * Hide tiles that are entirely beyond viewDistance (e.g. past the fog's far plane).
     * Tiles live at the world origin, so their geometry bounding spheres are already in world space.
     */
    updateVisibility(cameraPosition, viewDistance) {
        for (let i = 0, len = this.tiles.length; i < len; i++) {
            const tile = this.tiles[i];
            const sphere = tile.geometry.boundingSphere;
            const dx = sphere.center.x - cameraPosition.x;
            const dy = sphere.center.y - cameraPosition.y;
            const dz = sphere.center.z - cameraPosition.z;
            tile.visible = Math.sqrt(dx * dx + dy * dy + dz * dz) - sphere.radius <= viewDistance;
        }
    }

    _getMaterialInfo(name, isTerrainPart) {
        const cacheKey = name + (isTerrainPart ? '|T' : '|M');
        const cached = this.materialInfoCache.get(cacheKey);
        if (cached) return cached;

        const mName = name.toUpperCase();
        const materialClass = classifyMapMaterial(mName, isTerrainPart);

        let color = new THREE.Color(0x888888);
        let map = null;
        let alphaMap = null;
        let transparent = false;
        let opacity = 1.0;
        if (this.materials) {
            const source = this.materials.create(name);
            if (source) {
                if (source.color) color = source.color.clone();
                map = source.map || null;
                alphaMap = source.alphaMap || null;
                transparent = !!source.transparent;
                opacity = source.opacity !== undefined ? source.opacity : 1.0;
            }
        }

        // Materials that only differ by Kd colour share one batch material; the colour moves into the vertex colour attribute
        const batchKey = [
            materialClass,
            map ? map.uuid : '-',
            alphaMap ? alphaMap.uuid : '-',
            transparent ? 1 : 0,
            opacity
        ].join('|');

        if (!this.batchMaterials.has(batchKey)) {
            const batchMaterial = new THREE.MeshLambertMaterial({
                name: name,
                color: 0xffffff,
                vertexColors: true,
                map,
                alphaMap,
                transparent,
                opacity
            });
            if (batchMaterial.map) {
                batchMaterial.map.wrapS = THREE.RepeatWrapping;
                batchMaterial.map.wrapT = THREE.RepeatWrapping;
            }
            applyMapMaterialClass(batchMaterial, materialClass);
            batchMaterial.userData.batchKey = batchKey;
            this.batchMaterials.set(batchKey, batchMaterial);
        }

        const toUnorm16 = (v) => Math.max(0, Math.min(65535, Math.round(v * 65535)));
        const info = {
            batchKey,
            // Lift road markings slightly above the asphalt; terrain, grass, sidewalks and roads stay flush at y = 0
            lift: (!isTerrainPart && !mName.endsWith('_0') && (mName.includes('ROAD_MARKING') || mName.endsWith('_1'))) ? 0.012 : 0,
            r: toUnorm16(color.r),
            g: toUnorm16(color.g),
            b: toUnorm16(color.b)
        };
        this.materialInfoCache.set(cacheKey, info);
        return info;
    }

    /**
     * Parse one OSM2World OBJ part, register its obstacle colliders, and append its triangles
     * (offset into game world space) to the per-tile, per-batch-material vertex buckets.
     */
    _downscaleTexture(tex) {
        const max = this.maxTextureSize;
        const img = tex.image;
        if (!max || !img || !img.width || (img.width <= max && img.height <= max)) return;
        const scale = max / Math.max(img.width, img.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        tex.image = canvas;
        tex.needsUpdate = true;
    }

    _ingestObjText(rawText, partName, isTerrainPart, spatialGrid) {
        const ox = this.offset.x;
        const oy = this.offset.y;
        const oz = this.offset.z;
        const extractColliders = !isTerrainPart && this.registerColliders && !!spatialGrid;

        const positions = [];
        const uvs = [];
        const normals = [];
        const corners = [];          // 9 ints per triangle: (v, vt, vn) x 3, 0-based, -1 when absent
        const triangleSlots = [];    // material slot per triangle
        const slotNames = [];
        const slotByName = new Map();
        let currentSlot = -1;

        // Per OBJ 'o'/'g' block AABB for obstacle colliders
        const ignoredMaterials = ANOTHERMAPO_CONFIG.COLLISION.IGNORED_MATERIALS;
        const minHeight = ANOTHERMAPO_CONFIG.COLLISION.MIN_OBSTACLE_HEIGHT;
        const minPlanar = ANOTHERMAPO_CONFIG.COLLISION.MIN_PLANAR_SIZE;
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        let blockVertexCount = 0;
        let blockMatName = '';

        const flushBlock = () => {
            if (blockVertexCount >= 3) {
                const height = maxY - minY;
                const width = maxX - minX;
                const depth = maxZ - minZ;
                if (
                    height >= minHeight &&
                    (width >= minPlanar || depth >= minPlanar) &&
                    width <= 60.0 &&
                    depth <= 60.0
                ) {
                    let isIgnored = false;
                    for (let i = 0; i < ignoredMaterials.length; i++) {
                        if (blockMatName.includes(ignoredMaterials[i])) {
                            isIgnored = true;
                            break;
                        }
                    }
                    if (!isIgnored) {
                        this._registerWorldBoundsCollider(
                            minX, minY, minZ,
                            maxX, maxY, maxZ,
                            height, spatialGrid, partName, null
                        );
                    }
                }
            }
            minX = Infinity; minY = Infinity; minZ = Infinity;
            maxX = -Infinity; maxY = -Infinity; maxZ = -Infinity;
            blockVertexCount = 0;
            blockMatName = '';
        };

        const lines = rawText.split('\n');
        for (let li = 0, len = lines.length; li < len; li++) {
            const line = lines[li];
            const c0 = line.charCodeAt(0);
            const c1 = line.charCodeAt(1);

            if (c0 === 118) {
                // 'v ' / 'vt' / 'vn'
                if (c1 === 32) {
                    const p = line.trim().split(/\s+/);
                    const vx = parseFloat(p[1]) + ox;
                    const vy = parseFloat(p[2]) + oy;
                    const vz = parseFloat(p[3]) + oz;
                    positions.push(vx, vy, vz);
                    if (isTerrainPart) {
                        const tb = this.terrainBounds;
                        if (vx < tb.minX) tb.minX = vx;
                        if (vx > tb.maxX) tb.maxX = vx;
                        if (vz < tb.minZ) tb.minZ = vz;
                        if (vz > tb.maxZ) tb.maxZ = vz;
                    }
                    if (extractColliders) {
                        if (vx < minX) minX = vx;
                        if (vx > maxX) maxX = vx;
                        if (vy < minY) minY = vy;
                        if (vy > maxY) maxY = vy;
                        if (vz < minZ) minZ = vz;
                        if (vz > maxZ) maxZ = vz;
                        blockVertexCount++;
                    }
                } else if (c1 === 116) {
                    const p = line.trim().split(/\s+/);
                    uvs.push(parseFloat(p[1]) || 0, parseFloat(p[2]) || 0);
                } else if (c1 === 110) {
                    const p = line.trim().split(/\s+/);
                    normals.push(parseFloat(p[1]) || 0, parseFloat(p[2]) || 0, parseFloat(p[3]) || 0);
                }
            } else if (c0 === 102 && c1 === 32) {
                // 'f ' - triangulated as a fan (OSM2World only emits triangles)
                const p = line.trim().split(/\s+/);
                if (p.length < 4) continue;
                if (currentSlot < 0) {
                    currentSlot = slotNames.length;
                    slotNames.push('');
                    slotByName.set('', currentSlot);
                }
                const vCount = positions.length / 3;
                const tCount = uvs.length / 2;
                const nCount = normals.length / 3;
                const resolved = [];
                for (let k = 1; k < p.length; k++) {
                    const idx = p[k].split('/');
                    resolved.push(
                        resolveObjIndex(idx[0], vCount),
                        idx.length > 1 ? resolveObjIndex(idx[1], tCount) : -1,
                        idx.length > 2 ? resolveObjIndex(idx[2], nCount) : -1
                    );
                }
                const cornerCount = resolved.length / 3;
                for (let k = 1; k < cornerCount - 1; k++) {
                    corners.push(
                        resolved[0], resolved[1], resolved[2],
                        resolved[k * 3], resolved[k * 3 + 1], resolved[k * 3 + 2],
                        resolved[(k + 1) * 3], resolved[(k + 1) * 3 + 1], resolved[(k + 1) * 3 + 2]
                    );
                    triangleSlots.push(currentSlot);
                }
            } else if (c0 === 117 && line.startsWith('usemtl ')) {
                const name = line.slice(7).trim();
                let slot = slotByName.get(name);
                if (slot === undefined) {
                    slot = slotNames.length;
                    slotNames.push(name);
                    slotByName.set(name, slot);
                }
                currentSlot = slot;
                if (!blockMatName) blockMatName = name.toUpperCase();
            } else if ((c0 === 111 || c0 === 103) && c1 === 32) {
                // 'o ' / 'g ' starts a new object block
                if (extractColliders) flushBlock();
            }
        }
        if (extractColliders) flushBlock();

        // Bucket every triangle by the world tile its centroid falls in, de-duplicating shared corners per material
        const slotInfo = slotNames.map((name) => this._getMaterialInfo(name, isTerrainPart));
        const tileSize = this.tileSize;
        const posCount = positions.length / 3;
        const uvCount = uvs.length / 2;
        const normalCount = normals.length / 3;
        const tilePrefix = isTerrainPart ? 'T' : 'M';
        const accumulators = new Map();

        for (let t = 0, triCount = triangleSlots.length; t < triCount; t++) {
            const base = t * 9;
            const v0 = corners[base];
            const v1 = corners[base + 3];
            const v2 = corners[base + 6];
            if (v0 < 0 || v1 < 0 || v2 < 0 || v0 >= posCount || v1 >= posCount || v2 >= posCount) continue;

            const cx = (positions[v0 * 3] + positions[v1 * 3] + positions[v2 * 3]) / 3;
            const cz = (positions[v0 * 3 + 2] + positions[v1 * 3 + 2] + positions[v2 * 3 + 2]) / 3;
            const ix = Math.floor(cx / tileSize);
            const iz = Math.floor(cz / tileSize);
            const tileKey = tilePrefix + ix + ',' + iz;
            const slot = triangleSlots[t];
            const accKey = tileKey + '|' + slot;

            let acc = accumulators.get(accKey);
            if (!acc) {
                acc = { tileKey, ix, iz, info: slotInfo[slot], pos: [], nrm: [], uv: [], idx: [], lookup: new Map() };
                accumulators.set(accKey, acc);
            }

            // Flat face normal, only used for corners without a 'vn'
            let fnx = 0, fny = 1, fnz = 0;
            let hasFaceNormal = false;

            for (let c = 0; c < 3; c++) {
                const vi = corners[base + c * 3];
                const ti = corners[base + c * 3 + 1];
                const ni = corners[base + c * 3 + 2];
                const hasNormal = ni >= 0 && ni < normalCount;
                const key = hasNormal ? (vi + '/' + ti + '/' + ni) : (vi + '/' + ti + '/f' + t);
                let index = acc.lookup.get(key);
                if (index === undefined) {
                    index = acc.pos.length / 3;
                    acc.lookup.set(key, index);
                    acc.pos.push(positions[vi * 3], positions[vi * 3 + 1] + acc.info.lift, positions[vi * 3 + 2]);
                    if (ti >= 0 && ti < uvCount) {
                        acc.uv.push(uvs[ti * 2], uvs[ti * 2 + 1]);
                    } else {
                        acc.uv.push(0, 0);
                    }
                    let nx, ny, nz;
                    if (hasNormal) {
                        nx = normals[ni * 3];
                        ny = normals[ni * 3 + 1];
                        nz = normals[ni * 3 + 2];
                    } else {
                        if (!hasFaceNormal) {
                            const ax = positions[v1 * 3] - positions[v0 * 3];
                            const ay = positions[v1 * 3 + 1] - positions[v0 * 3 + 1];
                            const az = positions[v1 * 3 + 2] - positions[v0 * 3 + 2];
                            const bx = positions[v2 * 3] - positions[v0 * 3];
                            const by = positions[v2 * 3 + 1] - positions[v0 * 3 + 1];
                            const bz = positions[v2 * 3 + 2] - positions[v0 * 3 + 2];
                            fnx = ay * bz - az * by;
                            fny = az * bx - ax * bz;
                            fnz = ax * by - ay * bx;
                            hasFaceNormal = true;
                        }
                        nx = fnx; ny = fny; nz = fnz;
                    }
                    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
                    if (nLen > 1e-12) {
                        acc.nrm.push(nx / nLen, ny / nLen, nz / nLen);
                    } else {
                        acc.nrm.push(0, 1, 0);
                    }
                }
                acc.idx.push(index);
            }
            this.totalTriangles++;
        }

        for (const acc of accumulators.values()) {
            let tile = this.tileBuckets.get(acc.tileKey);
            if (!tile) {
                tile = { key: acc.tileKey, ix: acc.ix, iz: acc.iz, isTerrain: isTerrainPart, batches: new Map() };
                this.tileBuckets.set(acc.tileKey, tile);
            }
            let batch = tile.batches.get(acc.info.batchKey);
            if (!batch) {
                batch = { batchKey: acc.info.batchKey, chunks: [], vertexCount: 0, indexCount: 0 };
                tile.batches.set(acc.info.batchKey, batch);
            }
            const vertexCount = acc.pos.length / 3;
            const nrm = new Int16Array(acc.nrm.length);
            for (let i = 0; i < acc.nrm.length; i++) {
                nrm[i] = Math.round(acc.nrm[i] * 32767);
            }
            batch.chunks.push({
                pos: new Float32Array(acc.pos),
                nrm,
                uv: new Float32Array(acc.uv),
                idx: new Uint32Array(acc.idx),
                r: acc.info.r,
                g: acc.info.g,
                b: acc.info.b,
                vertexCount
            });
            batch.vertexCount += vertexCount;
            batch.indexCount += acc.idx.length;
        }
    }

    async _buildTileMeshes(onTileBuilt) {
        const tiles = Array.from(this.tileBuckets.values());
        tiles.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        for (let i = 0; i < tiles.length; i++) {
            const mesh = this._buildTileMesh(tiles[i]);
            // Release the source chunks as soon as the tile geometry owns the data
            this.tileBuckets.delete(tiles[i].key);
            if (mesh) {
                this.mapRoot.add(mesh);
                this.tiles.push(mesh);
            }
            if (typeof onTileBuilt === 'function') {
                onTileBuilt(i + 1, tiles.length);
            }
            if (i % 8 === 7) {
                await new Promise((r) => setTimeout(r, 0));
            }
        }
    }

    _buildTileMesh(tile) {
        const batches = Array.from(tile.batches.values());
        batches.sort((a, b) => (a.batchKey < b.batchKey ? -1 : a.batchKey > b.batchKey ? 1 : 0));

        let vertexTotal = 0;
        let indexTotal = 0;
        for (let i = 0; i < batches.length; i++) {
            vertexTotal += batches[i].vertexCount;
            indexTotal += batches[i].indexCount;
        }
        if (indexTotal === 0) return null;

        const pos = new Float32Array(vertexTotal * 3);
        const nrm = new Int16Array(vertexTotal * 3);
        const uv = new Float32Array(vertexTotal * 2);
        const col = new Uint16Array(vertexTotal * 3);
        const idx = vertexTotal > 65535 ? new Uint32Array(indexTotal) : new Uint16Array(indexTotal);

        const geometry = new THREE.BufferGeometry();
        const materials = [];
        let vBase = 0;
        let iBase = 0;
        for (let b = 0; b < batches.length; b++) {
            const batch = batches[b];
            const groupStart = iBase;
            for (let c = 0; c < batch.chunks.length; c++) {
                const chunk = batch.chunks[c];
                pos.set(chunk.pos, vBase * 3);
                nrm.set(chunk.nrm, vBase * 3);
                uv.set(chunk.uv, vBase * 2);
                for (let v = 0; v < chunk.vertexCount; v++) {
                    const o = (vBase + v) * 3;
                    col[o] = chunk.r;
                    col[o + 1] = chunk.g;
                    col[o + 2] = chunk.b;
                }
                const chunkIdx = chunk.idx;
                for (let k = 0; k < chunkIdx.length; k++) {
                    idx[iBase + k] = chunkIdx[k] + vBase;
                }
                vBase += chunk.vertexCount;
                iBase += chunkIdx.length;
            }
            geometry.addGroup(groupStart, iBase - groupStart, materials.length);
            materials.push(this.batchMaterials.get(batch.batchKey));
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geometry.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
        geometry.setIndex(new THREE.BufferAttribute(idx, 1));
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        const mesh = new THREE.Mesh(geometry, materials);
        mesh.name = `${tile.isTerrain ? 'terrain' : 'map'}_tile_${tile.ix}_${tile.iz}`;
        mesh.userData.isMapPart = true;
        mesh.userData.isMapTile = true;
        mesh.userData.isTerrainTile = tile.isTerrain;
        mesh.frustumCulled = true;
        mesh.receiveShadow = true;
        // Ground strips only receive shadows; everything else (buildings, trees, poles) casts
        mesh.castShadow = !tile.isTerrain;
        if (this.freezeTransforms) {
            mesh.matrixAutoUpdate = false;
            mesh.updateMatrix();
        }
        return mesh;
    }

    _registerWorldBoundsCollider(minX, minY, minZ, maxX, maxY, maxZ, height, spatialGrid, partName, meshRef = null) {
        if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
            return;
        }

        const cx = (minX + maxX) * 0.5;
        const cz = (minZ + maxZ) * 0.5;

        // Keep player & Civic spawn driveway and origin clear of overhanging roof/tree AABBs
        const spawnP = ANOTHERMAPO_CONFIG.SPAWN.PLAYER_START;
        const civicP = ANOTHERMAPO_CONFIG.SPAWN.CIVIC_START;
        if (Math.hypot(cx - spawnP.x, cz - spawnP.z) < 16.0) return;
        if (Math.hypot(cx - civicP.x, cz - civicP.z) < 22.0) return;
        if (Math.abs(cx) < 15.0 && Math.abs(cz) < 15.0) return;

        if (this.roadNetwork && typeof this.roadNetwork.isNearRoad === 'function') {
            if (this.roadNetwork.isNearRoad(cx, cz, 6.0)) return;
        }

        const worldBox = new THREE.Box3(
            new THREE.Vector3(minX, minY, minZ),
            new THREE.Vector3(maxX, maxY, maxZ)
        );

        const obstacleId = `building_${partName}_${++this.obstacleCount}`;
        const userData = {
            type: 'building',
            isBuilding: true,
            height,
            worldBox,
            partName,
            mesh: meshRef
        };

        if (meshRef) {
            meshRef.userData.worldBox = worldBox;
            meshRef.userData.height = height;
            meshRef.userData.isBuilding = true;
        }

        if (Array.isArray(this.collisionMeshes)) {
            this.collisionMeshes.push(meshRef || { userData });
        }

        if (typeof spatialGrid.insertStatic === 'function') {
            spatialGrid.insertStatic(obstacleId, worldBox, userData);
        }
    }
}

export class OSMRoadNetwork {
    constructor(config = {}) {
        this.laneWidth = config.laneWidth || 3.6;
        this.shoulderWidth = config.shoulderWidth || 0.4;
        this.waypointStep = config.waypointStep || 2.5;
        this.halfRoadWidth = this.laneWidth + this.shoulderWidth;

        this.lanes = [];
        this.lanesById = new Map();
        this.waypoints = [];
        this.segments = [];
        this.nodes = new Map();

        this._buildNetworkFromOSM();
    }

    _buildNetworkFromOSM() {
        let laneIdCounter = 0;
        const halfLane = this.laneWidth * 0.5;

        for (const road of OSM_NEIGHBORHOOD_ROADS) {
            const pts = road.nodes;
            if (pts.length < 2) continue;

            for (const pt of pts) {
                if (!this.nodes.has(pt.id)) {
                    this.nodes.set(pt.id, { id: pt.id, x: pt.x, z: pt.z, degree: 0, isIntersection: false });
                }
                const nodeObj = this.nodes.get(pt.id);
                nodeObj.degree++;
                if (nodeObj.degree >= 2) nodeObj.isIntersection = true;
            }

            const fwdLaneId = `lane_fwd_${road.id}_${laneIdCounter++}`;
            const revLaneId = `lane_rev_${road.id}_${laneIdCounter++}`;

            const fwdLane = {
                id: fwdLaneId,
                roadId: road.id,
                name: road.name,
                speedLimit: road.speedLimit,
                waypoints: [],
                nextLanes: [],
                prevLanes: [],
                length: 0
            };

            const revLane = {
                id: revLaneId,
                roadId: road.id,
                name: road.name,
                speedLimit: road.speedLimit,
                waypoints: [],
                nextLanes: [],
                prevLanes: [],
                length: 0
            };

            for (let i = 0; i < pts.length - 1; i++) {
                const p0 = pts[i];
                const p1 = pts[i + 1];

                const dx = p1.x - p0.x;
                const dz = p1.z - p0.z;
                const segLen = Math.hypot(dx, dz);
                if (segLen < 0.1) continue;

                const ux = dx / segLen;
                const uz = dz / segLen;
                const nx = -uz;
                const nz = ux;

                this.segments.push({
                    roadId: road.id,
                    p0, p1,
                    ux, uz, nx, nz,
                    len: segLen,
                    minX: Math.min(p0.x, p1.x),
                    maxX: Math.max(p0.x, p1.x),
                    minZ: Math.min(p0.z, p1.z),
                    maxZ: Math.max(p0.z, p1.z)
                });

                const fwdYaw = Math.atan2(-ux, -uz);
                const revYaw = Math.atan2(ux, uz);

                const steps = Math.max(1, Math.ceil(segLen / this.waypointStep));
                for (let s = 0; s <= steps; s++) {
                    const t = s / steps;
                    const cx = p0.x + t * dx;
                    const cz = p0.z + t * dz;

                    const fwdWp = {
                        x: cx + nx * halfLane,
                        z: cz + nz * halfLane,
                        yaw: fwdYaw,
                        laneId: fwdLane.id,
                        index: fwdLane.waypoints.length,
                        speedLimit: road.speedLimit
                    };
                    fwdLane.waypoints.push(fwdWp);
                    this.waypoints.push(fwdWp);

                    const revWp = {
                        x: cx - nx * halfLane,
                        z: cz - nz * halfLane,
                        yaw: revYaw,
                        laneId: revLane.id,
                        index: 0,
                        speedLimit: road.speedLimit
                    };
                    revLane.waypoints.unshift(revWp);
                    this.waypoints.push(revWp);
                }
            }

            for (let idx = 0; idx < revLane.waypoints.length; idx++) {
                revLane.waypoints[idx].index = idx;
            }

            this.lanes.push(fwdLane);
            this.lanes.push(revLane);
            this.lanesById.set(fwdLane.id, fwdLane);
            this.lanesById.set(revLane.id, revLane);
        }

        this._connectIntersections();
    }

    _connectIntersections() {
        for (const laneIn of this.lanes) {
            if (laneIn.waypoints.length === 0) continue;
            const endWp = laneIn.waypoints[laneIn.waypoints.length - 1];

            for (const laneOut of this.lanes) {
                if (laneOut.id === laneIn.id || laneOut.roadId === laneIn.roadId) continue;
                if (laneOut.waypoints.length === 0) continue;
                const startWp = laneOut.waypoints[0];

                const dist = Math.hypot(startWp.x - endWp.x, startWp.z - endWp.z);
                if (dist < 15.0) {
                    laneIn.nextLanes.push(laneOut.id);
                    laneOut.prevLanes.push(laneIn.id);
                }
            }

            // Fallback: if a lane ends at an outer map boundary (cul-de-sac), connect to its reverse lane
            if (laneIn.nextLanes.length === 0) {
                for (const laneOut of this.lanes) {
                    if (laneOut.id !== laneIn.id && laneOut.roadId === laneIn.roadId) {
                        laneIn.nextLanes.push(laneOut.id);
                        laneOut.prevLanes.push(laneIn.id);
                    }
                }
            }
        }
    }

    isNearRoad(x, z, clearance = 5.0) {
        const threshold = this.halfRoadWidth + clearance;
        const thresholdSq = threshold * threshold;

        for (let i = 0; i < this.segments.length; i++) {
            const seg = this.segments[i];
            if (x < seg.minX - threshold || x > seg.maxX + threshold ||
                z < seg.minZ - threshold || z > seg.maxZ + threshold) {
                continue;
            }

            const ax = seg.p0.x;
            const az = seg.p0.z;
            const bx = seg.p1.x;
            const bz = seg.p1.z;

            const dx = bx - ax;
            const dz = bz - az;
            const segLenSq = dx * dx + dz * dz;
            if (segLenSq === 0) continue;

            let t = ((x - ax) * dx + (z - az) * dz) / segLenSq;
            t = Math.max(0, Math.min(1, t));

            const projX = ax + t * dx;
            const projZ = az + t * dz;

            const dSq = (x - projX) * (x - projX) + (z - projZ) * (z - projZ);
            if (dSq <= thresholdSq) return true;
        }

        return false;
    }

    getNearestWaypoint(x, z) {
        let nearest = null;
        let minDistSq = Infinity;

        for (let i = 0; i < this.waypoints.length; i++) {
            const wp = this.waypoints[i];
            const dx = wp.x - x;
            const dz = wp.z - z;
            const dSq = dx * dx + dz * dz;
            if (dSq < minDistSq) {
                minDistSq = dSq;
                nearest = wp;
            }
        }

        if (!nearest) {
            return { x: -120.1, z: 78.5, yaw: 0, laneId: '', index: 0, distance: 0 };
        }

        return {
            x: nearest.x,
            z: nearest.z,
            yaw: nearest.yaw,
            laneId: nearest.laneId,
            index: nearest.index,
            distance: Math.sqrt(minDistSq)
        };
    }

    getLookaheadWaypoint(laneId, currentIndex, lookaheadDist = 8.0) {
        let lane = this.lanesById.get(laneId);
        if (!lane || lane.waypoints.length === 0) {
            return this.getNearestWaypoint(0, 0);
        }

        let currIdx = Math.max(0, Math.min(lane.waypoints.length - 1, currentIndex));
        let accumulated = 0;
        let safety = 0;

        while (accumulated < lookaheadDist && safety++ < 40) {
            if (currIdx + 1 < lane.waypoints.length) {
                const p1 = lane.waypoints[currIdx];
                const p2 = lane.waypoints[currIdx + 1];
                const segDist = Math.hypot(p2.x - p1.x, p2.z - p1.z);

                if (accumulated + segDist >= lookaheadDist) {
                    const alpha = (lookaheadDist - accumulated) / (segDist || 1);
                    return {
                        x: p1.x + alpha * (p2.x - p1.x),
                        z: p1.z + alpha * (p2.z - p1.z),
                        yaw: p2.yaw,
                        laneId: lane.id,
                        index: currIdx + 1
                    };
                }
                accumulated += segDist;
                currIdx++;
            } else {
                if (lane.nextLanes && lane.nextLanes.length > 0) {
                    const nextLane = this.lanesById.get(lane.nextLanes[0]);
                    if (nextLane && nextLane.waypoints.length > 0) {
                        lane = nextLane;
                        currIdx = 0;
                        continue;
                    }
                }
                const lastWp = lane.waypoints[lane.waypoints.length - 1];
                return { x: lastWp.x, z: lastWp.z, yaw: lastWp.yaw, laneId: lane.id, index: currIdx };
            }
        }

        const wp = lane.waypoints[currIdx];
        return { x: wp.x, z: wp.z, yaw: wp.yaw, laneId: lane.id, index: currIdx };
    }

    getSpawnPoints(count = 50, minSpacing = 12.0) {
        const spawns = [];
        const minSpacingSq = minSpacing * minSpacing;

        const candidates = [];
        for (const lane of this.lanes) {
            const start = Math.min(2, Math.floor(lane.waypoints.length * 0.1));
            const end = Math.max(start + 1, Math.floor(lane.waypoints.length * 0.9));
            for (let i = start; i < end; i++) {
                candidates.push(lane.waypoints[i]);
            }
        }

        const stride = 5;
        for (let iter = 0; iter < candidates.length * 2 && spawns.length < count; iter++) {
            const idx = (iter * stride) % candidates.length;
            const cand = candidates[idx];

            let tooClose = false;
            for (let s = 0; s < spawns.length; s++) {
                const sp = spawns[s];
                const dSq = (cand.x - sp.x) * (cand.x - sp.x) + (cand.z - sp.z) * (cand.z - sp.z);
                if (dSq < minSpacingSq) {
                    tooClose = true;
                    break;
                }
            }

            if (!tooClose) {
                spawns.push({
                    x: cand.x,
                    z: cand.z,
                    yaw: cand.yaw,
                    laneId: cand.laneId,
                    index: cand.index
                });
            }
        }

        return spawns;
    }

    getAllLanes() {
        return this.lanes;
    }

    getLane(laneId) {
        return this.lanesById.get(laneId) || null;
    }

    init(scene, threeInstance = THREE) {
        return this;
    }
}
