/**
 * js/game/mermaid/mermaidState.js
 *
 * Everything the dream remembers (saved in localStorage between trips): your look, money, what you
 * own, flags and counters, collectibles, the garden, the album, achievements. And the quest log:
 * the main story (dive in, the wedding, mall day, the snapshot safari, the ring run, the missing
 * Moon Pearl) and the side quests, each a list of steps that are simply questions about the state.
 */

import { START_MONEY, normalizeLook, defaultLook, PEARL_COUNT, SHELL_COUNT, TREASURES, GARDEN, LANDMARKS, TALKING_FISH, PHOTO_TARGETS, RING_RUN } from './mermaidData.js';

export const SAVE_KEY = 'kajsim_mermaid_save_v2';
const OLD_LOOK_KEY = 'kajsim_mermaid_look';

export class DreamState {
    constructor() {
        this.reset();
    }

    reset(keepLook = true) {
        const look = keepLook && this.look ? this.look : null;
        this.look = look;
        this.money = START_MONEY;
        this.owned = new Set();
        this.flags = {};
        this.counts = {};
        this.pearls = new Set();
        this.shells = new Set();
        this.treasures = new Set();
        this.plants = [];             // { plot, type, t0 }
        this.album = new Set();
        this.achievements = new Set();
        this.fishTalked = new Set();
        this.places = new Set();
        this.gifted = new Set();      // friend ids
        this.saved = [null, null, null];
        this.tracked = new Set(['dive']);
        this.settings = { music: 1, sens: 1, invertY: false, bloom: true, shadows: true };
        this.pet = 'none';
        this.tod = 0.2;
        this.ringBest = null;
        this.wedding = null;          // the choices (for a replayed ceremony)
        this.playTime = 0;
        this.ended = false;           // the Moon Pearl festival has happened
        this.pos = null;              // where you were swimming when you woke up
    }

    has(flag) {
        return !!this.flags[flag];
    }

    set(flag, v = true) {
        this.flags[flag] = v;
    }

    count(k) {
        return this.counts[k] || 0;
    }

    inc(k, n = 1) {
        this.counts[k] = (this.counts[k] || 0) + n;
        return this.counts[k];
    }

    serialize() {
        return {
            version: 2, look: this.look, money: this.money, owned: [...this.owned], flags: this.flags, counts: this.counts,
            pearls: [...this.pearls], shells: [...this.shells], treasures: [...this.treasures], plants: this.plants, album: [...this.album],
            achievements: [...this.achievements], fishTalked: [...this.fishTalked], places: [...this.places], gifted: [...this.gifted],
            saved: this.saved, tracked: [...this.tracked], settings: this.settings, pet: this.pet, tod: this.tod, ringBest: this.ringBest,
            wedding: this.wedding, playTime: this.playTime, ended: this.ended, pos: this.pos
        };
    }

    load() {
        try {
            const raw = localStorage.getItem(SAVE_KEY);
            if (raw) {
                const d = JSON.parse(raw);
                if (d && d.version === 2) {
                    this.look = d.look ? normalizeLook(d.look) : null;
                    this.money = d.money ?? START_MONEY;
                    this.owned = new Set(d.owned || []);
                    this.flags = d.flags || {};
                    this.counts = d.counts || {};
                    this.pearls = new Set(d.pearls || []);
                    this.shells = new Set(d.shells || []);
                    this.treasures = new Set(d.treasures || []);
                    this.plants = d.plants || [];
                    this.album = new Set(d.album || []);
                    this.achievements = new Set(d.achievements || []);
                    this.fishTalked = new Set(d.fishTalked || []);
                    this.places = new Set(d.places || []);
                    this.gifted = new Set(d.gifted || []);
                    this.saved = d.saved || [null, null, null];
                    this.tracked = new Set(d.tracked && d.tracked.length ? d.tracked : ['dive']);
                    this.settings = Object.assign(this.settings, d.settings || {});
                    this.pet = d.pet || 'none';
                    this.tod = d.tod ?? 0.2;
                    this.ringBest = d.ringBest ?? null;
                    this.wedding = d.wedding || null;
                    this.playTime = d.playTime || 0;
                    this.ended = !!d.ended;
                    this.pos = d.pos || null;
                    return true;
                }
            }
            // The first version only remembered how your mermaid looked
            const old = JSON.parse(localStorage.getItem(OLD_LOOK_KEY) || 'null');
            if (old && old.hairStyle) this.look = normalizeLook(old);
        } catch (e) { /* no storage */ }
        return false;
    }

