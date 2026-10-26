/**
 * js/game/bars.js
 *
 * The downtown bars, modelled inside and out. The storefronts are the real OSM bars in the
 * Downtown Bars district (data/bars.json, baked by tools/buildBars.mjs); each one replaces the
 * map's building (carve) with a brick shell, a storefront you can walk through and a fitted-out
 * room: the bar counter with its back bar, taps, stools and TVs, and the rest of the floor from
 * BAR_SPECS (booths, high-tops, pool tables, darts, a stage with a band's gear, an LED dance floor
 * with a mirror ball and a DJ, arcade cabinets, a kitchen window, restrooms at the back...).
 * Uptown and The Attic are upstairs bars with their own street door and a staircase
 * (floorAt gives the player's floor height on the stairs and upstairs).
 *
 * Specs follow what's known about each place (Howard's graffiti and stage and hall-of-fame back
 * bar, Downtown's wall of TVs, pool and air hockey, Tubby's skinny room with three pool tables in
 * the back, the Cla-Zel's 1926 theatre turned dance club, The R.O.W.'s exposed brick and oars, The
 * Attic's dance floor and patio bar...); where nothing is known they're a plausible downtown bar.
 *
 * The bars open at night (BAR_CONFIG.OPEN_NIGHT): bartenders, a DJ / band and a packed crowd are
 * pedestrian rigs drawn through PedestrianSystem.extraRigs while you're near, and BarAudio plays a
 * bass-boosted song from media/barmusic over a crowd murmur, muffled when you're outside. By day
 * they're empty and quiet. Press E at a counter to buy a drink.
 *
 * Local frame per storefront: +x out to the street, the front wall at x = 0 and the back wall at
 * x = -D; z across the frontage (-W/2..W/2). Turned by `theta` (a quarter turn) like gasStations.js.
 */

import * as THREE from 'three';
import { resetRig, poseSeated, poseWalk } from './avatarPose.js';
import { DOOR_KIND } from './districts.js';
import {
    Kit, mat, rng, hashStr, brickTex, woodTex, checkerTex, concreteTex, tinTex, panelTex, paintTex, dropTex, bottlesTex,
    shotGlassTex, neonTex, signTex, tvTex, posterTex, graffitiTex, muralTex, photosTex, horseTex, wantedTex, menuTex,
    dartTex, ledFloorTex, mirrorTex, upperWindowTex, arcadeTex, labelTex, verticalLabelTex, marqueeTex, tankTex, curtainTex, grilleTex,
    ribbedTex
} from './barKit.js';
import { FRONTS, buildFront, viceShelves } from './barFronts.js';

const GUEST_STYLES = ['student', 'partier', 'partier', 'student', 'worker', 'shopper', 'older', 'partier'];

export const BAR_CONFIG = Object.freeze({
    BUILD_DISTANCE: 240,     // built (one per frame) when the camera comes this close
    DRAW_DISTANCE: 420,
    CROWD_DISTANCE: 14,      // people inside while you're this close to (or in) a bar
    CROWD_DROP: 30,
    MAX_RIGS: 180,
    CROWDED_BARS: 2,         // only the nearest two storefronts have people in at once
    PEOPLE_PER_M2: 1 / 5.5,  // a busy night
    MAX_PER_BAR: 70,
    OPEN_NIGHT: 0.5,         // bars are open (people, music) when nightFactor is past this: ~7:30 pm to ~5:30 am
    MUSIC: ['Brightside', 'GasPedal', 'GetLow', 'HateBeinSober', 'NoHands', 'RichBabyDaddy', 'SuperFreakyGirl', 'TrapQueen',
        'Bodyt', 'DontStopTheMusic', 'ImmaBe', 'SexyBack', 'Starships'].map((n) => `./media/barmusic/${n}.mp3`),
    CROWD_SOUND: './media/CrowdTalking.mp3',
    // A room full of people screaming (shots fired in a bar), looped until the last of them is out
    PANIC_SOUNDS: ['./media/CrowdScreaming.mp3', './media/CrowdScreaming2.mp3'],
    HEAR_DISTANCE: 45,       // metres from a bar you still hear it through the walls
    T: 0.3,                  // wall thickness
    G: 4.2,                  // ground-floor ceiling
    UP: 4.5,                 // upstairs floor
    STOREY: 3.9,
    STAIR_W: 1.3,
    STAIR_RUN: 7.2
});
const { T, G, UP, STOREY } = BAR_CONFIG;

// ------------------------------------------------------------------------------------------------
// What each bar is like
// ------------------------------------------------------------------------------------------------
/*
 * facade: brick colour (or paint), trim, sign { text, sub, bg, fg, border, font }, awning colour,
 *   neon window signs [[text, colour]], blade (projecting sign), theater (Cla-Zel front)
 * walls: 'brick' | 'paint' | 'panel' | 'graffiti' | 'western' | 'deco' | 'black'; wallColor; wainscot colour
 * floor: 'wood' | 'concrete' | 'checker' | 'dark' | 'tile'; ceiling: 'tin' | 'black' | 'drop' | 'beams' | 'deco'
 * bar: side (+1 / -1: which side wall), len, front ('wood' | 'led' | 'tin' | 'deco'), top colour,
 *   back ('bottles' | 'photos' | 'tank' | 'shots' | 'glow'), glow colour, tvs over the back bar
 * front / side / back: zones [kind, weight, opts] laid out front to back: `front` by the door,
 *   `side` beside the counter, `back` behind it (full width)
 * decor: posters, photos, graffiti, mural, neon [[text, colour]], oars, pennants, horses, wanted,
 *   tvs (on the walls), sconces, menu, horns
 * music: how loud it is (0..1.3); crowd: how busy (multiplier); band: live band at night
 */
const SPECS = {
    "Howard's Club H": {
        facade: { brick: 0x6a2a20, trim: 0x1a1a1a, sign: { text: "HOWARD'S CLUB H", bg: 0x111111, fg: 0xe8d070, border: 0xc03020 }, blade: true,
            neon: [['LIVE MUSIC', 0xff3a3a], ['OPEN', 0x3aff8a]] },
        walls: 'graffiti', wallColor: 0x2a2420, floor: 'wood', floorColor: 0x4a2e1a, ceiling: 'black',
        bar: { side: 1, len: 9, front: 'wood', top: 0x3a2414, back: 'photos', tvs: 1 },
        side: [['seating', 1, { type: 'tables', carved: true }]],
        back: [['seating', 0.5, { type: 'tables', carved: true }], ['stage', 1.2]],
        decor: { posters: 1, mural: true, neon: [['HOWARD\'S', 0xff3a3a], ['CLUB H', 0x3ad0ff]], menu: true },
        music: 1.25, crowd: 1.1, band: true
    },
    'liquid bar': {
        facade: { brick: 0x23252c, paint: true, trim: 0x101012, sign: { text: 'LIQUID', sub: 'BAR · LOUNGE', bg: 0x05060a, fg: 0x3ad0ff, border: 0x3ad0ff },
            neon: [['COCKTAILS', 0x3ad0ff], ['OPEN', 0xff3a7a]] },
        walls: 'paint', wallColor: 0x14161f, floor: 'dark', floorColor: 0x1a1a22, ceiling: 'black',
        bar: { side: -1, len: 11, front: 'led', top: 0x0a0a0a, back: 'glow', glow: 0x2a8aff, tvs: 2 },
        side: [['lounge', 1]],
        back: [['dance', 1.6], ['dj', 0.6]],
        decor: { neon: [['LIQUID', 0x3ad0ff], ['DRINK UP', 0xff3a7a]] },
        music: 1.15, crowd: 1
    },
    Brathaus: {
        facade: { brick: 0x7a5a3a, trim: 0x2a1a10, sign: { text: 'BRATHAUS', bg: 0x1a3a1a, fg: 0xf2e6c8, border: 0xd8b860, font: 'Georgia, serif' },
            neon: [['BEER', 0xffb03a], ['OPEN', 0xff3a3a]] },
        walls: 'panel', wallColor: 0x4a3020, floor: 'wood', floorColor: 0x5a3a20, ceiling: 'drop',
        bar: { side: -1, len: 6.5, front: 'wood', top: 0x2a1a10, back: 'bottles', tvs: 3 },
        front: [['arcade', 1, { golf: true, n: 1 }]],
        side: [['seating', 1, { type: 'hightops' }]],
        back: [['pool', 1, { n: 1 }]],
        decor: { neon: [['BRATS & BEER', 0xffb03a]], bigscreen: true, pennants: true },
        music: 0.5, crowd: 0.8
    },
    'DownTown Sports Grill': {
        facade: { brick: 0x8a3b2a, trim: 0x1a1a1a, sign: { text: 'DOWNTOWN', sub: 'SPORTS GRILL', bg: 0x1a3a7a, fg: 0xffffff, border: 0xff8a1a }, awning: 0x1a3a7a,
            neon: [['SPORTS', 0xff8a1a], ['COLD BEER', 0x3ad0ff]] },
        walls: 'brick', wallColor: 0x8a3b2a, floor: 'wood', floorColor: 0x6b4426, ceiling: 'black',
        bar: { side: 1, len: 12, front: 'wood', top: 0x2a1a10, back: 'bottles', tvs: 5 },
        side: [['seating', 1, { type: 'hightops', booths: true }]],
        back: [['pool', 1.3, { n: 2 }], ['airhockey', 0.55], ['darts', 0.45], ['kitchen', 0.5]],
        decor: { tvs: 12, pennants: true, neon: [['GO FALCONS', 0xff8a1a]] },
        music: 0.6, crowd: 1
    },
    'Uptown Nightclub': {
        walls: 'black', wallColor: 0x121014, floor: 'dark', floorColor: 0x141014, ceiling: 'black',
        bar: { side: 1, len: 8, front: 'led', top: 0x0a0a0a, back: 'glow', glow: 0xd03aff, tvs: 0 },
        side: [['lounge', 1]],
        back: [['dance', 2], ['stage', 0.7, { runway: true, dj: true }]],
        decor: { neon: [['UPTOWN', 0xd03aff], ['DANCE', 0x3affd0]] },
        upstairsSign: { text: 'UPTOWN', bg: 0x12061e, fg: 0xd03aff, border: 0x3affd0 },
        music: 1.3, crowd: 1.2
    },
    'Vice & Video': {
        facade: { brick: 0x2a1a3a, paint: true, trim: 0x0a0a12, sign: { text: 'VICE & VIDEO', bg: 0x12061e, fg: 0xff4ad0, border: 0x3ad0ff },
            neon: [['ARCADE BAR', 0xff4ad0], ['OPEN', 0x3ad0ff]] },
        walls: 'paint', wallColor: 0x1a1030, floor: 'checker', floorColor: 0x111111, floorColor2: 0xd8d8d8, ceiling: 'black',
        bar: { side: -1, len: 9, front: 'led', top: 0x0a0a0a, back: 'glow', glow: 0xff4ad0, tvs: 2, tvKind: 4 },
        side: [['arcade', 1]],
        back: [['seating', 0.8, { type: 'hightops' }], ['airhockey', 0.45], ['lounge', 0.7]],
        decor: { neon: [['GAME OVER', 0x3aff6a], ['INSERT COIN', 0xffd23a]], posters: 0.4 },
        music: 0.9, crowd: 0.9
    },
    'Bar 149': {
        facade: { brick: 0x5a3a2a, trim: 0x0e1a14, sign: { text: 'BAR 149', bg: 0x0e1a14, fg: 0xd8b860, border: 0xd8b860, font: 'Georgia, serif' }, awning: 0x0e3a24,
            neon: [['COCKTAILS', 0xff8a2a]] },
        walls: 'brick', wallColor: 0x6a4030, wainscot: 0x3a2414, floor: 'wood', floorColor: 0x3a2414, ceiling: 'tin', ceilingColor: 0x8a7a5a,
        bar: { side: 1, len: 10, front: 'wood', top: 0x1a0e08, back: 'bottles', tvs: 1 },
        side: [['seating', 1, { type: 'tables', booths: true }]],
        back: [['seating', 1, { type: 'tables' }], ['darts', 0.35]],
        decor: { photos: true, neon: [['Cocktails', 0xff8a2a, true]] },
        music: 0.55, crowd: 0.8
    },
    "Doc Holliday's Bar & Grill": {
        facade: { brick: 0x6a4a2a, trim: 0x3a2410, sign: { text: "DOC HOLLIDAY'S", sub: 'BAR & GRILL', bg: 0x3a2410, fg: 0xf2d8a0, border: 0xb07a3a, font: 'Georgia, serif' },
            neon: [['SALOON', 0xffb03a]] },
        walls: 'western', wallColor: 0x6a4426, floor: 'wood', floorColor: 0x6a4426, ceiling: 'beams',
        bar: { side: -1, len: 9, front: 'wood', top: 0x3a2414, back: 'bottles', tvs: 2 },
        side: [['seating', 1, { type: 'tables' }]],
        back: [['pool', 1, { n: 1 }], ['kitchen', 0.55]],
        decor: { wanted: true, horns: true, neon: [['WHISKEY', 0xffb03a]] },
        fixtures: 'wagon', music: 0.6, crowd: 0.8
    },
    "Tubby's Tavern": {
        facade: { brick: 0x7a3a2a, trim: 0x1a1a1a, sign: { text: "TUBBY'S", sub: 'TAVERN', bg: 0x0a2a5a, fg: 0xffffff, border: 0xffd23a }, blade: true,
            neon: [['32 OZ MUGS', 0xffd23a], ['OPEN', 0xff3a3a]] },
        walls: 'paint', wallColor: 0x24302a, wainscot: 0x3a2a1a, floor: 'wood', floorColor: 0x5a3a20, ceiling: 'drop',
        bar: { side: -1, len: 15, front: 'wood', top: 0x2a1a10, back: 'bottles', tvs: 2, bigTv: true },
        side: [['seating', 1, { type: 'tables' }]],
        back: [['backroom', 1, { n: 3 }]],
        decor: { posters: 0.8, neon: [['TUBBY\'S', 0x3ad0ff]] },
        music: 0.7, crowd: 0.9
    },
    'Cla-Zel': {
        facade: { brick: 0xd8ccb0, paint: true, trim: 0x8a1a1a, theater: true, sign: { text: 'CLA-ZEL', bg: 0x8a1a1a, fg: 0xffe9a0, border: 0xffd86a } },
        walls: 'deco', wallColor: 0x4a0f18, floor: 'dark', floorColor: 0x1a1210, ceiling: 'deco', ceilingColor: 0x8a6a2a,
        tall: true,
        bar: { side: 1, len: 10, front: 'deco', top: 0x1a0e08, back: 'glow', glow: 0xffb03a, tvs: 0 },
        front: [['lobby', 1]],
        side: [['seating', 1, { type: 'hightops' }]],
        back: [['dance', 1.6], ['theater', 1]],
        decor: { sconces: true, neon: [['DANCE', 0xff3a7a]] },
        music: 1.25, crowd: 1.2
    },
    'Nate & Wallys Fishbowl': {
        facade: { brick: 0x9a5a3a, trim: 0x0a2a4a, sign: { text: "NATE & WALLY'S", sub: 'FISHBOWL', bg: 0x0a3a6a, fg: 0xffffff, border: 0x3ad0ff },
            neon: [['FISHBOWLS', 0x3ad0ff], ['OPEN', 0xff3a7a]] },
        walls: 'paint', wallColor: 0x14405a, floor: 'concrete', floorColor: 0x3a4a52, ceiling: 'black',
        bar: { side: 1, len: 10, front: 'tin', top: 0x0a1a2a, back: 'tank', tvs: 2 },
        side: [['seating', 1, { type: 'hightops' }]],
        back: [['beerpong', 0.6], ['dance', 1]],
        decor: { neon: [['FISHBOWL', 0x3ad0ff], ['GO FISH', 0xffd23a]], mural: true },
        music: 1.0, crowd: 1
    },
    'Trotters Tavern': {
        facade: { brick: 0x7a4a30, trim: 0x1a2a1a, sign: { text: 'TROTTERS', sub: 'TAVERN', bg: 0x1a2a1a, fg: 0xf2e6c8, border: 0xd8b860, font: 'Georgia, serif' },
            neon: [['STEAKS', 0xff8a2a]] },
        walls: 'panel', wallColor: 0x5a3a22, floor: 'wood', floorColor: 0x4a2e1a, ceiling: 'tin', ceilingColor: 0x9a8a6a,
        bar: { side: -1, len: 9, front: 'wood', top: 0x2a1a10, back: 'bottles', tvs: 1 },
        side: [['rail', 1]],
        back: [['seating', 1, { type: 'tables' }], ['kitchen', 0.6]],
        decor: { horses: true, menu: true },
        music: 0.35, crowd: 0.6
    },
    'City Tap': {
        facade: { brick: 0x8a4a32, trim: 0x1a1a1a, sign: { text: 'CITY TAP', bg: 0x1a1a1a, fg: 0xf2c84a, border: 0xf2c84a }, awning: 0x1a1a1a,
            neon: [['ON TAP', 0xffb03a], ['OPEN', 0xff3a3a]] },
        walls: 'brick', wallColor: 0x8a4a32, floor: 'wood', floorColor: 0x5a3a20, ceiling: 'tin', ceilingColor: 0x7a7266,
        bar: { side: 1, len: 7, front: 'wood', top: 0x1a1a1a, back: 'bottles', tvs: 3 },
        side: [['seating', 1, { type: 'tables', booths: true }]],
        back: [['pool', 1, { n: 1 }]],
        decor: { menu: true, tvs: 2 },
        stairSide: -1, music: 0.5, crowd: 0.8
    },
    'The Attic': {
        walls: 'black', wallColor: 0x1a1612, floor: 'wood', floorColor: 0x2a1a10, ceiling: 'beams',
        bar: { side: 1, len: 6, front: 'wood', top: 0x0a0a0a, back: 'glow', glow: 0xffb03a, tvs: 0 },
        side: [['lounge', 1]],
        back: [['dance', 1.6], ['dj', 0.5]],
        patio: 5.5, patioFront: true,       // the rooftop patio is across the front, over City Tap
        decor: { neon: [['THE ATTIC', 0xffb03a], ['DANCE', 0xff3a7a]] },
        upstairsSign: { text: 'THE ATTIC', bg: 0x0a0a0a, fg: 0xffb03a, border: 0xffb03a },
        music: 1.25, crowd: 1.2
    },
    'Shots Inc.': {
        facade: { brick: 0x151515, paint: true, trim: 0x0a0a0a, sign: { text: 'SHOTS', sub: 'INC.', bg: 0x000000, fg: 0xff2a2a, border: 0xff2a2a },
            neon: [['SHOTS', 0xff2a2a], ['OPEN', 0xffffff]] },
        walls: 'paint', wallColor: 0x1e0a0a, floor: 'checker', floorColor: 0x0a0a0a, floorColor2: 0x8a1010, ceiling: 'black',
        bar: { side: 1, len: 8, front: 'led', top: 0x0a0a0a, back: 'shots', tvs: 1, tvKind: 4 },
        side: [['seating', 1, { type: 'hightops' }]],
        back: [['beerpong', 0.6], ['dance', 1], ['dj', 0.4]],
        decor: { neon: [['SHOTS SHOTS SHOTS', 0xff2a2a]] },
        music: 1.1, crowd: 1
    },
    'The R.O.W.': {
        facade: { brick: 0x7a3424, trim: 0x0a1a3a, sign: { text: 'THE R.O.W.', sub: 'SPORTS BAR & GRILL', bg: 0x0a1a3a, fg: 0xffffff, border: 0xc8a040 },
            neon: [['GAME DAY', 0x3ad0ff], ['OPEN', 0xff3a3a]] },
        walls: 'brick', wallColor: 0x7a3424, floor: 'concrete', floorColor: 0x4a4440, ceiling: 'black',
        bar: { side: 1, len: 11, front: 'tin', top: 0x1a1a1a, back: 'bottles', tvs: 4 },
        side: [['seating', 1, { type: 'hightops', booths: true }]],
        back: [['seating', 1, { type: 'tables' }], ['kitchen', 0.5]],
        decor: { oars: true, tvs: 10, neon: [['ROW ROW ROW', 0x3ad0ff]] },
        music: 0.6, crowd: 1
    }
};
const DEFAULT_SPEC = {
    facade: { brick: 0x8a4a32, trim: 0x1a1a1a, sign: { text: 'BAR', bg: 0x111111, fg: 0xf2e6c8 }, neon: [['OPEN', 0xff3a3a]] },
    walls: 'brick', wallColor: 0x8a4a32, floor: 'wood', floorColor: 0x5a3a20, ceiling: 'tin',
    bar: { side: 1, len: 8, front: 'wood', top: 0x1a1a1a, back: 'bottles', tvs: 2 },
    side: [['seating', 1, { type: 'tables' }]], back: [['pool', 1, { n: 1 }]], decor: {}, music: 0.6, crowd: 1
};
export function specFor(name) {
    const s = SPECS[name];
    if (!s) return { ...DEFAULT_SPEC, facade: { ...DEFAULT_SPEC.facade, sign: { ...DEFAULT_SPEC.facade.sign, text: name.toUpperCase() } } };
    return s;
}

// ------------------------------------------------------------------------------------------------
// Frames
// ------------------------------------------------------------------------------------------------
const FACE_THETA = { E: 0, W: Math.PI, N: Math.PI / 2, S: -Math.PI / 2 };

export function localToWorld(sf, lx, lz, out = {}) {
    const c = Math.cos(sf.theta), s = Math.sin(sf.theta);
    out.x = sf.x + lx * c + lz * s;
    out.z = sf.z - lx * s + lz * c;
    return out;
}
export function worldToLocal(sf, x, z, out = {}) {
    const c = Math.cos(sf.theta), s = Math.sin(sf.theta);
    const dx = x - sf.x, dz = z - sf.z;
    out.x = dx * c - dz * s;
    out.z = dx * s + dz * c;
    return out;
}

/** A storefront from a baked rect: origin at the middle of the street-side wall, W across, D deep. */
export function prepareStorefront(r) {
    const along = r.face === 'N' || r.face === 'S';
    const W = along ? r.maxX - r.minX : r.maxZ - r.minZ;
    const D = along ? r.maxZ - r.minZ : r.maxX - r.minX;
    const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2;
    const origin = { E: [r.maxX, cz], W: [r.minX, cz], N: [cx, r.minZ], S: [cx, r.maxZ] }[r.face];
    return { x: origin[0], z: origin[1], theta: FACE_THETA[r.face], W, D, face: r.face, rect: { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ } };
}

// ------------------------------------------------------------------------------------------------
// Materials shared by the bars
// ------------------------------------------------------------------------------------------------
const C = {
    glass: () => mat('glass', { color: 0x9fc8d8, transparent: true, opacity: 0.28, rough: 0.05, metal: 0.3, glow: 0 }),
    dark: () => mat('dark', { color: 0x141414, glow: 0.1 }),
    black: () => mat('black', { color: 0x0a0a0a, glow: 0.05, rough: 0.5 }),
    steel: () => mat('steel', { color: 0xb0b4b8, metal: 0.8, rough: 0.3, glow: 0.15 }),
    chrome: () => mat('chrome', { color: 0xd8dce0, metal: 0.9, rough: 0.15, glow: 0.2 }),
    brass: () => mat('brass', { color: 0xc89a3a, metal: 0.8, rough: 0.3, glow: 0.25 }),
    white: () => mat('white', { color: 0xeeeeee, glow: 0.3 }),
    porcelain: () => mat('porcelain', { color: 0xf4f4f0, rough: 0.2, glow: 0.35 }),
    bulb: () => mat('bulb', { color: 0xffe2a8, basic: true }),
    lightPanel: () => mat('lightPanel', { color: 0xfff4dc, basic: true }),
    mirror: () => mat('mirrorglass', { color: 0x8a9aa8, metal: 0.9, rough: 0.05, glow: 0.2 }),
    leather: (c) => mat(`leather_${c}`, { color: c, rough: 0.55, glow: 0.3 }),
    color: (c, glow = 0.3) => mat(`c_${c}`, { color: c, glow }),
    tex: (key, map, glow = 0.32, extra = {}) => mat(key, { map, glow, ...extra }),
    basicTex: (key, map, transparent = false) => mat(key, { map, basic: true, transparent }),
    rubber: () => mat('rubber', { color: 0x1a1a1a, rough: 0.9, glow: 0.05 }),
    felt: (c) => mat(`felt_${c}`, { color: c, rough: 0.95, glow: 0.4 })
};

