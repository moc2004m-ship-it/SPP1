'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryGameMatchRepository } = require('../src/database/repositories/game-match.repository');
const { createGameMatchService } = require('../src/services/game-match.service');
const { createLudoService } = require('../src/services/ludo.service');
const { HOME_REL_POS, TOKENS_PER_PLAYER, absoluteSquare, isSafeSquare } = require('../src/domain/ludo.board');

// A scripted die: returns the next value from `sequence` on each call,
// repeating the last value forever once exhausted. Lets a test drive the
// engine through an exact, known sequence of rolls instead of depending
// on real randomness -- production wiring (src/index.js) never passes
// this; it always uses the real crypto-backed default.
function scriptedRoll(sequence) {
  let i = 0;
  return () => sequence[Math.min(i++, sequence.length - 1)];
}

async function setup({ roll, playerIds } = {}) {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const ludo = createLudoService({ gameMatchService, random: roll });
  const match = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'ludo', startedBy: 'usr_1', playerIds: playerIds || ['usr_1', 'usr_2'] });
  await gameMatchService.startMatch('usr_1', match.id);
  return { gameMatches, gameMatchService, ludo, match };
}

test('getState before the match is started reports started:false and no tokens', async () => {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const ludo = createLudoService({ gameMatchService });
  const match = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'ludo', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });

  const state = await ludo.getState('usr_1', match.id);
  assert.equal(state.started, false);
  assert.equal(state.tokens, null);
});

test('rejects a wrong-game match (e.g. carrom) with 400', async () => {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const ludo = createLudoService({ gameMatchService });
  const carromMatch = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'carrom', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });
  await assert.rejects(() => ludo.getState('usr_1', carromMatch.id), (e) => e.status === 400);
});

test('only a participant may view, roll, or move', async () => {
  const { ludo, match } = await setup({ roll: scriptedRoll([6]) });
  await assert.rejects(() => ludo.getState('usr_intruder', match.id), (e) => e.status === 403);
  await assert.rejects(() => ludo.rollDice('usr_intruder', match.id), (e) => e.status === 403);
  await assert.rejects(() => ludo.moveToken('usr_intruder', match.id, 0), (e) => e.status === 403);
});

test('only the player whose turn it is may roll or move', async () => {
  const { ludo, match } = await setup({ roll: scriptedRoll([6]) });
  await assert.rejects(() => ludo.rollDice('usr_2', match.id), (e) => e.status === 409 && /not your turn/.test(e.message));
  const state = await ludo.rollDice('usr_1', match.id);
  assert.equal(state.pendingDie, 6);
  await assert.rejects(() => ludo.moveToken('usr_2', match.id, 0), (e) => e.status === 409 && /not your turn/.test(e.message));
});

test('cannot move before rolling, and cannot roll twice without moving', async () => {
  const { ludo, match } = await setup({ roll: scriptedRoll([6, 3]) });
  await assert.rejects(() => ludo.moveToken('usr_1', match.id, 0), (e) => e.status === 409 && /roll the die/.test(e.message));
  await ludo.rollDice('usr_1', match.id);
  await assert.rejects(() => ludo.rollDice('usr_1', match.id), (e) => e.status === 409 && /already rolled/.test(e.message));
});

test('all tokens still in base with a non-6 roll has no legal move and auto-skips the turn server-side (stall prevention)', async () => {
  const { ludo, match } = await setup({ roll: scriptedRoll([3]) });
  const state = await ludo.rollDice('usr_1', match.id);
  assert.equal(state.turn, 'usr_2');
  assert.equal(state.pendingDie, null);
  assert.equal(state.history[0].event, 'no_legal_move');
});

