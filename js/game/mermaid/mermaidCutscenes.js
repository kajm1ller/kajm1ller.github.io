/**
 * js/game/mermaid/mermaidCutscenes.js
 *
 * The set pieces, installed onto MermaidWorld: your wedding at the Coral Chapel (built from the
 * choices made with Coralie: theme, dress, partner, bouquet, cake, music, vows, moments, guests),
 * the Moon Pearl festival when you put the pearl back, and the meal at the Kelp Café.
 * A cutscene is { t, dur, update(t, dt), done() } run by MermaidWorld.frame while mode === 'cutscene'.
 */

import * as THREE from 'three';
import { buildMermaid, animateMermaid, starGeometry } from './mermaidModel.js';
import { buildTalkingFish, buildCrab, buildOctopus, buildSeahorse, buildShark, buildWhale, buildDolphin, buildJelly, buildManta, buildTurtle, buildFish } from './mermaidCreatures.js';
import { buildPlant } from './mermaidTown.js';
import { floorHeight } from './mermaidEnv.js';
import { TWO_PI, between, pick, clamp, std, mat, mesh, glowSprite, glowTexture, angleDiff, shade, lerpColor } from './mermaidKit.js';
import { WEDDING, VOWS, TALKING_FISH, SHOPS, FRIEND_LINES, normalizeLook, randomLook, GARDEN } from './mermaidData.js';

const rand = Math.random;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

