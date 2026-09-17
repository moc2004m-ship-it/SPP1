'use strict';
// Stage 17 -- Music/DJ. Service-level tests on `platform.music.*`
// (feature-platform.js), same style/precedent as
// room-moderation.stage35.test.js: real FeatureStore backed by a real
// InMemoryFeatureRecordRepository, real `platform.rooms.create()`/`join()`
// to set up membership, no mocks. `musicBus` is exercised directly too
// (it is a real, structural copy of chat-bus.js/notification-bus.js, not
// a stub) so its publish/subscribe contract is proven, not just assumed.
//
// Scope: this file covers only Stage 17 (Music/DJ) -- DJ assignment,
// queue, and playback control -- plus a regression block at the end
// confirming this stage did not touch anything else (in particular:
// Stage 33's notification catalog, which the progress report already
// documents deliberately avoiding).

const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');
const { createPlatform, FeatureStore } = require('../src/feature-platform');
const { createMusicBus } = require('../src/realtime/music-bus');
const { BANNED_WORDS } = require('../src/services/word-filter.service');

function setup({ withBus = true } = {}) {
  const store = new FeatureStore(new InMemoryFeatureRecordRepository());
  const musicBus = withBus ? createMusicBus() : undefined;
  const platform = createPlatform({ store, musicBus });
  return { platform, musicBus };
}

async function makeRoom(p, ownerId = 'usr_owner') {
  return p.rooms.create({ ownerId, name: 'Music Room' });
}

const TRACK = { title: 'Test Track', url: 'https://example.com/track.mp3', durationSec: 180 };

// ---------------------------------------------------------------------
// DJ ASSIGNMENT -- authorization
// ---------------------------------------------------------------------

test('music.grantDJ(): the room owner can grant DJ to a real member', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  const record = await p.music.grantDJ('usr_owner', room.id, 'usr_member');
  assert.equal(record.type, 'dj');
  assert.equal(record.roomId, room.id);
  assert.equal(record.userId, 'usr_member');
  assert.equal(record.status, 'active');
});

test('music.grantDJ(): a non-owner member is rejected with 403', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  await p.rooms.join(room.id, 'usr_other');
  await assert.rejects(
    () => p.music.grantDJ('usr_member', room.id, 'usr_other'),
    (e) => e.status === 403,
  );
});

test('music.grantDJ(): an unrelated/unauthorized account is rejected with 403', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  await assert.rejects(
    () => p.music.grantDJ('usr_stranger', room.id, 'usr_member'),
    (e) => e.status === 403,
  );
});

test('music.grantDJ(): unauthenticated (missing actorId) is rejected', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await assert.rejects(() => p.music.grantDJ('', room.id, 'usr_member'));
  await assert.rejects(() => p.music.grantDJ(null, room.id, 'usr_member'));
});

test('music.grantDJ(): granting a non-member is rejected with 403', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await assert.rejects(
    () => p.music.grantDJ('usr_owner', room.id, 'usr_not_a_member'),
    (e) => e.status === 403,
  );
});

test('music.grantDJ(): the room owner cannot be assigned as DJ (already always in control)', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await assert.rejects(
    () => p.music.grantDJ('usr_owner', room.id, 'usr_owner'),
    (e) => e.status === 400,
  );
});

test('music.grantDJ(): granting twice while already active is idempotent (same record, no duplicate)', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  const first = await p.music.grantDJ('usr_owner', room.id, 'usr_member');
  const second = await p.music.grantDJ('usr_owner', room.id, 'usr_member');
  assert.equal(first.id, second.id);
});

test('music.grantDJ(): the owner of a different room cannot grant DJ in this room (cross-room isolation)', async () => {
  const { platform: p } = setup();
  const roomA = await makeRoom(p, 'usr_owner_a');
  const roomB = await makeRoom(p, 'usr_owner_b');
  await p.rooms.join(roomB.id, 'usr_member');
  await assert.rejects(
    () => p.music.grantDJ('usr_owner_a', roomB.id, 'usr_member'),
    (e) => e.status === 403,
  );
});

// ---------------------------------------------------------------------
// DJ ASSIGNMENT -- revoke / list
// ---------------------------------------------------------------------

test('music.revokeDJ(): the room owner can revoke an active DJ', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  await p.music.grantDJ('usr_owner', room.id, 'usr_member');
  const revoked = await p.music.revokeDJ('usr_owner', room.id, 'usr_member');
  assert.equal(revoked.status, 'revoked');
});

