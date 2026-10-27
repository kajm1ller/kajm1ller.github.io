/**
 * js/game/mermaid/mermaidWorld.js
 *
 * Mermaid World: where an LSD trip takes you. A big underwater world with its own scene, camera,
 * controls, music and UI; the real game is paused while you're here.
 *
 * You make a mermaid (and can change her any time at the Dressing Shell), then live a dream: a
 * wedding to plan, a day at the mall with your friends, a photo safari, a ring race, treasure to dig
 * up, a garden to grow, pets, a concert, a trench to dive... and the main story: the Moon Pearl that
 * lights the town has been stolen. Progress is saved between trips. Wake up whenever you like (Esc).
 *
 * This file is the core (lifecycle, input, player, camera, frame loop, quest glue). The rest is
 * installed from:
 *   mermaidWorldNpc.js    characters, creatures, dialogue, friends, pets
 *   mermaidWorldPlay.js   collectibles, ring run, photos, treasure, garden, shops, minigames, map, menus
 *   mermaidCutscenes.js   the wedding, the Moon Pearl festival and the ending
 *
 * Controls: WASD swim (where the camera looks), mouse look (click to grab the mouse), Space up,
 * C down, Shift to sprint, E interact (hold to dig), F camera, J journal, M map, Esc menu.
 */

import * as THREE from 'three';
import { buildMermaid, animateMermaid } from './mermaidModel.js';
import { MermaidUI } from './mermaidUI.js';
import { MermaidAudio } from './mermaidAudio.js';
import { Environment, floorHeight, CAVE, TRENCH } from './mermaidEnv.js';
import { makeContext, buildTown, buildVanity, buildChapel, buildMall, buildArcade, buildGarden, buildPetNook, finishLamps } from './mermaidTown.js';
import { buildShip, buildClam, buildWhaleSkeleton, buildKelpMarker, buildLagoon, buildTemple, buildCaves, buildGrotto, buildTrench } from './mermaidWild.js';
import { DreamState, settleQuests, questStatus, mainComplete, QUESTS } from './mermaidState.js';
import {
    defaultLook, normalizeLook, WORLD_R, SURFACE_Y, AREAS, areaById, LANDMARKS, ITEMS, START_MONEY
} from './mermaidData.js';
import { TWO_PI, between, pick, clamp, lerp, smooth, std, angleDiff, SWAY } from './mermaidKit.js';
import { installNpc } from './mermaidWorldNpc.js';
import { installPlay } from './mermaidWorldPlay.js';
import { installCutscenes } from './mermaidCutscenes.js';

const rand = Math.random;

export class MermaidWorld {
    /**
     * @param {Object} o
     * @param {THREE.WebGLRenderer} o.renderer
     * @param {() => AudioContext|null} o.getAudioContext
     * @param {() => void} o.onExit called once the trip is over (after the fade to white)
     */
    constructor({ renderer, getAudioContext, onExit }) {
        this.renderer = renderer;
        this.getAudioContext = getAudioContext;
        this.onExit = onExit;
        this.ui = new MermaidUI();
        this.S = new DreamState();
        this.active = false;
        this.built = false;
        this.time = 0;
        this.keys = {};
        this.mode = 'idle';
        this.camYaw = Math.PI;
        this.camPitch = -0.15;
        this.camDist = 5.4;
        this.fov = 65;
        this._v = new THREE.Vector3();
        this._w = new THREE.Vector3();
        this._hudT = 0;
        this._todT = 0;
        this._saveT = 0;
        this.game = null;
        this.cut = null;
        this.vel = new THREE.Vector3();
        this.params = new URLSearchParams((typeof location !== 'undefined' && location.search) || '');
    }

    get look() {
        return this.S.look;
    }

    // ---------------------------------------------------------------------------------------------
    // Entering / leaving
    // ---------------------------------------------------------------------------------------------
    /** Starts the trip (the screen should already be black). */
    async enter() {
        if (this.active) return;
        try {
            this.S.load();
            this.ui._build();
            if (!this.built) this._build();
            this._resetTrip();
        } catch (err) {
            // Never strand the player in a half-built world: the trip just ends
            console.error('[MermaidWorld] could not start the trip:', err);
            this.built = false;
            if (this.onExit) this.onExit();
            return;
        }
        this.active = true;
        this._bindInput();
        this._freeMouse();
        this.ui.show();
        this.ui.fade(1, 0);
        this.ui.showHud(false);
        const ctx = this.getAudioContext && this.getAudioContext();
        if (ctx && !this.audio) {
            try { this.audio = new MermaidAudio(ctx); } catch (e) { this.audio = null; }
        }
        if (this.audio) {
            this.audio.setMusicLevel(this.S.settings.music);
            this.audio.fadeTo(0.9, 3);
        }
        this.env.setTime(this.S.tod);
        if (!this.S.look) {
            this.S.look = defaultLook();
            this._rebuildPlayer(this.S.look);
            this._openCreator(true);
        } else {
            this._rebuildPlayer(this.S.look);
            this._startExplore(false);
        }
        await this.ui.fade(0, 2200);
        this.ui.caption(this.S.look && this.S.has('metSage') ? '~ Welcome back to Mermaid World ~' : '~ Mermaid World ~', 3500);
    }

