/**
 * arcade/cards.js
 *
 * Playing cards for the table games: the random source, a shuffled shoe, card values for
 * blackjack and baccarat, and a poker hand evaluator (best five of five to seven cards). No DOM.
 *
 * A card is { r, s }: rank 2..14 (11 J, 12 Q, 13 K, 14 A) and suit 0..3 (♠ ♥ ♦ ♣).
 */

/** Uniform [0, 1) from the browser's crypto generator (Math.random where that isn't there). */
export function rand() {
    const c = typeof globalThis !== 'undefined' && globalThis.crypto;
    if (c && c.getRandomValues) {
        const a = new Uint32Array(1);
        c.getRandomValues(a);
        return a[0] / 4294967296;
    }
    return Math.random();
}

export const randInt = (n, r = rand) => Math.floor(r() * n);

export function shuffle(arr, r = rand) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
}

export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANK_NAMES = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
export const rankName = (r) => RANK_NAMES[r] || String(r);
export const isRed = (c) => c.s === 1 || c.s === 2;
export const cardText = (c) => rankName(c.r) + SUITS[c.s];

export function newDeck() {
    const d = [];
    for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) d.push({ r, s });
    return d;
}

/** Several decks shuffled together; reshuffled once `penetration` of it has been dealt. */
export class Shoe {
    constructor(decks = 6, r = rand, penetration = 0.75) {
        this.decks = decks;
        this.rand = r;
        this.penetration = penetration;
        this.shuffle();
    }

    shuffle() {
        this.cards = [];
        for (let i = 0; i < this.decks; i++) this.cards.push(...newDeck());
        shuffle(this.cards, this.rand);
        this.dealt = 0;
        this.shuffled = true;
    }

    get needsShuffle() {
        return this.dealt >= this.cards.length * this.penetration;
    }

    draw() {
        if (this.dealt >= this.cards.length) this.shuffle();
        return this.cards[this.dealt++];
    }
}

// ---- Blackjack ------------------------------------------------------------------------------------
export function bjCardValue(c) {
    if (c.r === 14) return 11;
    return Math.min(10, c.r);
}

/** { total, soft } with aces counted as 11 while that doesn't bust. */
export function bjTotal(cards) {
    let total = 0, aces = 0;
    for (const c of cards) {
        total += bjCardValue(c);
        if (c.r === 14) aces++;
    }
    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }
    return { total, soft: aces > 0 };
}

export const isBlackjack = (cards) => cards.length === 2 && bjTotal(cards).total === 21;

// ---- Baccarat ---------------------------------------------------------------------------------------
export const bacValue = (c) => (c.r === 14 ? 1 : c.r >= 10 ? 0 : c.r);
export const bacTotal = (cards) => cards.reduce((t, c) => t + bacValue(c), 0) % 10;

/**
 * Plays out a baccarat coup by the tableau. `draw()` gives the next card.
 * @returns {{ player: Array, banker: Array, pt: number, bt: number, winner: 'player'|'banker'|'tie', natural: boolean }}
 */
export function playBaccarat(draw) {
    const player = [draw(), draw()];
    const banker = [draw(), draw()];
    let pt = bacTotal(player), bt = bacTotal(banker);
    const natural = pt >= 8 || bt >= 8;
    if (!natural) {
        let p3 = null;
        if (pt <= 5) {
            p3 = draw();
            player.push(p3);
            pt = bacTotal(player);
        }
        let bankerDraws;
        if (!p3) bankerDraws = bt <= 5;
        else {
            const v = bacValue(p3);
            if (bt <= 2) bankerDraws = true;
            else if (bt === 3) bankerDraws = v !== 8;
            else if (bt === 4) bankerDraws = v >= 2 && v <= 7;
            else if (bt === 5) bankerDraws = v >= 4 && v <= 7;
            else if (bt === 6) bankerDraws = v === 6 || v === 7;
            else bankerDraws = false;
        }
        if (bankerDraws) {
            banker.push(draw());
            bt = bacTotal(banker);
        }
    }
    return { player, banker, pt, bt, natural, winner: pt > bt ? 'player' : bt > pt ? 'banker' : 'tie' };
}

// ---- Poker --------------------------------------------------------------------------------------------
export const HAND_NAMES = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush',
    'Full House', 'Four of a Kind', 'Straight Flush', 'Royal Flush'];

/** Highest straight in a 15-slot rank presence array (ace also plays low); 0 if none. */
function straightHigh(has) {
    let run = 0;
    for (let r = 14; r >= 1; r--) {
        const present = r === 1 ? has[14] : has[r];
        if (present) {
            run++;
            if (run >= 5) return r + 4;
        } else run = 0;
    }
    return 0;
}

function score(cat, kickers) {
    let s = cat;
    for (let i = 0; i < 5; i++) s = s * 15 + (kickers[i] || 0);
    return s;
}

/**
 * Best five-card poker hand from 5..7 cards.
 * @returns {{ score: number, cat: number, name: string }} higher score wins; equal scores split
 */
