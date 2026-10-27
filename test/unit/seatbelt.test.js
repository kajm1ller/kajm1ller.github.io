import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Seatbelt } from '../../js/game/seatbelt.js';
import { cabinShape } from '../../js/game/carModels.js';

test('seatbelt: grab the tongue over your left shoulder, let go over the buckle to click it in', () => {
    const car = { model: 'civic', mesh: new THREE.Group() };
    car.mesh.position.set(10, 0, -5);
    car.mesh.rotation.y = 0.7;
    const belt = new Seatbelt(car);
    const cam = new THREE.PerspectiveCamera();
    const e = cabinShape('civic').eye;
    car.mesh.updateMatrixWorld();
    cam.position.set(e.x, e.y, e.z).applyMatrix4(car.mesh.matrixWorld);
    const look = (p) => cam.lookAt(p.clone().applyMatrix4(car.mesh.matrixWorld));

    look(new THREE.Vector3(e.x, e.y, e.z - 5));          // straight ahead: nothing to grab
    assert.equal(belt.grab(cam), false);
    look(belt.rest);
    assert.equal(belt.grab(cam), true);
    look(new THREE.Vector3(e.x, e.y, e.z - 5));          // let go anywhere else: it reels back
    assert.equal(belt.release(cam), false);
    assert.equal(belt.buckled, false);
    look(belt.rest);
    belt.grab(cam);
    look(belt.buckle);
    assert.equal(belt.release(cam), true);
    assert.equal(belt.buckled, true);
    assert.equal(belt.grab(cam), false);                  // already on
});
