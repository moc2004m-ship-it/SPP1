'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryGameMatchRepository } = require('../src/database/repositories/game-match.repository');
const { createGameMatchService } = require('../src/services/game-match.service');

function setup() {
  const gameMatches = new InMemoryGameMatchRepository();
  const service = createGameMatchService({ gameMatches });
  return { gameMatches, service };
}

test('createMatch creates a real lobby match with a server-generated matchId', async () => {
  const { service } = setup();
  const match = await service.createMatch({ roomId: 'room_1', gameId: 'ludo', version: '1', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });
  assert.match(match.id, /^match_/);
  assert.equal(match.state, 'lobby');
  assert.equal(match.result, null);
});

test('rejects creating a match with no players', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.createMatch({ roomId: 'room_1', gameId: 'ludo', startedBy: 'usr_1', playerIds: [] }),
    (e) => e.status === 400
  );
});

test('finishMatch (server-internal only) records a result with resultSource=server', async () => {
  const { service } = setup();
  const match = await service.createMatch({ roomId: 'room_1', gameId: 'ludo', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });
  const finished = await service.finishMatch(match.id, { winnerId: 'usr_1', result: { score: [10, 4] } });
  assert.equal(finished.state, 'finished');
  assert.equal(finished.winnerId, 'usr_1');
  assert.equal(finished.resultSource, 'server');
});

test('finishMatch rejects a winnerId that was not one of the match players', async () => {
  const { service } = setup();
  const match = await service.createMatch({ roomId: 'room_1', gameId: 'ludo', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });
  await assert.rejects(
    () => service.finishMatch(match.id, { winnerId: 'usr_intruder', result: {} }),
    (e) => e.status === 400
  );
});

test('finishMatch is idempotent -- a second call cannot overwrite the first result', async () => {
  const { service } = setup();
  const match = await service.createMatch({ roomId: 'room_1', gameId: 'ludo', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });
  await service.finishMatch(match.id, { winnerId: 'usr_1', result: { score: [10, 4] } });
  const second = await service.finishMatch(match.id, { winnerId: 'usr_2', result: { score: [0, 99] } });
  assert.equal(second.winnerId, 'usr_1', 'the original real result must not be overwritten');
});

test('finishMatch on an unknown match is rejected', async () => {
  const { service } = setup();
  await assert.rejects(() => service.finishMatch('match_does_not_exist', { winnerId: 'usr_1', result: {} }), (e) => e.status === 404);
});

// ---------------------------------------------------------------------
// Stage 19 — Room Game Center framework: catalog validation, lobby
// lifecycle (join/leave/cancel/start), room-scoped listing, and
// room-membership authorization.
// ---------------------------------------------------------------------

test('createMatch rejects an unknown gameId (catalog validation)', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.createMatch({ roomId: 'room_1', gameId: 'not_a_real_game', startedBy: 'usr_1', playerIds: ['usr_1'] }),
    (e) => e.status === 400 && /gameId must be one of/.test(e.message)
  );
});

