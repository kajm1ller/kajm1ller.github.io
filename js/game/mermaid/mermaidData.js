/**
 * js/game/mermaid/mermaidData.js
 *
 * Content for Mermaid World (the LSD trip): the character creator's options and what unlocks them,
 * the wedding planner's choices, the shops, the talking fish and townsfolk, the places on the map,
 * and the numbers behind the minigames.
 */

// ---- Character creator ------------------------------------------------------------------------
export const HAIR_STYLES = [
    { id: 'long', name: 'Long & Flowing' },
    { id: 'wavy', name: 'Beach Waves' },
    { id: 'ponytail', name: 'High Ponytail' },
    { id: 'bun', name: 'Top Bun' },
    { id: 'spacebuns', name: 'Space Buns' },
    { id: 'pigtails', name: 'Pigtails' },
    { id: 'bob', name: 'Bob' },
    { id: 'braid', name: 'Long Braid' },
    { id: 'sidebraid', name: 'Side Braid' },
    { id: 'pixie', name: 'Pixie Cut' },
    { id: 'curly', name: 'Big Curls' },
    { id: 'crest', name: 'Fin Crest' }
];
export const HAIR_COLORS = [0xd94f8a, 0xf28fb6, 0x8e5bd6, 0x4a90e2, 0x2ec4b6, 0x7ed957, 0xffd166, 0xf4a259, 0xb5523b,
    0x3b2416, 0x111111, 0xf5f0e6, 0xc0c0c0, 0xff6b6b, 0x00cec9, 0xa29bfe, 0x6c5ce7, 0xe84393];
export const HAIR_TIPS = [null, 0xff9ff3, 0x74b9ff, 0x55efc4, 0xffeaa7, 0xa29bfe, 0xffffff, 0xff7675, 0x48dbfb];
export const SKIN_TONES = [0xfbe2d0, 0xf6d7c3, 0xeac0a0, 0xe0ac69, 0xc68642, 0xa0673f, 0x8d5524, 0x5c3a21, 0x3e2723,
    0xb8e0d2, 0xc9b6f2, 0xa5d8ff];
export const EYE_COLORS = [0x2e86de, 0x10ac84, 0x6d4c41, 0x8e44ad, 0xf39c12, 0x34495e, 0xe84393, 0x00cec9, 0xff7675, 0x1e272e, 0xa4b0be, 0xfeca57];
export const EYE_SHAPES = [
    { id: 'round', name: 'Round' },
    { id: 'almond', name: 'Almond' },
    { id: 'big', name: 'Big & Sparkly' },
    { id: 'sleepy', name: 'Sleepy' },
    { id: 'cat', name: 'Cat Eye' },
    { id: 'star', name: 'Starry' }
];
export const BROWS = [
    { id: 'soft', name: 'Soft' },
    { id: 'arched', name: 'Arched' },
    { id: 'thick', name: 'Bold' },
    { id: 'none', name: 'None' }
];
export const LASHES = [
    { id: 'none', name: 'None' },
    { id: 'natural', name: 'Natural' },
    { id: 'long', name: 'Long' }
];
export const MOUTHS = [
    { id: 'smile', name: 'Smile' },
    { id: 'soft', name: 'Soft' },
    { id: 'grin', name: 'Grin' },
    { id: 'pout', name: 'Pout' }
];
export const LIPSTICKS = [null, 0xe84393, 0xd63031, 0xff7675, 0xa55eea, 0xfd79a8, 0x6c3483, 0xff9f43, 0x00b894, 0x2d3436];
export const EYESHADOWS = [null, 0xa29bfe, 0x74b9ff, 0x55efc4, 0xfd79a8, 0xffeaa7, 0xe17055, 0x2d3436, 0x00cec9, 0xff9ff3];
export const BLUSHES = [null, 0xff8fa3, 0xff6b81, 0xffb88c, 0xc7a6ff];
export const FACE_PAINTS = [
    { id: 'none', name: 'None' },
    { id: 'stars', name: 'Stars' },
    { id: 'waves', name: 'Waves' },
    { id: 'shells', name: 'Shells' },
    { id: 'hearts', name: 'Hearts' },
    { id: 'tears', name: 'Pearl Tears' },
    { id: 'band', name: 'Glitter Band' }
];
export const EARS = [
    { id: 'round', name: 'Round' },
    { id: 'fin', name: 'Fin Ears' },
    { id: 'pointed', name: 'Pointed' }
];
export const BUILDS = [
    { id: 0, name: 'Slim' },
    { id: 1, name: 'Average' },
    { id: 2, name: 'Curvy' }
];
export const TAIL_COLORS = [
    { name: 'Lagoon', a: 0x00b894, b: 0x0984e3 },
    { name: 'Coral', a: 0xff7675, b: 0xfd79a8 },
    { name: 'Amethyst', a: 0x8e44ad, b: 0xe84393 },
    { name: 'Sunset', a: 0xfdcb6e, b: 0xe17055 },
    { name: 'Ocean', a: 0x0652dd, b: 0x12cbc4 },
    { name: 'Pearl', a: 0xf5f6fa, b: 0xdcdde1 },
    { name: 'Emerald', a: 0x009432, b: 0xa3cb38 },
    { name: 'Midnight', a: 0x2c3e50, b: 0x8e44ad },
    { name: 'Gold', a: 0xf1c40f, b: 0xe67e22 },
    { name: 'Bubblegum', a: 0xff9ff3, b: 0x48dbfb },
    { name: 'Aurora', a: 0x55efc4, b: 0xa29bfe },
    { name: 'Ruby', a: 0xc0392b, b: 0xff6b6b },
    { name: 'Glacier', a: 0xdff9fb, b: 0x74b9ff },
    { name: 'Sakura', a: 0xffc0cb, b: 0xfd79a8 },
    { name: 'Obsidian', a: 0x1e272e, b: 0x48dbfb },
    { name: 'Lime Fizz', a: 0xbadc58, b: 0x22a6b3 }
];
export const TAIL_PATTERNS = [
    { id: 'scales', name: 'Scales' },
    { id: 'stripes', name: 'Stripes' },
    { id: 'spots', name: 'Spots' },
    { id: 'ombre', name: 'Ombre' },
    { id: 'plain', name: 'Smooth' }
];
export const FIN_STYLES = [
    { id: 'classic', name: 'Classic' },
    { id: 'ruffle', name: 'Ruffled' },
    { id: 'double', name: 'Double Fin' },
    { id: 'sword', name: 'Swordtail' },
    { id: 'fan', name: 'Fantail' },
    { id: 'whale', name: 'Whale Fluke' }
];
export const TOPS = [
    { id: 'shells', name: 'Seashell Top' },
    { id: 'bandeau', name: 'Bandeau' },
    { id: 'crop', name: 'Crop Top' },
    { id: 'tank', name: 'Tank Top' },
    { id: 'halter', name: 'Halter' },
    { id: 'seaweed', name: 'Seaweed Wrap' },
    { id: 'pearls', name: 'Pearl Strands' },
    { id: 'starfish', name: 'Starfish Top' },
    { id: 'corset', name: 'Pearl Corset' },
    { id: 'none', name: 'Nothing' }
];
export const TOP_COLORS = [0xfd79a8, 0xa29bfe, 0x74b9ff, 0x55efc4, 0xffeaa7, 0xffffff, 0xff7675, 0xe17055, 0x2d3436, 0x00cec9, 0xf8c291, 0x6c5ce7];
export const BOTTOMS = [
    { id: 'none', name: 'None' },
    { id: 'belt', name: 'Shell Belt' },
    { id: 'sash', name: 'Silk Sash' },
    { id: 'pearlbelt', name: 'Pearl Belt' },
    { id: 'skirt', name: 'Fin Skirt' },
    { id: 'ruffle', name: 'Ruffle Wrap' }
];
export const CAPES = [
    { id: 'none', name: 'None' },
    { id: 'kelp', name: 'Kelp Cape' },
    { id: 'fins', name: 'Back Fins' },
    { id: 'wings', name: 'Wings' }
];
export const HEAD_ACCS = [
    { id: 'none', name: 'None' },
    { id: 'tiara', name: 'Coral Tiara' },
    { id: 'starfish', name: 'Starfish Clip' },
    { id: 'flower', name: 'Sea Flower' },
    { id: 'crown', name: 'Shell Crown' },
    { id: 'headband', name: 'Pearl Headband' },
    { id: 'coral', name: 'Coral Antlers' },
    { id: 'pearlpins', name: 'Pearl Pins' },
    { id: 'moonCrown', name: 'Moon Crown' }
];
export const NECK_ACCS = [
    { id: 'none', name: 'None' },
    { id: 'necklace', name: 'Pearl Necklace' },
    { id: 'choker', name: 'Shell Choker' },
    { id: 'pendant', name: 'Moon Pendant' }
];
export const EAR_ACCS = [
    { id: 'none', name: 'None' },
    { id: 'pearls', name: 'Pearl Studs' },
    { id: 'shells', name: 'Shell Drops' },
    { id: 'hoops', name: 'Gold Hoops' }
];
export const ARM_ACCS = [
    { id: 'none', name: 'None' },
    { id: 'bracelets', name: 'Bracelets' },
    { id: 'armfins', name: 'Arm Fins' },
    { id: 'cuffs', name: 'Gold Cuffs' }
];
export const AURAS = [
    { id: 'none', name: 'None' },
    { id: 'sparkles', name: 'Sparkles' },
    { id: 'bubbles', name: 'Bubble Halo' },
    { id: 'glow', name: 'Soft Glow' }
];
export const PETS = [
    { id: 'none', name: 'No Pet' },
    { id: 'turtle', name: 'Shelly the Turtle' },
    { id: 'puffer', name: 'Pufferson' },
    { id: 'seahorse', name: 'Dash the Seahorse' },
    { id: 'jelly', name: 'Glow the Jelly' },
    { id: 'crab', name: 'Gerald Jr.' }
];

