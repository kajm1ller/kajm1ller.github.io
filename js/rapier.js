import RAPIER from 'https://cdn.skypack.dev/@dimforge/rapier3d-compat';
import * as THREE from 'https://cdn.skypack.dev/three@0.132.2';
import { OrbitControls } from 'https://cdn.skypack.dev/three@0.132.2/examples/jsm/controls/OrbitControls.js';

// Initialize and run the simulation
RAPIER.init().then(() => {
    // Setup Three.js scene
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
    
    // Preload impact sounds
    const impactSounds = [
        new Audio('media/mp3/Funny.mp3'),
        new Audio('media/mp3/Noises.mp3'),
        new Audio('media/mp3/OhMan.mp3'),
        new Audio('media/mp3/TheBiggestHonk.mp3')
    ];
    impactSounds.forEach(a => { a.preload = 'auto'; a.volume = 0.55; });

    // Track active sounds to cap simultaneous playback
    const activeImpactSounds = new Set();

    const playImpactSound = () => {
        // Skip if too many sounds are already playing
        if (activeImpactSounds.size >= 3) return;

        const src = impactSounds[Math.floor(Math.random() * impactSounds.length)];
        const clone = src.cloneNode(true);
        clone.volume = src.volume;
        clone.currentTime = 0;

        // Remove from active list when finished or if playback fails
        const cleanup = () => activeImpactSounds.delete(clone);
        clone.addEventListener('ended', cleanup, { once: true });
        clone.addEventListener('error', cleanup, { once: true });

        activeImpactSounds.add(clone);
        clone.play().catch(() => {
            cleanup();
        });
    };

    // Add OrbitControls with mobile-friendly gestures
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; // Smooth camera movement
    controls.dampingFactor = 0.05;
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.minDistance = 2.5;
    controls.maxDistance = 25;
    controls.maxPolarAngle = Math.PI * 0.49; // prevent flipping below ground
    controls.mouseButtons = {
        LEFT: null, // Disable left button for orbit (reserved for dragging shapes)
        MIDDLE: THREE.MOUSE.ROTATE,
        RIGHT: THREE.MOUSE.PAN
    };
    controls.touches = {
        ONE: THREE.TOUCH.ROTATE,        // one-finger orbit
        TWO: THREE.TOUCH.DOLLY_PAN      // pinch to zoom + two-finger pan
    };
    controls.target.set(0, 1, 0); // Look at center of action
    
    // Map collider handles to shape data for collision detection
    const colliderToShape = new Map();

    // Add lights
    const hemiLight = new THREE.HemisphereLight(0xbcd9ff, 0x1b1a1a, 0.55); // sky, ground
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
    
    // Create Rapier physics world
    let gravity = { x: 0.0, y: -9.81, z: 0.0 };
    let world = new RAPIER.World(gravity);

    // Create the ground (physics)
    let groundColliderDesc = RAPIER.ColliderDesc.cuboid(10.0, 0.1, 10.0);
    const groundCollider = world.createCollider(groundColliderDesc);
    
    // Create the ground (visual)
    const groundGeometry = new THREE.BoxGeometry(20, 0.2, 20);
    const groundMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x707070,
        metalness: 0.05,
        roughness: 0.8
    });
    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    // Array to store all draggable objects (cubes, spheres, etc.)
    const allCubes = [];

    // Gravity Gun state
    const gravityGunAnchor = new THREE.Vector3();
    let gravityGunEnabled = false;
    let gravityGunActive = false;
    let gravityGunStartTime = 0;
    const gravityGunRange = 4.5; // only pull nearby shapes
    const gravityGunTilt = THREE.MathUtils.degToRad(8); // slight upward tilt to avoid clipping ground
    
    // Function to create a new cube
    function createCube(x, y, z, color = null) {
        // Random color if not specified
        if (!color) {
            color = Math.random() * 0xffffff;
        }
        
        // Create physics body with bouncy properties
        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(x, y, z);
        const body = world.createRigidBody(bodyDesc);
        
        // Bouncy physics properties
        body.setLinearDamping(0.3);
        body.setAngularDamping(0.5);
        
        // Create collider with bouncy material properties
        const colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
            .setRestitution(0.8)  // High bounce
            .setFriction(0.5)
            .setDensity(1.0)
            .setActiveEvents(RAPIER.ActiveEvents.CONTACT_EVENTS);
        const collider = world.createCollider(colliderDesc, body);
        
        // Create visual mesh with segments for smooth deformation
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
        
        // Store cube data with squish tracking
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
    
    // Function to create a sphere
    function createSphere(x, y, z, color = null) {
        if (!color) {
            color = Math.random() * 0xffffff;
        }
        
        const radius = 0.5;
        
        // Create physics body
        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(x, y, z);
        const body = world.createRigidBody(bodyDesc);
        
        body.setLinearDamping(0.1);
        body.setAngularDamping(0.3);
        
        // Create sphere collider
        const colliderDesc = RAPIER.ColliderDesc.ball(radius)
            .setRestitution(0.95)  // Super bouncy
            .setFriction(0.3)
            .setDensity(1.0)
            .setActiveEvents(RAPIER.ActiveEvents.CONTACT_EVENTS);
        const collider = world.createCollider(colliderDesc, body);
        
        // Create visual mesh
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
    
    // Function to create a triangle (tetrahedron/pyramid)
    function createTriangle(x, y, z, color = null) {
        if (!color) {
            color = Math.random() * 0xffffff;
        }
        
        // Create physics body
        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(x, y, z);
        const body = world.createRigidBody(bodyDesc);
        
        body.setLinearDamping(0.3);
        body.setAngularDamping(0.5);
        
        // Create tetrahedron collider using convex hull
        const points = [
            { x: 0, y: 0.6, z: 0 },        // Top
            { x: -0.5, y: -0.3, z: 0.5 },  // Base 1
            { x: 0.5, y: -0.3, z: 0.5 },   // Base 2
            { x: 0, y: -0.3, z: -0.5 }     // Base 3
        ];
        const colliderDesc = RAPIER.ColliderDesc.convexHull(
            new Float32Array(points.flatMap(p => [p.x, p.y, p.z]))
        )
            .setRestitution(0.75)
            .setFriction(0.6)
            .setDensity(1.0)
            .setActiveEvents(RAPIER.ActiveEvents.CONTACT_EVENTS);
        const collider = world.createCollider(colliderDesc, body);
        
        // Create visual tetrahedron
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
    
    // Function to create a wavy tube
    function createWavyTube(x, y, z, color = null) {
        if (!color) {
            color = Math.random() * 0xffffff;
        }
        
        // Create physics body
        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(x, y, z);
        const body = world.createRigidBody(bodyDesc);
        
        body.setLinearDamping(0.3);
        body.setAngularDamping(0.5);
        
        // Create capsule collider (cylinder with rounded ends for tube)
        const colliderDesc = RAPIER.ColliderDesc.capsule(0.5, 0.3)
            .setRestitution(0.85)
            .setFriction(0.5)
            .setDensity(1.0)
            .setActiveEvents(RAPIER.ActiveEvents.CONTACT_EVENTS);
        const collider = world.createCollider(colliderDesc, body);
        
        // Create wavy tube visual using a custom curve
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
    
    // Create initial cubes (none by default, user adds them)
    // Optionally add a starting cube
    // createCube(0, 5, 0, 0x00ff00);
    
    
    // Button to add new cubes
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
    
    // Button to add new spheres
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
    
    // Button to add new triangles
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
    
    // Button to add new wavy tubes
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

    // Gravity Gun toggle
    const gravityGunButton = document.getElementById('gravityGun');
    const updateGravityGunButton = () => {
        gravityGunButton.textContent = gravityGunEnabled ? 'Gravity Gun: On' : 'Gravity Gun: Off';
    };

    const deactivateGravityGun = () => {
        gravityGunActive = false;
        // Re-enable camera controls when gravity gun disengages
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
    
    // Button to reset all shapes
    const resetCubesButton = document.getElementById('resetCubes');
    const resetCubesHandler = () => {
        // Stop any ongoing drag operation
        if (isDragging) {
            isDragging = false;
            draggedCube = null;
            controls.enabled = true;
        }

        // Turn off gravity gun so shapes release normally
        deactivateGravityGun();

        if (allCubes.length === 0) return;

        // Blast all shapes outward/upward before clearing
        const blastStrength = 35;
        const upwardBoost = 12;

        for (const shape of allCubes) {
            const pos = shape.body.translation();
            const dir = new THREE.Vector3(pos.x, pos.y, pos.z);

            // Add a bit of randomness so the blast looks organic
            dir.add(new THREE.Vector3(
                (Math.random() - 0.5) * 0.6,
                0.6,
                (Math.random() - 0.5) * 0.6
            ));

            if (dir.lengthSq() < 0.001) {
                dir.set(0, 1, 0); // fallback direction
            }

            dir.normalize();
            dir.multiplyScalar(blastStrength);
            dir.y += upwardBoost;

            shape.body.applyImpulse({ x: dir.x, y: dir.y, z: dir.z }, true);
        }

        // Give a brief moment for the blast to show, then clear everything
        setTimeout(() => {
            while (allCubes.length > 0) {
                const shape = allCubes.pop();

                // Remove physics body from world
                world.removeRigidBody(shape.body);

                // Remove mesh from scene
                scene.remove(shape.mesh);

                // Dispose of geometry and material to free memory
                shape.mesh.geometry.dispose();
                shape.mesh.material.dispose();

                // Remove collider mapping
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
    
    // Raycaster for mouse picking
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    
    // Dragging state
    let isDragging = false;
    let draggedCube = null; // Which cube is being dragged
    let dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    let dragPoint = new THREE.Vector3();
    let lastDragPoint = new THREE.Vector3();
    let dragVelocity = new THREE.Vector3();
    let lastTime = Date.now();
    let previousPosition = new THREE.Vector3();
    let dragHoldTimer = null;
    let pendingDragShape = null;
    let pendingDragHit = null;
    const dragHoldDelay = 140; // ms before a touch becomes a drag
    const dragMoveTolerance = 12; // px movement to cancel pending drag
    const touchStartPixel = new THREE.Vector2();
    
    // Mouse event handlers
    function onMouseDown(event) {
        // Only respond to left mouse button (button 0)
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

            // Cancel any dragging when the gravity gun engages and freeze camera orbit
            isDragging = false;
            draggedCube = null;
            controls.enabled = false;

            for (let i = 0; i < allCubes.length; i++) {
                const shape = allCubes[i];
                const pos = shape.body.translation();
                const offset = new THREE.Vector3(pos.x - gravityGunAnchor.x, pos.y - gravityGunAnchor.y, pos.z - gravityGunAnchor.z);
                const planarDistSq = offset.x * offset.x + offset.z * offset.z;
                const withinRange = planarDistSq <= gravityGunRange * gravityGunRange;
                // Seed only the phase; other orbit params are fixed in the loop
                shape.orbitPhase = Math.random() * Math.PI * 2;
                // Alternate orbit direction every three shapes
                shape.orbitDirection = (Math.floor(i / 3) % 2 === 0) ? 1 : -1;
                shape.inGravityOrbit = withinRange;
                shape.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
                shape.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
            }
            return;
        }

        // Check all cubes for intersection
        const allMeshes = allCubes.map(cube => cube.mesh);
        const intersects = raycaster.intersectObjects(allMeshes);

        if (intersects.length > 0) {
            // Find which cube was clicked
            const clickedMesh = intersects[0].object;
            draggedCube = allCubes.find(cube => cube.mesh === clickedMesh);

            if (draggedCube) {
                isDragging = true;
                
                // Disable orbit controls while dragging
                controls.enabled = false;
                
                // Set up the drag plane perpendicular to camera
                const cameraDirection = new THREE.Vector3();
                camera.getWorldDirection(cameraDirection);
                dragPlane.setFromNormalAndCoplanarPoint(
                    cameraDirection,
                    intersects[0].point
                );
                
                // Store initial drag point
                raycaster.ray.intersectPlane(dragPlane, lastDragPoint);
                dragPoint.copy(lastDragPoint);
                lastTime = Date.now();
                
                // Store previous position
                const pos = draggedCube.body.translation();
                previousPosition.set(pos.x, pos.y, pos.z);
            }
        }
    }

    function startTouchDrag(shape, hitPoint) {
        draggedCube = shape;
        isDragging = true;

        // Disable orbit controls while dragging a shape
        controls.enabled = false;

        // Set up the drag plane perpendicular to camera
        const cameraDirection = new THREE.Vector3();
        camera.getWorldDirection(cameraDirection);
        dragPlane.setFromNormalAndCoplanarPoint(
            cameraDirection,
            hitPoint
        );

        // Store initial drag point
        raycaster.ray.intersectPlane(dragPlane, lastDragPoint);
        dragPoint.copy(lastDragPoint);
        lastTime = Date.now();

        // Store previous position
        const pos = draggedCube.body.translation();
        previousPosition.set(pos.x, pos.y, pos.z);
    }
    
    function onMouseMove(event) {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        
        // If gravity gun is active, move anchor with cursor and skip dragging logic
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
        
        // Get intersection with drag plane
        if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
            const currentTime = Date.now();
            const deltaTime = (currentTime - lastTime) / 1000;
            
            if (deltaTime > 0) {
                // Calculate velocity for throwing
                dragVelocity.subVectors(dragPoint, lastDragPoint).divideScalar(deltaTime);
                lastDragPoint.copy(dragPoint);
                lastTime = currentTime;
            }
        }
    }
    
    function onMouseUp(event) {
        // Only respond to left mouse button (button 0)
        if (event.button !== 0) return;
        
        // Release gravity gun engagement on mouse up
        if (gravityGunActive) {
            deactivateGravityGun();
        }

        if (isDragging && draggedCube) {
            isDragging = false;
            
            // Re-enable orbit controls
            controls.enabled = true;
            
            // Apply throw velocity (capped for stability)
            const maxVelocity = 20;
            dragVelocity.clampLength(0, maxVelocity);
            draggedCube.body.setLinvel({ x: dragVelocity.x, y: dragVelocity.y, z: dragVelocity.z }, true);
            
            // Reset dragged cube reference
            draggedCube = null;
            
            // Reset velocity tracking
            dragVelocity.set(0, 0, 0);
        }
    }
    
    // Add event listeners
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    
    // Touch event handlers for mobile
    function onTouchStart(event) {
        // Let OrbitControls handle multi-touch (pinch/pan)
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
        
        // Check all meshes for intersection
        const allMeshes = allCubes.map(cube => cube.mesh);
        const intersects = raycaster.intersectObjects(allMeshes);
        
        // For mobile, require a short hold before starting a drag so single-touch orbit still works
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
            // No hit: keep controls active for orbit
            controls.enabled = true;
            isDragging = false;
            draggedCube = null;
        }
    }
    
    function onTouchMove(event) {
        if (event.touches.length !== 1) return;

        // Only block default when we're actively dragging or using gravity gun; otherwise let OrbitControls work
        const shouldBlockDefault = gravityGunActive || isDragging || pendingDragShape;
        if (shouldBlockDefault) {
            event.preventDefault();
        }

        const touch = event.touches[0];
        mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;
        
        // If gravity gun is active, move anchor with touch and skip dragging logic
        if (gravityGunActive) {
            raycaster.setFromCamera(mouse, camera);
            const hit = new THREE.Vector3();
            if (raycaster.ray.intersectPlane(groundPlane, hit)) {
                gravityGunAnchor.copy(hit);
            }
            return;
        }

        // Cancel pending drag if user moves finger significantly (assume they want to orbit)
        if (pendingDragShape && dragHoldTimer) {
            const dx = touch.clientX - touchStartPixel.x;
            const dy = touch.clientY - touchStartPixel.y;
            if (Math.hypot(dx, dy) > dragMoveTolerance) {
                clearTimeout(dragHoldTimer);
                dragHoldTimer = null;
                pendingDragShape = null;
                pendingDragHit = null;
                // keep controls enabled for orbit
            }
        }

        if (!isDragging) return;
        
        raycaster.setFromCamera(mouse, camera);
        
        // Get intersection with drag plane
        if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
            const currentTime = Date.now();
            const deltaTime = (currentTime - lastTime) / 1000;
            
            if (deltaTime > 0) {
                // Calculate velocity for throwing
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

        // Cancel pending drag hold if it hasn't started
        if (dragHoldTimer) {
            clearTimeout(dragHoldTimer);
            dragHoldTimer = null;
        }
        pendingDragShape = null;
        pendingDragHit = null;

        if (!isDragging || !draggedCube) return;
        
        event.preventDefault();
        
        isDragging = false;
        
        // Re-enable orbit controls
        controls.enabled = true;
        
        // Apply throw velocity (capped for stability)
        const maxVelocity = 20;
        dragVelocity.clampLength(0, maxVelocity);
        draggedCube.body.setLinvel({ x: dragVelocity.x, y: dragVelocity.y, z: dragVelocity.z }, true);
        
        // Reset dragged cube reference
        draggedCube = null;
        
        // Reset velocity tracking
        dragVelocity.set(0, 0, 0);
    }
    
    // Add touch event listeners for mobile support
    window.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: false });
    window.addEventListener('touchcancel', onTouchEnd, { passive: false });
    
    // Handle window resize
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
    
    // Get the position display element
    const positionElement = document.getElementById('position');

    // Game loop
    let gameLoop = () => {
        // Always step the simulation (even while dragging for physics interactions)
        world.step();
        
        // Update orbit controls
        controls.update();

        const gravityGunTime = gravityGunActive ? (performance.now() - gravityGunStartTime) / 1000 : 0;
        if (gravityGunActive) {
            for (const shape of allCubes) {
                // Skip shapes outside the pull radius
                const pos = shape.body.translation();
                const dxAnchor = pos.x - gravityGunAnchor.x;
                const dzAnchor = pos.z - gravityGunAnchor.z;
                const planarDistSqAnchor = dxAnchor * dxAnchor + dzAnchor * dzAnchor;
                if (planarDistSqAnchor > gravityGunRange * gravityGunRange) {
                    shape.inGravityOrbit = false;
                    continue;
                }
                shape.inGravityOrbit = true;

                // Stable, elevated orbit parameters
                const radius = 1.35; // larger orbit away from cursor
                const speed = 0.28;
                const heightOsc = 0.25;
                const baseLift = 1.6; // base elevation above anchor
                const direction = shape.orbitDirection || 1;
                const angle = gravityGunTime * speed * Math.PI * 2 * direction + (shape.orbitPhase || 0);

                // Compute orbit on a slightly tilted plane
                const projectedRadius = radius * Math.cos(gravityGunTilt);
                const tiltLift = radius * Math.sin(gravityGunTilt);

                const targetX = gravityGunAnchor.x + Math.cos(angle) * projectedRadius;
                const targetZ = gravityGunAnchor.z + Math.sin(angle) * projectedRadius;
                const yRaw = gravityGunAnchor.y + baseLift + tiltLift + Math.sin(gravityGunTime * 2 + angle) * heightOsc;

                // Enforce minimum height above ground by radius + margin
                const shapeRadius = 0.55; // approximate half-size for all shapes
                const targetY = Math.max(shapeRadius + 0.25, yRaw);

                // Steer bodies toward the orbit path so they still collide
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
        
        // If dragging, apply force to move cube toward drag point
        if (isDragging && draggedCube) {
            const currentPos = draggedCube.body.translation();
            
            // Calculate desired velocity toward drag point
            const targetVelocity = new THREE.Vector3(
                dragPoint.x - currentPos.x,
                dragPoint.y - currentPos.y,
                dragPoint.z - currentPos.z
            );
            
            // Scale velocity for responsive dragging (reduced from 10 to 5 for slower movement)
            targetVelocity.multiplyScalar(5);
            
            // Apply squish based on drag velocity
            const dragSpeed = targetVelocity.length();
            if (dragSpeed > 0.5) {
                const dragDir = targetVelocity.clone().normalize();
                const squishAmount = Math.min(dragSpeed * 0.08, 0.35);
                
                // Stretch in the direction of movement
                draggedCube.targetSquishScale.set(1, 1, 1);
                
                if (Math.abs(dragDir.y) > 0.5) {
                    // Vertical drag - stretch Y, compress XZ
                    draggedCube.targetSquishScale.y = 1 + squishAmount;
                    draggedCube.targetSquishScale.x = 1 - squishAmount * 0.4;
                    draggedCube.targetSquishScale.z = 1 - squishAmount * 0.4;
                } else if (Math.abs(dragDir.x) > Math.abs(dragDir.z)) {
                    // X-axis drag - stretch X, compress YZ
                    draggedCube.targetSquishScale.x = 1 + squishAmount;
                    draggedCube.targetSquishScale.y = 1 - squishAmount * 0.4;
                    draggedCube.targetSquishScale.z = 1 - squishAmount * 0.4;
                } else {
                    // Z-axis drag - stretch Z, compress XY
                    draggedCube.targetSquishScale.z = 1 + squishAmount;
                    draggedCube.targetSquishScale.x = 1 - squishAmount * 0.4;
                    draggedCube.targetSquishScale.y = 1 - squishAmount * 0.4;
                }
            }
            
            // Apply velocity
            draggedCube.body.setLinvel({ 
                x: targetVelocity.x, 
                y: targetVelocity.y, 
                z: targetVelocity.z 
            }, true);
            
            // Dampen rotation while dragging for better control
            draggedCube.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }

        // Remove shapes that fall out of bounds (void cleanup)
        for (let i = allCubes.length - 1; i >= 0; i--) {
            const cubeData = allCubes[i];
            const pos = cubeData.body.translation();
            if (pos.y < -25) {
                // Remove physics body and mesh
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

        // Update all remaining cubes
        for (let i = 0; i < allCubes.length; i++) {
            const cubeData = allCubes[i];
            const pos = cubeData.body.translation();
            const rot = cubeData.body.rotation();
            const vel = cubeData.body.linvel();
            
            // Update position and rotation
            cubeData.mesh.position.set(pos.x, pos.y, pos.z);
            cubeData.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
            
            // Calculate velocity change (impact detection)
            const currentVel = new THREE.Vector3(vel.x, vel.y, vel.z);
            const velocityChange = new THREE.Vector3().subVectors(currentVel, cubeData.lastVelocity);
            const impactMagnitude = velocityChange.length();
            
            // If there's an impact, squish the cube (lowered threshold for more sensitivity)
            if (impactMagnitude > 0.2) {
                // Calculate squish direction based on velocity change
                const squishDir = velocityChange.normalize();
                
                // Squish in the direction of impact (increased for more squish)
                const squishAmount = Math.min(impactMagnitude * 0.25, 0.6);
                
                cubeData.targetSquishScale.set(1, 1, 1);
                
                // Compress in the direction of impact
                if (Math.abs(squishDir.y) > 0.5) {
                    // Vertical impact - squish Y, expand XZ
                    cubeData.targetSquishScale.y = 1 - squishAmount;
                    cubeData.targetSquishScale.x = 1 + squishAmount * 0.5;
                    cubeData.targetSquishScale.z = 1 + squishAmount * 0.5;
                } else if (Math.abs(squishDir.x) > Math.abs(squishDir.z)) {
                    // X-axis impact
                    cubeData.targetSquishScale.x = 1 - squishAmount;
                    cubeData.targetSquishScale.y = 1 + squishAmount * 0.5;
                    cubeData.targetSquishScale.z = 1 + squishAmount * 0.5;
                } else {
                    // Z-axis impact
                    cubeData.targetSquishScale.z = 1 - squishAmount;
                    cubeData.targetSquishScale.x = 1 + squishAmount * 0.5;
                    cubeData.targetSquishScale.y = 1 + squishAmount * 0.5;
                }
            }

            // Play impact sound on significant hits (cooldown to avoid spam)
            if (impactMagnitude > 0.35) {
                const now = performance.now();
                if (now - cubeData.lastImpactSoundTime > 180) {
                    playImpactSound();
                    cubeData.lastImpactSoundTime = now;
                }
            }
            
            // Smoothly interpolate back to original shape
            cubeData.squishScale.lerp(cubeData.targetSquishScale, 0.3);
            cubeData.targetSquishScale.lerp(new THREE.Vector3(1, 1, 1), 0.05);
            
            // Apply squish scale to mesh
            cubeData.mesh.scale.copy(cubeData.squishScale);
            
            // Store velocity for next frame
            cubeData.lastVelocity.copy(currentVel);
        }
        
        // Update the position display
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

        // Render the scene
        renderer.render(scene, camera);
        
        requestAnimationFrame(gameLoop);
    };

    gameLoop();
});