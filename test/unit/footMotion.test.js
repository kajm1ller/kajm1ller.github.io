import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FootMotion } from '../../js/game/footMotion.js';

const run = (fm, secs, input, blockX = false) => {
    let steps = 0;
    for (let t = 0; t < secs; t += 1 / 60) {
        const m = fm.update(1 / 60, input);
        if (fm.afterMove(blockX ? 0 : m.dx, m.dz, 1 / 60)) steps++;
    }
    return steps;
};

test('builds up to speed, diagonals are no faster, and it stops', () => {
    const fm = new FootMotion();
    fm.update(1 / 60, { fwd: 1, side: 0, yaw: 0, speed: 7 });
    assert.ok(Math.hypot(fm.vx, fm.vz) < 1, 'not instant');
    run(fm, 1, { fwd: 1, side: 1, yaw: 0, speed: 7 });
    assert.ok(Math.abs(Math.hypot(fm.vx, fm.vz) - 7) < 0.01, 'diagonal at walking speed');
    run(fm, 1, { fwd: 0, side: 0, yaw: 0, speed: 7 });
    assert.equal(Math.hypot(fm.vx, fm.vz), 0);
});

test('footsteps follow distance walked, and a wall stops them', () => {
    const fm = new FootMotion();
    const steps = run(fm, 3, { fwd: 1, side: 0, yaw: 0, speed: 5.2 });
    assert.ok(steps >= 4 && steps <= 6, `steps ${steps}`);   // ~14 m at 2.6 m a step
    const fm2 = new FootMotion();
    // walking straight into a wall along x (yaw -PI/2 faces +x)
    assert.equal(run(fm2, 2, { fwd: 1, side: 0, yaw: -Math.PI / 2, speed: 5 }, true), 0);
});
