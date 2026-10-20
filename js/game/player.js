/**
 * js/game/player.js
 * 
 * PlayerController: On-Foot & In-Vehicle State Machine, Proximity Detection,
 * Driving Input Routing, and Multi-Candidate Safe Exit Placement.
 * 
 * Conforms to:
 * - PROJECT.md § Interface Contracts (4. PlayerController Interface)
 * - Acceptance Criteria R1 (Player-Drivable Vehicles)
 * - Test Suite test/e2e-functional.test.js (Tests 2, 3, 4, 5, 8, 9)
 */

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { ensureCivicHUD, updateCivicHUD } from './vehicle.js';

export const PlayerState = Object.freeze({
    ON_FOOT: 'ON_FOOT',
    IN_VEHICLE: 'IN_VEHICLE'
});

export class PlayerController {
    /**
     * @param {Object} options
     * @param {THREE.Camera} options.camera Primary perspective camera
     * @param {HTMLElement} [options.domElement] DOM container for HUD prompts
     * @param {Object} [options.cameraController] Camera manager for 1st/3rd person transitions
     * @param {Object} [options.spatialGrid] 2D spatial hash grid broadphase
     * @param {THREE.Vector3|Object} [options.initialPosition] Starting world position
     */
    constructor(options = {}) {
        this.camera = options.camera || null;
        this.cameraController = options.cameraController || null;
        this.spatialGrid = options.spatialGrid || null;
        this.domElement = options.domElement || (typeof document !== 'undefined' ? document.body : null);
        this.onExit = typeof options.onExit === 'function' ? options.onExit : null;
        this.externalPosition = (options.initialPosition && typeof options.initialPosition.copy === 'function')
            ? options.initialPosition
            : (options.playerPosition && typeof options.playerPosition.copy === 'function')
                ? options.playerPosition
                : null;

        // State Machine
        this.state = PlayerState.ON_FOOT;
        this.activeVehicle = null;
        this.nearbyVehicle = null;

        this.radius = (CONFIG.PLAYER && CONFIG.PLAYER.RADIUS) || 0.4;
        this.eyeHeight = (CONFIG.PLAYER && CONFIG.PLAYER.EYE_HEIGHT) || 1.7;
        this.moveSpeed = (CONFIG.PLAYER && CONFIG.PLAYER.MOVE_SPEED) || 7.2;
        this.interactionRadius = (CONFIG.PLAYER && CONFIG.PLAYER.INTERACTION_RADIUS) || 3.5;

        // Player Physical Dimensions & Kinematics
        this.position = new THREE.Vector3(0, this.eyeHeight, 0);
        if (options.initialPosition) {
            this.position.set(
                options.initialPosition.x !== undefined ? options.initialPosition.x : 0,
                options.initialPosition.y !== undefined ? options.initialPosition.y : this.eyeHeight,
                options.initialPosition.z !== undefined ? options.initialPosition.z : 0
            );
        }

        // Input State
        this.keys = {
            w: false,
            a: false,
            s: false,
            d: false,
            shift: false,
            space: false,
            e: false
        };

        // DOM HUD Prompt Element Cache
        this.hudPrompt = null;
        this._initHUD();

        // Zero-allocation scratch structures for queries and physics
        this._scratchResults = [];
        this._scratchBox = new THREE.Box3();
        this._forward = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._newPos = new THREE.Vector3();
        this._newPosX = new THREE.Vector3();
        this._newPosZ = new THREE.Vector3();
        this._vehiclePos = { x: 0, y: 0, z: 0 };
    }

