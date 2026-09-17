// Stage 30 — Family donation catalog.
//
// Same boundary as store-catalog.js/gift-catalog.js: the amount a
// donation actually costs/contributes is ALWAYS looked up here,
// server-side, from a tierId — never accepted as a raw number from the
// client. Trusting a client-supplied amount would let a member inflate
// their own contribution (and their family's xp/level) for free, with no
// real wallet debit behind it.
//
// A donation always costs real coins (see family.service.js's donate(),
// which debits the member's wallet via wallets.debit() before recording
// any contribution) and, 1:1, adds that many contribution points to the
// member AND that many xp points to the family. Illustrative starting
// values, not a final product/economy decision — same caveat as
// store-catalog.js.

const FAMILY_DONATION_TIERS = Object.freeze({
  small: Object.freeze({ id: 'small', coins: 100 }),
  medium: Object.freeze({ id: 'medium', coins: 500 }),
  large: Object.freeze({ id: 'large', coins: 2000 }),
});

function resolveFamilyDonationTier(tierId) {
  const tier = FAMILY_DONATION_TIERS[tierId];
  if (!tier) {
    throw Object.assign(new Error(`unknown tierId; must be one of ${Object.keys(FAMILY_DONATION_TIERS).join(', ')}`), {
      status: 400,
    });
  }
  return tier;
}

module.exports = { FAMILY_DONATION_TIERS, resolveFamilyDonationTier };
