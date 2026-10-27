/**
 * js/game/streetSigns.js
 *
 * Street-name signs at junctions and along long streets, baked from OSM by
 * tools/buildStreetSigns.mjs (js/game/data/streetSigns.json): green US-style blades with white
 * lettering and border, one per street, each running parallel to the street it names and readable
 * from both sides, stacked on a galvanised post at the corner.
 *
 * All names are drawn into one texture atlas. Blades are merged into one mesh per ~300 m map cell
 * (so cells off screen are frustum culled) and posts are instanced: a handful of draw calls for
 * the whole city.
 */

import * as THREE from 'three';

const SLOT_W = 288, SLOT_H = 40;        // atlas slot per name (pixels)
const ATLAS_W = 2048;
const COLS = Math.floor(ATLAS_W / SLOT_W);
const CELL = 300;                       // blade mesh chunk size (metres)
const DRAW_DISTANCE = 250;              // chunks further than this aren't drawn (signs are tiny by then)
const POST_H = 2.4;                     // top of the post (the blades sit above it)
const BLADE_H = 0.2, BLADE_T = 0.022;
const BLADE_GAP = 0.235;                // vertical spacing between stacked blades
const SIGN_GREEN = '#0b6b3a';

/** Blade length for a name: longer names get longer blades, like the real thing. */
function bladeLength(name) {
    return Math.max(0.72, Math.min(1.45, 0.42 + name.length * 0.058));
}

function buildAtlas(names) {
    const rows = Math.ceil((names.length + 1) / COLS);
    const c = document.createElement('canvas');
    c.width = ATLAS_W;
    c.height = Math.max(SLOT_H, rows * SLOT_H);
    const g = c.getContext('2d');
    const slot = (i) => [(i % COLS) * SLOT_W, Math.floor(i / COLS) * SLOT_H];
    names.forEach((name, i) => {
        const [x, y] = slot(i);
        g.fillStyle = SIGN_GREEN;
        g.fillRect(x, y, SLOT_W, SLOT_H);
        g.strokeStyle = '#ffffff';
        g.lineWidth = 2;
        g.strokeRect(x + 3, y + 3, SLOT_W - 6, SLOT_H - 6);
        g.fillStyle = '#ffffff';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = 'bold 27px "Arial Narrow", Arial, sans-serif';
        const w = g.measureText(name).width;
        const maxW = SLOT_W - 18;
        g.save();
        g.translate(x + SLOT_W / 2, y + SLOT_H / 2 + 1);
        if (w > maxW) g.scale(maxW / w, 1);
        g.fillText(name, 0, 0);
        g.restore();
    });
    // Plain green patch for the blade edges
    const [gx, gy] = slot(names.length);
    g.fillStyle = SIGN_GREEN;
    g.fillRect(gx, gy, SLOT_W, SLOT_H);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    return {
        texture: tex,
        // UV rectangle of a slot (v flipped: canvas y grows down, texture v grows up)
        uv(i) {
            const [x, y] = slot(i);
            return [x / c.width, 1 - (y + SLOT_H) / c.height, (x + SLOT_W) / c.width, 1 - y / c.height];
        },
        edgeIndex: names.length
    };
}

export class StreetSigns {
    /**
     * @param {THREE.Scene} scene
     * @param {{names: string[], signs: number[]}} data streetSigns.json
     */
    constructor(scene, data) {
        this.scene = scene;
        this.names = data.names || [];
        this.group = new THREE.Group();
        this.group.name = 'street_signs';
        this.signs = [];
        const s = data.signs || [];
        for (let i = 0; i < s.length;) {
            const x = s[i++] / 10, z = s[i++] / 10, n = s[i++];
            const blades = [];
            for (let k = 0; k < n; k++) blades.push({ name: s[i++], angle: s[i++] / 1000 });
            this.signs.push({ x, z, blades });
        }
        this.counts = { signs: this.signs.length, names: this.names.length, blades: 0 };
        if (this.signs.length && typeof document !== 'undefined') this._build();
        scene.add(this.group);
    }

