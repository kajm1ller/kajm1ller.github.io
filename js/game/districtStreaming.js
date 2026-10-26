/**
 * js/game/districtStreaming.js
 *
 * Only the district the player is in is "loaded": pedestrians, traffic, parked cars and planes are
 * spawned there and nowhere else, and whatever is left in the district behind is cleared away (out
 * of sight) once the player has moved on. A district is the player's box from districts.js plus
 * every box of the same type touching it (the student neighbourhoods are drawn as several boxes),
 * or everything outside the boxes for the outskirts.
 *
 * Two distances keep the edges from looking cut off:
 *   MARGIN      the loaded area reaches this far past the district's edge, so looking across a
 *               boundary street you still see people and cars on the other side of it
 *   HYSTERESIS  you have to be this far into the next district before it takes over, so walking
 *               along a boundary doesn't load and unload the two over and over
 *
 *   streamer.update(x, z)        -> true when the loaded district changed
 *   streamer.contains(x, z)      -> whether things may exist at (x, z)
 *   streamer.coverage(x, z, r)   -> share (0..1) of the disc of radius r that is loaded, so systems
 *                                   can scale their numbers to the space they actually have
 */

import { DISTRICTS, districtAt } from './districts.js';

export const STREAM_CONFIG = Object.freeze({
    MARGIN: 60,
    HYSTERESIS: 14,
    TOUCH: 2,              // boxes this close count as touching
    COVERAGE_RINGS: 6,
    COVERAGE_SPOKES: 20
});

function boxDistance(b, x, z) {
    const dx = Math.max(b.minX - x, 0, x - b.maxX);
    const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
    return Math.hypot(dx, dz);
}

/** How far (x, z) is inside the box (0 on or outside the edge). */
function boxDepth(b, x, z) {
    return Math.max(0, Math.min(x - b.minX, b.maxX - x, z - b.minZ, b.maxZ - z));
}

function touching(a, b, gap) {
    return a.minX - gap <= b.maxX && b.minX - gap <= a.maxX && a.minZ - gap <= b.maxZ && b.minZ - gap <= a.maxZ;
}

export class DistrictStreamer {
    constructor(options = {}) {
        this.margin = options.margin !== undefined ? options.margin : STREAM_CONFIG.MARGIN;
        this.hysteresis = options.hysteresis !== undefined ? options.hysteresis : STREAM_CONFIG.HYSTERESIS;
        this.enabled = options.enabled !== false;
        this.district = null;     // the district box the player was last placed in
        this.boxes = [];          // boxes that make up the loaded district (empty for the outskirts)
        this.outskirts = false;
        this.name = '';
        this.changes = 0;
        this._cov = { x: NaN, z: NaN, r: 0, v: 1 };
    }

    /** Groups `d` with the boxes of its type it touches (and the ones they touch...). */
    _region(d) {
        if (d.type === 'OUTSKIRTS' || !DISTRICTS.includes(d)) return [];
        const out = [d];
        for (let i = 0; i < out.length; i++) {
            for (const o of DISTRICTS) {
                if (o.type === d.type && !out.includes(o) && touching(out[i], o, STREAM_CONFIG.TOUCH)) out.push(o);
            }
        }
        return out;
    }

    _load(d) {
        this.district = d;
        this.boxes = this._region(d);
        this.outskirts = this.boxes.length === 0;
        this.name = d.def.name;
        this.changes++;
        this._cov.r = 0;
    }

    /** Distance from (x, z) into the loaded district (0 outside it). */
    _depth(x, z) {
        if (this.outskirts) {
            let near = Infinity;
            for (const b of DISTRICTS) {
                if (boxDepth(b, x, z) > 0) return 0;
                near = Math.min(near, boxDistance(b, x, z));
            }
            return near;
        }
        let best = 0;
        for (const b of this.boxes) best = Math.max(best, boxDepth(b, x, z));
        return best;
    }

    /**
     * Follows the player. Returns true when another district was loaded (systems should then
     * clear out what they left behind).
     */
    update(x, z) {
        const here = districtAt(x, z);
        if (!this.district) {
            this._load(here);
            return true;
        }
        if (here === this.district || (this.boxes.includes(here)) || (this.outskirts && here.type === 'OUTSKIRTS')) return false;
        // Far enough into the next district (or nowhere near the current one: a teleport)
        const intoNext = here.type === 'OUTSKIRTS'
            ? DISTRICTS.reduce((m, b) => Math.min(m, boxDistance(b, x, z)), Infinity)
            : boxDepth(here, x, z);
        if (intoNext < this.hysteresis && this.distanceOutside(x, z) < this.hysteresis) return false;
        this._load(here);
        return true;
    }

    /** How far (x, z) is outside the loaded district (0 inside it). */
    distanceOutside(x, z) {
        if (this.outskirts) {
            let deepest = 0;
            for (const b of DISTRICTS) deepest = Math.max(deepest, boxDepth(b, x, z));
            return deepest;
        }
        let best = Infinity;
        for (const b of this.boxes) best = Math.min(best, boxDistance(b, x, z));
        return best;
    }

    /** Things may exist at (x, z): it's in the loaded district or within MARGIN of it. */
    contains(x, z) {
        if (!this.enabled || !this.district) return true;
        return this.distanceOutside(x, z) <= this.margin;
    }

    /**
     * Share of the disc of radius r around (x, z) that is loaded (area-weighted samples; cached
     * until the player moves 20 m or the district changes).
     */
    coverage(x, z, r) {
        if (!this.enabled || !this.district) return 1;
        const c = this._cov;
        if (c.r === r && Math.abs(c.x - x) < 20 && Math.abs(c.z - z) < 20) return c.v;
        const rings = STREAM_CONFIG.COVERAGE_RINGS, spokes = STREAM_CONFIG.COVERAGE_SPOKES;
        let hit = 0, total = 0;
        for (let i = 0; i < rings; i++) {
            const rr = r * Math.sqrt((i + 0.5) / rings); // equal-area rings
            for (let j = 0; j < spokes; j++) {
                const a = (j + (i % 2) * 0.5) / spokes * Math.PI * 2;
                total++;
                if (this.contains(x + Math.cos(a) * rr, z + Math.sin(a) * rr)) hit++;
            }
        }
        c.x = x; c.z = z; c.r = r; c.v = hit / total;
        return c.v;
    }

    getStats() {
        return {
            enabled: this.enabled,
            district: this.name,
            boxes: this.outskirts ? 'outskirts' : this.boxes.length,
            changes: this.changes
        };
    }
}
