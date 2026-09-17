'use strict';
// Stage 20 — Carrom rules engine.
//
// The real, server-side per-game rules engine that game-match.service.js's
// file header (and PHASE5_CENTRAL_SYSTEMS_REPORT.md) documented as still
// owed before a Carrom match could ever be finished honestly. It is the
// ONLY code path that ever calls gameMatchService.finishMatch() for a
// carrom match, and it only ever does so once every regular piece is
// actually, server-side, off the board (and any pocketed queen has been
// resolved) -- never from a client-declared winner or client-declared
// score.
//
// Every strike is a single atomic server action (strike()): the outcome
// is rolled server-side via node:crypto (see ../domain/carrom-board.js
// for the fixed, documented outcome bands) and resolved entirely here --
// a client only ever calls strike(); it can never supply which piece was
// pocketed, whether it was a foul, or any score delta. `random` is an
// OPTIONAL constructor dependency purely so tests can script a
// deterministic sequence of strikes to drive a full match to a real,
// bounded finish; every real caller (src/index.js) uses the default,
// which is the real crypto-backed roll.
//
// Turn timing is server-authoritative, same pattern as
// quiz.service.js's per-question clock: `now` is an optional constructor
// dependency (defaults to Date.now) purely so tests can advance a fake
// clock deterministically. If the player whose turn it is lets the shot
// clock run out without striking, that turn is auto-forfeited
// server-side (recorded as a real 'timeout' history entry, never
// silently dropped) -- a client can never stall a match indefinitely by
// simply not acting.
//
// State lives in an in-memory Map keyed by matchId -- identical
// reconnect/persistence posture to snakes-ladders.service.js/
// quiz.service.js (see those files' headers for the tradeoff).

const crypto = require('node:crypto');
const { START_REGULAR_PIECES, POINTS, determineOutcome } = require('../domain/carrom-board');

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}
function conflict(message) {
  return Object.assign(new Error(message), { status: 409 });
}

function defaultRoll() {
  // 1-100 inclusive.
  return crypto.randomInt(1, 101);
}

const DEFAULT_TURN_DURATION_MS = 20000;

