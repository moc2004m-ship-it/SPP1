'use strict';
// Stage 17 -- Music/DJ. Contract tests for the music route handlers in
// src/routes/platform.routes.js:
//   POST /api/rooms/:roomId/music/dj             -> platform.music.grantDJ(req.session.accountId, req.params.roomId, req.body.targetId)
//   POST /api/rooms/:roomId/music/dj/revoke       -> platform.music.revokeDJ(req.session.accountId, req.params.roomId, req.body.targetId)
//   GET  /api/rooms/:roomId/music/dj              -> platform.music.listDJs(req.session.accountId, req.params.roomId)
//   POST /api/rooms/:roomId/music/queue           -> platform.music.queueAdd(req.session.accountId, req.params.roomId, {title,url,durationSec})
//   GET  /api/rooms/:roomId/music/queue           -> platform.music.queueList(req.session.accountId, req.params.roomId)
//   POST /api/rooms/:roomId/music/queue/:trackId/remove -> platform.music.queueRemove(req.session.accountId, req.params.roomId, req.params.trackId)
//   POST /api/rooms/:roomId/music/queue/reorder   -> platform.music.queueReorder(req.session.accountId, req.params.roomId, req.body.trackId, req.body.position)
//   POST /api/rooms/:roomId/music/play            -> platform.music.play(req.session.accountId, req.params.roomId, req.body.trackId)
//   POST /api/rooms/:roomId/music/pause           -> platform.music.pause(req.session.accountId, req.params.roomId)
//   POST /api/rooms/:roomId/music/next            -> platform.music.next(req.session.accountId, req.params.roomId)
//   POST /api/rooms/:roomId/music/volume          -> platform.music.setVolume(req.session.accountId, req.params.roomId, req.body.volume)
//   GET  /api/rooms/:roomId/music/state           -> platform.music.getState(req.session.accountId, req.params.roomId)
//
// Same "pure logic, fake req/res, reproduce the handler's own call shape
// verbatim" style already used by platform.mute.routes-contract.test.js /
// platform.block.routes-contract.test.js -- platform.routes.js itself
// cannot be require()'d in this environment (requires 'express', not
// installed here; same environmental blocker as every prior stage).
//
// What this proves: the acting user for every one of these routes comes
// ONLY from req.session.accountId -- a client-supplied body.userId/
// accountId is never trusted, only ever used as the *target* of an
// action (grantDJ/revokeDJ's targetId). roomId always comes from
// req.params, never from the body. The underlying business rules
// (authorization, idempotency, queue/playback state machine) are
// exhaustively covered separately in music.stage17.test.js -- this file
// is deliberately about the routing/param/session-identity contract,
// not re-proving that logic.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform, FeatureStore } = require('../src/feature-platform');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');

function setup() {
  const platform = createPlatform({ store: new FeatureStore(new InMemoryFeatureRecordRepository()) });
  return { platform };
}

async function makeRoom(p, ownerId = 'usr_owner') {
  return p.rooms.create({ ownerId, name: 'Music Room' });
}

const TRACK_BODY = { title: 'Track', url: 'https://example.com/t.mp3', durationSec: 100 };

// Reproduces platform.routes.js's handlers exactly (see header above for
// each route's real line).
const handlers = {
  grantDJ: ({ platform, req }) => platform.music.grantDJ(req.session.accountId, req.params.roomId, req.body.targetId),
  revokeDJ: ({ platform, req }) => platform.music.revokeDJ(req.session.accountId, req.params.roomId, req.body.targetId),
  listDJs: ({ platform, req }) => platform.music.listDJs(req.session.accountId, req.params.roomId),
  queueAdd: ({ platform, req }) => platform.music.queueAdd(req.session.accountId, req.params.roomId, { title: req.body?.title, url: req.body?.url, durationSec: req.body?.durationSec }),
  queueList: ({ platform, req }) => platform.music.queueList(req.session.accountId, req.params.roomId),
  queueRemove: ({ platform, req }) => platform.music.queueRemove(req.session.accountId, req.params.roomId, req.params.trackId),
  queueReorder: ({ platform, req }) => platform.music.queueReorder(req.session.accountId, req.params.roomId, req.body?.trackId, req.body?.position),
  play: ({ platform, req }) => platform.music.play(req.session.accountId, req.params.roomId, req.body?.trackId),
  pause: ({ platform, req }) => platform.music.pause(req.session.accountId, req.params.roomId),
  next: ({ platform, req }) => platform.music.next(req.session.accountId, req.params.roomId),
  setVolume: ({ platform, req }) => platform.music.setVolume(req.session.accountId, req.params.roomId, req.body?.volume),
  getState: ({ platform, req }) => platform.music.getState(req.session.accountId, req.params.roomId),
};

