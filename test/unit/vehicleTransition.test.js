import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Vehicle } from '../../js/game/vehicle.js';
import { VehicleTransition } from '../../js/game/vehicleTransition.js';
import { CAR_MODEL_IDS } from '../../js/game/carModels.js';

/** Camera position in the car's local space. */
function local(v, p) {
    const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
    const dx = p.x - v.position.x, dz = p.z - v.position.z;
    return { x: dx * c - dz * s, y: p.y, z: dx * s + dz * c };
}

function run(tr, v, onStep) {
    for (let i = 0; i < 60 * 6 && !tr.done; i++) {
        tr.update(1 / 60);
        if (onStep) onStep(local(v, tr.camera.position));
    }
    return tr.done;
}

test('VehicleTransition: getting in ends in the driver\'s seat, never through the body', () => {
    for (const id of CAR_MODEL_IDS) {
        // Start beside the driver's door, on the far side, in front and behind
        for (const [sx, sz] of [[-2.6, 0.5], [2.6, 0.3], [0.4, -3.6], [-0.5, 3.8]]) {
            const v = new Vehicle(`t_${id}`, 10, -5, 0.7, 0x111111, false, id);
            const cam = new THREE.PerspectiveCamera();
            const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
            cam.position.set(v.position.x + sx * c + sz * s, 1.7, v.position.z - sx * s + sz * c);
            cam.lookAt(v.position.x, 1.2, v.position.z);
            const doors = [];
            const tr = new VehicleTransition({ kind: 'enter', vehicle: v, camera: cam, onDoor: (k) => doors.push(k) });
            let maxDoor = 0;
            const done = run(tr, v, (p) => {
                maxDoor = Math.max(maxDoor, v.doorOpenAngle);
                // Over the car (outside the cabin) the eye stays below nothing: never inside the roof
                const overCar = Math.abs(p.x) < v.width / 2 - 0.05 && Math.abs(p.z) < v.length / 2 - 0.05;
                if (overCar) assert(p.y < v.model.cabin.roof, `${id} from (${sx}, ${sz}): camera went through the roof (y ${p.y.toFixed(2)})`);
            });
            assert(done, `${id}: finishes`);
            const p = local(v, cam.position);
            const e = v.driverEye;
            assert(Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z) < 0.02, `${id}: ends at the driver's eye`);
            assert.deepEqual(doors, ['open', 'close'], `${id}: door opens then shuts once`);
            assert(maxDoor > 1.0, `${id}: door swings wide open`);
            assert.equal(v.doorOpenAngle, 0, `${id}: door shut at the end`);
            // Facing the road
            const dir = new THREE.Vector3();
            cam.getWorldDirection(dir);
            const fwd = new THREE.Vector3(-Math.sin(v.yaw), 0, -Math.cos(v.yaw));
            assert(dir.dot(fwd) > 0.9, `${id}: looking ahead`);
        }
    }
});

test('VehicleTransition: getting out ends standing at the exit spot looking the way the car faces', () => {
    for (const side of ['LEFT', 'RIGHT']) {
        const v = new Vehicle('t_exit', 0, 0, -1.2, 0x111111, false, 'suv');
        const cam = new THREE.PerspectiveCamera();
        const e = v.driverEye;
        const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
        cam.position.set(e.x * c + e.z * s, e.y, -e.x * s + e.z * c);
        const sx = side === 'LEFT' ? -1 : 1;
        const exitPos = new THREE.Vector3(sx * 2.0 * c, 0, -sx * 2.0 * s);
        const doors = [];
        const tr = new VehicleTransition({ kind: 'exit', vehicle: v, camera: cam, exitPos, exitSide: side, onDoor: (k) => doors.push(k) });
        assert(run(tr, v), 'finishes');
        assert(Math.hypot(cam.position.x - exitPos.x, cam.position.z - exitPos.z) < 0.02, `${side}: standing at the exit spot`);
        assert(Math.abs(cam.position.y - 1.7) < 0.02, `${side}: standing eye height`);
        const dir = new THREE.Vector3();
        cam.getWorldDirection(dir);
        assert(dir.dot(new THREE.Vector3(-Math.sin(v.yaw), 0, -Math.cos(v.yaw))) > 0.95, `${side}: facing along the car`);
        assert.deepEqual(doors, ['open', 'close']);
        assert.equal(v.doorOpenAngle, 0);
    }
});

test('VehicleTransition: a carjacking scramble starts with the door open and runs faster', () => {
    const v = new Vehicle('t_jack', 0, 0, 0);
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(-1.9, 1.7, 0);
    v.setDoorAngle(1.15);
    const doors = [];
    const tr = new VehicleTransition({ kind: 'enter', vehicle: v, camera: cam, doorStartsOpen: true, speed: 1.8, onDoor: (k) => doors.push(k) });
    let steps = 0;
    while (!tr.update(1 / 60)) steps++;
    assert(steps / 60 < 1.0, `quick (${(steps / 60).toFixed(2)} s)`);
    assert.deepEqual(doors, ['close'], 'no second door-open sound');
});