test('music.revokeDJ(): revoking with nothing active is a 404', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  await assert.rejects(
    () => p.music.revokeDJ('usr_owner', room.id, 'usr_member'),
    (e) => e.status === 404,
  );
});

test('music.revokeDJ(): a non-owner cannot revoke another member\'s DJ status', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  await p.rooms.join(room.id, 'usr_other');
  await p.music.grantDJ('usr_owner', room.id, 'usr_member');
  await assert.rejects(
    () => p.music.revokeDJ('usr_other', room.id, 'usr_member'),
    (e) => e.status === 403,
  );
});

test('music.revokeDJ(): a revoked DJ loses playback control (403 on next action)', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  await p.music.grantDJ('usr_owner', room.id, 'usr_member');
  await p.music.queueAdd('usr_member', room.id, TRACK);
  await p.music.revokeDJ('usr_owner', room.id, 'usr_member');
  await assert.rejects(
    () => p.music.play('usr_member', room.id),
    (e) => e.status === 403,
  );
});

test('music.grantDJ(): re-granting after a revoke creates a fresh, independent active record', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  const first = await p.music.grantDJ('usr_owner', room.id, 'usr_member');
  await p.music.revokeDJ('usr_owner', room.id, 'usr_member');
  const second = await p.music.grantDJ('usr_owner', room.id, 'usr_member');
  assert.notEqual(first.id, second.id);
  assert.equal(second.status, 'active');
});

test('music.listDJs(): lists only currently-active DJs, visible to any real member', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  await p.rooms.join(room.id, 'usr_other');
  await p.music.grantDJ('usr_owner', room.id, 'usr_member');
  await p.music.grantDJ('usr_owner', room.id, 'usr_other');
  await p.music.revokeDJ('usr_owner', room.id, 'usr_other');
  const djs = await p.music.listDJs('usr_other', room.id);
  assert.equal(djs.length, 1);
  assert.equal(djs[0].userId, 'usr_member');
});

test('music.listDJs(): rejected for a non-member', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await assert.rejects(
    () => p.music.listDJs('usr_stranger', room.id),
    (e) => e.status === 403,
  );
});

// ---------------------------------------------------------------------
// OWNER IS ALWAYS DJ (implicit, no record needed)
// ---------------------------------------------------------------------

test('the room owner can control playback without ever being granted DJ', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.music.queueAdd('usr_owner', room.id, TRACK);
  const state = await p.music.play('usr_owner', room.id);
  assert.equal(state.status, 'playing');
});

// ---------------------------------------------------------------------
// QUEUE -- add
// ---------------------------------------------------------------------

test('music.queueAdd(): any real member can queue a track', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  const track = await p.music.queueAdd('usr_member', room.id, TRACK);
  assert.equal(track.type, 'track');
  assert.equal(track.status, 'queued');
  assert.equal(track.title, TRACK.title);
  assert.equal(track.url, TRACK.url);
  assert.equal(track.durationSec, 180);
  assert.equal(track.position, 0);
  assert.equal(track.requestedBy, 'usr_member');
});

test('music.queueAdd(): rejected for a non-member with 403', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await assert.rejects(
    () => p.music.queueAdd('usr_stranger', room.id, TRACK),
    (e) => e.status === 403,
  );
});

test('music.queueAdd(): a missing/empty title is rejected with 400', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await assert.rejects(
    () => p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: '' }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    () => p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: undefined }),
    (e) => e.status === 400,
  );
});

test('music.queueAdd(): a title over the max length is rejected with 400', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await assert.rejects(
    () => p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'x'.repeat(161) }),
    (e) => e.status === 400,
  );
});

test('music.queueAdd(): a title containing a banned word is rejected (word-filter reused, not reimplemented)', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await assert.rejects(
    () => p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: `song ${BANNED_WORDS[0]} remix` }),
    (e) => e.status === 400,
  );
});

test('music.queueAdd(): a non-http(s) url is rejected with 400', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await assert.rejects(
    () => p.music.queueAdd('usr_owner', room.id, { ...TRACK, url: 'ftp://example.com/x.mp3' }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    () => p.music.queueAdd('usr_owner', room.id, { ...TRACK, url: '' }),
    (e) => e.status === 400,
  );
});

