'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryGiftRepository } = require('../src/database/repositories/gift.repository');
const { InMemoryFamilyRepository } = require('../src/database/repositories/family.repository');
const { createRankingService } = require('../src/services/ranking.service');

function seedGift(gifts, overrides = {}) {
  return gifts.create({
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

function setup() {
  const gifts = new InMemoryGiftRepository();
  const families = new InMemoryFamilyRepository();
  const service = createRankingService({ gifts, families });
  return { gifts, families, service };
}

// ---------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------

test('getRanking rejects an unknown type', async () => {
  const { service } = setup();
  await assert.rejects(() => service.getRanking({ type: 'popularity' }), (e) => e.status === 400);
});

test('getRanking rejects an unknown period for wealth/charm', async () => {
  const { service } = setup();
  await assert.rejects(() => service.getRanking({ type: 'wealth', period: 'yearly' }), (e) => e.status === 400);
});

test('getRanking rejects an out-of-range limit', async () => {
  const { service } = setup();
  await assert.rejects(() => service.getRanking({ type: 'wealth', limit: 0 }), (e) => e.status === 400);
  await assert.rejects(() => service.getRanking({ type: 'wealth', limit: 101 }), (e) => e.status === 400);
  await assert.rejects(() => service.getRanking({ type: 'wealth', limit: 1.5 }), (e) => e.status === 400);
});

test("getMyRank rejects a missing accountId", async () => {
  const { service } = setup();
  await assert.rejects(() => service.getMyRank({ type: 'wealth', accountId: '' }), (e) => e.status === 400);
});

// ---------------------------------------------------------------------
// wealth / charm — real gift data, 1-based rank, limit applied
// ---------------------------------------------------------------------

test('wealth ranking ranks senders by real total spend, highest first, 1-based rank', async () => {
  const { gifts, service } = setup();
  await seedGift(gifts, { senderId: 'usr_a', totalCostCoins: 50 });
  await seedGift(gifts, { senderId: 'usr_b', totalCostCoins: 200 });
  await seedGift(gifts, { senderId: 'usr_c', totalCostCoins: 10 });

  const ranking = await service.getRanking({ type: 'wealth' });
  assert.deepEqual(
    ranking.map((r) => ({ rank: r.rank, accountId: r.accountId, total: r.total })),
    [
      { rank: 1, accountId: 'usr_b', total: 200 },
      { rank: 2, accountId: 'usr_a', total: 50 },
      { rank: 3, accountId: 'usr_c', total: 10 },
    ]
  );
});

test('charm ranking ranks receivers by real total received, highest first', async () => {
  const { gifts, service } = setup();
  await seedGift(gifts, { receiverId: 'usr_x', totalCostCoins: 5 });
  await seedGift(gifts, { receiverId: 'usr_y', totalCostCoins: 90 });

  const ranking = await service.getRanking({ type: 'charm' });
  assert.equal(ranking[0].accountId, 'usr_y');
  assert.equal(ranking[0].rank, 1);
  assert.equal(ranking[1].accountId, 'usr_x');
});

test('getRanking applies `limit` to wealth/charm', async () => {
  const { gifts, service } = setup();
  await seedGift(gifts, { senderId: 'usr_a', totalCostCoins: 30 });
  await seedGift(gifts, { senderId: 'usr_b', totalCostCoins: 20 });
  await seedGift(gifts, { senderId: 'usr_c', totalCostCoins: 10 });

  const ranking = await service.getRanking({ type: 'wealth', limit: 2 });
  assert.equal(ranking.length, 2);
  assert.deepEqual(ranking.map((r) => r.accountId), ['usr_a', 'usr_b']);
});

test('getRanking defaults to period "all" and limit 20 when omitted', async () => {
  const { gifts, service } = setup();
  await seedGift(gifts, { senderId: 'usr_a', totalCostCoins: 1 });
  const ranking = await service.getRanking({ type: 'wealth' });
  assert.equal(ranking.length, 1);
});

test('a `period` boundary genuinely excludes gifts outside it (wired through to gift.repository.sumBySender)', async () => {
  const { gifts, service } = setup();
  await seedGift(gifts, { senderId: 'usr_a', totalCostCoins: 500 });
  // now() is injected far in the future relative to the just-created gift's
  // real (Date.now()) createdAt, so a 'daily' period boundary computed from
  // that injected `now` must NOT include this gift.
  const futureService = createRankingService({ gifts, families: new InMemoryFamilyRepository(), now: () => new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) });
  const daily = await futureService.getRanking({ type: 'wealth', period: 'daily' });
  assert.deepEqual(daily, []);

  const allTime = await service.getRanking({ type: 'wealth', period: 'all' });
  assert.equal(allTime.length, 1);
});

// ---------------------------------------------------------------------
// family — real xp, period argument ignored
// ---------------------------------------------------------------------

test('family ranking ranks families by real cumulative xp, highest first', async () => {
  const { families, service } = setup();
  const famA = await families.createFamily('usr_owner_a', 'Alpha');
  const famB = await families.createFamily('usr_owner_b', 'Beta');
  const membershipA = await families.findMembership(famA.id, 'usr_owner_a');
  const membershipB = await families.findMembership(famB.id, 'usr_owner_b');
  await families.addContribution(famA.id, membershipA.id, 100);
  await families.addContribution(famB.id, membershipB.id, 500);

  const ranking = await service.getRanking({ type: 'family' });
  assert.equal(ranking[0].accountId, famB.id);
  assert.equal(ranking[0].rank, 1);
  assert.equal(ranking[1].accountId, famA.id);
});

test('family ranking ignores the `period` argument (families have no per-period log)', async () => {
  const { families, service } = setup();
  const fam = await families.createFamily('usr_owner', 'Solo');
  const membership = await families.findMembership(fam.id, 'usr_owner');
  await families.addContribution(fam.id, membership.id, 42);

  const daily = await service.getRanking({ type: 'family', period: 'daily' });
  const allTime = await service.getRanking({ type: 'family', period: 'all' });
  assert.deepEqual(daily, allTime);
});

// ---------------------------------------------------------------------
// getMyRank
// ---------------------------------------------------------------------

test('getMyRank returns { rank: null, total: 0 } for an account with no activity (not an error)', async () => {
  const { service } = setup();
  const result = await service.getMyRank({ type: 'wealth', accountId: 'usr_never_sent' });
  assert.deepEqual(result, { rank: null, total: 0 });
});

test('getMyRank returns the real rank/total for an account that does have activity, even outside the visible top N', async () => {
  const { gifts, service } = setup();
  // Seed 25 distinct senders so usr_last is definitely outside any top-20 default.
  for (let i = 0; i < 25; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await seedGift(gifts, { senderId: `usr_${i}`, totalCostCoins: 100 - i });
  }
  const result = await service.getMyRank({ type: 'wealth', accountId: 'usr_24' }); // lowest spender
  assert.equal(result.rank, 25);
  assert.equal(result.total, 76);

  const top = await service.getRanking({ type: 'wealth' }); // default limit 20
  assert.equal(top.length, 20);
  assert.ok(!top.some((r) => r.accountId === 'usr_24'), 'usr_24 must not appear in the default top-20');
});
