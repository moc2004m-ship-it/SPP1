'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryNotificationRepository } = require('../src/database/repositories/notification.repository');
const { createNotificationService } = require('../src/services/notification.service');
const { createNotificationBus } = require('../src/realtime/notification-bus');

const FIXED_NOW = () => new Date('2026-01-01T00:00:00.000Z');

function setup({ pushProvider, bus, now = FIXED_NOW } = {}) {
  const notifications = new InMemoryNotificationRepository();
  const service = createNotificationService({ notifications, pushProvider, bus, now });
  return { notifications, service };
}

// A fake pushProvider -- same injection technique as
// test/push.service.test.js's fakeSdk(), so these tests never need the
// real firebase-admin package or a real push.service.js instance.
function fakePushProvider({ configured = true, sdkAvailable = true, response, throwError } = {}) {
  const calls = [];
  return {
    isConfigured: () => configured,
    isSdkAvailable: () => sdkAvailable,
    async sendToTokens(args) {
      calls.push(args);
      if (throwError) throw throwError;
      return response || { successCount: args.tokens.length, failureCount: 0, invalidTokens: [] };
    },
    calls,
  };
}

// ---------------------------------------------------------------------
// notify()
// ---------------------------------------------------------------------

test('notify rejects an unknown notification type', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.notify({ recipientId: 'usr_a', type: 'NOT_A_REAL_TYPE', payload: {} }),
    (e) => e.status === 400
  );
});

test('notify requires a recipientId', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.notify({ recipientId: '', type: 'FRIEND_REQUEST', payload: { requestId: 'req_1' } }),
    (e) => e.status === 400
  );
});

test('notify creates a real record with category/deepLink resolved server-side from the catalog', async () => {
  const { service, notifications } = setup();
  const result = await service.notify({ recipientId: 'usr_b', type: 'FRIEND_REQUEST', payload: { requestId: 'req_1' } });

  assert.equal(result.notification.recipientId, 'usr_b');
  assert.equal(result.notification.type, 'FRIEND_REQUEST');
  assert.equal(result.notification.category, 'social');
  assert.equal(result.notification.deepLink, 'app://friends/requests/req_1');
  assert.equal(result.notification.status, 'unread');

  const stored = await notifications.findNotificationById(result.notification.id);
  assert.ok(stored);
  assert.equal(stored.recipientId, 'usr_b');
});

test('notify never trusts a client-supplied category or deepLink -- only payload fields feed the deepLink builder', async () => {
  const { service } = setup();
  const result = await service.notify({
    recipientId: 'usr_b',
    type: 'FRIEND_REQUEST',
    payload: { requestId: 'req_1', category: 'security', deepLink: 'app://fake' },
  });
  assert.equal(result.notification.category, 'social'); // from the catalog, not the payload
  assert.equal(result.notification.deepLink, 'app://friends/requests/req_1'); // built server-side
});

test('notify publishes to the bus when one is provided', async () => {
  const bus = createNotificationBus();
  const { service } = setup({ bus });
  const received = [];
  bus.subscribe('usr_b', (event) => received.push(event));

  const result = await service.notify({ recipientId: 'usr_b', type: 'FRIEND_REQUEST', payload: { requestId: 'req_1' } });

  assert.equal(received.length, 1);
  assert.equal(received[0].id, result.notification.id);
});

test('notify never throws when no bus is provided', async () => {
  const { service } = setup();
  await assert.doesNotReject(() => service.notify({ recipientId: 'usr_b', type: 'FRIEND_REQUEST', payload: { requestId: 'req_1' } }));
});

// ---------------------------------------------------------------------
// notify() -- push best-effort, never fails notify() itself
// ---------------------------------------------------------------------

test('notify reports push as blocked (not thrown) when no pushProvider is configured at all', async () => {
  const { service } = setup(); // no pushProvider
  const result = await service.notify({ recipientId: 'usr_b', type: 'FRIEND_REQUEST', payload: { requestId: 'req_1' } });
  assert.equal(result.push.attempted, false);
  assert.equal(result.push.blocked, true);
  assert.match(result.push.reason, /not configured/);
});

