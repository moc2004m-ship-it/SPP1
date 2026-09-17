// Stage 28 — LVL/XP domain curve.
//
// Pure function, no I/O, no client input trusted here (xp is always a
// number the CALLER already validated/derived server-side — see
// account.repository.js's addXp()). Kept separate from the repository so
// the curve itself is unit-testable without touching storage.
//
// Curve: cumulative XP required to REACH level n is 100 * n^2 (n=0 is the
// starting level, requires 0 xp). This is an illustrative starting curve,
// not a final product/economy decision -- same caveat as gift-catalog.js
// and recharge.model.js's PACKAGES. Whoever owns game-economy balancing
// should replace XP_PER_LEVEL_FACTOR before real launch; every call site
// goes through levelForXp() so that is a one-line change later.

const XP_PER_LEVEL_FACTOR = 100;

function assertValidXp(xp) {
  if (!Number.isInteger(xp) || xp < 0) {
    throw Object.assign(new Error('xp must be a non-negative integer'), { status: 400 });
  }
}

// Cumulative XP required to reach `level` (level 0 => 0).
function xpRequiredForLevel(level) {
  if (!Number.isInteger(level) || level < 0) {
    throw Object.assign(new Error('level must be a non-negative integer'), { status: 400 });
  }
  return XP_PER_LEVEL_FACTOR * level * level;
}

// Highest level whose cumulative requirement is <= xp.
// Closed-form estimate (sqrt) then corrected by walking the exact
// cumulative function, so float rounding can never overshoot/undershoot
// the true threshold.
function levelForXp(xp) {
  assertValidXp(xp);
  if (xp === 0) return 0;
  let level = Math.floor(Math.sqrt(xp / XP_PER_LEVEL_FACTOR));
  while (xpRequiredForLevel(level + 1) <= xp) level++;
  while (level > 0 && xpRequiredForLevel(level) > xp) level--;
  return level;
}

module.exports = { XP_PER_LEVEL_FACTOR, xpRequiredForLevel, levelForXp, assertValidXp };
