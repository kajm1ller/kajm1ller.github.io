/**
 * js/game/mermaid/mermaidTown.js
 *
 * Mermaid Town: the coral plaza with its fountain and merman statue, spiral shell houses, market
 * stalls, pearl lamps, the Dressing Shell (where you are made), the Coral Chapel and its moon
 * tower, the Mermaid Mall with its shop alcoves and food court, the Clam Arcade, the Sea Garden
 * and the Pet Nook.
 *
 * Also the shared build context (makeContext) and helpers the other areas use.
 */

import * as THREE from 'three';
import {
    TWO_PI, between, pick, clamp, lerp, smooth, mulberry32, std, mat, mesh, joint, canvasTexture, signTexture, glowSprite, glowTexture,
    makeSway, SWAY, merge, paint, lerpColor, shade, starGeometry, Batch, labelSprite
} from './mermaidKit.js';
import { floorHeight } from './mermaidEnv.js';
import { AREAS, areaById, SHOPS, TOWNSFOLK } from './mermaidData.js';
import { buildMermaid } from './mermaidModel.js';
import { buildCrab, buildOctopus, buildTurtle, buildFish } from './mermaidCreatures.js';
import { defaultLook, normalizeLook } from './mermaidData.js';
import { panelTexture } from './mermaidFace.js';

const A = (id) => areaById(id).at;

// ================================================================================================
// Build context shared by every area
// ================================================================================================
export function makeContext(scene, env, opts = {}) {
    const ctx = {
        scene, env, shadows: !!opts.shadows,
        colliders: [],
        anim: [],           // functions (t, dt, ctx) run each frame
        refs: {},           // things the world needs to find
        keepers: [],        // standing characters { m, home, action }
        glowMat(color, base = 0.4, night = 1.6, extra = {}) {
            const m = new THREE.MeshStandardMaterial(Object.assign({ color, emissive: color, emissiveIntensity: base, roughness: 0.4 }, extra));
            env.registerGlow(m, base, night);
            return m;
        },
        ground: floorHeight,
        place(obj, x, z, dy = 0, ry = 0) {
            obj.position.set(x, floorHeight(x, z) + dy, z);
            obj.rotation.y = ry;
            return obj;
        },
        collider(x, z, r, y0 = -1e9, y1 = 1e9) {
            ctx.colliders.push({ x, z, r, y0, y1 });
        },
        lamp(x, z, h = 3.4, color = 0xfff0c0) {
            const g = ctx.lampGroup;
            const y = floorHeight(x, z);
            g.batch.add(g.poleGeo, g.poleMat, x, y, z);
            g.bulbs.push([x, y + h, z, color]);
        }
    };
    return ctx;
}

export function stripeTexture(c1, c2, n = 8) {
    return canvasTexture(256, 64, (g, w, h) => {
        for (let i = 0; i < n; i++) {
            g.fillStyle = i % 2 ? c2 : c1;
            g.fillRect((i * w) / n, 0, w / n + 1, h);
        }
        g.fillStyle = 'rgba(0,0,0,0.15)';
        g.fillRect(0, h - 8, w, 8);
    });
}

export function neonTexture(text, color, bg = '#141428', w = 512, h = 128) {
    return canvasTexture(w, h, (g) => {
        g.fillStyle = bg;
        g.fillRect(0, 0, w, h);
        let size = Math.floor(h * 0.55);
        g.font = `bold ${size}px "Trebuchet MS", sans-serif`;
        while (g.measureText(text).width > w - 40 && size > 12) {
            size -= 2;
            g.font = `bold ${size}px "Trebuchet MS", sans-serif`;
        }
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.shadowColor = color;
        g.shadowBlur = 24;
        g.fillStyle = color;
        g.fillText(text, w / 2, h / 2 + 3);
        g.shadowBlur = 8;
        g.fillStyle = '#ffffff';
        g.fillText(text, w / 2, h / 2 + 3);
        g.strokeStyle = color;
        g.lineWidth = 5;
        g.shadowBlur = 12;
        g.strokeRect(8, 8, w - 16, h - 16);
    });
}

/** A spiral shell tower (lathe with a spiral ridge and banded colour). */
export function turretGeo(h, baseR, cA, cB, turns = 3) {
    const pts = [];
    const N = 40;
    for (let i = 0; i <= N; i++) {
        const t = i / N;
        pts.push(new THREE.Vector2(baseR * Math.pow(1 - t, 0.8) * (1 + 0.05 * Math.sin(t * 9)) + 0.03, t * h));
    }
    const g = new THREE.LatheGeometry(pts, 56);
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    const A_ = new THREE.Color(cA), B_ = new THREE.Color(cB), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const ang = Math.atan2(z, x);
        const phase = ang * 2 + (y / h) * turns * TWO_PI * 2;
        const ridge = 0.5 + 0.5 * Math.sin(phase);
        const k = 1 + 0.07 * ridge;
        p.setXYZ(i, x * k, y, z * k);
        c.copy(A_).lerp(B_, ridge * ridge);
        col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
}

function archShape(w, h) {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(-w / 2, h - w / 2);
    s.absarc(0, h - w / 2, w / 2, Math.PI, 0, true);
    s.lineTo(w / 2, 0);
    s.lineTo(-w / 2, 0);
    return s;
}

