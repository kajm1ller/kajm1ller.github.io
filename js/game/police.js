import * as THREE from 'three';
import { Vehicle } from './vehicle.js';

const _scratchTargetDelta = new THREE.Vector3();
const _scratchForward = new THREE.Vector3();
const _scratchRight = new THREE.Vector3();

/**
 * Procedural Web Audio API police siren.
 * Eliminates need for external audio files and avoids 404s.
 */
export class PoliceSirenAudio {
    constructor(audioContext = null) {
        this.ctx = audioContext;
        this.osc = null;
        this.gainNode = null;
        this.filterNode = null;
        this.isActive = false;
        this.phase = 0;
    }

    setContext(ctx) {
        if (!this.ctx && ctx) {
            this.ctx = ctx;
        }
    }

    ensureNodes() {
        if (!this.ctx || this.osc) return;
        try {
            this.osc = this.ctx.createOscillator();
            this.osc.type = 'sawtooth';
            this.osc.frequency.setValueAtTime(700, this.ctx.currentTime);

            this.filterNode = this.ctx.createBiquadFilter();
            this.filterNode.type = 'lowpass';
            this.filterNode.frequency.setValueAtTime(2200, this.ctx.currentTime);

            this.gainNode = this.ctx.createGain();
            this.gainNode.gain.setValueAtTime(0, this.ctx.currentTime);

            this.osc.connect(this.filterNode);
            this.filterNode.connect(this.gainNode);
            this.gainNode.connect(this.ctx.destination);
            this.osc.start();
        } catch (e) {
            this.osc = null;
            this.gainNode = null;
        }
    }

    update(dt, isSirenActive, minDistanceToCamera) {
        if (!isSirenActive) {
            if (this.gainNode && this.ctx) {
                this.gainNode.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
            }
            this.isActive = false;
            return;
        }

        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }

        this.ensureNodes();
        if (!this.gainNode || !this.osc || !this.ctx) return;

        this.isActive = true;
        this.phase += dt * 3.8; // ~0.6 Hz cycle

        // Modulate frequency between 650 Hz and 1050 Hz (classic police wail)
        const freq = 850 + Math.sin(this.phase) * 200;
        this.osc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.04);

        // Attenuate volume based on camera distance (audible within 85m)
        const maxDist = 85.0;
        const distRatio = Math.max(0, Math.min(1.0, 1.0 - (minDistanceToCamera / maxDist)));
        const targetVol = 0.14 * Math.pow(distRatio, 1.4);

        this.gainNode.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.05);
    }

    stop() {
        if (this.gainNode && this.ctx) {
            this.gainNode.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
        }
        this.isActive = false;
    }
}

/**
 * Dedicated Police Cruiser vehicle.
 * Extends Vehicle with police livery, roof lightbar, push bumper, and pursuit AI.
 */
export class PoliceVehicle extends Vehicle {
    constructor(id, x, z, yaw, scene) {
        // Dark navy/black police paint
        super(id, x, z, yaw, 0x0f1423, false);
        this.isPolice = true;
        this.isPlayer = false;

        // Enhanced pursuit physics capabilities
        this.maxForwardSpeed = 26.0;
        this.baseAccel = 11.5;
        this.stuckTimer = 0;
        this.reverseTimer = 0;
        this.ramImpulseTimer = 0;

        // Visual Customization: White door decals & push bumper
        this._buildPoliceAesthetics();

        // Visual Customization: Roof emergency lightbar
        this._buildLightbar();

        if (scene) {
            scene.add(this.getMesh());
        }
    }

