/**
 * js/game/drugFx.js
 *
 * What drugs do to the picture, plus the smoke you breathe out.
 *
 * DrugPostFX: while anything is in the player's system the world is rendered into an HDR target and
 * run through one full-screen shader driven by DrugEffects' state (drugs.js): colour (saturation,
 * contrast, brightness, tint, hue cycling), blur, waves and breathing, chromatic aberration,
 * double vision, trails (feedback from the previous frame), a kaleidoscope, tunnel vision, a white
 * flash, blacking out, a paranoid shadow figure at the edge of the screen and film grain. A final
 * pass applies the renderer's tone mapping and output colour space, so the picture matches the
 * normal path. With nothing in your system the scene renders straight to the screen as before.
 *
 * SmokePuffs: soft sprites in the world for exhaled smoke and vapour.
 */

import * as THREE from 'three';

// When each DMT hyperspace scene starts (seconds after the burst), painted after media/dmt.jpg (the net of
// faces and galaxy eyes), dmt2.jpg (the crystal dome) and dmt3.jpeg (the blacklight temple)
export const DMT_SCENES = [0, 42, 84];

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FX_FRAG = /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tPrev;
uniform vec2 uRes;
uniform float uTime;
uniform float uHasPrev;
uniform float uHue, uSat, uContrast, uBright, uTintAmt;
uniform vec3 uTint;
uniform float uVignette, uBlur, uWave, uBreathe, uChroma, uGhost, uTrail, uKaleido, uFlash, uDark, uGrain;
uniform float uFigureX, uFigureA;
uniform float uDrift, uPattern, uEdges, uSnow, uGlow, uTakeover;
uniform float uTracer;
varying vec2 vUv;

vec3 tex(vec2 uv) { return texture2D(tScene, clamp(uv, 0.001, 0.999)).rgb; }

// ---- Psilocybin ----
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
    float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
    float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
    return vnoise(p) * 0.55 + vnoise(p * 2.03 + 7.1) * 0.3 + vnoise(p * 4.1 + 3.7) * 0.15;
}
// Cosine palette: the saturated rainbow the patterns come in
vec3 palette(float t) {
    return 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + t));
}
// Filigree: a folded fractal (each fold mirrors and inverts the plane), lines where the orbit
// passes the unit circle. Lattices, paisley, the "carpet" people describe.
float filigree(vec2 z, float t) {
    float acc = 0.0;
    vec2 c = vec2(0.78 + 0.06 * sin(t * 0.21), 0.62 + 0.05 * cos(t * 0.17));
    for (int i = 0; i < 6; i++) {
        z = abs(z) / max(dot(z, z), 0.02) - c;
        acc += exp(-abs(length(z) - 0.9) * 7.0);
    }
    return acc / 6.0;
}
// n-fold mirror symmetry about the centre
vec2 mandalaFold(vec2 c, float n) {
    float seg = 6.28318 / n;
    float a = mod(atan(c.y, c.x), seg);
    a = abs(a - seg * 0.5);
    return vec2(cos(a), sin(a)) * length(c);
}

// ---- DMT: hyperspace (after media/dmt.mp4) ----
uniform float uDmt, uDmtT, uDmtBreak, uDmtSmear, uDmtFlash, uSceneA, uSceneB, uSceneMix;
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
mat2 rot(float a) { float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }
// (squared: sharp neon lines on black, not a haze)
float glowLine(float d, float w) { float g = w / (abs(d) + w); return g * g; }
// ---- DMT hyperspace, painted after media/dmt.jpg, dmt2.jpg, dmt3.jpeg ----
// Each scene is a field: colour plus a height, lit as carved relief (bevels, shadow, a hard
// highlight), so it reads as sculpted and painted rather than flat. Everything melts and flows
// (a domain warp), breathes, turns and strobes.

// Nested arches: 1 on an arch of half-width 1 (a round top over straight sides), less inside it
float archR(vec2 p) { return p.y > 0.0 ? length(p) : (p.y > -1.6 ? abs(p.x) : 10.0); }
// Offset from the nearest centre of a hex lattice (spacing 1)
vec2 hexNear(vec2 p) {
    vec2 s = vec2(1.0, 1.7320508);
    vec2 a = mod(p, s) - s * 0.5;
    vec2 b = mod(p - s * 0.5, s) - s * 0.5;
    return dot(a, a) < dot(b, b) ? a : b;
}
// The seed of life: interlocking circles on a hex lattice (distance to the nearest circle)
float seedOfLife(vec2 p) {
    vec2 s = vec2(1.0, 1.7320508);
    vec2 a = mod(p, s) - s * 0.5;
    vec2 b = mod(p - s * 0.5, s) - s * 0.5;
    return min(abs(length(a) - 0.577), abs(length(b) - 0.577));
}
// Signed distance to an equilateral triangle (radius ~1)
float tri(vec2 p) {
    const float k = 1.7320508;
    p.x = abs(p.x) - 1.0;
    p.y = p.y + 1.0 / k;
    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0, 0.0);
    return -length(p) * sign(p.y);
}
vec3 hueSpin(vec3 c, float a) {
    const vec3 k = vec3(0.57735);
    float ca = cos(a);
    return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
// Lights a field as relief: base colour, its height here and a step right / up
vec3 relief(vec3 base, float h, float hx, float hy, float eps, float bump, float spec) {
    vec3 n = normalize(vec3(-(hx - h) / eps * bump, -(hy - h) / eps * bump, 1.0));
    vec3 L = normalize(vec3(-0.45, 0.6, 0.66));
    float dif = max(dot(n, L), 0.0);
    float sp = pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 36.0) * spec;
    float ao = 0.55 + 0.45 * clamp(h, 0.0, 1.0);
    return base * (0.28 + 0.95 * dif) * ao + vec3(sp);
}

