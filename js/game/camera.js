/**
 * js/game/camera.js
 * 
 * CameraController: First-Person On-Foot & Smooth Third-Person Chase Camera.
 * 
 * Features:
 * - Seamless mode transitions (FIRST_PERSON <-> CHASE)
 * - Exponential yaw lag and heading interpolation behind vehicle
 * - Mouse orbit look during driving with auto-centering on forward acceleration
 * - Instant disembark realignment matching vehicle heading
 * - Zero-allocation update loop for 60Hz benchmark stability
 */

import * as THREE from 'three';

export const CameraMode = Object.freeze({
    FIRST_PERSON: 'FIRST_PERSON',
    CHASE: 'CHASE'
});

/**
 * Shortest-arc angular interpolation.
 * Handles modulo wrapping across [-PI, PI].
 * @param {number} from 
 * @param {number} to 
 * @param {number} t (0 to 1)
 * @returns {number}
 */
export function lerpAngle(from, to, t) {
    let diff = (to - from) % (Math.PI * 2);
    if (diff < -Math.PI) diff += Math.PI * 2;
    if (diff > Math.PI) diff -= Math.PI * 2;
    return from + diff * t;
}

export class CameraController {
    /**
     * @param {Object} options
     * @param {THREE.Camera} options.camera Three.js PerspectiveCamera instance
     * @param {HTMLElement} [options.domElement] Canvas or window element for pointer lock
     */
    constructor(options = {}) {
        this.camera = options.camera || null;
        this.domElement = options.domElement || null;

        // Current Operating Mode
        this.mode = CameraMode.FIRST_PERSON;
        this.targetVehicle = null;

        // First-Person Parameters
        this.fpYaw = 0;
        this.fpPitch = 0;
        this.mouseSensitivity = 0.002;
        this.fpMaxPitch = Math.PI / 2 - 0.1; // ~84 degrees
        this.eyeHeight = 1.7;

        // Third-Person Chase Parameters
        this.chaseDistance = 6.8;    // Distance behind vehicle center (m)
        this.chaseHeight = 2.5;      // Height above vehicle plane (m)
        this.chaseYaw = 0;           // Current interpolated chase yaw
        this.yawFollowRate = 6.0;    // Exponential follow rate for yaw (1/s)
        this.posFollowRate = 12.0;   // Exponential follow rate for position (1/s)
        this.targetLookHeight = 1.2; // Vertical focus offset on car

        // Orbit offsets while driving
        this.orbitYaw = 0;
        this.orbitPitch = 0;

        // In-Vehicle First-Person Aiming (Drive-By Mode)
        this.isAiming = false;
        this.aimTransition = 0.0; // 0.0 = 3rd person chase, 1.0 = 1st person cockpit
        this.aimYaw = 0;          // Full 360 degree aim yaw in radians
        this.aimPitch = 0;        // Vertical aim pitch in radians
        this.cockpitOffset = new THREE.Vector3(-0.4, 1.25, 0.05); // Driver eye position in vehicle local space

        // Zero-allocation scratch vectors
        this._desiredPos = new THREE.Vector3();
        this._lookTarget = new THREE.Vector3();
        this._forward = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._vPos = new THREE.Vector3();
        this._cockpitPos = new THREE.Vector3();
        this._cockpitAimTarget = new THREE.Vector3();
        this._blendedLookTarget = new THREE.Vector3();
    }

    /**
     * Toggles in-vehicle first-person aiming mode.
     * @param {boolean} aiming 
     */
    setAiming(aiming) {
        if (this.isAiming !== aiming) {
            this.isAiming = !!aiming;
            if (this.isAiming && this.camera) {
                // Initialize aimYaw and aimPitch smoothly from camera's current world direction
                const dir = new THREE.Vector3();
                this.camera.getWorldDirection(dir);
                if (dir.lengthSq() > 0.001) {
                    this.aimYaw = Math.atan2(-dir.x, -dir.z);
                    this.aimPitch = Math.asin(Math.max(-0.95, Math.min(0.95, dir.y)));
                } else if (this.targetVehicle) {
                    this.aimYaw = typeof this.targetVehicle.getYaw === 'function' ? this.targetVehicle.getYaw() : 0;
                    this.aimPitch = 0;
                }
            }
        }
    }

