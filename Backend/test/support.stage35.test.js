'use strict';
// Stage 35 Part 8/8 -- Customer Support (FAQ, Tickets, Types, Status,
// Staff Replies, Attachments, Escalation, Full Logs).
//
// ticket()'s own basic "starts open" behavior is already covered by
// feature-platform.test.js / platform.reads.test.js / content-review.
// stage35.test.js and is NOT re-proven here. This file covers what Part
// 8 actually adds on top of that pre-existing stub: validated types,
// staff replies, status transitions, escalation, attachments, FAQ, and
// the security/authorization rules around all of it (never-trust-client
// requesterId/staffId/status, own-ticket-only, reviewer-only).

const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');
const { createPlatform, FeatureStore } = require('../src/feature-platform');
// FAQ content itself lives in ../src/domain/legal-content.js and is
// served unchanged by settingsService.getFaq() (see
// platform.support.routes-contract.test.js for that wiring, covered
// there with the real settings/accounts/authStore dependencies
// createSettingsService requires). Here we test the content directly,
// same as settings.service.test.js does for TERMS_CONTENT/HELP_CONTENT.
const { FAQ_CONTENT } = require('../src/domain/legal-content');
function getFaq() { return FAQ_CONTENT; }

function setup(reviewerIds = new Set(['usr_staff'])) {
  return createPlatform({ store: new FeatureStore(new InMemoryFeatureRecordRepository()), reviewerIds });
}

// ---------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------

test('FAQ returns real static content with at least one item', () => {
  const faq = getFaq();
  assert.ok(Array.isArray(faq.items) && faq.items.length > 0);
  for (const item of faq.items) {
    assert.equal(typeof item.question, 'string');
    assert.equal(typeof item.answer, 'string');
    assert.ok(item.question.length > 0 && item.answer.length > 0);
  }
});

test('FAQ content is stable/deterministic across calls (no CMS/randomness)', () => {
  assert.deepEqual(getFaq(), getFaq());
});

// ---------------------------------------------------------------------
// TICKET CREATION / TYPES
// ---------------------------------------------------------------------

test('a valid ticket type is accepted and the ticket starts open with the new Part 8 fields', async () => {
  const p = setup();
  const t = await p.moderation.ticket({ reporterId: 'usr_a', type: 'billing', description: 'missing coins' });
  assert.equal(t.status, 'open');
  assert.deepEqual(t.attachments, []);
  assert.deepEqual(t.staffReplies, []);
  assert.equal(t.history.length, 1);
  assert.equal(t.history[0].action, 'created');
});

test('an invalid/arbitrary ticket type is rejected, not silently accepted', async () => {
  const p = setup();
  await assert.rejects(
    () => p.moderation.ticket({ reporterId: 'usr_a', type: 'made_up_type', description: 'x' }),
    (e) => e.status === 400
  );
});

for (const type of ['account', 'billing', 'technical', 'room', 'gift_wallet', 'other']) {
  test(`catalog ticket type "${type}" is accepted`, async () => {
    const p = setup();
    const t = await p.moderation.ticket({ reporterId: 'usr_a', type, description: 'x' });
    assert.equal(t.type, type);
  });
}

// ---------------------------------------------------------------------
// OWN-TICKET ACCESS / CROSS-USER REJECTION
// ---------------------------------------------------------------------

test('the requester can retrieve their own ticket', async () => {
  const p = setup();
  const t = await p.moderation.ticket({ reporterId: 'usr_a', type: 'account', description: 'help' });
  const fetched = await p.moderation.support.getMine('usr_a', t.id);
  assert.equal(fetched.id, t.id);
});

test('a different account cannot retrieve someone else\'s ticket (403)', async () => {
  const p = setup();
  const t = await p.moderation.ticket({ reporterId: 'usr_a', type: 'account', description: 'help' });
  await assert.rejects(() => p.moderation.support.getMine('usr_b', t.id), (e) => e.status === 403);
});

test('a malformed/unknown ticket id is rejected with 404', async () => {
  const p = setup();
  await assert.rejects(() => p.moderation.support.getMine('usr_a', 'nonexistent_id'), (e) => e.status === 404);
});

