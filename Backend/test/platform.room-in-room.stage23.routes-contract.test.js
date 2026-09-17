'use strict';
// Stage 23 -- Part 2: route-contract tests for the room-in-room breakout
// handlers in src/routes/platform.routes.js:
//   POST /api/rooms/:roomId/breakout              -> requireRoomOwner + platform.roomInRoom.create
//   GET  /api/rooms/:roomId/breakout               -> requireRoomMember + platform.roomInRoom.listForRoom
//   POST /api/rooms/breakout/:breakoutId/join      -> platform.roomInRoom.join
//   POST /api/rooms/breakout/:breakoutId/leave     -> platform.roomInRoom.leave
//   POST /api/rooms/breakout/:breakoutId/end       -> platform.roomInRoom.end
//
// platform.routes.js itself cannot be require()'d in this environment --
// it does `require('express')` at the top of the file, and express is not
// installed here (no network access to install it; see
// STAGE6_FINAL_REPORT.md and the four pre-existing environmental fails in
// accounts/agora/auth/config routes.test.js). Same "pure logic, fake
// req/res inputs" style as platform.referral.routes-contract.test.js and
// platform.rooms.routes-contract.test.js: each handler's own call shape
// is reproduced verbatim against the real platform.roomInRoom.* methods
// and the real requireRoomOwner/requireRoomMember guards, without needing
// express itself.
//
// What this proves: the POST create route is gated by requireRoomOwner
// (a non-owner never reaches platform.roomInRoom.create at all -- the
// route itself 403s first), the GET list route is gated by
// requireRoomMember (a stranger never reaches listForRoom), and every
// identity used (actorId) comes only from req.session.accountId, never a
// client-supplied field. The underlying business rules (capacity,
// idempotent join, cascading end) are exhaustively covered separately in
// rooms.stage23.room-in-room.test.js -- this file is deliberately about
// the routing/session-identity/guard contract, not re-proving that logic.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform } = require('../src/feature-platform');
const { requireRoomOwner, requireRoomMember } = require('../src/routes/platform.guards');

function setup() {
  return createPlatform({});
}

// Reproduces platform.routes.js's handlers exactly:
//   router.post('/api/rooms/:roomId/breakout', (req, res) => json(res, async () => {
//     await requireRoomOwner(platform.store, req.params.roomId, req.session);
//     return platform.roomInRoom.create(req.session.accountId, req.params.roomId, { name: req.body?.name, capacity: req.body?.capacity });
//   }));
async function handleCreate({ platform, req }) {
  await requireRoomOwner(platform.store, req.params.roomId, req.session);
  return platform.roomInRoom.create(req.session.accountId, req.params.roomId, { name: req.body?.name, capacity: req.body?.capacity });
}
//   router.get('/api/rooms/:roomId/breakout', (req, res) => json(res, async () => {
//     await requireRoomMember(platform.store, req.params.roomId, req.session);
//     return platform.roomInRoom.listForRoom(req.session.accountId, req.params.roomId);
//   }));
async function handleList({ platform, req }) {
  await requireRoomMember(platform.store, req.params.roomId, req.session);
  return platform.roomInRoom.listForRoom(req.session.accountId, req.params.roomId);
}
//   router.post('/api/rooms/breakout/:breakoutId/join', (req, res) => json(res, () => platform.roomInRoom.join(req.session.accountId, req.params.breakoutId)));
async function handleJoin({ platform, req }) {
  return platform.roomInRoom.join(req.session.accountId, req.params.breakoutId);
}
//   router.post('/api/rooms/breakout/:breakoutId/leave', (req, res) => json(res, () => platform.roomInRoom.leave(req.session.accountId, req.params.breakoutId)));
async function handleLeave({ platform, req }) {
  return platform.roomInRoom.leave(req.session.accountId, req.params.breakoutId);
}
//   router.post('/api/rooms/breakout/:breakoutId/end', (req, res) => json(res, () => platform.roomInRoom.end(req.session.accountId, req.params.breakoutId)));
async function handleEnd({ platform, req }) {
  return platform.roomInRoom.end(req.session.accountId, req.params.breakoutId);
}

