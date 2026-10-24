/**
 * js/game/instancedFleet.js
 *
 * High-Performance InstancedMesh Rendering Architecture for 50+ Vehicles in Kaj Simulator.
 *
 * Features:
 * - Every car model (carModels.js) is one InstancedMesh: a single vertex-coloured geometry where
 *   body-paint vertices take the per-instance colour and lamp vertices glow (one draw call per
 *   model). Tyres and rims of all models share two more batches, scaled per instance to each
 *   model's wheel size, with per-instance rim colours.
 * - Models are drawn from the same geometry as the individual car meshes, so a car looks the same
 *   whether the fleet draws it or it is mounted on its own (player car, carjacking, shot windows).
 * - Ackermann-style front wheel steering & wheel roll for 200+ wheels in two draw calls.
 * - Zero GC heap allocation during active 60Hz frame updates (pre-allocated scratch math objects).
 */

import * as THREE from 'three';
import { CAR_MODEL_IDS, getCarModel, getFleetGeometry, getModelGeometry, getUnitWheelGeometry } from './carModels.js';

const _scratchMat4 = new THREE.Matrix4();
const _scratchPos = new THREE.Vector3();
const _scratchQuat = new THREE.Quaternion();
const _scratchEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _scratchScale = new THREE.Vector3(1, 1, 1);
const _wheelScale = new THREE.Vector3(1, 1, 1);
const _zeroScale = new THREE.Vector3(0, 0, 0);
const _scratchColor = new THREE.Color();

/**
 * Car material for the fleet: vertex colours, except where `paintMask` is 1 (the per-instance paint
 * colour), and self-lit where `glow` is 1 (head / tail lights).
 */
function createFleetBodyMaterial() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.34, metalness: 0.4, envMapIntensity: 1.1 });
    mat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nattribute float paintMask;\nattribute float glow;\nvarying float vGlow;')
            .replace('#include <color_vertex>', [
                'vColor = vec3( 1.0 );',
                '#ifdef USE_COLOR',
                '    vColor *= color;',
                '#endif',
                '#ifdef USE_INSTANCING_COLOR',
                '    vColor = mix( vColor, vColor * instanceColor.xyz, paintMask );',
                '#endif',
                'vGlow = glow;'
            ].join('\n'));
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying float vGlow;')
            .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor * vGlow;');
    };
    mat.customProgramCacheKey = () => 'kaj_fleet_body';
    return mat;
}