function wallMaterial(spec) {
    const c = spec.wallColor || 0x5a4a40;
    switch (spec.walls) {
        case 'brick': return { m: C.tex(`brickw_${c}`, brickTex(c)), tile: [1.2, 0.6] };
        case 'panel': return { m: C.tex(`panelw_${c}`, panelTex(c)), tile: [1.2, 2.4] };
        case 'western': return { m: C.tex(`western_${c}`, woodTex(c, { planks: 6, worn: 0.6 }), 0.32), tile: [2.4, 2.4], rotate: true };
        case 'graffiti': return { m: C.tex(`graffw_${c}`, graffitiTex(hashStr('walls') + c, c), 0.4), tile: [4, 2] };
        case 'black': return { m: C.tex('blackw', paintTex(0x151515), 0.2), tile: [2, 2] };
        case 'deco': return { m: C.tex(`deco_${c}`, paintTex(c), 0.3), tile: [2, 2] };
        default: return { m: C.tex(`paintw_${c}`, paintTex(c), 0.3), tile: [2, 2] };
    }
}
function floorMaterial(spec) {
    const c = spec.floorColor || 0x5a3a20;
    switch (spec.floor) {
        case 'concrete': return { m: C.tex(`concf_${c}`, concreteTex(c), 0.28, { rough: 0.6 }), tile: [3, 3] };
        case 'checker': return { m: C.tex(`checkf_${c}`, checkerTex(c, spec.floorColor2 || 0xe8e2d6), 0.3, { rough: 0.4 }), tile: [0.6, 0.6] };
        case 'dark': return { m: C.tex(`darkf_${c}`, woodTex(c, { planks: 10, worn: 0.1 }), 0.25, { rough: 0.35 }), tile: [2, 2] };
        case 'tile': return { m: C.tex(`tilef_${c}`, checkerTex(c, c), 0.3), tile: [0.6, 0.6] };
        default: return { m: C.tex(`woodf_${c}`, woodTex(c), 0.3), tile: [2, 2] };
    }
}
function ceilingMaterial(spec) {
    const c = spec.ceilingColor;
    switch (spec.ceiling) {
        case 'tin': return { m: C.tex(`tinc_${c}`, tinTex(c || 0xb9b2a2), 0.35, { metal: 0.4, rough: 0.5 }), tile: [0.6, 0.6] };
        case 'deco': return { m: C.tex(`decoc_${c}`, tinTex(c || 0x8a6a2a), 0.35, { metal: 0.5, rough: 0.4 }), tile: [1.2, 1.2] };
        case 'drop': return { m: C.tex('dropc', dropTex(), 0.4), tile: [1.2, 1.2] };
        case 'beams': return { m: C.tex('beamc', paintTex(0x1a1410), 0.15), tile: [2, 2] };
        default: return { m: C.tex('blackc', paintTex(0x101010), 0.1), tile: [2, 2] };
    }
}

// ------------------------------------------------------------------------------------------------
// Shell: walls, storefront, upper floors, roof
// ------------------------------------------------------------------------------------------------
/**
 * A wall slab between x0..x1 (thickness), y0..y1, z0..z1, with rectangular holes [{z0, z1, y0, y1}].
 */
function wallWithHoles(k, m, x0, x1, y0, y1, z0, z1, holes, tile) {
    const hs = holes.filter((h) => h.z1 > z0 && h.z0 < z1).sort((a, b) => a.z0 - b.z0);
    let z = z0;
    for (const h of hs) {
        if (h.z0 > z) k.block(m, x0, y0, z, x1, y1, h.z0, { tile });
        if (h.y0 > y0) k.block(m, x0, y0, h.z0, x1, h.y0, h.z1, { tile });
        if (h.y1 < y1) k.block(m, x0, h.y1, h.z0, x1, y1, h.z1, { tile });
        z = h.z1;
    }
    if (z < z1) k.block(m, x0, y0, z, x1, y1, z1, { tile });
}

/** The same as a finish: planes at x facing into the room (-x), round the holes. */
function planeWithHoles(k, m, x, y0, y1, z0, z1, holes, tile) {
    const face = (za, zb, ya, yb) => { if (zb - za > 0.01 && yb - ya > 0.01) k.plane(m, zb - za, yb - ya, x, (ya + yb) / 2, (za + zb) / 2, { ry: -Math.PI / 2, tile }); };
    const hs = holes.map((o) => ({ ...o, z0: Math.max(z0, o.z0), z1: Math.min(z1, o.z1) })).filter((o) => o.z1 > o.z0).sort((a, b) => a.z0 - b.z0);
    let z = z0;
    for (const o of hs) {
        face(z, o.z0, y0, y1);
        face(o.z0, o.z1, y0, Math.max(y0, o.y0));
        face(o.z0, o.z1, Math.min(y1, o.y1), y1);
        z = Math.max(z, o.z1);
    }
    face(z, z1, y0, y1);
}

function buildShell(k, sf) {
    const { W, D, H } = sf;
    const spec = sf.facadeSpec;
    const F = spec.facade || DEFAULT_SPEC.facade;
    const brick = F.paint ? C.tex(`paintx_${F.brick}`, paintTex(F.brick), 0.06) : C.tex(`brickx_${F.brick}`, brickTex(F.brick), 0.06);
    const btile = F.paint ? [2, 2] : [1.2, 0.6];
    const sideBrick = C.tex('brick_side', brickTex(0x7a4632), 0.06);
    const trim = C.color(F.trim || 0x1a1a1a, 0.08);
    const W2 = W / 2;
    const patio = sf.upper && sf.upper.spec.patio ? sf.upper.spec.patio : 0;
    const front = FRONTS[sf.name];
    // An upstairs patio is out the back, or across the front (The Attic) with the enclosed part behind it
    const patioFront = patio && sf.patioFront;
    const encX0 = patio && !patioFront ? -D + patio : -D, encX1 = patioFront ? -patio : 0;

    // Side (party) walls and the back wall; an upstairs patio only gets a parapet (the stair
    // house over a front patio's stairs keeps its side full height)
    for (const s of [-1, 1]) {
        const z0 = s < 0 ? -W2 : W2 - T, z1 = s < 0 ? -W2 + T : W2;
        const stairSide = patioFront && sf.stairs && sf.stairs.side === (s < 0 ? -1 : 1);
        if (patio && !stairSide) {
            k.block(sideBrick, encX0, 0, z0, encX1, H, z1, { tile: [1.2, 0.6] });
            if (patioFront) k.block(sideBrick, encX1, 0, z0, 0, UP + 1.1, z1, { tile: [1.2, 0.6] });
            else k.block(sideBrick, -D, 0, z0, encX0, UP + 1.1, z1, { tile: [1.2, 0.6] });
        } else {
            k.block(sideBrick, -D, 0, z0, 0, H, z1, { tile: [1.2, 0.6] });
        }
        k.collide(-D, z0, 0, z1, 0, H);
    }
    k.block(sideBrick, -D, 0, -W2, -D + T, patio && !patioFront ? UP + 1.1 : H, W2, { tile: [1.2, 0.6] });
    k.collide(-D, -W2, -D + T, W2, 0, H);
    // Roof (over the enclosed part) with a parapet
    const roofX0 = encX0;
    k.block(C.color(0x3a3a3c, 0.04), roofX0, H - 0.25, -W2, encX1, H, W2);
    if (!front) k.block(trim, -0.35, H, -W2, 0, H + 0.6, W2);

    // Floors that aren't bars: closed slabs (with a hole for the stairs up)
    if (!sf.tall && sf.levels >= 2) {
        const st = sf.stairs;
        const slab = C.color(0x2a2a2a, 0.05);
        if (st) {
            const zs0 = Math.min(st.z0, st.z1) - 0.15, zs1 = Math.max(st.z0, st.z1) + 0.15;
            k.block(slab, -D + T, G, -W2 + T, st.xt, UP, W2 - T);
            k.block(slab, st.xt, G, -W2 + T, -T, UP, zs0);
            k.block(slab, st.xt, G, zs1, -T, UP, W2 - T);
        } else {
            k.block(slab, -D + T, G, -W2 + T, -T, UP, W2 - T);
        }
        const upTop = UP + STOREY - 0.3;
        if (sf.levels >= 3 || !sf.upper) {
            if (sf.upper) k.block(slab, roofX0 + (patio ? 0 : T), upTop, -W2 + T, -T, upTop + 0.3, W2 - T);
        }
    }

    // The bars that have been photographed get their own street front (barFronts.js)
    if (front) {
        buildFront(k, sf, { T, G, UP, STOREY, wallWithHoles });
        return;
    }

    // ---- Front: storefront at street level ----
    const doors = sf.doors;           // [{z0, z1, kind}]
    const isTheater = !!F.theater;
    const holes = [];
    const SFH = 3.0;                   // top of the shop windows
    const pier = 0.45;
    let windows = [];
    if (!isTheater) {
        // Windows fill what the doors leave (with a pier between)
        const spans = [];
        let z = -W2 + pier;
        for (const d of [...doors].sort((a, b) => a.z0 - b.z0)) {
            if (d.z0 - 0.3 - z > 0.8) spans.push([z, d.z0 - 0.3]);
            z = d.z1 + 0.3;
        }
        if (W2 - pier - z > 0.8) spans.push([z, W2 - pier]);
        windows = spans;
        for (const [a, b] of spans) holes.push({ z0: a, z1: b, y0: 0.6, y1: SFH });
    }
    for (const d of doors) holes.push({ z0: d.z0, z1: d.z1, y0: 0, y1: d.kind === 'stairs' ? 2.5 : 2.7 });
    if (isTheater) {
        // Poster cases either side of the lobby doors
        for (const s of [-1, 1]) holes.push({ z0: s < 0 ? -W2 + 1.2 : W2 - 2.6, z1: s < 0 ? -W2 + 2.6 : W2 - 1.2, y0: 0.9, y1: 2.5 });
    }
    const frontTop = sf.levels >= 2 || sf.tall ? G : H;
    wallWithHoles(k, brick, -T, 0, 0, frontTop, -W2, W2, holes, btile);
    // Glass, frames and bulkheads in the shop windows
    const glass = C.glass();
    for (const [a, b] of windows) {
        k.block(trim, -0.08, 0, a, 0.06, 0.6, b);                                      // bulkhead
        k.plane(glass, b - a, SFH - 0.6, -0.12, (0.6 + SFH) / 2, (a + b) / 2, { ry: Math.PI / 2 });
        const n = Math.max(1, Math.round((b - a) / 1.6));
        for (let i = 0; i <= n; i++) k.block(trim, -0.14, 0.6, a + (b - a) * i / n - 0.04, -0.06, SFH, a + (b - a) * i / n + 0.04);
        k.block(trim, -0.16, SFH - 0.05, a, 0.04, SFH + 0.05, b);
        k.collide(-T, a, 0, b, 0, frontTop);
    }
    if (isTheater) {
        for (const s of [-1, 1]) {
            const a = s < 0 ? -W2 + 1.2 : W2 - 2.6, b = a + 1.4;
            k.plane(C.tex(`poster_case_${s}`, posterTex(hashStr(sf.name) + s), 0.6), 1.2, 1.5, 0.02 - 0.15, 1.7, (a + b) / 2, { ry: Math.PI / 2 });
            k.block(C.brass(), -0.15, 0.85, a, 0.05, 0.95, b);
            k.block(C.brass(), -0.15, 2.45, a, 0.05, 2.55, b);
            k.collide(-T, a, 0, b, 0, frontTop);
        }
    }
    // Solid front between holes (colliders: everything except the doorways)
    {
        const cuts = [...doors].sort((a, b) => a.z0 - b.z0);
        let z = -W2;
        for (const d of cuts) { if (d.z0 > z) k.collide(-T, z, 0, d.z0, 0, frontTop); z = d.z1; }
        if (z < W2) k.collide(-T, z, 0, W2, 0, frontTop);
    }
    // Door frames, and the doors themselves swung open inside
    for (const d of doors) {
        const top = d.kind === 'stairs' ? 2.5 : 2.7;
        k.block(trim, -T - 0.02, 0, d.z0 - 0.08, 0.04, top + 0.1, d.z0);
        k.block(trim, -T - 0.02, 0, d.z1, 0.04, top + 0.1, d.z1 + 0.08);
        k.block(trim, -T - 0.02, top, d.z0, 0.04, top + 0.1, d.z1);
        const w = d.z1 - d.z0;
        k.block(trim, -T - w + 0.05, 0.02, d.z0 + 0.02, -T - 0.05 + 0.05, top - 0.05, d.z0 + 0.07);
        if (d.kind !== 'stairs') k.plane(glass, w - 0.25, top - 0.6, -T - w / 2, top / 2 + 0.15, d.z0 + 0.08, {});
        k.block(trim, -0.02, 0, d.z0, 0.02, 0.03, d.z1);                               // threshold
    }

    // Sign band over the shop windows, and the main sign
    if (!isTheater) {
        const sign = F.sign || DEFAULT_SPEC.facade.sign;
        const sw = Math.min(W - 1.4, 7.5), sh = Math.max(0.55, Math.min(0.95, sw / 6));
        const signZ = sf.mainDoorZ ? Math.max(-W2 + sw / 2 + 0.5, Math.min(W2 - sw / 2 - 0.5, sf.signZ)) : 0;
        k.block(trim, -0.02, SFH + 0.05, -W2 + pier, 0.1, frontTop - 0.05, W2 - pier);
        k.plane(C.basicTex(`sign_${sign.text}`, signTex(sign.text, sign)), sw, sh, 0.115, (SFH + frontTop) / 2, signZ, { ry: Math.PI / 2 });
        k.block(trim, -0.02, frontTop - 0.1, -W2, 0.25, frontTop + 0.08, W2);         // cornice over the shop
        if (F.awning) {
            const aw = C.color(F.awning, 0.12);
            for (const [a, b] of windows) {
                k.box(aw, 1.2, 0.05, b - a + 0.2, 0.6, SFH - 0.25, (a + b) / 2, { rz: 0.35 });
                k.block(aw, 1.15, SFH - 0.75, a - 0.1, 1.2, SFH - 0.45, b + 0.1);
            }
        }
        if (F.blade) {
            const bm = C.basicTex(`blade_${sign.text}`, labelTex(sign.text, sign.bg, sign.fg, 512, 128));
            const bz = W2 - 0.9, by = SFH + 2.4;
            k.block(trim, 0, by - 0.05, bz - 0.04, 1.6, by + 0.05, bz + 0.04);
            for (const f of [-1, 1]) k.plane(bm, 1.4, 0.45, 0.9, by - 0.45, bz + f * 0.03, { ry: f > 0 ? 0 : Math.PI });
            k.block(trim, 0.15, by - 0.72, bz - 0.03, 1.65, by - 0.68, bz + 0.03);
        }
    } else {
        buildMarquee(k, sf, F, trim);
    }
    // Neon in the shop windows, facing the street
    if (!isTheater && F.neon && windows.length) {
        F.neon.forEach(([text, color], i) => {
            const [a, b] = windows[i % windows.length];
            const z = windows.length > i ? (a + b) / 2 : a + (b - a) * 0.25;
            k.plane(C.basicTex(`neon_${text}_${color}`, neonTex(text, color), true), Math.min(1.5, b - a - 0.2), 0.45, -0.2, 2.15, z, { ry: Math.PI / 2 });
        });
    }
    // The upstairs bar's door gets its own little sign
    if (sf.upper && sf.upper.spec.upstairsSign) {
        const d = doors.find((o) => o.kind === 'stairs');
        const us = sf.upper.spec.upstairsSign;
        if (d) k.plane(C.basicTex(`ups_${us.text}`, labelTex(us.text, us.bg, us.fg, 256, 64)), Math.max(1.1, d.z1 - d.z0 + 0.3), 0.32, 0.03, 2.75, (d.z0 + d.z1) / 2, { ry: Math.PI / 2 });
    }

    // ---- Front above the shop: storeys of windows (the upstairs bar's are real glass) ----
    if (sf.levels >= 2 && !sf.tall) {
        const storeys = Math.max(1, sf.levels - 1);
        const nwin = Math.max(1, Math.floor((W - 1) / 2.3));
        const winZ = (i) => -W2 + (W / nwin) * (i + 0.5);
        for (let s = 0; s < storeys; s++) {
            const y0 = s === 0 ? G : UP + STOREY * s - 0.3;
            const y1 = s === storeys - 1 ? H : UP + STOREY * (s + 1) - 0.3;
            const wy0 = (s === 0 ? UP : y0) + 0.9, wy1 = wy0 + 1.75;
            const barFloor = s === 0 && sf.upper;
            const wholes = [];
            for (let i = 0; i < nwin; i++) wholes.push({ z0: winZ(i) - 0.55, z1: winZ(i) + 0.55, y0: wy0, y1: Math.min(wy1, y1 - 0.4) });
            if (barFloor) {
                wallWithHoles(k, brick, -T, 0, y0, y1, -W2, W2, wholes, btile);
                for (const h of wholes) {
                    k.plane(glass, h.z1 - h.z0, h.y1 - h.y0, -0.1, (h.y0 + h.y1) / 2, (h.z0 + h.z1) / 2, { ry: Math.PI / 2 });
                    k.block(trim, -0.12, h.y0 - 0.02, (h.z0 + h.z1) / 2 - 0.03, -0.06, h.y1, (h.z0 + h.z1) / 2 + 0.03);
                }
            } else {
                k.block(brick, -T, y0, -W2, 0, y1, W2, { tile: btile });
                for (const h of wholes) k.plane(C.tex(`upw_${hashStr(sf.name) % 7}_${s}_${h.z0 | 0}`, upperWindowTex(hashStr(sf.name) + s * 13 + Math.round(h.z0 * 10)), 0.25), h.z1 - h.z0, h.y1 - h.y0, 0.012, (h.y0 + h.y1) / 2, (h.z0 + h.z1) / 2, { ry: Math.PI / 2 });
            }
            for (const h of wholes) {
                k.block(C.color(0xcfc6b0, 0.08), -0.05, h.y0 - 0.12, h.z0 - 0.08, 0.1, h.y0, h.z1 + 0.08);        // sill
                k.block(C.color(0xcfc6b0, 0.08), -0.05, h.y1, h.z0 - 0.12, 0.08, h.y1 + 0.2, h.z1 + 0.12);       // lintel
            }
            k.collide(-T, -W2, 0, W2, y0, y1);
        }
        k.block(trim, -0.05, H - 0.5, -W2, 0.35, H - 0.1, W2);       // cornice
    } else if (sf.tall) {
        // The theatre's tall front: pilasters and a band of deco relief
        k.block(brick, -T, G, -W2, 0, H, W2, { tile: btile });
        for (let i = 0; i <= 4; i++) k.block(C.color(F.trim, 0.1), -0.02, G, -W2 + 0.3 + i * (W - 0.6) / 4 - 0.25, 0.18, H - 0.2, -W2 + 0.3 + i * (W - 0.6) / 4 + 0.25);
        k.block(C.color(F.trim, 0.1), -0.05, H - 0.8, -W2, 0.3, H - 0.4, W2);
        k.collide(-T, -W2, 0, W2, G, H);
    }
}

function buildMarquee(k, sf, F, trim) {
    const W2 = sf.W / 2;
    const cw = Math.min(sf.W - 1, 10);
    // Canopy out over the sidewalk, lettered on three sides, bulbs underneath
    const mq = C.basicTex(`marquee_${sf.name}`, marqueeTex(['CLA-ZEL', 'DANCE NIGHT · FRI & SAT', 'DJ · 18+ · LIVE MUSIC']));
    const y0 = 3.2, y1 = 4.4, out = 3.2;
    k.block(trim, 0, y1, -cw / 2, out, y1 + 0.15, cw / 2);
    k.block(C.color(0x1a1a1a, 0.1), 0, y0 - 0.1, -cw / 2, out, y0, cw / 2);
    k.plane(mq, cw, y1 - y0, out + 0.01, (y0 + y1) / 2, 0, { ry: Math.PI / 2 });
    for (const s of [-1, 1]) k.plane(mq, out, y1 - y0, out / 2, (y0 + y1) / 2, s * (cw / 2 + 0.01), { ry: s > 0 ? 0 : Math.PI });
    k.block(C.color(0x1a1a1a, 0.1), 0, y0, -cw / 2, out, y1, cw / 2);
    const bulb = C.bulb();
    for (let x = 0.3; x < out; x += 0.4) for (let z = -cw / 2 + 0.3; z < cw / 2; z += 0.4) k.sphere(bulb, 0.04, x, y0 - 0.14, z, 6);
    // Vertical blade sign on top, lettered on both faces
    const blade = C.basicTex('clazel_blade', verticalLabelTex('CLA-ZEL', 0x8a1a1a, 0xffe9a0));
    const by = y1 + 2.6;
    k.block(trim, 0.35, y1 + 0.15, -0.06, 1.25, by + 2.45, 0.06);
    for (const f of [-1, 1]) k.plane(blade, 0.8, 4.6, 0.8, by, f * 0.07, { ry: f > 0 ? 0 : Math.PI });
    // Ticket window beside the doors
    k.block(C.brass(), -0.1, 0.9, W2 - 3.6, 0.15, 2.3, W2 - 2.8);
    k.plane(C.glass(), 0.7, 1.0, 0.16, 1.7, W2 - 3.2, { ry: Math.PI / 2 });
}

// ------------------------------------------------------------------------------------------------
// Rooms
// ------------------------------------------------------------------------------------------------
/**
 * Fits a bar's room on one floor: floor, ceiling, wall finishes, restrooms, the counter and the
 * zones. `room` = { x0 (back), x1 (front), z0, z1, y, h, hasRestrooms, patio }.
 */