    async _end() {
        // The Moon Pearl festival is done: the player chooses to wake up or stay
        if (this.mode === 'ending') return;
        this.mode = 'explore';
        const i = await this.choice('Old Sage', 'The reef is safe, the pearl is home, and the current is ready to carry you back to the bright world whenever you wish. Or you can stay: there is still treasure to dig, songs to play and a whole sea to see.', ['Wake up now', 'Stay a while']);
        if (i === 0) this.wakeUp();
        else this.ui.toast('Stay as long as you like. Esc > Wake up when you are ready.');
    }

    /** The current carries you home. */
    async wakeUp() {
        if (this.mode === 'ending') return;
        this.mode = 'ending';
        this.ui.setPrompt(null);
        this.ui.closeModal();
        this.ui.closeMap();
        this._freeMouse();
        this.S.pos = [this.player.pos.x, this.player.pos.y, this.player.pos.z, this.player.yaw];
        this.S.save();
        this.ui.caption('The current is pulling you home...', 4500);
        if (this.audio) this.audio.chime();
        await new Promise((r) => setTimeout(r, 3500));
        await this.ui.fade(1, 2500, '#ffffff');
        this._exit();
    }

    _exit() {
        this.active = false;
        this._unbindInput();
        if (this.audio) {
            this.audio.stop();
            this.audio = null;
        }
        this._freeMouse();
        this.ui.fade(0, 0);
        this.ui.hide();
        this.S.save();
        if (this.onExit) this.onExit();
    }

    /** Debug: finish the whole story. */
    finishAll() {
        const S = this.S;
        for (const q of QUESTS) {
            if (!q.main) continue;
            for (const st of q.steps) this._forceStep(q.id, st.id);
            S.set('done_' + q.id);
        }
        S.set('weddingDone');
        S.set('pearlReturned');
        S.ended = true;
        this.refreshQuests(true);
        // (the old trip ended the moment its tasks were done: keep that for QA)
        if (this.active && this.mode !== 'ending') this.wakeUp();
    }

    _forceStep(qid, sid) {
        const S = this.S;
        const set = {
            rings: () => S.counts.trainingRings = 4, sage: () => S.set('metSage'), plan: () => S.set('planned'), flowers: () => S.counts.flower = 8,
            invites: () => ['Octavia', 'Gary', 'Crabs', 'Grandma'].forEach((n) => S.set('invite' + n)), ceremony: () => S.set('weddingDone'),
            invite: () => S.set('friendsFollow'), self: () => S.set('boughtSelf'), gifts: () => ['coral', 'nerissa', 'ondine'].forEach((f) => S.gifted.add(f)),
            eat: () => S.set('ate'), arcade: () => S.counts.ticketsEarned = 10, selfie: () => S.set('selfie'),
            photos: () => ['turtle', 'manta', 'dolphin', 'jelly', 'octopus', 'shark'].forEach((p) => S.album.add(p)), run: () => S.ringBest = 80,
            clues: () => ['clueBubbles', 'clueGlenda', 'clueLuna'].forEach((f) => S.set(f)), temple: () => S.set('vaultOpen'), orbs: () => S.counts.glowOrb = 5,
            battle: () => S.set('geraldBeaten'), return: () => S.set('pearlReturned')
        }[sid];
        if (set) set();
    }

    _resetTrip() {
        const S = this.S;
        this.cut = null;
        this.game = null;
        this.vel.set(0, 0, 0);
        this.camYaw = Math.PI;
        this.camPitch = -0.15;
        this.camDist = 5.4;
        this.fov = 65;
        this.mode = 'idle';
        if (this.params.get('time')) S.tod = parseFloat(this.params.get('time'));
        this._resetPlay && this._resetPlay();
    }

