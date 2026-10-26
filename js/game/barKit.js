/**
 * js/game/barKit.js
 *
 * The building blocks for the downtown bars (bars.js): procedural canvas textures (brick, plank
 * floors, pressed tin, bottle shelves, neon, signs, TV pictures, posters, graffiti...), cached
 * materials that look lit from inside, and `Kit`, which collects boxes / planes / cylinders in a
 * bar's local frame and merges them into one mesh per material (a bar is a few dozen draw calls,
 * not a few thousand). Nothing here knows about any one bar.
 */

import * as THREE from 'three';

// ------------------------------------------------------------------------------------------------
// Textures
// ------------------------------------------------------------------------------------------------
const texCache = new Map();

/** A canvas texture, cached by key. `repeat` textures tile (UVs are in metres / tile size). */
export function canvasTex(key, w, h, draw, { repeat = true, transparent = false } = {}) {
    if (texCache.has(key)) return texCache.get(key);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (!transparent) { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); }
    draw(g, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    texCache.set(key, t);
    return t;
}

/** Small seeded generator so a bar's posters / graffiti come out the same every visit. */
export function rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
export function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
}
const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');
const shade = (n, k) => {
    const r = Math.min(255, ((n >> 16) & 255) * k), g = Math.min(255, ((n >> 8) & 255) * k), b = Math.min(255, (n & 255) * k);
    return `rgb(${r | 0},${g | 0},${b | 0})`;
};
const FONT = '"Arial Black", "Segoe UI", Arial, sans-serif';

