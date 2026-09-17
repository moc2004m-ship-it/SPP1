'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryGameMatchRepository } = require('../src/database/repositories/game-match.repository');
const { createGameMatchService } = require('../src/services/game-match.service');
const { createCarromService } = require('../src/services/carrom.service');
const { START_REGULAR_PIECES, POINTS } = require('../src/domain/carrom-board');

// A controllable fake clock so tests can assert exact timeout behaviour
// without sleeping in real time. Production wiring (src/index.js) never
// passes `now`; it always uses the real Date.now.
function fakeClock(start) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

// A scripted roll-in-[1,100]: returns the next value from `sequence` on
// each call, repeating the last value forever once exhausted.
// Production wiring never passes this; it always uses the real
// crypto-backed default. Rolls are chosen from the documented bands in
// ../src/domain/carrom-board.js: foul<=15, miss<=40, pocket<=85, queen>85.
function scriptedRoll(sequence) {
  let i = 0;
  return () => sequence[Math.min(i++, sequence.length - 1)];
}
const FOUL = 10;
const MISS = 30;
const POCKET = 60;
const QUEEN = 95;

async function setup({ roll, now, turnDurationMs, playerIds } = {}) {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const carrom = createCarromService({ gameMatchService, random: roll, now, turnDurationMs });
  const match = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'carrom', startedBy: 'usr_1', playerIds: playerIds || ['usr_1', 'usr_2'] });
  await gameMatchService.startMatch('usr_1', match.id);
  return { gameMatches, gameMatchService, carrom, match };
}

test('getState before the match is started reports started:false and no scores', async () => {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const carrom = createCarromService({ gameMatchService });
  const match = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'carrom', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });
  const state = await carrom.getState('usr_1', match.id);
  assert.equal(state.started, false);
  assert.equal(state.scores, null);
});

test('rejects a wrong-game match (e.g. ludo) with 400', async () => {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const carrom = createCarromService({ gameMatchService });
  const ludoMatch = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'ludo', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });
  await assert.rejects(() => carrom.getState('usr_1', ludoMatch.id), (e) => e.status === 400);
});

test('only a participant may view or strike', async () => {
  const { carrom, match } = await setup({ roll: scriptedRoll([POCKET]) });
  await assert.rejects(() => carrom.getState('usr_intruder', match.id), (e) => e.status === 403);
  await assert.rejects(() => carrom.strike('usr_intruder', match.id), (e) => e.status === 403);
});

test('only the player whose turn it is may strike', async () => {
  const { carrom, match } = await setup({ roll: scriptedRoll([MISS]) });
  await assert.rejects(() => carrom.strike('usr_2', match.id), (e) => e.status === 409 && /not your turn/.test(e.message));
});

test('a real pocket scores +10, removes one regular piece, and grants the same player another strike', async () => {
  const { carrom, match } = await setup({ roll: scriptedRoll([POCKET]) });
  const state = await carrom.strike('usr_1', match.id);
  assert.equal(state.scores['usr_1'], POINTS.REGULAR);
  assert.equal(state.regularPiecesRemaining, START_REGULAR_PIECES - 1);
  assert.equal(state.turn, 'usr_1', 'pocketing grants another strike to the same player');
  assert.equal(state.history[0].outcome, 'pocket');
  assert.equal(state.history[0].scoreDelta, POINTS.REGULAR);
});

test('a miss scores nothing and passes the turn', async () => {
  const { carrom, match } = await setup({ roll: scriptedRoll([MISS]) });
  const state = await carrom.strike('usr_1', match.id);
  assert.equal(state.scores['usr_1'], 0);
  assert.equal(state.turn, 'usr_2');
  assert.equal(state.history[0].outcome, 'miss');
});

test('a foul deducts the real penalty (never going below 0) and passes the turn', async () => {
  const { carrom, match } = await setup({ roll: scriptedRoll([FOUL]) });
  const state = await carrom.strike('usr_1', match.id);
  assert.equal(state.scores['usr_1'], 0, 'penalty is clamped at 0, not driven negative');
  assert.equal(state.turn, 'usr_2');
  assert.equal(state.history[0].outcome, 'foul');
  // A zero penalty is stored server-side as -penalty, i.e. -0 (JS unary
  // negation of 0) -- a real, harmless zero, not a bug; compare by value.
  assert.equal(Math.abs(state.history[0].scoreDelta), 0);

  // Once the player has real points on the board, a foul actually
  // deducts them for real.
  const { carrom: carrom2, match: match2 } = await setup({ roll: scriptedRoll([POCKET, FOUL]) });
  let s = await carrom2.strike('usr_1', match2.id); // +10, same player strikes again
  assert.equal(s.scores['usr_1'], 10);
  s = await carrom2.strike('usr_1', match2.id); // foul -> -5
  assert.equal(s.scores['usr_1'], 5);
  assert.equal(s.history[1].scoreDelta, -5);
});

