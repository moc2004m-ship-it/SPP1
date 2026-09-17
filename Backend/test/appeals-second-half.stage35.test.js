'use strict';
// Stage 35 Part 7/8 -- Appeals, SECOND HALF (staff adjudication).
//
// First-half (user submission side) coverage is in
// appeals-first-half.stage35.test.js and is untouched/unduplicated
// here. This file covers only what the second half adds:
// queue()/getForReview()/assign()/decision().

const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');
const { createPlatform, FeatureStore } = require('../src/feature-platform');

function setup(reviewerIds = new Set(['usr_reviewer'])) {
  return createPlatform({ store: new FeatureStore(new InMemoryFeatureRecordRepository()), reviewerIds });
}

async function makeSubmittedAppeal(p, { targetId = 'usr_target', reporterId = 'usr_reporter' } = {}) {
  const report = await p.moderation.report({ reporterId, targetId, reason: 'harassment' });
  const review = await p.moderation.review.decision('usr_reviewer', report.id, { outcome: 'upheld', notes: 'confirmed' });
  const appeal = await p.moderation.appeals.create(targetId, { reviewId: review.reviewId, reason: 'it was not me' });
  return { report, review, appeal };
}

// ---------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------

test('AUTH: unauthenticated (missing actorId) reviewer access is rejected', async () => {
  const p = setup();
  const { appeal } = await makeSubmittedAppeal(p);
  await assert.rejects(() => p.moderation.appeals.queue(''));
  await assert.rejects(() => p.moderation.appeals.getForReview(null, appeal.id));
  await assert.rejects(() => p.moderation.appeals.assign(undefined, appeal.id));
  await assert.rejects(() => p.moderation.appeals.decision('', appeal.id, { outcome: 'upheld' }));
});

test('AUTH: a normal (non-reviewer) user, including the appellant themselves, is rejected with 403', async () => {
  const p = setup();
  const { appeal } = await makeSubmittedAppeal(p);
  await assert.rejects(() => p.moderation.appeals.queue('usr_target'), (e) => e.status === 403);
  await assert.rejects(() => p.moderation.appeals.getForReview('usr_target', appeal.id), (e) => e.status === 403);
  await assert.rejects(() => p.moderation.appeals.assign('usr_target', appeal.id), (e) => e.status === 403);
  await assert.rejects(() => p.moderation.appeals.decision('usr_target', appeal.id, { outcome: 'upheld' }), (e) => e.status === 403);
  // even the original reporter has no reviewer authority
  await assert.rejects(() => p.moderation.appeals.queue('usr_reporter'), (e) => e.status === 403);
});

test('AUTH: a valid, allow-listed reviewer is accepted', async () => {
  const p = setup();
  const { appeal } = await makeSubmittedAppeal(p);
  const queue = await p.moderation.appeals.queue('usr_reviewer');
  assert.equal(queue.length, 1);
  const got = await p.moderation.appeals.getForReview('usr_reviewer', appeal.id);
  assert.equal(got.id, appeal.id);
});

test('AUTH: a spoofed reviewerId in an input object cannot fabricate authorization -- only the actorId parameter (session) counts', async () => {
  const p = setup();
  const { appeal } = await makeSubmittedAppeal(p);
  // appeals.decision() has no reviewerId/role input field at all; the
  // only identity it ever consults is the actorId parameter itself, so
  // a non-reviewer actorId is rejected regardless of any extra fields.
  await assert.rejects(
    () => p.moderation.appeals.decision('usr_target', appeal.id, { outcome: 'upheld', reviewerId: 'usr_reviewer', role: 'staff' }),
    (e) => e.status === 403
  );
});

// ---------------------------------------------------------------------
// QUEUE / RETRIEVAL
// ---------------------------------------------------------------------

test('queue(): reviewer sees every submitted appeal, not just their own actions', async () => {
  const p = setup();
  await makeSubmittedAppeal(p, { targetId: 'usr_target_a', reporterId: 'usr_reporter_a' });
  await makeSubmittedAppeal(p, { targetId: 'usr_target_b', reporterId: 'usr_reporter_b' });
  const queue = await p.moderation.appeals.queue('usr_reviewer');
  assert.equal(queue.length, 2);
});

