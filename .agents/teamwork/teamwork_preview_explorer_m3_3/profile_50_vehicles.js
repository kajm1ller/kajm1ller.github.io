/**
 * Fine-Grained Component Profiler for 50 Vehicles
 */

import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { Vehicle } from '../../../js/game/vehicle.js';
import { SpatialGrid } from '../../../js/game/spatialGrid.js';
import { RoadNetwork } from '../../../js/game/roadNetwork.js';

console.log('=== FINE-GRAINED BREAKDOWN: 50 VEHICLES SIMULATION ===');

const grid = new SpatialGrid(300, 15);
for (let i = 0; i < 200; i++) {
    const minX = (Math.random() - 0.5) * 500;
    const minZ = (Math.random() - 0.5) * 500;
    const sizeX = 5 + Math.random() * 15;
    const sizeZ = 5 + Math.random() * 15;
    const box = new THREE.Box3(
        new THREE.Vector3(minX, 0, minZ),
        new THREE.Vector3(minX + sizeX, 10, minZ + sizeZ)
    );
    grid.insertStatic(`obstacle_${i}`, box);
}

const roadNetwork = new RoadNetwork();
roadNetwork.init(null, THREE);
const spawns = roadNetwork.getSpawnPoints(50, 12.0);

const vehicles = [];
for (let i = 0; i < 50; i++) {
    const sp = spawns[i % spawns.length];
    const x = sp.x + (Math.random() - 0.5) * 2.0;
    const z = sp.z + (Math.random() - 0.5) * 2.0;
    const v = new Vehicle(`v_${i}`, x, z, sp.yaw, 0x3366cc, false);
    v.laneId = sp.laneId;
    v.waypointIndex = sp.index;
    v.speed = 10.0;
    vehicles.push(v);
}

// Warm up
for (let w = 0; w < 50; w++) {
    grid.clearDynamic();
    for (let i = 0; i < 50; i++) {
        const v = vehicles[i];
        grid.insertDynamic(v.id, v.position.x, v.position.z, v.radius, v);
    }
    for (let i = 0; i < 50; i++) vehicles[i].update(1 / 60, grid);
}

const TICKS = 1000;
let timeGridSync = 0;
let timePathing = 0;
let timePhysicsAndCollision = 0;

for (let t = 0; t < TICKS; t++) {
    // 1. Grid Sync
    const t0 = performance.now();
    grid.clearDynamic();
    for (let i = 0; i < 50; i++) {
        const v = vehicles[i];
        grid.insertDynamic(v.id, v.position.x, v.position.z, v.radius, v);
    }
    const t1 = performance.now();
    timeGridSync += (t1 - t0);

    // 2. Pathing & Steering
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
    const t2 = performance.now();
    timePathing += (t2 - t1);

    // 3. Physics & 3-Circle Collision
    for (let i = 0; i < 50; i++) {
        vehicles[i].update(1 / 60, grid);
    }
    const t3 = performance.now();
    timePhysicsAndCollision += (t3 - t2);
}

console.log('Component Breakdown per 50-Vehicle Tick:');
console.log(`- SpatialGrid Dynamic Sync (50 inserts + clear): ${(timeGridSync / TICKS).toFixed(4)} ms`);
console.log(`- Pathing & Pure Pursuit Lookaheads (50 vehicles):  ${(timePathing / TICKS).toFixed(4)} ms`);
console.log(`- Physics Integration & 3-Circle SAT (50 vehicles): ${(timePhysicsAndCollision / TICKS).toFixed(4)} ms`);
const totalAvg = (timeGridSync + timePathing + timePhysicsAndCollision) / TICKS;
console.log(`- Total Average Simulation Tick:                  ${totalAvg.toFixed(4)} ms`);