// ================================================================================================
// Pieces
// ================================================================================================
function shellHouse(ctx, kind, color, seed) {
    const rnd = mulberry32(seed);
    const g = new THREE.Group();
    const cA = color, cB = shade(color, kind === 'coral' ? -0.2 : 0.3);
    let doorY = 1.1, rDoor = 4;
    if (kind === 'turret' || kind === 'squat') {
        const h = kind === 'turret' ? between(11, 15) : between(5.5, 7.5);
        const r = kind === 'turret' ? between(4, 5) : between(6, 7.5);
        const geo = turretGeo(h, r, cA, cB, kind === 'turret' ? 3 : 2);
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.12 }));
        m.castShadow = ctx.shadows;
        g.add(m);
        const rAt = (y) => r * Math.pow(1 - y / h, 0.8) + 0.03;
        rDoor = rAt(1.6) * 1.02;
        // a little curl at the tip
        g.add(mesh(new THREE.ConeGeometry(0.5, 2.0, 8), mat(shade(color, 0.4), { r: 0.3 }), 0, h + 0.8, 0));
        // windows up the spiral
        const wm = ctx.winMat;
        for (let i = 0; i < 3; i++) {
            const y = h * (0.35 + i * 0.2);
            const rr = rAt(y);
            if (rr < 1) break;
            const a = (i % 2 ? 0.55 : -0.55) + (rnd() - 0.5) * 0.3;
            const w = mesh(new THREE.CircleGeometry(Math.min(0.7, rr * 0.2), 14), wm, Math.sin(a) * (rr + 0.02) * 1.07, y, Math.cos(a) * (rr + 0.02) * 1.07);
            w.rotation.y = a;
            g.add(w);
        }
        ctx.collider(0, 0, r * 0.95);
        g.userData.r = r;
    } else if (kind === 'clam') {
        const r = between(5, 6);
        const lower = mesh(new THREE.SphereGeometry(r, 28, 12, 0, TWO_PI, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: cA, roughness: 0.35, metalness: 0.2, side: THREE.DoubleSide }));
        lower.scale.y = 0.35;
        g.add(lower);
        const upper = mesh(new THREE.SphereGeometry(r, 28, 12, 0, TWO_PI, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: cB, roughness: 0.35, metalness: 0.2, side: THREE.DoubleSide }), 0, 1.1, -r * 0.85);
        upper.scale.y = 0.55;
        upper.rotation.x = -0.55;
        g.add(upper);
        const pearl = mesh(new THREE.SphereGeometry(0.9, 16, 12), ctx.glowMat(0xf4fbff, 0.3, 1.6, { roughness: 0.05, metalness: 0.3 }), 0, 0.9, 0);
        g.add(pearl);
        rDoor = r;
        doorY = 0.6;
        ctx.collider(0, 0, r * 0.9);
        g.userData.r = r;
    } else {
        // coral house: three fused columns with an arched hollow
        const mm = new THREE.MeshStandardMaterial({ color: cA, roughness: 0.6 });
        for (let i = 0; i < 4; i++) {
            const h = between(6, 11), r = between(1.2, 2.2);
            const col = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r, h, 10), i % 2 ? mm : new THREE.MeshStandardMaterial({ color: cB, roughness: 0.6 }));
            col.position.set((i - 1.5) * 2.2, h / 2, Math.sin(i * 2) * 1.0);
            g.add(col);
            for (let k = 0; k < 3; k++) {
                const b = mesh(new THREE.SphereGeometry(r * 0.55, 8, 6), mm, col.position.x + Math.sin(k * 2) * r * 0.7, h * (0.4 + k * 0.25), col.position.z + Math.cos(k * 2) * r * 0.7);
                g.add(b);
            }
        }
        rDoor = 3;
        ctx.collider(0, 0, 4.2);
        g.userData.r = 4.5;
    }
    // Door: a dark arch with a golden frame, and a glowing welcome mat
    const door = mesh(new THREE.ShapeGeometry(archShape(1.6, 2.6)), mat(0x2c1f18, { r: 0.8 }), 0, 0, rDoor + 0.05);
    door.position.y = doorY - 0.3;
    g.add(door);
    const frame = mesh(new THREE.TorusGeometry(0.85, 0.07, 5, 16, Math.PI), mat(0xf1c40f, { m: 0.8, r: 0.3 }), 0, doorY - 0.3 + 1.5, rDoor + 0.06);
    g.add(frame);
    const light = mesh(new THREE.CircleGeometry(0.5, 12), ctx.winMat, 0, doorY - 0.25, rDoor + 0.06);
    light.scale.set(1, 0.001, 1);
    g.add(light);
    return g;
}

function marketStall(ctx, x, z, ry, c1, c2, goods) {
    const g = new THREE.Group();
    const wood = mat(0x8d6e63, { r: 0.8 });
    for (const [px, pz] of [[-1.6, -1], [1.6, -1], [-1.6, 1], [1.6, 1]]) g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 3, 6), wood, px, 1.5, pz));
    g.add(mesh(new THREE.BoxGeometry(3.4, 0.12, 1.6), wood, 0, 1.0, 0.5));
    const aw = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 2.2, 4, 4), makeSway(new THREE.MeshStandardMaterial({ map: stripeTexture(c1, c2, 8), side: THREE.DoubleSide, roughness: 0.8 }), { axis: 'x', amp: 0.01, freq: 1, speed: 1.2 }));
    aw.position.set(0, 3.0, 0.1);
    aw.rotation.x = -Math.PI / 2 + 0.45;
    g.add(aw);
    for (let i = 0; i < 9; i++) {
        const gm = mat(pick(goods), { r: 0.5 });
        const s = mesh(new THREE.SphereGeometry(0.17, 10, 8), gm, -1.4 + i * 0.35, 1.22, 0.5 + Math.sin(i) * 0.25);
        g.add(s);
    }
    g.position.set(x, floorHeight(x, z), z);
    g.rotation.y = ry;
    ctx.scene.add(g);
    ctx.collider(x, z, 2.2);
}

