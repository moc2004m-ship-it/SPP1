'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryBattleRepository } = require('../src/database/repositories/battle.repository');

function repo() {
  return new InMemoryBattleRepository();
}

test('create() returns a pending battle with zero scores and no timer yet', async () => {
  const battles = repo();
  const b = await battles.create({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp', durationMs: 60000 });
  assert.match(b.id, /^battle_/);
  assert.equal(b.status, 'pending');
  assert.equal(b.hostScore, 0);
  assert.equal(b.opponentScore, 0);
  assert.equal(b.winnerId, null);
  assert.equal(b.startedAt, null);
  assert.equal(b.endsAt, null);
});

test('create() rejects a second battle in a room that already has a pending/active one', async () => {
  const battles = repo();
  await battles.create({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp', durationMs: 60000 });
  await assert.rejects(
    () => battles.create({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_other', durationMs: 60000 }),
    /already has a pending or active battle/
  );
});

test('accept() moves pending -> active and sets startedAt/endsAt; is idempotent', async () => {
  const battles = repo();
  const created = await battles.create({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp', durationMs: 60000 });
  const accepted = await battles.accept(created.id);
  assert.equal(accepted.status, 'active');
  assert.ok(accepted.startedAt);
  assert.ok(accepted.endsAt);
  const again = await battles.accept(created.id);
  assert.equal(again.status, 'active');
  assert.equal(again.startedAt, accepted.startedAt); // unchanged on repeat call
});

test('decline() moves pending -> declined and frees the room slot', async () => {
  const battles = repo();
  const created = await battles.create({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp', durationMs: 60000 });
  const declined = await battles.decline(created.id);
  assert.equal(declined.status, 'declined');
  // room slot freed -- a new challenge can now be created in this room
  const next = await battles.create({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_other', durationMs: 60000 });
  assert.equal(next.status, 'pending');
});

test('cancel() only affects a pending battle and frees the room slot', async () => {
  const battles = repo();
  const created = await battles.create({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp', durationMs: 60000 });
  const cancelled = await battles.cancel(created.id);
  assert.equal(cancelled.status, 'cancelled');
  const next = await battles.create({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_other', durationMs: 60000 });
  assert.equal(next.status, 'pending');
});

test('addScore() only applies while active, and is a no-op otherwise', async () => {
  const battles = repo();
  const created = await battles.create({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp', durationMs: 60000 });
  const stillPending = await battles.addScore(created.id, 'host', 500);
  assert.equal(stillPending.hostScore, 0); // pending -- not active yet, no-op

  await battles.accept(created.id);
  const afterHost = await battles.addScore(created.id, 'host', 500);
  assert.equal(afterHost.hostScore, 500);
  const afterOpponent = await battles.addScore(created.id, 'opponent', 300);
  assert.equal(afterOpponent.opponentScore, 300);
  assert.equal(afterOpponent.hostScore, 500); // unaffected by the opponent's addition
});

test('end() computes a real winner from scores and frees the room slot; is idempotent', async () => {
  const battles = repo();
  const created = await battles.create({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp', durationMs: 60000 });
  await battles.accept(created.id);
  await battles.addScore(created.id, 'host', 700);
  await battles.addScore(created.id, 'opponent', 300);
  const ended = await battles.end(created.id);
  assert.equal(ended.status, 'ended');
  assert.equal(ended.winnerId, 'usr_host');
  assert.ok(ended.endedAt);

  const again = await battles.end(created.id);
  assert.equal(again.status, 'ended');
  assert.equal(again.endedAt, ended.endedAt); // unchanged on repeat call

  const next = await battles.create({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_other', durationMs: 60000 });
  assert.equal(next.status, 'pending');
});

test('end() on a tie leaves winnerId null -- never guessed', async () => {
  const battles = repo();
  const created = await battles.create({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp', durationMs: 60000 });
  await battles.accept(created.id);
  await battles.addScore(created.id, 'host', 200);
  await battles.addScore(created.id, 'opponent', 200);
  const ended = await battles.end(created.id);
  assert.equal(ended.winnerId, null);
});

test('listByAccount() returns battles where the account is host or opponent, newest first', async () => {
  const battles = repo();
  const b1 = await battles.create({ roomId: 'room_1', hostId: 'usr_a', opponentId: 'usr_b', durationMs: 60000 });
  await battles.decline(b1.id);
  const b2 = await battles.create({ roomId: 'room_2', hostId: 'usr_c', opponentId: 'usr_a', durationMs: 60000 });
  await battles.create({ roomId: 'room_3', hostId: 'usr_x', opponentId: 'usr_y', durationMs: 60000 });
  const mine = await battles.listByAccount('usr_a');
  assert.equal(mine.length, 2);
  assert.ok(mine.every((b) => b.hostId === 'usr_a' || b.opponentId === 'usr_a'));
  assert.equal(mine[0].id, b2.id); // newest first
});

test('findOpenByRoom() returns the pending/active battle for a room, or null once it is closed', async () => {
  const battles = repo();
  const created = await battles.create({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp', durationMs: 60000 });
  const open = await battles.findOpenByRoom('room_1');
  assert.equal(open.id, created.id);
  await battles.decline(created.id);
  assert.equal(await battles.findOpenByRoom('room_1'), null);
});
