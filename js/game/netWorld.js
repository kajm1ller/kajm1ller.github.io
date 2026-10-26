/**
 * js/game/netWorld.js
 *
 * The shared world of multiplayer (server side: multiplayerServer.js). The map is cut into regions;
 * the first player to join a region owns it. The owner's game simulates the people, scene props,
 * dogs, traffic, parked and drive-through cars there as usual and, ~10 times a second, sends what
 * is within reach of anyone in the region (NetOwner). Everybody else in the region switches those
 * systems to replica mode and shows what the owner sends (NetReplica): people with their poses,
 * props and dogs, cars at their speed and steering. Deaths, impacts and cash are events (`rel`)
 * so they play out on every screen, and acting on a replica (shooting a person, hitting a car)
 * sends a command (`cmd`) to the owner, whose simulation answers it for everyone.
 *
 * A player's police are their own business: each game sends its cruisers and officers to the
 * players near it (NetCops) and the others draw them as ghosts.
 *
 * Wire format: JSON with positions in 5 cm steps, angles in 0.01 rad, deltas against what was
 * last sent (a full keyframe every KEYFRAME_SECONDS and whenever a peer asks with `need`).
 */

import * as THREE from 'three';
import { Vehicle } from './vehicle.js';
import { makeProp, makeDog } from './pedestrianScenes.js';
import { lerpAngle } from './camera.js';

export const NET_CONFIG = Object.freeze({
    SEND_INTERVAL: 0.1,
    KEYFRAME_SECONDS: 3,
    PED_RANGE: 300,
    CAR_RANGE: 380,
    EXTRA_RANGE: 260,
    MAX_REPLICA_CARS: 140,
    TELEPORT: 14,
    COP_INTERVAL: 0.15
});

export const PED_STATES = ['walking', 'idle', 'waiting_to_cross', 'crossing', 'sitting', 'hanging_out', 'activity', 'following',
    'fleeing', 'fighting', 'talking', 'dying', 'ragdoll', 'dead', 'carjacked', 'cuffed'];
const STATE_CODE = new Map(PED_STATES.map((s, i) => [s, i]));

// ped.ai flags carried over the wire
export const F = Object.freeze({
    PHONE: 1, DRUNK: 2, OLD: 4, CUFFED: 8, BAGS: 16, FLASH: 32, SPEAKING: 64, STUDY: 128, DEAD: 256, WRITE: 512,
    SNORE: 1024, CARRY: 2048, PUNCH: 4096
});

const q20 = (v) => Math.round(v * 20);
const q100 = (v) => Math.round(v * 100);
const q1000 = (v) => Math.round(v * 1000);
const colorOf = (c) => (c && c.getHex ? c.getHex() : (c | 0));

// ================================================================================================
// OWNER: describes the world it simulates
// ================================================================================================
export class NetOwner {
    /**
     * @param {Object} o
     * @param {import('./pedestrians.js').PedestrianSystem} o.peds
     * @param {Array<Vehicle>} o.cars every car the owner simulates (traffic, parked, drive-through)
     * @param {() => Array<{x:number,z:number}>} o.focus where people in the region are
     */
    constructor({ peds, cars, focus, skip = null }) {
        this.peds = peds;
        this.cars = cars;
        this.focus = focus;
        this.skip = skip;                  // (vehicle) => true for cars that must not be sent (the one a player is driving)
        this.seq = 0;
        this.sentKey = { p: new Map(), c: new Map(), e: new Map(), d: new Map() };
        this.known = { pn: new Set(), cn: new Set(), en: new Set() };
        this.nextCarId = 1;
        this.nextExtraId = 1;
        this._lastFull = -1e9;
        this._wantFull = true;
        this._timer = 0;
        this._pedByNet = new Map();
    }

    /** A peer joined the region (or asked): the next snapshot is complete. */
    requestFull() {
        this._wantFull = true;
    }

    _near(list, x, z, r) {
        for (let i = 0; i < list.length; i++) {
            const f = list[i];
            if ((f.x - x) * (f.x - x) + (f.z - z) * (f.z - z) <= r * r) return true;
        }
        return false;
    }

