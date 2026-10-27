/**
 * js/game/carModels.js
 *
 * Car catalog and procedural car builder for Kaj Simulator.
 *
 * Every model is described by a side profile (the outline of the lower body seen from the left,
 * with wheel arches cut into it), a greenhouse (raked windshield and rear glass, tumblehome on the
 * side glass), lights / bumpers / trim, wheels, physics, an engine sound profile and an interior
 * theme. The same description builds:
 * - the individual car mesh (player car, police cruisers, dev-spawned and carjacked cars), with
 *   named glass panes, an opening driver's door and steerable / rolling wheels
 * - merged per-model batches for the GPU-instanced traffic fleet
 * - the window planes used for bullets, blood and shattering, and the interior layout
 *
 * The lower body is split into a nose, a tail and a hollow tub around the cabin (two side panels
 * and a floor pan), so the cabin is open from the inside without hiding anything, and the driver's
 * door is a real cut-out of the left side panel.
 *
 * Car local space: -Z is the front, -X the driver's (left) side, y = 0 at road level.
 */

import * as THREE from 'three';

// ================================================================================================
// Catalog
// ================================================================================================

// Shared default lights / trim so models only spell out what makes them different
const STD_ENGINE = { cyl: 4, idle: 800, redline: 7000, gears: [0.2, 0.36, 0.52, 0.68, 0.84, 1.0] };

/**
 * Model fields (lengths in metres, car local space):
 * - length / width: body extents; ground: underside height of the body
 * - nose / tail: top line of the body from the front bottom up to the cowl, and from behind the
 *   rear glass down to the rear bottom ([z, y] pairs, front to back)
 * - cabin: front / rear = windshield / rear glass base z, belt = beltline height, roof = roof
 *   height, halfW = half width of the glass at the beltline, rakeF / rakeR = how far the roof edge
 *   sits behind / ahead of the glass base, tumble = inward lean of the side glass at the roof,
 *   seatZ = driver's seat cushion centre, floorDrop = cabin floor below the beltline (low cars sit
 *   lower), rearSeats = whether a rear bench fits
 * - sections: extra hollow parts of the body (the pickup's bed)
 * - wheels: radius, width, front / rear axle z, track = wheel centre x
 */