// ================================================================================================
// The town
// ================================================================================================
export function buildTown(ctx, buildStatue) {
    const { scene, env } = ctx;
    const rnd = mulberry32(2024);
    const R = ctx.refs;
    ctx.winMat = ctx.glowMat(0xfff3b0, 0.5, 1.8, { side: THREE.DoubleSide });

    // ---- Lamps (instanced poles, bulbs and sprites) ----
    ctx.lampGroup = { batch: new Batch(), poleGeo: new THREE.CylinderGeometry(0.07, 0.09, 3.4, 6).translate(0, 1.7, 0), poleMat: mat(0x7d8186, { m: 0.6, r: 0.5 }), bulbs: [] };

    // ---- Plaza ----
    const plaza = new THREE.Group();
    const tex = canvasTexture(1024, 1024, (g, w, h) => {
        const cx = w / 2, cy = h / 2;
        g.fillStyle = '#d8cfc0';
        g.fillRect(0, 0, w, h);
        const rings = [[500, '#e8dcc6'], [460, '#9fd6d9'], [420, '#e8dcc6'], [380, '#f1b9c8'], [340, '#e8dcc6'], [300, '#8bbbe0'], [260, '#e8dcc6']];
        for (const [r, c] of rings) {
            g.fillStyle = c;
            g.beginPath();
            g.arc(cx, cy, r, 0, TWO_PI);
            g.fill();
        }
        // wave scallops between the rings
        g.strokeStyle = 'rgba(40,90,120,0.55)';
        g.lineWidth = 3;
        for (let k = 0; k < 48; k++) {
            const a = (k / 48) * TWO_PI;
            g.beginPath();
            g.arc(cx + Math.cos(a) * 440, cy + Math.sin(a) * 440, 22, a + Math.PI * 0.5, a + Math.PI * 1.5);
            g.stroke();
        }
        // compass star
        g.fillStyle = '#1c5b86';
        for (let k = 0; k < 8; k++) {
            const a = (k / 8) * TWO_PI, len = k % 2 ? 150 : 240;
            g.beginPath();
            g.moveTo(cx + Math.cos(a - 0.12) * 20, cy + Math.sin(a - 0.12) * 20);
            g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
            g.lineTo(cx + Math.cos(a + 0.12) * 20, cy + Math.sin(a + 0.12) * 20);
            g.fill();
        }
        g.fillStyle = '#f1c40f';
        g.beginPath();
        g.arc(cx, cy, 34, 0, TWO_PI);
        g.fill();
        // shells in the outer ring
        g.fillStyle = '#ffffff';
        for (let k = 0; k < 24; k++) {
            const a = (k / 24) * TWO_PI;
            g.beginPath();
            g.arc(cx + Math.cos(a) * 480, cy + Math.sin(a) * 480, 8, 0, TWO_PI);
            g.fill();
        }
    });
    const discTop = new THREE.Mesh(new THREE.CylinderGeometry(24, 25.5, 0.7, 72), [
        new THREE.MeshStandardMaterial({ color: 0xcfc6b6, roughness: 0.9 }),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }),
        new THREE.MeshStandardMaterial({ color: 0xbdb5a5, roughness: 0.9 })
    ]);
    ctx.place(discTop, 0, 0, 0.25);
    discTop.receiveShadow = true;
    scene.add(discTop);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(19.5, 0.28, 6, 64), ctx.glowMat(0x74b9ff, 0.5, 1.5));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, floorHeight(0, 0) + 0.62, 0);
    scene.add(ring);
    // Fountain: basin, pedestal, statue
    const y0 = floorHeight(0, 0);
    const basin = mesh(new THREE.CylinderGeometry(5.2, 5.6, 1.0, 36), mat(0xe9e1d2, { r: 0.7 }), 0, y0 + 0.9, 0);
    scene.add(basin);
    const water = mesh(new THREE.CircleGeometry(4.8, 36), new THREE.MeshStandardMaterial({ color: 0x74d4ff, transparent: true, opacity: 0.6, emissive: 0x2a86c1, emissiveIntensity: 0.4, roughness: 0.1 }), 0, y0 + 1.35, 0);
    water.rotation.x = -Math.PI / 2;
    scene.add(water);
    const ped = mesh(new THREE.CylinderGeometry(1.4, 1.9, 3.2, 14), mat(0xbdb6a8, { r: 0.8 }), 0, y0 + 2.5, 0);
    scene.add(ped);
    if (buildStatue) {
        const statue = buildStatue();
        statue.root.scale.setScalar(2.3);
        statue.root.position.set(0, y0 + 7.6, 0);
        scene.add(statue.root);
        R.statue = statue;
    }
    ctx.collider(0, 0, 5.8);
    // Fountain spray: a ring of bubble sprites arcing out of the basin
    const spray = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ map: env.bubbleTex, size: 0.5, transparent: true, depthWrite: false, opacity: 0.8 }));
    const sprayN = 90;
    spray.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sprayN * 3), 3));
    spray.frustumCulled = false;
    scene.add(spray);
    ctx.anim.push((t) => {
        const p = spray.geometry.attributes.position;
        for (let i = 0; i < sprayN; i++) {
            const k = ((t * 0.5 + i / sprayN) % 1);
            const a = i * 2.4;
            const rad = Math.sin(k * Math.PI) * (1.6 + (i % 5) * 0.55);
            p.setXYZ(i, Math.sin(a) * rad, y0 + 5.2 + Math.sin(k * Math.PI) * 4.2 - k * 2.5, Math.cos(a) * rad);
        }
        p.needsUpdate = true;
    });

    // ---- Shell houses ----
    const colors = [0xffb8d1, 0xc3aed6, 0xa0e7e5, 0xfbe7c6, 0xb4f8c8, 0xffaebc, 0xd4a5a5, 0xa2d2ff, 0xffc8dd, 0xcdb4db, 0xbde0fe, 0xffafcc];
    const kinds = ['turret', 'clam', 'squat', 'coral', 'turret', 'squat'];
    let k = 0;
    for (let ring_ = 0; ring_ < 2; ring_++) {
        const N = ring_ === 0 ? 14 : 18, rad = ring_ === 0 ? 52 : 82;
        for (let i = 0; i < N; i++) {
            const a = (i / N) * TWO_PI + ring_ * 0.2;
            const x = Math.sin(a) * rad, z = Math.cos(a) * rad;
            const nearChapelAvenue = z < -22 && Math.abs(x) < 26;
            const nearMall = x > 28 && Math.abs(z - 10) < 36;
            const nearVanity = Math.hypot(x - A('vanity')[0], z - A('vanity')[1]) < 18;
            const nearPet = Math.hypot(x - A('petnook')[0], z - A('petnook')[1]) < 14;
            const nearGarden = Math.hypot(x - A('garden')[0], z - A('garden')[1]) < 22;
            if (nearChapelAvenue || nearMall || nearVanity || nearPet || nearGarden) continue;
            const h = shellHouse(ctx, kinds[k % kinds.length], colors[k % colors.length], 100 + k);
            k++;
            h.position.set(x, floorHeight(x, z), z);
            h.rotation.y = Math.atan2(-x, -z); // doors face the plaza
            h.scale.setScalar(between(0.9, 1.15));
            scene.add(h);
            // colliders were registered relative to the house; re-register at world position
            const last = ctx.colliders.pop();
            ctx.collider(x, z, (last.r || 4) * h.scale.x);
            // a lamp by every other door
            if (ring_ === 0 && i % 2 === 0) ctx.lamp(x - Math.sin(a) * 9 + Math.cos(a) * 3, z - Math.cos(a) * 9 - Math.sin(a) * 3);
        }
    }
    // Market stalls
    marketStall(ctx, 22, -16, -0.9, '#ff7675', '#ffeaa7', [0xff6b81, 0xfeca57, 0x55efc4, 0xa29bfe]);
    marketStall(ctx, -26, -14, 0.9, '#74b9ff', '#ffffff', [0x55efc4, 0xff9ff3, 0xfeca57]);
    marketStall(ctx, 14, 26, 3.4, '#a29bfe', '#ffeaa7', [0xff9f43, 0xff7675, 0x74b9ff]);
    // Path lamps: ring around the plaza, the chapel avenue, the mall road
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TWO_PI;
        const lx = Math.sin(a) * 27, lz = Math.cos(a) * 27;
        if (Math.hypot(lx - A('vanity')[0], lz - A('vanity')[1]) < 12) continue; // clear of the dressing shell
        ctx.lamp(lx, lz);
    }
    for (let z = -26; z > -72; z -= 9) for (const x of [-6, 6]) ctx.lamp(x, z);
    for (let x = 30; x < 68; x += 9) for (const z of [3, 19]) ctx.lamp(x, z);
    // Benches
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TWO_PI + 0.26;
        const bench = new THREE.Group();
        bench.add(mesh(new THREE.TorusGeometry(1.0, 0.14, 6, 14, Math.PI * 0.55), mat(0xe8d5c0, { r: 0.5 }), 0, 0.5, 0));
        bench.children[0].rotation.x = Math.PI / 2;
        ctx.place(bench, Math.sin(a) * 21, Math.cos(a) * 21, 0.3, a + Math.PI);
        scene.add(bench);
    }
    // Flags
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TWO_PI + 0.78;
        const x = Math.sin(a) * 23, z = Math.cos(a) * 23;
        const pole = mesh(new THREE.CylinderGeometry(0.1, 0.12, 9, 8), mat(0xd9d9d9, { m: 0.5, r: 0.4 }), 0, 4.5, 0);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.8, 6, 3), makeSway(new THREE.MeshStandardMaterial({ map: stripeTexture(['#ff7eb3', '#7afcff', '#fdcb6e', '#a29bfe'][i], '#ffffff', 6), side: THREE.DoubleSide, roughness: 0.7 }), { axis: 'x', amp: 0.09, freq: 1.4, speed: 2.2 }));
        flag.position.set(1.6, 8.0, 0);
        const g = new THREE.Group();
        g.add(pole, flag);
        ctx.place(g, x, z, 0, a);
        scene.add(g);
    }

    // ---- Townsfolk (mermaids standing about) ----
    R.townsfolk = [];
    for (const t of TOWNSFOLK) {
        const look = normalizeLook(Object.assign({}, t.look));
        const m = buildMermaid(look);
        const home = new THREE.Vector3(t.at[0], floorHeight(t.at[0], t.at[2]) + 2.6, t.at[2]);
        m.root.position.copy(home);
        m.root.rotation.y = Math.atan2(-home.x, -home.z);
        scene.add(m.root);
        const lab = labelSprite(t.name, '#6c5ce7', 3.2);
        lab.position.set(0, 2.2, 0);
        m.root.add(lab);
        lab.visible = false;
        R.townsfolk.push({ def: t, m, home, label: lab, ph: Math.random() * 6 });
    }

    ctx.anim.push((t, dt) => {
        for (const f of R.townsfolk) {
            f.m.root.position.y = f.home.y + Math.sin(t * 0.9 + f.ph) * 0.18;
        }
    });

    return R;
}

