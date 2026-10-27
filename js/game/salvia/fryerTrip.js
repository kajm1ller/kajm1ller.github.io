/**
 * js/game/salvia/fryerTrip.js
 *
 * Salvia, trip 1: you are an air fryer on a kitchen counter, for a thousand years. Third person:
 * the mouse looks round you (the wheel zooms). A family comes and goes: someone walks in, pulls
 * your basket out, tips food in, slides it home, presses start, waits at the table, comes back
 * at the ding, takes the food and eats it, leaves. Generation after generation (their clothes
 * change with the centuries), faster and faster, days flashing past the window, the kitchen
 * ageing round you (grime, cracks, vines), until nobody comes any more. Year 1000.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { box, cyl, mat, canvasTexture, Person, clamp } from './salviaKit.js';

const FRYER = new THREE.Vector3(0, 0.9, -2.12);     // where it sits on the counter
const STAND = [0, -1.45, Math.PI];                  // where people stand to use it (x, z, facing)
const DOOR = [2.75, 1.3];
const SEATS = [[-0.55, 0.8, Math.PI / 2], [0.55, 0.8, -Math.PI / 2], [0, 1.45, Math.PI]];

export class FryerTrip {
    constructor(world) {
        this.w = world;
        this.duration = 152;
        this.visit = null;
        this.visitN = 0;
        this.dayPhase = 0.3;
        this.running = 0;
        this.camDist = 1.9;
        this.people = [];
        world.yaw = 0.35;
        world.pitch = 0.32;
    }

    build() {
        const S = this.w.scene;
        S.background = new THREE.Color(0x101014);
        // ---- The kitchen ----
        const room = this.room = new THREE.Group();
        S.add(room);
        this.wallMat = new THREE.MeshStandardMaterial({ color: 0xefe3c8, roughness: 0.9 });
        const floorTex = canvasTexture(256, 256, (g, w, h) => {
            for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
                g.fillStyle = (x + y) % 2 ? '#e8e2d6' : '#3c4a5c';
                g.fillRect(x * 32, y * 32, 32, 32);
            }
        }, { repeat: [3, 3] });
        this.floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.6 });
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 5), this.floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        room.add(floor);
        const ceil = new THREE.Mesh(new THREE.PlaneGeometry(6, 5), mat(0xf4f1ea));
        ceil.rotation.x = Math.PI / 2;
        ceil.position.y = 2.8;
        room.add(ceil);
        const wall = (w, x, z, ry) => {
            const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.8), this.wallMat);
            m.position.set(x, 1.4, z);
            m.rotation.y = ry;
            m.receiveShadow = true;
            room.add(m);
            return m;
        };
        wall(6, 0, -2.5, 0);
        wall(6, 0, 2.5, Math.PI);
        wall(5, -3, 0, Math.PI / 2);
        // Right wall with a door in it
        const rw = new THREE.Group();
        rw.position.set(3, 0, 0);
        rw.rotation.y = -Math.PI / 2;
        room.add(rw);
        for (const [w, x] of [[2.95, -1.03], [1.15, 1.92]]) {
            const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.8), this.wallMat);
            m.position.set(x, 1.4, 0);
            rw.add(m);
        }
        const lintel = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7), this.wallMat);
        lintel.position.set(0.95, 2.45, 0);
        rw.add(lintel);
        box(rw, 0.06, 2.1, 0.08, 0x8d6e63, 0.5, 1.05, 0);
        box(rw, 0.06, 2.1, 0.08, 0x8d6e63, 1.4, 1.05, 0);
        // Counter along the back wall, cabinets under and over it
        const wood = 0x8a5a36, top = 0xd9d4cc;
        box(room, 4.4, 0.86, 0.62, wood, -0.8, 0.43, -2.19);
        box(room, 4.5, 0.05, 0.68, top, -0.8, 0.885, -2.16, { r: 0.3 });
        for (let i = 0; i < 7; i++) {
            const x = -2.75 + i * 0.63;
            box(room, 0.58, 0.72, 0.02, 0x9c6a42, x, 0.45, -1.875);
            box(room, 0.12, 0.02, 0.03, 0xc0c0c0, x, 0.72, -1.86, { m: 0.8, r: 0.3 });
            if (i !== 2 && i !== 3) {
                box(room, 0.58, 0.7, 0.34, 0x9c6a42, x, 2.05, -2.32);
                box(room, 0.02, 0.1, 0.03, 0xc0c0c0, x + 0.22, 1.78, -2.14, { m: 0.8, r: 0.3 });
            }
        }
        // The window over the counter (the days go by in it)
        this.skyMat = new THREE.MeshBasicMaterial({ color: 0x9ad0ff });
        const win = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.75), this.skyMat);
        win.position.set(-0.85, 1.65, -2.49);
        room.add(win);
        box(room, 1.2, 0.05, 0.08, 0xfafafa, -0.85, 1.25, -2.46);
        box(room, 1.2, 0.05, 0.08, 0xfafafa, -0.85, 2.05, -2.46);
        box(room, 0.05, 0.8, 0.08, 0xfafafa, -1.43, 1.65, -2.46);
        box(room, 0.05, 0.8, 0.08, 0xfafafa, -0.27, 1.65, -2.46);
        box(room, 0.03, 0.8, 0.06, 0xfafafa, -0.85, 1.65, -2.46);
        // Fridge, stove, sink, kettle, a plant
        box(room, 0.8, 1.9, 0.7, 0xeeeeee, 2.35, 0.95, -2.12, { r: 0.25, m: 0.3 });
        box(room, 0.03, 0.5, 0.04, 0xbdbdbd, 2.02, 1.35, -1.75, { m: 0.8 });
        box(room, 0.6, 0.02, 0.5, 0x222222, -2.2, 0.92, -2.15);
        for (const [dx, dz] of [[-0.14, -0.1], [0.14, -0.1], [-0.14, 0.12], [0.14, 0.12]]) cyl(room, 0.08, 0.08, 0.01, 0x444444, -2.2 + dx, 0.935, -2.15 + dz);
        box(room, 0.6, 0.12, 0.42, 0xb0bec5, 1.0, 0.86, -2.15, { m: 0.7, r: 0.25 });
        cyl(room, 0.015, 0.015, 0.3, 0xc0c0c0, 1.0, 1.06, -2.38, { m: 0.9 });
        cyl(room, 0.09, 0.11, 0.2, 0xd32f2f, -1.5, 1.0, -2.2);
        cyl(room, 0.08, 0.06, 0.14, 0xa1887f, 0.6, 0.98, -2.3);
        this.plant = cyl(room, 0.05, 0.03, 0.25, 0x388e3c, 0.6, 1.17, -2.3);
        // Table and chairs
        box(room, 1.3, 0.05, 0.85, 0x6d4c41, 0, 0.74, 0.95);
        for (const [x, z] of [[-0.58, 0.6], [0.58, 0.6], [-0.58, 1.3], [0.58, 1.3]]) box(room, 0.05, 0.72, 0.05, 0x5d4037, x, 0.36, z);
        for (const [x, z, ry] of SEATS) {
            const ch = new THREE.Group();
            ch.position.set(x, 0, z);
            ch.rotation.y = ry;
            box(ch, 0.42, 0.04, 0.42, 0x795548, 0, 0.46, 0);
            box(ch, 0.42, 0.5, 0.04, 0x795548, 0, 0.72, -0.2);
            room.add(ch);
        }
        // Grime, cracks and vines, for later
        this.cracks = [];
        for (let i = 0; i < 14; i++) {
            const c = box(room, 0.02, 0.3 + Math.random() * 0.6, 0.01, 0x3e2723, -2.8 + Math.random() * 5.6, 0.8 + Math.random() * 1.6, -2.49);
            c.rotation.z = (Math.random() - 0.5) * 1.6;
            c.visible = false;
            this.cracks.push(c);
        }
        this.vines = [];
        for (let i = 0; i < 8; i++) {
            const v = cyl(room, 0.02, 0.03, 1, 0x2e7d32, -1.4 + i * 0.08, 1.2, -2.45);
            v.rotation.z = (Math.random() - 0.5) * 0.9;
            v.scale.y = 0.001;
            this.vines.push(v);
        }
        // ---- You ----
        this._buildFryer(S);
        // ---- Light ----
        S.add(new THREE.HemisphereLight(0xfff4e0, 0x3a3328, 0.55));
        this.sun = new THREE.DirectionalLight(0xfff2d0, 1.2);
        this.sun.position.set(-1.5, 3.5, -5);
        this.sun.target.position.set(0, 0, 0);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(1024, 1024);
        S.add(this.sun, this.sun.target);
        this.lamp = new THREE.PointLight(0xffe2b0, 1.2, 9);
        this.lamp.position.set(0, 2.6, 0.3);
        S.add(this.lamp);
        const shade = cyl(S, 0.18, 0.3, 0.2, 0xfff3d6, 0, 2.62, 0.3, { e: 0.6 });
        shade.castShadow = false;
        // ---- Sound: the fridge humming, your fan ----
        const snd = this.w.sound;
        snd.tone(58, 0.02, 'sine');
        snd.tone(116, 0.008, 'sine');
        this.fan = snd.noise(700, 0.6, 0);
        this.fanTone = snd.tone(180, 0, 'sawtooth');
    }

    _buildFryer(S) {
        const f = this.fryer = new THREE.Group();
        f.position.copy(FRYER);
        S.add(f);
        const shell = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.25, metalness: 0.4 });
        const body = new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.36, 0.34, 4, 0.05), shell);
        body.position.y = 0.18;
        body.castShadow = true;
        f.add(body);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), shell);
        dome.scale.set(0.95, 0.25, 0.98);
        dome.position.y = 0.355;
        f.add(dome);
        // The display: a little screen that wakes up
        this.dispCanvas = document.createElement('canvas');
        this.dispCanvas.width = 128;
        this.dispCanvas.height = 64;
        this.dispTex = new THREE.CanvasTexture(this.dispCanvas);
        this.dispTex.colorSpace = THREE.SRGBColorSpace;
        const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.07), new THREE.MeshBasicMaterial({ map: this.dispTex }));
        disp.position.set(0, 0.3, 0.171);
        f.add(disp);
        this._drawDisplay(false, '');
        // Basket drawer: the front panel with a handle, the basket behind it
        const drawer = this.drawer = new THREE.Group();
        drawer.position.set(0, 0.11, 0.0);
        f.add(drawer);
        const front = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.17, 0.04, 3, 0.015), shell);
        front.position.z = 0.16;
        drawer.add(front);
        box(drawer, 0.12, 0.025, 0.05, 0x2a2a2a, 0, 0.0, 0.2, { r: 0.4 });
        const basket = new THREE.Group();
        basket.position.z = 0.02;
        drawer.add(basket);
        const metal = mat(0x6d6d6d, { m: 0.8, r: 0.35 });
        box(basket, 0.24, 0.01, 0.24, 0, 0, -0.06, 0, { material: metal });
        for (const [w, d, x, z] of [[0.24, 0.01, 0, 0.12], [0.24, 0.01, 0, -0.12], [0.01, 0.24, 0.12, 0], [0.01, 0.24, -0.12, 0]]) box(basket, w, 0.12, d, 0, x, 0, z, { material: metal });
        this.basket = basket;
        // The glow inside when it's on
        this.glow = new THREE.PointLight(0xff7a2a, 0, 1.2);
        this.glow.position.set(0, 0.2, 0.25);
        f.add(this.glow);
    }

    _drawDisplay(on, text) {
        const g = this.dispCanvas.getContext('2d');
        g.fillStyle = on ? '#071a24' : '#050505';
        g.fillRect(0, 0, 128, 64);
        if (on) {
            g.fillStyle = '#3fd0ff';
            g.font = 'bold 26px monospace';
            g.textAlign = 'center';
            g.fillText(text, 64, 42);
        }
        this.dispTex.needsUpdate = true;
    }

    /** Food for a visit: fries or nuggets in a little heap. */
    _food() {
        const g = new THREE.Group();
        const fries = Math.random() < 0.6;
        const mats = [];
        for (let i = 0; i < (fries ? 14 : 7); i++) {
            const m = new THREE.MeshStandardMaterial({ color: fries ? 0xf2d27a : 0xd9a45b, roughness: 0.7 });
            mats.push(m);
            const p = new THREE.Mesh(fries ? new THREE.BoxGeometry(0.015, 0.015, 0.09) : new THREE.SphereGeometry(0.025, 8, 6), m);
            p.position.set((Math.random() - 0.5) * 0.14, Math.random() * 0.03, (Math.random() - 0.5) * 0.14);
            p.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
            g.add(p);
        }
        g.userData.mats = mats;
        return g;
    }

    /** Who comes in, by the century. */
    _visitor(year) {
        const seed = (this.visitN * 7919 + Math.floor(year / 35) * 104729) | 0;
        let shirt = null, style = ['adult', 'student', 'worker', 'older', 'shopper'][this.visitN % 5];
        if (year > 600 && year < 850) { shirt = [0xd0d6dd, 0xe8edf2, 0xb0bec5][this.visitN % 3]; style = 'adult'; }    // silver, futuristic
        else if (year >= 850) { shirt = [0x5d4037, 0x4e342e, 0x6d6d6d][this.visitN % 3]; style = 'older'; }          // hooded robes
        else if (year > 250) shirt = [0x8e24aa, 0x00897b, 0xf4511e, 0x3949ab][this.visitN % 4];
        const p = new Person(this.w.peds, this.w.scene, seed, style, shirt);
        p.place(DOOR[0], DOOR[1], -Math.PI / 2);
        this.people.push(p);
        this.visitN++;
        return p;
    }

    update(dt, t) {
        const w = this.w;
        const year = Math.min(1000, Math.floor(1 + 999 * Math.pow(t / (this.duration - 6), 1.35)));
        w.counter(`Year ${2026 + Math.min(1000, Math.floor(1000 * Math.pow(t / (this.duration - 6), 1.35)))}`);
        const age = clamp(year / 1000, 0, 1);
        // Time speeds up: everyone moves faster, the days flash by
        const speedK = 1 + 3.5 * age * age;
        this.dayPhase += dt * (0.05 + 1.6 * age * age);
        const day = 0.5 + 0.5 * Math.sin(this.dayPhase * Math.PI * 2);
        this.skyMat.color.setRGB(0.05 + 0.55 * day, 0.07 + 0.72 * day, 0.18 + 0.82 * day);
        this.sun.intensity = 0.15 + 1.3 * day;
        this.lamp.intensity = 1.2 * (1 - day * 0.6) * (age > 0.85 ? (Math.random() < 0.08 ? 0.2 : 1) : 1);
        // The kitchen ages round you
        this.wallMat.color.setRGB(0.94 - 0.45 * age, 0.89 - 0.5 * age, 0.78 - 0.48 * age);
        this.floorMat.color.setRGB(1 - 0.55 * age, 1 - 0.58 * age, 1 - 0.6 * age);
        this.cracks.forEach((c, i) => { c.visible = age > 0.55 + i * 0.025; });
        this.vines.forEach((v, i) => { v.scale.y = Math.max(0.001, (age - 0.75 - i * 0.012) * 6); v.position.y = 1.2 + v.scale.y * 0.5; });
        this.plant.scale.y = 1 + age * 3;
        // Visits, until nobody comes any more
        if (!this.visit && year < 900) this._startVisit(year);
        if (this.visit) this._updateVisit(dt, speedK);
        for (let i = this.people.length - 1; i >= 0; i--) {
            const p = this.people[i];
            p.update(dt, speedK);
            if (p.gone && !p.moving) { p.remove(); this.people.splice(i, 1); }
        }
        // Running: glowing, humming, trembling
        this.running = Math.max(0, this.running - dt);
        const on = this.running > 0;
        this.glow.intensity = on ? 1.2 + Math.random() * 0.3 : 0;
        this.fan.gain.gain.setTargetAtTime(on ? 0.1 : 0, 0, 0.1);
        this.fanTone.gain.gain.setTargetAtTime(on ? 0.012 : 0, 0, 0.1);
        this.fryer.position.x = FRYER.x + (on ? (Math.random() - 0.5) * 0.002 : 0);
        // The camera, round you
        this.camDist = clamp(this.camDist + w.wheel * 0.002, 0.8, 4);
        const pitch = clamp(w.pitch, -0.25, 1.25);
        w.pitch = pitch;
        const tgt = new THREE.Vector3(FRYER.x, FRYER.y + 0.2, FRYER.z);
        const cam = w.camera;
        cam.position.set(
            clamp(tgt.x + Math.sin(w.yaw) * Math.cos(pitch) * this.camDist, -2.8, 2.8),
            clamp(tgt.y + Math.sin(pitch) * this.camDist, 0.3, 2.6),
            clamp(tgt.z + Math.cos(w.yaw) * Math.cos(pitch) * this.camDist, -2.35, 2.3)
        );
        cam.lookAt(tgt);
    }

    _startVisit(year) {
        const p = this._visitor(year);
        p.walkTo([DOOR[0] - 0.6, DOOR[1]], [STAND[0] + 0.3, STAND[1] + 0.4], [STAND[0], STAND[1], STAND[2]]);
        this.visit = { p, phase: 'walkIn', t: 0, food: null, seat: SEATS[this.visitN % SEATS.length], mins: 6 + (this.visitN % 9) };
    }

    _updateVisit(dt, k) {
        const V = this.visit, p = V.p, snd = this.w.sound;
        V.t += dt * k;
        const go = (phase) => { V.phase = phase; V.t = 0; };
        const dr = this.drawer;
        switch (V.phase) {
            case 'walkIn': if (!p.moving) go('open'); break;
            case 'open':
                p.reach = Math.min(1, V.t / 0.4);
                dr.position.z = 0.24 * clamp((V.t - 0.3) / 0.5, 0, 1);
                if (V.t > 0.35 && !V.clunk) { V.clunk = true; snd.burst(260, 0.25, 0.15); }
                if (V.t > 0.9) {
                    V.food = this._food();
                    p.hold(V.food);
                    go('load');
                }
                break;
            case 'load':
                if (V.t > 0.7) {
                    p.hold(null);
                    V.food.position.set(0, -0.04, 0);
                    this.basket.add(V.food);
                    go('close');
                }
                break;
            case 'close':
                dr.position.z = 0.24 * (1 - clamp(V.t / 0.4, 0, 1));
                if (V.t > 0.4) { snd.burst(220, 0.3, 0.12); go('press'); }
                break;
            case 'press':
                p.reach = 0.8 + 0.2 * Math.sin(V.t * 10);
                if (V.t > 0.5) {
                    snd.ping(2400, 0.08, 0.12);
                    this._drawDisplay(true, `400° ${V.mins}:00`);
                    this.running = 4.5 / k;
                    p.reach = 0;
                    p.walkTo([V.seat[0], V.seat[1] - 0.45], [V.seat[0], V.seat[1], V.seat[2]]);
                    go('wait');
                }
                break;
            case 'wait':
                if (!p.moving) p.pose = 'sit';
                if (this.running <= 0 && V.t > 1) {
                    snd.ping(1760, 0.22, 1.6);
                    snd.ping(2637, 0.08, 1.2);
                    this._drawDisplay(true, 'DONE');
                    for (const m of V.food.userData.mats) m.color.multiplyScalar(0.72);
                    p.pose = 'stand';
                    p.walkTo([V.seat[0], V.seat[1] - 0.45], [STAND[0], STAND[1], STAND[2]]);
                    go('fetch');
                }
                break;
            case 'fetch':
                if (!p.moving) {
                    p.reach = Math.min(1, V.t / 0.4);
                    dr.position.z = 0.24 * clamp((V.t - 0.3) / 0.5, 0, 1);
                    if (V.t > 1.0) {
                        this.basket.remove(V.food);
                        p.hold(V.food);
                        V.food.scale.setScalar(0.7);
                        go('close2');
                    }
                } else V.t = 0;
                break;
            case 'close2':
                dr.position.z = 0.24 * (1 - clamp(V.t / 0.4, 0, 1));
                if (V.t > 0.4) {
                    snd.burst(220, 0.3, 0.12);
                    this._drawDisplay(false, '');
                    p.reach = 0;
                    p.walkTo([V.seat[0], V.seat[1] - 0.45], [V.seat[0], V.seat[1], V.seat[2]]);
                    go('eat');
                }
                break;
            case 'eat':
                if (!p.moving) {
                    p.pose = 'sit';
                    if (V.t > 0.6) p.pose = 'eat';
                    if (V.t > 3.2) {
                        p.hold(null);
                        p.pose = 'stand';
                        p.walkTo([V.seat[0], V.seat[1] - 0.5], [DOOR[0] - 0.6, DOOR[1]], [DOOR[0] + 0.6, DOOR[1]]);
                        p.gone = true;
                        this.visit = null;
                    }
                } else V.t = 0;
                break;
        }
    }

    dispose() {
        for (const p of this.people) p.remove();
        this.people = [];
    }
}