const MODEL_LIST = [
    {
        id: 'civic',
        name: 'Honda Civic',
        description: 'Compact sedan. Kaj\'s daily: light, grippy and happy to rev.',
        weight: 6,
        length: 4.5, width: 2.2, ground: 0.22,
        nose: [[-2.2, 0.24], [-2.27, 0.36], [-2.29, 0.52], [-2.25, 0.66], [-2.12, 0.75], [-1.8, 0.81], [-1.5, 0.86]],
        tail: [[1.45, 0.94], [1.95, 0.96], [2.17, 0.93], [2.25, 0.82], [2.28, 0.6], [2.26, 0.38], [2.2, 0.24]],
        cabin: { front: -1.35, rear: 1.15, belt: 0.9, roof: 1.42, halfW: 0.95, rakeF: 0.52, rakeR: 0.44, tumble: 0.14, seatZ: -0.02, rearSeats: true },
        wheels: { radius: 0.35, width: 0.25, front: -1.3, rear: 1.3, track: 1.0, rim: 0xb9bec4 },
        lights: {
            head: { y: 0.66, h: 0.13, w: 0.46, x: 0.68, shape: 'swept' },
            tail: { y: 0.8, h: 0.13, w: 0.5, x: 0.68, shape: 'wrap' },
            grille: { y: 0.55, h: 0.16, w: 0.8 },
            bumperF: { y: 0.36, h: 0.2 }, bumperR: { y: 0.38, h: 0.2 },
            exhaust: { count: 1, x: 0.6, r: 0.05 }
        },
        extras: ['lip'],
        physics: {},
        engine: Object.assign({}, STD_ENGINE, { sound: 'i4' }),
        interior: 'modern',
        palette: [0x111111, 0x2266dd, 0xdd3322, 0xc8ccd2, 0x2b2f36, 0xf2f2f2, 0x3a6b4a]
    },
    {
        id: 'hatch',
        name: 'Volta Hatch',
        description: 'Three-cylinder city hatchback. Short, nimble, buzzy.',
        weight: 5,
        length: 4.0, width: 2.1, ground: 0.22,
        nose: [[-1.94, 0.24], [-2.0, 0.38], [-2.0, 0.58], [-1.92, 0.71], [-1.7, 0.8], [-1.35, 0.87]],
        tail: [[1.82, 0.9], [1.95, 0.82], [2.0, 0.6], [1.99, 0.38], [1.93, 0.24]],
        cabin: { front: -1.2, rear: 1.72, belt: 0.92, roof: 1.5, halfW: 0.9, rakeF: 0.58, rakeR: 0.2, tumble: 0.12, seatZ: 0.1, rearSeats: true },
        wheels: { radius: 0.33, width: 0.23, front: -1.25, rear: 1.2, track: 0.95, rim: 0x2a2c30 },
        lights: {
            head: { y: 0.68, h: 0.16, w: 0.42, x: 0.62, shape: 'round2' },
            tail: { y: 0.74, h: 0.26, w: 0.16, x: 0.8, shape: 'tall' },
            grille: { y: 0.52, h: 0.18, w: 0.7 },
            bumperF: { y: 0.36, h: 0.22 }, bumperR: { y: 0.38, h: 0.22 },
            exhaust: { count: 1, x: -0.55, r: 0.04 }
        },
        extras: ['roofSpoilerSmall'],
        physics: { maxForwardSpeed: 26.0, baseAccel: 9.0, normalGrip: 38.0, maxSteerAngle: 0.6, steerSpeed: 5.0 },
        engine: { cyl: 3, idle: 850, redline: 6400, gears: [0.22, 0.4, 0.58, 0.78, 1.0], sound: 'i3' },
        interior: 'city',
        palette: [0xe94f37, 0xf6c445, 0x58b4ae, 0xf2f2f2, 0x6b7a8f, 0x8fbf3f, 0x222222]
    },
    {
        id: 'coupe',
        name: 'Kaze GT',
        description: 'Turbo six sports coupe. Fast, sharp, sticks like glue.',
        weight: 3,
        length: 4.5, width: 2.25, ground: 0.16,
        nose: [[-2.18, 0.18], [-2.26, 0.3], [-2.27, 0.44], [-2.18, 0.55], [-1.85, 0.62], [-1.3, 0.7], [-0.98, 0.76]],
        tail: [[1.75, 0.81], [2.05, 0.83], [2.2, 0.8], [2.27, 0.66], [2.27, 0.42], [2.2, 0.2]],
        cabin: { front: -0.9, rear: 1.45, belt: 0.79, roof: 1.2, halfW: 0.88, rakeF: 0.62, rakeR: 0.75, tumble: 0.16, seatZ: 0.38, floorDrop: 0.63, rearSeats: false },
        wheels: { radius: 0.36, width: 0.3, front: -1.35, rear: 1.35, track: 1.0, rim: 0x2b2d31 },
        lights: {
            head: { y: 0.56, h: 0.07, w: 0.5, x: 0.72, shape: 'slim' },
            tail: { y: 0.7, h: 0.07, w: 1.9, x: 0, shape: 'bar' },
            grille: { y: 0.34, h: 0.16, w: 1.2 },
            bumperF: { y: 0.24, h: 0.12 }, bumperR: { y: 0.28, h: 0.16 },
            exhaust: { count: 4, x: 0.55, r: 0.05 }
        },
        extras: ['spoiler', 'diffuser', 'lip', 'skirts'],
        physics: {
            maxForwardSpeed: 38.0, baseAccel: 14.0, brakeDecel: 20.0, normalGrip: 44.0, handbrakeGrip: 2.2,
            maxSteerAngle: 0.52, steerSpeed: 5.6, steerCenterSpeed: 7.0, dragCoeff: 0.0028
        },
        engine: { cyl: 6, idle: 950, redline: 8000, gears: [0.17, 0.3, 0.44, 0.6, 0.78, 1.0], sound: 'turbo6' },
        interior: 'sport',
        palette: [0xd8d8d8, 0x111111, 0xc81d25, 0x1d4ed8, 0xf5a623, 0x2e2e33, 0x0f8b6d]
    },
    {
        id: 'muscle',
        name: 'Stallion 5.0',
        description: 'Supercharged V8 muscle car. Huge torque, loose rear end.',
        weight: 3,
        length: 4.9, width: 2.3, ground: 0.22,
        nose: [[-2.38, 0.26], [-2.45, 0.4], [-2.46, 0.64], [-2.4, 0.78], [-1.9, 0.84], [-1.2, 0.88], [-0.9, 0.9]],
        tail: [[1.75, 0.94], [2.28, 0.93], [2.42, 0.86], [2.45, 0.62], [2.43, 0.4], [2.38, 0.26]],
        cabin: { front: -0.85, rear: 1.45, belt: 0.92, roof: 1.36, halfW: 0.93, rakeF: 0.5, rakeR: 0.62, tumble: 0.14, seatZ: 0.2, floorDrop: 0.6, rearSeats: true },
        wheels: { radius: 0.37, width: 0.31, front: -1.5, rear: 1.45, track: 1.03, rim: 0xd0d4d8 },
        lights: {
            head: { y: 0.66, h: 0.16, w: 0.46, x: 0.7, shape: 'round2' },
            tail: { y: 0.76, h: 0.14, w: 0.56, x: 0.68, shape: 'triple' },
            grille: { y: 0.62, h: 0.24, w: 1.1, chrome: true },
            bumperF: { y: 0.36, h: 0.16, chrome: true }, bumperR: { y: 0.4, h: 0.16, chrome: true },
            exhaust: { count: 2, x: 0.62, r: 0.065 }
        },
        extras: ['hoodScoop', 'stripes', 'ducktail'],
        physics: {
            maxForwardSpeed: 36.0, baseAccel: 13.5, brakeDecel: 15.0, normalGrip: 25.0, handbrakeGrip: 1.8,
            maxSteerAngle: 0.5, steerSpeed: 4.2
        },
        engine: { cyl: 8, idle: 650, redline: 6400, gears: [0.24, 0.42, 0.62, 0.8, 1.0], sound: 'v8muscle' },
        interior: 'muscle',
        palette: [0x0f2f6e, 0xc1121f, 0xffb703, 0x111111, 0xf2f2f2, 0x5a6b2a, 0xff6b00]
    },
    {
        id: 'suv',
        name: 'Ridgeline SUV',
        description: 'Family V6 SUV. Tall, heavy, soft.',
        weight: 5,
        length: 4.8, width: 2.3, ground: 0.42,
        nose: [[-2.32, 0.44], [-2.4, 0.6], [-2.42, 0.86], [-2.38, 1.04], [-2.22, 1.13], [-1.7, 1.2], [-1.35, 1.26]],
        tail: [[2.22, 1.3], [2.36, 1.22], [2.4, 0.95], [2.39, 0.6], [2.32, 0.44]],
        cabin: { front: -1.2, rear: 2.28, belt: 1.3, roof: 1.88, halfW: 1.0, rakeF: 0.52, rakeR: 0.14, tumble: 0.1, seatZ: 0.12, rearSeats: true },
        wheels: { radius: 0.42, width: 0.3, front: -1.5, rear: 1.45, track: 1.03, rim: 0x9aa0a6 },
        lights: {
            head: { y: 1.0, h: 0.15, w: 0.5, x: 0.74, shape: 'swept' },
            tail: { y: 1.12, h: 0.3, w: 0.2, x: 0.92, shape: 'tall' },
            grille: { y: 0.88, h: 0.24, w: 1.0 },
            bumperF: { y: 0.6, h: 0.26 }, bumperR: { y: 0.62, h: 0.24 },
            exhaust: { count: 1, x: 0.65, r: 0.055 }
        },
        extras: ['roofRack', 'skirts', 'cladding'],
        physics: {
            maxForwardSpeed: 27.0, baseAccel: 8.2, brakeDecel: 14.0, normalGrip: 30.0, handbrakeGrip: 2.8,
            maxSteerAngle: 0.5, steerSpeed: 3.8, dragCoeff: 0.0045
        },
        engine: { cyl: 6, idle: 700, redline: 6200, gears: [0.18, 0.32, 0.48, 0.64, 0.82, 1.0], sound: 'v6' },
        interior: 'suv',
        palette: [0x2b2f36, 0xf2f2f2, 0x6d6f73, 0x1f3a5f, 0x7a1f1f, 0x40513b, 0xb7a68b]
    },
    {
        id: 'pickup',
        name: 'Ram-Tough 2500',
        description: 'Crew-cab V8 pickup. Big, loud and built like a barn.',
        weight: 4,
        length: 5.6, width: 2.35, ground: 0.44,
        nose: [[-2.72, 0.46], [-2.8, 0.62], [-2.8, 1.02], [-2.74, 1.16], [-2.4, 1.2], [-1.6, 1.24], [-1.2, 1.26]],
        tail: [[1.36, 1.26], [2.78, 1.26], [2.8, 1.0], [2.79, 0.6], [2.72, 0.46]],
        cabin: { front: -1.02, rear: 1.3, belt: 1.26, roof: 1.92, halfW: 1.02, rakeF: 0.42, rakeR: 0.04, tumble: 0.08, seatZ: 0.12, rearSeats: true },
        sections: [{ z0: 1.44, z1: 2.68, floor: 0.98, wall: 0.09 }],
        wheels: { radius: 0.44, width: 0.32, front: -1.75, rear: 1.85, track: 1.04, rim: 0xc8ccd0 },
        lights: {
            head: { y: 1.0, h: 0.2, w: 0.42, x: 0.8, shape: 'box' },
            tail: { y: 1.0, h: 0.34, w: 0.12, x: 1.05, shape: 'tall' },
            grille: { y: 0.92, h: 0.36, w: 1.2, chrome: true },
            bumperF: { y: 0.6, h: 0.26, chrome: true }, bumperR: { y: 0.62, h: 0.22, chrome: true },
            exhaust: { count: 1, x: 0.8, r: 0.06, side: true }
        },
        extras: ['sideSteps', 'towHitch', 'flares'],
        physics: {
            maxForwardSpeed: 28.0, baseAccel: 9.5, brakeDecel: 13.0, normalGrip: 28.0, handbrakeGrip: 2.6,
            maxSteerAngle: 0.48, steerSpeed: 3.6, dragCoeff: 0.005
        },
        engine: { cyl: 8, idle: 600, redline: 5600, gears: [0.2, 0.36, 0.54, 0.72, 0.88, 1.0], sound: 'v8truck' },
        interior: 'truck',
        palette: [0xf2f2f2, 0x111111, 0x8b1e1e, 0x2e4b6d, 0x6b6e70, 0x4b5320, 0xc68a3a]
    },
    {
        id: 'van',
        name: 'Courier Van',
        description: 'Delivery minivan. Slow, tall, and it drones.',
        weight: 3,
        length: 5.0, width: 2.25, ground: 0.3,
        nose: [[-2.42, 0.32], [-2.5, 0.5], [-2.5, 0.78], [-2.4, 0.92], [-2.15, 1.0], [-1.95, 1.06]],
        tail: [[2.44, 1.1], [2.5, 0.8], [2.49, 0.5], [2.42, 0.32]],
        cabin: { front: -1.82, rear: 2.46, belt: 1.1, roof: 2.08, halfW: 1.02, rakeF: 0.62, rakeR: 0.06, tumble: 0.06, seatZ: -0.4, rearSeats: true },
        wheels: { radius: 0.37, width: 0.26, front: -1.65, rear: 1.6, track: 1.0, rim: 0x6d7278 },
        lights: {
            head: { y: 0.84, h: 0.16, w: 0.46, x: 0.74, shape: 'box' },
            tail: { y: 1.05, h: 0.5, w: 0.13, x: 1.0, shape: 'tall' },
            grille: { y: 0.66, h: 0.16, w: 1.0 },
            bumperF: { y: 0.46, h: 0.26 }, bumperR: { y: 0.46, h: 0.24 },
            exhaust: { count: 1, x: -0.7, r: 0.045 }
        },
        extras: ['slideTrack', 'cladding'],
        physics: {
            maxForwardSpeed: 24.0, baseAccel: 7.2, brakeDecel: 13.0, normalGrip: 30.0, handbrakeGrip: 3.0,
            maxSteerAngle: 0.55, steerSpeed: 3.8, dragCoeff: 0.0055
        },
        engine: { cyl: 4, idle: 750, redline: 5800, gears: [0.22, 0.4, 0.6, 0.8, 1.0], sound: 'i4van' },
        interior: 'van',
        palette: [0xf2f2f2, 0xdcdcdc, 0x2f6f9f, 0xc2410c, 0x3b3b3b, 0x8a9a5b]
    },
    {
        id: 'cruiser',
        name: 'Interceptor',
        description: 'Full-size V8 sedan, the police cruiser\'s civilian twin.',
        weight: 2,
        length: 5.0, width: 2.3, ground: 0.24,
        nose: [[-2.42, 0.26], [-2.5, 0.4], [-2.51, 0.62], [-2.45, 0.78], [-2.2, 0.86], [-1.7, 0.92], [-1.45, 0.96]],
        tail: [[1.55, 1.0], [2.2, 1.0], [2.45, 0.95], [2.5, 0.8], [2.5, 0.48], [2.42, 0.26]],
        cabin: { front: -1.3, rear: 1.4, belt: 0.98, roof: 1.5, halfW: 0.98, rakeF: 0.52, rakeR: 0.48, tumble: 0.14, seatZ: 0.02, rearSeats: true },
        wheels: { radius: 0.37, width: 0.27, front: -1.5, rear: 1.5, track: 1.03, rim: 0x3a3d42 },
        lights: {
            head: { y: 0.74, h: 0.14, w: 0.5, x: 0.72, shape: 'swept' },
            tail: { y: 0.86, h: 0.16, w: 0.58, x: 0.7, shape: 'wrap' },
            grille: { y: 0.6, h: 0.2, w: 1.0 },
            bumperF: { y: 0.38, h: 0.22 }, bumperR: { y: 0.42, h: 0.22 },
            exhaust: { count: 2, x: 0.62, r: 0.055 }
        },
        extras: [],
        physics: { maxForwardSpeed: 32.0, baseAccel: 11.0, brakeDecel: 17.0, normalGrip: 34.0, maxSteerAngle: 0.52, steerSpeed: 4.4 },
        engine: { cyl: 8, idle: 700, redline: 6000, gears: [0.22, 0.4, 0.58, 0.76, 0.9, 1.0], sound: 'v8cruiser' },
        interior: 'cruiser',
        palette: [0x0f1423, 0x2b2f36, 0xf2f2f2, 0x5b0f12, 0x30343a]
    },
    {
        id: 'taxi',
        base: 'civic',
        name: 'Kaj Cab',
        description: 'Yellow cab on a Civic chassis, roof sign and all.',
        weight: 2,
        extras: ['taxiSign'],
        physics: { maxForwardSpeed: 27.0 },
        engine: Object.assign({}, STD_ENGINE, { redline: 6500, sound: 'i4soft' }),
        interior: 'taxi',
        palette: [0xf2c200]
    }
];