function buildRoom(k, sf, bar, room) {
    const spec = bar.spec;
    const r = rng(hashStr(bar.name));
    const { y, h } = room;
    const ctx = { k, sf, bar, spec, r, y, h, room, walls: [] };
    const fm = floorMaterial(spec), cm = ceilingMaterial(spec), wm = wallMaterial(spec);

    // Floor, ceiling and the wall finish (a patio is out the back, or across the front)
    const patio = room.patio || 0;
    const inX0 = room.x0 + (room.patioFront ? 0 : patio);
    const inX1 = room.x1 - (room.patioFront ? patio : 0);
    k.flat(fm.m, room.x0, room.z0, inX1, room.z1, y + 0.03, { tile: fm.tile });
    k.flat(cm.m, inX0, room.z0, inX1, room.z1, y + h - 0.01, { up: false, tile: cm.tile });
    const skin = (x0, x1, z, facing, y0 = y, y1 = y + h) => {
        // facing: +1 the wall is at z0 looking +z; -1 at z1 looking -z; 'x' back wall looking +x
        if (spec.walls === 'brick' && wm.m === undefined) return;
        if (facing === 'x') k.plane(wm.m, z[1] - z[0], y1 - y0, x0 + 0.012, (y0 + y1) / 2, (z[0] + z[1]) / 2, { ry: Math.PI / 2, tile: wm.tile });
        else k.plane(wm.m, x1 - x0, y1 - y0, (x0 + x1) / 2, (y0 + y1) / 2, z + facing * 0.012, { ry: facing > 0 ? 0 : Math.PI, tile: wm.tile });
        if (spec.wainscot && facing !== 'x') {
            const wc = C.tex(`wains_${spec.wainscot}`, panelTex(spec.wainscot), 0.3);
            k.block(wc, x0, y0, facing > 0 ? z : z - 0.04, x1, y0 + 1.1, facing > 0 ? z + 0.04 : z, { tile: [1.2, 2.4] });
            k.block(C.color(spec.wainscot, 0.3), x0, y0 + 1.08, facing > 0 ? z : z - 0.07, x1, y0 + 1.14, facing > 0 ? z + 0.07 : z);
        }
    };
    skin(inX0, inX1, room.z0, 1);
    skin(inX0, inX1, room.z1, -1);
    if (!room.hasRestrooms) skin(inX0, 0, [room.z0, room.z1], 'x');
    ctx.skin = skin;

    // Ceiling details
    buildCeiling(ctx, inX0, inX1);

    // Restrooms across the back
    let backX = inX0;
    if (room.hasRestrooms) backX = buildRestrooms(ctx, inX0) + 0.15;

    // The Attic's patio (across the front, over City Tap)
    if (patio) {
        if (room.patioFront) buildPatio(ctx, inX1, room.x1, true);
        else buildPatio(ctx, room.x0, inX0);
    }

    // The inside of the street wall gets the room's finish, round the doors and windows
    if (y < 1 && sf.frontHoles && wm.m) {
        const holes = sf.frontHoles.filter((o) => o.z1 > room.z0 && o.z0 < room.z1);
        planeWithHoles(k, wm.m, room.x1 - 0.012, y, y + h, room.z0, room.z1, holes, wm.tile);
    }
    if (y < 1) viceShelves(k, sf, room);

    // The counter
    const b = spec.bar;
    const s = b.side;
    const zw = s > 0 ? room.z1 : room.z0;
    const frontLen = Math.max(2.2, (spec.front ? 4.5 : 2.4));
    const xf = inX1 - frontLen;
    const room_len = xf - (backX + 1.2);
    const len = Math.max(2.5, Math.min(b.len || 8, room_len * 0.8));
    const xr = xf - len;
    const zCo = buildCounter(ctx, xf, xr, zw, s);
    // Where people order: in front of the counter
    k.counters.push([xr, Math.min(zCo, zCo - s * 1.4), xf, Math.max(zCo, zCo - s * 1.4), y]);

    // The rest of the floor
    const zFar = s > 0 ? room.z0 : room.z1;
    const zSideEdge = zCo - s * 1.35;
    const side = { x0: xr, x1: xf, z0: Math.min(zFar, zSideEdge), z1: Math.max(zFar, zSideEdge), wallSide: s > 0 ? -1 : 1 };
    const back = { x0: backX, x1: xr - 0.4, z0: room.z0, z1: room.z1, wallSide: -s };
    const front = { x0: xf + 0.2, x1: inX1 - 0.2, z0: room.z0, z1: room.z1, wallSide: -s };
    if (spec.front) layoutZones(ctx, spec.front, front);
    layoutZones(ctx, spec.side || [], side);
    layoutZones(ctx, spec.back || [], back);

    // How people get about: an aisle behind the stools, front to back, and the way in from the street
    const aisleZ = zCo - s * 1.0;
    ctx.nav = { aisleZ, ax0: backX + 0.6, ax1: inX1 - 0.9 };
    if (y < 1) {
        const dz = sf.mainDoorZ || 0;
        ctx.nav.entry = [[1.6, dz], [-1.1, dz], [inX1 - 0.9, aisleZ]];
        k.spot('bouncer', -1.3, dz + (dz > 0 ? -0.9 : 0.9), -Math.PI / 2, { y, staff: true });
    } else if (sf.stairs) {
        const st = sf.stairs, sz = (st.z0 + st.z1) / 2;
        const d = sf.doors.find((o) => o.kind === 'stairs');
        const dz = d ? (d.z0 + d.z1) / 2 : sz;
        ctx.nav.entry = [[1.6, dz], [-0.8, sz], [st.xb + 0.15, sz], [st.xt - 0.2, sz], [st.xt - 1.0, sz - st.side * 1.2], [st.xt - 1.6, aisleZ]];
        k.spot('bouncer', st.xt - 1.2, sz - st.side * 1.6, -Math.PI / 2, { y, staff: true });
    }

    // Walls: decorations where the counter isn't
    ctx.walls.push({ x0: inX0 + 0.3, x1: inX1 - 0.4, z: s > 0 ? room.z0 : room.z1, facing: s > 0 ? 1 : -1 });
    ctx.walls.push({ x0: inX0 + 0.3, x1: xr - 0.3, z: zw, facing: -s });
    ctx.walls.push({ x0: xf + 0.3, x1: inX1 - 0.4, z: zw, facing: -s });
    decorate(ctx);

    // People standing about by the door and in the aisle along the counter
    if (!spec.front) {
        for (let x = xf + 0.5; x < inX1 - 0.6; x += 0.9) for (let z = room.z0 + 0.6; z < room.z1 - 0.5; z += 1.0) {
            if (r() < 0.6) k.spot('stand', x + (r() - 0.5) * 0.3, z + (r() - 0.5) * 0.3, r() * 6.28, { y });
        }
    }
    for (let x = xr + 0.6; x < xf - 0.3; x += 1.1) k.spot('stand', x, zSideEdge + s * 0.5 + (r() - 0.5) * 0.3, r() * 6.28, { y });
    // Music comes from the middle of the room
    k.music.push({ x: (room.x0 + room.x1) / 2, z: 0, gain: spec.music || 0.6, y });
    return ctx;
}

function buildCeiling(ctx, x0, x1) {
    const { k, spec, room, y, h } = ctx;
    const top = y + h;
    const z0 = room.z0, z1 = room.z1;
    if (spec.ceiling === 'black') {
        // Exposed ducts and track lights
        const duct = C.steel();
        k.cyl(duct, 0.28, 0.28, x1 - x0 - 0.6, (x0 + x1) / 2, top - 0.45, z0 + (z1 - z0) * 0.3, { rz: Math.PI / 2, seg: 14 });
        for (let x = x0 + 1; x < x1 - 0.5; x += 3) k.cyl(duct, 0.12, 0.12, 0.3, x, top - 0.2, z0 + (z1 - z0) * 0.3, { seg: 8 });
        for (let x = x0 + 1.5; x < x1; x += 2.5) {
            k.block(C.black(), x - 0.02, top - 0.12, z0 + 0.6, x + 0.02, top - 0.08, z1 - 0.6);
            for (let z = z0 + 1; z < z1 - 0.5; z += 1.8) k.cyl(C.bulb(), 0.06, 0.06, 0.04, x, top - 0.16, z, { seg: 8 });
        }
    } else if (spec.ceiling === 'beams') {
        const beam = C.tex('beamwood', woodTex(0x4a2e1a, { planks: 3 }), 0.25);
        for (let x = x0 + 0.8; x < x1; x += 1.6) k.block(beam, x - 0.12, top - 0.3, z0, x + 0.12, top, z1, { tile: [2, 2] });
        if (spec.fixtures === 'wagon') {
            for (let x = x0 + 3; x < x1 - 1; x += 4.5) wagonWheel(k, x, top - 1.1, (z0 + z1) / 2);
        } else {
            // String lights zigzagging between the rafters
            for (let x = x0 + 0.8; x < x1 - 1.6; x += 1.6) {
                for (let i = 0; i <= 8; i++) {
                    const t = i / 8;
                    k.sphere(C.bulb(), 0.035, x + 1.6 * t, top - 0.32 - Math.sin(t * Math.PI) * 0.25, z0 + 0.3 + (z1 - z0 - 0.6) * ((Math.floor(x) % 2) ? t : 1 - t), 6);
                }
            }
        }
    } else if (spec.ceiling === 'drop') {
        for (let x = x0 + 1.2; x < x1 - 0.6; x += 2.4) for (let z = z0 + 1.2; z < z1 - 0.6; z += 2.4) k.flat(C.lightPanel(), x - 0.55, z - 0.28, x + 0.55, z + 0.28, top - 0.02, { up: false });
    } else {
        // Tin / deco: pendant globes
        for (let x = x0 + 2; x < x1 - 0.5; x += 3.2) for (let z = z0 + 1.5; z < z1 - 0.5; z += 3.5) {
            k.cyl(C.black(), 0.008, 0.008, 0.7, x, top - 0.35, z, { seg: 4 });
            k.sphere(spec.ceiling === 'deco' ? C.brass() : C.bulb(), 0.16, x, top - 0.8, z, 10);
        }
        if (spec.ceiling === 'deco') {
            // Chandeliers
            for (let x = x0 + 4; x < x1 - 2; x += 8) {
                k.cyl(C.brass(), 0.6, 0.15, 0.5, x, top - 1.2, (z0 + z1) / 2, { seg: 12 });
                for (let a = 0; a < 8; a++) k.sphere(C.bulb(), 0.07, x + Math.cos(a * 0.785) * 0.55, top - 1.35, (z0 + z1) / 2 + Math.sin(a * 0.785) * 0.55, 6);
            }
        }
    }
}

function wagonWheel(k, x, y, z) {
    const wood = C.color(0x4a2e1a, 0.3);
    k.torus(wood, 0.7, 0.05, x, y, z, { rx: Math.PI / 2, seg: 20 });
    for (let a = 0; a < 6; a++) k.box(wood, 1.4, 0.04, 0.04, x, y, z, { ry: a * Math.PI / 6 });
    for (let a = 0; a < 8; a++) k.cyl(C.bulb(), 0.04, 0.05, 0.12, x + Math.cos(a * 0.785) * 0.7, y + 0.08, z + Math.sin(a * 0.785) * 0.7, { seg: 6 });
    for (let a = 0; a < 3; a++) k.cyl(C.black(), 0.008, 0.008, 1.0, x + Math.cos(a * 2.09) * 0.35, y + 0.5, z + Math.sin(a * 2.09) * 0.35, { seg: 4 });
}

/** Two restrooms across the back of the room; returns the x of their front wall. */
function buildRestrooms(ctx, x0) {
    const { k, room, y, h, spec } = ctx;
    const depth = 3.0;
    const xw = x0 + depth;
    const z0 = room.z0, z1 = room.z1, W = z1 - z0;
    const wall = C.tex('restroomwall', paintTex(0xd8d4c8), 0.3);
    const tile = C.tex('restroomfloor', checkerTex(0x2a2a2a, 0xe8e8e8), 0.35);
    const two = W > 5.5;
    const rw = two ? Math.min(2.6, W / 2 - 0.3) : Math.min(2.6, W - 1.2);
    const rooms = two ? [[z0, z0 + rw, 'MEN', 0x2a5ad0], [z1 - rw, z1, 'WOMEN', 0xd02a7a]] : [[z0, z0 + rw, 'RESTROOM', 0x2a7a5a]];
    const graffiti = spec.walls === 'graffiti';
    for (const [a, b, label, color] of rooms) {
        k.flat(tile, x0, a, xw, b, y + 0.035, { tile: [0.6, 0.6] });
        const dz = (a + b) / 2;
        // Front wall with a doorway
        const holes = [{ z0: dz - 0.45, z1: dz + 0.45, y0: y, y1: y + 2.2 }];
        wallWithHoles(k, wall, xw - 0.12, xw, y, y + h, a, b, holes, [2, 2]);
        k.collide(xw - 0.12, a, xw, dz - 0.45, y, y + h);
        k.collide(xw - 0.12, dz + 0.45, xw, b, y, y + h);
        // Side walls of the room (the other side is the building wall)
        for (const zz of [a, b]) if (zz > z0 + 0.01 && zz < z1 - 0.01) { k.block(wall, x0, y, zz - 0.06, xw, y + h, zz + 0.06); k.collide(x0, zz - 0.06, xw, zz + 0.06, y, y + h); }
        // Door leaf, open
        k.block(C.color(0x5a3a22, 0.3), xw - 0.9, y, dz + 0.45, xw - 0.12, y + 2.15, dz + 0.5);
        k.plane(C.basicTex(`rr_${label}`, labelTex(label, color, 0xffffff, 256, 64)), 0.7, 0.18, xw + 0.01, y + 2.35, dz, { ry: Math.PI / 2 });
        // Toilet, sink, mirror, paper towels
        const tz = a + 0.55;
        k.block(C.porcelain(), x0 + 0.05, y + 0.4, tz - 0.2, x0 + 0.25, y + 0.85, tz + 0.2);                  // tank
        k.cyl(C.porcelain(), 0.2, 0.17, 0.4, x0 + 0.5, y + 0.2, tz, { seg: 12 });                                 // bowl
        k.cyl(C.porcelain(), 0.22, 0.22, 0.03, x0 + 0.5, y + 0.42, tz, { seg: 12 });                             // seat
        if (label !== 'WOMEN' && two) {                                                                            // urinal
            k.block(C.porcelain(), x0 + 0.05, y + 0.5, tz + 0.75, x0 + 0.35, y + 1.1, tz + 1.15);
        }
        const sz = b - 0.55;
        k.block(C.porcelain(), x0 + 0.05, y + 0.75, sz - 0.25, x0 + 0.45, y + 0.9, sz + 0.25);                  // sink
        k.cyl(C.chrome(), 0.015, 0.015, 0.18, x0 + 0.12, y + 0.98, sz, { seg: 6 });
        k.plane(C.mirror(), 0.5, 0.7, x0 + 0.02, y + 1.5, sz, { ry: Math.PI / 2 });
        k.block(C.steel(), x0 + 0.02, y + 1.2, sz - 0.6 - 0.15, x0 + 0.15, y + 1.55, sz - 0.6 + 0.15);          // towels
        k.collide(x0, tz - 0.25, x0 + 0.75, tz + 0.25, y, y + 1);
        if (graffiti) k.plane(C.tex('rr_graffiti', graffitiTex(77, 0xd8d4c8), 0.4), b - a - 0.2, 1.4, x0 + 0.015, y + 1.6, (a + b) / 2, { ry: Math.PI / 2, tile: [2, 1] });
        k.flat(C.lightPanel(), x0 + 0.8, dz - 0.25, x0 + 1.6, dz + 0.25, y + h - 0.02, { up: false });
        k.spot('restroom', x0 + 1.3, dz, Math.PI / 2, { y, via: [[xw + 0.6, dz], [xw - 0.4, dz]] });
    }
    // Hallway wall between the rooms
    if (two) {
        const ha = z0 + rw, hb = z1 - rw;
        k.flat(C.tex('hallfloor', checkerTex(0x2a2a2a, 0xe8e8e8), 0.3), x0, ha, xw, hb, y + 0.035, { tile: [0.6, 0.6] });
        k.plane(C.tex('hallback', paintTex(0x3a3a3a), 0.3), hb - ha, h, x0 + 0.012, y + h / 2, (ha + hb) / 2, { ry: Math.PI / 2, tile: [2, 2] });
        k.plane(C.basicTex('exit_sign', labelTex('EXIT', 0x1a1a1a, 0xff2a2a, 128, 48)), 0.45, 0.18, x0 + 0.02, y + 2.3, (ha + hb) / 2, { ry: Math.PI / 2 });
        k.block(C.color(0x5a5a5a, 0.3), x0, y, (ha + hb) / 2 - 0.5, x0 + 0.06, y + 2.1, (ha + hb) / 2 + 0.5);       // back door
    }
    return xw;
}

/** The bar counter, back bar, stools, taps and lights; returns the z of the counter's customer edge. */
function buildCounter(ctx, xf, xr, zw, s) {
    const { k, spec, y, h, r } = ctx;
    const b = spec.bar;
    const len = xf - xr;
    const zBack = zw - s * 0.55;              // front face of the back bar
    const zIn = zBack - s * 0.95;             // bartender side of the counter
    const zCo = zIn - s * 0.75;               // customer side
    const top = C.color(b.top || 0x1a1a1a, 0.25);
    const frontMat = b.front === 'led' ? C.basicTex(`ledfront_${b.glow}`, neonStripTex(b.glow || 0x3ad0ff))
        : b.front === 'tin' ? C.tex('tinfront', tinTex(0xa8a8a8), 0.35, { metal: 0.6 })
            : b.front === 'deco' ? C.tex('decofront', panelTex(0x6a1a1a), 0.3)
                : C.tex(`woodfront_${b.top}`, panelTex(0x5a3a22), 0.32);
    const zc = (zIn + zCo) / 2;
    // Counter body, top, foot rail
    k.block(C.color(0x1a1410, 0.2), xr, y, Math.min(zIn, zCo) + 0.08, xf, y + 1.02, Math.max(zIn, zCo) - 0.08);
    k.plane(frontMat, len, 0.98, (xf + xr) / 2, y + 0.53, zCo - s * 0.08 + s * 0.0, { ry: s > 0 ? Math.PI : 0, tile: b.front === 'led' ? null : [1.2, 1.2] });
    k.block(top, xr - 0.06, y + 1.02, Math.min(zIn, zCo) - 0.05, xf + 0.06, y + 1.09, Math.max(zIn, zCo) + 0.05);
    k.cyl(C.brass(), 0.025, 0.025, len, (xf + xr) / 2, y + 0.22, zCo - s * 0.18, { rz: Math.PI / 2, seg: 8 });
    // Front return closing the counter towards the wall
    k.block(C.color(0x1a1410, 0.2), xf - 0.6, y, Math.min(zIn, zBack), xf, y + 1.02, Math.max(zIn, zBack));
    k.block(top, xf - 0.66, y + 1.02, Math.min(zIn, zBack) - 0.05, xf + 0.06, y + 1.09, Math.max(zIn, zBack) + 0.05);
    k.collide(xr, Math.min(zIn, zCo), xf, Math.max(zIn, zCo), y, y + 1.1);
    k.collide(xf - 0.6, Math.min(zIn, zBack), xf, Math.max(zIn, zBack), y, y + 1.1);
    // Taps
    for (let x = xr + 1.2; x < xf - 1; x += 2.6) {
        k.block(C.chrome(), x - 0.35, y + 1.09, zIn + s * 0.15 - 0.05, x + 0.35, y + 1.45, zIn + s * 0.15 + 0.05);
        for (let i = 0; i < 6; i++) k.cyl(C.color([0xc82a2a, 0x2a5ad0, 0xf2c84a, 0x2a8a3a, 0x1a1a1a, 0xe87a1a][(i + Math.floor(x)) % 6], 0.35), 0.018, 0.022, 0.22, x - 0.29 + i * 0.115, y + 1.58, zIn + s * 0.1, { seg: 6 });
        k.block(C.steel(), x - 0.35, y + 1.09, zIn + s * 0.3 - 0.1, x + 0.35, y + 1.11, zIn + s * 0.3 + 0.1);
    }
    // Glasses, a register, bottles and coasters on the bar top
    for (let x = xr + 0.6; x < xf - 0.5; x += 1.4 + r() * 1.4) {
        const gz = zc - s * (0.1 + r() * 0.15);
        if (r() < 0.5) k.cyl(C.color(0xe8a83a, 0.5), 0.04, 0.035, 0.15, x, y + 1.17, gz, { seg: 8 });
        else k.cyl(C.color(0x3a5a2a, 0.3), 0.035, 0.035, 0.25, x, y + 1.22, gz, { seg: 8 });
    }
    k.block(C.dark(), xr + 0.4, y + 1.0, zBack - s * 0.15 - 0.2, xr + 0.85, y + 1.3, zBack - s * 0.15 + 0.2);
    k.plane(C.basicTex('register', labelTex('$ 0.00', 0x0a1a0a, 0x3aff6a, 128, 48)), 0.3, 0.1, xr + 0.6, y + 1.35, zBack - s * 0.36, { ry: s > 0 ? Math.PI : 0 });

    // Back bar: cabinet with coolers, shelves of bottles / photos / tank, a mirror and TVs
    const bl = xr - 0.2, br = xf;
    k.block(C.color(0x1a1410, 0.2), bl, y, Math.min(zw, zBack), br, y + 0.95, Math.max(zw, zBack));
    k.block(top, bl, y + 0.95, Math.min(zw, zBack) - 0.02, br, y + 1.0, Math.max(zw, zBack) + 0.02);
    for (let x = bl + 0.6; x < br - 0.5; x += 1.3) k.plane(C.steel(), 1.1, 0.75, x, y + 0.45, zBack - s * 0.01, { ry: s > 0 ? Math.PI : 0 });
    k.collide(bl, Math.min(zw, zBack), br, Math.max(zw, zBack), y, y + 1);
    const shelfH = Math.min(1.55, h - 2.2);
    const facing = s > 0 ? Math.PI : 0;
    const shelfZ = zw - s * 0.03;
    let backMat;
    if (b.back === 'photos') backMat = { m: C.tex(`photos_${ctx.bar.name}`, photosTex(hashStr(ctx.bar.name)), 0.4), tile: [2.4, 1.2] };
    else if (b.back === 'tank') backMat = { m: C.basicTex('tank', tankTex()), tile: [3, 1.2] };
    else if (b.back === 'shots') backMat = { m: C.basicTex('shots', shotGlassTex()), tile: [2.4, 1.2] };
    else if (b.back === 'glow') backMat = { m: C.basicTex(`bottlesglow_${b.glow}`, bottlesTex(0x0a0a10, b.glow || 0x3a8aff)), tile: [1.2, 0.45] };
    else backMat = { m: C.tex('bottles', bottlesTex(0x2a1a10), 0.45), tile: [1.2, 0.45] };
    k.plane(backMat.m, br - bl - 0.2, shelfH, (bl + br) / 2, y + 1.1 + shelfH / 2, shelfZ, { ry: facing, tile: backMat.tile });
    if (b.back === 'bottles' || b.back === 'glow') {
        for (let i = 0; i <= 3; i++) k.block(C.color(0x3a2a1a, 0.3), bl + 0.1, y + 1.06 + i * shelfH / 3, Math.min(zw, zw - s * 0.28), br - 0.1, y + 1.1 + i * shelfH / 3, Math.max(zw, zw - s * 0.28));
    }
    if (b.back === 'tank') {
        k.block(C.glass(), bl + 0.1, y + 1.05, Math.min(zw, zw - s * 0.45), br - 0.1, y + 1.1 + shelfH, Math.max(zw, zw - s * 0.45));
        // Fishbowls on the bar top (it's in the name)
        for (let x = xr + 0.9; x < xf - 0.5; x += 2.2) k.sphere(C.tex('fishbowlwater', tankTex(), 0.5, { transparent: true, opacity: 0.75 }), 0.16, x, y + 1.25, zc - s * 0.15, 12);
    }
    // Lit sign / mirror above the shelves
    const signY = y + 1.15 + shelfH + 0.35;
    if (signY < y + h - 0.6 && b.tvs) {
        const n = b.tvs, step = (br - bl) / n;
        for (let i = 0; i < n; i++) tv(k, bl + step * (i + 0.5), Math.min(signY + 0.2, y + h - 0.7), shelfZ - s * 0.08, facing, b.bigTv ? 1.6 : 1.1, (b.tvKind ?? i) + hashStr(ctx.bar.name) % 4);
    } else if (signY < y + h - 0.5) {
        k.plane(C.mirror(), br - bl - 0.4, Math.min(0.7, y + h - signY - 0.3), (bl + br) / 2, signY + 0.2, shelfZ - s * 0.01, { ry: facing });
    }
    // Pendant lights over the counter
    for (let x = xr + 0.8; x < xf - 0.3; x += 1.7) {
        k.cyl(C.black(), 0.006, 0.006, 1.2, x, y + h - 0.6, zc, { seg: 4 });
        k.cyl(C.color(b.glow || 0x2a2a2a, 0.4), 0.05, 0.17, 0.2, x, y + h - 1.25, zc, { seg: 12, open: true });
        k.sphere(C.bulb(), 0.06, x, y + h - 1.33, zc, 8);
    }
    if (b.front === 'led') k.block(mat(`ledstrip_${b.glow}`, { color: b.glow || 0x3ad0ff, basic: true }), xr, y + 0.02, zCo - s * 0.12 - 0.02, xf, y + 0.06, zCo - s * 0.12 + 0.02);

    // Stools along the counter, and the people on them
    const stoolZ = zCo - s * 0.45;
    const seat = C.leather(spec.stoolColor || 0x2a1a14);
    for (let x = xr + 0.45; x < xf - 0.3; x += 0.75) {
        k.cyl(seat, 0.19, 0.19, 0.08, x, y + 0.76, stoolZ, { seg: 12 });
        k.cyl(C.chrome(), 0.025, 0.025, 0.72, x, y + 0.38, stoolZ, { seg: 6 });
        k.torus(C.chrome(), 0.16, 0.012, x, y + 0.3, stoolZ, { rx: Math.PI / 2, seg: 12 });
        k.cyl(C.chrome(), 0.2, 0.2, 0.02, x, y + 0.01, stoolZ, { seg: 12 });
        k.spot('stool', x, stoolZ, s > 0 ? 0 : Math.PI, { y, seatH: 0.8 });
    }
    // Standing room behind the stools, people waiting for a drink
    for (let x = xr + 0.8; x < xf - 0.4; x += 0.9) k.spot('order', x + (r() - 0.5) * 0.3, zCo - s * (1.15 + r() * 0.2), s > 0 ? 0 : Math.PI, { y });
    // Bartenders work the length of the bar
    const nb = Math.max(1, Math.round(len / 6));
    for (let i = 0; i < nb; i++) k.spot('bartender', xr + len * (i + 0.5) / nb, zBack - s * 0.45, s > 0 ? Math.PI : 0, { y, staff: true, x0: xr + len * i / nb + 0.4, x1: xr + len * (i + 1) / nb - 0.4 });
    return zCo;
}