/** Flushes the lamps once every area has asked for its poles. */
export function finishLamps(ctx) {
    const L = ctx.lampGroup;
    const group = new THREE.Group();
    L.batch.build(group);
    ctx.scene.add(group);
    const bulbGeo = new THREE.SphereGeometry(0.3, 10, 8);
    const bulbMat = ctx.glowMat(0xfff0c0, 0.6, 2.4);
    const inst = new THREE.InstancedMesh(bulbGeo, bulbMat, L.bulbs.length);
    const m4 = new THREE.Matrix4();
    L.bulbs.forEach(([x, y, z], i) => {
        inst.setMatrixAt(i, m4.makeTranslation(x, y, z));
        const s = glowSprite(0xffe9b0, 4.2, 0.9);
        s.position.set(x, y, z);
        ctx.env.registerLamp(s, 0.9);
        ctx.scene.add(s);
    });
    ctx.scene.add(inst);
}

// ================================================================================================
// The Dressing Shell
// ================================================================================================
export function buildVanity(ctx) {
    const { scene } = ctx;
    const [vx, vz] = A('vanity');
    const y0 = floorHeight(vx, vz);
    const g = new THREE.Group();
    const nacre = new THREE.MeshPhysicalMaterial({ color: 0xffd9ec, roughness: 0.3, metalness: 0.0, clearcoat: 0.6, iridescence: 0.7, iridescenceIOR: 1.5, side: THREE.DoubleSide, emissive: 0xffa8d6, emissiveIntensity: 0.28 });
    const scallop = (r, up) => {
        const geo = new THREE.SphereGeometry(r, 40, 16, 0, TWO_PI, up ? 0 : Math.PI / 2, Math.PI / 2);
        const p = geo.attributes.position;
        for (let i = 0; i < p.count; i++) {
            const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
            const ang = Math.atan2(z, x);
            const k = 1 + 0.06 * Math.cos(ang * 14) * (Math.abs(y) / r + 0.2);
            p.setXYZ(i, x * k, y, z * k);
        }
        geo.computeVertexNormals();
        return geo;
    };
    const base = new THREE.Mesh(scallop(6.2, false), nacre);
    base.scale.y = 0.35;
    g.add(base);
    const lid = new THREE.Mesh(scallop(6.2, true), nacre);
    lid.scale.y = 0.9;
    const hinge = joint(g, 0, 0.8, -5.4);
    lid.position.set(0, 0, 5.4);
    hinge.add(lid);
    hinge.rotation.x = -1.55;
    // inside of the lid is a big oval mirror in a golden frame
    const mirrorG = new THREE.CircleGeometry(4.2, 40);
    const mirrorTex = canvasTexture(256, 256, (c, w, h) => {
        const gr = c.createRadialGradient(w * 0.4, h * 0.35, 10, w / 2, h / 2, w * 0.62);
        gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.45, '#bfeaff'); gr.addColorStop(1, '#8fb7ff');
        c.fillStyle = gr; c.fillRect(0, 0, w, h);
        const rnd = mulberry32(7);
        for (let i = 0; i < 60; i++) { c.fillStyle = `rgba(255,255,255,${0.2 + rnd() * 0.5})`; c.beginPath(); c.arc(rnd() * w, rnd() * h, 1 + rnd() * 3, 0, 6.3); c.fill(); }
        c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 8; c.beginPath(); c.moveTo(w * 0.15, h * 0.85); c.lineTo(w * 0.5, h * 0.18); c.stroke();
    });
    const mirror = new THREE.Mesh(mirrorG, new THREE.MeshBasicMaterial({ map: mirrorTex, fog: false }));
    mirror.scale.set(1, 1.2, 1);
    mirror.position.set(0, 4.5, -4.0);
    mirror.rotation.x = 0.1;
    g.add(mirror);
    const frame = new THREE.Mesh(new THREE.TorusGeometry(4.3, 0.25, 8, 40), mat(0xf1c40f, { m: 0.85, r: 0.25 }));
    frame.scale.set(1, 1.2, 1);
    frame.position.copy(mirror.position);
    frame.position.z += 0.03;
    frame.rotation.x = 0.1;
    g.add(frame);
    // Vanity bulbs around the mirror
    const bulbM = ctx.glowMat(0xfff3c0, 0.9, 1.2);
    for (let i = 0; i < 18; i++) {
        const a = (i / 18) * TWO_PI;
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), bulbM);
        b.position.set(Math.cos(a) * 4.6, 4.5 + Math.sin(a) * 5.5, -3.85);
        g.add(b);
    }
    // Pedestal and a pearl floor
    const stage = mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.5, 32), mat(0xfff0f5, { r: 0.4 }), 0, 0.55, 3.8);
    g.add(stage);
    const gl = new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.1, 6, 36), ctx.glowMat(0xff9ff3, 0.7, 1.2));
    gl.rotation.x = Math.PI / 2;
    gl.position.set(0, 0.82, 3.8);
    g.add(gl);
    g.position.set(vx, y0, vz - 3.4);
    scene.add(g);
    ctx.collider(vx, vz - 7, 5);
    // Where the mermaid stands in the creator and for the wardrobe
    ctx.refs.vanity = { pos: new THREE.Vector3(vx, y0 + 3.6, vz + 0.4), mirror: mirror, root: g };
    ctx.refs.vanityLid = hinge;
    ctx.anim.push((t) => { hinge.rotation.x = -1.55 + Math.sin(t * 0.6) * 0.03; });
}

