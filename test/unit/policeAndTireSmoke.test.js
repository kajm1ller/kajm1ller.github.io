import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Vehicle } from '../../js/game/vehicle.js';
import { SpatialGrid } from '../../js/game/spatialGrid.js';
import { RoadNetwork } from '../../js/game/roadNetwork.js';
import { TireSmokeSystem } from '../../js/game/tireSmoke.js';
import { PoliceSystem, PoliceVehicle, PoliceOfficer, PoliceSirenAudio } from '../../js/game/police.js';

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

test('PoliceOfficer: Armed NPC mesh hierarchy, pursuit, and gun firing', () => {
    const scene = new THREE.Scene();
    const officer = new PoliceOfficer('officer_test', 10, 10, 0, scene);

    assert.equal(officer.id, 'officer_test');
    assert.equal(officer.isPoliceOfficer, true);
    assert.equal(officer.isDead, false);
    assert.equal(officer.hp, 100);

    // Verify armed mesh components: peaked cap, badge, drawn service pistol
    const mesh = officer.mesh;
    assert(mesh.getObjectByName('officer_pistol') !== null, 'Police officer must have service pistol');
    assert(mesh.userData.leftLeg !== undefined, 'Officer must have animated left leg');
    assert(mesh.userData.rightLeg !== undefined, 'Officer must have animated right leg');

    // Test pursuit update and shooting callback
    let shotFired = false;
    officer.shootCooldown = 0; // Trigger shot on next update
    officer.update(1 / 60, { x: 0, y: 0, z: 0 }, false, scene, () => {
        shotFired = true;
    });

    assert.equal(shotFired, true, 'Police officer must fire weapon at player within range');
    assert(officer.shootCooldown > 0, 'Shoot cooldown must be reset after firing');
});

test('PoliceSystem: Killing police officers increases wanted stars', () => {
    const scene = new THREE.Scene();
    const grid = new SpatialGrid();
    const roadNetwork = new RoadNetwork();
    const policeSys = new PoliceSystem(scene, grid, roadNetwork, null);

    policeSys.setWantedLevel(1);
    assert.equal(policeSys.wantedLevel, 1);

    // Spawn an armed officer
    const officer1 = policeSys.spawnOfficer({ x: 5, z: 5, yaw: 0 });
    assert.equal(policeSys.officers.length, 1);
    assert.equal(officer1.isDead, false);

    // KILL OFFICER 1 -> Wanted level must increase from 1 to 2
    let bloodPoolCreated = false;
    policeSys.createBloodPoolCallback = () => { bloodPoolCreated = true; };

    const killed1 = policeSys.killOfficer(officer1);
    assert.equal(killed1, true);
    assert.equal(officer1.isDead, true);
    assert.equal(officer1.state, 'dead');
    assert.equal(policeSys.wantedLevel, 2, 'Killing police officer must increase wanted stars to 2');
    assert.equal(bloodPoolCreated, true, 'Blood pool must be spawned for dead officer');

    // Spawn officer 2 and kill them -> Wanted level must increase from 2 to 3
    const officer2 = policeSys.spawnOfficer({ x: 8, z: 8, yaw: 0 });
    const killed2 = policeSys.killOfficer(officer2);
    assert.equal(killed2, true);
    assert.equal(policeSys.wantedLevel, 3, 'Killing second police officer must increase wanted stars to 3');
});

test('Police hold you at gunpoint: no shooting until you shoot, no running you over on foot', () => {
    const scene = new THREE.Scene();
    const officer = new PoliceOfficer('officer_hold', 0, 20, 0, scene);
    let shots = 0;
    for (let i = 0; i < 600; i++) officer.update(1 / 60, { x: 0, y: 0, z: 0 }, false, scene, () => shots++, { weaponsFree: false, arrest: false });
    assert.equal(shots, 0, 'holds fire');
    const d = Math.hypot(officer.position.x, officer.position.z);
    assert.ok(d > 6 && d < 9, `stops a few metres off (${d.toFixed(2)})`);
    for (let i = 0; i < 300; i++) officer.update(1 / 60, { x: 0, y: 0, z: 0 }, false, scene, () => shots++, { weaponsFree: true, arrest: false });
    assert.ok(shots > 0, 'shoots back once fired on');

    const sys = new PoliceSystem(scene, new SpatialGrid(), new RoadNetwork(), null);
    sys.playerFired();
    assert.ok(!sys.weaponsFree, 'nothing to shoot back with when nobody is after you');
    sys.triggerCrime('shooting', { x: 0, y: 0, z: 0 });
    sys.playerFired();
    assert.ok(sys.weaponsFree);
    sys.clearWantedLevel();
    assert.ok(!sys.weaponsFree);

    // A cruiser coming at someone on foot pulls up short
    const car = new PoliceVehicle('police_stop', 0, 60, 0, scene);
    const grid = new SpatialGrid(), roads = new RoadNetwork();
    let closest = Infinity;
    for (let i = 0; i < 60 * 12; i++) {
        car.updateAI(1 / 60, { x: 0, z: 0 }, false, grid, roads);
        closest = Math.min(closest, Math.hypot(car.position.x, car.position.z));
    }
    assert.ok(closest > 6, `never runs them down (closest ${closest.toFixed(1)} m)`);
});
