'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryGuardRepository } = require('../src/database/repositories/guard.repository');
const { InMemoryWalletRepository } = require('../src/database/repositories/wallet.repository');
const { createGuardService } = require('../src/services/guard.service');

const DAY_MS = 24 * 60 * 60 * 1000;

function setup(now = () => new Date('2026-01-01T00:00:00.000Z')) {
  const guards = new InMemoryGuardRepository();
  const wallets = new InMemoryWalletRepository();
  const service = createGuardService({ guards, wallets, now });
  return { guards, wallets, service };
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

function setupWithNotifications(now = () => new Date('2026-01-01T00:00:00.000Z')) {
  const guards = new InMemoryGuardRepository();
  const wallets = new InMemoryWalletRepository();
  const notificationService = fakeNotificationService();
  const service = createGuardService({ guards, wallets, notificationService, now });
  return { guards, wallets, service, notificationService };
}

// ---------------------------------------------------------------------
// purchaseGuard -- real wallet debit before any grant
// ---------------------------------------------------------------------

test('purchaseGuard debits the real wallet at the real catalog price before recording any grant', async () => {
  const { service, wallets } = setup();
  await wallets.credit('usr_fan', 'coins', 1000, 'seed-00001');

  const result = await service.purchaseGuard({ actingAccountId: 'usr_fan', hostId: 'usr_host', tierKey: 'bronze' });
  assert.equal(result.coins, 500);
  assert.equal(result.days, 30);
  assert.ok(result.walletTransactionId);
  assert.match(result.walletTransactionId, /^wtx_/);
  assert.equal(result.guard.totalContributionCoins, 500);
  assert.equal(result.guard.isActive, true);

  const balance = await wallets.getBalance('usr_fan');
  assert.equal(balance.coins, 500);
});

test('purchaseGuard rejects an unknown tierKey and touches nothing', async () => {
  const { service, wallets, guards } = setup();
  await wallets.credit('usr_fan', 'coins', 1000, 'seed-00001');
  await assert.rejects(
    () => service.purchaseGuard({ actingAccountId: 'usr_fan', hostId: 'usr_host', tierKey: 'platinum' }),
    (e) => e.status === 400
  );
  const balance = await wallets.getBalance('usr_fan');
  assert.equal(balance.coins, 1000, 'balance must be untouched by a rejected purchase');
  assert.equal(await guards.findGuard('usr_fan', 'usr_host'), null, 'no guard row must be created');
});

test('purchaseGuard with insufficient balance fails the debit and grants no partial guard', async () => {
  const { service, wallets, guards } = setup();
  await wallets.credit('usr_fan', 'coins', 10, 'seed-00001'); // not enough for even 'bronze' (500)

  await assert.rejects(
    () => service.purchaseGuard({ actingAccountId: 'usr_fan', hostId: 'usr_host', tierKey: 'bronze' }),
    (e) => e.status === 409
  );

  assert.equal(await guards.findGuard('usr_fan', 'usr_host'), null, 'no guard row must exist after a failed debit');
  const balance = await wallets.getBalance('usr_fan');
  assert.equal(balance.coins, 10, 'balance must be untouched by a failed debit');
});

test('purchaseGuard rejects self-guard (400) and touches nothing', async () => {
  const { service, wallets, guards } = setup();
  await wallets.credit('usr_host', 'coins', 1000, 'seed-00001');
  await assert.rejects(
    () => service.purchaseGuard({ actingAccountId: 'usr_host', hostId: 'usr_host', tierKey: 'bronze' }),
    (e) => e.status === 400
  );
  const balance = await wallets.getBalance('usr_host');
  assert.equal(balance.coins, 1000, 'balance must be untouched by a rejected self-guard purchase');
  assert.equal(await guards.findGuard('usr_host', 'usr_host'), null);
});

test('purchaseGuard rejects a missing hostId', async () => {
  const { service, wallets } = setup();
  await wallets.credit('usr_fan', 'coins', 1000, 'seed-00001');
  await assert.rejects(
    () => service.purchaseGuard({ actingAccountId: 'usr_fan', hostId: '', tierKey: 'bronze' }),
    (e) => e.status === 400
  );
});

test('purchaseGuard generates a fresh idempotency key per purchase (no double-charge risk across separate purchases)', async () => {
  const { service, wallets } = setup();
  await wallets.credit('usr_fan', 'coins', 10000, 'seed-00001');
  const first = await service.purchaseGuard({ actingAccountId: 'usr_fan', hostId: 'usr_host', tierKey: 'bronze' });
  const second = await service.purchaseGuard({ actingAccountId: 'usr_fan', hostId: 'usr_host', tierKey: 'bronze' });
  assert.notEqual(first.purchaseId, second.purchaseId);
  assert.notEqual(first.walletTransactionId, second.walletTransactionId);
  // Both purchases must have actually been charged -- 10000 - 500 - 500 = 9000.
  const balance = await wallets.getBalance('usr_fan');
  assert.equal(balance.coins, 9000);
});

// ---------------------------------------------------------------------
// renewal semantics, via the service (extend vs restart)
// ---------------------------------------------------------------------

test('a renewal while still active extends the SAME guard row and accumulates contribution', async () => {
  let clock = new Date('2026-01-01T00:00:00.000Z');
  const { service, wallets, guards } = setup(() => clock);
  await wallets.credit('usr_fan', 'coins', 10000, 'seed-00001');

  const first = await service.purchaseGuard({ actingAccountId: 'usr_fan', hostId: 'usr_host', tierKey: 'bronze' });

  clock = new Date(clock.getTime() + 5 * DAY_MS); // still well within the 30-day window
  const second = await service.purchaseGuard({ actingAccountId: 'usr_fan', hostId: 'usr_host', tierKey: 'silver' });

  assert.equal(second.guard.totalContributionCoins, 500 + 2000);
  const expectedExpiresAt = new Date(Date.parse(first.guard.expiresAt) + 30 * DAY_MS).toISOString();
  assert.equal(second.guard.expiresAt, expectedExpiresAt);

  const list = await guards.listGuardsForHost('usr_host');
  assert.equal(list.length, 1, 'renewal must not create a second row');
});

test('a renewal after expiry restarts the countdown from now() instead of the lapsed expiresAt', async () => {
  let clock = new Date('2026-01-01T00:00:00.000Z');
  const { service, wallets } = setup(() => clock);
  await wallets.credit('usr_fan', 'coins', 10000, 'seed-00001');

  await service.purchaseGuard({ actingAccountId: 'usr_fan', hostId: 'usr_host', tierKey: 'bronze' }); // 30 days

  clock = new Date(clock.getTime() + 40 * DAY_MS); // lapsed 10 days ago
  const renewed = await service.purchaseGuard({ actingAccountId: 'usr_fan', hostId: 'usr_host', tierKey: 'gold' });

  assert.equal(renewed.guard.expiresAt, new Date(clock.getTime() + 30 * DAY_MS).toISOString());
  assert.equal(renewed.guard.isActive, true);
});

// ---------------------------------------------------------------------
// getGuardStatus -- real now()-relative isActive/secondsRemaining
// ---------------------------------------------------------------------

test('getGuardStatus returns null when the fan has never guarded this host', async () => {
  const { service } = setup();
  assert.equal(await service.getGuardStatus({ actingAccountId: 'usr_fan', hostId: 'usr_host' }), null);
});

test('getGuardStatus reports isActive true and the real remaining seconds while the subscription is live', async () => {
  let clock = new Date('2026-01-01T00:00:00.000Z');
  const { service, wallets } = setup(() => clock);
  await wallets.credit('usr_fan', 'coins', 1000, 'seed-00001');
  await service.purchaseGuard({ actingAccountId: 'usr_fan', hostId: 'usr_host', tierKey: 'bronze' }); // 30 days

  clock = new Date(clock.getTime() + 10 * DAY_MS); // 20 days left
  const status = await service.getGuardStatus({ actingAccountId: 'usr_fan', hostId: 'usr_host' });
  assert.equal(status.isActive, true);
  assert.equal(status.secondsRemaining, 20 * 24 * 60 * 60);
});

test('getGuardStatus reports isActive false and zero remaining seconds once expired', async () => {
  let clock = new Date('2026-01-01T00:00:00.000Z');
  const { service, wallets } = setup(() => clock);
  await wallets.credit('usr_fan', 'coins', 1000, 'seed-00001');
  await service.purchaseGuard({ actingAccountId: 'usr_fan', hostId: 'usr_host', tierKey: 'bronze' }); // 30 days

  clock = new Date(clock.getTime() + 31 * DAY_MS); // 1 day past expiry
  const status = await service.getGuardStatus({ actingAccountId: 'usr_fan', hostId: 'usr_host' });
  assert.equal(status.isActive, false);
  assert.equal(status.secondsRemaining, 0);
});

test('getGuardStatus rejects a missing hostId', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.getGuardStatus({ actingAccountId: 'usr_fan', hostId: '' }),
    (e) => e.status === 400
  );
});

