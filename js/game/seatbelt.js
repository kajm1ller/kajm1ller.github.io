/**
 * js/game/seatbelt.js
 *
 * The driver's seatbelt. From the driver's seat you look left over your shoulder, grab the tongue
 * hanging by the door pillar (click and hold), drag it across your body and let go over the buckle
 * down by your right hip: click, it's on. Buckled up, a crash can't throw you out through the
 * windshield (game.html watchForEjection). Everything is in car space (x right, -z forward), on the
 * car's mesh, and drawn only from the seat.
 */
import * as THREE from 'three';
import { cabinShape } from './carModels.js';

export const BELT_CONFIG = {
    AIM: 0.22,          // rad: how near the middle of the view the tongue must be to grab it
    CLICK: 0.1,         // rad: how near the buckle must be for the tongue to click in (only the buckle takes it)
    HAND: 0.42          // m in front of the eye the hand holds the tongue while pulling it across
};

const _w = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _hand = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();

/** Places a strap (a unit-long box along z) from a to b. */
function strap(mesh, a, b) {
    _w.subVectors(b, a);
    const len = _w.length();
    mesh.visible = len > 1e-3;
    if (!mesh.visible) return;
    mesh.position.addVectors(a, b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(Z, _w.divideScalar(len));
    mesh.scale.set(1, 1, len);
}

export class Seatbelt {
    constructor(vehicle) {
        this.vehicle = vehicle;
        this.buckled = false;
        this.held = false;
        this.click = 0;
        this._lean = [0, 0];
        const S = cabinShape(vehicle.model || 'civic');
        const e = S.eye;
        const side = S.sideX(e.y);
        this.anchor = new THREE.Vector3(-side + 0.06, e.y + 0.08, S.bPillar - 0.02);   // D-ring high on the pillar
        this.rest = new THREE.Vector3(-side + 0.08, e.y - 0.22, e.z + 0.12);         // where the tongue hangs
        // The driver's body (below the camera): the belt lies on its surface, so it wraps the chest and lap
        const tz = e.z + 0.16;                     // torso centre (back against the seat)
        const zs = tz - 0.11 - 0.014;              // just in front of the chest
        this.shoulder = [new THREE.Vector3(e.x - 0.17, e.y - 0.14, tz - 0.02), new THREE.Vector3(e.x - 0.17, e.y - 0.19, zs)];
        this.buckle = new THREE.Vector3(e.x + 0.27, e.y - 0.43, zs);                  // by your right hip
        const lapY = e.y - 0.443, lapZ = zs - 0.04;                                   // on top of the thighs
        this.lapPts = [new THREE.Vector3(e.x + 0.1, lapY, lapZ), new THREE.Vector3(e.x - 0.1, lapY, lapZ)];
        this.lap = new THREE.Vector3(-side + 0.1, e.y - 0.45, zs + 0.1);              // lap anchor by your left hip
        this.tonguePos = this.rest.clone();

        const webbing = new THREE.MeshStandardMaterial({ color: 0x4a4d55, roughness: 0.85 });
        const metal = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.25, metalness: 0.9 });
        const plastic = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
        const geo = new THREE.BoxGeometry(0.048, 0.003, 1);
        this.group = new THREE.Group();
        this.group.name = 'seatbelt';
        this.straps = [0, 1, 2, 3, 4, 5].map(() => new THREE.Mesh(geo, webbing));
        const box = (w, h, d, m, x, y, z, parent) => {
            const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
            o.position.set(x, y, z);
            parent.add(o);
            return o;
        };
        // Tongue (latch plate): steel blade with a hole, black plastic head the webbing threads through; +z is the tip
        this.tongue = new THREE.Group();
        box(0.044, 0.004, 0.06, metal, 0, 0, 0.03, this.tongue);
        box(0.014, 0.0045, 0.02, plastic, 0, 0, 0.034, this.tongue);          // the hole
        box(0.052, 0.014, 0.03, plastic, 0, 0, -0.015, this.tongue);          // head
        // Buckle receptacle: stalk up from the seat, housing with a slot facing the incoming tongue, red release button
        const dirB = new THREE.Vector3().subVectors(this.buckle, this.shoulder[1]).normalize();
        this.dirB = dirB;
        this.receptacle = new THREE.Group();
        this.receptacle.position.copy(this.buckle);
        this.receptacle.quaternion.setFromUnitVectors(Z, dirB);
        this.slotMat = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0x000000, roughness: 0.9 });
        box(0.052, 0.03, 0.1, plastic, 0, 0, 0.03, this.receptacle);
        box(0.04, 0.012, 0.003, this.slotMat, 0, 0, -0.0205, this.receptacle);
        this.button = box(0.022, 0.01, 0.03, new THREE.MeshStandardMaterial({ color: 0xc62828, roughness: 0.5 }), 0, 0.019, 0.03, this.receptacle);
        this.stalk = new THREE.Mesh(geo, webbing);
        strap(this.stalk, this.buckle.clone().add(new THREE.Vector3(0, 0.02, 0.04)), this.buckle.clone().add(new THREE.Vector3(0.02, -0.14, 0.1)));
        // Body: torso + shoulders, thighs and shins (the forearms and hands are the cockpit's)
        const jacket = new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.9 });
        const jeans = new THREE.MeshStandardMaterial({ color: 0x2a3c5a, roughness: 0.9 });
        const limb = (a, b, w, h, m) => {
            const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, 1), m);
            strap(o, a, b);
            this.group.add(o);
        };
        box(0.42, 0.4, 0.22, jacket, e.x, e.y - 0.35, tz, this.group);
        box(0.5, 0.1, 0.22, jacket, e.x, e.y - 0.2, tz, this.group);
        box(0.38, 0.12, 0.22, jeans, e.x, e.y - 0.5, tz, this.group);
        const V = (x, y, z) => new THREE.Vector3(x, y, z);
        for (const sd of [-1, 1]) {
            limb(V(e.x + sd * 0.1, e.y - 0.52, tz), V(e.x + sd * 0.1, e.y - 0.52, e.z - 0.3), 0.15, 0.14, jeans);
            limb(V(e.x + sd * 0.1, e.y - 0.52, e.z - 0.3), V(e.x + sd * 0.1, e.y - 0.8, e.z - 0.45), 0.11, 0.11, jeans);
        }
        const ring = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.05), plastic);
        ring.position.copy(this.anchor);
        this.group.add(...this.straps, this.tongue, this.receptacle, this.stalk, ring);
        this.group.traverse((o) => { o.castShadow = false; });
        vehicle.mesh.add(this.group);
    }

    /** How far (rad) a car-space point is from the middle of the view. */
    _offAim(camera, p) {
        this.vehicle.mesh.updateMatrixWorld();
        _w.copy(p).applyMatrix4(this.vehicle.mesh.matrixWorld).sub(camera.position);
        return camera.getWorldDirection(_fwd).angleTo(_w);
    }

    /** Looking at the hanging tongue: take hold of it. Returns whether you did. */
    grab(camera) {
        if (this.buckled || this.held || this._offAim(camera, this.rest) > BELT_CONFIG.AIM) return false;
        this.held = true;
        return true;
    }

    /** Lets go: over the buckle it clicks in (returns true), anywhere else it reels back to the pillar. */
    release(camera) {
        if (!this.held) return false;
        this.held = false;
        this.buckled = this._offAim(camera, this.buckle) < BELT_CONFIG.CLICK;
        this.click = this.buckled ? 1 : 0;   // button pops as it latches
        return this.buckled;
    }

    /**
     * Leans your head toward whatever you're looking for: left toward the hanging tongue, down and right toward
     * the buckle once you hold the tongue. Moves the camera (rebuilt from the seat every step) by the lean.
     */
    lean(camera, inSeat, dt = 1 / 60) {
        const near = (p) => Math.max(0, Math.min(1, 1 - (this._offAim(camera, p) - 0.1) / 0.7));
        const want = inSeat && !this.buckled ? (this.held ? [0, near(this.buckle)] : [near(this.rest), 0]) : [0, 0];
        const k = 1 - Math.exp(-dt * 7);
        this._lean[0] += (want[0] - this._lean[0]) * k;
        this._lean[1] += (want[1] - this._lean[1]) * k;
        const [l, b] = this._lean;
        if (l < 1e-3 && b < 1e-3) return;
        _w.set(-0.2 * l + 0.16 * b, -0.04 * l - 0.13 * b, 0.02 * l + 0.04 * b);
        this.vehicle.mesh.getWorldQuaternion(_q);
        camera.position.add(_w.applyQuaternion(_q));
    }

    update(camera, inSeat) {
        this.group.visible = inSeat;
        if (!inSeat) {
            if (this.held) this.held = false;
            return;
        }
        if (this.held) {
            // In your hand, a little in front of your face wherever you look
            camera.getWorldDirection(_fwd);
            _hand.copy(camera.position).addScaledVector(_fwd, BELT_CONFIG.HAND);
            _hand.y -= 0.08;
            this.vehicle.mesh.updateMatrixWorld();
            this.vehicle.mesh.worldToLocal(_hand);
            this.tongue.position.copy(_hand);
            // the slot lights up when you're lined up with it
            this.slotMat.emissive.setHex(this._offAim(camera, this.buckle) < BELT_CONFIG.CLICK ? 0x1faa40 : 0x000000);
        } else {
            this.slotMat.emissive.setHex(0x000000);
            // Reels back to the pillar, or stays clicked in
            const target = this.buckled ? this.buckle : this.rest;
            this.tongue.position.lerp(target, this.buckled ? 0.4 : 0.25);   // slides into the slot
        }
        this.click = Math.max(0, this.click - 0.12);
        this.button.position.y = 0.019 - 0.008 * this.click;
        const st = this.straps;
        if (this.buckled) {
            const path = [this.anchor, ...this.shoulder, this.buckle, ...this.lapPts, this.lap];
            path.slice(1).forEach((p, i) => strap(st[i], path[i], p));
            this.tongue.quaternion.copy(st[2].quaternion);
        } else {
            strap(st[0], this.anchor, this.tongue.position);
            for (let i = 1; i < st.length; i++) st[i].visible = false;
            this.tongue.quaternion.copy(st[0].quaternion);
        }
    }

    dispose() {
        this.vehicle.mesh.remove(this.group);
    }
}
