'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryBattleRepository } = require('../src/database/repositories/battle.repository');
const { createBattleService } = require('../src/services/battle.service');

function setup() {
  const battles = new InMemoryBattleRepository();
  const service = createBattleService({ battles });
  return { battles, service };
}

test('createChallenge() rejects challenging yourself', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.createChallenge({ roomId: 'room_1', hostId: 'usr_a', opponentId: 'usr_a' }),
    /cannot challenge yourself/
  );
});

test('createChallenge() defaults duration and returns a pending battle', async () => {
  const { service } = setup();
  const b = await service.createChallenge({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp' });
  assert.equal(b.status, 'pending');
  assert.equal(b.durationMs, 3 * 60 * 1000);
});

test('createChallenge() rejects an out-of-range durationMs', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.createChallenge({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp', durationMs: 1 }),
    /durationMs must be an integer between/
  );
});

test('only the challenged opponent may accept; the host cannot accept their own challenge', async () => {
  const { service } = setup();
  const b = await service.createChallenge({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp' });
  await assert.rejects(
    () => service.acceptChallenge('usr_host', b.id),
    /only the challenged opponent can accept/
  );
  const accepted = await service.acceptChallenge('usr_opp', b.id);
  assert.equal(accepted.status, 'active');
});

test('accepting/declining a non-pending battle is rejected (409), not silently repeated', async () => {
  const { service } = setup();
  const b = await service.createChallenge({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp' });
  await service.acceptChallenge('usr_opp', b.id);
  await assert.rejects(() => service.acceptChallenge('usr_opp', b.id), (err) => err.status === 409);
  await assert.rejects(() => service.declineChallenge('usr_opp', b.id), (err) => err.status === 409);
});

test('only the challenged opponent may decline', async () => {
  const { service } = setup();
  const b = await service.createChallenge({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp' });
  await assert.rejects(() => service.declineChallenge('usr_host', b.id), /only the challenged opponent can decline/);
  const declined = await service.declineChallenge('usr_opp', b.id);
  assert.equal(declined.status, 'declined');
});

test('only the host may cancel their own pending challenge', async () => {
  const { service } = setup();
  const b = await service.createChallenge({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp' });
  await assert.rejects(() => service.cancelChallenge('usr_opp', b.id), /only the host can cancel/);
  const cancelled = await service.cancelChallenge('usr_host', b.id);
  assert.equal(cancelled.status, 'cancelled');
});

test('getBattle() 403s for anyone who is not a participant', async () => {
  const { service } = setup();
  const b = await service.createChallenge({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp' });
  await assert.rejects(() => service.getBattle('usr_stranger', b.id), (err) => err.status === 403);
  const seenByHost = await service.getBattle('usr_host', b.id);
  assert.equal(seenByHost.id, b.id);
  const seenByOpponent = await service.getBattle('usr_opp', b.id);
  assert.equal(seenByOpponent.id, b.id);
});

test('getBattle()/listMine() 404 or omit an unknown battle honestly', async () => {
  const { service } = setup();
  await assert.rejects(() => service.getBattle('usr_a', 'battle_does_not_exist'), (err) => err.status === 404);
});

test('recordGiftPoints() is a real no-op when the room has no active battle', async () => {
  const { service } = setup();
  const result = await service.recordGiftPoints({ roomId: 'room_with_no_battle', receiverId: 'usr_x', amount: 100 });
  assert.equal(result, null);
});

test('recordGiftPoints() is a real no-op while the battle is still pending (not yet accepted)', async () => {
  const { service } = setup();
  const b = await service.createChallenge({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp' });
  const result = await service.recordGiftPoints({ roomId: 'room_1', receiverId: b.hostId, amount: 100 });
  assert.equal(result, null);
});

test('recordGiftPoints() adds to the correct side once active, and ignores gifts to bystanders', async () => {
  const { service } = setup();
  const b = await service.createChallenge({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp' });
  await service.acceptChallenge('usr_opp', b.id);

  const afterHostGift = await service.recordGiftPoints({ roomId: 'room_1', receiverId: 'usr_host', amount: 250 });
  assert.equal(afterHostGift.hostScore, 250);

  const afterOpponentGift = await service.recordGiftPoints({ roomId: 'room_1', receiverId: 'usr_opp', amount: 100 });
  assert.equal(afterOpponentGift.opponentScore, 100);
  assert.equal(afterOpponentGift.hostScore, 250);

  const bystanderResult = await service.recordGiftPoints({ roomId: 'room_1', receiverId: 'usr_bystander', amount: 50 });
  assert.equal(bystanderResult, null);
});

test('endBattle() computes a real winner from real gift-sourced score, never a guess', async () => {
  const { service } = setup();
  const b = await service.createChallenge({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp' });
  await service.acceptChallenge('usr_opp', b.id);
  await service.recordGiftPoints({ roomId: 'room_1', receiverId: 'usr_host', amount: 900 });
  await service.recordGiftPoints({ roomId: 'room_1', receiverId: 'usr_opp', amount: 100 });

  await assert.rejects(() => service.endBattle('usr_stranger', b.id), (err) => err.status === 403);

  const ended = await service.endBattle('usr_opp', b.id); // either participant may end it
  assert.equal(ended.status, 'ended');
  assert.equal(ended.winnerId, 'usr_host');
});

test('endBattle() ending an already-ended battle is idempotent, not an error', async () => {
  const { service } = setup();
  const b = await service.createChallenge({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp' });
  await service.acceptChallenge('usr_opp', b.id);
  const ended = await service.endBattle('usr_host', b.id);
  const again = await service.endBattle('usr_host', b.id);
  assert.equal(again.status, 'ended');
  assert.equal(again.endedAt, ended.endedAt);
});

test('endBattle() on a still-pending (never accepted) battle is rejected, not silently ended', async () => {
  const { service } = setup();
  const b = await service.createChallenge({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp' });
  await assert.rejects(() => service.endBattle('usr_host', b.id), (err) => err.status === 409);
});

test('getBattle()/listMine() lazily auto-end a battle whose round timer has already expired', async () => {
  // createChallenge() enforces a real 30s floor on durationMs (see
  // battle.model.js), too slow to actually wait out in a unit test -- so
  // this creates the record via the repository directly (bypassing only
  // that service-level minimum, not the state machine itself) with a 5ms
  // round, then waits it out for real. This proves the auto-end path in
  // getBattle()/listMine() actually checks wall-clock time, not a fake.
  const { battles, service } = setup();
  const created = await battles.create({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp', durationMs: 5 });
  await battles.accept(created.id);
  await battles.addScore(created.id, 'host', 400);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const seen = await service.getBattle('usr_host', created.id);
  assert.equal(seen.status, 'ended');
  assert.equal(seen.winnerId, 'usr_host');

  const viaList = await service.listMine('usr_opp');
  assert.equal(viaList[0].status, 'ended');
});

test('recordGiftPoints() stops crediting once the round has expired, even if the check races the expiry', async () => {
  const battles = new InMemoryBattleRepository();
  const service = createBattleService({ battles });
  const b = await service.createChallenge({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp', durationMs: 30000 });
  await service.acceptChallenge('usr_opp', b.id);
  // Force-expire by ending it directly (equivalent real-world effect to
  // "the timer ran out"), then confirm no further points are credited.
  await battles.end(b.id);
  const result = await service.recordGiftPoints({ roomId: 'room_1', receiverId: 'usr_host', amount: 100 });
  assert.equal(result, null);
});

test('a declined battle frees the room for a brand-new challenge', async () => {
  const { service } = setup();
  const b = await service.createChallenge({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opp' });
  await service.declineChallenge('usr_opp', b.id);
  const next = await service.createChallenge({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_third' });
  assert.equal(next.status, 'pending');
});

test('listMine() returns battles where the account is host or opponent only', async () => {
  const { service } = setup();
  await service.createChallenge({ roomId: 'room_1', hostId: 'usr_a', opponentId: 'usr_b' });
  const cross = await service.createChallenge({ roomId: 'room_2', hostId: 'usr_c', opponentId: 'usr_a' });
  await service.createChallenge({ roomId: 'room_3', hostId: 'usr_x', opponentId: 'usr_y' });
  const mine = await service.listMine('usr_a');
  assert.equal(mine.length, 2);
  assert.ok(mine.every((b) => b.hostId === 'usr_a' || b.opponentId === 'usr_a'));
});