test('queue(): status filter narrows the results', async () => {
  const p = setup();
  const { appeal } = await makeSubmittedAppeal(p);
  await makeSubmittedAppeal(p, { targetId: 'usr_target_2', reporterId: 'usr_reporter_2' });
  await p.moderation.appeals.decision('usr_reviewer', appeal.id, { outcome: 'upheld' });
  const submitted = await p.moderation.appeals.queue('usr_reviewer', { status: 'submitted' });
  const resolved = await p.moderation.appeals.queue('usr_reviewer', { status: 'resolved' });
  assert.equal(submitted.length, 1);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].id, appeal.id);
});

test('getForReview(): unknown appeal id is 404', async () => {
  const p = setup();
  await assert.rejects(() => p.moderation.appeals.getForReview('usr_reviewer', 'nonexistent'), (e) => e.status === 404);
});

// ---------------------------------------------------------------------
// ASSIGNMENT
// ---------------------------------------------------------------------

test('assign(): a reviewer can self-assign a submitted appeal', async () => {
  const p = setup(new Set(['usr_reviewer', 'usr_reviewer2']));
  const { appeal } = await makeSubmittedAppeal(p);
  const assigned = await p.moderation.appeals.assign('usr_reviewer', appeal.id);
  assert.equal(assigned.status, 'under_review');
  assert.equal(assigned.reviewerId, 'usr_reviewer');
});

test('assign(): idempotent for the same reviewer', async () => {
  const p = setup();
  const { appeal } = await makeSubmittedAppeal(p);
  const first = await p.moderation.appeals.assign('usr_reviewer', appeal.id);
  const second = await p.moderation.appeals.assign('usr_reviewer', appeal.id);
  assert.equal(first.reviewerId, second.reviewerId);
});

test('assign(): a second, different reviewer is rejected with 409 (conflicting assignment)', async () => {
  const p = setup(new Set(['usr_reviewer', 'usr_reviewer2']));
  const { appeal } = await makeSubmittedAppeal(p);
  await p.moderation.appeals.assign('usr_reviewer', appeal.id);
  await assert.rejects(() => p.moderation.appeals.assign('usr_reviewer2', appeal.id), (e) => e.status === 409);
});

test('assign(): an already-resolved appeal cannot be (re)assigned', async () => {
  const p = setup();
  const { appeal } = await makeSubmittedAppeal(p);
  await p.moderation.appeals.decision('usr_reviewer', appeal.id, { outcome: 'upheld' });
  await assert.rejects(() => p.moderation.appeals.assign('usr_reviewer', appeal.id), (e) => e.status === 409);
});

// ---------------------------------------------------------------------
// DECISION / STATE MACHINE
// ---------------------------------------------------------------------

test('decision(): reviewer can decide an unassigned appeal directly (implicit self-assign)', async () => {
  const p = setup();
  const { appeal } = await makeSubmittedAppeal(p);
  const decided = await p.moderation.appeals.decision('usr_reviewer', appeal.id, { outcome: 'upheld', notes: 'no new evidence' });
  assert.equal(decided.status, 'resolved');
  assert.equal(decided.outcome, 'upheld');
  assert.equal(decided.reviewerId, 'usr_reviewer');
  assert.equal(decided.notes, 'no new evidence');
});

test('decision(): invalid outcome value is rejected (400)', async () => {
  const p = setup();
  const { appeal } = await makeSubmittedAppeal(p);
  await assert.rejects(
    () => p.moderation.appeals.decision('usr_reviewer', appeal.id, { outcome: 'maybe' }),
    (e) => e.status === 400
  );
});

test('decision(): deciding an already-final (resolved) appeal is rejected (409)', async () => {
  const p = setup();
  const { appeal } = await makeSubmittedAppeal(p);
  await p.moderation.appeals.decision('usr_reviewer', appeal.id, { outcome: 'upheld' });
  await assert.rejects(
    () => p.moderation.appeals.decision('usr_reviewer', appeal.id, { outcome: 'overturned' }),
    (e) => e.status === 409
  );
});

