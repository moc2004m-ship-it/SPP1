'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryEventRepository } = require('../src/database/repositories/event.repository');
const { InMemoryWalletRepository } = require('../src/database/repositories/wallet.repository');
const { createEventService } = require('../src/services/event.service');

// A small, controllable fixture catalog -- deliberately NOT the real
// EVENTS_CATALOG, so tests control startAt/endAt/targetCount/rewardCoins
// directly instead of depending on the real catalog's live dates. This
// mirrors createEventService()'s own documented reason for accepting an
// injected `catalog` (its file header: "deliberately not events-catalog.js's
// own findEvent()... would ignore a test's injected fixture catalog").
const FIXED_NOW = new Date('2026-09-15T12:00:00.000Z');

const FIXTURE_CATALOG = [
  {
    id: 'evt_active',
    title: 'Active Event',
    description: 'currently running',
    startAt: '2026-09-10T00:00:00.000Z',
    endAt: '2026-09-20T00:00:00.000Z',
    missions: [
      { key: 'share_it', title: 'Share it', type: 'share', targetCount: 1, rewardCoins: 100 },
      { key: 'send_3', title: 'Send 3 gifts', type: 'gift_sent', targetCount: 3, rewardCoins: 50 },
      { key: 'receive_2', title: 'Receive 2 gifts', type: 'gift_received', targetCount: 2, rewardCoins: 40 },
    ],
  },
  {
    id: 'evt_upcoming',
    title: 'Upcoming Event',
    description: 'not started yet',
    startAt: '2026-10-01T00:00:00.000Z',
    endAt: '2026-10-10T00:00:00.000Z',
    missions: [{ key: 'send_1', title: 'Send 1 gift', type: 'gift_sent', targetCount: 1, rewardCoins: 10 }],
  },
  {
    id: 'evt_ended',
    title: 'Ended Event',
    description: 'already over',
    startAt: '2026-08-01T00:00:00.000Z',
    endAt: '2026-08-10T00:00:00.000Z',
    missions: [{ key: 'send_1', title: 'Send 1 gift', type: 'gift_sent', targetCount: 1, rewardCoins: 10 }],
  },
];

function setup() {
  const eventProgress = new InMemoryEventRepository();
  const wallets = new InMemoryWalletRepository();
  const service = createEventService({ eventProgress, wallets, catalog: FIXTURE_CATALOG, now: () => FIXED_NOW });
  return { eventProgress, wallets, service };
}

// Stage 33 -- a fake notificationService that just records notify() calls,
// same injection technique used across the other Stage 33 integration
// tests (see notification.service.test.js's fakePushProvider()).
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
  const eventProgress = new InMemoryEventRepository();
  const wallets = new InMemoryWalletRepository();
  const notificationService = fakeNotificationService();
  const service = createEventService({ eventProgress, wallets, notificationService, catalog: FIXTURE_CATALOG, now: () => FIXED_NOW });
  return { eventProgress, wallets, service, notificationService };
}

// ---------------------------------------------------------------------
// listEvents / getEvent — status/countdown computed from real now()
// ---------------------------------------------------------------------

test('listEvents returns every catalog event with a status computed from the injected now()', async () => {
  const { service } = setup();
  const events = await service.listEvents();
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  assert.equal(byId.evt_active.status, 'active');
  assert.equal(byId.evt_upcoming.status, 'upcoming');
  assert.equal(byId.evt_ended.status, 'ended');
});

test('an active event reports secondsRemaining > 0 and secondsToStart 0', async () => {
  const { service } = setup();
  const event = await service.getEvent('evt_active');
  assert.ok(event.secondsRemaining > 0);
  assert.equal(event.secondsToStart, 0);
});

test('an upcoming event reports secondsToStart > 0 and secondsRemaining 0', async () => {
  const { service } = setup();
  const event = await service.getEvent('evt_upcoming');
  assert.ok(event.secondsToStart > 0);
  assert.equal(event.secondsRemaining, 0);
});

test('getEvent throws 404 for an unknown eventId', async () => {
  const { service } = setup();
  await assert.rejects(() => service.getEvent('evt_nope'), (e) => e.status === 404);
});

// ---------------------------------------------------------------------
// incrementMissionProgress
// ---------------------------------------------------------------------

