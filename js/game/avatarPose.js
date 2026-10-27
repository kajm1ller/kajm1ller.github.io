/**
 * js/game/avatarPose.js
 *
 * Body poses for the jointed people rigs (pedestrians.js buildRig) outside the pedestrian AI: other
 * players walking, aiming and sitting at a table, and everyone riding in cars. Every pose
 * resets the joints it touches first, so call exactly one per rig per frame.
 */

const JOINTS = ['torso', 'neck', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'legL', 'legR', 'kneeL', 'kneeR'];

export function resetRig(rig) {
    rig.body.position.set(0, 0, 0);
    rig.body.rotation.set(0, 0, 0);
    for (const j of JOINTS) rig[j].rotation.set(0, 0, 0);
    rig.shoulderL.rotation.z = 0.06;
    rig.shoulderR.rotation.z = -0.06;
    rig.elbowL.rotation.x = -0.12;
    rig.elbowR.rotation.x = -0.12;
}

/** Arms and legs of someone on foot: `speed` m/s picks walking or running, `phase` is advanced by the caller. */
export function poseWalk(rig, phase, speed) {
    resetRig(rig);
    if (speed < 0.15) return;
    const run = speed > 3.6;
    const s = Math.sin(phase), c = Math.cos(phase);
    const amp = run ? 0.85 : 0.5 * Math.min(1.2, speed / 1.3);
    rig.legL.rotation.x = -s * amp;
    rig.legR.rotation.x = s * amp;
    rig.kneeL.rotation.x = Math.max(0, c) * amp * 1.3 + 0.05;
    rig.kneeR.rotation.x = Math.max(0, -c) * amp * 1.3 + 0.05;
    rig.shoulderL.rotation.x = s * amp * 0.75;
    rig.shoulderR.rotation.x = -s * amp * 0.75;
    rig.elbowL.rotation.x = rig.elbowR.rotation.x = run ? -1.35 : -0.25;
    rig.body.position.y = Math.abs(c) * (run ? 0.06 : 0.03);
    rig.torso.rotation.x = run ? 0.18 : 0.04;
    rig.torso.rotation.y = s * (run ? 0.12 : 0.06);
}

/** Standing with a gun out in front (both hands) looking along `pitch`. */
export function poseAim(rig, pitch = 0) {
    resetRig(rig);
    rig.shoulderR.rotation.set(-1.45 - pitch * 0.5, 0, -0.1);
    rig.elbowR.rotation.x = -0.15;
    rig.shoulderL.rotation.set(-1.3 - pitch * 0.5, 0, 0.35);
    rig.elbowL.rotation.x = -0.9;
    rig.neck.rotation.x = pitch * 0.4;
    rig.torso.rotation.y = -0.15;
    rig.legL.rotation.x = -0.15;
    rig.legR.rotation.x = 0.2;
}

export function poseIdle(rig, t) {
    resetRig(rig);
    rig.torso.rotation.x = Math.sin(t * 1.6) * 0.012;
    rig.shoulderL.rotation.x = Math.sin(t * 1.6) * 0.03;
}

/** Lighting up / taking a hit: one hand to the face. */
export function poseUse(rig, t) {
    resetRig(rig);
    rig.shoulderR.rotation.set(-1.9, 0, -0.2);
    rig.elbowR.rotation.x = -1.5 + Math.sin(t * 6) * 0.05;
    rig.neck.rotation.x = -0.1;
}

/** Drunk: weaving about, swaying over the hips, arms out a little (`speed` 0 stands and sways). */
export function poseStagger(rig, phase, speed, t) {
    poseWalk(rig, phase, Math.max(speed, 0.6) * 0.8);
    const sway = Math.sin(t * 1.3) * 0.16 + Math.sin(t * 2.9) * 0.05;
    rig.body.rotation.z = sway;
    rig.torso.rotation.z = -sway * 0.6;
    rig.torso.rotation.x += 0.08 + Math.sin(t * 0.9) * 0.05;
    rig.neck.rotation.x = 0.25 + Math.sin(t * 1.1) * 0.12;
    rig.shoulderL.rotation.z = 0.35 + sway * 0.5;
    rig.shoulderR.rotation.z = -0.35 + sway * 0.5;
    if (speed < 0.3) { rig.legL.rotation.x = rig.legR.rotation.x = 0; rig.kneeL.rotation.x = rig.kneeR.rotation.x = 0.05; }
}

/**
 * Something carried in the right hand while walking or standing: a gun held low and ready
 * ('gun', both hands for a long gun with `long`), a drink or a smoke up in front ('item').
 * Applied on top of the walk / idle pose. `run` (with the stride `phase`): a long gun carried across
 * the chest, a pistol pumped low in the bent arm, bouncing with the steps.
 */
export function poseHold(rig, kind, long = false, run = false, phase = 0) {
    if (kind === 'gun' && run) {
        const s = Math.sin(phase), b = Math.abs(Math.cos(phase));
        if (long) {
            rig.shoulderR.rotation.set(-0.75 - b * 0.12, 0, 0.45);
            rig.elbowR.rotation.x = -1.45;
            rig.shoulderL.rotation.set(-1.05 - b * 0.12, 0, -0.55);
            rig.elbowL.rotation.x = -1.2;
            rig.torso.rotation.y = s * 0.05;
        } else {
            rig.shoulderR.rotation.set(-0.45 - s * 0.35, 0, -0.1);
            rig.elbowR.rotation.x = -1.35;
        }
    } else if (kind === 'gun') {
        rig.shoulderR.rotation.set(long ? -0.75 : -0.45, 0, long ? 0.3 : -0.08);
        rig.elbowR.rotation.x = long ? -0.9 : -0.55;
        if (long) { rig.shoulderL.rotation.set(-0.85, 0, 0.45); rig.elbowL.rotation.x = -1.2; }
    } else if (kind === 'item') {
        rig.shoulderR.rotation.set(-0.35, 0, -0.1);
        rig.elbowR.rotation.x = -1.25;
    }
}

