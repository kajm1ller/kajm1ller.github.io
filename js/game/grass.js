/**
 * Kaj Simulator - 3D grass
 *
 * Grass clumps are drawn with three GPU-instanced meshes that follow the camera:
 *   - a dense near field (small spacing, fades out at nearFadeOut)
 *   - a sparser mid field (larger, wider clumps, fades in where the near field fades out)
 *   - a sparse distant field of wide clumps that carries the grass out to ~145 m
 * Every clump's position, rotation, height and tint come from a hash of its world grid cell, so the
 * field never "swims" as the camera moves. The vertex shader also sways blades in the wind and
 * pushes them away from the player.
 *
 * Where grass may grow is decided by a small mask texture centred on the camera. It is rebuilt on the
 * CPU from the already-loaded map tile geometry whenever the camera has moved far enough:
 *   - hard ground surfaces (roads, pavements, gravel, water, dirt, courts) clear grass
 *   - any upward-facing surface above the ground (roofs, canopies, bridges) clears the ground below it
 * Everything else, i.e. the terrain, lawns, parks and fields, gets grass.
 */
import * as THREE from 'three';

const DEFAULTS = Object.freeze({
    // Near field
    // (Grass in the near field is gone beyond nearFadeOut, so its half size only needs to reach that
    // far, plus a margin: when you're driving fast the field must not run out ahead of the fade.)
    // The bands overlap over long crossfades so clumps blend from one field to the next instead of
    // visibly swapping (the popping you saw at speed when the crossfades were only ~4 m wide).
    nearSpacing: 0.24,
    nearHalfSize: 20,
    nearFadeOut: [11, 18],
    // Mid field
    farSpacing: 0.6,
    farHalfSize: 60,
    farFadeIn: [10, 17],
    farFadeOut: [42, 54],
    // Distant field: sparse, wide clumps that carry the grass out to ~145 m
    distantSpacing: 1.3,
    distantHalfSize: 154,
    distantFadeIn: [41, 53],
    distantFadeOut: [118, 146],
    // Mask window around the camera
    maskResolution: 0.5,      // metres per mask texel
    maskSize: 400,            // window width in metres (must exceed 2 * distantHalfSize + 2 * refreshDistance)
    refreshDistance: 28,      // rebuild the mask once the camera moves this far from the window centre
    maxCameraHeight: 70,      // above this the grass is hidden entirely
    bladeHeight: 0.4
});


/**
 * One clump: three tapered blades fanned around the centre, each blade 7 vertices / 5 triangles.
 * position.y runs 0..1 and is scaled by the per-clump height in the shader.
 */
