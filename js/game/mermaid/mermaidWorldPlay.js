/**
 * js/game/mermaid/mermaidWorldPlay.js
 *
 * What there is to DO in Mermaid World, installed onto MermaidWorld: the pearls, shells, flowers and
 * glow orbs to collect, the interaction system (hold E to dig), the training rings and the Ring Run,
 * the camera and the photo safari, treasure digging, the sea garden, shops and gifts, the arcade and
 * the Grotto's rhythm game, the temple's glyph puzzle, the map and fast travel, the journal, the
 * pause menu, the compass / minimap objective markers and the Moon Pearl socket.
 */

import * as THREE from 'three';
import { floorHeight, TRENCH, CAVE } from './mermaidEnv.js';
import { buildPlant } from './mermaidTown.js';
import { RhythmGame, MemoryGame, BubbleGame, GlyphGame } from './mermaidGames.js';
import { QUESTS, questStatus, mainComplete } from './mermaidState.js';
import {
    TWO_PI, between, pick, clamp, lerp, smooth, mulberry32, std, mat, mesh, glowSprite, glowTexture, canvasTexture, angleDiff, fbm, shade, lerpColor
} from './mermaidKit.js';
import {
    AREAS, areaById, LANDMARKS, PEARL_COUNT, SHELL_COUNT, TRAINING_RINGS, RING_RUN, PHOTO_TARGETS, TREASURES, GARDEN, SHOPS, ARCADE_PRIZES, SONGS, ITEMS,
    ACHIEVEMENTS, WORLD_R, SURFACE_Y, FRIEND_LINES, TALKING_FISH, normalizeLook, PETS
} from './mermaidData.js';
import { biome, blocked } from './mermaidEnv.js';

const rand = Math.random;
const A = (id) => areaById(id).at;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ================================================================================================
// A set of things to pick up (instanced, bobbing, glowing)
// ================================================================================================
class Collectibles {
    constructor(scene, positions, geo, material, glowColor, glowSize, taken) {
        this.pos = positions;
        this.taken = new Set(taken || []);
        this.inst = new THREE.InstancedMesh(geo, material, positions.length);
        this.inst.frustumCulled = false;
        scene.add(this.inst);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions.length * 3), 3));
        this.points = new THREE.Points(g, new THREE.PointsMaterial({ map: glowTexture(), size: glowSize, color: glowColor, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.75 }));
        this.points.frustumCulled = false;
        scene.add(this.points);
        this.m4 = new THREE.Matrix4();
        this.q = new THREE.Quaternion();
        this.e = new THREE.Euler();
        this.s = new THREE.Vector3();
        this.p = new THREE.Vector3();
        this.visible = true;
        this.scale = 1;
        this.spin = 1;
    }

    setVisible(v) {
        this.visible = v;
        this.inst.visible = v;
        this.points.visible = v;
    }

    update(t, camPos) {
        if (!this.visible) return;
        const pa = this.points.geometry.attributes.position;
        for (let i = 0; i < this.pos.length; i++) {
            const base = this.pos[i];
            const taken = this.taken.has(i);
            const bob = Math.sin(t * 1.6 + i * 1.7) * 0.25;
            const near = (base.x - camPos.x) ** 2 + (base.z - camPos.z) ** 2 < 300 * 300;
            const sc = taken || !near ? 0 : this.scale;
            this.p.set(base.x, base.y + bob, base.z);
            this.e.set(0, t * 0.8 * this.spin + i, 0);
            this.q.setFromEuler(this.e);
            this.s.setScalar(sc);
            this.m4.compose(this.p, this.q, this.s);
            this.inst.setMatrixAt(i, this.m4);
            pa.setXYZ(i, taken || !near ? 0 : this.p.x, taken || !near ? -999 : this.p.y, taken || !near ? 0 : this.p.z);
        }
        this.inst.instanceMatrix.needsUpdate = true;
        pa.needsUpdate = true;
    }

    nearest(p, r) {
        let best = -1, bd = r * r;
        for (let i = 0; i < this.pos.length; i++) {
            if (this.taken.has(i)) continue;
            const d = this.pos[i].distanceToSquared(p);
            if (d < bd) {
                bd = d;
                best = i;
            }
        }
        return best;
    }

    remaining() {
        return this.pos.length - this.taken.size;
    }
}

