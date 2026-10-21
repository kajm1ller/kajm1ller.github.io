import * as THREE from 'three';

const _scratchTireOffset = new THREE.Vector3();
const _upAxis = new THREE.Vector3(0, 1, 0);

/**
 * High-performance, zero-garbage-collection tire smoke particle system.
 * Emits billowing white/grey smoke puffs from tires when drifting with Space / handbrake.
 */
export class TireSmokeSystem {
    /**
     * @param {THREE.Scene} scene
     * @param {number} [maxParticles=80]
     */
    constructor(scene, maxParticles = 80) {
        this.scene = scene;
        this.maxParticles = maxParticles;
        this.pool = [];
        this.totalSpawned = 0;
        this.isEmitting = false;
        this.emitCooldown = 0;

        // Shared geometry and individual low-overhead materials for per-particle opacity
        const geo = new THREE.SphereGeometry(0.26, 6, 5);

        for (let i = 0; i < maxParticles; i++) {
            const mat = new THREE.MeshBasicMaterial({
                color: 0xefefef,
                transparent: true,
                opacity: 0.65,
                depthWrite: false
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.name = `tire_smoke_particle_${i}`;
            mesh.visible = false;
            this.scene.add(mesh);

            this.pool.push({
                mesh,
                active: false,
                life: 0,
                maxLife: 0.6,
                velocity: new THREE.Vector3(),
                initialScale: 0.35,
                baseOpacity: 0.65
            });
        }
    }

    /**
     * Spawns or recycles a smoke particle at the given world coordinates.
     */
    emitAt(x, y, z, vx = 0, vy = 0.5, vz = 0) {
        let p = null;
        for (let i = 0; i < this.pool.length; i++) {
            if (!this.pool[i].active) {
                p = this.pool[i];
                break;
            }
        }

        // If pool is fully active, recycle the oldest particle
        if (!p) {
            let maxLife = -1;
            p = this.pool[0];
            for (let i = 0; i < this.pool.length; i++) {
                if (this.pool[i].life > maxLife) {
                    maxLife = this.pool[i].life;
                    p = this.pool[i];
                }
            }
        }

        p.active = true;
        p.life = 0;
        p.maxLife = 0.45 + Math.random() * 0.3;
        p.initialScale = 0.32 + Math.random() * 0.15;
        p.baseOpacity = 0.65 + Math.random() * 0.15;

        p.mesh.position.set(
            x + (Math.random() - 0.5) * 0.12,
            Math.max(0.08, y + (Math.random() - 0.5) * 0.04),
            z + (Math.random() - 0.5) * 0.12
        );
        p.mesh.scale.set(p.initialScale, p.initialScale, p.initialScale);
        p.mesh.material.opacity = p.baseOpacity;
        p.mesh.visible = true;

        p.velocity.set(
            vx + (Math.random() - 0.5) * 0.4,
            vy + Math.random() * 0.35,
            vz + (Math.random() - 0.5) * 0.4
        );

        this.totalSpawned++;
        return p;
    }

    /**
     * Updates smoke emission and active particle simulation.
     * @param {number} dt Timestep
     * @param {Vehicle|null} vehicle Active player vehicle
     * @param {boolean} isSpacePressed Space key status
     */
    update(dt, vehicle, isSpacePressed = false) {
        this.isEmitting = false;

        if (vehicle) {
            const isHandbrake = !!(vehicle.inputHandbrake || isSpacePressed);
            const rawSpd = typeof vehicle.getSpeed === 'function' ? vehicle.getSpeed() : (vehicle.speed || 0);
            const speed = Math.abs(rawSpd);
            const isThrottling = !!(vehicle.inputThrottle > 0.05);

            // Emit smoke when handbrake/space is held and car is moving or doing a burnout
            if (isHandbrake && (speed > 0.4 || isThrottling)) {
                this.isEmitting = true;
                this.emitCooldown -= dt;

                if (this.emitCooldown <= 0) {
                    this.emitCooldown = 0.032; // ~30 puffs/second

                    const yaw = typeof vehicle.getYaw === 'function' ? vehicle.getYaw() : (vehicle.yaw || 0);
                    const vPos = typeof vehicle.getPosition === 'function' ? vehicle.getPosition() : vehicle.position;

                    // Skid momentum / tire kickback
                    const sinYaw = Math.sin(yaw);
                    const cosYaw = Math.cos(yaw);
                    const fwdX = -sinYaw;
                    const fwdZ = -cosYaw;
                    const kickX = -fwdX * Math.sign(rawSpd || 1) * 0.35;
                    const kickZ = -fwdZ * Math.sign(rawSpd || 1) * 0.35;

                    // Rear Left tire: local (-1.0, 0.15, 1.30)
                    _scratchTireOffset.set(-1.0, 0.15, 1.30).applyAxisAngle(_upAxis, yaw).add(vPos);
                    this.emitAt(_scratchTireOffset.x, _scratchTireOffset.y, _scratchTireOffset.z, kickX, 0.65, kickZ);

                    // Rear Right tire: local (1.0, 0.15, 1.30)
                    _scratchTireOffset.set(1.0, 0.15, 1.30).applyAxisAngle(_upAxis, yaw).add(vPos);
                    this.emitAt(_scratchTireOffset.x, _scratchTireOffset.y, _scratchTireOffset.z, kickX, 0.65, kickZ);

                    // Hard drift or high-speed skid: also emit smoke from front tires
                    const steerAngle = Math.abs(vehicle.steerAngle || 0);
                    if (steerAngle > 0.18 || speed > 6.0) {
                        _scratchTireOffset.set(-1.0, 0.15, -1.30).applyAxisAngle(_upAxis, yaw).add(vPos);
                        this.emitAt(_scratchTireOffset.x, _scratchTireOffset.y, _scratchTireOffset.z, kickX * 0.6, 0.5, kickZ * 0.6);

                        _scratchTireOffset.set(1.0, 0.15, -1.30).applyAxisAngle(_upAxis, yaw).add(vPos);
                        this.emitAt(_scratchTireOffset.x, _scratchTireOffset.y, _scratchTireOffset.z, kickX * 0.6, 0.5, kickZ * 0.6);
                    }
                }
            }
        }

        // Advance active particles
        for (let i = 0; i < this.pool.length; i++) {
            const p = this.pool[i];
            if (!p.active) continue;

            p.life += dt;
            if (p.life >= p.maxLife) {
                p.active = false;
                p.mesh.visible = false;
                continue;
            }

            const progress = p.life / p.maxLife;

            // Integrate position
            p.mesh.position.x += p.velocity.x * dt;
            p.mesh.position.y += p.velocity.y * dt;
            p.mesh.position.z += p.velocity.z * dt;

            // Atmospheric drag
            p.velocity.x *= 0.95;
            p.velocity.y *= 0.97;
            p.velocity.z *= 0.95;

            // Scale expansion (billowing cloud effect)
            const currentScale = p.initialScale * (1.0 + progress * 2.4);
            p.mesh.scale.set(currentScale, currentScale, currentScale);

            // Opacity fadeout
            p.mesh.material.opacity = p.baseOpacity * (1.0 - progress);
        }
    }

    /**
     * @returns {Array<object>} All currently active smoke particles
     */
    getActiveParticles() {
        return this.pool.filter(p => p.active);
    }

    /**
     * @returns {number} Count of active particles
     */
    getActiveCount() {
        let count = 0;
        for (let i = 0; i < this.pool.length; i++) {
            if (this.pool[i].active) count++;
        }
        return count;
    }

    /**
     * Resets all particles to inactive state.
     */
    reset() {
        for (let i = 0; i < this.pool.length; i++) {
            this.pool[i].active = false;
            this.pool[i].mesh.visible = false;
        }
        this.totalSpawned = 0;
        this.isEmitting = false;
    }
}