// ======== 1: the net of being ========
// A sculpted red face (face space: about 2 wide, 2.6 tall). rgb, height (a < 0: not here)
vec4 netFace(vec2 q, float t, float seed) {
    float head = length(q * vec2(1.0, 0.78)) - 1.0;
    // (the top of the head opens into the net, like a headdress)
    if (head > 0.02 || q.y > 0.62 + 0.08 * sin(q.x * 9.0 + t)) return vec4(0.0, 0.0, 0.0, -1.0);
    float strokes = 0.5 + 0.5 * sin(head * 95.0 + sin(q.x * 13.0 + q.y * 7.0) * 1.4);
    float cheek = smoothstep(0.55, 0.0, length((vec2(abs(q.x), q.y) - vec2(0.45, -0.18)) * vec2(1.0, 1.4)));
    vec3 col = vec3(0.62, 0.05, 0.04) * (0.85 + 0.25 * strokes) + vec3(0.3, 0.07, 0.03) * cheek;
    float h = 0.55 + 0.45 * sqrt(clamp(-head, 0.0, 1.0)) + 0.02 * strokes + 0.1 * cheek;
    float brow = abs(q.y - 0.34 - 0.1 * cos(q.x * 2.4));
    h += 0.14 * smoothstep(0.2, 0.0, brow) * step(abs(q.x), 0.85);
    for (int e = 0; e < 2; e++) {
        vec2 ep = q - vec2(e == 0 ? -0.38 : 0.38, 0.12);
        h -= 0.18 * smoothstep(0.12, -0.12, length(ep * vec2(1.0, 1.6)) - 0.3);
        vec2 eq = ep / 0.26;
        float lens = max(length(eq + vec2(0.0, 0.55)), length(eq - vec2(0.0, 0.55))) - 0.85;
        if (lens < 0.0) {
            vec2 look = vec2(0.12 * sin(t * 0.6 + seed), 0.05 * sin(t * 0.43 + seed * 2.0));
            float ir = length(eq - look);
            float ia = atan(eq.y - look.y, eq.x - look.x);
            vec3 ec = vec3(0.93, 0.89, 0.8) * (0.8 + 0.2 * smoothstep(0.85, 0.3, length(eq)));
            vec3 iris = mix(vec3(0.95, 0.72, 0.18), vec3(0.25, 0.6, 0.18), 0.5 + 0.5 * sin(ir * 70.0 + ia * 9.0));
            iris *= 0.7 + 0.5 * smoothstep(0.34, 0.12, ir);
            ec = mix(ec, iris, smoothstep(0.36, 0.32, ir));
            ec = mix(ec, vec3(0.01), smoothstep(0.14, 0.11, ir));
            ec += vec3(0.7) * smoothstep(0.08, 0.0, length(eq - look - vec2(-0.13, 0.13)));
            col = ec;
            h = 0.5 + 0.08 * smoothstep(0.85, 0.0, length(eq));
        }
        col = mix(col, vec3(0.18, 0.0, 0.0), smoothstep(0.07, 0.0, abs(lens)) * 0.9);
    }
    float nw = 0.07 + 0.15 * clamp(-q.y + 0.1, 0.0, 0.55);
    h += 0.22 * smoothstep(nw, 0.0, abs(q.x)) * step(-0.45, q.y) * step(q.y, 0.2);
    for (int s = -1; s <= 1; s += 2) {
        float ns = length((q - vec2(float(s) * 0.09, -0.44)) * vec2(1.0, 1.8)) - 0.05;
        col = mix(col, vec3(0.2, 0.0, 0.0), smoothstep(0.02, 0.0, ns));
        h -= 0.1 * smoothstep(0.03, 0.0, ns);
    }
    float lip = abs(q.y + 0.66 + 0.05 * cos(q.x * 4.0));
    float lipK = smoothstep(0.08, 0.02, lip) * smoothstep(0.34, 0.24, abs(q.x));
    col = mix(col, vec3(0.42, 0.02, 0.05), lipK);
    h += 0.06 * lipK;
    col = mix(col, vec3(0.2, 0.0, 0.0), smoothstep(0.015, 0.0, abs(q.y + 0.66 + 0.05 * cos(q.x * 4.0))) * smoothstep(0.34, 0.24, abs(q.x)));
    col = mix(col, vec3(1.0, 0.85, 0.68), smoothstep(0.05, 0.0, abs(head)) * 0.65);
    return vec4(col, h);
}
vec4 netField(vec2 c, float t) {
    float r = length(c), a = atan(c.y, c.x);
    // The lattice: cells on rings round the middle, shrinking into it (a conformal tunnel)
    float N = 24.0;
    vec2 g = vec2(a / 6.28318 * N, log(r + 0.001) * N / 6.28318 - t * 0.4);
    vec2 id = floor(g), f = fract(g) - 0.5;
    float hh = hash21(vec2(mod(id.x, N), id.y));
    float e = max(abs(f.x), abs(f.y));
    float fa = atan(f.y, f.x);
    float flame = 0.5 + 0.5 * sin(fa * 14.0 + e * 42.0 - t * 2.4 + hh * 6.0);
    vec3 col = mix(vec3(0.5, 0.03, 0.03), vec3(0.98, 0.28, 0.12), flame * smoothstep(0.18, 0.5, e));
    float h = 0.32 + 0.25 * flame * smoothstep(0.22, 0.5, e) - 0.35 * smoothstep(0.43, 0.5, e);
    float lens = max(length(f + vec2(0.0, 0.26)), length(f - vec2(0.0, 0.26))) - 0.42;
    if (lens < 0.03) {
        float ir = length(f);
        float sw = 0.5 + 0.5 * sin(atan(f.y, f.x) * 2.0 + log(ir + 0.01) * 6.0 - t * (2.0 + hh * 2.0));
        vec3 gal = mix(vec3(0.04, 0.07, 0.42), vec3(0.78, 0.86, 1.0), sw * smoothstep(0.17, 0.0, ir));
        gal = mix(vec3(0.95, 0.93, 0.9), gal, smoothstep(0.18, 0.15, ir));
        gal = mix(gal, vec3(0.01), smoothstep(0.035, 0.02, ir));
        float k = smoothstep(0.02, -0.01, lens);
        col = mix(col, gal, k);
        h = mix(h, 0.55 + 0.12 * smoothstep(0.17, 0.0, ir), k);
        col = mix(col, vec3(0.13, 0.0, 0.0), smoothstep(0.035, 0.0, abs(lens)) * 0.85);
    }
    vec2 nd = fract(g);
    float dn = length(min(nd, 1.0 - nd));
    col = mix(col, vec3(0.12, 0.8, 0.3), smoothstep(0.1, 0.07, dn));
    col = mix(col, vec3(0.0), smoothstep(0.035, 0.02, dn));
    h += 0.12 * smoothstep(0.11, 0.05, dn);
    // The faces watching, either side
    for (int i = 0; i < 2; i++) {
        float side = i == 0 ? -1.0 : 1.0;
        vec4 fc = netFace((c - vec2(side * 0.56, -0.02)) / 0.22, t, side);
        if (fc.a >= 0.0) { col = fc.rgb; h = fc.a; }
    }
    // The tunnel between them: nested rainbow arches, windowed, falling away to white
    vec2 ap = (c - vec2(0.0, -0.06)) / vec2(0.19, 0.2);
    float ar = archR(ap);
    if (ar < 1.0) {
        float lv = log(max(ar, 0.015)) * 3.2 + t * 0.9;
        float band = floor(lv), fb = fract(lv);
        float per = ap.y > 0.0 ? atan(ap.y, ap.x) : (ap.x > 0.0 ? ap.y : 3.14159 - ap.y);
        float win = step(0.35, fract(per * 6.0 / max(ar, 0.15) + band * 0.5)) * step(0.25, fb) * step(fb, 0.8);
        col = palette(band * 0.11 + 0.02) * (0.65 + 0.45 * win);
        col = mix(col, vec3(1.0, 0.97, 0.9), smoothstep(0.32, 0.0, ar));
        h = 0.25 + 0.3 * sin(fb * 3.14159) - 0.12 * win;
    }
    col = mix(col, vec3(1.0, 0.88, 0.72), smoothstep(0.07, 0.0, abs(ar - 1.0)) * 0.85);
    return vec4(col, h);
}

