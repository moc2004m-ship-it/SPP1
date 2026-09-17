'use strict';
// Stage 6 -- Home. Real integration tests through the actual
// createPlatform() (same in-memory FeatureStore every other
// feature-platform.test.js/rooms.stage12.create.test.js test uses -- no
// mock of discoverForHome()/categoryCounts() themselves), covering the
// exact gap STAGES_05_35_STATUS.md documented: Stage 6's tabs
// (live/following/popular/new) and entries (categories/notifications
// unread count) had a backend domain foundation but no tab-aware feed
// logic. listDiscoverable() (Stage 12) is completely untouched -- every
// assertion here is against the NEW discoverForHome()/categoryCounts()
// methods only.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform } = require('../src/feature-platform');

function setup() {
  return createPlatform({});
}

test('discoverForHome(): rejects an unknown tab', async () => {
  const p = setup();
  await assert.rejects(() => p.rooms.discoverForHome({ actingAccountId: 'acc_a', tab: 'trending' }), /tab must be one of/);
});

test("discoverForHome(): 'following' requires actingAccountId and requires an actual follow relationship", async () => {
  const p = setup();
  await assert.rejects(() => p.rooms.discoverForHome({ tab: 'following' }), /actingAccountId is required/);

  const follower = 'acc_follower';
  const followedOwner = 'acc_followed';
  const strangerOwner = 'acc_stranger';
  await p.rooms.create({ ownerId: followedOwner, name: 'Followed Owner Room' });
  await p.rooms.create({ ownerId: strangerOwner, name: 'Stranger Room' });

  // Not following anyone yet -> empty, not an error, not every room.
  const beforeFollow = await p.rooms.discoverForHome({ actingAccountId: follower, tab: 'following' });
  assert.deepEqual(beforeFollow, []);

  await p.social.follow(follower, followedOwner);
  const afterFollow = await p.rooms.discoverForHome({ actingAccountId: follower, tab: 'following' });
  assert.equal(afterFollow.length, 1);
  assert.equal(afterFollow[0].name, 'Followed Owner Room');

  // Unfollowing removes it again -- the tab reflects the real, current
  // follow ledger, not a point-in-time snapshot.
  await p.social.unfollow(follower, followedOwner);
  const afterUnfollow = await p.rooms.discoverForHome({ actingAccountId: follower, tab: 'following' });
  assert.deepEqual(afterUnfollow, []);
});

test("discoverForHome(): 'live'/'popular' reflect the real Stage-13 joined-membership count, not a fabricated number", async () => {
  const p = setup();
  const owner = 'acc_owner';
  const userA = 'acc_a';
  const userB = 'acc_b';
  const quiet = await p.rooms.create({ ownerId: owner, name: 'Quiet Room' });
  const busy = await p.rooms.create({ ownerId: owner, name: 'Busy Room' });

  // Before anyone joins: 'live' is empty, 'new'/'popular' both show
  // memberCount 0 / isLive false for every room -- an honest empty
  // room is not "live".
  const liveBefore = await p.rooms.discoverForHome({ actingAccountId: owner, tab: 'live' });
  assert.deepEqual(liveBefore, []);
  const popularBefore = await p.rooms.discoverForHome({ actingAccountId: owner, tab: 'popular' });
  assert.ok(popularBefore.every((r) => r.memberCount === 0 && r.isLive === false));

  await p.rooms.join(busy.id, userA);
  await p.rooms.join(busy.id, userB);

  const live = await p.rooms.discoverForHome({ actingAccountId: owner, tab: 'live' });
  assert.equal(live.length, 1);
  assert.equal(live[0].id, busy.id);
  assert.equal(live[0].memberCount, 2);
  assert.equal(live[0].isLive, true);

  const popular = await p.rooms.discoverForHome({ actingAccountId: owner, tab: 'popular' });
  // Busiest room first.
  assert.equal(popular[0].id, busy.id);
  assert.equal(popular[0].memberCount, 2);
  const quietEntry = popular.find((r) => r.id === quiet.id);
  assert.equal(quietEntry.memberCount, 0);

  // A member leaving drops the real count back down -- not sticky.
  await p.rooms.leave(busy.id, userA);
  const liveAfterLeave = await p.rooms.discoverForHome({ actingAccountId: owner, tab: 'live' });
  assert.equal(liveAfterLeave[0].memberCount, 1);
});

test("discoverForHome(): 'new' is newest-first and every tab still strips passwordHash / hides others' private rooms, same as listDiscoverable()", async () => {
  const p = setup();
  const owner = 'acc_owner';
  const stranger = 'acc_stranger';
  const first = await p.rooms.create({ ownerId: owner, name: 'First Room', password: 'sesame1' });
  const second = await p.rooms.create({ ownerId: owner, name: 'Second Room' });
  await p.rooms.create({ ownerId: owner, name: 'Private Room', visibility: 'private' });

  const asStranger = await p.rooms.discoverForHome({ actingAccountId: stranger, tab: 'new' });
  assert.ok(!asStranger.some((r) => r.name === 'Private Room'));
  for (const r of asStranger) assert.equal('passwordHash' in r, false);
  // Newest first.
  assert.equal(asStranger[0].id, second.id);
  assert.equal(asStranger[1].id, first.id);
});

test('discoverForHome(): category/language/tag/q filters combine with a tab exactly like listDiscoverable()', async () => {
  const p = setup();
  const owner = 'acc_owner';
  await p.rooms.create({ ownerId: owner, name: 'Wanted Room', category: 'music', language: 'es', tags: ['live'] });
  await p.rooms.create({ ownerId: owner, name: 'Other Room', category: 'gaming', language: 'en' });

  const filtered = await p.rooms.discoverForHome({ actingAccountId: owner, tab: 'new', category: 'music', language: 'es', tag: 'live', query: 'wanted' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].name, 'Wanted Room');
});

test('categoryCounts(): every catalog category is present, counts are real and reflect visibility', async () => {
  const p = setup();
  const owner = 'acc_owner';
  const stranger = 'acc_stranger';
  await p.rooms.create({ ownerId: owner, name: 'Music Room 1', category: 'music' });
  await p.rooms.create({ ownerId: owner, name: 'Music Room 2', category: 'music' });
  await p.rooms.create({ ownerId: owner, name: 'Private Gaming Room', category: 'gaming', visibility: 'private' });

  const asOwner = await p.rooms.categoryCounts({ actingAccountId: owner });
  const music = asOwner.find((c) => c.id === 'music');
  const gaming = asOwner.find((c) => c.id === 'gaming');
  const comedy = asOwner.find((c) => c.id === 'comedy');
  assert.equal(music.count, 2);
  assert.equal(gaming.count, 1); // owner can see their own private room
  assert.equal(comedy.count, 0); // present with a real zero, not omitted

  const asStranger = await p.rooms.categoryCounts({ actingAccountId: stranger });
  const gamingForStranger = asStranger.find((c) => c.id === 'gaming');
  assert.equal(gamingForStranger.count, 0); // the private room is invisible to a stranger
});
