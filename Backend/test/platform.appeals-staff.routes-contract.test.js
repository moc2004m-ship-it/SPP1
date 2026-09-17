'use strict';
// Stage 35 Part 7/8 -- Appeals, SECOND HALF. Contract tests for the four
// new staff-side route handlers in src/routes/platform.routes.js:
//   GET  /api/moderation/appeals/queue        -> platform.moderation.appeals.queue(actorId, { status })
//   GET  /api/moderation/appeals/queue/:id    -> platform.moderation.appeals.getForReview(actorId, id)
//   POST /api/moderation/appeals/:id/assign   -> platform.moderation.appeals.assign(actorId, id)
//   POST /api/moderation/appeals/:id/decision -> platform.moderation.appeals.decision(actorId, id, { outcome, notes, evidence })
//
// Same "reproduce the handler verbatim, express unavailable" style as
// platform.appeals.routes-contract.test.js / platform.content-review.routes-contract.test.js.
// Does not duplicate the first-half user-route contract tests.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform, FeatureStore } = require('../src/feature-platform');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');

function setup(reviewerIds = new Set(['usr_reviewer'])) {
  const platform = createPlatform({ store: new FeatureStore(new InMemoryFeatureRecordRepository()), reviewerIds });
  return { platform };
}

async function makeSubmittedAppeal(platform, targetId = 'usr_target') {
  const report = await platform.moderation.report({ reporterId: 'usr_reporter', targetId, reason: 'x' });
  const review = await platform.moderation.review.decision('usr_reviewer', report.id, { outcome: 'upheld' });
  const appeal = await platform.moderation.appeals.create(targetId, { reviewId: review.reviewId, reason: 'not me' });
  return { report, review, appeal };
}

// Reproduces: router.get('/api/moderation/appeals/queue', (req, res) => json(res, () => platform.moderation.appeals.queue(req.session.accountId, { status: req.query.status })));
async function handleQueue({ platform, req }) {
  return platform.moderation.appeals.queue(req.session.accountId, { status: req.query?.status });
}
// Reproduces: router.get('/api/moderation/appeals/queue/:id', (req, res) => json(res, () => platform.moderation.appeals.getForReview(req.session.accountId, req.params.id)));
async function handleGetForReview({ platform, req }) {
  return platform.moderation.appeals.getForReview(req.session.accountId, req.params.id);
}
// Reproduces: router.post('/api/moderation/appeals/:id/assign', (req, res) => json(res, () => platform.moderation.appeals.assign(req.session.accountId, req.params.id)));
async function handleAssign({ platform, req }) {
  return platform.moderation.appeals.assign(req.session.accountId, req.params.id);
}
// Reproduces: router.post('/api/moderation/appeals/:id/decision', (req, res) => json(res, () => platform.moderation.appeals.decision(req.session.accountId, req.params.id, { outcome: req.body?.outcome, notes: req.body?.notes, evidence: req.body?.evidence })));
async function handleDecision({ platform, req }) {
  return platform.moderation.appeals.decision(req.session.accountId, req.params.id, {
    outcome: req.body?.outcome, notes: req.body?.notes, evidence: req.body?.evidence,
  });
}

test('GET /api/moderation/appeals/queue contract: reviewerId always resolves to the real session, never a spoofed body/query field', async () => {
  const { platform } = setup();
  await makeSubmittedAppeal(platform);
  const req = { session: { accountId: 'usr_reviewer' }, query: {} };
  const data = await handleQueue({ platform, req });
  assert.equal(data.length, 1);
});

test('GET /api/moderation/appeals/queue contract: a non-reviewer session (e.g. the appellant) is rejected', async () => {
  const { platform } = setup();
  await makeSubmittedAppeal(platform);
  const req = { session: { accountId: 'usr_target' }, query: {} };
  await assert.rejects(() => handleQueue({ platform, req }), (e) => e.status === 403);
});

test('GET /api/moderation/appeals/queue contract: unauthenticated (no session) is rejected', async () => {
  const { platform } = setup();
  const req = { session: {}, query: {} };
  await assert.rejects(() => handleQueue({ platform, req }));
});

test('GET /api/moderation/appeals/queue/:id contract: reviewer can retrieve an appeal filed by a different account', async () => {
  const { platform } = setup();
  const { appeal } = await makeSubmittedAppeal(platform);
  const req = { session: { accountId: 'usr_reviewer' }, params: { id: appeal.id } };
  const data = await handleGetForReview({ platform, req });
  assert.equal(data.id, appeal.id);
  assert.equal(data.appellantId, 'usr_target');
});

test('POST /api/moderation/appeals/:id/assign contract: reviewerId always resolves to the real session, never a spoofed one', async () => {
  const { platform } = setup();
  const { appeal } = await makeSubmittedAppeal(platform);
  const req = { session: { accountId: 'usr_reviewer' }, params: { id: appeal.id }, body: { reviewerId: 'usr_spoofed' } };
  const data = await handleAssign({ platform, req });
  assert.equal(data.reviewerId, 'usr_reviewer');
  assert.notEqual(data.reviewerId, 'usr_spoofed');
});

test('POST /api/moderation/appeals/:id/decision contract: outcome/notes/evidence come from req.body, actorId from session -- never a body-claimed reviewerId', async () => {
  const { platform } = setup();
  const { appeal } = await makeSubmittedAppeal(platform);
  const req = {
    session: { accountId: 'usr_reviewer' },
    params: { id: appeal.id },
    body: { outcome: 'overturned', notes: 'new evidence', evidence: 'log-456', reviewerId: 'usr_spoofed' },
  };
  const data = await handleDecision({ platform, req });
  assert.equal(data.outcome, 'overturned');
  assert.equal(data.notes, 'new evidence');
  assert.equal(data.evidence, 'log-456');
  assert.equal(data.reviewerId, 'usr_reviewer');
});

test('POST /api/moderation/appeals/:id/decision contract: a non-reviewer session is rejected regardless of req.body', async () => {
  const { platform } = setup();
  const { appeal } = await makeSubmittedAppeal(platform);
  const req = { session: { accountId: 'usr_normal_user' }, params: { id: appeal.id }, body: { outcome: 'upheld' } };
  await assert.rejects(() => handleDecision({ platform, req }), (e) => e.status === 403);
});

test('POST /api/moderation/appeals/:id/decision contract: unauthenticated (no session) is rejected', async () => {
  const { platform } = setup();
  const { appeal } = await makeSubmittedAppeal(platform);
  const req = { session: {}, params: { id: appeal.id }, body: { outcome: 'upheld' } };
  await assert.rejects(() => handleDecision({ platform, req }));
});
