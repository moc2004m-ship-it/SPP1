'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryNotificationRepository } = require('../src/database/repositories/notification.repository');

// NOTE ON SCOPE: these tests exercise InMemoryNotificationRepository,
// which is the repository actually active in this sandbox (no
// DATABASE_URL/network -- see Backend/.env.example and
// Database/STAGE3_TODO.md). PostgresNotificationRepository implements the
// identical interface against real SQL (see
// src/database/repositories/notification.repository.js and
// src/database/schema/021_create_notifications.sql) but has NOT been run
// against a live database from this environment.

function setup() {
  return new InMemoryNotificationRepository();
}

// ---------------------------------------------------------------------
// notifications
// ---------------------------------------------------------------------

test('createNotification creates an unread notification with the given fields', async () => {
  const repo = setup();
  const now = new Date('2026-01-01T00:00:00.000Z');
  const n = await repo.createNotification({
    recipientId: 'acc_1', type: 'GIFT_RECEIVED', category: 'gift',
    payload: { giftId: 'gift_1' }, deepLink: 'app://gifts/received/gift_1', now,
  });
  assert.equal(n.recipientId, 'acc_1');
  assert.equal(n.type, 'GIFT_RECEIVED');
  assert.equal(n.category, 'gift');
  assert.deepEqual(n.payload, { giftId: 'gift_1' });
  assert.equal(n.status, 'unread');
  assert.equal(n.readAt, null);
  assert.equal(n.createdAt, now.toISOString());
  assert.match(n.id, /^ntf_/);
});

test('findNotificationById returns null for an unknown id', async () => {
  const repo = setup();
  assert.equal(await repo.findNotificationById('nope'), null);
});

test('listForAccount returns only that account\'s notifications, newest first', async () => {
  const repo = setup();
  await repo.createNotification({ recipientId: 'acc_1', type: 'A', category: 'social', payload: {}, deepLink: 'x', now: new Date('2026-01-01T00:00:00.000Z') });
  await repo.createNotification({ recipientId: 'acc_2', type: 'B', category: 'social', payload: {}, deepLink: 'x', now: new Date('2026-01-01T00:00:01.000Z') });
  await repo.createNotification({ recipientId: 'acc_1', type: 'C', category: 'social', payload: {}, deepLink: 'x', now: new Date('2026-01-01T00:00:02.000Z') });

  const list = await repo.listForAccount('acc_1');
  assert.equal(list.length, 2);
  assert.equal(list[0].type, 'C', 'newest first');
  assert.equal(list[1].type, 'A');
});

test('listForAccount respects an optional limit', async () => {
  const repo = setup();
  for (let i = 0; i < 5; i += 1) {
    await repo.createNotification({ recipientId: 'acc_1', type: `T${i}`, category: 'social', payload: {}, deepLink: 'x', now: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) });
  }
  const list = await repo.listForAccount('acc_1', { limit: 2 });
  assert.equal(list.length, 2);
  assert.equal(list[0].type, 'T4');
  assert.equal(list[1].type, 'T3');
});

test('countUnread counts only this account\'s unread notifications', async () => {
  const repo = setup();
  const now = new Date('2026-01-01T00:00:00.000Z');
  const a = await repo.createNotification({ recipientId: 'acc_1', type: 'A', category: 'social', payload: {}, deepLink: 'x', now });
  await repo.createNotification({ recipientId: 'acc_1', type: 'B', category: 'social', payload: {}, deepLink: 'x', now });
  await repo.createNotification({ recipientId: 'acc_2', type: 'C', category: 'social', payload: {}, deepLink: 'x', now });
  assert.equal(await repo.countUnread('acc_1'), 2);
  await repo.markRead(a.id, now);
  assert.equal(await repo.countUnread('acc_1'), 1);
  assert.equal(await repo.countUnread('acc_2'), 1);
});

test('markRead transitions unread -> read and sets readAt, and returns null for an unknown id', async () => {
  const repo = setup();
  const now = new Date('2026-01-01T00:00:00.000Z');
  const n = await repo.createNotification({ recipientId: 'acc_1', type: 'A', category: 'social', payload: {}, deepLink: 'x', now });
  const later = new Date('2026-01-01T01:00:00.000Z');
  const updated = await repo.markRead(n.id, later);
  assert.equal(updated.status, 'read');
  assert.equal(updated.readAt, later.toISOString());
  assert.equal(await repo.markRead('nope', later), null);
});

test('markRead on an already-read notification is an idempotent no-op (readAt does not change)', async () => {
  const repo = setup();
  const now = new Date('2026-01-01T00:00:00.000Z');
  const n = await repo.createNotification({ recipientId: 'acc_1', type: 'A', category: 'social', payload: {}, deepLink: 'x', now });
  const first = await repo.markRead(n.id, new Date('2026-01-01T01:00:00.000Z'));
  const second = await repo.markRead(n.id, new Date('2026-01-01T02:00:00.000Z'));
  assert.equal(second.readAt, first.readAt);
});

