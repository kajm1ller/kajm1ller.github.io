/**
 * js/game/gasStations.js
 *
 * Gas stations you can walk into and hold up. The sites are the real amenity=fuel spots from the
 * OSM extract (data/gasStations.json, baked by tools/buildGasStations.mjs). Each one gets a pump
 * canopy by the street and a small convenience store behind it: hollow walls with an open doorway,
 * shelves, coolers and a counter with a clerk (a pedestrian rig, drawn through
 * PedestrianSystem.extraRigs).
 *
 * Robbery: stand at the counter with a gun in your hands and press E. The clerk puts their hands up
 * and empties the till into a bag while you hold the spot (leave, put the gun away or get shot and
 * it's off). The crime is reported when it starts and again when you walk out with the money, so
 * the cops come with two stars. A till refills after a few minutes.
 *
 * Stores are built when you first come within BUILD_DISTANCE and hidden when you are far away.
 * Local coordinates: +x towards the street, origin at the middle of the site; the frame is turned
 * to the nearest quarter turn so the walls stay axis-aligned colliders.
 */

import * as THREE from 'three';

export const GAS_CONFIG = Object.freeze({
    BUILD_DISTANCE: 450,
    DRAW_DISTANCE: 700,
    ROB_SECONDS: 4.5,          // time at the counter while the clerk fills the bag
    ROB_RANGE: 6,              // metres from the clerk before the robbery is off
    TILL_MIN: 180,
    TILL_MAX: 520,
    REFILL_SECONDS: 360,
    CLERK_FEAR_SECONDS: 14     // hands up, then cowering, after the robbery
});

// Store (local frame)
const STORE = { x0: -9.5, x1: -2, z0: -5, z1: 5, h: 3.7, wall: 0.3, door: 2.6, doorH: 2.5 };
const CLERK = { x: -5.4, z: 2.6 };               // behind the counter, facing the street
const COUNTER = { x0: -4.3, x1: -3.4, z0: 0.9, z1: 4.4 };
const CLERK_HP = 45;
const CANOPY = { x0: 1.5, x1: 9.5, z0: -6.5, z1: 6.5, y: 4.7 };

const BRANDS = {
    'Circle K': { body: 0xd8262c, trim: 0xffffff },
    Speedway: { body: 0x1b4f9c, trim: 0xe6252b },
    Marathon: { body: 0x1f3e8a, trim: 0xe6252b },
    Sunoco: { body: 0x1857b5, trim: 0xf6c21c },
    'Murphy USA': { body: 0x1a7a3c, trim: 0xffffff },
    Meijer: { body: 0xd9262b, trim: 0xffffff },
    Kroger: { body: 0x2456a6, trim: 0xffffff },
    "Ridi's": { body: 0x2f6b3a, trim: 0xf2d16b },
    default: { body: 0x3a6f8f, trim: 0xf2f2f2 }
};

/** Local (lx, lz) -> world, for a site turned `theta` about y. */
export function localToWorld(site, lx, lz, out = {}) {
    const c = Math.cos(site.theta), s = Math.sin(site.theta);
    out.x = site.x + lx * c + lz * s;
    out.z = site.z - lx * s + lz * c;
    return out;
}
export function worldToLocal(site, x, z, out = {}) {
    const c = Math.cos(site.theta), s = Math.sin(site.theta);
    const dx = x - site.x, dz = z - site.z;
    out.x = dx * c - dz * s;
    out.z = dx * s + dz * c;
    return out;
}

/** Fills in the world-space bits of a baked site: quarter-turn frame, door spot, clerk spot. */
export function prepareSite(raw) {
    const quarter = Math.round((raw.yaw - Math.PI / 2) / (Math.PI / 2));
    const site = { ...raw, theta: quarter * (Math.PI / 2) };
    site.clerk = localToWorld(site, CLERK.x, CLERK.z);
    site.clerkYaw = site.theta + Math.PI / 2;
    site.entry = localToWorld(site, STORE.x1 + 3.5, 0);
    return site;
}