test('a report (same stage-35 store) is never misread as a ticket', async () => {
  const p = setup();
  const report = await p.moderation.report({ reporterId: 'usr_a', targetId: 'usr_b', reason: 'spam' });
  await assert.rejects(() => p.moderation.support.getMine('usr_a', report.id), (e) => e.status === 404);
});

// ---------------------------------------------------------------------
// STAFF AUTHORIZATION (never trust client staffId/role)
// ---------------------------------------------------------------------

test('a non-staff account cannot view the queue', async () => {
  const p = setup();
  await p.moderation.ticket({ reporterId: 'usr_a', type: 'account', description: 'help' });
  await assert.rejects(() => p.moderation.support.queue('usr_a'), (e) => e.status === 403);
});

test('a non-staff account cannot reply, change status, or escalate someone else\'s (or even their own) ticket', async () => {
  const p = setup();
  const t = await p.moderation.ticket({ reporterId: 'usr_a', type: 'account', description: 'help' });
  await assert.rejects(() => p.moderation.support.reply('usr_a', t.id, 'trying to fake a staff reply'), (e) => e.status === 403);
  await assert.rejects(() => p.moderation.support.setStatus('usr_a', t.id, 'resolved'), (e) => e.status === 403);
  await assert.rejects(() => p.moderation.support.escalate('usr_a', t.id), (e) => e.status === 403);
});

test('the queue is staff-only but sees every requester\'s ticket, not just one', async () => {
  const p = setup();
  await p.moderation.ticket({ reporterId: 'usr_a', type: 'account', description: 'help a' });
  await p.moderation.ticket({ reporterId: 'usr_b', type: 'billing', description: 'help b' });
  const queue = await p.moderation.support.queue('usr_staff');
  assert.equal(queue.length, 2);
});

test('status filter on the staff queue works', async () => {
  const p = setup();
  const t = await p.moderation.ticket({ reporterId: 'usr_a', type: 'account', description: 'help' });
  await p.moderation.support.setStatus('usr_staff', t.id, 'in_progress');
  const open = await p.moderation.support.queue('usr_staff', { status: 'open' });
  const inProgress = await p.moderation.support.queue('usr_staff', { status: 'in_progress' });
  assert.equal(open.length, 0);
  assert.equal(inProgress.length, 1);
});

// ---------------------------------------------------------------------
// STAFF REPLIES
// ---------------------------------------------------------------------

test('an authorized staff reply is persisted, ordered, and visible to the requester on their own ticket', async () => {
  const p = setup();
  const t = await p.moderation.ticket({ reporterId: 'usr_a', type: 'account', description: 'help' });
  await p.moderation.support.reply('usr_staff', t.id, 'looking into it');
  await p.moderation.support.reply('usr_staff', t.id, 'resolved on our end');
  const fetched = await p.moderation.support.getMine('usr_a', t.id);
  assert.equal(fetched.staffReplies.length, 2);
  assert.equal(fetched.staffReplies[0].body, 'looking into it');
  assert.equal(fetched.staffReplies[1].body, 'resolved on our end');
  assert.equal(fetched.staffReplies[0].staffId, 'usr_staff');
});

test('a reply cannot be spoofed as coming from a different, unauthorized staffId', async () => {
  const p = setup();
  const t = await p.moderation.ticket({ reporterId: 'usr_a', type: 'account', description: 'help' });
  // The only "staffId" the API ever accepts is the actorId argument
  // itself (always req.session.accountId at the route layer) -- there is
  // no field a caller can pass to attribute a reply to someone else.
  await assert.rejects(() => p.moderation.support.reply('usr_not_staff', t.id, 'fake'), (e) => e.status === 403);
});

test('cannot reply to a closed ticket', async () => {
  const p = setup();
  const t = await p.moderation.ticket({ reporterId: 'usr_a', type: 'account', description: 'help' });
  await p.moderation.support.setStatus('usr_staff', t.id, 'in_progress');
  await p.moderation.support.setStatus('usr_staff', t.id, 'resolved');
  await p.moderation.support.setStatus('usr_staff', t.id, 'closed');
  await assert.rejects(() => p.moderation.support.reply('usr_staff', t.id, 'too late'), (e) => e.status === 409);
});

