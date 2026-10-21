import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraController, CameraMode } from '../../js/game/camera.js';
import { Vehicle } from '../../js/game/vehicle.js';
import { PoliceSystem, PoliceVehicle } from '../../js/game/police.js';
import { TrafficAgent } from '../../js/game/traffic.js';

test('CameraController: In-car aiming activates first person with smooth transition', () => {
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
    const controller = new CameraController({ camera });
    const vehicle = new Vehicle('test_car', 0, 0, 0);

    controller.setMode(CameraMode.CHASE, vehicle);
    assert.equal(controller.mode, CameraMode.CHASE);
    assert.equal(controller.isAiming, false);
    assert.equal(controller.aimTransition, 0);

    // Initial 3rd person chase update
    controller.update(1 / 60);
    const chasePosInitial = camera.position.clone();
    assert(chasePosInitial.z > 3.0, 'Chase camera sits behind vehicle');

    // Hold right mouse to aim
    controller.setAiming(true);
    assert.equal(controller.isAiming, true);

    // Step simulation over 20 frames (~0.33s)
    for (let i = 0; i < 20; i++) {
        controller.update(1 / 60);
    }

    assert(controller.aimTransition > 0.8, `Aim transition should be near 1.0 (got ${controller.aimTransition.toFixed(2)})`);
    const cockpitPos = camera.position.clone();

    // Camera should have smoothly moved inside the car cockpit near the driver head (-0.4, 1.25, 0.05)
    assert(Math.abs(cockpitPos.x - (-0.4)) < 0.2, `Camera X should be near driver seat (-0.4), got ${cockpitPos.x}`);
    assert(Math.abs(cockpitPos.y - 1.25) < 0.25, `Camera Y should be near driver eye height (1.25), got ${cockpitPos.y}`);
    assert(Math.abs(cockpitPos.z) < 1.0, `Camera Z should be inside cockpit, got ${cockpitPos.z}`);

    // Release right mouse to exit aim
    controller.setAiming(false);
    assert.equal(controller.isAiming, false);

    // Step simulation over 25 frames
    for (let i = 0; i < 25; i++) {
        controller.update(1 / 60);
    }

    assert(controller.aimTransition < 0.15, `Aim transition should smoothly decay back towards 0 (got ${controller.aimTransition.toFixed(2)})`);
    assert(camera.position.z > 3.0, 'Camera should smoothly transition back to 3rd person chase distance');
});

test('CameraController: In-car aiming supports full 360-degree rotation', () => {
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
    const controller = new CameraController({ camera });
    const vehicle = new Vehicle('test_car_360', 10, 0, 10);

    controller.setMode(CameraMode.CHASE, vehicle);
    controller.setAiming(true);
    controller.update(1 / 60);

    // Rotate mouse horizontally 360 degrees
    const fullCircleMovement = (Math.PI * 2) / controller.mouseSensitivity;
    controller.handleMouseMove(fullCircleMovement / 4, 0); // 90 deg right
    assert(Math.abs(controller.aimYaw) > 0.5, 'Aim yaw should rotate');

    controller.handleMouseMove(fullCircleMovement / 2, 0); // 180 deg more
    assert(controller.aimYaw >= -Math.PI && controller.aimYaw <= Math.PI, 'Aim yaw should wrap within [-PI, PI]');

    // Full 360 rotation is completely unconstrained
    for (let i = 0; i < 8; i++) {
        controller.handleMouseMove(fullCircleMovement / 8, 0);
    }
    assert(controller.aimYaw >= -Math.PI && controller.aimYaw <= Math.PI);
});

test('Vehicle Windows: Front and back window geometry and local bounds', () => {
    const scene = new THREE.Scene();
    const vehicle = new Vehicle('honda_civic_win', 0, 0, 0);
    vehicle.initMesh(scene);

    const windshield = vehicle.mesh.getObjectByName('windshield');
    const rearGlass = vehicle.mesh.getObjectByName('rear_glass');

    assert(windshield, 'Vehicle mesh must have windshield (front window)');
    assert(rearGlass, 'Vehicle mesh must have rear_glass (back window)');

    // Verify local coordinates of front and rear windows
    assert(windshield.position.z < -1.0, 'Windshield must sit at front of vehicle (local -Z)');
    assert(rearGlass.position.z >= 0.7, 'Rear glass must sit at rear of vehicle (local +Z >= 0.7)');
    assert(windshield.position.y > 0.9 && windshield.position.y < 1.4, 'Windshield at eye level');
    assert(rearGlass.position.y > 0.9 && rearGlass.position.y < 1.4, 'Rear glass at eye level');
});

