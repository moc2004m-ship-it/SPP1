const test = require('node:test');
const assert = require('node:assert/strict');

const { InMemoryAccountRepository } = require('../src/database/repositories/account.repository');

test('create() stores and returns a new account with defaults', async () => {
  const repo = new InMemoryAccountRepository();
  const account = await repo.create();
  assert.equal(account.vip, 0);
  assert.equal(account.coins, 0);
});

test('findById() returns the same account that was created', async () => {
  const repo = new InMemoryAccountRepository();
  const created = await repo.create();
  const found = await repo.findById(created.id);
  assert.deepEqual(found, created);
});

test('findById() returns null for an unknown id', async () => {
  const repo = new InMemoryAccountRepository();
  const found = await repo.findById('usr_does_not_exist');
  assert.equal(found, null);
});

test('list() returns every created account', async () => {
  const repo = new InMemoryAccountRepository();
  await repo.create();
  await repo.create();
  await repo.create();
  const all = await repo.list();
  assert.equal(all.length, 3);
});

test('two accounts created back to back never collide', async () => {
  const repo = new InMemoryAccountRepository();
  const a = await repo.create();
  const b = await repo.create();
  assert.notEqual(a.id, b.id);
});

// --- Stage 27/28 -----------------------------------------------------

test('addXp() increases xp and recomputes lvl in the same operation', async () => {
  const repo = new InMemoryAccountRepository();
  const account = await repo.create();
  const updated = await repo.addXp(account.id, 100); // exactly the level-1 threshold
  assert.equal(updated.xp, 100);
  assert.equal(updated.lvl, 1);
});

test('addXp() accumulates across multiple calls', async () => {
  const repo = new InMemoryAccountRepository();
  const account = await repo.create();
  await repo.addXp(account.id, 60);
  const updated = await repo.addXp(account.id, 60);
  assert.equal(updated.xp, 120);
  assert.equal(updated.lvl, 1); // 120 >= 100 (lvl1) but < 400 (lvl2)
});

test('addXp() persists: findById reflects the new xp/lvl', async () => {
  const repo = new InMemoryAccountRepository();
  const account = await repo.create();
  await repo.addXp(account.id, 400); // exactly the level-2 threshold
  const found = await repo.findById(account.id);
  assert.equal(found.xp, 400);
  assert.equal(found.lvl, 2);
});

test('addXp() does not disturb other fields (coins/diamonds/vip/svip untouched)', async () => {
  const repo = new InMemoryAccountRepository();
  const account = await repo.create();
  const updated = await repo.addXp(account.id, 50);
  assert.equal(updated.coins, 0);
  assert.equal(updated.diamonds, 0);
  assert.equal(updated.vip, 0);
  assert.equal(updated.svip, 0);
  assert.equal(updated.id, account.id);
});

test('addXp() rejects a non-positive amount', async () => {
  const repo = new InMemoryAccountRepository();
  const account = await repo.create();
  await assert.rejects(() => repo.addXp(account.id, 0), (e) => e.status === 400);
  await assert.rejects(() => repo.addXp(account.id, -5), (e) => e.status === 400);
});

test('addXp() 404s on an unknown account id', async () => {
  const repo = new InMemoryAccountRepository();
  await assert.rejects(() => repo.addXp('usr_does_not_exist', 10), (e) => e.status === 404);
});

test('addLifetimeRecharge() increases the counter and recomputes vip/svip in the same operation', async () => {
  const repo = new InMemoryAccountRepository();
  const account = await repo.create();
  const updated = await repo.addLifetimeRecharge(account.id, 500); // exactly the VIP tier-1 threshold
  assert.equal(updated.lifetimeDiamondsRecharged, 500);
  assert.equal(updated.vip, 1);
  assert.equal(updated.svip, 0);
});

test('addLifetimeRecharge() accumulates across multiple calls and can reach SVIP', async () => {
  const repo = new InMemoryAccountRepository();
  const account = await repo.create();
  await repo.addLifetimeRecharge(account.id, 100000); // top VIP threshold
  const updated = await repo.addLifetimeRecharge(account.id, 200000); // total 300000 == SVIP tier-1 threshold
  assert.equal(updated.lifetimeDiamondsRecharged, 300000);
  assert.equal(updated.vip, 5); // stays at the max VIP tier
  assert.equal(updated.svip, 1);
});

test('addLifetimeRecharge() does not touch spendable coins/diamonds or xp/lvl', async () => {
  const repo = new InMemoryAccountRepository();
  const account = await repo.create();
  const updated = await repo.addLifetimeRecharge(account.id, 500);
  assert.equal(updated.coins, 0);
  assert.equal(updated.diamonds, 0);
  assert.equal(updated.xp, 0);
  assert.equal(updated.lvl, 0);
});

test('addLifetimeRecharge() rejects a non-positive amount', async () => {
  const repo = new InMemoryAccountRepository();
  const account = await repo.create();
  await assert.rejects(() => repo.addLifetimeRecharge(account.id, 0), (e) => e.status === 400);
});

test('addLifetimeRecharge() 404s on an unknown account id', async () => {
  const repo = new InMemoryAccountRepository();
  await assert.rejects(() => repo.addLifetimeRecharge('usr_does_not_exist', 10), (e) => e.status === 404);
});

// --- Stage 34 — Delete Account (soft delete) --------------------------

test('softDelete() marks the account deleted and stamps deletedAt', async () => {
  const repo = new InMemoryAccountRepository();
  const account = await repo.create();
  assert.equal(account.deletedAt, null);
  const updated = await repo.softDelete(account.id);
  assert.ok(updated.deletedAt);
  assert.equal(typeof updated.deletedAt, 'string');
});

test('softDelete() persists: findById reflects deletedAt afterwards', async () => {
  const repo = new InMemoryAccountRepository();
  const account = await repo.create();
  await repo.softDelete(account.id);
  const found = await repo.findById(account.id);
  assert.ok(found.deletedAt);
});

test('softDelete() is idempotent -- calling it twice keeps the original deletedAt timestamp', async () => {
  const repo = new InMemoryAccountRepository();
  const account = await repo.create();
  const first = await repo.softDelete(account.id);
  const second = await repo.softDelete(account.id);
  assert.equal(second.deletedAt, first.deletedAt);
});

test('softDelete() does not touch unrelated fields (coins/xp/vip untouched)', async () => {
  const repo = new InMemoryAccountRepository();
  const account = await repo.create();
  await repo.addXp(account.id, 100);
  const updated = await repo.softDelete(account.id);
  assert.equal(updated.xp, 100);
  assert.equal(updated.lvl, 1);
  assert.equal(updated.coins, 0);
});

test('softDelete() 404s on an unknown account id', async () => {
  const repo = new InMemoryAccountRepository();
  await assert.rejects(() => repo.softDelete('usr_does_not_exist'), (e) => e.status === 404);
});
