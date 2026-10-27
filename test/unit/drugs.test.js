import test from 'node:test';
import assert from 'node:assert/strict';
import { DRUGS, DRUG_IDS, ALCOHOL_IDS, ALCOHOL, DMT_TRIP, buildDrugViewmodel, restPose, DrugUse, DrugEffects } from '../../js/game/drugs.js';
import { getItemDef, Inventory, createItem } from '../../js/game/items.js';

const finite = (s) => {
    for (const [k, v] of Object.entries(s)) {
        if (typeof v === 'number') assert.ok(Number.isFinite(v), `${k} is ${v}`);
    }
};

test('Drugs: all 19 (16 drugs and 3 drinks) are inventory items', () => {
    assert.equal(DRUG_IDS.length, 19);
    const names = DRUG_IDS.map((id) => getItemDef(id).name);
    for (const n of ['Cigarettes', 'Vape', 'Weed (Dab Pen)', 'Weed (Joint)', 'Weed (Bong)', 'Cocaine', 'Crack Cocaine', 'Heroin',
        'Fentanyl', 'Crystal Meth', 'Ketamine', 'LSD', 'Psilocybin', 'DMT', 'Salvia', 'Lean', 'Beer', 'Whiskey', 'Vodka']) {
        assert.ok(names.includes(n), `${n} missing`);
    }
    const inv = new Inventory({ hotbarSize: 9, bagSize: 30 });
    for (const id of DRUG_IDS) inv.add(createItem(id, DRUGS[id].doses));
    for (const id of DRUG_IDS) {
        assert.equal(getItemDef(id).kind, 'drug');
        assert.equal(inv.count(id), DRUGS[id].doses);
    }
    assert.equal(inv.consume('cocaine', 1), 1);
    assert.equal(inv.count('cocaine'), DRUGS.cocaine.doses - 1);
});

test('Drugs: every use animation plays through, moves the hands and delivers one dose', () => {
    for (const id of DRUG_IDS) {
        const vm = buildDrugViewmodel(id);
        restPose(vm);
        const start = vm.main.position.clone();
        const use = new DrugUse(vm, id);
        const events = [];
        let moved = 0;
        for (let i = 0; i < 2000 && !use.done; i++) {
            events.push(...use.update(1 / 60));
            moved = Math.max(moved, vm.main.position.distanceTo(start));
            vm.group.traverse((o) => {
                assert.ok(Number.isFinite(o.position.x + o.position.y + o.position.z), `${id}: ${o.type} position`);
            });
        }
        assert.ok(use.done, `${id} finishes`);
        assert.ok(use.duration >= 1.5 && use.duration <= 9, `${id} takes ${use.duration}s`);
        assert.equal(events.filter((e) => e === 'dose').length, 1, `${id}: one dose (${events})`);
        assert.ok(moved > 0.05, `${id}: the hand comes up to use it (${moved.toFixed(3)} m)`);
    }
});

test('Drug effects: come up, peak and wear off; everything stays finite', () => {
    for (const id of DRUG_IDS) {
        if (DRUGS[id].alcohol) continue;      // alcohol has its own model (below)
        const fx = new DrugEffects();
        fx.dose(id);
        const d = DRUGS[id];
        let peak = null;
        const total = d.onset + d.peak + d.fade + (d.crash || 0);
        for (let t = 0; t < total + 2; t += 0.5) {
            const s = fx.update(0.5);
            finite(s);
            if (t > d.onset + 1 && t < d.onset + d.peak - 1 && !peak) peak = Object.assign({}, s);
        }
        assert.ok(peak && peak.active, `${id} active at its peak`);
        assert.equal(fx.state.active, false, `${id} wears off`);
        assert.equal(fx.state.moveScale, 1);
        assert.equal(fx.summary().length, 0);
    }
});