test('getGuardStatus is isolated per fan/host pair', async () => {
  const { service, wallets } = setup();
  await wallets.credit('usr_fan_a', 'coins', 1000, 'seed-00001');
  await service.purchaseGuard({ actingAccountId: 'usr_fan_a', hostId: 'usr_host', tierKey: 'bronze' });
  const statusB = await service.getGuardStatus({ actingAccountId: 'usr_fan_b', hostId: 'usr_host' });
  assert.equal(statusB, null, 'a different fan must not see fan_a\'s guard status');
});

// ---------------------------------------------------------------------
// listFanClub -- ordered leaderboard, isolated per host
// ---------------------------------------------------------------------

test('listFanClub returns entries ordered by lifetime contribution, highest first, each with real isActive', async () => {
  let clock = new Date('2026-01-01T00:00:00.000Z');
  const { service, wallets } = setup(() => clock);
  await wallets.credit('usr_fan_high', 'coins', 10000, 'seed-00001');
  await wallets.credit('usr_fan_low', 'coins', 10000, 'seed-00002');

  await service.purchaseGuard({ actingAccountId: 'usr_fan_high', hostId: 'usr_host', tierKey: 'gold' }); // 8000
  await service.purchaseGuard({ actingAccountId: 'usr_fan_low', hostId: 'usr_host', tierKey: 'bronze' }); // 500

  const list = await service.listFanClub({ hostId: 'usr_host' });
  assert.deepEqual(list.map((g) => g.fanId), ['usr_fan_high', 'usr_fan_low']);
  assert.equal(list[0].isActive, true);
  assert.equal(list[1].isActive, true);
});

