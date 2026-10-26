/**
 * js/game/districts.js
 *
 * The districts of the map (traced from media/districtReference.png) and what life looks like in
 * each one by day and by night: how many people are out, who they are, what they're doing, how
 * busy the streets and parking lots are.
 *
 * The reference image is a north-up Web Mercator screenshot; at its scale one pixel is 5.44 m and
 * the Main St / Wooster St junction (pixel 828, 603) is world (-1829, -625), so a box's pixel
 * edges map straight onto world x / z. Boxes are listed most specific first and the first box
 * containing a point wins (the thin strips sit on the edges of the big boxes).
 *
 * Everything else reads the districts through:
 *   districtAt(x, z)            -> district definition (OUTSKIRTS outside every box)
 *   nightFactor(hours)          -> 0 by day, 1 at night, ramping through dusk and dawn
 *   districtProfile(d, night)   -> numbers blended between the district's day and night tables
 *   pickWeighted(table, rand)   -> a key of a { key: weight } table
 */

export const DOOR_KIND = Object.freeze({ HOUSE: 0, APARTMENT: 1, SHOP: 2, FOOD: 3, BAR: 4, CAMPUS: 5, OTHER: 6 });

const PX_TO_M = 5.44;
const REF_PX = { x: 828, y: 603 };
const REF_WORLD = { x: -1829, z: -625 };
const toWorldX = (px) => REF_WORLD.x + (px - REF_PX.x) * PX_TO_M;
const toWorldZ = (py) => REF_WORLD.z + (py - REF_PX.y) * PX_TO_M;

const D = DOOR_KIND;

/**
 * Day and night tables per district type.
 * peds    population multiplier around the player (1 = the old city-wide default)
 * cars    share of traffic spawns accepted on these streets (0..1)
 * parked  share of parking stalls with a car in them
 * looks   who the people are ({ student, partier, adult, older, worker, shopper, athlete })
 * walkers what people on the sidewalks are up to
 * spots   what happens on grass / yard hangout spots
 * seats   chance a free bench / chair / patio seat gets someone sitting on it (0..1)
 * street  scenes on the sidewalk itself
 * doors   building kinds people head into and come out of
 */
