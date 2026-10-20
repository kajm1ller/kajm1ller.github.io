/**
 * js/game/mapLoader.js
 * 
 * High-Performance /anothermapo 3D Map Loader & Aligned OSM Road Network for Kaj Simulator.
 * 
 * Key Capabilities:
 * 1. Fast Asynchronous Loading:
 *    - Loads /anothermapo/materials.mtl and part0000.obj .. part0029.obj.
 *    - Concurrency-controlled chunked pipeline (4 concurrent workers).
 * 2. Spatial Hash Grid Collision Optimization:
 *    - Parses building, wall, fence, and obstacle geometry during loading.
 *    - Computes static AABB bounds and registers them into SpatialGrid.insertStatic()
 *      for O(1) broadphase collision queries with zero heap allocation during gameplay.
 * 3. 60 FPS Performance Pipeline:
 *    - Automatic frustum culling (child.frustumCulled = true).
 *    - Static matrix freeze (child.matrixAutoUpdate = false; child.updateMatrix()).
 */

import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

export const ANOTHERMAPO_CONFIG = Object.freeze({
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
        MAP_DIR: '/anothermapo/',
        MTL_FILE: 'materials.mtl',
        PART_PREFIX: 'part',
        PART_EXT: '.obj'
    }),

    LOADING: Object.freeze({
        DEFAULT_PART_START: 0,
        DEFAULT_PART_END: 8,
        CORE_PARTS: Object.freeze([
            90, 91,
            0, 1, 2, 3, 4, 5, 6, 7, 8,
            15, 16, 17, 18,
            43, 45, 56, 66, 80,
            84, 85, 86, 87, 88
        ]),
        MAX_PART_COUNT: 92,
        CONCURRENT_CHUNKS: 6,
        TIMEOUT_MS: 30000
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

export class AnothermapoLoader {
    constructor(options = {}) {
        this.basePath = options.basePath || ANOTHERMAPO_CONFIG.PATHS.MAP_DIR;
        this.startPart = options.startPart !== undefined ? options.startPart : ANOTHERMAPO_CONFIG.LOADING.DEFAULT_PART_START;
        this.endPart = options.endPart !== undefined ? options.endPart : ANOTHERMAPO_CONFIG.LOADING.DEFAULT_PART_END;
        this.batchSize = options.batchSize || ANOTHERMAPO_CONFIG.LOADING.CONCURRENT_CHUNKS;
        this.enableFrustumCulling = options.enableFrustumCulling !== false;
        this.freezeTransforms = options.freezeTransforms !== false;
        this.registerColliders = options.registerColliders !== false;
        this.roadNetwork = options.roadNetwork || null;
        this.collisionMeshes = options.collisionMeshes || null;

        this.materials = null;
        this.sharedMaterialCache = new Map();
        this.mapRoot = new THREE.Group();
        this.mapRoot.name = 'anothermapo_world_root';
        this.mapRoot.userData.isMap = true;

        this.parts = [];
        this.isLoaded = false;
        this.loadedCount = 0;
        this.totalParts = this.endPart - this.startPart + 1;
        this.obstacleCount = 0;
        this.totalTriangles = 0;
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
                        // Share a single Texture instance per texture URL across all materials to avoid 400+ duplicate HTTP requests
                        const texCache = new Map();
                        const texLoader = new THREE.TextureLoader(materials.manager);
                        materials.loadTexture = function (url, mapping, onLoad, onProgress, onError) {
                            if (texCache.has(url)) {
                                return texCache.get(url);
                            }
                            const texture = texLoader.load(url, onLoad, onProgress, onError);
                            if (mapping !== undefined) texture.mapping = mapping;
                            texture.wrapS = THREE.RepeatWrapping;
                            texture.wrapT = THREE.RepeatWrapping;
                            texCache.set(url, texture);
                            return texture;
                        };
                        resolve(materials);
                    },
                    undefined,
                    () => resolve(null)
                );
            });
        } catch (e) {
            this.materials = null;
        }

        report(15, `Loaded materials. Loading ${this.totalParts} map parts...`);

        const fallbackMaterial = new THREE.MeshLambertMaterial({
            color: 0x888888,
            side: THREE.DoubleSide
        });

        // Build part list prioritizing terrain (part0090, part0091), roads (0..8), and Kaj's neighborhood (84..88, 15..41)
        const partSet = new Set();
        for (const pIdx of ANOTHERMAPO_CONFIG.LOADING.CORE_PARTS) {
            partSet.add(`part${String(pIdx).padStart(4, '0')}.obj`);
        }
        for (let i = this.startPart; i <= this.endPart; i++) {
            partSet.add(`part${String(i).padStart(4, '0')}.obj`);
        }
        const partNames = Array.from(partSet);
        this.totalParts = partNames.length;

        let currentIndex = 0;
        const loadPartWorker = async () => {
            // Give each worker its own OBJLoader instance to avoid state race conditions
            const objLoader = new OBJLoader();
            objLoader.setPath(this.basePath);
            if (this.materials) {
                objLoader.setMaterials(this.materials);
            }

            while (currentIndex < partNames.length) {
                const idx = currentIndex++;
                const partName = partNames[idx];

                try {
                    const obj = await this._loadObjFile(objLoader, partName, spatialGrid);
                    if (obj) {
                        obj.name = partName;
                        obj.userData.isMapPart = true;
                        obj.userData.partName = partName;
                        this._processPartMeshes(obj, fallbackMaterial, spatialGrid, partName);
                        this.mapRoot.add(obj);
                        this.parts.push(obj);
                    }
                } catch (err) {
                    console.warn(`[AnothermapoLoader] Warning: part ${partName} skipped:`, err);
                } finally {
                    this.loadedCount++;
                    const pct = 15 + ((this.loadedCount / this.totalParts) * 80);
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

        // Add a sub-terrain base catcher at y = -0.08 inside mapRoot so any OSM2World triangulation seam or unloaded cutout never shows the void
        const subTerrainMat = this.sharedMaterialCache.get('TERRAIN_DEFAULT_0__TERRAIN') ||
            new THREE.MeshLambertMaterial({
                name: 'SUBTERRAIN_BASE',
                color: 0x4f6d32,
                side: THREE.DoubleSide,
                polygonOffset: true,
                polygonOffsetFactor: 6,
                polygonOffsetUnits: 6
            });
        const subTerrainGeo = new THREE.PlaneGeometry(3200, 3200);
        subTerrainGeo.rotateX(-Math.PI / 2);
        const subTerrainMesh = new THREE.Mesh(subTerrainGeo, subTerrainMat);
        subTerrainMesh.name = 'anothermapo_subterrain_base';
        subTerrainMesh.position.y = -0.08;
        subTerrainMesh.frustumCulled = false;
        subTerrainMesh.matrixAutoUpdate = false;
        subTerrainMesh.updateMatrix();
        subTerrainMesh.userData.isMapPart = true;
        subTerrainMesh.userData.isSubTerrain = true;
        this.mapRoot.add(subTerrainMesh);

        if (scene) {
            scene.add(this.mapRoot);
        }
        this.isLoaded = true;

        report(100, `Map ready! ${this.loadedCount} parts loaded (${this.obstacleCount} colliders registered).`);

        return {
            isLoaded: true,
            mapRoot: this.mapRoot,
            parts: this.parts,
            loadedPartsCount: this.parts.length,
            loadedCount: this.loadedCount,
            obstacleCount: this.obstacleCount,
            totalTriangles: this.totalTriangles
        };
    }

    async _loadObjFile(objLoader, partName, spatialGrid = null) {
        const extractColliders = (
            partName === 'part0084.obj' ||
            partName === 'part0086.obj' ||
            partName === 'part0015.obj'
        );

        if (typeof fetch === 'function') {
            try {
                const resp = await fetch(this.basePath + partName);
                if (!resp.ok) return null;
                const rawText = await resp.text();
                if (extractColliders && this.registerColliders && spatialGrid) {
                    this._extractCollidersFromRawObj(rawText, spatialGrid, partName);
                }
                const textToParse = rawText.replace(/^[og]\s+.*$/gm, '');
                const parsed = objLoader.parse(textToParse);
                parsed.userData.isMergedPart = true;
                return parsed;
            } catch (e) {
                // Fall back to standard objLoader.load
            }
        }
        return new Promise((resolve) => {
            objLoader.load(
                partName,
                (object) => resolve(object),
                undefined,
                () => resolve(null)
            );
        });
    }

    _extractCollidersFromRawObj(rawText, spatialGrid, partName) {
        const ignoredMaterials = ANOTHERMAPO_CONFIG.COLLISION.IGNORED_MATERIALS;
        const minHeight = ANOTHERMAPO_CONFIG.COLLISION.MIN_OBSTACLE_HEIGHT;
        const minPlanar = ANOTHERMAPO_CONFIG.COLLISION.MIN_PLANAR_SIZE;

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        let vCount = 0;
        let matName = '';

        const flushBlock = () => {
            if (vCount >= 3) {
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
                        if (matName.includes(ignoredMaterials[i])) {
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
            vCount = 0;
            matName = '';
        };

        const lines = rawText.split('\n');
        for (let i = 0, len = lines.length; i < len; i++) {
            const line = lines[i];
            const c0 = line.charCodeAt(0);
            const c1 = line.charCodeAt(1);
            // 'o ' (111, 32) or 'g ' (103, 32)
            if ((c0 === 111 || c0 === 103) && c1 === 32) {
                flushBlock();
            } else if (c0 === 118 && c1 === 32) {
                // 'v ' (118, 32)
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 4) {
                    const vx = parseFloat(parts[1]);
                    const vy = parseFloat(parts[2]);
                    const vz = parseFloat(parts[3]);
                    if (vx < minX) minX = vx;
                    if (vx > maxX) maxX = vx;
                    if (vy < minY) minY = vy;
                    if (vy > maxY) maxY = vy;
                    if (vz < minZ) minZ = vz;
                    if (vz > maxZ) maxZ = vz;
                    vCount++;
                }
            } else if (c0 === 117 && !matName && line.startsWith('usemtl ')) {
                matName = line.slice(7).trim().toUpperCase();
            }
        }
        flushBlock();
    }

    _coalesceMeshMaterialsAndGroups(mesh) {
        const geom = mesh.geometry;
        if (!geom || !geom.groups || geom.groups.length <= 1 || geom.index) return;
        const materials = mesh.material;
        if (!Array.isArray(materials)) return;

        const groups = geom.groups;
        const buckets = new Map();
        for (let g = 0; g < groups.length; g++) {
            const grp = groups[g];
            if (grp.count <= 0) continue;
            const mat = materials[grp.materialIndex] || materials[0];
            const key = (mat && mat.name) ? mat.name : ('mat_' + grp.materialIndex);
            let bucket = buckets.get(key);
            if (!bucket) {
                bucket = { mat, ranges: [] };
                buckets.set(key, bucket);
            }
            bucket.ranges.push(grp);
        }

        if (buckets.size >= groups.length) return;

        const attrNames = Object.keys(geom.attributes);
        const newArrays = {};
        for (let a = 0; a < attrNames.length; a++) {
            const name = attrNames[a];
            const attr = geom.attributes[name];
            newArrays[name] = new attr.array.constructor(attr.array.length);
        }

        const newGroups = [];
        const newMaterials = [];
        let writeVert = 0;

        for (const bucket of buckets.values()) {
            const startVert = writeVert;
            const ranges = bucket.ranges;
            for (let r = 0; r < ranges.length; r++) {
                const grp = ranges[r];
                const srcStart = grp.start;
                const count = grp.count;
                for (let a = 0; a < attrNames.length; a++) {
                    const name = attrNames[a];
                    const attr = geom.attributes[name];
                    const itemSize = attr.itemSize;
                    const srcArr = attr.array;
                    const dstArr = newArrays[name];
                    const sIdx = srcStart * itemSize;
                    const eIdx = Math.min(srcArr.length, (srcStart + count) * itemSize);
                    const dIdx = writeVert * itemSize;
                    if (eIdx > sIdx && dIdx + (eIdx - sIdx) <= dstArr.length) {
                        dstArr.set(srcArr.subarray(sIdx, eIdx), dIdx);
                    }
                }
                writeVert += count;
            }
            const totalCount = writeVert - startVert;
            if (totalCount > 0) {
                newGroups.push({
                    start: startVert,
                    count: totalCount,
                    materialIndex: newMaterials.length
                });
                newMaterials.push(bucket.mat);
            }
        }

        for (let a = 0; a < attrNames.length; a++) {
            const name = attrNames[a];
            const attr = geom.attributes[name];
            attr.array = newArrays[name];
            attr.needsUpdate = true;
        }

        geom.groups = newGroups;
        mesh.material = newMaterials.length === 1 ? newMaterials[0] : newMaterials;
    }

    _registerWorldBoundsCollider(minX, minY, minZ, maxX, maxY, maxZ, height, spatialGrid, partName, meshRef = null) {
        if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
            return;
        }

        const cx = (minX + maxX) * 0.5;
        const cz = (minZ + maxZ) * 0.5;

        // Only register colliders inside the active [-295, 295] spatial grid world
        if (cx < -295 || cx > 295 || cz < -295 || cz > 295) return;

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

    _processPartMeshes(object, fallbackMaterial, spatialGrid, partName) {
        const ignoredMaterials = ANOTHERMAPO_CONFIG.COLLISION.IGNORED_MATERIALS;
        const isTerrainPart = partName === 'part0090.obj' || partName === 'part0091.obj';
        const isMergedPart = !!(object.userData && object.userData.isMergedPart);

        object.traverse((child) => {
            if (!child.isMesh) return;

            if (child.geometry && child.geometry.attributes && child.geometry.attributes.position) {
                const count = child.geometry.attributes.position.count;
                this.totalTriangles += child.geometry.index ? child.geometry.index.count / 3 : count / 3;
            }

            if (!child.material) {
                child.material = fallbackMaterial;
            }

            const materials = Array.isArray(child.material) ? child.material : [child.material];
            const primaryMatName = ((materials[0] && materials[0].name) || child.name || '').toUpperCase();

            // Keep OSM2World terrain, grass, sidewalks (CONCRETE_0), and roads (ASPHALT_0) flush at y = 0.000
            // so edge-matched sidewalk cutouts never separate vertically; only lift road markings slightly above asphalt
            if (!isTerrainPart && child.geometry && child.geometry.groups && child.geometry.groups.length > 0 && child.geometry.attributes.position) {
                const posArr = child.geometry.attributes.position.array;
                const groups = child.geometry.groups;
                for (let g = 0; g < groups.length; g++) {
                    const grp = groups[g];
                    const mat = materials[grp.materialIndex];
                    if (!mat || !mat.name) continue;
                    const gName = mat.name.toUpperCase();
                    if (
                        !gName.endsWith('_0') &&
                        (gName.includes('ROAD_MARKING') || gName.endsWith('_1'))
                    ) {
                        const endVert = Math.min(posArr.length / 3, grp.start + grp.count);
                        for (let v = grp.start; v < endVert; v++) {
                            posArr[v * 3 + 1] += 0.012;
                        }
                    }
                }
            }

            // Coalesce thousands of alternating usemtl geometry groups into 1 contiguous group per material
            this._coalesceMeshMaterialsAndGroups(child);

            const coalescedMats = Array.isArray(child.material) ? child.material : [child.material];
            for (let i = 0; i < coalescedMats.length; i++) {
                const m = coalescedMats[i];
                if (!m) continue;
                const mName = (m.name || primaryMatName).toUpperCase();
                const cacheKey = isTerrainPart ? `${mName}__TERRAIN` : mName;

                if (mName && this.sharedMaterialCache.has(cacheKey)) {
                    coalescedMats[i] = this.sharedMaterialCache.get(cacheKey);
                    continue;
                }

                // Convert expensive MeshPhongMaterial to fast MeshLambertMaterial while preserving texture/color/alpha
                const lambert = (m.isMeshLambertMaterial || !m.isMaterial)
                    ? m
                    : new THREE.MeshLambertMaterial({
                        name: m.name || '',
                        color: m.color ? m.color.clone() : new THREE.Color(0xcccccc),
                        map: m.map || null,
                        alphaMap: m.alphaMap || null,
                        transparent: !!m.transparent,
                        opacity: m.opacity !== undefined ? m.opacity : 1.0
                    });

                if (lambert.map) {
                    lambert.map.wrapS = THREE.RepeatWrapping;
                    lambert.map.wrapT = THREE.RepeatWrapping;
                }

                if (isTerrainPart || mName.includes('TERRAIN')) {
                    lambert.side = THREE.DoubleSide;
                    lambert.polygonOffset = true;
                    lambert.polygonOffsetFactor = 2;
                    lambert.polygonOffsetUnits = 2;
                } else if (
                    mName.includes('GRASS') ||
                    mName.includes('EARTH') ||
                    mName.includes('GROUND') ||
                    mName.includes('SCRUB') ||
                    mName.includes('WATER')
                ) {
                    lambert.side = THREE.DoubleSide;
                    lambert.polygonOffset = true;
                    lambert.polygonOffsetFactor = 1;
                    lambert.polygonOffsetUnits = 1;
                } else if (
                    mName.includes('CONCRETE') ||
                    mName.includes('PAVING_STONE')
                ) {
                    lambert.side = THREE.DoubleSide;
                    lambert.polygonOffset = true;
                    lambert.polygonOffsetFactor = -1;
                    lambert.polygonOffsetUnits = -1;
                } else if (
                    mName.includes('ASPHALT') ||
                    mName.includes('GRAVEL') ||
                    mName.endsWith('_0')
                ) {
                    lambert.side = THREE.DoubleSide;
                } else if (
                    !mName.endsWith('_0') &&
                    (mName.includes('ROAD_MARKING') || mName.endsWith('_1'))
                ) {
                    lambert.side = THREE.DoubleSide;
                    lambert.transparent = true;
                    lambert.alphaTest = 0.1;
                    lambert.depthWrite = false;
                    lambert.polygonOffset = true;
                    lambert.polygonOffsetFactor = -2;
                    lambert.polygonOffsetUnits = -2;
                } else if (
                    mName.includes('TREE_BILLBOARD') ||
                    mName.includes('FENCE') ||
                    mName.includes('HEDGE')
                ) {
                    lambert.side = THREE.DoubleSide;
                    lambert.alphaTest = 0.5;
                    lambert.transparent = true;
                } else {
                    lambert.side = THREE.FrontSide;
                }

                coalescedMats[i] = lambert;
                if (mName) {
                    this.sharedMaterialCache.set(cacheKey, lambert);
                }
            }

            child.material = coalescedMats.length === 1 ? coalescedMats[0] : coalescedMats;

            if (child.geometry) {
                child.geometry.computeBoundingSphere();
            }

            // Disable frustum culling on merged map meshes so large multi-hundred-meter ground/road slabs never pop out at view edges
            child.frustumCulled = false;
            child.receiveShadow = true;
            // Enable shadow casting on building/structure chunks (part0015..part0088) while keeping ground/road parts receive-only
            if (!isTerrainPart && !partName.startsWith('part000')) {
                child.castShadow = true;
            }

            if (this.freezeTransforms) {
                child.matrixAutoUpdate = false;
                child.updateMatrix();
            }

            if (!isMergedPart && this.registerColliders && spatialGrid) {
                this._extractAndRegisterCollider(child, spatialGrid, ignoredMaterials, partName);
            }
        });
    }

    _extractAndRegisterCollider(child, spatialGrid, ignoredMaterials, partName) {
        if (!child.geometry) return;
        if (!child.geometry.boundingBox) {
            child.geometry.computeBoundingBox();
        }

        const bbox = child.geometry.boundingBox;
        if (!bbox) return;

        const height = bbox.max.y - bbox.min.y;
        const width = bbox.max.x - bbox.min.x;
        const depth = bbox.max.z - bbox.min.z;

        if (height < ANOTHERMAPO_CONFIG.COLLISION.MIN_OBSTACLE_HEIGHT) return;
        if (width < ANOTHERMAPO_CONFIG.COLLISION.MIN_PLANAR_SIZE && depth < ANOTHERMAPO_CONFIG.COLLISION.MIN_PLANAR_SIZE) return;
        if (width > 60.0 || depth > 60.0) return;

        let matName = '';
        if (child.material) {
            matName = (Array.isArray(child.material) ? child.material[0]?.name : child.material.name) || '';
        }
        for (const ign of ignoredMaterials) {
            if (matName.toUpperCase().includes(ign)) return;
        }

        child.updateMatrixWorld(true);
        const worldBox = bbox.clone().applyMatrix4(child.matrixWorld);
        this._registerWorldBoundsCollider(
            worldBox.min.x, worldBox.min.y, worldBox.min.z,
            worldBox.max.x, worldBox.max.y, worldBox.max.z,
            height, spatialGrid, partName, child
        );
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