function neonStripTex(color) {
    return ledStrip(color);
}
const _ledStrips = new Map();
/** A glowing gradient panel for LED bar fronts and DJ booths. */
function ledStrip(color) {
    if (_ledStrips.has(color)) return _ledStrips.get(color);
    // A plain glowing gradient panel for LED bar fronts
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 64);
    const hx = '#' + color.toString(16).padStart(6, '0');
    gr.addColorStop(0, '#05050a'); gr.addColorStop(0.7, hx); gr.addColorStop(1, '#ffffff');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(0,0,0,0.35)'; for (let x = 0; x < 64; x += 8) g.fillRect(x, 0, 1, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    _ledStrips.set(color, tex);
    return tex;
}

function tv(k, x, y, z, ry, w = 1.1, kind = 0) {
    const h = w * 0.58;
    const n = Math.sin(ry) !== 0 ? [Math.sin(ry), 0] : [0, Math.cos(ry)];
    k.box(C.black(), w + 0.06, h + 0.06, 0.06, x, y, z, { ry });
    k.plane(C.basicTex(`tv_${kind % 6}`, tvTex(kind % 6)), w, h, x + n[0] * 0.035, y, z + n[1] * 0.035, { ry });
    k.block(C.black(), x - 0.04, y + h / 2, z - 0.04, x + 0.04, y + h / 2 + 0.5, z + 0.04);
}

// ------------------------------------------------------------------------------------------------
// Zones
// ------------------------------------------------------------------------------------------------
function layoutZones(ctx, zones, region) {
    const len = region.x1 - region.x0;
    if (len < 1.2 || region.z1 - region.z0 < 1.2 || !zones.length) return;
    const total = zones.reduce((a, z) => a + z[1], 0);
    let x = region.x1;
    for (const [kind, weight, opts = {}] of zones) {
        const l = len * weight / total;
        const r = { ...region, x0: x - l, x1: x };
        x -= l;
        if (l < 0.8) continue;
        const fn = ZONES[kind];
        if (fn) fn(ctx, r, opts);
    }
}

const wallZ = (r) => (r.wallSide < 0 ? r.z0 : r.z1);
const yawTo = (dx, dz) => Math.atan2(dx, dz);

const ZONES = {
    /** Tables or high-tops in a grid; `booths` lines the wall with booths first. */
    seating(ctx, r, opts) {
        const { k } = ctx;
        let { z0, z1 } = r;
        if (opts.booths && z1 - z0 > 3.4) {
            const wz = wallZ(r);
            const inward = r.wallSide < 0 ? 1 : -1;
            ZONES.booths(ctx, r);
            if (r.wallSide < 0) z0 = wz + 1.5; else z1 = wz - 1.5;
            void inward;
        }
        const sub = { ...r, z0, z1 };
        if (opts.type === 'hightops') ZONES.hightops(ctx, sub, opts);
        else ZONES.tables(ctx, sub, opts);
        void k;
    },
    tables(ctx, r, opts = {}) {
        const { k, y, spec } = ctx;
        const wood = opts.carved ? C.tex(`carved_${spec.floorColor}`, graffitiTex(1928, 0x3a2414), 0.35) : C.color(spec.tableColor || 0x3a2414, 0.3);
        const chair = C.color(spec.chairColor || 0x2a1a10, 0.3);
        const cols = Math.max(1, Math.floor((r.z1 - r.z0) / 2.1)), rows = Math.max(1, Math.floor((r.x1 - r.x0) / 2.1));
        for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
            const x = r.x0 + (r.x1 - r.x0) * (i + 0.5) / rows, z = r.z0 + (r.z1 - r.z0) * (j + 0.5) / cols;
            k.block(wood, x - 0.42, y + 0.72, z - 0.42, x + 0.42, y + 0.77, z + 0.42, { tile: opts.carved ? [1, 0.5] : null });
            k.cyl(C.black(), 0.05, 0.05, 0.72, x, y + 0.36, z, { seg: 6 });
            k.block(C.black(), x - 0.3, y, z - 0.3, x + 0.3, y + 0.04, z + 0.3);
            k.collide(x - 0.42, z - 0.42, x + 0.42, z + 0.42, y, y + 0.8);
            for (const [dx, dz] of [[0.65, 0], [-0.65, 0], [0, 0.65], [0, -0.65]]) {
                const cx = x + dx, cz = z + dz;
                k.block(chair, cx - 0.21, y + 0.44, cz - 0.21, cx + 0.21, y + 0.49, cz + 0.21);
                for (const [lx, lz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) k.block(chair, cx + lx - 0.02, y, cz + lz - 0.02, cx + lx + 0.02, y + 0.44, cz + lz + 0.02);
                const bx = cx + Math.sign(dx) * 0.19, bz = cz + Math.sign(dz) * 0.19;
                if (dx) k.block(chair, bx - 0.02, y + 0.49, cz - 0.2, bx + 0.02, y + 0.95, cz + 0.2);
                else k.block(chair, cx - 0.2, y + 0.49, bz - 0.02, cx + 0.2, y + 0.95, bz + 0.02);
                k.spot('sit', cx, cz, yawTo(-dx, -dz), { y, seatH: 0.48 });
            }
            // Drinks and a menu stand
            k.cyl(C.color(0xe8a83a, 0.5), 0.04, 0.035, 0.15, x + 0.15, y + 0.85, z + 0.1, { seg: 8 });
            k.cyl(C.color(0x3a5a2a, 0.3), 0.035, 0.035, 0.24, x - 0.12, y + 0.89, z - 0.15, { seg: 8 });
        }
    },
    hightops(ctx, r) {
        const { k, y, spec } = ctx;
        const topM = C.color(spec.bar.top || 0x1a1a1a, 0.25);
        const cols = Math.max(1, Math.floor((r.z1 - r.z0) / 1.8)), rows = Math.max(1, Math.floor((r.x1 - r.x0) / 1.8));
        for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
            const x = r.x0 + (r.x1 - r.x0) * (i + 0.5) / rows, z = r.z0 + (r.z1 - r.z0) * (j + 0.5) / cols;
            k.cyl(topM, 0.36, 0.36, 0.05, x, y + 1.06, z, { seg: 16 });
            k.cyl(C.chrome(), 0.035, 0.035, 1.04, x, y + 0.52, z, { seg: 6 });
            k.cyl(C.chrome(), 0.25, 0.27, 0.03, x, y + 0.015, z, { seg: 12 });
            k.collide(x - 0.3, z - 0.3, x + 0.3, z + 0.3, y, y + 1.1);
            for (const a of [0.4, 3.5]) {
                const sx = x + Math.cos(a) * 0.6, sz = z + Math.sin(a) * 0.6;
                k.cyl(C.leather(0x1a1a1a), 0.17, 0.17, 0.06, sx, y + 0.76, sz, { seg: 10 });
                k.cyl(C.chrome(), 0.02, 0.02, 0.73, sx, y + 0.37, sz, { seg: 6 });
                k.cyl(C.chrome(), 0.17, 0.18, 0.02, sx, y + 0.01, sz, { seg: 10 });
            }
            k.cyl(C.color(0xe8a83a, 0.5), 0.04, 0.035, 0.15, x + 0.1, y + 1.16, z, { seg: 8 });
            k.spot('stand', x + 0.65, z - 0.25, yawTo(-0.65, 0.25), { y });
            k.spot('stand', x - 0.6, z + 0.3, yawTo(0.6, -0.3), { y });
            k.spot('stool', x + Math.cos(0.4) * 0.6, z + Math.sin(0.4) * 0.6, yawTo(-Math.cos(0.4), -Math.sin(0.4)), { y, seatH: 0.8 });
        }
    },
    booths(ctx, r) {
        const { k, y, spec } = ctx;
        const wz = wallZ(r), inward = r.wallSide < 0 ? 1 : -1;
        const seat = C.leather(spec.boothColor || 0x5a1a14);
        const wood = C.color(0x2a1a10, 0.3);
        for (let x = r.x1 - 1.05; x - 1.0 > r.x0 - 0.2; x -= 2.1) {
            const za = wz, zb = wz + inward * 1.3;
            const z0 = Math.min(za, zb), z1 = Math.max(za, zb);
            k.block(wood, x - 0.38, y + 0.74, z0 + 0.05, x + 0.38, y + 0.79, z1 - 0.1);        // table
            k.block(C.black(), x - 0.05, y, (z0 + z1) / 2 - 0.05, x + 0.05, y + 0.74, (z0 + z1) / 2 + 0.05);
            for (const f of [-1, 1]) {
                const bx = x + f * 0.72;
                k.block(seat, bx - 0.25, y + 0.42, z0, bx + 0.25, y + 0.52, z1);                  // seat
                k.block(wood, bx - 0.25, y, z0, bx + 0.25, y + 0.42, z1);
                k.block(seat, bx + f * 0.2 - 0.06, y + 0.52, z0, bx + f * 0.2 + 0.06, y + 1.25, z1); // back
                k.collide(bx - 0.25, z0, bx + 0.25, z1, y, y + 1.25);
                k.spot('sit', bx - f * 0.05, (z0 + z1) / 2 + inward * 0.15, f > 0 ? -Math.PI / 2 : Math.PI / 2, { y, seatH: 0.5 });
            }
            k.collide(x - 0.38, z0, x + 0.38, z1, y, y + 0.8);
            k.sphere(C.bulb(), 0.08, x, y + 1.9, wz + inward * 0.12, 8);                        // wall lamp
            k.block(C.brass(), x - 0.03, y + 1.75, wz + inward * 0.02 - 0.03, x + 0.03, y + 1.95, wz + inward * 0.02 + 0.03);
        }
    },
    lounge(ctx, r) {
        const { k, y } = ctx;
        const wz = wallZ(r), inward = r.wallSide < 0 ? 1 : -1;
        const fabric = C.leather(ctx.spec.loungeColor || 0x3a1a4a);
        for (let x = r.x1 - 1.8; x - 1.4 > r.x0 - 0.4; x -= 3.4) {
            // L-shaped couch against the wall with a low table
            const z0 = wz, zs = wz + inward * 0.8;
            k.block(fabric, x - 1.4, y, Math.min(z0, zs), x + 1.4, y + 0.42, Math.max(z0, zs));
            k.block(fabric, x - 1.4, y + 0.42, Math.min(z0, z0 + inward * 0.2), x + 1.4, y + 0.95, Math.max(z0, z0 + inward * 0.2));
            k.block(fabric, x - 1.4, y, Math.min(zs, zs + inward * 1.2), x - 0.6, y + 0.42, Math.max(zs, zs + inward * 1.2));
            k.collide(x - 1.4, Math.min(z0, zs), x + 1.4, Math.max(z0, zs), y, y + 0.95);
            k.block(C.color(0x1a1a1a, 0.25), x - 0.2, y, Math.min(zs + inward * 0.4, zs + inward * 1.1), x + 0.7, y + 0.4, Math.max(zs + inward * 0.4, zs + inward * 1.1));
            k.cyl(C.color(0xe8a83a, 0.5), 0.04, 0.035, 0.15, x + 0.2, y + 0.48, zs + inward * 0.7, { seg: 8 });
            for (const sx of [-0.9, 0, 0.9]) k.spot('sit', x + sx, z0 + inward * 0.55, inward > 0 ? 0 : Math.PI, { y, seatH: 0.45 });
            // Floor lamp
            k.cyl(C.black(), 0.02, 0.02, 1.6, x + 1.6, y + 0.8, z0 + inward * 0.3, { seg: 6 });
            k.cyl(C.color(0xffd8a0, 0.9), 0.12, 0.2, 0.28, x + 1.6, y + 1.65, z0 + inward * 0.3, { seg: 10 });
        }
    },
    pool(ctx, r, opts = {}) {
        const { k, y, h } = ctx;
        const across = Math.max(1, Math.floor((r.z1 - r.z0) / 3.4));
        const along = Math.max(1, Math.floor((r.x1 - r.x0) / 5.0));
        let n = 0;
        const max = opts.n || 4;
        const feltColor = opts.felt || [0x1a6a3a, 0x1a4a8a, 0x8a1a2a][hashStr(ctx.bar.name) % 3];
        for (let i = 0; i < along; i++) for (let j = 0; j < across; j++) {
            if (n++ >= max) break;
            const x = r.x0 + (r.x1 - r.x0) * (i + 0.5) / along, z = r.z0 + (r.z1 - r.z0) * (j + 0.5) / across;
            poolTable(k, x, z, y, h, feltColor, hashStr(ctx.bar.name) + n);
            k.spot('pool', x + 1.65, z + 0.2, -Math.PI / 2, { y });
            k.spot('cue', x - 0.6, z + 1.25, Math.PI, { y });
        }
        // Cue rack on the nearest wall
        const wz = wallZ(r), inward = r.wallSide < 0 ? 1 : -1;
        const rx = (r.x0 + r.x1) / 2;
        k.block(C.color(0x3a2414, 0.3), rx - 0.5, y + 0.6, Math.min(wz, wz + inward * 0.05), rx + 0.5, y + 1.6, Math.max(wz, wz + inward * 0.05));
        for (let i = 0; i < 6; i++) k.cyl(C.color(0xc89a5a, 0.3), 0.012, 0.018, 1.45, rx - 0.4 + i * 0.16, y + 0.8, wz + inward * 0.08, { seg: 6 });
    },
    backroom(ctx, r, opts) {
        // A partition with a wide opening, then pool tables behind it (Tubby's)
        const { k, y, h } = ctx;
        const wall = C.tex(`backroomwall_${ctx.spec.wallColor}`, paintTex(ctx.spec.wallColor || 0x2a2a2a), 0.3);
        const x = r.x1 - 0.1;
        const open = 2.4, mid = (r.z0 + r.z1) / 2;
        wallWithHoles(k, wall, x - 0.12, x, y, y + h, r.z0, r.z1, [{ z0: mid - open / 2, z1: mid + open / 2, y0: y, y1: y + 2.6 }], [2, 2]);
        k.collide(x - 0.12, r.z0, x, mid - open / 2, y, y + h);
        k.collide(x - 0.12, mid + open / 2, x, r.z1, y, y + h);
        k.plane(C.basicTex('poolneon', neonTex('POOL', 0x3aff6a), true), 1.2, 0.4, x + 0.02, y + 3.0, mid, { ry: Math.PI / 2 });
        // Lay the tables out one after another (it's a long thin room)
        const inner = { ...r, x1: x - 0.4 };
        const n = opts.n || 3;
        const step = (inner.x1 - inner.x0) / n;
        const feltColor = 0x1a4a8a;
        for (let i = 0; i < n; i++) {
            const tx = inner.x1 - step * (i + 0.5);
            poolTable(k, tx, mid, y, h, feltColor, 11 + i);
            if (i % 2 === 0) k.spot('pool', tx + 1.65, mid - 0.2, -Math.PI / 2, { y });
            k.spot('cue', tx, r.z0 + 0.5, 0, { y });
        }
    },
    darts(ctx, r) {
        const { k, y } = ctx;
        const wz = wallZ(r), inward = r.wallSide < 0 ? 1 : -1;
        const n = Math.max(1, Math.min(3, Math.floor((r.x1 - r.x0) / 1.6)));
        for (let i = 0; i < n; i++) {
            const x = r.x0 + (r.x1 - r.x0) * (i + 0.5) / n;
            const ry = inward > 0 ? 0 : Math.PI;
            k.block(C.color(0x3a2414, 0.3), x - 0.42, y + 1.3, Math.min(wz, wz + inward * 0.06), x + 0.42, y + 2.16, Math.max(wz, wz + inward * 0.06));
            k.plane(C.basicTex('dart', dartTex()), 0.46, 0.46, x, y + 1.73, wz + inward * 0.07, { ry });
            k.plane(C.tex('dartscore', menuTex('DARTS 501'), 0.4), 0.4, 0.3, x + 0.62, y + 1.7, wz + inward * 0.02, { ry });
            k.flat(C.color(0xd8d8d8, 0.4), x - 0.3, wz + inward * 2.37 - 0.02, x + 0.3, wz + inward * 2.37 + 0.02, y + 0.04);
            k.spot('darts', x, wz + inward * 2.5, inward > 0 ? Math.PI : 0, { y });
        }
    },
    airhockey(ctx, r) {
        const { k, y } = ctx;
        const x = (r.x0 + r.x1) / 2, z = (r.z0 + r.z1) / 2;
        const L = Math.min(2.2, r.x1 - r.x0 - 0.6), Wd = 1.15;
        k.block(C.color(0x1a3a8a, 0.3), x - L / 2, y, z - Wd / 2, x + L / 2, y + 0.78, z + Wd / 2);
        k.flat(C.white(), x - L / 2 + 0.08, z - Wd / 2 + 0.08, x + L / 2 - 0.08, z + Wd / 2 - 0.08, y + 0.79);
        k.flat(C.color(0xd02a2a, 0.4), x - 0.01, z - Wd / 2 + 0.08, x + 0.01, z + Wd / 2 - 0.08, y + 0.795);
        for (const f of [-1, 1]) {
            k.block(C.color(0xd02a2a, 0.3), x + f * (L / 2 - 0.05) - 0.05, y + 0.78, z - Wd / 2, x + f * (L / 2 - 0.05) + 0.05, y + 0.86, z + Wd / 2);
            k.cyl(C.color(f > 0 ? 0xd02a2a : 0x2a8aff, 0.4), 0.05, 0.05, 0.06, x + f * (L / 2 - 0.35), y + 0.83, z, { seg: 10 });
            k.spot('arcade', x + f * (L / 2 + 0.45), z, f > 0 ? -Math.PI / 2 : Math.PI / 2, { y });
        }
        k.cyl(C.black(), 0.035, 0.035, 0.01, x + 0.2, y + 0.8, z - 0.2, { seg: 10 });
        k.collide(x - L / 2, z - Wd / 2, x + L / 2, z + Wd / 2, y, y + 0.9);
    },
    arcade(ctx, r, opts = {}) {
        const { k, y } = ctx;
        const wz = wallZ(r), inward = r.wallSide < 0 ? 1 : -1;
        const names = opts.golf ? ['FAIRWAY TEE'] : ['GALAXY BLASTER', 'KAJ KART', 'PIXEL PUNCH', 'MEGA MAZE', 'TURBO 88', 'RETRO RUMBLE', 'SWAMP ZAP', 'NIGHT RIDER'];
        const n = Math.min(opts.n || 99, Math.floor((r.x1 - r.x0) / 0.9));
        for (let i = 0; i < n; i++) {
            const x = r.x1 - 0.5 - i * 0.9;
            const z0 = wz, z1 = wz + inward * 0.8;
            const body = C.color([0x1a1a3a, 0x3a0a2a, 0x0a2a2a, 0x2a2a0a][i % 4], 0.3);
            k.block(body, x - 0.36, y, Math.min(z0, z1), x + 0.36, y + 1.85, Math.max(z0, z1));
            const ry = inward > 0 ? 0 : Math.PI;
            k.plane(C.basicTex(`arcade_${i}_${opts.golf}`, arcadeTex(i + (opts.golf ? 50 : 0))), 0.55, 0.5, x, y + 1.35, z1 + inward * 0.01, { ry, rx: -0.15 * inward * 0 });
            k.plane(C.basicTex(`marq_${names[i % names.length]}`, labelTex(names[i % names.length], 0x0a0a0a, [0xffd23a, 0x3ad0ff, 0xff4ad0, 0x3aff6a][i % 4], 256, 48)), 0.68, 0.18, x, y + 1.75, z1 + inward * 0.01, { ry });
            k.block(C.color(0x0a0a0a, 0.2), x - 0.36, y + 0.95, Math.min(z1, z1 + inward * 0.25), x + 0.36, y + 1.02, Math.max(z1, z1 + inward * 0.25));   // control panel
            if (opts.golf) k.sphere(C.color(0xe8e8e8, 0.5), 0.07, x, y + 1.05, z1 + inward * 0.12, 10);
            else for (let b = 0; b < 4; b++) k.cyl(C.color([0xff2a2a, 0x2a8aff, 0xffd23a, 0x3aff6a][b], 0.6), 0.025, 0.025, 0.03, x - 0.1 + b * 0.07, y + 1.04, z1 + inward * 0.15, { seg: 8 });
            k.collide(x - 0.36, Math.min(z0, z1), x + 0.36, Math.max(z0, z1), y, y + 1.85);
            k.spot('arcade', x, z1 + inward * 0.55, inward > 0 ? Math.PI : 0, { y });
        }
    },
    beerpong(ctx, r) {
        const { k, y } = ctx;
        const x = (r.x0 + r.x1) / 2, z = (r.z0 + r.z1) / 2;
        k.block(C.tex('pongtop', labelTex('BG', 0x1a3a7a, 0xff8a1a, 256, 64), 0.4), x - 1.22, y + 0.7, z - 0.31, x + 1.22, y + 0.76, z + 0.31);
        for (const f of [-1, 1]) for (const lx of [-0.5, 0.5]) k.block(C.chrome(), x + f * 1.0 + lx * 0.1 - 0.02, y, z + lx * 0.5 - 0.02, x + f * 1.0 + lx * 0.1 + 0.02, y + 0.7, z + lx * 0.5 + 0.02);
        for (const f of [-1, 1]) {
            let c = 0;
            for (let row = 0; row < 4; row++) for (let i = 0; i <= row; i++) {
                c++;
                k.cyl(C.color(0xd02a2a, 0.4), 0.045, 0.035, 0.12, x + f * (1.1 - row * 0.08), y + 0.82, z + (i - row / 2) * 0.095, { seg: 8 });
            }
            k.spot('stand', x + f * 1.6, z, f > 0 ? -Math.PI / 2 : Math.PI / 2, { y });
        }
        k.sphere(C.white(), 0.02, x, y + 0.8, z, 6);
        k.collide(x - 1.22, z - 0.31, x + 1.22, z + 0.31, y, y + 0.8);
    },
    rail(ctx, r) {
        // A drink rail along the wall with a row of stools (Trotters is too narrow for tables)
        const { k, y } = ctx;
        const wz = wallZ(r), inward = r.wallSide < 0 ? 1 : -1;
        k.block(C.color(0x3a2414, 0.3), r.x0, y + 1.05, Math.min(wz, wz + inward * 0.32), r.x1, y + 1.1, Math.max(wz, wz + inward * 0.32));
        for (let x = r.x0 + 0.4; x < r.x1 - 0.3; x += 0.8) {
            k.cyl(C.leather(0x2a1a14), 0.17, 0.17, 0.06, x, y + 0.76, wz + inward * 0.6, { seg: 10 });
            k.cyl(C.chrome(), 0.02, 0.02, 0.73, x, y + 0.37, wz + inward * 0.6, { seg: 6 });
            k.spot('stool', x, wz + inward * 0.62, inward > 0 ? Math.PI : 0, { y, seatH: 0.8 });
        }
    },
    kitchen(ctx, r) {
        // Back-of-house: a wall with a pass-through window, the line behind it
        const { k, y, h } = ctx;
        const wall = C.tex('kitchenwall', paintTex(0xd8d4c8), 0.3);
        const x = r.x1 - 0.1, mid = (r.z0 + r.z1) / 2;
        const doorZ = r.wallSide < 0 ? r.z1 - 0.9 : r.z0 + 0.9;
        wallWithHoles(k, wall, x - 0.12, x, y, y + h, r.z0, r.z1, [
            { z0: mid - 0.9, z1: mid + 0.9, y0: y + 1.05, y1: y + 2.05 },
            { z0: doorZ - 0.45, z1: doorZ + 0.45, y0: y, y1: y + 2.2 }], [2, 2]);
        k.collide(x - 0.12, r.z0, x, Math.min(mid - 0.9, doorZ - 0.45), y, y + h);
        k.collide(x - 0.12, Math.max(mid + 0.9, doorZ + 0.45), x, r.z1, y, y + h);
        k.collide(x - 0.12, Math.min(mid + 0.9, doorZ + 0.45), x, Math.max(mid - 0.9, doorZ - 0.45), y, y + h);
        k.block(C.steel(), x - 0.2, y + 1.05, mid - 0.95, x + 0.3, y + 1.1, mid + 0.95);         // pass shelf
        k.block(C.color(0xd02a2a, 0.5), x - 0.15, y + 2.05, mid - 0.9, x - 0.1, y + 2.1, mid + 0.9);
        k.plane(C.basicTex('orderhere', labelTex('ORDER FOOD HERE', 0x1a1a1a, 0xffd23a, 512, 64)), 1.6, 0.2, x + 0.02, y + 2.3, mid, { ry: Math.PI / 2 });
        k.flat(C.tex('kitchenfloor', checkerTex(0x8a2a1a, 0x8a2a1a), 0.3), r.x0, r.z0, x - 0.12, r.z1, y + 0.035, { tile: [0.6, 0.6] });
        // The line: steel counters, a fryer, a flat-top, the hood
        const lx = r.x0 + 0.45;
        k.block(C.steel(), r.x0, y, r.z0 + 0.2, lx + 0.35, y + 0.92, r.z1 - 0.2);
        k.block(C.dark(), lx - 0.3, y + 0.92, r.z0 + 0.6, lx + 0.3, y + 0.95, r.z0 + 1.5);              // flat-top
        k.block(C.steel(), lx - 0.3, y + 0.92, r.z0 + 1.7, lx + 0.3, y + 1.05, r.z0 + 2.4);              // fryer
        k.block(C.color(0xd8a83a, 0.6), lx - 0.25, y + 0.98, r.z0 + 1.75, lx + 0.25, y + 1.02, r.z0 + 2.35);
        k.block(C.steel(), r.x0, y + h - 1.0, r.z0 + 0.2, lx + 0.6, y + h - 0.4, r.z1 - 0.2);           // hood
        k.collide(r.x0, r.z0, lx + 0.35, r.z1, y, y + 1);
        k.spot('cook', lx + 0.7, mid + 0.4, -Math.PI / 2, { y, staff: true });
    },
    stage(ctx, r, opts = {}) {
        const { k, y, h, spec } = ctx;
        const depth = Math.min(opts.runway ? 3.2 : 4.6, (r.x1 - r.x0) * 0.85);
        const x0 = r.x0, x1 = r.x0 + depth;
        const sh = opts.runway ? 0.45 : 0.6;
        const deck = C.color(0x161616, 0.2);
        k.block(deck, x0, y, r.z0, x1, y + sh, r.z1);
        k.block(C.color(0x2a2a2a, 0.3), x1 - 0.02, y, r.z0, x1 + 0.02, y + sh, r.z1);
        k.collide(x0, r.z0, x1, r.z1, y, y + sh + 0.1);
        // Backdrop
        k.plane(C.tex('curtain_black', curtainTex(0x1a1a1a), 0.2), r.z1 - r.z0, h - 0.2, x0 + 0.02, y + h / 2, (r.z0 + r.z1) / 2, { ry: Math.PI / 2, tile: [1.5, h] });
        if (opts.runway) {
            // A runway out into the room for the drag shows
            const mid = (r.z0 + r.z1) / 2;
            k.block(deck, x1, y, mid - 0.7, x1 + 2.6, y + sh, mid + 0.7);
            k.collide(x1, mid - 0.7, x1 + 2.6, mid + 0.7, y, y + sh + 0.1);
            for (let x = x1 + 0.2; x < x1 + 2.6; x += 0.3) for (const f of [-1, 1]) k.sphere(C.bulb(), 0.03, x, y + sh + 0.02, mid + f * 0.66, 6);
        }
        // Lighting truss with par cans
        const tx = x1 - 0.3;
        k.block(C.chrome(), tx - 0.12, y + h - 0.65, r.z0 + 0.3, tx + 0.12, y + h - 0.45, r.z1 - 0.3);
        const cols = [0xff2a2a, 0x2a8aff, 0xffd23a, 0xff4ad0, 0x3aff6a];
        for (let z = r.z0 + 0.8, i = 0; z < r.z1 - 0.6; z += 1.1, i++) {
            k.cyl(C.black(), 0.11, 0.11, 0.3, tx, y + h - 0.85, z, { rx: 0.6, seg: 10 });
            k.cyl(mat(`par_${cols[i % 5]}`, { color: cols[i % 5], basic: true }), 0.09, 0.09, 0.02, tx - 0.09, y + h - 0.98, z, { rx: 0.6, seg: 10 });
        }
        // PA stacks either side
        for (const z of [r.z0 + 0.45, r.z1 - 0.45]) {
            k.block(C.tex('grille', grilleTex(), 0.25), x1 - 0.7, y, z - 0.35, x1 - 0.05, y + 1.6, z + 0.35, { tile: [0.6, 0.6] });
            k.collide(x1 - 0.7, z - 0.35, x1 - 0.05, z + 0.35, y, y + 1.6);
        }
        const top = y + sh;
        const mid = (r.z0 + r.z1) / 2;
        if (opts.dj) {
            djBooth(k, x0 + depth * 0.45, mid, top, ctx);
            return;
        }
        // Band gear: drum riser and kit, amps, mic stands, monitor wedges
        const dx = x0 + 1.1;
        k.block(deck, dx - 0.9, top, mid - 1.0, dx + 0.9, top + 0.3, mid + 1.0);
        drumKit(k, dx, top + 0.3, mid);
        for (const f of [-1, 1]) {
            const az = mid + f * Math.min(2.2, (r.z1 - r.z0) / 2 - 0.9);
            k.block(C.tex('grille', grilleTex(), 0.25), x0 + 0.3, top, az - 0.4, x0 + 0.75, top + 1.25, az + 0.4, { tile: [0.6, 0.6] });
            k.block(C.black(), x0 + 0.3, top + 1.25, az - 0.4, x0 + 0.75, top + 1.5, az + 0.4);
            k.block(C.black(), x1 - 0.6, top, az - 0.3, x1 - 0.25, top + 0.3, az + 0.3, { rz: 0.4 });
        }
        const players = [[x1 - 1.3, mid - 1.4, 'guitar'], [x1 - 1.0, mid, 'singer'], [x1 - 1.3, mid + 1.4, 'bass']];
        for (const [px, pz, kind] of players) {
            if (pz < r.z0 + 0.5 || pz > r.z1 - 0.5) continue;
            k.cyl(C.black(), 0.012, 0.012, 1.5, px + 0.35, top + 0.75, pz, { seg: 4 });              // mic stand
            k.sphere(C.chrome(), 0.04, px + 0.35, top + 1.52, pz, 6);
            k.cyl(C.black(), 0.15, 0.15, 0.02, px + 0.35, top + 0.01, pz, { seg: 8 });
            k.spot(kind === 'singer' ? 'singer' : 'guitar', px, pz, Math.PI / 2, { y: top, band: true, instrument: kind });
        }
        k.spot('drums', dx - 0.35, mid, Math.PI / 2, { y: top + 0.3, band: true, seatH: 0.55 });
        // Set list taped to the floor, and a few guitars on stands for when nobody's playing
        void spec;
    },
    dance(ctx, r) {
        const { k, y, h } = ctx;
        const x0 = r.x0 + 0.3, x1 = r.x1 - 0.3, z0 = r.z0 + 0.3, z1 = r.z1 - 0.3;
        // LED floor (animated: its texture steps through four patterns)
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), ledMaterial());
        floor.rotation.x = -Math.PI / 2;
        floor.position.set((x0 + x1) / 2, y + 0.05, (z0 + z1) / 2);
        const uv = floor.geometry.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x1 - x0) / 4 * 0.25, uv.getY(i) * (z1 - z0) / 4);
        k.extra.push(floor);
        // Mirror ball
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 10), mat('mirrorball', { map: mirrorTex(), metal: 0.9, rough: 0.1, glow: 0.6 }));
        ball.position.set((x0 + x1) / 2, y + h - 0.85, (z0 + z1) / 2);
        ball.userData.spin = 0.6;
        k.extra.push(ball);
        k.cyl(C.black(), 0.008, 0.008, 0.5, ball.position.x, y + h - 0.3, ball.position.z, { seg: 4 });
        // Moving-head beams sweeping the floor
        const cols = [0xff3a7a, 0x3ad0ff, 0x8a3aff, 0x3aff8a];
        for (let i = 0; i < 2; i++) {
            const corner = [x0 + 0.3, i ? z1 - 0.3 : z0 + 0.3];
            const beam = new THREE.Mesh(new THREE.ConeGeometry(0.7, h - 0.4, 12, 1, true), new THREE.MeshBasicMaterial({
                color: cols[(hashStr(ctx.bar.name) + i) % 4], transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false
            }));
            beam.geometry.translate(0, -(h - 0.4) / 2, 0);
            const head = new THREE.Group();
            head.position.set(corner[0], y + h - 0.25, corner[1]);
            head.add(beam);
            head.userData.sweep = { phase: i * 2.1, base: i ? -0.5 : 0.5 };
            k.extra.push(head);
            k.block(C.black(), corner[0] - 0.15, y + h - 0.3, corner[1] - 0.15, corner[0] + 0.15, y + h - 0.05, corner[1] + 0.15);
        }
        // Speakers in the corners
        for (const [sx, sz] of [[x1 - 0.3, z0 + 0.3], [x1 - 0.3, z1 - 0.3]]) {
            k.block(C.tex('grille', grilleTex(), 0.25), sx - 0.3, y + h - 1.4, sz - 0.25, sx + 0.3, y + h - 0.6, sz + 0.25, { tile: [0.6, 0.6] });
        }
        // Dancers
        const rr = ctx.r;
        const n = Math.max(3, Math.floor((x1 - x0) * (z1 - z0) / 1.6));
        for (let i = 0; i < n; i++) k.spot('dance', x0 + 0.4 + rr() * (x1 - x0 - 0.8), z0 + 0.4 + rr() * (z1 - z0 - 0.8), rr() * 6.28, { y });
    },
    dj(ctx, r) {
        const { k, y } = ctx;
        djBooth(k, r.x0 + 0.9, (r.z0 + r.z1) / 2, y, ctx);
        k.block(C.color(0x161616, 0.2), r.x0, y, r.z0 + 0.3, r.x0 + 1.9, y + 0.25, r.z1 - 0.3);      // riser
        k.collide(r.x0, r.z0 + 0.3, r.x0 + 1.9, r.z1 - 0.3, y, y + 0.3);
    },
    lobby(ctx, r) {
        // Theatre lobby: concession counter, a popcorn machine, posters, the old ticket booth, a
        // partition with doors through to the hall
        const { k, y, h, sf } = ctx;
        const wall = C.tex('lobbywall', paintTex(0x5a1a20), 0.3);
        const x = r.x0;
        const mid = 0;
        wallWithHoles(k, wall, x - 0.15, x, y, y + h, r.z0, r.z1, [
            { z0: mid - 2.4, z1: mid - 0.9, y0: y, y1: y + 2.6 }, { z0: mid + 0.9, z1: mid + 2.4, y0: y, y1: y + 2.6 }], [2, 2]);
        k.collide(x - 0.15, r.z0, x, mid - 2.4, y, y + h);
        k.collide(x - 0.15, mid - 0.9, x, mid + 0.9, y, y + h);
        k.collide(x - 0.15, mid + 2.4, x, r.z1, y, y + h);
        k.plane(C.basicTex('hallsign', neonTex('BALLROOM', 0xffd86a)), 2, 0.6, x + 0.02, y + 3.2, mid, { ry: Math.PI / 2 });
        // Concession stand
        const cz = r.z0 + 0.6;
        k.block(C.tex('decofront', panelTex(0x6a1a1a), 0.3), x + 0.6, y, cz - 0.4, r.x1 - 0.8, y + 1.0, cz + 0.4, { tile: [1.2, 1.2] });
        k.block(C.glass(), x + 0.7, y + 1.0, cz - 0.3, x + 2.2, y + 1.4, cz + 0.3);
        k.block(C.color(0xd02a2a, 0.5), x + 2.6, y + 1.0, cz - 0.3, x + 3.2, y + 1.9, cz + 0.3);          // popcorn machine
        k.block(C.color(0xffd86a, 0.8), x + 2.65, y + 1.3, cz - 0.25, x + 3.15, y + 1.6, cz + 0.25);
        k.collide(x + 0.6, cz - 0.4, r.x1 - 0.8, cz + 0.4, y, y + 1.1);
        k.spot('bartender', (x + r.x1) / 2, r.z0 + 0.15, 0, { y, staff: true });
        // Framed posters on the other wall
        for (let i = 0; i < 3; i++) k.plane(C.tex(`lobbyposter_${i}`, posterTex(1926 + i), 0.45), 0.8, 1.15, x + 0.8 + i * 1.2, y + 1.8, r.z1 - 0.02, { ry: Math.PI });
        void sf;
    },
    theater(ctx, r) {
        // The Cla-Zel's old stage: proscenium arch, red curtains, the screen, a DJ on the boards
        const { k, y, h } = ctx;
        const depth = Math.min(5, (r.x1 - r.x0) * 0.85);
        const x0 = r.x0, x1 = r.x0 + depth;
        const sh = 0.9;
        k.block(C.tex('stageboards', woodTex(0x3a2414, { planks: 12 }), 0.3), x0, y, r.z0, x1, y + sh, r.z1, { tile: [2, 2] });
        k.collide(x0, r.z0, x1, r.z1, y, y + sh + 0.1);
        const gold = C.brass();
        const ah = Math.min(h - 0.8, 6.5);
        // Proscenium
        for (const f of [-1, 1]) k.block(gold, x1 - 0.3, y, f < 0 ? r.z0 : r.z1 - 0.6, x1, y + ah, f < 0 ? r.z0 + 0.6 : r.z1);
        k.block(gold, x1 - 0.3, y + ah - 0.8, r.z0, x1, y + ah, r.z1);
        for (let i = 0; i < 5; i++) k.block(gold, x1 - 0.32, y + ah - 0.75 + i * 0.12, r.z0 + 0.6 + i * 0.25, x1 - 0.28, y + ah - 0.7 + i * 0.12, r.z1 - 0.6 - i * 0.25);
        // Screen and curtains
        const sw = (r.z1 - r.z0) * 0.65;
        k.plane(C.tex('screen', tvTex(4), 0.7), sw, sw * 0.42, x0 + 0.05, y + sh + 0.6 + sw * 0.21 + 0.6, (r.z0 + r.z1) / 2, { ry: Math.PI / 2 });
        const curtain = C.tex('curtain_red', curtainTex(0x8a0f1a), 0.35);
        for (const f of [-1, 1]) {
            const cz = f < 0 ? r.z0 + 0.6 + 0.9 : r.z1 - 0.6 - 0.9;
            k.plane(curtain, 1.8, ah - 1.0, x1 - 0.5, y + (ah - 1.0) / 2 + sh / 2, cz, { ry: Math.PI / 2, tile: [1.2, ah] });
        }
        k.plane(curtain, r.z1 - r.z0 - 1.2, 0.9, x1 - 0.45, y + ah - 1.25, (r.z0 + r.z1) / 2, { ry: Math.PI / 2, tile: [1.2, 1] });
        djBooth(k, x1 - 1.6, (r.z0 + r.z1) / 2, y + sh, ctx);
        // Footlights
        for (let z = r.z0 + 0.8; z < r.z1 - 0.6; z += 0.5) k.sphere(C.bulb(), 0.04, x1 + 0.05, y + sh + 0.02, z, 6);
    }
};

