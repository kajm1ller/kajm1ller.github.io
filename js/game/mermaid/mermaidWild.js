/**
 * js/game/mermaid/mermaidWild.js
 *
 * The places beyond the town: the Sunken Ship, the Giant Clam, the Whale Skeleton, the Kelp
 * Forest's lantern flowers, Pearl Lagoon (the ring run's home), the Sunken Temple with its glyph
 * pillars and sealed vault, the Glow Caves with Gerald's hoard, the Music Grotto and the Deep Trench.
 */

import * as THREE from 'three';
import {
    TWO_PI, between, pick, clamp, lerp, smooth, mulberry32, noise2, fbm, std, mat, mesh, joint, canvasTexture, signTexture, glowSprite, glowTexture,
    makeSway, SWAY, merge, paint, lerpColor, shade, Batch, angleDiff
} from './mermaidKit.js';
import { floorHeight, CAVE, TRENCH } from './mermaidEnv.js';
import { areaById, GLYPHS } from './mermaidData.js';
import { turretGeo, neonTexture, stripeTexture } from './mermaidTown.js';
import { buildCrab, buildShark, buildWhale, buildAngler, buildOctopus, buildDolphin } from './mermaidCreatures.js';

const A = (id) => areaById(id).at;
const ground = floorHeight;

function noisy(geo, amp, freq, seed = 0) {
    const p = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const n = noise2(v.x * freq + seed, v.z * freq + v.y * freq * 0.7) * 0.7 + noise2(v.x * freq * 2.3 + seed, v.y * freq * 2.3 + v.z * freq) * 0.3;
        v.multiplyScalar(1 + n * amp);
        p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    return geo;
}

// ================================================================================================
// Landmarks
// ================================================================================================
export function buildShip(ctx) {
    const { scene } = ctx;
    const [sx, sz] = A('ship');
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, map: plankTexture() });
    const dark = mat(0x3d2c22, { r: 0.95 });
    // Hull: a box pulled into a bow
    const hullG = new THREE.BoxGeometry(9.5, 7, 30, 6, 4, 16);
    const p = hullG.attributes.position;
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const t = (z + 15) / 30;
        const bow = smooth(0.5, 1.0, t);
        const stern = smooth(0.25, 0.0, t);
        p.setXYZ(i, x * (1 - 0.82 * bow - 0.2 * stern), y + (y > 0 ? bow * 2.6 + stern * 1.4 : 0) - (y < 0 ? 0.6 * Math.sin(t * Math.PI) : 0), z);
    }
    hullG.computeVertexNormals();
    const hull = new THREE.Mesh(hullG, wood);
    hull.position.y = 3.5;
    g.add(hull);
    // Deck, rails and a hole where the roof caved in
    const deck = mesh(new THREE.BoxGeometry(8.4, 0.3, 24), mat(0x9a7a5c, { r: 0.9 }), 0, 7.1, -1);
    g.add(deck);
    for (let i = 0; i < 16; i++) {
        const z = -12 + i * 1.6;
        for (const s of [-1, 1]) {
            if (i % 5 === 3) continue;
            g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.6, 5), dark, s * 4.3 * (1 - Math.max(0, (z - 3) / 18) * 0.7), 7.9, z));
        }
    }
    // Masts, sails, spars
    const mast = mesh(new THREE.CylinderGeometry(0.4, 0.55, 22, 8), wood, 0, 18, 2);
    g.add(mast);
    const mast2 = mesh(new THREE.CylinderGeometry(0.3, 0.4, 9, 8), wood, 3.4, 11, -9);
    mast2.rotation.z = 1.15;
    g.add(mast2);
    const spar = mesh(new THREE.CylinderGeometry(0.18, 0.18, 10, 6), wood, 0, 21, 2);
    spar.rotation.z = Math.PI / 2;
    g.add(spar);
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(8, 9, 8, 8), makeSway(new THREE.MeshStandardMaterial({ color: 0xe8e0d0, transparent: true, opacity: 0.85, side: THREE.DoubleSide, roughness: 0.9 }), { axis: '-y', amp: 0.05, freq: 1.2, speed: 1.0 }));
    sail.geometry.translate(0, -4.5, 0);
    sail.position.set(0, 20.8, 2.2);
    g.add(sail);
    g.add(mesh(new THREE.CylinderGeometry(1.1, 0.9, 1.2, 10, 1, true), dark, 0, 22.6, 2));
    // Cannons, portholes (glowing), the wheel, an anchor, barnacles
    for (let i = 0; i < 5; i++) {
        for (const s of [-1, 1]) {
            const c = mesh(new THREE.CylinderGeometry(0.28, 0.34, 1.8, 8), mat(0x222222, { m: 0.7, r: 0.5 }), s * 3.8, 3.8, -8 + i * 4.2);
            c.rotation.z = Math.PI / 2;
            g.add(c);
            g.add(mesh(new THREE.CircleGeometry(0.5, 12), ctx.glowMat(0x9fe8ff, 0.4, 0.5, { side: THREE.DoubleSide }), s * 4.7 * 0.92, 5.4, -8 + i * 4.2));
            g.children[g.children.length - 1].rotation.y = s * Math.PI / 2;
        }
    }
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.12, 6, 14), dark);
    wheel.position.set(0, 8.4, -11);
    g.add(wheel);
    const spokes = new THREE.Group();
    for (let i = 0; i < 6; i++) {
        const sp = mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 4), dark, 0, 0, 0);
        sp.rotation.z = (i / 6) * Math.PI;
        spokes.add(sp);
    }
    spokes.position.copy(wheel.position);
    g.add(spokes);
    const anchor = new THREE.Group();
    anchor.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 3.2, 6), mat(0x4a4a4a, { m: 0.8 }), 0, 0, 0));
    anchor.add(mesh(new THREE.TorusGeometry(1.0, 0.15, 6, 14, Math.PI), mat(0x4a4a4a, { m: 0.8 }), 0, -1.6, 0));
    anchor.add(mesh(new THREE.BoxGeometry(1.4, 0.15, 0.15), mat(0x4a4a4a, { m: 0.8 }), 0, 1.0, 0));
    anchor.position.set(5.4, 3.5, 8);
    anchor.rotation.z = 0.5;
    g.add(anchor);
    const barn = new THREE.InstancedMesh(new THREE.SphereGeometry(0.25, 6, 5), mat(0xe8e0c8, { r: 0.9 }), 80);
    const rnd = mulberry32(55);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 80; i++) {
        const s = rnd() < 0.5 ? -1 : 1;
        barn.setMatrixAt(i, m4.makeTranslation(s * (3.6 + rnd() * 0.9), 0.6 + rnd() * 5.4, -13 + rnd() * 26).scale(new THREE.Vector3(1, 0.7, 1)));
    }
    g.add(barn);
    // Treasure chest with a golden glow, and weed draped over the rail
    const chest = new THREE.Group();
    chest.add(mesh(new THREE.BoxGeometry(2, 1.2, 1.3), mat(0x8d6e63, { r: 0.7 }), 0, 0.6, 0));
    chest.add(mesh(new THREE.CylinderGeometry(0.65, 0.65, 2, 10, 1, false, 0, Math.PI), mat(0x7a5a45, { r: 0.7 }), 0, 1.2, 0));
    chest.children[chest.children.length - 1].rotation.z = Math.PI / 2;
    chest.add(mesh(new THREE.BoxGeometry(1.6, 0.3, 0.9), ctx.glowMat(0xf1c40f, 0.5, 0.4, { metalness: 0.9, roughness: 0.3 }), 0, 1.3, 0));
    chest.position.set(0, 7.3, -6);
    g.add(chest);
    const gold = glowSprite(0xffd54f, 5, 0.6);
    gold.position.set(0, 9, -6);
    g.add(gold);
    for (let i = 0; i < 8; i++) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 4, 1, 6), makeSway(new THREE.MeshStandardMaterial({ color: 0x2e8b3c, side: THREE.DoubleSide }), { axis: '-y', amp: 0.2, freq: 2, speed: 1.3 }));
        w.geometry.translate(0, -2, 0);
        w.position.set((i % 2 ? 1 : -1) * 4.4, 8.4, -10 + i * 2.8);
        g.add(w);
    }
    g.position.set(sx, ground(sx, sz) - 1.2, sz);
    g.rotation.set(0.12, 0.7, 0.28);
    scene.add(g);
    ctx.refs.ship = { root: g, deck: new THREE.Vector3(sx, ground(sx, sz) + 7.5, sz), spokes };
    ctx.collider(sx, sz, 7);
    ctx.collider(sx + Math.sin(0.7) * 8, sz + Math.cos(0.7) * 8, 5);
    ctx.collider(sx - Math.sin(0.7) * 8, sz - Math.cos(0.7) * 8, 5);
    ctx.anim.push((t) => { spokes.rotation.z = Math.sin(t * 0.3) * 0.2; });
}

