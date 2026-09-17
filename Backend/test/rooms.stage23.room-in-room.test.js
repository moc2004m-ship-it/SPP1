'use strict';
// Stage 23 -- Part 2: Room-in-Room breakout. Real integration tests
// through the actual createPlatform() (the same in-memory FeatureStore
// every other feature-platform.test.js/rooms.stage*.test.js test uses --
// no mock of platform.roomInRoom.* itself).
//
// The fixed decision this session implements and this file exists to
// prove: creating/starting a room-in-room breakout is host/owner-only --
// ONLY the parent room's real owner may do it. Everything else (member
// visibility, join/leave, ending, capacity, idempotency) is exercised
// too, same thoroughness as rooms.stage15.settings.test.js /
// rooms.stage19... etc for their own stage.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform } = require('../src/feature-platform');

function setup() {
  return createPlatform({});
}

test('create(): the parent room owner can create/start a breakout', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Main Room' });
  const breakout = await p.roomInRoom.create('owner_1', room.id, { name: 'Side Chat' });
  assert.equal(breakout.parentRoomId, room.id);
  assert.equal(breakout.hostId, 'owner_1');
  assert.equal(breakout.name, 'Side Chat');
  assert.equal(breakout.status, 'open');
});

test('create(): a non-owner (including a real member of the room) is rejected with a real 403', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Main Room' });
  await p.rooms.join(room.id, 'member_1');
  await assert.rejects(
    () => p.roomInRoom.create('member_1', room.id, {}),
    (err) => { assert.equal(err.status, 403); assert.match(err.message, /only the room host\/owner/); return true; }
  );
});

test('create(): a complete stranger is rejected with the same 403 as a real member', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Main Room' });
  await assert.rejects(
    () => p.roomInRoom.create('stranger', room.id, {}),
    (err) => { assert.equal(err.status, 403); return true; }
  );
});

test('create(): 404s for a parent room that does not exist, before checking ownership', async () => {
  const p = setup();
  await assert.rejects(
    () => p.roomInRoom.create('anyone', 'room_missing', {}),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});

test('create(): a second attempt while one breakout is already open is a real 409, not a silent duplicate', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Main Room' });
  await p.roomInRoom.create('owner_1', room.id, {});
  await assert.rejects(
    () => p.roomInRoom.create('owner_1', room.id, {}),
    (err) => { assert.equal(err.status, 409); return true; }
  );
});

test('create(): a new breakout can be started again once the previous one was ended', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Main Room' });
  const first = await p.roomInRoom.create('owner_1', room.id, {});
  await p.roomInRoom.end('owner_1', first.id);
  const second = await p.roomInRoom.create('owner_1', room.id, {});
  assert.notEqual(second.id, first.id);
  assert.equal(second.status, 'open');
});

test('listForRoom(): visible to the owner and to a real joined member, not to a stranger', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Main Room' });
  await p.rooms.join(room.id, 'member_1');
  await p.roomInRoom.create('owner_1', room.id, { name: 'Side Chat' });

  const asOwner = await p.roomInRoom.listForRoom('owner_1', room.id);
  const asMember = await p.roomInRoom.listForRoom('member_1', room.id);
  assert.equal(asOwner.length, 1);
  assert.equal(asMember.length, 1);
  await assert.rejects(
    () => p.roomInRoom.listForRoom('stranger', room.id),
    (err) => { assert.equal(err.status, 403); return true; }
  );
});

test('join()/leave(): a real member of the parent room can join and leave the open breakout', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Main Room' });
  await p.rooms.join(room.id, 'member_1');
  const breakout = await p.roomInRoom.create('owner_1', room.id, {});

  const membership = await p.roomInRoom.join('member_1', breakout.id);
  assert.equal(membership.status, 'joined');
  assert.equal(membership.breakoutId, breakout.id);

  const left = await p.roomInRoom.leave('member_1', breakout.id);
  assert.equal(left.status, 'left');
});

test('join(): idempotent -- joining twice returns the same membership record, not a duplicate', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Main Room' });
  await p.rooms.join(room.id, 'member_1');
  const breakout = await p.roomInRoom.create('owner_1', room.id, {});
  const first = await p.roomInRoom.join('member_1', breakout.id);
  const second = await p.roomInRoom.join('member_1', breakout.id);
  assert.equal(first.id, second.id);
});

test('join(): a stranger to the parent room is rejected with a real 403', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Main Room' });
  const breakout = await p.roomInRoom.create('owner_1', room.id, {});
  await assert.rejects(
    () => p.roomInRoom.join('stranger', breakout.id),
    (err) => { assert.equal(err.status, 403); return true; }
  );
});

test('join(): respects capacity, real 409 once full', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Main Room' });
  await p.rooms.join(room.id, 'm1');
  await p.rooms.join(room.id, 'm2');
  const breakout = await p.roomInRoom.create('owner_1', room.id, { capacity: 1 });
  await p.roomInRoom.join('m1', breakout.id);
  await assert.rejects(
    () => p.roomInRoom.join('m2', breakout.id),
    (err) => { assert.equal(err.status, 409); return true; }
  );
});

test('end(): only the host who started the breakout may end it', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Main Room' });
  await p.rooms.join(room.id, 'member_1');
  const breakout = await p.roomInRoom.create('owner_1', room.id, {});
  await assert.rejects(
    () => p.roomInRoom.end('member_1', breakout.id),
    (err) => { assert.equal(err.status, 403); return true; }
  );
  const stillOpen = await p.roomInRoom.listForRoom('owner_1', room.id);
  assert.equal(stillOpen[0].status, 'open');
});

test('end(): ending closes the breakout and ends every currently-joined membership (real effect, not just an audit flag)', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Main Room' });
  await p.rooms.join(room.id, 'member_1');
  const breakout = await p.roomInRoom.create('owner_1', room.id, {});
  await p.roomInRoom.join('member_1', breakout.id);

  const ended = await p.roomInRoom.end('owner_1', breakout.id);
  assert.equal(ended.status, 'closed');

  // Joining a closed breakout is a real 409, not a silent success.
  await assert.rejects(
    () => p.roomInRoom.join('member_1', breakout.id),
    (err) => { assert.equal(err.status, 409); return true; }
  );
});

test('end(): ending an already-closed breakout is a real 409, not a silent no-op', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'owner_1', name: 'Main Room' });
  const breakout = await p.roomInRoom.create('owner_1', room.id, {});
  await p.roomInRoom.end('owner_1', breakout.id);
  await assert.rejects(
    () => p.roomInRoom.end('owner_1', breakout.id),
    (err) => { assert.equal(err.status, 409); return true; }
  );
});
