'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryWalletRepository } = require('../src/database/repositories/wallet.repository');
const { InMemoryGiftRepository } = require('../src/database/repositories/gift.repository');
const { InMemoryBattleRepository } = require('../src/database/repositories/battle.repository');
const { createGiftsService } = require('../src/services/gifts.service');
const { createBattleService } = require('../src/services/battle.service');

// Stage 18 -- end-to-end: a real sendGift() call (real wallet debit, real
// gift.repository.js record) must be the ONLY thing that can move a
// battle's score, and the amount credited must always be the exact real
// coins already deducted -- never a client-supplied quantity or price, and
// never a fabricated/random result. This is the integration seam between
// the pre-existing gifts system (Phase 5) and Stage 18's PK/Battles,
// mirroring test/gifts-giftwall-integration.test.js's role for the Gift
// Wall. The underlying unit coverage of recordGiftPoints() itself lives in
// test/battle.service.test.js -- this file is specifically about proving
// gifts.service.js really calls it, with the real committed amount, only
// after a real send.

function setupFullStack() {
  const wallets = new InMemoryWalletRepository();
  const gifts = new InMemoryGiftRepository();
  const battles = new InMemoryBattleRepository();
  const battleService = createBattleService({ battles });
  const giftsService = createGiftsService({ wallets, gifts, battleService });
  return { wallets, gifts, battles, battleService, giftsService };
}

async function activeBattle(battleService, overrides = {}) {
  const created = await battleService.createChallenge({
    roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opponent', ...overrides,
  });
  await battleService.acceptChallenge(overrides.opponentId || 'usr_opponent', created.id);
  return created.id;
}

test('a real sendGift() call to the host adds the exact real coins spent to the host\'s score', async () => {
  const { wallets, giftsService, battleService } = setupFullStack();
  const battleId = await activeBattle(battleService);
  await wallets.credit('usr_fan', 'coins', 1000, 'seed-0001');
  await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_fan', receiverId: 'usr_host', giftId: 'gift_heart', quantity: 2 }); // 50 * 2 = 100

  const battle = await battleService.getBattle('usr_host', battleId);
  assert.equal(battle.hostScore, 100, 'the host score must reflect the real catalog price * quantity, computed server-side by gifts.service.js');
  assert.equal(battle.opponentScore, 0);
});

test('a real sendGift() call to the opponent adds to the opponent\'s score, never the host\'s', async () => {
  const { wallets, giftsService, battleService } = setupFullStack();
  const battleId = await activeBattle(battleService);
  await wallets.credit('usr_fan', 'coins', 1000, 'seed-0001');
  await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_fan', receiverId: 'usr_opponent', giftId: 'gift_rose', quantity: 1 }); // 10

  const battle = await battleService.getBattle('usr_opponent', battleId);
  assert.equal(battle.opponentScore, 10);
  assert.equal(battle.hostScore, 0);
});

test('a gift sent to someone who is neither side of the room\'s active battle never moves any score', async () => {
  const { wallets, giftsService, battleService } = setupFullStack();
  const battleId = await activeBattle(battleService);
  await wallets.credit('usr_fan', 'coins', 1000, 'seed-0001');
  await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_fan', receiverId: 'usr_bystander', giftId: 'gift_rose', quantity: 1 });

  const battle = await battleService.getBattle('usr_host', battleId);
  assert.equal(battle.hostScore, 0);
  assert.equal(battle.opponentScore, 0);
});

test('a gift sent in a room with no battle at all is a completely normal gift (real no-op on the battle side)', async () => {
  const { wallets, giftsService } = setupFullStack();
  await wallets.credit('usr_fan', 'coins', 1000, 'seed-0001');
  const record = await giftsService.sendGift({ roomId: 'room_no_battle', senderId: 'usr_fan', receiverId: 'usr_someone', giftId: 'gift_rose', quantity: 1 });
  assert.ok(record.id, 'sendGift must still succeed with no battle in that room');
});

test('a gift sent while the battle is only pending (not yet accepted) never scores', async () => {
  const { wallets, giftsService, battleService } = setupFullStack();
  const created = await battleService.createChallenge({ roomId: 'room_1', hostId: 'usr_host', opponentId: 'usr_opponent' });
  await wallets.credit('usr_fan', 'coins', 1000, 'seed-0001');
  await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_fan', receiverId: 'usr_host', giftId: 'gift_rose', quantity: 1 });

  const battle = await battleService.getBattle('usr_host', created.id);
  assert.equal(battle.status, 'pending');
  assert.equal(battle.hostScore, 0, 'a pending (not yet accepted) challenge must never accrue score');
});

