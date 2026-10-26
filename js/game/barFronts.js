/**
 * js/game/barFronts.js
 *
 * The street fronts of the downtown bars, modelled on photos of the real buildings (Howard's
 * brown awning and letter boards, Liquid's grey box and lightbox sign, the Brathaus' boarded
 * orange windows, shingle roofs and lederhosen man, Downtown / Uptown's maroon barrel awnings
 * under three storeys of red brick, Vice & Video's studded white panels, Bar 149's charcoal
 * front with the oval sign, Doc's weathered siding and black canopy, Tubby's ribbed black
 * front and yellow arch, the Cla-Zel's pink marquee under its terra-cotta arches, the
 * Fishbowl's blue brick and awning, Shots Inc.'s little awning, and City Tap with The Attic's
 * rooftop patio).
 *
 * FRONTS[name] describes one front (the storefront's ground bar, or its upstairs bar if it has
 * no ground one): where its door is (`door`, 0..1 across the front from the left as you face
 * it, and `doorW`), how tall the building is (`height`, `levels`), the wall finishes
 * (`ground` / `upper`), and the doors, windows, awnings, signs, letter boards, lamps, bands and
 * upper-storey windows on it; `extra(h)` builds anything one of a kind. buildFront() (called
 * from bars.js buildShell) turns it into geometry in the storefront's local frame: +x out to
 * the street, the front wall from x = -T to 0, z across the front with +z on your left as you
 * face the building.
 */

import * as THREE from 'three';
import {
    canvasTex, mat, rng, brickTex, paintTex, panelTex, neonTex, upperWindowTex, posterTex,
    sidingTex, battenTex, ribbedTex, quiltedTex, stoneTex, shingleTex, ornamentTex, glassBlockTex
} from './barKit.js';

const PI = Math.PI;
const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');
const FONT = '"Arial Black", "Segoe UI", Arial, sans-serif';
const SLAB = '"Rockwell Extra Bold", Rockwell, "Arial Black", Georgia, serif';
const SCRIPT = '"Brush Script MT", "Segoe Script", Georgia, serif';
const GOTHIC = '"Old English Text MT", "UnifrakturMaguntia", "Blackletter", Georgia, serif';
const CAPS = '"Copperplate Gothic Bold", "Copperplate", "Arial Black", serif';

// ------------------------------------------------------------------------------------------------
// Materials (outside, so they barely glow; signs are unlit so they read at night)
// ------------------------------------------------------------------------------------------------
const M = {
    color: (c, glow = 0.06) => mat(`fc_${c}`, { color: c, glow }),
    tex: (key, map, glow = 0.06, extra = {}) => mat(key, { map, glow, ...extra }),
    sign: (key, map) => mat(key, { map, basic: true, transparent: true }),
    paint: (key, map) => mat(key, { map, glow: 0.12, transparent: true }),
    cutout: (key, map) => mat(key, { map, glow: 0.08, transparent: true, side: THREE.DoubleSide }),
    glass: () => mat('glass', { color: 0x9fc8d8, transparent: true, opacity: 0.28, rough: 0.05, metal: 0.3, glow: 0 }),
    tint: () => mat('tintglass', { color: 0x1e2830, transparent: true, opacity: 0.6, rough: 0.05, metal: 0.4, glow: 0 }),
    bulb: () => mat('bulb', { color: 0xffe2a8, basic: true })
};

function wallMat(w) {
    const c = w.color;
    switch (w.kind) {
        case 'brick': return { m: M.tex(`fbrick_${c}_${w.mortar}`, brickTex(c, w.mortar !== undefined ? w.mortar : 0xb8ada0)), tile: [1.2, 0.6] };
        case 'siding': return { m: M.tex(`fsiding_${c}_${w.boards}`, sidingTex(c, w.boards || 6)), tile: [2, 1] };
        case 'batten': return { m: M.tex(`fbatten_${c}`, battenTex(c)), tile: [1.2, 1.2] };
        case 'ribbed': return { m: M.tex(`fribbed_${c}`, ribbedTex(c), 0.04, { metal: 0.45, rough: 0.45 }), tile: [1, 1] };
        case 'quilted': return { m: M.tex(`fquilt_${c}`, quiltedTex(c), 0.08), tile: [0.6, 0.6] };
        case 'stone': return { m: M.tex(`fstone_${c}`, stoneTex(c)), tile: [1.2, 0.6] };
        default: return { m: M.tex(`fpaint_${c}`, paintTex(c)), tile: [2, 2] };
    }
}

// ------------------------------------------------------------------------------------------------
// Artwork (canvas)
// ------------------------------------------------------------------------------------------------
/** Transparent canvas texture (signs, letters, cut-out shapes). */
function art(key, w, h, draw) {
    return canvasTex(key, w, h, (g) => { g.clearRect(0, 0, w, h); draw(g, w, h); }, { repeat: false, transparent: true });
}
/** Opaque canvas texture that isn't tiled. */
function card(key, w, h, draw) {
    return canvasTex(key, w, h, draw, { repeat: false });
}
function fit(g, text, maxW, size, font, weight = 'bold') {
    g.font = `${weight} ${size}px ${font}`;
    while (g.measureText(text).width > maxW && size > 8) { size -= 2; g.font = `${weight} ${size}px ${font}`; }
    return size;
}
function centered(g) { g.textAlign = 'center'; g.textBaseline = 'middle'; }
/** Text bent round an arc centred at (cx, cy): `a0`..`a1` radians from straight up. */
function arcText(g, text, cx, cy, r, a0, a1, fill, stroke = null, lw = 0) {
    const chars = [...text];
    chars.forEach((ch, i) => {
        const a = chars.length > 1 ? a0 + (a1 - a0) * i / (chars.length - 1) : (a0 + a1) / 2;
        g.save();
        g.translate(cx + Math.sin(a) * r, cy - Math.cos(a) * r);
        g.rotate(a);
        if (stroke) { g.lineWidth = lw; g.strokeStyle = stroke; g.lineJoin = 'round'; g.strokeText(ch, 0, 0); }
        g.fillStyle = fill; g.fillText(ch, 0, 0);
        g.restore();
    });
}

/** Painted / applied letters on a transparent ground. */
function lettersTex(text, color, { font = FONT, outline = null, lw = 8, weight = 'bold', w = 1024, h = 192, shadow = null } = {}) {
    return art(`fl_${text}_${color}_${font}_${outline}_${weight}_${w}_${h}_${shadow}`, w, h, (g) => {
        centered(g);
        fit(g, text, w - 30, h * 0.78, font, weight);
        if (shadow !== null) { g.fillStyle = hex(shadow); g.fillText(text, w / 2 + 5, h / 2 + 7); }
        if (outline !== null) { g.lineJoin = 'round'; g.lineWidth = lw; g.strokeStyle = hex(outline); g.strokeText(text, w / 2, h / 2); }
        g.fillStyle = hex(color); g.fillText(text, w / 2, h / 2);
    });
}
/** A changeable-letter board (white, black letters, aluminium frame). */
function letterBoardTex(lines, { bg = 0xeeebe2, fg = 0x111111, font = FONT } = {}) {
    const h = 64 * Math.max(2, lines.length) + 24;
    return card(`fboard_${lines.join('|')}_${bg}_${fg}`, 512, h, (g, w) => {
        g.fillStyle = hex(bg); g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 1;
        for (let y = 12; y < h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
        g.strokeStyle = '#8a8c8e'; g.lineWidth = 12; g.strokeRect(6, 6, w - 12, h - 12);
        centered(g);
        g.fillStyle = hex(fg);
        const lh = (h - 24) / lines.length;
        lines.forEach((t, i) => { fit(g, t, w - 50, lh * 0.72, font); g.fillText(t, w / 2, 12 + lh * (i + 0.5)); });
    });
}
/** Panelled door seen from the street. */
function doorTex(style, color) {
    return card(`fdoor_${style}_${color}`, 128, 256, (g, w, h) => {
        g.fillStyle = hex(color); g.fillRect(0, 0, w, h);
        const dark = 'rgba(0,0,0,0.28)', lite = 'rgba(255,255,255,0.18)';
        const panel = (x, y, pw, ph) => {
            g.fillStyle = dark; g.fillRect(x, y, pw, ph);
            g.fillStyle = hex(color); g.fillRect(x + 4, y + 4, pw - 8, ph - 8);
            g.fillStyle = lite; g.fillRect(x + 4, y + 4, pw - 8, 3);
        };
        if (style === 'panel6') {
            for (let c = 0; c < 2; c++) {
                panel(14 + c * 54, 14, 46, 60);
                panel(14 + c * 54, 84, 46, 74);
                panel(14 + c * 54, 168, 46, 74);
            }
        } else if (style === 'wood2') {
            for (let x = 0; x < w; x += 16) { g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x, 0, 2, h); }
            g.fillStyle = dark; g.beginPath(); g.arc(w / 2, 70, 36, PI, 0); g.lineTo(w / 2 + 36, 180); g.lineTo(w / 2 - 36, 180); g.fill();
            g.strokeStyle = '#c8a050'; g.lineWidth = 4; g.beginPath(); g.arc(w / 2, 120, 10, 0, 7); g.stroke();
        } else if (style === 'wood') {
            for (let x = 0; x < w; x += 16) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, 0, 2, h); }
            g.fillStyle = '#1a2228'; g.fillRect(w / 2 - 10, 36, 20, 110);
            g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 3; g.strokeRect(w / 2 - 12, 34, 24, 114);
        }
        g.fillStyle = style === 'flat' ? '#c8c8c8' : '#d8b860';   // handle
        g.fillRect(w - 26, h * 0.5, 8, 22);
        if (style === 'flat') { g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(8, 8, w - 16, h - 16); g.fillStyle = hex(color); g.fillRect(12, 12, w - 24, h - 24); }
    });
}
/** Half-round fanlight / arch head (white terra-cotta, brick voussoirs or a painted arch). */
function archTex(kind, color) {
    return art(`farch_${kind}_${color}`, 256, 128, (g, w, h) => {
        g.beginPath(); g.moveTo(0, h); g.arc(w / 2, h, w / 2, PI, 0); g.closePath();
        g.fillStyle = hex(color); g.fill();
        if (kind === 'brick') {
            g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;
            for (let a = PI; a <= 2 * PI + 0.01; a += PI / 12) { g.beginPath(); g.moveTo(w / 2 + Math.cos(a) * w * 0.3, h + Math.sin(a) * w * 0.3); g.lineTo(w / 2 + Math.cos(a) * w / 2, h + Math.sin(a) * w / 2); g.stroke(); }
            g.fillStyle = '#1e2630'; g.beginPath(); g.arc(w / 2, h, w * 0.3, PI, 0); g.fill();
        } else if (kind === 'white') {
            g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 3;
            for (const r of [0.48, 0.4, 0.3]) { g.beginPath(); g.arc(w / 2, h, w * r, PI, 0); g.stroke(); }
            g.fillStyle = 'rgba(0,0,0,0.18)';
            for (let i = 0; i < 9; i++) { const a = PI + PI * (i + 0.5) / 9; g.beginPath(); g.arc(w / 2 + Math.cos(a) * w * 0.35, h + Math.sin(a) * w * 0.35, 6, 0, 7); g.fill(); }
            g.beginPath(); g.ellipse(w / 2, h - 20, 26, 18, 0, 0, 7); g.fill();
        }
    });
}
/** One side of an awning: the slope as a triangle, and the valance down the front edge. */
function awningSideTex(color, valFrac, barrel) {
    return art(`fawnside_${color}_${valFrac.toFixed(2)}_${barrel}`, 128, 128, (g, w, h) => {
        const ky = h * (1 - valFrac);
        g.fillStyle = hex(color);
        g.beginPath();
        g.moveTo(0, 0);
        if (barrel) { for (let i = 1; i <= 16; i++) { const t = i / 16 * PI / 2; g.lineTo(w * Math.sin(t), ky * (1 - Math.cos(t))); } }
        else g.lineTo(w, ky);
        g.lineTo(w, h); g.lineTo(w - 8, h); g.lineTo(w - 8, ky); g.lineTo(0, ky);
        g.closePath(); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(w - 8, ky, 8, h - ky);
    });
}

