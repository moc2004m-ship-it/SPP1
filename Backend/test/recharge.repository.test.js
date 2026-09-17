'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryRechargeRepository } = require('../src/database/repositories/recharge.repository');

// GAP CLOSED (found on inspection while verifying Stage 25): every other
// domain in this project has a dedicated `*.repository.test.js` for its
// InMemory implementation (account.repository.test.js,
// notification.repository.test.js, wallet.repository.test.js, ...) --
// recharge.repository.js had none. Its behavior was only ever exercised
// indirectly through recharge.service.test.js.
//
// SCOPE, same note as wallet.repository.test.js: these tests exercise
// InMemoryRechargeRepository, which is the repository actually active in
// this sandbox (no DATABASE_URL/network -- see Backend/.env.example and
// Database/STAGE3_TODO.md). PostgresRechargeRepository implements the
// identical create/find/markCompleted/markFailed/listByAccount contract
// against real SQL but has NOT been run against a live database from this
// environment -- that requires DATABASE_URL + STAGE3_ENABLE_POSTGRES=true
// in an environment with network access to the real Postgres/Supabase
// instance, same permanent environmental boundary already documented for
// every other Postgres-backed repository in this project.

test('create() inserts a pending order with the given fields and null purchase ref', async () => {
  const repo = new InMemoryRechargeRepository();
  const order = await repo.create('acc_1', 'pkg_small', 100, 'google_play');
  assert.match(order.id, /^rchg_/);
  assert.equal(order.accountId, 'acc_1');
  assert.equal(order.packageId, 'pkg_small');
  assert.equal(order.coinsToCredit, 100);
  assert.equal(order.provider, 'google_play');
  assert.equal(order.status, 'pending');
  assert.equal(order.providerPurchaseRef, null);
  assert.equal(order.walletTransactionId, null);
  assert.equal(order.failureReason, null);
});

test('create() returns a mutation-safe copy, not a live reference into repository state', async () => {
  const repo = new InMemoryRechargeRepository();
  const order = await repo.create('acc_1', 'pkg_small', 100, 'google_play');
  order.status = 'completed'; // mutate the returned object
  const reread = await repo.findById(order.id);
  assert.equal(reread.status, 'pending', 'internal state must be untouched by mutating a returned copy');
});

test('findById() returns null for an unknown id', async () => {
  const repo = new InMemoryRechargeRepository();
  assert.equal(await repo.findById('rchg_does_not_exist'), null);
});

test('findById() returns the real stored order for a known id', async () => {
  const repo = new InMemoryRechargeRepository();
  const created = await repo.create('acc_1', 'pkg_medium', 550, 'app_store');
  const found = await repo.findById(created.id);
  assert.deepEqual(found, created);
});

test('markCompleted() sets status/providerPurchaseRef/walletTransactionId and bumps updatedAt', async () => {
  const repo = new InMemoryRechargeRepository();
  const order = await repo.create('acc_1', 'pkg_small', 100, 'google_play');
  const completed = await repo.markCompleted(order.id, 'real-purchase-token', 'wtx_1');
  assert.equal(completed.status, 'completed');
  assert.equal(completed.providerPurchaseRef, 'real-purchase-token');
  assert.equal(completed.walletTransactionId, 'wtx_1');
  assert.ok(new Date(completed.updatedAt).getTime() >= new Date(order.updatedAt).getTime());
});

test('markCompleted() on an unknown id returns null (no throw)', async () => {
  const repo = new InMemoryRechargeRepository();
  assert.equal(await repo.markCompleted('rchg_missing', 'ref', 'wtx_1'), null);
});

test('markCompleted() is idempotent -- calling it again does not overwrite the already-completed order', async () => {
  const repo = new InMemoryRechargeRepository();
  const order = await repo.create('acc_1', 'pkg_small', 100, 'google_play');
  const first = await repo.markCompleted(order.id, 'ref-1', 'wtx_1');
  const second = await repo.markCompleted(order.id, 'ref-2-different', 'wtx_2-different');
  assert.deepEqual(second, first, 'a second markCompleted call must be a pure no-op, never overwrite the first completion');
});

test('markFailed() sets status/failureReason and leaves walletTransactionId null', async () => {
  const repo = new InMemoryRechargeRepository();
  const order = await repo.create('acc_1', 'pkg_small', 100, 'google_play');
  const failed = await repo.markFailed(order.id, 'bad-ref', 'provider reported the purchase as invalid');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failureReason, 'provider reported the purchase as invalid');
  assert.equal(failed.walletTransactionId, null);
});

test('markFailed() on an unknown id returns null (no throw)', async () => {
  const repo = new InMemoryRechargeRepository();
  assert.equal(await repo.markFailed('rchg_missing', 'ref', 'reason'), null);
});

test('markFailed() never downgrades an already-completed order', async () => {
  const repo = new InMemoryRechargeRepository();
  const order = await repo.create('acc_1', 'pkg_small', 100, 'google_play');
  const completed = await repo.markCompleted(order.id, 'good-ref', 'wtx_1');
  const attemptedFail = await repo.markFailed(order.id, 'late-bad-ref', 'should never apply');
  assert.deepEqual(attemptedFail, completed, 'a completed order must never be downgraded to failed');
});

test('listByAccount() returns only that account\'s orders, most-recently-created included', async () => {
  const repo = new InMemoryRechargeRepository();
  const a1 = await repo.create('acc_1', 'pkg_small', 100, 'google_play');
  await repo.create('acc_2', 'pkg_large', 1200, 'app_store');
  const a2 = await repo.create('acc_1', 'pkg_medium', 550, 'google_play');
  const list = await repo.listByAccount('acc_1');
  assert.equal(list.length, 2);
  const ids = list.map((o) => o.id).sort();
  assert.deepEqual(ids, [a1.id, a2.id].sort());
});

test('listByAccount() returns an empty array for an account with no orders', async () => {
  const repo = new InMemoryRechargeRepository();
  await repo.create('acc_1', 'pkg_small', 100, 'google_play');
  assert.deepEqual(await repo.listByAccount('acc_unrelated'), []);
});

test('listByAccount() returns mutation-safe copies', async () => {
  const repo = new InMemoryRechargeRepository();
  await repo.create('acc_1', 'pkg_small', 100, 'google_play');
  const list = await repo.listByAccount('acc_1');
  list[0].status = 'completed';
  const reread = await repo.listByAccount('acc_1');
  assert.equal(reread[0].status, 'pending', 'internal state must be untouched by mutating a returned list item');
});