// ======== 2: the crystal dome ========
// A faceted star tetrahedron (12 facets lit differently), radius s
vec4 starTetra(vec2 p, float s, float t) {
    vec2 q = p / s;
    float d = min(tri(q), tri(vec2(q.x, -q.y)));
    if (d > 0.06) return vec4(0.0, 0.0, 0.0, -1.0);
    float sector = floor((atan(q.y, q.x) + 3.14159) / 0.5236);
    vec3 col = palette(sector * 0.083 + t * 0.12) * (0.55 + 0.45 * mod(sector, 2.0)) + vec3(0.25);
    return vec4(col * 1.3, 0.9 - length(q) * 0.3);
}
vec4 domeField(vec2 c, float t) {
    vec2 d = c - vec2(0.0, 0.2);
    float r = length(d), a = atan(d.y, d.x);
    // Crystal pyramids on a triangle lattice, converging into the funnel
    float N = 30.0;
    vec2 p = vec2(a / 6.28318 * N, log(r + 0.01) * N / 6.28318 - t * 0.45);
    vec3 s3 = vec3(p.x, dot(p, vec2(0.5, 0.866)), dot(p, vec2(-0.5, 0.866)));
    vec3 fr = fract(s3);
    vec3 dd = min(fr, 1.0 - fr);
    float lineD = min(min(dd.x, dd.y), dd.z);
    vec3 fr2 = fract(s3 * 2.0);
    vec3 dd2 = min(fr2, 1.0 - fr2);
    float l2 = min(min(dd2.x, dd2.y), dd2.z);
    float h = lineD * 1.8 + 0.12 * smoothstep(0.07, 0.0, l2);
    float hue = 0.47 + 0.16 * sin(p.y * 0.22 + t * 0.35) + 0.1 * sin(a * 3.0 - t * 0.2);
    vec3 col = palette(hue + lineD * 0.7 + 0.15 * smoothstep(0.07, 0.0, l2));
    col = mix(col, vec3(0.85, 1.0, 1.0), smoothstep(0.035, 0.0, lineD) * 0.55);
    col *= smoothstep(0.0, 0.1, r);
    // The funnel: a lotus of ribs and rings opening upwards
    vec2 q = c - vec2(0.0, 0.08);
    float w = 0.015 + 1.35 * q.y - 2.0 * q.y * q.y;
    if (q.y > 0.0 && q.y < 0.3 && abs(q.x) < w) {
        float rib = 0.5 + 0.5 * cos(atan(q.x, q.y + 0.03) * 70.0);
        float ring = 0.5 + 0.5 * cos(q.y * 140.0 - t * 4.0);
        col = mix(vec3(0.98, 0.9, 0.78), palette(0.6 + q.y * 3.0 + rib * 0.2 - t * 0.1), 0.35 + 0.5 * rib) * (0.55 + q.y * 2.6) * (0.8 + 0.2 * ring);
        h = 0.6 + 0.25 * rib + 0.1 * ring - 0.4 * pow(abs(q.x) / w, 4.0);
    }
    // A shaft of light down from it
    float beam = smoothstep(0.03, 0.0, abs(c.x)) * step(0.0, c.y) * step(c.y, 0.09);
    col = mix(col, vec3(1.0, 0.55, 0.75) * 1.4, beam * 0.8);
    // The bell of geometry under the star, and bubbles of it all round
    float by = -0.02 - c.y;
    float bw = 0.05 + 0.42 * pow(max(by, 0.0), 0.72);
    if (by > 0.0 && abs(c.x) < bw) {
        float sl = seedOfLife(vec2(c.x, c.y) * 16.0);
        float sh = sqrt(max(0.0, 1.0 - pow(c.x / bw, 2.0)));
        col = palette(0.32 + by * 1.3 + t * 0.03 + 0.1 * smoothstep(0.1, 0.0, sl)) * (0.35 + 0.9 * smoothstep(0.035, 0.0, sl));
        h = 0.5 * sh + 0.15 * smoothstep(0.04, 0.0, sl);
    }
    for (int i = 0; i < 10; i++) {
        float fi = float(i);
        if (abs(fi - 4.5) < 0.6) continue;
        vec2 oc = vec2(-0.85 + fi * 0.19 + 0.03 * sin(fi * 3.1), -0.41 + 0.07 * sin(fi * 2.7) + 0.02 * sin(t * 1.3 + fi));
        float rad = 0.09 + 0.06 * fract(fi * 0.618);
        vec2 p2 = (c - oc) / rad;
        float rr = length(p2);
        if (rr < 1.0) {
            float sz = sqrt(1.0 - rr * rr);
            vec2 sp = p2 / (0.4 + 0.6 * sz);             // the pattern wraps round the ball
            float sl = seedOfLife(rot(t * 0.25 + fi) * sp * 2.2);
            col = palette(fi * 0.17 + t * 0.05 + 0.15 * smoothstep(0.1, 0.0, sl)) * (0.3 + 0.95 * smoothstep(0.04, 0.0, sl));
            h = sz * 0.9 + 0.12 * smoothstep(0.05, 0.0, sl);
        }
    }
    vec4 st = starTetra(c, 0.055, t);
    if (st.a >= 0.0) { col = st.rgb; h = st.a; }
    for (int i = -1; i <= 1; i += 2) {
        vec4 s2 = starTetra(c - vec2(float(i) * 0.31, -0.11 + 0.01 * float(i)), 0.03, t + float(i));
        if (s2.a >= 0.0) { col = s2.rgb; h = s2.a; }
    }
    return vec4(col, h);
}

