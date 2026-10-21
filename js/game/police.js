import * as THREE from 'three';
import { Vehicle } from './vehicle.js';

const _scratchTargetDelta = new THREE.Vector3();
const _scratchForward = new THREE.Vector3();
const _scratchRight = new THREE.Vector3();

// Shared geometries for police officers & projectiles (zero heap growth)
const officerBodyGeo = new THREE.BoxGeometry(0.5, 1.4, 0.3);
const officerHeadGeo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
const officerHatCrownGeo = new THREE.BoxGeometry(0.38, 0.14, 0.38);
const officerHatBrimGeo = new THREE.BoxGeometry(0.40, 0.03, 0.16);
const officerBadgeGeo = new THREE.BoxGeometry(0.12, 0.12, 0.04);
const officerLegGeo = new THREE.BoxGeometry(0.2, 0.65, 0.22);
const officerArmGeo = new THREE.BoxGeometry(0.12, 0.12, 0.45);
const officerGunGeo = new THREE.BoxGeometry(0.08, 0.12, 0.26);
const policeBulletGeo = new THREE.SphereGeometry(0.09, 5, 5);

// Shared materials
const officerNavyUniformMat = new THREE.MeshLambertMaterial({ color: 0x142542 });
const officerPantsMat = new THREE.MeshLambertMaterial({ color: 0x0f1828 });
const officerGoldBadgeMat = new THREE.MeshLambertMaterial({ color: 0xffd700 });
const officerSkinMat = new THREE.MeshLambertMaterial({ color: 0xf1c27d });
const officerBrimMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
const officerGunMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
const policeBulletMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });

/**
 * Procedural Web Audio API police siren.
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
 * Builds an authentic 3D mesh for an armed police officer with service uniform,
 * peaked cap, gold chest badge, and drawn service pistol.
 */
export function createPoliceOfficerMesh(id) {
    const group = new THREE.Group();
    group.name = `police_officer_${id}`;
    group.userData.isPoliceOfficer = true;

    // 1. Navy blue torso
    const body = new THREE.Mesh(officerBodyGeo, officerNavyUniformMat);
    body.position.y = 0.95;
    group.add(body);

    // 2. Gold police badge on chest
    const badge = new THREE.Mesh(officerBadgeGeo, officerGoldBadgeMat);
    badge.position.set(0.12, 1.25, 0.16);
    group.add(badge);

    // 3. Head with police peaked hat
    const head = new THREE.Mesh(officerHeadGeo, officerSkinMat);
    head.position.y = 1.82;
    group.add(head);

    const hatCrown = new THREE.Mesh(officerHatCrownGeo, officerNavyUniformMat);
    hatCrown.position.set(0, 2.05, 0);
    group.add(hatCrown);

    const hatBrim = new THREE.Mesh(officerHatBrimGeo, officerBrimMat);
    hatBrim.position.set(0, 1.99, -0.22);
    group.add(hatBrim);

    // 4. Legs
    const leftLeg = new THREE.Mesh(officerLegGeo, officerPantsMat);
    leftLeg.position.set(-0.13, 0.32, 0);
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(officerLegGeo, officerPantsMat);
    rightLeg.position.set(0.13, 0.32, 0);
    group.add(rightLeg);

    // 5. Right arm aiming drawn service pistol forward
    const rightArm = new THREE.Mesh(officerArmGeo, officerNavyUniformMat);
    rightArm.position.set(0.32, 1.25, -0.2);
    group.add(rightArm);

    const pistol = new THREE.Mesh(officerGunGeo, officerGunMat);
    pistol.name = 'officer_pistol';
    pistol.position.set(0.32, 1.25, -0.48);
    group.add(pistol);

    // Left arm down at side
    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.12), officerNavyUniformMat);
    leftArm.position.set(-0.32, 0.95, 0);
    group.add(leftArm);

    group.traverse((c) => {
        if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
        }
    });

    group.userData.leftLeg = leftLeg;
    group.userData.rightLeg = rightLeg;
    group.userData.pistol = pistol;
    return group;
}

/**
 * Armed Police Officer NPC.
 * Deploys from police cruiser, pursues player, aims gun, and fires live rounds.
 */
