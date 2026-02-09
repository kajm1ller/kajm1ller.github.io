import RAPIER from 'https://cdn.skypack.dev/@dimforge/rapier3d-compat';
import * as THREE from 'https://cdn.skypack.dev/three@0.132.2';
import { OrbitControls } from 'https://cdn.skypack.dev/three@0.132.2/examples/jsm/controls/OrbitControls.js';
import { PointerLockControls } from 'https://cdn.skypack.dev/three@0.132.2/examples/jsm/controls/PointerLockControls.js';

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
    
    // Add OrbitControls for camera rotation with middle mouse button
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; // Smooth camera movement
    controls.dampingFactor = 0.05;
    controls.mouseButtons = {
        LEFT: null, // Disable left button for orbit (we use it for dragging)
        MIDDLE: THREE.MOUSE.ROTATE, // Middle button rotates camera
        RIGHT: THREE.MOUSE.PAN // Right button pans camera
    };
    controls.target.set(0, 1, 0); // Look at center of action
    
    // Add PointerLockControls for first person mode
    const pointerLockControls = new PointerLockControls(camera, renderer.domElement);
    
    // Camera mode state
    let isFirstPersonMode = false;
    let firstPersonVelocity = new THREE.Vector3();
    let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
    
    // First person camera height
    const firstPersonHeight = 1.7;
    
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

    // Create the ground (physics) - larger for walking around
    let groundColliderDesc = RAPIER.ColliderDesc.cuboid(25.0, 0.1, 25.0);
    world.createCollider(groundColliderDesc);
    
    // Create the ground (visual)
    const groundGeometry = new THREE.BoxGeometry(50, 0.2, 50);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x2d5016 }); // Grass green
    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);
    
    // Create sidewalks (visual and physics)
    const sidewalkMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 }); // Gray
    const sidewalks = [];
    
    // Create a grid of sidewalks
    const sidewalkPositions = [
        // Horizontal sidewalks
        { x: 0, z: -8, width: 40, depth: 2 },
        { x: 0, z: 0, width: 40, depth: 2 },
        { x: 0, z: 8, width: 40, depth: 2 },
        // Vertical sidewalks
        { x: -10, z: 0, width: 2, depth: 30 },
        { x: 0, z: 0, width: 2, depth: 30 },
        { x: 10, z: 0, width: 2, depth: 30 }
    ];
    
    sidewalkPositions.forEach(pos => {
        const sidewalkGeometry = new THREE.BoxGeometry(pos.width, 0.3, pos.depth);
        const sidewalkMesh = new THREE.Mesh(sidewalkGeometry, sidewalkMaterial);
        sidewalkMesh.position.set(pos.x, 0.15, pos.z);
        sidewalkMesh.receiveShadow = true;
        sidewalkMesh.castShadow = true;
        scene.add(sidewalkMesh);
        sidewalks.push({ x: pos.x, z: pos.z, width: pos.width, depth: pos.depth });
    });

    // Array to store all draggable cubes
    const allCubes = [];
    
    // Pedestrian system
    const pedestrians = [];
    
    // Function to check if a position is on a sidewalk
    function isOnSidewalk(x, z) {
        for (const sidewalk of sidewalks) {
            const halfWidth = sidewalk.width / 2;
            const halfDepth = sidewalk.depth / 2;
            if (Math.abs(x - sidewalk.x) < halfWidth && Math.abs(z - sidewalk.z) < halfDepth) {
                return true;
            }
        }
        return false;
    }
    
    // Function to get a random position on a sidewalk
    function getRandomSidewalkPosition() {
        const sidewalk = sidewalks[Math.floor(Math.random() * sidewalks.length)];
        const x = sidewalk.x + (Math.random() - 0.5) * (sidewalk.width - 1);
        const z = sidewalk.z + (Math.random() - 0.5) * (sidewalk.depth - 1);
        return { x, z };
    }
    
    // Function to create a pedestrian
    function createPedestrian() {
        const pos = getRandomSidewalkPosition();
        
        // Create a simple person shape (body + head)
        const bodyGeometry = new THREE.CylinderGeometry(0.2, 0.25, 0.8, 8);
        const bodyMaterial = new THREE.MeshStandardMaterial({ 
            color: Math.random() * 0xffffff 
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 0.4;
        body.castShadow = true;
        
        const headGeometry = new THREE.SphereGeometry(0.15, 8, 8);
        const headMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xffdbac // Skin tone
        });
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.position.y = 0.95;
        head.castShadow = true;
        
        // Group them together
        const pedestrianGroup = new THREE.Group();
        pedestrianGroup.add(body);
        pedestrianGroup.add(head);
        pedestrianGroup.position.set(pos.x, 0, pos.z);
        scene.add(pedestrianGroup);
        
        // Set initial movement direction along the sidewalk
        const angle = Math.random() * Math.PI * 2;
        
        pedestrians.push({
            group: pedestrianGroup,
            velocity: new THREE.Vector2(Math.cos(angle), Math.sin(angle)),
            speed: 0.5 + Math.random() * 0.5,
            timeUntilDirectionChange: 2 + Math.random() * 3
        });
    }
    
    // Create initial pedestrians
    for (let i = 0; i < 8; i++) {
        createPedestrian();
    }
    
    // Function to create a new cube
    function createCube(x, y, z, color = null) {
        // Random color if not specified
        if (!color) {
            color = Math.random() * 0xffffff;
        }
        
        // Create physics body with squishy properties
        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(x, y, z);
        const body = world.createRigidBody(bodyDesc);
        
        // Make cubes squishy with physics properties
        body.setLinearDamping(2.0);
        body.setAngularDamping(2.0);
        
        // Create collider with squishy material properties
        const colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
            .setRestitution(0.0)  // No bounce
            .setFriction(1.5)      // High friction
            .setDensity(0.1);      // Low density (lighter/softer feel)
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
            lastVelocity: new THREE.Vector3(0, 0, 0)
        };
        allCubes.push(cubeData);
        
        return cubeData;
    }
    
    // Create initial cubes (none by default, user adds them)
    // Optionally add a starting cube
    // createCube(0, 5, 0, 0x00ff00);
    
    
    // Button to add new cubes
    const addCubeButton = document.getElementById('addCube');
    const addCubeHandler = () => {
        // Spawn cube above the center with slight random offset
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
    
    // Button to reset all cubes
    const resetCubesButton = document.getElementById('resetCubes');
    const resetCubesHandler = () => {
        // Stop any ongoing drag operation
        if (isDragging) {
            isDragging = false;
            draggedCube = null;
            controls.enabled = true;
        }
        
        // Remove all cubes
        while (allCubes.length > 0) {
            const cube = allCubes.pop();
            
            // Remove physics body from world
            world.removeRigidBody(cube.body);
            
            // Remove mesh from scene
            scene.remove(cube.mesh);
            
            // Dispose of geometry and material to free memory
            cube.mesh.geometry.dispose();
            cube.mesh.material.dispose();
        }
    };
    resetCubesButton.addEventListener('click', resetCubesHandler);
    resetCubesButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        resetCubesHandler();
    });
    
    // Button to toggle first person mode
    const toggleFPButton = document.getElementById('toggleFirstPerson');
    if (toggleFPButton) {
        const toggleFPHandler = () => {
            isFirstPersonMode = !isFirstPersonMode;
            
            if (isFirstPersonMode) {
                // Switch to first person
                controls.enabled = false;
                
                // Position camera at a reasonable first person position
                camera.position.set(0, firstPersonHeight, 5);
                camera.lookAt(0, firstPersonHeight, 0);
                
                // On mobile, we can't use pointer lock, so we'll use touch controls
                const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
                
                if (!isMobile) {
                    // Desktop - use pointer lock for mouse look
                    pointerLockControls.lock();
                    
                    // Handle pointer lock events
                    pointerLockControls.addEventListener('unlock', () => {
                        isFirstPersonMode = false;
                        controls.enabled = true;
                        toggleFPButton.textContent = 'First Person Mode';
                    });
                } else {
                    // Mobile - don't use pointer lock, use touch/gyro instead
                    // The black screen issue was caused by pointer lock not working on mobile
                    // We'll handle this without pointer lock
                }
                
                toggleFPButton.textContent = 'Exit First Person';
            } else {
                // Switch back to orbit
                if (pointerLockControls.isLocked) {
                    pointerLockControls.unlock();
                }
                controls.enabled = true;
                
                // Reset camera to orbit position
                camera.position.set(5, 5, 5);
                camera.lookAt(0, 1, 0);
                
                toggleFPButton.textContent = 'First Person Mode';
            }
        };
        
        toggleFPButton.addEventListener('click', toggleFPHandler);
        toggleFPButton.addEventListener('touchend', (e) => {
            e.preventDefault();
            toggleFPHandler();
        });
    }
    
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
    let lastTouchX = 0;
    let lastTouchY = 0;
    let touchMoving = false;
    
    function onTouchStart(event) {
        if (event.touches.length === 1) {
            const touchEvent = event.touches[0];
            
            // If in first person mode, track for camera rotation
            if (isFirstPersonMode) {
                lastTouchX = touchEvent.clientX;
                lastTouchY = touchEvent.clientY;
                touchMoving = true;
                event.preventDefault();
                return;
            }
            
            // Otherwise handle cube dragging
            event.preventDefault();
            
            mouse.x = (touchEvent.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(touchEvent.clientY / window.innerHeight) * 2 + 1;
            
            raycaster.setFromCamera(mouse, camera);
            
            // Check all cubes for intersection
            const allMeshes = allCubes.map(cube => cube.mesh);
            const intersects = raycaster.intersectObjects(allMeshes);
            
            if (intersects.length > 0) {
                // Find which cube was touched
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
    }
    
    function onTouchMove(event) {
        if (event.touches.length === 1) {
            const touchEvent = event.touches[0];
            
            // If in first person mode, rotate camera
            if (isFirstPersonMode && touchMoving) {
                event.preventDefault();
                
                const deltaX = touchEvent.clientX - lastTouchX;
                const deltaY = touchEvent.clientY - lastTouchY;
                
                lastTouchX = touchEvent.clientX;
                lastTouchY = touchEvent.clientY;
                
                // Rotate camera based on touch movement
                const euler = new THREE.Euler(0, 0, 0, 'YXZ');
                euler.setFromQuaternion(camera.quaternion);
                
                euler.y -= deltaX * 0.002; // Horizontal rotation
                euler.x -= deltaY * 0.002; // Vertical rotation
                
                // Clamp vertical rotation
                euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.x));
                
                camera.quaternion.setFromEuler(euler);
                return;
            }
            
            // Otherwise handle cube dragging
            if (!isDragging || event.touches.length !== 1) return;
        
        event.preventDefault();
        
        mouse.x = (touchEvent.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(touchEvent.clientY / window.innerHeight) * 2 + 1;
        
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
    }
    
    function onTouchEnd(event) {
        // Reset touch moving flag
        touchMoving = false;
        
        if (isDragging && draggedCube) {
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
    }
    
    // Add touch event listeners for mobile support
    window.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: false });
    window.addEventListener('touchcancel', onTouchEnd, { passive: false });
    
    // Keyboard controls for first person mode
    const onKeyDown = (event) => {
        if (!isFirstPersonMode) return;
        
        switch (event.code) {
            case 'ArrowUp':
            case 'KeyW':
                moveForward = true;
                break;
            case 'ArrowLeft':
            case 'KeyA':
                moveLeft = true;
                break;
            case 'ArrowDown':
            case 'KeyS':
                moveBackward = true;
                break;
            case 'ArrowRight':
            case 'KeyD':
                moveRight = true;
                break;
        }
    };
    
    const onKeyUp = (event) => {
        switch (event.code) {
            case 'ArrowUp':
            case 'KeyW':
                moveForward = false;
                break;
            case 'ArrowLeft':
            case 'KeyA':
                moveLeft = false;
                break;
            case 'ArrowDown':
            case 'KeyS':
                moveBackward = false;
                break;
            case 'ArrowRight':
            case 'KeyD':
                moveRight = false;
                break;
        }
    };
    
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    
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
        
        // Update controls based on camera mode
        if (isFirstPersonMode) {
            // First person movement
            const delta = 0.1; // Time delta approximation
            firstPersonVelocity.set(0, 0, 0);
            
            const direction = new THREE.Vector3();
            const right = new THREE.Vector3();
            
            camera.getWorldDirection(direction);
            right.crossVectors(camera.up, direction).normalize();
            
            if (moveForward) firstPersonVelocity.add(direction.multiplyScalar(-delta * 5));
            if (moveBackward) firstPersonVelocity.add(direction.multiplyScalar(delta * 5));
            if (moveLeft) firstPersonVelocity.add(right.multiplyScalar(-delta * 5));
            if (moveRight) firstPersonVelocity.add(right.multiplyScalar(delta * 5));
            
            // Apply movement
            camera.position.add(firstPersonVelocity);
            camera.position.y = firstPersonHeight; // Keep at eye level
        } else {
            // Update orbit controls
            controls.update();
        }
        
        // Update pedestrians
        for (const ped of pedestrians) {
            // Update timer
            ped.timeUntilDirectionChange -= 0.016; // Approximately 60 FPS
            
            if (ped.timeUntilDirectionChange <= 0) {
                // Change direction randomly but stay on sidewalks
                const angle = Math.random() * Math.PI * 2;
                ped.velocity.set(Math.cos(angle), Math.sin(angle));
                ped.timeUntilDirectionChange = 2 + Math.random() * 3;
            }
            
            // Calculate new position
            const newX = ped.group.position.x + ped.velocity.x * ped.speed * 0.016;
            const newZ = ped.group.position.z + ped.velocity.y * ped.speed * 0.016;
            
            // Only move if staying on sidewalk
            if (isOnSidewalk(newX, newZ)) {
                ped.group.position.x = newX;
                ped.group.position.z = newZ;
                
                // Rotate to face direction of movement
                const angle = Math.atan2(ped.velocity.x, ped.velocity.y);
                ped.group.rotation.y = angle;
            } else {
                // Hit edge of sidewalk, turn around
                ped.velocity.multiplyScalar(-1);
                ped.timeUntilDirectionChange = 1 + Math.random() * 2;
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
        const pedCount = pedestrians.length;
        const mode = isFirstPersonMode ? 'First Person' : 'Orbit';
        const status = isDragging ? ' [GRABBED]' : '';
        positionElement.textContent = `Cubes: ${cubeCount} | Pedestrians: ${pedCount} | Mode: ${mode}${status}`;

        // Render the scene
        renderer.render(scene, camera);
        
        requestAnimationFrame(gameLoop);
    };

    gameLoop();
});