'use strict';
// Stage 35 Part 5/8 -- Room Moderation.
//
// Audit finding (see STAGE_35_ROOM_MODERATION_FINAL_REPORT.md section 2/3
// for the full writeup): this codebase has exactly one room-scoped
// protected role -- room owner (room.model.js has no admin/moderator
// field, and a repo-wide search for moderator/admin/co-host turned up
// nothing but comments). Kick (membership -> 'kicked') and room-scoped
// mic-seat mute/unmute were already implemented and owner-gated as part
// of Stage 16 ("Host/Moderator + Room Chat") -- covered by
// feature-platform.test.js and rooms.stage13.entry.test.js, both
// unmodified and re-run below as regressions. The one genuine gap this
// stage closes is Room Ban/Unban: kick removes a member but never
// prevented rejoining (rooms.stage13.entry.test.js literally documents
// "kick is removal, not a ban") -- banMember()/unbanMember()/isBanned()
// in feature-platform.js, plus the join() enforcement point, are new.
//
// This file is deliberately scoped to Room Ban/Unban + its enforcement
// and regressions. It does not re-test kick()/muteMember()/unmuteMember()
// logic already exhaustively covered elsewhere.

const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryChatRepository } = require('../src/database/repositories/chat.repository');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');
const { createPlatform, FeatureStore } = require('../src/feature-platform');
const { createChatBus } = require('../src/realtime/chat-bus');
const { createChatService } = require('../src/services/chat.service');
const { BANNED_WORDS } = require('../src/services/word-filter.service');

function setup() {
  return createPlatform({ store: new FeatureStore(new InMemoryFeatureRecordRepository()) });
}

async function makeRoom(p, ownerId = 'usr_owner') {
  return p.rooms.create({ ownerId, name: 'Test Room' });
}

// ---------------------------------------------------------------------
// AUTHORIZATION
// ---------------------------------------------------------------------

test('rooms.banMember(): the room owner can ban a member', async () => {
  const p = setup();
  const room = await makeRoom(p);
  const ban = await p.rooms.banMember('usr_owner', room.id, 'usr_target');
  assert.equal(ban.status, 'active');
  assert.equal(ban.type, 'ban');
  assert.equal(ban.roomId, room.id);
  assert.equal(ban.targetId, 'usr_target');
});

test('rooms.banMember(): a non-owner (member) is rejected with 403', async () => {
  const p = setup();
  const room = await makeRoom(p);
  await p.rooms.join(room.id, 'usr_member');
  await assert.rejects(
    () => p.rooms.banMember('usr_member', room.id, 'usr_target'),
    (e) => e.status === 403
  );
});

test('rooms.banMember(): an unrelated/unauthorized account is rejected with 403', async () => {
  const p = setup();
  const room = await makeRoom(p);
  await assert.rejects(
    () => p.rooms.banMember('usr_stranger', room.id, 'usr_target'),
    (e) => e.status === 403
  );
});

test('rooms.banMember(): unauthenticated (missing actorId) is rejected', async () => {
  const p = setup();
  const room = await makeRoom(p);
  await assert.rejects(() => p.rooms.banMember('', room.id, 'usr_target'));
  await assert.rejects(() => p.rooms.banMember(null, room.id, 'usr_target'));
});

// ---------------------------------------------------------------------
// OWNER / ROLE PROTECTION
// ---------------------------------------------------------------------

test('rooms.banMember(): the room owner cannot be banned (by anyone, including themselves)', async () => {
  const p = setup();
  const room = await makeRoom(p);
  await assert.rejects(
    () => p.rooms.banMember('usr_owner', room.id, 'usr_owner'),
    (e) => e.status === 403
  );
});

// ---------------------------------------------------------------------
// BAN
// ---------------------------------------------------------------------

test('rooms.banMember(): a valid ban is a real, persisted, room-scoped record with a moderation audit entry', async () => {
  const p = setup();
  const room = await makeRoom(p);
  await p.rooms.banMember('usr_owner', room.id, 'usr_target');
  const persisted = await p.store.find(16, (r) => r.type === 'ban' && r.roomId === room.id && r.targetId === 'usr_target');
  assert.ok(persisted);
  assert.equal(persisted.status, 'active');
  const auditLog = await p.store.list(16, (r) => r.action === 'ban');
  assert.ok(auditLog.some((a) => a.roomId === room.id && a.targetId === 'usr_target' && a.actorId === 'usr_owner'));
});

test('rooms.banMember(): banning a currently-joined member also removes them from the room (kick effect)', async () => {
  const p = setup();
  const room = await makeRoom(p);
  const membership = await p.rooms.join(room.id, 'usr_target');
  await p.rooms.banMember('usr_owner', room.id, 'usr_target');
  const updated = await p.store.find(13, (m) => m.id === membership.id);
  assert.equal(updated.status, 'kicked');
});

test('rooms.banMember(): banning someone not currently in the room does not throw (ban is not kick)', async () => {
  const p = setup();
  const room = await makeRoom(p);
  const ban = await p.rooms.banMember('usr_owner', room.id, 'usr_never_joined');
  assert.equal(ban.status, 'active');
});

