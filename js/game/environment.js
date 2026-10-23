/**
 * Kaj Simulator - Environment visuals
 *
 *  - TreeSystem: real low-poly 3D trees (instanced, shadow casting) near the camera, instanced
 *    crossed-quad billboards further out, built from the tree positions AnothermapoLoader pulls
 *    out of the OSM2World export.
 *  - CloudLayer: soft procedural cumulus puffs drifting over the player, billboarded on the GPU.
 *  - createSkyMaterial / buildEnvironmentMap: atmospheric sky dome shader and a PMREM image of it
 *    that lights every MeshStandardMaterial (cars, glass, wet roads) with sky reflections.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Deterministic pseudo random so the world looks the same on every load
// ---------------------------------------------------------------------------
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------------------------------------------------------------------------
// SKY
// ---------------------------------------------------------------------------
export const SKY_COLORS = Object.freeze({
    zenith: 0x3d7fd2,
    horizon: 0xcfe3f4,
    haze: 0xe9f1f8,
    ground: 0x7c8d72,
    sun: 0xfff1cf,
    fog: 0xc6dbed
});

export function createSkyMaterial(sunDirection) {
    return new THREE.ShaderMaterial({
        name: 'AtmosphericSkyShader',
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
            uSunDir: { value: sunDirection.clone().normalize() },
            uZenithColor: { value: new THREE.Color(SKY_COLORS.zenith) },
            uHorizonColor: { value: new THREE.Color(SKY_COLORS.horizon) },
            uHazeColor: { value: new THREE.Color(SKY_COLORS.haze) },
            uGroundColor: { value: new THREE.Color(SKY_COLORS.ground) },
            uSunColor: { value: new THREE.Color(SKY_COLORS.sun) }
        },
        vertexShader: `
            varying vec3 vWorldDir;
            void main() {
                vec4 wp = modelMatrix * vec4(position, 1.0);
                vWorldDir = normalize(position);
                gl_Position = projectionMatrix * viewMatrix * wp;
            }
        `,
        fragmentShader: `
            uniform vec3 uSunDir;
            uniform vec3 uZenithColor;
            uniform vec3 uHorizonColor;
            uniform vec3 uHazeColor;
            uniform vec3 uGroundColor;
            uniform vec3 uSunColor;
            varying vec3 vWorldDir;
            void main() {
                vec3 dir = normalize(vWorldDir);
                float y = dir.y;
                vec3 sunDir = normalize(uSunDir);
                float sunDot = max(dot(dir, sunDir), 0.0);
                vec3 skyCol;
                if (y >= 0.0) {
                    // Blue overhead, pale at the horizon, with a thin bright haze band right at the horizon
                    float t = pow(clamp(y, 0.0, 1.0), 0.42);
                    skyCol = mix(uHorizonColor, uZenithColor, t);
                    float haze = exp(-y * 14.0);
                    skyCol = mix(skyCol, uHazeColor, haze * 0.75);
                } else {
                    skyCol = mix(uHazeColor, uGroundColor, clamp(-y * 6.0, 0.0, 1.0));
                }
                // Mie forward scattering: warm glow around the sun, strongest near the horizon
                float mie = pow(sunDot, 10.0) * 0.28 + pow(sunDot, 90.0) * 0.55;
                skyCol += uSunColor * mie;
                // Solar disc
                skyCol += vec3(1.0, 0.98, 0.92) * smoothstep(0.9988, 0.9997, sunDot) * 2.0;
                gl_FragColor = vec4(skyCol, 1.0);
            }
        `
    });
}

/**
 * Render the sky dome into a PMREM cube so MeshStandardMaterial surfaces reflect the sky.
 * The dome itself is 2400 units across, so the cube camera has to see that far.
 */
export function buildEnvironmentMap(renderer, skyMaterial) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 16), skyMaterial);
    envScene.add(dome);
    const target = pmrem.fromScene(envScene, 0.02, 1, 3000);
    dome.geometry.dispose();
    pmrem.dispose();
    return target.texture;
}

// ---------------------------------------------------------------------------
// TREES
// ---------------------------------------------------------------------------
const TREE_TEXTURE_DIR = '/newmap2/OSM2World-latest-bin/textures/';

function addVertexColors(geometry, colorFn) {
    const pos = geometry.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
        colorFn(c, pos.getX(i), pos.getY(i), pos.getZ(i), i);
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
}

