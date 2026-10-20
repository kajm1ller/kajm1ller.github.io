import * as THREE from 'three';
import { performance } from 'node:perf_hooks';
import { InstancedVehicleFleet } from './proposed_instancedFleet.js';
import { Vehicle } from '../../../js/game/vehicle.js';
import { SpatialGrid } from '../../../js/game/spatialGrid.js';
import { RoadNetwork } from '../../../js/game/roadNetwork.js';

console.log('=== FULL INTEGRATED 50-VEHICLE SIMULATION & RENDERING BENCHMARK ===');

// Setup Scene
const scene = new THREE.Scene();
const fleet = new InstancedVehicleFleet({ maxCapacity: 64 });
fleet.init(scene);

// Setup SpatialGrid with static obstacles (simulating /anothermapo buildings & walls)
const spatialGrid = new SpatialGrid(300, 15);
for (let i = 0; i < 300; i++) {
    const minX = (Math.random() - 0.5) * 500;
    const minZ = (Math.random() - 0.5) * 500;
    const box = new THREE.Box3(
        new THREE.Vector3(minX, 0, minZ),
        new THREE.Vector3(minX + 10, 8, minZ + 10)
    );
    spatialGrid.insertStatic(`map_building_${i}`, box);
}

// Setup RoadNetwork & 50 vehicles
const roadNetwork = new RoadNetwork();
roadNetwork.init(null, THREE);
const spawns = roadNetwork.getSpawnPoints(50, 12.0);

const vehicles = [];
for (let i = 0; i < 50; i++) {
    const sp = spawns[i % spawns.length];
    const v = new Vehicle(`v_${i}`, sp.x, sp.z, sp.yaw, 0x224488 + i * 2000, false);
    v.laneId = sp.laneId;
    v.waypointIndex = sp.index;
    v.speed = 10.0;
    vehicles.push(v);
}

// Emulate window.__GAME__ telemetry API
let totalFrameTimeSum = 0;
let frameCount = 0;
const startHeap = process.memoryUsage().heapUsed;

const getFleetMetrics = () => {
    let stoppedCount = 0;
    let speedSum = 0;
    for (let i = 0; i < vehicles.length; i++) {
        const s = Math.abs(vehicles[i].speed);
        speedSum += s;
        if (s < 0.1) stoppedCount++;
    }
    const avgSpeed = speedSum / vehicles.length;
    const avgTick = frameCount > 0 ? (totalFrameTimeSum / frameCount) : 0;
    const heapNow = process.memoryUsage().heapUsed;

    return {
        count: vehicles.length,
        trafficCount: vehicles.length,
        avgFrameTimeMs: avgTick,
        avgSpeed: avgSpeed,
        stoppedCount: stoppedCount,
        heapDeltaBytes: Math.max(0, heapNow - startHeap),
        fps: avgTick > 0 ? 1000 / avgTick : 60,
        drawCalls: fleet.getMetrics().drawCalls,
        instancedNodes: fleet.getMetrics().instancedMeshNodes
    };
};

// Benchmark 1,000 full frames
const TICKS = 1000;
const tickTimes = [];

for (let t = 0; t < TICKS; t++) {
    const t0 = performance.now();

    // 1. Grid Sync
    spatialGrid.clearDynamic();
    for (let i = 0; i < 50; i++) {
        const v = vehicles[i];
        spatialGrid.insertDynamic(v.id, v.position.x, v.position.z, v.radius, v);
    }

    // 2. Traffic Pathing (Pure Pursuit Steering)
    for (let i = 0; i < 50; i++) {
        const v = vehicles[i];
        const lookahead = roadNetwork.getLookaheadWaypoint(v.laneId, v.waypointIndex, 8.0);
        v.waypointIndex = lookahead.index;
        v.laneId = lookahead.laneId;

        const dx = lookahead.x - v.position.x;
        const dz = lookahead.z - v.position.z;
        const targetYaw = Math.atan2(-dx, -dz);
        let diffYaw = (targetYaw - v.yaw) % (Math.PI * 2);
        if (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
        if (diffYaw > Math.PI) diffYaw -= Math.PI * 2;
        const steer = Math.max(-1, Math.min(1, diffYaw * 2.5));

        v.setInputs(0.8, steer, 0, false);
    }

    // 3. Vehicle Physics & 3-Circle SAT Collision
    for (let i = 0; i < 50; i++) {
        vehicles[i].update(1 / 60, spatialGrid);
    }

    // 4. Instanced Fleet Matrix Updates (Chassis + 200 Wheels)
    fleet.update(vehicles, 1 / 60);

    const t1 = performance.now();
    const frameDur = t1 - t0;
    tickTimes.push(frameDur);
    totalFrameTimeSum += frameDur;
    frameCount++;
}

const avgTick = totalFrameTimeSum / TICKS;
const sorted = [...tickTimes].sort((a, b) => a - b);
const p95Tick = sorted[Math.floor(sorted.length * 0.95)];
const telemetry = getFleetMetrics();

console.log('--- Integrated 1,000-Frame Benchmark Results ---');
console.log(`Active Entities:         ${telemetry.count}`);
console.log(`Static Obstacles:        300 (simulating /anothermapo buildings)`);
console.log(`Draw Calls:              ${telemetry.drawCalls} (InstancedMesh)`);
console.log(`Avg Tick (Physics+Inst): ${avgTick.toFixed(4)} ms (Limit: < 16.6ms, Target physics: < 1.0ms)`);
console.log(`p95 Tick:                ${p95Tick.toFixed(4)} ms`);
console.log(`Theoretical FPS:         ${telemetry.fps.toFixed(1)} FPS`);
console.log(`Average Vehicle Speed:   ${telemetry.avgSpeed.toFixed(2)} m/s`);
console.log(`Stopped Count:           ${telemetry.stoppedCount}`);
console.log(`Heap Delta:              ${(telemetry.heapDeltaBytes / (1024 * 1024)).toFixed(2)} MB`);
console.log('------------------------------------------------');

if (avgTick < 1.0) {
    console.log('✔ PASS: Combined Physics + Instancing update is < 1.0ms! Ample headroom for 60 FPS.');
} else {
    console.log('✖ FAIL');
}

fleet.dispose();