// ================================================================================================
// The chapel and the moon tower
// ================================================================================================
export function buildChapel(ctx) {
    const { scene, env } = ctx;
    const [cx, cz] = A('chapel');
    const y0 = floorHeight(cx, cz);
    const g = new THREE.Group();
    const pearl = new THREE.MeshPhysicalMaterial({ color: 0xfff5f8, roughness: 0.22, metalness: 0.15, clearcoat: 1, iridescence: 0.7, iridescenceIOR: 1.4, side: THREE.DoubleSide });
    const coral = std(0xff8fab, { roughness: 0.5 });
    // Dome with an arched entrance cut into the front (+z)
    const dome = new THREE.Mesh(new THREE.SphereGeometry(13, 40, 20, 0, TWO_PI, 0, Math.PI / 2), pearl);
    g.add(dome);
    // Ribs
    for (let i = 0; i < 10; i++) {
        const rib = new THREE.Mesh(new THREE.TorusGeometry(13.15, 0.28, 6, 28, Math.PI), coral);
        rib.rotation.y = (i / 10) * Math.PI;
        g.add(rib);
    }
    // Colonnade at the front and sides
    const col = new THREE.CylinderGeometry(0.7, 0.9, 11, 10);
    for (let i = 0; i < 11; i++) {
        const a = Math.PI * 0.05 + (i / 10) * Math.PI * 0.9 - Math.PI * 0.5 + Math.PI * 0.5;
        const ang = -Math.PI * 0.65 + (i / 10) * Math.PI * 1.3;
        const x = Math.sin(ang) * 15.2, z = Math.cos(ang) * 15.2;
        if (Math.abs(ang) < 0.22) continue; // the entrance
        void a;
        const c = mesh(col, coral, x, 5.5, z);
        g.add(c);
        ctx.collider(cx + x, cz + z, 1.0);
        g.add(mesh(new THREE.SphereGeometry(1.0, 10, 8), mat(0xffc0cb, { r: 0.4 }), x, 11.4, z));
    }
    // Entrance arch
    const arch = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.8, 10, 24, Math.PI), coral);
    arch.position.set(0, 3.4, 13.2);
    g.add(arch);
    const sign = mesh(new THREE.PlaneGeometry(10, 2.5), new THREE.MeshBasicMaterial({ map: signTexture('Coral Chapel', '#ff8fab'), transparent: true }), 0, 10.2, 13.4);
    g.add(sign);
    // Steps to the terrace
    for (let i = 0; i < 4; i++) g.add(mesh(new THREE.CylinderGeometry(7 - i * 0.7, 7.4 - i * 0.7, 0.5, 28), mat(0xfde2e4, { r: 0.5 }), 0, 0.25 + i * 0.5, 20 + 0));
    // Stained glass windows glowing in the dome
    const glass = [0xff7675, 0x74b9ff, 0xfeca57, 0xa29bfe, 0x55efc4];
    glass.forEach((c, i) => {
        const a = -1.25 + i * 0.62;
        const w = mesh(new THREE.CircleGeometry(1.2, 14), ctx.glowMat(c, 0.5, 1.4, { side: THREE.DoubleSide }), Math.sin(a) * 12.9 * 0.82, 6.5 + (i % 2) * 1.2, -Math.cos(a) * 12.9 * 0.55 - 4);
        w.lookAt(w.position.x * 2, w.position.y, w.position.z * 2 + 4);
        if (i !== 2) g.add(w);
    });
    // Interior floor and altar
    g.add(mesh(new THREE.CylinderGeometry(12.5, 12.5, 0.4, 36), mat(0xfff0f5, { r: 0.35 }), 0, 0.2, 0));
    const altar = mesh(new THREE.CylinderGeometry(1.8, 2.2, 1.6, 12), mat(0xffffff, { r: 0.3 }), 0, 1.0, -7);
    g.add(altar);
    // The moon tower rising behind the dome, with an empty crystal socket at the top
    const TH = 40;
    const tower = new THREE.Mesh(turretGeo(TH, 4.6, 0xfff0f5, 0xffd1e0, 4), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.2 }));
    tower.position.set(0, 0, -18);
    g.add(tower);
    const socket = new THREE.Group();
    socket.position.set(0, TH + 1.2, -18);
    const cup = mesh(new THREE.CylinderGeometry(2.4, 0.9, 1.6, 12, 1, true), mat(0xf1c40f, { m: 0.85, r: 0.25, side: THREE.DoubleSide }), 0, 0, 0);
    socket.add(cup);
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TWO_PI;
        const prong = mesh(new THREE.ConeGeometry(0.18, 2.4, 5), mat(0xf1c40f, { m: 0.85, r: 0.25 }), Math.sin(a) * 2.2, 1.5, Math.cos(a) * 2.2);
        prong.rotation.set(Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25);
        socket.add(prong);
    }
    g.add(socket);
    g.position.set(cx, y0, cz);
    scene.add(g);
    ctx.refs.chapel = { root: g, socket: new THREE.Vector3(cx, y0 + TH + 1.8, cz - 18) };
    // The ceremony terrace: round platform, shell benches along the aisle, fairy lights
    const terr = mesh(new THREE.CylinderGeometry(9, 9.6, 0.7, 36), mat(0xfff0f5, { r: 0.4 }), 0, 0, 0);
    ctx.place(terr, 0, -57, 0.0);
    scene.add(terr);
    const terrRing = new THREE.Mesh(new THREE.TorusGeometry(8.7, 0.12, 6, 36), ctx.glowMat(0xff9ff3, 0.6, 1.4));
    terrRing.rotation.x = Math.PI / 2;
    ctx.place(terrRing, 0, -57, 0.45);
    scene.add(terrRing);
    const pew = mat(0xfde2e4, { r: 0.4 });
    for (let z = -40; z > -52; z -= 3.2) {
        for (const x of [-5, -8.5, 5, 8.5]) {
            const p = new THREE.Mesh(new THREE.SphereGeometry(1.3, 14, 8, 0, TWO_PI, 0, Math.PI / 2), pew);
            p.scale.set(1.2, 0.5, 0.7);
            ctx.place(p, x, z, 0);
            scene.add(p);
        }
    }
    // Strings of fairy lights over the aisle
    const beadM = ctx.glowMat(0xfff3b0, 0.6, 2.0);
    const beadG = new THREE.SphereGeometry(0.14, 6, 5);
    const beads = new THREE.InstancedMesh(beadG, beadM, 80);
    const m4 = new THREE.Matrix4();
    let bi = 0;
    for (const x of [-6.5, 6.5]) {
        for (let z = -34; z > -54 && bi < 80; z -= 2.6) {
            beads.setMatrixAt(bi++, m4.makeTranslation(x, floorHeight(x, z) + 5.2 + Math.sin(z * 0.9) * 0.5, z));
        }
    }
    for (let i = 0; i < 20 && bi < 80; i++) {
        const x = -6.5 + (i / 19) * 13;
        beads.setMatrixAt(bi++, m4.makeTranslation(x, floorHeight(x, -44) + 5.2 + Math.sin((i / 19) * Math.PI) * -0.9, -44));
    }
    beads.count = bi;
    scene.add(beads);
    // Pearl lamps on the posts
    for (const x of [-6.5, 6.5]) for (const z of [-34, -54]) {
        const pole = mesh(new THREE.CylinderGeometry(0.1, 0.12, 5.4, 6), mat(0xe8d5c0, { r: 0.5 }), 0, 2.7, 0);
        ctx.place(pole, x, z);
        scene.add(pole);
    }
    // Coralie's perch
    ctx.refs.coraliePos = new THREE.Vector3(4, floorHeight(4, -30) + 3.4, -30);
}

