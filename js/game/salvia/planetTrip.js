/**
 * js/game/salvia/planetTrip.js
 *
 * Salvia, trip 2: you are wandering a red alien planet (first person: WASD and the mouse, Shift to
 * hurry, Space for a long low-gravity jump). Rust-red dunes and ridges under a maroon sky, a ringed
 * giant and two moons hanging over the horizon, a swollen red sun; rock spires, floating stones,
 * crystals that glow, stalks with lit bulbs swaying, dust blowing. Tall dark figures stand far off,
 * watching, and are gone when you get near.
 */

import * as THREE from 'three';
import { mat, fbm, noise2, canvasTexture, Person, clamp } from './salviaKit.js';

const SIZE = 700;

/** The ground's height at (x, z). */
export function planetHeight(x, z) {
    const ridge = 1 - Math.abs(noise2(x * 0.018 + 3.1, z * 0.018 - 7.2));
    return fbm(x * 0.006, z * 0.006, 5) * 34 + ridge * ridge * 7 + fbm(x * 0.05, z * 0.05, 2) * 1.2;
}

export class PlanetTrip {
    constructor(world) {
        this.w = world;
        this.duration = 124;
        this.pos = new THREE.Vector3(0, 0, 0);
        this.vy = 0;
        this.air = 0;
        this.phase = 0;
        this.figures = [];
        world.yaw = 0;
        world.pitch = 0.05;
    }

