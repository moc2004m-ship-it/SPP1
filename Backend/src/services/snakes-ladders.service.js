'use strict';
// Stage 21 — Snakes & Ladders rules engine.
//
// This is the real, server-side per-game rules engine that
// game-match.service.js's file header (and PHASE5_CENTRAL_SYSTEMS_REPORT.md)
// documented as still owed before a Snakes & Ladders match could ever be
// finished honestly. It is the ONLY code path that ever calls
// gameMatchService.finishMatch() for a snakes_ladders match, and it only
// ever does so once a player has actually, server-side, landed on square
// 100 -- never from a client-declared winner.
//
// State lives in an in-memory Map keyed by matchId, the same pattern the
// InMemoryGameMatchRepository itself uses. This is enough for "reconnect
// without losing state" within a running server process: a client that
// drops and reconnects simply calls getState() again and sees the exact
// same positions/turn/history -- nothing about a roll is ever client-held.
// (Surviving an actual server restart would need this state persisted to
// the database, same as game_matches itself -- out of scope for this
// pass, same "in-memory now, Postgres-backed later" posture every other
// InMemory*Repository in this project already carries.)
//
// The die is rolled here, server-side, via node:crypto -- a client can
// never supply, predict from client state, or influence a roll. `random`
// is an OPTIONAL constructor dependency purely so tests can script a
// deterministic sequence of rolls to drive a full game to a win in a
// bounded number of calls; every real caller (src/index.js) uses the
// default, which is the real crypto-backed die.

const crypto = require('node:crypto');
const { BOARD_SIZE, applyMove } = require('../domain/snakes-ladders.board');

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

function createSnakesLaddersService({ gameMatchService, random }) {
  const rollDie = random || defaultRoll;
  const boards = new Map(); // matchId -> board state

  function _publicState(board) {
    return {
      matchId: board.matchId,
      boardSize: BOARD_SIZE,
      playerIds: board.playerIds,
      positions: { ...board.positions },
      turn: board.finished ? null : board.playerIds[board.turnIndex],
      history: board.history.slice(),
      finished: board.finished,
      winnerId: board.winnerId,
    };
  }

  // A match must be real, active, this game, and the caller must be a
  // participant -- all of that is re-verified through the real
  // gameMatchService.getMatch() on every single call (never cached),
  // exactly like every other per-game engine touching this match would
  // have to.
  async function _loadActiveMatch(actorId, matchId) {
    const match = await gameMatchService.getMatch(actorId, matchId);
    if (match.gameId !== 'snakes_ladders') {
      throw badRequest('this match is not a Snakes & Ladders match');
    }
    return match;
  }

  function _getOrInitBoard(match) {
    let board = boards.get(match.id);
    if (!board) {
      board = {
        matchId: match.id,
        playerIds: match.playerIds.slice(),
        positions: Object.fromEntries(match.playerIds.map((p) => [p, 0])),
        turnIndex: 0,
        history: [],
        finished: false,
        winnerId: null,
      };
      boards.set(match.id, board);
    }
    return board;
  }

  async function getState(actorId, matchId) {
    const match = await _loadActiveMatch(actorId, matchId);
    if (match.state === 'lobby') {
      return { matchId: match.id, boardSize: BOARD_SIZE, playerIds: match.playerIds, positions: null, turn: null, history: [], finished: false, winnerId: null, started: false };
    }
    const board = _getOrInitBoard(match);
    return { ..._publicState(board), started: true };
  }

  async function rollDice(actorId, matchId) {
    const match = await _loadActiveMatch(actorId, matchId);
    if (match.state !== 'active') {
      throw conflict(`match is ${match.state}, not active -- start it first`);
    }
    const board = _getOrInitBoard(match);
    if (board.finished) throw conflict('this game has already finished');
    if (board.playerIds[board.turnIndex] !== actorId) {
      throw conflict(`it is not your turn (waiting on ${board.playerIds[board.turnIndex]})`);
    }

    const die = rollDie();
    const fromPos = board.positions[actorId];
    const move = applyMove(fromPos, die);
    board.positions[actorId] = move.finalPos;
    board.history.push({
      playerId: actorId,
      die,
      fromPos: move.fromPos,
      landedOn: move.landedOn,
      finalPos: move.finalPos,
      hop: move.hop,
      at: new Date().toISOString(),
    });

    if (move.won) {
      board.finished = true;
      board.winnerId = actorId;
      await gameMatchService.finishMatch(matchId, {
        winnerId: actorId,
        result: { engine: 'snakes_ladders', positions: { ...board.positions }, moves: board.history.length },
      });
    } else {
      board.turnIndex = (board.turnIndex + 1) % board.playerIds.length;
    }

    return _publicState(board);
  }

  return { getState, rollDice };
}

module.exports = { createSnakesLaddersService };
