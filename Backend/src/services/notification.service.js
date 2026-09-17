'use strict';

// Stage 33 — Notification service.
//
// The ONLY code path allowed to create/read/mutate a notification, its
// preferences, or its registered push devices. Same split as every other
// Phase 5 service here: ../database/repositories/notification.repository.js
// is a plain data-integrity layer with no opinion on who may do what --
// every rule below lives here.
//
// `type` is NEVER accepted as a free-form string -- notify() always
// resolves it through ../domain/notification-catalog.js's
// resolveNotificationType() first (throws 400 on an unknown type), which is
// also where `category` (used for mute preferences) and the deep link come
// from. A caller can never invent a category or a deep link.
//
// Ownership: every function except notify() (which is only ever called by
// trusted server-side code -- other services, never a route handler taking
// recipientId from a client) takes `actingAccountId`, always
// req.session.accountId from the route layer, and every read/mutation is
// scoped to that account. markRead() additionally checks that the
// notification being marked actually belongs to actingAccountId (403
// otherwise) -- same "you may only act on your own data" discipline as
// couple.service.js/guard.service.js.
//
// Push is always best-effort. notify() and redeliverPendingPush() never
// throw because push failed/is unavailable -- they return a `push: {...}`
// descriptor alongside the real result so the caller/UI can see what
// happened, but the in-app notification itself is already durably
// recorded regardless. See ../push/push.service.js's header for why push
// itself either fully succeeds or throws a real 503 -- this file is what
// catches that 503 and turns it into a non-fatal `blocked` result.
//
// Muting: notification_preferences.mutedCategories may contain any of
// ../domain/notification-catalog.js's MUTEABLE_CATEGORIES. 'security' can
// never be silenced -- enforced TWICE, deliberately redundantly:
//   1. updatePreferences() strips 'security' out of whatever the client
//      sends before it is ever persisted, so a stored preferences row can
//      never contain it in the first place.
//   2. notify() (and redeliverPendingPush()) never even look at stored
//      mute preferences when the notification's category is 'security' --
//      push is always attempted for a SECURITY_ALERT, regardless of what
//      happens to be sitting in storage (e.g. written directly by a
//      migration, an older client, or a bug elsewhere). Two independent
//      layers, same "a bank never lets you turn off fraud alerts"
//      principle described in notification-catalog.js.

const {
  resolveNotificationType,
  buildDeepLink,
  MUTEABLE_CATEGORIES,
} = require('../domain/notification-catalog');
const { assertValidPlatform, assertValidPushToken } = require('../database/models/notification.model');

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}
function forbidden(message) {
  return Object.assign(new Error(message), { status: 403 });
}
function notFound(message) {
  return Object.assign(new Error(message), { status: 404 });
}

