'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform } = require('../src/feature-platform');
const { verifyRoomPassword } = require('../src/security/room-password');

// Stage 12 -- Create Room. Real integration tests through the actual
// createPlatform() (the same in-memory FeatureStore every other
// feature-platform.test.js test uses -- no mock of rooms.create()/
// listDiscoverable()/join() themselves), covering exactly what section 3
// of STAGE12_PROGRESS_STOPPED.md called out as still missing: the real
// end-to-end 400 rejection paths from room.model.js/room-catalog.js (not
// just those two files' own unit tests, which exercise the assert*/
// resolve* functions in isolation), the discovery visibility/filter
// behavior together, and the password-protected join() lifecycle.

function setup(clock) {
  return createPlatform(clock ? { clock } : {});
}

test('rooms.create(): every explicit field together, plus every default at once, round-trip correctly', async () => {
  const p = setup();

  // Every field explicit.
  const full = await p.rooms.create({
    ownerId: 'usr_owner', name: 'Full Room', visibility: 'private', micSeats: 10,
    capacity: 5, theme: 'ocean', category: 'gaming', language: 'fr', ageRule: '18+',
    tags: ['chill', 'Chill', '  night-owls  '], cover: 'https://example.com/cover.png',
    background: 'http://example.com/bg.png', announcement: 'welcome!', password: 'sesame1',
  });
  assert.ok(full.id.startsWith('s12_'), `id should start with s12_, got ${full.id}`);
  assert.equal(full.ownerId, 'usr_owner');
  assert.equal(full.name, 'Full Room');
  assert.equal(full.visibility, 'private');
  assert.equal(full.micSeats, 10);
  assert.equal(full.capacity, 5);
  assert.equal(full.theme, 'ocean');
  assert.equal(full.category, 'gaming');
  assert.equal(full.language, 'fr');
  assert.equal(full.ageRule, '18+');
  // tags: trimmed + de-duplicated case-insensitively, first occurrence wins.
  assert.deepEqual(full.tags, ['chill', 'night-owls']);
  assert.equal(full.cover, 'https://example.com/cover.png');
  assert.equal(full.background, 'http://example.com/bg.png');
  assert.equal(full.announcement, 'welcome!');
  assert.equal(full.status, 'open');
  // Real password lock: hasPassword true, a real non-plaintext hash
  // stored, and it actually verifies against the original password.
  assert.equal(full.hasPassword, true);
  assert.ok(full.passwordHash && full.passwordHash.includes(':'));
  assert.notEqual(full.passwordHash, 'sesame1');
  assert.equal(verifyRoomPassword('sesame1', full.passwordHash), true);
  assert.equal(verifyRoomPassword('wrong-password', full.passwordHash), false);

  // Every field omitted (the pre-Stage-12 call shape) -> documented defaults.
  const bare = await p.rooms.create({ ownerId: 'usr_owner2', name: 'Bare Room' });
  assert.ok(bare.id.startsWith('s12_'));
  assert.equal(bare.visibility, 'public');
  assert.equal(bare.micSeats, 8);
  assert.equal(bare.capacity, null);
  assert.equal(bare.theme, 'classic');
  assert.equal(bare.category, 'general');
  assert.equal(bare.language, 'ar');
  assert.equal(bare.ageRule, 'all');
  assert.deepEqual(bare.tags, []);
  assert.equal(bare.cover, null);
  assert.equal(bare.background, null);
  assert.equal(bare.announcement, null);
  assert.equal(bare.hasPassword, false);
  assert.equal(bare.passwordHash, null);
  assert.equal(bare.status, 'open');
});

test('rooms.create(): every pre-Stage-12 call shape ({ownerId,name[,capacity]}) still works unmodified', async () => {
  const p = setup();
  const noCapacity = await p.rooms.create({ ownerId: 'usr_x', name: 'Old Shape' });
  assert.equal(noCapacity.capacity, null);
  const withCapacity = await p.rooms.create({ ownerId: 'usr_x', name: 'Old Shape 2', capacity: 3 });
  assert.equal(withCapacity.capacity, 3);
});