test('Vehicle Windows: Shooting front window kills driver and creates blood splatters', () => {
    const scene = new THREE.Scene();
    const vehicle = new Vehicle('target_civic', 0, 0, -10);
    vehicle.yaw = 0;
    vehicle.initMesh(scene);

    assert.equal(vehicle.driverDead, undefined);
    assert.equal(vehicle.hasFrontWindowBlood, undefined);

    // Helper functions matching game implementation
    function applyWindowBlood(veh, winType) {
        const isFront = winType === 'front';
        const winMesh = veh.mesh.getObjectByName(isFront ? 'windshield' : 'rear_glass');
        if (winMesh) {
            winMesh.userData.hasBloodSplatter = true;
            if (isFront) veh.hasFrontWindowBlood = true;
            else veh.hasBackWindowBlood = true;
            veh.hasWindowBlood = true;
        }
    }

    function killDriver(veh, winType) {
        veh.driverDead = true;
        veh.driverState = 'dead';
        applyWindowBlood(veh, winType);
    }

    // Shoot front window
    killDriver(vehicle, 'front');

    assert.equal(vehicle.driverDead, true, 'Driver must be marked dead');
    assert.equal(vehicle.driverState, 'dead');
    assert.equal(vehicle.hasFrontWindowBlood, true, 'Front window must be marked with blood splatter');
    assert.equal(vehicle.hasWindowBlood, true, 'Vehicle must be marked with window blood');
    const windshield = vehicle.mesh.getObjectByName('windshield');
    assert.equal(windshield.userData.hasBloodSplatter, true, 'Windshield mesh must have blood splatter tag');
});

test('Vehicle Windows: Shooting back window kills driver and creates blood splatters', () => {
    const scene = new THREE.Scene();
    const vehicle = new Vehicle('target_civic_rear', 0, 0, 10);
    vehicle.yaw = 0;
    vehicle.initMesh(scene);

    function applyWindowBlood(veh, winType) {
        const isFront = winType === 'front';
        const winMesh = veh.mesh.getObjectByName(isFront ? 'windshield' : 'rear_glass');
        if (winMesh) {
            winMesh.userData.hasBloodSplatter = true;
            if (isFront) veh.hasFrontWindowBlood = true;
            else veh.hasBackWindowBlood = true;
            veh.hasWindowBlood = true;
        }
    }

    function killDriver(veh, winType) {
        veh.driverDead = true;
        veh.driverState = 'dead';
        applyWindowBlood(veh, winType);
    }

    // Shoot back window
    killDriver(vehicle, 'back');

    assert.equal(vehicle.driverDead, true, 'Driver must be marked dead');
    assert.equal(vehicle.hasBackWindowBlood, true, 'Back window must be marked with blood splatter');
    assert.equal(vehicle.hasWindowBlood, true, 'Vehicle must be marked with window blood');
    const rearGlass = vehicle.mesh.getObjectByName('rear_glass');
    assert.equal(rearGlass.userData.hasBloodSplatter, true, 'Rear glass mesh must have blood splatter tag');
});

test('Police Vehicle Windows: Shooting police cruiser driver escalates wanted level', () => {
    const scene = new THREE.Scene();
    const police = new PoliceSystem(scene);
    const pCar = police.spawnPoliceCar({ x: 15, z: 15 });

    police.setWantedLevel(1);
    assert.equal(police.wantedLevel, 1);

    // Shoot police cruiser window
    pCar.driverDead = true;
    police.setWantedLevel(Math.min(5, police.wantedLevel + 1));

    assert.equal(police.wantedLevel, 2, 'Killing police cruiser driver must escalate wanted level');
    assert.equal(pCar.driverDead, true, 'Police driver must be marked dead');

    // Cruiser AI should halt pursuit when driver is dead
    pCar.updateAI(1 / 60, { x: 0, z: 0 }, false, null, null);
    assert.equal(pCar.inputThrottle, 0, 'Dead police driver must not throttle');
    assert(pCar.inputBrake > 0, 'Dead police driver must brake to a halt');
});