function createCarromService({ gameMatchService, random, now, turnDurationMs }) {
  const rollFn = random || defaultRoll;
  const nowFn = now || Date.now;
  const duration = turnDurationMs || DEFAULT_TURN_DURATION_MS;
  const matches = new Map(); // matchId -> carrom state

  async function _loadActiveMatch(actorId, matchId) {
    const match = await gameMatchService.getMatch(actorId, matchId);
    if (match.gameId !== 'carrom') throw badRequest('this match is not a Carrom match');
    return match;
  }

  function _getOrInitState(match) {
    let state = matches.get(match.id);
    if (!state) {
      state = {
        matchId: match.id,
        playerIds: match.playerIds.slice(),
        scores: Object.fromEntries(match.playerIds.map((p) => [p, 0])),
        regularPiecesRemaining: START_REGULAR_PIECES,
        queenPocketed: false,
        queenCovered: false,
        pendingQueenCoverPlayer: null,
        turnIndex: 0,
        turnStartedAt: nowFn(),
        history: [],
        finished: false,
        winnerId: null,
      };
      matches.set(match.id, state);
    }
    return state;
  }

  function _currentActor(state) {
    return state.playerIds[state.turnIndex];
  }

  // Ends the current player's turn and moves to the next player, with no
  // extra roll -- used for a foul, a miss, or a timeout.
  function _passTurn(state) {
    state.turnIndex = (state.turnIndex + 1) % state.playerIds.length;
    state.turnStartedAt = nowFn();
  }

  // Same player strikes again (real Carrom rule: pocketing a piece, or
  // having just pocketed the queen and needing to immediately attempt
  // its cover, both grant another go) -- only the shot clock resets.
  function _keepTurn(state) {
    state.turnStartedAt = nowFn();
  }

  // A pending queen cover that is not resolved this exact strike reverts
  // -- the queen goes back into play uncovered, matching the real rule
  // that an uncovered queen does not count.
  function _revertPendingQueen(state, actorId) {
    if (state.pendingQueenCoverPlayer === actorId) {
      state.queenPocketed = false;
      state.pendingQueenCoverPlayer = null;
    }
  }

  function _checkEnd(state) {
    if (state.regularPiecesRemaining === 0 && state.pendingQueenCoverPlayer === null && !state.finished) {
      return true;
    }
    return false;
  }

  async function _finish(state) {
    const maxScore = Math.max(...Object.values(state.scores));
    const winners = state.playerIds.filter((p) => state.scores[p] === maxScore);
    const winnerId = winners.length === 1 ? winners[0] : null;
    state.finished = true;
    state.winnerId = winnerId;
    await gameMatchService.finishMatch(state.matchId, {
      winnerId,
      result: { engine: 'carrom', scores: { ...state.scores }, draw: winners.length !== 1 },
    });
  }

  // Advances past any turn whose shot clock has already expired -- same
  // "catch state up to the server clock before reading/mutating it"
  // pattern as quiz.service.js#_tick, with no background timer needed.
  // A timed-out turn while a queen cover was pending reverts that queen,
  // exactly like a real miss/foul would.
  async function _tick(state) {
    while (!state.finished && nowFn() - state.turnStartedAt >= duration) {
      const actorId = _currentActor(state);
      _revertPendingQueen(state, actorId);
      state.history.push({ playerId: actorId, outcome: 'timeout', scoreDelta: 0, regularPiecesRemaining: state.regularPiecesRemaining, at: new Date(nowFn()).toISOString() });
      if (_checkEnd(state)) {
        await _finish(state);
        break;
      }
      _passTurn(state);
    }
  }

  function _publicState(state) {
    return {
      matchId: state.matchId,
      playerIds: state.playerIds,
      scores: { ...state.scores },
      regularPiecesRemaining: state.regularPiecesRemaining,
      queenPocketed: state.queenPocketed,
      queenCovered: state.queenCovered,
      pendingQueenCoverPlayer: state.pendingQueenCoverPlayer,
      turn: state.finished ? null : _currentActor(state),
      timeRemainingMs: state.finished ? 0 : Math.max(0, duration - (nowFn() - state.turnStartedAt)),
      history: state.history.slice(),
      finished: state.finished,
      winnerId: state.winnerId,
    };
  }

  async function getState(actorId, matchId) {
    const match = await _loadActiveMatch(actorId, matchId);
    if (match.state === 'lobby') {
      return { matchId: match.id, playerIds: match.playerIds, scores: null, regularPiecesRemaining: null, queenPocketed: false, queenCovered: false, pendingQueenCoverPlayer: null, turn: null, timeRemainingMs: null, history: [], finished: false, winnerId: null, started: false };
    }
    const state = _getOrInitState(match);
    await _tick(state);
    return { ..._publicState(state), started: true };
  }

  async function strike(actorId, matchId) {
    const match = await _loadActiveMatch(actorId, matchId);
    if (match.state !== 'active') throw conflict(`match is ${match.state}, not active -- start it first`);
    const state = _getOrInitState(match);
    await _tick(state);
    if (state.finished) throw conflict('this game has already finished');
    if (_currentActor(state) !== actorId) throw conflict(`it is not your turn (waiting on ${_currentActor(state)})`);

    const roll = rollFn();
    let outcome = determineOutcome(roll);
    // A 'queen' band is only meaningful while the queen is still in play;
    // a 'pocket' band needs a real remaining piece. Neither is ever
    // wasted or re-rolled -- both fall back to the next-best real
    // outcome the same server roll actually supports, documented above.
    if (outcome === 'queen' && state.queenPocketed) outcome = 'pocket';
    if (outcome === 'pocket' && state.regularPiecesRemaining === 0) outcome = 'miss';

    const entry = { playerId: actorId, outcome, roll, scoreDelta: 0, at: new Date(nowFn()).toISOString() };

    if (outcome === 'foul') {
      const penalty = Math.min(POINTS.FOUL_PENALTY, state.scores[actorId]);
      state.scores[actorId] -= penalty;
      entry.scoreDelta = -penalty;
      _revertPendingQueen(state, actorId);
      state.history.push({ ...entry, regularPiecesRemaining: state.regularPiecesRemaining });
      if (_checkEnd(state)) await _finish(state);
      else _passTurn(state);
    } else if (outcome === 'miss') {
      _revertPendingQueen(state, actorId);
      state.history.push({ ...entry, regularPiecesRemaining: state.regularPiecesRemaining });
      if (_checkEnd(state)) await _finish(state);
      else _passTurn(state);
    } else if (outcome === 'pocket') {
      state.regularPiecesRemaining -= 1;
      let delta = POINTS.REGULAR;
      let coveredQueen = false;
      if (state.pendingQueenCoverPlayer === actorId) {
        delta += POINTS.QUEEN_BONUS;
        state.queenCovered = true;
        state.pendingQueenCoverPlayer = null;
        coveredQueen = true;
      }
      state.scores[actorId] += delta;
      entry.scoreDelta = delta;
      entry.coveredQueen = coveredQueen;
      state.history.push({ ...entry, regularPiecesRemaining: state.regularPiecesRemaining });
      if (_checkEnd(state)) await _finish(state);
      else _keepTurn(state); // pocketing grants another strike
    } else {
      // outcome === 'queen'
      state.queenPocketed = true;
      state.pendingQueenCoverPlayer = actorId;
      state.history.push({ ...entry, regularPiecesRemaining: state.regularPiecesRemaining });
      _keepTurn(state); // must immediately attempt the cover
    }

    return _publicState(state);
  }

  return { getState, strike };
}

module.exports = { createCarromService };
