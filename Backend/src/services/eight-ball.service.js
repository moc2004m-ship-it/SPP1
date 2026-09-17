'use strict';
// Stage 22 — Eight Ball rules engine (match layer).
//
// The real, server-side per-game rules engine game-match.service.js's
// file header documented as still owed for Eight Ball. It is the ONLY
// code path that ever calls gameMatchService.finishMatch() for an eight
// ball match, and it only ever does so once a real, server-side
// terminal condition has actually happened: the 8-ball legally potted
// by whichever player has actually, server-side, cleared their own
// group first (a win), or potted early/out of turn order relative to
// that (an automatic loss for whoever potted it) -- never a
// client-declared winner or client-declared score.
//
// Every strike is a single atomic server action (strike()): the outcome
// is rolled server-side via node:crypto and resolved through the fixed,
// documented bands in ../domain/eight-ball.board.js -- a client only
// ever calls strike(); it can never supply which ball was potted,
// whether it was a foul, or its own group. `random`/`now` are optional
// constructor dependencies, same "tests script a deterministic sequence,
// every real caller uses the real crypto/clock" pattern as
// carrom.service.js.
//
// Groups (solids/stripes) are not preassigned -- exactly like real
// 8-ball, they are only fixed, server-side, the first time either player
// actually, legally pots a non-8-ball shot. Before that, either player
// potting is "open"; the table only splits into "your group" / "their
// group" at that real moment, not before.

const crypto = require('node:crypto');
const { BALLS_PER_GROUP, determineOutcome } = require('../domain/eight-ball.board');

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}
function conflict(message) {
  return Object.assign(new Error(message), { status: 409 });
}

function defaultRoll() {
  return crypto.randomInt(1, 101);
}

const DEFAULT_TURN_DURATION_MS = 20000;

function createEightBallService({ gameMatchService, random, now, turnDurationMs }) {
  const rollFn = random || defaultRoll;
  const nowFn = now || Date.now;
  const duration = turnDurationMs || DEFAULT_TURN_DURATION_MS;
  const matches = new Map(); // matchId -> eight-ball state

  async function _loadActiveMatch(actorId, matchId) {
    const match = await gameMatchService.getMatch(actorId, matchId);
    if (match.gameId !== 'eight_ball') throw badRequest('this match is not an Eight Ball match');
    return match;
  }

  function _getOrInitState(match) {
    let state = matches.get(match.id);
    if (!state) {
      if (match.playerIds.length !== 2) throw badRequest('eight ball requires exactly 2 players');
      state = {
        matchId: match.id,
        playerIds: match.playerIds.slice(),
        groups: { [match.playerIds[0]]: null, [match.playerIds[1]]: null },
        groupsAssigned: false,
        remaining: { solids: BALLS_PER_GROUP, stripes: BALLS_PER_GROUP },
        scores: Object.fromEntries(match.playerIds.map((p) => [p, 0])),
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

  function _currentActor(state) { return state.playerIds[state.turnIndex]; }
  function _otherPlayer(state, actorId) { return state.playerIds.find((p) => p !== actorId); }

  function _passTurn(state) {
    state.turnIndex = (state.turnIndex + 1) % state.playerIds.length;
    state.turnStartedAt = nowFn();
  }
  function _keepTurn(state) { state.turnStartedAt = nowFn(); }

  // First legal pot of the match assigns groups for real: the shooter
  // gets whichever group still has balls, the opponent gets the other.
  // (Both groups are full and symmetric at this point, so which literal
  // label -- "solids" vs "stripes" -- the shooter gets is arbitrary; the
  // real rule this models is that it's decided BY the first legal pot,
  // never before.)
  function _assignGroupsIfNeeded(state, actorId) {
    if (state.groupsAssigned) return;
    state.groups[actorId] = 'solids';
    state.groups[_otherPlayer(state, actorId)] = 'stripes';
    state.groupsAssigned = true;
  }

  async function _finish(state, winnerId, reason) {
    state.finished = true;
    state.winnerId = winnerId;
    await gameMatchService.finishMatch(state.matchId, {
      winnerId,
      result: { engine: 'eight_ball', reason, scores: { ...state.scores }, groups: { ...state.groups } },
    });
  }

  async function _tick(state) {
    while (!state.finished && nowFn() - state.turnStartedAt >= duration) {
      const actorId = _currentActor(state);
      state.history.push({ playerId: actorId, outcome: 'timeout', at: new Date(nowFn()).toISOString() });
      _passTurn(state);
    }
  }

  function _publicState(state) {
    return {
      matchId: state.matchId,
      playerIds: state.playerIds,
      groups: { ...state.groups },
      groupsAssigned: state.groupsAssigned,
      remaining: { ...state.remaining },
      scores: { ...state.scores },
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
      return { matchId: match.id, playerIds: match.playerIds, groups: null, remaining: null, scores: null, turn: null, finished: false, winnerId: null, started: false };
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
    const entry = { playerId: actorId, outcome, roll, at: new Date(nowFn()).toISOString() };

    if (outcome === 'foul') {
      state.history.push(entry);
      _passTurn(state);
    } else if (outcome === 'miss') {
      state.history.push(entry);
      _passTurn(state);
    } else if (outcome === 'pot') {
      _assignGroupsIfNeeded(state, actorId);
      const group = state.groups[actorId];
      if (state.remaining[group] === 0) {
        // Own group already cleared -- a 'pot' band with nothing left of
        // yours to legally pot falls back to the real next situation: an
        // attempt on the 8-ball, same "fall back to the next-best real
        // outcome the roll actually supports" rule carrom.service.js
        // uses for its own band edge cases (never re-rolled, never a
        // wasted/invented outcome).
        return _resolveEightBallAttempt(state, actorId, entry);
      }
      state.remaining[group] -= 1;
      state.scores[actorId] += 1;
      entry.group = group;
      state.history.push(entry);
      _keepTurn(state); // legally potting your own ball earns another shot
    } else {
      // outcome === 'pot_eight'
      return _resolveEightBallAttempt(state, actorId, entry);
    }

    return _publicState(state);
  }

  async function _resolveEightBallAttempt(state, actorId, entry) {
    entry.outcome = 'pot_eight';
    const group = state.groups[actorId];
    const cleared = state.groupsAssigned && group && state.remaining[group] === 0;
    entry.legal = !!cleared;
    state.history.push(entry);
    if (cleared) {
      await _finish(state, actorId, 'legal_eight_ball_win');
    } else {
      // Potting the 8-ball before your own group is actually cleared
      // (or before groups even exist yet) is a real, immediate loss for
      // whoever pots it -- never a re-roll, never invented leniency.
      await _finish(state, _otherPlayer(state, actorId), 'early_eight_ball_loss');
    }
    return _publicState(state);
  }

  return { getState, strike };
}

module.exports = { createEightBallService };
