import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, formatMoney } from '../../arcade/wallet.js';
import { evaluatePoker, bjTotal, playBaccarat, Shoe, pokerEquity } from '../../arcade/cards.js';
import { spinSlots, slotPayout } from '../../arcade/games/slots.js';
import { settleHand } from '../../arcade/games/blackjack.js';
import { buildPots } from '../../arcade/games/poker.js';
import { videoPokerResult } from '../../arcade/games/videoPoker.js';
import { settleBaccarat } from '../../arcade/games/baccarat.js';
import { rouletteReturn, WHEEL } from '../../arcade/games/roulette.js';
import { hiloOdds, hiloRight, HOUSE } from '../../arcade/games/hilo.js';
import { penguinMult, DIFFICULTY } from '../../arcade/games/penguin.js';
import { crashPoint } from '../../arcade/games/crash.js';
import { PLINKO } from '../../arcade/games/plinko.js';
import { minesMult } from '../../arcade/games/mines.js';
import { towerMult, TOWER_MODES } from '../../arcade/games/towers.js';
import { diceMult } from '../../arcade/games/dice.js';
import { KENO_PAYS, kenoChance } from '../../arcade/games/keno.js';
import { WHEELS } from '../../arcade/games/wheel.js';

const C = (cards) => cards.split(' ').map((t) => {
    const r = { A: 14, K: 13, Q: 12, J: 11, T: 10 }[t[0]] || Number(t[0]);
    return { r, s: 'shdc'.indexOf(t[1]) };
});

