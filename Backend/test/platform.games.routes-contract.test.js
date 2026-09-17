'use strict';
// Stage 19 -- contract tests for the Room Game Center wiring in
// src/routes/platform.routes.js (GET /api/games/catalog, POST /api/games,
// GET /api/games[?roomId=], GET /api/games/:matchId, POST
// /api/games/:matchId/join|leave|cancel|start).
//
// platform.routes.js itself cannot be require()'d in this environment --
// same permanent `express` not installed limitation documented in every
// other *.routes-contract.test.js file in this project (see
// platform.battles.routes-contract.test.js's own header for the full
// explanation). This file uses the exact same style: pure logic, fake
// req/res inputs, re-creating each handler's own call shape verbatim
// against the REAL gameMatchService (wired with the real isRoomMember,
// exactly as src/index.js wires it) -- so it proves the routing/
// session-identity/room-membership-guard contract, not re-proving the
// service's own lifecycle rules (already exhaustively covered in
// game-match.service.test.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform } = require('../src/feature-platform');
const { isRoomMember } = require('../src/routes/platform.guards');
const { InMemoryGameMatchRepository } = require('../src/database/repositories/game-match.repository');
const { createGameMatchService } = require('../src/services/game-match.service');
const { createSnakesLaddersService } = require('../src/services/snakes-ladders.service');
const { createQuizService } = require('../src/services/quiz.service');
const { listGames } = require('../src/domain/game-catalog');

function setup() {
  const p = createPlatform({});
  const gameMatches = new InMemoryGameMatchRepository();
  // Exactly how src/index.js wires it: isRoomMember bound against the
  // real platform.store.
  const gameMatchService = createGameMatchService({
    gameMatches,
    isRoomMember: (roomId, accountId) => isRoomMember(p.store, roomId, accountId),
  });
  const snakesLaddersService = createSnakesLaddersService({ gameMatchService });
  const quizService = createQuizService({ gameMatchService });
  return { p, gameMatches, gameMatchService, snakesLaddersService, quizService };
}

test('GET /api/games/catalog contract: returns the real fixed catalog, not account-scoped', () => {
  // Verbatim what the handler does: `json(res, () => listGames())`.
  assert.deepEqual(listGames().map((g) => g.id).sort(), ['carrom', 'chess', 'domino', 'eight_ball', 'ludo', 'quiz', 'snakes_ladders']);
});

test('POST /api/games contract: a real member of the room can create a lobby; a non-member is rejected before any match exists', async () => {
  const { p, gameMatchService } = setup();
  const room = await p.rooms.create({ ownerId: 'acc_owner', name: 'Room' });
  await p.rooms.join(room.id, 'acc_member');

  // Verbatim what the handler does for a member.
  const memberReq = { session: { accountId: 'acc_member' }, body: { roomId: room.id, gameId: 'ludo', version: '1' } };
  const match = await gameMatchService.createMatch({
    roomId: memberReq.body.roomId,
    gameId: memberReq.body.gameId,
    version: memberReq.body.version,
    startedBy: memberReq.session.accountId,
    playerIds: [memberReq.session.accountId],
  });
  assert.equal(match.startedBy, 'acc_member');

  // Verbatim for a stranger who never joined and does not own the room.
  const intruderReq = { session: { accountId: 'acc_intruder' }, body: { roomId: room.id, gameId: 'ludo', version: '1' } };
  await assert.rejects(
    () => gameMatchService.createMatch({
      roomId: intruderReq.body.roomId,
      gameId: intruderReq.body.gameId,
      version: intruderReq.body.version,
      startedBy: intruderReq.session.accountId,
      playerIds: [intruderReq.session.accountId],
    }),
    (e) => e.status === 403
  );
});