/** Options that aren't free from the start: kind -> value -> what unlocks it (an item id, or 'reward:id'). */
export const LOCKED = {
    hairStyle: { crest: 'hair_crest', curly: 'hair_curly', spacebuns: 'hair_space' },
    top: { corset: 'top_corset', starfish: 'top_starfish_t' },
    finStyle: { whale: 'fin_whale', sword: 'fin_sword', fan: 'fin_fan' },
    tailPattern: { spots: 'pat_spots', stripes: 'pat_stripes' },
    facePaint: { hearts: 'paint_hearts', tears: 'paint_tears', band: 'paint_band' },
    cape: { wings: 'cape_wings', kelp: 'cape_kelp', fins: 'cape_fins' },
    headAcc: { moonCrown: 'reward:moonCrown', coral: 'acc_coral', headband: 'acc_headband' },
    neckAcc: { pendant: 'reward:moonPendant', choker: 'acc_choker' },
    aura: { sparkles: 'aura_sparkles', bubbles: 'aura_bubbles', glow: 'reward:aura' },
    bottom: { skirt: 'bot_skirt', ruffle: 'bot_ruffle', pearlbelt: 'bot_pearl' }
};

export function isUnlocked(kind, value, owned) {
    const need = LOCKED[kind] && LOCKED[kind][value];
    return !need || owned.has(need);
}

export function defaultLook() {
    return {
        name: 'Marina',
        height: 1.0, build: 1,
        skin: 0xf6d7c3, ears: 'fin',
        hairStyle: 'long', hairColor: 0xd94f8a, hairTip: 0xff9ff3, highlights: false,
        eyeColor: 0x2e86de, eyeShape: 'big', brows: 'soft', lashes: 'long', mouth: 'smile', freckles: false,
        lipstick: 0xe84393, eyeshadow: 0xa29bfe, eyeliner: false, blush: 0xff8fa3, facePaint: 'none', glitter: false,
        tailSize: 1.0, tail: 0, tailPattern: 'scales', finStyle: 'classic', tailGlow: false,
        top: 'shells', topColor: 0xfd79a8, bottom: 'belt', bottomColor: 0xffd166, cape: 'none', capeColor: 0x74b9ff,
        headAcc: 'starfish', neckAcc: 'none', earAcc: 'pearls', armAcc: 'none', aura: 'none',
        pet: 'none'
    };
}

/** Fills in anything a saved look (an older version) is missing. */
export function normalizeLook(look) {
    const out = Object.assign(defaultLook(), look || {});
    if (look && look.accessory !== undefined) {
        // the first version had a single accessory slot
        const a = look.accessory;
        if (a === 'necklace') out.neckAcc = 'necklace';
        else if (['tiara', 'starfish', 'flower', 'crown'].includes(a)) out.headAcc = a;
        else if (a === 'none') out.headAcc = 'none';
        delete out.accessory;
    }
    if (look && look.blush === true) out.blush = 0xff8fa3;
    if (look && look.blush === false) out.blush = null;
    if (look && look.lashes === true) out.lashes = 'long';
    if (look && look.lashes === false) out.lashes = 'none';
    if (look && look.top === 'tank' && look.topColor === undefined) out.topColor = 0x00cec9;
    return out;
}

