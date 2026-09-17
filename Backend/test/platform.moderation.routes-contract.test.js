'use strict';
// Stage 35 Part 1/8 -- Report. Contract tests for the two Report handlers
// in src/routes/platform.routes.js:
//   POST /api/moderation/report  -> platform.moderation.report({ ...req.body, reporterId: req.session.accountId })
//   GET  /api/moderation/reports -> myReports(await platform.store.list(35), req.session.accountId), newest first
//
// Deliberately NOT covering POST /api/support/tickets or platform.moderation.ticket()
// here -- Customer Support/Tickets is Stage 35 Part 8/8, out of scope for this
// session (see STAGE_35_REPORT_FINAL_REPORT.md, "Parts 2-8 not implemented").
//
// platform.routes.js itself cannot be require()'d in this environment -- it
// does `require('express')` at the top of the file, and express is not
// installed here (no network access to install it; see
// STAGE6_STOP_REPORT.md and the four pre-existing environmental fails in
// accounts/agora/auth/config routes.test.js). Same "pure logic, fake req/res,
// reproduce the handler's own call shape verbatim" style already used by
// platform.referral.routes-contract.test.js / platform.notifications.routes-contract.test.js.
//
// What this proves: reporterId for a new report comes ONLY from
// req.session.accountId -- a client-supplied body.reporterId is silently
// overridden, never trusted, even though it is spread into the same object.
// GET /api/moderation/reports is self-scoped: a session only ever sees
// reports it personally filed, never another account's, and never support
// tickets (which share stage 35 storage but are filtered out structurally).
// The underlying business rules (self-report rejected, missing/invalid
// fields rejected, oversized reason rejected) are exhaustively covered
// separately in feature-platform.test.js -- this file is deliberately about
// the routing/session-identity/read-scoping contract, not re-proving that
// logic.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform, FeatureStore } = require('../src/feature-platform');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');
const { myReports } = require('../src/routes/platform.reads');

function setup() {
  const platform = createPlatform({ store: new FeatureStore(new InMemoryFeatureRecordRepository()) });
  return { platform };
}

// Reproduces platform.routes.js's handler exactly:
//   router.post('/api/moderation/report', (req, res) => json(res, () => platform.moderation.report({ ...req.body, reporterId: req.session.accountId })));
async function handleReport({ platform, req }) {
  return platform.moderation.report({ ...req.body, reporterId: req.session.accountId });
}
// Reproduces platform.routes.js's handler exactly:
//   const all = await platform.store.list(35);
//   res.json({ ok: true, data: myReports(all, req.session.accountId).slice().reverse() });
async function handleMyReports({ platform, req }) {
  const all = await platform.store.list(35);
  return myReports(all, req.session.accountId).slice().reverse();
}

test('POST /api/moderation/report contract: reporterId comes only from req.session.accountId, never a body-claimed id', async () => {
  const { platform } = setup();
  const req = {
    session: { accountId: 'acc_real' },
    body: { targetId: 'acc_target', reason: 'spam', reporterId: 'acc_spoofed' },
  };
  const record = await handleReport({ platform, req });
  assert.equal(record.reporterId, 'acc_real');
  assert.notEqual(record.reporterId, 'acc_spoofed');
  assert.equal(record.targetId, 'acc_target');
  assert.equal(record.reason, 'spam');
  assert.equal(record.status, 'open');
});

test('POST /api/moderation/report contract: targetId/reason come from req.body', async () => {
  const { platform } = setup();
  const req = { session: { accountId: 'acc_real' }, body: { targetId: 'acc_target', reason: 'harassment in room' } };
  const record = await handleReport({ platform, req });
  assert.equal(record.targetId, 'acc_target');
  assert.equal(record.reason, 'harassment in room');
});

test('POST /api/moderation/report contract: a spoofed body.reporterId cannot make the session report itself', async () => {
  // acc_real is the real caller; the client tries to disguise a self-report
  // as a report of someone else by claiming a different reporterId in the
  // body. The route still resolves reporterId from the session, so this is
  // correctly caught by the self-report rule at the service layer.
  const { platform } = setup();
  const req = {
    session: { accountId: 'acc_real' },
    body: { targetId: 'acc_real', reason: 'spam', reporterId: 'acc_spoofed' },
  };
  await assert.rejects(() => handleReport({ platform, req }), /cannot report yourself/);
});

test('POST /api/moderation/report contract: missing targetId/reason is rejected', async () => {
  const { platform } = setup();
  await assert.rejects(
    () => handleReport({ platform, req: { session: { accountId: 'acc_real' }, body: { reason: 'spam' } } }),
    /targetId/,
  );
  await assert.rejects(
    () => handleReport({ platform, req: { session: { accountId: 'acc_real' }, body: { targetId: 'acc_target' } } }),
    /reason/,
  );
});

test('GET /api/moderation/reports contract: a session only ever sees reports it personally filed', async () => {
  const { platform } = setup();
  await handleReport({ platform, req: { session: { accountId: 'acc_a' }, body: { targetId: 'acc_x', reason: 'spam' } } });
  await handleReport({ platform, req: { session: { accountId: 'acc_b' }, body: { targetId: 'acc_x', reason: 'spam' } } });
  const mine = await handleMyReports({ platform, req: { session: { accountId: 'acc_a' } } });
  assert.equal(mine.length, 1);
  assert.equal(mine[0].reporterId, 'acc_a');
});

test('GET /api/moderation/reports contract: newest first', async () => {
  const { platform } = setup();
  const req = { session: { accountId: 'acc_a' } };
  const first = await handleReport({ platform, req: { ...req, body: { targetId: 'acc_x', reason: 'first' } } });
  const second = await handleReport({ platform, req: { ...req, body: { targetId: 'acc_y', reason: 'second' } } });
  const mine = await handleMyReports({ platform, req });
  assert.deepEqual(mine.map((r) => r.id), [second.id, first.id]);
});

test('GET /api/moderation/reports contract: support tickets (also stage 35) never appear in a report listing', async () => {
  const { platform } = setup();
  const req = { session: { accountId: 'acc_a' } };
  const report = await handleReport({ platform, req: { ...req, body: { targetId: 'acc_x', reason: 'spam' } } });
  // Same reporter also has an (unrelated, out-of-scope-for-this-session)
  // support ticket in the same stage-35 storage -- it must not leak into
  // the Report listing, since it has no targetId.
  await platform.moderation.ticket({ reporterId: 'acc_a', type: 'account', description: 'help' });
  const mine = await handleMyReports({ platform, req });
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, report.id);
});
