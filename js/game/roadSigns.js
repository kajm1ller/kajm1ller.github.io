/**
 * js/game/roadSigns.js
 *
 * Street furniture for traffic control, placed from the traffic network (trafficNet.js), which
 * takes it from OSM:
 * - Traffic signals at signalized junctions: a pole on the far corner (near corner when nothing
 *   continues straight on) with a mast arm holding a three-lamp head over each approach lane,
 *   lamps lit from the junction's signal controller.
 * - Stop signs on stop-controlled approaches, with an ALL WAY plaque at all-way stops.
 * - Speed limit signs a little way into each longer street.
 * - ONE WAY signs where a one-way street leaves a junction, DO NOT ENTER at its far end.
 *
 * Everything is instanced (one draw call per kind of part / sign face).
 */

import * as THREE from 'three';
import { LIGHT } from './trafficNet.js';

const MPH = 2.23694;
const SPEED_SIGN_MIN_LANE = 90;     // streets shorter than this get no speed limit sign
const SPEED_SIGN_SPACING = 70;      // no two signs with the same limit closer than this
const CURB_GAP = 0.7;               // sign posts stand this far outside the road edge

const _p = { x: 0, z: 0, dx: 0, dz: -1 };
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

function canvasTexture(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

function octagon(g, cx, cy, r) {
    g.beginPath();
    for (let i = 0; i < 8; i++) {
        const a = Math.PI / 8 + (i * Math.PI) / 4;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
    }
    g.closePath();
}

function stopTexture() {
    return canvasTexture(256, 256, (g, w) => {
        g.clearRect(0, 0, w, w);
        octagon(g, 128, 128, 126);
        g.fillStyle = '#ffffff';
        g.fill();
        octagon(g, 128, 128, 116);
        g.fillStyle = '#c4161c';
        g.fill();
        g.fillStyle = '#ffffff';
        g.font = 'bold 74px Arial, Helvetica, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('STOP', 128, 134);
    });
}

function plaqueTexture(text, fg, bg, border) {
    return canvasTexture(256, 96, (g, w, h) => {
        g.fillStyle = border;
        g.fillRect(0, 0, w, h);
        g.fillStyle = bg;
        g.fillRect(6, 6, w - 12, h - 12);
        g.fillStyle = fg;
        g.font = 'bold 52px Arial, Helvetica, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(text, w / 2, h / 2 + 3);
    });
}

function speedTexture(mph) {
    return canvasTexture(192, 256, (g, w, h) => {
        g.fillStyle = '#111111';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#ffffff';
        g.fillRect(6, 6, w - 12, h - 12);
        g.strokeStyle = '#111111';
        g.lineWidth = 4;
        g.strokeRect(14, 14, w - 28, h - 28);
        g.fillStyle = '#111111';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = 'bold 36px Arial, Helvetica, sans-serif';
        g.fillText('SPEED', w / 2, 52);
        g.fillText('LIMIT', w / 2, 92);
        g.font = 'bold 104px Arial, Helvetica, sans-serif';
        g.fillText(String(mph), w / 2, 180);
    });
}

function oneWayTexture(arrowRight) {
    return canvasTexture(384, 128, (g, w, h) => {
        g.fillStyle = '#111111';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#ffffff';
        g.fillRect(5, 5, w - 10, h - 10);
        g.fillStyle = '#111111';
        g.fillRect(10, 10, w - 20, h - 20);
        // Arrow body with the words inside it
        g.fillStyle = '#ffffff';
        g.beginPath();
        const tip = arrowRight ? w - 22 : 22, back = arrowRight ? 22 : w - 22;
        const neck = arrowRight ? w - 92 : 92;
        g.moveTo(back, 42);
        g.lineTo(neck, 42);
        g.lineTo(neck, 22);
        g.lineTo(tip, 64);
        g.lineTo(neck, 106);
        g.lineTo(neck, 86);
        g.lineTo(back, 86);
        g.closePath();
        g.fill();
        g.fillStyle = '#111111';
        g.font = 'bold 36px Arial, Helvetica, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('ONE WAY', arrowRight ? w / 2 - 30 : w / 2 + 30, 66);
    });
}

function doNotEnterTexture() {
    return canvasTexture(256, 256, (g, w) => {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, w, w);
        g.beginPath();
        g.arc(128, 128, 112, 0, Math.PI * 2);
        g.fillStyle = '#c4161c';
        g.fill();
        g.fillStyle = '#ffffff';
        g.fillRect(36, 112, 184, 32);
        g.font = 'bold 30px Arial, Helvetica, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('DO NOT', 128, 72);
        g.fillText('ENTER', 128, 186);
    });
}

/** Collects instance transforms for one mesh kind, then builds the InstancedMesh. */
class Batch {
    constructor(geometry, material, { castShadow = true } = {}) {
        this.geometry = geometry;
        this.material = material;
        this.castShadow = castShadow;
        this.matrices = [];
    }