function poolTable(k, x, z, y, h, feltColor, seed) {
    const wood = C.color(0x3a2010, 0.3);
    const L = 2.7, Wd = 1.5;
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.block(wood, x + lx * (L / 2 - 0.2) - 0.08, y, z + lz * (Wd / 2 - 0.15) - 0.08, x + lx * (L / 2 - 0.2) + 0.08, y + 0.62, z + lz * (Wd / 2 - 0.15) + 0.08);
    k.block(wood, x - L / 2, y + 0.6, z - Wd / 2, x + L / 2, y + 0.78, z + Wd / 2);
    k.flat(C.felt(feltColor), x - L / 2 + 0.13, z - Wd / 2 + 0.13, x + L / 2 - 0.13, z + Wd / 2 - 0.13, y + 0.79);
    for (const f of [-1, 1]) {
        k.block(wood, x - L / 2, y + 0.78, z + f * (Wd / 2 - 0.065) - 0.065, x + L / 2, y + 0.84, z + f * (Wd / 2 - 0.065) + 0.065);
        k.block(wood, x + f * (L / 2 - 0.065) - 0.065, y + 0.78, z - Wd / 2, x + f * (L / 2 - 0.065) + 0.065, y + 0.84, z + Wd / 2);
    }
    for (const px of [-L / 2 + 0.13, 0, L / 2 - 0.13]) for (const f of [-1, 1]) k.cyl(C.black(), 0.06, 0.06, 0.02, x + px, y + 0.8, z + f * (Wd / 2 - 0.13), { seg: 8 });
    const r = rng(seed);
    const ballCols = [0xffffff, 0xf2c82a, 0x2a4ad0, 0xd02a2a, 0x6a2a8a, 0xf28a2a, 0x2a8a3a, 0x8a1a1a, 0x111111];
    for (let i = 0; i < 9; i++) k.sphere(C.color(ballCols[i], 0.4), 0.028, x + (r() - 0.5) * (L - 0.5), y + 0.82, z + (r() - 0.5) * (Wd - 0.5), 8);
    k.cyl(C.color(0xc89a5a, 0.3), 0.01, 0.014, 1.45, x + 0.2, y + 0.84, z + 0.25, { rz: Math.PI / 2, ry: 0.4, seg: 6 });
    // Lamp over the table
    k.block(C.color(0x1a3a1a, 0.4), x - 0.8, y + Math.min(h, 3.4) - 1.55, z - 0.17, x + 0.8, y + Math.min(h, 3.4) - 1.4, z + 0.17);
    k.flat(C.lightPanel(), x - 0.75, z - 0.14, x + 0.75, z + 0.14, y + Math.min(h, 3.4) - 1.56, { up: false });
    for (const f of [-1, 1]) k.cyl(C.black(), 0.005, 0.005, Math.max(0.1, h - (Math.min(h, 3.4) - 1.4)), x + f * 0.6, y + (h + Math.min(h, 3.4) - 1.4) / 2, z, { seg: 4 });
    k.collide(x - L / 2, z - Wd / 2, x + L / 2, z + Wd / 2, y, y + 0.85);
}

function drumKit(k, x, y, z) {
    const shell = C.color(0x8a1a2a, 0.35), head = C.color(0xe8e4d8, 0.4);
    k.cyl(shell, 0.28, 0.28, 0.4, x + 0.35, y + 0.3, z, { rx: Math.PI / 2, ry: Math.PI / 2, seg: 16 });       // kick
    k.cyl(head, 0.27, 0.27, 0.01, x + 0.56, y + 0.3, z, { rz: Math.PI / 2, seg: 16 });
    k.cyl(shell, 0.18, 0.18, 0.15, x + 0.15, y + 0.62, z - 0.35, { seg: 14 });                                 // snare
    for (const dz of [-0.15, 0.15]) k.cyl(shell, 0.14, 0.14, 0.18, x + 0.38, y + 0.78, z + dz, { seg: 12, rz: 0.3 });
    k.cyl(shell, 0.2, 0.2, 0.35, x + 0.15, y + 0.45, z + 0.45, { seg: 14 });                                   // floor tom
    for (const [dz, hgt] of [[-0.6, 1.15], [0.55, 1.25], [-0.25, 1.35]]) {
        k.cyl(C.chrome(), 0.008, 0.008, hgt, x + 0.3, y + hgt / 2, z + dz, { seg: 4 });
        k.cyl(C.brass(), 0.22, 0.22, 0.008, x + 0.3, y + hgt, z + dz, { seg: 14 });
    }
    k.cyl(C.black(), 0.16, 0.16, 0.08, x - 0.35, y + 0.55, z, { seg: 10 });                                   // throne
    k.cyl(C.chrome(), 0.02, 0.02, 0.5, x - 0.35, y + 0.25, z, { seg: 4 });
}

function djBooth(k, x, z, y, ctx) {
    const glow = ctx.spec.bar.glow || 0xff3a7a;
    k.block(C.black(), x - 0.45, y, z - 1.1, x + 0.45, y + 1.05, z + 1.1);
    k.plane(C.basicTex(`djfront_${glow}`, ledStrip(glow)), 2.1, 0.9, x + 0.46, y + 0.5, z, { ry: Math.PI / 2 });
    for (const dz of [-0.55, 0.55]) {
        k.block(C.dark(), x - 0.25, y + 1.05, z + dz - 0.22, x + 0.25, y + 1.12, z + dz + 0.22);
        k.cyl(C.black(), 0.16, 0.16, 0.015, x, y + 1.13, z + dz, { seg: 16 });
    }
    k.block(C.dark(), x - 0.2, y + 1.05, z - 0.2, x + 0.2, y + 1.15, z + 0.2);
    k.block(C.color(0x1a1a1a, 0.2), x - 0.38, y + 1.05, z + 0.85, x - 0.12, y + 1.25, z + 1.05, { rz: -0.4 });     // laptop
    k.plane(C.basicTex('laptop', arcadeTex(99)), 0.24, 0.16, x - 0.24, y + 1.2, z + 0.95, { ry: Math.PI / 2, rx: 0 });
    k.collide(x - 0.45, z - 1.1, x + 0.45, z + 1.1, y, y + 1.1);
    k.spot('dj', x - 0.75, z, Math.PI / 2, { y, staff: true, night: true });
}

let _led = null;
function ledMaterial() {
    if (_led) return _led;
    const t = ledFloorTex().clone();
    t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    _led = new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
    return _led;
}

function buildPatio(ctx, x0, x1, front = false) {
    // Open-air patio of the upstairs bar (out the back, or across the front over the street):
    // decking, string lights, an outdoor bar, tables with umbrellas and heaters, glass doors
    // from the inside
    const { k, y, room, h, sf } = ctx;
    const z0 = room.z0, z1 = room.z1;
    k.flat(C.tex('decking', woodTex(0x7a5a3a, { planks: 10 }), 0.3), x0, z0, x1, z1, y + 0.05, { tile: [2, 2] });
    const mid = (z0 + z1) / 2;
    const gap = [{ z0: mid - 1.6, z1: mid + 1.6, y0: y, y1: y + 2.5 }];
    // The wall between the inside and the patio, with an opening in the middle
    const wx0 = front ? x0 - 0.2 : x1, wx1 = front ? x0 : x1 + 0.2;
    if (front) {
        // The set-back street front: tan ribbed cladding outside (barFronts.js), the bar's own walls inside
        const tan = C.tex('fribbed_13154456', ribbedTex(0xc8b898), 0.04, { metal: 0.45, rough: 0.45 });
        wallWithHoles(k, tan, wx0, wx1, y, sf.H, z0, z1, gap, [1, 1]);
        const wm = wallMaterial(ctx.spec);
        planeWithHoles(k, wm.m, wx0 - 0.012, y, y + h, z0, z1, gap, wm.tile);
    } else {
        wallWithHoles(k, C.tex('patiowall', brickTex(0x7a4632), 0.3), wx0, wx1, y, y + h, z0, z1, gap, [1.2, 0.6]);
    }
    k.collide(wx0, z0, wx1, mid - 1.6, y, y + h);
    k.collide(wx0, mid + 1.6, wx1, z1, y, y + h);
    const glassX = front ? wx0 - 0.5 : x1 - 0.5;
    for (const f of [-1, 1]) k.plane(C.glass(), 1.4, 2.4, glassX, y + 1.2, mid + f * 1.6, { ry: 0 });
    // People out here go through the opening (inside, then out)
    const inside = front ? wx0 - 0.6 : wx1 + 0.6, outside = front ? wx1 + 0.6 : wx0 - 0.6;
    const via = [[inside, mid], [outside, mid]];
    const spot = (kind, sx, sz, yaw, extra = {}) => k.spot(kind, sx, sz, yaw, { ...extra, via });
    // Railing along the open edge (over the street, the front's own railing does it)
    if (!front) {
        k.block(C.black(), x0 + 0.05, y + 1.0, z0, x0 + 0.12, y + 1.08, z1);
        k.collide(x0, z0, x0 + 0.3, z1, y, y + 1.1);
    }
    // Outdoor bar along one side
    const bz = z1 - 1.0;
    k.block(C.tex('patiobar', woodTex(0x5a3a22, { planks: 6 }), 0.3), x0 + 0.6, y, bz - 0.35, x1 - 0.8, y + 1.05, bz + 0.35, { tile: [2, 2] });
    k.block(C.color(0x1a1a1a, 0.25), x0 + 0.55, y + 1.05, bz - 0.4, x1 - 0.75, y + 1.1, bz + 0.4);
    k.collide(x0 + 0.6, bz - 0.4, x1 - 0.8, bz + 0.4, y, y + 1.1);
    spot('bartender', (x0 + x1) / 2, bz + 0.65, Math.PI, { y, staff: true });
    k.counters.push([x0 + 0.6, bz - 1.6, x1 - 0.8, bz - 0.35, y]);
    // Tables with umbrellas
    for (let x = x0 + 1.2; x < x1 - 0.8; x += 2.4) {
        const tz = z0 + 1.4;
        k.cyl(C.color(0x2a2a2a, 0.3), 0.45, 0.45, 0.04, x, y + 0.74, tz, { seg: 14 });
        k.cyl(C.chrome(), 0.025, 0.025, 2.2, x, y + 1.1, tz, { seg: 6 });
        k.cyl(C.color([0xd02a2a, 0x2a5ad0, 0x2a8a3a][Math.floor(x) % 3], 0.3), 0.05, 1.1, 0.4, x, y + 2.25, tz, { seg: 12 });
        k.collide(x - 0.45, tz - 0.45, x + 0.45, tz + 0.45, y, y + 0.8);
        for (const f of [-1, 1]) spot('sit', x + f * 0.7, tz, f > 0 ? -Math.PI / 2 : Math.PI / 2, { y, seatH: 0.48 });
    }
    // Heater
    k.cyl(C.steel(), 0.04, 0.04, 2.0, x1 - 0.5, y + 1.0, z0 + 0.5, { seg: 6 });
    k.cyl(C.steel(), 0.35, 0.1, 0.25, x1 - 0.5, y + 2.1, z0 + 0.5, { seg: 10 });
    // String lights across the patio
    for (let i = 0; i < 4; i++) {
        const zz = z0 + 0.5 + (z1 - z0 - 1) * i / 3;
        for (let t = 0; t <= 12; t++) k.sphere(C.bulb(), 0.035, x0 + 0.2 + (x1 - x0 - 0.4) * t / 12, y + 2.9 - Math.sin(t / 12 * Math.PI) * 0.35, zz, 6);
    }
    k.music.push({ x: (x0 + x1) / 2, z: mid, gain: 0.8, y, open: true });
}

