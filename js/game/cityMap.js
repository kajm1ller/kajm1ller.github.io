/**
 * js/game/cityMap.js
 *
 * The town map with street names. Drawing only: CityMap turns the baked street data
 * (data/streetMap.json, tools/buildStreetMap.mjs) into canvas strokes for any centre, zoom and
 * rotation, so the same code draws the full-screen map (N, north up, drag and wheel) and the
 * minimap (heading up). Coordinates are world metres; north is -z.
 *
 *   map.draw(ctx, w, h, view, opts)
 *     view  { x, z, scale (px per metre), rot (radians, 0 = north up; the heading for a rotating map) }
 *     opts  { labels, pois, player: {x, z, yaw}, theme }
 */

const ROAD_WIDTH = [16, 14, 12, 10, 9, 8, 7, 6, 4];                   // metres, by class
const MIN_SCALE = [0, 0, 0, 0.004, 0.018, 0.04, 0.06, 0.1, 0.16];     // px per metre where a class appears
const LABEL_SCALE = [0.012, 0.012, 0.012, 0.02, 0.05, 0.08, 0.11, 0.2, 9];

const THEMES = {
    map: {
        bg: '#e9e4d6', water: '#9fc3e6', park: '#c6dfb0', rail: '#8a8a8a',
        casing: '#b9b3a2', road: ['#f2a65a', '#f2b45a', '#f6c96e', '#fbe08a', '#ffffff', '#ffffff', '#ffffff', '#f7f7f7', '#efeee9'],
        text: '#2b2b2b', halo: 'rgba(255,255,255,0.9)'
    },
    mini: {
        bg: '#1e232b', water: '#2c4a6b', park: '#27402c', rail: '#555a63',
        casing: '#0e1116', road: ['#c98a45', '#c98a45', '#bfa060', '#b7b79a', '#9aa0aa', '#8f96a1', '#838a95', '#767d88', '#5d636d'],
        text: '#f2f2f2', halo: 'rgba(14,17,22,0.85)'
    }
};

export class CityMap {
    /** @param {Object} data parsed streetMap.json */
    constructor(data) {
        this.data = data;
        this.bounds = data.bounds;       // [minX, minZ, maxX, maxZ]
        // Cull helpers: centre and radius of every way
        this.roads = data.roads.map((r) => {
            const p = r.p;
            let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
            for (let i = 0; i < p.length; i += 2) {
                if (p[i] < x0) x0 = p[i];
                if (p[i] > x1) x1 = p[i];
                if (p[i + 1] < z0) z0 = p[i + 1];
                if (p[i + 1] > z1) z1 = p[i + 1];
            }
            return { c: r.c, p, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, r: Math.hypot(x1 - x0, z1 - z0) / 2 + 20 };
        });
        // Drawn back to front: small streets first
        this.order = [...this.roads.keys()].sort((a, b) => this.roads[b].c - this.roads[a].c);
        this.waterAreas = data.water.map((p) => ({ p, ...bbox(p) }));
        this.parkAreas = data.parks.map((p) => ({ p, ...bbox(p) }));
        this._boxes = [];
    }

    /** Street names, or '' when there's none within `radius` of the point. */
    streetNear(x, z, radius = 25) {
        let best = '', bd = radius;
        for (const r of this.data.roads) {
            if (!r.n) continue;
            const p = r.p;
            for (let i = 2; i < p.length; i += 2) {
                const ax = p[i - 2], az = p[i - 1], dx = p[i] - ax, dz = p[i + 1] - az;
                const l2 = dx * dx + dz * dz || 1;
                const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
                const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
                if (d < bd) { bd = d; best = r.n; }
            }
        }
        return best;
    }