/** id -> resolved model (bases merged in). */
export const CAR_MODELS = {};
for (const m of MODEL_LIST) {
    const base = m.base ? CAR_MODELS[m.base] : null;
    const resolved = base ? Object.assign({}, base, m, {
        extras: (base.extras || []).concat(m.extras || []),
        physics: Object.assign({}, base.physics, m.physics)
    }) : Object.assign({}, m);
    resolved.geometryKey = base ? base.geometryKey : m.id;
    CAR_MODELS[m.id] = Object.freeze(resolved);
}

export const DEFAULT_CAR_MODEL = 'civic';
export const CAR_MODEL_IDS = Object.freeze(MODEL_LIST.map((m) => m.id));
/** Models AI traffic is drawn from (police use the cruiser model through PoliceVehicle). */
export const TRAFFIC_MODEL_IDS = Object.freeze(CAR_MODEL_IDS.slice());

export function getCarModel(idOrModel) {
    if (idOrModel && typeof idOrModel === 'object' && idOrModel.id && CAR_MODELS[idOrModel.id]) return CAR_MODELS[idOrModel.id];
    return CAR_MODELS[idOrModel] || CAR_MODELS[DEFAULT_CAR_MODEL];
}

/** Weighted pick from `ids` using a 0..1 random value (deterministic when `rand` is). */
export function pickCarModel(rand = Math.random(), ids = TRAFFIC_MODEL_IDS) {
    let total = 0;
    for (const id of ids) total += CAR_MODELS[id].weight || 1;
    let r = rand * total;
    for (const id of ids) {
        r -= CAR_MODELS[id].weight || 1;
        if (r <= 0) return id;
    }
    return ids[ids.length - 1];
}

/** A paint colour that suits the model. */
export function pickCarColor(modelId, rand = Math.random()) {
    const p = getCarModel(modelId).palette;
    return p[Math.min(p.length - 1, Math.floor(rand * p.length))];
}

// ================================================================================================
// Shared materials (individual car meshes)
// ================================================================================================

/** Vertex colours of the non-paint parts; also the colours of the individual-mesh materials. */
export const PART_COLORS = Object.freeze({
    trim: 0x16171a,
    cabin: 0x0c0e11,
    chrome: 0xc9cdd2,
    plate: 0xe9e9e4,
    head: 0xfff3d6,
    tail: 0xd3121b,
    amber: 0xff9418,
    stripe: 0xf4f4f4,
    taxi: 0xfff7cc,
    tire: 0x1b1b1b
});

const LIGHT_KEYS = new Set(['head', 'tail', 'amber', 'taxi']);

let _partMats = null;
const _paintMats = new Map();
const _rimMats = new Map();

export function getPartMaterials() {
    if (_partMats) return _partMats;
    const std = (color, roughness, metalness, extra = {}) =>
        new THREE.MeshStandardMaterial(Object.assign({ color, roughness, metalness }, extra));
    _partMats = {
        trim: std(PART_COLORS.trim, 0.6, 0.15),
        cabin: std(PART_COLORS.cabin, 0.25, 0.3, { envMapIntensity: 1.2 }),
        chrome: std(PART_COLORS.chrome, 0.18, 1.0, { envMapIntensity: 1.4 }),
        plate: std(PART_COLORS.plate, 0.5, 0.1),
        stripe: std(PART_COLORS.stripe, 0.32, 0.45, { envMapIntensity: 1.1 }),
        head: new THREE.MeshBasicMaterial({ color: PART_COLORS.head }),
        tail: new THREE.MeshBasicMaterial({ color: PART_COLORS.tail }),
        amber: new THREE.MeshBasicMaterial({ color: PART_COLORS.amber }),
        taxi: new THREE.MeshBasicMaterial({ color: PART_COLORS.taxi }),
        tire: std(PART_COLORS.tire, 0.92, 0.0),
        glass: std(0x9cc3d6, 0.05, 0.2, { transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 1.3 })
    };
    return _partMats;
}

/** Car paint: smooth clear coat look, picks up the sky in the environment map. */
export function getPaintMaterial(colorHex = 0x111111) {
    if (!_paintMats.has(colorHex)) {
        _paintMats.set(colorHex, new THREE.MeshStandardMaterial({
            color: colorHex, roughness: 0.3, metalness: 0.45, envMapIntensity: 1.1
        }));
    }
    return _paintMats.get(colorHex);
}

export function getRimMaterial(colorHex) {
    if (!_rimMats.has(colorHex)) {
        _rimMats.set(colorHex, new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.3, metalness: 0.85, envMapIntensity: 1.2 }));
    }
    return _rimMats.get(colorHex);
}

// ================================================================================================
// 2D profile helpers (polygons are arrays of [z, y])
// ================================================================================================

function clipHalf(poly, axis, value, keepAbove) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const ia = keepAbove ? a[axis] >= value : a[axis] <= value;
        const ib = keepAbove ? b[axis] >= value : b[axis] <= value;
        if (ia) out.push(a);
        if (ia !== ib) {
            const t = (value - a[axis]) / (b[axis] - a[axis]);
            out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
    }
    return out;
}

function dedupe(poly) {
    const out = [];
    for (const p of poly) {
        const q = out[out.length - 1];
        if (!q || Math.abs(q[0] - p[0]) > 1e-4 || Math.abs(q[1] - p[1]) > 1e-4) out.push(p);
    }
    while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < 1e-4 && Math.abs(out[0][1] - out[out.length - 1][1]) < 1e-4) out.pop();
    return out;
}

/** The part of `poly` inside z0..z1 and y0..y1. */
function slicePoly(poly, z0 = -Infinity, z1 = Infinity, y0 = -Infinity, y1 = Infinity) {
    let p = poly;
    if (z0 > -Infinity) p = clipHalf(p, 0, z0, true);
    if (p.length && z1 < Infinity) p = clipHalf(p, 0, z1, false);
    if (p.length && y0 > -Infinity) p = clipHalf(p, 1, y0, true);
    if (p.length && y1 < Infinity) p = clipHalf(p, 1, y1, false);
    return dedupe(p);
}

/** Front-most and rear-most z of the profile at height y. */
function zExtentAt(poly, y) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        if ((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue;
        const z = a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]);
        lo = Math.min(lo, z);
        hi = Math.max(hi, z);
    }
    return [lo, hi];
}

/** Height of the top of the profile at z. */
function topAt(poly, z) {
    let hi = -Infinity;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        if ((a[0] - z) * (b[0] - z) > 0 || a[0] === b[0]) continue;
        hi = Math.max(hi, a[1] + (b[1] - a[1]) * (z - a[0]) / (b[0] - a[0]));
    }
    return hi;
}

/** Extrudes a side profile across the car from x0 to x1, with rounded (bevelled) edges. */
function extrudeX(poly, x0, x1, bevel = 0.04) {
    if (!poly || poly.length < 3 || x1 - x0 < 0.002) return null;
    const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0], p[1])));
    const span = x1 - x0;
    const b = Math.min(bevel, span * 0.3);
    const geo = new THREE.ExtrudeGeometry(shape, {
        depth: span - 2 * b,
        bevelEnabled: b > 0.001,
        bevelThickness: b,
        bevelSize: b * 0.7,
        bevelSegments: 2,
        curveSegments: 1,
        steps: 1
    });
    // Shape x (car z) -> z, extrusion depth -> -x, then shift onto x0..x1
    geo.rotateY(-Math.PI / 2);
    geo.translate(x1 - (b > 0.001 ? b : 0), 0, 0);
    return geo;
}