function buildClumpGeometry() {
    const positions = [];
    const colors = [];
    const indices = [];
    const base = new THREE.Color(0x2c4a1c);
    const mid = new THREE.Color(0x4d752b);
    const tip = new THREE.Color(0x8aaa4c);
    const c = new THREE.Color();
    const blades = [
        { angle: 0.0, offset: [0.0, 0.0], lean: 0.16, width: 0.03 },
        { angle: 2.1, offset: [0.05, 0.03], lean: 0.22, width: 0.026 },
        { angle: 4.2, offset: [-0.04, 0.04], lean: 0.19, width: 0.03 }
    ];
    // Height and half-width (as a fraction of the blade width) for each vertex row
    const rows = [
        [0.0, 1.0],
        [0.38, 0.85],
        [0.72, 0.55]
    ];
    for (const b of blades) {
        const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
        // Blade plane faces direction (ca, sa); it leans outwards along that direction
        const along = [-sa, ca];
        const start = positions.length / 3;
        for (const [y, w] of rows) {
            const lean = b.lean * y * y;
            for (const side of [-1, 1]) {
                const hx = along[0] * side * b.width * w;
                const hz = along[1] * side * b.width * w;
                positions.push(b.offset[0] + hx + ca * lean, y, b.offset[1] + hz + sa * lean);
                const t = y;
                c.copy(base).lerp(mid, Math.min(1, t / 0.5));
                if (t > 0.5) c.copy(mid).lerp(tip, (t - 0.5) / 0.5);
                colors.push(c.r, c.g, c.b);
            }
        }
        // Tip
        positions.push(b.offset[0] + ca * b.lean, 1.0, b.offset[1] + sa * b.lean);
        colors.push(tip.r, tip.g, tip.b);
        // Two quads + tip triangle
        for (let r = 0; r < 2; r++) {
            const a = start + r * 2, bb = a + 1, cc = a + 2, d = a + 3;
            indices.push(a, bb, cc, bb, d, cc);
        }
        indices.push(start + 4, start + 5, start + 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(indices);
    return g;
}

const GRASS_VERTEX_HEADER = /* glsl */`
attribute vec2 aCell;
uniform vec2 uCamCell;
uniform float uSpacing;
uniform vec3 uCamPos;
uniform vec3 uPlayerPos;
uniform vec2 uMaskOrigin;
uniform float uMaskSize;
uniform sampler2D uMask;
uniform float uTime;
uniform vec2 uFadeIn;
uniform vec2 uFadeOut;
uniform float uHeightScale;
uniform float uWidthScale;
float grassHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
`;

// Runs where beginnormal_vertex was (after color_vertex, before begin_vertex)
const GRASS_VERTEX_BODY = /* glsl */`
vec2 grassCell = uCamCell + aCell;
float gr1 = grassHash(grassCell);
float gr2 = grassHash(grassCell + 17.31);
float gr3 = grassHash(grassCell + 41.73);
float gr4 = grassHash(grassCell + 73.19);
vec2 grassBase = (grassCell + vec2(gr1, gr2)) * uSpacing;
float grassDist = distance(grassBase, uCamPos.xz);

vec2 grassUv = (grassBase - uMaskOrigin) / uMaskSize;
float grassMask = 0.0;
if (grassUv.x > 0.0 && grassUv.y > 0.0 && grassUv.x < 1.0 && grassUv.y < 1.0) {
    grassMask = texture2D(uMask, grassUv).r;
}
float grassFade = smoothstep(uFadeIn.x, uFadeIn.y, grassDist) * (1.0 - smoothstep(uFadeOut.x, uFadeOut.y, grassDist));
float grassH = (0.55 + gr3 * 0.75) * uHeightScale * grassFade * step(0.6, grassMask);

float grassAng = gr4 * 6.2831853;
float gc = cos(grassAng);
float gs = sin(grassAng);
float grassBend = position.y * position.y;

vec3 grassP = vec3(position.x * uWidthScale, position.y, position.z * uWidthScale);
grassP = vec3(gc * grassP.x - gs * grassP.z, grassP.y * grassH, gs * grassP.x + gc * grassP.z);

// Wind: two travelling waves across the field
float grassWind = sin(uTime * 1.6 + grassBase.x * 0.32 + grassBase.y * 0.21) * 0.7
                + sin(uTime * 2.9 + grassBase.x * 0.85 - grassBase.y * 0.6) * 0.3;
grassP.xz += vec2(0.85, 0.52) * (grassWind * 0.5 + 0.35) * 0.16 * grassBend * grassH;

// Blades part around the player's feet
vec2 grassAway = grassBase - uPlayerPos.xz;
float grassPd = length(grassAway);
float grassPush = (1.0 - smoothstep(0.25, 1.3, grassPd)) * (1.0 - step(1.2, abs(uPlayerPos.y)));
grassP.xz += (grassAway / max(grassPd, 0.001)) * grassPush * 0.5 * grassBend * grassH;
grassP.y *= 1.0 - grassPush * 0.45;

// Culled clumps collapse to a single point so they produce no pixels at all
grassP *= step(0.001, grassH);
vec3 grassWorld = vec3(grassBase.x, 0.0, grassBase.y) + grassP;

// Per-clump tint: some clumps drier and yellower, some lusher
#ifdef USE_COLOR
    vec3 grassTint = mix(vec3(0.85, 0.97, 0.8), vec3(1.08, 1.02, 0.8), gr2);
    grassTint *= 0.85 + gr1 * 0.3;
    vColor.rgb *= grassTint;
#endif

// Mostly upward normal so the field is lit evenly instead of flickering blade by blade
vec3 objectNormal = normalize(vec3(gc * 0.35, 1.0, gs * 0.35));
#ifdef USE_TANGENT
    vec3 objectTangent = vec3(1.0, 0.0, 0.0);
#endif
`;

function createGrassMaterial(uniforms) {
    const material = new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: THREE.DoubleSide
    });
    material.name = 'GrassMaterial';
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = GRASS_VERTEX_HEADER + shader.vertexShader
            .replace('#include <beginnormal_vertex>', GRASS_VERTEX_BODY)
            .replace('#include <begin_vertex>', 'vec3 transformed = grassWorld;');
        // Keep the upward normal on both faces (the default flips it for back faces, turning them black)
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <normal_fragment_begin>',
            'float faceDirection = gl_FrontFacing ? 1.0 : -1.0;\nvec3 normal = normalize( vNormal );\nvec3 nonPerturbedNormal = normal;'
        );
    };
    material.customProgramCacheKey = () => 'kaj-grass-v1';
    return material;
}