test('notify reports push as blocked when pushProvider.isConfigured() is false', async () => {
  const pushProvider = fakePushProvider({ configured: false });
  const { service } = setup({ pushProvider });
  const result = await service.notify({ recipientId: 'usr_b', type: 'FRIEND_REQUEST', payload: { requestId: 'req_1' } });
  assert.equal(result.push.blocked, true);
  assert.equal(pushProvider.calls.length, 0);
});

test('notify reports push as blocked when pushProvider.isSdkAvailable() is false', async () => {
  const pushProvider = fakePushProvider({ sdkAvailable: false });
  const { service } = setup({ pushProvider });
  const result = await service.notify({ recipientId: 'usr_b', type: 'FRIEND_REQUEST', payload: { requestId: 'req_1' } });
  assert.equal(result.push.blocked, true);
  assert.match(result.push.reason, /firebase-admin/);
});

test('notify reports push as not-attempted (not blocked) when the recipient has no registered devices', async () => {
  const pushProvider = fakePushProvider();
  const { service } = setup({ pushProvider });
  const result = await service.notify({ recipientId: 'usr_b', type: 'FRIEND_REQUEST', payload: { requestId: 'req_1' } });
  assert.equal(result.push.attempted, false);
  assert.equal(result.push.blocked, false);
  assert.match(result.push.reason, /no registered devices/);
  assert.equal(pushProvider.calls.length, 0);
});

test('notify actually attempts push and reports real successCount/failureCount when a device is registered', async () => {
  const pushProvider = fakePushProvider({ response: { successCount: 1, failureCount: 0, invalidTokens: [] } });
  const { service } = setup({ pushProvider });
  await service.registerDevice({ actingAccountId: 'usr_b', token: 'tok_1', platform: 'ios' });

  const result = await service.notify({ recipientId: 'usr_b', type: 'FRIEND_REQUEST', payload: { requestId: 'req_1' } });
  assert.equal(result.push.attempted, true);
  assert.equal(result.push.blocked, false);
  assert.equal(result.push.successCount, 1);
  assert.equal(result.push.failureCount, 0);
  assert.equal(pushProvider.calls.length, 1);
  assert.deepEqual(pushProvider.calls[0].tokens, ['tok_1']);
});

test('notify catches a real push send error and reports it as blocked/failed rather than throwing', async () => {
  const pushProvider = fakePushProvider({ throwError: Object.assign(new Error('boom'), { status: 503 }) });
  const { service } = setup({ pushProvider });
  await service.registerDevice({ actingAccountId: 'usr_b', token: 'tok_1', platform: 'ios' });

  const result = await service.notify({ recipientId: 'usr_b', type: 'FRIEND_REQUEST', payload: { requestId: 'req_1' } });
  assert.equal(result.push.attempted, true);
  assert.equal(result.push.blocked, true);
  assert.equal(result.push.failed, true);
  assert.equal(result.push.reason, 'boom');
});

test('notify prunes invalidTokens returned by the push provider via a real removeDevice call', async () => {
  const pushProvider = fakePushProvider({ response: { successCount: 0, failureCount: 1, invalidTokens: ['tok_stale'] } });
  const { service, notifications } = setup({ pushProvider });
  await service.registerDevice({ actingAccountId: 'usr_b', token: 'tok_stale', platform: 'ios' });

  const result = await service.notify({ recipientId: 'usr_b', type: 'FRIEND_REQUEST', payload: { requestId: 'req_1' } });
  assert.equal(result.push.prunedInvalidTokens, 1);

  const devices = await notifications.listDevicesForAccount('usr_b');
  assert.equal(devices.length, 0);
});

// ---------------------------------------------------------------------
// muting -- respected for ordinary categories, never for security
// ---------------------------------------------------------------------

test('notify does not attempt push when the recipient has muted the category', async () => {
  const pushProvider = fakePushProvider();
  const { service } = setup({ pushProvider });
  await service.registerDevice({ actingAccountId: 'usr_b', token: 'tok_1', platform: 'ios' });
  await service.updatePreferences({ actingAccountId: 'usr_b', mutedCategories: ['social'] });

  const result = await service.notify({ recipientId: 'usr_b', type: 'FRIEND_REQUEST', payload: { requestId: 'req_1' } });
  assert.equal(result.push.attempted, false);
  assert.match(result.push.reason, /muted/);
  assert.equal(pushProvider.calls.length, 0);
});