function humanizeType(type) {
  return String(type)
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

// `notifications` (required): ../database/repositories/notification.repository.js
// instance -- the only place notification/preferences/push-token data lives.
// `pushProvider` (optional): ../push/push.service.js's createPushProvider()
// result. When omitted, every push attempt reports `blocked: true` with a
// clear reason -- same "optional dependency, additive behavior" pattern as
// gifts.service.js's `accounts`/`eventService`/`coupleService`.
// `bus` (optional): ../realtime/notification-bus.js instance. When
// omitted, notify() simply does not publish anywhere -- nothing currently
// depends on the bus existing.
// `now` (optional, test seam): defaults to the real clock.
function createNotificationService({ notifications, pushProvider, bus, now = () => new Date() }) {
  function requireNotifications() {
    if (!notifications) throw new Error('notification.service.js requires a `notifications` repository');
  }
  requireNotifications();

  // Never throws -- a failed/unavailable/blocked push is a normal,
  // expected real-world outcome (no devices registered, server not
  // configured, SDK not installed, FCM itself rejected the call), not a
  // reason to fail the notification that has already been durably
  // recorded. Any invalid tokens FCM reports back are actually pruned
  // from push_tokens here -- a stale token (e.g. app uninstalled) cleans
  // itself up on the very next attempted delivery to it, it is not left
  // to accumulate forever.
  async function attemptPush({ recipientId, type, category, payload }) {
    if (!pushProvider) {
      return { attempted: false, blocked: true, reason: 'push is not configured on this server' };
    }
    if (typeof pushProvider.isConfigured === 'function' && !pushProvider.isConfigured()) {
      return { attempted: false, blocked: true, reason: 'push is not configured on this server' };
    }
    if (typeof pushProvider.isSdkAvailable === 'function' && !pushProvider.isSdkAvailable()) {
      return { attempted: false, blocked: true, reason: 'the firebase-admin SDK is not installed on this server' };
    }

    const devices = await notifications.listDevicesForAccount(recipientId);
    const tokens = devices.map((d) => d.token);
    if (tokens.length === 0) {
      return { attempted: false, blocked: false, reason: 'recipient has no registered devices' };
    }

    try {
      const result = await pushProvider.sendToTokens({
        tokens,
        title: humanizeType(type),
        body: `You have a new ${category} notification`,
        data: { type, category },
      });
      if (Array.isArray(result.invalidTokens) && result.invalidTokens.length > 0) {
        await Promise.all(result.invalidTokens.map((t) => notifications.removeDevice(recipientId, t)));
      }
      return {
        attempted: true,
        blocked: false,
        successCount: result.successCount,
        failureCount: result.failureCount,
        prunedInvalidTokens: (result.invalidTokens || []).length,
      };
    } catch (err) {
      // A real 503 from push.service.js (not configured / SDK missing --
      // already handled above, but re-checked here in case pushProvider's
      // own state changed between the checks above and this call) or any
      // other real delivery failure -- reported, never swallowed silently
      // and never allowed to fail notify()/redeliverPendingPush() itself.
      return { attempted: true, blocked: true, failed: true, reason: err.message };
    }
  }

  // Shared by notify() and redeliverPendingPush() -- 'security' always
  // bypasses stored mute preferences (see file header, layer 2 of 2).
  async function pushRespectingPreferences({ recipientId, type, category, payload }) {
    if (category !== 'security') {
      const prefs = await notifications.getPreferences(recipientId);
      const muted = Boolean(prefs && Array.isArray(prefs.mutedCategories) && prefs.mutedCategories.includes(category));
      if (muted) {
        return { attempted: false, blocked: false, reason: 'this category is muted by the recipient' };
      }
    }
    return attemptPush({ recipientId, type, category, payload });
  }

  // The ONLY function here not scoped by `actingAccountId` -- it is only
  // ever called by trusted server-side code (other services reporting a
  // real, already-completed action), never directly from a route handler
  // with a client-supplied recipientId. See STAGE33_PROGRESS_STOPPED.md
  // section 3 for the full list of real integrations that call this.
  async function notify({ recipientId, type, payload }) {
    if (typeof recipientId !== 'string' || !recipientId) throw badRequest('recipientId is required');
    const catalogEntry = resolveNotificationType(type); // throws 400 on unknown type
    const safePayload = payload || {};
    const deepLink = buildDeepLink(type, safePayload);

    const record = await notifications.createNotification({
      recipientId,
      type,
      category: catalogEntry.category,
      payload: safePayload,
      deepLink,
      now: now(),
    });

    if (bus) bus.publish(recipientId, record);

    const push = await pushRespectingPreferences({
      recipientId,
      type,
      category: catalogEntry.category,
      payload: safePayload,
    });

    return { notification: record, push };
  }

  async function list({ actingAccountId, limit }) {
    if (typeof actingAccountId !== 'string' || !actingAccountId) throw badRequest('actingAccountId is required');
    return notifications.listForAccount(actingAccountId, { limit });
  }

  async function getUnreadCount({ actingAccountId }) {
    if (typeof actingAccountId !== 'string' || !actingAccountId) throw badRequest('actingAccountId is required');
    return notifications.countUnread(actingAccountId);
  }

  async function requireOwnNotification(notificationId, actingAccountId) {
    const existing = await notifications.findNotificationById(notificationId);
    if (!existing) throw notFound('notification not found');
    if (existing.recipientId !== actingAccountId) throw forbidden('you may only act on your own notifications');
    return existing;
  }

  async function markRead({ actingAccountId, notificationId }) {
    if (typeof actingAccountId !== 'string' || !actingAccountId) throw badRequest('actingAccountId is required');
    await requireOwnNotification(notificationId, actingAccountId);
    return notifications.markRead(notificationId, now());
  }

  async function markAllRead({ actingAccountId }) {
    if (typeof actingAccountId !== 'string' || !actingAccountId) throw badRequest('actingAccountId is required');
    const count = await notifications.markAllRead(actingAccountId, now());
    return { markedRead: count };
  }

  async function getPreferences({ actingAccountId }) {
    if (typeof actingAccountId !== 'string' || !actingAccountId) throw badRequest('actingAccountId is required');
    const existing = await notifications.getPreferences(actingAccountId);
    // An account with no row yet gets the real default (nothing muted),
    // same "no row = default" contract as notification.repository.js's
    // header describes -- never fabricated as if it were a stored value.
    return existing || { accountId: actingAccountId, mutedCategories: [], createdAt: null, updatedAt: null };
  }

  async function updatePreferences({ actingAccountId, mutedCategories }) {
    if (typeof actingAccountId !== 'string' || !actingAccountId) throw badRequest('actingAccountId is required');
    if (!Array.isArray(mutedCategories)) throw badRequest('mutedCategories must be an array');
    // 'security' is silently stripped here even if the client sent it --
    // layer 1 of 2, see file header. Any category not in
    // MUTEABLE_CATEGORIES (unknown/typo'd category, or 'security') is
    // dropped rather than rejected with an error, so a client sending a
    // slightly-stale category list never gets a hard failure.
    const filtered = mutedCategories.filter((c) => MUTEABLE_CATEGORIES.includes(c));
    return notifications.setPreferences(actingAccountId, filtered, now());
  }

  async function registerDevice({ actingAccountId, token, platform }) {
    if (typeof actingAccountId !== 'string' || !actingAccountId) throw badRequest('actingAccountId is required');
    assertValidPushToken(token);
    assertValidPlatform(platform);
    return notifications.registerDevice({ accountId: actingAccountId, token, platform, now: now() });
  }

  async function removeDevice({ actingAccountId, token }) {
    if (typeof actingAccountId !== 'string' || !actingAccountId) throw badRequest('actingAccountId is required');
    if (typeof token !== 'string' || !token) throw badRequest('token is required');
    const removed = await notifications.removeDevice(actingAccountId, token);
    return { removed };
  }

  // Re-attempts push delivery for an already-recorded notification --
  // e.g. the client wants to retry after the user just granted OS-level
  // notification permission, or just registered a new device. Never
  // creates a new notification record; the in-app notification already
  // exists. Same ownership check as markRead(), same mute-respecting /
  // security-always-bypasses logic as notify().
  async function redeliverPendingPush({ actingAccountId, notificationId }) {
    if (typeof actingAccountId !== 'string' || !actingAccountId) throw badRequest('actingAccountId is required');
    const existing = await requireOwnNotification(notificationId, actingAccountId);
    const push = await pushRespectingPreferences({
      recipientId: actingAccountId,
      type: existing.type,
      category: existing.category,
      payload: existing.payload,
    });
    return { notification: existing, push };
  }

  return {
    notify,
    list,
    getUnreadCount,
    markRead,
    markAllRead,
    getPreferences,
    updatePreferences,
    registerDevice,
    removeDevice,
    redeliverPendingPush,
  };
}

module.exports = { createNotificationService };