// ================================================================================================
// The mall
// ================================================================================================
export function buildMall(ctx, spawnKeeper) {
    const { scene, env } = ctx;
    const [mx, mz] = A('mall');
    const y0 = floorHeight(mx, mz);
    const g = new THREE.Group();
    const wall = new THREE.MeshStandardMaterial({ color: 0xc7ecee, roughness: 0.4, metalness: 0.15 });
    g.add(mesh(new THREE.BoxGeometry(16, 13, 66), wall, 0, 6.5, 0));
    // glass band and neon trim
    g.add(mesh(new THREE.BoxGeometry(16.2, 2.4, 66.2), new THREE.MeshStandardMaterial({ color: 0x7fd6ff, transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0.5 }), 0, 9.6, 0));
    const trim = ctx.glowMat(0xff9ff3, 0.8, 1.4);
    g.add(mesh(new THREE.BoxGeometry(17, 0.5, 67), trim, 0, 13.2, 0));
    g.add(mesh(new THREE.BoxGeometry(17, 0.4, 67), ctx.glowMat(0x48dbfb, 0.7, 1.4), 0, 8.0, 0));
    const roofSign = mesh(new THREE.PlaneGeometry(28, 5.5), new THREE.MeshBasicMaterial({ map: neonTexture('Mermaid Mall', '#ff9ff3', '#1d1240', 768, 160), transparent: false }), -8.3, 16.5, 0);
    roofSign.rotation.y = -Math.PI / 2;
    g.add(roofSign);
    g.add(mesh(new THREE.BoxGeometry(0.4, 6, 29), mat(0x1d1240, { r: 0.6 }), -8.0, 16.5, 0));
    g.position.set(mx, y0, mz);
    scene.add(g);
    ctx.collider(mx, mz, 5, -1e9, 1e9);
    // Storefronts along the -x face
    const R = ctx.refs;
    R.storefronts = [];
    const xs = mx - 8.1;
    const zStart = mz - 26;
    SHOPS.forEach((shop, i) => {
        const z = zStart + i * 10.5;
        const y = floorHeight(xs, z);
        const sg = new THREE.Group();
        const sc = shop.sign;
        const floorM = mat(shade(sc, 0.6), { r: 0.5 });
        const wallM = mat(shade(sc, 0.35), { r: 0.6 });
        // alcove: floor, side walls, ceiling
        sg.add(mesh(new THREE.BoxGeometry(6.5, 0.3, 8.6), floorM, -3.25, 0.15, 0));
        sg.add(mesh(new THREE.BoxGeometry(6.5, 5.6, 0.3), wallM, -3.25, 2.8, -4.2));
        sg.add(mesh(new THREE.BoxGeometry(6.5, 5.6, 0.3), wallM, -3.25, 2.8, 4.2));
        sg.add(mesh(new THREE.BoxGeometry(6.5, 0.3, 8.6), wallM, -3.25, 5.65, 0));
        // lit back wall
        const back = mesh(new THREE.PlaneGeometry(8.2, 5.2), ctx.glowMat(shade(sc, 0.5), 0.35, 0.8, { side: THREE.DoubleSide }), -0.05, 2.9, 0);
        back.rotation.y = -Math.PI / 2;
        sg.add(back);
        // counter, shelves, goods
        sg.add(mesh(new THREE.BoxGeometry(1.2, 1.3, 5.6), mat(0x8d6e63, { r: 0.6 }), -3.2, 0.9, 0));
        sg.add(mesh(new THREE.BoxGeometry(0.6, 0.12, 6.4), mat(0xffffff, { r: 0.4 }), -0.5, 3.0, 0));
        sg.add(mesh(new THREE.BoxGeometry(0.6, 0.12, 6.4), mat(0xffffff, { r: 0.4 }), -0.5, 4.2, 0));
        const rnd = mulberry32(i * 31 + 5);
        for (let n = 0; n < 12; n++) {
            const gc = pick(shop.items).food ?? pick([0xff9ff3, 0x74b9ff, 0xffd166, 0x55efc4, 0xff7675]);
            sg.add(mesh(new THREE.SphereGeometry(0.2 + rnd() * 0.12, 8, 6), mat(gc, { r: 0.4, e: 0.15 }), -0.6, 3.25 + (n % 2) * 1.2, -3 + (n * 0.5) % 6));
        }
        // awning
        const awG = new THREE.PlaneGeometry(7.4, 4.0, 6, 3);
        awG.rotateX(-Math.PI / 2);       // lie flat: width along x, depth along z
        awG.rotateY(Math.PI / 2);        // width along z, depth along x (out to -x)
        awG.rotateZ(0.32);               // outer edge lower
        const aw = new THREE.Mesh(awG, new THREE.MeshStandardMaterial({ map: stripeTexture('#' + sc.toString(16).padStart(6, '0'), '#ffffff', 10), side: THREE.DoubleSide, roughness: 0.7 }));
        aw.position.set(-3.4, 5.5, 0);
        sg.add(aw);
        const sign = mesh(new THREE.PlaneGeometry(7.4, 1.8), new THREE.MeshBasicMaterial({ map: neonTexture(shop.name, '#' + sc.toString(16).padStart(6, '0'), '#161230', 512, 128) }), -6.9, 7.4, 0);
        sign.rotation.y = -Math.PI / 2;
        sg.add(sign);
        sg.position.set(xs - 0.1, y, z);   // the alcove reaches out towards -x, open to the town
        scene.add(sg);
        // keeper stands behind the counter
        const keeperPos = new THREE.Vector3(xs - 0.1 - 1.5, y + 2.7, z);
        const front = new THREE.Vector3(xs - 7.2, y + 3, z);
        R.storefronts.push({ shop, pos: front, keeperPos, z });
        if (spawnKeeper) spawnKeeper(shop, keeperPos, -Math.PI / 2);
    });
    // Food court: mushroom tables with shell stools and umbrellas
    R.tables = [];
    const [fx, fz] = [mx - 26, mz + 22];
    const court = [[0, 0], [-8, -6], [-8, 6], [0, 12], [8, -6], [8, 6]];
    for (const [dx, dz] of court) {
        const x = fx + dx, z = fz + dz;
        const y = floorHeight(x, z);
        const tg = new THREE.Group();
        tg.add(mesh(new THREE.CylinderGeometry(0.35, 0.5, 2.2, 10), mat(0xf8efba, { r: 0.6 }), 0, 1.1, 0));
        tg.add(mesh(new THREE.CylinderGeometry(2, 2, 0.25, 22), mat(0xff7979, { r: 0.5 }), 0, 2.3, 0));
        const um = new THREE.Mesh(new THREE.ConeGeometry(3.2, 1.2, 12, 1, true), new THREE.MeshStandardMaterial({ map: stripeTexture('#ffeaa7', '#ff7675', 12), side: THREE.DoubleSide, roughness: 0.7 }));
        um.position.y = 6.2;
        tg.add(um);
        tg.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 6), mat(0xffffff, { m: 0.5 }), 0, 4.2, 0));
        for (let s = 0; s < 4; s++) {
            const a = (s / 4) * TWO_PI;
            tg.add(mesh(new THREE.SphereGeometry(0.55, 10, 6, 0, TWO_PI, 0, Math.PI / 2), mat(0xffc0cb, { r: 0.4 }), Math.sin(a) * 3, 0.1, Math.cos(a) * 3));
        }
        tg.position.set(x, y, z);
        scene.add(tg);
        ctx.collider(x, z, 0.8);
        R.tables.push(new THREE.Vector3(x, y + 2.45, z));
    }
    // Neon arrow and the way to the arcade
    ctx.refs.mallPos = new THREE.Vector3(mx, y0, mz);
}

