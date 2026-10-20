/**
 * test/unit/playerDisembarkStress.test.js
 * 
 * Milestone 2 Adversarial Stress Verification:
 * Player Disembark Sustained RAF & Timing Stress Harness.
 * 
 * Vectors Challenged:
 * 1. Sustained Simulation Step Stability: Samples player position over 30, 60, 120, 300, and 1,000 steps.
 * 2. Collapse & Clipping Safeguard: Verifies player distance to vehicle never collapses to 0.00m and never intersects vehicle bounding circles.
 * 3. Moving Vehicle Disembarkation (Forward): Tests disembarkation at 5 m/s, 15 m/s, and maximum velocity (28 m/s).
 * 4. Moving Vehicle Disembarkation (Reverse): Tests disembarkation at -3 m/s, -6 m/s, and -9 m/s.
 * 5. Turning Vehicle Disembarkation: Tests disembarkation while turning hard left/right across all quadrants.
 * 6. Repeated High-Speed Drive-and-Exit Cycles: 100 consecutive cycles without state corruption or positional drift.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlayerController, PlayerState } from '../../js/game/player.js';
import { SpatialGrid } from '../../js/game/spatialGrid.js';
import { Vehicle } from '../../js/game/vehicle.js';
import { CONFIG } from '../../js/game/config.js';

function createMockCamera() {
    return {
        position: new THREE.Vector3(0, 1.7, 0),
        quaternion: new THREE.Quaternion(),
        lookAt: () => {}
    };
}

function createMockCameraController() {
    return {
        mode: 'FIRST_PERSON',
        target: null,
        setMode(mode, target) {
            this.mode = mode;
            this.target = target;
        },
        update() {}
    };
}

// ============================================================================
// VECTOR 1: Sustained Simulation Steps Stability (30, 60, 120, 300, 1000 steps)
// ============================================================================

test('V1: Sustained Simulation Steps: Player position sampled at 30, 60, 120, 300, and 1000 steps never collapses to 0.00m', () => {
    const grid = new SpatialGrid(300, 15);
    const camera = createMockCamera();
    const cameraController = createMockCameraController();
    const myPosition = new THREE.Vector3(0, 0, 0);

    const pc = new PlayerController({
        camera,
        cameraController,
        spatialGrid: grid,
        initialPosition: myPosition,
        playerPosition: myPosition,
        onExit: (pos) => {
            myPosition.copy(pos);
            camera.position.set(pos.x, pos.y + 1.7, pos.z);
        }
    });

    // Curbside vehicle at (0, 0, -3.0)
    const vehicle = new Vehicle('test_vehicle_1', 0, -3.0, 0);
    grid.insertDynamic(vehicle.id, 0, -3.0, vehicle.radius, vehicle);

    // 1. Board vehicle
    const entered = pc.enterVehicle(vehicle);
    assert.equal(entered, true, 'Vehicle boarding must succeed');
    assert.equal(pc.getState(), PlayerState.IN_VEHICLE);

    // 2. Drive vehicle forward for 60 ticks
    pc.setInputs({ w: true });
    for (let i = 0; i < 60; i++) {
        pc.update(1 / 60, grid);
        vehicle.update(1 / 60, grid);
        myPosition.set(vehicle.position.x, vehicle.position.y, vehicle.position.z);
    }
    pc.setInputs({ w: false });

    const drivePos = vehicle.getPosition();
    assert.ok(Math.abs(drivePos.z - (-3.0)) > 2.0, `Vehicle should have moved from initial position (z: ${drivePos.z})`);

    // 3. Disembark
    const exited = pc.exitVehicle(grid);
    assert.equal(exited, true, 'Disembarkation must succeed');
    assert.equal(pc.getState(), PlayerState.ON_FOOT);
    assert.equal(pc.getVehicle(), null);

    const vPosExit = vehicle.getPosition();
    const pPosInitial = pc.getPosition();

    // Verify initial exit distance is safe (~1.9m)
    const initialDist = Math.hypot(pPosInitial.x - vPosExit.x, pPosInitial.z - vPosExit.z);
    assert.ok(initialDist >= 0.5 && initialDist <= 5.0, `Initial exit distance must be 0.5m-5.0m, was ${initialDist.toFixed(3)}m`);
    assert.ok(myPosition.distanceTo(pc.position) < 0.001, 'myPosition must match pc.position immediately upon exit');

    // Sample intervals
    const sampleCheckpoints = [30, 60, 120, 300, 1000];
    let stepCount = 0;

    for (const checkpoint of sampleCheckpoints) {
        while (stepCount < checkpoint) {
            // Emulate game.html on-foot fixed loop
            pc.update(1 / 60, grid);
            stepCount++;
        }

        const pPosSample = pc.getPosition();
        const distSample = Math.hypot(pPosSample.x - vPosExit.x, pPosSample.z - vPosExit.z);

        // Assert distance never collapses to 0.00m
        assert.ok(distSample > 0.5, `Distance at step ${checkpoint} must not collapse to 0.00m (was ${distSample.toFixed(3)}m)`);
        assert.ok(distSample <= 5.0, `Distance at step ${checkpoint} must remain within safe range (was ${distSample.toFixed(3)}m)`);
        assert.equal(Number.isFinite(pPosSample.x), true, `pc.x at step ${checkpoint} must be finite`);
        assert.equal(Number.isFinite(pPosSample.y), true, `pc.y at step ${checkpoint} must be finite`);
        assert.equal(Number.isFinite(pPosSample.z), true, `pc.z at step ${checkpoint} must be finite`);
        assert.equal(Number.isFinite(myPosition.x), true, `myPosition.x at step ${checkpoint} must be finite`);
        assert.equal(Number.isFinite(myPosition.z), true, `myPosition.z at step ${checkpoint} must be finite`);
        assert.ok(myPosition.distanceTo(pc.position) < 0.001, `myPosition must stay in sync with pc.position at step ${checkpoint}`);
    }
});

// ============================================================================
// VECTOR 2: Vehicle-Player Clipping & Bounding Circle Penetration Safeguard
// ============================================================================

test('V2: Bounding Circle Clearance: Player bounding radius never overlaps vehicle bounding circles upon exit', () => {
    const grid = new SpatialGrid(300, 15);
    const camera = createMockCamera();
    const myPosition = new THREE.Vector3(0, 0, 0);

    // Test across 16 different vehicle orientations (full 360 degree compass sweep)
    for (let i = 0; i < 16; i++) {
        const yaw = (i / 16) * Math.PI * 2 - Math.PI;
        const vehicle = new Vehicle(`veh_clearance_${i}`, 10 * Math.cos(yaw), 10 * Math.sin(yaw), yaw);

        const pc = new PlayerController({
            camera,
            spatialGrid: grid,
            initialPosition: myPosition,
            playerPosition: myPosition
        });

        pc.enterVehicle(vehicle);
        pc.exitVehicle(grid);

        const pPos = pc.getPosition();
        const playerRadius = pc.radius; // 0.4m

        // Check against all 3 vehicle bounding circles
        const circles = vehicle.getBoundingCircles();
        assert.equal(circles.length, 3, 'Vehicle must have 3 collision bounding circles');

        for (const c of circles) {
            const dist = Math.hypot(pPos.x - c.x, pPos.z - c.z);
            const minSeparation = playerRadius + c.radius;
            assert.ok(
                dist >= minSeparation - 0.05,
                `Player at (${pPos.x.toFixed(2)}, ${pPos.z.toFixed(2)}) must not penetrate circle at (${c.x.toFixed(2)}, ${c.z.toFixed(2)}), dist=${dist.toFixed(3)}m, minSep=${minSeparation.toFixed(3)}m`
            );
        }
    }
});

// ============================================================================
// VECTOR 3: Disembarkation at Non-Zero Forward Velocity (5 m/s, 15 m/s, 28 m/s)
// ============================================================================

test('V3: Moving Exit (Forward Speeds: 5 m/s, 15 m/s, 28 m/s): Player exits to safe offset without NaN/Infinite state', () => {
    const testSpeeds = [5.0, 15.0, 28.0];

    for (const targetSpeed of testSpeeds) {
        const grid = new SpatialGrid(300, 15);
        const camera = createMockCamera();
        const myPosition = new THREE.Vector3(0, 0, 0);

        const pc = new PlayerController({
            camera,
            spatialGrid: grid,
            initialPosition: myPosition,
            playerPosition: myPosition,
            onExit: (pos) => myPosition.copy(pos)
        });

        const vehicle = new Vehicle(`veh_fwd_${targetSpeed}`, 0, 0, 0);
        pc.enterVehicle(vehicle);

        // Accelerate to target speed
        vehicle.speed = targetSpeed;
        vehicle.velocity.set(-Math.sin(vehicle.yaw) * targetSpeed, -Math.cos(vehicle.yaw) * targetSpeed);

        assert.equal(vehicle.getSpeed(), targetSpeed);
        assert.ok(Math.abs(vehicle.getVelocity().z) > 0);

        // Disembark while at target speed
        const exited = pc.exitVehicle(grid);
        assert.equal(exited, true, `Exit at forward speed ${targetSpeed} m/s must succeed`);
        assert.equal(pc.getState(), PlayerState.ON_FOOT);

        const vPos = vehicle.getPosition();
        const pPos = pc.getPosition();

        // 1. Coordinates must be finite
        assert.equal(Number.isFinite(pPos.x), true, 'Player X must be finite');
        assert.equal(Number.isFinite(pPos.y), true, 'Player Y must be finite');
        assert.equal(Number.isFinite(pPos.z), true, 'Player Z must be finite');

        // 2. Safe distance offset (0.5m - 5.0m)
        const dist = Math.hypot(pPos.x - vPos.x, pPos.z - vPos.z);
        assert.ok(dist >= 0.5 && dist <= 5.0, `Disembark distance at ${targetSpeed} m/s must be 0.5m-5.0m, was ${dist.toFixed(3)}m`);

        // 3. Simulate 60 steps following moving exit
        for (let step = 0; step < 60; step++) {
            vehicle.update(1 / 60, grid); // Vehicle coasts
            pc.update(1 / 60, grid);      // Player remains on foot
        }

        const pPosAfter = pc.getPosition();
        assert.equal(Number.isFinite(pPosAfter.x), true, 'Player X after 60 steps must be finite');
        assert.equal(Number.isFinite(pPosAfter.z), true, 'Player Z after 60 steps must be finite');
        assert.equal(Number.isFinite(vehicle.getPosition().x), true, 'Vehicle X must be finite');
        assert.equal(Number.isFinite(vehicle.getPosition().z), true, 'Vehicle Z must be finite');

        // Verify player did not get dragged or flung to infinity
        assert.ok(Math.abs(pPosAfter.x - pPos.x) < 0.001, 'Player should remain stationary on foot without input');
        assert.ok(Math.abs(pPosAfter.z - pPos.z) < 0.001, 'Player should remain stationary on foot without input');
    }
});

// ============================================================================
// VECTOR 4: Disembarkation at Non-Zero Reverse Velocity (-3 m/s, -6 m/s, -9 m/s)
// ============================================================================

test('V4: Moving Exit (Reverse Speeds: -3 m/s, -6 m/s, -9 m/s): Player exits to safe offset without NaN/Infinite state', () => {
    const reverseSpeeds = [-3.0, -6.0, -9.0];

    for (const targetSpeed of reverseSpeeds) {
        const grid = new SpatialGrid(300, 15);
        const camera = createMockCamera();
        const myPosition = new THREE.Vector3(0, 0, 0);

        const pc = new PlayerController({
            camera,
            spatialGrid: grid,
            initialPosition: myPosition,
            playerPosition: myPosition,
            onExit: (pos) => myPosition.copy(pos)
        });

        const vehicle = new Vehicle(`veh_rev_${Math.abs(targetSpeed)}`, 0, 0, 0);
        pc.enterVehicle(vehicle);

        // Set reverse speed
        vehicle.speed = targetSpeed;
        vehicle.velocity.set(-Math.sin(vehicle.yaw) * targetSpeed, -Math.cos(vehicle.yaw) * targetSpeed);

        const exited = pc.exitVehicle(grid);
        assert.equal(exited, true, `Exit at reverse speed ${targetSpeed} m/s must succeed`);

        const vPos = vehicle.getPosition();
        const pPos = pc.getPosition();

        assert.equal(Number.isFinite(pPos.x), true);
        assert.equal(Number.isFinite(pPos.z), true);

        const dist = Math.hypot(pPos.x - vPos.x, pPos.z - vPos.z);
        assert.ok(dist >= 0.5 && dist <= 5.0, `Disembark distance at ${targetSpeed} m/s was ${dist.toFixed(3)}m`);

        // Simulate 60 steps
        for (let step = 0; step < 60; step++) {
            vehicle.update(1 / 60, grid);
            pc.update(1 / 60, grid);
        }

        assert.equal(Number.isFinite(pc.getPosition().x), true);
        assert.equal(Number.isFinite(pc.getPosition().z), true);
        assert.equal(Number.isFinite(vehicle.getPosition().x), true);
        assert.equal(Number.isFinite(vehicle.getPosition().z), true);
    }
});

// ============================================================================
// VECTOR 5: Disembarkation while Turning / High Angular Velocity
// ============================================================================

test('V5: Turning Exit: Disembarkation during active steering turn across all 4 quadrants maintains safe offset & finite pose', () => {
    const steerDirections = [
        { steer: { left: true, right: false }, desc: 'Hard Left' },
        { steer: { left: false, right: true }, desc: 'Hard Right' }
    ];

    for (const { steer, desc } of steerDirections) {
        for (let runTicks = 15; runTicks <= 90; runTicks += 25) {
            const grid = new SpatialGrid(300, 15);
            const camera = createMockCamera();
            const myPosition = new THREE.Vector3(0, 0, 0);

            const pc = new PlayerController({
                camera,
                spatialGrid: grid,
                initialPosition: myPosition,
                playerPosition: myPosition,
                onExit: (pos) => myPosition.copy(pos)
            });

            const vehicle = new Vehicle(`veh_turn_${desc}_${runTicks}`, 0, 0, 0);
            pc.enterVehicle(vehicle);

            // Drive and steer into turn
            pc.setInputs({ w: true, a: steer.left, d: steer.right });
            for (let t = 0; t < runTicks; t++) {
                pc.update(1 / 60, grid);
                vehicle.update(1 / 60, grid);
            }
            pc.setInputs({ w: false, a: false, d: false });

            const currentYaw = vehicle.getYaw();
            const currentSpeed = vehicle.getSpeed();
            assert.ok(currentSpeed > 1.0, 'Vehicle must be moving during turn');

            // Disembark mid-turn
            const exited = pc.exitVehicle(grid);
            assert.equal(exited, true, `Exit during ${desc} turn at tick ${runTicks} must succeed`);

            const pPos = pc.getPosition();
            const vPos = vehicle.getPosition();

            // Assert finite state
            assert.equal(Number.isFinite(pPos.x), true, 'pPos.x must be finite');
            assert.equal(Number.isFinite(pPos.y), true, 'pPos.y must be finite');
            assert.equal(Number.isFinite(pPos.z), true, 'pPos.z must be finite');

            // Assert safe distance
            const dist = Math.hypot(pPos.x - vPos.x, pPos.z - vPos.z);
            assert.ok(
                dist >= 0.5 && dist <= 5.0,
                `Disembark distance during ${desc} turn (yaw: ${currentYaw.toFixed(2)}, speed: ${currentSpeed.toFixed(1)}) must be 0.5m-5.0m, was ${dist.toFixed(3)}m`
            );

            // Check non-overlap with vehicle circles
            const circles = vehicle.getBoundingCircles();
            for (const c of circles) {
                const cDist = Math.hypot(pPos.x - c.x, pPos.z - c.z);
                assert.ok(
                    cDist >= pc.radius + c.radius - 0.05,
                    `Player must not penetrate vehicle circle during ${desc} turn`
                );
            }

            // Simulate 60 steps following disembarkation
            for (let step = 0; step < 60; step++) {
                vehicle.update(1 / 60, grid);
                pc.update(1 / 60, grid);
            }

            assert.equal(Number.isFinite(pc.getPosition().x), true);
            assert.equal(Number.isFinite(pc.getPosition().z), true);
        }
    }
});

// ============================================================================
// VECTOR 6: 100 Consecutive Drive-and-Exit Cycles with Random Speed & Steer
// ============================================================================

test('V6: 100 Consecutive Drive-and-Exit Cycles: Zero collapse to 0.00m, zero NaN/Infinite state', () => {
    const grid = new SpatialGrid(300, 15);
    const camera = createMockCamera();
    const myPosition = new THREE.Vector3(0, 0, 0);

    const pc = new PlayerController({
        camera,
        spatialGrid: grid,
        initialPosition: myPosition,
        playerPosition: myPosition,
        onExit: (pos) => myPosition.copy(pos)
    });

    const vehicle = new Vehicle('veh_cycle_stress', 0, 0, 0);
    grid.insertDynamic(vehicle.id, 0, 0, vehicle.radius, vehicle);

    for (let cycle = 0; cycle < 100; cycle++) {
        // Teleport player near vehicle to simulate re-boarding
        const vPos = vehicle.getPosition();
        pc.position.set(vPos.x, 0, vPos.z);
        myPosition.set(vPos.x, 0, vPos.z);

        const entered = pc.enterVehicle(vehicle);
        assert.equal(entered, true, `Cycle ${cycle}: Boarding must succeed`);

        // Drive with varying throttle & steer for 10-30 ticks
        const ticks = 10 + (cycle % 20);
        const steerDir = (cycle % 3 === 0) ? { left: true, right: false } : (cycle % 3 === 1) ? { left: false, right: true } : { left: false, right: false };
        const throttle = (cycle % 5 === 0) ? 0.5 : 1.0;

        pc.setInputs({ w: throttle > 0, a: steerDir.left, d: steerDir.right });
        for (let t = 0; t < ticks; t++) {
            pc.update(1 / 60, grid);
            vehicle.update(1 / 60, grid);
        }
        pc.setInputs({ w: false, a: false, d: false });

        // Exit mid-stride
        const exited = pc.exitVehicle(grid);
        assert.equal(exited, true, `Cycle ${cycle}: Exit must succeed`);

        const pPos = pc.getPosition();
        const curVPos = vehicle.getPosition();
        const dist = Math.hypot(pPos.x - curVPos.x, pPos.z - curVPos.z);

        assert.ok(dist >= 0.5 && dist <= 5.0, `Cycle ${cycle}: Disembark distance must be 0.5m-5.0m, was ${dist.toFixed(3)}m`);
        assert.equal(Number.isFinite(pPos.x), true, `Cycle ${cycle}: pPos.x must be finite`);
        assert.equal(Number.isFinite(pPos.z), true, `Cycle ${cycle}: pPos.z must be finite`);
        assert.ok(myPosition.distanceTo(pc.position) < 0.001, `Cycle ${cycle}: myPosition must match pc.position`);

        // Step 10 ticks on foot
        for (let s = 0; s < 10; s++) {
            pc.update(1 / 60, grid);
        }
        assert.ok(myPosition.distanceTo(pc.position) < 0.001, `Cycle ${cycle}: myPosition must remain in sync after ticks`);
    }
});
