'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryGiftWallRepository } = require('../src/database/repositories/gift-wall.repository');
const { createGiftWallService } = require('../src/services/gift-wall.service');

function setup() {
  const giftWall = new InMemoryGiftWallRepository();
  const service = createGiftWallService({ giftWall });
  return { giftWall, service };
}

// --- Basic contribution accounting -------------------------------------

test('sending a gift records the correct contribution for the gifter', async () => {
  const { service } = setup();
  const result = await service.recordContribution({ roomId: 'room_1', gifterId: 'usr_a', giftId: 'gift_rec_1', amount: 50 });
  assert.equal(result.applied, true);
  assert.equal(result.totalCoins, 50);

  const wall = await service.getWall('room_1');
  assert.equal(wall.totalCoins, 50);
  assert.deepEqual(wall.gifters, [{ gifterId: 'usr_a', totalCoins: 50 }]);
});

test('sending several gifts from the same gifter accumulates their total', async () => {
  const { service } = setup();
  await service.recordContribution({ roomId: 'room_1', gifterId: 'usr_a', giftId: 'g1', amount: 10 });
  await service.recordContribution({ roomId: 'room_1', gifterId: 'usr_a', giftId: 'g2', amount: 20 });
  await service.recordContribution({ roomId: 'room_1', gifterId: 'usr_a', giftId: 'g3', amount: 5 });

  const wall = await service.getWall('room_1');
  assert.equal(wall.gifters.length, 1, 'the same gifter must be a single ranked entry, not one row per gift');
  assert.equal(wall.gifters[0].totalCoins, 35);
});

// --- Top 3 ranking -------------------------------------------------------

test('more than 3 gifters -- top 3 are ranked correctly by real spend, and a 4th+ gifter is excluded from topGifters', async () => {
  const { service } = setup();
  await service.recordContribution({ roomId: 'room_1', gifterId: 'usr_a', giftId: 'g1', amount: 100 });
  await service.recordContribution({ roomId: 'room_1', gifterId: 'usr_b', giftId: 'g2', amount: 500 });
  await service.recordContribution({ roomId: 'room_1', gifterId: 'usr_c', giftId: 'g3', amount: 250 });
  await service.recordContribution({ roomId: 'room_1', gifterId: 'usr_d', giftId: 'g4', amount: 10 });

  const wall = await service.getWall('room_1');
  assert.deepEqual(wall.topGifters.map((g) => g.gifterId), ['usr_b', 'usr_c', 'usr_a'], 'top 3 must be ordered strictly by real total spend, highest first');
  assert.equal(wall.topGifters.length, 3);
  assert.ok(!wall.topGifters.some((g) => g.gifterId === 'usr_d'), 'a gifter outside the top 3 must not appear in topGifters');
  // but the 4th gifter is still tracked in the full ranked list, just not in the top 3
  assert.ok(wall.gifters.some((g) => g.gifterId === 'usr_d'));
});

test('a gifter who sends multiple smaller gifts can still overtake a single big spender for a top-3 spot', async () => {
  const { service } = setup();
  await service.recordContribution({ roomId: 'room_1', gifterId: 'usr_big_single', giftId: 'g1', amount: 100 });
  await service.recordContribution({ roomId: 'room_1', gifterId: 'usr_many_small', giftId: 'g2', amount: 40 });
  await service.recordContribution({ roomId: 'room_1', gifterId: 'usr_many_small', giftId: 'g3', amount: 40 });
  await service.recordContribution({ roomId: 'room_1', gifterId: 'usr_many_small', giftId: 'g4', amount: 40 });

  const wall = await service.getWall('room_1');
  assert.equal(wall.topGifters[0].gifterId, 'usr_many_small');
  assert.equal(wall.topGifters[0].totalCoins, 120);
});

// --- Session isolation ---------------------------------------------------

test('different rooms have completely independent gift walls', async () => {
  const { service } = setup();
  await service.recordContribution({ roomId: 'room_1', gifterId: 'usr_a', giftId: 'g1', amount: 10 });
  await service.recordContribution({ roomId: 'room_2', gifterId: 'usr_a', giftId: 'g2', amount: 9999 });

  const wall1 = await service.getWall('room_1');
  const wall2 = await service.getWall('room_2');
  assert.equal(wall1.totalCoins, 10);
  assert.equal(wall2.totalCoins, 9999);
  assert.notEqual(wall1.sessionId, wall2.sessionId);
});

test('closing a Host Room Session resets/ends the gift wall for that room', async () => {
  const { service } = setup();
  await service.recordContribution({ roomId: 'room_1', gifterId: 'usr_a', giftId: 'g1', amount: 100 });
  const beforeClose = await service.getWall('room_1');
  assert.equal(beforeClose.status, 'active');
  assert.equal(beforeClose.totalCoins, 100);

  const closeResult = await service.closeSession('room_1');
  assert.equal(closeResult.status, 'closed');
  assert.equal(closeResult.totalCoins, 100, 'the close result must report the real final total for that ended session');
  assert.equal(closeResult.finalTopGifters[0].gifterId, 'usr_a');

  const afterClose = await service.getWall('room_1');
  assert.equal(afterClose.status, 'inactive', 'the room must show no active wall right after close');
  assert.equal(afterClose.totalCoins, 0);
  assert.deepEqual(afterClose.gifters, []);
});

