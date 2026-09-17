'use strict';
// Stage 15 -- Room Settings. Real integration tests through the actual
// createPlatform() (the same in-memory FeatureStore every other
// feature-platform.test.js/rooms.stage12.create.test.js test uses -- no
// mock of setting()/getSettings() themselves).
//
// Before this stage, rooms.setting(roomId,key,value) was a bare
// store.add(): no ownership check, no key allowlist, no reuse of the
// create-time validators, and no actual effect on the room record a
// client would ever see or read back (see feature-platform.js's Stage 15
// comment block for the full before/after). This file exercises exactly
// that gap: real ownership enforcement, real validation reuse (via the
// same room.model.js/room-catalog.js functions rooms.create() already
// depends on -- not a duplicate/parallel set of checks), the real patch
// landing on the stage-12 room record, the stage-15 audit trail still
// being written, and the read side (getSettings()).

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform } = require('../src/feature-platform');
const { verifyRoomPassword } = require('../src/security/room-password');

function setup() {
  return createPlatform({});
}

test('setting(): only the room owner may change a setting', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Owner Room' });
  await assert.rejects(
    () => p.rooms.setting('intruder', room.id, 'name', 'Hijacked'),
    /only the room owner/
  );
  // Unaffected -- the rejected attempt must not have mutated the room.
  const stillOwners = await p.rooms.getSettings('owner_1', room.id);
  assert.equal(stillOwners.name, 'Owner Room');
});

test('setting(): 404s for a room that does not exist, before checking ownership', async () => {
  const p = setup();
  await assert.rejects(
    () => p.rooms.setting('someone', 'no_such_room', 'name', 'X'),
    /room not found/
  );
});

test('setting(): rejects an unknown key', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Room' });
  await assert.rejects(
    () => p.rooms.setting('owner_1', room.id, 'ownerId', 'someone_else'),
    /key must be one of/
  );
});

test('setting(): name -- reuses requireString(), real effect on the room record', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Old Name' });
  const updated = await p.rooms.setting('owner_1', room.id, 'name', 'New Name');
  assert.equal(updated.name, 'New Name');
  const reread = await p.rooms.getSettings('owner_1', room.id);
  assert.equal(reread.name, 'New Name');
  await assert.rejects(() => p.rooms.setting('owner_1', room.id, 'name', '   '), /name is invalid/);
});

test('setting(): visibility -- reuses assertValidVisibility(), rejects a made-up value, rejects null/omitted', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Room', visibility: 'public' });
  const updated = await p.rooms.setting('owner_1', room.id, 'visibility', 'private');
  assert.equal(updated.visibility, 'private');
  await assert.rejects(() => p.rooms.setting('owner_1', room.id, 'visibility', 'hidden'), /visibility must be one of/);
  await assert.rejects(() => p.rooms.setting('owner_1', room.id, 'visibility', null), /visibility is required/);
});

test('setting(): micSeats -- reuses assertValidMicSeats() bounds (1-15)', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Room' });
  const updated = await p.rooms.setting('owner_1', room.id, 'micSeats', 12);
  assert.equal(updated.micSeats, 12);
  await assert.rejects(() => p.rooms.setting('owner_1', room.id, 'micSeats', 0), /micSeats must be an integer/);
  await assert.rejects(() => p.rooms.setting('owner_1', room.id, 'micSeats', 16), /micSeats must be an integer/);
});

test('setting(): theme/category/language/ageRule -- reuse the exact room-catalog.js resolvers, reject unknown values', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Room' });

  assert.equal((await p.rooms.setting('owner_1', room.id, 'theme', 'ocean')).theme, 'ocean');
  await assert.rejects(() => p.rooms.setting('owner_1', room.id, 'theme', 'neon'), /theme must be one of/);

  assert.equal((await p.rooms.setting('owner_1', room.id, 'category', 'sports')).category, 'sports');
  await assert.rejects(() => p.rooms.setting('owner_1', room.id, 'category', 'politics'), /category must be one of/);

  assert.equal((await p.rooms.setting('owner_1', room.id, 'language', 'fr')).language, 'fr');
  await assert.rejects(() => p.rooms.setting('owner_1', room.id, 'language', 'klingon'), /language must be one of/);

  assert.equal((await p.rooms.setting('owner_1', room.id, 'ageRule', '18+')).ageRule, '18+');
  await assert.rejects(() => p.rooms.setting('owner_1', room.id, 'ageRule', '21+'), /ageRule must be one of/);
});

test('setting(): tags -- reuses normalizeTags() (trim/dedupe/bounds), omitted clears to []', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Room', tags: ['old'] });
  const updated = await p.rooms.setting('owner_1', room.id, 'tags', ['Chill', 'chill', '  night  ']);
  assert.deepEqual(updated.tags, ['Chill', 'night']);
  await assert.rejects(
    () => p.rooms.setting('owner_1', room.id, 'tags', Array.from({ length: 9 }, (_, i) => `t${i}`)),
    /at most 8 entries/
  );
  const cleared = await p.rooms.setting('owner_1', room.id, 'tags', undefined);
  assert.deepEqual(cleared.tags, []);
});

