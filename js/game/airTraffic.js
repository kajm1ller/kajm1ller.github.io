/**
 * js/game/airTraffic.js
 *
 * Planes at Wood County Regional Airport (the Airport district), day and night.
 *
 * A few light aircraft sit on the apron. Every so often one starts up, taxis out along taxiway A,
 * holds short, lines up on runway 10 and takes off to the east, climbing away until it's gone;
 * others turn up on a long final from the west, flare, touch down, roll out, turn off at B3 and
 * taxi back to a free spot on the apron. Runway and taxiway coordinates come from the same OSM
 * extract as the map (runway 10/28 runs x -555..715 at z ~ -2500).
 *
 * Two helicopters work from pads beside the apron: they spool up, lift off, fly a loop over town
 * and come back to land (scripted too, see `_heliStep`).
 *
 * The planes are scripted (they follow 3D routes with a speed profile and bank into turns) rather
 * than flown by plane.js's flight model, and use its mesh. A shared propeller drone follows the
 * nearest one.
 */

import * as THREE from 'three';
import { createPlaneMesh } from './plane.js';
import { buildAircraft, AIRCRAFT, HELI_TYPES } from './aircraft.js';

export const AIR_CONFIG = Object.freeze({
    PARKING: [[-641, -1958], [-621, -1958], [-601, -1958], [-581, -1958]],
    MAX_MOVING: 2,
    PARKED_AT_START: 3,
    ARRIVAL_EVERY: [70, 160],    // seconds between arrivals
    DEPARTURE_EVERY: [80, 190],
    TAXI_SPEED: 7,
    HIDE_DISTANCE: 1400,         // planes on the ground (each is ~25 meshes, so far ones aren't drawn)
    HIDE_DISTANCE_AIR: 2200,
    SHADOW_DISTANCE: 250,
    SOUND_RANGE: 450,
    HELI_PADS: [[-520, -1958], [-495, -1958]],
    HELI_EVERY: [60, 150],
    HELI_CRUISE: 42,
    HELI_ALT: 120,
    // loop over town (x, z), flown after climbing out; each helicopter picks one at random
    HELI_ROUTES: [
        [[-1500, -1500], [-2000, 0], [-800, 600], [400, -800]],
        [[-900, -1000], [-300, 400], [900, 200], [1200, -1200]]
    ]
});

// Ground routes (x, z) between the apron and runway 10/28 via taxiway A and B3
const APRON_EXIT = [[-645, -1974], [-648.4, -1990], [-648.5, -2015.3], [-546.5, -2087.3], [-436.7, -2164.2],
    [-172.4, -2349.5], [-162.7, -2367], [-162.2, -2409.5], [-161.8, -2440.9], [-161.6, -2478]];
const RUNWAY_Z = (x) => -2507.1 + (x + 555.3) * (18.5 / 1270.6); // centreline (runway is slightly skewed)

const PLANE_COLORS = [0xf2f2f2, 0xf2f2f2, 0xe8e8e8, 0xc62828, 0x1565c0, 0xf9a825, 0x2e7d32];

const between = (a, b) => a + Math.random() * (b - a);
const angleDiff = (a, b) => {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
};

/** A route leg: points [x, y, z], the cruise speed along it and how hard it may speed up / slow down. */
function leg(points, speed, opts = {}) {
    const cum = [0];
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    return Object.assign({ points, cum, len: cum[cum.length - 1], speed, accel: 2.5, brake: 2.5, endSpeed: speed, wait: 0 }, opts);
}

function ground(xz) {
    return xz.map(([x, z]) => [x, 0, z]);
}

