/**
 * js/game/mermaid/mermaidFace.js
 *
 * Paints the mermaids' faces (eyes, brows, lips, blush, freckles, face paint, glitter) onto canvases,
 * plus the textures used for tails (scale patterns) and fin-like panels (fins, capes, wings, ears).
 * Faces come in three frames: eyes open, a blink, and mouth open (talking).
 */

import * as THREE from 'three';
import { TAIL_COLORS } from './mermaidData.js';
import { hex, lerpColor, shade, canvasTexture, mulberry32 } from './mermaidKit.js';

export const FACE_W = 512;
export const FACE_H = 448;

const DARK = '#2a1c2e';
const EYE_Y = 180;
const EYE_DX = 128;
const BROW_Y = 112;
const MOUTH_Y = 332;

const SHAPES = {
    //            width height tilt  archTop archBot  irisScale
    round: { w: 124, h: 104, tilt: 0.0, top: 1.25, bot: 1.1, iris: 0.98 },
    almond: { w: 140, h: 84, tilt: 0.2, top: 0.95, bot: 0.75, iris: 0.9 },
    big: { w: 150, h: 118, tilt: 0.05, top: 1.35, bot: 1.15, iris: 1.0 },
    sleepy: { w: 134, h: 74, tilt: -0.06, top: 0.7, bot: 0.85, iris: 0.86 },
    cat: { w: 150, h: 82, tilt: 0.32, top: 0.95, bot: 0.6, iris: 0.9 },
    star: { w: 140, h: 108, tilt: 0.08, top: 1.2, bot: 0.95, iris: 0.98 }
};

function eyeOutline(g, cx, cy, side, S) {
    // side: -1 = the eye on the left of the canvas (its outer corner points left), +1 = right
    const rx = S.w / 2, ry = S.h / 2;
    const ix = cx - side * rx, iy = cy + S.tilt * S.h * 0.3;
    const ox = cx + side * rx, oy = cy - S.tilt * S.h;
    g.beginPath();
    g.moveTo(ix, iy);
    g.bezierCurveTo(cx - side * rx * 0.45, cy - ry * S.top, cx + side * rx * 0.35, cy - ry * S.top * 1.05, ox, oy);
    g.bezierCurveTo(cx + side * rx * 0.5, cy + ry * S.bot, cx - side * rx * 0.45, cy + ry * S.bot * 1.02, ix, iy);
    g.closePath();
    return { ix, iy, ox, oy, rx, ry };
}

function pointOnUpperLid(cx, cy, side, S, t) {
    // Bezier point along the upper lid (t 0 = inner corner, 1 = outer corner)
    const rx = S.w / 2, ry = S.h / 2;
    const p0 = [cx - side * rx, cy + S.tilt * S.h * 0.3];
    const p1 = [cx - side * rx * 0.45, cy - ry * S.top];
    const p2 = [cx + side * rx * 0.35, cy - ry * S.top * 1.05];
    const p3 = [cx + side * rx, cy - S.tilt * S.h];
    const u = 1 - t;
    return [
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
    ];
}