function buildProfile(m) {
    const c = m.cabin;
    const top = [...m.nose, [c.front, c.belt], [c.rear, c.belt], ...m.tail];
    const g = m.ground;
    const W = m.wheels;
    const bottom = [];
    // Along the underside from the rear to the front, arching over each wheel
    for (const zc of [W.rear, W.front]) {
        const ra = W.radius + 0.07;
        const cy = W.radius;
        const dy = g - cy;
        if (Math.abs(dy) >= ra) continue;
        const a0 = Math.atan2(dy, Math.sqrt(ra * ra - dy * dy));
        const a1 = Math.PI - a0;
        const N = 12;
        for (let k = 0; k <= N; k++) {
            const a = a0 + (a1 - a0) * (k / N);
            bottom.push([zc + ra * Math.cos(a), cy + ra * Math.sin(a)]);
        }
    }
    return dedupe(top.concat(bottom));
}

// ================================================================================================
// 3D helpers
// ================================================================================================

function boxGeo(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    g.translate(x, y, z);
    return g;
}

function cylGeo(rt, rb, h, x, y, z, rx = 0, ry = 0, rz = 0, seg = 14) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    g.translate(x, y, z);
    return g;
}

/** Convex solid from 8 corners: bottom quad b0..b3 and top quad t0..t3 (same winding). */
function hexaGeo(b, t) {
    const pos = [];
    const quad = (p0, p1, p2, p3) => {
        pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
    };
    quad(t[0], t[1], t[2], t[3]);           // top
    quad(b[3], b[2], b[1], b[0]);           // bottom
    for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        quad(b[i], b[j], t[j], t[i]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    // Wind every face outward from the centroid so normals and culling are right
    const P = g.attributes.position;
    const cx = (b.concat(t)).reduce((s, p) => s + p[0], 0) / 8;
    const cy = (b.concat(t)).reduce((s, p) => s + p[1], 0) / 8;
    const cz = (b.concat(t)).reduce((s, p) => s + p[2], 0) / 8;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3(), M = new THREE.Vector3();
    for (let i = 0; i < P.count; i += 3) {
        A.fromBufferAttribute(P, i); B.fromBufferAttribute(P, i + 1); C.fromBufferAttribute(P, i + 2);
        N.subVectors(B, A).cross(M.subVectors(C, A));
        M.set((A.x + B.x + C.x) / 3 - cx, (A.y + B.y + C.y) / 3 - cy, (A.z + B.z + C.z) / 3 - cz);
        if (N.dot(M) < 0) {
            P.setXYZ(i + 1, C.x, C.y, C.z);
            P.setXYZ(i + 2, B.x, B.y, B.z);
        }
    }
    g.computeVertexNormals();
    return g;
}

/** Box running from a to b (Vector3s) with the given cross-section. */
function beamGeo(a, b, w, d = w) {
    const len = a.distanceTo(b);
    const g = new THREE.BoxGeometry(w, len, d);
    const dir = new THREE.Vector3().subVectors(b, a).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.applyQuaternion(q);
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    return g;
}

/** Inset of a convex CCW polygon, each edge i (from p[i] to p[i+1]) moved in by d[i]. */
function insetPoly(poly, d) {
    const n = poly.length;
    const lines = [];
    for (let i = 0; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        let dx = b[0] - a[0], dy = b[1] - a[1];
        const L = Math.hypot(dx, dy) || 1;
        dx /= L; dy /= L;
        const nx = -dy, ny = dx; // inward for CCW
        const di = Array.isArray(d) ? d[i] : d;
        lines.push({ px: a[0] + nx * di, py: a[1] + ny * di, dx, dy });
    }
    const out = [];
    for (let i = 0; i < n; i++) {
        const l1 = lines[(i - 1 + n) % n], l2 = lines[i];
        const den = l1.dx * l2.dy - l1.dy * l2.dx;
        if (Math.abs(den) < 1e-9) { out.push([l2.px, l2.py]); continue; }
        const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / den;
        out.push([l1.px + l1.dx * t, l1.py + l1.dy * t]);
    }
    return out;
}

function polyArea(poly) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
}

/** Point-in-polygon (any winding). */
export function pointInPoly(poly, u, v) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a[1] > v) !== (b[1] > v) && u < (b[0] - a[0]) * (v - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
}

/** Horizontal span [u0, u1] of a convex polygon at height v, or null. */
export function polySpanAt(poly, v) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        if ((a[1] - v) * (b[1] - v) > 0) continue;
        if (a[1] === b[1]) { lo = Math.min(lo, a[0], b[0]); hi = Math.max(hi, a[0], b[0]); continue; }
        const u = a[0] + (b[0] - a[0]) * (v - a[1]) / (b[1] - a[1]);
        lo = Math.min(lo, u);
        hi = Math.max(hi, u);
    }
    return lo <= hi ? [lo, hi] : null;
}

// ================================================================================================
// Model geometry: built once per body style and shared by every car of that model
// ================================================================================================

/**
 * Greenhouse corners for a cabin. Index order: base front-left, front-right, rear-right,
 * rear-left; same for the roof.
 */
function greenhouseCorners(c) {
    const H = c.roof;
    const hw = c.halfW, tw = c.halfW - c.tumble;
    const zf1 = c.front + c.rakeF, zr1 = c.rear - c.rakeR;
    const base = [[-hw, c.belt, c.front], [hw, c.belt, c.front], [hw, c.belt, c.rear], [-hw, c.belt, c.rear]];
    const top = [[-tw, H, zf1], [tw, H, zf1], [tw, H, zr1], [-tw, H, zr1]];
    return { base, top };
}

/** Cabin shape functions shared by the windows and the interior. */
export function cabinShape(model) {
    const c = getCarModel(model).cabin;
    const H = c.roof - c.belt;
    const f = (y) => Math.max(0, Math.min(1, (y - c.belt) / H));
    const seatZ = c.seatZ;
    const bPillar = seatZ + (c.rearSeats ? 0.07 : 0.42);
    return {
        belt: c.belt,
        roof: c.roof,
        front: c.front,
        rear: c.rear,
        halfW: c.halfW,
        floor: c.belt - (c.floorDrop || 0.54),
        seatZ,
        bPillar,
        rearSeats: !!c.rearSeats,
        frontGlassZ: (y) => c.front + c.rakeF * f(y),
        rearGlassZ: (y) => c.rear - c.rakeR * f(y),
        sideX: (y) => c.halfW - c.tumble * f(y),
        driverX: -c.halfW * 0.42,
        eye: { x: -c.halfW * 0.42, y: c.belt - (c.floorDrop || 0.54) + 0.79, z: seatZ - 0.2 }
    };
}

const _cache = new Map();

/**
 * Geometry for a body style, in car space:
 * - parts: [{ key, geometry }] merged per material key ('paint', 'trim', 'cabin', 'chrome', ...)
 * - door: paint geometry of the driver's door, hinge point
 * - glass: [{ name, geometry (pane local), position, quaternion, size }]
 * - windows: hit / shatter frames for 'front', 'back', 'left', 'right' and, where the model has
 *   rear quarter glass, 'leftRear', 'rightRear'
 * - wheels: wheel centres and sizes
 */
export function getModelGeometry(modelId) {
    const model = getCarModel(modelId);
    const key = model.id;
    if (_cache.has(key)) return _cache.get(key);
    const built = buildModelGeometry(model);
    _cache.set(key, built);
    return built;
}

