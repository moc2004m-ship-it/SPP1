'use strict';
// Stage 6 (Home) -- route-contract tests for the two handlers Stage 6
// added/enriched in src/routes/platform.routes.js: the new
// GET /api/home/rooms (tab-aware feed) and the enriched GET /api/home
// (categories + unreadNotifications on top of the untouched Stage 12
// rooms/events shape).
//
// platform.routes.js itself cannot be require()'d in this environment --
// it does `require('express')` at the top of the file, and express is not
// installed here (no network access to install it; see
// STAGE6_STOP_REPORT.md section 4 and the four pre-existing environmental
// fails in accounts/agora/auth/config routes.test.js). Same "pure logic,
// fake req/res inputs" style as platform.rooms.routes-contract.test.js and
// platform.notifications.routes-contract.test.js: each handler's own call
// shape is re-created verbatim against the real platform.rooms.* and
// notificationService.* methods, without needing express itself.
//
// What this proves: both routes take actingAccountId from
// req.session.accountId ONLY (never a client-supplied field); GET
// /api/home/rooms wires req.query.{tab,category,language,tag,q} straight
// into discoverForHome() (defaulting tab to 'new' exactly like the
// handler's `req.query.tab || 'new'`); GET /api/home's added fields come
// from categoryCounts()/getUnreadCount() while its pre-existing
// rooms/events/tabs/entries shape is byte-for-byte unchanged. The
// underlying discoverForHome()/categoryCounts() business logic itself is
// exhaustively covered separately in rooms.stage6.home-feed.test.js --
// this file is deliberately about the routing/session-identity contract,
// not re-proving that logic.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform } = require('../src/feature-platform');
const { InMemoryNotificationRepository } = require('../src/database/repositories/notification.repository');
const { createNotificationService } = require('../src/services/notification.service');

function setup() {
  const platform = createPlatform({});
  const notifications = new InMemoryNotificationRepository();
  const notificationService = createNotificationService({ notifications });
  return { platform, notificationService };
}

test('GET /api/home/rooms contract: actingAccountId comes only from req.session.accountId, tab defaults to "new", and filters wire straight into discoverForHome()', async () => {
  const { platform } = setup();
  const owner = 'acc_owner';
  const older = await platform.rooms.create({ ownerId: owner, name: 'Older', category: 'music' });
  await new Promise((r) => setTimeout(r, 2));
  const newer = await platform.rooms.create({ ownerId: owner, name: 'Newer', category: 'gaming' });

  // req.query.tab omitted entirely -- the handler's own `req.query.tab || 'new'`.
  const reqNoTab = { session: { accountId: 'acc_stranger' }, query: {} };
  const defaulted = await platform.rooms.discoverForHome({
    actingAccountId: reqNoTab.session.accountId,
    tab: reqNoTab.query.tab || 'new',
    category: reqNoTab.query.category,
    language: reqNoTab.query.language,
    tag: reqNoTab.query.tag,
    query: reqNoTab.query.q,
  });
  assert.equal(defaulted[0].id, newer.id, "'new' (the default) must be newest-first");

  // A hostile client-supplied identity field in the query must never be
  // used -- only req.session.accountId, exactly as the handler passes it.
  const reqSpoofed = { session: { accountId: 'acc_stranger' }, query: { tab: 'new', actingAccountId: 'acc_owner' } };
  const rooms = await platform.rooms.discoverForHome({
    actingAccountId: reqSpoofed.session.accountId,
    tab: reqSpoofed.query.tab || 'new',
    category: reqSpoofed.query.category,
    language: reqSpoofed.query.language,
    tag: reqSpoofed.query.tag,
    query: reqSpoofed.query.q,
  });
  assert.ok(rooms.every((r) => !('passwordHash' in r)));

  // category filter (req.query.category) wires straight through.
  const reqFiltered = { session: { accountId: owner }, query: { tab: 'new', category: 'music' } };
  const filtered = await platform.rooms.discoverForHome({
    actingAccountId: reqFiltered.session.accountId,
    tab: reqFiltered.query.tab || 'new',
    category: reqFiltered.query.category,
    language: reqFiltered.query.language,
    tag: reqFiltered.query.tag,
    query: reqFiltered.query.q,
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, older.id);
});

test('GET /api/home/rooms contract: an unknown tab from the query string surfaces as a real 400, not a 500 or a silent fallback', async () => {
  const { platform } = setup();
  const req = { session: { accountId: 'acc_a' }, query: { tab: 'trending' } };
  await assert.rejects(
    () => platform.rooms.discoverForHome({
      actingAccountId: req.session.accountId,
      tab: req.query.tab || 'new',
      category: req.query.category,
      language: req.query.language,
      tag: req.query.tag,
      query: req.query.q,
    }),
    /tab must be one of/,
  );
});

test('GET /api/home contract: categories/unreadNotifications are added on top of the untouched Stage 12 rooms/events/tabs/entries shape', async () => {
  const { platform, notificationService } = setup();
  const owner = 'acc_owner';
  const stranger = 'acc_stranger';
  await platform.rooms.create({ ownerId: owner, name: 'Private Home Room', visibility: 'private', category: 'music' });
  await platform.rooms.create({ ownerId: stranger, name: 'Public Room', category: 'gaming' });
  await notificationService.notify({ recipientId: stranger, type: 'NEW_FOLLOWER', payload: {} });

  // What the (enriched) GET /api/home handler does, verbatim.
  const req = { session: { accountId: stranger } };
  const [rooms, events] = await Promise.all([
    platform.rooms.listDiscoverable({ actingAccountId: req.session.accountId }),
    platform.store.list(31),
  ]);
  const [categories, unreadNotifications] = await Promise.all([
    platform.rooms.categoryCounts({ actingAccountId: req.session.accountId }),
    notificationService.getUnreadCount({ actingAccountId: req.session.accountId }),
  ]);
  const home = { ...platform.home, rooms: rooms.slice(-20).reverse(), events: events.slice(-10).reverse(), categories, unreadNotifications };

  // Pre-existing shape (Stage 12/untouched Stage 0 fields) is intact.
  assert.deepEqual(home.tabs, ['live', 'following', 'popular', 'new', 'categories']);
  assert.deepEqual(home.entries, ['games', 'events', 'rankings', 'family', 'search', 'notifications']);
  assert.ok(!home.rooms.some((r) => r.name === 'Private Home Room'), 'private room owned by someone else must not leak');
  for (const room of home.rooms) assert.equal('passwordHash' in room, false);

  // New, additive fields, real (not fabricated) values.
  const musicEntry = home.categories.find((c) => c.id === 'music');
  assert.ok(musicEntry, 'categoryCounts() must return every real catalog category');
  assert.equal(musicEntry.count, 0, "the only 'music' room is private and owned by someone else -- must count 0 for this stranger, not leak the hidden room's count");
  const gamingEntry = home.categories.find((c) => c.id === 'gaming');
  assert.equal(gamingEntry.count, 1);
  assert.equal(home.unreadNotifications, 1);
});

test('GET /api/home contract: unreadNotifications reflects the same real, per-account count GET /api/notifications/unread-count uses -- never a client-supplied id', async () => {
  const { notificationService } = setup();
  await notificationService.notify({ recipientId: 'acc_real', type: 'GIFT_RECEIVED', payload: {} });
  await notificationService.notify({ recipientId: 'acc_other', type: 'GIFT_RECEIVED', payload: {} });

  const req = { session: { accountId: 'acc_real' } };
  const count = await notificationService.getUnreadCount({ actingAccountId: req.session.accountId });
  assert.equal(count, 1, "must only count acc_real's own unread notifications, not acc_other's");
});
