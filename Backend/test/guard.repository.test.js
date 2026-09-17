'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryGuardRepository } = require('../src/database/repositories/guard.repository');

// NOTE ON SCOPE: these tests exercise InMemoryGuardRepository, which is
// the repository actually active in this sandbox (no DATABASE_URL/network
// -- see Backend/.env.example and Database/STAGE3_TODO.md).
// PostgresGuardRepository implements the identical interface against real
// SQL (see src/database/repositories/guard.repository.js and
// src/database/schema/020_create_guards.sql) but has NOT been run against
// a live database from this environment.

const DAY_MS = 24 * 60 * 60 * 1000;

test('findGuard returns null when no guard exists for that fan/host pair', async () => {
  const guards = new InMemoryGuardRepository();
  assert.equal(await guards.findGuard('usr_fan', 'usr_host'), null);
});

test('renewGuard creates a new guard with expiresAt = now + days, totalContributionCoins = coins', async () => {
  const guards = new InMemoryGuardRepository();
  const now = new Date('2026-01-01T00:00:00.000Z');
  const guard = await guards.renewGuard({ fanId: 'usr_fan', hostId: 'usr_host', tierKey: 'bronze', coins: 500, days: 30, now });
  assert.equal(guard.fanId, 'usr_fan');
  assert.equal(guard.hostId, 'usr_host');
  assert.equal(guard.tierKey, 'bronze');
  assert.equal(guard.totalContributionCoins, 500);
  assert.equal(guard.expiresAt, new Date(now.getTime() + 30 * DAY_MS).toISOString());
  assert.equal(guard.createdAt, now.toISOString());
  assert.equal(guard.updatedAt, now.toISOString());
});

test('renewGuard is a real upsert: a second purchase for the same fan/host pair does not create a second row', async () => {
  const guards = new InMemoryGuardRepository();
  const now = new Date('2026-01-01T00:00:00.000Z');
  const first = await guards.renewGuard({ fanId: 'usr_fan', hostId: 'usr_host', tierKey: 'bronze', coins: 500, days: 30, now });
  const second = await guards.renewGuard({ fanId: 'usr_fan', hostId: 'usr_host', tierKey: 'bronze', coins: 500, days: 30, now });
  assert.equal(second.id, first.id);
  const list = await guards.listGuardsForHost('usr_host');
  assert.equal(list.length, 1);
});

test('renewGuard extends from the CURRENT expiresAt when the subscription is still active', async () => {
  const guards = new InMemoryGuardRepository();
  const t0 = new Date('2026-01-01T00:00:00.000Z');
  const first = await guards.renewGuard({ fanId: 'usr_fan', hostId: 'usr_host', tierKey: 'bronze', coins: 500, days: 30, now: t0 });

  // Renew again 5 days later -- subscription still has 25 days left, so
  // the new 30 days must be appended onto the ORIGINAL expiresAt, not
  // restarted from t1.
  const t1 = new Date(t0.getTime() + 5 * DAY_MS);
  const renewed = await guards.renewGuard({ fanId: 'usr_fan', hostId: 'usr_host', tierKey: 'bronze', coins: 500, days: 30, now: t1 });

  const expectedExpiresAt = new Date(Date.parse(first.expiresAt) + 30 * DAY_MS).toISOString();
  assert.equal(renewed.expiresAt, expectedExpiresAt);
});

test('renewGuard restarts from now() when the previous subscription had already expired', async () => {
  const guards = new InMemoryGuardRepository();
  const t0 = new Date('2026-01-01T00:00:00.000Z');
  await guards.renewGuard({ fanId: 'usr_fan', hostId: 'usr_host', tierKey: 'bronze', coins: 500, days: 30, now: t0 });

  // Renew 40 days later -- the 30-day subscription lapsed 10 days ago,
  // so the new 30 days must be counted from t1, NOT appended onto the
  // already-lapsed expiresAt (which would leave it still in the past).
  const t1 = new Date(t0.getTime() + 40 * DAY_MS);
  const renewed = await guards.renewGuard({ fanId: 'usr_fan', hostId: 'usr_host', tierKey: 'silver', coins: 2000, days: 30, now: t1 });

  assert.equal(renewed.expiresAt, new Date(t1.getTime() + 30 * DAY_MS).toISOString());
});

