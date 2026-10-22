import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Plane, PLANE_CONFIG, spatialGrid, PlayerController, CameraController } from '../../js/game/main.js';

const DT = 1 / 60;

function step(plane, seconds, grid = null, before = null) {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) {
        if (before) before(i);
        plane.update(DT, grid);
    }
}

function pilot(plane) {
    plane.setPlayerControlled(true);
    return plane;
}

test('parked plane stays put and sits on the ground', () => {
    const p = new Plane('p', 10, 20, 0.5);
    step(p, 3);
    assert.equal(p.position.x, 10);
    assert.equal(p.position.z, 20);
    assert.equal(p.position.y, 0);
    assert.equal(p.speed, 0);
    assert.equal(p.onGround, true);
});

test('full throttle accelerates down the runway along the heading (-Z at yaw 0)', () => {
    const p = pilot(new Plane('p', 0, 0, 0));
    p.setInputs(true, 0, false, false);
    step(p, 1.5);
    assert.ok(p.speed > 10, `speed ${p.speed}`);
    assert.ok(p.position.z < -5, 'moved toward -Z');
    assert.ok(Math.abs(p.position.x) < 1e-6);
    assert.equal(p.position.y, 0, 'still rolling on the ground');
});

test('takes off after rotating above rotate speed, then climbs', () => {
    const p = pilot(new Plane('p', 0, 0, 0));
    p.setInputs(true, 0, false, false);
    step(p, 5);
    assert.ok(p.speed >= PLANE_CONFIG.ROTATE_SPEED);
    assert.equal(p.onGround, true);
    p.setPitchInput(1);
    step(p, 3);
    assert.equal(p.onGround, false);
    assert.ok(p.position.y > 10, `altitude ${p.position.y}`);
    p.setPitchInput(0);
});

test('cannot rotate before reaching rotate speed', () => {
    const p = pilot(new Plane('p', 0, 0, 0));
    p.setInputs(true, 0, false, false);
    p.setPitchInput(1);
    step(p, 0.4); // speed still low
    assert.equal(p.onGround, true);
    assert.equal(p.position.y, 0);
});

function airborne(grid = null) {
    const p = pilot(new Plane('p', 0, 0, 0));
    p.setInputs(true, 0, false, false);
    step(p, 5, grid);
    p.setPitchInput(1);
    step(p, 3, grid);
    p.setPitchInput(0);
    return p;
}

test('banking right turns right (yaw decreases) and banking left turns left', () => {
    const right = airborne();
    const y0 = right.yaw;
    right.setInputs(true, { left: false, right: true }, false, false);
    step(right, 2);
    assert.ok(right.roll > 0.5, `roll ${right.roll}`);
    let dyaw = right.yaw - y0;
    if (dyaw > Math.PI) dyaw -= 2 * Math.PI;
    if (dyaw < -Math.PI) dyaw += 2 * Math.PI;
    assert.ok(dyaw < -0.1, `right bank should reduce yaw, got ${dyaw}`);

    const left = airborne();
    const l0 = left.yaw;
    left.setInputs(true, { left: true, right: false }, false, false);
    step(left, 2);
    assert.ok(left.roll < -0.5);
    assert.ok(left.yaw - l0 > 0.1, 'left bank should increase yaw');
});

test('levels out after releasing roll input', () => {
    const p = airborne();
    p.setInputs(true, { left: false, right: true }, false, false);
    step(p, 1.5);
    p.setInputs(true, 0, false, false);
    step(p, 2);
    assert.ok(Math.abs(p.roll) < 0.01);
});

test('throttle cut in the air stalls and the plane descends back to the ground', () => {
    const p = airborne();
    p.setInputs(false, 0, true, false); // S lowers the throttle
    step(p, 200); // from ~150 m with no pilot input: coasts, stalls, sinks
    assert.equal(p.onGround, true);
    assert.equal(p.position.y, 0);
});

test('unoccupied plane rolls to a stop with the engine off', () => {
    const p = airborne();
    step(p, 20);
    p.setPlayerControlled(false);
    // engine is off once unoccupied, so it glides down and rolls out
    step(p, 200);
    assert.equal(p.onGround, true);
    assert.ok(p.speed < 0.5, `speed ${p.speed}`);
});