export class AirTraffic {
    constructor(scene) {
        this.scene = scene;
        this.planes = [];
        this.spots = AIR_CONFIG.PARKING.map(() => null);
        this.arrivalT = between(15, 40);
        this.departureT = between(30, 70);
        this._v = new THREE.Vector3();
        this.audio = null;
        this.helis = [];
        this.heliT = between(10, 30);
        for (let i = 0; i < AIR_CONFIG.HELI_PADS.length; i++) this._makeHeli(i);

        // Some planes are already parked
        for (let i = 0; i < AIR_CONFIG.PARKED_AT_START; i++) {
            const p = this._makePlane();
            this._park(p, i);
        }
    }

    _makePlane() {
        const color = PLANE_COLORS[(Math.random() * PLANE_COLORS.length) | 0];
        const { root, propeller } = createPlaneMesh(color, `ai_${this.planes.length}_${(Math.random() * 1e4) | 0}`);
        root.rotation.order = 'YXZ';
        this.scene.add(root);
        const p = {
            mesh: root, propeller, propAngle: 0, rpm: 0,
            position: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, speed: 0,
            legs: [], legIdx: 0, s: 0, wait: 0, spot: -1, state: 'parked', timer: 0,
            isPlane: true, isAirTraffic: true
        };
        this.planes.push(p);
        return p;
    }

    _makeHeli(pad) {
        const type = HELI_TYPES[(Math.random() * HELI_TYPES.length) | 0];
        const colors = AIRCRAFT[type].colors;
        const { root, spinners } = buildAircraft(type, colors[(Math.random() * colors.length) | 0], `ai_${pad}`);
        root.rotation.order = 'YXZ';
        this.scene.add(root);
        const [x, z] = AIR_CONFIG.HELI_PADS[pad];
        const h = {
            mesh: root, spinners, rotorAngle: 0, rpm: 0, pad,
            position: new THREE.Vector3(x, 0, z), vel: new THREE.Vector3(), yaw: Math.PI, pitch: 0, roll: 0,
            state: 'parked', route: [], wp: 0, timer: 0, isHeli: true, isAirTraffic: true
        };
        root.position.copy(h.position);
        root.rotation.y = h.yaw;
        this.helis.push(h);
        return h;
    }

    _heliGo(h) {
        const routes = AIR_CONFIG.HELI_ROUTES;
        h.route = routes[(Math.random() * routes.length) | 0].map(([x, z]) => [x + between(-150, 150), z + between(-150, 150)]);
        h.wp = 0;
        h.state = 'spool';
        h.timer = between(5, 8);
    }

    _heliStep(h, dt) {
        const [px, pz] = AIR_CONFIG.HELI_PADS[h.pad];
        const pos = h.position;
        const want = new THREE.Vector3(); // target velocity
        let rpmWant = 1;
        want.set(0, 0, 0);
        switch (h.state) {
            case 'parked':
                rpmWant = 0;
                break;
            case 'spool':
                rpmWant = 1;
                h.timer -= dt;
                if (h.rpm > 0.95 && h.timer <= 0) h.state = 'lift';
                break;
            case 'lift':
                want.y = 4;
                if (pos.y > AIR_CONFIG.HELI_ALT) h.state = 'cruise';
                break;
            case 'cruise': {
                const r = h.route, tgt = h.wp < r.length ? r[h.wp] : [px, pz];
                const dx = tgt[0] - pos.x, dz = tgt[1] - pos.z, d = Math.hypot(dx, dz) || 1;
                const home = h.wp >= r.length;
                const sp = home ? Math.min(AIR_CONFIG.HELI_CRUISE, 6 + d * 0.08) : AIR_CONFIG.HELI_CRUISE;
                want.set((dx / d) * sp, (AIR_CONFIG.HELI_ALT - pos.y) * 0.3, (dz / d) * sp);
                if (d < (home ? 8 : 120)) {
                    if (home) h.state = 'descend';
                    else h.wp++;
                }
                break;
            }
            case 'descend': {
                const dx = px - pos.x, dz = pz - pos.z;
                want.set(dx * 0.4, -Math.max(0.8, Math.min(5, pos.y * 0.25)), dz * 0.4);
                if (pos.y <= 0.05) {
                    pos.y = 0;
                    h.state = 'cooldown';
                    h.timer = between(6, 10);
                }
                break;
            }
            case 'cooldown':
                want.set(0, 0, 0);
                rpmWant = 0.4;
                h.timer -= dt;
                if (h.timer <= 0) h.state = 'parked';
                break;
        }
        // Can only climb once the rotor is up to speed
        if (h.rpm < 0.9 && want.y > 0) want.y = 0;
        h.vel.lerp(want, Math.min(1, dt * 0.8));
        pos.addScaledVector(h.vel, dt);
        if (pos.y < 0) pos.y = 0;
        h.rpm += (rpmWant - h.rpm) * Math.min(1, dt * (rpmWant > h.rpm ? 0.25 : 0.12));

        const hs = Math.hypot(h.vel.x, h.vel.z);
        const prevYaw = h.yaw;
        if (hs > 3) h.yaw += angleDiff(h.yaw, Math.atan2(-h.vel.x, -h.vel.z)) * Math.min(1, dt * 0.9);
        const yawRate = angleDiff(prevYaw, h.yaw) / Math.max(dt, 1e-4);
        h.pitch += (-Math.min(0.2, hs * 0.005) - h.pitch) * Math.min(1, dt * 1.5); // nose down in forward flight
        const rollWant = Math.max(-0.35, Math.min(0.35, -yawRate * hs * 0.05));
        h.roll += (rollWant - h.roll) * Math.min(1, dt * 1.5);
    }

