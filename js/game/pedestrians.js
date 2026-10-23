/**
 * js/game/pedestrians.js
 *
 * Pedestrian NPCs for Kaj Simulator:
 * - Look: jointed low-poly people (head, hair or cap, torso, arms with elbows, legs with knees,
 *   shoes, optional skirt/backpack) with randomized skin, hair, clothing and build. Every body
 *   part type is one InstancedMesh, so the whole crowd costs ~15 draw calls.
 * - Routines: walkers follow routes between stops over the sidewalk graph (A*), keep to the
 *   right, stop at the curb and look both ways, and only cross once no car is coming. Along the
 *   way they may sit on a lawn chair, café chair or bench, or join a group hanging out on grass.
 *   Others start out already seated or in groups.
 * - Population: people stream in around the player (out of view) anywhere on the map and are
 *   removed once far away, so every neighbourhood has life without simulating the whole city.
 *
 * Ped objects keep the fields the rest of the game relies on (mesh, position, state, hp, isDead,
 * velocity, speed, fleeTimer, talkTimer, walkPhase, index, mesh.userData.leftLeg/rightLeg), so
 * shooting, ragdolls, carjacking and dialog work unchanged. `ped.mesh` is a transform rig that
 * the instanced renderer reads every frame.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WALK_EDGE, FURNITURE } from './cityNav.js';

export const PED_CONFIG = Object.freeze({
    // Population targets around the player (scaled down on phones/tablets)
    WALKERS: 34,
    SITTERS: 14,
    GROUP_PEOPLE: 16,
    LOW_SPEC_SCALE: 0.55,
    CAPACITY: 140,

    SPAWN_MIN: 45,
    SPAWN_MAX: 150,
    SPAWN_IN_VIEW_MIN: 115,     // closer than this, new people only appear outside the camera view
    INITIAL_SPAWN_MIN: 6,
    DESPAWN_RADIUS: 190,
    BODY_DESPAWN_RADIUS: 140,
    TELEPORT_DIST: 120,         // player moved this far in one tick -> refill freely
    POPULATION_INTERVAL: 0.25,
    MAX_SPAWNS_PER_TICK: 3,
    RENDER_DISTANCE: 220,

    // Routines
    ROUTE_MIN: 70,
    ROUTE_MAX: 230,
    PATHS_PER_FRAME: 3,
    SEAT_SEARCH_RADIUS: 45,
    GROUP_SEARCH_RADIUS: 55,
    WALK_SPEED_MIN: 1.15,
    WALK_SPEED_MAX: 1.55,
    JOG_SPEED: 2.9,
    TURN_RATE: 7.0,

    // Street crossing
    CAR_SIGHT_RANGE: 75,
    CROSS_SAFE_TIME: 0.6,       // seconds the road must look clear before stepping off the curb
    CROSS_GIVE_UP: 28,          // seconds of waiting before picking a different route

    FURNITURE_RADIUS: 240,
    FURNITURE_REBUILD_DIST: 25
});

const TWO_PI = Math.PI * 2;

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pick(rand, arr) {
    return arr[Math.floor(rand() * arr.length) % arr.length];
}

function angleDiff(a, b) {
    let d = (b - a) % TWO_PI;
    if (d > Math.PI) d -= TWO_PI;
    if (d < -Math.PI) d += TWO_PI;
    return d;
}

// ================================================================================================
// Appearance
// ================================================================================================
const SKIN_TONES = [0xf6d7c3, 0xeac0a0, 0xe0ac69, 0xd9a47c, 0xc68642, 0xa0673f, 0x8d5524, 0x6b4226, 0x4e3020];
const HAIR_COLORS = [0x1b1410, 0x1b1410, 0x2e1f14, 0x4a3020, 0x6b4a2b, 0xa87b4f, 0xd8b878, 0x8c8c8c, 0xd0d0d0, 0x7a2e1a];
const SHIRT_COLORS = [
    0x2b5797, 0xb91d47, 0x1e7145, 0xe3a21a, 0x603cba, 0xda532c, 0xf2f2f2, 0xe8e2d0, 0x333333, 0x7fa7c9,
    0xf08080, 0x2f4f4f, 0xd4a017, 0x8fbc8f, 0xc71585, 0x4682b4, 0x9b2d30, 0x556b2f, 0xffb6c1, 0x20b2aa
];
const PANTS_COLORS = [0x1f2a44, 0x2c3e50, 0x3b3b3b, 0x5a4632, 0x7d6b4f, 0xc2b280, 0x4b5320, 0x202020, 0x6a7b8c, 0x31476b];
const SHOE_COLORS = [0x1a1a1a, 0xf2f2f2, 0x5a3a22, 0x8b0000, 0x2a3d66, 0x777777];
const ACCENT_COLORS = [0xc0392b, 0x2980b9, 0x27ae60, 0xf39c12, 0x8e44ad, 0x2c3e50, 0xe67e22, 0x16a085, 0xbdc3c7];

function makeLook(seed) {
    const rand = mulberry32(seed * 2654435761 + 17);
    const femme = rand() < 0.5;
    const skin = pick(rand, SKIN_TONES);
    const hairRoll = rand();
    const hairStyle = femme
        ? (hairRoll < 0.72 ? 'long' : hairRoll < 0.95 ? 'short' : 'none')
        : (hairRoll < 0.12 ? 'none' : hairRoll < 0.9 ? 'short' : 'long');
    const hat = rand() < (femme ? 0.1 : 0.22);
    const lowerRoll = rand();
    const skirt = femme && lowerRoll < 0.3;
    const shorts = !skirt && lowerRoll > 0.78;
    const shirt = pick(rand, SHIRT_COLORS);
    return {
        skin,
        hair: pick(rand, HAIR_COLORS),
        hairStyle,
        hat,
        cap: pick(rand, ACCENT_COLORS),
        shirt,
        longSleeves: rand() < 0.4,
        pants: skirt ? pick(rand, ACCENT_COLORS.concat(PANTS_COLORS)) : pick(rand, PANTS_COLORS),
        skirt,
        shorts,
        shoes: pick(rand, SHOE_COLORS),
        backpack: rand() < 0.14,
        pack: pick(rand, ACCENT_COLORS),
        height: (femme ? 0.93 : 0.98) + rand() * 0.1,
        width: 0.9 + rand() * 0.22
    };
}

/** A uniformed police officer on the same body as everyone else. */
function makePoliceLook(seed) {
    const look = makeLook(seed);
    return Object.assign(look, {
        police: true,
        hairStyle: look.hairStyle === 'long' ? 'none' : look.hairStyle, // tucked under the cap
        hat: false,
        shirt: 0x142542,
        longSleeves: true,
        pants: 0x0f1828,
        skirt: false,
        shorts: false,
        shoes: 0x111111,
        backpack: false,
        height: 0.98 + (look.height - 0.93) * 0.6,
        width: Math.max(1.0, look.width)
    });
}

// ================================================================================================
// Geometry (each part is built relative to the joint it hangs from)
// ================================================================================================
function box(w, h, d, x = 0, y = 0, z = 0, rotX = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rotX) g.rotateX(rotX);
    g.translate(x, y, z);
    return g;
}

function taper(geo, yCut, sx, sz = 1) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) < yCut) {
            pos.setX(i, pos.getX(i) * sx);
            pos.setZ(i, pos.getZ(i) * sz);
        }
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
}

function buildPartGeometries() {
    return {
        torso: taper(box(0.42, 0.56, 0.23, 0, 0.28, 0), 0.12, 0.86, 0.95),
        pelvis: box(0.38, 0.2, 0.235, 0, -0.02, 0),
        head: mergeGeometries([
            box(0.11, 0.09, 0.11, 0, 0.03, 0),          // neck
            box(0.22, 0.25, 0.23, 0, 0.2, 0),           // head
            box(0.04, 0.05, 0.04, 0, 0.18, 0.13),       // nose
            box(0.03, 0.06, 0.05, 0.118, 0.2, 0),       // ears
            box(0.03, 0.06, 0.05, -0.118, 0.2, 0)
        ]),
        eyes: mergeGeometries([
            box(0.042, 0.034, 0.012, 0.052, 0.225, 0.117),
            box(0.042, 0.034, 0.012, -0.052, 0.225, 0.117)
        ]),
        hairShort: mergeGeometries([
            box(0.236, 0.06, 0.246, 0, 0.345, 0),
            box(0.236, 0.17, 0.05, 0, 0.255, -0.1),
            box(0.022, 0.09, 0.2, 0.118, 0.3, -0.01),
            box(0.022, 0.09, 0.2, -0.118, 0.3, -0.01)
        ]),
        hairLong: mergeGeometries([
            box(0.24, 0.06, 0.25, 0, 0.345, 0),
            box(0.25, 0.4, 0.065, 0, 0.15, -0.11),
            box(0.03, 0.27, 0.13, 0.122, 0.21, -0.05),
            box(0.03, 0.27, 0.13, -0.122, 0.21, -0.05)
        ]),
        cap: mergeGeometries([
            box(0.246, 0.09, 0.256, 0, 0.35, 0),
            box(0.23, 0.02, 0.13, 0, 0.312, 0.175)
        ]),
        upperArm: box(0.11, 0.3, 0.12, 0, -0.14, 0),
        forearm: box(0.095, 0.25, 0.105, 0, -0.125, 0),
        hand: box(0.085, 0.09, 0.06, 0, -0.295, 0.005),
        thigh: box(0.155, 0.47, 0.17, 0, -0.225, 0),
        shin: box(0.13, 0.4, 0.145, 0, -0.2, 0),
        shoe: box(0.125, 0.075, 0.25, 0, -0.4225, 0.035),
        skirt: taper(box(0.46, 0.42, 0.31, 0, -0.2, 0), -0.05, 1.0, 1.0),
        backpack: box(0.3, 0.36, 0.13, 0, 0.3, -0.18),
        // Police kit: peaked cap (crown + black visor), gold badge, service pistol in the right hand
        policeHat: mergeGeometries([
            box(0.26, 0.1, 0.27, 0, 0.36, 0),
            box(0.3, 0.04, 0.3, 0, 0.42, 0)
        ]),
        capBrim: box(0.24, 0.025, 0.12, 0, 0.315, 0.17),
        badge: box(0.07, 0.08, 0.02, 0.1, 0.42, 0.12),
        pistol: mergeGeometries([
            box(0.045, 0.2, 0.07, 0, -0.06, 0.0),     // slide/barrel along the forearm
            box(0.04, 0.05, 0.1, 0, 0.02, 0.045)      // grip
        ])
    };
}

function buildFurnitureGeometries() {
    const cyl = (rt, rb, h, x, y, z, seg = 14) => {
        const g = new THREE.CylinderGeometry(rt, rb, h, seg);
        g.translate(x, y, z);
        return g;
    };
    return {
        // Adirondack-style lawn chair, sitter faces +Z
        lawnChair: mergeGeometries([
            box(0.56, 0.05, 0.5, 0, 0.36, 0.02, -0.08),
            box(0.56, 0.62, 0.05, 0, 0.68, -0.27, -0.28),
            box(0.08, 0.04, 0.6, 0.32, 0.56, 0.04),
            box(0.08, 0.04, 0.6, -0.32, 0.56, 0.04),
            box(0.06, 0.56, 0.06, 0.32, 0.28, 0.27),
            box(0.06, 0.56, 0.06, -0.32, 0.28, 0.27),
            box(0.06, 0.36, 0.06, 0.32, 0.18, -0.2),
            box(0.06, 0.36, 0.06, -0.32, 0.18, -0.2)
        ]),
        patioChair: mergeGeometries([
            box(0.44, 0.04, 0.42, 0, 0.46, 0),
            box(0.44, 0.4, 0.035, 0, 0.68, -0.2),
            box(0.035, 0.46, 0.035, 0.19, 0.23, 0.18),
            box(0.035, 0.46, 0.035, -0.19, 0.23, 0.18),
            box(0.035, 0.66, 0.035, 0.19, 0.33, -0.19),
            box(0.035, 0.66, 0.035, -0.19, 0.33, -0.19)
        ]),
        patioTable: mergeGeometries([
            cyl(0.42, 0.42, 0.035, 0, 0.74, 0, 18),
            cyl(0.03, 0.03, 0.72, 0, 0.37, 0, 8),
            cyl(0.25, 0.28, 0.03, 0, 0.015, 0, 14),
            cyl(0.022, 0.022, 1.6, 0, 1.5, 0, 6)
        ]),
        umbrella: (() => {
            const g = new THREE.ConeGeometry(1.25, 0.42, 8);
            g.translate(0, 2.22, 0);
            return g;
        })(),
        benchWood: mergeGeometries([
            box(1.5, 0.035, 0.12, 0, 0.45, 0.13),
            box(1.5, 0.035, 0.12, 0, 0.45, 0.0),
            box(1.5, 0.035, 0.12, 0, 0.45, -0.13),
            box(1.5, 0.1, 0.03, 0, 0.62, -0.23, -0.2),
            box(1.5, 0.1, 0.03, 0, 0.76, -0.26, -0.2)
        ]),
        benchFrame: mergeGeometries([
            box(0.05, 0.45, 0.05, 0.68, 0.225, 0.15),
            box(0.05, 0.45, 0.05, -0.68, 0.225, 0.15),
            box(0.05, 0.82, 0.05, 0.68, 0.41, -0.22, -0.1),
            box(0.05, 0.82, 0.05, -0.68, 0.41, -0.22, -0.1),
            box(0.05, 0.04, 0.44, 0.7, 0.62, -0.02),
            box(0.05, 0.04, 0.44, -0.7, 0.62, -0.02)
        ])
    };
}

