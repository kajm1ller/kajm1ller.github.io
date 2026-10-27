import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import * as THREE from 'three';
import { CityNav } from '../../js/game/cityNav.js';
import { PedestrianSystem } from '../../js/game/pedestrians.js';

const nav = new CityNav(JSON.parse(fs.readFileSync(new URL('../../js/game/data/cityNav.json', import.meta.url), 'utf8')));
const setup = () => {
    const sys = new PedestrianSystem({ scene: new THREE.Scene(), nav, pedestrians: [] });
    const node = nav.nearestWalkNode(0, 0, 500);
    const x = nav.nodeX ? nav.nodeX[node] : 0, z = nav.nodeZ ? nav.nodeZ[node] : 0;
    const ped = sys.spawnPersonAt(x, z);
    return { sys, ped, ctx: { center: { x, z }, playerPos: { x: x + 3, z }, playerOnFoot: true, vehicles: [] } };
};
const run = (sys, ctx, sec) => { for (let i = 0; i < sec * 60; i++) sys.update(1 / 60, ctx); };

test('A knockdown puts them on the ground, and they get back up', () => {
    const { sys, ped, ctx } = setup();
    assert.ok(ped);
    assert.equal(sys.knockDown(ped, 1, 0, 1.0), true);
    assert.equal(ped.state, 'downed');
    run(sys, ctx, 0.5);
    const rig = ped.mesh.userData.rig;
    assert.ok(Math.abs(rig.body.rotation.x) + Math.abs(rig.body.rotation.z) > 1.2, 'lying flat');
    run(sys, ctx, 3);
    assert.ok(ped.state === 'fighting' || ped.state === 'fleeing', `up again (${ped.state})`);
});

test('Hits on someone on the ground keep them down; enough of them kill them where they lie', () => {
    const { sys, ped, ctx } = setup();
    sys.knockDown(ped, 1, 0, 1.0);
    run(sys, ctx, 0.6);
    const before = ped.ai.downT;
    const r = sys.punchPed(ped, { dirX: 1, dirZ: 0, damage: 10, x: 0, y: 0.2, z: 0 });
    assert.equal(r.knockedOut, false);
    assert.ok(ped.ai.downT > before, 'kept down');
    assert.equal(ped.state, 'downed');
    const r2 = sys.punchPed(ped, { dirX: 1, dirZ: 0, damage: 200, x: 0, y: 0.2, z: 0 });
    assert.equal(r2.knockedOut, true);
    assert.equal(ped.state, 'ragdoll', 'handed straight to the ragdoll');
    assert.ok(ped.ragdollCom.y < 0.5, 'already on the ground (no stand-up stumble)');
});

test('Grab, drag, pin, struggle free', () => {
    const { sys, ped, ctx } = setup();
    assert.equal(sys.grab(ped), true);
    assert.equal(ped.state, 'held');
    sys.setHeld(ped, ped.mesh.position.x + 0.1, ped.mesh.position.z, 0, 'drag', 1 / 60);
    // Being hit while held doesn't knock them out of your hands
    const r = sys.punchPed(ped, { dirX: 1, dirZ: 0, damage: 5, knock: 1, x: 0, y: 1.5, z: 0 });
    assert.equal(r.knockedDown, undefined);
    assert.equal(ped.state, 'held');
    // Dragged and left alone long enough, they wriggle free
    run(sys, ctx, 20);
    assert.notEqual(ped.state, 'held');
});

test('Pinned to a wall: held for good, beaten bloody, and beaten to death in the end; the head can go', () => {
    const { sys, ped, ctx } = setup();
    sys.grab(ped);
    sys.setHeld(ped, ped.mesh.position.x, ped.mesh.position.z, 0, 'pin', 1 / 60);
    run(sys, ctx, 20);
    assert.equal(ped.state, 'held', 'no wriggling off a wall');
    let n = 0;
    while (!ped.isDead && n < 100) {
        sys.punchPed(ped, { dirX: 1, dirZ: 0, damage: 20, knock: 0, move: 'hook', x: 0, y: 1.6, z: 0 });
        n++;
        if (n === 9) {
            const parts = ped.mesh.userData.rig.bindings.map((b) => b.part);
            for (const p of ['faceBlood', 'faceSwell', 'faceGash', 'faceMash', 'shirtBlood']) assert.ok(parts.includes(p), p);
            assert.ok(!parts.includes('eyes'), 'swollen shut');
        }
    }
    assert.ok(ped.isDead, 'dead in the end');
    assert.ok(n >= 12, `a long beating (${n} punches)`);
    assert.ok(ped.ai.wallSlump, 'sat dead against the wall');
    const { sys: s2, ped: p2 } = setup();
    s2.goreHead(p2);
    const parts = p2.mesh.userData.rig.bindings.map((b) => b.part);
    assert.ok(!parts.includes('head') && parts.includes('headGore') && parts.includes('skullStub'));
});

test('Let off a wall or killed against it: they slide down it and sit there', () => {
    const { sys, ped, ctx } = setup();
    sys.grab(ped);
    sys.setHeld(ped, ped.mesh.position.x, ped.mesh.position.z, 0, 'pin', 1 / 60);
    sys.release(ped, 'drop');
    assert.equal(ped.state, 'downed');
    assert.equal(ped.ai.downPose, 'wall');
    run(sys, ctx, 1);
    const rig = ped.mesh.userData.rig;
    assert.ok(rig.body.position.y < -0.5, 'sat down');
    assert.equal(rig.body.rotation.x, 0, 'not tipped back through the wall');

    const b = setup();
    b.sys.grab(b.ped);
    b.sys.setHeld(b.ped, b.ped.mesh.position.x, b.ped.mesh.position.z, 0, 'pin', 1 / 60);
    b.ped.ai.held = null;
    b.ped.state = 'idle';
    b.sys.startShotDeath(b.ped, { x: 0, y: 1.6, z: 0, dirX: 1, dirY: 0, dirZ: 0 });
    b.sys.slumpDead(b.ped);
    run(b.sys, b.ctx, 2);
    assert.equal(b.ped.state, 'dead');
    const r2 = b.ped.mesh.userData.rig;
    assert.ok(r2.body.position.y < -0.5);
    assert.equal(r2.body.rotation.x, 0);
});

test('Tackled and held down: a long beating on the ground, and it can kill', () => {
    const { sys, ped } = setup();
    sys.knockDown(ped, 1, 0, 999);
    assert.equal(sys.grab(ped), true);
    ped.ai.held.mode = 'mount';
    let n = 0;
    while (!ped.isDead && n < 100) { sys.punchPed(ped, { dirX: 1, dirZ: 0, damage: 20, knock: 0, move: 'cross', x: 0, y: 0.25, z: 0 }); n++; }
    assert.ok(ped.isDead);
    assert.ok(n >= 12);
    assert.ok(ped.faceDmg >= 8);
});

test('Dropping someone you pinned leaves them on the ground', () => {
    const { sys, ped } = setup();
    sys.grab(ped);
    sys.release(ped, 'drop');
    assert.equal(ped.state, 'downed');
    assert.equal(ped.ai.held, null);
});
