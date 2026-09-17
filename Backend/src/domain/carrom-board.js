'use strict';
// Stage 20 — Carrom strike-resolution rules.
//
// Carrom has no discrete move a client could ever legitimately "declare"
// the way a die roll or a quiz answer choice can -- a real strike's
// outcome depends on physical aim/power. Same trust boundary as every
// other engine in this project though: the outcome is always decided
// server-side (../services/carrom.service.js rolls a server-only
// crypto value and resolves it through determineOutcome() below), never
// accepted, influenced, or overridden by anything the client sends. This
// file itself is pure and stateless -- fixed bands + scoring constants,
// the same "fixed data + pure functions" shape game-catalog.js and
// snakes-ladders.board.js already use.
//
// Documented, intentional simplification (same "not final tuning"
// caveat every other rules file in this project carries): a real striker
// shot is not simulated physically; each strike is resolved against one
// server-rolled value in [1,100] using the fixed bands below. This keeps
// the engine fully server-authoritative and testable while still
// producing real, varied, per-match outcomes -- never a client-declared
// score or a fixed/scripted result in production.
//
// Board: 18 regular (non-queen) pieces + 1 queen, the standard count.
const START_REGULAR_PIECES = 18;

const POINTS = Object.freeze({ REGULAR: 10, QUEEN_BONUS: 50, FOUL_PENALTY: 5 });

// Bands over a roll in [1,100]. 'queen' can only ever fire when the
// caller still allows it (queen not already pocketed) -- see
// carrom.service.js, which re-rolls into 'pocket' whenever a 'queen'
// band is drawn but the queen is not eligible, rather than wasting the
// roll or inventing a different outcome.
function determineOutcome(roll) {
  if (!Number.isInteger(roll) || roll < 1 || roll > 100) {
    throw Object.assign(new Error('roll must be an integer in [1,100]'), { status: 400 });
  }
  if (roll <= 15) return 'foul'; // 15%
  if (roll <= 40) return 'miss'; // 25%
  if (roll <= 85) return 'pocket'; // 45%
  return 'queen'; // 15%
}

module.exports = { START_REGULAR_PIECES, POINTS, determineOutcome };
