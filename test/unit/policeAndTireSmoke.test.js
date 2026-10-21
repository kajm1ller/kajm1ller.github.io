import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Vehicle } from '../../js/game/vehicle.js';
import { SpatialGrid } from '../../js/game/spatialGrid.js';
import { RoadNetwork } from '../../js/game/roadNetwork.js';
import { TireSmokeSystem } from '../../js/game/tireSmoke.js';
import { PoliceSystem, PoliceVehicle, PoliceSirenAudio } from '../../js/game/police.js';

test('TireSmokeSystem: Initialization and pool management', () => {
    const scene = new THREE.Scene();
    const smokeSystem = new TireSmokeSystem(scene, 40);

    assert.equal(smokeSystem.pool.length, 40);
    assert.equal(smokeSystem.getActiveCount(), 0);
    assert.equal(smokeSystem.totalSpawned, 0);
    assert.equal(smokeSystem.isEmitting, false);

    // Initial particles must be hidden in scene
    for (const p of smokeSystem.pool) {
        assert.equal(p.active, false);
        assert.equal(p.mesh.visible, false);
    }
});

test('TireSmokeSystem: Emits smoke puffs when car drifts with space', () => {
    const scene = new THREE.Scene();
    const smokeSystem = new TireSmokeSystem(scene, 40);
    const vehicle = new Vehicle('drift_civic', 0, 0, 0);

    // Car moving at 12 m/s with space (handbrake) active
    vehicle.speed = 12.0;
    vehicle.velocity.set(0, -12.0);

    // Run 10 ticks with isSpacePressed = true
    for (let i = 0; i < 10; i++) {
        smokeSystem.update(1 / 60, vehicle, true);
    }

    assert.equal(smokeSystem.isEmitting, true);
    assert(smokeSystem.getActiveCount() > 0, `Expected active smoke particles, got ${smokeSystem.getActiveCount()}`);
    assert(smokeSystem.totalSpawned >= 2, `Expected at least 2 puffs spawned, got ${smokeSystem.totalSpawned}`);

    // Verify particle physical properties
    const active = smokeSystem.getActiveParticles();
    for (const p of active) {
        assert(p.mesh.visible, 'Active particle must be visible');
        assert(p.mesh.material.opacity > 0, 'Particle must have non-zero opacity');
        assert(p.velocity.y > 0, 'Smoke must have upward vertical drift velocity');
    }

    // Stop car and release space
    vehicle.speed = 0;
    vehicle.velocity.set(0, 0);

    // Update for 60 ticks so particles expire
    for (let i = 0; i < 60; i++) {
        smokeSystem.update(1 / 60, vehicle, false);
    }

    assert.equal(smokeSystem.isEmitting, false);
    assert.equal(smokeSystem.getActiveCount(), 0, 'Smoke particles must dissipate after lifetime expires');

    // Test reset
    smokeSystem.reset();
    assert.equal(smokeSystem.totalSpawned, 0);
    assert.equal(smokeSystem.getActiveCount(), 0);
});

test('PoliceVehicle: Hierarchy, aesthetics, and pursuit AI', () => {
    const scene = new THREE.Scene();
    const pCar = new PoliceVehicle('police_test', 0, 50, 0, scene);

    assert.equal(pCar.id, 'police_test');
    assert.equal(pCar.isPolice, true);
    assert.equal(pCar.isPlayer, false);

    // Check lightbar & decals
    assert(pCar.lightbarGroup !== null, 'Police car must have lightbarGroup');
    assert(pCar.redBeacon !== null, 'Lightbar must have red beacon');
    assert(pCar.blueBeacon !== null, 'Lightbar must have blue beacon');

    const mesh = pCar.getMesh();
    assert(mesh.getObjectByName('police_door_left') !== null, 'Must have left police door decal');
    assert(mesh.getObjectByName('police_door_right') !== null, 'Must have right police door decal');
    assert(mesh.getObjectByName('police_push_bumper') !== null, 'Must have push bumper');

    // Test strobe flashing
    pCar.updateStrobes(0.2);
    assert(pCar.strobeTime > 0);

    // Test pursuit steering towards target at (20, 0)
    const targetPos = { x: 20, z: 0 };
    const grid = new SpatialGrid();
    const roadNetwork = new RoadNetwork();

    const startZ = pCar.position.z;
    pCar.updateAI(1 / 60, targetPos, false, grid, roadNetwork);

    assert(pCar.speed > 0 || pCar.inputThrottle > 0, 'Police car must accelerate towards target');
});

test('PoliceSystem: Crime reporting, wanted stars, and dispatch', () => {
    const scene = new THREE.Scene();
    const grid = new SpatialGrid();
    const roadNetwork = new RoadNetwork();
    const policeSys = new PoliceSystem(scene, grid, roadNetwork, null);

    assert.equal(policeSys.wantedLevel, 0);
    assert.equal(policeSys.policeCars.length, 0);

    // Report Crime 1: Shooting
    policeSys.triggerCrime('shooting', { x: 10, y: 0, z: 10 });
    assert.equal(policeSys.wantedLevel, 1, 'Wanted level should be 1 after shooting');
    assert.equal(policeSys.lastCrimeType, 'shooting');
    assert.equal(policeSys.policeCars.length, 1, 'One police car dispatched for wanted level 1');

    const firstCar = policeSys.policeCars[0];
    assert.equal(firstCar.isPolice, true);

    // Report Crime 2: Vehicular Homicide
    policeSys.triggerCrime('vehicular_homicide', { x: 15, y: 0, z: 15 });
    assert.equal(policeSys.wantedLevel, 2, 'Wanted level should increase to 2');
    assert.equal(policeSys.lastCrimeType, 'vehicular_homicide');

    // Test simulation update
    policeSys.update(1 / 60, { x: 0, y: 0, z: 0 }, false, grid, roadNetwork, new THREE.Vector3(0, 2, 0));

    // Clear wanted level
    policeSys.clearWantedLevel();
    assert.equal(policeSys.wantedLevel, 0);
    assert.equal(policeSys.policeCars.length, 0, 'Police cars must despawn on clear');
});