test('createMatch rejects a starting roster larger than the catalog max for that game', async () => {
  const { service } = setup();
  // chess.maxPlayers === 2 in the real catalog.
  await assert.rejects(
    () => service.createMatch({ roomId: 'room_1', gameId: 'chess', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2', 'usr_3'] }),
    (e) => e.status === 400 && /at most 2 players/.test(e.message)
  );
});

test('createMatch normalizes gameId through the catalog (defense against anything but the exact catalog id)', async () => {
  const { service } = setup();
  const match = await service.createMatch({ roomId: 'room_1', gameId: 'ludo', startedBy: 'usr_1', playerIds: ['usr_1'] });
  assert.equal(match.gameId, 'ludo');
});

test('createMatch is rejected for a session that is not a member of the room, when isRoomMember is wired in', async () => {
  const gameMatches = new InMemoryGameMatchRepository();
  const isRoomMember = async (roomId, accountId) => accountId === 'usr_member';
  const service = createGameMatchService({ gameMatches, isRoomMember });
  await assert.rejects(
    () => service.createMatch({ roomId: 'room_1', gameId: 'ludo', startedBy: 'usr_intruder', playerIds: ['usr_intruder'] }),
    (e) => e.status === 403
  );
  const ok = await service.createMatch({ roomId: 'room_1', gameId: 'ludo', startedBy: 'usr_member', playerIds: ['usr_member'] });
  assert.equal(ok.startedBy, 'usr_member');
});

test('createMatch is unaffected when isRoomMember is not supplied at all (backward-compatible default)', async () => {
  const { service } = setup(); // setup() never passes isRoomMember
  const match = await service.createMatch({ roomId: 'room_1', gameId: 'ludo', startedBy: 'anyone_at_all', playerIds: ['anyone_at_all'] });
  assert.equal(match.startedBy, 'anyone_at_all');
});

test('getMatch is visible only to a real participant', async () => {
  const { service } = setup();
  const match = await service.createMatch({ roomId: 'room_1', gameId: 'ludo', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });
  const seen = await service.getMatch('usr_2', match.id);
  assert.equal(seen.id, match.id);
  await assert.rejects(() => service.getMatch('usr_stranger', match.id), (e) => e.status === 403);
  await assert.rejects(() => service.getMatch('usr_1', 'match_does_not_exist'), (e) => e.status === 404);
});

test('listByRoom returns every match in a room regardless of who started it, and requires room membership when wired in', async () => {
  const gameMatches = new InMemoryGameMatchRepository();
  const isRoomMember = async (roomId, accountId) => accountId === 'usr_member';
  const service = createGameMatchService({ gameMatches, isRoomMember });
  await service.createMatch({ roomId: 'room_1', gameId: 'ludo', startedBy: 'usr_member', playerIds: ['usr_member'] });
  await service.createMatch({ roomId: 'room_2', gameId: 'chess', startedBy: 'usr_member', playerIds: ['usr_member'] });
  const list = await service.listByRoom('usr_member', 'room_1');
  assert.equal(list.length, 1);
  assert.equal(list[0].roomId, 'room_1');
  await assert.rejects(() => service.listByRoom('usr_intruder', 'room_1'), (e) => e.status === 403);
});

test('joinMatch adds a real member of the room to a still-open lobby, idempotently, and enforces the catalog max', async () => {
  const gameMatches = new InMemoryGameMatchRepository();
  const members = new Set(['usr_host', 'usr_2', 'usr_3']);
  const isRoomMember = async (roomId, accountId) => members.has(accountId);
  const service = createGameMatchService({ gameMatches, isRoomMember });
  const match = await service.createMatch({ roomId: 'room_1', gameId: 'chess', startedBy: 'usr_host', playerIds: ['usr_host'] });

  const joined = await service.joinMatch('usr_2', match.id);
  assert.deepEqual(joined.playerIds, ['usr_host', 'usr_2']);

  // Idempotent: joining again is a no-op, not an error.
  const again = await service.joinMatch('usr_2', match.id);
  assert.deepEqual(again.playerIds, ['usr_host', 'usr_2']);

  // chess.maxPlayers === 2 -- a third real room member cannot join a full lobby.
  await assert.rejects(() => service.joinMatch('usr_3', match.id), (e) => e.status === 409 && /full/.test(e.message));

  // A non-member of the room cannot join at all.
  await assert.rejects(() => service.joinMatch('usr_outsider', match.id), (e) => e.status === 403);
});

test('joinMatch rejects joining a match that already left lobby', async () => {
  const { service } = setup();
  const match = await service.createMatch({ roomId: 'room_1', gameId: 'ludo', startedBy: 'usr_host', playerIds: ['usr_host', 'usr_2'] });
  await service.startMatch('usr_host', match.id);
  await assert.rejects(() => service.joinMatch('usr_3', match.id), (e) => e.status === 409);
});

test('leaveMatch: a non-host player leaving just removes them from the roster', async () => {
  const { service } = setup();
  const match = await service.createMatch({ roomId: 'room_1', gameId: 'ludo', startedBy: 'usr_host', playerIds: ['usr_host', 'usr_2'] });
  const left = await service.leaveMatch('usr_2', match.id);
  assert.deepEqual(left.playerIds, ['usr_host']);
  assert.equal(left.state, 'lobby');
});

test('leaveMatch: the host leaving cancels the whole lobby', async () => {
  const { service } = setup();
  const match = await service.createMatch({ roomId: 'room_1', gameId: 'ludo', startedBy: 'usr_host', playerIds: ['usr_host', 'usr_2'] });
  const left = await service.leaveMatch('usr_host', match.id);
  assert.equal(left.state, 'cancelled');
});

test('leaveMatch rejects a caller who is not a player in the match', async () => {
  const { service } = setup();
  const match = await service.createMatch({ roomId: 'room_1', gameId: 'ludo', startedBy: 'usr_host', playerIds: ['usr_host'] });
  await assert.rejects(() => service.leaveMatch('usr_stranger', match.id), (e) => e.status === 403);
});

test('cancelMatch: only the host can cancel, and only while still in lobby', async () => {
  const { service } = setup();
  const match = await service.createMatch({ roomId: 'room_1', gameId: 'ludo', startedBy: 'usr_host', playerIds: ['usr_host', 'usr_2'] });
  await assert.rejects(() => service.cancelMatch('usr_2', match.id), (e) => e.status === 403);
  const cancelled = await service.cancelMatch('usr_host', match.id);
  assert.equal(cancelled.state, 'cancelled');
  await assert.rejects(() => service.cancelMatch('usr_host', match.id), (e) => e.status === 409);
});

test('startMatch: only the host can start, and only once the catalog minimum player count is met', async () => {
  const { service } = setup();
  // chess.minPlayers === 2 -- a lone host cannot start it yet.
  const match = await service.createMatch({ roomId: 'room_1', gameId: 'chess', startedBy: 'usr_host', playerIds: ['usr_host'] });
  await assert.rejects(() => service.startMatch('usr_host', match.id), (e) => e.status === 409 && /at least 2 players/.test(e.message));

  await service.joinMatch('usr_2', match.id);
  await assert.rejects(() => service.startMatch('usr_2', match.id), (e) => e.status === 403, 'only the host may start it');

  const started = await service.startMatch('usr_host', match.id);
  assert.equal(started.state, 'active');
  // Starting is a lifecycle transition, never a game result.
  assert.equal(started.result, null);
  assert.equal(started.winnerId, null);

  await assert.rejects(() => service.startMatch('usr_host', match.id), (e) => e.status === 409, 'cannot start twice');
});
