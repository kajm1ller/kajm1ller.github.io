/**
 * js/game/parkedCars.js
 *
 * Cars parked in the lots and stalls baked into cityNav.json, and cars queued in drive-throughs.
 *
 * How full a lot is depends on its district and the time of day (districts.js `parked`): the
 * downtown parking lots are nearly empty in the afternoon and packed at night. Each stall has its
 * own fixed threshold, so as a lot fills up the same stalls fill in the same order, and stalls
 * only change while the player can't see them.
 *
 * The cars are ordinary Vehicles added to the shared traffic vehicle list (the instanced traffic
 * fleet draws them, and collisions, bullets, run-overs and boarding all see them). Parked cars are
 * empty with the engine off; drive-through cars have a driver. Once the player takes, wrecks or
 * shoves a car it is let go and stays in the world as an ordinary abandoned car.
 */

import { Vehicle } from './vehicle.js';
import { pickCarModel, pickCarColor } from './carModels.js';
import { districtAt, districtProfile } from './districts.js';

export const PARKED_CONFIG = Object.freeze({
    RADIUS: 150,
    POOL: 64,
    LOW_SPEC_POOL: 28,
    CHECK_INTERVAL: 0.5,
    HIDDEN_DIST: 110,          // closer than this, cars only appear / vanish outside the camera view
    TELEPORT_DIST: 120,
    DRIVE_THRU_RADIUS: 220,
    DRIVE_THRU_GAP: 6.4,
    DRIVE_THRU_CREEP: 2.2,     // m/s moving up the line
    DRIVE_THRU_SERVE_MIN: 14,  // seconds at the window
    DRIVE_THRU_SERVE_MAX: 30
});

