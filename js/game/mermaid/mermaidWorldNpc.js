/**
 * js/game/mermaid/mermaidWorldNpc.js
 *
 * Mermaid World's living things, installed onto MermaidWorld: shopkeepers, the talking fish and the
 * story's characters (Coralie, Gerald, Captain Barnacle, Professor Urchin, Gary, Grandma Whale...),
 * your three friends and your pet, the wildlife that roams the reef (and can be photographed), the
 * schools of fish, and what everyone says (which depends on how far along you are).
 */

import * as THREE from 'three';
import { buildMermaid, animateMermaid } from './mermaidModel.js';
import {
    buildTalkingFish, buildCrab, buildOctopus, buildSeahorse, buildShark, buildWhale, buildTurtle, buildPuffer, buildJelly, buildRoamer, buildAngler, schoolFishGeometry, buildFish
} from './mermaidCreatures.js';
import { buildProfessor } from './mermaidTown.js';
import { floorHeight, TRENCH } from './mermaidEnv.js';
import { TWO_PI, between, pick, clamp, lerp, labelSprite, mat, std, mesh, angleDiff, glowSprite } from './mermaidKit.js';
import {
    TALKING_FISH, FRIENDS, FRIEND_LINES, NPCS, TOWNSFOLK, WEDDING, PETS, VOWS, areaById, PHOTO_TARGETS, RING_RUN, normalizeLook, TREASURES, GARDEN, ITEMS, SONGS
} from './mermaidData.js';

const rand = Math.random;
const A = (id) => areaById(id).at;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