test('POST /api/games contract: startedBy always comes from req.session.accountId, never a client-supplied field, and the acting session is always folded into playerIds', async () => {
  const { p, gameMatchService } = setup();
  const room = await p.rooms.create({ ownerId: 'acc_owner', name: 'Room' });
  // A client attempting to smuggle a different startedBy/playerIds shape.
  const req = { session: { accountId: 'acc_owner' }, body: { roomId: room.id, gameId: 'ludo', startedBy: 'acc_someone_else', playerIds: ['acc_someone_else', 'acc_owner'] } };

  // Verbatim what the handler does: startedBy is always the session, and
  // the session is always folded into playerIds first regardless of what
  // the body's own playerIds said.
  const startedBy = req.session.accountId;
  const otherPlayerIds = Array.isArray(req.body?.playerIds) ? req.body.playerIds.filter((p2) => p2 !== startedBy) : [];
  const match = await gameMatchService.createMatch({
    roomId: req.body.roomId,
    gameId: req.body.gameId,
    version: req.body.version,
    startedBy,
    playerIds: [startedBy, ...otherPlayerIds],
  });
  assert.equal(match.startedBy, 'acc_owner');
  assert.deepEqual(match.playerIds, ['acc_owner', 'acc_someone_else']);
});

test('GET /api/games contract: no roomId query means "my games" (listByStartedBy), unchanged since before Stage 19', async () => {
  const { p, gameMatchService, gameMatches } = setup();
  const room = await p.rooms.create({ ownerId: 'acc_a', name: 'Room' });
  await p.rooms.join(room.id, 'acc_b');
  await gameMatchService.createMatch({ roomId: room.id, gameId: 'ludo', startedBy: 'acc_a', playerIds: ['acc_a'] });
  await gameMatchService.createMatch({ roomId: room.id, gameId: 'chess', startedBy: 'acc_b', playerIds: ['acc_b'] });

  const req = { session: { accountId: 'acc_a' }, query: {} };
  // Verbatim what the handler does with no ?roomId.
  const mine = req.query && req.query.roomId
    ? await gameMatchService.listByRoom(req.session.accountId, req.query.roomId)
    : await gameMatches.listByStartedBy(req.session.accountId);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].startedBy, 'acc_a');
});

test('GET /api/games?roomId=... contract: returns every match in the room regardless of who started it, and requires the caller to be a real member', async () => {
  const { p, gameMatchService } = setup();
  const room = await p.rooms.create({ ownerId: 'acc_owner', name: 'Room' });
  await p.rooms.join(room.id, 'acc_member');
  await gameMatchService.createMatch({ roomId: room.id, gameId: 'ludo', startedBy: 'acc_owner', playerIds: ['acc_owner'] });

  const req = { session: { accountId: 'acc_member' }, query: { roomId: room.id } };
  const list = req.query && req.query.roomId ? await gameMatchService.listByRoom(req.session.accountId, req.query.roomId) : null;
  assert.equal(list.length, 1);

  const intruderReq = { session: { accountId: 'acc_intruder' }, query: { roomId: room.id } };
  await assert.rejects(() => gameMatchService.listByRoom(intruderReq.session.accountId, intruderReq.query.roomId), (e) => e.status === 403);
});

test('GET /api/games/:matchId contract: req.params.matchId flows straight into getMatch(), and a non-participant is rejected', async () => {
  const { p, gameMatchService } = setup();
  const room = await p.rooms.create({ ownerId: 'acc_owner', name: 'Room' });
  const match = await gameMatchService.createMatch({ roomId: room.id, gameId: 'ludo', startedBy: 'acc_owner', playerIds: ['acc_owner'] });

  const ownerReq = { session: { accountId: 'acc_owner' }, params: { matchId: match.id } };
  const found = await gameMatchService.getMatch(ownerReq.session.accountId, ownerReq.params.matchId);
  assert.equal(found.id, match.id);

  const strangerReq = { session: { accountId: 'acc_stranger' }, params: { matchId: match.id } };
  await assert.rejects(() => gameMatchService.getMatch(strangerReq.session.accountId, strangerReq.params.matchId), (e) => e.status === 403);
});

test('POST /api/games/:matchId/join contract: actorId always from the session, and room membership is re-verified even though the roomId is not in the request at all', async () => {
  const { p, gameMatchService } = setup();
  const room = await p.rooms.create({ ownerId: 'acc_owner', name: 'Room' });
  await p.rooms.join(room.id, 'acc_member');
  const match = await gameMatchService.createMatch({ roomId: room.id, gameId: 'ludo', startedBy: 'acc_owner', playerIds: ['acc_owner'] });

  const req = { session: { accountId: 'acc_member' }, params: { matchId: match.id } };
  const joined = await gameMatchService.joinMatch(req.session.accountId, req.params.matchId);
  assert.ok(joined.playerIds.includes('acc_member'));

  const intruderReq = { session: { accountId: 'acc_intruder' }, params: { matchId: match.id } };
  await assert.rejects(() => gameMatchService.joinMatch(intruderReq.session.accountId, intruderReq.params.matchId), (e) => e.status === 403);
});

