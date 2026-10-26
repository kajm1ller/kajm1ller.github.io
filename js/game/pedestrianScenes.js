/**
 * js/game/pedestrianScenes.js
 *
 * District life for the pedestrian system: the little scenes that make each part of town feel
 * like itself (see districts.js for who does what where, and when).
 *
 *   picnic, sunbathe, sleepGrass, study   people on the grass in parks and on campus
 *   beerPong, party                       student front yards at night (with music)
 *   yardwork                              mowing and raking in older neighbourhoods
 *   loiter (smoke / drink)                standing around on sidewalks and in parking lots
 *   vomit, passedOut                      the downtown night out catching up with people
 *   queue                                 lines outside the bars, with a bouncer at the door
 *   fight -> arrest                       drunk fist fights, broken up by a cop who cuffs the winner
 *   arrest, patrol                        police on foot
 *   dogs on leashes, walking groups, joggers in a pack, people heading into and out of
 *   buildings and to their parked cars (handled with PedestrianSystem's walking code)
 *
 * Scene members are ordinary pedestrians in state 'activity' (ped.ai.act points at their role).
 * They can be talked to, shot, run over and punched like anyone else; whoever drops out leaves
 * the scene, and a scene ends once it has too few people left. Props (beer pong tables, picnic
 * blankets, mowers, dogs, puddles...) are drawn by the pedestrian instanced renderer, so the
 * whole cast costs a handful of extra draw calls.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DOOR_KIND } from './districts.js';

const TWO_PI = Math.PI * 2;

export const SCENE_CONFIG = Object.freeze({
    QUEUE_GAP: 0.85,
    QUEUE_ENTER_MIN: 5,
    QUEUE_ENTER_MAX: 13,
    FIGHT_MIN: 9,
    FIGHT_MAX: 22,
    COP_SPAWN_MIN: 55,
    COP_SPAWN_MAX: 110,
    ARREST_TIME: 16,
    PUDDLE_LIFE: 240,
    MAX_PUDDLES: 24,
    MUSIC_RANGE: 85
});

// ================================================================================================
// Prop geometry (merged into the pedestrian renderer's instanced parts)
// ================================================================================================
function box(w, h, d, x = 0, y = 0, z = 0, rotX = 0, rotZ = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rotX) g.rotateX(rotX);
    if (rotZ) g.rotateZ(rotZ);
    g.translate(x, y, z);
    return g;
}

function cyl(rt, rb, h, x = 0, y = 0, z = 0, seg = 10) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    g.translate(x, y, z);
    return g;
}

/** Ten red cups racked in a triangle, centred on the origin, pointing towards +Z. */
function cupRack() {
    const cups = [];
    const s = 0.1;
    for (let row = 0; row < 4; row++) {
        for (let k = 0; k <= row; k++) {
            cups.push(cyl(0.045, 0.032, 0.12, (k - row / 2) * s, 0.06, (row - 1.5) * s * 0.87, 8));
        }
    }
    return mergeGeometries(cups);
}

/**
 * Part name -> { slots: instances per pedestrian of capacity, geo: () => BufferGeometry }.
 * Hand-held items are built in the hand joint's frame (forearm along -Y, fingers at y = 0).
 */
export const PROP_PARTS = {
    cup: { slots: 0.5, geo: () => cyl(0.045, 0.033, 0.12, 0, -0.02, 0.05, 8) },
    bottle: { slots: 0.15, geo: () => mergeGeometries([cyl(0.032, 0.032, 0.17, 0, -0.03, 0.05, 8), cyl(0.012, 0.02, 0.08, 0, 0.09, 0.05, 6)]) },
    cigarette: { slots: 0.35, geo: () => box(0.012, 0.012, 0.085, 0.02, -0.02, 0.06) },
    bag: { slots: 0.5, geo: () => mergeGeometries([box(0.3, 0.32, 0.13, 0, -0.24, 0.02), box(0.02, 0.1, 0.02, 0.06, -0.04, 0.02), box(0.02, 0.1, 0.02, -0.06, -0.04, 0.02)]) },
    notebook: { slots: 0.15, geo: () => box(0.2, 0.025, 0.27, 0, -0.03, 0.08) },
    flashlight: { slots: 0.05, geo: () => mergeGeometries([cyl(0.022, 0.022, 0.2, 0, -0.02, 0.06, 8), cyl(0.034, 0.024, 0.05, 0, 0.09, 0.06, 8)]) },
    leash: { slots: 0.1, geo: () => box(0.014, 0.014, 1.0) },
    // What other players hold (multiplayer.js): a long gun, a needle, a pipe, a little bag
    rifle: {
        slots: 0.04,
        geo: () => mergeGeometries([
            box(0.05, 0.78, 0.07, 0, -0.2, 0.0),        // barrel and body along the forearm
            box(0.05, 0.22, 0.1, 0, 0.2, -0.02),        // stock back towards the shoulder
            box(0.04, 0.05, 0.12, 0, 0.0, 0.06),        // grip
            box(0.04, 0.12, 0.05, 0, -0.12, 0.07)       // magazine
        ])
    },
    syringe: { slots: 0.03, geo: () => mergeGeometries([cyl(0.011, 0.011, 0.1, 0, 0, 0.06, 6), cyl(0.002, 0.002, 0.05, 0, -0.075, 0.06, 4)]) },
    pipe: { slots: 0.03, geo: () => mergeGeometries([cyl(0.01, 0.01, 0.14, 0, -0.01, 0.06, 6), new THREE.SphereGeometry(0.028, 8, 6).translate(0, -0.09, 0.06)]) },
    baggie: { slots: 0.03, geo: () => box(0.06, 0.08, 0.012, 0, -0.03, 0.06) },
    // Scene props
    pongTable: {
        slots: 0.06,
        geo: () => mergeGeometries([
            box(0.62, 0.04, 2.45, 0, 0.74, 0),
            box(0.04, 0.72, 0.04, 0.27, 0.36, 1.15), box(0.04, 0.72, 0.04, -0.27, 0.36, 1.15),
            box(0.04, 0.72, 0.04, 0.27, 0.36, -1.15), box(0.04, 0.72, 0.04, -0.27, 0.36, -1.15)
        ])
    },
    pongCups: { slots: 0.12, geo: () => cupRack() },
    ball: { slots: 0.06, geo: () => new THREE.SphereGeometry(0.022, 8, 6) },
    blanket: { slots: 0.15, geo: () => box(1.9, 0.02, 1.45, 0, 0.01, 0) },
    towel: { slots: 0.12, geo: () => box(0.8, 0.018, 1.8, 0, 0.009, 0) },
    basket: { slots: 0.06, geo: () => mergeGeometries([box(0.42, 0.24, 0.3, 0, 0.12, 0), box(0.04, 0.16, 0.04, 0, 0.3, 0)]) },
    speaker: { slots: 0.06, geo: () => box(0.42, 0.85, 0.38, 0, 0.425, 0) },
    mower: {
        slots: 0.04,
        geo: () => mergeGeometries([
            box(0.52, 0.22, 0.62, 0, 0.2, 0),
            cyl(0.13, 0.15, 0.12, 0, 0.36, 0.05, 10),
            box(0.03, 0.03, 0.75, 0.2, 0.62, -0.55, 0.85), box(0.03, 0.03, 0.75, -0.2, 0.62, -0.55, 0.85),
            box(0.44, 0.03, 0.03, 0, 0.92, -0.86)
        ])
    },
    rake: {
        slots: 0.04,
        geo: () => mergeGeometries([
            box(0.03, 0.03, 1.55, 0, 0, 0.78),
            box(0.46, 0.04, 0.05, 0, -0.02, 1.55),
            box(0.44, 0.08, 0.012, 0, -0.07, 1.57)
        ])
    },
    puddle: {
        slots: 0.15,
        geo: () => {
            const g = new THREE.CircleGeometry(0.45, 12);
            g.rotateX(-Math.PI / 2);
            g.scale(1, 1, 0.7);
            g.translate(0, 0.025, 0);
            return g;
        }
    },
    // Dogs (body hangs from the root at shoulder height, legs from the body)
    dogBody: { slots: 0.08, geo: () => mergeGeometries([box(0.24, 0.24, 0.62, 0, 0, 0), box(0.18, 0.2, 0.12, 0, 0.07, 0.31)]) },
    dogHead: {
        slots: 0.08,
        geo: () => mergeGeometries([
            box(0.2, 0.2, 0.22, 0, 0.06, 0.06),
            box(0.11, 0.1, 0.14, 0, 0.0, 0.22),
            box(0.05, 0.11, 0.04, 0.075, 0.18, 0.02), box(0.05, 0.11, 0.04, -0.075, 0.18, 0.02)
        ])
    },
    dogLeg: { slots: 0.32, geo: () => box(0.075, 0.36, 0.08, 0, -0.18, 0) },
    dogTail: { slots: 0.08, geo: () => box(0.04, 0.04, 0.26, 0, 0, -0.13) }
};

/** A prop drawn by the pedestrian renderer: { mesh: Group, rig.bindings } like a ped. */
export function makeProp(parts, x, z, yaw = 0) {
    const root = new THREE.Group();
    root.userData.spec = parts.map((q) => q.slice());   // what a replica needs to build the same prop
    root.position.set(x, 0, z);
    root.rotation.y = yaw;
    const bindings = [];
    for (const [part, color, px = 0, py = 0, pz = 0, ry = 0] of parts) {
        let j = root;
        if (px || py || pz || ry) {
            j = new THREE.Object3D();
            j.position.set(px, py, pz);
            j.rotation.y = ry;
            root.add(j);
        }
        bindings.push({ part, joint: j, color: new THREE.Color(color) });
    }
    root.userData.rig = { bindings };
    return { mesh: root, position: root.position };
}