// ================================================================================================
// The Clam Arcade
// ================================================================================================
export function buildArcade(ctx) {
    const { scene } = ctx;
    const [ax, az] = A('arcade');
    const y0 = floorHeight(ax, az);
    const g = new THREE.Group();
    const shell = new THREE.MeshPhysicalMaterial({ color: 0x4a2e8a, roughness: 0.3, metalness: 0.3, clearcoat: 0.8, iridescence: 0.6, side: THREE.DoubleSide });
    // dome with an entrance towards -x
    const geo = new THREE.SphereGeometry(11, 36, 16, 0, TWO_PI, 0, Math.PI / 2);
    const dome = new THREE.Mesh(geo, shell);
    dome.scale.y = 0.8;
    g.add(dome);
    g.add(mesh(new THREE.CylinderGeometry(11, 11, 0.5, 36), mat(0x241548, { r: 0.4 }), 0, 0.25, 0));
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TWO_PI;
        const l = mesh(new THREE.SphereGeometry(0.35, 8, 6), ctx.glowMat([0xff9ff3, 0x48dbfb, 0xfeca57, 0x55efc4][i % 4], 0.7, 1.4), Math.sin(a) * 11.2, 0.7 + (i % 2) * 7.5, Math.cos(a) * 11.2);
        g.add(l);
    }
    const sign = mesh(new THREE.PlaneGeometry(10, 2.4), new THREE.MeshBasicMaterial({ map: neonTexture('Clam Arcade', '#48dbfb', '#150d33', 512, 128) }), 0, 10.5, 0);
    sign.rotation.y = -Math.PI / 2;
    sign.position.set(-8.2, 9.0, 0);
    g.add(sign);
    // cabinets inside
    const cabinets = [];
    const colors = [0xff7675, 0x48dbfb, 0xfeca57, 0x55efc4, 0xa29bfe];
    for (let i = 0; i < 5; i++) {
        const a = Math.PI * 0.18 + (i / 4) * Math.PI * 0.64 + Math.PI * 0.5;
        const x = Math.sin(a) * 7, z = Math.cos(a) * 7;
        const cab = new THREE.Group();
        cab.add(mesh(new THREE.BoxGeometry(1.8, 3.6, 1.4), mat(0x2b2b4a, { r: 0.5 }), 0, 1.8, 0));
        const screen = mesh(new THREE.PlaneGeometry(1.4, 1.2), ctx.glowMat(colors[i], 0.8, 0.8), 0, 2.6, 0.72);
        cab.add(screen);
        cab.add(mesh(new THREE.BoxGeometry(1.6, 0.2, 0.8), mat(0x161630, { r: 0.4 }), 0, 1.6, 0.8));
        for (let b = 0; b < 3; b++) cab.add(mesh(new THREE.SphereGeometry(0.1, 8, 6), ctx.glowMat(colors[(i + b) % 5], 0.8, 0.5), -0.4 + b * 0.4, 1.72, 0.9));
        cab.position.set(x, 0.5, z);
        cab.rotation.y = Math.atan2(-x, -z);
        g.add(cab);
        cabinets.push(cab);
    }
    // ticket counter
    const counter = new THREE.Group();
    counter.add(mesh(new THREE.BoxGeometry(3.4, 1.4, 1.2), mat(0xfdcb6e, { r: 0.5 }), 0, 0.7, 0));
    counter.add(mesh(new THREE.TorusGeometry(0.5, 0.12, 6, 12), ctx.glowMat(0xffeaa7, 0.8, 0.6), 0, 2.0, 0));
    counter.position.set(5, 0.5, 5);
    counter.rotation.y = Math.PI * 1.25;
    g.add(counter);
    g.position.set(ax, y0, az);
    g.rotation.y = 0;
    scene.add(g);
    // collider ring of the dome walls except the doorway is skipped: the arcade is walk-through
    ctx.refs.arcade = {
        root: g,
        door: new THREE.Vector3(ax - 13, y0 + 3.2, az),
        counter: new THREE.Vector3(ax + 5 * 1, y0 + 3.0, az + 5),
        cabinets: cabinets.map((c, i) => new THREE.Vector3(ax + c.position.x, y0 + 3, az + c.position.z)),
        cabinetsObj: cabinets
    };
    ctx.anim.push((t) => { cabinets.forEach((c, i) => { c.children[2].scale.y = 1 + Math.sin(t * 6 + i) * 0.05; }); });
}

// ================================================================================================
// The Sea Garden and the Pet Nook
// ================================================================================================
export function buildGarden(ctx) {
    const { scene } = ctx;
    const [gx, gz] = A('garden');
    const y0 = floorHeight(gx, gz);
    const g = new THREE.Group();
    // a low shell fence and a mossy path
    for (let i = 0; i < 26; i++) {
        const a = (i / 26) * TWO_PI;
        if (Math.cos(a) > 0.82) continue; // the gate faces +x (towards the plaza)
        const x = Math.sin(a) * 15, z = Math.cos(a) * 15;
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 6, 0, TWO_PI, 0, Math.PI / 2), mat(0xfde2e4, { r: 0.4 }));
        p.scale.set(1, 1.3, 0.5);
        p.position.set(x, floorHeight(gx + x, gz + z) - y0, z);
        p.rotation.y = a;
        g.add(p);
    }
    g.position.set(gx, y0, gz);
    scene.add(g);
    // The sign and the plots' stone rims
    const sign = mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshBasicMaterial({ map: signTexture('Sea Garden', '#55efc4'), transparent: true }), 0, 3.6, 0);
    const post = mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.4, 6), mat(0x8d6e63), 0, 1.7, 0);
    const sg = new THREE.Group();
    sg.add(sign, post);
    sg.position.set(gx + 14, floorHeight(gx + 14, gz), gz);
    sg.rotation.y = Math.PI / 2 + 0.2;
    scene.add(sg);
    ctx.refs.garden = { center: new THREE.Vector3(gx, y0, gz) };
}

