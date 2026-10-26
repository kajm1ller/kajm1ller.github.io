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
varying vec2 vUv;

vec3 tex(vec2 uv) { return texture2D(tScene, clamp(uv, 0.001, 0.999)).rgb; }

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

    vec3 col;
    if (uChroma > 0.001) {
        vec2 d = (uv - 0.5) * uChroma * 0.014;
        col = vec3(tex(uv + d).r, sampleScene(uv).g, tex(uv - d).b);
    } else {
        col = sampleScene(uv);
    }
    // Double vision drifting apart and back
    if (uGhost > 0.001) {
        vec2 off = vec2(0.022 + 0.012 * sin(uTime * 0.7), 0.005 * sin(uTime * 0.9)) * uGhost;
        col = mix(col, tex(uv + off), 0.42 * min(1.0, uGhost));
    }

    // Grading (linear HDR, before tone mapping)
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = max(mix(vec3(l), col, 1.0 + uSat), 0.0);
    col = max((col - 0.18) * (1.0 + uContrast) + 0.18, 0.0);
    col *= 1.0 + uBright * 3.0;
    col = mix(col, col * uTint * 1.15, uTintAmt);
    if (abs(uHue) > 0.0001) col = max(hueRotate(col, uHue), 0.0);

    // Trails: what you just saw lingers
    if (uHasPrev > 0.5 && uTrail > 0.001) col = mix(col, texture2D(tPrev, vUv).rgb, min(0.88, uTrail * 0.85));

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
                uFigureX: { value: 0 }, uFigureA: { value: 0 }
            }
        });
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
        u.uKaleido.value = state.kaleido;
        u.uFlash.value = state.flash;
        u.uDark.value = state.dark;
        u.uGrain.value = state.grain;
        u.uFigureX.value = state.figureX;
        u.uFigureA.value = state.figureA;
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
