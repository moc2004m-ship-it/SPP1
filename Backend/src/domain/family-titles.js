// Stage 30 — Family member titles/badges.
//
// Same threshold-table pattern as ../domain/vip-tiers.js, but the counter
// here is family.repository.js's per-membership `contribution` total
// (real coins spent via family.service.js's donate(), see
// ../domain/family-donations.js) — never a client-supplied number.
// Illustrative starting values, not a final product/economy decision —
// same caveat as vip-tiers.js and level-curve.js.
//
// `title` is a single current rank (like VIP tier — you hold exactly
// one). `badges` are cumulative achievements — every threshold you have
// ever crossed stays earned even after title changes, which is why
// badgesForContribution() returns every threshold at or below the given
// amount, not just the current one.

const TITLE_THRESHOLDS = Object.freeze([
  { min: 0, title: 'newcomer' },
  { min: 1000, title: 'contributor' },
  { min: 5000, title: 'pillar' },
  { min: 20000, title: 'legend' },
]);

const BADGE_THRESHOLDS = Object.freeze([
  { min: 500, badge: 'first_500' },
  { min: 1000, badge: 'first_1000' },
  { min: 5000, badge: 'first_5000' },
  { min: 20000, badge: 'first_20000' },
]);

function assertValidContribution(contribution) {
  if (!Number.isInteger(contribution) || contribution < 0) {
    throw Object.assign(new Error('contribution must be a non-negative integer'), { status: 400 });
  }
}

function titleForContribution(contribution) {
  assertValidContribution(contribution);
  let title = TITLE_THRESHOLDS[0].title;
  for (const entry of TITLE_THRESHOLDS) {
    if (contribution >= entry.min) title = entry.title;
  }
  return title;
}

function badgesForContribution(contribution) {
  assertValidContribution(contribution);
  return BADGE_THRESHOLDS.filter((entry) => contribution >= entry.min).map((entry) => entry.badge);
}

module.exports = {
  TITLE_THRESHOLDS,
  BADGE_THRESHOLDS,
  titleForContribution,
  badgesForContribution,
  assertValidContribution,
};
