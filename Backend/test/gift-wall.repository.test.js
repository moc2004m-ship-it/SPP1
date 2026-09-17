'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryGiftWallRepository } = require('../src/database/repositories/gift-wall.repository');

// Stage 26 -- Gift Wall repository. Pure persistence-level tests, no
// express/network dependency (same pattern as gift.repository.test.js).

test('getActiveSession returns null for a room that has never had a gift wall session', async () => {
  const repo = new InMemoryGiftWallRepository();
  assert.equal(await repo.getActiveSession('room_never_used'), null);
});

test('getOrCreateActiveSession creates exactly one active session per room, reused on repeat calls', async () => {
  const repo = new InMemoryGiftWallRepository();
  const first = await repo.getOrCreateActiveSession('room_1');
  const second = await repo.getOrCreateActiveSession('room_1');
  assert.equal(first.id, second.id, 'the same room must reuse its one active session, not create a second one');
  assert.equal(first.status, 'active');
  assert.equal(first.roomId, 'room_1');
});

test('two different rooms get two independent active sessions', async () => {
  const repo = new InMemoryGiftWallRepository();
  const a = await repo.getOrCreateActiveSession('room_a');
  const b = await repo.getOrCreateActiveSession('room_b');
  assert.notEqual(a.id, b.id);
});

test('addContribution accumulates totals per gifter within a session', async () => {
  const repo = new InMemoryGiftWallRepository();
  const session = await repo.getOrCreateActiveSession('room_1');
  await repo.addContribution({ sessionId: session.id, gifterId: 'g1', giftId: 'gift_1', amount: 10 });
  const second = await repo.addContribution({ sessionId: session.id, gifterId: 'g1', giftId: 'gift_2', amount: 25 });
  assert.equal(second.applied, true);
  assert.equal(second.totalCoins, 35);
});

test('applying the same giftId twice is a no-op -- no double counting', async () => {
  const repo = new InMemoryGiftWallRepository();
  const session = await repo.getOrCreateActiveSession('room_1');
  const first = await repo.addContribution({ sessionId: session.id, gifterId: 'g1', giftId: 'gift_dup', amount: 50 });
  const second = await repo.addContribution({ sessionId: session.id, gifterId: 'g1', giftId: 'gift_dup', amount: 50 });
  assert.equal(first.applied, true);
  assert.equal(second.applied, false, 'a gift already applied to the wall must never be re-applied');
  assert.equal(second.totalCoins, 50, 'the total must stay at the single real contribution, not double');
});

test('getContributions returns gifters sorted highest total first', async () => {
  const repo = new InMemoryGiftWallRepository();
  const session = await repo.getOrCreateActiveSession('room_1');
  await repo.addContribution({ sessionId: session.id, gifterId: 'low', giftId: 'g1', amount: 5 });
  await repo.addContribution({ sessionId: session.id, gifterId: 'high', giftId: 'g2', amount: 500 });
  await repo.addContribution({ sessionId: session.id, gifterId: 'mid', giftId: 'g3', amount: 50 });
  const contributions = await repo.getContributions(session.id);
  assert.deepEqual(contributions.map((c) => c.gifterId), ['high', 'mid', 'low']);
});

test('closeSession marks the session closed and frees the room for a brand new active session', async () => {
  const repo = new InMemoryGiftWallRepository();
  const session = await repo.getOrCreateActiveSession('room_1');
  const closed = await repo.closeSession(session.id);
  assert.equal(closed.status, 'closed');
  assert.ok(closed.closedAt);
  assert.equal(await repo.getActiveSession('room_1'), null, 'a closed session must no longer be "the active session" for its room');

  const next = await repo.getOrCreateActiveSession('room_1');
  assert.notEqual(next.id, session.id, 'the next session after a close must be a brand new one, not the closed one reused');
});

test('closing an already-closed session is idempotent, not an error', async () => {
  const repo = new InMemoryGiftWallRepository();
  const session = await repo.getOrCreateActiveSession('room_1');
  await repo.closeSession(session.id);
  const secondClose = await repo.closeSession(session.id);
  assert.equal(secondClose.status, 'closed');
});

test('closing an unknown session id throws a real 404, never a silent success', async () => {
  const repo = new InMemoryGiftWallRepository();
  await assert.rejects(() => repo.closeSession('gws_does_not_exist'), (e) => e.status === 404);
});

test('contributions/sessions from different rooms never mix', async () => {
  const repo = new InMemoryGiftWallRepository();
  const sessionA = await repo.getOrCreateActiveSession('room_a');
  const sessionB = await repo.getOrCreateActiveSession('room_b');
  await repo.addContribution({ sessionId: sessionA.id, gifterId: 'g1', giftId: 'gift_a1', amount: 10 });
  await repo.addContribution({ sessionId: sessionB.id, gifterId: 'g1', giftId: 'gift_b1', amount: 999 });

  const wallA = await repo.getContributions(sessionA.id);
  const wallB = await repo.getContributions(sessionB.id);
  assert.deepEqual(wallA, [{ gifterId: 'g1', totalCoins: 10 }]);
  assert.deepEqual(wallB, [{ gifterId: 'g1', totalCoins: 999 }]);
});

test('contributions after closing one session and starting a new one for the same room are isolated (old session totals frozen, new session starts at zero)', async () => {
  const repo = new InMemoryGiftWallRepository();
  const first = await repo.getOrCreateActiveSession('room_1');
  await repo.addContribution({ sessionId: first.id, gifterId: 'g1', giftId: 'gift_1', amount: 100 });
  await repo.closeSession(first.id);

  const second = await repo.getOrCreateActiveSession('room_1');
  const secondWall = await repo.getContributions(second.id);
  assert.deepEqual(secondWall, [], 'a brand new session must start with an empty wall, not inherit the old totals');

  const firstWallStillIntact = await repo.getContributions(first.id);
  assert.deepEqual(firstWallStillIntact, [{ gifterId: 'g1', totalCoins: 100 }], 'the closed session\'s own historical totals must remain queryable/unchanged');
});