function canvasTexture(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
}

function brandOf(name) {
    return BRANDS[name] || BRANDS.default;
}

function hex(n) { return '#' + n.toString(16).padStart(6, '0'); }

function signTexture(name, brand) {
    return canvasTexture(512, 256, (g, w, h) => {
        g.fillStyle = hex(brand.body);
        g.fillRect(0, 0, w, h);
        g.fillStyle = hex(brand.trim);
        g.fillRect(0, h - 70, w, 70);
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = hex(brand.trim);
        g.font = `bold ${name.length > 9 ? 62 : 88}px Arial, sans-serif`;
        g.fillText(name.toUpperCase(), w / 2, 80);
        g.fillStyle = hex(brand.body);
        g.font = 'bold 54px Arial, sans-serif';
        g.fillText('REG 3.19', w / 2, h - 36);
    });
}

function shelfTexture() {
    return canvasTexture(128, 64, (g, w, h) => {
        const cols = ['#d84a3a', '#f0c030', '#3a8ad8', '#58b05a', '#e07ab0', '#f2f2f2', '#8a5a3a'];
        g.fillStyle = '#d9d9d9'; g.fillRect(0, 0, w, h);
        for (let r = 0; r < 3; r++) {
            for (let i = 0; i < 12; i++) {
                g.fillStyle = cols[(i * 3 + r * 5) % cols.length];
                g.fillRect(i * 10 + 3, r * 21 + 3, 8, 15);
            }
        }
    });
}

let shared = null;
function sharedAssets() {
    if (shared) return shared;
    const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, emissive: 0x101010, ...extra });
    shared = {
        box: new THREE.BoxGeometry(1, 1, 1),
        wall: std(0xe8e2d4),
        roof: std(0x5a5a60),
        floor: std(0xcfd0cc, { emissive: 0x2a2a2a }),
        slab: std(0x8a8a88, { roughness: 0.95 }),
        counter: std(0x6b4a2e, { emissive: 0x1a1008 }),
        counterTop: std(0x2a2a2e, { roughness: 0.4 }),
        shelf: new THREE.MeshStandardMaterial({ map: shelfTexture(), roughness: 0.8, emissive: 0x303030 }),
        steel: std(0x9aa0a6, { metalness: 0.7, roughness: 0.35 }),
        glass: new THREE.MeshStandardMaterial({ color: 0xbfe3f0, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.3 }),
        pump: std(0xdedede),
        pumpScreen: new THREE.MeshBasicMaterial({ color: 0x55e0a0, toneMapped: false }),
        hose: std(0x111111),
        lightPanel: new THREE.MeshBasicMaterial({ color: 0xfff6dc, toneMapped: false }),
        cooler: new THREE.MeshBasicMaterial({ color: 0xcfeaff, toneMapped: false }),
        pillar: std(0xc9c9c9),
        tile: std(0x333333)
    };
    return shared;
}

export class GasStations {
    /**
     * @param {Object} o
     * @param {THREE.Scene} o.scene
     * @param {Object} [o.spatialGrid] gets the walls as static buildings
     * @param {Object} [o.pedestrians] PedestrianSystem (clerks are rigs drawn through extraRigs)
     */
    constructor({ scene, spatialGrid = null, pedestrians = null }) {
        this.scene = scene;
        this.spatialGrid = spatialGrid;
        this.pedestrians = pedestrians;
        this.sites = [];
        this.rob = null;                // { site, t } while a holdup is going
        this.onCrime = null;            // (type, {x, y, z}) => void
        this.onPayout = null;           // (amount, site) => void
        this.onMessage = null;          // (text) => void
        this.onClerkKilled = null;      // (site, {x, y, z}) => void
        this.time = 0;
    }