export function randomLook(rand = Math.random, owned = null) {
    const pick = (a) => a[Math.floor(rand() * a.length)];
    const free = (kind, list) => pick(list.filter((o) => !owned || isUnlocked(kind, o.id, owned))).id;
    return {
        ...defaultLook(),
        name: pick(['Coral', 'Pearl', 'Shelly', 'Nerissa', 'Ondine', 'Kai', 'Wave', 'Lagoona', 'Marisol', 'Ariella', 'Tidal', 'Misty']),
        height: 0.93 + rand() * 0.14, build: Math.floor(rand() * 3),
        skin: pick(SKIN_TONES), ears: pick(EARS).id,
        hairStyle: free('hairStyle', HAIR_STYLES), hairColor: pick(HAIR_COLORS), hairTip: rand() < 0.5 ? pick(HAIR_TIPS) : null, highlights: rand() < 0.3,
        eyeColor: pick(EYE_COLORS), eyeShape: pick(EYE_SHAPES).id, brows: pick(BROWS).id, lashes: pick(LASHES).id, mouth: pick(MOUTHS).id, freckles: rand() < 0.3,
        lipstick: pick(LIPSTICKS), eyeshadow: pick(EYESHADOWS), eyeliner: rand() < 0.4, blush: pick(BLUSHES), facePaint: free('facePaint', FACE_PAINTS), glitter: rand() < 0.25,
        tailSize: 0.85 + rand() * 0.35, tail: Math.floor(rand() * TAIL_COLORS.length), tailPattern: free('tailPattern', TAIL_PATTERNS), finStyle: free('finStyle', FIN_STYLES), tailGlow: rand() < 0.2,
        top: free('top', TOPS), topColor: pick(TOP_COLORS), bottom: free('bottom', BOTTOMS), bottomColor: pick(TOP_COLORS), cape: free('cape', CAPES), capeColor: pick(TOP_COLORS),
        headAcc: free('headAcc', HEAD_ACCS), neckAcc: free('neckAcc', NECK_ACCS), earAcc: pick(EAR_ACCS).id, armAcc: pick(ARM_ACCS).id, aura: free('aura', AURAS)
    };
}

/** Ready-made looks to start from (and the three friends). */
export const PRESETS = [
    { name: 'Classic Mermaid', look: { hairStyle: 'long', hairColor: 0xd94f8a, tail: 0, top: 'shells', topColor: 0xfd79a8, headAcc: 'starfish' } },
    { name: 'Sea Princess', look: { hairStyle: 'wavy', hairColor: 0xffd166, hairTip: 0xff9ff3, tail: 9, top: 'bandeau', topColor: 0xffffff, headAcc: 'tiara', neckAcc: 'necklace', finStyle: 'ruffle', skin: 0xfbe2d0 } },
    { name: 'Midnight Siren', look: { hairStyle: 'sidebraid', hairColor: 0x6c5ce7, hairTip: 0x48dbfb, tail: 7, top: 'halter', topColor: 0x2d3436, lipstick: 0x6c3483, eyeshadow: 0xa29bfe, eyeliner: true, tailGlow: true, tailPattern: 'ombre', skin: 0xeac0a0 } },
    { name: 'Reef Punk', look: { hairStyle: 'pixie', hairColor: 0x7ed957, hairTip: 0xffeaa7, tail: 15, top: 'crop', topColor: 0x2d3436, headAcc: 'none', earAcc: 'hoops', armAcc: 'cuffs', eyeShape: 'cat', brows: 'thick', tailPattern: 'stripes', skin: 0xc68642 } },
    { name: 'Kelp Witch', look: { hairStyle: 'braid', hairColor: 0x3b2416, tail: 6, top: 'seaweed', topColor: 0x55efc4, headAcc: 'coral', freckles: true, tailPattern: 'spots', skin: 0xa0673f } },
    { name: 'Glacier Queen', look: { hairStyle: 'ponytail', hairColor: 0xf5f0e6, hairTip: 0x74b9ff, tail: 12, top: 'pearls', topColor: 0xffffff, headAcc: 'headband', ears: 'pointed', finStyle: 'double', skin: 0xfbe2d0 } }
];

// ---- Task: the wedding -------------------------------------------------------------------------
export const WEDDING = {
    steps: [
        {
            id: 'theme', title: 'Theme & Decor', hint: 'How should the Coral Chapel look?', type: 'one',
            options: [
                { id: 'pearl', name: 'Pearl & Coral', desc: 'Blush coral arches, strings of pearls', color: 0xffc0cb },
                { id: 'moon', name: 'Moonlit Kelp', desc: 'Silver kelp curtains, soft moonbeams', color: 0xc8d6e5 },
                { id: 'glow', name: 'Bioluminescent', desc: 'Everything glows electric blue', color: 0x48dbfb },
                { id: 'treasure', name: 'Sunken Treasure', desc: 'Gold coins, chests and candelabras', color: 0xf6b93b }
            ]
        },
        {
            id: 'dress', title: 'Your Wedding Look', hint: 'Pick a style and a colour', type: 'one',
            options: [
                { id: 'gown', name: 'Flowing Gown', desc: 'A sheer gown that drifts like a jellyfish' },
                { id: 'veil', name: 'Pearl Veil', desc: 'A long veil sewn with a thousand pearls' },
                { id: 'bodice', name: 'Seashell Bodice', desc: 'Iridescent shells and a sweeping train' },
                { id: 'lace', name: 'Kelp Lace', desc: 'Delicate lace woven from golden kelp' }
            ],
            colors: [0xffffff, 0xfff1f2, 0xffd6e7, 0xd6f0ff, 0xe6d6ff, 0xfff3b0]
        },
        {
            id: 'partner', title: 'Your Partner', hint: 'Who are you marrying?', type: 'one',
            options: [
                { id: 'kai', name: 'Kai', desc: 'A surfer merman with a turquoise tail' },
                { id: 'neptune', name: 'Prince Triton', desc: 'Royalty. Has a trident. Very serious.' },
                { id: 'pearl', name: 'Pearl', desc: 'Your best friend since the reef days' },
                { id: 'finn', name: 'Finn', desc: 'Shy, sweet, plays the conch shell' }
            ]
        },
        {
            id: 'bouquet', title: 'The Bouquet', hint: 'Flowers for the aisle', type: 'one',
            options: [
                { id: 'anemone', name: 'Anemone Burst', desc: 'Swaying tentacle-flowers in every colour', color: 0xff6f91 },
                { id: 'seaflower', name: 'Glow Sea-Roses', desc: 'Soft lanterns on green stems', color: 0xf9f871 },
                { id: 'lavender', name: 'Sea Lavender', desc: 'Calm, dreamy and a bit purple', color: 0xa29bfe },
                { id: 'pearlbloom', name: 'Pearl Blooms', desc: 'Every petal holds a tiny pearl', color: 0xffffff }
            ]
        },
        {
            id: 'cake', title: 'The Cake', hint: 'Tiers, flavour and topper', type: 'cake',
            tiers: [2, 3, 4, 5],
            flavors: [
                { id: 'caramel', name: 'Sea-Salt Caramel', color: 0xe0b07a },
                { id: 'kelp', name: 'Kelp Lime', color: 0xa8e063 },
                { id: 'berry', name: 'Coral Berry', color: 0xff8fab },
                { id: 'vanilla', name: 'Plankton Vanilla', color: 0xfff6d5 },
                { id: 'ink', name: 'Squid Ink Chocolate', color: 0x4b3832 }
            ],
            toppers: [
                { id: 'couple', name: 'Two Mermaids' },
                { id: 'seahorses', name: 'Kissing Seahorses' },
                { id: 'pearl', name: 'Giant Pearl' },
                { id: 'starfish', name: 'Golden Starfish' }
            ]
        },
        {
            id: 'music', title: 'Music', hint: 'What plays as you swim down the aisle?', type: 'one',
            options: [
                { id: 'whales', name: 'Whale Choir', desc: 'Deep, haunting, beautiful' },
                { id: 'dj', name: 'Dolphin DJ', desc: 'Clicks, whistles and a sick drop' },
                { id: 'crabs', name: 'Crab Steel Drums', desc: 'Calypso! Everyone dances' },
                { id: 'sirens', name: 'Siren Serenade', desc: 'Three sirens singing in harmony' }
            ]
        },
        {
            id: 'vows', title: 'The Vows', hint: 'What kind of promises are we making?', type: 'one',
            options: [
                { id: 'poetic', name: 'Poetic', desc: '"You are the tide to my moon..."' },
                { id: 'funny', name: 'Funny', desc: '"I promise to share my krill. Mostly."' },
                { id: 'short', name: 'Short & Sweet', desc: '"I do. Obviously. Let\'s eat cake."' }
            ]
        },
        {
            id: 'moments', title: 'Ceremony Moments', hint: 'Pick everything you want to happen', type: 'many',
            options: [
                { id: 'bubbles', name: 'Bubble Arch Release' },
                { id: 'jellies', name: 'Jellyfish Light Show' },
                { id: 'dolphins', name: 'Dolphin Ring Bearers' },
                { id: 'seahorses', name: 'Seahorse Parade' },
                { id: 'turtle', name: 'Turtle Officiant' },
                { id: 'dance', name: 'First Dance' },
                { id: 'cakecut', name: 'Cake Cutting' },
                { id: 'plankton', name: 'Glowing Plankton Fireworks' },
                { id: 'toss', name: 'Bouquet Toss' },
                { id: 'rays', name: 'Manta Ray Flyover' }
            ]
        },
        {
            id: 'guests', title: 'Guest List', hint: 'Who gets an invitation?', type: 'many',
            options: [
                { id: 'friends', name: 'Your Mermaid Friends' },
                { id: 'fish', name: 'The Talking Fish' },
                { id: 'octopus', name: 'Auntie Octavia (octopus)' },
                { id: 'crabs', name: 'The Crab Family' },
                { id: 'shark', name: 'Gary the (vegetarian) Shark' },
                { id: 'whale', name: 'Grandma Whale' }
            ]
        }
    ]
};

