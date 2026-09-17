// Phase 5 — Game match service.
//
// createMatch() is real and reachable from mobile sessions (see
// routes/platform.routes.js POST /api/games), same as before.
//
// finishMatch() is real and idempotent at the repository level, but is
// NOT called from any mobile-facing route. A result can only be correct
// if something actually plays out the game's rules (Ludo dice/board
// state, Chess legal moves, Snakes & Ladders board state, ...) --  that is
// a real per-game rules engine, a separate and large body of work per
// game, out of scope of this pass. Exposing a "submit result" endpoint
// today would mean either trusting a client-declared winner (the exact
// fake-result shortcut this project must not take) or inventing a random
// result (equally fake). Neither happens. See
// PHASE5_CENTRAL_SYSTEMS_REPORT.md.
//
// This service exists now so that whenever a real engine is built for a
// given game, it has a real, tested, idempotent place to call
// finishMatch(matchId, { winnerId, result }) into -- server-side only,
// same trust boundary as wallet.internal-routes.js.
//
// Stage 19 — Room Game Center framework. Everything below finishMatch()
// in the file's original form was missing before this stage: gameId was
// accepted as any string with no catalog/validation at all, there was no
// authorization check that the caller was even in the room they were
// starting/joining a match in, and there was no way to list a room's own
// lobby, join one someone else started, leave one, cancel one, or start
// one. All of that is real, framework-level "Room Game Center" work --
// none of it is a per-game rules engine (still Stage 20/21/22, still out
// of scope -- see finishMatch() above, unchanged).
//
// `isRoomMember(roomId, accountId)` is an OPTIONAL constructor dependency
// (same additive pattern as gifts.service.js's optional
// battleService/giftWallService/coupleService/eventService), so every
// pre-Stage-19 test that builds this service with just `{ gameMatches }`
// keeps working byte-for-byte (membership is simply not enforced without
// it -- see _requireMember()). The real wiring (src/index.js) always
// supplies it, backed by the same Stage 12 room-ownership + Stage 13
// join/leave membership ledger requireRoomOwner() already uses (see
// routes/platform.guards.js#isRoomMember).

const { assertValidPlayerIds } = require('../database/models/game-match.model');
const { resolveGame } = require('../domain/game-catalog');

function assertId(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw Object.assign(new Error(`${name} is required`), { status: 400 });
  }
  return value;
}

function forbidden(message) {
  return Object.assign(new Error(message), { status: 403 });
}

function notFound(message) {
  return Object.assign(new Error(message), { status: 404 });
}

function conflict(message) {
  return Object.assign(new Error(message), { status: 409 });
}

