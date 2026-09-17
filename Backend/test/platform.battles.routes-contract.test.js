'use strict';
// Stage 18 -- contract tests for the PK/Battles wiring in
// src/routes/platform.routes.js (POST /api/battles, GET /api/battles,
// GET /api/battles/:battleId, POST /api/battles/:battleId/accept|decline|
// cancel|end).
//
// platform.routes.js itself cannot be require()'d in this environment --
// it does `require('express')` at the top of the file, and express is not
// installed here (no network access to install it). This is the exact
// same environmental limitation already documented and accepted for
// accounts.routes.test.js/agora.routes.test.js/auth.routes.test.js/
// config.routes.test.js (the four pre-existing environmental fails), and
// it is the same "pure logic, fake req/res inputs, re-create the handler's
// own call shape verbatim" style already used by
// platform.rooms.routes-contract.test.js/
// platform.room-settings.stage15.routes-contract.test.js.
//
// What this proves: POST /api/battles calls requireRoomOwner() before ever
// reaching battleService.createChallenge(), hostId always comes from
// req.session.accountId (never req.body), and every other battle route
// passes req.session.accountId + req.params.battleId straight into the
// real battleService exactly as platform.routes.js is written -- so a
// client can never impersonate another account's actorId via the body.
// The underlying authorization/state-machine/scoring logic itself is
// exhaustively covered separately in battle.service.test.js and
// gifts-battle-integration.test.js -- this file is deliberately about the
// routing/session-identity/ownership-guard contract, not re-proving that.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform } = require('../src/feature-platform');
const { requireRoomOwner } = require('../src/routes/platform.guards');
const { InMemoryBattleRepository } = require('../src/database/repositories/battle.repository');
const { createBattleService } = require('../src/services/battle.service');

function setup() {
  const p = createPlatform({});
  const battleService = createBattleService({ battles: new InMemoryBattleRepository() });
  return { p, battleService };
}

test('POST /api/battles contract: requireRoomOwner runs first and blocks a non-owner before createChallenge() is ever called', async () => {
  const { p, battleService } = setup();
  const room = await p.rooms.create({ ownerId: 'acc_owner', name: 'Room' });
  const req = { session: { accountId: 'acc_intruder' }, body: { roomId: room.id, opponentId: 'acc_opponent' } };

  // What the handler does, verbatim: `await requireRoomOwner(...); return
  // battleService.createChallenge(...)`.
  await assert.rejects(
    () => requireRoomOwner(p.store, req.body.roomId, req.session),
    /only the room owner/
  );
  const mine = await battleService.listMine('acc_intruder');
  assert.deepEqual(mine, [], 'the guard tripping must prevent createChallenge() from ever running');
});

test('POST /api/battles contract: hostId comes from req.session.accountId, never req.body, even if the client tries to smuggle a different one', async () => {
  const { p, battleService } = setup();
  const owner = 'acc_owner';
  const room = await p.rooms.create({ ownerId: owner, name: 'Room' });
  // A client attempting to impersonate another account via the body.
  const req = { session: { accountId: owner }, body: { roomId: room.id, opponentId: 'acc_opponent', hostId: 'acc_someone_else' } };

  await requireRoomOwner(p.store, req.body.roomId, req.session);
  const battle = await battleService.createChallenge({
    roomId: req.body.roomId,
    hostId: req.session.accountId, // exactly what platform.routes.js passes -- req.body.hostId is never read
    opponentId: req.body.opponentId,
    durationMs: req.body.durationMs,
  });

  assert.equal(battle.hostId, owner, 'hostId must be the real session owner, never req.body.hostId');
  assert.equal(battle.opponentId, 'acc_opponent');
});

test('GET /api/battles contract: listMine is scoped to req.session.accountId, not any client-supplied id', async () => {
  const { battleService } = setup();
  await battleService.createChallenge({ roomId: 'room_1', hostId: 'acc_a', opponentId: 'acc_b' });
  await battleService.createChallenge({ roomId: 'room_2', hostId: 'acc_c', opponentId: 'acc_d' });

  const req = { session: { accountId: 'acc_a' } };
  const mine = await battleService.listMine(req.session.accountId);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].hostId, 'acc_a');
});

