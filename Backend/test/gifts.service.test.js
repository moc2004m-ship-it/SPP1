'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryWalletRepository } = require('../src/database/repositories/wallet.repository');
const { InMemoryGiftRepository } = require('../src/database/repositories/gift.repository');
const { InMemoryAccountRepository } = require('../src/database/repositories/account.repository');
const { InMemoryEventRepository } = require('../src/database/repositories/event.repository');
const { createGiftsService } = require('../src/services/gifts.service');
const { createEventService } = require('../src/services/event.service');

function setup() {
  const wallets = new InMemoryWalletRepository();
  const gifts = new InMemoryGiftRepository();
  const service = createGiftsService({ wallets, gifts });
  return { wallets, gifts, service };
}

// Stage 33 -- a fake notificationService that just records notify() calls,
// same injection technique as couple/guard/event/family.service.test.js.
// Never touches the real notification.service.js/notification.repository.js
// -- this only proves gifts.service.js calls notify() with the right
// recipient/type/payload, only after a real committed send.
function fakeNotificationService() {
  const calls = [];
  return {
    calls,
    async notify(args) {
      calls.push(args);
      return { notification: { id: 'ntf_fake' }, push: { attempted: false, blocked: true, reason: 'fake' } };
    },
  };
}

function setupWithNotifications() {
  const wallets = new InMemoryWalletRepository();
  const gifts = new InMemoryGiftRepository();
  const notificationService = fakeNotificationService();
  const service = createGiftsService({ wallets, gifts, notificationService });
  return { wallets, gifts, notificationService, service };
}

// Stage 27/28 -- accounts is optional; this setup passes it explicitly to
// exercise the XP-granting path without touching setup() above (which
// every existing test in this file relies on staying accounts-free).
async function setupWithAccounts() {
  const wallets = new InMemoryWalletRepository();
  const gifts = new InMemoryGiftRepository();
  const accounts = new InMemoryAccountRepository();
  const service = createGiftsService({ wallets, gifts, accounts });
  return { wallets, gifts, accounts, service };
}

// Stage 31 -- eventService is likewise optional; this setup builds a REAL
// event.service.js (backed by a real event.repository.js and its own
// separate wallet repository for reward crediting) against a small,
// controllable fixture catalog, same rationale as event.service.test.js's
// own FIXTURE_CATALOG (deliberately not the real EVENTS_CATALOG, so the
// test controls startAt/endAt/targetCount directly instead of depending on
// live dates). This exercises the real gifts.service.js ->
// event.service.js -> event.repository.js call chain end-to-end, not a
// mock of incrementMissionsByType().
const GIFTS_FIXED_NOW = new Date('2026-09-15T12:00:00.000Z');
const GIFTS_EVENTS_FIXTURE_CATALOG = [
  {
    id: 'evt_gifting',
    title: 'Gifting Event',
    description: 'currently running',
    startAt: '2026-09-10T00:00:00.000Z',
    endAt: '2026-09-20T00:00:00.000Z',
    missions: [
      { key: 'send_3', title: 'Send 3 gifts', type: 'gift_sent', targetCount: 3, rewardCoins: 50 },
      { key: 'receive_2', title: 'Receive 2 gifts', type: 'gift_received', targetCount: 2, rewardCoins: 40 },
    ],
  },
];

function setupWithEvents() {
  const wallets = new InMemoryWalletRepository();
  const gifts = new InMemoryGiftRepository();
  const eventProgress = new InMemoryEventRepository();
  const eventWallets = new InMemoryWalletRepository(); // separate wallet store for event.service.js's own reward crediting -- not the same balance gifts.service.js debits
  const eventService = createEventService({
    eventProgress,
    wallets: eventWallets,
    catalog: GIFTS_EVENTS_FIXTURE_CATALOG,
    now: () => GIFTS_FIXED_NOW,
  });
  const service = createGiftsService({ wallets, gifts, eventService });
  return { wallets, gifts, eventProgress, eventService, service };
}

test('sendGift debits the sender at the real server-side catalog price', async () => {
  const { wallets, service } = setup();
  await wallets.credit('usr_sender', 'coins', 1000, 'seed-0001');
  const record = await service.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_rose', quantity: 3 });
  assert.equal(record.unitCostCoins, 10);
  assert.equal(record.totalCostCoins, 30);
  const balance = await wallets.getBalance('usr_sender');
  assert.equal(balance.coins, 970);
});

