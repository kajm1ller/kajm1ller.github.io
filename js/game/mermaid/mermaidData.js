/**
 * js/game/mermaid/mermaidData.js
 *
 * Content for Mermaid World (the LSD trip): character creator options, the wedding planner's
 * choices, the mall's shops, the talking fish and the town's landmarks.
 */

// ---- Character creator ------------------------------------------------------------------------
export const HAIR_STYLES = [
    { id: 'long', name: 'Long & Flowing' },
    { id: 'wavy', name: 'Beach Waves' },
    { id: 'bun', name: 'Top Bun' },
    { id: 'pigtails', name: 'Pigtails' },
    { id: 'bob', name: 'Bob' },
    { id: 'braid', name: 'Braid' },
    { id: 'pixie', name: 'Pixie Cut' }
];
export const HAIR_COLORS = [0xd94f8a, 0xf28fb6, 0x8e5bd6, 0x4a90e2, 0x2ec4b6, 0x7ed957, 0xffd166, 0xf4a259, 0xb5523b,
    0x3b2416, 0x111111, 0xf5f0e6, 0xc0c0c0, 0xff6b6b];
export const SKIN_TONES = [0xfbe2d0, 0xf6d7c3, 0xeac0a0, 0xe0ac69, 0xc68642, 0xa0673f, 0x8d5524, 0x5c3a21, 0xb8e0d2, 0xc9b6f2];
export const EYE_COLORS = [0x2e86de, 0x10ac84, 0x6d4c41, 0x8e44ad, 0xf39c12, 0x34495e, 0xe84393, 0x00cec9];
export const EYE_SHAPES = [
    { id: 'round', name: 'Round' },
    { id: 'almond', name: 'Almond' },
    { id: 'big', name: 'Big & Sparkly' },
    { id: 'sleepy', name: 'Sleepy' }
];
export const LIPSTICKS = [null, 0xe84393, 0xd63031, 0xff7675, 0xa55eea, 0xfd79a8, 0x6c3483, 0xff9f43];
export const EYESHADOWS = [null, 0xa29bfe, 0x74b9ff, 0x55efc4, 0xfd79a8, 0xffeaa7, 0xe17055, 0x2d3436];
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
    { name: 'Bubblegum', a: 0xff9ff3, b: 0x48dbfb }
];
export const TOPS = [
    { id: 'shells', name: 'Seashell Top' },
    { id: 'bandeau', name: 'Bandeau' },
    { id: 'crop', name: 'Crop Top' },
    { id: 'tank', name: 'Tank Top' },
    { id: 'seaweed', name: 'Seaweed Wrap' },
    { id: 'pearls', name: 'Pearl Strands' }
];
export const TOP_COLORS = [0xfd79a8, 0xa29bfe, 0x74b9ff, 0x55efc4, 0xffeaa7, 0xffffff, 0xff7675, 0xe17055, 0x2d3436, 0x00cec9];
export const ACCESSORIES = [
    { id: 'none', name: 'None' },
    { id: 'tiara', name: 'Coral Tiara' },
    { id: 'starfish', name: 'Starfish Clip' },
    { id: 'flower', name: 'Sea Flower' },
    { id: 'necklace', name: 'Pearl Necklace' },
    { id: 'crown', name: 'Shell Crown' }
];

export function defaultLook() {
    return {
        name: 'Marina',
        hairStyle: 'long', hairColor: 0xd94f8a,
        skin: 0xf6d7c3,
        eyeColor: 0x2e86de, eyeShape: 'big',
        lipstick: 0xe84393, eyeshadow: 0xa29bfe, blush: true, lashes: true,
        tailSize: 1.0, tail: 0,
        top: 'shells', topColor: 0xfd79a8,
        accessory: 'starfish'
    };
}