    save() {
        try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.serialize())); } catch (e) { /* no storage */ }
    }

    wipe() {
        try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* no storage */ }
        const look = this.look;
        this.reset(false);
        this.look = look;
    }
}

// ================================================================================================
// Quests
// ================================================================================================
const FRIENDS_N = 3;
const MAIN_PARALLEL = ['wedding', 'mall', 'safari', 'ringrun'];

/**
 * api: { money(n), unlock(id), toast(text), achieve(id), flag(f) }; where(name) in the world gives positions
 * (a marker is [names] of things worth heading to next).
 */
export const QUESTS = [
    {
        id: 'dive', title: 'Dive In', main: true,
        desc: 'A new dream, a new tail. Get the hang of swimming and meet the elder of Mermaid Town.',
        available: () => true,
        steps: [
            { id: 'rings', text: 'Swim through the 4 training rings', done: (S) => S.count('trainingRings') >= 4, marker: (S) => ['trainingRing'] },
            { id: 'sage', text: 'Talk to Old Sage in Coral Plaza', done: (S) => S.has('metSage'), marker: () => ['sage'] }
        ],
        reward: (S, api) => { api.money(40); api.achieve('firstSwim'); api.toast('Chapter 1 complete! The town is yours to explore.'); }
    },
    {
        id: 'wedding', title: 'The Mermaid Wedding', main: true,
        desc: 'Coralie the seahorse is the best wedding planner in the reef. Plan the perfect ceremony, gather flowers, deliver the invitations and say "I do".',
        available: (S) => S.has('metSage'),
        lockedHint: 'Finish Chapter 1: talk to Old Sage in Coral Plaza.',
        steps: [
            { id: 'plan', text: 'Plan your wedding with Coralie (Coral Chapel)', done: (S) => S.has('planned'), marker: () => ['coralie'] },
            { id: 'flowers', text: 'Pick 8 sea flowers (Kelp Forest and Sea Garden)', done: (S) => S.count('flower') >= 8, marker: () => ['flower'] },
            {
                id: 'invites', text: 'Deliver the 4 invitations', done: (S) => ['Octavia', 'Gary', 'Crabs', 'Grandma'].every((n) => S.has('invite' + n)),
                marker: (S) => ['Octavia', 'Gary', 'Crabs', 'Grandma'].filter((n) => !S.has('invite' + n)).map((n) => 'invite' + n)
            },
            { id: 'ceremony', text: 'Hold the ceremony at the chapel', done: (S) => S.has('weddingDone'), marker: (S) => (S.has('planned') && S.count('flower') >= 8 ? ['coralie'] : []) }
        ],
        reward: (S, api) => { api.money(80); api.achieve('bride'); api.toast('Chapter complete: the wedding!'); }
    },
    {
        id: 'mall', title: 'Mall Day', main: true,
        desc: 'Round up your three best friends for a day at the Mermaid Mall: shopping, gifts, food, games and a selfie.',
        available: (S) => S.has('metSage'),
        lockedHint: 'Finish Chapter 1: talk to Old Sage in Coral Plaza.',
        steps: [
            { id: 'invite', text: 'Invite your friends (they hang out by the plaza)', done: (S) => S.has('friendsFollow') || S.has('mallInvited'), marker: () => ['friends'] },
            { id: 'self', text: 'Buy something for yourself at a mall shop', done: (S) => S.has('boughtSelf'), marker: () => ['mall'] },
            { id: 'gifts', text: 'Give each friend a gift (they like different things!)', done: (S) => S.gifted.size >= FRIENDS_N, marker: () => ['mall'] },
            { id: 'eat', text: 'Eat together at the Kelp Café', done: (S) => S.has('ate'), marker: () => ['cafe'] },
            { id: 'arcade', text: 'Win 10 tickets at the Clam Arcade', done: (S) => S.count('ticketsEarned') >= 10, marker: () => ['arcade'] },
            { id: 'selfie', text: 'Take a group selfie with all three friends (F)', done: (S) => S.has('selfie'), marker: () => ['friends'] }
        ],
        reward: (S, api) => { api.money(60); api.achieve('mallRat'); api.unlock('acc_headband'); api.toast('Mall Day complete! (+ Pearl Headband unlocked)'); }
    },
    {
        id: 'safari', title: 'Snapshot Safari', main: true,
        desc: 'The reef is full of shy creatures. Raise your camera (F) and photograph them: turtles, rays, dolphins, jellyfish and more.',
        available: (S) => S.has('metSage'),
        lockedHint: 'Finish Chapter 1: talk to Old Sage in Coral Plaza.',
        steps: [{ id: 'photos', text: 'Photograph 6 different creatures', done: (S) => S.album.size >= 6, marker: () => ['roamer'] }],
        reward: (S, api) => { api.money(100); api.achieve('photog'); api.toast('Safari complete! Your album is something to be proud of.'); }
    },
    {
        id: 'ringrun', title: 'The Ring Run', main: true,
        desc: 'Zip the dolphin lane at Pearl Lagoon: swim through all 14 rings before the clock runs out.',
        available: (S) => S.has('metSage'),
        lockedHint: 'Finish Chapter 1: talk to Old Sage in Coral Plaza.',
        steps: [{ id: 'run', text: `Finish the Ring Run in under ${RING_RUN.bronze} seconds`, done: (S) => S.ringBest != null && S.ringBest <= RING_RUN.bronze, marker: () => ['ringStart'] }],
        reward: (S, api) => { api.money(60); api.toast('You can always beat your best time at the Lagoon (gold: ' + RING_RUN.gold + 's).'); }
    },
    {
        id: 'moon', title: 'The Missing Moon Pearl', main: true,
        desc: 'The Moon Pearl that lights the whole town has vanished. Follow the clues across the reef, wake the temple, find the thief and bring the pearl home.',
        available: (S) => MAIN_PARALLEL.filter((q) => S.has('done_' + q)).length >= 3,
        lockedHint: 'Finish three of the chapters above first (the wedding, mall day, safari or ring run).',
        steps: [
            { id: 'clues', text: 'Gather 3 clues (Bubbles, Glenda and Luna know something)', done: (S) => ['clueBubbles', 'clueGlenda', 'clueLuna'].every((f) => S.has(f)), marker: (S) => ['clueBubbles', 'clueGlenda', 'clueLuna'].filter((f) => !S.has(f)).map((f) => 'who_' + f) },
            { id: 'temple', text: 'Wake the Sunken Temple (solve the glyph puzzle)', done: (S) => S.has('vaultOpen'), marker: () => ['temple'] },
            { id: 'orbs', text: 'Collect 5 glow orbs inside the Glow Caves', done: (S) => S.count('glowOrb') >= 5, marker: () => ['orb'] },
            { id: 'battle', text: 'Win the rhythm battle against Gerald the crab', done: (S) => S.has('geraldBeaten'), marker: () => ['gerald'] },
            { id: 'return', text: 'Return the Moon Pearl to the top of the chapel tower', done: (S) => S.has('pearlReturned'), marker: () => ['socket'] }
        ],
        reward: (S, api) => { api.unlock('reward:moonCrown'); api.unlock('reward:moonPendant'); api.unlock('reward:aura'); api.money(150); api.achieve('pearlSaver'); api.toast('You saved the Moon Pearl! Moon Crown, Moon Pendant and Moon Aura unlocked.'); }
    },
    // ---- Side quests ----
    {
        id: 'treasure', title: 'X Marks the Spot', side: true,
        desc: 'Captain Barnacle (at the sunken ship) and the Trinket Trove sell old treasure maps. Follow the riddles and dig up five chests.',
        available: () => true,
        steps: [
            { id: 'map', text: 'Get a treasure map (Captain Barnacle or Trinket Trove)', done: (S) => S.has('hasMap'), marker: () => ['barnacle'] },
            { id: 'dig', text: 'Dig up the 5 treasures (hold E on the spot)', done: (S) => S.treasures.size >= TREASURES.length, marker: () => ['treasureSpot'] }
        ],
        reward: (S, api) => { api.money(100); api.achieve('treasure'); }
    },
    {
        id: 'garden', title: 'Green Fins', side: true,
        desc: 'Professor Urchin lends you a plot in the Sea Garden. Plant six seeds and watch them bloom.',
        available: () => true,
        steps: [
            { id: 'plant', text: 'Plant 6 seeds in the Sea Garden', done: (S) => S.plants.length >= GARDEN.plots.length, marker: () => ['garden'] },
            { id: 'grow', text: 'Wait for them to bloom', done: (S) => S.plants.length >= GARDEN.plots.length && S.has('gardenBloomed'), marker: () => ['garden'] }
        ],
        reward: (S, api) => { api.money(60); api.achieve('gardener'); }
    },
    {
        id: 'pet', title: 'Best Friends', side: true,
        desc: 'Adopt a pet at the Pet Nook (Tilda runs it) or win one at the arcade. It will follow you everywhere.',
        available: () => true,
        steps: [{ id: 'adopt', text: 'Adopt a pet', done: (S) => S.pet !== 'none', marker: () => ['petnook'] }],
        reward: (S, api) => { api.money(20); api.achieve('pet'); }
    },
    {
        id: 'pearls', title: 'Pearl Collector', side: true,
        desc: 'Glowing pearls and rare shells are scattered all over the reef. Collect 25 pearls.',
        available: () => true,
        steps: [{ id: 'pearls', text: `Collect 25 pearls (${PEARL_COUNT} exist)`, done: (S) => S.pearls.size >= 25, marker: () => ['pearl'] }],
        reward: (S, api) => { api.money(80); api.achieve('collector'); api.unlock('acc_coral'); }
    },
    {
        id: 'concert', title: 'Headliner', side: true,
        desc: 'DJ Dolph at the Music Grotto needs a partner. Play three songs on the big stage.',
        available: () => true,
        steps: [{ id: 'sets', text: 'Play 3 songs at the Music Grotto', done: (S) => S.count('concerts') >= 3, marker: () => ['grotto'] }],
        reward: (S, api) => { api.money(70); api.achieve('concert'); api.unlock('aura_sparkles'); }
    },
    {
        id: 'deep', title: 'Deep Diver', side: true,
        desc: 'Beyond the southern reef the seabed simply falls away. How deep does it go?',
        available: () => true,
        steps: [{ id: 'bottom', text: 'Swim down and touch the relic at the bottom of the Deep Trench', done: (S) => S.has('trenchRelic'), marker: () => ['trench'] }],
        reward: (S, api) => { api.money(100); api.achieve('diver'); api.unlock('cape_wings'); }
    },
    {
        id: 'explorer', title: 'Cartographer', side: true,
        desc: 'Visit every landmark of Mermaid World and talk to its fish.',
        available: () => true,
        steps: [
            { id: 'places', text: `Discover all ${LANDMARKS.length} landmarks`, done: (S) => LANDMARKS.every((l) => S.places.has(l.id)), marker: () => ['undiscovered'] },
            { id: 'fish', text: `Talk to all ${TALKING_FISH.length} fish`, done: (S) => TALKING_FISH.every((f) => S.fishTalked.has(f.id)), marker: () => ['fish'] }
        ],
        reward: (S, api) => { api.money(90); api.achieve('explorer'); api.achieve('chatty'); }
    }
];