    _build() {
        const atlas = buildAtlas(this.names);
        this.material = new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.45, metalness: 0.15, envMapIntensity: 0.8 });
        const edgeUv = atlas.uv(atlas.edgeIndex);
        const eu = (edgeUv[0] + edgeUv[2]) / 2, ev = (edgeUv[1] + edgeUv[3]) / 2;

        // Blades, merged per map cell
        const cells = new Map();
        const cellOf = (x, z) => {
            const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
            if (!cells.has(key)) cells.set(key, { pos: [], nor: [], uv: [] });
            return cells.get(key);
        };
        const P = new THREE.Vector3(), N = new THREE.Vector3();
        for (const sign of this.signs) {
            const buf = cellOf(sign.x, sign.z);
            sign.blades.forEach((b, k) => {
                this.counts.blades++;
                const L = bladeLength(this.names[b.name] || '');
                const y = POST_H + 0.16 + k * BLADE_GAP;
                // Blade runs along the street: local +X maps to the street direction
                const yaw = b.angle - Math.PI / 2;
                const c = Math.cos(yaw), sn = Math.sin(yaw);
                const put = (lx, ly, lz, nx, ny, nz, u, v) => {
                    P.set(sign.x + lx * c + lz * sn, y + ly, sign.z - lx * sn + lz * c);
                    N.set(nx * c + nz * sn, ny, -nx * sn + nz * c);
                    buf.pos.push(P.x, P.y, P.z);
                    buf.nor.push(N.x, N.y, N.z);
                    buf.uv.push(u, v);
                };
                const quad = (a, bq, cq, d, n, uvs) => {
                    for (const [p, t] of [[a, uvs[0]], [bq, uvs[1]], [cq, uvs[2]], [a, uvs[0]], [cq, uvs[2]], [d, uvs[3]]]) {
                        put(p[0], p[1], p[2], n[0], n[1], n[2], t[0], t[1]);
                    }
                };
                const hx = L / 2, hy = BLADE_H / 2, hz = BLADE_T / 2;
                const [u0, v0, u1, v1] = atlas.uv(b.name);
                // Front (+Z) and back (-Z, mirrored so it reads left to right from behind)
                quad([-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [0, 0, 1], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
                quad([hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [0, 0, -1], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
                const E = [[eu, ev], [eu, ev], [eu, ev], [eu, ev]];
                quad([-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz], [0, 1, 0], E);
                quad([-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz], [0, -1, 0], E);
                quad([hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [1, 0, 0], E);
                quad([-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-1, 0, 0], E);
            });
            // Bracket: a square tube from the post cap up through the stack of blades
            const top = POST_H + 0.16 + (sign.blades.length - 1) * BLADE_GAP + BLADE_H / 2;
            const r = 0.022;
            const E = [[eu, ev], [eu, ev], [eu, ev], [eu, ev]];
            for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const tx = -nz, tz = nx; // tangent along the face
                const a = [sign.x + nx * r - tx * r, POST_H, sign.z + nz * r - tz * r];
                const b = [sign.x + nx * r + tx * r, POST_H, sign.z + nz * r + tz * r];
                for (const [p, t] of [[a, E[0]], [b, E[1]], [[b[0], top, b[2]], E[2]], [a, E[0]], [[b[0], top, b[2]], E[2]], [[a[0], top, a[2]], E[3]]]) {
                    buf.pos.push(p[0], p[1], p[2]);
                    buf.nor.push(nx, 0, nz);
                    buf.uv.push(t[0], t[1]);
                }
            }
        }
        this.chunks = [];
        for (const buf of cells.values()) {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
            g.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nor, 3));
            g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
            g.computeBoundingSphere();
            const mesh = new THREE.Mesh(g, this.material);
            mesh.name = 'street_sign_blades';
            mesh.castShadow = false;
            mesh.receiveShadow = true;
            this.group.add(mesh);
            this.chunks.push(mesh);
        }

        // Posts with a cap and a bracket under the blades
        const postGeo = new THREE.CylinderGeometry(0.032, 0.036, POST_H, 8);
        postGeo.translate(0, POST_H / 2, 0);
        const cap = new THREE.CylinderGeometry(0.045, 0.045, 0.05, 8);
        cap.translate(0, POST_H + 0.02, 0);
        const postMat = new THREE.MeshStandardMaterial({ color: 0x8d9399, roughness: 0.45, metalness: 0.8 });
        for (const [geo, name] of [[postGeo, 'street_sign_posts'], [cap, 'street_sign_caps']]) {
            const inst = new THREE.InstancedMesh(geo, postMat, this.signs.length);
            inst.name = name;
            const m = new THREE.Matrix4();
            this.signs.forEach((sg, i) => inst.setMatrixAt(i, m.makeTranslation(sg.x, 0, sg.z)));
            inst.instanceMatrix.needsUpdate = true;
            inst.computeBoundingSphere();
            inst.castShadow = false;
            inst.receiveShadow = true;
            this.group.add(inst);
        }
    }

    /** Shows only the chunks of blades near the camera. */
    update(cameraPos) {
        if (!this.chunks) return;
        const reach = (this.drawDistance || DRAW_DISTANCE) + CELL * 0.71; // drawDistance: the map editor shows every sign
        // (only once the camera has moved a few metres)
        if (this._at && this._reach === reach && (this._at.x - cameraPos.x) ** 2 + (this._at.z - cameraPos.z) ** 2 < 9) return;
        this._at = { x: cameraPos.x, z: cameraPos.z };
        this._reach = reach;
        for (const mesh of this.chunks) {
            const c = mesh.geometry.boundingSphere.center;
            mesh.visible = (c.x - cameraPos.x) ** 2 + (c.z - cameraPos.z) ** 2 < reach * reach;
        }
    }

    /** The street names on the sign nearest (x, z) within `range` metres, or null. */
    nearestSign(x, z, range = 30) {
        let best = null, bd = range * range;
        for (const s of this.signs) {
            const d = (s.x - x) ** 2 + (s.z - z) ** 2;
            if (d < bd) {
                bd = d;
                best = s;
            }
        }
        return best ? { x: best.x, z: best.z, names: best.blades.map((b) => this.names[b.name]) } : null;
    }
}

/** Loads streetSigns.json and adds the signs to the scene (an empty set if the file is missing). */
export async function loadStreetSigns(scene, url = './js/game/data/streetSigns.json') {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return new StreetSigns(scene, await res.json());
    } catch (err) {
        console.warn('[StreetSigns] no street sign data:', err.message);
        return new StreetSigns(scene, { names: [], signs: [] });
    }
}