test('music.queueAdd(): durationSec is optional -- omitted stays null', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  const track = await p.music.queueAdd('usr_owner', room.id, { title: TRACK.title, url: TRACK.url });
  assert.equal(track.durationSec, null);
});

test('music.queueAdd(): a non-integer/out-of-range durationSec is rejected with 400', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await assert.rejects(
    () => p.music.queueAdd('usr_owner', room.id, { ...TRACK, durationSec: 0 }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    () => p.music.queueAdd('usr_owner', room.id, { ...TRACK, durationSec: 1.5 }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    () => p.music.queueAdd('usr_owner', room.id, { ...TRACK, durationSec: 60 * 60 + 1 }),
    (e) => e.status === 400,
  );
});

test('music.queueAdd(): successive adds append at the end of the queue in order', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  const a = await p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'A' });
  const b = await p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'B' });
  const c = await p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'C' });
  assert.deepEqual([a.position, b.position, c.position], [0, 1, 2]);
});

// ---------------------------------------------------------------------
// QUEUE -- remove
// ---------------------------------------------------------------------

test('music.queueRemove(): the account that requested a track can remove their own', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  const track = await p.music.queueAdd('usr_member', room.id, TRACK);
  const removed = await p.music.queueRemove('usr_member', room.id, track.id);
  assert.equal(removed.status, 'removed');
});

test('music.queueRemove(): the DJ can remove someone else\'s queued track', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  await p.rooms.join(room.id, 'usr_dj');
  await p.music.grantDJ('usr_owner', room.id, 'usr_dj');
  const track = await p.music.queueAdd('usr_member', room.id, TRACK);
  const removed = await p.music.queueRemove('usr_dj', room.id, track.id);
  assert.equal(removed.status, 'removed');
});

test('music.queueRemove(): the room owner can remove anyone\'s queued track', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  const track = await p.music.queueAdd('usr_member', room.id, TRACK);
  const removed = await p.music.queueRemove('usr_owner', room.id, track.id);
  assert.equal(removed.status, 'removed');
});

test('music.queueRemove(): a plain member cannot remove someone else\'s track (403)', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  await p.rooms.join(room.id, 'usr_other');
  const track = await p.music.queueAdd('usr_member', room.id, TRACK);
  await assert.rejects(
    () => p.music.queueRemove('usr_other', room.id, track.id),
    (e) => e.status === 403,
  );
});

test('music.queueRemove(): removing an unknown track is a 404', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await assert.rejects(
    () => p.music.queueRemove('usr_owner', room.id, 'trk_does_not_exist'),
    (e) => e.status === 404,
  );
});

test('music.queueRemove(): removing an already-removed track is a 409 (not double-removable)', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  const track = await p.music.queueAdd('usr_owner', room.id, TRACK);
  await p.music.queueRemove('usr_owner', room.id, track.id);
  await assert.rejects(
    () => p.music.queueRemove('usr_owner', room.id, track.id),
    (e) => e.status === 409,
  );
});

test('music.queueRemove(): a track from a different room is not found (cross-room isolation)', async () => {
  const { platform: p } = setup();
  const roomA = await makeRoom(p, 'usr_owner_a');
  const roomB = await makeRoom(p, 'usr_owner_b');
  const track = await p.music.queueAdd('usr_owner_a', roomA.id, TRACK);
  await assert.rejects(
    () => p.music.queueRemove('usr_owner_b', roomB.id, track.id),
    (e) => e.status === 404,
  );
});

test('music.queueRemove(): re-indexes remaining tracks to a contiguous 0..n-1 order', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  const a = await p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'A' });
  const b = await p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'B' });
  const c = await p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'C' });
  await p.music.queueRemove('usr_owner', room.id, a.id);
  const queue = await p.music.queueList('usr_owner', room.id);
  const byTitle = Object.fromEntries(queue.map(t => [t.title, t.position]));
  assert.equal(byTitle.B, 0);
  assert.equal(byTitle.C, 1);
});

test('music.queueRemove(): a currently-playing track cannot be removed this way (409)', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  const track = await p.music.queueAdd('usr_owner', room.id, TRACK);
  await p.music.play('usr_owner', room.id);
  await assert.rejects(
    () => p.music.queueRemove('usr_owner', room.id, track.id),
    (e) => e.status === 409,
  );
});

// ---------------------------------------------------------------------
// QUEUE -- reorder / list
// ---------------------------------------------------------------------

