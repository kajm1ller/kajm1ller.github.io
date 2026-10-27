/**
 * js/game/multiplayer.js
 *
 * Client side of Kaj Simulator multiplayer (server: multiplayerServer.js).
 *
 * - MultiplayerClient: WebSocket wrapper with join-on-connect, capped auto-reconnect and a status callback.
 * - RemotePlayers: turns the server's player list into interpolated avatars / cars / planes with name tags.
 *
 * The shared world on top of this lives in netWorld.js (regions, owners, replicas); this file is the
 * connection and the other players themselves: walking and aiming bodies (the pedestrian rigs, when
 * a PedestrianSystem is given), cars with their drivers and passengers, planes, name tags with health.
 */

import * as THREE from 'three';

import { createHondaCivic } from './vehicle.js';
import { createPlaneMesh } from './plane.js';
import { lerpAngle } from './camera.js';
import { poseWalk, poseAim, poseIdle, poseUse, poseSeated, poseStagger, poseHold, poseGrabbing, posePunch } from './avatarPose.js';

const _tmpV = new THREE.Vector3();

/**
 * What a player has in their hand, as sent in `held`: 'g_<gun category>' or 'd_<how a drug is
 * taken>' (game.html mpExtras; older clients send 'pistol'). -> [prop part, colour, pose kind, long gun]
 */
const LONG_GUNS = new Set(['rifle', 'shotgun', 'sniper', 'heavy']);
const DRUG_PROPS = {
    cigarette: ['cigarette', 0xf2f2f2], joint: ['cigarette', 0xe8e0c0], vape: ['cigarette', 0x29b6f6], dabpen: ['cigarette', 0x43a047],
    bong: ['pipe', 0x26a69a], stem: ['pipe', 0xe8dcc0], bulb: ['pipe', 0xb3e5fc], foil: ['baggie', 0xc0c8d0],
    syringe: ['syringe', 0xd8e8f0], line: ['baggie', 0xf5f5f5], key: ['baggie', 0xeeeeee], tab: ['baggie', 0xff7043],
    mushrooms: ['baggie', 0xa1887f], bottle: ['bottle', 0x8a5a1a], shot: ['cup', 0xc89a3a], cup: ['cup', 0x8e24aa]
};
/** Drugs you breathe out (smoke puffs from other players while they take a hit). */
export const SMOKED = new Set(['d_cigarette', 'd_joint', 'd_vape', 'd_dabpen', 'd_bong', 'd_stem', 'd_bulb', 'd_foil']);
export function heldProp(held) {
    if (!held) return null;
    if (held === 'pistol') return ['pistol', 0x1e1e1e, 'gun', false];
    if (held.startsWith('g_')) {
        const cat = held.slice(2);
        return LONG_GUNS.has(cat) ? ['rifle', 0x1e1e1e, 'gun', true] : ['pistol', 0x1e1e1e, 'gun', false];
    }
    if (held.startsWith('d_')) {
        const p = DRUG_PROPS[held.slice(2)];
        return p ? [p[0], p[1], 'item', false] : null;
    }
    return null;
}

export const MP_SEND_INTERVAL = 1 / 15; // seconds between position updates
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
const MAX_RECONNECT_ATTEMPTS = 6;

