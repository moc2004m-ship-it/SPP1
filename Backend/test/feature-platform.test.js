'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform, STAGES } = require('../src/feature-platform');
// Stage 7 completion (this session) -- real Stage 30/32/26 in-memory
// repositories, used directly (not fakes) so these tests exercise the
// exact same objects family.service.js/couple.service.js/gifts.service.js
// are built on, not a stand-in shape.
const { InMemoryFamilyRepository } = require('../src/database/repositories/family.repository');
const { InMemoryCoupleRepository } = require('../src/database/repositories/couple.repository');
const { InMemoryGiftRepository } = require('../src/database/repositories/gift.repository');

// Phase 2 -- platform.store is now backed by a real repository (in-memory
// here, Postgres-ready -- see src/database/repositories/feature-record.repository.js)
// instead of a plain in-process array, so every call that touches it is
// async. The business logic/assertions below are unchanged from before that
// migration; only `await` was added.

// Stage 33 -- a fake notificationService that just records notify() calls,
// same injection technique as couple/guard/event/family/recharge/gifts
// .service.test.js. Never touches the real notification.service.js/
// notification.repository.js -- this only proves feature-platform.js's
// social.follow/friend/accept and rooms.approveSeat/rejectSeat call
// notify() with the right recipient/type/payload, only after the real
// store mutation has already committed.
function fakeNotificationService() {
  const calls = [];
  return {
    calls,
    async notify(args) {
      calls.push(args);
      return { notification: { id: 'ntf_fake' }, push: { attempted: false, blocked: true, reason: 'fake' } };
    },
  };
}

function createPlatformWithNotifications() {
  const notificationService = fakeNotificationService();
  const p = createPlatform({ notificationService });
  return { p, notificationService };
}

test('stages 6-35 are registered without placeholder status', () => {
  assert.equal(Object.keys(STAGES).length, 30);
  assert.equal(STAGES[35], 'Moderation + Support');
});

test('core domain objects have server-generated ids and timestamps', async () => {
  const p=createPlatform();
  const room=await p.rooms.create({ownerId:'usr_1',name:'Room'});
  assert.match(room.id,/^s12_/); assert.ok(room.createdAt); assert.ok(room.updatedAt);
  // Stage 18 -- p.battles.create() used to live here as a bare store stub.
  // Battles moved off platform.store onto their own dedicated
  // repository/service (see src/services/battle.service.js and
  // test/battle.service.test.js, test/battle.repository.test.js), so this
  // id-shape assertion is now covered there instead.
});

test('wallet and gifts require traceable reference ids', async () => {
  const p=createPlatform();
  assert.throws(()=>p.wallet.ledger({userId:'usr_1',currency:'coins',amount:-10}),/referenceId/);
  const tx=await p.wallet.ledger({userId:'usr_1',currency:'coins',amount:-10,referenceId:'ref_1'});
  assert.equal(tx.referenceId,'ref_1');
  const gift=await p.gifts.send({roomId:'s12_1',senderId:'usr_1',receiverId:'usr_2',giftId:'gift_1',referenceId:'tx_1'});
  assert.equal(gift.status,'pending');
});

test('moderation reports and tickets start open', async () => {
  const p=createPlatform();
  assert.equal((await p.moderation.report({reporterId:'usr_1',targetId:'usr_2',reason:'test'})).status,'open');
  assert.equal((await p.moderation.ticket({reporterId:'usr_1',type:'account',description:'test'})).status,'open');
});

// Stage 35 Part 1/8 -- Report. The route-level identity/wiring contract
// (reporterId only from req.session.accountId, GET /api/moderation/reports
// scoped to the caller) is covered separately in
// platform.moderation.routes-contract.test.js; these are the business-rule
// tests at the platform.moderation.report() layer itself.
test('moderation.report() persists reporterId/targetId/reason/status verbatim, with a server-generated id and timestamps', async () => {
  const p=createPlatform();
  const record = await p.moderation.report({reporterId:'usr_1',targetId:'usr_2',reason:'spam'});
  assert.equal(record.reporterId,'usr_1');
  assert.equal(record.targetId,'usr_2');
  assert.equal(record.reason,'spam');
  assert.equal(record.status,'open');
  assert.match(record.id,/^s35_/);
  assert.ok(record.createdAt);
  assert.ok(record.updatedAt);
});

test('moderation.report() rejects reporting yourself', async () => {
  const p=createPlatform();
  await assert.rejects(
    () => p.moderation.report({reporterId:'usr_1',targetId:'usr_1',reason:'spam'}),
    /cannot report yourself/,
  );
});

test('moderation.report() rejects a missing/empty targetId, reporterId, or reason', async () => {
  const p=createPlatform();
  await assert.rejects(() => p.moderation.report({reporterId:'usr_1',reason:'spam'}), /targetId/);
  await assert.rejects(() => p.moderation.report({reporterId:'usr_1',targetId:'   ',reason:'spam'}), /targetId/);
  await assert.rejects(() => p.moderation.report({targetId:'usr_2',reason:'spam'}), /reporterId/);
  await assert.rejects(() => p.moderation.report({reporterId:'usr_1',targetId:'usr_2'}), /reason/);
  await assert.rejects(() => p.moderation.report({reporterId:'usr_1',targetId:'usr_2',reason:'  '}), /reason/);
});

test('moderation.report() rejects an oversized reason (>500 chars)', async () => {
  const p=createPlatform();
  await assert.rejects(
    () => p.moderation.report({reporterId:'usr_1',targetId:'usr_2',reason:'x'.repeat(501)}),
    /reason/,
  );
});

test('moderation.report() keeps two different reports on the same target from two different reporters fully separate', async () => {
  const p=createPlatform();
  const a = await p.moderation.report({reporterId:'usr_1',targetId:'usr_3',reason:'spam'});
  const b = await p.moderation.report({reporterId:'usr_2',targetId:'usr_3',reason:'harassment'});
  assert.notEqual(a.id,b.id);
  assert.equal(a.targetId,b.targetId);
  assert.notEqual(a.reporterId,b.reporterId);
});

// Phase 2 -- new: records actually persist across separate reads through
// the same store (this is the behavior that was NOT true before -- a plain
// in-process array was still process-local, but list()/find() now go
// through the repository contract that Postgres will also satisfy).
test('rooms created earlier are found again via store.list/find on the same platform', async () => {
  const p = createPlatform();
  const room = await p.rooms.create({ ownerId: 'usr_1', name: 'Persistent Room' });
  const rooms = await p.store.list(12);
  assert.ok(rooms.some((r) => r.id === room.id));
  const found = await p.store.find(12, (r) => r.id === room.id);
  assert.equal(found.name, 'Persistent Room');
});

test('two independently created platforms backed by separate stores do not see each other\'s data', async () => {
  const a = createPlatform();
  const b = createPlatform();
  await a.rooms.create({ ownerId: 'usr_1', name: 'Room A' });
  const roomsInB = await b.store.list(12);
  assert.equal(roomsInB.length, 0);
});

// Phase 6 -- store.update() is the foundation every real state transition
// (friend accept/reject, seat approve/mute, room-membership kick, referral
// redemption) is built on. These are the first tests exercising it, ahead
// of Stage 10 using it for real.

test('store.update() patches an existing record and refreshes updatedAt', async () => {
  const p = createPlatform();
  const room = await p.rooms.create({ ownerId: 'usr_1', name: 'Before' });
  const originalUpdatedAt = room.updatedAt;
  await new Promise((resolve) => setTimeout(resolve, 2));
  const updated = await p.store.update(12, room.id, { name: 'After', status: 'closed' });
  assert.equal(updated.id, room.id);
  assert.equal(updated.name, 'After');
  assert.equal(updated.status, 'closed');
  assert.notEqual(updated.updatedAt, originalUpdatedAt);
  // patch must not be able to overwrite the id
  const attempted = await p.store.update(12, room.id, { id: 'not-allowed' });
  assert.equal(attempted.id, room.id);
});

