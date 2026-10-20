import * as THREE from 'three';
import { performance } from 'node:perf_hooks';

console.log('=== TESTING INSTANCED WHEEL MATRIX PERFORMANCE ===');

const _scratchMat4 = new THREE.Matrix4();
const _scratchPos = new THREE.Vector3();
const _scratchQuat = new THREE.Quaternion();
const _scratchScale = new THREE.Vector3(1, 1, 1);
const _scratchEuler = new THREE.Euler(0, 0, 0, 'YXZ');

const wheelOffsets = [
    [-1.0, 0.35, -1.3], // FL
    [1.0, 0.35, -1.3],  // FR
    [-1.0, 0.35, 1.3],  // RL
    [1.0, 0.35, 1.3]   // RR
];

// Create dummy InstancedMesh
const geo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 12);
geo.rotateZ(Math.PI / 2);
const mat = new THREE.MeshBasicMaterial();
const instancedWheels = new THREE.InstancedMesh(geo, mat, 200);

const TICKS = 1000;
const t0 = performance.now();

for (let t = 0; t < TICKS; t++) {
    let wheelIndex = 0;
    for (let i = 0; i < 50; i++) {
        const carX = i * 2.0;
        const carY = 0;
        const carZ = i * 5.0;
        const carYaw = 0.5;
        const steer = 0.2;
        const roll = t * 0.1;

        const cosYaw = Math.cos(carYaw);
        const sinYaw = Math.sin(carYaw);

        for (let w = 0; w < 4; w++) {
            const isFront = w < 2;
            const wYaw = isFront ? carYaw + steer : carYaw;
            const off = wheelOffsets[w];
            const lx = off[0];
            const ly = off[1];
            const lz = off[2];

            const wx = carX + (lx * cosYaw + lz * sinYaw);
            const wy = carY + ly;
            const wz = carZ + (-lx * sinYaw + lz * cosYaw);

            _scratchPos.set(wx, wy, wz);
            _scratchEuler.set(-roll, wYaw, 0);
            _scratchQuat.setFromEuler(_scratchEuler);
            _scratchMat4.compose(_scratchPos, _scratchQuat, _scratchScale);

            instancedWheels.setMatrixAt(wheelIndex++, _scratchMat4);
        }
    }
    instancedWheels.instanceMatrix.needsUpdate = true;
}

const t1 = performance.now();
const avgMs = (t1 - t0) / TICKS;

console.log(`200 Wheel Matrices Update: ${avgMs.toFixed(4)} ms per tick`);
console.log(`Status: ${avgMs < 0.2 ? 'PASS (super fast)' : 'WARN'}`);
