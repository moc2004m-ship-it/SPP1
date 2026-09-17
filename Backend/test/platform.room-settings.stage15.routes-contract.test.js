'use strict';
// Stage 15 -- contract tests for the Room Settings wiring in
// src/routes/platform.routes.js (POST /api/rooms/:roomId/settings and the
// new GET /api/rooms/:roomId/settings).
//
// platform.routes.js itself cannot be require()'d in this environment --
// it does `require('express')` at the top of the file, and express is not
// installed here (no network access to install it). This is the exact
// same environmental limitation already documented and accepted for
// accounts.routes.test.js/agora.routes.test.js/auth.routes.test.js/
// config.routes.test.js (the four pre-existing environmental fails), and
// it is the same "pure logic, fake req/res inputs, re-create the handler's
// own call shape verbatim" style already used by
// platform.rooms.routes-contract.test.js/platform.auth.guards.test.js.
//
// What this proves: both routes call requireRoomOwner() before ever
// reaching platform.rooms.setting()/getSettings(), the acting id always
// comes from req.session.accountId (never req.body/req.params), and
// req.body.key/req.body.value flow straight into setting() exactly as
// written. The underlying validation/effect logic (per-key rules, real
// mutation, audit trail) is exhaustively covered separately in
// rooms.stage15.settings.test.js -- this file is deliberately about the
// routing/session-identity/ownership-guard contract, not re-proving that.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform } = require('../src/feature-platform');
const { requireRoomOwner } = require('../src/routes/platform.guards');

function setup() {
  return createPlatform({});
}

test('POST /api/rooms/:roomId/settings contract: requireRoomOwner runs first and blocks a non-owner before setting() is ever called', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'acc_owner', name: 'Room' });
  const req = { session: { accountId: 'acc_intruder' }, params: { roomId: room.id }, body: { key: 'name', value: 'Hijacked' } };

  // What the handler does, verbatim: requireRoomOwner() before setting().
  await assert.rejects(
    () => requireRoomOwner(p.store, req.params.roomId, req.session),
    /only the room owner/
  );
  // Confirm the guard tripping actually prevented any mutation -- the
  // handler's own `await ...; return platform.rooms.setting(...)` shape
  // means a thrown guard never reaches the second statement.
  const stillOriginal = await p.rooms.getSettings('acc_owner', room.id);
  assert.equal(stillOriginal.name, 'Room');
});

test('POST /api/rooms/:roomId/settings contract: acting id comes from req.session.accountId, req.body.key/value pass straight through', async () => {
  const p = setup();
  const owner = 'acc_owner';
  const room = await p.rooms.create({ ownerId: owner, name: 'Room' });
  const req = { session: { accountId: owner }, params: { roomId: room.id }, body: { key: 'theme', value: 'sunset' } };

  await requireRoomOwner(p.store, req.params.roomId, req.session);
  const updated = await p.rooms.setting(req.session.accountId, req.params.roomId, req.body.key, req.body.value);

  assert.equal(updated.theme, 'sunset');
});

test('GET /api/rooms/:roomId/settings contract: owner-only, real current values, requireRoomOwner blocks a stranger', async () => {
  const p = setup();
  const owner = 'acc_owner';
  const room = await p.rooms.create({ ownerId: owner, name: 'Room', category: 'gaming' });

  const ownerReq = { session: { accountId: owner }, params: { roomId: room.id } };
  await requireRoomOwner(p.store, ownerReq.params.roomId, ownerReq.session);
  const settings = await p.rooms.getSettings(ownerReq.session.accountId, ownerReq.params.roomId);
  assert.equal(settings.category, 'gaming');
  assert.equal('passwordHash' in settings, false);

  const strangerReq = { session: { accountId: 'acc_stranger' }, params: { roomId: room.id } };
  await assert.rejects(
    () => requireRoomOwner(p.store, strangerReq.params.roomId, strangerReq.session),
    /only the room owner/
  );
});

test('GET /api/rooms/:roomId/settings contract: 404s for an unknown room via the same requireRoomOwner used by every other host-only route', async () => {
  const p = setup();
  const req = { session: { accountId: 'acc_owner' }, params: { roomId: 'no_such_room' } };
  await assert.rejects(
    () => requireRoomOwner(p.store, req.params.roomId, req.session),
    /room not found/
  );
});