function jitterVertices(geometry, amount, rand) {
    const pos = geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(
            i,
            pos.getX(i) * (1 + (rand() - 0.5) * amount),
            pos.getY(i) * (1 + (rand() - 0.5) * amount),
            pos.getZ(i) * (1 + (rand() - 0.5) * amount)
        );
    }
    pos.needsUpdate = true;
    return geometry;
}

const TRUNK_COLOR = new THREE.Color(0x5a4030);

/** Unit-height broad-leaved tree: short trunk and a cluster of lumpy canopy blobs. Canopy width ~0.7. */
function buildBroadleafGeometry(seed) {
    const rand = mulberry32(seed);
    const parts = [];

    const trunk = new THREE.CylinderGeometry(0.011, 0.02, 0.5, 7, 1, false);
    trunk.translate(0, 0.25, 0);
    addVertexColors(trunk, (c, x, y) => {
        c.copy(TRUNK_COLOR).multiplyScalar(0.8 + y * 0.5);
    });
    parts.push(trunk.toNonIndexed());

    const blobs = [
        { x: 0, y: 0.70, z: 0, r: 0.33, sy: 0.82 },
        { x: 0.17, y: 0.60, z: 0.12, r: 0.22, sy: 0.9 },
        { x: -0.16, y: 0.63, z: -0.10, r: 0.21, sy: 0.9 },
        { x: 0.04, y: 0.86, z: -0.12, r: 0.19, sy: 0.85 },
        { x: -0.06, y: 0.58, z: 0.19, r: 0.18, sy: 0.9 }
    ];
    const base = new THREE.Color(0x3f8a34);
    const tipTint = new THREE.Color(0x8ec84a);
    for (const b of blobs) {
        const g = new THREE.IcosahedronGeometry(b.r, 1);
        jitterVertices(g, 0.22, rand);
        g.scale(1 + (rand() - 0.5) * 0.2, b.sy, 1 + (rand() - 0.5) * 0.2);
        g.rotateY(rand() * Math.PI * 2);
        g.translate(b.x + (rand() - 0.5) * 0.04, b.y, b.z + (rand() - 0.5) * 0.04);
        addVertexColors(g, (c, x, y) => {
            // Lit from above: the top of the canopy is lighter and yellower, the underside darker
            const t = THREE.MathUtils.clamp((y - 0.4) / 0.65, 0, 1);
            c.copy(base).lerp(tipTint, t * 0.55).multiplyScalar(0.72 + t * 0.45 + (rand() - 0.5) * 0.08);
        });
        parts.push(g);
    }
    const merged = mergeGeometries(parts, false);
    merged.computeVertexNormals();
    return merged;
}

/** Unit-height conifer: trunk plus three stacked cone tiers. Canopy width ~0.6. */
function buildConiferGeometry(seed) {
    const rand = mulberry32(seed);
    const parts = [];

    const trunk = new THREE.CylinderGeometry(0.009, 0.016, 0.3, 6, 1, false);
    trunk.translate(0, 0.15, 0);
    addVertexColors(trunk, (c, x, y) => c.copy(TRUNK_COLOR).multiplyScalar(0.75 + y));
    parts.push(trunk.toNonIndexed());

    const tiers = [
        { y: 0.24, r: 0.30, h: 0.40 },
        { y: 0.46, r: 0.23, h: 0.36 },
        { y: 0.66, r: 0.16, h: 0.34 }
    ];
    const dark = new THREE.Color(0x1f4a24);
    const light = new THREE.Color(0x4c8a3a);
    for (const t of tiers) {
        // Non-indexed like the trunk and the icosahedron blobs so mergeGeometries accepts it
        const g = new THREE.ConeGeometry(t.r, t.h, 7, 1, false).toNonIndexed();
        g.translate(0, t.y + t.h * 0.5, 0);
        jitterVertices(g, 0.1, rand);
        g.rotateY(rand() * Math.PI * 2);
        addVertexColors(g, (c, x, y) => {
            const up = THREE.MathUtils.clamp((y - t.y) / t.h, 0, 1);
            c.copy(dark).lerp(light, up * 0.8).multiplyScalar(0.9 + (rand() - 0.5) * 0.1);
        });
        parts.push(g);
    }
    const merged = mergeGeometries(parts, false);
    merged.computeVertexNormals();
    return merged;
}