export class PoliceOfficer {
    constructor(id, x, z, yaw, scene = null) {
        this.id = id;
        this.mesh = createPoliceOfficerMesh(id);
        this.position = this.mesh.position;
        this.position.set(x, 0, z);
        this.mesh.rotation.y = yaw || 0;

        this.hp = 100;
        this.maxHp = 100;
        this.isPoliceOfficer = true;
        this.isDead = false;
        this.state = 'pursuing'; // 'pursuing' | 'shooting' | 'ragdoll' | 'dead'

        this.speed = 0.105; // Pursuit sprint speed
        this.walkPhase = Math.random() * 2.0;
        this.shootCooldown = 0.6 + Math.random() * 0.8; // Random initial delay

        this.ragdollVel = new THREE.Vector3();
        this.ragdollAngVel = new THREE.Vector3();
        this.ragdollDisplacement = 0;

        this.mesh.userData.pedestrian = this;

        if (scene) {
            scene.add(this.mesh);
        }
    }

    /**
     * Updates officer AI, positioning, and weapon firing towards the player.
     */
    update(dt, playerPos, isPlayerInVehicle, scene, onShootCallback) {
        if (this.isDead) return;

        // Ragdoll physics update if officer was launched by vehicle
        if (this.state === 'ragdoll') {
            this.mesh.position.x += this.ragdollVel.x * dt;
            this.mesh.position.y += this.ragdollVel.y * dt;
            this.mesh.position.z += this.ragdollVel.z * dt;

            this.ragdollDisplacement += Math.hypot(this.ragdollVel.x * dt, this.ragdollVel.z * dt);
            this.ragdollVel.y -= 24.0 * dt; // Gravity

            this.mesh.rotation.x += this.ragdollAngVel.x * dt;
            this.mesh.rotation.y += this.ragdollAngVel.y * dt;

            // Ground impact
            if (this.mesh.position.y <= 0.25) {
                this.mesh.position.y = 0.25;
                this.mesh.rotation.x = Math.PI / 2;
                this.ragdollVel.set(0, 0, 0);
                this.state = 'dead';
                this.isDead = true;
            }
            return;
        }

        const dx = playerPos.x - this.position.x;
        const dz = playerPos.z - this.position.z;
        const dist = Math.hypot(dx, dz);

        // Turn officer to face player directly
        this.mesh.rotation.y = Math.atan2(dx, dz);

        // Advance towards player if farther than combat standoff distance (5.5m)
        if (dist > 5.5) {
            const dirX = dx / dist;
            const dirZ = dz / dist;
            this.position.x += dirX * this.speed;
            this.position.z += dirZ * this.speed;

            // Animate running legs
            this.walkPhase += 0.24;
            if (this.mesh.userData.leftLeg && this.mesh.userData.rightLeg) {
                this.mesh.userData.leftLeg.rotation.x = Math.sin(this.walkPhase) * 0.5;
                this.mesh.userData.rightLeg.rotation.x = -Math.sin(this.walkPhase) * 0.5;
            }
        } else {
            // Stand firm, aim service pistol
            if (this.mesh.userData.leftLeg && this.mesh.userData.rightLeg) {
                this.mesh.userData.leftLeg.rotation.x = 0;
                this.mesh.userData.rightLeg.rotation.x = 0;
            }
        }

        // Fire service pistol when in line of sight (< 42m)
        if (dist < 42.0) {
            this.shootCooldown -= dt;
            if (this.shootCooldown <= 0) {
                this.shootCooldown = 1.1 + Math.random() * 0.6; // Fire every 1.1-1.7s
                if (typeof onShootCallback === 'function') {
                    onShootCallback(this, playerPos);
                }
            }
        }
    }
}

/**
 * Dedicated Police Cruiser vehicle.
 * Extends Vehicle with police livery, roof lightbar, push bumper, and pursuit AI.
 */
