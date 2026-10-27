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
 * - Districts (districts.js): who is out, how many and what they're up to depends on the part of
 *   town and the time of day; the scenes themselves (picnics, beer pong, bar lines, fights,
 *   arrests, dog walks...) live in pedestrianScenes.js.
 *
 * Ped objects keep the fields the rest of the game relies on (mesh, position, state, hp, isDead,
 * velocity, speed, fleeTimer, talkTimer, walkPhase, index, mesh.userData.leftLeg/rightLeg), so
 * shooting, ragdolls, carjacking and dialog work unchanged. `ped.mesh` is a transform rig that
 * the instanced renderer reads every frame.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WALK_EDGE, FURNITURE } from './cityNav.js';
import { DOOR_KIND, districtAt, districtProfile, pickTable, pickWeighted } from './districts.js';
import { SceneDirector, PROP_PARTS, PartyMusic } from './pedestrianScenes.js';
import { lerpAngle } from './camera.js';
import { resetRig } from './avatarPose.js';

const HELD_MODES = ['', 'drag', 'neck', 'pin', 'mount'];
const DOWN_POSES = ['back', 'front', 'side', 'wall'];

/**
 * A person's fight state for the network (netWorld.js): [held mode, lying, down pose, down age,
 * getting up, face damage, head gone, hp, slumped against a wall] or 0 when there's nothing to tell.
 */
export function brawlRecord(ped) {
    const ai = ped.ai || {};
    const held = ped.state === 'held' && ai.held;
    const down = ped.state === 'downed';
    const face = ped.faceDmg || 0;
    if (!held && !down && !face && !ped.headGone && !ai.wallSlump && !ped.limbsGone) return 0;
    return [
        held ? Math.max(0, HELD_MODES.indexOf(ai.held.mode)) : 0, held && ai.held.lying ? 1 : 0,
        Math.max(0, DOWN_POSES.indexOf(ai.downPose || 'back')), Math.round(Math.min(1, ai.downAge || 0) * 10),
        Math.round((ai.getUp || 0) * 10), Math.round(face * 10), ped.headGone ? 1 : 0, Math.max(0, Math.round(ped.hp || 0)),
        ai.wallSlump ? 1 : 0, ped.limbsGone || 0
    ];
}

/** The numbers of a hit worth sending over the network. */
export function pickHit(hit) {
    const out = {};
    for (const k of ['x', 'y', 'z', 'dirX', 'dirY', 'dirZ', 'damage', 'side', 'knock']) if (Number.isFinite(hit[k])) out[k] = Math.round(hit[k] * 100) / 100;
    if (hit.explosive) out.explosive = true;
    if (typeof hit.move === 'string' && /^[a-z]{1,10}$/.test(hit.move)) out.move = hit.move;
    return out;
}