function buildModelGeometry(m) {
    const parts = {};           // key -> [BufferGeometry]
    const add = (k, g) => {
        if (!g) return;
        (parts[k] = parts[k] || []).push(g);
    };
    const W2 = m.width / 2;
    const c = m.cabin;
    const shape = cabinShape(m);
    const profile = buildProfile(m);
    const L = m.lights || {};
    const extras = new Set(m.extras || []);
    const wheels = m.wheels;
    const frontZ = (y) => {
        const z = zExtentAt(profile, y)[0];
        return Number.isFinite(z) ? z : -m.length / 2;
    };
    const rearZ = (y) => {
        const z = zExtentAt(profile, y)[1];
        return Number.isFinite(z) ? z : m.length / 2;
    };

    // ---------- Lower body: nose, tail, tub around the cabin (and the pickup's bed) ----------
    const hollows = [{ z0: c.front, z1: c.rear, floor: shape.floor - 0.02, wall: Math.max(0.1, W2 - c.halfW + 0.03), cabin: true }]
        .concat(m.sections || []);
    hollows.sort((a, b) => a.z0 - b.z0);
    let zCursor = -Infinity;
    let doorGeo = null;
    const floorBottom = m.ground + 0.02;
    for (const h of hollows) {
        add('paint', extrudeX(slicePoly(profile, zCursor, h.z0), -W2, W2));
        const slice = slicePoly(profile, h.z0, h.z1);
        if (h.cabin) {
            // The driver's door is cut out of the left side panel, from the A- to the B-pillar
            const dz1 = shape.bPillar - 0.03;
            doorGeo = extrudeX(slicePoly(profile, h.z0 + 0.02, dz1), -W2 + 0.003, -W2 + h.wall, 0.025);
            add('paint', extrudeX(slicePoly(profile, dz1, h.z1), -W2 + 0.003, -W2 + h.wall, 0.025));
            add('paint', extrudeX(slice, W2 - h.wall, W2 - 0.003, 0.025));
        } else {
            add('paint', extrudeX(slice, -W2 + 0.003, -W2 + h.wall, 0.02));
            add('paint', extrudeX(slice, W2 - h.wall, W2 - 0.003, 0.02));
        }
        // Floor pan (and the bed floor), kept clear of the wheels
        const fb = h.cabin ? floorBottom : Math.max(floorBottom, wheels.radius * 2 + 0.06);
        const ft = h.floor;
        if (ft > fb) add(h.cabin ? 'trim' : 'paint', boxGeo(2 * (W2 - h.wall) + 0.02, ft - fb, h.z1 - h.z0, 0, (ft + fb) / 2, (h.z0 + h.z1) / 2));
        if (!h.cabin) add('trim', boxGeo(2 * (W2 - h.wall), 0.012, h.z1 - h.z0 - 0.02, 0, ft + 0.006, (h.z0 + h.z1) / 2)); // bed liner
        zCursor = h.z1;
    }
    add('paint', extrudeX(slicePoly(profile, zCursor, Infinity), -W2, W2));

    // Wheel well liners: dark inner walls so you can't see through the arches
    for (const zc of [wheels.front, wheels.rear]) {
        const ra = wheels.radius + 0.07;
        const x = wheels.track - wheels.width / 2 - 0.06;
        // Kept under the body's top surface (low noses sit barely above the arches)
        const yTop = Math.min(wheels.radius + ra, Math.min(topAt(profile, zc - ra * 0.8), topAt(profile, zc + ra * 0.8), topAt(profile, zc)) - 0.07);
        for (const s of [-1, 1]) add('trim', boxGeo(0.03, yTop - m.ground + 0.01, ra * 2, s * x, (m.ground + yTop) / 2, zc));
        add('trim', boxGeo(2 * x, 0.03, ra * 1.6, 0, yTop - 0.02, zc));
    }

    // ---------- Greenhouse ----------
    const gh = greenhouseCorners(c);
    // The greenhouse is open behind the glass: pillars, roof edges and a headliner under the roof
    const ghv = (p) => new THREE.Vector3(p[0], p[1], p[2]);
    const framePw = 0.07;
    const frameParts = [hexaGeo(gh.top.map((p) => [p[0], p[1] - 0.025, p[2]]), gh.top)];
    for (let i = 0; i < 4; i++) {
        frameParts.push(beamGeo(ghv(gh.base[i]), ghv(gh.top[i]), framePw));                // A- and C-pillars
        frameParts.push(beamGeo(ghv(gh.top[i]), ghv(gh.top[(i + 1) % 4]), framePw));       // roof edges
    }
    for (const side of [-1, 1]) {
        const xb = side * shape.sideX(shape.belt), xt = side * shape.sideX(shape.roof);
        frameParts.push(beamGeo(new THREE.Vector3(xb * 0.99, shape.belt, shape.bPillar), new THREE.Vector3(xt * 0.99, shape.roof, shape.bPillar), framePw * 1.3, 0.1));
    }
    const cabinGeo = mergeGeometries(frameParts);
    // Plain seats and dash, seen through the glass of cars without a full interior (traffic)
    const fl = shape.floor, sz = shape.seatZ;
    const seatX = Math.abs(shape.driverX), seatW = Math.min(0.5, shape.halfW * 0.85);
    const furniture = [boxGeo(shape.halfW * 1.9, 0.26, 0.4, 0, shape.belt - 0.1, shape.frontGlassZ(shape.belt) + 0.22)];
    const seat = (x, w, z) => {
        furniture.push(boxGeo(w, 0.14, 0.5, x, fl + 0.24, z));
        furniture.push(boxGeo(w, 0.62, 0.12, x, fl + 0.6, z + 0.3, 0.18));
    };
    for (const s of [-1, 1]) {
        seat(s * seatX, seatW, sz);
        furniture.push(boxGeo(seatW * 0.5, 0.16, 0.1, s * seatX, fl + 1.0, sz + 0.37));      // headrest
    }
    if (shape.rearSeats) seat(0, shape.halfW * 1.7, sz + 0.95);
    const furnitureGeo = mergeGeometries(furniture);
    // Roof panel in body colour, lying on the greenhouse top
    const rt = gh.top.map((p) => [p[0] * 1.012, p[1] - 0.004, p[2] + (p[2] < (c.front + c.rear) / 2 ? -0.012 : 0.012)]);
    const rTop = gh.top.map((p) => [p[0] * 0.97, p[1] + 0.035, p[2] + (p[2] < (c.front + c.rear) / 2 ? 0.03 : -0.03)]);
    add('paint', hexaGeo(rt, rTop));

    // Glass: one pane per greenhouse face, inset to leave pillars; the side glass is split at the
    // B-pillar into the door glass and the rear quarter glass
    const glass = [];
    const windows = {};
    const v3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);
    const makeFrame = (O, U, V) => {
        const N = new THREE.Vector3().crossVectors(U, V).normalize();
        return { O, U, V, N };
    };
    const toUV = (F, P) => {
        const d = new THREE.Vector3().subVectors(P, F.O);
        return [d.dot(F.U), d.dot(F.V)];
    };
    const addPane = (name, F, poly, windowKey, floor) => {
        if (polyArea(poly) < 0) poly = poly.slice().reverse();
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        for (const [u, v] of poly) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
        const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
        const s = new THREE.Shape(poly.map(([u, v]) => new THREE.Vector2(u - uc, v - vc)));
        const geo = new THREE.ShapeGeometry(s);
        const position = F.O.clone().addScaledVector(F.U, uc).addScaledVector(F.V, vc).addScaledVector(F.N, 0.004);
        const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(F.U, F.V, F.N));
        glass.push({ name, geometry: geo, position, quaternion, size: { w: u1 - u0, h: v1 - v0 } });
        if (windowKey) {
            windows[windowKey] = {
                key: windowKey, glass: name,
                origin: F.O.clone().addScaledVector(F.N, 0.004), U: F.U.clone(), V: F.V.clone(), N: F.N.clone(),
                poly, u0, u1, v0, v1, floor,
                center: position.clone()
            };
        }
    };
    const [b0, b1, b2, b3] = gh.base.map(v3);
    const [t0, t1, t2, t3] = gh.top.map(v3);
    const pillar = 0.06;
    // Front: viewed from ahead, screen-right is -x
    {
        const F = makeFrame(new THREE.Vector3(0, c.belt, c.front), new THREE.Vector3(-1, 0, 0), new THREE.Vector3().subVectors(t0, b0).setX(0).normalize());
        const poly = [toUV(F, b1), toUV(F, b0), toUV(F, t0), toUV(F, t1)];
        addPane('windshield', F, insetPoly(polyArea(poly) > 0 ? poly : poly.reverse(), [0.03, pillar, 0.05, pillar]), 'front', shape.floor + 0.62);
    }
    // Rear: viewed from behind, screen-right is +x
    {
        const F = makeFrame(new THREE.Vector3(0, c.belt, c.rear), new THREE.Vector3(1, 0, 0), new THREE.Vector3().subVectors(t3, b3).setX(0).normalize());
        let poly = [toUV(F, b3), toUV(F, b2), toUV(F, t2), toUV(F, t3)];
        if (polyArea(poly) < 0) poly = poly.reverse();
        addPane('rear_glass', F, insetPoly(poly, [0.03, pillar + 0.01, 0.05, pillar + 0.01]), 'back', shape.floor + 0.3);
    }
    // Sides
    for (const s of [-1, 1]) {
        const side = s < 0 ? 'left' : 'right';
        const bf = s < 0 ? b0 : b1, br = s < 0 ? b3 : b2, tf = s < 0 ? t0 : t1, tr = s < 0 ? t3 : t2;
        const U = new THREE.Vector3(0, 0, s < 0 ? 1 : -1);
        const V = new THREE.Vector3().subVectors(tf, bf).setZ(0).normalize();
        const F = makeFrame(new THREE.Vector3(s * c.halfW, c.belt, 0), U, V);
        let poly = [toUV(F, bf), toUV(F, br), toUV(F, tr), toUV(F, tf)];
        if (polyArea(poly) < 0) poly = poly.reverse();
        const inner = insetPoly(poly, 0.035);
        // Split at the B-pillar: u = z for the left side, -z for the right
        const uB = s < 0 ? shape.bPillar : -shape.bPillar;
        const uv = inner.map(([u, v]) => [u, v]);
        const frontSide = s < 0 ? slicePoly(uv, -Infinity, uB - 0.05) : slicePoly(uv, uB + 0.05, Infinity);
        const rearSide = s < 0 ? slicePoly(uv, uB + 0.05, Infinity) : slicePoly(uv, -Infinity, uB - 0.05);
        addPane(`${side}_window_glass`, F, frontSide, side, shape.floor + 0.26);
        if (rearSide.length >= 3 && Math.abs(polyArea(rearSide)) > 0.02) addPane(`${side}_quarter_glass`, F, rearSide, `${side}Rear`, shape.floor + 0.26);
    }

    // ---------- Lights, grille, bumpers, plates ----------
    const lightBox = (k, w, h, x, y, zFace, dir, depth = 0.07) => {
        add(k, boxGeo(w, h, depth, x, y, zFace + dir * (depth / 2 - 0.035)));
    };
    if (L.head) {
        const hd = L.head;
        const zf = frontZ(hd.y);
        for (const s of [-1, 1]) {
            const x = s * hd.x;
            if (hd.shape === 'round2') {
                for (const k of [0, 1]) {
                    const r = hd.h * 0.5;
                    const xx = x - s * (hd.w * 0.5 - r) + s * k * (hd.w - 2 * r);
                    add('head', cylGeo(r, r, 0.08, xx, hd.y, frontZ(hd.y) + 0.0, Math.PI / 2, 0, 0, 18));
                    add('chrome', cylGeo(r * 1.18, r * 1.18, 0.05, xx, hd.y, frontZ(hd.y) + 0.02, Math.PI / 2, 0, 0, 18));
                }
            } else if (hd.shape === 'slim') {
                lightBox('head', hd.w, hd.h, x, hd.y, zf, 1, 0.2);
                lightBox('amber', 0.12, hd.h * 0.6, x + s * (hd.w / 2 + 0.03), hd.y, frontZ(hd.y), 1, 0.05);
            } else if (hd.shape === 'swept') {
                // Swept-back cluster: lens on the nose plus a strip running up the fender
                lightBox('head', hd.w, hd.h, x, hd.y, zf, 1);
                add('head', boxGeo(0.05, hd.h * 0.8, 0.32, s * (W2 - 0.04), hd.y + 0.02, zf + 0.22, 0, 0, 0));
                lightBox('amber', 0.1, hd.h * 0.5, x + s * (hd.w / 2 - 0.05), hd.y - hd.h * 0.65, frontZ(hd.y - hd.h * 0.65), 1, 0.05);
            } else {
                lightBox('head', hd.w, hd.h, x, hd.y, zf, 1);
                lightBox('amber', hd.w * 0.3, hd.h * 0.45, x, hd.y - hd.h * 0.75, frontZ(hd.y - hd.h * 0.75), 1, 0.05);
            }
        }
    }
    if (L.tail) {
        const tl = L.tail;
        const zr = rearZ(tl.y);
        if (tl.shape === 'bar') {
            lightBox('tail', tl.w, tl.h, 0, tl.y, zr, -1);
        } else {
            for (const s of [-1, 1]) {
                const x = s * tl.x;
                if (tl.shape === 'tall') {
                    add('tail', boxGeo(tl.w, tl.h, 0.07, x, tl.y, rearZ(tl.y) + 0.0));
                    add('amber', boxGeo(tl.w * 0.9, tl.h * 0.18, 0.075, x, tl.y - tl.h * 0.32, rearZ(tl.y - tl.h * 0.32)));
                } else if (tl.shape === 'triple') {
                    for (let k = 0; k < 3; k++) {
                        const xx = x - s * tl.w / 2 + s * (k + 0.5) * (tl.w / 3);
                        add('tail', boxGeo(tl.w / 3 - 0.03, tl.h, 0.07, xx, tl.y, zr));
                    }
                    add('chrome', boxGeo(tl.w + 0.04, tl.h + 0.04, 0.04, x, tl.y, zr + 0.015));
                } else if (tl.shape === 'wrap') {
                    lightBox('tail', tl.w, tl.h, x, tl.y, zr, -1);
                    add('tail', boxGeo(0.05, tl.h * 0.9, 0.3, s * (W2 - 0.035), tl.y, zr - 0.2));
                    lightBox('amber', tl.w * 0.35, tl.h * 0.4, x - s * tl.w * 0.25, tl.y - tl.h * 0.7, rearZ(tl.y - tl.h * 0.7), -1, 0.05);
                } else {
                    lightBox('tail', tl.w, tl.h, x, tl.y, zr, -1);
                }
            }
        }
        // Reversing lights / third brake light
        add('tail', boxGeo(0.4, 0.035, 0.05, 0, c.roof - 0.04, c.rear - c.rakeR + 0.02));
    }
    if (L.grille) {
        const gr = L.grille;
        const zf = frontZ(gr.y);
        lightBox('trim', gr.w, gr.h, 0, gr.y, zf, 1, 0.06);
        if (gr.chrome) {
            add('chrome', boxGeo(gr.w + 0.06, 0.03, 0.05, 0, gr.y + gr.h / 2, frontZ(gr.y + gr.h / 2) - 0.005));
            add('chrome', boxGeo(gr.w + 0.06, 0.03, 0.05, 0, gr.y - gr.h / 2, frontZ(gr.y - gr.h / 2) - 0.005));
            for (let i = 1; i < 4; i++) add('chrome', boxGeo(gr.w, 0.015, 0.05, 0, gr.y - gr.h / 2 + i * gr.h / 4, zf - 0.01));
        }
        add('chrome', boxGeo(0.12, 0.06, 0.03, 0, gr.y + (gr.chrome ? 0 : 0.02), zf - 0.035)); // badge
    }
    for (const [spec, dir] of [[L.bumperF, 1], [L.bumperR, -1]]) {
        if (!spec) continue;
        const zf = dir > 0 ? frontZ(spec.y) : rearZ(spec.y);
        const k = spec.chrome ? 'chrome' : 'trim';
        add(k, boxGeo(m.width - 0.16, spec.h, 0.12, 0, spec.y, zf - dir * 0.02));
        // License plate
        const py = spec.y + (dir > 0 ? 0 : spec.h * 0.5 + 0.08);
        const pz = dir > 0 ? frontZ(spec.y) - 0.13 : rearZ(py) + 0.02;
        add('plate', boxGeo(0.52, 0.13, 0.02, 0, py, pz));
    }
    if (L.exhaust) {
        const ex = L.exhaust;
        const ey = m.ground + 0.04;
        const ez = rearZ(Math.max(ey, m.ground + 0.06)) + 0.02;
        const xs = ex.count === 4 ? [-ex.x - 0.07, -ex.x + 0.07, ex.x - 0.07, ex.x + 0.07]
            : ex.count === 2 ? [-ex.x, ex.x] : [ex.x];
        if (ex.side) {
            add('chrome', cylGeo(ex.r, ex.r, 0.2, W2 - 0.25, m.ground - 0.02, wheels.rear - wheels.radius - 0.3, Math.PI / 2, 0, 0, 12));
        } else {
            for (const x of xs) add('chrome', cylGeo(ex.r, ex.r, 0.18, x, ey, ez, Math.PI / 2, 0, 0, 12));
        }
    }

    // ---------- Mirrors, handles, extras ----------
    for (const s of [-1, 1]) {
        const mz = c.front + 0.22;
        const my = c.belt + 0.1;
        add('paint', boxGeo(0.2, 0.12, 0.14, s * (c.halfW + 0.2), my, mz));
        add('trim', boxGeo(0.14, 0.04, 0.05, s * (c.halfW + 0.08), my - 0.04, mz + 0.03));
        add('cabin', boxGeo(0.01, 0.09, 0.11, s * (c.halfW + 0.2) + 0, my, mz + 0.072, 0, Math.PI / 2, 0));
        // Door handles
        add('chrome', boxGeo(0.02, 0.035, 0.14, s * (W2 + 0.004), c.belt - 0.1, shape.bPillar - 0.25));
        if (c.rearSeats) add('chrome', boxGeo(0.02, 0.035, 0.14, s * (W2 + 0.004), c.belt - 0.1, Math.min(c.rear - 0.15, shape.bPillar + 0.6)));
    }
    const topNoseZ = (frac) => c.front - (c.front - m.nose[0][0]) * frac;
    if (extras.has('lip')) add('trim', boxGeo(m.width - 0.3, 0.03, 0.12, 0, m.ground + 0.02, frontZ(m.ground + 0.05) + 0.06));
    if (extras.has('skirts')) for (const s of [-1, 1]) add('trim', boxGeo(0.05, 0.06, wheels.rear - wheels.front - 2 * (wheels.radius + 0.1), s * (W2 - 0.01), m.ground + 0.03, (wheels.front + wheels.rear) / 2));
    if (extras.has('cladding')) {
        for (const s of [-1, 1]) add('trim', boxGeo(0.04, 0.16, wheels.rear - wheels.front - 2 * (wheels.radius + 0.08), s * (W2 + 0.0), m.ground + 0.1, (wheels.front + wheels.rear) / 2));
    }
    if (extras.has('spoiler')) {
        const sz = m.length / 2 - 0.22;
        const sy = topAt(profile, sz);
        add('paint', boxGeo(m.width - 0.3, 0.025, 0.28, 0, sy + 0.17, sz, -0.08));
        for (const s of [-1, 1]) add('paint', boxGeo(0.04, 0.16, 0.12, s * 0.62, sy + 0.08, sz + 0.02));
        for (const s of [-1, 1]) add('paint', boxGeo(0.02, 0.12, 0.3, s * (m.width / 2 - 0.16), sy + 0.17, sz));
    }
    if (extras.has('diffuser')) {
        const z = rearZ(m.ground + 0.1);
        add('trim', boxGeo(1.2, 0.1, 0.2, 0, m.ground + 0.05, z - 0.08));
        for (let i = -2; i <= 2; i++) add('trim', boxGeo(0.02, 0.1, 0.25, i * 0.22, m.ground + 0.07, z - 0.08));
    }
    if (extras.has('ducktail')) {
        const z = m.length / 2 - 0.1;
        add('paint', boxGeo(m.width - 0.4, 0.05, 0.16, 0, topAt(profile, z) + 0.02, z, 0.2));
    }
    if (extras.has('roofSpoilerSmall')) {
        add('paint', boxGeo((c.halfW - c.tumble) * 2 - 0.05, 0.04, 0.22, 0, c.roof + 0.02, c.rear - c.rakeR + 0.08, 0.15));
    }
    if (extras.has('hoodScoop')) {
        const z = topNoseZ(0.4);
        const y = topAt(profile, z);
        add('paint', hexaGeo(
            [[-0.32, y - 0.02, z - 0.35], [0.32, y - 0.02, z - 0.35], [0.32, y - 0.02, z + 0.35], [-0.32, y - 0.02, z + 0.35]],
            [[-0.26, y + 0.01, z - 0.3], [0.26, y + 0.01, z - 0.3], [0.28, y + 0.1, z + 0.32], [-0.28, y + 0.1, z + 0.32]]
        ));
        add('trim', boxGeo(0.46, 0.07, 0.02, 0, y + 0.055, z + 0.335));
    }
    if (extras.has('stripes')) {
        // Twin racing stripes over the hood, roof and trunk
        const band = (z0, z1) => {
            const pts = [...m.nose, [c.front, c.belt], [c.rear, c.belt], ...m.tail].filter((p) => p[0] >= z0 - 1e-6 && p[0] <= z1 + 1e-6 && p[1] > m.ground + 0.3);
            const line = pts.length >= 2 ? pts : [];
            if (line.length < 2) return null;
            // The bevelled body top sits ~3 cm above its profile line
            const up = line.map(([z, y]) => [z, y + 0.034]);
            const dn = line.slice().reverse().map(([z, y]) => [z, y]);
            return dedupe(up.concat(dn));
        };
        const hoodBand = band(m.nose[0][0] + 0.05, c.front);
        const trunkBand = band(c.rear, m.length / 2 - 0.05);
        for (const s of [-1, 1]) {
            add('stripe', extrudeX(hoodBand, s * 0.12 - 0.11, s * 0.12 + 0.11, 0));
            add('stripe', extrudeX(trunkBand, s * 0.12 - 0.11, s * 0.12 + 0.11, 0));
            add('stripe', boxGeo(0.22, 0.012, c.rear - c.rakeR - c.front - c.rakeF - 0.08, s * 0.12, c.roof + 0.037, (c.front + c.rakeF + c.rear - c.rakeR) / 2));
        }
    }
    if (extras.has('roofRack')) {
        const tw = c.halfW - c.tumble - 0.12;
        const z0 = c.front + c.rakeF + 0.12, z1 = c.rear - c.rakeR - 0.1;
        for (const s of [-1, 1]) {
            add('trim', boxGeo(0.05, 0.05, z1 - z0, s * tw, c.roof + 0.09, (z0 + z1) / 2));
            for (const z of [z0 + 0.05, z1 - 0.05]) add('trim', boxGeo(0.06, 0.08, 0.08, s * tw, c.roof + 0.05, z));
        }
        for (const z of [z0 + 0.4, z1 - 0.4]) add('trim', boxGeo(tw * 2, 0.03, 0.05, 0, c.roof + 0.12, z));
    }
    if (extras.has('sideSteps')) {
        for (const s of [-1, 1]) add('chrome', boxGeo(0.16, 0.04, c.rear - c.front, s * (W2 + 0.04), m.ground - 0.02, (c.front + c.rear) / 2));
    }
    if (extras.has('flares')) {
        for (const zc of [wheels.front, wheels.rear]) {
            for (const s of [-1, 1]) {
                const ra = wheels.radius + 0.1;
                for (let k = 0; k < 7; k++) {
                    const a0 = Math.PI * (0.08 + 0.84 * k / 7), a1 = Math.PI * (0.08 + 0.84 * (k + 1) / 7);
                    const p0 = new THREE.Vector3(s * (W2 + 0.03), wheels.radius + ra * Math.sin(a0), zc + ra * Math.cos(a0));
                    const p1 = new THREE.Vector3(s * (W2 + 0.03), wheels.radius + ra * Math.sin(a1), zc + ra * Math.cos(a1));
                    add('trim', beamGeo(p0, p1, 0.07, 0.07));
                }
            }
        }
    }
    if (extras.has('towHitch')) add('chrome', boxGeo(0.08, 0.08, 0.25, 0, (L.bumperR ? L.bumperR.y : 0.6) - 0.12, m.length / 2 + 0.05));
    if (extras.has('slideTrack')) add('trim', boxGeo(0.03, 0.03, c.rear - shape.bPillar - 0.6, W2 + 0.002, c.belt - 0.02, (shape.bPillar + c.rear - 0.4) / 2 + 0.1));
    if (extras.has('taxiSign')) {
        const z = (c.front + c.rakeF + c.rear - c.rakeR) / 2;
        add('taxi', boxGeo(0.62, 0.16, 0.22, 0, c.roof + 0.12, z));
        add('trim', boxGeo(0.66, 0.035, 0.26, 0, c.roof + 0.035, z));
    }

    // ---------- Wheels ----------
    const wheelList = [];
    for (const [z, steer, label] of [[wheels.front, true, 'f'], [wheels.rear, false, 'r']]) {
        for (const s of [-1, 1]) {
            wheelList.push({ x: s * wheels.track, y: wheels.radius, z, steer, side: s, label: label + (s < 0 ? 'l' : 'r') });
        }
    }

    // Merge everything per key (non-indexed position + normal)
    const merged = {};
    for (const k of Object.keys(parts)) merged[k] = mergeGeometries(parts[k]);

    return {
        model: m,
        profile,
        parts: merged,
        cabin: cabinGeo,
        furniture: furnitureGeo,
        door: { geometry: doorGeo, hinge: new THREE.Vector3(-W2, 0, c.front + 0.02) },
        glass,
        windows,
        wheels: wheelList,
        greenhouse: gh,
        shape
    };
}