test('an insufficient-balance send (rejected before any gift record exists) never touches the battle score', async () => {
  const { wallets, giftsService, battleService } = setupFullStack();
  const battleId = await activeBattle(battleService);
  await wallets.credit('usr_fan', 'coins', 5, 'seed-0001'); // not enough for a rose (10)
  await assert.rejects(
    () => giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_fan', receiverId: 'usr_host', giftId: 'gift_rose', quantity: 1 }),
    (e) => e.status === 409
  );
  const battle = await battleService.getBattle('usr_host', battleId);
  assert.equal(battle.hostScore, 0, 'a failed debit must create no score at all');
});

test('repeated real gifts to both sides accumulate correctly and decide a real, traceable winner on end', async () => {
  const { wallets, giftsService, battleService } = setupFullStack();
  const battleId = await activeBattle(battleService);
  await wallets.credit('usr_fan_a', 'coins', 1000, 'seed-a-0001');
  await wallets.credit('usr_fan_b', 'coins', 1000, 'seed-b-0001');

  await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_fan_a', receiverId: 'usr_host', giftId: 'gift_crown', quantity: 1 }); // 500
  await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_fan_b', receiverId: 'usr_opponent', giftId: 'gift_heart', quantity: 1 }); // 50
  await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_fan_a', receiverId: 'usr_host', giftId: 'gift_rose', quantity: 1 }); // +10

  const ended = await battleService.endBattle('usr_host', battleId);
  assert.equal(ended.status, 'ended');
  assert.equal(ended.hostScore, 510);
  assert.equal(ended.opponentScore, 50);
  assert.equal(ended.winnerId, 'usr_host', 'the winner must be traceable purely to real, already-spent gift coins');
});

test('a gift sent after the battle has already ended never re-opens scoring', async () => {
  const { wallets, giftsService, battleService } = setupFullStack();
  const battleId = await activeBattle(battleService);
  await battleService.endBattle('usr_host', battleId);
  await wallets.credit('usr_fan', 'coins', 1000, 'seed-0001');
  await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_fan', receiverId: 'usr_host', giftId: 'gift_crown', quantity: 1 });

  const battle = await battleService.getBattle('usr_host', battleId);
  assert.equal(battle.status, 'ended');
  assert.equal(battle.hostScore, 0, 'an ended battle must never accrue further score, even from a real completed gift');
});

test('two different rooms\' battles never mix scores, even with the same gifter', async () => {
  const { wallets, giftsService, battleService } = setupFullStack();
  const battle1 = await activeBattle(battleService, { roomId: 'room_1', hostId: 'usr_host1', opponentId: 'usr_opp1' });
  const battle2 = await activeBattle(battleService, { roomId: 'room_2', hostId: 'usr_host2', opponentId: 'usr_opp2' });
  await wallets.credit('usr_fan', 'coins', 1000, 'seed-0001');

  await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_fan', receiverId: 'usr_host1', giftId: 'gift_rose', quantity: 1 });
  await giftsService.sendGift({ roomId: 'room_2', senderId: 'usr_fan', receiverId: 'usr_host2', giftId: 'gift_crown', quantity: 1 });

  const b1 = await battleService.getBattle('usr_host1', battle1);
  const b2 = await battleService.getBattle('usr_host2', battle2);
  assert.equal(b1.hostScore, 10);
  assert.equal(b2.hostScore, 500);
});

test('there is no separate/second wallet debit caused by the battle integration -- exactly one debit per real send', async () => {
  const { wallets, giftsService, battleService } = setupFullStack();
  await activeBattle(battleService);
  await wallets.credit('usr_fan', 'coins', 1000, 'seed-0001');
  await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_fan', receiverId: 'usr_host', giftId: 'gift_rose', quantity: 1 }); // costs 10
  const balance = await wallets.getBalance('usr_fan');
  assert.equal(balance.coins, 990, 'the battle integration must never cause an additional debit beyond gifts.service.js\'s own single debit');
});

test('when battleService is omitted, sendGift behaves exactly as before Stage 18 (unchanged default)', async () => {
  const wallets = new InMemoryWalletRepository();
  const gifts = new InMemoryGiftRepository();
  const giftsService = createGiftsService({ wallets, gifts }); // no battleService at all
  await wallets.credit('usr_sender', 'coins', 1000, 'seed-0001');
  const record = await giftsService.sendGift({ roomId: 'room_1', senderId: 'usr_sender', receiverId: 'usr_receiver', giftId: 'gift_rose', quantity: 1 });
  assert.ok(record.id, 'sendGift must still work with no battleService dependency at all');
});
