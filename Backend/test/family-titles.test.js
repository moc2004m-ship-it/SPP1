'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TITLE_THRESHOLDS,
  BADGE_THRESHOLDS,
  titleForContribution,
  badgesForContribution,
  assertValidContribution,
} = require('../src/domain/family-titles');

test('0 contribution is newcomer with no badges', () => {
  assert.equal(titleForContribution(0), 'newcomer');
  assert.deepEqual(badgesForContribution(0), []);
});

test('title increases at each exact threshold', () => {
  for (const entry of TITLE_THRESHOLDS) {
    assert.equal(titleForContribution(entry.min), entry.title);
  }
});

test('one unit below a title threshold stays at the previous title', () => {
  for (let i = 1; i < TITLE_THRESHOLDS.length; i++) {
    assert.equal(titleForContribution(TITLE_THRESHOLDS[i].min - 1), TITLE_THRESHOLDS[i - 1].title);
  }
});

test('legend title holds for very large contributions', () => {
  assert.equal(titleForContribution(1_000_000), 'legend');
});

test('badges accumulate -- every threshold crossed stays earned, not just the current tier', () => {
  const badges = badgesForContribution(20000);
  assert.deepEqual(badges, ['first_500', 'first_1000', 'first_5000', 'first_20000']);
});

test('badges below the first threshold are empty', () => {
  assert.deepEqual(badgesForContribution(499), []);
});

test('badges at an exact threshold include that badge', () => {
  for (const entry of BADGE_THRESHOLDS) {
    const badges = badgesForContribution(entry.min);
    assert.ok(badges.includes(entry.badge), `expected ${entry.badge} at contribution=${entry.min}`);
  }
});

test('a demoted-in-rank scenario is impossible: badges never shrink for a higher contribution', () => {
  const lower = badgesForContribution(1000);
  const higher = badgesForContribution(5000);
  for (const badge of lower) {
    assert.ok(higher.includes(badge), `badge ${badge} was lost at a higher contribution`);
  }
});

test('assertValidContribution rejects negative and non-integer values', () => {
  assert.throws(() => assertValidContribution(-1), (e) => e.status === 400);
  assert.throws(() => assertValidContribution(1.5), (e) => e.status === 400);
  assert.throws(() => titleForContribution(-5), (e) => e.status === 400);
  assert.throws(() => badgesForContribution(-5), (e) => e.status === 400);
});