export const VOWS = {
    poetic: ['"You are the tide, and I the moon. Wherever you flow, I will pull you home."', '"I do. Forever and a day and every tide between."'],
    funny: ['"I promise to share my krill. Mostly. Okay, half."', '"I do! And I promise never to tell anyone about the incident with the jellyfish."'],
    short: ['"I do."', '"Obviously. Now where is that cake?"']
};

// ---- Shops -------------------------------------------------------------------------------------
export const START_MONEY = 150;
/**
 * Items: give = a patch applied to your look and kept on you; unlock = an option that opens in the
 * wardrobe for good; tags say what a friend might think of it as a gift.
 */
export const SHOPS = [
    {
        id: 'shellco', name: 'Shell & Co.', kind: 'clothes', sign: 0xfd79a8,
        keeper: { name: 'Shelly', look: { hairStyle: 'bob', hairColor: 0xf28fb6, tail: 1, top: 'crop', topColor: 0xffffff, headAcc: 'flower', skin: 0xeac0a0 } },
        greeting: 'Welcome to Shell & Co.! Everything is hand-picked from the finest reefs.',
        items: [
            { id: 'top_crop_lav', name: 'Lavender Crop Top', price: 30, give: { top: 'crop', topColor: 0xa29bfe }, tags: ['cute'] },
            { id: 'top_tank_aqua', name: 'Aqua Tank Top', price: 25, give: { top: 'tank', topColor: 0x00cec9 }, tags: ['cool'] },
            { id: 'top_bandeau_gold', name: 'Gold Bandeau', price: 40, give: { top: 'bandeau', topColor: 0xffd166 }, tags: ['sparkly'] },
            { id: 'top_shells_pink', name: 'Pink Seashell Top', price: 35, give: { top: 'shells', topColor: 0xff9ff3 }, tags: ['cute'] },
            { id: 'top_halter_black', name: 'Midnight Halter', price: 38, give: { top: 'halter', topColor: 0x2d3436 }, tags: ['cool'] },
            { id: 'top_seaweed', name: 'Seaweed Wrap', price: 20, give: { top: 'seaweed', topColor: 0x55efc4 }, tags: ['cool'] },
            { id: 'top_corset', name: 'Pearl Corset', price: 70, give: { top: 'corset', topColor: 0xffffff }, unlock: ['top_corset'], tags: ['fancy', 'sparkly'] },
            { id: 'top_starfish_t', name: 'Starfish Top', price: 45, give: { top: 'starfish', topColor: 0xff9f43 }, unlock: ['top_starfish_t'], tags: ['cute'] },
            { id: 'bot_skirt', name: 'Silk Fin Skirt', price: 55, give: { bottom: 'skirt', bottomColor: 0xff9ff3 }, unlock: ['bot_skirt'], tags: ['fancy'] },
            { id: 'bot_ruffle', name: 'Ruffle Wrap', price: 45, give: { bottom: 'ruffle', bottomColor: 0x74b9ff }, unlock: ['bot_ruffle'], tags: ['cute'] },
            { id: 'bot_pearl', name: 'Pearl Belt', price: 40, give: { bottom: 'pearlbelt', bottomColor: 0xffffff }, unlock: ['bot_pearl'], tags: ['sparkly'] },
            { id: 'cape_kelp', name: 'Kelp Cape', price: 50, give: { cape: 'kelp', capeColor: 0x2ecc71 }, unlock: ['cape_kelp'], tags: ['cool'] },
            { id: 'cape_wings', name: 'Shimmer Wings', price: 90, give: { cape: 'wings', capeColor: 0x74b9ff }, unlock: ['cape_wings'], tags: ['fancy', 'sparkly'] },
            { id: 'cape_fins', name: 'Back Fins', price: 60, give: { cape: 'fins', capeColor: 0xfd79a8 }, unlock: ['cape_fins'], tags: ['cool'] }
        ]
    },
    {
        id: 'pearl', name: 'Pearl Boutique', kind: 'clothes', sign: 0xdfe6e9,
        keeper: { name: 'Madame Perle', look: { hairStyle: 'bun', hairColor: 0xf5f0e6, tail: 5, top: 'pearls', topColor: 0xffffff, headAcc: 'tiara', neckAcc: 'necklace', skin: 0xfbe2d0 } },
        greeting: 'Darling! A pearl a day keeps the barnacles away.',
        items: [
            { id: 'acc_tiara', name: 'Coral Tiara', price: 45, give: { headAcc: 'tiara' }, tags: ['fancy'] },
            { id: 'acc_necklace', name: 'Pearl Necklace', price: 50, give: { neckAcc: 'necklace' }, tags: ['sparkly', 'fancy'] },
            { id: 'acc_crown', name: 'Shell Crown', price: 60, give: { headAcc: 'crown' }, tags: ['fancy'] },
            { id: 'acc_flower', name: 'Sea Flower Clip', price: 15, give: { headAcc: 'flower' }, tags: ['cute'] },
            { id: 'acc_headband', name: 'Pearl Headband', price: 35, give: { headAcc: 'headband' }, unlock: ['acc_headband'], tags: ['sparkly'] },
            { id: 'acc_coral', name: 'Coral Antlers', price: 50, give: { headAcc: 'coral' }, unlock: ['acc_coral'], tags: ['cool'] },
            { id: 'acc_choker', name: 'Shell Choker', price: 30, give: { neckAcc: 'choker' }, unlock: ['acc_choker'], tags: ['cool'] },
            { id: 'ear_pearls', name: 'Pearl Studs', price: 20, give: { earAcc: 'pearls' }, tags: ['sparkly'] },
            { id: 'ear_shells', name: 'Shell Drops', price: 22, give: { earAcc: 'shells' }, tags: ['cute'] },
            { id: 'ear_hoops', name: 'Gold Hoops', price: 28, give: { earAcc: 'hoops' }, tags: ['cool'] },
            { id: 'arm_bracelets', name: 'Coral Bracelets', price: 24, give: { armAcc: 'bracelets' }, tags: ['cute'] },
            { id: 'arm_cuffs', name: 'Gold Cuffs', price: 32, give: { armAcc: 'cuffs' }, tags: ['fancy'] },
            { id: 'arm_fins', name: 'Arm Fins', price: 34, give: { armAcc: 'armfins' }, tags: ['cool'] }
        ]
    },
    {
        id: 'scales', name: 'Scale Salon', kind: 'clothes', sign: 0x48dbfb,
        keeper: { name: 'Auntie Octavia', octopus: true },
        greeting: 'New tail, new you! Pick a shimmer, a pattern, a whole new mane.',
        items: [
            { id: 'tail_bubblegum', name: 'Bubblegum Tail Shimmer', price: 40, give: { tail: 9 }, tags: ['cute'] },
            { id: 'tail_gold', name: 'Gold Tail Shimmer', price: 45, give: { tail: 8 }, tags: ['sparkly'] },
            { id: 'tail_midnight', name: 'Midnight Tail Shimmer', price: 40, give: { tail: 7 }, tags: ['cool'] },
            { id: 'tail_aurora', name: 'Aurora Tail Shimmer', price: 55, give: { tail: 10 }, tags: ['sparkly'] },
            { id: 'tail_glacier', name: 'Glacier Tail Shimmer', price: 45, give: { tail: 12 }, tags: ['cool'] },
            { id: 'pat_spots', name: 'Spotted Tail', price: 30, give: { tailPattern: 'spots' }, unlock: ['pat_spots'], tags: ['cute'] },
            { id: 'pat_stripes', name: 'Striped Tail', price: 30, give: { tailPattern: 'stripes' }, unlock: ['pat_stripes'], tags: ['cool'] },
            { id: 'fin_sword', name: 'Swordtail Fin', price: 45, give: { finStyle: 'sword' }, unlock: ['fin_sword'], tags: ['cool'] },
            { id: 'fin_fan', name: 'Fantail Fin', price: 45, give: { finStyle: 'fan' }, unlock: ['fin_fan'], tags: ['fancy'] },
            { id: 'fin_whale', name: 'Whale Fluke', price: 55, give: { finStyle: 'whale' }, unlock: ['fin_whale'], tags: ['cool'] },
            { id: 'hair_glow', name: 'Glow Green Hair Dye', price: 30, give: { hairColor: 0x7ed957 }, tags: ['cool'] },
            { id: 'hair_teal', name: 'Lagoon Hair Dye', price: 30, give: { hairColor: 0x00cec9, hairTip: 0x74b9ff }, tags: ['cute'] },
            { id: 'hair_crest', name: 'Fin Crest Style', price: 60, give: { hairStyle: 'crest' }, unlock: ['hair_crest'], tags: ['cool'] },
            { id: 'hair_curly', name: 'Big Curls Style', price: 50, give: { hairStyle: 'curly' }, unlock: ['hair_curly'], tags: ['cute'] },
            { id: 'hair_space', name: 'Space Buns Style', price: 40, give: { hairStyle: 'spacebuns' }, unlock: ['hair_space'], tags: ['cute'] }
        ]
    },
    {
        id: 'glitter', name: 'Glitter Bar', kind: 'clothes', sign: 0xa29bfe,
        keeper: { name: 'Sparkle', look: { hairStyle: 'spacebuns', hairColor: 0xa29bfe, hairTip: 0xff9ff3, tail: 2, top: 'bandeau', topColor: 0xff9ff3, facePaint: 'stars', glitter: true, eyeliner: true, skin: 0xc9b6f2 } },
        greeting: 'Hiii! Looks, lashes, glitter, glitter, GLITTER!',
        items: [
            { id: 'paint_hearts', name: 'Heart Face Paint', price: 18, give: { facePaint: 'hearts' }, unlock: ['paint_hearts'], tags: ['cute'] },
            { id: 'paint_tears', name: 'Pearl Tears', price: 22, give: { facePaint: 'tears' }, unlock: ['paint_tears'], tags: ['sparkly'] },
            { id: 'paint_band', name: 'Glitter Band', price: 20, give: { facePaint: 'band' }, unlock: ['paint_band'], tags: ['sparkly'] },
            { id: 'mk_lip_green', name: 'Lagoon Lipstick', price: 12, give: { lipstick: 0x00b894 }, tags: ['cool'] },
            { id: 'mk_shadow_pink', name: 'Bubblegum Eyeshadow', price: 12, give: { eyeshadow: 0xff9ff3 }, tags: ['cute'] },
            { id: 'mk_liner', name: 'Winged Eyeliner', price: 14, give: { eyeliner: true }, tags: ['cool'] },
            { id: 'mk_glitter', name: 'Body Glitter', price: 25, give: { glitter: true }, tags: ['sparkly'] },
            { id: 'aura_sparkles', name: 'Sparkle Aura', price: 80, give: { aura: 'sparkles' }, unlock: ['aura_sparkles'], tags: ['sparkly', 'fancy'] },
            { id: 'aura_bubbles', name: 'Bubble Halo', price: 70, give: { aura: 'bubbles' }, unlock: ['aura_bubbles'], tags: ['cute'] },
            { id: 'tail_glow', name: 'Glow Tail Treatment', price: 65, give: { tailGlow: true }, tags: ['cool', 'sparkly'] }
        ]
    },
    {
        id: 'cafe', name: 'Kelp Café', kind: 'food', sign: 0x55efc4,
        keeper: { name: 'Mama Kelp', look: { hairStyle: 'bun', hairColor: 0x3b2416, tail: 6, top: 'tank', topColor: 0xffffff, skin: 0x8d5524, headAcc: 'none' } },
        greeting: 'Grab a seat at the food court, sweetie. What can I get you all?',
        items: [
            { id: 'salad', name: 'Seaweed Salad', price: 12, food: 0x2ecc71, effect: 'calm' },
            { id: 'smoothie', name: 'Plankton Smoothie', price: 9, food: 0x9b59b6, effect: 'speed' },
            { id: 'tacos', name: 'Krill Tacos', price: 15, food: 0xe67e22, effect: 'speed' },
            { id: 'latte', name: 'Sea-Foam Latte', price: 8, food: 0xf5e6ca, effect: 'calm' },
            { id: 'cupcake', name: 'Coral Cupcakes', price: 10, food: 0xff7675, effect: 'glow' },
            { id: 'sushi', name: 'Anemone Sushi', price: 18, food: 0xfd79a8, effect: 'glow' },
            { id: 'pearltea', name: 'Pearl Milk Tea', price: 11, food: 0xe6c79c, effect: 'calm' }
        ]
    },
    {
        id: 'trinkets', name: 'Trinket Trove', kind: 'gifts', sign: 0xffeaa7,
        keeper: { name: 'Barnaby', crab: true },
        greeting: 'Trinkets, treasures, tchotchkes! Seeds for the sea garden, maps for the curious.',
        items: [
            { id: 'seed_pack', name: 'Seed Pack (6 seeds)', price: 18, grants: { seeds: 6 }, tags: ['cute'] },
            { id: 'treasure_map', name: 'Old Treasure Map', price: 25, grants: { flag: 'hasMap' }, tags: ['cool'] },
            { id: 'plush_octopus', name: 'Plush Octopus', price: 22, gift: true, tags: ['cute'] },
            { id: 'music_shell', name: 'Singing Shell', price: 28, gift: true, tags: ['sparkly', 'cool'] },
            { id: 'jelly_lamp', name: 'Jellyfish Lamp', price: 34, gift: true, tags: ['sparkly', 'cute'] },
            { id: 'snow_globe', name: 'Reef Snow Globe', price: 26, gift: true, tags: ['fancy', 'cute'] },
            { id: 'gold_trident', name: 'Mini Gold Trident', price: 38, gift: true, tags: ['cool', 'fancy'] }
        ]
    }
];