/** Posters, photos, neon, oars, TVs... along the room's open walls. */
function decorate(ctx) {
    const { k, spec, y, h, walls, r } = ctx;
    const d = spec.decor || {};
    const neon = (d.neon || []).slice();
    let tvLeft = d.tvs || 0;
    for (const w of walls) {
        const len = w.x1 - w.x0;
        if (len < 1) continue;
        const ry = w.facing > 0 ? 0 : Math.PI;
        const z = w.z + w.facing * 0.03;
        if (d.mural && len > 4 && !w.muraled) {
            const ml = Math.min(len - 0.5, 8);
            k.plane(C.tex(`mural_${ctx.bar.name}`, muralTex(hashStr(ctx.bar.name)), 0.5), ml, Math.min(2.4, h - 1.4), w.x0 + len / 2, y + 1.0 + Math.min(2.4, h - 1.4) / 2, z, { ry });
            d.mural = false;
            continue;
        }
        let x = w.x0 + 0.5;
        while (x < w.x1 - 0.5) {
            const roll = r();
            if (tvLeft > 0 && roll < 0.35) {
                tv(k, x + 0.6, y + Math.min(2.5, h - 0.9), z, ry, 1.2, Math.floor(r() * 4));
                tvLeft--; x += 2.4; continue;
            }
            if (neon.length && roll < 0.55) {
                const [text, color, script] = neon.shift();
                k.plane(C.basicTex(`neon_${text}_${color}_${!!script}`, neonTex(text, color, { script: !!script }), true), 1.8, 0.56, x + 0.9, y + Math.min(2.4, h - 1.0), z, { ry });
                x += 2.2; continue;
            }
            if (d.posters && roll < 0.55 + d.posters * 0.35) {
                const seed = hashStr(ctx.bar.name) + Math.round(x * 10);
                k.plane(C.tex(`poster_${seed % 23}`, posterTex(seed % 23), 0.45), 0.55, 0.78, x + 0.3, y + 1.55 + r() * 0.4, z, { ry });
                x += 0.7 + r() * 0.4; continue;
            }
            if (d.photos && roll < 0.8) {
                k.plane(C.tex(`photowall_${ctx.bar.name}`, photosTex(hashStr(ctx.bar.name) + 9), 0.4), 1.6, 0.8, x + 0.8, y + 1.75, z, { ry });
                x += 2; continue;
            }
            if (d.horses && roll < 0.85) {
                k.plane(C.tex(`horse_${Math.floor(x) % 5}`, horseTex(Math.floor(x) % 5), 0.45), 0.8, 0.6, x + 0.4, y + 1.65, z, { ry });
                x += 1.4; continue;
            }
            if (d.wanted && roll < 0.8) {
                k.plane(C.tex(`wanted_${Math.floor(x) % 4}`, wantedTex(Math.floor(x) % 4), 0.45), 0.5, 0.66, x + 0.25, y + 1.7, z, { ry });
                x += 1.1; continue;
            }
            if (d.oars && roll < 0.9) {
                // Two oars crossed on the wall
                for (const a of [0.5, -0.5]) {
                    k.cyl(C.color(0xd8b878, 0.35), 0.025, 0.025, 2.6, x + 1.2, y + 2.2, z + w.facing * 0.03, { rx: Math.PI / 2 * 0, rz: Math.PI / 2 + a, seg: 6 });
                    k.box(C.color(0x0a2a6a, 0.35), 0.5, 0.16, 0.02, x + 1.2 + Math.cos(a) * 1.15, y + 2.2 + Math.sin(a) * 1.15, z + w.facing * 0.03, { rz: a });
                }
                x += 3; continue;
            }
            x += 0.9;
        }
        if (d.pennants) {
            // A string of pennants along the top of the wall
            for (let px = w.x0 + 0.3; px < w.x1 - 0.3; px += 0.45) {
                k.box(C.color([0xff8a1a, 0x5a2a0a, 0xffffff, 0x1a3a7a][Math.floor(px / 0.45) % 4], 0.45), 0.3, 0.3, 0.01, px, y + h - 0.45, z + w.facing * 0.01, { rz: Math.PI / 4, ry });
            }
        }
        if (d.sconces) for (let sx = w.x0 + 1; sx < w.x1 - 0.5; sx += 3) {
            k.box(C.brass(), 0.35, 0.5, 0.12, sx, y + 2.6, w.z + w.facing * 0.07, { ry });
            k.box(C.bulb(), 0.25, 0.3, 0.05, sx, y + 2.7, w.z + w.facing * 0.14, { ry });
        }
        if (d.horns && w.facing === -spec.bar.side) {
            // Longhorns over the counter's end
            const hx = w.x0 + 0.8;
            for (const f of [-1, 1]) k.cyl(C.color(0xe8dcc0, 0.4), 0.01, 0.04, 0.9, hx + f * 0.45, y + 2.75 + 0.1, w.z + w.facing * 0.1, { rz: f * 1.3, seg: 6 });
            k.box(C.color(0x3a2a1a, 0.3), 0.22, 0.25, 0.12, hx, y + 2.75, w.z + w.facing * 0.08, { ry });
            d.horns = false;
        }
    }
    if (d.menu && walls[2]) {
        const w = walls[2];
        k.plane(C.tex('menu', menuTex('ON TAP'), 0.45), 1.0, 0.75, w.x0 + 0.8, y + 2.0, w.z + w.facing * 0.03, { ry: w.facing > 0 ? 0 : Math.PI });
    }
    if (d.bigscreen) {
        // Big screen on the back wall
        const bw = Math.min(2.6, (ctx.room.z1 - ctx.room.z0) - 1.5);
        const bx = ctx.room.x0 + (ctx.room.hasRestrooms ? 3.17 : 0) + 0.06;
        k.box(C.black(), 0.06, bw * 0.58 + 0.08, bw + 0.08, bx, y + Math.min(2.2, h - 1.0), (ctx.room.z0 + ctx.room.z1) / 2);
        k.plane(C.basicTex('tv_1', tvTex(1)), bw, bw * 0.58, bx + 0.04, y + Math.min(2.2, h - 1.0), (ctx.room.z0 + ctx.room.z1) / 2, { ry: Math.PI / 2 });
    }
    // Whatever neon is left goes in a row over the back
    neon.forEach(([text, color, script], i) => {
        const w = walls[0];
        k.plane(C.basicTex(`neon_${text}_${color}_${!!script}`, neonTex(text, color, { script: !!script }), true), 1.6, 0.5, w.x0 + 1 + i * 2, y + Math.min(2.8, h - 0.6), w.z + w.facing * 0.03, { ry: w.facing > 0 ? 0 : Math.PI });
    });
}

// ------------------------------------------------------------------------------------------------
// Stairs to the upstairs bar
// ------------------------------------------------------------------------------------------------
function buildStairs(k, sf) {
    const st = sf.stairs;
    const za = Math.min(st.z0, st.z1), zb = Math.max(st.z0, st.z1);
    const n = 18, rise = UP / n, tread = BAR_CONFIG.STAIR_RUN / n;
    const stepM = C.tex('stairtread', woodTex(0x3a2414, { planks: 4 }), 0.3);
    const wall = C.tex('stairwall', paintTex(0x2a2a30), 0.3);
    for (let i = 0; i < n; i++) k.block(stepM, st.xb - (i + 1) * tread, 0, za, st.xb - i * tread, (i + 1) * rise, zb, { tile: [1, 1] });
    k.flat(stepM, st.xb, za, -T, zb, 0.03, { tile: [1, 1] });
    // Partition between the stairs and the ground-floor bar, and the end under the landing
    const zp = st.side > 0 ? za - 0.15 : zb, zq = st.side > 0 ? za : zb + 0.15;
    k.block(wall, st.xt - 0.15, 0, zp, -T, G, zq, { tile: [2, 2] });
    k.collide(st.xt - 0.15, zp, -T, zq, 0, G);
    k.block(wall, st.xt - 0.15, 0, za, st.xt, G, zb);
    k.collide(st.xt - 0.15, za, st.xt, zb, 0, UP - 0.4);
    // Stairwell finish and a handrail
    const outer = st.side > 0 ? zb : za;
    k.plane(wall, BAR_CONFIG.STAIR_RUN + 1.3, UP + 3, (st.xt - T) / 2, (UP + 3) / 2, outer - st.side * 0.012, { ry: st.side > 0 ? Math.PI : 0, tile: [2, 2] });
    const hz = outer - st.side * 0.08;
    const railLen = Math.hypot(BAR_CONFIG.STAIR_RUN, UP);
    k.cyl(C.brass(), 0.025, 0.025, railLen, (st.xb + st.xt) / 2, UP / 2 + 0.95, hz, { rz: Math.atan2(BAR_CONFIG.STAIR_RUN, UP), seg: 6 });
    // Upstairs: railing round the stairwell
    const ry0 = UP, ry1 = UP + 1.05;
    const inner = st.side > 0 ? za : zb;
    k.block(C.black(), st.xt, ry1 - 0.06, inner - 0.04, -T, ry1, inner + 0.04);
    for (let x = st.xt + 0.1; x < -T; x += 0.12) k.block(C.black(), x - 0.012, ry0, inner - 0.012, x + 0.012, ry1, inner + 0.012);
    k.collide(st.xt, inner - 0.08, -T, inner + 0.08, ry0, ry1);
    // Lights
    k.sphere(C.bulb(), 0.1, -1.2, G - 0.2, (za + zb) / 2, 8);
    k.sphere(C.bulb(), 0.1, st.xt + 1, UP + 3.2, (za + zb) / 2, 8);
}

// ------------------------------------------------------------------------------------------------
// The system
// ------------------------------------------------------------------------------------------------
// Sound: a song from media/barmusic (bass boosted) over a crowd murmur, muffled through the walls
// ------------------------------------------------------------------------------------------------
export class BarAudio {
    constructor() {
        this.ctx = null;
        this.music = null;          // { el, src, shelf, sub, filter, gain }
        this.crowd = null;
        this.playing = false;
        this.quietFor = 0;
        this.bar = null;            // whose song is loaded
    }

    /** Hooks into the game's AudioContext (made on the first click / key). */
    setContext(ctx) {
        if (this.ctx || !ctx || typeof Audio === 'undefined') return;
        this.ctx = ctx;
        const chain = (url, loop, bass) => {
            const el = new Audio();
            el.preload = 'auto';
            el.loop = loop;
            if (url) el.src = url;
            const src = ctx.createMediaElementSource(el);
            let node = src;
            let shelf = null, sub = null;
            if (bass) {
                // Club bass: a big low shelf plus a bump right at the kick
                shelf = ctx.createBiquadFilter();
                shelf.type = 'lowshelf'; shelf.frequency.value = 130; shelf.gain.value = 7;
                sub = ctx.createBiquadFilter();
                sub.type = 'peaking'; sub.frequency.value = 55; sub.Q.value = 0.9; sub.gain.value = 3.5;
                node.connect(shelf); shelf.connect(sub); node = sub;
            }
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass'; filter.frequency.value = 400; filter.Q.value = 0.7;
            const gain = ctx.createGain();
            gain.gain.value = 0;
            node.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
            return { el, src, shelf, sub, filter, gain };
        };
        this.music = chain(null, false, true);
        // A bar's song ends: that bar moves on to the next one in the list
        this.music.el.addEventListener('ended', () => {
            const b = this.bar;
            if (!b) return;
            b.song = (b.song + 1) % BAR_CONFIG.MUSIC.length;
            b.songTime = 0;
            this._load(b);
            if (this.playing) this.music.el.play().catch(() => {});
        });
        this.crowd = chain(BAR_CONFIG.CROWD_SOUND, true, false);
        this.panic = chain(null, true, false);
        this.panicOn = false;
    }

    /**
     * The screaming of a bar emptying out after shots. `p` is { level, inside } while it lasts
     * (heard like the bar itself: clear in the room, muffled outside), null once everyone is out.
     */
    updatePanic(p) {
        if (!this.ctx || !this.panic || this.ctx.state !== 'running') return;
        const now = this.ctx.currentTime;
        const ch = this.panic;
        if (p && !this.panicOn) {
            this.panicOn = true;
            const list = BAR_CONFIG.PANIC_SOUNDS;
            ch.el.src = list[Math.floor(Math.random() * list.length)];
            ch.el.currentTime = 0;
            ch.gain.gain.cancelScheduledValues(now);
            ch.gain.gain.setValueAtTime(0, now);
            ch.el.play().catch(() => {});
        } else if (!p && this.panicOn) {
            // Everyone's out: the screaming dies away
            this.panicOn = false;
            ch.gain.gain.setTargetAtTime(0, now, 0.6);
            clearTimeout(this._panicStop);
            this._panicStop = setTimeout(() => { if (!this.panicOn) ch.el.pause(); }, 3000);
        }
        if (!p) return;
        clearTimeout(this._panicStop);
        const level = Math.max(0, Math.min(1, p.level));
        ch.gain.gain.setTargetAtTime(level * (p.inside ? 0.9 : 0.6), now, 0.12);
        ch.filter.frequency.setTargetAtTime(p.inside ? 16000 : 700, now, 0.15);
    }

    /** Puts bar `b`'s song on, where it had got to (each bar keeps playing its own song while you're away). */
    _load(b) {
        const el = this.music.el;
        if (this.bar && this.bar !== b) this.bar.songAt = { t: el.currentTime, when: performance.now() };
        this.bar = b;
        el.src = BAR_CONFIG.MUSIC[b.song % BAR_CONFIG.MUSIC.length];
        let t;
        if (b.songAt) t = b.songAt.t + (performance.now() - b.songAt.when) / 1000;   // it kept playing in there
        else t = Math.random() * 90;                                                   // walked in mid-song
        const seek = () => {
            const d = el.duration;
            if (Number.isFinite(d) && d > 0) {
                if (t > d - 1) { b.song = (b.song + 1) % BAR_CONFIG.MUSIC.length; b.songAt = null; return this._load(b); }
                el.currentTime = t;
            }
        };
        if (el.readyState >= 1) seek(); else el.addEventListener('loadedmetadata', seek, { once: true });
    }

    /**
     * @param {number} dt
     * @param {{inside: boolean, level: number, bar: Object}} h from Bars._hearing
     */
    update(dt, h) {
        if (!this.ctx || !this.music || this.ctx.state !== 'running') return;
        const now = this.ctx.currentTime;
        const level = Math.max(0, Math.min(1, h.level));
        if (level > 0.01) {
            this.quietFor = 0;
            // Whichever bar you're in (or nearest) is the one you hear
            if (h.bar && h.bar !== this.bar) {
                this._load(h.bar);
                if (this.playing) this.music.el.play().catch(() => {});
            }
            if (!this.playing) {
                this.playing = true;
                this.music.el.play().catch(() => {});
                this.crowd.el.play().catch(() => {});
            }
        } else if (this.playing) {
            this.quietFor += dt;
            if (this.quietFor > 2) {
                this.playing = false;
                this.music.el.pause();
                this.crowd.el.pause();
            }
        }
        // In the room: full range and loud. Outside: the walls only let the thump and a murmur through.
        const inside = h.inside;
        this.music.gain.gain.setTargetAtTime(level * (inside ? 0.6 : 0.55), now, 0.25);
        this.music.filter.frequency.setTargetAtTime(inside ? 18000 : 320, now, 0.15);
        // (No chatter while the place is screaming)
        this.crowd.gain.gain.setTargetAtTime(this.panicOn ? 0 : level * (inside ? 0.58 : 0.42), now, 0.25);
        this.crowd.filter.frequency.setTargetAtTime(inside ? 16000 : 700, now, 0.15);
    }
}

export class Bars {
    /**
     * @param {Object} o
     * @param {THREE.Scene} o.scene
     * @param {Object} [o.spatialGrid]
     * @param {Object} [o.pedestrians] PedestrianSystem (staff and crowds are rigs drawn through extraRigs)
     */
    constructor({ scene, spatialGrid = null, pedestrians = null }) {
        this.audio = new BarAudio();
        this.scene = scene;
        this.spatialGrid = spatialGrid;
        this.pedestrians = pedestrians;
        this.storefronts = [];
        this.buildings = [];
        this.time = 0;
        this.rigs = 0;
        this._l = {};
        this._w = {};
        this.onOrder = null;          // (bar) => void
    }

    /** Takes the baked data/bars.json. */
    load(data) {
        this.buildings = data.buildings.map((b) => ({ ...b }));
        const byRect = new Map();
        for (const raw of data.bars) {
            const key = `${raw.minX},${raw.maxX},${raw.minZ},${raw.maxZ}`;
            if (!byRect.has(key)) byRect.set(key, { raw, bars: [] });
            byRect.get(key).bars.push(raw);
        }
        for (const { raw, bars } of byRect.values()) {
            const sf = prepareStorefront(raw);
            const ground = bars.find((b) => b.level === 0);
            const upper = bars.find((b) => b.level === 1);
            sf.name = (ground || upper).name;
            sf.ground = ground ? { name: ground.name, spec: specFor(ground.name), level: 0 } : null;
            sf.upper = upper ? { name: upper.name, spec: specFor(upper.name), level: 1 } : null;
            sf.facadeSpec = (sf.ground || sf.upper).spec;
            sf.tall = !!sf.facadeSpec.tall;
            sf.levels = Math.max(sf.upper ? 2 : 1, raw.levels || 2);
            if (sf.tall) sf.levels = Math.max(2, sf.levels);
            sf.H = sf.levels <= 1 ? G + 0.5 : UP + STOREY * (sf.levels - 1);
            // The photographed fronts know how tall the real building is (barFronts.js)
            const fr = FRONTS[sf.name];
            if (fr) {
                if (fr.levels) sf.levels = Math.max(sf.upper ? 2 : 1, fr.levels);
                sf.H = fr.height || (sf.levels <= 1 ? G + 0.5 : UP + STOREY * (sf.levels - 1));
            }
            sf.patioFront = !!(sf.upper && sf.upper.spec.patioFront);
            this._plan(sf);
            this.storefronts.push(sf);
        }
        for (const f of data.fillers || []) {
            const sf = prepareStorefront(f);
            sf.name = `filler_${f.minX}_${f.minZ}`;
            sf.filler = true;
            sf.levels = Math.max(1, f.levels || 2);
            sf.H = sf.levels <= 1 ? G + 0.5 : UP + STOREY * (sf.levels - 1);
            sf.facadeSpec = { facade: { brick: 0x8a5a3a, trim: 0x2a2a2a, sign: { text: '', bg: 0x2a2a2a, fg: 0x2a2a2a } } };
            sf.doors = [{ z0: -0.5, z1: 0.5, kind: 'shop' }];
            this.storefronts.push(sf);
        }
        // Each bar has its own song: dealt out in street order so next-door bars never play the same one
        const bars = [];
        for (const sf of this.storefronts) for (const b of [sf.ground, sf.upper]) if (b) bars.push({ b, key: sf.x + sf.z * 0.001 + b.level * 1e-6 });
        bars.sort((a, c) => a.key - c.key).forEach(({ b }, i) => { b.song = i % BAR_CONFIG.MUSIC.length; b.songTime = null; });
        for (const sf of this.storefronts) {
            sf.built = false;
            sf.bounds = sf.rect;
            sf.rigs = [];
            sf.crowded = false;
        }
        return this.storefronts;
    }

    /** Doors, stairs and the sign spot for a storefront. */
    _plan(sf) {
        const W2 = sf.W / 2;
        const g = sf.ground ? sf.ground.spec : null;
        if (sf.upper) {
            const side = sf.upper.spec.stairSide || (g ? (g.stairSide || -g.bar.side) : 1);
            const zOut = side * (W2 - T), zIn = zOut - side * BAR_CONFIG.STAIR_W;
            const xb = -T - 1.1;
            sf.stairs = { side, z0: zIn, z1: zOut, xb, xt: xb - BAR_CONFIG.STAIR_RUN };
        }
        sf.doors = [];
        if (sf.stairs) {
            const zc = (sf.stairs.z0 + sf.stairs.z1) / 2;
            sf.doors.push({ z0: zc - 0.5, z1: zc + 0.5, kind: 'stairs' });
        }
        if (sf.ground) {
            const s = g.bar.side;
            // The door goes away from the counter (and the stairs), but not in the corner
            let dz = sf.facadeSpec.facade && sf.facadeSpec.facade.theater ? 0 : -s * Math.min(W2 * 0.35, 1.8);
            if (sf.stairs) dz = -sf.stairs.side * Math.min(W2 * 0.3, 1.6);
            if (sf.W < 7) dz = -s * (W2 - 1.4);
            let w = sf.facadeSpec.facade && sf.facadeSpec.facade.theater ? 2.4 : 1.2;
            // Where the real door is (barFronts.js: 0..1 across the front from the left as you face it)
            const fr = FRONTS[sf.name];
            if (fr && fr.door !== undefined) {
                w = fr.doorW || w;
                let lo = -W2 + T + 0.25 + w / 2, hi = W2 - T - 0.25 - w / 2;
                if (sf.stairs) {
                    if (sf.stairs.side > 0) hi = Math.min(hi, Math.min(sf.stairs.z0, sf.stairs.z1) - 0.4 - w / 2);
                    else lo = Math.max(lo, Math.max(sf.stairs.z0, sf.stairs.z1) + 0.4 + w / 2);
                }
                dz = Math.max(lo, Math.min(hi, W2 - fr.door * sf.W));
            }
            sf.doors.push({ z0: dz - w / 2, z1: dz + w / 2, kind: 'main' });
            sf.mainDoorZ = dz;
            sf.signZ = 0;
        }
    }

