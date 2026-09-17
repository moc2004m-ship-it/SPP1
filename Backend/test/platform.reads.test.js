'use strict';
// Phase 4 -- pure-logic tests for the new GET/read query helpers backing
// Battles/Games/Gifts(Gift Wall)/Family/Settings/Moderation+Support.
// Deliberately dependency-free (no express, no supertest, no HTTP), same
// rationale as platform.auth.guards.test.js: these run in environments
// without npm/network access. The actual GET route handlers in
// platform.routes.js are thin wrappers around these functions (fetch from
// platform.store.list, then filter/reduce with the function under test
// here), so exercising the pure functions directly with realistic records
// verifies the real behavior without needing a live Express server.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPlatform } = require('../src/feature-platform');
const {
  myGames, giftsForRoom, latestSettingsByKey, myReports, myTickets,
} = require('../src/routes/platform.reads');

// Stage 18 -- the old myBattles() pure-filter test lived here. Battles
// moved off the generic feature_records store onto their own dedicated
// repository/service; the equivalent "host or opponent" filtering is now
// covered by battle.service.test.js#listMine against the real service,
// not a standalone array helper. See platform.reads.js's own removal note.

test('myGames returns only games started by the given account', async () => {
  const p = createPlatform();
  await p.games.create({ roomId: 'room_1', gameId: 'ludo', startedBy: 'acc_a' });
  await p.games.create({ roomId: 'room_2', gameId: 'chess', startedBy: 'acc_b' });
  const all = await p.store.list(19);
  const mine = myGames(all, 'acc_a');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].gameId, 'ludo');
});

test('games.create requires startedBy (identity must come from the session, not be omitted)', async () => {
  const p = createPlatform();
  // Validation (requireId) runs synchronously while building the record
  // passed to store.add, before any Promise is returned -- same as every
  // other required-field check in feature-platform.js (see the existing
  // synchronous assert.throws for wallet.ledger's referenceId check above).
  assert.throws(() => p.games.create({ roomId: 'room_1', gameId: 'ludo' }), /startedBy/);
  const game = await p.games.create({ roomId: 'room_1', gameId: 'ludo', startedBy: 'acc_a' });
  assert.equal(game.startedBy, 'acc_a');
});

test('giftsForRoom returns only gifts sent in the given room (the gift wall is room-scoped, not user-scoped)', async () => {
  const p = createPlatform();
  await p.gifts.send({ roomId: 'room_1', senderId: 'acc_a', receiverId: 'acc_b', giftId: 'rose', referenceId: 'ref_1' });
  await p.gifts.send({ roomId: 'room_1', senderId: 'acc_c', receiverId: 'acc_d', giftId: 'car', referenceId: 'ref_2' });
  await p.gifts.send({ roomId: 'room_2', senderId: 'acc_a', receiverId: 'acc_b', giftId: 'rose', referenceId: 'ref_3' });
  const all = await p.store.list(26);
  const wall = giftsForRoom(all, 'room_1');
  assert.equal(wall.length, 2);
  assert.ok(wall.every((g) => g.roomId === 'room_1'));
});

test('latestSettingsByKey collapses an append-only settings history to one record per key (most recent wins)', () => {
  const rows = [
    { key: 'locale', value: 'en', updatedAt: '1' },
    { key: 'theme', value: 'dark', updatedAt: '2' },
    { key: 'locale', value: 'ar', updatedAt: '3' },
  ];
  const latest = latestSettingsByKey(rows);
  assert.equal(latest.length, 2);
  const locale = latest.find((r) => r.key === 'locale');
  assert.equal(locale.value, 'ar');
});

test('myReports and myTickets both live in stage 35 but are told apart structurally, and each is scoped to its own reporter', async () => {
  const p = createPlatform();
  await p.moderation.report({ reporterId: 'acc_a', targetId: 'acc_bad', reason: 'spam' });
  await p.moderation.ticket({ reporterId: 'acc_a', type: 'billing', description: 'missing coins' });
  await p.moderation.report({ reporterId: 'acc_b', targetId: 'acc_bad2', reason: 'abuse' });
  const all = await p.store.list(35);

  const reportsA = myReports(all, 'acc_a');
  assert.equal(reportsA.length, 1);
  assert.equal(reportsA[0].targetId, 'acc_bad');

  const ticketsA = myTickets(all, 'acc_a');
  assert.equal(ticketsA.length, 1);
  assert.equal(ticketsA[0].type, 'billing');

  assert.equal(myReports(all, 'acc_b').length, 1);
  assert.equal(myTickets(all, 'acc_b').length, 0);
});