/** The Clam Arcade's prize counter: tickets buy these. */
export const ARCADE_PRIZES = [
    { id: 'prize_plush', name: 'Giant Pufferfish Plush', tickets: 30, give: { pet: 'puffer' } },
    { id: 'prize_aura', name: 'Rainbow Bubble Halo', tickets: 60, unlock: ['aura_bubbles'], give: { aura: 'bubbles' } },
    { id: 'prize_pearls', name: 'Bag of Sand Dollars', tickets: 20, money: 40 },
    { id: 'prize_crest', name: 'Fin Crest Hair Style', tickets: 45, unlock: ['hair_crest'], give: { hairStyle: 'crest' } }
];

// ---- Friends -----------------------------------------------------------------------------------
export const FRIENDS = [
    {
        id: 'coral', name: 'Coral', likes: 'cute', quirk: 'obsessed with anything pink',
        look: { hairStyle: 'pigtails', hairColor: 0xf28fb6, hairTip: 0xffffff, skin: 0xf6d7c3, tail: 1, top: 'shells', topColor: 0xff9ff3, headAcc: 'flower', eyeShape: 'big', blush: 0xff6b81 }
    },
    {
        id: 'nerissa', name: 'Nerissa', likes: 'cool', quirk: 'never smiles in photos (on purpose)',
        look: { hairStyle: 'ponytail', hairColor: 0x2ec4b6, hairTip: 0x74b9ff, skin: 0xa0673f, tail: 4, top: 'halter', topColor: 0x2d3436, headAcc: 'none', earAcc: 'hoops', eyeShape: 'cat', brows: 'thick', eyeliner: true }
    },
    {
        id: 'ondine', name: 'Ondine', likes: 'sparkly', quirk: 'has never worn the same thing twice',
        look: { hairStyle: 'wavy', hairColor: 0x8e5bd6, hairTip: 0xff9ff3, skin: 0xeac0a0, tail: 2, top: 'bandeau', topColor: 0xffd166, headAcc: 'tiara', neckAcc: 'necklace', glitter: true, facePaint: 'stars' }
    }
];
export const FRIEND_LINES = {
    invite: ['OMG yes, mall day!!', 'Finally! I need a new tail shimmer.', 'Only if we get krill tacos after.'],
    shop: ['That is SO you.', 'Stunning. Iconic. Buy it.', 'Ooh, the pearl one!', 'You look like a sea queen.'],
    eat: ['Mmm, this smoothie is so good.', 'Best. Tacos. Ever.', 'Wanna split a cupcake?'],
    idle: ['Wait for meee!', 'Where are we going next?', 'This is the best day ever.', 'Did you see that jellyfish?!', 'My tail is SO shiny today.'],
    loved: ['You got me EXACTLY what I wanted?!', 'I love it. I love it. I LOVE IT.', 'Stop it, I\'m going to cry bubbles!'],
    meh: ['Aw, thanks! It\'s... very nice!', 'You shouldn\'t have! (But thanks.)', 'It\'s the thought that counts, right?']
};

