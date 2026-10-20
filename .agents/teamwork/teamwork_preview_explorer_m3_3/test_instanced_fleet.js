import * as THREE from 'three';
import { performance } from 'node:perf_hooks';
import { InstancedVehicleFleet } from './proposed_instancedFleet.js';
import { Vehicle } from '../../../js/game/vehicle.js';
import { SpatialGrid } from '../../../js/game/spatialGrid.js';
import { RoadNetwork } from '../../../js/game/roadNetwork.js';

console.log('=== VERIFYING PROPOSED INSTANCED FLEET (1,000 FRAMES, 50 VEHICLES) ===');

const scene = new THREE.Scene();
const fleet = new InstancedVehicleFleet({ maxCapacity: 64 });
fleet.init(scene);

// Create 50 vehicles
const vehicles = [];
for (let i = 0; i < 50; i++) {
    const v = new Vehicle(`v_${i}`, i * 3.0, i * 4.0, (i * 0.1) % Math.PI, 0x112233 * (i + 1), false);
    v.speed = 10.0;
    v.steerAngle = 0.15;
    vehicles.push(v);
}

// Warm up
for (let w = 0; w < 20; w++) {
    fleet.update(vehicles, 1 / 60);
}

const TICKS = 1000;
const t0 = performance.now();

for (let t = 0; t < TICKS; t++) {
    for (let i = 0; i < 50; i++) {
        vehicles[i].position.x += 0.05;
        vehicles[i].yaw += 0.005;
    }
    fleet.update(vehicles, 1 / 60);
}

const t1 = performance.now();
const totalMs = t1 - t0;
const avgUpdateMs = totalMs / TICKS;
const metrics = fleet.getMetrics();

console.log(`Frames:                  ${TICKS}`);
console.log(`Fleet Vehicle Count:     ${metrics.vehicleCount}`);
console.log(`Fleet Wheel Count:       ${metrics.wheelCount}`);
console.log(`Draw Call Count:         ${metrics.drawCalls} (vs 1,050 separate meshes)`);
console.log(`Total Duration:          ${totalMs.toFixed(2)} ms`);
console.log(`Avg Instanced Update:    ${avgUpdateMs.toFixed(4)} ms per frame`);
console.log(`Avg Matrix Sync Metric:  ${metrics.avgUpdateDurationMs.toFixed(4)} ms`);
console.log(`Draw Call Reduction:     ${((1 - metrics.drawCalls / 1050) * 100).toFixed(1)}%`);

if (avgUpdateMs < 0.2) {
    console.log('✔ PASS: InstancedFleet update latency is well within < 0.2ms budget!');
} else {
    console.log('✖ WARN: Update latency exceeded 0.2ms');
}

fleet.dispose();
console.log('✔ Cleanup complete.');