const TYPES = {
    STUDENT: {
        name: 'Student Residential',
        day: {
            peds: 1.05, cars: 0.75, parked: 0.55, seats: 0.6,
            looks: { student: 9, adult: 1 },
            walkers: { walk: 4, toDoor: 3, fromDoor: 3, walkGroup: 2, jog: 0.6, toCar: 0.6 },
            spots: { hang: 3, study: 1, sunbathe: 0.4 },
            street: { smoke: 0.4 },
            doors: [D.HOUSE, D.APARTMENT]
        },
        night: {
            peds: 1.45, cars: 0.45, parked: 0.9, seats: 0.9,
            looks: { partier: 8, student: 2 },
            walkers: { walkGroup: 4, drunk: 3, walk: 1.5, toDoor: 2, fromDoor: 2 },
            spots: { beerPong: 4, party: 4, hang: 1.5 },
            street: { smoke: 3, drink: 3, vomit: 0.6 },
            doors: [D.HOUSE, D.APARTMENT],
            music: true
        }
    },
    PARK: {
        name: 'Park',
        day: {
            peds: 1.2, cars: 0.4, parked: 0.45, seats: 0.8,
            looks: { athlete: 3, adult: 4, student: 3, older: 1 },
            walkers: { jogGroup: 3, jog: 2.5, walk: 3, dog: 1.5, walkGroup: 1 },
            spots: { picnic: 4, sunbathe: 3, sleepGrass: 1.5, hang: 2 },
            street: {}
        },
        night: {
            peds: 0.08, cars: 0.25, parked: 0.05, seats: 0.05,
            looks: { adult: 1 },
            walkers: { walk: 1 },
            spots: {},
            street: {},
            patrol: 0.6
        }
    },
    UNIVERSITY: {
        name: 'University',
        day: {
            peds: 1.5, cars: 0.6, parked: 0.85, seats: 0.95,
            looks: { student: 12, adult: 1 },
            walkers: { walk: 4, toDoor: 4, fromDoor: 4, walkGroup: 2, toCar: 0.4, jog: 0.4 },
            spots: { study: 4, hang: 3, sunbathe: 0.8, picnic: 0.6 },
            street: {},
            seatStudy: 0.6,
            doors: [D.CAMPUS, D.APARTMENT, D.FOOD, D.OTHER]
        },
        night: {
            peds: 0.45, cars: 0.35, parked: 0.35, seats: 0.2,
            looks: { student: 8, partier: 2 },
            walkers: { walk: 3, toDoor: 2, fromDoor: 3, toCar: 3, walkGroup: 1 },
            spots: { hang: 1 },
            street: { smoke: 0.4 },
            doors: [D.APARTMENT, D.CAMPUS]
        }
    },
    AIRPORT: {
        name: 'Airport',
        day: {
            peds: 0.3, cars: 0.5, parked: 0.5, seats: 0.3,
            looks: { adult: 3, worker: 2 },
            walkers: { walk: 2, toCar: 1, fromDoor: 1, toDoor: 1 },
            spots: {}, street: {},
            doors: [D.OTHER, D.SHOP]
        },
        night: {
            peds: 0.12, cars: 0.3, parked: 0.3, seats: 0.1,
            looks: { worker: 1 },
            walkers: { walk: 1, toCar: 1 },
            spots: {}, street: {},
            doors: [D.OTHER]
        }
    },
    BARS: {
        name: 'Downtown Bars',
        day: {
            peds: 2.0, cars: 0.8, parked: 0.6, seats: 0.95,
            looks: { adult: 5, student: 3, worker: 2, older: 1 },
            walkers: { walk: 4, toDoor: 3, fromDoor: 3, walkGroup: 1.5 },
            spots: { hang: 1 },
            street: {},
            doors: [D.FOOD, D.SHOP, D.BAR]
        },
        night: {
            peds: 4.2, cars: 0.55, parked: 0.95, seats: 0.9,
            looks: { partier: 10, student: 2 },
            walkers: { walkGroup: 7, drunk: 4, walk: 2, toDoor: 4, fromDoor: 4 },
            spots: { hang: 2 },
            street: { queue: 9, drink: 4, smoke: 4, vomit: 1.5, passedOut: 1, fight: 0.9, arrest: 0.4 },
            doors: [D.BAR, D.FOOD],
            music: true,
            arrests: true
        }
    },
    PARKING: {
        name: 'Downtown Parking',
        day: {
            peds: 0.7, cars: 0.45, parked: 0.3, seats: 0.6,
            looks: { adult: 5, older: 2, worker: 2 },
            walkers: { walk: 3, toCar: 2, toDoor: 2, fromDoor: 2 },
            spots: {}, street: {},
            doors: [D.FOOD, D.SHOP, D.HOUSE]
        },
        night: {
            peds: 1.3, cars: 0.5, parked: 1.0, seats: 0.6,
            looks: { partier: 8, student: 2 },
            walkers: { drunk: 4, toCar: 3, walkGroup: 2, walk: 1 },
            spots: {},
            street: { smoke: 4, drink: 1.5, vomit: 1.5, passedOut: 0.4 },
            doors: [D.BAR, D.FOOD]
        }
    },
    OLDER: {
        name: 'Older Residential',
        day: {
            peds: 0.75, cars: 0.55, parked: 0.6, seats: 0.7,
            looks: { older: 7, adult: 3 },
            walkers: { dog: 4, walk: 3, toDoor: 1.5, fromDoor: 1.5, walkGroup: 0.6 },
            spots: { yardwork: 4, hang: 2 },
            street: {},
            doors: [D.HOUSE]
        },
        night: {
            peds: 0.12, cars: 0.18, parked: 0.85, seats: 0.05,
            looks: { older: 3, adult: 2 },
            walkers: { walk: 2, dog: 1, toDoor: 2 },
            spots: {}, street: {},
            doors: [D.HOUSE]
        }
    },
    COMMERCIAL: {
        name: 'Commercial',
        day: {
            peds: 0.9, cars: 1.0, parked: 0.7, seats: 0.8,
            looks: { shopper: 6, adult: 3, worker: 2, student: 1 },
            walkers: { toDoor: 4, fromDoor: 4, toCar: 3, walk: 1.5 },
            spots: {}, street: {},
            doors: [D.SHOP, D.FOOD, D.OTHER],
            driveThru: 1
        },
        night: {
            peds: 0.55, cars: 0.75, parked: 0.45, seats: 0.5,
            looks: { shopper: 4, adult: 3, worker: 2, student: 2 },
            walkers: { toDoor: 3, fromDoor: 3, toCar: 3, walk: 1 },
            spots: {}, street: { smoke: 0.4 },
            doors: [D.SHOP, D.FOOD],
            driveThru: 0.8
        }
    },
    WOOSTER: {
        name: 'E Wooster',
        day: {
            peds: 0.45, cars: 0.85, parked: 0.5, seats: 0.4,
            looks: { student: 8, adult: 2 },
            // Mostly people on their way to campus (heading east)
            walkers: { headEast: 4, walk: 2, toDoor: 1, fromDoor: 1 },
            spots: {}, street: {},
            doors: [D.FOOD, D.SHOP, D.APARTMENT]
        },
        night: {
            peds: 2.2, cars: 0.7, parked: 0.9, seats: 0.6,
            looks: { partier: 9, student: 2 },
            // Streams of people walking west towards the bars
            walkers: { headWest: 8, walkGroup: 2, drunk: 1.5, toDoor: 1, fromDoor: 1 },
            spots: {},
            street: { smoke: 1, drink: 1 },
            doors: [D.FOOD, D.SHOP, D.BAR],
            music: true
        }
    },
    WOOSTER_COMMERCIAL: {
        name: 'E Wooster Commercial',
        day: {
            peds: 0.7, cars: 0.9, parked: 0.6, seats: 0.7,
            looks: { shopper: 4, student: 4, adult: 2 },
            walkers: { toDoor: 3, fromDoor: 3, toCar: 2, walk: 1.5, headEast: 1 },
            spots: {}, street: {},
            doors: [D.SHOP, D.FOOD, D.OTHER],
            driveThru: 1
        },
        night: {
            peds: 0.6, cars: 0.7, parked: 0.45, seats: 0.5,
            looks: { student: 4, partier: 3, shopper: 2 },
            walkers: { toDoor: 3, fromDoor: 3, toCar: 2, headWest: 2 },
            spots: {}, street: { smoke: 0.6 },
            doors: [D.SHOP, D.FOOD],
            driveThru: 0.8
        }
    },
    OUTSKIRTS: {
        name: 'Outskirts',
        day: {
            peds: 0.45, cars: 0.7, parked: 0.5, seats: 0.5,
            looks: { adult: 5, older: 2, student: 1, athlete: 1 },
            walkers: { walk: 4, dog: 1, jog: 1, toDoor: 1, fromDoor: 1 },
            spots: { hang: 2, yardwork: 1 },
            street: {},
            doors: [D.HOUSE, D.SHOP]
        },
        night: {
            peds: 0.12, cars: 0.3, parked: 0.6, seats: 0.1,
            looks: { adult: 3, student: 1 },
            walkers: { walk: 2, toDoor: 1 },
            spots: {}, street: {},
            doors: [D.HOUSE]
        }
    }
};