test('markAllRead marks every unread notification for that account and returns the real count', async () => {
  const repo = setup();
  const now = new Date('2026-01-01T00:00:00.000Z');
  await repo.createNotification({ recipientId: 'acc_1', type: 'A', category: 'social', payload: {}, deepLink: 'x', now });
  const b = await repo.createNotification({ recipientId: 'acc_1', type: 'B', category: 'social', payload: {}, deepLink: 'x', now });
  await repo.createNotification({ recipientId: 'acc_2', type: 'C', category: 'social', payload: {}, deepLink: 'x', now });
  await repo.markRead(b.id, now); // already read before markAllRead -- must not be recounted

  const count = await repo.markAllRead('acc_1', new Date('2026-01-01T02:00:00.000Z'));
  assert.equal(count, 1, 'only the one still-unread notification should be counted');
  assert.equal(await repo.countUnread('acc_1'), 0);
  assert.equal(await repo.countUnread('acc_2'), 1, 'other accounts must be untouched');
});

// ---------------------------------------------------------------------
// notification_preferences
// ---------------------------------------------------------------------

test('getPreferences returns null when the account has never set preferences', async () => {
  const repo = setup();
  assert.equal(await repo.getPreferences('acc_1'), null);
});

test('setPreferences creates then updates the single row per account (real upsert)', async () => {
  const repo = setup();
  const now = new Date('2026-01-01T00:00:00.000Z');
  const created = await repo.setPreferences('acc_1', ['gift', 'room'], now);
  assert.deepEqual(created.mutedCategories, ['gift', 'room']);
  assert.equal(created.createdAt, now.toISOString());

  const later = new Date('2026-01-01T01:00:00.000Z');
  const updated = await repo.setPreferences('acc_1', ['gift'], later);
  assert.deepEqual(updated.mutedCategories, ['gift']);
  assert.equal(updated.createdAt, now.toISOString(), 'createdAt must not change on update');
  assert.equal(updated.updatedAt, later.toISOString());

  const fetched = await repo.getPreferences('acc_1');
  assert.deepEqual(fetched.mutedCategories, ['gift']);
});

test('setPreferences de-duplicates the muted category list', async () => {
  const repo = setup();
  const updated = await repo.setPreferences('acc_1', ['gift', 'gift', 'room'], new Date());
  assert.deepEqual(updated.mutedCategories.sort(), ['gift', 'room']);
});

// ---------------------------------------------------------------------
// push_tokens
// ---------------------------------------------------------------------

test('registerDevice creates a new push token row', async () => {
  const repo = setup();
  const now = new Date('2026-01-01T00:00:00.000Z');
  const device = await repo.registerDevice({ accountId: 'acc_1', token: 'tok_abc', platform: 'ios', now });
  assert.equal(device.accountId, 'acc_1');
  assert.equal(device.token, 'tok_abc');
  assert.equal(device.platform, 'ios');
  assert.match(device.id, /^pt_/);
});

test('registerDevice is a real upsert: re-registering the same (account, token) does not duplicate', async () => {
  const repo = setup();
  const now = new Date('2026-01-01T00:00:00.000Z');
  const first = await repo.registerDevice({ accountId: 'acc_1', token: 'tok_abc', platform: 'ios', now });
  const later = new Date('2026-01-01T01:00:00.000Z');
  const second = await repo.registerDevice({ accountId: 'acc_1', token: 'tok_abc', platform: 'android', now: later });
  assert.equal(second.id, first.id, 'same row, not a new one');
  assert.equal(second.platform, 'android', 'platform is updated in place');
  const list = await repo.listDevicesForAccount('acc_1');
  assert.equal(list.length, 1);
});

test('the same token registered by two different accounts creates two separate rows', async () => {
  const repo = setup();
  const now = new Date('2026-01-01T00:00:00.000Z');
  await repo.registerDevice({ accountId: 'acc_1', token: 'tok_shared', platform: 'ios', now });
  await repo.registerDevice({ accountId: 'acc_2', token: 'tok_shared', platform: 'ios', now });
  assert.equal((await repo.listDevicesForAccount('acc_1')).length, 1);
  assert.equal((await repo.listDevicesForAccount('acc_2')).length, 1);
});

test('removeDevice deletes the token for that account and returns true, false for an unknown pair', async () => {
  const repo = setup();
  const now = new Date('2026-01-01T00:00:00.000Z');
  await repo.registerDevice({ accountId: 'acc_1', token: 'tok_abc', platform: 'ios', now });
  assert.equal(await repo.removeDevice('acc_1', 'tok_abc'), true);
  assert.equal((await repo.listDevicesForAccount('acc_1')).length, 0);
  assert.equal(await repo.removeDevice('acc_1', 'tok_abc'), false, 'already removed -- real no-op');
  assert.equal(await repo.removeDevice('acc_2', 'tok_never_registered'), false);
});

test('removeDevice does not remove another account\'s token even if the token string matches', async () => {
  const repo = setup();
  const now = new Date('2026-01-01T00:00:00.000Z');
  await repo.registerDevice({ accountId: 'acc_1', token: 'tok_shared', platform: 'ios', now });
  await repo.registerDevice({ accountId: 'acc_2', token: 'tok_shared', platform: 'ios', now });
  await repo.removeDevice('acc_1', 'tok_shared');
  assert.equal((await repo.listDevicesForAccount('acc_1')).length, 0);
  assert.equal((await repo.listDevicesForAccount('acc_2')).length, 1, 'acc_2 row must be untouched');
});