// Seeded generator for repeatable Monte Carlo checks
function mulberry(seed) {
    return () => {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function memStorage() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('Wallet: spends only what you have, keeps cents, saves and reloads', () => {
    const storage = memStorage();
    const w = new Wallet({ storage, start: 100 });
    const seen = [];
    w.onChange((bal, delta) => seen.push([bal, delta]));
    assert.equal(w.spend(150), false);
    assert.equal(w.balance, 100);
    assert.equal(w.spend(30.255), true);
    assert.equal(w.balance, 69.74);
    w.add(0.26);
    assert.equal(w.balance, 70);
    assert.equal(w.charge(500), 70, 'fines take what there is');
    assert.equal(w.balance, 0);
    assert.deepEqual(seen.map((s) => s[1]), [-30.26, 0.26, -70]);
    w.add(1234.5);
    const again = new Wallet({ storage, start: 100 });
    assert.equal(again.balance, 1234.5);
    assert.equal(formatMoney(1234.5), '$1,234.50');
    assert.equal(formatMoney(1000), '$1,000');
    assert.equal(formatMoney(-25, { sign: true }), '-$25');
    assert.equal(formatMoney(25, { sign: true }), '+$25');
});

test('Cards: poker hands rank correctly', () => {
    const rank = (s) => evaluatePoker(C(s));
    assert.equal(rank('As Ks Qs Js Ts 2d 3c').name, 'Royal Flush');
    assert.equal(rank('9h 8h 7h 6h 5h Ad Ac').name, 'Straight Flush');
    assert.equal(rank('5d 4c 3h 2s Ad Kc Qc').name, 'Straight', 'wheel');
    assert.equal(rank('Kd Kc Kh 2s 2d 9c 8c').name, 'Full House');
    assert.equal(rank('Kd Kc Kh Qs Qd Qc 8c').name, 'Full House', 'two trips make a full house');
    assert.equal(rank('2h 7h 9h Jh Kh Ac Ad').name, 'Flush');
    assert.equal(rank('Ah Ad 7c 7s 3d 3c 2h').name, 'Two Pair');
    assert.ok(rank('Ah Ad 7c 7s Kd').score > rank('Ah Ad 7c 7s Qd').score, 'kicker decides');
    assert.ok(rank('2h 3h 4h 5h 6h').score > rank('Ah Ad Ac As Kd').score, 'straight flush beats quads');
    assert.equal(rank('Kh Kd 7c 7s Kc').score, rank('Ks Kc 7d 7h Kh').score, 'same full house splits');
    assert.equal(bjTotal(C('Ah 6d')).total, 17);
    assert.equal(bjTotal(C('Ah 6d')).soft, true);
    assert.equal(bjTotal(C('Ah 6d Tc')).total, 17);
    assert.equal(bjTotal(C('Ah Ad 9c')).total, 21);
    // Aces against a random hand win about 85% heads-up
    const eq = pokerEquity(C('Ah Ad'), [], 1, 3000, mulberry(7));
    assert.ok(eq > 0.8 && eq < 0.89, `AA equity ${eq}`);
});

test('Blackjack and baccarat settle by the rules', () => {
    assert.equal(settleHand({ cards: C('Ah Kd'), bet: 10 }, C('Tc 9d')).ret, 25, 'blackjack 3:2');
    assert.equal(settleHand({ cards: C('Ah Kd'), bet: 10, split: true }, C('Tc 9d')).ret, 20, 'split 21 is not blackjack');
    assert.equal(settleHand({ cards: C('Tc 9d'), bet: 10 }, C('Ah Kd')).ret, 0);
    assert.equal(settleHand({ cards: C('Tc 7d'), bet: 10 }, C('9h 8d')).ret, 10, 'push');
    assert.equal(settleHand({ cards: C('Tc 6d 9s'), bet: 10 }, C('9h 8d 5c')).ret, 0, 'player busts first');
    assert.equal(settleHand({ cards: C('Tc 6d'), bet: 10 }, C('9h 7d 8c')).ret, 20, 'dealer bust');
    // Baccarat: house edge on Banker about 1.06%, Player 1.24%
    const shoe = new Shoe(8, mulberry(3));
    let banker = 0, player = 0;
    const n = 200000;
    for (let i = 0; i < n; i++) {
        if (shoe.needsShuffle) shoe.shuffle();
        const coup = playBaccarat(() => shoe.draw());
        banker += settleBaccarat({ banker: 1 }, coup);
        player += settleBaccarat({ player: 1 }, coup);
    }
    assert.ok(Math.abs(banker / n - 0.9894) < 0.006, `banker ${banker / n}`);
    assert.ok(Math.abs(player / n - 0.9876) < 0.006, `player ${player / n}`);
});

test('Poker: side pots split by what each player put in', () => {
    const pots = buildPots([
        { total: 50, folded: false },   // all in short
        { total: 200, folded: false },
        { total: 200, folded: false },
        { total: 30, folded: true }
    ]);
    assert.deepEqual(pots, [{ amount: 180, eligible: [0, 1, 2] }, { amount: 300, eligible: [1, 2] }]);
    assert.equal(pots.reduce((t, p) => t + p.amount, 0), 480);
    assert.equal(videoPokerResult(C('Jh Jd 4c 7s 9d'))[1], 1);
    assert.equal(videoPokerResult(C('Th Td 4c 7s 9d')), null);
    assert.equal(videoPokerResult(C('Ah Kh Qh Jh Th'))[1], 800);
});

test('Casino games pay back what they advertise', () => {
    // Slots, by simulation (free spins included)
    const r = mulberry(11);
    let ret = 0;
    const n = 400000;
    for (let i = 0; i < n; i++) {
        const res = spinSlots(r);
        ret += slotPayout(res, 1);
        let free = res.freeSpins;
        while (free-- > 0) {
            const f = spinSlots(r);
            free += f.freeSpins;
            ret += slotPayout(f, 1, true);
        }
    }
    assert.ok(ret / n > 0.9 && ret / n < 1.02, `slots RTP ${ret / n}`);
    // Roulette: every bet returns 36/37
    for (const key of ['n17', 'red', 'odd', 'low', 'd2', 'c3']) {
        const e = WHEEL.reduce((t, num) => t + rouletteReturn(key, num), 0) / 37;
        assert.ok(Math.abs(e - 36 / 37) < 1e-9, key);
    }
    // Higher or lower: 99% on every call
    for (let rank = 1; rank <= 13; rank++) {
        const o = hiloOdds(rank);
        let wins = 0;
        for (let next = 1; next <= 13; next++) if (hiloRight(rank, next, 'hi')) wins++;
        assert.ok(Math.abs(wins / 13 - o.hi) < 1e-9, `odds for ${rank}`);
        assert.ok(Math.abs(o.hi * (HOUSE / o.hi) - 0.99) < 1e-9);
    }
    // Penguin Cross: 97% at every lane, multipliers rise
    for (const d of Object.keys(DIFFICULTY)) {
        const s = DIFFICULTY[d].survive;
        for (let k = 1; k <= 20; k++) {
            const e = s ** k * penguinMult(d, k);
            assert.ok(e <= 0.97 + 1e-9 && e > 0.95, `${d} lane ${k}: ${e}`);
            if (k > 1) assert.ok(penguinMult(d, k) > penguinMult(d, k - 1));
        }
    }
    // Crash: P(crash >= x) * x stays at 99%
    const cr = mulberry(5);
    let hit2 = 0, hit10 = 0;
    for (let i = 0; i < 200000; i++) { const c = crashPoint(cr()); if (c >= 2) hit2++; if (c >= 10) hit10++; }
    assert.ok(Math.abs((hit2 / 200000) * 2 - 0.99) < 0.01);
    assert.ok(Math.abs((hit10 / 200000) * 10 - 0.99) < 0.05);
    // Plinko tables
    const Cn = (n, k) => { let v = 1; for (let i = 1; i <= k; i++) v = (v * (n - k + i)) / i; return v; };
    for (const rows of [8, 12, 16]) {
        for (const risk of ['low', 'medium', 'high']) {
            const t = PLINKO[rows][risk];
            assert.equal(t.length, rows + 1);
            const e = t.reduce((s, m, k) => s + (Cn(rows, k) / 2 ** rows) * m, 0);
            assert.ok(e > 0.98 && e < 1.0, `plinko ${rows} ${risk}: ${e}`);
        }
    }
    // Mines: first pick on 3 mines is 25/22 less 1%
    assert.equal(minesMult(3, 1), Math.floor((25 / 22) * 0.99 * 100) / 100);
    assert.ok(minesMult(24, 1) >= 24);
    for (const mode of Object.keys(TOWER_MODES)) assert.ok(towerMult(mode, 9) > towerMult(mode, 8));
    assert.equal(diceMult(50), 1.98);
    // Keno and the wheel
    for (let p = 1; p <= 10; p++) {
        const e = KENO_PAYS[p].reduce((s, m, h) => s + m * kenoChance(p, h), 0);
        assert.ok(e > 0.95 && e < 1.0, `keno ${p} picks: ${e}`);
    }
    for (const [risk, segs] of Object.entries(WHEELS)) {
        assert.equal(segs.length, 30);
        const e = segs.reduce((a, b) => a + b, 0) / 30;
        assert.ok(Math.abs(e - 0.99) < 1e-9, `wheel ${risk}: ${e}`);
    }
});
