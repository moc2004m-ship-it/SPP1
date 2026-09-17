'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform } = require('../src/feature-platform');

// Stage 13 -- Room Entry/Join/Leave/Reconnect.
//
// These tests exercise platform.rooms.join/leave/disconnect/reconnect
// directly against the real FeatureStore (in-memory repository, same one
// every other feature-platform.test.js test uses -- no mock of the
// membership logic itself). A fixed injectable `clock` is used only where
// the reconnect grace-window boundary needs to be deterministic; every
// other test uses the real clock exactly like the rest of the suite.

function setup(clock) {
  return createPlatform(clock ? { clock } : {});
}

async function createOpenRoom(p, ownerId = 'usr_owner') {
  return p.rooms.create({ ownerId, name: 'Stage13 Room' });
}

test('rooms.join(): a fresh join creates a real joined membership tied to the room and user', async () => {
  const p = setup();
  const room = await createOpenRoom(p);
  const membership = await p.rooms.join(room.id, 'usr_2');
  assert.equal(membership.roomId, room.id);
  assert.equal(membership.userId, 'usr_2');
  assert.equal(membership.status, 'joined');
  assert.ok(membership.joinedAt);
  assert.equal(membership.reconnectCount, 0);
});

test('rooms.join(): joining a room that does not exist is a 404', async () => {
  const p = setup();
  await assert.rejects(
    () => p.rooms.join('room_does_not_exist', 'usr_2'),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});

test('rooms.join(): joining a room that is not open is a 409', async () => {
  const p = setup();
  const room = await createOpenRoom(p);
  // Directly force the room closed via the same store.update() every other
  // stage in this file uses for state transitions (there is no invented
  // "close room" primitive yet -- Stage 13's scope is entry/join/leave/
  // reconnect, not room lifecycle -- so the test reaches into the store
  // the same way Stage 16's kick()/muteMember() tests already do).
  await p.store.update(12, room.id, { status: 'closed' });
  await assert.rejects(
    () => p.rooms.join(room.id, 'usr_2'),
    (err) => { assert.equal(err.status, 409); return true; }
  );
});

test('rooms.join(): calling join twice while already joined is idempotent (no duplicate membership row)', async () => {
  const p = setup();
  const room = await createOpenRoom(p);
  const first = await p.rooms.join(room.id, 'usr_2');
  const second = await p.rooms.join(room.id, 'usr_2');
  assert.equal(second.id, first.id);
  assert.equal(second.status, 'joined');
  const memberships = await p.store.list(13);
  const forThisUser = memberships.filter((m) => m.roomId === room.id && m.userId === 'usr_2');
  assert.equal(forThisUser.length, 1);
});

test('rooms.join(): requires both roomId and userId', async () => {
  const p = setup();
  const room = await createOpenRoom(p);
  await assert.rejects(() => p.rooms.join(room.id, ''));
  await assert.rejects(() => p.rooms.join('', 'usr_2'));
});

test('rooms.leave(): a joined member can leave, and the membership actually changes status', async () => {
  const p = setup();
  const room = await createOpenRoom(p);
  await p.rooms.join(room.id, 'usr_2');
  const left = await p.rooms.leave(room.id, 'usr_2');
  assert.equal(left.status, 'left');
  assert.ok(left.leftAt);
});

test('rooms.leave(): leaving a room you never joined is a 404', async () => {
  const p = setup();
  const room = await createOpenRoom(p);
  await assert.rejects(
    () => p.rooms.leave(room.id, 'usr_2'),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});

test('rooms.leave(): leaving twice in a row is a 404 the second time (not silently ok)', async () => {
  const p = setup();
  const room = await createOpenRoom(p);
  await p.rooms.join(room.id, 'usr_2');
  await p.rooms.leave(room.id, 'usr_2');
  await assert.rejects(
    () => p.rooms.leave(room.id, 'usr_2'),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});

test('rooms.join(): after leaving, the same user can join again as a brand-new membership', async () => {
  const p = setup();
  const room = await createOpenRoom(p);
  const original = await p.rooms.join(room.id, 'usr_2');
  await p.rooms.leave(room.id, 'usr_2');
  const rejoined = await p.rooms.join(room.id, 'usr_2');
  assert.notEqual(rejoined.id, original.id);
  assert.equal(rejoined.status, 'joined');
});

test('rooms.disconnect(): a joined member can be marked disconnected', async () => {
  const p = setup();
  const room = await createOpenRoom(p);
  await p.rooms.join(room.id, 'usr_2');
  const disconnected = await p.rooms.disconnect(room.id, 'usr_2');
  assert.equal(disconnected.status, 'disconnected');
  assert.ok(disconnected.disconnectedAt);
});

test('rooms.disconnect(): disconnecting a user with no active session is a 404', async () => {
  const p = setup();
  const room = await createOpenRoom(p);
  await assert.rejects(
    () => p.rooms.disconnect(room.id, 'usr_2'),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});

test('rooms.disconnect(): disconnecting an already-disconnected session is a 404 (not double-applied)', async () => {
  const p = setup();
  const room = await createOpenRoom(p);
  await p.rooms.join(room.id, 'usr_2');
  await p.rooms.disconnect(room.id, 'usr_2');
  await assert.rejects(
    () => p.rooms.disconnect(room.id, 'usr_2'),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});

test('rooms.reconnect(): resumes the exact same membership record after a disconnect, within the grace window', async () => {
  const p = setup();
  const room = await createOpenRoom(p);
  const joined = await p.rooms.join(room.id, 'usr_2');
  await p.rooms.disconnect(room.id, 'usr_2');
  const reconnected = await p.rooms.reconnect(room.id, 'usr_2');
  assert.equal(reconnected.id, joined.id);
  assert.equal(reconnected.status, 'joined');
  assert.ok(reconnected.reconnectedAt);
  assert.equal(reconnected.reconnectCount, 1);
});

test('rooms.reconnect(): with no disconnected session at all is a 404 (must join instead)', async () => {
  const p = setup();
  const room = await createOpenRoom(p);
  await assert.rejects(
    () => p.rooms.reconnect(room.id, 'usr_2'),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});

test('rooms.reconnect(): a currently-joined (never disconnected) user cannot "reconnect" -- 404', async () => {
  const p = setup();
  const room = await createOpenRoom(p);
  await p.rooms.join(room.id, 'usr_2');
  await assert.rejects(
    () => p.rooms.reconnect(room.id, 'usr_2'),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});

test('rooms.reconnect(): expired grace window returns 410 and does not revive the membership', async () => {
  let currentTime = new Date('2026-01-01T00:00:00.000Z');
  const p = setup(() => currentTime);
  const room = await createOpenRoom(p);
  await p.rooms.join(room.id, 'usr_2');
  await p.rooms.disconnect(room.id, 'usr_2');
  // Advance the injected clock past the 5-minute reconnect grace window.
  currentTime = new Date('2026-01-01T00:06:00.000Z');
  await assert.rejects(
    () => p.rooms.reconnect(room.id, 'usr_2'),
    (err) => { assert.equal(err.status, 410); return true; }
  );
  const memberships = await p.store.list(13);
  const record = memberships.find((m) => m.roomId === room.id && m.userId === 'usr_2');
  assert.equal(record.status, 'disconnected');
});

test('rooms.reconnect(): still inside the grace window (just under the boundary) succeeds', async () => {
  let currentTime = new Date('2026-01-01T00:00:00.000Z');
  const p = setup(() => currentTime);
  const room = await createOpenRoom(p);
  await p.rooms.join(room.id, 'usr_2');
  await p.rooms.disconnect(room.id, 'usr_2');
  currentTime = new Date('2026-01-01T00:04:59.000Z');
  const reconnected = await p.rooms.reconnect(room.id, 'usr_2');
  assert.equal(reconnected.status, 'joined');
});

test('rooms.join(): auto-resumes a disconnected session (same membership id) instead of forking a new one', async () => {
  const p = setup();
  const room = await createOpenRoom(p);
  const joined = await p.rooms.join(room.id, 'usr_2');
  await p.rooms.disconnect(room.id, 'usr_2');
  const resumed = await p.rooms.join(room.id, 'usr_2');
  assert.equal(resumed.id, joined.id);
  assert.equal(resumed.status, 'joined');
  assert.equal(resumed.reconnectCount, 1);
  const memberships = await p.store.list(13);
  const forThisUser = memberships.filter((m) => m.roomId === room.id && m.userId === 'usr_2');
  assert.equal(forThisUser.length, 1, 'join() must not create a second row for an already-known membership');
});

test('state preservation: an approved mic seat survives disconnect + reconnect untouched', async () => {
  const p = setup();
  const room = await createOpenRoom(p);
  await p.rooms.join(room.id, 'usr_2');
  const seat = await p.rooms.seat(room.id, 'usr_2', 3);
  const approved = await p.rooms.approveSeat('usr_owner', seat.id);
  assert.equal(approved.status, 'approved');

  await p.rooms.disconnect(room.id, 'usr_2');
  // While disconnected, the seat itself must remain approved/untouched --
  // Stage 13's disconnect() never reaches into Stage 14's seat records.
  const seatWhileDisconnected = await p.store.find(14, (s) => s.id === seat.id);
  assert.equal(seatWhileDisconnected.status, 'approved');
  assert.equal(seatWhileDisconnected.muted, undefined);

  await p.rooms.reconnect(room.id, 'usr_2');
  const seatAfterReconnect = await p.store.find(14, (s) => s.id === seat.id);
  assert.equal(seatAfterReconnect.status, 'approved');
  assert.equal(seatAfterReconnect.id, seat.id);
});

test('state preservation: Stage 16 moderation history for a room survives a disconnect/reconnect cycle', async () => {
  const p = setup();
  const room = await createOpenRoom(p);
  await p.rooms.join(room.id, 'usr_2');
  await p.rooms.moderation(room.id, 'usr_owner', 'usr_2', 'warn');
  await p.rooms.disconnect(room.id, 'usr_2');
  await p.rooms.reconnect(room.id, 'usr_2');
  const auditLog = await p.store.list(16);
  assert.ok(auditLog.some((a) => a.roomId === room.id && a.targetId === 'usr_2' && a.action === 'warn'));
});

test('invalid access: kicking a disconnected (not currently "joined") member is still a 404, same as before Stage 13', async () => {
  const p = setup();
  const room = await createOpenRoom(p);
  await p.rooms.join(room.id, 'usr_2');
  await p.rooms.disconnect(room.id, 'usr_2');
  await assert.rejects(
    () => p.rooms.kick('usr_owner', room.id, 'usr_2'),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});

test('rooms.kick(): kicking a joined member still works exactly as before Stage 13 (no regression)', async () => {
  const p = setup();
  const room = await createOpenRoom(p);
  await p.rooms.join(room.id, 'usr_2');
  const kicked = await p.rooms.kick('usr_owner', room.id, 'usr_2');
  assert.equal(kicked.status, 'kicked');
});

test('invalid access: a kicked user can join again later as a brand-new membership (kick is removal, not a ban)', async () => {
  const p = setup();
  const room = await createOpenRoom(p);
  await p.rooms.join(room.id, 'usr_2');
  await p.rooms.kick('usr_owner', room.id, 'usr_2');
  const rejoined = await p.rooms.join(room.id, 'usr_2');
  assert.equal(rejoined.status, 'joined');
});

test('two different users joining the same room each get their own independent membership', async () => {
  const p = setup();
  const room = await createOpenRoom(p);
  const m1 = await p.rooms.join(room.id, 'usr_2');
  const m2 = await p.rooms.join(room.id, 'usr_3');
  assert.notEqual(m1.id, m2.id);
  await p.rooms.disconnect(room.id, 'usr_2');
  const m2Still = await p.store.find(13, (m) => m.id === m2.id);
  assert.equal(m2Still.status, 'joined', 'disconnecting one member must not affect another');
});

test('the same user can be independently joined to two different rooms at once', async () => {
  const p = setup();
  const roomA = await createOpenRoom(p, 'usr_owner_a');
  const roomB = await createOpenRoom(p, 'usr_owner_b');
  const inA = await p.rooms.join(roomA.id, 'usr_2');
  const inB = await p.rooms.join(roomB.id, 'usr_2');
  assert.notEqual(inA.id, inB.id);
  await p.rooms.leave(roomA.id, 'usr_2');
  const stillInB = await p.store.find(13, (m) => m.id === inB.id);
  assert.equal(stillInB.status, 'joined', 'leaving room A must not affect membership in room B');
});

// --- Audience capacity (room.create({ capacity })) ---------------------
// Optional, additive: rooms.create() without a capacity behaves exactly as
// before (unlimited, capacity: null) -- every pre-existing test above (and
// every test in feature-platform.test.js) never passes one and is
// unaffected. When a capacity IS set, join() enforces it as part of real
// room-entry validation.

test('rooms.create(): capacity defaults to null (unlimited) when not provided, unchanged from before', async () => {
  const p = setup();
  const room = await createOpenRoom(p);
  assert.equal(room.capacity, null);
});

test('rooms.create(): a non-positive or non-integer capacity is treated as unlimited (null), not a crash', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'usr_owner', name: 'Room', capacity: -1 });
  assert.equal(room.capacity, null);
  const room2 = await p.rooms.create({ ownerId: 'usr_owner', name: 'Room', capacity: 'not-a-number' });
  assert.equal(room2.capacity, null);
});

test('rooms.join(): a room at capacity rejects a new (brand-new) member with 409', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'usr_owner', name: 'Small Room', capacity: 2 });
  await p.rooms.join(room.id, 'usr_2');
  await p.rooms.join(room.id, 'usr_3');
  await assert.rejects(
    () => p.rooms.join(room.id, 'usr_4'),
    (err) => { assert.equal(err.status, 409); return true; }
  );
});

test('rooms.join(): capacity counts disconnected members too (their slot is reserved during the grace window)', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'usr_owner', name: 'Small Room', capacity: 1 });
  await p.rooms.join(room.id, 'usr_2');
  await p.rooms.disconnect(room.id, 'usr_2');
  await assert.rejects(
    () => p.rooms.join(room.id, 'usr_3'),
    (err) => { assert.equal(err.status, 409); return true; }
  );
});

test('rooms.join(): a full room does not block the already-joined member from re-joining (idempotent) or resuming after disconnect', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'usr_owner', name: 'Small Room', capacity: 1 });
  const membership = await p.rooms.join(room.id, 'usr_2');
  const again = await p.rooms.join(room.id, 'usr_2');
  assert.equal(again.id, membership.id);
  await p.rooms.disconnect(room.id, 'usr_2');
  const resumed = await p.rooms.join(room.id, 'usr_2');
  assert.equal(resumed.id, membership.id);
  assert.equal(resumed.status, 'joined');
});

test('rooms.join(): a slot freed by leave() becomes available to a new member', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'usr_owner', name: 'Small Room', capacity: 1 });
  await p.rooms.join(room.id, 'usr_2');
  await p.rooms.leave(room.id, 'usr_2');
  const joined = await p.rooms.join(room.id, 'usr_3');
  assert.equal(joined.status, 'joined');
});
