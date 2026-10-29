/**
 * js/game/helicopter.js
 *
 * Mesh for the light helicopters in airTraffic.js. Nose points toward -Z, skids rest on y=0.
 * @returns {{ root: THREE.Group, rotor: THREE.Group, tailRotor: THREE.Group }}
 */

import * as THREE from 'three';

let _shared = null;
function shared() {
    if (_shared) return _shared;
    _shared = {
        cabin: new THREE.SphereGeometry(1, 16, 12),
        boom: new THREE.BoxGeometry(0.35, 0.4, 5.2),
        fin: new THREE.BoxGeometry(0.1, 1.3, 0.8),
        skid: new THREE.CylinderGeometry(0.05, 0.05, 3.4, 6),
        skidLeg: new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6),
        mast: new THREE.CylinderGeometry(0.12, 0.12, 0.5, 8),
        blade: new THREE.BoxGeometry(8.6, 0.04, 0.28),
        tailBlade: new THREE.BoxGeometry(0.05, 1.3, 0.14),
        glass: Object.assign(new THREE.MeshStandardMaterial({ color: 0x1a2a38, roughness: 0.1, metalness: 0.6 }), { userData: { glass: true } }),
        dark: new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.8 }),
        metal: new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.4, metalness: 0.7 }),
        bodies: new Map()
    };
    return _shared;
}

export function createHelicopterMesh(color = 0xf2f2f2, id = 'heli', size = {}) {
    const len = size.len || 1.8, width = size.width || 1.0, dz = len - 1.8;
    const s = shared();
    if (!s.bodies.has(color)) s.bodies.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2 }));
    const body = s.bodies.get(color);

    const root = new THREE.Group();
    root.name = `heli_${id}`;
    const add = (geo, mat, x, y, z) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        root.add(m);
        return m;
    };

    // the nose stays put and a longer cabin grows backwards (the bubble is the pilots' windscreen)
    add(s.cabin, body, 0, 1.5, dz).scale.set(width, 0.95 + dz * 0.05, len);
    add(s.cabin, s.glass, 0, 1.65, -1.04).scale.set(width * 0.85, 0.7, 1.0);
    add(s.boom, body, 0, 1.8, 3.4 + 2 * dz);
    add(s.fin, body, 0, 2.3, 5.8 + 2 * dz);
    for (const side of [-1, 1]) {
        const sk = add(s.skid, s.dark, side * width * 0.95, 0.12, dz);
        sk.rotation.x = Math.PI / 2;
        sk.scale.y = len / 1.8;
        for (const z of [dz - 0.5 * len, dz + 0.5 * len]) add(s.skidLeg, s.metal, side * width * 0.9, 0.55, z).rotation.z = side * 0.25;
    }
    add(s.mast, s.metal, 0, 2.6, 0);

    const rotor = new THREE.Group();
    rotor.position.set(0, 2.9, 0);
    rotor.add(new THREE.Mesh(s.blade, s.dark));
    const b2 = new THREE.Mesh(s.blade, s.dark);
    b2.rotation.y = Math.PI / 2;
    rotor.add(b2);
    root.add(rotor);

    const tailRotor = new THREE.Group();
    tailRotor.position.set(0.2, 2.3, 5.9 + 2 * dz);
    tailRotor.add(new THREE.Mesh(s.tailBlade, s.dark));
    const t2 = new THREE.Mesh(s.tailBlade, s.dark);
    t2.rotation.x = Math.PI / 2;
    tailRotor.add(t2);
    root.add(tailRotor);

    root.traverse((c) => {
        if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
        }
    });
    return { root, rotor, tailRotor };
}