test('incrementMissionProgress accumulates real progress, capped at targetCount', async () => {
  const { service } = setup();
  await service.incrementMissionProgress({ eventId: 'evt_active', missionKey: 'send_3', accountId: 'usr_1', amount: 2 });
  const afterFirst = await service.getMyProgress({ eventId: 'evt_active', accountId: 'usr_1' });
  const send3First = afterFirst.find((m) => m.key === 'send_3');
  assert.equal(send3First.progress, 2);
  assert.equal(send3First.completed, false);

  // A third increment would overshoot 3 by 1 (2+2=4) -- must cap at 3, not overshoot.
  await service.incrementMissionProgress({ eventId: 'evt_active', missionKey: 'send_3', accountId: 'usr_1', amount: 2 });
  const afterSecond = await service.getMyProgress({ eventId: 'evt_active', accountId: 'usr_1' });
  const send3Second = afterSecond.find((m) => m.key === 'send_3');
  assert.equal(send3Second.progress, 3, 'must cap at targetCount, never overshoot');
  assert.equal(send3Second.completed, true);
});

test('incrementMissionProgress is a no-op once already completed (no further state change)', async () => {
  const { service, eventProgress } = setup();
  await service.incrementMissionProgress({ eventId: 'evt_active', missionKey: 'share_it', accountId: 'usr_1', amount: 1 });
  const before = await eventProgress.getProgress('evt_active', 'share_it', 'usr_1');
  await service.incrementMissionProgress({ eventId: 'evt_active', missionKey: 'share_it', accountId: 'usr_1', amount: 1 });
  const after = await eventProgress.getProgress('evt_active', 'share_it', 'usr_1');
  assert.equal(after.progress, before.progress);
  assert.equal(after.updatedAt, before.updatedAt, 'must not even touch the row a second time once completed');
});

test('incrementMissionProgress rejects a non-active (upcoming) event with 403', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.incrementMissionProgress({ eventId: 'evt_upcoming', missionKey: 'send_1', accountId: 'usr_1' }),
    (e) => e.status === 403
  );
});

test('incrementMissionProgress rejects a non-active (ended) event with 403', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.incrementMissionProgress({ eventId: 'evt_ended', missionKey: 'send_1', accountId: 'usr_1' }),
    (e) => e.status === 403
  );
});

test('incrementMissionProgress rejects an unknown eventId/missionKey', async () => {
  const { service } = setup();
  await assert.rejects(() => service.incrementMissionProgress({ eventId: 'evt_nope', missionKey: 'x', accountId: 'usr_1' }), (e) => e.status === 404);
  await assert.rejects(() => service.incrementMissionProgress({ eventId: 'evt_active', missionKey: 'nope', accountId: 'usr_1' }), (e) => e.status === 404);
});

test('incrementMissionProgress rejects a non-positive or non-integer amount', async () => {
  const { service } = setup();
  await assert.rejects(() => service.incrementMissionProgress({ eventId: 'evt_active', missionKey: 'send_3', accountId: 'usr_1', amount: 0 }), (e) => e.status === 400);
  await assert.rejects(() => service.incrementMissionProgress({ eventId: 'evt_active', missionKey: 'send_3', accountId: 'usr_1', amount: 1.5 }), (e) => e.status === 400);
});

test('progress is isolated per account', async () => {
  const { service } = setup();
  await service.incrementMissionProgress({ eventId: 'evt_active', missionKey: 'send_3', accountId: 'usr_1', amount: 3 });
  const usr2Progress = await service.getMyProgress({ eventId: 'evt_active', accountId: 'usr_2' });
  const send3 = usr2Progress.find((m) => m.key === 'send_3');
  assert.equal(send3.progress, 0);
  assert.equal(send3.completed, false);
});

// ---------------------------------------------------------------------
// incrementMissionsByType — the Stage 31 cross-service integration point
// ---------------------------------------------------------------------

test('incrementMissionsByType increments every active mission of that type across the whole catalog', async () => {
  const { service } = setup();
  await service.incrementMissionsByType({ accountId: 'usr_1', type: 'gift_sent', amount: 1 });
  const progress = await service.getMyProgress({ eventId: 'evt_active', accountId: 'usr_1' });
  const send3 = progress.find((m) => m.key === 'send_3');
  assert.equal(send3.progress, 1);
});

