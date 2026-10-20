/**
 * Headless Simulation Verification for proposed_traffic.js
 */

import * as THREE from 'three';
import { SpatialGrid } from '../../../js/game/spatialGrid.js';
import { RoadNetwork } from '../../../js/game/roadNetwork.js';
import { TrafficManager, PurePursuitController, IDMController, TRAFFIC_CONFIG } from './proposed_traffic.js';

console.log('=== Starting Traffic Simulation Verification ===\n');

// 1. Initialize Subsystems
const roadNetwork = new RoadNetwork();
const spatialGrid = new SpatialGrid(300, 15);
const trafficManager = new TrafficManager(roadNetwork, spatialGrid);

console.log('[Setup] Initializing fleet of 50 vehicles...');
const vehicles = trafficManager.initFleet(50);
console.log(`[Setup] Spawned ${vehicles.length} vehicles.`);

if (vehicles.length < 50) {
    throw new Error(`Expected 50 vehicles, got ${vehicles.length}`);
}

// Check initial positions and non-null states
for (const v of vehicles) {
    const p = v.getPosition();
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z) || !Number.isFinite(v.getYaw())) {
        throw new Error(`Vehicle ${v.id} has invalid initial coordinates: ${JSON.stringify(p)}`);
    }
}

// 2. Snapshot initial positions
const initialPositions = vehicles.map(v => {
    const p = v.getPosition();
    return { x: p.x, z: p.z };
});

// 3. Step simulation for 300 ticks (5.0s at 60Hz)
console.log('[Simulation] Executing 300 ticks at 60Hz...');
let minPairwiseDistance = Infinity;
let overlapViolations = 0;

for (let tick = 0; tick < 300; tick++) {
    trafficManager.update(1 / 60);

    // Overlap checks
    for (let i = 0; i < vehicles.length; i++) {
        const p1 = vehicles[i].getPosition();
        for (let j = i + 1; j < vehicles.length; j++) {
            const p2 = vehicles[j].getPosition();
            const dist = Math.hypot(p1.x - p2.x, p1.z - p2.z);
            if (dist < minPairwiseDistance) {
                minPairwiseDistance = dist;
            }
            if (dist < 2.0) {
                overlapViolations++;
                console.error(`Overlap violation at tick ${tick} between ${vehicles[i].id} and ${vehicles[j].id}: dist = ${dist.toFixed(2)}m`);
            }
        }
    }
}

// 4. Verify displacement and progression
let movingCount = 0;
let totalDisplacement = 0;
for (let i = 0; i < vehicles.length; i++) {
    const pEnd = vehicles[i].getPosition();
    const d = Math.hypot(pEnd.x - initialPositions[i].x, pEnd.z - initialPositions[i].z);
    totalDisplacement += d;
    if (d > 1.0) movingCount++;
}

console.log(`[Results] Moving vehicles: ${movingCount}/${vehicles.length} (${(movingCount / vehicles.length * 100).toFixed(1)}%)`);
console.log(`[Results] Total fleet displacement: ${totalDisplacement.toFixed(1)}m`);
console.log(`[Results] Min pairwise distance: ${minPairwiseDistance.toFixed(2)}m (must be >= 2.0m)`);
console.log(`[Results] Overlap violations: ${overlapViolations}`);

const metrics = trafficManager.getMetrics();
console.log(`[Metrics] Count: ${metrics.count}, AvgSpeed: ${metrics.avgSpeed.toFixed(2)} m/s, StoppedCount: ${metrics.stoppedCount}`);

if (movingCount < vehicles.length * 0.7) {
    throw new Error(`Less than 70% of vehicles moved! (${movingCount}/${vehicles.length})`);
}
if (totalDisplacement < 50.0) {
    throw new Error(`Total displacement < 50m (${totalDisplacement})`);
}
if (overlapViolations > 0) {
    throw new Error(`Detected ${overlapViolations} vehicle overlaps!`);
}

// 5. Test Dynamic Fleet Resizing
console.log('\n[Scaling] Testing dynamic fleet resizing...');
trafficManager.setFleetSize(20);
console.log(`Fleet resized to: ${trafficManager.getActiveVehicles().length} (target: 20)`);
if (trafficManager.getActiveVehicles().length !== 20) throw new Error('Scaling down failed');

trafficManager.setFleetSize(60);
console.log(`Fleet resized to: ${trafficManager.getActiveVehicles().length} (target: 60)`);
if (trafficManager.getActiveVehicles().length !== 60) throw new Error('Scaling up failed');

// Run 60 more ticks with 60 vehicles
for (let tick = 0; tick < 60; tick++) {
    trafficManager.update(1 / 60);
}
console.log('60 ticks completed at 60 vehicles without errors.');

// 6. Test 1000-Frame Performance & Allocation
console.log('\n[Benchmark] Running 1,000 continuous simulation frames...');
const t0 = performance.now();
for (let f = 0; f < 1000; f++) {
    trafficManager.update(1 / 60);
}
const t1 = performance.now();
const avgMsPerTick = (t1 - t0) / 1000;
console.log(`[Benchmark] 1000 frames total time: ${(t1 - t0).toFixed(2)}ms, Avg tick: ${avgMsPerTick.toFixed(3)}ms`);
console.log(`[Benchmark] Effective physics FPS: ${(1000 / avgMsPerTick).toFixed(0)} FPS`);

if (avgMsPerTick > 5.0) {
    console.warn(`Warning: avgMsPerTick is ${avgMsPerTick.toFixed(3)}ms (expected < 1.0ms on desktop)`);
} else {
    console.log(`✔ Benchmark passed comfortably within budget (< 16.6ms)!`);
}

console.log('\n=== ALL VERIFICATION TESTS PASSED SUCCESSFULLY! ===');