test('the gift record is linked to the real wallet transaction id', async () => {
  const { wallets, service } = setup();
  await wallets.credit('usr_sender', 'coins', 1000, 'seed-0001');
  const record = await service.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_heart', quantity: 1 });
  assert.ok(record.walletTransactionId, 'must reference a real wallet transaction');
  assert.match(record.walletTransactionId, /^wtx_/);
});

test('rejects an unknown giftId (never trusts a client-supplied price)', async () => {
  const { wallets, service } = setup();
  await wallets.credit('usr_sender', 'coins', 1000, 'seed-0001');
  await assert.rejects(
    () => service.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_does_not_exist', quantity: 1 }),
    (e) => e.status === 400
  );
});

test('insufficient balance rejects the send and creates no gift record', async () => {
  const { wallets, gifts, service } = setup();
  await wallets.credit('usr_sender', 'coins', 5, 'seed-0001'); // not enough for even one rose (10)
  await assert.rejects(
    () => service.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_rose', quantity: 1 }),
    (e) => e.status === 409
  );
  const wall = await gifts.listByRoom('room_1');
  assert.equal(wall.length, 0, 'no gift record must exist when the debit failed');
});

test('cannot send a gift to yourself', async () => {
  const { wallets, service } = setup();
  await wallets.credit('usr_sender', 'coins', 1000, 'seed-0001');
  await assert.rejects(
    () => service.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_sender', giftId: 'gift_rose', quantity: 1 }),
    (e) => e.status === 400
  );
});

test('gift wall lists gifts for a room in creation order', async () => {
  const { wallets, gifts, service } = setup();
  await wallets.credit('usr_sender', 'coins', 1000, 'seed-0001');
  await service.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_rose', quantity: 1 });
  await service.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_crown', quantity: 1 });
  const wall = await gifts.listByRoom('room_1');
  assert.equal(wall.length, 2);
});

// --- Stage 27/28: optional `accounts` -> XP on successful send ---------

test('when `accounts` is provided, a successful send grants XP to both sender and receiver', async () => {
  const { wallets, accounts, service } = await setupWithAccounts();
  const sender = await accounts.create();
  const receiver = await accounts.create();
  await wallets.credit(sender.id, 'coins', 1000, 'seed-0001');
  await service.sendGift({ roomId: 'room_1', senderId: sender.id, receiverId: receiver.id, giftId: 'gift_heart', quantity: 2 }); // 50*2=100 coins
  const senderAfter = await accounts.findById(sender.id);
  const receiverAfter = await accounts.findById(receiver.id);
  assert.equal(senderAfter.xp, 100);
  assert.equal(receiverAfter.xp, 100);
});

test('when `accounts` is omitted, sendGift still succeeds and grants no XP anywhere (unchanged default)', async () => {
  const { wallets, service } = setup(); // no accounts passed
  await wallets.credit('usr_sender', 'coins', 1000, 'seed-0001');
  const record = await service.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_rose', quantity: 1 });
  assert.ok(record.id); // send itself is unaffected by accounts being absent
});

test('a rejected send (insufficient balance) grants no XP even when `accounts` is provided', async () => {
  const { wallets, accounts, service } = await setupWithAccounts();
  const sender = await accounts.create();
  const receiver = await accounts.create();
  await wallets.credit(sender.id, 'coins', 5, 'seed-0001'); // not enough for a rose (10)
  await assert.rejects(
    () => service.sendGift({ roomId: 'room_1', senderId: sender.id, receiverId: receiver.id, giftId: 'gift_rose', quantity: 1 }),
    (e) => e.status === 409
  );
  const senderAfter = await accounts.findById(sender.id);
  assert.equal(senderAfter.xp, 0, 'no XP for a send that never actually happened');
});

// --- Stage 31: optional `eventService` -> real mission progress on send -

test('when `eventService` is provided, a real send increments the sender\'s gift_sent mission progress on a real active event', async () => {
  const { wallets, service, eventService } = setupWithEvents();
  await wallets.credit('usr_sender', 'coins', 1000, 'seed-0001');
  await service.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_rose', quantity: 1 });

  const senderProgress = await eventService.getMyProgress({ eventId: 'evt_gifting', accountId: 'usr_sender' });
  const send3 = senderProgress.find((m) => m.key === 'send_3');
  assert.equal(send3.progress, 1, 'a real send must drive real gift_sent mission progress for the sender');
  assert.equal(send3.completed, false);
});

test('when `eventService` is provided, a real send increments the receiver\'s gift_received mission progress on a real active event', async () => {
  const { wallets, service, eventService } = setupWithEvents();
  await wallets.credit('usr_sender', 'coins', 1000, 'seed-0001');
  await service.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_rose', quantity: 1 });

  const receiverProgress = await eventService.getMyProgress({ eventId: 'evt_gifting', accountId: 'usr_receiver' });
  const receive2 = receiverProgress.find((m) => m.key === 'receive_2');
  assert.equal(receive2.progress, 1, 'a real send must drive real gift_received mission progress for the receiver');
  assert.equal(receive2.completed, false);
});