    load(rawSites) {
        for (const raw of rawSites) {
            const site = prepareSite(raw);
            site.built = false;
            site.till = this._newTill();
            site.refill = 0;            // seconds until the till has money again
            site.fear = 0;              // seconds the clerk is still scared
            site.bounds = this._bounds(site);
            this.sites.push(site);
        }
        return this.sites;
    }

    _newTill() {
        return Math.round(GAS_CONFIG.TILL_MIN + Math.random() * (GAS_CONFIG.TILL_MAX - GAS_CONFIG.TILL_MIN));
    }

    /** World-space bounding box of the whole site (store + forecourt), for keeping grass off it. */
    _bounds(site) {
        const pts = [[STORE.x0, STORE.z0], [STORE.x0, STORE.z1], [CANOPY.x1 + 1, CANOPY.z0], [CANOPY.x1 + 1, CANOPY.z1]]
            .map(([lx, lz]) => localToWorld(site, lx, lz));
        return {
            minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
            minZ: Math.min(...pts.map((p) => p.z)), maxZ: Math.max(...pts.map((p) => p.z))
        };
    }

    // ------------------------------------------------------------------------------------------
    // Clearing the map's own station
    // ------------------------------------------------------------------------------------------
    /**
     * The map already draws a building / canopy on most of these spots. Cuts everything above the
     * ground inside each site out of the map's tile meshes (and its building colliders out of the
     * spatial grid) so the new store isn't wearing the old one's roof. Call once the tiles exist.
     * @param {THREE.Mesh[]} tiles
     */
    carve(tiles) {
        if (!Array.isArray(tiles) || !tiles.length || this._carved || !this.sites.length) return;
        this._carved = true;
        const M = 1.5;
        const v = new THREE.Vector3(), box = new THREE.Box3();
        for (const mesh of tiles) {
            const geo = mesh.geometry;
            if (!geo || !geo.index || !geo.attributes.position) continue;
            if (!geo.boundingBox) geo.computeBoundingBox();
            mesh.updateWorldMatrix(true, false);
            box.copy(geo.boundingBox).applyMatrix4(mesh.matrixWorld);
            const hits = this.sites.filter((s) => box.max.x > s.bounds.minX - M && box.min.x < s.bounds.maxX + M && box.max.z > s.bounds.minZ - M && box.min.z < s.bounds.maxZ + M);
            if (!hits.length) continue;
            const pos = geo.attributes.position, idx = geo.index.array;
            const ranges = geo.groups.length ? geo.groups.map((g) => ({ start: g.start, count: g.count, materialIndex: g.materialIndex }))
                : [{ start: 0, count: idx.length, materialIndex: 0 }];
            const out = new idx.constructor(idx.length);
            let n = 0, changed = false;
            const groups = [];
            for (const r of ranges) {
                const from = n;
                for (let t = r.start; t < r.start + r.count; t += 3) {
                    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
                    let cx = 0, cz = 0, top = -Infinity;
                    for (const k of [a, b, c]) {
                        v.fromBufferAttribute(pos, k).applyMatrix4(mesh.matrixWorld);
                        cx += v.x / 3; cz += v.z / 3; top = Math.max(top, v.y);
                    }
                    let drop = false;
                    if (top > 0.7) {
                        for (const s of hits) {
                            const R = s.bounds;
                            if (cx > R.minX - M && cx < R.maxX + M && cz > R.minZ - M && cz < R.maxZ + M) { drop = true; break; }
                        }
                    }
                    if (drop) { changed = true; continue; }
                    out[n++] = a; out[n++] = b; out[n++] = c;
                }
                groups.push({ start: from, count: n - from, materialIndex: r.materialIndex });
            }
            if (!changed) continue;
            geo.boundsTree = null;   // a BVH built before the cut would point at the old triangles
            geo.setIndex(new THREE.BufferAttribute(out.slice(0, n), 1));
            if (ranges.length > 1 || geo.groups.length) { geo.clearGroups(); for (const g of groups) geo.addGroup(g.start, g.count, g.materialIndex); }
        }
        // Their building colliders
        const grid = this.spatialGrid;
        if (grid && grid.cells) {
            for (const s of this.sites) {
                const R = s.bounds;
                for (let row = grid._getRow(R.minZ - M); row <= grid._getRow(R.maxZ + M); row++) {
                    for (let col = grid._getCol(R.minX - M); col <= grid._getCol(R.maxX + M); col++) {
                        const cell = grid.cells[row * grid.cols + col];
                        if (!cell || !cell.staticItems) continue;
                        cell.staticItems = cell.staticItems.filter((e) => !(typeof e.id === 'string' && e.id.startsWith('building_')
                            && e.x > R.minX - M && e.x < R.maxX + M && e.z > R.minZ - M && e.z < R.maxZ + M && e.maxX - e.minX < 45 && e.maxZ - e.minZ < 45));
                    }
                }
            }
        }
    }