/** Splits a merged part into its left (x < 0) and right triangles; cached on the model geometry. */
function splitByX(G, key) {
    G.split = G.split || {};
    if (G.split[key]) return G.split[key];
    const src = G.parts[key];
    const P = src.attributes.position.array, Nn = src.attributes.normal.array;
    const sides = [[[], []], [[], []]];
    for (let i = 0; i < P.length; i += 9) {
        const cx = P[i] + P[i + 3] + P[i + 6];
        const dst = sides[cx < 0 ? 0 : 1];
        for (let j = 0; j < 9; j++) {
            dst[0].push(P[i + j]);
            dst[1].push(Nn[i + j]);
        }
    }
    G.split[key] = sides.map(([pos, nor]) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        return g;
    });
    return G.split[key];
}

/** Merges geometries into one non-indexed position + normal geometry. */
export function mergeGeometries(list, colors = null) {
    const geos = list.filter(Boolean).map((g) => (g.index ? g.toNonIndexed() : g));
    let n = 0;
    for (const g of geos) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const col = colors ? new Float32Array(n * 3) : null;
    let o = 0;
    const tmp = new THREE.Color();
    geos.forEach((g, gi) => {
        if (!g.attributes.normal) g.computeVertexNormals();
        pos.set(g.attributes.position.array, o * 3);
        nor.set(g.attributes.normal.array, o * 3);
        if (col) {
            tmp.setHex(colors[gi]);
            for (let i = 0; i < g.attributes.position.count; i++) {
                col[(o + i) * 3] = tmp.r; col[(o + i) * 3 + 1] = tmp.g; col[(o + i) * 3 + 2] = tmp.b;
            }
        }
        o += g.attributes.position.count;
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
}

// ================================================================================================
// Wheels (unit size: radius 1, width 1, axle along x; scaled per model)
// ================================================================================================

let _wheelGeo = null;
export function getUnitWheelGeometry() {
    if (_wheelGeo) return _wheelGeo;
    // Tyre: rounded cross-section lathed around the axle
    const prof = [];
    const pts = [[0.66, -0.5], [0.8, -0.5], [0.93, -0.47], [0.99, -0.38], [1.0, -0.2], [1.0, 0.2], [0.99, 0.38], [0.93, 0.47], [0.8, 0.5], [0.66, 0.5]];
    for (const [r, y] of pts) prof.push(new THREE.Vector2(r, y));
    const tire = new THREE.LatheGeometry(prof, 22);
    tire.rotateZ(Math.PI / 2);
    // Rim: dish, five spokes and a centre cap on the outer face (+x / -x both, so either side works)
    const rimParts = [];
    for (const s of [-1, 1]) {
        const dish = new THREE.CylinderGeometry(0.68, 0.68, 0.06, 22, 1, true);
        dish.rotateZ(Math.PI / 2);
        dish.translate(s * 0.4, 0, 0);
        rimParts.push(dish);
        const face = new THREE.CircleGeometry(0.66, 22);
        face.rotateY(s * Math.PI / 2);
        face.translate(s * 0.28, 0, 0);
        rimParts.push(face);
        const cap = new THREE.CylinderGeometry(0.16, 0.18, 0.08, 14);
        cap.rotateZ(Math.PI / 2);
        cap.translate(s * 0.4, 0, 0);
        rimParts.push(cap);
        for (let k = 0; k < 5; k++) {
            const a = (k / 5) * Math.PI * 2;
            const sp = new THREE.BoxGeometry(0.06, 0.5, 0.13);
            sp.translate(0, 0.4, 0);
            sp.rotateX(a);
            sp.translate(s * 0.38, 0, 0);
            rimParts.push(sp);
        }
    }
    _wheelGeo = { tire: mergeGeometries([tire]), rim: mergeGeometries(rimParts) };
    return _wheelGeo;
}

// ================================================================================================
// Individual car mesh
// ================================================================================================

/**
 * Builds the car as a THREE.Group.
 * @returns {{ root, wheelPivots, wheels, leftDoorPivot, cabinAnchor }}
 */
export function buildCarMesh(modelId, color = 0x111111, id = 'car') {
    const model = getCarModel(modelId);
    const G = getModelGeometry(model.id);
    const M = getPartMaterials();
    const paint = getPaintMaterial(color);

    const root = new THREE.Group();
    root.name = `car_${model.id}_${id}`;
    root.userData.isHondaCivic = true; // every drivable car shares the Civic's interfaces
    root.userData.carModel = model.id;

    const body = new THREE.Mesh(G.parts.paint, paint);
    body.name = 'sedan_body';
    root.add(body);
    const sideNames = { head: 'headlight', tail: 'taillight' };
    for (const k of Object.keys(G.parts)) {
        if (k === 'paint') continue;
        if (sideNames[k]) {
            // Head and tail lights as a left and a right cluster
            splitByX(G, k).forEach((geo, i) => {
                const mesh = new THREE.Mesh(geo, M[k]);
                mesh.name = `${sideNames[k]}_${i === 0 ? 'left' : 'right'}`;
                root.add(mesh);
            });
            continue;
        }
        const mesh = new THREE.Mesh(G.parts[k], M[k] || M.trim);
        mesh.name = `car_${k}`;
        root.add(mesh);
    }
    const cabin = new THREE.Mesh(G.cabin, M.cabin);
    cabin.name = 'cabin_roof';
    root.add(cabin);
    // Hidden once the car gets a full interior (CarInterior)
    const furniture = new THREE.Mesh(G.furniture, M.trim);
    furniture.name = 'cabin_furniture';
    root.add(furniture);

    for (const pane of G.glass) {
        const g = new THREE.Mesh(pane.geometry, M.glass);
        g.name = pane.name;
        g.position.copy(pane.position);
        g.quaternion.copy(pane.quaternion);
        g.userData.windowSize = pane.size;
        g.castShadow = false;
        root.add(g);
    }

    // Driver's door, hinged at its front edge (carjacking animation swings it open)
    const leftDoorPivot = new THREE.Group();
    leftDoorPivot.name = 'driver_door_pivot';
    leftDoorPivot.position.copy(G.door.hinge);
    if (G.door.geometry) {
        const door = new THREE.Mesh(G.door.geometry, paint);
        door.name = 'driver_door_panel';
        door.position.copy(G.door.hinge).negate();
        leftDoorPivot.add(door);
    }
    root.add(leftDoorPivot);
    root.userData.leftDoorPivot = leftDoorPivot;
    // The door glass swings open with the door
    const doorGlass = root.getObjectByName('left_window_glass');
    if (doorGlass) {
        root.remove(doorGlass);
        doorGlass.position.sub(G.door.hinge);
        leftDoorPivot.add(doorGlass);
    }

    // Wheels
    const W = getUnitWheelGeometry();
    const rimMat = getRimMaterial(model.wheels.rim);
    const wheelPivots = {};
    const wheels = {};
    const names = { fl: 'frontLeft', fr: 'frontRight', rl: 'rearLeft', rr: 'rearRight' };
    for (const w of G.wheels) {
        const pivot = new THREE.Group();
        pivot.name = `wheel_pivot_${w.label}`;
        pivot.position.set(w.x, w.y, w.z);
        const roller = new THREE.Group();
        roller.name = `wheel_roller_${w.label}`;
        const tire = new THREE.Mesh(W.tire, M.tire);
        tire.name = `wheel_tire_${w.label}`;
        const rim = new THREE.Mesh(W.rim, rimMat);
        rim.name = `wheel_hubcap_${w.label}`;
        roller.add(tire, rim);
        roller.scale.set(model.wheels.width, model.wheels.radius, model.wheels.radius);
        pivot.add(roller);
        root.add(pivot);
        wheels[names[w.label]] = roller;
        if (w.steer) wheelPivots[names[w.label]] = pivot;
    }

    // Everything that sits in the cabin (NPC driver, ...) hangs off this anchor
    // (placed so things laid out for the Civic's driver's seat land in this car's driver's seat)
    const cabinAnchor = new THREE.Group();
    cabinAnchor.name = 'cabin_anchor';
    const eye = G.shape.eye, civicEye = cabinShape(DEFAULT_CAR_MODEL).eye;
    cabinAnchor.position.set(eye.x - civicEye.x, eye.y - civicEye.y, eye.z - civicEye.z);
    root.add(cabinAnchor);

    root.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = child.material !== M.glass && !child.material.isMeshBasicMaterial;
            child.receiveShadow = true;
        }
    });

    return { root, wheelPivots, wheels, leftDoorPivot, cabinAnchor, model };
}