    _buildPoliceAesthetics() {
        const root = this.getMesh();
        const whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
        const blackMat = new THREE.MeshLambertMaterial({ color: 0x111111 });

        // Left white door decal
        const leftDoor = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.58, 1.4), whiteMat);
        leftDoor.name = 'police_door_left';
        leftDoor.position.set(-1.11, 0.55, -0.1);
        root.add(leftDoor);

        // Right white door decal
        const rightDoor = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.58, 1.4), whiteMat);
        rightDoor.name = 'police_door_right';
        rightDoor.position.set(1.11, 0.55, -0.1);
        root.add(rightDoor);

        // Roof white center panel
        const roofPanel = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.03, 1.2), whiteMat);
        roofPanel.name = 'police_roof_panel';
        roofPanel.position.set(0, 1.41, -0.2);
        root.add(roofPanel);

        // Front heavy push-bumper / ram bar
        const pushBumper = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.28, 0.12), blackMat);
        pushBumper.name = 'police_push_bumper';
        pushBumper.position.set(0, 0.35, -2.36);
        root.add(pushBumper);
    }

    _buildLightbar() {
        const root = this.getMesh();
        const lightbarGroup = new THREE.Group();
        lightbarGroup.name = 'police_lightbar';
        lightbarGroup.position.set(0, 1.45, -0.1);

        // Mounting bar
        const mountMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
        const mount = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.26), mountMat);
        mount.name = 'lightbar_mount';
        lightbarGroup.add(mount);

        // Left Red Beacon
        this.redMat = new THREE.MeshBasicMaterial({ color: 0xff1122 });
        this.redBeacon = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.22), this.redMat);
        this.redBeacon.name = 'lightbar_red';
        this.redBeacon.position.set(-0.24, 0.09, 0);
        lightbarGroup.add(this.redBeacon);

        // Right Blue Beacon
        this.blueMat = new THREE.MeshBasicMaterial({ color: 0x1144ff });
        this.blueBeacon = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.22), this.blueMat);
        this.blueBeacon.name = 'lightbar_blue';
        this.blueBeacon.position.set(0.24, 0.09, 0);
        lightbarGroup.add(this.blueBeacon);

        root.add(lightbarGroup);
        this.lightbarGroup = lightbarGroup;
        this.strobeTime = 0;
    }

    /**
     * Updates flashing emergency lightbar strobes.
     */
    updateStrobes(dt) {
        this.strobeTime += dt;
        // Alternating strobe flash (every 140ms)
        const phase = Math.floor((this.strobeTime * 1000) / 140) % 4;

        if (phase === 0 || phase === 1) {
            // Red on, Blue off
            this.redMat.color.setHex(0xff0000);
            this.blueMat.color.setHex(0x051540);
        } else {
            // Blue on, Red off
            this.redMat.color.setHex(0x400505);
            this.blueMat.color.setHex(0x0066ff);
        }
    }

    /**
     * Police Pursuit AI: computes steering and throttle to pursue/intercept target.
     * @param {number} dt Timestep
     * @param {THREE.Vector3|{x: number, y: number, z: number}} targetPos Player world position
     * @param {boolean} isTargetInVehicle Whether target is driving
     * @param {SpatialGrid} spatialGrid
     * @param {RoadNetwork} roadNetwork
     */
    updateAI(dt, targetPos, isTargetInVehicle, spatialGrid, roadNetwork) {
        this.updateStrobes(dt);

        const px = this.position.x;
        const pz = this.position.z;
        const tx = targetPos.x;
        const tz = targetPos.z;

        const dx = tx - px;
        const dz = tz - pz;
        const dist = Math.hypot(dx, dz);

        // In Three.js vehicle heading: forward is (-sin(yaw), 0, -cos(yaw)), right is (cos(yaw), 0, -sin(yaw))
        const yaw = this.yaw || 0;
        const cosYaw = Math.cos(yaw);
        const sinYaw = Math.sin(yaw);

        const targetForward = -dx * sinYaw - dz * cosYaw;
        const targetRight = dx * cosYaw - dz * sinYaw;
        const angleToTarget = Math.atan2(targetRight, targetForward);

        // Anti-stuck resolution
        if (this.reverseTimer > 0) {
            this.reverseTimer -= dt;
            this.setInputs(0, targetRight > 0 ? 1 : -1, 1.0, false);
            this.update(dt, spatialGrid, roadNetwork);
            return;
        }

        const absSpeed = Math.abs(this.speed);
        if (absSpeed < 0.35 && dist > 3.0) {
            this.stuckTimer += dt;
            if (this.stuckTimer > 1.2) {
                this.reverseTimer = 1.0;
                this.stuckTimer = 0;
            }
        } else {
            this.stuckTimer = Math.max(0, this.stuckTimer - dt);
        }

        // Steering demand: negative is right, positive is left
        // angleToTarget > 0 means target is to the right -> negative steer
        let steerDemand = -angleToTarget * 1.8;
        steerDemand = Math.max(-1.0, Math.min(1.0, steerDemand));

        let throttle = 1.0;
        let brake = 0;
        let handbrake = false;

        if (isTargetInVehicle) {
            // Vehicle pursuit: full throttle, ram player!
            throttle = 1.0;
            brake = 0;

            // Handbrake drift assist on sharp 90-degree pursuit turns at speed
            if (Math.abs(angleToTarget) > 1.0 && absSpeed > 10.0) {
                handbrake = true;
            }
        } else {
            // On-foot pursuit: corner and box in player
            if (dist < 4.0) {
                // Slow down / brake to arrest player
                throttle = 0;
                brake = 0.8;
            } else if (dist < 8.0 && targetForward < 0) {
                // Very close and facing away: decelerate
                throttle = 0.3;
                brake = 0.2;
            } else {
                throttle = 1.0;
                brake = 0;
            }
        }

        this.setInputs(throttle, steerDemand, brake, handbrake);
        this.update(dt, spatialGrid, roadNetwork);
    }
}