    /**
     * Set active camera mode and target.
     * @param {'FIRST_PERSON'|'CHASE'} mode 
     * @param {Vehicle|THREE.Vector3} [target] Vehicle for CHASE, or position for FIRST_PERSON
     */
    setMode(mode, target = null) {
        if (mode === CameraMode.CHASE) {
            this.mode = CameraMode.CHASE;
            this.targetVehicle = target;
            this.isAiming = false;
            this.aimTransition = 0.0;

            if (target) {
                const vYaw = typeof target.getYaw === 'function' ? target.getYaw() : 0;
                this.chaseYaw = vYaw;
                this.orbitYaw = 0;
                this.orbitPitch = 0;

                // Snap camera immediately behind vehicle on initial entry
                const vp = target.getPosition();
                const dist = this.chaseDistance;
                const h = this.chaseHeight;
                if (this.camera) {
                    this.camera.position.set(
                        vp.x + Math.sin(vYaw) * dist,
                        (vp.y || 0) + h,
                        vp.z + Math.cos(vYaw) * dist
                    );
                    this.camera.lookAt(vp.x, (vp.y || 0) + this.targetLookHeight, vp.z);
                }
            }
        } else {
            // Returning to FIRST_PERSON
            this.mode = CameraMode.FIRST_PERSON;
            this.isAiming = false;
            this.aimTransition = 0.0;

            // Align first-person heading with chase camera heading for seamless orientation
            if (this.targetVehicle) {
                const vYaw = typeof this.targetVehicle.getYaw === 'function' ? this.targetVehicle.getYaw() : this.chaseYaw;
                this.fpYaw = vYaw;
                this.fpPitch = 0;
            }
            this.targetVehicle = null;

            if (target && this.camera) {
                const px = target.x !== undefined ? target.x : target.position.x;
                const py = target.y !== undefined ? target.y : target.position.y;
                const pz = target.z !== undefined ? target.z : target.position.z;
                this.camera.position.set(px, (py || 0) + this.eyeHeight, pz);
                this._updateFirstPersonOrientation();
            }
        }
    }

    /**
     * Mouse look movement event handler.
     * @param {number} movementX 
     * @param {number} movementY 
     */
    handleMouseMove(movementX, movementY) {
        if (this.mode === CameraMode.FIRST_PERSON) {
            this.fpYaw -= movementX * this.mouseSensitivity;
            this.fpPitch -= movementY * this.mouseSensitivity;
            this.fpPitch = Math.max(-this.fpMaxPitch, Math.min(this.fpMaxPitch, this.fpPitch));

            // Wrap yaw to [-PI, PI]
            while (this.fpYaw > Math.PI) this.fpYaw -= 2 * Math.PI;
            while (this.fpYaw < -Math.PI) this.fpYaw += 2 * Math.PI;
        } else if (this.mode === CameraMode.CHASE) {
            if (this.isAiming || this.aimTransition > 0.05) {
                // Full 360 degree aiming while in vehicle
                this.aimYaw -= movementX * this.mouseSensitivity;
                this.aimPitch -= movementY * this.mouseSensitivity;
                this.aimPitch = Math.max(-0.85, Math.min(0.85, this.aimPitch));

                // Wrap yaw to [-PI, PI] without any clamp, allowing full 360 rotation
                while (this.aimYaw > Math.PI) this.aimYaw -= 2 * Math.PI;
                while (this.aimYaw < -Math.PI) this.aimYaw += 2 * Math.PI;
            } else {
                // Orbit camera around car
                this.orbitYaw -= movementX * this.mouseSensitivity;
                this.orbitPitch -= movementY * this.mouseSensitivity;
                this.orbitPitch = Math.max(-0.4, Math.min(0.6, this.orbitPitch));

                while (this.orbitYaw > Math.PI) this.orbitYaw -= 2 * Math.PI;
                while (this.orbitYaw < -Math.PI) this.orbitYaw += 2 * Math.PI;
            }
        }
    }

    /**
     * Internal orientation calculation for first-person view.
     * @private
     */
    _updateFirstPersonOrientation() {
        if (!this.camera) return;
        this._forward.set(-Math.sin(this.fpYaw), 0, -Math.cos(this.fpYaw));
        this._right.set(Math.cos(this.fpYaw), 0, -Math.sin(this.fpYaw));
        this._forward.applyAxisAngle(this._right, this.fpPitch);
        this._lookTarget.copy(this.camera.position).addScaledVector(this._forward, 10);
        this.camera.lookAt(this._lookTarget);
    }

