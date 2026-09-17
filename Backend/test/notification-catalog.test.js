'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_CATEGORIES,
  MUTEABLE_CATEGORIES,
  resolveNotificationType,
  buildDeepLink,
} = require('../src/domain/notification-catalog');

test('every catalog entry has a type key matching its own `type` field and a valid category', () => {
  for (const [key, entry] of Object.entries(NOTIFICATION_TYPES)) {
    assert.equal(entry.type, key, `entry key ${key} must match its own type field`);
    assert.ok(NOTIFICATION_CATEGORIES.includes(entry.category), `${key} has an unknown category "${entry.category}"`);
    assert.equal(typeof entry.deepLink, 'function', `${key} must have a deepLink builder`);
  }
});

test('resolveNotificationType returns the catalog entry for a known type', () => {
  const entry = resolveNotificationType('GIFT_RECEIVED');
  assert.equal(entry.type, 'GIFT_RECEIVED');
  assert.equal(entry.category, 'gift');
});

test('resolveNotificationType throws 400 for an unknown type', () => {
  assert.throws(() => resolveNotificationType('NOT_A_REAL_TYPE'), (err) => {
    assert.equal(err.status, 400);
    assert.match(err.message, /unknown notification type/);
    return true;
  });
});

test('resolveNotificationType throws 400 for a missing/empty type', () => {
  assert.throws(() => resolveNotificationType(undefined), { status: 400 });
  assert.throws(() => resolveNotificationType(''), { status: 400 });
});

test('security is never muteable, every other category is', () => {
  assert.ok(!MUTEABLE_CATEGORIES.includes('security'), 'security alerts must never be muteable');
  for (const category of NOTIFICATION_CATEGORIES) {
    if (category === 'security') continue;
    assert.ok(MUTEABLE_CATEGORIES.includes(category), `${category} must be muteable`);
  }
});

test('buildDeepLink produces a real link for every catalog type with a representative payload', () => {
  const payloads = {
    FRIEND_REQUEST: { requestId: 's10_1' },
    FRIEND_ACCEPTED: { accountId: 'acc_1' },
    NEW_FOLLOWER: { accountId: 'acc_1' },
    PRIVATE_MESSAGE: { conversationId: 'conv_1' },
    ROOM_INVITE: { roomId: 'room_1' },
    MIC_SEAT_APPROVED: { roomId: 'room_1' },
    MIC_SEAT_REJECTED: { roomId: 'room_1' },
    GIFT_RECEIVED: { giftId: 'gift_1' },
    VIP_UPGRADED: {},
    SVIP_UPGRADED: {},
    LVL_UP: {},
    FAMILY_INVITE: { inviteId: 'finv_1' },
    FAMILY_INVITE_ACCEPTED: { familyId: 'fam_1' },
    EVENT_REWARD_CLAIMED: { eventId: 'evt_1' },
    RANKING_CHANGED: { rankingType: 'wealth' },
    SECURITY_ALERT: {},
    PAYMENT_COMPLETED: { orderId: 'ord_1' },
    COUPLE_INVITE: { inviteId: 'cinv_1' },
    COUPLE_INVITE_ACCEPTED: { coupleId: 'cpl_1' },
    GUARD_NEW_FAN: { hostId: 'usr_host' },
  };
  for (const [type, payload] of Object.entries(payloads)) {
    const link = buildDeepLink(type, payload);
    assert.equal(typeof link, 'string');
    assert.match(link, /^app:\/\//, `${type} deep link must start with app://`);
  }
});

test('buildDeepLink never throws on a missing optional payload field', () => {
  assert.doesNotThrow(() => buildDeepLink('GIFT_RECEIVED', {}));
  assert.doesNotThrow(() => buildDeepLink('PAYMENT_COMPLETED', undefined));
  assert.doesNotThrow(() => buildDeepLink('SECURITY_ALERT'));
});

test('the catalog covers exactly the 19 types planned for Stage 33', () => {
  const expected = [
    'FRIEND_REQUEST', 'FRIEND_ACCEPTED', 'NEW_FOLLOWER', 'PRIVATE_MESSAGE', 'ROOM_INVITE',
    'MIC_SEAT_APPROVED', 'MIC_SEAT_REJECTED', 'GIFT_RECEIVED', 'VIP_UPGRADED', 'SVIP_UPGRADED',
    'LVL_UP', 'FAMILY_INVITE', 'FAMILY_INVITE_ACCEPTED', 'EVENT_REWARD_CLAIMED', 'RANKING_CHANGED',
    'SECURITY_ALERT', 'PAYMENT_COMPLETED', 'COUPLE_INVITE', 'COUPLE_INVITE_ACCEPTED', 'GUARD_NEW_FAN',
  ];
  assert.deepEqual(Object.keys(NOTIFICATION_TYPES).sort(), expected.sort());
});
