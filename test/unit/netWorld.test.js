import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import * as THREE from 'three';
import { CityNav } from '../../js/game/cityNav.js';
import { PedestrianSystem } from '../../js/game/pedestrians.js';
import { ParkedCars } from '../../js/game/parkedCars.js';
import { Vehicle } from '../../js/game/vehicle.js';
import { NetOwner, NetReplica, NET_CONFIG, F } from '../../js/game/netWorld.js';

const navData = JSON.parse(fs.readFileSync(new URL('../../js/game/data/cityNav.json', import.meta.url), 'utf8'));
const nav = new CityNav(navData);

/** The bits of TrafficManager the replica uses. */
function fakeTraffic() {
    return {
        replicaMode: false, vehicles: [], replicas: [],
        setReplicaMode(on) { this.replicaMode = on; if (!on) this.vehicles.length = 0; },
        addReplicaVehicle(v) { this.replicas.push(v); this.vehicles.push(v); },
        removeReplicaVehicle(v) { this.replicas = this.replicas.filter((x) => x !== v); this.vehicles = this.vehicles.filter((x) => x !== v); }
    };
}

function world(x, z, night, seconds = 20) {
    const peds = [];
    const sys = new PedestrianSystem({ scene: new THREE.Scene(), nav, pedestrians: peds });
    const list = [];
    sys.parkedCars = new ParkedCars({ nav, list });
    const ctx = { center: { x, z }, viewDir: { x: 0, z: -1 }, night, playerPos: { x: x + 500, z }, playerOnFoot: false, vehicles: list, officers: [] };
    sys.populateInitial(ctx.center, night);
    for (let f = 0; f < seconds * 60; f++) { sys.parkedCars.update(1 / 60, ctx); sys.update(1 / 60, ctx); }
    return { sys, peds, list, ctx };
}

const wire = (m) => JSON.parse(JSON.stringify(m));

test('Net world: the owner\'s people, props and cars show up on a replica with the same look and pose', () => {
    const owner = world(-1822, -740, 1, 25);
    const o = new NetOwner({ peds: owner.sys, cars: owner.list, focus: () => [{ x: -1822, z: -740 }] });
    const msg = wire(o.update(1, 0, 'bars', 'ownerId'));
    assert.equal(msg.type, 'world');
    assert.equal(msg.full, true);
    assert.ok(msg.p.length > 40, `people in the snapshot (${msg.p.length})`);
    assert.ok(msg.c.length > 10, `cars in the snapshot (${msg.c.length})`);
    assert.ok(JSON.stringify(msg).length < 120000, `snapshot size ${JSON.stringify(msg).length}`);

    // A second player's game
    const guest = world(-1822, -740, 1, 0);
    guest.sys.setReplicaMode(true);
    const traffic = fakeTraffic();
    const rep = new NetReplica({ peds: guest.sys, traffic, scene: new THREE.Scene() });
    rep.follow('ownerId');
    assert.equal(guest.peds.length, 0, 'the guest\'s own people are gone');
    assert.ok(rep.apply(msg));
    assert.equal(guest.peds.length, msg.p.length);
    assert.equal(traffic.vehicles.length, Math.min(msg.c.length, NET_CONFIG.MAX_REPLICA_CARS));
    // People: same place, same look, same pose
    const byIndex = new Map(owner.peds.map((p) => [p.index, p]));
    let posed = 0;
    for (const r of guest.sys.pedestrians) {
        const src = byIndex.get(r.net.id);
        assert.ok(src, 'replica of a real person');
        assert.equal(r.style, src.style);
        assert.equal(r.lookSeed, src.lookSeed);
        const err = Math.hypot(r.net.x - src.mesh.position.x, r.net.z - src.mesh.position.z);
        assert.ok(err < 0.06, `position error ${err}`);
        assert.equal(r.ai.pose, src.ai.pose || 'stand');
        const a = src.mesh.userData.rig.props, b = r.mesh.userData.rig.props;
        for (const slot of ['R', 'L', 'T']) assert.equal(!!a[slot], !!b[slot], `prop in ${slot}`);
        if (src.ai.pose && src.ai.pose !== 'walk' && src.ai.pose !== 'stand') posed++;
    }
    assert.ok(posed > 3, 'scene poses came across');
    // Props and dogs
    const srcProps = owner.sys.scenes.extras.filter((e) => e.mesh && e.mesh.userData.spec).length;
    assert.ok(srcProps === 0 || rep.extraMap.size > 0, 'scene props came across');

    // The replica animates and draws without any AI
    const ctx = { center: { x: -1822, z: -740 }, night: 1, officers: [] };
    for (let f = 0; f < 120; f++) { rep.update(1 / 60); guest.sys.update(1 / 60, ctx); }
    for (const r of guest.sys.pedestrians) {
        assert.ok(Number.isFinite(r.mesh.position.x) && Number.isFinite(r.mesh.rotation.y));
    }
});