    _park(p, spot) {
        const [x, z] = AIR_CONFIG.PARKING[spot];
        this.spots[spot] = p;
        p.spot = spot;
        p.state = 'parked';
        p.position.set(x, 0, z);
        p.yaw = Math.PI; // nose south, as they pulled in off the taxi line
        p.pitch = 0;
        p.roll = 0;
        p.speed = 0;
        p.legs = [];
        this._pose(p, 0);
    }

    _remove(p) {
        this.scene.remove(p.mesh);
        const i = this.planes.indexOf(p);
        if (i >= 0) this.planes.splice(i, 1);
        if (p.spot >= 0 && this.spots[p.spot] === p) this.spots[p.spot] = null;
    }

    _moving() {
        let n = 0;
        for (const p of this.planes) if (p.state !== 'parked') n++;
        return n;
    }

    // ---- Departures: apron -> taxiway A -> hold short -> runway 10 -> climb out east ----
    _depart(p) {
        const [x, z] = AIR_CONFIG.PARKING[p.spot];
        this.spots[p.spot] = null;
        p.spot = -1;
        p.state = 'departing';
        // U-turn off the stand onto the taxi line along the north edge of the apron
        const taxi = [[x, z], [x + 4, z + 3], [x + 8, z - 2], [x + 6, z - 9], [x, -1973], [x - 6, -1974.2], ...APRON_EXIT];
        // Run the engine up, taxi, hold short, line up, roll, climb away with a gentle left turn
        p.legs = [
            leg(ground([[x, z], [x, z]]), 0, { wait: between(6, 14) }),
            leg(ground(taxi), AIR_CONFIG.TAXI_SPEED, { endSpeed: 0, accel: 1.2, wait: between(5, 12) }),
            leg(ground([[-161.6, -2478], [-161.2, RUNWAY_Z(-161.2) - 6], [-150, RUNWAY_Z(-150)], [-120, RUNWAY_Z(-120)]]), 3, { endSpeed: 0, accel: 1, wait: 3 }),
            leg([[-120, 0, RUNWAY_Z(-120)], [190, 0, RUNWAY_Z(190)], [520, 22, RUNWAY_Z(520)], [900, 60, RUNWAY_Z(900) - 5],
                [1900, 170, -2600], [3200, 290, -2950], [5200, 420, -3700]], 46, { accel: 1.7, takeoff: true })
        ];
        p.legIdx = 0;
        p.s = 0;
        p.speed = 0;
        p.wait = p.legs[0].wait;
    }