    /**
     * @param {number} dt
     * @param {number} now seconds
     * @returns {Object|null} a `world` message when one is due
     */
    update(dt, now, region, ownerId) {
        this._timer -= dt;
        if (this._timer > 0) return null;
        this._timer = NET_CONFIG.SEND_INTERVAL;
        return this.snapshot(now, region, ownerId);
    }

    snapshot(now, region, ownerId) {
        const full = this._wantFull || now - this._lastFull > NET_CONFIG.KEYFRAME_SECONDS;
        if (full) {
            this._wantFull = false;
            this._lastFull = now;
            for (const k of Object.keys(this.sentKey)) this.sentKey[k].clear();
            for (const k of Object.keys(this.known)) this.known[k].clear();
        }
        const focus = this.focus();
        const msg = { type: 'world', region, owner: ownerId, seq: ++this.seq, full };
        const seenP = new Set(), seenC = new Set(), seenE = new Set(), seenD = new Set();
        const p = [], pn = [], c = [], cn = [], e = [], en = [], d = [];

        // ---- People ----
        const list = this.peds.pedestrians;
        for (let i = 0; i < list.length; i++) {
            const ped = list[i];
            if (ped.isPoliceOfficer || ped.net || !ped.mesh || !ped.ai) continue;
            const pos = ped.mesh.position;
            if (!this._near(focus, pos.x, pos.z, NET_CONFIG.PED_RANGE)) continue;
            const id = ped.index;
            seenP.add(id);
            if (!this.known.pn.has(id)) {
                this.known.pn.add(id);
                pn.push([id, ped.style || 'adult', ped.lookSeed | 0]);
            }
            const ai = ped.ai;
            let flags = 0;
            if (ai.phone) flags |= F.PHONE;
            if (ai.drunk > 0) flags |= F.DRUNK;
            if (ai.old) flags |= F.OLD;
            if (ai.cuffed) flags |= F.CUFFED;
            if (ai.bags) flags |= F.BAGS;
            if (ai.flashlight) flags |= F.FLASH;
            if (ai.speaking) flags |= F.SPEAKING;
            if (ai.study) flags |= F.STUDY;
            if (ped.isDead) flags |= F.DEAD;
            if (ai.act && ai.act.write) flags |= F.WRITE;
            if (ai.act && ai.act.snore) flags |= F.SNORE;
            if (ai.carry) flags |= F.CARRY;
            if (ai.punching > 0) flags |= F.PUNCH;
            const rig = ped.mesh.userData.rig;
            let props = 0;
            if (rig && rig.props) {
                const pr = [];
                for (const slot of ['R', 'L', 'T']) {
                    const b = rig.props[slot];
                    if (b) pr.push(slot, b.part, colorOf(b.color));
                }
                if (pr.length) props = pr;
            }
            const down = ped.state === 'dying' || ped.state === 'ragdoll' || ped.isDead;
            let extra = 0;
            if (down) {
                const qt = ped.mesh.quaternion;
                extra = [q1000(qt.x), q1000(qt.y), q1000(qt.z), q1000(qt.w), q100(pos.y)];
            }
            const rec = [id, q20(pos.x), q20(pos.z), q100(ai.yaw || 0), STATE_CODE.get(ped.state) ?? 0, ai.pose || 'stand',
                q20(ai.moveSpeed || 0), flags, ai.seat >= 0 ? ai.seat : -1, props, extra];
            const key = rec.join(',') + (props ? JSON.stringify(props) : '') + (extra ? extra.join(',') : '');
            if (this.sentKey.p.get(id) !== key) {
                this.sentKey.p.set(id, key);
                p.push(rec);
            }
        }
        const rmP = [];
        for (const id of this.sentKey.p.keys()) if (!seenP.has(id)) { rmP.push(id); this.sentKey.p.delete(id); this.known.pn.delete(id); }

        // ---- Cars ----
        const cars = this.cars;
        for (let i = 0; i < cars.length; i++) {
            const v = cars[i];
            if (!v || v.isReplica || (this.skip ? this.skip(v) : (v.isPlayer || (v.mesh && v.mesh.parent)))) continue;
            if (!this._near(focus, v.position.x, v.position.z, NET_CONFIG.CAR_RANGE)) continue;
            if (v.netId === undefined) v.netId = this.nextCarId++;
            const id = v.netId;
            seenC.add(id);
            if (!this.known.cn.has(id)) {
                this.known.cn.add(id);
                cn.push([id, v.modelId, v.color | 0, String(v.id)]);
            }
            let flags = 0;
            if (v.driverDead) flags |= 1;
            if (v.driverGone || v.isParked) flags |= 2;
            if (v.engineOn) flags |= 4;
            if (v.burnt || v.wrecked) flags |= 8;
            if (v.hasWindowBlood) flags |= 16;
            const rec = [id, q20(v.position.x), q20(v.position.z), q100(v.yaw), q20(v.speed || 0), q100(v.steerAngle || 0), flags, q100(v.position.y || 0)];
            const key = rec.join(',');
            if (this.sentKey.c.get(id) !== key) {
                this.sentKey.c.set(id, key);
                c.push(rec);
            }
        }
        const rmC = [];
        for (const id of this.sentKey.c.keys()) if (!seenC.has(id)) { rmC.push(id); this.sentKey.c.delete(id); this.known.cn.delete(id); }

        // ---- Props, puddles, leashes (scenes.extras) and dogs ----
        const scenes = this.peds.scenes;
        const extras = scenes.extras;
        for (let i = 0; i < extras.length; i++) {
            const ex = extras[i];
            const m = ex.mesh;
            if (!m) continue;
            const spec = m.userData.spec;
            if (!spec && !ex.owner) continue;
            if (ex.owner) {
                // A dog (owner = the walker): drawn by index of its owner
                const oid = ex.owner.index;
                seenD.add(oid);
                const dead = ex.owner.isDead || ex.owner.state === 'ragdoll' || ex.owner.state === 'dying';
                const rec = [oid, q20(m.position.x), q20(m.position.z), q100(ex.yaw || 0), q20(ex.speed || 0), dead ? 1 : 0, ex.seed || 0];
                const key = rec.join(',');
                if (this.sentKey.d.get(oid) !== key) { this.sentKey.d.set(oid, key); d.push(rec); }
                continue;
            }
            if (!this._near(focus, m.position.x, m.position.z, NET_CONFIG.EXTRA_RANGE)) continue;
            if (m.userData.netId === undefined) m.userData.netId = this.nextExtraId++;
            const id = m.userData.netId;
            seenE.add(id);
            if (!this.known.en.has(id)) {
                this.known.en.add(id);
                en.push([id, spec]);
            }
            const rec = [id, q20(m.position.x), q100(m.position.y), q20(m.position.z), q100(m.rotation.y), q100(m.rotation.x), q100(m.rotation.z), q100(m.scale.z)];
            const key = rec.join(',');
            if (this.sentKey.e.get(id) !== key) { this.sentKey.e.set(id, key); e.push(rec); }
        }
        const rmE = [];
        for (const id of this.sentKey.e.keys()) if (!seenE.has(id)) { rmE.push(id); this.sentKey.e.delete(id); this.known.en.delete(id); }
        const rmD = [];
        for (const id of this.sentKey.d.keys()) if (!seenD.has(id)) { rmD.push(id); this.sentKey.d.delete(id); }

        if (pn.length) msg.pn = pn;
        if (p.length) msg.p = p;
        if (rmP.length) msg.xp = rmP;
        if (cn.length) msg.cn = cn;
        if (c.length) msg.c = c;
        if (rmC.length) msg.xc = rmC;
        if (en.length) msg.en = en;
        if (e.length) msg.e = e;
        if (rmE.length) msg.xe = rmE;
        if (d.length) msg.d = d;
        if (rmD.length) msg.xd = rmD;
        const empty = !(pn.length || p.length || rmP.length || cn.length || c.length || rmC.length || en.length || e.length || rmE.length || d.length || rmD.length);
        if (empty && !full) return null;
        return msg;
    }
}

