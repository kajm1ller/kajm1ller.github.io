import * as THREE from 'three';

console.log('=== VERIFYING HONDA CIVIC INSTANCED MESH CREATION ===');

// Helper to merge BufferGeometries without external addons
function mergeBufferGeometries(geometries) {
    let totalPositions = 0;
    let totalNormals = 0;
    let totalIndices = 0;

    for (const g of geometries) {
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

    for (const g of geometries) {
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
            for (let i = 0; i < idx.length; i++) {
                indexArray[indexOffset + i] = idx[i] + vertexBase;
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

// 1. Body Geometry
const bodyGeo = new THREE.BoxGeometry(2.2, 0.7, 4.5);
bodyGeo.translate(0, 0.55, 0);

// 2. Cabin Geometry
const cabinGeo = new THREE.BoxGeometry(1.9, 0.6, 2.2);
cabinGeo.translate(0, 1.1, -0.3);

// 3. Combined Glass Geometry
const windshieldGeo = new THREE.BoxGeometry(1.7, 0.5, 0.05);
windshieldGeo.rotateX(-0.2);
windshieldGeo.translate(0, 1.1, -1.4);

const rearGlassGeo = new THREE.BoxGeometry(1.7, 0.45, 0.05);
rearGlassGeo.rotateX(0.2);
rearGlassGeo.translate(0, 1.05, 0.8);

const leftWindowGeo = new THREE.BoxGeometry(0.05, 0.4, 1.8);
leftWindowGeo.translate(-0.97, 1.1, -0.3);

const rightWindowGeo = new THREE.BoxGeometry(0.05, 0.4, 1.8);
rightWindowGeo.translate(0.97, 1.1, -0.3);

const glassGeo = mergeBufferGeometries([windshieldGeo, rearGlassGeo, leftWindowGeo, rightWindowGeo]);

// 4. Combined Headlights
const hlGeoL = new THREE.BoxGeometry(0.35, 0.2, 0.05);
hlGeoL.translate(-0.7, 0.55, -2.26);
const hlGeoR = new THREE.BoxGeometry(0.35, 0.2, 0.05);
hlGeoR.translate(0.7, 0.55, -2.26);
const headlightsGeo = mergeBufferGeometries([hlGeoL, hlGeoR]);

// 5. Combined Taillights
const tlGeoL = new THREE.BoxGeometry(0.3, 0.15, 0.05);
tlGeoL.translate(-0.7, 0.55, 2.26);
const tlGeoR = new THREE.BoxGeometry(0.3, 0.15, 0.05);
tlGeoR.translate(0.7, 0.55, 2.26);
const taillightsGeo = mergeBufferGeometries([tlGeoL, tlGeoR]);

// 6. Combined Bumpers & Plate
const fBumpGeo = new THREE.BoxGeometry(2.0, 0.15, 0.15);
fBumpGeo.translate(0, 0.3, -2.3);
const rBumpGeo = new THREE.BoxGeometry(2.0, 0.15, 0.15);
rBumpGeo.translate(0, 0.3, 2.3);
const plateGeo = new THREE.BoxGeometry(0.6, 0.2, 0.02);
plateGeo.translate(0, 0.35, 2.31);
const bumpersGeo = mergeBufferGeometries([fBumpGeo, rBumpGeo, plateGeo]);

// 7. Combined Wheel + Hubcap (centered at origin, local X axis)
const tireGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 12);
tireGeo.rotateZ(Math.PI / 2);
const hubGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.26, 8);
hubGeo.rotateZ(Math.PI / 2);
const wheelGeo = mergeBufferGeometries([tireGeo, hubGeo]);

console.log('Geometries generated successfully:');
console.log(`- Body: vertices=${bodyGeo.attributes.position.count}`);
console.log(`- Cabin: vertices=${cabinGeo.attributes.position.count}`);
console.log(`- Glass: vertices=${glassGeo.attributes.position.count}`);
console.log(`- Headlights: vertices=${headlightsGeo.attributes.position.count}`);
console.log(`- Taillights: vertices=${taillightsGeo.attributes.position.count}`);
console.log(`- Bumpers: vertices=${bumpersGeo.attributes.position.count}`);
console.log(`- Wheel: vertices=${wheelGeo.attributes.position.count}`);

// Instantiate InstancedMeshes for 60 vehicles (240 wheels)
const MAX_CARS = 64;
const bodyMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
const cabinMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
const glassMat = new THREE.MeshLambertMaterial({ color: 0x4488aa, transparent: true, opacity: 0.5 });
const hlMat = new THREE.MeshBasicMaterial({ color: 0xffffcc });
const tlMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
const bumperMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
const wheelMat = new THREE.MeshLambertMaterial({ color: 0x222222 });

const bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, MAX_CARS);
const cabinMesh = new THREE.InstancedMesh(cabinGeo, cabinMat, MAX_CARS);
const glassMesh = new THREE.InstancedMesh(glassGeo, glassMat, MAX_CARS);
const hlMesh = new THREE.InstancedMesh(headlightsGeo, hlMat, MAX_CARS);
const tlMesh = new THREE.InstancedMesh(taillightsGeo, tlMat, MAX_CARS);
const bumperMesh = new THREE.InstancedMesh(bumpersGeo, bumperMat, MAX_CARS);
const wheelsMesh = new THREE.InstancedMesh(wheelGeo, wheelMat, MAX_CARS * 4);

console.log('InstancedMeshes created successfully:');
console.log(`Total draw calls for 50+ vehicles: 7 (down from 1,050!)`);