test('a new Host Room Session for the same room never mixes with the previous (closed) session\'s totals', async () => {
  const { service } = setup();
  await service.recordContribution({ roomId: 'room_1', gifterId: 'usr_a', giftId: 'g1', amount: 100 });
  await service.closeSession('room_1');

  // A new gift arrives after the session was closed -- this must open a
  // brand-new session with a clean wall, not resurrect/append to the old one.
  await service.recordContribution({ roomId: 'room_1', gifterId: 'usr_b', giftId: 'g2', amount: 30 });
  const wall = await service.getWall('room_1');
  assert.equal(wall.status, 'active');
  assert.equal(wall.totalCoins, 30, 'only the new session\'s gifts count -- the old, closed session\'s 100 must not be included');
  assert.equal(wall.gifters.length, 1);
  assert.equal(wall.gifters[0].gifterId, 'usr_b');
});

test('closing a room with no active session is rejected with a real 404, not a silent success', async () => {
  const { service } = setup();
  await assert.rejects(() => service.closeSession('room_never_had_gifts'), (e) => e.status === 404);
});

// --- Server-authoritative amounts / anti-tampering ------------------------

test('recordContribution rejects a non-numeric/non-integer amount (a client could never inject a fractional or NaN value this way)', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.recordContribution({ roomId: 'room_1', gifterId: 'usr_a', giftId: 'g1', amount: '100' }),
    (e) => e.status === 400
  );
  await assert.rejects(
    () => service.recordContribution({ roomId: 'room_1', gifterId: 'usr_a', giftId: 'g2', amount: NaN }),
    (e) => e.status === 400
  );
});

test('recordContribution rejects a zero or negative amount -- a manipulated/free "gift" can never land on the wall', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.recordContribution({ roomId: 'room_1', gifterId: 'usr_a', giftId: 'g1', amount: 0 }),
    (e) => e.status === 400
  );
  await assert.rejects(
    () => service.recordContribution({ roomId: 'room_1', gifterId: 'usr_a', giftId: 'g2', amount: -50 }),
    (e) => e.status === 400
  );
  const wall = await service.getWall('room_1');
  assert.equal(wall.status, 'inactive', 'a rejected contribution must never create a session or appear on the wall');
});

test('recordContribution requires roomId/gifterId/giftId -- cannot be called with a missing identity field', async () => {
  const { service } = setup();
  await assert.rejects(() => service.recordContribution({ gifterId: 'usr_a', giftId: 'g1', amount: 10 }), (e) => e.status === 400);
  await assert.rejects(() => service.recordContribution({ roomId: 'room_1', giftId: 'g1', amount: 10 }), (e) => e.status === 400);
  await assert.rejects(() => service.recordContribution({ roomId: 'room_1', gifterId: 'usr_a', amount: 10 }), (e) => e.status === 400);
});

// --- Double counting / double deduction -----------------------------------

test('recordContribution is idempotent per real gift id -- no double counting even if called twice for the same gift', async () => {
  const { service } = setup();
  const first = await service.recordContribution({ roomId: 'room_1', gifterId: 'usr_a', giftId: 'gift_dup', amount: 40 });
  const second = await service.recordContribution({ roomId: 'room_1', gifterId: 'usr_a', giftId: 'gift_dup', amount: 40 });
  assert.equal(first.applied, true);
  assert.equal(second.applied, false);

  const wall = await service.getWall('room_1');
  assert.equal(wall.totalCoins, 40, 'the same real gift id must only ever count once toward the wall');
});

// --- Edge cases ------------------------------------------------------------

test('getWall for a room that has never received a gift returns an honest empty/inactive wall, not a fake placeholder', async () => {
  const { service } = setup();
  const wall = await service.getWall('room_untouched');
  assert.equal(wall.status, 'inactive');
  assert.equal(wall.sessionId, null);
  assert.deepEqual(wall.gifters, []);
  assert.deepEqual(wall.topGifters, []);
  assert.equal(wall.totalCoins, 0);
});

test('exactly 3 gifters all appear in topGifters (boundary: not fewer, not requiring a 4th to exist)', async () => {
  const { service } = setup();
  await service.recordContribution({ roomId: 'room_1', gifterId: 'usr_a', giftId: 'g1', amount: 30 });
  await service.recordContribution({ roomId: 'room_1', gifterId: 'usr_b', giftId: 'g2', amount: 20 });
  await service.recordContribution({ roomId: 'room_1', gifterId: 'usr_c', giftId: 'g3', amount: 10 });
  const wall = await service.getWall('room_1');
  assert.equal(wall.topGifters.length, 3);
});

test('a tie in total spend still yields a stable top-3 list (both tied gifters counted, no gifter dropped or duplicated)', async () => {
  const { service } = setup();
  await service.recordContribution({ roomId: 'room_1', gifterId: 'usr_a', giftId: 'g1', amount: 50 });
  await service.recordContribution({ roomId: 'room_1', gifterId: 'usr_b', giftId: 'g2', amount: 50 });
  const wall = await service.getWall('room_1');
  assert.equal(wall.topGifters.length, 2);
  assert.equal(new Set(wall.topGifters.map((g) => g.gifterId)).size, 2);
});