// ================================================================================================
// REPLICA: draws what the owner sends
// ================================================================================================
export class NetReplica {
    /**
     * @param {Object} o
     * @param {import('./pedestrians.js').PedestrianSystem} o.peds
     * @param {import('./traffic.js').TrafficManager} o.traffic
     * @param {THREE.Scene} o.scene
     * @param {(msg:Object)=>void} [o.requestFull] asks the owner for a full snapshot
     */
    constructor({ peds, traffic, scene, requestFull }) {
        this.peds = peds;
        this.traffic = traffic;
        this.scene = scene;
        this.requestFull = requestFull || (() => {});
        this.owner = null;
        this.pedMap = new Map();      // net id -> ped
        this.carMap = new Map();      // net id -> { v, tx, tz, tyaw, ... }
        this.extraMap = new Map();    // net id -> { mesh, entry }
        this.dogMap = new Map();      // owner net id -> dog
        this.infoP = new Map();
        this.infoC = new Map();
        this.infoE = new Map();
        this.pool = new Map();        // model -> idle replica vehicles
        this.lastSeq = 0;
        this.active = false;
        this.stats = { messages: 0, bytes: 0, peds: 0, cars: 0, extras: 0 };
        this.extrasList = peds.replicaExtras || (peds.replicaExtras = []);
    }

