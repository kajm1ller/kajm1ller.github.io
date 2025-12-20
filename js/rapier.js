// rapier.js
// External module containing the Rapier3D demo moved out of index.html.

// The script runs on module load. It dynamically imports the package and
// starts a small simulation loop that logs the dynamic body's position.

import('@dimforge/rapier3d').then(RAPIER => {
    // Use the RAPIER module here.
    let gravity = { x: 0.0, y: -9.81, z: 0.0 };
    let world = new RAPIER.World(gravity);

    // Create the ground
    let groundColliderDesc = RAPIER.ColliderDesc.cuboid(10.0, 0.1, 10.0);
    world.createCollider(groundColliderDesc);

    // Create a dynamic rigid-body.
    let rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0.0, 1.0, 0.0);
    let rigidBody = world.createRigidBody(rigidBodyDesc);

    // Create a cuboid collider attached to the dynamic rigidBody.
    let colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5);
    let collider = world.createCollider(colliderDesc, rigidBody);

    // Game loop. Replace by your own game loop system.
    let gameLoop = () => {
        // Step the simulation forward.  
        world.step();

        // Get and print the rigid-body's position.
        let position = rigidBody.translation();
        console.log("Rigid-body position: ", position.x, position.y);

        setTimeout(gameLoop, 16);
    };

    gameLoop();
}).catch(err => {
    console.error('Failed to import Rapier3D:', err);
});

// Notes:
// - This uses a bare specifier import('@dimforge/rapier3d'). In a browser
//   environment that doesn't resolve bare specifiers, you'll need to either:
//     * Serve the page through a bundler/dev server that resolves node_modules,
//     * Or replace the import with an ESM CDN URL (jsDelivr/unpkg) that provides
//       an ESM build of Rapier.
// - Keep the script as type="module" in index.html so this file runs as a
//   module.