/**
 * Sitting with the hips `seatH` above the ground the rig stands on.
 * kind: 'drive' (hands on the wheel), 'ride' (hands in the lap, looking about) or 'table' (leaning on the felt).
 */
export function poseSeated(rig, seatH, scaleY, kind = 'ride', t = 0, look = 0) {
    resetRig(rig);
    rig.body.position.y = (seatH + 0.06) / (scaleY || 1) - 0.92;
    rig.legL.rotation.set(-1.45, 0, 0.06);
    rig.legR.rotation.set(-1.4, 0, -0.06);
    rig.kneeL.rotation.x = 1.4;
    rig.kneeR.rotation.x = 1.3;
    if (kind === 'drive') {
        rig.shoulderL.rotation.set(-1.15, 0, -0.18);
        rig.shoulderR.rotation.set(-1.15, 0, 0.18);
        rig.elbowL.rotation.x = -0.55;
        rig.elbowR.rotation.x = -0.55;
        rig.torso.rotation.x = -0.04;
    } else if (kind === 'table') {
        rig.shoulderL.rotation.x = rig.shoulderR.rotation.x = -0.85;
        rig.elbowL.rotation.x = rig.elbowR.rotation.x = -0.55;
        rig.torso.rotation.x = 0.1;
        rig.neck.rotation.x = 0.3;
    } else {
        rig.shoulderL.rotation.x = -0.4;
        rig.shoulderR.rotation.x = -0.4;
        rig.elbowL.rotation.x = -0.75;
        rig.elbowR.rotation.x = -0.75;
        rig.torso.rotation.x = -0.06;
        rig.neck.rotation.y = look + Math.sin(t * 0.5) * 0.12;
    }
}

/**
 * Fighting someone (a player holding another player or a person): `mode` 'neck' / 'pin' (one arm
 * out, hand at their throat), 'mount' (kneeling astride them), 'drag' (bent over, arms back, walking
 * `speed` m/s); `punch` throws the free fist(s) in turn; `gun` keeps the other hand up with the gun.
 */
export function poseGrabbing(rig, mode, t, phase = 0, speed = 0, punch = false, gun = false) {
    if (mode === 'drag') {
        poseWalk(rig, phase, Math.min(speed, 2));
        rig.torso.rotation.set(0.35, 0, 0);
        rig.shoulderL.rotation.set(0.75, 0, -0.12);
        rig.shoulderR.rotation.set(0.75, 0, 0.12);
        rig.elbowL.rotation.x = rig.elbowR.rotation.x = -0.15;
        rig.neck.rotation.x = -0.25;
        return;
    }
    resetRig(rig);
    const jab = punch ? Math.max(0, Math.sin(t * 9)) : 0;
    const jab2 = punch ? Math.max(0, -Math.sin(t * 9)) : 0;
    if (mode === 'mount') {
        // Knees either side of them, sat up over their chest, fists coming down
        rig.body.position.y = -0.5;
        rig.legL.rotation.set(-1.2, 0, 0.35);
        rig.legR.rotation.set(-1.2, 0, -0.35);
        rig.kneeL.rotation.x = rig.kneeR.rotation.x = 2.3;
        rig.torso.rotation.x = 0.35 + 0.15 * (jab + jab2);
        rig.shoulderL.rotation.set(-1.2 - 0.9 * jab, 0, 0.1);
        rig.shoulderR.rotation.set(-1.2 - 0.9 * jab2, 0, -0.1);
        rig.elbowL.rotation.x = -1.6 + 1.4 * jab;
        rig.elbowR.rotation.x = -1.6 + 1.4 * jab2;
        rig.neck.rotation.x = 0.5;
        if (gun) { rig.shoulderR.rotation.set(-0.9, 0, -0.1); rig.elbowR.rotation.x = -0.1; }
        return;
    }
    // By the throat / against a wall: the gripping arm straight out, the other fist working
    rig.shoulderL.rotation.set(-1.5, 0, 0.12);
    rig.elbowL.rotation.x = -0.1;
    rig.shoulderR.rotation.set(-0.9 - 0.75 * jab, 0, -0.15);
    rig.elbowR.rotation.x = -1.7 + 1.55 * jab;
    if (gun) { rig.shoulderR.rotation.set(-1.45, 0.35, -0.2); rig.elbowR.rotation.x = -0.2; }
    rig.torso.rotation.set(0.1, 0.12 * jab, 0);
    rig.legL.rotation.x = -0.25;
    rig.legR.rotation.x = 0.2;
}

/** Throwing punches standing up. */
export function posePunch(rig, t) {
    resetRig(rig);
    const a = Math.max(0, Math.sin(t * 9)), b = Math.max(0, -Math.sin(t * 9));
    rig.shoulderL.rotation.set(-1.0 - 0.55 * a, 0, 0.15);
    rig.shoulderR.rotation.set(-1.0 - 0.55 * b, 0, -0.15);
    rig.elbowL.rotation.x = -1.8 + 1.65 * a;
    rig.elbowR.rotation.x = -1.8 + 1.65 * b;
    rig.torso.rotation.y = 0.2 * (a - b);
    rig.legL.rotation.x = -0.2;
    rig.legR.rotation.x = 0.25;
}