test('Net world: later snapshots are deltas; departures and a keyframe clean up', () => {
    const owner = world(-1822, -740, 1, 20);
    const o = new NetOwner({ peds: owner.sys, cars: owner.list, focus: () => [{ x: -1822, z: -740 }] });
    const first = wire(o.snapshot(0, 'bars', 'o'));
    assert.ok(first.full);

    const guest = world(-1822, -740, 1, 0);
    const traffic = fakeTraffic();
    const rep = new NetReplica({ peds: guest.sys, traffic, scene: new THREE.Scene() });
    rep.follow('o');
    rep.apply(first);
    const count = guest.sys.pedestrians.length;

    // Nothing changed: nothing to send
    assert.equal(o.snapshot(0.1, 'bars', 'o'), null);
    // The owner's world moves on a little; only what changed is sent
    for (let f = 0; f < 60; f++) { owner.sys.parkedCars.update(1 / 60, owner.ctx); owner.sys.update(1 / 60, owner.ctx); }
    const delta = wire(o.snapshot(1, 'bars', 'o'));
    assert.equal(delta.full, false);
    assert.ok(JSON.stringify(delta).length < JSON.stringify(first).length, 'delta is smaller than a keyframe');
    rep.apply(delta);
    // Replicas track the owner's people
    const byIndex = new Map(owner.peds.map((p) => [p.index, p]));
    for (const r of guest.sys.pedestrians) {
        const src = byIndex.get(r.net.id);
        if (!src) continue;
        assert.ok(Math.hypot(r.net.x - src.mesh.position.x, r.net.z - src.mesh.position.z) < 0.06);
    }
    // Somebody despawns on the owner's side
    const gone = owner.peds.find((p) => !p.isPoliceOfficer);
    owner.sys._removePed(gone);
    const del = wire(o.snapshot(1.1, 'bars', 'o'));
    assert.ok(del.xp.includes(gone.index));
    rep.apply(del);
    assert.ok(!guest.sys.pedestrians.some((p) => p.net && p.net.id === gone.index));
    // A late joiner asks for everything and ends up with the same world
    o.requestFull();
    const key = wire(o.snapshot(1.2, 'bars', 'o'));
    assert.ok(key.full);
    const late = world(-1822, -740, 1, 0);
    const rep2 = new NetReplica({ peds: late.sys, traffic: fakeTraffic(), scene: new THREE.Scene() });
    rep2.follow('o');
    rep2.apply(key);
    assert.equal(late.sys.pedestrians.length, guest.sys.pedestrians.length);
    // A keyframe drops what the owner no longer lists
    const stale = wire(key);
    stale.p = stale.p.slice(0, 5);
    stale.xp = [];
    rep2.apply(stale);
    assert.equal(late.sys.pedestrians.length, 5);
    // Messages from an old owner are ignored
    assert.equal(rep2.apply(Object.assign(wire(key), { owner: 'someoneElse' })), false);
    assert.ok(count > 0);
});

test('Net world: interest management keeps far away things out of the snapshot', () => {
    const owner = world(-1822, -740, 1, 15);
    const near = new NetOwner({ peds: owner.sys, cars: owner.list, focus: () => [{ x: -1822, z: -740 }] });
    const far = new NetOwner({ peds: owner.sys, cars: owner.list, focus: () => [{ x: 5000, z: 5000 }] });
    const a = near.snapshot(0, 'r', 'o');
    const b = far.snapshot(0, 'r', 'o');
    assert.ok(a.p.length > 0);
    assert.ok(!b.p && !b.c, 'nobody near: nothing sent');
    // Two peers on opposite sides: both areas are covered
    const both = new NetOwner({ peds: owner.sys, cars: owner.list, focus: () => [{ x: -1822, z: -740 }, { x: 5000, z: 5000 }] });
    assert.equal(both.snapshot(0, 'r', 'o').p.length, a.p.length);
});

test('Net world: replica cars glide to the owner\'s cars and are recycled', () => {
    const traffic = fakeTraffic();
    const guest = world(-1822, -740, 1, 0);
    const rep = new NetReplica({ peds: guest.sys, traffic, scene: new THREE.Scene() });
    rep.follow('o');
    const msg = { type: 'world', owner: 'o', full: true, cn: [[1, 'civic', 0xff0000]], c: [[1, 20, -40, 157, 200, 10, 0, 0]] };
    rep.apply(msg);
    const v = traffic.vehicles[0];
    assert.ok(v instanceof Vehicle);
    assert.equal(v.color, 0xff0000);
    assert.ok(Math.abs(v.position.x - 1) < 1e-6 && Math.abs(v.position.z + 2) < 1e-6, 'placed where it was first seen');
    // 10 m/s forward along -z for a while
    rep.apply({ type: 'world', owner: 'o', full: false, c: [[1, 20, -400, 157, 200, 10, 0, 0]] });
    for (let f = 0; f < 120; f++) rep.update(1 / 60);
    assert.ok(v.position.z < -15, 'moved towards the new position');
    assert.ok(Math.abs(v.speed - 10) < 1e-6);
    // Gone: it returns to the pool and is reused for the next car of its model
    rep.apply({ type: 'world', owner: 'o', full: false, xc: [1] });
    assert.equal(traffic.vehicles.length, 0);
    rep.apply({ type: 'world', owner: 'o', full: false, cn: [[2, 'civic', 0x0000ff]], c: [[2, 0, 0, 0, 0, 0, 0, 0]] });
    assert.equal(traffic.vehicles[0], v, 'pooled vehicle reused');
    assert.equal(v.color, 0x0000ff);
    rep.stop();
    assert.equal(traffic.vehicles.length, 0);
});

test('Net world: replica mode empties the street and switching back refills it', () => {
    const w = world(-1822, -740, 1, 10);
    assert.ok(w.peds.length > 20);
    w.sys.setReplicaMode(true);
    assert.equal(w.peds.length, 0);
    // No local spawning while following somebody else
    for (let f = 0; f < 240; f++) w.sys.update(1 / 60, w.ctx);
    assert.equal(w.peds.length, 0);
    w.sys.setReplicaMode(false);
    w.sys.populateInitial(w.ctx.center, 1);
    assert.ok(w.peds.length > 20, 'own simulation again');
    assert.ok(F.PHONE === 1);
});
