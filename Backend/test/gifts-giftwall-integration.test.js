'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryWalletRepository } = require('../src/database/repositories/wallet.repository');
const { InMemoryGiftRepository } = require('../src/database/repositories/gift.repository');
const { InMemoryGiftWallRepository } = require('../src/database/repositories/gift-wall.repository');
const { createGiftsService } = require('../src/services/gifts.service');
const { createGiftWallService } = require('../src/services/gift-wall.service');

// Stage 26 -- end-to-end: a real sendGift() call (real wallet debit, real
// gift.repository.js record) must be the ONLY thing that can put a gifter
// on the Gift Wall, and the amount credited to the wall must always be the
// exact real coins already deducted -- never a client-supplied quantity or
// price. This is the integration seam between the pre-existing gifts
// system (Phase 5) and the new Stage 26 Gift Wall.

function setupFullStack() {
  const wallets = new InMemoryWalletRepository();
  const gifts = new InMemoryGiftRepository();
  const giftWall = new InMemoryGiftWallRepository();
  const giftWallService = createGiftWallService({ giftWall });
  const giftsService = createGiftsService({ wallets, gifts, giftWallService });
  return { wallets, gifts, giftWall, giftWallService, giftsService };
}

test('a real sendGift() call puts the real, server-priced amount on the room\'s gift wall', async () => {
  const { wallets, giftsService, giftWallService } = setupFullStack();
  await wallets.credit('usr_sender', 'coins', 1000, 'seed-0001');
  await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_heart', quantity: 2 }); // 50 * 2 = 100

  const wall = await giftWallService.getWall('room_1');
  assert.equal(wall.totalCoins, 100, 'the wall must reflect the real catalog price * quantity, computed server-side by gifts.service.js');
  assert.deepEqual(wall.gifters, [{ gifterId: 'usr_sender', totalCoins: 100 }]);
});

test('an insufficient-balance send (rejected before any gift record exists) never touches the gift wall', async () => {
  const { wallets, giftsService, giftWallService } = setupFullStack();
  await wallets.credit('usr_sender', 'coins', 5, 'seed-0001'); // not enough for a rose (10)
  await assert.rejects(
    () => giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_rose', quantity: 1 }),
    (e) => e.status === 409
  );
  const wall = await giftWallService.getWall('room_1');
  assert.equal(wall.status, 'inactive', 'a failed debit must create no wall session at all');
});

test('an unknown giftId (a client trying to smuggle a fake/unpriced gift) is rejected and never reaches the wall', async () => {
  const { wallets, giftsService, giftWallService } = setupFullStack();
  await wallets.credit('usr_sender', 'coins', 1000, 'seed-0001');
  await assert.rejects(
    () => giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_does_not_exist', quantity: 1 }),
    (e) => e.status === 400
  );
  const wall = await giftWallService.getWall('room_1');
  assert.equal(wall.totalCoins, 0);
});

test('there is no separate/second wallet debit caused by the gift wall integration -- exactly one debit per real send', async () => {
  const { wallets, giftsService } = setupFullStack();
  await wallets.credit('usr_sender', 'coins', 1000, 'seed-0001');
  await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_rose', quantity: 1 }); // costs 10
  const balance = await wallets.getBalance('usr_sender');
  assert.equal(balance.coins, 990, 'the gift wall must never cause an additional debit beyond gifts.service.js\'s own single debit');
});

test('repeated real sends from the same sender in the same room accumulate correctly on the wall', async () => {
  const { wallets, giftsService, giftWallService } = setupFullStack();
  await wallets.credit('usr_sender', 'coins', 1000, 'seed-0001');
  await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_rose', quantity: 1 }); // 10
  await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_rose', quantity: 1 }); // +10
  await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_crown', quantity: 1 }); // +500

  const wall = await giftWallService.getWall('room_1');
  assert.equal(wall.totalCoins, 520);
  assert.equal(wall.gifters[0].gifterId, 'usr_sender');
  assert.equal(wall.gifters[0].totalCoins, 520);
});

test('multiple gifters sending real gifts in the same room produce a correctly ranked top 3', async () => {
  const { wallets, giftsService, giftWallService } = setupFullStack();
  await wallets.credit('usr_a', 'coins', 1000, 'seed-a-0001');
  await wallets.credit('usr_b', 'coins', 1000, 'seed-b-0001');
  await wallets.credit('usr_c', 'coins', 1000, 'seed-c-0001');
  await wallets.credit('usr_d', 'coins', 1000, 'seed-d-0001');

  await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_a', receiverId: 'host_1', giftId: 'gift_crown', quantity: 1 }); // 500
  await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_b', receiverId: 'host_1', giftId: 'gift_heart', quantity: 1 }); // 50
  await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_c', receiverId: 'host_1', giftId: 'gift_heart', quantity: 3 }); // 150
  await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_d', receiverId: 'host_1', giftId: 'gift_rose', quantity: 1 }); // 10

  const wall = await giftWallService.getWall('room_1');
  assert.deepEqual(wall.topGifters.map((g) => g.gifterId), ['usr_a', 'usr_c', 'usr_b']);
  assert.ok(!wall.topGifters.some((g) => g.gifterId === 'usr_d'));
});

test('gifts sent to two different rooms never mix on either wall', async () => {
  const { wallets, giftsService, giftWallService } = setupFullStack();
  await wallets.credit('usr_a', 'coins', 1000, 'seed-a-0001');
  await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_a', receiverId: 'host_1', giftId: 'gift_rose', quantity: 1 });
  await giftsService.sendGift({ roomId: 'room_2', senderId: 'usr_a', receiverId: 'host_2', giftId: 'gift_crown', quantity: 1 });

  const wall1 = await giftWallService.getWall('room_1');
  const wall2 = await giftWallService.getWall('room_2');
  assert.equal(wall1.totalCoins, 10);
  assert.equal(wall2.totalCoins, 500);
});

test('closing a room\'s Host Room Session ends that wall; a real gift sent afterward starts a fresh one', async () => {
  const { wallets, giftsService, giftWallService } = setupFullStack();
  await wallets.credit('usr_a', 'coins', 1000, 'seed-a-0001');
  await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_a', receiverId: 'host_1', giftId: 'gift_heart', quantity: 1 }); // 50
  await giftWallService.closeSession('room_1');

  const afterClose = await giftWallService.getWall('room_1');
  assert.equal(afterClose.status, 'inactive');

  await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_a', receiverId: 'host_1', giftId: 'gift_rose', quantity: 1 }); // 10, new session
  const newWall = await giftWallService.getWall('room_1');
  assert.equal(newWall.status, 'active');
  assert.equal(newWall.totalCoins, 10, 'must not include the 50 coins from the closed session');
});

test('when giftWallService is omitted, sendGift behaves exactly as before Stage 26 (unchanged default)', async () => {
  const wallets = new InMemoryWalletRepository();
  const gifts = new InMemoryGiftRepository();
  const giftsService = createGiftsService({ wallets, gifts }); // no giftWallService at all
  await wallets.credit('usr_sender', 'coins', 1000, 'seed-0001');
  const record = await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_rose', quantity: 1 });
  assert.ok(record.id, 'sendGift must still work with no giftWallService dependency at all');
});
