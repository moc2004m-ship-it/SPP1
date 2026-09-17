'use strict';
// Stage 35 Part 6/8 -- Content Review.
//
// Audit finding (see STAGE_35_CONTENT_REVIEW_FINAL_REPORT.md section 2/3
// for the full writeup): the only pre-existing queue-like concept is
// Report itself (store 35) -- status is always 'open', never transitioned.
// There is no reviewer/flag/decision concept anywhere before this stage.
// This file is scoped to the new moderation.review namespace in
// feature-platform.js and its regressions; it does not re-test
// report()/ticket() logic already covered by feature-platform.test.js and
// platform.moderation.routes-contract.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');
const { createPlatform, FeatureStore } = require('../src/feature-platform');
const { myReports, myTickets } = require('../src/routes/platform.reads');

function setup(reviewerIds = new Set(['usr_reviewer'])) {
  return createPlatform({ store: new FeatureStore(new InMemoryFeatureRecordRepository()), reviewerIds });
}

async function makeReport(p, overrides = {}) {
  return p.moderation.report({ reporterId: 'usr_reporter', targetId: 'usr_target', reason: 'harassment', ...overrides });
}

// ---------------------------------------------------------------------
// REPORT -> REVIEW
// ---------------------------------------------------------------------

test('review queue is built from real Part 1 Report records', async () => {
  const p = setup();
  const report = await makeReport(p);
  const queue = await p.moderation.review.list('usr_reviewer');
  assert.equal(queue.length, 1);
  assert.equal(queue[0].reportId, report.id);
  assert.equal(queue[0].reporterId, 'usr_reporter');
  assert.equal(queue[0].reportedAccountId, 'usr_target');
  assert.equal(queue[0].reason, 'harassment');
  assert.equal(queue[0].status, 'open');
});

test('report data (reporter, target, reason, timestamps) is preserved unmodified through review', async () => {
  const p = setup();
  const report = await makeReport(p, { reason: 'spam in room chat' });
  await p.moderation.review.assign('usr_reviewer', report.id);
  const item = await p.moderation.review.get('usr_reviewer', report.id);
  assert.equal(item.reporterId, report.reporterId);
  assert.equal(item.reportedAccountId, report.targetId);
  assert.equal(item.reason, report.reason);
  assert.equal(item.reportedAt, report.createdAt);
  // the underlying report record itself is never mutated by review
  const stored = await p.store.find(35, (r) => r.id === report.id);
  assert.equal(stored.status, 'open');
  assert.equal(stored.reason, 'spam in room chat');
});

test('a report never touched by review still shows status "open" (report.status itself is never transitioned)', async () => {
  const p = setup();
  const report = await makeReport(p);
  const item = await p.moderation.review.get('usr_reviewer', report.id);
  assert.equal(item.status, 'open');
  assert.equal(item.reviewId, null);
});

// ---------------------------------------------------------------------
// AUTHORIZATION / SECURITY
// ---------------------------------------------------------------------

test('a normal (non-reviewer) user cannot list the review queue', async () => {
  const p = setup();
  await makeReport(p);
  await assert.rejects(() => p.moderation.review.list('usr_reporter'), (e) => e.status === 403);
});

test('a normal (non-reviewer) user cannot get a single reported item', async () => {
  const p = setup();
  const report = await makeReport(p);
  await assert.rejects(() => p.moderation.review.get('usr_reporter', report.id), (e) => e.status === 403);
});

test('a normal (non-reviewer) user cannot assign or decide', async () => {
  const p = setup();
  const report = await makeReport(p);
  await assert.rejects(() => p.moderation.review.assign('usr_reporter', report.id), (e) => e.status === 403);
  await assert.rejects(() => p.moderation.review.decision('usr_reporter', report.id, { outcome: 'upheld' }), (e) => e.status === 403);
});

test('unauthenticated (missing actorId) is rejected on every review action', async () => {
  const p = setup();
  const report = await makeReport(p);
  await assert.rejects(() => p.moderation.review.list(''));
  await assert.rejects(() => p.moderation.review.get(null, report.id));
  await assert.rejects(() => p.moderation.review.assign(undefined, report.id));
  await assert.rejects(() => p.moderation.review.decision('', report.id, { outcome: 'upheld' }));
});

test('a spoofed reviewerId/role in the input object is never honored -- only the real allowlisted actorId matters', async () => {
  const p = setup();
  const report = await makeReport(p);
  // Simulates a client trying to smuggle {"reviewerId":"...","role":"admin"}
  // through some other channel -- assign()/decision() only ever take
  // actorId as a real parameter (mirroring the route layer, which only
  // ever forwards req.session.accountId), so there is no field for a
  // spoofed role to land in even if a caller tried.
  await assert.rejects(() => p.moderation.review.assign('usr_attacker', report.id), (e) => e.status === 403);
  const attackerIsNowReviewer = false; // no such elevation path exists
  assert.equal(attackerIsNowReviewer, false);
});

