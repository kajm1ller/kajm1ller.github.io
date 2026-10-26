import test from 'node:test';
import assert from 'node:assert/strict';
import { BAR_LINES, BAR_LINE_GROUPS, barLine } from '../../js/game/barTalk.js';

test('Bar talk: 300 different lines across every topic', () => {
    assert.equal(BAR_LINES.length, 300);
    assert.equal(new Set(BAR_LINES).size, 300, 'no line twice');
    for (const [name, lines] of Object.entries(BAR_LINE_GROUPS)) assert.ok(lines.length >= 10, `${name} has lines`);
    for (const l of BAR_LINES) assert.ok(typeof l === 'string' && l.length > 5 && l.length < 140, l);
});

test('Bar talk: each person goes through every line before repeating one', () => {
    for (const seed of [0, 1, 77, 12345, 999999]) {
        const seen = new Set();
        for (let i = 0; i < 300; i++) seen.add(barLine(seed, i));
        assert.equal(seen.size, 300, `seed ${seed}`);
    }
    assert.notEqual(barLine(3, 0), barLine(4, 0), 'two people open with different lines');
});

import { reactionLine, REACT_LINES } from '../../js/game/barTalk.js';

test('Bar talk: people ask if you are okay when you are wasted or high', () => {
    assert.equal(reactionLine({ drunk: 0, high: 0, od: 0 }, 1, 0, 0), null, 'sober: they talk about themselves');
    assert.ok(REACT_LINES.WASTED_REACT.includes(reactionLine({ drunk: 1, high: 0, od: 0 }, 1, 0)));
    assert.ok(REACT_LINES.HIGH_REACT.includes(reactionLine({ drunk: 0.2, high: 0.9, od: 0 }, 1, 0)));
    assert.ok(REACT_LINES.OD_REACT.includes(reactionLine({ drunk: 0, high: 1, od: 0.5 }, 1, 0)));
    assert.ok(REACT_LINES.TIPSY_REACT.includes(reactionLine({ drunk: 0.6, high: 0, od: 0 }, 1, 0, 0.1)));
    assert.equal(reactionLine({ drunk: 0.6, high: 0, od: 0 }, 1, 0, 0.9), null, 'merry: sometimes they just chat');
    const worried = REACT_LINES.WASTED_REACT.concat(REACT_LINES.HIGH_REACT);
    assert.ok(worried.filter((l) => /okay|water/i.test(l)).length >= worried.length / 2, 'mostly asking if you are okay / need water');
});