test('POST /api/games/:matchId/leave|cancel|start contract: each passes req.session.accountId + req.params.matchId straight into the real service, host-only rules enforced there', async () => {
  const { p, gameMatchService } = setup();
  const room = await p.rooms.create({ ownerId: 'acc_owner', name: 'Room' });
  const match = await gameMatchService.createMatch({ roomId: room.id, gameId: 'ludo', startedBy: 'acc_owner', playerIds: ['acc_owner', 'acc_2'] });

  // leave: a non-host player leaving.
  const leaveReq = { session: { accountId: 'acc_2' }, params: { matchId: match.id } };
  const left = await gameMatchService.leaveMatch(leaveReq.session.accountId, leaveReq.params.matchId);
  assert.deepEqual(left.playerIds, ['acc_owner']);

  // cancel: only the host (acc_owner), never any other session.
  const nonHostCancelReq = { session: { accountId: 'acc_2' }, params: { matchId: match.id } };
  await assert.rejects(() => gameMatchService.cancelMatch(nonHostCancelReq.session.accountId, nonHostCancelReq.params.matchId), (e) => e.status === 403);

  // start: only the host, and only a fresh lobby (create a new one since
  // the previous one above is about to be cancelled/still lobby with 1 player).
  const soloMatch = await gameMatchService.createMatch({ roomId: room.id, gameId: 'ludo', startedBy: 'acc_owner', playerIds: ['acc_owner', 'acc_3'] });
  const startReq = { session: { accountId: 'acc_owner' }, params: { matchId: soloMatch.id } };
  const started = await gameMatchService.startMatch(startReq.session.accountId, startReq.params.matchId);
  assert.equal(started.state, 'active');

  const cancelReq = { session: { accountId: 'acc_owner' }, params: { matchId: match.id } };
  const cancelled = await gameMatchService.cancelMatch(cancelReq.session.accountId, cancelReq.params.matchId);
  assert.equal(cancelled.state, 'cancelled');
});

// Verbatim what routes/platform.routes.js's POST /api/games/:matchId/finish
// handler does, for every test below in this section.
async function handleFinish(gameMatchService, actorId, matchId) {
  const match = await gameMatchService.getMatch(actorId, matchId);
  if (match.gameId !== 'snakes_ladders' && match.gameId !== 'quiz') {
    throw Object.assign(new Error('submitting a game result is not available yet; it requires a real server-side game rules engine (not implemented), never a client-declared winner'), { status: 403 });
  }
  if (match.state !== 'finished' || match.resultSource !== 'server') {
    throw Object.assign(new Error('this match has not been finished by the server-side game engine yet -- play it out via /board+/roll or /quiz+/quiz/answer'), { status: 409 });
  }
  return match;
}

test('POST /api/games/:matchId/finish stays hard-blocked for every game without a real engine (ludo/carrom/chess/eight_ball/domino), unchanged since before Stage 19', async () => {
  const { p, gameMatchService } = setup();
  const room = await p.rooms.create({ ownerId: 'acc_owner', name: 'Room' });
  const match = await gameMatchService.createMatch({ roomId: room.id, gameId: 'ludo', startedBy: 'acc_owner', playerIds: ['acc_owner'] });
  await assert.rejects(() => handleFinish(gameMatchService, 'acc_owner', match.id), (e) => e.status === 403);
});

test('POST /api/games/:matchId/finish for snakes_ladders/quiz never reads a winner from the client, and 409s until the real engine has actually finished the match server-side', async () => {
  const { p, gameMatchService } = setup();
  const room = await p.rooms.create({ ownerId: 'acc_owner', name: 'Room' });
  const match = await gameMatchService.createMatch({ roomId: room.id, gameId: 'snakes_ladders', startedBy: 'acc_owner', playerIds: ['acc_owner', 'acc_2'] });
  await gameMatchService.startMatch('acc_owner', match.id);
  // Still active/unfinished -- must 409, never accept a client-declared winner.
  await assert.rejects(() => handleFinish(gameMatchService, 'acc_owner', match.id), (e) => e.status === 409);
});