export const PED_CONFIG = Object.freeze({
    // Population targets around the player (scaled down on phones/tablets)
    WALKERS: 34,
    SITTERS: 14,
    GROUP_PEOPLE: 16,
    STREET_SCENE_PEOPLE: 14,    // people in sidewalk scenes (smoking, bar lines, fights...) at density 1
    LOW_SPEC_SCALE: 0.55,
    CAPACITY: 190,
    DENSITY_MIN: 0.12,          // district population multipliers are clamped to this range
    DENSITY_MAX: 4.2,
    PATROL_CHANCE: 0.004,       // per population tick, scaled by the district's `patrol`
    DOOR_RANGE: 220,

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
const ALL_DOORS = Object.values(DOOR_KIND);

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

function smooth01(x) {
    x = Math.max(0, Math.min(1, x));
    return x * x * (3 - 2 * x);
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

// Who people are in each district (districts.js `looks`)
const STYLE_SHIRTS = {
    // BGSU orange and brown turn up a lot around campus
    student: SHIRT_COLORS.concat([0xfe5000, 0xfe5000, 0x4f2c1d, 0x4f2c1d, 0x9a9a9a, 0x1c2e4a]),
    partier: [0xff2d55, 0x111111, 0x111111, 0xffffff, 0xff9f0a, 0x5856d6, 0x34c759, 0xff375f, 0x0a84ff, 0xffd60a, 0xfe5000, 0xe8e2d0],
    older: [0x8b7d6b, 0x556b2f, 0x6b5b95, 0x9e9e9e, 0xbfa58a, 0x2f4f4f, 0x7a6a5a, 0xd8cfc4, 0x9fb7cf, 0xc9b79c],
    worker: [0xf2f2f2, 0xdfe8f2, 0x1f3a5f, 0x3b3b3b, 0x2b5797, 0xff7a00, 0x6a7b8c],
    athlete: [0xff3b30, 0x00c7be, 0xffcc00, 0x5ac8fa, 0x111111, 0xaf52de, 0xf2f2f2, 0xfe5000]
};
const OLD_HAIR = [0x8c8c8c, 0xb0b0b0, 0xd0d0d0, 0xe8e8e8, 0x6b6b6b, 0x4a3020];

function makeLook(seed, style = 'adult') {
    const rand = mulberry32(seed * 2654435761 + 17);
    const femme = rand() < 0.5;
    const skin = pick(rand, SKIN_TONES);
    const hairRoll = rand();
    const old = style === 'older';
    let hairStyle = femme
        ? (hairRoll < 0.72 ? 'long' : hairRoll < 0.95 ? 'short' : 'none')
        : (hairRoll < 0.12 ? 'none' : hairRoll < 0.9 ? 'short' : 'long');
    if (old && hairStyle === 'long' && rand() < 0.6) hairStyle = 'short';
    if (old && !femme && rand() < 0.3) hairStyle = 'none';
    let hat = rand() < (femme ? 0.1 : 0.22);
    const lowerRoll = rand();
    let skirt = femme && lowerRoll < 0.3;
    let shorts = !skirt && lowerRoll > 0.78;
    let shirt = pick(rand, STYLE_SHIRTS[style] || SHIRT_COLORS);
    let pants = skirt ? pick(rand, ACCENT_COLORS.concat(PANTS_COLORS)) : pick(rand, PANTS_COLORS);
    let shoes = pick(rand, SHOE_COLORS);
    let longSleeves = rand() < 0.4;
    let backpack = rand() < 0.14;
    switch (style) {
        case 'student':
            backpack = rand() < 0.55;
            longSleeves = rand() < 0.55; // hoodies
            shorts = shorts || (!skirt && rand() < 0.2);
            break;
        case 'partier':
            backpack = false;
            hat = rand() < 0.15;
            if (femme && rand() < 0.35) {
                skirt = true;
                shorts = false;
            }
            longSleeves = rand() < 0.2;
            break;
        case 'older':
            backpack = false;
            longSleeves = rand() < 0.75;
            skirt = femme && rand() < 0.2;
            shorts = !skirt && rand() < 0.12;
            pants = pick(rand, [0x5a4632, 0x7d6b4f, 0xc2b280, 0x3b3b3b, 0x6a7b8c, 0x1f2a44]);
            break;
        case 'worker':
            backpack = false;
            longSleeves = rand() < 0.7;
            skirt = false;
            shorts = false;
            pants = pick(rand, [0x1f2a44, 0x202020, 0x3b3b3b, 0x5a4632, 0xc2b280]);
            shoes = pick(rand, [0x1a1a1a, 0x5a3a22]);
            break;
        case 'athlete':
            backpack = false;
            skirt = false;
            shorts = true;
            longSleeves = rand() < 0.15;
            hat = rand() < 0.3;
            shoes = pick(rand, [0xf2f2f2, 0xff3b30, 0x2a3d66, 0x1a1a1a]);
            pants = pick(rand, [0x111111, 0x2c3e50, 0x31476b, 0x555555]);
            break;
        case 'bouncer':
            shirt = 0x111111;
            pants = 0x111111;
            longSleeves = false;
            skirt = false;
            shorts = false;
            backpack = false;
            hat = false;
            break;
        default:
            break;
    }
    return {
        style,
        skin,
        hair: old ? pick(rand, OLD_HAIR) : pick(rand, HAIR_COLORS),
        hairStyle,
        hat,
        cap: style === 'student' && rand() < 0.4 ? 0xfe5000 : pick(rand, ACCENT_COLORS),
        shirt,
        longSleeves,
        pants,
        skirt,
        shorts,
        shoes,
        backpack,
        pack: pick(rand, ACCENT_COLORS),
        height: ((femme ? 0.93 : 0.98) + rand() * 0.1) * (old ? 0.97 : 1) * (style === 'bouncer' ? 1.06 : 1),
        width: (0.9 + rand() * 0.22) * (style === 'bouncer' ? 1.15 : 1)
    };
}

/** A uniformed police officer on the same body as everyone else (`armed`: gun in hand). */
function makePoliceLook(seed, armed = true) {
    const look = makeLook(seed);
    return Object.assign(look, {
        police: true,
        armed,
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

const _BRUISED = new THREE.Color(0x8a2c3a);
const LIMB_BITS = { armL: 1, armR: 2, legL: 4, legR: 8 };

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
        // A beaten face, in stages (PedestrianSystem.bruiseFace): a bloody nose and mouth, swelling,
        // split brow and cheek, then a smashed face with the nose knocked sideways
        faceBlood: mergeGeometries([
            box(0.03, 0.06, 0.008, 0, 0.13, 0.121),
            box(0.09, 0.018, 0.008, 0, 0.115, 0.12),
            box(0.02, 0.04, 0.008, 0.015, 0.095, 0.119)
        ]),
        faceSwell: mergeGeometries([
            box(0.065, 0.05, 0.03, 0.052, 0.232, 0.12),
            box(0.08, 0.03, 0.025, -0.045, 0.272, 0.115),
            box(0.055, 0.06, 0.035, -0.075, 0.165, 0.11)
        ]),
        faceGash: mergeGeometries([
            box(0.07, 0.014, 0.006, -0.045, 0.27, 0.13),
            box(0.02, 0.08, 0.006, -0.04, 0.22, 0.125),
            box(0.014, 0.05, 0.006, 0.085, 0.18, 0.12)
        ]),
        faceMash: mergeGeometries([
            box(0.2, 0.1, 0.008, 0, 0.135, 0.122),
            box(0.05, 0.045, 0.05, 0.028, 0.175, 0.135),
            box(0.21, 0.03, 0.01, 0, 0.232, 0.127)
        ]),
        shirtBlood: mergeGeometries([                   // on the torso
            box(0.16, 0.3, 0.008, 0.02, 0.38, 0.12),
            box(0.08, 0.12, 0.008, -0.06, 0.22, 0.115)
        ]),
        // What a point-blank shot leaves of a head: a ragged stump, the back of the skull and the jaw
        headGore: mergeGeometries([
            box(0.13, 0.07, 0.13, 0, 0.075, 0),
            box(0.06, 0.05, 0.05, 0.04, 0.12, 0.03),
            box(0.05, 0.07, 0.04, -0.05, 0.11, -0.02),
            box(0.035, 0.04, 0.03, 0, 0.13, 0.05)
        ]),
        skullStub: mergeGeometries([
            box(0.2, 0.1, 0.07, 0, 0.15, -0.08),
            box(0.14, 0.045, 0.09, 0, 0.1, 0.05)
        ]),
        // An arm or leg torn off (goreLimb): a ragged stump at the shoulder / hip with the bone sticking out
        limbStub: mergeGeometries([
            box(0.14, 0.08, 0.15, 0, -0.04, 0),
            box(0.06, 0.05, 0.07, 0.03, -0.09, 0.02),
            box(0.05, 0.04, 0.05, -0.04, -0.085, -0.03)
        ]),
        boneStub: mergeGeometries([
            box(0.045, 0.1, 0.045, 0, -0.12, 0),
            box(0.06, 0.03, 0.055, 0, -0.17, 0)
        ]),
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
        ]),
        // Hand-held items and scene props (pedestrianScenes.js)
        ...Object.fromEntries(Object.entries(PROP_PARTS).map(([k, v]) => [k, v.geo()]))
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
        if (look.armed !== false) {
            // Named so game/test code can find the officer's gun
            pistolJoint = joint(elbowR, 0, -0.3, 0.02);
            pistolJoint.name = 'officer_pistol';
            b.push(['pistol', pistolJoint, c(0x1e1e1e)]);
        }
    }
    // Where hand-held items go (PedestrianSystem.setProp)
    const handR = joint(elbowR, 0, -0.3, 0.02);
    const handL = joint(elbowL, 0, -0.3, 0.02);

    return {
        body, hips, torso, neck,
        shoulderL, elbowL, shoulderR, elbowR,
        legL, kneeL, legR, kneeR,
        handR, handL,
        pistol: pistolJoint,
        props: {},
        bindings: b.map(([part, j, color]) => ({ part, joint: j, color }))
    };
}

// ================================================================================================
// Instanced renderers
// ================================================================================================
const PART_SLOTS = {
    torso: 1, pelvis: 1, head: 1, eyes: 1, upperArm: 2, forearm: 2, hand: 2,
    thigh: 2, shin: 2, shoe: 2, hairShort: 1, hairLong: 1, cap: 1, skirt: 1, backpack: 1,
    policeHat: 1, capBrim: 1, badge: 1, pistol: 1,
    faceBlood: 1, faceSwell: 1, faceGash: 1, faceMash: 1, shirtBlood: 1, headGore: 1, skullStub: 1,
    limbStub: 1.5, boneStub: 1.5,
    ...Object.fromEntries(Object.entries(PROP_PARTS).map(([k, v]) => [k, v.slots]))
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
            const max = Math.max(4, Math.ceil(capacity * PART_SLOTS[part]));
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
            mesh.visible = counts[k] > 0; // unused props cost no draw call
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
        // lowSpec 'lowest' is the super low graphics mode: a thin crowd, drawn only when close
        this.lowest = lowSpec === 'lowest';
        this.renderDistance = this.lowest ? 70 : PED_CONFIG.RENDER_DISTANCE;
        const scale = this.lowest ? 0.22 : lowSpec ? PED_CONFIG.LOW_SPEC_SCALE : 1;
        this.targets = {
            walkers: Math.round(PED_CONFIG.WALKERS * scale),
            sitters: Math.round(PED_CONFIG.SITTERS * scale),
            groupPeople: Math.round(PED_CONFIG.GROUP_PEOPLE * scale)
        };
        // (room beyond CAPACITY for other players, people in cars and police ghosts)
        this.renderer = new PedestrianRenderer(scene, PED_CONFIG.CAPACITY + 270, lowSpec);   // + police, scene extras and the bar crowds (bars.js)
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
        this._ring2 = [];
        this._rand = Math.random;

        // District life: scenes, props, party music. `parkedCars` (parkedCars.js) is set by the
        // game so people can walk to their cars; `night` comes in with every update.
        this.scenes = new SceneDirector(this);
        this.music = new PartyMusic();
        this.parkedCars = null;
        // netWorld.js: in replica mode another player's game simulates the people here and we draw
        // what it sends; `replicaExtras` are the scene props and dogs they have out
        this.replicaMode = false;
        this.replicaExtras = [];
        // { emit(kind, data), cmd(kind, data) }: tells the other players what happens to people here
        // (emit: we own them, everyone in the region sees it) and acts on people we only draw (cmd: the owner does it)
        this.net = null;
        // districtStreaming.js: people only live in the district the player is in (set by the game)
        this.streamer = null;
        this.night = 0;
        this._lastCtx = null;
        this._extras = [];
        // Other rigs to draw with the people (the player's own body in third person)
        this.extraRigs = [];
        // Other music sources ({ x, z, gain, muffled }, e.g. the bars in bars.js), mixed in with the scenes'
        this.extraMusic = [];
    }

    setAudioContext(ctx) {
        this.music.setContext(ctx);
    }

    // --------------------------------------------------------------------------------------------
    // Creation
    // --------------------------------------------------------------------------------------------
    /**
     * A pedestrian rig (THREE.Group transform hierarchy) with a randomized look.
     * options: { police (PoliceSystem officer), style (districts.js look), copOnFoot (unarmed beat cop) }
     */
    createPedestrianMesh(seed = (Math.random() * 1e9) | 0, options = {}) {
        const group = new THREE.Group();
        group.name = options.police ? `police_officer_${seed}` : `pedestrian_${seed}`;
        group.userData.isPedestrian = !options.police;
        group.userData.isPoliceOfficer = !!options.police;
        const look = options.police ? makePoliceLook(seed)
            : options.style === 'cop' ? makePoliceLook(seed, false) : makeLook(seed, options.style);
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

    /** A new pedestrian at (x, z). `style` is who they are (districts.js looks; 'cop' for police on foot). */
    _makePed(x, z, yaw, style = 'adult', fixedSeed = null) {
        const index = this._nextIndex++;
        const lookSeed = fixedSeed !== null ? fixedSeed : index * 7919 + ((Math.random() * 1e6) | 0);
        const mesh = this.createPedestrianMesh(lookSeed, { style });
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
            talkCount: 0,
            style,
            lookSeed
        };
        mesh.userData.pedestrian = ped;
        this._initAI(ped);
        ped.ai.yaw = yaw;
        this.pedestrians.push(ped);
        return ped;
    }

    _initAI(ped) {
        const r = Math.random();
        const style = ped.style || 'adult';
        const jogger = style === 'athlete' ? r < 0.7 : (style === 'older' || style === 'partier' || style === 'cop') ? false : r < 0.07;
        const speedScale = style === 'older' ? 0.72 : style === 'cop' ? 0.85 : 1;
        ped.ai = {
            yaw: ped.mesh.rotation.y,
            walkSpeed: jogger ? PED_CONFIG.JOG_SPEED * (0.9 + Math.random() * 0.2)
                : (PED_CONFIG.WALK_SPEED_MIN + Math.random() * (PED_CONFIG.WALK_SPEED_MAX - PED_CONFIG.WALK_SPEED_MIN)) * speedScale,
            jogger,
            old: style === 'older',
            cat: 'walker',
            act: null,
            leader: null,
            followSlot: 0,
            drunk: 0,
            heading: 0,
            vanish: false,
            phone: !jogger && style !== 'cop' && Math.random() < (style === 'student' ? 0.25 : style === 'older' ? 0.04 : 0.15),
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
     * @param {number} [ctx.night] 0 by day .. 1 at night (districts.js nightFactor)
     */
    update(dt, ctx) {
        if (this.replicaMode) {
            this._updateReplicaMode(dt, ctx);
            return;
        }
        this._time += dt;
        this._pathBudget = PED_CONFIG.PATHS_PER_FRAME;
        this._collectCars(ctx.vehicles, ctx.center);
        this.night = ctx.night || 0;
        this._lastCtx = ctx;

        if (this.nav) {
            this._popTimer -= dt;
            if (this._popTimer <= 0) {
                this._popTimer = PED_CONFIG.POPULATION_INTERVAL;
                this._maintainPopulation(ctx);
            }
            this.furniture.update(ctx.center.x, ctx.center.z);
            this.scenes.update(dt, ctx);
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
                if (ai.wallSlump) this._updateWallSlump(ped, dt);
                else if (ped.death) this._updateDeathMotion(ped, dt);
                else if (ped.state === 'dead' && !ai.deadPosed) this._poseDead(ped);
                ai.lastState = ped.state;
                continue;
            }
            if (ped.state === 'carjacked') {
                if (ai.carOut) this._updateCarOut(ped, dt);
                ai.lastState = 'carjacked';
                continue;
            }

            // States set from outside (dialog, gunfire panic) interrupt whatever the ped was doing
            if (ped.state !== ai.lastState) {
                // People in a bar (bars.js) get out by the door rather than running through walls
                if (ped.barCtl && ped.state === 'fleeing') ped.barCtl.onPanic(ped);
                if (ped.state === 'talking') {
                    ai.resumeState = ai.lastState === 'bar' && ped.barCtl ? 'bar'
                        : (ai.lastState === 'sitting' || ai.lastState === 'hanging_out' || (ai.lastState === 'activity' && ai.act))
                            ? ai.lastState : (ai.lastState === 'following' && ai.leader ? 'following' : 'walking');
                } else if (ped.state === 'fleeing') {
                    this._releaseActivity(ped);
                    ai.path = null;
                    ai.direct = null;
                    ai.leader = null;
                    ai.fleePath = null;
                    ai.fleePlanned = false;
                }
            }

            // Rocked back by a punch
            if (ai.shoveT > 0 && ped.state !== 'held' && ped.state !== 'downed') {
                ai.shoveT -= dt;
                const k = Math.max(0, ai.shoveT / 0.25);
                ped.mesh.position.x += ai.shoveX * k * dt;
                ped.mesh.position.z += ai.shoveZ * k * dt;
            }
            switch (ped.state) {
                case 'talking': this._updateTalking(ped, dt, ctx); break;
                case 'fleeing': this._updateFleeing(ped, dt); break;
                case 'sitting': this._updateSitting(ped, dt); break;
                case 'hanging_out': this._updateHanging(ped, dt); break;
                case 'waiting_to_cross': this._updateWaiting(ped, dt); break;
                case 'idle': this._updateIdle(ped, dt); break;
                case 'fighting': this._updateFighting(ped, dt, ctx); break;
                case 'downed': this._updateDowned(ped, dt); break;
                case 'held': this._updateHeld(ped, dt); break;
                case 'activity': this.scenes.updatePed(ped, dt, ctx); break;
                case 'bar': if (ped.barCtl) ped.barCtl.updatePed(ped, dt, ctx); break;
                case 'following': this._updateFollowing(ped, dt); break;
                default: this._updateWalking(ped, dt); break;
            }
            // People lying on the ground or kneeling in cuffs don't leap out of the way of cars
            const grounded = ped.state === 'activity' && ai.act && ai.act.stay;
            if (ped.state !== 'fleeing' && ped.state !== 'sitting' && ped.state !== 'bar' && ped.state !== 'downed' && ped.state !== 'held' && !grounded && !ped.barCtl) this._dodgeCars(ped, dt);
            // A heavy night out sometimes catches up with someone on the way home
            if (ai.drunk > 0 && !ped.barCtl && (ped.state === 'walking' || ped.state === 'idle') && Math.random() < dt * 0.003 * ai.drunk) {
                this.scenes.startVomit(ped);
            }
            ai.lastState = ped.state;
        }

        // People who went indoors or got into their car
        for (let i = peds.length - 1; i >= 0; i--) {
            const ped = peds[i];
            if (ped.ai && ped.ai.vanish && !ped.isDead) this._removePed(ped, i);
        }

        this._separate(ctx);
        for (let i = 0; i < peds.length; i++) {
            const ped = peds[i];
            if (ped.ai && !ped.isDead && ped.state !== 'ragdoll' && ped.state !== 'carjacked' && !ped.isPoliceOfficer && ped.state !== 'bar') {
                this._animate(ped, dt);
            }
        }
        this._updateOfficers(ctx.officers, dt);
        this._collectCrossingObstacles();
        // Officers, dogs, leashes and scene props are drawn with the people
        const extras = this._extras;
        extras.length = 0;
        if (ctx.officers) for (let i = 0; i < ctx.officers.length; i++) extras.push(ctx.officers[i]);
        const sceneExtras = this.scenes.extras;
        for (let i = 0; i < sceneExtras.length; i++) extras.push(sceneExtras[i]);
        for (let i = 0; i < this.extraRigs.length; i++) extras.push(this.extraRigs[i]);
        this.renderer.render(peds, ctx.center.x, ctx.center.z, this.renderDistance, extras);
        for (let i = 0; i < this.extraMusic.length; i++) this.scenes.music.push(this.extraMusic[i]);
        this.music.update(this.scenes.music, ctx.playerPos || ctx.center);
    }


    // --------------------------------------------------------------------------------------------
    // Replicas (another player's game simulates these people; see netWorld.js)
    // --------------------------------------------------------------------------------------------
    /** Switches between simulating the people here and drawing the owner's. */
    setReplicaMode(on) {
        on = !!on;
        if (on === this.replicaMode) return;
        // Whoever was here goes either way: the other mode starts from a clean street
        for (let i = this.pedestrians.length - 1; i >= 0; i--) {
            const ped = this.pedestrians[i];
            if (ped.isPoliceOfficer || ped.keepOnModeChange) continue;
            this._removePed(ped, i);
        }
        for (const s of [...this.scenes.scenes]) this.scenes._end(s);
        this.scenes.dogs.length = 0;
        this.replicaMode = on;
        if (on) this._lastCenter = null;
        else this.replicaExtras.length = 0;
    }

    /** A person drawn for someone else's simulation. `net` is its id there. */
    makeReplicaPed(netId, style = 'adult', lookSeed = 1, options = {}) {
        const mesh = this.createPedestrianMesh(lookSeed, Object.assign({ style }, options));
        const ped = {
            id: `net_${netId}`,
            index: this._nextIndex++,
            mesh,
            position: mesh.position,
            velocity: new THREE.Vector3(),
            speed: 0,
            state: 'walking',
            hp: 100,
            maxHp: 100,
            isDead: false,
            walkPhase: Math.random() * TWO_PI,
            fleeTimer: 0, talkTimer: 0, talkCount: 0,
            style, lookSeed,
            net: { id: netId, x: 0, z: 0, yaw: 0, fresh: true }
        };
        mesh.userData.pedestrian = ped;
        this._initAI(ped);
        ped.ai.noThin = true;
        this.pedestrians.push(ped);
        return ped;
    }

    removeReplicaPed(ped) {
        this._removePed(ped);
    }

    /** What the owner says this person is doing now. */
    applyReplicaState(ped, s) {
        const ai = ped.ai;
        const n = ped.net;
        n.x = s.x; n.z = s.z; n.yaw = s.yaw;
        const b = s.b;
        if (b) {
            if (b[5] / 10 > (ped.faceDmg || 0) + 0.05) this.bruiseFace(ped, b[5] / 10 - (ped.faceDmg || 0));
            if (b[6] && !ped.headGone) this.goreHead(ped);
            for (const limb in LIMB_BITS) if ((b[9] & LIMB_BITS[limb]) && !(ped.limbsGone & LIMB_BITS[limb])) this.goreLimb(ped, limb);
            if (!n.local) ped.hp = b[7];
        }
        // While we hold them we move them; the owner only gets told
        if (n.local) {
            if ((s.flags & 256) && !ped.isDead) n.local = false;
            else return;
        }
        // (just let go: a moment for the owner to catch up before its old position pulls them back)
        if (n.releasedAt !== undefined && this._time - n.releasedAt < 0.6) return;
        if (n.fresh) {
            n.fresh = false;
            ped.mesh.position.set(s.x, 0, s.z);
            ai.yaw = s.yaw;
        }
        const f = s.flags | 0;
        ai.pose = s.pose;
        ai.moveSpeed = s.speed;
        ai.phone = !!(f & 1);
        ai.drunk = (f & 2) ? 1 : 0;
        ai.old = !!(f & 4);
        ai.cuffed = !!(f & 8);
        ai.bags = !!(f & 16);
        ai.flashlight = !!(f & 32);
        ai.speaking = !!(f & 64);
        ai.study = !!(f & 128);
        ai.carry = !!(f & 2048);
        ai.punching = (f & 4096) ? 0.2 : 0;
        ai.seat = s.seat;
        if ((f & 512) || (f & 1024) || (ai.act && ai.act.net)) ai.act = { net: true, write: !!(f & 512), snore: !!(f & 1024), role: null };
        else if (ai.act && ai.act.net) ai.act = null;
        // Held items
        const want = s.props || [];
        const rig = ped.mesh.userData.rig;
        if (rig) {
            const have = rig.props;
            for (const slot of ['R', 'L', 'T']) {
                let part = null, color = 0;
                for (let i = 0; i < want.length; i += 3) if (want[i] === slot) { part = want[i + 1]; color = want[i + 2]; }
                const cur = have[slot];
                if ((cur ? cur.part : null) !== part || (cur && part && cur.color.getHex() !== color)) this.setProp(ped, slot, part, color);
            }
        }
        const dead = !!(f & 256);
        if (dead && !ped.isDead && ped.state !== 'dying' && ped.state !== 'ragdoll') {
            // We never saw it happen (we arrived later): it is just lying there
            ped.isDead = true;
            ped.state = 'dead';
            ai.deadPosed = false;
        }
        if (b && b[8] && ped.isDead && !ai.wallSlump) {
            // Sat dead against a wall where the owner has them
            this.slumpDead(ped);
            ped.mesh.position.set(s.x, 0, s.z);
            ped.mesh.rotation.set(0, s.yaw, 0);
            ai.yaw = s.yaw;
            return;
        }
        if (ped.isDead || ped.state === 'dying' || ped.state === 'ragdoll') {
            if (ai.wallSlump) return;
            // The fall itself plays out locally from the event; a body that came to rest is placed where the owner has it
            if (ped.state === 'dead' && !ped.death && s.q) {
                ped.mesh.position.set(s.x, s.q.py, s.z);
                ped.mesh.quaternion.set(s.q.x, s.q.y, s.q.z, s.q.w);
            }
            return;
        }
        ped.state = s.state === 'dead' ? 'idle' : s.state;
        if (b && ped.state === 'held') {
            ai.held = ai.held || { t: 0, escape: 0, struggle: 0, moving: 0, downPose: 'back' };
            ai.held.mode = HELD_MODES[b[0]] || 'drag';
            ai.held.lying = !!b[1];
            ai.held.moving = Math.min(1, s.speed / 3);
        } else if (ped.state !== 'held') ai.held = null;
        if (b && ped.state === 'downed') {
            ai.downPose = DOWN_POSES[b[2]] || 'back';
            if (Math.abs((ai.downAge || 0) - b[3] / 10) > 0.3 && (ai.downAge || 0) < 1) ai.downAge = b[3] / 10;
            ai.getUp = b[4] / 10;
        } else if (ped.state !== 'downed') ai.downAge = 0;
    }

    /** Peds from another game: follow their targets and animate; no AI, no spawning. */
    _updateReplicaMode(dt, ctx) {
        this._time += dt;
        this.night = ctx.night || 0;
        this._lastCtx = ctx;
        if (this.nav) this.furniture.update(ctx.center.x, ctx.center.z);
        const peds = this.pedestrians;
        const a = 1 - Math.exp(-dt * 12);
        for (let i = 0; i < peds.length; i++) {
            const ped = peds[i];
            if (ped.isPoliceOfficer) continue;
            if (!ped.ai) this._initAI(ped);
            const ai = ped.ai;
            if (ped.state === 'dying') { this._updateDying(ped, dt); continue; }
            if (ped.state === 'ragdoll' || ped.isDead) {
                if (ai.wallSlump) this._updateWallSlump(ped, dt);
                else if (ped.death) this._updateDeathMotion(ped, dt);
                else if (ped.state === 'dead' && !ai.deadPosed) this._poseDead(ped);
                continue;
            }
            const n = ped.net;
            if (n && n.local) {
                // We hold them: game.html places them; just the animation clock here
                if (ped.state === 'downed') ai.downAge = (ai.downAge || 0) + dt;
                if (ai.held) ai.held.t += dt;
                ped.mesh.rotation.set(0, ai.yaw, 0);
                this._animate(ped, dt);
                continue;
            }
            if (n && ped.state === 'downed') ai.downAge = (ai.downAge || 0) + dt;
            if (!n) {
                // Ours alone (a driver who just got carjacked): runs off and is gone after a while
                ai.localAge = (ai.localAge || 0) + dt;
                if (ped.state === 'carjacked' && ai.carOut) { this._updateCarOut(ped, dt); continue; }
                if (ped.state === 'fleeing') this._updateFleeing(ped, dt);
                if (ai.localAge > 15 && ped.state !== 'carjacked') ai.vanish = true;
                this._animate(ped, dt);
                continue;
            }
            const p = ped.mesh.position;
            const dx = n.x - p.x, dz = n.z - p.z;
            if (dx * dx + dz * dz > 196) { p.x = n.x; p.z = n.z; } else { p.x += dx * a; p.z += dz * a; }
            ai.yaw = lerpAngle(ai.yaw, n.yaw, a);
            ped.mesh.rotation.set(0, ai.yaw, 0);
            this._animate(ped, dt);
        }
        for (let i = peds.length - 1; i >= 0; i--) if (peds[i].ai && peds[i].ai.vanish && !peds[i].isDead) this._removePed(peds[i], i);
        this._updateOfficers(ctx.officers, dt);
        const extras = this._extras;
        extras.length = 0;
        if (ctx.officers) for (let i = 0; i < ctx.officers.length; i++) extras.push(ctx.officers[i]);
        for (let i = 0; i < this.replicaExtras.length; i++) extras.push(this.replicaExtras[i]);
        for (let i = 0; i < this.extraRigs.length; i++) extras.push(this.extraRigs[i]);
        this.renderer.render(peds, ctx.center.x, ctx.center.z, this.renderDistance, extras);
    }

    _removePed(ped, i = this.pedestrians.indexOf(ped)) {
        this._releaseActivity(ped);
        if (ped.ai) {
            ped.ai.dog = null;
            ped.ai.vanish = false;
        }
        if (ped.mesh.parent) ped.mesh.parent.remove(ped.mesh);
        if (i >= 0) this.pedestrians.splice(i, 1);
    }

    /**
     * Puts an item in a ped's hand ('R' / 'L') or against their chest ('T', a rake), or takes it
     * away (part null). Parts are PROP_PARTS in pedestrianScenes.js.
     */
    setProp(ped, slot, part, color = 0xffffff) {
        const rig = ped.mesh && ped.mesh.userData.rig;
        if (!rig) return;
        const old = rig.props[slot];
        if (old) {
            const i = rig.bindings.indexOf(old);
            if (i >= 0) rig.bindings.splice(i, 1);
            rig.props[slot] = null;
        }
        if (!part) return;
        let j = slot === 'L' ? rig.handL : rig.handR;
        if (slot === 'T') {
            if (!rig.chest) {
                rig.chest = new THREE.Object3D();
                rig.chest.position.set(0, 0.36, 0.16);
                rig.chest.rotation.x = 0.8;
                rig.torso.add(rig.chest);
            }
            j = rig.chest;
        }
        const b = { part, joint: j, color: new THREE.Color(color) };
        rig.bindings.push(b);
        rig.props[slot] = b;
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
        p.y = ped.floorY || 0;
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

    /** Next stop for someone walking a long way east (+1) or west (-1) along the street. */
    _headingStop(ped) {
        const ai = ped.ai;
        const nav = this.nav;
        const p = ped.mesh.position;
        const nodes = nav.walkNodesInRing(p.x, p.z, 80, 180, this._ring);
        let best = -1, bestScore = -Infinity;
        for (let i = 0; i < nodes.length; i += 3) {
            const n = nodes[i];
            const dx = (nav.nodeX[n] - p.x) * ai.heading, dz = Math.abs(nav.nodeZ[n] - p.z);
            if (dx < 60 || dz > dx * 0.4) continue;
            const score = dx - dz * 2 + Math.random() * 25;
            if (score > bestScore) {
                bestScore = score;
                best = n;
            }
        }
        if (best < 0) {
            ai.heading = 0;
            return this._nextStop(ped);
        }
        return best;
    }

    /** Sends a walker to the front door of a building of one of `kinds` (DOOR_KIND) nearby. */
    _doorGoal(ped, kinds) {
        const nav = this.nav;
        if (!kinds || !kinds.length || !nav.doorCount) return false;
        const p = ped.mesh.position;
        const doors = nav.doorsInRing(p.x, p.z, 25, PED_CONFIG.DOOR_RANGE, this._ring2);
        let pickDoor = -1, seen = 0;
        for (let i = 0; i < doors.length; i++) {
            const d = doors[i];
            if (!kinds.includes(nav.doorKind[d])) continue;
            // Reservoir pick: an even chance for every matching door
            if (Math.random() * ++seen < 1) pickDoor = d;
        }
        if (pickDoor < 0) return false;
        ped.ai.goal = { type: 'door', door: pickDoor, access: nav.doorAccess[pickDoor] };
        ped.ai.path = null;
        ped.ai.stops = null;
        return true;
    }

    /** Sends a walker to a parked car nearby (they get in and are gone). */
    _carGoal(ped) {
        const pc = this.parkedCars;
        if (!pc || !pc.active.size) return false;
        const p = ped.mesh.position;
        let best = null, seen = 0;
        for (const v of pc.active.values()) {
            if (!v.isParked || !v.driverGone || v._walkerTarget) continue;
            const d = Math.hypot(v.position.x - p.x, v.position.z - p.z);
            if (d < 20 || d > 170) continue;
            if (Math.random() * ++seen < 1) best = v;
        }
        if (!best) return false;
        const access = this.nav.nearestWalkNode(best.position.x, best.position.z, 45);
        if (access < 0) return false;
        best._walkerTarget = ped;
        ped.ai.goal = { type: 'car', vehicle: best, access };
        ped.ai.path = null;
        ped.ai.stops = null;
        return true;
    }

    // ---- Walking together ----
    _spawnFollower(leader, slot, style) {
        const lp = leader.mesh.position;
        const y = leader.ai.yaw;
        const side = slot % 2 === 0 ? 0.75 : -0.75;
        const ped = this._makePed(lp.x + Math.cos(y) * side - Math.sin(y) * 0.4 * (1 + (slot >> 1)), lp.z - Math.sin(y) * side - Math.cos(y) * 0.4 * (1 + (slot >> 1)), y, style);
        ped.ai.leader = leader;
        ped.ai.followSlot = slot;
        ped.ai.jogger = leader.ai.jogger;
        ped.ai.walkSpeed = leader.ai.walkSpeed;
        ped.state = 'following';
        return ped;
    }

    /** Keeps formation with the group's leader; on their own once the leader's gone. */
    _updateFollowing(ped, dt) {
        const ai = ped.ai;
        const L = ai.leader;
        const leaderOk = L && !L.isDead && L.ai && this.pedestrians.includes(L) &&
            (L.state === 'walking' || L.state === 'crossing' || L.state === 'waiting_to_cross' || L.state === 'idle' ||
             L.state === 'following' || L.state === 'talking');
        if (L && L.ai && L.ai.vanish) {
            // Going in together
            ai.vanish = true;
            return;
        }
        const p = ped.mesh.position;
        if (!leaderOk || Math.hypot(L.mesh.position.x - p.x, L.mesh.position.z - p.z) > 30) {
            if (L && L.state === 'fleeing') {
                ped.state = 'fleeing';
                ped.fleeTimer = 200;
                ped.speed = 0.15;
                ped.velocity.copy(L.velocity);
            } else {
                ped.state = 'walking';
            }
            ai.leader = null;
            ai.cuffed = false;
            return;
        }
        const lp = L.mesh.position;
        const y = L.ai.yaw;
        const fx = Math.sin(y), fz = Math.cos(y), rx = Math.cos(y), rz = -Math.sin(y);
        const s = ai.followSlot;
        let side, back;
        if (L.ai.jogger) {
            // Running in pairs, one pair behind the other
            side = s % 2 === 0 ? -0.55 : 0.55;
            back = 1.1 * (1 + (s >> 1)) - (s % 2 === 0 ? 1.1 : 0);
        } else {
            // Abreast, spilling into a second row
            side = (s % 2 === 0 ? 0.75 : -0.75) * (1 + ((s >> 1) % 2) * 0.4);
            back = 0.15 + 0.6 * (s >> 1);
        }
        const tx = lp.x + rx * side - fx * back, tz = lp.z + rz * side - fz * back;
        const d = Math.hypot(tx - p.x, tz - p.z);
        const lMoving = L.ai.moveSpeed > 0.2;
        const speed = Math.min((L.ai.jogger ? 4.2 : 2.4) * (1 - 0.2 * ai.drunk), Math.max(L.ai.moveSpeed, 0.6) * (1 + Math.min(1.2, d * 0.8)));
        if (d > 0.12) {
            this._moveTo(ped, tx, tz, speed, dt, 0.05);
            ai.pose = (L.ai.jogger && lMoving) || speed > 2.4 ? 'run' : 'walk';
            if (!lMoving && d < 0.6) this._turnTowards(ped, y, dt, 4);
        } else {
            ai.moveSpeed = 0;
            ai.pose = 'stand';
            this._turnTowards(ped, y, dt, 4);
        }
        // Chatting on the way
        ai.look = lMoving ? (Math.sin(this._time * 0.5 + ai.seed * 7) > 0.4 ? (side > 0 ? -0.6 : 0.6) : 0) : 0;
    }

    /** Spawns a walker of district walker `kind` at walk node `node`. Returns people spawned. */
    _spawnWalkerKind(kind, node, style, table) {
        const nav = this.nav;
        const night = this.night > 0.5;
        const dressUp = (ped) => {
            if (ped.style === 'shopper' && Math.random() < 0.6) {
                this.setProp(ped, 'L', 'bag', pick(Math.random, [0xf5f0e1, 0xc8a165, 0x1565c0, 0xd32f2f, 0xffffff]));
                this.setProp(ped, 'R', 'bag', pick(Math.random, [0xf5f0e1, 0xc8a165, 0xd32f2f]));
                ped.ai.bags = true;
            } else if (ped.style === 'partier' && Math.random() < 0.4) {
                const smoke = Math.random() < 0.4;
                this.setProp(ped, 'R', smoke ? 'cigarette' : 'cup', smoke ? 0xf4f4f4 : 0xd32f2f);
                ped.ai.carry = true;
                ped.ai.phone = false;
            }
            return ped;
        };
        switch (kind) {
            case 'jog':
            case 'jogGroup': {
                const lead = this._spawnWalker(node, 'athlete');
                lead.ai.jogger = true;
                lead.ai.phone = false;
                lead.ai.walkSpeed = PED_CONFIG.JOG_SPEED * (0.85 + Math.random() * 0.2);
                if (kind === 'jog') return 1;
                const n = 1 + ((Math.random() * 3) | 0);
                for (let i = 0; i < n; i++) this._spawnFollower(lead, i, 'athlete');
                return 1 + n;
            }
            case 'walkGroup': {
                const lead = dressUp(this._spawnWalker(node, style));
                const n = 1 + ((Math.random() * (night ? 4 : 2)) | 0);
                if (style === 'partier') lead.ai.drunk = Math.random() < 0.5 ? 0.3 + Math.random() * 0.4 : 0;
                lead.ai.walkSpeed = Math.min(lead.ai.walkSpeed, 1.3);
                lead.ai.phone = false;
                for (let i = 0; i < n; i++) {
                    const f = dressUp(this._spawnFollower(lead, i, style));
                    f.ai.drunk = lead.ai.drunk * Math.random();
                    f.ai.phone = Math.random() < 0.1;
                }
                if (table && table.doors && Math.random() < 0.35) this._doorGoal(lead, table.doors);
                return 1 + n;
            }
            case 'dog': {
                const ped = this._spawnWalker(node, style === 'partier' || style === 'athlete' ? 'adult' : style);
                ped.ai.jogger = false;
                ped.ai.phone = false;
                ped.ai.walkSpeed = Math.min(ped.ai.walkSpeed, 1.25);
                this.scenes.addDog(ped);
                return 1;
            }
            case 'drunk': {
                const ped = dressUp(this._spawnWalker(node, 'partier'));
                ped.ai.drunk = 0.5 + Math.random() * 0.5;
                ped.ai.phone = false;
                return 1;
            }
            case 'toDoor': {
                const ped = dressUp(this._spawnWalker(node, style));
                if (table) this._doorGoal(ped, table.doors);
                return 1;
            }
            case 'fromDoor': {
                const kinds = table && table.doors;
                const doors = kinds ? nav.doorsInRing(nav.nodeX[node], nav.nodeZ[node], 0, 60, this._ring2) : [];
                let door = -1, seen = 0;
                for (let i = 0; i < doors.length; i++) {
                    if (kinds.includes(nav.doorKind[doors[i]]) && Math.random() * ++seen < 1) door = doors[i];
                }
                if (door < 0) return this._spawnWalkerKind('walk', node, style, table);
                // Steps out of the front door and heads off
                const acc = nav.doorAccess[door];
                const yaw = Math.atan2(nav.nodeX[acc] - nav.doorX[door], nav.nodeZ[acc] - nav.doorZ[door]);
                const ped = dressUp(this._makePed(nav.doorX[door], nav.doorZ[door], yaw, style));
                this._pickStops(ped, acc);
                ped.ai.direct = { x: nav.nodeX[acc], z: nav.nodeZ[acc], then: 'resume' };
                ped.state = 'walking';
                if (style === 'partier') ped.ai.drunk = Math.random() < 0.5 ? 0.4 + Math.random() * 0.5 : 0;
                let n = 1;
                if (Math.random() < 0.25) {
                    this._spawnFollower(ped, 0, style);
                    n++;
                }
                return n;
            }
            case 'toCar': {
                const ped = dressUp(this._spawnWalker(node, style));
                if (style === 'partier') ped.ai.drunk = 0.3 + Math.random() * 0.6;
                this._carGoal(ped);
                return 1;
            }
            case 'headEast':
            case 'headWest': {
                const ped = dressUp(this._spawnWalker(node, style));
                ped.ai.heading = kind === 'headEast' ? 1 : -1;
                ped.ai.stops = null;
                ped.ai.goal = null;
                if (style === 'partier' && Math.random() < 0.4) {
                    const n = 1 + ((Math.random() * 3) | 0);
                    for (let i = 0; i < n; i++) dressUp(this._spawnFollower(ped, i, style));
                    return 1 + n;
                }
                return 1;
            }
            default:
                dressUp(this._spawnWalker(node, style));
                return 1;
        }
    }

    // --------------------------------------------------------------------------------------------
    // States
    // --------------------------------------------------------------------------------------------
    _updateWalking(ped, dt) {
        const ai = ped.ai;
        const nav = this.nav;
        if (ped.state === 'crossing' && ai.crossA < 0) ped.state = 'walking';
        const crossing = ped.state === 'crossing';
        let speed = ai.walkSpeed * (crossing ? 1.1 : 1) * (1 - 0.3 * ai.drunk);
        if (crossing && ai.hurry) speed = Math.max(speed, 3.6);
        ai.overlay = null;
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
                else if (d.then === 'enter') ai.vanish = true; // indoors / into the car
                else ai.path = null;
            }
            return;
        }

        // Drunk: weaving about and the odd stumble
        if (ai.drunk > 0 && !crossing && Math.random() < dt * 0.04 * ai.drunk) {
            this._becomeIdle(ped, 0.8 + Math.random() * 1.6);
            return;
        }

        if (!ai.path) {
            if (!ai.goal) ai.goal = { type: 'stop', node: ai.heading ? this._headingStop(ped) : this._nextStop(ped) };
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
            const lane = ai.laneOffset + (ai.drunk > 0 ? Math.sin(this._time * 1.3 + ai.seed) * 0.8 * ai.drunk : 0);
            tx += (-ez / el) * lane;
            tz += (ex / el) * lane;
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
        } else if (goal && goal.type === 'door') {
            // Up to the front door and inside
            ai.direct = { x: nav.doorX[goal.door], z: nav.doorZ[goal.door], then: 'enter' };
            return;
        } else if (goal && goal.type === 'car') {
            const v = goal.vehicle;
            if (v && v.isParked && !v.isPlayer && v.driverGone && v._walkerTarget === ped &&
                Math.hypot(v.position.x - nav.nodeX[goal.access], v.position.z - nav.nodeZ[goal.access]) < 45) {
                // To the driver's door and in
                const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
                ai.direct = { x: v.position.x - fz * 1.3 + fx * 0.3, z: v.position.z + fx * 1.3 + fz * 0.3, then: 'enter' };
                return;
            }
        } else if (goal && goal.type === 'scene') {
            if (this.scenes.arrived(ped, goal)) return;
        }

        // Heading somewhere along the street (E Wooster): keep going
        if (ai.heading) {
            const p = ped.mesh.position;
            const district = districtAt(p.x, p.z);
            if (ai.heading < 0 && district.type === 'BARS') {
                // Made it downtown: into a bar (or just wander about)
                ai.heading = 0;
                if (this._doorGoal(ped, [DOOR_KIND.BAR, DOOR_KIND.FOOD])) return;
            }
            this._becomeIdle(ped, 0.3 + Math.random());
            return;
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

    /** The car (if any) about to run this ped down: { car, lateral } */
    _carBearingDown(ped) {
        const p = ped.mesh.position;
        const cars = this._cars;
        for (let i = 0; i < cars.length; i++) {
            const c = cars[i];
            if (c.speed < 4) continue;
            const rx = p.x - c.x, rz = p.z - c.z;
            if (Math.abs(rx) > 20 || Math.abs(rz) > 20) continue;
            const along = rx * c.fx + rz * c.fz;
            if (along < 0 || along / c.speed > 1.1) continue;
            const lateral = rx * c.fz - rz * c.fx;
            if (Math.abs(lateral) > 1.6) continue;
            return { car: c, lateral };
        }
        return null;
    }

    /**
     * Getting out of the way of a car bearing down on us. People need a moment to notice and react
     * (longer if they're busy), some freeze in the headlights, and a sidestep only covers a couple
     * of metres, so a fast car usually gets them and a slow one usually doesn't.
     */
    _dodgeCars(ped, dt = 1 / 60) {
        const ai = ped.ai;
        const threat = this._carBearingDown(ped);
        if (!threat) {
            ai.dodgeReact = -1;
            return;
        }
        if (!(ai.dodgeReact >= 0)) {
            const busy = ped.state === 'talking' || ped.state === 'hanging_out' || ped.state === 'fighting';
            ai.dodgeReact = 0.3 + Math.random() * 0.45 + (busy ? 0.25 : 0);
            ai.dodgeFreeze = Math.random() < 0.22;
            return;
        }
        ai.dodgeReact -= dt;
        // Turn to look at it while it sinks in
        const p = ped.mesh.position;
        ai.look = Math.max(-1.3, Math.min(1.3, angleDiff(ai.yaw, Math.atan2(threat.car.x - p.x, threat.car.z - p.z))));
        if (ai.dodgeReact > 0) return;

        const c = threat.car;
        const side = threat.lateral >= 0 ? 1 : -1;
        this._releaseActivity(ped);
        ped.state = 'fleeing';
        ai.path = null;
        ai.direct = null;
        ai.dodgeReact = -1;
        if (ai.dodgeFreeze) {
            // Rooted to the spot
            ped.fleeTimer = 45;
            ped.speed = 0;
            ped.velocity.set(0, 0, 0);
            return;
        }
        // A quick lunge to the side: ~2.5 m
        ped.fleeTimer = 34;
        ped.speed = 0.075;
        ped.velocity.set(c.fz * side * ped.speed, 0, -c.fx * side * ped.speed);
    }

    /**
     * Fleeing on the walking graph: picks a far node away from the threat (the way `velocity` points)
     * once per flight and runs the path to it. Returns false when there's no route (the caller then
     * falls back to running in a straight line).
     */
    _fleeAlongNav(ped, dt) {
        const ai = ped.ai;
        const nav = this.nav;
        const p = ped.mesh.position;
        if (!ai.fleePath) {
            if (ai.fleePlanned) return false;
            if (this._pathBudget <= 0) { ai.moveSpeed = 0; ai.pose = 'run'; return true; }
            this._pathBudget--;
            ai.fleePlanned = true;
            const start = this._currentNode(ped, 40);
            if (start < 0) return false;
            const vl = Math.hypot(ped.velocity.x, ped.velocity.z) || 1;
            const fx = ped.velocity.x / vl, fz = ped.velocity.z / vl;
            const ring = nav.walkNodesInRing(p.x, p.z, 50, 130, this._ring);
            let best = -1, bestScore = -Infinity;
            for (let i = 0; i < ring.length; i += 2) {
                const n = ring[i];
                const dx = nav.nodeX[n] - p.x, dz = nav.nodeZ[n] - p.z;
                const score = (dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1) + Math.random() * 0.7;
                if (score > bestScore) { bestScore = score; best = n; }
            }
            if (best < 0) return false;
            const path = nav.findPath(start, best);
            if (!path || !path.length) return false;
            ai.fleePath = path;
            ai.fleeIdx = 0;
        }
        if (ai.fleeIdx >= ai.fleePath.length) {
            ai.fleePath = null;
            ped.fleeTimer = 0;      // got away: back to strolling
            ai.moveSpeed = 0;
            ped.state = 'walking';
            ped.speed = 0.06;
            ai.path = null; ai.goal = null; ai.stops = null; ai.direct = null;
            return true;
        }
        const node = ai.fleePath[ai.fleeIdx];
        ai.pose = 'run';
        ped.fleeTimer = Math.max(ped.fleeTimer, 30);
        if (this._moveTo(ped, nav.nodeX[node], nav.nodeZ[node], 6.5, dt, 0.8)) ai.fleeIdx++;
        ai.pose = 'run';
        return true;
    }

    _updateFleeing(ped, dt) {
        const ai = ped.ai;
        const stepScale = dt / (1 / 60);
        ped.fleeTimer -= stepScale;
        const p = ped.mesh.position;
        // Run along the sidewalk graph (not straight through buildings)
        if (this.nav && !ai.fleeStraight && this._fleeAlongNav(ped, dt)) return;
        p.x += ped.velocity.x * stepScale;
        p.z += ped.velocity.z * stepScale;
        p.y = ped.floorY || 0;
        const vlen = Math.hypot(ped.velocity.x, ped.velocity.z);
        if (vlen > 1e-4) this._turnTowards(ped, Math.atan2(ped.velocity.x, ped.velocity.z), dt, 14);
        ai.pose = vlen > 1e-4 ? 'run' : 'stand'; // (frozen in the headlights)
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
        const act = ai.resumeState === 'activity' ? ai.act : null;
        if (act && act.stay) {
            // Lying down / kneeling: stay put, just turn the head and answer
            ai.pose = act.pose;
            ai.speaking = true;
            ai.look = Math.max(-1.2, Math.min(1.2, angleDiff(ai.yaw, toPlayer)));
        } else if (ai.resumeState === 'sitting' && ai.seat >= 0) {
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
            else if (resume === 'activity' && ai.act) ped.state = 'activity';
            else if (resume === 'following' && ai.leader) ped.state = 'following';
            else if (resume === 'bar' && ped.barCtl) ped.state = 'bar';
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
        if (ai.act) this.scenes.release(ped);
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
            (p.state === 'walking' || p.state === 'crossing' || p.state === 'idle' || p.state === 'waiting_to_cross' ||
             p.state === 'fighting' || p.state === 'following');
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
        // Pinned to a wall or held down they can take a long beating, but not forever
        const heldDown = ped.state === 'held' && ai.held && (ai.held.mode === 'pin' || ai.held.mode === 'mount');
        if (heldDown && !ped.net) hit = Object.assign({}, hit, { damage: hit.damage * 0.3 });
        if (ped.net) {
            // Someone else's person: they decide whether it lands; we just show the stagger
            if (this.net) this.net.cmd('punch', { id: ped.net.id, hit: pickHit(hit) });
            ai.flinch = 1;
            ai.flinchMove = hit.move || 'cross';
            ai.flinchSide = hit.side || (Math.random() < 0.5 ? 1 : -1);
            return { knockedOut: false };
        }
        ped.hp -= hit.damage;
        const p = ped.mesh.position;
        const grounded = ped.state === 'downed' || (ped.state === 'held' && ai.held && ai.held.lying);
        const pinned = ped.state === 'held' && ai.held && (ai.held.mode === 'pin' || ai.held.mode === 'mount');
        if (hit.move) this.bruiseFace(ped, pinned ? 1 : 0.5);
        // Stagger back along the punch over a moment (not when lying down, or held against a wall)
        const power = { jab: 0.6, cross: 1, hook: 1.1, uppercut: 1.2, stomp: 0 }[hit.move] ?? 1;
        if (!grounded && ped.state !== 'held') {
            ai.shoveX = hit.dirX * 1.8 * power;
            ai.shoveZ = hit.dirZ * 1.8 * power;
            ai.shoveT = 0.25;
        }
        ai.flinchMove = hit.move || 'cross';
        ai.flinch = 1;
        ai.flinchSide = hit.side || (Math.random() < 0.5 ? 1 : -1);
        ai.punching = 0; // a hit interrupts their own swing
        if (ai.held) ai.held.escape = Math.max(0, ai.held.escape - 0.35); // a beating saps the will to wriggle free
        if (ped.hp <= 0) {
            if (ped.isPoliceOfficer) return { knockedOut: true }; // police.js handles officers
            const kill = { x: hit.x, y: hit.y !== undefined ? hit.y : p.y + 1.6, z: hit.z, dirX: hit.dirX, dirY: 0, dirZ: hit.dirZ };
            if (grounded) this._dieOnGround(ped, kill);
            else {
                if (ped.state === 'held') ai.held = null;
                if (pinned) ped.state = 'idle';
                this.startShotDeath(ped, kill);
                if (pinned) this.slumpDead(ped);   // beaten to death against the wall: down it they slide
            }
            return { knockedOut: true, pinned };
        }
        if (ped.isPoliceOfficer) return { knockedOut: false };
        if (grounded) {
            ai.downT = Math.max(ai.downT || 0, 1.2) + 0.5; // kept down by the beating
            ai.getUp = 0;
            return { knockedOut: false };
        }
        if (ped.state === 'held') return { knockedOut: false, pinned };
        if (hit.knock && Math.random() < hit.knock + (ped.hp < 40 ? 0.25 : 0)) {
            this.knockDown(ped, hit.dirX, hit.dirZ);
            return { knockedOut: false, knockedDown: true };
        }
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
        p.y = ped.floorY || 0;

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
                if (dist < 1.55 && typeof ctx.onPlayerHit === 'function') ctx.onPlayerHit(ped, (7 + Math.random() * 6) * (ai.punchSlow ? 0.75 : 1));
            }
            if (ai.punching >= 0.5) {
                ai.punching = 0;
                ai.punchCd = (0.6 + Math.random() * 1.0) * (ai.punchSlow || 1);
            }
        }
    }

    // --------------------------------------------------------------------------------------------
    // Brawls: knocked down, grabbed, dragged, pinned (the player's side is in game.html / brawl.js)
    // --------------------------------------------------------------------------------------------
    /** Puts someone on the ground for a few seconds, falling along (dirX, dirZ) over fallDur seconds. */
    knockDown(ped, dirX = 0, dirZ = 0, secs = null, fallDur = 0.45) {
        if (!ped || ped.isDead || ped.isPoliceOfficer || (ped.net && !ped.net.local) || !ped.mesh || ped.state === 'ragdoll' || ped.state === 'dying') return false;
        if (!ped.ai) this._initAI(ped);
        const ai = ped.ai;
        this._releaseActivity(ped);
        ai.path = null;
        ai.direct = null;
        ai.punching = 0;
        ai.held = null;
        // Shoved the way they face: on the front; otherwise on the back (now and then the side)
        const facing = Math.sin(ai.yaw) * dirX + Math.cos(ai.yaw) * dirZ;
        ai.downPose = facing > 0.3 ? 'front' : (Math.random() < 0.25 ? 'side' : 'back');
        ai.downT = secs !== null ? secs : 3 + Math.random() * 3;
        ai.downAge = 0;
        ai.fallDur = fallDur;
        ai.getUp = 0;
        ai.fallDX = dirX;
        ai.fallDZ = dirZ;
        ai.moveSpeed = 0;
        ped.state = 'downed';
        ai.lastState = 'downed';
        ai.pose = 'downed';
        return true;
    }

    _updateDowned(ped, dt) {
        const ai = ped.ai;
        const p = ped.mesh.position;
        ai.downAge += dt;
        if (ai.downAge < 0.4) {
            // The fall carries them a little way
            const k = (0.4 - ai.downAge) * 2.5;
            p.x += ai.fallDX * k * dt * 1.6;
            p.z += ai.fallDZ * k * dt * 1.6;
        }
        p.y = ped.floorY || 0;
        ai.pose = 'downed';
        if (ai.getUp > 0) {
            ai.getUp += dt / 1.1;
            if (ai.getUp >= 1) {
                ai.getUp = 0;
                // Back up: angry ones come back for more, the rest run
                if (ai.fighter || Math.random() < 0.3) {
                    ai.fighter = true;
                    ped.state = 'fighting';
                    ai.fightTime = 0;
                    ai.punchCd = 0.4 + Math.random() * 0.4;
                } else {
                    ped.state = 'fleeing';
                    ped.fleeTimer = 240;
                    ped.speed = 0.17;
                }
                ai.lastState = ped.state;
                ai.pose = 'walk';
            }
            return;
        }
        ai.downT -= dt;
        if (ai.downT <= 0) ai.getUp = 0.001;
    }

    /** The player takes hold of someone (standing or lying). */
    grab(ped) {
        if (!ped || ped.isDead || ped.isPoliceOfficer || !ped.mesh || ped.state === 'ragdoll' || ped.state === 'dying' ||
            ped.state === 'carjacked' || ped.state === 'sitting') return false;
        if (ped.net) ped.net.local = true;   // someone else's: we move them while we hold them (game.html tells the owner)
        if (!ped.ai) this._initAI(ped);
        const ai = ped.ai;
        this._releaseActivity(ped);
        ai.path = null;
        ai.direct = null;
        ai.punching = 0;
        const lying = ped.state === 'downed';
        if (lying) ai.downPose = 'back'; // hauled by the wrists, they end up on their back
        ai.held = { mode: 'drag', lying, downPose: 'back', t: 0, escape: 0, struggle: 0.12 + Math.random() * 0.18, moving: 0 };
        ped.state = 'held';
        ai.lastState = 'held';
        ai.pose = 'held';
        return true;
    }

    /** game.html moves a held person each frame: where, which way they face, how ('drag' | 'pin'). */
    setHeld(ped, x, z, yaw, mode, dt = 0.016) {
        if (!ped || ped.state !== 'held' || !ped.ai.held) return;
        const H = ped.ai.held;
        const p = ped.mesh.position;
        const moved = Math.hypot(x - p.x, z - p.z);
        H.moving += (Math.min(1, moved / Math.max(dt, 1e-3) / 3) - H.moving) * Math.min(1, dt * 8);
        p.x = x;
        p.z = z;
        p.y = ped.floorY || 0;
        ped.ai.yaw = yaw;
        H.mode = mode;
        if (mode === 'pin' || mode === 'neck') H.lying = false;
    }

    /** Lets go. 'drop' leaves them on the ground; otherwise they stagger off (fight or flight). */
    release(ped, how = 'let') {
        if (!ped || ped.state !== 'held') return;
        const ai = ped.ai;
        const H = ai.held;
        ai.held = null;
        if (ped.net) {
            // Someone else's: back to what their game says (it's told the same)
            if (how === 'drop' && H && H.mode === 'pin') { this.knockDown(ped, 0, 0, 3); ai.downPose = 'wall'; }
            else if (H && H.lying) { this.knockDown(ped, 0, 0, 3); ai.downPose = 'back'; ai.downAge = 1; }
            ped.net.local = false;
            ped.net.releasedAt = this._time;
            return;
        }
        if (how === 'drop' && H && H.mode === 'pin') {
            // Off a wall: they slide down it and sit slumped against it (longer the worse the beating)
            this.knockDown(ped, 0, 0, ped.hp < 25 ? 8 + Math.random() * 6 : 2.5 + Math.random() * 2);
            ai.downPose = 'wall';
            return;
        }
        if (how === 'drop' || (H && H.lying)) {
            this.knockDown(ped, -Math.sin(ai.yaw) * 0.3, -Math.cos(ai.yaw) * 0.3, 1.5 + Math.random() * 2);
            if (H && H.lying) ai.downPose = H.downPose || 'back';
            ai.downAge = 1;  // already on the ground: no fall
            return;
        }
        if (ai.fighter || Math.random() < 0.35) {
            ai.fighter = true;
            ped.state = 'fighting';
            ai.fightTime = 0;
            ai.punchCd = 0.6;
        } else {
            ped.state = 'fleeing';
            ped.fleeTimer = 240;
            ped.speed = 0.17;
        }
        ai.lastState = ped.state;
        ai.pose = 'walk';
    }

    _updateHeld(ped, dt) {
        const ai = ped.ai;
        const H = ai.held;
        if (!H) {
            ped.state = 'fleeing';
            return;
        }
        H.t += dt;
        ai.pose = 'held';
        ai.moveSpeed = 0;
        // Wriggling free: standing people manage it eventually unless kept busy
        if (!H.lying && H.mode !== 'pin') {
            H.escape += dt * H.struggle;
            if (H.escape >= 1) {
                H.broke = true;
                this.release(ped, 'let');
            }
        }
    }

    /**
     * Damage to the face, in punches' worth: the skin goes red and purple, then a bloody nose and
     * mouth, swelling, cuts, blood down the shirt, and finally a smashed face with the eyes swollen shut.
     * Returns the total so far.
     */
    bruiseFace(ped, amount = 1) {
        const rig = ped && ped.mesh && ped.mesh.userData.rig;
        if (!rig || !rig.bindings || !rig.neck || ped.headGone) return 0;
        const f = (ped.faceDmg || 0) + amount;
        ped.faceDmg = f;
        const B = rig.bindings;
        const add = (part, j, hex) => { if (!B.some((b) => b.part === part)) B.push({ part, joint: j, color: new THREE.Color(hex) }); };
        const head = B.find((b) => b.part === 'head');
        if (head) {
            if (!head.skin0) head.skin0 = head.color.clone();
            head.color.copy(head.skin0).lerp(_BRUISED, Math.min(0.55, f * 0.05));
        }
        if (f >= 1) add('faceBlood', rig.neck, 0x7a0000);
        if (f >= 3) add('faceSwell', rig.neck, 0x6b3550);
        if (f >= 5) add('faceGash', rig.neck, 0x4a0000);
        if (f >= 6 && rig.torso) add('shirtBlood', rig.torso, 0x5c0000);
        if (f >= 8) {
            add('faceMash', rig.neck, 0x560000);
            const i = B.findIndex((b) => b.part === 'eyes');
            if (i >= 0) B.splice(i, 1);    // swollen shut
        }
        return f;
    }

    /** A point-blank shot to the head: there's not much head left (they're killed separately). */
    goreHead(ped) {
        const rig = ped && ped.mesh && ped.mesh.userData.rig;
        if (!rig || !rig.bindings || !rig.neck || ped.headGone) return;
        ped.headGone = true;
        const B = rig.bindings;
        const head = B.find((b) => b.part === 'head');
        const skin = head ? (head.skin0 || head.color).clone() : new THREE.Color(0xc68a62);
        const gone = new Set(['head', 'eyes', 'hairShort', 'hairLong', 'cap', 'policeHat', 'capBrim', 'faceBlood', 'faceSwell', 'faceGash', 'faceMash']);
        for (let i = B.length - 1; i >= 0; i--) if (gone.has(B[i].part)) B.splice(i, 1);
        B.push({ part: 'headGore', joint: rig.neck, color: new THREE.Color(0x5a0000) });
        B.push({ part: 'skullStub', joint: rig.neck, color: skin.lerp(_BRUISED, 0.3) });
        if (rig.torso && !B.some((b) => b.part === 'shirtBlood')) B.push({ part: 'shirtBlood', joint: rig.torso, color: new THREE.Color(0x5c0000) });
    }

    /**
     * A shotgun blast up close tears off a limb ('armL' | 'armR' | 'legL' | 'legR'), alive or dead:
     * a ragged stump with the bone showing is left. Returns the bindings that came off (for limbMesh)
     * or null if it was already gone.
     */
    goreLimb(ped, limb) {
        const rig = ped && ped.mesh && ped.mesh.userData.rig;
        const bit = LIMB_BITS[limb];
        if (!rig || !rig.bindings || !bit || (ped.limbsGone & bit)) return null;
        ped.limbsGone = (ped.limbsGone || 0) | bit;
        const [root, mid] = limb === 'armL' ? [rig.shoulderL, rig.elbowL] : limb === 'armR' ? [rig.shoulderR, rig.elbowR]
            : limb === 'legL' ? [rig.legL, rig.kneeL] : [rig.legR, rig.kneeR];
        const B = rig.bindings;
        const lost = [];
        for (let i = B.length - 1; i >= 0; i--) {
            const j = B[i].joint;
            if (j === root || j === mid || (j && j.parent === mid)) lost.push(B.splice(i, 1)[0]);
        }
        // (whatever was in that hand goes with it)
        if (rig.props) for (const k in rig.props) if (lost.includes(rig.props[k])) rig.props[k] = null;
        B.push({ part: 'limbStub', joint: root, color: new THREE.Color(0x5a0000) });
        B.push({ part: 'boneStub', joint: root, color: new THREE.Color(0xe6dccb) });
        if (rig.torso && !B.some((b) => b.part === 'shirtBlood')) B.push({ part: 'shirtBlood', joint: rig.torso, color: new THREE.Color(0x5c0000) });
        return lost;
    }

    /**
     * The parts goreLimb took off as one loose object pivoting at `pivot` (world), posed as they
     * were when they came off (the joints' matrices must be current). Inside it the limb runs down
     * its -Y (`axis` is the limb's world direction from the pivot), so rotation.x = -PI/2 lays it flat.
     */
    limbMesh(lost, pivot, axis) {
        const g = new THREE.Group();
        g.position.copy(pivot);
        g.rotation.order = 'YXZ';
        const q = new THREE.Quaternion().setFromUnitVectors(axis, new THREE.Vector3(0, -1, 0));
        const inv = new THREE.Matrix4().makeRotationFromQuaternion(q)
            .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
        g.quaternion.copy(q.invert());
        for (const b of lost) {
            const src = this.renderer.meshes[b.part];
            if (!src) continue;
            const m = new THREE.Mesh(src.geometry, new THREE.MeshLambertMaterial({ color: b.color }));
            m.matrixAutoUpdate = false;
            m.matrix.multiplyMatrices(inv, b.joint.matrixWorld);
            m.castShadow = true;
            g.add(m);
        }
        // Where it was torn: a bloody end
        const end = new THREE.Mesh(this.renderer.meshes.limbStub.geometry, new THREE.MeshLambertMaterial({ color: 0x5a0000 }));
        end.rotation.x = Math.PI;
        end.scale.setScalar(0.9);
        g.add(end);
        return g;
    }

    /**
     * Killed against a wall: the body slides down it and stays sat there, slumped (instead of the
     * falling death, which would tip it back through the wall). Call after the kill.
     */
    slumpDead(ped) {
        if (!ped || !ped.isDead || !ped.mesh || !ped.mesh.userData.rig) return;
        ped.death = null;
        ped.state = 'dead';
        ped.ai.deadPosed = true;
        ped.ai.held = null;
        ped.ai.wallSlump = { t: 0, side: Math.random() < 0.5 ? 1 : -1 };
    }

    _updateWallSlump(ped, dt) {
        const S = ped.ai.wallSlump;
        if (S.t > 1.2) return;   // settled
        S.t += dt;
        const rig = ped.mesh.userData.rig;
        const u = Math.min(1, S.t / 0.85);
        const k = u * u * (3 - 2 * u);
        const pitch = this._wallSit(rig, k, ped.mesh.scale.y || 1, 1, 0);
        rig.neck.rotation.set(pitch, 0.3 * k * S.side, 0.35 * k * S.side);
        rig.torso.rotation.z += 0.12 * k * S.side;
    }

    /**
     * Sitting on the ground with the back against a wall, k 0..1 of the way down (knees buckle on
     * the way); limp 0..1 lets the arms and head go. Returns the head pitch.
     */
    _wallSit(rig, k, h, limp, t) {
        const buckle = Math.sin(Math.PI * Math.min(1, k * 1.15));
        rig.body.rotation.set(0, 0, 0);
        rig.body.position.y = (0.1 / h - 0.92) * k;
        rig.legL.rotation.set(-1.45 * k, 0, 0.12 * k);
        rig.legR.rotation.set(-1.35 * k, 0, -0.14 * k);
        rig.kneeL.rotation.x = 0.15 * k + 1.0 * buckle;
        rig.kneeR.rotation.x = 0.35 * k + 0.8 * buckle;
        rig.torso.rotation.set(-0.06 * k + 0.22 * k * limp, 0, 0);
        const breathe = t ? Math.sin(t * 1.4) * 0.03 * (1 - limp) : 0;
        rig.shoulderL.rotation.set((-0.25 + breathe) * k * (1 - limp) + 0.05 * k, 0, -0.18 * k);
        rig.shoulderR.rotation.set((-0.25 - breathe) * k * (1 - limp) + 0.05 * k, 0, 0.18 * k);
        rig.elbowL.rotation.x = -0.5 * k * (1 - limp) - 0.15 * k;
        rig.elbowR.rotation.x = -0.5 * k * (1 - limp) - 0.15 * k;
        return (0.15 + 0.55 * limp) * k;
    }

    /** Killed while lying down: they stay down (handed to the ragdoll already flat on the ground). */
    _dieOnGround(ped, hit) {
        const ai = ped.ai;
        const pose = (ai.held && ai.held.lying ? ai.held.downPose : ai.downPose) || 'back';
        ai.held = null;
        ped.state = 'downed';
        this.startShotDeath(ped, hit);
        if (ped.state !== 'dying') return;
        this._beginFall(ped, hit.dirX || 0, hit.dirZ || 0, 0.15, 0, 0);
        const face = pose === 'front' ? 1 : -1;
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ai.yaw)
            .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), face * Math.PI / 2));
        ped.ragdollHeading = ai.yaw;
        ped.ragdollFace = face;
        ped.ragdollQuat.copy(q);
        ped.ragdollCom.set(0, 1.0, 0).applyQuaternion(q).add(ped.mesh.position);
        ped.ragdollCom.y = (ped.floorY || 0) + 0.25;
        ped.ragdollVel.set((hit.dirX || 0) * 0.15, 0, (hit.dirZ || 0) * 0.15);
        ped.ragdollAngVel.set(0, 0, 0);
        const rig = ped.mesh.userData.rig;
        if (rig) rig.body.rotation.set(0, 0, 0);
    }

    /**
     * A player's body in a fight pose (multiplayer.js): o = { pose: 'held' | 'downed', mode, lying,
     * downPose, hp }. holder keeps the clocks between frames.
     */
    poseBrawlBody(holder, rig, o, dt) {
        const ai = holder.ai || (holder.ai = { downAge: 0, getUp: 0, held: { t: 0, moving: 0 } });
        const changed = ai.pose !== o.pose || ai.held.mode !== o.mode;
        ai.pose = o.pose;
        ai.held.mode = o.mode;
        ai.held.lying = !!o.lying;
        ai.downPose = o.downPose || 'back';
        ai.downAge = changed ? 0 : ai.downAge + dt;
        ai.getUp = 0;
        holder.hp = o.hp === undefined ? 100 : o.hp;
        rig.body.rotation.set(0, 0, 0);
        rig.body.position.y = 0;
        for (const j of ['legL', 'legR', 'torso']) rig[j].rotation.set(0, 0, 0);
        const pitch = this._animateBrawl(holder, rig, this._time, dt);
        rig.neck.rotation.set(pitch, 0, 0);
    }

    /** Poses for the brawl states; returns the head pitch. */
    _animateBrawl(ped, rig, t, dt) {
        const ai = ped.ai;
        const h = ped.mesh.scale.y || 1;
        const lie = (which, k) => {
            // Lying on the back / front / side (pivoting over the feet), k 0..1 of the way down
            if (which === 'side') rig.body.rotation.set(0, 0, (Math.PI / 2) * k);
            else rig.body.rotation.x = (which === 'front' ? 1 : -1) * (Math.PI / 2) * k;
            rig.body.position.y = (0.13 / h) * k;
        };
        if (ai.pose === 'downed') {
            const which = ai.downPose || 'back';
            if (which === 'wall') {
                // Sliding down the wall, sat against it, and (in time) back up
                const k = ai.getUp > 0 ? 1 - Math.min(1, ai.getUp) : Math.min(1, ai.downAge / 0.9);
                const limp = Math.max(0, Math.min(1, 1 - (ped.hp - 1) / 35));
                return this._wallSit(rig, k * k * (3 - 2 * k), h, limp, t);
            }
            if (ai.getUp > 0) {
                // Roll up to the knees, then stand
                const g = ai.getUp;
                if (g < 0.55) {
                    const k = 1 - g / 0.55;
                    lie(which, k);
                    rig.legL.rotation.x = rig.legR.rotation.x = -1.2 * (1 - k);
                    rig.kneeL.rotation.x = rig.kneeR.rotation.x = 1.9 * (1 - k * 0.5);
                    rig.shoulderL.rotation.x = rig.shoulderR.rotation.x = -0.9;
                    rig.body.position.y += -0.44 * (1 - k);
                } else {
                    const k = (g - 0.55) / 0.45;
                    rig.body.position.y = -0.44 * (1 - k);
                    rig.legL.rotation.x = -1.2 * (1 - k);
                    rig.legR.rotation.x = -0.4 * (1 - k);
                    rig.kneeL.rotation.x = 1.9 * (1 - k);
                    rig.kneeR.rotation.x = 1.0 * (1 - k);
                    rig.torso.rotation.x = 0.5 * (1 - k);
                    rig.shoulderL.rotation.x = rig.shoulderR.rotation.x = -0.6 * (1 - k);
                }
                return 0.2;
            }
            const k = Math.min(1, ai.downAge / (ai.fallDur || 0.45));
            const fall = k * k;   // gravity: slow to start, fast at the end
            lie(which, fall);
            // Arms thrown up and out as they go over, until they hit the ground
            const flail = Math.sin(Math.PI * Math.min(1, k * 1.15)) * (k < 1 ? 1 : 0);
            // Knees buckle on the way down; on the ground: writhing, an arm over the face, knees drawn up
            const hurt = 0.5 + 0.5 * Math.sin(t * 1.7);
            rig.kneeL.rotation.x = 0.6 * (1 - fall) + fall * (0.5 + hurt * 0.6);
            rig.kneeR.rotation.x = 0.4 * (1 - fall) + fall * (0.3 + (1 - hurt) * 0.5);
            rig.legL.rotation.x = -fall * (0.2 + hurt * 0.45);
            rig.legR.rotation.x = -fall * (0.1 + (1 - hurt) * 0.3);
            rig.shoulderL.rotation.set(-1.6 * fall - Math.sin(t * 2.3) * 0.3 * fall, 0, -0.3);
            rig.elbowL.rotation.x = -2.0 * fall;
            rig.shoulderR.rotation.set(-0.9 * fall + Math.sin(t * 1.9 + 1) * 0.35 * fall, 0, 0.5 * fall);
            rig.elbowR.rotation.x = -1.4 * fall;
            if (flail > 0) {
                rig.shoulderL.rotation.x -= 1.4 * flail;
                rig.shoulderR.rotation.x -= 1.2 * flail;
                rig.shoulderL.rotation.z -= 0.6 * flail;
                rig.shoulderR.rotation.z += 0.6 * flail;
                rig.elbowL.rotation.x += 1.2 * flail;
                rig.elbowR.rotation.x += 1.0 * flail;
            }
            rig.torso.rotation.x = Math.sin(t * 2.1) * 0.06 * fall;
            rig.torso.rotation.y = Math.sin(t * 1.3) * 0.12 * fall;
            if (ai.flinch > 0) {
                // A stomp: curl up tight
                const f = Math.sin(ai.flinch * Math.PI);
                rig.kneeL.rotation.x += f * 0.9;
                rig.kneeR.rotation.x += f * 0.9;
                rig.legL.rotation.x -= f * 0.7;
                rig.legR.rotation.x -= f * 0.7;
                rig.shoulderL.rotation.x -= f * 0.8;
                rig.shoulderR.rotation.x -= f * 0.8;
            }
            return -0.1 * fall;
        }
        // Held
        const H = ai.held || {};
        const daze = Math.max(0, Math.min(1, 1 - (ped.hp - 1) / 35));
        const alive = 1 - daze;
        if (H.lying && H.mode === 'mount') {
            // On their back with you on top: arms up over the face, legs bucking (less as they fade)
            lie('back', 1);
            const buck = Math.sin(t * 4.3) * alive;
            rig.shoulderL.rotation.set(-2.3 * alive - 0.2 * daze, 0, -0.35 - 0.6 * daze);
            rig.shoulderR.rotation.set(-2.2 * alive - 0.2 * daze + Math.sin(t * 5.1) * 0.25 * alive, 0, 0.35 + 0.6 * daze);
            rig.elbowL.rotation.x = -2.0 * alive - 0.2;
            rig.elbowR.rotation.x = -1.9 * alive - 0.2;
            rig.legL.rotation.x = -0.25 - 0.35 * Math.max(0, buck);
            rig.legR.rotation.x = -0.2 - 0.35 * Math.max(0, -buck);
            rig.kneeL.rotation.x = 0.4 + 0.6 * Math.max(0, buck);
            rig.kneeR.rotation.x = 0.35 + 0.6 * Math.max(0, -buck);
            rig.torso.rotation.y = Math.sin(t * 2.7) * 0.18 * alive;
            return (0.1 + Math.sin(t * 3.1) * 0.15 * alive) + daze * 0.2;
        }
        if (H.lying) {
            // Dragged along the ground by the wrists, head first: kicking, twisting, bucking
            lie('back', 1);
            const m = 0.45 + H.moving;
            rig.shoulderL.rotation.set(-2.9, 0, -0.25 + Math.sin(t * 4.1) * 0.12 * alive);
            rig.shoulderR.rotation.set(-2.9, 0, 0.25 - Math.sin(t * 3.7) * 0.12 * alive);
            rig.elbowL.rotation.x = rig.elbowR.rotation.x = -0.2;
            const kick = Math.sin(t * 6.3) * 0.6 * m * alive;
            const kick2 = Math.sin(t * 5.1 + 1.3) * 0.6 * m * alive;
            rig.legL.rotation.x = -0.25 + kick;
            rig.legR.rotation.x = -0.25 + kick2;
            rig.legL.rotation.z = Math.sin(t * 2.2) * 0.2 * alive;
            rig.legR.rotation.z = -Math.sin(t * 2.6) * 0.2 * alive;
            rig.kneeL.rotation.x = 0.3 + Math.max(0, -kick) * 1.4;
            rig.kneeR.rotation.x = 0.3 + Math.max(0, -kick2) * 1.4;
            rig.torso.rotation.y = Math.sin(t * 3.3) * 0.35 * alive;
            rig.torso.rotation.z = Math.sin(t * 2.4) * 0.15 * alive;
            return 0.2 + Math.sin(t * 4.7) * 0.3 * alive;
        }
        if (H.mode === 'neck') {
            // Held up by the throat in front of you: both hands clawing at your arm, feet scrabbling
            const step = t * 10;
            const scrab = 0.25 + H.moving;
            rig.body.position.y = 0.05;
            rig.torso.rotation.x = -0.18 + daze * 0.2;
            rig.legL.rotation.x = Math.sin(step) * 0.45 * scrab * alive + 0.1;
            rig.legR.rotation.x = -Math.sin(step) * 0.45 * scrab * alive + 0.1;
            rig.kneeL.rotation.x = 0.2 + Math.max(0, Math.cos(step)) * 0.6 * scrab * alive + daze * 0.3;
            rig.kneeR.rotation.x = 0.2 + Math.max(0, -Math.cos(step)) * 0.6 * scrab * alive + daze * 0.3;
            const w = Math.sin(t * 8) * 0.15 * alive;
            rig.shoulderL.rotation.set(-1.9 * alive + w, 0, -0.25);
            rig.shoulderR.rotation.set(-1.9 * alive - w, 0, 0.25);
            rig.elbowL.rotation.x = -1.7 * alive - 0.1;
            rig.elbowR.rotation.x = -1.7 * alive - 0.1;
            return -0.35 * alive + daze * 0.3;
        }
        if (H.mode === 'pin') {
            // Back to the wall, up on the toes, hands clawing at the grip on the collar
            // (beaten senseless: the hands drop, the knees go, the head hangs, held up by the collar)
            const daze = Math.max(0, Math.min(1, 1 - (ped.hp - 1) / 35));
            const alive = 1 - daze;
            rig.body.position.y = 0.04 - daze * 0.06;
            rig.torso.rotation.x = -0.12 + daze * 0.18;
            rig.legL.rotation.x = 0.08;
            rig.legR.rotation.x = 0.12;
            rig.kneeL.rotation.x = 0.15 + daze * 0.35 + Math.sin(t * 5) * 0.08 * alive;
            rig.kneeR.rotation.x = 0.1 + daze * 0.3 + Math.sin(t * 5 + 2) * 0.08 * alive;
            const w = Math.sin(t * 7) * 0.2 * alive;
            rig.shoulderL.rotation.set(-1.7 * alive + w + daze * 0.1, 0, -0.5 * alive - 0.15 * daze);
            rig.shoulderR.rotation.set(-1.7 * alive - w + daze * 0.1, 0, 0.5 * alive + 0.15 * daze);
            rig.elbowL.rotation.x = -1.5 * alive - 0.2 * daze;
            rig.elbowR.rotation.x = -1.5 * alive - 0.2 * daze;
            return -0.25 * alive + daze * (0.22 + Math.sin(t * 1.3) * 0.08);   // lolling, face still towards you
        }
        // Dragged on their feet, stumbling backwards, hands on the arm that has them
        const ph = t * 9 * (0.3 + H.moving);
        rig.torso.rotation.x = -0.35;
        rig.body.rotation.x = -0.12 * (0.5 + H.moving);
        rig.legL.rotation.x = Math.sin(ph) * 0.55 * (0.2 + H.moving);
        rig.legR.rotation.x = -Math.sin(ph) * 0.55 * (0.2 + H.moving);
        rig.kneeL.rotation.x = 0.25 + Math.max(0, Math.cos(ph)) * 0.5 * H.moving;
        rig.kneeR.rotation.x = 0.25 + Math.max(0, -Math.cos(ph)) * 0.5 * H.moving;
        rig.shoulderL.rotation.set(-2.0 + Math.sin(t * 6) * 0.2, 0, -0.2);
        rig.shoulderR.rotation.set(-2.0 - Math.sin(t * 6) * 0.2, 0, 0.2);
        rig.elbowL.rotation.x = -1.2;
        rig.elbowR.rotation.x = -1.2;
        return -0.3;
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
        if (this.net && !ped.isPoliceOfficer && !ped.isGhostCop) {
            if (ped.net) {
                // Not ours: the owner kills them for everyone; we show it at once
                if (!hit.fromNet) this.net.cmd('kill', { id: ped.net.id, hit: pickHit(hit) });
            } else {
                this.net.emit('kill', { id: ped.index, hit: pickHit(hit) });
            }
        }
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
        ped.mesh.position.y = ped.floorY || 0;
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
        const airborne = ped.state === 'ragdoll' && ped.ragdollCom && ped.ragdollCom.y > 0.55 && !ped.ragdollContact;
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
        // Scene poses (lying down, kneeling, dancing...) come from pedestrianScenes.js
        const brawl = pose === 'downed' || pose === 'held';
        const custom = brawl ? this._animateBrawl(ped, rig, t, dt)
            : (pose === 'walk' || pose === 'run' || pose === 'fight' || pose === 'sit' || pose === 'stand' || pose === 'talk')
                ? null : this.scenes.pose(ped, rig, t, pose);
        if (custom !== null) {
            headPitch = custom;
        } else if ((pose === 'walk' || pose === 'run') && ai.moveSpeed > 0.05) {
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
            // Guard drifts and the weight shifts from foot to foot
            rig.torso.rotation.y = Math.sin(t * 1.7) * 0.12;
            rig.shoulderL.rotation.x += Math.sin(t * 2.3) * 0.12;
            rig.shoulderR.rotation.x += Math.sin(t * 2.3 + 2) * 0.12;
            rig.body.rotation.z = Math.sin(t * 3) * 0.04;
            if (ai.punching > 0) {
                // Wind up (cock the arm, turn away), snap it out, then pull back to the guard
                const p = ai.punching;
                const wind = p < 0.13 ? p / 0.13 : Math.max(0, 1 - (p - 0.13) / 0.08);
                const k = p < 0.13 ? 0 : p < 0.24 ? (p - 0.13) / 0.11 : Math.max(0, 1 - (p - 0.24) / 0.26);
                const sh = ai.punchArm > 0 ? rig.shoulderL : rig.shoulderR;
                const el = ai.punchArm > 0 ? rig.elbowL : rig.elbowR;
                sh.rotation.x = -1.15 + 0.35 * wind - 0.45 * k;
                sh.rotation.z *= 1 - k;
                el.rotation.x = -1.85 - 0.3 * wind + 1.75 * k;
                rig.torso.rotation.y = ai.punchArm * 0.3 * wind - ai.punchArm * 0.45 * k;
                rig.torso.rotation.x = 0.12 + 0.12 * k;
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
            if (ai.study) {
                // Notes on the lap
                rig.shoulderL.rotation.set(-0.7, 0, -0.15);
                rig.elbowL.rotation.x = -0.8;
                rig.shoulderR.rotation.set(-0.65, 0, 0.2);
                rig.elbowR.rotation.set(-0.9 + Math.sin(t * 9) * 0.08, Math.sin(t * 5.3) * 0.15, 0);
                headPitch = 0.55;
            } else if (ai.speaking) {
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
        // Dog leashes, shopping bags, drinks, stoops, staggers, handcuffs...
        if (custom === null) headPitch += this.scenes.overlay(ped, rig, t);

        // Getting punched: the reaction depends on the blow. Hooks whip the head round, uppercuts snap
        // it back, jabs just jolt it; the heavy ones buckle the knees and throw the arms out
        let whip = 0;
        if (ai.flinch > 0) {
            ai.flinch = Math.max(0, ai.flinch - dt * 3.2);
            // fast out, slow back
            const u = 1 - ai.flinch;
            const f = u < 0.2 ? u / 0.2 : Math.pow(1 - (u - 0.2) / 0.8, 1.6);
            const sd = ai.flinchSide || 1;
            const mv = ai.flinchMove || 'cross';
            if (mv === 'hook') {
                whip = sd * 0.85 * f;
                rig.torso.rotation.y += sd * 0.35 * f;
                rig.torso.rotation.z += sd * 0.25 * f;
                rig.body.rotation.z += sd * 0.07 * f;
                headPitch -= 0.15 * f;
            } else if (mv === 'uppercut') {
                headPitch -= 1.0 * f;
                rig.torso.rotation.x -= 0.45 * f;
                rig.body.position.y += 0.04 * f;
            } else if (mv === 'jab') {
                headPitch -= 0.38 * f;
                rig.torso.rotation.x -= 0.12 * f;
                whip = sd * 0.15 * f;
            } else {
                headPitch -= 0.6 * f;
                rig.torso.rotation.x -= 0.3 * f;
                rig.torso.rotation.z += sd * 0.12 * f;
                whip = sd * 0.3 * f;
            }
            if (mv !== 'jab' && ai.pose !== 'downed' && ai.pose !== 'held') {
                rig.kneeL.rotation.x += 0.4 * f;
                rig.kneeR.rotation.x += 0.3 * f;
                rig.body.position.y -= 0.05 * f;
                rig.shoulderL.rotation.z -= 0.5 * f;
                rig.shoulderR.rotation.z += 0.5 * f;
            }
        }

        // Head turns smoothly towards whatever the ped is looking at
        const lookNow = rig.neck.rotation.y;
        const lookBase = lookNow - (ai.lastWhip || 0);
        rig.neck.rotation.set(headPitch, lookBase + (ai.look - lookBase) * Math.min(1, dt * 5) + whip, 0);
        ai.lastWhip = whip;
        // Keep the body facing its heading (ragdoll/kill code may have touched the root)
        ped.mesh.rotation.set(0, ai.yaw, 0);
        if (ped.state !== 'sitting' && pose !== 'sit') ped.mesh.position.y = ped.floorY || 0;
    }

    // --------------------------------------------------------------------------------------------
    // Population
    // --------------------------------------------------------------------------------------------
    /** Fills the area around `center` right away (game start / teleport). `night`: districts.js nightFactor. */
    populateInitial(center, night = this.night) {
        if (!this.nav) return;
        this.night = night;
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

        // How busy it is here, now (districts.js); spawns elsewhere are thinned to their own district
        const night = this.night;
        const here = districtAt(c.x, c.z);
        const hereProfile = districtProfile(here, night);
        const density = Math.max(PED_CONFIG.DENSITY_MIN, Math.min(PED_CONFIG.DENSITY_MAX, hereProfile.peds));
        // Only the player's district is loaded (districtStreaming.js): nobody spawns outside it, and
        // the numbers shrink with the share of the spawn ring it covers
        const st = this.streamer;
        const coverage = st ? Math.max(0.08, st.coverage(c.x, c.z, PED_CONFIG.SPAWN_MAX)) : 1;
        const tryMul = Math.min(4, 1 / coverage);
        const acceptAt = (x, z) => {
            if (st && !st.contains(x, z)) return false;
            const d = districtProfile(districtAt(x, z), night).peds;
            return Math.random() < Math.min(1, d / density);
        };

        // Remove people (and bodies) far from the player
        const desp2 = PED_CONFIG.DESPAWN_RADIUS * PED_CONFIG.DESPAWN_RADIUS;
        const body2 = PED_CONFIG.BODY_DESPAWN_RADIUS * PED_CONFIG.BODY_DESPAWN_RADIUS;
        let walkers = 0, sitters = 0, groupPeople = 0, scenePeople = 0, patrol = 0;
        for (let i = peds.length - 1; i >= 0; i--) {
            const ped = peds[i];
            if (ped.isPoliceOfficer || !ped.mesh) continue;
            const p = ped.mesh.position;
            const dx = p.x - c.x, dz = p.z - c.z;
            const d2 = dx * dx + dz * dz;
            if (ped.state === 'ragdoll' || ped.state === 'dying' || ped.state === 'carjacked' || ped.state === 'talking') continue;
            if (ped.barCtl && !ped.isDead) continue;      // bars.js has them (and removes them)
            if ((ped.isDead && d2 > body2) || (!ped.isDead && d2 > desp2)) {
                this._removePed(ped, i);
                continue;
            }
            // Left behind in a district that isn't loaded any more: gone once out of sight
            if (st && ped.state !== 'following' && !st.contains(p.x, p.z) &&
                (initial || d2 > PED_CONFIG.SPAWN_MIN * PED_CONFIG.SPAWN_MIN || !this._inView(p.x, p.z, ctx))) {
                this._removePed(ped, i);
                continue;
            }
            if (ped.isDead || !ped.ai) continue;
            if (ped.ai.seat >= 0) sitters++;
            else if (ped.ai.group || ped.ai.cat === 'group') groupPeople++;
            else if (ped.ai.cat === 'scene') scenePeople++;
            else walkers++;
            if (ped.style === 'cop' && ped.ai.cat === 'walker') patrol++;
        }

        const scale = this.lowest ? 0.22 : this.lowSpec ? PED_CONFIG.LOW_SPEC_SCALE : 1;
        const targetWalkers = Math.round(this.targets.walkers * density * coverage);
        const targetSitters = Math.round(this.targets.sitters * Math.min(1.6, density) * coverage);
        const targetGroups = Math.round(this.targets.groupPeople * density * coverage);

        // Too many people for the time of day (the park after dark): some head home
        if (!initial) this._thinOut(ctx, walkers - Math.round(targetWalkers * 1.25) - 2, sitters - targetSitters - 2, groupPeople - targetGroups - 3);

        let budget = initial ? 14 : PED_CONFIG.MAX_SPAWNS_PER_TICK;
        const living = walkers + sitters + groupPeople + scenePeople;
        if (living >= PED_CONFIG.CAPACITY - 12) return;

        const minR = initial ? 0 : PED_CONFIG.SPAWN_MIN;
        const maxR = PED_CONFIG.SPAWN_MAX;
        const streetHere = Object.keys(here.def.day.street).length + Object.keys(here.def.night.street).length;
        const targetStreet = streetHere ? Math.round(PED_CONFIG.STREET_SCENE_PEOPLE * scale * density * coverage * (0.3 + 0.7 * night)) : 0;

        // Sitters on benches, lawn chairs and café patios
        if (sitters < targetSitters && budget > 0) {
            const seats = nav.seatsInRing(c.x, c.z, minR, maxR, this._ring).slice();
            for (let tries = 0; tries < 6 * tryMul && sitters < targetSitters && budget > 0 && seats.length; tries++) {
                const s = seats[(Math.random() * seats.length) | 0];
                const x = nav.seatX[s], z = nav.seatZ[s];
                if (this.seatOccupant[s] || !this._spawnOk(x, z, ctx, initial)) continue;
                const district = districtAt(x, z);
                const prof = districtProfile(district, night);
                if (Math.random() > prof.seats || !acceptAt(x, z)) continue;
                const table = pickTable(district, night);
                const style = pickWeighted(table.looks) || 'adult';
                const study = Math.random() < prof.seatStudy;
                this._spawnSitter(s, study ? 'student' : style, study);
                sitters++;
                budget--;
                // Friends at the same table or bench
                if (Math.random() < 0.55) {
                    nav.seatGrid.forEachNear(x, z, 3, (o) => {
                        if (o !== s && nav.seatCluster[o] === nav.seatCluster[s] && !this.seatOccupant[o] && Math.random() < 0.7) {
                            this._spawnSitter(o, style, study && Math.random() < 0.6);
                            sitters++;
                        }
                    });
                }
            }
        }

        // On the grass and in front yards: groups, picnics, beer pong, yard work...
        if (groupPeople < targetGroups && budget > 0) {
            const spots = nav.hangoutsInRing(c.x, c.z, minR, maxR, this._ring).slice();
            for (let tries = 0; tries < 6 * tryMul && groupPeople < targetGroups && budget > 0 && spots.length; tries++) {
                const h = spots[(Math.random() * spots.length) | 0];
                const x = nav.hangX[h], z = nav.hangZ[h];
                if (this.hangoutGroup.has(h) || this.scenes.spotUsed.has(h) || !this._spawnOk(x, z, ctx, initial)) continue;
                if (!acceptAt(x, z)) continue;
                const table = pickTable(districtAt(x, z), night);
                const what = pickWeighted(table.spots);
                if (!what) continue;
                const style = pickWeighted(table.looks) || 'adult';
                groupPeople += what === 'hang' ? this._spawnGroup(h, style) : this.scenes.spawnSpot(what, h, style);
                budget--;
            }
        }

        // Sidewalk scenes: smokers, bar lines, fights, people being sick...
        if (scenePeople < targetStreet && budget > 0) {
            const nodes = nav.walkNodesInRing(c.x, c.z, minR, maxR, this._ring);
            for (let tries = 0; tries < 6 * tryMul && scenePeople < targetStreet && budget > 0 && nodes.length; tries++) {
                const n = nodes[(Math.random() * nodes.length) | 0];
                const x = nav.nodeX[n], z = nav.nodeZ[n];
                if (!this._spawnOk(x, z, ctx, initial) || !acceptAt(x, z)) continue;
                const district = districtAt(x, z);
                const table = pickTable(district, night);
                const what = pickWeighted(table.street);
                if (!what) continue;
                const style = pickWeighted(table.looks) || 'adult';
                scenePeople += this.scenes.spawnStreet(what, n, style, {
                    arrests: !!table.arrests,
                    sit: district.type === 'PARKING',
                    doorKinds: [DOOR_KIND.BAR]
                });
                budget--;
            }
        }

        // Walkers on the sidewalks
        if (walkers < targetWalkers && budget > 0) {
            const nodes = nav.walkNodesInRing(c.x, c.z, minR, maxR, this._ring).slice();
            for (let tries = 0; tries < 12 * tryMul && walkers < targetWalkers && budget > 0 && nodes.length; tries++) {
                const n = nodes[(Math.random() * nodes.length) | 0];
                const x = nav.nodeX[n], z = nav.nodeZ[n];
                if (!this._spawnOk(x, z, ctx, initial) || !acceptAt(x, z)) continue;
                const table = pickTable(districtAt(x, z), night);
                const kind = pickWeighted(table.walkers) || 'walk';
                const style = kind === 'jog' || kind === 'jogGroup' ? 'athlete' : (pickWeighted(table.looks) || 'adult');
                walkers += this._spawnWalkerKind(kind, n, style, table);
                budget--;
            }
        }

        // Now and then a cop walks the beat (the park at night)
        if (hereProfile.patrol > 0 && patrol === 0 && budget > 0 && Math.random() < PED_CONFIG.PATROL_CHANCE * hereProfile.patrol * (initial ? 40 : 1)) {
            const nodes = nav.walkNodesInRing(c.x, c.z, minR, maxR, this._ring);
            for (let tries = 0; tries < 8 && nodes.length; tries++) {
                const n = nodes[(Math.random() * nodes.length) | 0];
                if (!this._spawnOk(nav.nodeX[n], nav.nodeZ[n], ctx, initial) || districtAt(nav.nodeX[n], nav.nodeZ[n]) !== here || (st && !st.contains(nav.nodeX[n], nav.nodeZ[n]))) continue;
                const cop = this._spawnWalker(n, 'cop');
                cop.ai.walkSpeed = 1.1;
                if (night > 0.5) {
                    this.setProp(cop, 'L', 'flashlight', 0x222222);
                    cop.ai.flashlight = true;
                }
                break;
            }
        }
    }

    /** Sends surplus walkers home (into the nearest building), and cuts sitting and group time short. */
    _thinOut(ctx, extraWalkers, extraSitters, extraGroup) {
        const peds = this.pedestrians;
        let walkers = Math.min(2, extraWalkers), sitters = Math.min(2, extraSitters), groups = Math.min(2, extraGroup);
        if (walkers <= 0 && sitters <= 0 && groups <= 0) return;
        for (let i = peds.length - 1; i >= 0 && (walkers > 0 || sitters > 0 || groups > 0); i--) {
            const ped = peds[i];
            const ai = ped.ai;
            if (!ai || ped.isDead || ped.isPoliceOfficer || ai.noThin) continue;
            if (walkers > 0 && ped.state === 'walking' && ai.cat === 'walker' && !ai.direct && !(ai.goal && (ai.goal.type === 'door' || ai.goal.type === 'car' || ai.goal.type === 'scene'))) {
                walkers--;
                ai.heading = 0;
                if (this._doorGoal(ped, ALL_DOORS)) continue;
                const p = ped.mesh.position;
                // Nowhere to go: just gone, once nobody can see
                if (Math.hypot(p.x - ctx.center.x, p.z - ctx.center.z) > PED_CONFIG.SPAWN_MIN && !this._inView(p.x, p.z, ctx)) ai.vanish = true;
            } else if (sitters > 0 && ped.state === 'sitting' && ai.timer > 3) {
                sitters--;
                ai.timer = 1 + Math.random() * 3;
            } else if (groups > 0 && ped.state === 'hanging_out' && ai.timer > 3) {
                groups--;
                ai.timer = 1 + Math.random() * 3;
            } else if (groups > 0 && ped.state === 'activity' && ai.act && ai.act.scene && ai.cat === 'group' && ai.act.scene.timer > 10) {
                groups--;
                ai.act.scene.timer = 3 + Math.random() * 5;
            }
        }
    }

    _spawnWalker(node, style = 'adult', lookSeed = null) {
        const nav = this.nav;
        let yaw = Math.random() * TWO_PI;
        const deg = nav.adjStart[node + 1] - nav.adjStart[node];
        if (deg > 0) {
            const nb = nav.adjNode[nav.adjStart[node] + ((Math.random() * deg) | 0)];
            yaw = Math.atan2(nav.nodeX[nb] - nav.nodeX[node], nav.nodeZ[nb] - nav.nodeZ[node]);
        }
        const ped = this._makePed(nav.nodeX[node], nav.nodeZ[node], yaw, style, lookSeed);
        this._pickStops(ped, node);
        ped.state = 'walking';
        return ped;
    }

    /**
     * The driver of `car` ({ position, yaw }) getting out of the driver's seat (`seat`: car space,
     * riders.js seatLocal) and running from `threat` (a live {x, z}): how 'pulled' (yanked out by
     * someone at the door) or 'hands' (held up at gunpoint: hands up, opens the door, climbs out,
     * backs off, then runs). State 'carjacked' until they run; `ai.carOut.door` (0..1) is their door.
     */
    driverOut(car, seat, style, seed, how, threat) {
        const ped = this._makePed(car.position.x, car.position.z, (car.yaw || 0) + Math.PI, style, seed);
        ped.state = 'carjacked';
        ped.isCarjackedDriver = true;
        ped.ai.lastState = 'carjacked';
        ped.ai.phone = false;
        ped.ai.carOut = { car, seat, how, threat, t: 0, door: how === 'hands' ? 0 : 1 };
        this._updateCarOut(ped, 0);
        return ped;
    }

    _updateCarOut(ped, dt) {
        const ai = ped.ai, C = ai.carOut, car = C.car, rig = ped.mesh.userData.rig;
        const t = (C.t += dt);
        const hands = C.how === 'hands';
        // seated until t0, out of the car by t1, standing there (hands up / stumbling) until t2
        const [t0, t1, t2] = hands ? [1.0, 2.1, 3.7] : [0.4, 0.95, 1.5];
        const out = smooth01((t - t0) / (t1 - t0));
        if (hands) C.door = smooth01((t - 0.55) / 0.4);
        const p = ped.mesh.position;
        const yaw = car.yaw || 0, sin = Math.sin(yaw), cos = Math.cos(yaw);
        const side = C.seat.x > 0 ? 1 : -1;            // which side of the car their door is
        if (t < t1) {
            // Car space (x right, z back): out of the seat, past the open door (it swings forward)
            const ox = side * (hands ? 1.3 : 1.55), oz = C.seat.z + (hands ? 0.45 : 1.1);
            const lx = C.seat.x + (ox - C.seat.x) * out, lz = C.seat.z + (oz - C.seat.z) * out;
            p.x = car.position.x + lx * cos + lz * sin;
            p.z = car.position.z - lx * sin + lz * cos;
            // Legs swing out first, the body turns to face out of the door
            ai.yaw = yaw + Math.PI - side * (Math.PI / 2) * smooth01(out * 1.6);
        } else {
            const ax = p.x - C.threat.x, az = p.z - C.threat.z, d = Math.hypot(ax, az) || 1;
            if (hands) {
                // Backing off, out from the car (not into it) and towards its back, facing the gun
                ai.yaw = lerpAngle(ai.yaw, Math.atan2(-ax, -az), Math.min(1, dt * 6));
                const bx = side * cos + 0.6 * sin, bz = -side * sin + 0.6 * cos, bl = Math.hypot(bx, bz);
                p.x += (bx / bl) * 0.6 * dt;
                p.z += (bz / bl) * 0.6 * dt;
            } else {
                // Thrown clear: stumbling off towards the back of the car
                const k = 1 - (t - t1) / (t2 - t1);
                p.x += (side * cos * 1.4 + sin * 1.8) * k * dt;
                p.z += (-side * sin * 1.4 + cos * 1.8) * k * dt;
            }
        }
        p.y = ped.floorY || 0;
        ped.mesh.rotation.set(0, ai.yaw, 0);

        // ---- Pose: seated → ducking out of the door frame → standing ----
        resetRig(rig);
        const h = ped.mesh.scale.y || 1;
        const sit = 1 - out, duck = Math.sin(out * Math.PI);
        rig.body.position.y = ((C.seat.y + 0.06) / h - 0.92) * sit - 0.1 * duck;
        const lead = 1 - smooth01(out * 1.7);           // the door-side leg goes out first
        rig.legL.rotation.set(-1.45 * lead, 0, 0.06 * lead);
        rig.legR.rotation.set(-1.4 * sit, 0, -0.06 * sit);
        rig.kneeL.rotation.x = 1.4 * lead + 0.5 * duck;
        rig.kneeR.rotation.x = 1.3 * sit + 0.3 * duck;
        rig.torso.rotation.x = 0.45 * duck;
        const shake = Math.sin(t * 31) * 0.05;
        if (hands) {
            // Hands off the wheel and up; the left one pushes the door open and holds the frame on the way out
            const up = smooth01(t / 0.45);
            const reach = t < t1 ? smooth01((t - 0.5) / 0.3) * (1 - smooth01((t - t1 + 0.25) / 0.25)) : 0;
            const armUp = (sh, el, z0, z1, x0) => {
                sh.rotation.set(x0 + (-2.75 - x0) * up + shake, 0, z0 + (z1 - z0) * up);
                el.rotation.x = -0.55 + 0.05 * up;
            };
            armUp(rig.shoulderL, rig.elbowL, -0.18, 0.45, -1.15);
            armUp(rig.shoulderR, rig.elbowR, 0.18, -0.45, -1.15);
            if (reach > 0) {
                rig.shoulderL.rotation.set(-2.75 + 1.4 * reach, 0, 0.45 + 0.4 * reach);
                rig.elbowL.rotation.x = -0.5 + 0.3 * reach;
            }
            rig.neck.rotation.set(t < t0 ? Math.sin(t * 2) * 0.1 : -0.1, 0, 0);
            if (t > t1) {
                // Stepping back: a nervous shuffle
                const s = Math.sin(t * 7);
                rig.legL.rotation.x = s * 0.25;
                rig.legR.rotation.x = -s * 0.25;
                rig.torso.rotation.x = -0.1;
            }
        } else {
            // Arms up over the face as the door is ripped open, flailing as they're hauled out, then windmilling
            const flail = t < t0 ? 0 : 1;
            const s = Math.sin(t * 14);
            rig.shoulderL.rotation.set(-2.0 + 0.7 * s * flail + shake, 0, 0.3 + 0.4 * flail);
            rig.shoulderR.rotation.set(-2.0 - 0.7 * s * flail - shake, 0, -0.3 - 0.4 * flail);
            rig.elbowL.rotation.x = -1.6 + 0.9 * flail;
            rig.elbowR.rotation.x = -1.6 + 0.9 * flail;
            rig.torso.rotation.z = t < t0 ? 0.25 * smooth01(t / 0.2) : 0;   // leaning away from the door
            if (t > t1) {
                const k = (t - t1) / (t2 - t1), w = Math.sin(t * 16);
                rig.torso.rotation.x = 0.5 * (1 - k);
                rig.legL.rotation.x = -w * 0.7;
                rig.legR.rotation.x = w * 0.7;
                rig.kneeL.rotation.x = 0.4;
                rig.kneeR.rotation.x = 0.4;
            }
        }

        if (t >= t2) {
            // Run for it, away from whoever has the gun
            ai.carOut = null;
            // (away from the gun, but never back through the car)
            const ax = p.x - C.threat.x, az = p.z - C.threat.z, d = Math.hypot(ax, az) || 1;
            const fx = ax / d + side * cos, fz = az / d - side * sin, fl = Math.hypot(fx, fz) || 1;
            ped.state = 'fleeing';
            ped.fleeTimer = 600;
            ped.velocity.set((fx / fl) * 0.11, 0, (fz / fl) * 0.11);
            ai.pose = 'run';
        }
    }

    /** Somebody gets out of a car at (x, z) and walks off along the sidewalks (or null where there are none). */
    /**
     * A person run by someone else (bars.js): a full pedestrian (shootable, punchable, talks,
     * fights back, dies) whose ordinary behaviour is `ctl.updatePed(ped, dt, ctx)` in state 'bar'.
     */
    spawnControlled(x, z, y, yaw, style, ctl) {
        const ped = this._makePed(x, z, yaw, style);
        ped.mesh.position.y = y;
        ped.floorY = y;
        ped.barCtl = ctl;
        ped.state = 'bar';
        ped.ai.cat = 'bar';
        ped.ai.lastState = 'bar';
        ped.ai.phone = false;
        return ped;
    }

    /** Takes a controlled person out of the world (bars.js, when you walk away). */
    removePed(ped) {
        this._removePed(ped);
    }

    spawnPersonAt(x, z, style = 'adult', lookSeed = null) {
        if (!this.nav) return null;
        const node = this.nav.nearestWalkNode(x, z, 80);
        if (node < 0) return null;
        const ped = this._spawnWalker(node, style, lookSeed);
        ped.mesh.position.set(x, 0, z);
        return ped;
    }

    _spawnSitter(seat, style = 'adult', study = false) {
        const nav = this.nav;
        const ped = this._makePed(nav.seatX[seat], nav.seatZ[seat], nav.seatYaw[seat], style);
        this.seatOccupant[seat] = ped;
        ped.ai.seat = seat;
        this._sit(ped, seat);
        ped.ai.timer = 30 + Math.random() * 200;
        if (study) {
            ped.ai.study = true;
            ped.ai.phone = false;
            this.setProp(ped, 'L', 'notebook', 0xf5f5f0);
        } else if (style === 'partier' && Math.random() < 0.6) {
            this.setProp(ped, 'R', Math.random() < 0.7 ? 'cup' : 'bottle', 0xd32f2f);
        }
        return ped;
    }

    _spawnGroup(spot, style = 'adult') {
        const g = this._createGroup(spot);
        const n = Math.min(g.maxSize, 2 + ((Math.random() * 3) | 0));
        for (let i = 0; i < n; i++) {
            const ped = this._makePed(g.x, g.z, 0, style);
            g.members.push(ped);
            ped.ai.group = g;
            if (style === 'partier' && Math.random() < 0.6) this.setProp(ped, 'R', 'cup', 0xd32f2f);
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
        let walking = 0, waiting = 0, crossing = 0, sitting = 0, hanging = 0, following = 0, activity = 0;
        for (const p of this.pedestrians) {
            if (p.isDead || p.isPoliceOfficer) continue;
            if (p.state === 'walking' || p.state === 'idle') walking++;
            else if (p.state === 'waiting_to_cross') waiting++;
            else if (p.state === 'crossing') crossing++;
            else if (p.state === 'sitting') sitting++;
            else if (p.state === 'hanging_out') hanging++;
            else if (p.state === 'following') following++;
            else if (p.state === 'activity') activity++;
        }
        const c = this._lastCenter;
        const district = c ? districtAt(c.x, c.z) : null;
        return {
            total: this.pedestrians.length, walking, waiting, crossing, sitting, hanging, following, activity,
            groups: this.groups.size,
            district: district ? district.def.name : null,
            night: this.night,
            ...this.scenes.getStats()
        };
    }
}