export function randomLook(rand = Math.random) {
    const pick = (a) => a[Math.floor(rand() * a.length)];
    return {
        name: pick(['Coral', 'Pearl', 'Shelly', 'Nerissa', 'Ondine', 'Kai', 'Wave', 'Lagoona', 'Marisol', 'Ariella']),
        hairStyle: pick(HAIR_STYLES).id, hairColor: pick(HAIR_COLORS),
        skin: pick(SKIN_TONES),
        eyeColor: pick(EYE_COLORS), eyeShape: pick(EYE_SHAPES).id,
        lipstick: pick(LIPSTICKS), eyeshadow: pick(EYESHADOWS), blush: rand() < 0.6, lashes: rand() < 0.7,
        tailSize: 0.85 + rand() * 0.35, tail: Math.floor(rand() * TAIL_COLORS.length),
        top: pick(TOPS).id, topColor: pick(TOP_COLORS),
        accessory: pick(ACCESSORIES).id
    };
}

// ---- Task 1: the wedding ----------------------------------------------------------------------
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
            id: 'moments', title: 'Ceremony Moments', hint: 'Pick everything you want to happen', type: 'many',
            options: [
                { id: 'bubbles', name: 'Bubble Arch Release' },
                { id: 'jellies', name: 'Jellyfish Light Show' },
                { id: 'dolphins', name: 'Dolphin Ring Bearers' },
                { id: 'seahorses', name: 'Seahorse Parade' },
                { id: 'turtle', name: 'Turtle Officiant' },
                { id: 'dance', name: 'First Dance' },
                { id: 'cakecut', name: 'Cake Cutting' },
                { id: 'plankton', name: 'Glowing Plankton Fireworks' }
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

// ---- Task 2: the mall -------------------------------------------------------------------------
export const START_MONEY = 150;
export const SHOPS = [
    {
        id: 'shellco', name: 'Shell & Co.', kind: 'clothes', sign: 0xfd79a8,
        greeting: 'Welcome to Shell & Co.! Everything is hand-picked from the finest reefs.',
        items: [
            { id: 'top_crop_lav', name: 'Lavender Crop Top', price: 30, apply: { top: 'crop', topColor: 0xa29bfe } },
            { id: 'top_tank_aqua', name: 'Aqua Tank Top', price: 25, apply: { top: 'tank', topColor: 0x00cec9 } },
            { id: 'top_bandeau_gold', name: 'Gold Bandeau', price: 40, apply: { top: 'bandeau', topColor: 0xffd166 } },
            { id: 'top_shells_pink', name: 'Pink Seashell Top', price: 35, apply: { top: 'shells', topColor: 0xff9ff3 } },
            { id: 'top_seaweed', name: 'Seaweed Wrap', price: 20, apply: { top: 'seaweed', topColor: 0x55efc4 } }
        ]
    },
    {
        id: 'pearl', name: 'Pearl Boutique', kind: 'clothes', sign: 0xdfe6e9,
        greeting: 'Darling! A pearl a day keeps the barnacles away.',
        items: [
            { id: 'acc_tiara', name: 'Coral Tiara', price: 45, apply: { accessory: 'tiara' } },
            { id: 'acc_necklace', name: 'Pearl Necklace', price: 50, apply: { accessory: 'necklace' } },
            { id: 'acc_crown', name: 'Shell Crown', price: 60, apply: { accessory: 'crown' } },
            { id: 'acc_flower', name: 'Sea Flower Clip', price: 15, apply: { accessory: 'flower' } },
            { id: 'top_pearls', name: 'Pearl Strand Top', price: 55, apply: { top: 'pearls', topColor: 0xffffff } }
        ]
    },
    {
        id: 'scales', name: 'Scale Salon', kind: 'clothes', sign: 0x48dbfb,
        greeting: 'New tail, new you! Pick a shimmer.',
        items: [
            { id: 'tail_bubblegum', name: 'Bubblegum Tail Shimmer', price: 40, apply: { tail: 9 } },
            { id: 'tail_gold', name: 'Gold Tail Shimmer', price: 45, apply: { tail: 8 } },
            { id: 'tail_midnight', name: 'Midnight Tail Shimmer', price: 40, apply: { tail: 7 } },
            { id: 'hair_glow', name: 'Glow-in-the-Dark Hair Dye', price: 30, apply: { hairColor: 0x7ed957 } }
        ]
    },
    {
        id: 'cafe', name: 'Kelp Café', kind: 'food', sign: 0x55efc4,
        greeting: 'Grab a seat at the food court, sweetie. What can I get you all?',
        items: [
            { id: 'salad', name: 'Seaweed Salad', price: 12, food: 0x2ecc71 },
            { id: 'smoothie', name: 'Plankton Smoothie', price: 9, food: 0x9b59b6 },
            { id: 'tacos', name: 'Krill Tacos', price: 15, food: 0xe67e22 },
            { id: 'latte', name: 'Sea-Foam Latte', price: 8, food: 0xf5e6ca },
            { id: 'cupcake', name: 'Coral Cupcakes', price: 10, food: 0xff7675 }
        ]
    }
];

// ---- Task 3: the talking fish and the landmarks -----------------------------------------------
export const TALKING_FISH = [
    {
        id: 'bubbles', name: 'Bubbles the Clownfish', color: 0xff7f27, stripe: 0xffffff, size: 0.9, at: [-30, 6, 22],
        lines: ['Oh hi! You\'re new! I can tell, your fins are still all sparkly.',
            'Fun fact: I\'ve never seen the surface. My mom says it\'s just a big ceiling.',
            'If you see a crab named Gerald, tell him he owes me three pebbles.']
    },
    {
        id: 'sage', name: 'Old Sage the Grouper', color: 0x6d6a4f, stripe: 0x8a865f, size: 2.0, at: [48, 9, -44],
        lines: ['Hmmmm. Another dreamer drifts down from the bright world.',
            'Everything here is real as long as you believe it, child. And you DO believe it.',
            'When your three tasks are done, the current will carry you home.']
    },
    {
        id: 'zip', name: 'Zip the Angelfish', color: 0xf9e79f, stripe: 0x2e86c1, size: 0.9, at: [18, 14, 60],
        lines: ['Race you to the sunken ship! ...Kidding, I\'m too fast. ZOOM.',
            'Have you been to the mall yet? Kelp Café does a krill taco that will change your LIFE.']
    },
    {
        id: 'dory', name: 'Glenda the Blue Tang', color: 0x2874f0, stripe: 0xf4d03f, size: 1.0, at: [-62, 8, -18],
        lines: ['Hi! Hi! Have we met? I feel like we\'ve met.',
            'I was going somewhere. Was it the Giant Clam? It was probably the Giant Clam.',
            'Hi! Have we met?']
    },
    {
        id: 'puff', name: 'Puffington III', color: 0xe9d8a6, stripe: 0x94795d, size: 1.1, at: [70, 6, 40],
        lines: ['I am NOT puffed up. This is just my resting shape.',
            '...Okay you startled me a little. Give me a moment. *deflates slowly*']
    },
    {
        id: 'luna', name: 'Luna the Lanternfish', color: 0x34495e, stripe: 0x48dbfb, size: 0.8, at: [-100, 20, 70], glow: true,
        lines: ['Down in the deep, I\'m the only light for miles. Up here I\'m just... a fish with a lamp.',
            'They say the whale skeleton sings on quiet nights. I\'ve heard it. It\'s mostly humming.']
    }
];

export const LANDMARKS = [
    { id: 'ship', name: 'The Sunken Ship', at: [-95, 0, 45], radius: 22 },
    { id: 'clam', name: 'The Giant Clam', at: [-45, 0, -95], radius: 18 },
    { id: 'kelp', name: 'The Kelp Forest', at: [95, 0, -85], radius: 26 },
    { id: 'whale', name: 'The Whale Skeleton', at: [-120, 0, -55], radius: 24 }
];

export const FRIEND_LINES = {
    invite: ['OMG yes, mall day!!', 'Finally! I need a new tail shimmer.', 'Only if we get krill tacos after.'],
    shop: ['That is SO you.', 'Stunning. Iconic. Buy it.', 'Ooh, the pearl one!', 'You look like a sea queen.'],
    eat: ['Mmm, this smoothie is so good.', 'Best. Tacos. Ever.', 'Wanna split a cupcake?'],
    idle: ['Wait for meee!', 'Where are we going next?', 'This is the best day ever.']
};
