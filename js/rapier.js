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
    document.body.appendChild(renderer.domElement);
    
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
    
    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 5);
    directionalLight.castShadow = true;
    scene.add(directionalLight);
    
    // Create Rapier physics world
    let gravity = { x: 0.0, y: -9.81, z: 0.0 };
    let world = new RAPIER.World(gravity);

    // Create the ground (physics)
    let groundColliderDesc = RAPIER.ColliderDesc.cuboid(10.0, 0.1, 10.0);
    world.createCollider(groundColliderDesc);
    
    // Create the ground (visual)
    const groundGeometry = new THREE.BoxGeometry(20, 0.2, 20);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 });
    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    // Array to store all draggable objects (cubes, spheres, etc.)
    const allCubes = [];
    
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
            .setDensity(1.0);
        world.createCollider(colliderDesc, body);
        
        // Create visual mesh with segments for smooth deformation
        const cubeGeometry = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
        const material = new THREE.MeshStandardMaterial({ color: color });
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
            type: 'cube'
        };
        allCubes.push(cubeData);
        
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
            .setDensity(1.0);
        world.createCollider(colliderDesc, body);
        
        // Create visual mesh
        const sphereGeometry = new THREE.SphereGeometry(radius, 32, 32);
        const material = new THREE.MeshStandardMaterial({ color: color });
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
            type: 'sphere'
        };
        allCubes.push(sphereData);
        
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
            .setDensity(1.0);
        world.createCollider(colliderDesc, body);
        
        // Create visual tetrahedron
        const geometry = new THREE.TetrahedronGeometry(0.7, 0);
        const material = new THREE.MeshStandardMaterial({ color: color });
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
            type: 'triangle'
        };
        allCubes.push(triangleData);
        
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
            .setDensity(1.0);
        world.createCollider(colliderDesc, body);
        
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
            metalness: 0.3,
            roughness: 0.7
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
            type: 'tube'
        };
        allCubes.push(tubeData);
        
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
    
    // Button to reset all shapes
    const resetCubesButton = document.getElementById('resetCubes');
    const resetCubesHandler = () => {
        // Stop any ongoing drag operation
        if (isDragging) {
            isDragging = false;
            draggedCube = null;
            controls.enabled = true;
        }
        
        // Remove all shapes
        while (allCubes.length > 0) {
            const shape = allCubes.pop();
            
            // Remove physics body from world
            world.removeRigidBody(shape.body);
            
            // Remove mesh from scene
            scene.remove(shape.mesh);
            
            // Dispose of geometry and material to free memory
            shape.mesh.geometry.dispose();
            shape.mesh.material.dispose();
        }
    };
    resetCubesButton.addEventListener('click', resetCubesHandler);
    resetCubesButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        resetCubesHandler();
    });
    
    // Raycaster for mouse picking
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    
    // Dragging state
    let isDragging = false;
    let draggedCube = null; // Which cube is being dragged
    let dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    let dragPoint = new THREE.Vector3();
    let lastDragPoint = new THREE.Vector3();
    let dragVelocity = new THREE.Vector3();
    let lastTime = Date.now();
    let previousPosition = new THREE.Vector3();
    
    // Mouse event handlers
    function onMouseDown(event) {
        // Only respond to left mouse button (button 0)
        if (event.button !== 0) return;
        
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        
        raycaster.setFromCamera(mouse, camera);
        
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
    
    function onMouseMove(event) {
        if (!isDragging) return;
        
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        
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
        
        // Check all meshes for intersection
        const allMeshes = allCubes.map(cube => cube.mesh);
        const intersects = raycaster.intersectObjects(allMeshes);
        
        if (intersects.length > 0) {
            // Find which mesh was touched
            const clickedMesh = intersects[0].object;
            draggedCube = allCubes.find(cube => cube.mesh === clickedMesh);
            
            if (draggedCube) {
                event.preventDefault();
                isDragging = true;
                
                // Disable orbit controls while dragging a shape
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
        } else {
            // No hit: keep controls active for orbit
            controls.enabled = true;
            isDragging = false;
            draggedCube = null;
        }
    }
    
    function onTouchMove(event) {
        if (!isDragging || event.touches.length !== 1) return;
        
        event.preventDefault();
        
        const touch = event.touches[0];
        mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;
        
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

        // Update all cubes
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
        const status = isDragging ? ' [GRABBED]' : '';
        positionElement.textContent = `Shapes: ${cubeCount}${status}`;

        // Render the scene
        renderer.render(scene, camera);
        
        requestAnimationFrame(gameLoop);
    };

    gameLoop();
});