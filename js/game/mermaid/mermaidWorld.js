/**
 * js/game/mermaid/mermaidWorld.js
 *
 * Mermaid World: where an LSD trip takes you. An underwater town with its own scene, camera,
 * controls, music and UI; the real game is paused while you're here.
 *
 * Flow: fade in from black at the mermaid creator (hair, colours, skin, eyes, makeup, tail size and
 * colour, clothes). Then three tasks:
 *   1. Plan a mermaid wedding with Coralie the seahorse at the Coral Chapel (theme, your look, your
 *      partner, the cake, the music, the ceremony moments, the guests), then watch it happen.
 *   2. Take your mermaid friends to the Mermaid Mall: buy something to wear in the shops, then eat
 *      together at the food court.
 *   3. Swim around town: talk to four of the talking fish and find the four landmarks.
 * When all three are done the current carries you home (onExit).
 *
 * Controls: WASD swim (where the camera looks), mouse look (click to grab the mouse), Space up,
 * C down, Shift to sprint, E to interact / continue dialogue.
 */

import * as THREE from 'three';
import { buildMermaid, animateMermaid, buildFish, schoolFishGeometry, starGeometry } from './mermaidModel.js';
import { MermaidUI } from './mermaidUI.js';
import {
    defaultLook, randomLook, WEDDING, SHOPS, START_MONEY, TALKING_FISH, LANDMARKS, FRIEND_LINES
} from './mermaidData.js';

