import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
    CAR_MODEL_IDS, CAR_MODELS, getCarModel, buildCarMesh, getModelGeometry, getWindowFrames,
    getFleetGeometry, pickCarModel, pickCarColor, pointInPoly, cabinShape
} from '../../js/game/carModels.js';
import { Vehicle } from '../../js/game/vehicle.js';
import { InstancedVehicleFleet } from '../../js/game/instancedFleet.js';

function allFinite(geo) {
    const a = geo.attributes.position.array;
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
    return true;
}

test('Car models: every model builds a complete, finite car mesh', () => {
    assert(CAR_MODEL_IDS.length >= 8, 'catalog has a range of models');
    for (const id of CAR_MODEL_IDS) {
        const { root, wheels, wheelPivots, leftDoorPivot, cabinAnchor } = buildCarMesh(id, 0x336699, 'test');
        for (const name of ['sedan_body', 'cabin_roof', 'windshield', 'rear_glass', 'left_window_glass', 'right_window_glass',
            'headlight_left', 'headlight_right', 'taillight_left', 'taillight_right', 'driver_door_panel']) {
            assert(root.getObjectByName(name), `${id}: mesh has ${name}`);
        }
        assert.equal(Object.keys(wheels).length, 4, `${id}: four wheels`);
        assert(wheelPivots.frontLeft && wheelPivots.frontRight, `${id}: steerable front wheels`);
        assert(leftDoorPivot && cabinAnchor, `${id}: door pivot and cabin anchor`);
        root.traverse((o) => {
            if (o.isMesh) assert(allFinite(o.geometry), `${id}: ${o.name} has finite vertices`);
        });
        const fleet = getFleetGeometry(id);
        assert(fleet.body && allFinite(fleet.body), `${id}: fleet batch`);
        assert.equal(fleet.body.attributes.paintMask.count, fleet.body.attributes.position.count, `${id}: paint mask per vertex`);
        assert(fleet.glass && allFinite(fleet.glass), `${id}: fleet glass batch`);
    }
});

test('Car models: glass panes sit inside the greenhouse, above the beltline and inside the body', () => {
    for (const id of CAR_MODEL_IDS) {
        const m = getCarModel(id);
        const G = getModelGeometry(id);
        for (const pane of G.glass) {
            const p = pane.position;
            assert(p.y > m.cabin.belt && p.y < m.cabin.roof, `${id}: ${pane.name} between belt and roof`);
            assert(Math.abs(p.z) < m.length / 2 && Math.abs(p.x) < m.width / 2, `${id}: ${pane.name} within the body`);
        }
        const ws = G.glass.find((g) => g.name === 'windshield').position;
        const rg = G.glass.find((g) => g.name === 'rear_glass').position;
        assert(ws.z < rg.z, `${id}: windshield ahead of the rear glass`);
    }
});

test('Car models: a ray into the middle of each pane lands inside its outline', () => {
    for (const id of CAR_MODEL_IDS) {
        const frames = getWindowFrames(id);
        for (const type of ['front', 'back', 'left', 'right']) assert(frames[type], `${id}: ${type} window frame`);
        // Every pane can be shot out, the rear quarter glass included
        const panes = getModelGeometry(id).glass.map((p) => p.name);
        assert.deepEqual(Object.values(frames).map((w) => w.glass).sort(), panes.slice().sort(), `${id}: every pane has a hit frame`);
        for (const type in frames) {
            const w = frames[type];
            // Outward normal really points away from the car's centre line
            const c = w.center;
            const outward = type === 'front' || type.startsWith('left') ? -1 : 1;
            const axis = type === 'front' || type === 'back' ? w.N.z : w.N.x;
            assert(Math.sign(axis) === Math.sign(outward), `${id}: ${type} normal points out of the car`);
            // (a quarter pane can be a thin triangle whose bounding-box centre is off the glass)
            const d = new THREE.Vector3().subVectors(c, w.origin);
            const [u, v] = type.endsWith('Rear')
                ? w.poly.reduce((s, p) => [s[0] + p[0] / w.poly.length, s[1] + p[1] / w.poly.length], [0, 0])
                : [d.dot(w.U), d.dot(w.V)];
            assert(pointInPoly(w.poly, u, v), `${id}: ${type} pane centre is inside its outline`);
        }
    }
});

test('Car models: the driver sits inside the cabin, below the roof', () => {
    for (const id of CAR_MODEL_IDS) {
        const s = cabinShape(id);
        const eye = s.eye;
        assert(eye.y > s.belt && eye.y < s.roof - 0.12, `${id}: eye between belt and roof (eye ${eye.y.toFixed(2)})`);
        assert(eye.z > s.frontGlassZ(eye.y) + 0.4, `${id}: eye well behind the windshield`);
        assert(Math.abs(eye.x) < s.sideX(eye.y), `${id}: eye inside the side glass`);
    }
});

test('Vehicle: default model is Kaj\'s Civic with unchanged handling', () => {
    const v = new Vehicle('civic_default', 0, 0, 0);
    assert.equal(v.modelId, 'civic');
    assert.equal(v.length, 4.5);
    assert.equal(v.width, 2.2);
    assert.equal(v.radius, 2.25);
    assert.equal(v.circleRadius, 1.1);
    assert.equal(v.wheelbase, 2.8);
    assert.equal(v.maxForwardSpeed, 28.0);
    assert.equal(v.baseAccel, 9.5);
    assert.equal(v.normalGrip, 36.0);
    v._syncCollisionCircles();
    assert(Math.abs(v.collisionCircles[0].z - -1.35) < 1e-9, 'front collision circle 1.35 m ahead');
});