    add(x, y, z, yaw, sx = 1, sy = 1, sz = 1, pitch = 0, roll = 0) {
        _e.set(pitch, yaw, roll, 'YXZ');
        _q.setFromEuler(_e);
        _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
        this.matrices.push(_m.clone());
        return this.matrices.length - 1;
    }

    build(parent, name) {
        if (this.matrices.length === 0) return null;
        const mesh = new THREE.InstancedMesh(this.geometry, this.material, this.matrices.length);
        mesh.name = name;
        for (let i = 0; i < this.matrices.length; i++) mesh.setMatrixAt(i, this.matrices[i]);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = this.castShadow;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        parent.add(mesh);
        return mesh;
    }
}

export class RoadSigns {
    /**
     * @param {THREE.Scene} scene
     * @param {import('./trafficNet.js').TrafficNet} net
     */
    constructor(scene, net) {
        this.net = net;
        this.group = new THREE.Group();
        this.group.name = 'road_signs';
        this.heads = [];          // { ctrl, group, lamp } lamp = index of the head's red lamp
        this.lampMesh = null;
        this.counts = { signals: 0, signalHeads: 0, stop: 0, speed: 0, oneWay: 0, doNotEnter: 0 };
        this._build();
        scene.add(this.group);
        this.update(true);
    }

    // Where a post stands beside lane piece `piece` at its arc length s (right-hand road edge)
    _curb(piece, s, out) {
        piece.path.sample(s, _p);
        const lane = piece.lane;
        const edge = Math.max(1.2, (lane.halfWidth || 4) - (lane.offset || 0)) + CURB_GAP;
        // Right of travel (dx, dz) is (-dz, dx)
        out.x = _p.x - _p.dz * edge;
        out.z = _p.z + _p.dx * edge;
        out.dx = _p.dx;
        out.dz = _p.dz;
        out.edge = edge;
        return out;
    }