export function installPlay(MW) {
    const P = MW.prototype;

    P._resetPlay = function () {
        this.photoOn = false;
        this.run = { state: 'idle', t: 0, idx: 0 };
        this.speedBoost = 0;
        this._holdAct = null;
        this._near = null;
        this.player.m && (this.player.m.root.visible = true);
        this.ui.setFinder(false);
        this.ui.setRunHud && this.ui.setRunHud(null);
        this.bursts = this.bursts || [];
        this._syncCollectibles();
        this._syncSocket();
        this._buildPet && this._buildPet();
        if (this.refs.temple) this.refs.temple.open = this.S.has('vaultOpen') ? 1 : 0;
        if (this.refs.caves) this.refs.caves.moon.visible = !this.S.has('geraldBeaten');
        if (this.refs.vanityLid) this.refs.vanityLid.visible = true;
        if (this.friends) this.friends.forEach((f) => { f.wedding = false; f.sit = false; f.action = null; });
    };

    // ---------------------------------------------------------------------------------------------
    // Collectibles
    // ---------------------------------------------------------------------------------------------
    P._buildCollectibles = function () {
        const scene = this.scene, S = this.S, R = this.refs;
        const rnd = mulberry32(31337);
        // Pearls: scattered over the reef, plus a few tucked into the landmarks
        const spots = [];
        const fixed = [
            R.ship.deck.clone().add(V3(2, 1.5, 4)), R.clam.pos.clone().add(V3(10, 1, 4)), R.whaleSkel.pos.clone().add(V3(0, 2, -3)), R.kelp.pos.clone().add(V3(0, 3, 0)),
            R.lagoon.start.clone().add(V3(-6, -6, 2)), R.grotto.center.clone().add(V3(10, 3, 12)), R.temple.center.clone().add(V3(22, 4, 36)), R.temple.center.clone().add(V3(-20, 2, 12)),
            R.caves.center.clone().add(V3(10, 2, 10)), R.caves.center.clone().add(V3(-15, 2, -8)), R.caves.center.clone().add(V3(5, 2, -22)), R.caves.hoard.clone().add(V3(-8, -4, 4)),
            R.trench.bottom.clone().add(V3(10, 2, 8)), R.trench.rim.clone().add(V3(14, 3, 6)), R.chapel.socket.clone().add(V3(0, -30, 6))
        ];
        for (const f of fixed) {
            f.y = Math.max(f.y, floorHeight(f.x, f.z) + 1.3);
            spots.push(f);
        }
        let guard = 0;
        while (spots.length < PEARL_COUNT && guard++ < 4000) {
            const a = rnd() * TWO_PI, r = Math.sqrt(rnd()) * (WORLD_R - 20);
            const x = Math.cos(a) * r, z = Math.sin(a) * r;
            if (blocked(x, z, 3)) continue;
            if (spots.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 28 * 28)) continue;
            spots.push(V3(x, floorHeight(x, z) + 1.3 + rnd() * 1.2, z));
        }
        const pearlMat = new THREE.MeshStandardMaterial({ color: 0xf4fbff, emissive: 0xbfe9ff, emissiveIntensity: 0.9, roughness: 0.05, metalness: 0.25 });
        this.env.registerGlow(pearlMat, 0.7, 0.8);
        this.pearls = new Collectibles(scene, spots, new THREE.SphereGeometry(0.55, 14, 10), pearlMat, 0xbfe9ff, 3.2, S.pearls);
        // Rare shells: spiral conchs with a rainbow sheen, +10 sand dollars each
        const shellSpots = [];
        guard = 0;
        while (shellSpots.length < SHELL_COUNT && guard++ < 4000) {
            const a = rnd() * TWO_PI, r = Math.sqrt(rnd()) * (WORLD_R - 30);
            const x = Math.cos(a) * r, z = Math.sin(a) * r;
            if (blocked(x, z, 3)) continue;
            shellSpots.push(V3(x, floorHeight(x, z) + 0.9, z));
        }
        const shellG = new THREE.ConeGeometry(0.5, 1.2, 8);
        shellG.translate(0, 0.4, 0);
        const shellMat = new THREE.MeshPhysicalMaterial({ color: 0xffc3e8, roughness: 0.2, metalness: 0.2, iridescence: 1, iridescenceIOR: 1.6, emissive: 0xff8fd0, emissiveIntensity: 0.35 });
        this.shells = new Collectibles(scene, shellSpots, shellG, shellMat, 0xff9ff3, 2.6, S.shells);
        // Sea flowers for the bouquet: around the kelp forest and the garden
        const fl = [];
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * TWO_PI + 0.4;
            const x = R.kelp.pos.x + Math.sin(a) * 17, z = R.kelp.pos.z + Math.cos(a) * 17;
            fl.push(V3(x, floorHeight(x, z) + 1.3, z));
        }
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * TWO_PI + 0.9;
            const x = R.garden.center.x + Math.sin(a) * 19, z = R.garden.center.z + Math.cos(a) * 19;
            fl.push(V3(x, floorHeight(x, z) + 1.3, z));
        }
        const flowerG = new THREE.IcosahedronGeometry(0.55, 1);
        const flowerMat = new THREE.MeshStandardMaterial({ color: 0xff9ff3, emissive: 0xff6bd6, emissiveIntensity: 1.1, roughness: 0.4 });
        this.env.registerGlow(flowerMat, 0.9, 0.8);
        this.flowers = new Collectibles(scene, fl, flowerG, flowerMat, 0xff9ff3, 3.4, this._idSet('flowerIds'));
        // Three shiny pebbles for Bubbles
        const pb = [[-15, 16], [25, -9], [7, -24]].map(([x, z]) => V3(x, floorHeight(x, z) + 0.9, z));
        const pebbleMat = new THREE.MeshStandardMaterial({ color: 0xfff3b0, emissive: 0xffe08a, emissiveIntensity: 1.0, roughness: 0.2, metalness: 0.6 });
        this.pebbles = new Collectibles(scene, pb, new THREE.DodecahedronGeometry(0.5, 0), pebbleMat, 0xffe08a, 3.0, this._idSet('pebbleIds'));
        // Glow orbs in the caves
        const orbMat = new THREE.MeshStandardMaterial({ color: 0xd9fbff, emissive: 0x7fe8ff, emissiveIntensity: 1.8, roughness: 0.05, transparent: true, opacity: 0.9 });
        this.orbs = new Collectibles(scene, R.orbSpots.map((v) => v.clone()), new THREE.SphereGeometry(0.7, 14, 10), orbMat, 0x7fe8ff, 7, this._idSet('orbIds'));
        this.orbs.spin = 0;
        this._buildRings();
        this._buildTreasureMarks();
        this._buildGarden();
    };

    P._idSet = function (key) {
        return new Set(this.S.flags[key] || []);
    };

    P._saveIds = function (key, set) {
        this.S.flags[key] = [...set];
    };

    P._syncCollectibles = function () {
        if (!this.pearls) return;
        this.pearls.taken = new Set(this.S.pearls);
        this.shells.taken = new Set(this.S.shells);
        this.flowers.taken = this._idSet('flowerIds');
        this.pebbles.taken = this._idSet('pebbleIds');
        this.orbs.taken = this._idSet('orbIds');
        this.pebbles.setVisible(this.S.has('bubblesAsked') && !this.S.has('clueBubbles'));
        this.flowers.setVisible(this.S.has('planned') && !this.S.has('weddingDone') || this.flowers.remaining() < this.flowers.pos.length);
        this.flowers.setVisible(this.S.has('planned') && !this.S.has('weddingDone'));
        this.orbs.setVisible(this.S.has('moonStarted') || this.S.count('glowOrb') > 0);
    };

    P._showPebbles = function (on) {
        this.pebbles.setVisible(on);
    };

    P._updateCollectibles = function (dt, t) {
        if (!this.pearls) return;
        const cam = this.camera.position;
        this.pearls.update(t, cam);
        this.shells.update(t, cam);
        this.flowers.update(t, cam);
        this.pebbles.update(t, cam);
        this.orbs.update(t, cam);
        if (this.mode !== 'explore') return;
        const pp = this.player.pos;
        const S = this.S;
        let i = this.pearls.nearest(pp, 2.7);
        if (i >= 0) {
            this.pearls.taken.add(i);
            S.pearls.add(i);
            S.money += 2;
            this.ui.toast(`🦪 Pearl ${S.pearls.size}/${PEARL_COUNT} (+2 🐚)`);
            if (this.audio) this.audio.pickup(S.pearls.size % 8);
            this._sparkle(pp, 0xbfe9ff);
            this.refreshQuests();
        }
        i = this.shells.nearest(pp, 2.7);
        if (i >= 0) {
            this.shells.taken.add(i);
            S.shells.add(i);
            S.money += 10;
            this.ui.toast(`🐚 Rare shell ${S.shells.size}/${SHELL_COUNT} (+10 🐚)`);
            if (this.audio) this.audio.sparkle();
            this._sparkle(pp, 0xff9ff3);
        }
        if (this.flowers.visible) {
            i = this.flowers.nearest(pp, 2.8);
            if (i >= 0) {
                this.flowers.taken.add(i);
                this._saveIds('flowerIds', this.flowers.taken);
                S.inc('flower');
                this.ui.toast(`🌸 Sea flower ${S.count('flower')}/8`);
                if (this.audio) this.audio.pickup(2);
                this._sparkle(pp, 0xff9ff3);
                this.refreshQuests();
            }
        }
        if (this.pebbles.visible) {
            i = this.pebbles.nearest(pp, 2.8);
            if (i >= 0) {
                this.pebbles.taken.add(i);
                this._saveIds('pebbleIds', this.pebbles.taken);
                S.inc('pebble');
                this.ui.toast(`✨ Shiny pebble ${S.count('pebble')}/3`);
                if (this.audio) this.audio.pickup(5);
                this._sparkle(pp, 0xffe08a);
            }
        }
        if (this.orbs.visible) {
            i = this.orbs.nearest(pp, 3.2);
            if (i >= 0) {
                this.orbs.taken.add(i);
                this._saveIds('orbIds', this.orbs.taken);
                S.inc('glowOrb');
                this.ui.toast(`🔮 Glow orb ${S.count('glowOrb')}/5`);
                if (this.audio) this.audio.sparkle();
                this._sparkle(pp, 0x7fe8ff);
                this.refreshQuests();
            }
        }
    };

    // ---------------------------------------------------------------------------------------------
    // Particle bursts
    // ---------------------------------------------------------------------------------------------
    P._burst = function (at, n, color, speed = 4, size = 0.5, life = 3, glow = false) {
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(n * 3);
        const vel = [];
        for (let i = 0; i < n; i++) {
            pos.set([at.x, at.y, at.z], i * 3);
            vel.push(new THREE.Vector3(between(-1, 1), between(-1, 1), between(-1, 1)).normalize().multiplyScalar(speed * between(0.4, 1)));
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const m = new THREE.PointsMaterial({ color, size, transparent: true, depthWrite: false, opacity: 1, blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending, map: glow ? glowTexture() : this.env.bubbleTex });
        const pts = new THREE.Points(geo, m);
        pts.frustumCulled = false;
        this.scene.add(pts);
        (this.bursts = this.bursts || []).push({ pts, vel, t: 0, life, rise: glow ? 0 : 1.5 });
    };

    P._sparkle = function (at, color) {
        this._burst(at, 14, color, 2.6, 0.45, 0.9, true);
    };

    P._updateBursts = function (dt) {
        if (!this.bursts) return;
        for (let i = this.bursts.length - 1; i >= 0; i--) {
            const b = this.bursts[i];
            b.t += dt;
            const pa = b.pts.geometry.attributes.position;
            for (let k = 0; k < pa.count; k++) {
                const v = b.vel[k];
                v.multiplyScalar(Math.exp(-1.2 * dt));
                v.y += b.rise * dt;
                pa.setXYZ(k, pa.getX(k) + v.x * dt, pa.getY(k) + v.y * dt, pa.getZ(k) + v.z * dt);
            }
            pa.needsUpdate = true;
            b.pts.material.opacity = Math.max(0, 1 - b.t / b.life);
            if (b.t > b.life) {
                this.scene.remove(b.pts);
                b.pts.geometry.dispose();
                b.pts.material.dispose();
                this.bursts.splice(i, 1);
            }
        }
    };

    // ---------------------------------------------------------------------------------------------
    // Rings: the training rings and the Ring Run
    // ---------------------------------------------------------------------------------------------
    P._makeRing = function (pos, radius, color) {
        const g = new THREE.Group();
        const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2, roughness: 0.3 });
        const torus = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.1, 10, 36), m);
        g.add(torus);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 28), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
        g.add(disc);
        const gs = glowSprite(color, radius * 3.2, 0.5);
        g.add(gs);
        g.position.copy(pos);
        g.visible = false;
        this.scene.add(g);
        return { g, pos: pos.clone(), radius, m, disc, normal: V3(0, 0, 1), gs };
    };

    P._buildRings = function () {
        // Training rings from the dressing shell to the plaza
        this.trainingRings = TRAINING_RINGS.map(([x, y, z]) => this._makeRing(V3(x, y, z), 4.2, 0x48dbfb));
        this.trainingRings.forEach((r, i) => {
            const next = this.trainingRings[i + 1] ? V3(...TRAINING_RINGS[i + 1]) : V3(0, 8, -40);
            r.normal.copy(next).sub(r.pos).normalize();
            r.g.lookAt(r.pos.clone().add(r.normal));
        });
        // The lagoon course
        this.runRings = RING_RUN.rings.map(([x, y, z]) => this._makeRing(V3(x, y, z), RING_RUN.radius, 0xffeaa7));
        this.runRings.forEach((r, i) => {
            const next = this.runRings[i + 1] ? this.runRings[i + 1].pos : V3(...RING_RUN.rings[i]).add(V3(-3, 0, 12));
            const prev = i > 0 ? this.runRings[i - 1].pos : V3(...RING_RUN.start);
            r.normal.copy(next).sub(prev).normalize();
            r.g.lookAt(r.pos.clone().add(r.normal));
        });
        this.runStartPos = V3(...RING_RUN.start);
    };

    P._ringPassed = function (ring, prev, pos) {
        const d0 = prev.clone().sub(ring.pos).dot(ring.normal);
        const d1 = pos.clone().sub(ring.pos).dot(ring.normal);
        if (d0 === d1 || d0 * d1 > 0) return false;
        const k = d0 / (d0 - d1);
        const hit = prev.clone().lerp(pos, k);
        return hit.distanceTo(ring.pos) < ring.radius + 0.6;
    };

    P._updateRings = function (dt, t) {
        const S = this.S;
        const pp = this.player.pos, prev = this._prevPlayerPos || pp;
        // Training
        const stage = S.count('trainingRings');
        this.trainingRings.forEach((r, i) => {
            const on = stage < 4 && i === stage && !S.has('metSage') || (stage < 4 && i === stage);
            r.g.visible = on;
            if (on) {
                r.m.emissiveIntensity = 1.0 + Math.sin(t * 5) * 0.4;
                r.g.scale.setScalar(1 + Math.sin(t * 3) * 0.04);
                if (this._ringPassed(r, prev, pp)) {
                    S.inc('trainingRings');
                    this.ui.toast(`🌀 Ring ${S.count('trainingRings')}/4`);
                    if (this.audio) this.audio.ring(true, S.count('trainingRings'));
                    this._sparkle(r.pos, 0x48dbfb);
                    this.refreshQuests();
                }
            }
        });
        // The run
        const run = this.run;
        const showRun = run.state === 'run';
        this.runRings.forEach((r, i) => {
            r.g.visible = showRun && i >= run.idx && i <= run.idx + 3;
            if (r.g.visible) {
                const cur = i === run.idx;
                r.m.color.setHex(cur ? 0xffeaa7 : 0x74b9ff);
                r.m.emissive.setHex(cur ? 0xffeaa7 : 0x74b9ff);
                r.m.emissiveIntensity = cur ? 1.5 + Math.sin(t * 8) * 0.5 : 0.5;
                r.disc.material.opacity = cur ? 0.25 : 0.06;
                r.g.scale.setScalar(cur ? 1 + Math.sin(t * 6) * 0.05 : 0.9);
            }
        });
    };

    P._updateRun = function (dt) {
        if (!this.runRings) return;
        const run = this.run;
        const t = this.time;
        this._updateRings(dt, t);
        const pp = this.player.pos, prev = this._prevPlayerPos || pp;
        if (run.state === 'count') {
            run.t -= dt;
            const n = Math.ceil(run.t);
            if (n !== run.shown) {
                run.shown = n;
                this.ui.caption(n > 0 ? `${n}` : 'GO!', 900);
                if (this.audio) this.audio.ring(n <= 0, n > 0 ? -5 : 7);
            }
            if (run.t <= -0.4) {
                run.state = 'run';
                run.t = 0;
                run.idx = 0;
                this.speedBoost = 1;
            }
        } else if (run.state === 'run') {
            run.t += dt;
            const r = this.runRings[run.idx];
            this.ui.setRunHud(`⏱ ${run.t.toFixed(1)}s   ·   Ring ${run.idx + 1}/${this.runRings.length}   ·   gold ${RING_RUN.gold}s  silver ${RING_RUN.silver}s  bronze ${RING_RUN.bronze}s`);
            if (this._ringPassed(r, prev, pp)) {
                this._sparkle(r.pos, 0xffeaa7);
                if (this.audio) this.audio.ring(true, run.idx);
                run.idx++;
                if (run.idx >= this.runRings.length) this._finishRun();
            } else if (run.t > 240 || pp.distanceTo(this.refs.lagoon.center) > 190) {
                this._cancelRun('The ring run was abandoned.');
            }
        }
    };

    P._startRun = function () {
        if (this.run.state !== 'idle') return;
        this.run = { state: 'count', t: 3.2, idx: 0, shown: 4 };
        this.ui.toast('Swim through every ring! Sprint with Shift.');
    };

    P._cancelRun = function (msg) {
        this.run = { state: 'idle', t: 0, idx: 0 };
        this.speedBoost = 0;
        this.ui.setRunHud(null);
        if (msg) this.ui.toast(msg);
    };

    P._finishRun = function () {
        const S = this.S;
        const time = this.run.t;
        this.run = { state: 'idle', t: 0, idx: 0 };
        this.speedBoost = 0;
        this.ui.setRunHud(null);
        const medal = time <= RING_RUN.gold ? 'gold' : time <= RING_RUN.silver ? 'silver' : time <= RING_RUN.bronze ? 'bronze' : null;
        const rank = { gold: 3, silver: 2, bronze: 1 };
        const prevMedal = S.ringBest == null ? null : (S.ringBest <= RING_RUN.gold ? 'gold' : S.ringBest <= RING_RUN.silver ? 'silver' : S.ringBest <= RING_RUN.bronze ? 'bronze' : null);
        if (S.ringBest == null || time < S.ringBest) S.ringBest = time;
        let text = `Finished in ${time.toFixed(1)}s!`;
        if (medal) {
            text += `  ${{ gold: '🥇 Gold', silver: '🥈 Silver', bronze: '🥉 Bronze' }[medal]}`;
            if (!prevMedal || rank[medal] > rank[prevMedal]) this.giveMoney(RING_RUN.reward[medal]);
        } else text += '  (a bit slower than bronze, try again!)';
        this.ui.caption(text, 4500);
        if (this.audio) this.audio.success();
        this.refreshQuests();
    };

    // ---------------------------------------------------------------------------------------------
    // Camera and the photo safari
    // ---------------------------------------------------------------------------------------------
    P._setPhoto = function (on) {
        if (this.mode !== 'explore' || (on && (this.ui.modalOpen || this.ui.gameOpen))) return;
        this.photoOn = on;
        this.fov = on ? 45 : 65;
        this.player.m.root.visible = !on;
        this.ui.setFinder(on, 'Click or Space to take a photo · wheel zooms · F to put the camera away');
        if (on) this._freeMouseOk = true;
    };

    /** Everything in the world that can be photographed. */
    P._photoSubjects = function () {
        const out = [];
        for (const r of this.roamers) out.push({ id: r.id, obj: r.g, radius: r.radius });
        for (const t of this.talkers) if (t.g.userData.photoId) out.push({ id: t.g.userData.photoId, obj: t.g, radius: 2 });
        for (const k of ['gary', 'grandma']) {
            const n = this.npc[k];
            if (n) out.push({ id: n.g.userData.photoId, obj: n.g, radius: k === 'gary' ? 3 : 13 });
        }
        return out;
    };

    P._shutter = function () {
        if (this._shutterT > this.time) return;
        this._shutterT = this.time + 0.6;
        this.ui.flash();
        if (this.audio) this.audio.shutter();
        const cam = this.camera;
        cam.updateMatrixWorld();
        const v = new THREE.Vector3();
        const found = [];
        const half = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
        for (const s of this._photoSubjects()) {
            s.obj.getWorldPosition(v);
            const dist = v.distanceTo(cam.position);
            v.project(cam);
            if (v.z > 1 || Math.abs(v.x) > 0.85 || Math.abs(v.y) > 0.85) continue;
            const size = (s.radius * 2) / (2 * dist * half);   // fraction of the screen height
            if (dist > 90 || dist < 2 || size < 0.07 || size > 1.6) continue;
            found.push(s);
        }
        const S = this.S;
        const names = [];
        for (const s of found) {
            if (!S.album.has(s.id)) {
                S.album.add(s.id);
                const pt = PHOTO_TARGETS.find((p) => p.id === s.id);
                names.push(pt ? pt.name : s.id);
                S.money += 5;
                this.ui.toast(`📸 New in the album: ${pt ? pt.name : s.id} (${S.album.size}/${PHOTO_TARGETS.length}) +5 🐚`);
                this._thumbFor = this._thumbFor || [];
                this._thumbFor.push({ id: s.id, name: pt ? pt.name : s.id });
            }
        }
        // a group selfie with all three friends
        if (S.has('friendsFollow') && !S.has('selfie')) {
            const all = this.friends.every((f) => {
                v.copy(f.pos).project(cam);
                return v.z < 1 && Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.9 && f.pos.distanceTo(cam.position) < 22;
            });
            if (all) {
                S.set('selfie');
                this.ui.toast('🤳 Group selfie! Everyone looks amazing.');
                this.ui.caption(`${pick(this.friends).def.name}: "Post it! POST IT!"`, 3000);
                this.friends.forEach((f) => { f.action = 'cheer'; f.actionT = 2.5; });
            }
        }
        if (!found.length && !names.length) this.ui.toast('Nothing worth framing... try a creature, closer and centred.');
        this._wantThumb = true;
        this.refreshQuests();
    };

    P._grabThumb = function () {
        this._wantThumb = false;
        if (!this._thumbFor || !this._thumbFor.length) return;
        try {
            const c = document.createElement('canvas');
            c.width = 240;
            c.height = 150;
            c.getContext('2d').drawImage(this.renderer.domElement, 0, 0, c.width, c.height);
            const url = c.toDataURL('image/jpeg', 0.7);
            this.albumImgs = this.albumImgs || {};
            for (const t of this._thumbFor) this.albumImgs[t.id] = url;
        } catch (e) { /* canvas tainted or empty */ }
        this._thumbFor = [];
    };

    // ---------------------------------------------------------------------------------------------
    // Treasure
    // ---------------------------------------------------------------------------------------------
    P._buildTreasureMarks = function () {
        this.treasureMarks = TREASURES.map((t) => {
            const g = new THREE.Group();
            const m = new THREE.MeshStandardMaterial({ color: 0xffd54f, emissive: 0xffb300, emissiveIntensity: 1.4 });
            for (const r of [0.78, -0.78]) {
                const bar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.35), m);
                bar.rotation.y = r;
                g.add(bar);
            }
            const gs = glowSprite(0xffd54f, 7, 0.6);
            gs.position.y = 1;
            g.add(gs);
            const y = floorHeight(t.at[0], t.at[2]);
            g.position.set(t.at[0], y + 0.12, t.at[2]);
            g.visible = false;
            this.scene.add(g);
            return { def: t, g, pos: V3(t.at[0], y + 1.5, t.at[2]) };
        });
    };

    P._showTreasureMarks = function () { /* visibility is updated each frame */ };

    P._updateTreasureMarks = function () {
        const S = this.S;
        for (const m of this.treasureMarks) {
            m.g.visible = S.has('hasMap') && !S.treasures.has(m.def.id);
            if (m.g.visible) m.g.rotation.y = this.time * 0.6;
        }
    };

    P._dig = function (m) {
        const S = this.S;
        S.treasures.add(m.def.id);
        S.money += m.def.loot;
        this.ui.toast(`🏴‍☠️ Treasure ${S.treasures.size}/${TREASURES.length}: +${m.def.loot} 🐚!`);
        this._burst(m.pos, 50, 0xffd54f, 6, 0.6, 2.2, true);
        this._burst(m.pos, 24, 0xffffff, 3, 0.5, 2.5);
        if (this.audio) { this.audio.coin(); this.audio.success(); }
        this.player.action = null;
        this.refreshQuests();
    };

    // ---------------------------------------------------------------------------------------------
    // The sea garden
    // ---------------------------------------------------------------------------------------------
    P._buildGarden = function () {
        const [gx, gz] = A('garden');
        this.gardenPlots = GARDEN.plots.map(([x, z], i) => {
            const y = floorHeight(x, z);
            const mound = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.9, 0.5, 14), new THREE.MeshStandardMaterial({ color: 0xc9b47e, roughness: 1 }));
            mound.position.set(x, y + 0.15, z);
            this.scene.add(mound);
            for (let k = 0; k < 8; k++) {
                const a = (k / 8) * TWO_PI;
                const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.25, 0), new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 1 }));
                st.position.set(x + Math.sin(a) * 1.8, y + 0.15, z + Math.cos(a) * 1.8);
                this.scene.add(st);
            }
            return { i, pos: V3(x, y + 1.2, z), plantObj: null, plantedAt: null, type: null };
        });
    };

    P._updateGarden = function (dt) {
        if (!this.gardenPlots) return;
        const S = this.S;
        // make sure what is planted is shown
        for (const plot of this.gardenPlots) {
            const rec = S.plants.find((p) => p.plot === plot.i);
            if (!rec) {
                if (plot.plantObj) { this.scene.remove(plot.plantObj); plot.plantObj = null; plot.type = null; }
                continue;
            }
            const k = clamp((S.playTime - rec.t0) / GARDEN.growSeconds, 0, 1);
            if (!plot.plantObj || plot.type !== rec.type) {
                if (plot.plantObj) this.scene.remove(plot.plantObj);
                const def = GARDEN.plants.find((p) => p.id === rec.type);
                plot.plantObj = buildPlant(rec.type, def.color, 1);
                plot.plantObj.position.copy(plot.pos).add(V3(0, -0.9, 0));
                this.scene.add(plot.plantObj);
                plot.type = rec.type;
            }
            plot.k = k;
            plot.plantObj.scale.setScalar((0.25 + k * 0.9) * (1 + Math.sin(this.time * 2 + plot.i) * 0.02));
            plot.plantObj.children.forEach((c) => { if (c.userData.sway !== undefined) c.rotation.z = Math.sin(this.time * 2 + c.userData.sway) * 0.12; });
        }
        if (S.plants.length >= GARDEN.plots.length && !S.has('gardenBloomed') && this.gardenPlots.every((p) => (p.k || 0) >= 1)) {
            S.set('gardenBloomed');
            this.ui.caption('🌺 The garden is in full bloom!', 3500);
            if (this.audio) this.audio.success();
            this.refreshQuests();
        }
    };

    P._plot = async function (plot) {
        const S = this.S;
        const rec = S.plants.find((p) => p.plot === plot.i);
        const who = 'Sea Garden';
        if (rec) {
            const k = clamp((S.playTime - rec.t0) / GARDEN.growSeconds, 0, 1);
            const def = GARDEN.plants.find((p) => p.id === rec.type);
            if (k < 1) {
                await this.say(who, `${def.name}: ${Math.round(k * 100)}% grown. Patience!`);
                return;
            }
            const i = await this.choice(who, `${def.name} is in full bloom. ✨`, ['Admire it', 'Dig it up (get the seed back)']);
            if (i === 1) {
                S.plants = S.plants.filter((p) => p.plot !== plot.i);
                S.counts.seed = (S.counts.seed || 0) + 1;
            }
            return;
        }
        if (S.count('seed') <= 0) {
            await this.say(who, 'An empty plot. You need seeds: Professor Urchin has some, and the Trinket Trove sells more.');
            return;
        }
        const i = await this.choice(who, `What shall we plant? (Seeds: ${S.count('seed')})`, GARDEN.plants.map((p) => p.name));
        if (i < 0) return;
        S.plants.push({ plot: plot.i, type: GARDEN.plants[i].id, t0: S.playTime });
        S.counts.seed--;
        this.ui.toast(`🌱 Planted ${GARDEN.plants[i].name} (${S.plants.length}/${GARDEN.plots.length})`);
        if (this.audio) this.audio.pickup(0);
        this._burst(plot.pos, 12, 0x9ff4b0, 2, 0.4, 1.2, true);
        this.refreshQuests();
    };

    // ---------------------------------------------------------------------------------------------
    // Shops
    // ---------------------------------------------------------------------------------------------
    P._openShop = async function (shop) {
        this._freeMouse();
        const S = this.S;
        if (shop.id === 'scales' && S.has('planned') && !S.has('inviteOctavia')) {
            await this._invite('Octavia', 'Auntie Octavia', ['Darling!! Is that a wedding invitation I see?', 'Oh my, a mermaid wedding. I\'ll do the hair for the whole bridal party. Eight arms, you know. Efficient.']);
            this.refreshQuests();
        }
        if (shop.kind === 'food' && !S.has('friendsFollow')) this.ui.toast('Tip: the Café is more fun with friends (see Mall Day).');
        const state = {
            money: S.money, owned: S.owned, giftMode: S.has('friendsFollow') && !S.has('mallFinished') && S.gifted.size < 3,
            friends: this.friends.map((f) => ({ id: f.def.id, name: f.def.name, gifted: S.gifted.has(f.def.id) }))
        };
        this.ui.openShop(shop, state, (item, forFriend) => {
            const ownedIt = item.unlock && item.unlock.every((u) => S.owned.has(u)) && !item.food;
            const price = ownedIt && !forFriend ? 0 : item.price;
            if (S.money < price) return false;
            S.money -= price;
            state.money = S.money;
            state.giftMode = S.has('friendsFollow') && !S.has('mallFinished') && S.gifted.size < 3;
            state.friends.forEach((f) => { f.gifted = S.gifted.has(f.id); });
            this._hudT = 0;
            if (forFriend) {
                this._giveGift(item, forFriend);
                state.giftMode = S.gifted.size < 3;
                state.friends.forEach((f) => { f.gifted = S.gifted.has(f.id); });
                return true;
            }
            if (item.grants) {
                if (item.grants.seeds) S.counts.seed = (S.counts.seed || 0) + item.grants.seeds;
                if (item.grants.flag) S.set(item.grants.flag);
                this.ui.toast(item.grants.seeds ? `🌱 +${item.grants.seeds} seeds` : '🗺️ Treasure map! See your journal (J)');
                if (this.audio) this.audio.pickup();
                this.refreshQuests();
                return true;
            }
            if (item.food) {
                this.ui.closeModal();
                this._eat(item, shop);
                return false;
            }
            if (item.give) {
                if (item.unlock) item.unlock.forEach((u) => S.owned.add(u));
                Object.assign(S.look, item.give);
                this._rebuildPlayer(S.look);
                this.player.m.root.position.copy(this.player.pos);
                if (S.has('friendsFollow') && rand() < 0.6) this.ui.caption(`${pick(this.friends).def.name}: "${pick(FRIEND_LINES.shop)}"`, 3000);
                if (item.give.tailPattern || item.give.tail !== undefined) { /* a new tail */ }
                S.set('boughtSelf');
                if (this.audio) this.audio.chime();
                this.refreshQuests();
                return true;
            }
            return true;
        }, () => { this.refreshQuests(); });
    };

    // ---------------------------------------------------------------------------------------------
    // Minigames
    // ---------------------------------------------------------------------------------------------
    P._runGame = async function (make) {
        this._freeMouse();
        const host = this.ui.openGame();
        const g = make(host);
        this.game = g;
        let res;
        try {
            res = await g.start();
        } finally {
            this.game = null;
            this.ui.closeGame();
            this.keys = {};
        }
        return res;
    };

    P._playRhythm = async function (song, opts) {
        const prev = this.audio ? this.audio.styleName : null;
        const res = await this._runGame((host) => new RhythmGame(host, this.audio, song, opts));
        if (this.audio && prev) { this._styleWant = null; this.audio.setStyle(prev); }
        return res;
    };

    P._playGrotto = async function (song) {
        const S = this.S;
        const res = await this._playRhythm(song, { pass: 0.55 });
        if (!res || res.cancelled) return;
        S.inc('concerts');
        const pay = res.passed ? { S: 40, A: 30, B: 22, C: 15, D: 10 }[res.grade] || 10 : 5;
        this.giveMoney(pay);
        this.ui.caption(res.passed ? `The crowd goes wild! (${S.count('concerts')} sets played)` : 'Polite applause...', 3500);
        this.refreshQuests();
    };

    P._arcade = async function (which) {
        const S = this.S;
        let res;
        if (which === 'memory') res = await this._runGame((h) => new MemoryGame(h, this.audio, 8));
        else if (which === 'bubbles') res = await this._runGame((h) => new BubbleGame(h, this.audio, 30));
        else {
            const song = pick(SONGS);
            const prev = this.audio ? this.audio.styleName : null;
            res = await this._runGame((h) => new RhythmGame(h, this.audio, song, { pass: 0.4 }));
            if (this.audio && prev) { this._styleWant = null; this.audio.setStyle(prev); }
            if (res && !res.cancelled) res.tickets = Math.round(res.accuracy * 16);
        }
        if (res && !res.cancelled && res.tickets) {
            S.inc('ticket', res.tickets);
            S.inc('ticketsEarned', res.tickets);
            this.ui.toast(`🎟️ +${res.tickets} tickets (you have ${S.count('ticket')})`);
            this.refreshQuests();
        }
    };

    P._prizeCounter = async function () {
        const S = this.S;
        const who = 'Prize Counter';
        const opts = ARCADE_PRIZES.map((p) => `${p.name} — 🎟️ ${p.tickets}`);
        opts.push('Not now');
        const i = await this.choice(who, `You have 🎟️ ${S.count('ticket')} tickets. Pick a prize!`, opts);
        if (i >= ARCADE_PRIZES.length) return;
        const p = ARCADE_PRIZES[i];
        if (S.count('ticket') < p.tickets) { await this.say(who, 'Not enough tickets yet. Go win some!'); return; }
        S.counts.ticket -= p.tickets;
        if (p.money) this.giveMoney(p.money);
        if (p.unlock) p.unlock.forEach((u) => S.owned.add(u));
        if (p.give) {
            if (p.give.pet) { S.pet = p.give.pet; this._buildPet(); this.ui.toast('🐾 A new pet!'); }
            else { Object.assign(S.look, p.give); this._rebuildPlayer(S.look); }
        }
        if (this.audio) this.audio.success();
        this.refreshQuests();
    };

    // ---------------------------------------------------------------------------------------------
    // The temple
    // ---------------------------------------------------------------------------------------------
    P._templeVault = async function () {
        const S = this.S;
        const T = this.refs.temple;
        if (!S.has('vaultOpen')) {
            if (!S.has('moonStarted') && !S.has('clueGlenda') && !S.has('clueLuna') && !S.has('clueBubbles')) {
                await this.say('The Sealed Vault', 'A great stone door, humming with old magic. Four glyph pillars stand around it, waiting for something. (Ask around town about the Moon Pearl first.)');
                return;
            }
            await this.say('The Sealed Vault', 'The seal glows red. The four pillars wait for a pattern: watch them light up, then repeat it.');
            const res = await this._runGame((host) => new GlyphGame(host, this.audio, (i, on) => { if (on) T.glyphs[i].flash = 1; }));
            if (res && res.passed) {
                T.open = 1;
                S.set('vaultOpen');
                this.ui.caption('The vault grinds open...', 3500);
                if (this.audio) this.audio.whaleCall(true);
                this.refreshQuests();
            }
            return;
        }
        if (!S.has('gotMoonMap')) {
            S.set('gotMoonMap');
            await this.conversation('The Open Vault', ['Inside the vault, a pedestal holds an ancient map: the Glow Caves, marked with a crab\'s claw, and an inscription: "The thief hides where the light is stolen."', 'You tuck the map away. (The Glow Caves are marked on your map (M).)']);
            S.places.add('caves');
            this.ui.toast('🗺️ The Glow Caves are marked on your map');
            return;
        }
        await this.say('The Open Vault', 'The vault is empty now. The glyph pillars hum softly.');
    };

    P._touchGlyph = function (i) {
        const T = this.refs.temple;
        T.glyphs[i].flash = 1;
        if (this.audio) this.audio.laneNote(i, true);
    };

    // ---------------------------------------------------------------------------------------------
    // The Moon Pearl socket on the chapel tower
    // ---------------------------------------------------------------------------------------------
    P._buildMoonPearlSocket = function () {
        const sock = this.refs.chapel.socket;
        const g = new THREE.Group();
        const pearl = new THREE.Mesh(new THREE.SphereGeometry(1.6, 32, 24), new THREE.MeshStandardMaterial({ color: 0xfdfbe8, emissive: 0xfff3b0, emissiveIntensity: 1.6, roughness: 0.05 }));
        g.add(pearl);
        const glow = glowSprite(0xfff3b0, 26, 0.7);
        g.add(glow);
        const beamG = new THREE.CylinderGeometry(1.2, 6, 60, 16, 1, true);
        beamG.translate(0, -30, 0);
        const beam = new THREE.Mesh(beamG, new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
        g.add(beam);
        g.position.copy(sock);
        g.visible = false;
        this.scene.add(g);
        this.socket = { g, pearl, glow, beam, pos: sock.clone() };
    };

    P._syncSocket = function () {
        if (this.socket) this.socket.g.visible = this.S.has('pearlReturned');
    };

    P._updateSocket = function (dt, t) {
        const s = this.socket;
        if (!s || !s.g.visible) return;
        const night = this.env.nightness;
        s.glow.material.opacity = 0.4 + night * 0.5 + Math.sin(t * 1.5) * 0.06;
        s.beam.material.opacity = 0.05 + night * 0.18;
        s.pearl.scale.setScalar(1 + Math.sin(t * 1.5) * 0.03);
    };

    // ---------------------------------------------------------------------------------------------
    // Objectives: where things are (for the compass, minimap and the waypoint beacon)
    // ---------------------------------------------------------------------------------------------
    P.where = function (name) {
        const S = this.S, R = this.refs;
        const pp = this.player.pos;
        const nearest = (list) => {
            let best = null, bd = 1e12;
            for (const p of list) {
                const d = p.distanceToSquared(pp);
                if (d < bd) { bd = d; best = p; }
            }
            return best;
        };
        const remaining = (c) => c.pos.filter((p, i) => !c.taken.has(i));
        const sf = R.storefronts || [];
        switch (name) {
            case 'trainingRing': return this.trainingRings[Math.min(3, S.count('trainingRings'))].pos;
            case 'sage': return this.talker('sage').g.position;
            case 'coralie': return this.npc.coralie.g.position;
            case 'flower': return nearest(remaining(this.flowers));
            case 'inviteOctavia': { const s = sf.find((x) => x.shop.id === 'scales'); return s ? s.pos : null; }
            case 'inviteGary': return this.npc.gary.g.position;
            case 'inviteCrabs': return this.npc.crabfam.g.position;
            case 'inviteGrandma': return this.npc.grandma.g.position;
            case 'friends': return this.friendHome;
            case 'mall': return R.mallPos;
            case 'cafe': { const s = sf.find((x) => x.shop.id === 'cafe'); return s ? s.pos : R.mallPos; }
            case 'arcade': return R.arcade.door;
            case 'roamer': return nearest(this.roamers.filter((r) => !S.album.has(r.id)).map((r) => r.g.position)) || this.roamers[0].g.position;
            case 'ringStart': return this.runStartPos;
            case 'who_clueBubbles': return S.has('bubblesAsked') && S.count('pebble') < 3 ? nearest(remaining(this.pebbles)) : this.talker('bubbles').g.position;
            case 'who_clueGlenda': return this.talker('dory').g.position;
            case 'who_clueLuna': return this.talker('luna').g.position;
            case 'temple': return R.temple.vault;
            case 'orb': return S.count('glowOrb') < 5 && this.orbs.remaining() ? (this._insideCave ? nearest(remaining(this.orbs)) : R.caves.entrance) : null;
            case 'gerald': return this.npc.gerald.g.position;
            case 'socket': return S.has('hasMoonPearl') ? this.socket.pos : R.chapel.root.position;
            case 'barnacle': return this.npc.barnacle.g.position;
            case 'treasureSpot': return nearest(this.treasureMarks.filter((m) => !S.treasures.has(m.def.id) && S.has('hasMap')).map((m) => m.pos));
            case 'garden': return R.garden.center;
            case 'petnook': return R.petnook.pos;
            case 'pearl': return nearest(remaining(this.pearls));
            case 'grotto': return R.grotto.stage;
            case 'trench': return R.trench.rim;
            case 'undiscovered': { const l = LANDMARKS.filter((x) => !S.places.has(x.id)); return nearest(l.map((x) => V3(x.at[0], 5, x.at[2]))); }
            case 'fish': return nearest(this.talkers.filter((t) => !S.fishTalked.has(t.id)).map((t) => t.g.position));
            default: return null;
        }
    };

    P._objectiveMarkers = function () {
        const out = [];
        for (const s of this._trackedStatus || []) {
            const step = s.steps.find((x) => !x.done);
            if (!step || !step.step.marker) continue;
            for (const n of step.step.marker(this.S)) {
                const p = this.where(n);
                if (p) out.push({ pos: p, name: n, quest: s.q.title });
            }
        }
        return out;
    };

    // ---------------------------------------------------------------------------------------------
    // Interactions
    // ---------------------------------------------------------------------------------------------
    P._buildInteractables = function () {
        const S = this.S, R = this.refs;
        const list = [];
        const add = (o) => list.push(Object.assign({ r: 6, cond: () => true }, o));
        for (const t of this._npcTargets()) add({ id: t.id, pos: t.pos, r: t.r, label: () => `Talk to ${t.name}`, act: () => this.talk(t.id) });
        for (const sf of R.storefronts) add({ id: 'shop_' + sf.shop.id, pos: () => sf.pos, r: 7, label: () => `Enter ${sf.shop.name}`, act: () => this._openShop(sf.shop) });
        add({ id: 'vanity', pos: () => R.vanity.pos.clone().add(V3(0, 0, 8)), r: 11, label: () => 'Visit the Dressing Shell (change your look)', act: () => this._wardrobe() });
        const cab = R.arcade.cabinets;
        add({ id: 'cab0', pos: () => cab[0], r: 6, label: () => 'Play Shell Match', act: () => this._arcade('memory') });
        add({ id: 'cab1', pos: () => cab[1], r: 6, label: () => 'Play Bubble Pop', act: () => this._arcade('bubbles') });
        add({ id: 'cab2', pos: () => cab[2], r: 6, label: () => 'Play Rhythm Rave', act: () => this._arcade('rave') });
        add({ id: 'cab3', pos: () => cab[3], r: 6, label: () => 'Play Shell Match', act: () => this._arcade('memory') });
        add({ id: 'cab4', pos: () => cab[4], r: 6, label: () => 'Play Bubble Pop', act: () => this._arcade('bubbles') });
        add({ id: 'prizes', pos: () => R.arcade.counter, r: 6, label: () => `Prize counter (🎟️ ${S.count('ticket')})`, act: () => this._prizeCounter() });
        add({ id: 'vault', pos: () => R.temple.vault, r: 10, label: () => (S.has('vaultOpen') ? (S.has('gotMoonMap') ? 'Inspect the open vault' : 'Enter the vault') : 'Study the sealed vault'), act: () => this._templeVault() });
        R.temple.glyphs.forEach((g, i) => add({ id: 'glyph' + i, pos: () => g.pos, r: 4.5, label: () => `Touch the ${g.gl.name} glyph`, act: () => this._touchGlyph(i) }));
        add({ id: 'socket', pos: () => this.socket.pos, r: 22, cond: () => S.has('hasMoonPearl') && !S.has('pearlReturned'), label: () => 'Place the Moon Pearl in the tower', act: () => this.runFestival() });
        add({ id: 'relic', pos: () => R.trench.bottom.clone().add(V3(0, 3, 0)), r: 6, cond: () => !S.has('trenchRelic'), label: () => 'Touch the glowing relic', act: () => this._touchRelic() });
        add({ id: 'run', pos: () => this.runStartPos, r: 12, cond: () => this.run.state === 'idle', label: () => `Start the Ring Run${S.ringBest != null ? ` (best ${S.ringBest.toFixed(1)}s)` : ''}`, act: () => this._startRun() });
        add({ id: 'runstop', pos: () => this.runStartPos, r: 12, cond: () => this.run.state !== 'idle', label: () => 'Abandon the Ring Run', act: () => this._cancelRun('Ring run abandoned.') });
        this.treasureMarks.forEach((m) => add({
            id: 'dig_' + m.def.id, pos: () => m.pos, r: 4, hold: 2.4, cond: () => S.has('hasMap') && !S.treasures.has(m.def.id),
            label: () => 'Dig here (hold)', act: () => this._dig(m), action: 'dig'
        }));
        this.gardenPlots.forEach((p) => add({
            id: 'plot' + p.i, pos: () => p.pos, r: 3.2, label: () => {
                const rec = S.plants.find((x) => x.plot === p.i);
                if (!rec) return 'Plant a seed';
                const k = clamp((S.playTime - rec.t0) / GARDEN.growSeconds, 0, 1);
                return k >= 1 ? 'Tend the plant' : `Growing... ${Math.round(k * 100)}%`;
            }, act: () => this._plot(p)
        }));
        this.interactables = list;
    };

    P._wardrobe = function () {
        const back = this.player.pos.clone();
        this._openCreator(false, back);
    };

    P._touchRelic = async function () {
        const S = this.S;
        S.set('trenchRelic');
        this._burst(this.refs.trench.bottom.clone().add(V3(0, 3, 0)), 80, 0x9ff4ff, 6, 0.7, 3, true);
        if (this.audio) { this.audio.success(); this.audio.whaleCall(true); }
        await this.conversation('The Relic', ['The crystal hums. For a moment you can hear the whole ocean breathing.', 'A pearl-sized shard breaks loose and drifts into your hand. It is warm.']);
        S.pearls.add(1000 + S.pearls.size);
        this.refreshQuests();
    };

    P._exploreSystems = function (dt) {
        this._updateTreasureMarks();
        const S = this.S;
        const P_ = this.player;
        // interaction target
        let best = null, bd = 1e9;
        const blocked = this.ui.modalOpen || this.ui.dialogOpen || this.ui.mapOpen || this.ui.gameOpen || this.photoOn;
        if (!blocked) {
            for (const it of this.interactables) {
                if (!it.cond()) continue;
                const p = it.pos();
                const d = p.distanceTo(P_.pos);
                if (d < it.r && d < bd) {
                    bd = d;
                    best = it;
                }
            }
        }
        this._near = best;
        // holding E (dig)
        if (best && best.hold && this.keys.e) {
            if (!this._holdAct || this._holdAct.it !== best) this._holdAct = { it: best, t: 0 };
            this._holdAct.t += dt;
            P_.action = best.action || null;
            P_.actionT = 0.2;
            if (this.audio && Math.floor(this._holdAct.t * 4) !== Math.floor((this._holdAct.t - dt) * 4)) this.audio.dig();
            if (this._holdAct.t >= best.hold) {
                const act = best.act;
                this._holdAct = null;
                act();
            }
            this.ui.setPrompt(best.label(), this._holdAct ? this._holdAct.t / best.hold : 0);
        } else {
            this._holdAct = null;
            this.ui.setPrompt(best ? best.label() : (this.photoOn ? null : null));
        }
        this._prevPlayerPos = (this._prevPlayerPos || new THREE.Vector3()).copy(this._frameStart || P_.pos);
        // the trench relic and depth achievement
        if (P_.pos.y < this.refs.trench.bottomY + 4 && Math.hypot(P_.pos.x - TRENCH.x, P_.pos.z - TRENCH.z) < 30 && !S.has('trenchTouched')) {
            S.set('trenchTouched');
            this.ui.toast('🌊 You are at the very bottom of the Deep Trench...');
        }
        this._frameStart = P_.pos.clone();
    };

    P._interact = function () {
        if (this.mode !== 'explore' || this.ui.modalOpen || this.ui.dialogOpen || this.ui.mapOpen) return;
        if (this.photoOn) {
            this._shutter();
            return;
        }
        const it = this._near;
        if (!it || it.hold) return;
        this._holdAct = null;
        it.act();
    };

    // ---------------------------------------------------------------------------------------------
    // HUD
    // ---------------------------------------------------------------------------------------------
    P._updateHud = function () {
        const S = this.S, P_ = this.player;
        const hours = (S.tod * 24 + 6) % 24;
        const hh = Math.floor(hours), mm = Math.floor((hours - hh) * 60 / 10) * 10;
        const clock = `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}`;
        this.ui.setStats({ money: S.money, pearls: S.pearls.size, pearlTotal: PEARL_COUNT, depth: SURFACE_Y - P_.pos.y, clock, night: this.env.nightness > 0.5 });
        const markers = this._objectiveMarkers();
        const yaw = this.camYaw;
        const compass = markers.map((m) => ({ bearing: Math.atan2(m.pos.x - P_.pos.x, m.pos.z - P_.pos.z), icon: '◆', color: '#ffeaa7' }));
        for (const a of AREAS) if (S.places.has(a.id) && a.landmark) compass.push({ bearing: Math.atan2(a.at[0] - P_.pos.x, a.at[1] - P_.pos.z), icon: '·', color: '#9fe8ff' });
        this.ui.drawCompass(yaw + Math.PI, compass);
        const dots = [];
        for (const a of AREAS) dots.push({ x: a.at[0], z: a.at[1], color: S.places.has(a.id) ? '#9fe8ff' : '#6a8cae', big: a.landmark });
        for (const m of markers) dots.push({ x: m.pos.x, z: m.pos.z, icon: '⭐', big: true });
        this.ui.drawMinimap(P_.pos, yaw + Math.PI, dots);
        // 3D beacon over the nearest objective
        this._updateBeacon(markers);
    };

    P._updateBeacon = function (markers) {
        if (!this.beacon) {
            const s = glowSprite(0xffeaa7, 4, 0.9);
            s.renderOrder = 9;
            s.material.depthTest = false;
            this.scene.add(s);
            this.beacon = s;
        }
        const P_ = this.player;
        let best = null, bd = 1e9;
        for (const m of markers) {
            const d = m.pos.distanceTo(P_.pos);
            if (d < bd) { bd = d; best = m; }
        }
        const show = best && bd > 14 && this.mode === 'explore' && !this.photoOn;
        this.beacon.visible = !!show;
        if (show) {
            this.beacon.position.copy(best.pos);
            this.beacon.position.y += 3;
            this.beacon.scale.setScalar(clamp(bd * 0.05, 3, 14));
        }
    };

    // ---------------------------------------------------------------------------------------------
    // Map and fast travel
    // ---------------------------------------------------------------------------------------------
    P._buildMapTerrain = function () {
        const N = 220;
        const cv = document.createElement('canvas');
        cv.width = cv.height = N;
        const g = cv.getContext('2d');
        const img = g.createImageData(N, N);
        const half = WORLD_R + 20;
        const c = new THREE.Color(), c2 = new THREE.Color();
        for (let j = 0; j < N; j++) {
            for (let i = 0; i < N; i++) {
                const x = (i / N) * half * 2 - half, z = (j / N) * half * 2 - half;
                const r = Math.hypot(x, z);
                const h = floorHeight(x, z);
                const b = biome(x, z);
                // a gentle chart: shallow turquoise to deep navy, with soft tints for the biomes
                c.setHex(0x3fb0c8).lerp(c2.setHex(0x16527e), clamp((r / WORLD_R) * 0.6 + clamp(-h / 40, 0, 1) * 0.5, 0, 1));
                c.lerp(c2.setHex(0x6fc28a), b.kelp * 0.3);
                c.lerp(c2.setHex(0xf2a6c0), b.reef * 0.22);
                c.lerp(c2.setHex(0x9a9aa8), b.rock * 0.22);
                c.lerp(c2.setHex(0x061a33), b.deep * 0.7);
                if (r > WORLD_R) c.lerp(c2.setHex(0x061424), 0.8);
                const k = (j * N + i) * 4;
                img.data[k] = c.r * 255; img.data[k + 1] = c.g * 255; img.data[k + 2] = c.b * 255; img.data[k + 3] = 255;
            }
        }
        g.putImageData(img, 0, 0);
        this.mapTerrain = cv;
    };

    P._openMap = function () {
        if (this.mode !== 'explore') return;
        this._freeMouse();
        const S = this.S;
        const icons = { plaza: '⛲', vanity: '🪞', chapel: '💒', mall: '🛍️', arcade: '🕹️', garden: '🌱', petnook: '🐾', ship: '🚢', clam: '🦪', kelp: '🌿', whale: '🦴', lagoon: '🏁', temple: '🏛️', caves: '🔮', grotto: '🎵', trench: '🕳️' };
        const places = AREAS.map((a) => ({ id: a.id, name: a.name, x: a.at[0], z: a.at[1], known: S.places.has(a.id) || !a.landmark, icon: icons[a.id] || '📍' }));
        const markers = this._objectiveMarkers().map((m) => ({ x: m.pos.x, z: m.pos.z, icon: '⭐' }));
        this.ui.openMap({ terrain: this.mapTerrain, player: { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw }, places, markers }, (id) => this._travel(id), WORLD_R);
    };

    P.arrivePos = function (id) {
        const R = this.refs;
        const a = areaById(id);
        const g = floorHeight;
        if (id === 'lagoon') return R.lagoon.start.clone().add(V3(-6, 0, 0));
        if (id === 'caves') return R.caves.entrance.clone().add(V3(Math.sin(R.caves.entAz) * 8, 1, Math.cos(R.caves.entAz) * 8));
        if (id === 'vanity') return V3(a.at[0], g(a.at[0], a.at[1] + 14) + 3.5, a.at[1] + 14);
        const len = Math.hypot(a.at[0], a.at[1]) || 1;
        const k = Math.max(a.r * 0.8, 8);
        const x = a.at[0] - (a.at[0] / len) * k, z = a.at[1] - (a.at[1] / len) * k;
        return V3(x, Math.max(g(x, z) + 4, 3), z);
    };

    P._travel = async function (id) {
        if (this.mode !== 'explore') return;
        this.mode = 'cutscene';
        this.cut = null;
        await this.ui.fade(1, 450, '#06304a');
        const p = this.arrivePos(id);
        const a = areaById(id);
        this._placePlayer(p, Math.atan2(a.at[0] - p.x, a.at[1] - p.z));
        this.camYaw = this.player.yaw;
        this.camera.position.copy(p).add(V3(-Math.sin(this.camYaw) * 5, 1, -Math.cos(this.camYaw) * 5));
        this.mode = 'explore';
        await this.ui.fade(0, 600, '#06304a');
    };

    // ---------------------------------------------------------------------------------------------
    // Journal and pause
    // ---------------------------------------------------------------------------------------------
    P._openJournal = function () {
        if (this.mode !== 'explore') return;
        this._freeMouse();
        const S = this.S;
        const st = questStatus(S);
        const quests = st.filter((s) => s.available).map((s) => ({
            id: s.q.id, title: s.q.title, desc: s.q.desc, done: s.done, side: !!s.q.side, tracked: S.tracked.has(s.q.id),
            sub: s.steps.map((x) => ({ text: x.step.text, done: x.done }))
        }));
        // quests still locked: a teaser
        for (const s of st) if (!s.available) quests.push({ id: s.q.id, title: s.q.title + ' 🔒', desc: s.q.lockedHint || 'Not available yet.', done: false, side: !!s.q.side, tracked: false, sub: [] });
        // the treasure riddles
        const treasureQ = quests.find((q) => q.id === 'treasure');
        if (treasureQ && S.has('hasMap')) TREASURES.forEach((t, i) => treasureQ.sub.push({ text: `Riddle ${i + 1}: ${t.clue}`, done: S.treasures.has(t.id) }));
        const album = PHOTO_TARGETS.filter((p) => S.album.has(p.id)).map((p) => ({ id: p.id, name: p.name, img: (this.albumImgs || {})[p.id] }));
        this.ui.openJournal({
            quests, achievements: S.achievements, album, stats: {
                pearls: S.pearls.size, pearlTotal: PEARL_COUNT, shells: S.shells.size, shellTotal: SHELL_COUNT, places: LANDMARKS.filter((l) => S.places.has(l.id)).length, placeTotal: LANDMARKS.length,
                fish: S.fishTalked.size, fishTotal: TALKING_FISH.length, photos: S.album.size, photoTotal: PHOTO_TARGETS.length, treasures: S.treasures.size, treasureTotal: TREASURES.length,
                plants: S.plants.length, plantTotal: GARDEN.plots.length
            }
        }, (id) => { if (S.tracked.has(id)) S.tracked.delete(id); else { if (S.tracked.size >= 2) S.tracked.delete([...S.tracked][0]); S.tracked.add(id); } this.refreshQuests(true); }, () => this._renderTracker());
    };

    P._openPause = function () {
        if (this.mode !== 'explore') return;
        this._freeMouse();
        const ui = this.ui;
        ui.openMenu('⏸ Paused', 'Your dream is saved automatically.', [
            ['▶ Resume', () => ui.closeModal()],
            ['📖 Journal', () => { ui.closeModal(); this._openJournal(); }],
            ['🗺️ Map', () => { ui.closeModal(); this._openMap(); }],
            ['🪞 Dressing Shell (wardrobe)', () => { ui.closeModal(); const p = this.player.pos.clone(); this._openCreator(false, p); }],
            ['⚙ Settings', () => this._openSettings()],
            ['🌅 Wake up (end the trip)', () => { ui.closeModal(); this.wakeUp(); }, 'danger'],
            ['🗑 New dream (reset progress)', async () => {
                ui.closeModal();
                const i = await this.choice('Reset?', 'Start a brand new dream? Your quests, money and collectibles are erased (your mermaid stays).', ['Yes, start over', 'No']);
                if (i === 0) { this.S.wipe(); this._resetPlay(); this._startExplore(false); this.refreshQuests(true); this.ui.toast('A fresh dream begins.'); }
            }, 'danger']
        ]);
    };

    P._openSettings = function () {
        const S = this.S;
        this.ui.openSettings(S.settings, (key, v) => {
            S.settings[key] = v;
            if (key === 'music' && this.audio) this.audio.setMusicLevel(v);
            if (key === 'shadows' && this.env.sun) { this.env.sun.castShadow = !!v && this.shadowsOn; }
            S.save();
        }, () => this._openPause());
    };
}
