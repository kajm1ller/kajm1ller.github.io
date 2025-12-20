// rapier.js
// External module containing the Rapier3D demo moved out of index.html.

// This module supports both browser and Node.js execution. In browsers we
// import the package by its bare specifier. In Node.js the runtime doesn't
// remap bare specifiers the same way, so we resolve the package path using
// createRequire + require.resolve and import the resulting file:// URL.

(async () => {
    try {
        let RAPIER_MODULE;

        // Detect Node.js vs browser
        const isNode = typeof process !== 'undefined' && !!process.versions && !!process.versions.node;

        if (isNode) {
            // In Node, resolve the package entry to a file path then import via file URL
            const { createRequire } = await import('module');
            const require = createRequire(import.meta.url);
            const pkgPath = require.resolve('@dimforge/rapier3d');
            const { pathToFileURL } = await import('url');
            const pkgUrl = pathToFileURL(pkgPath).href;
            RAPIER_MODULE = await import(pkgUrl);
        } else {
            // Browser: import an ESM build from a CDN so browsers (without import maps)
            // can resolve the module. Pin the version to match the repo dependency.
            // Using unpkg with ?module serves an ESM-compatible entrypoint.
            RAPIER_MODULE = await import('https://unpkg.com/@dimforge/rapier3d@0.19.3?module');
        }

        const RAPIER = RAPIER_MODULE;

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
    } catch (err) {
        console.error('Failed to import Rapier3D:', err);
    }
})();

// Notes:
// - When running in Node.js this file resolves the package path and imports the
//   exact file. Make sure you run Node v16+ (ESM support) and that @dimforge/rapier3d
//   is installed (npm install).
// - In the browser serve the repo over HTTP (e.g. `npm run dev`) so bare imports
//   resolve correctly.