test('music.queueReorder(): the DJ can move a queued track to a new position', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  const a = await p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'A' });
  await p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'B' });
  await p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'C' });
  const reordered = await p.music.queueReorder('usr_owner', room.id, a.id, 2);
  const byTitle = Object.fromEntries(reordered.map(t => [t.title, t.position]));
  assert.equal(byTitle.A, 2);
  assert.equal(byTitle.B, 0);
  assert.equal(byTitle.C, 1);
});

test('music.queueReorder(): a plain member (not DJ) is rejected with 403', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  const track = await p.music.queueAdd('usr_member', room.id, TRACK);
  await assert.rejects(
    () => p.music.queueReorder('usr_member', room.id, track.id, 0),
    (e) => e.status === 403,
  );
});

test('music.queueReorder(): an out-of-range position is rejected with 400', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  const track = await p.music.queueAdd('usr_owner', room.id, TRACK);
  await assert.rejects(
    () => p.music.queueReorder('usr_owner', room.id, track.id, 5),
    (e) => e.status === 400,
  );
  await assert.rejects(
    () => p.music.queueReorder('usr_owner', room.id, track.id, -1),
    (e) => e.status === 400,
  );
});

test('music.queueReorder(): reordering a non-queued (e.g. playing) track is rejected with 409', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  const track = await p.music.queueAdd('usr_owner', room.id, TRACK);
  await p.music.play('usr_owner', room.id);
  await assert.rejects(
    () => p.music.queueReorder('usr_owner', room.id, track.id, 0),
    (e) => e.status === 409,
  );
});

test('music.queueList(): any real member can view the queue, sorted by position', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  await p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'A' });
  await p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'B' });
  const queue = await p.music.queueList('usr_member', room.id);
  assert.deepEqual(queue.map(t => t.title), ['A', 'B']);
});

test('music.queueList(): rejected for a non-member with 403', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await assert.rejects(
    () => p.music.queueList('usr_stranger', room.id),
    (e) => e.status === 403,
  );
});

// ---------------------------------------------------------------------
// PLAYBACK -- play / pause / next / volume
// ---------------------------------------------------------------------

test('music.play(): DJ-only -- a plain member is rejected with 403', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  await p.music.queueAdd('usr_owner', room.id, TRACK);
  await assert.rejects(
    () => p.music.play('usr_member', room.id),
    (e) => e.status === 403,
  );
});

test('music.play(): with an empty queue and no track id is a 409', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await assert.rejects(
    () => p.music.play('usr_owner', room.id),
    (e) => e.status === 409,
  );
});

test('music.play(): with no track id auto-picks the lowest-position queued track', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  const a = await p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'A' });
  await p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'B' });
  const state = await p.music.play('usr_owner', room.id);
  assert.equal(state.currentTrackId, a.id);
  assert.equal(state.status, 'playing');
});

test('music.play(): with an explicit trackId plays that specific track', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'A' });
  const b = await p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'B' });
  const state = await p.music.play('usr_owner', room.id, b.id);
  assert.equal(state.currentTrackId, b.id);
});

test('music.play(): an unknown trackId is a 404', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await assert.rejects(
    () => p.music.play('usr_owner', room.id, 'trk_missing'),
    (e) => e.status === 404,
  );
});

test('music.play(): a non-queued trackId (e.g. already played) is a 409', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  const a = await p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'A' });
  await p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'B' });
  await p.music.play('usr_owner', room.id, a.id);
  await p.music.next('usr_owner', room.id); // a -> played
  await assert.rejects(
    () => p.music.play('usr_owner', room.id, a.id),
    (e) => e.status === 409,
  );
});

test('music.play(): switching to a different track marks the previous one played (never left dangling)', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  const a = await p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'A' });
  const b = await p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'B' });
  await p.music.play('usr_owner', room.id, a.id);
  await p.music.play('usr_owner', room.id, b.id);
  const queue = await p.music.queueList('usr_owner', room.id);
  // 'a' is no longer queued or playing -- it moved to 'played'.
  assert.ok(!queue.some(t => t.id === a.id));
});

test('music.pause(): DJ-only -- pauses the currently playing track in place', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.music.queueAdd('usr_owner', room.id, TRACK);
  await p.music.play('usr_owner', room.id);
  const paused = await p.music.pause('usr_owner', room.id);
  assert.equal(paused.status, 'paused');
});

