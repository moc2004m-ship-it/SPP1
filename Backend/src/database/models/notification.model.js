// Stage 33 — Notifications + Push model.
//
// Same boundary as couple.model.js/guard.model.js: nothing here accepts a
// client-supplied id. Ids are always generated here. `type` is always
// validated against ../../domain/notification-catalog.js's
// resolveNotificationType() by notification.service.js BEFORE a record is
// ever created — this file only owns id shapes and the fixed enums below,
// never the catalog itself.

const crypto = require('node:crypto');

function generateNotificationId() {
  return `ntf_${crypto.randomUUID()}`;
}

function generatePushTokenId() {
  return `pt_${crypto.randomUUID()}`;
}

const NOTIFICATION_STATUSES = Object.freeze(['unread', 'read']);

const PUSH_PLATFORMS = Object.freeze(['ios', 'android', 'web']);

function assertValidPlatform(platform) {
  if (!PUSH_PLATFORMS.includes(platform)) {
    throw Object.assign(new Error(`platform must be one of ${PUSH_PLATFORMS.join(', ')}`), { status: 400 });
  }
}

function assertValidPushToken(token) {
  if (typeof token !== 'string' || !token.trim() || token.length > 4096) {
    throw Object.assign(new Error('token is invalid'), { status: 400 });
  }
}

module.exports = {
  NOTIFICATION_STATUSES,
  PUSH_PLATFORMS,
  generateNotificationId,
  generatePushTokenId,
  assertValidPlatform,
  assertValidPushToken,
};