test('nose-diving into the ground is a hard landing; a gentle glide-in is not', () => {
    const dive = airborne();
    dive.setPitchInput(-1); // hold the nose down
    let crashed = false;
    step(dive, 30, null, () => { if (dive.crashed) crashed = true; });
    assert.equal(crashed, true, 'steep dive should be flagged');
    assert.equal(dive.onGround, true);

    const glide = airborne();
    glide.setInputs(false, 0, true, false);  // S: pull the throttle lever back to idle...
    step(glide, 3);
    glide.setInputs(false, 0, false, false); // ...then wings level, no brake
    let hard = false;
    // A pilot who keeps the nose slightly down to hold flying speed on the way in
    step(glide, 150, null, () => {
        if (glide.crashed) hard = true;
        glide.setPitchInput(glide.speed < 30 && glide.pitch > -0.1 ? -1 : (glide.pitch < -0.1 && glide.speed > 34 ? 1 : 0));
    });
    assert.equal(glide.onGround, true);
    assert.equal(hard, false, 'power-off glide touchdown should be soft');
});

test('flying above a building does not collide, flying into it does', () => {
    const grid = spatialGrid;
    const box = new THREE.Box3(new THREE.Vector3(-20, 0, -400), new THREE.Vector3(20, 25, -380));
    grid.insertStatic('test_building', box);

    // Climb above the 25m roofline before reaching the building
    const high = pilot(new Plane('hi', 0, 0, 0));
    high.setInputs(true, 0, false, false);
    step(high, 5, grid);
    high.setPitchInput(1);
    step(high, 6, grid);
    high.setPitchInput(0);
    assert.ok(high.position.y > 40, `altitude ${high.position.y}`);
    let hitHigh = false;
    step(high, 8, grid, () => { if (high.crashed) hitHigh = true; });
    assert.equal(hitHigh, false);

    // Straight at it on the ground
    const low = pilot(new Plane('lo', 0, 0, 0));
    low.setInputs(true, 0, false, false);
    let hitLow = false;
    step(low, 14, grid, () => { if (low.crashed) hitLow = true; });
    assert.equal(hitLow, true, 'ground-level plane should hit the building');
    assert.ok(low.position.z > -380 - 2, 'was pushed out of the building');
});

test('exit is only allowed on the ground and at low speed', () => {
    const p = pilot(new Plane('p', 0, 0, 0));
    assert.equal(p.canExit(), true);
    p.setInputs(true, 0, false, false);
    step(p, 3);
    assert.equal(p.canExit(), false, 'moving fast');
    const a = airborne();
    assert.equal(a.canExit(), false, 'airborne');
});

test('PlayerController boards a plane from its larger interaction range and refuses mid-air exit', () => {
    const camera = new THREE.PerspectiveCamera();
    const cameraController = new CameraController({ camera });
    const pos = new THREE.Vector3(0, 0, 0);
    const pc = new PlayerController({ camera, cameraController, spatialGrid: null, initialPosition: pos, playerPosition: pos, domElement: undefined });

    const plane = new Plane('p', 6, 0, 0); // 6 m away: out of car range (3.5), inside plane range (8)
    assert.equal(pc.getNearbyVehicle([plane]), plane);
    assert.equal(pc.enterNearbyVehicle([plane]), true);
    assert.equal(pc.getState(), 'IN_VEHICLE');
    assert.ok(cameraController.mode === 'CHASE');

    // Take off, then try to leave
    plane.setPlayerControlled(true);
    plane.setInputs(true, 0, false, false);
    step(plane, 5);
    plane.setPitchInput(1);
    step(plane, 3);
    assert.equal(plane.onGround, false);
    assert.equal(pc.exitVehicle(null), false, 'cannot bail out in the air');
    assert.equal(pc.getState(), 'IN_VEHICLE');
    assert.equal(pc.exitVehicle(null, true), true, 'forced exit (respawn) works');
});

test('chase camera uses the plane\'s own distance and height', () => {
    const camera = new THREE.PerspectiveCamera();
    const cc = new CameraController({ camera });
    const plane = new Plane('p', 0, 0, 0);
    cc.setMode('CHASE', plane);
    const dist = Math.hypot(camera.position.x - plane.position.x, camera.position.z - plane.position.z);
    assert.ok(Math.abs(dist - plane.chaseCamera.chaseDistance) < 1e-6, `dist ${dist}`);
    assert.ok(Math.abs(camera.position.y - plane.chaseCamera.chaseHeight) < 1e-6);
});
