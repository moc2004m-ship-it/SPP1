// Phase 5 — Game match model.
//
// result/winnerId are NEVER set here from client input. finishMatch() in
// ../../services/game-match.service.js is the only code path allowed to
// transition a match to 'finished', and it is not reachable from any
// mobile-facing route yet (see routes/platform.routes.js) -- a real
// per-game rules engine (Ludo, Chess, ...) is required before that route
// can be safely opened, since only that engine -- not this model, not the
// route -- can determine a real result. See PHASE5_CENTRAL_SYSTEMS_REPORT.md.

const crypto = require('node:crypto');

function generateMatchId() {
  return `match_${crypto.randomUUID()}`;
}

const STATES = Object.freeze(['lobby', 'active', 'finished', 'cancelled']);

function assertValidPlayerIds(playerIds) {
  if (!Array.isArray(playerIds) || playerIds.length === 0 || !playerIds.every((p) => typeof p === 'string' && p.trim())) {
    throw Object.assign(new Error('playerIds must be a non-empty array of account id strings'), { status: 400 });
  }
}

module.exports = { generateMatchId, STATES, assertValidPlayerIds };