    /**
     * Cache or create the boarding HUD prompt element.
     * @private
     */
    _initHUD() {
        if (typeof document === 'undefined') return;
        ensureCivicHUD(this.domElement);
        let el = document.getElementById('vehicle-prompt');
        if (!el && this.domElement) {
            el = document.createElement('div');
            el.id = 'vehicle-prompt';
            el.style.display = 'none';
            el.style.position = 'absolute';
            el.style.bottom = '25%';
            el.style.left = '50%';
            el.style.transform = 'translateX(-50%)';
            el.style.background = 'rgba(0, 0, 0, 0.75)';
            el.style.color = '#4ade80';
            el.style.border = '2px solid #4ade80';
            el.style.padding = '10px 24px';
            el.style.borderRadius = '8px';
            el.style.fontFamily = 'Arial, sans-serif';
            el.style.fontSize = '16px';
            el.style.fontWeight = 'bold';
            el.style.textTransform = 'uppercase';
            el.style.letterSpacing = '1px';
            el.style.pointerEvents = 'none';
            el.style.zIndex = '150';
            el.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.5)';
            el.textContent = 'Press [E] to Drive';
            this.domElement.appendChild(el);
        }
        this.hudPrompt = el;
    }

    /**
     * Show HUD prompt with given text.
     * @param {string} text 
     */
    showPrompt(text = 'Press [E] to Drive') {
        if (this.hudPrompt) {
            this.hudPrompt.textContent = text;
            this.hudPrompt.style.display = 'block';
        }
        if (typeof document !== 'undefined') {
            const carInd = document.getElementById('car-indicator');
            if (carInd) carInd.style.display = 'block';
        }
    }

    /**
     * Hide HUD prompt.
     */
    hidePrompt() {
        if (this.hudPrompt) {
            this.hudPrompt.style.display = 'none';
        }
        if (typeof document !== 'undefined') {
            const carInd = document.getElementById('car-indicator');
            if (carInd) carInd.style.display = 'none';
        }
    }

    /**
     * Query current player state.
     * @returns {'ON_FOOT'|'IN_VEHICLE'}
     */
    getState() {
        return this.state;
    }

    /**
     * Get player coordinates. Synchronized with vehicle when driving.
     * @returns {{x: number, y: number, z: number}}
     */
    getPosition() {
        if (this.state === PlayerState.IN_VEHICLE && this.activeVehicle) {
            const vp = this.activeVehicle.getPosition();
            return {
                x: typeof vp.x === 'number' ? vp.x : 0,
                y: typeof vp.y === 'number' ? vp.y : 0.5,
                z: typeof vp.z === 'number' ? vp.z : 0
            };
        }
        return {
            x: typeof this.position.x === 'number' ? this.position.x : 0,
            y: typeof this.position.y === 'number' ? this.position.y : 1.7,
            z: typeof this.position.z === 'number' ? this.position.z : 0
        };
    }

    /**
     * Get active vehicle reference.
     * @returns {Vehicle|null}
     */
    getVehicle() {
        return this.state === PlayerState.IN_VEHICLE ? this.activeVehicle : null;
    }

    /**
     * Detect nearest vehicle within proximity radius.
     * @param {Array<Vehicle>} [vehiclesList] Optional vehicle list; defaults to spatialGrid dynamic query
     * @param {number} [maxDist] Maximum interaction radius (defaults to 3.5m)
     * @returns {Vehicle|null}
     */
    getNearbyVehicle(vehiclesList = null, maxDist = this.interactionRadius) {
        const px = this.position.x;
        const pz = this.position.z;
        const maxDistSq = maxDist * maxDist;

        let closestVehicle = null;
        let closestDistSq = maxDistSq;

        if (Array.isArray(vehiclesList) && vehiclesList.length > 0) {
            for (let i = 0, len = vehiclesList.length; i < len; i++) {
                const v = vehiclesList[i];
                if (!v || typeof v.getPosition !== 'function') continue;
                const pos = v.getPosition();
                const dx = pos.x - px;
                const dz = pos.z - pz;
                const distSq = dx * dx + dz * dz;
                if (distSq <= closestDistSq) {
                    closestDistSq = distSq;
                    closestVehicle = v;
                }
            }
            return closestVehicle;
        }

        // Query spatial grid broadphase if available
        if (this.spatialGrid && typeof this.spatialGrid.queryRadius === 'function') {
            this.spatialGrid.queryRadius(px, pz, maxDist, this._scratchResults, 'DYNAMIC');
            for (let i = 0, len = this._scratchResults.length; i < len; i++) {
                const item = this._scratchResults[i];
                const v = item.entityRef || item.entity || item;
                if (v && typeof v.getPosition === 'function') {
                    const pos = v.getPosition();
                    const dx = pos.x - px;
                    const dz = pos.z - pz;
                    const distSq = dx * dx + dz * dz;
                    if (distSq <= closestDistSq) {
                        closestDistSq = distSq;
                        closestVehicle = v;
                    }
                }
            }
            return closestVehicle;
        }

        return null;
    }

    /**
     * Alias for getNearbyVehicle to conform with API specifications.
     * @param {Array<Vehicle>} [vehiclesList]
     * @param {number} [maxDist]
     * @returns {Vehicle|null}
     */
    getNearestVehicle(vehiclesList = null, maxDist = this.interactionRadius) {
        return this.getNearbyVehicle(vehiclesList, maxDist);
    }

    /**
     * Board nearest vehicle in range.
     * Used by window.__GAME__.actions.tryEnterVehicle() and [E] keyboard interaction.
     * @param {Array<Vehicle>} [vehiclesList]
     * @returns {boolean} True if successfully entered
     */
    enterNearbyVehicle(vehiclesList = null) {
        if (this.state !== PlayerState.ON_FOOT) return false;
        const vehicle = this.getNearbyVehicle(vehiclesList, this.interactionRadius);
        if (!vehicle) return false;
        return this.enterVehicle(vehicle);
    }

    /**
     * Board a specific vehicle and transition to IN_VEHICLE state.
     * @param {Vehicle} vehicle 
     * @returns {boolean}
     */
    enterVehicle(vehicle) {
        if (this.state !== PlayerState.ON_FOOT || !vehicle) return false;

        this.state = PlayerState.IN_VEHICLE;
        this.activeVehicle = vehicle;

        if (typeof vehicle.setPlayerControlled === 'function') {
            vehicle.setPlayerControlled(true);
        } else {
            vehicle.isPlayer = true;
        }

        // Synchronize player position with vehicle
        const vPos = vehicle.getPosition();
        this.position.set(vPos.x, vPos.y || 0, vPos.z);

        // Hide boarding prompt and show speed HUD
        this.hidePrompt();
        updateCivicHUD(vehicle, false, true);

        // Switch camera to 3rd-person chase
        if (this.cameraController && typeof this.cameraController.setMode === 'function') {
            this.cameraController.setMode('CHASE', vehicle);
        }

        return true;
    }

    /**
     * Safe multi-candidate exit placement algorithm:
     * Evaluates candidate positions in deterministic order:
     * Left (driver door) -> Right (passenger door) -> Rear (trunk) -> Front (hood)
     * Verifies boundary constraints and collision clearance via SpatialGrid.
     * 
     * @param {Vehicle} vehicle 
     * @param {SpatialGrid} [grid]
     * @returns {{x: number, y: number, z: number, name: string}}
     */
    calculateSafeExitPosition(vehicle, grid = this.spatialGrid) {
        const vPos = vehicle.getPosition();
        const yaw = typeof vehicle.getYaw === 'function' ? vehicle.getYaw() : 0;

        const halfWidth = ((CONFIG.VEHICLE && CONFIG.VEHICLE.WIDTH) || 2.2) * 0.5;
        const halfLength = ((CONFIG.VEHICLE && CONFIG.VEHICLE.LENGTH) || 4.5) * 0.5;
        const sideDist = halfWidth + this.radius + 0.4;   // ~1.9m from vehicle center
        const longDist = halfLength + this.radius + 0.4;  // ~3.05m from vehicle center

        // In Three.js: yaw=0 faces -Z.
        // Forward: (-sin(yaw), 0, -cos(yaw))
        // Right:   ( cos(yaw), 0, -sin(yaw))
        // Left:    (-cos(yaw), 0,  sin(yaw))
        // Rear:    ( sin(yaw), 0,  cos(yaw))

        const candidates = [
            // Candidate 1: LEFT (Driver side)
            {
                x: vPos.x - Math.cos(yaw) * sideDist,
                y: vPos.y !== undefined ? vPos.y : 0,
                z: vPos.z + Math.sin(yaw) * sideDist,
                name: 'LEFT'
            },
            // Candidate 2: RIGHT (Passenger side)
            {
                x: vPos.x + Math.cos(yaw) * sideDist,
                y: vPos.y !== undefined ? vPos.y : 0,
                z: vPos.z - Math.sin(yaw) * sideDist,
                name: 'RIGHT'
            },
            // Candidate 3: REAR (Trunk side)
            {
                x: vPos.x + Math.sin(yaw) * longDist,
                y: vPos.y !== undefined ? vPos.y : 0,
                z: vPos.z + Math.cos(yaw) * longDist,
                name: 'REAR'
            },
            // Candidate 4: FRONT (Hood side)
            {
                x: vPos.x - Math.sin(yaw) * longDist,
                y: vPos.y !== undefined ? vPos.y : 0,
                z: vPos.z - Math.cos(yaw) * longDist,
                name: 'FRONT'
            }
        ];

        for (let i = 0; i < candidates.length; i++) {
            const cand = candidates[i];
            if (this.isExitPositionClear(cand.x, cand.y, cand.z, vehicle, grid)) {
                return cand;
            }
        }

        // Secondary fallback: Wider offset (sideDist * 1.5)
        const wideSideDist = sideDist * 1.5;
        const secondaryCandidates = [
            { x: vPos.x - Math.cos(yaw) * wideSideDist, y: vPos.y || 0, z: vPos.z + Math.sin(yaw) * wideSideDist, name: 'WIDE_LEFT' },
            { x: vPos.x + Math.cos(yaw) * wideSideDist, y: vPos.y || 0, z: vPos.z - Math.sin(yaw) * wideSideDist, name: 'WIDE_RIGHT' }
        ];

        for (let i = 0; i < secondaryCandidates.length; i++) {
            const cand = secondaryCandidates[i];
            if (this.isExitPositionClear(cand.x, cand.y, cand.z, vehicle, grid)) {
                return cand;
            }
        }

        // Final safe fallback: Clamp Candidate 1 within safe bounds [-280, 280]
        const fallback = candidates[0];
        const safeBounds = (CONFIG.WORLD && CONFIG.WORLD.SAFE_BOUNDS) || { MIN_X: -280, MAX_X: 280, MIN_Z: -280, MAX_Z: 280 };
        return {
            x: Math.max(safeBounds.MIN_X, Math.min(safeBounds.MAX_X, fallback.x)),
            y: fallback.y,
            z: Math.max(safeBounds.MIN_Z, Math.min(safeBounds.MAX_Z, fallback.z)),
            name: 'FALLBACK_LEFT'
        };
    }

    /**
     * Check whether candidate exit coordinates are clear of obstacles and in bounds.
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @param {Vehicle} vehicle 
     * @param {SpatialGrid} grid 
     * @returns {boolean}
     */
    isExitPositionClear(x, y, z, vehicle, grid) {
        const safeBounds = (CONFIG.WORLD && CONFIG.WORLD.SAFE_BOUNDS) || { MIN_X: -280, MAX_X: 280, MIN_Z: -280, MAX_Z: 280 };
        if (x < safeBounds.MIN_X || x > safeBounds.MAX_X || z < safeBounds.MIN_Z || z > safeBounds.MAX_Z) {
            return false;
        }

        if (grid && typeof grid.queryRadius === 'function') {
            // Check static obstacles
            this._scratchBox.min.set(x - this.radius, y + 0.1, z - this.radius);
            this._scratchBox.max.set(x + this.radius, y + 1.8, z + this.radius);

            grid.queryRadius(x, z, this.radius + 1.5, this._scratchResults, 'STATIC');
            for (let i = 0, len = this._scratchResults.length; i < len; i++) {
                const item = this._scratchResults[i];
                const box = item.box || (item.userData && item.userData.worldBox);
                if (box && this._scratchBox.intersectsBox(box)) {
                    return false;
                }
            }

            // Check dynamic vehicle collisions (exclude current vehicle)
            grid.queryRadius(x, z, this.radius + 2.5, this._scratchResults, 'DYNAMIC');
            const vId = vehicle && vehicle.id ? vehicle.id : null;
            for (let i = 0, len = this._scratchResults.length; i < len; i++) {
                const item = this._scratchResults[i];
                if (vId && item.id === vId) continue;
                const ent = item.entityRef || item.entity;
                if (ent && ent === vehicle) continue;

                const ex = item.x !== undefined ? item.x : 0;
                const ez = item.z !== undefined ? item.z : 0;
                const r = item.radius || 1.5;
                const minDist = r + this.radius;
                const dx = ex - x;
                const dz = ez - z;
                if (dx * dx + dz * dz < minDist * minDist) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Exit active vehicle and transition back to ON_FOOT state.
     * Conforms to test/e2e-functional.test.js Test 5.
     * @param {SpatialGrid} [spatialGrid]
     * @returns {boolean} True if successfully exited
     */
    exitVehicle(spatialGrid = this.spatialGrid) {
        if (this.state !== PlayerState.IN_VEHICLE || !this.activeVehicle) return false;

        const vehicle = this.activeVehicle;
        const exitPos = this.calculateSafeExitPosition(vehicle, spatialGrid);

        // Update player coordinates to exit position
        this.position.set(exitPos.x, exitPos.y, exitPos.z);

        // Synchronize external position reference (e.g. myPosition in game.html)
        if (this.externalPosition && typeof this.externalPosition.set === 'function') {
            this.externalPosition.set(exitPos.x, exitPos.y, exitPos.z);
        }

        // Zero vehicle inputs and release control
        if (typeof vehicle.setInputs === 'function') {
            vehicle.setInputs(false, { left: false, right: false }, false, false);
        }
        if (typeof vehicle.setPlayerControlled === 'function') {
            vehicle.setPlayerControlled(false);
        } else {
            vehicle.isPlayer = false;
        }

        this.activeVehicle = null;
        this.state = PlayerState.ON_FOOT;

        // Restore camera to first person and synchronize camera position
        if (this.cameraController && typeof this.cameraController.setMode === 'function') {
            this.cameraController.setMode('FIRST_PERSON', this.position);
        }
        if (this.camera && this.camera.position) {
            this.camera.position.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
        }

        if (typeof this.onExit === 'function') {
            this.onExit(this.position);
        }

        // Update proximity and HUD immediately on exit (since player disembarked adjacent to vehicle)
        const distAfterExit = Math.hypot(
            this.position.x - vehicle.position.x,
            this.position.z - vehicle.position.z
        );
        const isStillNear = distAfterExit <= this.interactionRadius;
        if (isStillNear) {
            this.nearbyVehicle = vehicle;
            this.showPrompt('Press [E] to Drive');
        } else {
            this.hidePrompt();
        }
        updateCivicHUD(vehicle, isStillNear, false);
        return true;
    }

    /**
     * Map external key inputs into player state.
     * @param {Object} inputs 
     */
    setInputs(inputs) {
        if (!inputs || typeof inputs !== 'object') return;
        if ('w' in inputs) this.keys.w = !!inputs.w;
        if ('a' in inputs) this.keys.a = !!inputs.a;
        if ('s' in inputs) this.keys.s = !!inputs.s;
        if ('d' in inputs) this.keys.d = !!inputs.d;
        if ('shift' in inputs) this.keys.shift = !!inputs.shift;
        if ('space' in inputs) this.keys.space = !!inputs.space;
        if ('e' in inputs) this.keys.e = !!inputs.e;
    }

    /**
     * Physics and state update tick (called at 60Hz from fixed simulation loop).
     * @param {number} dt Delta time in seconds (1/60)
     * @param {SpatialGrid} [spatialGrid]
     * @param {Object} [roadNetwork]
     */
    update(dt = 1 / 60, spatialGrid = this.spatialGrid, roadNetwork = null) {
        if (this.state === PlayerState.ON_FOOT) {
            // Update proximity query for boarding prompt
            this.nearbyVehicle = this.getNearbyVehicle(null, this.interactionRadius);
            if (this.nearbyVehicle) {
                this.showPrompt('Press [E] to Drive');
                updateCivicHUD(this.nearbyVehicle, true, false);
            } else {
                this.hidePrompt();
                updateCivicHUD(null, false, false);
            }

            // Keyboard [E] toggle
            if (this.keys.e) {
                this.keys.e = false;
                if (this.nearbyVehicle) {
                    this.enterVehicle(this.nearbyVehicle);
                }
            }
        } else if (this.state === PlayerState.IN_VEHICLE) {
            if (!this.activeVehicle) {
                this.state = PlayerState.ON_FOOT;
                return;
            }

            // Keyboard [E] toggle
            if (this.keys.e) {
                this.keys.e = false;
                this.exitVehicle(spatialGrid);
                return;
            }

            // Forward inputs to vehicle with adversarial sanitization
            const throttle = !!this.keys.w;
            const brake = !!this.keys.s;
            // Contradictory left+right steer cancels out to 0
            const steer = {
                left: !!this.keys.a && !this.keys.d,
                right: !!this.keys.d && !this.keys.a
            };
            const handbrake = !!this.keys.space;

            if (typeof this.activeVehicle.setInputs === 'function') {
                this.activeVehicle.setInputs(throttle, steer, brake, handbrake);
            }

            // Keep player position synchronized with vehicle
            const vp = this.activeVehicle.getPosition();
            this.position.set(vp.x, vp.y || 0, vp.z);
            updateCivicHUD(this.activeVehicle, false, true);
        }
    }
}