test('store.update() persists: a later list()/find() sees the patched record, not the original', async () => {
  const p = createPlatform();
  const room = await p.rooms.create({ ownerId: 'usr_1', name: 'Original' });
  await p.store.update(12, room.id, { name: 'Renamed' });
  const found = await p.store.find(12, (r) => r.id === room.id);
  assert.equal(found.name, 'Renamed');
  const all = await p.store.list(12);
  assert.equal(all.length, 1);
  assert.equal(all[0].name, 'Renamed');
});

test('store.update() throws a 404-flagged error when the record does not exist', async () => {
  const p = createPlatform();
  await assert.rejects(
    () => p.store.update(12, 'does_not_exist', { name: 'x' }),
    (err) => {
      assert.equal(err.status, 404);
      return true;
    }
  );
});

test('store.update() only affects the targeted stage, not records with the same id shape on another stage', async () => {
  const p = createPlatform();
  const room = await p.rooms.create({ ownerId: 'usr_1', name: 'Room' });
  await assert.rejects(() => p.store.update(14, room.id, { name: 'wrong stage' }));
  const stillOriginal = await p.store.find(12, (r) => r.id === room.id);
  assert.equal(stillOriginal.name, 'Room');
});

// Stage 10 -- Friends accept/reject/mute, the first real logic built on
// store.update(). usr_1 sends the request; usr_2 is the recipient and the
// only one allowed to accept/reject it.

test('social.accept(): the recipient can accept a pending friend request', async () => {
  const p = createPlatform();
  const req = await p.social.friend('usr_1', 'usr_2');
  assert.equal(req.status, 'pending');
  const accepted = await p.social.accept('usr_2', req.id);
  assert.equal(accepted.status, 'accepted');
  assert.equal((await p.store.find(10, (r) => r.id === req.id)).status, 'accepted');
});

test('social.accept(): the sender cannot accept their own request', async () => {
  const p = createPlatform();
  const req = await p.social.friend('usr_1', 'usr_2');
  await assert.rejects(
    () => p.social.accept('usr_1', req.id),
    (err) => { assert.equal(err.status, 403); return true; }
  );
});

test('social.accept(): an unrelated user cannot accept someone else\'s request', async () => {
  const p = createPlatform();
  const req = await p.social.friend('usr_1', 'usr_2');
  await assert.rejects(
    () => p.social.accept('usr_3', req.id),
    (err) => { assert.equal(err.status, 403); return true; }
  );
});