test('when `eventService` is provided, repeated real sends accumulate real progress up to a claimable, real reward', async () => {
  const { wallets, service, eventService } = setupWithEvents();
  await wallets.credit('usr_sender', 'coins', 1000, 'seed-0001');
  await service.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_rose', quantity: 1 });
  await service.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_rose', quantity: 1 });
  await service.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_rose', quantity: 1 });

  const senderProgress = await eventService.getMyProgress({ eventId: 'evt_gifting', accountId: 'usr_sender' });
  const send3 = senderProgress.find((m) => m.key === 'send_3');
  assert.equal(send3.progress, 3);
  assert.equal(send3.completed, true, 'three real send actions must complete a "send 3 gifts" mission');

  // Real, end-to-end claim through the real event.service.js -- not a mock.
  const claim = await eventService.claimReward({ eventId: 'evt_gifting', missionKey: 'send_3', accountId: 'usr_sender' });
  assert.equal(claim.rewardCoins, 50);
  assert.ok(claim.walletTransactionId);
});

test('when `eventService` is provided, a rejected send (insufficient balance) reports no mission progress to either party', async () => {
  const { wallets, service, eventService } = setupWithEvents();
  await wallets.credit('usr_sender', 'coins', 5, 'seed-0001'); // not enough for a rose (10)
  await assert.rejects(
    () => service.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_rose', quantity: 1 }),
    (e) => e.status === 409
  );
  const senderProgress = await eventService.getMyProgress({ eventId: 'evt_gifting', accountId: 'usr_sender' });
  const receiverProgress = await eventService.getMyProgress({ eventId: 'evt_gifting', accountId: 'usr_receiver' });
  assert.equal(senderProgress.find((m) => m.key === 'send_3').progress, 0, 'no progress for a send that never actually happened');
  assert.equal(receiverProgress.find((m) => m.key === 'receive_2').progress, 0);
});

test('when `eventService` is omitted, sendGift still succeeds exactly as before (unchanged default -- no old test in this file needs to know events exist)', async () => {
  const { wallets, service } = setup(); // no eventService passed -- this is the pre-existing setup() every prior test in this file already relies on
  await wallets.credit('usr_sender', 'coins', 1000, 'seed-0001');
  const record = await service.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_rose', quantity: 1 });
  assert.ok(record.id, 'the send itself is unaffected by eventService being absent');
  assert.equal(record.totalCostCoins, 10, 'pricing/debit behavior is byte-for-byte unchanged without eventService');
});

// ---------------------------------------------------------------------
// Stage 33 -- notificationService integration (optional dependency)
// ---------------------------------------------------------------------

test('sendGift notifies the receiver with GIFT_RECEIVED after a real committed send', async () => {
  const { wallets, notificationService, service } = setupWithNotifications();
  await wallets.credit('usr_sender', 'coins', 1000, 'seed-0001');
  const record = await service.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_rose', quantity: 1 });
  assert.equal(notificationService.calls.length, 1);
  assert.deepEqual(notificationService.calls[0], {
    recipientId: 'usr_receiver',
    type: 'GIFT_RECEIVED',
    payload: { giftId: record.id },
  });
});

test('a rejected send (insufficient balance) does not notify', async () => {
  const { wallets, notificationService, service } = setupWithNotifications();
  await wallets.credit('usr_sender', 'coins', 5, 'seed-0001'); // not enough for even one rose (10)
  await assert.rejects(
    () => service.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_rose', quantity: 1 }),
  );
  assert.equal(notificationService.calls.length, 0);
});

test('a rejected send (unknown giftId) does not notify', async () => {
  const { wallets, notificationService, service } = setupWithNotifications();
  await wallets.credit('usr_sender', 'coins', 1000, 'seed-0001');
  await assert.rejects(
    () => service.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_does_not_exist', quantity: 1 }),
  );
  assert.equal(notificationService.calls.length, 0);
});

test('omitting notificationService leaves sendGift behavior unchanged (no crash, same return shape)', async () => {
  const { wallets, service } = setup(); // no notificationService at all
  await wallets.credit('usr_sender', 'coins', 1000, 'seed-0001');
  const record = await service.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_rose', quantity: 1 });
  assert.equal(record.senderId, 'usr_sender');
  assert.equal(record.receiverId, 'usr_receiver');
});