/**
 * Manages crimes, wanted stars, police dispatch, sirens, and pursuit logic.
 */
export class PoliceSystem {
    /**
     * @param {THREE.Scene} scene
     * @param {SpatialGrid} spatialGrid
     * @param {RoadNetwork} roadNetwork
     * @param {AudioContext} [audioContext=null]
     */
    constructor(scene, spatialGrid, roadNetwork, audioContext = null) {
        this.scene = scene;
        this.spatialGrid = spatialGrid;
        this.roadNetwork = roadNetwork;

        this.wantedLevel = 0;
        this.policeCars = [];
        this.wantedCooldown = 0;
        this.isEvading = false;
        this.isBusted = false;
        this.bustedTimer = 0;
        this.bustedOverlayTimer = 0;
        this.lastCrimeType = null;
        this.crimeHistory = [];
        this.carIdCounter = 1;

        this.sirenAudio = new PoliceSirenAudio(audioContext);

        this.hudElements = this._findHUDElements();
        this.updateHUD();
    }

    _findHUDElements() {
        if (typeof document === 'undefined') return null;
        return {
            container: document.getElementById('wanted-hud'),
            title: document.getElementById('wanted-title'),
            stars: document.querySelectorAll('.wanted-star'),
            busted: document.getElementById('busted-overlay')
        };
    }

    setAudioContext(ctx) {
        this.sirenAudio.setContext(ctx);
    }

    /**
     * Reports a crime committed by the player.
     * @param {'shooting'|'vehicular_homicide'|'vehicular_assault'|string} type Crime type
     * @param {THREE.Vector3|{x: number, y: number, z: number}} [pos]
     */
    triggerCrime(type, pos = null) {
        const crime = {
            type,
            pos: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
            time: Date.now()
        };
        this.crimeHistory.push(crime);
        this.lastCrimeType = type;

        // Increment wanted level (1-5 stars)
        if (this.wantedLevel === 0) {
            this.wantedLevel = (type === 'vehicular_homicide' || type === 'shooting') ? 1 : 1;
        } else {
            this.wantedLevel = Math.min(5, this.wantedLevel + 1);
        }

        this.wantedCooldown = 25.0; // 25 seconds evasion window
        this.isEvading = false;
        this.isBusted = false;

        this._syncPoliceFleet(pos);
        this.updateHUD();
    }

    /**
     * Directly modifies wanted level (0 to 5).
     * @param {number} level
     */
    setWantedLevel(level, pos = null) {
        this.wantedLevel = Math.max(0, Math.min(5, Math.floor(level)));
        if (this.wantedLevel === 0) {
            this.clearWantedLevel();
        } else {
            this.wantedCooldown = 25.0;
            this.isEvading = false;
            this._syncPoliceFleet(pos);
            this.updateHUD();
        }
    }

    /**
     * Clears wanted status and despawns pursuit vehicles.
     */
    clearWantedLevel() {
        this.wantedLevel = 0;
        this.wantedCooldown = 0;
        this.isEvading = false;
        this.bustedTimer = 0;

        for (let i = 0; i < this.policeCars.length; i++) {
            const pc = this.policeCars[i];
            if (this.scene) {
                this.scene.remove(pc.getMesh());
            }
        }
        this.policeCars = [];
        this.sirenAudio.stop();
        this.updateHUD();
    }

    _getMaxCars() {
        if (this.wantedLevel === 0) return 0;
        if (this.wantedLevel <= 2) return 1;
        if (this.wantedLevel <= 4) return 2;
        return 3;
    }

    _syncPoliceFleet(targetPos) {
        const maxCars = this._getMaxCars();
        while (this.policeCars.length < maxCars) {
            this.spawnPoliceCar(targetPos);
        }
    }

    /**
     * Spawns a police vehicle on the road network near target position.
     */
    spawnPoliceCar(targetPos = null) {
        const refPos = targetPos || { x: 0, z: 0 };
        let spawnX = refPos.x + 35.0;
        let spawnZ = refPos.z + 35.0;
        let spawnYaw = Math.atan2(refPos.x - spawnX, refPos.z - spawnZ);

        // Find nearest legitimate waypoint on road network
        if (this.roadNetwork && typeof this.roadNetwork.getNearestWaypoint === 'function') {
            const wp = this.roadNetwork.getNearestWaypoint(spawnX, spawnZ);
            if (wp) {
                spawnX = wp.x;
                spawnZ = wp.z;
                spawnYaw = Math.atan2(refPos.x - spawnX, refPos.z - spawnZ);
            }
        }

        // Clamp inside world boundaries [-270, 270]
        spawnX = Math.max(-270, Math.min(270, spawnX));
        spawnZ = Math.max(-270, Math.min(270, spawnZ));

        const carId = `police_civic_${this.carIdCounter++}`;
        const policeCar = new PoliceVehicle(carId, spawnX, spawnZ, spawnYaw, this.scene);

        this.policeCars.push(policeCar);

        if (this.spatialGrid) {
            this.spatialGrid.insertDynamic(policeCar.id, policeCar.position.x, policeCar.position.z, policeCar.radius, policeCar);
        }

        return policeCar;
    }