function drawEye(g, cx, cy, side, look, blink) {
    const S = SHAPES[look.eyeShape] || SHAPES.round;
    const liner = look.eyeliner || look.eyeShape === 'cat';
    const lash = look.lashes || 'none';
    // Eyeshadow first, a soft cloud over the lid
    if (look.eyeshadow != null) {
        const sx = cx + side * S.w * 0.06, sy = cy - S.h * 0.42;
        const gr = g.createRadialGradient(sx, sy, 4, sx, sy, S.w * 0.62);
        gr.addColorStop(0, hex(look.eyeshadow) + 'dd');
        gr.addColorStop(0.7, hex(look.eyeshadow) + '77');
        gr.addColorStop(1, hex(look.eyeshadow) + '00');
        g.fillStyle = gr;
        g.beginPath();
        g.ellipse(sx, sy, S.w * 0.62, S.h * 0.62, 0, 0, Math.PI * 2);
        g.fill();
    }
    if (blink) {
        // Closed: a gentle downward curve with lashes
        const rx = S.w / 2;
        g.strokeStyle = DARK;
        g.lineWidth = lash === 'none' ? 6 : 8;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(cx - side * rx, cy);
        g.quadraticCurveTo(cx, cy + S.h * 0.32, cx + side * rx, cy - S.tilt * S.h * 0.6);
        g.stroke();
        if (lash !== 'none') {
            const n = lash === 'long' ? 5 : 3;
            g.lineWidth = 4;
            for (let i = 0; i < n; i++) {
                const t = 0.45 + (i / n) * 0.55;
                const x = cx - side * rx + 2 * rx * side * t * 0.5 * 2 / 2;
                const px = cx + side * rx * (t * 2 - 1), py = cy + S.h * 0.16 * (1 - (2 * t - 1) * (2 * t - 1)) * 2;
                g.beginPath();
                g.moveTo(px, py);
                g.lineTo(px + side * (8 + i * 2), py + 12 + (lash === 'long' ? 6 : 0));
                g.stroke();
            }
        }
        return;
    }
    // Sclera, clipped iris, pupil, highlights
    g.save();
    eyeOutline(g, cx, cy, side, S);
    g.clip();
    g.fillStyle = '#f7fbff';
    g.fillRect(cx - S.w, cy - S.h, S.w * 2, S.h * 2);
    const sh = g.createLinearGradient(0, cy - S.h / 2, 0, cy + S.h * 0.1);
    sh.addColorStop(0, 'rgba(70,50,90,0.38)');
    sh.addColorStop(1, 'rgba(70,50,90,0)');
    g.fillStyle = sh;
    g.fillRect(cx - S.w, cy - S.h, S.w * 2, S.h * 1.4);
    const ir = (S.h / 2) * S.iris * 1.02;
    const icx = cx - side * S.w * 0.015, icy = cy + S.h * 0.02;
    const ig = g.createRadialGradient(icx, icy + ir * 0.2, ir * 0.15, icx, icy, ir);
    ig.addColorStop(0, hex(shade(look.eyeColor, 0.35)));
    ig.addColorStop(0.55, hex(look.eyeColor));
    ig.addColorStop(1, hex(shade(look.eyeColor, -0.5)));
    g.fillStyle = ig;
    g.beginPath();
    g.arc(icx, icy, ir, 0, Math.PI * 2);
    g.fill();
    // iris fibres
    g.strokeStyle = hex(shade(look.eyeColor, 0.4)) + '66';
    g.lineWidth = 1.5;
    for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        g.beginPath();
        g.moveTo(icx + Math.cos(a) * ir * 0.35, icy + Math.sin(a) * ir * 0.35);
        g.lineTo(icx + Math.cos(a) * ir * 0.9, icy + Math.sin(a) * ir * 0.9);
        g.stroke();
    }
    g.fillStyle = '#120a16';
    g.beginPath();
    g.arc(icx, icy, ir * 0.42, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.96)';
    g.beginPath();
    g.arc(icx - ir * 0.36, icy - ir * 0.38, ir * 0.3, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(icx + ir * 0.34, icy + ir * 0.4, ir * 0.13, 0, Math.PI * 2);
    g.fill();
    if (look.eyeShape === 'star' || look.eyeShape === 'big') {
        // a twinkle
        const tx = icx + ir * 0.05, ty = icy - ir * 0.62, r = ir * 0.2;
        g.beginPath();
        g.moveTo(tx, ty - r); g.lineTo(tx + r * 0.25, ty - r * 0.25); g.lineTo(tx + r, ty); g.lineTo(tx + r * 0.25, ty + r * 0.25);
        g.lineTo(tx, ty + r); g.lineTo(tx - r * 0.25, ty + r * 0.25); g.lineTo(tx - r, ty); g.lineTo(tx - r * 0.25, ty - r * 0.25);
        g.closePath();
        g.fill();
    }
    if (look.eyeShape === 'sleepy') {
        // heavy lid
        g.fillStyle = hex(shade(look.skin, -0.04));
        g.fillRect(cx - S.w, cy - S.h, S.w * 2, S.h * 0.55);
    }
    g.restore();
    // Upper lid line, thicker towards the outer corner
    const lw = liner ? 11 : lash === 'none' ? 6 : 8;
    g.strokeStyle = liner || lash !== 'none' ? '#1e1322' : DARK;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let k = 0; k < 3; k++) {
        const a = k / 3, b = (k + 1) / 3 + 0.02;
        g.lineWidth = lw * (0.55 + 0.65 * (k + 1) / 3);
        g.beginPath();
        let p = pointOnUpperLid(cx, cy, side, S, a);
        g.moveTo(p[0], p[1]);
        for (let s = 1; s <= 8; s++) {
            p = pointOnUpperLid(cx, cy, side, S, a + (b - a) * s / 8);
            g.lineTo(p[0], p[1]);
        }
        g.stroke();
    }
    // Lashes: flicks along the outer half
    if (lash !== 'none' || liner) {
        const n = lash === 'long' ? 6 : lash === 'natural' ? 3 : 2;
        g.lineWidth = lash === 'long' ? 5 : 4;
        for (let i = 0; i < n; i++) {
            const t = 0.5 + (i / Math.max(1, n - 1)) * 0.5;
            const p = pointOnUpperLid(cx, cy, side, S, t);
            const len = (lash === 'long' ? 22 : 13) * (0.7 + t * 0.5);
            g.beginPath();
            g.moveTo(p[0], p[1]);
            g.quadraticCurveTo(p[0] + side * len * 0.4, p[1] - len * 0.5, p[0] + side * len * 0.95, p[1] - len * 0.55 + i);
            g.stroke();
        }
    }
    if (liner) {
        // winged tip
        const p = pointOnUpperLid(cx, cy, side, S, 1);
        g.lineWidth = 8;
        g.beginPath();
        g.moveTo(p[0] - side * 18, p[1] + 2);
        g.quadraticCurveTo(p[0] + side * 12, p[1] - 4, p[0] + side * (look.eyeShape === 'cat' ? 38 : 26), p[1] - (look.eyeShape === 'cat' ? 26 : 14));
        g.stroke();
    }
    // Soft lower lash line
    g.strokeStyle = 'rgba(42,28,46,0.38)';
    g.lineWidth = 3;
    g.beginPath();
    const rx = S.w / 2, ry = S.h / 2;
    g.moveTo(cx - side * rx * 0.55, cy + ry * S.bot * 0.72);
    g.bezierCurveTo(cx - side * rx * 0.2, cy + ry * S.bot * 1.02, cx + side * rx * 0.3, cy + ry * S.bot * 0.96, cx + side * rx * 0.9, cy + ry * 0.22);
    g.stroke();
}