    /**
     * Frame update tick.
     * @param {number} dt Constant timestep in seconds (1/60)
     * @param {THREE.Vector3|Object} playerPos Current player position
     */
    update(dt = 1 / 60, playerPos = null) {
        if (!this.camera) return;

        if (this.mode === CameraMode.FIRST_PERSON) {
            if (playerPos) {
                const px = playerPos.x !== undefined ? playerPos.x : 0;
                const py = playerPos.y !== undefined ? playerPos.y : 0;
                const pz = playerPos.z !== undefined ? playerPos.z : 0;
                this.camera.position.set(px, py + this.eyeHeight, pz);
            }
            this._updateFirstPersonOrientation();
        } else if (this.mode === CameraMode.CHASE) {
            if (!this.targetVehicle) {
                this.setMode(CameraMode.FIRST_PERSON, playerPos);
                return;
            }

            // Smooth transition alpha: 0.0 (3rd-person chase) <-> 1.0 (1st-person cockpit aim)
            const targetTransition = this.isAiming ? 1.0 : 0.0;
            const transitionSpeed = 10.0; // Smooth 0.25s transition
            const alphaStep = 1.0 - Math.exp(-dt * transitionSpeed);
            this.aimTransition += (targetTransition - this.aimTransition) * alphaStep;
            if (Math.abs(this.aimTransition - targetTransition) < 0.001) {
                this.aimTransition = targetTransition;
            }

            const vp = this.targetVehicle.getPosition();
            const vy = typeof this.targetVehicle.getYaw === 'function' ? this.targetVehicle.getYaw() : 0;
            const speed = typeof this.targetVehicle.getSpeed === 'function' ? this.targetVehicle.getSpeed() : 0;

            // When moving forward/reverse and NOT aiming, decay manual orbit yaw/pitch back toward 0
            if (speed > 1.0 && !this.isAiming && this.aimTransition < 0.05) {
                const orbitDecay = 1.0 - Math.exp(-dt * 2.5);
                this.orbitYaw *= (1.0 - orbitDecay);
                this.orbitPitch *= (1.0 - orbitDecay);
            }

            // Smooth chase yaw toward vehicle yaw
            const yawAlpha = 1.0 - Math.exp(-dt * this.yawFollowRate);
            this.chaseYaw = lerpAngle(this.chaseYaw, vy, yawAlpha);

            const effectiveYaw = this.chaseYaw + this.orbitYaw;
            const effectivePitch = this.orbitPitch;

            // Dynamic camera distance / height based on speed
            const speedRatio = Math.min(1.0, speed / 25.0);
            const currentDist = this.chaseDistance + speedRatio * 1.5;
            const currentHeight = this.chaseHeight + speedRatio * 0.4 + Math.sin(effectivePitch) * 2.0;

            const distProj = currentDist * Math.cos(effectivePitch);

            // Compute desired camera position behind vehicle for 3rd person
            this._desiredPos.set(
                vp.x + Math.sin(effectiveYaw) * distProj,
                (vp.y || 0) + currentHeight,
                vp.z + Math.cos(effectiveYaw) * distProj
            );

            // Focus target on vehicle (slightly ahead when moving fast)
            const lookahead = speedRatio * 1.5;
            this._lookTarget.set(
                vp.x - Math.sin(vy) * lookahead,
                (vp.y || 0) + this.targetLookHeight,
                vp.z - Math.cos(vy) * lookahead
            );

            if (this.aimTransition <= 0.001) {
                // Pure Third-Person Chase View
                const posBeta = 1.0 - Math.exp(-dt * this.posFollowRate);
                this.camera.position.lerp(this._desiredPos, posBeta);
                this.camera.lookAt(this._lookTarget);
            } else {
                // Compute First-Person Cockpit Position (Driver seat eye position)
                const cosY = Math.cos(vy);
                const sinY = Math.sin(vy);
                this._cockpitPos.set(
                    vp.x + this.cockpitOffset.x * cosY + this.cockpitOffset.z * sinY,
                    (vp.y || 0) + this.cockpitOffset.y,
                    vp.z - this.cockpitOffset.x * sinY + this.cockpitOffset.z * cosY
                );

                // Compute 360-degree Cockpit Aim Target
                const cosP = Math.cos(this.aimPitch);
                const sinP = Math.sin(this.aimPitch);
                const aimDirX = -Math.sin(this.aimYaw) * cosP;
                const aimDirY = sinP;
                const aimDirZ = -Math.cos(this.aimYaw) * cosP;
                this._cockpitAimTarget.set(
                    this._cockpitPos.x + aimDirX * 25.0,
                    this._cockpitPos.y + aimDirY * 25.0,
                    this._cockpitPos.z + aimDirZ * 25.0
                );

                // Smoothstep interpolation between 3rd person and 1st person
                const t = this.aimTransition * this.aimTransition * (3.0 - 2.0 * this.aimTransition);

                // Blend camera position smoothly
                this._desiredPos.lerp(this._cockpitPos, t);
                const posBeta = 1.0 - Math.exp(-dt * this.posFollowRate);
                this.camera.position.lerp(this._desiredPos, posBeta);

                // Blend look target smoothly
                this._blendedLookTarget.lerpVectors(this._lookTarget, this._cockpitAimTarget, t);
                this.camera.lookAt(this._blendedLookTarget);
            }
        }
    }
}
