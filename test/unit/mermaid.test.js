import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import {
    defaultLook, normalizeLook, randomLook, isUnlocked, LOCKED, SHOPS, HAIR_STYLES, TAIL_COLORS, TALKING_FISH, TREASURES, GARDEN, AREAS, LANDMARKS, PHOTO_TARGETS, PRESETS, WEDDING, RING_RUN
} from '../../js/game/mermaid/mermaidData.js';
import { DreamState, QUESTS, questStatus, settleQuests, mainComplete, MAIN_IDS } from '../../js/game/mermaid/mermaidState.js';
import { makeChart } from '../../js/game/mermaid/mermaidGames.js';

const api = () => {
    const log = { money: 0, unlocked: [], achieved: [], toasts: [] };
    return { log, money: (n) => { log.money += n; }, unlock: (id) => log.unlocked.push(id), toast: (t) => log.toasts.push(t), achieve: (id) => log.achieved.push(id), flag: () => {} };
};

test('Looks: old saves are upgraded, random looks only use real options', () => {
    const old = normalizeLook({ name: 'Old', hairStyle: 'bob', accessory: 'necklace', blush: true, lashes: false, top: 'tank' });
    assert.equal(old.neckAcc, 'necklace');
    assert.equal(old.blush, 0xff8fa3);
    assert.equal(old.lashes, 'none');
    assert.equal(old.finStyle, 'classic', 'new fields get defaults');
    for (let i = 0; i < 30; i++) {
        const l = randomLook();
        assert.ok(HAIR_STYLES.some((h) => h.id === l.hairStyle));
        assert.ok(l.tail >= 0 && l.tail < TAIL_COLORS.length);
    }
    for (const p of PRESETS) assert.ok(normalizeLook(p.look).hairStyle, 'presets are valid looks');
});

test('Locked options open when their item is owned; every unlock is sold or a reward', () => {
    assert.equal(isUnlocked('hairStyle', 'crest', new Set()), false);
    assert.equal(isUnlocked('hairStyle', 'crest', new Set(['hair_crest'])), true);
    assert.equal(isUnlocked('hairStyle', 'long', new Set()), true, 'unlisted options are free');
    const sold = new Set(SHOPS.flatMap((s) => s.items.flatMap((i) => i.unlock || [])));
    const rewards = new Set(['reward:moonCrown', 'reward:moonPendant', 'reward:aura']);
    for (const kind of Object.values(LOCKED)) for (const id of Object.values(kind)) assert.ok(sold.has(id) || rewards.has(id) || id.startsWith('acc_') || id.startsWith('aura_'), `${id} can be earned`);
    // the quests hand out unlocks that exist
    for (const id of ['acc_headband', 'acc_coral', 'aura_sparkles', 'cape_wings']) assert.ok(sold.has(id), `${id} is a real item`);
});

test('Quests: main story order, the finale needs three chapters, rewards are paid once', () => {
    const S = new DreamState();
    const a = api();
    assert.deepEqual(settleQuests(S, a), [], 'nothing is done at the start');
    const st = Object.fromEntries(questStatus(S).map((s) => [s.q.id, s]));
    assert.equal(st.dive.available, true);
    assert.equal(st.wedding.available, false, 'chapters wait for Old Sage');
    assert.equal(st.moon.available, false);
    // chapter 1
    S.counts.trainingRings = 4;
    S.set('metSage');
    assert.deepEqual(settleQuests(S, a), ['dive']);
    assert.equal(a.log.money, 40);
    assert.deepEqual(settleQuests(S, a), [], 'the reward is paid once');
    assert.equal(questStatus(S).find((s) => s.q.id === 'wedding').available, true);
    // three chapters open the finale
    for (const q of ['wedding', 'mall', 'safari']) S.set('done_' + q);
    assert.equal(questStatus(S).find((s) => s.q.id === 'moon').available, true);
    assert.equal(mainComplete(S), false);
    for (const id of MAIN_IDS) S.set('done_' + id);
    assert.equal(mainComplete(S), true);
});