    _build() {
        const net = this.net;
        const metal = new THREE.MeshStandardMaterial({ color: 0x8c9196, roughness: 0.45, metalness: 0.7 });
        const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2b2e31, roughness: 0.6, metalness: 0.4 });
        const housingMat = new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.7, metalness: 0.2 });
        const signBack = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, metalness: 0.6 });
        const face = (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.55, metalness: 0.05, transparent: true, alphaTest: 0.5 });

        const postGeo = new THREE.BoxGeometry(0.06, 1, 0.06);
        postGeo.translate(0, 0.5, 0);
        const poleGeo = new THREE.CylinderGeometry(0.1, 0.13, 1, 10);
        poleGeo.translate(0, 0.5, 0);
        const armGeo = new THREE.CylinderGeometry(0.06, 0.07, 1, 8);
        armGeo.rotateZ(Math.PI / 2);
        armGeo.translate(0.5, 0, 0);
        const housingGeo = new THREE.BoxGeometry(0.38, 1.08, 0.3);
        const backplateGeo = new THREE.BoxGeometry(0.62, 1.32, 0.03);
        const lampGeo = new THREE.CircleGeometry(0.125, 16);
        const visorGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.2, 12, 1, true, -Math.PI / 2, Math.PI);
        visorGeo.rotateX(Math.PI / 2);

        const octGeo = new THREE.CircleGeometry(0.4, 8);
        octGeo.rotateZ(Math.PI / 8);
        const plaqueGeo = new THREE.PlaneGeometry(0.62, 0.23);
        const speedGeo = new THREE.PlaneGeometry(0.6, 0.8);
        const oneWayGeo = new THREE.PlaneGeometry(0.9, 0.3);
        const dneGeo = new THREE.PlaneGeometry(0.75, 0.75);

        const posts = new Batch(postGeo, metal);
        const poles = new Batch(poleGeo, darkMetal);
        const arms = new Batch(armGeo, darkMetal);
        const housings = new Batch(housingGeo, housingMat);
        const backplates = new Batch(backplateGeo, housingMat);
        const visors = new Batch(visorGeo, housingMat, { castShadow: false });
        const lamps = new Batch(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), { castShadow: false });
        const stops = new Batch(octGeo, face(stopTexture()));
        const stopBacks = new Batch(octGeo, signBack);
        const allWay = new Batch(plaqueGeo, face(plaqueTexture('ALL WAY', '#ffffff', '#c4161c', '#ffffff')));
        const plaqueBacks = new Batch(plaqueGeo, signBack);
        const speedBacks = new Batch(speedGeo, signBack);
        const speedBatches = new Map();
        const oneWayFront = new Batch(oneWayGeo, face(oneWayTexture(false)));
        const oneWayBack = new Batch(oneWayGeo, face(oneWayTexture(true)));
        const dne = new Batch(dneGeo, face(doNotEnterTexture()));
        const dneBacks = new Batch(dneGeo, signBack);

        // A sign face at height h on a post, facing direction (nx, nz), with its plain back
        const facingYaw = (nx, nz) => Math.atan2(nx, nz);
        const signOnPost = (front, back, x, z, nx, nz, h) => {
            const yaw = facingYaw(nx, nz);
            front.add(x + nx * 0.04, h, z + nz * 0.04, yaw);
            if (back) back.add(x + nx * 0.035, h, z + nz * 0.035, yaw + Math.PI);
        };
        const curb = { x: 0, z: 0, dx: 0, dz: -1, edge: 0 };

        // ---- Traffic signals ----
        const signalJunctions = new Set();
        for (const piece of net.pieces.values()) {
            if (piece.signalGroup < 0 || !piece.junction || !piece.junction.signal) continue;
            const j = piece.junction;
            signalJunctions.add(j);
            const ctrl = j.signal;
            piece.path.sample(piece.len, _p);
            const ax = _p.x, az = _p.z, dx = _p.dx, dz = _p.dz;
            const yaw = facingYaw(-dx, -dz); // head faces the approaching driver
            // Far corner when a lane continues straight on, otherwise the near corner
            let poleX, poleZ, headX, headZ;
            let straight = null;
            for (const id of piece.lane.nextLanes) {
                const out = net.lanePiece(id);
                if (!out) continue;
                const c = net.connector(piece, out);
                if (c.turn === 'straight') {
                    straight = out;
                    break;
                }
            }
            if (straight) {
                this._curb(straight, Math.min(1.5, straight.len), curb);
                poleX = curb.x;
                poleZ = curb.z;
                straight.path.sample(Math.min(1.5, straight.len), _p);
                headX = _p.x;
                headZ = _p.z;
            } else {
                this._curb(piece, piece.len, curb);
                poleX = curb.x;
                poleZ = curb.z;
                headX = ax;
                headZ = az;
            }
            // Pole, mast arm out over the lane, head hanging from the arm
            const armLen = Math.hypot(headX - poleX, headZ - poleZ);
            poles.add(poleX, 0, poleZ, 0, 1, 6.2, 1);
            arms.add(poleX, 5.75, poleZ, Math.atan2(-(headZ - poleZ), headX - poleX), Math.max(0.5, armLen + 0.2), 1, 1);
            const hy = 5.05;
            housings.add(headX, hy, headZ, yaw);
            backplates.add(headX - Math.sin(yaw) * 0.17, hy, headZ - Math.cos(yaw) * 0.17, yaw);
            const fx = Math.sin(yaw), fz = Math.cos(yaw);
            let red = -1;
            for (let k = 0; k < 3; k++) {
                const ly = hy + 0.33 - k * 0.33;
                const idx = lamps.add(headX + fx * 0.153, ly, headZ + fz * 0.153, yaw);
                visors.add(headX + fx * 0.25, ly + 0.02, headZ + fz * 0.25, yaw);
                if (k === 0) red = idx;
            }
            this.heads.push({ ctrl, group: piece.signalGroup, lamp: red, state: -1 });
            this.counts.signalHeads++;
        }
        this.counts.signals = net.signals.length;

        // ---- Stop signs ----
        for (const piece of net.pieces.values()) {
            if (!piece.stopSign || !piece.junction) continue;
            this._curb(piece, Math.max(0, piece.len - 0.5), curb);
            const nx = -curb.dx, nz = -curb.dz;
            posts.add(curb.x, 0, curb.z, 0, 1, 2.55, 1);
            signOnPost(stops, stopBacks, curb.x, curb.z, nx, nz, 2.25);
            if (piece.junction.control === 'allway') signOnPost(allWay, plaqueBacks, curb.x, curb.z, nx, nz, 1.72);
            this.counts.stop++;
        }

        // ---- Speed limit signs ----
        const placed = new Map(); // mph -> [{x, z}]
        for (const piece of net.pieces.values()) {
            const lane = piece.lane;
            if (piece.len < SPEED_SIGN_MIN_LANE || !lane.speedLimit) continue;
            const mph = Math.max(10, Math.round((lane.speedLimit * MPH) / 5) * 5);
            this._curb(piece, Math.min(25, piece.len * 0.3), curb);
            const list = placed.get(mph) || [];
            if (list.some((p) => Math.hypot(p.x - curb.x, p.z - curb.z) < SPEED_SIGN_SPACING)) continue;
            // Not in another street's carriageway
            if (net.roadNetwork.isNearRoad && this._onOtherRoad(curb.x, curb.z, piece)) continue;
            list.push({ x: curb.x, z: curb.z });
            placed.set(mph, list);
            let batch = speedBatches.get(mph);
            if (!batch) {
                batch = new Batch(speedGeo, face(speedTexture(mph)));
                speedBatches.set(mph, batch);
            }
            posts.add(curb.x, 0, curb.z, 0, 1, 2.5, 1);
            signOnPost(batch, speedBacks, curb.x, curb.z, -curb.dx, -curb.dz, 2.1);
            this.counts.speed++;
        }

        // ---- One-way streets ----
        for (const piece of net.pieces.values()) {
            const lane = piece.lane;
            if (!lane.oneway || piece.len < 12) continue;
            if ((lane.startDegree || 0) >= 3) {
                // Parallel to the street at the corner, readable from the crossing street
                this._curb(piece, 3.0, curb);
                const rx = -curb.dz, rz = curb.dx;
                posts.add(curb.x, 0, curb.z, 0, 1, 2.6, 1);
                // Seen from the road (looking outward) travel runs to the viewer's left; from the
                // sidewalk side, to the right
                oneWayFront.add(curb.x - rx * 0.04, 2.3, curb.z - rz * 0.04, facingYaw(-rx, -rz));
                oneWayBack.add(curb.x + rx * 0.04, 2.3, curb.z + rz * 0.04, facingYaw(rx, rz));
                this.counts.oneWay++;
            }
            if ((lane.endDegree || 0) >= 3 && piece.junction) {
                // DO NOT ENTER for drivers who would turn in at the wrong end: on their right,
                // i.e. our left-hand road edge, facing out into the junction
                piece.path.sample(piece.len, _p);
                const left = (lane.halfWidth || 4) + (lane.offset || 0) + CURB_GAP;
                const x = _p.x + _p.dz * left, z = _p.z - _p.dx * left;
                posts.add(x, 0, z, 0, 1, 2.5, 1);
                signOnPost(dne, dneBacks, x, z, _p.dx, _p.dz, 2.1);
                this.counts.doNotEnter++;
            }
        }

        const G = this.group;
        posts.build(G, 'sign_posts');
        poles.build(G, 'signal_poles');
        arms.build(G, 'signal_arms');
        housings.build(G, 'signal_housings');
        backplates.build(G, 'signal_backplates');
        visors.build(G, 'signal_visors');
        this.lampMesh = lamps.build(G, 'signal_lamps');
        if (this.lampMesh) {
            this.lampMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(lamps.matrices.length * 3), 3);
        }
        stops.build(G, 'stop_signs');
        stopBacks.build(G, 'stop_sign_backs');
        allWay.build(G, 'all_way_plaques');
        plaqueBacks.build(G, 'plaque_backs');
        for (const [mph, b] of speedBatches) b.build(G, `speed_limit_${mph}`);
        speedBacks.build(G, 'speed_limit_backs');
        oneWayFront.build(G, 'one_way_signs');
        oneWayBack.build(G, 'one_way_sign_backs');
        dne.build(G, 'do_not_enter_signs');
        dneBacks.build(G, 'do_not_enter_backs');
    }

    /** Whether (x, z) lies on a street other than the one `piece` belongs to. */
    _onOtherRoad(x, z, piece) {
        const rn = this.net.roadNetwork;
        if (!rn.segments) return false;
        for (const seg of rn.segments) {
            if (seg.roadId === piece.lane.roadId) continue;
            if (x < seg.minX - 10 || x > seg.maxX + 10 || z < seg.minZ - 10 || z > seg.maxZ + 10) continue;
            const sx = seg.p1.x - seg.p0.x, sz = seg.p1.z - seg.p0.z;
            const l2 = sx * sx + sz * sz;
            let t = l2 > 0 ? ((x - seg.p0.x) * sx + (z - seg.p0.z) * sz) / l2 : 0;
            t = Math.max(0, Math.min(1, t));
            const d = Math.hypot(x - (seg.p0.x + sx * t), z - (seg.p0.z + sz * t));
            if (d < (seg.halfWidth || 4) + 0.3) return true;
        }
        return false;
    }

    /** Lights the signal lamps from their controllers. */
    update(force = false) {
        const mesh = this.lampMesh;
        if (!mesh) return;
        const colors = mesh.instanceColor;
        let dirty = false;
        for (const h of this.heads) {
            const st = this.net.lightState(h.ctrl, h.group);
            if (st === h.state && !force) continue;
            h.state = st;
            dirty = true;
            colors.setXYZ(h.lamp, ...(st === LIGHT.RED ? [1.6, 0.12, 0.08] : [0.16, 0.03, 0.02]));
            colors.setXYZ(h.lamp + 1, ...(st === LIGHT.YELLOW ? [1.6, 0.85, 0.05] : [0.16, 0.1, 0.02]));
            colors.setXYZ(h.lamp + 2, ...(st === LIGHT.GREEN ? [0.15, 1.5, 0.55] : [0.02, 0.12, 0.06]));
        }
        if (dirty) colors.needsUpdate = true;
    }
}
