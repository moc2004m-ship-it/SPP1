// Stage 18 — PK/Battles model.
//
// A battle's winner is decided by real, already-committed gift coins sent
// to each side during the active window (see
// ../../services/battle.service.js#recordGiftPoints, called only from
// ../../services/gifts.service.js AFTER a real wallet debit + gift record
// already exist) -- never a client-declared score and never a random
// result. This is the same "no fake result" boundary Stage 19/20-22's
// game-match.service.js documents, but PK/Battles can honestly clear it
// because a real points source (gifts) already exists, unlike a board
// game's rules engine.

const crypto = require('node:crypto');

function generateBattleId() {
  return `battle_${crypto.randomUUID()}`;
}

const STATES = Object.freeze(['pending', 'active', 'declined', 'cancelled', 'ended']);

// 3 minutes -- an illustrative default round length, same "starting point,
// not a claim of final game design" status as gift-catalog.js's prices.
const DEFAULT_DURATION_MS = 3 * 60 * 1000;
const MIN_DURATION_MS = 30 * 1000;
const MAX_DURATION_MS = 30 * 60 * 1000;

function assertDifferentAccounts(hostId, opponentId) {
  if (hostId === opponentId) {
    throw Object.assign(new Error('cannot challenge yourself to a battle'), { status: 400 });
  }
}

function resolveDurationMs(durationMs) {
  if (durationMs === undefined || durationMs === null) return DEFAULT_DURATION_MS;
  if (!Number.isInteger(durationMs) || durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
    throw Object.assign(new Error(`durationMs must be an integer between ${MIN_DURATION_MS} and ${MAX_DURATION_MS}`), { status: 400 });
  }
  return durationMs;
}

module.exports = {
  generateBattleId,
  STATES,
  DEFAULT_DURATION_MS,
  MIN_DURATION_MS,
  MAX_DURATION_MS,
  assertDifferentAccounts,
  resolveDurationMs,
};