test('queen: pocketing the queen does not score by itself and requires an immediate cover; covering it on the very next strike awards the real +50 bonus on top of the regular +10', async () => {
  const { carrom, match } = await setup({ roll: scriptedRoll([QUEEN, POCKET]) });
  let state = await carrom.strike('usr_1', match.id); // queen pocketed
  assert.equal(state.queenPocketed, true);
  assert.equal(state.pendingQueenCoverPlayer, 'usr_1');
  assert.equal(state.scores['usr_1'], 0, 'the queen itself scores nothing until covered');
  assert.equal(state.turn, 'usr_1', 'must immediately attempt the cover');

  state = await carrom.strike('usr_1', match.id); // covers it with a pocket
  assert.equal(state.queenCovered, true);
  assert.equal(state.pendingQueenCoverPlayer, null);
  assert.equal(state.scores['usr_1'], POINTS.REGULAR + POINTS.QUEEN_BONUS);
  assert.equal(state.history[1].coveredQueen, true);
});

test('queen: an uncovered queen reverts back into play if the cover attempt is a miss or foul, matching the real rule that an uncovered queen never counts', async () => {
  const { carrom, match } = await setup({ roll: scriptedRoll([QUEEN, MISS]) });
  let state = await carrom.strike('usr_1', match.id); // queen pocketed, pending cover
  assert.equal(state.queenPocketed, true);

  state = await carrom.strike('usr_1', match.id); // cover attempt misses
  assert.equal(state.queenPocketed, false, 'reverted -- queen goes back into play');
  assert.equal(state.pendingQueenCoverPlayer, null);
  assert.equal(state.queenCovered, false);
  assert.equal(state.turn, 'usr_2', 'a miss still passes the turn as normal');
});

test('a queen band that fires while the queen is already pocketed falls back to a real pocket outcome instead of being wasted or invented', async () => {
  const { carrom, match } = await setup({ roll: scriptedRoll([QUEEN, QUEEN]) });
  let state = await carrom.strike('usr_1', match.id); // queen pocketed
  assert.equal(state.queenPocketed, true);
  state = await carrom.strike('usr_1', match.id); // second 'queen' band, but queen already pocketed -> treated as pocket
  assert.equal(state.history[1].outcome, 'pocket');
  assert.equal(state.regularPiecesRemaining, START_REGULAR_PIECES - 1);
});

test('timeout: if the shot clock runs out without a strike, the turn is auto-forfeited server-side and recorded in history', async () => {
  const clock = fakeClock(1000);
  const { carrom, match } = await setup({ roll: scriptedRoll([MISS]), now: clock, turnDurationMs: 5000 });
  await carrom.getState('usr_1', match.id); // initializes turnStartedAt at t=1000
  clock.advance(5000);
  const state = await carrom.getState('usr_1', match.id); // reading state alone must catch up the expired clock
  assert.equal(state.turn, 'usr_2');
  assert.equal(state.history[0].outcome, 'timeout');
});

test('timeout: a pending queen cover that times out reverts the queen, exactly like a real miss would', async () => {
  const clock = fakeClock(1000);
  const { carrom, match } = await setup({ roll: scriptedRoll([QUEEN]), now: clock, turnDurationMs: 5000 });
  let state = await carrom.strike('usr_1', match.id); // queen pocketed, pending cover
  assert.equal(state.queenPocketed, true);
  clock.advance(5000);
  state = await carrom.getState('usr_1', match.id);
  assert.equal(state.queenPocketed, false, 'reverted by the timeout');
  assert.equal(state.turn, 'usr_2');
  assert.equal(state.history[state.history.length - 1].outcome, 'timeout');
});