// ---------------------------------------------------------------------
// STATUS LIFECYCLE
// ---------------------------------------------------------------------

test('valid status transitions succeed and are logged with from/to/actor', async () => {
  const p = setup();
  const t = await p.moderation.ticket({ reporterId: 'usr_a', type: 'account', description: 'help' });
  const updated = await p.moderation.support.setStatus('usr_staff', t.id, 'in_progress');
  assert.equal(updated.status, 'in_progress');
  const entry = updated.history.find((h) => h.action === 'status_changed');
  assert.equal(entry.from, 'open');
  assert.equal(entry.to, 'in_progress');
  assert.equal(entry.actorId, 'usr_staff');
});

test('an invalid/unknown status value is rejected', async () => {
  const p = setup();
  const t = await p.moderation.ticket({ reporterId: 'usr_a', type: 'account', description: 'help' });
  await assert.rejects(() => p.moderation.support.setStatus('usr_staff', t.id, 'made_up_status'), (e) => e.status === 400);
});

test('an invalid transition (e.g. closed -> open) is rejected even though both are real statuses', async () => {
  const p = setup();
  const t = await p.moderation.ticket({ reporterId: 'usr_a', type: 'account', description: 'help' });
  await p.moderation.support.setStatus('usr_staff', t.id, 'in_progress');
  await p.moderation.support.setStatus('usr_staff', t.id, 'resolved');
  await p.moderation.support.setStatus('usr_staff', t.id, 'closed');
  await assert.rejects(() => p.moderation.support.setStatus('usr_staff', t.id, 'open'), (e) => e.status === 409);
});

test('a full happy-path lifecycle open -> in_progress -> waiting_user -> in_progress -> resolved -> closed', async () => {
  const p = setup();
  const t = await p.moderation.ticket({ reporterId: 'usr_a', type: 'technical', description: 'crash' });
  let cur = t;
  for (const next of ['in_progress', 'waiting_user', 'in_progress', 'resolved', 'closed']) {
    cur = await p.moderation.support.setStatus('usr_staff', cur.id, next);
    assert.equal(cur.status, next);
  }
});

// ---------------------------------------------------------------------
// ESCALATION
// ---------------------------------------------------------------------

test('staff can escalate an open ticket; escalation is persisted with actor and timestamp', async () => {
  const p = setup();
  const t = await p.moderation.ticket({ reporterId: 'usr_a', type: 'account', description: 'help' });
  const escalated = await p.moderation.support.escalate('usr_staff', t.id);
  assert.equal(escalated.status, 'escalated');
  const entry = escalated.history.find((h) => h.action === 'escalated');
  assert.equal(entry.actorId, 'usr_staff');
  assert.ok(entry.at);
});

test('escalating an already-escalated ticket is a no-op, not an error', async () => {
  const p = setup();
  const t = await p.moderation.ticket({ reporterId: 'usr_a', type: 'account', description: 'help' });
  await p.moderation.support.escalate('usr_staff', t.id);
  const again = await p.moderation.support.escalate('usr_staff', t.id);
  assert.equal(again.status, 'escalated');
});

test('a resolved/closed ticket cannot be escalated', async () => {
  const p = setup();
  const t = await p.moderation.ticket({ reporterId: 'usr_a', type: 'account', description: 'help' });
  await p.moderation.support.setStatus('usr_staff', t.id, 'in_progress');
  await p.moderation.support.setStatus('usr_staff', t.id, 'resolved');
  await assert.rejects(() => p.moderation.support.escalate('usr_staff', t.id), (e) => e.status === 409);
});

test('an escalated ticket can still move to in_progress/resolved/closed', async () => {
  const p = setup();
  const t = await p.moderation.ticket({ reporterId: 'usr_a', type: 'account', description: 'help' });
  await p.moderation.support.escalate('usr_staff', t.id);
  const resumed = await p.moderation.support.setStatus('usr_staff', t.id, 'in_progress');
  assert.equal(resumed.status, 'in_progress');
});