test('updatePreferences strips security out of mutedCategories even if the client sends it -- it is never persisted', async () => {
  const { service, notifications } = setup();
  const saved = await service.updatePreferences({ actingAccountId: 'usr_b', mutedCategories: ['social', 'security', 'gift'] });
  assert.deepEqual(saved.mutedCategories.sort(), ['gift', 'social']);

  const stored = await notifications.getPreferences('usr_b');
  assert.equal(stored.mutedCategories.includes('security'), false);
});

test('updatePreferences drops unknown category strings silently rather than throwing', async () => {
  const { service } = setup();
  const saved = await service.updatePreferences({ actingAccountId: 'usr_b', mutedCategories: ['social', 'not_a_real_category'] });
  assert.deepEqual(saved.mutedCategories, ['social']);
});

test('updatePreferences requires an array', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.updatePreferences({ actingAccountId: 'usr_b', mutedCategories: 'social' }),
    (e) => e.status === 400
  );
});

test('a SECURITY_ALERT notification always attempts push even though security was force-written into stored preferences directly', async () => {
  const pushProvider = fakePushProvider();
  const { service, notifications } = setup({ pushProvider });
  await service.registerDevice({ actingAccountId: 'usr_b', token: 'tok_1', platform: 'ios' });
  // Simulate a corrupted/legacy row containing 'security' directly at the
  // repository layer -- bypassing updatePreferences()'s own filtering --
  // to prove notify() itself is the second, independent layer of defense.
  await notifications.setPreferences('usr_b', ['security'], FIXED_NOW());

  const result = await service.notify({ recipientId: 'usr_b', type: 'SECURITY_ALERT', payload: {} });
  assert.equal(result.push.attempted, true);
  assert.equal(pushProvider.calls.length, 1);
});

test('an ordinary (non-security) muted category is still respected even when security is force-written alongside it', async () => {
  const pushProvider = fakePushProvider();
  const { service, notifications } = setup({ pushProvider });
  await service.registerDevice({ actingAccountId: 'usr_b', token: 'tok_1', platform: 'ios' });
  await notifications.setPreferences('usr_b', ['security', 'social'], FIXED_NOW());

  const result = await service.notify({ recipientId: 'usr_b', type: 'FRIEND_REQUEST', payload: { requestId: 'req_1' } });
  assert.equal(result.push.attempted, false);
  assert.match(result.push.reason, /muted/);
});

// ---------------------------------------------------------------------
// list / getUnreadCount / markRead / markAllRead
// ---------------------------------------------------------------------

test('list returns only the acting account\'s notifications, newest first', async () => {
  // An advancing clock -- notification.repository.js sorts by createdAt,
  // so a fixed clock would make every record's createdAt identical and
  // this test would only be exercising insertion-order stability, not the
  // real "newest first" ordering contract.
  let tick = 0;
  const advancingNow = () => new Date(Date.parse('2026-01-01T00:00:00.000Z') + (tick += 1000));
  const { service } = setup({ now: advancingNow });
  await service.notify({ recipientId: 'usr_b', type: 'FRIEND_REQUEST', payload: { requestId: 'req_1' } });
  await service.notify({ recipientId: 'usr_other', type: 'FRIEND_REQUEST', payload: { requestId: 'req_2' } });
  await service.notify({ recipientId: 'usr_b', type: 'NEW_FOLLOWER', payload: { accountId: 'usr_c' } });

  const list = await service.list({ actingAccountId: 'usr_b' });
  assert.equal(list.length, 2);
  assert.ok(list.every((n) => n.recipientId === 'usr_b'));
  assert.equal(list[0].type, 'NEW_FOLLOWER'); // most recently created first
});

test('list requires an actingAccountId', async () => {
  const { service } = setup();
  await assert.rejects(() => service.list({ actingAccountId: '' }), (e) => e.status === 400);
});

