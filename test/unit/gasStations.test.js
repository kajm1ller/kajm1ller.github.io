import test from 'node:test';
import assert from 'node:assert/strict';
import { GasStations, prepareSite, localToWorld, worldToLocal, GAS_CONFIG } from '../../js/game/gasStations.js';

const raw = { name: 'Circle K', x: -1716, z: -640, w: 13, d: 18, yaw: 1.2, roadDist: 9 };

function station() {
    const g = new GasStations({ scene: null });
    const [site] = g.load([raw]);
    site.built = true;                       // skip building meshes (needs a DOM)
    site.group = { visible: true };
    return { g, site };
}

test('site frame is a quarter turn and round-trips', () => {
    const site = prepareSite(raw);
    assert.ok(Math.abs(site.theta / (Math.PI / 2) - Math.round(site.theta / (Math.PI / 2))) < 1e-9);
    const w = localToWorld(site, 3, -2);
    const l = worldToLocal(site, w.x, w.z);
    assert.ok(Math.abs(l.x - 3) < 1e-9 && Math.abs(l.z + 2) < 1e-9);
});

test('prompt needs a gun and a clerk in range; robbery pays once, then the till refills', () => {
    const { g, site } = station();
    const at = { x: site.clerk.x + 1, z: site.clerk.z };
    if (!g.inStore(site, at.x, at.z)) at.x = site.entry.x;   // a spot inside the store, near the counter
    const near = localToWorld(site, -3, 2.6);
    assert.equal(g.prompt(near.x, near.z, false).ok, false);
    assert.equal(g.prompt(site.x + 100, site.z, true), null);

    const crimes = [], pay = [];
    g.onCrime = (t) => crimes.push(t);
    g.onPayout = (a) => pay.push(a);
    assert.equal(g.startRobbery(near.x, near.z, false), false);
    assert.equal(g.startRobbery(near.x, near.z, true), true);
    const till = site.till;
    const state = { armed: true, alive: true, onFoot: true };
    for (let t = 0; t < GAS_CONFIG.ROB_SECONDS + 1; t += 0.25) g.update(0.25, { x: site.x, z: site.z }, near, state);
    assert.deepEqual(pay, [till]);
    assert.deepEqual(crimes, ['armed_robbery', 'armed_robbery']);
    assert.equal(g.rob, null);
    assert.equal(g.prompt(near.x, near.z, true).ok, false);   // till empty
    g.update(GAS_CONFIG.REFILL_SECONDS + 1, { x: site.x, z: site.z }, near, state);
    assert.equal(g.prompt(near.x, near.z, true).ok, true);
});

test('holstering the gun or walking off cancels the holdup without pay', () => {
    for (const bad of [{ armed: false }, { alive: false }]) {
        const { g, site } = station();
        const near = localToWorld(site, -3, 2.6);
        let paid = 0;
        g.onPayout = () => paid++;
        g.startRobbery(near.x, near.z, true);
        g.update(0.5, { x: site.x, z: site.z }, near, { armed: true, alive: true, onFoot: true, ...bad });
        assert.equal(g.rob, null);
        assert.equal(paid, 0);
    }
    const { g, site } = station();
    const near = localToWorld(site, -3, 2.6);
    g.startRobbery(near.x, near.z, true);
    const far = localToWorld(site, 12, 0);
    g.update(0.5, { x: site.x, z: site.z }, far, { armed: true, alive: true, onFoot: true });
    assert.equal(g.rob, null);
});