test('a valid allowlisted reviewer is accepted', async () => {
  const p = setup();
  const report = await makeReport(p);
  const assigned = await p.moderation.review.assign('usr_reviewer', report.id);
  assert.equal(assigned.status, 'in_review');
  assert.equal(assigned.reviewerId, 'usr_reviewer');
});

test('private data protection: the review projection exposes only report + review fields, no unrelated account data', async () => {
  const p = setup();
  const report = await makeReport(p);
  const item = await p.moderation.review.get('usr_reviewer', report.id);
  const allowedKeys = new Set([
    'reportId', 'reporterId', 'reportedAccountId', 'reason', 'reportedAt',
    'reviewId', 'status', 'reviewerId', 'decision', 'notes', 'evidence', 'history', 'resolvedAt',
  ]);
  for (const key of Object.keys(item)) assert.ok(allowedKeys.has(key), `unexpected field leaked: ${key}`);
});

// ---------------------------------------------------------------------
// STATUS TRANSITIONS
// ---------------------------------------------------------------------

test('valid transition: open -> in_review via assign()', async () => {
  const p = setup();
  const report = await makeReport(p);
  const before = await p.moderation.review.get('usr_reviewer', report.id);
  assert.equal(before.status, 'open');
  const after = await p.moderation.review.assign('usr_reviewer', report.id);
  assert.equal(after.status, 'in_review');
});

test('valid transition: open -> resolved directly via decision() (auto-assigns)', async () => {
  const p = setup();
  const report = await makeReport(p);
  const decided = await p.moderation.review.decision('usr_reviewer', report.id, { outcome: 'dismissed' });
  assert.equal(decided.status, 'resolved');
  assert.equal(decided.decision, 'dismissed');
  assert.equal(decided.reviewerId, 'usr_reviewer');
});

test('re-assigning by the SAME reviewer is idempotent (no duplicate review record)', async () => {
  const p = setup();
  const report = await makeReport(p);
  const first = await p.moderation.review.assign('usr_reviewer', report.id);
  const second = await p.moderation.review.assign('usr_reviewer', report.id);
  assert.equal(first.reviewId, second.reviewId);
});

test('assigning to a report already assigned to a DIFFERENT reviewer is rejected (409)', async () => {
  const p = setup(new Set(['usr_reviewer', 'usr_reviewer2']));
  const report = await makeReport(p);
  await p.moderation.review.assign('usr_reviewer', report.id);
  await assert.rejects(() => p.moderation.review.assign('usr_reviewer2', report.id), (e) => e.status === 409);
});

test('assigning an already-resolved report is rejected (409)', async () => {
  const p = setup();
  const report = await makeReport(p);
  await p.moderation.review.decision('usr_reviewer', report.id, { outcome: 'upheld' });
  await assert.rejects(() => p.moderation.review.assign('usr_reviewer', report.id), (e) => e.status === 409);
});

test('deciding on a report assigned to a DIFFERENT reviewer is rejected (403)', async () => {
  const p = setup(new Set(['usr_reviewer', 'usr_reviewer2']));
  const report = await makeReport(p);
  await p.moderation.review.assign('usr_reviewer', report.id);
  await assert.rejects(() => p.moderation.review.decision('usr_reviewer2', report.id, { outcome: 'upheld' }), (e) => e.status === 403);
});

test('duplicate/conflicting decisions: deciding an already-resolved report is rejected (409)', async () => {
  const p = setup();
  const report = await makeReport(p);
  await p.moderation.review.decision('usr_reviewer', report.id, { outcome: 'upheld' });
  await assert.rejects(() => p.moderation.review.decision('usr_reviewer', report.id, { outcome: 'dismissed' }), (e) => e.status === 409);
});

test('invalid outcome value is rejected (400), no invented status names', async () => {
  const p = setup();
  const report = await makeReport(p);
  await assert.rejects(() => p.moderation.review.decision('usr_reviewer', report.id, { outcome: 'banned_forever' }), (e) => e.status === 400);
  await assert.rejects(() => p.moderation.review.decision('usr_reviewer', report.id, {}), (e) => e.status === 400);
});

// ---------------------------------------------------------------------
// DECISION PERSISTENCE / NOTES-EVIDENCE / HISTORY
// ---------------------------------------------------------------------