test('Drug effects: each kind of drug feels like itself', () => {
    const at = (id, t) => {
        const fx = new DrugEffects();
        fx.dose(id);
        for (let i = 0; i < t * 10; i++) fx.update(0.1);
        return fx.state;
    };
    const coke = at('cocaine', 20);
    assert.ok(coke.moveScale > 1.15 && coke.heartbeat > 0.5 && coke.damageScale < 1, 'cocaine: fast, wired, tougher');
    const heroin = at('heroin', 30);
    assert.ok(heroin.moveScale < 0.8 && heroin.regen > 0 && heroin.blur > 0.5 && heroin.damageScale < 0.7, 'heroin: slow, numb, blurry');
    const lean = at('lean', 30);
    assert.ok(lean.musicRate < 0.8 && lean.tintAmt > 0.2, 'lean: slowed music, purple');
    const ket = at('ketamine', 20);
    assert.ok(ket.ghost > 0.8 && ket.mouseLag > 0.5 && ket.fovAdd > 10, 'ketamine: double vision, laggy, stretched');
    const lsd = at('lsd', 6);
    assert.ok(lsd.hueCycle > 0.8 && lsd.sat > 0.5, 'LSD: the colours start to change');
    const lsdAfter = at('lsd', 15);
    assert.equal(lsdAfter.active, false, '...then it stops (and the trip to Mermaid World begins)');
    assert.equal(DRUGS.lsd.trip, 'mermaid');
    const meth = at('meth', 30);
    assert.ok(meth.paranoia > 0.5 && meth.shake > 0.3, 'meth: paranoid and twitchy');
    const crack = at('crack', 0.5);
    assert.ok(crack.flash > 0.5, 'crack: white-out rush');
    // Stimulant comedown
    const fx = new DrugEffects();
    fx.dose('cocaine');
    const d = DRUGS.cocaine;
    for (let t = 0; t < d.onset + d.peak + d.fade + 10; t += 0.5) fx.update(0.5);
    assert.ok(fx.state.sat < 0 && fx.state.moveScale < 1, 'cocaine comedown');
    assert.ok(fx.summary().some((r) => r.phase === 'Comedown'));
});

test('Drug effects: stacking opioids or stimulants is an overdose that drains health', () => {
    const once = new DrugEffects();
    once.dose('heroin');
    for (let i = 0; i < 300; i++) once.update(0.1);
    assert.equal(once.state.overdose, 0, 'one hit of heroin is not an overdose');
    assert.equal(once.state.drain, 0);

    const fent = new DrugEffects();
    fent.dose('fentanyl');
    fent.dose('fentanyl');
    for (let i = 0; i < 200; i++) fent.update(0.1);
    assert.ok(fent.state.overdose > 0.9 && fent.state.drain > 5, 'two fentanyl is an overdose');
    assert.ok(fent.summary()[0].id === 'od');

    const speedball = new DrugEffects();
    for (let k = 0; k < 3; k++) speedball.dose('crack');
    for (let i = 0; i < 100; i++) speedball.update(0.1);
    assert.ok(speedball.state.drain > 0, 'three crack hits at once: heart trouble');

    speedball.clear();
    assert.equal(speedball.state.active, false);
});

test('Drug effects: mouse feel', () => {
    const fx = new DrugEffects();
    assert.deepEqual(fx.filterMouse(10, 5), [10, 5]);
    fx.dose('ketamine');
    for (let i = 0; i < 100; i++) fx.update(0.1);
    const [dx] = fx.filterMouse(100, 0);
    assert.ok(dx < 30, 'most of the movement is held back');
    let caught = 0;
    for (let i = 0; i < 300; i++) caught += fx.takeLaggedMouse(1 / 60)[0];
    assert.ok(caught + dx > 60, 'and catches up later');
});

