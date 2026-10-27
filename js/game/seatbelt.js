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
    AIM: 0.22,          // rad: how near the middle of the view the tongue / buckle must be
    HAND: 0.42          // m in front of the eye the hand holds the tongue while pulling it across
};

const _w = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _hand = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

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
        const S = cabinShape(vehicle.model || 'civic');
        const e = S.eye;
        const side = S.sideX(e.y);
        this.anchor = new THREE.Vector3(-side + 0.06, e.y + 0.08, S.bPillar - 0.02);   // D-ring high on the pillar
        this.rest = new THREE.Vector3(-side + 0.08, e.y - 0.22, e.z + 0.12);         // where the tongue hangs
        this.buckle = new THREE.Vector3(e.x + 0.25, e.y - 0.5, e.z + 0.02);          // by your right hip
        this.lap = new THREE.Vector3(-side + 0.1, e.y - 0.6, e.z + 0.12);            // lap anchor by your left hip
        this.chest = new THREE.Vector3(e.x + 0.02, e.y - 0.3, e.z - 0.2);            // across your chest
        this.tonguePos = this.rest.clone();

        const webbing = new THREE.MeshStandardMaterial({ color: 0x4a4d55, roughness: 0.85 });
        const metal = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.25, metalness: 0.9 });
        const plastic = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
        const geo = new THREE.BoxGeometry(0.048, 0.003, 1);
        this.group = new THREE.Group();
        this.group.name = 'seatbelt';
        this.straps = [0, 1, 2].map(() => new THREE.Mesh(geo, webbing));
        this.tongue = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.008, 0.07), metal);
        const housing = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.1, 0.05), plastic);
        housing.position.copy(this.buckle).add(new THREE.Vector3(0, -0.04, 0));
        const button = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.03), new THREE.MeshStandardMaterial({ color: 0xc62828, roughness: 0.5 }));
        button.position.copy(this.buckle).add(new THREE.Vector3(0, 0.012, 0));
        const ring = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.05), plastic);
        ring.position.copy(this.anchor);
        this.group.add(...this.straps, this.tongue, housing, button, ring);
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
        this.buckled = this._offAim(camera, this.buckle) < BELT_CONFIG.AIM;
        return this.buckled;
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
        } else {
            // Reels back to the pillar, or stays clicked in
            const target = this.buckled ? this.buckle : this.rest;
            this.tongue.position.lerp(target, this.buckled ? 1 : 0.25);
        }
        const [a, b, c] = this.straps;
        if (this.buckled) {
            strap(a, this.anchor, this.chest);
            strap(b, this.chest, this.buckle);
            strap(c, this.buckle, this.lap);
            this.tongue.quaternion.copy(b.quaternion);
        } else {
            strap(a, this.anchor, this.tongue.position);
            b.visible = c.visible = false;
            this.tongue.quaternion.copy(a.quaternion);
        }
    }

    dispose() {
        this.vehicle.mesh.remove(this.group);
    }
}