test('moveToken re-validates server-side: an out-of-range or non-integer pieceIndex is rejected even though a die was rolled', async () => {
  const { ludo, match } = await setup({ roll: scriptedRoll([6]) });
  await ludo.rollDice('usr_1', match.id);
  await assert.rejects(() => ludo.moveToken('usr_1', match.id, 4), (e) => e.status === 400);
  await assert.rejects(() => ludo.moveToken('usr_1', match.id, -1), (e) => e.status === 400);
  await assert.rejects(() => ludo.moveToken('usr_1', match.id, 1.5), (e) => e.status === 400);
});

test('rolling a 6 grants another roll for the same player; any other roll passes the turn', async () => {
  const { ludo, match } = await setup({ roll: scriptedRoll([6, 3]) });
  await ludo.rollDice('usr_1', match.id);
  let state = await ludo.moveToken('usr_1', match.id, 0);
  assert.equal(state.turn, 'usr_1', 'still usr_1 after a 6');
  assert.equal(state.pendingDie, null, 'must roll again explicitly, not auto-continued');
  state = await ludo.rollDice('usr_1', match.id); // die=3
  state = await ludo.moveToken('usr_1', match.id, 0); // token 0 is on the board at relPos 0 -> relPos 3
  assert.equal(state.turn, 'usr_2', 'turn passes after a non-6');
});

test('three consecutive sixes forfeits the turn immediately instead of granting a fourth roll', async () => {
  const { ludo, match } = await setup({ roll: scriptedRoll([6, 6, 6]) });
  await ludo.rollDice('usr_1', match.id); // 6 (1st) -> move
  await ludo.moveToken('usr_1', match.id, 0);
  await ludo.rollDice('usr_1', match.id); // 6 (2nd) -> move
  await ludo.moveToken('usr_1', match.id, 1);
  const state = await ludo.rollDice('usr_1', match.id); // 6 (3rd) -> forfeit, no move happens
  assert.equal(state.turn, 'usr_2');
  assert.equal(state.pendingDie, null);
  assert.equal(state.history[state.history.length - 1].event, 'three_sixes_forfeit');
});

// Hand-verified against ../src/domain/ludo.board's own math and confirmed
// by direct execution: usr_1 walks token 0 to relPos 14 (die 6,6,2 from
// relPos -1), usr_2 walks token 0 to relPos 1 (die 6,1 from base) --
// absoluteSquare(14, color 0) === absoluteSquare(1, color 1) === 14,
// which is not a safe square. usr_1's final move (die 6, relPos 8 -> 14)
// then lands exactly on usr_2's token.
test('capturing: landing exactly on an opponent token on a non-safe shared square sends it back to base', async () => {
  assert.equal(absoluteSquare(14, 0), absoluteSquare(1, 1));
  assert.equal(isSafeSquare(absoluteSquare(14, 0)), false);

  const { ludo, match } = await setup({ roll: scriptedRoll([6, 6, 2, 6, 1, 6]) });
  await ludo.rollDice('usr_1', match.id); // 6, leave -> relPos 0
  await ludo.moveToken('usr_1', match.id, 0);
  await ludo.rollDice('usr_1', match.id); // 6, same turn -> relPos 6
  await ludo.moveToken('usr_1', match.id, 0);
  let state = await ludo.rollDice('usr_1', match.id); // 2 -> relPos 8, turn passes
  state = await ludo.moveToken('usr_1', match.id, 0);
  assert.equal(state.turn, 'usr_2');

  await ludo.rollDice('usr_2', match.id); // 6, leave -> relPos 0 (abs 13, safe, own start)
  await ludo.moveToken('usr_2', match.id, 0);
  state = await ludo.rollDice('usr_2', match.id); // 1 -> relPos 1 (abs 14), turn passes
  state = await ludo.moveToken('usr_2', match.id, 0);
  assert.equal(state.turn, 'usr_1');
  assert.equal(state.tokens['usr_2'][0], 1);

  state = await ludo.rollDice('usr_1', match.id); // 6 -> relPos 8 + 6 = 14, capture
  state = await ludo.moveToken('usr_1', match.id, 0);

  assert.equal(state.tokens['usr_1'][0], 14, 'attacker lands exactly on the shared square');
  assert.equal(state.tokens['usr_2'][0], -1, 'defender token is sent back to base (BASE)');
  const lastEntry = state.history[state.history.length - 1];
  assert.equal(lastEntry.event, 'moved');
  assert.deepEqual(lastEntry.captured, [{ playerId: 'usr_2', pieceIndex: 0 }], 'the capture is recorded in real match history');
});