// ======== 3: the blacklight temple ========
vec4 templeField(vec2 c, float t) {
    vec3 orange = vec3(0.95, 0.28, 0.02), yellow = vec3(0.95, 0.6, 0.04), blue = vec3(0.03, 0.12, 0.9);
    vec3 green = vec3(0.05, 0.85, 0.3), mag = vec3(0.85, 0.04, 0.5), red = vec3(0.7, 0.04, 0.02);
    float hz = -0.12;
    vec3 col;
    float h;
    if (c.y < hz) {
        // A floor of nested diamonds, rushing towards you
        float z = 0.18 / (hz - c.y);
        vec2 ff = fract(vec2(c.x * z * 2.0, z * 2.0 + t * 0.7)) - 0.5;
        float dia = abs(ff.x) + abs(ff.y);
        float rings = fract(dia * 4.0);
        col = mix(green, blue, step(0.5, rings));
        h = 0.5 + 0.4 * (smoothstep(0.0, 0.25, rings) - smoothstep(0.75, 1.0, rings));
        col *= 0.1 + 0.9 * smoothstep(0.0, 0.07, hz - c.y);
    } else {
        // Blue mesh walls; the ceiling a great orange mandala
        vec2 wf = fract(rot(0.785) * (c * 15.0 + vec2(0.0, t * 0.25))) - 0.5;
        float wm = max(abs(wf.x), abs(wf.y));
        col = mix(blue * 0.6, green, smoothstep(0.4, 0.48, wm));
        h = 0.4 + 0.3 * smoothstep(0.4, 0.5, wm);
        vec2 mp = c - vec2(0.0, 0.42);
        float mr = length(mp);
        if (mr < 0.34) {
            vec2 mk = mandalaFold(rot(t * 0.08) * mp, 16.0);
            float pa = atan(mk.y, mk.x);
            float petal = 0.5 + 0.5 * cos(pa * 32.0 + mr * 70.0 - t * 1.5);
            float ringz = 0.5 + 0.5 * cos(mr * 90.0 - t * 2.0);
            col = mix(mix(red, orange, petal), yellow, ringz * petal);
            h = 0.4 + 0.3 * petal + 0.15 * ringz;
            vec2 ep = (mp - vec2(0.0, -0.02)) / 0.05;
            float lens = max(length(ep + vec2(0.0, 0.55)), length(ep - vec2(0.0, 0.55))) - 0.85;
            if (lens < 0.0) { float ir = length(ep); col = mix(vec3(0.95), mix(blue, vec3(0.0), smoothstep(0.15, 0.1, ir)), smoothstep(0.35, 0.3, ir)); h = 0.7; }
        }
        col = mix(col, mag, smoothstep(0.015, 0.0, abs(mr - 0.34)));
    }
    // Arches with flame-striped pillars and an eye on each, marching towards you, far to near
    float phase = fract(t * 0.2);
    for (int i = 0; i < 4; i++) {
        float z = (float(i) + phase) / 4.0;
        float s = 0.12 + 1.5 * z * z;
        float alpha = smoothstep(0.0, 0.2, z) * smoothstep(1.0, 0.86, z);
        for (int sd = -1; sd <= 1; sd++) {
            vec2 p = (c - vec2(float(sd) * 0.95 * s, hz - 0.3 * s)) / s;
            if (p.y < 0.0) continue;
            float arIn = archR((p - vec2(0.0, 0.55)) / 0.35);
            float arOut = archR((p - vec2(0.0, 0.55)) / 0.5);
            if (arOut < 1.0 && arIn > 1.0) {
                float across = clamp((arOut - 0.7) / 0.3, 0.0, 1.0);          // 0 outer edge .. inner
                float st = sin((p.x * 16.0 + 0.7 * sin(p.y * 18.0 + t * 1.6)) * 5.0);
                vec3 ac = mix(orange, yellow, 0.5 + 0.5 * st);
                ac = mix(ac, red, smoothstep(0.6, 1.0, st));
                float ah = 0.6 + 0.35 * sin(3.14159 * (arIn - 1.0) / 0.43) + 0.08 * st;
                for (int e = -1; e <= 1; e += 2) {
                    vec2 ep = (p - vec2(float(e) * 0.43, 0.4)) / 0.1;
                    float lens = max(length(ep + vec2(0.0, 0.55)), length(ep - vec2(0.0, 0.55))) - 0.85;
                    if (lens < 0.0) {
                        float ir = length(ep);
                        ac = mix(vec3(0.95, 0.95, 0.85), mix(blue, vec3(0.0), smoothstep(0.14, 0.1, ir)), smoothstep(0.36, 0.32, ir));
                        ah = 0.8;
                    }
                    ac = mix(ac, mag, smoothstep(0.08, 0.0, abs(lens)) * 0.8);
                }
                // trim round the opening: magenta and blue bands
                float trim = smoothstep(1.0, 1.02, arIn) * smoothstep(1.12, 1.08, arIn);
                ac = mix(ac, mix(mag, blue, step(1.06, arIn)), trim);
                col = mix(col, ac, alpha);
                h = mix(h, ah + 0.15 * trim, alpha);
            } else if (arIn < 1.0 && sd == 0 && z > 0.5) {
                float lv = log(max(arIn, 0.03)) * 3.0 + t * 0.9;
                float fb = fract(lv);
                vec3 tc = mix(mag, blue, 0.5 + 0.5 * sin(floor(lv) * 1.7)) * (0.55 + 0.45 * smoothstep(0.0, 0.3, fb));
                tc = mix(tc, yellow, smoothstep(0.25, 0.0, arIn));
                col = mix(col, tc, alpha * 0.9);
                h = mix(h, 0.3 + 0.3 * sin(fb * 3.14159), alpha);
            }
        }
    }
    return vec4(col, h);
}