/** Running-bond brick, 1.2 m x 0.6 m per tile. */
export function brickTex(color = 0x8a3b2a, mortar = 0xb8ada0) {
    return canvasTex(`brick_${color}_${mortar}`, 256, 128, (g, w, h) => {
        const r = rng(color);
        g.fillStyle = hex(mortar); g.fillRect(0, 0, w, h);
        const rows = 8, bw = w / 5, bh = h / rows;
        for (let y = 0; y < rows; y++) {
            for (let x = -1; x < 6; x++) {
                g.fillStyle = shade(color, 0.75 + r() * 0.45);
                g.fillRect(x * bw + (y % 2) * bw / 2 + 1.5, y * bh + 1.5, bw - 3, bh - 3);
            }
        }
    });
}
/** Planks running along the room, 2 m tile. */
export function woodTex(color = 0x6b4426, { planks = 8, worn = 0.25 } = {}) {
    return canvasTex(`wood_${color}_${planks}_${worn}`, 256, 256, (g, w, h) => {
        const r = rng(color + planks);
        const pw = w / planks;
        for (let i = 0; i < planks; i++) {
            g.fillStyle = shade(color, 0.8 + r() * 0.35);
            g.fillRect(i * pw, 0, pw, h);
            for (let k = 0; k < 14; k++) {         // grain
                g.strokeStyle = `rgba(0,0,0,${0.05 + r() * 0.08})`;
                g.beginPath();
                const x = i * pw + r() * pw;
                g.moveTo(x, 0); g.bezierCurveTo(x + r() * 6 - 3, h / 3, x + r() * 6 - 3, h * 2 / 3, x, h);
                g.stroke();
            }
            g.fillStyle = 'rgba(0,0,0,0.45)';
            g.fillRect(i * pw, 0, 1.5, h);
            const cut = r() * h;                     // butt joint
            g.fillRect(i * pw, cut, pw, 1.5);
        }
        for (let k = 0; k < 60 * worn; k++) {        // scuffs
            g.fillStyle = `rgba(255,255,255,${r() * 0.06})`;
            g.beginPath(); g.ellipse(r() * w, r() * h, 4 + r() * 20, 2 + r() * 6, r() * 3, 0, 7); g.fill();
        }
    });
}
/** Two-colour checkerboard, 0.6 m tile. */
export function checkerTex(a = 0x111111, b = 0xe8e2d6) {
    return canvasTex(`checker_${a}_${b}`, 64, 64, (g, w, h) => {
        g.fillStyle = hex(a); g.fillRect(0, 0, w, h);
        g.fillStyle = hex(b); g.fillRect(0, 0, w / 2, h / 2); g.fillRect(w / 2, h / 2, w / 2, h / 2);
    });
}
/** Stained concrete, 3 m tile. */
export function concreteTex(color = 0x5a5650) {
    return canvasTex(`concrete_${color}`, 256, 256, (g, w, h) => {
        const r = rng(color);
        g.fillStyle = hex(color); g.fillRect(0, 0, w, h);
        for (let i = 0; i < 400; i++) {
            g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.05})`;
            g.beginPath(); g.arc(r() * w, r() * h, 2 + r() * 26, 0, 7); g.fill();
        }
        g.strokeStyle = 'rgba(0,0,0,0.3)';
        g.strokeRect(0.5, 0.5, w - 1, h - 1);
    });
}
/** Pressed tin ceiling tiles, 0.6 m tile. */
export function tinTex(color = 0xb9b2a2) {
    return canvasTex(`tin_${color}`, 128, 128, (g, w, h) => {
        g.fillStyle = hex(color); g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3;
        g.strokeRect(6, 6, w - 12, h - 12);
        g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;
        g.strokeRect(14, 14, w - 28, h - 28);
        g.beginPath(); g.arc(w / 2, h / 2, 26, 0, 7); g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.3)';
        for (let i = 0; i < 4; i++) {
            g.beginPath(); g.arc(w / 2, h / 2, 10 + i * 4, i, i + 2.4); g.stroke();
        }
    });
}
/** Vertical wood paneling with grooves, 1.2 m tile. */
export function panelTex(color = 0x5a3a22) {
    return canvasTex(`panel_${color}`, 128, 128, (g, w, h) => {
        const r = rng(color);
        for (let i = 0; i < 6; i++) {
            g.fillStyle = shade(color, 0.85 + r() * 0.3);
            g.fillRect(i * w / 6, 0, w / 6, h);
            g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(i * w / 6, 0, 2, h);
        }
    });
}
/** Painted plaster with a little unevenness, 2 m tile. */
export function paintTex(color = 0x3a2a40) {
    return canvasTex(`paint_${color}`, 64, 64, (g, w, h) => {
        const r = rng(color);
        g.fillStyle = hex(color); g.fillRect(0, 0, w, h);
        for (let i = 0; i < 80; i++) {
            g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.04})`;
            g.fillRect(r() * w, r() * h, 4 + r() * 12, 4 + r() * 12);
        }
    });
}
/** Horizontal lap siding: `boards` boards per 1 m tile (2 m wide), each shadowed under its lip. */
export function sidingTex(color = 0xb8b0a0, boards = 6, weathered = 0.4) {
    return canvasTex(`siding_${color}_${boards}_${weathered}`, 256, 128, (g, w, h) => {
        const r = rng(color + boards);
        const bh = h / boards;
        for (let i = 0; i < boards; i++) {
            const y = i * bh;
            const gr = g.createLinearGradient(0, y, 0, y + bh);
            gr.addColorStop(0, shade(color, 1.08)); gr.addColorStop(1, shade(color, 0.86));
            g.fillStyle = gr; g.fillRect(0, y, w, bh);
            for (let k = 0; k < 10 * weathered; k++) {           // grain and weathering
                g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.04 + r() * 0.06})`;
                g.fillRect(r() * w, y + r() * bh, 20 + r() * 80, 1 + r() * 1.5);
            }
            g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, y + bh - 2, w, 2);
            const joint = r() * w;                                    // butt joint
            g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(joint, y, 1.5, bh);
        }
    });
}
/** Vertical board siding (T1-11 / board and batten), 1.2 m tile. */
export function battenTex(color = 0x5a3a28, boards = 6) {
    return canvasTex(`batten_${color}_${boards}`, 128, 128, (g, w, h) => {
        const r = rng(color);
        const bw = w / boards;
        for (let i = 0; i < boards; i++) {
            g.fillStyle = shade(color, 0.9 + r() * 0.18);
            g.fillRect(i * bw, 0, bw, h);
            for (let k = 0; k < 5; k++) { g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(i * bw + r() * bw, 0, 1, h); }
            g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(i * bw, 0, 2, h);
            g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(i * bw + 2, 0, 1, h);
        }
    });
}
/** Corrugated metal cladding, ribs running up the wall, 1 m tile. */
export function ribbedTex(color = 0x1e2024, ribs = 8) {
    return canvasTex(`ribbed_${color}_${ribs}`, 128, 64, (g, w, h) => {
        const rw = w / ribs;
        for (let i = 0; i < ribs; i++) {
            const gr = g.createLinearGradient(i * rw, 0, (i + 1) * rw, 0);
            gr.addColorStop(0, shade(color, 0.7)); gr.addColorStop(0.35, shade(color, 1.35));
            gr.addColorStop(0.55, shade(color, 1.0)); gr.addColorStop(1, shade(color, 0.75));
            g.fillStyle = gr; g.fillRect(i * rw, 0, rw, h);
        }
    });
}
/** Pressed pyramid-stud panels (four studs a side per 0.6 m tile). */
export function quiltedTex(color = 0xd8d8d8) {
    return canvasTex(`quilted_${color}`, 128, 128, (g, w, h) => {
        const n = 4, s = w / n;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
            const x0 = x * s, y0 = y * s, cx = x0 + s / 2, cy = y0 + s / 2;
            const tri = (ax, ay, bx, by, k) => { g.fillStyle = shade(color, k); g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(cx, cy); g.fill(); };
            tri(x0, y0, x0 + s, y0, 1.12);           // lit from above
            tri(x0, y0, x0, y0 + s, 1.0);
            tri(x0 + s, y0, x0 + s, y0 + s, 0.86);
            tri(x0, y0 + s, x0 + s, y0 + s, 0.72);
        }
    });
}
/** Dressed stone blocks, 1.2 m x 0.6 m tile (two courses). */
export function stoneTex(color = 0xd8d4c8, mortar = 0xa8a498) {
    return canvasTex(`stone_${color}_${mortar}`, 256, 128, (g, w, h) => {
        const r = rng(color);
        g.fillStyle = hex(mortar); g.fillRect(0, 0, w, h);
        for (let row = 0; row < 2; row++) {
            for (let x = -1; x < 3; x++) {
                const bx = x * w / 2 + (row % 2) * w / 4;
                g.fillStyle = shade(color, 0.9 + r() * 0.14);
                g.fillRect(bx + 2, row * h / 2 + 2, w / 2 - 4, h / 2 - 4);
                for (let k = 0; k < 30; k++) { g.fillStyle = `rgba(0,0,0,${r() * 0.05})`; g.fillRect(bx + r() * w / 2, row * h / 2 + r() * h / 2, 3, 3); }
            }
        }
    });
}
/** Wood shingles, 1 m tile. */
export function shingleTex(color = 0x8a5a40) {
    return canvasTex(`shingle_${color}`, 128, 128, (g, w, h) => {
        const r = rng(color);
        const rows = 5, rh = h / rows;
        for (let y = 0; y < rows; y++) {
            let x = (y % 2) * -10;
            while (x < w) {
                const sw = 14 + r() * 16;
                g.fillStyle = shade(color, 0.75 + r() * 0.45);
                g.fillRect(x + 1, y * rh, sw - 2, rh);
                g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(x + 1, y * rh + rh - 3, sw - 2, 3);
                x += sw;
            }
        }
    });
}
/** A band of moulded terra-cotta (rosettes in diamonds), 1.2 m x 0.6 m tile. */
export function ornamentTex(color = 0xb06a48) {
    return canvasTex(`ornament_${color}`, 256, 128, (g, w, h) => {
        g.fillStyle = shade(color, 0.85); g.fillRect(0, 0, w, h);
        const n = 4, s = w / n;
        for (let i = 0; i < n; i++) {
            const cx = i * s + s / 2, cy = h / 2;
            g.fillStyle = shade(color, 1.1);
            g.beginPath(); g.moveTo(cx, cy - h * 0.42); g.lineTo(cx + s * 0.45, cy); g.lineTo(cx, cy + h * 0.42); g.lineTo(cx - s * 0.45, cy); g.fill();
            g.fillStyle = shade(color, 0.7);
            g.beginPath(); g.arc(cx, cy, h * 0.2, 0, 7); g.fill();
            g.fillStyle = shade(color, 1.25);
            for (let p = 0; p < 8; p++) { g.beginPath(); g.arc(cx + Math.cos(p * 0.785) * h * 0.12, cy + Math.sin(p * 0.785) * h * 0.12, h * 0.05, 0, 7); g.fill(); }
        }
        g.fillStyle = shade(color, 0.6); g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
    });
}
/** Glass block, 0.6 m tile (four blocks a side). */
export function glassBlockTex() {
    return canvasTex('glassblock', 64, 64, (g, w, h) => {
        g.fillStyle = '#c8ccd0'; g.fillRect(0, 0, w, h);
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
            const gr = g.createRadialGradient(x * 16 + 8, y * 16 + 8, 1, x * 16 + 8, y * 16 + 8, 9);
            gr.addColorStop(0, '#f4f8fa'); gr.addColorStop(1, '#8a98a4');
            g.fillStyle = gr; g.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
        }
    });
}

/** Acoustic drop-ceiling tiles, 1.2 m tile. */
export function dropTex() {
    return canvasTex('drop', 64, 64, (g, w, h) => {
        g.fillStyle = '#d8d4c8'; g.fillRect(0, 0, w, h);
        const r = rng(7);
        for (let i = 0; i < 90; i++) { g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(r() * w, r() * h, 1, 1); }
        g.fillStyle = '#9a968c'; g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h);
    });
}
/** Three shelves of bottles, 1.2 m wide x 0.45 m per tile (tile it vertically for more rows). */
export function bottlesTex(back = 0x2a1a10, glow = null) {
    return canvasTex(`bottles_${back}_${glow}`, 256, 96, (g, w, h) => {
        const r = rng(back + 3);
        g.fillStyle = hex(back); g.fillRect(0, 0, w, h);
        if (glow !== null) {
            const gr = g.createLinearGradient(0, 0, 0, h);
            gr.addColorStop(0, shade(glow, 0.15)); gr.addColorStop(1, shade(glow, 0.7));
            g.fillStyle = gr; g.fillRect(0, 0, w, h);
        }
        const cols = ['#5a3a12', '#c88a2a', '#2d6a2a', '#e8e8e0', '#7a1a22', '#2a4a8a', '#d8b860', '#3a2a10', '#88c8d8'];
        let x = 3;
        while (x < w - 8) {
            const bw = 8 + r() * 7, bh = 46 + r() * 34;
            const c = cols[Math.floor(r() * cols.length)];
            g.fillStyle = c;
            g.fillRect(x, h - 6 - bh * 0.65, bw, bh * 0.65);                // body
            g.fillRect(x + bw * 0.32, h - 6 - bh, bw * 0.36, bh * 0.36);      // neck
            g.fillStyle = 'rgba(255,255,255,0.35)';
            g.fillRect(x + 1.5, h - 6 - bh * 0.6, 1.5, bh * 0.5);            // highlight
            g.fillStyle = 'rgba(240,235,220,0.8)';
            g.fillRect(x + 1, h - 6 - bh * 0.4, bw - 2, bh * 0.15);           // label
            x += bw + 2 + r() * 3;
        }
        g.fillStyle = '#c8c0b0'; g.fillRect(0, h - 6, w, 6);                  // shelf edge
    });
}
/** A wall of shot glasses on little shelves. */
export function shotGlassTex() {
    return canvasTex('shotglass', 256, 128, (g, w, h) => {
        g.fillStyle = '#1a1020'; g.fillRect(0, 0, w, h);
        const r = rng(91);
        for (let row = 0; row < 4; row++) {
            for (let i = 0; i < 16; i++) {
                const x = i * 16 + 3, y = row * 32 + 8;
                g.fillStyle = `hsla(${r() * 360},80%,60%,0.85)`;
                g.fillRect(x + 1, y + 10, 9, 10);
                g.strokeStyle = 'rgba(255,255,255,0.7)';
                g.strokeRect(x, y, 11, 20);
            }
            g.fillStyle = '#d8d0c0'; g.fillRect(0, row * 32 + 29, w, 3);
        }
    });
}

/** Glowing neon words on a transparent background. */
export function neonTex(text, color = 0xff3a7a, { script = false } = {}) {
    return canvasTex(`neon_${text}_${color}_${script}`, 512, 160, (g, w, h) => {
        g.clearRect(0, 0, w, h);
        let size = 110;
        g.font = `${script ? 'italic bold' : 'bold'} ${size}px ${script ? 'Georgia, serif' : FONT}`;
        while (g.measureText(text).width > w - 40 && size > 20) { size -= 4; g.font = `${script ? 'italic bold' : 'bold'} ${size}px ${script ? 'Georgia, serif' : FONT}`; }
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 7; g.lineJoin = 'round';
        g.shadowColor = hex(color); g.shadowBlur = 28;
        g.strokeStyle = hex(color);
        g.strokeText(text, w / 2, h / 2);
        g.shadowBlur = 10;
        g.lineWidth = 2.5; g.strokeStyle = '#ffffff';
        g.strokeText(text, w / 2, h / 2);
    }, { repeat: false, transparent: true });
}

/** A painted / lit storefront sign. */
export function signTex(text, { bg = 0x111111, fg = 0xf2e6c8, border = null, font = FONT, sub = '' } = {}) {
    return canvasTex(`sign_${text}_${bg}_${fg}_${border}_${sub}`, 1024, 192, (g, w, h) => {
        g.fillStyle = hex(bg); g.fillRect(0, 0, w, h);
        if (border !== null) { g.strokeStyle = hex(border); g.lineWidth = 12; g.strokeRect(10, 10, w - 20, h - 20); }
        g.fillStyle = hex(fg); g.textAlign = 'center'; g.textBaseline = 'middle';
        let size = sub ? 96 : 120;
        g.font = `bold ${size}px ${font}`;
        while (g.measureText(text).width > w - 70 && size > 30) { size -= 4; g.font = `bold ${size}px ${font}`; }
        g.fillText(text, w / 2, sub ? h * 0.42 : h / 2 + 4);
        if (sub) { g.font = `bold 34px ${FONT}`; g.fillText(sub, w / 2, h * 0.82); }
    }, { repeat: false });
}

/** What's on a TV: a football / basketball / baseball / hockey broadcast, or a music video. */
export function tvTex(kind = 0) {
    return canvasTex(`tv_${kind}`, 160, 96, (g, w, h) => {
        const r = rng(kind * 31 + 5);
        const k = kind % 5;
        if (k === 0) {            // football
            g.fillStyle = '#2f7a2f'; g.fillRect(0, 0, w, h);
            g.strokeStyle = 'rgba(255,255,255,0.8)';
            for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(10 + i * 18, 18); g.lineTo(i * 20 - 5, h); g.stroke(); }
            for (let i = 0; i < 14; i++) { g.fillStyle = i < 7 ? '#d23' : '#eee'; g.fillRect(40 + r() * 80, 30 + r() * 50, 4, 7); }
        } else if (k === 1) {     // basketball
            g.fillStyle = '#c99a5a'; g.fillRect(0, 0, w, h);
            g.strokeStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.arc(w / 2, h + 10, 50, 3.4, 6); g.stroke();
            g.fillStyle = '#2a2a3a'; g.fillRect(0, 0, w, 22);
            for (let i = 0; i < 10; i++) { g.fillStyle = i < 5 ? '#1a4ad0' : '#f2f2f2'; g.fillRect(20 + r() * 120, 40 + r() * 40, 4, 9); }
        } else if (k === 2) {     // baseball
            g.fillStyle = '#3c8a3c'; g.fillRect(0, 0, w, h);
            g.fillStyle = '#b07a4a'; g.beginPath(); g.moveTo(w / 2, 30); g.lineTo(w / 2 + 40, 62); g.lineTo(w / 2, 94); g.lineTo(w / 2 - 40, 62); g.fill();
            g.fillStyle = '#eee'; g.fillRect(w / 2 - 3, 88, 6, 6);
        } else if (k === 3) {     // hockey
            g.fillStyle = '#e8eef4'; g.fillRect(0, 0, w, h);
            g.fillStyle = '#c22'; g.fillRect(w / 2 - 1, 0, 3, h);
            g.fillStyle = '#22a'; g.fillRect(w / 3, 0, 3, h); g.fillRect(w * 2 / 3, 0, 3, h);
            for (let i = 0; i < 8; i++) { g.fillStyle = i < 4 ? '#111' : '#c22'; g.fillRect(20 + r() * 120, 20 + r() * 60, 4, 8); }
        } else {                  // music video
            const gr = g.createLinearGradient(0, 0, w, h);
            gr.addColorStop(0, '#7a1ad0'); gr.addColorStop(1, '#f03a7a');
            g.fillStyle = gr; g.fillRect(0, 0, w, h);
            g.fillStyle = 'rgba(0,0,0,0.6)';
            g.beginPath(); g.arc(w / 2, 50, 12, 0, 7); g.fill(); g.fillRect(w / 2 - 14, 60, 28, 40);
        }
        // Score bug
        g.fillStyle = 'rgba(10,10,20,0.85)'; g.fillRect(6, h - 16, 74, 12);
        g.fillStyle = '#fff'; g.font = 'bold 9px Arial'; g.fillText(`${Math.floor(r() * 30)} - ${Math.floor(r() * 30)}  Q${1 + Math.floor(r() * 4)}`, 10, h - 7);
    }, { repeat: false });
}

const BAND_A = ['Black', 'Wood County', 'Rust', 'Swamp', 'Velvet', 'Static', 'Copper', 'Midnight', 'Feral', 'Lake Erie', 'Gravel', 'Neon', 'Orange', 'Silo'];
const BAND_B = ['Owls', 'Saints', 'Tractor', 'Ghosts', 'Machine', 'Radio', 'Hounds', 'Riot', 'Kids', 'Union', 'Revival', 'Engines', 'Choir', 'Fever'];
/** A gig poster for an invented band. */
export function posterTex(seed) {
    return canvasTex(`poster_${seed}`, 128, 180, (g, w, h) => {
        const r = rng(seed);
        const hue = r() * 360;
        g.fillStyle = `hsl(${hue},55%,${25 + r() * 40}%)`; g.fillRect(0, 0, w, h);
        g.fillStyle = `hsl(${(hue + 180) % 360},70%,60%)`;
        for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(r() * w, 40 + r() * 90, 10 + r() * 34, 0, 7); g.fill(); }
        g.fillStyle = '#fff'; g.textAlign = 'center';
        g.font = `bold 15px ${FONT}`;
        const a = BAND_A[Math.floor(r() * BAND_A.length)], b = BAND_B[Math.floor(r() * BAND_B.length)];
        g.fillText(a.toUpperCase(), w / 2, 130); g.fillText(b.toUpperCase(), w / 2, 148);
        g.font = 'bold 11px Arial';
        g.fillText(`LIVE  ${['FRI', 'SAT', 'THU'][Math.floor(r() * 3)]} ${1 + Math.floor(r() * 28)}`, w / 2, 168);
        g.strokeStyle = 'rgba(0,0,0,0.4)'; g.strokeRect(1, 1, w - 2, h - 2);
    }, { repeat: false });
}
/** Spray paint tags, stickers and scrawl over a wall, 4 m x 2 m tile. */
export function graffitiTex(seed, base = 0x2a2a2a) {
    return canvasTex(`graffiti_${seed}_${base}`, 512, 256, (g, w, h) => {
        const r = rng(seed);
        g.fillStyle = hex(base); g.fillRect(0, 0, w, h);
        const words = ['BG', 'ROCK', 'LIVE', '1928', 'H', 'FALCONS', 'PUNX', 'LOUD', 'BSU', 'NOISE', 'KAJ', 'XO', 'WOOD CO', 'ENCORE'];
        for (let i = 0; i < 70; i++) {           // scrawl
            g.strokeStyle = `hsla(${r() * 360},70%,${45 + r() * 30}%,${0.5 + r() * 0.5})`;
            g.lineWidth = 1 + r() * 4;
            g.beginPath();
            let x = r() * w, y = r() * h;
            g.moveTo(x, y);
            for (let k = 0; k < 4; k++) { x += r() * 40 - 20; y += r() * 30 - 15; g.lineTo(x, y); }
            g.stroke();
        }
        for (let i = 0; i < 22; i++) {           // tags
            g.save();
            g.translate(r() * w, r() * h);
            g.rotate(r() * 0.6 - 0.3);
            g.font = `${r() < 0.5 ? 'italic ' : ''}bold ${14 + r() * 34}px ${FONT}`;
            g.fillStyle = `hsl(${r() * 360},80%,${50 + r() * 25}%)`;
            g.strokeStyle = '#000'; g.lineWidth = 3;
            const t = words[Math.floor(r() * words.length)];
            g.strokeText(t, 0, 0); g.fillText(t, 0, 0);
            g.restore();
        }
        for (let i = 0; i < 18; i++) {           // stickers
            g.fillStyle = `hsl(${r() * 360},60%,${40 + r() * 40}%)`;
            g.fillRect(r() * w, r() * h, 12 + r() * 22, 8 + r() * 14);
        }
    });
}
/** A painted mural: hills, a sun, a skyline and a guitar-shaped flourish. */
export function muralTex(seed) {
    return canvasTex(`mural_${seed}`, 512, 256, (g, w, h) => {
        const r = rng(seed);
        const sky = g.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, `hsl(${200 + r() * 80},60%,35%)`); sky.addColorStop(1, `hsl(${10 + r() * 30},80%,60%)`);
        g.fillStyle = sky; g.fillRect(0, 0, w, h);
        g.fillStyle = '#ffd25a'; g.beginPath(); g.arc(w * (0.2 + r() * 0.6), h * 0.45, 40, 0, 7); g.fill();
        for (let k = 0; k < 3; k++) {
            g.fillStyle = `hsl(${100 + r() * 60},40%,${18 + k * 8}%)`;
            g.beginPath(); g.moveTo(0, h);
            for (let x = 0; x <= w; x += 32) g.lineTo(x, h * (0.6 + k * 0.1) + Math.sin(x * 0.02 + k * 2 + r()) * 18);
            g.lineTo(w, h); g.fill();
        }
        g.fillStyle = 'rgba(10,10,20,0.85)';
        for (let x = 0; x < w; x += 18 + r() * 20) { const bh = 30 + r() * 60; g.fillRect(x, h * 0.62 - bh, 14, bh); }
        g.strokeStyle = '#fff'; g.lineWidth = 6;
        g.beginPath(); g.ellipse(w * 0.8, h * 0.7, 26, 36, 0.4, 0, 7); g.stroke();
        g.beginPath(); g.moveTo(w * 0.8 - 8, h * 0.62); g.lineTo(w * 0.8 - 60, h * 0.15); g.stroke();
    });
}
/** A hall-of-fame wall: rows of framed black and white band photos. */
export function photosTex(seed) {
    return canvasTex(`photos_${seed}`, 256, 128, (g, w, h) => {
        const r = rng(seed);
        g.fillStyle = '#3a2a1e'; g.fillRect(0, 0, w, h);
        for (let row = 0; row < 3; row++) {
            for (let i = 0; i < 6; i++) {
                const x = 6 + i * 41 + r() * 4, y = 6 + row * 41 + r() * 4;
                g.fillStyle = '#1a1410'; g.fillRect(x, y, 34, 34);
                const v = 120 + r() * 100;
                g.fillStyle = `rgb(${v},${v},${v * 0.95})`; g.fillRect(x + 3, y + 3, 28, 28);
                g.fillStyle = 'rgba(20,20,20,0.75)';
                for (let p = 0; p < 1 + Math.floor(r() * 3); p++) {
                    const px = x + 7 + p * 8;
                    g.beginPath(); g.arc(px, y + 14, 3.2, 0, 7); g.fill();
                    g.fillRect(px - 3.5, y + 17, 7, 14);
                }
            }
        }
    });
}
/** Framed prints of harness racing (a horse pulling a sulky). */
export function horseTex(seed) {
    return canvasTex(`horse_${seed}`, 160, 120, (g, w, h) => {
        const r = rng(seed);
        g.fillStyle = '#5a3a1a'; g.fillRect(0, 0, w, h);
        g.fillStyle = `hsl(${30 + r() * 20},35%,${70 + r() * 15}%)`; g.fillRect(10, 10, w - 20, h - 20);
        g.fillStyle = '#3a6a2a'; g.fillRect(10, 80, w - 20, h - 90);
        g.fillStyle = '#2a1a10';
        g.beginPath(); g.ellipse(70, 62, 26, 11, 0, 0, 7); g.fill();              // body
        g.beginPath(); g.moveTo(92, 58); g.lineTo(110, 36); g.lineTo(117, 42); g.lineTo(98, 64); g.fill();   // neck+head
        for (const [x, d] of [[52, -6], [60, 6], [82, -5], [90, 7]]) { g.fillRect(x, 68, 3, 14); g.fillRect(x + d, 80, 3, 4); }
        g.strokeStyle = '#2a1a10'; g.lineWidth = 2;
        g.beginPath(); g.arc(30, 78, 9, 0, 7); g.stroke();                        // sulky wheel
        g.beginPath(); g.moveTo(30, 70); g.lineTo(50, 60); g.stroke();
        g.fillStyle = `hsl(${r() * 360},70%,45%)`; g.beginPath(); g.arc(34, 54, 5, 0, 7); g.fill(); g.fillRect(30, 58, 8, 12);
    }, { repeat: false });
}
/** "WANTED" poster for the saloon. */
export function wantedTex(seed) {
    return canvasTex(`wanted_${seed}`, 120, 160, (g, w, h) => {
        const r = rng(seed);
        g.fillStyle = '#d8c08a'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#3a2a10'; g.textAlign = 'center';
        g.font = `bold 22px Georgia, serif`; g.fillText('WANTED', w / 2, 28);
        g.fillStyle = '#5a4020'; g.fillRect(25, 40, 70, 70);
        g.fillStyle = '#d8c08a'; g.beginPath(); g.arc(60, 66, 14, 0, 7); g.fill(); g.fillRect(44, 82, 32, 28);
        g.fillStyle = '#3a2a10'; g.font = 'bold 13px Georgia, serif';
        g.fillText(`$${(1 + Math.floor(r() * 9)) * 500} REWARD`, w / 2, 135);
    }, { repeat: false });
}
/** A chalkboard drinks menu. */
export function menuTex(title = 'ON TAP') {
    return canvasTex(`menu_${title}`, 256, 192, (g, w, h) => {
        g.fillStyle = '#1f2a24'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#7a5a3a'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
        g.fillStyle = '#f2f0e8'; g.textAlign = 'center';
        g.font = 'bold 24px Georgia, serif'; g.fillText(title, w / 2, 38);
        g.font = '15px Georgia, serif'; g.textAlign = 'left';
        const items = [['Domestic draft', '$3'], ['Craft pint', '$6'], ['Well drinks', '$4'], ['Pitchers', '$9'], ['Fishbowls', '$12'], ['Shot of the day', '$3']];
        items.forEach(([a, b], i) => { g.fillText(a, 22, 68 + i * 20); g.fillText(b, w - 50, 68 + i * 20); });
    }, { repeat: false });
}
/** Dartboard. */
export function dartTex() {
    return canvasTex('dart', 128, 128, (g, w, h) => {
        g.fillStyle = '#111'; g.fillRect(0, 0, w, h);
        const c = w / 2;
        for (let i = 0; i < 20; i++) {
            const a0 = (i / 20) * Math.PI * 2, a1 = ((i + 1) / 20) * Math.PI * 2;
            for (const [r0, r1, col] of [[50, 60, i % 2 ? '#c22' : '#2a2'], [33, 50, i % 2 ? '#111' : '#eed'], [28, 33, i % 2 ? '#c22' : '#2a2'], [8, 28, i % 2 ? '#111' : '#eed']]) {
                g.fillStyle = col; g.beginPath(); g.arc(c, c, r1, a0, a1); g.arc(c, c, r0, a1, a0, true); g.fill();
            }
        }
        g.fillStyle = '#2a2'; g.beginPath(); g.arc(c, c, 8, 0, 7); g.fill();
        g.fillStyle = '#c22'; g.beginPath(); g.arc(c, c, 4, 0, 7); g.fill();
    }, { repeat: false });
}
/** LED dance floor: four 8x8 colour patterns side by side; the floor steps through them (texture offset). */
export function ledFloorTex() {
    return canvasTex('ledfloor', 256, 64, (g, w, h) => {
        const r = rng(44);
        for (let p = 0; p < 4; p++) {
            for (let y = 0; y < 8; y++) {
                for (let x = 0; x < 8; x++) {
                    const on = r() < 0.55;
                    g.fillStyle = on ? `hsl(${(p * 90 + (x + y) * 25) % 360},90%,${45 + r() * 20}%)` : '#120a1a';
                    g.fillRect(p * 64 + x * 8 + 0.5, y * 8 + 0.5, 7, 7);
                }
            }
        }
    });
}
/** Mirror-ball facets. */
export function mirrorTex() {
    return canvasTex('mirror', 128, 64, (g, w, h) => {
        const r = rng(3);
        for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
            const v = 120 + r() * 135;
            g.fillStyle = `rgb(${v},${v},${v + 10})`; g.fillRect(x * 4, y * 4, 3.5, 3.5);
        }
    });
}
/** Upper-storey windows seen from the street: dark glass, blinds, a few lit. */
export function upperWindowTex(seed) {
    return canvasTex(`upwin_${seed}`, 64, 96, (g, w, h) => {
        const r = rng(seed);
        const lit = r() < 0.35;
        g.fillStyle = lit ? '#e8c87a' : '#1a222c'; g.fillRect(0, 0, w, h);
        if (lit) { g.fillStyle = 'rgba(80,50,20,0.35)'; for (let i = 0; i < 12; i++) g.fillRect(0, i * 8, w, 3); }
        else { g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.moveTo(0, h); g.lineTo(w * 0.6, 0); g.lineTo(w, 0); g.lineTo(w * 0.4, h); g.fill(); }
        g.fillStyle = '#e6e0d0'; g.fillRect(w / 2 - 1.5, 0, 3, h); g.fillRect(0, h / 2 - 1.5, w, 3);
    }, { repeat: false });
}
/** An arcade cabinet screen (blocky invented game). */
export function arcadeTex(seed) {
    return canvasTex(`arcade_${seed}`, 64, 80, (g, w, h) => {
        const r = rng(seed);
        g.fillStyle = '#05050f'; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 40; i++) { g.fillStyle = `hsl(${r() * 360},90%,60%)`; g.fillRect(Math.floor(r() * 16) * 4, Math.floor(r() * 20) * 4, 4, 4); }
        g.fillStyle = '#ff0'; g.fillRect(28, 64, 8, 8);
        g.fillStyle = '#fff'; g.font = 'bold 8px monospace'; g.fillText(`${Math.floor(r() * 99999)}`, 4, 9);
    }, { repeat: false });
}
/** A plain word-mark for marquees, restroom doors and such. */
export function labelTex(text, bg = 0x111111, fg = 0xffffff, w = 256, h = 64) {
    return canvasTex(`label_${text}_${bg}_${fg}_${w}_${h}`, w, h, (g) => {
        g.fillStyle = hex(bg); g.fillRect(0, 0, w, h);
        g.fillStyle = hex(fg); g.textAlign = 'center'; g.textBaseline = 'middle';
        let size = h * 0.7;
        g.font = `bold ${size}px ${FONT}`;
        while (g.measureText(text).width > w - 12 && size > 8) { size -= 2; g.font = `bold ${size}px ${FONT}`; }
        g.fillText(text, w / 2, h / 2 + 2);
    }, { repeat: false });
}
/** Letters stacked top to bottom, for a vertical blade sign. */
export function verticalLabelTex(text, bg = 0x111111, fg = 0xffffff) {
    const chars = [...text];
    return canvasTex(`vlabel_${text}_${bg}_${fg}`, 96, 96 * chars.length, (g, w, h) => {
        g.fillStyle = hex(bg); g.fillRect(0, 0, w, h);
        g.strokeStyle = hex(fg); g.lineWidth = 4; g.strokeRect(4, 4, w - 8, h - 8);
        g.fillStyle = hex(fg); g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `bold 70px ${FONT}`;
        g.shadowColor = hex(fg); g.shadowBlur = 12;
        chars.forEach((c, i) => g.fillText(c, w / 2, 96 * i + 52));
    }, { repeat: false });
}
/** A marquee: chasing bulbs round the edge, black letters on white. */
export function marqueeTex(lines) {
    return canvasTex(`marquee_${lines.join('|')}`, 512, 160, (g, w, h) => {
        g.fillStyle = '#f4efe0'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
        lines.forEach((t, i) => { g.font = `bold ${i ? 30 : 40}px ${FONT}`; g.fillText(t, w / 2, 40 + i * 42); });
        g.fillStyle = '#ffd86a';
        for (let x = 8; x < w; x += 18) { g.beginPath(); g.arc(x, 7, 4, 0, 7); g.arc(x, h - 7, 4, 0, 7); g.fill(); }
    }, { repeat: false });
}
/** An aquarium: blue water, weed, fish. */
export function tankTex() {
    return canvasTex('tank', 256, 96, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, '#2fa8e0'); gr.addColorStop(1, '#0a3a6a');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
        const r = rng(12);
        g.fillStyle = '#d8c890'; g.fillRect(0, h - 10, w, 10);
        for (let i = 0; i < 12; i++) { g.strokeStyle = '#2a8a3a'; g.lineWidth = 3; g.beginPath(); const x = r() * w; g.moveTo(x, h - 8); g.quadraticCurveTo(x + 10, h - 40, x - 4, h - 60 - r() * 20); g.stroke(); }
        for (let i = 0; i < 14; i++) {
            g.fillStyle = ['#ff8a2a', '#ffd23a', '#ff4a8a', '#8af', '#fff'][i % 5];
            const x = r() * w, y = 15 + r() * (h - 35);
            g.beginPath(); g.ellipse(x, y, 7, 3.5, 0, 0, 7); g.fill();
            g.beginPath(); g.moveTo(x - 6, y); g.lineTo(x - 11, y - 4); g.lineTo(x - 11, y + 4); g.fill();
        }
    });
}
/** Theatre curtain folds. */
export function curtainTex(color = 0x8a0f1a) {
    return canvasTex(`curtain_${color}`, 128, 32, (g, w, h) => {
        for (let x = 0; x < w; x++) {
            const k = 0.55 + 0.45 * Math.sin(x / w * Math.PI * 8) ** 2;
            g.fillStyle = shade(color, k); g.fillRect(x, 0, 1, h);
        }
    });
}
/** Speaker grille / amp cloth. */
export function grilleTex() {
    return canvasTex('grille', 64, 64, (g, w, h) => {
        g.fillStyle = '#151515'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#2a2a2a';
        for (let y = 0; y < h; y += 3) for (let x = (y / 3) % 2 ? 1 : 0; x < w; x += 3) g.fillRect(x, y, 1.5, 1.5);
    });
}

// ------------------------------------------------------------------------------------------------
// Materials
// ------------------------------------------------------------------------------------------------
const matCache = new Map();
/**
 * A material for inside a bar: the colour (or texture) also glows a little, as if lit by the room's
 * lamps, so interiors read in shadow and at night. `glow` 0 for things outside.
 */
export function mat(key, { color = 0xffffff, map = null, glow = 0.32, rough = 0.8, metal = 0, transparent = false, opacity = 1, side = THREE.FrontSide, basic = false } = {}) {
    const k = `${key}|${glow}|${basic}`;
    if (matCache.has(k)) return matCache.get(k);
    let m;
    if (basic) {
        m = new THREE.MeshBasicMaterial({ color, map, transparent, opacity, side, toneMapped: false, depthWrite: !transparent });
    } else {
        m = new THREE.MeshStandardMaterial({ color, map, roughness: rough, metalness: metal, transparent, opacity, side, depthWrite: !transparent });
        if (glow > 0) {
            m.emissive = new THREE.Color(color);
            if (map) m.emissiveMap = map;
            m.emissiveIntensity = glow;
        }
    }
    matCache.set(k, m);
    return m;
}

// ------------------------------------------------------------------------------------------------
// Kit: geometry collected in a bar's local frame, merged per material
// ------------------------------------------------------------------------------------------------
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

/** Scales a BoxGeometry's UVs so a texture tiles every `tile` metres (faces: +x -x +y -y +z -z). */
function tileBoxUV(geo, w, h, d, tile) {
    const uv = geo.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
        const [a, b] = dims[f];
        for (let i = 0; i < 4; i++) {
            const k = f * 4 + i;
            uv.setXY(k, uv.getX(k) * a / tile[0], uv.getY(k) * b / tile[1]);
        }
    }
}

export class Kit {
    constructor() {
        this.parts = new Map();     // material -> geometries (already in the group's frame)
        this.colliders = [];        // [x0, z0, x1, z1, y0, y1] local
        this.extra = [];            // meshes kept separate (moving or picked)
        this.spots = [];            // where people stand / sit
        this.music = [];            // local music sources
        this.counters = [];         // [x0, z0, x1, z1, y] where you can order
    }

    _add(material, geo, x, y, z, rx = 0, ry = 0, rz = 0) {
        _e.set(rx, ry, rz, 'YXZ');
        _q.setFromEuler(_e);
        _p.set(x, y, z);
        _m.compose(_p, _q, _s);
        geo.applyMatrix4(_m);
        if (!this.parts.has(material)) this.parts.set(material, []);
        this.parts.get(material).push(geo);
        return geo;
    }

    /** Box centred at (x, y, z); `tile` [u, v] metres makes a texture repeat. */
    box(material, w, h, d, x, y, z, { ry = 0, rx = 0, rz = 0, tile = null } = {}) {
        if (w <= 0 || h <= 0 || d <= 0) return null;
        const g = new THREE.BoxGeometry(w, h, d);
        if (tile) tileBoxUV(g, w, h, d, tile);
        return this._add(material, g, x, y, z, rx, ry, rz);
    }
    /** Box from corner to corner (local axis aligned). */
    block(material, x0, y0, z0, x1, y1, z1, opts) {
        return this.box(material, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, opts);
    }
    /** Upright plane (faces +z before `ry`), w x h, centred at (x, y, z). */
    plane(material, w, h, x, y, z, { ry = 0, rx = 0, tile = null, flipU = false } = {}) {
        if (w <= 0 || h <= 0) return null;
        const g = new THREE.PlaneGeometry(w, h);
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
            let u = uv.getX(i), v = uv.getY(i);
            if (flipU) u = 1 - u;
            if (tile) { u *= w / tile[0]; v *= h / tile[1]; }
            uv.setXY(i, u, v);
        }
        return this._add(material, g, x, y, z, rx, ry, 0);
    }
    /** Floor / ceiling plane over a local rectangle at height y (up = faces +y). */
    flat(material, x0, z0, x1, z1, y, { up = true, tile = null } = {}) {
        const w = Math.abs(x1 - x0), d = Math.abs(z1 - z0);
        if (w <= 0 || d <= 0) return null;
        return this.plane(material, w, d, (x0 + x1) / 2, y, (z0 + z1) / 2, { rx: up ? -Math.PI / 2 : Math.PI / 2, tile });
    }
    cyl(material, rTop, rBot, h, x, y, z, { seg = 12, rx = 0, rz = 0, ry = 0, open = false } = {}) {
        return this._add(material, new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open), x, y, z, rx, ry, rz);
    }
    sphere(material, r, x, y, z, seg = 10) {
        return this._add(material, new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1)), x, y, z);
    }
    torus(material, r, tube, x, y, z, { rx = 0, ry = 0, seg = 16 } = {}) {
        return this._add(material, new THREE.TorusGeometry(r, tube, 6, seg), x, y, z, rx, ry, 0);
    }
    collide(x0, z0, x1, z1, y0 = 0, y1 = 3) {
        this.colliders.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), y0, y1]);
    }
    spot(kind, x, z, yaw, extra = {}) {
        this.spots.push({ kind, x, z, yaw, ...extra });
    }

    /** One mesh per material (UVs kept), added to `group`. */
    build(group, { castShadow = (m) => false } = {}) {
        for (const [material, geos] of this.parts) {
            const merged = mergeWithUV(geos);
            for (const g of geos) g.dispose();
            const mesh = new THREE.Mesh(merged, material);
            mesh.castShadow = castShadow(material);
            mesh.receiveShadow = !material.transparent;
            if (material.transparent) mesh.renderOrder = 2;
            mesh.matrixAutoUpdate = false;
            mesh.updateMatrix();
            group.add(mesh);
        }
        this.parts.clear();
        for (const e of this.extra) group.add(e);
    }
}

/** Concatenates geometries (made non-indexed) keeping position, normal and uv. */
export function mergeWithUV(list) {
    const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
    let n = 0;
    for (const g of geos) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let o = 0;
    for (const g of geos) {
        const c = g.attributes.position.count;
        pos.set(g.attributes.position.array, o * 3);
        nor.set(g.attributes.normal.array, o * 3);
        if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
        o += c;
        if (g !== list[geos.indexOf(g)]) g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.computeBoundingSphere();
    out.computeBoundingBox();
    return out;
}