/** Unit-size crossed quads with their base at the origin (the far LOD) */
function buildBillboardGeometry() {
    const a = new THREE.PlaneGeometry(1, 1);
    a.translate(0, 0.5, 0);
    const b = a.clone();
    b.rotateY(Math.PI / 2);
    return mergeGeometries([a, b], false);
}

const BROADLEAF_MODEL_WIDTH = 0.72;
const CONIFER_MODEL_WIDTH = 0.6;

export class TreeSystem {
    /**
     * @param {Array<{x:number,y:number,z:number,h:number,w:number,type:number}>} trees type 0 = broad-leaved, 1 = conifer
     * @param {object} options
     *   cellSize       world units per LOD cell (default 160)
     *   lod0Distance   cells closer than this get full 3D trees (default 240)
     *   castShadows    3D trees cast shadows (default true)
     *   variants       number of distinct 3D models per species (default 2)
     */
    constructor(trees, options = {}) {
        this.cellSize = options.cellSize || 160;
        this.lod0Distance = options.lod0Distance !== undefined ? options.lod0Distance : 240;
        this.castShadows = options.castShadows !== false;
        this.variants = Math.max(1, options.variants || 2);
        this.root = new THREE.Group();
        this.root.name = 'tree_system_root';
        this.cells = [];
        this.treeCount = trees.length;

        const texLoader = new THREE.TextureLoader();
        const loadLeafTexture = (file) => {
            const tex = texLoader.load(TREE_TEXTURE_DIR + file);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = options.anisotropy || 4;
            return tex;
        };

        this.geometries = {
            broad: Array.from({ length: this.variants }, (_, i) => buildBroadleafGeometry(1000 + i * 7919)),
            conifer: Array.from({ length: this.variants }, (_, i) => buildConiferGeometry(2000 + i * 7919)),
            billboard: buildBillboardGeometry()
        };
        this.materials = {
            solid: new THREE.MeshStandardMaterial({
                vertexColors: true,
                flatShading: true,
                roughness: 0.95,
                metalness: 0,
                envMapIntensity: 0.35
            }),
            broadBillboard: new THREE.MeshLambertMaterial({
                map: loadLeafTexture('arbaro_tree_broad_leaved.png'),
                alphaTest: 0.5,
                side: THREE.DoubleSide
            }),
            coniferBillboard: new THREE.MeshLambertMaterial({
                map: loadLeafTexture('arbaro_tree_coniferous.png'),
                alphaTest: 0.5,
                side: THREE.DoubleSide
            })
        };

        this._build(trees);
    }

