'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FAMILY_DONATION_TIERS, resolveFamilyDonationTier } = require('../src/domain/family-donations');

test('resolves each documented tier to its real server-side coin amount', () => {
  assert.equal(resolveFamilyDonationTier('small').coins, 100);
  assert.equal(resolveFamilyDonationTier('medium').coins, 500);
  assert.equal(resolveFamilyDonationTier('large').coins, 2000);
});

test('the tier id in the resolved object always matches the requested tierId', () => {
  for (const tierId of Object.keys(FAMILY_DONATION_TIERS)) {
    assert.equal(resolveFamilyDonationTier(tierId).id, tierId);
  }
});

test('an unknown tierId is rejected with 400 (never falls back to a default price)', () => {
  assert.throws(() => resolveFamilyDonationTier('huge'), (e) => e.status === 400);
  assert.throws(() => resolveFamilyDonationTier(''), (e) => e.status === 400);
  assert.throws(() => resolveFamilyDonationTier(undefined), (e) => e.status === 400);
});

test('a client-shaped injection attempt (object instead of string id) is rejected, not coerced', () => {
  assert.throws(() => resolveFamilyDonationTier({ coins: 999999 }), (e) => e.status === 400);
});

test('catalog tiers are frozen (cannot be mutated at runtime to change price)', () => {
  assert.throws(() => {
    'use strict';
    FAMILY_DONATION_TIERS.small.coins = 1;
  });
  assert.equal(FAMILY_DONATION_TIERS.small.coins, 100);
});