    // ---- Arrivals: long final from the west -> flare -> rollout -> B3 -> apron ----
    _arrive(spot) {
        const p = this._makePlane();
        p.state = 'arriving';
        p.targetSpot = spot;
        this.spots[spot] = p; // reserved
        const [x, z] = AIR_CONFIG.PARKING[spot];
        const zr = RUNWAY_Z;
        const approach = [[-5200, 330, zr(-5200) + 260], [-3400, 205, zr(-3400) + 40], [-1600, 82, zr(-1600)],
            [-700, 14, zr(-700)], [-560, 3.5, zr(-560)], [-470, 0, zr(-470)]];
        const taxiBack = APRON_EXIT.slice().reverse();
        p.legs = [
            leg(approach, 31, { endSpeed: 27, brake: 0.6, landing: true }),
            leg(ground([[-470, zr(-470)], [-190, zr(-190)]]), 27, { endSpeed: 5, brake: 2.4 }),
            leg(ground([[-190, zr(-190)], [-172, zr(-172) - 1], [-162.5, -2490], ...taxiBack, [x - 5, -1974.2], [x, -1968], [x, z]]),
                AIR_CONFIG.TAXI_SPEED, { endSpeed: 0, accel: 1.2, brake: 1.5 })
            // (the stand is south of the taxi line, so the plane pulls in nose first, facing south)
        ];
        p.legIdx = 0;
        p.s = 0;
        p.speed = 31;
        const a = approach[0];
        p.position.set(a[0], a[1], a[2]);
        p.yaw = Math.atan2(-(approach[1][0] - a[0]), -(approach[1][2] - a[2]));
        p.wait = 0;
        p.spot = -1;
    }

    // ---- Per frame ----
    /**
     * @param {{ cameraPos: THREE.Vector3, active?: boolean }} ctx `active` false while the airport
     *   isn't loaded (districtStreaming.js): planes are hidden and the airport waits until you're back
     */
    update(dt, ctx) {
        if (ctx && ctx.active === false) {
            if (!this.asleep) {
                this.asleep = true;
                for (const p of this.planes) p.mesh.visible = false;
                for (const h of this.helis) h.mesh.visible = false;
                if (this.audio) this.audio.gain.gain.setTargetAtTime(0, this.audio.ctx.currentTime, 0.1);
            }
            return;
        }
        this.asleep = false;
        // Traffic schedule
        this.arrivalT -= dt;
        this.departureT -= dt;
        // Taxiway A is a single lane: no departure taxis out while an arrival is inbound or taxiing
        // in, and no arrival is cleared while a departure is still on the ground
        const arriving = this.planes.some((p) => p.state === 'arriving');
        const departingOnGround = this.planes.some((p) => p.state === 'departing' && p.legIdx < 3);
        if (this.arrivalT <= 0) {
            this.arrivalT = between(...AIR_CONFIG.ARRIVAL_EVERY);
            const free = this.spots.findIndex((s) => s === null);
            if (free >= 0 && !arriving && !departingOnGround && this._moving() < AIR_CONFIG.MAX_MOVING) this._arrive(free);
        }
        if (this.departureT <= 0) {
            this.departureT = between(...AIR_CONFIG.DEPARTURE_EVERY);
            const parked = this.planes.filter((p) => p.state === 'parked');
            if (parked.length && !arriving && !departingOnGround && this._moving() < AIR_CONFIG.MAX_MOVING) {
                this._depart(parked[(Math.random() * parked.length) | 0]);
            }
        }

        for (let i = this.planes.length - 1; i >= 0; i--) {
            const p = this.planes[i];
            if (p.state !== 'parked') this._fly(p, dt);
            else p.rpm += (0 - p.rpm) * Math.min(1, dt * 0.8);
            if (p.done) {
                if (p.state === 'departing') {
                    this._remove(p);
                    continue;
                }
                this._park(p, p.targetSpot);
                p.done = false;
            }
            this._pose(p, dt);
            const cam = ctx && ctx.cameraPos;
            const d = cam ? Math.hypot(p.position.x - cam.x, p.position.z - cam.z) : 0;
            p.mesh.visible = d < (p.position.y > 5 ? AIR_CONFIG.HIDE_DISTANCE_AIR : AIR_CONFIG.HIDE_DISTANCE);
            const shadows = d < AIR_CONFIG.SHADOW_DISTANCE;
            if (p.shadows !== shadows) {
                p.shadows = shadows;
                p.mesh.traverse((o) => { if (o.isMesh) o.castShadow = shadows; });
            }
        }
        this._updateHelis(dt, ctx);
        this._updateSound(ctx);
    }