    // ---------------------------------------------------------------------------------------------
    // Input (captured before the game's own handlers, which never see it)
    // ---------------------------------------------------------------------------------------------
    _bindInput() {
        const canvas = this.renderer.domElement;
        const inUI = (e) => e.target && e.target.closest && e.target.closest('#mermaid-ui');
        this._h = {
            keydown: (e) => {
                e.stopImmediatePropagation();
                if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
                const k = e.key.toLowerCase();
                if (k === 'tab' || k === ' ' || k.startsWith('arrow')) e.preventDefault();
                this._onKeyDown(e, k);
            },
            keyup: (e) => {
                e.stopImmediatePropagation();
                this.keys[e.key.toLowerCase()] = false;
            },
            mousedown: (e) => {
                e.stopImmediatePropagation();
                if (inUI(e)) return;
                if (this.mode === 'creator' && e.target === canvas) this._drag = e.clientX;
                else if (e.button === 0 && this.mode === 'explore' && this.photoOn && !this.ui.modalOpen) this._shutter();
            },
            mouseup: (e) => {
                e.stopImmediatePropagation();
                this._drag = null;
            },
            mousemove: (e) => {
                e.stopImmediatePropagation();
                if (this.mode === 'creator' && this._drag != null) {
                    this.creatorYaw += (e.clientX - this._drag) * 0.01;
                    this._drag = e.clientX;
                } else if (document.pointerLockElement === canvas && this.mode === 'explore' && !this.ui.modalOpen && !this.ui.mapOpen) {
                    const s = (this.S.settings.sens || 1) * (this.photoOn ? this.fov / 65 : 1);
                    this.camYaw -= e.movementX * 0.0026 * s;
                    this.camPitch = clamp(this.camPitch - e.movementY * 0.0022 * s * (this.S.settings.invertY ? -1 : 1), -1.3, 1.2);
                }
            },
            click: (e) => {
                // Clicking the world grabs the mouse for swimming, but not while a menu is up
                const free = this.mode === 'explore' && !this.ui.modalOpen && !this.ui.dialogOpen && !this.ui.mapOpen && !this.ui.gameOpen;
                if (!inUI(e) && !free) e.stopImmediatePropagation();
                if (this.ui.dialogOpen && !inUI(e)) this.ui.advance();
                if (free && !inUI(e) && document.pointerLockElement !== canvas) {
                    try { canvas.requestPointerLock(); } catch (err) { /* headless / denied */ }
                }
            },
            wheel: (e) => {
                e.stopImmediatePropagation();
                if (inUI(e)) return;
                if (this.photoOn) this.fov = clamp(this.fov + e.deltaY * 0.03, 18, 70);
                else if (this.mode === 'explore') this.camDist = clamp(this.camDist + e.deltaY * 0.006, 2.4, 13);
            },
            contextmenu: (e) => {
                e.stopImmediatePropagation();
                e.preventDefault();
            }
        };
        for (const [k, fn] of Object.entries(this._h)) window.addEventListener(k, fn, { capture: true, passive: !['wheel', 'contextmenu', 'keydown'].includes(k) });
    }

    _unbindInput() {
        if (!this._h) return;
        for (const [k, fn] of Object.entries(this._h)) window.removeEventListener(k, fn, { capture: true });
        this._h = null;
        this.keys = {};
    }

