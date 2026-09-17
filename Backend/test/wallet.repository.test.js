'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryWalletRepository } = require('../src/database/repositories/wallet.repository');

// NOTE ON SCOPE: these tests exercise InMemoryWalletRepository, which is the
// repository actually active in this sandbox (no DATABASE_URL/network --
// see Backend/.env.example and Database/STAGE3_TODO.md). PostgresWalletRepository
// implements the identical credit/debit/idempotency contract against real SQL
// (see src/database/repositories/wallet.repository.js and
// src/database/schema/003_create_wallets.sql) but has NOT been run against a
// live database from this environment -- that requires DATABASE_URL +
// STAGE3_ENABLE_POSTGRES=true in an environment with network access to the
// real Postgres/Supabase instance, per Database/STAGE3_TODO.md.

test('credit moves balance 0 -> 500', async () => {
  const wallets = new InMemoryWalletRepository();
  const tx = await wallets.credit('usr_1', 'coins', 500, 'credit-key-1');
  assert.equal(tx.balanceAfter, 500);
  const balance = await wallets.getBalance('usr_1');
  assert.equal(balance.coins, 500);
});

test('debit moves balance 500 -> 200', async () => {
  const wallets = new InMemoryWalletRepository();
  await wallets.credit('usr_1', 'coins', 500, 'credit-key-1');
  const tx = await wallets.debit('usr_1', 'coins', 300, 'debit-key-1');
  assert.equal(tx.balanceAfter, 200);
  const balance = await wallets.getBalance('usr_1');
  assert.equal(balance.coins, 200);
});

test('replaying the same idempotency key does not re-apply the amount', async () => {
  const wallets = new InMemoryWalletRepository();
  await wallets.credit('usr_1', 'coins', 500, 'credit-key-1');
  const first = await wallets.debit('usr_1', 'coins', 300, 'debit-key-1');
  const replay = await wallets.debit('usr_1', 'coins', 300, 'debit-key-1');
  assert.deepEqual(replay, first);
  const balance = await wallets.getBalance('usr_1');
  assert.equal(balance.coins, 200, 'balance must still be 200, not 200 - 300 again');
});

test('a debit that would take the balance negative is rejected and nothing changes', async () => {
  const wallets = new InMemoryWalletRepository();
  await wallets.credit('usr_1', 'coins', 500, 'credit-key-1');
  await assert.rejects(
    () => wallets.debit('usr_1', 'coins', 501, 'debit-key-2'),
    (err) => err.status === 409
  );
  const balance = await wallets.getBalance('usr_1');
  assert.equal(balance.coins, 500, 'balance must be unchanged after a rejected debit');
});

test('debiting an account with no prior credit is rejected (starts at 0)', async () => {
  const wallets = new InMemoryWalletRepository();
  await assert.rejects(
    () => wallets.debit('usr_new', 'coins', 1, 'debit-key-3'),
    (err) => err.status === 409
  );
});

test('coins and diamonds are independent balances on the same account', async () => {
  const wallets = new InMemoryWalletRepository();
  await wallets.credit('usr_1', 'coins', 100, 'credit-key-coins');
  await wallets.credit('usr_1', 'diamonds', 10, 'credit-key-diamonds');
  const balance = await wallets.getBalance('usr_1');
  assert.equal(balance.coins, 100);
  assert.equal(balance.diamonds, 10);
});

test('rejects a non-positive amount', async () => {
  const wallets = new InMemoryWalletRepository();
  await assert.rejects(() => wallets.credit('usr_1', 'coins', 0, 'zero-amount-key'), (err) => err.status === 400);
  await assert.rejects(() => wallets.credit('usr_1', 'coins', -5, 'negative-amount-key'), (err) => err.status === 400);
});

test('rejects an unknown currency', async () => {
  const wallets = new InMemoryWalletRepository();
  await assert.rejects(() => wallets.credit('usr_1', 'usd', 5, 'bad-currency-key'), (err) => err.status === 400);
});