export class GrassSystem {
    /**
     * @param {THREE.Mesh[]} mapTiles AnothermapoLoader tile meshes (CPU geometry is read to build the mask)
     * @param {object} options see DEFAULTS; lowSpec picks lighter defaults
     */
    constructor(mapTiles, options = {}) {
        const low = !!options.lowSpec;
        const lowDefaults = low ? {
            nearSpacing: 0.36, nearHalfSize: 14, nearFadeOut: [7, 12],
            farSpacing: 0.95, farHalfSize: 37, farFadeIn: [6.5, 11.5], farFadeOut: [24, 33],
            distantSpacing: 2.0, distantHalfSize: 75, distantFadeIn: [23, 32], distantFadeOut: [54, 70],
            maskSize: 210, refreshDistance: 22
        } : {};
        this.opts = Object.assign({}, DEFAULTS, lowDefaults, options);
        this.tiles = (mapTiles || []).filter((m) => m && m.isMesh && m.geometry && !m.userData.isTerrainTile && Array.isArray(m.material));
        this._blockerCache = new Map();  // tile uuid -> Float32Array of blocker triangles (x0,z0,x1,z1,x2,z2)
        this._prefetchQueue = [];

        const o = this.opts;
        this.maskTexels = Math.round(o.maskSize / o.maskResolution);
        this.maskData = new Uint8Array(this.maskTexels * this.maskTexels);
        this.maskTexture = new THREE.DataTexture(this.maskData, this.maskTexels, this.maskTexels, THREE.RedFormat, THREE.UnsignedByteType);
        this.maskTexture.magFilter = THREE.LinearFilter;
        this.maskTexture.minFilter = THREE.LinearFilter;
        this.maskTexture.generateMipmaps = false;
        this.maskTexture.needsUpdate = true;
        // Extra rectangles where nothing grows (buildings the game adds itself)
        this.blockRects = [];
        this.maskOrigin = new THREE.Vector2(Infinity, Infinity);
        this.maskCentre = new THREE.Vector2(Infinity, Infinity);

        this.time = { value: 0 };
        this.camPos = { value: new THREE.Vector3() };
        this.playerPos = { value: new THREE.Vector3(0, -100, 0) };
        this.maskUniforms = {
            uMask: { value: this.maskTexture },
            uMaskOrigin: { value: this.maskOrigin },
            uMaskSize: { value: o.maskSize }
        };

        this.root = new THREE.Group();
        this.root.name = 'grass_root';
        const clump = buildClumpGeometry();
        this.near = this._buildField(clump, o.nearSpacing, o.nearHalfSize, [-1, -0.5], o.nearFadeOut, o.bladeHeight * 0.85, 1.0);
        this.far = this._buildField(clump, o.farSpacing, o.farHalfSize, o.farFadeIn, o.farFadeOut, o.bladeHeight * 1.05, 2.1);
        this.distant = this._buildField(clump, o.distantSpacing, o.distantHalfSize, o.distantFadeIn, o.distantFadeOut, o.bladeHeight * 1.2, 3.8);
        this.fields = [this.near, this.far, this.distant];
        clump.dispose();
        this.root.add(...this.fields.map((f) => f.mesh));
        this.instanceCount = this.fields.reduce((n, f) => n + f.count, 0);
        this.trianglesPerClump = 15;
        this.lastRebuildMs = 0;
        this.rebuilds = 0;
    }