test('Alcohol: beer < whiskey < vodka; drunker with every drink; sick, then out cold', () => {
    assert.deepEqual(ALCOHOL_IDS, ['beer', 'whiskey', 'vodka']);
    assert.ok(DRUGS.beer.alcohol < DRUGS.whiskey.alcohol && DRUGS.whiskey.alcohol < DRUGS.vodka.alcohol);
    const after = (drinks) => {
        const fx = new DrugEffects();
        for (const id of drinks) fx.dose(id);
        for (let i = 0; i < 400; i++) fx.update(0.1);
        return fx;
    };
    const one = after(['beer']), shot = after(['vodka']), three = after(['beer', 'beer', 'beer']);
    assert.ok(one.bac > 0.3 && shot.bac > one.bac && three.bac > shot.bac, `units: ${one.bac} < ${shot.bac} < ${three.bac}`);
    assert.ok(three.state.sway > one.state.sway && three.state.moveScale < one.state.moveScale, 'more drink, more wobble, slower');
    finite(three.state);

    // Keep drinking: it comes back up once, and a drink after that is a blackout
    const fx = new DrugEffects();
    const events = [];
    for (let round = 0; round < 12 && !events.includes('vomit'); round++) {
        fx.dose('vodka');
        for (let i = 0; i < 300; i++) { fx.update(0.1); events.push(...fx.events); fx.events.length = 0; }
    }
    assert.ok(events.includes('vomit'), 'too much and you throw up');
    assert.equal(events.filter((e) => e === 'vomit').length, 1, 'once');
    assert.ok(fx.state.ghost > 0.5 && fx.state.spins > 0, 'double vision and the spins');
    fx.dose('vodka');
    for (let i = 0; i < 300 && !fx.events.includes('passout'); i++) fx.update(0.1);
    assert.ok(fx.events.includes('passout'), 'drinking after throwing up: out cold');
    fx.events.length = 0;
    fx.wakeUp();
    assert.ok(fx.bac <= 1.2 && !fx.vomited && fx.hangover === ALCOHOL.HANGOVER, 'come round tipsy and hungover');
    // ...and it all wears off
    for (let i = 0; i < 4000; i++) fx.update(0.1);
    assert.equal(fx.state.active, false);
    assert.equal(fx.summary().length, 0);
});

test('Mushrooms: one dose crawls and glows; take too many and the patterns take over the whole screen', () => {
    const peak = (n) => {
        const fx = new DrugEffects();
        for (let i = 0; i < n; i++) fx.dose('psilocybin');
        for (let t = 0; t < 60; t += 0.5) fx.update(0.5);      // past the come-up
        finite(fx.state);
        return fx.state;
    };
    const one = peak(1), two = peak(2), four = peak(4);
    assert.ok(one.drift > 0.4 && one.glow > 0.3 && one.edges > 0.2, 'one dose: drifting, haloes, fringes');
    assert.equal(one.takeover, 0);
    assert.ok(two.pattern > one.pattern + 0.3, 'more patterns on two');
    assert.equal(two.takeover, 0);
    assert.ok(four.takeover >= 1, 'four: the patterns are all there is');
    assert.ok(four.moveScale < one.moveScale && four.muffle > 0.3);
});

test('DMT: one hit, speckles, a burst, minutes in hyperspace, then dark and back', () => {
    const fx = new DrugEffects();
    fx.dose('dmt');
    const at = (t) => { while (fx.doses.length && fx.doses[0].t < t) fx.update(0.25); finite(fx.state); return { ...fx.state }; };
    const comeUp = at(12);
    assert.ok(comeUp.dmtBreak > 0.3 && comeUp.dmt === 0, 'specks creeping in first');
    assert.ok(comeUp.reverb > 0.5 && comeUp.pulse > 0.1 && comeUp.hum > 0, 'the world\'s own sound rings out and throbs coming up');
    const burst = at(DMT_TRIP.BURST - 0.5);
    assert.ok(burst.dmtFlash > 0.5, 'the burst');
    const inside = at(90);
    assert.equal(inside.dmt, 1);
    assert.equal(inside.pulse, 0);
    assert.ok(inside.dmtT > 60 && inside.moveScale <= 0.4 && inside.muffle > 0.8, 'deep in it: barely moving, the world far away');
    const out = at(DMT_TRIP.OUT + 1);
    assert.ok(out.dmt < 0.1 && out.dark > 0.5, 'dark on the way out');
    const back = at(DMT_TRIP.BACK + 10);
    assert.equal(back.dmt, 0);
    assert.ok(back.dark < 0.1 && back.dmtBreak > 0, 'back in the world, still sparkling');
    at(DMT_TRIP.END + 2);
    assert.equal(fx.doses.length, 0);
});