const SEAT_HEIGHT = {
    [FURNITURE.LAWN_CHAIR]: 0.4,
    [FURNITURE.PATIO_CHAIR]: 0.48,
    [FURNITURE.BENCH]: 0.47
};
const LAWN_CHAIR_COLORS = [0xf4f4f0, 0x2e7d32, 0xc62828, 0x1565c0, 0x9c6b3c, 0xf9a825];
const UMBRELLA_COLORS = [0xc0392b, 0xf4f1e8, 0x27ae60, 0x2c6fbb, 0xe67e22, 0x7b1e3a];
const PATIO_CHAIR_COLORS = [0x22302a, 0x1c1c1c, 0x8a8f94, 0x3b2a1e];

// ================================================================================================
// Rig: the transform hierarchy behind every pedestrian (no renderables of its own)
// ================================================================================================
function joint(parent, x, y, z) {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    return o;
}

function buildRig(root, look) {
    const body = joint(root, 0, 0, 0);
    const hips = joint(body, 0, 0.92, 0);
    const torso = joint(body, 0, 0.92, 0);
    const neck = joint(torso, 0, 0.56, 0);
    const shoulderL = joint(torso, 0.27, 0.5, 0);
    const elbowL = joint(shoulderL, 0, -0.29, 0);
    const shoulderR = joint(torso, -0.27, 0.5, 0);
    const elbowR = joint(shoulderR, 0, -0.29, 0);
    const legL = joint(body, 0.1, 0.92, 0);
    const kneeL = joint(legL, 0, -0.46, 0);
    const legR = joint(body, -0.1, 0.92, 0);
    const kneeR = joint(legR, 0, -0.46, 0);
    root.scale.set(look.width, look.height, look.width);

    const c = (hex) => new THREE.Color(hex);
    const skin = c(look.skin);
    const shirt = c(look.shirt);
    const pants = c(look.pants);
    const legColor = look.skirt ? skin : pants;
    const shinColor = (look.skirt || look.shorts) ? skin : pants;
    const forearmColor = look.longSleeves ? shirt : skin;

    const b = [
        ['torso', torso, shirt],
        ['pelvis', hips, pants],
        ['head', neck, skin],
        ['eyes', neck, c(0x1d1d1d)],
        ['upperArm', shoulderL, shirt],
        ['upperArm', shoulderR, shirt],
        ['forearm', elbowL, forearmColor],
        ['forearm', elbowR, forearmColor],
        ['hand', elbowL, skin],
        ['hand', elbowR, skin],
        ['thigh', legL, legColor],
        ['thigh', legR, legColor],
        ['shin', kneeL, shinColor],
        ['shin', kneeR, shinColor],
        ['shoe', kneeL, c(look.shoes)],
        ['shoe', kneeR, c(look.shoes)]
    ];
    if (look.hairStyle === 'short' && !look.hat) b.push(['hairShort', neck, c(look.hair)]);
    if (look.hairStyle === 'long') b.push(['hairLong', neck, c(look.hair)]);
    if (look.hat) b.push(['cap', neck, c(look.cap)]);
    if (look.skirt) b.push(['skirt', hips, pants]);
    if (look.backpack) b.push(['backpack', torso, c(look.pack)]);
    let pistolJoint = null;
    if (look.police) {
        b.push(['policeHat', neck, c(0x142542)]);
        b.push(['capBrim', neck, c(0x0c0c0c)]);
        b.push(['badge', torso, c(0xffd700)]);
        // Named so game/test code can find the officer's gun
        pistolJoint = joint(elbowR, 0, -0.3, 0.02);
        pistolJoint.name = 'officer_pistol';
        b.push(['pistol', pistolJoint, c(0x1e1e1e)]);
    }

    return {
        body, hips, torso, neck,
        shoulderL, elbowL, shoulderR, elbowR,
        legL, kneeL, legR, kneeR,
        pistol: pistolJoint,
        bindings: b.map(([part, j, color]) => ({ part, joint: j, color }))
    };
}

// ================================================================================================
// Instanced renderers
// ================================================================================================
const PART_SLOTS = {
    torso: 1, pelvis: 1, head: 1, eyes: 1, upperArm: 2, forearm: 2, hand: 2,
    thigh: 2, shin: 2, shoe: 2, hairShort: 1, hairLong: 1, cap: 1, skirt: 1, backpack: 1,
    policeHat: 1, capBrim: 1, badge: 1, pistol: 1
};

class PedestrianRenderer {
    constructor(scene, capacity, lowSpec) {
        this.capacity = capacity;
        const geos = buildPartGeometries();
        this.material = lowSpec
            ? new THREE.MeshLambertMaterial({ color: 0xffffff })
            : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0 });
        this.meshes = {};
        this.counts = {};
        for (const part of Object.keys(PART_SLOTS)) {
            const max = capacity * PART_SLOTS[part];
            const mesh = new THREE.InstancedMesh(geos[part], this.material, max);
            mesh.name = `pedestrian_${part}`;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
            mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
            mesh.frustumCulled = false;
            mesh.castShadow = !lowSpec;
            mesh.receiveShadow = true;
            mesh.count = 0;
            mesh.userData.max = max;
            scene.add(mesh);
            this.meshes[part] = mesh;
            this.counts[part] = 0;
        }
    }

    render(peds, cx, cz, maxDist, extra = null) {
        const counts = this.counts;
        for (const k in counts) counts[k] = 0;
        const max2 = maxDist * maxDist;
        const n = peds.length + (extra ? extra.length : 0);
        for (let i = 0; i < n; i++) {
            const ped = i < peds.length ? peds[i] : extra[i - peds.length];
            const rig = ped.mesh && ped.mesh.userData.rig;
            if (!rig) continue;
            const p = ped.mesh.position;
            const dx = p.x - cx, dz = p.z - cz;
            if (dx * dx + dz * dz > max2) continue;
            ped.mesh.updateMatrixWorld(true);
            const bindings = rig.bindings;
            for (let j = 0; j < bindings.length; j++) {
                const bnd = bindings[j];
                const mesh = this.meshes[bnd.part];
                const idx = counts[bnd.part];
                if (idx >= mesh.userData.max) continue;
                mesh.setMatrixAt(idx, bnd.joint.matrixWorld);
                mesh.setColorAt(idx, bnd.color);
                counts[bnd.part] = idx + 1;
            }
        }
        for (const k in this.meshes) {
            const mesh = this.meshes[k];
            mesh.count = counts[k];
            if (counts[k] > 0) {
                mesh.instanceMatrix.needsUpdate = true;
                mesh.instanceColor.needsUpdate = true;
            }
        }
    }
}

class FurnitureRenderer {
    constructor(scene, nav, lowSpec) {
        this.nav = nav;
        const geos = buildFurnitureGeometries();
        const mat = lowSpec
            ? new THREE.MeshLambertMaterial({ color: 0xffffff })
            : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0.05 });
        const MAX = 700;
        this.meshes = {};
        for (const k of Object.keys(geos)) {
            const mesh = new THREE.InstancedMesh(geos[k], mat, MAX);
            mesh.name = `street_furniture_${k}`;
            mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
            mesh.frustumCulled = false;
            mesh.castShadow = !lowSpec;
            mesh.receiveShadow = true;
            mesh.count = 0;
            mesh.userData.max = MAX;
            scene.add(mesh);
            this.meshes[k] = mesh;
        }
        this._list = [];
        this._lastX = Infinity;
        this._lastZ = Infinity;
        this._m = new THREE.Matrix4();
        this._q = new THREE.Quaternion();
        this._p = new THREE.Vector3();
        this._s = new THREE.Vector3(1, 1, 1);
        this._c = new THREE.Color();
        this._up = new THREE.Vector3(0, 1, 0);
    }

    update(cx, cz) {
        if (Math.hypot(cx - this._lastX, cz - this._lastZ) < PED_CONFIG.FURNITURE_REBUILD_DIST) return;
        this._lastX = cx;
        this._lastZ = cz;
        const nav = this.nav;
        const list = nav.furnitureNear(cx, cz, PED_CONFIG.FURNITURE_RADIUS, this._list);
        const counts = {};
        for (const k in this.meshes) counts[k] = 0;
        const put = (key, i, color) => {
            const mesh = this.meshes[key];
            const idx = counts[key];
            if (idx >= mesh.userData.max) return;
            this._p.set(nav.furnX[i], 0, nav.furnZ[i]);
            this._q.setFromAxisAngle(this._up, nav.furnYaw[i]);
            this._m.compose(this._p, this._q, this._s);
            mesh.setMatrixAt(idx, this._m);
            mesh.setColorAt(idx, this._c.setHex(color));
            counts[key] = idx + 1;
        };
        for (let n = 0; n < list.length; n++) {
            const i = list[n];
            const variant = (i * 2654435761) >>> 0;
            switch (nav.furnType[i]) {
                case FURNITURE.LAWN_CHAIR:
                    put('lawnChair', i, LAWN_CHAIR_COLORS[(variant >>> 3) % LAWN_CHAIR_COLORS.length]);
                    break;
                case FURNITURE.PATIO_CHAIR:
                    put('patioChair', i, PATIO_CHAIR_COLORS[(variant >>> 5) % PATIO_CHAIR_COLORS.length]);
                    break;
                case FURNITURE.PATIO_TABLE:
                    put('patioTable', i, 0x2b2b2b);
                    put('umbrella', i, UMBRELLA_COLORS[(variant >>> 7) % UMBRELLA_COLORS.length]);
                    break;
                case FURNITURE.BENCH:
                    put('benchWood', i, 0x8a5a35);
                    put('benchFrame', i, 0x23272b);
                    break;
                default:
                    break;
            }
        }
        for (const k in this.meshes) {
            const mesh = this.meshes[k];
            mesh.count = counts[k];
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
    }
}

// ================================================================================================
// Pedestrian system
// ================================================================================================
export class PedestrianSystem {
    /**
     * @param {Object} options
     * @param {THREE.Scene} options.scene
     * @param {import('./cityNav.js').CityNav|null} options.nav
     * @param {Array} options.pedestrians Shared live array of ped objects (also used by game code)
     * @param {boolean} [options.lowSpec]
     */
    constructor({ scene, nav, pedestrians, lowSpec = false }) {
        this.scene = scene;
        this.nav = nav;
        this.pedestrians = pedestrians;
        this.lowSpec = lowSpec;
        const scale = lowSpec ? PED_CONFIG.LOW_SPEC_SCALE : 1;
        this.targets = {
            walkers: Math.round(PED_CONFIG.WALKERS * scale),
            sitters: Math.round(PED_CONFIG.SITTERS * scale),
            groupPeople: Math.round(PED_CONFIG.GROUP_PEOPLE * scale)
        };
        this.renderer = new PedestrianRenderer(scene, PED_CONFIG.CAPACITY, lowSpec);
        this.furniture = nav ? new FurnitureRenderer(scene, nav, lowSpec) : null;

        this.seatOccupant = nav ? new Array(nav.seatCount).fill(null) : [];
        this.hangoutGroup = new Map(); // hangout spot -> group
        this.groups = new Set();

        // Pedestrians on a crosswalk right now ({x, z}), handed to traffic so cars stop for them
        this.crossingObstacles = [];
        this._obstaclePool = [];

        this._nextIndex = 0;
        this._time = 0;
        this._popTimer = 0;
        this._lastCenter = null;
        this._pathBudget = 0;
        this._cars = [];
        this._carPool = [];
        this._ring = [];
        this._rand = Math.random;
    }

    // --------------------------------------------------------------------------------------------
    // Creation
    // --------------------------------------------------------------------------------------------
    /** A pedestrian rig (THREE.Group transform hierarchy) with a randomized look. */
    createPedestrianMesh(seed = (Math.random() * 1e9) | 0, options = {}) {
        const group = new THREE.Group();
        group.name = options.police ? `police_officer_${seed}` : `pedestrian_${seed}`;
        group.userData.isPedestrian = !options.police;
        group.userData.isPoliceOfficer = !!options.police;
        const look = options.police ? makePoliceLook(seed) : makeLook(seed);
        const rig = buildRig(group, look);
        group.userData.rig = rig;
        group.userData.look = look;
        // Legacy handles used by the shared ragdoll solver and carjacking animation
        group.userData.leftLeg = rig.legL;
        group.userData.rightLeg = rig.legR;
        group.userData.pistol = rig.pistol;
        return group;
    }

    /** Officer body for PoliceSystem (see PoliceSystem.createOfficerMesh). */
    createPoliceOfficerMesh(seed) {
        return this.createPedestrianMesh((seed * 104729 + 7) | 0, { police: true });
    }

    _makePed(x, z, yaw) {
        const index = this._nextIndex++;
        const mesh = this.createPedestrianMesh(index * 7919 + ((Math.random() * 1e6) | 0));
        mesh.position.set(x, 0, z);
        mesh.rotation.set(0, yaw, 0);
        const ped = {
            id: `ped_${index}`,
            index,
            mesh,
            position: mesh.position,
            velocity: new THREE.Vector3(),
            speed: 0.06,
            state: 'walking',
            hp: 100,
            maxHp: 100,
            isDead: false,
            walkPhase: Math.random() * TWO_PI,
            fleeTimer: 0,
            talkTimer: 0,
            talkCount: 0
        };
        mesh.userData.pedestrian = ped;
        this._initAI(ped);
        ped.ai.yaw = yaw;
        this.pedestrians.push(ped);
        return ped;
    }