test('incrementMissionsByType skips missions of that type on non-active events (no throw, no progress)', async () => {
  const { service, eventProgress } = setup();
  // evt_upcoming and evt_ended both have a 'gift_sent' mission -- neither
  // is active, so calling this must not throw the 403 a direct
  // incrementMissionProgress() call against them would, and must leave no
  // progress row behind for either.
  await assert.doesNotReject(() => service.incrementMissionsByType({ accountId: 'usr_1', type: 'gift_sent', amount: 1 }));
  assert.equal(await eventProgress.getProgress('evt_upcoming', 'send_1', 'usr_1'), null);
  assert.equal(await eventProgress.getProgress('evt_ended', 'send_1', 'usr_1'), null);
});

test('incrementMissionsByType is a silent no-op when no active mission matches the given type', async () => {
  const { service } = setup();
  const results = await service.incrementMissionsByType({ accountId: 'usr_1', type: 'no_such_type', amount: 1 });
  assert.deepEqual(results, []);
});

test('incrementMissionsByType only ever touches missions of the requested type', async () => {
  const { service } = setup();
  await service.incrementMissionsByType({ accountId: 'usr_1', type: 'gift_received', amount: 1 });
  const progress = await service.getMyProgress({ eventId: 'evt_active', accountId: 'usr_1' });
  assert.equal(progress.find((m) => m.key === 'receive_2').progress, 1);
  assert.equal(progress.find((m) => m.key === 'send_3').progress, 0, 'a gift_sent mission must be untouched by a gift_received call');
  assert.equal(progress.find((m) => m.key === 'share_it').progress, 0, 'a share mission must be untouched by a gift_received call');
});

// ---------------------------------------------------------------------
// recordShare
// ---------------------------------------------------------------------

test('recordShare persists a real share and drives the event\'s share-type mission end-to-end', async () => {
  const { service, eventProgress } = setup();
  const { share, progress } = await service.recordShare({ eventId: 'evt_active', accountId: 'usr_1' });
  assert.ok(share.id);
  assert.equal(progress.progress, 1);
  assert.equal(progress.completed, true); // share_it targetCount is 1
  assert.equal(await eventProgress.countShares('evt_active', 'usr_1'), 1);
});

test('recordShare rejects a non-active event', async () => {
  const { service } = setup();
  await assert.rejects(() => service.recordShare({ eventId: 'evt_upcoming', accountId: 'usr_1' }), (e) => e.status === 403);
});

test('recordShare returns progress: null when the event has no share-type mission', async () => {
  const eventProgress = new InMemoryEventRepository();
  const wallets = new InMemoryWalletRepository();
  const catalogNoShare = [
    { id: 'evt_no_share', title: 'x', description: 'x', startAt: '2026-09-01T00:00:00.000Z', endAt: '2026-09-30T00:00:00.000Z', missions: [{ key: 'send_1', title: 'x', type: 'gift_sent', targetCount: 1, rewardCoins: 5 }] },
  ];
  const service = createEventService({ eventProgress, wallets, catalog: catalogNoShare, now: () => FIXED_NOW });
  const { progress } = await service.recordShare({ eventId: 'evt_no_share', accountId: 'usr_1' });
  assert.equal(progress, null);
});

// ---------------------------------------------------------------------
// claimReward
// ---------------------------------------------------------------------

test('claimReward rejects an incomplete mission with 409', async () => {
  const { service } = setup();
  await service.incrementMissionProgress({ eventId: 'evt_active', missionKey: 'send_3', accountId: 'usr_1', amount: 1 }); // only 1/3
  await assert.rejects(
    () => service.claimReward({ eventId: 'evt_active', missionKey: 'send_3', accountId: 'usr_1' }),
    (e) => e.status === 409
  );
});

test('claimReward rejects a mission with no progress at all', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.claimReward({ eventId: 'evt_active', missionKey: 'send_3', accountId: 'usr_1' }),
    (e) => e.status === 409
  );
});

test('claimReward credits the real wallet with the catalog reward and returns a real transaction id', async () => {
  const { service, wallets } = setup();
  await service.incrementMissionProgress({ eventId: 'evt_active', missionKey: 'send_3', accountId: 'usr_1', amount: 3 });
  const result = await service.claimReward({ eventId: 'evt_active', missionKey: 'send_3', accountId: 'usr_1' });
  assert.equal(result.rewardCoins, 50);
  assert.ok(result.walletTransactionId);
  assert.ok(result.claimedAt);

  const balance = await wallets.getBalance('usr_1');
  assert.equal(balance.coins, 50);
});

