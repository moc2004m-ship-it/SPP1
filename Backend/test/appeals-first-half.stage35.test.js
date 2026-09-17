'use strict';
// Stage 35 Part 7/8 -- Appeals, FIRST HALF ONLY (user submission side).
//
// Deliberately does NOT cover staff adjudication (second half) -- there
// is no adjudication method in feature-platform.js's moderation.appeals
// to test, by design (see STAGE_35_APPEALS_FIRST_HALF_PROGRESS.md).

const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');
const { createPlatform, FeatureStore } = require('../src/feature-platform');

function setup(reviewerIds = new Set(['usr_reviewer'])) {
  return createPlatform({ store: new FeatureStore(new InMemoryFeatureRecordRepository()), reviewerIds });
}

// Helper: produce a real, resolved, 'upheld' review record to appeal against.
async function makeUpheldReview(p, { targetId = 'usr_target' } = {}) {
  const report = await p.moderation.report({ reporterId: 'usr_reporter', targetId, reason: 'harassment' });
  return p.moderation.review.decision('usr_reviewer', report.id, { outcome: 'upheld', notes: 'confirmed' });
}
async function makeDismissedReview(p, { targetId = 'usr_ok' } = {}) {
  const report = await p.moderation.report({ reporterId: 'usr_reporter', targetId, reason: 'meh' });
  return p.moderation.review.decision('usr_reviewer', report.id, { outcome: 'dismissed' });
}

// ---------------------------------------------------------------------
// ELIGIBILITY / CREATE
// ---------------------------------------------------------------------

test('eligible user (the account an upheld decision was made against) creates a valid appeal', async () => {
  const p = setup();
  const review = await makeUpheldReview(p);
  const appeal = await p.moderation.appeals.create('usr_target', { reviewId: review.reviewId, reason: 'I was not the one who did this' });
  assert.equal(appeal.appellantId, 'usr_target');
  assert.equal(appeal.reviewId, review.reviewId);
  assert.equal(appeal.reportId, review.reportId);
  assert.equal(appeal.status, 'submitted');
  assert.equal(appeal.reason, 'I was not the one who did this');
});

test('ineligible: a dismissed review cannot be appealed', async () => {
  const p = setup();
  const review = await makeDismissedReview(p);
  await assert.rejects(
    () => p.moderation.appeals.create('usr_ok', { reviewId: review.reviewId, reason: 'appeal anyway' }),
    (e) => e.status === 403
  );
});

test('ineligible: a review that is not yet resolved (still in_review) cannot be appealed', async () => {
  const p = setup();
  const report = await p.moderation.report({ reporterId: 'usr_reporter', targetId: 'usr_target', reason: 'x' });
  const assigned = await p.moderation.review.assign('usr_reviewer', report.id);
  await assert.rejects(
    () => p.moderation.appeals.create('usr_target', { reviewId: assigned.reviewId, reason: 'too early' }),
    (e) => e.status === 409
  );
});

test('unauthenticated (missing actorId) is rejected', async () => {
  const p = setup();
  const review = await makeUpheldReview(p);
  await assert.rejects(() => p.moderation.appeals.create('', { reviewId: review.reviewId, reason: 'x' }));
  await assert.rejects(() => p.moderation.appeals.create(null, { reviewId: review.reviewId, reason: 'x' }));
});

test('appeal links to a REAL review record -- an unknown reviewId is rejected with 404', async () => {
  const p = setup();
  await assert.rejects(
    () => p.moderation.appeals.create('usr_target', { reviewId: 'nonexistent', reason: 'x' }),
    (e) => e.status === 404
  );
});

test('appellant identity comes only from the actorId parameter (session), never trusted from input', async () => {
  const p = setup();
  const review = await makeUpheldReview(p);
  // Simulates a client trying to smuggle a different appellantId in the
  // body -- appeals.create() has no such input field at all; only the
  // real actorId parameter (req.session.accountId at the route layer)
  // is ever used as appellantId.
  const appeal = await p.moderation.appeals.create('usr_target', { reviewId: review.reviewId, reason: 'x', appellantId: 'usr_spoofed' });
  assert.equal(appeal.appellantId, 'usr_target');
  assert.notEqual(appeal.appellantId, 'usr_spoofed');
});

test('spoofed reviewer/decision IDs cannot fabricate eligibility -- outcome/status are read only from the persisted review', async () => {
  const p = setup();
  const review = await makeDismissedReview(p);
  // Even if a caller passes extra, unexpected fields (e.g. trying to
  // claim the decision was 'upheld'), eligibility is derived exclusively
  // from the stored review record, never from input.
  await assert.rejects(
    () => p.moderation.appeals.create('usr_ok', { reviewId: review.reviewId, reason: 'x', decision: 'upheld', status: 'resolved' }),
    (e) => e.status === 403
  );
});