function createGameMatchService({ gameMatches, isRoomMember }) {
  // Defense-in-depth room-membership check, mirroring the "re-verified at
  // the service layer" pattern battle.service.js/rooms.approveSeat use --
  // a no-op (never throws) when isRoomMember was not supplied, so this
  // stays 100% backward compatible with every test/caller that predates
  // Stage 19's authorization work.
  async function _requireMember(roomId, actorId) {
    if (!isRoomMember) return;
    const member = await isRoomMember(roomId, actorId);
    if (!member) throw forbidden('you must be a member of this room to use its game center');
  }

  // Stage 19 — gameId is now always resolved against the real catalog
  // (see domain/game-catalog.js) instead of being trusted as an arbitrary
  // client string, and the starting roster can never already exceed that
  // game's real max player count. Room membership is required (via
  // _requireMember()) so a session that never joined/owns the room cannot
  // spin up a match in it.
  async function createMatch({ roomId, gameId, version, startedBy, playerIds }) {
    assertId(roomId, 'roomId');
    assertId(startedBy, 'startedBy');
    await _requireMember(roomId, startedBy);
    const game = resolveGame(gameId);
    assertValidPlayerIds(playerIds);
    if (playerIds.length > game.maxPlayers) {
      throw Object.assign(new Error(`${game.name} allows at most ${game.maxPlayers} players`), { status: 400 });
    }
    return gameMatches.create({ roomId, gameId: game.id, version: version || '1', startedBy, playerIds });
  }

  // A match is only ever visible to its own players -- same "only a
  // participant can view it" boundary battle.service.js#getBattle uses.
  async function getMatch(actorId, matchId) {
    assertId(actorId, 'actorId');
    assertId(matchId, 'matchId');
    const match = await gameMatches.findById(matchId);
    if (!match) throw notFound('match not found');
    if (!match.playerIds.includes(actorId)) throw forbidden('only a participant of this match can view it');
    return match;
  }

  // Stage 19 -- a room's own game-center lobby view: every match in that
  // room (any state), regardless of who started it or who has joined so
  // far. This is what lets a room member discover an open lobby to join,
  // as distinct from "my games" (listByStartedBy, unchanged below).
  async function listByRoom(actorId, roomId) {
    assertId(actorId, 'actorId');
    assertId(roomId, 'roomId');
    await _requireMember(roomId, actorId);
    return gameMatches.listByRoom(roomId);
  }

  // Stage 19 -- join a still-open lobby. Idempotent for a player already
  // in the match (returns it unchanged, not an error) -- the same
  // "duplicate action is a safe no-op" rule the repository layer's own
  // addPlayer() already documents.
  async function joinMatch(actorId, matchId) {
    assertId(actorId, 'actorId');
    assertId(matchId, 'matchId');
    const match = await gameMatches.findById(matchId);
    if (!match) throw notFound('match not found');
    await _requireMember(match.roomId, actorId);
    if (match.state !== 'lobby') throw conflict(`match is ${match.state}, not lobby`);
    if (match.playerIds.includes(actorId)) return match;
    const game = resolveGame(match.gameId);
    if (match.playerIds.length >= game.maxPlayers) {
      throw conflict(`${game.name} lobby is full (max ${game.maxPlayers} players)`);
    }
    return gameMatches.addPlayer(matchId, actorId);
  }

  // Stage 19 -- a non-host player voluntarily leaves a still-open lobby.
  // The host leaving their own lobby is treated as withdrawing the whole
  // match (see cancelMatch()) rather than leaving it ownerless -- same
  // "the host leaving ends it" rule battle.service.js's cancelChallenge()
  // effectively gives the host over a pending challenge.
  async function leaveMatch(actorId, matchId) {
    assertId(actorId, 'actorId');
    assertId(matchId, 'matchId');
    const match = await gameMatches.findById(matchId);
    if (!match) throw notFound('match not found');
    if (!match.playerIds.includes(actorId)) throw forbidden('you are not a player in this match');
    if (match.state !== 'lobby') throw conflict(`match is ${match.state}, not lobby`);
    if (match.startedBy === actorId) return gameMatches.cancel(matchId);
    return gameMatches.removePlayer(matchId, actorId);
  }

  // Stage 19 -- only the host may withdraw their own still-pending lobby
  // -- same "host-only, pending/lobby-only" shape as
  // battle.service.js#cancelChallenge.
  async function cancelMatch(actorId, matchId) {
    assertId(actorId, 'actorId');
    assertId(matchId, 'matchId');
    const match = await gameMatches.findById(matchId);
    if (!match) throw notFound('match not found');
    if (match.startedBy !== actorId) throw forbidden('only the host can cancel a lobby');
    if (match.state !== 'lobby') throw conflict(`match is ${match.state}, not lobby`);
    return gameMatches.cancel(matchId);
  }

  // Stage 19 -- only the host may start their own lobby, and only once
  // the real catalog's minimum player count for that game is actually
  // met (never fewer, e.g. starting a 2-player Chess lobby solo).
  // Starting a match is a framework lifecycle transition, NOT a game
  // result -- it never touches result/winnerId/resultSource, which
  // remain exclusively finishMatch()'s (see file header).
  async function startMatch(actorId, matchId) {
    assertId(actorId, 'actorId');
    assertId(matchId, 'matchId');
    const match = await gameMatches.findById(matchId);
    if (!match) throw notFound('match not found');
    if (match.startedBy !== actorId) throw forbidden('only the host can start this match');
    if (match.state !== 'lobby') throw conflict(`match is ${match.state}, not lobby`);
    const game = resolveGame(match.gameId);
    if (match.playerIds.length < game.minPlayers) {
      throw conflict(`${game.name} requires at least ${game.minPlayers} players to start`);
    }
    return gameMatches.start(matchId);
  }

  // Server-internal only -- see file header. winnerId must be one of the
  // match's own playerIds; this is checked here so even a future caller
  // mistake cannot record a winner who was never in the match.
  async function finishMatch(matchId, { winnerId, result }) {
    const match = await gameMatches.findById(matchId);
    if (!match) throw Object.assign(new Error('match not found'), { status: 404 });
    if (winnerId !== null && winnerId !== undefined && !match.playerIds.includes(winnerId)) {
      throw Object.assign(new Error('winnerId must be one of the match players'), { status: 400 });
    }
    return gameMatches.finish(matchId, { winnerId: winnerId ?? null, result: result ?? null });
  }

  return {
    createMatch,
    getMatch,
    listByRoom,
    joinMatch,
    leaveMatch,
    cancelMatch,
    startMatch,
    finishMatch,
  };
}

module.exports = { createGameMatchService };