    // ------------------------------------------------------------------------------------------
    // Shooting the clerk
    // ------------------------------------------------------------------------------------------
    /** Living clerks near enough to be shot at (same shape as pedestrians: mesh, hp, isDead). */
    targets(out = []) {
        out.length = 0;
        for (const s of this.sites) if (s.built && s.clerkRig && !s.clerkRig.isDead && s.group.visible) out.push(s.clerkRig);
        return out;
    }

    /** A bullet hit this clerk. Returns whether it killed them. */
    hurtClerk(clerk, damage, hit = {}) {
        const site = clerk.site;
        if (clerk.isDead) return false;
        clerk.hp -= damage * (hit.y > clerk.mesh.position.y + 1.45 ? 2 : 1);
        site.fear = GAS_CONFIG.CLERK_FEAR_SECONDS;
        if (this.rob && this.rob.site === site) this.rob = null;
        const pos = { x: clerk.mesh.position.x, y: 1, z: clerk.mesh.position.z };
        if (this.onCrime) this.onCrime('shooting', pos);
        if (clerk.hp > 0) return false;
        clerk.isDead = true;
        clerk.deadFor = 0;
        clerk.mesh.rotation.set(-Math.PI / 2, clerk.mesh.rotation.y, 0, 'YXZ');
        clerk.mesh.position.y = 0.22;
        if (this.onClerkKilled) this.onClerkKilled(site, pos);
        return true;
    }

    _revive(site) {
        const c = site.clerkRig;
        c.isDead = false;
        c.hp = CLERK_HP;
        c.mesh.rotation.set(0, site.clerkYaw, 0);
        c.mesh.position.set(site.clerk.x, 0, site.clerk.z);
    }