    /** Starts (or restarts) following `ownerId`: whatever was drawn for the previous owner goes. */
    follow(ownerId) {
        this.clear();
        this.owner = ownerId;
        this.active = true;
        this.lastSeq = 0;
        this.peds.setReplicaMode(true);
        this.traffic.setReplicaMode(true);
        this.requestFull();
    }

    stop() {
        this.clear();
        this.owner = null;
        this.active = false;
        this.peds.setReplicaMode(false);
        this.traffic.setReplicaMode(false);
    }

    clear() {
        for (const ped of this.pedMap.values()) this.peds.removeReplicaPed(ped);
        this.pedMap.clear();
        for (const r of this.carMap.values()) this._releaseCar(r);
        this.carMap.clear();
        for (const x of this.extraMap.values()) this._dropExtra(x);
        this.extraMap.clear();
        for (const dog of this.dogMap.values()) this._dropDog(dog);
        this.dogMap.clear();
        this.infoP.clear(); this.infoC.clear(); this.infoE.clear();
    }

    // ---- Snapshots ----
    apply(msg) {
        if (!this.active || msg.owner !== this.owner) return false;
        if (msg.full) {
            // A keyframe: whatever it doesn't list is gone
            this._fullP = new Set(); this._fullC = new Set(); this._fullE = new Set(); this._fullD = new Set();
        } else {
            this._fullP = this._fullC = this._fullE = this._fullD = null;
        }
        this.stats.messages++;
        if (msg.pn) for (const r of msg.pn) this.infoP.set(r[0], { style: r[1], seed: r[2] });
        if (msg.cn) for (const r of msg.cn) this.infoC.set(r[0], { model: r[1], color: r[2], key: r[3] });
        if (msg.en) for (const r of msg.en) this.infoE.set(r[0], r[1]);
        let missing = false;
        if (msg.p) for (const r of msg.p) if (!this._applyPed(r)) missing = true;
        if (msg.c) for (const r of msg.c) if (!this._applyCar(r)) missing = true;
        if (msg.e) for (const r of msg.e) if (!this._applyExtra(r)) missing = true;
        if (msg.d) for (const r of msg.d) this._applyDog(r);
        if (msg.xp) for (const id of msg.xp) this._removePed(id);
        if (msg.xc) for (const id of msg.xc) this._removeCar(id);
        if (msg.xe) for (const id of msg.xe) this._removeExtra(id);
        if (msg.xd) for (const id of msg.xd) this._removeDog(id);
        if (msg.full) {
            // Everything we hold that the keyframe did not mention has gone
            for (const id of [...this.pedMap.keys()]) if (!this._fullP.has(id)) this._removePed(id);
            for (const id of [...this.carMap.keys()]) if (!this._fullC.has(id)) this._removeCar(id);
            for (const id of [...this.extraMap.keys()]) if (!this._fullE.has(id)) this._removeExtra(id);
            for (const id of [...this.dogMap.keys()]) if (!this._fullD.has(id)) this._removeDog(id);
        }
        this.stats.peds = this.pedMap.size;
        this.stats.cars = this.carMap.size;
        this.stats.extras = this.extraMap.size;
        if (missing) this.requestFull();
        return true;
    }

