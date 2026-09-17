'use strict';
// Stage 22 — Domino rules engine (match layer).
//
// The real, server-side per-game rules engine game-match.service.js's
// file header documented as still owed for Domino. It is the ONLY code
// path that ever calls gameMatchService.finishMatch() for a domino
// match, and it only ever does so once a real, server-side terminal
// condition has actually happened: a player's hand server-side actually
// reaching zero tiles, or a real blocked game (boneyard empty, every
// player passes in a row with no legal move) resolved by the real
// lowest-pips tiebreak -- never a client-declared winner or
// client-declared hand.
//
// The full 28-tile set is shuffled and dealt server-side
// (node:crypto-backed Fisher-Yates); a client's hand is only ever
// visible to that client (getState returns other players' hand SIZES,
// never their tiles). Every play is re-validated here against the
// actual chain ends (../domain/domino.board.js#legalEnds/attach) before
// being applied -- a client only ever supplies {tileIndex, end}; it can
// never supply "this is legal" or the resulting chain. `shuffle`/`now`
// are optional constructor dependencies, same "tests script a
// deterministic sequence, every real caller uses the real crypto/clock"
// pattern as every other Stage 19/20/21/22 engine in this project.

const crypto = require('node:crypto');
const { createFullSet, legalEnds, hasAnyLegalMove, attach, blockedGameWinner } = require('../domain/domino.board');

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}
function conflict(message) {
  return Object.assign(new Error(message), { status: 409 });
}
function forbidden(message) {
  return Object.assign(new Error(message), { status: 403 });
}