function drawBrow(g, cx, side, look) {
    if (look.brows === 'none') return;
    const col = hex(shade(look.hairColor, -0.35));
    const thick = look.brows === 'thick' ? 16 : look.brows === 'arched' ? 9 : 11;
    const lift = look.brows === 'arched' ? 26 : look.brows === 'thick' ? 10 : 14;
    const x0 = cx - side * 66, x1 = cx + side * 74;
    const y0 = BROW_Y + 8, y1 = BROW_Y - lift * 0.4 + (look.eyeShape === 'cat' ? -10 : 0);
    g.strokeStyle = col;
    g.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
        // taper: thick at the inner end, thin at the tip
        const a = k / 3, b = (k + 1) / 3;
        g.lineWidth = thick * (1 - a * 0.55);
        g.beginPath();
        const f = (t) => {
            const x = x0 + (x1 - x0) * t;
            const y = y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * lift;
            return [x, y];
        };
        let p = f(a);
        g.moveTo(p[0], p[1]);
        for (let s = 1; s <= 6; s++) {
            p = f(a + (b - a) * s / 6);
            g.lineTo(p[0], p[1]);
        }
        g.stroke();
    }
}

function drawMouth(g, look, talk) {
    const cx = FACE_W / 2, y = MOUTH_Y;
    const W = { smile: 86, soft: 62, grin: 104, pout: 58 }[look.mouth] || 80;
    const natural = lerpColor(look.skin, 0xd0506a, look.male ? 0.25 : 0.42);
    const lc = look.lipstick != null ? look.lipstick : natural;
    const up = look.mouth === 'grin' ? 14 : look.mouth === 'smile' ? 9 : 3;
    const full = look.mouth === 'pout' ? 1.45 : 1;
    if (talk) {
        const open = 26;
        g.fillStyle = '#4a1624';
        g.beginPath();
        g.moveTo(cx - W / 2, y - up * 0.3);
        g.quadraticCurveTo(cx, y - 8, cx + W / 2, y - up * 0.3);
        g.quadraticCurveTo(cx + W * 0.35, y + open * 1.4, cx, y + open * 1.5);
        g.quadraticCurveTo(cx - W * 0.35, y + open * 1.4, cx - W / 2, y - up * 0.3);
        g.fill();
        g.save();
        g.clip();
        g.fillStyle = '#ffffff';
        g.fillRect(cx - W / 2, y - 14, W, 12);
        g.fillStyle = '#ee7e92';
        g.beginPath();
        g.ellipse(cx, y + open * 1.4, W * 0.28, open * 0.55, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
        g.strokeStyle = hex(shade(lc, -0.25));
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(cx - W / 2, y - up * 0.3);
        g.quadraticCurveTo(cx, y - 10, cx + W / 2, y - up * 0.3);
        g.stroke();
        g.strokeStyle = hex(lc);
        g.lineWidth = 7;
        g.beginPath();
        g.moveTo(cx - W * 0.46, y + 6 + open * 0.9);
        g.quadraticCurveTo(cx, y + open * 1.9, cx + W * 0.46, y + 6 + open * 0.9);
        g.stroke();
        return;
    }
    // upper lip
    g.fillStyle = hex(lc);
    g.beginPath();
    g.moveTo(cx - W / 2, y - up);
    g.quadraticCurveTo(cx - W * 0.25, y - 14 * full - up * 0.4, cx, y - 6);
    g.quadraticCurveTo(cx + W * 0.25, y - 14 * full - up * 0.4, cx + W / 2, y - up);
    g.quadraticCurveTo(cx, y + 3 + (look.mouth === 'grin' ? 4 : 0), cx - W / 2, y - up);
    g.fill();
    // lower lip
    g.fillStyle = hex(shade(lc, 0.08));
    g.beginPath();
    g.moveTo(cx - W / 2, y - up);
    g.quadraticCurveTo(cx, y + 3, cx + W / 2, y - up);
    g.quadraticCurveTo(cx + W * 0.1, y + (look.mouth === 'grin' ? 18 : 24) * full + 4, cx, y + (look.mouth === 'grin' ? 18 : 24) * full + 4);
    g.quadraticCurveTo(cx - W * 0.1, y + (look.mouth === 'grin' ? 18 : 24) * full + 4, cx - W / 2, y - up);
    g.fill();
    // line, corners and gloss
    g.strokeStyle = hex(shade(lc, -0.45));
    g.lineWidth = 4;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - W / 2, y - up);
    g.quadraticCurveTo(cx, y + 3 + (look.mouth === 'grin' ? 5 : 0), cx + W / 2, y - up);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    g.ellipse(cx - W * 0.1, y + 13 * full, W * 0.13, 4, -0.12, 0, Math.PI * 2);
    g.fill();
    if (look.mouth === 'grin') {
        g.fillStyle = 'rgba(255,255,255,0.88)';
        g.beginPath();
        g.moveTo(cx - W * 0.36, y - up * 0.4);
        g.quadraticCurveTo(cx, y + 1, cx + W * 0.36, y - up * 0.4);
        g.quadraticCurveTo(cx, y + 11, cx - W * 0.36, y - up * 0.4);
        g.fill();
    }
}