    _applyPed(r) {
        const id = r[0];
        if (this._fullP) this._fullP.add(id);
        let ped = this.pedMap.get(id);
        if (!ped) {
            const info = this.infoP.get(id);
            if (!info) return false;
            ped = this.peds.makeReplicaPed(id, info.style, info.seed);
            this.pedMap.set(id, ped);
        }
        this.peds.applyReplicaState(ped, {
            x: r[1] / 20, z: r[2] / 20, yaw: r[3] / 100, state: PED_STATES[r[4]] || 'walking', pose: r[5],
            speed: r[6] / 20, flags: r[7], seat: r[8], props: r[9] || null,
            q: r[10] ? { x: r[10][0] / 1000, y: r[10][1] / 1000, z: r[10][2] / 1000, w: r[10][3] / 1000, py: r[10][4] / 100 } : null
        });
        return true;
    }

    _removePed(id) {
        const ped = this.pedMap.get(id);
        if (!ped) return;
        this.pedMap.delete(id);
        this.infoP.delete(id);
        this.peds.removeReplicaPed(ped);
    }

    // ---- Cars ----
    _takeCar(model, color) {
        const idle = this.pool.get(model);
        let v = idle && idle.pop();
        if (!v) {
            v = new Vehicle(`net_${model}_${Math.random().toString(36).slice(2, 7)}`, 0, 0, 0, color, false, model);
            v.isReplica = true;
        }
        v.color = color;
        v.bodyColor = color;
        v.driverDead = false;
        v.driverGone = true;
        v.isParked = false;
        v.speed = 0;
        v.steerAngle = 0;
        v.velocity.set(0, 0);
        return v;
    }

    _releaseCar(r) {
        this.traffic.removeReplicaVehicle(r.v);
        const arr = this.pool.get(r.v.modelId) || [];
        if (arr.length < 12) {
            arr.push(r.v);
            this.pool.set(r.v.modelId, arr);
        }
    }

    _applyCar(r) {
        const id = r[0];
        if (this._fullC) this._fullC.add(id);
        let e = this.carMap.get(id);
        if (!e) {
            const info = this.infoC.get(id);
            if (!info) return false;
            if (this.carMap.size >= NET_CONFIG.MAX_REPLICA_CARS) return true;
            const v = this._takeCar(info.model, info.color);
            v.occKey = info.key;
            v.netRef = id;
            v.position.set(r[1] / 20, r[7] / 100, r[2] / 20);
            v.yaw = r[3] / 100;
            e = { v, tx: 0, tz: 0, ty: 0, tyaw: 0, speed: 0, steer: 0 };
            this.carMap.set(id, e);
            this.traffic.addReplicaVehicle(v);
            e.fresh = true;
        }
        e.tx = r[1] / 20; e.tz = r[2] / 20; e.tyaw = r[3] / 100; e.speed = r[4] / 20; e.steer = r[5] / 100; e.ty = r[7] / 100;
        const flags = r[6];
        e.v.driverDead = !!(flags & 1);
        e.v.isParked = !!(flags & 2);
        e.v.engineOn = !!(flags & 4);
        e.v.burnt = !!(flags & 8);
        e.v.hasWindowBlood = !!(flags & 16);
        if (e.fresh) {
            e.v.position.set(e.tx, e.ty, e.tz);
            e.v.yaw = e.tyaw;
            e.fresh = false;
        }
        return true;
    }

    _removeCar(id) {
        const e = this.carMap.get(id);
        if (!e) return;
        this.carMap.delete(id);
        this.infoC.delete(id);
        this._releaseCar(e);
    }

    /** A replica car became somebody's (a player took it): it leaves the replica set. */
    adoptCar(id) {
        const e = this.carMap.get(id);
        if (!e) return null;
        this.carMap.delete(id);
        this.traffic.removeReplicaVehicle(e.v);
        e.v.isReplica = false;
        return e.v;
    }

