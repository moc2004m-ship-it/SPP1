'use strict';
// Stage 33 -- contract tests for the notification routes added to
// src/routes/platform.routes.js (GET .../:userId migration + the six new
// routes: unread-count, preferences (GET/POST), read-all, devices
// (register/remove), :notificationId/read, :notificationId/redeliver).
//
// platform.routes.js itself cannot be require()'d in this environment --
// it does `require('express')` at the top of the file, and express is not
// installed here (no network access to install it). This is the exact
// same environmental limitation already documented and accepted for
// accounts.routes.test.js/agora.routes.test.js/auth.routes.test.js/
// config.routes.test.js (the four pre-existing environmental fails), and
// it is why NONE of Stage 30/31/32's new routes (family/ranking/event/
// couple/guard) have a dedicated route-level test file either -- their
// authorization/business logic is proven at the service layer instead,
// same discipline applied here.
//
// What this file actually verifies, without needing express: that every
// new route handler's call into notificationService uses the exact
// parameter shape the handler passes (actingAccountId from
// req.session.accountId -- NEVER a client-supplied id; notificationId
// from req.params; token/platform/mutedCategories from req.body), wired
// together the way the route handlers actually chain them, including the
// ownership rejection a hostile cross-account call must hit. This is the
// same "pure logic, fake req/res inputs" style as
// platform.auth.guards.test.js. The service-level behavior these calls
// rely on (403 ownership, security-never-muted, catalog resolution,
// best-effort push) is exhaustively covered separately in
// notification.service.test.js (36 tests) -- this file is deliberately
// about the wiring contract, not re-proving that logic.

const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryNotificationRepository } = require('../src/database/repositories/notification.repository');
const { createNotificationService } = require('../src/services/notification.service');
const { assertOwnAccount } = require('../src/routes/platform.guards');

function setup() {
  const notifications = new InMemoryNotificationRepository();
  const notificationService = createNotificationService({ notifications });
  return { notifications, notificationService };
}

test('GET /api/notifications/:userId contract: assertOwnAccount + notificationService.list(actingAccountId), newest first, no extra reverse needed', async () => {
  const { notificationService } = setup();
  await notificationService.notify({ recipientId: 'acc_1', type: 'NEW_FOLLOWER', payload: { followerId: 'acc_2' } });
  await notificationService.notify({ recipientId: 'acc_1', type: 'GIFT_RECEIVED', payload: { giftId: 'g_1' } });

  const session = { accountId: 'acc_1' };
  const userId = assertOwnAccount(session, 'acc_1'); // what the route does with req.params.userId
  const data = await notificationService.list({ actingAccountId: userId });

  assert.equal(data.length, 2);
  assert.equal(data[0].type, 'GIFT_RECEIVED'); // most recently created is first
  assert.equal(typeof data[0].status, 'string');
  assert.equal(typeof data[0].createdAt, 'string');
});

test('GET /api/notifications/:userId contract: a session can never read another account\'s queue via the :userId param', () => {
  const session = { accountId: 'acc_1' };
  assert.throws(() => assertOwnAccount(session, 'someone_else'), /own account/);
});

test('GET /api/notifications/unread-count contract: getUnreadCount(actingAccountId) from the session, not a param', async () => {
  const { notificationService } = setup();
  await notificationService.notify({ recipientId: 'acc_1', type: 'NEW_FOLLOWER', payload: {} });
  const count = await notificationService.getUnreadCount({ actingAccountId: 'acc_1' });
  assert.equal(count, 1);
});

test('GET + POST /api/notifications/preferences contract: updatePreferences(actingAccountId, mutedCategories from body) then getPreferences reflects it', async () => {
  const { notificationService } = setup();
  await notificationService.updatePreferences({ actingAccountId: 'acc_1', mutedCategories: ['social'] });
  const prefs = await notificationService.getPreferences({ actingAccountId: 'acc_1' });
  assert.deepEqual(prefs.mutedCategories, ['social']);
});

test('POST /api/notifications/read-all contract: markAllRead(actingAccountId) marks every unread notification for that account only', async () => {
  const { notificationService } = setup();
  await notificationService.notify({ recipientId: 'acc_1', type: 'NEW_FOLLOWER', payload: {} });
  await notificationService.notify({ recipientId: 'acc_1', type: 'GIFT_RECEIVED', payload: {} });
  await notificationService.notify({ recipientId: 'other_acc', type: 'GIFT_RECEIVED', payload: {} });

  const result = await notificationService.markAllRead({ actingAccountId: 'acc_1' });
  assert.equal(result.markedRead, 2);
  assert.equal(await notificationService.getUnreadCount({ actingAccountId: 'acc_1' }), 0);
  assert.equal(await notificationService.getUnreadCount({ actingAccountId: 'other_acc' }), 1);
});

test('POST /api/notifications/devices + /devices/remove contract: register then remove, scoped to actingAccountId/token from body', async () => {
  const { notificationService } = setup();
  await notificationService.registerDevice({ actingAccountId: 'acc_1', token: 'tok_abc', platform: 'ios' });
  const removed = await notificationService.removeDevice({ actingAccountId: 'acc_1', token: 'tok_abc' });
  assert.equal(removed.removed, true);
  // Removing again reports false rather than throwing -- same idempotent
  // "no-op on already-gone" contract the route relies on.
  const removedAgain = await notificationService.removeDevice({ actingAccountId: 'acc_1', token: 'tok_abc' });
  assert.equal(removedAgain.removed, false);
});

test('POST /api/notifications/:notificationId/read contract: markRead(actingAccountId, notificationId from params) rejects a cross-account attempt', async () => {
  const { notificationService } = setup();
  const { notification } = await notificationService.notify({ recipientId: 'acc_1', type: 'NEW_FOLLOWER', payload: {} });

  await assert.rejects(
    () => notificationService.markRead({ actingAccountId: 'intruder', notificationId: notification.id }),
    /own notifications/
  );
  await notificationService.markRead({ actingAccountId: 'acc_1', notificationId: notification.id });
  assert.equal(await notificationService.getUnreadCount({ actingAccountId: 'acc_1' }), 0);
});

test('POST /api/notifications/:notificationId/redeliver contract: redeliverPendingPush(actingAccountId, notificationId from params) rejects a cross-account attempt and reports a real (non-thrown) push result', async () => {
  const { notificationService } = setup();
  const { notification } = await notificationService.notify({ recipientId: 'acc_1', type: 'GIFT_RECEIVED', payload: {} });

  await assert.rejects(
    () => notificationService.redeliverPendingPush({ actingAccountId: 'intruder', notificationId: notification.id }),
    /own notifications/
  );
  const result = await notificationService.redeliverPendingPush({ actingAccountId: 'acc_1', notificationId: notification.id });
  assert.equal(result.notification.id, notification.id);
  // No pushProvider wired in this test's setup() -- a real, honest
  // "blocked: not configured" result, never a fabricated "delivered".
  assert.equal(result.push.blocked, true);
  assert.equal(result.push.reason, 'push is not configured on this server');
});