function star(g, x, y, r, color) {
    g.fillStyle = color;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * 0.42;
        if (i === 0) g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        else g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
}

function heart(g, x, y, s, color) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x, y + s * 0.35);
    g.bezierCurveTo(x - s, y - s * 0.3, x - s * 0.4, y - s, x, y - s * 0.35);
    g.bezierCurveTo(x + s * 0.4, y - s, x + s, y - s * 0.3, x, y + s * 0.35);
    g.fill();
}

function drawPaint(g, look) {
    const tc = TAIL_COLORS[look.tail % TAIL_COLORS.length] || TAIL_COLORS[0];
    const kind = look.facePaint;
    if (!kind || kind === 'none') return;
    const rnd = mulberry32(77);
    for (const s of [-1, 1]) {
        const cx = FACE_W / 2 + s * 168, cy = 250;
        if (kind === 'stars') {
            star(g, cx, cy, 20, '#fff4a8');
            star(g, cx + s * 30, cy - 34, 11, hex(tc.a));
            star(g, cx - s * 6, cy + 36, 9, hex(tc.b));
        } else if (kind === 'waves') {
            g.strokeStyle = hex(tc.a);
            g.lineWidth = 7;
            g.lineCap = 'round';
            for (let k = 0; k < 3; k++) {
                g.beginPath();
                for (let i = 0; i <= 10; i++) {
                    const x = cx - s * 26 + s * i * 8, y = cy - 22 + k * 20 + Math.sin(i * 1.1 + k) * 7;
                    if (i === 0) g.moveTo(x, y);
                    else g.lineTo(x, y);
                }
                g.stroke();
                g.strokeStyle = hex(tc.b);
            }
        } else if (kind === 'shells') {
            g.fillStyle = hex(tc.a) + 'dd';
            g.beginPath();
            g.arc(cx, cy, 24, Math.PI, 0);
            g.lineTo(cx + 24, cy + 6);
            g.lineTo(cx - 24, cy + 6);
            g.fill();
            g.strokeStyle = '#ffffffaa';
            g.lineWidth = 2.5;
            for (let i = -2; i <= 2; i++) {
                g.beginPath();
                g.moveTo(cx, cy + 6);
                g.lineTo(cx + i * 10, cy - 20);
                g.stroke();
            }
        } else if (kind === 'hearts') {
            heart(g, cx, cy - 4, 22, '#ff6b81');
            heart(g, cx + s * 28, cy + 28, 12, '#ff9ff3');
        } else if (kind === 'tears') {
            for (let i = 0; i < 3; i++) {
                const x = FACE_W / 2 + s * (EYE_DX + 28 - i * 14), y = EYE_Y + 78 + i * 38, r = 11 - i * 2;
                const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
                gr.addColorStop(0, '#ffffff');
                gr.addColorStop(1, '#bfe9ff');
                g.fillStyle = gr;
                g.beginPath();
                g.arc(x, y, r, 0, Math.PI * 2);
                g.fill();
            }
        } else if (kind === 'band' && s === 1) {
            for (let i = 0; i < 90; i++) {
                const x = 60 + rnd() * (FACE_W - 120), y = 226 + (rnd() - 0.5) * 46 + Math.sin(x * 0.02) * 6;
                g.fillStyle = [hex(tc.a), hex(tc.b), '#ffffff', '#fff4a8'][Math.floor(rnd() * 4)];
                g.globalAlpha = 0.6 + rnd() * 0.4;
                g.beginPath();
                g.arc(x, y, 1.5 + rnd() * 3, 0, Math.PI * 2);
                g.fill();
            }
            g.globalAlpha = 1;
        }
    }
}

