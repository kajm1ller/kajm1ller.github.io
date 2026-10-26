/**
 * Kaj Simulator - Day / night cycle
 *
 * One game day lasts DAY_LENGTH_SECONDS of real time (1 real second = 1 game minute by default).
 * The clock runs off the wall clock so every multiplayer client sees the same time of day without
 * any extra protocol; the dev menu can shift it with setTime().
 *
 * Each frame DayNightCycle moves the sun (and the moon opposite it) along an arc that rises in the
 * east and sets in the west across the southern sky, then derives everything else from the sun's
 * elevation: sky dome colours, stars and moon, fog/background colour, the sun/moon directional
 * light, hemisphere/ambient/fill levels, cloud tint and tone mapping exposure. The PMREM sky
 * reflection map is re-rendered whenever the sky has changed enough to notice.
 */
import * as THREE from 'three';

export const DAY_LENGTH_SECONDS = 24 * 60;

// Palettes keyed by sun elevation: full night, sun on the horizon, full day
const PALETTE = {
    zenith:  [0x071024, 0x2b3f78, 0x3d7fd2],
    horizon: [0x18233e, 0xef8a50, 0xcfe3f4],
    haze:    [0x1c2741, 0xffb27a, 0xe9f1f8],
    ground:  [0x07090d, 0x3a3434, 0x7c8d72],
    fog:     [0x121b30, 0x8f7f8c, 0xc6dbed],
    hemiSky: [0x2a3c66, 0xd09a80, 0xa9cdf2],
    hemiGnd: [0x0e120e, 0x4a4234, 0x6b7d4e],
    cloudLit:   [0x2a3346, 0xffc59a, 0xffffff],
    cloudShade: [0x111722, 0x6c5a6e, 0xb7c6d8]
};

const SUN_DAY = new THREE.Color(0xfff0dc);
const SUN_LOW = new THREE.Color(0xff9a55);
const MOON_LIGHT = new THREE.Color(0x9db4e6);
const MOON_COLOR = new THREE.Color(0xdfe6f5);

const _a = new THREE.Color();
const _b = new THREE.Color();

/** Blend a night / horizon / day palette entry: k < 0.5 night->horizon, k > 0.5 horizon->day */
function paletteColor(out, entry, k) {
    if (k < 0.5) {
        _a.setHex(entry[0]);
        _b.setHex(entry[1]);
        return out.copy(_a).lerp(_b, k * 2);
    }
    _a.setHex(entry[1]);
    _b.setHex(entry[2]);
    return out.copy(_a).lerp(_b, (k - 0.5) * 2);
}

