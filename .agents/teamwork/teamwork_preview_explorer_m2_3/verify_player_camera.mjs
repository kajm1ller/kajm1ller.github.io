/**
 * Verification test for proposed PlayerController and CameraController
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { PlayerController, PlayerState } from './proposed_player.js';
import { CameraController, CameraMode, lerpAngle } from './proposed_camera.js';
import { SpatialGrid } from '../../../js/game/spatialGrid.js';

class MockVehicle {
    constructor(id = 'car_1', x = 0, z = 0, yaw = 0) {
        this.id = id;
        this.isPlayer = false;
        this.x = x;
        this.y = 0.5;
        this.z = z;
        this.yaw = yaw;
        this.speed = 0;
        this.inputs = {};
    }

    getPosition() {
        return { x: this.x, y: this.y, z: this.z };
    }

    getYaw() {
        return this.yaw;
    }

    getSpeed() {
        return this.speed;
    }

    setInputs(throttle, steer, brake, handbrake) {
        this.inputs = { throttle, steer, brake, handbrake };
    }
}

test('PlayerController: On-Foot initial state and properties', () => {
    const pc = new PlayerController({
        initialPosition: { x: 5, y: 1.7, z: 10 }
    });

    assert.equal(pc.getState(), PlayerState.ON_FOOT);
    assert.deepEqual(pc.getPosition(), { x: 5, y: 1.7, z: 10 });
    assert.equal(pc.getVehicle(), null);
});

test('PlayerController: Proximity detection and boarding within 3.5m', () => {
    const grid = new SpatialGrid(300, 15);
    const pc = new PlayerController({
        spatialGrid: grid,
        initialPosition: { x: 0, y: 0, z: 0 }
    });

    const carNear = new MockVehicle('car_near', 2.0, 0, 0); // 2.0m away (< 3.5m)
    const carFar = new MockVehicle('car_far', 10.0, 0, 0);  // 10.0m away (> 3.5m)

    // Detection via vehicle list
    const found1 = pc.getNearbyVehicle([carFar, carNear]);
    assert.equal(found1, carNear, 'Should pick nearest vehicle in range');

    // Enter nearby vehicle
    const entered = pc.enterNearbyVehicle([carFar, carNear]);
    assert.equal(entered, true, 'Boarding should succeed');
    assert.equal(pc.getState(), PlayerState.IN_VEHICLE);
    assert.equal(pc.getVehicle(), carNear);
    assert.equal(carNear.isPlayer, true);
});

test('PlayerController: Driving input mapping & contradictory input sanitization', () => {
    const pc = new PlayerController();
    const car = new MockVehicle('car_test', 0, 0, 0);
    pc.enterVehicle(car);

    // Contradictory inputs: w + s, a + d, space
    pc.setInputs({ w: true, s: true, a: true, d: true, space: true });
    pc.update(1 / 60);

    assert.equal(car.inputs.throttle, true);
    assert.equal(car.inputs.brake, true);
    assert.equal(car.inputs.handbrake, true);
    // Steering should cancel out: left false, right false
    assert.deepEqual(car.inputs.steer, { left: false, right: false });
});

test('PlayerController: Multi-candidate safe exit placement (Left -> Right -> Rear -> Front)', () => {
    const grid = new SpatialGrid(300, 15);
    const pc = new PlayerController({ spatialGrid: grid });
    const car = new MockVehicle('car_exit', 0, 0, 0); // yaw = 0 (facing -Z)
    pc.enterVehicle(car);

    // Test 1: Clear area -> Candidate 1 (LEFT) selected
    const posClear = pc.calculateSafeExitPosition(car, grid);
    assert.equal(posClear.name, 'LEFT');
    // For yaw = 0, sideDist = 1.9m: x = -1.9, z = 0
    assert.ok(Math.abs(posClear.x - (-1.9)) < 0.01);
    assert.ok(Math.abs(posClear.z - 0) < 0.01);

    // Test 2: Left blocked by static rock -> Candidate 2 (RIGHT) selected
    const leftBlockBox = new THREE.Box3(
        new THREE.Vector3(-2.5, 0, -1.0),
        new THREE.Vector3(-1.0, 2, 1.0)
    );
    grid.insertStatic('rock_left', leftBlockBox);

    const posRight = pc.calculateSafeExitPosition(car, grid);
    assert.equal(posRight.name, 'RIGHT');
    assert.ok(Math.abs(posRight.x - 1.9) < 0.01);

    // Test 3: Right also blocked -> Candidate 3 (REAR) selected
    const rightBlockBox = new THREE.Box3(
        new THREE.Vector3(1.0, 0, -1.0),
        new THREE.Vector3(2.5, 2, 1.0)
    );
    grid.insertStatic('rock_right', rightBlockBox);

    const posRear = pc.calculateSafeExitPosition(car, grid);
    assert.equal(posRear.name, 'REAR');
    // Rear is +Z at longDist = 3.05m
    assert.ok(Math.abs(posRear.z - 3.05) < 0.01);

    // Test 4: Rear also blocked -> Candidate 4 (FRONT) selected
    const rearBlockBox = new THREE.Box3(
        new THREE.Vector3(-1.0, 0, 2.0),
        new THREE.Vector3(1.0, 2, 4.0)
    );
    grid.insertStatic('rock_rear', rearBlockBox);

    const posFront = pc.calculateSafeExitPosition(car, grid);
    assert.equal(posFront.name, 'FRONT');
    // Front is -Z at longDist = 3.05m
    assert.ok(Math.abs(posFront.z - (-3.05)) < 0.01);

    // Test 5: Verify exitVehicle() transitions back to ON_FOOT
    const exitOk = pc.exitVehicle(grid);
    assert.equal(exitOk, true);
    assert.equal(pc.getState(), PlayerState.ON_FOOT);
    assert.equal(pc.getVehicle(), null);
    assert.equal(car.isPlayer, false);

    const finalPos = pc.getPosition();
    const distFromCar = Math.sqrt((finalPos.x - car.x) ** 2 + (finalPos.z - car.z) ** 2);
    assert.ok(distFromCar >= 0.5 && distFromCar <= 5.0, `Exit distance ${distFromCar} should be in [0.5, 5.0]`);
});

test('CameraController: Angular lerp across modulo boundary', () => {
    // Near +PI and -PI
    const angle1 = Math.PI - 0.1;
    const angle2 = -Math.PI + 0.1;
    const interpolated = lerpAngle(angle1, angle2, 0.5);
    // Shortest path goes through PI/-PI
    assert.ok(Math.abs(Math.abs(interpolated) - Math.PI) < 0.05);
});

test('CameraController: Mode switching and chase interpolation', () => {
    const cam = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    const cc = new CameraController({ camera: cam });

    const car = new MockVehicle('car_cam', 10, 20, 0); // at (10, 20)
    car.speed = 15;

    // Switch to chase
    cc.setMode(CameraMode.CHASE, car);
    assert.equal(cc.mode, CameraMode.CHASE);
    assert.equal(cc.targetVehicle, car);

    // Step simulation
    for (let i = 0; i < 30; i++) {
        cc.update(1 / 60);
    }

    assert.ok(Number.isFinite(cam.position.x));
    assert.ok(Number.isFinite(cam.position.y));
    assert.ok(Number.isFinite(cam.position.z));

    // Switch back to first-person
    cc.setMode(CameraMode.FIRST_PERSON, { x: 8, y: 0, z: 20 });
    assert.equal(cc.mode, CameraMode.FIRST_PERSON);
    assert.equal(cam.position.x, 8);
    assert.equal(cam.position.y, 1.7);
    assert.equal(cam.position.z, 20);
});