export function installNpc(MW) {
    const P = MW.prototype;

    // ---------------------------------------------------------------------------------------------
    // Shopkeepers
    // ---------------------------------------------------------------------------------------------
    P._spawnKeeper = function (shop, pos, yaw) {
        const k = shop.keeper;
        let obj, m = null;
        if (k.octopus) {
            obj = buildOctopus(0xd1558a, 0.9);
            obj.position.copy(pos).add(V3(0, 0.6, 0));
        } else if (k.crab) {
            obj = buildCrab(0xe67e22, 1.3);
            obj.position.copy(pos).add(V3(0, -1.8, 0));
            const apron = mesh(new THREE.BoxGeometry(0.7, 0.5, 0.05), mat(0xffffff, { r: 0.7 }), 0, 0.35, 0.55);
            obj.add(apron);
        } else {
            m = buildMermaid(normalizeLook(Object.assign({ tail: 3 }, k.look)));
            obj = m.root;
            obj.position.copy(pos);
        }
        obj.rotation.y = yaw;
        this.scene.add(obj);
        const label = labelSprite(k.name, '#e17055', 3.6);
        label.position.set(0, k.octopus ? 3.4 : k.crab ? 1.6 : 2.2, 0);
        obj.add(label);
        label.visible = false;
        (this.keepers = this.keepers || []).push({ shop, m, obj, label, pos: pos.clone(), ph: rand() * 6 });
    };

    // ---------------------------------------------------------------------------------------------
    // The cast
    // ---------------------------------------------------------------------------------------------
    P._addLabel = function (obj, text, y, color = '#6c5ce7', scale = 4.2) {
        const l = labelSprite(text, color, scale);
        l.position.set(0, y, 0);
        obj.add(l);
        l.visible = false;
        return l;
    };

    P._buildNpcs = function () {
        const scene = this.scene, R = this.refs;
        const g0 = floorHeight;
        this.npc = {};
        // Talking fish
        this.talkers = TALKING_FISH.map((d) => {
            const g = buildTalkingFish(d);
            const anchor = V3(d.at[0], d.at[1], d.at[2]);
            if (d.id === 'dolph') anchor.copy(R.grotto.dj).add(V3(0, 1.4, 0));
            if (d.id === 'tilda') anchor.copy(R.petnook.pos).add(V3(0, 0.0, 0));
            g.position.copy(anchor);
            scene.add(g);
            const label = this._addLabel(g, d.name, 2.2 + d.size * 1.2, '#0984e3');
            if (d.id === 'puff') g.userData.photoId = 'puffer';
            return { id: d.id, def: d, g, anchor, label, ph: rand() * 10, talking: false, still: d.id === 'dolph' || d.id === 'tilda' };
        });
        this.talker = (id) => this.talkers.find((t) => t.id === id);
        // Coralie the wedding planner
        const cor = buildSeahorse(0xff9ff3, 1.35);
        cor.position.copy(R.coraliePos);
        scene.add(cor);
        this.npc.coralie = { g: cor, label: this._addLabel(cor, NPCS.coralie.name, 3.2, '#e84393'), anchor: R.coraliePos.clone() };
        // Gerald, the crab with a crown, on his hoard
        const ger = buildCrab(0xc0392b, 1.5);
        const crown = new THREE.Group();
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * TWO_PI;
            const c = mesh(new THREE.ConeGeometry(0.1, 0.3, 4), mat(0xf1c40f, { m: 0.8, r: 0.3 }), Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3);
            crown.add(c);
        }
        crown.add(mesh(new THREE.TorusGeometry(0.3, 0.06, 5, 12), mat(0xf1c40f, { m: 0.8, r: 0.3 }), 0, -0.1, 0));
        crown.children[crown.children.length - 1].rotation.x = Math.PI / 2;
        crown.position.set(0, 1.4, 0.1);
        ger.add(crown);
        ger.position.copy(R.caves.geraldPos);
        ger.rotation.y = R.caves.entAz + Math.PI;
        scene.add(ger);
        this.npc.gerald = { g: ger, label: this._addLabel(ger, NPCS.gerald.name, 3.2, '#c0392b'), anchor: R.caves.geraldPos.clone() };
        // Captain Barnacle on the ship's deck
        const bar = buildCrab(0x8e5a3a, 1.1);
        const hat = new THREE.Group();
        hat.add(mesh(new THREE.CylinderGeometry(0.5, 0.45, 0.25, 12), mat(0x1c1c28, { r: 0.6 }), 0, 0, 0));
        hat.add(mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.05, 14), mat(0x1c1c28, { r: 0.6 }), 0, -0.12, 0));
        hat.position.set(0, 0.95, 0.1);
        bar.add(hat);
        bar.position.copy(R.ship.deck).add(V3(4, 0.6, -3));
        scene.add(bar);
        this.npc.barnacle = { g: bar, label: this._addLabel(bar, NPCS.barnacle.name, 2.4, '#8e5a3a'), anchor: bar.position.clone() };
        // Professor Urchin in the garden
        const prof = buildProfessor();
        prof.position.set(R.garden.center.x + 3, R.garden.center.y + 1.2, R.garden.center.z - 6);
        scene.add(prof);
        this.npc.professor = { g: prof, label: this._addLabel(prof, NPCS.professor.name, 2.2, '#6c5ce7'), anchor: prof.position.clone() };
        // Gary the vegetarian shark, circling inside the whale's ribs
        const gary = buildShark(0.9);
        gary.position.copy(R.whaleSkel.pos);
        scene.add(gary);
        this.npc.gary = { g: gary, label: this._addLabel(gary, NPCS.gary.name, 2.0, '#7f8c8d'), anchor: R.whaleSkel.pos.clone(), orbit: 6 };
        gary.userData.photoId = 'shark';
        // Grandma Whale above the kelp forest
        const gm = buildWhale(0.8);
        const kp = R.kelp.pos;
        gm.position.set(kp.x + 14, kp.y + 30, kp.z - 12);
        scene.add(gm);
        this.npc.grandma = { g: gm, label: this._addLabel(gm, NPCS.grandma.name, 6, '#34495e', 9), anchor: gm.position.clone(), orbit: 14 };
        gm.userData.photoId = 'whale';
        // The crab family
        this.npc.crabfam = { g: R.clam.crabs[0], anchor: R.clam.crabs[0].position.clone() };
        R.clam.crabs.forEach((c, i) => { if (i === 0) this.npc.crabfam.label = this._addLabel(c, 'The Crab Family', 2.4, '#e74c3c'); });
        // Friends
        this._buildFriends();
    };

    // ---------------------------------------------------------------------------------------------
    // Friends and the pet
    // ---------------------------------------------------------------------------------------------
    P._buildFriends = function () {
        const home = this.friendHome = V3(14, floorHeight(14, 12) + 3.4, 12);
        this.friends = FRIENDS.map((def, i) => {
            const look = normalizeLook(Object.assign({ name: def.name }, def.look));
            const m = buildMermaid(look);
            const pos = home.clone().add(V3(Math.cos(i * 2.1) * 2.2, Math.sin(i) * 0.6, Math.sin(i * 2.1) * 2.2));
            m.root.position.copy(pos);
            this.scene.add(m.root);
            const label = this._addLabel(m.root, def.name, 2.0, '#fd79a8', 3.2);
            return { def, m, pos, yaw: i * 2.1 + Math.PI, swim: 0, slot: i, action: null, actionT: 0, label, wedding: false };
        });
    };

    P._updateFriends = function (dt) {
        if (!this.friends) return;
        const Pl = this.player;
        const S = this.S;
        const following = S.has('friendsFollow') && !S.has('mallFinished');
        this.friends.forEach((f, i) => {
            if (f.wedding) {
                animateMermaid(f.m, this.time, { swim: 0, action: f.action || 'wave', dt });
                return;
            }
            if (f.sit) {
                animateMermaid(f.m, this.time, { swim: 0, action: f.action, dt });
                return;
            }
            const dFar = f.pos.distanceTo(Pl.pos);
            f.m.root.visible = following || dFar < 110;
            if (!f.m.root.visible) return;
            let target;
            if (following) {
                const yaw = Pl.yaw;
                const side = (i - 1) * 2.4;
                target = this._v.set(Pl.pos.x - Math.sin(yaw) * (3 + (i % 2)) + Math.cos(yaw) * side, Pl.pos.y + (i - 1) * 0.4, Pl.pos.z - Math.cos(yaw) * (3 + (i % 2)) - Math.sin(yaw) * side);
            } else {
                target = this._v.set(this.friendHome.x + Math.cos(i * 2.1 + this.time * 0.2) * 2.4, this.friendHome.y + Math.sin(this.time + i) * 0.3, this.friendHome.z + Math.sin(i * 2.1 + this.time * 0.2) * 2.4);
            }
            const d = target.clone().sub(f.pos);
            const dist = d.length();
            const speed = Math.min(dist * 1.6, following ? 12 : 2);
            if (dist > 0.05) f.pos.addScaledVector(d.normalize(), speed * dt);
            // never inside the seabed
            const fy = floorHeight(f.pos.x, f.pos.z) + 1.6;
            if (f.pos.y < fy) f.pos.y = fy;
            f.swim += (Math.min(1, speed / 7) - f.swim) * Math.min(1, dt * 3);
            const want = dist > 0.5 ? Math.atan2(d.x, d.z) : (following ? Pl.yaw : Math.atan2(this.friendHome.x - f.pos.x, this.friendHome.z - f.pos.z));
            f.yaw += angleDiff(f.yaw, want) * Math.min(1, dt * 4);
            f.m.root.position.copy(f.pos);
            f.m.root.rotation.set(f.swim * 1.2, f.yaw, 0, 'YXZ');
            if (f.actionT > 0) {
                f.actionT -= dt;
                if (f.actionT <= 0) f.action = null;
            }
            let action = f.action;
            if (!action && !following) action = Math.sin(this.time * 0.7 + i * 2) > 0.3 ? 'talk' : null;
            if (!action && following && Pl.action === 'dance') action = 'dance';
            animateMermaid(f.m, this.time, { swim: f.swim, action, dt });
            f.label.visible = this.mode === 'explore' && f.pos.distanceTo(Pl.pos) < 14;
        });
        // idle banter
        if (following && this.mode === 'explore' && rand() < dt * 0.04) {
            const f = pick(this.friends);
            this.ui.caption(`${f.def.name}: "${pick(FRIEND_LINES.idle)}"`, 2600);
        }
    };

    P._buildPet = function () {
        const S = this.S;
        if (this.pet) {
            this.scene.remove(this.pet.g);
            this.pet = null;
        }
        if (!S.pet || S.pet === 'none') return;
        let g;
        if (S.pet === 'turtle') g = buildTurtle(0.45);
        else if (S.pet === 'puffer') g = buildPuffer(0.55, 0.35);
        else if (S.pet === 'seahorse') g = buildSeahorse(0xfeca57, 0.5);
        else if (S.pet === 'jelly') g = buildJelly(0xa29bfe, 0.5);
        else g = buildCrab(0xe74c3c, 0.45);
        g.position.copy(this.player.pos).add(V3(1.5, 0, -1));
        this.scene.add(g);
        this.pet = { g, kind: S.pet, vel: new THREE.Vector3(), yaw: 0 };
        const lab = this._addLabel(g, PETS.find((p) => p.id === S.pet).name, 1.8, '#00b894', 3.4);
        this.pet.label = lab;
    };

    P._updatePet = function (dt) {
        const pet = this.pet;
        if (!pet) return;
        const Pl = this.player;
        const yaw = Pl.yaw;
        const target = this._v.set(Pl.pos.x - Math.sin(yaw) * 1.5 + Math.cos(yaw) * 1.8, Pl.pos.y - 0.2 + Math.sin(this.time * 1.6) * 0.25, Pl.pos.z - Math.cos(yaw) * 1.5 - Math.sin(yaw) * 1.8);
        const d = target.clone().sub(pet.g.position);
        const dist = d.length();
        const crab = pet.kind === 'crab';
        if (dist > 40) pet.g.position.copy(target);
        else if (dist > 0.3) pet.g.position.addScaledVector(d.normalize(), Math.min(dist * 2.4, 13) * dt);
        const fy = floorHeight(pet.g.position.x, pet.g.position.z) + (crab ? 0.0 : 1.0);
        if (crab) pet.g.position.y = floorHeight(pet.g.position.x, pet.g.position.z);
        else if (pet.g.position.y < fy) pet.g.position.y = fy;
        pet.yaw += angleDiff(pet.yaw, dist > 1 ? Math.atan2(d.x, d.z) : yaw) * Math.min(1, dt * 5);
        pet.g.rotation.y = pet.yaw;
        if (pet.g.userData.update) pet.g.userData.update(this.time, Math.min(1, dist / 4));
        if (Pl.action === 'dance') pet.g.position.y += Math.abs(Math.sin(this.time * 8)) * 0.25;
        pet.label.visible = this.mode === 'explore' && dist < 6;
    };

    P._afterLookChange = function () {
        if (!this.pet || this.pet.kind !== this.S.pet) this._buildPet();
    };

    // ---------------------------------------------------------------------------------------------
    // Wildlife
    // ---------------------------------------------------------------------------------------------
    P._buildRoamers = function () {
        const scene = this.scene;
        this.roamers = [];
        const add = (id, g, o) => {
            g.userData.photoId = id;
            scene.add(g);
            const r = Object.assign({ id, g, cx: 0, cy: 10, cz: 0, rx: 20, rz: 20, speed: 0.06, phase: rand() * 6, bob: 1.5, still: false, radius: 3 }, o);
            this.roamers.push(r);
            return r;
        };
        add('turtle', buildTurtle(1.4), { cx: -30, cy: 8, cz: 70, rx: 28, rz: 22, speed: 0.07, bob: 1.5, radius: 2.5 });
        add('turtle', buildTurtle(1.2, 0x4aa04a), { cx: 130, cy: 10, cz: -20, rx: 34, rz: 26, speed: -0.06, bob: 2, radius: 2.5 });
        add('manta', buildManta2(2.6), { cx: 60, cy: 38, cz: -30, rx: 70, rz: 55, speed: 0.045, bob: 4, radius: 6 });
        add('manta', buildManta2(2.2), { cx: -130, cy: 32, cz: 120, rx: 60, rz: 70, speed: -0.05, bob: 3, radius: 5 });
        for (let i = 0; i < 3; i++) add('dolphin', buildRoamer('dolphin', 1), { cx: 100, cy: 24, cz: 100, rx: 44 + i * 6, rz: 38 + i * 6, speed: 0.15, phase: i * 0.5, bob: 5 + i, radius: 3 });
        add('shark', buildShark(1.4), { cx: -112, cy: 16, cz: 38, rx: 46, rz: 38, speed: 0.05, bob: 2, radius: 4 });
        add('whale', buildWhale(1.7), { cx: 0, cy: 44, cz: 0, rx: 250, rz: 210, speed: 0.012, bob: 6, radius: 16 });
        add('octopus', buildOctopus(0xd1558a, 1.2), { still: true, cx: -18, cy: floorHeight(-18, -62) + 1.6, cz: -62, radius: 3 });
        for (let i = 0; i < 3; i++) add('seahorse', buildSeahorse([0xfeca57, 0xff9ff3, 0x48dbfb][i], 1.7), { cx: -70 + i * 6, cy: 7 + i, cz: 26 + i * 4, rx: 8, rz: 8, speed: 0.12, bob: 1.2, phase: i * 2, radius: 2 });
        add('angler', buildAngler(1.5), { cx: TRENCH.x, cy: -16, cz: TRENCH.z - 38, rx: 10, rz: 10, speed: 0.08, bob: 2, radius: 3 });
        const jellyCols = [0xff9ff3, 0x48dbfb, 0xfeca57, 0xa29bfe, 0x55efc4];
        for (let i = 0; i < 10; i++) {
            const a = rand() * TWO_PI, r = 20 + rand() * 60;
            const around = i < 5 ? A('lagoon') : A('garden');
            add('jelly', buildJelly(jellyCols[i % 5], 1.8), { cx: around[0] + Math.sin(a) * r, cy: 10 + rand() * 20, cz: around[1] + Math.cos(a) * r, rx: 6, rz: 6, speed: 0.1, bob: 3, phase: i, radius: 2.5 });
        }
        for (const r of this.roamers) r.g.position.set(r.cx, r.cy, r.cz);
    };

    function buildManta2(s) {
        return buildRoamer('manta', s / 2.4);
    }

    P._updateCreatures = function (dt, t) {
        if (!this.roamers) return;
        const pp = this.player.pos;
        for (const r of this.roamers) {
            const g = r.g;
            const dx = g.position.x - pp.x, dz = g.position.z - pp.z;
            const far = dx * dx + dz * dz > 420 * 420;
            g.visible = !far;
            if (!r.still) {
                const a = r.phase + t * r.speed;
                const x = r.cx + Math.sin(a) * r.rx, z = r.cz + Math.cos(a) * r.rz;
                const y = Math.max(r.cy + Math.sin(a * 1.7 + r.phase) * r.bob, floorHeight(x, z) + 2.5);
                if (!far) {
                    g.position.set(x, y, z);
                    const vx = Math.cos(a) * r.rx * r.speed, vz = -Math.sin(a) * r.rz * r.speed;
                    g.rotation.y = Math.atan2(vx, vz);
                    g.rotation.z = -Math.sin(a * 1.7 + r.phase) * 0.06;
                }
            }
            if (!far && g.userData.update) g.userData.update(t + r.phase, r.still ? 0.1 : 0.45);
        }
        // Schools circle their patch of reef
        this._updateSchools(dt, t);
    };

    P._buildSchools = function () {
        const geo = schoolFishGeometry();
        const N = 360;
        this.school = new THREE.InstancedMesh(geo, std(0xffffff, { roughness: 0.4, metalness: 0.2 }), N);
        this.school.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.school.frustumCulled = false;
        this.schools = [];
        const palettes = [[0xffd32a, 0xffa801], [0x0fbcf9, 0x4bcffa], [0xff5e57, 0xff3f34], [0x05c46b, 0x0be881], [0xd2dae2, 0x808e9b], [0xf53b57, 0xef5777], [0x3c40c6, 0x575fcf]];
        const col = new THREE.Color();
        let idx = 0;
        for (let s = 0; s < 16 && idx < N; s++) {
            const n = Math.min(N - idx, 16 + Math.floor(rand() * 16));
            const pal = pick(palettes);
            const sc = { cx: between(-300, 300), cz: between(-300, 300), r: between(15, 45), y: between(4, 30), speed: between(0.08, 0.18) * (rand() < 0.5 ? 1 : -1), ph: rand() * TWO_PI, fish: [] };
            for (let i = 0; i < n; i++) {
                sc.fish.push({ i: idx, off: new THREE.Vector3(between(-2.5, 2.5), between(-1.2, 1.2), between(-2.5, 2.5)), ph: rand() * 10, scale: between(0.8, 1.6) });
                this.school.setColorAt(idx, col.setHex(pick(pal)));
                idx++;
            }
            this.schools.push(sc);
        }
        this.school.count = idx;
        this.scene.add(this.school);
        this._sm = new THREE.Matrix4();
        this._sq = new THREE.Quaternion();
        this._se = new THREE.Euler();
        this._ss = new THREE.Vector3();
    };

    P._updateSchools = function (dt, t) {
        const m4 = this._sm, q = this._sq, e = this._se, s = this._ss;
        for (const sc of this.schools) {
            const a = sc.ph + t * sc.speed;
            const cx = sc.cx + Math.sin(a) * sc.r, cz = sc.cz + Math.cos(a) * sc.r, cy = sc.y + Math.sin(a * 2) * 3;
            const heading = Math.atan2(Math.cos(a), -Math.sin(a)) * Math.sign(sc.speed) + (sc.speed < 0 ? Math.PI : 0);
            const fl = floorHeight(cx, cz) + 2;
            for (const f of sc.fish) {
                const wob = Math.sin(t * 3 + f.ph);
                this._v.set(cx + f.off.x + wob * 0.3, Math.max(cy, fl) + f.off.y + Math.cos(t * 2 + f.ph) * 0.3, cz + f.off.z);
                e.set(0, heading + wob * 0.15, 0);
                q.setFromEuler(e);
                s.setScalar(f.scale);
                m4.compose(this._v, q, s);
                this.school.setMatrixAt(f.i, m4);
            }
        }
        this.school.instanceMatrix.needsUpdate = true;
    };

    // ---------------------------------------------------------------------------------------------
    // NPCs idle, face you, and show their names when you're near
    // ---------------------------------------------------------------------------------------------
    P._updateNpcs = function (dt, t) {
        const pp = this.player.pos;
        // talking fish
        for (const f of this.talkers) {
            const dd = pp.distanceTo(f.g.position);
            f.g.visible = dd < 170 || f === this._followTalker;
            if (!f.g.visible) continue;
            const near = dd < 11;
            if (f === this._followTalker) {
                f.label.visible = true;
                continue;
            }
            if (!near && !f.talking && !f.still) {
                const a = t * 0.4 + f.ph;
                f.g.position.set(f.anchor.x + Math.sin(a) * 3, f.anchor.y + Math.sin(a * 2) * 0.6, f.anchor.z + Math.cos(a) * 3);
                f.g.rotation.y = a + Math.PI / 2;
            } else {
                if (f.still) f.g.position.y = f.anchor.y + Math.sin(t * 1.3 + f.ph) * 0.2;
                f.g.rotation.y += angleDiff(f.g.rotation.y, Math.atan2(pp.x - f.g.position.x, pp.z - f.g.position.z)) * Math.min(1, dt * 3);
            }
            if (f.g.userData.update) f.g.userData.update(t + f.ph, 0.3);
            f.label.visible = this.mode === 'explore' && pp.distanceTo(f.g.position) < 40;
        }
        // story characters
        const n = this.npc;
        const idle = (o, amp = 0.2) => { o.g.position.y = o.anchor.y + Math.sin(t * 1.3 + o.anchor.x) * amp; };
        if (n.coralie) {
            n.coralie.g.position.y = n.coralie.anchor.y + Math.sin(t * 1.5) * 0.25;
            n.coralie.g.rotation.y = Math.sin(t * 0.5) * 0.5;
            n.coralie.g.userData.update(t, 0.2);
            n.coralie.label.visible = this.mode === 'explore' && pp.distanceTo(n.coralie.g.position) < 40;
        }
        for (const k of ['gerald', 'barnacle']) {
            const o = n[k];
            if (!o) continue;
            o.g.userData.update(t, 0.05);
            o.g.rotation.y += angleDiff(o.g.rotation.y, Math.atan2(pp.x - o.g.position.x, pp.z - o.g.position.z)) * Math.min(1, dt * 2) * (pp.distanceTo(o.g.position) < 20 ? 1 : 0);
            o.label.visible = this.mode === 'explore' && pp.distanceTo(o.g.position) < 30;
        }
        if (n.professor) {
            n.professor.g.userData.update(t);
            n.professor.g.position.y = n.professor.anchor.y + Math.sin(t * 1.2) * 0.15;
            n.professor.label.visible = this.mode === 'explore' && pp.distanceTo(n.professor.g.position) < 25;
        }
        for (const k of ['gary', 'grandma']) {
            const o = n[k];
            if (!o) continue;
            const a = t * (k === 'gary' ? 0.35 : 0.08);
            o.g.position.set(o.anchor.x + Math.sin(a) * o.orbit, o.anchor.y + Math.sin(a * 2) * (k === 'gary' ? 0.6 : 1.5), o.anchor.z + Math.cos(a) * o.orbit);
            o.g.rotation.y = a + Math.PI / 2;
            o.g.userData.update(t, 0.3);
            o.label.visible = this.mode === 'explore' && pp.distanceTo(o.g.position) < (k === 'gary' ? 30 : 60);
        }
        if (n.crabfam) n.crabfam.label.visible = this.mode === 'explore' && pp.distanceTo(n.crabfam.g.position) < 25;
        // townsfolk: names when close, and a turn towards you
        for (const f of this.refs.townsfolk || []) {
            const d = f.m.root.position.distanceTo(pp);
            f.m.root.visible = d < 110;
            if (d >= 110) continue;
            f.label.visible = this.mode === 'explore' && d < 12;
            animateMermaid(f.m, t, { swim: 0, action: Math.sin(t * 0.5 + f.ph) > 0.75 ? 'talk' : null, dt });
            if (d < 14) f.m.root.rotation.y += angleDiff(f.m.root.rotation.y, Math.atan2(pp.x - f.m.root.position.x, pp.z - f.m.root.position.z)) * Math.min(1, dt * 3);
        }
        // shopkeepers
        for (const k of this.keepers || []) {
            const d = k.obj.position.distanceTo(pp);
            k.obj.visible = d < 110;
            if (d >= 110) continue;
            k.label.visible = this.mode === 'explore' && d < 16;
            if (k.m) animateMermaid(k.m, t, { swim: 0, action: d < 14 && Math.sin(t * 0.8 + k.ph) > -0.2 ? 'wave' : (Math.sin(t * 0.5 + k.ph) > 0.8 ? 'talk' : null), dt });
            else if (k.obj.userData.update) k.obj.userData.update(t + k.ph, 0.1);
            if (k.m) k.obj.position.y = k.pos.y + Math.sin(t + k.ph) * 0.1;
        }
        // Glenda leads the way
        if (this.follow) this._updateFollow(dt);
    };

    // ---- Glenda's walk (a follow-the-leader quest) ----------------------------------------------------
    P._startFollow = function (talker, route, onDone, text) {
        this.follow = { talker, route, idx: 0, onDone, wait: 0, text };
        this._followTalker = talker;
        this.ui.toast('Stay close to ' + talker.def.name.split(' ')[0] + '!');
    };

    P._updateFollow = function (dt) {
        const F = this.follow;
        const g = F.talker.g;
        const pp = this.player.pos;
        const target = F.route[F.idx];
        const dist = g.position.distanceTo(pp);
        if (dist > 26) {
            F.wait += dt;
            if (F.wait > 1) {
                this.ui.caption(`${F.talker.def.name.split(' ')[0]}: "Keep up! I'm over here!"`, 1200);
                F.wait = 0;
            }
        } else {
            const d = target.clone().sub(g.position);
            const l = d.length();
            if (l < 2.5) {
                F.idx++;
                if (F.idx >= F.route.length) {
                    const done = F.onDone;
                    this.follow = null;
                    this._followTalker = null;
                    done();
                    return;
                }
            } else {
                g.position.addScaledVector(d.normalize(), Math.min(7.5, l) * dt);
                g.rotation.y += angleDiff(g.rotation.y, Math.atan2(d.x, d.z)) * Math.min(1, dt * 5);
                if (dist > 16) g.position.addScaledVector(d, -0.0);
            }
        }
        F.talker.anchor.copy(g.position);
    };

    // ---------------------------------------------------------------------------------------------
    // Talking
    // ---------------------------------------------------------------------------------------------
    /** Who you can talk to: id, display name, position getter, radius. */
    P._npcTargets = function () {
        const t = [];
        for (const f of this.talkers) t.push({ id: f.id, name: f.def.name, pos: () => f.g.position, r: 6 + f.def.size * 2.4 });
        const n = this.npc;
        t.push({ id: 'coralie', name: NPCS.coralie.name, pos: () => n.coralie.g.position, r: 8 });
        t.push({ id: 'gerald', name: NPCS.gerald.name, pos: () => n.gerald.g.position, r: 9 });
        t.push({ id: 'barnacle', name: NPCS.barnacle.name, pos: () => n.barnacle.g.position, r: 7 });
        t.push({ id: 'professor', name: NPCS.professor.name, pos: () => n.professor.g.position, r: 7 });
        t.push({ id: 'gary', name: NPCS.gary.name, pos: () => n.gary.g.position, r: 9 });
        t.push({ id: 'grandma', name: NPCS.grandma.name, pos: () => n.grandma.g.position, r: 18 });
        t.push({ id: 'crabfam', name: NPCS.crabfam?.name || 'The Crab Family', pos: () => n.crabfam.g.position, r: 9 });
        for (const f of this.friends) t.push({ id: 'friend_' + f.def.id, name: f.def.name, pos: () => f.pos, r: 6 });
        for (const f of this.refs.townsfolk || []) t.push({ id: 'town_' + f.def.name, name: f.def.name, pos: () => f.m.root.position, r: 6 });
        return t;
    };

    P.talk = async function (id) {
        this._freeMouse();
        const S = this.S;
        const ui = this.ui;
        const conv = (who, lines) => this.conversation(who, lines);
        const chk = () => this.refreshQuests();
        // Friends and townsfolk first
        if (id.startsWith('friend_')) return this._talkFriend(id.slice(7));
        if (id.startsWith('town_')) {
            const f = this.refs.townsfolk.find((x) => x.def.name === id.slice(5));
            const lines = f.def.says.slice();
            if (f.def.name === 'Wren' && S.has('metSage') && !S.has('geraldBeaten')) lines.push('If you really want to find the thief, you will need light. The Glow Caves hold glowing orbs deep inside.');
            await this.say(f.def.name, pick(lines));
            return;
        }
        const fish = this.talker(id);
        if (fish) fish.talking = true;
        try {
            switch (id) {
                case 'sage': await this._talkSage(); break;
                case 'coralie': await this._talkCoralie(); break;
                case 'bubbles': await this._talkBubbles(); break;
                case 'dory': await this._talkGlenda(); break;
                case 'luna': await this._talkLuna(); break;
                case 'zip': await this._talkZip(); break;
                case 'puff': await this._talkPuff(); break;
                case 'dolph': await this._talkDolph(); break;
                case 'tilda': await this._talkTilda(); break;
                case 'gerald': await this._talkGerald(); break;
                case 'barnacle': await this._talkBarnacle(); break;
                case 'professor': await this._talkProfessor(); break;
                case 'gary': await this._invite('Gary', 'Gary the Shark', ['*glances up from a kelp salad*', 'Oh! You\'re the one planning the wedding? I\'d be delighted. I promise to be on my best behaviour. I am a vegetarian, you know.', 'Do I get a plus one? The whale skeleton is a bit lonely.']); break;
                case 'grandma': await this._invite('Grandma', 'Grandma Whale', ['Ohhhhh, little one. I felt you coming from three currents away.', 'A wedding? How wonderful! I haven\'t sung at a wedding since your great-great-grandmother\'s.', 'I\'ll be there. Don\'t let them seat me next to Gary, he hums.']); break;
                case 'crabfam': await this._invite('Crabs', 'The Crab Family', ['Click-click! Many claws, many greetings!', 'A wedding?! We\'ve been waiting our whole lives for this.', 'We\'ll bring the steel drums. Don\'t tell Gerald.']); break;
                default: break;
            }
        } finally {
            if (fish) fish.talking = false;
        }
        if (fish && !S.fishTalked.has(id)) {
            S.fishTalked.add(id);
            ui.toast(`🐟 Fish friend: ${fish.def.name} (${S.fishTalked.size}/${TALKING_FISH.length})`);
        }
        chk();
    };

    P._tracked = function () {
        return (this._trackedStatus || []).map((s) => s.q.title).join(' and ');
    };

    P._talkSage = async function () {
        const S = this.S;
        const who = 'Old Sage the Grouper';
        if (!S.has('metSage')) {
            await this.conversation(who, [
                'Hmmmm. Another dreamer drifts down from the bright world. Welcome to Mermaid World, little one.',
                'Everything here is real as long as you believe it. And you DO believe it.',
                'Coralie, at the Coral Chapel, is planning a wedding. Your friends are lounging by the plaza, itching for a mall day. The creatures of the reef are shy and would love their portraits taken. And Zip has been pestering everyone for a race.',
                'Do those, and come back and see me. There is something else, but it is a story for a few chapters from now. Off you go!'
            ]);
            S.set('metSage');
            this.ui.caption('Chapter 1 complete! Your journal (J) lists everything you can do.', 4500);
            return;
        }
        const opts = ['What should I do next?', 'Tell me about the Moon Pearl', 'Just saying hello'];
        const i = await this.choice(who, 'Hmmm? Something on your mind, child?', opts);
        if (i === 0) {
            const t = this._tracked();
            await this.say(who, t ? `You are on ${t}. Press J for the whole list, and pin what you like. The map (M) takes you to any place you have found.` : 'The reef is calm. Dig for treasure, tend your garden, play at the Grotto. Or just swim.');
        } else if (i === 1) {
            if (S.has('pearlReturned')) await this.say(who, 'It shines again at the top of the chapel, thanks to you. The whole town sleeps easier. Look up on a dark night: that is your pearl.');
            else if (S.has('done_moon') === false && this.S.has('moonStarted')) await this.say(who, 'Follow the clues: Bubbles, Glenda and Luna each saw something. Then the temple, then the caves. The thief is small and shiny-eyed.');
            else {
                await this.conversation(who, ['The Moon Pearl sits in the golden cup at the top of the chapel tower. It lights the whole town at night, and keeps the nightmares out of the shallows.', 'Three days ago it was gone. No one saw who took it. Do a few of those chores and I will tell you where to start. (Finish three of the first four chapters.)']);
            }
        } else await this.say(who, 'Hmmmm. Good. A friendly face is worth a thousand pearls.');
    };

    P._talkCoralie = async function () {
        const S = this.S;
        const who = 'Coralie the Seahorse';
        if (!S.has('planned')) {
            await this.conversation(who, ['Oh my GOSH, a bride! I\'m Coralie, the best wedding planner in the whole reef.', 'Let\'s plan your dream ceremony. Theme, look, partner, flowers, cake, music, vows... everything!']);
            await new Promise((resolve) => {
                this.ui.openPlanner(WEDDING.steps, (choices) => {
                    this._weddingChoices = choices;
                    S.wedding = serializeChoices(choices);
                    S.set('planned');
                    S.set('hasInvites');
                    resolve();
                }, () => resolve());
            });
            if (S.has('planned')) {
                await this.conversation(who, ['PERFECT. It\'s going to be breathtaking!', 'Now: I need eight sea flowers for the bouquet (the Kelp Forest and the Sea Garden are full of them), and these four invitations delivered: Auntie Octavia at the Scale Salon, Gary at the whale skeleton, the Crab Family at the Giant Clam, and Grandma Whale above the Kelp Forest.', 'Come back to me when it is all done and we will have a wedding!']);
                this.ui.toast('💌 You received 4 wedding invitations');
            }
            return;
        }
        if (!S.has('weddingDone')) {
            const flowers = S.count('flower');
            const invites = ['Octavia', 'Gary', 'Crabs', 'Grandma'].filter((n) => S.has('invite' + n)).length;
            if (flowers >= 8 && invites >= 4) {
                const i = await this.choice(who, 'You have the flowers AND the guests are coming?! Darling, shall we begin?', ['Begin the ceremony! 💍', 'Not yet']);
                if (i === 0) {
                    if (!this._weddingChoices) this._weddingChoices = deserializeChoices(S.wedding);
                    this.runWedding(this._weddingChoices);
                }
            } else {
                await this.say(who, `Flowers: ${flowers}/8. Invitations delivered: ${invites}/4. Hurry hurry hurry!`);
            }
            return;
        }
        const i = await this.choice(who, 'That was the most beautiful wedding this reef has ever seen. I\'m still crying. Seahorses can cry.', ['Do it all again! (replay)', 'Plan a different wedding', 'Goodbye']);
        if (i === 0) { this._weddingChoices = this._weddingChoices || deserializeChoices(S.wedding); this.runWedding(this._weddingChoices, true); }
        else if (i === 1) {
            await new Promise((resolve) => this.ui.openPlanner(WEDDING.steps, (c) => { this._weddingChoices = c; S.wedding = serializeChoices(c); resolve(); }, () => resolve()));
            if (this._weddingChoices) this.runWedding(this._weddingChoices, true);
        }
    };

    P._invite = async function (name, who, lines) {
        const S = this.S;
        if (!S.has('planned')) {
            await this.say(who, 'A wedding? How lovely! ...But Coralie has not sent me anything yet. Ask her about it.');
            return;
        }
        if (S.has('invite' + name)) {
            await this.say(who, 'I\'ll be there. I\'ve already picked my outfit.');
            return;
        }
        await this.conversation(who, lines);
        S.set('invite' + name);
        this.ui.toast(`💌 Invitation delivered (${['Octavia', 'Gary', 'Crabs', 'Grandma'].filter((n) => S.has('invite' + n)).length}/4)`);
        if (this.audio) this.audio.pickup(4);
    };

    P._talkBubbles = async function () {
        const S = this.S;
        const who = 'Bubbles the Clownfish';
        if (S.has('clueBubbles')) {
            await this.say(who, pick(['Thanks again for the pebbles! They\'re so shiny.', 'Gerald still owes me, you know. I\'m keeping a list.', 'Have you been to the arcade? I hold the record for Bubble Pop. (Do not check.)']));
            return;
        }
        if (!S.has('bubblesAsked')) {
            await this.conversation(who, ['Oh hi! You\'re new! I can tell, your fins are still all sparkly.', 'Listen: Gerald the crab owes me three shiny pebbles. I dropped them around the plaza when he chased me. If you find them, I\'ll tell you something important. About something stolen.']);
            S.set('bubblesAsked');
            this._showPebbles && this._showPebbles(true);
            this.ui.toast('✨ Three shiny pebbles are glinting around the plaza');
            return;
        }
        if (S.count('pebble') >= 3) {
            await this.conversation(who, ['MY PEBBLES!! You found them! Oh, you wonderful mermaid.', 'Okay, the secret: the night the Moon Pearl vanished, I saw Gerald scuttling out of the plaza with something big and glowing under his shell. He went east... no, west! Towards the Glow Caves. I\'m almost sure.']);
            S.set('clueBubbles');
            this.ui.toast('🔎 Clue found: Gerald took the pearl towards the Glow Caves');
            this.S.set('moonStarted');
            return;
        }
        await this.say(who, `Pebbles: ${S.count('pebble')}/3. They're shiny, look for the sparkle near the plaza!`);
    };

    P._talkGlenda = async function () {
        const S = this.S;
        const who = 'Glenda the Blue Tang';
        const f = this.talker('dory');
        if (S.has('clueGlenda')) {
            await this.say(who, pick(['Hi! Have we met? ...Oh yes, the clam! We met at the clam!', 'I was going somewhere. It\'ll come to me.']));
            return;
        }
        await this.conversation(who, ['Hi! Hi! Have we met? I feel like we\'ve met.', 'I was going somewhere. I saw something, a while ago, something about the pearl. It was in... it was at... Oh! If I swim there, I\'ll remember! Follow me!']);
        const route = [V3(-52, 9, -40), V3(-60, 10, -78), V3(-46, 8, -92)];
        this._startFollow(f, route, async () => {
            f.talking = true;
            await this.conversation(who, ['The Giant Clam! YES! That\'s where I was going!', 'And I remembered: I saw a crab with a glowing thing hurrying past the clam, towards the old temple in the east. With a map! He was reading a map!', 'Hi! Have we met?']);
            f.talking = false;
            S.set('clueGlenda');
            S.set('moonStarted');
            this.ui.toast('🔎 Clue found: Gerald studied a map near the clam');
            this.refreshQuests();
        });
        this.ui.caption('Follow Glenda!', 2500);
    };

    P._talkLuna = async function () {
        const S = this.S;
        const who = 'Luna the Lanternfish';
        if (S.has('clueLuna')) {
            await this.say(who, 'Mind the dark in those caves. Orbs of light float deep inside. Collect five and your own glow will light the way.');
            return;
        }
        if (S.pearls.size >= 5) {
            await this.conversation(who, ['Oh! You found pearls! Their glow is so warm.', 'Fair trade, then: the thief lives where the dark is deepest, in the Glow Caves. Inside, light floats in orbs. Gather five and you can reach the back of the cave, where he keeps his hoard.', 'Be careful. He guards it with music. He\'s a terrible show-off.']);
            S.set('clueLuna');
            S.set('moonStarted');
            this.ui.toast('🔎 Clue found: the thief guards the hoard with music');
            return;
        }
        await this.conversation(who, ['Down in the deep I\'m the only light for miles. Up here I\'m just... a fish with a lamp.', `I know a thing about the pearl. But I'm hungry for glow: bring me five pearls (you have ${S.pearls.size}) and I'll tell you.`]);
    };

    P._talkZip = async function () {
        const S = this.S;
        const who = 'Zip the Angelfish';
        if (S.ringBest != null) {
            await this.say(who, `Your best time is ${S.ringBest.toFixed(1)}s? Pfft. Gold is ${RING_RUN.gold}. ...Okay, that's actually fast. But gold!`);
            return;
        }
        await this.conversation(who, ['Race you through the Ring Run! ...Kidding, I\'m too fast. ZOOM.', 'The course is at Pearl Lagoon, south-east. Fourteen rings, ' + RING_RUN.bronze + ' seconds for bronze. Hold Shift to sprint, and swim straight through the middle!']);
    };

    P._talkPuff = async function () {
        const who = 'Puffington III';
        await this.say(who, pick(['I am NOT puffed up. This is just my resting shape.', '...Okay you startled me a little. Give me a moment. *deflates slowly*', 'Photographers? Fine. But my left side is my best side.']));
    };

    P._talkDolph = async function () {
        const S = this.S;
        const who = 'DJ Dolph';
        const names = SONGS.map((s) => s.name);
        const i = await this.choice(who, `Yo yo yo! The Music Grotto is open, baby. Sets played: ${S.count('concerts')}. Pick a track and show the crowd what you've got!`, [...names, 'Maybe later']);
        if (i >= 0 && i < SONGS.length) await this._playGrotto(SONGS[i]);
    };

    P._talkTilda = async function () {
        const S = this.S;
        const who = 'Tilda the Turtle';
        if (S.pet === 'none') await this.say(who, 'Welcome to the Pet Nook, dear. Take your time. The right companion chooses you.');
        const cost = S.pet === 'none' ? 40 : 25;
        const options = PETS.filter((p) => p.id !== 'none' && p.id !== S.pet).map((p) => `${p.name} — 🐚 ${cost}`);
        options.push(S.pet !== 'none' ? 'Say goodbye to my pet' : 'Not today');
        const i = await this.choice(who, S.pet === 'none' ? 'Who would you like to take home?' : 'Looking to swap friends? It costs a little, to keep the nook running.', options);
        const list = PETS.filter((p) => p.id !== 'none' && p.id !== S.pet);
        if (i < list.length) {
            if (S.money < cost) { await this.say(who, 'Oh dear. Come back when you have a few more sand dollars.'); return; }
            S.money -= cost;
            S.pet = list[i].id;
            this._buildPet();
            this.ui.toast(`🐾 ${list[i].name} is now your best friend!`);
            if (this.audio) this.audio.sparkle();
            await this.say(who, 'A perfect match. Take good care of them.');
        } else if (S.pet !== 'none') {
            S.pet = 'none';
            this._buildPet();
        }
    };

    P._talkGerald = async function () {
        const S = this.S;
        const who = 'Gerald the Crab';
        if (S.has('geraldBeaten')) {
            await this.say(who, 'Fine. FINE. I miscalculated. Enjoy your pearl. I\'ll be here with my... other pearls. Also shiny. Sorry!');
            return;
        }
        if (S.count('glowOrb') < 5) {
            await this.conversation(who, ['*a claw clicks in the dark* Who\'s there?! I can\'t see you and you can\'t see me. That\'s the way I like it.', `(Your glow is too faint to see the way. Glow orbs collected: ${S.count('glowOrb')}/5. They drift around the cave.)`]);
            return;
        }
        await this.conversation(who, ['You found my cave. You found my hoard. You found my glowing orbs, which I was saving.', 'You want the Moon Pearl? It\'s MINE now. It\'s the shiniest thing I\'ve ever owned.', 'Tell you what: beat me at my own game. I\'m the best calypso crab in the ocean. Hit my notes (D F J K) and the pearl is yours. Lose, and you can go home empty-handed.']);
        const res = await this._playRhythm(SONGS[0], { pass: 0.62 });
        if (res && res.passed) {
            await this.conversation(who, ['That was... that was GOOD. That was really good! Nobody has ever hit all my notes.', '*sniffles* Fine. A deal is a deal. Take the pearl. I only wanted someone to see my hoard, really. It\'s lonely down here.', 'Come visit! Bring snacks!']);
            S.set('geraldBeaten');
            S.set('hasMoonPearl');
            this.refs.caves.moon.visible = false;
            this.ui.toast('🌕 You received the Moon Pearl!');
            if (this.audio) this.audio.success();
            this.refreshQuests();
        } else if (res && !res.cancelled) {
            await this.say(who, 'Ha! Too slow! Come back when you can keep the beat.');
        }
    };

    P._talkBarnacle = async function () {
        const S = this.S;
        const who = 'Captain Barnacle';
        if (!S.has('hasMap')) {
            await this.conversation(who, ['Arrr! Ye\'ve found the Sunken Ship, landlubber. I\'m Captain Barnacle, the finest hermit crab ever to wear a hat.', 'Five chests I buried before the storm. I\'ll give ye my old map for free, if ye promise to share the loot. The riddles are in yer journal (J).']);
            S.set('hasMap');
            this.ui.toast('🗺️ Treasure map received! Riddles are in your journal.');
            this._showTreasureMarks && this._showTreasureMarks();
            return;
        }
        await this.say(who, `Chests found: ${S.treasures.size}/${TREASURES.length}. Hold E on a spot marked X, and dig, matey!`);
    };

    P._talkProfessor = async function () {
        const S = this.S;
        const who = 'Professor Urchin';
        if (!S.has('gotSeeds')) {
            await this.conversation(who, ['Ah! A gardener! Or at least, someone with two hands and no better plans.', 'These six plots are yours. Plant anything you like: anemones, glow roses, sea lavender, fans, sponges, light bulb coral. They bloom in under a minute, which is cheating, but who is counting?', 'Here are six seeds on the house.']);
            S.counts.seed = (S.counts.seed || 0) + 6;
            S.set('gotSeeds');
            this.ui.toast('🌱 You received 6 seeds');
            return;
        }
        await this.say(who, `Seeds in your pocket: ${S.count('seed')}. Plots planted: ${S.plants.length}/${GARDEN.plots.length}. More seeds at the Trinket Trove!`);
    };

    P._talkFriend = async function (fid) {
        const S = this.S;
        const f = this.friends.find((x) => x.def.id === fid);
        const who = f.def.name;
        if (!S.has('friendsFollow') && !S.has('mallFinished')) {
            await this.say(who, 'Hey! You came! The mall is going to be SO fun. Ready?');
            const i = await this.choice(who, 'Mall day, girls?', ['Yes! Everyone with me!', 'Not just yet']);
            if (i === 0) {
                await this.say(this.S.look.name, 'Hey girls! Mall day?');
                for (let k = 0; k < this.friends.length; k++) await this.say(this.friends[k].def.name, FRIEND_LINES.invite[k % FRIEND_LINES.invite.length]);
                S.set('friendsFollow');
                S.set('mallInvited');
                this.ui.caption('Your friends are following you!\nThe Mermaid Mall is to the east.', 4000);
            }
            return;
        }
        const i = await this.choice(who, pick(FRIEND_LINES.idle), ['Keep exploring!', 'See you later (send friends home)']);
        if (i === 1) {
            S.set('mallFinished');
            this.ui.toast('Your friends go back to the plaza.');
        }
    };

    P._giveGift = function (item, fid) {
        const S = this.S;
        const f = this.friends.find((x) => x.def.id === fid);
        const loved = item.tags && item.tags.includes(f.def.likes);
        S.gifted.add(fid);
        if (loved) S.money += 10;
        f.action = loved ? 'cheer' : 'wave';
        f.actionT = 3;
        this.ui.caption(`${f.def.name}: "${pick(loved ? FRIEND_LINES.loved : FRIEND_LINES.meh)}"`, 3500);
        this.ui.toast(loved ? `❤️ ${f.def.name} LOVES it! (+10 🐚)` : `🎁 ${f.def.name} says thanks`);
        if (this.audio) this.audio[loved ? 'sparkle' : 'chime']();
        this.refreshQuests();
    };
}

// The planner's choices hold Sets; the save wants plain arrays.
export function serializeChoices(c) {
    const out = {};
    for (const [k, v] of Object.entries(c)) out[k] = v instanceof Set ? { set: [...v] } : v;
    return out;
}
export function deserializeChoices(d) {
    const c = {};
    for (const step of WEDDING.steps) {
        const v = d && d[step.id];
        if (v && v.set) c[step.id] = new Set(v.set);
        else if (v) c[step.id] = v;
        else if (step.type === 'many') c[step.id] = new Set(step.id === 'moments' ? ['bubbles', 'dance', 'cakecut'] : ['friends']);
        else if (step.type === 'cake') c[step.id] = { tiers: 3, flavor: step.flavors[0].id, topper: step.toppers[0].id };
        else c[step.id] = { id: step.options[0].id, color: step.colors ? step.colors[0] : null };
    }
    return c;
}
