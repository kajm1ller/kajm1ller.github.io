import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlayerController, PlayerState } from '../../js/game/player.js';
import { CameraController, CameraMode, lerpAngle } from '../../js/game/camera.js';
import { SpatialGrid } from '../../js/game/spatialGrid.js';
import { Vehicle } from '../../js/game/vehicle.js';

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

    const carNear = new Vehicle('car_near', 2.0, 0, 0); // 2.0m away (< 3.5m)
    const carFar = new Vehicle('car_far', 10.0, 0, 0);  // 10.0m away (> 3.5m)

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

test('PlayerController: Multi-candidate safe exit placement and state reversal', () => {
    const grid = new SpatialGrid(300, 15);
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    const camCtrl = new CameraController({ camera });

    const pc = new PlayerController({
        spatialGrid: grid,
        cameraController: camCtrl,
        initialPosition: { x: 0, y: 0, z: 0 }
    });

    const car = new Vehicle('car_test', 0, 0, 0);
    pc.enterVehicle(car);
    assert.equal(pc.getState(), PlayerState.IN_VEHICLE);
    assert.equal(camCtrl.mode, CameraMode.CHASE);

    // Place obstacle on left candidate side (X = -2.0)
    grid.insertStatic('rock_left', {
        min: { x: -2.5, y: 0, z: -1 },
        max: { x: -1.5, y: 3, z: 1 }
    });

    // Exit vehicle
    const exited = pc.exitVehicle(grid);
    assert.equal(exited, true, 'Exit should succeed');
    assert.equal(pc.getState(), PlayerState.ON_FOOT);
    assert.equal(pc.getVehicle(), null);
    assert.equal(camCtrl.mode, CameraMode.FIRST_PERSON);

    const pos = pc.getPosition();
    const dist = Math.hypot(pos.x - car.position.x, pos.z - car.position.z);
    assert(dist >= 0.5 && dist <= 5.0, `Player exit pos within 0.5m-5.0m: ${dist}`);
    // Since LEFT candidate was blocked, should pick RIGHT (positive X)
    assert(pos.x > 0, `Should pick RIGHT candidate because LEFT was blocked, got X=${pos.x}`);
});

test('CameraController: Angle lerp and mode transitions', () => {
    // Lerp angle test across PI boundary
    const a1 = Math.PI - 0.1;
    const a2 = -Math.PI + 0.1;
    const mid = lerpAngle(a1, a2, 0.5);
    assert(Math.abs(Math.abs(mid) - Math.PI) < 0.05, `Angle lerp across PI wrap: ${mid}`);

    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    const camCtrl = new CameraController({ camera });
    const car = new Vehicle('car_cam', 10, 20, 0);

    camCtrl.setMode(CameraMode.CHASE, car);
    assert.equal(camCtrl.mode, CameraMode.CHASE);
    assert.equal(camCtrl.targetVehicle, car);

    // Update chase camera
    camCtrl.update(1 / 60);
    assert(Number.isFinite(camera.position.x));
    assert(Number.isFinite(camera.position.y));
    assert(Number.isFinite(camera.position.z));

    camCtrl.setMode(CameraMode.FIRST_PERSON, { x: 5, y: 0, z: 5 });
    assert.equal(camCtrl.mode, CameraMode.FIRST_PERSON);
});

test('PlayerController: getNearestVehicle alias conforms to getNearbyVehicle', () => {
    const pc = new PlayerController({
        initialPosition: { x: 0, y: 0, z: 0 }
    });

    const carNear = new Vehicle('car_near', 2.0, 0, 0);
    const carFar = new Vehicle('car_far', 10.0, 0, 0);

    const nearby = pc.getNearbyVehicle([carFar, carNear]);
    const nearest = pc.getNearestVehicle([carFar, carNear]);

    assert.equal(nearby, carNear);
    assert.equal(nearest, carNear, 'getNearestVehicle alias must return same result as getNearbyVehicle');
});

test('PlayerController: exitVehicle synchronizes externalPosition, camera.position, and triggers onExit', () => {
    const grid = new SpatialGrid(300, 15);
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    const externalPos = new THREE.Vector3(0, 0, 0);
    let onExitCalledWith = null;

    const pc = new PlayerController({
        camera,
        spatialGrid: grid,
        initialPosition: externalPos,
        onExit: (pos) => {
            onExitCalledWith = { x: pos.x, y: pos.y, z: pos.z };
        }
    });

    const car = new Vehicle('car_sync_test', 0, 0, 0);
    pc.enterVehicle(car);
    assert.equal(pc.getState(), PlayerState.IN_VEHICLE);

    // External position before exit
    externalPos.set(car.position.x, car.position.y, car.position.z);

    const exited = pc.exitVehicle(grid);
    assert.equal(exited, true);

    const exitPos = pc.getPosition();
    const dist = Math.hypot(exitPos.x - car.position.x, exitPos.z - car.position.z);
    assert(dist >= 0.5 && dist <= 5.0, `Exit pos within 0.5-5.0m: ${dist}`);

    // Verify externalPosition was updated
    assert.equal(externalPos.x, exitPos.x, 'externalPosition.x must match exit position');
    assert.equal(externalPos.z, exitPos.z, 'externalPosition.z must match exit position');

    // Verify camera position was updated to eye level
    assert.equal(camera.position.x, exitPos.x, 'camera.position.x must match exit position');
    assert.equal(camera.position.z, exitPos.z, 'camera.position.z must match exit position');
    assert.equal(camera.position.y, exitPos.y + pc.eyeHeight, 'camera.position.y must be at eye level');

    // Verify onExit callback was called
    assert.notEqual(onExitCalledWith, null, 'onExit callback must be triggered');
    assert.equal(onExitCalledWith.x, exitPos.x);
    assert.equal(onExitCalledWith.z, exitPos.z);
});

test('PlayerController: Disembark position remains safely placed across subsequent updates', () => {
    const grid = new SpatialGrid(300, 15);
    const externalPos = new THREE.Vector3(0, 0, 0);

    const pc = new PlayerController({
        spatialGrid: grid,
        initialPosition: externalPos
    });

    const car = new Vehicle('car_multi_step', 0, 0, 0);
    pc.enterVehicle(car);
    externalPos.set(car.position.x, car.position.y, car.position.z);

    pc.exitVehicle(grid);
    const posAtExit = { ...pc.getPosition() };

    // Simulate 60 ticks without movement inputs
    for (let i = 0; i < 60; i++) {
        pc.update(1 / 60, grid);
    }

    const posAfter60 = pc.getPosition();
    assert.equal(posAfter60.x, posAtExit.x, 'Player X must remain stable across updates');
    assert.equal(posAfter60.z, posAtExit.z, 'Player Z must remain stable across updates');
    const dist = Math.hypot(posAfter60.x - car.position.x, posAfter60.z - car.position.z);
    assert(dist >= 0.5 && dist <= 5.0, `Disembark offset must remain beside vehicle across updates: ${dist}`);
});

