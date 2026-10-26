import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import * as THREE from 'three';
import { districtAt } from '../../js/game/districts.js';
import { DistrictStreamer } from '../../js/game/districtStreaming.js';
import { CityNav } from '../../js/game/cityNav.js';
import { PedestrianSystem } from '../../js/game/pedestrians.js';
import { ParkedCars } from '../../js/game/parkedCars.js';

const navData = JSON.parse(fs.readFileSync(new URL('../../js/game/data/cityNav.json', import.meta.url), 'utf8'));
const nav = new CityNav(navData);

test('Streaming: only the player\'s district (plus a margin) is loaded', () => {
    const st = new DistrictStreamer();
    st.update(-1822, -760);                       // downtown bars
    assert.equal(st.name, 'Downtown Bars');
    assert.ok(st.contains(-1822, -900));
    assert.ok(!st.contains(-2300, -760), 'the parking district next door is not loaded');
    assert.ok(!st.contains(-700, -900), 'campus is not loaded');
    // The margin reaches across the boundary street
    const edge = st.boxes[0].minX;
    assert.ok(st.contains(edge - 30, -760));
    assert.ok(!st.contains(edge - 120, -760));
    // Coverage is the loaded share of the disc around the player: nearly all of it in the middle
    // of downtown, less on the narrow E Wooster strip
    const downtown = st.coverage(-1822, -760, 190);
    assert.ok(downtown > 0.9);
    st.update(-1300, -604);
    assert.equal(st.name, 'E Wooster');
    const c = st.coverage(-1300, -604, 190);
    assert.ok(c > 0.2 && c < downtown - 0.1, `coverage ${c}`);
});

test('Streaming: the next district takes over only once you are well inside it', () => {
    const st = new DistrictStreamer({ hysteresis: 14 });
    st.update(-1822, -760);
    const edge = st.boxes[0].minX;                 // west edge of the bars strip, parking beyond
    assert.equal(districtAt(edge - 5, -760).type, 'PARKING');
    assert.equal(st.update(edge - 5, -760), false, 'just across the line: still downtown');
    assert.equal(st.update(edge - 30, -760), true, 'well into the lots: parking loads');
    assert.equal(st.name, 'Downtown Parking');
    assert.ok(!st.contains(-1822, -900), 'the bars are unloaded');
    // A teleport switches at once
    assert.equal(st.update(-700, -900), true);
    assert.equal(st.name, 'University');
});

test('Streaming: same-type boxes that touch load together, the outskirts are everything else', () => {
    const st = new DistrictStreamer();
    st.update(-2100, -2150);                       // student housing north of downtown (several boxes)
    assert.equal(st.district.type, 'STUDENT');
    assert.ok(st.boxes.length >= 2, `${st.boxes.length} boxes`);
    st.update(4000, 4000);
    assert.ok(st.outskirts);
    assert.ok(st.contains(5000, 5000));
    assert.ok(!st.contains(-1822, -900));
});

test('Streaming: people outside the loaded district are cleared and none spawn there', () => {
    const peds = [];
    const sys = new PedestrianSystem({ scene: new THREE.Scene(), nav, pedestrians: peds });
    const list = [];
    sys.parkedCars = new ParkedCars({ nav, list });
    const st = new DistrictStreamer();
    sys.streamer = st;
    sys.parkedCars.streamer = st;
    const run = (x, z, seconds) => {
        st.update(x, z);
        const ctx = { center: { x, z }, viewDir: { x: 0, z: -1 }, night: 1, playerPos: { x: x + 500, z }, playerOnFoot: false, vehicles: list, officers: [] };
        sys.populateInitial(ctx.center, 1);
        for (let f = 0; f < seconds * 60; f++) {
            sys.parkedCars.update(1 / 60, ctx);
            sys.update(1 / 60, ctx);
        }
    };
    run(-1822, -760, 6);
    const outside = peds.filter((p) => !st.contains(p.mesh.position.x, p.mesh.position.z));
    assert.ok(peds.length > 20, `people downtown (${peds.length})`);
    assert.ok(outside.length <= 3, `${outside.length} outside the bars district`);
    for (const v of list) assert.ok(st.contains(v.position.x, v.position.z), 'parked cars only in the loaded district');

});