    _build(trees) {
        const cellSize = this.cellSize;
        const buckets = new Map();
        for (let i = 0; i < trees.length; i++) {
            const t = trees[i];
            if (!Number.isFinite(t.x) || !Number.isFinite(t.z) || !(t.h > 0.5)) continue;
            const ix = Math.floor(t.x / cellSize);
            const iz = Math.floor(t.z / cellSize);
            const key = ix + ',' + iz;
            let bucket = buckets.get(key);
            if (!bucket) {
                bucket = { ix, iz, trees: [] };
                buckets.set(key, bucket);
            }
            bucket.trees.push(t);
        }

        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        const up = new THREE.Vector3(0, 1, 0);
        const color = new THREE.Color();

        for (const bucket of buckets.values()) {
            const rand = mulberry32((bucket.ix * 73856093) ^ (bucket.iz * 19349663) ^ 0x5bd1e995);
            const minX = bucket.ix * cellSize, minZ = bucket.iz * cellSize;
            const cell = {
                minX, minZ, maxX: minX + cellSize, maxZ: minZ + cellSize,
                lod0: [], lod1: [], mode: -1
            };

            // Per tree: yaw, size jitter and tint are decided once so both LODs match
            const decorated = bucket.trees.map((t) => {
                const hueShift = (rand() - 0.5) * 0.08;
                const bright = 0.85 + rand() * 0.3;
                color.setHSL(0.28 + hueShift, 0.55, 0.5).multiplyScalar(bright);
                return {
                    t,
                    yaw: rand() * Math.PI * 2,
                    stretch: 0.92 + rand() * 0.16,
                    variant: Math.floor(rand() * this.variants),
                    // Near-white multiplier so the vertex colours keep their own shading
                    tint: [0.75 + color.r * 0.5, 0.75 + color.g * 0.5, 0.75 + color.b * 0.5]
                };
            });

            const finishMesh = (mesh) => {
                mesh.instanceMatrix.needsUpdate = true;
                if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
                mesh.computeBoundingSphere();
                mesh.visible = false;
                mesh.matrixAutoUpdate = false;
                this.root.add(mesh);
            };

            for (let type = 0; type <= 1; type++) {
                const isConifer = type === 1;
                const species = decorated.filter((d) => d.t.type === type);
                if (species.length === 0) continue;
                const modelWidth = isConifer ? CONIFER_MODEL_WIDTH : BROADLEAF_MODEL_WIDTH;

                // Far LOD: one crossed-quad billboard mesh per species per cell
                const billboard = new THREE.InstancedMesh(
                    this.geometries.billboard,
                    isConifer ? this.materials.coniferBillboard : this.materials.broadBillboard,
                    species.length
                );
                billboard.castShadow = false;
                billboard.receiveShadow = false;
                billboard.name = 'trees_lod1';
                for (let i = 0; i < species.length; i++) {
                    const d = species[i];
                    const w = Math.max(d.t.w, d.t.h * 0.4);
                    position.set(d.t.x, d.t.y, d.t.z);
                    quaternion.setFromAxisAngle(up, d.yaw);
                    scale.set(w, d.t.h, w);
                    matrix.compose(position, quaternion, scale);
                    billboard.setMatrixAt(i, matrix);
                    billboard.setColorAt(i, color.setRGB(d.tint[0], d.tint[1], d.tint[2]));
                }
                finishMesh(billboard);
                cell.lod1.push(billboard);

                // Near LOD: one solid instanced mesh per model variant
                for (let variant = 0; variant < this.variants; variant++) {
                    const group = species.filter((d) => d.variant === variant);
                    if (group.length === 0) continue;
                    const solidGeo = isConifer ? this.geometries.conifer[variant] : this.geometries.broad[variant];
                    const solid = new THREE.InstancedMesh(solidGeo, this.materials.solid, group.length);
                    solid.castShadow = this.castShadows;
                    solid.receiveShadow = true;
                    solid.name = 'trees_lod0';
                    for (let i = 0; i < group.length; i++) {
                        const d = group[i];
                        const widthScale = THREE.MathUtils.clamp(d.t.w, d.t.h * 0.35, d.t.h * 0.75) / modelWidth;
                        position.set(d.t.x, d.t.y, d.t.z);
                        quaternion.setFromAxisAngle(up, d.yaw);
                        scale.set(widthScale * d.stretch, d.t.h, widthScale / d.stretch);
                        matrix.compose(position, quaternion, scale);
                        solid.setMatrixAt(i, matrix);
                        solid.setColorAt(i, color.setRGB(d.tint[0], d.tint[1], d.tint[2]));
                    }
                    finishMesh(solid);
                    cell.lod0.push(solid);
                }
            }
            this.cells.push(cell);
        }
    }

    /**
     * Pick a LOD per cell from the camera's distance to the cell's footprint.
     * @param {THREE.Vector3} cameraPosition
     * @param {number} viewDistance beyond this (fog far) trees are hidden entirely
     */
    update(cameraPosition, viewDistance) {
        const cx = cameraPosition.x, cz = cameraPosition.z;
        const lod0 = this.lod0Distance;
        for (let i = 0, len = this.cells.length; i < len; i++) {
            const cell = this.cells[i];
            const dx = Math.max(cell.minX - cx, 0, cx - cell.maxX);
            const dz = Math.max(cell.minZ - cz, 0, cz - cell.maxZ);
            const d = Math.sqrt(dx * dx + dz * dz);
            const mode = d < lod0 ? 0 : (d < viewDistance ? 1 : 2);
            if (mode === cell.mode) continue;
            cell.mode = mode;
            for (let k = 0; k < cell.lod0.length; k++) cell.lod0[k].visible = mode === 0;
            for (let k = 0; k < cell.lod1.length; k++) cell.lod1[k].visible = mode === 1;
        }
    }

    setEnvironmentMap(texture) {
        this.materials.solid.envMap = texture;
        this.materials.solid.needsUpdate = true;
    }

    dispose() {
        for (const list of Object.values(this.geometries)) {
            if (Array.isArray(list)) list.forEach((g) => g.dispose());
            else list.dispose();
        }
        for (const m of Object.values(this.materials)) {
            if (m.map) m.map.dispose();
            m.dispose();
        }
        this.root.clear();
        this.cells.length = 0;
    }
}

// ---------------------------------------------------------------------------
// CLOUDS
// ---------------------------------------------------------------------------

