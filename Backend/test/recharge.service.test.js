'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryRechargeRepository } = require('../src/database/repositories/recharge.repository');
const { InMemoryWalletRepository } = require('../src/database/repositories/wallet.repository');
const { InMemoryAccountRepository } = require('../src/database/repositories/account.repository');
const { createRechargeService } = require('../src/services/recharge.service');

// A fake `verify` function is injected here the same way
// agora.token.service.test.js injects a fake `sdk` -- this exercises the
// service's ORCHESTRATION logic (order -> verify -> credit) without a real
// network call to Google Play/App Store, which this sandbox cannot make.
// It is not a stand-in for real provider verification in production: the
// real verifyPurchase() (../src/services/recharge-provider-verifier.js)
// is used unmodified in src/index.js and fails closed (503) with no
// config, exactly like ../src/auth/otp-sender.js.

function setup(verifyImpl) {
  const recharges = new InMemoryRechargeRepository();
  const wallets = new InMemoryWalletRepository();
  const service = createRechargeService({ recharges, wallets, verify: verifyImpl });
  return { recharges, wallets, service };
}

// Stage 27/28 -- accounts is optional; this setup passes it explicitly to
// exercise the lifetimeDiamondsRecharged path without touching setup()
// above (which every existing test in this file relies on staying
// accounts-free).
function setupWithAccounts(verifyImpl) {
  const recharges = new InMemoryRechargeRepository();
  const wallets = new InMemoryWalletRepository();
  const accounts = new InMemoryAccountRepository();
  const service = createRechargeService({ recharges, wallets, verify: verifyImpl, accounts });
  return { recharges, wallets, accounts, service };
}

// Stage 33 -- a fake notificationService that just records notify() calls,
// same injection technique as couple.service.test.js/guard.service.test.js/
// event.service.test.js/family.service.test.js. Never touches the real
// notification.service.js/notification.repository.js -- this only proves
// recharge.service.js calls notify() with the right recipient/type/payload
// at the right time (fresh completion only, never the idempotent no-op).
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

function setupWithNotifications(verifyImpl) {
  const recharges = new InMemoryRechargeRepository();
  const wallets = new InMemoryWalletRepository();
  const notificationService = fakeNotificationService();
  const service = createRechargeService({ recharges, wallets, verify: verifyImpl, notificationService });
  return { recharges, wallets, notificationService, service };
}

test('createOrder resolves coinsToCredit from the server-side catalog, never the client', async () => {
  const { service } = setup(async () => ({ valid: true }));
  const order = await service.createOrder('usr_1', 'pkg_medium', 'google_play');
  assert.equal(order.coinsToCredit, 550);
  assert.equal(order.status, 'pending');
});

test('rejects an unknown packageId', async () => {
  const { service } = setup(async () => ({ valid: true }));
  await assert.rejects(() => service.createOrder('usr_1', 'pkg_does_not_exist', 'google_play'), (e) => e.status === 400);
});

test('completeOrder credits the wallet only after real verification succeeds', async () => {
  const { service, wallets } = setup(async () => ({ valid: true }));
  const order = await service.createOrder('usr_1', 'pkg_small', 'google_play');
  const completed = await service.completeOrder(order.id, 'usr_1', 'real-provider-token-abc');
  assert.equal(completed.status, 'completed');
  const balance = await wallets.getBalance('usr_1');
  assert.equal(balance.coins, 100);
});

test('a failed verification marks the order failed and credits nothing', async () => {
  const { service, wallets } = setup(async () => {
    throw Object.assign(new Error('provider reported the purchase as invalid'), { status: 402 });
  });
  const order = await service.createOrder('usr_1', 'pkg_small', 'google_play');
  await assert.rejects(() => service.completeOrder(order.id, 'usr_1', 'bad-token'), (e) => e.status === 402);
  const balance = await wallets.getBalance('usr_1');
  assert.equal(balance.coins, 0, 'wallet must not be credited on failed verification');
});

test('an unconfigured provider fails closed with 503 and credits nothing (same pattern as otp-sender.js)', async () => {
  const { verifyPurchase } = require('../src/services/recharge-provider-verifier');
  const { service, wallets } = setup(verifyPurchase); // the REAL verifier, no config supplied
  const order = await service.createOrder('usr_1', 'pkg_small', 'google_play');
  await assert.rejects(() => service.completeOrder(order.id, 'usr_1', 'some-token'), (e) => e.status === 503);
  const balance = await wallets.getBalance('usr_1');
  assert.equal(balance.coins, 0);
});

test('completing the same order twice does not credit the wallet twice (idempotent)', async () => {
  const { service, wallets } = setup(async () => ({ valid: true }));
  const order = await service.createOrder('usr_1', 'pkg_small', 'google_play');
  await service.completeOrder(order.id, 'usr_1', 'token-1');
  const second = await service.completeOrder(order.id, 'usr_1', 'token-1');
  assert.equal(second.status, 'completed');
  const balance = await wallets.getBalance('usr_1');
  assert.equal(balance.coins, 100, 'must still be 100, not credited a second time');
});