    build() {
        const S = this.w.scene;
        const sky = 0x5a1408;
        S.background = new THREE.Color(sky);
        S.fog = new THREE.FogExp2(0x8c2b12, 0.0065);
        // ---- The ground ----
        const g = new THREE.PlaneGeometry(SIZE, SIZE, 220, 220);
        g.rotateX(-Math.PI / 2);
        const pos = g.attributes.position;
        const col = new Float32Array(pos.count * 3);
        const c = new THREE.Color();
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), z = pos.getZ(i);
            const h = planetHeight(x, z);
            pos.setY(i, h);
            const k = clamp((h + 18) / 50, 0, 1);
            c.setRGB(0.42 + 0.35 * k, 0.1 + 0.12 * k, 0.05 + 0.04 * k);
            c.multiplyScalar(0.8 + 0.3 * (0.5 + 0.5 * noise2(x * 0.3, z * 0.3)));
            col.set([c.r, c.g, c.b], i * 3);
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.computeVertexNormals();
        const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
        ground.receiveShadow = true;
        S.add(ground);
        // ---- The sky: a gradient dome, a red sun, a ringed giant and two moons ----
        const dome = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 16), new THREE.ShaderMaterial({
            side: THREE.BackSide, depthWrite: false, fog: false,
            uniforms: { uTime: { value: 0 } },
            vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentShader: `varying vec3 vP; uniform float uTime;
                float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
                void main(){
                    float y = vP.y;
                    vec3 c = mix(vec3(0.95, 0.38, 0.14), vec3(0.32, 0.04, 0.08), smoothstep(-0.05, 0.55, y));
                    c = mix(c, vec3(0.08, 0.0, 0.06), smoothstep(0.5, 1.0, y));
                    float st = step(0.9975, h(floor(vP * 400.0))) * smoothstep(0.25, 0.7, y);
                    c += vec3(1.0, 0.85, 0.8) * st * (0.6 + 0.4 * sin(uTime * 3.0 + h(floor(vP * 400.0)) * 50.0));
                    gl_FragColor = vec4(c, 1.0);
                }`
        }));
        dome.renderOrder = -1;
        this.dome = dome;
        S.add(dome);
        const sun = new THREE.Mesh(new THREE.CircleGeometry(60, 40), new THREE.MeshBasicMaterial({ color: 0xff5a20, fog: false }));
        sun.position.set(-500, 120, -800);
        sun.lookAt(0, 0, 0);
        S.add(sun);
        const halo = new THREE.Mesh(new THREE.CircleGeometry(130, 40), new THREE.MeshBasicMaterial({ color: 0xff7a30, transparent: true, opacity: 0.25, fog: false, depthWrite: false }));
        halo.position.copy(sun.position).multiplyScalar(1.01);
        halo.lookAt(0, 0, 0);
        S.add(halo);
        const bands = canvasTexture(256, 128, (gx, w, h) => {
            for (let y = 0; y < h; y++) {
                const v = 0.5 + 0.5 * Math.sin(y * 0.35) * Math.sin(y * 0.07 + 1);
                gx.fillStyle = `rgb(${Math.round(150 + 80 * v)},${Math.round(70 + 60 * v)},${Math.round(90 + 50 * v)})`;
                gx.fillRect(0, y, w, 1);
            }
        });
        const giant = new THREE.Mesh(new THREE.SphereGeometry(170, 40, 24), new THREE.MeshStandardMaterial({ map: bands, roughness: 1, fog: false }));
        giant.position.set(420, 260, -700);
        giant.rotation.z = 0.35;
        S.add(giant);
        const ring = new THREE.Mesh(new THREE.RingGeometry(220, 330, 64), new THREE.MeshBasicMaterial({ color: 0xe8b8a0, transparent: true, opacity: 0.45, side: THREE.DoubleSide, fog: false, depthWrite: false }));
        ring.position.copy(giant.position);
        ring.rotation.set(1.25, 0.3, 0.35);
        S.add(ring);
        this.giant = giant;
        for (const [x, y, z, r, cc] of [[-300, 220, -600, 28, 0xd7ccc8], [150, 330, -900, 18, 0xb39ddb]]) {
            const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshStandardMaterial({ color: cc, roughness: 1, fog: false }));
            m.position.set(x, y, z);
            S.add(m);
        }
        // ---- Light ----
        S.add(new THREE.HemisphereLight(0xff9a70, 0x401008, 0.75));
        const key = new THREE.DirectionalLight(0xffa070, 1.4);
        key.position.set(-200, 80, -300);
        S.add(key);
        // ---- Rocks, spires, floating stones ----
        const rockMat = new THREE.MeshStandardMaterial({ color: 0x5a1a0e, roughness: 0.9, flatShading: true });
        const rand = (a, b) => a + Math.random() * (b - a);
        for (let i = 0; i < 90; i++) {
            const x = rand(-300, 300), z = rand(-300, 300);
            if (Math.hypot(x, z) < 12) continue;
            const h = rand(6, 34);
            const m = new THREE.Mesh(new THREE.ConeGeometry(rand(1.5, 5), h, 6, 4), rockMat);
            m.position.set(x, planetHeight(x, z) + h * 0.45, z);
            m.rotation.set(rand(-0.2, 0.2), rand(0, 6), rand(-0.2, 0.2));
            S.add(m);
        }
        this.floaters = [];
        for (let i = 0; i < 24; i++) {
            const x = rand(-200, 200), z = rand(-200, 200);
            const m = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(2, 8), 0), rockMat);
            const y = planetHeight(x, z) + rand(15, 50);
            m.position.set(x, y, z);
            m.userData = { y, ph: rand(0, 6), spin: rand(-0.2, 0.2) };
            S.add(m);
            this.floaters.push(m);
        }
        // ---- Crystals that glow ----
        for (let i = 0; i < 30; i++) {
            const x = rand(-180, 180), z = rand(-180, 180);
            const hue = Math.random() < 0.5 ? 0x40e0ff : 0xff40d0;
            const grp = new THREE.Group();
            grp.position.set(x, planetHeight(x, z), z);
            for (let k = 0; k < 6; k++) {
                const m = new THREE.Mesh(new THREE.OctahedronGeometry(rand(0.4, 1.4)), mat(hue, { e: 1.6, r: 0.2 }));
                m.scale.y = rand(2, 4);
                m.position.set(rand(-1.2, 1.2), m.scale.y * 0.5, rand(-1.2, 1.2));
                m.rotation.set(rand(-0.4, 0.4), rand(0, 3), rand(-0.4, 0.4));
                grp.add(m);
            }
            S.add(grp);
        }
        // ---- Stalks with glowing bulbs, swaying ----
        const N = 260;
        this.stalks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.12, 1, 5).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x3a1020, roughness: 0.8 }), N);
        this.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffd040, emissive: 0xffa020, emissiveIntensity: 1.8 }), N);
        this.stalkData = [];
        for (let i = 0; i < N; i++) {
            const a = Math.random() * Math.PI * 2, r = 6 + Math.pow(Math.random(), 0.7) * 160;
            const x = Math.cos(a) * r, z = Math.sin(a) * r;
            this.stalkData.push({ x, z, y: planetHeight(x, z), h: rand(1.5, 5), ph: rand(0, 6) });
            this.bulbs.setColorAt(i, new THREE.Color().setHSL(rand(0.05, 0.16) + (Math.random() < 0.2 ? 0.45 : 0), 1, 0.55));
        }
        S.add(this.stalks, this.bulbs);
        // ---- Dust on the wind ----
        const DN = 1500;
        const dp = new Float32Array(DN * 3);
        for (let i = 0; i < DN; i++) dp.set([rand(-60, 60), rand(0, 25), rand(-60, 60)], i * 3);
        const dg = new THREE.BufferGeometry();
        dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
        this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xffb08a, size: 0.12, transparent: true, opacity: 0.6, depthWrite: false }));
        S.add(this.dust);
        // ---- The watchers ----
        for (let i = 0; i < 4; i++) {
            const p = new Person(this.w.peds, S, 900 + i * 31, 'adult');
            p.mesh.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ color: 0x0a0204, transparent: true, opacity: 1 }); });
            p.mesh.scale.set(1.1, 1.9, 1.1);
            this.figures.push({ p, fade: 1 });
            this._placeFigure(this.figures[i], true);
        }
        // ---- Sound: wind, a deep drone, now and then a far call ----
        const snd = this.w.sound;
        this.wind = snd.noise(380, 0.8, 0.08);
        snd.tone(41, 0.05, 'sine');
        snd.tone(61.7, 0.03, 'sine');
        this.whine = snd.tone(880, 0, 'sine');
        this._callT = 6;
    }

    _placeFigure(f, first = false) {
        const a = this.w.yaw + Math.PI + (Math.random() - 0.5) * 2.4;     // ahead of you, in view
        const r = first ? 45 + Math.random() * 40 : 55 + Math.random() * 30;
        const x = this.pos.x - Math.sin(a + Math.PI) * r, z = this.pos.z - Math.cos(a + Math.PI) * r;
        f.p.place(x, z, Math.atan2(this.pos.x - x, this.pos.z - z));
        f.p.mesh.position.y = planetHeight(x, z);
        f.fade = 1;
    }

    update(dt, t) {
        const w = this.w;
        // ---- Walking ----
        const k = w.keys;
        const fwd = (k.w || k.arrowup ? 1 : 0) - (k.s || k.arrowdown ? 1 : 0);
        const side = (k.d || k.arrowright ? 1 : 0) - (k.a || k.arrowleft ? 1 : 0);
        const sp = k.shift ? 7.5 : 4;
        const fx = -Math.sin(w.yaw), fz = -Math.cos(w.yaw);
        const rx = Math.cos(w.yaw), rz = -Math.sin(w.yaw);
        let mx = fx * fwd + rx * side, mz = fz * fwd + rz * side;
        const ml = Math.hypot(mx, mz);
        if (ml > 0) { mx /= ml; mz /= ml; }
        this.pos.x = clamp(this.pos.x + mx * sp * dt, -SIZE / 2 + 20, SIZE / 2 - 20);
        this.pos.z = clamp(this.pos.z + mz * sp * dt, -SIZE / 2 + 20, SIZE / 2 - 20);
        const ground = planetHeight(this.pos.x, this.pos.z);
        if (k[' '] && this.air <= 0) { this.vy = 5.5; this.air = 0.01; }
        if (this.air > 0) {
            this.vy -= 3.2 * dt;          // low gravity: long, floating jumps
            this.air += this.vy * dt;
            if (this.air <= 0) this.air = 0;
        }
        if (ml > 0 && this.air <= 0) this.phase += dt * sp * 1.9;
        const bob = Math.sin(this.phase) * 0.06 * (ml > 0 ? 1 : 0);
        const cam = w.camera;
        cam.rotation.order = 'YXZ';
        // Dreamy: the horizon lists and breathes
        cam.rotation.set(w.pitch, w.yaw, Math.sin(t * 0.21) * 0.06 + Math.sin(t * 0.07) * 0.04);
        cam.position.set(this.pos.x, ground + 1.7 + this.air + bob, this.pos.z);
        cam.fov = 72 + Math.sin(t * 0.4) * 4;
        cam.updateProjectionMatrix();
        this.dome.position.copy(cam.position);
        this.dome.material.uniforms.uTime.value = t;
        // ---- The world moving ----
        for (const f of this.floaters) {
            f.position.y = f.userData.y + Math.sin(t * 0.4 + f.userData.ph) * 2;
            f.rotation.y += f.userData.spin * dt;
        }
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
        this.stalkData.forEach((s, i) => {
            const sway = Math.sin(t * 1.3 + s.ph) * 0.18;
            e.set(sway, 0, Math.cos(t * 1.1 + s.ph) * 0.15);
            q.setFromEuler(e);
            m4.compose(v.set(s.x, s.y, s.z), q, sc.set(1, s.h, 1));
            this.stalks.setMatrixAt(i, m4);
            v.set(0, s.h, 0).applyQuaternion(q).add(new THREE.Vector3(s.x, s.y, s.z));
            const pulse = 0.85 + 0.25 * Math.sin(t * 2.2 + s.ph * 3);
            m4.compose(v, q, sc.set(pulse, pulse, pulse));
            this.bulbs.setMatrixAt(i, m4);
        });
        this.stalks.instanceMatrix.needsUpdate = true;
        this.bulbs.instanceMatrix.needsUpdate = true;
        const dpos = this.dust.geometry.attributes.position;
        for (let i = 0; i < dpos.count; i++) {
            let x = dpos.getX(i) + dt * 3.5, y = dpos.getY(i) + Math.sin(t + i) * dt * 0.3;
            if (x > 60) x -= 120;
            dpos.setX(i, x);
            dpos.setY(i, y);
        }
        dpos.needsUpdate = true;
        this.dust.position.set(Math.round(this.pos.x / 120) * 120, ground - 3, Math.round(this.pos.z / 120) * 120);
        this.giant.rotation.y += dt * 0.01;
        // ---- The watchers: gone when you get near ----
        let near = 0;
        for (const f of this.figures) {
            const d = Math.hypot(f.p.mesh.position.x - this.pos.x, f.p.mesh.position.z - this.pos.z);
            near = Math.max(near, clamp(1 - (d - 12) / 40, 0, 1));
            if (d < 16 && f.fade === 1) f.fade = 0.999;
            if (f.fade < 1) {
                f.fade -= dt * 1.5;
                f.p.mesh.scale.y = 1.9 * Math.max(0.01, f.fade);
                if (f.fade <= 0) this._placeFigure(f);
            }
        }
        this.whine.gain.gain.setTargetAtTime(near * 0.025, 0, 0.3);
        this.whine.osc.frequency.setTargetAtTime(700 + near * 500 + Math.sin(t * 3) * 40, 0, 0.3);
        this.wind.gain.gain.setTargetAtTime(0.06 + 0.05 * (0.5 + 0.5 * Math.sin(t * 0.3)), 0, 0.5);
        this._callT -= dt;
        if (this._callT <= 0) {
            this._callT = 9 + Math.random() * 12;
            w.sound.ping(180 + Math.random() * 120, 0.06, 4, 'triangle');
        }
    }

    dispose() {
        for (const f of this.figures) f.p.remove();
    }
}