test('music.pause(): nothing playing is a 409', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await assert.rejects(
    () => p.music.pause('usr_owner', room.id),
    (e) => e.status === 409,
  );
});

test('music.pause(): a plain member is rejected with 403', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  await p.music.queueAdd('usr_owner', room.id, TRACK);
  await p.music.play('usr_owner', room.id);
  await assert.rejects(
    () => p.music.pause('usr_member', room.id),
    (e) => e.status === 403,
  );
});

test('music.play(): with no trackId after a pause resumes the same track', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  const a = await p.music.queueAdd('usr_owner', room.id, TRACK);
  await p.music.play('usr_owner', room.id);
  await p.music.pause('usr_owner', room.id);
  const resumed = await p.music.play('usr_owner', room.id);
  assert.equal(resumed.status, 'playing');
  assert.equal(resumed.currentTrackId, a.id);
});

test('music.next(): DJ-only -- auto-advances to the next queued track', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  const a = await p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'A' });
  const b = await p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'B' });
  await p.music.play('usr_owner', room.id, a.id);
  const state = await p.music.next('usr_owner', room.id);
  assert.equal(state.currentTrackId, b.id);
  assert.equal(state.status, 'playing');
});

test('music.next(): with nothing left in the queue stops the player', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  const a = await p.music.queueAdd('usr_owner', room.id, TRACK);
  await p.music.play('usr_owner', room.id, a.id);
  const state = await p.music.next('usr_owner', room.id);
  assert.equal(state.status, 'stopped');
  assert.equal(state.currentTrackId, null);
});

test('music.next(): a plain member is rejected with 403', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  await p.music.queueAdd('usr_owner', room.id, TRACK);
  await p.music.play('usr_owner', room.id);
  await assert.rejects(
    () => p.music.next('usr_member', room.id),
    (e) => e.status === 403,
  );
});

test('music.setVolume(): DJ-only -- sets the room-wide volume', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  const state = await p.music.setVolume('usr_owner', room.id, 42);
  assert.equal(state.volume, 42);
});

test('music.setVolume(): out-of-range/non-integer volume is rejected with 400', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await assert.rejects(
    () => p.music.setVolume('usr_owner', room.id, 101),
    (e) => e.status === 400,
  );
  await assert.rejects(
    () => p.music.setVolume('usr_owner', room.id, -1),
    (e) => e.status === 400,
  );
  await assert.rejects(
    () => p.music.setVolume('usr_owner', room.id, 50.5),
    (e) => e.status === 400,
  );
});

test('music.setVolume(): a plain member is rejected with 403', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  await assert.rejects(
    () => p.music.setVolume('usr_member', room.id, 50),
    (e) => e.status === 403,
  );
});

test('a granted (non-owner) DJ has full playback control', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_dj');
  await p.music.grantDJ('usr_owner', room.id, 'usr_dj');
  await p.music.queueAdd('usr_owner', room.id, TRACK);
  const playing = await p.music.play('usr_dj', room.id);
  assert.equal(playing.status, 'playing');
  const paused = await p.music.pause('usr_dj', room.id);
  assert.equal(paused.status, 'paused');
  const vol = await p.music.setVolume('usr_dj', room.id, 33);
  assert.equal(vol.volume, 33);
});

// ---------------------------------------------------------------------
// STATE (combined player + queue)
// ---------------------------------------------------------------------

test('music.getState(): returns player state merged with the current queue, for any real member', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  await p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'A' });
  await p.music.queueAdd('usr_owner', room.id, { ...TRACK, title: 'B' });
  await p.music.setVolume('usr_owner', room.id, 55);
  const state = await p.music.getState('usr_member', room.id);
  assert.equal(state.volume, 55);
  assert.equal(state.status, 'stopped');
  assert.equal(state.queue.length, 2);
});

test('music.getState(): lazily creates a default player state (volume 70, stopped) on first real use', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  const state = await p.music.getState('usr_owner', room.id);
  assert.equal(state.volume, 70);
  assert.equal(state.status, 'stopped');
  assert.equal(state.currentTrackId, null);
  assert.deepEqual(state.queue, []);
});

test('music.getState(): rejected for a non-member with 403', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  await assert.rejects(
    () => p.music.getState('usr_stranger', room.id),
    (e) => e.status === 403,
  );
});