    _initAI(ped) {
        const r = Math.random();
        const jogger = r < 0.07;
        ped.ai = {
            yaw: ped.mesh.rotation.y,
            walkSpeed: jogger ? PED_CONFIG.JOG_SPEED * (0.9 + Math.random() * 0.2)
                : PED_CONFIG.WALK_SPEED_MIN + Math.random() * (PED_CONFIG.WALK_SPEED_MAX - PED_CONFIG.WALK_SPEED_MIN),
            jogger,
            phone: !jogger && Math.random() < 0.15,
            laneOffset: 0.35 + Math.random() * 0.35,
            path: null,
            pathIdx: 0,
            goal: null,
            stops: null,
            stopIdx: 0,
            direct: null,
            seat: -1,
            group: null,
            timer: 0,
            pose: 'stand',
            moveSpeed: 0,
            crossA: -1,
            crossB: -1,
            safeTime: 0,
            waitTime: 0,
            hurry: false,
            look: 0,
            lookPitch: 0,
            speaking: false,
            crossArms: Math.random() < 0.25,
            // Roughly a third of people put their fists up and fight back when punched
            fighter: Math.random() < 0.35,
            flinch: 0,
            flinchSide: 0,
            punching: 0,
            punchArm: 1,
            punchCd: 0,
            fightTime: 0,
            hitThisSwing: false,
            lastState: ped.state,
            resumeState: null,
            deadPosed: false,
            seed: Math.random() * 100
        };
        if (!ped.velocity) ped.velocity = new THREE.Vector3();
    }

    // --------------------------------------------------------------------------------------------
    // Frame update
    // --------------------------------------------------------------------------------------------
    /**
     * @param {number} dt
     * @param {Object} ctx
     * @param {{x:number,z:number}} ctx.center Player/camera position for population and rendering
     * @param {{x:number,z:number}} [ctx.viewDir] Horizontal camera forward
     * @param {{x:number,z:number}} [ctx.playerPos] On-foot player position (for talking/avoidance)
     * @param {boolean} [ctx.playerOnFoot]
     * @param {Array} [ctx.vehicles] Every car that pedestrians should watch out for
     */
    update(dt, ctx) {
        this._time += dt;
        this._pathBudget = PED_CONFIG.PATHS_PER_FRAME;
        this._collectCars(ctx.vehicles, ctx.center);

        if (this.nav) {
            this._popTimer -= dt;
            if (this._popTimer <= 0) {
                this._popTimer = PED_CONFIG.POPULATION_INTERVAL;
                this._maintainPopulation(ctx);
            }
            this.furniture.update(ctx.center.x, ctx.center.z);
        }

        const peds = this.pedestrians;
        for (let i = 0; i < peds.length; i++) {
            const ped = peds[i];
            if (ped.isPoliceOfficer) continue;
            if (!ped.ai) this._initAI(ped);
            const ai = ped.ai;

            if (ped.state === 'dying') {
                this._releaseActivity(ped);
                this._updateDying(ped, dt);
                ai.lastState = ped.state;
                continue;
            }
            if (ped.state === 'ragdoll' || ped.isDead) {
                this._releaseActivity(ped);
                if (ped.death) this._updateDeathMotion(ped, dt);
                else if (ped.state === 'dead' && !ai.deadPosed) this._poseDead(ped);
                ai.lastState = ped.state;
                continue;
            }
            if (ped.state === 'carjacked') {
                ai.lastState = ped.state;
                continue;
            }

            // States set from outside (dialog, gunfire panic) interrupt whatever the ped was doing
            if (ped.state !== ai.lastState) {
                if (ped.state === 'talking') {
                    ai.resumeState = (ai.lastState === 'sitting' || ai.lastState === 'hanging_out') ? ai.lastState : 'walking';
                } else if (ped.state === 'fleeing') {
                    this._releaseActivity(ped);
                    ai.path = null;
                    ai.direct = null;
                }
            }

            switch (ped.state) {
                case 'talking': this._updateTalking(ped, dt, ctx); break;
                case 'fleeing': this._updateFleeing(ped, dt); break;
                case 'sitting': this._updateSitting(ped, dt); break;
                case 'hanging_out': this._updateHanging(ped, dt); break;
                case 'waiting_to_cross': this._updateWaiting(ped, dt); break;
                case 'idle': this._updateIdle(ped, dt); break;
                case 'fighting': this._updateFighting(ped, dt, ctx); break;
                default: this._updateWalking(ped, dt); break;
            }
            if (ped.state !== 'fleeing' && ped.state !== 'sitting') this._dodgeCars(ped);
            ai.lastState = ped.state;
        }

        this._separate(ctx);
        for (let i = 0; i < peds.length; i++) {
            const ped = peds[i];
            if (ped.ai && !ped.isDead && ped.state !== 'ragdoll' && ped.state !== 'carjacked' && !ped.isPoliceOfficer) {
                this._animate(ped, dt);
            }
        }
        this._updateOfficers(ctx.officers, dt);
        this._collectCrossingObstacles();
        this.renderer.render(peds, ctx.center.x, ctx.center.z, PED_CONFIG.RENDER_DISTANCE, ctx.officers);
    }

    /** Police officers on foot (moved by police.js): running/aiming poses and procedural deaths. */
    _updateOfficers(officers, dt) {
        if (!officers) return;
        for (let i = 0; i < officers.length; i++) {
            const off = officers[i];
            const rig = off.mesh && off.mesh.userData.rig;
            if (!rig) continue;
            if (!off.ai) {
                this._initAI(off);
                off.ai.prevX = off.position.x;
                off.ai.prevZ = off.position.z;
            }
            const ai = off.ai;
            if (off.state === 'dying') {
                this._updateDying(off, dt);
                continue;
            }
            if (off.state === 'ragdoll' || off.isDead) {
                if (off.death) this._updateDeathMotion(off, dt);
                else if (!ai.deadPosed) this._poseDead(off);
                continue;
            }
            // police.js turns the officer to face the player each frame
            ai.yaw = off.mesh.rotation.y;
            const moved = Math.hypot(off.position.x - ai.prevX, off.position.z - ai.prevZ);
            ai.prevX = off.position.x;
            ai.prevZ = off.position.z;
            ai.moveSpeed = ai.moveSpeed * 0.8 + (dt > 0 ? moved / dt : 0) * 0.2;
            ai.pose = ai.moveSpeed > 0.6 ? 'run' : 'stand';
            ai.phone = false;
            ai.speaking = false;
            ai.look = 0;
            this._animate(off, dt);
            // Gun up: two-handed aim when standing, gun arm half-raised while running
            if (ai.pose === 'run') {
                rig.shoulderR.rotation.set(-1.0, 0, 0.1);
                rig.elbowR.rotation.set(-0.5, 0, 0);
            } else {
                rig.shoulderR.rotation.set(-1.52, 0, 0.18);
                rig.elbowR.rotation.set(-0.05, 0, 0);
                rig.shoulderL.rotation.set(-1.38, 0, -0.5);
                rig.elbowL.rotation.set(-0.35, 0, 0);
            }
        }
    }

    _collectCars(vehicles, center) {
        const cars = this._cars;
        cars.length = 0;
        if (!vehicles) return;
        const range = PED_CONFIG.RENDER_DISTANCE + PED_CONFIG.CAR_SIGHT_RANGE;
        for (let i = 0; i < vehicles.length; i++) {
            const v = vehicles[i];
            if (!v || !v.position) continue;
            if (v.isPlane && v.position.y > 1.5) continue;
            if (Math.abs(v.position.x - center.x) > range || Math.abs(v.position.z - center.z) > range) continue;
            const yaw = typeof v.getYaw === 'function' ? v.getYaw() : (v.yaw || 0);
            const spd = typeof v.getSpeed === 'function' ? v.getSpeed() : (v.speed || 0);
            const sign = spd >= 0 ? 1 : -1;
            let c = this._carPool[cars.length];
            if (!c) {
                c = { x: 0, z: 0, fx: 0, fz: 0, speed: 0 };
                this._carPool[cars.length] = c;
            }
            c.x = v.position.x;
            c.z = v.position.z;
            c.fx = -Math.sin(yaw) * sign;
            c.fz = -Math.cos(yaw) * sign;
            c.speed = Math.abs(spd);
            cars.push(c);
        }
    }

    _collectCrossingObstacles() {
        const out = this.crossingObstacles;
        out.length = 0;
        const peds = this.pedestrians;
        for (let i = 0; i < peds.length; i++) {
            const ped = peds[i];
            if (ped.state !== 'crossing' || ped.isDead) continue;
            let o = this._obstaclePool[out.length];
            if (!o) {
                o = { x: 0, z: 0 };
                this._obstaclePool[out.length] = o;
            }
            o.x = ped.mesh.position.x;
            o.z = ped.mesh.position.z;
            out.push(o);
        }
    }

    // --------------------------------------------------------------------------------------------
    // Movement helpers
    // --------------------------------------------------------------------------------------------
    _turnTowards(ped, targetYaw, dt, rate = PED_CONFIG.TURN_RATE) {
        const ai = ped.ai;
        const d = angleDiff(ai.yaw, targetYaw);
        const step = rate * dt;
        ai.yaw += Math.abs(d) <= step ? d : Math.sign(d) * step;
        ped.mesh.rotation.set(0, ai.yaw, 0);
    }

