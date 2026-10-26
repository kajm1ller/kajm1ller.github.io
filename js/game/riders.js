/**
 * js/game/riders.js
 *
 * People inside cars: the driver and passengers of traffic, other players driving and riding along,
 * and NPCs you have given a lift. Riders are pedestrian rigs (drawn by the pedestrian renderer)
 * sat in the car's seats and moved with it every frame.
 *
 *   seatLocal(modelId, seat)   car-space position of a seat (0 driver, 1 front passenger, 2/3 rear)
 *   npcOccupants(car)          who rides in an NPC-driven car (stable per car, so every player sees the same)
 *   CarRiders                  keeps the set of seated rigs in step with what `sync()` is told
 */

import * as THREE from 'three';
import { cabinShape } from './carModels.js';
import { poseSeated } from './avatarPose.js';

export const CAR_SEATS = 4;
const REAR_OFFSET = 0.95;
const HIP_ABOVE_FLOOR = 0.3;
const SEATED_TOP = 0.92;        // hips to the top of the head of a person of scale 1 (metres)
const HEAD_CLEARANCE = 0.05;    // gap kept under the roof
const LOOKS = ['adult', 'adult', 'student', 'worker', 'older', 'shopper', 'partier'];

const _seatCache = new Map();

/** Seat position in car space (x right, y up, z towards the back; the car faces -z). */
export function seatLocal(modelId, seat) {
    const key = `${modelId}:${seat}`;
    let s = _seatCache.get(key);
    if (!s) {
        const c = cabinShape(modelId);
        const side = (seat & 1) ? 1 : -1;               // driver on the left
        const rear = seat >= 2 && c.rearSeats !== false;
        s = {
            x: side * Math.abs(c.driverX),
            y: c.floor + HIP_ABOVE_FLOOR,
            z: c.seatZ + (seat >= 2 ? REAR_OFFSET * (rear ? 1 : 0.9) : 0)
        };
        _seatCache.set(key, s);
    }
    return s;
}

/** World position of a seat of a car at (position, yaw). */
export function seatWorld(modelId, seat, position, yaw, out = new THREE.Vector3()) {
    const s = seatLocal(modelId, seat);
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    return out.set(position.x + s.x * cos + s.z * sin, (position.y || 0) + s.y, position.z - s.x * sin + s.z * cos);
}

function hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Who sits in an NPC car: [{ seat, seed, style }]. Always a driver; now and then company. Derived from
 * the car's id alone, so everyone sees the same people in it.
 */
export function npcOccupants(car) {
    const id = car.occKey || car.id;
    const h = hash(id);
    const out = [{ seat: 0, seed: h % 100000, style: LOOKS[(h >>> 3) % LOOKS.length] }];
    const r = (h >>> 8) % 10;
    if (r < 2) out.push({ seat: 1, seed: (h >>> 5) % 100000, style: LOOKS[(h >>> 7) % LOOKS.length] });
    if (r === 0) out.push({ seat: 2, seed: (h >>> 9) % 100000, style: LOOKS[(h >>> 11) % LOOKS.length] });
    return out;
}

export class CarRiders {
    /** @param {import('./pedestrians.js').PedestrianSystem} peds */
    constructor(peds) {
        this.peds = peds;
        this.map = new Map();       // key -> entry
        this._v = new THREE.Vector3();
        this.time = 0;
    }

    get count() { return this.map.size; }

    /**
     * Makes the seated rigs match `wanted`: [{ key, car: {position, yaw, modelId}, seat, seed, style, kind, look }].
     * Entries that persist keep their rig (cars may change, e.g. a pooled replica car reassigned).
     */
    sync(wanted) {
        const keep = new Set();
        for (const w of wanted) {
            keep.add(w.key);
            let e = this.map.get(w.key);
            if (!e || e.seed !== w.seed || e.style !== w.style) {
                if (e) this._drop(w.key, e);
                const mesh = this.peds.createPedestrianMesh(w.seed, { style: w.style || 'adult' });
                if (w.shirt !== undefined) {
                    for (const bd of mesh.userData.rig.bindings) if (bd.part === 'torso' || bd.part === 'upperArm') bd.color.setHex(w.shirt);
                }
                e = { mesh, position: mesh.position, seed: w.seed, style: w.style };
                this.peds.extraRigs.push(e);
                this.map.set(w.key, e);
            }
            e.car = w.car;
            e.seat = w.seat;
            e.kind = w.kind || 'ride';
            e.look = w.look || 0;
            e.hidden = !!w.hidden;
        }
        for (const [key, e] of [...this.map]) if (!keep.has(key)) this._drop(key, e);
    }

    _drop(key, e) {
        this.map.delete(key);
        const i = this.peds.extraRigs.indexOf(e);
        if (i >= 0) this.peds.extraRigs.splice(i, 1);
    }

    clear() {
        for (const [key, e] of [...this.map]) this._drop(key, e);
    }

    /** Seats every rider in their car as it is now. */
    update(dt) {
        this.time += dt;
        for (const e of this.map.values()) {
            const car = e.car;
            if (!car || e.hidden) {
                e.mesh.position.set(0, -500, 0);          // out of sight (the renderer still walks every rig)
                continue;
            }
            const model = car.modelId || 'civic';
            const s = seatLocal(model, e.seat);
            seatWorld(model, e.seat, car.position, car.yaw || 0, this._v);
            e.mesh.position.set(this._v.x, (car.position.y || 0), this._v.z);
            e.mesh.rotation.set(0, (car.yaw || 0) + Math.PI, 0);
            const rig = e.mesh.userData.rig;
            if (rig) {
                // Heads stay under the roof: sit lower first, then squash a little if that isn't enough
                if (e.baseScale === undefined) e.baseScale = e.mesh.scale.y || 1;
                const c = cabinShape(model);
                const room = c.roof - HEAD_CLEARANCE;
                let seatH = s.y;
                let k = e.baseScale;
                if (seatH + SEATED_TOP * k + 0.06 > room) {
                    seatH = Math.max(c.floor + 0.12, room - 0.06 - SEATED_TOP * k);
                    const left = room - (seatH + 0.06);
                    if (left < SEATED_TOP * k) k = Math.max(e.baseScale * 0.7, left / SEATED_TOP);
                }
                if (e.mesh.scale.y !== k) e.mesh.scale.y = k;
                poseSeated(rig, seatH, k, e.kind, this.time + e.seed, e.look);
            }
        }
    }
}