export function installCutscenes(MW) {
    const P = MW.prototype;

    /** Eases the camera towards a position and target (used by every cutscene). */
    P._camAt = function (pos, target, rate = 0.06) {
        this.camera.position.lerp(pos, rate);
        this._camTarget = (this._camTarget || target.clone()).lerp(target, rate * 1.3);
        this.camera.lookAt(this._camTarget);
    };

    P._beginCut = function (cut) {
        this.mode = 'cutscene';
        this.ui.setPrompt(null);
        this.ui.setFinder(false);
        this.photoOn = false;
        this.player.m.root.visible = true;
        this._freeMouse();
        this.cut = Object.assign({ t: 0, dur: 10 }, cut);
        this._camTarget = null;
        if (this.cut.dur > 8) this.ui.toast('Esc skips the scene');
    };

    // ---------------------------------------------------------------------------------------------
    // Eating together
    // ---------------------------------------------------------------------------------------------
    P._eat = function (item, shop) {
        const S = this.S;
        const tables = this.refs.tables;
        let table = tables[0], bd = 1e9;
        for (const t of tables) {
            const d = t.distanceTo(this.player.pos);
            if (d < bd) { bd = d; table = t; }
        }
        const following = S.has('friendsFollow') && !S.has('mallFinished');
        const people = [{ p: this.player, m: this.player.m, isPlayer: true }];
        if (following) for (const f of this.friends) people.push({ p: f, m: f.m, f });
        const seats = people.map((o, i) => {
            const a = (i / people.length) * TWO_PI;
            return { o, pos: V3(table.x + Math.sin(a) * 3.2, table.y - 0.6, table.z + Math.cos(a) * 3.2), yaw: a + Math.PI };
        });
        const food = new THREE.Group();
        this.scene.add(food);
        const dishes = SHOPS.find((s) => s.kind === 'food').items;
        seats.forEach((s, i) => {
            const fx = table.x + (s.pos.x - table.x) * 0.42, fz = table.z + (s.pos.z - table.z) * 0.42;
            food.add(mesh(new THREE.CylinderGeometry(0.45, 0.4, 0.06, 16), std(0xffffff), fx, table.y + 0.03, fz));
            const col = i === 0 ? item.food : pick(dishes).food;
            food.add(mesh(new THREE.SphereGeometry(0.28, 12, 8), std(col), fx, table.y + 0.25, fz));
            if (item.effect === 'glow' || i > 0) food.add(mesh(new THREE.SphereGeometry(0.06, 6, 4), mat(0xffffff, { e: 1.5 }), fx, table.y + 0.6, fz));
        });
        const lines = [];
        if (following) {
            lines.push([2, `${this.friends[0].def.name}: "${pick(FRIEND_LINES.eat)}"`]);
            lines.push([5.5, `${this.friends[1].def.name}: "${pick(FRIEND_LINES.eat)}"`]);
        }
        this.ui.caption(`You order ${item.name}${following ? ' for the table' : ''}!`, 2500);
        const shown = new Set();
        this._beginCut({
            dur: 9,
            update: (t, dt) => {
                for (const s of seats) {
                    const o = s.o;
                    const root = o.m.root;
                    root.position.lerp(s.pos, 0.08);
                    root.rotation.set(0, s.yaw, 0);
                    if (o.isPlayer) { this.player.pos.copy(root.position); this.player.action = 'eat'; }
                    else { o.f.pos.copy(root.position); o.f.action = 'eat'; o.f.sit = true; }
                }
                const a = t * 0.25;
                this.camera.position.set(table.x + Math.sin(a) * 8, table.y + 3, table.z + Math.cos(a) * 8);
                this.camera.lookAt(table.x, table.y, table.z);
                for (const [at, text] of lines) if (t > at && !shown.has(at)) { shown.add(at); this.ui.caption(text, 2600); }
            },
            done: () => {
                this.player.action = null;
                this.friends.forEach((f) => { f.action = null; f.sit = false; });
                this.scene.remove(food);
                this.mode = 'explore';
                if (following) S.set('ate');
                this.ui.caption(`Yum! ${item.name}${following ? ' with the girls' : ''}.`, 3000);
                if (item.effect === 'speed') { this.foodBoost = 60; this.ui.toast('⚡ A burst of energy! You swim faster for a minute.'); }
                if (item.effect === 'glow') { this.glowT = 60; this.ui.toast('✨ You are sparkling!'); }
                if (item.effect === 'calm') this.ui.toast('😌 So relaxing.');
                if (this.audio) this.audio.chime();
                this.refreshQuests();
            }
        });
    };

    // ---------------------------------------------------------------------------------------------
    // The wedding
    // ---------------------------------------------------------------------------------------------
    P.runWedding = function (choices, replay = false) {
        const S = this.S;
        this._freeMouse();
        const base = floorHeight(0, -57);
        const ALTAR = V3(0, base + 3.2, -57);
        const AISLE = V3(0, base + 3.2, -34);
        const scene = this.scene;
        const set = new THREE.Group();
        scene.add(set);
        const theme = WEDDING.steps[0].options.find((o) => o.id === choices.theme.id);
        const tc = theme.color;
        const gnd = (x, z) => floorHeight(x, z);

        // The arch, dressed in the theme
        const archMat = std(tc, { roughness: 0.3, metalness: 0.2, emissive: choices.theme.id === 'glow' ? tc : 0x000000, emissiveIntensity: 0.6 });
        set.add(mesh(new THREE.TorusGeometry(4.6, 0.45, 10, 30, Math.PI), archMat, ALTAR.x, gnd(ALTAR.x, ALTAR.z) + 0.4, ALTAR.z - 2.5));
        for (let i = 0; i < 28; i++) {
            const a = (i / 27) * Math.PI;
            set.add(mesh(new THREE.SphereGeometry(0.28, 8, 6), std(choices.theme.id === 'treasure' ? 0xf1c40f : 0xffffff, { metalness: 0.4, roughness: 0.15 }), ALTAR.x + Math.cos(a) * 4.6, gnd(ALTAR.x, ALTAR.z) + 0.4 + Math.sin(a) * 4.6, ALTAR.z - 2.5));
        }
        if (choices.theme.id === 'treasure') for (let i = 0; i < 50; i++) set.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 10), std(0xf1c40f, { metalness: 0.9, roughness: 0.25 }), between(-6, 6), gnd(0, -54) + 0.8, between(-62, -42)));
        if (choices.theme.id === 'moon') for (let i = 0; i < 6; i++) set.add(mesh(new THREE.PlaneGeometry(1.2, 10), std(0xc8d6e5, { side: THREE.DoubleSide, transparent: true, opacity: 0.6, metalness: 0.6 }), -6 + i * 2.4, base + 7, ALTAR.z - 4));
        const glowLight = new THREE.PointLight(tc, 3, 34);
        glowLight.position.set(ALTAR.x, ALTAR.y + 3, ALTAR.z);
        set.add(glowLight);

        // The bouquet: plants along both sides of the aisle
        const bq = WEDDING.steps[3].options.find((o) => o.id === choices.bouquet.id);
        const plantId = { anemone: 'anemone', seaflower: 'seaflower', lavender: 'lavender', pearlbloom: 'bulb' }[bq.id];
        for (let i = 0; i < 12; i++) for (const s of [-1, 1]) {
            const p = buildPlant(plantId, bq.color, 1);
            const z = -36 - i * 1.6, x = s * 3.2;
            p.position.set(x, gnd(x, z) + 0.2, z);
            p.scale.setScalar(0.9 + (i % 3) * 0.15);
            set.add(p);
        }

        // You, in your wedding look; your partner waiting at the altar
        const weddingLook = Object.assign({}, S.look, { wedding: { style: choices.dress.id, color: choices.dress.color } });
        this._rebuildPlayer(weddingLook);
        this._placePlayer(AISLE.clone(), Math.PI);
        const partnerLooks = {
            kai: { ...randomLook(), male: true, hairStyle: 'pixie', hairColor: 0x2ec4b6, skin: 0xc68642, tail: 0, headAcc: 'none', lipstick: null, eyeshadow: null, lashes: 'none', blush: null, top: 'none', name: 'Kai', bottom: 'belt', cape: 'none', aura: 'none', earAcc: 'none', armAcc: 'none', neckAcc: 'none' },
            neptune: { ...randomLook(), male: true, hairStyle: 'long', hairColor: 0xf5f0e6, skin: 0xeac0a0, tail: 8, headAcc: 'crown', trident: true, lipstick: null, eyeshadow: null, lashes: 'none', blush: null, top: 'none', name: 'Prince Triton', bottom: 'none', cape: 'none', aura: 'none', earAcc: 'none', armAcc: 'cuffs', neckAcc: 'none' },
            pearl: { ...randomLook(), top: 'pearls', headAcc: 'tiara', name: 'Pearl', cape: 'none', aura: 'none' },
            finn: { ...randomLook(), male: true, hairStyle: 'bob', hairColor: 0x6b4a2b, skin: 0xf6d7c3, tail: 6, headAcc: 'none', lipstick: null, eyeshadow: null, lashes: 'none', blush: null, top: 'none', name: 'Finn', cape: 'none', aura: 'none', earAcc: 'none', armAcc: 'none', neckAcc: 'none', bottom: 'none' }
        };
        const partnerLook = normalizeLook(partnerLooks[choices.partner.id]);
        const partner = buildMermaid(partnerLook);
        partner.root.rotation.order = 'YXZ';
        partner.root.position.set(ALTAR.x + 1.2, ALTAR.y, ALTAR.z);
        set.add(partner.root);

        // Officiant
        let officiant;
        if (choices.moments.has('turtle')) {
            officiant = buildTurtle(0.9);
            officiant.rotation.x = -1.2;
        } else officiant = buildSeahorse(0xff9ff3, 1.3);
        officiant.position.set(ALTAR.x, ALTAR.y + 0.8, ALTAR.z - 3.5);
        set.add(officiant);

        // The cake
        const cake = this._cake(choices.cake);
        cake.position.set(ALTAR.x + 6, gnd(6, ALTAR.z), ALTAR.z + 1);
        set.add(cake);

        // Guests
        const guests = [];
        const seatsAt = (i) => V3((i % 2 ? 1 : -1) * (5.5 + (i % 4 > 1 ? 3.5 : 0)), base + 2.5 + rand(), -41 - Math.floor(i / 4) * 3.2);
        let gi = 0;
        const wedFriends = [];
        if (choices.guests.has('friends')) {
            for (const f of this.friends) {
                const pos = seatsAt(gi++);
                f.m.root.position.copy(pos);
                f.pos.copy(pos);
                f.m.root.rotation.set(0, Math.atan2(-pos.x, ALTAR.z - pos.z), 0);
                f.wedding = true;
                f.action = 'wave';
                wedFriends.push(f);
            }
        }
        if (choices.guests.has('fish')) {
            for (const d of TALKING_FISH.slice(0, 4)) {
                const fish = buildTalkingFish(d);
                fish.scale.multiplyScalar(0.8);
                fish.position.copy(seatsAt(gi++));
                fish.lookAt(ALTAR);
                set.add(fish);
                guests.push(fish);
            }
        }
        if (choices.guests.has('octopus')) {
            const o = buildOctopus(0xd1558a, 0.7);
            o.position.copy(seatsAt(gi++)).add(V3(0, 1, 0));
            set.add(o);
            guests.push(o);
        }
        if (choices.guests.has('crabs')) {
            for (let i = 0; i < 4; i++) {
                const c = buildCrab([0xe74c3c, 0xe67e22, 0xc0392b, 0xff7675][i], 0.7);
                c.position.set(between(-4, 4), gnd(0, -49), -44 + i * 1.5);
                set.add(c);
                guests.push(c);
            }
        }
        if (choices.guests.has('shark')) {
            const s = buildShark(0.7);
            s.position.set(-12, base + 8, -48);
            s.rotation.y = Math.PI / 2;
            set.add(s);
            guests.push(s);
        }
        if (choices.guests.has('whale')) {
            const w = buildWhale(0.7);
            w.position.set(0, base + 30, -70);
            set.add(w);
            guests.push(w);
        }

        // Extras for the moments
        const jellies = [], dolphins = [], seahorses = [], rays = [];
        if (choices.moments.has('jellies')) {
            for (let i = 0; i < 16; i++) {
                const j = buildJelly(pick([0xff9ff3, 0x48dbfb, 0xfeca57, 0x1dd1a1, 0xa29bfe]), 0.8);
                j.position.set(between(-12, 12), base - 2, between(-64, -39));
                j.visible = false;
                set.add(j);
                jellies.push({ j, sp: between(1, 2.2), ph: rand() * 10 });
            }
        }
        if (choices.moments.has('dolphins')) {
            for (let i = 0; i < 2; i++) {
                const d = buildDolphin(1.1);
                const ring = mesh(new THREE.TorusGeometry(0.45, 0.1, 8, 16), std(0xf1c40f, { metalness: 0.9, roughness: 0.2 }), 0, 0.9, 1.6);
                d.add(ring);
                d.visible = false;
                set.add(d);
                dolphins.push(d);
            }
        }
        if (choices.moments.has('seahorses')) {
            for (let i = 0; i < 8; i++) {
                const s = buildSeahorse(pick([0xfeca57, 0xff9ff3, 0x48dbfb, 0x1dd1a1]), 0.9);
                s.visible = false;
                set.add(s);
                seahorses.push(s);
            }
        }
        if (choices.moments.has('rays')) {
            for (let i = 0; i < 3; i++) {
                const r = buildManta(1.6);
                r.visible = false;
                set.add(r);
                rays.push(r);
            }
        }
        let bouquet = null;
        if (choices.moments.has('toss')) {
            bouquet = new THREE.Group();
            for (let i = 0; i < 7; i++) bouquet.add(mesh(new THREE.SphereGeometry(0.2, 8, 6), std(bq.color, { emissive: bq.color, emissiveIntensity: 0.5 }), Math.sin(i * 1.4) * 0.2, Math.cos(i * 1.4) * 0.12, Math.cos(i * 1.4) * 0.2));
            bouquet.visible = false;
            set.add(bouquet);
        }

        // Music
        if (this.audio) this.audio.setStyle(choices.music.id);
        const musicName = WEDDING.steps.find((s) => s.id === 'music').options.find((o) => o.id === choices.music.id).name;
        const partnerName = partnerLook.name;
        const vows = VOWS[choices.vows.id];
        const P_ = this.player;
        const altarEnd = V3(ALTAR.x - 1.2, ALTAR.y, ALTAR.z);
        let partnerAction = null;

        // Timeline
        const segs = [];
        segs.push({ dur: 8, cap: `♪ ${musicName} plays as ${S.look.name} swims down the aisle...`, update: (t) => {
            P_.m.root.position.lerpVectors(AISLE, altarEnd, Math.min(1, t / 7.4));
            P_.swim = 0.4;
            this._camAt(V3(7, base + 6, -28), V3(0, base + 3, -52));
        } });
        segs.push({ dur: 12, cap: choices.moments.has('turtle') ? 'The wise old turtle begins the ceremony...' : 'Coralie, teary-eyed, begins the ceremony...', update: (t) => {
            P_.swim = 0;
            P_.m.root.rotation.y = Math.PI / 2;
            partner.root.rotation.y = -Math.PI / 2;
            this._camAt(V3(0, ALTAR.y + 1.5, ALTAR.z + 7), V3(ALTAR.x, ALTAR.y + 0.6, ALTAR.z - 1));
            if (t > 2.5 && !segs[1]._v1) { segs[1]._v1 = true; this.ui.caption(`"Do you, ${S.look.name}, take ${partnerName}?"\n${vows[0]}`, 4600); }
            if (t > 7.5 && !segs[1]._v2) { segs[1]._v2 = true; this.ui.caption(`"And do you, ${partnerName}?"\n${vows[1]}`, 4000); }
        } });
        const moment = (id, cap, update, dur = 6) => { if (choices.moments.has(id)) segs.push({ dur, cap, update }); };
        const orbit = (t, r = 15, h = 6) => this._camAt(V3(Math.sin(t * 0.3) * r, ALTAR.y + h, ALTAR.z + Math.cos(t * 0.3) * r), V3(ALTAR.x, ALTAR.y + 1.5, ALTAR.z));
        moment('dolphins', 'Dolphin ring bearers swoop in with the rings!', (t) => {
            dolphins.forEach((d, i) => {
                d.visible = true;
                const k = t / 5;
                d.position.set((i ? 1 : -1) * (16 - k * 15), ALTAR.y + 4 + Math.sin(k * Math.PI) * 4, ALTAR.z + (i ? 2 : -2));
                d.rotation.y = i ? -Math.PI / 2 : Math.PI / 2;
                d.userData.update(t, 0.6);
            });
            orbit(t, 13, 5);
        });
        moment('bubbles', 'A bubble arch bursts into the water!', (t) => {
            if (t < 0.05) {
                for (let i = 0; i < 6; i++) {
                    const a = (i / 5) * Math.PI;
                    this._burst(V3(ALTAR.x + Math.cos(a) * 4.6, gnd(0, ALTAR.z) + 0.4 + Math.sin(a) * 4.6, ALTAR.z - 2.5), 40, 0xffffff, 3, 0.6, 4);
                }
                if (this.audio) this.audio.bubble();
            }
            orbit(t + 4);
        });
        moment('jellies', 'Jellyfish light up the whole reef!', (t) => {
            for (const J of jellies) {
                J.j.visible = true;
                J.j.position.y = base - 2 + t * J.sp * 2.2;
                J.j.userData.update(t + J.ph, 0.2);
            }
            glowLight.intensity = 3 + Math.sin(t * 6) * 2;
            orbit(t + 8, 18, 8);
        });
        moment('seahorses', 'The seahorse parade swims by!', (t) => {
            seahorses.forEach((s, i) => {
                s.visible = true;
                s.position.set(-16 + t * 6 - i * 2, ALTAR.y + 0.5 + Math.sin(t * 5 + i) * 0.3, ALTAR.z + 5);
                s.rotation.y = Math.PI / 2;
                s.userData.update(t + i, 0.3);
            });
            this._camAt(V3(0, ALTAR.y + 2, ALTAR.z + 14), V3(0, ALTAR.y + 1, ALTAR.z + 4));
        });
        moment('rays', 'Manta rays glide over the ceremony.', (t) => {
            rays.forEach((r, i) => {
                r.visible = true;
                r.position.set(-30 + t * 8 + i * 6, ALTAR.y + 10 + i * 2, ALTAR.z - 6 + i * 6);
                r.rotation.y = Math.PI / 2;
                r.userData.update(t + i, 0.5);
            });
            this._camAt(V3(0, ALTAR.y + 1, ALTAR.z + 15), V3(0, ALTAR.y + 10, ALTAR.z));
        });
        moment('dance', 'Your first dance!', (t) => {
            const a = t * 1.4;
            P_.m.root.position.set(ALTAR.x + Math.cos(a) * 1.1, ALTAR.y + 0.5, ALTAR.z + Math.sin(a) * 1.1);
            partner.root.position.set(ALTAR.x - Math.cos(a) * 1.1, ALTAR.y + 0.5, ALTAR.z - Math.sin(a) * 1.1);
            P_.m.root.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a));
            partner.root.rotation.y = Math.atan2(Math.cos(a), Math.sin(a));
            P_.action = 'dance';
            partnerAction = 'dance';
            wedFriends.forEach((f) => { f.action = 'cheer'; });
            orbit(t + 12, 9, 3);
        }, 8);
        moment('cakecut', `Cutting the ${choices.cake.tiers}-tier cake!`, (t) => {
            P_.action = 'hold';
            partnerAction = 'hold';
            P_.m.root.position.lerp(V3(cake.position.x - 1.5, ALTAR.y, cake.position.z + 1.5), 0.05);
            partner.root.position.lerp(V3(cake.position.x + 1.5, ALTAR.y, cake.position.z + 1.5), 0.05);
            if (cake.userData.slice) cake.userData.slice.position.set(Math.min(1.2, t * 0.5), cake.userData.slice.userData.y, Math.min(1.5, t * 0.6));
            this._camAt(V3(cake.position.x, cake.position.y + 4, cake.position.z + 7), cake.position.clone().add(V3(0, 1.5, 0)));
        });
        moment('toss', 'The bouquet toss!', (t) => {
            P_.m.root.position.lerp(V3(ALTAR.x - 2, ALTAR.y, ALTAR.z + 3), 0.05);
            P_.m.root.rotation.y = 0;
            bouquet.visible = true;
            const k = Math.min(1, t / 3);
            const target = wedFriends[0] ? wedFriends[0].m.root.position : V3(-6, base + 3, -44);
            bouquet.position.lerpVectors(V3(ALTAR.x - 2, ALTAR.y + 1.4, ALTAR.z + 3), target, k);
            bouquet.position.y += Math.sin(k * Math.PI) * 3.5;
            bouquet.rotation.y = t * 8;
            wedFriends.forEach((f) => { f.action = 'cheer'; });
            this._camAt(V3(0, ALTAR.y + 3, ALTAR.z + 12), V3(-3, ALTAR.y + 2, ALTAR.z - 3));
        });
        moment('plankton', 'Glowing plankton fireworks!', (t) => {
            if (Math.floor(t * 1.2) !== Math.floor((t - 1 / 60) * 1.2)) {
                this._burst(V3(between(-10, 10), base + between(12, 20), between(-69, -49)), 120, pick([0xff9ff3, 0x48dbfb, 0xfeca57, 0x1dd1a1]), 7, 0.5, 2.5, true);
                if (this.audio) this.audio.chime();
            }
            this._camAt(V3(0, ALTAR.y + 1, ALTAR.z + 18), V3(0, base + 14, ALTAR.z - 4));
        });
        segs.push({ dur: 7, cap: `Just married! 💕\n${S.look.name} & ${partnerName}`, update: (t) => {
            P_.action = 'wave';
            partnerAction = 'wave';
            wedFriends.forEach((f) => { f.action = 'cheer'; });
            if (t < 0.05) for (let i = 0; i < 5; i++) this._burst(V3(between(-6, 6), ALTAR.y + 4, ALTAR.z + between(-3, 3)), 60, pick([0xff9ff3, 0xffffff, 0xfeca57]), 4, 0.45, 4);
            orbit(t + 20, 11, 4);
        } });

        let si = 0, segT = 0;
        this.ui.caption(segs[0].cap, 4000);
        this._beginCut({
            dur: segs.reduce((a, s) => a + s.dur, 0),
            update: (t, dt) => {
                segT += dt;
                if (segT > segs[si].dur && si < segs.length - 1) {
                    si++;
                    segT = 0;
                    P_.action = null;
                    partnerAction = null;
                    wedFriends.forEach((f) => { f.action = 'wave'; });
                    this.ui.caption(segs[si].cap, 4200);
                }
                segs[si].update(segT);
                animateMermaid(partner, this.time, { swim: 0, action: partnerAction, dt });
                officiant.rotation.y = Math.sin(this.time) * 0.2;
                if (officiant.userData.update) officiant.userData.update(this.time, 0.1);
                for (const g of guests) {
                    g.rotation.z = Math.sin(this.time * 2 + g.position.x) * 0.05;
                    if (g.userData.update) g.userData.update(this.time, 0.2);
                }
            },
            done: () => {
                P_.action = null;
                for (const f of this.friends) { f.wedding = false; f.action = null; }
                scene.remove(set);
                this._rebuildPlayer(S.look);
                this._placePlayer(V3(0, base + 4, -28), Math.PI);
                this.camYaw = Math.PI;
                if (this.audio) { this._styleWant = null; this.audio.setStyle('town'); }
                this.mode = 'explore';
                if (!replay) {
                    S.set('weddingDone');
                    this.ui.caption('Wedding planned - and what a wedding! 💒', 3500);
                    this.refreshQuests();
                } else this.ui.caption('What a day. 💒', 2500);
            }
        });
    };

    P._cake = function (c) {
        const g = new THREE.Group();
        const flavor = WEDDING.steps.find((s) => s.id === 'cake').flavors.find((f) => f.id === c.flavor);
        g.add(mesh(new THREE.CylinderGeometry(1.4, 1.6, 2.4, 16), std(0xfff5f8), 0, 1.2, 0));
        let y = 2.4;
        for (let i = 0; i < c.tiers; i++) {
            const r = 1.2 - i * (0.8 / c.tiers);
            const h = 0.55;
            g.add(mesh(new THREE.CylinderGeometry(r, r, h, 24), std(flavor.color, { roughness: 0.5 }), 0, y + h / 2, 0));
            const frost = mesh(new THREE.TorusGeometry(r, 0.06, 6, 24), std(0xffffff), 0, y + h, 0);
            frost.rotation.x = Math.PI / 2;
            g.add(frost);
            for (let k = 0; k < 10; k++) {
                const a = (k / 10) * TWO_PI;
                g.add(mesh(new THREE.SphereGeometry(0.06, 6, 4), std(0xffffff, { metalness: 0.3, roughness: 0.1 }), Math.sin(a) * r, y + 0.1, Math.cos(a) * r));
            }
            y += h;
        }
        const slice = mesh(new THREE.BoxGeometry(0.4, 0.5, 0.5), std(flavor.color), 0, 2.65, 1.0);
        slice.userData.y = 2.65;
        g.add(slice);
        g.userData.slice = slice;
        const top = new THREE.Group();
        top.position.y = y;
        if (c.topper === 'pearl') top.add(mesh(new THREE.SphereGeometry(0.35, 16, 12), std(0xffffff, { roughness: 0.05, metalness: 0.4, emissive: 0xe0f7ff, emissiveIntensity: 0.4 }), 0, 0.35, 0));
        else if (c.topper === 'starfish') top.add(mesh(starGeometry(0.4, 0.1), std(0xf1c40f, { metalness: 0.8, roughness: 0.25 }), 0, 0.45, 0));
        else if (c.topper === 'seahorses') {
            for (const sx of [-1, 1]) {
                const s = buildSeahorse(sx > 0 ? 0xff9ff3 : 0x48dbfb, 0.3);
                s.position.set(sx * 0.18, 0.1, 0);
                s.rotation.y = -sx * Math.PI / 2;
                top.add(s);
            }
        } else {
            for (const sx of [-1, 1]) {
                const m = buildMermaid(normalizeLook({ ...randomLook(), hairColor: sx > 0 ? this.S.look.hairColor : 0x3b2416, aura: 'none', cape: 'none' }));
                m.root.scale.setScalar(0.18);
                m.root.position.set(sx * 0.12, 0.3, 0);
                top.add(m.root);
            }
        }
        g.add(top);
        return g;
    };

    // ---------------------------------------------------------------------------------------------
    // The Moon Pearl festival
    // ---------------------------------------------------------------------------------------------
    P.runFestival = function () {
        const S = this.S;
        this._freeMouse();
        const sock = this.socket.pos;
        const base = floorHeight(0, -78);
        const scene = this.scene;
        const P_ = this.player;
        const cx = 0, cz = -50;
        // fly the player under the tower
        this._placePlayer(V3(0, base + 8, -42), Math.PI);
        const pearl = new THREE.Mesh(new THREE.SphereGeometry(1.2, 28, 20), new THREE.MeshStandardMaterial({ color: 0xfdfbe8, emissive: 0xfff3b0, emissiveIntensity: 1.6, roughness: 0.05 }));
        const pearlGlow = glowSprite(0xfff3b0, 16, 0.7);
        pearl.add(pearlGlow);
        pearl.position.copy(P_.pos).add(V3(0, 2.6, 2));
        scene.add(pearl);
        // lanterns that float up from the town
        const lanternMat = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb347, emissiveIntensity: 1.6 });
        const N = 70;
        const lanterns = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 8, 6), lanternMat, N);
        lanterns.frustumCulled = false;
        scene.add(lanterns);
        const ld = Array.from({ length: N }, () => ({ x: between(-50, 50), z: between(-60, 20), y0: between(base + 1, base + 6), sp: between(1.5, 3.2), ph: rand() * 6 }));
        const m4 = new THREE.Matrix4();
        // festival jellies
        const jel = [];
        for (let i = 0; i < 14; i++) {
            const j = buildJelly(pick([0xff9ff3, 0x48dbfb, 0xfeca57, 0x1dd1a1, 0xa29bfe]), 1.3);
            j.position.set(between(-30, 30), base + between(6, 24), between(-70, 10));
            scene.add(j);
            jel.push({ j, ph: rand() * 8 });
        }
        S.set('hasMoonPearl');
        const savedTod = S.tod;
        this.ui.caption('The night of the Moon Pearl...', 4000);
        if (this.audio) this.audio.setStyle('festival');
        const night = 0.74;
        let todStart = S.tod;
        const people = [...this.friends, ...(this.refs.townsfolk || [])];
        this._beginCut({
            holdTime: true,
            dur: 34,
            update: (t, dt) => {
                // the tide turns to night
                S.tod = todStart + (night - todStart + (night < todStart ? 1 : 0)) * clamp(t / 6, 0, 1);
                S.tod %= 1;
                this.env.setTime(S.tod);
                if (t < 10) {
                    // the pearl rises up the tower
                    const k = clamp((t - 3) / 6, 0, 1);
                    const e = k * k * (3 - 2 * k);
                    pearl.position.lerpVectors(P_.pos.clone().add(V3(0, 2.6, 2)), sock, e);
                    pearl.position.x += Math.sin(k * 12) * (1 - k) * 2;
                    this._camAt(V3(0, base + 10 + e * 28, -38 + e * 6), pearl.position.clone().add(V3(0, 0, 0)), 0.05);
                    P_.action = 'hold';
                    if (t < 3) this._camAt(V3(6, P_.pos.y + 2, P_.pos.z + 8), P_.pos.clone(), 0.08);
                }
                if (t >= 10 && !this._pearlSet) {
                    this._pearlSet = true;
                    S.set('pearlReturned');
                    S.ended = true;
                    this.socket.g.visible = true;
                    scene.remove(pearl);
                    this._burst(sock, 160, 0xfff3b0, 14, 0.9, 4, true);
                    this.ui.caption('The Moon Pearl shines again!', 4200);
                    if (this.audio) { this.audio.success(); this.audio.whaleCall(true); }
                    this.ui.flash();
                }
                if (t >= 10) {
                    P_.action = 'cheer';
                    // a slow orbit of the lit tower
                    const a = (t - 10) * 0.18;
                    this._camAt(V3(Math.sin(a) * 40, base + 22 + Math.sin(a * 0.7) * 6, -78 + Math.cos(a) * 40), V3(0, base + 22, -78), 0.05);
                    if (Math.floor(t * 0.9) !== Math.floor((t - dt) * 0.9)) this._burst(V3(between(-25, 25), base + between(25, 45), between(-100, -50)), 130, pick([0xff9ff3, 0x48dbfb, 0xfeca57, 0x1dd1a1, 0xffffff]), 8, 0.55, 2.6, true);
                    for (const p of people) {
                        if (p.m) {
                            p.action = 'cheer';
                            p.actionT = 0.3;
                        }
                    }
                }
                lanterns.visible = t > 8;
                ld.forEach((l, i) => {
                    const y = l.y0 + Math.max(0, t - 8) * l.sp + Math.sin(t + l.ph) * 0.4;
                    lanterns.setMatrixAt(i, m4.makeTranslation(l.x + Math.sin(t * 0.3 + l.ph) * 2, y, l.z));
                });
                lanterns.instanceMatrix.needsUpdate = true;
                for (const j of jel) {
                    j.j.position.y += Math.sin(t + j.ph) * 0.01;
                    j.j.userData.update(t + j.ph, 0.2);
                }
                P_.swim = 0;
            },
            done: () => {
                if (!S.has('pearlReturned')) {            // (skipped before the pearl went up)
                    S.set('pearlReturned');
                    S.ended = true;
                    this.socket.g.visible = true;
                    scene.remove(pearl);
                }
                this._pearlSet = false;
                scene.remove(lanterns);
                lanterns.dispose();
                for (const j of jel) scene.remove(j.j);
                P_.action = null;
                this._placePlayer(V3(0, base + 4, -30), Math.PI);
                this.camYaw = Math.PI;
                this.mode = 'explore';
                S.tod = night;
                this.env.setTime(S.tod);
                if (this.audio) { this._styleWant = null; this.audio.setStyle('town'); }
                this.achieve('pearlSaver');
                this.refreshQuests();
                setTimeout(() => this._end(), 1500);
            }
        });
    };
}