    _freeMouse() {
        try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* ignore */ }
    }

    _onKeyDown(e, k) {
        if (this.game) {
            this.game.onKey(e);
            return;
        }
        this.keys[k] = true;
        if (e.repeat) return;
        const ui = this.ui;
        if (k === 'escape') {
            if (ui.dialogOpen && !ui.choiceResolve) { ui.advance(); return; }
            if (ui.mapOpen) { ui.closeMap(); return; }
            if (ui.modalOpen) { ui.closeModal(); this._menuClosed && this._menuClosed(); return; }
            if (this.photoOn) { this._setPhoto(false); return; }
            if (this.mode === 'cutscene' && this.cut) this.cut.t = this.cut.dur;   // skip to the end
            else if (this.mode === 'explore') this._openPause();
            return;
        }
        if (this.mode === 'creator') return;
        if (k === ' ' && this.photoOn && this.mode === 'explore' && !ui.modalOpen) { this._shutter(); return; }
        if (k === 'e' || k === 'enter') {
            if (ui.dialogOpen) ui.advance();
            else this._interact();
            return;
        }
        if (this.mode !== 'explore') return;
        if (ui.modalOpen) return;
        if (k === 'j') this._openJournal();
        else if (k === 'm') (ui.mapOpen ? ui.closeMap() : this._openMap());
        else if (k === 'f') this._setPhoto(!this.photoOn);
        else if (k === 'h') ui.toggleHelp();
        else if (k === 'g') this._emote('dance');
        else if (k === 'b') this._emote('wave');
        else if (k === 'p') this._openPause();
    }

    _emote(a) {
        if (this.mode !== 'explore' || this.ui.modalOpen) return;
        this.player.action = a;
        this.player.actionT = a === 'dance' ? 4 : 2;
    }

    // ---------------------------------------------------------------------------------------------
    // Building the world
    // ---------------------------------------------------------------------------------------------
    _build() {
        this.built = true;
        const scene = this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(this.fov, 16 / 9, 0.15, 1600);
        this.quality = this.params.get('mwlite') || this.renderer.getPixelRatio() < 0.7 ? 'low' : 'high';
        const shadows = !!this.renderer.shadowMap.enabled && this.quality !== 'low' && this.S.settings.shadows;
        this.env = new Environment(scene, this.renderer, { quality: this.quality, shadows });
        this.shadowsOn = shadows;
        const ctx = this.ctx = makeContext(scene, this.env, { shadows });
        this.refs = ctx.refs;
        this.player = { m: null, pos: new THREE.Vector3(), yaw: 0, swim: 0, action: null, actionT: 0 };

        const buildStatue = () => {
            const st = buildMermaid(normalizeLook({ male: true, hairStyle: 'long', headAcc: 'crown', ears: 'round', tailSize: 1.2, tailPattern: 'plain', finStyle: 'classic', earAcc: 'none', trident: true, top: 'none', neckAcc: 'none', armAcc: 'none', bottom: 'none', cape: 'none', aura: 'none' }));
            const stone = std(0xcfc8b8, { roughness: 0.85 });
            st.root.traverse((o) => {
                if (!o.isMesh) return;
                if (o.userData.face) { o.visible = false; return; }
                if (o.material.map && o.material.transparent) {
                    const m = o.material.clone();
                    m.color.setHex(0xcfc8b8);
                    m.emissive.setHex(0x000000);
                    o.material = m;
                } else o.material = stone;
            });
            st.arms[1].sh.rotation.set(-2.6, 0, 0.2);
            return st;
        };
        buildTown(ctx, buildStatue);
        buildVanity(ctx);
        buildChapel(ctx);
        buildMall(ctx, (shop, pos, yaw) => this._spawnKeeper(shop, pos, yaw));
        buildArcade(ctx);
        buildGarden(ctx);
        buildPetNook(ctx);
        buildShip(ctx);
        buildClam(ctx);
        buildWhaleSkeleton(ctx);
        buildKelpMarker(ctx);
        buildLagoon(ctx);
        buildTemple(ctx);
        buildCaves(ctx);
        buildGrotto(ctx);
        buildTrench(ctx);
        finishLamps(ctx);
        this.areaLights = new THREE.PointLight(0x9fe8ff, 0, 26, 1.6);
        scene.add(this.areaLights);
        this._buildNpcs();
        this._buildRoamers();
        this._buildSchools();
        this._buildCollectibles();
        this._buildInteractables();
        this._buildMoonPearlSocket();
        this._buildMapTerrain();
        this._buildPlayer();
        this._initBloom();
    }

    async _initBloom() {
        if (this.quality === 'low' || this.params.get('nobloom')) return;
        try {
            const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
                import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'),
                import('three/addons/postprocessing/UnrealBloomPass.js'), import('three/addons/postprocessing/OutputPass.js')
            ]);
            const size = this.renderer.getSize(new THREE.Vector2());
            const composer = new EffectComposer(this.renderer);
            composer.setPixelRatio(this.renderer.getPixelRatio());
            composer.setSize(size.x, size.y);
            composer.addPass(new RenderPass(this.scene, this.camera));
            this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.5, 0.65, 0.88);
            composer.addPass(this.bloom);
            composer.addPass(new OutputPass());
            this.composer = composer;
        } catch (e) {
            console.warn('[MermaidWorld] no bloom:', e.message);
            this.composer = null;
        }
    }

    _buildPlayer() {
        this._rebuildPlayer(this.S.look || defaultLook());
    }

    _rebuildPlayer(look) {
        const p = this.player;
        const pos = p.m ? p.m.root.position.clone() : new THREE.Vector3();
        const rot = p.m ? p.m.root.rotation.clone() : new THREE.Euler();
        if (p.m) this.scene.remove(p.m.root);
        p.m = buildMermaid(look);
        p.m.root.rotation.order = 'YXZ';
        p.m.root.position.copy(pos);
        p.m.root.rotation.copy(rot);
        this.scene.add(p.m.root);
        if (this.shadowsOn) p.m.root.traverse((o) => { if (o.isMesh && !o.material.transparent) o.castShadow = true; });
    }

    _placePlayer(pos, yaw) {
        this.player.pos.copy(pos);
        this.player.yaw = yaw;
        this.player.m.root.position.copy(pos);
        this.player.m.root.rotation.set(0, yaw, 0, 'YXZ');
        this.vel.set(0, 0, 0);
    }

    // ---------------------------------------------------------------------------------------------
    // The creator and the explore mode
    // ---------------------------------------------------------------------------------------------
    _openCreator(first, returnTo = null) {
        this.mode = 'creator';
        this._returnTo = returnTo;
        this.creatorYaw = 0;
        this.creatorCam = 'full';
        this._snapCam = true;
        this._freeMouse();
        this.ui.setPrompt(null);
        this.ui.showHud(false);
        const V = this.refs.vanity.pos;
        this._placePlayer(V.clone(), 0);
        this.player.action = null;
        const look = this.S.look;
        this.ui.openCreator(look, this.S.owned, {
            title: first ? '🧜‍♀️ Create Your Mermaid' : '🪞 The Dressing Shell',
            confirm: first ? 'Dive In! 🌊' : 'Looks great!',
            saved: this.S.saved,
            onSave: (i, l) => { this.S.saved[i] = l; this.S.save(); },
            onChange: (l) => { this._rebuildPlayer(l); this.player.m.root.position.copy(V); this.player.m.root.rotation.set(0, this.creatorYaw, 0, 'YXZ'); this._creatorPoseT = 1.2; },
            onCamera: (m) => { this.creatorCam = m; },
            onDone: (l) => { this.S.look = l; this._startExplore(first); }
        });
    }

    _startExplore(first) {
        const S = this.S;
        this.mode = 'explore';
        this.ui.closeCreator();
        this.ui.showHud(true);
        this._rebuildPlayer(S.look);
        if (this._returnTo) {
            this._placePlayer(this._returnTo.clone(), this.player.yaw);
            this._returnTo = null;
        } else if (!first && S.pos && !this.player.placed) {
            this._placePlayer(new THREE.Vector3(S.pos[0], S.pos[1], S.pos[2]), S.pos[3] || 0);
            this.player.placed = true;
        } else if (!this.player.placed || first) {
            const V = this.refs.vanity.pos;
            this._placePlayer(new THREE.Vector3(V.x, V.y + 0.5, V.z + 9), Math.PI);
            this.player.placed = true;
        }
        this.camYaw = this.player.yaw;
        this.camPitch = -0.12;
        S.save();
        this.refreshQuests(true);
        if (first) this.ui.caption(`Welcome, ${S.look.name}!\nClick to grab the mouse, then swim with WASD.`, 5500);
        if (this.audio) this.audio.chime();
        this._syncEnvToState();
        this._afterLookChange && this._afterLookChange();
    }

    _syncEnvToState() {
        this.env.setTime(this.S.tod);
    }

    // ---------------------------------------------------------------------------------------------
    // Quest glue
    // ---------------------------------------------------------------------------------------------
    get api() {
        return this._api || (this._api = {
            money: (n) => this.giveMoney(n),
            unlock: (id) => { this.S.owned.add(id); },
            toast: (t) => this.ui.toast(t, 4500),
            achieve: (id) => this.achieve(id),
            flag: (f) => this.S.set(f)
        });
    }

    giveMoney(n) {
        this.S.money += n;
        this.ui && this.ui.toast(`+${n} 🐚 sand dollars`);
        this._hudT = 0;
    }

    achieve(id) {
        const S = this.S;
        if (S.achievements.has(id)) return;
        S.achievements.add(id);
        this.ui.toast('🏆 Achievement unlocked!');
        if (this.audio) this.audio.success();
    }

    /** Re-checks every quest (call after anything that could advance one). */
    refreshQuests(silent = false) {
        const S = this.S;
        const finished = settleQuests(S, this.api);
        for (const id of finished) {
            const q = QUESTS.find((x) => x.id === id);
            if (q && !silent) {
                this.ui.caption(`★ ${q.title} complete! ★`, 4000);
                if (this.audio) this.audio.success();
            }
            S.tracked.delete(id);
            if (q && q.main) this._nextMainQuest(id);
        }
        if (finished.includes('moon') || (S.has('done_moon') && !S.ended)) { /* the festival cutscene sets ended */ }
        this._renderTracker();
        this._syncCollectibles && this._syncCollectibles();
        this._syncSocket && this._syncSocket();
        this._hudT = 0;
        S.save();
    }

    _nextMainQuest(doneId) {
        const S = this.S;
        for (const q of QUESTS) {
            if (!q.main || S.has('done_' + q.id) || !q.available(S)) continue;
            if (!S.tracked.has(q.id) && S.tracked.size < 2) S.tracked.add(q.id);
        }
    }

    _renderTracker() {
        const S = this.S;
        const rows = [];
        const st = questStatus(S);
        // auto-track the first available main quests if nothing is tracked
        let tracked = st.filter((s) => S.tracked.has(s.q.id) && s.available && !s.done);
        if (!tracked.length) {
            tracked = st.filter((s) => s.q.main && s.available && !s.done).slice(0, 1);
            tracked.forEach((s) => S.tracked.add(s.q.id));
        }
        for (const s of tracked.slice(0, 2)) rows.push({ title: s.q.title, done: false, sub: s.steps.map((x) => ({ text: x.step.text, done: x.done })) });
        if (!rows.length) rows.push({ title: mainComplete(S) ? 'The reef is safe. Explore as you like.' : 'Everything is calm.', done: true, sub: [] });
        this.ui.setTasks(rows);
        this._trackedStatus = tracked;
    }

    // ---------------------------------------------------------------------------------------------
    // Dialogue helpers (free the mouse while a conversation is up)
    // ---------------------------------------------------------------------------------------------
    async say(who, what) {
        this._freeMouse();
        await this.ui.say(who, what);
    }

    async conversation(who, lines) {
        this._freeMouse();
        for (const l of lines) await this.ui.say(who, l);
    }

    async choice(who, what, options) {
        this._freeMouse();
        return this.ui.choice(who, what, options);
    }

    toast(t) {
        this.ui.toast(t);
    }

    // ---------------------------------------------------------------------------------------------
    // Per frame
    // ---------------------------------------------------------------------------------------------
    /** Runs one frame (called instead of the game's own loop while the trip lasts). */
    frame(dt, noRender = false) {
        if (!this.active) return;
        dt = Math.min(0.05, dt);
        this.time += dt;
        const S = this.S;
        S.playTime += dt;
        const r = this.renderer;
        const w = r.domElement.clientWidth || window.innerWidth, h = r.domElement.clientHeight || window.innerHeight;
        if (Math.abs(this.camera.aspect - w / h) > 0.001) {
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
            if (this.composer) this.composer.setSize(w, h);
        }
        // The tide cycle: ten minutes from dawn to dawn
        this._todT -= dt;
        if (this.mode !== 'cutscene' || !this.cut || !this.cut.holdTime) S.tod = (S.tod + dt / 600) % 1;
        if (this._todT <= 0) {
            this._todT = 0.2;
            this.env.setTime(S.tod);
        }
        this._updateWorld(dt);
        if (this.mode === 'creator') this._updateCreator(dt);
        else if (this.mode === 'explore') this._updateExplore(dt);
        else if (this.mode === 'cutscene' && this.cut) {
            this.cut.t += dt;
            this.cut.update(this.cut.t, dt);
            if (this.cut.t >= this.cut.dur) {
                const c = this.cut;
                this.cut = null;
                c.done();
            }
        } else if (this.mode === 'ending') {
            this.camPitch += dt * 0.1;
            this._followCam(dt);
        }
        // Mermaid actions (dance / wave / ...) time out
        const P = this.player;
        if (P.actionT > 0) {
            P.actionT -= dt;
            if (P.actionT <= 0 && this.mode === 'explore') P.action = null;
        }
        animateMermaid(P.m, this.time, { swim: P.swim, action: P.action, dt });
        this.env.update(dt, this.camera.position, P.pos);
        this._updateCave(dt);
        if (this.audio) {
            this._updateMusicArea(dt);
            this.audio.update(dt);
        }
        this._hudT -= dt;
        if (this._hudT <= 0 && (this.mode === 'explore' || this.mode === 'cutscene')) {
            this._hudT = 0.12;
            this._updateHud();
        }
        this._saveT -= dt;
        if (this._saveT <= 0) {
            this._saveT = 20;
            if (this.mode === 'explore') S.pos = [this.player.pos.x, this.player.pos.y, this.player.pos.z, this.player.yaw];
            S.save();
        }
        if (this.debugCam) {
            this.camera.position.set(...this.debugCam.pos);
            this.camera.lookAt(...this.debugCam.look);
            if (this.debugCam.fov) { this.camera.fov = this.debugCam.fov; this.camera.updateProjectionMatrix(); }
        }
        if (noRender) return;
        if (Math.abs(this.camera.fov - this.fov) > 0.01 && (this.mode === 'explore' || this.mode === 'cutscene' || this.mode === 'creator')) {
            this.camera.fov += (this.fov - this.camera.fov) * Math.min(1, dt * 8);
            this.camera.updateProjectionMatrix();
        }
        this._render(dt);
        if (this._wantThumb) this._grabThumb();
    }

    _render(dt) {
        const r = this.renderer;
        const exposure = r.toneMappingExposure;
        r.toneMappingExposure = 1.0;
        if (this.composer) {
            if (this.bloom) this.bloom.strength = 0.08 + this.env.nightness * 0.5 + (this.S.settings.bloom ? 0.2 : -0.18);
            this.composer.render(dt);
        } else r.render(this.scene, this.camera);
        r.toneMappingExposure = exposure;
    }

    _updateWorld(dt) {
        const t = this.time;
        if (this.foodBoost > 0) this.foodBoost -= dt;
        if (this.glowT > 0) {
            this.glowT -= dt;
            if (Math.random() < dt * 6) this._sparkle(this.player.pos.clone().add(new THREE.Vector3(between(-0.8, 0.8), between(-0.4, 1), between(-0.8, 0.8))), 0xfff3b0);
        }
        for (const fn of this.ctx.anim) fn(t, dt, this.ctx);
        this._updateCreatures && this._updateCreatures(dt, t);
        this._updateCollectibles && this._updateCollectibles(dt, t);
        this._updateNpcs && this._updateNpcs(dt, t);
        this._updateFriends && this._updateFriends(dt);
        this._updatePet && this._updatePet(dt);
        this._updateBursts && this._updateBursts(dt);
        this._updateRun && this._updateRun(dt);
        this._updateGarden && this._updateGarden(dt);
        this._updateSocket && this._updateSocket(dt, t);
    }

    _updateCreator(dt) {
        const P = this.player;
        P.swim = 0;
        P.action = Math.sin(this.time * 0.6) > 0.85 ? 'wave' : (this._creatorPoseT > 0 ? 'talk' : null);
        if (this._creatorPoseT > 0) this._creatorPoseT -= dt;
        const V = this.refs.vanity.pos;
        P.m.root.position.copy(V);
        P.m.root.position.y += Math.sin(this.time * 1.1) * 0.05;
        P.m.root.rotation.set(0, this.creatorYaw + Math.sin(this.time * 0.4) * 0.15, 0, 'YXZ');
        const cam = this.creatorCam || 'full';
        const base = V;
        let from, to, fov = 50;
        if (cam === 'face') { from = [base.x - 0.25, base.y + 0.95, base.z + 1.9]; to = [base.x, base.y + 0.82, base.z]; fov = 34; }
        else if (cam === 'back') { from = [base.x, base.y + 0.3, base.z - 4.6]; to = [base.x, base.y - 0.2, base.z]; }
        else { from = [base.x - 0.8, base.y + 0.3, base.z + 3.7]; to = [base.x - 0.8, base.y - 0.25, base.z]; }
        const k = this._snapCam ? 1 : Math.min(1, dt * 4);
        this._snapCam = false;
        this.camera.position.lerp(this._v.set(...from), k);
        this._camTarget = (this._camTarget || new THREE.Vector3(...to)).lerp(this._w.set(...to), k);
        this.camera.lookAt(this._camTarget);
        this.fov = fov;
    }

    // ---- swimming ---------------------------------------------------------------------------------
    _swimInput() {
        const k = this.keys;
        const blocked = this.ui.modalOpen || this.ui.dialogOpen || this.ui.mapOpen || this.ui.gameOpen || this.mode !== 'explore';
        const out = this._w.set(0, 0, 0);
        if (blocked) return { want: out, sprint: 1 };
        const cy = Math.cos(this.camPitch);
        const fwd = new THREE.Vector3(Math.sin(this.camYaw) * cy, Math.sin(this.camPitch), Math.cos(this.camYaw) * cy);
        const right = new THREE.Vector3(-Math.cos(this.camYaw), 0, Math.sin(this.camYaw));
        if (k.w) out.add(fwd);
        if (k.s) out.sub(fwd);
        if (k.d) out.add(right);
        if (k.a) out.sub(right);
        if (k[' ']) out.y += 1;
        if (k.c || k.control) out.y -= 1;
        return { want: out, sprint: k.shift ? 2.4 : 1 };
    }

    _updateExplore(dt) {
        const P = this.player;
        const k = this.keys;
        const blocked = this.ui.modalOpen || this.ui.dialogOpen || this.ui.mapOpen || this.ui.gameOpen;
        // Arrow keys turn too (for when the mouse isn't grabbed)
        if (!blocked) {
            if (k.arrowleft) this.camYaw += dt * 1.8;
            if (k.arrowright) this.camYaw -= dt * 1.8;
            if (k.arrowup) this.camPitch = clamp(this.camPitch + dt * 1.2, -1.3, 1.2);
            if (k.arrowdown) this.camPitch = clamp(this.camPitch - dt * 1.2, -1.3, 1.2);
        }
        const { want, sprint } = this._swimInput();
        const holding = this._holdAct != null;
        const speedBase = (this.speedBoost > 0 || this.foodBoost > 0 ? 8.8 : 7) * (this.photoOn ? 0.5 : 1) * sprint * (holding ? 0 : 1);
        if (want.lengthSq() > 0) want.normalize().multiplyScalar(speedBase);
        this.vel.lerp(want, Math.min(1, dt * 2.6)); // water drag
        const prev = this._v.copy(P.pos);
        P.pos.addScaledVector(this.vel, dt);
        this._collide(prev, P.pos);
        const fy = floorHeight(P.pos.x, P.pos.z) + 1.7;
        if (P.pos.y < fy) { P.pos.y = fy; if (this.vel.y < 0) this.vel.y = 0; }
        P.pos.y = Math.min(P.pos.y, SURFACE_Y - 3);
        const rr = Math.hypot(P.pos.x, P.pos.z);
        if (rr > WORLD_R) { P.pos.x *= WORLD_R / rr; P.pos.z *= WORLD_R / rr; }
        // Body lies along the direction of travel
        const spd = this.vel.length();
        P.swim += (Math.min(1, spd / 8) - P.swim) * Math.min(1, dt * 3);
        if (spd > 0.3) {
            P.yaw += angleDiff(P.yaw, Math.atan2(this.vel.x, this.vel.z)) * Math.min(1, dt * 5);
            if (P.action && P.actionT > 0 && P.action !== 'photo') P.actionT = Math.min(P.actionT, 0.05);
        }
        const climb = Math.atan2(this.vel.y, Math.hypot(this.vel.x, this.vel.z) + 0.001);
        const lean = clamp(P.swim * (Math.PI / 2 - climb) * 0.85, -0.3, 1.5);
        P.m.root.position.copy(P.pos);
        P.m.root.rotation.set(lean, P.yaw, 0, 'YXZ');
        if (this.photoOn && P.swim < 0.2) P.m.root.rotation.y = this.camYaw;
        this._followCam(dt);
        this._exploreSystems(dt);
    }

    /** Pushes a position out of solid things; prev is where it was a moment ago. */
    _collide(prev, pos) {
        const R = 1.0;
        for (const c of this.ctx.colliders) {
            const dx = pos.x - c.x, dz = pos.z - c.z;
            const rr = c.r + R;
            const d2 = dx * dx + dz * dz;
            if (d2 < rr * rr && pos.y > c.y0 && pos.y < c.y1) {
                const d = Math.sqrt(d2) || 0.001;
                pos.x = c.x + (dx / d) * rr;
                pos.z = c.z + (dz / d) * rr;
                const vx = this.vel.x * dx + this.vel.z * dz;
                if (vx < 0) {
                    this.vel.x -= (dx / d) * (vx / d);
                    this.vel.z -= (dz / d) * (vx / d);
                }
            }
        }
        // The cave's rock shell: you can only go in and out through the doorway
        const C = this.refs.caves;
        if (C) {
            const f = (p) => {
                const dx = p.x - C.center.x, dz = p.z - C.center.z, dy = p.y - C.floorY;
                return (dx * dx + dz * dz) / (C.radius * C.radius) + (dy * dy) / (C.height * C.height) - 1;
            };
            const a = f(prev), b = f(pos);
            if ((a < 0) !== (b < 0) && Math.abs(b) < 0.5) {
                const az = Math.atan2(pos.x - C.center.x, pos.z - C.center.z);
                const inDoor = Math.abs(angleDiff(az, C.entAz)) < 0.27 && pos.y - C.floorY < C.height * 0.5;
                if (!inDoor) {
                    pos.copy(prev);
                    this.vel.multiplyScalar(0.2);
                }
            }
        }
    }

    _followCam(dt) {
        const P = this.player;
        const cy = Math.cos(this.camPitch);
        const fwd = this._w.set(Math.sin(this.camYaw) * cy, Math.sin(this.camPitch), Math.cos(this.camYaw) * cy);
        const target = this._v.copy(P.pos).add(new THREE.Vector3(0, 0.6, 0));
        const dist = this.photoOn ? 0.5 : this.camDist;
        const want = target.clone().addScaledVector(fwd, -dist);
        want.y = Math.max(want.y, floorHeight(want.x, want.z) + 0.8);
        want.y = Math.min(want.y, SURFACE_Y - 2);
        // Keep the camera outside the cave's rock when you are not in it
        const C = this.refs.caves;
        if (C && !this._insideCave) {
            const dx = want.x - C.center.x, dz = want.z - C.center.z;
            const az = Math.atan2(dx, dz);
            const f = (dx * dx + dz * dz) / (C.radius * C.radius) + ((want.y - C.floorY) ** 2) / (C.height * C.height);
            if (f < 1 && Math.abs(angleDiff(az, C.entAz)) > 0.3) want.copy(P.pos).addScaledVector(fwd, 0.2);
        }
        this.camera.position.lerp(want, Math.min(1, dt * 9));
        this.camera.lookAt(target.addScaledVector(fwd, 2));
    }

    // ---- the cave is dark ---------------------------------------------------------------------------
    _updateCave(dt) {
        const C = this.refs.caves;
        if (!C || !this.player) return;
        const P = this.player;
        const dx = P.pos.x - C.center.x, dz = P.pos.z - C.center.z;
        const f = (dx * dx + dz * dz) / (C.radius * C.radius) + ((P.pos.y - C.floorY) ** 2) / (C.height * C.height);
        const inside = f < 0.98 && P.pos.y - C.floorY > -3;
        this._insideCave = inside;
        const target = inside ? 1 : 0;
        this.caveK = (this.caveK || 0) + (target - (this.caveK || 0)) * Math.min(1, dt * 2.2);
        const k = this.caveK;
        this.env.applyCave(k);
        // Your own glow lights the way
        this.areaLights.position.copy(P.pos).add(this._w.set(0, 1.2, 0));
        this.areaLights.intensity = k * (4 + Math.sin(this.time * 2) * 0.4) * (1 + Math.min(1, this.S.count('glowOrb') / 5) * 0.8);
        this.areaLights.color.setHex(0x9fe8ff);
    }

    _updateMusicArea(dt) {
        if (this.mode === 'cutscene' || this.game) return;
        const P = this.player;
        let best = null, bd = 1e9;
        for (const a of AREAS) {
            const d = Math.hypot(P.pos.x - a.at[0], P.pos.z - a.at[1]);
            if (d < a.r * 1.2 && d < bd) {
                bd = d;
                best = a;
            }
        }
        const night = this.env.nightness > 0.6;
        let style = best ? best.theme : 'town';
        if (this._insideCave) style = 'cave';
        else if (P.pos.y < -18) style = 'deep';
        else if (!best) style = P.pos.y < 10 ? 'reef' : 'town';
        if (this.S.has('pearlReturned') && this.S.ended && style === 'town' && night) style = 'festival';
        if (this._area !== (best ? best.id : null)) {
            this._area = best ? best.id : null;
            if (best) this._enteredArea(best);
        }
        if (this._styleWant !== style) {
            this._styleWant = style;
            this._styleT = 0;
        }
        this._styleT = (this._styleT || 0) + dt;
        if (this._styleT > 1.2 && this.audio.styleName !== style) this.audio.setStyle(style);
    }

    _enteredArea(a) {
        const S = this.S;
        const first = !S.places.has(a.id);
        S.places.add(a.id);
        if (a.landmark && first) {
            this.ui.caption(`Discovered: ${a.name}!`, 3200);
            const n = LANDMARKS.filter((l) => S.places.has(l.id)).length;
            this.ui.toast(`📍 Landmark ${n}/${LANDMARKS.length}`);
            if (this.audio) this.audio.chime();
            this.refreshQuests();
        } else if (!a.landmark && first) this.ui.toast(`📍 ${a.name}`);
    }
}

installNpc(MermaidWorld);
installPlay(MermaidWorld);
installCutscenes(MermaidWorld);