export const MAIN_IDS = QUESTS.filter((q) => q.main).map((q) => q.id);

/** Evaluates the quest log: returns [{ q, steps:[{ step, done }], done, available }] */
export function questStatus(S) {
    return QUESTS.map((q) => {
        const steps = q.steps.map((st) => ({ step: st, done: !!st.done(S) }));
        const done = steps.every((s) => s.done);
        return { q, steps, done, available: q.available(S) };
    });
}

/**
 * Applies rewards for quests that just became complete (once each), unlocking others.
 * Returns the list of quest ids completed this call.
 */
export function settleQuests(S, api) {
    const finished = [];
    for (const st of questStatus(S)) {
        const key = 'done_' + st.q.id;
        if (st.available && st.done && !S.has(key)) {
            S.set(key);
            finished.push(st.q.id);
            try { st.q.reward && st.q.reward(S, api); } catch (e) { console.warn(e); }
        }
    }
    // Achievements that are plain counters
    if (S.pearls.size >= 25) api.achieve('collector');
    if (S.album.size >= 6) api.achieve('photog');
    if (S.ringBest != null && S.ringBest <= RING_RUN.gold) api.achieve('speedy');
    if (LANDMARKS.every((l) => S.places.has(l.id))) api.achieve('explorer');
    if (TALKING_FISH.every((f) => S.fishTalked.has(f.id))) api.achieve('chatty');
    return finished;
}

export function mainComplete(S) {
    return MAIN_IDS.every((id) => S.has('done_' + id));
}