/** Paint one soft, lumpy cumulus puff into a canvas texture */
function createPuffTexture(size = 256, seed = 7) {
    const rand = mulberry32(seed);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'lighter';
    const centre = size / 2;
    const lumps = 18;
    for (let i = 0; i < lumps; i++) {
        const ang = rand() * Math.PI * 2;
        const dist = Math.pow(rand(), 0.7) * size * 0.22;
        const x = centre + Math.cos(ang) * dist;
        const y = centre + Math.sin(ang) * dist * 0.75 + size * 0.03;
        const r = size * (0.12 + rand() * 0.16);
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, 'rgba(255,255,255,0.55)');
        grad.addColorStop(0.45, 'rgba(255,255,255,0.28)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Fade everything out towards the edge of the sprite so the quad never shows
    ctx.globalCompositeOperation = 'destination-in';
    const edge = ctx.createRadialGradient(centre, centre, size * 0.18, centre, centre, size * 0.5);
    edge.addColorStop(0, 'rgba(255,255,255,1)');
    edge.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    return tex;
}

export class CloudLayer {
    /**
     * @param {object} options
     *   clumps        number of clouds (default 34)
     *   puffsPerClump average puffs per cloud (default 7)
     *   radius        clouds live within this XZ radius of the player (default 1700)
     *   minAltitude / maxAltitude cloud base heights (default 230 / 360)
     *   windSpeed     drift speed in units/s (default 4)
     *   sunDirection  for the lit-side shading
     */
    constructor(options = {}) {
        this.radius = options.radius || 1700;
        this.windSpeed = options.windSpeed !== undefined ? options.windSpeed : 4;
        const clumpCount = options.clumps || 34;
        const puffsPerClump = options.puffsPerClump || 7;
        const minAlt = options.minAltitude || 230;
        const maxAlt = options.maxAltitude || 360;
        const sunDir = (options.sunDirection || new THREE.Vector3(0.4, 0.8, 0.3)).clone().normalize();
        const rand = mulberry32(options.seed || 99);

        this.clumps = [];
        this.puffs = [];
        for (let c = 0; c < clumpCount; c++) {
            const ang = rand() * Math.PI * 2;
            const dist = Math.sqrt(rand()) * this.radius;
            const clump = {
                x: Math.cos(ang) * dist,
                z: Math.sin(ang) * dist,
                y: minAlt + rand() * (maxAlt - minAlt),
                puffs: []
            };
            const n = Math.max(3, Math.round(puffsPerClump * (0.6 + rand() * 0.8)));
            const spread = 70 + rand() * 110;
            for (let p = 0; p < n; p++) {
                const px = (rand() - 0.5) * spread;
                const pz = (rand() - 0.5) * spread * 0.55;
                const centreness = 1 - Math.min(1, Math.hypot(px, pz) / (spread * 0.5));
                const puff = {
                    clump,
                    ox: px,
                    oy: (rand() - 0.2) * 22 + centreness * 26,
                    oz: pz,
                    size: 55 + rand() * 60 + centreness * 50,
                    alpha: 0.55 + rand() * 0.35,
                    shade: 0.82 + centreness * 0.18
                };
                clump.puffs.push(puff);
                this.puffs.push(puff);
            }
            this.clumps.push(clump);
        }

        const geometry = new THREE.PlaneGeometry(1, 1);
        this.material = new THREE.ShaderMaterial({
            name: 'CloudPuffShader',
            transparent: true,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide,
            uniforms: {
                uMap: { value: createPuffTexture(256, 7) },
                uSunDir: { value: sunDir },
                uFadeNear: { value: this.radius * 0.55 },
                uFadeFar: { value: this.radius * 0.98 },
                uLitColor: { value: new THREE.Color(0xffffff) },
                uShadeColor: { value: new THREE.Color(0xb7c6d8) }
            },
            vertexShader: `
                varying vec2 vUv;
                varying float vAlpha;
                varying float vShade;
                varying float vFade;
                varying vec3 vToSun;
                uniform float uFadeNear;
                uniform float uFadeFar;
                uniform vec3 uSunDir;
                void main() {
                    vUv = uv;
                    vec4 centre = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                    float sx = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
                    float sy = length(vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2]));
                    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
                    vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
                    vec3 worldPos = centre.xyz + camRight * (position.x * sx) + camUp * (position.y * sy);
                    #ifdef USE_INSTANCING_COLOR
                        vAlpha = instanceColor.r;
                        vShade = instanceColor.g;
                    #else
                        vAlpha = 0.8;
                        vShade = 1.0;
                    #endif
                    vec4 mvPosition = viewMatrix * vec4(worldPos, 1.0);
                    float dist = length(worldPos.xz - cameraPosition.xz);
                    vFade = 1.0 - smoothstep(uFadeNear, uFadeFar, dist);
                    // Which side of the sprite faces the sun (screen space), for a lit edge
                    vec3 sunView = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
                    vToSun = sunView;
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform sampler2D uMap;
                uniform vec3 uLitColor;
                uniform vec3 uShadeColor;
                varying vec2 vUv;
                varying float vAlpha;
                varying float vShade;
                varying float vFade;
                varying vec3 vToSun;
                void main() {
                    vec4 tex = texture2D(uMap, vUv);
                    float a = tex.a * vAlpha * vFade;
                    if (a < 0.003) discard;
                    // Bright on top and on the sun-facing side, bluish grey underneath
                    vec2 fromCentre = vUv - 0.5;
                    float lit = clamp(0.55 + fromCentre.y * 1.3 + dot(fromCentre, vToSun.xy) * 0.9, 0.0, 1.0);
                    vec3 col = mix(uShadeColor, uLitColor, lit) * vShade;
                    gl_FragColor = vec4(col, a);
                }
            `
        });

        this.mesh = new THREE.InstancedMesh(geometry, this.material, this.puffs.length);
        this.mesh.name = 'cloud_layer';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = -5;
        this.mesh.matrixAutoUpdate = false;
        const color = new THREE.Color();
        for (let i = 0; i < this.puffs.length; i++) {
            color.setRGB(this.puffs[i].alpha, this.puffs[i].shade, 0);
            this.mesh.setColorAt(i, color);
        }
        this.mesh.instanceColor.needsUpdate = true;

        this._matrix = new THREE.Matrix4();
        this._sortTimer = 0;
        this._order = this.puffs.map((_, i) => i);
        this._dist = new Float32Array(this.puffs.length);
        this._centre = new THREE.Vector3();
        this._writeMatrices(new THREE.Vector3());
    }

    _writeMatrices(camPos) {
        const m = this._matrix;
        const puffs = this.puffs;
        // Back-to-front so overlapping translucent puffs blend correctly
        const dist = this._dist;
        for (let i = 0; i < puffs.length; i++) {
            const p = puffs[i];
            const x = p.clump.x + p.ox - camPos.x;
            const y = p.clump.y + p.oy - camPos.y;
            const z = p.clump.z + p.oz - camPos.z;
            dist[i] = x * x + y * y + z * z;
        }
        this._order.sort((a, b) => dist[b] - dist[a]);
        for (let k = 0; k < this._order.length; k++) {
            const p = puffs[this._order[k]];
            m.makeScale(p.size * 1.6, p.size, 1);
            m.setPosition(p.clump.x + p.ox, p.clump.y + p.oy, p.clump.z + p.oz);
            this.mesh.setMatrixAt(k, m);
            // Keep per-instance colour aligned with the sorted order
        }
        const color = new THREE.Color();
        for (let k = 0; k < this._order.length; k++) {
            const p = puffs[this._order[k]];
            color.setRGB(p.alpha, p.shade, 0);
            this.mesh.setColorAt(k, color);
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        this.mesh.instanceColor.needsUpdate = true;
    }

    /**
     * @param {number} dt seconds since last frame
     * @param {THREE.Vector3} centre player / camera position the cloud field is kept around
     */
    update(dt, centre) {
        const r = this.radius;
        const drift = this.windSpeed * dt;
        for (let i = 0; i < this.clumps.length; i++) {
            const c = this.clumps[i];
            c.x += drift * 0.86;
            c.z += drift * 0.5;
            // Wrap clouds that fall too far behind the player to the far side of the field
            if (c.x - centre.x > r) c.x -= r * 2;
            else if (c.x - centre.x < -r) c.x += r * 2;
            if (c.z - centre.z > r) c.z -= r * 2;
            else if (c.z - centre.z < -r) c.z += r * 2;
        }
        this._sortTimer -= dt;
        if (this._sortTimer <= 0) {
            this._sortTimer = 0.25;
            this._writeMatrices(centre);
        }
    }

    dispose() {
        this.mesh.geometry.dispose();
        this.material.uniforms.uMap.value.dispose();
        this.material.dispose();
    }
}