test('renewGuard accumulates totalContributionCoins across renewals, including after expiry', async () => {
  const guards = new InMemoryGuardRepository();
  const t0 = new Date('2026-01-01T00:00:00.000Z');
  await guards.renewGuard({ fanId: 'usr_fan', hostId: 'usr_host', tierKey: 'bronze', coins: 500, days: 30, now: t0 });
  const t1 = new Date(t0.getTime() + 40 * DAY_MS); // after expiry
  const renewed = await guards.renewGuard({ fanId: 'usr_fan', hostId: 'usr_host', tierKey: 'silver', coins: 2000, days: 30, now: t1 });
  assert.equal(renewed.totalContributionCoins, 2500);
});

test('renewGuard updates tierKey to the most recently purchased tier', async () => {
  const guards = new InMemoryGuardRepository();
  const t0 = new Date('2026-01-01T00:00:00.000Z');
  await guards.renewGuard({ fanId: 'usr_fan', hostId: 'usr_host', tierKey: 'bronze', coins: 500, days: 30, now: t0 });
  const renewed = await guards.renewGuard({ fanId: 'usr_fan', hostId: 'usr_host', tierKey: 'gold', coins: 8000, days: 30, now: t0 });
  assert.equal(renewed.tierKey, 'gold');
});

test('guards for different hosts (same fan) are independent rows', async () => {
  const guards = new InMemoryGuardRepository();
  const now = new Date('2026-01-01T00:00:00.000Z');
  await guards.renewGuard({ fanId: 'usr_fan', hostId: 'usr_host_a', tierKey: 'bronze', coins: 500, days: 30, now });
  await guards.renewGuard({ fanId: 'usr_fan', hostId: 'usr_host_b', tierKey: 'gold', coins: 8000, days: 30, now });
  const guardA = await guards.findGuard('usr_fan', 'usr_host_a');
  const guardB = await guards.findGuard('usr_fan', 'usr_host_b');
  assert.equal(guardA.totalContributionCoins, 500);
  assert.equal(guardB.totalContributionCoins, 8000);
});

test('guards for different fans (same host) are independent rows', async () => {
  const guards = new InMemoryGuardRepository();
  const now = new Date('2026-01-01T00:00:00.000Z');
  await guards.renewGuard({ fanId: 'usr_fan_a', hostId: 'usr_host', tierKey: 'bronze', coins: 500, days: 30, now });
  await guards.renewGuard({ fanId: 'usr_fan_b', hostId: 'usr_host', tierKey: 'gold', coins: 8000, days: 30, now });
  assert.equal((await guards.findGuard('usr_fan_a', 'usr_host')).totalContributionCoins, 500);
  assert.equal((await guards.findGuard('usr_fan_b', 'usr_host')).totalContributionCoins, 8000);
});

test('listGuardsForHost returns guards ordered by totalContributionCoins, highest first', async () => {
  const guards = new InMemoryGuardRepository();
  const now = new Date('2026-01-01T00:00:00.000Z');
  await guards.renewGuard({ fanId: 'usr_fan_low', hostId: 'usr_host', tierKey: 'bronze', coins: 500, days: 30, now });
  await guards.renewGuard({ fanId: 'usr_fan_high', hostId: 'usr_host', tierKey: 'gold', coins: 8000, days: 30, now });
  await guards.renewGuard({ fanId: 'usr_fan_mid', hostId: 'usr_host', tierKey: 'silver', coins: 2000, days: 30, now });
  const list = await guards.listGuardsForHost('usr_host');
  assert.deepEqual(list.map((g) => g.fanId), ['usr_fan_high', 'usr_fan_mid', 'usr_fan_low']);
});

test('listGuardsForHost only returns guards for that host', async () => {
  const guards = new InMemoryGuardRepository();
  const now = new Date('2026-01-01T00:00:00.000Z');
  await guards.renewGuard({ fanId: 'usr_fan', hostId: 'usr_host_a', tierKey: 'bronze', coins: 500, days: 30, now });
  await guards.renewGuard({ fanId: 'usr_fan', hostId: 'usr_host_b', tierKey: 'gold', coins: 8000, days: 30, now });
  const listA = await guards.listGuardsForHost('usr_host_a');
  assert.equal(listA.length, 1);
  assert.equal(listA[0].hostId, 'usr_host_a');
});

test('listGuardsForHost returns an empty array for a host with no guards', async () => {
  const guards = new InMemoryGuardRepository();
  assert.deepEqual(await guards.listGuardsForHost('usr_nobody'), []);
});
