import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { Bars, BAR_CONFIG, prepareStorefront, localToWorld, worldToLocal, specFor } from '../../js/game/bars.js';

const data = JSON.parse(fs.readFileSync(new URL('../../js/game/data/bars.json', import.meta.url), 'utf8'));
const overlap = (a, b) => Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 0.05 && Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > 0.05;
const same = (a, b) => a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ;

test('Baked bars: downtown, every one has a spec, storefronts do not overlap', () => {
    assert.ok(data.bars.length >= 12, 'the downtown bars are all there');
    for (const b of data.bars) {
        assert.ok(b.minX > -1960 && b.maxX < -1630 && b.minZ > -2050 && b.maxZ < -540, `${b.name} is in the Downtown Bars district`);
        assert.ok(specFor(b.name).bar, `${b.name} has a spec`);
        assert.ok(['E', 'W', 'N', 'S'].includes(b.face));
    }
    const rects = [...data.bars, ...data.fillers];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        if (same(rects[i], rects[j])) continue;
        assert.ok(!overlap(rects[i], rects[j]), `${rects[i].name || 'filler'} overlaps ${rects[j].name || 'filler'}`);
    }
    // The upstairs bars share their footprint with the bar below
    for (const up of data.bars.filter((b) => b.level === 1)) assert.ok(data.bars.some((b) => b.level === 0 && same(b, up)), `${up.name} is over a street-level bar`);
});

test('Storefront frames: +x points at the street, the back wall is D behind', () => {
    for (const face of ['E', 'W', 'N', 'S']) {
        const r = { minX: 0, maxX: 20, minZ: 100, maxZ: 108, face };
        const sf = prepareStorefront(r);
        const out = localToWorld(sf, 1, 0);       // a metre out of the front door
        const back = localToWorld(sf, -sf.D + 0.5, 0);
        const inside = (p) => p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ;
        assert.ok(!inside(out), `${face}: out the door is outside`);
        assert.ok(inside(back), `${face}: just inside the back wall is inside`);
        const dir = { E: [1, 0], W: [-1, 0], N: [0, -1], S: [0, 1] }[face];
        const front = localToWorld(sf, 0, 0);
        assert.ok(Math.abs((out.x - front.x) - dir[0]) < 1e-9 && Math.abs((out.z - front.z) - dir[1]) < 1e-9, `${face}: faces ${dir}`);
        const l = worldToLocal(sf, back.x, back.z);
        assert.ok(Math.abs(l.x - (-sf.D + 0.5)) < 1e-9 && Math.abs(l.z) < 1e-9, 'worldToLocal undoes localToWorld');
    }
});

test('Stairs: the floor ramps up to the upstairs bar and stays up there', () => {
    const bars = new Bars({ scene: null });
    bars.load(data);
    const sf = bars.storefronts.find((s) => s.upper && s.upper.name === 'Uptown Nightclub');
    assert.ok(sf && sf.stairs, 'Uptown has stairs');
    assert.ok(sf.doors.some((d) => d.kind === 'stairs') && sf.doors.some((d) => d.kind === 'main'), 'its own street door, and Downtown\'s');
    sf.built = true;
    const st = sf.stairs, zc = (st.z0 + st.z1) / 2;
    const at = (lx, lz, y) => { const p = localToWorld(sf, lx, lz); return bars.floorAt(p.x, p.z, y); };
    assert.equal(at(st.xb + 0.5, zc, 0), 0, 'bottom landing');
    const half = at((st.xb + st.xt) / 2, zc, 0);
    assert.ok(Math.abs(half - BAR_CONFIG.UP / 2) < 1e-6, 'halfway up');
    assert.ok(Math.abs(at(st.xt, zc, 4) - BAR_CONFIG.UP) < 1e-6, 'top');
    assert.equal(at(st.xt - 3, 0, BAR_CONFIG.UP), BAR_CONFIG.UP, 'stays upstairs');
    assert.equal(at(-5, -zc, 0), 0, 'Downtown downstairs stays at street level');
    assert.equal(bars.floorAt(0, 0, 3), 0, 'outside the bars it is street level');
});

test('Bars without a counter spec get a sensible default', () => {
    const s = specFor('Some New Bar');
    assert.ok(s.bar && s.facade.sign.text === 'SOME NEW BAR');
});