    // ------------------------------------------------------------------------------------------
    // Building
    // ------------------------------------------------------------------------------------------
    _build(site) {
        site.built = true;
        const A = sharedAssets();
        const brand = brandOf(site.name);
        const group = new THREE.Group();
        group.name = `gas_${site.name}`;
        group.position.set(site.x, 0, site.z);
        group.rotation.y = site.theta;
        site.group = group;
        site.windowMats = [];

        const add = (mat, w, h, d, x, y, z, { shadow = true } = {}) => {
            const m = new THREE.Mesh(A.box, mat);
            m.scale.set(w, h, d);
            m.position.set(x, y, z);
            m.castShadow = shadow;
            m.receiveShadow = true;
            group.add(m);
            return m;
        };
        const colliders = [];    // local [x0, z0, x1, z1]
        const wall = (x0, z0, x1, z1, y0 = 0, y1 = STORE.h, solid = true) => {
            add(A.wall, x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
            if (solid) colliders.push([x0, z0, x1, z1]);
        };

        const S = STORE, T = STORE.wall;
        // Floor, hollow walls with an open doorway in the front (+x), flat roof with a parapet
        add(A.floor, S.x1 - S.x0, 0.1, S.z1 - S.z0, (S.x0 + S.x1) / 2, 0.05, (S.z0 + S.z1) / 2, { shadow: false });
        wall(S.x0, S.z0, S.x0 + T, S.z1);
        wall(S.x0, S.z0, S.x1, S.z0 + T);
        wall(S.x0, S.z1 - T, S.x1, S.z1);
        const dz0 = -S.door / 2, dz1 = S.door / 2;
        wall(S.x1 - T, S.z0, S.x1, dz0);
        wall(S.x1 - T, dz1, S.x1, S.z1);
        wall(S.x1 - T, dz0, S.x1, dz1, S.doorH, S.h, false);
        add(A.roof, S.x1 - S.x0 + 0.6, 0.35, S.z1 - S.z0 + 0.6, (S.x0 + S.x1) / 2, S.h + 0.17, (S.z0 + S.z1) / 2);
        add(A.wall, S.x1 - S.x0 + 0.8, 0.5, 0.2, (S.x0 + S.x1) / 2, S.h + 0.6, S.z0 - 0.2, { shadow: false });
        add(A.wall, S.x1 - S.x0 + 0.8, 0.5, 0.2, (S.x0 + S.x1) / 2, S.h + 0.6, S.z1 + 0.2, { shadow: false });
        // Brand band across the front and a lit panel inside
        const bandMat = new THREE.MeshStandardMaterial({ color: brand.body, roughness: 0.6, emissive: brand.body, emissiveIntensity: 0.15 });
        add(bandMat, 0.4, 0.7, S.z1 - S.z0 + 0.6, S.x1 + 0.1, S.h - 0.2, 0, { shadow: false });
        add(A.lightPanel, S.x1 - S.x0 - 1, 0.05, S.z1 - S.z0 - 1, (S.x0 + S.x1) / 2, S.h - 0.05, 0, { shadow: false });
        // Storefront windows either side of the door
        for (const side of [-1, 1]) {
            const g = add(A.glass, 0.05, 1.5, 2.8, S.x1 + 0.03, 1.55, side * 3.5, { shadow: false });
            g.renderOrder = 2;
        }

        // Counter with a register and the cigarettes behind
        add(A.counter, COUNTER.x1 - COUNTER.x0, 1.05, COUNTER.z1 - COUNTER.z0, (COUNTER.x0 + COUNTER.x1) / 2, 0.52, (COUNTER.z0 + COUNTER.z1) / 2);
        add(A.counterTop, COUNTER.x1 - COUNTER.x0 + 0.1, 0.07, COUNTER.z1 - COUNTER.z0 + 0.1, (COUNTER.x0 + COUNTER.x1) / 2, 1.08, (COUNTER.z0 + COUNTER.z1) / 2);
        add(A.steel, 0.5, 0.35, 0.5, COUNTER.x1 - 0.4, 1.3, 2.6);
        add(A.pumpScreen, 0.02, 0.15, 0.3, COUNTER.x1 - 0.14, 1.42, 2.6, { shadow: false });
        add(A.shelf, 0.4, 1.4, 3.4, S.x0 + 0.5, 1.5, 2.4);
        colliders.push([COUNTER.x0, COUNTER.z0, COUNTER.x1, COUNTER.z1]);

        // Aisles of snacks, and drinks coolers along the back-left wall
        for (const z of [-3.1, -1.2]) {
            add(A.shelf, 4.2, 1.5, 0.5, -5.8, 0.75, z);
            add(A.steel, 4.3, 0.06, 0.6, -5.8, 1.52, z, { shadow: false });
            colliders.push([-7.95, z - 0.25, -3.65, z + 0.25]);
        }
        add(A.cooler, 0.12, 2.1, 3.2, S.x0 + 0.45, 1.15, -2.6, { shadow: false });
        add(A.steel, 0.5, 0.15, 3.4, S.x0 + 0.35, 2.3, -2.6);
        add(A.tile, 3.4, 0.06, 1.4, -3.2, 0.12, -0.2, { shadow: false });

        // Pump canopy over four pumps on two islands
        const C = CANOPY;
        add(A.roof, C.x1 - C.x0, 0.35, C.z1 - C.z0, (C.x0 + C.x1) / 2, C.y, (C.z0 + C.z1) / 2);
        add(bandMat, C.x1 - C.x0 + 0.1, 0.8, C.z1 - C.z0 + 0.1, (C.x0 + C.x1) / 2, C.y - 0.1, (C.z0 + C.z1) / 2, { shadow: false });
        add(A.lightPanel, C.x1 - C.x0 - 0.6, 0.05, C.z1 - C.z0 - 0.6, (C.x0 + C.x1) / 2, C.y - 0.6, (C.z0 + C.z1) / 2, { shadow: false });
        for (const [px, pz] of [[C.x0 + 0.6, C.z0 + 0.6], [C.x0 + 0.6, C.z1 - 0.6], [C.x1 - 0.6, C.z0 + 0.6], [C.x1 - 0.6, C.z1 - 0.6]]) {
            add(A.pillar, 0.5, C.y, 0.5, px, C.y / 2, pz);
            colliders.push([px - 0.25, pz - 0.25, px + 0.25, pz + 0.25]);
        }
        const mid = (C.x0 + C.x1) / 2;
        for (const iz of [-3.3, 3.3]) {
            add(A.slab, 4.6, 0.18, 1.0, mid, 0.09, iz, { shadow: false });
            for (const px of [mid - 1.2, mid + 1.2]) {
                add(A.pump, 0.7, 1.5, 0.55, px, 0.93, iz);
                add(bandMat, 0.72, 0.35, 0.57, px, 1.55, iz, { shadow: false });
                for (const f of [-1, 1]) add(A.pumpScreen, 0.3, 0.2, 0.02, px, 1.2, iz + f * 0.285, { shadow: false });
                add(A.hose, 0.06, 0.9, 0.06, px + 0.38, 0.85, iz);
                colliders.push([px - 0.35, iz - 0.28, px + 0.35, iz + 0.28]);
            }
        }

        // Pole sign by the street
        const pole = add(A.steel, 0.3, 6.2, 0.3, 11.2, 3.1, -7.8);
        pole.castShadow = true;
        const face = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), new THREE.MeshBasicMaterial({ map: signTexture(site.name, brand), toneMapped: false }));
        for (const f of [-1, 1]) {
            const m = face.clone();
            m.position.set(11.2 + 0.001, 5.9, -7.8 + f * 0.17);
            m.rotation.y = f > 0 ? 0 : Math.PI;
            group.add(m);
        }