// ---------------------------------------------------------------------
// POST /api/rooms/:roomId/music/dj
// ---------------------------------------------------------------------

test('POST .../music/dj contract: the acting (owner) user comes only from req.session.accountId, never a spoofed body field', async () => {
  const { platform } = setup();
  const room = await makeRoom(platform);
  await platform.rooms.join(room.id, 'usr_member');
  const req = {
    session: { accountId: 'usr_owner' },
    params: { roomId: room.id },
    body: { targetId: 'usr_member', accountId: 'usr_spoofed', actorId: 'usr_spoofed' },
  };
  const record = await handlers.grantDJ({ platform, req });
  assert.equal(record.userId, 'usr_member');
  assert.equal(record.status, 'active');
});

test('POST .../music/dj contract: roomId comes only from req.params, never from the body', async () => {
  const { platform } = setup();
  const roomA = await makeRoom(platform, 'usr_owner');
  const roomB = await makeRoom(platform, 'usr_owner_b');
  await platform.rooms.join(roomA.id, 'usr_member');
  const req = {
    session: { accountId: 'usr_owner' },
    params: { roomId: roomA.id },
    body: { targetId: 'usr_member', roomId: roomB.id },
  };
  const record = await handlers.grantDJ({ platform, req });
  assert.equal(record.roomId, roomA.id);
});

test('POST .../music/dj contract: a spoofed session cannot grant DJ in a room it does not own', async () => {
  const { platform } = setup();
  const room = await makeRoom(platform, 'usr_owner');
  await platform.rooms.join(room.id, 'usr_member');
  const req = { session: { accountId: 'usr_attacker' }, params: { roomId: room.id }, body: { targetId: 'usr_member' } };
  await assert.rejects(
    () => handlers.grantDJ({ platform, req }),
    (e) => { assert.equal(e.status, 403); return true; },
  );
});

// ---------------------------------------------------------------------
// POST /api/rooms/:roomId/music/dj/revoke
// ---------------------------------------------------------------------

test('POST .../music/dj/revoke contract: the acting user comes only from req.session.accountId', async () => {
  const { platform } = setup();
  const room = await makeRoom(platform);
  await platform.rooms.join(room.id, 'usr_member');
  await handlers.grantDJ({ platform, req: { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: { targetId: 'usr_member' } } });
  const req = { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: { targetId: 'usr_member', accountId: 'usr_spoofed' } };
  const record = await handlers.revokeDJ({ platform, req });
  assert.equal(record.status, 'revoked');
});

test('POST .../music/dj/revoke contract: a non-owner session cannot revoke another account\'s DJ status', async () => {
  const { platform } = setup();
  const room = await makeRoom(platform);
  await platform.rooms.join(room.id, 'usr_member');
  await handlers.grantDJ({ platform, req: { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: { targetId: 'usr_member' } } });
  const req = { session: { accountId: 'usr_member' }, params: { roomId: room.id }, body: { targetId: 'usr_member' } };
  await assert.rejects(
    () => handlers.revokeDJ({ platform, req }),
    (e) => { assert.equal(e.status, 403); return true; },
  );
});

// ---------------------------------------------------------------------
// GET /api/rooms/:roomId/music/dj
// ---------------------------------------------------------------------

test('GET .../music/dj contract: the viewing user comes only from req.session.accountId', async () => {
  const { platform } = setup();
  const room = await makeRoom(platform);
  await platform.rooms.join(room.id, 'usr_member');
  await handlers.grantDJ({ platform, req: { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: { targetId: 'usr_member' } } });
  const req = { session: { accountId: 'usr_member' }, params: { roomId: room.id } };
  const list = await handlers.listDJs({ platform, req });
  assert.equal(list.length, 1);
  assert.equal(list[0].userId, 'usr_member');
});

test('GET .../music/dj contract: a stranger session (not a member) is rejected with 403', async () => {
  const { platform } = setup();
  const room = await makeRoom(platform);
  const req = { session: { accountId: 'usr_stranger' }, params: { roomId: room.id } };
  await assert.rejects(
    () => handlers.listDJs({ platform, req }),
    (e) => { assert.equal(e.status, 403); return true; },
  );
});