    _buildField(clump, spacing, halfSize, fadeIn, fadeOut, heightScale, widthScale) {
        const n = Math.ceil(halfSize / spacing);
        const side = n * 2 + 1;
        const cells = new Float32Array(side * side * 2);
        let k = 0;
        // Order instances by distance so the near ones are drawn first (better early-z rejection)
        const list = [];
        for (let z = -n; z <= n; z++) {
            for (let x = -n; x <= n; x++) list.push([x, z, x * x + z * z]);
        }
        list.sort((a, b) => a[2] - b[2]);
        for (const [x, z] of list) {
            cells[k++] = x;
            cells[k++] = z;
        }
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.index = clump.index.clone();
        geometry.setAttribute('position', clump.getAttribute('position').clone());
        geometry.setAttribute('color', clump.getAttribute('color').clone());
        geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
        geometry.instanceCount = list.length;

        const uniforms = Object.assign({
            uCamCell: { value: new THREE.Vector2() },
            uSpacing: { value: spacing },
            uCamPos: this.camPos,
            uPlayerPos: this.playerPos,
            uTime: this.time,
            uFadeIn: { value: new THREE.Vector2(fadeIn[0], fadeIn[1]) },
            uFadeOut: { value: new THREE.Vector2(fadeOut[0], fadeOut[1]) },
            uHeightScale: { value: heightScale },
            uWidthScale: { value: widthScale }
        }, this.maskUniforms);
        const material = createGrassMaterial(uniforms);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'grass_field';
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.visible = false;
        return { mesh, uniforms, spacing, count: list.length };
    }

