/**
 * js/game/salvia/breadTrip.js
 *
 * Salvia, trip 3: you are a loaf of bread (first person, carried along; the mouse looks about).
 * Flour in a steel mixing bowl, the hook churning over you; dropped onto the line as dough among
 * the other dough balls; rising in the warm proofing tunnel; the oven, glowing and roaring, everyone
 * going golden; the slicer's blades sawing through; wrapped in a printed bag; dropped in a crate;
 * the truck's doors slam and it's a dark rumbling ride; the doors open on a supermarket aisle and
 * you're put on the shelf, where a shopper reaches for you.
 *
 * The line runs down -z. STAGES are the timeline; camAt() is where you are along it.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { box, cyl, mat, canvasTexture, Person, clamp, lerp } from './salviaKit.js';

const BELT_Y = 0.9;
const EYE = BELT_Y + 0.2;                 // a loaf's eye view off the belt
const STORE = new THREE.Vector3(300, 0, 0);
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const span = (t, a, b) => clamp((t - a) / (b - a), 0, 1);

export class BreadTrip {
    constructor(world) {
        this.w = world;
        this.duration = 146;
        this.friends = [];
        this._clank = 0;
        this._note = 0;
        this.sliced = false;
        world.yaw = 0;
        world.pitch = 0;
    }

    build() {
        const S = this.w.scene;
        S.background = new THREE.Color(0x1a1c20);
        S.fog = new THREE.Fog(0x1a1c20, 20, 90);
        const steel = mat(0xb0b8c0, { m: 0.85, r: 0.3 });
        const dark = mat(0x2e3238, { m: 0.5, r: 0.6 });
        // ---- The hall ----
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 160), mat(0x5a5d62, { r: 0.9 }));
        floor.rotation.x = -Math.PI / 2;
        floor.position.z = -50;
        floor.receiveShadow = true;
        S.add(floor);
        for (const x of [-10, 10]) {
            const wall = new THREE.Mesh(new THREE.PlaneGeometry(160, 12), mat(0xd8d2c4, { r: 0.95 }));
            wall.position.set(x, 6, -50);
            wall.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
            S.add(wall);
        }
        for (let z = 8; z > -130; z -= 8) {
            box(S, 20, 0.4, 0.3, 0x455a64, 0, 9, z, { noShadow: true });
            const lamp = box(S, 1.6, 0.08, 0.3, 0xffffff, 0, 8.4, z - 4, { e: 2, noShadow: true });
            lamp.material = mat(0xffffff, { e: 2 });
        }
        // ---- The conveyor ----
        this.beltTex = canvasTexture(64, 256, (g, w, h) => {
            g.fillStyle = '#2a2c30';
            g.fillRect(0, 0, w, h);
            g.fillStyle = '#3a3d42';
            for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 6);
        }, { repeat: [1, 40] });
        const belt = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 110), new THREE.MeshStandardMaterial({ map: this.beltTex, roughness: 0.8 }));
        belt.rotation.x = -Math.PI / 2;
        belt.position.set(0, BELT_Y, -45);
        S.add(belt);
        box(S, 0.1, 0.25, 110, 0x90a4ae, -0.65, BELT_Y - 0.05, -45, { material: steel });
        box(S, 0.1, 0.25, 110, 0x90a4ae, 0.65, BELT_Y - 0.05, -45, { material: steel });
        for (let z = 8; z > -100; z -= 3) {
            box(S, 0.08, BELT_Y, 0.08, 0, -0.6, BELT_Y / 2, z, { material: dark });
            box(S, 0.08, BELT_Y, 0.08, 0, 0.6, BELT_Y / 2, z, { material: dark });
        }
        // ---- The mixer: a big steel bowl up at the start, the hook in it ----
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.3, 1.5, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0xc8d0d8, metalness: 0.9, roughness: 0.25, side: THREE.DoubleSide }));
        bowl.position.set(0, 3.2, 6);
        S.add(bowl);
        const bottom = new THREE.Mesh(new THREE.CircleGeometry(1.3, 40), new THREE.MeshStandardMaterial({ color: 0xb0b8c0, metalness: 0.9, roughness: 0.3 }));
        bottom.rotation.x = -Math.PI / 2;
        bottom.position.set(0, 2.46, 6);
        S.add(bottom);
        const hookPts = [];
        for (let i = 0; i <= 40; i++) { const a = i / 40; hookPts.push(new THREE.Vector3(Math.cos(a * 9) * 0.5 * a, 1.6 - a * 1.5, Math.sin(a * 9) * 0.5 * a)); }
        this.hook = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hookPts), 80, 0.07, 8), steel);
        this.hook.position.set(0, 2.5, 6);
        S.add(this.hook);
        box(S, 0.5, 3, 0.5, 0, 0, 5.6, 6, { material: dark });
        this.doughMass = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), mat(0xf1e4c4, { r: 0.9 }));
        this.doughMass.position.set(0, 2.5, 6);
        this.doughMass.scale.set(1.2, 0.05, 1.2);
        S.add(this.doughMass);
        const FN = 2500;
        const fp = new Float32Array(FN * 3);
        this.flourData = [];
        for (let i = 0; i < FN; i++) this.flourData.push({ a: Math.random() * 6.28, r: Math.random() * 1.5, y: Math.random() * 1.4, s: 0.5 + Math.random() * 1.5 });
        const fg = new THREE.BufferGeometry();
        fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
        // (soft round specks, not squares)
        const speck = canvasTexture(32, 32, (gx, w, h) => {
            const grd = gx.createRadialGradient(16, 16, 0, 16, 16, 16);
            grd.addColorStop(0, 'rgba(255,255,255,1)');
            grd.addColorStop(1, 'rgba(255,255,255,0)');
            gx.fillStyle = grd;
            gx.fillRect(0, 0, w, h);
        });
        this.flour = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xffffff, map: speck, size: 0.012, transparent: true, opacity: 0.85, depthWrite: false }));
        this.flour.position.set(0, 2.5, 6);
        S.add(this.flour);
        // ---- Proofing tunnel, the oven, the slicer, the bagger ----
        const tunnel = (z0, z1, color, inside) => {
            const len = z0 - z1, zc = (z0 + z1) / 2;
            box(S, 2.4, 0.15, len, 0, 0, BELT_Y + 1.3, zc, { material: mat(color, { m: 0.6, r: 0.4 }) });
            box(S, 0.15, 1.45, len, 0, -1.2, BELT_Y + 0.6, zc, { material: mat(color, { m: 0.6, r: 0.4 }) });
            box(S, 0.15, 1.45, len, 0, 1.2, BELT_Y + 0.6, zc, { material: mat(color, { m: 0.6, r: 0.4 }) });
            const l = new THREE.PointLight(inside, 0, 14);
            l.position.set(0, BELT_Y + 1, zc);
            S.add(l);
            return l;
        };
        this.proofLight = tunnel(-8, -24, 0x9e9e9e, 0xffc070);
        this.ovenLight = tunnel(-28, -60, 0x5d4037, 0xff5a10);
        this.ovenLight.distance = 40;
        for (let z = -30; z > -60; z -= 1.5) {
            const el = box(S, 2.2, 0.04, 0.05, 0, 0, BELT_Y + 1.15, z, { material: mat(0xff3d00, { e: 2.5 }), noShadow: true });
            el.castShadow = false;
        }
        box(S, 2.6, 2.2, 0.3, 0, 0, BELT_Y + 0.4, -27.8, { material: mat(0x4e342e, { m: 0.5 }) }).scale.set(1, 1, 1);
        this.blades = [];
        const frame = new THREE.Group();
        frame.position.set(0, 0, -78);
        S.add(frame);
        box(frame, 2.4, 0.3, 0.6, 0, 0, BELT_Y + 1.5, 0, { material: dark });
        box(frame, 0.2, 1.6, 0.6, 0, -1.2, BELT_Y + 0.7, 0, { material: dark });
        box(frame, 0.2, 1.6, 0.6, 0, 1.2, BELT_Y + 0.7, 0, { material: dark });
        for (let i = 0; i < 22; i++) {
            const b = box(frame, 0.004, 0.9, 0.5, 0, -0.55 + i * 0.05, BELT_Y + 0.7, 0, { material: mat(0xe0e6ea, { m: 1, r: 0.15 }), noShadow: true });
            b.rotation.y = Math.PI / 2;
            this.blades.push(b);
        }
        box(S, 2.6, 2.4, 2, 0, 0, BELT_Y + 0.6, -86, { material: mat(0x1e88e5, { m: 0.3, r: 0.5 }) }).scale.set(1, 1, 0.2);
        // ---- The crates and the truck ----
        const crateMat = mat(0xc62828, { r: 0.7 });
        for (let i = 0; i < 6; i++) box(S, 0.8, 0.35, 0.6, 0, 0, 0.18 + (i % 3) * 0.36, -96 - Math.floor(i / 3) * 0.7, { material: crateMat });
        this.crate = new THREE.Group();
        box(this.crate, 0.8, 0.04, 0.6, 0, 0, 0, 0, { material: crateMat });
        for (const [w, d, x, z] of [[0.8, 0.04, 0, 0.3], [0.8, 0.04, 0, -0.3], [0.04, 0.6, 0.4, 0], [0.04, 0.6, -0.4, 0]]) box(this.crate, w, 0.35, d, 0, x, 0.17, z, { material: crateMat });
        this.crate.position.set(0, 0.6, -94);
        S.add(this.crate);
        const truck = this.truck = new THREE.Group();
        truck.position.set(6, 0, -94);
        S.add(truck);
        box(truck, 2.6, 2.8, 6, 0, 0, 1.9, 0, { material: mat(0xf5f5f5, { r: 0.6 }) });
        box(truck, 2.4, 2.4, 2, 0, 0, 1.6, 4, { material: mat(0x1565c0, { r: 0.5 }) });
        const sideTex = canvasTexture(512, 256, (g, w, h) => {
            g.fillStyle = '#f5f5f5'; g.fillRect(0, 0, w, h);
            g.fillStyle = '#c62828'; g.font = 'bold 84px Georgia'; g.textAlign = 'center'; g.fillText("KAJ'S BREAD", w / 2, 130);
            g.fillStyle = '#6d4c41'; g.font = 'italic 40px Georgia'; g.fillText('baked fresh daily', w / 2, 200);
        });
        const side = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.6), new THREE.MeshBasicMaterial({ map: sideTex }));
        side.position.set(-1.31, 1.9, 0);
        side.rotation.y = -Math.PI / 2;
        truck.add(side);
        this.doorL = box(truck, 1.3, 2.8, 0.05, 0, -0.65, 1.9, -3, { material: mat(0xe0e0e0) });
        this.doorR = box(truck, 1.3, 2.8, 0.05, 0, 0.65, 1.9, -3, { material: mat(0xe0e0e0) });
        // ---- The store, far off ----
        const st = this.store = new THREE.Group();
        st.position.copy(STORE);
        S.add(st);
        const sFloor = new THREE.Mesh(new THREE.PlaneGeometry(30, 40), mat(0xeeeeee, { r: 0.4 }));
        sFloor.rotation.x = -Math.PI / 2;
        st.add(sFloor);
        const bagTex = this._bagTexture();
        const loafGeo = new RoundedBoxGeometry(0.3, 0.2, 0.42, 3, 0.06);
        for (const sx of [-1.6, 1.6]) {
            for (let lvl = 0; lvl < 4; lvl++) {
                box(st, 0.6, 0.04, 14, 0, sx, 0.3 + lvl * 0.5, 0, { material: mat(0xfafafa, { r: 0.5 }) });
                for (let i = 0; i < 26; i++) {
                    const l = new THREE.Mesh(loafGeo, new THREE.MeshStandardMaterial({ map: bagTex, transparent: true, opacity: 0.95, roughness: 0.3 }));
                    l.position.set(sx, 0.43 + lvl * 0.5, -6.5 + i * 0.5);
                    l.rotation.y = Math.PI / 2;
                    st.add(l);
                }
            }
            box(st, 0.1, 2.2, 14, 0, sx + (sx > 0 ? 0.32 : -0.32), 1.1, 0, { material: mat(0xe0e0e0) });
        }
        for (let z = -6; z <= 6; z += 3) box(st, 0.25, 0.05, 2.2, 0, 0, 3.4, z, { material: mat(0xffffff, { e: 2.2 }), noShadow: true });
        const storeLight = new THREE.PointLight(0xf4f8ff, 2.2, 25);
        storeLight.position.set(0, 3.2, 0);
        st.add(storeLight);
        this.shopper = new Person(this.w.peds, S, 4711, 'shopper', 0x43a047);
        this.shopper.place(STORE.x - 0.3, STORE.z + 7, Math.PI);
        // ---- Your fellow loaves, along the line with you ----
        for (let i = 0; i < 6; i++) {
            const g = new THREE.Group();
            const dough = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), new THREE.MeshStandardMaterial({ color: 0xf1e4c4, roughness: 0.85 }));
            dough.scale.y = 0.6;
            const loaf = new THREE.Mesh(loafGeo, new THREE.MeshStandardMaterial({ color: 0xf1e4c4, roughness: 0.8 }));
            loaf.visible = false;
            const bag = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.24, 0.48, 3, 0.07), new THREE.MeshStandardMaterial({ map: bagTex, transparent: true, opacity: 0.55, roughness: 0.2, depthWrite: false }));
            bag.visible = false;
            g.add(dough, loaf, bag);
            g.userData = { dough, loaf, bag, off: (i < 3 ? -1 : 1) * (1.0 + (i % 3) * 0.9) };
            S.add(g);
            this.friends.push(g);
        }
        // Your own bag (around the camera once you're bagged)
        this.myBag = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, side: THREE.BackSide, depthWrite: false, roughness: 0.15 }));
        this.myBag.visible = false;
        S.add(this.myBag);
        // ---- Light ----
        S.add(new THREE.HemisphereLight(0xf0f4ff, 0x404040, 0.7));
        const key = new THREE.DirectionalLight(0xffffff, 0.6);
        key.position.set(5, 10, 5);
        S.add(key);
        // ---- Sound: the factory ----
        const snd = this.w.sound;
        this.hum = snd.noise(220, 0.7, 0.06);
        this.motor = snd.tone(95, 0.03, 'sawtooth');
        this.roar = snd.noise(160, 0.5, 0);
        this.saw = snd.tone(320, 0, 'sawtooth');
        this.rumble = snd.noise(70, 0.8, 0);
    }

    _bagTexture() {
        return canvasTexture(256, 256, (g, w, h) => {
            g.fillStyle = 'rgba(255,255,255,0.15)';
            g.fillRect(0, 0, w, h);
            g.fillStyle = 'rgba(255,255,255,0.85)';
            g.fillRect(20, 70, w - 40, 116);
            g.fillStyle = '#c62828';
            g.font = 'bold 34px Georgia';
            g.textAlign = 'center';
            g.fillText("KAJ'S BEST", w / 2, 118);
            g.fillStyle = '#6d4c41';
            g.font = '24px Georgia';
            g.fillText('white bread', w / 2, 160);
            g.fillStyle = 'rgba(255,200,40,0.9)';
            for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(40 + i * 35, 40, 8, 0, 6.3); g.fill(); }
        });
    }

    /** Where you are and which way the line faces at time t: { p, yaw, pitch, roll } */
    camAt(t) {
        const p = new THREE.Vector3();
        let yaw = 0, pitch = 0, roll = 0;
        if (t < 22) {
            // Mixed: round and round the bowl, tumbling
            const a = t * (0.9 + t * 0.06);
            p.set(Math.cos(a) * 0.7, 2.7 + 0.25 * Math.sin(t * 2.3), 6 + Math.sin(a) * 0.7);
            yaw = -a + Math.PI;
            pitch = 0.25 + 0.2 * Math.sin(t * 1.7);
            roll = Math.sin(t * 1.3) * 0.5;
        } else if (t < 28) {
            // Dropped out onto the line
            const k = smooth(span(t, 22, 28));
            p.set(0, lerp(2.7, EYE, k) + Math.sin(k * Math.PI) * 0.6, lerp(6, 1, k));
            pitch = lerp(-0.6, 0, k);
            roll = (1 - k) * 0.6;
        } else if (t < 94) {
            // Along the line: the proofing tunnel, the oven, cooling, the slicer, the bagger
            const z = t < 46 ? lerp(1, -26, span(t, 28, 46)) : t < 74 ? lerp(-26, -64, span(t, 46, 74)) : lerp(-64, -91, span(t, 74, 94));
            const rise = t < 46 ? 0.15 * span(t, 30, 46) : 0.15;
            p.set(0, EYE + rise, z);
            if (t > 46 && t < 74) { roll = Math.sin(t * 7) * 0.01; pitch = Math.sin(t * 5.3) * 0.01; }
        } else if (t < 102) {
            // Off the end into a crate, and the crate into the truck
            const k = span(t, 94, 98), k2 = smooth(span(t, 98, 102));
            p.set(lerp(0, 6, k2), lerp(EYE + 0.15, 0.85, smooth(k)) + 0.4 * k2, lerp(-91, -94, k) - 2 * k2);
            yaw = -k2 * Math.PI / 2;
            roll = Math.sin(k * Math.PI) * 0.3;
        } else if (t < 118) {
            // In the dark of the truck
            p.set(6, 1.25, -96);
            yaw = -Math.PI / 2;
            roll = Math.sin(t * 9) * 0.01;
        } else {
            // The store: carried down the aisle and put on the shelf
            const k = smooth(span(t, 118, 126));
            p.set(STORE.x + lerp(0, 1.25, k), lerp(1.2, 1.45, k), STORE.z + lerp(6, 0, k));
            yaw = (Math.PI / 2) * k;        // turned to face out into the aisle from the shelf
            pitch = -0.05;
        }
        return { p, yaw, pitch, roll };
    }

    update(dt, t) {
        const w = this.w, snd = w.sound;
        const C = this.camAt(t);
        const cam = w.camera;
        // You can look about a little (you're bread)
        w.yaw = clamp(w.yaw, -1.4, 1.4);
        w.pitch = clamp(w.pitch, -0.9, 0.9);
        cam.rotation.order = 'YXZ';
        cam.rotation.set(C.pitch + w.pitch, C.yaw + w.yaw, C.roll);
        cam.position.copy(C.p);
        cam.fov = t > 46 && t < 74 ? 74 + Math.sin(t * 3) * 2 : (t < 22 ? 85 : 72);
        cam.updateProjectionMatrix();
        // ---- The mixer ----
        this.hook.rotation.y += dt * 3.2;
        this.doughMass.scale.set(1.2, 0.05 + 0.35 * span(t, 4, 20), 1.2);
        const fpos = this.flour.geometry.attributes.position;
        const fly = 1 - span(t, 16, 22);
        this.flourData.forEach((d, i) => {
            d.a += dt * d.s * 1.6;
            fpos.setXYZ(i, Math.cos(d.a) * d.r, d.y + Math.sin(t * 2 + i) * 0.15 * fly, Math.sin(d.a) * d.r);
        });
        fpos.needsUpdate = true;
        this.flour.material.opacity = 0.85 * fly;
        // ---- The belt and your fellow loaves ----
        this.beltTex.offset.y = (this.beltTex.offset.y + dt * (t > 28 && t < 94 ? 1.8 : 0)) % 1;
        const onLine = t > 26 && t < 95;
        const rise = 1 + 0.6 * span(t, 30, 46);
        const bake = span(t, 50, 70);
        const doughCol = new THREE.Color(0xf1e4c4).lerp(new THREE.Color(0xa0622d), bake);
        this.friends.forEach((g, i) => {
            const u = g.userData;
            g.visible = onLine;
            g.position.set(0, BELT_Y + 0.08, C.p.z + u.off * (t > 94 ? 3 : 1));
            const loafNow = t > 46;
            u.dough.visible = !loafNow;
            u.loaf.visible = loafNow;
            u.dough.scale.set(rise, 0.6 * rise, rise);
            u.loaf.position.y = 0.04;
            u.loaf.material.color.copy(doughCol);
            u.bag.visible = t > 86;
            u.bag.position.y = 0.04;
        });
        // ---- The proofing tunnel and the oven ----
        const inProof = t > 30 && t < 46, inOven = t > 48 && t < 72;
        this.proofLight.intensity = inProof ? 2.5 : 0;
        this.ovenLight.intensity = inOven ? 6 + Math.random() * 1.5 : 0;
        this.roar.gain.gain.setTargetAtTime(inOven ? 0.18 : 0, 0, 0.6);
        // ---- The slicer ----
        this.blades.forEach((b, i) => { b.position.y = BELT_Y + 0.7 + Math.sin(t * 22 + i) * 0.08; });
        const nearSaw = clamp(1 - Math.abs(C.p.z + 78) / 10, 0, 1);
        this.saw.gain.gain.setTargetAtTime(nearSaw * 0.05, 0, 0.1);
        if (!this.sliced && C.p.z < -78) {
            this.sliced = true;
            snd.burst(3000, 0.4, 0.4);
            this._flash = 0.5;
        }
        // ---- Bagged ----
        const bagged = t > 86 && t < 140;
        this.myBag.visible = bagged;
        if (bagged) this.myBag.position.copy(cam.position);
        if (t > 86 && !this._crinkle) { this._crinkle = true; for (let i = 0; i < 6; i++) setTimeout(() => snd.burst(4500, 0.12, 0.12, 'highpass'), i * 90); }
        // ---- Crate, truck, doors ----
        if (t > 98 && t < 118) this.crate.position.set(C.p.x, C.p.y - 0.4, C.p.z);
        const doorsShut = t > 102.5 && t < 117.5;
        const dk = doorsShut ? 1 : 0;
        this.doorL.rotation.y = lerp(this.doorL.rotation.y, (1 - dk) * -1.6, dt * 6);
        this.doorR.rotation.y = lerp(this.doorR.rotation.y, (1 - dk) * 1.6, dt * 6);
        if (doorsShut && !this._slam) { this._slam = true; snd.burst(120, 0.6, 0.5, 'lowpass'); }
        this.rumble.gain.gain.setTargetAtTime(doorsShut ? 0.25 : 0, 0, 0.4);
        if (doorsShut) {
            cam.position.y += (Math.random() - 0.5) * 0.015 + Math.max(0, Math.sin(t * 2.7)) ** 20 * 0.05;
            w.scene.background.setRGB(0.01, 0.01, 0.012);
        }
        // Dark inside the truck: everything but a crack of light
        w.scene.fog.near = doorsShut ? 0.5 : 20;
        w.scene.fog.far = doorsShut ? 3 : 90;
        w.scene.fog.color.setHex(doorsShut ? 0x020202 : (t > 118 ? 0xf4f6f8 : 0x1a1c20));
        if (t > 118) { w.scene.fog.near = 30; w.scene.fog.far = 120; w.scene.background.setHex(0xf4f6f8); }
        this.hum.gain.gain.setTargetAtTime(t < 102 ? 0.06 : 0, 0, 0.5);
        this.motor.gain.gain.setTargetAtTime(t < 22 ? 0.04 : 0.01 * (t < 102 ? 1 : 0), 0, 0.5);
        // Clanks along the line; muzak in the store
        this._clank -= dt;
        if (t > 28 && t < 94 && this._clank <= 0) { this._clank = 0.9; snd.burst(900 + Math.random() * 400, 0.06, 0.08); }
        if (t > 118) {
            this._note -= dt;
            if (this._note <= 0) {
                this._note = 0.45;
                const scale = [523, 659, 784, 659, 587, 698, 880, 698];
                snd.ping(scale[Math.floor(t / 0.45) % scale.length], 0.04, 0.6, 'triangle');
            }
        }
        // ---- The shopper: down the aisle, reaching for you ----
        if (t > 126) {
            const sp = this.shopper;
            if (!this._shopWalk) { this._shopWalk = true; sp.walkTo([STORE.x + 0.55, STORE.z + 0.6], [STORE.x + 0.55, STORE.z + 0.05, Math.PI / 2]); }
            if (!sp.moving && t > 136) sp.reach = Math.min(1, (t - 136) / 2);
            sp.update(dt);
        }
        if (this._flash > 0) {
            this._flash -= dt;
            w.scene.background.setRGB(1, 1, 1);
            cam.rotation.z += (Math.random() - 0.5) * 0.2;
        } else if (t < 102) w.scene.background.setHex(0x1a1c20);
    }

    dispose() {
        this.shopper.remove();
    }
}
