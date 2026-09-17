'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryGameMatchRepository } = require('../src/database/repositories/game-match.repository');
const { createGameMatchService } = require('../src/services/game-match.service');
const { createSnakesLaddersService } = require('../src/services/snakes-ladders.service');
const { applyMove, BOARD_SIZE } = require('../src/domain/snakes-ladders.board');

// A scripted die: returns the next value from `sequence` on each call,
// repeating the last value forever once exhausted. Lets a test drive the
// engine through an exact, known sequence of rolls instead of depending
// on real randomness -- production wiring (src/index.js) never passes
// this; it always uses the real crypto-backed default.
function scriptedRoll(sequence) {
  let i = 0;
  return () => sequence[Math.min(i++, sequence.length - 1)];
}

async function setup({ roll } = {}) {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const snakesLadders = createSnakesLaddersService({ gameMatchService, random: roll });
  const match = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'snakes_ladders', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });
  await gameMatchService.startMatch('usr_1', match.id);
  return { gameMatches, gameMatchService, snakesLadders, match };
}

test('getState before the match is started reports started:false and no positions', async () => {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const snakesLadders = createSnakesLaddersService({ gameMatchService });
  const match = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'snakes_ladders', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });

  const state = await snakesLadders.getState('usr_1', match.id);
  assert.equal(state.started, false);
  assert.equal(state.positions, null);
});

test('rollDice: only the player whose turn it is may roll', async () => {
  const { snakesLadders, match } = await setup({ roll: scriptedRoll([3]) });
  await assert.rejects(() => snakesLadders.rollDice('usr_2', match.id), (e) => e.status === 409 && /not your turn/.test(e.message));
  const state = await snakesLadders.rollDice('usr_1', match.id);
  assert.equal(state.turn, 'usr_2');
});

test('rollDice: only a participant of the match may act on it or view it', async () => {
  const { snakesLadders, match } = await setup({ roll: scriptedRoll([3]) });
  await assert.rejects(() => snakesLadders.rollDice('usr_intruder', match.id), (e) => e.status === 403);
  await assert.rejects(() => snakesLadders.getState('usr_intruder', match.id), (e) => e.status === 403);
});

test('rollDice: the die and the resulting position are computed server-side and match the pure board rules exactly', async () => {
  const { snakesLadders, match } = await setup({ roll: scriptedRoll([1]) }); // 1 -> square 1 -> ladder to 38
  const state = await snakesLadders.rollDice('usr_1', match.id);
  const expected = applyMove(0, 1);
  assert.equal(state.positions['usr_1'], expected.finalPos);
  assert.equal(state.history[0].hop, 'ladder');
  assert.equal(state.history[0].die, 1);
});

test('rollDice: rejects a wrong-game match (e.g. ludo) with 400, never silently no-ops', async () => {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const snakesLadders = createSnakesLaddersService({ gameMatchService });
  const ludoMatch = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'ludo', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });
  await assert.rejects(() => snakesLadders.getState('usr_1', ludoMatch.id), (e) => e.status === 400);
});

test('rollDice: cannot roll while the match is still in lobby (not started)', async () => {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const snakesLadders = createSnakesLaddersService({ gameMatchService });
  const match = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'snakes_ladders', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });
  await assert.rejects(() => snakesLadders.rollDice('usr_1', match.id), (e) => e.status === 409);
});

test('turn order rotates through every player in playerIds order', async () => {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const snakesLadders = createSnakesLaddersService({ gameMatchService, random: scriptedRoll([2]) });
  const match = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'snakes_ladders', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2', 'usr_3'] });
  await gameMatchService.startMatch('usr_1', match.id);

  let state = await snakesLadders.rollDice('usr_1', match.id);
  assert.equal(state.turn, 'usr_2');
  state = await snakesLadders.rollDice('usr_2', match.id);
  assert.equal(state.turn, 'usr_3');
  state = await snakesLadders.rollDice('usr_3', match.id);
  assert.equal(state.turn, 'usr_1');
});

// A concrete, verified-by-simulation sequence of dice (see the board
// rules module) that walks usr_1 from square 0 to exactly square 100 in
// 13 of its own rolls, interleaved with usr_2's harmless filler rolls
// (die=2 every time, which the same simulation confirms only reaches
// square 14 -- nowhere near winning first). Every value here still flows
// through the real applyMove()/rollDice() code path -- this only pins
// *which* die values the scripted roller hands out, not the engine's own
// win/turn/ladder/snake logic, which is exercised for real.
const WINNING_SEQUENCE = [6, 2, 6, 2, 6, 2, 6, 2, 6, 2, 6, 2, 6, 2, 6, 2, 6, 2, 6, 2, 6, 2, 6, 2, 3];

test('a full game to a real, server-detected win: landing exactly on square 100 finishes the match server-side with the roller as winner', async () => {
  const { gameMatches, snakesLadders, match } = await setup({ roll: scriptedRoll(WINNING_SEQUENCE) });

  let state;
  let turns = 0;
  const players = ['usr_1', 'usr_2'];
  // Drive real gameplay until someone actually wins, capped generously so
  // a bug that never wins fails loudly instead of hanging.
  while (turns < 200) {
    const actor = players[turns % 2];
    state = await snakesLadders.rollDice(actor, match.id);
    turns += 1;
    if (state.finished) break;
  }

  assert.equal(state.finished, true, 'game must actually finish within a bounded number of real rolls');
  assert.ok(state.winnerId, 'a real winner must be recorded');
  assert.equal(state.positions[state.winnerId], BOARD_SIZE);

  // The win must be reflected in the real match record via
  // gameMatchService.finishMatch(), server-authoritative, not just in the
  // engine's own local state.
  const finishedMatch = await gameMatches.findById(match.id);
  assert.equal(finishedMatch.state, 'finished');
  assert.equal(finishedMatch.winnerId, state.winnerId);
  assert.equal(finishedMatch.resultSource, 'server');
  assert.equal(finishedMatch.result.engine, 'snakes_ladders');
});

test('rolling after the game has already finished is rejected, not silently accepted', async () => {
  const { snakesLadders, match } = await setup({ roll: scriptedRoll(WINNING_SEQUENCE) });
  let state;
  let turns = 0;
  const players = ['usr_1', 'usr_2'];
  while (turns < 200) {
    const actor = players[turns % 2];
    state = await snakesLadders.rollDice(actor, match.id);
    turns += 1;
    if (state.finished) break;
  }
  assert.equal(state.finished, true);
  await assert.rejects(() => snakesLadders.rollDice(state.winnerId === 'usr_1' ? 'usr_2' : 'usr_1', match.id), (e) => e.status === 409);
});

test('reconnect: calling getState again mid-game returns the exact same positions/turn/history (state lives server-side, not lost on disconnect)', async () => {
  const { snakesLadders, match } = await setup({ roll: scriptedRoll([3, 4]) });
  await snakesLadders.rollDice('usr_1', match.id);
  const afterOneRoll = await snakesLadders.getState('usr_1', match.id);

  // Simulate a reconnect: an independent getState call from either
  // player, with no client-held state at all.
  const reconnectView1 = await snakesLadders.getState('usr_1', match.id);
  const reconnectView2 = await snakesLadders.getState('usr_2', match.id);
  assert.deepEqual(reconnectView1.positions, afterOneRoll.positions);
  assert.deepEqual(reconnectView1.history, afterOneRoll.history);
  assert.equal(reconnectView1.turn, afterOneRoll.turn);
  assert.deepEqual(reconnectView2.positions, afterOneRoll.positions);
});