// ---------------------------------------------------------------------
// POST /api/rooms/:roomId/music/queue
// ---------------------------------------------------------------------

test('POST .../music/queue contract: the requesting user comes only from req.session.accountId, tagged as requestedBy', async () => {
  const { platform } = setup();
  const room = await makeRoom(platform);
  const req = { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: { ...TRACK_BODY, requestedBy: 'usr_spoofed' } };
  const track = await handlers.queueAdd({ platform, req });
  assert.equal(track.requestedBy, 'usr_owner');
});

test('POST .../music/queue contract: only title/url/durationSec are read from req.body -- extra fields are ignored, not persisted verbatim', async () => {
  const { platform } = setup();
  const room = await makeRoom(platform);
  const req = { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: { ...TRACK_BODY, status: 'playing', position: 999 } };
  const track = await handlers.queueAdd({ platform, req });
  assert.equal(track.status, 'queued');
  assert.equal(track.position, 0);
});

test('POST .../music/queue contract: a missing title is rejected with 400', async () => {
  const { platform } = setup();
  const room = await makeRoom(platform);
  const req = { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: { url: TRACK_BODY.url } };
  await assert.rejects(
    () => handlers.queueAdd({ platform, req }),
    (e) => { assert.equal(e.status, 400); return true; },
  );
});

// ---------------------------------------------------------------------
// GET /api/rooms/:roomId/music/queue
// ---------------------------------------------------------------------

test('GET .../music/queue contract: roomId comes from req.params', async () => {
  const { platform } = setup();
  const roomA = await makeRoom(platform, 'usr_owner_a');
  const roomB = await makeRoom(platform, 'usr_owner_b');
  await handlers.queueAdd({ platform, req: { session: { accountId: 'usr_owner_a' }, params: { roomId: roomA.id }, body: { ...TRACK_BODY, title: 'Only A' } } });
  const req = { session: { accountId: 'usr_owner_b' }, params: { roomId: roomB.id } };
  const queue = await handlers.queueList({ platform, req });
  assert.deepEqual(queue, []);
});

// ---------------------------------------------------------------------
// POST /api/rooms/:roomId/music/queue/:trackId/remove
// ---------------------------------------------------------------------

test('POST .../music/queue/:trackId/remove contract: trackId comes from req.params, actor from session', async () => {
  const { platform } = setup();
  const room = await makeRoom(platform);
  const track = await handlers.queueAdd({ platform, req: { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: TRACK_BODY } });
  const req = { session: { accountId: 'usr_owner' }, params: { roomId: room.id, trackId: track.id }, body: {} };
  const removed = await handlers.queueRemove({ platform, req });
  assert.equal(removed.status, 'removed');
});

test('POST .../music/queue/:trackId/remove contract: a spoofed body.trackId is ignored -- only req.params.trackId is used', async () => {
  const { platform } = setup();
  const room = await makeRoom(platform);
  const real = await handlers.queueAdd({ platform, req: { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: { ...TRACK_BODY, title: 'Real' } } });
  const decoy = await handlers.queueAdd({ platform, req: { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: { ...TRACK_BODY, title: 'Decoy' } } });
  const req = { session: { accountId: 'usr_owner' }, params: { roomId: room.id, trackId: real.id }, body: { trackId: decoy.id } };
  const removed = await handlers.queueRemove({ platform, req });
  assert.equal(removed.id, real.id);
});

// ---------------------------------------------------------------------
// POST /api/rooms/:roomId/music/queue/reorder
// ---------------------------------------------------------------------

test('POST .../music/queue/reorder contract: trackId and position come from req.body, DJ-gated', async () => {
  const { platform } = setup();
  const room = await makeRoom(platform);
  const a = await handlers.queueAdd({ platform, req: { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: { ...TRACK_BODY, title: 'A' } } });
  await handlers.queueAdd({ platform, req: { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: { ...TRACK_BODY, title: 'B' } } });
  const req = { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: { trackId: a.id, position: 1 } };
  const reordered = await handlers.queueReorder({ platform, req });
  assert.equal(reordered.find(t => t.id === a.id).position, 1);
});

