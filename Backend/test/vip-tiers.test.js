'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VIP_THRESHOLDS,
  SVIP_THRESHOLDS,
  vipTierForLifetimeDiamonds,
  svipTierForLifetimeDiamonds,
} = require('../src/domain/vip-tiers');

test('0 lifetime recharge is tier 0 for both VIP and SVIP', () => {
  assert.equal(vipTierForLifetimeDiamonds(0), 0);
  assert.equal(svipTierForLifetimeDiamonds(0), 0);
});

test('VIP tier increases at each exact threshold', () => {
  for (let i = 0; i < VIP_THRESHOLDS.length; i++) {
    assert.equal(vipTierForLifetimeDiamonds(VIP_THRESHOLDS[i]), i);
  }
});

test('one unit below a VIP threshold stays at the previous tier', () => {
  for (let i = 1; i < VIP_THRESHOLDS.length; i++) {
    assert.equal(vipTierForLifetimeDiamonds(VIP_THRESHOLDS[i] - 1), i - 1);
  }
});

test('SVIP tier increases at each exact threshold', () => {
  for (let i = 0; i < SVIP_THRESHOLDS.length; i++) {
    assert.equal(svipTierForLifetimeDiamonds(SVIP_THRESHOLDS[i]), i);
  }
});

test('amounts far beyond the top threshold stay at the top tier (no overflow/wraparound)', () => {
  assert.equal(vipTierForLifetimeDiamonds(10_000_000), VIP_THRESHOLDS.length - 1);
  assert.equal(svipTierForLifetimeDiamonds(50_000_000), SVIP_THRESHOLDS.length - 1);
});

test('SVIP thresholds start strictly above the top VIP threshold (SVIP is a much-higher tier)', () => {
  assert.ok(SVIP_THRESHOLDS[1] > VIP_THRESHOLDS[VIP_THRESHOLDS.length - 1]);
});

test('rejects a negative amount', () => {
  assert.throws(() => vipTierForLifetimeDiamonds(-1), (e) => e.status === 400);
  assert.throws(() => svipTierForLifetimeDiamonds(-1), (e) => e.status === 400);
});

test('rejects a non-integer amount', () => {
  assert.throws(() => vipTierForLifetimeDiamonds(1.5), (e) => e.status === 400);
});