let _plank = null;
function plankTexture() {
    if (!_plank) {
        _plank = canvasTexture(256, 256, (g, w, h) => {
            g.fillStyle = '#7a5a45';
            g.fillRect(0, 0, w, h);
            const rnd = mulberry32(9);
            for (let y = 0; y < h; y += 32) {
                g.fillStyle = `rgba(0,0,0,${0.15 + rnd() * 0.2})`;
                g.fillRect(0, y, w, 3);
                for (let i = 0; i < 8; i++) {
                    g.strokeStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},0.08)`;
                    g.beginPath();
                    g.moveTo(0, y + rnd() * 30);
                    g.lineTo(w, y + rnd() * 30);
                    g.stroke();
                }
            }
        }, { repeat: [3, 2] });
    }
    return _plank;
}

export function buildClam(ctx) {
    const { scene } = ctx;
    const [cx, cz] = A('clam');
    const y0 = ground(cx, cz);
    const g = new THREE.Group();
    const shellM = new THREE.MeshPhysicalMaterial({ color: 0xcfa9e0, roughness: 0.3, metalness: 0.15, clearcoat: 0.6, iridescence: 0.7, side: THREE.DoubleSide });
    const mk = (up) => {
        const geo = new THREE.SphereGeometry(8, 40, 16, 0, TWO_PI, up ? 0 : Math.PI / 2, Math.PI / 2);
        const p = geo.attributes.position;
        for (let i = 0; i < p.count; i++) {
            const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
            const ang = Math.atan2(z, x);
            const k = 1 + 0.05 * Math.cos(ang * 16) * (Math.abs(y) / 8 + 0.25);
            p.setXYZ(i, x * k, y, z * k);
        }
        geo.computeVertexNormals();
        return new THREE.Mesh(geo, shellM);
    };
    const bottom = mk(false);
    bottom.scale.y = 0.5;
    g.add(bottom);
    const hinge = joint(g, 0, 0.3, -7.5);
    const top = mk(true);
    top.scale.y = 0.6;
    top.position.z = 7.5;
    hinge.add(top);
    const pearl = mesh(new THREE.SphereGeometry(2.0, 28, 20), ctx.glowMat(0xffffff, 0.4, 1.0, { roughness: 0.04, metalness: 0.35 }), 0, 1.3, 0);
    g.add(pearl);
    const gl = glowSprite(0xe0f7ff, 12, 0.55);
    gl.position.set(0, 2, 0);
    g.add(gl);
    // lip of flesh
    g.add(mesh(new THREE.TorusGeometry(7.6, 0.5, 6, 30), mat(0xb57edc, { r: 0.6 }), 0, 0.4, 0));
    g.children[g.children.length - 1].rotation.x = Math.PI / 2;
    g.position.set(cx, y0 + 0.5, cz);
    g.rotation.y = 0.5;
    scene.add(g);
    ctx.collider(cx, cz, 7);
    // The crab family live in front of it
    const crabs = [];
    for (let i = 0; i < 4; i++) {
        const c = buildCrab([0xe74c3c, 0xe67e22, 0xc0392b, 0xff7675][i], i === 0 ? 0.9 : 0.6);
        const a = 0.5 + Math.PI + (i - 1.5) * 0.4;
        const x = cx + Math.sin(a) * 11, z = cz + Math.cos(a) * 11;
        c.position.set(x, ground(x, z), z);
        c.rotation.y = a + Math.PI;
        scene.add(c);
        crabs.push(c);
    }
    ctx.refs.clam = { pos: new THREE.Vector3(cx, y0 + 3, cz), crabs, hinge, pearl };
    ctx.anim.push((t, dt) => {
        hinge.rotation.x = -0.55 - Math.sin(t * 0.35) * 0.4;
        gl.material.opacity = 0.45 + Math.sin(t * 1.3) * 0.12;
        crabs.forEach((c, i) => c.userData.update(t + i, 0.1));
    });
}

export function buildWhaleSkeleton(ctx) {
    const { scene } = ctx;
    const [wx, wz] = A('whale');
    const g = new THREE.Group();
    const bone = new THREE.MeshStandardMaterial({ color: 0xf5f0e1, roughness: 0.75 });
    for (let i = 0; i < 22; i++) {
        const r = 0.8 - i * 0.025;
        const v = mesh(new THREE.SphereGeometry(Math.max(0.25, r), 10, 8), bone, 0, 1.8 + Math.sin(i * 0.3) * 0.3, i * 1.5);
        v.scale.set(1.1, 0.8, 1);
        g.add(v);
        g.add(mesh(new THREE.CylinderGeometry(0.1, 0.14, 1.4, 5), bone, 0, 2.7 + Math.sin(i * 0.3) * 0.3, i * 1.5));
    }
    for (let i = 2; i < 15; i++) {
        const r = 5.2 - Math.abs(i - 7) * 0.4;
        for (const s of [-1, 1]) {
            const rib = new THREE.Mesh(new THREE.TorusGeometry(r, 0.24, 6, 16, Math.PI * 0.8), bone);
            rib.position.set(0, 1.7, i * 1.5);
            rib.rotation.set(0, Math.PI / 2, s > 0 ? Math.PI * 0.1 : Math.PI * 0.1 + Math.PI * 0.2);
            rib.rotation.order = 'YXZ';
            rib.rotation.set(0, 0, s > 0 ? 0.1 : Math.PI - 0.1);
            g.add(rib);
        }
    }
    const skull = new THREE.Mesh(noisy(new THREE.SphereGeometry(3.4, 16, 12), 0.1, 0.5), bone);
    skull.scale.set(1.0, 0.65, 1.7);
    skull.position.set(0, 2.2, -3.5);
    g.add(skull);
    const jaw = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 7, 8), bone);
    jaw.rotation.x = Math.PI / 2 - 0.15;
    jaw.position.set(0, 0.8, -5);
    g.add(jaw);
    g.position.set(wx, ground(wx, wz), wz);
    g.rotation.set(0.0, 0.9, 0.12);
    scene.add(g);
    ctx.collider(wx + 5, wz + 8, 4);
    ctx.refs.whaleSkel = { pos: new THREE.Vector3(wx, ground(wx, wz) + 4, wz) };
    // glowing motes drifting through the ribs
    const geo = new THREE.BufferGeometry();
    const N = 40;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTexture(), size: 0.7, color: 0x9ff4ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
    pts.frustumCulled = false;
    scene.add(pts);
    ctx.anim.push((t) => {
        const p = pts.geometry.attributes.position;
        for (let i = 0; i < N; i++) {
            const a = i * 1.9 + t * 0.1;
            p.setXYZ(i, wx + Math.sin(a) * 6 + Math.cos(t * 0.3 + i) * 2, ground(wx, wz) + 3 + ((t * 0.3 + i * 0.13) % 1) * 5, wz + Math.cos(a * 0.8) * 9);
        }
        p.needsUpdate = true;
    });
}

export function buildKelpMarker(ctx) {
    const { scene } = ctx;
    const [kx, kz] = A('kelp');
    const flowerM = ctx.glowMat(0xf9f871, 0.9, 1.8);
    const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(0.55, 10, 8), flowerM, 14);
    const m4 = new THREE.Matrix4();
    ctx.refs.lanterns = [];
    for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TWO_PI;
        const x = kx + Math.sin(a) * 9, z = kz + Math.cos(a) * 9;
        inst.setMatrixAt(i, m4.makeTranslation(x, ground(x, z) + 1.6, z));
        const gs = glowSprite(0xf9f871, 4.5, 0.55);
        gs.position.set(x, ground(x, z) + 1.6, z);
        ctx.env.registerLamp(gs, 0.55);
        scene.add(gs);
        ctx.refs.lanterns.push(new THREE.Vector3(x, ground(x, z) + 1.6, z));
    }
    scene.add(inst);
    ctx.refs.kelp = { pos: new THREE.Vector3(kx, ground(kx, kz), kz) };
}

// ================================================================================================
// Pearl Lagoon
// ================================================================================================
export function buildLagoon(ctx) {
    const { scene } = ctx;
    const [lx, lz] = A('lagoon');
    const rnd = mulberry32(88);
    // A ring of coral spires around the lagoon
    const spireColors = [0xff6f91, 0xff9671, 0xffc75f, 0xd65db1, 0x845ec2, 0x4ffbdf, 0xf9f871];
    const B = new Batch();
    const mats = spireColors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, emissive: c, emissiveIntensity: 0.08 }));
    for (let i = 0; i < 22; i++) {
        const a = (i / 22) * TWO_PI + rnd() * 0.15;
        const r = 56 + rnd() * 12;
        const x = lx + Math.sin(a) * r, z = lz + Math.cos(a) * r;
        const h = between(10, 22);
        const m = mats[i % mats.length];
        const y = ground(x, z);
        B.add(new THREE.CylinderGeometry(0.4, 1.8, h, 8), m, x, y + h / 2, z);
        for (let k = 0; k < 4; k++) {
            const hh = h * between(0.25, 0.55);
            B.add(new THREE.CylinderGeometry(0.2, 0.7, hh, 6), m, x + Math.sin(k * 2.2) * 1.4, y + h * (0.3 + k * 0.1) + hh / 2, z + Math.cos(k * 2.2) * 1.4, 0, 1, 1, 1, Math.sin(k * 2.2) * 0.8, Math.cos(k * 2.2) * 0.8);
        }
        ctx.collider(x, z, 2.2);
    }
    // Pearls on the sand
    const g = new THREE.Group();
    B.build(g);
    scene.add(g);
    // The starting gate
    const [gx, gy, gz] = [120, 12, 130];
    const gate = new THREE.Group();
    gate.add(mesh(new THREE.TorusGeometry(7, 0.6, 10, 30), ctx.glowMat(0x48dbfb, 0.8, 1.2), 0, 0, 0));
    const sign = mesh(new THREE.PlaneGeometry(9, 2.2), new THREE.MeshBasicMaterial({ map: neonTexture('RING RUN', '#ffeaa7', '#0b2a4a', 512, 128) }), 0, 8.6, 0);
    gate.add(sign);
    for (const s of [-1, 1]) {
        const post = mesh(new THREE.CylinderGeometry(0.4, 0.55, gy + 4, 8), mat(0xe8d5c0, { r: 0.5 }), s * 7, -(gy + 4) / 2 + 0, 0);
        gate.add(post);
    }
    gate.position.set(gx, gy, gz);
    gate.rotation.y = Math.PI / 2 - 0.2;
    scene.add(gate);
    ctx.refs.lagoon = { start: new THREE.Vector3(gx, gy, gz), gate, center: new THREE.Vector3(lx, ground(lx, lz), lz) };
    ctx.anim.push((t) => { gate.children[0].rotation.z = t * 0.5; });
}

// ================================================================================================
// The Sunken Temple
// ================================================================================================
export function glyphTexture(glyph) {
    return canvasTexture(256, 256, (g, w, h) => {
        g.fillStyle = '#2a2f40';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = glyph.color;
        g.lineWidth = 8;
        g.strokeRect(12, 12, w - 24, h - 24);
        g.fillStyle = glyph.color;
        g.font = 'bold 150px "Segoe UI Symbol", "Arial Unicode MS", sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.shadowColor = glyph.color;
        g.shadowBlur = 24;
        g.fillText(glyph.char, w / 2, h / 2 + 6);
    });
}

export function buildTemple(ctx) {
    const { scene } = ctx;
    const [tx, tz] = A('temple');
    const y0 = ground(tx, tz);
    const stone = new THREE.MeshStandardMaterial({ color: 0xcfc7b4, roughness: 0.9 });
    const mossy = new THREE.MeshStandardMaterial({ color: 0x9fb088, roughness: 0.95 });
    const B = new Batch();
    const g = new THREE.Group();
    // Platform and steps
    const floorTex = canvasTexture(512, 512, (c, w, h) => {
        c.fillStyle = '#cfc7b4';
        c.fillRect(0, 0, w, h);
        const rnd = mulberry32(3);
        for (let y = 0; y < h; y += 64) for (let x = 0; x < w; x += 64) {
            c.fillStyle = `rgba(0,0,0,${rnd() * 0.12})`;
            c.fillRect(x, y, 64, 64);
            c.strokeStyle = 'rgba(0,0,0,0.25)';
            c.strokeRect(x, y, 64, 64);
        }
    }, { repeat: [6, 6] });
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(44, 47, 1.4, 48), [new THREE.MeshStandardMaterial({ color: 0xbfb7a4, roughness: 0.9 }), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9 }), stone]);
    plat.position.y = -0.1;
    plat.receiveShadow = true;
    g.add(plat);
    for (let i = 0; i < 3; i++) g.add(mesh(new THREE.CylinderGeometry(47 + i * 1.8, 48.5 + i * 1.8, 0.7, 48), stone, 0, -0.6 - i * 0.55, 0));
    // The ring of pillars: some whole, some broken
    const rnd = mulberry32(17);
    const pillarGeo = new THREE.CylinderGeometry(1.1, 1.3, 14, 12);
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TWO_PI;
        const x = Math.sin(a) * 33, z = Math.cos(a) * 33;
        const broken = i % 4 === 1;
        const h = broken ? between(4, 8) : 14;
        const gg = new THREE.CylinderGeometry(1.1, 1.3, h, 12);
        B.add(gg, i % 3 === 0 ? mossy : stone, x, 0.6 + h / 2, z);
        B.add(new THREE.BoxGeometry(3.2, 0.7, 3.2), stone, x, 0.6, z, a);
        if (!broken) B.add(new THREE.BoxGeometry(3.0, 0.8, 3.0), stone, x, 14.6, z, a);
        else {
            B.add(new THREE.CylinderGeometry(1.1, 1.1, 4, 10), stone, x + 2.5, 1.5, z + 2, 0, 1, 1, 1, 0, 1.4);
        }
        void pillarGeo;
        ctx.collider(tx + x, tz + z, 1.5);
        // architrave between whole neighbours
        const b = ((i + 1) / 12) * TWO_PI;
        if (!broken && (i + 1) % 4 !== 1) {
            const x2 = Math.sin(b) * 33, z2 = Math.cos(b) * 33;
            const len = Math.hypot(x2 - x, z2 - z);
            B.add(new THREE.BoxGeometry(len, 1.2, 2.2), stone, (x + x2) / 2, 15.4, (z + z2) / 2, Math.atan2(-(z2 - z), x2 - x));
        }
    }
    // Moss, fallen blocks
    for (let i = 0; i < 26; i++) {
        const a = rnd() * TWO_PI, r = 6 + rnd() * 36;
        B.add(new THREE.BoxGeometry(between(0.8, 2.2), between(0.5, 1.4), between(0.8, 2.2)), rnd() < 0.5 ? mossy : stone, Math.sin(a) * r, 0.9, Math.cos(a) * r, rnd() * 3);
    }
    // Guardian faces at the northern edge
    for (const s of [-1, 1]) {
        const head = new THREE.Mesh(noisy(new THREE.SphereGeometry(4.5, 20, 14), 0.06, 0.4), stone);
        head.scale.set(0.9, 1.2, 0.9);
        head.position.set(s * 14, 3.6, -41);
        g.add(head);
        for (const e of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.7, 8, 6), ctx.glowMat(0x7fe8ff, 0.5, 0.8), s * 14 + e * 1.6, 4.6, -37.3));
        g.add(mesh(new THREE.BoxGeometry(1.2, 0.5, 0.5), mat(0x777777, { r: 0.9 }), s * 14, 2.2, -36.6));
        ctx.collider(tx + s * 14, tz - 41, 4);
    }
    B.build(g);
    // Glyph pillars: four obelisks at the compass points, each with a lit glyph panel
    const glyphs = [];
    GLYPHS.forEach((gl, i) => {
        const a = (i / 4) * TWO_PI + Math.PI / 4;
        const x = Math.sin(a) * 15, z = Math.cos(a) * 15;
        const o = new THREE.Group();
        o.add(mesh(new THREE.BoxGeometry(2.6, 0.8, 2.6), stone, 0, 0.4, 0));
        const body = mesh(new THREE.BoxGeometry(1.9, 7, 1.9), stone, 0, 4.2, 0);
        o.add(body);
        const mt = new THREE.MeshStandardMaterial({ map: glyphTexture(gl), emissive: new THREE.Color(gl.color), emissiveMap: glyphTexture(gl), emissiveIntensity: 0.35, roughness: 0.5 });
        const panel = mesh(new THREE.PlaneGeometry(1.6, 1.6), mt, 0, 5.2, 0.96);
        o.add(panel);
        const cap = mesh(new THREE.ConeGeometry(1.2, 1.6, 4), stone, 0, 8.6, 0);
        cap.rotation.y = Math.PI / 4;
        o.add(cap);
        const orb = mesh(new THREE.SphereGeometry(0.4, 10, 8), new THREE.MeshStandardMaterial({ color: gl.color, emissive: new THREE.Color(gl.color), emissiveIntensity: 0.4 }), 0, 9.7, 0);
        o.add(orb);
        const beam = glowSprite(new THREE.Color(gl.color).getHex(), 6, 0);
        beam.position.set(0, 9.7, 0);
        o.add(beam);
        o.position.set(x, 0.6, z);
        o.rotation.y = a + Math.PI;
        g.add(o);
        ctx.collider(tx + x, tz + z, 1.6);
        glyphs.push({ mat: mt, orb, beam, gl, pos: new THREE.Vector3(tx + x, y0 + 6, tz + z) });
    });
    // The central monolith with a sealed vault (two sliding doors)
    const mono = new THREE.Group();
    mono.add(mesh(new THREE.BoxGeometry(11, 13, 5), stone, 0, 6.5, 0));
    mono.add(mesh(new THREE.BoxGeometry(12, 1.2, 6), mossy, 0, 13.4, 0));
    const doorL = mesh(new THREE.BoxGeometry(2.6, 6.5, 0.7), new THREE.MeshStandardMaterial({ color: 0x8f8b7e, roughness: 0.8 }), -1.3, 3.4, 2.6);
    const doorR = mesh(new THREE.BoxGeometry(2.6, 6.5, 0.7), new THREE.MeshStandardMaterial({ color: 0x8f8b7e, roughness: 0.8 }), 1.3, 3.4, 2.6);
    mono.add(doorL, doorR);
    const seal = mesh(new THREE.TorusGeometry(1.6, 0.14, 6, 24), ctx.glowMat(0xff7675, 0.8, 0.5), 0, 3.6, 3.0);
    mono.add(seal);
    const vaultGlow = glowSprite(0x9ff4ff, 8, 0);
    vaultGlow.position.set(0, 4, 0.5);
    mono.add(vaultGlow);
    // inside: the pedestal with the old map
    const pedestal = mesh(new THREE.CylinderGeometry(0.7, 0.9, 1.4, 8), stone, 0, 0.9, -0.4);
    mono.add(pedestal);
    const mapObj = mesh(new THREE.BoxGeometry(1.4, 0.06, 1.0), ctx.glowMat(0xffeaa7, 0.6, 0.3), 0, 1.7, -0.4);
    mapObj.rotation.x = -0.3;
    mono.add(mapObj);
    mono.position.set(0, 0.6, -4);
    g.add(mono);
    ctx.collider(tx, tz - 4, 6.5);
    // Light motes
    const N = 70;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const motes = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTexture(), size: 0.6, color: 0xbff6ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.75 }));
    motes.frustumCulled = false;
    scene.add(motes);
    g.position.set(tx, y0, tz);
    scene.add(g);
    ctx.refs.temple = {
        root: g, glyphs, doorL, doorR, seal, vaultGlow, mapObj,
        center: new THREE.Vector3(tx, y0, tz), vault: new THREE.Vector3(tx, y0 + 3.2, tz - 4 + 6), open: 0
    };
    ctx.anim.push((t, dt) => {
        const T = ctx.refs.temple;
        for (const gl of T.glyphs) {
            gl.mat.emissiveIntensity = 0.35 + (gl.flash || 0) * 2.2;
            gl.beam.material.opacity = (gl.flash || 0) * 0.9;
            gl.flash = Math.max(0, (gl.flash || 0) - dt * 2.2);
        }
        const target = T.open;
        const d = target - (T._open || 0);
        T._open = (T._open || 0) + clamp(d, -dt * 0.35, dt * 0.35);
        T.doorL.position.x = -1.3 - T._open * 2.6;
        T.doorR.position.x = 1.3 + T._open * 2.6;
        T.vaultGlow.material.opacity = T._open * 0.7;
        T.seal.material.emissiveIntensity = T.open ? 0 : 0.8;
        const p = motes.geometry.attributes.position;
        for (let i = 0; i < N; i++) {
            const a = i * 2.3 + t * 0.06;
            const r = 8 + (i % 9) * 3.5;
            p.setXYZ(i, tx + Math.sin(a) * r, y0 + 2 + ((t * 0.25 + i * 0.173) % 1) * 12, tz + Math.cos(a) * r);
        }
        p.needsUpdate = true;
    });
}

// ================================================================================================
// The Glow Caves
// ================================================================================================
export function buildCaves(ctx) {
    const { scene, env } = ctx;
    const cx = CAVE.x, cz = CAVE.z;
    const y0 = ground(cx, cz);
    const R = 60, H = 36;
    const entAz = Math.atan2(-cx, -cz);          // towards the town
    const rnd = mulberry32(404);
    const g = new THREE.Group();
    // Dome: a displaced hemisphere with a doorway cut into it
    const WS = 72, HS = 22;
    const pos = [], col = [], idx = [];
    const c = new THREE.Color();
    for (let iy = 0; iy <= HS; iy++) {
        const el = (iy / HS) * (Math.PI / 2) - 0.08;
        for (let ix = 0; ix <= WS; ix++) {
            const az = (ix / WS) * TWO_PI;
            const n = noise2(Math.sin(az) * 3 + iy * 0.35, Math.cos(az) * 3 + iy * 0.2) * 0.1 + noise2(az * 5, iy * 0.9) * 0.04;
            const r = R * (1 + n) * (1 - 0.1 * Math.pow(el / (Math.PI / 2), 6));
            pos.push(Math.sin(az) * Math.cos(el) * r, Math.sin(el) * H * (1 + n * 0.6), Math.cos(az) * Math.cos(el) * r);
            c.set(0x5a5560).lerp(new THREE.Color(0x3a3640), clamp(el * 0.9 + n * 2, 0, 1));
            if (noise2(az * 7, iy * 1.2 + 5) > 0.4) c.lerp(new THREE.Color(0x486a58), 0.5);
            col.push(c.r, c.g, c.b);
        }
    }
    for (let iy = 0; iy < HS; iy++) {
        for (let ix = 0; ix < WS; ix++) {
            const az = ((ix + 0.5) / WS) * TWO_PI, el = ((iy + 0.5) / HS) * (Math.PI / 2);
            if (Math.abs(angleDiff(az, entAz)) < 0.3 && el < 0.62) continue;
            const a = iy * (WS + 1) + ix, b = a + 1, c2 = a + WS + 1, d = c2 + 1;
            idx.push(a, b, c2, b, d, c2);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const dome = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
    g.add(dome);
    // Floor
    const floor = mesh(new THREE.CircleGeometry(R * 0.98, 48), new THREE.MeshStandardMaterial({ color: 0x2a2630, roughness: 1 }), 0, 0.2, 0);
    floor.rotation.x = -Math.PI / 2;
    g.add(floor);
    g.position.set(cx, y0, cz);
    scene.add(g);
    // Doorway frame: boulders either side
    const rockM = new THREE.MeshStandardMaterial({ color: 0x57525e, roughness: 1 });
    const B = new Batch();
    for (const s of [-1, 1]) {
        const a = entAz + s * 0.34;
        for (let i = 0; i < 4; i++) {
            const geo2 = noisy(new THREE.IcosahedronGeometry(1, 2), 0.35, 1.5, i + s);
            B.add(geo2, rockM, Math.sin(a) * (R - 2 + i * 0.3), 3 + i * 3.2, Math.cos(a) * (R - 2 + i * 0.3), rnd() * 6, between(3, 5), between(3, 5), between(3, 5));
        }
        ctx.collider(cx + Math.sin(a) * R, cz + Math.cos(a) * R, 5);
    }
    // Stalactites and stalagmites
    for (let i = 0; i < 90; i++) {
        const a = rnd() * TWO_PI, r = Math.sqrt(rnd()) * R * 0.86;
        if (Math.abs(angleDiff(a, entAz)) < 0.35 && r > R * 0.55) continue;
        const el = Math.acos(clamp(r / (R * 0.97), 0, 1));
        const yTop = Math.sin(el) * H * 0.98;
        const len = between(2, 8);
        B.add(new THREE.ConeGeometry(between(0.4, 1.1), len, 6), rockM, Math.sin(a) * r, yTop - len / 2, Math.cos(a) * r, 0, 1, 1, 1, Math.PI);
    }
    for (let i = 0; i < 50; i++) {
        const a = rnd() * TWO_PI, r = Math.sqrt(rnd()) * R * 0.9;
        const len = between(1.5, 6);
        B.add(new THREE.ConeGeometry(between(0.5, 1.3), len, 6), rockM, Math.sin(a) * r, len / 2 + 0.2, Math.cos(a) * r);
        if (len > 3.5) ctx.collider(cx + Math.sin(a) * r, cz + Math.cos(a) * r, 0.9);
    }
    B.build(g);
    // Glowing mushrooms: stems and caps in cyan, magenta and green (instanced, emissive)
    const mushCols = [0x48dbfb, 0xff6bd6, 0x7cff9a, 0xa29bfe];
    const mushMats = mushCols.map((cc) => ctx.glowMat(cc, 1.1, 0.2));
    const capGeo = new THREE.SphereGeometry(0.7, 12, 8, 0, TWO_PI, 0, Math.PI / 2);
    const stemGeo = new THREE.CylinderGeometry(0.12, 0.18, 1, 6);
    stemGeo.translate(0, 0.5, 0);
    const mushLights = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3();
    mushMats.forEach((mm, k) => {
        const N = 28;
        const caps = new THREE.InstancedMesh(capGeo, mm, N);
        const stems = new THREE.InstancedMesh(stemGeo, mat(0xd8d8e8, { r: 0.7, e: 0.2 }), N);
        for (let i = 0; i < N; i++) {
            const a = rnd() * TWO_PI, r = Math.sqrt(rnd()) * R * 0.9;
            const h = between(1, 4), sc = between(0.7, 2);
            const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
            q.setFromEuler(new THREE.Euler(0, rnd() * 6, 0));
            p3.set(x, y0 + 0.2, z);
            s3.set(0.4 * sc, h, 0.4 * sc);
            stems.setMatrixAt(i, m4.compose(p3, q, s3));
            p3.set(x, y0 + 0.2 + h, z);
            s3.set(sc, sc * 0.8, sc);
            caps.setMatrixAt(i, m4.compose(p3, q, s3));
            if (i < 3) {
                const gs = glowSprite(mushCols[k], 7, 0.35);
                gs.position.set(x, y0 + h + 1, z);
                scene.add(gs);
                mushLights.push(gs);
            }
        }
        scene.add(caps, stems);
    });
    // Crystal clusters
    const crystalM = [ctx.glowMat(0x6cb4ff, 0.9, 0.2, { roughness: 0.1, transparent: true, opacity: 0.85 }), ctx.glowMat(0xd36cff, 0.9, 0.2, { roughness: 0.1, transparent: true, opacity: 0.85 })];
    for (let i = 0; i < 18; i++) {
        const a = rnd() * TWO_PI, r = Math.sqrt(rnd()) * R * 0.88;
        const grp = new THREE.Group();
        for (let k = 0; k < 5; k++) {
            const h = between(1.5, 5);
            const cr = new THREE.Mesh(new THREE.ConeGeometry(between(0.3, 0.7), h, 5), crystalM[i % 2]);
            cr.position.set(Math.sin(k * 2) * 0.8, h / 2, Math.cos(k * 2) * 0.8);
            cr.rotation.set(Math.sin(k * 3) * 0.3, 0, Math.cos(k * 2) * 0.3);
            grp.add(cr);
        }
        grp.position.set(cx + Math.sin(a) * r, y0 + 0.2, cz + Math.cos(a) * r);
        scene.add(grp);
        const gs = glowSprite(i % 2 ? 0xd36cff : 0x6cb4ff, 9, 0.28);
        gs.position.copy(grp.position).add(new THREE.Vector3(0, 2, 0));
        scene.add(gs);
    }
    // Glowworms on the ceiling
    const N = 260;
    const wg = new THREE.BufferGeometry();
    const wp = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
        const a = rnd() * TWO_PI, el = rnd() * 1.1 + 0.25;
        wp.set([cx + Math.sin(a) * Math.cos(el) * R * 0.93, y0 + Math.sin(el) * H * 0.94, cz + Math.cos(a) * Math.cos(el) * R * 0.93], i * 3);
    }
    wg.setAttribute('position', new THREE.BufferAttribute(wp, 3));
    const worms = new THREE.Points(wg, new THREE.PointsMaterial({ map: glowTexture(), size: 0.9, color: 0x9ff4ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }));
    worms.frustumCulled = false;
    scene.add(worms);
    // Gerald's hoard at the back of the cave
    const hoardAz = entAz + Math.PI;
    const hx = cx + Math.sin(hoardAz) * 38, hz = cz + Math.cos(hoardAz) * 38;
    const hoard = new THREE.Group();
    const heap = new THREE.Mesh(noisy(new THREE.ConeGeometry(11, 7, 18, 4), 0.12, 0.5, 3), new THREE.MeshStandardMaterial({ color: 0xe7b53a, metalness: 0.85, roughness: 0.35, emissive: 0xb07a10, emissiveIntensity: 0.35 }));
    heap.position.y = 3.2;
    hoard.add(heap);
    const coinGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.06, 10);
    const coins = new THREE.InstancedMesh(coinGeo, new THREE.MeshStandardMaterial({ color: 0xffd54f, metalness: 0.9, roughness: 0.25, emissive: 0xb07a10, emissiveIntensity: 0.4 }), 220);
    for (let i = 0; i < 220; i++) {
        const a = rnd() * TWO_PI, r = Math.sqrt(rnd()) * 12;
        q.setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3));
        p3.set(Math.sin(a) * r, Math.max(0.1, 6.5 * (1 - r / 11.5)) + rnd() * 0.8, Math.cos(a) * r);
        coins.setMatrixAt(i, m4.compose(p3, q, s3.set(1, 1, 1)));
    }
    hoard.add(coins);
    // stolen trinkets: goblets, vases, a trident, odd socks
    const trinkM = [0xff6b81, 0x74b9ff, 0xa29bfe, 0x55efc4, 0xfeca57];
    for (let i = 0; i < 16; i++) {
        const a = rnd() * TWO_PI, r = rnd() * 9 + 1;
        const t = mesh(i % 3 === 0 ? new THREE.CylinderGeometry(0.25, 0.4, 0.9, 8) : i % 3 === 1 ? new THREE.SphereGeometry(0.45, 8, 6) : new THREE.OctahedronGeometry(0.5), mat(trinkM[i % 5], { m: 0.6, r: 0.3, e: 0.15 }), Math.sin(a) * r, Math.max(0.5, 6.2 * (1 - r / 11.5)) + 0.6, Math.cos(a) * r);
        hoard.add(t);
    }
    // the throne: a pile of upturned barrels and a ship's wheel
    const throne = new THREE.Group();
    throne.add(mesh(new THREE.CylinderGeometry(1.2, 1.4, 2, 10), mat(0x7a5a45, { r: 0.9 }), 0, 1, 0));
    throne.add(mesh(new THREE.TorusGeometry(1.6, 0.18, 6, 14), mat(0x3d2c22, { r: 0.9 }), 0, 3.4, -0.9));
    throne.position.set(0, 6.6, 0);
    hoard.add(throne);
    // The Moon Pearl on a bed of coins
    const moon = new THREE.Group();
    const moonBall = mesh(new THREE.SphereGeometry(1.3, 28, 20), new THREE.MeshStandardMaterial({ color: 0xfdfbe8, emissive: 0xfff3b0, emissiveIntensity: 0.9, roughness: 0.05, metalness: 0.2 }), 0, 0, 0);
    moon.add(moonBall);
    const moonGlow = glowSprite(0xfff3b0, 12, 0.7);
    moon.add(moonGlow);
    moon.position.set(3.2, 8.9, 1.5);
    hoard.add(moon);
    hoard.position.set(hx, y0, hz);
    scene.add(hoard);
    ctx.collider(hx, hz, 8);
    ctx.refs.caves = {
        center: new THREE.Vector3(cx, y0, cz), radius: R, height: H, entAz, entrance: new THREE.Vector3(cx + Math.sin(entAz) * R, y0 + 4, cz + Math.cos(entAz) * R),
        hoard: new THREE.Vector3(hx, y0 + 7, hz), geraldPos: new THREE.Vector3(hx + Math.sin(entAz) * 6, y0 + 9.4, hz + Math.cos(entAz) * 6), moon, moonWorld: new THREE.Vector3(hx, y0, hz).add(moon.position),
        floorY: y0
    };
    // Glow orb spots (collectibles) deep in the cave
    ctx.refs.orbSpots = [];
    for (let i = 0; i < 5; i++) {
        const a = entAz + Math.PI + (i - 2) * 0.55 + (i % 2) * 0.2, r = 14 + (i % 3) * 8 + (i > 2 ? 6 : 0);
        ctx.refs.orbSpots.push(new THREE.Vector3(cx + Math.sin(a) * r, y0 + 2.6 + (i % 2), cz + Math.cos(a) * r));
    }
    ctx.anim.push((t) => {
        worms.material.opacity = 0.75 + Math.sin(t * 1.3) * 0.15;
        moonGlow.material.opacity = 0.6 + Math.sin(t * 2) * 0.15;
        moon.position.y = 8.9 + Math.sin(t * 1.2) * 0.15;
    });
}

// ================================================================================================
// The Music Grotto
// ================================================================================================
export function buildGrotto(ctx) {
    const { scene } = ctx;
    const [gx, gz] = A('grotto');
    const y0 = ground(gx, gz);
    const g = new THREE.Group();
    const rock = new THREE.MeshStandardMaterial({ color: 0x6d6a78, roughness: 0.95 });
    const B = new Batch();
    // Stepped seating: arcs of rock slabs around the back of the bowl
    for (let row = 0; row < 5; row++) {
        const r = 14 + row * 3.6;
        const n = 12 + row * 3;
        for (let i = 0; i < n; i++) {
            const a = Math.PI * 0.12 + (i / (n - 1)) * Math.PI * 1.76 - Math.PI * 0.5;
            const x = Math.sin(a) * r, z = -Math.cos(a) * r * 0.9 - 1;
            if (z > 4) continue;
            B.add(new THREE.BoxGeometry(3.2, 0.7 + row * 0.55, 1.6), rock, x, (0.7 + row * 0.55) / 2 - 0.4, z, -a + Math.PI);
        }
    }
    // Stage disc and its glowing tiles
    B.add(new THREE.CylinderGeometry(8.2, 8.8, 0.8, 32), mat(0x2b2b40, { r: 0.4 }), 0, 0.2, 0);
    B.build(g);
    const tiles = [];
    for (let i = 0; i < 5; i++) for (let k = 0; k < 5; k++) {
        const t = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff9ff3, emissiveIntensity: 0.8 }));
        t.rotation.x = -Math.PI / 2;
        t.position.set((i - 2) * 2.0, 0.62, (k - 2) * 2.0);
        if (Math.hypot(i - 2, k - 2) > 2.9) continue;
        g.add(t);
        tiles.push({ t, i, k });
    }
    // The shell sounding board behind the stage
    const reflector = new THREE.Mesh(new THREE.SphereGeometry(11, 32, 16, 0, Math.PI, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0xffd9ec, roughness: 0.3, iridescence: 0.8, side: THREE.DoubleSide }));
    reflector.rotation.set(Math.PI / 2 * 0.0, -Math.PI / 2, 0);
    reflector.scale.set(1, 1.2, 1);
    reflector.position.set(0, 0.6, -9);
    reflector.rotation.y = Math.PI;
    reflector.rotation.x = 0;
    g.add(reflector);
    // Speakers: spiral conch horns
    for (const s of [-1, 1]) {
        const horn = new THREE.Mesh(turretGeo(5, 1.6, 0xff9ff3, 0xffffff, 2), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.2 }));
        horn.position.set(s * 8.4, 0.6, -2);
        horn.rotation.z = s * 0.2;
        g.add(horn);
    }
    // Disco ball with faceted mirror tiles, and beams
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(1.7, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.08, flatShading: true }));
    ball.position.set(0, 13, 0);
    g.add(ball);
    g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 8, 4), mat(0xcccccc), 0, 17, 0));
    const flares = [];
    const flareCols = [0xff9ff3, 0x48dbfb, 0xfeca57, 0x55efc4];
    for (let i = 0; i < 14; i++) {
        const s = glowSprite(flareCols[i % 4], 1.4, 0.8);
        ball.add(s);
        const a = i * 2.4, e = Math.acos(1 - ((i + 0.5) / 14) * 2);
        s.position.set(Math.sin(e) * Math.cos(a) * 1.8, Math.cos(e) * 1.8, Math.sin(e) * Math.sin(a) * 1.8);
        flares.push(s);
    }
    const beams = [];
    for (let i = 0; i < 6; i++) {
        const gg = new THREE.ConeGeometry(2.4, 18, 14, 1, true);
        gg.translate(0, -9, 0);
        const m = new THREE.Mesh(gg, new THREE.MeshBasicMaterial({ color: flareCols[i % 4], transparent: true, opacity: 0.11, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
        m.position.set(0, 16.5, 0);
        g.add(m);
        beams.push(m);
    }
    g.position.set(gx, y0, gz);
    scene.add(g);
    // DJ booth at the back of the stage
    const booth = mesh(new THREE.BoxGeometry(4.2, 1.3, 1.5), mat(0x2b2b40, { r: 0.4 }), 0, 1.4, -4.4);
    g.add(booth);
    g.add(mesh(new THREE.BoxGeometry(3.6, 0.1, 1.1), ctx.glowMat(0x48dbfb, 0.8, 0.5), 0, 2.1, -4.4));
    ctx.collider(gx, gz - 4.4, 2.6);
    ctx.refs.grotto = {
        center: new THREE.Vector3(gx, y0, gz), stage: new THREE.Vector3(gx, y0 + 3.2, gz + 2), dj: new THREE.Vector3(gx, y0 + 4.2, gz - 4.6), root: g, ball
    };
    ctx.anim.push((t) => {
        ball.rotation.y = t * 0.6;
        tiles.forEach(({ t: tl, i, k }) => {
            const c = new THREE.Color().setHSL(((t * 0.15 + (i + k) * 0.08) % 1), 0.8, 0.55);
            tl.material.emissive.copy(c);
            tl.material.color.copy(c);
        });
        beams.forEach((b, i) => {
            b.rotation.z = Math.sin(t * 0.8 + i * 1.1) * 0.7;
            b.rotation.x = Math.cos(t * 0.6 + i * 0.9) * 0.7;
        });
    });
}

// ================================================================================================
// The Deep Trench
// ================================================================================================
export function buildTrench(ctx) {
    const { scene } = ctx;
    const bottomY = ground(TRENCH.x, TRENCH.z);
    const rnd = mulberry32(999);
    // Hydrothermal chimneys with tube worms
    const B = new Batch();
    const chim = new THREE.MeshStandardMaterial({ color: 0x2e2a35, roughness: 0.9 });
    const wormM = ctx.glowMat(0xff4d6a, 0.7, 0.2);
    const wormB = new Batch();
    for (let i = 0; i < 10; i++) {
        const a = rnd() * TWO_PI, r = rnd() * 28;
        const x = TRENCH.x + Math.sin(a) * r, z = TRENCH.z + Math.cos(a) * r;
        const h = between(4, 12);
        const y = ground(x, z);
        B.add(new THREE.CylinderGeometry(0.7, 1.8, h, 8), chim, x, y + h / 2, z);
        for (let k = 0; k < 8; k++) {
            wormB.add(new THREE.CylinderGeometry(0.06, 0.09, 1.8, 5), wormM, x + Math.sin(k * 2) * 1.2, y + h * 0.7 + 0.9, z + Math.cos(k * 2) * 1.2, 0, 1, 1, 1, Math.sin(k) * 0.2, Math.cos(k * 3) * 0.2);
        }
        const gs = glowSprite(0xff4d6a, 6, 0.4);
        gs.position.set(x, y + h * 0.7 + 1.5, z);
        scene.add(gs);
    }
    const g = new THREE.Group();
    B.build(g);
    wormB.build(g);
    scene.add(g);
    // The relic: a crown-shaped crystal floating over a pedestal at the very bottom
    const relic = new THREE.Group();
    relic.add(mesh(new THREE.CylinderGeometry(1.2, 1.6, 1.2, 8), chim, 0, 0.6, 0));
    const crystal = mesh(new THREE.OctahedronGeometry(1.2, 0), new THREE.MeshStandardMaterial({ color: 0x9ff4ff, emissive: 0x48dbfb, emissiveIntensity: 1.6, roughness: 0.05, transparent: true, opacity: 0.9 }), 0, 3, 0);
    crystal.scale.y = 1.7;
    relic.add(crystal);
    const rg = glowSprite(0x48dbfb, 14, 0.7);
    rg.position.set(0, 3, 0);
    relic.add(rg);
    relic.position.set(TRENCH.x, bottomY, TRENCH.z);
    scene.add(relic);
    ctx.refs.trench = { bottom: new THREE.Vector3(TRENCH.x, bottomY, TRENCH.z), relic, crystal, bottomY, rim: new THREE.Vector3(TRENCH.x, 3, TRENCH.z - TRENCH.r) };
    ctx.anim.push((t) => {
        crystal.rotation.y = t * 0.8;
        crystal.position.y = 3 + Math.sin(t * 1.4) * 0.3;
        rg.material.opacity = 0.6 + Math.sin(t * 2) * 0.15;
    });
}
