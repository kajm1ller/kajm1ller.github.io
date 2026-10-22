import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Vehicle } from '../../js/game/vehicle.js';
import { SpatialGrid } from '../../js/game/spatialGrid.js';
import { CONFIG } from '../../js/game/config.js';

test('Vehicle: Initialization pose and bounding circles', () => {
    const v = new Vehicle('car_test', 10, 20, 0, 0xff0000, true);
    
    assert.equal(v.id, 'car_test');
    assert.equal(v.isPlayer, true);
    
    const pos = v.getPosition();
    assert.equal(pos.x, 10);
    assert.equal(pos.y, 0);
    assert.equal(pos.z, 20);
    
    assert.equal(v.getYaw(), 0);
    assert.equal(v.getSpeed(), 0);
    
    const vel = v.getVelocity();
    assert.equal(vel.x, 0);
    assert.equal(vel.z, 0);
    
    const circles = v.getBoundingCircles();
    assert.equal(circles.length, 3);
    for (const c of circles) {
        assert(Number.isFinite(c.x));
        assert(Number.isFinite(c.z));
        assert.equal(c.radius, 1.10);
    }
});

test('Vehicle: Forward acceleration and speed limits', () => {
    const v = new Vehicle('car_accel', 0, 0, 0);
    
    // Apply full throttle for 60 ticks (1s)
    v.setInputs(1.0, 0, 0, false);
    for (let i = 0; i < 60; i++) {
        v.update(1 / 60);
    }
    
    assert(v.getSpeed() > 5.0, `Speed should exceed 5 m/s, got ${v.getSpeed()}`);
    // Heading 0 faces -Z, so Z should decrease
    const pos = v.getPosition();
    assert(pos.z < -4.0, `Z position should decrease forward, got ${pos.z}`);
    assert(Math.abs(pos.x) < 0.01, `X position should remain straight, got ${pos.x}`);
});

test('Vehicle: Steering changes yaw and trajectory', () => {
    const v = new Vehicle('car_steer', 0, 0, 0);
    
    // Steer left (A) while accelerating
    v.setInputs(1.0, { left: true, right: false }, 0, false);
    for (let i = 0; i < 60; i++) {
        v.update(1 / 60);
    }
    
    // Left turn produces positive yaw delta
    assert(v.getYaw() > 0.05, `Yaw should turn left, got ${v.getYaw()}`);
    const pos = v.getPosition();
    assert(pos.x < -0.1, `X should move toward negative X during left turn, got ${pos.x}`);
});

test('Vehicle: Contradictory inputs handling (W+S, A+D, handbrake)', () => {
    const v = new Vehicle('car_adversarial', 0, 0, 0);
    
    // Contradictory steer cancels out to 0
    v.setInputs(1.0, { left: true, right: true }, 1.0, true);
    for (let i = 0; i < 30; i++) {
        v.update(1 / 60);
    }
    
    const pos = v.getPosition();
    assert(Number.isFinite(pos.x));
    assert(Number.isFinite(pos.y));
    assert(Number.isFinite(pos.z));
    assert(Number.isFinite(v.getYaw()));
    assert(Number.isFinite(v.getSpeed()));
});

test('Vehicle: Static collision and boundary clamping at the map edge (CONFIG.WORLD.SAFE_BOUNDS)', () => {
    const grid = new SpatialGrid(300, 15);
    // Obstacle at (0, -10)
    grid.insertStatic('obs_1', {
        min: { x: -2, y: 0, z: -12 },
        max: { x: 2, y: 4, z: -8 }
    });
    
    const v = new Vehicle('car_collision', 0, -5, 0);
    v.setInputs(1.0, 0, 0, false);
    
    for (let i = 0; i < 120; i++) {
        v.update(1 / 60, grid);
    }
    
    const pos = v.getPosition();
    assert(Number.isFinite(pos.x));
    assert(Number.isFinite(pos.z));
    // Must be pushed back or deflected before obstacle center
    assert(pos.z > -10.5, `Should not penetrate deep into static obstacle: z=${pos.z}`);
    
    // Boundary enforcement test
    const bounds = CONFIG.WORLD.SAFE_BOUNDS;
    v.position.set(bounds.MAX_X + 20, 0, bounds.MAX_Z + 20);
    v.update(1 / 60);
    const clampedPos = v.getPosition();
    assert(clampedPos.x <= bounds.MAX_X, `X clamped: ${clampedPos.x}`);
    assert(clampedPos.z <= bounds.MAX_Z, `Z clamped: ${clampedPos.z}`);
});
