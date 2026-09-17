// Stage 27 — VIP/SVIP domain thresholds.
//
// Both tiers are derived from the SAME counter --
// account.lifetimeDiamondsRecharged, a monotonically-increasing,
// server-only total of everything ever successfully recharged for that
// account (see recharge.service.js's addLifetimeRecharge() call -- it
// only fires after a REAL provider-verified purchase completes, never on
// a client-declared amount). It intentionally does NOT use the current
// wallet balance, because a balance can go down when the user spends —
// VIP/SVIP status must not be lost by spending what was earned.
//
// VIP and SVIP are two independent threshold tables over the same
// counter, not two stages of one table: SVIP is aimed at a much smaller,
// much-higher-spend audience, so its thresholds start far above the top
// VIP threshold and its tier count is intentionally smaller. Illustrative
// starting values, not a final product/pricing decision -- same caveat as
// gift-catalog.js, recharge.model.js's PACKAGES, and level-curve.js.

const VIP_THRESHOLDS = Object.freeze([0, 500, 2000, 8000, 30000, 100000]); // tier index = array index, tier 0 = "not VIP"
const SVIP_THRESHOLDS = Object.freeze([0, 300000, 1000000, 5000000]); // starts well above the top VIP threshold

function assertValidLifetimeAmount(amount) {
  if (!Number.isInteger(amount) || amount < 0) {
    throw Object.assign(new Error('lifetimeDiamondsRecharged must be a non-negative integer'), { status: 400 });
  }
}

function tierForAmount(amount, thresholds) {
  assertValidLifetimeAmount(amount);
  let tier = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (amount >= thresholds[i]) tier = i;
  }
  return tier;
}

function vipTierForLifetimeDiamonds(lifetimeDiamondsRecharged) {
  return tierForAmount(lifetimeDiamondsRecharged, VIP_THRESHOLDS);
}

function svipTierForLifetimeDiamonds(lifetimeDiamondsRecharged) {
  return tierForAmount(lifetimeDiamondsRecharged, SVIP_THRESHOLDS);
}

module.exports = {
  VIP_THRESHOLDS,
  SVIP_THRESHOLDS,
  vipTierForLifetimeDiamonds,
  svipTierForLifetimeDiamonds,
};