export function evaluatePoker(cards) {
    const count = new Array(15).fill(0);
    const suitCount = [0, 0, 0, 0];
    for (const c of cards) {
        count[c.r]++;
        suitCount[c.s]++;
    }
    // Straight flush / flush
    let flush = null;
    const fs = suitCount.findIndex((n) => n >= 5);
    if (fs >= 0) {
        const has = new Array(15).fill(0);
        const fr = [];
        for (const c of cards) if (c.s === fs) { has[c.r] = 1; fr.push(c.r); }
        const sh = straightHigh(has);
        if (sh) return { score: score(sh === 14 ? 9 : 8, [sh]), cat: sh === 14 ? 9 : 8, name: HAND_NAMES[sh === 14 ? 9 : 8] };
        fr.sort((a, b) => b - a);
        flush = { score: score(5, fr.slice(0, 5)), cat: 5, name: HAND_NAMES[5] };
    }
    const quads = [], trips = [], pairs = [], singles = [];
    for (let r = 14; r >= 2; r--) {
        if (count[r] === 4) quads.push(r);
        else if (count[r] === 3) trips.push(r);
        else if (count[r] === 2) pairs.push(r);
        else if (count[r] === 1) singles.push(r);
    }
    const kick = (exclude, n) => {
        const out = [];
        for (let r = 14; r >= 2 && out.length < n; r--) if (count[r] && !exclude.includes(r)) out.push(r);
        return out;
    };
    if (quads.length) return { score: score(7, [quads[0], ...kick([quads[0]], 1)]), cat: 7, name: HAND_NAMES[7] };
    if (trips.length && (trips.length > 1 || pairs.length)) {
        const t = trips[0];
        const p = Math.max(trips[1] || 0, pairs[0] || 0);
        return { score: score(6, [t, p]), cat: 6, name: HAND_NAMES[6] };
    }
    if (flush) return flush;
    const has = count.map((n) => (n ? 1 : 0));
    const sh = straightHigh(has);
    if (sh) return { score: score(4, [sh]), cat: 4, name: HAND_NAMES[4] };
    if (trips.length) return { score: score(3, [trips[0], ...kick([trips[0]], 2)]), cat: 3, name: HAND_NAMES[3] };
    if (pairs.length >= 2) {
        return { score: score(2, [pairs[0], pairs[1], ...kick([pairs[0], pairs[1]], 1)]), cat: 2, name: HAND_NAMES[2] };
    }
    if (pairs.length) return { score: score(1, [pairs[0], ...kick([pairs[0]], 3)]), cat: 1, name: HAND_NAMES[1] };
    return { score: score(0, kick([], 5)), cat: 0, name: HAND_NAMES[0] };
}

/** "Pair of Kings", "Flush, Ace high"... for the result line. */
export function describePoker(cards) {
    const e = evaluatePoker(cards);
    const plural = { 2: 'Twos', 3: 'Threes', 4: 'Fours', 5: 'Fives', 6: 'Sixes', 7: 'Sevens', 8: 'Eights', 9: 'Nines', 10: 'Tens', 11: 'Jacks', 12: 'Queens', 13: 'Kings', 14: 'Aces' };
    const top = Math.floor(e.score / 15 ** 4) % 15;
    if (e.cat === 1) return `Pair of ${plural[top]}`;
    if (e.cat === 3) return `Three ${plural[top]}`;
    if (e.cat === 7) return `Four ${plural[top]}`;
    if (e.cat === 6) return `Full House, ${plural[top]} full`;
    if (e.cat === 2) return `Two Pair, ${plural[top]} up`;
    return e.name;
}

/**
 * Chance (0..1) `hole` wins at showdown against `opponents` random hands with the board so far,
 * by Monte Carlo (ties count as a share).
 */
export function pokerEquity(hole, board, opponents, iterations = 300, r = rand) {
    const used = new Set([...hole, ...board].map((c) => c.r * 4 + c.s));
    const rest = newDeck().filter((c) => !used.has(c.r * 4 + c.s));
    let won = 0;
    const need = 5 - board.length;
    for (let it = 0; it < iterations; it++) {
        // Partial shuffle: just the cards we'll use
        const take = need + opponents * 2;
        for (let i = 0; i < take; i++) {
            const j = i + Math.floor(r() * (rest.length - i));
            const t = rest[i]; rest[i] = rest[j]; rest[j] = t;
        }
        const full = board.concat(rest.slice(0, need));
        const mine = evaluatePoker(hole.concat(full)).score;
        let best = 0, ties = 1, beaten = false;
        for (let o = 0; o < opponents; o++) {
            const s = evaluatePoker([rest[need + o * 2], rest[need + o * 2 + 1], ...full]).score;
            if (s > mine) { beaten = true; break; }
            if (s === mine) ties++;
            best = Math.max(best, s);
        }
        if (!beaten) won += 1 / ties;
    }
    return won / iterations;
}

/** Rough preflop strength 0..1 (Chen-style) for the bots' first decision. */
export function preflopStrength(a, b) {
    const hi = Math.max(a.r, b.r), lo = Math.min(a.r, b.r);
    const base = { 14: 10, 13: 8, 12: 7, 11: 6 };
    let pts = base[hi] || hi / 2;
    if (a.r === b.r) pts = Math.max(5, pts * 2);
    if (a.s === b.s) pts += 2;
    const gap = hi - lo - 1;
    if (a.r !== b.r) pts -= gap <= 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
    if (a.r !== b.r && gap <= 1 && hi < 12) pts += 1;
    return Math.max(0, Math.min(1, (pts + 1) / 21));
}