function smoothstep(e0, e1, x) {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

export function formatClock(hours) {
    const totalMin = Math.floor(hours * 60) % 1440;
    const h24 = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return { text: `${h12}:${String(m).padStart(2, '0')}`, ampm: h24 < 12 ? 'AM' : 'PM', h24, m };
}

export class DayNightCycle {
    /**
     * @param {object} o
     *   renderer, scene, skyMaterial, sunDirection (mutated in place), sunLight, hemiLight,
     *   ambientLight, fillLight, cloudLayer, sunGroup, onEnvironmentMap(texture)
     */
    constructor(o) {
        Object.assign(this, o);
        this.offsetHours = 0;
        // Server time minus ours (ms): multiplayer lines every player's sky up with the server's clock
        this.skewMs = 0;
        this.hours = 12;
        // 0 = full night, 1 = full day (follows the sun's elevation, with a twilight band)
        this.daylight = 1;
        // 0 in daylight, 1 once it is properly dark (street lamps key off this)
        this.darkness = 0;
        this.moonDirection = new THREE.Vector3(0, -1, 0);
        // Whichever of sun / moon is currently lighting the scene (and casting shadows)
        this.lightDirection = this.sunDirection.clone();

        this._baseExposure = this.renderer.toneMappingExposure;
        this._sunIntensity = this.sunLight.intensity;
        this._hemiIntensity = this.hemiLight.intensity;
        this._ambientIntensity = this.ambientLight.intensity;
        this._fillIntensity = this.fillLight.intensity;
        this._fogColor = new THREE.Color();
        this._envKey = null;
        this._envTarget = null;
        this._pmrem = new THREE.PMREMGenerator(this.renderer);
        this._envScene = new THREE.Scene();
        this._envDome = new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 16), this.skyMaterial);
        this._envScene.add(this._envDome);

        this._skyUniforms = this.skyMaterial.uniforms;
        this._startMs = performance.now();
        this.update();
    }

    /** Game time in hours [0, 24) from the shared wall clock plus the dev offset */
    _clockHours() {
        const gameHours = ((Date.now() + this.skewMs) / 1000) * (24 / DAY_LENGTH_SECONDS) + this.offsetHours;
        return ((gameHours % 24) + 24) % 24;
    }

    /** Follows the server's clock (`serverNow` in ms). A dev time shift (?time=, the dev menu) is kept. */
    syncToServer(serverNow) {
        const hoursNow = this._clockHours();
        this.skewMs = serverNow - Date.now();
        // keep an explicit dev offset relative to the new clock
        if (this.offsetHours !== 0) this.offsetHours += hoursNow - this._clockHours();
    }

    /** Jump the clock to the given hour of the day (0..24) */
    setTime(hours) {
        this.offsetHours = 0;
        this.offsetHours = hours - this._clockHours();
        this.update();
    }

    getTime() {
        return this.hours;
    }

    getClock() {
        return formatClock(this.hours);
    }

    update() {
        const h = this._clockHours();
        this.hours = h;

        // Sun arc: rises in the east (+x) at 06:00, highest (~55 degrees) in the south (+z) at noon
        const theta = ((h - 6) / 24) * Math.PI * 2;
        const s = Math.sin(theta), c = Math.cos(theta);
        this.sunDirection.set(c, s * 0.86, 0.3 + s * 0.32).normalize();
        this.moonDirection.set(-c * 0.95, -s * 0.8, 0.35 - s * 0.25).normalize();
        const sunY = this.sunDirection.y;

        this.daylight = smoothstep(-0.2, 0.22, sunY);
        this.darkness = 1 - smoothstep(-0.14, 0.06, sunY);
        // How close the sun is to the horizon (sunset / sunrise colours)
        const golden = 1 - smoothstep(0.0, 0.3, Math.abs(sunY + 0.02));
        // Palette position: 0 night, 0.5 sun on the horizon, 1 day
        const k = sunY < 0 ? 0.5 * smoothstep(-0.24, 0, sunY) :0.5 + 0.5 * smoothstep(0, 0.28, sunY);

        // ---- Sky dome ----
        const u = this._skyUniforms;
        u.uSunDir.value.copy(this.sunDirection);
        u.uMoonDir.value.copy(this.moonDirection);
        paletteColor(u.uZenithColor.value, PALETTE.zenith, k);
        paletteColor(u.uHorizonColor.value, PALETTE.horizon, k);
        paletteColor(u.uHazeColor.value, PALETTE.haze, k);
        paletteColor(u.uGroundColor.value, PALETTE.ground, k);
        u.uSunColor.value.copy(SUN_DAY).lerp(SUN_LOW, golden).multiplyScalar(smoothstep(-0.18, 0.02, sunY));
        u.uSunDisc.value = smoothstep(-0.04, 0.02, sunY);
        u.uStars.value = 1 - smoothstep(-0.14, 0.04, sunY);
        u.uMoon.value = smoothstep(-0.05, 0.05, this.moonDirection.y) * (0.35 + 0.65 * (1 - this.daylight));
        u.uTime.value = (performance.now() - this._startMs) / 1000;

        // ---- Fog & background ----
        paletteColor(this._fogColor, PALETTE.fog, k);
        if (this.scene.fog) this.scene.fog.color.copy(this._fogColor);
        if (this.scene.background && this.scene.background.isColor) this.scene.background.copy(this._fogColor);

        // ---- Lights: the sun by day, the moon by night (crossfading through zero at the horizon) ----
        const sunUp = smoothstep(-0.02, 0.16, sunY);
        const moonUp = smoothstep(-0.02, 0.16, -sunY) * smoothstep(-0.05, 0.15, this.moonDirection.y);
        if (sunY > -0.02) {
            this.lightDirection.copy(this.sunDirection);
            this.sunLight.color.copy(SUN_DAY).lerp(SUN_LOW, golden);
            this.sunLight.intensity = this._sunIntensity * sunUp;
        } else {
            this.lightDirection.copy(this.moonDirection);
            this.sunLight.color.copy(MOON_LIGHT);
            this.sunLight.intensity = 0.42 * moonUp;
        }
        // Keep the shadow light above the horizon so its frustum never points up through the ground
        if (this.lightDirection.y < 0.12) {
            this.lightDirection.y = 0.12;
            this.lightDirection.normalize();
        }
        paletteColor(this.hemiLight.color, PALETTE.hemiSky, k);
        paletteColor(this.hemiLight.groundColor, PALETTE.hemiGnd, k);
        this.hemiLight.intensity = THREE.MathUtils.lerp(0.75, this._hemiIntensity, this.daylight);
        this.ambientLight.intensity = THREE.MathUtils.lerp(0.16, this._ambientIntensity, this.daylight);
        this.fillLight.intensity = this._fillIntensity * this.daylight;
        // Open the "camera" up a little at night so the streets stay readable
        this.renderer.toneMappingExposure = this._baseExposure * THREE.MathUtils.lerp(1.3, 1, this.daylight);

        // ---- Visible sun, clouds ----
        if (this.sunGroup) this.sunGroup.visible = sunY > -0.1;
        if (this.cloudLayer) {
            const cu = this.cloudLayer.material.uniforms;
            cu.uSunDir.value.copy(this.lightDirection);
            paletteColor(cu.uLitColor.value, PALETTE.cloudLit, k);
            paletteColor(cu.uShadeColor.value, PALETTE.cloudShade, k);
        }

        // ---- Sky reflections: re-render the PMREM map once the sky has visibly changed ----
        const envKey = Math.round(THREE.MathUtils.clamp(sunY, -0.2, 0.32) * 40);
        // (super low graphics: the reflection map is built once, never rebuilt as the sun moves)
        if (envKey !== this._envKey && !(this.staticEnvironment && this._envKey !== null)) {
            this._envKey = envKey;
            this._rebuildEnvironment();
        }
    }

    _rebuildEnvironment() {
        const target = this._pmrem.fromScene(this._envScene, 0.02, 1, 3000);
        if (this._envTarget) this._envTarget.dispose();
        this._envTarget = target;
        this.scene.environment = target.texture;
        if (this.onEnvironmentMap) this.onEnvironmentMap(target.texture);
    }
}
