'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryGameMatchRepository } = require('../src/database/repositories/game-match.repository');
const { createGameMatchService } = require('../src/services/game-match.service');
const { createEightBallService } = require('../src/services/eight-ball.service');
const { BALLS_PER_GROUP } = require('../src/domain/eight-ball.board');

function fakeClock(start) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}
function scriptedRoll(sequence) {
  let i = 0;
  return () => sequence[Math.min(i++, sequence.length - 1)];
}
const FOUL = 10;
const MISS = 30;
const POT = 60;
const POT_EIGHT = 95;

async function setup({ roll, now, turnDurationMs, playerIds } = {}) {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const eightBall = createEightBallService({ gameMatchService, random: roll, now, turnDurationMs });
  const match = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'eight_ball', startedBy: 'usr_1', playerIds: playerIds || ['usr_1', 'usr_2'] });
  await gameMatchService.startMatch('usr_1', match.id);
  return { gameMatches, gameMatchService, eightBall, match };
}

test('getState before the match is started reports started:false', async () => {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const eightBall = createEightBallService({ gameMatchService });
  const match = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'eight_ball', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });
  const state = await eightBall.getState('usr_1', match.id);
  assert.equal(state.started, false);
  assert.equal(state.groups, null);
});

test('rejects a wrong-game match with 400', async () => {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const eightBall = createEightBallService({ gameMatchService });
  const chessMatch = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'chess', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });
  await assert.rejects(() => eightBall.getState('usr_1', chessMatch.id), (e) => e.status === 400);
});

test('groups start unassigned and both remaining counts are full', async () => {
  const { eightBall, match } = await setup();
  const state = await eightBall.getState('usr_1', match.id);
  assert.equal(state.groupsAssigned, false);
  assert.equal(state.groups['usr_1'], null);
  assert.equal(state.remaining.solids, BALLS_PER_GROUP);
  assert.equal(state.remaining.stripes, BALLS_PER_GROUP);
});

test('rejects a strike from a player who is not on the shot clock', async () => {
  const { eightBall, match } = await setup({ roll: scriptedRoll([MISS]) });
  await assert.rejects(() => eightBall.strike('usr_2', match.id), (e) => e.status === 409);
});

test('a real foul passes the turn with no group change and no score', async () => {
  const { eightBall, match } = await setup({ roll: scriptedRoll([FOUL]) });
  const state = await eightBall.strike('usr_1', match.id);
  assert.equal(state.turn, 'usr_2');
  assert.equal(state.groupsAssigned, false);
  assert.equal(state.scores['usr_1'], 0);
  assert.equal(state.history[0].outcome, 'foul');
});

test('a real miss passes the turn', async () => {
  const { eightBall, match } = await setup({ roll: scriptedRoll([MISS]) });
  const state = await eightBall.strike('usr_1', match.id);
  assert.equal(state.turn, 'usr_2');
  assert.equal(state.history[0].outcome, 'miss');
});

test('the first legal pot really assigns groups (server-side, not preassigned)', async () => {
  const { eightBall, match } = await setup({ roll: scriptedRoll([POT]) });
  const state = await eightBall.strike('usr_1', match.id);
  assert.equal(state.groupsAssigned, true);
  assert.equal(state.groups['usr_1'], 'solids');
  assert.equal(state.groups['usr_2'], 'stripes');
  assert.equal(state.remaining.solids, BALLS_PER_GROUP - 1);
  assert.equal(state.scores['usr_1'], 1);
  assert.equal(state.turn, 'usr_1'); // pocketing earns another shot
});

test('potting the 8-ball before your own group is cleared is a real, immediate loss', async () => {
  const { eightBall, match } = await setup({ roll: scriptedRoll([POT, POT_EIGHT]) });
  await eightBall.strike('usr_1', match.id); // assigns groups, 1 solid down, 6 remain
  const state = await eightBall.strike('usr_1', match.id); // pots the 8-ball early
  assert.equal(state.finished, true);
  assert.equal(state.winnerId, 'usr_2');
  assert.equal(state.history[state.history.length - 1].legal, false);
});

test('legally clearing your group then potting the 8-ball is a real win', async () => {
  // 7 legal pots (POT) clear usr_1's group of 7, then POT_EIGHT wins it.
  const sequence = new Array(BALLS_PER_GROUP).fill(POT).concat([POT_EIGHT]);
  const { eightBall, match } = await setup({ roll: scriptedRoll(sequence) });
  let state;
  for (let i = 0; i < BALLS_PER_GROUP; i++) state = await eightBall.strike('usr_1', match.id);
  assert.equal(state.remaining.solids, 0);
  assert.equal(state.scores['usr_1'], BALLS_PER_GROUP);
  state = await eightBall.strike('usr_1', match.id); // the real 8-ball win
  assert.equal(state.finished, true);
  assert.equal(state.winnerId, 'usr_1');
  assert.equal(state.history[state.history.length - 1].legal, true);
});

test('a "pot" band with your own group already empty honestly falls back to an 8-ball attempt, never a wasted/invented roll', async () => {
  const sequence = new Array(BALLS_PER_GROUP).fill(POT).concat([POT]); // an 8th "pot" roll after the group is already cleared
  const { eightBall, match } = await setup({ roll: scriptedRoll(sequence) });
  let state;
  for (let i = 0; i < BALLS_PER_GROUP; i++) state = await eightBall.strike('usr_1', match.id);
  state = await eightBall.strike('usr_1', match.id);
  assert.equal(state.finished, true);
  assert.equal(state.winnerId, 'usr_1'); // group was actually clear, so this is a legal win
});

test('rejects a strike once the game has actually finished', async () => {
  const { eightBall, match } = await setup({ roll: scriptedRoll([FOUL]) });
  // Force a quick finish via early 8-ball loss.
  const { eightBall: eb2, match: m2 } = await setup({ roll: scriptedRoll([POT_EIGHT]) });
  await eb2.strike('usr_1', m2.id);
  await assert.rejects(() => eb2.strike('usr_1', m2.id), (e) => e.status === 409);
});

test('real shot clock: an idle player is auto-passed on timeout, recorded in history', async () => {
  const clock = fakeClock(1000);
  const { eightBall, match } = await setup({ roll: scriptedRoll([MISS]), now: clock, turnDurationMs: 20000 });
  await eightBall.getState('usr_1', match.id); // initializes the clock at t=1000
  clock.advance(20001);
  const state = await eightBall.getState('usr_1', match.id);
  assert.equal(state.turn, 'usr_2');
  assert.equal(state.history[0].outcome, 'timeout');
});

test('reconnect: getState returns the exact same live groups/scores/history after strikes', async () => {
  const { eightBall, match } = await setup({ roll: scriptedRoll([POT, FOUL]) });
  await eightBall.strike('usr_1', match.id);
  await eightBall.strike('usr_1', match.id);
  const view1 = await eightBall.getState('usr_1', match.id);
  const view2 = await eightBall.getState('usr_2', match.id);
  assert.deepEqual(view1.history, view2.history);
  assert.deepEqual(view1.scores, view2.scores);
  assert.equal(view1.turn, 'usr_2');
});

test('eight ball requires exactly 2 players', async () => {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const match = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'eight_ball', startedBy: 'usr_1', playerIds: ['usr_1'] });
  await assert.rejects(() => gameMatchService.startMatch('usr_1', match.id), (e) => e.status === 409);
});