test('Vehicle: models differ in size and handling', () => {
    const coupe = new Vehicle('c', 0, 0, 0, 0xffffff, false, 'coupe');
    const pickup = new Vehicle('p', 0, 0, 0, 0xffffff, false, 'pickup');
    const van = new Vehicle('v', 0, 0, 0, 0xffffff, false, 'van');
    assert(coupe.maxForwardSpeed > van.maxForwardSpeed, 'sports coupe is faster than the van');
    assert(coupe.normalGrip > pickup.normalGrip, 'coupe grips harder than the pickup');
    assert(pickup.length > coupe.length && pickup.radius > coupe.radius, 'pickup is longer');
    assert(pickup.driverEye.y > coupe.driverEye.y, 'pickup driver sits higher');
    assert.notEqual(coupe.engineSpec.sound, pickup.engineSpec.sound, 'different engine voices');
    assert.equal(getCarModel('nonexistent').id, 'civic', 'unknown model falls back to the Civic');
});

test('Vehicle: automatic gearbox shifts up under full throttle and revs stay under the limiter', () => {
    for (const id of CAR_MODEL_IDS) {
        const v = new Vehicle(`gb_${id}`, 0, 0, 0, 0x111111, false, id);
        v.engineOn = true;
        let maxGear = 1, maxRpm = 0;
        for (let i = 0; i < 60 * 8; i++) {
            v.update(1 / 60, { throttle: 1, steer: 0, brake: 0, handbrake: false });
            maxGear = Math.max(maxGear, v.gear);
            maxRpm = Math.max(maxRpm, v.rpm);
            assert(Number.isFinite(v.rpm), `${id}: finite rpm`);
        }
        assert(maxGear >= 3, `${id}: reached at least 3rd gear (got ${maxGear})`);
        assert(maxRpm <= v.engineSpec.redline * 1.02, `${id}: rpm ${maxRpm.toFixed(0)} within the redline`);
        assert(maxRpm > v.engineSpec.idle * 2, `${id}: revs rise under throttle`);
        // Lifting off and stopping drops back to first and idle
        for (let i = 0; i < 60 * 12 && v.speed > 0.5; i++) v.update(1 / 60, { throttle: 0, steer: 0, brake: 1, handbrake: false });
        for (let i = 0; i < 60 * 3; i++) v.update(1 / 60, { throttle: 0, steer: 0, brake: 0, handbrake: false });
        assert.equal(v.gear, 1, `${id}: back in first when stopped`);
        assert(Math.abs(v.rpm - v.engineSpec.idle) < 60, `${id}: idling when stopped`);
        // Engine off: revs die away and the dash shows P
        v.engineOn = false;
        for (let i = 0; i < 60; i++) v.update(1 / 60, { throttle: 0, steer: 0, brake: 0, handbrake: false });
        assert.equal(v.rpm, 0);
        assert.equal(v.gearLabel, 'P');
    }
});

test('Traffic picks: weighted model picks and model colours', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(pickCarModel(i / 200));
    assert.equal(seen.size, CAR_MODEL_IDS.length, 'every model can be picked');
    assert.equal(pickCarColor('taxi', 0.7), 0xf2c200, 'taxis are yellow');
    for (const id of CAR_MODEL_IDS) assert(CAR_MODELS[id].palette.includes(pickCarColor(id, 0.5)));
});

test('InstancedVehicleFleet: batches cars by model and scales wheels per model', () => {
    const scene = new THREE.Scene();
    const fleet = new InstancedVehicleFleet({ maxCapacity: 32 }).init(scene);
    const vehicles = [];
    const ids = ['civic', 'civic', 'pickup', 'coupe', 'van', 'van', 'van'];
    ids.forEach((id, i) => vehicles.push(new Vehicle(`f_${i}`, i * 6, 0, 0, 0x2266dd, false, id)));
    fleet.update(vehicles, 1 / 60);
    assert.equal(fleet.batches.get('civic').mesh.count, 2);
    assert.equal(fleet.batches.get('van').mesh.count, 3);
    assert.equal(fleet.batches.get('suv').mesh.count, 0);
    assert.equal(fleet.batches.get('suv').mesh.visible, false, 'models with no cars are not drawn');
    assert.equal(fleet.meshes.tires.count, ids.length * 4);
    // A pickup's wheel is drawn bigger than a coupe's
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    fleet.meshes.tires.getMatrixAt(2 * 4, m);
    m.decompose(p, q, s);
    assert(Math.abs(s.y - CAR_MODELS.pickup.wheels.radius) < 1e-6, 'pickup wheel scaled to its radius');
    const metrics = fleet.getMetrics();
    assert.equal(metrics.vehicleCount, ids.length);
    assert.equal(metrics.drawCalls, 4 * 2 + 2, 'body and glass per model on the road plus tyres and rims');
    assert.equal(fleet.batches.get('van').glass.count, 3, 'see-through glass drawn for each car');
    fleet.dispose();
});