/** Draws one frame of the face onto a 2d context. state: 'open' | 'blink' | 'talk'. */
export function drawFace(g, look, state = 'open') {
    g.clearRect(0, 0, FACE_W, FACE_H);
    const cx = FACE_W / 2;
    // Blush
    if (look.blush != null) {
        for (const s of [-1, 1]) {
            const bx = cx + s * 150, by = 262;
            const gr = g.createRadialGradient(bx, by, 4, bx, by, 68);
            gr.addColorStop(0, hex(look.blush) + 'aa');
            gr.addColorStop(1, hex(look.blush) + '00');
            g.fillStyle = gr;
            g.beginPath();
            g.ellipse(bx, by, 72, 52, 0, 0, Math.PI * 2);
            g.fill();
        }
    }
    // Freckles
    if (look.freckles) {
        const rnd = mulberry32(9);
        g.fillStyle = 'rgba(150,90,60,0.5)';
        for (let i = 0; i < 28; i++) {
            const s = i % 2 ? 1 : -1;
            const x = cx + s * (20 + rnd() * 150), y = 236 + rnd() * 52 - Math.abs(x - cx) * 0.06;
            g.beginPath();
            g.arc(x, y, 2 + rnd() * 3, 0, Math.PI * 2);
            g.fill();
        }
    }
    drawPaint(g, look);
    for (const s of [-1, 1]) drawEye(g, cx + s * EYE_DX, EYE_Y, s, look, state === 'blink');
    for (const s of [-1, 1]) drawBrow(g, cx + s * EYE_DX, s, look);
    // Nose: a soft shadow and tip
    const ng = g.createRadialGradient(cx, 262, 2, cx, 262, 30);
    ng.addColorStop(0, 'rgba(120,60,60,0.32)');
    ng.addColorStop(1, 'rgba(120,60,60,0)');
    g.fillStyle = ng;
    g.beginPath();
    g.ellipse(cx, 264, 30, 18, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(100,50,50,0.38)';
    for (const s of [-1, 1]) {
        g.beginPath();
        g.ellipse(cx + s * 11, 270, 4.5, 3, 0, 0, Math.PI * 2);
        g.fill();
    }
    drawMouth(g, look, state === 'talk');
    if (look.glitter) {
        const rnd = mulberry32(31);
        for (let i = 0; i < 70; i++) {
            const x = 70 + rnd() * (FACE_W - 140), y = 90 + rnd() * (FACE_H - 150);
            g.fillStyle = rnd() < 0.5 ? '#ffffff' : '#ffe9a8';
            g.globalAlpha = 0.5 + rnd() * 0.5;
            g.beginPath();
            g.arc(x, y, 1 + rnd() * 2.4, 0, Math.PI * 2);
            g.fill();
        }
        g.globalAlpha = 1;
    }
}

const _faceCache = new Map();
/** { open, blink, talk } textures for a look (shared between mermaids with the same face). */
export function faceTextures(look) {
    const key = [look.skin, look.eyeColor, look.eyeShape, look.brows, look.lashes, look.mouth, look.freckles, look.lipstick,
        look.eyeshadow, look.eyeliner, look.blush, look.facePaint, look.glitter, look.hairColor, look.male ? 1 : 0, look.tail].join('|');
    let t = _faceCache.get(key);
    if (!t) {
        t = {};
        for (const state of ['open', 'blink', 'talk']) {
            const tex = canvasTexture(FACE_W, FACE_H, (g) => drawFace(g, look, state));
            tex.anisotropy = 8;
            t[state] = tex;
        }
        _faceCache.set(key, t);
    }
    return t;
}

// ================================================================================================
// Tail scales
// ================================================================================================
const _scaleCache = new Map();
/** A tileable scale texture (greyscale, multiplied by the segment colour). */
export function scaleTexture(pattern) {
    if (pattern === 'plain') return null;
    let t = _scaleCache.get(pattern);
    if (t) return t;
    t = canvasTexture(256, 256, (g, w, h) => {
        g.fillStyle = '#d9d9d9';
        g.fillRect(0, 0, w, h);
        const rnd = mulberry32(5);
        if (pattern === 'spots') {
            g.fillStyle = '#c4c4c4';
            for (let i = 0; i < 26; i++) {
                const x = rnd() * w, y = rnd() * h, r = 7 + rnd() * 16;
                const gr = g.createRadialGradient(x, y, 1, x, y, r);
                gr.addColorStop(0, 'rgba(255,255,255,0.95)');
                gr.addColorStop(1, 'rgba(255,255,255,0)');
                g.fillStyle = gr;
                for (const dx of [-w, 0, w]) {
                    g.beginPath();
                    g.arc(x + dx, y, r, 0, Math.PI * 2);
                    g.fill();
                }
            }
        }
        // overlapping scales: rows of scallops, lighter on the lower rim
        const cols = 6, rows = 6;
        const sw = w / cols, sh = h / rows;
        for (let r = -1; r < rows + 1; r++) {
            for (let c = -1; c < cols + 1; c++) {
                const x = c * sw + (r % 2 ? sw / 2 : 0) + sw / 2, y = r * sh + sh * 0.7;
                const gr = g.createRadialGradient(x, y - sh * 0.15, sw * 0.1, x, y, sw * 0.62);
                gr.addColorStop(0, 'rgba(255,255,255,0.0)');
                gr.addColorStop(0.7, 'rgba(120,120,140,0.05)');
                gr.addColorStop(1, pattern === 'stripes' ? 'rgba(90,90,110,0.18)' : 'rgba(60,60,90,0.42)');
                g.fillStyle = gr;
                g.beginPath();
                g.arc(x, y, sw * 0.62, 0, Math.PI * 2);
                g.fill();
                g.strokeStyle = 'rgba(255,255,255,0.55)';
                g.lineWidth = 2;
                g.beginPath();
                g.arc(x, y, sw * 0.55, Math.PI * 0.12, Math.PI * 0.88);
                g.stroke();
            }
        }
    }, { repeat: [2, 1.4] });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    _scaleCache.set(pattern, t);
    return t;
}

// ================================================================================================
// Fin-like panels: tail fins, ears, wings, capes, skirts (one plane with an alpha cut-out)
// ================================================================================================
const _panelCache = new Map();

/**
 * kind: 'fin_classic' | 'fin_ruffle' | 'fin_double' | 'fin_sword' | 'fin_fan' | 'fin_whale' | 'ear' | 'wing' | 'cape_fin' | 'kelp' | 'veil' | 'sash'
 * a, b: gradient colours (top, edge). The panel hangs from its top centre: u 0..1 across, v 1 (top) to 0 (bottom).
 */
export function panelTexture(kind, a, b, glow = false) {
    const key = `${kind}|${a}|${b}|${glow ? 1 : 0}`;
    let t = _panelCache.get(key);
    if (t) return t;
    const W = 256, H = 256;
    t = canvasTexture(W, H, (g) => {
        g.clearRect(0, 0, W, H);
        const grad = g.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, hex(shade(a, 0.05)) + 'f2');
        grad.addColorStop(0.55, hex(lerpColor(a, b, 0.6)) + 'e0');
        grad.addColorStop(1, hex(shade(b, 0.25)) + 'b0');
        g.fillStyle = grad;
        g.strokeStyle = 'rgba(255,255,255,0.45)';
        g.lineWidth = 2;
        const veins = (fx, fy, count, spread, len) => {
            g.save();
            g.strokeStyle = 'rgba(255,255,255,0.38)';
            g.lineWidth = 2.2;
            for (let i = 0; i < count; i++) {
                const k = count === 1 ? 0 : i / (count - 1) - 0.5;
                g.beginPath();
                g.moveTo(fx, fy);
                g.quadraticCurveTo(fx + k * spread * 0.5, fy + len * 0.5, fx + k * spread, fy + len);
                g.stroke();
            }
            g.restore();
        };
        const shapeFin = () => {
            g.beginPath();
            g.moveTo(W / 2 - 14, 0);
            g.lineTo(W / 2 + 14, 0);
            g.bezierCurveTo(W * 0.78, H * 0.12, W * 0.99, H * 0.5, W * 0.9, H * 0.96);
            g.bezierCurveTo(W * 0.74, H * 0.78, W * 0.6, H * 0.8, W / 2, H * 0.58);
            g.bezierCurveTo(W * 0.4, H * 0.8, W * 0.26, H * 0.78, W * 0.1, H * 0.96);
            g.bezierCurveTo(W * 0.01, H * 0.5, W * 0.22, H * 0.12, W / 2 - 14, 0);
            g.closePath();
        };
        if (kind === 'fin_classic') {
            shapeFin();
            g.fill();
            veins(W / 2, 4, 7, W * 0.78, H * 0.9);
        } else if (kind === 'fin_ruffle') {
            g.beginPath();
            g.moveTo(W / 2 - 12, 0);
            g.lineTo(W / 2 + 12, 0);
            g.bezierCurveTo(W * 0.8, H * 0.1, W * 0.98, H * 0.45, W * 0.9, H * 0.9);
            for (let i = 0; i <= 14; i++) {
                const x = W * 0.9 - (W * 0.8) * (i / 14);
                const y = H * (0.93 - Math.sin((i / 14) * Math.PI) * 0.26) + (i % 2 ? 9 : -9);
                g.lineTo(x, y);
            }
            g.bezierCurveTo(W * 0.02, H * 0.45, W * 0.2, H * 0.1, W / 2 - 12, 0);
            g.closePath();
            g.fill();
            veins(W / 2, 4, 9, W * 0.8, H * 0.86);
        } else if (kind === 'fin_double') {
            for (const [y0, s] of [[0, 1], [H * 0.18, 0.85]]) {
                g.save();
                g.translate(0, y0);
                g.scale(1, s);
                shapeFin();
                g.fill();
                g.restore();
            }
            veins(W / 2, 4, 5, W * 0.7, H * 0.8);
        } else if (kind === 'fin_sword') {
            shapeFin();
            g.fill();
            g.fillStyle = hex(shade(b, 0.2)) + 'ee';
            g.beginPath();
            g.moveTo(W / 2 - 6, H * 0.4);
            g.lineTo(W / 2 + 6, H * 0.4);
            g.lineTo(W / 2 + 1, H);
            g.lineTo(W / 2 - 1, H);
            g.closePath();
            g.fill();
            veins(W / 2, 4, 5, W * 0.7, H * 0.85);
        } else if (kind === 'fin_fan') {
            g.beginPath();
            g.moveTo(W / 2 - 8, 0);
            g.lineTo(W / 2 + 8, 0);
            g.bezierCurveTo(W * 0.92, H * 0.18, W * 1.0, H * 0.7, W * 0.62, H * 0.98);
            g.quadraticCurveTo(W / 2, H * 1.02, W * 0.38, H * 0.98);
            g.bezierCurveTo(0, H * 0.7, W * 0.08, H * 0.18, W / 2 - 8, 0);
            g.closePath();
            g.fill();
            veins(W / 2, 4, 11, W * 0.95, H * 0.94);
        } else if (kind === 'fin_whale') {
            g.beginPath();
            g.moveTo(W / 2 - 10, 0);
            g.lineTo(W / 2 + 10, 0);
            g.bezierCurveTo(W * 0.74, H * 0.05, W * 0.92, H * 0.3, W * 0.99, H * 0.62);
            g.bezierCurveTo(W * 0.78, H * 0.5, W * 0.6, H * 0.5, W / 2, H * 0.7);
            g.bezierCurveTo(W * 0.4, H * 0.5, W * 0.22, H * 0.5, W * 0.01, H * 0.62);
            g.bezierCurveTo(W * 0.08, H * 0.3, W * 0.26, H * 0.05, W / 2 - 10, 0);
            g.closePath();
            g.fill();
            veins(W / 2, 4, 5, W * 0.7, H * 0.55);
        } else if (kind === 'ear') {
            g.beginPath();
            g.moveTo(W * 0.15, H * 0.12);
            g.bezierCurveTo(W * 0.5, 0, W * 0.9, H * 0.25, W * 0.98, H * 0.8);
            g.bezierCurveTo(W * 0.66, H * 0.62, W * 0.4, H * 0.68, W * 0.15, H * 0.9);
            g.closePath();
            g.fill();
            veins(W * 0.14, H * 0.5, 5, H * 0.5, W * 0.8);
        } else if (kind === 'wing') {
            g.beginPath();
            g.moveTo(W * 0.04, H * 0.06);
            g.bezierCurveTo(W * 0.4, -H * 0.04, W * 0.9, H * 0.12, W * 0.98, H * 0.52);
            g.bezierCurveTo(W * 0.8, H * 0.42, W * 0.74, H * 0.6, W * 0.7, H * 0.78);
            g.bezierCurveTo(W * 0.52, H * 0.55, W * 0.34, H * 0.7, W * 0.2, H * 0.98);
            g.bezierCurveTo(W * 0.12, H * 0.7, W * 0.02, H * 0.4, W * 0.04, H * 0.06);
            g.closePath();
            g.fill();
            veins(W * 0.06, H * 0.12, 8, W * 0.92, W * 0.82);
        } else if (kind === 'cape_fin') {
            g.beginPath();
            g.moveTo(W * 0.3, 0);
            g.bezierCurveTo(W * 0.7, H * 0.1, W * 1.0, H * 0.5, W * 0.82, H * 0.98);
            g.bezierCurveTo(W * 0.5, H * 0.7, W * 0.25, H * 0.5, W * 0.18, H * 0.2);
            g.closePath();
            g.fill();
            veins(W * 0.3, 4, 6, W * 0.7, H * 0.9);
        } else if (kind === 'kelp') {
            g.beginPath();
            g.moveTo(W * 0.3, 0);
            g.lineTo(W * 0.7, 0);
            for (let i = 0; i <= 12; i++) {
                const y = H * (i / 12);
                g.lineTo(W * (0.72 + Math.sin(i * 0.9) * 0.1), y);
            }
            for (let i = 12; i >= 0; i--) {
                const y = H * (i / 12);
                g.lineTo(W * (0.28 - Math.sin(i * 0.9 + 1) * 0.1), y);
            }
            g.closePath();
            g.fill();
            g.strokeStyle = 'rgba(255,255,255,0.28)';
            g.beginPath();
            g.moveTo(W / 2, 0);
            g.lineTo(W / 2, H);
            g.stroke();
        } else if (kind === 'veil') {
            g.fillStyle = hex(a) + '88';
            g.beginPath();
            g.moveTo(W * 0.25, 0);
            g.lineTo(W * 0.75, 0);
            g.bezierCurveTo(W * 1.0, H * 0.4, W * 0.98, H * 0.8, W * 0.9, H);
            g.lineTo(W * 0.1, H);
            g.bezierCurveTo(W * 0.02, H * 0.8, 0, H * 0.4, W * 0.25, 0);
            g.fill();
            g.fillStyle = '#ffffffcc';
            const rnd = mulberry32(3);
            for (let i = 0; i < 40; i++) {
                g.beginPath();
                g.arc(W * (0.12 + rnd() * 0.76), H * (0.1 + rnd() * 0.88), 1.6 + rnd() * 2.2, 0, Math.PI * 2);
                g.fill();
            }
        } else if (kind === 'sash') {
            g.beginPath();
            g.moveTo(W * 0.3, 0);
            g.lineTo(W * 0.7, 0);
            g.lineTo(W * 0.8, H);
            g.lineTo(W * 0.5, H * 0.92);
            g.lineTo(W * 0.2, H);
            g.closePath();
            g.fill();
        } else {
            g.fillRect(0, 0, W, H);
        }
        if (glow) {
            g.globalCompositeOperation = 'source-atop';
            const gr = g.createLinearGradient(0, 0, 0, H);
            gr.addColorStop(0, 'rgba(255,255,255,0)');
            gr.addColorStop(1, hex(shade(b, 0.4)) + 'cc');
            g.fillStyle = gr;
            g.fillRect(0, 0, W, H);
            g.globalCompositeOperation = 'source-over';
        }
    });
    t.anisotropy = 4;
    _panelCache.set(key, t);
    return t;
}
