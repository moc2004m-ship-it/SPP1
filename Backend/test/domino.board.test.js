'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createFullSet,
  pipSum,
  handPipTotal,
  isDouble,
  legalEnds,
  hasAnyLegalMove,
  attach,
  blockedGameWinner,
} = require('../src/domain/domino.board');

test('createFullSet returns the standard 28-tile double-six set with no duplicates', () => {
  const tiles = createFullSet();
  assert.equal(tiles.length, 28);
  const keys = new Set(tiles.map((t) => `${t[0]}-${t[1]}`));
  assert.equal(keys.size, 28);
  for (const [a, b] of tiles) {
    assert.ok(a >= 0 && a <= 6 && b >= 0 && b <= 6 && a <= b, `[${a},${b}] out of range/order`);
  }
  // every a<=b combo from 0..6 exists exactly once
  for (let a = 0; a <= 6; a++) {
    for (let b = a; b <= 6; b++) {
      assert.ok(keys.has(`${a}-${b}`), `missing [${a},${b}]`);
    }
  }
});

test('pipSum / handPipTotal add pips correctly', () => {
  assert.equal(pipSum([3, 4]), 7);
  assert.equal(pipSum([0, 0]), 0);
  assert.equal(pipSum([6, 6]), 12);
  assert.equal(handPipTotal([[3, 4], [0, 0], [6, 6]]), 19);
  assert.equal(handPipTotal([]), 0);
});

test('isDouble', () => {
  assert.equal(isDouble([4, 4]), true);
  assert.equal(isDouble([4, 5]), false);
  assert.equal(isDouble([0, 0]), true);
});

test('legalEnds: an empty chain (both ends null) accepts any tile at both ends', () => {
  const ends = legalEnds([3, 5], { left: null, right: null });
  assert.deepEqual(ends, { left: true, right: true });
});

test('legalEnds: a non-double tile matches only the end(s) whose value it contains', () => {
  const chain = { left: 2, right: 6 };
  assert.deepEqual(legalEnds([2, 4], chain), { left: true, right: false });
  assert.deepEqual(legalEnds([6, 1], chain), { left: false, right: true });
  assert.deepEqual(legalEnds([5, 5], chain), { left: false, right: false });
});

test('legalEnds: a tile matching both ends of the chain (e.g. a double, or both ends share a value) reports both true', () => {
  const chain = { left: 4, right: 4 };
  assert.deepEqual(legalEnds([4, 4], chain), { left: true, right: true });
  assert.deepEqual(legalEnds([4, 2], chain), { left: true, right: true });
});

test('hasAnyLegalMove is true iff at least one tile in hand matches an open end', () => {
  const chain = { left: 3, right: 6 };
  assert.equal(hasAnyLegalMove([[0, 1], [2, 2], [6, 6]], chain), true); // 6-6 matches right
  assert.equal(hasAnyLegalMove([[0, 1], [2, 2], [4, 5]], chain), false);
  assert.equal(hasAnyLegalMove([], chain), false);
});

test('attach: opening move (chain has null ends) sets both ends from the tile, ignoring the requested end', () => {
  const opened = attach([2, 5], 'left', { left: null, right: null });
  assert.deepEqual(opened, { left: 2, right: 5 });
  const openedOtherEnd = attach([2, 5], 'right', { left: null, right: null });
  assert.deepEqual(openedOtherEnd, { left: 2, right: 5 }, 'opening ignores which end was requested');
});

test('attach: extends the left end, flipping the tile so the non-matching pip becomes the new left end (works whichever pip position matches)', () => {
  const chain = { left: 4, right: 6 };
  assert.deepEqual(attach([4, 2], 'left', chain), { left: 2, right: 6 }, 'tile[0] matches the end');
  assert.deepEqual(attach([2, 4], 'left', chain), { left: 2, right: 6 }, 'tile[1] matches the end');
});

test('attach: extends the right end symmetrically', () => {
  const chain = { left: 4, right: 6 };
  assert.deepEqual(attach([6, 3], 'right', chain), { left: 4, right: 3 });
  assert.deepEqual(attach([1, 6], 'right', chain), { left: 4, right: 1 });
});

test('attach: throws (status 400) when the tile does not actually match the requested end', () => {
  const chain = { left: 4, right: 6 };
  assert.throws(() => attach([1, 2], 'left', chain), (e) => e.status === 400 && /left end/.test(e.message));
  assert.throws(() => attach([1, 2], 'right', chain), (e) => e.status === 400 && /right end/.test(e.message));
});

test('attach: throws (status 400) for an invalid end value', () => {
  const chain = { left: 4, right: 6 };
  assert.throws(() => attach([4, 4], 'up', chain), (e) => e.status === 400 && /"left" or "right"/.test(e.message));
});

test('blockedGameWinner: a single lowest pip total wins outright', () => {
  const { winnerId, totals } = blockedGameWinner({
    usr_1: [[6, 6], [5, 5]], // 22
    usr_2: [[1, 0], [0, 0]], // 1
  });
  assert.equal(winnerId, 'usr_2');
  assert.deepEqual(totals, { usr_1: 22, usr_2: 1 });
});

test('blockedGameWinner: an equal lowest total across 2+ players is a real draw (winnerId null)', () => {
  const { winnerId, totals } = blockedGameWinner({
    usr_1: [[3, 3]], // 6
    usr_2: [[2, 4]], // 6
    usr_3: [[6, 6]], // 12
  });
  assert.equal(winnerId, null, 'tied lowest total must never invent a winner');
  assert.deepEqual(totals, { usr_1: 6, usr_2: 6, usr_3: 12 });
});

test('blockedGameWinner: an empty hand (0 pips) always wins outright over any non-empty hand', () => {
  const { winnerId } = blockedGameWinner({ usr_1: [], usr_2: [[6, 6]] });
  assert.equal(winnerId, 'usr_1');
});
