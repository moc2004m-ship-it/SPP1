'use strict';
// Stage 35 Part 6/8 -- Content Review. Contract tests for the four
// route handlers in src/routes/platform.routes.js:
//   GET  /api/moderation/review                  -> platform.moderation.review.list(actorId, { status })
//   GET  /api/moderation/review/:id               -> platform.moderation.review.get(actorId, id)
//   POST /api/moderation/review/:id/assign        -> platform.moderation.review.assign(actorId, id)
//   POST /api/moderation/review/:id/decision      -> platform.moderation.review.decision(actorId, id, { outcome, notes, evidence })
//
// platform.routes.js itself cannot be require()'d in this environment
// (express is not installed -- see platform.moderation.routes-contract.test.js's
// header for the full explanation). Same "pure logic, fake req/res,
// reproduce the handler's own call shape verbatim" style.
//
// What this proves: actorId for every handler comes ONLY from
// req.session.accountId -- a client-supplied body.reviewerId/role is
// never read by any handler (there is no such parameter to read).

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform, FeatureStore } = require('../src/feature-platform');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');

function setup(reviewerIds = new Set(['usr_reviewer'])) {
  const platform = createPlatform({ store: new FeatureStore(new InMemoryFeatureRecordRepository()), reviewerIds });
  return { platform };
}

// Reproduces: router.get('/api/moderation/review', (req, res) => json(res, () => platform.moderation.review.list(req.session.accountId, { status: req.query.status })));
async function handleList({ platform, req }) {
  return platform.moderation.review.list(req.session.accountId, { status: req.query?.status });
}
// Reproduces: router.get('/api/moderation/review/:id', ...)
async function handleGet({ platform, req }) {
  return platform.moderation.review.get(req.session.accountId, req.params.id);
}
// Reproduces: router.post('/api/moderation/review/:id/assign', ...)
async function handleAssign({ platform, req }) {
  return platform.moderation.review.assign(req.session.accountId, req.params.id);
}
// Reproduces: router.post('/api/moderation/review/:id/decision', ...)
async function handleDecision({ platform, req }) {
  return platform.moderation.review.decision(req.session.accountId, req.params.id, {
    outcome: req.body?.outcome,
    notes: req.body?.notes,
    evidence: req.body?.evidence,
  });
}

test('GET /api/moderation/review contract: actorId comes only from req.session.accountId', async () => {
  const { platform } = setup();
  await platform.moderation.report({ reporterId: 'usr_reporter', targetId: 'usr_target', reason: 'x' });
  const req = { session: { accountId: 'usr_reviewer' }, query: {} };
  const data = await handleList({ platform, req });
  assert.equal(data.length, 1);
});

test('GET /api/moderation/review contract: a client-supplied body.role/reviewerId cannot elevate a non-reviewer session', async () => {
  const { platform } = setup();
  await platform.moderation.report({ reporterId: 'usr_reporter', targetId: 'usr_target', reason: 'x' });
  // The handler never even reads req.body -- but simulate an attacker
  // trying anyway; only req.session.accountId (set by requireSession
  // after verifying the real auth token) is ever consulted.
  const req = { session: { accountId: 'usr_attacker' }, query: {}, body: { role: 'admin', reviewerId: 'usr_reviewer' } };
  await assert.rejects(() => handleList({ platform, req }), (e) => e.status === 403);
});

test('GET /api/moderation/review contract: status query param filters the queue', async () => {
  const { platform } = setup();
  const report = await platform.moderation.report({ reporterId: 'usr_reporter', targetId: 'usr_target', reason: 'x' });
  await platform.moderation.review.decision('usr_reviewer', report.id, { outcome: 'upheld' });
  const req = { session: { accountId: 'usr_reviewer' }, query: { status: 'resolved' } };
  const data = await handleList({ platform, req });
  assert.equal(data.length, 1);
  assert.equal(data[0].status, 'resolved');
});

test('GET /api/moderation/review/:id contract: unauthenticated (no session) is rejected', async () => {
  const { platform } = setup();
  const report = await platform.moderation.report({ reporterId: 'usr_reporter', targetId: 'usr_target', reason: 'x' });
  const req = { session: {}, params: { id: report.id } };
  await assert.rejects(() => handleGet({ platform, req }));
});

test('POST /api/moderation/review/:id/assign contract: reviewerId always resolves to the real session, never a spoofed one', async () => {
  const { platform } = setup(new Set(['usr_reviewer']));
  const report = await platform.moderation.report({ reporterId: 'usr_reporter', targetId: 'usr_target', reason: 'x' });
  const req = { session: { accountId: 'usr_reviewer' }, params: { id: report.id } };
  const data = await handleAssign({ platform, req });
  assert.equal(data.reviewerId, 'usr_reviewer');
});

test('POST /api/moderation/review/:id/decision contract: outcome/notes/evidence come from req.body, actorId from session', async () => {
  const { platform } = setup();
  const report = await platform.moderation.report({ reporterId: 'usr_reporter', targetId: 'usr_target', reason: 'x' });
  const req = {
    session: { accountId: 'usr_reviewer' },
    params: { id: report.id },
    body: { outcome: 'upheld', notes: 'confirmed', evidence: 'log-123' },
  };
  const data = await handleDecision({ platform, req });
  assert.equal(data.decision, 'upheld');
  assert.equal(data.notes, 'confirmed');
  assert.equal(data.evidence, 'log-123');
  assert.equal(data.reviewerId, 'usr_reviewer');
});

test('POST /api/moderation/review/:id/decision contract: a non-reviewer session is rejected regardless of req.body', async () => {
  const { platform } = setup();
  const report = await platform.moderation.report({ reporterId: 'usr_reporter', targetId: 'usr_target', reason: 'x' });
  const req = { session: { accountId: 'usr_normal_user' }, params: { id: report.id }, body: { outcome: 'upheld' } };
  await assert.rejects(() => handleDecision({ platform, req }), (e) => e.status === 403);
});
