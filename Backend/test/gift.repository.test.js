'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryGiftRepository } = require('../src/database/repositories/gift.repository');

// Only the two Stage 31 additions are covered here (sumBySender/
// sumByReceiver) -- create/listByRoom/listByReceiver are already covered
// end-to-end via test/gifts.service.test.js and are untouched by Stage 31.

function seedGift(repo, overrides = {}) {
  return repo.create({
    roomId: 'room_1',
    senderId: 'usr_a',
    receiverId: 'usr_b',
    giftId: 'gift_rose',
    quantity: 1,
    unitCostCoins: 10,
    totalCostCoins: 10,
    walletTransactionId: 'wtx_fake',
    ...overrides,
  });
}

test('sumBySender sums totalCostCoins per sender, sorted highest first', async () => {
  const repo = new InMemoryGiftRepository();
  await seedGift(repo, { senderId: 'usr_a', totalCostCoins: 30 });
  await seedGift(repo, { senderId: 'usr_a', totalCostCoins: 20 }); // usr_a total: 50
  await seedGift(repo, { senderId: 'usr_b', totalCostCoins: 100 }); // usr_b total: 100

  const totals = await repo.sumBySender();
  assert.deepEqual(totals, [
    { accountId: 'usr_b', total: 100 },
    { accountId: 'usr_a', total: 50 },
  ]);
});

test('sumByReceiver sums totalCostCoins per receiver, sorted highest first', async () => {
  const repo = new InMemoryGiftRepository();
  await seedGift(repo, { receiverId: 'usr_x', totalCostCoins: 5 });
  await seedGift(repo, { receiverId: 'usr_y', totalCostCoins: 40 });
  await seedGift(repo, { receiverId: 'usr_y', totalCostCoins: 10 }); // usr_y total: 50

  const totals = await repo.sumByReceiver();
  assert.deepEqual(totals, [
    { accountId: 'usr_y', total: 50 },
    { accountId: 'usr_x', total: 5 },
  ]);
});

test('sumBySender/sumByReceiver return an empty array when no gifts exist', async () => {
  const repo = new InMemoryGiftRepository();
  assert.deepEqual(await repo.sumBySender(), []);
  assert.deepEqual(await repo.sumByReceiver(), []);
});

test('a `since` in the future excludes every gift (nothing created yet at that instant)', async () => {
  const repo = new InMemoryGiftRepository();
  await seedGift(repo, { senderId: 'usr_a', receiverId: 'usr_b', totalCostCoins: 999 });
  const future = new Date(Date.now() + 60_000);

  assert.deepEqual(await repo.sumBySender({ since: future }), []);
  assert.deepEqual(await repo.sumByReceiver({ since: future }), []);
});

test('a `since` in the past includes every gift created after it (the real "period" filter)', async () => {
  const repo = new InMemoryGiftRepository();
  await seedGift(repo, { senderId: 'usr_a', totalCostCoins: 15 });
  const past = new Date(Date.now() - 60_000);

  const totals = await repo.sumBySender({ since: past });
  assert.deepEqual(totals, [{ accountId: 'usr_a', total: 15 }]);
});

test('omitting `since` entirely behaves like the "all" period -- every gift ever counts', async () => {
  const repo = new InMemoryGiftRepository();
  await seedGift(repo, { senderId: 'usr_a', totalCostCoins: 10 });
  await seedGift(repo, { senderId: 'usr_a', totalCostCoins: 20 });

  const totals = await repo.sumBySender();
  assert.deepEqual(totals, [{ accountId: 'usr_a', total: 30 }]);
});

test('sumBySender and sumByReceiver are independent even for the same gift (sender != receiver bookkeeping)', async () => {
  const repo = new InMemoryGiftRepository();
  await seedGift(repo, { senderId: 'usr_a', receiverId: 'usr_b', totalCostCoins: 40 });

  assert.deepEqual(await repo.sumBySender(), [{ accountId: 'usr_a', total: 40 }]);
  assert.deepEqual(await repo.sumByReceiver(), [{ accountId: 'usr_b', total: 40 }]);
});