    /** Moves towards (tx, tz); returns true once within `arrive` metres. */
    _moveTo(ped, tx, tz, speed, dt, arrive = 0.5) {
        const p = ped.mesh.position;
        const dx = tx - p.x, dz = tz - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= arrive) {
            ped.ai.moveSpeed = 0;
            return true;
        }
        const step = Math.min(dist, speed * dt);
        p.x += (dx / dist) * step;
        p.z += (dz / dist) * step;
        p.y = 0;
        this._turnTowards(ped, Math.atan2(dx, dz), dt);
        ped.ai.moveSpeed = speed;
        return dist - step <= arrive;
    }

    _currentNode(ped, maxDist = 60) {
        const p = ped.mesh.position;
        return this.nav.nearestWalkNode(p.x, p.z, maxDist);
    }

    // --------------------------------------------------------------------------------------------
    // Routes
    // --------------------------------------------------------------------------------------------
    _pickStops(ped, homeNode) {
        const nav = this.nav;
        const stops = [homeNode];
        const hx = nav.nodeX[homeNode], hz = nav.nodeZ[homeNode];
        nav.walkNodesInRing(hx, hz, PED_CONFIG.ROUTE_MIN, PED_CONFIG.ROUTE_MAX, this._ring);
        const n = Math.random() < 0.5 ? 1 : 2;
        for (let k = 0; k < n && this._ring.length > 0; k++) {
            stops.push(this._ring[(Math.random() * this._ring.length) | 0]);
        }
        ped.ai.stops = stops;
        ped.ai.stopIdx = stops.length > 1 ? 1 : 0;
    }

    /** Plans a path to the current goal. Returns false if planning must wait for budget. */
    _planPath(ped, goalNode) {
        if (this._pathBudget <= 0) return false;
        this._pathBudget--;
        const ai = ped.ai;
        const start = this._currentNode(ped);
        if (start < 0) {
            ai.path = [];
            ai.pathIdx = 0;
            return true;
        }
        const path = this.nav.findPath(start, goalNode);
        ai.path = path || [];
        ai.pathIdx = 0;
        return true;
    }

    _nextStop(ped) {
        const ai = ped.ai;
        if (!ai.stops || ai.stops.length < 2) {
            const home = this._currentNode(ped);
            if (home < 0) return -1;
            this._pickStops(ped, home);
            if (ai.stops.length < 2) return -1;
        }
        const stop = ai.stops[ai.stopIdx];
        ai.stopIdx = (ai.stopIdx + 1) % ai.stops.length;
        return stop;
    }

    // --------------------------------------------------------------------------------------------
    // States
    // --------------------------------------------------------------------------------------------
    _updateWalking(ped, dt) {
        const ai = ped.ai;
        const nav = this.nav;
        if (ped.state === 'crossing' && ai.crossA < 0) ped.state = 'walking';
        const crossing = ped.state === 'crossing';
        let speed = ai.walkSpeed * (crossing ? 1.1 : 1);
        if (crossing && ai.hurry) speed = Math.max(speed, 3.6);
        ai.pose = (ai.jogger || (crossing && ai.hurry)) ? 'run' : 'walk';

        if (!nav) {
            this._wanderWithoutNav(ped, dt);
            return;
        }

        // Off-graph legs: onto a seat, into a group, or back to the sidewalk
        if (ai.direct) {
            const d = ai.direct;
            if (this._moveTo(ped, d.x, d.z, Math.min(speed, 1.4), dt, 0.25)) {
                ai.direct = null;
                if (d.then === 'sit') this._sit(ped, d.seat);
                else if (d.then === 'join') this._arriveAtGroup(ped);
                else ai.path = null;
            }
            return;
        }

        if (!ai.path) {
            if (!ai.goal) ai.goal = { type: 'stop', node: this._nextStop(ped) };
            const goalNode = ai.goal.type === 'stop' ? ai.goal.node : ai.goal.access;
            if (goalNode < 0) {
                this._becomeIdle(ped, 2 + Math.random() * 3);
                return;
            }
            if (!this._planPath(ped, goalNode)) {
                ai.moveSpeed = 0;
                ai.pose = 'stand';
                return;
            }
            if (ai.path.length === 0) {
                // Unreachable: pick a fresh route next time
                ai.stops = null;
                ai.goal = null;
                ai.path = null;
                this._becomeIdle(ped, 1 + Math.random() * 2);
                return;
            }
        }

        if (ai.pathIdx >= ai.path.length) {
            this._arriveAtGoal(ped);
            return;
        }

        const node = ai.path[ai.pathIdx];
        const prev = ai.pathIdx > 0 ? ai.path[ai.pathIdx - 1] : -1;
        let tx = nav.nodeX[node], tz = nav.nodeZ[node];
        if (prev >= 0 && !crossing) {
            // Keep to the right-hand side of the sidewalk
            const ex = tx - nav.nodeX[prev], ez = tz - nav.nodeZ[prev];
            const el = Math.hypot(ex, ez) || 1;
            tx += (-ez / el) * ai.laneOffset;
            tz += (ex / el) * ai.laneOffset;
        }

        if (crossing) {
            // Hurry if a car turns up while we're in the road
            ai.hurry = ai.hurry || this._crossingThreat(nav.nodeX[ai.crossA], nav.nodeZ[ai.crossA], nav.nodeX[ai.crossB], nav.nodeZ[ai.crossB], speed, 0.4) !== null;
        }

        if (this._moveTo(ped, tx, tz, speed, dt, crossing ? 0.35 : 0.6)) {
            if (crossing && node === ai.crossB) {
                ped.state = 'walking';
                ai.hurry = false;
                ai.crossA = ai.crossB = -1;
            }
            ai.pathIdx++;
            if (ai.pathIdx < ai.path.length) {
                const next = ai.path[ai.pathIdx];
                if (nav.edgeKind(node, next) === WALK_EDGE.CROSSING) {
                    ped.state = 'waiting_to_cross';
                    ai.crossA = node;
                    ai.crossB = next;
                    ai.safeTime = 0;
                    ai.waitTime = 0;
                }
            }
        }
    }

    _arriveAtGoal(ped) {
        const ai = ped.ai;
        const goal = ai.goal;
        ai.path = null;
        ai.goal = null;
        const nav = this.nav;
        if (goal && goal.type === 'seat') {
            if (this.seatOccupant[goal.seat] === ped) {
                // Walk up to the front of the seat, then sit
                const yaw = nav.seatYaw[goal.seat];
                ai.direct = {
                    x: nav.seatX[goal.seat] + Math.sin(yaw) * 0.45,
                    z: nav.seatZ[goal.seat] + Math.cos(yaw) * 0.45,
                    then: 'sit',
                    seat: goal.seat
                };
                return;
            }
        } else if (goal && goal.type === 'group') {
            const g = goal.group;
            if (this.groups.has(g) && g.members.includes(ped)) {
                const slot = this._slotPosition(g, g.members.indexOf(ped));
                ai.direct = { x: slot.x, z: slot.z, then: 'join' };
                return;
            }
        }

        // Reached a route stop: maybe sit down or join a group nearby, otherwise pause and move on
        const p = ped.mesh.position;
        const roll = Math.random();
        if (roll < 0.3 && this._goToSeatNear(ped, p.x, p.z)) return;
        if (roll >= 0.3 && roll < 0.5 && this._goToGroupNear(ped, p.x, p.z)) return;
        this._becomeIdle(ped, 1.5 + Math.random() * 4);
    }

    _becomeIdle(ped, seconds) {
        ped.state = 'idle';
        ped.ai.timer = seconds;
        ped.ai.moveSpeed = 0;
    }

    _updateIdle(ped, dt) {
        const ai = ped.ai;
        ai.pose = 'stand';
        ai.moveSpeed = 0;
        ai.timer -= dt;
        ai.look = Math.sin(this._time * 0.8 + ai.seed) * 0.7;
        if (ai.timer <= 0) {
            ped.state = 'walking';
            ai.look = 0;
        }
    }

    _wanderWithoutNav(ped, dt) {
        // Without nav data people just stroll back and forth where they stand
        const ai = ped.ai;
        if (!ai.home) ai.home = { x: ped.mesh.position.x, z: ped.mesh.position.z, dir: 1 };
        const tx = ai.home.x + Math.sin(ai.seed) * 12 * ai.home.dir;
        const tz = ai.home.z + Math.cos(ai.seed) * 12 * ai.home.dir;
        if (this._moveTo(ped, tx, tz, ai.walkSpeed, dt, 0.5)) ai.home.dir *= -1;
    }

    // ---- Crossing the street ----
    /**
     * Returns the first car that would reach the crossing a-b before a pedestrian walking at
     * `speed` gets across (or that is parked across it), or null if the road is clear.
     */
    _crossingThreat(ax, az, bx, bz, speed, margin = 1.2) {
        const L = Math.hypot(bx - ax, bz - az) || 1;
        const mx = (ax + bx) * 0.5, mz = (az + bz) * 0.5;
        const crossTime = L / Math.max(0.5, speed) + margin;
        const sight = PED_CONFIG.CAR_SIGHT_RANGE;
        const cars = this._cars;
        for (let i = 0; i < cars.length; i++) {
            const c = cars[i];
            const rx = mx - c.x, rz = mz - c.z;
            if (Math.abs(rx) > sight || Math.abs(rz) > sight) continue;
            if (c.speed < 0.8) {
                // Stopped cars only matter if they're sitting on the crosswalk
                const ex = bx - ax, ez = bz - az;
                let t = ((c.x - ax) * ex + (c.z - az) * ez) / (L * L);
                t = Math.max(0, Math.min(1, t));
                if (Math.hypot(c.x - (ax + ex * t), c.z - (az + ez * t)) < 2.4) return c;
                continue;
            }
            const along = rx * c.fx + rz * c.fz;
            if (along < -4) continue; // already past
            const lateral = Math.abs(rx * c.fz - rz * c.fx);
            if (lateral > L * 0.5 + 2.5) continue; // its path misses the crosswalk
            const eta = Math.max(0, along - 3) / c.speed;
            if (eta < crossTime + 1.0) return c;
        }
        return null;
    }

    _updateWaiting(ped, dt) {
        const ai = ped.ai;
        const nav = this.nav;
        const ax = nav.nodeX[ai.crossA], az = nav.nodeZ[ai.crossA];
        const bx = nav.nodeX[ai.crossB], bz = nav.nodeZ[ai.crossB];
        ai.pose = 'stand';
        ai.moveSpeed = 0;
        const faceYaw = Math.atan2(bx - ax, bz - az);
        this._turnTowards(ped, faceYaw, dt);
        ai.waitTime += dt;

        const threat = this._crossingThreat(ax, az, bx, bz, ai.walkSpeed * 1.1);
        if (threat) {
            ai.safeTime = 0;
            // Watch the approaching car
            const toCar = Math.atan2(threat.x - ped.mesh.position.x, threat.z - ped.mesh.position.z);
            ai.look = Math.max(-1.3, Math.min(1.3, angleDiff(ai.yaw, toCar)));
        } else {
            ai.safeTime += dt;
            // Look left, then right, before stepping off the curb
            ai.look = Math.sin(ai.waitTime * 3.2) * 1.1;
            if (ai.safeTime >= PED_CONFIG.CROSS_SAFE_TIME + (ai.seed % 1) * 0.6) {
                ped.state = 'crossing';
                ai.look = 0;
                ai.hurry = false;
                return;
            }
        }
        if (ai.waitTime > PED_CONFIG.CROSS_GIVE_UP) {
            // Give up on this crossing and go somewhere else
            ped.state = 'walking';
            ai.look = 0;
            ai.path = null;
            ai.goal = null;
            ai.stops = null;
        }
    }

    _dodgeCars(ped) {
        // Jump out of the way of a car bearing down on us
        const p = ped.mesh.position;
        const cars = this._cars;
        for (let i = 0; i < cars.length; i++) {
            const c = cars[i];
            if (c.speed < 4) continue;
            const rx = p.x - c.x, rz = p.z - c.z;
            if (Math.abs(rx) > 14 || Math.abs(rz) > 14) continue;
            const along = rx * c.fx + rz * c.fz;
            if (along < 0 || along / c.speed > 0.9) continue;
            const lateral = rx * c.fz - rz * c.fx;
            if (Math.abs(lateral) > 1.8) continue;
            const side = lateral >= 0 ? 1 : -1;
            this._releaseActivity(ped);
            ped.state = 'fleeing';
            ped.fleeTimer = 50;
            ped.speed = 0.13;
            ped.velocity.set(c.fz * side * ped.speed, 0, -c.fx * side * ped.speed);
            ped.ai.path = null;
            ped.ai.direct = null;
            return;
        }
    }

    _updateFleeing(ped, dt) {
        const ai = ped.ai;
        const stepScale = dt / (1 / 60);
        ped.fleeTimer -= stepScale;
        const p = ped.mesh.position;
        p.x += ped.velocity.x * stepScale;
        p.z += ped.velocity.z * stepScale;
        p.y = 0;
        const vlen = Math.hypot(ped.velocity.x, ped.velocity.z);
        if (vlen > 1e-4) this._turnTowards(ped, Math.atan2(ped.velocity.x, ped.velocity.z), dt, 14);
        ai.pose = 'run';
        ai.moveSpeed = vlen * 60;
        if (ped.fleeTimer <= 0) {
            ped.state = 'walking';
            ped.speed = 0.06;
            ai.path = null;
            ai.goal = null;
            ai.stops = null;
            ai.direct = null;
        }
    }

    _updateTalking(ped, dt, ctx) {
        const ai = ped.ai;
        const stepScale = dt / (1 / 60);
        ped.talkTimer -= stepScale;
        const pp = ctx.playerPos || ctx.center;
        const p = ped.mesh.position;
        const toPlayer = Math.atan2(pp.x - p.x, pp.z - p.z);
        ai.moveSpeed = 0;
        if (ai.resumeState === 'sitting' && ai.seat >= 0) {
            // Stay seated, just turn to look at the player
            ai.yaw = this.nav.seatYaw[ai.seat];
            ped.mesh.rotation.set(0, ai.yaw, 0);
            ai.pose = 'sit';
            ai.look = Math.max(-1.2, Math.min(1.2, angleDiff(ai.yaw, toPlayer)));
        } else {
            this._turnTowards(ped, toPlayer, dt, 10);
            ai.pose = 'talk';
            ai.speaking = true;
            ai.look = 0;
        }
        if (ped.talkTimer <= 0 || Math.hypot(pp.x - p.x, pp.z - p.z) > 6.0) {
            ai.speaking = false;
            ai.look = 0;
            const resume = ai.resumeState;
            if (resume === 'sitting' && ai.seat >= 0) ped.state = 'sitting';
            else if (resume === 'hanging_out' && ai.group) ped.state = 'hanging_out';
            else {
                this._releaseActivity(ped);
                ped.state = 'walking';
                ai.path = null;
            }
        }
    }

    // ---- Seats ----
    _goToSeatNear(ped, x, z) {
        const nav = this.nav;
        const seats = nav.seatsInRing(x, z, 0, PED_CONFIG.SEAT_SEARCH_RADIUS, this._ring);
        let best = -1, bestD = Infinity;
        for (let i = 0; i < seats.length; i++) {
            const s = seats[i];
            if (this.seatOccupant[s]) continue;
            const d = Math.hypot(nav.seatX[s] - x, nav.seatZ[s] - z) + Math.random() * 10;
            if (d < bestD) {
                bestD = d;
                best = s;
            }
        }
        if (best < 0) return false;
        this.seatOccupant[best] = ped;
        ped.ai.seat = best;
        ped.ai.goal = { type: 'seat', seat: best, access: nav.seatAccess[best] };
        ped.ai.path = null;
        ped.state = 'walking';
        return true;
    }

    _sit(ped, seat) {
        const nav = this.nav;
        const ai = ped.ai;
        if (this.seatOccupant[seat] !== ped) {
            ai.seat = -1;
            ped.state = 'walking';
            return;
        }
        const yaw = nav.seatYaw[seat];
        ped.mesh.position.set(nav.seatX[seat] - Math.sin(yaw) * 0.1, 0, nav.seatZ[seat] - Math.cos(yaw) * 0.1);
        ai.yaw = yaw;
        ped.mesh.rotation.set(0, yaw, 0);
        ai.seat = seat;
        ai.timer = 25 + Math.random() * 90;
        ai.pose = 'sit';
        ai.moveSpeed = 0;
        ped.state = 'sitting';
    }

    _updateSitting(ped, dt) {
        const ai = ped.ai;
        const nav = this.nav;
        ai.pose = 'sit';
        ai.moveSpeed = 0;
        ai.timer -= dt;
        if (ai.seat < 0 || !nav) {
            ped.state = 'walking';
            return;
        }
        // Chat with whoever shares the table/bench, otherwise people-watch
        const cluster = nav.seatCluster[ai.seat];
        let buddy = null;
        nav.seatGrid.forEachNear(nav.seatX[ai.seat], nav.seatZ[ai.seat], 3, (s) => {
            if (s !== ai.seat && nav.seatCluster[s] === cluster && this.seatOccupant[s] && this.seatOccupant[s].state === 'sitting') {
                buddy = this.seatOccupant[s];
            }
        });
        if (buddy) {
            const bp = buddy.mesh.position, p = ped.mesh.position;
            const to = Math.atan2(bp.x - p.x, bp.z - p.z);
            ai.look = Math.max(-1.2, Math.min(1.2, angleDiff(ai.yaw, to)));
            ai.speaking = Math.sin(this._time * 0.35 + ai.seed * 3) > 0.2;
        } else {
            ai.look = Math.sin(this._time * 0.25 + ai.seed) * 0.8;
            ai.speaking = false;
        }
        if (ai.timer <= 0) this._standUp(ped);
    }

    _standUp(ped) {
        const ai = ped.ai;
        const nav = this.nav;
        const seat = ai.seat;
        this._releaseActivity(ped);
        ai.speaking = false;
        ai.look = 0;
        ped.state = 'walking';
        ai.goal = null;
        ai.stops = null;
        if (seat >= 0 && nav) {
            // Step forward off the seat, then head back to the sidewalk
            const yaw = nav.seatYaw[seat];
            ped.mesh.position.x += Math.sin(yaw) * 0.45;
            ped.mesh.position.z += Math.cos(yaw) * 0.45;
            const acc = nav.seatAccess[seat];
            ai.direct = { x: nav.nodeX[acc], z: nav.nodeZ[acc], then: 'resume' };
        }
    }

    // ---- Groups hanging out ----
    _createGroup(spot) {
        const nav = this.nav;
        const g = {
            spot,
            x: nav.hangX[spot],
            z: nav.hangZ[spot],
            members: [],
            maxSize: 3 + ((Math.random() * 3) | 0),
            angle0: Math.random() * TWO_PI,
            speaker: null,
            speakerTimer: 0
        };
        this.groups.add(g);
        this.hangoutGroup.set(spot, g);
        return g;
    }

    _slotPosition(g, i) {
        const n = Math.max(2, g.members.length);
        const a = g.angle0 + (i / n) * TWO_PI;
        const r = 0.5 + 0.17 * n;
        return { x: g.x + Math.sin(a) * r, z: g.z + Math.cos(a) * r };
    }

    _goToGroupNear(ped, x, z) {
        const nav = this.nav;
        let best = null, bestD = Infinity;
        for (const g of this.groups) {
            if (g.members.length >= g.maxSize) continue;
            const d = Math.hypot(g.x - x, g.z - z);
            if (d < PED_CONFIG.GROUP_SEARCH_RADIUS && d < bestD) {
                bestD = d;
                best = g;
            }
        }
        if (!best) {
            // Start a new hangout on a free patch of grass nearby
            const spots = nav.hangoutsInRing(x, z, 0, PED_CONFIG.GROUP_SEARCH_RADIUS, this._ring);
            for (let i = 0; i < spots.length; i++) {
                if (!this.hangoutGroup.has(spots[i])) {
                    best = this._createGroup(spots[i]);
                    break;
                }
            }
        }
        if (!best) return false;
        best.members.push(ped);
        ped.ai.group = best;
        ped.ai.goal = { type: 'group', group: best, access: nav.hangAccess[best.spot] };
        ped.ai.path = null;
        ped.state = 'walking';
        return true;
    }

    _arriveAtGroup(ped) {
        const ai = ped.ai;
        if (!ai.group || !this.groups.has(ai.group)) {
            ped.state = 'walking';
            ai.group = null;
            return;
        }
        ped.state = 'hanging_out';
        ai.timer = 40 + Math.random() * 150;
        ai.moveSpeed = 0;
    }

    _updateHanging(ped, dt) {
        const ai = ped.ai;
        const g = ai.group;
        if (!g || !this.groups.has(g)) {
            ped.state = 'walking';
            ai.group = null;
            return;
        }
        ai.timer -= dt;

        // Rotate who's doing the talking
        if (g.speaker === ped || !g.speaker || !g.members.includes(g.speaker)) {
            g.speakerTimer -= dt;
            if (g.speakerTimer <= 0 || !g.speaker || !g.members.includes(g.speaker)) {
                g.speaker = g.members[(Math.random() * g.members.length) | 0];
                g.speakerTimer = 3 + Math.random() * 5;
            }
        }
        ai.speaking = g.speaker === ped;

        const idx = g.members.indexOf(ped);
        const slot = this._slotPosition(g, idx);
        const p = ped.mesh.position;
        if (Math.hypot(slot.x - p.x, slot.z - p.z) > 0.12) {
            this._moveTo(ped, slot.x, slot.z, 0.9, dt, 0.08);
            ai.pose = 'walk';
        } else {
            ai.moveSpeed = 0;
            ai.pose = 'talk';
            const toCentre = Math.atan2(g.x - p.x, g.z - p.z);
            this._turnTowards(ped, toCentre, dt, 3);
            if (!ai.speaking && g.speaker) {
                const sp = g.speaker.mesh.position;
                ai.look = Math.max(-1.1, Math.min(1.1, angleDiff(ai.yaw, Math.atan2(sp.x - p.x, sp.z - p.z))));
            } else {
                ai.look = Math.sin(this._time * 0.9 + ai.seed) * 0.35;
            }
        }

        if (ai.timer <= 0) {
            const acc = this.nav.hangAccess[g.spot];
            this._releaseActivity(ped);
            ped.state = 'walking';
            ai.speaking = false;
            ai.look = 0;
            ai.goal = null;
            ai.stops = null;
            ai.direct = { x: this.nav.nodeX[acc], z: this.nav.nodeZ[acc], then: 'resume' };
        }
    }

    _releaseActivity(ped) {
        const ai = ped.ai;
        if (!ai) return;
        if (ai.seat >= 0) {
            if (this.seatOccupant[ai.seat] === ped) this.seatOccupant[ai.seat] = null;
            ai.seat = -1;
        }
        if (ai.group) {
            const g = ai.group;
            const i = g.members.indexOf(ped);
            if (i >= 0) g.members.splice(i, 1);
            if (g.members.length === 0) {
                this.groups.delete(g);
                this.hangoutGroup.delete(g.spot);
            }
            ai.group = null;
        }
        if (ai.goal && (ai.goal.type === 'seat' || ai.goal.type === 'group')) ai.goal = null;
    }

    // --------------------------------------------------------------------------------------------
    // Separation (people don't walk through each other or the player)
    // --------------------------------------------------------------------------------------------
    _separate(ctx) {
        const peds = this.pedestrians;
        const n = peds.length;
        const movable = (p) => p.ai && !p.isDead && !p.isPoliceOfficer &&
            (p.state === 'walking' || p.state === 'crossing' || p.state === 'idle' || p.state === 'waiting_to_cross' || p.state === 'fighting');
        for (let i = 0; i < n; i++) {
            const a = peds[i];
            if (!movable(a)) continue;
            const pa = a.mesh.position;
            for (let j = i + 1; j < n; j++) {
                const b = peds[j];
                if (b.isDead || b.state === 'ragdoll' || !b.mesh) continue;
                const pb = b.mesh.position;
                const dx = pa.x - pb.x, dz = pa.z - pb.z;
                if (Math.abs(dx) > 0.6 || Math.abs(dz) > 0.6) continue;
                const d = Math.hypot(dx, dz);
                if (d >= 0.55 || d < 1e-4) continue;
                const push = (0.55 - d) * 0.5;
                const bMoves = movable(b);
                const sa = bMoves ? push : push * 2;
                pa.x += (dx / d) * sa;
                pa.z += (dz / d) * sa;
                if (bMoves) {
                    pb.x -= (dx / d) * push;
                    pb.z -= (dz / d) * push;
                }
            }
            if (ctx.playerOnFoot && ctx.playerPos) {
                const dx = pa.x - ctx.playerPos.x, dz = pa.z - ctx.playerPos.z;
                const d = Math.hypot(dx, dz);
                if (d < 0.7 && d > 1e-4) {
                    pa.x += (dx / d) * (0.7 - d);
                    pa.z += (dz / d) * (0.7 - d);
                }
            }
        }
    }

    // --------------------------------------------------------------------------------------------
    // Fist fights
    // --------------------------------------------------------------------------------------------
    /**
     * The player punched `ped`. Knocks them back and makes them flinch; fighters square up,
     * everyone else runs. Enough punches knock them out (procedural death, falling away from the punch).
     * @param {Object} hit { dirX, dirZ (punch direction), damage, y (impact height), x, z }
     * @returns {{ knockedOut: boolean }}
     */
    punchPed(ped, hit) {
        if (!ped || ped.isDead || ped.state === 'ragdoll' || ped.state === 'dying') return { knockedOut: false };
        if (!ped.ai) this._initAI(ped);
        const ai = ped.ai;
        ped.hp -= hit.damage;
        const p = ped.mesh.position;
        // Stagger back along the punch
        p.x += hit.dirX * 0.22;
        p.z += hit.dirZ * 0.22;
        ai.flinch = 1;
        ai.flinchSide = Math.random() < 0.5 ? 1 : -1;
        ai.punching = 0; // a hit interrupts their own swing
        if (ped.hp <= 0) {
            if (ped.isPoliceOfficer) return { knockedOut: true }; // police.js handles officers
            this.startShotDeath(ped, { x: hit.x, y: hit.y !== undefined ? hit.y : p.y + 1.6, z: hit.z, dirX: hit.dirX, dirY: 0, dirZ: hit.dirZ });
            return { knockedOut: true };
        }
        if (ped.isPoliceOfficer) return { knockedOut: false };
        this._releaseActivity(ped);
        ai.direct = null;
        ai.path = null;
        if (ai.fighter) {
            ped.state = 'fighting';
            ai.fightTime = 0;
            ai.punchCd = 0.5 + Math.random() * 0.5;
        } else {
            ped.state = 'fleeing';
            ped.fleeTimer = 240;
            ped.speed = 0.17;
            ped.velocity.set(hit.dirX * ped.speed, 0, hit.dirZ * ped.speed);
        }
        return { knockedOut: false };
    }

    _updateFighting(ped, dt, ctx) {
        const ai = ped.ai;
        const pp = ctx.playerPos;
        ai.fightTime += dt;
        if (!pp || !ctx.playerOnFoot) {
            ped.state = 'walking';
            ai.punching = 0;
            return;
        }
        const p = ped.mesh.position;
        const dx = pp.x - p.x, dz = pp.z - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 18 || ai.fightTime > 45) {
            // Lost interest
            ped.state = 'walking';
            ai.punching = 0;
            return;
        }
        this._turnTowards(ped, Math.atan2(dx, dz), dt, 10);
        ai.look = 0;
        if (dist > 1.05 && ai.punching <= 0) {
            // Close the distance, guard up
            const step = Math.min(dist - 1.0, 2.6 * dt);
            p.x += (dx / dist) * step;
            p.z += (dz / dist) * step;
            ai.moveSpeed = 2.6;
            ai.pose = dist > 3 ? 'run' : 'fight';
        } else {
            ai.moveSpeed = 0;
            ai.pose = 'fight';
        }
        p.y = 0;

        // Throw punches: wind up, strike, recover
        ai.punchCd -= dt;
        if (ai.punching <= 0 && ai.punchCd <= 0 && dist < 1.6 && ai.flinch < 0.3) {
            ai.punching = 0.0001;
            ai.punchArm = -ai.punchArm;
            ai.hitThisSwing = false;
        }
        if (ai.punching > 0) {
            ai.punching += dt;
            if (!ai.hitThisSwing && ai.punching >= 0.24) {
                ai.hitThisSwing = true;
                if (dist < 1.55 && typeof ctx.onPlayerHit === 'function') ctx.onPlayerHit(ped, 7 + Math.random() * 6);
            }
            if (ai.punching >= 0.5) {
                ai.punching = 0;
                ai.punchCd = 0.6 + Math.random() * 1.0;
            }
        }
    }

    // --------------------------------------------------------------------------------------------
    // Procedural deaths. Every joint is a damped spring chasing a target pose; the bullet's impact
    // (where it hit and from which way) kicks the springs, sets which hands clutch the wound,
    // how the body recoils, spins, stumbles and buckles, and so which way it finally falls. Smooth
    // per-joint noise, random twitches and a per-death personality (stiffness, wobble, energy)
    // mean no two deaths play the same. The body then hands off to the shared ragdoll solver
    // (game.html stepPedRagdoll) while the limbs keep flailing procedurally until it settles.
    // --------------------------------------------------------------------------------------------
    _deathChannels(rig) {
        // [joint, axis, min, max, noiseScale]
        const C = [
            ['torso', 'x', -0.7, 1.0, 0.25], ['torso', 'y', -0.9, 0.9, 0.3], ['torso', 'z', -0.6, 0.6, 0.2],
            ['neck', 'x', -0.9, 0.9, 0.45], ['neck', 'y', -1.2, 1.2, 0.6], ['neck', 'z', -0.5, 0.5, 0.3],
            ['shoulderL', 'x', -3.0, 1.2, 1.2], ['shoulderL', 'z', -0.7, 2.7, 1.0],
            ['shoulderR', 'x', -3.0, 1.2, 1.2], ['shoulderR', 'z', -2.7, 0.7, 1.0],
            ['elbowL', 'x', -2.4, 0.0, 0.9], ['elbowR', 'x', -2.4, 0.0, 0.9],
            ['legL', 'x', -1.7, 0.9, 0.25], ['legR', 'x', -1.7, 0.9, 0.25],
            ['legL', 'z', -0.25, 0.6, 0.1], ['legR', 'z', -0.6, 0.25, 0.1],
            ['kneeL', 'x', 0.0, 2.3, 0.3], ['kneeR', 'x', 0.0, 2.3, 0.3]
        ];
        const r = Math.random;
        return C.map(([j, axis, lo, hi, scale]) => ({
            key: j + axis.toUpperCase(),
            obj: rig[j],
            axis, lo, hi, scale,
            v: rig[j].rotation[axis],
            w: 0,
            stiff: 1,
            f1: 4 + r() * 10, p1: r() * 6.3,
            f2: 9 + r() * 16, p2: r() * 6.3
        }));
    }

    /** Builds the per-death state; `hit` = {x, y, z, dirX, dirY, dirZ}. */
    _makeDeath(ped, hit, kind) {
        const rig = ped.mesh.userData.rig;
        const ai = ped.ai;
        const p = ped.mesh.position;
        const r = Math.random;
        const rr = (a, b) => a + r() * (b - a);

        let dx = hit.dirX || 0, dz = hit.dirZ || 0;
        const dl = Math.hypot(dx, dz);
        if (dl < 1e-4) { dx = -Math.sin(ai.yaw); dz = -Math.cos(ai.yaw); } else { dx /= dl; dz /= dl; }
        // Body space: +Z is the ped's front, +X its left side
        const cy = Math.cos(ai.yaw), sy = Math.sin(ai.yaw);
        const localZ = dx * sy + dz * cy;
        const localX = dx * cy - dz * sy;
        const h = ped.mesh.scale.y || 1;
        const rel = ((hit.y !== undefined ? hit.y : p.y + 1.2) - p.y) / h;
        const hx = hit.x !== undefined ? hit.x - p.x : 0, hz = hit.z !== undefined ? hit.z - p.z : 0;
        const lat = Math.max(-0.3, Math.min(0.3, hx * cy - hz * sy)); // + = struck on the ped's left
        const side = Math.abs(lat) > 0.04 ? Math.sign(lat) : (r() < 0.5 ? 1 : -1);

        let zone = 'impact';
        if (kind === 'shot') {
            zone = rel > 1.5 ? 'head'
                : rel > 1.3 ? (Math.abs(lat) > 0.1 ? 'shoulder' : 'chest')
                : rel > 1.08 ? 'chest'
                : rel > 0.86 ? 'stomach'
                : rel > 0.7 ? 'pelvis' : 'leg';
        }

        // Personality of this particular death
        const prof = {
            k: rr(28, 85),                 // joint stiffness
            zeta: rr(0.22, 0.6),           // damping ratio (low = wobbly)
            agit0: rr(0.5, 1.5),           // flailing energy
            decay: rr(0.7, 2.2),
            twitchRate: rr(1.5, 8),
            twitch: rr(4, 13),
            flail: rr(0.4, 1.5),           // limb energy while falling
            deadTwitch: r() < 0.5
        };
        const standRange = {
            head: [0.1, 0.35], chest: [0.35, 0.9], shoulder: [0.4, 1.0],
            stomach: [0.45, 1.0], pelvis: [0.4, 0.9], leg: [0.35, 0.8], impact: [0, 0]
        }[zone];
        let standTime = rr(standRange[0], standRange[1]);
        if (zone !== 'impact' && r() < 0.1) standTime = 0.12; // sometimes they just drop

        // What each arm does. Mostly they flail wildly; now and then the wounded side grabs at the
        // wound (never the face), hangs limp, reaches out, or windmills for balance
        const wounded = side > 0 ? 'L' : 'R';
        const roles = { L: 'flail', R: 'flail' };
        const other = wounded === 'L' ? 'R' : 'L';
        if (zone === 'shoulder' && r() < 0.5) roles[wounded] = 'limp';
        else if ((zone === 'chest' || zone === 'stomach' || zone === 'pelvis' || zone === 'leg') && r() < 0.25) roles[wounded] = 'clutch';
        if (zone === 'leg' && r() < 0.5) roles[other] = 'balance';
        if (zone !== 'impact' && r() < 0.12) roles[other] = 'reach';

        const D = {
            kind, zone, side, lat, localX, localZ, rel,
            dirX: dx, dirZ: dz,
            t: 0, standTime, prof, roles, wounded,
            clutchDelay: { L: rr(0.12, 0.6), R: rr(0.15, 0.7) },
            kneel: (zone === 'stomach' || zone === 'pelvis' || zone === 'head') ? r() < 0.45 : r() < 0.15,
            ch: this._deathChannels(rig),
            chByKey: null,
            vx: 0, vz: 0, spin: 0,
            stepPhase: 0, nextStep: rr(0.2, 0.45), steps: (r() * 4) | 0,
            fallT: -1, restT: -1, done: false,
            fallRoles: null, splay: null,
            // Each flailing arm snaps between random poses, slowing down as the body weakens
            flail: { L: { tgt: [0, 0, 0], next: 0 }, R: { tgt: [0, 0, 0], next: 0 } },
            air: false
        };
        D.chByKey = {};
        for (const c of D.ch) D.chByKey[c.key] = c;
        for (const a of ['L', 'R']) {
            D.chByKey['shoulder' + a + 'X'].stiff = 1.5;
            D.chByKey['shoulder' + a + 'Z'].stiff = 1.5;
            D.chByKey['elbow' + a + 'X'].stiff = 1.6;
        }
        if (roles[wounded] === 'limp') D.chByKey['shoulder' + wounded + 'X'].stiff = 0.2;

        // ---- Impact: momentum and joint kicks from where the bullet struck ----
        const shove = { head: 0.6, chest: 1.5, shoulder: 1.0, stomach: 0.7, pelvis: 0.6, leg: 0.35, impact: 0 }[zone] * rr(0.6, 1.4);
        D.vx = dx * shove;
        D.vz = dz * shove;
        // Off-centre hits twist the body around (torque = r x F about the spine)
        // Off-centre hits only twist the body slightly; the shot mostly knocks it over
        D.spin = -lat * localZ * rr(2, 5);
        const arm = Math.max(0.1, rel - 0.92); // lever arm above the hips
        const K = D.chByKey;
        K.torsoX.w += localZ * arm * rr(10, 18);
        K.torsoZ.w += -localX * arm * rr(8, 14);
        K.torsoY.w += -lat * localZ * rr(3, 7);
        K.neckX.w += localZ * (zone === 'head' ? rr(14, 22) : rr(3, 7));
        K.neckZ.w += -localX * (zone === 'head' ? rr(8, 14) : rr(2, 5));
        for (const a of ['L', 'R']) {
            const near = a === wounded ? 1.5 : 1;
            K['shoulder' + a + 'X'].w += (r() - 0.6) * rr(8, 16) * near;
            K['shoulder' + a + 'Z'].w += (a === 'L' ? 1 : -1) * rr(2, 10) * near;
            K['elbow' + a + 'X'].w += -rr(2, 9);
        }
        if (zone === 'leg') {
            K['knee' + wounded + 'X'].w += rr(8, 14);
            K['leg' + wounded + 'X'].w += localZ * rr(4, 8);
        }
        return D;
    }

    /** Target pose for the current moment (written into `tgt` by channel key). */
    _deathTargets(ped, D, tgt) {
        const t = D.t;
        const zone = D.zone;
        for (const c of D.ch) tgt[c.key] = 0;
        tgt.elbowLX = tgt.elbowRX = -0.15;

        if (D.fallT < 0) {
            const s = Math.min(1, t / Math.max(0.1, D.standTime));
            const ease = s * s * (3 - 2 * s);
            // Torso: recoil settles into a zone-specific slump
            const hunch = { head: 0.1, chest: 0, shoulder: 0.05, stomach: 0.3, pelvis: 0.2, leg: 0.1 }[zone] || 0;
            tgt.torsoX = D.localZ * 0.6 * ease + hunch * ease;
            tgt.torsoZ = -D.localX * 0.45 * ease;
            tgt.torsoY = 0;
            tgt.neckX = zone === 'head' ? -0.4 + 1.1 * ease : 0.45 * ease;
            tgt.neckY = Math.sin(t * 2.3 + D.lat * 9) * 0.4;
            // Knees give way; leg wounds drop that side, some people sink to their knees
            const buckle = { head: 1.2, chest: 0.45, shoulder: 0.35, stomach: 0.7, pelvis: 0.9, leg: 0.4 }[zone] * ease;
            const kneel = D.kneel ? Math.max(0, (s - 0.35) / 0.65) : 0;
            tgt.kneeLX = 0.12 + buckle + kneel * 1.4 + (zone === 'leg' && D.wounded === 'L' ? 1.3 : 0);
            tgt.kneeRX = 0.12 + buckle + kneel * 1.4 + (zone === 'leg' && D.wounded === 'R' ? 1.3 : 0);
            tgt.legLX = -0.15 * buckle - kneel * 0.3 - (zone === 'leg' && D.wounded === 'L' ? 0.45 : 0);
            tgt.legRX = -0.15 * buckle - kneel * 0.3 - (zone === 'leg' && D.wounded === 'R' ? 0.45 : 0);
            // Stumbling steps on top
            const stepAmp = Math.min(1, Math.hypot(D.vx, D.vz) / 0.9) * 0.5;
            tgt.legLX += Math.sin(D.stepPhase) * stepAmp;
            tgt.legRX -= Math.sin(D.stepPhase) * stepAmp;
            tgt.kneeLX += Math.max(0, Math.cos(D.stepPhase)) * stepAmp;
            tgt.kneeRX += Math.max(0, -Math.cos(D.stepPhase)) * stepAmp;

            for (const a of ['L', 'R']) {
                const out = a === 'L' ? 1 : -1; // +z on the left arm swings it outward
                let role = D.roles[a];
                if (role === 'clutch' && t < D.clutchDelay[a]) role = 'flail';
                let sx = 0, sz = 0.1, ex = -0.15;
                if (role === 'clutch') {
                    const c = {
                        chest: [-0.95, -0.55, -1.95], stomach: [-0.45, -0.35, -1.5],
                        pelvis: [-0.25, -0.3, -1.05], leg: [-0.05, -0.1, -0.35]
                    }[zone] || [-0.95, -0.55, -1.95];
                    sx = c[0]; sz = c[1]; ex = c[2];
                    if (zone === 'leg' && a === D.wounded) { sx = 0.1; sz = 0.05; ex = -0.2; tgt.torsoX += 0.25; }
                } else if (role === 'limp') {
                    sx = 0.1; sz = 0.05; ex = -0.05;
                } else if (role === 'flail') {
                    [sx, sz, ex] = this._flailTarget(D, a, t, 1);
                } else if (role === 'reach') {
                    sx = -1.55; sz = 0.15; ex = -0.15;
                } else if (role === 'balance') {
                    sx = -0.4; sz = 1.4; ex = -0.4;
                }
                tgt['shoulder' + a + 'X'] = sx;
                tgt['shoulder' + a + 'Z'] = sz * out;
                tgt['elbow' + a + 'X'] = ex;
            }
        } else {
            // In the air arms keep flailing; once down they hold the wound or lie sprawled
            for (const a of ['L', 'R']) {
                const out = a === 'L' ? 1 : -1;
                const sp = D.splay[a];
                const keep = D.fallRoles[a] === 'clutch';
                if (D.air && !keep) {
                    const f = this._flailTarget(D, a, t, 1.2);
                    tgt['shoulder' + a + 'X'] = f[0];
                    tgt['shoulder' + a + 'Z'] = f[1] * out;
                    tgt['elbow' + a + 'X'] = f[2];
                } else {
                    tgt['shoulder' + a + 'X'] = keep ? -0.9 : sp[0];
                    tgt['shoulder' + a + 'Z'] = (keep ? -0.5 : sp[1]) * out;
                    tgt['elbow' + a + 'X'] = keep ? -1.8 : sp[2];
                }
                tgt['leg' + a + 'X'] = D.splay['leg' + a][0];
                tgt['knee' + a + 'X'] = D.splay['leg' + a][1];
                tgt['leg' + a + 'Z'] = D.splay['leg' + a][2] * out;
            }
            tgt.torsoX = D.splay.torso[0];
            tgt.torsoZ = D.splay.torso[1];
            tgt.neckX = D.splay.neck[0];
            tgt.neckY = D.splay.neck[1];
        }
        return tgt;
    }

    /** Random arm pose for a flailing arm [shoulderX, shoulderZ (outward), elbowX], re-rolled often. */
    _flailTarget(D, a, t, energy) {
        const f = D.flail[a];
        if (t >= f.next) {
            const r = Math.random;
            // Wild at first, settling as the body runs out of strength
            const e = Math.max(0.25, Math.exp(-t * 0.7)) * energy;
            f.tgt[0] = -0.4 + (r() * 3.2 - 2.3) * e;   // anywhere from overhead to behind
            f.tgt[1] = 0.3 + (r() * 2.3 - 0.6) * e;    // across the chest to straight out
            f.tgt[2] = -0.2 - r() * 1.9 * Math.min(1, e + 0.2);
            f.next = t + (0.1 + r() * 0.3) * (1 + t * 0.6);
        }
        return f.tgt;
    }

    _stepDeathChannels(D, dt, agitation, stiffScale = 1) {
        const prof = D.prof;
        const tgt = this._deathTargets(null, D, this._deathTgt || (this._deathTgt = {}));
        // Random twitches/jerks
        if (Math.random() < prof.twitchRate * dt * Math.min(1, agitation + 0.15)) {
            const c = D.ch[(Math.random() * D.ch.length) | 0];
            c.w += (Math.random() - 0.5) * 2 * prof.twitch * c.scale;
        }
        const k = prof.k * stiffScale;
        const step = Math.min(dt, 1 / 30);
        for (const c of D.ch) {
            const kk = k * c.stiff;
            const damp = 2 * prof.zeta * Math.sqrt(kk);
            const noise = (Math.sin(D.t * c.f1 + c.p1) * 0.65 + Math.sin(D.t * c.f2 + c.p2) * 0.35) * c.scale * agitation;
            const acc = kk * (tgt[c.key] + noise - c.v) - damp * c.w;
            c.w += acc * step;
            c.v += c.w * step;
            if (c.v < c.lo) { c.v = c.lo; if (c.w < 0) c.w *= -0.3; }
            if (c.v > c.hi) { c.v = c.hi; if (c.w > 0) c.w *= -0.3; }
            c.obj.rotation[c.axis] = c.v;
        }
    }

    /**
     * @param {Object} ped
     * @param {Object} hit {x, y, z} impact point and {dirX, dirY, dirZ} travel direction of the shot;
     *   `explosive` throws the body straight away
     */
    startShotDeath(ped, hit = {}) {
        if (!ped || !ped.mesh || ped.state === 'dying' || ped.state === 'ragdoll') return;
        if (!ped.ai) this._initAI(ped);
        this._releaseActivity(ped);
        ped.isDead = true;
        ped.hp = 0;
        ped.shotDeath = true;
        ped.ai.deadPosed = false;
        ped.ai.moveSpeed = 0;
        const D = this._makeDeath(ped, hit, hit.explosive ? 'blast' : 'shot');
        ped.death = D;

        if (hit.explosive) {
            const p = ped.mesh.position;
            const bx = p.x - (hit.x !== undefined ? hit.x : p.x - D.dirX);
            const bz = p.z - (hit.z !== undefined ? hit.z : p.z - D.dirZ);
            const bl = Math.hypot(bx, bz) || 1;
            D.prof.flail = Math.max(D.prof.flail, 1.2);
            this._beginFall(ped, bx / bl, bz / bl, 9 + Math.random() * 4, 7 + Math.random() * 3, 9);
            return;
        }
        ped.state = 'dying';
    }

    /** Procedural limbs for a body launched by a car (the solver in game.html moves the body). */
    attachImpactDeath(ped, dirX, dirZ, impactSpeed) {
        if (!ped || !ped.mesh || !ped.mesh.userData.rig) return;
        if (!ped.ai) this._initAI(ped);
        this._releaseActivity(ped);
        const D = this._makeDeath(ped, { dirX, dirZ, y: ped.mesh.position.y + 1.1 }, 'impact');
        D.prof.flail = Math.min(1.8, 0.6 + impactSpeed * 0.06) * (0.7 + Math.random() * 0.6);
        this._prepareFallPose(D);
        D.fallT = 0;
        ped.death = D;
    }

    _prepareFallPose(D) {
        const r = Math.random;
        const rr = (a, b) => a + r() * (b - a);
        D.fallRoles = {
            L: D.roles.L === 'clutch' && r() < 0.55 ? 'clutch' : 'sprawl',
            R: D.roles.R === 'clutch' && r() < 0.55 ? 'clutch' : 'sprawl'
        };
        // Resting limbs stay roughly in the plane of the body (by the side or flung overhead), so a
        // body lying on its back doesn't end up with an arm pointing at the sky
        const restArm = () => (r() < 0.6
            ? [rr(-0.35, 0.25), rr(0.1, 1.5), rr(-0.6, 0)]
            : [rr(-3.0, -2.55), rr(0.0, 0.9), rr(-0.5, 0)]);
        D.splay = {
            L: restArm(),
            R: restArm(),
            legL: [rr(-0.35, 0.2), rr(0, 0.6), rr(0, 0.35)],
            legR: [rr(-0.35, 0.2), rr(0, 0.6), rr(0, 0.35)],
            torso: [rr(-0.3, 0.4), rr(-0.3, 0.3)],
            neck: [rr(-0.5, 0.6), rr(-1.0, 1.0)]
        };
    }

    _updateDying(ped, dt) {
        const D = ped.death;
        const rig = ped.mesh.userData.rig;
        if (!D || !rig) {
            this._beginFall(ped, -Math.sin(ped.ai.yaw), -Math.cos(ped.ai.yaw), 1.0, 0.5, 3.2);
            return;
        }
        D.t += dt;
        const prof = D.prof;

        // Root: impact momentum, balance-recovery stumbles and spin, all bleeding off
        D.nextStep -= dt;
        if (D.nextStep <= 0 && D.steps > 0) {
            D.steps--;
            D.nextStep = 0.22 + Math.random() * 0.3;
            // Stumbles carry on in the direction the shot pushed them
            const a = Math.atan2(D.dirX, D.dirZ) + (Math.random() - 0.5) * 0.9;
            const m = 0.3 + Math.random() * 0.6;
            D.vx = D.vx * 0.6 + Math.sin(a) * m;
            D.vz = D.vz * 0.6 + Math.cos(a) * m;
        }
        const fr = Math.exp(-2.2 * dt);
        D.vx *= fr;
        D.vz *= fr;
        D.spin *= Math.exp(-3.0 * dt);
        D.stepPhase += Math.hypot(D.vx, D.vz) * dt * 9;
        ped.mesh.position.x += D.vx * dt;
        ped.mesh.position.z += D.vz * dt;
        ped.mesh.position.y = 0;
        ped.ai.yaw += D.spin * dt;
        ped.mesh.rotation.set(0, ped.ai.yaw, 0);

        const agitation = prof.agit0 * Math.exp(-prof.decay * D.t) + 0.1;
        // Head shots go limp almost at once
        const limp = D.zone === 'head' ? Math.max(0.25, 1 - D.t * 3) : 1;
        this._stepDeathChannels(D, dt, agitation, limp);

        // Hips drop as the knees bend
        const kneeAvg = (D.chByKey.kneeLX.v + D.chByKey.kneeRX.v) * 0.5;
        rig.body.position.set(0, -0.42 * (1 - Math.cos(Math.min(1.6, kneeAvg))), 0);
        rig.body.rotation.set(0, 0, Math.sin(D.t * 6.5 + D.lat * 20) * 0.05 * agitation);

        if (D.t >= D.standTime) {
            // Fall away from the shooter (along the bullet's path), give or take ~15 degrees
            const a = Math.atan2(D.dirX, D.dirZ) + (Math.random() - 0.5) * 0.5;
            const speed = 0.6 + Math.hypot(D.vx, D.vz) * 0.9;
            this._beginFall(ped, Math.sin(a), Math.cos(a), speed, 0.15 + Math.random() * 0.35, 3.0 + Math.random() * 1.8);
        }
    }

    /**
     * Hands the body to the shared ragdoll solver (game.html stepPedRagdoll), continuing from its
     * current pose. Falls/launches along (dirX, dirZ).
     */
    _beginFall(ped, dirX, dirZ, speed, up, spin) {
        const mesh = ped.mesh;
        const D = ped.death;
        const yaw = ped.ai ? ped.ai.yaw : mesh.rotation.y;
        const facing = Math.sin(yaw) * dirX + Math.cos(yaw) * dirZ;
        const fallHeading = Math.atan2(dirX, dirZ);
        ped.state = 'ragdoll';
        // isDead stays set so the body can't be killed twice; the solver bleeds it once it comes to rest
        ped.ragdollOrigin = { x: mesh.position.x, z: mesh.position.z };
        ped.ragdollDisplacement = 0;
        ped.ragdollTime = 0;
        ped.ragdollSettle = 0;
        // Falling the way it faces lands face down; falling backwards lands face up
        ped.ragdollHeading = facing >= 0 ? fallHeading : fallHeading + Math.PI;
        ped.ragdollFace = facing >= 0 ? 1 : -1;
        ped.ragdollQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
        // Start from the current crouch so kneeling bodies don't pop up
        const crouch = ped.mesh.userData.rig ? ped.mesh.userData.rig.body.position.y : 0;
        ped.ragdollCom = new THREE.Vector3(0, 1.0 + crouch, 0).applyQuaternion(ped.ragdollQuat).add(mesh.position);
        if (ped.mesh.userData.rig) ped.mesh.userData.rig.body.position.set(0, 0, 0);
        ped.ragdollVel = new THREE.Vector3(dirX * speed, up, dirZ * speed);
        // Tip the body's up axis towards the fall direction, and keep any spin it already had
        ped.ragdollAngVel = new THREE.Vector3(dirZ * spin, (D ? D.spin * 0.3 : 0) + (Math.random() - 0.5) * 0.3, -dirX * spin);
        if (D) {
            this._prepareFallPose(D);
            D.fallT = D.t;
        }
    }

    /** Limbs of a falling / fallen body keep moving procedurally until they settle. */
    _updateDeathMotion(ped, dt) {
        const D = ped.death;
        if (!D || D.done || !ped.mesh.userData.rig) return;
        D.t += dt;
        const since = D.t - D.fallT;
        const airborne = ped.state === 'ragdoll' && ped.ragdollCom && ped.ragdollCom.y > 0.55;
        D.air = airborne;
        let agitation = D.prof.flail * (airborne ? 1 : 0.3) * Math.exp(-since * 0.9);
        if (ped.state === 'dead') {
            if (D.restT < 0) D.restT = D.t;
            const rest = D.t - D.restT;
            // Death twitches, then still
            agitation = D.prof.deadTwitch && rest < 2 ? 0.25 * Math.exp(-rest * 1.5) : 0;
            if (rest > 3) D.done = true;
        }
        this._stepDeathChannels(D, dt, agitation, airborne ? 0.7 : 1.1);
    }

    // --------------------------------------------------------------------------------------------
    // Animation
    // --------------------------------------------------------------------------------------------
    _poseDead(ped) {
        const rig = ped.mesh.userData.rig;
        ped.ai.deadPosed = true;
        if (!rig) return;
        rig.body.position.set(0, 0, 0);
        rig.body.rotation.set(0, 0, 0);
        rig.torso.rotation.set(0, 0, 0);
        rig.neck.rotation.set(0, 0, 0);
        rig.shoulderL.rotation.set(0, 0, -0.5);
        rig.shoulderR.rotation.set(0, 0, 0.5);
        rig.elbowL.rotation.set(0, 0, 0);
        rig.elbowR.rotation.set(0, 0, 0);
        rig.kneeL.rotation.set(0, 0, 0);
        rig.kneeR.rotation.set(0, 0, 0);
    }

    _animate(ped, dt) {
        const rig = ped.mesh.userData.rig;
        if (!rig) return;
        const ai = ped.ai;
        const t = this._time + ai.seed;

        // Neutral
        rig.body.position.set(0, 0, 0);
        rig.body.rotation.set(0, 0, 0);
        rig.torso.rotation.set(0, 0, 0);
        rig.shoulderL.rotation.set(0, 0, 0.06);
        rig.shoulderR.rotation.set(0, 0, -0.06);
        rig.elbowL.rotation.set(-0.12, 0, 0);
        rig.elbowR.rotation.set(-0.12, 0, 0);
        rig.legL.rotation.set(0, 0, 0);
        rig.legR.rotation.set(0, 0, 0);
        rig.kneeL.rotation.set(0, 0, 0);
        rig.kneeR.rotation.set(0, 0, 0);

        let headPitch = 0;
        const pose = ai.pose;
        if ((pose === 'walk' || pose === 'run') && ai.moveSpeed > 0.05) {
            const run = pose === 'run';
            const stride = run ? 2.2 : 1.45;
            ai.phase = (ai.phase || 0) + (ai.moveSpeed / stride) * Math.PI * dt * 2;
            ped.walkPhase = ai.phase;
            const s = Math.sin(ai.phase);
            const c = Math.cos(ai.phase);
            const amp = run ? 0.85 : 0.5 * Math.min(1.2, ai.moveSpeed / 1.3);
            rig.legL.rotation.x = -s * amp;
            rig.legR.rotation.x = s * amp;
            // Knees bend as each leg swings through
            rig.kneeL.rotation.x = Math.max(0, c) * amp * 1.3 + 0.05;
            rig.kneeR.rotation.x = Math.max(0, -c) * amp * 1.3 + 0.05;
            rig.shoulderL.rotation.x = s * amp * 0.75;
            rig.shoulderR.rotation.x = -s * amp * 0.75;
            const elbow = run ? -1.35 : -0.25;
            rig.elbowL.rotation.x = elbow;
            rig.elbowR.rotation.x = elbow;
            rig.body.position.y = Math.abs(c) * (run ? 0.06 : 0.03);
            rig.torso.rotation.x = run ? 0.18 : 0.04;
            rig.torso.rotation.y = s * (run ? 0.12 : 0.06);
            if (ai.phone && !run) {
                rig.shoulderR.rotation.set(-0.55, 0, 0.1);
                rig.elbowR.rotation.x = -1.35;
                headPitch = 0.4;
            }
        } else if (pose === 'fight') {
            // Boxing guard with a little bounce; one arm snaps out on a punch
            rig.body.position.y = Math.abs(Math.sin(t * 6)) * 0.025 - 0.03;
            rig.legL.rotation.x = -0.25;
            rig.legR.rotation.x = 0.2;
            rig.kneeL.rotation.x = 0.35;
            rig.kneeR.rotation.x = 0.3;
            rig.torso.rotation.x = 0.12;
            rig.shoulderL.rotation.set(-1.15, 0, -0.35);
            rig.shoulderR.rotation.set(-1.15, 0, 0.35);
            rig.elbowL.rotation.set(-1.85, 0, 0);
            rig.elbowR.rotation.set(-1.85, 0, 0);
            if (ai.punching > 0) {
                const k = ai.punching < 0.24 ? ai.punching / 0.24 : Math.max(0, 1 - (ai.punching - 0.24) / 0.26);
                const sh = ai.punchArm > 0 ? rig.shoulderL : rig.shoulderR;
                const el = ai.punchArm > 0 ? rig.elbowL : rig.elbowR;
                sh.rotation.x = -1.15 - 0.4 * k;
                sh.rotation.z *= 1 - k;
                el.rotation.x = -1.85 + 1.75 * k;
                rig.torso.rotation.y = -ai.punchArm * 0.35 * k;
            }
        } else if (pose === 'sit') {
            const seatH = ai.seat >= 0 && this.nav ? (SEAT_HEIGHT[this.nav.seatType[ai.seat]] || 0.45) : 0.45;
            const h = ped.mesh.scale.y || 1;
            rig.body.position.y = (seatH + 0.06) / h - 0.92;
            rig.legL.rotation.x = -1.45;
            rig.legR.rotation.x = -1.4;
            rig.kneeL.rotation.x = 1.4;
            rig.kneeR.rotation.x = 1.3;
            rig.legL.rotation.z = 0.06;
            rig.legR.rotation.z = -0.06;
            const atTable = ai.seat >= 0 && this.nav && this.nav.seatType[ai.seat] === FURNITURE.PATIO_CHAIR;
            rig.shoulderL.rotation.x = atTable ? -0.8 : -0.4;
            rig.shoulderR.rotation.x = atTable ? -0.8 : -0.4;
            rig.elbowL.rotation.x = atTable ? -0.6 : -0.75;
            rig.elbowR.rotation.x = atTable ? -0.6 : -0.75;
            rig.torso.rotation.x = -0.06;
            if (ai.speaking) {
                rig.shoulderR.rotation.x = -0.9 + Math.sin(t * 3.1) * 0.2;
                rig.elbowR.rotation.x = -1.1 + Math.sin(t * 4.3) * 0.25;
                headPitch = Math.sin(t * 2.2) * 0.06;
            } else if (ai.phone) {
                rig.shoulderR.rotation.x = -0.6;
                rig.elbowR.rotation.x = -1.4;
                headPitch = 0.45;
            }
        } else {
            // Standing: breathing and weight shifts; gestures while talking
            rig.body.rotation.z = Math.sin(t * 0.6) * 0.025;
            rig.torso.rotation.z = -Math.sin(t * 0.6) * 0.02;
            rig.shoulderL.rotation.x = Math.sin(t * 1.1) * 0.03;
            rig.shoulderR.rotation.x = -Math.sin(t * 1.1) * 0.03;
            if (pose === 'talk' && ai.speaking) {
                rig.shoulderR.rotation.x = -0.55 + Math.sin(t * 3.3) * 0.25;
                rig.elbowR.rotation.x = -1.05 + Math.sin(t * 4.7) * 0.3;
                rig.shoulderL.rotation.x = -0.25 + Math.sin(t * 2.1 + 1) * 0.15;
                rig.elbowL.rotation.x = -0.7;
                headPitch = Math.sin(t * 2.4) * 0.07;
            } else if (pose === 'talk' && ai.crossArms) {
                rig.shoulderL.rotation.set(-0.45, 0, -0.3);
                rig.shoulderR.rotation.set(-0.45, 0, 0.3);
                rig.elbowL.rotation.set(-1.55, 0, 0);
                rig.elbowR.rotation.set(-1.55, 0, 0);
            } else if (ai.phone && ped.state === 'idle') {
                rig.shoulderR.rotation.set(-0.55, 0, 0.1);
                rig.elbowR.rotation.x = -1.35;
                headPitch = 0.4;
            }
            if (pose === 'talk' && !ai.speaking) headPitch += Math.max(0, Math.sin(t * 1.3)) * 0.05;
        }

        // Getting punched: head snaps back and the body rocks
        if (ai.flinch > 0) {
            ai.flinch = Math.max(0, ai.flinch - dt * 3.5);
            const f = Math.sin(ai.flinch * Math.PI);
            rig.torso.rotation.x -= f * 0.35;
            rig.torso.rotation.z += ai.flinchSide * f * 0.15;
            headPitch -= f * 0.6;
        }

        // Head turns smoothly towards whatever the ped is looking at
        const lookNow = rig.neck.rotation.y;
        rig.neck.rotation.set(headPitch, lookNow + (ai.look - lookNow) * Math.min(1, dt * 5), 0);
        // Keep the body facing its heading (ragdoll/kill code may have touched the root)
        ped.mesh.rotation.set(0, ai.yaw, 0);
        if (ped.state !== 'sitting' && pose !== 'sit') ped.mesh.position.y = 0;
    }

    // --------------------------------------------------------------------------------------------
    // Population
    // --------------------------------------------------------------------------------------------
    /** Fills the area around `center` right away (game start / teleport). */
    populateInitial(center) {
        if (!this.nav) return;
        for (let i = 0; i < 40; i++) {
            const before = this.pedestrians.length;
            this._maintainPopulation({ center, viewDir: null }, true);
            if (this.pedestrians.length === before) break;
        }
        this._lastCenter = { x: center.x, z: center.z };
    }

    _inView(x, z, ctx) {
        const v = ctx.viewDir;
        if (!v) return false;
        const dx = x - ctx.center.x, dz = z - ctx.center.z;
        const d = Math.hypot(dx, dz) || 1;
        return (dx * v.x + dz * v.z) / d > 0.3;
    }

    _spawnOk(x, z, ctx, initial) {
        const dx = x - ctx.center.x, dz = z - ctx.center.z;
        const d = Math.hypot(dx, dz);
        if (initial) return d >= PED_CONFIG.INITIAL_SPAWN_MIN;
        if (d < PED_CONFIG.SPAWN_MIN) return false;
        return d >= PED_CONFIG.SPAWN_IN_VIEW_MIN || !this._inView(x, z, ctx);
    }

    _maintainPopulation(ctx, forceInitial = false) {
        const nav = this.nav;
        const peds = this.pedestrians;
        const c = ctx.center;
        let initial = forceInitial;
        if (this._lastCenter && Math.hypot(c.x - this._lastCenter.x, c.z - this._lastCenter.z) > PED_CONFIG.TELEPORT_DIST) {
            initial = true;
        }
        this._lastCenter = { x: c.x, z: c.z };

        // Remove people (and bodies) far from the player
        const desp2 = PED_CONFIG.DESPAWN_RADIUS * PED_CONFIG.DESPAWN_RADIUS;
        const body2 = PED_CONFIG.BODY_DESPAWN_RADIUS * PED_CONFIG.BODY_DESPAWN_RADIUS;
        let walkers = 0, sitters = 0, groupPeople = 0;
        for (let i = peds.length - 1; i >= 0; i--) {
            const ped = peds[i];
            if (ped.isPoliceOfficer || !ped.mesh) continue;
            const p = ped.mesh.position;
            const dx = p.x - c.x, dz = p.z - c.z;
            const d2 = dx * dx + dz * dz;
            if (ped.state === 'ragdoll' || ped.state === 'dying' || ped.state === 'carjacked' || ped.state === 'talking') continue;
            if ((ped.isDead && d2 > body2) || (!ped.isDead && d2 > desp2)) {
                this._releaseActivity(ped);
                if (ped.mesh.parent) ped.mesh.parent.remove(ped.mesh);
                peds.splice(i, 1);
                continue;
            }
            if (ped.isDead || !ped.ai) continue;
            if (ped.ai.seat >= 0) sitters++;
            else if (ped.ai.group) groupPeople++;
            else walkers++;
        }

        let budget = initial ? 12 : PED_CONFIG.MAX_SPAWNS_PER_TICK;
        const living = walkers + sitters + groupPeople;
        if (living >= PED_CONFIG.CAPACITY - 8) return;

        const minR = initial ? 0 : PED_CONFIG.SPAWN_MIN;
        const maxR = PED_CONFIG.SPAWN_MAX;

        // Sitters
        if (sitters < this.targets.sitters && budget > 0) {
            const seats = nav.seatsInRing(c.x, c.z, minR, maxR, this._ring).slice();
            for (let tries = 0; tries < 6 && sitters < this.targets.sitters && budget > 0 && seats.length; tries++) {
                const s = seats[(Math.random() * seats.length) | 0];
                if (this.seatOccupant[s] || !this._spawnOk(nav.seatX[s], nav.seatZ[s], ctx, initial)) continue;
                this._spawnSitter(s);
                sitters++;
                budget--;
                // Friends at the same table or bench
                if (Math.random() < 0.55) {
                    nav.seatGrid.forEachNear(nav.seatX[s], nav.seatZ[s], 3, (o) => {
                        if (o !== s && nav.seatCluster[o] === nav.seatCluster[s] && !this.seatOccupant[o] && Math.random() < 0.7) {
                            this._spawnSitter(o);
                            sitters++;
                        }
                    });
                }
            }
        }

        // Groups on the grass
        if (groupPeople < this.targets.groupPeople && budget > 0) {
            const spots = nav.hangoutsInRing(c.x, c.z, minR, maxR, this._ring).slice();
            for (let tries = 0; tries < 6 && groupPeople < this.targets.groupPeople && budget > 0 && spots.length; tries++) {
                const h = spots[(Math.random() * spots.length) | 0];
                if (this.hangoutGroup.has(h) || !this._spawnOk(nav.hangX[h], nav.hangZ[h], ctx, initial)) continue;
                groupPeople += this._spawnGroup(h);
                budget--;
            }
        }

        // Walkers on the sidewalks
        if (walkers < this.targets.walkers && budget > 0) {
            const nodes = nav.walkNodesInRing(c.x, c.z, minR, maxR, this._ring);
            for (let tries = 0; tries < 12 && walkers < this.targets.walkers && budget > 0 && nodes.length; tries++) {
                const n = nodes[(Math.random() * nodes.length) | 0];
                if (!this._spawnOk(nav.nodeX[n], nav.nodeZ[n], ctx, initial)) continue;
                this._spawnWalker(n);
                walkers++;
                budget--;
            }
        }
    }

    _spawnWalker(node) {
        const nav = this.nav;
        let yaw = Math.random() * TWO_PI;
        const deg = nav.adjStart[node + 1] - nav.adjStart[node];
        if (deg > 0) {
            const nb = nav.adjNode[nav.adjStart[node] + ((Math.random() * deg) | 0)];
            yaw = Math.atan2(nav.nodeX[nb] - nav.nodeX[node], nav.nodeZ[nb] - nav.nodeZ[node]);
        }
        const ped = this._makePed(nav.nodeX[node], nav.nodeZ[node], yaw);
        this._pickStops(ped, node);
        ped.state = 'walking';
        return ped;
    }

    _spawnSitter(seat) {
        const nav = this.nav;
        const ped = this._makePed(nav.seatX[seat], nav.seatZ[seat], nav.seatYaw[seat]);
        this.seatOccupant[seat] = ped;
        ped.ai.seat = seat;
        this._sit(ped, seat);
        ped.ai.timer = 30 + Math.random() * 200;
        return ped;
    }

    _spawnGroup(spot) {
        const g = this._createGroup(spot);
        const n = Math.min(g.maxSize, 2 + ((Math.random() * 3) | 0));
        for (let i = 0; i < n; i++) {
            const ped = this._makePed(g.x, g.z, 0);
            g.members.push(ped);
            ped.ai.group = g;
        }
        for (let i = 0; i < g.members.length; i++) {
            const ped = g.members[i];
            const slot = this._slotPosition(g, i);
            ped.mesh.position.set(slot.x, 0, slot.z);
            ped.ai.yaw = Math.atan2(g.x - slot.x, g.z - slot.z);
            ped.mesh.rotation.set(0, ped.ai.yaw, 0);
            ped.state = 'hanging_out';
            ped.ai.timer = 40 + Math.random() * 200;
            ped.ai.pose = 'talk';
        }
        return n;
    }

    /**
     * Spawns `count` walkers on the sidewalks near a point when no nav graph is available
     * (fallback so the game still has people around).
     */
    spawnFallbackWalkers(points) {
        for (const pt of points) {
            this._makePed(pt.x, pt.z, pt.yaw || 0);
        }
    }

    getStats() {
        let walking = 0, waiting = 0, crossing = 0, sitting = 0, hanging = 0;
        for (const p of this.pedestrians) {
            if (p.isDead || p.isPoliceOfficer) continue;
            if (p.state === 'walking' || p.state === 'idle') walking++;
            else if (p.state === 'waiting_to_cross') waiting++;
            else if (p.state === 'crossing') crossing++;
            else if (p.state === 'sitting') sitting++;
            else if (p.state === 'hanging_out') hanging++;
        }
        return { total: this.pedestrians.length, walking, waiting, crossing, sitting, hanging, groups: this.groups.size };
    }
}
