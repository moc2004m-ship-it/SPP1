'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { GUARD_TIERS, resolveGuardTier } = require('../src/domain/guard-catalog');

test('resolveGuardTier returns the real server-side price/duration for a known tierKey', () => {
  const tier = resolveGuardTier('silver');
  assert.equal(tier.id, 'silver');
  assert.equal(tier.coins, GUARD_TIERS.silver.coins);
  assert.equal(tier.days, GUARD_TIERS.silver.days);
});

test('resolveGuardTier throws 400 for an unknown tierKey', () => {
  assert.throws(() => resolveGuardTier('platinum'), (err) => {
    assert.equal(err.status, 400);
    assert.match(err.message, /unknown tierKey/);
    return true;
  });
});

test('resolveGuardTier throws 400 for a missing/empty tierKey', () => {
  assert.throws(() => resolveGuardTier(undefined), { status: 400 });
  assert.throws(() => resolveGuardTier(''), { status: 400 });
});

test('every tier has a positive integer coins price and days duration', () => {
  for (const tier of Object.values(GUARD_TIERS)) {
    assert.ok(Number.isInteger(tier.coins) && tier.coins > 0, `${tier.id} coins must be a positive integer`);
    assert.ok(Number.isInteger(tier.days) && tier.days > 0, `${tier.id} days must be a positive integer`);
  }
});

test('GUARD_TIERS is frozen (cannot be mutated by a caller)', () => {
  assert.throws(() => {
    GUARD_TIERS.bronze.coins = 1;
  });
});
