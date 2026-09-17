'use strict';
// Stage 35 Part 3/8 -- Mute. Contract tests for the two Mute handlers in
// src/routes/platform.routes.js:
//   POST /api/mute   -> platform.social.muteUser(req.session.accountId, req.body.targetId)
//   POST /api/unmute -> platform.social.unmuteUser(req.session.accountId, req.body.targetId)
//
// Deliberately NOT the same route as the pre-existing
// POST /api/social/:relationId/mute (Stage 10, relation-scoped, unrelated
// -- see platform.social.muteUser()'s header comment in
// feature-platform.js for the full audit note on why the two coexist
// under different names). Same "pure logic, fake req/res, reproduce the
// handler's own call shape verbatim" style already used by
// platform.block.routes-contract.test.js / platform.referral.routes-
// contract.test.js -- platform.routes.js itself cannot be require()'d in
// this environment (requires 'express', not installed here; same
// environmental blocker as every prior stage).
//
// What this proves: the acting/muting user for both routes comes ONLY
// from req.session.accountId -- a client-supplied body.userId/accountId
// is never trusted, only ever used as the *target* of the action. The
// underlying business rules (idempotent mute, unmute 404 when nothing
// active, one user's unmute never touching another user's mute, self-mute
// unrestricted, mute never touching allowed()) are exhaustively covered
// separately in feature-platform.test.js -- this file is deliberately
// about the routing/session-identity contract, not re-proving that logic.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform, FeatureStore } = require('../src/feature-platform');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');

function setup() {
  const platform = createPlatform({ store: new FeatureStore(new InMemoryFeatureRecordRepository()) });
  return { platform };
}

// Reproduces platform.routes.js's handler exactly:
//   router.post('/api/mute', (req, res) => json(res, () => platform.social.muteUser(req.session.accountId, req.body.targetId)));
async function handleMute({ platform, req }) {
  return platform.social.muteUser(req.session.accountId, req.body.targetId);
}
// Reproduces platform.routes.js's handler exactly:
//   router.post('/api/unmute', (req, res) => json(res, () => platform.social.unmuteUser(req.session.accountId, req.body.targetId)));
async function handleUnmute({ platform, req }) {
  return platform.social.unmuteUser(req.session.accountId, req.body.targetId);
}

test('POST /api/mute contract: the muting user comes only from req.session.accountId, never a body-claimed id', async () => {
  const { platform } = setup();
  const req = { session: { accountId: 'acc_real' }, body: { targetId: 'acc_target', userId: 'acc_spoofed', accountId: 'acc_spoofed' } };
  const record = await handleMute({ platform, req });
  assert.equal(record.userId, 'acc_real');
  assert.notEqual(record.userId, 'acc_spoofed');
  assert.equal(record.targetId, 'acc_target');
  assert.equal(record.status, 'active');
  assert.equal(record.type, 'mute');
});

test('POST /api/mute contract: targetId comes from req.body', async () => {
  const { platform } = setup();
  const req = { session: { accountId: 'acc_real' }, body: { targetId: 'acc_target' } };
  const record = await handleMute({ platform, req });
  assert.equal(record.targetId, 'acc_target');
});

test('POST /api/mute contract: a missing targetId is rejected', async () => {
  const { platform } = setup();
  await assert.rejects(() => handleMute({ platform, req: { session: { accountId: 'acc_real' }, body: {} } }), /targetId/);
});

test('POST /api/mute contract: calling it twice for the same target is idempotent (deterministic duplicate handling)', async () => {
  const { platform } = setup();
  const req = { session: { accountId: 'acc_real' }, body: { targetId: 'acc_target' } };
  const first = await handleMute({ platform, req });
  const second = await handleMute({ platform, req });
  assert.equal(first.id, second.id);
});

test('POST /api/unmute contract: the unmuting user comes only from req.session.accountId, never a body-claimed id', async () => {
  const { platform } = setup();
  await handleMute({ platform, req: { session: { accountId: 'acc_real' }, body: { targetId: 'acc_target' } } });
  const req = { session: { accountId: 'acc_real' }, body: { targetId: 'acc_target', userId: 'acc_spoofed' } };
  const record = await handleUnmute({ platform, req });
  assert.equal(record.userId, 'acc_real');
  assert.equal(record.status, 'removed');
});

test('POST /api/unmute contract: a spoofed session cannot remove another account\'s mute', async () => {
  const { platform } = setup();
  // acc_victim muted acc_target for real reasons; a different, unrelated
  // caller (acc_attacker) tries to undo it by claiming the same targetId.
  await handleMute({ platform, req: { session: { accountId: 'acc_victim' }, body: { targetId: 'acc_target' } } });
  await assert.rejects(
    () => handleUnmute({ platform, req: { session: { accountId: 'acc_attacker' }, body: { targetId: 'acc_target' } } }),
    (err) => { assert.equal(err.status, 404); return true; },
  );
  // acc_victim's own mute is untouched by acc_attacker's failed attempt.
  const stillMuted = await platform.social.isUserMuted('acc_victim', 'acc_target');
  assert.equal(stillMuted, true);
});

test('POST /api/unmute contract: unmuting with nothing active is a 404', async () => {
  const { platform } = setup();
  await assert.rejects(
    () => handleUnmute({ platform, req: { session: { accountId: 'acc_real' }, body: { targetId: 'acc_target' } } }),
    (err) => { assert.equal(err.status, 404); return true; },
  );
});

test('mute is a completely separate route/record from block: muting never affects social.allowed()', async () => {
  const { platform } = setup();
  await handleMute({ platform, req: { session: { accountId: 'acc_real' }, body: { targetId: 'acc_target' } } });
  assert.equal(await platform.social.allowed('acc_real', 'acc_target', 'follow'), true);
  assert.equal(await platform.social.allowed('acc_target', 'acc_real', 'follow'), true);
});