/** A plant at a garden plot; k 0..1 is how grown it is. */
export function buildPlant(id, color, k = 1) {
    const g = new THREE.Group();
    const c = color;
    const m = (col, o) => mat(col, Object.assign({ r: 0.5 }, o));
    if (id === 'anemone') {
        for (let i = 0; i < 16; i++) {
            const a = (i / 16) * TWO_PI;
            const t = mesh(new THREE.ConeGeometry(0.06, 0.8, 5), m(i % 2 ? c : shade(c, 0.3), { e: 0.2 }), Math.sin(a) * 0.3, 0.45, Math.cos(a) * 0.3);
            t.rotation.set(Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5);
            t.userData.sway = a;
            g.add(t);
        }
        g.add(mesh(new THREE.CylinderGeometry(0.28, 0.36, 0.3, 10), m(0xb0707e), 0, 0.15, 0));
    } else if (id === 'seaflower') {
        g.add(mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.4, 6), m(0x2ecc71), 0, 0.7, 0));
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * TWO_PI;
            const p = mesh(new THREE.SphereGeometry(0.28, 8, 6), m(c, { e: 0.6 }), Math.sin(a) * 0.28, 1.45, Math.cos(a) * 0.28);
            p.scale.set(0.8, 0.5, 1.2);
            p.rotation.y = a;
            g.add(p);
        }
        g.add(mesh(new THREE.SphereGeometry(0.2, 8, 6), m(0xffffff, { e: 0.9 }), 0, 1.5, 0));
    } else if (id === 'lavender') {
        for (let i = 0; i < 7; i++) {
            const a = (i / 7) * TWO_PI;
            const s = joint(g, Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2);
            s.rotation.set(Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3);
            s.add(mesh(new THREE.CylinderGeometry(0.02, 0.03, 1.2, 5), m(0x58a64a), 0, 0.6, 0));
            for (let k2 = 0; k2 < 6; k2++) s.add(mesh(new THREE.SphereGeometry(0.07, 6, 5), m(c, { e: 0.2 }), 0, 0.8 + k2 * 0.1, 0));
        }
    } else if (id === 'fan') {
        const fan = new THREE.Mesh(new THREE.CircleGeometry(0.9, 20, 0, Math.PI), new THREE.MeshStandardMaterial({ color: c, side: THREE.DoubleSide, roughness: 0.6, emissive: c, emissiveIntensity: 0.15 }));
        fan.position.y = 0.05;
        g.add(fan);
        const fan2 = fan.clone();
        fan2.rotation.y = Math.PI / 2;
        g.add(fan2);
    } else if (id === 'sponge') {
        for (let i = 0; i < 4; i++) {
            const h = 0.9 + i * 0.25;
            const t = mesh(new THREE.CylinderGeometry(0.2, 0.17, h, 10, 1, true), new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, side: THREE.DoubleSide }), Math.sin(i * 1.6) * 0.3, h / 2, Math.cos(i * 1.6) * 0.3);
            g.add(t);
        }
    } else {
        // light bulb coral: glowing orbs on stems
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * TWO_PI;
            const h = 0.7 + (i % 3) * 0.3;
            g.add(mesh(new THREE.CylinderGeometry(0.03, 0.05, h, 5), m(0x6c5ce7), Math.sin(a) * 0.25, h / 2, Math.cos(a) * 0.25));
            g.add(mesh(new THREE.SphereGeometry(0.16, 8, 6), m(c, { e: 1.4 }), Math.sin(a) * 0.25, h + 0.1, Math.cos(a) * 0.25));
        }
    }
    g.scale.setScalar(0.25 + k * 0.9);
    return g;
}

export function buildPetNook(ctx) {
    const { scene } = ctx;
    const [px, pz] = A('petnook');
    const y0 = floorHeight(px, pz);
    const g = new THREE.Group();
    const hut = new THREE.Mesh(new THREE.SphereGeometry(6.5, 24, 12, 0, TWO_PI, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xa8e6cf, roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide }));
    hut.scale.y = 0.75;
    g.add(hut);
    g.add(mesh(new THREE.CylinderGeometry(6.5, 6.5, 0.3, 24), mat(0xe8f8f0, { r: 0.5 }), 0, 0.15, 0));
    const sign = mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshBasicMaterial({ map: neonTexture('Pet Nook', '#55efc4', '#12302a', 512, 128) }), 0, 6.4, 6.2);
    g.add(sign);
    // glass tanks with little fish
    const tankM = new THREE.MeshStandardMaterial({ color: 0xbfefff, transparent: true, opacity: 0.25, roughness: 0.05 });
    const tanks = [];
    for (let i = 0; i < 3; i++) {
        const a = -0.8 + i * 0.8;
        const x = Math.sin(a) * 4.0, z = -Math.cos(a) * 4.0;
        const t = new THREE.Group();
        t.add(mesh(new THREE.BoxGeometry(1.8, 1.3, 1.2), tankM, 0, 1.1, 0));
        t.add(mesh(new THREE.BoxGeometry(2, 0.3, 1.4), mat(0x8d6e63), 0, 0.3, 0));
        const f = buildFish([0xff7f27, 0x48dbfb, 0xf1c40f][i], 0xffffff, 0.35, false, 'reef');
        f.position.y = 1.1;
        t.add(f);
        t.position.set(x, 0, z);
        t.rotation.y = Math.atan2(x, -z) + Math.PI;
        g.add(t);
        tanks.push(f);
    }
    g.position.set(px, y0, pz);
    g.rotation.y = Math.PI / 2;
    scene.add(g);
    ctx.collider(px, pz, 6.5);
    ctx.refs.petnook = { pos: new THREE.Vector3(px - 8, y0 + 3.2, pz) };
    ctx.anim.push((t) => tanks.forEach((f, i) => { f.userData.update(t + i, 0.3); f.rotation.y = Math.sin(t * 0.7 + i) * 0.5; f.position.x = Math.sin(t * 0.5 + i) * 0.4; }));
}

export function buildProfessor() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 14), mat(0x6c5ce7, { r: 0.5 }));
    g.add(body);
    for (let i = 0; i < 80; i++) {
        const a = i * 2.4, e = Math.acos(1 - ((i + 0.5) / 80) * 2);
        const d = new THREE.Vector3(Math.sin(e) * Math.cos(a), Math.cos(e), Math.sin(e) * Math.sin(a));
        if (d.z > 0.55 && Math.abs(d.y) < 0.5) continue;
        const s = mesh(new THREE.ConeGeometry(0.035, 0.5, 5), mat(0x8e7cff, { r: 0.4 }), 0, 0, 0);
        s.position.copy(d).multiplyScalar(0.8);
        s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
        g.add(s);
    }
    for (const s of [-1, 1]) {
        g.add(mesh(new THREE.SphereGeometry(0.17, 10, 8), mat(0xffffff, { r: 0.2 }), s * 0.26, 0.15, 0.6));
        g.add(mesh(new THREE.SphereGeometry(0.08, 8, 6), mat(0x101018), s * 0.27, 0.15, 0.74));
        const gl = mesh(new THREE.TorusGeometry(0.22, 0.03, 6, 14), mat(0xf1c40f, { m: 0.8 }), s * 0.26, 0.15, 0.7);
        g.add(gl);
    }
    g.add(mesh(new THREE.BoxGeometry(0.2, 0.03, 0.03), mat(0xf1c40f, { m: 0.8 }), 0, 0.17, 0.74));
    const hat = mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.15, 12), mat(0x2d3436), 0, 0.85, 0);
    g.add(hat);
    g.add(mesh(new THREE.BoxGeometry(0.7, 0.04, 0.7), mat(0x2d3436), 0, 1.0, 0));
    g.userData.update = (t) => { g.rotation.y = Math.sin(t * 0.8) * 0.3; };
    return g;
}