test('listFanClub reflects a lapsed subscription as isActive: false without removing the row', async () => {
  let clock = new Date('2026-01-01T00:00:00.000Z');
  const { service, wallets } = setup(() => clock);
  await wallets.credit('usr_fan', 'coins', 1000, 'seed-00001');
  await service.purchaseGuard({ actingAccountId: 'usr_fan', hostId: 'usr_host', tierKey: 'bronze' });

  clock = new Date(clock.getTime() + 31 * DAY_MS);
  const list = await service.listFanClub({ hostId: 'usr_host' });
  assert.equal(list.length, 1, 'a lapsed guard must still appear in the fan club list');
  assert.equal(list[0].isActive, false);
});

test('listFanClub only returns guards for the requested host', async () => {
  const { service, wallets } = setup();
  await wallets.credit('usr_fan', 'coins', 10000, 'seed-00001');
  await service.purchaseGuard({ actingAccountId: 'usr_fan', hostId: 'usr_host_a', tierKey: 'bronze' });
  await service.purchaseGuard({ actingAccountId: 'usr_fan', hostId: 'usr_host_b', tierKey: 'gold' });
  const listA = await service.listFanClub({ hostId: 'usr_host_a' });
  assert.equal(listA.length, 1);
  assert.equal(listA[0].hostId, 'usr_host_a');
});

test('listFanClub rejects a missing hostId', async () => {
  const { service } = setup();
  await assert.rejects(() => service.listFanClub({ hostId: '' }), (e) => e.status === 400);
});

test('listFanClub returns an empty array for a host nobody has guarded', async () => {
  const { service } = setup();
  assert.deepEqual(await service.listFanClub({ hostId: 'usr_nobody' }), []);
});

// ---------------------------------------------------------------------
// Stage 33 -- notificationService integration (optional dependency)
// ---------------------------------------------------------------------

test('purchaseGuard notifies the host with GUARD_NEW_FAN when notificationService is provided', async () => {
  const { service, wallets, notificationService } = setupWithNotifications();
  await wallets.credit('usr_fan', 'coins', 1000, 'seed-00001');

  await service.purchaseGuard({ actingAccountId: 'usr_fan', hostId: 'usr_host', tierKey: 'bronze' });

  assert.equal(notificationService.calls.length, 1);
  assert.deepEqual(notificationService.calls[0], {
    recipientId: 'usr_host',
    type: 'GUARD_NEW_FAN',
    payload: { hostId: 'usr_host' },
  });
});

test('a rejected purchase (unknown tierKey) never calls notify()', async () => {
  const { service, wallets, notificationService } = setupWithNotifications();
  await wallets.credit('usr_fan', 'coins', 1000, 'seed-00001');
  await assert.rejects(() => service.purchaseGuard({ actingAccountId: 'usr_fan', hostId: 'usr_host', tierKey: 'platinum' }));
  assert.equal(notificationService.calls.length, 0);
});

test('omitting notificationService leaves purchaseGuard behavior unchanged (no crash, same return shape)', async () => {
  const { service, wallets } = setup(); // no notificationService at all
  await wallets.credit('usr_fan', 'coins', 1000, 'seed-00001');
  const result = await service.purchaseGuard({ actingAccountId: 'usr_fan', hostId: 'usr_host', tierKey: 'bronze' });
  assert.equal(result.guard.isActive, true);
});
