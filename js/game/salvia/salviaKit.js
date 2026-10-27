/**
 * js/game/salvia/salviaKit.js
 *
 * Shared pieces for the salvia trips: blocks, people and sound.
 * - box / cyl: a mesh added to a parent in one call
 * - Person: one of the town's people (pedestrians.js rigs and part geometries, drawn as plain meshes
 *   in a trip's own scene) who walks to points, reaches for things and holds things
 * - TripSound: synthesized beds and one-shots on the game's AudioContext (hums, noise, dings, clanks)
 */

import * as THREE from 'three';
import { mat } from '../mermaid/mermaidKit.js';
import { poseWalk, poseIdle, resetRig, poseSeated } from '../avatarPose.js';

export { mat, std, canvasTexture, signTexture, fbm, noise2, clamp, lerp, mulberry32 } from '../mermaid/mermaidKit.js';

export function box(parent, w, h, d, color, x = 0, y = 0, z = 0, o = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), o.material || mat(color, o));
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = !o.noShadow;
    parent.add(m);
    return m;
}

export function cyl(parent, rt, rb, h, color, x = 0, y = 0, z = 0, o = {}) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, o.seg || 20), o.material || mat(color, o));
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = !o.noShadow;
    parent.add(m);
    return m;
}

const angleTo = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/**
 * One of the town's people in a trip's own scene. `peds` is the game's PedestrianSystem (its rigs
 * and part geometries). Walks along `walkTo` targets, then holds a pose ('stand', 'reach', 'eat',
 * 'sit'); `held` is an Object3D carried in the right hand.
 */
export class Person {
    constructor(peds, scene, seed, style = 'adult', shirt = null) {
        this.mesh = peds.createPedestrianMesh(seed, { style });
        const rig = this.rig = this.mesh.userData.rig;
        const geos = peds.renderer.meshes;
        for (const b of rig.bindings) {
            if (shirt !== null && (b.part === 'torso' || b.part === 'upperArm')) b.color.setHex(shirt);
            const g = geos[b.part] && geos[b.part].geometry;
            if (!g) continue;
            g.userData.shared = true;     // (the game's own: never disposed with a trip)
            const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.8 }));
            m.castShadow = true;
            b.joint.add(m);
        }
        scene.add(this.mesh);
        this.scene = scene;
        this.path = [];
        this.speed = 1.3;
        this.pose = 'stand';
        this.phase = 0;
        this.t = 0;
        this.yaw = 0;
        this.held = null;
        this.reach = 0;
    }

    place(x, z, yaw = 0) {
        this.mesh.position.set(x, 0, z);
        this.yaw = yaw;
        this.mesh.rotation.y = yaw;
    }

    walkTo(...pts) { this.path.push(...pts); }
    get moving() { return this.path.length > 0; }

    hold(obj) {
        if (this.held && this.held.parent) this.held.parent.remove(this.held);
        this.held = obj;
        if (obj) {
            obj.position.set(0, -0.02, 0.05);
            obj.rotation.set(0, 0, 0);
            this.rig.handR.add(obj);
        }
    }

    remove() {
        this.scene.remove(this.mesh);
    }

    update(dt, speedK = 1) {
        this.t += dt;
        const p = this.mesh.position;
        const rig = this.rig;
        if (this.path.length) {
            const tgt = this.path[0];
            const dx = tgt[0] - p.x, dz = tgt[1] - p.z;
            const d = Math.hypot(dx, dz);
            const step = this.speed * speedK * dt;
            if (d <= step) {
                p.x = tgt[0];
                p.z = tgt[1];
                this.path.shift();
                if (!this.path.length && tgt[2] !== undefined) this.yaw = tgt[2];
            } else {
                p.x += (dx / d) * step;
                p.z += (dz / d) * step;
                this.yaw += angleTo(this.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 10);
            }
            this.phase += this.speed * speedK * dt * 4;
            poseWalk(rig, this.phase, this.speed * speedK);
        } else if (this.pose === 'sit' || this.pose === 'eat') {
            poseSeated(rig, 0.46, this.mesh.scale.y, 'table', this.t);
        } else {
            poseIdle(rig, this.t);
        }
        this.mesh.rotation.y = this.yaw;
        // Arms on top of the walk / stand
        const r = this.reach;
        if (r > 0) {
            rig.shoulderR.rotation.set(-1.25 * r, 0, 0.1 * r);
            rig.elbowR.rotation.x = -0.35 * r;
            rig.torso.rotation.x = 0.18 * r;
        }
        if (this.pose === 'eat') {
            rig.shoulderR.rotation.set(-1.9, 0, -0.25);
            rig.elbowR.rotation.x = -1.7 + Math.max(0, Math.sin(this.t * 5)) * 0.4;
        } else if (this.held && !this.path.length && r === 0) {
            rig.shoulderR.rotation.set(-0.6, 0, 0);
            rig.elbowR.rotation.x = -1.2;
        }
        if (!this.path.length && this.pose !== 'sit' && this.pose !== 'eat') rig.body.position.y = 0;
    }
}