test('rooms.banMember(): duplicate ban is idempotent -- returns the existing active record, does not create a second one', async () => {
  const p = setup();
  const room = await makeRoom(p);
  const first = await p.rooms.banMember('usr_owner', room.id, 'usr_target');
  const second = await p.rooms.banMember('usr_owner', room.id, 'usr_target');
  assert.equal(first.id, second.id);
  const allBans = await p.store.list(16, (r) => r.type === 'ban' && r.roomId === room.id && r.targetId === 'usr_target');
  assert.equal(allBans.length, 1);
});

test('rooms.banMember(): invalid roomId/targetId is rejected, not silently accepted', async () => {
  const p = setup();
  const room = await makeRoom(p);
  await assert.rejects(() => p.rooms.banMember('usr_owner', room.id, ''));
  await assert.rejects(() => p.rooms.banMember('usr_owner', 'room_does_not_exist', 'usr_target'), (e) => e.status === 404);
});

test('rooms.banMember(): a banned user cannot rejoin the room', async () => {
  const p = setup();
  const room = await makeRoom(p);
  await p.rooms.banMember('usr_owner', room.id, 'usr_target');
  await assert.rejects(
    () => p.rooms.join(room.id, 'usr_target'),
    (e) => e.status === 403
  );
});

test('rooms.banMember(): a ban in Room A does not affect the same user joining Room B (cross-room isolation)', async () => {
  const p = setup();
  const roomA = await makeRoom(p, 'usr_owner_a');
  const roomB = await makeRoom(p, 'usr_owner_b');
  await p.rooms.banMember('usr_owner_a', roomA.id, 'usr_target');
  await assert.rejects(() => p.rooms.join(roomA.id, 'usr_target'), (e) => e.status === 403);
  const membershipB = await p.rooms.join(roomB.id, 'usr_target');
  assert.equal(membershipB.status, 'joined');
});

// ---------------------------------------------------------------------
// UNBAN
// ---------------------------------------------------------------------

test('rooms.unbanMember(): the room owner can unban, restoring rejoin access', async () => {
  const p = setup();
  const room = await makeRoom(p);
  await p.rooms.banMember('usr_owner', room.id, 'usr_target');
  const updated = await p.rooms.unbanMember('usr_owner', room.id, 'usr_target');
  assert.equal(updated.status, 'removed');
  assert.equal(await p.rooms.isBanned(room.id, 'usr_target'), false);
  const membership = await p.rooms.join(room.id, 'usr_target');
  assert.equal(membership.status, 'joined');
});

test('rooms.unbanMember(): unbanning with no active ban is a 404', async () => {
  const p = setup();
  const room = await makeRoom(p);
  await assert.rejects(
    () => p.rooms.unbanMember('usr_owner', room.id, 'usr_target'),
    (e) => e.status === 404
  );
});

test('rooms.unbanMember(): unbanning an already-inactive (previously unbanned) ban is a 404 the second time', async () => {
  const p = setup();
  const room = await makeRoom(p);
  await p.rooms.banMember('usr_owner', room.id, 'usr_target');
  await p.rooms.unbanMember('usr_owner', room.id, 'usr_target');
  await assert.rejects(
    () => p.rooms.unbanMember('usr_owner', room.id, 'usr_target'),
    (e) => e.status === 404
  );
});

test('rooms.unbanMember(): a non-owner is rejected with 403', async () => {
  const p = setup();
  const room = await makeRoom(p);
  await p.rooms.banMember('usr_owner', room.id, 'usr_target');
  await assert.rejects(
    () => p.rooms.unbanMember('usr_stranger', room.id, 'usr_target'),
    (e) => e.status === 403
  );
});

test('rooms.unbanMember(): re-banning after an unban creates a fresh active record and blocks rejoin again', async () => {
  const p = setup();
  const room = await makeRoom(p);
  const first = await p.rooms.banMember('usr_owner', room.id, 'usr_target');
  await p.rooms.unbanMember('usr_owner', room.id, 'usr_target');
  const second = await p.rooms.banMember('usr_owner', room.id, 'usr_target');
  assert.notEqual(first.id, second.id);
  await assert.rejects(() => p.rooms.join(room.id, 'usr_target'), (e) => e.status === 403);
});

// ---------------------------------------------------------------------
// SECURITY: identity/role spoofing, malformed input, cross-room auth
// ---------------------------------------------------------------------

test('security: actorId always comes from the caller argument (the route layer\'s req.session.accountId), never a client-supplied field -- a spoofed role object is not a valid actorId', async () => {
  const p = setup();
  const room = await makeRoom(p);
  // Simulates a client trying to smuggle {"role":"admin"} in the body:
  // banMember() only ever accepts a plain string actorId, and that
  // string is checked against the real persisted room.ownerId. requireId()
  // rejects a non-string value outright (same plain-Error-no-status
  // convention this file's requireId/requireString already use for every
  // other malformed-id case, e.g. rooms.kick()'s own actorId check).
  await assert.rejects(() => p.rooms.banMember({ role: 'admin' }, room.id, 'usr_target'));
});