// ---------------------------------------------------------------------
// CROSS-ROOM ISOLATION
// ---------------------------------------------------------------------

test('DJ status in one room does not grant playback control in another room', async () => {
  const { platform: p } = setup();
  const roomA = await makeRoom(p, 'usr_owner_a');
  const roomB = await makeRoom(p, 'usr_owner_b');
  await p.rooms.join(roomA.id, 'usr_dj');
  await p.rooms.join(roomB.id, 'usr_dj');
  await p.music.grantDJ('usr_owner_a', roomA.id, 'usr_dj');
  await p.music.queueAdd('usr_owner_b', roomB.id, TRACK);
  await assert.rejects(
    () => p.music.play('usr_dj', roomB.id),
    (e) => e.status === 403,
  );
});

test('the queue and player state of one room are completely independent of another', async () => {
  const { platform: p } = setup();
  const roomA = await makeRoom(p, 'usr_owner_a');
  const roomB = await makeRoom(p, 'usr_owner_b');
  await p.music.queueAdd('usr_owner_a', roomA.id, { ...TRACK, title: 'Only in A' });
  const stateB = await p.music.getState('usr_owner_b', roomB.id);
  assert.deepEqual(stateB.queue, []);
});

// ---------------------------------------------------------------------
// REAL-TIME (musicBus)
// ---------------------------------------------------------------------

test('musicBus: every real state change is published to the room\'s own channel', async () => {
  const { platform: p, musicBus } = setup();
  const room = await makeRoom(p);
  const events = [];
  musicBus.subscribe(room.id, (event) => events.push(event));
  await p.music.queueAdd('usr_owner', room.id, TRACK);
  await p.music.play('usr_owner', room.id);
  await p.music.pause('usr_owner', room.id);
  await p.music.setVolume('usr_owner', room.id, 40);
  const types = events.map(e => e.type);
  assert.deepEqual(types, ['queue-added', 'play', 'pause', 'volume']);
});

test('musicBus: a subscriber to a different room never receives another room\'s events', async () => {
  const { platform: p, musicBus } = setup();
  const roomA = await makeRoom(p, 'usr_owner_a');
  const roomB = await makeRoom(p, 'usr_owner_b');
  const eventsB = [];
  musicBus.subscribe(roomB.id, (event) => eventsB.push(event));
  await p.music.queueAdd('usr_owner_a', roomA.id, TRACK);
  await p.music.play('usr_owner_a', roomA.id);
  assert.equal(eventsB.length, 0);
});

test('musicBus: DJ grant/revoke are published as real-time events', async () => {
  const { platform: p, musicBus } = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  const events = [];
  musicBus.subscribe(room.id, (event) => events.push(event));
  await p.music.grantDJ('usr_owner', room.id, 'usr_member');
  await p.music.revokeDJ('usr_owner', room.id, 'usr_member');
  assert.deepEqual(events.map(e => e.type), ['dj-granted', 'dj-revoked']);
});

test('every music.* method works correctly with no musicBus supplied at all (optional dependency)', async () => {
  const { platform: p } = setup({ withBus: false });
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  await p.music.grantDJ('usr_owner', room.id, 'usr_member');
  await p.music.queueAdd('usr_member', room.id, TRACK);
  const state = await p.music.play('usr_owner', room.id);
  assert.equal(state.status, 'playing');
});

// ---------------------------------------------------------------------
// REGRESSION -- Stage 17 did not touch anything else
// ---------------------------------------------------------------------

test('regression: notification-catalog is unaffected -- DJ grant/revoke never calls notificationService', async () => {
  const store = new FeatureStore(new InMemoryFeatureRecordRepository());
  let notifyCalls = 0;
  const notificationService = { notify: async () => { notifyCalls += 1; } };
  const p = createPlatform({ store, notificationService });
  const room = await p.rooms.create({ ownerId: 'usr_owner', name: 'Room' });
  await p.rooms.join(room.id, 'usr_member');
  await p.music.grantDJ('usr_owner', room.id, 'usr_member');
  await p.music.revokeDJ('usr_owner', room.id, 'usr_member');
  assert.equal(notifyCalls, 0);
});

test('regression: room creation/join (Stage 12/13) is unaffected by the music domain', async () => {
  const { platform: p } = setup();
  const room = await makeRoom(p);
  const membership = await p.rooms.join(room.id, 'usr_member');
  assert.equal(membership.status, 'joined');
});
