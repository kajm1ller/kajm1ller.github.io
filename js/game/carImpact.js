/**
 * js/game/carImpact.js
 *
 * The shape of a car as a person hit by it meets it: a height map of the body (bumper, bonnet,
 * windscreen, roof, boot) sampled once per model by raycasting the car's mesh from above, plus
 * helpers to work in the car's own frame. The game's ragdoll solver uses it to slide bodies over
 * the bonnet and roof, and to tell when a wheel rolls over someone lying in the road.
 *
 * Car frame: lx to the right, lz towards the back (the mesh's local axes; the car drives along -z).
 */

import * as THREE from 'three';

const COLS = [-0.85, -0.45, 0, 0.45, 0.85]; // lateral samples, as a fraction of the half width
const STEP = 0.2;                            // m between samples along the car
const _cache = new Map();                    // model id -> surface
const _raycaster = new THREE.Raycaster();
const _origin = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _hits = [];

function visibleChain(o, root) {
    for (let p = o; p && p !== root.parent; p = p.parent) if (!p.visible) return false;
    return true;
}

function skipPart(o) {
    if (o.isSprite || o.userData.isImpactDecal) return true;
    const n = o.name || '';
    if (n === 'window_blood_decal' || n.startsWith('wheel_')) return true;
    for (let p = o; p; p = p.parent) if (p.name === 'vehicle_driver_npc') return true;
    return false;
}

/** A plain sedan, for cars with no mesh to sample. */
function genericHeight(lz, halfL) {
    const s = (lz + halfL) / (2 * halfL); // 0 front .. 1 back
    if (s < 0.06) return 0.55 + s * 4;
    if (s < 0.3) return 0.8 + (s - 0.06) * 0.25;
    if (s < 0.45) return 0.86 + (s - 0.3) * 3.6;
    if (s < 0.75) return 1.4;
    if (s < 0.88) return 1.4 - (s - 0.75) * 3.5;
    return 0.95;
}

/**
 * Height map of a car's top surface (heights above the car's base, 0 where nothing is there).
 * @returns {{halfL:number, halfW:number, n:number, heights:Float32Array[], frontH:number}}
 */
export function carSurface(vehicle) {
    const key = vehicle.modelId || (vehicle.model && vehicle.model.id) || 'generic';
    const cached = _cache.get(key);
    if (cached) return cached;

    const halfL = (vehicle.length || 4.5) / 2;
    const halfW = (vehicle.width || 1.9) / 2;
    const n = Math.max(2, Math.round((2 * halfL) / STEP) + 1);
    const heights = COLS.map(() => new Float32Array(n));
    const mesh = vehicle.mesh;
    let sampled = false;

    if (mesh) {
        // Sample in the car's own frame: park the mesh at the origin for a moment
        const pos = mesh.position.clone(), quat = mesh.quaternion.clone();
        mesh.position.set(0, 0, 0);
        mesh.quaternion.identity();
        mesh.updateMatrixWorld(true);
        const parentM = mesh.parent ? mesh.parent.matrixWorld : null; // (the scene: normally identity)
        for (let c = 0; c < COLS.length; c++) {
            for (let i = 0; i < n; i++) {
                _origin.set(COLS[c] * halfW, 5, -halfL + i * STEP);
                if (parentM) _origin.applyMatrix4(parentM);
                _raycaster.set(_origin, _down);
                _raycaster.far = 6;
                _hits.length = 0;
                mesh.raycast(_raycaster, _hits);
                _raycaster.intersectObjects(mesh.children, true, _hits);
                _hits.sort((a, b) => a.distance - b.distance);
                for (const h of _hits) {
                    if (skipPart(h.object) || !visibleChain(h.object, mesh)) continue;
                    heights[c][i] = Math.max(0, 5 - h.distance);
                    sampled = true;
                    break;
                }
            }
        }
        mesh.position.copy(pos);
        mesh.quaternion.copy(quat);
        mesh.updateMatrixWorld(true);
    }
    if (!sampled) {
        for (let c = 0; c < COLS.length; c++) {
            for (let i = 0; i < n; i++) heights[c][i] = genericHeight(-halfL + i * STEP, halfL) * (1 - 0.15 * Math.abs(COLS[c]));
        }
    }

    const surf = { halfL, halfW, n, heights, frontH: 0 };
    // How high the leading face reaches (bumper / bonnet edge): tall fronts knock people down
    surf.frontH = surfaceHeight(surf, 0, -halfL + 0.35);
    _cache.set(key, surf);
    return surf;
}

/** Top of the car at a point in its own frame (m above its base), or -1 off its footprint. */
export function surfaceHeight(surf, lx, lz) {
    if (Math.abs(lx) > surf.halfW || Math.abs(lz) > surf.halfL) return -1;
    const fc = Math.max(0, Math.min(COLS.length - 1.001, ((lx / surf.halfW + 0.85) / 1.7) * (COLS.length - 1)));
    const fi = Math.max(0, Math.min(surf.n - 1.001, (lz + surf.halfL) / STEP));
    const c0 = Math.floor(fc), i0 = Math.floor(fi);
    const tc = fc - c0, ti = fi - i0;
    const H = surf.heights;
    const a = H[c0][i0] * (1 - ti) + H[c0][i0 + 1] * ti;
    const b = H[c0 + 1][i0] * (1 - ti) + H[c0 + 1][i0 + 1] * ti;
    return a * (1 - tc) + b * tc;
}

/** World (x, z) -> car frame. */
export function toCarFrame(vehicle, x, z, out) {
    const yaw = vehicle.yaw || 0, c = Math.cos(yaw), s = Math.sin(yaw);
    const dx = x - vehicle.position.x, dz = z - vehicle.position.z;
    out.lx = dx * c - dz * s;
    out.lz = dx * s + dz * c;
    return out;
}

/** Signed speed along the car's heading (m/s). */
export function carSpeed(vehicle) {
    return typeof vehicle.getSpeed === 'function' ? vehicle.getSpeed() : (vehicle.speed || 0);
}

/** Axles of a car in its own frame (lz) and the wheels' distance from the centre line. */
export function carAxles(vehicle) {
    const w = vehicle.model && vehicle.model.wheels;
    const halfL = (vehicle.length || 4.5) / 2;
    return w
        ? { front: w.front, rear: w.rear, track: w.track || 0.8 }
        : { front: -halfL * 0.6, rear: halfL * 0.6, track: (vehicle.width || 1.9) * 0.4 };
}