test('POST .../breakout contract: the room owner\'s session creates a breakout; hostId comes only from req.session.accountId, never a spoofed body field', async () => {
  const platform = setup();
  const room = await platform.rooms.create({ ownerId: 'acc_owner', name: 'Room' });
  const req = { session: { accountId: 'acc_owner' }, params: { roomId: room.id }, body: { name: 'Side Room', hostId: 'acc_spoofed', actorId: 'acc_spoofed' } };
  const breakout = await handleCreate({ platform, req });
  assert.equal(breakout.hostId, 'acc_owner');
  assert.notEqual(breakout.hostId, 'acc_spoofed');
  assert.equal(breakout.name, 'Side Room');
});

test('POST .../breakout contract: requireRoomOwner rejects a non-owner session BEFORE platform.roomInRoom.create is ever reached', async () => {
  const platform = setup();
  const room = await platform.rooms.create({ ownerId: 'acc_owner', name: 'Room' });
  await platform.rooms.join(room.id, 'acc_member');
  const req = { session: { accountId: 'acc_member' }, params: { roomId: room.id }, body: {} };
  await assert.rejects(
    () => handleCreate({ platform, req }),
    (err) => { assert.equal(err.status, 403); return true; }
  );
  // Confirm nothing was created despite the attempt.
  const list = await platform.roomInRoom.listForRoom('acc_owner', room.id);
  assert.equal(list.length, 0);
});

test('POST .../breakout contract: 404s for a room that does not exist, via requireRoomOwner', async () => {
  const platform = setup();
  const req = { session: { accountId: 'acc_anyone' }, params: { roomId: 'room_missing' }, body: {} };
  await assert.rejects(
    () => handleCreate({ platform, req }),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});

test('GET .../breakout contract: a real member (not just the owner) can list, via requireRoomMember', async () => {
  const platform = setup();
  const room = await platform.rooms.create({ ownerId: 'acc_owner', name: 'Room' });
  await platform.rooms.join(room.id, 'acc_member');
  await platform.roomInRoom.create('acc_owner', room.id, {});
  const req = { session: { accountId: 'acc_member' }, params: { roomId: room.id } };
  const list = await handleList({ platform, req });
  assert.equal(list.length, 1);
});

test('GET .../breakout contract: requireRoomMember rejects a stranger session with a real 403', async () => {
  const platform = setup();
  const room = await platform.rooms.create({ ownerId: 'acc_owner', name: 'Room' });
  const req = { session: { accountId: 'acc_stranger' }, params: { roomId: room.id } };
  await assert.rejects(
    () => handleList({ platform, req }),
    (err) => { assert.equal(err.status, 403); return true; }
  );
});

test('POST .../join and .../leave contract: actorId comes only from req.session.accountId, never a spoofed body field', async () => {
  const platform = setup();
  const room = await platform.rooms.create({ ownerId: 'acc_owner', name: 'Room' });
  await platform.rooms.join(room.id, 'acc_member');
  const breakout = await platform.roomInRoom.create('acc_owner', room.id, {});

  const joinReq = { session: { accountId: 'acc_member' }, params: { breakoutId: breakout.id }, body: { userId: 'acc_spoofed' } };
  const membership = await handleJoin({ platform, req: joinReq });
  assert.equal(membership.userId, 'acc_member');

  const leaveReq = { session: { accountId: 'acc_member' }, params: { breakoutId: breakout.id } };
  const left = await handleLeave({ platform, req: leaveReq });
  assert.equal(left.status, 'left');
});

test('POST .../end contract: only the real host session (never a body-claimed hostId) can end it', async () => {
  const platform = setup();
  const room = await platform.rooms.create({ ownerId: 'acc_owner', name: 'Room' });
  const breakout = await platform.roomInRoom.create('acc_owner', room.id, {});
  const spoofedReq = { session: { accountId: 'acc_intruder' }, params: { breakoutId: breakout.id }, body: { hostId: 'acc_owner' } };
  await assert.rejects(
    () => handleEnd({ platform, req: spoofedReq }),
    (err) => { assert.equal(err.status, 403); return true; }
  );
  const hostReq = { session: { accountId: 'acc_owner' }, params: { breakoutId: breakout.id } };
  const ended = await handleEnd({ platform, req: hostReq });
  assert.equal(ended.status, 'closed');
});