function hash01(n) {
    let h = (n | 0) ^ 0x9e3779b9;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const carYaw = (fx, fz) => Math.atan2(-fx, -fz);

export class ParkedCars {
    /**
     * @param {Object} o
     * @param {import('./cityNav.js').CityNav} o.nav
     * @param {Array} o.list Shared vehicle list (the traffic fleet's) the cars are added to
     * @param {boolean} [o.lowSpec]
     */
    constructor({ nav, list, lowSpec = false }) {
        this.nav = nav;
        this.list = list;
        this.poolSize = lowSpec === 'lowest' ? 10 : lowSpec ? PARKED_CONFIG.LOW_SPEC_POOL : PARKED_CONFIG.POOL;
        this.free = [];
        this.created = 0;
        this.active = new Map();      // stall -> vehicle
        this.released = 0;
        this._releasedCars = [];
        this._timer = 0;
        this._lastCenter = null;
        this._cand = [];
        this._near = [];
        this._want = new Set();
        this._stallDistrict = nav ? new Int16Array(nav.stallCount).fill(-1) : null;
        this._districtList = [];
        this._districtIndex = new Map();
        // districtStreaming.js: only the player's district has cars in its lots (set by the game)
        this.streamer = null;
        // netWorld.js: the parked cars are another game's to place; ours go away until we own the region again
        this.replicaMode = false;

        // Drive-through lanes: cumulative lengths for walking along them
        this.lanes = nav ? nav.driveThrus.map((pts, id) => {
            const n = pts.length / 2;
            const cum = new Float32Array(n);
            for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
            return {
                id, pts, cum, len: cum[n - 1],
                cx: pts[Math.floor(n / 2) * 2], cz: pts[Math.floor(n / 2) * 2 + 1],
                cars: [], timer: 0, leaving: null
            };
        }) : [];
    }

    // ---------------------------------------------------------------------------------------------
    _district(stall) {
        let k = this._stallDistrict[stall];
        if (k < 0) {
            const d = districtAt(this.nav.stallX[stall], this.nav.stallZ[stall]);
            k = this._districtIndex.get(d);
            if (k === undefined) {
                k = this._districtList.length;
                this._districtList.push(d);
                this._districtIndex.set(d, k);
            }
            this._stallDistrict[stall] = k;
        }
        return k;
    }

    _hidden(x, z, ctx) {
        const dx = x - ctx.center.x, dz = z - ctx.center.z;
        const d = Math.hypot(dx, dz);
        if (d > PARKED_CONFIG.HIDDEN_DIST) return true;
        const v = ctx.viewDir;
        if (!v || d < 1) return false;
        return (dx * v.x + dz * v.z) / d < 0.3;
    }

    _takeVehicle(seed) {
        let v = this.free.pop();
        if (!v) {
            if (this.created >= this.poolSize + 8) return null;
            const i = this.created++;
            const modelId = pickCarModel(hash01(seed * 31 + 7));
            v = new Vehicle(`parked_${i}`, 0, 0, 0, pickCarColor(modelId, hash01(seed * 17 + 3)), false, modelId);
        }
        v.speed = 0;
        v.steerAngle = 0;
        v.velocity.set(0, 0);
        v.engineOn = false;
        v.driverDead = false;
        v.isPlayer = false;
        v._walkerTarget = null;
        return v;
    }

    _show(v, x, z, yaw) {
        v.position.set(x, 0, z);
        v.yaw = yaw;
        v._homeX = x;
        v._homeZ = z;
        if (this.list.indexOf(v) < 0) this.list.push(v);
    }

    _hide(v) {
        const i = this.list.indexOf(v);
        if (i >= 0) this.list.splice(i, 1);
        this.free.push(v);
    }

    /** The player (or a crash) has got involved with this car: it stops being ours. */
    _tampered(v) {
        return v.isPlayer || v.driverDead || v.burnt || v.hasWindowBlood || (v.mesh && v.mesh.parent) ||
            Math.abs(v.position.x - v._homeX) > 1.2 || Math.abs(v.position.z - v._homeZ) > 1.2;
    }

    _release(v) {
        // Leaves the pool for good and stays in the world where it is
        v.isParked = false;
        v._parkedStall = undefined;
        this.released++;
        this._releasedCars.push(v);
    }

    /** Cars taken out of the lots that were left far behind are cleared away. */
    _forgetAbandoned(c) {
        for (let i = this._releasedCars.length - 1; i >= 0; i--) {
            const v = this._releasedCars[i];
            if (v.isPlayer || (v.mesh && v.mesh.parent)) continue;
            if (Math.hypot(v.position.x - c.x, v.position.z - c.z) < 450) continue;
            const j = this.list.indexOf(v);
            if (j >= 0) this.list.splice(j, 1);
            this._releasedCars.splice(i, 1);
        }
    }

    // ---------------------------------------------------------------------------------------------
    /**
     * @param {number} dt
     * @param {Object} ctx { center: {x, z}, viewDir: {x, z}, night: 0..1 }
     */
    setReplicaMode(on) {
        on = !!on;
        if (on === this.replicaMode) return;
        this.replicaMode = on;
        for (const [stall, v] of this.active) { this.active.delete(stall); this._hide(v); }
        for (const lane of this.lanes) {
            for (const car of lane.cars) this._hide(car.v);
            lane.cars.length = 0;
            if (lane.leaving) this._hide(lane.leaving.v);
            lane.leaving = null;
        }
        this._lastCenter = null;
        this._timer = 0;
    }

    update(dt, ctx) {
        if (!this.nav || this.replicaMode) return;
        this._updateDriveThrus(dt, ctx);
        this._timer -= dt;
        if (this._timer > 0) return;
        this._timer = PARKED_CONFIG.CHECK_INTERVAL;

        const c = ctx.center;
        const initial = !this._lastCenter || Math.hypot(c.x - this._lastCenter.x, c.z - this._lastCenter.z) > PARKED_CONFIG.TELEPORT_DIST;
        this._lastCenter = { x: c.x, z: c.z };
        const nav = this.nav;

        // Let go of cars the player has taken or knocked out of their stall
        for (const [stall, v] of this.active) {
            if (this._tampered(v)) {
                this.active.delete(stall);
                this._release(v);
            }
        }
        this._forgetAbandoned(c);
        this._ctx = ctx;

        // Which stalls should have a car right now: the nearest ones the district wants filled
        const fill = this._districtList.map((d) => districtProfile(d, ctx.night).parked);
        const near = nav.stallsNear(c.x, c.z, PARKED_CONFIG.RADIUS, this._near);
        const cand = this._cand;
        cand.length = 0;
        for (let i = 0; i < near.length; i++) {
            const s = near[i];
            if (this.streamer && !this.streamer.contains(nav.stallX[s], nav.stallZ[s])) continue;
            const k = this._district(s);
            if (fill.length <= k) fill.push(districtProfile(this._districtList[k], ctx.night).parked);
            if (hash01(s * 2654435761) < fill[k]) cand.push(s);
        }
        cand.sort((a, b) => Math.hypot(nav.stallX[a] - c.x, nav.stallZ[a] - c.z) - Math.hypot(nav.stallX[b] - c.x, nav.stallZ[b] - c.z));
        const want = this._want;
        want.clear();
        for (let i = 0; i < cand.length && i < this.poolSize; i++) want.add(cand[i]);

        // Park away cars that aren't wanted any more (out of sight)
        for (const [stall, v] of this.active) {
            if (want.has(stall)) continue;
            if (!initial && !this._hidden(nav.stallX[stall], nav.stallZ[stall], ctx)) continue;
            this.active.delete(stall);
            this._hide(v);
        }
        // Fill wanted stalls (out of sight, unless the player just arrived)
        let budget = initial ? 999 : 6;
        for (const stall of want) {
            if (budget <= 0) break;
            if (this.active.has(stall)) continue;
            const x = nav.stallX[stall], z = nav.stallZ[stall];
            if (!initial && !this._hidden(x, z, ctx)) continue;
            if (this._blocked(x, z)) continue;
            const v = this._takeVehicle(stall);
            if (!v) break;
            v.isParked = true;
            v.driverGone = true;
            v._parkedStall = stall;
            this._show(v, x, z, nav.stallYaw[stall]);
            this.active.set(stall, v);
            budget--;
        }
    }

    /** Something else (an abandoned car, the player or their car) is already in the stall. */
    _blocked(x, z) {
        const near = (p) => p && Math.abs(p.x - x) < 3 && Math.abs(p.z - z) < 3;
        for (let i = 0; i < this.list.length; i++) {
            const o = this.list[i];
            if (!o.isParked && near(o.position)) return true;
        }
        const ctx = this._ctx;
        if (!ctx) return false;
        if (near(ctx.center) || (ctx.playerCar && near(ctx.playerCar.position))) return true;
        const others = ctx.others;
        if (others) for (let i = 0; i < others.length; i++) if (near(others[i].position)) return true;
        return false;
    }

    // ---- Drive-throughs ----------------------------------------------------------------------------
    _lanePoint(lane, s, out) {
        const { pts, cum } = lane;
        const n = cum.length;
        s = Math.max(0, Math.min(lane.len, s));
        let i = 1;
        while (i < n - 1 && cum[i] < s) i++;
        const seg = cum[i] - cum[i - 1] || 1;
        const t = (s - cum[i - 1]) / seg;
        const ax = pts[i * 2 - 2], az = pts[i * 2 - 1], bx = pts[i * 2], bz = pts[i * 2 + 1];
        out.x = ax + (bx - ax) * t;
        out.z = az + (bz - az) * t;
        out.yaw = carYaw(bx - ax, bz - az);
        return out;
    }

    _placeOnLane(lane, car) {
        const p = this._lanePoint(lane, car.s, _pt);
        const v = car.v;
        const moved = Math.hypot(p.x - v.position.x, p.z - v.position.z);
        v.wheelRoll = (v.wheelRoll || 0) + moved / 0.32;
        v.position.set(p.x, 0, p.z);
        v.yaw = p.yaw;
        v._homeX = p.x;
        v._homeZ = p.z;
    }

    _updateDriveThrus(dt, ctx) {
        const c = ctx.center;
        const R = PARKED_CONFIG.DRIVE_THRU_RADIUS;
        for (const lane of this.lanes) {
            const inRange = Math.abs(lane.cx - c.x) < R && Math.abs(lane.cz - c.z) < R &&
                (!this.streamer || this.streamer.contains(lane.cx, lane.cz));
            if (!inRange && lane.cars.length === 0 && !lane.leaving) continue;
            const prof = districtProfile(districtAt(lane.cx, lane.cz), ctx.night);

            // Cars the player messed with leave the queue
            for (let i = lane.cars.length - 1; i >= 0; i--) {
                const car = lane.cars[i];
                if (this._tampered(car.v) || car.v.driverGone) {
                    lane.cars.splice(i, 1);
                    this._release(car.v);
                }
            }
            if (lane.leaving && (this._tampered(lane.leaving.v) || lane.leaving.v.driverGone)) {
                this._release(lane.leaving.v);
                lane.leaving = null;
            }

            if (!inRange) {
                for (const car of lane.cars) this._hide(car.v);
                lane.cars.length = 0;
                if (lane.leaving) this._hide(lane.leaving.v);
                lane.leaving = null;
                continue;
            }

            const gap = PARKED_CONFIG.DRIVE_THRU_GAP;
            const windowS = lane.len - 3;
            const slots = Math.max(0, Math.min(5, Math.floor((lane.len - 3) / gap)));
            const wanted = prof.driveThru > 0 ? Math.min(slots, Math.round((1.5 + hash01(lane.id * 97 + Math.floor(Date.now() / 120000)) * 3) * prof.driveThru)) : 0;

            // Serve the car at the window, then it pulls away
            const front = lane.cars[0];
            if (front && Math.abs(front.s - windowS) < 0.05) {
                lane.timer -= dt;
                if (lane.timer <= 0 && !lane.leaving) {
                    lane.leaving = lane.cars.shift();
                    lane.timer = PARKED_CONFIG.DRIVE_THRU_SERVE_MIN + Math.random() * (PARKED_CONFIG.DRIVE_THRU_SERVE_MAX - PARKED_CONFIG.DRIVE_THRU_SERVE_MIN);
                }
            }
            if (lane.leaving) {
                const car = lane.leaving;
                car.s = Math.min(lane.len, car.s + 3.5 * dt);
                this._placeOnLane(lane, car);
                // Gone once it has reached the exit and nobody is watching
                if (car.s >= lane.len && this._hidden(car.v.position.x, car.v.position.z, ctx)) {
                    this._hide(car.v);
                    lane.leaving = null;
                }
            }
            // Everyone else moves up
            for (let i = 0; i < lane.cars.length; i++) {
                const car = lane.cars[i];
                const target = windowS - i * gap;
                if (car.s < target) {
                    car.s = Math.min(target, car.s + PARKED_CONFIG.DRIVE_THRU_CREEP * dt);
                    this._placeOnLane(lane, car);
                }
            }
            // Someone new joins at the back (out of sight)
            if (lane.cars.length < wanted) {
                const s = Math.max(0, windowS - lane.cars.length * gap);
                const p = this._lanePoint(lane, s, _pt);
                if (!this._lastCenter || this._hidden(p.x, p.z, ctx)) {
                    const v = this._takeVehicle(lane.id * 131 + lane.cars.length + ((Date.now() / 1000) | 0));
                    if (v) {
                        v.isParked = true;
                        v.driverGone = false;
                        v.engineOn = true;
                        const car = { v, s };
                        lane.cars.push(car);
                        this.list.push(v);
                        this._placeOnLane(lane, car);
                        if (lane.cars.length === 1) lane.timer = 4 + Math.random() * 10;
                    }
                }
            }
        }
    }

    getStats() {
        let queued = 0;
        for (const l of this.lanes) queued += l.cars.length + (l.leaving ? 1 : 0);
        return { parked: this.active.size, driveThru: queued, pool: this.created, released: this.released };
    }
}

const _pt = { x: 0, z: 0, yaw: 0 };
