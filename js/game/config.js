/**
 * js/game/config.js
 * 
 * Central configuration and tuning constants for Kaj Simulator.
 * Provides immutable defaults for world layout, fixed-timestep simulation,
 * 2D spatial hash grid broadphase, player kinematics, and vehicle physics.
 */

export const CONFIG = Object.freeze({
    // World Dimensions & Boundaries
    WORLD: Object.freeze({
        SIZE: 20000,           // Total extent covered by the world (20km x 20km)
        HALF_SIZE: 10000,      // Extent in [-10000, 10000]
        // Edge of the /mapfinal terrain in world space (x: -9974.7 .. 5925.3, z: -8968.0 .. 7472.0), inset by 5m
        SAFE_BOUNDS: Object.freeze({
            MIN_X: -9969,
            MAX_X: 5920,
            MIN_Z: -8963,
            MAX_Z: 7467
        }),
        PLAY_RADIUS: 120       // Active procedural generation radius
    }),

    // Spatial Hash Grid Broadphase
    GRID: Object.freeze({
        CELL_SIZE: 15,           // Cell width/depth in meters
        WORLD_HALF_SIZE: 10000,  // Grid covers [-10000, 10000], the whole /mapfinal map
        COLS: 1334,              // Math.ceil(20000 / 15)
        ROWS: 1334,
        TOTAL_CELLS: 1779556
    }),

    // Fixed Timestep Game Loop
    SIMULATION: Object.freeze({
        FIXED_DELTA: 1 / 60,   // 60Hz fixed physics timestep (~0.0166667s)
        MAX_SUB_STEPS: 5,      // Maximum sub-steps per frame to prevent spiral of death
        FRAME_TIME_CLAMP: 0.1  // Maximum real-time dt per RAF tick (100ms)
    }),

    // Player Configuration
    PLAYER: Object.freeze({
        RADIUS: 0.4,           // Collision cylinder radius (m)
        EYE_HEIGHT: 1.7,       // Camera height above ground (m)
        MOVE_SPEED: 7.2,       // Horizontal walk speed in m/s (0.12 * 60)
        SPRINT_SPEED: 12.0,    // Sprint speed in m/s
        INTERACTION_RADIUS: 3.5 // Maximum distance to board a vehicle
    }),

    // Vehicle Baseline Parameters (for Milestone 2 / 3)
    VEHICLE: Object.freeze({
        LENGTH: 4.5,
        WIDTH: 2.2,
        HEIGHT: 1.4,
        RADIUS: 2.25,          // Bounding circle radius for broadphase
        MAX_SPEED: 25.0,       // Max forward speed in m/s (~90 km/h)
        MAX_REVERSE_SPEED: 8.0,// Max reverse speed in m/s
        ACCEL: 8.0,            // Forward engine acceleration in m/s^2
        BRAKE_DECEL: 14.0,     // Braking deceleration in m/s^2
        ROLLING_FRICTION: 0.5, // Rolling resistance coefficient
        MAX_STEER_ANGLE: 0.55  // Max wheel turn angle in radians (~31.5 deg)
    })
});