test('getUnreadCount reflects only unread notifications for that account', async () => {
  const { service } = setup();
  const { notification: n1 } = await service.notify({ recipientId: 'usr_b', type: 'FRIEND_REQUEST', payload: { requestId: 'req_1' } });
  await service.notify({ recipientId: 'usr_b', type: 'NEW_FOLLOWER', payload: { accountId: 'usr_c' } });

  assert.equal(await service.getUnreadCount({ actingAccountId: 'usr_b' }), 2);
  await service.markRead({ actingAccountId: 'usr_b', notificationId: n1.id });
  assert.equal(await service.getUnreadCount({ actingAccountId: 'usr_b' }), 1);
});

test('markRead rejects marking a notification that belongs to a different account (403)', async () => {
  const { service } = setup();
  const { notification } = await service.notify({ recipientId: 'usr_b', type: 'FRIEND_REQUEST', payload: { requestId: 'req_1' } });
  await assert.rejects(
    () => service.markRead({ actingAccountId: 'usr_attacker', notificationId: notification.id }),
    (e) => e.status === 403
  );
});

test('markRead throws 404 for a notification that does not exist', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.markRead({ actingAccountId: 'usr_b', notificationId: 'ntf_does_not_exist' }),
    (e) => e.status === 404
  );
});

test('markRead actually flips status to read and sets readAt', async () => {
  const { service } = setup();
  const { notification } = await service.notify({ recipientId: 'usr_b', type: 'FRIEND_REQUEST', payload: { requestId: 'req_1' } });
  const updated = await service.markRead({ actingAccountId: 'usr_b', notificationId: notification.id });
  assert.equal(updated.status, 'read');
  assert.ok(updated.readAt);
});

test('markAllRead marks only the acting account\'s unread notifications and reports a real count', async () => {
  const { service } = setup();
  await service.notify({ recipientId: 'usr_b', type: 'FRIEND_REQUEST', payload: { requestId: 'req_1' } });
  await service.notify({ recipientId: 'usr_b', type: 'NEW_FOLLOWER', payload: { accountId: 'usr_c' } });
  await service.notify({ recipientId: 'usr_other', type: 'FRIEND_REQUEST', payload: { requestId: 'req_3' } });

  const result = await service.markAllRead({ actingAccountId: 'usr_b' });
  assert.equal(result.markedRead, 2);
  assert.equal(await service.getUnreadCount({ actingAccountId: 'usr_b' }), 0);
  assert.equal(await service.getUnreadCount({ actingAccountId: 'usr_other' }), 1);
});

// ---------------------------------------------------------------------
// getPreferences / updatePreferences
// ---------------------------------------------------------------------

test('getPreferences returns the real default (nothing muted) for an account with no stored row', async () => {
  const { service } = setup();
  const prefs = await service.getPreferences({ actingAccountId: 'usr_fresh' });
  assert.equal(prefs.accountId, 'usr_fresh');
  assert.deepEqual(prefs.mutedCategories, []);
});

test('getPreferences reflects a real stored update', async () => {
  const { service } = setup();
  await service.updatePreferences({ actingAccountId: 'usr_b', mutedCategories: ['gift'] });
  const prefs = await service.getPreferences({ actingAccountId: 'usr_b' });
  assert.deepEqual(prefs.mutedCategories, ['gift']);
});

// ---------------------------------------------------------------------
// registerDevice / removeDevice
// ---------------------------------------------------------------------

test('registerDevice validates platform and token', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.registerDevice({ actingAccountId: 'usr_b', token: 'tok_1', platform: 'windows_phone' }),
    (e) => e.status === 400
  );
  await assert.rejects(
    () => service.registerDevice({ actingAccountId: 'usr_b', token: '', platform: 'ios' }),
    (e) => e.status === 400
  );
});

test('registerDevice upserts -- registering the same token twice does not duplicate it', async () => {
  const { service, notifications } = setup();
  await service.registerDevice({ actingAccountId: 'usr_b', token: 'tok_1', platform: 'ios' });
  await service.registerDevice({ actingAccountId: 'usr_b', token: 'tok_1', platform: 'ios' });
  const devices = await notifications.listDevicesForAccount('usr_b');
  assert.equal(devices.length, 1);
});

