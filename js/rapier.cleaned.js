import RAPIER from 'https://cdn.skypack.dev/@dimforge/rapier3d-compat';
import * as THREE from 'https://cdn.skypack.dev/three@0.132.2';
import { OrbitControls } from 'https://cdn.skypack.dev/three@0.132.2/examples/jsm/controls/OrbitControls.js';


// Fuck you

RAPIER.init().then(() => {
    
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);
    
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(5, 5, 5);
    camera.lookAt(0, 0, 0);
    
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    document.body.appendChild(renderer.domElement);
    
    
    const impactSounds = [
        new Audio('media/mp3/Funny.mp3'),
        new Audio('media/mp3/Noises.mp3'),
        new Audio('media/mp3/OhMan.mp3'),
        new Audio('media/mp3/TheBiggestHonk.mp3')
    ];
    impactSounds.forEach(a => { a.preload = 'auto'; a.volume = 0.55; });

    
    const activeImpactSounds = new Set();

    const playImpactSound = () => {
        
        if (activeImpactSounds.size >= 3) return;

        const src = impactSounds[Math.floor(Math.random() * impactSounds.length)];
        const clone = src.cloneNode(true);
        clone.volume = src.volume;
        clone.currentTime = 0;

        
        const cleanup = () => activeImpactSounds.delete(clone);
        clone.addEventListener('ended', cleanup, { once: true });
        clone.addEventListener('error', cleanup, { once: true });

        activeImpactSounds.add(clone);
        clone.play().catch(() => {
            cleanup();
        });
    };

    
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; 
    controls.dampingFactor = 0.05;
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.minDistance = 2.5;
    controls.maxDistance = 25;
    controls.maxPolarAngle = Math.PI * 0.49; 
    controls.mouseButtons = {
        LEFT: null, 
        MIDDLE: THREE.MOUSE.ROTATE,
        RIGHT: THREE.MOUSE.PAN
    };
    controls.touches = {
        ONE: THREE.TOUCH.ROTATE,        
        TWO: THREE.TOUCH.DOLLY_PAN      
    };
    controls.target.set(0, 1, 0); 
    
    
    const colliderToShape = new Map();

    
    const hemiLight = new THREE.HemisphereLight(0xbcd9ff, 0x1b1a1a, 0.55); 
    scene.add(hemiLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.05);
    directionalLight.position.set(12, 14, 6);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.set(2048, 2048);
    directionalLight.shadow.bias = -0.0006;
    directionalLight.shadow.normalBias = 0.02;
    scene.add(directionalLight);

    const rimLight = new THREE.DirectionalLight(0x8cc7ff, 0.35);
    rimLight.position.set(-8, 6, -10);
    rimLight.castShadow = false;
    scene.add(rimLight);
    
    
    let gravity = { x: 0.0, y: -9.81, z: 0.0 };
    let world = new RAPIER.World(gravity);

    
    let groundColliderDesc = RAPIER.ColliderDesc.cuboid(10.0, 0.1, 10.0);
    const groundCollider = world.createCollider(groundColliderDesc);
    
    
    const groundGeometry = new THREE.BoxGeometry(20, 0.2, 20);
    const groundMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x707070,
        metalness: 0.05,
        roughness: 0.8
    });
    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    
    const allCubes = [];

    
    const gravityGunAnchor = new THREE.Vector3();
    let gravityGunEnabled = false;
    let gravityGunActive = false;
    let gravityGunStartTime = 0;
    const gravityGunRange = 4.5; 
    const gravityGunTilt = THREE.MathUtils.degToRad(8); 
    
    
    function createCube(x, y, z, color = null) {
        
        if (!color) {
            color = Math.random() * 0xffffff;
        }
        
        
        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(x, y, z);
        const body = world.createRigidBody(bodyDesc);
        
        
        body.setLinearDamping(0.3);
        body.setAngularDamping(0.5);
        
        
        const colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
            .setRestitution(0.8)  
            .setFriction(0.5)
            .setDensity(1.0)
            .setActiveEvents(RAPIER.ActiveEvents.CONTACT_EVENTS);
        const collider = world.createCollider(colliderDesc, body);
        
        
        const cubeGeometry = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
        const material = new THREE.MeshStandardMaterial({ 
            color: color,
            metalness: 0.2,
            roughness: 0.45
        });
        const mesh = new THREE.Mesh(cubeGeometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        
        
        const cubeData = { 
            body: body, 
            mesh: mesh,
            originalGeometry: cubeGeometry.clone(),
            squishScale: new THREE.Vector3(1, 1, 1),
            targetSquishScale: new THREE.Vector3(1, 1, 1),
            lastVelocity: new THREE.Vector3(0, 0, 0),
            type: 'cube',
            colliderHandle: collider.handle,
            lastImpactSoundTime: 0
        };
        allCubes.push(cubeData);
        colliderToShape.set(collider.handle, cubeData);
        
        return cubeData;
    }
    
    
    function createSphere(x, y, z, color = null) {
        if (!color) {
            color = Math.random() * 0xffffff;
        }
        
        const radius = 0.5;
        
        
        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(x, y, z);
        const body = world.createRigidBody(bodyDesc);
        
        body.setLinearDamping(0.1);
        body.setAngularDamping(0.3);
        
        
        const colliderDesc = RAPIER.ColliderDesc.ball(radius)
            .setRestitution(0.95)  
            .setFriction(0.3)
            .setDensity(1.0)
            .setActiveEvents(RAPIER.ActiveEvents.CONTACT_EVENTS);
        const collider = world.createCollider(colliderDesc, body);
        
        
        const sphereGeometry = new THREE.SphereGeometry(radius, 32, 32);
        const material = new THREE.MeshStandardMaterial({ 
            color: color,
            metalness: 0.25,
            roughness: 0.4
        });
        const mesh = new THREE.Mesh(sphereGeometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        
        const sphereData = { 
            body: body, 
            mesh: mesh,
            originalGeometry: sphereGeometry.clone(),
            squishScale: new THREE.Vector3(1, 1, 1),
            targetSquishScale: new THREE.Vector3(1, 1, 1),
            lastVelocity: new THREE.Vector3(0, 0, 0),
            type: 'sphere',
            colliderHandle: collider.handle,
            lastImpactSoundTime: 0
        };
        allCubes.push(sphereData);
        colliderToShape.set(collider.handle, sphereData);
        
        return sphereData;
    }
    
    
    function createTriangle(x, y, z, color = null) {
        if (!color) {
            color = Math.random() * 0xffffff;
        }
        
        
        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(x, y, z);
        const body = world.createRigidBody(bodyDesc);
        
        body.setLinearDamping(0.3);
        body.setAngularDamping(0.5);
        
        
        const points = [
            { x: 0, y: 0.6, z: 0 },        
            { x: -0.5, y: -0.3, z: 0.5 },  
            { x: 0.5, y: -0.3, z: 0.5 },   
            { x: 0, y: -0.3, z: -0.5 }     
        ];
        const colliderDesc = RAPIER.ColliderDesc.convexHull(
            new Float32Array(points.flatMap(p => [p.x, p.y, p.z]))
        )
            .setRestitution(0.75)
            .setFriction(0.6)
            .setDensity(1.0)
            .setActiveEvents(RAPIER.ActiveEvents.CONTACT_EVENTS);
        const collider = world.createCollider(colliderDesc, body);
        
        
        const geometry = new THREE.TetrahedronGeometry(0.7, 0);
        const material = new THREE.MeshStandardMaterial({ 
            color: color,
            metalness: 0.18,
            roughness: 0.5
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        
        const triangleData = { 
            body: body, 
            mesh: mesh,
            originalGeometry: geometry.clone(),
            squishScale: new THREE.Vector3(1, 1, 1),
            targetSquishScale: new THREE.Vector3(1, 1, 1),
            lastVelocity: new THREE.Vector3(0, 0, 0),
            type: 'triangle',
            colliderHandle: collider.handle,
            lastImpactSoundTime: 0
        };
        allCubes.push(triangleData);
        colliderToShape.set(collider.handle, triangleData);
        
        return triangleData;
    }
    
    
    function createWavyTube(x, y, z, color = null) {
        if (!color) {
            color = Math.random() * 0xffffff;
        }
        
        
        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(x, y, z);
        const body = world.createRigidBody(bodyDesc);
        
        body.setLinearDamping(0.3);
        body.setAngularDamping(0.5);
        
        
        const colliderDesc = RAPIER.ColliderDesc.capsule(0.5, 0.3)
            .setRestitution(0.85)
            .setFriction(0.5)
            .setDensity(1.0)
            .setActiveEvents(RAPIER.ActiveEvents.CONTACT_EVENTS);
        const collider = world.createCollider(colliderDesc, body);
        
        
        const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, -0.5, 0),
            new THREE.Vector3(0.2, -0.25, 0.1),
            new THREE.Vector3(-0.1, 0, -0.1),
            new THREE.Vector3(0.15, 0.25, 0.05),
            new THREE.Vector3(0, 0.5, 0)
        ]);
        
        const tubeGeometry = new THREE.TubeGeometry(curve, 20, 0.15, 16, false);
        const material = new THREE.MeshStandardMaterial({ 
            color: color,
            side: THREE.DoubleSide,
            metalness: 0.22,
            roughness: 0.42
        });
        const mesh = new THREE.Mesh(tubeGeometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        
        const tubeData = { 
            body: body, 
            mesh: mesh,
            originalGeometry: tubeGeometry.clone(),
            squishScale: new THREE.Vector3(1, 1, 1),
            targetSquishScale: new THREE.Vector3(1, 1, 1),
            lastVelocity: new THREE.Vector3(0, 0, 0),
            type: 'tube',
            colliderHandle: collider.handle,
            lastImpactSoundTime: 0
        };
        allCubes.push(tubeData);
        colliderToShape.set(collider.handle, tubeData);
        
        return tubeData;
    }
    
    
    
    
    
    
    
    const addCubeButton = document.getElementById('addCube');
    const addCubeHandler = () => {
        const x = (Math.random() - 0.5) * 2;
        const y = 5 + Math.random() * 2;
        const z = (Math.random() - 0.5) * 2;
        createCube(x, y, z);
    };
    addCubeButton.addEventListener('click', addCubeHandler);
    addCubeButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        addCubeHandler();
    });
    
    
    const addSphereButton = document.getElementById('addSphere');
    const addSphereHandler = () => {
        const x = (Math.random() - 0.5) * 2;
        const y = 5 + Math.random() * 2;
        const z = (Math.random() - 0.5) * 2;
        createSphere(x, y, z);
    };
    addSphereButton.addEventListener('click', addSphereHandler);
    addSphereButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        addSphereHandler();
    });
    
    
    const addTriangleButton = document.getElementById('addTriangle');
    const addTriangleHandler = () => {
        const x = (Math.random() - 0.5) * 2;
        const y = 5 + Math.random() * 2;
        const z = (Math.random() - 0.5) * 2;
        createTriangle(x, y, z);
    };
    addTriangleButton.addEventListener('click', addTriangleHandler);
    addTriangleButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        addTriangleHandler();
    });
    
    
    const addTubeButton = document.getElementById('addTube');
    const addTubeHandler = () => {
        const x = (Math.random() - 0.5) * 2;
        const y = 5 + Math.random() * 2;
        const z = (Math.random() - 0.5) * 2;
        createWavyTube(x, y, z);
    };
    addTubeButton.addEventListener('click', addTubeHandler);
    addTubeButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        addTubeHandler();
    });

    
    const gravityGunButton = document.getElementById('gravityGun');
    const updateGravityGunButton = () => {
        gravityGunButton.textContent = gravityGunEnabled ? 'Gravity Gun: On' : 'Gravity Gun: Off';
    };

    const deactivateGravityGun = () => {
        gravityGunActive = false;
        
        if (!isDragging) {
            controls.enabled = true;
        }
    };

    gravityGunButton.addEventListener('click', () => {
        gravityGunEnabled = !gravityGunEnabled;
        if (!gravityGunEnabled) {
            deactivateGravityGun();
        }
        updateGravityGunButton();
    });
    gravityGunButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        gravityGunEnabled = !gravityGunEnabled;
        if (!gravityGunEnabled) {
            deactivateGravityGun();
        }
        updateGravityGunButton();
    });
    updateGravityGunButton();
    
    
    const resetCubesButton = document.getElementById('resetCubes');
    const resetCubesHandler = () => {
        
        if (isDragging) {
            isDragging = false;
            draggedCube = null;
            controls.enabled = true;
        }

        
        deactivateGravityGun();

        if (allCubes.length === 0) return;

        
        const blastStrength = 35;
        const upwardBoost = 12;

        for (const shape of allCubes) {
            const pos = shape.body.translation();
            const dir = new THREE.Vector3(pos.x, pos.y, pos.z);

            
            dir.add(new THREE.Vector3(
                (Math.random() - 0.5) * 0.6,
                0.6,
                (Math.random() - 0.5) * 0.6
            ));

            if (dir.lengthSq() < 0.001) {
                dir.set(0, 1, 0); 
            }

            dir.normalize();
            dir.multiplyScalar(blastStrength);
            dir.y += upwardBoost;

            shape.body.applyImpulse({ x: dir.x, y: dir.y, z: dir.z }, true);
        }

        
        setTimeout(() => {
            while (allCubes.length > 0) {
                const shape = allCubes.pop();

                
                world.removeRigidBody(shape.body);

                
                scene.remove(shape.mesh);

                
                shape.mesh.geometry.dispose();
                shape.mesh.material.dispose();

                
                if (shape.colliderHandle !== undefined) {
                    colliderToShape.delete(shape.colliderHandle);
                }
            }
        }, 650);
    };
    resetCubesButton.addEventListener('click', resetCubesHandler);
    resetCubesButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        resetCubesHandler();
    });
    
    
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    
    
    let isDragging = false;
    let draggedCube = null; 
    let dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    let dragPoint = new THREE.Vector3();
    let lastDragPoint = new THREE.Vector3();
    let dragVelocity = new THREE.Vector3();
    let lastTime = Date.now();
    let previousPosition = new THREE.Vector3();
    let dragHoldTimer = null;
    let pendingDragShape = null;
    let pendingDragHit = null;
    const dragHoldDelay = 140; 
    const dragMoveTolerance = 12; 
    const touchStartPixel = new THREE.Vector2();
    
    
    function onMouseDown(event) {
        
        if (event.button !== 0) return;

        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);

        if (gravityGunEnabled) {
            const hit = new THREE.Vector3();
            if (raycaster.ray.intersectPlane(groundPlane, hit)) {
                gravityGunAnchor.copy(hit);
            } else {
                const dir = new THREE.Vector3();
                camera.getWorldDirection(dir);
                gravityGunAnchor.copy(camera.position).add(dir.multiplyScalar(5));
            }
            gravityGunActive = true;
            gravityGunStartTime = performance.now();

            
            isDragging = false;
            draggedCube = null;
            controls.enabled = false;

            for (let i = 0; i < allCubes.length; i++) {
                const shape = allCubes[i];
                const pos = shape.body.translation();
                const offset = new THREE.Vector3(pos.x - gravityGunAnchor.x, pos.y - gravityGunAnchor.y, pos.z - gravityGunAnchor.z);
                const planarDistSq = offset.x * offset.x + offset.z * offset.z;
                const withinRange = planarDistSq <= gravityGunRange * gravityGunRange;
                
                shape.orbitPhase = Math.random() * Math.PI * 2;
                
                shape.orbitDirection = (Math.floor(i / 3) % 2 === 0) ? 1 : -1;
                shape.inGravityOrbit = withinRange;
                shape.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
                shape.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
            }
            return;
        }

        
        const allMeshes = allCubes.map(cube => cube.mesh);
        const intersects = raycaster.intersectObjects(allMeshes);

        if (intersects.length > 0) {
            
            const clickedMesh = intersects[0].object;
            draggedCube = allCubes.find(cube => cube.mesh === clickedMesh);

            if (draggedCube) {
                isDragging = true;
                
                
                controls.enabled = false;
                
                
                const cameraDirection = new THREE.Vector3();
                camera.getWorldDirection(cameraDirection);
                dragPlane.setFromNormalAndCoplanarPoint(
                    cameraDirection,
                    intersects[0].point
                );
                
                
                raycaster.ray.intersectPlane(dragPlane, lastDragPoint);
                dragPoint.copy(lastDragPoint);
                lastTime = Date.now();
                
                
                const pos = draggedCube.body.translation();
                previousPosition.set(pos.x, pos.y, pos.z);
            }
        }
    }

    function startTouchDrag(shape, hitPoint) {
        draggedCube = shape;
        isDragging = true;

        
        controls.enabled = false;

        
        const cameraDirection = new THREE.Vector3();
        camera.getWorldDirection(cameraDirection);
        dragPlane.setFromNormalAndCoplanarPoint(
            cameraDirection,
            hitPoint
        );

        
        raycaster.ray.intersectPlane(dragPlane, lastDragPoint);
        dragPoint.copy(lastDragPoint);
        lastTime = Date.now();

        
        const pos = draggedCube.body.translation();
        previousPosition.set(pos.x, pos.y, pos.z);
    }
    
    function onMouseMove(event) {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        
        
        if (gravityGunActive) {
            raycaster.setFromCamera(mouse, camera);
            const hit = new THREE.Vector3();
            if (raycaster.ray.intersectPlane(groundPlane, hit)) {
                gravityGunAnchor.copy(hit);
            }
            return;
        }

        if (!isDragging) return;
        
        raycaster.setFromCamera(mouse, camera);
        
        
        if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
            const currentTime = Date.now();
            const deltaTime = (currentTime - lastTime) / 1000;
            
            if (deltaTime > 0) {
                
                dragVelocity.subVectors(dragPoint, lastDragPoint).divideScalar(deltaTime);
                lastDragPoint.copy(dragPoint);
                lastTime = currentTime;
            }
        }
    }
    
    function onMouseUp(event) {
        
        if (event.button !== 0) return;
        
        
        if (gravityGunActive) {
            deactivateGravityGun();
        }

        if (isDragging && draggedCube) {
            isDragging = false;
            
            
            controls.enabled = true;
            
            
            const maxVelocity = 20;
            dragVelocity.clampLength(0, maxVelocity);
            draggedCube.body.setLinvel({ x: dragVelocity.x, y: dragVelocity.y, z: dragVelocity.z }, true);
            
            
            draggedCube = null;
            
            
            dragVelocity.set(0, 0, 0);
        }
    }
    
    
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    
    
    function onTouchStart(event) {
        
        if (event.touches.length !== 1) {
            return;
        }

        const touch = event.touches[0];
        mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;
        
        raycaster.setFromCamera(mouse, camera);

        if (gravityGunEnabled) {
            const hit = new THREE.Vector3();
            if (raycaster.ray.intersectPlane(groundPlane, hit)) {
                gravityGunAnchor.copy(hit);
            } else {
                const dir = new THREE.Vector3();
                camera.getWorldDirection(dir);
                gravityGunAnchor.copy(camera.position).add(dir.multiplyScalar(5));
            }
            gravityGunActive = true;
            gravityGunStartTime = performance.now();

            isDragging = false;
            draggedCube = null;
            controls.enabled = false;

            for (let i = 0; i < allCubes.length; i++) {
                const shape = allCubes[i];
                const pos = shape.body.translation();
                const dx = pos.x - gravityGunAnchor.x;
                const dz = pos.z - gravityGunAnchor.z;
                const planarDistSq = dx * dx + dz * dz;
                const withinRange = planarDistSq <= gravityGunRange * gravityGunRange;
                shape.orbitPhase = Math.random() * Math.PI * 2;
                shape.orbitDirection = (Math.floor(i / 3) % 2 === 0) ? 1 : -1;
                shape.inGravityOrbit = withinRange;
                shape.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
                shape.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
            }
            return;
        }
        
        
        const allMeshes = allCubes.map(cube => cube.mesh);
        const intersects = raycaster.intersectObjects(allMeshes);
        
        
        if (intersects.length > 0) {
            const clickedMesh = intersects[0].object;
            const candidate = allCubes.find(cube => cube.mesh === clickedMesh);
            if (candidate) {
                pendingDragShape = candidate;
                pendingDragHit = intersects[0].point.clone();
                touchStartPixel.set(touch.clientX, touch.clientY);
                if (dragHoldTimer) clearTimeout(dragHoldTimer);
                dragHoldTimer = setTimeout(() => {
                    startTouchDrag(pendingDragShape, pendingDragHit);
                    pendingDragShape = null;
                    pendingDragHit = null;
                    dragHoldTimer = null;
                }, dragHoldDelay);
            }
        } else {
            
            controls.enabled = true;
            isDragging = false;
            draggedCube = null;
        }
    }
    
    function onTouchMove(event) {
        if (event.touches.length !== 1) return;

        
        const shouldBlockDefault = gravityGunActive || isDragging || pendingDragShape;
        if (shouldBlockDefault) {
            event.preventDefault();
        }

        const touch = event.touches[0];
        mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;
        
        
        if (gravityGunActive) {
            raycaster.setFromCamera(mouse, camera);
            const hit = new THREE.Vector3();
            if (raycaster.ray.intersectPlane(groundPlane, hit)) {
                gravityGunAnchor.copy(hit);
            }
            return;
        }

        
        if (pendingDragShape && dragHoldTimer) {
            const dx = touch.clientX - touchStartPixel.x;
            const dy = touch.clientY - touchStartPixel.y;
            if (Math.hypot(dx, dy) > dragMoveTolerance) {
                clearTimeout(dragHoldTimer);
                dragHoldTimer = null;
                pendingDragShape = null;
                pendingDragHit = null;
                
            }
        }

        if (!isDragging) return;
        
        raycaster.setFromCamera(mouse, camera);
        
        
        if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
            const currentTime = Date.now();
            const deltaTime = (currentTime - lastTime) / 1000;
            
            if (deltaTime > 0) {
                
                dragVelocity.subVectors(dragPoint, lastDragPoint).divideScalar(deltaTime);
                lastDragPoint.copy(dragPoint);
                lastTime = currentTime;
            }
        }
    }
    
    function onTouchEnd(event) {
        if (gravityGunActive) {
            deactivateGravityGun();
        }

        
        if (dragHoldTimer) {
            clearTimeout(dragHoldTimer);
            dragHoldTimer = null;
        }
        pendingDragShape = null;
        pendingDragHit = null;

        if (!isDragging || !draggedCube) return;
        
        event.preventDefault();
        
        isDragging = false;
        
        
        controls.enabled = true;
        
        
        const maxVelocity = 20;
        dragVelocity.clampLength(0, maxVelocity);
        draggedCube.body.setLinvel({ x: dragVelocity.x, y: dragVelocity.y, z: dragVelocity.z }, true);
        
        
        draggedCube = null;
        
        
        dragVelocity.set(0, 0, 0);
    }
    
    
    window.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: false });
    window.addEventListener('touchcancel', onTouchEnd, { passive: false });
    
    
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
    
    
    const positionElement = document.getElementById('position');

    
    let gameLoop = () => {
        
        world.step();
        
        
        controls.update();

        const gravityGunTime = gravityGunActive ? (performance.now() - gravityGunStartTime) / 1000 : 0;
        if (gravityGunActive) {
            for (const shape of allCubes) {
                
                const pos = shape.body.translation();
                const dxAnchor = pos.x - gravityGunAnchor.x;
                const dzAnchor = pos.z - gravityGunAnchor.z;
                const planarDistSqAnchor = dxAnchor * dxAnchor + dzAnchor * dzAnchor;
                if (planarDistSqAnchor > gravityGunRange * gravityGunRange) {
                    shape.inGravityOrbit = false;
                    continue;
                }
                shape.inGravityOrbit = true;

                
                const radius = 1.35; 
                const speed = 0.28;
                const heightOsc = 0.25;
                const baseLift = 1.6; 
                const direction = shape.orbitDirection || 1;
                const angle = gravityGunTime * speed * Math.PI * 2 * direction + (shape.orbitPhase || 0);

                
                const projectedRadius = radius * Math.cos(gravityGunTilt);
                const tiltLift = radius * Math.sin(gravityGunTilt);

                const targetX = gravityGunAnchor.x + Math.cos(angle) * projectedRadius;
                const targetZ = gravityGunAnchor.z + Math.sin(angle) * projectedRadius;
                const yRaw = gravityGunAnchor.y + baseLift + tiltLift + Math.sin(gravityGunTime * 2 + angle) * heightOsc;

                
                const shapeRadius = 0.55; 
                const targetY = Math.max(shapeRadius + 0.25, yRaw);

                
                const toTarget = new THREE.Vector3(targetX - pos.x, targetY - pos.y, targetZ - pos.z);
                const desiredVel = toTarget.multiplyScalar(4.2).clampLength(0, 12);
                const currentVel = shape.body.linvel();
                const velDelta = desiredVel.sub(new THREE.Vector3(currentVel.x, currentVel.y, currentVel.z));
                const mass = shape.body.mass();
                const impulse = velDelta.multiplyScalar(mass);
                shape.body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);

                shape.body.setAngvel({ x: 1.2, y: 1.6 * direction, z: 1.1 }, true);
            }
        }
        
        
        if (isDragging && draggedCube) {
            const currentPos = draggedCube.body.translation();
            
            
            const targetVelocity = new THREE.Vector3(
                dragPoint.x - currentPos.x,
                dragPoint.y - currentPos.y,
                dragPoint.z - currentPos.z
            );
            
            
            targetVelocity.multiplyScalar(5);
            
            
            const dragSpeed = targetVelocity.length();
            if (dragSpeed > 0.5) {
                const dragDir = targetVelocity.clone().normalize();
                const squishAmount = Math.min(dragSpeed * 0.08, 0.35);
                
                
                draggedCube.targetSquishScale.set(1, 1, 1);
                
                if (Math.abs(dragDir.y) > 0.5) {
                    
                    draggedCube.targetSquishScale.y = 1 + squishAmount;
                    draggedCube.targetSquishScale.x = 1 - squishAmount * 0.4;
                    draggedCube.targetSquishScale.z = 1 - squishAmount * 0.4;
                } else if (Math.abs(dragDir.x) > Math.abs(dragDir.z)) {
                    
                    draggedCube.targetSquishScale.x = 1 + squishAmount;
                    draggedCube.targetSquishScale.y = 1 - squishAmount * 0.4;
                    draggedCube.targetSquishScale.z = 1 - squishAmount * 0.4;
                } else {
                    
                    draggedCube.targetSquishScale.z = 1 + squishAmount;
                    draggedCube.targetSquishScale.x = 1 - squishAmount * 0.4;
                    draggedCube.targetSquishScale.y = 1 - squishAmount * 0.4;
                }
            }
            
            
            draggedCube.body.setLinvel({ 
                x: targetVelocity.x, 
                y: targetVelocity.y, 
                z: targetVelocity.z 
            }, true);
            
            
            draggedCube.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }

        
        for (let i = allCubes.length - 1; i >= 0; i--) {
            const cubeData = allCubes[i];
            const pos = cubeData.body.translation();
            if (pos.y < -25) {
                
                world.removeRigidBody(cubeData.body);
                scene.remove(cubeData.mesh);
                cubeData.mesh.geometry.dispose();
                cubeData.mesh.material.dispose();
                if (cubeData.colliderHandle !== undefined) {
                    colliderToShape.delete(cubeData.colliderHandle);
                }
                allCubes.splice(i, 1);
                continue;
            }
        }

        
        for (let i = 0; i < allCubes.length; i++) {
            const cubeData = allCubes[i];
            const pos = cubeData.body.translation();
            const rot = cubeData.body.rotation();
            const vel = cubeData.body.linvel();
            
            
            cubeData.mesh.position.set(pos.x, pos.y, pos.z);
            cubeData.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
            
            
            const currentVel = new THREE.Vector3(vel.x, vel.y, vel.z);
            const velocityChange = new THREE.Vector3().subVectors(currentVel, cubeData.lastVelocity);
            const impactMagnitude = velocityChange.length();
            
            
            if (impactMagnitude > 0.2) {
                
                const squishDir = velocityChange.normalize();
                
                
                const squishAmount = Math.min(impactMagnitude * 0.25, 0.6);
                
                cubeData.targetSquishScale.set(1, 1, 1);
                
                
                if (Math.abs(squishDir.y) > 0.5) {
                    
                    cubeData.targetSquishScale.y = 1 - squishAmount;
                    cubeData.targetSquishScale.x = 1 + squishAmount * 0.5;
                    cubeData.targetSquishScale.z = 1 + squishAmount * 0.5;
                } else if (Math.abs(squishDir.x) > Math.abs(squishDir.z)) {
                    
                    cubeData.targetSquishScale.x = 1 - squishAmount;
                    cubeData.targetSquishScale.y = 1 + squishAmount * 0.5;
                    cubeData.targetSquishScale.z = 1 + squishAmount * 0.5;
                } else {
                    
                    cubeData.targetSquishScale.z = 1 - squishAmount;
                    cubeData.targetSquishScale.x = 1 + squishAmount * 0.5;
                    cubeData.targetSquishScale.y = 1 + squishAmount * 0.5;
                }
            }

            
            if (impactMagnitude > 0.35) {
                const now = performance.now();
                if (now - cubeData.lastImpactSoundTime > 180) {
                    playImpactSound();
                    cubeData.lastImpactSoundTime = now;
                }
            }
            
            
            cubeData.squishScale.lerp(cubeData.targetSquishScale, 0.3);
            cubeData.targetSquishScale.lerp(new THREE.Vector3(1, 1, 1), 0.05);
            
            
            cubeData.mesh.scale.copy(cubeData.squishScale);
            
            
            cubeData.lastVelocity.copy(currentVel);
        }
        
        
        const cubeCount = allCubes.length;
        let status = '';
        if (gravityGunActive) {
            status += ' [GRAVITY GUN]';
        } else if (gravityGunEnabled) {
            status += ' [GRAVITY GUN]';
        }
        if (isDragging) {
            status += ' [GRABBED]';
        }
        positionElement.textContent = `Shapes: ${cubeCount}${status}`;

        
        renderer.render(scene, camera);
        
        requestAnimationFrame(gameLoop);
    };

    gameLoop();
});