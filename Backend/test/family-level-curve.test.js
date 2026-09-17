'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FAMILY_XP_PER_LEVEL_FACTOR,
  xpRequiredForFamilyLevel,
  levelForFamilyXp,
  assertValidFamilyXp,
} = require('../src/domain/family-level-curve');

test('0 xp is level 0', () => {
  assert.equal(levelForFamilyXp(0), 0);
});

test('xpRequiredForFamilyLevel(0) is 0', () => {
  assert.equal(xpRequiredForFamilyLevel(0), 0);
});

test('cumulative requirement matches the documented formula (1000 * n^2)', () => {
  for (let n = 0; n <= 10; n++) {
    assert.equal(xpRequiredForFamilyLevel(n), FAMILY_XP_PER_LEVEL_FACTOR * n * n);
  }
});

test('exact threshold xp reaches that level, not one below', () => {
  for (let n = 1; n <= 10; n++) {
    assert.equal(levelForFamilyXp(xpRequiredForFamilyLevel(n)), n);
  }
});

test('one xp below a threshold stays at the previous level', () => {
  for (let n = 1; n <= 10; n++) {
    assert.equal(levelForFamilyXp(xpRequiredForFamilyLevel(n) - 1), n - 1);
  }
});

test('level is monotonically non-decreasing as xp grows', () => {
  let lastLevel = 0;
  for (let xp = 0; xp <= 50000; xp += 137) {
    const level = levelForFamilyXp(xp);
    assert.ok(level >= lastLevel, `level dropped at xp=${xp}`);
    lastLevel = level;
  }
});

test('large xp values (family-scale, far above personal xp) resolve without float drift', () => {
  // A real family could plausibly accumulate hundreds of thousands of xp
  // from many members donating over time -- this is exactly why
  // FAMILY_XP_PER_LEVEL_FACTOR is much larger than the personal curve.
  const xp = 985_000;
  const level = levelForFamilyXp(xp);
  assert.ok(xpRequiredForFamilyLevel(level) <= xp);
  assert.ok(xpRequiredForFamilyLevel(level + 1) > xp);
});

test('assertValidFamilyXp rejects negative and non-integer values', () => {
  assert.throws(() => assertValidFamilyXp(-1), (e) => e.status === 400);
  assert.throws(() => assertValidFamilyXp(1.5), (e) => e.status === 400);
  assert.throws(() => assertValidFamilyXp('100'), (e) => e.status === 400);
});

test('xpRequiredForFamilyLevel rejects a negative level', () => {
  assert.throws(() => xpRequiredForFamilyLevel(-1), (e) => e.status === 400);
});