    /**
     * Puts the city's walking-nav bar doors (cityNav.js; where the queues and bouncers go, and where
     * people walk in and out) on these storefronts' real entrances: each entrance takes the nearest
     * nav door and makes it a bar door, and any other bar door left inside a bar becomes a plain one.
     */
    alignDoors(nav) {
        if (!nav || !nav.doorCount || this._alignedNav === nav || !this.storefronts.length) return;
        this._alignedNav = nav;
        const used = new Set();
        const buf = [];
        const near = (r, x, z, m) => x > r.minX - m && x < r.maxX + m && z > r.minZ - m && z < r.maxZ + m;
        for (const sf of this.storefronts) {
            if (sf.filler) continue;
            for (const d of sf.doors) {
                const p = localToWorld(sf, 0.45, (d.z0 + d.z1) / 2);
                nav.doorsInRing(p.x, p.z, 0, 30, buf);
                let best = -1, bestD = Infinity;
                for (const i of buf) {
                    if (used.has(i)) continue;
                    // Doors of this building first, then whatever is closest
                    const dd = Math.hypot(nav.doorX[i] - p.x, nav.doorZ[i] - p.z) - (near(sf.rect, nav.doorX[i], nav.doorZ[i], 3) ? 20 : 0);
                    if (dd < bestD) { bestD = dd; best = i; }
                }
                if (best < 0) continue;
                used.add(best);
                nav.moveDoor(best, p.x, p.z, DOOR_KIND.BAR);
            }
        }
        for (let i = 0; i < nav.doorCount; i++) {
            if (used.has(i) || nav.doorKind[i] !== DOOR_KIND.BAR) continue;
            for (const sf of this.storefronts) if (near(sf.rect, nav.doorX[i], nav.doorZ[i], 2)) { nav.doorKind[i] = DOOR_KIND.OTHER; break; }
        }
        nav.refreshDoors();
        this.alignedDoors = used.size;
    }

    // ---------------------------------------------------------------------------------------------
    // Clearing the map's buildings
    // ---------------------------------------------------------------------------------------------
    /** Cuts the map's own buildings (tile triangles and colliders) where the bars go. */
    carve(tiles) {
        if (!Array.isArray(tiles) || !tiles.length || this._carved || !this.buildings.length) return;
        this._carved = true;
        const M = 0.35;
        const B = this.buildings;
        const v = new THREE.Vector3(), box = new THREE.Box3();
        const inB = (b, x, z) => x > b.minX - M && x < b.maxX + M && z > b.minZ - M && z < b.maxZ + M;
        // The map's own awnings and canopies out over the sidewalk in front of a rebuilt storefront
        const strips = this.storefronts.filter((sf) => !sf.filler && FRONTS[sf.name]).map((sf) => ({ sf, c: Math.cos(sf.theta), s: Math.sin(sf.theta) }));
        const inStrip = (st, x, y, z) => {
            const dx = x - st.sf.x, dz = z - st.sf.z;
            const lx = dx * st.c - dz * st.s, lz = dx * st.s + dz * st.c;
            return y > 1.8 && lx > 0.02 && lx < 4.5 && Math.abs(lz) < st.sf.W / 2 + 0.3;
        };
        const ys = [0, 0, 0];
        for (const mesh of tiles) {
            const geo = mesh.geometry;
            if (!geo || !geo.index || !geo.attributes.position) continue;
            if (!geo.boundingBox) geo.computeBoundingBox();
            mesh.updateWorldMatrix(true, false);
            box.copy(geo.boundingBox).applyMatrix4(mesh.matrixWorld);
            const hits = B.filter((b) => box.max.x > b.minX - M && box.min.x < b.maxX + M && box.max.z > b.minZ - M && box.min.z < b.maxZ + M);
            if (!hits.length) continue;
            const pos = geo.attributes.position, idx = geo.index.array;
            const ranges = geo.groups.length ? geo.groups.map((gr) => ({ start: gr.start, count: gr.count, materialIndex: gr.materialIndex }))
                : [{ start: 0, count: idx.length, materialIndex: 0 }];
            const out = new idx.constructor(idx.length);
            let n = 0, changed = false;
            const groups = [];
            const xs = [0, 0, 0], zs = [0, 0, 0];
            for (const rg of ranges) {
                const from = n;
                for (let t = rg.start; t < rg.start + rg.count; t += 3) {
                    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
                    let top = -Infinity, i = 0;
                    for (const kk of [a, b, c]) {
                        v.fromBufferAttribute(pos, kk).applyMatrix4(mesh.matrixWorld);
                        xs[i] = v.x; zs[i] = v.z; ys[i] = v.y; i++;
                        top = Math.max(top, v.y);
                    }
                    let drop = false;
                    if (top > 0.7) {
                        // Only triangles that lie entirely within one of the buildings (neighbours keep theirs)
                        for (const bb of hits) {
                            if (inB(bb, xs[0], zs[0]) && inB(bb, xs[1], zs[1]) && inB(bb, xs[2], zs[2])) { drop = true; break; }
                        }
                    }
                    if (!drop) {
                        for (const st of strips) {
                            if (inStrip(st, xs[0], ys[0], zs[0]) && inStrip(st, xs[1], ys[1], zs[1]) && inStrip(st, xs[2], ys[2], zs[2])) { drop = true; break; }
                        }
                    }
                    if (drop) { changed = true; continue; }
                    out[n++] = a; out[n++] = b; out[n++] = c;
                }
                groups.push({ start: from, count: n - from, materialIndex: rg.materialIndex });
            }
            if (!changed) continue;
            geo.boundsTree = null;
            geo.setIndex(new THREE.BufferAttribute(out.slice(0, n), 1));
            if (ranges.length > 1 || geo.groups.length) { geo.clearGroups(); for (const gr of groups) geo.addGroup(gr.start, gr.count, gr.materialIndex); }
        }
        const grid = this.spatialGrid;
        if (grid && grid.cells) {
            for (const b of B) {
                for (let row = grid._getRow(b.minZ - M); row <= grid._getRow(b.maxZ + M); row++) {
                    for (let col = grid._getCol(b.minX - M); col <= grid._getCol(b.maxX + M); col++) {
                        const cell = grid.cells[row * grid.cols + col];
                        if (!cell || !cell.staticItems) continue;
                        cell.staticItems = cell.staticItems.filter((e) => !(typeof e.id === 'string' && e.id.startsWith('building_')
                            && e.x > b.minX - M && e.x < b.maxX + M && e.z > b.minZ - M && e.z < b.maxZ + M
                            && e.maxX - e.minX < b.maxX - b.minX + 2 && e.maxZ - e.minZ < b.maxZ - b.minZ + 2));
                    }
                }
            }
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Building
    // ---------------------------------------------------------------------------------------------
    _build(sf) {
        sf.built = true;
        const k = new Kit();
        const group = new THREE.Group();
        group.name = `bar_${sf.name}`;
        group.position.set(sf.x, 0, sf.z);
        group.rotation.y = sf.theta;
        sf.group = group;
        if (sf.filler) {
            this._buildFiller(k, sf);
        } else {
            buildShell(k, sf);
            const W2 = sf.W / 2;
            const st = sf.stairs;
            const iz0 = -W2 + T, iz1 = W2 - T;
            sf.rooms = [];
            if (sf.ground) {
                // Leave the stairwell out of the ground-floor room
                let z0 = iz0, z1 = iz1;
                if (st) { if (st.side > 0) z1 = Math.min(st.z0, st.z1) - 0.15; else z0 = Math.max(st.z0, st.z1) + 0.15; }
                const h = sf.tall ? sf.H - 0.5 : (sf.levels >= 2 ? G : G);
                const room = { x0: -sf.D + T, x1: -T, z0, z1, y: 0, h, hasRestrooms: sf.D > 13 };
                const ctx = buildRoom(k, sf, sf.ground, room);
                sf.ground.nav = ctx.nav;
                sf.ground.room = room;
                sf.rooms.push({ bar: sf.ground, ctx, room });
                this._takeSpots(k, sf, sf.ground);
            }
            if (sf.upper) {
                let z0 = iz0, z1 = iz1;
                if (st) { if (st.side > 0) z1 = Math.min(st.z0, st.z1) - 0.1; else z0 = Math.max(st.z0, st.z1) + 0.1; }
                const patio = sf.upper.spec.patio || 0;
                const h = Math.min(STOREY - 0.3, sf.H - UP - 0.3);
                const room = { x0: -sf.D + T, x1: -T, z0, z1, y: UP, h, hasRestrooms: (!patio || sf.patioFront) && sf.D > 13, patio, patioFront: sf.patioFront };
                // Floor over the strip beyond the top of the stairs
                if (st) k.flat(floorMaterial(sf.upper.spec).m, room.x0, Math.min(st.z0, st.z1), st.xt, Math.max(st.z0, st.z1), UP + 0.03, { tile: [2, 2] });
                const ctx = buildRoom(k, sf, sf.upper, room);
                sf.upper.nav = ctx.nav;
                sf.upper.room = room;
                sf.rooms.push({ bar: sf.upper, ctx, room });
                this._takeSpots(k, sf, sf.upper);
            }
            if (st) buildStairs(k, sf);
        }
        k.build(group, { castShadow: (m) => !m.transparent && (m.emissiveIntensity === undefined || m.emissiveIntensity < 0.1) });
        sf.dynamic = k.extra;
        sf.counters = k.counters;
        sf.musicLocal = k.music;
        this.scene.add(group);
        // Colliders into the spatial grid
        sf.colliders = k.colliders.map(([x0, z0, x1, z1, y0, y1]) => {
            const a = localToWorld(sf, x0, z0), b = localToWorld(sf, x1, z1);
            return [Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z), y0, y1];
        });
        if (this.spatialGrid && typeof this.spatialGrid.insertStatic === 'function') {
            sf.colliders.forEach(([x0, z0, x1, z1, y0, y1], i) => {
                const box = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
                this.spatialGrid.insertStatic(`bar_${sf.name}_${i}`, box, { type: 'building', isBuilding: true, height: y1, worldBox: box });
            });
        }
    }

    _takeSpots(k, sf, bar) {
        bar.spots = k.spots.splice(0);
    }

    _buildFiller(k, sf) {
        // The rest of a carved building: a closed shop front, dark windows, no inside
        const { W, D, H } = sf;
        const W2 = W / 2;
        const brick = C.tex('brickx_filler', brickTex(0x8a5a3a), 0.06);
        const trim = C.color(0x2a2a2a, 0.08);
        k.block(brick, -D, 0, -W2, -T, H, W2, { tile: [1.2, 0.6] });
        k.collide(-D, -W2, 0, W2, 0, H);
        k.block(brick, -T, 0, -W2, 0, H, W2, { tile: [1.2, 0.6] });
        k.block(C.color(0x3a3a3c, 0.04), -D, H - 0.25, -W2, 0, H, W2);
        const winM = C.tex('shopwindow', upperWindowTex(4242), 0.35);
        for (let z = -W2 + 1.2; z < W2 - 1.0; z += 2.4) {
            k.plane(winM, 2.0, 2.2, 0.012, 1.7, z + 1.0, { ry: Math.PI / 2 });
            k.block(trim, -0.05, 0, z, 0.08, 0.6, z + 2.0);
        }
        k.block(trim, -0.05, 3.1, -W2, 0.25, 3.8, W2);
        if (sf.levels >= 2) for (let s = 0; s < sf.levels - 1; s++) for (let z = -W2 + 1.0; z < W2 - 0.8; z += 2.3) {
            k.plane(C.tex(`upw_f_${s}_${Math.round(z)}`, upperWindowTex(Math.round(z * 7) + s), 0.25), 1.05, 1.7, 0.012, UP + STOREY * s + 1.7, z + 0.5, { ry: Math.PI / 2 });
        }
        k.block(trim, -0.05, H - 0.5, -W2, 0.35, H - 0.1, W2);
    }

    // ---------------------------------------------------------------------------------------------
    // Queries
    // ---------------------------------------------------------------------------------------------
    /**
     * Where `ped` is, for who notices what: the storefront of a bar person (or of anyone standing
     * inside one), or null out on the street. Something happening in one bar only scares the
     * people in that bar, and something out on the street only the people out there.
     */
    placeOf(ped) {
        if (ped.barPerson && ped.barPerson.sf) return ped.barPerson.sf;
        const p = ped.mesh ? ped.mesh.position : ped.position;
        return p ? this.storefrontAt(p.x, p.z) : null;
    }

    /** The storefront whose inside (x, z) is in, or null. */
    storefrontAt(x, z) {
        for (const sf of this.storefronts) {
            if (sf.filler) continue;
            const R = sf.rect;
            if (x < R.minX || x > R.maxX || z < R.minZ || z > R.maxZ) continue;
            return sf;
        }
        return null;
    }

    /**
     * Floor height under the player at (x, z) given where their feet are now (`y`): the stairs
     * ramp up to the upstairs bars, and you stay upstairs once you're there.
     */
    floorAt(x, z, y = 0) {
        const sf = this.storefrontAt(x, z);
        if (!sf || !sf.stairs || !sf.built) return 0;
        const l = worldToLocal(sf, x, z, this._l);
        const st = sf.stairs;
        const za = Math.min(st.z0, st.z1) - 0.05, zb = Math.max(st.z0, st.z1) + 0.05;
        if (l.z > za && l.z < zb && l.x <= st.xb && l.x >= st.xt) return Math.max(0, Math.min(1, (st.xb - l.x) / BAR_CONFIG.STAIR_RUN)) * UP;
        if (l.z > za && l.z < zb && l.x > st.xb) return 0;
        return y > UP * 0.5 ? UP : 0;
    }

    /** What pressing E does here: { text, bar } at a counter, else null. */
    prompt(x, z, y = 0) {
        const sf = this.storefrontAt(x, z);
        if (!sf || !sf.built || !sf.counters) return null;
        const l = worldToLocal(sf, x, z, this._l);
        for (const [x0, z0, x1, z1, cy] of sf.counters) {
            if (Math.abs(cy - y) > 1.2) continue;
            if (l.x > x0 - 0.3 && l.x < x1 + 0.3 && l.z > z0 - 0.3 && l.z < z1 + 0.3) {
                const bar = cy > 1 ? sf.upper : sf.ground;
                return { text: 'Order a drink', bar: bar || sf.ground || sf.upper, sf };
            }
        }
        return null;
    }

    order(x, z, y) {
        const p = this.prompt(x, z, y);
        if (!p) return false;
        if (this.onOrder) this.onOrder(p.bar);
        return true;
    }

    /** The bar you're in (by floor), or null. */
    barAt(x, z, y = 0) {
        const sf = this.storefrontAt(x, z);
        if (!sf) return null;
        return y > 2 ? sf.upper : sf.ground;
    }

    list() {
        const out = [];
        for (const sf of this.storefronts) {
            if (sf.filler) continue;
            for (const b of [sf.ground, sf.upper]) if (b) out.push({ name: b.name, level: b.level, x: sf.x, z: sf.z, built: sf.built });
        }
        return out;
    }

    /** A spot just inside a bar's door (for teleporting): { x, z, y, yaw }. */
    entrance(name) {
        for (const sf of this.storefronts) {
            for (const b of [sf.ground, sf.upper]) {
                if (!b || b.name.toLowerCase().indexOf(String(name).toLowerCase()) < 0) continue;
                const d = b.level ? sf.doors.find((o) => o.kind === 'stairs') : sf.doors.find((o) => o.kind === 'main');
                if (!d) continue;
                if (b.level) {
                    const st = sf.stairs;
                    const p = localToWorld(sf, st.xt - 1.0, (st.z0 + st.z1) / 2 - st.side * 1.6);
                    return { x: p.x, z: p.z, y: UP, yaw: sf.theta + Math.PI / 2 };
                }
                const p = localToWorld(sf, -1.6, (d.z0 + d.z1) / 2);
                return { x: p.x, z: p.z, y: 0, yaw: sf.theta + Math.PI / 2, sf };
            }
        }
        return null;
    }

    // ---------------------------------------------------------------------------------------------
    // Per frame
    // ---------------------------------------------------------------------------------------------
    /**
     * @param {number} dt
     * @param {{x,z}} eye camera position
     * @param {{x,y,z}} player
     * @param {number} night 0..1 (busier at night)
     */
    update(dt, eye, player, night = 0.5) {
        this.time += dt;
        let builtOne = false;
        const extras = this.pedestrians ? this.pedestrians.extraRigs : null;
        // The storefronts that should have people in: the nearest couple within reach of the player
        const want = this._wantCrowd || (this._wantCrowd = new Set());
        want.clear();
        if (night >= BAR_CONFIG.OPEN_NIGHT) {
            const near = [];
            for (const sf of this.storefronts) {
                if (sf.filler || !sf.built) continue;
                const R = sf.rect;
                const rd = Math.hypot(Math.max(0, R.minX - player.x, player.x - R.maxX), Math.max(0, R.minZ - player.z, player.z - R.maxZ));
                if (rd < (sf.crowded ? BAR_CONFIG.CROWD_DROP : BAR_CONFIG.CROWD_DISTANCE)) near.push([rd, sf]);
            }
            near.sort((a, b) => a[0] - b[0]);
            for (let i = 0; i < Math.min(BAR_CONFIG.CROWDED_BARS, near.length); i++) want.add(near[i][1]);
        }
        // Empty first (freeing people for the bar you're walking into), then fill
        for (const sf of this.storefronts) if (sf.crowded && !want.has(sf)) this._empty(sf);
        for (const sf of this.storefronts) {
            const cx = (sf.rect.minX + sf.rect.maxX) / 2, cz = (sf.rect.minZ + sf.rect.maxZ) / 2;
            const d = Math.hypot(eye.x - cx, eye.z - cz);
            if (!sf.built && d < BAR_CONFIG.BUILD_DISTANCE && !builtOne) { this._build(sf); builtOne = true; }
            if (!sf.built) continue;
            const near = d < BAR_CONFIG.DRAW_DISTANCE;
            if (sf.group.visible !== near) sf.group.visible = near;
            if (sf.filler || !near) continue;
            // Dance floors, mirror balls, beams
            if (d < 120) this._animate(sf, dt);
            // People
            if (!sf.crowded && want.has(sf)) this._fill(sf, night);
            if (sf.crowded) this._tick(sf, dt, night);
        }
        const heard = this._hearing(player, night);
        const panic = this._panicHeard(player);
        this.wantsAudio = heard.level > 0.01 || !!panic;   // game.html makes / wakes the AudioContext for us
        this.audio.update(dt, heard);
        this.audio.updatePanic(panic);
    }

    /**
     * The bar that's screaming (people running out after shots), as heard from where the player
     * is: { level, inside }, or null when nobody is left running for the door.
     */
    _panicHeard(player) {
        const b = this.panicBar;
        if (!b) return null;
        const stillRunning = b.people && b.people.some((p) => p.phase === 'flee' && !p.ped.isDead);
        if (!stillRunning) { this.panicBar = null; return null; }
        const sf = this.panicSf;
        const py = player.y || 0;
        if (this.storefrontAt(player.x, player.z) === sf) {
            const sameFloor = (py > 2) === (b === sf.upper);
            return { level: sameFloor ? 1 : 0.75, inside: sameFloor };
        }
        const R = sf.rect;
        const d = Math.hypot(Math.max(0, R.minX - player.x, player.x - R.maxX), Math.max(0, R.minZ - player.z, player.z - R.maxZ));
        const k = Math.max(0, 1 - d / (BAR_CONFIG.HEAR_DISTANCE * 1.5));
        return k > 0 ? { level: k * k * 0.9, inside: false } : { level: 0, inside: false };
    }

    /** How much a shot at (x, z) on floor `y` rings round a room: 0 outside, ~1 in a bar. */
    roomAt(x, z, y = 0) {
        const sf = this.storefrontAt(x, z);
        if (!sf || !sf.built) return 0;
        if (sf.stairs && y > 0.2 && y < UP - 0.2) return 0.6;   // the stairwell
        return 1;
    }

    /**
     * What the player hears: { inside, level } where level is 0..1 (1 standing in an open bar,
     * fading with distance outside, a bit muffled through a floor) and `inside` says whether it's
     * the clear sound of the room or the muffled sound through the walls.
     */
    _hearing(player, night) {
        if (night < BAR_CONFIG.OPEN_NIGHT) return { inside: false, level: 0, bar: null };
        const py = player.y || 0;
        const here = this.storefrontAt(player.x, player.z);
        if (here && here.built) {
            const bar = py > 2 ? here.upper : here.ground;
            if (bar) {
                // In a bar's own room (on the stairs to an upstairs bar it's still muffled)
                const onStairs = here.stairs && py > 0.2 && py < UP - 0.2;
                if (!onStairs) return { inside: true, level: 1, bar };
            }
            // Under / over the bar on another floor, or on the stairs
            return { inside: false, level: 0.75, bar: here.upper || here.ground };
        }
        let best = Infinity, bestSf = null;
        for (const sf of this.storefronts) {
            if (sf.filler) continue;
            const R = sf.rect;
            const d = Math.hypot(Math.max(0, R.minX - player.x, player.x - R.maxX), Math.max(0, R.minZ - player.z, player.z - R.maxZ));
            if (d < best) { best = d; bestSf = sf; }
        }
        const k = Math.max(0, 1 - best / BAR_CONFIG.HEAR_DISTANCE);
        return { inside: false, level: k * k * 0.8, bar: bestSf ? (bestSf.ground || bestSf.upper) : null };
    }

    _animate(sf, dt) {
        const t = this.time;
        for (const o of sf.dynamic) {
            if (o.userData.spin) o.rotation.y += o.userData.spin * dt;
            if (o.userData.sweep) {
                const s = o.userData.sweep;
                o.rotation.z = Math.sin(t * 0.9 + s.phase) * 0.55;
                o.rotation.x = s.base + Math.cos(t * 0.7 + s.phase) * 0.35;
            }
        }
        const led = _led;
        if (led) led.map.offset.x = (Math.floor(t * 124 / 60) % 4) * 0.25;
    }

    // ---------------------------------------------------------------------------------------------
    // People. Everyone in a bar is a real pedestrian (shootable, punchable, talks, fights back, dies)
    // in state 'bar', run from here (updatePed): guests drift between the counter, stools, tables,
    // the dance floor, the pool table and the restroom, come in off the street and leave again;
    // staff work. Trouble (trouble()) turns the bouncer and some of the guests on you and sends the
    // rest running out of the door.
    // ---------------------------------------------------------------------------------------------
    _fill(sf, night) {
        const P = this.pedestrians;
        if (!P || typeof P.spawnControlled !== 'function' || night < BAR_CONFIG.OPEN_NIGHT) return;
        sf.crowded = true;
        for (const b of [sf.ground, sf.upper]) {
            if (!b || !b.spots) continue;
            b.people = [];
            b.trouble = 0;
            b.arriveT = 3;
            for (const s of b.spots) s.occ = null;
            b.cap = Math.round(Math.min(BAR_CONFIG.MAX_PER_BAR, sf.W * sf.D * BAR_CONFIG.PEOPLE_PER_M2 * (b.spec.crowd || 1)));
            for (const s of b.spots) if (s.staff || (s.band && b.spec.band)) this._spawn(sf, b, s, { staff: true });
            // The night's already going when you get there
            const n = Math.round(b.cap * 0.8);
            for (let i = 0; i < n && this.rigs < BAR_CONFIG.MAX_RIGS; i++) {
                const s = this._freeSpot(b, this._pickKind(b, null));
                if (!s) break;
                this._spawn(sf, b, s, {});
            }
        }
    }

    _empty(sf) {
        sf.crowded = false;
        for (const b of [sf.ground, sf.upper]) {
            if (!b || !b.people) continue;
            for (const p of b.people) {
                if (!p.ped.isDead && this.pedestrians) this.pedestrians.removePed(p.ped);
                this.rigs--;
            }
            b.people.length = 0;
            for (const s of b.spots) s.occ = null;
        }
    }

    /** A person at spot `s` (or walking in from the street when `arriving`). */
    _spawn(sf, b, s, { staff = false, arriving = false } = {}) {
        if (this.rigs >= BAR_CONFIG.MAX_RIGS) return null;
        const style = staff ? 'worker' : GUEST_STYLES[Math.floor(Math.random() * GUEST_STYLES.length)];
        let lx = s.x, lz = s.z, y = s.y || 0;
        if (arriving && b.nav && b.nav.entry) { [lx, lz] = b.nav.entry[0]; y = 0; }
        const w = localToWorld(sf, lx, lz);
        const ped = this.pedestrians.spawnControlled(w.x, w.z, y, sf.theta + (s.yaw || 0), style, this);
        if (staff && ped.mesh.userData.rig) {
            const shirt = s.kind === 'bouncer' ? 0x0a0a0a : s.kind === 'cook' ? 0xeeeeee : 0x111111;
            for (const bd of ped.mesh.userData.rig.bindings) if (bd.part === 'torso' || bd.part === 'upperArm') bd.color.setHex(shirt);
        }
        if (s.kind === 'bouncer') { ped.ai.fighter = true; ped.hp = ped.maxHp = 160; }
        const p = { ped, sf, b, spot: s, role: staff ? s.kind : 'guest', phase: 'do', timer: this._duration(s.kind), route: null, ri: 0,
            speed: 1.1 + Math.random() * 0.35, phaseT: Math.random() * 10, cower: 0 };
        s.occ = p;
        ped.barPerson = p;
        b.people.push(p);
        this.rigs++;
        if (arriving) this._goTo(p, s);
        return p;
    }

    _duration(kind) {
        const r = Math.random();
        switch (kind) {
            case 'order': return 7 + r * 8;
            case 'stool': case 'sit': return 45 + r * 90;
            case 'dance': return 30 + r * 70;
            case 'pool': case 'cue': case 'darts': case 'arcade': return 40 + r * 70;
            case 'restroom': return 12 + r * 18;
            default: return 20 + r * 50;
        }
    }

    /** What a guest feels like doing next. */
    _pickKind(b, after) {
        const has = (k) => b.spots.some((s) => s.kind === k && !s.occ);
        const w = [];
        if (after !== 'order') w.push(['order', 0.2]);
        w.push(['stool', 0.25], ['sit', 0.22], ['stand', 0.14]);
        if (has('dance')) w.push(['dance', after === 'order' ? 0.3 : 0.22]);
        for (const g of ['pool', 'cue', 'darts', 'arcade']) if (has(g)) w.push([g, 0.06]);
        if (has('restroom') && after !== 'restroom') w.push(['restroom', 0.05]);
        let t = w.reduce((a, x) => a + x[1], 0) * Math.random();
        for (const [k, v] of w) { if ((t -= v) <= 0) return k; }
        return 'stand';
    }

    _freeSpot(b, kind) {
        const free = b.spots.filter((s) => !s.occ && !s.staff && !s.band && s.kind === kind);
        if (free.length) return free[Math.floor(Math.random() * free.length)];
        const any = b.spots.filter((s) => !s.occ && !s.staff && !s.band && (s.kind === 'stand' || s.kind === 'stool' || s.kind === 'sit'));
        return any.length ? any[Math.floor(Math.random() * any.length)] : null;
    }

    /** Is (local) point on this bar's floor, inside its room? */
    _inRoom(b, l, y) {
        const R = b.room;
        return R && Math.abs(y - R.y) < 1.5 && l.x > R.x0 && l.x < R.x1 && l.z > R.z0 - 0.2 && l.z < R.z1 + 0.2;
    }

    /** Walking route (local points) from where the person is to spot `s`. */
    _goTo(p, s) {
        const { b, sf, ped } = p;
        const n = b.nav;
        const l = worldToLocal(sf, ped.position.x, ped.position.z, {});
        const pts = this._viaBack(p, l);
        const aisle = (x) => [Math.max(n.ax0, Math.min(n.ax1, x)), n.aisleZ];
        if (this._inRoom(b, l, ped.position.y)) pts.push(aisle(pts.length ? pts[pts.length - 1][0] : l.x));
        else if (n.entry) {
            // From outside: the door in (from the nearest entry point if already part way)
            let k = 0, best = Infinity;
            n.entry.forEach(([x, z], i) => { const d = Math.hypot(x - l.x, z - l.z); if (d < best) { best = d; k = i; } });
            for (let i = k; i < n.entry.length; i++) pts.push(n.entry[i]);
        }
        pts.push(aisle(s.x));
        for (const v of s.via || []) pts.push(v);
        pts.push([s.x, s.z]);
        p.route = pts;
        p.ri = 0;
        p.target = s;
        p.phase = 'walk';
    }

    /** Back the way they came from a spot reached through an opening (the patio), or nothing. */
    _viaBack(p, l) {
        const t = p.target;
        if (!t || !t.via || Math.hypot(t.x - l.x, t.z - l.z) > 2.5) return [];
        return t.via.slice().reverse().map((v) => [v[0], v[1]]);
    }

    /** Out of the door: running (`flee`) or strolling (`leave`). */
    _goOut(p, phase) {
        const { b, sf, ped } = p;
        const n = b.nav;
        if (p.spot && p.spot.occ === p) p.spot.occ = null;
        p.spot = null;
        const l = worldToLocal(sf, ped.position.x, ped.position.z, {});
        const pts = this._viaBack(p, l);
        const lx = pts.length ? pts[pts.length - 1][0] : l.x;
        if (this._inRoom(b, l, ped.position.y)) pts.push([Math.max(n.ax0, Math.min(n.ax1, lx)), n.aisleZ]);
        if (n.entry) for (let i = n.entry.length - 1; i >= 0; i--) pts.push(n.entry[i]);
        p.route = pts;
        p.ri = 0;
        p.target = null;
        p.phase = phase;
        // Someone running for their life: the whole room screams until the last of them is out
        if (phase === 'flee') { this.panicBar = b; this.panicSf = sf; }
    }

    /** From pedestrians.js: something scared them (gunfire, a body). Make for the door. */
    onPanic(ped) {
        const p = ped.barPerson;
        ped.state = 'bar';
        if (!p) return;
        if (p.role === 'bartender' || p.role === 'cook') { p.cower = 20 + Math.random() * 15; p.phase = 'do'; return; }
        this._goOut(p, 'flee');
    }

    /**
     * The player started something in here: a punch (`kind` 'punch'), gunfire ('gun') or a
     * killing ('kill') at (x, z) on floor `y`. The bouncer and a share of the guests come at you;
     * everyone else heads for the door (the staff duck behind the bar when there's shooting).
     */
    trouble(x, z, y, kind = 'punch', victim = null) {
        const sf = this.storefrontAt(x, z);
        if (!sf || !sf.crowded) return false;
        const b = y > 2 ? sf.upper : sf.ground;
        if (!b || !b.people) return false;
        const first = b.trouble <= 0;
        b.trouble = 45;
        const gun = kind !== 'punch';
        // Only the few nearest guests square up: a handful the first time, a couple more each time after
        let fightersLeft = gun ? 2 : (first ? 3 : 2);
        const order = b.people.slice().sort((a, c) => Math.hypot(a.ped.position.x - x, a.ped.position.z - z) - Math.hypot(c.ped.position.x - x, c.ped.position.z - z));
        for (const p of order) {
            const ped = p.ped;
            if (ped.isDead || ped === victim || ped.state !== 'bar' || p.phase === 'flee' || p.phase === 'away') continue;
            const d = Math.hypot(ped.position.x - x, ped.position.z - z);
            const fight = () => {
                if (p.spot && p.spot.occ === p && p.role === 'guest') { p.spot.occ = null; p.spot = null; }
                p.phase = 'fight';
                ped.ai.fighter = true;
                ped.ai.fightTime = 0;
                ped.ai.punchCd = 0.5 + Math.random() * 1.5;
                ped.ai.punchSlow = 1.7;      // a bar full of people takes turns, it isn't a beating machine
                ped.state = 'fighting';
            };
            if (p.role === 'bouncer') fight();
            else if (p.role === 'bartender' || p.role === 'cook') {
                if (gun) p.cower = 30;
                else if (d < 8 && Math.random() < 0.25) fight();
            } else if (p.role !== 'guest') {
                if (gun) this._goOut(p, 'flee');       // the band, the DJ
            } else if (d < (gun ? 30 : 14)) {
                // The nearest few square up (the tough ones first), the rest get out or keep their heads down
                if (fightersLeft > 0 && (ped.ai.fighter || Math.random() < (gun ? 0.35 : 0.6))) { fight(); fightersLeft--; }
                else if (gun || Math.random() < 0.5) this._goOut(p, 'flee');
            }
        }
        return true;
    }

    /** From pedestrians.js, for each bar person in state 'bar'. */
    updatePed(ped, dt) {
        const p = ped.barPerson;
        if (!p) { ped.barCtl = null; ped.state = 'walking'; return; }
        p.phaseT += dt;
        const rig = ped.mesh.userData.rig;
        if (p.phase === 'walk' || p.phase === 'flee' || p.phase === 'leave') {
            this._walk(p, dt, rig);
            return;
        }
        if (p.phase === 'away') {
            p.timer -= dt;
            if (p.timer <= 0) {
                const s = p.spot;
                const w = localToWorld(p.sf, s.x, s.z);
                ped.position.set(w.x, s.y || 0, w.z);
                ped.floorY = s.y || 0;
                p.phase = 'do';
                p.timer = 0;
            }
            return;
        }
        if (p.phase === 'fight') p.phase = 'do';
        // Doing their thing at their spot
        const s = p.spot;
        if (!s) {
            const next = this._freeSpot(p.b, 'stand');
            if (next) { next.occ = p; p.spot = next; p.timer = this._duration(next.kind); this._goTo(p, next); }
            else this._goOut(p, 'leave');
            return;
        }
        if (p.role === 'guest') {
            p.timer -= dt;
            if (p.timer <= 0) {
                if (s.kind === 'restroom' && p.lastKind !== 'restroom') {
                    // In there a while (out of sight)
                    p.lastKind = 'restroom';
                    p.phase = 'away';
                    p.timer = this._duration('restroom');
                    ped.position.y = -60;
                    return;
                }
                if (Math.random() < 0.05 || p.b.trouble > 0) { this._goOut(p, 'leave'); return; }
                const kind = this._pickKind(p.b, s.kind);
                const next = this._freeSpot(p.b, kind);
                if (next) {
                    s.occ = null;
                    next.occ = p;
                    p.spot = next;
                    p.lastKind = s.kind;
                    p.timer = this._duration(next.kind);
                    this._goTo(p, next);
                    return;
                }
                p.timer = 10;
            }
        } else if (p.role === 'bartender' && s.x0 !== undefined && p.cower <= 0) {
            // Working the bar: off to the taps, the register, a customer
            p.timer -= dt;
            if (p.timer <= 0) {
                p.timer = 4 + Math.random() * 8;
                p.beatX = s.x0 + Math.random() * Math.max(0.1, s.x1 - s.x0);
            }
            if (p.beatX !== undefined) {
                const l = worldToLocal(p.sf, ped.position.x, ped.position.z, {});
                const dx = p.beatX - l.x;
                if (Math.abs(dx) > 0.05) {
                    const nx = l.x + Math.sign(dx) * Math.min(Math.abs(dx), 1.0 * dt);
                    const w = localToWorld(p.sf, nx, s.z);
                    ped.position.x = w.x;
                    ped.position.z = w.z;
                    this._face(p, Math.sign(dx) > 0 ? Math.PI / 2 : -Math.PI / 2);
                    poseWalk(rig, (p.phaseT * 6) % (Math.PI * 2), 1.0);
                    return;
                }
            }
        }
        if (p.cower > 0) {
            p.cower -= dt;
            this._face(p, s.yaw || 0);
            resetRig(rig);
            rig.body.position.y = -0.42;
            rig.torso.rotation.x = 0.6;
            rig.legL.rotation.x = rig.legR.rotation.x = -0.8;
            rig.kneeL.rotation.x = rig.kneeR.rotation.x = 1.6;
            rig.shoulderL.rotation.set(-2.4, 0, -0.3);
            rig.shoulderR.rotation.set(-2.4, 0, 0.3);
            rig.elbowL.rotation.x = rig.elbowR.rotation.x = -1.6;
            return;
        }
        this._face(p, s.yaw || 0, s.kind === 'dance' ? Math.sin(p.phaseT * 0.4) * 1.2 : 0);
        this._doPose(p, rig, this.time + p.phaseT);
    }

    _face(p, localYaw, extra = 0) {
        const yaw = p.sf.theta + localYaw + extra;
        p.ped.ai.yaw = yaw;
        p.ped.mesh.rotation.set(0, yaw, 0);
    }

    _walk(p, dt, rig) {
        const { ped, sf } = p;
        const run = p.phase === 'flee';
        const speed = run ? 3.4 : p.speed;
        if (!p.route || p.ri >= p.route.length) { this._arrive(p); return; }
        const [tx, tz] = p.route[p.ri];
        const l = worldToLocal(sf, ped.position.x, ped.position.z, {});
        const dx = tx - l.x, dz = tz - l.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.15) { p.ri++; if (p.ri >= p.route.length) this._arrive(p); return; }
        const step = Math.min(d, speed * dt);
        const w = localToWorld(sf, l.x + dx / d * step, l.z + dz / d * step);
        ped.position.x = w.x;
        ped.position.z = w.z;
        const fy = this.floorAt(w.x, w.z, ped.floorY || 0);
        ped.floorY = fy;
        ped.position.y = fy;
        this._face(p, Math.atan2(dx, dz));
        poseWalk(rig, (p.phaseT * (run ? 11 : 6.5)) % (Math.PI * 2), run ? 4 : speed);
    }

