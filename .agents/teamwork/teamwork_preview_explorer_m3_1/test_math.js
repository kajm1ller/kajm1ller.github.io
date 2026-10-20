/**
 * Mathematical & Algorithmic Verification for Pure Pursuit & IDM
 */

function testIDM() {
    const a = 1.5;
    const b = 2.0;
    const T = 1.5;
    const s0 = 2.5;
    const v0 = 14.0;
    const sqrtAB = Math.sqrt(a * b);

    console.log('--- Testing IDM Formulas ---');

    // Case 1: Free road, starting from stop (v = 0)
    {
        const v = 0;
        const freeTerm = 1.0 - Math.pow(v / v0, 4);
        const aCmd = a * freeTerm;
        console.log(`Free road from stop (v=0): aCmd = ${aCmd.toFixed(2)} m/s^2 (expected 1.50)`);
        if (Math.abs(aCmd - 1.5) > 1e-4) throw new Error('Case 1 failed');
    }

    // Case 2: Free road at cruising speed (v = v0)
    {
        const v = v0;
        const freeTerm = 1.0 - Math.pow(v / v0, 4);
        const aCmd = a * freeTerm;
        console.log(`Free road at cruising (v=v0): aCmd = ${aCmd.toFixed(4)} m/s^2 (expected 0.0000)`);
        if (Math.abs(aCmd) > 1e-4) throw new Error('Case 2 failed');
    }

    // Case 3: Steady-state car following at distance s = s*
    {
        const v = 10.0;
        const vLead = 10.0;
        const deltaV = v - vLead; // 0
        const sStar = s0 + v * T + (v * deltaV) / (2 * sqrtAB);
        console.log(`Steady state (v=10, vLead=10): sStar = ${sStar.toFixed(2)}m (expected 2.5 + 15 = 17.5m)`);

        // If distance s is exactly sStar, freeTerm - (sStar/s)^2 = (1 - (10/14)^4) - 1 = -0.26
        const freeTerm = 1.0 - Math.pow(v / v0, 4);
        const followTerm = Math.pow(sStar / sStar, 2);
        const aCmd = a * (freeTerm - followTerm);
        console.log(`At equilibrium gap: aCmd = ${aCmd.toFixed(3)} m/s^2`);
    }

    // Case 4: Approaching a stopped obstacle (v = 12, vLead = 0, deltaV = 12)
    {
        const v = 12.0;
        const vLead = 0;
        const deltaV = v - vLead;
        const sStar = s0 + v * T + (v * deltaV) / (2 * sqrtAB);
        console.log(`Approaching stopped obstacle (v=12): sStar = ${sStar.toFixed(2)}m`);

        // Test at distance s = 50m
        {
            const s = 50.0;
            const freeTerm = 1.0 - Math.pow(v / v0, 4);
            const followTerm = Math.pow(sStar / s, 2);
            const aCmd = a * (freeTerm - followTerm);
            console.log(`  At s = 50m: aCmd = ${aCmd.toFixed(3)} m/s^2 (smooth braking)`);
            if (aCmd >= 0) throw new Error('Should be braking at 50m');
        }

        // Test at distance s = 10m
        {
            const s = 10.0;
            const freeTerm = 1.0 - Math.pow(v / v0, 4);
            const followTerm = Math.pow(sStar / s, 2);
            const aCmd = a * (freeTerm - followTerm);
            console.log(`  At s = 10m: aCmd = ${aCmd.toFixed(3)} m/s^2 (heavy braking)`);
            if (aCmd > -1.0) throw new Error('Should be heavy braking at 10m');
        }

        // Test at distance s = s0 = 2.5m, v = 0.5
        {
            const vLow = 0.5;
            const deltaVLow = 0.5;
            const sStarLow = s0 + vLow * T + (vLow * deltaVLow) / (2 * sqrtAB);
            const s = 2.5;
            const freeTerm = 1.0 - Math.pow(vLow / v0, 4);
            const followTerm = Math.pow(sStarLow / s, 2);
            const aCmd = a * (freeTerm - followTerm);
            console.log(`  At s = 2.5m, v = 0.5: aCmd = ${aCmd.toFixed(3)} m/s^2 (holding stop)`);
        }
    }
}

function testPurePursuit() {
    console.log('\n--- Testing Pure Pursuit Formulas ---');
    const L = 2.8;

    // Lookahead distance formula: L_d = max(4.0, 0.4 * v)
    const getLd = (v) => Math.max(4.0, 0.4 * v);
    console.log(`L_d at v = 0: ${getLd(0)}m (expected 4.0)`);
    console.log(`L_d at v = 10: ${getLd(10)}m (expected 4.0)`);
    console.log(`L_d at v = 15: ${getLd(15)}m (expected 6.0)`);
    console.log(`L_d at v = 25: ${getLd(25)}m (expected 10.0)`);

    // Pure pursuit steering: delta = atan2(2 * L * sin(alpha), L_d)
    // Vehicle facing -Z (yaw = 0).
    // Target straight ahead: alpha = 0 -> delta = 0
    {
        const alpha = 0;
        const L_d = getLd(10);
        const delta = Math.atan2(2 * L * Math.sin(alpha), L_d);
        console.log(`Straight ahead (alpha=0): delta = ${delta.toFixed(4)} rad`);
        if (Math.abs(delta) > 1e-6) throw new Error('Straight ahead failed');
    }

    // Target 30 degrees left (alpha = +PI/6): delta > 0 (counter-clockwise / left steer)
    {
        const alpha = Math.PI / 6;
        const L_d = getLd(10);
        const delta = Math.atan2(2 * L * Math.sin(alpha), L_d);
        console.log(`30 deg left (alpha=+30°): delta = ${delta.toFixed(4)} rad (${(delta * 180 / Math.PI).toFixed(2)}°)`);
        if (delta <= 0) throw new Error('Left steer failed');
    }

    // Target 30 degrees right (alpha = -PI/6): delta < 0 (clockwise / right steer)
    {
        const alpha = -Math.PI / 6;
        const L_d = getLd(10);
        const delta = Math.atan2(2 * L * Math.sin(alpha), L_d);
        console.log(`30 deg right (alpha=-30°): delta = ${delta.toFixed(4)} rad (${(delta * 180 / Math.PI).toFixed(2)}°)`);
        if (delta >= 0) throw new Error('Right steer failed');
    }
}

testIDM();
testPurePursuit();
console.log('\nAll mathematical checks passed successfully!');
