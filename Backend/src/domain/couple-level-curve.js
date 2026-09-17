// Stage 32 — Couple LVL/CP domain curve.
//
// Same shape as ../domain/family-level-curve.js, kept as its own module
// on purpose: a couple's cpValue is the sum of BOTH partners' real gifted
// value to each other (see couple.repository.js's addCp()), a
// two-person relationship rather than a many-member family, so it is
// expected to grow on a different real-world cadence and gets its own
// per-level requirement. Pure function, no I/O, no client input trusted
// here — the cp value always comes from the caller having already
// summed real, server-recorded contributions.
//
// Curve: cumulative CP required to REACH level n is 500 * n^2 (n=0 is the
// starting level, requires 0 cp). Illustrative starting curve, not a
// final product/economy decision — same caveat as family-level-curve.js,
// level-curve.js, and vip-tiers.js. Whoever owns game-economy balancing
// should replace COUPLE_CP_PER_LEVEL_FACTOR before real launch; every
// call site goes through levelForCoupleCp() so that is a one-line change
// later.

const COUPLE_CP_PER_LEVEL_FACTOR = 500;

function assertValidCoupleCp(cp) {
  if (!Number.isInteger(cp) || cp < 0) {
    throw Object.assign(new Error('couple cp must be a non-negative integer'), { status: 400 });
  }
}

// Cumulative CP required to reach `level` (level 0 => 0).
function cpRequiredForCoupleLevel(level) {
  if (!Number.isInteger(level) || level < 0) {
    throw Object.assign(new Error('level must be a non-negative integer'), { status: 400 });
  }
  return COUPLE_CP_PER_LEVEL_FACTOR * level * level;
}

// Highest level whose cumulative requirement is <= cp. Closed-form
// estimate (sqrt) then corrected by walking the exact cumulative
// function, so float rounding can never overshoot/undershoot the true
// threshold — identical technique to family-level-curve.js's
// levelForFamilyXp().
function levelForCoupleCp(cp) {
  assertValidCoupleCp(cp);
  if (cp === 0) return 0;
  let level = Math.floor(Math.sqrt(cp / COUPLE_CP_PER_LEVEL_FACTOR));
  while (cpRequiredForCoupleLevel(level + 1) <= cp) level++;
  while (level > 0 && cpRequiredForCoupleLevel(level) > cp) level--;
  return level;
}

module.exports = {
  COUPLE_CP_PER_LEVEL_FACTOR,
  cpRequiredForCoupleLevel,
  levelForCoupleCp,
  assertValidCoupleCp,
};