/**
 * Window frames of a car (car space): { front, back, left, right }, each with origin, U, V, N
 * (N points out of the car), the pane outline `poly` in (u, v) and `floor`, the height loose
 * shards settle at inside.
 */
export function getWindowFrames(vehicleOrModel) {
    const id = vehicleOrModel && vehicleOrModel.model ? vehicleOrModel.model.id : vehicleOrModel;
    return getModelGeometry(getCarModel(id).id).windows;
}

/**
 * Merged geometry per model for the instanced fleet: `body`, one draw call per model, with vertex
 * `color`, `paintMask` (1 = body paint, tinted by the per-instance colour) and `glow` (1 = lamp,
 * drawn self-lit), see InstancedVehicleFleet's material; and `glass`, every pane, drawn see-through
 * in a second batch so the people inside show.
 */
export function getFleetGeometry(modelId) {
    const G = getModelGeometry(getCarModel(modelId).id);
    if (G.fleet) return G.fleet;
    const list = [];  // [geometry, color, paint, glow]
    list.push([G.parts.paint, 0xffffff, 1, 0]);
    if (G.door.geometry) list.push([G.door.geometry, 0xffffff, 1, 0]);
    for (const k of Object.keys(G.parts)) {
        if (k === 'paint') continue;
        list.push([G.parts[k], PART_COLORS[k] !== undefined ? PART_COLORS[k] : PART_COLORS.trim, 0, LIGHT_KEYS.has(k) ? 1 : 0]);
    }
    list.push([G.cabin, PART_COLORS.cabin, 0, 0]);
    list.push([G.furniture, PART_COLORS.trim, 0, 0]);
    const glass = mergeGeometries(G.glass.map((p) => p.geometry.clone()
        .applyMatrix4(new THREE.Matrix4().compose(p.position, p.quaternion, new THREE.Vector3(1, 1, 1)))));
    const body = mergeGeometries(list.map((e) => e[0]), list.map((e) => e[1]));
    const n = body.attributes.position.count;
    const paint = new Float32Array(n), glow = new Float32Array(n);
    let o = 0;
    for (const [geo, , isPaint, isGlow] of list) {
        const c = geo.index ? geo.index.count : geo.attributes.position.count;
        paint.fill(isPaint, o, o + c);
        glow.fill(isGlow, o, o + c);
        o += c;
    }
    body.setAttribute('paintMask', new THREE.BufferAttribute(paint, 1));
    body.setAttribute('glow', new THREE.BufferAttribute(glow, 1));
    G.fleet = { body, glass };
    return G.fleet;
}