export function mergeBufferGeometries(geometries) {
    let totalPositions = 0;
    let totalNormals = 0;
    let totalIndices = 0;

    for (let i = 0; i < geometries.length; i++) {
        const g = geometries[i];
        totalPositions += g.attributes.position.array.length;
        if (g.attributes.normal) totalNormals += g.attributes.normal.array.length;
        if (g.index) totalIndices += g.index.array.length;
    }

    const posArray = new Float32Array(totalPositions);
    const normArray = totalNormals > 0 ? new Float32Array(totalNormals) : null;
    const indexArray = totalIndices > 0 ? new Uint32Array(totalIndices) : null;

    let posOffset = 0;
    let normOffset = 0;
    let indexOffset = 0;
    let vertexBase = 0;

    for (let i = 0; i < geometries.length; i++) {
        const g = geometries[i];
        const p = g.attributes.position.array;
        posArray.set(p, posOffset);
        posOffset += p.length;

        if (normArray && g.attributes.normal) {
            const n = g.attributes.normal.array;
            normArray.set(n, normOffset);
            normOffset += n.length;
        }

        if (indexArray && g.index) {
            const idx = g.index.array;
            for (let j = 0; j < idx.length; j++) {
                indexArray[indexOffset + j] = idx[j] + vertexBase;
            }
            indexOffset += idx.length;
            vertexBase += g.attributes.position.count;
        }
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    if (normArray) merged.setAttribute('normal', new THREE.BufferAttribute(normArray, 3));
    if (indexArray) merged.setIndex(new THREE.BufferAttribute(indexArray, 1));

    return merged;
}

export class InstancedVehicleFleet {
    constructor(options = {}) {
        this.maxCapacity = options.maxCapacity || 64;
        this.enableShadows = options.enableShadows !== false;
        this.modelIds = options.models || CAR_MODEL_IDS;

        this.scene = null;
        this.activeCount = 0;

        // Physically based paint so the traffic fleet reflects the sky like the player's car
        this.materials = {
            body: createFleetBodyMaterial(),
            tire: new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.92, metalness: 0.0 }),
            rim: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.85, envMapIntensity: 1.2 })
        };

        // model id -> { mesh, count, model, wheels }
        this.batches = new Map();
        this.meshes = { tires: null, rims: null };

        this.metrics = {
            vehicleCount: 0,
            wheelCount: 0,
            drawCalls: 0,
            lastUpdateDurationMs: 0,
            updateCount: 0,
            avgUpdateDurationMs: 0
        };

        this._totalUpdateDuration = 0;
    }

    init(scene) {
        this.scene = scene;
        const max = this.maxCapacity;
        const meshes = [];

        for (const id of this.modelIds) {
            const mesh = new THREE.InstancedMesh(getFleetGeometry(id).body, this.materials.body, max);
            mesh.name = `instanced_${id}`;
            mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
            if (this.enableShadows) {
                mesh.castShadow = true;
                mesh.receiveShadow = true;
            }
            meshes.push(mesh);
            this.batches.set(id, { mesh, count: 0, model: getCarModel(id), wheels: getModelGeometry(id).wheels });
        }

        const wheelGeo = getUnitWheelGeometry();
        this.meshes.tires = new THREE.InstancedMesh(wheelGeo.tire, this.materials.tire, max * 4);
        this.meshes.tires.name = 'instanced_wheel_tires';
        this.meshes.rims = new THREE.InstancedMesh(wheelGeo.rim, this.materials.rim, max * 4);
        this.meshes.rims.name = 'instanced_wheel_rims';
        this.meshes.rims.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 4 * 3), 3);
        for (const m of [this.meshes.tires, this.meshes.rims]) {
            if (this.enableShadows) {
                m.castShadow = true;
                m.receiveShadow = true;
            }
            meshes.push(m);
        }

        for (const mesh of meshes) {
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.frustumCulled = false;
            mesh.count = 0;
            if (scene) scene.add(mesh);
        }
        this._allMeshes = meshes;

        this.setCount(0);
        return this;
    }

    setCount(count) {
        const clamped = Math.max(0, Math.min(this.maxCapacity, count));
        this.activeCount = clamped;
        this.metrics.vehicleCount = clamped;
        this.metrics.wheelCount = clamped * 4;
        if (clamped === 0 && this._allMeshes) {
            for (const m of this._allMeshes) m.count = 0;
        }
    }

    _batchFor(v) {
        return this.batches.get(v.modelId) || this.batches.get(this.modelIds[0]);
    }

    update(vehicles, dt = 1 / 60) {
        if (!this.meshes.tires) return;
        const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
        const count = Math.min(this.maxCapacity, vehicles.length);
        if (this.activeCount !== count) {
            this.setCount(count);
        }

        for (const batch of this.batches.values()) batch.count = 0;
        let wheelIndex = 0;

        for (let i = 0; i < count; i++) {
            const v = vehicles[i];
            const batch = this._batchFor(v);
            const slot = batch.count++;
            const px = v.position.x;
            const py = v.position.y || 0;
            const pz = v.position.z;
            const yaw = v.yaw || 0;
            const steer = v.steerAngle || 0;
            // If an individual vehicle mesh is temporarily mounted in the scene (e.g., during a carjacking animation),
            // hide its instanced representation so its animated door is clearly visible without overlap.
            const isMountedIndividually = !!(v.mesh && v.mesh.parent);
            const scaleVec = isMountedIndividually ? _zeroScale : _scratchScale;

            _scratchPos.set(px, py, pz);
            _scratchQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
            _scratchMat4.compose(_scratchPos, _scratchQuat, scaleVec);

            batch.mesh.setMatrixAt(slot, _scratchMat4);
            const colorHex = v.color !== undefined ? v.color : (v.bodyColor || 0x111111);
            _scratchColor.setHex(colorHex);
            batch.mesh.setColorAt(slot, _scratchColor);

            const cosYaw = Math.cos(yaw);
            const sinYaw = Math.sin(yaw);
            const roll = v.wheelRoll || 0;
            const W = batch.model.wheels;
            if (isMountedIndividually) _wheelScale.set(0, 0, 0);
            else _wheelScale.set(W.width, W.radius, W.radius);
            _scratchColor.setHex(W.rim);

            const wheels = batch.wheels;
            for (let w = 0; w < wheels.length; w++) {
                const wh = wheels[w];
                const wheelYaw = wh.steer ? (yaw + steer) : yaw;
                const lx = wh.x, ly = wh.y, lz = wh.z;

                const wx = px + (lx * cosYaw + lz * sinYaw);
                const wy = py + ly;
                const wz = pz + (-lx * sinYaw + lz * cosYaw);

                _scratchPos.set(wx, wy, wz);
                _scratchEuler.set(-roll, wheelYaw, 0);
                _scratchQuat.setFromEuler(_scratchEuler);
                _scratchMat4.compose(_scratchPos, _scratchQuat, _wheelScale);

                this.meshes.tires.setMatrixAt(wheelIndex, _scratchMat4);
                this.meshes.rims.setMatrixAt(wheelIndex, _scratchMat4);
                this.meshes.rims.setColorAt(wheelIndex, _scratchColor);
                wheelIndex++;
            }
        }

        let drawCalls = 0;
        // Models with no cars on the road are skipped entirely
        for (const batch of this.batches.values()) {
            const mesh = batch.mesh;
            mesh.count = batch.count;
            mesh.visible = batch.count > 0;
            if (batch.count > 0) {
                mesh.instanceMatrix.needsUpdate = true;
                mesh.instanceColor.needsUpdate = true;
                drawCalls++;
            }
        }
        this.meshes.tires.count = wheelIndex;
        this.meshes.rims.count = wheelIndex;
        this.meshes.tires.visible = this.meshes.rims.visible = wheelIndex > 0;
        if (wheelIndex > 0) {
            this.meshes.tires.instanceMatrix.needsUpdate = true;
            this.meshes.rims.instanceMatrix.needsUpdate = true;
            this.meshes.rims.instanceColor.needsUpdate = true;
            drawCalls += 2;
        }
        this.metrics.drawCalls = drawCalls;

        if (t0 > 0) {
            const dur = performance.now() - t0;
            this.metrics.lastUpdateDurationMs = dur;
            this.metrics.updateCount++;
            this._totalUpdateDuration += dur;
            this.metrics.avgUpdateDurationMs = this._totalUpdateDuration / this.metrics.updateCount;
        }
    }

    getMetrics() {
        return {
            vehicleCount: this.activeCount,
            wheelCount: this.activeCount * 4,
            drawCalls: this.metrics.drawCalls,
            lastUpdateDurationMs: this.metrics.lastUpdateDurationMs,
            avgUpdateDurationMs: this.metrics.avgUpdateDurationMs,
            instancedMeshNodes: this._allMeshes ? this._allMeshes.length : 0,
            models: this.batches.size
        };
    }

    dispose() {
        if (this.scene && this._allMeshes) {
            // Geometries are shared with the individual car meshes (carModels.js), so only the
            // instance buffers go
            for (const mesh of this._allMeshes) {
                this.scene.remove(mesh);
                if (typeof mesh.dispose === 'function') mesh.dispose();
            }
        }
        for (const key in this.materials) {
            if (this.materials[key]) this.materials[key].dispose();
        }
    }
}
