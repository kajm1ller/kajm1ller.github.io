import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import * as THREE from 'three';
import { CityNav } from '../../js/game/cityNav.js';
import { PedestrianSystem } from '../../js/game/pedestrians.js';
import { seatLocal, seatWorld, npcOccupants, CarRiders } from '../../js/game/riders.js';
import { RemotePlayers } from '../../js/game/multiplayer.js';
import { CAR_MODELS } from '../../js/game/carModels.js';

const nav = new CityNav(JSON.parse(fs.readFileSync(new URL('../../js/game/data/cityNav.json', import.meta.url), 'utf8')));
const peds = () => new PedestrianSystem({ scene: new THREE.Scene(), nav, pedestrians: [] });

test('Riders: seats sit inside the car, driver on the left, passengers behind and beside', () => {
    const ids = Object.keys(CAR_MODELS || { civic: 1 });
    for (const id of ids.slice(0, 12)) {
        const d = seatLocal(id, 0), p = seatLocal(id, 1), rl = seatLocal(id, 2), rr = seatLocal(id, 3);
        assert.ok(d.x < 0 && p.x > 0 && Math.abs(d.x + p.x) < 1e-9, `${id}: driver left, passenger right`);
        assert.equal(d.z, p.z);
        assert.ok(rl.z > d.z && rr.z > p.z, `${id}: rear seats are behind the front ones`);
        assert.ok(d.y > 0.2 && d.y < 1.2, `${id}: hips at a sensible height (${d.y})`);
    }
    // A car facing -z (yaw 0): the driver is to the left (-x) of the middle; turned a quarter, the seat turns with it
    const p0 = seatWorld('civic', 0, { x: 100, y: 0, z: 50 }, 0);
    assert.ok(p0.x < 100);
    const q = seatWorld('civic', 1, { x: 100, y: 0, z: 50 }, Math.PI / 2);
    const local = seatLocal('civic', 1);
    // yaw 90 degrees: car-space +x (right) points to world -z... the seat's offset keeps its length
    assert.ok(Math.abs(Math.hypot(q.x - 100, q.z - 50) - Math.hypot(local.x, local.z)) < 1e-9);
});

test('Riders: traffic cars carry the same people on every screen; some have company', () => {
    const car = { id: 'traffic_7', position: new THREE.Vector3(), yaw: 0 };
    assert.deepEqual(npcOccupants(car), npcOccupants({ id: 'traffic_7' }));
    assert.deepEqual(npcOccupants({ id: 'other', occKey: 'traffic_7' }), npcOccupants(car), 'a replica uses the owner\'s key');
    let withPassenger = 0, total = 400;
    for (let i = 0; i < total; i++) {
        const o = npcOccupants({ id: `traffic_${i}` });
        assert.equal(o[0].seat, 0);
        if (o.length > 1) withPassenger++;
    }
    assert.ok(withPassenger > total * 0.1 && withPassenger < total * 0.4, `${withPassenger} cars with company`);
});

test('Riders: seated rigs follow their car and are cleared when it is gone', () => {
    const sys = peds();
    const riders = new CarRiders(sys);
    const car = { position: new THREE.Vector3(10, 0, 20), yaw: 0.5, modelId: 'civic' };
    riders.sync([
        { key: 'a', car, seat: 0, seed: 11, style: 'adult', kind: 'drive' },
        { key: 'b', car, seat: 1, seed: 22, style: 'older', kind: 'ride' }
    ]);
    assert.equal(sys.extraRigs.length, 2);
    riders.update(1 / 60);
    const a = riders.map.get('a');
    const exp = seatWorld('civic', 0, car.position, car.yaw);
    assert.ok(Math.hypot(a.mesh.position.x - exp.x, a.mesh.position.z - exp.z) < 1e-9);
    // The car drives off; so do they
    car.position.set(40, 0, -5);
    car.yaw = 2;
    riders.update(1 / 60);
    const exp2 = seatWorld('civic', 0, car.position, car.yaw);
    assert.ok(Math.hypot(a.mesh.position.x - exp2.x, a.mesh.position.z - exp2.z) < 1e-9);
    assert.ok(Math.abs(a.mesh.rotation.y - (car.yaw + Math.PI)) < 1e-9, 'facing the way the car does');
    // The same person keeps their rig; someone leaving loses theirs
    const meshBefore = a.mesh;
    riders.sync([{ key: 'a', car, seat: 0, seed: 11, style: 'adult', kind: 'drive' }]);
    assert.equal(riders.map.get('a').mesh, meshBefore);
    assert.equal(sys.extraRigs.length, 1);
    riders.clear();
    assert.equal(sys.extraRigs.length, 0);
});

test('Remote players: people on foot are drawn as full bodies, drivers and passengers sit in the car', () => {
    const sys = peds();
    const scene = new THREE.Scene();
    const rp = new RemotePlayers(scene, { peds: sys });
    rp.sync([
        { id: 'walker', name: 'W', x: 0, y: 0, z: 0, yaw: 0, state: 'foot', hp: 80, anim: 'walk', held: 'pistol', region: 'd1' },
        { id: 'driver', name: 'D', x: 50, y: 0, z: 0, yaw: 1, state: 'car', color: 0xff0000, model: 'civic', hp: 100, riders: [[2, 5, 'older']], region: 'd1' },
        { id: 'pal', name: 'P', x: 50, y: 0, z: 0, yaw: 0, state: 'foot', ride: { of: 'driver', seat: 1 }, hp: 100, region: 'd1' },
        { id: 'sitter', name: 'S', x: 9, y: 0, z: 9, yaw: 0, state: 'foot', sit: 3, hp: 100 }
    ], 'me');
    assert.equal(rp.players.size, 4);
    // Bodies in the pedestrian renderer: the walker, the passenger (hidden while riding) and a seated player
    assert.equal(sys.extraRigs.length, 3);
    for (let i = 0; i < 90; i++) rp.update(1 / 60);
    const walker = rp.players.get('walker');
    assert.equal(walker.region, 'd1');
    assert.equal(walker.body.held, 'pistol');
    assert.ok(walker.body.mesh.userData.rig.props.R, 'a gun in the hand');
    // The passenger's body is parked out of sight; CarRiders seats them instead
    assert.ok(rp.players.get('pal').body.mesh.position.y < -100);
    const specs = rp.getRiderSpecs([]);
    assert.deepEqual(specs.map((s) => `${s.key}:${s.seat}`).sort(), ['ndriver:2:2', 'ppal:1', 'pdriver:0'].sort());
    assert.equal(rp.getCar('driver').model, 'civic');
    assert.equal(rp.getCar('walker'), null);
    // Leaving removes the bodies
    rp.sync([], 'me');
    assert.equal(sys.extraRigs.length, 0);
});