test('setting(): cover/background -- reuse assertValidImageUrl(), null clears an existing value', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Room', cover: 'https://example.com/old.png' });
  const updated = await p.rooms.setting('owner_1', room.id, 'cover', 'https://example.com/new.png');
  assert.equal(updated.cover, 'https://example.com/new.png');
  await assert.rejects(() => p.rooms.setting('owner_1', room.id, 'background', 'not-a-url'), /must be an http\(s\) URL/);
  const cleared = await p.rooms.setting('owner_1', room.id, 'cover', null);
  assert.equal(cleared.cover, null);
});

test('setting(): announcement -- reuses assertValidAnnouncement(), null clears an existing announcement', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Room', announcement: 'welcome' });
  const updated = await p.rooms.setting('owner_1', room.id, 'announcement', 'new pinned message');
  assert.equal(updated.announcement, 'new pinned message');
  await assert.rejects(() => p.rooms.setting('owner_1', room.id, 'announcement', '   '), /announcement must be/);
  const cleared = await p.rooms.setting('owner_1', room.id, 'announcement', null);
  assert.equal(cleared.announcement, null);
});

test('setting(): password -- sets/verifies a real hash, never persists or audits the plaintext, empty clears it', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Room' });
  assert.equal(room.hasPassword, false);

  const withPassword = await p.rooms.setting('owner_1', room.id, 'password', 'sesame1');
  assert.equal(withPassword.hasPassword, true);
  assert.equal('passwordHash' in withPassword, false); // sanitizeRoomForClient() strips it from the return value

  // A non-owner joining now needs the real password (join() unchanged, but
  // now actually enforces the hash setting() just wrote).
  await assert.rejects(() => p.rooms.join(room.id, 'guest_1', 'wrong'), /correct room password/);
  const joined = await p.rooms.join(room.id, 'guest_1', 'sesame1');
  assert.equal(joined.status, 'joined');

  // The stage-15 audit trail records that a password changed, never the
  // plaintext itself.
  const auditRows = await p.store.list(15, (r) => r.roomId === room.id && r.key === 'password');
  assert.equal(auditRows.length, 1);
  assert.deepEqual(auditRows[0].value, { changed: true });
  assert.equal(JSON.stringify(auditRows[0]).includes('sesame1'), false);

  const cleared = await p.rooms.setting('owner_1', room.id, 'password', '');
  assert.equal(cleared.hasPassword, false);
  await p.rooms.join(room.id, 'guest_2'); // no password required any more
});

test('setting(): writes a real stage-15 audit record per change, attributing the acting owner', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Room' });
  await p.rooms.setting('owner_1', room.id, 'name', 'Renamed');
  await p.rooms.setting('owner_1', room.id, 'theme', 'royal');
  const rows = await p.store.list(15, (r) => r.roomId === room.id);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].actorId, 'owner_1');
  assert.equal(rows[0].key, 'name');
  assert.equal(rows[0].value, 'Renamed');
  assert.equal(rows[1].key, 'theme');
  assert.equal(rows[1].value, 'royal');
});

test('setting(): changing one field never touches unrelated fields (partial patch, not a full overwrite)', async () => {
  const p = setup();
  const room = await p.rooms.create({
    ownerId: 'owner_1', name: 'Room', theme: 'ocean', category: 'music',
    language: 'fr', micSeats: 6, tags: ['jazz'],
  });
  const updated = await p.rooms.setting('owner_1', room.id, 'category', 'gaming');
  assert.equal(updated.category, 'gaming');
  assert.equal(updated.theme, 'ocean');
  assert.equal(updated.language, 'fr');
  assert.equal(updated.micSeats, 6);
  assert.deepEqual(updated.tags, ['jazz']);
  assert.equal(updated.name, 'Room');
  assert.equal(updated.ownerId, 'owner_1');
});

test('getSettings(): returns the sanitized room (no passwordHash) to the owner, real current values', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Room', password: 'sesame1' });
  const settings = await p.rooms.getSettings('owner_1', room.id);
  assert.equal(settings.name, 'Room');
  assert.equal(settings.hasPassword, true);
  assert.equal('passwordHash' in settings, false);
});

test('getSettings(): blocked for a non-owner, 404s for an unknown room', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Room' });
  await assert.rejects(() => p.rooms.getSettings('stranger', room.id), /only the room owner/);
  await assert.rejects(() => p.rooms.getSettings('owner_1', 'no_such_room'), /room not found/);
});

test('setting()/getSettings() never mutate or leak an unrelated room', async () => {
  const p = setup();
  const roomA = await p.rooms.create({ ownerId: 'owner_a', name: 'Room A' });
  const roomB = await p.rooms.create({ ownerId: 'owner_b', name: 'Room B' });
  await p.rooms.setting('owner_a', roomA.id, 'name', 'Room A Renamed');
  const b = await p.rooms.getSettings('owner_b', roomB.id);
  assert.equal(b.name, 'Room B');
  await assert.rejects(() => p.rooms.getSettings('owner_a', roomB.id), /only the room owner/);
});