test('social.accept(): unknown request id is a 404', async () => {
  const p = createPlatform();
  await assert.rejects(
    () => p.social.accept('usr_2', 'does_not_exist'),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});

test('social.accept(): an already-accepted request cannot be accepted again', async () => {
  const p = createPlatform();
  const req = await p.social.friend('usr_1', 'usr_2');
  await p.social.accept('usr_2', req.id);
  await assert.rejects(
    () => p.social.accept('usr_2', req.id),
    (err) => { assert.equal(err.status, 409); return true; }
  );
});

test('social.accept(): a follow record (not a friend request) cannot be accepted', async () => {
  const p = createPlatform();
  const follow = await p.social.follow('usr_1', 'usr_2');
  await assert.rejects(
    () => p.social.accept('usr_2', follow.id),
    (err) => { assert.equal(err.status, 400); return true; }
  );
});

test('social.reject(): the recipient can reject a pending friend request', async () => {
  const p = createPlatform();
  const req = await p.social.friend('usr_1', 'usr_2');
  const rejected = await p.social.reject('usr_2', req.id);
  assert.equal(rejected.status, 'rejected');
});

test('social.reject(): the sender cannot reject their own request', async () => {
  const p = createPlatform();
  const req = await p.social.friend('usr_1', 'usr_2');
  await assert.rejects(
    () => p.social.reject('usr_1', req.id),
    (err) => { assert.equal(err.status, 403); return true; }
  );
});

test('social.mute()/unmute(): either participant can mute or unmute an existing relation', async () => {
  const p = createPlatform();
  const follow = await p.social.follow('usr_1', 'usr_2');
  const mutedByFollower = await p.social.mute('usr_1', follow.id);
  assert.equal(mutedByFollower.muted, true);
  const unmutedByTarget = await p.social.unmute('usr_2', follow.id);
  assert.equal(unmutedByTarget.muted, false);
});

test('social.mute(): a user who is not part of the relation cannot mute it', async () => {
  const p = createPlatform();
  const follow = await p.social.follow('usr_1', 'usr_2');
  await assert.rejects(
    () => p.social.mute('usr_3', follow.id),
    (err) => { assert.equal(err.status, 403); return true; }
  );
});

test('social.mute(): unknown relation id is a 404', async () => {
  const p = createPlatform();
  await assert.rejects(
    () => p.social.mute('usr_1', 'does_not_exist'),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});

// Stage 14 -- Mic/Seats approve/reject/mute, host-gated real state
// transitions via store.update(). usr_1 owns the room; usr_2 requests a
// seat.

test('rooms.approveSeat(): the room owner can approve a requested seat', async () => {
  const p = createPlatform();
  const room = await p.rooms.create({ ownerId: 'usr_1', name: 'Room' });
  const seat = await p.rooms.seat(room.id, 'usr_2', 3);
  assert.equal(seat.status, 'requested');
  const approved = await p.rooms.approveSeat('usr_1', seat.id);
  assert.equal(approved.status, 'approved');
});

test('rooms.approveSeat(): a non-owner cannot approve a seat', async () => {
  const p = createPlatform();
  const room = await p.rooms.create({ ownerId: 'usr_1', name: 'Room' });
  const seat = await p.rooms.seat(room.id, 'usr_2', 3);
  await assert.rejects(
    () => p.rooms.approveSeat('usr_3', seat.id),
    (err) => { assert.equal(err.status, 403); return true; }
  );
  // the requester themself also cannot self-approve
  await assert.rejects(
    () => p.rooms.approveSeat('usr_2', seat.id),
    (err) => { assert.equal(err.status, 403); return true; }
  );
});

test('rooms.approveSeat(): unknown seat id is a 404', async () => {
  const p = createPlatform();
  await assert.rejects(
    () => p.rooms.approveSeat('usr_1', 'does_not_exist'),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});

test('rooms.approveSeat(): an already-approved seat cannot be approved again', async () => {
  const p = createPlatform();
  const room = await p.rooms.create({ ownerId: 'usr_1', name: 'Room' });
  const seat = await p.rooms.seat(room.id, 'usr_2', 3);
  await p.rooms.approveSeat('usr_1', seat.id);
  await assert.rejects(
    () => p.rooms.approveSeat('usr_1', seat.id),
    (err) => { assert.equal(err.status, 409); return true; }
  );
});

test('rooms.rejectSeat(): the room owner can reject a requested seat', async () => {
  const p = createPlatform();
  const room = await p.rooms.create({ ownerId: 'usr_1', name: 'Room' });
  const seat = await p.rooms.seat(room.id, 'usr_2', 3);
  const rejected = await p.rooms.rejectSeat('usr_1', seat.id);
  assert.equal(rejected.status, 'rejected');
});

test('rooms.muteSeat()/unmuteSeat(): owner can mute/unmute an approved seat, not a merely-requested one', async () => {
  const p = createPlatform();
  const room = await p.rooms.create({ ownerId: 'usr_1', name: 'Room' });
  const seat = await p.rooms.seat(room.id, 'usr_2', 3);
  await assert.rejects(
    () => p.rooms.muteSeat('usr_1', seat.id),
    (err) => { assert.equal(err.status, 409); return true; }
  );
  await p.rooms.approveSeat('usr_1', seat.id);
  const muted = await p.rooms.muteSeat('usr_1', seat.id);
  assert.equal(muted.muted, true);
  const unmuted = await p.rooms.unmuteSeat('usr_1', seat.id);
  assert.equal(unmuted.muted, false);
});

test('rooms.muteSeat(): a non-owner cannot mute a seat', async () => {
  const p = createPlatform();
  const room = await p.rooms.create({ ownerId: 'usr_1', name: 'Room' });
  const seat = await p.rooms.seat(room.id, 'usr_2', 3);
  await p.rooms.approveSeat('usr_1', seat.id);
  await assert.rejects(
    () => p.rooms.muteSeat('usr_2', seat.id),
    (err) => { assert.equal(err.status, 403); return true; }
  );
});

// Stage 16 -- Room moderation with a real effect: kick changes stage-13
// membership, mute/unmute changes the target's stage-14 seat, and every
// action still writes a stage-16 audit entry.

test('rooms.kick(): the room owner can kick a joined member, and the membership record actually changes status', async () => {
  const p = createPlatform();
  const room = await p.rooms.create({ ownerId: 'usr_1', name: 'Room' });
  const membership = await p.rooms.join(room.id, 'usr_2');
  assert.equal(membership.status, 'joined');
  const kicked = await p.rooms.kick('usr_1', room.id, 'usr_2');
  assert.equal(kicked.status, 'kicked');
  assert.equal((await p.store.find(13, (m) => m.id === membership.id)).status, 'kicked');
  const auditLog = await p.store.list(16);
  assert.ok(auditLog.some((a) => a.roomId === room.id && a.targetId === 'usr_2' && a.action === 'kick'));
});

test('rooms.kick(): a non-owner cannot kick', async () => {
  const p = createPlatform();
  const room = await p.rooms.create({ ownerId: 'usr_1', name: 'Room' });
  await p.rooms.join(room.id, 'usr_2');
  await assert.rejects(
    () => p.rooms.kick('usr_3', room.id, 'usr_2'),
    (err) => { assert.equal(err.status, 403); return true; }
  );
});

test('rooms.kick(): kicking someone who is not currently joined is a 404', async () => {
  const p = createPlatform();
  const room = await p.rooms.create({ ownerId: 'usr_1', name: 'Room' });
  await assert.rejects(
    () => p.rooms.kick('usr_1', room.id, 'usr_2'),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});

test('rooms.muteMember()/unmuteMember(): owner action actually changes the target\'s seat record, not just a log entry', async () => {
  const p = createPlatform();
  const room = await p.rooms.create({ ownerId: 'usr_1', name: 'Room' });
  const seat = await p.rooms.seat(room.id, 'usr_2', 5);
  await p.rooms.approveSeat('usr_1', seat.id);
  const muted = await p.rooms.muteMember('usr_1', room.id, 'usr_2');
  assert.equal(muted.muted, true);
  assert.equal((await p.store.find(14, (s) => s.id === seat.id)).muted, true);
  const unmuted = await p.rooms.unmuteMember('usr_1', room.id, 'usr_2');
  assert.equal(unmuted.muted, false);
  const auditLog = await p.store.list(16);
  assert.equal(auditLog.filter((a) => a.roomId === room.id && a.targetId === 'usr_2').length, 2); // mute + unmute
});

test('rooms.muteMember(): target with no active (approved) seat is a 404', async () => {
  const p = createPlatform();
  const room = await p.rooms.create({ ownerId: 'usr_1', name: 'Room' });
  await p.rooms.seat(room.id, 'usr_2', 5); // still 'requested', never approved
  await assert.rejects(
    () => p.rooms.muteMember('usr_1', room.id, 'usr_2'),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});

// Stage 23 -- Referral (feature-record half only: code generation/lookup.
// The wallet-crediting redemption itself is tested in
// test/referral.service.test.js against the real service).

test('referral.myCode(): generates a code on first call, and returns the same one on repeat calls', async () => {
  const p = createPlatform();
  const first = await p.referral.myCode('usr_1');
  assert.ok(first.code);
  const second = await p.referral.myCode('usr_1');
  assert.equal(second.id, first.id);
  assert.equal(second.code, first.code);
});

test('referral.myCode(): two different users get two different codes', async () => {
  const p = createPlatform();
  const a = await p.referral.myCode('usr_1');
  const b = await p.referral.myCode('usr_2');
  assert.notEqual(a.code, b.code);
});

test('referral.findByCode(): finds the owner\'s code record, or null for an unknown code', async () => {
  const p = createPlatform();
  const mine = await p.referral.myCode('usr_1');
  const found = await p.referral.findByCode(mine.code);
  assert.equal(found.ownerId, 'usr_1');
  assert.equal(await p.referral.findByCode('NOPE0000'), null);
});

test('referral.hasRedeemed(): false until a redemption record exists for that user', async () => {
  const p = createPlatform();
  assert.equal(await p.referral.hasRedeemed('usr_2'), false);
  await p.store.add(23, { type: 'redemption', referrerId: 'usr_1', refereeId: 'usr_2', code: 'ABC', status: 'completed' });
  assert.equal(await p.referral.hasRedeemed('usr_2'), true);
});

// ---------------------------------------------------------------------
// Stage 33 -- notificationService integration (optional dependency)
// ---------------------------------------------------------------------

test('social.follow() notifies the target with NEW_FOLLOWER when notificationService is provided', async () => {
  const { p, notificationService } = createPlatformWithNotifications();
  const record = await p.social.follow('usr_1', 'usr_2');
  assert.equal(notificationService.calls.length, 1);
  assert.deepEqual(notificationService.calls[0], {
    recipientId: 'usr_2',
    type: 'NEW_FOLLOWER',
    payload: { accountId: 'usr_1' },
  });
  assert.equal(record.type, 'follow');
});

test('social.friend() notifies the target with FRIEND_REQUEST when notificationService is provided', async () => {
  const { p, notificationService } = createPlatformWithNotifications();
  const record = await p.social.friend('usr_1', 'usr_2');
  assert.equal(notificationService.calls.length, 1);
  assert.deepEqual(notificationService.calls[0], {
    recipientId: 'usr_2',
    type: 'FRIEND_REQUEST',
    payload: { requestId: record.id },
  });
});

test('social.accept() notifies the original sender with FRIEND_ACCEPTED when notificationService is provided', async () => {
  const { p, notificationService } = createPlatformWithNotifications();
  const req = await p.social.friend('usr_1', 'usr_2');
  notificationService.calls.length = 0; // isolate accept()'s own notify() call
  await p.social.accept('usr_2', req.id);
  assert.equal(notificationService.calls.length, 1);
  assert.deepEqual(notificationService.calls[0], {
    recipientId: 'usr_1',
    type: 'FRIEND_ACCEPTED',
    payload: { accountId: 'usr_2' },
  });
});

test('social.reject() does not notify (no notify() call wired for reject)', async () => {
  const { p, notificationService } = createPlatformWithNotifications();
  const req = await p.social.friend('usr_1', 'usr_2');
  notificationService.calls.length = 0;
  await p.social.reject('usr_2', req.id);
  assert.equal(notificationService.calls.length, 0);
});

test('rooms.approveSeat() notifies the seat requester with MIC_SEAT_APPROVED when notificationService is provided', async () => {
  const { p, notificationService } = createPlatformWithNotifications();
  const room = await p.rooms.create({ ownerId: 'usr_1', name: 'Room' });
  const seat = await p.rooms.seat(room.id, 'usr_2', 3);
  notificationService.calls.length = 0;
  await p.rooms.approveSeat('usr_1', seat.id);
  assert.equal(notificationService.calls.length, 1);
  assert.deepEqual(notificationService.calls[0], {
    recipientId: 'usr_2',
    type: 'MIC_SEAT_APPROVED',
    payload: { roomId: room.id },
  });
});

test('rooms.rejectSeat() notifies the seat requester with MIC_SEAT_REJECTED when notificationService is provided', async () => {
  const { p, notificationService } = createPlatformWithNotifications();
  const room = await p.rooms.create({ ownerId: 'usr_1', name: 'Room' });
  const seat = await p.rooms.seat(room.id, 'usr_2', 3);
  notificationService.calls.length = 0;
  await p.rooms.rejectSeat('usr_1', seat.id);
  assert.equal(notificationService.calls.length, 1);
  assert.deepEqual(notificationService.calls[0], {
    recipientId: 'usr_2',
    type: 'MIC_SEAT_REJECTED',
    payload: { roomId: room.id },
  });
});

test('rooms.approveSeat(): a rejected non-owner attempt does not notify', async () => {
  const { p, notificationService } = createPlatformWithNotifications();
  const room = await p.rooms.create({ ownerId: 'usr_1', name: 'Room' });
  const seat = await p.rooms.seat(room.id, 'usr_2', 3);
  notificationService.calls.length = 0;
  await assert.rejects(() => p.rooms.approveSeat('usr_3', seat.id));
  assert.equal(notificationService.calls.length, 0);
});

test('omitting notificationService leaves follow/friend/accept/approveSeat/rejectSeat behavior unchanged (no crash, same return shape)', async () => {
  const p = createPlatform(); // no notificationService at all
  const follow = await p.social.follow('usr_1', 'usr_2');
  assert.equal(follow.type, 'follow');
  const req = await p.social.friend('usr_3', 'usr_4');
  const accepted = await p.social.accept('usr_4', req.id);
  assert.equal(accepted.status, 'accepted');
  const room = await p.rooms.create({ ownerId: 'usr_5', name: 'Room' });
  const seat = await p.rooms.seat(room.id, 'usr_6', 1);
  const approved = await p.rooms.approveSeat('usr_5', seat.id);
  assert.equal(approved.status, 'approved');
  const seat2 = await p.rooms.seat(room.id, 'usr_7', 2);
  const rejected = await p.rooms.rejectSeat('usr_5', seat2.id);
  assert.equal(rejected.status, 'rejected');
});

// Stage 7/8 -- fake `accounts` dependency, same minimal-interface technique
// as fakeNotificationService() above. Only findById()/list() are used by
// profile.getFull()/search.query() respectively -- never coins/diamonds,
// matching the wallet-privacy rule already enforced elsewhere in this
// project (see FINAL_CORRECTED_BUILD_REPORT.md's account-lookup fix).
function fakeAccounts(records) {
  return {
    async findById(id) { return records.find(a => a.id === id) || null; },
    async list() { return records; },
  };
}

test('profile.create(): a second call for the same userId updates the existing record instead of creating a duplicate', async () => {
  const p = createPlatform();
  const first = await p.profile.create({ userId: 'usr_1', name: 'Old Name', bio: 'old bio' });
  const second = await p.profile.create({ userId: 'usr_1', name: 'New Name', bio: 'new bio' });
  assert.equal(second.id, first.id);
  const fetched = await p.profile.get('usr_1');
  assert.equal(fetched.name, 'New Name');
  assert.equal(fetched.bio, 'new bio');
  const all = await p.store.list(7, x => x.userId === 'usr_1');
  assert.equal(all.length, 1);
});

test('profile.create(): defaults privacy and preserves avatarUrl across an update that omits it', async () => {
  const p = createPlatform();
  const created = await p.profile.create({ userId: 'usr_1', name: 'A', avatarUrl: 'https://example.com/a.png' });
  assert.equal(created.privacy.profileVisibility, 'public');
  assert.equal(created.privacy.discoverable, true);
  const updated = await p.profile.create({ userId: 'usr_1', name: 'B' });
  assert.equal(updated.avatarUrl, 'https://example.com/a.png');
});

test('social.unfollow(): removes an active follow relationship', async () => {
  const p = createPlatform();
  await p.social.follow('usr_1', 'usr_2');
  const full = await p.profile.getFull('usr_2', 'usr_2');
  assert.equal(full.followersCount, 1);
  await p.social.unfollow('usr_1', 'usr_2');
  const after = await p.profile.getFull('usr_2', 'usr_2');
  assert.equal(after.followersCount, 0);
});

test('social.unfollow(): throws 404 when there is no active follow to remove', async () => {
  const p = createPlatform();
  await assert.rejects(
    () => p.social.unfollow('usr_1', 'usr_2'),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});

test('social.follow(): blocked accounts cannot follow each other', async () => {
  const p = createPlatform();
  await p.social.block('usr_2', 'usr_1');
  await assert.rejects(
    () => p.social.follow('usr_1', 'usr_2'),
    (err) => { assert.equal(err.status, 403); return true; }
  );
});

test('social.friend(): blocked accounts cannot send a friend request', async () => {
  const p = createPlatform();
  await p.social.block('usr_1', 'usr_2');
  await assert.rejects(
    () => p.social.friend('usr_1', 'usr_2'),
    (err) => { assert.equal(err.status, 403); return true; }
  );
});

// Stage 35 Part 2/8 -- Block. The route-level identity/wiring contract
// (userId only from req.session.accountId) is covered separately in
// platform.block.routes-contract.test.js; these are the business-rule
// tests at the platform.social.block()/unblock() layer itself.
test('social.block() persists userId/targetId/type/status with a server-generated id and timestamps', async () => {
  const p = createPlatform();
  const record = await p.social.block('usr_1', 'usr_2');
  assert.equal(record.userId, 'usr_1');
  assert.equal(record.targetId, 'usr_2');
  assert.equal(record.type, 'block');
  assert.equal(record.status, 'active');
  assert.match(record.id, /^s8_/);
  assert.ok(record.createdAt);
});

test('social.block() rejects a missing/empty userId or targetId', async () => {
  const p = createPlatform();
  await assert.rejects(() => p.social.block('usr_1', ''), /targetId/);
  await assert.rejects(() => p.social.block('', 'usr_2'), /userId/);
});

test('social.block() is idempotent: calling it twice for the same pair returns the same record instead of creating a duplicate', async () => {
  const p = createPlatform();
  const first = await p.social.block('usr_1', 'usr_2');
  const second = await p.social.block('usr_1', 'usr_2');
  assert.equal(first.id, second.id);
  const all = await p.store.list(8, (x) => x.userId === 'usr_1' && x.targetId === 'usr_2' && x.type === 'block');
  assert.equal(all.length, 1);
});

test('social.block() in one direction does not block the reverse direction', async () => {
  const p = createPlatform();
  await p.social.block('usr_1', 'usr_2');
  assert.equal(await p.social.allowed('usr_1', 'usr_2', 'follow'), false);
  // usr_2 blocking usr_1 is a separate record on the other side -- blocked
  // in BOTH directions once usr_1 -> usr_2 exists, since allowed() already
  // checks both directions (pre-existing behavior, unchanged) -- but a
  // fresh, unrelated pair is unaffected.
  assert.equal(await p.social.allowed('usr_3', 'usr_4', 'follow'), true);
});

test('social.unblock(): removes an active block, restoring social.allowed() to true', async () => {
  const p = createPlatform();
  await p.social.block('usr_1', 'usr_2');
  assert.equal(await p.social.allowed('usr_1', 'usr_2', 'follow'), false);
  await p.social.unblock('usr_1', 'usr_2');
  assert.equal(await p.social.allowed('usr_1', 'usr_2', 'follow'), true);
});

test('social.unblock(): throws 404 when there is no active block to remove', async () => {
  const p = createPlatform();
  await assert.rejects(
    () => p.social.unblock('usr_1', 'usr_2'),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});

test('social.unblock(): re-blocking after an unblock is allowed and creates a fresh active record', async () => {
  const p = createPlatform();
  const first = await p.social.block('usr_1', 'usr_2');
  await p.social.unblock('usr_1', 'usr_2');
  const second = await p.social.block('usr_1', 'usr_2');
  assert.notEqual(first.id, second.id);
  assert.equal(second.status, 'active');
  assert.equal(await p.social.allowed('usr_1', 'usr_2', 'follow'), false);
});

test('social.unblock(): one user unblocking does not affect a different user\'s block on the same target', async () => {
  const p = createPlatform();
  await p.social.block('usr_1', 'usr_3');
  await p.social.block('usr_2', 'usr_3');
  await p.social.unblock('usr_1', 'usr_3');
  assert.equal(await p.social.allowed('usr_1', 'usr_3', 'follow'), true);
  assert.equal(await p.social.allowed('usr_2', 'usr_3', 'follow'), false);
});

test('social.block(): self-block is unrestricted (matches this file\'s existing convention for follow()/friend(), neither of which rejects userId===targetId either), and never locks a user out of their own profile', async () => {
  const p = createPlatform();
  await p.profile.create({ userId: 'usr_1', name: 'Self' });
  const record = await p.social.block('usr_1', 'usr_1');
  assert.equal(record.status, 'active');
  const own = await p.profile.getFull('usr_1', 'usr_1');
  assert.equal(own.name, 'Self');
});

test('social.follow(): a follow that existed before a block still shows as 0 followers once blocked (allowed() gates new actions; existing counts are unaffected by block(), matching this file\'s pre-existing status-based counting)', async () => {
  const p = createPlatform();
  await p.social.follow('usr_2', 'usr_1');
  const before = await p.profile.getFull('usr_1', 'usr_1');
  assert.equal(before.followersCount, 1);
  await p.social.block('usr_1', 'usr_2');
  // getFull() for the owner never runs the block check (isOwner short-circuit,
  // see profile.getFull() above), so this documents block()'s actual scope:
  // it gates NEW follow()/friend()/view_profile calls (already covered by the
  // two tests above), not existing historical records.
  const after = await p.profile.getFull('usr_1', 'usr_1');
  assert.equal(after.followersCount, 1);
});

test('profile.getFull(): merges public account standing (lvl/vip/svip) but never coins/diamonds', async () => {
  const accounts = fakeAccounts([{ id: 'usr_1', lvl: 12, vip: 3, svip: 0, coins: 99999, diamonds: 500 }]);
  const p = createPlatform({ accounts });
  await p.profile.create({ userId: 'usr_1', name: 'Rich' });
  const full = await p.profile.getFull('usr_1', 'usr_1');
  assert.equal(full.lvl, 12);
  assert.equal(full.vip, 3);
  assert.equal(full.svip, 0);
  assert.equal('coins' in full, false);
  assert.equal('diamonds' in full, false);
});

test('profile.getFull(): computes live followers/following/friends counts from real stage-10 records', async () => {
  const p = createPlatform();
  await p.social.follow('usr_2', 'usr_1'); // usr_2 follows usr_1
  await p.social.follow('usr_1', 'usr_3'); // usr_1 follows usr_3
  const req = await p.social.friend('usr_1', 'usr_4');
  await p.social.accept('usr_4', req.id);
  const full = await p.profile.getFull('usr_1', 'usr_1');
  assert.equal(full.followersCount, 1);
  assert.equal(full.followingCount, 1);
  assert.equal(full.friendsCount, 1);
});

test('profile.getFull(): a blocked viewer is rejected with 403 and sees nothing', async () => {
  const p = createPlatform();
  await p.profile.create({ userId: 'usr_1', name: 'Target' });
  await p.social.block('usr_1', 'usr_2');
  await assert.rejects(
    () => p.profile.getFull('usr_2', 'usr_1'),
    (err) => { assert.equal(err.status, 403); return true; }
  );
});

test('profile.getFull(): a private profile hides bio from a non-friend viewer but the owner still sees it', async () => {
  const p = createPlatform();
  await p.profile.create({ userId: 'usr_1', name: 'Target', bio: 'secret bio', privacy: { profileVisibility: 'private' } });
  const strangerView = await p.profile.getFull('usr_2', 'usr_1');
  assert.equal(strangerView.bio, null);
  assert.equal(strangerView.privacyRestricted, true);
  const ownerView = await p.profile.getFull('usr_1', 'usr_1');
  assert.equal(ownerView.bio, 'secret bio');
  assert.equal(ownerView.privacyRestricted, false);
});

test('profile.getFull(): a friends-only profile is visible to an accepted friend but not a stranger', async () => {
  const p = createPlatform();
  await p.profile.create({ userId: 'usr_1', name: 'Target', bio: 'friends bio', privacy: { profileVisibility: 'friends' } });
  const req = await p.social.friend('usr_1', 'usr_2');
  await p.social.accept('usr_2', req.id);
  const friendView = await p.profile.getFull('usr_2', 'usr_1');
  assert.equal(friendView.bio, 'friends bio');
  const strangerView = await p.profile.getFull('usr_3', 'usr_1');
  assert.equal(strangerView.bio, null);
});

test('profile.getFull(): "Followers privacy" -- a private profile hides followers/following/friends counts from a non-friend viewer, not just bio', async () => {
  const p = createPlatform();
  await p.profile.create({ userId: 'usr_1', name: 'Target', bio: 'secret', privacy: { profileVisibility: 'private' } });
  await p.social.follow('usr_9', 'usr_1');
  const strangerView = await p.profile.getFull('usr_2', 'usr_1');
  assert.equal(strangerView.followersCount, undefined);
  assert.equal(strangerView.followingCount, undefined);
  assert.equal(strangerView.friendsCount, undefined);
  assert.equal(strangerView.privacyRestricted, true);
  const ownerView = await p.profile.getFull('usr_1', 'usr_1');
  assert.equal(ownerView.followersCount, 1);
});

test('profile.getFull(): "Followers privacy" -- a friends-only profile shows counts to an accepted friend but not a stranger', async () => {
  const p = createPlatform();
  await p.profile.create({ userId: 'usr_1', name: 'Target', privacy: { profileVisibility: 'friends' } });
  await p.social.follow('usr_9', 'usr_1');
  const req = await p.social.friend('usr_1', 'usr_2');
  await p.social.accept('usr_2', req.id);
  const friendView = await p.profile.getFull('usr_2', 'usr_1');
  assert.equal(friendView.followersCount, 1);
  const strangerView = await p.profile.getFull('usr_3', 'usr_1');
  assert.equal(strangerView.followersCount, undefined);
});

test('profile.shareLink(): "Share" -- returns the canonical profile deep link, matching the existing app://profile/:id convention', () => {
  const p = createPlatform();
  const link = p.profile.shareLink('usr_1');
  assert.equal(link.deepLink, 'app://profile/usr_1');
});

test('profile.shareLink(): rejects a missing/invalid targetUserId the same way every other domain method in this file does', () => {
  const p = createPlatform();
  assert.throws(() => p.profile.shareLink(''), /targetUserId/);
});

test('profile.updatePrivacy(): merges a partial patch into existing privacy without dropping other fields', async () => {
  const p = createPlatform();
  await p.profile.create({ userId: 'usr_1', name: 'A', privacy: { whoCanMessage: 'friends' } });
  await p.profile.updatePrivacy('usr_1', { discoverable: false });
  const full = await p.profile.get('usr_1');
  assert.equal(full.privacy.discoverable, false);
  assert.equal(full.privacy.whoCanMessage, 'friends'); // preserved, not overwritten
});

test('profile.updatePrivacy(): creates a profile with defaults + patch if none existed yet', async () => {
  const p = createPlatform();
  const result = await p.profile.updatePrivacy('usr_1', { discoverable: false });
  assert.equal(result.privacy.discoverable, false);
  assert.equal(result.privacy.profileVisibility, 'public'); // untouched default
});

test('search.query(): an account with discoverable:false is excluded from user search results', async () => {
  const accounts = fakeAccounts([{ id: 'hidden_user', lvl: 1, vip: 0, svip: 0 }, { id: 'visible_user', lvl: 1, vip: 0, svip: 0 }]);
  const p = createPlatform({ accounts });
  await p.profile.create({ userId: 'hidden_user', name: 'Hidden', privacy: { discoverable: false } });
  await p.profile.create({ userId: 'visible_user', name: 'Visible' });
  const results = await p.search.query('user');
  const ids = results.results.filter(r => r.type === 'user').map(r => r.id);
  assert.ok(ids.includes('visible_user'));
  assert.ok(!ids.includes('hidden_user'));
});

test('search.query(): a user with no profile record yet defaults to discoverable (still shows up)', async () => {
  const accounts = fakeAccounts([{ id: 'no_profile_user', lvl: 1, vip: 0, svip: 0 }]);
  const p = createPlatform({ accounts });
  const results = await p.search.query('no_profile');
  const ids = results.results.filter(r => r.type === 'user').map(r => r.id);
  assert.ok(ids.includes('no_profile_user'));
});

// ---------------------------------------------------------------------
// Stage 9 -- Search. Discoverability tests above were already Stage 8's;
// these are the Stage 9 audit fixes: username matching + returning a
// name for user results, private-room exclusion + owner exception for
// room results, and real game-catalog matches for game results.
// ---------------------------------------------------------------------

test('search.query(): matches a user by profile name ("username"), not just account id', async () => {
  const accounts = fakeAccounts([{ id: 'acc_random_id', lvl: 1, vip: 0, svip: 0 }]);
  const p = createPlatform({ accounts });
  await p.profile.create({ userId: 'acc_random_id', name: 'zorro' });
  const results = await p.search.query('zorro');
  const user = results.results.find(r => r.type === 'user');
  assert.equal(user.id, 'acc_random_id');
  assert.equal(user.name, 'zorro');
});

test('search.query(): still matches a user by account id when the name does not match', async () => {
  const accounts = fakeAccounts([{ id: 'unique_id_123', lvl: 1, vip: 0, svip: 0 }]);
  const p = createPlatform({ accounts });
  await p.profile.create({ userId: 'unique_id_123', name: 'someone else' });
  const results = await p.search.query('unique_id_123');
  assert.ok(results.results.some(r => r.type === 'user' && r.id === 'unique_id_123'));
});

test('search.query(): empty query returns no results without touching discoverability rules', async () => {
  const p = createPlatform();
  const results = await p.search.query('');
  assert.deepEqual(results.results, []);
});

test('search.query(): a private room is excluded from a stranger\'s results but included for its own owner', async () => {
  const p = createPlatform();
  await p.rooms.create({ ownerId: 'owner_1', name: 'Secret Lounge', visibility: 'private' });
  const strangerResults = await p.search.query('secret lounge', 'someone_else');
  assert.ok(!strangerResults.results.some(r => r.type === 'room'));
  const ownerResults = await p.search.query('secret lounge', 'owner_1');
  assert.ok(ownerResults.results.some(r => r.type === 'room' && r.name === 'Secret Lounge'));
});

test('search.query(): a public room is visible to any searcher, including with no actingAccountId at all', async () => {
  const p = createPlatform();
  await p.rooms.create({ ownerId: 'owner_1', name: 'Open Lounge' });
  const results = await p.search.query('open lounge');
  assert.ok(results.results.some(r => r.type === 'room' && r.name === 'Open Lounge'));
});

test('search.query(): room results never leak passwordHash (same sanitizer every other room response uses)', async () => {
  const p = createPlatform();
  await p.rooms.create({ ownerId: 'owner_1', name: 'Locked Room', password: 'sesame123' });
  const results = await p.search.query('locked room');
  const room = results.results.find(r => r.type === 'room');
  assert.equal(room.passwordHash, undefined);
  assert.equal(room.hasPassword, true);
});

test('search.query(): Game Search matches the real Stage 19 catalog by id or display name, even with no live match running', async () => {
  const p = createPlatform();
  const byId = await p.search.query('ludo');
  assert.ok(byId.results.some(r => r.type === 'game' && r.id === 'ludo' && r.catalog === true));
  const byName = await p.search.query('eight ball');
  assert.ok(byName.results.some(r => r.type === 'game' && r.id === 'eight_ball' && r.catalog === true));
});

test('search.query(): Game Search still includes a real live match instance alongside the catalog entry', async () => {
  const p = createPlatform();
  await p.games.create({ roomId: 'room_1', gameId: 'ludo', startedBy: 'usr_1' });
  const results = await p.search.query('ludo');
  const gameResults = results.results.filter(r => r.type === 'game');
  assert.ok(gameResults.some(r => r.catalog === true));
  assert.ok(gameResults.some(r => r.catalog === false && r.roomId === 'room_1'));
});

test('search.query(): Family Search was reading a disconnected store (stage 30, never written to) -- fixed to read the real family repository', async () => {
  const { InMemoryFamilyRepository } = require('../src/database/repositories/family.repository');
  const families = new InMemoryFamilyRepository();
  await families.createFamily('usr_1', 'Desert Falcons');
  const p = createPlatform({ families });
  const results = await p.search.query('desert falcons');
  assert.ok(results.results.some(r => r.type === 'family' && r.name === 'Desert Falcons'));
});

test('search.query(): without a families dependency, family search returns no results (same safe default as accounts) instead of throwing', async () => {
  const p = createPlatform();
  const results = await p.search.query('anything');
  assert.equal(results.results.filter(r => r.type === 'family').length, 0);
});

// ---------------------------------------------------------------------
// Stage 35 Part 3/8 -- Mute (a user). Route-level identity/wiring is
// covered separately in platform.mute.routes-contract.test.js; these are
// the business-rule tests at platform.social.muteUser()/unmuteUser()/
// isUserMuted() themselves, plus the real notification-suppression effect
// wired into follow()/friend()/accept() above and chat.service.js.
// ---------------------------------------------------------------------

test('social.muteUser() persists userId/targetId/type/status with a server-generated id and timestamps', async () => {
  const p = createPlatform();
  const record = await p.social.muteUser('usr_1', 'usr_2');
  assert.equal(record.userId, 'usr_1');
  assert.equal(record.targetId, 'usr_2');
  assert.equal(record.type, 'mute');
  assert.equal(record.status, 'active');
  assert.match(record.id, /^s8_/);
  assert.ok(record.createdAt);
});

test('social.muteUser() rejects a missing/empty userId or targetId', async () => {
  const p = createPlatform();
  await assert.rejects(() => p.social.muteUser('usr_1', ''), /targetId/);
  await assert.rejects(() => p.social.muteUser('', 'usr_2'), /userId/);
});

test('social.muteUser() is idempotent: calling it twice for the same pair returns the same record instead of creating a duplicate', async () => {
  const p = createPlatform();
  const first = await p.social.muteUser('usr_1', 'usr_2');
  const second = await p.social.muteUser('usr_1', 'usr_2');
  assert.equal(first.id, second.id);
  const all = await p.store.list(8, (x) => x.userId === 'usr_1' && x.targetId === 'usr_2' && x.type === 'mute');
  assert.equal(all.length, 1);
});

test('social.muteUser() in one direction does not mute the reverse direction', async () => {
  const p = createPlatform();
  await p.social.muteUser('usr_1', 'usr_2');
  assert.equal(await p.social.isUserMuted('usr_1', 'usr_2'), true);
  assert.equal(await p.social.isUserMuted('usr_2', 'usr_1'), false);
});

test('social.unmuteUser(): removes an active mute, restoring isUserMuted() to false', async () => {
  const p = createPlatform();
  await p.social.muteUser('usr_1', 'usr_2');
  assert.equal(await p.social.isUserMuted('usr_1', 'usr_2'), true);
  await p.social.unmuteUser('usr_1', 'usr_2');
  assert.equal(await p.social.isUserMuted('usr_1', 'usr_2'), false);
});

test('social.unmuteUser(): throws 404 when there is no active mute to remove', async () => {
  const p = createPlatform();
  await assert.rejects(
    () => p.social.unmuteUser('usr_1', 'usr_2'),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});

test('social.unmuteUser(): re-muting after an unmute is allowed and creates a fresh active record', async () => {
  const p = createPlatform();
  const first = await p.social.muteUser('usr_1', 'usr_2');
  await p.social.unmuteUser('usr_1', 'usr_2');
  const second = await p.social.muteUser('usr_1', 'usr_2');
  assert.notEqual(first.id, second.id);
  assert.equal(second.status, 'active');
  assert.equal(await p.social.isUserMuted('usr_1', 'usr_2'), true);
});

test('social.unmuteUser(): one user unmuting does not affect a different user\'s mute on the same target', async () => {
  const p = createPlatform();
  await p.social.muteUser('usr_1', 'usr_3');
  await p.social.muteUser('usr_2', 'usr_3');
  await p.social.unmuteUser('usr_1', 'usr_3');
  assert.equal(await p.social.isUserMuted('usr_1', 'usr_3'), false);
  assert.equal(await p.social.isUserMuted('usr_2', 'usr_3'), true);
});

test('social.muteUser(): self-mute is unrestricted (matches this file\'s existing convention for follow()/friend()/block())', async () => {
  const p = createPlatform();
  const record = await p.social.muteUser('usr_1', 'usr_1');
  assert.equal(record.status, 'active');
});

test('social.muteUser() is a distinct record/type from social.block() -- muting never affects allowed() (follow/friend/message/profile-view all remain permitted)', async () => {
  const p = createPlatform();
  await p.social.muteUser('usr_1', 'usr_2');
  assert.equal(await p.social.allowed('usr_2', 'usr_1', 'follow'), true);
  assert.equal(await p.social.allowed('usr_1', 'usr_2', 'follow'), true);
});

test('social.muteUser() is a distinct record/type from the pre-existing Stage 10 social.mute(userId, relationId) -- both coexist without colliding', async () => {
  const p = createPlatform();
  const follow = await p.social.follow('usr_1', 'usr_2');
  const relationMuted = await p.social.mute('usr_1', follow.id); // Stage 10, relation-scoped
  assert.equal(relationMuted.muted, true);
  const userMuted = await p.social.muteUser('usr_1', 'usr_2'); // Stage 35 Part 3/8, user-scoped
  assert.equal(userMuted.type, 'mute');
  assert.equal(await p.social.isUserMuted('usr_1', 'usr_2'), true);
});

test('social.follow(): NEW_FOLLOWER notification is suppressed when the recipient has muted the follower, but the follow itself still succeeds', async () => {
  const { p, notificationService } = createPlatformWithNotifications();
  await p.social.muteUser('usr_2', 'usr_1'); // usr_2 mutes usr_1
  const record = await p.social.follow('usr_1', 'usr_2');
  assert.equal(record.status, 'active');
  assert.equal(notificationService.calls.length, 0);
});

test('social.follow(): NEW_FOLLOWER notification still fires normally when there is no mute', async () => {
  const { p, notificationService } = createPlatformWithNotifications();
  await p.social.follow('usr_1', 'usr_2');
  assert.equal(notificationService.calls.length, 1);
  assert.equal(notificationService.calls[0].type, 'NEW_FOLLOWER');
});

test('social.friend(): FRIEND_REQUEST notification is suppressed when the recipient has muted the requester', async () => {
  const { p, notificationService } = createPlatformWithNotifications();
  await p.social.muteUser('usr_2', 'usr_1');
  const record = await p.social.friend('usr_1', 'usr_2');
  assert.equal(record.status, 'pending');
  assert.equal(notificationService.calls.length, 0);
});

test('social.accept(): FRIEND_ACCEPTED notification is suppressed when the original requester has muted the accepter', async () => {
  const { p, notificationService } = createPlatformWithNotifications();
  const request = await p.social.friend('usr_1', 'usr_2'); // FRIEND_REQUEST fires (unmuted)
  await p.social.muteUser('usr_1', 'usr_2'); // usr_1 (the requester) now mutes usr_2
  notificationService.calls.length = 0;
  await p.social.accept('usr_2', request.id);
  assert.equal(notificationService.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Stage 10 completion audit (2026-09-16) -- three genuine gaps found and
// fixed: (1) follow() had no self-follow or duplicate-follow guard,
// (2) friend() had no request-to-self or duplicate-request guard, (3) there
// was no way to fetch the actual Friends/Followers/Following lists (only
// counts existed on profile.getFull()). See feature-platform.js's inline
// comments on follow()/friend()/listFriends()/listFollowers()/listFollowing()
// for the exact reasoning. Everything else in Stage 10 (accept/reject/mute,
// block integration, both-sides state, notification suppression) was already
// implemented and already covered by the tests above this block -- untouched.
// ---------------------------------------------------------------------------

test('social.follow(): a user cannot follow themselves', async () => {
  const p = createPlatform();
  await assert.rejects(
    () => p.social.follow('usr_1', 'usr_1'),
    (err) => { assert.equal(err.status, 400); return true; }
  );
});

test('social.follow(): calling it twice for the same pair is idempotent (returns the existing active record, does not inflate followersCount)', async () => {
  const p = createPlatform();
  const first = await p.social.follow('usr_1', 'usr_2');
  const second = await p.social.follow('usr_1', 'usr_2');
  assert.equal(first.id, second.id);
  const full = await p.profile.getFull('usr_2', 'usr_2');
  assert.equal(full.followersCount, 1);
});

test('social.follow(): unfollowing then following again creates a fresh active record (duplicate guard only blocks an already-active follow)', async () => {
  const p = createPlatform();
  const first = await p.social.follow('usr_1', 'usr_2');
  await p.social.unfollow('usr_1', 'usr_2');
  const second = await p.social.follow('usr_1', 'usr_2');
  assert.notEqual(first.id, second.id);
  const full = await p.profile.getFull('usr_2', 'usr_2');
  assert.equal(full.followersCount, 1);
});

test('social.friend(): a user cannot send a friend request to themselves', async () => {
  const p = createPlatform();
  await assert.rejects(
    () => p.social.friend('usr_1', 'usr_1'),
    (err) => { assert.equal(err.status, 400); return true; }
  );
});

test('social.friend(): sending a second request while one is already pending returns the existing pending request instead of creating a duplicate', async () => {
  const p = createPlatform();
  const first = await p.social.friend('usr_1', 'usr_2');
  const second = await p.social.friend('usr_1', 'usr_2');
  assert.equal(first.id, second.id);
});

test('social.friend(): the recipient sending a request back while one is already pending also returns the existing request (duplicate check is bidirectional)', async () => {
  const p = createPlatform();
  const first = await p.social.friend('usr_1', 'usr_2');
  const reverse = await p.social.friend('usr_2', 'usr_1');
  assert.equal(first.id, reverse.id);
});

test('social.friend(): sending a request to an account you are already friends with is rejected', async () => {
  const p = createPlatform();
  const request = await p.social.friend('usr_1', 'usr_2');
  await p.social.accept('usr_2', request.id);
  await assert.rejects(
    () => p.social.friend('usr_1', 'usr_2'),
    (err) => { assert.equal(err.status, 409); return true; }
  );
});

test('social.friend(): a new request can be sent again after a previous one was rejected', async () => {
  const p = createPlatform();
  const first = await p.social.friend('usr_1', 'usr_2');
  await p.social.reject('usr_2', first.id);
  const second = await p.social.friend('usr_1', 'usr_2');
  assert.notEqual(first.id, second.id);
  assert.equal(second.status, 'pending');
});

test('profile.listFriends()/listFollowers()/listFollowing(): return the real accounts behind getFull()\'s counts, for both sides of each relationship', async () => {
  const p = createPlatform();
  await p.social.follow('usr_1', 'usr_2'); // usr_1 follows usr_2
  const request = await p.social.friend('usr_1', 'usr_3');
  await p.social.accept('usr_3', request.id); // usr_1 and usr_3 are friends

  const usr2Followers = await p.profile.listFollowers('usr_2', 'usr_2');
  assert.deepEqual(usr2Followers, [{ accountId: 'usr_1' }]);

  const usr1Following = await p.profile.listFollowing('usr_1', 'usr_1');
  assert.deepEqual(usr1Following, [{ accountId: 'usr_2' }]);

  const usr1Friends = await p.profile.listFriends('usr_1', 'usr_1');
  assert.deepEqual(usr1Friends, [{ accountId: 'usr_3' }]);
  // Both-sides check (Step 7 of the Stage 10 spec): the friendship must
  // show correctly from usr_3's side too, even though usr_3 was the
  // targetId of the original request, not the userId.
  const usr3Friends = await p.profile.listFriends('usr_3', 'usr_3');
  assert.deepEqual(usr3Friends, [{ accountId: 'usr_1' }]);
});

test('profile.listFollowers(): a blocked viewer is rejected with 403 and sees nothing', async () => {
  const p = createPlatform();
  await p.social.follow('usr_1', 'usr_2');
  await p.social.block('usr_2', 'usr_1');
  await assert.rejects(
    () => p.profile.listFollowers('usr_1', 'usr_2'),
    (err) => { assert.equal(err.status, 403); return true; }
  );
});

test('profile.listFriends(): a private profile hides the list from a non-friend viewer but the owner still sees it', async () => {
  const p = createPlatform();
  await p.profile.create({ userId: 'usr_2', name: 'Private User', privacy: { profileVisibility: 'private' } });
  const request = await p.social.friend('usr_1', 'usr_3');
  await p.social.friend('usr_2', 'usr_3');
  await assert.rejects(
    () => p.profile.listFriends('usr_1', 'usr_2'),
    (err) => { assert.equal(err.status, 403); return true; }
  );
  const ownerView = await p.profile.listFriends('usr_2', 'usr_2');
  assert.deepEqual(ownerView, []);
});

test('profile.listFollowing(): a friends-only profile shows the list to an accepted friend but not a stranger', async () => {
  const p = createPlatform();
  await p.profile.create({ userId: 'usr_2', name: 'Friends-only User', privacy: { profileVisibility: 'friends' } });
  const request = await p.social.friend('usr_1', 'usr_2');
  await p.social.accept('usr_2', request.id);
  await p.social.follow('usr_2', 'usr_9');

  const friendView = await p.profile.listFollowing('usr_1', 'usr_2');
  assert.deepEqual(friendView, [{ accountId: 'usr_9' }]);

  await assert.rejects(
    () => p.profile.listFollowing('usr_stranger', 'usr_2'),
    (err) => { assert.equal(err.status, 403); return true; }
  );
});

// ---------------------------------------------------------------------
// Stage 7 completion (this session) -- Family/Couple/Gifts composed onto
// profile.getFull(). `families`/`couples`/`gifts` are OPTIONAL
// constructor dependencies (same additive pattern as `accounts` for
// lvl/vip/svip above) -- omitting them must leave getFull() byte-for-byte
// unchanged, which the very first test below proves before testing the
// new fields themselves.
// ---------------------------------------------------------------------

test('profile.getFull(): omitting families/couples/gifts leaves the response exactly as before (no family/couple/gifts fields)', async () => {
  const p = createPlatform();
  await p.profile.create({ userId: 'usr_1', name: 'Plain User' });
  const full = await p.profile.getFull('usr_1', 'usr_1');
  assert.equal('family' in full, false);
  assert.equal('couple' in full, false);
  assert.equal('gifts' in full, false);
});

test('profile.getFull(): merges real Family title/badges from the real per-membership contribution total, not privacy-gated', async () => {
  const families = new InMemoryFamilyRepository();
  const p = createPlatform({ families });
  await p.profile.create({ userId: 'usr_1', name: 'Family Member', privacy: { profileVisibility: 'private' } });
  const family = await families.createFamily('usr_1', 'The Legends');
  const membership = await families.findActiveMembershipByAccount('usr_1');
  await families.addContribution(family.id, membership.id, 5200); // crosses 'pillar' + first_5000

  // A stranger is blocked from bio/counts by the private profile, but the
  // family standing tier is public exactly like lvl/vip/svip -- present
  // in the SAME rejected-privacy branch (privacyRestricted: true).
  const strangerView = await p.profile.getFull('usr_stranger', 'usr_1');
  assert.equal(strangerView.privacyRestricted, true);
  assert.deepEqual(strangerView.family, { familyId: family.id, title: 'pillar', badges: ['first_500', 'first_1000', 'first_5000'] });

  const ownerView = await p.profile.getFull('usr_1', 'usr_1');
  assert.deepEqual(ownerView.family, { familyId: family.id, title: 'pillar', badges: ['first_500', 'first_1000', 'first_5000'] });
});

test('profile.getFull(): a user with no active family membership gets no family field', async () => {
  const families = new InMemoryFamilyRepository();
  const p = createPlatform({ families });
  await p.profile.create({ userId: 'usr_1', name: 'No Family' });
  const full = await p.profile.getFull('usr_1', 'usr_1');
  assert.equal('family' in full, false);
});

test('profile.getFull(): merges real Couple status (partnerId resolved to the OTHER account, never self), not privacy-gated', async () => {
  const couples = new InMemoryCoupleRepository();
  const p = createPlatform({ couples });
  await p.profile.create({ userId: 'usr_1', name: 'Half of a Couple', privacy: { profileVisibility: 'private' } });
  const couple = await couples.createCouple('usr_1', 'usr_2');
  await couples.addCp(couple.id, 300);

  const strangerView = await p.profile.getFull('usr_stranger', 'usr_1');
  assert.equal(strangerView.privacyRestricted, true);
  assert.equal(strangerView.couple.partnerId, 'usr_2');
  assert.equal(strangerView.couple.coupleId, couple.id);

  // Same lookup from the OTHER side must resolve the partner correctly too
  // (accountA/accountB are stored in a canonical sorted order internally --
  // this proves getFull() never just echoes accountB blindly).
  const otherSideView = await p.profile.getFull('usr_2', 'usr_2');
  assert.equal(otherSideView.couple.partnerId, 'usr_1');
});

test('profile.getFull(): an unpaired user gets no couple field, and an ended couple stops appearing', async () => {
  const couples = new InMemoryCoupleRepository();
  const p = createPlatform({ couples });
  await p.profile.create({ userId: 'usr_1', name: 'Single' });
  const noneYet = await p.profile.getFull('usr_1', 'usr_1');
  assert.equal('couple' in noneYet, false);

  const couple = await couples.createCouple('usr_1', 'usr_2');
  const paired = await p.profile.getFull('usr_1', 'usr_1');
  assert.equal(paired.couple.coupleId, couple.id);

  await couples.endCouple(couple.id);
  const afterEnd = await p.profile.getFull('usr_1', 'usr_1');
  assert.equal('couple' in afterEnd, false);
});

test('profile.getFull(): Gifts-received total/count follow the SAME privacy gate as followers/following/friends counts (unlike family/couple)', async () => {
  const gifts = new InMemoryGiftRepository();
  const p = createPlatform({ gifts });
  await p.profile.create({ userId: 'usr_1', name: 'Gifted User', privacy: { profileVisibility: 'private' } });
  await gifts.create({ roomId: 'room_a', senderId: 'usr_2', receiverId: 'usr_1', giftId: 'rose', quantity: 1, unitCostCoins: 10, totalCostCoins: 10, walletTransactionId: 'tx_1' });
  await gifts.create({ roomId: 'room_b', senderId: 'usr_3', receiverId: 'usr_1', giftId: 'car', quantity: 2, unitCostCoins: 500, totalCostCoins: 1000, walletTransactionId: 'tx_2' });
  // A gift where usr_1 is the SENDER, not receiver, must never be counted.
  await gifts.create({ roomId: 'room_c', senderId: 'usr_1', receiverId: 'usr_4', giftId: 'rose', quantity: 1, unitCostCoins: 10, totalCostCoins: 10, walletTransactionId: 'tx_3' });

  // Private profile: a stranger is rejected before gifts is ever computed
  // (privacyRestricted branch has no `gifts` key at all).
  const strangerView = await p.profile.getFull('usr_stranger', 'usr_1');
  assert.equal(strangerView.privacyRestricted, true);
  assert.equal('gifts' in strangerView, false);

  const ownerView = await p.profile.getFull('usr_1', 'usr_1');
  assert.deepEqual(ownerView.gifts, { count: 2, totalCoins: 1010 });
});

test('profile.getFull(): a user who never received a gift gets an honest zero, same as followersCount would, not a missing field', async () => {
  const gifts = new InMemoryGiftRepository();
  const p = createPlatform({ gifts });
  await p.profile.create({ userId: 'usr_1', name: 'Never Gifted' });
  const full = await p.profile.getFull('usr_1', 'usr_1');
  assert.deepEqual(full.gifts, { count: 0, totalCoins: 0 });
});