// ---------------------------------------------------------------------
// ATTACHMENTS
// ---------------------------------------------------------------------

test('the owner can attach a valid http(s) URL to their own ticket', async () => {
  const p = setup();
  const t = await p.moderation.ticket({ reporterId: 'usr_a', type: 'account', description: 'help' });
  const updated = await p.moderation.support.attach('usr_a', t.id, 'https://cdn.example.com/screenshot.png');
  assert.deepEqual(updated.attachments, ['https://cdn.example.com/screenshot.png']);
});

test('an invalid attachment URL (not http(s)) is rejected', async () => {
  const p = setup();
  const t = await p.moderation.ticket({ reporterId: 'usr_a', type: 'account', description: 'help' });
  await assert.rejects(() => p.moderation.support.attach('usr_a', t.id, 'not-a-url'), (e) => e.status === 400);
});

test('a different account cannot attach to someone else\'s ticket (ownership enforced)', async () => {
  const p = setup();
  const t = await p.moderation.ticket({ reporterId: 'usr_a', type: 'account', description: 'help' });
  await assert.rejects(
    () => p.moderation.support.attach('usr_b', t.id, 'https://cdn.example.com/x.png'),
    (e) => e.status === 403
  );
});

test('cannot add an attachment to a closed ticket', async () => {
  const p = setup();
  const t = await p.moderation.ticket({ reporterId: 'usr_a', type: 'account', description: 'help' });
  await p.moderation.support.setStatus('usr_staff', t.id, 'in_progress');
  await p.moderation.support.setStatus('usr_staff', t.id, 'resolved');
  await p.moderation.support.setStatus('usr_staff', t.id, 'closed');
  await assert.rejects(
    () => p.moderation.support.attach('usr_a', t.id, 'https://cdn.example.com/x.png'),
    (e) => e.status === 409
  );
});

// ---------------------------------------------------------------------
// FULL LOGS / HISTORY
// ---------------------------------------------------------------------

test('history captures created, staff_reply, status_changed, escalated, and attachment_added in order', async () => {
  const p = setup();
  const t = await p.moderation.ticket({ reporterId: 'usr_a', type: 'account', description: 'help' });
  await p.moderation.support.attach('usr_a', t.id, 'https://cdn.example.com/x.png');
  await p.moderation.support.reply('usr_staff', t.id, 'looking into it');
  await p.moderation.support.setStatus('usr_staff', t.id, 'in_progress');
  const final = await p.moderation.support.escalate('usr_staff', t.id);
  const actions = final.history.map((h) => h.action);
  assert.deepEqual(actions, ['created', 'attachment_added', 'staff_reply', 'status_changed', 'escalated']);
});

// ---------------------------------------------------------------------
// REGRESSION: Parts 1-7 unaffected
// ---------------------------------------------------------------------

test('regression: Report/ticket structural discrimination (myReports/myTickets) still holds with the new ticket fields', async () => {
  const { myReports, myTickets } = require('../src/routes/platform.reads');
  const p = setup();
  await p.moderation.report({ reporterId: 'usr_a', targetId: 'usr_b', reason: 'spam' });
  await p.moderation.ticket({ reporterId: 'usr_a', type: 'billing', description: 'refund' });
  const all = await p.store.list(35);
  assert.equal(myReports(all, 'usr_a').length, 1);
  assert.equal(myTickets(all, 'usr_a').length, 1);
});

test('regression: a support ticket never appears in the Content Review queue', async () => {
  const p = setup();
  await p.moderation.ticket({ reporterId: 'usr_a', type: 'billing', description: 'refund' });
  const queue = await p.moderation.review.list('usr_staff');
  assert.equal(queue.length, 0);
});

test('regression: a support ticket never appears in the Appeals queue', async () => {
  const p = setup();
  await p.moderation.ticket({ reporterId: 'usr_a', type: 'billing', description: 'refund' });
  const queue = await p.moderation.appeals.queue('usr_staff');
  assert.equal(queue.length, 0);
});