test('POST .../music/queue/reorder contract: a non-DJ session is rejected with 403', async () => {
  const { platform } = setup();
  const room = await makeRoom(platform);
  await platform.rooms.join(room.id, 'usr_member');
  const track = await handlers.queueAdd({ platform, req: { session: { accountId: 'usr_member' }, params: { roomId: room.id }, body: TRACK_BODY } });
  const req = { session: { accountId: 'usr_member' }, params: { roomId: room.id }, body: { trackId: track.id, position: 0 } };
  await assert.rejects(
    () => handlers.queueReorder({ platform, req }),
    (e) => { assert.equal(e.status, 403); return true; },
  );
});

// ---------------------------------------------------------------------
// POST /api/rooms/:roomId/music/play, pause, next
// ---------------------------------------------------------------------

test('POST .../music/play contract: trackId is optional and comes from req.body, actor is DJ-gated via session', async () => {
  const { platform } = setup();
  const room = await makeRoom(platform);
  const track = await handlers.queueAdd({ platform, req: { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: TRACK_BODY } });
  const req = { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: { trackId: track.id } };
  const state = await handlers.play({ platform, req });
  assert.equal(state.currentTrackId, track.id);
});

test('POST .../music/play contract: a plain-member session is rejected with 403', async () => {
  const { platform } = setup();
  const room = await makeRoom(platform);
  await platform.rooms.join(room.id, 'usr_member');
  await handlers.queueAdd({ platform, req: { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: TRACK_BODY } });
  const req = { session: { accountId: 'usr_member' }, params: { roomId: room.id }, body: {} };
  await assert.rejects(
    () => handlers.play({ platform, req }),
    (e) => { assert.equal(e.status, 403); return true; },
  );
});

test('POST .../music/pause contract: takes no body fields, session-gated', async () => {
  const { platform } = setup();
  const room = await makeRoom(platform);
  await handlers.queueAdd({ platform, req: { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: TRACK_BODY } });
  await handlers.play({ platform, req: { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: {} } });
  const state = await handlers.pause({ platform, req: { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: {} } });
  assert.equal(state.status, 'paused');
});

test('POST .../music/next contract: session-gated, auto-advances', async () => {
  const { platform } = setup();
  const room = await makeRoom(platform);
  const a = await handlers.queueAdd({ platform, req: { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: { ...TRACK_BODY, title: 'A' } } });
  const b = await handlers.queueAdd({ platform, req: { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: { ...TRACK_BODY, title: 'B' } } });
  await handlers.play({ platform, req: { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: { trackId: a.id } } });
  const state = await handlers.next({ platform, req: { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: {} } });
  assert.equal(state.currentTrackId, b.id);
});

// ---------------------------------------------------------------------
// POST /api/rooms/:roomId/music/volume
// ---------------------------------------------------------------------

test('POST .../music/volume contract: volume comes from req.body, DJ-gated via session', async () => {
  const { platform } = setup();
  const room = await makeRoom(platform);
  const req = { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: { volume: 25 } };
  const state = await handlers.setVolume({ platform, req });
  assert.equal(state.volume, 25);
});

test('POST .../music/volume contract: a non-DJ session is rejected with 403', async () => {
  const { platform } = setup();
  const room = await makeRoom(platform);
  await platform.rooms.join(room.id, 'usr_member');
  const req = { session: { accountId: 'usr_member' }, params: { roomId: room.id }, body: { volume: 25 } };
  await assert.rejects(
    () => handlers.setVolume({ platform, req }),
    (e) => { assert.equal(e.status, 403); return true; },
  );
});

// ---------------------------------------------------------------------
// GET /api/rooms/:roomId/music/state
// ---------------------------------------------------------------------

test('GET .../music/state contract: returns the real merged player+queue state for the room in req.params', async () => {
  const { platform } = setup();
  const room = await makeRoom(platform);
  await handlers.queueAdd({ platform, req: { session: { accountId: 'usr_owner' }, params: { roomId: room.id }, body: TRACK_BODY } });
  const req = { session: { accountId: 'usr_owner' }, params: { roomId: room.id } };
  const state = await handlers.getState({ platform, req });
  assert.equal(state.queue.length, 1);
  assert.equal(state.status, 'stopped');
});

test('GET .../music/state contract: a stranger session (not a member) is rejected with 403', async () => {
  const { platform } = setup();
  const room = await makeRoom(platform);
  const req = { session: { accountId: 'usr_stranger' }, params: { roomId: room.id } };
  await assert.rejects(
    () => handlers.getState({ platform, req }),
    (e) => { assert.equal(e.status, 403); return true; },
  );
});
