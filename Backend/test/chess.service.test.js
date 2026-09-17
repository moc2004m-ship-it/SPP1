'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryGameMatchRepository } = require('../src/database/repositories/game-match.repository');
const { createGameMatchService } = require('../src/services/game-match.service');
const { createChessService } = require('../src/services/chess.service');

function fakeClock(start) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

async function setup({ now, clockMs, playerIds } = {}) {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const chess = createChessService({ gameMatchService, now, clockMs });
  const match = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'chess', startedBy: 'usr_1', playerIds: playerIds || ['usr_1', 'usr_2'] });
  await gameMatchService.startMatch('usr_1', match.id);
  return { gameMatches, gameMatchService, chess, match };
}

test('getState before the match is started reports started:false, no board', async () => {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const chess = createChessService({ gameMatchService });
  const match = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'chess', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });
  const state = await chess.getState('usr_1', match.id);
  assert.equal(state.started, false);
  assert.equal(state.board, null);
});

test('rejects a wrong-game match (e.g. domino) with 400', async () => {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const chess = createChessService({ gameMatchService });
  const dominoMatch = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'domino', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });
  await assert.rejects(() => chess.getState('usr_1', dominoMatch.id), (e) => e.status === 400);
});

test('white is playerIds[0], black is playerIds[1]; white moves first', async () => {
  const { chess, match } = await setup({ playerIds: ['usr_1', 'usr_2'] });
  const state = await chess.getState('usr_1', match.id);
  assert.equal(state.white, 'usr_1');
  assert.equal(state.black, 'usr_2');
  assert.equal(state.turn, 'usr_1');
  assert.equal(state.turnColor, 'w');
});

test('rejects a move from the player who is not on the move', async () => {
  const { chess, match } = await setup();
  await assert.rejects(() => chess.move('usr_2', match.id, { from: 'e7', to: 'e5' }), (e) => e.status === 409);
});

test('rejects a move from someone who is not even a player in the match', async () => {
  const { chess, match } = await setup();
  await assert.rejects(() => chess.move('usr_9', match.id, { from: 'e2', to: 'e4' }), (e) => e.status === 403);
});

test('rejects an outright illegal move (knight from b1 to b3)', async () => {
  const { chess, match } = await setup();
  await assert.rejects(() => chess.move('usr_1', match.id, { from: 'b1', to: 'b3' }), (e) => e.status === 400 && /illegal move/.test(e.message));
});

test('rejects moving a piece that is not actually there', async () => {
  const { chess, match } = await setup();
  await assert.rejects(() => chess.move('usr_1', match.id, { from: 'e4', to: 'e5' }), (e) => e.status === 400);
});

test('rejects a pawn double-push once it is no longer on its starting rank', async () => {
  const { chess, match } = await setup();
  await chess.move('usr_1', match.id, { from: 'e2', to: 'e3' });
  await chess.move('usr_2', match.id, { from: 'a7', to: 'a6' });
  await assert.rejects(() => chess.move('usr_1', match.id, { from: 'e3', to: 'e5' }), (e) => e.status === 400);
});

test('accepts a real legal opening move and reports the resulting turn/board', async () => {
  const { chess, match } = await setup();
  const state = await chess.move('usr_1', match.id, { from: 'e2', to: 'e4' });
  assert.equal(state.turn, 'usr_2');
  assert.equal(state.turnColor, 'b');
  assert.equal(state.board[28].type, 'p'); // e4 = index 28
  assert.equal(state.board[12], null); // e2 emptied
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].from, 'e2');
  assert.equal(state.history[0].to, 'e4');
});

test("fool's mate: a real checkmate actually finishes the match via the server engine", async () => {
  const { chess, gameMatchService, match } = await setup();
  await chess.move('usr_1', match.id, { from: 'f2', to: 'f3' });
  await chess.move('usr_2', match.id, { from: 'e7', to: 'e5' });
  await chess.move('usr_1', match.id, { from: 'g2', to: 'g4' });
  const state = await chess.move('usr_2', match.id, { from: 'd8', to: 'h4' });
  assert.equal(state.finished, true);
  assert.equal(state.winnerId, 'usr_2');
  assert.equal(state.result, 'checkmate');
  assert.equal(state.history[state.history.length - 1].checkmate, true);
  const match2 = await gameMatchService.getMatch('usr_1', match.id);
  assert.equal(match2.state, 'finished');
  assert.equal(match2.resultSource, 'server');
  assert.equal(match2.winnerId, 'usr_2');
});

test('rejects any further moves once the game has actually finished', async () => {
  const { chess, match } = await setup();
  await chess.move('usr_1', match.id, { from: 'f2', to: 'f3' });
  await chess.move('usr_2', match.id, { from: 'e7', to: 'e5' });
  await chess.move('usr_1', match.id, { from: 'g2', to: 'g4' });
  await chess.move('usr_2', match.id, { from: 'd8', to: 'h4' });
  await assert.rejects(() => chess.move('usr_1', match.id, { from: 'e2', to: 'e4' }), (e) => e.status === 409);
});