test('Quest steps are plain questions about the state', () => {
    const S = new DreamState();
    S.counts.flower = 8;
    ['Octavia', 'Gary', 'Crabs', 'Grandma'].forEach((n) => S.set('invite' + n));
    S.set('planned');
    S.set('weddingDone');
    S.set('metSage');
    const w = questStatus(S).find((s) => s.q.id === 'wedding');
    assert.ok(w.done && w.steps.every((x) => x.done));
    const safari = questStatus(S).find((s) => s.q.id === 'safari');
    ['turtle', 'manta', 'dolphin', 'jelly', 'octopus'].forEach((p) => S.album.add(p));
    assert.equal(questStatus(S).find((s) => s.q.id === 'safari').done, false, 'five photos are not enough');
    S.album.add('shark');
    assert.equal(questStatus(S).find((s) => s.q.id === 'safari').done, true);
    void safari;
});

test('Every objective marker the quests ask for is one the world can find', () => {
    const src = fs.readFileSync(new URL('../../js/game/mermaid/mermaidWorldPlay.js', import.meta.url), 'utf8');
    const known = new Set([...src.matchAll(/case '([\w]+)':/g)].map((m) => m[1]));
    const S = new DreamState();
    const states = [new DreamState(), (() => { const s = new DreamState(); s.set('metSage'); s.set('planned'); s.set('bubblesAsked'); s.set('hasMap'); return s; })()];
    for (const s of states) {
        for (const q of QUESTS) for (const step of q.steps) {
            if (!step.marker) continue;
            for (const name of step.marker(s)) assert.ok(known.has(name), `${q.id}/${step.id} points at "${name}"`);
        }
    }
    void S;
});

test('Save and load round-trip', () => {
    const store = new Map();
    globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
    const S = new DreamState();
    S.look = defaultLook();
    S.money = 321;
    S.owned.add('hair_crest');
    S.pearls.add(3);
    S.pearls.add(9);
    S.album.add('turtle');
    S.set('metSage');
    S.counts.glowOrb = 2;
    S.plants.push({ plot: 1, type: 'fan', t0: 10 });
    S.save();
    const T = new DreamState();
    assert.equal(T.load(), true);
    assert.equal(T.money, 321);
    assert.ok(T.owned.has('hair_crest') && T.pearls.has(9) && T.album.has('turtle'));
    assert.equal(T.has('metSage'), true);
    assert.equal(T.counts.glowOrb, 2);
    assert.equal(T.plants[0].type, 'fan');
    T.wipe();
    assert.equal(T.money, 150, 'a new dream starts with the usual money');
    assert.ok(T.look, 'but you keep your mermaid');
    delete globalThis.localStorage;
});

test('Rhythm charts are repeatable and stay on the four lanes', () => {
    const song = { seed: 11, beats: 64, density: 0.5 };
    const a = makeChart(song), b = makeChart(song);
    assert.deepEqual(a.map((n) => [n.beat, n.lane]), b.map((n) => [n.beat, n.lane]));
    assert.ok(a.length > 20, 'a real chart');
    assert.ok(a.every((n) => n.lane >= 0 && n.lane < 4 && n.beat >= 4 && n.beat < 64));
    for (let i = 1; i < a.length; i++) assert.ok(a[i].beat > a[i - 1].beat, 'notes come in order');
});

test('The world data is consistent', () => {
    assert.ok(LANDMARKS.length >= 8);
    assert.equal(new Set(AREAS.map((a) => a.id)).size, AREAS.length, 'unique area ids');
    assert.equal(TREASURES.length, 5);
    assert.equal(GARDEN.plots.length, 6);
    assert.equal(RING_RUN.rings.length, 14);
    assert.ok(RING_RUN.gold < RING_RUN.silver && RING_RUN.silver < RING_RUN.bronze);
    assert.ok(PHOTO_TARGETS.length >= 8);
    assert.ok(TALKING_FISH.every((f) => f.at.length === 3));
    const ids = WEDDING.steps.map((s) => s.id);
    for (const need of ['theme', 'dress', 'partner', 'bouquet', 'cake', 'music', 'vows', 'moments', 'guests']) assert.ok(ids.includes(need), `planner has ${need}`);
});
