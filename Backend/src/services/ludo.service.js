'use strict';
// Stage 20 — Ludo rules engine.
//
// The real, server-side per-game rules engine that game-match.service.js's
// file header (and PHASE5_CENTRAL_SYSTEMS_REPORT.md) documented as still
// owed before a Ludo match could ever be finished honestly. It is the
// ONLY code path that ever calls gameMatchService.finishMatch() for a
// ludo match, and it only ever does so once a player has actually,
// server-side, walked all 4 of their own tokens home -- never from a
// client-declared winner.
//
// Two-phase turn, matching how Ludo is actually played: a player cannot
// choose which token to move until they know the die value, so the die
// is rolled first (rollDice(), server-side only, node:crypto) and stored
// as that match's pendingDie; the player then chooses *which of their
// own tokens* to move (moveToken()), and the server -- never the client
// -- recomputes whether that specific move is legal against the real
// board rules (../domain/ludo.board.js) before applying it. A client can
// never supply a die value, a resulting position, or a capture outcome.
//
// Anti-cheat rules enforced here, all server-side:
//   - Only the player whose turn it is may roll or move.
//   - moveToken() re-validates the chosen piece's move from scratch
//     (base/board/home-column/overshoot) even though rollDice() already
//     reported which pieces had a legal move -- that report is guidance
//     only, never trusted as the actual authorization.
//   - Capturing only ever happens against a real opponent token
//     server-side found to be occupying the exact same, non-safe
//     absolute square -- never client-declared.
//   - Three consecutive sixes by the same player forfeits that turn
//     immediately (classic rule) instead of allowing an unbounded run of
//     free rolls.
//   - If a rolled die leaves the current player with no legal move at
//     all (e.g. every token still in base and the die isn't 6), the turn
//     is auto-skipped server-side rather than waiting on a client that
//     could otherwise stall the match.
//
// State lives in an in-memory Map keyed by matchId -- identical
// reconnect/persistence posture to snakes-ladders.service.js (see that
// file's header for the tradeoff).

const crypto = require('node:crypto');
const {
  HOME_REL_POS,
  TOKENS_PER_PLAYER,
  BASE,
  START_OFFSETS,
  absoluteSquare,
  isSafeSquare,
  computeMove,
} = require('../domain/ludo.board');

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}
function conflict(message) {
  return Object.assign(new Error(message), { status: 409 });
}

function defaultRoll() {
  // 1-6 inclusive.
  return crypto.randomInt(1, 7);
}

const THREE_SIXES_LIMIT = 3;