    // ---- Props and dogs ----
    _applyExtra(r) {
        const id = r[0];
        if (this._fullE) this._fullE.add(id);
        let x = this.extraMap.get(id);
        if (!x) {
            const spec = this.infoE.get(id);
            if (!spec) return false;
            const entry = makeProp(spec, 0, 0, 0);
            x = { mesh: entry.mesh, entry };
            this.extraMap.set(id, x);
            this.extrasList.push(entry);
        }
        const m = x.mesh;
        m.position.set(r[1] / 20, r[2] / 100, r[3] / 20);
        m.rotation.set(r[5] / 100, r[4] / 100, r[6] / 100);
        m.scale.set(1, 1, r[7] / 100);
        return true;
    }

    _removeExtra(id) {
        const x = this.extraMap.get(id);
        if (!x) return;
        this.extraMap.delete(id);
        this.infoE.delete(id);
        this._dropExtra(x);
    }

    _dropExtra(x) {
        const i = this.extrasList.indexOf(x.entry);
        if (i >= 0) this.extrasList.splice(i, 1);
    }

    _applyDog(r) {
        const oid = r[0];
        if (this._fullD) this._fullD.add(oid);
        let dog = this.dogMap.get(oid);
        if (!dog) {
            dog = makeDog(r[6]);
            dog.owner = { index: oid, isDead: false };
            dog.replica = true;
            this.dogMap.set(oid, dog);
            this.extrasList.push(dog);
        }
        dog.mesh.position.x = r[1] / 20;
        dog.mesh.position.z = r[2] / 20;
        dog.yaw = r[3] / 100;
        dog.mesh.rotation.y = dog.yaw;
        dog.speed = r[4] / 20;
        dog.owner.isDead = !!r[5];
    }

    _removeDog(oid) {
        const dog = this.dogMap.get(oid);
        if (!dog) return;
        this.dogMap.delete(oid);
        this._dropDog(dog);
    }

    _dropDog(dog) {
        const i = this.extrasList.indexOf(dog);
        if (i >= 0) this.extrasList.splice(i, 1);
    }

    /** Per frame: cars glide to where the owner says they are, dogs trot. */
    update(dt) {
        if (!this.active) return;
        const a = 1 - Math.exp(-dt * 12);
        for (const e of this.carMap.values()) {
            const v = e.v;
            const dx = e.tx - v.position.x, dz = e.tz - v.position.z;
            if (dx * dx + dz * dz > NET_CONFIG.TELEPORT * NET_CONFIG.TELEPORT) {
                v.position.set(e.tx, e.ty, e.tz);
                v.yaw = e.tyaw;
            } else {
                v.position.x += dx * a;
                v.position.z += dz * a;
                v.position.y += (e.ty - v.position.y) * a;
                v.yaw = lerpAngle(v.yaw, e.tyaw, a);
            }
            v.speed = e.speed;
            v.steerAngle = e.steer;
            v.velocity.set(-Math.sin(v.yaw) * e.speed, -Math.cos(v.yaw) * e.speed);
            v._syncCollisionCircles();
            v._updateMeshTransform(dt);
        }
        for (const dog of this.dogMap.values()) this.peds.scenes.poseDog(dog, dt, dog.owner.isDead);
    }
}

// ================================================================================================
// POLICE: one player's cruisers and officers, as seen by the others
// ================================================================================================
export class NetCops {
    /** @param {{ policeSystem: Object, peds: Object, scene: THREE.Scene, makeCruiser: Function }} o */
    constructor({ policeSystem, peds, scene, makeCruiser }) {
        this.police = policeSystem;
        this.peds = peds;
        this.scene = scene;
        this.makeCruiser = makeCruiser;
        this.ghosts = new Map();      // `${from}:${id}` -> { kind, obj, tx, tz, tyaw }
        this._timer = 0;
        this._last = '';
    }