test('rooms.create(): rejects each invalid field with a real 400 from room.model.js/room-catalog.js', async () => {
  const p = setup();
  const base = { ownerId: 'usr_owner', name: 'Room' };

  await assert.rejects(
    async () => p.rooms.create({ ...base, visibility: 'hidden' }),
    (err) => { assert.equal(err.status, 400); assert.match(err.message, /visibility must be one of/); return true; }
  );
  await assert.rejects(
    async () => p.rooms.create({ ...base, micSeats: 0 }),
    (err) => { assert.equal(err.status, 400); assert.match(err.message, /micSeats must be an integer/); return true; }
  );
  await assert.rejects(
    async () => p.rooms.create({ ...base, micSeats: 16 }),
    (err) => { assert.equal(err.status, 400); assert.match(err.message, /micSeats must be an integer/); return true; }
  );
  await assert.rejects(
    async () => p.rooms.create({ ...base, micSeats: -1 }),
    (err) => { assert.equal(err.status, 400); return true; }
  );
  await assert.rejects(
    async () => p.rooms.create({ ...base, theme: 'neon' }),
    (err) => { assert.equal(err.status, 400); assert.match(err.message, /theme must be one of/); return true; }
  );
  await assert.rejects(
    async () => p.rooms.create({ ...base, category: 'crypto' }),
    (err) => { assert.equal(err.status, 400); assert.match(err.message, /category must be one of/); return true; }
  );
  await assert.rejects(
    async () => p.rooms.create({ ...base, language: 'zz' }),
    (err) => { assert.equal(err.status, 400); assert.match(err.message, /language must be one of/); return true; }
  );
  await assert.rejects(
    async () => p.rooms.create({ ...base, ageRule: '21+' }),
    (err) => { assert.equal(err.status, 400); assert.match(err.message, /ageRule must be one of/); return true; }
  );
  await assert.rejects(
    async () => p.rooms.create({ ...base, tags: 'not-an-array' }),
    (err) => { assert.equal(err.status, 400); assert.match(err.message, /tags must be an array/); return true; }
  );
  await assert.rejects(
    async () => p.rooms.create({ ...base, tags: Array.from({ length: 9 }, (_, i) => `t${i}`) }),
    (err) => { assert.equal(err.status, 400); assert.match(err.message, /at most 8 entries/); return true; }
  );
  await assert.rejects(
    async () => p.rooms.create({ ...base, cover: 'not-a-url' }),
    (err) => { assert.equal(err.status, 400); assert.match(err.message, /cover must be an http\(s\) URL/); return true; }
  );
  await assert.rejects(
    async () => p.rooms.create({ ...base, background: 'ftp://example.com/x.png' }),
    (err) => { assert.equal(err.status, 400); assert.match(err.message, /background must be an http\(s\) URL/); return true; }
  );
  await assert.rejects(
    async () => p.rooms.create({ ...base, announcement: '   ' }),
    (err) => { assert.equal(err.status, 400); assert.match(err.message, /announcement must be a non-empty string/); return true; }
  );
  await assert.rejects(
    async () => p.rooms.create({ ...base, password: 'abc' }),
    (err) => { assert.equal(err.status, 400); assert.match(err.message, /password must be between/); return true; }
  );
});

test('rooms.listDiscoverable(): a private room is hidden from everyone but its owner', async () => {
  const p = setup();
  const owner = 'usr_owner';
  const stranger = 'usr_stranger';
  const priv = await p.rooms.create({ ownerId: owner, name: 'Secret Room', visibility: 'private' });
  await p.rooms.create({ ownerId: owner, name: 'Open Room', visibility: 'public' });

  const asOwner = await p.rooms.listDiscoverable({ actingAccountId: owner });
  assert.ok(asOwner.some((r) => r.id === priv.id));

  const asStranger = await p.rooms.listDiscoverable({ actingAccountId: stranger });
  assert.ok(!asStranger.some((r) => r.id === priv.id));
});

test('rooms.listDiscoverable(): passwordHash is never present in any result', async () => {
  const p = setup();
  const owner = 'usr_owner';
  await p.rooms.create({ ownerId: owner, name: 'Locked Room', password: 'letmein1' });
  const rooms = await p.rooms.listDiscoverable({ actingAccountId: owner });
  for (const room of rooms) {
    assert.equal('passwordHash' in room, false);
  }
});