    _arrive(p) {
        const { ped } = p;
        if (p.phase === 'leave' || p.phase === 'flee') {
            // Out on the street: they're the town's now (or gone, if they were just leaving)
            this._release(p);
            if (p.phase === 'leave') { this.pedestrians.removePed(ped); return; }
            const out = localToWorld(p.sf, 1, 0, {}), o = localToWorld(p.sf, 0, 0, {});
            const ox = out.x - o.x, oz = out.z - o.z;
            ped.barCtl = null;
            ped.barPerson = null;
            ped.floorY = 0;
            ped.position.y = 0;
            ped.state = 'fleeing';
            ped.fleeTimer = 180;
            ped.speed = 0.15;
            ped.velocity.set(ox * 0.15 + (Math.random() - 0.5) * 0.08, 0, oz * 0.15 + (Math.random() - 0.5) * 0.08);
            return;
        }
        const s = p.target;
        p.phase = 'do';
        if (s) {
            const w = localToWorld(p.sf, s.x, s.z);
            ped.position.x = w.x;
            ped.position.z = w.z;
            ped.position.y = ped.floorY = s.y || 0;
            if (p.timer <= 0) p.timer = this._duration(s.kind);
        }
    }

    /** Takes someone off this bar's books (they left, ran off or died). */
    _release(p) {
        if (p.spot && p.spot.occ === p) p.spot.occ = null;
        const i = p.b.people.indexOf(p);
        if (i >= 0) { p.b.people.splice(i, 1); this.rigs--; }
    }

    /** Per frame, per crowded storefront: arrivals, the dead, people coming back from a fight. */
    _tick(sf, dt, night) {
        for (const b of [sf.ground, sf.upper]) {
            if (!b || !b.people) continue;
            if (b.trouble > 0) b.trouble -= dt;
            for (let i = b.people.length - 1; i >= 0; i--) {
                const p = b.people[i];
                const ped = p.ped;
                if (ped.isDead || ped.state === 'dying' || ped.state === 'ragdoll') { this._release(p); continue; }
                // Keep their floor under them wherever they are (chasing you down the stairs)
                if (ped.state !== 'bar') ped.floorY = this.floorAt(ped.position.x, ped.position.z, ped.floorY || 0);
                if (ped.state === 'fleeing' && ped.barCtl) {
                    // Spooked by a shot (set from outside): out of the door, not back to a stool
                    if (p.phase !== 'flee' && p.phase !== 'leave') this.onPanic(ped);
                    else ped.state = 'bar';
                } else if ((ped.state === 'walking' || ped.state === 'idle') && ped.barCtl) {
                    // Done fighting: back inside to a spot
                    ped.state = 'bar';
                    ped.ai.lastState = 'bar';
                    if (p.role !== 'guest' && p.spot) this._goTo(p, p.spot);
                    else {
                        if (p.spot && p.spot.occ === p) p.spot.occ = null;
                        const s = this._freeSpot(b, this._pickKind(b, null));
                        if (s) { s.occ = p; p.spot = s; p.timer = this._duration(s.kind); this._goTo(p, s); }
                        else this._goOut(p, 'leave');
                    }
                }
            }
            // New arrivals off the street while it isn't kicking off
            let guests = 0;
            for (const p of b.people) if (p.role === 'guest') guests++;
            b.arriveT -= dt;
            if (b.arriveT <= 0 && b.trouble <= 0 && guests < b.cap && night >= BAR_CONFIG.OPEN_NIGHT && b.nav && b.nav.entry) {
                b.arriveT = 2 + Math.random() * 5;
                const s = this._freeSpot(b, Math.random() < 0.5 ? 'order' : this._pickKind(b, null));
                if (s) {
                    const p = this._spawn(sf, b, s, { arriving: true });
                    if (p) p.timer = this._duration(s.kind);
                }
            }
        }
    }

    _doPose(p, r, t) {
        const s = p.spot;
        const k = p.ped.mesh.scale.y || 1;
        switch (s.kind) {
            case 'sit': poseSeated(r, s.seatH || 0.48, k, 'table', t, Math.sin(t * 0.3) * 0.4); this._sip(r, t); this._chat(r, t); break;
            case 'stool': poseSeated(r, s.seatH || 0.8, k, 'table', t, Math.sin(t * 0.25) * 0.5); this._sip(r, t); break;
            case 'drums':
                poseSeated(r, s.seatH || 0.55, k, 'drive', t);
                r.shoulderL.rotation.x = -1.0 + Math.max(0, Math.sin(t * 13)) * 0.45;
                r.shoulderR.rotation.x = -1.0 + Math.max(0, Math.sin(t * 13 + 1.6)) * 0.45;
                r.neck.rotation.x = Math.sin(t * 6.5) * 0.15;
                break;
            case 'dance': {
                resetRig(r);
                const b = Math.abs(Math.sin(t * 6.5));
                r.body.position.y = b * 0.06;
                r.kneeL.rotation.x = r.kneeR.rotation.x = 0.1 + b * 0.3;
                r.legL.rotation.x = r.legR.rotation.x = -b * 0.15;
                r.torso.rotation.y = Math.sin(t * 3.25) * 0.35;
                const up = Math.sin(t * 0.9) > 0.3;
                r.shoulderL.rotation.set(up ? -2.6 + Math.sin(t * 6.5) * 0.3 : -0.6 + b * 0.4, 0, -0.2);
                r.shoulderR.rotation.set(up ? -2.5 - Math.sin(t * 6.5) * 0.3 : -0.7 + b * 0.4, 0, 0.2);
                r.elbowL.rotation.x = r.elbowR.rotation.x = -0.6;
                r.neck.rotation.x = b * 0.15;
                break;
            }
            case 'order':
                // Leaning on the bar, waving a note at the bartender now and then
                resetRig(r);
                r.torso.rotation.x = 0.18;
                r.shoulderL.rotation.x = -0.9;
                r.elbowL.rotation.x = -1.0;
                r.shoulderR.rotation.x = Math.sin(t * 0.6) > 0.7 ? -2.4 : -0.9;
                r.elbowR.rotation.x = -0.8;
                r.neck.rotation.y = Math.sin(t * 0.4) * 0.5;
                break;
            case 'bartender': {
                resetRig(r);
                const wipe = Math.sin(t * 2.2);
                r.shoulderR.rotation.set(-0.95, 0, 0.1 + wipe * 0.25);
                r.shoulderL.rotation.x = -0.7;
                r.elbowL.rotation.x = r.elbowR.rotation.x = -0.6;
                r.torso.rotation.x = 0.12;
                r.neck.rotation.y = Math.sin(t * 0.4) * 0.5;
                break;
            }
            case 'bouncer':
                resetRig(r);
                r.shoulderL.rotation.set(-1.1, 0, 0.6);
                r.shoulderR.rotation.set(-1.1, 0, -0.6);
                r.elbowL.rotation.x = r.elbowR.rotation.x = -1.7;
                r.neck.rotation.y = Math.sin(t * 0.25) * 0.7;
                break;
            case 'cook':
                resetRig(r);
                r.shoulderL.rotation.x = r.shoulderR.rotation.x = -0.9 + Math.sin(t * 4) * 0.1;
                r.elbowL.rotation.x = r.elbowR.rotation.x = -0.8;
                r.torso.rotation.x = 0.15;
                break;
            case 'dj':
                resetRig(r);
                r.shoulderL.rotation.set(-1.0, 0, -0.1);
                r.shoulderR.rotation.set(Math.sin(t * 0.7) > 0.6 ? -2.8 : -1.0 + Math.sin(t * 6.5) * 0.15, 0, 0.1);
                r.elbowL.rotation.x = r.elbowR.rotation.x = -0.7;
                r.neck.rotation.x = Math.abs(Math.sin(t * 6.5)) * 0.25;
                r.body.position.y = Math.abs(Math.sin(t * 6.5)) * 0.03;
                break;
            case 'guitar':
                resetRig(r);
                r.shoulderL.rotation.set(-1.2, 0.6, -0.4);
                r.elbowL.rotation.x = -1.0;
                r.shoulderR.rotation.set(-0.5 + Math.sin(t * 13) * 0.18, 0, 0.3);
                r.elbowR.rotation.x = -1.2;
                r.neck.rotation.x = Math.abs(Math.sin(t * 3.25)) * 0.25;
                r.kneeL.rotation.x = Math.abs(Math.sin(t * 3.25)) * 0.2;
                break;
            case 'singer':
                resetRig(r);
                r.shoulderR.rotation.set(-1.7, 0, 0.2);
                r.elbowR.rotation.x = -1.7;
                r.shoulderL.rotation.set(-0.5 + Math.sin(t * 1.3) * 0.5, 0, -0.3);
                r.torso.rotation.z = Math.sin(t * 3.25) * 0.08;
                r.neck.rotation.x = -0.1;
                break;
            case 'pool': {
                resetRig(r);
                const shoot = Math.max(0, Math.sin(t * 0.8)) ** 4;
                r.torso.rotation.x = 0.95;
                r.neck.rotation.x = -0.7;
                r.shoulderL.rotation.set(-1.3, 0, -0.2);
                r.shoulderR.rotation.set(-0.6 + shoot * 0.5, 0, 0.15);
                r.elbowR.rotation.x = -1.4 + shoot * 0.8;
                r.legL.rotation.x = 0.35;
                r.legR.rotation.x = -0.25;
                break;
            }
            case 'darts': {
                resetRig(r);
                const th = Math.max(0, Math.sin(t * 1.4)) ** 6;
                r.shoulderR.rotation.set(-1.5 - th * 0.3, 0, 0.1);
                r.elbowR.rotation.x = -1.6 + th * 1.4;
                r.legR.rotation.x = -0.2;
                break;
            }
            case 'arcade':
                resetRig(r);
                r.shoulderL.rotation.x = r.shoulderR.rotation.x = -0.95;
                r.elbowL.rotation.x = -0.5 + Math.sin(t * 9) * 0.1;
                r.elbowR.rotation.x = -0.5 + Math.sin(t * 11) * 0.1;
                r.torso.rotation.x = 0.12;
                break;
            case 'cue':
                resetRig(r);
                r.shoulderR.rotation.set(-0.3, 0, 0.35);
                r.elbowR.rotation.x = -0.3;
                r.neck.rotation.y = Math.sin(t * 0.5) * 0.4;
                break;
            default:      // standing about with a drink, talking
                resetRig(r);
                r.shoulderL.rotation.z = 0.08;
                r.neck.rotation.y = Math.sin(t * 0.35) * 0.5;
                r.torso.rotation.y = Math.sin(t * 0.2) * 0.1;
                this._sip(r, t);
                this._chat(r, t);
        }
    }

    /** Hold a drink, and now and then take a sip. */
    _sip(r, t) {
        const sip = Math.max(0, Math.sin(t * 0.45)) ** 12;
        r.shoulderR.rotation.x = Math.min(r.shoulderR.rotation.x, -0.55 - sip * 0.8);
        r.elbowR.rotation.x = -1.2 - sip * 0.6;
    }

    /** Talking with your hands. */
    _chat(r, t) {
        const g = Math.max(0, Math.sin(t * 0.7 + 1.3));
        r.shoulderL.rotation.x = Math.min(r.shoulderL.rotation.x, -0.3 - g * 0.6 + Math.sin(t * 5) * 0.12 * g);
        r.elbowL.rotation.x = -0.6 - g * 0.5;
        r.neck.rotation.x = Math.sin(t * 2.1) * 0.05 * g;
    }

    stats() {
        return { storefronts: this.storefronts.length, built: this.storefronts.filter((s) => s.built).length, rigs: this.rigs };
    }
}
