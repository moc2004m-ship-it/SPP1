'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { levelForXp, xpRequiredForLevel, XP_PER_LEVEL_FACTOR } = require('../src/domain/level-curve');

test('0 xp is level 0', () => {
  assert.equal(levelForXp(0), 0);
});

test('xp just below the level-1 threshold is still level 0', () => {
  assert.equal(levelForXp(XP_PER_LEVEL_FACTOR - 1), 0);
});

test('xp exactly at the level-1 threshold is level 1', () => {
  assert.equal(levelForXp(XP_PER_LEVEL_FACTOR), 1);
});

test('xp exactly at the level-5 threshold is level 5, one below is level 4', () => {
  const level5Xp = xpRequiredForLevel(5);
  assert.equal(levelForXp(level5Xp), 5);
  assert.equal(levelForXp(level5Xp - 1), 4);
});

test('xpRequiredForLevel is monotonically increasing', () => {
  for (let lvl = 0; lvl < 50; lvl++) {
    assert.ok(xpRequiredForLevel(lvl + 1) > xpRequiredForLevel(lvl));
  }
});

test('levelForXp matches xpRequiredForLevel across a wide range (no rounding drift)', () => {
  for (let lvl = 0; lvl <= 200; lvl++) {
    const xp = xpRequiredForLevel(lvl);
    assert.equal(levelForXp(xp), lvl, `xp=${xp} should resolve to level ${lvl}`);
  }
});

test('rejects negative xp', () => {
  assert.throws(() => levelForXp(-1), (e) => e.status === 400);
});

test('rejects non-integer xp', () => {
  assert.throws(() => levelForXp(1.5), (e) => e.status === 400);
});

test('rejects a negative level in xpRequiredForLevel', () => {
  assert.throws(() => xpRequiredForLevel(-1), (e) => e.status === 400);
});