test('resign immediately and honestly ends the match in the opponent\'s favor', async () => {
  const { chess, match } = await setup();
  const state = await chess.resign('usr_1', match.id);
  assert.equal(state.finished, true);
  assert.equal(state.winnerId, 'usr_2');
  assert.equal(state.result, 'resignation');
});

test('a draw is only ever recorded once both sides actually agree', async () => {
  const { chess, match } = await setup();
  const offered = await chess.offerDraw('usr_1', match.id);
  assert.equal(offered.drawOfferBy, 'usr_1');
  assert.equal(offered.finished, false);
  const declined = await chess.respondDraw('usr_2', match.id, false);
  assert.equal(declined.finished, false);
  assert.equal(declined.drawOfferBy, null);
  const offered2 = await chess.offerDraw('usr_1', match.id);
  const accepted = await chess.respondDraw('usr_2', match.id, true);
  assert.equal(accepted.finished, true);
  assert.equal(accepted.winnerId, null);
  assert.equal(accepted.result, 'draw_agreement');
});

test('rejects responding to your own draw offer', async () => {
  const { chess, match } = await setup();
  await chess.offerDraw('usr_1', match.id);
  await assert.rejects(() => chess.respondDraw('usr_1', match.id, true), (e) => e.status === 409);
});

test('a real move implicitly cancels a pending draw offer', async () => {
  const { chess, match } = await setup();
  await chess.offerDraw('usr_1', match.id);
  const after = await chess.move('usr_1', match.id, { from: 'e2', to: 'e4' });
  assert.equal(after.drawOfferBy, null);
});

test('real clock: time actually spent on a move is deducted, not reset for free', async () => {
  const clock = fakeClock(1000);
  const { chess, match } = await setup({ now: clock, clockMs: 60000 });
  await chess.getState('usr_1', match.id); // initializes turnStartedAt at t=1000
  clock.advance(5000); // white thinks for 5s
  const state = await chess.move('usr_1', match.id, { from: 'e2', to: 'e4' });
  assert.equal(state.clocks['usr_1'], 55000);
  assert.equal(state.clocks['usr_2'], 60000); // untouched -- it's now black's turn
});

test('real clock: running out of time actually ends the match as a timeout loss', async () => {
  const clock = fakeClock(1000);
  const { chess, match } = await setup({ now: clock, clockMs: 10000 });
  await chess.getState('usr_1', match.id); // initializes turnStartedAt at t=1000
  clock.advance(10001); // white's entire clock elapses without a move
  const state = await chess.getState('usr_1', match.id); // the very next read notices it
  assert.equal(state.finished, true);
  assert.equal(state.winnerId, 'usr_2');
  assert.equal(state.result, 'timeout');
});

test('a timed-out player cannot still sneak in a move', async () => {
  const clock = fakeClock(1000);
  const { chess, match } = await setup({ now: clock, clockMs: 10000 });
  await chess.getState('usr_1', match.id); // initializes turnStartedAt at t=1000
  clock.advance(10001);
  await assert.rejects(() => chess.move('usr_1', match.id, { from: 'e2', to: 'e4' }), (e) => e.status === 409);
});

test('promotion is real: choosing a rook actually places a rook, not a default queen', async () => {
  const { chess, match } = await setup();
  // Race a white pawn to b7 by capturing up the board, then capture the
  // a8 rook while promoting.
  const moves = [
    ['usr_1', 'b2', 'b4'], ['usr_2', 'a7', 'a5'],
    ['usr_1', 'b4', 'a5'], ['usr_2', 'b7', 'b6'],
    ['usr_1', 'a5', 'b6'], ['usr_2', 'c7', 'c6'],
    ['usr_1', 'b6', 'b7'], ['usr_2', 'd8', 'c7'],
  ];
  for (const [player, from, to] of moves) await chess.move(player, match.id, { from, to });
  const state = await chess.move('usr_1', match.id, { from: 'b7', to: 'a8', promotion: 'r' });
  assert.equal(state.board[cbIdx('a8')].type, 'r');
  assert.equal(state.board[cbIdx('a8')].color, 'w');
});

function cbIdx(sq) {
  const files = 'abcdefgh';
  const file = files.indexOf(sq[0]);
  const rank = Number(sq[1]);
  return (rank - 1) * 8 + file;
}

test('reconnect: getState after moves have been played returns the same live state, not a fresh board', async () => {
  const { chess, match } = await setup();
  await chess.move('usr_1', match.id, { from: 'e2', to: 'e4' });
  await chess.move('usr_2', match.id, { from: 'e7', to: 'e5' });
  const state1 = await chess.getState('usr_1', match.id);
  const state2 = await chess.getState('usr_2', match.id);
  assert.equal(state1.history.length, 2);
  assert.deepEqual(state1.history, state2.history);
  assert.equal(state1.board[cbIdx('e4')].type, 'p');
});

test('chess requires exactly 2 players', async () => {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const chess = createChessService({ gameMatchService });
  const match = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'chess', startedBy: 'usr_1', playerIds: ['usr_1'] });
  // minPlayers for chess is 2, so this lobby can never even start --
  // enforced already at the framework layer (game-catalog.js), proving
  // the engine never has to handle a 1-player "match".
  await assert.rejects(() => gameMatchService.startMatch('usr_1', match.id), (e) => e.status === 409);
});