        this.scene.add(group);

        // Walls and pumps are solid for the player, cars, planes and bullets
        site.colliders = colliders.map(([x0, z0, x1, z1]) => {
            const a = localToWorld(site, x0, z0), b = localToWorld(site, x1, z1);
            return [Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z)];
        });
        if (this.spatialGrid && typeof this.spatialGrid.insertStatic === 'function') {
            site.colliders.forEach(([x0, z0, x1, z1], i) => {
                const box = new THREE.Box3(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, STORE.h, z1));
                this.spatialGrid.insertStatic(`gas_${site.x}_${site.z}_${i}`, box, { type: 'building', isBuilding: true, height: STORE.h, worldBox: box });
            });
        }

        // The clerk
        if (this.pedestrians && typeof this.pedestrians.createPedestrianMesh === 'function') {
            const body = this.pedestrians.createPedestrianMesh(Math.floor(Math.random() * 1e9), { style: 'worker' });
            for (const b of body.userData.rig.bindings) if (b.part === 'torso' || b.part === 'upperArm') b.color.setHex(brand.body);
            body.position.set(site.clerk.x, 0, site.clerk.z);
            body.rotation.set(0, site.clerkYaw, 0);
            site.clerkRig = { mesh: body, position: body.position, rig: body.userData.rig, phase: Math.random() * 10, isClerk: true, site, hp: CLERK_HP, isDead: false, deadFor: 0 };
        }
    }

    // ------------------------------------------------------------------------------------------
    // Queries
    // ------------------------------------------------------------------------------------------
    inStore(site, x, z) {
        const l = worldToLocal(site, x, z, this._l || (this._l = {}));
        return l.x > STORE.x0 && l.x < STORE.x1 + 0.4 && l.z > STORE.z0 && l.z < STORE.z1;
    }

    /** The site whose store the player is standing in, with distance to its clerk; or null. */
    nearClerk(x, z) {
        for (const s of this.sites) {
            if (!s.built || Math.abs(x - s.x) > 14 || Math.abs(z - s.z) > 14) continue;
            if (this.inStore(s, x, z)) return { site: s, dist: Math.hypot(x - s.clerk.x, z - s.clerk.z) };
        }
        return null;
    }

    /**
     * What pressing E would do here: { text, ok } for the prompt, or null when not at a counter.
     */
    prompt(x, z, armed) {
        if (this.rob) return { text: 'Hold your ground...', ok: false };
        const n = this.nearClerk(x, z);
        if (!n || n.dist > 5) return null;
        if (n.site.clerkRig && n.site.clerkRig.isDead) {
            if (n.site.refill > 0) return { text: 'The till is empty', ok: false, site: n.site };
            return { text: 'Take the cash from the register', ok: true, site: n.site, loot: true };
        }
        if (!armed) return { text: 'Rob the clerk (you need a gun in your hands)', ok: false, site: n.site };
        if (n.site.refill > 0) return { text: 'The till is empty', ok: false, site: n.site };
        return { text: 'Rob the clerk', ok: true, site: n.site };
    }

    // ------------------------------------------------------------------------------------------
    // Robbery
    // ------------------------------------------------------------------------------------------
    /** Starts a holdup at the counter the player is at. Returns whether it began. */
    startRobbery(x, z, armed) {
        if (this.rob) return false;
        const p = this.prompt(x, z, armed);
        if (!p || !p.ok) {
            if (p && this.onMessage) this.onMessage(p.text);
            return false;
        }
        if (p.loot) {
            this.rob = { site: p.site, t: 0 };
            this._finishRobbery(false);
            return true;
        }
        this.rob = { site: p.site, t: 0 };
        p.site.fear = GAS_CONFIG.CLERK_FEAR_SECONDS + GAS_CONFIG.ROB_SECONDS;
        if (this.onMessage) this.onMessage('"Okay, okay, take it, just don\'t shoot!"');
        if (this.onCrime) this.onCrime('armed_robbery', { x: p.site.clerk.x, y: 1, z: p.site.clerk.z });
        return true;
    }

    cancelRobbery(reason) {
        if (!this.rob) return;
        this.rob.site.fear = Math.min(this.rob.site.fear, 6);
        this.rob = null;
        if (reason && this.onMessage) this.onMessage(reason);
    }

    /** 0..1 progress of the holdup in progress (for the bar). */
    get progress() {
        return this.rob ? Math.min(1, this.rob.t / GAS_CONFIG.ROB_SECONDS) : 0;
    }

    _finishRobbery(report = true) {
        const site = this.rob.site;
        const amount = site.till;
        this.rob = null;
        site.till = this._newTill();
        site.refill = GAS_CONFIG.REFILL_SECONDS;
        if (this.onPayout) this.onPayout(amount, site);
        if (report && this.onCrime) this.onCrime('armed_robbery', { x: site.clerk.x, y: 1, z: site.clerk.z });
    }

    // ------------------------------------------------------------------------------------------
    // Per-frame
    // ------------------------------------------------------------------------------------------
    /**
     * @param {number} dt
     * @param {{x:number,y?:number,z:number}} eye camera position (what gets built / drawn)
     * @param {{x:number,z:number}} player
     * @param {{armed:boolean, alive:boolean, onFoot:boolean}} state
     */
    update(dt, eye, player, state) {
        this.time += dt;
        const extras = this.pedestrians ? this.pedestrians.extraRigs : null;
        for (const s of this.sites) {
            const d = Math.hypot(eye.x - s.x, eye.z - s.z);
            if (!s.built && d < GAS_CONFIG.BUILD_DISTANCE) this._build(s);
            if (!s.built) continue;
            const near = d < GAS_CONFIG.DRAW_DISTANCE;
            if (s.group.visible !== near) s.group.visible = near;
            if (s.clerkRig && extras) {
                const i = extras.indexOf(s.clerkRig);
                if (near && i < 0) extras.push(s.clerkRig);
                if (!near && i >= 0) extras.splice(i, 1);
            }
            if (s.refill > 0) s.refill = Math.max(0, s.refill - dt);
            if (s.fear > 0) s.fear = Math.max(0, s.fear - dt);
            if (s.clerkRig && s.clerkRig.isDead) {
                s.clerkRig.deadFor += dt;
                if (s.clerkRig.deadFor > GAS_CONFIG.REFILL_SECONDS * 2 && d > 60) this._revive(s);
            } else if (near && s.clerkRig) this._pose(s, dt);
        }

        if (this.rob) {
            const s = this.rob.site;
            const away = Math.hypot(player.x - s.clerk.x, player.z - s.clerk.z) > GAS_CONFIG.ROB_RANGE || !this.inStore(s, player.x, player.z);
            if (!state.alive || !state.onFoot) this.cancelRobbery();
            else if (!state.armed) this.cancelRobbery('You put the gun away. The clerk calls for help.');
            else if (away) this.cancelRobbery('You left. The clerk hit the alarm.');
            else {
                this.rob.t += dt;
                if (this.rob.t >= GAS_CONFIG.ROB_SECONDS) this._finishRobbery();
            }
        }
    }

    _pose(s, dt) {
        const c = s.clerkRig, r = c.rig;
        const t = this.time + c.phase;
        const held = this.rob && this.rob.site === s;
        for (const j of [r.torso, r.neck, r.shoulderL, r.shoulderR, r.elbowL, r.elbowR, r.legL, r.legR, r.kneeL, r.kneeR]) j.rotation.set(0, 0, 0);
        r.body.position.y = 0;
        if (held || s.fear > GAS_CONFIG.CLERK_FEAR_SECONDS * 0.5) {
            // Hands up, shaking
            const shake = Math.sin(t * 30) * 0.03;
            r.shoulderL.rotation.set(-2.7 + shake, 0, -0.25);
            r.shoulderR.rotation.set(-2.7 - shake, 0, 0.25);
            r.elbowL.rotation.x = -0.5;
            r.elbowR.rotation.x = -0.5;
            r.neck.rotation.x = -0.1;
        } else if (s.fear > 0) {
            // Ducked behind the counter
            r.body.position.y = -0.35;
            r.torso.rotation.x = 0.5;
            r.legL.rotation.x = r.legR.rotation.x = -0.6;
            r.kneeL.rotation.x = r.kneeR.rotation.x = 1.2;
            r.shoulderL.rotation.set(-1.2, 0, -0.2);
            r.shoulderR.rotation.set(-1.2, 0, 0.2);
            r.elbowL.rotation.x = r.elbowR.rotation.x = -1.0;
        } else {
            // Bored at the register
            r.shoulderL.rotation.x = -0.6;
            r.shoulderR.rotation.x = -0.65 + Math.max(0, Math.sin(t * 0.7)) ** 10 * 0.2;
            r.elbowL.rotation.x = r.elbowR.rotation.x = -0.7;
            r.neck.rotation.set(0.1, Math.sin(t * 0.3) * 0.35, 0);
            r.torso.rotation.z = Math.sin(t * 0.5) * 0.02;
        }
    }
}
