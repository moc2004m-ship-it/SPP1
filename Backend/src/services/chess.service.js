'use strict';
// Stage 22 — Chess rules engine (match layer).
//
// The real, server-side per-game rules engine game-match.service.js's
// file header documented as still owed for Chess. It is the ONLY code
// path that ever calls gameMatchService.finishMatch() for a chess match,
// and it only ever does so once a real, server-side terminal condition
// has actually happened: checkmate, resignation, an accepted draw offer,
// stalemate, a real clock running out, or (rare, automatic) insufficient
// material — never a client-declared winner.
//
// Every move is re-validated here from scratch against
// ../domain/chess.board.js's own legal-move generator — a client only
// ever supplies {from, to, promotion}; it can never supply "this move is
// legal", whether it's check, or the resulting board. The move is looked
// up inside the actual legal-move list for that square before it is ever
// applied, so an illegal move (including "technically that piece could
// jump there" moves that would leave the mover's own king in check) is
// always a 400, never silently accepted.
//
// A real per-player countdown clock is server-authoritative, same
// "`now` is an optional constructor dependency purely so tests can drive
// a fake clock deterministically" pattern as carrom.service.js/
// quiz.service.js. If the player on the clock lets it run out — even
// without making any request at all — the NEXT read of the match
// (getState or any action) notices server-side and finishes the match as
// a timeout loss; a client can never stall a match indefinitely.
//
// State lives in an in-memory Map keyed by matchId, same
// reconnect/persistence posture as every other Stage 19/20/21 engine —
// getState() always returns the same current state, so a client that
// reconnects mid-game (dropped connection, app restart, ...) sees
// exactly where the game actually is, never a fresh board.

const {
  createInitialState,
  squareToIndex,
  indexToSquare,
  generateLegalMovesFrom,
  generateAllLegalMoves,
  applyMove,
  inCheck,
  isCheckmate,
  isStalemate,
  isInsufficientMaterial,
  opponent,
} = require('../domain/chess.board');

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}
function conflict(message) {
  return Object.assign(new Error(message), { status: 409 });
}
function forbidden(message) {
  return Object.assign(new Error(message), { status: 403 });
}

const DEFAULT_CLOCK_MS = 5 * 60 * 1000; // 5 minutes per side