test('rooms.listDiscoverable(): category/language/tag/query filters work individually and combined', async () => {
  const p = setup();
  const owner = 'usr_owner';
  const a = await p.rooms.create({ ownerId: owner, name: 'Gamer Hub', category: 'gaming', language: 'en', tags: ['fps'] });
  const b = await p.rooms.create({ ownerId: owner, name: 'Music Lounge', category: 'music', language: 'en', tags: ['chill'] });
  const c = await p.rooms.create({ ownerId: owner, name: 'Gamer Chat FR', category: 'gaming', language: 'fr', tags: ['fps', 'chill'] });

  const byCategory = await p.rooms.listDiscoverable({ actingAccountId: owner, category: 'gaming' });
  assert.deepEqual(byCategory.map((r) => r.id).sort(), [a.id, c.id].sort());

  const byLanguage = await p.rooms.listDiscoverable({ actingAccountId: owner, language: 'fr' });
  assert.deepEqual(byLanguage.map((r) => r.id), [c.id]);

  const byTag = await p.rooms.listDiscoverable({ actingAccountId: owner, tag: 'chill' });
  assert.deepEqual(byTag.map((r) => r.id).sort(), [b.id, c.id].sort());

  const byQuery = await p.rooms.listDiscoverable({ actingAccountId: owner, query: 'gamer' });
  assert.deepEqual(byQuery.map((r) => r.id).sort(), [a.id, c.id].sort());

  const combined = await p.rooms.listDiscoverable({ actingAccountId: owner, category: 'gaming', language: 'fr', tag: 'chill', query: 'gamer' });
  assert.deepEqual(combined.map((r) => r.id), [c.id]);
});

test('rooms.join(): a password-protected room accepts the correct password', async () => {
  const p = setup();
  const owner = 'usr_owner';
  const room = await p.rooms.create({ ownerId: owner, name: 'Locked', password: 'correct-horse' });
  const membership = await p.rooms.join(room.id, 'usr_guest', 'correct-horse');
  assert.equal(membership.status, 'joined');
});

test('rooms.join(): a password-protected room rejects a wrong or missing password with 401', async () => {
  const p = setup();
  const owner = 'usr_owner';
  const room = await p.rooms.create({ ownerId: owner, name: 'Locked', password: 'correct-horse' });

  await assert.rejects(
    () => p.rooms.join(room.id, 'usr_guest', 'wrong-password'),
    (err) => { assert.equal(err.status, 401); return true; }
  );
  await assert.rejects(
    () => p.rooms.join(room.id, 'usr_guest2'),
    (err) => { assert.equal(err.status, 401); return true; }
  );
});

test('rooms.join(): the room owner never needs their own password', async () => {
  const p = setup();
  const owner = 'usr_owner';
  const room = await p.rooms.create({ ownerId: owner, name: 'Locked', password: 'correct-horse' });
  const membership = await p.rooms.join(room.id, owner);
  assert.equal(membership.status, 'joined');
});

test('rooms.join(): idempotent re-join and disconnected-resume do not require the password again', async () => {
  const p = setup();
  const owner = 'usr_owner';
  const room = await p.rooms.create({ ownerId: owner, name: 'Locked', password: 'correct-horse' });

  const first = await p.rooms.join(room.id, 'usr_guest', 'correct-horse');
  // Idempotent re-join, no password passed at all.
  const again = await p.rooms.join(room.id, 'usr_guest');
  assert.equal(again.id, first.id);
  assert.equal(again.status, 'joined');

  await p.rooms.disconnect(room.id, 'usr_guest');
  // Resuming a disconnected membership, again no password passed.
  const resumed = await p.rooms.join(room.id, 'usr_guest');
  assert.equal(resumed.id, first.id);
  assert.equal(resumed.status, 'joined');
});

test('rooms.join(): a room without a password is completely unaffected by the password check', async () => {
  const p = setup();
  const owner = 'usr_owner';
  const room = await p.rooms.create({ ownerId: owner, name: 'Open' });
  const membership = await p.rooms.join(room.id, 'usr_guest');
  assert.equal(membership.status, 'joined');
});