const ART = {
    howards: () => art('fa_howards', 1024, 256, (g, w, h) => {
        centered(g); fit(g, "HOWARD'S", w - 40, 200, SLAB);
        g.lineJoin = 'round'; g.lineWidth = 12; g.strokeStyle = '#f4ead8'; g.strokeText("HOWARD'S", w / 2, h / 2);
        g.fillStyle = '#e8742a'; g.fillText("HOWARD'S", w / 2, h / 2);
    }),
    liquid: () => card('fa_liquid', 512, 448, (g, w, h) => {
        g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, w, h);
        const top = h * 0.46, r = rng(77);
        g.fillStyle = '#dcdcd6'; g.fillRect(14, 14, w - 28, top);
        for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(70,74,90,${r() * 0.3})`; g.fillRect(14 + r() * (w - 28), 14 + r() * top, 3, 3); }
        g.strokeStyle = '#d8d8d2'; g.lineWidth = 2;
        for (let y = top + 40; y < h - 20; y += 34) { g.beginPath(); g.moveTo(24, y); g.lineTo(w - 24, y); g.stroke(); }
        g.fillStyle = '#2a5ad0'; g.fillRect(14, top + 12, w - 28, 5);
        centered(g); fit(g, 'Liquid', w - 60, 160, '"Arial Rounded MT Bold", "Arial Black", sans-serif');
        g.fillStyle = '#10205a'; g.fillText('Liquid', w / 2 + 6, 14 + top / 2 + 8);
        g.lineWidth = 6; g.strokeStyle = '#ffffff'; g.strokeText('Liquid', w / 2, 14 + top / 2);
        g.fillStyle = '#2a4ad8'; g.fillText('Liquid', w / 2, 14 + top / 2);
        g.strokeStyle = '#2a5ad0'; g.lineWidth = 14; g.strokeRect(7, 7, w - 14, h - 14);
    }),
    brathaus: () => art('fa_brathaus', 1024, 1024, (g, w) => {
        // The name bent over the top, the man in lederhosen with his stein below
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `bold 150px ${GOTHIC}`;
        arcText(g, 'Brathaus', w / 2, 760, 560, -0.5, 0.5, '#f4ecdc', '#4a1a1a', 16);
        const cx = 520;
        g.lineJoin = 'round'; g.lineWidth = 7; g.strokeStyle = '#1a1010';
        const shape = (fill, f) => { g.fillStyle = fill; g.beginPath(); f(); g.fill(); g.stroke(); };
        shape('#111', () => { g.rect(cx - 70, 905, 58, 70); g.rect(cx + 10, 905, 58, 70); });                      // boots
        shape('#e8dcc8', () => { g.rect(cx - 62, 820, 42, 90); g.rect(cx + 16, 820, 42, 90); });                   // socks
        shape('#6a3a5a', () => { g.moveTo(cx - 80, 600); g.lineTo(cx + 80, 600); g.lineTo(cx + 70, 830); g.lineTo(cx - 70, 830); g.closePath(); });
        shape('#f0e8dc', () => { g.moveTo(cx - 80, 520); g.lineTo(cx + 80, 520); g.lineTo(cx + 80, 610); g.lineTo(cx - 80, 610); g.closePath(); });
        g.strokeStyle = '#3a1a2a'; g.lineWidth = 14;
        g.beginPath(); g.moveTo(cx - 50, 520); g.lineTo(cx - 40, 660); g.moveTo(cx + 50, 520); g.lineTo(cx + 40, 660); g.stroke();
        g.lineWidth = 7; g.strokeStyle = '#1a1010';
        shape('#f0e8dc', () => { g.moveTo(cx - 80, 530); g.lineTo(cx - 190, 470); g.lineTo(cx - 175, 440); g.lineTo(cx - 70, 500); g.closePath(); });   // arm up
        shape('#f4f0e8', () => { g.rect(cx - 290, 380, 110, 130); });                                                 // stein
        shape('#f2c040', () => { g.rect(cx - 280, 420, 90, 82); });
        shape('#ffffff', () => { g.ellipse(cx - 235, 382, 64, 26, 0, 0, 7); });
        shape('#f0b8a0', () => { g.ellipse(cx, 450, 70, 78, 0, 0, 7); });                                           // face
        shape('#ffffff', () => { g.moveTo(cx - 62, 470); g.quadraticCurveTo(cx, 590, cx + 62, 470); g.closePath(); }); // beard
        shape('#d8705a', () => { g.ellipse(cx + 8, 455, 18, 14, 0, 0, 7); });                                        // nose
        shape('#222', () => { g.ellipse(cx, 385, 92, 22, -0.12, 0, 7); });                                           // hat brim
        shape('#2a2a2a', () => { g.moveTo(cx - 58, 380); g.lineTo(cx - 40, 300); g.lineTo(cx + 46, 296); g.lineTo(cx + 60, 376); g.closePath(); });
        g.fillStyle = '#111'; g.beginPath(); g.arc(cx - 24, 430, 7, 0, 7); g.arc(cx + 26, 430, 7, 0, 7); g.fill();
    }),
    plank: (s) => card(`fa_plank_${s.text}`, 1024, 120, (g, w, h) => {
        const r = rng(9);
        const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#e2cc9a'); gr.addColorStop(1, '#c8ae78');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(90,60,20,${0.1 + r() * 0.15})`; g.beginPath(); const y = r() * h; g.moveTo(0, y); g.bezierCurveTo(w / 3, y + r() * 8 - 4, w * 2 / 3, y + r() * 8 - 4, w, y); g.stroke(); }
        g.strokeStyle = '#5a3a1a'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
        centered(g); fit(g, s.text, w - 60, 78, 'Georgia, "Times New Roman", serif');
        g.fillStyle = hex(s.fg !== undefined ? s.fg : 0xc8401a); g.fillText(s.text, w / 2, h / 2 + 4);
    }),
    downtown: () => art('fa_downtown', 512, 192, (g, w, h) => {
        g.beginPath(); g.ellipse(w / 2, h / 2, w / 2 - 6, h / 2 - 6, 0, 0, 7);
        g.fillStyle = '#f4ecdc'; g.fill(); g.lineWidth = 7; g.strokeStyle = '#5a1420'; g.stroke();
        centered(g); fit(g, 'downtown', w - 120, 92, SCRIPT, 'italic bold');
        g.fillStyle = '#3a1018'; g.fillText('downtown', w / 2, h * 0.42);
        g.font = `bold 26px ${FONT}`; g.fillText('SPORTS GRILL', w / 2, h * 0.78);
    }),
    uptown: () => art('fa_uptown', 512, 192, (g, w, h) => {
        g.strokeStyle = '#f08a2a'; g.lineWidth = 9;
        g.beginPath(); g.arc(70, h * 0.5, 36, -2.2, 1.9); g.stroke();
        g.fillStyle = '#f08a2a'; g.fillRect(64, h * 0.5 + 30, 12, 40);
        centered(g); fit(g, 'UPTOWN', w - 170, 90, FONT);
        g.fillStyle = '#ffffff'; g.fillText('UPTOWN', w / 2 + 40, h * 0.42);
        g.font = `italic bold 34px ${SCRIPT}`; g.fillText('night-club', w / 2 + 70, h * 0.8);
    }),
    vice: () => art('fa_vice', 640, 560, (g, w, h) => {
        // Scalloped badge
        const badge = (inset) => {
            const l = inset, r = w - inset, t = inset, b = h - inset;
            g.beginPath();
            g.moveTo(w / 2, t);
            g.quadraticCurveTo(w * 0.62, t + 40, w * 0.74, t + 24);
            g.quadraticCurveTo(r - 30, t + 60, r, t + 120);
            g.quadraticCurveTo(r - 24, h / 2, r, b - 120);
            g.quadraticCurveTo(r - 30, b - 60, w * 0.74, b - 24);
            g.quadraticCurveTo(w * 0.62, b - 40, w / 2, b);
            g.quadraticCurveTo(w * 0.38, b - 40, w * 0.26, b - 24);
            g.quadraticCurveTo(l + 30, b - 60, l, b - 120);
            g.quadraticCurveTo(l + 24, h / 2, l, t + 120);
            g.quadraticCurveTo(l + 30, t + 60, w * 0.26, t + 24);
            g.quadraticCurveTo(w * 0.38, t + 40, w / 2, t);
            g.closePath();
        };
        badge(8); g.fillStyle = '#b02a2a'; g.fill();
        badge(22); g.fillStyle = '#18202e'; g.fill();
        badge(34); g.strokeStyle = '#b02a2a'; g.lineWidth = 3; g.stroke();
        // Agave
        for (let i = -5; i <= 5; i++) {
            const a = i * 0.16;
            g.fillStyle = i % 2 ? '#f0a020' : '#f8d040';
            g.beginPath(); g.moveTo(w / 2 - 8, 150); g.lineTo(w / 2 + Math.sin(a) * 90 - 6, 150 - Math.cos(a) * 90); g.lineTo(w / 2 + Math.sin(a) * 90 + 6, 150 - Math.cos(a) * 90); g.lineTo(w / 2 + 8, 150); g.fill();
        }
        g.fillStyle = '#c03030'; g.fillRect(90, 166, w - 180, 6); g.fillRect(90, 352, w - 180, 6);
        centered(g); fit(g, 'VICE', w - 170, 190, FONT);
        g.fillStyle = '#0e3a40'; g.fillText('VICE', w / 2 + 6, 268);
        g.fillStyle = '#4ac8c8'; g.fillText('VICE', w / 2, 262);
        g.font = `italic bold 96px ${SCRIPT}`; g.fillStyle = '#d8b050'; g.fillText('& Video', w / 2 + 30, 420);
    }),
    bar149: () => art('fa_149', 640, 384, (g, w, h) => {
        const cx = w / 2, cy = h / 2;
        g.beginPath(); g.ellipse(cx, cy, w / 2 - 4, h / 2 - 4, 0, 0, 7); g.fillStyle = '#18181a'; g.fill();
        g.beginPath(); g.ellipse(cx, cy, w / 2 - 22, h / 2 - 22, 0, 0, 7); g.lineWidth = 16; g.strokeStyle = '#e8742a'; g.stroke();
        g.save(); g.beginPath(); g.ellipse(cx, cy, w / 2 - 30, h / 2 - 30, 0, 0, 7); g.clip();
        g.fillStyle = '#2a2a2e'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#e8742a'; g.fillRect(0, h * 0.74, w, h);
        g.restore();
        centered(g);
        g.font = `bold 44px ${FONT}`; g.fillStyle = '#f4ece0'; g.fillText('BAR', cx, h * 0.22);
        fit(g, '1·4·9', w * 0.7, 150, SLAB);
        g.lineWidth = 10; g.strokeStyle = '#e8742a'; g.lineJoin = 'round'; g.strokeText('1·4·9', cx, h * 0.5);
        g.fillStyle = '#f4e6cc'; g.fillText('1·4·9', cx, h * 0.5);
        // Martini glass and a little Ohio
        g.strokeStyle = '#2a1a10'; g.lineWidth = 5;
        g.beginPath(); g.moveTo(cx - 70, h * 0.78); g.lineTo(cx - 40, h * 0.86); g.lineTo(cx - 10, h * 0.78); g.closePath(); g.stroke();
        g.beginPath(); g.moveTo(cx - 40, h * 0.86); g.lineTo(cx - 40, h * 0.93); g.moveTo(cx - 55, h * 0.93); g.lineTo(cx - 25, h * 0.93); g.stroke();
        g.fillStyle = '#2a1a10'; g.beginPath(); g.moveTo(cx + 20, h * 0.78); g.lineTo(cx + 70, h * 0.78); g.lineTo(cx + 75, h * 0.86); g.lineTo(cx + 60, h * 0.93); g.lineTo(cx + 26, h * 0.92); g.closePath(); g.fill();
    }),
    docs: () => art('fa_docs', 512, 512, (g, w) => {
        const c = w / 2;
        g.beginPath(); g.arc(c, c, 250, 0, 7); g.fillStyle = '#e8902a'; g.fill();
        g.beginPath(); g.arc(c, c, 208, 0, 7); g.fillStyle = '#f2e2c4'; g.fill();
        centered(g); fit(g, "DOC'S", 380, 130, SLAB);
        g.lineWidth = 10; g.strokeStyle = '#f8f0e0'; g.lineJoin = 'round'; g.strokeText("DOC'S", c, 200);
        g.fillStyle = '#3a2416'; g.fillText("DOC'S", c, 200);
        // Handlebar moustache
        g.fillStyle = '#141010';
        for (const s of [-1, 1]) {
            g.beginPath(); g.moveTo(c, 280);
            g.bezierCurveTo(c + s * 60, 250, c + s * 120, 270, c + s * 150, 300);
            g.bezierCurveTo(c + s * 175, 320, c + s * 185, 290, c + s * 165, 270);
            g.bezierCurveTo(c + s * 180, 300, c + s * 150, 350, c + s * 90, 335);
            g.bezierCurveTo(c + s * 50, 325, c + s * 20, 315, c, 320);
            g.fill();
        }
        g.font = `italic bold 40px ${SCRIPT}`; g.fillStyle = '#7a4a1a'; g.fillText('Saloon', c, 395);
    }),
    cameo: () => art('fa_cameo', 512, 512, (g, w) => {
        const c = w / 2;
        g.beginPath(); g.arc(c, c, 250, 0, 7); g.fillStyle = '#f6f4ee'; g.fill();
        g.lineWidth = 8; g.strokeStyle = '#a02020'; g.stroke();
        g.font = `bold 78px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        arcText(g, 'CAMEO', c, c, 185, -0.95, 0.95, '#c02020');
        // Along the bottom, reading left to right and upright
        [...'PIZZA'].forEach((ch, i, all) => {
            const a = -0.75 + 1.5 * i / (all.length - 1);
            g.save(); g.translate(c + Math.sin(a) * 185, c + Math.cos(a) * 185); g.rotate(-a);
            g.fillStyle = '#c02020'; g.fillText(ch, 0, 0); g.restore();
        });
        g.beginPath(); g.ellipse(c, c, 92, 115, 0, 0, 7); g.fillStyle = '#2a3a8a'; g.fill();
        g.fillStyle = '#f6f4ee';
        g.beginPath(); g.moveTo(c - 10, c - 80); g.quadraticCurveTo(c + 50, c - 70, c + 30, c - 20); g.lineTo(c + 45, c); g.lineTo(c + 25, c + 10);
        g.quadraticCurveTo(c + 30, c + 50, c + 10, c + 80); g.lineTo(c - 50, c + 80); g.quadraticCurveTo(c - 70, c - 10, c - 10, c - 80); g.fill();
    }),
    tubbyArch: () => art('fa_tubby', 1024, 230, (g, w, h) => {
        g.beginPath(); g.moveTo(8, h - 8); g.ellipse(w / 2, h - 8, w / 2 - 8, h - 16, 0, PI, 2 * PI); g.closePath();
        g.fillStyle = '#f2c84a'; g.fill(); g.lineWidth = 8; g.strokeStyle = '#1a1a1a'; g.stroke();
        centered(g); fit(g, "TUBBY'S", w * 0.6, 120, FONT);
        g.fillStyle = '#141414'; g.fillText("TUBBY'S", w / 2, h * 0.5);
        g.font = `bold 52px ${FONT}`; g.fillText('TAVERN', w / 2, h * 0.84);
    }),
    tubbyMan: () => art('fa_tubbyman', 256, 256, (g, w) => {
        const c = w / 2;
        g.beginPath(); g.arc(c, c, 122, 0, 7); g.fillStyle = '#f4f4f0'; g.fill(); g.lineWidth = 8; g.strokeStyle = '#1a1a1a'; g.stroke();
        g.save(); g.beginPath(); g.arc(c, c, 116, 0, 7); g.clip();
        g.fillStyle = '#4a8ad0'; g.beginPath(); g.ellipse(c, 250, 110, 80, 0, 0, 7); g.fill();
        g.fillStyle = '#f0b898'; g.beginPath(); g.ellipse(c, 112, 48, 54, 0, 0, 7); g.fill();
        g.fillStyle = '#3a2a1a'; g.beginPath(); g.ellipse(c, 66, 46, 20, 0, 0, 7); g.fill();
        g.fillStyle = '#111'; g.fillRect(c - 42, 96, 36, 18); g.fillRect(c + 6, 96, 36, 18); g.fillRect(c - 6, 100, 12, 5);
        g.fillStyle = '#f2c040'; g.fillRect(28, 150, 48, 60); g.fillStyle = '#fff'; g.fillRect(24, 142, 56, 14);
        g.restore();
    }),
    fishbowl: () => art('fa_fishbowl', 1024, 448, (g, w, h) => {
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `bold 92px ${FONT}`;
        arcText(g, "NATE & WALLY'S", w / 2, 640, 600, -0.42, 0.42, '#ffffff', '#123a8a', 8);
        // Two cartoon faces, line drawn
        g.strokeStyle = '#ffffff'; g.lineWidth = 7; g.lineJoin = 'round';
        for (const [x, s] of [[w / 2 - 80, 1], [w / 2 + 80, -1]]) {
            g.beginPath(); g.ellipse(x, 230, 62, 70, 0, 0, 7); g.stroke();
            g.beginPath(); g.arc(x - 22, 215, 9, 0, 7); g.arc(x + 22, 215, 9, 0, 7); g.stroke();
            g.beginPath(); g.arc(x, 250, 26, 0.2, PI - 0.2); g.stroke();
            g.beginPath(); g.moveTo(x - 66, 180); g.quadraticCurveTo(x, 130 - s * 6, x + 66, 180); g.stroke();
        }
        g.font = `bold 120px ${FONT}`;
        g.lineWidth = 9; g.strokeStyle = '#123a8a'; g.strokeText('FISHBOWL', w / 2 + 40, 375);
        g.fillStyle = '#ffffff'; g.fillText('FISHBOWL', w / 2 + 40, 375);
        g.beginPath(); g.ellipse(170, 375, 50, 26, 0, 0, 7); g.moveTo(215, 375); g.lineTo(250, 350); g.lineTo(250, 400); g.closePath(); g.fill();
    }),
    shots: () => art('fa_shots', 1024, 160, (g, w, h) => {
        centered(g); fit(g, 'SHOTS INC.', w - 40, 120, FONT);
        g.fillStyle = '#f4f4f0'; g.fillText('SHOTS INC.', w / 2, h / 2);
        // Blocky stencil look: cut thin gaps through the letters
        g.globalCompositeOperation = 'destination-out';
        for (let y = h * 0.18; y < h * 0.85; y += 22) g.fillRect(0, y, w, 4);
        for (let x = 0; x < w; x += 31) g.fillRect(x, 0, 3, h);
        g.globalCompositeOperation = 'source-over';
    }),
    citytap: () => art('fa_citytap', 512, 288, (g, w, h) => {
        g.fillStyle = '#111'; g.fillRect(6, 6, w - 12, h - 12);
        g.strokeStyle = '#f4f0e8'; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20);
        g.save(); g.beginPath(); g.arc(w / 2, h * 0.62, 120, PI, 0); g.closePath(); g.clip();
        ['#f8d040', '#f09a2a', '#e8502a', '#d02a2a'].forEach((c, i) => { g.fillStyle = c; g.fillRect(0, h * 0.62 - 120 + i * 30, w, 22); });
        g.restore();
        centered(g); fit(g, 'City Tap', w - 80, 92, SCRIPT, 'italic bold');
        g.lineWidth = 8; g.strokeStyle = '#ffffff'; g.lineJoin = 'round'; g.strokeText('City Tap', w / 2, h * 0.62);
        g.fillStyle = '#d82a22'; g.fillText('City Tap', w / 2, h * 0.62);
        g.font = `bold 26px ${FONT}`; g.fillStyle = '#f8d040'; g.fillText('BAR & GRILL', w / 2, h * 0.86);
    }),
    chalk: (s) => card(`fa_chalk_${s.seed || 0}`, 128, 192, (g, w, h) => {
        g.fillStyle = '#5a3a1a'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#1a2420'; g.fillRect(8, 8, w - 16, h - 16);
        const r = rng(31 + (s.seed || 0));
        g.fillStyle = '#e8e8e0'; g.font = 'bold 16px Georgia'; g.textAlign = 'center';
        g.fillText("TODAY'S", w / 2, 34);
        for (let i = 0; i < 7; i++) { g.fillStyle = ['#e8e8e0', '#f0a0a0', '#a0d0f0', '#f0e080'][i % 4]; g.fillRect(20 + r() * 10, 54 + i * 18, 50 + r() * 40, 3); }
    }),
    relief: () => card('fa_relief', 256, 64, (g, w, h) => {
        g.fillStyle = '#d4d0c4'; g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 3;
        for (let x = 20; x < w; x += 54) { g.beginPath(); g.arc(x, h / 2, 16, 0.4, 5.9); g.stroke(); g.beginPath(); g.moveTo(x + 16, h / 2); g.bezierCurveTo(x + 26, 8, x + 36, h - 8, x + 46, h / 2); g.stroke(); }
        g.strokeRect(3, 3, w - 6, h - 6);
    }),
    vhs: () => canvasTex('fa_vhs', 256, 256, (g, w, h) => {
        const r = rng(51);
        g.fillStyle = '#e8e8e4'; g.fillRect(0, 0, w, h);
        for (let s = 0; s < 4; s++) {
            const y = s * 64;
            g.fillStyle = '#9aa0a8'; g.fillRect(0, y + 58, w, 6);
            for (let x = 2; x < w; x += 18) {
                g.fillStyle = `hsl(${r() * 360},${50 + r() * 40}%,${35 + r() * 30}%)`;
                g.fillRect(x, y + 8, 16, 50);
                g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(x + 2, y + 14, 12, 6);
            }
        }
    }),
    diamond: () => art('fa_diamond', 64, 64, (g, w, h) => {
        g.fillStyle = '#f0ece2'; g.beginPath(); g.moveTo(w / 2, 2); g.lineTo(w - 2, h / 2); g.lineTo(w / 2, h - 2); g.lineTo(2, h / 2); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.2)'; g.beginPath(); g.arc(w / 2, h / 2, 9, 0, 7); g.fill();
    })
};

// ------------------------------------------------------------------------------------------------
// Pieces
// ------------------------------------------------------------------------------------------------
function railing(k, z0, z1, x, y0, y1, color = 0x111111, collide = true) {
    const m = M.color(color, 0.05);
    const a = Math.min(z0, z1), b = Math.max(z0, z1);
    k.block(m, x - 0.025, y1 - 0.05, a, x + 0.025, y1, b);
    k.block(m, x - 0.02, y0 + 0.06, a, x + 0.02, y0 + 0.1, b);
    for (let z = a; z <= b + 1e-3; z += 0.13) k.block(m, x - 0.012, y0, z - 0.012, x + 0.012, y1, z + 0.012);
    if (collide) k.collide(x - 0.06, a, x + 0.06, b, y0, y1);
}

function buildDoor(h, d) {
    const { k, T } = h;
    const r = Math.max(T, d.recess || 0);
    const fm = M.color(d.frame !== undefined ? d.frame : 0x1a1a1a);
    const { z0, z1, top } = d;
    const w = z1 - z0;
    if (r > T + 0.01) {
        // A recessed entry: its side walls and ceiling stick into the room
        const rv = d.reveal !== undefined ? M.color(d.reveal) : h.groundMat.m;
        for (const [a, b] of [[z0 - 0.14, z0], [z1, z1 + 0.14]]) { k.block(rv, -r, 0, a, -T, top + 0.14, b, { tile: h.groundMat.tile }); k.collide(-r, a, -T, b, 0, top); }
        k.block(rv, -r, top, z0, -T, top + 0.14, z1, { tile: h.groundMat.tile });
        k.flat(M.color(0x6a6660), -r, z0, 0, z1, 0.02);
    }
    k.block(fm, -r - 0.05, 0, z0, -r + 0.04, top, z0 + 0.07);
    k.block(fm, -r - 0.05, 0, z1 - 0.07, -r + 0.04, top, z1);
    k.block(fm, -r - 0.05, top - 0.08, z0, -r + 0.04, top, z1);
    if (d.transom > 0) {
        k.block(fm, -r - 0.05, d.h - 0.05, z0, -r + 0.04, d.h + 0.04, z1);
        k.plane(M.tint(), w - 0.14, d.transom - 0.12, -r, d.h + d.transom / 2 - 0.02, (z0 + z1) / 2, { ry: PI / 2 });
    }
    // The leaves, swung open into the room
    const glassy = d.style === 'glass';
    const leaves = d.double ? [[z0 + 0.07, w / 2 - 0.07, 1], [z1 - 0.07, w / 2 - 0.07, -1]] : [[z0 + 0.07, w - 0.14, 1]];
    for (const [zh, lw, s] of leaves) {
        const lz = zh + s * 0.04, x0 = -r - lw, x1 = -r - 0.02;
        if (glassy) {
            const lm = M.color(d.color !== undefined ? d.color : 0xb8bcc0, 0.12);
            k.block(lm, x0, 0.02, lz - 0.025, x1, 0.25, lz + 0.025);
            k.block(lm, x0, d.h - 0.14, lz - 0.025, x1, d.h - 0.04, lz + 0.025);
            k.block(lm, x0, 0.02, lz - 0.025, x0 + 0.07, d.h - 0.04, lz + 0.025);
            k.block(lm, x1 - 0.07, 0.02, lz - 0.025, x1, d.h - 0.04, lz + 0.025);
            k.plane(M.glass(), lw - 0.14, d.h - 0.4, (x0 + x1) / 2, (0.25 + d.h - 0.14) / 2, lz, {});
        } else {
            k.block(M.tex(`fleaf_${d.style}_${d.color}`, doorTex(d.style || 'flat', d.color !== undefined ? d.color : 0x2a1a12), 0.25), x0, 0.02, lz - 0.025, x1, d.h - 0.04, lz + 0.025);
        }
    }
    k.block(fm, -r - 0.02, 0, z0, 0.02, 0.03, z1);
}

/** A door that doesn't open (a neighbour's, the flats upstairs): flush, or set back in a frame. */
function buildFakeDoor(h, f) {
    const { k, Z } = h;
    const z = Z(f.u), w = f.w, z0 = z - w / 2, z1 = z + w / 2;
    const fm = M.color(f.frame !== undefined ? f.frame : 0x2a2a2a);
    const dm = M.tex(`fleaf_${f.style}_${f.color}`, doorTex(f.style || 'flat', f.color), 0.12);
    const out = f.recess ? f.recess : 0.03;
    if (f.recess) {
        // Reveals stood out from the wall so the door reads as set back
        const rv = f.reveal !== undefined ? M.color(f.reveal) : h.groundMat.m;
        k.block(rv, 0, 0, z0 - 0.18, out, f.h + 0.18, z0, { tile: h.groundMat.tile });
        k.block(rv, 0, 0, z1, out, f.h + 0.18, z1 + 0.18, { tile: h.groundMat.tile });
        k.block(rv, 0, f.h, z0, out, f.h + 0.18, z1, { tile: h.groundMat.tile });
        k.collide(0, z0 - 0.18, out, z1 + 0.18, 0, f.h);
    }
    if (f.double) {
        k.block(dm, 0, 0.02, z0, 0.05, f.h, z, {});
        k.block(dm, 0, 0.02, z, 0.05, f.h, z1, {});
    } else k.block(dm, 0, 0.02, z0, 0.05, f.h, z1, {});
    k.block(fm, 0, 0, z0 - 0.06, 0.07, f.h + 0.06, z0);
    k.block(fm, 0, 0, z1, 0.07, f.h + 0.06, z1 + 0.06);
    k.block(fm, 0, f.h, z0, 0.07, f.h + 0.06, z1);
    if (f.number) k.plane(M.paint(`fnum_${f.number}`, lettersTex(f.number, 0x111111, { w: 256, h: 96 })), 0.3, 0.12, 0.08, f.h + 0.2, z, { ry: PI / 2 });
}

function buildWindow(h, w) {
    const { k, Z } = h;
    const a = w.z0, b = w.z1, wid = b - a, hh = w.y1 - w.y0, ym = (w.y0 + w.y1) / 2, zm = (a + b) / 2;
    const fm = M.color(w.frame !== undefined ? w.frame : 0x1a1a1a, 0.08);
    const n = w.mull !== undefined ? w.mull : Math.max(1, Math.round(wid / 1.6));
    if (w.boarded !== undefined) {
        // Painted plywood over the opening (both sides), with framed panels on it
        k.block(M.tex(`fboard_${w.boarded}`, battenTex(w.boarded, 4), 0.1), -0.2, w.y0, a, -0.08, w.y1, b, { tile: [1.2, 1.2] });
        for (const ins of w.insets || []) {
            const za = Z(ins.u1), zb = Z(ins.u0);
            const im = M.color(w.frame !== undefined ? w.frame : 0x3a2418);
            k.block(im, -0.08, ins.y0, za, -0.03, ins.y0 + 0.07, zb);
            k.block(im, -0.08, ins.y1 - 0.07, za, -0.03, ins.y1, zb);
            k.block(im, -0.08, ins.y0, za, -0.03, ins.y1, za + 0.07);
            k.block(im, -0.08, ins.y0, zb - 0.07, -0.03, ins.y1, zb);
            if (ins.poster) k.plane(M.tex(`fposter_${ins.u0}`, posterTex(Math.round(ins.u0 * 1000)), 0.2), zb - za - 0.2, ins.y1 - ins.y0 - 0.2, -0.075, (ins.y0 + ins.y1) / 2, (za + zb) / 2, { ry: PI / 2 });
        }
    } else if (w.glassBlock) {
        k.block(M.tex('fglassblock', glassBlockTex(), 0.25), -0.2, w.y0, a, -0.1, w.y1, b, { tile: [0.6, 0.6] });
    } else {
        k.plane(w.tint ? M.tint() : M.glass(), wid, hh, -0.12, ym, zm, { ry: PI / 2 });
        for (let i = 1; i < n; i++) { const z = a + wid * i / n; k.block(fm, -0.16, w.y0, z - 0.035, -0.06, w.y1, z + 0.035); }
        for (let j = 1; j < (w.rows || 1); j++) { const y = w.y0 + hh * j / w.rows; k.block(fm, -0.16, y - 0.03, a, -0.06, y + 0.03, b); }
        if (w.transomBar) k.block(fm, -0.16, w.transomBar - 0.04, a, -0.06, w.transomBar + 0.04, b);
    }
    k.block(fm, -0.17, w.y0, a, -0.04, w.y0 + 0.06, b);
    k.block(fm, -0.17, w.y1 - 0.06, a, -0.04, w.y1, b);
    k.block(fm, -0.17, w.y0, a, -0.04, w.y1, a + 0.06);
    k.block(fm, -0.17, w.y0, b - 0.06, -0.04, w.y1, b);
    if (w.y0 > 0.3) k.block(M.color(w.sill !== undefined ? w.sill : 0x8a8680), -0.06, w.y0 - 0.07, a - 0.04, 0.07, w.y0, b + 0.04);
    if (w.bulkhead) {
        const bm = w.bulkhead.brick !== undefined ? M.tex(`fbrick_${w.bulkhead.brick}_undefined`, brickTex(w.bulkhead.brick)) : M.color(w.bulkhead.color, 0.08);
        k.block(bm, 0, 0, a - 0.05, 0.06, w.y0 - 0.07, b + 0.05, { tile: [1.2, 0.6] });
        if (w.bulkhead.inset) k.block(M.color(0x241812), 0.06, 0.08, a + 0.1, 0.075, w.y0 - 0.15, b - 0.1);
    }
    if (w.rail) railing(k, a, b, w.rail.x !== undefined ? w.rail.x : 0.15, w.rail.y0 !== undefined ? w.rail.y0 : 0, w.rail.y1 !== undefined ? w.rail.y1 : 1.0);
    // Things inside the glass, seen from the street (and the room)
    if (w.panels) {
        const pm = M.tex(`fwpanel_${w.panels.color}`, panelTex(w.panels.color), 0.25);
        const ph = w.panels.h;
        k.block(pm, -0.44, w.y0, a + 0.03, -0.36, w.y0 + ph, b - 0.03, { tile: [1.2, 1.2] });
        const np = Math.max(2, Math.round(wid / 0.9));
        for (let i = 0; i < np; i++) {
            const za = a + 0.15 + (wid - 0.3) * i / np, zb = a + 0.15 + (wid - 0.3) * (i + 1) / np - 0.12;
            k.block(M.color(w.panels.color, 0.2), -0.36, w.y0 + 0.18, za, -0.33, w.y0 + ph - 0.18, zb);
        }
        k.block(M.color(w.panels.color, 0.2), -0.46, w.y0 + ph, a + 0.03, -0.3, w.y0 + ph + 0.05, b - 0.03);
        k.collide(-0.46, a, -0.3, b, 0, w.y0 + ph);
    }
    if (w.curtain !== undefined) k.plane(M.color(w.curtain, 0.15), wid - 0.1, Math.min(1.1, hh * 0.45), -0.3, w.y0 + Math.min(1.1, hh * 0.45) / 2, zm, { ry: PI / 2 });
    if (w.blinds) k.plane(M.tex('fblinds', blindsTex(), 0.15), wid - 0.1, hh - 0.1, -0.22, ym, zm, { ry: PI / 2 });
    if (w.posters) k.plane(M.tex(`fposter_w_${w.u0}`, posterTex(Math.round(w.u0 * 777)), 0.25), wid - 0.2, hh * 0.7, -0.22, ym, zm, { ry: PI / 2 });
    (w.neon || []).forEach(([text, color], i, all) => {
        const z = b - wid * (i + 0.5) / all.length;
        const nw = Math.min(1.5, wid / all.length - 0.15);
        k.plane(M.sign(`neon_${text}_${color}`, neonTex(text, color)), nw, nw * 0.31, -0.24, w.y1 - 0.25 - nw * 0.16, z, { ry: PI / 2 });
    });
}
function blindsTex() {
    return art('fa_blinds', 64, 64, (g, w, h) => {
        for (let y = 0; y < h; y += 6) { g.fillStyle = 'rgba(40,42,46,0.85)'; g.fillRect(0, y, w, 4); }
    });
}

function buildAwning(h, a) {
    const { k, Z } = h;
    const z0 = Z(a.u1), z1 = Z(a.u0), zm = (z0 + z1) / 2, wd = z1 - z0;
    const m = M.color(a.color, 0.08);
    const val = a.val !== undefined ? a.val : 0.25;
    if (a.style === 'flat') {
        k.block(m, 0, a.y0, z0, a.out, a.y1, z1);
        if (a.edge) k.block(M.color(a.edge.color, 0.18), a.out, a.y0, z0, a.out + 0.03, a.y0 + a.edge.h, z1);
        if (a.frontText) {
            const t = a.frontText, tz = t.u !== undefined ? Z(t.u) : zm;
            k.plane(M.sign(`ftext_${t.kind}`, ART_TEXT[t.kind]()), t.w, t.h, a.out + 0.035, (a.y0 + a.y1) / 2, tz, { ry: PI / 2 });
        }
        return;
    }
    if (a.style === 'barrel') {
        const segs = 7;
        let px = 0, py = a.y1;
        for (let i = 1; i <= segs; i++) {
            const t = i / segs * PI / 2;
            const x = a.out * Math.sin(t), y = a.y0 + (a.y1 - a.y0) * Math.cos(t);
            const L = Math.hypot(x - px, y - py), ang = Math.atan2(py - y, x - px);
            k.box(m, L + 0.03, 0.05, wd, (px + x) / 2, (py + y) / 2, zm, { rz: -ang });
            px = x; py = y;
        }
    } else {
        const ang = Math.atan2(a.y1 - a.y0, a.out), L = Math.hypot(a.out, a.y1 - a.y0);
        k.box(m, L, 0.04, wd, a.out / 2, (a.y0 + a.y1) / 2, zm, { rz: -ang });
        if (a.slopeText) {
            const s = a.slopeText, t = s.t !== undefined ? s.t : 0.5;
            const x = a.out * t + Math.sin(ang) * 0.03, y = a.y1 - (a.y1 - a.y0) * t + Math.cos(ang) * 0.03;
            k.plane(M.sign(`fslope_${s.kind}`, ART[s.kind]()), s.w, s.h, x, y, s.u !== undefined ? Z(s.u) : zm, { ry: PI / 2, rx: ang - PI / 2 });
        }
    }
    // Valance and ends
    k.block(m, a.out - 0.03, a.y0 - val, z0, a.out + 0.01, a.y0 + 0.02, z1);
    const side = M.cutout(`fawnside_${a.color}_${val}_${a.style}`, awningSideTex(a.color, val / (a.y1 - a.y0 + val), a.style === 'barrel'));
    for (const z of [z0 + 0.005, z1 - 0.005]) k.plane(side, a.out, a.y1 - a.y0 + val, a.out / 2, (a.y1 + a.y0 - val) / 2, z, {});
    for (const st of a.stripes || []) k.block(M.color(st.color, 0.15), a.out + 0.01, a.y0 - val + st.y, z0, a.out + 0.02, a.y0 - val + st.y + (st.h || 0.04), z1);
    if (a.valText) {
        const t = a.valText;
        k.plane(M.sign(`fval_${t.text}_${t.color}_${t.font}`, t.art ? ART[t.art]() : lettersTex(t.text, t.color, { font: t.font || FONT, w: 2048, h: 128 })), t.w || wd * 0.94, val * (t.scale || 0.72), a.out + 0.02, a.y0 - val / 2, t.u !== undefined ? Z(t.u) : zm, { ry: PI / 2 });
    }
}
const ART_TEXT = {
    atticWhite: () => lettersTex('THE ATTIC', 0xffffff, { font: CAPS, outline: 0x111111, lw: 10, w: 1024, h: 224 }),
    atticBlue: () => lettersTex('THE ATTIC', 0x2a72d8, { font: CAPS, outline: 0x9ac8ff, lw: 6, w: 1024, h: 224, shadow: 0x0a1a3a })
};

function buildSign(h, s) {
    const { k, Z } = h;
    const z = Z(s.u), x = s.x !== undefined ? s.x : 0.04;
    const tex = s.kind === 'letters' ? lettersTex(s.text, s.color, s.opts || {}) : (ART[s.kind] || ART_TEXT[s.kind])(s);
    const key = `fsign_${s.kind}_${s.text || ''}_${s.color || ''}_${s.seed || ''}`;
    const m = s.painted ? M.paint(key, tex) : M.sign(key, tex);
    if (s.back) {
        const bm = M.color(s.back.color, 0.08);
        const d = s.back.depth || 0.1;
        if (s.back.disc) k.cyl(bm, s.w / 2 - 0.01, s.w / 2 - 0.01, d, x - d / 2, s.y, z, { rz: PI / 2, seg: 32 });
        else k.block(bm, x - d, s.y - s.h / 2 * (s.back.fill || 0.98), z - s.w / 2 * (s.back.fill || 0.98), x, s.y + s.h / 2 * (s.back.fill || 0.98), z + s.w / 2 * (s.back.fill || 0.98));
    }
    k.plane(m, s.w, s.h, x + 0.006, s.y, z, { ry: PI / 2 });
}

function lamp(k, z, y) {
    const m = M.color(0x141414, 0.05);
    k.block(m, 0, y - 0.025, z - 0.025, 0.42, y + 0.025, z + 0.025);
    k.cyl(m, 0.02, 0.02, 0.2, 0.42, y - 0.1, z, { seg: 6 });
    k.cyl(m, 0.05, 0.17, 0.15, 0.42, y - 0.27, z, { seg: 12, open: true });
    k.sphere(M.bulb(), 0.05, 0.42, y - 0.32, z, 8);
}

function upperWindow(h, w) {
    const { k, Z, sf } = h;
    const z = Z(w.u), hw = w.w / 2;
    const trim = M.color(w.trim !== undefined ? w.trim : 0xcfc6b0, 0.08);
    const seed = (sf.name.length * 131 + Math.round(w.u * 100) * 7 + Math.round(w.y0 * 10)) % 997;
    k.plane(M.tex(`fupw_${seed}`, upperWindowTex(seed), 0.25), w.w, w.y1 - w.y0, 0.012, (w.y0 + w.y1) / 2, z, { ry: PI / 2 });
    k.block(trim, -0.05, w.y0 - 0.12, z - hw - 0.08, 0.1, w.y0, z + hw + 0.08);
    if (w.arch) k.plane(M.cutout(`farchw_${w.arch}_${w.archColor}`, archTex(w.arch, w.archColor !== undefined ? w.archColor : 0xf0ece2)), w.w + 0.3, (w.w + 0.3) / 2, 0.02, w.y1 + (w.w + 0.3) / 4, z, { ry: PI / 2 });
    else k.block(trim, -0.05, w.y1, z - hw - 0.12, w.lintelOut || 0.08, w.y1 + (w.lintel || 0.2), z + hw + 0.12);
    if (w.rail) railing(h.k, z - hw - 0.1, z + hw + 0.1, 0.2, w.y0 - 0.1, w.y0 + 0.85, 0x1a1a1a, false);
}

// ------------------------------------------------------------------------------------------------
// The fronts
// ------------------------------------------------------------------------------------------------
/** n windows evenly across (centres at u), on each of `storeys` storeys between y0 and y1. */
function storeyWindows(storeys, y0, y1, us, opts = {}) {
    const out = [];
    const sh = (y1 - y0) / storeys;
    for (let s = 0; s < storeys; s++) {
        for (const u of us) {
            const wy0 = y0 + s * sh + (opts.sill || 0.75);
            out.push({ u, w: opts.w || 1.0, y0: wy0, y1: wy0 + (opts.h || Math.min(1.8, sh - 1.1)), trim: opts.trim, rail: opts.rail && s === 0, ...(opts.each ? opts.each(s, u) : {}) });
        }
    }
    return out;
}

export const FRONTS = {
    "Howard's Club H": {
        door: 0.885, doorW: 1.0,
        ground: { kind: 'batten', color: 0x4a3c34 }, groundTop: 4.9,
        upper: { kind: 'brick', color: 0xe8e4dc, mortar: 0xd2cec6 },
        doors: { main: { style: 'flat', color: 0xe8742a, h: 2.4, frame: 0x3a2a22 } },
        windows: [{ u0: 0.575, u1: 0.83, y0: 0.75, y1: 2.45, mull: 3, frame: 0x2a2420, tint: true, bulkhead: { color: 0x3a2e28 } }],
        boards: [
            { u: 0.3, w: 1.75, y: 1.75, h: 0.95, lines: ['DIVE', 'BOMBING', 'SPACE PIGEONS'] },
            { u: 0.455, w: 1.75, y: 1.75, h: 0.95, lines: ['SAT', 'ROBIN', 'EVANS'] }
        ],
        signs: [
            { kind: 'letters', text: 'BANDS', color: 0xf0ece0, u: 0.19, y: 2.3, w: 1.25, h: 0.32, painted: true, x: 0.01 },
            { kind: 'letters', text: 'FANS ☞', color: 0xf0ece0, u: 0.535, y: 2.3, w: 0.95, h: 0.3, painted: true, x: 0.01 }
        ],
        vertical: { text: "HOWARD'S", u: 0.012, y: 1.6, w: 0.3, h: 2.0, bg: 0x3a2a22, fg: 0xe8742a },
        awnings: [{
            u0: 0.0, u1: 0.985, y1: 4.9, y0: 3.0, out: 1.75, val: 0.36, color: 0x7a4c44,
            valText: { text: 'LIVE MUSIC • GOOD TIMES • A BOWLING GREEN TRADITION •', color: 0xf4f0e8 },
            slopeText: { kind: 'howards', t: 0.5, u: 0.63, w: 5.4, h: 1.3 }
        }],
        upperWindows: [0.09, 0.36, 0.62, 0.88].map((u) => ({ u, w: 1.0, y0: 6.45, y1: 7.75, trim: 0x8a7a6a })),
        cornice: { color: 0xd8d4cc, out: 0.15, h: 0.3 }
    },
    'liquid bar': {
        levels: 1, height: 8.0, door: 0.245, doorW: 1.15,
        ground: { kind: 'paint', color: 0x9c9fa2 },
        doors: { main: { style: 'glass', color: 0xb8bcc0, h: 2.4, transom: 0.95, frame: 0xa8acb0 } },
        windows: [{ u0: 0.39, u1: 0.885, y0: 2.0, y1: 3.3, mull: 3, frame: 0x2a2c30, tint: true, blinds: true, sill: 0x8c8f92 }],
        bands: [{ y0: 3.95, y1: 4.12, out: 0.06, color: 0x8c8f92 }],
        pilasters: [{ u0: 0.17, u1: 0.19 }, { u0: 0.355, u1: 0.375 }, { u0: 0.925, u1: 0.945 }].map((p) => ({ ...p, color: 0x95989b, out: 0.06 })),
        signs: [{ kind: 'liquid', u: 0.25, y: 5.75, w: 2.6, h: 2.3, x: 0.2, back: { depth: 0.18, color: 0x2a5ad0 } }],
        cornice: { color: 0xb8bab8, out: 0.06, h: 0.15 }
    },
    Brathaus: {
        door: 0.385, doorW: 1.0,
        ground: { kind: 'batten', color: 0x5a3a2a }, groundTop: 4.3,
        upper: { kind: 'paint', color: 0xb49a7c },
        doors: { main: { style: 'flat', color: 0x2a1a14, h: 2.45, recess: 0.65, frame: 0x3a2418, reveal: 0x5a3a2a } },
        windows: [
            { u0: 0.035, u1: 0.29, y0: 0.85, y1: 3.0, boarded: 0xe8722a, frame: 0x3a2418, insets: [{ u0: 0.17, u1: 0.265, y0: 1.15, y1: 2.6, poster: true }] },
            { u0: 0.49, u1: 0.93, y0: 0.85, y1: 3.05, boarded: 0xe8722a, frame: 0x3a2418, insets: [{ u0: 0.6, u1: 0.8, y0: 0.95, y1: 2.45 }] }
        ],
        shingles: [{ u0: 0.0, u1: 0.255, y0: 3.3, y1: 4.25, out: 0.9 }, { u0: 0.47, u1: 1.0, y0: 3.3, y1: 4.3, out: 0.95 }],
        boards: [{ u: 0.365, w: 1.6, y: 3.8, h: 0.78, lines: ['$2 TUESDAYS', 'THIRSTY THURSDAYS', '10 JOINT FLAVORS'] }],
        signs: [
            { kind: 'plank', text: 'HOME OF THE “LEGAL JOINT”', u: 0.4, y: 4.78, w: 3.7, h: 0.43, x: 0.06, back: { depth: 0.06, color: 0x8a6a3a } },
            { kind: 'plank', text: 'Brathaus', fg: 0x2a1a10, u: 0.385, y: 2.98, w: 0.95, h: 0.22, x: 0.03 },
            { kind: 'brathaus', u: 0.33, y: 6.45, w: 3.0, h: 3.0, x: 0.05 }
        ],
        lamps: [{ u: 0.1, y: 5.35 }, { u: 0.24, y: 5.35 }, { u: 0.45, y: 5.5 }, { u: 0.6, y: 5.65 }],
        pilasters: [{ u0: 0.9, u1: 1.0, y0: 4.3, color: 0xc4aa8c, out: 0.1 }],
        cornice: { color: 0x3a2418, out: 0.32, h: 0.38 },
        extra: (h) => {
            // Orange half-moons and brackets under the cornice
            const am = M.cutout('farch_paint_brath', archTex('paint', 0xd86a3a));
            for (const u of [0.12, 0.36, 0.6, 0.82]) {
                h.k.plane(am, 1.05, 0.52, 0.02, h.H - 0.95, h.Z(u), { ry: PI / 2 });
                h.k.block(M.color(0x3a2418), 0, h.H - 1.0, h.Z(u + 0.12) - 0.06, 0.25, h.H - 0.38, h.Z(u + 0.12) + 0.06);
            }
        }
    },
    'DownTown Sports Grill': {
        levels: 4, door: 0.33, doorW: 1.2,
        ground: { kind: 'brick', color: 0x9a4a38 }, groundTop: 5.3,
        upper: { kind: 'brick', color: 0x96402f },
        doors: {
            main: { style: 'glass', color: 0x2a2a2a, h: 2.4, transom: 0.3, recess: 0.8, reveal: 0xe8e2d0, frame: 0x2a2a2a },
            stairs: { style: 'flat', color: 0x1e1e22, h: 2.4, recess: 0.3, frame: 0x2a2a2a }
        },
        windows: [
            { u0: 0.03, u1: 0.2, y0: 0.9, y1: 2.65, mull: 2, frame: 0x1a1a1a, rail: { y1: 1.15 } },
            { u0: 0.45, u1: 0.56, y0: 1.5, y1: 2.5, glassBlock: true, frame: 0xd8d0c0 },
            { u0: 0.66, u1: 0.8, y0: 1.5, y1: 2.5, glassBlock: true, frame: 0xd8d0c0 }
        ],
        pilasters: [{ u0: 0.205, u1: 0.245, y1: 3.0, color: 0xe8e0c8, out: 0.14 }],
        awnings: [
            { style: 'barrel', u0: 0.0, u1: 0.53, y1: 4.35, y0: 3.15, out: 1.45, val: 0.3, color: 0x7a1a2a, stripes: [{ color: 0xf4f0e8, y: 0.06 }, { color: 0xf4f0e8, y: 0.15 }] },
            { style: 'barrel', u0: 0.535, u1: 0.72, y1: 4.35, y0: 3.15, out: 1.45, val: 0.3, color: 0x7a1a2a, stripes: [{ color: 0xf4f0e8, y: 0.06 }, { color: 0xf4f0e8, y: 0.15 }] },
            { style: 'barrel', u0: 0.725, u1: 0.86, y1: 4.35, y0: 3.15, out: 1.45, val: 0.3, color: 0x7a1a2a, stripes: [{ color: 0xf4f0e8, y: 0.06 }, { color: 0xf4f0e8, y: 0.15 }] },
            { style: 'barrel', u0: 0.865, u1: 0.995, y1: 4.35, y0: 3.15, out: 1.45, val: 0.3, color: 0x7a1a2a, stripes: [{ color: 0xf4f0e8, y: 0.06 }, { color: 0xf4f0e8, y: 0.15 }] }
        ],
        signs: [
            { kind: 'downtown', u: 0.29, y: 3.1, w: 2.3, h: 0.86, x: 1.48 },
            { kind: 'uptown', u: 0.63, y: 3.1, w: 1.7, h: 0.64, x: 1.48 }
        ],
        bands: [{ y0: 4.35, y1: 4.75, out: 0.14, color: 0x2a3038 }, { y0: 4.75, y1: 5.3, out: 0.1, color: 0xe8e0c8 }],
        upperWindows: (h) => storeyWindows(3, 5.3, h.H - 0.7, [0.1, 0.3, 0.5, 0.7, 0.9], {
            w: 1.15, trim: 0x6a9a7a, sill: 0.7,
            each: (s, u) => (s === 2 && u === 0.5 ? { arch: 'white', archColor: 0x6a9a7a } : {})
        }),
        cornice: { color: 0xe8e0c8, out: 0.45, h: 0.7, trim2: 0x6a9a7a }
    },
    'Vice & Video': {
        levels: 1, height: 6.0, door: 0.135, doorW: 1.1,
        ground: { kind: 'quilted', color: 0xd4d4d2 },
        doors: { main: { style: 'glass', color: 0x1a1a1a, h: 2.35, transom: 0.55, recess: 0.55, frame: 0xb8bcc0 } },
        windows: [{
            u0: 0.37, u1: 0.93, y0: 0.45, y1: 2.85, mull: 1, frame: 0xc8ccd0,
            rail: { x: 0.15, y0: 0.6, y1: 1.45 }, neon: [['REWIND', 0xff3a3a]], vhs: true
        }],
        pilasters: [{ u0: 0.0, u1: 0.02, color: 0x2a2a2e, out: 0.05 }],
        signs: [{ kind: 'vice', u: 0.5, y: 4.3, w: 2.7, h: 2.35, x: 0.12 }],
        cornice: { color: 0xc8c8c6, out: 0.05, h: 0.12 }
    },
    'Bar 149': {
        levels: 1, height: 6.4, door: 0.53, doorW: 1.15,
        ground: { kind: 'paint', color: 0x3a3d42 },
        doors: { main: { style: 'glass', color: 0x2a2a2a, h: 2.4, transom: 0.5, recess: 0.85, reveal: 0x34373c, frame: 0x1a1a1a } },
        windows: [
            { u0: 0.05, u1: 0.42, y0: 0.72, y1: 2.85, mull: 3, rows: 2, frame: 0x1a1a1a, bulkhead: { color: 0xe07a3a }, rail: { x: 0.12, y0: 0.72, y1: 1.4 } },
            { u0: 0.645, u1: 0.94, y0: 0.72, y1: 2.85, mull: 3, rows: 2, frame: 0x1a1a1a, bulkhead: { color: 0xe07a3a }, rail: { x: 0.12, y0: 0.72, y1: 1.4 } }
        ],
        awnings: [
            { u0: 0.02, u1: 0.455, y1: 3.7, y0: 3.15, out: 1.0, val: 0.2, color: 0x26262a, stripes: [{ color: 0xe8d0b0, y: 0.04, h: 0.06 }, { color: 0xe07a3a, y: 0.11, h: 0.03 }] },
            { u0: 0.635, u1: 0.99, y1: 3.7, y0: 3.15, out: 1.0, val: 0.2, color: 0x26262a, stripes: [{ color: 0xe8d0b0, y: 0.04, h: 0.06 }, { color: 0xe07a3a, y: 0.11, h: 0.03 }] }
        ],
        signs: [{ kind: 'bar149', u: 0.53, y: 4.6, w: 2.55, h: 1.53, x: 0.14 }],
        pilasters: [{ u0: 0.0, u1: 0.03 }, { u0: 0.43, u1: 0.455 }, { u0: 0.605, u1: 0.635 }, { u0: 0.965, u1: 1.0 }].map((p) => ({ ...p, color: 0x2c2e32, out: 0.08, y1: 3.0 })),
        extra: (h) => {
            // Panel seams across the charcoal cladding
            const m = M.color(0x2a2c30);
            for (const u of [0.2, 0.4, 0.6, 0.8]) h.k.block(m, 0, 3.75, h.Z(u) - 0.015, 0.012, h.H - 0.2, h.Z(u) + 0.015);
            h.k.block(m, 0, 5.05, -h.W2, 0.012, 5.08, h.W2);
        },
        cornice: { color: 0x2c2e32, out: 0.08, h: 0.18 }
    },
    "Doc Holliday's Bar & Grill": {
        levels: 1, height: 6.6, door: 0.17, doorW: 1.55,
        ground: { kind: 'siding', color: 0xb4aa98 },
        doors: { main: { style: 'wood2', double: true, color: 0x3a2622, h: 2.45, transom: 0.5, frame: 0x2a1c18 } },
        windows: [
            { u0: 0.33, u1: 0.625, y0: 0.62, y1: 2.92, mull: 1, transomBar: 2.45, frame: 0x262626, bulkhead: { color: 0x3a2a22, inset: true } },
            { u0: 0.66, u1: 0.975, y0: 0.62, y1: 2.92, mull: 2, transomBar: 2.45, frame: 0x262626, bulkhead: { color: 0x3a2a22, inset: true } }
        ],
        awnings: [{ style: 'flat', u0: 0.0, u1: 1.0, y0: 2.98, y1: 3.55, out: 0.95, color: 0x141416, edge: { color: 0xf0a428, h: 0.12 } }],
        signs: [
            { kind: 'docs', u: 0.6, y: 4.85, w: 1.75, h: 1.75, x: 0.18, back: { disc: true, depth: 0.16, color: 0x3a2410 } },
            { kind: 'cameo', u: 0.17, y: 4.95, w: 1.45, h: 1.45, x: 0.14, back: { disc: true, depth: 0.12, color: 0x9a9a9a } }
        ],
        cornice: { color: 0x9a907e, out: 0.06, h: 0.12 }
    },
    "Tubby's Tavern": {
        door: 0.3, doorW: 1.0,
        ground: { kind: 'ribbed', color: 0x1e2024 }, groundTop: 4.65,
        upper: { kind: 'brick', color: 0x8a4a3a },
        doors: { main: { style: 'glass', color: 0xb8bcc0, h: 2.35, transom: 0.5, frame: 0xb0b4b8 } },
        windows: [
            { u0: 0.085, u1: 0.215, y0: 0.45, y1: 2.85, frame: 0xb0b4b8, tint: true, sill: 0xb8b0a0 },
            { u0: 0.385, u1: 0.885, y0: 0.45, y1: 2.85, mull: 3, frame: 0xb0b4b8, sill: 0xb8b0a0, curtain: 0x2a2e48, neon: [['BUSCH', 0x3a8aff], ['BG', 0xff8a2a]] }
        ],
        bands: [{ y0: 0, y1: 0.45, out: 0.04, color: 0xb8b0a0, u0: 0.37, u1: 0.97 }, { y0: 0, y1: 0.45, out: 0.04, color: 0xb8b0a0, u0: 0.03, u1: 0.23 }, { y0: 4.65, y1: 5.05, out: 0.16, color: 0xc0b8a8 }],
        signs: [
            { kind: 'tubbyArch', u: 0.5, y: 3.5, w: 5.6, h: 1.26, x: 0.16, back: { depth: 0.12, color: 0x1a1a1a, fill: 0.5 } },
            { kind: 'tubbyMan', u: 0.79, y: 3.45, w: 0.95, h: 0.95, x: 0.32 }
        ],
        pilasters: [{ u0: 0.0, u1: 0.03, color: 0xb8b0a0, out: 0.08 }, { u0: 0.97, u1: 1.0, color: 0xb8b0a0, out: 0.08 }],
        upperWindows: (h) => storeyWindows(2, 5.05, h.H - 0.5, [0.2, 0.5, 0.8], { w: 1.25, trim: 0xc0b8a8, rail: true }),
        cornice: { color: 0xc0b8a8, out: 0.3, h: 0.5 }
    },
    'Cla-Zel': {
        height: 10.5, door: 0.45, doorW: 4.0,
        ground: { kind: 'stone', color: 0xd8d4c8 }, groundTop: 3.45,
        upper: { kind: 'brick', color: 0xc0a676, mortar: 0xdccfb2 },
        doors: { main: { style: 'glass', double: true, color: 0x6a3a1a, h: 2.6, transom: 0.6, frame: 0x6a3a1a } },
        fakeDoors: [
            { u: 0.165, w: 1.45, h: 2.5, color: 0x8a5a2a, style: 'wood2', double: true, recess: 0.25, frame: 0x5a3a1a },
            { u: 0.73, w: 1.0, h: 2.5, color: 0x8a5a2a, style: 'wood', recess: 0.25, frame: 0x5a3a1a },
            { u: 0.895, w: 0.85, h: 2.3, color: 0x7a5a4a, style: 'flat', frame: 0x5a4a3a },
            { u: 0.03, w: 0.75, h: 2.3, color: 0x9aa0a4, style: 'flat', frame: 0x7a7e82 }
        ],
        signs: [
            { kind: 'chalk', u: 0.255, y: 1.35, w: 0.62, h: 0.92, x: 0.05, seed: 1 },
            { kind: 'chalk', u: 0.655, y: 1.35, w: 0.62, h: 0.92, x: 0.05, seed: 2 },
            { kind: 'relief', u: 0.16, y: 2.98, w: 1.45, h: 0.36, x: 0.02 },
            { kind: 'relief', u: 0.745, y: 2.98, w: 1.45, h: 0.36, x: 0.02 }
        ],
        cornice: { color: 0xd8ccb0, out: 0.2, h: 0.35 },
        extra: (h) => buildClazel(h)
    },
    'Nate & Wallys Fishbowl': {
        height: 9.6, door: 0.85, doorW: 0.95,
        ground: { kind: 'brick', color: 0x2c5ab8, mortar: 0x3a66c0 }, groundTop: 6.25,
        upper: { kind: 'brick', color: 0x8a4a38 },
        doors: { main: { style: 'flat', color: 0x1e1e22, h: 2.45, recess: 0.4, frame: 0x2a4a9a, reveal: 0x2c5ab8 } },
        fakeDoors: [{ u: 0.125, w: 0.85, h: 2.3, color: 0xe8e8e8, style: 'flat', recess: 0.35, reveal: 0x2c5ab8, frame: 0x2a4a9a, number: '147' }],
        windows: [{
            u0: 0.245, u1: 0.735, y0: 0.95, y1: 3.5, mull: 1, frame: 0x2a4a9a, bulkhead: { brick: 0x9a4a3a },
            panels: { color: 0xc8a064, h: 1.2 }, neon: [['BUD LIGHT', 0xf0f0ff], ['BUSCH LIGHT', 0x7ab0ff]]
        }],
        awnings: [{ u0: 0.17, u1: 0.95, y1: 5.3, y0: 3.85, out: 1.35, val: 0.28, color: 0x1e5ae6, slopeText: { kind: 'fishbowl', t: 0.5, u: 0.56, w: 3.6, h: 1.6 } }],
        bands: [{ y0: 6.25, y1: 6.95, out: 0.1, tex: 'ornament', color: 0xb06a48 }],
        upperWindows: [{ u: 0.3, w: 1.0, y0: 7.4, y1: 8.95 }, { u: 0.7, w: 1.0, y0: 7.4, y1: 8.95 }],
        cornice: { color: 0x6a3a2a, out: 0.15, h: 0.3 }
    },
    'Shots Inc.': {
        door: 0.8, doorW: 0.95,
        ground: { kind: 'batten', color: 0x968a74 }, groundTop: 4.05,
        upper: { kind: 'paint', color: 0xa69c8e },
        doors: { main: { style: 'panel6', color: 0x9aa6b4, h: 2.3, frame: 0xb8b0a0 } },
        fakeDoors: [{ u: 0.115, w: 0.85, h: 2.25, color: 0xeeeeee, style: 'panel6', frame: 0xe8e8e8 }],
        windows: [{ u0: 0.32, u1: 0.44, y0: 1.2, y1: 2.05, frame: 0xf0f0f0, sill: 0xf0f0f0, tint: true, neon: [['BUD LIGHT', 0x3a7aff]] }],
        pilasters: [{ u0: 0.9, u1: 1.0, color: 0xa69c8e, out: 0.14 }],
        awnings: [{ u0: 0.025, u1: 0.895, y1: 4.0, y0: 3.2, out: 1.15, val: 0.44, color: 0x2c2e32, valText: { art: 'shots', text: 'SHOTS INC.', color: 0xf4f4f0, w: 3.8, u: 0.42, scale: 0.8 } }],
        bands: [{ y0: 4.05, y1: 4.25, out: 0.15, color: 0x8a8274 }],
        upperWindows: [{ u: 0.12, w: 1.0, y0: 5.4, y1: 7.0, trim: 0xd8d0c0 }, { u: 0.42, w: 1.0, y0: 5.4, y1: 7.0, trim: 0xd8d0c0 }, { u: 0.72, w: 1.0, y0: 5.4, y1: 7.0, trim: 0xd8d0c0 }],
        cornice: { color: 0x8a8274, out: 0.15, h: 0.25 }
    },
    'City Tap': {
        door: 0.44, doorW: 1.0, colliderTop: 4.75 + 1.2,
        ground: { kind: 'siding', color: 0xc4b494, boards: 4 }, groundTop: 4.75, noUpper: true,
        doors: {
            main: { style: 'wood', color: 0x8a6a48, h: 2.45, frame: 0x6a5038 },
            stairs: { style: 'flat', color: 0x1e1e22, h: 2.4, recess: 0.3, frame: 0x1a1a1a }
        },
        windows: [
            { u0: 0.06, u1: 0.29, y0: 0.75, y1: 2.5, mull: 2, frame: 0x1a1a1a, tint: true },
            { u0: 0.305, u1: 0.385, y0: 0.9, y1: 2.1, frame: 0x8a6a48, posters: true },
            { u0: 0.55, u1: 0.8, y0: 0.75, y1: 2.5, mull: 2, frame: 0x1a1a1a, neon: [['ON TAP', 0xffb03a]] }
        ],
        awnings: [{ style: 'flat', u0: 0.02, u1: 0.98, y0: 2.75, y1: 3.45, out: 0.85, color: 0x141416, frontText: { kind: 'atticWhite', u: 0.86, w: 2.0, h: 0.45 } }],
        bands: [{ y0: 3.75, y1: 3.92, color: 0x3a2a22, out: 0.02 }, { y0: 4.27, y1: 4.44, color: 0x3a2a22, out: 0.02 }, { y0: 4.5, y1: 4.78, color: 0x222224, out: 0.06 }],
        signs: [{ kind: 'citytap', u: 0.33, y: 3.98, w: 1.8, h: 1.0, x: 0.1, back: { depth: 0.1, color: 0x111111 } }],
        extra: (h) => buildAtticUpstairs(h)
    }
};

/** The Cla-Zel: pink marquee with letter boards and bulbs, terra-cotta arches and pilasters above. */
function buildClazel(h) {
    const { k, Z, H } = h;
    const pink = M.color(0xd8908a, 0.12), pinkDark = M.color(0xb86a66, 0.1);
    const za = Z(0.84), zb = Z(0.06), out = 2.1, y0 = 3.55, y1 = 4.75;
    k.block(pink, 0, y0, za, out, y1, zb);
    k.block(pinkDark, out - 0.02, y0 - 0.08, za - 0.05, out + 0.06, y0 + 0.08, zb + 0.05);
    k.block(pinkDark, out - 0.02, y1 - 0.08, za - 0.05, out + 0.06, y1 + 0.08, zb + 0.05);
    const board = M.sign('fclazel_board', letterBoardTex(['DANCE NIGHT · FRI & SAT · 18+'], { fg: 0xc81a2a }));
    k.plane(board, (zb - za) * 0.68, 0.72, out + 0.065, (y0 + y1) / 2, Z(0.52), { ry: PI / 2 });
    k.plane(M.sign('fclazel_board2', letterBoardTex(['DJ', 'LIVE'], { fg: 0xc81a2a })), (zb - za) * 0.17, 0.8, out + 0.065, (y0 + y1) / 2, Z(0.13), { ry: PI / 2 });
    const sideBoard = M.sign('fclazel_side', letterBoardTex(['CLA-ZEL', 'DANCE CLUB'], { fg: 0xc81a2a }));
    k.plane(sideBoard, out - 0.3, 0.8, out / 2, (y0 + y1) / 2, zb + 0.01, {});
    k.plane(sideBoard, out - 0.3, 0.8, out / 2, (y0 + y1) / 2, za - 0.01, { ry: PI });
    // Crest on top with the script name, and the name in red neon over each end
    k.block(pink, out - 0.5, y1, Z(0.66), out, y1 + 0.45, Z(0.38));
    k.block(pink, out - 0.5, y1 + 0.45, Z(0.6), out, y1 + 0.75, Z(0.44));
    k.plane(M.sign('fclazel_script', neonTex('Clazel', 0xff5a6a, { script: true })), 2.6, 0.82, out + 0.01, y1 + 0.42, Z(0.52), { ry: PI / 2 });
    for (const u of [0.13, 0.78]) k.plane(M.sign('fclazel_neon', neonTex('CLA-ZEL', 0xff3a3a)), 1.8, 0.56, out - 0.6, y1 + 0.3, Z(u), { ry: PI / 2 });
    // Bulbs underneath
    const bulb = M.bulb();
    for (let x = 0.3; x < out - 0.1; x += 0.45) for (let z = za + 0.3; z < zb - 0.2; z += 0.45) k.sphere(bulb, 0.04, x, y0 - 0.06, z, 6);
    k.flat(M.color(0xe8d0c0, 0.3), 0, za, out, zb, y0 - 0.01, { up: false });
    // Tie rods up to the wall
    for (const u of [0.1, 0.8]) {
        const dx = out - 0.2, dy = 7.3 - y1, L = Math.hypot(dx, dy);
        k.cyl(M.color(0xd8d8d8, 0.1), 0.025, 0.025, L, (out - 0.2) / 2, (y1 + 7.3) / 2, Z(u), { rz: Math.atan2(dx, dy), seg: 6 });
    }
    // Upper front: three windows under white terra-cotta arches, two brick-arched windows, two plain
    const white = M.color(0xf0ece2, 0.1);
    for (const [u0, u1] of [[0.275, 0.365], [0.385, 0.495], [0.51, 0.6]]) upperWindow(h, { u: (u0 + u1) / 2, w: (u1 - u0) * h.W, y0: 5.6, y1: 7.0, trim: 0xf0ece2, arch: 'white', archColor: 0xf0ece2 });
    for (const u of [0.262, 0.375, 0.502, 0.612]) k.block(white, 0, 5.4, Z(u) - 0.1, 0.1, 7.9, Z(u) + 0.1);
    k.block(white, 0, 7.9, Z(0.62), 0.12, 8.1, Z(0.255));
    for (const u of [0.165, 0.73]) upperWindow(h, { u, w: 0.085 * h.W, y0: 5.6, y1: 7.0, trim: 0xd8ccb0, arch: 'brick', archColor: 0xa88a5a });
    for (const u of [0.04, 0.86]) upperWindow(h, { u, w: 0.05 * h.W, y0: 5.7, y1: 7.5, trim: 0xd8ccb0 });
    const dia = M.cutout('fdiamond', ART.diamond());
    for (const [u, y] of [[0.165, 8.6], [0.73, 8.6], [0.44, 8.9]]) k.plane(dia, 0.45, 0.45, 0.02, y, Z(u), { ry: PI / 2 });
    k.block(M.color(0xd8ccb0), 0, 3.45, -h.W2, 0.1, 3.6, h.W2);
}

/**
 * City Tap with The Attic upstairs: the upstairs bar sits back behind a rooftop patio across
 * the front, with a railing on the parapet, a stair house over the stairs up from the street,
 * and the set-back front in tan ribbed cladding with the blue letters and a canopy.
 */
function buildAtticUpstairs(h) {
    const { k, sf, W2, H, T, UP, top } = h;
    const st = sf.stairs;
    const P = sf.upper.spec.patio || 5.5;
    const za = Math.min(st.z0, st.z1) - 0.15, zb = Math.max(st.z0, st.z1) + 0.15;
    const inner = st.side > 0 ? za : zb;
    // Railing along the parapet, across the patio
    const r0 = st.side > 0 ? -W2 + T : inner, r1 = st.side > 0 ? inner : W2 - T;
    railing(k, r0, r1, -0.12, top, top + 0.95, 0x141414);
    // Stair house: front wall over the stairs door, the side along the patio, a roof
    const tan = wallMat({ kind: 'ribbed', color: 0xc8b898 });
    const s0 = st.side > 0 ? inner : -W2, s1 = st.side > 0 ? W2 : inner;
    k.block(tan.m, -T, top, s0, 0, H, s1, { tile: tan.tile });
    k.collide(-T, s0, 0, s1, top, H);
    k.block(tan.m, -P, UP, inner - 0.08, 0, H, inner + 0.08, { tile: tan.tile });
    k.collide(-P, inner - 0.1, 0, inner + 0.1, UP, H);
    k.block(M.color(0x2a2a2a, 0.05), -P, H - 0.2, s0, 0.05, H + 0.1, s1);
    // On the set-back front: the blue letters and a black canopy with a blue edge and bulbs
    const zl0 = st.side > 0 ? -W2 + T : inner, zl1 = st.side > 0 ? inner : W2 - T;
    const span = zl1 - zl0;
    k.plane(M.sign('fattic_blue', ART_TEXT.atticBlue()), Math.min(3.2, span * 0.3), 0.7, -P + 0.04, H - 1.25, zl1 - Math.min(3.2, span * 0.3) / 2 - 0.4, { ry: PI / 2 });
    const c0 = zl0 + 0.4, c1 = zl1 - Math.min(3.2, span * 0.3) - 0.9;
    if (c1 > c0 + 1) {
        const cy1 = H - 0.6, cy0 = H - 1.5, cout = 1.6;
        const ang = Math.atan2(cy1 - cy0, cout);
        k.box(M.color(0x141416, 0.06), Math.hypot(cout, cy1 - cy0), 0.06, c1 - c0, -P + cout / 2, (cy0 + cy1) / 2, (c0 + c1) / 2, { rz: -ang });
        k.block(M.color(0x2a7ad8, 0.3), -P + cout - 0.02, cy0 - 0.16, c0, -P + cout + 0.03, cy0 + 0.02, c1);
        for (let z = c0 + 0.2; z < c1; z += 0.35) k.sphere(M.bulb(), 0.035, -P + cout + 0.05, cy0 - 0.08, z, 6);
    }
    k.block(M.color(0x2a2a2a, 0.05), -P - 0.3, H - 0.05, -W2, -P + 0.1, H + 0.15, W2);
}

// ------------------------------------------------------------------------------------------------
// Builder
// ------------------------------------------------------------------------------------------------
export function frontFor(name) { return FRONTS[name] || null; }

/**
 * Builds storefront `sf`'s street front from FRONTS[sf.name] into Kit `k`. `env` carries the
 * shell's measurements and helpers from bars.js: { T, G, UP, STOREY, wallWithHoles }.
 * Leaves `sf.frontHoles` (the openings in the ground-floor front) for the rooms' inside finish.
 */
export function buildFront(k, sf, env) {
    const def = FRONTS[sf.name];
    const { T, G } = env;
    const W = sf.W, W2 = W / 2, H = sf.H;
    const Z = (u) => W2 - u * W;
    const top = def.groundTop !== undefined ? Math.min(def.groundTop, H) : (sf.levels >= 2 ? G : H);
    const groundMat = wallMat(def.ground);
    const upperMat = def.upper ? wallMat(def.upper) : groundMat;
    const h = { k, sf, env, def, W, W2, H, T, G, UP: env.UP, Z, top, groundMat, upperMat };

    // Openings in the ground floor: the doors (bars.js _plan placed them) and the windows
    const holes = [];
    const doors = sf.doors.map((d) => {
        const st = Object.assign({ h: d.kind === 'stairs' ? 2.4 : 2.6, transom: 0, style: 'glass', recess: 0 }, (def.doors || {})[d.kind] || {});
        const dTop = Math.min(top - 0.1, st.h + st.transom);
        holes.push({ z0: d.z0, z1: d.z1, y0: 0, y1: dTop });
        return { ...d, ...st, top: dTop };
    });
    const wins = (def.windows || []).map((w) => ({ ...w, z0: Z(w.u1), z1: Z(w.u0) }));
    for (const w of wins) holes.push({ z0: w.z0, z1: w.z1, y0: w.y0, y1: Math.min(w.y1, top - 0.05) });
    sf.frontHoles = holes.map((o) => ({ ...o }));
    env.wallWithHoles(k, groundMat.m, -T, 0, 0, top, -W2, W2, holes, groundMat.tile);
    if (H > top + 0.01 && !def.noUpper) k.block(upperMat.m, -T, top, -W2, 0, H, W2, { tile: upperMat.tile });

    // Colliders: the whole front but the doorways
    const ctop = def.colliderTop !== undefined ? def.colliderTop : H;
    {
        let z = -W2;
        for (const d of [...doors].sort((a, b) => a.z0 - b.z0)) {
            if (d.z0 > z) k.collide(-T, z, 0, d.z0, 0, ctop);
            k.collide(-T, d.z0, 0, d.z1, d.top, ctop);
            z = d.z1;
        }
        if (z < W2) k.collide(-T, z, 0, W2, 0, ctop);
    }

    for (const d of doors) buildDoor(h, d);
    for (const f of def.fakeDoors || []) buildFakeDoor(h, f);
    for (const w of wins) buildWindow(h, w);
    for (const p of def.pilasters || []) {
        const pm = p.color !== undefined ? M.color(p.color) : groundMat.m;
        k.block(pm, 0, p.y0 || 0, Z(p.u1), p.out || 0.06, p.y1 !== undefined ? p.y1 : H, Z(p.u0));
    }
    for (const b of def.bands || []) {
        const bm = b.tex === 'ornament' ? M.tex(`fornament_${b.color}`, ornamentTex(b.color)) : M.color(b.color);
        const z0 = b.u1 !== undefined ? Z(b.u1) : -W2, z1 = b.u0 !== undefined ? Z(b.u0) : W2;
        k.block(bm, -0.02, b.y0, z0, b.out || 0.05, b.y1, z1, { tile: [1.2, b.y1 - b.y0] });
    }
    for (const s of def.shingles || []) {
        const sm = M.tex('fshingle', shingleTex(0x8a5a40), 0.06);
        const z0 = Z(s.u1), z1 = Z(s.u0);
        const ang = Math.atan2(s.y1 - s.y0, s.out), L = Math.hypot(s.out, s.y1 - s.y0);
        k.box(sm, L + 0.1, 0.08, z1 - z0, s.out / 2, (s.y0 + s.y1) / 2, (z0 + z1) / 2, { rz: -ang, tile: [1, 1] });
        k.block(M.color(0x3a2418), s.out - 0.04, s.y0 - 0.18, z0, s.out + 0.04, s.y0 + 0.02, z1);
        const side = M.cutout('fshingleside', awningSideTex(0x3a2418, 0.15, false));
        for (const z of [z0 + 0.01, z1 - 0.01]) k.plane(side, s.out, (s.y1 - s.y0) * 1.18, s.out / 2, (s.y1 + s.y0 - 0.18) / 2, z, {});
    }
    for (const a of def.awnings || []) buildAwning(h, a);
    for (const b of def.boards || []) {
        const z = Z(b.u);
        k.block(M.color(0x8a8c8e, 0.1), 0, b.y - b.h / 2 - 0.05, z - b.w / 2 - 0.05, 0.06, b.y + b.h / 2 + 0.05, z + b.w / 2 + 0.05);
        k.plane(M.sign(`fboard_${b.lines.join('|')}`, letterBoardTex(b.lines)), b.w, b.h, 0.065, b.y, z, { ry: PI / 2 });
    }
    for (const s of def.signs || []) buildSign(h, s);
    if (def.vertical) {
        const v = def.vertical;
        k.plane(M.sign(`fvert_${v.text}`, verticalTex(v.text, v.bg, v.fg)), v.w, v.h, 0.03, v.y, Z(v.u), { ry: PI / 2 });
    }
    for (const l of def.lamps || []) lamp(k, Z(l.u), l.y);
    const uw = typeof def.upperWindows === 'function' ? def.upperWindows(h) : (def.upperWindows || []);
    for (const w of uw) upperWindow(h, w);
    if (def.extra) def.extra(h);
    // Cornice and coping
    if (!def.noUpper) {
        const c = def.cornice || { color: 0x2a2a2a, out: 0.1, h: 0.25 };
        k.block(M.color(c.color), -0.02, H - c.h, -W2, c.out, H, W2);
        if (c.trim2 !== undefined) k.block(M.color(c.trim2), -0.02, H - c.h - 0.12, -W2, c.out * 0.7, H - c.h, W2);
        k.block(M.color(0x3a3a3a, 0.04), -T, H, -W2, Math.min(0.05, c.out), H + 0.12, W2);
    }
}

function verticalTex(text, bg, fg) {
    const chars = [...text];
    return card(`fvlabel_${text}_${bg}_${fg}`, 96, 96 * chars.length, (g, w, h) => {
        g.fillStyle = hex(bg); g.fillRect(0, 0, w, h);
        centered(g); g.fillStyle = hex(fg); g.font = `bold 72px ${SLAB}`;
        chars.forEach((c, i) => g.fillText(c, w / 2, 96 * i + 50));
    });
}

/** Video shelves standing just inside Vice & Video's window, their covers facing the street. */
export function viceShelves(k, sf, room) {
    const def = FRONTS[sf.name];
    const w = def && def.windows && def.windows.find((o) => o.vhs);
    if (!w) return;
    const W2 = sf.W / 2;
    const a = Math.max(room.z0 + 0.2, W2 - w.u1 * sf.W + 0.2), b = Math.min(room.z1 - 0.2, W2 - w.u0 * sf.W - 0.2);
    const vm = M.tex('fvhs', ART.vhs(), 0.3);
    const x1 = room.x1 - 0.35, x0 = x1 - 0.35;
    k.block(M.color(0xd8d8d8, 0.25), x0, room.y, a, x1, room.y + 2.0, b);
    k.plane(vm, b - a - 0.06, 1.9, x1 + 0.006, room.y + 1.0, (a + b) / 2, { ry: PI / 2, tile: [1.2, 1.2] });
    k.plane(vm, b - a - 0.06, 1.9, x0 - 0.006, room.y + 1.0, (a + b) / 2, { ry: -PI / 2, tile: [1.2, 1.2] });
    k.collide(x0, a, x1, b, room.y, room.y + 2.0);
}