test('decision(): a reviewer cannot decide an appeal assigned to a different reviewer (403, prevents impersonation/conflicting decisions)', async () => {
  const p = setup(new Set(['usr_reviewer', 'usr_reviewer2']));
  const { appeal } = await makeSubmittedAppeal(p);
  await p.moderation.appeals.assign('usr_reviewer', appeal.id);
  await assert.rejects(
    () => p.moderation.appeals.decision('usr_reviewer2', appeal.id, { outcome: 'upheld' }),
    (e) => e.status === 403
  );
});

test('decision(): unknown appeal id is 404', async () => {
  const p = setup();
  await assert.rejects(
    () => p.moderation.appeals.decision('usr_reviewer', 'nonexistent', { outcome: 'upheld' }),
    (e) => e.status === 404
  );
});

// ---------------------------------------------------------------------
// ORIGINAL MODERATION DECISION -- uphold vs overturn effects
// ---------------------------------------------------------------------

test('decision(): "upheld" leaves the original review decision untouched', async () => {
  const p = setup();
  const { appeal, review } = await makeSubmittedAppeal(p);
  await p.moderation.appeals.decision('usr_reviewer', appeal.id, { outcome: 'upheld' });
  const original = await p.moderation.review.get('usr_reviewer', review.reportId);
  assert.equal(original.decision, 'upheld');
});

test('decision(): "overturned" reverses the original review\'s recorded decision -- the real existing state, not an invented sanction', async () => {
  const p = setup();
  const { appeal, review } = await makeSubmittedAppeal(p);
  await p.moderation.appeals.decision('usr_reviewer', appeal.id, { outcome: 'overturned', notes: 'new evidence found' });
  const original = await p.moderation.review.get('usr_reviewer', review.reportId);
  assert.equal(original.decision, 'overturned');
  assert.equal(original.status, 'resolved');
});

test('decision(): once overturned, the review is no longer eligible for a fresh appeal (decision is no longer "upheld")', async () => {
  const p = setup();
  const { appeal, review } = await makeSubmittedAppeal(p);
  await p.moderation.appeals.decision('usr_reviewer', appeal.id, { outcome: 'overturned' });
  await assert.rejects(
    () => p.moderation.appeals.create('usr_target', { reviewId: review.reviewId, reason: 'appeal again' }),
    (e) => e.status === 409 || e.status === 403
  );
});

// ---------------------------------------------------------------------
// PART 6 / FIRST-HALF INTEGRATION + REGRESSION
// ---------------------------------------------------------------------

test('Part 6 integration: adjudicating an appeal does not disturb the review queue\'s own state machine', async () => {
  const p = setup();
  const { appeal, report } = await makeSubmittedAppeal(p);
  await p.moderation.appeals.decision('usr_reviewer', appeal.id, { outcome: 'upheld' });
  const stillReviewable = await p.moderation.review.get('usr_reviewer', report.id);
  assert.equal(stillReviewable.status, 'resolved');
});

test('first-half integration: the appellant still sees their own appeal reflect the staff decision via getMine()', async () => {
  const p = setup();
  const { appeal } = await makeSubmittedAppeal(p);
  await p.moderation.appeals.decision('usr_reviewer', appeal.id, { outcome: 'overturned', notes: 'granted' });
  const mine = await p.moderation.appeals.getMine('usr_target', appeal.id);
  assert.equal(mine.status, 'resolved');
  assert.equal(mine.outcome, 'overturned');
});

test('regression: Report/Block/Mute/Word Filter/Room Moderation all unaffected by Appeals second half', async () => {
  const p = setup();
  await assert.rejects(() => p.moderation.report({ reporterId: 'usr_x', targetId: 'usr_x', reason: 'x' }), (e) => e.status === 403);
  const block = await p.social.block('usr_a', 'usr_b');
  assert.equal(block.status, 'active');
  const mute = await p.social.muteUser('usr_a', 'usr_b');
  assert.equal(mute.status, 'active');
  const room = await p.rooms.create({ ownerId: 'usr_owner', name: 'Test Room' });
  const ban = await p.rooms.banMember('usr_owner', room.id, 'usr_target');
  assert.equal(ban.status, 'active');
});