vec4 hyperField(float i, vec2 c, float t) {
    if (i < 0.5) return netField(c, t);
    if (i < 1.5) return domeField(c, t);
    return templeField(c, t);
}
// One scene, melting, lit
vec3 hyperScene(float i, vec2 c, float t) {
    // Melting: everything flows and drips; the whole picture breathes and sways
    vec2 m = vec2(fbm(c * 2.2 + vec2(t * 0.17, -t * 0.31)), fbm(c * 2.2 + vec2(4.3, 1.7) + t * 0.23)) - 0.5;
    c += m * (0.05 + 0.03 * sin(t * 0.6));
    c.y -= 0.03 * fbm(vec2(c.x * 7.0, t * 0.5));
    c.x += 0.012 * sin(c.y * 16.0 + t * 2.6);
    float eps = 0.0025;
    vec4 f0 = hyperField(i, c, t);
    float hx = hyperField(i, c + vec2(eps, 0.0), t).a;
    float hy = hyperField(i, c + vec2(0.0, eps), t).a;
    float bump = i < 0.5 ? 0.012 : (i < 1.5 ? 0.02 : 0.014);
    vec3 col = relief(f0.rgb, f0.a, hx, hy, eps, bump, i < 1.5 ? 0.6 : 0.35);
    // Blacklight: the temple glows
    if (i > 1.5) col += f0.rgb * 0.2;
    return col;
}
vec3 hyperspace(vec2 uv, float aspect, float t) {
    vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
    // Turning, swaying, breathing, a lurch of zoom now and then
    c = rot(0.18 * sin(t * 0.21) + 0.06 * sin(t * 0.83)) * c;
    c *= 1.0 + 0.06 * sin(t * 1.7) + 0.03 * sin(t * 4.9) - 0.12 * pow(max(0.0, sin(t * 0.37)), 8.0);
    vec3 col = hyperScene(uSceneA, c, t);
    if (uSceneMix > 0.001 && uSceneB != uSceneA) {
        float n = fbm(c * 3.0 + t * 0.3);
        float w = smoothstep(n - 0.15, n + 0.15, uSceneMix * 1.4 - 0.2);
        col = mix(col, hyperScene(uSceneB, c, t), w);
    }
    // Colours breathing round a little, turned up; a strobe; colour fringes at the edges
    col = max(hueSpin(col, 0.1 * sin(t * 0.29)), 0.0);
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = max(mix(vec3(l), col, 1.35), 0.0);
    col *= 1.15 * (0.88 + 0.12 * sin(t * 11.0)) * (1.0 + 0.35 * pow(max(0.0, sin(t * 2.4)), 14.0));
    float vg = length((uv - 0.5) * vec2(aspect, 1.0));
    return col * (1.0 - 0.35 * smoothstep(0.5, 1.0, vg));
}

vec3 sampleScene(vec2 uv) {
    vec3 c = tex(uv);
    if (uBlur > 0.001) {
        // Four taps on the diagonals (bilinear filtering spreads each over a 2x2 block)
        vec2 px = uBlur * 2.2 / uRes;
        vec3 b = tex(uv + px) + tex(uv - px) + tex(uv + vec2(px.x, -px.y)) + tex(uv + vec2(-px.x, px.y));
        c = c * 0.36 + b * 0.16;
    }
    return c;
}