/** Synthesized sound for a trip (all of it stops with stop()). */
export class TripSound {
    constructor(ctx) {
        this.ctx = ctx;
        this.out = ctx ? ctx.createGain() : null;
        if (this.out) {
            this.out.gain.value = 0;
            this.out.connect(ctx.destination);
            this.out.gain.setTargetAtTime(1, ctx.currentTime, 1.5);
        }
        this.nodes = [];
        this._noise = null;
    }

    _noiseBuf() {
        if (this._noise) return this._noise;
        const n = this.ctx.sampleRate * 2;
        const b = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        this._noise = b;
        return b;
    }

    /** A steady tone (returns { gain, osc } to change later). */
    tone(freq, gain, type = 'sine') {
        if (!this.ctx) return { gain: { gain: { value: 0, setTargetAtTime() {} } }, osc: { frequency: { setTargetAtTime() {} } } };
        const o = this.ctx.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        const g = this.ctx.createGain();
        g.gain.value = gain;
        o.connect(g).connect(this.out);
        o.start();
        this.nodes.push(o);
        return { gain: g, osc: o };
    }

    /** Filtered noise (wind, a fan, machinery). */
    noise(freq, q, gain, type = 'lowpass') {
        if (!this.ctx) return { gain: { gain: { value: 0, setTargetAtTime() {} } }, filter: { frequency: { setTargetAtTime() {} } } };
        const s = this.ctx.createBufferSource();
        s.buffer = this._noiseBuf();
        s.loop = true;
        const f = this.ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q;
        const g = this.ctx.createGain();
        g.gain.value = gain;
        s.connect(f).connect(g).connect(this.out);
        s.start();
        this.nodes.push(s);
        return { gain: g, filter: f };
    }

    /** A struck tone that rings away (a ding, a bell, a clank with a low freq and short decay). */
    ping(freq, gain = 0.2, decay = 1.2, type = 'sine') {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        o.connect(g).connect(this.out);
        o.start(t);
        o.stop(t + decay + 0.05);
    }

    /** A short burst of noise (a clunk, a thud, a hiss). */
    burst(freq, gain = 0.3, decay = 0.2, type = 'bandpass') {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const s = this.ctx.createBufferSource();
        s.buffer = this._noiseBuf();
        const f = this.ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = 1.5;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        s.connect(f).connect(g).connect(this.out);
        s.start(t, Math.random());
        s.stop(t + decay + 0.05);
    }

    stop() {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        this.out.gain.setTargetAtTime(0, t, 0.3);
        const nodes = this.nodes;
        setTimeout(() => {
            for (const n of nodes) { try { n.stop(); } catch (e) { /* already */ } }
            try { this.out.disconnect(); } catch (e) { /* already */ }
        }, 1500);
        this.nodes = [];
    }
}

export { resetRig };
