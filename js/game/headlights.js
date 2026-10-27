import * as THREE from 'three';

export const HEADLIGHT_CONFIG = Object.freeze({
    POOL: 7,            // spot lights: the player's car + the nearest traffic cars (count never changes, so no shader recompiles)
    MAX_DIST: 120,      // traffic cars farther than this get no beam
    ON_NIGHT: 0.25,     // lights come on once nightFactor passes this
    INTENSITY: 60,
    RANGE: 55,
    ANGLE: 0.55,
    NOSE: 0.6,          // metres ahead of the car's centre the lamp sits (the cone starts here)
    HEIGHT: 0.7
});

const _fwd = new THREE.Vector3();

/** Pooled spot lights that follow the player's car and the nearest traffic cars after dark. */
export class Headlights {
    constructor(scene) {
        this.lights = [];
        for (let i = 0; i < HEADLIGHT_CONFIG.POOL; i++) {
            const l = new THREE.SpotLight(0xfff1cf, 0, HEADLIGHT_CONFIG.RANGE, HEADLIGHT_CONFIG.ANGLE, 0.6, 1.2);
            l.castShadow = false;
            scene.add(l, l.target);
            this.lights.push(l);
        }
    }

    /** @param night nightFactor(); @param player the car being driven (or null); @param cars traffic vehicles */
    update(night, player, cars, center) {
        const C = HEADLIGHT_CONFIG;
        const on = night >= C.ON_NIGHT;
        let n = 0;
        const place = (v) => {
            const l = this.lights[n++];
            const yaw = v.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
            const reach = (v.length || 4.5) / 2 + C.NOSE;
            l.position.set(v.position.x + fx * reach, (v.position.y || 0) + C.HEIGHT, v.position.z + fz * reach);
            l.target.position.set(l.position.x + fx * 10, (v.position.y || 0) + 0.2, l.position.z + fz * 10);
            l.intensity = C.INTENSITY * night;
        };
        if (on) {
            if (player && !player.isPlane) place(player);
            if (cars) {
                // nearest first would need a sort; the first POOL cars within range is plenty for a beam you only glimpse
                for (let i = 0; i < cars.length && n < C.POOL; i++) {
                    const v = cars[i];
                    if (v === player || v.isPlayer || v.driverDead) continue;
                    const dx = v.position.x - center.x, dz = v.position.z - center.z;
                    if (dx * dx + dz * dz < C.MAX_DIST * C.MAX_DIST) place(v);
                }
            }
        }
        for (; n < this.lights.length; n++) this.lights[n].intensity = 0;
    }
}