// A general, adaptive walker: leaves base with a 6, then always travels
// by min(5, remaining) so every travel roll is non-6 (turn passes after
// every travel move, and the three-sixes rule is never engaged), handing
// a harmless auto-skip roll to `other` (which never leaves its own base)
// whenever the turn passes to it. Verified correct by direct execution
// before being used in the win test below.
async function walkTokenHome(ludo, matchId, setDie, actorId, pieceIndex, otherId) {
  setDie(6);
  let state = await ludo.rollDice(actorId, matchId);
  state = await ludo.moveToken(actorId, matchId, pieceIndex);
  let relPos = state.tokens[actorId][pieceIndex];
  while (relPos < HOME_REL_POS) {
    const die = Math.min(5, HOME_REL_POS - relPos);
    setDie(die);
    state = await ludo.rollDice(actorId, matchId);
    state = await ludo.moveToken(actorId, matchId, pieceIndex);
    relPos = state.tokens[actorId][pieceIndex];
    if (state.finished) return state;
    if (state.turn === otherId) {
      setDie(1); // otherId never has a token out of base, so this always auto-skips
      state = await ludo.rollDice(otherId, matchId);
    }
  }
  return state;
}

test('a full game to a real, server-detected win: all 4 tokens reaching home server-side finishes the match with the walker as winner', async () => {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  let nextDie = 6;
  const ludo = createLudoService({ gameMatchService, random: () => nextDie });
  const setDie = (d) => { nextDie = d; };
  const match = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'ludo', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });
  await gameMatchService.startMatch('usr_1', match.id);

  let state;
  for (let piece = 0; piece < TOKENS_PER_PLAYER; piece += 1) {
    state = await walkTokenHome(ludo, match.id, setDie, 'usr_1', piece, 'usr_2');
    if (state.finished) break;
  }

  assert.equal(state.finished, true, 'game must actually finish within a bounded, real sequence of rolls');
  assert.equal(state.winnerId, 'usr_1');
  assert.equal(state.finishedCounts['usr_1'], TOKENS_PER_PLAYER);

  const finishedMatch = await gameMatches.findById(match.id);
  assert.equal(finishedMatch.state, 'finished');
  assert.equal(finishedMatch.winnerId, 'usr_1');
  assert.equal(finishedMatch.resultSource, 'server');
  assert.equal(finishedMatch.result.engine, 'ludo');

  // Rolling or moving after the game has already finished is rejected,
  // not silently accepted (the match record itself is no longer 'active').
  await assert.rejects(() => ludo.rollDice('usr_2', match.id), (e) => e.status === 409);
  await assert.rejects(() => ludo.moveToken('usr_1', match.id, 0), (e) => e.status === 409);
});

test('reconnect: calling getState again mid-game returns the exact same tokens/turn/history (state lives server-side, not lost on disconnect)', async () => {
  const { ludo, match } = await setup({ roll: scriptedRoll([6, 3]) });
  await ludo.rollDice('usr_1', match.id);
  await ludo.moveToken('usr_1', match.id, 0);
  const afterOneMove = await ludo.getState('usr_1', match.id);

  const reconnectView1 = await ludo.getState('usr_1', match.id);
  const reconnectView2 = await ludo.getState('usr_2', match.id);
  assert.deepEqual(reconnectView1.tokens, afterOneMove.tokens);
  assert.deepEqual(reconnectView1.history, afterOneMove.history);
  assert.equal(reconnectView1.turn, afterOneMove.turn);
  assert.deepEqual(reconnectView2.tokens, afterOneMove.tokens);
});