function createChessService({ gameMatchService, now, clockMs }) {
  const nowFn = now || Date.now;
  const clockDuration = clockMs || DEFAULT_CLOCK_MS;
  const matches = new Map(); // matchId -> chess match state

  async function _loadActiveMatch(actorId, matchId) {
    const match = await gameMatchService.getMatch(actorId, matchId);
    if (match.gameId !== 'chess') throw badRequest('this match is not a Chess match');
    return match;
  }

  function _getOrInitState(match) {
    let state = matches.get(match.id);
    if (!state) {
      if (match.playerIds.length !== 2) {
        throw badRequest('chess requires exactly 2 players');
      }
      const [white, black] = match.playerIds;
      state = {
        matchId: match.id,
        white,
        black,
        chess: createInitialState(),
        clocks: { [white]: clockDuration, [black]: clockDuration },
        turnStartedAt: nowFn(),
        history: [],
        finished: false,
        winnerId: null,
        result: null,
        drawOfferBy: null,
      };
      matches.set(match.id, state);
    }
    return state;
  }

  function _colorOf(state, playerId) {
    if (playerId === state.white) return 'w';
    if (playerId === state.black) return 'b';
    return null;
  }

  function _playerOf(state, color) {
    return color === 'w' ? state.white : state.black;
  }

  function _currentActor(state) {
    return _playerOf(state, state.chess.turn);
  }

  async function _finish(state, { winnerId, result }) {
    state.finished = true;
    state.winnerId = winnerId;
    state.result = result;
    await gameMatchService.finishMatch(state.matchId, {
      winnerId,
      result: { engine: 'chess', reason: result, moveCount: state.history.length },
    });
  }

  // Catches a clock that ran out even if nobody has moved since — the
  // same "advance past anything already expired before reading/mutating
  // state" pattern carrom.service.js#_tick and quiz.service.js#_tick use
  // for their own server-authoritative clocks.
  async function _tick(state) {
    if (state.finished) return;
    const actorId = _currentActor(state);
    const elapsed = nowFn() - state.turnStartedAt;
    const remaining = state.clocks[actorId] - elapsed;
    if (remaining <= 0) {
      state.clocks[actorId] = 0;
      const winnerId = _playerOf(state, opponent(state.chess.turn));
      await _finish(state, { winnerId, result: 'timeout' });
    }
  }

  function _publicState(state) {
    const board = state.chess.board.map((p) => (p ? { type: p.type, color: p.color } : null));
    const turnColor = state.chess.turn;
    return {
      matchId: state.matchId,
      white: state.white,
      black: state.black,
      board,
      turn: state.finished ? null : _currentActor(state),
      turnColor: state.finished ? null : turnColor,
      inCheck: state.finished ? false : inCheck(state.chess, turnColor),
      castling: { ...state.chess.castling },
      halfmove: state.chess.halfmove,
      fullmove: state.chess.fullmove,
      clocks: { ...state.clocks },
      timeRemainingMs: state.finished ? null : Math.max(0, state.clocks[_currentActor(state)] - (nowFn() - state.turnStartedAt)),
      drawOfferBy: state.drawOfferBy,
      history: state.history.slice(),
      finished: state.finished,
      winnerId: state.winnerId,
      result: state.result,
    };
  }

  async function getState(actorId, matchId) {
    const match = await _loadActiveMatch(actorId, matchId);
    if (match.state === 'lobby') {
      return { matchId: match.id, playerIds: match.playerIds, board: null, turn: null, finished: false, winnerId: null, started: false };
    }
    const state = _getOrInitState(match);
    await _tick(state);
    return { ..._publicState(state), started: true };
  }

  async function move(actorId, matchId, { from, to, promotion } = {}) {
    const match = await _loadActiveMatch(actorId, matchId);
    if (match.state !== 'active') throw conflict(`match is ${match.state}, not active -- start it first`);
    const state = _getOrInitState(match);
    await _tick(state);
    if (state.finished) throw conflict('this game has already finished');

    const color = _colorOf(state, actorId);
    if (!color) throw forbidden('you are not a player in this match');
    if (color !== state.chess.turn) throw conflict(`it is not your turn (waiting on ${_currentActor(state)})`);

    const fromIdx = squareToIndex(from);
    const toIdx = squareToIndex(to);
    if (fromIdx === null || toIdx === null) throw badRequest('from/to must be valid squares like "e2"/"e4"');
    const piece = state.chess.board[fromIdx];
    if (!piece || piece.color !== color) throw badRequest('there is no piece of yours on that square');

    const legalMoves = generateLegalMovesFrom(state.chess, fromIdx);
    const chosen = legalMoves.find((m) => m.to === toIdx && (!m.promotion || m.promotion === (promotion || 'q')));
    if (!chosen) throw badRequest(`illegal move: ${from}${to}`);

    // Elapsed time is spent on making this move, THEN the clock resets
    // for the opponent's turn.
    const elapsed = nowFn() - state.turnStartedAt;
    state.clocks[actorId] = Math.max(0, state.clocks[actorId] - elapsed);

    state.chess = applyMove(state.chess, chosen);
    state.turnStartedAt = nowFn();
    state.drawOfferBy = null; // any move implicitly declines a pending draw offer

    const nextColor = state.chess.turn;
    const givesCheck = inCheck(state.chess, nextColor);
    const mate = givesCheck && isCheckmate(state.chess, nextColor);
    const stale = !givesCheck && isStalemate(state.chess, nextColor);
    const deadPosition = isInsufficientMaterial(state.chess.board);

    state.history.push({
      by: actorId,
      from,
      to,
      piece: chosen.piece,
      capture: !!chosen.capture,
      enPassant: !!chosen.enPassant,
      castle: chosen.castle || null,
      promotion: chosen.promotion || null,
      check: givesCheck,
      checkmate: mate,
      at: new Date(nowFn()).toISOString(),
    });

    if (mate) {
      await _finish(state, { winnerId: actorId, result: 'checkmate' });
    } else if (stale) {
      await _finish(state, { winnerId: null, result: 'stalemate' });
    } else if (deadPosition) {
      await _finish(state, { winnerId: null, result: 'insufficient_material' });
    }

    return _publicState(state);
  }

  async function resign(actorId, matchId) {
    const match = await _loadActiveMatch(actorId, matchId);
    if (match.state !== 'active') throw conflict(`match is ${match.state}, not active`);
    const state = _getOrInitState(match);
    await _tick(state);
    if (state.finished) throw conflict('this game has already finished');
    const color = _colorOf(state, actorId);
    if (!color) throw forbidden('you are not a player in this match');
    const winnerId = _playerOf(state, opponent(color));
    await _finish(state, { winnerId, result: 'resignation' });
    return _publicState(state);
  }

  async function offerDraw(actorId, matchId) {
    const match = await _loadActiveMatch(actorId, matchId);
    if (match.state !== 'active') throw conflict(`match is ${match.state}, not active`);
    const state = _getOrInitState(match);
    await _tick(state);
    if (state.finished) throw conflict('this game has already finished');
    const color = _colorOf(state, actorId);
    if (!color) throw forbidden('you are not a player in this match');
    state.drawOfferBy = actorId;
    return _publicState(state);
  }

  // The opponent explicitly accepts or declines a pending draw offer --
  // a draw is NEVER recorded just because one side asked for it; both
  // players' real, server-received consent is required.
  async function respondDraw(actorId, matchId, accept) {
    const match = await _loadActiveMatch(actorId, matchId);
    if (match.state !== 'active') throw conflict(`match is ${match.state}, not active`);
    const state = _getOrInitState(match);
    await _tick(state);
    if (state.finished) throw conflict('this game has already finished');
    const color = _colorOf(state, actorId);
    if (!color) throw forbidden('you are not a player in this match');
    if (!state.drawOfferBy) throw conflict('there is no pending draw offer');
    if (state.drawOfferBy === actorId) throw conflict('you cannot respond to your own draw offer');
    if (accept) {
      await _finish(state, { winnerId: null, result: 'draw_agreement' });
    } else {
      state.drawOfferBy = null;
    }
    return _publicState(state);
  }

  return { getState, move, resign, offerDraw, respondDraw };
}

module.exports = { createChessService };