test('completing another account\'s order is rejected', async () => {
  const { service } = setup(async () => ({ valid: true }));
  const order = await service.createOrder('usr_1', 'pkg_small', 'google_play');
  await assert.rejects(() => service.completeOrder(order.id, 'usr_2', 'token-1'), (e) => e.status === 403);
});

// --- Stage 27/28: optional `accounts` -> lifetimeDiamondsRecharged ------

test('when `accounts` is provided, a completed order adds coinsToCredit to lifetimeDiamondsRecharged', async () => {
  const { accounts, service } = setupWithAccounts(async () => ({ valid: true }));
  const account = await accounts.create();
  const order = await service.createOrder(account.id, 'pkg_medium', 'google_play'); // 550 coins
  await service.completeOrder(order.id, account.id, 'real-provider-token-abc');
  const after = await accounts.findById(account.id);
  assert.equal(after.lifetimeDiamondsRecharged, 550);
});

test('completing the same order twice does not double-count lifetimeDiamondsRecharged (idempotent)', async () => {
  const { accounts, service } = setupWithAccounts(async () => ({ valid: true }));
  const account = await accounts.create();
  const order = await service.createOrder(account.id, 'pkg_small', 'google_play'); // 100 coins
  await service.completeOrder(order.id, account.id, 'token-1');
  await service.completeOrder(order.id, account.id, 'token-1'); // idempotent no-op path
  const after = await accounts.findById(account.id);
  assert.equal(after.lifetimeDiamondsRecharged, 100, 'must still be 100, not double-counted');
});

test('a failed verification adds nothing to lifetimeDiamondsRecharged', async () => {
  const { accounts, service } = setupWithAccounts(async () => {
    throw Object.assign(new Error('provider reported the purchase as invalid'), { status: 402 });
  });
  const account = await accounts.create();
  const order = await service.createOrder(account.id, 'pkg_small', 'google_play');
  await assert.rejects(() => service.completeOrder(order.id, account.id, 'bad-token'), (e) => e.status === 402);
  const after = await accounts.findById(account.id);
  assert.equal(after.lifetimeDiamondsRecharged, 0);
});

test('when `accounts` is omitted, completeOrder still succeeds and touches no account (unchanged default)', async () => {
  const { service, wallets } = setup(async () => ({ valid: true })); // no accounts passed
  const order = await service.createOrder('usr_1', 'pkg_small', 'google_play');
  const completed = await service.completeOrder(order.id, 'usr_1', 'token-1');
  assert.equal(completed.status, 'completed');
  assert.equal((await wallets.getBalance('usr_1')).coins, 100);
});

// ---------------------------------------------------------------------
// Stage 33 -- notificationService integration (optional dependency)
// ---------------------------------------------------------------------

test('completeOrder notifies the account with PAYMENT_COMPLETED after a real fresh completion', async () => {
  const { service, notificationService } = setupWithNotifications(async () => ({ valid: true }));
  const order = await service.createOrder('usr_1', 'pkg_small', 'google_play');
  await service.completeOrder(order.id, 'usr_1', 'token-1');
  assert.equal(notificationService.calls.length, 1);
  assert.deepEqual(notificationService.calls[0], {
    recipientId: 'usr_1',
    type: 'PAYMENT_COMPLETED',
    payload: { orderId: order.id },
  });
});

test('completing the same order twice does not re-notify (idempotent no-op path is silent)', async () => {
  const { service, notificationService } = setupWithNotifications(async () => ({ valid: true }));
  const order = await service.createOrder('usr_1', 'pkg_small', 'google_play');
  await service.completeOrder(order.id, 'usr_1', 'token-1');
  notificationService.calls.length = 0; // isolate the second (idempotent) call
  await service.completeOrder(order.id, 'usr_1', 'token-1');
  assert.equal(notificationService.calls.length, 0, 'idempotent no-op must not notify again');
});

test('a failed verification does not notify', async () => {
  const { service, notificationService } = setupWithNotifications(async () => {
    throw Object.assign(new Error('provider reported the purchase as invalid'), { status: 402 });
  });
  const order = await service.createOrder('usr_1', 'pkg_small', 'google_play');
  await assert.rejects(() => service.completeOrder(order.id, 'usr_1', 'bad-token'), (e) => e.status === 402);
  assert.equal(notificationService.calls.length, 0);
});

test('omitting notificationService leaves completeOrder behavior unchanged (no crash, same return shape)', async () => {
  const { service, wallets } = setup(async () => ({ valid: true })); // no notificationService at all
  const order = await service.createOrder('usr_1', 'pkg_small', 'google_play');
  const completed = await service.completeOrder(order.id, 'usr_1', 'token-1');
  assert.equal(completed.status, 'completed');
  assert.equal((await wallets.getBalance('usr_1')).coins, 100);
});
