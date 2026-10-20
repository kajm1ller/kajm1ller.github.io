/**
 * js/game/main.js
 * 
 * Engine Core, Game Loop, and Automation Testing API for Kaj Simulator.
 * Modular entry providing:
 * - 60Hz fixed-timestep physics accumulator
 * - Spatial hash grid broadphase integration
 * - /anothermapo 3D map loader & OSM road network integration
 * - Kaj Simulator Honda Civic vehicle physics & HUD integration
 * - Autonomous AI traffic fleet & GPU instanced rendering
 * - Testing Automation API (`window.__GAME__`) conforming to PROJECT.md §6
 */

import { CONFIG } from './config.js';
import { SpatialGrid } from './spatialGrid.js';
import { RoadNetwork, ROAD_CONFIG, Lane } from './roadNetwork.js';
import {
    Vehicle,
    CivicVehicle,
    CivicGeometryPool,
    CivicMaterialPool,
    createOptimizedHondaCivic,
    createHondaCivic,
    ensureCivicHUD,
    updateCivicHUD
} from './vehicle.js';
import { PlayerController, PlayerState } from './player.js';
import { CameraController, CameraMode, lerpAngle } from './camera.js';
import {
    TrafficManager,
    TrafficAgent,
    PurePursuitController,
    IDMController,
    TRAFFIC_CONFIG
} from './traffic.js';
import { InstancedVehicleFleet, mergeBufferGeometries } from './instancedFleet.js';
import { AnothermapoLoader, OSMRoadNetwork, ANOTHERMAPO_CONFIG } from './mapLoader.js';

// Pre-allocated singleton spatial hash grid broadphase (40x40 cells covering 600m world)
export const spatialGrid = new SpatialGrid(CONFIG.GRID.WORLD_HALF_SIZE, CONFIG.GRID.CELL_SIZE);

// Reusable scratch array for queries
export const scratchQueryResults = [];

// Simulation state
let isPaused = false;
let engineContext = null;

/**
 * Initializes and exposes the window.__GAME__ testing automation API.
 * Conforms to PROJECT.md § Interface Contracts (6. Testing Automation API).
 * 
 * @param {Object} context Engine runtime context
 * @returns {Object} The window.__GAME__ object
 */