// [type, x0, y0, x1, y1] in reference-image pixels; most specific first
const BOXES_PX = [
    ['BARS', 810, 349, 858, 611],
    ['WOOSTER_COMMERCIAL', 1124, 590, 1310, 618],
    ['WOOSTER', 858, 590, 1124, 618],
    ['PARKING', 650, 533, 810, 613],
    ['COMMERCIAL', 806, 246, 858, 349],
    ['STUDENT', 755, 250, 806, 385],
    ['STUDENT', 774, 383, 810, 535],
    ['OLDER', 627, 250, 755, 418],
    ['PARK', 624, 418, 774, 531],
    ['STUDENT', 858, 255, 932, 590],
    ['AIRPORT', 936, 316, 1124, 396],
    ['UNIVERSITY', 932, 396, 1278, 590],
    ['COMMERCIAL', 621, 110, 955, 250],
    ['OLDER', 304, 230, 625, 517],
    ['OLDER', 418, 517, 650, 765],
    ['STUDENT', 650, 613, 830, 766],
    ['STUDENT', 830, 616, 1138, 803],
    ['PARK', 1138, 672, 1293, 809],
    ['COMMERCIAL', 813, 800, 867, 890],
    ['STUDENT', 867, 810, 1073, 956],
    ['COMMERCIAL', 665, 890, 865, 1066]
];

export const DISTRICT_TYPES = Object.freeze(Object.fromEntries(Object.keys(TYPES).map((k) => [k, k])));

/** District boxes in world metres: { type, def, minX, minZ, maxX, maxZ } */
export const DISTRICTS = BOXES_PX.map(([type, x0, y0, x1, y1]) => ({
    type,
    def: TYPES[type],
    minX: toWorldX(x0), minZ: toWorldZ(y0),
    maxX: toWorldX(x1), maxZ: toWorldZ(y1)
}));

const OUTSKIRTS = { type: 'OUTSKIRTS', def: TYPES.OUTSKIRTS, minX: -Infinity, minZ: -Infinity, maxX: Infinity, maxZ: Infinity };

export function districtAt(x, z) {
    for (let i = 0; i < DISTRICTS.length; i++) {
        const d = DISTRICTS[i];
        if (x >= d.minX && x <= d.maxX && z >= d.minZ && z <= d.maxZ) return d;
    }
    return OUTSKIRTS;
}

function smooth(e0, e1, x) {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

/** 0 through the day, 1 from 9 pm to 4 am, ramping over dusk (6-9 pm) and dawn (4-7 am). */
export function nightFactor(hours) {
    const h = ((hours % 24) + 24) % 24;
    if (h >= 12) return smooth(18, 21, h);
    return 1 - smooth(4, 7, h);
}

const NUMERIC = ['peds', 'cars', 'parked', 'seats', 'patrol', 'driveThru', 'seatStudy'];

/**
 * The district's numbers for this time of night (numbers blend; for the tables, `night` is the
 * chance the night table applies, see pickTable).
 */
export function districtProfile(district, night) {
    const def = (district && district.def) || TYPES.OUTSKIRTS;
    const out = {};
    for (const k of NUMERIC) out[k] = (def.day[k] || 0) * (1 - night) + (def.night[k] || 0) * night;
    return out;
}

/** The day or the night table of a district, chosen at random in proportion to `night`. */
export function pickTable(district, night, rand = Math.random) {
    const def = (district && district.def) || TYPES.OUTSKIRTS;
    return rand() < night ? def.night : def.day;
}

/** A key of a { key: weight } table, or null when it's empty. */
export function pickWeighted(table, rand = Math.random) {
    if (!table) return null;
    let total = 0;
    for (const k in table) total += table[k];
    if (total <= 0) return null;
    let r = rand() * total;
    for (const k in table) {
        r -= table[k];
        if (r <= 0) return k;
    }
    return null;
}
