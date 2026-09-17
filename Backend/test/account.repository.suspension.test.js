'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryAccountRepository } = require('../src/database/repositories/account.repository');

// Only the Stage 36 additions (suspend/unsuspend/listSuspended) are
// covered here -- create/findById/list/addXp/addLifetimeRecharge/
// softDelete are already covered elsewhere and untouched by Stage 36.

test('suspend() rejects a missing reason', async () => {
  const repo = new InMemoryAccountRepository();
  const account = await repo.create();
  await assert.rejects(
    () => repo.suspend(account.id, { actorId: 'staff_1' }),
    (err) => err.status === 400
  );
});

test('suspend() rejects a missing actorId', async () => {
  const repo = new InMemoryAccountRepository();
  const account = await repo.create();
  await assert.rejects(
    () => repo.suspend(account.id, { reason: 'fraud' }),
    (err) => err.status === 400
  );
});

test('suspend() rejects an unknown account with 404', async () => {
  const repo = new InMemoryAccountRepository();
  await assert.rejects(
    () => repo.suspend('usr_does_not_exist', { reason: 'fraud', actorId: 'staff_1' }),
    (err) => err.status === 404
  );
});

test('suspend() sets suspendedAt/suspendedReason/suspendedBy and leaves every other field untouched', async () => {
  const repo = new InMemoryAccountRepository();
  const account = await repo.create();
  const suspended = await repo.suspend(account.id, { reason: 'fraud investigation', actorId: 'staff_1' });

  assert.equal(typeof suspended.suspendedAt, 'string');
  assert.equal(suspended.suspendedReason, 'fraud investigation');
  assert.equal(suspended.suspendedBy, 'staff_1');
  // Nothing else about the account changed.
  assert.equal(suspended.id, account.id);
  assert.equal(suspended.vip, account.vip);
  assert.equal(suspended.coins, account.coins);
  assert.equal(suspended.deletedAt, account.deletedAt);
});

test('suspend() trims whitespace from the reason', async () => {
  const repo = new InMemoryAccountRepository();
  const account = await repo.create();
  const suspended = await repo.suspend(account.id, { reason: '  fraud  ', actorId: 'staff_1' });
  assert.equal(suspended.suspendedReason, 'fraud');
});

test('suspend() is idempotent: re-suspending an already-suspended account is a no-op that preserves the ORIGINAL reason/actor', async () => {
  const repo = new InMemoryAccountRepository();
  const account = await repo.create();
  const first = await repo.suspend(account.id, { reason: 'first reason', actorId: 'staff_1' });
  const second = await repo.suspend(account.id, { reason: 'a different reason', actorId: 'staff_2' });

  assert.equal(second.suspendedReason, 'first reason');
  assert.equal(second.suspendedBy, 'staff_1');
  assert.equal(second.suspendedAt, first.suspendedAt);
});

test('unsuspend() rejects a missing actorId', async () => {
  const repo = new InMemoryAccountRepository();
  const account = await repo.create();
  await repo.suspend(account.id, { reason: 'x', actorId: 'staff_1' });
  await assert.rejects(
    () => repo.unsuspend(account.id, {}),
    (err) => err.status === 400
  );
});

test('unsuspend() rejects an unknown account with 404', async () => {
  const repo = new InMemoryAccountRepository();
  await assert.rejects(
    () => repo.unsuspend('usr_does_not_exist', { actorId: 'staff_1' }),
    (err) => err.status === 404
  );
});

test('unsuspend() clears suspendedAt/suspendedReason/suspendedBy together', async () => {
  const repo = new InMemoryAccountRepository();
  const account = await repo.create();
  await repo.suspend(account.id, { reason: 'fraud', actorId: 'staff_1' });
  const unsuspended = await repo.unsuspend(account.id, { actorId: 'staff_2' });

  assert.equal(unsuspended.suspendedAt, null);
  assert.equal(unsuspended.suspendedReason, null);
  assert.equal(unsuspended.suspendedBy, null);
});

test('unsuspend() is idempotent: unsuspending an already-active account is a real no-op', async () => {
  const repo = new InMemoryAccountRepository();
  const account = await repo.create();
  // Never suspended -- unsuspend should just return it unchanged, not throw.
  const result = await repo.unsuspend(account.id, { actorId: 'staff_1' });
  assert.equal(result.suspendedAt, null);
  assert.equal(result.id, account.id);
});

test('listSuspended() returns only currently-suspended accounts', async () => {
  const repo = new InMemoryAccountRepository();
  const a = await repo.create();
  const b = await repo.create();
  const c = await repo.create();

  await repo.suspend(a.id, { reason: 'x', actorId: 'staff_1' });
  await repo.suspend(c.id, { reason: 'y', actorId: 'staff_1' });

  const suspended = await repo.listSuspended();
  const ids = suspended.map((acc) => acc.id).sort();
  assert.deepEqual(ids, [a.id, c.id].sort());

  const untouched = suspended.find((acc) => acc.id === a.id);
  assert.equal(untouched.suspendedReason, 'x');

  // b was never suspended, and is not in the list.
  assert.ok(!ids.includes(b.id));
});

test('listSuspended() reflects unsuspend() removing an account from the list', async () => {
  const repo = new InMemoryAccountRepository();
  const a = await repo.create();
  await repo.suspend(a.id, { reason: 'x', actorId: 'staff_1' });
  assert.equal((await repo.listSuspended()).length, 1);

  await repo.unsuspend(a.id, { actorId: 'staff_1' });
  assert.equal((await repo.listSuspended()).length, 0);
});

test('listSuspended() returns an empty array when nothing is suspended', async () => {
  const repo = new InMemoryAccountRepository();
  await repo.create();
  assert.deepEqual(await repo.listSuspended(), []);
});