export function initGameAPI(context) {
    engineContext = context;

    const mapState = context.mapState || {
        isLoaded: false,
        parts: [],
        loadedPartsCount: 0,
        obstacleCount: 0
    };

    window.__GAME__ = {
        version: '1.0.0-m3',
        isReady: true,
        hasVehicles: context.hasVehicles !== undefined ? !!context.hasVehicles : !!(context.playerVehicle || context.playerController),
        map: mapState,

        player: {
            getState: () => {
                if (engineContext.playerController && engineContext.playerController.getState) {
                    return engineContext.playerController.getState();
                }
                return 'ON_FOOT';
            },
            getPosition: () => {
                if (engineContext.playerController && engineContext.playerController.getPosition) {
                    return engineContext.playerController.getPosition();
                }
                const pos = engineContext.playerPosition || { x: 0, y: 1.7, z: 0 };
                return {
                    x: typeof pos.x === 'number' ? pos.x : 0,
                    y: typeof pos.y === 'number' ? pos.y : 1.7,
                    z: typeof pos.z === 'number' ? pos.z : 0
                };
            },
            setPosition: (x, y, z) => {
                if (engineContext.playerController && engineContext.playerController.position) {
                    engineContext.playerController.position.set(x, y, z);
                }
                if (engineContext.playerPosition && engineContext.playerPosition.set) {
                    engineContext.playerPosition.set(x, y, z);
                }
            },
            getVehicle: () => {
                if (engineContext.playerController && engineContext.playerController.getVehicle) {
                    return engineContext.playerController.getVehicle();
                }
                return null;
            },
            getFootstepHistory: () => {
                if (typeof engineContext.getFootstepHistory === 'function') {
                    return engineContext.getFootstepHistory();
                }
                return [];
            },
            getCarjackState: () => {
                if (typeof engineContext.getCarjackState === 'function') {
                    return engineContext.getCarjackState();
                }
                return null;
            }
        },

        vehicles: {
            getPlayerVehicle: () => {
                if (engineContext.playerVehicle) {
                    return engineContext.playerVehicle;
                }
                if (engineContext.playerController && engineContext.playerController.getVehicle) {
                    return engineContext.playerController.getVehicle();
                }
                return null;
            },
            getNearbyVehicle: (arg1, arg2) => {
                if (engineContext.playerController && engineContext.playerController.getNearbyVehicle) {
                    let candidateVehicles = null;
                    let maxDist = undefined;
                    if (Array.isArray(arg1)) {
                        candidateVehicles = arg1;
                        maxDist = arg2;
                    } else if (typeof arg1 === 'number') {
                        maxDist = arg1;
                        candidateVehicles = engineContext.vehicles || 
                            (engineContext.playerVehicle ? [engineContext.playerVehicle, ...(engineContext.trafficVehicles || [])] : null);
                    } else {
                        candidateVehicles = engineContext.vehicles || 
                            (engineContext.playerVehicle ? [engineContext.playerVehicle, ...(engineContext.trafficVehicles || [])] : null);
                    }
                    return engineContext.playerController.getNearbyVehicle(candidateVehicles, maxDist);
                }
                return null;
            },
            getNearestVehicle: (arg1, arg2) => {
                if (window.__GAME__ && window.__GAME__.vehicles && window.__GAME__.vehicles.getNearbyVehicle) {
                    return window.__GAME__.vehicles.getNearbyVehicle(arg1, arg2);
                }
                return null;
            },
            getTrafficVehicles: () => {
                if (engineContext.trafficVehicles) {
                    return engineContext.trafficVehicles;
                }
                if (engineContext.trafficManager && engineContext.trafficManager.getActiveVehicles) {
                    return engineContext.trafficManager.getActiveVehicles();
                }
                return [];
            },
            getTrafficCount: () => {
                if (engineContext.trafficVehicles) {
                    return engineContext.trafficVehicles.length;
                }
                if (engineContext.trafficManager && engineContext.trafficManager.getActiveVehicles) {
                    return engineContext.trafficManager.getActiveVehicles().length;
                }
                return 0;
            },
            getFleetMetrics: () => {
                if (engineContext.trafficManager && engineContext.trafficManager.getFleetMetrics) {
                    return engineContext.trafficManager.getFleetMetrics();
                }
                return null;
            },
            getCarAudioState: () => {
                if (typeof engineContext.getCarAudioState === 'function') {
                    return engineContext.getCarAudioState();
                }
                return null;
            }
        },

        actions: {
            tryEnterVehicle: () => {
                if (typeof engineContext.tryBoardOrJackVehicle === 'function') {
                    return engineContext.tryBoardOrJackVehicle();
                }
                if (engineContext.playerController && engineContext.playerController.enterNearbyVehicle) {
                    const candidateVehicles = engineContext.vehicles || 
                        (engineContext.playerVehicle ? [engineContext.playerVehicle, ...(engineContext.trafficVehicles || [])] : null);
                    return engineContext.playerController.enterNearbyVehicle(candidateVehicles);
                }
                return false;
            },
            carjackVehicle: (vehicle) => {
                if (typeof engineContext.startCarjackAnimation === 'function') {
                    return engineContext.startCarjackAnimation(vehicle);
                }
                return null;
            },
            tryExitVehicle: () => {
                if (engineContext.playerController && engineContext.playerController.exitVehicle) {
                    const success = engineContext.playerController.exitVehicle(engineContext.spatialGrid || spatialGrid);
                    if (success) {
                        if (typeof engineContext.handleExitVehicleRadio === 'function') {
                            engineContext.handleExitVehicleRadio();
                        }
                        if (engineContext.playerPosition && engineContext.playerController.position) {
                            engineContext.playerPosition.copy(engineContext.playerController.position);
                        }
                        if (engineContext.camera && engineContext.playerController.position) {
                            const eyeY = engineContext.playerController.position.y + (engineContext.playerController.eyeHeight || 1.7);
                            engineContext.camera.position.set(
                                engineContext.playerController.position.x,
                                eyeY,
                                engineContext.playerController.position.z
                            );
                        }
                    }
                    return success;
                }
                return false;
            },
            setVehicleInput: (inputs) => {
                const pv = (engineContext.playerController && engineContext.playerController.getVehicle()) || engineContext.playerVehicle;
                if (pv && pv.setInputs) {
                    const steer = { left: !!inputs.a, right: !!inputs.d };
                    pv.setInputs(inputs.w, steer, inputs.s, inputs.space);
                }
                if (engineContext.playerController && engineContext.playerController.keys) {
                    if ('w' in inputs) engineContext.playerController.keys.w = !!inputs.w;
                    if ('a' in inputs) engineContext.playerController.keys.a = !!inputs.a;
                    if ('s' in inputs) engineContext.playerController.keys.s = !!inputs.s;
                    if ('d' in inputs) engineContext.playerController.keys.d = !!inputs.d;
                    if ('space' in inputs) engineContext.playerController.keys.space = !!inputs.space;
                }
            },
            setPlayerInput: (keys) => {
                if (engineContext.playerKeys && typeof keys === 'object') {
                    if ('w' in keys) engineContext.playerKeys.w = !!keys.w;
                    if ('a' in keys) engineContext.playerKeys.a = !!keys.a;
                    if ('s' in keys) engineContext.playerKeys.s = !!keys.s;
                    if ('d' in keys) engineContext.playerKeys.d = !!keys.d;
                    if ('shift' in keys) engineContext.playerKeys.shift = !!keys.shift;
                }
                if (engineContext.playerController) {
                    engineContext.playerController.setInputs(keys);
                }
            },
            talkToNearbyPedestrian: () => {
                if (typeof engineContext.talkToNearbyPedestrian === 'function') {
                    return engineContext.talkToNearbyPedestrian();
                }
                return null;
            },
            selectWeapon: (indexOrName) => {
                if (typeof engineContext.selectWeapon === 'function') {
                    return engineContext.selectWeapon(indexOrName);
                }
                return null;
            },
            shootWeapon: () => {
                if (typeof engineContext.shootWeapon === 'function') {
                    return engineContext.shootWeapon();
                }
                return null;
            }
        },

        pedestrians: {
            getAll: () => engineContext.pedestrians || [],
            getCount: () => (engineContext.pedestrians ? engineContext.pedestrians.length : 0),
            getAliveCount: () => (engineContext.pedestrians ? engineContext.pedestrians.filter(p => !p.isDead).length : 0),
            getDeadCount: () => (engineContext.pedestrians ? engineContext.pedestrians.filter(p => p.isDead).length : 0),
            getBloodPools: () => engineContext.bloodPools || [],
            getNearbyPedestrian: (maxDist) => (typeof engineContext.getNearbyPedestrian === 'function' ? engineContext.getNearbyPedestrian(maxDist) : null),
            getActiveDialog: () => (typeof engineContext.getActiveDialog === 'function' ? engineContext.getActiveDialog() : null)
        },

        weapons: {
            getAll: () => engineContext.weapons || [],
            getCurrentWeapon: () => (typeof engineContext.getCurrentWeapon === 'function' ? engineContext.getCurrentWeapon() : null),
            getLastPlayedSound: () => (typeof engineContext.getLastPlayedSound === 'function' ? engineContext.getLastPlayedSound() : null),
            getShotCount: () => (typeof engineContext.getShotCount === 'function' ? engineContext.getShotCount() : 0)
        },

        audio: {
            getBackgroundMusic: () => (typeof engineContext.getBackgroundMusicState === 'function' ? engineContext.getBackgroundMusicState() : null),
            getRadio: () => (typeof engineContext.getRadioState === 'function' ? engineContext.getRadioState() : null)
        },

        radio: {
            getState: () => (typeof engineContext.getRadioState === 'function' ? engineContext.getRadioState() : null),
            skip: () => (typeof engineContext.radioSkipTrack === 'function' ? engineContext.radioSkipTrack() : null),
            restart: () => (typeof engineContext.radioRestartTrack === 'function' ? engineContext.radioRestartTrack() : null),
            togglePause: () => (typeof engineContext.radioTogglePause === 'function' ? engineContext.radioTogglePause() : null),
            setVolume: (v) => (typeof engineContext.radioSetVolume === 'function' ? engineContext.radioSetVolume(v) : null)
        },

        simulation: {
            isPaused: () => isPaused,
            setPaused: (paused) => {
                isPaused = !!paused;
            },
            step: (dt = CONFIG.SIMULATION.FIXED_DELTA) => {
                if (engineContext && engineContext.stepSimulation) {
                    engineContext.stepSimulation(dt);
                }
            },
            runBenchmark: async (frameCount = 1000) => {
                if (engineContext && engineContext.mapState && !engineContext.mapState.isLoaded) {
                    const waitStart = performance.now();
                    while (!engineContext.mapState.isLoaded && (performance.now() - waitStart) < 10000) {
                        await new Promise(r => setTimeout(r, 25));
                    }
                }

                // Pause background rAF render loop during deterministic simulation benchmark
                // so first-frame WebGL shader/shadow compilation doesn't happen mid-measurement
                const prevPaused = isPaused;
                isPaused = true;
                await new Promise(r => setTimeout(r, 50));

                const tickTimes = new Float64Array(frameCount);

                // Warm up
                for (let w = 0; w < 10; w++) {
                    if (engineContext.stepSimulation) engineContext.stepSimulation(CONFIG.SIMULATION.FIXED_DELTA);
                }

                const startHeap = (window.performance && window.performance.memory)
                    ? window.performance.memory.usedJSHeapSize
                    : 0;

                const tStart = performance.now();
                let sum = 0;
                let min = Infinity;
                let max = 0;

                for (let f = 0; f < frameCount; f++) {
                    const t0 = performance.now();
                    if (engineContext.stepSimulation) engineContext.stepSimulation(CONFIG.SIMULATION.FIXED_DELTA);
                    const dur = performance.now() - t0;
                    tickTimes[f] = dur;
                    sum += dur;
                    if (dur < min) min = dur;
                    if (dur > max) max = dur;
                }
                const tEnd = performance.now();
                const endHeap = (window.performance && window.performance.memory)
                    ? window.performance.memory.usedJSHeapSize
                    : 0;

                isPaused = prevPaused;

                const sorted = Array.from(tickTimes).sort((a, b) => a - b);
                const avg = sum / frameCount;
                const p95 = sorted[Math.floor(sorted.length * 0.95)];

                return {
                    frames: frameCount,
                    avgFrameTimeMs: avg,
                    minFrameTimeMs: min,
                    maxFrameTimeMs: max,
                    p95FrameTimeMs: p95,
                    fps: avg > 0 ? 1000 / avg : 60,
                    startHeapBytes: startHeap,
                    endHeapBytes: endHeap,
                    memoryGrowthBytes: Math.max(0, endHeap - startHeap),
                    totalDurationMs: tEnd - tStart
                };
            }
        },

        spatialGrid,
        raw: {
            scene: context.scene,
            camera: context.camera,
            renderer: context.renderer,
            config: CONFIG
        }
    };

    if (typeof window !== 'undefined') {
        window.__gameTestHooks = window.__GAME__;
    }

    return window.__GAME__;
}

export {
    CONFIG,
    SpatialGrid,
    RoadNetwork,
    ROAD_CONFIG,
    Lane,
    Vehicle,
    CivicVehicle,
    CivicGeometryPool,
    CivicMaterialPool,
    createOptimizedHondaCivic,
    createHondaCivic,
    ensureCivicHUD,
    updateCivicHUD,
    PlayerController,
    PlayerState,
    CameraController,
    CameraMode,
    lerpAngle,
    TrafficManager,
    TrafficAgent,
    PurePursuitController,
    IDMController,
    TRAFFIC_CONFIG,
    InstancedVehicleFleet,
    mergeBufferGeometries,
    AnothermapoLoader,
    OSMRoadNetwork,
    ANOTHERMAPO_CONFIG
};