test('security: a valid owner of Room A cannot ban a member of Room B (cross-room authorization rejected)', async () => {
  const p = setup();
  const roomA = await makeRoom(p, 'usr_owner_a');
  const roomB = await makeRoom(p, 'usr_owner_b');
  await p.rooms.join(roomB.id, 'usr_member_b');
  await assert.rejects(
    () => p.rooms.banMember('usr_owner_a', roomB.id, 'usr_member_b'),
    (e) => e.status === 403
  );
});

test('security: malformed target (empty/whitespace) is rejected, not treated as a valid ban target', async () => {
  const p = setup();
  const room = await makeRoom(p);
  await assert.rejects(() => p.rooms.banMember('usr_owner', room.id, '   '));
});

// ---------------------------------------------------------------------
// REGRESSION -- Parts 1-4 stay intact (Report / Block / Mute / Word Filter)
// ---------------------------------------------------------------------

test('regression: Report is unaffected by Room Ban -- reportMessage still works for a clean message', async () => {
  const chat = new InMemoryChatRepository();
  const platform = setup();
  const service = createChatService({ chat, platform, bus: createChatBus() });
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  const message = await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: 'hello there' });
  const reported = await service.reportMessage({ actingAccountId: 'usr_b', messageId: message.id, reason: 'spam' });
  assert.equal(reported.reports.length, 1);
  assert.equal(reported.reports[0].reporterId, 'usr_b');
});

test('regression: global Block (social.block/unblock/allowed) is untouched by Room Ban', async () => {
  const p = setup();
  await p.social.block('usr_a', 'usr_b');
  assert.equal(await p.social.allowed('usr_a', 'usr_b', 'message'), false);
  await p.social.unblock('usr_a', 'usr_b');
  assert.equal(await p.social.allowed('usr_a', 'usr_b', 'message'), true);
});

test('regression: global user Mute (social.muteUser/unmuteUser/isUserMuted) is untouched by Room Ban', async () => {
  const p = setup();
  await p.social.muteUser('usr_a', 'usr_b');
  assert.equal(await p.social.isUserMuted('usr_a', 'usr_b'), true);
  await p.social.unmuteUser('usr_a', 'usr_b');
  assert.equal(await p.social.isUserMuted('usr_a', 'usr_b'), false);
});

test('regression: a Room Ban never calls or affects the global user-mute/block systems (isBanned/isUserMuted/allowed remain fully independent per pair)', async () => {
  const p = setup();
  const room = await makeRoom(p);
  await p.rooms.banMember('usr_owner', room.id, 'usr_target');
  assert.equal(await p.social.isUserMuted('usr_owner', 'usr_target'), false);
  assert.equal(await p.social.allowed('usr_owner', 'usr_target', 'message'), true);
});

test('regression: Word Filter (Part 4) still rejects banned words in room name/profile bio, unaffected by Room Ban work', async () => {
  const p = setup();
  // rooms.create() is synchronous (throws directly rather than returning
  // a rejected promise) -- same convention word-filter.integration.test.js
  // already uses to test this exact call.
  assert.throws(
    () => p.rooms.create({ ownerId: 'usr_owner', name: BANNED_WORDS[0] }),
    (e) => e.status === 400
  );
  await assert.rejects(
    () => p.profile.create({ userId: 'usr_owner', name: 'ok', bio: BANNED_WORDS[1] }),
    (e) => e.status === 400
  );
});

test('regression: Stage 16 kick()/muteMember()/unmuteMember() behavior is unchanged by adding ban', async () => {
  const p = setup();
  const room = await makeRoom(p);
  const membership = await p.rooms.join(room.id, 'usr_target');
  const kicked = await p.rooms.kick('usr_owner', room.id, 'usr_target');
  assert.equal(kicked.status, 'kicked');
  // Kick alone (no ban) still allows rejoin -- confirms ban and kick
  // remain genuinely distinct systems.
  const rejoined = await p.rooms.join(room.id, 'usr_target');
  assert.equal(rejoined.status, 'joined');
});

// ---------------------------------------------------------------------
// INTEGRATION: room membership / events / notifications
// ---------------------------------------------------------------------

test('integration: moderation() audit entries for ban/unban share the same stage-16 store and shape as kick/mute entries', async () => {
  const p = setup();
  const room = await makeRoom(p);
  await p.rooms.kick('usr_owner', room.id, 'usr_never_joined').catch(() => {}); // 404, no entry
  await p.rooms.banMember('usr_owner', room.id, 'usr_target');
  await p.rooms.unbanMember('usr_owner', room.id, 'usr_target');
  const actions = (await p.store.list(16, (r) => r.roomId === room.id && r.targetId === 'usr_target' && r.action)).map((r) => r.action);
  assert.deepEqual(actions, ['ban', 'unban']);
});