// ---- Talking fish and townsfolk ----------------------------------------------------------------
/**
 * at: [x, y, z] home. kind: how it's drawn. Dialogue is picked by quest state in mermaidWorld.js;
 * the 'lines' here are the default small talk.
 */
export const TALKING_FISH = [
    {
        id: 'bubbles', name: 'Bubbles the Clownfish', kind: 'fish', color: 0xff7f27, stripe: 0xffffff, size: 0.9, at: [-30, 6, 22],
        lines: ['Oh hi! You\'re new! I can tell, your fins are still all sparkly.',
            'Fun fact: I\'ve never seen the surface. My mom says it\'s just a big ceiling.',
            'If you see a crab named Gerald, tell him he owes me three pebbles.']
    },
    {
        id: 'sage', name: 'Old Sage the Grouper', kind: 'fish', color: 0x6d6a4f, stripe: 0x8a865f, size: 2.0, at: [48, 9, -44],
        lines: ['Hmmmm. Another dreamer drifts down from the bright world.',
            'Everything here is real as long as you believe it, child. And you DO believe it.',
            'When the tasks are done, the current will carry you home. Or stay. The reef is patient.']
    },
    {
        id: 'zip', name: 'Zip the Angelfish', kind: 'fish', color: 0xf9e79f, stripe: 0x2e86c1, size: 0.9, at: [18, 14, 60],
        lines: ['Race you to the sunken ship! ...Kidding, I\'m too fast. ZOOM.',
            'Have you been to the mall yet? Kelp Café does a krill taco that will change your LIFE.']
    },
    {
        id: 'dory', name: 'Glenda the Blue Tang', kind: 'fish', color: 0x2874f0, stripe: 0xf4d03f, size: 1.0, at: [-62, 8, -18],
        lines: ['Hi! Hi! Have we met? I feel like we\'ve met.',
            'I was going somewhere. Was it the Giant Clam? It was probably the Giant Clam.',
            'Hi! Have we met?']
    },
    {
        id: 'puff', name: 'Puffington III', kind: 'puffer', color: 0xe9d8a6, stripe: 0x94795d, size: 1.1, at: [70, 6, 40],
        lines: ['I am NOT puffed up. This is just my resting shape.',
            '...Okay you startled me a little. Give me a moment. *deflates slowly*']
    },
    {
        id: 'luna', name: 'Luna the Lanternfish', kind: 'fish', color: 0x34495e, stripe: 0x48dbfb, size: 0.8, at: [-100, 20, 70], glow: true,
        lines: ['Down in the deep, I\'m the only light for miles. Up here I\'m just... a fish with a lamp.',
            'They say the whale skeleton sings on quiet nights. I\'ve heard it. It\'s mostly humming.']
    },
    {
        id: 'dolph', name: 'DJ Dolph', kind: 'dolphin', color: 0x7f8fa6, stripe: 0xecf0f1, size: 1.0, at: [-205, 14, 115],
        lines: ['Yo yo yo! The Music Grotto is open, baby. Bring your best beat.',
            'Sound travels four times faster in water. So my drops hit four times harder.']
    },
    {
        id: 'tilda', name: 'Tilda the Turtle', kind: 'turtle', color: 0x6ab04c, stripe: 0xbadc58, size: 1.0, at: [40, 5, 62],
        lines: ['I\'m only 140. That\'s young for a turtle.', 'Take your time. Everything good happens slowly.']
    }
];

