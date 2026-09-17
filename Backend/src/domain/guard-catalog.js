// Stage 32 — Guard/Fan Club catalog.
//
// Same boundary as store-catalog.js/family-donations.js: price (coins)
// AND duration (days) are ALWAYS looked up here, server-side, from a
// tierKey -- never accepted as numbers from the client. Trusting a
// client-supplied price/duration would let a fan grant themselves a
// permanent guard badge for free, or extend one indefinitely.
//
// Real product/pricing/economy decisions belong to whoever owns the
// store for this app -- these are illustrative starting values, not
// secret, same caveat as store-catalog.js/family-donations.js.

const GUARD_TIERS = Object.freeze({
  bronze: Object.freeze({ id: 'bronze', coins: 500, days: 30 }),
  silver: Object.freeze({ id: 'silver', coins: 2000, days: 30 }),
  gold: Object.freeze({ id: 'gold', coins: 8000, days: 30 }),
});

function resolveGuardTier(tierKey) {
  const tier = GUARD_TIERS[tierKey];
  if (!tier) {
    throw Object.assign(new Error(`unknown tierKey; must be one of ${Object.keys(GUARD_TIERS).join(', ')}`), {
      status: 400,
    });
  }
  return tier;
}

module.exports = { GUARD_TIERS, resolveGuardTier };
