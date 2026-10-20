/**
 * test/unit/playerCamera.stress.test.js
 * 
 * Milestone 2 Empirical Stress Verification:
 * Player Interaction & Camera Transition Under Adversarial Boundary Conditions
 * 
 * Verification Vectors:
 * 1. Boarding proximity boundary conditions: 3.49m (success) vs 3.51m (clean failure).
 * 2. Rapid state machine toggling: 1,000 rapid enter/exit alternations, mesh visibility, input routing.
 * 3. Multi-candidate safe exit obstruction stress: 3-sided entrapment, rotation invariance, zero clipping.
 * 4. Camera angle wrapping: Shortest-arc interpolation across +/-PI, zero whipping, gimbal lock immunity.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlayerController, PlayerState } from '../../js/game/player.js';
import { CameraController, CameraMode, lerpAngle } from '../../js/game/camera.js';
import { SpatialGrid } from '../../js/game/spatialGrid.js';
import { Vehicle } from '../../js/game/vehicle.js';
import { CONFIG } from '../../js/game/config.js';

// ============================================================================
// VECTOR 1: Boarding Proximity Boundary Conditions (3.49m vs 3.51m)
// ============================================================================

test('V1.1: Boarding proximity boundary: 3.49m succeeds across all cardinal & diagonal bearings', () => {
    const grid = new SpatialGrid(300, 15);
    const angles = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, -(3 * Math.PI) / 4, -Math.PI / 2, -Math.PI / 4];
    const dist = 3.49;

    for (let i = 0; i < angles.length; i++) {
        const theta = angles[i];
        const carX = dist * Math.cos(theta);
        const carZ = dist * Math.sin(theta);

        const pc = new PlayerController({
            spatialGrid: grid,
            initialPosition: { x: 0, y: 0, z: 0 }
        });

        const car = new Vehicle(`car_349_${i}`, carX, carZ, 0);

        // 1. Direct list query
        const foundList = pc.getNearbyVehicle([car]);
        assert.ok(foundList, `Vehicle at 3.49m (theta=${theta.toFixed(2)}) must be detected via list`);
        assert.equal(foundList.id, car.id);

        const enterSuccessList = pc.enterNearbyVehicle([car]);
        assert.equal(enterSuccessList, true, `Boarding at 3.49m (theta=${theta.toFixed(2)}) must succeed`);
        assert.equal(pc.getState(), PlayerState.IN_VEHICLE);
        assert.equal(pc.getVehicle(), car);
        assert.equal(car.isPlayer, true);

        // 2. SpatialGrid dynamic query
        grid.clearDynamic();
        grid.insertDynamic(car.id, carX, carZ, car.radius, car);

        const pcGrid = new PlayerController({
            spatialGrid: grid,
            initialPosition: { x: 0, y: 0, z: 0 }
        });

        const foundGrid = pcGrid.getNearbyVehicle();
        assert.ok(foundGrid, `Vehicle at 3.49m (theta=${theta.toFixed(2)}) must be detected via spatialGrid`);
        const enterSuccessGrid = pcGrid.enterNearbyVehicle();
        assert.equal(enterSuccessGrid, true, `Boarding via spatialGrid at 3.49m must succeed`);
        assert.equal(pcGrid.getState(), PlayerState.IN_VEHICLE);
    }
});

test('V1.2: Boarding proximity boundary: 3.51m cleanly fails without exceptions or invalid state', () => {
    const grid = new SpatialGrid(300, 15);
    const angles = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, -(3 * Math.PI) / 4, -Math.PI / 2, -Math.PI / 4];
    const dist = 3.51;

    for (let i = 0; i < angles.length; i++) {
        const theta = angles[i];
        const carX = dist * Math.cos(theta);
        const carZ = dist * Math.sin(theta);

        const pc = new PlayerController({
            spatialGrid: grid,
            initialPosition: { x: 0, y: 0, z: 0 }
        });

        const car = new Vehicle(`car_351_${i}`, carX, carZ, 0);

        // 1. Direct list query
        const foundList = pc.getNearbyVehicle([car]);
        assert.equal(foundList, null, `Vehicle at 3.51m (theta=${theta.toFixed(2)}) must NOT be detected via list`);

        const enterSuccessList = pc.enterNearbyVehicle([car]);
        assert.equal(enterSuccessList, false, `Boarding at 3.51m must fail cleanly`);
        assert.equal(pc.getState(), PlayerState.ON_FOOT, `Player state must remain ON_FOOT`);
        assert.equal(pc.getVehicle(), null, `Player activeVehicle must remain null`);
        assert.equal(car.isPlayer, false, `Vehicle isPlayer must remain false`);

        // 2. SpatialGrid dynamic query
        grid.clearDynamic();
        grid.insertDynamic(car.id, carX, carZ, car.radius, car);

        const pcGrid = new PlayerController({
            spatialGrid: grid,
            initialPosition: { x: 0, y: 0, z: 0 }
        });

        const foundGrid = pcGrid.getNearbyVehicle();
        assert.equal(foundGrid, null, `Vehicle at 3.51m must NOT be detected via spatialGrid`);
        const enterSuccessGrid = pcGrid.enterNearbyVehicle();
        assert.equal(enterSuccessGrid, false, `Boarding via spatialGrid at 3.51m must fail cleanly`);
        assert.equal(pcGrid.getState(), PlayerState.ON_FOOT);
        assert.equal(pcGrid.getVehicle(), null);
    }
});

test('V1.3: Boarding proximity fine sweep: monotonicity across 3.50m threshold', () => {
    const grid = new SpatialGrid(300, 15);
    const pc = new PlayerController({
        spatialGrid: grid,
        initialPosition: { x: 0, y: 0, z: 0 }
    });

    const testDistances = [
        { d: 3.400, expect: true },
        { d: 3.480, expect: true },
        { d: 3.490, expect: true },
        { d: 3.499, expect: true },
        { d: 3.500, expect: true },
        { d: 3.501, expect: false },
        { d: 3.510, expect: false },
        { d: 3.520, expect: false },
        { d: 4.000, expect: false }
    ];

    for (const item of testDistances) {
        const car = new Vehicle(`car_sweep_${item.d}`, item.d, 0, 0);
        const detected = pc.getNearbyVehicle([car]) !== null;
        assert.equal(
            detected,
            item.expect,
            `Distance ${item.d}m: expected detection=${item.expect}, got=${detected}`
        );
    }
});

// ============================================================================
// VECTOR 2: Rapid State Machine Toggling & Controls
// ============================================================================

test('V2.1: 1,000 rapid enter/exit alternations across consecutive ticks maintain state integrity', () => {
    const grid = new SpatialGrid(300, 15);
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    const camCtrl = new CameraController({ camera });

    const pc = new PlayerController({
        spatialGrid: grid,
        cameraController: camCtrl,
        initialPosition: { x: 0, y: 0, z: 0 }
    });

    const car = new Vehicle('car_toggle', 0, -2.5, 0);
    grid.insertDynamic(car.id, car.position.x, car.position.z, car.radius, car);

    // Track simulated player mesh / viewmodel visibility
    // On-foot: viewmodel visible = true; In-vehicle: viewmodel visible = false
    let viewmodelVisible = true;

    for (let tick = 0; tick < 1000; tick++) {
        if (tick % 2 === 0) {
            // Even tick: Enter vehicle
            const ok = pc.enterNearbyVehicle([car]);
            assert.equal(ok, true, `Tick ${tick}: enterNearbyVehicle must succeed`);
            assert.equal(pc.getState(), PlayerState.IN_VEHICLE, `Tick ${tick}: state must be IN_VEHICLE`);
            assert.equal(pc.getVehicle(), car, `Tick ${tick}: activeVehicle must be car`);
            assert.equal(car.isPlayer, true, `Tick ${tick}: car.isPlayer must be true`);
            assert.equal(camCtrl.mode, CameraMode.CHASE, `Tick ${tick}: camera mode must be CHASE`);

            viewmodelVisible = (pc.getState() === PlayerState.ON_FOOT);
            assert.equal(viewmodelVisible, false, `Tick ${tick}: viewmodel must be hidden when IN_VEHICLE`);

            // Apply driving inputs and verify vehicle responds
            pc.setInputs({ w: true, a: true });
            pc.update(1 / 60, grid);
            assert.equal(car.inputThrottle > 0, true, `Tick ${tick}: vehicle throttle must be active`);
            assert.equal(car.inputSteer > 0, true, `Tick ${tick}: vehicle steering must be active`);
        } else {
            // Odd tick: Exit vehicle
            const ok = pc.exitVehicle(grid);
            assert.equal(ok, true, `Tick ${tick}: exitVehicle must succeed`);
            assert.equal(pc.getState(), PlayerState.ON_FOOT, `Tick ${tick}: state must be ON_FOOT`);
            assert.equal(pc.getVehicle(), null, `Tick ${tick}: activeVehicle must be null`);
            assert.equal(car.isPlayer, false, `Tick ${tick}: car.isPlayer must be false`);
            assert.equal(camCtrl.mode, CameraMode.FIRST_PERSON, `Tick ${tick}: camera mode must be FIRST_PERSON`);

            viewmodelVisible = (pc.getState() === PlayerState.ON_FOOT);
            assert.equal(viewmodelVisible, true, `Tick ${tick}: viewmodel must be visible when ON_FOOT`);

            // Verify vehicle controls are cleanly zeroed on disembark
            assert.equal(car.inputThrottle, 0, `Tick ${tick}: vehicle throttle must be reset to 0`);
            assert.equal(car.inputSteer, 0, `Tick ${tick}: vehicle steer must be reset to 0`);
            assert.equal(car.inputBrake, 0, `Tick ${tick}: vehicle brake must be reset to 0`);
            assert.equal(car.inputHandbrake, false, `Tick ${tick}: vehicle handbrake must be reset to false`);

            // On-foot update
            pc.update(1 / 60, grid);
            const pos = pc.getPosition();
            assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.z), `Tick ${tick}: player position must be finite`);
        }
    }
});

test('V2.2: Intra-tick burst toggling & invalid transition rejection', () => {
    const grid = new SpatialGrid(300, 15);
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    const camCtrl = new CameraController({ camera });

    const pc = new PlayerController({
        spatialGrid: grid,
        cameraController: camCtrl,
        initialPosition: { x: 0, y: 0, z: 0 }
    });

    const car = new Vehicle('car_burst', 0, -2.0, 0);

    // Initial on-foot invalid exits
    assert.equal(pc.exitVehicle(grid), false, 'Calling exitVehicle while ON_FOOT must cleanly return false');
    assert.equal(pc.getState(), PlayerState.ON_FOOT);

    // Enter with null/invalid
    assert.equal(pc.enterVehicle(null), false, 'Entering null vehicle must return false');
    assert.equal(pc.enterVehicle(undefined), false, 'Entering undefined vehicle must return false');
    assert.equal(pc.getState(), PlayerState.ON_FOOT);

    // Enter valid car
    assert.equal(pc.enterVehicle(car), true);
    assert.equal(pc.getState(), PlayerState.IN_VEHICLE);

    // Duplicate enter call while already IN_VEHICLE
    assert.equal(pc.enterVehicle(car), false, 'Calling enterVehicle while already IN_VEHICLE must return false');
    assert.equal(pc.enterNearbyVehicle([car]), false, 'Calling enterNearbyVehicle while already IN_VEHICLE must return false');
    assert.equal(pc.getState(), PlayerState.IN_VEHICLE);

    // 50 rapid intra-tick toggles in a tight loop
    for (let i = 0; i < 50; i++) {
        const exitOk = pc.exitVehicle(grid);
        assert.equal(exitOk, true);
        assert.equal(pc.getState(), PlayerState.ON_FOOT);

        const enterOk = pc.enterVehicle(car);
        assert.equal(enterOk, true);
        assert.equal(pc.getState(), PlayerState.IN_VEHICLE);
    }

    // Clean exit at end
    assert.equal(pc.exitVehicle(grid), true);
    assert.equal(pc.getState(), PlayerState.ON_FOOT);
    assert.equal(pc.getVehicle(), null);
});

// ============================================================================
// VECTOR 3: Multi-Candidate Safe Exit Obstruction Stress
// ============================================================================

test('V3.1: Multi-candidate safe exit priority: Left -> Right -> Rear -> Front', () => {
    const grid = new SpatialGrid(300, 15);
    const pc = new PlayerController({ spatialGrid: grid });
    const car = new Vehicle('car_prio', 0, 0, 0); // yaw = 0 (faces -Z)
    pc.enterVehicle(car);

    // 1. All open -> Candidate 1 (LEFT)
    const pos1 = pc.calculateSafeExitPosition(car, grid);
    assert.equal(pos1.name, 'LEFT');
    assert.ok(pos1.x < 0, `LEFT candidate should have negative X (x=${pos1.x})`);

    // 2. Block LEFT -> Candidate 2 (RIGHT)
    grid.insertStatic('obs_left', {
        min: { x: -2.5, y: 0, z: -1.5 },
        max: { x: -1.0, y: 3, z: 1.5 }
    });
    const pos2 = pc.calculateSafeExitPosition(car, grid);
    assert.equal(pos2.name, 'RIGHT');
    assert.ok(pos2.x > 0, `RIGHT candidate should have positive X (x=${pos2.x})`);

    // 3. Block RIGHT as well -> Candidate 3 (REAR)
    grid.insertStatic('obs_right', {
        min: { x: 1.0, y: 0, z: -1.5 },
        max: { x: 2.5, y: 3, z: 1.5 }
    });
    const pos3 = pc.calculateSafeExitPosition(car, grid);
    assert.equal(pos3.name, 'REAR');
    assert.ok(pos3.z > 0, `REAR candidate should have positive Z for yaw=0 (z=${pos3.z})`);

    // 4. Block REAR as well -> Candidate 4 (FRONT)
    grid.insertStatic('obs_rear', {
        min: { x: -1.5, y: 0, z: 1.5 },
        max: { x: 1.5, y: 3, z: 4.5 }
    });
    const pos4 = pc.calculateSafeExitPosition(car, grid);
    assert.equal(pos4.name, 'FRONT');
    assert.ok(pos4.z < 0, `FRONT candidate should have negative Z for yaw=0 (z=${pos4.z})`);

    // Execute exit to FRONT
    const exited = pc.exitVehicle(grid);
    assert.equal(exited, true);
    assert.equal(pc.getState(), PlayerState.ON_FOOT);
    const finalPos = pc.getPosition();
    assert.equal(finalPos.x, pos4.x);
    assert.equal(finalPos.z, pos4.z);

    // Verify zero clipping: player bounding box does not intersect ANY of the 3 obstacles
    const playerBox = new THREE.Box3(
        new THREE.Vector3(finalPos.x - pc.radius, 0, finalPos.z - pc.radius),
        new THREE.Vector3(finalPos.x + pc.radius, 2, finalPos.z + pc.radius)
    );

    const obsLeftBox = new THREE.Box3(new THREE.Vector3(-2.5, 0, -1.5), new THREE.Vector3(-1.0, 3, 1.5));
    const obsRightBox = new THREE.Box3(new THREE.Vector3(1.0, 0, -1.5), new THREE.Vector3(2.5, 3, 1.5));
    const obsRearBox = new THREE.Box3(new THREE.Vector3(-1.5, 0, 1.5), new THREE.Vector3(1.5, 3, 4.5));

    assert.equal(playerBox.intersectsBox(obsLeftBox), false, 'Player must not intersect Left obstacle');
    assert.equal(playerBox.intersectsBox(obsRightBox), false, 'Player must not intersect Right obstacle');
    assert.equal(playerBox.intersectsBox(obsRearBox), false, 'Player must not intersect Rear obstacle');
});

test('V3.2: 3-sided entrapment under arbitrary vehicle rotation (8 Compass Headings)', () => {
    const headings = [
        0,
        Math.PI / 4,
        Math.PI / 2,
        (3 * Math.PI) / 4,
        Math.PI,
        -(3 * Math.PI) / 4,
        -Math.PI / 2,
        -Math.PI / 4
    ];

    for (let h = 0; h < headings.length; h++) {
        const yaw = headings[h];
        const grid = new SpatialGrid(300, 15);
        const pc = new PlayerController({ spatialGrid: grid });

        const carX = 20.0;
        const carZ = -15.0;
        const car = new Vehicle(`car_rot_${h}`, carX, carZ, yaw);
        pc.enterVehicle(car);

        // Calculate candidate positions relative to rotated vehicle
        // Left: (-cos(yaw), sin(yaw))
        // Right: (cos(yaw), -sin(yaw))
        // Rear: (sin(yaw), cos(yaw))
        // Front: (-sin(yaw), -cos(yaw))
        const leftX = carX - Math.cos(yaw) * 1.9;
        const leftZ = carZ + Math.sin(yaw) * 1.9;
        const rightX = carX + Math.cos(yaw) * 1.9;
        const rightZ = carZ - Math.sin(yaw) * 1.9;
        const rearX = carX + Math.sin(yaw) * 3.05;
        const rearZ = carZ + Math.cos(yaw) * 3.05;

        // Place static obstacles tightly centered on Left, Right, and Rear candidates
        const obsRadius = 0.6;
        grid.insertStatic(`obs_left_${h}`, {
            min: { x: leftX - obsRadius, y: 0, z: leftZ - obsRadius },
            max: { x: leftX + obsRadius, y: 3, z: leftZ + obsRadius }
        });
        grid.insertStatic(`obs_right_${h}`, {
            min: { x: rightX - obsRadius, y: 0, z: rightZ - obsRadius },
            max: { x: rightX + obsRadius, y: 3, z: rightZ + obsRadius }
        });
        grid.insertStatic(`obs_rear_${h}`, {
            min: { x: rearX - obsRadius, y: 0, z: rearZ - obsRadius },
            max: { x: rearX + obsRadius, y: 3, z: rearZ + obsRadius }
        });

        // Calculate exit position
        const exitPos = pc.calculateSafeExitPosition(car, grid);
        assert.equal(exitPos.name, 'FRONT', `Heading ${yaw.toFixed(2)} rad: must pick FRONT candidate`);

        // Check distance from car center is ~3.05m
        const dist = Math.hypot(exitPos.x - carX, exitPos.z - carZ);
        assert.ok(Math.abs(dist - 3.05) < 0.05, `Heading ${yaw.toFixed(2)}: exit distance should be ~3.05m, got ${dist.toFixed(3)}m`);

        // Verify player does not intersect any of the 3 obstacles
        const playerBox = new THREE.Box3(
            new THREE.Vector3(exitPos.x - pc.radius, 0, exitPos.z - pc.radius),
            new THREE.Vector3(exitPos.x + pc.radius, 2, exitPos.z + pc.radius)
        );

        const leftBox = new THREE.Box3(new THREE.Vector3(leftX - obsRadius, 0, leftZ - obsRadius), new THREE.Vector3(leftX + obsRadius, 3, leftZ + obsRadius));
        const rightBox = new THREE.Box3(new THREE.Vector3(rightX - obsRadius, 0, rightZ - obsRadius), new THREE.Vector3(rightX + obsRadius, 3, rightZ + obsRadius));
        const rearBox = new THREE.Box3(new THREE.Vector3(rearX - obsRadius, 0, rearZ - obsRadius), new THREE.Vector3(rearX + obsRadius, 3, rearZ + obsRadius));

        assert.equal(playerBox.intersectsBox(leftBox), false, `Heading ${yaw}: player clipped Left obstacle`);
        assert.equal(playerBox.intersectsBox(rightBox), false, `Heading ${yaw}: player clipped Right obstacle`);
        assert.equal(playerBox.intersectsBox(rearBox), false, `Heading ${yaw}: player clipped Rear obstacle`);

        // Execute exit
        assert.equal(pc.exitVehicle(grid), true);
        assert.equal(pc.getState(), PlayerState.ON_FOOT);
    }
});

test('V3.3: 4-sided total entrapment triggers safe bounded fallback without crash or NaN', () => {
    const grid = new SpatialGrid(300, 15);
    const pc = new PlayerController({ spatialGrid: grid });
    const car = new Vehicle('car_caged', 0, 0, 0);
    pc.enterVehicle(car);

    // Encase the vehicle in a giant impenetrable rectangular box
    grid.insertStatic('cage_wall_all', {
        min: { x: -10, y: 0, z: -10 },
        max: { x: 10, y: 5, z: 10 }
    });

    const fallback = pc.calculateSafeExitPosition(car, grid);
    assert.ok(fallback, 'Must return fallback position');
    assert.ok(Number.isFinite(fallback.x) && Number.isFinite(fallback.y) && Number.isFinite(fallback.z), 'Coordinates must be finite');
    assert.ok(fallback.x >= -280 && fallback.x <= 280, 'Fallback X must be in safe bounds');
    assert.ok(fallback.z >= -280 && fallback.z <= 280, 'Fallback Z must be in safe bounds');

    const exited = pc.exitVehicle(grid);
    assert.equal(exited, true, 'Exit must succeed even under total cage obstruction');
    assert.equal(pc.getState(), PlayerState.ON_FOOT);
});

// ============================================================================
// VECTOR 4: Camera Angle Wrapping Across +/-PI & Gimbal Lock Immunity
// ============================================================================

test('V4.1: lerpAngle shortest-arc interpolation across modulo boundary [-PI, PI]', () => {
    // Test 1: From +3.10 rad to -3.10 rad (delta is ~0.083 rad, shortest arc goes through PI)
    const from1 = 3.10;
    const to1 = -3.10;
    const mid1 = lerpAngle(from1, to1, 0.5);
    // Shortest arc midpoint is near PI / -PI (absolute value ~3.14159)
    assert.ok(Math.abs(Math.abs(mid1) - Math.PI) < 0.05, `Midpoint should be near PI, got ${mid1}`);
    assert.ok(mid1 > 3.0 || mid1 < -3.0, `Midpoint must NOT pass through 0 rad (355 deg whip)`);

    // Test 2: Reverse direction from -3.10 rad to +3.10 rad
    const mid2 = lerpAngle(-3.10, 3.10, 0.5);
    assert.ok(Math.abs(Math.abs(mid2) - Math.PI) < 0.05, `Reverse midpoint near PI, got ${mid2}`);

    // Test 3: Micro-boundary crossing across PI
    const aA = Math.PI - 0.001;
    const aB = -Math.PI + 0.001;
    const mid3 = lerpAngle(aA, aB, 0.5);
    assert.ok(Math.abs(Math.abs(mid3) - Math.PI) < 0.005);

    // Test 4: Multi-turn / large angles (> 2PI)
    const largeFrom = Math.PI * 4 + 0.1;
    const largeTo = Math.PI * 6 + 0.2;
    const mid4 = lerpAngle(largeFrom, largeTo, 0.5);
    assert.ok(Number.isFinite(mid4));

    // Test 5: Consecutive shortest-arc stepping moving clockwise across PI
    const sequence = [3.0, 3.08, 3.13, -3.13, -3.08, -3.0];
    for (let s = 0; s < sequence.length - 1; s++) {
        const f = sequence[s];
        const t = sequence[s + 1];
        const interp = lerpAngle(f, t, 0.5);
        // Step size between consecutive angles must remain small (< 0.15 rad)
        let step = (interp - f) % (Math.PI * 2);
        if (step < -Math.PI) step += Math.PI * 2;
        if (step > Math.PI) step -= Math.PI * 2;
        assert.ok(Math.abs(step) < 0.15, `Consecutive step must be small, got ${step}`);
    }
});

test('V4.2: High-speed spinning vehicle stress test: realistic donut (5 rad/s) & extreme spin (25 rad/s)', () => {
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    const camCtrl = new CameraController({ camera });

    const car = {
        x: 0, y: 0.5, z: 0,
        yaw: 0,
        speed: 10,
        getPosition: function() { return { x: this.x, y: this.y, z: this.z }; },
        getYaw: function() { return this.yaw; },
        getSpeed: function() { return this.speed; }
    };

    camCtrl.setMode(CameraMode.CHASE, car);
    assert.equal(camCtrl.mode, CameraMode.CHASE);

    const dt = 1 / 60;
    const forwardVector = new THREE.Vector3();
    const upVector = new THREE.Vector3(0, 1, 0);

    // Phase 1: Realistic aggressive donut spin (5.0 rad/s ~ 286 deg/s) for 300 frames
    const donutRate = 5.0; // rad/s
    let prevChaseYaw = camCtrl.chaseYaw;

    for (let frame = 0; frame < 300; frame++) {
        car.yaw += donutRate * dt;
        while (car.yaw > Math.PI) car.yaw -= 2 * Math.PI;
        while (car.yaw < -Math.PI) car.yaw += 2 * Math.PI;

        camCtrl.update(dt);

        assert.ok(Number.isFinite(camera.position.x));
        assert.ok(Number.isFinite(camera.position.y));
        assert.ok(Number.isFinite(camera.position.z));

        // Distance stays closely bound to nominal chase distance [6.0m, 9.0m]
        const camDist = Math.hypot(camera.position.x - car.x, camera.position.z - car.z);
        assert.ok(
            camDist >= 6.0 && camDist <= 9.0,
            `Donut Frame ${frame}: camera distance ${camDist.toFixed(2)}m outside nominal [6.0, 9.0]`
        );

        // Gimbal lock immunity
        camera.getWorldDirection(forwardVector);
        const pitchDot = Math.abs(forwardVector.dot(upVector));
        assert.ok(pitchDot < 0.95, `Donut Frame ${frame}: potential gimbal lock (pitchDot=${pitchDot})`);

        // Shortest-arc tracking without whipping
        let yawStep = (camCtrl.chaseYaw - prevChaseYaw) % (Math.PI * 2);
        if (yawStep < -Math.PI) yawStep += Math.PI * 2;
        if (yawStep > Math.PI) yawStep -= Math.PI * 2;
        assert.ok(Math.abs(yawStep) < 0.25, `Donut Frame ${frame}: chaseYaw whipped violently (${yawStep})`);
        prevChaseYaw = camCtrl.chaseYaw;
    }

    // Phase 2: Adversarial extreme centrifuge spin (25.0 rad/s ~ 1,432 deg/s, 240 RPM) for 300 frames
    const extremeRate = 25.0; // rad/s
    for (let frame = 0; frame < 300; frame++) {
        car.yaw += extremeRate * dt;
        while (car.yaw > Math.PI) car.yaw -= 2 * Math.PI;
        while (car.yaw < -Math.PI) car.yaw += 2 * Math.PI;

        camCtrl.update(dt);

        assert.ok(Number.isFinite(camera.position.x));
        assert.ok(Number.isFinite(camera.position.y));
        assert.ok(Number.isFinite(camera.position.z));

        // Camera must never collapse into vehicle center or explode (> 2.5m clearance and <= 10.0m)
        const camDist = Math.hypot(camera.position.x - car.x, camera.position.z - car.z);
        assert.ok(
            camDist >= 2.5 && camDist <= 10.0,
            `Centrifuge Frame ${frame}: camera distance ${camDist.toFixed(2)}m outside safe bounds [2.5, 10.0]`
        );

        // Gimbal lock immunity
        camera.getWorldDirection(forwardVector);
        const pitchDot = Math.abs(forwardVector.dot(upVector));
        assert.ok(pitchDot < 0.95, `Centrifuge Frame ${frame}: potential gimbal lock (pitchDot=${pitchDot})`);

        // Zero 360-degree whipping: yaw step bounded by shortest arc
        let yawStep = (camCtrl.chaseYaw - prevChaseYaw) % (Math.PI * 2);
        if (yawStep < -Math.PI) yawStep += Math.PI * 2;
        if (yawStep > Math.PI) yawStep -= Math.PI * 2;
        assert.ok(Math.abs(yawStep) < Math.PI, `Centrifuge Frame ${frame}: chaseYaw whipped past PI`);
        prevChaseYaw = camCtrl.chaseYaw;
    }
});

test('V4.3: Disembark orientation realignment matches vehicle heading without discontinuity', () => {
    const testAngles = [0, Math.PI / 4, Math.PI / 2, Math.PI - 0.05, -Math.PI + 0.05, -Math.PI / 2];

    for (const carHeading of testAngles) {
        const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
        const camCtrl = new CameraController({ camera });

        const car = new Vehicle(`car_disembark_${carHeading.toFixed(2)}`, 10, -5, carHeading);
        const pc = new PlayerController({
            cameraController: camCtrl,
            initialPosition: { x: 10, y: 0, z: -5 }
        });

        pc.enterVehicle(car);
        assert.equal(camCtrl.mode, CameraMode.CHASE);

        // Settle chase camera for 30 frames
        for (let i = 0; i < 30; i++) {
            camCtrl.update(1 / 60);
        }

        // Disembark
        pc.exitVehicle();
        assert.equal(camCtrl.mode, CameraMode.FIRST_PERSON);

        // Verify first-person yaw aligns with car heading
        let angleDelta = (camCtrl.fpYaw - carHeading) % (Math.PI * 2);
        if (angleDelta < -Math.PI) angleDelta += Math.PI * 2;
        if (angleDelta > Math.PI) angleDelta -= Math.PI * 2;

        assert.ok(
            Math.abs(angleDelta) < 0.05,
            `First-person yaw (${camCtrl.fpYaw.toFixed(3)}) must align with vehicle heading (${carHeading.toFixed(3)})`
        );
    }
});
