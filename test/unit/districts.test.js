import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import * as THREE from 'three';
import { districtAt, districtProfile, nightFactor, pickWeighted, pickTable } from '../../js/game/districts.js';
import { CityNav } from '../../js/game/cityNav.js';
import { PedestrianSystem } from '../../js/game/pedestrians.js';
import { ParkedCars } from '../../js/game/parkedCars.js';
import { AirTraffic } from '../../js/game/airTraffic.js';

const navData = JSON.parse(fs.readFileSync(new URL('../../js/game/data/cityNav.json', import.meta.url), 'utf8'));
const nav = new CityNav(navData);

test('Districts: landmarks fall in the districts traced on media/districtReference.png', () => {
    assert.equal(districtAt(-1822, -760).type, 'BARS');          // Main St downtown
    assert.equal(districtAt(-2300, -760).type, 'PARKING');       // lots west of Main
    assert.equal(districtAt(-1300, -606).type, 'WOOSTER');       // E Wooster St
    assert.equal(districtAt(-700, -900).type, 'UNIVERSITY');     // BGSU campus
    assert.equal(districtAt(-800, -2000).type, 'AIRPORT');       // Wood County Regional
    assert.equal(districtAt(-2700, -1300).type, 'PARK');         // City Park
    assert.equal(districtAt(-3500, -1500).type, 'OLDER');        // west side
    assert.equal(districtAt(-2150, 1400).type, 'COMMERCIAL');    // south Main St (Walmart)
    assert.equal(districtAt(-8000, 5000).type, 'OUTSKIRTS');
});

test('Districts: night factor ramps through dusk and dawn', () => {
    assert.equal(nightFactor(13), 0);
    assert.equal(nightFactor(23), 1);
    assert.equal(nightFactor(2), 1);
    assert.ok(nightFactor(19.5) > 0.2 && nightFactor(19.5) < 0.8);
    assert.ok(nightFactor(5.5) > 0.2 && nightFactor(5.5) < 0.8);
});

test('Districts: profiles blend between day and night', () => {
    const park = districtAt(-2700, -1300);
    assert.ok(districtProfile(park, 0).peds > districtProfile(park, 1).peds * 5, 'parks empty out at night');
    const bars = districtAt(-1822, -760);
    assert.ok(districtProfile(bars, 1).peds > districtProfile(bars, 0).peds, 'the bars fill up at night');
    const lot = districtAt(-2300, -760);
    assert.ok(districtProfile(lot, 1).parked > 0.9 && districtProfile(lot, 0).parked < 0.5, 'downtown lots fill up at night');
    const half = districtProfile(bars, 0.5).peds;
    assert.ok(Math.abs(half - (districtProfile(bars, 0).peds + districtProfile(bars, 1).peds) / 2) < 1e-9);
    assert.equal(pickTable(bars, 1, () => 0.5), bars.def.night);
    assert.equal(pickTable(bars, 0, () => 0.5), bars.def.day);
});

test('Districts: weighted picks follow the weights and handle empty tables', () => {
    assert.equal(pickWeighted({}), null);
    assert.equal(pickWeighted({ a: 0 }), null);
    assert.equal(pickWeighted({ a: 1, b: 3 }, () => 0.1), 'a');
    assert.equal(pickWeighted({ a: 1, b: 3 }, () => 0.9), 'b');
});

test('CityNav: doors, parking stalls and drive-throughs are baked and indexed', () => {
    assert.ok(nav.doorCount > 1000, 'building doors');
    assert.ok(nav.stallCount > 1000, 'parking stalls');
    assert.ok(nav.driveThrus.length > 10, 'drive-through lanes');
    const bars = [];
    for (let i = 0; i < nav.doorCount; i++) if (nav.doorKind[i] === 4) bars.push(i);
    assert.ok(bars.some((d) => districtAt(nav.doorX[d], nav.doorZ[d]).type === 'BARS'), 'bars downtown');
    const near = nav.stallsNear(-1900, -760, 120, []);
    assert.ok(near.length > 50, 'downtown parking lots have stalls');
});

function simulate(x, z, night, seconds) {
    const peds = [];
    const sys = new PedestrianSystem({ scene: new THREE.Scene(), nav, pedestrians: peds });
    const list = [];
    sys.parkedCars = new ParkedCars({ nav, list });
    const ctx = { center: { x, z }, viewDir: { x: 0, z: -1 }, night, playerPos: { x: x + 500, z }, playerOnFoot: false, vehicles: list, officers: [] };
    sys.populateInitial(ctx.center, night);
    for (let f = 0; f < seconds * 60; f++) {
        sys.parkedCars.update(1 / 60, ctx);
        sys.update(1 / 60, ctx);
        for (const p of peds) assert.ok(Number.isFinite(p.mesh.position.x + p.mesh.position.z), 'finite positions');
    }
    return { sys, peds, parked: sys.parkedCars };
}

test('District life: downtown at night is busy, with scenes on the sidewalks and full lots', () => {
    const { sys, peds, parked } = simulate(-1822, -740, 1, 30);
    const st = sys.getStats();
    assert.equal(st.district, 'Downtown Bars');
    assert.ok(peds.length > 80, `crowded streets (${peds.length})`);
    assert.ok(st.activity > 5, 'people smoking, queuing, fighting...');
    assert.ok(st.scenes > 2);
    assert.ok(parked.getStats().parked > 30, 'parked cars');
});

test('District life: the park is lively by day and nearly empty at night', () => {
    const day = simulate(-2700, -1300, 0, 20);
    const night = simulate(-2700, -1300, 1, 20);
    assert.ok(day.peds.length > 40, `park by day (${day.peds.length})`);
    assert.ok(night.peds.length < 15, `park at night (${night.peds.length})`);
    const types = Object.keys(day.sys.getStats().byType);
    assert.ok(types.some((t) => t === 'picnic' || t === 'sunbathe' || t === 'sleepGrass'), `park scenes: ${types}`);
});

test('Air traffic: planes land, park and take off', () => {
    const air = new AirTraffic({ add() {}, remove() {} });
    const seen = new Set();
    let flew = false;
    for (let f = 0; f < 30 * 900; f++) {
        air.update(1 / 30, null);
        for (const p of air.planes) {
            seen.add(p.state);
            if (p.position.y > 100) flew = true;
            assert.ok(Number.isFinite(p.position.x + p.position.y + p.position.z));
        }
    }
    assert.ok(seen.has('arriving') && seen.has('departing') && seen.has('parked'));
    assert.ok(flew, 'planes climb out / come in high');
});
