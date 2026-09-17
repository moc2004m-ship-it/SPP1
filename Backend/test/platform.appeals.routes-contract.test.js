'use strict';
// Stage 35 Part 7/8 -- Appeals, FIRST HALF ONLY. Contract tests for the
// three route handlers in src/routes/platform.routes.js:
//   POST /api/moderation/appeals      -> platform.moderation.appeals.create(actorId, { reviewId, reason })
//   GET  /api/moderation/appeals      -> platform.moderation.appeals.listMine(actorId)
//   GET  /api/moderation/appeals/:id  -> platform.moderation.appeals.getMine(actorId, id)
//
// Same "reproduce the handler verbatim, express unavailable" style as
// platform.moderation.routes-contract.test.js / platform.content-review.routes-contract.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform, FeatureStore } = require('../src/feature-platform');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');

function setup(reviewerIds = new Set(['usr_reviewer'])) {
  const platform = createPlatform({ store: new FeatureStore(new InMemoryFeatureRecordRepository()), reviewerIds });
  return { platform };
}

async function makeUpheldReview(platform, targetId = 'usr_target') {
  const report = await platform.moderation.report({ reporterId: 'usr_reporter', targetId, reason: 'x' });
  return platform.moderation.review.decision('usr_reviewer', report.id, { outcome: 'upheld' });
}

// Reproduces: router.post('/api/moderation/appeals', (req, res) => json(res, () => platform.moderation.appeals.create(req.session.accountId, { reviewId: req.body?.reviewId, reason: req.body?.reason })));
async function handleCreate({ platform, req }) {
  return platform.moderation.appeals.create(req.session.accountId, { reviewId: req.body?.reviewId, reason: req.body?.reason });
}
// Reproduces: router.get('/api/moderation/appeals', (req, res) => json(res, () => platform.moderation.appeals.listMine(req.session.accountId)));
async function handleListMine({ platform, req }) {
  return platform.moderation.appeals.listMine(req.session.accountId);
}
// Reproduces: router.get('/api/moderation/appeals/:id', (req, res) => json(res, () => platform.moderation.appeals.getMine(req.session.accountId, req.params.id)));
async function handleGetMine({ platform, req }) {
  return platform.moderation.appeals.getMine(req.session.accountId, req.params.id);
}

test('POST /api/moderation/appeals contract: appellantId comes only from req.session.accountId, never a body-claimed id', async () => {
  const { platform } = setup();
  const review = await makeUpheldReview(platform);
  const req = {
    session: { accountId: 'usr_target' },
    body: { reviewId: review.reviewId, reason: 'not me', appellantId: 'usr_spoofed' },
  };
  const data = await handleCreate({ platform, req });
  assert.equal(data.appellantId, 'usr_target');
  assert.notEqual(data.appellantId, 'usr_spoofed');
});

test('POST /api/moderation/appeals contract: a spoofed body.reviewId that does not exist is rejected', async () => {
  const { platform } = setup();
  const req = { session: { accountId: 'usr_target' }, body: { reviewId: 'usr_made_up_id', reason: 'x' } };
  await assert.rejects(() => handleCreate({ platform, req }), (e) => e.status === 404);
});

test('POST /api/moderation/appeals contract: a different account cannot appeal on someone else\'s behalf', async () => {
  const { platform } = setup();
  const review = await makeUpheldReview(platform);
  const req = { session: { accountId: 'usr_someone_else' }, body: { reviewId: review.reviewId, reason: 'x' } };
  await assert.rejects(() => handleCreate({ platform, req }), (e) => e.status === 403);
});

test('GET /api/moderation/appeals contract: self-scoped -- a session only ever sees its own appeals', async () => {
  const { platform } = setup();
  const reviewA = await makeUpheldReview(platform, 'usr_target_a');
  const reviewB = await makeUpheldReview(platform, 'usr_target_b');
  await handleCreate({ platform, req: { session: { accountId: 'usr_target_a' }, body: { reviewId: reviewA.reviewId, reason: 'a' } } });
  await handleCreate({ platform, req: { session: { accountId: 'usr_target_b' }, body: { reviewId: reviewB.reviewId, reason: 'b' } } });
  const dataA = await handleListMine({ platform, req: { session: { accountId: 'usr_target_a' } } });
  assert.equal(dataA.length, 1);
  assert.equal(dataA[0].appellantId, 'usr_target_a');
});

test('GET /api/moderation/appeals/:id contract: another account\'s appeal id is rejected (403), not returned', async () => {
  const { platform } = setup();
  const review = await makeUpheldReview(platform);
  const appeal = await handleCreate({ platform, req: { session: { accountId: 'usr_target' }, body: { reviewId: review.reviewId, reason: 'x' } } });
  const req = { session: { accountId: 'usr_someone_else' }, params: { id: appeal.id } };
  await assert.rejects(() => handleGetMine({ platform, req }), (e) => e.status === 403);
});

test('unauthenticated (no session) is rejected on every appeals route', async () => {
  const { platform } = setup();
  const review = await makeUpheldReview(platform);
  await assert.rejects(() => handleCreate({ platform, req: { session: {}, body: { reviewId: review.reviewId, reason: 'x' } } }));
  await assert.rejects(() => handleListMine({ platform, req: { session: {} } }));
  await assert.rejects(() => handleGetMine({ platform, req: { session: {}, params: { id: 'anything' } } }));
});
