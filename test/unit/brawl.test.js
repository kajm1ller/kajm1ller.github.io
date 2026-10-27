import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Brawler, comboNext, findWallAhead, PUNCH_MOVES } from '../../js/game/brawl.js';
import { SpatialGrid } from '../../js/game/spatialGrid.js';

test('Combos run jab, cross, hook, uppercut and start over after a pause', () => {
    assert.equal(comboNext(null, 0, 0.9), 'jab');
    assert.equal(comboNext('jab', 0.1, 0.9), 'cross');
    assert.equal(comboNext('cross', 0.1, 0.9), 'hook');
    assert.equal(comboNext('hook', 0.1, 0.9), 'uppercut');
    assert.equal(comboNext('uppercut', 0.1, 0.9), 'jab');
    assert.equal(comboNext('hook', 2, 0.9), 'jab', 'too slow: the combo resets');
});

test('A move winds up before the blow lands, and a late click is thrown next', () => {
    const b = new Brawler();
    b.rand = () => 0.9;
    assert.equal(b.request({}), 'jab');
    assert.equal(b.request({}), null, 'mid wind-up a click is ignored');
    let landed = null, t = 0;
    while (!landed && t < 1) { landed = b.update(1 / 60); t += 1 / 60; }
    assert.ok(landed && landed.move === 'jab');
    assert.ok(t > PUNCH_MOVES.jab.w, 'it lands after the wind-up');
    assert.equal(b.request({}), 'queued');
    for (let i = 0; i < 60 && b.act && b.act.move === 'jab'; i++) b.update(1 / 60);
    assert.equal(b.act && b.act.move, 'cross', 'the buffered click became the next move');
});

test('Holding someone with the rear hand: everything comes from the lead; stomps when asked', () => {
    const b = new Brawler();
    b.rand = () => 0.9;
    b.last = 'hook';            // (always followed by the uppercut, a rear-hand punch)
    b.sinceEnd = 0.1;
    b.request({ rearBusy: true });
    assert.equal(b.act.move, 'uppercut');
    assert.equal(b.act.hand, 'lead');
    const c = new Brawler();
    c.request({ stomp: true });
    assert.equal(c.act.move, 'stomp');
    for (let i = 0; i < 10; i++) c.update(1 / 60);
    assert.ok(c.pose({}).leg, 'the leg shows mid-stomp');
});

test('Poses stay small and finite through every move', () => {
    for (const move of ['jab', 'cross', 'hook', 'uppercut']) {
        const b = new Brawler();
    b.rand = () => 0.9;
        b.last = { jab: null, cross: 'jab', hook: 'cross', uppercut: 'hook' }[move];   // (any move is fine here)
        b.sinceEnd = 0.1;
        b.request({});
        for (let i = 0; i < 60; i++) {
            b.update(1 / 60);
            const p = b.pose({ moving: 1, walkPhase: i * 0.2 });
            for (const v of [...p.lead, ...p.rear, p.twist]) assert.ok(Number.isFinite(v) && Math.abs(v) < 2.5, `${move} ${v}`);
        }
    }
});

test('findWallAhead finds the near face of a building and its normal', () => {
    const grid = new SpatialGrid();
    grid.insertStatic('wall', new THREE.Box3(new THREE.Vector3(2, 0, -5), new THREE.Vector3(6, 8, 5)));
    const w = findWallAhead(grid, 0, 0, 1, 0, 0, 3);
    assert.ok(w, 'found');
    assert.ok(Math.abs(w.x - 2) < 1e-6 && Math.abs(w.dist - 2) < 1e-6);
    assert.equal(w.nx, -1);
    assert.equal(findWallAhead(grid, 0, 0, -1, 0, 0, 3), null, 'nothing behind');
    assert.equal(findWallAhead(grid, 0, 0, 1, 0, 0, 1.5), null, 'out of reach');
    grid.insertStatic('kerb', new THREE.Box3(new THREE.Vector3(-3, 0, -1), new THREE.Vector3(-1, 0.2, 1)));
    assert.equal(findWallAhead(grid, 0, 0, -1, 0, 0, 3), null, 'a kerb is no wall');
});