/** Characters that are not fish. */
export const NPCS = {
    coralie: { name: 'Coralie the Seahorse' },
    gerald: { name: 'Gerald the Crab' },
    barnacle: { name: 'Captain Barnacle' },
    professor: { name: 'Professor Urchin' },
    octavia: { name: 'Auntie Octavia' },
    gary: { name: 'Gary the Shark' },
    grandma: { name: 'Grandma Whale' },
    crabfam: { name: 'The Crab Family' }
};

export const TOWNSFOLK = [
    { name: 'Marlin', look: { hairStyle: 'curly', hairColor: 0x111111, skin: 0x5c3a21, tail: 4, top: 'none', male: true }, at: [-14, 3, 24], says: ['Lovely current today.', 'My tail just got polished.'] },
    { name: 'Dulce', look: { hairStyle: 'sidebraid', hairColor: 0xf4a259, skin: 0xe0ac69, tail: 3, top: 'crop', topColor: 0x74b9ff }, at: [20, 3, -12], says: ['Have you tried the sea-foam latte?', 'The plaza is so pretty at night.'] },
    { name: 'Triton Jr.', look: { hairStyle: 'pixie', hairColor: 0x4a90e2, skin: 0xfbe2d0, tail: 0, top: 'none', male: true }, at: [-24, 4, -26], says: ['One day I will own a trident.', 'Gerald stole my lunch AGAIN.'] },
    { name: 'Wren', look: { hairStyle: 'bun', hairColor: 0xf5f0e6, skin: 0xc68642, tail: 8, top: 'tank', topColor: 0xffffff, headAcc: 'crown' }, at: [30, 4, 26], says: ['Don\'t go near the Glow Caves after dark.', 'The Moon Pearl hasn\'t shone in days...'] },
    { name: 'Pip', look: { hairStyle: 'pigtails', hairColor: 0xff6b6b, skin: 0xf6d7c3, tail: 9, top: 'shells', topColor: 0xfeca57, tailSize: 0.8, height: 0.8 }, at: [-6, 3, 48], says: ['Tag! You\'re it!', 'I can swim faster than anyone!'] }
];

// ---- The map -----------------------------------------------------------------------------------
export const WORLD_R = 430;
export const SURFACE_Y = 70;
/** Places: id, name, at [x, z], r (how close counts as "there"), theme (music / look). */
export const AREAS = [
    { id: 'plaza', name: 'Coral Plaza', at: [0, 0], r: 30, theme: 'town' },
    { id: 'vanity', name: 'The Dressing Shell', at: [0, 30], r: 14, theme: 'town' },
    { id: 'chapel', name: 'Coral Chapel', at: [0, -78], r: 30, theme: 'town' },
    { id: 'mall', name: 'Mermaid Mall', at: [84, 10], r: 42, theme: 'mall' },
    { id: 'arcade', name: 'Clam Arcade', at: [92, -48], r: 18, theme: 'mall' },
    { id: 'garden', name: 'Sea Garden', at: [-55, 12], r: 20, theme: 'town' },
    { id: 'petnook', name: 'Pet Nook', at: [40, 62], r: 14, theme: 'town' },
    { id: 'ship', name: 'The Sunken Ship', at: [-95, 45], r: 24, theme: 'wreck', landmark: true },
    { id: 'clam', name: 'The Giant Clam', at: [-45, -95], r: 20, theme: 'wreck', landmark: true },
    { id: 'kelp', name: 'The Kelp Forest', at: [95, -85], r: 38, theme: 'kelp', landmark: true },
    { id: 'whale', name: 'The Whale Skeleton', at: [-120, -55], r: 26, theme: 'wreck', landmark: true },
    { id: 'lagoon', name: 'Pearl Lagoon', at: [170, 150], r: 60, theme: 'reef', landmark: true },
    { id: 'temple', name: 'The Sunken Temple', at: [250, -230], r: 48, theme: 'ruins', landmark: true },
    { id: 'caves', name: 'The Glow Caves', at: [-260, -210], r: 55, theme: 'cave', landmark: true },
    { id: 'grotto', name: 'The Music Grotto', at: [-210, 120], r: 36, theme: 'grotto', landmark: true },
    { id: 'trench', name: 'The Deep Trench', at: [0, 340], r: 70, theme: 'deep', landmark: true }
];
export const LANDMARKS = AREAS.filter((a) => a.landmark).map((a) => ({ id: a.id, name: a.name, at: [a.at[0], 0, a.at[1]], radius: a.r * 0.8 }));
export const areaById = (id) => AREAS.find((a) => a.id === id);

