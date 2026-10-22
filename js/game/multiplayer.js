/**
 * js/game/multiplayer.js
 *
 * Client side of Kaj Simulator multiplayer (server: multiplayerServer.js).
 *
 * - MultiplayerClient: WebSocket wrapper with join-on-connect, capped auto-reconnect and a status callback.
 * - RemotePlayers: turns the server's player list into interpolated avatars / cars / planes with name tags.
 *
 * Every player owns their own world (traffic, pedestrians, police stay local); only players, their
 * vehicles, chat, gunfire, hits and plane explosions are shared.
 */

import * as THREE from 'three';
import { createHondaCivic } from './vehicle.js';
import { createPlaneMesh } from './plane.js';
import { lerpAngle } from './camera.js';

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

function createNameTag(name) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 30px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const width = Math.min(250, ctx.measureText(name).width + 24);
    ctx.fillRect(128 - width / 2, 8, width, 48);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, 128, 33);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.renderOrder = 999;
    sprite.scale.set(2.8, 0.7, 1);
    sprite.name = 'remote_name_tag';
    return sprite;
}

const TAG_HEIGHT = { foot: 2.35, car: 2.8, plane: 4.4 };
const HIT_RADIUS = { foot: 0.9, car: 1.8, plane: 3.5 };

export class RemotePlayers {
    constructor(scene) {
        this.scene = scene;
        this.players = new Map(); // id -> entry
        this.selfId = null;
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
            visual = createHondaCivic(entry.color, `remote_${entry.id}`);
        } else if (entry.state === 'plane') {
            visual = createPlaneMesh(entry.color, `remote_${entry.id}`).root;
        } else {
            visual = createAvatar(entry.id);
        }
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
            root,
            visual: null,
            visualState: null,
            tag: createNameTag(p.name),
            pos: new THREE.Vector3(p.x, p.y, p.z),
            target: new THREE.Vector3(p.x, p.y, p.z),
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
            e.target.set(p.x, p.y, p.z);
            e.targetYaw = p.yaw || 0;
            e.targetPitch = p.pitch || 0;
            e.targetRoll = p.roll || 0;
            const state = p.state || 'foot';
            if (state !== e.state || p.color !== e.color) {
                e.state = state;
                e.color = p.color;
                this._makeVisual(e);
            }
        }
        for (const id of Array.from(this.players.keys())) {
            if (!seen.has(id)) this._remove(id);
        }
    }

    /** Smooths each remote player toward its latest reported pose. */
    update(dt) {
        const alpha = 1 - Math.exp(-dt * 14);
        for (const e of this.players.values()) {
            const dist = e.pos.distanceTo(e.target);
            const before = e.pos.clone();
            if (dist > 40) e.pos.copy(e.target); // teleport (respawn)
            else e.pos.lerp(e.target, alpha);
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