test('claimReward can never double-pay: a second claim of the same mission is rejected with 409', async () => {
  const { service, wallets } = setup();
  await service.incrementMissionProgress({ eventId: 'evt_active', missionKey: 'send_3', accountId: 'usr_1', amount: 3 });
  await service.claimReward({ eventId: 'evt_active', missionKey: 'send_3', accountId: 'usr_1' });
  await assert.rejects(
    () => service.claimReward({ eventId: 'evt_active', missionKey: 'send_3', accountId: 'usr_1' }),
    (e) => e.status === 409
  );
  const balance = await wallets.getBalance('usr_1');
  assert.equal(balance.coins, 50, 'the second, rejected claim must not credit anything further');
});

test('claiming one mission does not affect another mission\'s claimability for the same account', async () => {
  const { service } = setup();
  await service.incrementMissionProgress({ eventId: 'evt_active', missionKey: 'send_3', accountId: 'usr_1', amount: 3 });
  await service.incrementMissionProgress({ eventId: 'evt_active', missionKey: 'receive_2', accountId: 'usr_1', amount: 2 });
  await service.claimReward({ eventId: 'evt_active', missionKey: 'send_3', accountId: 'usr_1' });
  // receive_2 is still separately claimable.
  const result = await service.claimReward({ eventId: 'evt_active', missionKey: 'receive_2', accountId: 'usr_1' });
  assert.equal(result.rewardCoins, 40);
});

// ---------------------------------------------------------------------
// getHistory
// ---------------------------------------------------------------------

test('getHistory lists only real, claimed missions, enriched with catalog display info', async () => {
  const { service } = setup();
  await service.incrementMissionProgress({ eventId: 'evt_active', missionKey: 'send_3', accountId: 'usr_1', amount: 3 });
  await service.incrementMissionProgress({ eventId: 'evt_active', missionKey: 'receive_2', accountId: 'usr_1', amount: 2 }); // completed but never claimed
  await service.claimReward({ eventId: 'evt_active', missionKey: 'send_3', accountId: 'usr_1' });

  const history = await service.getHistory({ accountId: 'usr_1' });
  assert.equal(history.length, 1, 'the completed-but-unclaimed mission must not appear');
  assert.equal(history[0].eventId, 'evt_active');
  assert.equal(history[0].missionKey, 'send_3');
  assert.equal(history[0].missionTitle, 'Send 3 gifts');
  assert.equal(history[0].rewardCoins, 50);
  assert.ok(history[0].claimedAt);
});

test('getHistory returns an empty list for an account with no claims', async () => {
  const { service } = setup();
  const history = await service.getHistory({ accountId: 'usr_nobody' });
  assert.deepEqual(history, []);
});

// ---------------------------------------------------------------------
// Stage 33 -- notificationService integration (optional dependency)
// ---------------------------------------------------------------------

test('claimReward notifies the claimant with EVENT_REWARD_CLAIMED when notificationService is provided', async () => {
  const { service, notificationService } = setupWithNotifications();
  await service.incrementMissionProgress({ eventId: 'evt_active', missionKey: 'send_3', accountId: 'usr_1', amount: 3 });
  await service.claimReward({ eventId: 'evt_active', missionKey: 'send_3', accountId: 'usr_1' });

  assert.equal(notificationService.calls.length, 1);
  assert.deepEqual(notificationService.calls[0], {
    recipientId: 'usr_1',
    type: 'EVENT_REWARD_CLAIMED',
    payload: { eventId: 'evt_active', missionKey: 'send_3' },
  });
});

test('a rejected claim (mission not completed) never calls notify()', async () => {
  const { service, notificationService } = setupWithNotifications();
  await assert.rejects(() => service.claimReward({ eventId: 'evt_active', missionKey: 'send_3', accountId: 'usr_1' }));
  assert.equal(notificationService.calls.length, 0);
});

test('omitting notificationService leaves claimReward behavior unchanged (no crash, same return shape)', async () => {
  const { service } = setup(); // no notificationService at all
  await service.incrementMissionProgress({ eventId: 'evt_active', missionKey: 'send_3', accountId: 'usr_1', amount: 3 });
  const result = await service.claimReward({ eventId: 'evt_active', missionKey: 'send_3', accountId: 'usr_1' });
  assert.equal(result.rewardCoins, 50);
});
