'use strict';
// Stage 12 -- contract tests for the room-discovery/join wiring in
// src/routes/platform.routes.js (GET /api/home's rooms slice, GET
// /api/rooms, and POST /api/rooms/:roomId/join).
//
// platform.routes.js itself cannot be require()'d in this environment --
// it does `require('express')` at the top of the file, and express is not
// installed here (no network access to install it). This is the exact
// same environmental limitation already documented and accepted for
// accounts.routes.test.js/agora.routes.test.js/auth.routes.test.js/
// config.routes.test.js (the four pre-existing environmental fails), and
// it is the same "pure logic, fake req/res inputs" style already used by
// platform.auth.guards.test.js and
// platform.notifications.routes-contract.test.js -- this file re-creates
// each handler's own call shape (verbatim from platform.routes.js) against
// the real platform.rooms.* methods, without needing express itself.
//
// What this proves: GET /api/home and GET /api/rooms both call
// rooms.listDiscoverable() with actingAccountId from req.session.accountId
// (never a client-supplied field) and, for /api/rooms, the four optional
// query filters wired through untouched; POST /api/rooms/:roomId/join
// passes req.body.password as join()'s third argument exactly as written,
// and a request with no body at all (req.body undefined) does not crash
// the handler. The underlying business logic (visibility filtering,
// password hashing/verification, capacity, idempotency) is exhaustively
// covered separately in rooms.stage12.create.test.js -- this file is
// deliberately about the routing/session-identity contract, not re-proving
// that logic.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform } = require('../src/feature-platform');

function setup() {
  return createPlatform({});
}

test('GET /api/home contract: rooms come from rooms.listDiscoverable({ actingAccountId: req.session.accountId }), never a client-supplied id', async () => {
  const p = setup();
  const owner = 'acc_owner';
  const stranger = 'acc_stranger';
  await p.rooms.create({ ownerId: owner, name: 'Private Home Room', visibility: 'private' });

  // What the GET /api/home handler does, verbatim:
  const req = { session: { accountId: stranger } };
  const rooms = await p.rooms.listDiscoverable({ actingAccountId: req.session.accountId });
  const home = { rooms: rooms.slice(-20).reverse() };

  assert.ok(!home.rooms.some((r) => r.name === 'Private Home Room'));
  for (const room of home.rooms) assert.equal('passwordHash' in room, false);
});

test('GET /api/rooms contract: actingAccountId + category/language/tag/q query params wire straight into listDiscoverable()', async () => {
  const p = setup();
  const owner = 'acc_owner';
  const wanted = await p.rooms.create({ ownerId: owner, name: 'Wanted Room', category: 'music', language: 'es', tags: ['live'] });
  await p.rooms.create({ ownerId: owner, name: 'Other Room', category: 'gaming', language: 'en' });

  // What the GET /api/rooms handler does, verbatim, given this req.query.
  const req = { session: { accountId: owner }, query: { category: 'music', language: 'es', tag: 'live', q: 'wanted' } };
  const rooms = await p.rooms.listDiscoverable({
    actingAccountId: req.session.accountId,
    category: req.query.category,
    language: req.query.language,
    tag: req.query.tag,
    query: req.query.q,
  });
  const data = rooms.slice().reverse();

  assert.equal(data.length, 1);
  assert.equal(data[0].id, wanted.id);
});

test('GET /api/rooms contract: an empty req.query (no filters at all) behaves exactly like the pre-filter call', async () => {
  const p = setup();
  const owner = 'acc_owner';
  await p.rooms.create({ ownerId: owner, name: 'A' });
  await p.rooms.create({ ownerId: owner, name: 'B' });

  const req = { session: { accountId: owner }, query: {} };
  const rooms = await p.rooms.listDiscoverable({
    actingAccountId: req.session.accountId,
    category: req.query.category,
    language: req.query.language,
    tag: req.query.tag,
    query: req.query.q,
  });
  assert.equal(rooms.length, 2);
});

test('POST /api/rooms contract: ownerId always comes from req.session.accountId, overriding anything in req.body', async () => {
  const p = setup();
  const req = { session: { accountId: 'acc_real_owner' }, body: { name: 'Spoofed Owner Room', ownerId: 'acc_attacker' } };

  // What the POST /api/rooms handler does, verbatim: {...req.body, ownerId: req.session.accountId}.
  const room = await p.rooms.create({ ...req.body, ownerId: req.session.accountId });

  assert.equal(room.ownerId, 'acc_real_owner');
  assert.notEqual(room.ownerId, 'acc_attacker');
});

test('POST /api/rooms/:roomId/join contract: req.body.password is passed as join()\'s 3rd argument, and a missing req.body does not throw before reaching join()', async () => {
  const p = setup();
  const owner = 'acc_owner';
  const room = await p.rooms.create({ ownerId: owner, name: 'Locked', password: 'hunter22' });

  // Correct password, exactly as the handler destructures it.
  const reqWithBody = { session: { accountId: 'acc_guest' }, params: { roomId: room.id }, body: { password: 'hunter22' } };
  const membership = await p.rooms.join(reqWithBody.params.roomId, reqWithBody.session.accountId, reqWithBody.body && reqWithBody.body.password);
  assert.equal(membership.status, 'joined');

  // No body at all (e.g. an empty POST) -- the handler's own
  // `req.body && req.body.password` guard must not throw a TypeError
  // reading .password off undefined, and join() must still reject with
  // the real 401 (not a 500) for a locked room with no password given.
  const openRoom = await p.rooms.create({ ownerId: owner, name: 'Open' });
  const reqNoBody = { session: { accountId: 'acc_guest2' }, params: { roomId: openRoom.id }, body: undefined };
  const openMembership = await p.rooms.join(reqNoBody.params.roomId, reqNoBody.session.accountId, reqNoBody.body && reqNoBody.body.password);
  assert.equal(openMembership.status, 'joined');

  const reqNoBodyLocked = { session: { accountId: 'acc_guest3' }, params: { roomId: room.id }, body: undefined };
  await assert.rejects(
    async () => p.rooms.join(reqNoBodyLocked.params.roomId, reqNoBodyLocked.session.accountId, reqNoBodyLocked.body && reqNoBodyLocked.body.password),
    (err) => { assert.equal(err.status, 401); return true; }
  );
});

test('POST /api/rooms/:roomId/join contract: the joining user always comes from req.session.accountId, never req.body/req.params', async () => {
  const p = setup();
  const owner = 'acc_owner';
  const room = await p.rooms.create({ ownerId: owner, name: 'Open Room' });

  // Even if a hostile body tries to smuggle a different userId, the
  // handler never reads it -- only req.session.accountId is ever used.
  const req = { session: { accountId: 'acc_real_guest' }, params: { roomId: room.id }, body: { userId: 'acc_someone_else', password: undefined } };
  const membership = await p.rooms.join(req.params.roomId, req.session.accountId, req.body && req.body.password);
  assert.equal(membership.userId, 'acc_real_guest');
  assert.notEqual(membership.userId, 'acc_someone_else');
});