const TWO_PI = Math.PI * 2;
const rand = Math.random;
const between = (a, b) => a + rand() * (b - a);
const pick = (a) => a[Math.floor(rand() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angleDiff = (a, b) => {
    let d = (b - a) % TWO_PI;
    if (d > Math.PI) d -= TWO_PI;
    if (d < -Math.PI) d += TWO_PI;
    return d;
};

const FLOOR_Y = 0;
const SURFACE_Y = 62;
const WORLD_R = 230;
const CHAPEL = new THREE.Vector3(0, 0, -78);
const AISLE_START = new THREE.Vector3(0, 3.2, -36);
const ALTAR = new THREE.Vector3(0, 3.2, -57);
const MALL = new THREE.Vector3(84, 0, 10);
const FOOD_TABLE = new THREE.Vector3(60, 0, 30);
const VANITY = new THREE.Vector3(0, 5, 30);
const FRIENDS_AT = new THREE.Vector3(14, 4, 12);

function floorHeight(x, z) {
    return FLOOR_Y + Math.sin(x * 0.045) * 1.1 + Math.cos(z * 0.06) * 0.9 + Math.sin((x + z) * 0.11) * 0.35;
}

function canvasTexture(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

function signTexture(text, bg, fg = '#ffffff', w = 512, h = 128) {
    return canvasTexture(w, h, (g) => {
        const grd = g.createLinearGradient(0, 0, w, h);
        grd.addColorStop(0, bg);
        grd.addColorStop(1, '#ffffff33');
        g.fillStyle = grd;
        g.beginPath();
        g.roundRect(4, 4, w - 8, h - 8, 30);
        g.fill();
        g.strokeStyle = '#ffffffcc';
        g.lineWidth = 6;
        g.stroke();
        g.fillStyle = fg;
        g.font = `bold ${Math.floor(h * 0.48)}px "Trebuchet MS", sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.shadowColor = 'rgba(0,0,0,0.45)';
        g.shadowBlur = 8;
        g.fillText(text, w / 2, h / 2 + 2);
    });
}

const hexStr = (c) => '#' + c.toString(16).padStart(6, '0');

function std(color, o = {}) {
    return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.7, metalness: 0.05 }, o));
}
function mesh(geo, material, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    return m;
}

// ================================================================================================
// Music & ambience (procedural)
// ================================================================================================
class MermaidAudio {
    constructor(ctx) {
        this.ctx = ctx;
        this.out = ctx.createGain();
        this.out.gain.value = 0;
        this.out.connect(ctx.destination);
        this.music = ctx.createGain();
        this.music.gain.value = 0.55;
        this.music.connect(this.out);
        // Everything heard through water
        this.lp = ctx.createBiquadFilter();
        this.lp.type = 'lowpass';
        this.lp.frequency.value = 2600;
        this.lp.connect(this.music);
        const len = ctx.sampleRate * 3;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const ch = buf.getChannelData(0);
        let b = 0;
        for (let i = 0; i < len; i++) {
            b = 0.985 * b + 0.015 * (Math.random() * 2 - 1);
            ch[i] = b * 8;
        }
        this.noise = buf;
        const amb = ctx.createBufferSource();
        amb.buffer = buf;
        amb.loop = true;
        const af = ctx.createBiquadFilter();
        af.type = 'lowpass';
        af.frequency.value = 380;
        const ag = ctx.createGain();
        ag.gain.value = 0.22;
        amb.connect(af);
        af.connect(ag);
        ag.connect(this.out);
        amb.start();
        this.amb = amb;
        this.next = ctx.currentTime + 0.3;
        this.beat = 0;
        this.style = 'town';
        this.bubbleT = 1;
    }

    fadeTo(v, sec = 1.5) {
        this.out.gain.setTargetAtTime(v, this.ctx.currentTime, sec / 3);
    }

    _note(t, f, dur, g, type = 'sine', dest = this.lp, attack = 0.02) {
        const c = this.ctx;
        const o = c.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f, t);
        const e = c.createGain();
        e.gain.setValueAtTime(0.0001, t);
        e.gain.linearRampToValueAtTime(g, t + attack);
        e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(e);
        e.connect(dest);
        o.start(t);
        o.stop(t + dur + 0.05);
        return o;
    }

    _noiseHit(t, dur, freq, g, type = 'highpass') {
        const c = this.ctx;
        const s = c.createBufferSource();
        s.buffer = this.noise;
        const f = c.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        const e = c.createGain();
        e.gain.setValueAtTime(g, t);
        e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(f);
        f.connect(e);
        e.connect(this.lp);
        s.start(t, Math.random() * 2);
        s.stop(t + dur + 0.05);
    }

    bubble() {
        const t = this.ctx.currentTime;
        for (let i = 0; i < 4; i++) {
            const o = this._note(t + i * 0.06, 300 + Math.random() * 500, 0.08, 0.05, 'sine', this.out, 0.005);
            o.frequency.exponentialRampToValueAtTime(900 + Math.random() * 600, t + i * 0.06 + 0.08);
        }
    }

    chime() {
        const t = this.ctx.currentTime;
        [1046.5, 1318.5, 1568, 2093].forEach((f, i) => this._note(t + i * 0.09, f, 1.2, 0.08, 'sine', this.out, 0.005));
    }

    update(dt) {
        const c = this.ctx;
        const now = c.currentTime;
        this.bubbleT -= dt;
        if (this.bubbleT <= 0) {
            this.bubbleT = between(2, 6);
            this.bubble();
        }
        // Schedule music half a second ahead
        const spb = this.style === 'dj' || this.style === 'crabs' ? 60 / 116 : 60 / 76;
        // Dreamy I - vi - IV - V in C, an octave down for the pad
        const chords = [[261.6, 329.6, 392, 493.9], [220, 261.6, 329.6, 392], [174.6, 220, 261.6, 329.6], [196, 246.9, 293.7, 349.2]];
        while (this.next < now + 0.5) {
            const t = this.next;
            const bar = Math.floor(this.beat / 4) % 4;
            const ch = chords[bar];
            const st = this.style;
            if (st === 'town' || st === 'sirens') {
                if (this.beat % 4 === 0) {
                    for (const f of ch) this._note(t, f / 2, spb * 4.2, st === 'sirens' ? 0.05 : 0.035, st === 'sirens' ? 'triangle' : 'sine', this.lp, 0.6);
                }
                // Harp arpeggio
                const arp = [ch[0], ch[1], ch[2], ch[3], ch[2] * 2, ch[1] * 2, ch[2], ch[1]];
                this._note(t, arp[this.beat % 8] * 2, 1.4, 0.05, 'sine', this.lp, 0.005);
                this._note(t + spb / 2, arp[(this.beat + 4) % 8] * 2, 1.2, 0.035, 'sine', this.lp, 0.005);
                if (st === 'sirens' && this.beat % 2 === 0) this._note(t, ch[2] * 2, spb * 1.8, 0.04, 'triangle', this.lp, 0.2).frequency.setValueAtTime(ch[2] * 2, t);
            } else if (st === 'whales') {
                if (this.beat % 8 === 0) {
                    const o = this._note(t, 110, spb * 7, 0.12, 'sine', this.lp, 1.2);
                    o.frequency.linearRampToValueAtTime(180, t + spb * 3);
                    o.frequency.linearRampToValueAtTime(95, t + spb * 7);
                }
                if (this.beat % 4 === 2) for (const f of ch) this._note(t, f / 2, spb * 4, 0.025, 'sine', this.lp, 0.8);
            } else if (st === 'dj') {
                const k = this._note(t, 120, 0.25, 0.4, 'sine', this.lp, 0.003);
                k.frequency.exponentialRampToValueAtTime(45, t + 0.15);
                this._noiseHit(t + spb / 2, 0.05, 7000, 0.12);
                if (this.beat % 2 === 1) this._noiseHit(t, 0.12, 2500, 0.1, 'bandpass');
                this._note(t + spb / 2, ch[0] / 2, spb * 0.45, 0.12, 'sawtooth', this.lp, 0.01);
                if (this.beat % 8 === 6) {
                    const w = this._note(t, 1800, 0.35, 0.05, 'sine', this.lp, 0.01);
                    w.frequency.exponentialRampToValueAtTime(3400, t + 0.3);
                }
            } else if (st === 'crabs') {
                // Calypso steel drums
                const pent = [ch[0], ch[1], ch[2], ch[0] * 2, ch[1] * 2];
                const pattern = [1, 0, 1, 1, 0, 1, 0, 1];
                for (let s = 0; s < 2; s++) {
                    if (pattern[(this.beat * 2 + s) % 8]) {
                        const f = pent[(this.beat * 3 + s) % 5] * 2;
                        this._note(t + s * spb / 2, f, 0.5, 0.07, 'sine', this.lp, 0.002);
                        this._note(t + s * spb / 2, f * 2.01, 0.25, 0.025, 'sine', this.lp, 0.002);
                    }
                }
                this._note(t, ch[0] / 2, spb * 0.8, 0.1, 'triangle', this.lp, 0.01);
            }
            this.next += spb;
            this.beat++;
        }
    }

    stop() {
        const t = this.ctx.currentTime;
        this.out.gain.setTargetAtTime(0, t, 0.3);
        setTimeout(() => {
            try {
                this.amb.stop();
                this.out.disconnect();
            } catch (e) { /* already stopped */ }
        }, 1500);
    }
}

// ================================================================================================
// The world
// ================================================================================================
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
        this.active = false;
        this.built = false;
        this.time = 0;
        this.keys = {};
        this._v = new THREE.Vector3();
        this._w = new THREE.Vector3();
        this.look = null;
        try {
            const saved = JSON.parse(localStorage.getItem('kajsim_mermaid_look') || 'null');
            if (saved && saved.hairStyle) this.look = Object.assign(defaultLook(), saved);
        } catch (e) { /* no storage */ }
        if (!this.look) this.look = defaultLook();
    }

    // ---------------------------------------------------------------------------------------------
    // Entering / leaving
    // ---------------------------------------------------------------------------------------------
    /** Starts the trip (the screen should already be black). */
    async enter() {
        if (this.active) return;
        try {
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
        try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* ignore */ }
        this.ui.show();
        this.ui.fade(1, 0);
        this.ui.showHud(false);
        const ctx = this.getAudioContext && this.getAudioContext();
        if (ctx && !this.audio) {
            try { this.audio = new MermaidAudio(ctx); } catch (e) { this.audio = null; }
        }
        if (this.audio) this.audio.fadeTo(0.9, 3);
        this.mode = 'creator';
        this._placePlayer(VANITY.clone(), 0);
        this.creatorYaw = 0;
        this.ui.openCreator(this.look, (look) => this._rebuildPlayer(look), (look) => this._startTasks(look));
        await this.ui.fade(0, 2200);
        this.ui.caption('~ Mermaid World ~', 3500);
    }

    async _end() {
        if (this.mode === 'ending') return;
        this.mode = 'ending';
        this.ui.setPrompt(null);
        this.ui.caption('All three tasks done!\nThe current is pulling you home...', 4500);
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
        try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* ignore */ }
        this.ui.fade(0, 0);
        this.ui.hide();
        try { localStorage.setItem('kajsim_mermaid_look', JSON.stringify(this.look)); } catch (e) { /* no storage */ }
        if (this.onExit) this.onExit();
    }

    /** Debug: finish every task. */
    finishAll() {
        Object.assign(this.tasks.wedding, { done: true });
        Object.assign(this.tasks.mall, { invited: true, bought: true, ate: true, done: true });
        for (const f of TALKING_FISH) this.tasks.explore.fish.add(f.id);
        for (const l of LANDMARKS) this.tasks.explore.places.add(l.id);
        this.tasks.explore.done = true;
        this._refreshTasks();
    }

    _resetTrip() {
        this.money = START_MONEY;
        this.owned = new Set();
        this.tasks = {
            wedding: { done: false },
            mall: { invited: false, bought: false, ate: false, done: false },
            explore: { fish: new Set(), places: new Set(), done: false }
        };
        this.cut = null;
        this.camYaw = Math.PI;
        this.camPitch = -0.15;
        this.vel = new THREE.Vector3();
        // Friends (new faces every trip)
        for (const f of this.friends || []) this.scene.remove(f.m.root);
        this.friends = [];
        for (let i = 0; i < 3; i++) {
            const look = randomLook();
            const m = buildMermaid(look);
            const pos = FRIENDS_AT.clone().add(new THREE.Vector3(Math.cos(i * 2.1) * 2.2, Math.sin(i) * 0.6, Math.sin(i * 2.1) * 2.2));
            m.root.position.copy(pos);
            this.scene.add(m.root);
            this.friends.push({ m, look, pos, yaw: i * 2.1 + Math.PI, following: false, slot: i, swim: 0 });
        }
        if (this.weddingSet) {
            this.scene.remove(this.weddingSet);
            this.weddingSet = null;
        }
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
                if (e.target && e.target.tagName === 'INPUT') return;
                const k = e.key.toLowerCase();
                if (k === 'tab' || k === ' ') e.preventDefault();
                this.keys[k] = true;
                if (k === 'e' || k === 'enter') this._interact();
            },
            keyup: (e) => {
                e.stopImmediatePropagation();
                this.keys[e.key.toLowerCase()] = false;
            },
            mousedown: (e) => {
                e.stopImmediatePropagation();
                if (this.mode === 'creator' && e.target === canvas) this._drag = e.clientX;
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
                } else if (document.pointerLockElement === canvas && this.mode === 'explore' && !this.ui.modalOpen) {
                    this.camYaw -= e.movementX * 0.0026;
                    this.camPitch = clamp(this.camPitch - e.movementY * 0.0022, -1.25, 1.1);
                }
            },
            click: (e) => {
                // Clicking the world grabs the mouse for swimming (the game's own handler does it),
                // but not while a menu is up
                const free = this.mode === 'explore' && !this.ui.modalOpen && !this.ui.dialogOpen;
                if (!inUI(e) && !free) e.stopImmediatePropagation();
                if (this.ui.dialogOpen && !inUI(e)) this.ui.advance();
            },
            wheel: (e) => e.stopImmediatePropagation(),
            contextmenu: (e) => {
                e.stopImmediatePropagation();
                e.preventDefault();
            }
        };
        for (const [k, fn] of Object.entries(this._h)) window.addEventListener(k, fn, { capture: true, passive: k !== 'wheel' && k !== 'contextmenu' && k !== 'keydown' });
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

    // ---------------------------------------------------------------------------------------------
    // Building the world
    // ---------------------------------------------------------------------------------------------
    _build() {
        this.built = true;
        const scene = this.scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a5a8a);
        scene.fog = new THREE.FogExp2(0x0c6896, 0.0105);
        this.camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 700);

        scene.add(new THREE.HemisphereLight(0xa8ecff, 0x0a2a48, 1.35));
        const sun = new THREE.DirectionalLight(0xd9f6ff, 1.6);
        sun.position.set(30, 100, 20);
        scene.add(sun);
        scene.add(new THREE.AmbientLight(0x3a7bb0, 0.35));

        this._buildSeabed();
        this._buildLightRays();
        this._buildPlants();
        this._buildBubbles();
        this._buildSchools();
        this._buildTown();
        this._buildChapel();
        this._buildMall();
        this._buildLandmarks();
        this._buildTalkingFish();

        this.player = { m: null, pos: new THREE.Vector3(), yaw: 0, swim: 0, action: null };
        this._rebuildPlayer(this.look);
    }

    _buildSeabed() {
        const geo = new THREE.PlaneGeometry(700, 700, 140, 140);
        geo.rotateX(-Math.PI / 2);
        const pos = geo.attributes.position;
        const colors = new Float32Array(pos.count * 3);
        const c = new THREE.Color();
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), z = pos.getZ(i);
            pos.setY(i, floorHeight(x, z));
            const n = 0.5 + 0.5 * Math.sin(x * 0.2) * Math.cos(z * 0.17);
            c.setHex(0xe9d9a8).lerp(new THREE.Color(0xc9b47e), n * 0.5);
            colors.set([c.r, c.g, c.b], i * 3);
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.computeVertexNormals();
        this.scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })));

        // Caustics: two scrolling layers of bright ripples laid over the sand
        const tex = canvasTexture(256, 256, (g, w, h) => {
            g.fillStyle = '#000';
            g.fillRect(0, 0, w, h);
            g.strokeStyle = 'rgba(255,255,255,0.85)';
            g.lineWidth = 3;
            for (let i = 0; i < 70; i++) {
                const x = rand() * w, y = rand() * h, r = between(8, 26);
                g.beginPath();
                g.ellipse(x, y, r, r * between(0.5, 1), rand() * Math.PI, 0, Math.PI * between(0.7, 1.6));
                g.stroke();
                // Tile seamlessly
                for (const [dx, dy] of [[w, 0], [-w, 0], [0, h], [0, -h]]) {
                    g.beginPath();
                    g.ellipse(x + dx, y + dy, r, r * 0.7, 0, 0, Math.PI);
                    g.stroke();
                }
            }
        });
        tex.colorSpace = THREE.NoColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(50, 50);
        this.caustics = [];
        for (let k = 0; k < 2; k++) {
            const t = tex.clone();
            t.needsUpdate = true;
            t.repeat.set(k ? 41 : 53, k ? 41 : 53);
            const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xbff4ff }));
            m.position.y = 0.06 + k * 0.02;
            m.renderOrder = 1;
            this.scene.add(m);
            this.caustics.push(t);
        }

        // The surface far above, bright and rippling
        const sg = new THREE.PlaneGeometry(900, 900, 1, 1);
        sg.rotateX(Math.PI / 2);
        const surf = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0x9feaff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, fog: false }));
        surf.position.y = SURFACE_Y;
        this.scene.add(surf);
    }

    _buildLightRays() {
        const tex = canvasTexture(64, 256, (g, w, h) => {
            const grd = g.createLinearGradient(0, 0, 0, h);
            grd.addColorStop(0, 'rgba(255,255,255,0.9)');
            grd.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = grd;
            g.fillRect(0, 0, w, h);
        });
        this.rays = [];
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, color: 0xd6fbff });
        for (let i = 0; i < 16; i++) {
            const g = new THREE.CylinderGeometry(between(2, 4), between(7, 12), 70, 12, 1, true);
            g.translate(0, -35, 0);
            const m = new THREE.Mesh(g, mat);
            m.position.set(between(-150, 150), SURFACE_Y, between(-150, 150));
            m.rotation.z = between(-0.2, 0.2);
            m.userData.phase = rand() * 10;
            this.scene.add(m);
            this.rays.push(m);
        }
    }

    _buildPlants() {
        // Kelp: tall swaying ribbons (sway in the vertex shader)
        this.kelpUniform = { value: 0 };
        const kg = new THREE.PlaneGeometry(0.8, 1, 1, 10);
        kg.translate(0, 0.5, 0);
        const kmat = new THREE.MeshStandardMaterial({ color: 0x2e8b3c, side: THREE.DoubleSide, roughness: 0.8 });
        kmat.onBeforeCompile = (sh) => {
            sh.uniforms.uTime = this.kelpUniform;
            sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
                .replace('#include <begin_vertex>', `#include <begin_vertex>
                    float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21;
                    transformed.x += sin(uTime * 1.1 + ph + position.y * 2.4) * 0.22 * position.y;
                    transformed.z += cos(uTime * 0.8 + ph + position.y * 1.7) * 0.15 * position.y;`);
        };
        const spots = [];
        for (let i = 0; i < 520; i++) {
            // Dense in the Kelp Forest, scattered elsewhere (not on the plaza / aisle)
            const forest = i < 330;
            const L = LANDMARKS.find((l) => l.id === 'kelp');
            const x = forest ? L.at[0] + between(-30, 30) : between(-210, 210);
            const z = forest ? L.at[2] + between(-30, 30) : between(-210, 210);
            if (!forest && (Math.hypot(x, z) < 70 || Math.hypot(x - MALL.x, z - MALL.z) < 40)) continue;
            spots.push([x, z, forest ? between(12, 26) : between(4, 12)]);
        }
        const kelp = new THREE.InstancedMesh(kg, kmat, spots.length);
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
        const col = new THREE.Color();
        spots.forEach(([x, z, h], i) => {
            p.set(x, floorHeight(x, z) - 0.2, z);
            q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
            s.set(between(0.7, 1.3), h, 1);
            m4.compose(p, q, s);
            kelp.setMatrixAt(i, m4);
            kelp.setColorAt(i, col.setHex(pick([0x2e8b3c, 0x3fa34d, 0x6b8e23, 0x2f7d32, 0x8fbc3f])));
        });
        this.scene.add(kelp);

        // Coral: branching, brain and fan corals in reef colours
        const coralColors = [0xff6f91, 0xff9671, 0xffc75f, 0xd65db1, 0x845ec2, 0x4ffbdf, 0xf9f871, 0xff4f79, 0x00c9a7];
        const branch = [];
        for (let i = 0; i < 6; i++) {
            const g = new THREE.CylinderGeometry(0.06, 0.12, 1.2, 6);
            g.translate(0, 0.6, 0);
            g.rotateZ(between(-0.6, 0.6));
            g.rotateX(between(-0.6, 0.6));
            branch.push(g);
        }
        const merged = mergeGeos(branch);
        const brain = new THREE.SphereGeometry(0.8, 12, 8);
        brain.scale(1, 0.6, 1);
        const fan = new THREE.CircleGeometry(1, 12, 0, Math.PI);
        const kinds = [[merged, 260], [brain, 140], [fan, 120]];
        for (const [geo, n] of kinds) {
            const mesh2 = new THREE.InstancedMesh(geo, std(0xffffff, { roughness: 0.6, side: THREE.DoubleSide }), n);
            for (let i = 0; i < n; i++) {
                let x, z;
                do {
                    x = between(-200, 200);
                    z = between(-200, 200);
                } while (Math.hypot(x, z) < 24 || (Math.abs(x) < 9 && z < -36 && z > -70));
                p.set(x, floorHeight(x, z), z);
                q.setFromEuler(new THREE.Euler(0, rand() * TWO_PI, 0));
                const sc = between(0.7, 2.2);
                s.set(sc, sc, sc);
                m4.compose(p, q, s);
                mesh2.setMatrixAt(i, m4);
                mesh2.setColorAt(i, col.setHex(pick(coralColors)));
            }
            this.scene.add(mesh2);
        }
        // Rocks
        const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), std(0x8d8577, { roughness: 1 }), 140);
        for (let i = 0; i < 140; i++) {
            const x = between(-220, 220), z = between(-220, 220);
            if (Math.hypot(x, z) < 26) { rocks.setMatrixAt(i, m4.makeScale(0, 0, 0)); continue; }
            p.set(x, floorHeight(x, z), z);
            q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3));
            const sc = between(0.6, 3.5);
            s.set(sc, sc * between(0.5, 0.9), sc);
            m4.compose(p, q, s);
            rocks.setMatrixAt(i, m4);
            rocks.setColorAt(i, col.setHex(pick([0x8d8577, 0x6f6a60, 0x9b8f7a, 0x7a7466])));
        }
        this.scene.add(rocks);
    }

    _buildBubbles() {
        const N = 500;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(N * 3);
        this.bubbleVents = [];
        for (let i = 0; i < 14; i++) this.bubbleVents.push([between(-150, 150), between(-150, 150)]);
        for (let i = 0; i < N; i++) {
            const v = pick(this.bubbleVents);
            pos.set([v[0] + between(-1, 1), between(0, SURFACE_Y), v[1] + between(-1, 1)], i * 3);
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const tex = canvasTexture(32, 32, (g) => {
            g.strokeStyle = 'rgba(255,255,255,0.95)';
            g.lineWidth = 2.5;
            g.beginPath();
            g.arc(16, 16, 12, 0, TWO_PI);
            g.stroke();
            g.fillStyle = 'rgba(255,255,255,0.8)';
            g.beginPath();
            g.arc(11, 11, 3, 0, TWO_PI);
            g.fill();
        });
        this.bubbles = new THREE.Points(geo, new THREE.PointsMaterial({ map: tex, size: 0.45, transparent: true, depthWrite: false, opacity: 0.8 }));
        this.scene.add(this.bubbles);
        // Bursts (wedding bubbles, plankton fireworks)
        this.bursts = [];
    }

    _burst(at, n, color, speed = 4, size = 0.5, life = 3, glow = false) {
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(n * 3);
        const vel = [];
        for (let i = 0; i < n; i++) {
            pos.set([at.x, at.y, at.z], i * 3);
            const v = new THREE.Vector3(between(-1, 1), between(-1, 1), between(-1, 1)).normalize().multiplyScalar(speed * between(0.4, 1));
            vel.push(v);
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({ color, size, transparent: true, depthWrite: false, opacity: 1, blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending, map: this.bubbles.material.map });
        const pts = new THREE.Points(geo, mat);
        this.scene.add(pts);
        this.bursts.push({ pts, vel, t: 0, life, rise: glow ? 0 : 1.5 });
    }

    _buildSchools() {
        const geo = schoolFishGeometry();
        const N = 220;
        this.school = new THREE.InstancedMesh(geo, std(0xffffff, { roughness: 0.4, metalness: 0.2 }), N);
        this.school.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.school.frustumCulled = false;
        this.schools = [];
        const palettes = [[0xffd32a, 0xffa801], [0x0fbcf9, 0x4bcffa], [0xff5e57, 0xff3f34], [0x05c46b, 0x0be881], [0xd2dae2, 0x808e9b], [0xf53b57, 0xef5777], [0x3c40c6, 0x575fcf]];
        const col = new THREE.Color();
        let idx = 0;
        for (let s = 0; s < 10 && idx < N; s++) {
            const n = Math.min(N - idx, 14 + Math.floor(rand() * 14));
            const pal = pick(palettes);
            const sc = { cx: between(-120, 120), cz: between(-120, 120), r: between(15, 45), y: between(4, 26), speed: between(0.08, 0.18) * (rand() < 0.5 ? 1 : -1), ph: rand() * TWO_PI, fish: [] };
            for (let i = 0; i < n; i++) {
                sc.fish.push({ i: idx, off: new THREE.Vector3(between(-2.5, 2.5), between(-1.2, 1.2), between(-2.5, 2.5)), ph: rand() * 10, scale: between(0.8, 1.6) });
                this.school.setColorAt(idx, col.setHex(pick(pal)));
                idx++;
            }
            this.schools.push(sc);
        }
        this.school.count = idx;
        this.scene.add(this.school);
    }

    _shellHouse(color) {
        const g = new THREE.Group();
        const shellMat = std(color, { roughness: 0.45, metalness: 0.1 });
        // A spiral shell: stacked, shrinking, twisting rings
        for (let i = 0; i < 6; i++) {
            const r = 5 - i * 0.75;
            const ring = mesh(new THREE.SphereGeometry(r, 16, 10), shellMat, Math.sin(i * 1.2) * 0.8, 2.2 + i * 1.7, Math.cos(i * 1.2) * 0.8);
            ring.scale.set(1, 0.55, 1);
            g.add(ring);
        }
        g.add(mesh(new THREE.ConeGeometry(0.6, 2, 8), shellMat, 0, 12.4, 0));
        // Door and glowing windows
        const door = mesh(new THREE.CircleGeometry(1.2, 16), std(0x3d2c1e), 0, 1.4, 4.75);
        g.add(door);
        const win = std(0xfff3b0, { emissive: 0xffe08a, emissiveIntensity: 0.9 });
        for (const [x, y, z, ry] of [[2.6, 3.2, 3.9, 0.6], [-2.6, 3.2, 3.9, -0.6], [0, 5.6, 3.6, 0]]) {
            const w = mesh(new THREE.CircleGeometry(0.55, 12), win, x, y, z);
            w.rotation.y = ry;
            g.add(w);
        }
        return g;
    }

    _buildTown() {
        // Plaza: a stone disc with a merman statue
        const plaza = mesh(new THREE.CylinderGeometry(22, 23, 0.6, 40), std(0xd8cfc0, { roughness: 0.9 }), 0, floorHeight(0, 0) + 0.2, 0);
        this.scene.add(plaza);
        const ring = mesh(new THREE.TorusGeometry(18, 0.25, 6, 48), std(0x74b9ff, { emissive: 0x74b9ff, emissiveIntensity: 0.5 }), 0, floorHeight(0, 0) + 0.55, 0);
        ring.rotation.x = Math.PI / 2;
        this.scene.add(ring);
        const ped = mesh(new THREE.CylinderGeometry(1.6, 2, 3, 12), std(0xbdb6a8), 0, floorHeight(0, 0) + 1.8, 0);
        this.scene.add(ped);
        const statue = buildMermaid({ ...defaultLook(), male: true, hairStyle: 'long', accessory: 'crown', trident: true, tailSize: 1.2 });
        const stone = std(0xcfc8b8, { roughness: 0.85 });
        statue.root.traverse((o) => { if (o.isMesh) o.material = stone; });
        statue.root.scale.setScalar(2.2);
        statue.root.position.set(0, floorHeight(0, 0) + 7.2, 0);
        statue.arms[1].sh.rotation.set(-2.6, 0, 0.2);
        this.scene.add(statue.root);
        this.statue = statue;

        // Shell houses around the plaza (leaving the way to the chapel and the mall open)
        const colors = [0xffb8d1, 0xc3aed6, 0xa0e7e5, 0xfbe7c6, 0xb4f8c8, 0xffaebc, 0xd4a5a5, 0xa2d2ff, 0xffc8dd, 0xcdb4db, 0xbde0fe, 0xffafcc];
        let k = 0;
        for (let i = 0; i < 14; i++) {
            const a = (i / 14) * TWO_PI;
            const x = Math.sin(a) * 52, z = Math.cos(a) * 52;
            if (z < -30 && Math.abs(x) < 25) continue; // chapel avenue
            if (x > 35 && Math.abs(z - 10) < 30) continue; // mall
            const h = this._shellHouse(colors[k++ % colors.length]);
            h.position.set(x, floorHeight(x, z), z);
            h.rotation.y = Math.atan2(-x, -z); // doors face the plaza
            h.scale.setScalar(between(0.85, 1.15));
            this.scene.add(h);
        }
        // A path of glowing pebbles to the chapel and the mall
        const pebble = std(0xe0f7ff, { emissive: 0x9be7ff, emissiveIntensity: 0.6 });
        const pg = new THREE.SphereGeometry(0.25, 6, 4);
        for (let z = -24; z > -66; z -= 3) {
            for (const x of [-4, 4]) this.scene.add(mesh(pg, pebble, x, floorHeight(x, z) + 0.1, z));
        }
        for (let x = 24; x < 68; x += 3) {
            for (const z of [6, 14]) this.scene.add(mesh(pg, pebble, x, floorHeight(x, z) + 0.1, z));
        }
        // Vanity shell (where you're created)
        const mirror = mesh(new THREE.CircleGeometry(2.4, 24), std(0xcfefff, { metalness: 0.9, roughness: 0.08 }), VANITY.x, VANITY.y + 0.6, VANITY.z - 3.2);
        this.scene.add(mirror);
        const frame = mesh(new THREE.TorusGeometry(2.5, 0.22, 8, 32), std(0xffb8d1, { metalness: 0.3, roughness: 0.3 }), VANITY.x, VANITY.y + 0.6, VANITY.z - 3.21);
        this.scene.add(frame);
    }

    _buildChapel() {
        const g = new THREE.Group();
        const pearl = std(0xfff5f8, { roughness: 0.25, metalness: 0.25 });
        const coral = std(0xff8fab, { roughness: 0.5 });
        const dome = mesh(new THREE.SphereGeometry(13, 28, 18, 0, TWO_PI, 0, Math.PI / 2), pearl, 0, 0, 0);
        g.add(dome);
        g.add(mesh(new THREE.ConeGeometry(2.4, 12, 12), coral, 0, 17, 0));
        g.add(mesh(new THREE.SphereGeometry(1.2, 12, 8), std(0xfff1a8, { emissive: 0xfff1a8, emissiveIntensity: 1 }), 0, 23.5, 0));
        for (let i = 0; i < 10; i++) {
            const a = (i / 10) * TWO_PI;
            if (Math.cos(a) > 0.5) continue; // keep the front clear for the ceremony
            g.add(mesh(new THREE.CylinderGeometry(0.7, 0.9, 10, 10), coral, Math.sin(a) * 14, 5, Math.cos(a) * 14));
        }
        // Entrance arch facing the town
        const arch = mesh(new THREE.TorusGeometry(5, 0.8, 10, 24, Math.PI), coral, 0, 4, 13);
        g.add(arch);
        const sign = mesh(new THREE.PlaneGeometry(10, 2.5), new THREE.MeshBasicMaterial({ map: signTexture('Coral Chapel', '#ff8fab'), transparent: true }), 0, 10.5, 13.3);
        g.add(sign);
        g.position.copy(CHAPEL);
        g.position.y = floorHeight(CHAPEL.x, CHAPEL.z);
        this.scene.add(g);
        // Shell pews along the aisle outside
        const pewMat = std(0xfde2e4, { roughness: 0.4 });
        for (let z = -40; z > -54; z -= 3.2) {
            for (const x of [-5, -8.5, 5, 8.5]) {
                const p = mesh(new THREE.SphereGeometry(1.3, 12, 8, 0, TWO_PI, 0, Math.PI / 2), pewMat, x, floorHeight(x, z), z);
                p.scale.set(1.2, 0.5, 0.7);
                this.scene.add(p);
            }
        }
        // Coralie, the wedding planner
        this.coralie = this._seahorse(0xff9ff3);
        this.coralie.position.set(4, 3.4, -30);
        this.scene.add(this.coralie);
    }

    _seahorse(color) {
        const g = new THREE.Group();
        const m = std(color, { roughness: 0.4 });
        for (let i = 0; i < 7; i++) {
            const r = 0.32 - i * 0.03;
            g.add(mesh(new THREE.SphereGeometry(r, 10, 8), m, Math.sin(i * 0.5) * 0.12, 0.9 - i * 0.3, Math.sin(i * 0.9) * 0.15 - i * 0.02));
        }
        const head = mesh(new THREE.SphereGeometry(0.34, 12, 8), m, 0, 1.25, 0.1);
        g.add(head);
        const snout = mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.5, 8), m, 0, 1.2, 0.45);
        snout.rotation.x = Math.PI / 2;
        g.add(snout);
        for (const sx of [-1, 1]) {
            g.add(mesh(new THREE.SphereGeometry(0.08, 8, 6), std(0xffffff), sx * 0.2, 1.33, 0.2));
            g.add(mesh(new THREE.SphereGeometry(0.045, 8, 6), std(0x111111), sx * 0.24, 1.34, 0.25));
        }
        const fin = mesh(new THREE.ConeGeometry(0.3, 0.5, 3), std(0xffffff, { transparent: true, opacity: 0.6 }), 0, 0.6, -0.35);
        fin.rotation.x = -0.5;
        g.add(fin);
        g.add(mesh(new THREE.TorusGeometry(0.25, 0.06, 6, 12, Math.PI * 1.5), m, 0.05, -1.25, 0.1));
        return g;
    }

    _buildMall() {
        const g = new THREE.Group();
        const body = mesh(new THREE.BoxGeometry(16, 13, 62), std(0xc7ecee, { roughness: 0.4, metalness: 0.15 }), 0, 6.5, 0);
        g.add(body);
        g.add(mesh(new THREE.BoxGeometry(17, 1.2, 63), std(0xff9ff3, { roughness: 0.4 }), 0, 13.4, 0));
        const roofSign = mesh(new THREE.PlaneGeometry(26, 5), new THREE.MeshBasicMaterial({ map: signTexture('Mermaid Mall', '#a29bfe', '#fff', 768, 160), transparent: true }), -8.2, 16.5, 0);
        roofSign.rotation.y = -Math.PI / 2;
        g.add(roofSign);
        g.position.set(MALL.x, floorHeight(MALL.x, MALL.z), MALL.z);
        this.scene.add(g);
        // Storefronts along the side facing the town (-X)
        this.storefronts = [];
        const xs = MALL.x - 8.2;
        SHOPS.forEach((shop, i) => {
            const z = MALL.z - 22 + i * 14.5;
            const y = floorHeight(xs, z);
            const arch = mesh(new THREE.TorusGeometry(3.2, 0.5, 8, 18, Math.PI), std(shop.sign, { roughness: 0.3 }), xs - 0.1, y + 2, z);
            arch.rotation.y = -Math.PI / 2;
            this.scene.add(arch);
            const door = mesh(new THREE.PlaneGeometry(5.4, 4.6), std(0x1e3d59, { emissive: 0x3c6e91, emissiveIntensity: 0.6 }), xs - 0.05, y + 2.3, z);
            door.rotation.y = -Math.PI / 2;
            this.scene.add(door);
            const sign = mesh(new THREE.PlaneGeometry(9, 2.2), new THREE.MeshBasicMaterial({ map: signTexture(shop.name, hexStr(shop.sign), '#20124d'), transparent: true }), xs - 0.15, y + 7, z);
            sign.rotation.y = -Math.PI / 2;
            this.scene.add(sign);
            this.storefronts.push({ shop, pos: new THREE.Vector3(xs - 3, y + 3, z) });
        });
        // Food court: mushroom tables with shell stools
        this.tables = [];
        for (const [dx, dz] of [[0, 0], [-8, -6], [-8, 6], [0, 12]]) {
            const x = FOOD_TABLE.x + dx, z = FOOD_TABLE.z + dz;
            const y = floorHeight(x, z);
            this.scene.add(mesh(new THREE.CylinderGeometry(0.35, 0.5, 2.2, 10), std(0xf8efba), x, y + 1.1, z));
            this.scene.add(mesh(new THREE.CylinderGeometry(2, 2, 0.25, 20), std(0xff7979, { roughness: 0.5 }), x, y + 2.3, z));
            this.tables.push(new THREE.Vector3(x, y + 2.45, z));
        }
        this.foodItems = new THREE.Group();
        this.scene.add(this.foodItems);
    }

    _buildLandmarks() {
        const y0 = (x, z) => floorHeight(x, z);
        // Sunken ship
        {
            const L = LANDMARKS[0];
            const g = new THREE.Group();
            const wood = std(0x6d4c41, { roughness: 0.95 });
            const hull = mesh(new THREE.BoxGeometry(8, 6, 26), wood, 0, 2.5, 0);
            g.add(hull);
            const bow = mesh(new THREE.ConeGeometry(4.6, 9, 4), wood, 0, 2.5, 17);
            bow.rotation.x = Math.PI / 2;
            bow.rotation.y = Math.PI / 4;
            bow.scale.set(0.85, 1, 0.65);
            g.add(bow);
            g.add(mesh(new THREE.CylinderGeometry(0.4, 0.5, 18, 8), wood, 0, 12, 2));
            const broken = mesh(new THREE.CylinderGeometry(0.35, 0.4, 9, 8), wood, 3, 3, -8);
            broken.rotation.z = 1.2;
            g.add(broken);
            const sail = mesh(new THREE.PlaneGeometry(8, 7), std(0xe8e0d0, { side: THREE.DoubleSide, transparent: true, opacity: 0.8 }), 0, 13, 2.3);
            g.add(sail);
            for (let i = -2; i <= 2; i++) g.add(mesh(new THREE.CircleGeometry(0.6, 10), std(0x111111), 4.02, 3, i * 4.5));
            g.children[g.children.length - 1].rotation.y = Math.PI / 2;
            const chest = mesh(new THREE.BoxGeometry(2, 1.2, 1.3), std(0x8d6e63), 6, 0.6, 6);
            g.add(chest);
            g.add(mesh(new THREE.BoxGeometry(1.6, 0.4, 0.9), std(0xf1c40f, { metalness: 0.9, roughness: 0.3, emissive: 0xf1c40f, emissiveIntensity: 0.3 }), 6, 1.35, 6));
            g.position.set(L.at[0], y0(L.at[0], L.at[2]) - 1, L.at[2]);
            g.rotation.set(0.15, 0.7, 0.35);
            this.scene.add(g);
        }
        // Giant clam with a glowing pearl
        {
            const L = LANDMARKS[1];
            const g = new THREE.Group();
            const shell = std(0xcfa9e0, { roughness: 0.35, metalness: 0.2, side: THREE.DoubleSide });
            const bottom = mesh(new THREE.SphereGeometry(7, 24, 12, 0, TWO_PI, Math.PI / 2, Math.PI / 2), shell);
            bottom.scale.y = 0.5;
            g.add(bottom);
            const top = mesh(new THREE.SphereGeometry(7, 24, 12, 0, TWO_PI, 0, Math.PI / 2), shell);
            top.scale.y = 0.5;
            top.position.z = -6;
            top.rotation.x = -1.0;
            top.position.y = 2.5;
            g.add(top);
            const pearl = mesh(new THREE.SphereGeometry(1.8, 24, 16), std(0xffffff, { roughness: 0.05, metalness: 0.3, emissive: 0xe0f7ff, emissiveIntensity: 0.8 }), 0, 0.6, 0);
            g.add(pearl);
            const light = new THREE.PointLight(0xe0f7ff, 3, 25);
            light.position.set(0, 3, 0);
            g.add(light);
            g.position.set(L.at[0], y0(L.at[0], L.at[2]) + 2, L.at[2]);
            this.scene.add(g);
        }
        // Whale skeleton
        {
            const L = LANDMARKS[3];
            const g = new THREE.Group();
            const bone = std(0xf5f0e1, { roughness: 0.8 });
            for (let i = 0; i < 18; i++) g.add(mesh(new THREE.SphereGeometry(0.7 - i * 0.025, 8, 6), bone, 0, 1.5, i * 1.5));
            for (let i = 2; i < 13; i++) {
                const r = 4.5 - Math.abs(i - 6) * 0.35;
                const rib = mesh(new THREE.TorusGeometry(r, 0.22, 6, 16, Math.PI), bone, 0, 1.5, i * 1.5);
                rib.rotation.set(0, Math.PI / 2, Math.PI / 2);
                rib.rotation.order = 'YXZ';
                g.add(rib);
            }
            const skull = mesh(new THREE.SphereGeometry(3, 12, 8), bone, 0, 2, -3);
            skull.scale.set(1, 0.6, 1.6);
            g.add(skull);
            g.position.set(L.at[0], y0(L.at[0], L.at[2]), L.at[2]);
            g.rotation.y = 0.9;
            g.rotation.z = 0.15;
            this.scene.add(g);
        }
        // Kelp forest marker: a ring of lantern flowers among the kelp
        {
            const L = LANDMARKS[2];
            for (let i = 0; i < 9; i++) {
                const a = (i / 9) * TWO_PI;
                const x = L.at[0] + Math.sin(a) * 8, z = L.at[2] + Math.cos(a) * 8;
                const f = mesh(new THREE.SphereGeometry(0.5, 10, 8), std(0xf9f871, { emissive: 0xf9f871, emissiveIntensity: 1.2 }), x, floorHeight(x, z) + 1.2, z);
                this.scene.add(f);
            }
        }
    }

    _buildTalkingFish() {
        this.talkers = TALKING_FISH.map((d) => {
            const g = buildFish(d.color, d.stripe, d.size * 1.6, d.glow);
            const anchor = new THREE.Vector3(d.at[0], d.at[1], d.at[2]);
            g.position.copy(anchor);
            this.scene.add(g);
            const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(d.name, '#0984e3'), transparent: true, depthTest: false }));
            label.scale.set(5, 1.25, 1);
            label.renderOrder = 10;
            this.scene.add(label);
            return { d, g, anchor, label, ph: rand() * 10, talking: false };
        });
    }

    // ---------------------------------------------------------------------------------------------
    // Player & friends
    // ---------------------------------------------------------------------------------------------
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
    }

    _placePlayer(pos, yaw) {
        this.player.pos.copy(pos);
        this.player.yaw = yaw;
        this.player.m.root.position.copy(pos);
        this.player.m.root.rotation.set(0, yaw, 0, 'YXZ');
    }

    _startTasks(look) {
        this.look = look;
        try { localStorage.setItem('kajsim_mermaid_look', JSON.stringify(look)); } catch (e) { /* no storage */ }
        this.mode = 'explore';
        this.camYaw = Math.PI;
        this.camPitch = -0.12;
        this.ui.showHud(true);
        this.ui.setMoney(this.money);
        this._refreshTasks();
        this.ui.caption(`Welcome, ${look.name}!\nClick to grab the mouse, then swim with WASD.`, 5000);
        if (this.audio) this.audio.chime();
    }

    _refreshTasks() {
        const T = this.tasks;
        T.mall.done = T.mall.invited && T.mall.bought && T.mall.ate;
        T.explore.done = T.explore.fish.size >= 4 && T.explore.places.size >= LANDMARKS.length;
        this.ui.setTasks([
            { title: 'Plan a mermaid wedding', done: T.wedding.done, sub: [{ text: 'Find Coralie at the Coral Chapel (north)', done: false }] },
            {
                title: 'Mall day with your friends', done: T.mall.done, sub: [
                    { text: 'Invite your friends (by the plaza)', done: T.mall.invited },
                    { text: 'Buy something to wear at the Mermaid Mall (east)', done: T.mall.bought },
                    { text: 'Eat together at the Kelp Café', done: T.mall.ate }
                ]
            },
            {
                title: 'Explore Mermaid Town', done: T.explore.done, sub: [
                    { text: `Talk to fish (${Math.min(4, T.explore.fish.size)}/4)`, done: T.explore.fish.size >= 4 },
                    { text: `Find landmarks (${T.explore.places.size}/${LANDMARKS.length})`, done: T.explore.places.size >= LANDMARKS.length }
                ]
            }
        ]);
        if (T.wedding.done && T.mall.done && T.explore.done && this.mode === 'explore') this._end();
    }

    // ---------------------------------------------------------------------------------------------
    // Interactions
    // ---------------------------------------------------------------------------------------------
    _interactables() {
        const list = [];
        const T = this.tasks;
        list.push({ pos: this.coralie.position, r: 7, label: T.wedding.done ? 'Talk to Coralie' : 'Plan your wedding with Coralie', act: () => this._coralie() });
        if (!T.mall.invited) list.push({ pos: this.friends[0].m.root.position, r: 7, label: 'Invite your friends to the mall', act: () => this._invite() });
        for (const s of this.storefronts) list.push({ pos: s.pos, r: 7, label: `Enter ${s.shop.name}`, act: () => this._shop(s.shop) });
        for (const f of this.talkers) list.push({ pos: f.g.position, r: 6 + f.d.size, label: `Talk to ${f.d.name}`, act: () => this._talk(f) });
        return list;
    }

    _interact() {
        if (this.ui.dialogOpen) {
            this.ui.advance();
            return;
        }
        if (this.mode !== 'explore' || this.ui.modalOpen || !this._near) return;
        this._near.act();
    }

    async _coralie() {
        this._freeMouse();
        if (this.tasks.wedding.done) {
            await this.ui.say('Coralie the Seahorse', 'That was the most beautiful wedding this reef has ever seen. I\'m still crying. Seahorses can cry.');
            return;
        }
        await this.ui.conversation('Coralie the Seahorse', ['Oh my GOSH, a bride! I\'m Coralie, the best wedding planner in the whole reef.',
            'Let\'s plan your dream ceremony. Theme, look, partner, cake, music - everything!']);
        this.ui.openPlanner(WEDDING.steps, (choices) => this._wedding(choices));
    }

    async _invite() {
        this._freeMouse();
        const f = this.friends;
        await this.ui.say(`${this.look.name}`, 'Hey girls! Mall day?');
        for (let i = 0; i < f.length; i++) await this.ui.say(f[i].look.name, FRIEND_LINES.invite[i % FRIEND_LINES.invite.length]);
        for (const fr of f) fr.following = true;
        this.tasks.mall.invited = true;
        this._refreshTasks();
        this.ui.caption('Your friends are following you!\nThe Mermaid Mall is to the east.', 4000);
    }

    _shop(shop) {
        this._freeMouse();
        const T = this.tasks.mall;
        if (shop.kind === 'food' && !T.invited) {
            this.ui.say(shop.name, 'Table for one? Go get your friends first, hon - eating alone at the mall is tragic.');
            return;
        }
        const state = { money: this.money, owned: this.owned };
        this.ui.openShop(shop, state, (item) => {
            if (this.money < item.price) return false;
            this.money -= item.price;
            state.money = this.money;
            this.ui.setMoney(this.money);
            if (item.food) {
                this.ui.closeModal();
                this._eat(item);
                return false;
            }
            this.owned.add(item.id);
            Object.assign(this.look, item.apply);
            this._rebuildPlayer(this.look);
            if (this.friends.some((f) => f.following)) this.ui.caption(`${pick(this.friends).look.name}: "${pick(FRIEND_LINES.shop)}"`, 3000);
            if (T.invited) T.bought = true;
            else this.ui.caption('Cute! (Bring your friends to make it a mall day.)', 3000);
            if (this.audio) this.audio.chime();
            this._refreshTasks();
            return true;
        }, () => {});
    }

    _eat(item) {
        // Everyone sits round the nearest table and eats
        const table = this.tables[0];
        this.mode = 'cutscene';
        const seats = [];
        const people = [this.player, ...this.friends];
        people.forEach((p, i) => {
            const a = (i / people.length) * TWO_PI;
            seats.push({ p, pos: new THREE.Vector3(table.x + Math.sin(a) * 3, table.y - 0.4, table.z + Math.cos(a) * 3), yaw: a + Math.PI });
        });
        this.foodItems.clear();
        seats.forEach((s, i) => {
            const fx = table.x + (s.pos.x - table.x) * 0.45, fz = table.z + (s.pos.z - table.z) * 0.45;
            const plate = mesh(new THREE.CylinderGeometry(0.45, 0.4, 0.06, 16), std(0xffffff), fx, table.y, fz);
            this.foodItems.add(plate);
            const food = i === 0 ? item.food : pick(SHOPS[3].items).food;
            this.foodItems.add(mesh(new THREE.SphereGeometry(0.28, 12, 8), std(food), fx, table.y + 0.2, fz));
        });
        this.cut = {
            t: 0, dur: 9,
            update: (t) => {
                for (const s of seats) {
                    s.p.m.root.position.lerp(s.pos, 0.08);
                    s.p.m.root.rotation.set(0, s.yaw, 0);
                    s.p.action = 'eat';
                    if (s.p !== this.player) s.p.pos.copy(s.p.m.root.position);
                }
                this.player.pos.copy(this.player.m.root.position);
                const a = t * 0.25;
                this.camera.position.set(table.x + Math.sin(a) * 8, table.y + 3, table.z + Math.cos(a) * 8);
                this.camera.lookAt(table.x, table.y, table.z);
                if (Math.abs(t - 2) < 0.02) this.ui.caption(`${this.friends[0].look.name}: "${FRIEND_LINES.eat[0]}"`, 2500);
                if (Math.abs(t - 5) < 0.02) this.ui.caption(`${this.friends[1].look.name}: "${FRIEND_LINES.eat[1]}"`, 2500);
            },
            done: () => {
                for (const s of seats) s.p.action = null;
                this.foodItems.clear();
                this.tasks.mall.ate = true;
                this.mode = 'explore';
                this.ui.caption(`Yum! ${item.name} with the girls.`, 3000);
                this._refreshTasks();
            }
        };
        this.ui.caption(`You order ${item.name} for the table!`, 2500);
    }

    async _talk(f) {
        this._freeMouse();
        f.talking = true;
        await this.ui.conversation(f.d.name, f.d.lines);
        f.talking = false;
        const before = this.tasks.explore.fish.size;
        this.tasks.explore.fish.add(f.d.id);
        if (this.tasks.explore.fish.size > before) this.ui.caption(`New fish friend! (${Math.min(4, this.tasks.explore.fish.size)}/4)`, 2500);
        this._refreshTasks();
    }

    // ---------------------------------------------------------------------------------------------
    // The wedding
    // ---------------------------------------------------------------------------------------------
    _wedding(choices) {
        this.mode = 'cutscene';
        this._freeMouse();
        const theme = WEDDING.steps[0].options.find((o) => o.id === choices.theme.id);
        const set = new THREE.Group();
        this.weddingSet = set;
        this.scene.add(set);
        // Arch, decorated in the theme
        const tc = theme.color;
        const arch = mesh(new THREE.TorusGeometry(4.5, 0.45, 10, 30, Math.PI), std(tc, { roughness: 0.3, metalness: 0.2, emissive: choices.theme.id === 'glow' ? tc : 0x000000, emissiveIntensity: 0.6 }), ALTAR.x, floorHeight(ALTAR.x, ALTAR.z), ALTAR.z - 2.5);
        set.add(arch);
        for (let i = 0; i < 24; i++) {
            const a = (i / 23) * Math.PI;
            set.add(mesh(new THREE.SphereGeometry(0.28, 8, 6), std(choices.theme.id === 'treasure' ? 0xf1c40f : 0xffffff, { metalness: 0.4, roughness: 0.15 }),
                ALTAR.x + Math.cos(a) * 4.5, floorHeight(ALTAR.x, ALTAR.z) + Math.sin(a) * 4.5, ALTAR.z - 2.5));
        }
        if (choices.theme.id === 'treasure') {
            for (let i = 0; i < 40; i++) set.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 10), std(0xf1c40f, { metalness: 0.9, roughness: 0.25 }), between(-6, 6), floorHeight(0, -54) + 0.1, between(-60, -42)));
        }
        if (choices.theme.id === 'moon') {
            for (let i = 0; i < 6; i++) set.add(mesh(new THREE.PlaneGeometry(1.2, 10), std(0xc8d6e5, { side: THREE.DoubleSide, transparent: true, opacity: 0.6, metalness: 0.6 }), -6 + i * 2.4, 6, ALTAR.z - 4));
        }
        const glowLight = new THREE.PointLight(tc, 3, 30);
        glowLight.position.set(ALTAR.x, ALTAR.y + 3, ALTAR.z);
        set.add(glowLight);

        // You, in your wedding look; your partner waiting at the altar
        const weddingLook = Object.assign({}, this.look, { wedding: { style: choices.dress.id, color: choices.dress.color } });
        this._rebuildPlayer(weddingLook);
        this._placePlayer(AISLE_START.clone(), Math.PI);
        const partnerLooks = {
            kai: { ...randomLook(), male: true, hairStyle: 'pixie', hairColor: 0x2ec4b6, skin: 0xc68642, tail: 0, accessory: 'none', lipstick: null, eyeshadow: null, lashes: false, blush: false, name: 'Kai' },
            neptune: { ...randomLook(), male: true, hairStyle: 'long', hairColor: 0xf5f0e6, skin: 0xeac0a0, tail: 8, accessory: 'crown', trident: true, lipstick: null, eyeshadow: null, lashes: false, blush: false, name: 'Prince Triton' },
            pearl: { ...randomLook(), top: 'pearls', accessory: 'tiara', name: 'Pearl' },
            finn: { ...randomLook(), male: true, hairStyle: 'bob', hairColor: 0x6b4a2b, skin: 0xf6d7c3, tail: 6, accessory: 'none', lipstick: null, eyeshadow: null, lashes: false, blush: false, name: 'Finn' }
        };
        const partnerLook = partnerLooks[choices.partner.id];
        const partner = buildMermaid(partnerLook);
        partner.root.rotation.order = 'YXZ';
        partner.root.position.set(ALTAR.x + 1.2, ALTAR.y, ALTAR.z);
        partner.root.rotation.y = 0;
        set.add(partner.root);

        // Officiant
        let officiant;
        if (choices.moments.has('turtle')) {
            officiant = new THREE.Group();
            const shell = mesh(new THREE.SphereGeometry(1.4, 16, 10, 0, TWO_PI, 0, Math.PI / 2), std(0x6ab04c, { roughness: 0.6 }));
            shell.scale.y = 0.7;
            officiant.add(shell);
            officiant.add(mesh(new THREE.SphereGeometry(0.45, 10, 8), std(0xbadc58), 0, 0.4, 1.4));
            for (const [x, z] of [[1.2, 0.8], [-1.2, 0.8], [1, -0.9], [-1, -0.9]]) {
                const fl = mesh(new THREE.SphereGeometry(0.4, 8, 6), std(0xbadc58), x, 0, z);
                fl.scale.set(1.4, 0.3, 0.7);
                officiant.add(fl);
            }
            officiant.rotation.x = -1.2;
        } else {
            officiant = this._seahorse(0xff9ff3);
        }
        officiant.position.set(ALTAR.x, ALTAR.y + 0.8, ALTAR.z - 3.5);
        set.add(officiant);

        // The cake
        const cake = this._cake(choices.cake);
        cake.position.set(ALTAR.x + 6, floorHeight(6, ALTAR.z), ALTAR.z + 1);
        set.add(cake);

        // Guests
        const guests = [];
        const seatsAt = (i) => new THREE.Vector3((i % 2 ? 1 : -1) * (5.5 + (i % 4 > 1 ? 3.5 : 0)), 2.5 + rand(), -41 - Math.floor(i / 4) * 3.2);
        let gi = 0;
        if (choices.guests.has('friends')) {
            for (const f of this.friends) {
                const pos = seatsAt(gi++);
                f.m.root.position.copy(pos);
                f.pos.copy(pos);
                f.m.root.rotation.set(0, Math.atan2(-pos.x, ALTAR.z - pos.z), 0);
                f.wedding = true;
            }
        }
        if (choices.guests.has('fish')) {
            for (const d of TALKING_FISH.slice(0, 4)) {
                const fish = buildFish(d.color, d.stripe, d.size * 1.3);
                fish.position.copy(seatsAt(gi++));
                fish.lookAt(ALTAR);
                set.add(fish);
                guests.push(fish);
            }
        }
        if (choices.guests.has('octopus')) {
            const o = new THREE.Group();
            o.add(mesh(new THREE.SphereGeometry(1.1, 14, 10), std(0x9b59b6)));
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * TWO_PI;
                const t = mesh(new THREE.CylinderGeometry(0.18, 0.05, 2.2, 6), std(0x8e44ad), Math.sin(a) * 0.7, -1.3, Math.cos(a) * 0.7);
                t.rotation.set(Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5);
                o.add(t);
            }
            for (const sx of [-1, 1]) o.add(mesh(new THREE.SphereGeometry(0.22, 8, 6), std(0xffffff), sx * 0.4, 0.3, 0.9));
            o.position.copy(seatsAt(gi++)).add(new THREE.Vector3(0, 1, 0));
            set.add(o);
            guests.push(o);
        }
        if (choices.guests.has('crabs')) {
            for (let i = 0; i < 4; i++) {
                const c = new THREE.Group();
                const b = mesh(new THREE.SphereGeometry(0.5, 10, 8), std(0xe74c3c));
                b.scale.y = 0.55;
                c.add(b);
                for (const sx of [-1, 1]) c.add(mesh(new THREE.SphereGeometry(0.22, 8, 6), std(0xc0392b), sx * 0.7, 0.2, 0.4));
                c.position.set(between(-4, 4), floorHeight(0, -49) + 0.3, -44 + i * 1.5);
                set.add(c);
                guests.push(c);
            }
        }
        if (choices.guests.has('shark')) {
            const s = buildFish(0x7f8c8d, 0xbdc3c7, 4);
            s.position.set(-12, 8, -48);
            s.rotation.y = Math.PI / 2;
            set.add(s);
            guests.push(s);
        }
        if (choices.guests.has('whale')) {
            const w = buildFish(0x34495e, 0x5d6d7e, 14);
            w.position.set(0, 30, -66);
            set.add(w);
            guests.push(w);
        }

        // Extras for the moments
        const jellies = [], dolphins = [], seahorses = [];
        if (choices.moments.has('jellies')) {
            for (let i = 0; i < 14; i++) {
                const j = new THREE.Group();
                const col = pick([0xff9ff3, 0x48dbfb, 0xfeca57, 0x1dd1a1, 0xa29bfe]);
                const bell = mesh(new THREE.SphereGeometry(0.7, 14, 8, 0, TWO_PI, 0, Math.PI / 2), std(col, { emissive: col, emissiveIntensity: 1.5, transparent: true, opacity: 0.75 }));
                j.add(bell);
                for (let k = 0; k < 6; k++) j.add(mesh(new THREE.CylinderGeometry(0.03, 0.01, 2, 4), std(col, { emissive: col, emissiveIntensity: 1, transparent: true, opacity: 0.6 }), Math.sin(k) * 0.4, -1, Math.cos(k) * 0.4));
                j.position.set(between(-12, 12), -2, between(-64, -39));
                j.visible = false;
                set.add(j);
                jellies.push({ j, sp: between(1, 2.2), ph: rand() * 10 });
            }
        }
        if (choices.moments.has('dolphins')) {
            for (let i = 0; i < 2; i++) {
                const d = buildFish(0x95a5a6, 0xecf0f1, 3.5);
                d.scale.set(0.55, 0.7, 1.4);
                const ring = mesh(new THREE.TorusGeometry(0.35, 0.08, 8, 16), std(0xf1c40f, { metalness: 0.9, roughness: 0.2 }), 0, 0.9, 0.9);
                d.add(ring);
                d.visible = false;
                set.add(d);
                dolphins.push(d);
            }
        }
        if (choices.moments.has('seahorses')) {
            for (let i = 0; i < 8; i++) {
                const s = this._seahorse(pick([0xfeca57, 0xff9ff3, 0x48dbfb, 0x1dd1a1]));
                s.visible = false;
                set.add(s);
                seahorses.push(s);
            }
        }

        // Music
        if (this.audio) this.audio.style = choices.music.id;
        const musicName = WEDDING.steps[4].options.find((o) => o.id === choices.music.id).name;
        const partnerName = partnerLook.name;

        // Timeline
        const segs = [];
        segs.push({ dur: 7, cap: `♪ ${musicName} plays as ${this.look.name} swims down the aisle...`, update: (t) => {
            this.player.m.root.position.lerpVectors(AISLE_START, new THREE.Vector3(ALTAR.x - 1.2, ALTAR.y, ALTAR.z), Math.min(1, t / 6.5));
            this.player.swim = 0.4;
            this._camAt(new THREE.Vector3(7, 6, -30), new THREE.Vector3(0, 3, -52));
        } });
        segs.push({ dur: 6, cap: choices.moments.has('turtle') ? 'The wise old turtle begins the ceremony...' : 'Coralie, teary-eyed, begins the ceremony...', update: (t) => {
            this.player.swim = 0;
            this.player.m.root.rotation.y = Math.PI / 2;
            partner.root.rotation.y = -Math.PI / 2;
            this._camAt(new THREE.Vector3(0, ALTAR.y + 1.5, ALTAR.z + 7), new THREE.Vector3(ALTAR.x, ALTAR.y + 0.6, ALTAR.z - 1));
            if (Math.abs(t - 3) < 0.02) this.ui.caption(`"Do you, ${this.look.name}, take ${partnerName}?"\n"I do!"`, 2800);
        } });
        const moment = (id, cap, update) => { if (choices.moments.has(id)) segs.push({ dur: 5, cap, update }); };
        const orbit = (t, r = 15, h = 6) => this._camAt(new THREE.Vector3(Math.sin(t * 0.3) * r, ALTAR.y + h, ALTAR.z + Math.cos(t * 0.3) * r), new THREE.Vector3(ALTAR.x, ALTAR.y + 1.5, ALTAR.z));
        moment('dolphins', 'Dolphin ring bearers swoop in with the rings!', (t) => {
            dolphins.forEach((d, i) => {
                d.visible = true;
                const k = t / 4;
                d.position.set((i ? 1 : -1) * (14 - k * 13), ALTAR.y + 4 + Math.sin(k * Math.PI) * 4, ALTAR.z + (i ? 2 : -2));
                d.rotation.y = i ? -Math.PI / 2 : Math.PI / 2;
            });
            orbit(t, 13, 5);
        });
        moment('bubbles', 'A bubble arch bursts into the water!', (t) => {
            if (t < 0.05) {
                for (let i = 0; i < 6; i++) {
                    const a = (i / 5) * Math.PI;
                    this._burst(new THREE.Vector3(ALTAR.x + Math.cos(a) * 4.5, floorHeight(0, ALTAR.z) + Math.sin(a) * 4.5, ALTAR.z - 2.5), 40, 0xffffff, 3, 0.6, 4);
                }
                if (this.audio) this.audio.bubble();
            }
            orbit(t + 4);
        });
        moment('jellies', 'Jellyfish light up the whole reef!', (t) => {
            for (const J of jellies) {
                J.j.visible = true;
                J.j.position.y = -2 + t * J.sp * 2.2;
                J.j.scale.y = 1 + Math.sin(t * 4 + J.ph) * 0.15;
            }
            glowLight.intensity = 3 + Math.sin(t * 6) * 2;
            orbit(t + 8, 18, 8);
        });
        moment('seahorses', 'The seahorse parade swims by!', (t) => {
            seahorses.forEach((s, i) => {
                s.visible = true;
                s.position.set(-16 + t * 6 - i * 2, ALTAR.y + 0.5 + Math.sin(t * 5 + i) * 0.3, ALTAR.z + 5);
                s.rotation.y = Math.PI / 2;
            });
            this._camAt(new THREE.Vector3(0, ALTAR.y + 2, ALTAR.z + 14), new THREE.Vector3(0, ALTAR.y + 1, ALTAR.z + 4));
        });
        moment('dance', 'Your first dance!', (t) => {
            const a = t * 1.4;
            this.player.m.root.position.set(ALTAR.x + Math.cos(a) * 1.1, ALTAR.y + 0.5, ALTAR.z + Math.sin(a) * 1.1);
            partner.root.position.set(ALTAR.x - Math.cos(a) * 1.1, ALTAR.y + 0.5, ALTAR.z - Math.sin(a) * 1.1);
            this.player.m.root.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a));
            partner.root.rotation.y = Math.atan2(Math.cos(a), Math.sin(a));
            this.player.action = 'dance';
            this._partnerAction = 'dance';
            orbit(t + 12, 9, 3);
        });
        moment('cakecut', `Cutting the ${choices.cake.tiers}-tier cake!`, (t) => {
            this.player.action = 'hold';
            this._partnerAction = 'hold';
            this.player.m.root.position.lerp(new THREE.Vector3(cake.position.x - 1.5, ALTAR.y, cake.position.z + 1.5), 0.05);
            partner.root.position.lerp(new THREE.Vector3(cake.position.x + 1.5, ALTAR.y, cake.position.z + 1.5), 0.05);
            if (cake.userData.slice) cake.userData.slice.position.set(Math.min(1.2, t * 0.5), cake.userData.slice.userData.y, Math.min(1.5, t * 0.6));
            this._camAt(new THREE.Vector3(cake.position.x, cake.position.y + 4, cake.position.z + 7), cake.position.clone().add(new THREE.Vector3(0, 1.5, 0)));
        });
        moment('plankton', 'Glowing plankton fireworks!', (t) => {
            if (Math.floor(t * 1.2) !== Math.floor((t - 1 / 60) * 1.2)) {
                this._burst(new THREE.Vector3(between(-10, 10), between(12, 20), between(-69, -49)), 120, pick([0xff9ff3, 0x48dbfb, 0xfeca57, 0x1dd1a1]), 7, 0.5, 2.5, true);
                if (this.audio) this.audio.chime();
            }
            this._camAt(new THREE.Vector3(0, ALTAR.y + 1, ALTAR.z + 18), new THREE.Vector3(0, 14, ALTAR.z - 4));
        });
        segs.push({ dur: 6, cap: `Just married! 💕\n${this.look.name} & ${partnerName}`, update: (t) => {
            this.player.action = 'wave';
            this._partnerAction = 'wave';
            if (t < 0.05) for (let i = 0; i < 5; i++) this._burst(new THREE.Vector3(between(-6, 6), ALTAR.y + 4, ALTAR.z + between(-3, 3)), 60, pick([0xff9ff3, 0xffffff, 0xfeca57]), 4, 0.45, 4);
            orbit(t + 20, 11, 4);
        } });

        let si = 0;
        let segT = 0;
        this.ui.caption(segs[0].cap, 4000);
        this.cut = {
            t: 0, dur: segs.reduce((a, s) => a + s.dur, 0),
            update: (t, dt) => {
                segT += dt;
                if (segT > segs[si].dur && si < segs.length - 1) {
                    si++;
                    segT = 0;
                    this.player.action = null;
                    this._partnerAction = null;
                    this.ui.caption(segs[si].cap, 4200);
                }
                segs[si].update(segT);
                animateMermaid(partner, this.time, { swim: 0, action: this._partnerAction || null });
                officiant.rotation.y = Math.sin(this.time) * 0.2;
                for (const g of guests) g.rotation.z = Math.sin(this.time * 2 + g.position.x) * 0.05;
            },
            done: () => {
                this.tasks.wedding.done = true;
                this.player.action = null;
                for (const f of this.friends) f.wedding = false;
                this.scene.remove(set);
                this.weddingSet = null;
                this._rebuildPlayer(this.look);
                this._placePlayer(new THREE.Vector3(0, 4, -28), Math.PI);
                if (this.audio) this.audio.style = 'town';
                this.mode = 'explore';
                this.ui.caption('Wedding planned - and what a wedding! 💒', 3500);
                this._refreshTasks();
            }
        };
    }

    _cake(c) {
        const g = new THREE.Group();
        const flavor = WEDDING.steps[3].flavors.find((f) => f.id === c.flavor);
        g.add(mesh(new THREE.CylinderGeometry(1.4, 1.6, 2.4, 16), std(0xfff5f8), 0, 1.2, 0));
        let y = 2.4;
        const tiers = c.tiers;
        for (let i = 0; i < tiers; i++) {
            const r = 1.2 - i * (0.8 / tiers);
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
        // The slice that gets cut
        const slice = mesh(new THREE.BoxGeometry(0.4, 0.5, 0.5), std(flavor.color), 0, 2.65, 1.0);
        slice.userData.y = 2.65;
        g.add(slice);
        g.userData.slice = slice;
        // Topper
        const top = new THREE.Group();
        top.position.y = y;
        if (c.topper === 'pearl') top.add(mesh(new THREE.SphereGeometry(0.35, 16, 12), std(0xffffff, { roughness: 0.05, metalness: 0.4, emissive: 0xe0f7ff, emissiveIntensity: 0.4 }), 0, 0.35, 0));
        else if (c.topper === 'starfish') {
            const s = mesh(starGeometry(0.4, 0.1), std(0xf1c40f, { metalness: 0.8, roughness: 0.25 }), 0, 0.45, 0);
            top.add(s);
        } else if (c.topper === 'seahorses') {
            for (const sx of [-1, 1]) {
                const s = this._seahorse(sx > 0 ? 0xff9ff3 : 0x48dbfb);
                s.scale.setScalar(0.3);
                s.position.set(sx * 0.18, 0.4, 0);
                s.rotation.y = -sx * Math.PI / 2;
                top.add(s);
            }
        } else {
            for (const sx of [-1, 1]) {
                const m = buildMermaid({ ...randomLook(), hairColor: sx > 0 ? this.look.hairColor : 0x3b2416 });
                m.root.scale.setScalar(0.18);
                m.root.position.set(sx * 0.12, 0.3, 0);
                top.add(m.root);
            }
        }
        g.add(top);
        return g;
    }

    _camAt(pos, target) {
        this.camera.position.lerp(pos, 0.06);
        this._camTarget = (this._camTarget || target.clone()).lerp(target, 0.08);
        this.camera.lookAt(this._camTarget);
    }

    // ---------------------------------------------------------------------------------------------
    // Per frame
    // ---------------------------------------------------------------------------------------------
    /** Runs one frame (called instead of the game's own loop while the trip lasts). */
    frame(dt) {
        if (!this.active) return;
        dt = Math.min(0.05, dt);
        this.time += dt;
        const r = this.renderer;
        const w = r.domElement.clientWidth || window.innerWidth, h = r.domElement.clientHeight || window.innerHeight;
        if (Math.abs(this.camera.aspect - w / h) > 0.001) {
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
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
        animateMermaid(this.player.m, this.time, { swim: this.player.swim, action: this.player.action });
        if (this.audio) this.audio.update(dt);
        const exposure = r.toneMappingExposure;
        r.toneMappingExposure = 1.0;
        r.render(this.scene, this.camera);
        r.toneMappingExposure = exposure;
    }

    _updateWorld(dt) {
        const t = this.time;
        this.kelpUniform.value = t;
        this.caustics[0].offset.set(t * 0.012, t * 0.007);
        this.caustics[1].offset.set(-t * 0.009, t * 0.011);
        for (const ray of this.rays) {
            ray.rotation.z = Math.sin(t * 0.15 + ray.userData.phase) * 0.12;
            ray.material.opacity = 0.06;
        }
        // Bubbles rise and wobble, and start again at the vents
        const bp = this.bubbles.geometry.attributes.position;
        for (let i = 0; i < bp.count; i++) {
            let y = bp.getY(i) + dt * (1.2 + (i % 7) * 0.25);
            if (y > SURFACE_Y) {
                const v = this.bubbleVents[i % this.bubbleVents.length];
                bp.setXYZ(i, v[0] + between(-1, 1), floorHeight(v[0], v[1]), v[1] + between(-1, 1));
                continue;
            }
            bp.setY(i, y);
            bp.setX(i, bp.getX(i) + Math.sin(t * 2 + i) * dt * 0.3);
        }
        bp.needsUpdate = true;
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
        // Schools circle their patch of reef
        const m4 = this._m4 || (this._m4 = new THREE.Matrix4());
        const q = this._q || (this._q = new THREE.Quaternion());
        const e = this._e || (this._e = new THREE.Euler());
        const s = this._s || (this._s = new THREE.Vector3());
        for (const sc of this.schools) {
            const a = sc.ph + t * sc.speed;
            const cx = sc.cx + Math.sin(a) * sc.r, cz = sc.cz + Math.cos(a) * sc.r, cy = sc.y + Math.sin(a * 2) * 3;
            const heading = Math.atan2(Math.cos(a), -Math.sin(a)) * Math.sign(sc.speed) + (sc.speed < 0 ? Math.PI : 0);
            for (const f of sc.fish) {
                const wob = Math.sin(t * 3 + f.ph);
                this._v.set(cx + f.off.x + wob * 0.3, cy + f.off.y + Math.cos(t * 2 + f.ph) * 0.3, cz + f.off.z);
                e.set(0, heading + wob * 0.15, 0);
                q.setFromEuler(e);
                s.setScalar(f.scale);
                m4.compose(this._v, q, s);
                this.school.setMatrixAt(f.i, m4);
            }
        }
        this.school.instanceMatrix.needsUpdate = true;
        // Talking fish idle about their spot, facing you when you're near
        const pp = this.player.m.root.position;
        for (const f of this.talkers) {
            const near = pp.distanceTo(f.anchor) < 10;
            if (!near && !f.talking) {
                const a = t * 0.4 + f.ph;
                f.g.position.set(f.anchor.x + Math.sin(a) * 3, f.anchor.y + Math.sin(a * 2) * 0.6, f.anchor.z + Math.cos(a) * 3);
                f.g.rotation.y = a + Math.PI / 2;
            } else {
                f.g.rotation.y += angleDiff(f.g.rotation.y, Math.atan2(pp.x - f.g.position.x, pp.z - f.g.position.z)) * Math.min(1, dt * 3);
            }
            if (f.g.userData.tail) f.g.userData.tail.rotation.y = Math.sin(t * 6 + f.ph) * 0.4;
            f.label.position.copy(f.g.position).add(this._w.set(0, 2.2 + f.d.size, 0));
            f.label.visible = this.mode === 'explore' && pp.distanceTo(f.g.position) < 40;
        }
        this.coralie.position.y = 3.4 + Math.sin(t * 1.5) * 0.25;
        this.coralie.rotation.y = Math.sin(t * 0.5) * 0.5;
        // Friends: chatting at the plaza, or following you
        this._updateFriends(dt);
    }

    _updateFriends(dt) {
        const P = this.player;
        this.friends.forEach((f, i) => {
            if (f.wedding) {
                animateMermaid(f.m, this.time, { swim: 0, action: 'wave' });
                return;
            }
            if (this.mode === 'cutscene' && this.cut && this.tasks.mall.invited && !this.tasks.mall.ate) {
                animateMermaid(f.m, this.time, { swim: 0, action: f.action });
                return;
            }
            let target;
            if (f.following) {
                const yaw = P.yaw;
                const side = (i - 1) * 2.2;
                target = this._v.set(P.pos.x - Math.sin(yaw) * (2.6 + (i % 2)) + Math.cos(yaw) * side, P.pos.y + (i - 1) * 0.4, P.pos.z - Math.cos(yaw) * (2.6 + (i % 2)) - Math.sin(yaw) * side);
            } else {
                target = this._v.set(FRIENDS_AT.x + Math.cos(i * 2.1 + this.time * 0.2) * 2.4, FRIENDS_AT.y + Math.sin(this.time + i) * 0.3, FRIENDS_AT.z + Math.sin(i * 2.1 + this.time * 0.2) * 2.4);
            }
            const d = target.clone().sub(f.pos);
            const dist = d.length();
            const speed = Math.min(dist * 1.5, f.following ? 10 : 2);
            if (dist > 0.05) f.pos.addScaledVector(d.normalize(), speed * dt);
            f.swim += (Math.min(1, speed / 6) - f.swim) * Math.min(1, dt * 3);
            const want = dist > 0.5 ? Math.atan2(d.x, d.z) : (f.following ? P.yaw : Math.atan2(FRIENDS_AT.x - f.pos.x, FRIENDS_AT.z - f.pos.z));
            f.yaw += angleDiff(f.yaw, want) * Math.min(1, dt * 4);
            f.m.root.position.copy(f.pos);
            f.m.root.rotation.set(f.swim * 1.2, f.yaw, 0, 'YXZ');
            animateMermaid(f.m, this.time, { swim: f.swim, action: !f.following ? (Math.sin(this.time * 0.7 + i * 2) > 0.3 ? 'talk' : null) : null });
        });
    }

    _updateCreator(dt) {
        const P = this.player;
        P.swim = 0;
        P.action = Math.sin(this.time * 0.6) > 0.85 ? 'wave' : null;
        P.m.root.position.copy(VANITY);
        P.m.root.rotation.set(0, this.creatorYaw + Math.sin(this.time * 0.4) * 0.15, 0, 'YXZ');
        this.camera.position.set(VANITY.x - 0.9, VANITY.y + 0.1, VANITY.z + 4.4);
        this.camera.lookAt(VANITY.x - 0.9, VANITY.y - 0.25, VANITY.z);
    }

    _updateExplore(dt) {
        const P = this.player;
        const blocked = this.ui.modalOpen || this.ui.dialogOpen;
        const k = this.keys;
        // Arrow keys turn too (for when the mouse isn't grabbed)
        if (k.arrowleft) this.camYaw += dt * 1.8;
        if (k.arrowright) this.camYaw -= dt * 1.8;
        if (k.arrowup) this.camPitch = clamp(this.camPitch + dt * 1.2, -1.25, 1.1);
        if (k.arrowdown) this.camPitch = clamp(this.camPitch - dt * 1.2, -1.25, 1.1);
        const cy = Math.cos(this.camPitch);
        const fwd = this._w.set(Math.sin(this.camYaw) * cy, Math.sin(this.camPitch), Math.cos(this.camYaw) * cy);
        const right = new THREE.Vector3(-Math.cos(this.camYaw), 0, Math.sin(this.camYaw));
        const want = new THREE.Vector3();
        if (!blocked) {
            if (k.w) want.add(fwd);
            if (k.s) want.sub(fwd);
            if (k.d) want.add(right);
            if (k.a) want.sub(right);
            if (k[' ']) want.y += 1;
            if (k.c || k.control) want.y -= 1;
        }
        const sprint = k.shift ? 2.2 : 1;
        if (want.lengthSq() > 0) want.normalize().multiplyScalar(5.5 * sprint);
        this.vel.lerp(want, Math.min(1, dt * 2.5)); // water drag
        P.pos.addScaledVector(this.vel, dt);
        const fy = floorHeight(P.pos.x, P.pos.z) + 1.8;
        P.pos.y = clamp(P.pos.y, fy, SURFACE_Y - 3);
        const rr = Math.hypot(P.pos.x, P.pos.z);
        if (rr > WORLD_R) P.pos.multiplyScalar(WORLD_R / rr);
        // Body lies along the direction of travel
        const spd = this.vel.length();
        P.swim += (Math.min(1, spd / 6) - P.swim) * Math.min(1, dt * 3);
        if (spd > 0.3) P.yaw += angleDiff(P.yaw, Math.atan2(this.vel.x, this.vel.z)) * Math.min(1, dt * 5);
        const climb = Math.atan2(this.vel.y, Math.hypot(this.vel.x, this.vel.z) + 0.001);
        const lean = clamp(P.swim * (Math.PI / 2 - climb) * 0.85, -0.3, 1.5);
        P.m.root.position.copy(P.pos);
        P.m.root.rotation.set(lean, P.yaw, 0, 'YXZ');
        this._followCam(dt);

        // Landmarks
        for (const L of LANDMARKS) {
            if (this.tasks.explore.places.has(L.id)) continue;
            if (Math.hypot(P.pos.x - L.at[0], P.pos.z - L.at[2]) < L.radius) {
                this.tasks.explore.places.add(L.id);
                this.ui.caption(`Discovered: ${L.name}! (${this.tasks.explore.places.size}/${LANDMARKS.length})`, 3000);
                if (this.audio) this.audio.chime();
                this._refreshTasks();
            }
        }
        // What's in reach
        let best = null, bestD = Infinity;
        if (!blocked) {
            for (const it of this._interactables()) {
                const d = it.pos.distanceTo(P.pos);
                if (d < it.r && d < bestD) {
                    bestD = d;
                    best = it;
                }
            }
        }
        this._near = best;
        this.ui.setPrompt(best ? best.label : null);
        // Friends chat now and then
        if (this.tasks.mall.invited && rand() < dt * 0.04) this.ui.caption(`${pick(this.friends).look.name}: "${pick(FRIEND_LINES.idle)}"`, 2500);
    }

    _followCam(dt) {
        const P = this.player;
        const cy = Math.cos(this.camPitch);
        const fwd = this._w.set(Math.sin(this.camYaw) * cy, Math.sin(this.camPitch), Math.cos(this.camYaw) * cy);
        const target = this._v.copy(P.pos).add(new THREE.Vector3(0, 0.6, 0));
        const want = target.clone().addScaledVector(fwd, -5.2);
        want.y = Math.max(want.y, floorHeight(want.x, want.z) + 0.8);
        this.camera.position.lerp(want, Math.min(1, dt * 8));
        this.camera.lookAt(target.addScaledVector(fwd, 2));
    }
}

/** Merges geometries with the same attributes (position, normal, uv). */
function mergeGeos(list) {
    const ni = list.map((g) => (g.index ? g.toNonIndexed() : g));
    let n = 0;
    for (const g of ni) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    let o = 0;
    for (const g of ni) {
        pos.set(g.attributes.position.array, o * 3);
        nor.set(g.attributes.normal.array, o * 3);
        o += g.attributes.position.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    return out;
}