    /** Your own police, for the server to relay (null when nothing changed or there are none). */
    snapshot(dt) {
        this._timer -= dt;
        if (this._timer > 0 || !this.police) return null;
        this._timer = NET_CONFIG.COP_INTERVAL;
        const cars = [], offs = [];
        let n = 0;
        for (const c of this.police.policeCars || []) {
            if (!c || (c.mesh && !c.mesh.parent)) continue;
            c._netId = c._netId || ++n + Math.floor(Math.random() * 1e6);
            cars.push([c._netId, q20(c.position.x), q20(c.position.z), q100(c.yaw), q20(c.speed || 0), c.isWrecked || c.wrecked ? 1 : 0]);
        }
        for (const o of this.police.officers || []) {
            if (!o || !o.mesh) continue;
            o._netId = o._netId || ++n + Math.floor(Math.random() * 1e6);
            const p = o.mesh.position;
            offs.push([o._netId, q20(p.x), q20(p.z), q100(o.yaw ?? (o.ai && o.ai.yaw) ?? 0), o.isDead ? 1 : 0, o.state === 'ragdoll' ? 1 : 0]);
        }
        const key = JSON.stringify([cars, offs]);
        if (!cars.length && !offs.length && this._last === '[[],[]]') return null;
        this._last = key;
        return { type: 'cops', cars, offs, siren: this.police.isSirenActive ? !!this.police.isSirenActive() : false };
    }

    apply(msg) {
        const seen = new Set();
        for (const r of msg.cars || []) {
            const key = `${msg.from}:c${r[0]}`;
            seen.add(key);
            let g = this.ghosts.get(key);
            if (!g) {
                g = { kind: 'car', obj: this.makeCruiser(`ghost_${key}`, r[1] / 20, r[2] / 20, r[3] / 100), tx: 0, tz: 0, tyaw: 0 };
                g.obj.isGhostCop = true;
                this.ghosts.set(key, g);
            }
            g.tx = r[1] / 20; g.tz = r[2] / 20; g.tyaw = r[3] / 100; g.speed = r[4] / 20; g.from = msg.from;
        }
        for (const r of msg.offs || []) {
            const key = `${msg.from}:o${r[0]}`;
            seen.add(key);
            let g = this.ghosts.get(key);
            if (!g) {
                const ped = this.peds.makeReplicaPed(-(r[0] % 1e8) - 1, 'cop', r[0], { police: true });
                ped.isGhostCop = true;
                g = { kind: 'officer', obj: ped, tx: 0, tz: 0, tyaw: 0 };
                this.ghosts.set(key, g);
            }
            g.tx = r[1] / 20; g.tz = r[2] / 20; g.tyaw = r[3] / 100; g.dead = !!r[4]; g.from = msg.from;
            this.peds.applyReplicaState(g.obj, {
                x: g.tx, z: g.tz, yaw: g.tyaw, state: r[4] ? 'dead' : 'walking', pose: r[4] ? 'stand' : 'run', speed: r[4] ? 0 : 3.2, flags: r[4] ? F.DEAD : 0,
                seat: -1, props: null, q: null
            });
        }
        // This sender's units that are no longer listed are gone
        for (const [key, g] of [...this.ghosts]) {
            if (g.from === msg.from && !seen.has(key)) this._drop(key, g);
        }
        this.lastFrom = msg.from;
    }

    /** Someone left: their police go with them. */
    dropFrom(from) {
        for (const [key, g] of [...this.ghosts]) if (g.from === from) this._drop(key, g);
    }

    _drop(key, g) {
        this.ghosts.delete(key);
        if (g.kind === 'car') {
            if (g.obj.getMesh && g.obj.getMesh().parent) g.obj.getMesh().parent.remove(g.obj.getMesh());
        } else this.peds.removeReplicaPed(g.obj);
    }

    update(dt) {
        const a = 1 - Math.exp(-dt * 10);
        for (const g of this.ghosts.values()) {
            if (g.kind !== 'car') continue;
            const v = g.obj;
            const dx = g.tx - v.position.x, dz = g.tz - v.position.z;
            if (dx * dx + dz * dz > 400) v.position.set(g.tx, 0, g.tz);
            else { v.position.x += dx * a; v.position.z += dz * a; }
            v.yaw = lerpAngle(v.yaw, g.tyaw, a);
            v.speed = g.speed || 0;
            v._syncCollisionCircles();
            v._updateMeshTransform(dt);
            if (v.updateStrobes) v.updateStrobes(dt);
        }
    }

    clear() {
        for (const [key, g] of [...this.ghosts]) this._drop(key, g);
    }
}