    _updateHelis(dt, ctx) {
        this.heliT -= dt;
        if (this.heliT <= 0) {
            this.heliT = between(...AIR_CONFIG.HELI_EVERY);
            const parked = this.helis.filter((h) => h.state === 'parked');
            if (parked.length) this._heliGo(parked[(Math.random() * parked.length) | 0]);
        }
        const cam = ctx && ctx.cameraPos;
        for (const h of this.helis) {
            this._heliStep(h, dt);
            const m = h.mesh;
            m.position.copy(h.position);
            m.rotation.set(h.pitch, h.yaw, -h.roll);
            h.rotorAngle += h.rpm * dt;
            for (const sp of h.spinners) sp.obj.rotation[sp.axis] = h.rotorAngle * sp.k;
            const d = cam ? Math.hypot(h.position.x - cam.x, h.position.z - cam.z) : 0;
            m.visible = d < (h.position.y > 5 ? AIR_CONFIG.HIDE_DISTANCE_AIR : AIR_CONFIG.HIDE_DISTANCE);
        }
    }

    _fly(p, dt) {
        let L = p.legs[p.legIdx];
        if (!L) {
            p.done = true;
            return;
        }
        if (p.wait > 0) {
            // Holding (engine running)
            p.wait -= dt;
            p.speed = Math.max(0, p.speed - 3 * dt);
            p.rpm += (0.35 - p.rpm) * Math.min(1, dt * 1.5);
            return;
        }
        // Speed: up to the leg's speed, easing down to its end speed in time
        const remaining = L.len - p.s;
        const stopSpeed = Math.sqrt(Math.max(0, L.endSpeed * L.endSpeed + 2 * L.brake * remaining));
        const target = Math.min(L.speed, stopSpeed);
        if (p.speed < target) p.speed = Math.min(target, p.speed + L.accel * dt);
        else p.speed = Math.max(target, p.speed - L.brake * 1.5 * dt);
        if (L.endSpeed === 0 && remaining < 0.3) {
            p.speed = 0;
            p.s = L.len;
        } else {
            p.s += Math.max(p.speed, 0.4) * dt;
        }

        if (p.s >= L.len) {
            p.s -= L.len;
            p.legIdx++;
            const next = p.legs[p.legIdx];
            if (!next) {
                p.done = true;
                return;
            }
            p.wait = next.wait;
            if (L.endSpeed === 0) p.s = 0;
            L = next;
        }

        // Position and heading along the route
        const pts = L.points, cum = L.cum;
        let i = 1;
        while (i < cum.length - 1 && cum[i] < p.s) i++;
        const seg = cum[i] - cum[i - 1] || 1;
        const t = Math.min(1, (p.s - cum[i - 1]) / seg);
        const a = pts[i - 1], b = pts[i];
        const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
        // Look a little ahead so the heading turns smoothly through corners
        const ahead = this._pointAt(L, p.s + Math.max(4, p.speed * 0.8));
        const dx = ahead[0] - x, dz = ahead[2] - z;
        const prevYaw = p.yaw;
        if (dx * dx + dz * dz > 0.01) {
            const want = Math.atan2(-dx, -dz);
            p.yaw += angleDiff(p.yaw, want) * Math.min(1, dt * (p.position.y > 1 ? 1.2 : 2.6));
        }
        const yawRate = angleDiff(prevYaw, p.yaw) / Math.max(dt, 1e-4);
        const climb = Math.atan2(ahead[1] - y, Math.hypot(dx, dz) || 1);
        let pitchWant = y > 0.05 ? climb + 0.05 : 0;
        if (L.landing && y < 6) pitchWant = 0.12; // flare
        if (L.takeoff && y < 0.05 && p.speed > 26) pitchWant = 0.1; // rotate
        p.pitch += (pitchWant - p.pitch) * Math.min(1, dt * 2);
        const rollWant = y > 3 ? Math.max(-0.5, Math.min(0.5, -yawRate * p.speed * 0.08)) : 0;
        p.roll += (rollWant - p.roll) * Math.min(1, dt * 1.5);
        p.position.set(x, y, z);
        const throttle = L.takeoff ? 1 : y > 1 ? 0.55 : p.speed > 8 ? 0.15 : 0.3;
        p.rpm += (throttle - p.rpm) * Math.min(1, dt * 1.2);
    }

