'use strict';
// Stage 35 Part 2/8 -- Block. Contract tests for the two Block handlers in
// src/routes/platform.routes.js:
//   POST /api/block   -> platform.social.block(req.session.accountId, req.body.targetId)
//   POST /api/unblock -> platform.social.unblock(req.session.accountId, req.body.targetId)
//
// Block/unblock are owned by Stage 8/10's platform.social.* (see
// feature-platform.js) -- this session only added unblock() and made
// block() idempotent (see feature-platform.js comment at the top of the
// `social` object's block()/unblock()/allowed()); the route wiring itself
// (identity discipline, req.body.targetId) was already correct and is
// reproduced here, not re-invented.
//
// platform.routes.js itself cannot be require()'d in this environment -- it
// does `require('express')` at the top of the file, and express is not
// installed here (no network access to install it; see
// STAGE6_STOP_REPORT.md and the four pre-existing environmental fails in
// accounts/agora/auth/config routes.test.js). Same "pure logic, fake req/res,
// reproduce the handler's own call shape verbatim" style already used by
// platform.referral.routes-contract.test.js /
// platform.moderation.routes-contract.test.js.
//
// What this proves: the acting/blocking user for both routes comes ONLY
// from req.session.accountId -- a client-supplied body.userId/accountId is
// never trusted, only ever used as the *target* of the action. The
// underlying business rules (idempotent block, unblock 404 when nothing
// active, one user's unblock never touching another user's block,
// self-block unrestricted) are exhaustively covered separately in
// feature-platform.test.js -- this file is deliberately about the
// routing/session-identity contract, not re-proving that logic.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform, FeatureStore } = require('../src/feature-platform');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');

function setup() {
  const platform = createPlatform({ store: new FeatureStore(new InMemoryFeatureRecordRepository()) });
  return { platform };
}

// Reproduces platform.routes.js's handler exactly:
//   router.post('/api/block', (req, res) => json(res, () => platform.social.block(req.session.accountId, req.body.targetId)));
async function handleBlock({ platform, req }) {
  return platform.social.block(req.session.accountId, req.body.targetId);
}
// Reproduces platform.routes.js's handler exactly:
//   router.post('/api/unblock', (req, res) => json(res, () => platform.social.unblock(req.session.accountId, req.body.targetId)));
async function handleUnblock({ platform, req }) {
  return platform.social.unblock(req.session.accountId, req.body.targetId);
}

test('POST /api/block contract: the blocking user comes only from req.session.accountId, never a body-claimed id', async () => {
  const { platform } = setup();
  const req = { session: { accountId: 'acc_real' }, body: { targetId: 'acc_target', userId: 'acc_spoofed', accountId: 'acc_spoofed' } };
  const record = await handleBlock({ platform, req });
  assert.equal(record.userId, 'acc_real');
  assert.notEqual(record.userId, 'acc_spoofed');
  assert.equal(record.targetId, 'acc_target');
  assert.equal(record.status, 'active');
});

test('POST /api/block contract: targetId comes from req.body', async () => {
  const { platform } = setup();
  const req = { session: { accountId: 'acc_real' }, body: { targetId: 'acc_target' } };
  const record = await handleBlock({ platform, req });
  assert.equal(record.targetId, 'acc_target');
});

test('POST /api/block contract: a missing targetId is rejected', async () => {
  const { platform } = setup();
  await assert.rejects(() => handleBlock({ platform, req: { session: { accountId: 'acc_real' }, body: {} } }), /targetId/);
});

test('POST /api/block contract: calling it twice for the same target is idempotent (deterministic duplicate handling)', async () => {
  const { platform } = setup();
  const req = { session: { accountId: 'acc_real' }, body: { targetId: 'acc_target' } };
  const first = await handleBlock({ platform, req });
  const second = await handleBlock({ platform, req });
  assert.equal(first.id, second.id);
});

test('POST /api/unblock contract: the unblocking user comes only from req.session.accountId, never a body-claimed id', async () => {
  const { platform } = setup();
  await handleBlock({ platform, req: { session: { accountId: 'acc_real' }, body: { targetId: 'acc_target' } } });
  const req = { session: { accountId: 'acc_real' }, body: { targetId: 'acc_target', userId: 'acc_spoofed' } };
  const record = await handleUnblock({ platform, req });
  assert.equal(record.userId, 'acc_real');
  assert.equal(record.status, 'removed');
});

test('POST /api/unblock contract: a spoofed session cannot remove another account\'s block', async () => {
  const { platform } = setup();
  // acc_victim blocked acc_target for real reasons; a different, unrelated
  // caller (acc_attacker) tries to undo it by claiming the same targetId.
  await handleBlock({ platform, req: { session: { accountId: 'acc_victim' }, body: { targetId: 'acc_target' } } });
  await assert.rejects(
    () => handleUnblock({ platform, req: { session: { accountId: 'acc_attacker' }, body: { targetId: 'acc_target' } } }),
    (err) => { assert.equal(err.status, 404); return true; },
  );
  // acc_victim's own block is untouched by acc_attacker's failed attempt.
  const stillBlocked = !(await platform.social.allowed('acc_victim', 'acc_target', 'follow'));
  assert.equal(stillBlocked, true);
});

test('POST /api/unblock contract: unblocking with nothing active is a 404', async () => {
  const { platform } = setup();
  await assert.rejects(
    () => handleUnblock({ platform, req: { session: { accountId: 'acc_real' }, body: { targetId: 'acc_target' } } }),
    (err) => { assert.equal(err.status, 404); return true; },
  );
});