test('removeDevice actually removes a real registered token and reports whether it removed anything', async () => {
  const { service, notifications } = setup();
  await service.registerDevice({ actingAccountId: 'usr_b', token: 'tok_1', platform: 'ios' });
  const result = await service.removeDevice({ actingAccountId: 'usr_b', token: 'tok_1' });
  assert.equal(result.removed, true);
  assert.equal((await notifications.listDevicesForAccount('usr_b')).length, 0);

  const secondAttempt = await service.removeDevice({ actingAccountId: 'usr_b', token: 'tok_1' });
  assert.equal(secondAttempt.removed, false); // real no-op, not an error
});

test('removeDevice is scoped to the acting account -- cannot remove another account\'s token', async () => {
  const { service, notifications } = setup();
  await service.registerDevice({ actingAccountId: 'usr_b', token: 'tok_1', platform: 'ios' });
  const result = await service.removeDevice({ actingAccountId: 'usr_attacker', token: 'tok_1' });
  assert.equal(result.removed, false);
  assert.equal((await notifications.listDevicesForAccount('usr_b')).length, 1);
});

// ---------------------------------------------------------------------
// redeliverPendingPush
// ---------------------------------------------------------------------

test('redeliverPendingPush re-attempts push for an existing notification without creating a new one', async () => {
  const pushProvider = fakePushProvider({ response: { successCount: 1, failureCount: 0, invalidTokens: [] } });
  const { service, notifications } = setup({ pushProvider });
  await service.registerDevice({ actingAccountId: 'usr_b', token: 'tok_1', platform: 'ios' });
  const { notification } = await service.notify({ recipientId: 'usr_b', type: 'FRIEND_REQUEST', payload: { requestId: 'req_1' } });
  assert.equal(pushProvider.calls.length, 1); // from notify() itself (device already registered)

  const result = await service.redeliverPendingPush({ actingAccountId: 'usr_b', notificationId: notification.id });
  assert.equal(result.notification.id, notification.id);
  assert.equal(result.push.attempted, true);
  assert.equal(pushProvider.calls.length, 2); // a real second attempt, not a cached result

  const all = await notifications.listForAccount('usr_b');
  assert.equal(all.length, 1); // still exactly one notification record
});

test('redeliverPendingPush rejects a notification that does not belong to the acting account (403)', async () => {
  const { service } = setup();
  const { notification } = await service.notify({ recipientId: 'usr_b', type: 'FRIEND_REQUEST', payload: { requestId: 'req_1' } });
  await assert.rejects(
    () => service.redeliverPendingPush({ actingAccountId: 'usr_attacker', notificationId: notification.id }),
    (e) => e.status === 403
  );
});

test('redeliverPendingPush respects a muted category the same way notify() does', async () => {
  const pushProvider = fakePushProvider();
  const { service } = setup({ pushProvider });
  await service.registerDevice({ actingAccountId: 'usr_b', token: 'tok_1', platform: 'ios' });
  const { notification } = await service.notify({ recipientId: 'usr_b', type: 'FRIEND_REQUEST', payload: { requestId: 'req_1' } });
  await service.updatePreferences({ actingAccountId: 'usr_b', mutedCategories: ['social'] });

  const result = await service.redeliverPendingPush({ actingAccountId: 'usr_b', notificationId: notification.id });
  assert.equal(result.push.attempted, false);
  assert.match(result.push.reason, /muted/);
});

test('redeliverPendingPush for a SECURITY_ALERT always attempts push regardless of stored preferences', async () => {
  const pushProvider = fakePushProvider();
  const { service, notifications } = setup({ pushProvider });
  await service.registerDevice({ actingAccountId: 'usr_b', token: 'tok_1', platform: 'ios' });
  const { notification } = await service.notify({ recipientId: 'usr_b', type: 'SECURITY_ALERT', payload: {} });
  await notifications.setPreferences('usr_b', ['security'], FIXED_NOW());

  const result = await service.redeliverPendingPush({ actingAccountId: 'usr_b', notificationId: notification.id });
  assert.equal(result.push.attempted, true);
});
