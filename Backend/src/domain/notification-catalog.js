'use strict';

// Stage 33 — Notifications catalog.
//
// Same boundary as guard-catalog.js/store-catalog.js: the set of valid
// notification `type` values, their `category` (used for
// notification_preferences -- a user can mute a whole category, e.g.
// "social", without muting "security"), and a deep-link builder (used by
// the Mobile client to route a tap on a notification straight to the
// relevant screen) are ALWAYS resolved here, server-side, from a type
// key -- never accepted as free-form strings from the caller of
// notification.service.js's notify(). This keeps every notification ever
// created shaped consistently and keeps the Mobile client's routing table
// in exactly one place.
//
// category values: 'social' | 'gift' | 'room' | 'family' | 'couple' |
// 'guard' | 'event' | 'wallet' | 'progression' | 'security'. Every
// category except 'security' is muteable via notification preferences
// (see notification.service.js's updatePreferences) -- security alerts
// can never be silenced, same principle as a bank never letting you turn
// off fraud alerts.

const NOTIFICATION_TYPES = Object.freeze({
  FRIEND_REQUEST: Object.freeze({
    type: 'FRIEND_REQUEST',
    category: 'social',
    deepLink: (p) => `app://friends/requests/${p.requestId}`,
  }),
  FRIEND_ACCEPTED: Object.freeze({
    type: 'FRIEND_ACCEPTED',
    category: 'social',
    deepLink: (p) => `app://profile/${p.accountId}`,
  }),
  NEW_FOLLOWER: Object.freeze({
    type: 'NEW_FOLLOWER',
    category: 'social',
    deepLink: (p) => `app://profile/${p.accountId}`,
  }),
  PRIVATE_MESSAGE: Object.freeze({
    type: 'PRIVATE_MESSAGE',
    category: 'social',
    deepLink: (p) => `app://chat/${p.conversationId}`,
  }),
  ROOM_INVITE: Object.freeze({
    type: 'ROOM_INVITE',
    category: 'room',
    deepLink: (p) => `app://rooms/${p.roomId}`,
  }),
  MIC_SEAT_APPROVED: Object.freeze({
    type: 'MIC_SEAT_APPROVED',
    category: 'room',
    deepLink: (p) => `app://rooms/${p.roomId}`,
  }),
  MIC_SEAT_REJECTED: Object.freeze({
    type: 'MIC_SEAT_REJECTED',
    category: 'room',
    deepLink: (p) => `app://rooms/${p.roomId}`,
  }),
  GIFT_RECEIVED: Object.freeze({
    type: 'GIFT_RECEIVED',
    category: 'gift',
    deepLink: (p) => `app://gifts/received/${p.giftId || ''}`,
  }),
  VIP_UPGRADED: Object.freeze({
    type: 'VIP_UPGRADED',
    category: 'progression',
    deepLink: () => 'app://profile/vip',
  }),
  SVIP_UPGRADED: Object.freeze({
    type: 'SVIP_UPGRADED',
    category: 'progression',
    deepLink: () => 'app://profile/vip',
  }),
  LVL_UP: Object.freeze({
    type: 'LVL_UP',
    category: 'progression',
    deepLink: () => 'app://profile/level',
  }),
  FAMILY_INVITE: Object.freeze({
    type: 'FAMILY_INVITE',
    category: 'family',
    deepLink: (p) => `app://family/invites/${p.inviteId}`,
  }),
  FAMILY_INVITE_ACCEPTED: Object.freeze({
    type: 'FAMILY_INVITE_ACCEPTED',
    category: 'family',
    deepLink: (p) => `app://family/${p.familyId}`,
  }),
  EVENT_REWARD_CLAIMED: Object.freeze({
    type: 'EVENT_REWARD_CLAIMED',
    category: 'event',
    deepLink: (p) => `app://events/${p.eventId}`,
  }),
  RANKING_CHANGED: Object.freeze({
    type: 'RANKING_CHANGED',
    category: 'event',
    deepLink: (p) => `app://rankings/${p.rankingType || ''}`,
  }),
  SECURITY_ALERT: Object.freeze({
    type: 'SECURITY_ALERT',
    category: 'security',
    deepLink: () => 'app://settings/security',
  }),
  PAYMENT_COMPLETED: Object.freeze({
    type: 'PAYMENT_COMPLETED',
    category: 'wallet',
    deepLink: (p) => `app://wallet/orders/${p.orderId || ''}`,
  }),
  COUPLE_INVITE: Object.freeze({
    type: 'COUPLE_INVITE',
    category: 'couple',
    deepLink: (p) => `app://couple/invites/${p.inviteId}`,
  }),
  COUPLE_INVITE_ACCEPTED: Object.freeze({
    type: 'COUPLE_INVITE_ACCEPTED',
    category: 'couple',
    deepLink: (p) => `app://couple/${p.coupleId || ''}`,
  }),
  GUARD_NEW_FAN: Object.freeze({
    type: 'GUARD_NEW_FAN',
    category: 'guard',
    deepLink: (p) => `app://guard/fan-club/${p.hostId || ''}`,
  }),
});

const NOTIFICATION_CATEGORIES = Object.freeze([
  'social',
  'gift',
  'room',
  'family',
  'couple',
  'guard',
  'event',
  'wallet',
  'progression',
  'security',
]);

// Categories a user is allowed to mute via notification preferences.
// 'security' is deliberately excluded -- see file header.
const MUTEABLE_CATEGORIES = Object.freeze(NOTIFICATION_CATEGORIES.filter((c) => c !== 'security'));

function resolveNotificationType(typeKey) {
  const entry = NOTIFICATION_TYPES[typeKey];
  if (!entry) {
    throw Object.assign(
      new Error(`unknown notification type; must be one of ${Object.keys(NOTIFICATION_TYPES).join(', ')}`),
      { status: 400 }
    );
  }
  return entry;
}

// Builds the deep link for a given type + payload. Never throws on a
// payload missing an expected field -- deepLink builders above use `|| ''`
// wherever a field might legitimately be absent, so a malformed/partial
// payload still yields a usable (if less specific) link rather than
// crashing notification creation.
function buildDeepLink(typeKey, payload = {}) {
  const entry = resolveNotificationType(typeKey);
  return entry.deepLink(payload || {});
}

module.exports = {
  NOTIFICATION_TYPES,
  NOTIFICATION_CATEGORIES,
  MUTEABLE_CATEGORIES,
  resolveNotificationType,
  buildDeepLink,
};
