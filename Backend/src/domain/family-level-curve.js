// Stage 30 — Family LVL/XP domain curve.
//
// Same shape as ../domain/level-curve.js (Stage 28, personal account
// XP/level), kept as a SEPARATE curve/module on purpose: a family's xp is
// the sum of every member's real contributions (see
// family.repository.js's addContribution()), not one person's activity,
// so it is expected to grow far faster and needs its own, much larger,
// per-level requirement. Pure function, no I/O, no client input trusted
// here — the xp value always comes from the caller having already summed
// real, server-recorded contributions.
//
// Curve: cumulative XP required to REACH level n is 1000 * n^2 (n=0 is
// the starting level, requires 0 xp). Illustrative starting curve, not a
// final product/economy decision — same caveat as level-curve.js,
// gift-catalog.js, and vip-tiers.js. Whoever owns game-economy balancing
// should replace FAMILY_XP_PER_LEVEL_FACTOR before real launch; every
// call site goes through levelForFamilyXp() so that is a one-line change
// later.

const FAMILY_XP_PER_LEVEL_FACTOR = 1000;

function assertValidFamilyXp(xp) {
  if (!Number.isInteger(xp) || xp < 0) {
    throw Object.assign(new Error('family xp must be a non-negative integer'), { status: 400 });
  }
}

// Cumulative XP required to reach `level` (level 0 => 0).
function xpRequiredForFamilyLevel(level) {
  if (!Number.isInteger(level) || level < 0) {
    throw Object.assign(new Error('level must be a non-negative integer'), { status: 400 });
  }
  return FAMILY_XP_PER_LEVEL_FACTOR * level * level;
}

// Highest level whose cumulative requirement is <= xp. Closed-form
// estimate (sqrt) then corrected by walking the exact cumulative
// function, so float rounding can never overshoot/undershoot the true
// threshold — identical technique to level-curve.js's levelForXp().
function levelForFamilyXp(xp) {
  assertValidFamilyXp(xp);
  if (xp === 0) return 0;
  let level = Math.floor(Math.sqrt(xp / FAMILY_XP_PER_LEVEL_FACTOR));
  while (xpRequiredForFamilyLevel(level + 1) <= xp) level++;
  while (level > 0 && xpRequiredForFamilyLevel(level) > xp) level--;
  return level;
}

module.exports = {
  FAMILY_XP_PER_LEVEL_FACTOR,
  xpRequiredForFamilyLevel,
  levelForFamilyXp,
  assertValidFamilyXp,
};
