import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMapEdits, applyEntityEdits } from '../../js/game/mapEditCore.js';

const OBJ = [
    'vn 0 1 0', 'usemtl A',
    'o One', 'v 0 0 0', 'v 2 0 0', 'v 2 4 2', 'f 1//1 2//1 3//1',
    'o Two', 'usemtl B', 'f 1//1 3//1 2//1',
    ''
].join('\r\n');

test('delete drops only that object\'s faces', () => {
    const out = applyMapEdits(OBJ, [{ ord: 0, type: 'delete' }]);
    assert.ok(!out.includes('f 1//1 2//1 3//1'));
    assert.ok(out.includes('f 1//1 3//1 2//1'), 'the other object keeps its face');
    assert.ok(out.includes('\r\n'));
});

test('put appends a scaled, moved copy on fresh vertices, leaving the original', () => {
    const out = applyMapEdits(OBJ, [{ ord: 0, type: 'put', s: 2, d: [10, 0, 0] }]).split('\r\n');
    // pivot = base centre (1, 0, 1): (0,0,0) -> (-1, 0, -1) + 10
    assert.ok(out.includes('v 9 0 -1'));
    assert.ok(out.includes('v 13 0 -1'));
    assert.ok(out.includes('v 13 8 3'));
    assert.ok(out.includes('f 4//1 5//1 6//1'));
    assert.ok(out.includes('f 1//1 2//1 3//1'), 'original untouched');
    assert.equal(out.filter((l) => l === 'o One').length, 2);
});

test('put turns the object about its base centre, normals included', () => {
    const out = applyMapEdits(OBJ, [{ ord: 0, type: 'put', s: 1, r: Math.PI / 2, d: [0, 0, 0] }]).split('\r\n');
    // pivot (1, 0, 1); (0,0,0) is (-1, -1) from it; three.js turn by 90 degrees: (x, z) -> (z, -x) = (-1, 1) -> (0, 0, 2)
    assert.ok(out.includes('v 0 0 2'));
    assert.ok(out.includes('vn 0 1 0'), 'a vertical normal stays vertical');
    assert.ok(out.some((l) => /^f 4\/\/2 5\/\/2 6\/\/2$/.test(l)), 'faces use the turned normal');
});

test('entity edits: gas stations and street signs', () => {
    const gas = applyEntityEdits('gasStations', [{ name: 'A', x: 1, z: 2, yaw: 0 }, { name: 'B', x: 5, z: 5, yaw: 1 }],
        [{ index: 0, dx: 2, dz: -1, dyaw: 0.5 }, { index: 1, deleted: true }, { add: true, src: 0, dx: 10, dz: 0, dyaw: 0 }]);
    assert.deepEqual(gas.map((g) => [g.name, g.x, g.z, g.yaw]), [['A', 3, 1, 0.5], ['A', 11, 2, 0]]);
    const signs = applyEntityEdits('streetSigns', { signs: [100, 200, 1, 7, 500, 300, 400, 0] }, [{ index: 0, dx: 1, dz: 0, dyaw: 0.1 }, { index: 1, deleted: true }]);
    assert.deepEqual(signs.signs, [110, 200, 1, 7, 600]);
    assert.deepEqual(applyEntityEdits('roadSignEdits', { k: { dx: 1, dz: 0, dyaw: 0 } }, [{ key: 'k', dx: 1, dz: 2, dyaw: 0 }]), { k: { dx: 2, dz: 2, dyaw: 0 } });
});