/** Default server: same host that served the page; ?server=ws://host:port overrides it. */
export function resolveServerUrl(loc = (typeof location !== 'undefined' ? location : null)) {
    if (!loc) return null;
    const override = new URLSearchParams(loc.search || '').get('server');
    if (override) return override;
    if (loc.protocol !== 'http:' && loc.protocol !== 'https:') return null; // file:// etc.
    return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}`;
}

export class MultiplayerClient {
    /**
     * @param {Object} options
     * @param {string} options.url ws:// or wss:// server address
     * @param {() => Object} options.getJoinInfo called on every (re)connect to build the join message
     * @param {(msg: Object) => void} options.onMessage
     * @param {(status: 'connecting'|'online'|'offline') => void} [options.onStatus]
     * @param {Function} [options.WebSocketImpl] injectable for tests
     */
    constructor(options) {
        this.url = options.url;
        this.getJoinInfo = options.getJoinInfo;
        this.onMessage = options.onMessage;
        this.onStatus = options.onStatus || (() => {});
        this.WebSocketImpl = options.WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
        this.ws = null;
        this.status = 'offline';
        this.id = null;
        this.wantConnection = false;
        this.failedAttempts = 0;
        this._retryTimer = null;
    }

    _setStatus(status) {
        if (this.status === status) return;
        this.status = status;
        this.onStatus(status);
    }

    connect() {
        if (!this.WebSocketImpl || !this.url) {
            this._setStatus('offline');
            return false;
        }
        this.wantConnection = true;
        this._open();
        return true;
    }

    _open() {
        clearTimeout(this._retryTimer);
        if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
        this._setStatus('connecting');
        let ws;
        try {
            ws = new this.WebSocketImpl(this.url);
        } catch (e) {
            this._scheduleRetry();
            return;
        }
        this.ws = ws;
        ws.onopen = () => {
            this.failedAttempts = 0;
            this.send(Object.assign({ type: 'join' }, this.getJoinInfo()));
        };
        ws.onmessage = (event) => {
            let msg;
            try { msg = JSON.parse(event.data); } catch (e) { return; }
            if (!msg || typeof msg !== 'object') return;
            if (msg.type === 'welcome') {
                this.id = msg.id;
                this._setStatus('online');
            } else if (msg.type === 'full') {
                this.wantConnection = false; // server is full: don't hammer it
            }
            try { this.onMessage(msg); } catch (e) { console.error('multiplayer message handler failed', e); }
        };
        ws.onclose = () => {
            if (this.ws === ws) this.ws = null;
            this.id = null;
            if (this.wantConnection) this._scheduleRetry();
            else this._setStatus('offline');
        };
        ws.onerror = () => { /* onclose follows */ };
    }

    _scheduleRetry() {
        this.failedAttempts++;
        if (this.failedAttempts >= MAX_RECONNECT_ATTEMPTS) {
            this.wantConnection = false;
            this._setStatus('offline');
            return;
        }
        this._setStatus('connecting');
        const delay = RECONNECT_DELAYS_MS[Math.min(this.failedAttempts - 1, RECONNECT_DELAYS_MS.length - 1)];
        this._retryTimer = setTimeout(() => this._open(), delay);
    }

    /** Manual retry after giving up. */
    retry() {
        this.failedAttempts = 0;
        this.wantConnection = true;
        this._open();
    }

    send(message) {
        if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify(message));
            return true;
        }
        return false;
    }

    get isOnline() {
        return this.status === 'online';
    }

    disconnect() {
        this.wantConnection = false;
        clearTimeout(this._retryTimer);
        if (this.ws) this.ws.close();
        this._setStatus('offline');
    }
}

// ============================================================================
// REMOTE PLAYERS
// ============================================================================

const SHIRT_COLORS = [0xd9534f, 0x5bc0de, 0x5cb85c, 0xf0ad4e, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xe84393];
const SKIN_COLORS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];

function hashId(id) {
    let h = 0;
    for (let i = 0; i < String(id).length; i++) h = (h * 31 + String(id).charCodeAt(i)) >>> 0;
    return h;
}

let _avatarGeos = null;
function avatarGeos() {
    if (!_avatarGeos) {
        _avatarGeos = {
            body: new THREE.BoxGeometry(0.55, 0.8, 0.3),
            head: new THREE.BoxGeometry(0.3, 0.3, 0.3),
            leg: new THREE.BoxGeometry(0.2, 0.65, 0.22),
            pants: new THREE.MeshLambertMaterial({ color: 0x2c3e50 })
        };
    }
    return _avatarGeos;
}

function createAvatar(id) {
    const g = avatarGeos();
    const h = hashId(id);
    const group = new THREE.Group();
    group.name = `remote_avatar_${id}`;
    const body = new THREE.Mesh(g.body, new THREE.MeshLambertMaterial({ color: SHIRT_COLORS[h % SHIRT_COLORS.length] }));
    body.position.y = 1.1;
    const head = new THREE.Mesh(g.head, new THREE.MeshLambertMaterial({ color: SKIN_COLORS[(h >> 3) % SKIN_COLORS.length] }));
    head.position.y = 1.7;
    const legL = new THREE.Mesh(g.leg, g.pants);
    legL.position.set(-0.14, 0.33, 0);
    const legR = new THREE.Mesh(g.leg, g.pants);
    legR.position.set(0.14, 0.33, 0);
    group.add(body, head, legL, legR);
    group.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    group.userData.legL = legL;
    group.userData.legR = legR;
    return group;
}

function drawNameTag(canvas, name, hp) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = 'bold 30px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const width = Math.min(250, ctx.measureText(name).width + 24);
    ctx.fillRect(128 - width / 2, 6, width, 40);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, 128, 27);
    // Health under the name
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(78, 48, 100, 12);
    ctx.fillStyle = hp > 50 ? '#5cd65c' : hp > 25 ? '#f0c040' : '#e04848';
    ctx.fillRect(80, 50, Math.max(0, Math.min(96, hp * 0.96)), 8);
}

function createNameTag(name, hp = 100) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    drawNameTag(canvas, name, hp);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.renderOrder = 999;
    sprite.scale.set(2.8, 0.7, 1);
    sprite.name = 'remote_name_tag';
    sprite.userData.canvas = canvas;
    sprite.userData.name = name;
    sprite.userData.hp = hp;
    return sprite;
}

const TAG_HEIGHT = { foot: 2.35, car: 2.8, plane: 4.4 };
const HIT_RADIUS = { foot: 0.9, car: 1.8, plane: 3.5 };

export class RemotePlayers {
    /**
     * @param {THREE.Scene} scene
     * @param {Object} [options]
     * @param {Object} [options.peds] PedestrianSystem: players on foot are drawn as full people
     *   (walking, aiming, sitting at a table) through its renderer; without it they are boxes
     */
    constructor(scene, options = {}) {
        this.scene = scene;
        this.peds = options.peds || null;
        this.players = new Map(); // id -> entry
        this.selfId = null;
        this.time = 0;
    }

    _makeBody(entry) {
        const peds = this.peds;
        const h = hashId(entry.id);
        const mesh = peds.createPedestrianMesh(h, { style: 'adult' });
        const rig = mesh.userData.rig;
        // Each player has their own shirt colour
        const shirt = SHIRT_COLORS[h % SHIRT_COLORS.length];
        for (const b of rig.bindings) if (b.part === 'torso' || b.part === 'upperArm') b.color.setHex(shirt);
        const body = { mesh, position: mesh.position, rig, held: '' };
        peds.extraRigs.push(body);
        entry.body = body;
    }

    _dropBody(entry) {
        if (!entry.body || !this.peds) return;
        const i = this.peds.extraRigs.indexOf(entry.body);
        if (i >= 0) this.peds.extraRigs.splice(i, 1);
        entry.body = null;
    }

    get count() {
        return this.players.size;
    }

    _makeVisual(entry) {
        if (entry.visual) {
            entry.root.remove(entry.visual);
        }
        let visual;
        if (entry.state === 'car') {
            visual = createHondaCivic(entry.color, `remote_${entry.id}`, entry.model);
        } else if (entry.state === 'plane') {
            visual = createPlaneMesh(entry.color, `remote_${entry.id}`).root;
        } else if (this.peds) {
            // A person drawn by the pedestrian renderer; the group just holds the name tag
            visual = new THREE.Group();
            visual.name = `remote_body_${entry.id}`;
            if (!entry.body) this._makeBody(entry);
        } else {
            visual = createAvatar(entry.id);
        }
        if (entry.state !== 'foot') this._dropBody(entry);
        entry.visual = visual;
        entry.visualState = entry.state;
        entry.visualColor = entry.color;
        entry.root.add(visual);
        if (entry.tag) entry.tag.position.y = TAG_HEIGHT[entry.state] || TAG_HEIGHT.foot;
    }

    _add(p) {
        const root = new THREE.Group();
        root.name = `remote_player_${p.id}`;
        const entry = {
            id: p.id,
            name: p.name,
            state: p.state || 'foot',
            color: p.color,
            model: p.model,
            root,
            visual: null,
            visualState: null,
            tag: createNameTag(p.name, p.hp === undefined ? 100 : p.hp),
            hp: p.hp === undefined ? 100 : p.hp,
            anim: 'idle', held: '', ride: null, sit: null, riders: [], body: null, walkClock: 0, brawl: '', face: 0, nohead: false,
            pos: new THREE.Vector3(p.x, p.y, p.z),
            target: new THREE.Vector3(p.x, p.y, p.z),
            aim: new THREE.Vector3(p.x, p.y, p.z),
            vel: new THREE.Vector3(),
            moveT: 0,
            yaw: p.yaw || 0, targetYaw: p.yaw || 0,
            pitch: 0, targetPitch: 0,
            roll: 0, targetRoll: 0,
            walkPhase: 0,
            speed: 0
        };
        if (entry.tag) root.add(entry.tag);
        this._makeVisual(entry);
        root.position.copy(entry.pos);
        root.rotation.order = 'YXZ';
        this.scene.add(root);
        this.players.set(p.id, entry);
        return entry;
    }

    _remove(id) {
        const e = this.players.get(id);
        if (!e) return;
        this._dropBody(e);
        this.scene.remove(e.root);
        if (e.tag) {
            e.tag.material.map.dispose();
            e.tag.material.dispose();
        }
        this.players.delete(id);
    }

    /** Applies the server's authoritative player list. */
    sync(list, selfId = this.selfId) {
        this.selfId = selfId;
        const seen = new Set();
        for (const p of list) {
            if (!p || p.id === selfId) continue;
            seen.add(p.id);
            let e = this.players.get(p.id);
            if (!e) e = this._add(p);
            e.name = p.name;
            this._track(e, p);
            e.targetYaw = p.yaw || 0;
            e.targetPitch = p.pitch || 0;
            e.targetRoll = p.roll || 0;
            e.anim = p.anim || 'idle';
            e.region = p.region || null;
            e.held = p.held || '';
            e.brawl = p.brawl || '';
            e.face = p.face || 0;
            e.nohead = !!p.nohead;
            e.ride = p.ride || null;
            e.sit = p.sit === undefined ? null : p.sit;
            e.riders = Array.isArray(p.riders) ? p.riders : [];
            e.steer = p.steer || 0;
            e.netSpeed = p.speed || 0;
            e.radio = p.radio === undefined ? -1 : p.radio;
            e.radioT = p.radioT || 0;
            if (p.hp !== undefined && p.hp !== e.hp) {
                e.hp = p.hp;
                if (e.tag && e.tag.userData.canvas) {
                    drawNameTag(e.tag.userData.canvas, e.tag.userData.name, e.hp);
                    e.tag.material.map.needsUpdate = true;
                }
            }
            const state = p.state || 'foot';
            if (state !== e.state || p.color !== e.color || p.model !== e.model) {
                e.state = state;
                e.color = p.color;
                e.model = p.model;
                this._makeVisual(e);
            }
        }
        for (const id of Array.from(this.players.keys())) {
            if (!seen.has(id)) this._remove(id);
        }
    }

    /**
     * Takes a reported position as the new target and works out how fast the player is going, so the
     * drawn one can carry on between reports (they come ~15 times a second) instead of stepping.
     */
    _track(e, p) {
        const now = performance.now();
        const moved = p.x !== e.target.x || p.y !== e.target.y || p.z !== e.target.z;
        if (moved) {
            const dts = (now - (e.moveT || 0)) / 1000;
            const fast = e.state === 'car' || e.state === 'plane';
            if (fast && e.moveT && dts > 0.02 && dts < 0.4 && Math.hypot(p.x - e.target.x, p.z - e.target.z) < 30) {
                _tmpV.set((p.x - e.target.x) / dts, (p.y - e.target.y) / dts, (p.z - e.target.z) / dts);
                e.vel.lerp(_tmpV, 0.6);
            } else {
                e.vel.set(0, 0, 0);
            }
            e.moveT = now;
            e.target.set(p.x, p.y, p.z);
        } else if (now - (e.moveT || 0) > 400) {
            e.vel.set(0, 0, 0);
        }
    }

    /** Smooths each remote player toward its latest reported pose. */
    update(dt) {
        const alpha = 1 - Math.exp(-dt * 14);
        this.time += dt;
        for (const e of this.players.values()) {
            // Where they should be now: the last report, carried on at their speed (for at most a moment)
            const age = Math.min(0.25, (performance.now() - (e.moveT || 0)) / 1000);
            e.aim.copy(e.target).addScaledVector(e.vel, age);
            const dist = e.pos.distanceTo(e.aim);
            const before = e.pos.clone();
            if (dist > 40) e.pos.copy(e.target); // teleport (respawn)
            else e.pos.lerp(e.aim, alpha);
            e.yaw = lerpAngle(e.yaw, e.targetYaw, alpha);
            e.pitch += (e.targetPitch - e.pitch) * alpha;
            e.roll += (e.targetRoll - e.roll) * alpha;
            e.speed = dt > 0 ? before.distanceTo(e.pos) / dt : 0;

            e.root.position.copy(e.pos);
            e.root.rotation.y = e.yaw;
            if (e.state === 'plane') {
                e.root.rotation.x = e.pitch;
                e.root.rotation.z = -e.roll;
            } else {
                e.root.rotation.x = 0;
                e.root.rotation.z = 0;
            }

            if (e.tag) e.tag.visible = !e.override;   // (in a fight with us: no name in our face)
            if (e.body) this._poseBody(e, dt);
            if (e.state === 'foot' && e.visual && e.visual.userData.legL) {
                e.walkPhase += e.speed * dt * 2.4;
                const swing = Math.min(1, e.speed / 4) * Math.sin(e.walkPhase) * 0.7;
                e.visual.userData.legL.rotation.x = swing;
                e.visual.userData.legR.rotation.x = -swing;
            }
            if (e.state === 'plane' && e.visual) {
                const prop = e.visual.getObjectByName('plane_propeller');
                if (prop) prop.rotation.z += dt * 50;
            }
        }
    }

    /** Poses and places the person drawn for a player on foot. Riders and drivers are CarRiders' job. */
    _poseBody(e, dt) {
        const b = e.body;
        const rig = b.rig;
        const riding = !!e.ride;
        b.mesh.visible = !riding;
        if (riding) {
            b.mesh.position.set(0, -500, 0);
            return;
        }
        // A beaten face, a blown-off head; a fresh body once they're back to new (respawned)
        if ((b.faceDmg || 0) > e.face + 0.5 || (b.headGone && !e.nohead)) {
            this._dropBody(e);
            this._makeBody(e);
            return;
        }
        if (e.face > (b.faceDmg || 0) + 0.05) this.peds.bruiseFace(b, e.face - (b.faceDmg || 0));
        if (e.nohead && !b.headGone) this.peds.goreHead(b);
        // A fight we're in with them: our own game knows where they are and how (e.override, set each
        // frame by game.html: { brawl, x, z, yaw (the body's own yaw) }), sooner than their reports
        const ov = e.override;
        if (ov) {
            b.mesh.position.set(ov.x, e.pos.y, ov.z);
            b.mesh.rotation.set(0, ov.yaw, 0);
        } else {
            b.mesh.position.set(e.pos.x, e.pos.y, e.pos.z);
            // (yaw is where their camera looks; the rig faces +Z, so it is turned round)
            b.mesh.rotation.set(0, e.yaw + Math.PI, 0);
        }
        const h = b.mesh.scale.y || 1;
        // What's in their hand: the gun they have out, the drink, the joint, the needle...
        const prop = heldProp(e.held);
        if (b.held !== e.held) {
            b.held = e.held;
            this.peds.setProp({ mesh: b.mesh }, 'R', prop ? prop[0] : null, prop ? prop[1] : 0x1e1e1e);
        }
        const br = ov ? ov.brawl : e.brawl;
        if (br && br[0] === 'h') {
            // Held / pinned / pinned down / dragged / knocked down by someone (their game says where)
            const mode = br.slice(1);
            const down = mode === 'down';
            this.peds.poseBrawlBody(b, rig, {
                pose: down ? 'downed' : 'held', mode: down ? '' : mode,
                lying: mode === 'mount' || mode === 'drag', downPose: 'back', hp: e.hp
            }, dt);
            if (e.anim === 'punch') {
                // Fighting back: fists flying at whoever has them
                const a = Math.max(0, Math.sin(this.time * 9)), c = Math.max(0, -Math.sin(this.time * 9));
                const up = mode === 'mount' ? -2.4 : -1.4;
                rig.shoulderL.rotation.set(up - 0.5 * a, 0, -0.1);
                rig.shoulderR.rotation.set(up - 0.5 * c, 0, 0.1);
                rig.elbowL.rotation.x = -1.6 + 1.5 * a;
                rig.elbowR.rotation.x = -1.6 + 1.5 * c;
            }
        } else if (br && br[0] === 'g') {
            e.walkClock += e.speed * dt * 2.1;
            poseGrabbing(rig, br.slice(1), this.time, e.walkClock, e.speed, e.anim === 'punch', !!prop && prop[2] === 'gun');
        } else if (e.anim === 'punch') {
            posePunch(rig, this.time);
        } else if (e.sit !== null) {
            poseSeated(rig, 0.66, h, 'table', this.time);
        } else if (e.anim === 'aim') {
            poseAim(rig, e.pitch);
            // Kick of the last shot
            if (e.recoil > 0) {
                rig.shoulderR.rotation.x -= e.recoil * 0.6;
                rig.shoulderL.rotation.x -= e.recoil * 0.4;
                rig.torso.rotation.x -= e.recoil * 0.12;
            }
        } else if (e.anim === 'use') {
            poseUse(rig, this.time);
        } else if (e.anim === 'stagger' || e.anim === 'sway') {
            e.walkClock += Math.max(e.speed, 0.4) * dt * 1.8;
            poseStagger(rig, e.walkClock, e.anim === 'sway' ? 0 : e.speed, this.time + hashId(e.id) % 10);
            if (prop) poseHold(rig, prop[2], prop[3]);
        } else if (e.speed > 0.15 || e.anim === 'walk' || e.anim === 'run') {
            e.walkClock += e.speed * dt * 2.1;
            poseWalk(rig, e.walkClock, Math.max(e.speed, e.anim === 'run' ? 4 : 0));
            const running = e.anim === 'run' || e.speed > 3.6;
            if (prop && (!running || prop[2] === 'gun')) poseHold(rig, prop[2], prop[3], running, e.walkClock);
        } else {
            poseIdle(rig, this.time);
            if (prop) poseHold(rig, prop[2], prop[3]);
        }
        if (e.recoil > 0) e.recoil = Math.max(0, e.recoil - dt * 6);
        // A punch just landed on them (from here): the head snaps, the body rocks
        if (e.flinch > 0) {
            const f = Math.sin(e.flinch * Math.PI);
            rig.neck.rotation.x -= f * 0.55;
            rig.neck.rotation.y += f * 0.4 * (e.flinchSide || 1);
            rig.torso.rotation.x -= f * 0.2;
            e.flinch = Math.max(0, e.flinch - dt * 4);
        }
    }

    /** A shot from player `id`: they're drawn aiming for a moment, with the kick. */
    shotBy(id) {
        const e = this.players.get(id);
        if (!e) return null;
        e.recoil = 1;
        e.shots = (e.shots || 0) + 1;
        if (e.state === 'foot') e.anim = 'aim';
        return e;
    }

    /** Where the right hand of player `id` is in the world (their gun's muzzle, near enough), or null. */
    handOf(id, out) {
        const e = this.players.get(id);
        if (!e || !e.body || e.state !== 'foot') return null;
        const rig = e.body.rig;
        e.body.mesh.updateMatrixWorld(true);
        rig.handR.getWorldPosition(out);
        return out;
    }

    /**
     * Who sits in the cars of players: [{ key, car, seat, seed, style, kind, look }] for CarRiders.sync.
     * Drivers are the players themselves; passengers are players who board, and the NPCs they carry.
     */
    getRiderSpecs(out = []) {
        out.length = 0;
        for (const e of this.players.values()) {
            if (e.state === 'car') {
                const car = { position: e.pos, yaw: e.yaw, modelId: e.model || 'civic' };
                out.push({ key: `p${e.id}`, car, seat: 0, seed: hashId(e.id), style: 'adult', kind: 'drive', shirt: SHIRT_COLORS[hashId(e.id) % SHIRT_COLORS.length] });
                for (const r of e.riders) {
                    if (Array.isArray(r)) out.push({ key: `n${e.id}:${r[0]}`, car, seat: r[0], seed: r[1], style: r[2] || 'adult', kind: 'ride' });
                }
            } else if (e.ride) {
                const d = this.players.get(e.ride.of);
                if (d && d.state === 'car') {
                    const car = { position: d.pos, yaw: d.yaw, modelId: d.model || 'civic' };
                    out.push({ key: `p${e.id}`, car, seat: e.ride.seat, seed: hashId(e.id), style: 'adult', kind: 'ride', shirt: SHIRT_COLORS[hashId(e.id) % SHIRT_COLORS.length] });
                }
            }
        }
        return out;
    }

    /** Players riding in MY car (I'm `selfId`, driving `car`): specs for CarRiders like getRiderSpecs. */
    getRidersOf(selfId, car, out) {
        for (const e of this.players.values()) {
            if (!e.ride || e.ride.of !== selfId) continue;
            out.push({ key: `p${e.id}`, car, seat: e.ride.seat, seed: hashId(e.id), style: 'adult', kind: 'ride', shirt: SHIRT_COLORS[hashId(e.id) % SHIRT_COLORS.length] });
        }
        return out;
    }

    /** The car of a player (or null), for boarding: { id, x, z, yaw, model, seatsFree }. */
    getCar(id) {
        const e = this.players.get(id);
        if (!e || e.state !== 'car') return null;
        return { id: e.id, name: e.name, x: e.pos.x, z: e.pos.z, yaw: e.yaw, model: e.model, entry: e };
    }

    /** Hit-test volumes for PvP: { id, x, y, z, radius, height }. */
    getHitTargets() {
        const out = [];
        for (const e of this.players.values()) {
            out.push({
                id: e.id,
                name: e.name,
                x: e.pos.x,
                y: e.pos.y + (e.state === 'foot' ? 1.0 : 1.2),
                z: e.pos.z,
                radius: HIT_RADIUS[e.state] || HIT_RADIUS.foot,
                halfHeight: e.state === 'foot' ? 1.0 : 1.6
            });
        }
        return out;
    }

    getSummary() {
        return Array.from(this.players.values()).map((e) => ({
            id: e.id, name: e.name, state: e.state, color: e.color,
            x: e.pos.x, y: e.pos.y, z: e.pos.z, yaw: e.yaw, pitch: e.pitch, roll: e.roll
        }));
    }

    dispose() {
        for (const id of Array.from(this.players.keys())) this._remove(id);
    }
}