    _pointAt(L, s) {
        const pts = L.points, cum = L.cum;
        if (s >= L.len) {
            const a = pts[pts.length - 2], b = pts[pts.length - 1];
            const k = (s - L.len) / (Math.hypot(b[0] - a[0], b[2] - a[2]) || 1);
            return [b[0] + (b[0] - a[0]) * k, b[1], b[2] + (b[2] - a[2]) * k];
        }
        let i = 1;
        while (i < cum.length - 1 && cum[i] < s) i++;
        const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
        const a = pts[i - 1], b = pts[i];
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }

    _pose(p, dt) {
        const m = p.mesh;
        m.position.copy(p.position);
        m.rotation.y = p.yaw;
        m.rotation.x = p.pitch;
        m.rotation.z = -p.roll;
        if (p.propeller) {
            p.propAngle += (2 + p.rpm * 60) * dt;
            p.propeller.rotation.z = p.propAngle;
        }
    }

    // ---- Propeller drone for the nearest moving plane ----
    setAudioContext(ctx) {
        if (this.audio || !ctx) return;
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        const osc2 = ctx.createOscillator();
        osc2.type = 'square';
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 700;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc2.start();
        this.audio = { ctx, osc, osc2, filter, gain };
    }

    _updateSound(ctx) {
        const a = this.audio;
        if (!a || a.ctx.state !== 'running') return;
        const cam = ctx && ctx.cameraPos;
        let best = null, bestD = AIR_CONFIG.SOUND_RANGE;
        if (cam) {
            for (const p of this.planes.concat(this.helis)) {
                if (p.rpm < 0.05) continue;
                const d = p.position.distanceTo(cam);
                if (d < bestD) {
                    bestD = d;
                    best = p;
                }
            }
        }
        const now = a.ctx.currentTime;
        const vol = best ? (0.16 * best.rpm) / (1 + (bestD / 40) ** 2) : 0;
        a.gain.gain.setTargetAtTime(vol, now, 0.2);
        if (best) {
            const f = best.isHeli ? 70 + best.rpm * 30 : 38 + best.rpm * 52;
            a.osc.frequency.setTargetAtTime(f, now, 0.3);
            a.osc2.frequency.setTargetAtTime(f * 2.01, now, 0.3);
            a.filter.frequency.setTargetAtTime(400 + best.rpm * 900, now, 0.3);
        }
    }

    getStats() {
        const out = { parked: 0, departing: 0, arriving: 0, helis: this.helis.length, helisFlying: 0, asleep: !!this.asleep };
        for (const p of this.planes) out[p.state]++;
        for (const h of this.helis) if (h.state !== 'parked' && h.state !== 'cooldown') out.helisFlying++;
        return out;
    }
}
