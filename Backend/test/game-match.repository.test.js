'use strict';
// Stage 19 — repository-level tests for the new lobby lifecycle methods
// (listByRoom/addPlayer/removePlayer/cancel/start) added to
// src/database/repositories/game-match.repository.js. Exercises the real
// InMemoryGameMatchRepository directly (no service layer) so the
// repository's own "lobby-only, first-transition-wins" guarantees are
// proven independently of any authorization/catalog logic layered on top
// in game-match.service.js (covered separately in
// game-match.service.test.js). The PostgresGameMatchRepository
// implementation of these same methods is written but not exercised here
// -- no live Postgres in this environment, same permanent environmental
// blocker documented in every other stage's report in this project.

const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryGameMatchRepository } = require('../src/database/repositories/game-match.repository');

async function makeLobby(repo, overrides = {}) {
  return repo.create({
    roomId: 'room_1',
    gameId: 'ludo',
    version: '1',
    startedBy: 'usr_host',
    playerIds: ['usr_host'],
    ...overrides,
  });
}

test('listByRoom returns every match created in that room, most recent first, and none from another room', async () => {
  const repo = new InMemoryGameMatchRepository();
  const a = await makeLobby(repo);
  // A tiny real delay guarantees a strictly later createdAt timestamp for
  // b than a -- without it, two synchronous in-memory creates can land in
  // the same millisecond, making "most recent first" order ambiguous
  // rather than actually wrong.
  await new Promise((resolve) => setTimeout(resolve, 2));
  const b = await repo.create({ roomId: 'room_1', gameId: 'chess', version: '1', startedBy: 'usr_host', playerIds: ['usr_host'] });
  await repo.create({ roomId: 'room_2', gameId: 'ludo', version: '1', startedBy: 'usr_host', playerIds: ['usr_host'] });

  const list = await repo.listByRoom('room_1');
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((m) => m.id), [b.id, a.id]);
});

test('addPlayer appends a new player to a lobby match', async () => {
  const repo = new InMemoryGameMatchRepository();
  const match = await makeLobby(repo);
  const updated = await repo.addPlayer(match.id, 'usr_2');
  assert.deepEqual(updated.playerIds, ['usr_host', 'usr_2']);
});

test('addPlayer is idempotent -- adding the same player twice does not duplicate them', async () => {
  const repo = new InMemoryGameMatchRepository();
  const match = await makeLobby(repo);
  await repo.addPlayer(match.id, 'usr_2');
  const again = await repo.addPlayer(match.id, 'usr_2');
  assert.deepEqual(again.playerIds, ['usr_host', 'usr_2']);
});

test('addPlayer is a no-op once the match has left lobby', async () => {
  const repo = new InMemoryGameMatchRepository();
  const match = await makeLobby(repo);
  await repo.start(match.id);
  const unchanged = await repo.addPlayer(match.id, 'usr_late');
  assert.deepEqual(unchanged.playerIds, ['usr_host']);
  assert.equal(unchanged.state, 'active');
});

test('removePlayer removes exactly the given player and leaves the rest', async () => {
  const repo = new InMemoryGameMatchRepository();
  const match = await makeLobby(repo, { playerIds: ['usr_host', 'usr_2', 'usr_3'] });
  const updated = await repo.removePlayer(match.id, 'usr_2');
  assert.deepEqual(updated.playerIds, ['usr_host', 'usr_3']);
});

test('removePlayer is a no-op once the match has left lobby', async () => {
  const repo = new InMemoryGameMatchRepository();
  const match = await makeLobby(repo, { playerIds: ['usr_host', 'usr_2'] });
  await repo.start(match.id);
  const unchanged = await repo.removePlayer(match.id, 'usr_2');
  assert.deepEqual(unchanged.playerIds, ['usr_host', 'usr_2']);
});

test('cancel moves a lobby match to cancelled and never touches result/winnerId', async () => {
  const repo = new InMemoryGameMatchRepository();
  const match = await makeLobby(repo);
  const cancelled = await repo.cancel(match.id);
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(cancelled.result, null);
  assert.equal(cancelled.winnerId, null);
});

test('cancel is idempotent -- first call wins, a second call does not change the state again', async () => {
  const repo = new InMemoryGameMatchRepository();
  const match = await makeLobby(repo);
  await repo.cancel(match.id);
  const second = await repo.cancel(match.id);
  assert.equal(second.state, 'cancelled');
});

test('cancel is a no-op on a match that already started (only lobby -> cancelled is real)', async () => {
  const repo = new InMemoryGameMatchRepository();
  const match = await makeLobby(repo);
  await repo.start(match.id);
  const unchanged = await repo.cancel(match.id);
  assert.equal(unchanged.state, 'active', 'an active match must not be silently cancelled');
});

test('start moves a lobby match to active and never sets a result/winner', async () => {
  const repo = new InMemoryGameMatchRepository();
  const match = await makeLobby(repo);
  const started = await repo.start(match.id);
  assert.equal(started.state, 'active');
  assert.equal(started.result, null);
  assert.equal(started.winnerId, null);
  assert.equal(started.resultSource, null);
});

test('start is a no-op once the match is no longer in lobby (e.g. already cancelled)', async () => {
  const repo = new InMemoryGameMatchRepository();
  const match = await makeLobby(repo);
  await repo.cancel(match.id);
  const unchanged = await repo.start(match.id);
  assert.equal(unchanged.state, 'cancelled', 'a cancelled match must never be resurrected into active');
});

test('addPlayer/removePlayer/cancel/start on an unknown match id all return null', async () => {
  const repo = new InMemoryGameMatchRepository();
  assert.equal(await repo.addPlayer('match_missing', 'usr_x'), null);
  assert.equal(await repo.removePlayer('match_missing', 'usr_x'), null);
  assert.equal(await repo.cancel('match_missing'), null);
  assert.equal(await repo.start('match_missing'), null);
});