test('striking after the game has already finished is rejected, not silently accepted', async () => {
  // Drive a tiny match to a real finish by shrinking the board via a
  // dedicated tiny-board style script is not available (START_REGULAR_PIECES
  // is fixed), so instead finish it for real with all-pocket rolls.
  const rolls = new Array(START_REGULAR_PIECES).fill(POCKET);
  const { carrom, match } = await setup({ roll: scriptedRoll(rolls) });
  let state;
  for (let i = 0; i < START_REGULAR_PIECES; i += 1) {
    state = await carrom.strike('usr_1', match.id);
  }
  assert.equal(state.finished, true);
  assert.equal(state.regularPiecesRemaining, 0);
  await assert.rejects(() => carrom.strike('usr_2', match.id), (e) => e.status === 409);
});

test('a full match to a real, server-detected win: highest real score wins once every regular piece is off the board', async () => {
  const rolls = new Array(START_REGULAR_PIECES).fill(POCKET);
  const { gameMatches, carrom, match } = await setup({ roll: scriptedRoll(rolls), playerIds: ['usr_1', 'usr_2'] });
  let state;
  for (let i = 0; i < START_REGULAR_PIECES; i += 1) {
    state = await carrom.strike('usr_1', match.id);
  }
  assert.equal(state.finished, true, 'match must actually finish within a bounded, real sequence of strikes');
  assert.equal(state.regularPiecesRemaining, 0);
  assert.equal(state.winnerId, 'usr_1', 'the only player with real points wins');
  assert.equal(state.scores['usr_1'], START_REGULAR_PIECES * POINTS.REGULAR);

  const finishedMatch = await gameMatches.findById(match.id);
  assert.equal(finishedMatch.state, 'finished');
  assert.equal(finishedMatch.winnerId, 'usr_1');
  assert.equal(finishedMatch.resultSource, 'server');
  assert.equal(finishedMatch.result.engine, 'carrom');
  assert.equal(finishedMatch.result.draw, false);
});

test('a real tie (equal final scores) is reported as a real draw: no winnerId, draw:true in the match record', async () => {
  // Two players alternate pockets via misses interleaved so each nets the
  // exact same score by the time the board is cleared. With
  // START_REGULAR_PIECES=18 (even), alternating pocket/miss/pocket/miss
  // so each player pockets 9 gives an equal 90-90 finish.
  const rolls = [];
  for (let i = 0; i < START_REGULAR_PIECES; i += 1) rolls.push(POCKET, MISS); // pocket keeps turn, then a deliberate miss hands it to the other player
  const { gameMatches, carrom, match } = await setup({ roll: scriptedRoll(rolls), playerIds: ['usr_1', 'usr_2'] });

  let state;
  let actorIdx = 0;
  const players = ['usr_1', 'usr_2'];
  let pieces = START_REGULAR_PIECES;
  while (pieces > 0) {
    state = await carrom.strike(players[actorIdx], match.id); // pocket: +10, keeps turn
    pieces -= 1;
    if (pieces === 0) break;
    state = await carrom.strike(players[actorIdx], match.id); // miss: passes turn
    actorIdx = 1 - actorIdx;
  }
  assert.equal(state.finished, true);
  assert.equal(state.scores['usr_1'], state.scores['usr_2'], 'both players must have pocketed the same real number of pieces');
  assert.equal(state.winnerId, null, 'a real tie has no single winner');

  const finishedMatch = await gameMatches.findById(match.id);
  assert.equal(finishedMatch.result.draw, true);
  assert.equal(finishedMatch.winnerId, null);
});

test('reconnect: calling getState again mid-match returns the exact same scores/turn/history (state lives server-side, not lost on disconnect)', async () => {
  const { carrom, match } = await setup({ roll: scriptedRoll([POCKET, MISS]) });
  await carrom.strike('usr_1', match.id);
  await carrom.strike('usr_1', match.id);
  const afterTwoStrikes = await carrom.getState('usr_1', match.id);

  const reconnectView1 = await carrom.getState('usr_1', match.id);
  const reconnectView2 = await carrom.getState('usr_2', match.id);
  assert.deepEqual(reconnectView1.scores, afterTwoStrikes.scores);
  assert.deepEqual(reconnectView1.history, afterTwoStrikes.history);
  assert.equal(reconnectView1.turn, afterTwoStrikes.turn);
  assert.deepEqual(reconnectView2.scores, afterTwoStrikes.scores);
});
