/**
 * Applies map-editor operations to the text of one OSM2World OBJ part (used by server.js, unit tested).
 *
 * A block is an 'o' object, numbered by its position among the file's 'o' lines (the loader's
 * editBlocks use the same numbers). Vertices can be shared between blocks, so nothing is ever moved
 * in place: a block is deleted by dropping its faces, and a scaled / moved / copied block is
 * appended to the end of the file as a new object on fresh vertices.
 *
 *   { ord, type: 'delete' }
 *   { ord, type: 'put', s, r, d: [dx, dy, dz] }   scale by s and turn by r radians (about +Y, like three.js) about the
 *                                                 block's base centre, then move by d
 */
export function applyMapEdits(text, ops) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const trailing = lines.length > 0 && lines[lines.length - 1] === '';
    if (trailing) lines.pop();

    const verts = [];
    const norms = [];
    const blocks = [];
    let mat = '';
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (l.startsWith('v ')) {
            const p = l.trim().split(/\s+/);
            verts.push([+p[1], +p[2], +p[3]]);
        } else if (l.startsWith('vn ')) {
            const p = l.trim().split(/\s+/);
            norms.push([+p[1], +p[2], +p[3]]);
        } else if (l.startsWith('usemtl ')) {
            mat = l;
            if (cur) cur.body.push({ mat: l });
        } else if (l.startsWith('o ') || l.startsWith('g ')) {
            cur = null;
            if (l[0] === 'o') {
                cur = { name: l.slice(2).trim(), mat, faces: [], body: [] };
                blocks.push(cur);
            }
        } else if (l.startsWith('f ') && cur) {
            const toks = l.trim().split(/\s+/).slice(1).map((t) => {
                const parts = t.split('/');
                let v = parseInt(parts[0], 10);
                if (v < 0) v = verts.length + v + 1;
                return { v, vt: parts[1], vn: parts[2], n: parts.length };
            });
            cur.faces.push(i);
            cur.body.push({ toks });
        }
    }

    const drop = new Set();
    const puts = [];
    for (const op of ops) {
        const b = blocks[op.ord];
        if (!b) throw new Error(`no object ${op.ord}`);
        if (op.type === 'delete') {
            for (const li of b.faces) drop.add(li);
        } else if (op.type === 'put') {
            puts.push({ b, s: op.s, r: op.r || 0, d: op.d });
        } else throw new Error(`bad op ${op.type}`);
    }

    const out = lines.filter((_, i) => !drop.has(i));
    let count = verts.length;
    const fmt = (n) => String(Math.round(n * 10000) / 10000);
    let ncount = norms.length;
    for (const { b, s, r, d } of puts) {
        const cr = Math.cos(r), sr = Math.sin(r);
        const used = new Set();
        for (const e of b.body) if (e.toks) for (const t of e.toks) used.add(t.v);
        if (!used.size) continue;
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity;
        for (const v of used) {
            const p = verts[v - 1];
            if (!p) throw new Error(`vertex ${v} missing`);
            minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
            minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
            minY = Math.min(minY, p[1]);
        }
        const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
        const map = new Map();
        out.push('g Edited'); // keeps these vertices out of the previous object's bounds
        for (const v of used) {
            const p = verts[v - 1];
            const ax = (p[0] - cx) * s, az = (p[2] - cz) * s;
            out.push(`v ${fmt(cx + ax * cr + az * sr + d[0])} ${fmt(minY + (p[1] - minY) * s + d[1])} ${fmt(cz - ax * sr + az * cr + d[2])}`);
            map.set(v, ++count);
        }
        // Turned objects need turned normals; the old ones stay where they are for the original
        const nmap = new Map();
        if (r) {
            for (const e of b.body) if (e.toks) for (const t of e.toks) if (t.vn && !nmap.has(t.vn)) {
                const n = norms[+t.vn - 1];
                if (!n) continue;
                out.push(`vn ${fmt(n[0] * cr + n[2] * sr)} ${fmt(n[1])} ${fmt(-n[0] * sr + n[2] * cr)}`);
                nmap.set(t.vn, ++ncount);
            }
        }
        out.push(`o ${b.name}`);
        if (b.mat) out.push(b.mat);
        for (const e of b.body) {
            if (e.mat) out.push(e.mat);
            else out.push('f ' + e.toks.map((t) => [map.get(t.v), t.vt, nmap.get(t.vn) ?? t.vn].slice(0, t.n).join('/')).join(' '));
        }
    }
    return out.join(eol) + (trailing ? eol : '');
}