test('security: a user cannot appeal a decision made against a DIFFERENT account (e.g. the original reporter)', async () => {
  const p = setup();
  const review = await makeUpheldReview(p);
  await assert.rejects(
    () => p.moderation.appeals.create('usr_reporter', { reviewId: review.reviewId, reason: 'x' }),
    (e) => e.status === 403
  );
  await assert.rejects(
    () => p.moderation.appeals.create('usr_unrelated_stranger', { reviewId: review.reviewId, reason: 'x' }),
    (e) => e.status === 403
  );
});

test('malformed input (missing/empty reason, missing reviewId) is rejected', async () => {
  const p = setup();
  const review = await makeUpheldReview(p);
  await assert.rejects(() => p.moderation.appeals.create('usr_target', { reviewId: review.reviewId, reason: '' }));
  await assert.rejects(() => p.moderation.appeals.create('usr_target', { reviewId: '', reason: 'x' }));
  await assert.rejects(() => p.moderation.appeals.create('usr_target', { reason: 'x' }));
});

test('duplicate rule: a second appeal against the same review is rejected (409), not silently merged', async () => {
  const p = setup();
  const review = await makeUpheldReview(p);
  await p.moderation.appeals.create('usr_target', { reviewId: review.reviewId, reason: 'first' });
  await assert.rejects(
    () => p.moderation.appeals.create('usr_target', { reviewId: review.reviewId, reason: 'second attempt' }),
    (e) => e.status === 409
  );
});

// ---------------------------------------------------------------------
// RETRIEVAL
// ---------------------------------------------------------------------

test('a user sees their own appeal(s)', async () => {
  const p = setup();
  const review = await makeUpheldReview(p);
  const appeal = await p.moderation.appeals.create('usr_target', { reviewId: review.reviewId, reason: 'x' });
  const mine = await p.moderation.appeals.listMine('usr_target');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, appeal.id);
  const got = await p.moderation.appeals.getMine('usr_target', appeal.id);
  assert.equal(got.id, appeal.id);
});

test('a user cannot see another user\'s appeal', async () => {
  const p = setup();
  const review = await makeUpheldReview(p);
  const appeal = await p.moderation.appeals.create('usr_target', { reviewId: review.reviewId, reason: 'x' });
  const strangerList = await p.moderation.appeals.listMine('usr_stranger');
  assert.equal(strangerList.length, 0);
  await assert.rejects(() => p.moderation.appeals.getMine('usr_stranger', appeal.id), (e) => e.status === 403);
  await assert.rejects(() => p.moderation.appeals.getMine('usr_reporter', appeal.id), (e) => e.status === 403);
});

test('unauthorized private-data access: an unknown appeal id is 404, not leaked as someone else\'s', async () => {
  const p = setup();
  await assert.rejects(() => p.moderation.appeals.getMine('usr_target', 'nonexistent'), (e) => e.status === 404);
});

// ---------------------------------------------------------------------
// PART 6 INTEGRATION REMAINS INTACT
// ---------------------------------------------------------------------

test('Part 6 integration: creating an appeal does not alter the underlying review record', async () => {
  const p = setup();
  const review = await makeUpheldReview(p);
  await p.moderation.appeals.create('usr_target', { reviewId: review.reviewId, reason: 'x' });
  const stillThere = await p.moderation.review.get('usr_reviewer', review.reportId);
  assert.equal(stillThere.status, 'resolved');
  assert.equal(stillThere.decision, 'upheld');
});

test('Part 6 integration: the review queue for reviewers is unaffected by appeal submissions', async () => {
  const p = setup();
  const review = await makeUpheldReview(p);
  await p.moderation.appeals.create('usr_target', { reviewId: review.reviewId, reason: 'x' });
  const queue = await p.moderation.review.list('usr_reviewer', { status: 'resolved' });
  assert.equal(queue.length, 1);
});

// ---------------------------------------------------------------------
// PARTS 1-5 REGRESSION
// ---------------------------------------------------------------------

test('regression: Report/Block/Mute/Word Filter/Room Moderation all unaffected by Appeals', async () => {
  const p = setup();
  // Report
  await assert.rejects(() => p.moderation.report({ reporterId: 'usr_x', targetId: 'usr_x', reason: 'x' }), (e) => e.status === 403);
  // Block
  const block = await p.social.block('usr_a', 'usr_b');
  assert.equal(block.status, 'active');
  // Mute
  const mute = await p.social.muteUser('usr_a', 'usr_b');
  assert.equal(mute.status, 'active');
  // Word Filter
  const { BANNED_WORDS } = require('../src/services/word-filter.service');
  assert.throws(() => p.rooms.create({ ownerId: 'usr_owner', name: BANNED_WORDS[0] }), (e) => e.status === 400);
  // Room Moderation
  const room = await p.rooms.create({ ownerId: 'usr_owner', name: 'Test Room' });
  const ban = await p.rooms.banMember('usr_owner', room.id, 'usr_target');
  assert.equal(ban.status, 'active');
});