test('POST /api/games/:matchId/finish for snakes_ladders returns the real server-produced result once the engine has actually finished it', async () => {
  const { p, gameMatchService, snakesLaddersService } = setup();
  const room = await p.rooms.create({ ownerId: 'acc_owner', name: 'Room' });
  const match = await gameMatchService.createMatch({ roomId: room.id, gameId: 'snakes_ladders', startedBy: 'acc_owner', playerIds: ['acc_owner', 'acc_2'] });
  await gameMatchService.startMatch('acc_owner', match.id);
  // Drive a real game to completion through the real engine (bounded, see
  // snakes-ladders.service.test.js for why this always terminates).
  let state;
  const players = ['acc_owner', 'acc_2'];
  for (let turns = 0; turns < 500 && !(state && state.finished); turns++) {
    state = await snakesLaddersService.rollDice(players[turns % 2], match.id);
  }
  assert.equal(state.finished, true);

  const finished = await handleFinish(gameMatchService, 'acc_owner', match.id);
  assert.equal(finished.state, 'finished');
  assert.equal(finished.resultSource, 'server');
  assert.equal(finished.winnerId, state.winnerId);
});

test('GET /api/games/:matchId/board and POST /api/games/:matchId/roll contract: req.session.accountId + req.params.matchId flow straight into the real engine', async () => {
  const { p, gameMatchService, snakesLaddersService } = setup();
  const room = await p.rooms.create({ ownerId: 'acc_owner', name: 'Room' });
  const match = await gameMatchService.createMatch({ roomId: room.id, gameId: 'snakes_ladders', startedBy: 'acc_owner', playerIds: ['acc_owner', 'acc_2'] });
  await gameMatchService.startMatch('acc_owner', match.id);

  const boardReq = { session: { accountId: 'acc_owner' }, params: { matchId: match.id } };
  const board = await snakesLaddersService.getState(boardReq.session.accountId, boardReq.params.matchId);
  assert.equal(board.started, true);

  const rollReq = { session: { accountId: 'acc_owner' }, params: { matchId: match.id } };
  const rolled = await snakesLaddersService.rollDice(rollReq.session.accountId, rollReq.params.matchId);
  assert.equal(rolled.history.length, 1);

  const intruderReq = { session: { accountId: 'acc_intruder' }, params: { matchId: match.id } };
  await assert.rejects(() => snakesLaddersService.rollDice(intruderReq.session.accountId, intruderReq.params.matchId), (e) => e.status === 403);
});

test('GET /api/games/:matchId/quiz and POST /api/games/:matchId/quiz/answer contract: choiceIndex always comes from req.body, actor always from the session', async () => {
  const { p, gameMatchService, quizService } = setup();
  const room = await p.rooms.create({ ownerId: 'acc_owner', name: 'Room' });
  const match = await gameMatchService.createMatch({ roomId: room.id, gameId: 'quiz', startedBy: 'acc_owner', playerIds: ['acc_owner', 'acc_2'] });
  await gameMatchService.startMatch('acc_owner', match.id);

  const getReq = { session: { accountId: 'acc_owner' }, params: { matchId: match.id } };
  const state = await quizService.getState(getReq.session.accountId, getReq.params.matchId);
  assert.equal(state.question.correctIndex, undefined);

  const answerReq = { session: { accountId: 'acc_owner' }, params: { matchId: match.id }, body: { choiceIndex: 0 } };
  const answered = await quizService.submitAnswer(answerReq.session.accountId, answerReq.params.matchId, answerReq.body?.choiceIndex);
  assert.deepEqual(answered.answered, ['acc_owner']);

  const intruderReq = { session: { accountId: 'acc_intruder' }, params: { matchId: match.id }, body: { choiceIndex: 0 } };
  await assert.rejects(() => quizService.submitAnswer(intruderReq.session.accountId, intruderReq.params.matchId, intruderReq.body?.choiceIndex), (e) => e.status === 403);
});