/**
 * Moves, turns, copies and deletes entities kept in the game's data files. `ops` are
 * { index, dx, dz, dyaw, deleted } (existing entity) or { add: true, src, dx, dz, dyaw } (a copy of entity src);
 * indices refer to the file as it is now, so deletions are applied last.
 *
 *   'gasStations'   the array in gasStations.json   (x, z in metres, yaw in radians)
 *   'streetSigns'   streetSigns.json                (x, z in decimetres, blade angles in milliradians)
 */
export function applyEntityEdits(kind, json, ops) {
    const r1 = (n) => Math.round(n * 10) / 10;
    const r3 = (n) => Math.round(n * 1000) / 1000;
    if (kind === 'gasStations') {
        const list = json.map((g) => ({ ...g }));
        const dead = new Set();
        const adds = [];
        for (const op of ops) {
            if (op.add) {
                const c = json[op.src];
                if (!c) throw new Error(`no gas station ${op.src}`);
                adds.push({ ...c, x: r1(c.x + op.dx), z: r1(c.z + op.dz), yaw: r3(c.yaw + op.dyaw) });
                continue;
            }
            const g = list[op.index];
            if (!g) throw new Error(`no gas station ${op.index}`);
            if (op.deleted) { dead.add(op.index); continue; }
            g.x = r1(g.x + op.dx); g.z = r1(g.z + op.dz); g.yaw = r3(g.yaw + op.dyaw);
        }
        return list.filter((_, i) => !dead.has(i)).concat(adds);
    }
    if (kind === 'streetSigns') {
        const recs = [];
        const s = json.signs;
        for (let i = 0; i < s.length;) {
            const n = s[i + 2];
            recs.push(s.slice(i, i + 3 + n * 2));
            i += 3 + n * 2;
        }
        const turn = (rec, dx, dz, dyaw) => {
            const c = rec.slice();
            c[0] += Math.round(dx * 10); c[1] += Math.round(dz * 10);
            for (let k = 0; k < c[2]; k++) c[4 + k * 2] += Math.round(dyaw * 1000);
            return c;
        };
        const dead = new Set();
        const adds = [];
        for (const op of ops) {
            if (op.add) {
                if (!recs[op.src]) throw new Error(`no sign ${op.src}`);
                adds.push(turn(recs[op.src], op.dx, op.dz, op.dyaw));
                continue;
            }
            if (!recs[op.index]) throw new Error(`no sign ${op.index}`);
            if (op.deleted) dead.add(op.index);
            else recs[op.index] = turn(recs[op.index], op.dx, op.dz, op.dyaw);
        }
        return { ...json, signs: recs.filter((_, i) => !dead.has(i)).concat(adds).flat() };
    }
    if (kind === 'roadSignEdits') {
        // keyed by the sign's original position, so repeated edits add up
        const out = { ...json };
        for (const op of ops) {
            const e = out[op.key] || { dx: 0, dz: 0, dyaw: 0 };
            out[op.key] = { dx: r3(e.dx + op.dx), dz: r3(e.dz + op.dz), dyaw: r3(e.dyaw + op.dyaw), ...(op.deleted || e.deleted ? { deleted: true } : {}) };
        }
        return out;
    }
    throw new Error(`unknown entity file ${kind}`);
}