function createLudoService({ gameMatchService, random }) {
  const rollDie = random || defaultRoll;
  const matches = new Map(); // matchId -> ludo state

  async function _loadActiveMatch(actorId, matchId) {
    const match = await gameMatchService.getMatch(actorId, matchId);
    if (match.gameId !== 'ludo') throw badRequest('this match is not a Ludo match');
    return match;
  }

  function _getOrInitState(match) {
    let state = matches.get(match.id);
    if (!state) {
      state = {
        matchId: match.id,
        playerIds: match.playerIds.slice(),
        // Colors are assigned once, in join order -- never chosen by a
        // client -- and never reassigned even if the roster were to
        // change (playerIds is fixed once a match starts).
        colorIndexOf: Object.fromEntries(match.playerIds.map((p, i) => [p, i])),
        tokens: Object.fromEntries(match.playerIds.map((p) => [p, new Array(TOKENS_PER_PLAYER).fill(BASE)])),
        finishedCounts: Object.fromEntries(match.playerIds.map((p) => [p, 0])),
        turnIndex: 0,
        pendingDie: null,
        legalPieceIndices: [],
        consecutiveSixes: 0,
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

  function _advanceTurn(state) {
    state.turnIndex = (state.turnIndex + 1) % state.playerIds.length;
    state.pendingDie = null;
    state.legalPieceIndices = [];
    state.consecutiveSixes = 0;
  }

  function _legalPieceIndicesFor(state, actorId, die) {
    const tokens = state.tokens[actorId];
    const out = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const relPos = tokens[i];
      if (relPos === HOME_REL_POS) continue;
      if (relPos === BASE) {
        if (die === 6) out.push(i);
        continue;
      }
      if (computeMove(relPos, die).valid) out.push(i);
    }
    return out;
  }

  function _publicState(state) {
    return {
      matchId: state.matchId,
      playerIds: state.playerIds,
      colorIndexOf: { ...state.colorIndexOf },
      tokens: Object.fromEntries(state.playerIds.map((p) => [p, state.tokens[p].slice()])),
      finishedCounts: { ...state.finishedCounts },
      turn: state.finished ? null : _currentActor(state),
      pendingDie: state.finished ? null : state.pendingDie,
      legalPieceIndices: state.finished ? [] : state.legalPieceIndices.slice(),
      history: state.history.slice(),
      finished: state.finished,
      winnerId: state.winnerId,
    };
  }

  async function getState(actorId, matchId) {
    const match = await _loadActiveMatch(actorId, matchId);
    if (match.state === 'lobby') {
      return { matchId: match.id, playerIds: match.playerIds, tokens: null, turn: null, pendingDie: null, legalPieceIndices: [], history: [], finished: false, winnerId: null, started: false };
    }
    const state = _getOrInitState(match);
    return { ..._publicState(state), started: true };
  }

  async function rollDice(actorId, matchId) {
    const match = await _loadActiveMatch(actorId, matchId);
    if (match.state !== 'active') throw conflict(`match is ${match.state}, not active -- start it first`);
    const state = _getOrInitState(match);
    if (state.finished) throw conflict('this game has already finished');
    if (_currentActor(state) !== actorId) throw conflict(`it is not your turn (waiting on ${_currentActor(state)})`);
    if (state.pendingDie !== null) throw conflict('you already rolled -- move a token before rolling again');

    const die = rollDie();

    if (die === 6) {
      state.consecutiveSixes += 1;
      if (state.consecutiveSixes >= THREE_SIXES_LIMIT) {
        state.history.push({ playerId: actorId, event: 'three_sixes_forfeit', die, at: new Date().toISOString() });
        _advanceTurn(state);
        return _publicState(state);
      }
    } else {
      state.consecutiveSixes = 0;
    }

    const legal = _legalPieceIndicesFor(state, actorId, die);
    if (legal.length === 0) {
      state.history.push({ playerId: actorId, event: 'no_legal_move', die, at: new Date().toISOString() });
      _advanceTurn(state);
      return _publicState(state);
    }

    state.pendingDie = die;
    state.legalPieceIndices = legal;
    state.history.push({ playerId: actorId, event: 'rolled', die, legalPieceIndices: legal.slice(), at: new Date().toISOString() });
    return _publicState(state);
  }

  async function moveToken(actorId, matchId, pieceIndex) {
    const match = await _loadActiveMatch(actorId, matchId);
    if (match.state !== 'active') throw conflict(`match is ${match.state}, not active -- start it first`);
    const state = _getOrInitState(match);
    if (state.finished) throw conflict('this game has already finished');
    if (_currentActor(state) !== actorId) throw conflict(`it is not your turn (waiting on ${_currentActor(state)})`);
    if (state.pendingDie === null) throw conflict('roll the die before moving a token');
    if (!Number.isInteger(pieceIndex) || pieceIndex < 0 || pieceIndex >= TOKENS_PER_PLAYER) {
      throw badRequest(`pieceIndex must be an integer between 0 and ${TOKENS_PER_PLAYER - 1}`);
    }

    const die = state.pendingDie;
    const tokens = state.tokens[actorId];
    const relPos = tokens[pieceIndex];
    const result = computeMove(relPos, die);
    if (!result.valid) throw conflict(`illegal move: ${result.reason}`);

    tokens[pieceIndex] = result.newRelPos;
    const captured = [];
    const colorIndex = state.colorIndexOf[actorId];
    const landedSquare = absoluteSquare(result.newRelPos, colorIndex);
    if (landedSquare !== null && !isSafeSquare(landedSquare)) {
      for (const otherId of state.playerIds) {
        if (otherId === actorId) continue;
        const otherColor = state.colorIndexOf[otherId];
        const otherTokens = state.tokens[otherId];
        for (let i = 0; i < otherTokens.length; i += 1) {
          const otherSquare = absoluteSquare(otherTokens[i], otherColor);
          if (otherSquare === landedSquare) {
            otherTokens[i] = BASE;
            captured.push({ playerId: otherId, pieceIndex: i });
          }
        }
      }
    }

    let wonMatch = false;
    if (result.finished) {
      state.finishedCounts[actorId] += 1;
      if (state.finishedCounts[actorId] === TOKENS_PER_PLAYER) wonMatch = true;
    }

    state.history.push({
      playerId: actorId,
      event: 'moved',
      pieceIndex,
      die,
      fromPos: result.fromPos,
      toPos: result.newRelPos,
      enteredBoard: result.enteredBoard,
      finishedToken: result.finished,
      captured,
      at: new Date().toISOString(),
    });

    if (wonMatch) {
      state.finished = true;
      state.winnerId = actorId;
      state.pendingDie = null;
      state.legalPieceIndices = [];
      await gameMatchService.finishMatch(matchId, {
        winnerId: actorId,
        result: { engine: 'ludo', finishedCounts: { ...state.finishedCounts }, moves: state.history.length },
      });
      return _publicState(state);
    }

    // Real Ludo rule: rolling a 6 grants another roll for the same
    // player; any other roll passes the turn.
    if (die === 6) {
      state.pendingDie = null;
      state.legalPieceIndices = [];
    } else {
      _advanceTurn(state);
    }
    return _publicState(state);
  }

  return { getState, rollDice, moveToken };
}

module.exports = { createLudoService };