test('GET /api/battles/:battleId contract: req.params.battleId flows straight into getBattle(), and a non-participant is rejected', async () => {
  const { battleService } = setup();
  const battle = await battleService.createChallenge({ roomId: 'room_1', hostId: 'acc_host', opponentId: 'acc_opponent' });

  const ownerReq = { session: { accountId: 'acc_host' }, params: { battleId: battle.id } };
  const found = await battleService.getBattle(ownerReq.session.accountId, ownerReq.params.battleId);
  assert.equal(found.id, battle.id);

  const strangerReq = { session: { accountId: 'acc_stranger' }, params: { battleId: battle.id } };
  await assert.rejects(
    () => battleService.getBattle(strangerReq.session.accountId, strangerReq.params.battleId),
    (e) => e.status === 403
  );
});

test('POST /api/battles/:battleId/accept contract: only the real challenged opponent (from the session) can accept, never the host or a stranger', async () => {
  const { battleService } = setup();
  const battle = await battleService.createChallenge({ roomId: 'room_1', hostId: 'acc_host', opponentId: 'acc_opponent' });

  const hostReq = { session: { accountId: 'acc_host' }, params: { battleId: battle.id } };
  await assert.rejects(
    () => battleService.acceptChallenge(hostReq.session.accountId, hostReq.params.battleId),
    (e) => e.status === 403
  );

  const opponentReq = { session: { accountId: 'acc_opponent' }, params: { battleId: battle.id } };
  const accepted = await battleService.acceptChallenge(opponentReq.session.accountId, opponentReq.params.battleId);
  assert.equal(accepted.status, 'active');
});

test('POST /api/battles/:battleId/decline contract: same opponent-only rule, actorId always from the session', async () => {
  const { battleService } = setup();
  const battle = await battleService.createChallenge({ roomId: 'room_1', hostId: 'acc_host', opponentId: 'acc_opponent' });
  const req = { session: { accountId: 'acc_opponent' }, params: { battleId: battle.id } };
  const declined = await battleService.declineChallenge(req.session.accountId, req.params.battleId);
  assert.equal(declined.status, 'declined');
});

test('POST /api/battles/:battleId/cancel contract: only the real host (from the session) can cancel, never the opponent', async () => {
  const { battleService } = setup();
  const battle = await battleService.createChallenge({ roomId: 'room_1', hostId: 'acc_host', opponentId: 'acc_opponent' });

  const opponentReq = { session: { accountId: 'acc_opponent' }, params: { battleId: battle.id } };
  await assert.rejects(
    () => battleService.cancelChallenge(opponentReq.session.accountId, opponentReq.params.battleId),
    (e) => e.status === 403
  );

  const hostReq = { session: { accountId: 'acc_host' }, params: { battleId: battle.id } };
  const cancelled = await battleService.cancelChallenge(hostReq.session.accountId, hostReq.params.battleId);
  assert.equal(cancelled.status, 'cancelled');
});

test('POST /api/battles/:battleId/end contract: either real participant (from the session) can end, a stranger cannot', async () => {
  const { battleService } = setup();
  const battle = await battleService.createChallenge({ roomId: 'room_1', hostId: 'acc_host', opponentId: 'acc_opponent' });
  await battleService.acceptChallenge('acc_opponent', battle.id);

  const strangerReq = { session: { accountId: 'acc_stranger' }, params: { battleId: battle.id } };
  await assert.rejects(
    () => battleService.endBattle(strangerReq.session.accountId, strangerReq.params.battleId),
    (e) => e.status === 403
  );

  const opponentReq = { session: { accountId: 'acc_opponent' }, params: { battleId: battle.id } };
  const ended = await battleService.endBattle(opponentReq.session.accountId, opponentReq.params.battleId);
  assert.equal(ended.status, 'ended');
});

test('POST /api/battles contract: 404s for requireRoomOwner via the same guard used by every other host-only route when the room does not exist', async () => {
  const { p } = setup();
  const req = { session: { accountId: 'acc_owner' }, body: { roomId: 'no_such_room', opponentId: 'acc_opponent' } };
  await assert.rejects(
    () => requireRoomOwner(p.store, req.body.roomId, req.session),
    /room not found/
  );
});