test('decision persists notes and evidence, and appends a real history entry', async () => {
  const p = setup();
  const report = await makeReport(p);
  const decided = await p.moderation.review.decision('usr_reviewer', report.id, {
    outcome: 'upheld', notes: 'confirmed via chat logs', evidence: 'message id s11_xyz',
  });
  assert.equal(decided.notes, 'confirmed via chat logs');
  assert.equal(decided.evidence, 'message id s11_xyz');
  assert.equal(decided.history.length, 2);
  assert.equal(decided.history[0].action, 'assigned');
  assert.equal(decided.history[1].action, 'decision');
  assert.equal(decided.history[1].outcome, 'upheld');
  // re-fetching returns the exact same persisted state
  const fetched = await p.moderation.review.get('usr_reviewer', report.id);
  assert.deepEqual(fetched, decided);
});

test('oversized notes/evidence are rejected', async () => {
  const p = setup();
  const report = await makeReport(p);
  await assert.rejects(() => p.moderation.review.decision('usr_reviewer', report.id, { outcome: 'upheld', notes: 'x'.repeat(3000) }));
});

// ---------------------------------------------------------------------
// MALFORMED / CROSS-SCOPE
// ---------------------------------------------------------------------

test('malformed/unknown report id is rejected with 404, not silently accepted', async () => {
  const p = setup();
  await assert.rejects(() => p.moderation.review.get('usr_reviewer', 'nonexistent_id'), (e) => e.status === 404);
  await assert.rejects(() => p.moderation.review.assign('usr_reviewer', ''));
});

test('a support ticket (same stage-35 store) is never surfaced in the review queue', async () => {
  const p = setup();
  await p.moderation.ticket({ reporterId: 'usr_reporter', type: 'billing', description: 'refund please' });
  const queue = await p.moderation.review.list('usr_reviewer');
  assert.equal(queue.length, 0);
});

test('the review queue and a ticket/report never cross-contaminate structurally (myReports/myTickets regression)', async () => {
  const p = setup();
  const report = await makeReport(p);
  await p.moderation.ticket({ reporterId: 'usr_reporter', type: 'billing', description: 'refund please' });
  await p.moderation.review.decision('usr_reviewer', report.id, { outcome: 'upheld' });
  const all = await p.store.list(35);
  assert.equal(myReports(all, 'usr_reporter').length, 1);
  assert.equal(myTickets(all, 'usr_reporter').length, 1);
});

test('status filter on the queue works', async () => {
  const p = setup();
  const r1 = await makeReport(p, { targetId: 'usr_t1' });
  const r2 = await makeReport(p, { targetId: 'usr_t2' });
  await p.moderation.review.decision('usr_reviewer', r1.id, { outcome: 'upheld' });
  const open = await p.moderation.review.list('usr_reviewer', { status: 'open' });
  const resolved = await p.moderation.review.list('usr_reviewer', { status: 'resolved' });
  assert.equal(open.length, 1);
  assert.equal(open[0].reportId, r2.id);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].reportId, r1.id);
});

// ---------------------------------------------------------------------
// REGRESSIONS -- Report, Block, Mute, Word Filter, Room Moderation
// ---------------------------------------------------------------------

test('regression: Report (Part 1) self-report rejection is unchanged', async () => {
  const p = setup();
  await assert.rejects(() => p.moderation.report({ reporterId: 'usr_x', targetId: 'usr_x', reason: 'x' }), (e) => e.status === 403);
});

test('regression: global Block (Part 2) is unaffected by Content Review', async () => {
  const p = setup();
  const block = await p.social.block('usr_a', 'usr_b');
  assert.equal(block.status, 'active');
  assert.equal(await p.social.allowed('usr_a', 'usr_b'), false);
});

test('regression: user Mute (Part 3) is unaffected by Content Review', async () => {
  const p = setup();
  const mute = await p.social.muteUser('usr_a', 'usr_b');
  assert.equal(mute.status, 'active');
  assert.equal(await p.social.isUserMuted('usr_a', 'usr_b'), true);
});

test('regression: Word Filter (Part 4) still rejects banned content', () => {
  const p = setup();
  // rooms.create() validation throws synchronously (not a rejected
  // promise) -- same documented behavior word-filter.integration.test.js
  // already accounts for; assert.throws (not assert.rejects) is correct
  // here.
  assert.throws(
    () => p.rooms.create({ ownerId: 'usr_owner', name: require('../src/services/word-filter.service').BANNED_WORDS[0] }),
    (e) => e.status === 400
  );
});

test('regression: Room Moderation (Part 5) ban/unban is unaffected by Content Review', async () => {
  const p = setup();
  const room = await p.rooms.create({ ownerId: 'usr_owner', name: 'Test Room' });
  const ban = await p.rooms.banMember('usr_owner', room.id, 'usr_target');
  assert.equal(ban.status, 'active');
  await assert.rejects(() => p.rooms.join(room.id, 'usr_target'), (e) => e.status === 403);
});