function defaultShuffle(array) {
  // Fisher-Yates using node:crypto, never Math.random.
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const HAND_SIZE_BY_PLAYER_COUNT = { 2: 7, 3: 6, 4: 6 };

function createDominoService({ gameMatchService, shuffle, now }) {
  const shuffleFn = shuffle || defaultShuffle;
  const nowFn = now || Date.now;
  const matches = new Map(); // matchId -> domino state

  async function _loadActiveMatch(actorId, matchId) {
    const match = await gameMatchService.getMatch(actorId, matchId);
    if (match.gameId !== 'domino') throw badRequest('this match is not a Domino match');
    return match;
  }

  function _getOrInitState(match) {
    let state = matches.get(match.id);
    if (!state) {
      const playerIds = match.playerIds.slice();
      const handSize = HAND_SIZE_BY_PLAYER_COUNT[playerIds.length];
      if (!handSize) throw badRequest('domino supports 2-4 players');
      const deck = shuffleFn(createFullSet());
      const hands = {};
      let cursor = 0;
      for (const p of playerIds) {
        hands[p] = deck.slice(cursor, cursor + handSize);
        cursor += handSize;
      }
      const boneyard = deck.slice(cursor);

      // Real starting rule: whoever holds the highest double opens (and
      // must play it); if nobody holds a double, whoever holds the
      // single heaviest tile (by total pips) opens instead. Both are
      // decided from the actual dealt hands, never chosen arbitrarily.
      let starterIdx = 0;
      let best = { isDouble: false, pips: -1 };
      playerIds.forEach((p, idx) => {
        for (const tile of hands[p]) {
          const d = tile[0] === tile[1];
          const pips = tile[0] + tile[1];
          const better = d && !best.isDouble ? true
            : d === best.isDouble && pips > best.pips ? true
            : false;
          if (better) { best = { isDouble: d, pips }; starterIdx = idx; }
        }
      });

      state = {
        matchId: match.id,
        playerIds,
        hands,
        boneyard,
        chain: { left: null, right: null },
        playedCount: 0,
        turnIndex: starterIdx,
        passStreak: 0,
        history: [],
        finished: false,
        winnerId: null,
        result: null,
      };
      matches.set(match.id, state);
    }
    return state;
  }

  function _currentActor(state) { return state.playerIds[state.turnIndex]; }
  function _passTurn(state) { state.turnIndex = (state.turnIndex + 1) % state.playerIds.length; }

  async function _finish(state, winnerId, reason, extra) {
    state.finished = true;
    state.winnerId = winnerId;
    state.result = reason;
    await gameMatchService.finishMatch(state.matchId, {
      winnerId,
      result: { engine: 'domino', reason, ...extra },
    });
  }

  function _publicState(state, viewerId) {
    return {
      matchId: state.matchId,
      playerIds: state.playerIds,
      hand: state.hands[viewerId] ? state.hands[viewerId].slice() : [],
      handSizes: Object.fromEntries(state.playerIds.map((p) => [p, state.hands[p].length])),
      boneyardCount: state.boneyard.length,
      chain: { ...state.chain },
      turn: state.finished ? null : _currentActor(state),
      history: state.history.slice(),
      finished: state.finished,
      winnerId: state.winnerId,
      result: state.result,
    };
  }

  async function getState(actorId, matchId) {
    const match = await _loadActiveMatch(actorId, matchId);
    if (match.state === 'lobby') {
      return { matchId: match.id, playerIds: match.playerIds, hand: [], chain: { left: null, right: null }, turn: null, finished: false, winnerId: null, started: false };
    }
    const state = _getOrInitState(match);
    return { ..._publicState(state, actorId), started: true };
  }

  async function playTile(actorId, matchId, { tileIndex, end } = {}) {
    const match = await _loadActiveMatch(actorId, matchId);
    if (match.state !== 'active') throw conflict(`match is ${match.state}, not active -- start it first`);
    const state = _getOrInitState(match);
    if (state.finished) throw conflict('this game has already finished');
    if (!state.playerIds.includes(actorId)) throw forbidden('you are not a player in this match');
    if (_currentActor(state) !== actorId) throw conflict(`it is not your turn (waiting on ${_currentActor(state)})`);

    const hand = state.hands[actorId];
    if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= hand.length) {
      throw badRequest('tileIndex must refer to a tile in your hand');
    }
    const tile = hand[tileIndex];
    const emptyChain = state.chain.left === null;
    const ends = legalEnds(tile, state.chain);
    const chosenEnd = emptyChain ? 'left' : end;
    if (emptyChain) {
      // Opening move -- no end to choose, any tile is legal.
    } else if (chosenEnd !== 'left' && chosenEnd !== 'right') {
      throw badRequest('end must be "left" or "right"');
    } else if (!ends[chosenEnd]) {
      throw badRequest(`tile [${tile[0]},${tile[1]}] does not match the ${chosenEnd} end (${state.chain[chosenEnd]})`);
    }

    state.chain = attach(tile, chosenEnd, state.chain);
    hand.splice(tileIndex, 1);
    state.playedCount += 1;
    state.passStreak = 0;
    state.history.push({ playerId: actorId, action: 'play', tile, end: emptyChain ? null : chosenEnd, at: new Date(nowFn()).toISOString() });

    if (hand.length === 0) {
      await _finish(state, actorId, 'hand_empty', { handSizes: Object.fromEntries(state.playerIds.map((p) => [p, state.hands[p].length])) });
      return _publicState(state, actorId);
    }
    _passTurn(state);
    return _publicState(state, actorId);
  }

  async function draw(actorId, matchId) {
    const match = await _loadActiveMatch(actorId, matchId);
    if (match.state !== 'active') throw conflict(`match is ${match.state}, not active`);
    const state = _getOrInitState(match);
    if (state.finished) throw conflict('this game has already finished');
    if (_currentActor(state) !== actorId) throw conflict(`it is not your turn (waiting on ${_currentActor(state)})`);
    const hand = state.hands[actorId];
    if (hasAnyLegalMove(hand, state.chain)) {
      throw conflict('you have a legal move -- you must play a tile, not draw');
    }
    if (state.boneyard.length === 0) {
      throw conflict('the boneyard is empty -- you must pass, not draw');
    }
    const tile = state.boneyard.pop();
    hand.push(tile);
    state.history.push({ playerId: actorId, action: 'draw', at: new Date(nowFn()).toISOString() });
    return _publicState(state, actorId);
  }

  async function pass(actorId, matchId) {
    const match = await _loadActiveMatch(actorId, matchId);
    if (match.state !== 'active') throw conflict(`match is ${match.state}, not active`);
    const state = _getOrInitState(match);
    if (state.finished) throw conflict('this game has already finished');
    if (_currentActor(state) !== actorId) throw conflict(`it is not your turn (waiting on ${_currentActor(state)})`);
    const hand = state.hands[actorId];
    if (hasAnyLegalMove(hand, state.chain)) throw conflict('you have a legal move -- you must play it, not pass');
    if (state.boneyard.length > 0) throw conflict('the boneyard is not empty -- you must draw, not pass');

    state.history.push({ playerId: actorId, action: 'pass', at: new Date(nowFn()).toISOString() });
    state.passStreak += 1;

    if (state.passStreak >= state.playerIds.length) {
      const { winnerId, totals } = blockedGameWinner(state.hands);
      await _finish(state, winnerId, 'blocked_game', { pipTotals: totals });
      return _publicState(state, actorId);
    }
    _passTurn(state);
    return _publicState(state, actorId);
  }

  return { getState, playTile, draw, pass };
}

module.exports = { createDominoService };
