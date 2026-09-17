'use strict';
// Stage 26 -- Gift Wall route authorization. Dependency-free (no express),
// same pattern/rationale as test/platform.auth.guards.test.js: proves the
// actual guard composition platform.routes.js uses for
// POST /api/gifts/wall/:roomId/close (requireRoomOwner, reading the REAL
// room owner from platform.store -- never a client-claimed host) without
// needing express installed.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform } = require('../src/feature-platform');
const { requireRoomOwner } = require('../src/routes/platform.guards');
const { InMemoryGiftWallRepository } = require('../src/database/repositories/gift-wall.repository');
const { createGiftWallService } = require('../src/services/gift-wall.service');

async function setup() {
  const platform = createPlatform();
  const giftWall = new InMemoryGiftWallRepository();
  const giftWallService = createGiftWallService({ giftWall });
  const room = await platform.rooms.create({ ownerId: 'host_1', name: 'Test Room' });
  return { platform, giftWallService, room };
}

// The exact composition platform.routes.js's close route performs:
// `await requireRoomOwner(platform.store, roomId, req.session); return
// giftWallService.closeSession(roomId);` -- reproduced here directly so the
// real authorization decision is exercised, not a re-implementation of it.
async function attemptClose({ platform, giftWallService, roomId, session }) {
  await requireRoomOwner(platform.store, roomId, session);
  return giftWallService.closeSession(roomId);
}

test('the real room host CAN close the gift wall session for their own room', async () => {
  const { platform, giftWallService, room } = await setup();
  await giftWallService.recordContribution({ roomId: room.id, gifterId: 'usr_a', giftId: 'g1', amount: 10 });

  const result = await attemptClose({ platform, giftWallService, roomId: room.id, session: { accountId: 'host_1' } });
  assert.equal(result.status, 'closed');
});

test('a non-host account CANNOT close another room\'s gift wall session', async () => {
  const { platform, giftWallService, room } = await setup();
  await giftWallService.recordContribution({ roomId: room.id, gifterId: 'usr_a', giftId: 'g1', amount: 10 });

  await assert.rejects(
    () => attemptClose({ platform, giftWallService, roomId: room.id, session: { accountId: 'not_the_host' } }),
    (e) => e.status === 403
  );

  // The unauthorized attempt must not have actually closed anything --
  // the real state (never a client claim) decides this.
  const wall = await giftWallService.getWall(room.id);
  assert.equal(wall.status, 'active', 'a rejected close attempt must leave the real wall state untouched');
});

test('an unauthenticated request (no session) cannot close a gift wall session', async () => {
  const { platform, giftWallService, room } = await setup();
  await assert.rejects(
    () => attemptClose({ platform, giftWallService, roomId: room.id, session: null }),
    (e) => e.status === 403
  );
});

test('closing a room that does not exist is rejected before ever reaching the gift wall service', async () => {
  const { platform, giftWallService } = await setup();
  await assert.rejects(
    () => attemptClose({ platform, giftWallService, roomId: 'room_does_not_exist', session: { accountId: 'host_1' } }),
    (e) => e.status === 404
  );
});

test('a client-supplied "I am the host" claim is ignored -- authorization is always the real stored room.ownerId', async () => {
  const { platform, giftWallService, room } = await setup();
  // Even if a malicious client sends its own accountId claiming to be the
  // host, requireRoomOwner only trusts platform.store's real room record.
  await assert.rejects(
    () => attemptClose({ platform, giftWallService, roomId: room.id, session: { accountId: 'host_1_impersonator' } }),
    (e) => e.status === 403
  );
});