export class PoliceVehicle extends Vehicle {
    constructor(id, x, z, yaw, scene) {
        super(id, x, z, yaw, 0x0f1423, false);
        this.isPolice = true;
        this.isPlayer = false;

        this.maxForwardSpeed = 26.0;
        this.baseAccel = 11.5;
        this.stuckTimer = 0;
        this.reverseTimer = 0;

        this.hasDeployedOfficers = false;

        this._buildPoliceAesthetics();
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

        const mountMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
        const mount = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.26), mountMat);
        mount.name = 'lightbar_mount';
        lightbarGroup.add(mount);

        this.redMat = new THREE.MeshBasicMaterial({ color: 0xff1122 });
        this.redBeacon = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.22), this.redMat);
        this.redBeacon.name = 'lightbar_red';
        this.redBeacon.position.set(-0.24, 0.09, 0);
        lightbarGroup.add(this.redBeacon);

        this.blueMat = new THREE.MeshBasicMaterial({ color: 0x1144ff });
        this.blueBeacon = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.22), this.blueMat);
        this.blueBeacon.name = 'lightbar_blue';
        this.blueBeacon.position.set(0.24, 0.09, 0);
        lightbarGroup.add(this.blueBeacon);

        root.add(lightbarGroup);
        this.lightbarGroup = lightbarGroup;
        this.strobeTime = 0;
    }

    updateStrobes(dt) {
        this.strobeTime += dt;
        const phase = Math.floor((this.strobeTime * 1000) / 140) % 4;

        if (phase === 0 || phase === 1) {
            this.redMat.color.setHex(0xff0000);
            this.blueMat.color.setHex(0x051540);
        } else {
            this.redMat.color.setHex(0x400505);
            this.blueMat.color.setHex(0x0066ff);
        }
    }

    updateAI(dt, targetPos, isTargetInVehicle, spatialGrid, roadNetwork) {
        this.updateStrobes(dt);

        if (this.driverDead) {
            this.setInputs(0, 0, 0.4, false);
            this.update(dt, spatialGrid);
            return;
        }

        const px = this.position.x;
        const pz = this.position.z;
        const tx = targetPos.x;
        const tz = targetPos.z;

        const dx = tx - px;
        const dz = tz - pz;
        const dist = Math.hypot(dx, dz);

        const yaw = this.yaw || 0;
        const cosYaw = Math.cos(yaw);
        const sinYaw = Math.sin(yaw);

        const targetForward = -dx * sinYaw - dz * cosYaw;
        const targetRight = dx * cosYaw - dz * sinYaw;
        const angleToTarget = Math.atan2(targetRight, targetForward);

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

        let steerDemand = -angleToTarget * 1.8;
        steerDemand = Math.max(-1.0, Math.min(1.0, steerDemand));

        let throttle = 1.0;
        let brake = 0;
        let handbrake = false;

        if (isTargetInVehicle) {
            throttle = 1.0;
            brake = 0;

            if (Math.abs(angleToTarget) > 1.0 && absSpeed > 10.0) {
                handbrake = true;
            }
        } else {
            if (dist < 5.0) {
                throttle = 0;
                brake = 0.9;
            } else if (dist < 10.0 && targetForward < 0) {
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
 * Manages crimes, wanted stars, police cruiser dispatch, armed officers on foot,
 * gunshot mechanics, sirens, and wanted evasion.
 */
export class PoliceSystem {
    constructor(scene, spatialGrid, roadNetwork, audioContext = null) {
        this.scene = scene;
        this.spatialGrid = spatialGrid;
        this.roadNetwork = roadNetwork;

        this.wantedLevel = 0;
        this.policeCars = [];
        this.officers = [];
        this.policeProjectiles = [];

        this.wantedCooldown = 0;
        this.isEvading = false;
        this.isBusted = false;
        this.bustedTimer = 0;
        this.bustedOverlayTimer = 0;
        this.lastCrimeType = null;
        this.crimeHistory = [];
        this.carIdCounter = 1;
        this.officerIdCounter = 1;

        this.onDamagePlayer = null;
        this.createBloodPoolCallback = null;
        this.onPlayOfficerGunSound = null;

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
     */
    triggerCrime(type, pos = null) {
        const crime = {
            type,
            pos: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
            time: Date.now()
        };
        this.crimeHistory.push(crime);
        this.lastCrimeType = type;

        if (this.wantedLevel === 0) {
            this.wantedLevel = (type === 'officer_killed') ? 2 : 1;
        } else {
            this.wantedLevel = Math.min(5, this.wantedLevel + 1);
        }

        this.wantedCooldown = 28.0;
        this.isEvading = false;
        this.isBusted = false;

        this._syncPoliceFleet(pos);
        this.updateHUD();
    }

    /**
     * Directly modifies wanted level (0 to 5).
     */
    setWantedLevel(level, pos = null) {
        this.wantedLevel = Math.max(0, Math.min(5, Math.floor(level)));
        if (this.wantedLevel === 0) {
            this.clearWantedLevel();
        } else {
            this.wantedCooldown = 28.0;
            this.isEvading = false;
            this._syncPoliceFleet(pos);
            this.updateHUD();
        }
    }

    /**
     * Clears wanted status and despawns pursuit vehicles and officers.
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

        for (let i = 0; i < this.officers.length; i++) {
            const off = this.officers[i];
            if (this.scene) {
                this.scene.remove(off.mesh);
            }
        }
        this.officers = [];

        for (let i = 0; i < this.policeProjectiles.length; i++) {
            const proj = this.policeProjectiles[i];
            if (this.scene) {
                this.scene.remove(proj.mesh);
            }
        }
        this.policeProjectiles = [];

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
     * Spawns an armed police officer on foot.
     */
    spawnOfficer(pos, cruiser = null) {
        const offId = `officer_${this.officerIdCounter++}`;
        const officer = new PoliceOfficer(offId, pos.x, pos.z, pos.yaw || 0, this.scene);
        officer.cruiser = cruiser;
        this.officers.push(officer);
        return officer;
    }

    /**
     * Called when a police officer is killed by player gunfire or vehicle impact.
     * "If you kill the police officers you gain more stars."
     */
    killOfficer(officer) {
        if (!officer || officer.isDead) return false;

        officer.hp = 0;
        officer.isDead = true;
        officer.state = 'dead';
        officer.mesh.rotation.x = Math.PI / 2;
        officer.mesh.position.y = 0.25;

        if (typeof this.createBloodPoolCallback === 'function') {
            this.createBloodPoolCallback(officer.mesh.position);
        }

        // KILLING POLICE OFFICERS INCREASES WANTED STARS!
        const newWanted = Math.min(5, this.wantedLevel + 1);
        this.wantedLevel = newWanted;
        this.wantedCooldown = 32.0; // Refresh pursuit aggression
        this.isEvading = false;
        this.lastCrimeType = 'officer_killed';
        this.crimeHistory.push({
            type: 'officer_killed',
            officerId: officer.id,
            time: Date.now()
        });

        // Trigger reinforcements for the new wanted level
        this._syncPoliceFleet(officer.mesh.position);
        this.updateHUD();

        return true;
    }

    /**
     * Spawns a police cruiser on the road network near target position.
     */
    spawnPoliceCar(targetPos = null) {
        const refPos = targetPos || { x: 0, z: 0 };
        let spawnX = refPos.x + 35.0;
        let spawnZ = refPos.z + 35.0;
        let spawnYaw = Math.atan2(refPos.x - spawnX, refPos.z - spawnZ);

        if (this.roadNetwork && typeof this.roadNetwork.getNearestWaypoint === 'function') {
            const wp = this.roadNetwork.getNearestWaypoint(spawnX, spawnZ);
            if (wp) {
                spawnX = wp.x;
                spawnZ = wp.z;
                spawnYaw = Math.atan2(refPos.x - spawnX, refPos.z - spawnZ);
            }
        }

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
     * Handles an officer shooting their service pistol at the player.
     */
    handleOfficerFire(officer, playerPos) {
        if (!this.scene) return;

        // Calculate muzzle position in front of officer
        const yaw = officer.mesh.rotation.y;
        const cosY = Math.cos(yaw);
        const sinY = Math.sin(yaw);

        const muzzleX = officer.position.x + (0.32 * cosY + 0.5 * sinY);
        const muzzleY = officer.position.y + 1.25;
        const muzzleZ = officer.position.z - (0.32 * sinY - 0.5 * cosY);

        // Aim towards player center
        const targetX = playerPos.x;
        const targetY = (playerPos.y !== undefined ? playerPos.y : 0) + 1.2;
        const targetZ = playerPos.z;

        const aimVec = new THREE.Vector3(targetX - muzzleX, targetY - muzzleY, targetZ - muzzleZ).normalize();

        // Visible bullet projectile
        const bulletMesh = new THREE.Mesh(policeBulletGeo, policeBulletMat);
        bulletMesh.position.set(muzzleX, muzzleY, muzzleZ);
        this.scene.add(bulletMesh);

        this.policeProjectiles.push({
            mesh: bulletMesh,
            velocity: aimVec.clone().multiplyScalar(48.0), // Fast bullet velocity
            distanceTraveled: 0,
            maxDistance: 60.0
        });

        // Audio trigger
        if (typeof this.onPlayOfficerGunSound === 'function') {
            this.onPlayOfficerGunSound();
        }
    }

    /**
     * Updates simulation of police chase, cruisers, officers, live bullets, and wanted evasion.
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

        // 1. Update Police Cruisers & deploy officers on foot
        for (let i = 0; i < this.policeCars.length; i++) {
            const pc = this.policeCars[i];
            pc.updateAI(dt, playerPos, isPlayerInVehicle, spatialGrid, roadNetwork);

            const distP = Math.hypot(playerPos.x - pc.position.x, playerPos.z - pc.position.z);
            if (distP < minDistanceToPlayer) minDistanceToPlayer = distP;

            if (cameraPos) {
                const distC = Math.hypot(cameraPos.x - pc.position.x, cameraPos.z - pc.position.z);
                if (distC < minDistanceToCamera) minDistanceToCamera = distC;
            }

            // Deploy armed officers from cruiser when within 32m of player or when cruiser brakes/rams
            if (!pc.hasDeployedOfficers && (distP < 32.0 || Math.abs(pc.speed) < 2.5)) {
                pc.hasDeployedOfficers = true;

                const vYaw = pc.yaw || 0;
                const cosY = Math.cos(vYaw);
                const sinY = Math.sin(vYaw);

                // Driver officer disembarks left side
                this.spawnOfficer({
                    x: pc.position.x - 1.8 * cosY,
                    z: pc.position.z + 1.8 * sinY,
                    yaw: vYaw
                }, pc);

                // Passenger officer disembarks right side on wanted level >= 2
                if (this.wantedLevel >= 2) {
                    this.spawnOfficer({
                        x: pc.position.x + 1.8 * cosY,
                        z: pc.position.z - 1.8 * sinY,
                        yaw: vYaw
                    }, pc);
                }
            }
        }

        // 2. Update Armed Officers on foot
        const onShoot = (off, pPos) => this.handleOfficerFire(off, pPos);
        for (let i = 0; i < this.officers.length; i++) {
            const off = this.officers[i];
            off.update(dt, playerPos, isPlayerInVehicle, this.scene, onShoot);

            if (!off.isDead) {
                const d = Math.hypot(playerPos.x - off.position.x, playerPos.z - off.position.z);
                if (d < minDistanceToPlayer) minDistanceToPlayer = d;
            }
        }

        // 3. Update Police Bullet Projectiles
        for (let i = this.policeProjectiles.length - 1; i >= 0; i--) {
            const p = this.policeProjectiles[i];
            const stepVec = p.velocity.clone().multiplyScalar(dt);
            p.mesh.position.add(stepVec);
            p.distanceTraveled += stepVec.length();

            // Collision check against player
            const dx = p.mesh.position.x - playerPos.x;
            const dy = p.mesh.position.y - ((playerPos.y !== undefined ? playerPos.y : 0) + 1.0);
            const dz = p.mesh.position.z - playerPos.z;
            const distToPlayer = Math.hypot(dx, dz);

            if (distToPlayer < 1.15 && Math.abs(dy) < 1.6) {
                // Officer bullet hit player!
                if (typeof this.onDamagePlayer === 'function') {
                    this.onDamagePlayer(15);
                }
                this.scene.remove(p.mesh);
                this.policeProjectiles.splice(i, 1);
                continue;
            }

            if (p.distanceTraveled >= p.maxDistance || p.mesh.position.y < -1) {
                this.scene.remove(p.mesh);
                this.policeProjectiles.splice(i, 1);
            }
        }

        // 4. Busted logic: if on foot and trapped within 3.2m of living police for > 2.5s
        if (!isPlayerInVehicle && minDistanceToPlayer < 3.2) {
            this.bustedTimer += dt;
            if (this.bustedTimer >= 2.5) {
                this.isBusted = true;
                this.bustedOverlayTimer = 2.5;
                if (this.hudElements && this.hudElements.busted) {
                    this.hudElements.busted.textContent = 'BUSTED';
                    this.hudElements.busted.style.display = 'block';
                }
                this.clearWantedLevel();
                return;
            }
        } else {
            this.bustedTimer = Math.max(0, this.bustedTimer - dt * 2.0);
        }

        // 5. Evasion logic: if player stays beyond 50m from all police
        if (minDistanceToPlayer > 50.0) {
            this.isEvading = true;
            this.wantedCooldown -= dt;
            if (this.wantedCooldown <= 0) {
                this.clearWantedLevel();
                return;
            }
        } else {
            this.isEvading = false;
            this.wantedCooldown = Math.max(this.wantedCooldown, 14.0);
        }

        // 6. Update procedural siren audio
        this.sirenAudio.update(dt, this.policeCars.length > 0, minDistanceToCamera);

        this.updateHUD();
    }

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