    draw(ctx, w, h, view, opts = {}) {
        const T = THEMES[opts.theme || 'map'];
        const s = view.scale;
        const cosR = Math.cos(view.rot || 0), sinR = Math.sin(view.rot || 0);
        // screen = centre + M * (world - view)
        const m00 = cosR, m01 = sinR, m10 = -sinR, m11 = cosR;
        const X = (x, z) => w / 2 + ((x - view.x) * m00 + (z - view.z) * m01) * s;
        const Y = (x, z) => h / 2 + ((x - view.x) * m10 + (z - view.z) * m11) * s;
        const reach = Math.hypot(w, h) / 2 / s;      // world metres from the centre to the corner

        ctx.save();
        ctx.fillStyle = T.bg;
        ctx.fillRect(0, 0, w, h);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        const inView = (b) => Math.hypot(b.cx - view.x, b.cz - view.z) < reach + b.r;
        const fillAreas = (list, color) => {
            ctx.fillStyle = color;
            for (const a of list) {
                if (!inView(a)) continue;
                if (a.r * 2 * s < 2) continue;
                ctx.beginPath();
                for (let i = 0; i < a.p.length; i += 2) {
                    const px = X(a.p[i], a.p[i + 1]), py = Y(a.p[i], a.p[i + 1]);
                    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.fill();
            }
        };
        fillAreas(this.parkAreas, T.park);
        fillAreas(this.waterAreas, T.water);
        ctx.strokeStyle = T.water;
        ctx.lineWidth = Math.max(1.5, 5 * s);
        for (const p of this.data.rivers) strokeLine(ctx, p, X, Y);
        ctx.strokeStyle = T.rail;
        ctx.lineWidth = Math.max(1, 3 * s);
        ctx.setLineDash([6, 4]);
        for (const p of this.data.rails) strokeLine(ctx, p, X, Y);
        ctx.setLineDash([]);

        // Roads: a darker casing under every class, then the fill, so junctions read cleanly
        const visible = [];
        for (const i of this.order) {
            const r = this.roads[i];
            if (s < MIN_SCALE[r.c] || !inView(r)) continue;
            visible.push(r);
        }
        for (const pass of [0, 1]) {
            for (const r of visible) {
                const wpx = Math.max(r.c > 5 ? 1 : 1.5, ROAD_WIDTH[r.c] * s);
                ctx.strokeStyle = pass === 0 ? T.casing : T.road[r.c];
                ctx.lineWidth = pass === 0 ? wpx + (s > 0.15 ? 2 : 1) : wpx;
                strokeLine(ctx, r.p, X, Y);
            }
        }

        // Street names along the streets
        if (opts.labels !== false) {
            const placed = this._boxes;
            placed.length = 0;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = 3;
            ctx.lineJoin = 'round';
            const px = Math.round(Math.max(9, Math.min(14, 8 + s * 14)));
            ctx.font = `600 ${px}px system-ui, sans-serif`;
            for (const L of this.data.labels) {
                if (s < LABEL_SCALE[L.c]) continue;
                if (Math.abs(L.x - view.x) > reach || Math.abs(L.z - view.z) > reach) continue;
                const sx = X(L.x, L.z), sy = Y(L.x, L.z);
                if (sx < 0 || sy < 0 || sx > w || sy > h) continue;
                const half = (L.n.length * px * 0.3) + 4;
                if (placed.some((b) => Math.abs(b[0] - sx) < half + b[2] && Math.abs(b[1] - sy) < Math.max(px, half * 0.6) + b[3])) continue;
                placed.push([sx, sy, half, px * 0.8]);
                // Rotate the label with the map, keep the text upright
                const a = rotatedAngle(L.a, m00, m01, m10, m11);
                ctx.save();
                ctx.translate(sx, sy);
                ctx.rotate(a);
                ctx.strokeStyle = T.halo;
                ctx.strokeText(L.n, 0, 0);
                ctx.fillStyle = T.text;
                ctx.fillText(L.n, 0, 0);
                ctx.restore();
            }
        }

        // Places of interest
        if (opts.pois) {
            ctx.textAlign = 'left';
            ctx.font = '600 12px system-ui, sans-serif';
            for (const p of opts.pois) {
                const sx = X(p.x, p.z), sy = Y(p.x, p.z);
                if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue;
                const r = p.r || 6;
                ctx.fillStyle = p.color || '#d94a4a';
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(sx, sy, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                if (p.label && opts.poiLabels !== false && s > 0.03) {
                    ctx.strokeStyle = T.halo;
                    ctx.lineWidth = 3;
                    ctx.strokeText(p.label, sx + r + 4, sy);
                    ctx.fillStyle = T.text;
                    ctx.fillText(p.label, sx + r + 4, sy);
                }
            }
        }

        // The player: an arrow pointing the way they face
        if (opts.player) {
            const sx = X(opts.player.x, opts.player.z), sy = Y(opts.player.x, opts.player.z);
            const fx = Math.sin(opts.player.yaw), fz = Math.cos(opts.player.yaw);
            const ang = Math.atan2(fx * m10 + fz * m11, fx * m00 + fz * m01);
            ctx.save();
            ctx.translate(sx, sy);
            ctx.rotate(ang + Math.PI / 2);
            ctx.fillStyle = '#2f7cf6';
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, -11);
            ctx.lineTo(8, 9);
            ctx.lineTo(0, 4);
            ctx.lineTo(-8, 9);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }
        ctx.restore();
    }
}

/** Angle of a road label after the map's rotation, flipped so the text never reads upside down. */
function rotatedAngle(a, m00, m01, m10, m11) {
    const dx = Math.cos(a), dz = Math.sin(a);
    let r = Math.atan2(dx * m10 + dz * m11, dx * m00 + dz * m01);
    if (r > Math.PI / 2) r -= Math.PI;
    if (r < -Math.PI / 2) r += Math.PI;
    return r;
}

function bbox(p) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
        if (p[i] < x0) x0 = p[i];
        if (p[i] > x1) x1 = p[i];
        if (p[i + 1] < z0) z0 = p[i + 1];
        if (p[i + 1] > z1) z1 = p[i + 1];
    }
    return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, r: Math.hypot(x1 - x0, z1 - z0) / 2 + 5 };
}

function strokeLine(ctx, p, X, Y) {
    ctx.beginPath();
    ctx.moveTo(X(p[0], p[1]), Y(p[0], p[1]));
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(X(p[i], p[i + 1]), Y(p[i], p[i + 1]));
    ctx.stroke();
}