// ---- Minigames and collectibles ----------------------------------------------------------------
/** Training rings from the dressing shell to the plaza (chapter 1). */
export const TRAINING_RINGS = [[0, 9, 18], [4, 11, 8], [-3, 8, -4], [0, 10, -16]];

/** The Pearl Lagoon ring run: [x, y, z] ring centres, in order. */
export const RING_RUN = {
    start: [120, 12, 130],
    rings: [
        [140, 14, 130], [160, 20, 120], [182, 26, 112], [204, 22, 122], [216, 14, 142], [208, 9, 166],
        [186, 8, 182], [162, 13, 186], [142, 22, 176], [130, 30, 160], [138, 36, 140], [158, 30, 128],
        [180, 20, 136], [190, 12, 154]
    ],
    radius: 5.2,
    bronze: 95, silver: 75, gold: 58,
    reward: { bronze: 40, silver: 70, gold: 120 }
};

export const PHOTO_TARGETS = [
    { id: 'turtle', name: 'Sea Turtle' },
    { id: 'manta', name: 'Manta Ray' },
    { id: 'dolphin', name: 'Dolphin' },
    { id: 'jelly', name: 'Jellyfish' },
    { id: 'octopus', name: 'Octopus' },
    { id: 'shark', name: 'Gentle Shark' },
    { id: 'seahorse', name: 'Seahorse' },
    { id: 'whale', name: 'Whale' },
    { id: 'puffer', name: 'Pufferfish' },
    { id: 'angler', name: 'Anglerfish' }
];

/** Treasure hunt: a riddle each, and where the chest is buried. */
export const TREASURES = [
    { id: 't1', clue: 'Where the old ship rests her wooden nose, a chest sleeps in the sand.', at: [-84, 0, 68], loot: 35 },
    { id: 't2', clue: 'In the giant clam\'s long shadow, X marks the spot.', at: [-64, 0, -112], loot: 35 },
    { id: 't3', clue: 'Where the kelp gives way to open sand, count ten paces from the lantern flowers.', at: [128, 0, -52], loot: 40 },
    { id: 't4', clue: 'Between two coral spires in the lagoon, something golden glints.', at: [214, 0, 176], loot: 45 },
    { id: 't5', clue: 'Beneath the singing rock, below the DJ\'s feet.', at: [-196, 0, 148], loot: 50 }
];

export const GARDEN = {
    plots: [[-62, 4], [-58, 8], [-54, 12], [-50, 16], [-62, 12], [-58, 16]],
    plants: [
        { id: 'anemone', name: 'Anemone', color: 0xff6f91 },
        { id: 'seaflower', name: 'Glow Rose', color: 0xf9f871 },
        { id: 'lavender', name: 'Sea Lavender', color: 0xa29bfe },
        { id: 'fan', name: 'Sea Fan', color: 0xff9671 },
        { id: 'sponge', name: 'Tube Sponge', color: 0xffd166 },
        { id: 'bulb', name: 'Light Bulb Coral', color: 0x48dbfb }
    ],
    growSeconds: 25
};

export const GLYPHS = [
    { id: 0, char: '✦', name: 'Star', color: '#ffeaa7' },
    { id: 1, char: '◆', name: 'Shell', color: '#ff9ff3' },
    { id: 2, char: '●', name: 'Pearl', color: '#e0f7ff' },
    { id: 3, char: '▲', name: 'Fin', color: '#55efc4' }
];

/** Rhythm songs: key lanes D F J K. bpm and density set how busy the chart is. */
export const SONGS = [
    { id: 'calypso', name: 'Gerald\'s Calypso', style: 'crabs', bpm: 112, beats: 64, density: 0.5, seed: 11 },
    { id: 'siren', name: 'Siren Serenade', style: 'sirens', bpm: 80, beats: 56, density: 0.45, seed: 23 },
    { id: 'dj', name: 'Dolphin Drop', style: 'dj', bpm: 124, beats: 72, density: 0.62, seed: 37 },
    { id: 'whales', name: 'Whale Lullaby', style: 'whales', bpm: 72, beats: 40, density: 0.35, seed: 5 }
];

export const PEARL_COUNT = 40;
export const SHELL_COUNT = 12;

// ---- Items -------------------------------------------------------------------------------------
export const ITEMS = {
    pebble: { name: 'Shiny Pebble', icon: '🪨' },
    flower: { name: 'Sea Flower', icon: '🌸' },
    invite: { name: 'Wedding Invitation', icon: '💌' },
    glowOrb: { name: 'Glow Orb', icon: '🔮' },
    moonPearl: { name: 'The Moon Pearl', icon: '🌕' },
    seed: { name: 'Garden Seed', icon: '🌱' },
    treasureMap: { name: 'Treasure Map', icon: '🗺️' },
    ticket: { name: 'Arcade Ticket', icon: '🎟️' }
};

export const ACHIEVEMENTS = [
    { id: 'firstSwim', name: 'First Strokes', desc: 'Swim through the training rings.' },
    { id: 'bride', name: 'Blushing Bride', desc: 'Hold your wedding.' },
    { id: 'mallRat', name: 'Mall Mermaid', desc: 'Finish mall day with your friends.' },
    { id: 'photog', name: 'Shutterfin', desc: 'Photograph 6 creatures.' },
    { id: 'speedy', name: 'Speed Demon', desc: 'Finish the ring run in gold time.' },
    { id: 'pearlSaver', name: 'Moon Keeper', desc: 'Return the Moon Pearl.' },
    { id: 'collector', name: 'Pearl Collector', desc: 'Collect 25 pearls.' },
    { id: 'diver', name: 'Deep Diver', desc: 'Touch the bottom of the Deep Trench.' },
    { id: 'gardener', name: 'Green Fins', desc: 'Grow a sea garden.' },
    { id: 'treasure', name: 'X Marks the Spot', desc: 'Dig up all five treasures.' },
    { id: 'concert', name: 'Headliner', desc: 'Play three songs at the Music Grotto.' },
    { id: 'pet', name: 'Best Friends', desc: 'Adopt a pet.' },
    { id: 'explorer', name: 'Cartographer', desc: 'Visit every landmark.' },
    { id: 'chatty', name: 'Social Fish', desc: 'Talk to every fish in town.' }
];