vec3 hueRotate(vec3 c, float a) {
    const vec3 k = vec3(0.57735);
    float ca = cos(a);
    return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
    vec2 uv = vUv;
    float aspect = uRes.x / uRes.y;

    // Kaleidoscope: mirrored wedges spinning slowly, strongest away from the centre
    if (uKaleido > 0.001) {
        vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
        float r = length(c);
        float seg = 6.28318 / 8.0;
        float a = mod(atan(c.y, c.x) + uTime * 0.05, seg);
        a = abs(a - seg * 0.5);
        vec2 k = vec2(cos(a), sin(a)) * r;
        k.x /= aspect;
        uv = mix(uv, k + 0.5, min(1.0, uKaleido) * smoothstep(0.05, 0.45, r));
    }
    // The world breathing in and out, and rippling
    uv = 0.5 + (uv - 0.5) * (1.0 - uBreathe * 0.035 * sin(uTime * 1.3));
    uv += uWave * 0.011 * vec2(sin(uv.y * 17.0 + uTime * 1.7), cos(uv.x * 13.0 + uTime * 1.25));
    // Surfaces crawling and flowing: a slow warp that drifts, each patch breathing in its own time
    vec2 sp = uv * vec2(aspect, 1.0);
    if (uDrift > 0.001) {
        vec2 p = sp * 3.0;
        vec2 q = vec2(fbm(p + vec2(0.0, uTime * 0.13)), fbm(p + vec2(5.2, 1.3) - uTime * 0.11));
        float br = 0.5 + 0.5 * sin(uTime * 1.05 + fbm(p * 0.45) * 7.0);
        uv += (q - 0.5) * uDrift * 0.016 * (0.5 + br);
    }

    vec3 col;
    if (uChroma > 0.001) {
        vec2 d = (uv - 0.5) * uChroma * 0.014;
        col = vec3(tex(uv + d).r, sampleScene(uv).g, tex(uv - d).b);
    } else {
        col = sampleScene(uv);
    }
    // DMT coming up: everything rushing in towards the middle, washing out pale and bright
    if (uDmtSmear > 0.001) {
        vec3 acc = col;
        for (int i = 1; i < 8; i++) acc += tex(0.5 + (uv - 0.5) * (1.0 - float(i) * 0.03 * uDmtSmear));
        col = acc / 8.0;
        float lw0 = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(col, vec3(1.0, 0.85, 1.0) * (lw0 * 1.1 + 0.06), 0.3 * uDmtSmear);
    }
    // Double vision drifting apart and back
    if (uGhost > 0.001) {
        vec2 off = vec2(0.022 + 0.012 * sin(uTime * 0.7), 0.005 * sin(uTime * 0.9)) * uGhost;
        col = mix(col, tex(uv + off), 0.42 * min(1.0, uGhost));
    }

    // Haloes round lights and bright things; rainbow fringes along edges
    float detail = 0.0;
    if (uGlow > 0.001 || uEdges > 0.001 || uPattern > 0.001 || uDmtBreak > 0.001) {
        vec2 px = 1.5 / uRes;
        vec3 n = tex(uv + vec2(0.0, px.y)), s = tex(uv - vec2(0.0, px.y)), e = tex(uv + vec2(px.x, 0.0)), w = tex(uv - vec2(px.x, 0.0));
        vec3 lw = vec3(0.2126, 0.7152, 0.0722);
        vec2 grad = vec2(dot(e - w, lw), dot(n - s, lw));
        float lc = max(dot(col, lw), 0.05);
        detail = clamp(length(grad) / lc, 0.0, 2.0);
        if (uEdges > 0.001) {
            float ang = atan(grad.y, grad.x);
            col += palette(ang * 0.16 + uTime * 0.12 + sp.x * 0.6) * smoothstep(0.08, 0.6, detail) * uEdges * lc * 1.4;
        }
        if (uGlow > 0.001) {
            vec3 g = vec3(0.0);
            float r = 0.012 + 0.01 * uGlow;
            for (int i = 0; i < 8; i++) {
                float a = float(i) * 0.785398 + uTime * 0.2;
                g += max(tex(uv + vec2(cos(a), sin(a) * aspect) * r) - 0.75, 0.0);
            }
            col += g * 0.12 * uGlow;
        }
    }

    // Grading (linear HDR, before tone mapping)
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = max(mix(vec3(l), col, 1.0 + uSat), 0.0);
    col = max((col - 0.18) * (1.0 + uContrast) + 0.18, 0.0);
    col *= 1.0 + uBright * 3.0;
    col = mix(col, col * uTint * 1.15, uTintAmt);
    if (abs(uHue) > 0.0001) col = max(hueRotate(col, uHue), 0.0);

    // DMT coming up (and the afterglow): purple, red and blue specks creeping into everything,
    // thickest on textured things (grass, leaves), each one holding for a moment
    if (uDmtBreak > 0.001) {
        vec2 cell = floor(vUv * uRes / 3.0);
        float hs = hash21(cell + floor(uTime * 3.0 + hash21(cell * 0.13) * 3.0) * 0.37);
        float pr = uDmtBreak * uDmtBreak * (0.08 + 0.92 * smoothstep(0.05, 0.4, detail)) * 0.4;
        if (hs < pr) {
            float h2 = hash21(cell * 1.7 + 3.1);
            vec3 sc = h2 < 0.4 ? vec3(0.55, 0.15, 0.9) : h2 < 0.7 ? vec3(0.9, 0.15, 0.3) : vec3(0.2, 0.35, 1.0);
            col = mix(col, sc * (0.25 + 1.3 * l), 0.85);
        }
    }

    // Geometry growing over surfaces: patches of coloured filigree that crawl with the drift, thickest
    // on textured things (grass, brick, bark), riding the light already there
    if (uPattern > 0.001) {
        vec2 pp = (uv - 0.5) * vec2(aspect, 1.0) * (2.2 + 0.3 * sin(uTime * 0.31));
        float f = filigree(pp + vec2(sin(uTime * 0.05), cos(uTime * 0.04)) * 0.6, uTime);
        float pm = smoothstep(0.3, 0.65, fbm(sp * 1.6 + vec2(uTime * 0.03, -uTime * 0.025)) + uPattern * 0.4);
        float m = clamp(uPattern * 1.3 * pm * (0.65 + 0.35 * smoothstep(0.03, 0.4, detail)), 0.0, 1.0);
        float lum = max(dot(col, vec3(0.2126, 0.7152, 0.0722)), 0.02);
        vec3 pc = palette(f * 1.7 + uTime * 0.04 + length(pp) * 0.2);
        col = mix(col, lum * (0.35 + 2.6 * f) * pc * 1.7, m * smoothstep(0.02, 0.22, f));
    }

    // Too much: the patterns are all there is. An endless mandala falling inwards, breathing,
    // the world only a faint shape through it
    if (uTakeover > 0.001) {
        vec2 c = (vUv - 0.5) * vec2(aspect, 1.0);
        float r = length(c) + 1e-4;
        float breath = 1.0 + 0.06 * sin(uTime * 0.9);
        vec2 lp = vec2(log(r * breath) - uTime * 0.22, atan(c.y, c.x));
        vec2 fold = mandalaFold(vec2(cos(lp.y), sin(lp.y)) * exp(fract(lp.x) * 1.0), 12.0);
        float f1 = filigree(fold * 1.4 + vec2(0.1 * sin(uTime * 0.2), 0.0), uTime);
        float f2 = filigree(mandalaFold(c * (3.0 + sin(uTime * 0.13)), 8.0) * 1.2, uTime * 1.3 + 4.0);
        float lw = max(dot(tex(vUv), vec3(0.2126, 0.7152, 0.0722)), 0.0);
        vec3 m = palette(f1 * 2.0 + lp.x * 0.15 + uTime * 0.05) * (0.25 + 2.2 * f1)
               + palette(f2 * 1.5 + 0.5 + uTime * 0.07) * f2 * 1.2;
        m *= 0.55 + 0.9 * smoothstep(0.0, 1.2, lw) + 0.25 * sin(r * 18.0 - uTime * 3.0);
        col = mix(col, m, clamp(uTakeover, 0.0, 1.0) * 0.96);
    }

    // DMT: through the burst into hyperspace; nothing of the world is left
    if (uDmt > 0.001) col = mix(col, hyperspace(vUv, aspect, uDmtT), clamp(uDmt, 0.0, 1.0));
    if (uDmtFlash > 0.001) col = mix(col, vec3(1.6, 3.2, 1.3), clamp(uDmtFlash, 0.0, 1.0) * 0.92);

    // Trails: what you just saw lingers
    if (uHasPrev > 0.5 && uTrail > 0.001) col = mix(col, texture2D(tPrev, vUv).rgb, min(0.88, uTrail * 0.85));
    // Tracers: afterimages of whatever moved, their colour slipping round the wheel as they fade
    // (only where the old frame differs, so a still view keeps its colours)
    if (uHasPrev > 0.5 && uTracer > 0.001) {
        vec3 p = texture2D(tPrev, vUv).rgb;
        float moved = smoothstep(0.02, 0.25, length(p - col));
        p = mix(p, max(hueRotate(p, 0.35 + 0.25 * sin(uTime * 0.6)), 0.0), moved * 0.8);
        col = mix(col, p, uTracer);
    }

    // A shadowy figure at the edge of your eye
    if (uFigureA > 0.001) {
        vec2 p = (vUv - vec2(uFigureX, 0.0)) * vec2(aspect, 1.0);
        float head = smoothstep(0.045, 0.03, length(p - vec2(0.0, 0.64)));
        float body = smoothstep(1.0, 0.75, length((p - vec2(0.0, 0.38)) / vec2(0.075, 0.22)));
        col *= 1.0 - uFigureA * max(head, body) * 0.92;
    }

    col = mix(col, vec3(4.0), uFlash * 0.85);
    vec2 vc = (vUv - 0.5) * vec2(aspect, 1.0);
    float vig = smoothstep(0.95, 0.2, length(vc));
    col *= mix(1.0, vig, min(1.0, uVignette));
    if (uGrain > 0.001) col *= 1.0 + (hash(vUv * uRes + fract(uTime) * 100.0) - 0.5) * uGrain * 0.35;
    // Visual snow: a fine coloured fizz over everything
    if (uSnow > 0.001) {
        vec2 q = vUv * uRes + fract(uTime * 7.0) * 311.0;
        col += (vec3(hash(q), hash(q + 17.3), hash(q + 41.9)) - 0.5) * uSnow * 0.09 * (0.15 + dot(col, vec3(0.33)));
    }
    col *= 1.0 - uDark;
    gl_FragColor = vec4(col, 1.0);
}`;

const BLIT_FRAG = /* glsl */`
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() {
    gl_FragColor = texture2D(tDiffuse, vUv);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`;

export class DrugPostFX {
    /** @param {{ samples?: number }} [opts] MSAA samples for the scene target (0 on low-spec devices) */
    constructor(opts = {}) {
        this.samples = Math.min(2, opts.samples ?? 2);   // blurred and graded anyway: 2x is plenty
        this.maxPixels = opts.maxPixels ?? 1.5e6;        // the effect renders at most this many pixels, then is scaled up
        this.size = new THREE.Vector2();
        this.sceneRT = null;
        this.out = [null, null];
        this.cur = 0;
        this.hasPrev = false;
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
        this.quad.frustumCulled = false;
        this.quadScene = new THREE.Scene();
        this.quadScene.add(this.quad);
        this.fx = new THREE.ShaderMaterial({
            vertexShader: VERT,
            fragmentShader: FX_FRAG,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
            uniforms: {
                tScene: { value: null }, tPrev: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
                uHasPrev: { value: 0 }, uHue: { value: 0 }, uSat: { value: 0 }, uContrast: { value: 0 }, uBright: { value: 0 },
                uTintAmt: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uVignette: { value: 0 }, uBlur: { value: 0 },
                uWave: { value: 0 }, uBreathe: { value: 0 }, uChroma: { value: 0 }, uGhost: { value: 0 }, uTrail: { value: 0 },
                uKaleido: { value: 0 }, uFlash: { value: 0 }, uDark: { value: 0 }, uGrain: { value: 0 },
                uFigureX: { value: 0 }, uFigureA: { value: 0 },
                uDrift: { value: 0 }, uPattern: { value: 0 }, uEdges: { value: 0 }, uSnow: { value: 0 }, uGlow: { value: 0 }, uTakeover: { value: 0 },
                uDmt: { value: 0 }, uDmtT: { value: 0 }, uDmtBreak: { value: 0 }, uDmtSmear: { value: 0 }, uDmtFlash: { value: 0 },
                uSceneA: { value: 0 }, uSceneB: { value: 0 }, uSceneMix: { value: 0 }, uTracer: { value: 0 }
            }
        });
        this._lastTime = null;
        this.blit = new THREE.ShaderMaterial({
            vertexShader: VERT,
            fragmentShader: BLIT_FRAG,
            depthTest: false,
            depthWrite: false,
            uniforms: { tDiffuse: { value: null } }
        });
    }

    _ensureTargets(renderer) {
        renderer.getDrawingBufferSize(this.size);
        const k = Math.min(1, Math.sqrt(this.maxPixels / Math.max(1, this.size.x * this.size.y)));
        this.size.set(Math.max(1, Math.round(this.size.x * k)), Math.max(1, Math.round(this.size.y * k)));
        const w = this.size.x, h = this.size.y;
        if (this.sceneRT && this.sceneRT.width === w && this.sceneRT.height === h) return;
        const opts = { type: THREE.HalfFloatType, depthBuffer: true };
        if (this.sceneRT) {
            this.sceneRT.setSize(w, h);
            for (const rt of this.out) rt.setSize(w, h);
        } else {
            this.sceneRT = new THREE.WebGLRenderTarget(w, h, Object.assign({ samples: this.samples }, opts));
            this.out = [new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false }),
                new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false })];
        }
        this.hasPrev = false;
    }

    /**
     * Gets everything the effects need ready before the first dose: the targets, the two shaders and
     * the scene's materials as they compile when drawn into an off-screen target (their programs
     * differ from the on-screen ones, so the first dose would otherwise freeze the game for a while).
     */
    warm(renderer, scene, camera) {
        this._ensureTargets(renderer);
        const prev = renderer.getRenderTarget();
        try {
            renderer.setRenderTarget(this.sceneRT);
            if (typeof renderer.compile === 'function') renderer.compile(scene, camera);
            this.quad.material = this.fx;
            renderer.setRenderTarget(this.out[0]);
            renderer.render(this.quadScene, this.camera);
            this.quad.material = this.blit;
            this.blit.uniforms.tDiffuse.value = this.out[0].texture;
            renderer.setRenderTarget(prev);
            renderer.render(this.quadScene, this.camera);
        } finally {
            renderer.setRenderTarget(prev);
        }
        this.hasPrev = false;
    }

    /**
     * Renders the scene to the screen, through the drug effects when `state.active`.
     * @param {THREE.WebGLRenderer} renderer
     * @param {Object} state DrugEffects.state
     * @param {{ scene, camera }} [overlay] drawn over the scene before the effects (the
     *   first-person hands and gun), so they blur, warp and change colour with the world
     */
    render(renderer, scene, camera, state, time, overlay = null) {
        const drawOverlay = () => {
            if (!overlay) return;
            const autoClear = renderer.autoClear;
            renderer.autoClear = false;
            renderer.clearDepth();
            renderer.render(overlay.scene, overlay.camera);
            renderer.autoClear = autoClear;
        };
        if (!state || !state.active) {
            this.hasPrev = false;
            renderer.render(scene, camera);
            drawOverlay();
            return;
        }
        this._ensureTargets(renderer);
        const prevTarget = renderer.getRenderTarget();
        renderer.setRenderTarget(this.sceneRT);
        renderer.render(scene, camera);
        drawOverlay();

        const u = this.fx.uniforms;
        const out = this.out[this.cur], prev = this.out[1 - this.cur];
        u.tScene.value = this.sceneRT.texture;
        u.tPrev.value = prev.texture;
        u.uHasPrev.value = this.hasPrev ? 1 : 0;
        u.uRes.value.set(this.size.x, this.size.y);
        u.uTime.value = time;
        u.uHue.value = Math.min(1, state.hueCycle) * (state.hue % (Math.PI * 2));
        u.uSat.value = state.sat;
        u.uContrast.value = state.contrast;
        u.uBright.value = state.bright;
        u.uTintAmt.value = state.tintAmt;
        u.uTint.value.set(state.tint[0], state.tint[1], state.tint[2]);
        u.uVignette.value = state.vignette;
        u.uBlur.value = state.blur;
        u.uWave.value = state.wave;
        u.uBreathe.value = state.breathe;
        u.uChroma.value = state.chroma;
        u.uGhost.value = state.ghost;
        u.uTrail.value = state.trail;
        // Tracer fade time (s) -> how much of the last frame to keep this frame, the same at any frame rate
        const frameDt = this._lastTime === null ? 1 / 60 : Math.max(1 / 240, Math.min(0.1, time - this._lastTime));
        this._lastTime = time;
        u.uTracer.value = state.tracer > 0.001 ? Math.min(0.94, Math.exp(-frameDt / state.tracer)) : 0;
        u.uKaleido.value = state.kaleido;
        u.uFlash.value = state.flash;
        u.uDark.value = state.dark;
        u.uGrain.value = state.grain;
        u.uFigureX.value = state.figureX;
        u.uFigureA.value = state.figureA;
        u.uDrift.value = state.drift || 0;
        u.uPattern.value = state.pattern || 0;
        u.uEdges.value = state.edges || 0;
        u.uSnow.value = state.snow || 0;
        u.uGlow.value = state.glow || 0;
        u.uTakeover.value = Math.min(1, state.takeover || 0);
        u.uDmt.value = Math.min(1, state.dmt || 0);
        u.uDmtT.value = state.dmtT || 0;
        u.uDmtBreak.value = Math.min(1.2, state.dmtBreak || 0);
        u.uDmtSmear.value = Math.min(1, state.dmtSmear || 0);
        u.uDmtFlash.value = Math.min(1, state.dmtFlash || 0);
        // Which hyperspace scenes are showing (two only while one turns into the next)
        const st = state.dmtT || 0;
        let i = 0;
        while (i + 1 < DMT_SCENES.length && st >= DMT_SCENES[i + 1]) i++;
        const mix = i > 0 ? Math.min(1, (st - DMT_SCENES[i]) / 6) : 1;
        u.uSceneA.value = mix < 1 ? i - 1 : i;
        u.uSceneB.value = i;
        u.uSceneMix.value = mix < 1 ? mix * mix * (3 - 2 * mix) : 0;
        this.quad.material = this.fx;
        renderer.setRenderTarget(out);
        renderer.render(this.quadScene, this.camera);

        this.blit.uniforms.tDiffuse.value = out.texture;
        this.quad.material = this.blit;
        renderer.setRenderTarget(prevTarget);
        renderer.render(this.quadScene, this.camera);

        this.cur = 1 - this.cur;
        this.hasPrev = true;
    }

    dispose() {
        if (this.sceneRT) this.sceneRT.dispose();
        for (const rt of this.out) if (rt) rt.dispose();
        this.fx.dispose();
        this.blit.dispose();
    }
}

// ================================================================================================
// Exhaled smoke / vapour
// ================================================================================================
let _smokeTex = null;
function smokeTexture() {
    if (_smokeTex || typeof document === 'undefined') return _smokeTex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    _smokeTex = new THREE.CanvasTexture(c);
    _smokeTex.colorSpace = THREE.SRGBColorSpace;
    return _smokeTex;
}

export class SmokePuffs {
    constructor(scene, max = 90) {
        this.scene = scene;
        this.max = max;
        this.puffs = [];
        this.light = 1;
    }

    /**
     * Breathes out `count` puffs from `origin` along `dir`.
     * @param {{ size?: number, color?: number, speed?: number, opacity?: number }} [o]
     */
    spawn(origin, dir, count = 10, o = {}) {
        const tex = smokeTexture();
        for (let i = 0; i < count; i++) {
            if (this.puffs.length >= this.max) {
                const old = this.puffs.shift();
                this.scene.remove(old.sprite);
                old.sprite.material.dispose();
            }
            const m = new THREE.SpriteMaterial({ map: tex, color: o.color ?? 0xe8eaed, transparent: true, opacity: 0, depthWrite: false });
            const s = new THREE.Sprite(m);
            const spread = 0.35;
            const speed = (o.speed ?? 1.2) * (0.6 + Math.random() * 0.6);
            const v = new THREE.Vector3(dir.x + (Math.random() - 0.5) * spread, dir.y + 0.1 + (Math.random() - 0.3) * spread, dir.z + (Math.random() - 0.5) * spread)
                .normalize().multiplyScalar(speed);
            s.position.copy(origin);
            const size = (o.size ?? 0.18) * (0.7 + Math.random() * 0.6);
            s.scale.setScalar(size);
            s.renderOrder = 5;
            this.scene.add(s);
            this.puffs.push({ sprite: s, v, life: 0, maxLife: 2.5 + Math.random() * 2.5, delay: i * 0.035, size, peak: o.opacity ?? 0.55, base: new THREE.Color(o.color ?? 0xe8eaed) });
        }
    }

    /** @param {number} light 0 (night) .. 1 (day): smoke isn't lit, so it's dimmed in the dark */
    update(dt, light = 1) {
        for (let i = this.puffs.length - 1; i >= 0; i--) {
            const p = this.puffs[i];
            if (p.delay > 0) {
                p.delay -= dt;
                continue;
            }
            p.life += dt;
            const k = p.life / p.maxLife;
            if (k >= 1) {
                this.scene.remove(p.sprite);
                p.sprite.material.dispose();
                this.puffs.splice(i, 1);
                continue;
            }
            p.v.multiplyScalar(Math.exp(-1.6 * dt));
            p.v.y += 0.12 * dt;
            p.sprite.position.addScaledVector(p.v, dt);
            p.sprite.scale.setScalar(p.size * (1 + k * 6));
            p.sprite.material.opacity = p.peak * Math.min(1, p.life * 6) * (1 - k);
            p.sprite.material.color.copy(p.base).multiplyScalar(0.3 + 0.7 * light);
            p.sprite.material.rotation += dt * 0.3;
        }
    }

    clear() {
        for (const p of this.puffs) {
            this.scene.remove(p.sprite);
            p.sprite.material.dispose();
        }
        this.puffs.length = 0;
    }
}
