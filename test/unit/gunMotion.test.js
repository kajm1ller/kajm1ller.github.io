import test from 'node:test';
import assert from 'node:assert/strict';
import { GunMotion, reloadPlan, gunWeight } from '../../js/game/gunMotion.js';

const rifle = { category: 'Rifle', recoil: 0.04, reloadTime: 2.0, mode: 'auto', model: { family: 'rifle' } };
const pistol = { category: 'Pistol', recoil: 0.03, reloadTime: 1.3, mode: 'semi', model: { family: 'pistol' } };
const base = { gun: rifle, speed: 0, runK: 0, phase: 0, side: 0, yawRate: 0, pitchRate: 0, ads: 0, reload: null, cycle: 0, firing: false };

function run(m, frames, s) {
    let P;
    for (let i = 0; i < frames; i++) P = m.update({ dt: 1 / 60, ...base, ...s, phase: (s.phase || 0) + i * 0.15 });
    return { ...P };   // (update reuses one pose object)
}

test('Sprinting swings the gun low and across; aiming or firing brings it up', () => {
    const m = new GunMotion();
    const hip = run(m, 120, {});
    const sprint = run(m, 90, { speed: 7, runK: 1 });
    assert.ok(sprint.py < hip.py, 'lowered at a sprint');
    assert.ok(sprint.ry > 0.25 && sprint.rx < -0.15, 'canted across, muzzle down');
    const aimed = run(m, 60, { speed: 7, runK: 1, ads: 1 });
    assert.ok(Math.abs(aimed.ry) < 0.15 && aimed.py > sprint.py + 0.05, 'aiming on the run comes out of the carry');
});

test('The gun trails the mouse', () => {
    const m = new GunMotion();
    run(m, 60, {});
    const turning = run(m, 20, { yawRate: 4 });
    assert.ok(turning.ry > 0.02);
});

test('A reload goes mag out, mag in, rack (when empty), in that order and quicker with one chambered', () => {
    const empty = reloadPlan(rifle, true), tac = reloadPlan(rifle, false);
    assert.ok(empty.out < empty.seat && empty.seat < empty.rack && empty.rack < empty.done);
    assert.equal(tac.rack, -1);
    assert.ok(tac.total < empty.total);
    const m = new GunMotion();
    const early = { ...m.update({ dt: 1 / 60, ...base, reload: { plan: empty, t: empty.out + 0.2 } }) };
    assert.ok(early.mag.y < -0.05, 'the old magazine falls away');
    const seated = m.update({ dt: 1 / 60, ...base, reload: { plan: empty, t: empty.seat + 0.01 } });
    assert.ok(Math.abs(seated.mag.y) < 0.01 && seated.mag.visible);
});

test('Switching lowers the old one, then draws the new one; no shooting until it is up', () => {
    const m = new GunMotion();
    run(m, 30, {});
    m.startSwitch(pistol, rifle);
    assert.equal(m.ready, false);
    let P = run(m, 3, {});
    assert.equal(P.switchShow, 'from');
    let frames = 0;
    while (m.switching && frames < 300) { P = run(m, 1, {}); frames++; }
    assert.ok(frames < 120, 'a switch takes well under 2 s');
    assert.equal(m.ready, true);
    assert.ok(gunWeight(rifle) > gunWeight(pistol));
});
