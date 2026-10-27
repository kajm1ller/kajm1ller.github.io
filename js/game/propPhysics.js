/**
 * js/game/propPhysics.js
 *
 * Loose things lying about (dropped items, cash): each is a rigid box collider that falls, bounces
 * off walls, lands on a corner and tips over, slides to a stop and goes to sleep. The map's surfaces
 * come from `raycast(origin, dir, far)` (impacts.raycastWorld: tiles + the ground plane), upstairs
 * floors from `floorAt(x, z, y)` (bars.js). An object's origin must be the centre of its box.
 */
import * as THREE from 'three';

export const PROP_CONFIG = {
    GRAVITY: 9.8,
    BOUNCE: 0.3,        // restitution on a hard hit (slow contacts don't bounce, so things settle)
    FRICTION: 0.55,
    SLEEP_SPEED: 0.12,
    SLEEP_SPIN: 0.4,
    SLEEP_TIME: 0.4,
    MAX_STEP: 1 / 60
};

const _dir = new THREE.Vector3();
const _o = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p0 = new THREE.Vector3();
const _r = new THREE.Vector3();
const _vc = new THREE.Vector3();
const _rn = new THREE.Vector3();
const _t = new THREE.Vector3();
const _rt = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _corners = Array.from({ length: 8 }, () => new THREE.Vector3());
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

export class PropPhysics {
    constructor(raycast, floorAt = null) {
        this.raycast = raycast;
        this.floorAt = floorAt;
        this.bodies = [];
    }

    /** Sets `object` (already placed) moving. `half` = half extents of its box in its own axes. */
    add(object, half, vel = null, spin = null) {
        const b = {
            object,
            half: half.clone(),
            reach: half.length(),
            invI: 4.5 / Math.max(half.lengthSq(), 1e-4),   // unit mass, a box's mean moment of inertia
            vel: vel ? vel.clone() : new THREE.Vector3(),
            spin: spin ? spin.clone() : new THREE.Vector3(),
            rest: 0,
            asleep: false
        };
        // Never start under the floor (it would fall forever)
        const p = object.position;
        const g = this.raycast(_o.set(p.x, p.y + 2, p.z), DOWN, 2 + b.reach);
        if (g && g.point.y > p.y - b.reach) p.y = g.point.y + b.reach;
        this.bodies.push(b);
        return b;
    }

    remove(b) {
        const i = this.bodies.indexOf(b);
        if (i >= 0) this.bodies.splice(i, 1);
    }

    step(dt) {
        const n = Math.max(1, Math.ceil(dt / PROP_CONFIG.MAX_STEP));
        for (const b of this.bodies) {
            if (b.asleep) continue;
            for (let i = 0; i < n && !b.asleep; i++) this._stepBody(b, dt / n);
        }
    }

    _stepBody(b, h) {
        const C = PROP_CONFIG;
        const p = b.object.position, q = b.object.quaternion, v = b.vel, w = b.spin;
        v.y -= C.GRAVITY * h;

        // Walls (and ceilings): bounce off before the box would reach them; floors are handled below
        const speed = v.length();
        if (speed * h > 1e-4) {
            const hit = this.raycast(p, _dir.copy(v).divideScalar(speed), speed * h + b.reach);
            if (hit && !hit.ground && hit.normal.y < 0.7) {
                const vn = v.dot(hit.normal);
                if (vn < 0) v.addScaledVector(hit.normal, -(1 + C.BOUNCE) * vn);
            }
        }

        const oldY = p.y;
        p.addScaledVector(v, h);
        const ang = w.length();
        if (ang > 1e-5) {
            _dq.setFromAxisAngle(_dir.copy(w).divideScalar(ang), ang * h);
            q.premultiply(_dq).normalize();
        }

        // The surface under it: cast from above where it was, so a fast fall can't skip through
        const top = Math.max(oldY, p.y) + b.reach;
        const g = this.raycast(_o.set(p.x, top, p.z), DOWN, top - p.y + b.reach + 0.05);
        if (g) { _p0.copy(g.point); _n.copy(g.normal); }
        const floor = this.floorAt ? this.floorAt(p.x, p.z, p.y) : -Infinity;
        if (floor > (g ? g.point.y : -Infinity)) { _p0.set(p.x, floor, p.z); _n.copy(UP); }
        else if (!g) { b.rest = 0; return; }

        // Corner contacts against that plane: impulses at each corner push it out and spin it over
        // (a few passes, so a face lying on the ground settles instead of rocking corner to corner)
        let depthMax = 0, nc = 0;
        for (let i = 0; i < 8; i++) {
            const r = _corners[nc];
            r.set(i & 1 ? b.half.x : -b.half.x, i & 2 ? b.half.y : -b.half.y, i & 4 ? b.half.z : -b.half.z).applyQuaternion(q);
            const depth = _vc.copy(_p0).sub(p).sub(r).dot(_n);
            if (depth <= 0) continue;
            if (depth > depthMax) depthMax = depth;
            nc++;
        }
        for (let k = 0; k < 4 * nc; k++) {
            _r.copy(_corners[k % nc]);
            _vc.crossVectors(w, _r).add(v);
            const vn = _vc.dot(_n);
            if (vn >= 0) continue;
            _rn.crossVectors(_r, _n);
            const j = -(1 + (vn < -1.5 ? C.BOUNCE : 0)) * vn / (1 + b.invI * _rn.lengthSq());
            v.addScaledVector(_n, j);
            w.addScaledVector(_rn, j * b.invI);
            // Friction against the sliding / rolling of that corner
            _vc.crossVectors(w, _r).add(v);
            _vc.addScaledVector(_n, -_vc.dot(_n));
            const vt = _vc.length();
            if (vt < 1e-5) continue;
            _t.copy(_vc).divideScalar(vt);
            _rt.crossVectors(_r, _t);
            const jt = Math.min(C.FRICTION * j, vt / (1 + b.invI * _rt.lengthSq()));
            v.addScaledVector(_t, -jt);
            w.addScaledVector(_rt, -jt * b.invI);
        }
        if (depthMax <= 0) { b.rest = 0; return; }
        p.addScaledVector(_n, depthMax);
        w.multiplyScalar(Math.exp(-2 * h));

        if (v.length() < C.SLEEP_SPEED && w.length() < C.SLEEP_SPIN) {
            b.rest += h;
            if (b.rest > C.SLEEP_TIME) { b.asleep = true; v.set(0, 0, 0); w.set(0, 0, 0); }
        } else {
            b.rest = 0;
        }
    }
}
