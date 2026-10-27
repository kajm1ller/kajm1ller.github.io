/**
 * js/game/salvia/salviaWorld.js
 *
 * Smoking salvia: reality peels away like a page and you are somewhere, and something, else.
 * One of three trips (never the same twice running):
 *   fryer  - you are an air fryer on a kitchen counter for a thousand years; generations of a family
 *            open you, fill you, run you and eat what comes out (third person, you can look around)
 *   planet - you wander a red alien planet (first person, walk about)
 *   bread  - you are a loaf in a bread factory, from flour in the mixer to a shelf in a store
 *            (first person, carried along the line; you can look about)
 * Like Mermaid World it has its own scene, camera, input and sound, and the real world waits while
 * it runs (game.html calls frame() instead of its own loop). It peels in, runs the trip's
 * `duration`, peels out and calls onExit.
 *
 *   enter(kind?)   start (kind: 'fryer' | 'planet' | 'bread', else picked)
 *   frame(dt)      update and draw
 *   finish()       skip to the end of the trip (debug)
 */

import * as THREE from 'three';
import { TripSound } from './salviaKit.js';
import { FryerTrip } from './fryerTrip.js';
import { PlanetTrip } from './planetTrip.js';
import { BreadTrip } from './breadTrip.js';

export const SALVIA_TRIPS = ['fryer', 'planet', 'bread'];
const TRIPS = { fryer: FryerTrip, planet: PlanetTrip, bread: BreadTrip };
const PEEL_IN = 1.8, PEEL_OUT = 2.2;

export class SalviaWorld {
    /**
     * @param {Object} o
     * @param {THREE.WebGLRenderer} o.renderer
     * @param {() => Object} o.getPeds the game's PedestrianSystem (people rigs and their part geometries)
     * @param {() => AudioContext|null} o.getAudioContext
     * @param {(kind: string) => void} o.onExit
     */
    constructor({ renderer, getPeds, getAudioContext, onExit }) {
        this.renderer = renderer;
        this.getPeds = getPeds;
        this.getAudioContext = getAudioContext;
        this.onExit = onExit;
        this.active = false;
        this.last = null;
        this.kind = null;
        this.trip = null;
        this.time = 0;
        this.keys = {};
        this.yaw = 0;
        this.pitch = 0;
        this.wheel = 0;
        this._h = null;
        this.ui = null;
    }

    get peds() {
        return this.getPeds();
    }

    pickTrip() {
        const opts = SALVIA_TRIPS.filter((k) => k !== this.last);
        return opts[Math.floor(Math.random() * opts.length)];
    }

    enter(kind = null) {
        if (this.active) return;
        kind = TRIPS[kind] ? kind : this.pickTrip();
        this.last = this.kind = kind;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(70, 1, 0.02, 3000);
        this.time = 0;
        this.keys = {};
        this.yaw = 0;
        this.pitch = 0;
        this.wheel = 0;
        this.sound = new TripSound(this.getAudioContext ? this.getAudioContext() : null);
        this._buildUi();
        try {
            this.trip = new TRIPS[kind](this);
            this.trip.build();
        } catch (err) {
            console.error('[Salvia] could not start the trip:', err);
            this._exit();
            return;
        }
        this.active = true;
        this._bindInput();
        this._peel(90);
    }

    /** Debug: straight to the end (it still peels out). */
    finish() {
        if (this.trip) this.time = Math.max(this.time, this.trip.duration);
    }

    /** Big text at the top (the air fryer's years). */
    counter(text) {
        if (this.ui) this.ui.top.textContent = text || '';
    }

    frame(dt) {
        if (!this.active) return;
        dt = Math.min(0.05, Math.max(0, dt));
        this.time += dt;
        const r = this.renderer;
        const w = r.domElement.clientWidth || window.innerWidth, h = r.domElement.clientHeight || window.innerHeight;
        if (Math.abs(this.camera.aspect - w / h) > 0.001) {
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
        }
        const T = this.trip;
        T.update(dt, Math.min(this.time, T.duration));
        this.wheel = 0;
        // Peeling in from the edge of the screen, and away again at the end
        const t = this.time;
        if (t < PEEL_IN) this._peel(90 * Math.pow(1 - t / PEEL_IN, 2));
        else if (t > T.duration) {
            const k = (t - T.duration) / PEEL_OUT;
            this._peel(-95 * k * k);
            if (k >= 1) {
                this._exit();
                return;
            }
        } else this._peel(0);
        r.render(this.scene, this.camera);
    }

    // The page turn: the picture folds away about its left edge
    _peel(deg) {
        const c = this.renderer.domElement;
        if (Math.abs(deg) < 0.01) {
            if (c.style.transform) c.style.transform = '';
            return;
        }
        c.style.transformOrigin = deg > 0 ? 'right center' : 'left center';
        c.style.transform = `perspective(1100px) rotateY(${deg.toFixed(2)}deg)`;
    }

    _buildUi() {
        const root = document.createElement('div');
        root.id = 'salvia-ui';
        root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:900;font-family:Georgia,serif;color:#fff;text-shadow:0 2px 8px #000,0 0 2px #000';
        const top = document.createElement('div');
        top.style.cssText = 'position:absolute;top:5vh;left:0;right:0;text-align:center;font-size:clamp(22px,4vw,44px);letter-spacing:0.08em';
        root.append(top);
        document.body.appendChild(root);
        document.body.classList.add('salvia-trip');
        this.ui = { root, top };
    }

    _bindInput() {
        const canvas = this.renderer.domElement;
        this._h = {
            keydown: (e) => {
                e.stopImmediatePropagation();
                const k = e.key.toLowerCase();
                if (k === ' ' || k.startsWith('arrow') || k === 'tab') e.preventDefault();
                this.keys[k] = true;
            },
            keyup: (e) => {
                e.stopImmediatePropagation();
                this.keys[e.key.toLowerCase()] = false;
            },
            mousemove: (e) => {
                e.stopImmediatePropagation();
                if (document.pointerLockElement !== canvas) return;
                this.yaw -= e.movementX * 0.0025;
                this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - e.movementY * 0.0022));
            },
            mousedown: (e) => e.stopImmediatePropagation(),
            mouseup: (e) => e.stopImmediatePropagation(),
            click: (e) => {
                e.stopImmediatePropagation();
                if (document.pointerLockElement !== canvas) { try { canvas.requestPointerLock(); } catch (err) { /* headless */ } }
            },
            wheel: (e) => {
                e.stopImmediatePropagation();
                e.preventDefault();
                this.wheel += e.deltaY;
            },
            contextmenu: (e) => { e.stopImmediatePropagation(); e.preventDefault(); }
        };
        for (const [k, fn] of Object.entries(this._h)) window.addEventListener(k, fn, { capture: true, passive: !['wheel', 'contextmenu', 'keydown'].includes(k) });
    }

    _exit() {
        this.active = false;
        if (this._h) for (const [k, fn] of Object.entries(this._h)) window.removeEventListener(k, fn, { capture: true });
        this._h = null;
        this.keys = {};
        this._peel(0);
        if (this.sound) this.sound.stop();
        if (this.trip && this.trip.dispose) this.trip.dispose();
        if (this.scene) {
            this.scene.traverse((o) => { if (o.isMesh || o.isPoints) { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); } });
        }
        this.trip = null;
        this.scene = null;
        if (this.ui) this.ui.root.remove();
        this.ui = null;
        document.body.classList.remove('salvia-trip');
        if (this.onExit) this.onExit(this.kind);
    }
}