    /**
     * Updates simulation of police chase, AI, siren, and wanted evasion.
     * @param {number} dt Timestep
     * @param {THREE.Vector3|{x: number, y: number, z: number}} playerPos
     * @param {boolean} isPlayerInVehicle
     * @param {SpatialGrid} spatialGrid
     * @param {RoadNetwork} roadNetwork
     * @param {THREE.Vector3} cameraPos
     */
    update(dt, playerPos, isPlayerInVehicle, spatialGrid, roadNetwork, cameraPos) {
        if (this.bustedOverlayTimer > 0) {
            this.bustedOverlayTimer -= dt;
            if (this.bustedOverlayTimer <= 0) {
                if (this.hudElements && this.hudElements.busted) {
                    this.hudElements.busted.style.display = 'none';
                }
            }
        }

        if (this.wantedLevel <= 0) {
            this.sirenAudio.stop();
            return;
        }

        this._syncPoliceFleet(playerPos);

        let minDistanceToPlayer = Infinity;
        let minDistanceToCamera = Infinity;

        // Update each police car AI
        for (let i = 0; i < this.policeCars.length; i++) {
            const pc = this.policeCars[i];
            pc.updateAI(dt, playerPos, isPlayerInVehicle, spatialGrid, roadNetwork);

            const distP = Math.hypot(playerPos.x - pc.position.x, playerPos.z - pc.position.z);
            if (distP < minDistanceToPlayer) minDistanceToPlayer = distP;

            if (cameraPos) {
                const distC = Math.hypot(cameraPos.x - pc.position.x, cameraPos.z - pc.position.z);
                if (distC < minDistanceToCamera) minDistanceToCamera = distC;
            }
        }

        // Busted logic: if on foot and trapped within 3.5m of police car for > 2.5s
        if (!isPlayerInVehicle && minDistanceToPlayer < 3.5) {
            this.bustedTimer += dt;
            if (this.bustedTimer >= 2.5) {
                this.isBusted = true;
                this.bustedOverlayTimer = 2.5;
                if (this.hudElements && this.hudElements.busted) {
                    this.hudElements.busted.style.display = 'block';
                }
                this.clearWantedLevel();
                return;
            }
        } else {
            this.bustedTimer = Math.max(0, this.bustedTimer - dt * 2.0);
        }

        // Evasion logic: if player stays beyond 50m from all police cars
        if (minDistanceToPlayer > 50.0) {
            this.isEvading = true;
            this.wantedCooldown -= dt;
            if (this.wantedCooldown <= 0) {
                // Successfully escaped police!
                this.clearWantedLevel();
                return;
            }
        } else {
            this.isEvading = false;
            this.wantedCooldown = Math.max(this.wantedCooldown, 12.0);
        }

        // Update procedural siren audio
        this.sirenAudio.update(dt, this.policeCars.length > 0, minDistanceToCamera);

        this.updateHUD();
    }

    /**
     * Synchronizes Wanted HUD HTML elements.
     */
    updateHUD() {
        if (!this.hudElements) {
            this.hudElements = this._findHUDElements();
        }
        if (!this.hudElements || !this.hudElements.container) return;

        if (this.wantedLevel <= 0) {
            this.hudElements.container.style.display = 'none';
            return;
        }

        this.hudElements.container.style.display = 'block';

        // Update stars
        if (this.hudElements.stars) {
            for (let s = 0; s < this.hudElements.stars.length; s++) {
                const starEl = this.hudElements.stars[s];
                const starIdx = s + 1;
                if (starIdx <= this.wantedLevel) {
                    starEl.classList.add('active');
                } else {
                    starEl.classList.remove('active');
                }
            }
        }

        // Update label
        if (this.hudElements.title) {
            if (this.isEvading) {
                const sec = Math.ceil(this.wantedCooldown);
                this.hudElements.title.textContent = `EVADING POLICE (${sec}s)`;
                this.hudElements.title.style.color = '#eab308';
            } else {
                this.hudElements.title.textContent = 'POLICE PURSUIT';
                this.hudElements.title.style.color = '#ef4444';
            }
        }
    }

    isSirenActive() {
        return this.sirenAudio.isActive;
    }
}