    /** Collect the triangles of one map tile that clear grass, as flat XZ triples */
    _extractBlockers(tile) {
        const geometry = tile.geometry;
        const pos = geometry.getAttribute('position');
        const index = geometry.index;
        if (!pos || !index) return new Float32Array(0);
        const p = pos.array;
        const idx = index.array;
        const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: idx.length, materialIndex: 0 }];
        const out = [];
        for (const group of groups) {
            const mat = tile.material[group.materialIndex];
            if (!mat) continue;
            const hard = !!mat.userData.grassBlocker;
            const friendly = !!mat.userData.grassFriendly;
            if (!hard && friendly) continue;
            const end = group.start + group.count;
            for (let i = group.start; i < end; i += 3) {
                const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
                const ay = p[a + 1], by = p[b + 1], cy = p[c + 1];
                const minY = Math.min(ay, by, cy);
                if (hard) {
                    if (Math.max(ay, by, cy) > 2.0) continue;
                } else {
                    // Roof-like: above the ground and facing up (or down; winding is not reliable)
                    if (minY < 0.4) continue;
                    const ux = p[b] - p[a], uy = by - ay, uz = p[b + 2] - p[a + 2];
                    const vx = p[c] - p[a], vy = cy - ay, vz = p[c + 2] - p[a + 2];
                    const nx = uy * vz - uz * vy;
                    const ny = uz * vx - ux * vz;
                    const nz = ux * vy - uy * vx;
                    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                    if (len < 0.02 || Math.abs(ny) / len < 0.3) continue;
                }
                out.push(p[a], p[a + 2], p[b], p[b + 2], p[c], p[c + 2]);
            }
        }
        return new Float32Array(out);
    }

    _blockersFor(tile) {
        let cached = this._blockerCache.get(tile.uuid);
        if (!cached) {
            const t0 = performance.now();
            cached = this._extractBlockers(tile);
            this._blockerCache.set(tile.uuid, cached);
            this.maxExtractMs = Math.max(this.maxExtractMs || 0, performance.now() - t0);
        }
        return cached;
    }

    _tilesOverlapping(minX, minZ, maxX, maxZ) {
        const out = [];
        for (const tile of this.tiles) {
            const bb = tile.geometry.boundingBox;
            if (!bb) continue;
            if (bb.max.x < minX || bb.min.x > maxX || bb.max.z < minZ || bb.min.z > maxZ) continue;
            out.push(tile);
        }
        return out;
    }

    /** Rebuild the mask window centred on (cx, cz) */
    _rebuildMask(cx, cz) {
        const t0 = performance.now();
        const o = this.opts;
        const res = o.maskResolution;
        const n = this.maskTexels;
        const half = o.maskSize / 2;
        const ox = Math.floor((cx - half) / res) * res;
        const oz = Math.floor((cz - half) / res) * res;
        const maxX = ox + o.maskSize, maxZ = oz + o.maskSize;
        const data = this.maskData;
        data.fill(255);

        const tiles = this._tilesOverlapping(ox, oz, maxX, maxZ);
        for (const tile of tiles) {
            const tris = this._blockersFor(tile);
            for (let i = 0, len = tris.length; i < len; i += 6) {
                const x0 = tris[i], z0 = tris[i + 1], x1 = tris[i + 2], z1 = tris[i + 3], x2 = tris[i + 4], z2 = tris[i + 5];
                let tminX = x0 < x1 ? x0 : x1; if (x2 < tminX) tminX = x2;
                let tmaxX = x0 > x1 ? x0 : x1; if (x2 > tmaxX) tmaxX = x2;
                if (tmaxX < ox || tminX > maxX) continue;
                let tminZ = z0 < z1 ? z0 : z1; if (z2 < tminZ) tminZ = z2;
                let tmaxZ = z0 > z1 ? z0 : z1; if (z2 > tmaxZ) tmaxZ = z2;
                if (tmaxZ < oz || tminZ > maxZ) continue;

                const area = (x1 - x0) * (z2 - z0) - (x2 - x0) * (z1 - z0);
                if (Math.abs(area) < 1e-6) continue;
                const sign = area > 0 ? 1 : -1;
                // Texel range (texel centres), expanded by one texel so thin kerbs and sidewalks are not missed
                const ix0 = Math.max(0, Math.floor((tminX - ox) / res) - 1);
                const ix1 = Math.min(n - 1, Math.ceil((tmaxX - ox) / res));
                const iz0 = Math.max(0, Math.floor((tminZ - oz) / res) - 1);
                const iz1 = Math.min(n - 1, Math.ceil((tmaxZ - oz) / res));
                // Edge functions, inflated by ~half a texel
                const pad = res * 0.5;
                const e0l = Math.hypot(x2 - x1, z2 - z1), e1l = Math.hypot(x0 - x2, z0 - z2), e2l = Math.hypot(x1 - x0, z1 - z0);
                for (let iz = iz0; iz <= iz1; iz++) {
                    const pz = oz + (iz + 0.5) * res;
                    const row = iz * n;
                    for (let ix = ix0; ix <= ix1; ix++) {
                        const px = ox + (ix + 0.5) * res;
                        const w0 = sign * ((x2 - x1) * (pz - z1) - (z2 - z1) * (px - x1));
                        if (w0 < -pad * e0l) continue;
                        const w1 = sign * ((x0 - x2) * (pz - z2) - (z0 - z2) * (px - x2));
                        if (w1 < -pad * e1l) continue;
                        const w2 = sign * ((x1 - x0) * (pz - z0) - (z1 - z0) * (px - x0));
                        if (w2 < -pad * e2l) continue;
                        data[row + ix] = 0;
                    }
                }
            }
        }

        for (const [rx0, rz0, rx1, rz1] of this.blockRects) {
            const ix0 = Math.max(0, Math.floor((rx0 - ox) / res)), ix1 = Math.min(n - 1, Math.ceil((rx1 - ox) / res));
            const iz0 = Math.max(0, Math.floor((rz0 - oz) / res)), iz1 = Math.min(n - 1, Math.ceil((rz1 - oz) / res));
            for (let iz = iz0; iz <= iz1; iz++) data.fill(0, iz * n + ix0, iz * n + ix1 + 1);
        }

        this.maskOrigin.set(ox, oz);
        this.maskCentre.set(cx, cz);
        this.maskTexture.needsUpdate = true;
        this.lastRebuildMs = performance.now() - t0;
        this.rebuilds++;

        // Warm the blocker cache for tiles just outside this window, a little each frame
        const ring = o.maskSize;
        this._prefetchQueue = this._tilesOverlapping(ox - ring, oz - ring, maxX + ring, maxZ + ring)
            .filter((t) => !this._blockerCache.has(t.uuid));
    }

    /**
     * @param {THREE.Vector3} cameraPosition
     * @param {THREE.Vector3} playerPosition feet position of the player on foot (pushes blades aside)
     * @param {number} timeSeconds
     */
    /** Keeps grass out of the rectangle (world x / z); takes effect at the next mask rebuild. */
    addBlocker(minX, minZ, maxX, maxZ) {
        this.blockRects.push([minX, minZ, maxX, maxZ]);
        this.maskCentre.set(Infinity, Infinity);
    }

    update(cameraPosition, playerPosition, timeSeconds) {
        const o = this.opts;
        const visible = cameraPosition.y < o.maxCameraHeight;
        for (const field of this.fields) field.mesh.visible = visible;
        if (!visible) return;

        const dx = cameraPosition.x - this.maskCentre.x;
        const dz = cameraPosition.z - this.maskCentre.y;
        if (!(dx * dx + dz * dz < o.refreshDistance * o.refreshDistance)) {
            this._rebuildMask(cameraPosition.x, cameraPosition.z);
        } else if (this._prefetchQueue.length > 0) {
            this._blockersFor(this._prefetchQueue.pop());
        }

        this.time.value = timeSeconds;
        this.camPos.value.copy(cameraPosition);
        if (playerPosition) this.playerPos.value.copy(playerPosition);
        else this.playerPos.value.set(0, -100, 0);
        for (const field of this.fields) {
            field.uniforms.uCamCell.value.set(
                Math.floor(cameraPosition.x / field.spacing),
                Math.floor(cameraPosition.z / field.spacing)
            );
        }
    }

    getStats() {
        return {
            instances: this.instanceCount,
            maxTriangles: this.instanceCount * this.trianglesPerClump,
            lastRebuildMs: +this.lastRebuildMs.toFixed(2),
            rebuilds: this.rebuilds,
            cachedTiles: this._blockerCache.size,
            maxTileExtractMs: +(this.maxExtractMs || 0).toFixed(2),
            visible: this.near.mesh.visible
        };
    }

    dispose() {
        for (const field of this.fields) {
            field.mesh.geometry.dispose();
            field.mesh.material.dispose();
        }
        this.maskTexture.dispose();
        this._blockerCache.clear();
        this.root.clear();
    }
}