// ================================================================================================
// Dogs
// ================================================================================================
const DOG_COLORS = [0x3b2a1d, 0x8b5a2b, 0xd8b26e, 0x1d1d1d, 0xf0ece4, 0x7d7d7d, 0xb5651d, 0xe8d3a8];

export function makeDog(seed) {
    const r = (k) => ((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
    const color = new THREE.Color(DOG_COLORS[Math.floor(r(1) * DOG_COLORS.length)]);
    const dark = color.clone().multiplyScalar(0.55);
    const size = 0.65 + r(2) * 0.6;
    const root = new THREE.Group();
    root.scale.setScalar(size);
    const body = new THREE.Object3D();
    body.position.set(0, 0.45, 0);
    root.add(body);
    const head = new THREE.Object3D();
    head.position.set(0, 0.12, 0.36);
    body.add(head);
    const tail = new THREE.Object3D();
    tail.position.set(0, 0.08, -0.31);
    body.add(tail);
    const legs = [];
    for (const [lx, lz] of [[0.09, 0.22], [-0.09, 0.22], [0.09, -0.22], [-0.09, -0.22]]) {
        const leg = new THREE.Object3D();
        leg.position.set(lx, -0.06, lz);
        body.add(leg);
        legs.push(leg);
    }
    const bindings = [
        { part: 'dogBody', joint: body, color },
        { part: 'dogHead', joint: head, color },
        { part: 'dogTail', joint: tail, color },
        ...legs.map((leg, i) => ({ part: 'dogLeg', joint: leg, color: i < 2 ? color : dark }))
    ];
    root.userData.rig = { bindings };
    return { mesh: root, position: root.position, body, head, tail, legs, size, yaw: 0, phase: 0, speed: 0, owner: null, seed };
}

// ================================================================================================
// Scene director
// ================================================================================================
const BLANKET_COLORS = [0xc0392b, 0x2e86c1, 0xf4d03f, 0x7d3c98, 0x229954, 0xe67e22, 0xf5f5f5];
const TOWEL_COLORS = [0xf06292, 0x4fc3f7, 0xffeb3b, 0xffffff, 0xff7043, 0x81c784, 0xba68c8];
const MOWER_COLORS = [0xc0392b, 0x2e7d32, 0xf39c12];

const rand = Math.random;
const between = (a, b) => a + rand() * (b - a);
const angleDiff = (a, b) => {
    let d = (b - a) % TWO_PI;
    if (d > Math.PI) d -= TWO_PI;
    if (d < -Math.PI) d += TWO_PI;
    return d;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fwdX = (yaw) => Math.sin(yaw);
const fwdZ = (yaw) => Math.cos(yaw);

export class SceneDirector {
    /** @param {import('./pedestrians.js').PedestrianSystem} sys */
    constructor(sys) {
        this.sys = sys;
        this.scenes = new Set();
        this.dogs = [];
        this.puddles = [];
        this.flying = [];             // beer pong balls in the air
        this.extras = [];             // everything the renderer should draw besides people
        this.music = [];              // { x, z, gain, muffled } sources for PartyMusic
        this._v = new THREE.Vector3();
        this._w = new THREE.Vector3();
        this._buf = [];
        this.queueDoors = new Set();
        this.spotUsed = new Set();    // hangout spots taken by a scene
    }

    // --------------------------------------------------------------------------------------------
    // Helpers
    // --------------------------------------------------------------------------------------------
    _scene(type, x, z, extra = {}) {
        const s = Object.assign({ type, x, z, members: [], props: [], timer: 0, age: 0, ended: false }, extra);
        this.scenes.add(s);
        if (s.spot !== undefined) this.spotUsed.add(s.spot);
        return s;
    }

    _join(scene, ped, role, slot, pose, extra = {}) {
        ped.state = 'activity';
        ped.ai.cat = scene.cat || 'scene';
        ped.ai.act = Object.assign({ scene, role, x: slot.x, z: slot.z, yaw: slot.yaw, pose, gesture: 0, gestureT: between(2, 8) }, extra);
        ped.ai.path = null;
        ped.ai.direct = null;
        scene.members.push(ped);
        return ped;
    }

    _spawnMember(scene, style, role, slot, pose, extra) {
        const ped = this.sys._makePed(slot.x, slot.z, slot.yaw, style);
        ped.mesh.position.set(slot.x, 0, slot.z);
        ped.ai.yaw = slot.yaw;
        ped.ai.pose = pose;
        return this._join(scene, ped, role, slot, pose, extra);
    }

    /** Releases a member back into ordinary walking life. */
    _toWalker(ped) {
        const ai = ped.ai;
        const rig = ped.mesh.userData.rig;
        // Rakes and notebooks stay behind; a drink or a cigarette comes along
        if (ai.act && ai.act.rakeProp) this.sys.setProp(ped, 'T', null);
        if (rig && rig.props.L && rig.props.L.part === 'notebook') this.sys.setProp(ped, 'L', null);
        ai.carry = !!(rig && rig.props.R);
        ai.overlay = null;
        ai.act = null;
        ai.speaking = false;
        ai.look = 0;
        ai.path = null;
        ai.goal = null;
        ai.stops = null;
        ai.cat = 'walker';
        if (ped.state === 'activity') ped.state = 'walking';
    }

    _end(scene) {
        if (scene.ended) return;
        scene.ended = true;
        for (const ped of scene.members.slice()) {
            if (ped.ai && ped.ai.act && ped.ai.act.scene === scene && ped.state === 'activity' && !ped.isDead) {
                if (!ped.ai.act.stay) this._toWalker(ped);
            }
        }
        if (scene.type === 'queue') this.queueDoors.delete(scene.door);
        if (scene.spot !== undefined) this.spotUsed.delete(scene.spot);
        this.scenes.delete(scene);
    }

    /** A member left (died, fled, despawned, punched): drop them from their scene. */
    release(ped) {
        const act = ped.ai && ped.ai.act;
        if (!act) return;
        const scene = act.scene;
        ped.ai.act = null;
        if (!scene) return;
        const i = scene.members.indexOf(ped);
        if (i >= 0) scene.members.splice(i, 1);
        if (scene.leader === ped) scene.leader = null;
        const minimum = scene.type === 'beerPong' ? 3 : scene.type === 'fight' ? (scene.phase === 'fight' ? 2 : 1) : 1;
        if (scene.members.length < minimum) this._end(scene);
    }

    /** Point beside a walk node, off the walking line (towards whichever side has room). */
    _besideNode(node, dist) {
        const nav = this.sys.nav;
        let ex = 1, ez = 0;
        const s0 = nav.adjStart[node], s1 = nav.adjStart[node + 1];
        for (let k = s0; k < s1; k++) {
            if (nav.adjKind[k] !== 0) continue;
            const nb = nav.adjNode[k];
            ex = nav.nodeX[nb] - nav.nodeX[node];
            ez = nav.nodeZ[nb] - nav.nodeZ[node];
            break;
        }
        const el = Math.hypot(ex, ez) || 1;
        const side = rand() < 0.5 ? 1 : -1;
        return {
            x: nav.nodeX[node] + (-ez / el) * dist * side,
            z: nav.nodeZ[node] + (ex / el) * dist * side,
            ax: ex / el, az: ez / el
        };
    }

    _circle(cx, cz, n, r, a0, faceIn = true) {
        const out = [];
        for (let i = 0; i < n; i++) {
            const a = a0 + (i / n) * TWO_PI + between(-0.2, 0.2);
            const rr = r * between(0.9, 1.1);
            const x = cx + Math.sin(a) * rr, z = cz + Math.cos(a) * rr;
            out.push({ x, z, yaw: faceIn ? Math.atan2(cx - x, cz - z) : a });
        }
        return out;
    }

    // --------------------------------------------------------------------------------------------
    // Spawning (called by PedestrianSystem's population upkeep). Each returns people spawned.
    // --------------------------------------------------------------------------------------------
    /** Grass / yard hangout spot activities. */
    spawnSpot(type, spot, style) {
        const nav = this.sys.nav;
        const x = nav.hangX[spot], z = nav.hangZ[spot];
        const a0 = rand() * TWO_PI;
        switch (type) {
            case 'picnic': {
                const s = this._scene('picnic', x, z, { cat: 'group', timer: between(150, 420), spot });
                const n = 2 + ((rand() * 3) | 0);
                s.props.push(makeProp([['blanket', BLANKET_COLORS[(rand() * BLANKET_COLORS.length) | 0]], ['basket', 0x8d6e43, 0.5, 0, 0.3]], x, z, a0));
                for (const slot of this._circle(x, z, n, 1.05, a0)) this._spawnMember(s, style, 'picnic', slot, 'sitGround', { talk: true, eat: true });
                return n;
            }
            case 'sunbathe': {
                const s = this._scene('sunbathe', x, z, { cat: 'group', timer: between(200, 600), spot });
                const n = rand() < 0.5 ? 1 : 2;
                for (let i = 0; i < n; i++) {
                    const lx = Math.cos(a0) * (i - (n - 1) / 2) * 1.05, lz = -Math.sin(a0) * (i - (n - 1) / 2) * 1.05;
                    const cx = x + lx, cz = z + lz;
                    s.props.push(makeProp([['towel', TOWEL_COLORS[(rand() * TOWEL_COLORS.length) | 0]]], cx, cz, a0));
                    // Feet at the towel's end, lying back along it
                    const slot = { x: cx + fwdX(a0) * 0.85, z: cz + fwdZ(a0) * 0.85, yaw: a0 };
                    this._spawnMember(s, style === 'older' ? 'adult' : style, 'lie', slot, rand() < 0.5 ? 'lieBack' : 'lieBackArms', { stay: true });
                }
                return n;
            }
            case 'sleepGrass': {
                const s = this._scene('sleepGrass', x, z, { cat: 'group', timer: between(200, 700), spot });
                this._spawnMember(s, style, 'lie', { x, z, yaw: a0 }, rand() < 0.6 ? 'lieBack' : 'lieSide', { stay: true, snore: true });
                return 1;
            }
            case 'study': {
                const s = this._scene('study', x, z, { cat: 'group', timer: between(150, 500), spot });
                const n = 1 + ((rand() * 3) | 0);
                for (const slot of this._circle(x, z, n, n > 1 ? 0.9 : 0.01, a0)) {
                    if (n === 1) slot.yaw = a0;
                    const ped = this._spawnMember(s, 'student', 'study', slot, 'sitGround', { write: true, talk: n > 1 });
                    this.sys.setProp(ped, 'L', 'notebook', 0xf5f5f0);
                }
                return n;
            }
            case 'beerPong': return this._spawnBeerPong(x, z, a0, spot);
            case 'party': return this._spawnParty(x, z, a0, spot);
            case 'yardwork': return this._spawnYardwork(x, z, a0, spot);
            default: return 0;
        }
    }

    _spawnBeerPong(x, z, a0, spot) {
        const s = this._scene('beerPong', x, z, { cat: 'group', timer: between(300, 900), spot, yaw: a0, side: 0, turn: 0, phase: 'wait', t: 1.5, music: true });
        s.props.push(makeProp([
            ['pongTable', rand() < 0.5 ? 0xf2f2f2 : 0x6b4a2b],
            ['pongCups', 0xd32f2f, 0, 0.76, 0.95, Math.PI],
            ['pongCups', 0xd32f2f, 0, 0.76, -0.95, 0]
        ], x, z, a0));
        s.ball = makeProp([['ball', 0xffffff]], x, z, 0);
        const fx = fwdX(a0), fz = fwdZ(a0), rx = Math.cos(a0), rz = -Math.sin(a0);
        for (let side = 0; side < 2; side++) {
            const sign = side === 0 ? 1 : -1;
            for (let k = 0; k < 2; k++) {
                const lat = k === 0 ? 0.33 : -0.33;
                const slot = { x: x + fx * 1.62 * sign + rx * lat, z: z + fz * 1.62 * sign + rz * lat, yaw: a0 + (side === 0 ? Math.PI : 0) };
                const ped = this._spawnMember(s, 'partier', 'pong', slot, 'stand', { side, idx: k });
                if (rand() < 0.6) this.sys.setProp(ped, 'L', 'cup', 0xd32f2f);
            }
        }
        const spectators = (rand() * 4) | 0;
        for (let i = 0; i < spectators; i++) {
            const along = between(-1.2, 1.2), lat = (rand() < 0.5 ? 1 : -1) * between(1.4, 2.2);
            const px = x + fx * along + rx * lat, pz = z + fz * along + rz * lat;
            const ped = this._spawnMember(s, 'partier', 'drink', { x: px, z: pz, yaw: Math.atan2(x - px, z - pz) }, 'stand', { drink: true, talk: true });
            this.sys.setProp(ped, 'R', 'cup', 0xd32f2f);
        }
        return 4 + spectators;
    }

    _spawnParty(x, z, a0, spot) {
        const s = this._scene('party', x, z, { cat: 'group', timer: between(300, 900), spot, music: true });
        s.props.push(makeProp([['speaker', 0x151515]], x + fwdX(a0) * 2.4, z + fwdZ(a0) * 2.4, a0 + Math.PI));
        const n = 4 + ((rand() * 4) | 0);
        for (let i = 0; i < n; i++) {
            const a = rand() * TWO_PI, r = between(0.4, 1.9);
            const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
            const dancer = rand() < 0.7;
            const ped = this._spawnMember(s, 'partier', dancer ? 'dance' : 'drink',
                { x: px, z: pz, yaw: Math.atan2(x - px, z - pz) + between(-0.6, 0.6) }, dancer ? 'dance' : 'stand', { drink: !dancer, talk: !dancer });
            if (!dancer || rand() < 0.5) this.sys.setProp(ped, 'R', rand() < 0.8 ? 'cup' : 'bottle', rand() < 0.8 ? 0xd32f2f : 0x5d4037);
        }
        return n;
    }

    _spawnYardwork(x, z, a0, spot) {
        const nav = this.sys.nav;
        const s = this._scene('yardwork', x, z, { cat: 'group', timer: between(180, 500), spot });
        const mow = rand() < 0.55;
        // Work the strip of lawn between the spot and the sidewalk, along the street (the house is
        // on the other side)
        const acc = nav.hangAccess[spot];
        let tx = nav.nodeX[acc] - x, tz = nav.nodeZ[acc] - z;
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        const ax = -tz, az = tx;
        const slot = { x: x - ax * 2.5, z: z - az * 2.5, yaw: Math.atan2(ax, az) };
        const ped = this._spawnMember(s, 'older', mow ? 'mow' : 'rake', slot, 'stand',
            { stay: false, ax, az, tx, tz, reach: Math.min(2.2, Math.max(0.5, tl - 2.5)), lane: 0, dir: 1, cx: x, cz: z, len: 2.5 });
        if (mow) {
            s.mower = makeProp([['mower', MOWER_COLORS[(rand() * MOWER_COLORS.length) | 0]]], slot.x, slot.z, a0);
            s.props.push(s.mower);
        } else {
            ped.ai.act.rakeProp = true;
            this.sys.setProp(ped, 'T', 'rake', 0x8d6e43);
        }
        return 1;
    }

    /** Sidewalk scenes. `node` is a walk node out of the player's view. */
    spawnStreet(type, node, style, opts = {}) {
        const nav = this.sys.nav;
        switch (type) {
            case 'smoke':
            case 'drink': {
                const p = this._besideNode(node, between(0.6, 1.4));
                const s = this._scene('loiter', p.x, p.z, { timer: between(60, 240) });
                const n = type === 'smoke' ? 1 + ((rand() * 3) | 0) : 2 + ((rand() * 3) | 0);
                const sitting = opts.sit && rand() < 0.5;
                const slots = n === 1 ? [{ x: p.x, z: p.z, yaw: rand() * TWO_PI }] : this._circle(p.x, p.z, n, 0.55 + n * 0.08, rand() * TWO_PI);
                for (const slot of slots) {
                    const smokes = type === 'smoke' ? rand() < 0.85 : rand() < 0.25;
                    const ped = this._spawnMember(s, style, 'loiter', slot, sitting ? 'sitGround' : 'stand', { talk: n > 1, smoke: smokes, drink: !smokes, hand: true });
                    if (smokes) this.sys.setProp(ped, 'R', 'cigarette', 0xf4f4f4);
                    else this.sys.setProp(ped, 'R', rand() < 0.7 ? 'cup' : 'bottle', rand() < 0.7 ? 0xd32f2f : 0x2e7d32);
                }
                return n;
            }
            case 'vomit': {
                const p = this._besideNode(node, between(0.9, 1.6));
                return this.startVomit(null, p.x, p.z, style);
            }
            case 'passedOut': {
                const p = this._besideNode(node, between(1.0, 1.8));
                const s = this._scene('passedOut', p.x, p.z, { timer: Infinity });
                this._spawnMember(s, style, 'lie', { x: p.x, z: p.z, yaw: rand() * TWO_PI }, rand() < 0.5 ? 'lieFront' : 'lieSide', { stay: true, snore: true });
                return 1;
            }
            case 'queue': return this._spawnQueue(node, style, opts.doorKinds);
            case 'fight': return this._spawnFight(node, style, opts.arrests);
            case 'arrest': {
                const p = this._besideNode(node, between(0.6, 1.2));
                const s = this._scene('arrest', p.x, p.z, { timer: SCENE_CONFIG.ARREST_TIME + between(5, 20), phase: 'cuff' });
                const yaw = rand() * TWO_PI;
                const suspect = this._spawnMember(s, style, 'suspect', { x: p.x, z: p.z, yaw }, 'kneel', { stay: true });
                const cop = this._spawnMember(s, 'cop', 'cop', { x: p.x - fwdX(yaw) * 0.75, z: p.z - fwdZ(yaw) * 0.75, yaw }, 'cuff', {});
                s.suspect = suspect;
                s.cop = cop;
                return 2;
            }
            default: return 0;
        }
    }

    // ---- Queues outside the bars ----
    _spawnQueue(node, style, kinds) {
        const nav = this.sys.nav;
        const doors = nav.doorsInRing(nav.nodeX[node], nav.nodeZ[node], 0, 90, this._buf);
        let door = -1;
        for (let i = 0; i < doors.length; i++) {
            const d = doors[(i + ((rand() * doors.length) | 0)) % doors.length];
            if (this.queueDoors.has(d)) continue;
            if (kinds ? kinds.includes(nav.doorKind[d]) : nav.doorKind[d] === DOOR_KIND.BAR) { door = d; break; }
        }
        if (door < 0) return 0;
        // The line runs from the door out to the sidewalk, then along it
        const line = this._queueLine(door, 12 * SCENE_CONFIG.QUEUE_GAP + 2);
        if (!line) return 0;
        const s = this._scene('queue', nav.doorX[door], nav.doorZ[door], { door, line, timer: Infinity, enterT: between(3, 8), music: true, muffled: true });
        this.queueDoors.add(door);
        // Bouncer beside the door, facing the street
        const dx = nav.doorX[door], dz = nav.doorZ[door];
        const ox = line.x[1] - line.x[0], oz = line.z[1] - line.z[0];
        const ol = Math.hypot(ox, oz) || 1;
        const bx = dx + (-oz / ol) * 0.9 + (ox / ol) * 0.35, bz = dz + (ox / ol) * 0.9 + (oz / ol) * 0.35;
        s.bouncer = this._spawnMember(s, 'bouncer', 'bouncer', { x: bx, z: bz, yaw: Math.atan2(ox, oz) }, 'talk', { cross: true, stay: true });
        s.bouncer.ai.crossArms = true;
        s.target = 4 + ((rand() * 7) | 0);
        let n = 1;
        for (let i = 0; i < s.target; i++) {
            const slot = this._queueSlot(s, i);
            this._spawnMember(s, style, 'queue', slot, 'stand', { idx: i, talk: rand() < 0.6, hand: rand() < 0.3 });
            n++;
        }
        return n;
    }

    _queueLine(door, length) {
        const nav = this.sys.nav;
        const xs = [nav.doorX[door]], zs = [nav.doorZ[door]];
        let node = nav.doorAccess[door], prev = -1, total = 0;
        xs.push(nav.nodeX[node]);
        zs.push(nav.nodeZ[node]);
        total += Math.hypot(xs[1] - xs[0], zs[1] - zs[0]);
        if (total > 25) return null;
        let dirX = xs[1] - xs[0], dirZ = zs[1] - zs[0];
        for (let guard = 0; total < length && guard < 30; guard++) {
            // Carry on along the sidewalk, turning as little as possible, never across a street
            let best = -1, bestScore = -Infinity;
            for (let k = nav.adjStart[node]; k < nav.adjStart[node + 1]; k++) {
                const nb = nav.adjNode[k];
                if (nb === prev || nav.adjKind[k] !== 0) continue;
                const ex = nav.nodeX[nb] - nav.nodeX[node], ez = nav.nodeZ[nb] - nav.nodeZ[node];
                const el = Math.hypot(ex, ez) || 1;
                const dl = Math.hypot(dirX, dirZ) || 1;
                const straight = (ex * dirX + ez * dirZ) / (el * dl);
                const score = guard === 0 ? Math.abs(straight) * -1 + rand() * 0.2 : straight;
                if (score > bestScore) { bestScore = score; best = nb; }
            }
            if (best < 0) break;
            dirX = nav.nodeX[best] - nav.nodeX[node];
            dirZ = nav.nodeZ[best] - nav.nodeZ[node];
            total += Math.hypot(dirX, dirZ);
            prev = node;
            node = best;
            xs.push(nav.nodeX[node]);
            zs.push(nav.nodeZ[node]);
        }
        if (total < 5) return null;
        const cum = [0];
        for (let i = 1; i < xs.length; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
        return { x: xs, z: zs, cum, len: total };
    }

    _linePoint(line, s) {
        s = clamp(s, 0, line.len);
        let i = 1;
        while (i < line.cum.length - 1 && line.cum[i] < s) i++;
        const seg = line.cum[i] - line.cum[i - 1] || 1;
        const t = (s - line.cum[i - 1]) / seg;
        const x = line.x[i - 1] + (line.x[i] - line.x[i - 1]) * t;
        const z = line.z[i - 1] + (line.z[i] - line.z[i - 1]) * t;
        // Facing back along the line, towards the door
        return { x, z, yaw: Math.atan2(line.x[i - 1] - line.x[i], line.z[i - 1] - line.z[i]) };
    }

    _queueSlot(scene, idx) {
        return this._linePoint(scene.line, 1.0 + idx * SCENE_CONFIG.QUEUE_GAP);
    }

    // ---- Fights ----
    _spawnFight(node, style, arrests) {
        const p = this._besideNode(node, between(0.2, 1.0));
        const a = rand() * TWO_PI;
        const s = this._scene('fight', p.x, p.z, { timer: between(SCENE_CONFIG.FIGHT_MIN, SCENE_CONFIG.FIGHT_MAX), phase: 'fight', arrests, axis: a });
        const ax = fwdX(a), az = fwdZ(a);
        s.fighters = [
            this._spawnMember(s, 'partier', 'fighter', { x: p.x - ax * 0.6, z: p.z - az * 0.6, yaw: a }, 'fight', { hits: 0 }),
            this._spawnMember(s, 'partier', 'fighter', { x: p.x + ax * 0.6, z: p.z + az * 0.6, yaw: a + Math.PI }, 'fight', { hits: 0 })
        ];
        s.fighters[0].ai.act.foe = s.fighters[1];
        s.fighters[1].ai.act.foe = s.fighters[0];
        for (const f of s.fighters) {
            f.ai.punchCd = between(0.2, 1.0);
            f.ai.drunk = 0.6;
        }
        const n = 2 + ((rand() * 4) | 0);
        for (const slot of this._circle(p.x, p.z, n, between(2.4, 3.2), a + 0.8)) {
            const ped = this._spawnMember(s, 'partier', 'crowd', slot, rand() < 0.3 ? 'film' : 'cheer', { talk: false });
            if (rand() < 0.5) this.sys.setProp(ped, 'L', 'cup', 0xd32f2f);
        }
        return 2 + n;
    }

    /** Sends a cop on foot from somewhere out of view to `scene` (an arrest). */
    _dispatchCop(scene, target) {
        const sys = this.sys;
        const nav = sys.nav;
        const nodes = nav.walkNodesInRing(target.mesh.position.x, target.mesh.position.z, SCENE_CONFIG.COP_SPAWN_MIN, SCENE_CONFIG.COP_SPAWN_MAX, this._buf);
        const goal = nav.nearestWalkNode(target.mesh.position.x, target.mesh.position.z, 25);
        if (goal < 0) return null;
        for (let tries = 0; tries < 10 && nodes.length; tries++) {
            const n = nodes[(rand() * nodes.length) | 0];
            if (sys._lastCtx && !sys._spawnOk(nav.nodeX[n], nav.nodeZ[n], sys._lastCtx, false)) continue;
            const cop = sys._makePed(nav.nodeX[n], nav.nodeZ[n], 0, 'cop');
            cop.ai.cat = 'scene';
            cop.ai.hurryTo = true;
            cop.ai.walkSpeed = 2.9;
            cop.ai.jogger = true;
            cop.ai.goal = { type: 'scene', access: goal, scene, target };
            cop.state = 'walking';
            return cop;
        }
        return null;
    }

    /** PedestrianSystem: a walker with a { type: 'scene' } goal got there. */
    arrived(ped, goal) {
        const scene = goal.scene;
        if (!scene || scene.ended || !this.scenes.has(scene) || !goal.target || goal.target.isDead) {
            ped.ai.jogger = false;
            ped.ai.walkSpeed = 1.3;
            return false;
        }
        const t = goal.target;
        const tp = t.mesh.position;
        // Walk up behind the suspect
        const yaw = t.ai.yaw;
        const slot = { x: tp.x - fwdX(yaw) * 0.75, z: tp.z - fwdZ(yaw) * 0.75, yaw };
        ped.ai.jogger = false;
        ped.ai.walkSpeed = 1.3;
        this._join(scene, ped, 'cop', slot, 'cuff', {});
        scene.cop = ped;
        scene.suspect = t;
        scene.phase = 'cuff';
        scene.timer = SCENE_CONFIG.ARREST_TIME;
        if (t.ai.act) {
            t.ai.act.role = 'suspect';
            t.ai.act.pose = 'kneel';
            t.ai.act.stay = true;
            t.ai.act.x = tp.x;
            t.ai.act.z = tp.z;
            t.ai.act.yaw = yaw;
        }
        return true;
    }

    // ---- Vomiting ----
    /** Someone throws up: an existing (drunk) ped, or a new one at (x, z). */
    startVomit(ped, x, z, style = 'partier') {
        const s = this._scene('vomit', x, z, { timer: between(6, 12), puddleT: 1.4 });
        let n = 0;
        const yaw = rand() * TWO_PI;
        if (ped) {
            this.sys._releaseActivity(ped);
            const p = ped.mesh.position;
            s.x = p.x;
            s.z = p.z;
            this._join(s, ped, 'vomit', { x: p.x, z: p.z, yaw: ped.ai.yaw }, 'vomit', { stay: false });
        } else {
            this._spawnMember(s, style, 'vomit', { x, z, yaw }, 'vomit', {});
            n++;
            if (rand() < 0.45) {
                // A friend standing by, half helping, half laughing
                const fx = x + Math.cos(yaw) * 0.9, fz = z - Math.sin(yaw) * 0.9;
                const f = this._spawnMember(s, style, 'friend', { x: fx, z: fz, yaw: Math.atan2(x - fx, z - fz) }, 'talk', { talk: true });
                if (rand() < 0.5) this.sys.setProp(f, 'R', 'cup', 0xd32f2f);
                n++;
            }
        }
        s.vomiter = s.members[0];
        return n;
    }

    _addPuddle(x, z, yaw) {
        const p = makeProp([['puddle', 0xa39a4a]], x, z, yaw);
        p.life = SCENE_CONFIG.PUDDLE_LIFE;
        this.puddles.push(p);
        if (this.puddles.length > SCENE_CONFIG.MAX_PUDDLES) this.puddles.shift();
    }

    // ---- Walkers with company ----
    /** A dog on a leash for this walker. */
    addDog(owner) {
        const dog = makeDog(owner.index * 7.13 + 1);
        const p = owner.mesh.position;
        dog.mesh.position.set(p.x + 1, 0, p.z);
        dog.owner = owner;
        dog.leash = makeProp([['leash', 0xb71c1c]], p.x, p.z, 0);
        owner.ai.dog = dog;
        this.dogs.push(dog);
        return dog;
    }

    // --------------------------------------------------------------------------------------------
    // Per frame
    // --------------------------------------------------------------------------------------------
    update(dt, ctx) {
        const extras = this.extras;
        extras.length = 0;
        this.music.length = 0;
        const night = ctx.night || 0;

        for (const s of this.scenes) {
            s.age += dt;
            if (s.timer !== Infinity) s.timer -= dt;
            switch (s.type) {
                case 'beerPong': this._tickBeerPong(s, dt); break;
                case 'queue': this._tickQueue(s, dt, ctx); break;
                case 'fight': this._tickFight(s, dt); break;
                case 'arrest': this._tickArrest(s, dt); break;
                case 'vomit': this._tickVomit(s, dt); break;
                case 'yardwork': if (s.mower) this._tickMower(s); break;
                default: break;
            }
            // Parties wind down with daylight, picnics with nightfall
            if ((s.type === 'beerPong' || s.type === 'party') && night < 0.25) s.timer = Math.min(s.timer, 20);
            if ((s.type === 'picnic' || s.type === 'sunbathe' || s.type === 'study') && night > 0.75) s.timer = Math.min(s.timer, 20);
            if (s.timer <= 0) this._end(s);
            if (s.ended) continue;
            for (let i = 0; i < s.props.length; i++) extras.push(s.props[i]);
            if (s.ball && s.ball.visible) extras.push(s.ball);
            if (s.music && s.members.length) this.music.push({ x: s.x, z: s.z, gain: s.type === 'queue' ? 0.8 : 1, muffled: !!s.muffled });
        }

        // Dogs trot along beside their owners
        for (let i = this.dogs.length - 1; i >= 0; i--) {
            const dog = this.dogs[i];
            const o = dog.owner;
            if (!o || !o.mesh || o.ai.dog !== dog || !this.sys.pedestrians.includes(o)) {
                this.dogs.splice(i, 1);
                continue;
            }
            this._tickDog(dog, dt);
            extras.push(dog);
            if (!o.isDead && o.state !== 'ragdoll' && o.state !== 'dying') extras.push(dog.leash);
        }

        for (let i = this.puddles.length - 1; i >= 0; i--) {
            const p = this.puddles[i];
            p.life -= dt;
            if (p.life <= 0) {
                this.puddles.splice(i, 1);
                continue;
            }
            extras.push(p);
        }
    }

    _tickDog(dog, dt) {
        const o = dog.owner;
        const op = o.mesh.position;
        const oy = o.ai.yaw;
        const dead = o.isDead || o.state === 'ragdoll' || o.state === 'dying';
        // Heel on the owner's left, a little ahead; sit by a body
        const side = dead ? 1.0 : 0.85;
        const tx = op.x + Math.cos(oy) * side + fwdX(oy) * (dead ? 0 : 0.55);
        const tz = op.z - Math.sin(oy) * side + fwdZ(oy) * (dead ? 0 : 0.55);
        const p = dog.mesh.position;
        const dx = tx - p.x, dz = tz - p.z;
        const dist = Math.hypot(dx, dz);
        const want = dist < 0.15 ? 0 : clamp(dist * 2.2, 0, 4.5);
        dog.speed += (want - dog.speed) * Math.min(1, dt * 6);
        if (dist > 0.01) {
            const step = Math.min(dist, dog.speed * dt);
            p.x += (dx / dist) * step;
            p.z += (dz / dist) * step;
        }
        if (dist > 12) p.set(tx, 0, tz);
        const faceYaw = dog.speed > 0.3 ? Math.atan2(dx, dz) : oy;
        dog.yaw += angleDiff(dog.yaw, faceYaw) * Math.min(1, dt * 8);
        dog.mesh.rotation.y = dog.yaw;
        this.poseDog(dog, dt, dead);
        this.leashDog(dog, dead);
    }

    /** Gait, tail and head of a dog moving at dog.speed (shared with the replicas of other players' dogs). */
    poseDog(dog, dt, dead) {
        const o = dog.owner;
        // Gait: diagonal legs together; tail wags harder when stopped
        const t = this.sys._time + dog.seed;
        const moving = dog.speed > 0.15;
        dog.phase += (dog.speed / (0.55 * dog.size)) * Math.PI * dt;
        const s = Math.sin(dog.phase) * (moving ? Math.min(0.75, dog.speed * 0.4) : 0);
        dog.legs[0].rotation.x = s;
        dog.legs[3].rotation.x = s;
        dog.legs[1].rotation.x = -s;
        dog.legs[2].rotation.x = -s;
        dog.body.position.y = 0.45 + (moving ? Math.abs(Math.cos(dog.phase)) * 0.025 : 0);
        dog.tail.rotation.set(-0.6, Math.sin(t * (moving ? 9 : 14)) * 0.55, 0);
        // Sniffing around while the owner stands still
        const sniff = !moving && Math.sin(t * 0.7) > 0.2;
        dog.head.rotation.x = sniff ? 0.65 : -0.1 + Math.sin(t * 2) * 0.05;
        dog.head.rotation.y = sniff ? Math.sin(t * 1.3) * 0.4 : 0;
        if (dead) {
            dog.body.rotation.x = -0.25;
            dog.legs[2].rotation.x = dog.legs[3].rotation.x = -1.2;
        } else {
            dog.body.rotation.x = 0;
        }
    }

    /** Leash from the owner's left hand to the collar. */
    leashDog(dog, dead) {
        const o = dog.owner;
        if (!dead && o.mesh.userData.rig) {
            const hand = this._v;
            o.mesh.userData.rig.handL.getWorldPosition(hand);
            const collar = this._w;
            dog.head.getWorldPosition(collar);
            const L = dog.leash.mesh;
            L.position.set((hand.x + collar.x) / 2, (hand.y + collar.y) / 2 - 0.05, (hand.z + collar.z) / 2);
            L.lookAt(collar);
            L.scale.set(1, 1, Math.max(0.05, hand.distanceTo(collar)));
        }
    }

    _tickMower(s) {
        const ped = s.members[0];
        if (!ped || !ped.ai.act) return;
        const y = ped.ai.yaw;
        const p = ped.mesh.position;
        s.mower.mesh.position.set(p.x + fwdX(y) * 0.9, 0, p.z + fwdZ(y) * 0.9);
        s.mower.mesh.rotation.y = y;
    }

    _tickBeerPong(s, dt) {
        s.t -= dt;
        const side = s.members.filter((m) => m.ai.act && m.ai.act.role === 'pong' && m.ai.act.side === s.side);
        if (side.length === 0) {
            s.side = 1 - s.side;
            return;
        }
        const thrower = side[s.turn % side.length];
        if (s.phase === 'wait' && s.t <= 0) {
            s.phase = 'throw';
            s.t = 0;
            s.thrower = thrower;
            thrower.ai.act.throwT = 0;
        } else if (s.phase === 'throw') {
            s.t += dt;
            const th = s.thrower;
            if (!th || !th.ai.act) {
                s.phase = 'wait';
                s.t = 1;
                return;
            }
            th.ai.act.throwT = s.t;
            if (s.t >= 0.42 && !s.ball.visible) {
                // Release: arc to a cup at the far end
                th.mesh.userData.rig.handR.getWorldPosition(this._v);
                const sign = s.side === 0 ? -1 : 1;
                const fx = fwdX(s.yaw), fz = fwdZ(s.yaw), rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
                const along = 1.0 + between(-0.12, 0.25), lat = between(-0.16, 0.16);
                s.ballFrom = { x: this._v.x, y: this._v.y, z: this._v.z };
                s.ballTo = { x: s.x + fx * along * sign + rx * lat, y: 0.86, z: s.z + fz * along * sign + rz * lat };
                s.ballT = 0;
                s.ball.visible = true;
                s.made = rand() < 0.3;
            }
            if (s.ball.visible) {
                s.ballT += dt / 0.8;
                const k = Math.min(1, s.ballT);
                const a = s.ballFrom, b = s.ballTo;
                s.ball.mesh.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k + Math.sin(k * Math.PI) * 0.75, a.z + (b.z - a.z) * k);
                if (k >= 1) {
                    if (s.made === false) {
                        // Bounces off and rolls away
                        s.ballTo = { x: b.x + between(-0.6, 0.6), y: 0.03, z: b.z + between(-0.6, 0.6) };
                        s.ballFrom = { x: b.x, y: b.y, z: b.z };
                        s.ballT = 0;
                        s.made = null;
                    } else {
                        if (s.made === true) {
                            for (const m of side) m.ai.act.celebrate = 1.6;
                        }
                        s.ball.visible = false;
                        s.phase = 'wait';
                        s.t = between(1.2, 2.5);
                        th.ai.act.throwT = -1;
                        s.turn++;
                        if (s.turn % 2 === 0) s.side = 1 - s.side;
                    }
                }
            }
        }
    }

    _tickQueue(s, dt, ctx) {
        const nav = this.sys.nav;
        const line = s.members.filter((m) => m.ai.act && m.ai.act.role === 'queue');
        line.sort((a, b) => a.ai.act.idx - b.ai.act.idx);
        // Keep the slots packed
        for (let i = 0; i < line.length; i++) {
            const act = line[i].ai.act;
            if (act.idx !== i) {
                act.idx = i;
                const slot = this._queueSlot(s, i);
                act.x = slot.x;
                act.z = slot.z;
                act.yaw = slot.yaw;
            }
        }
        s.enterT -= dt;
        if (s.enterT <= 0 && line.length) {
            // The bouncer lets the next one in
            s.enterT = between(SCENE_CONFIG.QUEUE_ENTER_MIN, SCENE_CONFIG.QUEUE_ENTER_MAX);
            const first = line[0];
            first.ai.act.role = 'enter';
            first.ai.act.x = nav.doorX[s.door];
            first.ai.act.z = nav.doorZ[s.door];
            first.ai.act.idx = -1;
            for (let i = 1; i < line.length; i++) line[i].ai.act.idx = i; // shift happens next tick
        }
        // Newcomers join the back while nobody's looking
        if (line.length < s.target && rand() < dt * 0.25) {
            const slot = this._queueSlot(s, line.length);
            if (this.sys._spawnOk(slot.x, slot.z, ctx, false) || Math.hypot(slot.x - ctx.center.x, slot.z - ctx.center.z) > 70) {
                const style = rand() < 0.85 ? 'partier' : 'student';
                this._spawnMember(s, style, 'queue', slot, 'stand', { idx: line.length, talk: rand() < 0.6 });
            }
        }
        if (s.members.length === 0) this._end(s);
    }

    _tickFight(s, dt) {
        if (s.phase === 'fight') {
            const [a, b] = s.fighters;
            const alive = (p) => p && p.ai && p.ai.act && p.ai.act.scene === s && !p.isDead;
            if (!alive(a) || !alive(b)) {
                s.phase = 'over';
                s.timer = 25;
                return;
            }
            if (s.timer <= 0 || a.ai.act.hits >= 7 || b.ai.act.hits >= 7) {
                // Someone goes down
                const loser = a.ai.act.hits > b.ai.act.hits ? a : (b.ai.act.hits > a.ai.act.hits ? b : (rand() < 0.5 ? a : b));
                const winner = loser === a ? b : a;
                loser.ai.act.role = 'ko';
                loser.ai.act.pose = 'lieBack';
                loser.ai.act.stay = true;
                loser.ai.act.yaw = loser.ai.yaw + Math.PI;
                loser.ai.act.x = loser.mesh.position.x;
                loser.ai.act.z = loser.mesh.position.z;
                loser.ai.act.wake = between(30, 60);
                winner.ai.act.role = 'winner';
                winner.ai.act.pose = 'cheer';
                winner.ai.act.celebrate = 2.5;
                winner.ai.act.x = winner.mesh.position.x;
                winner.ai.act.z = winner.mesh.position.z;
                s.phase = 'down';
                s.timer = 90;
                s.winner = winner;
                for (const m of s.members) {
                    if (m.ai.act && m.ai.act.role === 'crowd') m.ai.act.leaveT = between(4, 20);
                }
                if (s.arrests && this._dispatchCop(s, winner)) s.copComing = true;
                else s.timer = 25;
            }
        } else if (s.phase === 'cuff') {
            this._tickArrest(s, dt);
        }
        // The crowd drifts off
        for (const m of s.members.slice()) {
            const act = m.ai.act;
            if (!act) continue;
            if (act.leaveT !== undefined) {
                act.leaveT -= dt;
                if (act.leaveT <= 0) {
                    this.release(m);
                    this._toWalker(m);
                    m.ai.drunk = 0.6;
                }
            }
            if (act.role === 'ko') {
                act.wake -= dt;
                if (act.wake <= 0) {
                    this.release(m);
                    this._toWalker(m);
                    m.ai.drunk = 1;
                }
            }
        }
    }

    _tickArrest(s, dt) {
        if (s.phase !== 'cuff') return;
        const cop = s.cop, sus = s.suspect;
        if (!cop || !sus || cop.isDead || sus.isDead || !cop.ai.act || !sus.ai.act) {
            s.timer = Math.min(s.timer, 0.1);
            return;
        }
        if (s.timer <= 0.2) {
            // Led away: the suspect walks in front with their hands behind their back
            s.phase = 'away';
            this.release(sus);
            this.release(cop);
            this._toWalker(cop);
            this._toWalker(sus);
            sus.ai.cuffed = true;
            sus.ai.leader = cop;
            sus.ai.followSlot = 0;
            sus.state = 'following';
        }
    }

    _tickVomit(s, dt) {
        const v = s.vomiter;
        if (!v || !v.ai.act || v.ai.act.scene !== s) return;
        if (s.puddleT > 0) {
            s.puddleT -= dt;
            if (s.puddleT <= 0) {
                const p = v.mesh.position, y = v.ai.yaw;
                this._addPuddle(p.x + fwdX(y) * 0.75, p.z + fwdZ(y) * 0.75, y);
            }
        }
        if (s.timer <= 0.1) {
            // Back on their feet, unsteadily; the friend follows
            for (const m of s.members) m.ai.drunk = Math.max(m.ai.drunk || 0, 0.8);
            const friend = s.members.find((m) => m !== v);
            if (friend && v.ai) {
                this.release(friend);
                this._toWalker(friend);
                friend.ai.leader = v;
                friend.ai.followSlot = 0;
                friend.state = 'following';
            }
        }
    }

    /** State 'activity': get to your spot, then do your thing. */
    updatePed(ped, dt, ctx) {
        const ai = ped.ai;
        const act = ai.act;
        if (!act || !act.scene || act.scene.ended) {
            this._toWalker(ped);
            return;
        }
        const s = act.scene;
        const p = ped.mesh.position;

        if (act.role === 'enter') {
            // Through the door and gone
            if (this.sys._moveTo(ped, act.x, act.z, 1.2, dt, 0.3)) {
                ai.vanish = true;
            }
            ai.pose = 'walk';
            return;
        }
        if (act.role === 'mow' || act.role === 'rake') {
            this._updateYardwork(ped, act, dt);
            return;
        }
        if (act.role === 'fighter') {
            this._updateFighter(ped, act, dt);
            return;
        }

        // Walk to the spot first
        const d = Math.hypot(act.x - p.x, act.z - p.z);
        const lying = act.pose === 'lieBack' || act.pose === 'lieFront' || act.pose === 'lieSide' || act.pose === 'lieBackArms';
        if ((d > 0.12 && !lying) || d > 1.5) {
            this.sys._moveTo(ped, act.x, act.z, d > 3 ? ai.walkSpeed : 0.9, dt, 0.08);
            ai.pose = 'walk';
            return;
        }
        ai.moveSpeed = 0;
        this.sys._turnTowards(ped, act.yaw, dt, 4);
        ai.pose = act.celebrate > 0 ? 'cheer' : act.pose;
        if (act.celebrate > 0) act.celebrate -= dt;

        // Conversation: whoever's turn it is talks, the others look at them
        if (act.talk) {
            if (!s.speaker || !s.members.includes(s.speaker) || (s.speakerT -= dt) <= 0) {
                const talkers = s.members.filter((m) => m.ai.act && m.ai.act.talk);
                s.speaker = talkers[(rand() * talkers.length) | 0] || null;
                s.speakerT = between(2.5, 7);
            }
            ai.speaking = s.speaker === ped;
            if (!ai.speaking && s.speaker) {
                const sp = s.speaker.mesh.position;
                ai.look = clamp(angleDiff(ai.yaw, Math.atan2(sp.x - p.x, sp.z - p.z)), -1.1, 1.1);
            } else {
                ai.look = Math.sin(this.sys._time * 0.8 + ai.seed) * 0.3;
            }
        } else if (act.role === 'crowd' || act.role === 'friend') {
            // Watching the action
            const tgt = s.fighters ? s.fighters[0] : s.vomiter;
            if (tgt) ai.look = clamp(angleDiff(ai.yaw, Math.atan2(tgt.mesh.position.x - p.x, tgt.mesh.position.z - p.z)), -1.2, 1.2);
        } else if (act.role === 'pong' && s.thrower && s.thrower !== ped && s.ball && s.ball.visible) {
            const b = s.ball.mesh.position;
            ai.look = clamp(angleDiff(ai.yaw, Math.atan2(b.x - p.x, b.z - p.z)), -1.2, 1.2);
        } else {
            ai.look = act.pose === 'stand' || act.pose === 'talk' ? Math.sin(this.sys._time * 0.4 + ai.seed) * 0.6 : 0;
        }

        // Smoke / sip / bite every few seconds
        act.gestureT -= dt;
        if (act.gestureT <= 0) {
            act.gesture = act.gesture > 0 ? 0 : 1;
            act.gestureT = act.gesture ? between(1.4, 2.6) : between(3, 9);
        }
    }

    _updateYardwork(ped, act, dt) {
        const ai = ped.ai;
        if (act.role === 'mow') {
            // Up and down the lawn in stripes, working towards the street
            const lat = (act.lane / 5) * act.reach;
            const tx = act.cx + act.ax * act.len * act.dir + act.tx * lat;
            const tz = act.cz + act.az * act.len * act.dir + act.tz * lat;
            if (this.sys._moveTo(ped, tx, tz, 0.85, dt, 0.2)) {
                act.dir = -act.dir;
                act.lane = (act.lane + 1) % 6;
            }
            ai.pose = 'walk';
            ai.overlay = 'push';
        } else {
            // Raking: slow steps between strokes
            act.gestureT -= dt;
            if (act.gestureT <= 0) {
                act.gestureT = between(4, 9);
                const along = between(-2.2, 2.2), out = between(0, act.reach);
                act.stepX = act.cx + act.ax * along + act.tx * out;
                act.stepZ = act.cz + act.az * along + act.tz * out;
            }
            if (act.stepX !== undefined && !this.sys._moveTo(ped, act.stepX, act.stepZ, 0.6, dt, 0.2)) {
                ai.pose = 'walk';
            } else {
                ai.moveSpeed = 0;
                ai.pose = 'rake';
            }
            ai.overlay = 'rake';
        }
    }

    _updateFighter(ped, act, dt) {
        const ai = ped.ai;
        const foe = act.foe;
        const s = act.scene;
        if (s.phase !== 'fight' || !foe || foe.isDead) {
            ai.pose = 'stand';
            return;
        }
        const p = ped.mesh.position, fp = foe.mesh.position;
        const dx = fp.x - p.x, dz = fp.z - p.z;
        const dist = Math.hypot(dx, dz) || 1;
        this.sys._turnTowards(ped, Math.atan2(dx, dz), dt, 8);
        ai.look = 0;
        // Circle and close in
        const want = 1.05;
        const circle = Math.sin(this.sys._time * 0.9 + ai.seed) * 0.6;
        const step = clamp(dist - want, -1, 1) * 1.8 * dt;
        p.x += (dx / dist) * step + (-dz / dist) * circle * dt;
        p.z += (dz / dist) * step + (dx / dist) * circle * dt;
        ai.moveSpeed = Math.abs(step) / dt;
        ai.pose = 'fight';
        ai.punchCd -= dt;
        if (ai.punching <= 0 && ai.punchCd <= 0 && dist < 1.5 && ai.flinch < 0.3) {
            ai.punching = 0.0001;
            ai.punchArm = -ai.punchArm;
            ai.hitThisSwing = false;
        }
        if (ai.punching > 0) {
            ai.punching += dt;
            if (!ai.hitThisSwing && ai.punching >= 0.24) {
                ai.hitThisSwing = true;
                if (dist < 1.45 && rand() < 0.65) {
                    foe.ai.flinch = 1;
                    foe.ai.flinchSide = rand() < 0.5 ? 1 : -1;
                    foe.ai.punching = 0;
                    fp.x += (dx / dist) * 0.2;
                    fp.z += (dz / dist) * 0.2;
                    if (foe.ai.act) foe.ai.act.hits++;
                }
            }
            if (ai.punching >= 0.5) {
                ai.punching = 0;
                ai.punchCd = between(0.5, 1.6);
            }
        }
    }

    // --------------------------------------------------------------------------------------------
    // Poses
    // --------------------------------------------------------------------------------------------
    /** Full-body poses the base animator doesn't know. Returns head pitch, or null if not ours. */
    pose(ped, rig, t, pose) {
        const ai = ped.ai;
        const act = ai.act;
        const h = ped.mesh.scale.y || 1;
        switch (pose) {
            case 'sitGround': {
                // On the grass: legs crossed or stretched out, leaning back on the hands
                rig.body.position.y = 0.14 / h - 0.92;
                const crossed = (ai.seed % 1) < 0.5;
                if (crossed) {
                    rig.legL.rotation.set(-1.35, 0, 0.75);
                    rig.legR.rotation.set(-1.35, 0, -0.75);
                    rig.kneeL.rotation.x = 2.3;
                    rig.kneeR.rotation.x = 2.3;
                } else {
                    rig.legL.rotation.set(-1.45, 0, 0.12);
                    rig.legR.rotation.set(-1.3, 0, -0.1);
                    rig.kneeL.rotation.x = 0.25;
                    rig.kneeR.rotation.x = 0.7;
                }
                rig.torso.rotation.x = act && act.write ? 0.25 : -0.15;
                rig.shoulderL.rotation.set(0.55, 0, 0.25);
                rig.shoulderR.rotation.set(0.55, 0, -0.25);
                rig.elbowL.rotation.x = -0.1;
                rig.elbowR.rotation.x = -0.1;
                let pitch = 0;
                if (act && act.write) {
                    // Notebook on the lap, pen hand scribbling
                    rig.shoulderL.rotation.set(-0.55, 0, -0.2);
                    rig.elbowL.rotation.x = -0.9;
                    rig.shoulderR.rotation.set(-0.5 + Math.sin(t * 2.3) * 0.05, 0, 0.25);
                    rig.elbowR.rotation.set(-1.0 + Math.sin(t * 9) * 0.08, Math.sin(t * 5.3) * 0.15, 0);
                    pitch = 0.55;
                }
                return pitch + this._handGesture(ped, rig, t);
            }
            case 'lieBack':
            case 'lieBackArms':
            case 'lieFront':
            case 'lieSide': {
                const front = pose === 'lieFront';
                rig.body.rotation.x = front ? Math.PI / 2 : -Math.PI / 2;
                if (pose === 'lieSide') rig.body.rotation.set(0, 0, Math.PI / 2);
                rig.body.position.y = 0.13 / h;
                rig.body.position.z = front ? -0.04 : 0;
                const breathe = Math.sin(t * (act && act.snore ? 1.1 : 1.6)) * 0.02;
                rig.torso.rotation.x = breathe;
                if (pose === 'lieBackArms') {
                    rig.shoulderL.rotation.set(-2.9, 0, -0.35);
                    rig.shoulderR.rotation.set(-2.9, 0, 0.35);
                    rig.elbowL.rotation.x = -2.2;
                    rig.elbowR.rotation.x = -2.2;
                } else if (pose === 'lieSide') {
                    rig.shoulderL.rotation.set(-1.2, 0, 0.2);
                    rig.shoulderR.rotation.set(-1.0, 0, -0.1);
                    rig.elbowL.rotation.x = -1.2;
                    rig.elbowR.rotation.x = -0.8;
                    rig.legL.rotation.x = -0.6;
                    rig.kneeL.rotation.x = 1.0;
                    rig.legR.rotation.x = -0.35;
                    rig.kneeR.rotation.x = 0.7;
                } else {
                    rig.shoulderL.rotation.set(0, 0, 0.18 + (front ? 0.5 : 0));
                    rig.shoulderR.rotation.set(front ? -0.4 : 0, 0, -0.18);
                    rig.legR.rotation.x = front ? 0.05 : -0.35;
                    rig.kneeR.rotation.x = front ? 0.6 : 0.8;
                }
                return front ? 0.1 : -0.05;
            }
            case 'kneel': {
                // On the knees, hands laced behind the head
                rig.body.position.y = -0.44;
                rig.legL.rotation.set(0.05, 0, 0.06);
                rig.legR.rotation.set(0.05, 0, -0.06);
                rig.kneeL.rotation.x = 1.62;
                rig.kneeR.rotation.x = 1.62;
                rig.torso.rotation.x = 0.08;
                rig.shoulderL.rotation.set(-2.55, 0, -0.95);
                rig.shoulderR.rotation.set(-2.55, 0, 0.95);
                rig.elbowL.rotation.x = -2.35;
                rig.elbowR.rotation.x = -2.35;
                return 0.25;
            }
            case 'cuff': {
                // Leaning in with both hands on the suspect's wrists / shoulders
                rig.torso.rotation.x = 0.28;
                rig.legL.rotation.x = -0.3;
                rig.kneeL.rotation.x = 0.35;
                rig.legR.rotation.x = 0.15;
                rig.shoulderL.rotation.set(-1.1, 0, -0.15);
                rig.shoulderR.rotation.set(-1.1, 0, 0.15);
                rig.elbowL.rotation.x = -0.5 + Math.sin(t * 3) * 0.08;
                rig.elbowR.rotation.x = -0.5 + Math.sin(t * 3.4) * 0.08;
                return 0.45;
            }
            case 'vomit': {
                // Doubled over, hands on knees, heaving
                const heave = Math.max(0, Math.sin(t * 2.2)) ** 4;
                rig.torso.rotation.x = 1.0 + heave * 0.25;
                rig.legL.rotation.x = -0.35;
                rig.legR.rotation.x = -0.2;
                rig.kneeL.rotation.x = 0.45;
                rig.kneeR.rotation.x = 0.3;
                rig.body.position.y = -0.06;
                rig.shoulderL.rotation.set(-0.35, 0, -0.1);
                rig.shoulderR.rotation.set(-0.35, 0, 0.1);
                rig.elbowL.rotation.x = -0.15;
                rig.elbowR.rotation.x = -0.15;
                return 0.2 - heave * 0.4;
            }
            case 'dance': {
                const beat = t * Math.PI * 2 * (124 / 60) * 0.5;
                const b = Math.abs(Math.sin(beat));
                rig.body.position.y = -b * 0.07;
                rig.kneeL.rotation.x = b * 0.4;
                rig.kneeR.rotation.x = b * 0.4;
                rig.legL.rotation.x = -b * 0.2;
                rig.legR.rotation.x = -b * 0.2;
                rig.body.rotation.y = Math.sin(beat * 0.5) * 0.35;
                rig.torso.rotation.z = Math.sin(beat) * 0.08;
                const style = Math.floor(ai.seed * 3) % 3;
                if (style === 0) {
                    // Fist pumping
                    rig.shoulderR.rotation.set(-2.6 + b * 0.5, 0, 0.2);
                    rig.elbowR.rotation.x = -0.4;
                    rig.shoulderL.rotation.set(-0.8, 0, -0.3);
                    rig.elbowL.rotation.x = -1.5;
                } else if (style === 1) {
                    // Both hands up
                    rig.shoulderL.rotation.set(-2.8, 0, -0.4 - b * 0.2);
                    rig.shoulderR.rotation.set(-2.8, 0, 0.4 + b * 0.2);
                    rig.elbowL.rotation.x = -0.5;
                    rig.elbowR.rotation.x = -0.5;
                } else {
                    // Swaying, elbows bent
                    rig.shoulderL.rotation.set(-0.6 + Math.sin(beat) * 0.3, 0, -0.35);
                    rig.shoulderR.rotation.set(-0.6 - Math.sin(beat) * 0.3, 0, 0.35);
                    rig.elbowL.rotation.x = -1.6;
                    rig.elbowR.rotation.x = -1.6;
                }
                return Math.sin(beat) * 0.1;
            }
            case 'cheer': {
                const b = Math.abs(Math.sin(t * 7));
                rig.body.position.y = b * 0.05;
                rig.shoulderL.rotation.set(-2.7 + b * 0.3, 0, -0.35);
                rig.shoulderR.rotation.set(-2.7 + b * 0.3, 0, 0.35);
                rig.elbowL.rotation.x = -0.35;
                rig.elbowR.rotation.x = -0.35;
                return -0.15;
            }
            case 'film': {
                // Phone held up, filming
                rig.shoulderR.rotation.set(-1.45, 0, 0.25);
                rig.elbowR.rotation.x = -0.55;
                rig.shoulderL.rotation.set(-1.2, 0, -0.35);
                rig.elbowL.rotation.x = -0.9;
                return 0.05;
            }
            case 'rake': {
                const k = Math.sin(t * 2.4);
                rig.torso.rotation.x = 0.3 + k * 0.08;
                rig.legL.rotation.x = -0.25;
                rig.legR.rotation.x = 0.2;
                rig.kneeL.rotation.x = 0.25;
                return 0.35;
            }
            default:
                return null;
        }
    }

    /** Arm overlays on top of the base walk / stand animation. Returns extra head pitch. */
    overlay(ped, rig, t) {
        const ai = ped.ai;
        let pitch = 0;
        if (ai.drunk > 0 && !ai.act) {
            const d = ai.drunk;
            rig.body.rotation.z += Math.sin(t * 1.7) * 0.07 * d;
            rig.torso.rotation.z += Math.sin(t * 1.7 + 0.6) * 0.09 * d;
            rig.torso.rotation.x += 0.05 * d;
            rig.shoulderL.rotation.z += 0.12 * d;
            rig.shoulderR.rotation.z -= 0.12 * d;
            pitch += 0.12 * d + Math.sin(t * 2.3) * 0.08 * d;
        }
        if (ai.old) {
            rig.torso.rotation.x += 0.13;
            pitch -= 0.05;
        }
        if (ai.cuffed) {
            rig.shoulderL.rotation.set(0.55, 0, 0.2);
            rig.shoulderR.rotation.set(0.55, 0, -0.2);
            rig.elbowL.rotation.set(-1.0, 0.6, 0);
            rig.elbowR.rotation.set(-1.0, -0.6, 0);
            pitch += 0.25;
        }
        if (ai.dog) {
            rig.shoulderL.rotation.set(-0.45, 0, -0.15);
            rig.elbowL.rotation.x = -0.6;
        }
        if (ai.bags) {
            rig.shoulderL.rotation.z = Math.max(rig.shoulderL.rotation.z, 0.14);
            rig.shoulderR.rotation.z = Math.min(rig.shoulderR.rotation.z, -0.14);
            rig.elbowL.rotation.x = -0.05;
            rig.elbowR.rotation.x = -0.05;
            rig.shoulderL.rotation.x *= 0.4;
            rig.shoulderR.rotation.x *= 0.4;
        }
        if (ai.flashlight) {
            rig.shoulderL.rotation.set(-0.85, 0, -0.1);
            rig.elbowL.rotation.x = -0.35;
            pitch += 0.15;
        }
        if (ai.overlay === 'push') {
            rig.shoulderL.rotation.set(-0.95, 0, -0.08);
            rig.shoulderR.rotation.set(-0.95, 0, 0.08);
            rig.elbowL.rotation.x = -0.35;
            rig.elbowR.rotation.x = -0.35;
            rig.torso.rotation.x += 0.15;
            pitch += 0.2;
        } else if (ai.overlay === 'rake') {
            const k = ai.pose === 'rake' ? Math.sin(t * 2.4) : 0;
            rig.shoulderL.rotation.set(-0.75 + k * 0.35, 0, -0.1);
            rig.shoulderR.rotation.set(-0.45 + k * 0.35, 0, 0.12);
            rig.elbowL.rotation.x = -0.5;
            rig.elbowR.rotation.x = -0.7;
        }
        if (ai.act && ai.pose !== 'sitGround') pitch += this._handGesture(ped, rig, t);
        if (ai.act && ai.act.role === 'pong') pitch += this._throwPose(ai.act, rig);
        if (ai.carry && !ai.act && ai.pose === 'walk') {
            // A cup or cigarette held at chest height while walking
            rig.shoulderR.rotation.set(-0.35, 0, 0.12);
            rig.elbowR.rotation.x = -1.3;
        }
        return pitch;
    }

    _handGesture(ped, rig, t) {
        const act = ped.ai.act;
        if (!act) return 0;
        if (act.smoke || act.drink || act.eat || act.hand) {
            // Item held at the waist, raised to the mouth now and then
            const up = act.gesture > 0 && (act.smoke || act.drink || act.eat);
            if (ped.ai.pose === 'sitGround') {
                rig.shoulderR.rotation.set(up ? -1.0 : -0.3, 0, up ? 0.45 : 0.1);
                rig.elbowR.rotation.x = up ? -2.2 : -1.0;
            } else {
                rig.shoulderR.rotation.set(up ? -0.75 : -0.25, 0, up ? 0.5 : 0.1);
                rig.elbowR.rotation.x = up ? -2.25 : -1.25;
            }
            return up && act.drink ? -0.3 : 0;
        }
        return 0;
    }

    _throwPose(act, rig) {
        if (act.throwT === undefined || act.throwT < 0) {
            // Waiting: ball hand ready
            rig.shoulderR.rotation.set(-0.5, 0, 0.15);
            rig.elbowR.rotation.x = -1.4;
            return 0.15;
        }
        const k = act.throwT;
        if (k < 0.3) {
            // Aim
            rig.shoulderR.rotation.set(-1.25, 0, 0.1);
            rig.elbowR.rotation.x = -1.6 - k;
        } else if (k < 0.55) {
            // Flick
            const f = (k - 0.3) / 0.25;
            rig.shoulderR.rotation.set(-1.25 - f * 0.45, 0, 0.1);
            rig.elbowR.rotation.x = -1.9 + f * 1.6;
        } else {
            rig.shoulderR.rotation.set(-1.6, 0, 0.1);
            rig.elbowR.rotation.x = -0.3;
        }
        return 0.25;
    }

    getStats() {
        const byType = {};
        for (const s of this.scenes) byType[s.type] = (byType[s.type] || 0) + 1;
        return { scenes: this.scenes.size, byType, dogs: this.dogs.length, puddles: this.puddles.length };
    }
}

// ================================================================================================
// Party music: a muffled four-on-the-floor beat coming from yard parties and bar doors
// ================================================================================================
export class PartyMusic {
    constructor() {
        this.ctx = null;
        this.out = null;
        this.filter = null;
        this.nextBeat = 0;
        this.beat = 0;
        this.level = 0;
        this.enabled = true;
        this._noise = null;
    }

    setContext(ctx) {
        if (this.ctx || !ctx) return;
        this.ctx = ctx;
        this.filter = ctx.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = 900;
        this.out = ctx.createGain();
        this.out.gain.value = 0;
        this.filter.connect(this.out);
        this.out.connect(ctx.destination);
        const len = Math.floor(ctx.sampleRate * 0.1);
        this._noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const ch = this._noise.getChannelData(0);
        for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    }

    /**
     * @param {Array<{x,z,gain,muffled}>} sources
     * @param {{x,z}} listener
     */
    update(sources, listener) {
        const ctx = this.ctx;
        if (!ctx || ctx.state !== 'running') return;
        let level = 0, muffled = 0;
        for (let i = 0; i < sources.length; i++) {
            const s = sources[i];
            const d = Math.hypot(s.x - listener.x, s.z - listener.z);
            if (d > SCENE_CONFIG.MUSIC_RANGE) continue;
            const l = s.gain / (1 + (d / 10) ** 2);
            if (l > level) {
                level = l;
                muffled = s.muffled ? 1 : 0;
            }
        }
        if (!this.enabled) level = 0;
        this.level += (level - this.level) * 0.1;
        const now = ctx.currentTime;
        this.out.gain.setTargetAtTime(this.level * 0.32, now, 0.1);
        this.filter.frequency.setTargetAtTime((muffled ? 450 : 1100) + (1 - Math.min(1, this.level * 3)) * -200, now, 0.2);
        if (this.level < 0.004) {
            this.nextBeat = 0;
            return;
        }
        if (this.nextBeat < now) this.nextBeat = now + 0.05;
        const spb = 60 / 124;
        while (this.nextBeat < now + 0.25) {
            this._kick(this.nextBeat);
            const bar = this.beat % 16;
            const roots = [55, 55, 49, 41.2];
            this._bass(this.nextBeat + spb / 2, roots[Math.floor(bar / 4)]);
            this._hat(this.nextBeat + spb / 2);
            if (bar % 4 === 2) this._hat(this.nextBeat + spb * 0.75);
            this.nextBeat += spb;
            this.beat++;
        }
    }

    _kick(t) {
        const ctx = this.ctx;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.setValueAtTime(140, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
        g.gain.setValueAtTime(1.0, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
        o.connect(g);
        g.connect(this.filter);
        o.start(t);
        o.stop(t + 0.34);
    }

    _bass(t, f) {
        const ctx = this.ctx;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f * 2, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.35, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        o.connect(g);
        g.connect(this.filter);
        o.start(t);
        o.stop(t + 0.24);
    }

    _hat(t) {
        const ctx = this.ctx;
        const src = ctx.createBufferSource();
        src.buffer = this._noise;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 6000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.18, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        src.connect(hp);
        hp.connect(g);
        g.connect(this.filter);
        src.start(t);
        src.stop(t + 0.06);
    }
}
