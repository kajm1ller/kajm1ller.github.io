import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PropPhysics } from '../../js/game/propPhysics.js';

// Flat ground at y = 0 and a wall at x = 2 facing -x, like impacts.raycastWorld answers
function raycast(o, d, far) {
    let best = null;
    if (d.y < -1e-4) {
        const t = -o.y / d.y;
        if (t > 0 && t <= far) best = { point: o.clone().addScaledVector(d, t), normal: new THREE.Vector3(0, 1, 0), distance: t, ground: true };
    }
    if (d.x > 1e-4) {
        const t = (2 - o.x) / d.x;
        if (t > 0 && t <= far && (!best || t < best.distance)) best = { point: o.clone().addScaledVector(d, t), normal: new THREE.Vector3(-1, 0, 0), distance: t };
    }
    return best;
}

function run(phys, secs) {
    for (let i = 0; i < secs * 60; i++) phys.step(1 / 60);
}

test('a tumbling box lands, settles flat-ish on the ground and sleeps', () => {
    const phys = new PropPhysics(raycast);
    const obj = new THREE.Object3D();
    obj.position.set(0, 1.5, 0);
    obj.rotation.set(0.7, 0.3, 0.4);
    const b = phys.add(obj, new THREE.Vector3(0.3, 0.05, 0.1), new THREE.Vector3(1, 1, 0), new THREE.Vector3(3, -2, 5));
    run(phys, 6);
    assert.ok(b.asleep, 'comes to rest');
    // resting on its broad face: the centre is about its half-height above the ground
    assert.ok(obj.position.y > 0.03 && obj.position.y < 0.09, `y ${obj.position.y}`);
});

test('a box thrown at a wall bounces off it', () => {
    const phys = new PropPhysics(raycast);
    const obj = new THREE.Object3D();
    obj.position.set(0, 1, 0);
    phys.add(obj, new THREE.Vector3(0.1, 0.1, 0.1), new THREE.Vector3(6, 0, 0));
    run(phys, 3);
    assert.ok(obj.position.x < 2, `x ${obj.position.x}`);
    assert.ok(obj.position.y > 0.05 && obj.position.y < 0.2);
});

test('a box starting under the floor is lifted onto it', () => {
    const phys = new PropPhysics(raycast);
    const obj = new THREE.Object3D();
    obj.position.set(0, -0.5, 0);
    phys.add(obj, new THREE.Vector3(0.1, 0.1, 0.1));
    run(phys, 2);
    assert.ok(obj.position.y > 0.05 && obj.position.y < 0.2, `y ${obj.position.y}`);
});
