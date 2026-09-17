'use strict';
// Stage 35 Part 8/8 -- Customer Support. Contract tests for the handlers
// added to src/routes/platform.routes.js:
//   GET  /api/support/faq
//   GET  /api/support/queue                    (staff-only)
//   GET  /api/support/queue/:id                (staff-only)
//   GET  /api/support/tickets/:id              (own-only)
//   POST /api/support/tickets/:id/attachments  (own-only)
//   POST /api/support/tickets/:id/reply        (staff-only)
//   POST /api/support/tickets/:id/status       (staff-only)
//   POST /api/support/tickets/:id/escalate     (staff-only)
//
// platform.routes.js itself cannot be require()'d in this environment (no
// express -- see platform.moderation.routes-contract.test.js's header for
// the full explanation). Same "pure logic, fake req/res, reproduce the
// handler's own call shape verbatim" style used there.
//
// Business rules themselves (type/status validation, transitions,
// authorization) are exhaustively covered in support.stage35.test.js --
// this file is about the routing/session-identity contract: actorId/
// staffId/status always come from the session or an explicit param, NEVER
// from a client-claimed field in the body.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform, FeatureStore } = require('../src/feature-platform');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');
const { createSettingsService } = require('../src/services/settings.service');
const { InMemorySettingsRepository } = require('../src/database/repositories/settings.repository');
const { InMemoryAccountRepository } = require('../src/database/repositories/account.repository');
const { AuthStore } = require('../src/auth/auth.store');

function setup(reviewerIds = new Set(['acc_staff'])) {
  const platform = createPlatform({ store: new FeatureStore(new InMemoryFeatureRecordRepository()), reviewerIds });
  // getFaq() itself touches none of these (real static content, see
  // ../src/domain/legal-content.js) -- they are only here because
  // createSettingsService() requires real repositories to construct at
  // all, same as settings.service.test.js's own setup().
  const accounts = new InMemoryAccountRepository();
  const settingsService = createSettingsService({
    settings: new InMemorySettingsRepository(),
    accounts,
    authStore: new AuthStore(accounts),
  });
  return { platform, settingsService };
}

// Reproduces: router.get('/api/support/faq', (req, res) => json(res, () => settingsService.getFaq()));
function handleFaq({ settingsService }) {
  return settingsService.getFaq();
}
// Reproduces: router.post('/api/support/tickets/:id/reply', (req, res) => json(res, () =>
//   platform.moderation.support.reply(req.session.accountId, req.params.id, req.body?.body)));
function handleReply({ platform, req, params }) {
  return platform.moderation.support.reply(req.session.accountId, params.id, req.body?.body);
}
// Reproduces: router.post('/api/support/tickets/:id/status', ...)
function handleSetStatus({ platform, req, params }) {
  return platform.moderation.support.setStatus(req.session.accountId, params.id, req.body?.status);
}
// Reproduces: router.post('/api/support/tickets/:id/escalate', ...)
function handleEscalate({ platform, req, params }) {
  return platform.moderation.support.escalate(req.session.accountId, params.id);
}
// Reproduces: router.post('/api/support/tickets/:id/attachments', ...)
function handleAttach({ platform, req, params }) {
  return platform.moderation.support.attach(req.session.accountId, params.id, req.body?.url);
}
// Reproduces: router.get('/api/support/tickets/:id', ...)
function handleGetMine({ platform, req, params }) {
  return platform.moderation.support.getMine(req.session.accountId, params.id);
}
// Reproduces: router.get('/api/support/queue', ...)
function handleQueue({ platform, req }) {
  return platform.moderation.support.queue(req.session.accountId, { status: req.query?.status });
}

test('GET /api/support/faq contract: returns real static content, no session-specific data', () => {
  const { settingsService } = setup();
  const faq = handleFaq({ settingsService });
  assert.ok(Array.isArray(faq.items) && faq.items.length > 0);
});

test('POST /api/support/tickets/:id/reply contract: staffId comes only from req.session.accountId, never a spoofed body field', async () => {
  const { platform } = setup();
  const t = await platform.moderation.ticket({ reporterId: 'acc_a', type: 'account', description: 'help' });
  const req = { session: { accountId: 'acc_staff' }, body: { body: 'we are on it', staffId: 'acc_spoofed' } };
  const updated = await handleReply({ platform, req, params: { id: t.id } });
  assert.equal(updated.staffReplies[0].staffId, 'acc_staff');
  assert.notEqual(updated.staffReplies[0].staffId, 'acc_spoofed');
});

test('POST /api/support/tickets/:id/reply contract: a non-staff session is rejected even if it names itself as staff in the body', async () => {
  const { platform } = setup();
  const t = await platform.moderation.ticket({ reporterId: 'acc_a', type: 'account', description: 'help' });
  const req = { session: { accountId: 'acc_a' }, body: { body: 'fake reply', staffId: 'acc_staff' } };
  await assert.rejects(() => handleReply({ platform, req, params: { id: t.id } }), (e) => e.status === 403);
});

test('POST /api/support/tickets/:id/status contract: status transition is enforced server-side, current status never trusted from the client', async () => {
  const { platform } = setup();
  const t = await platform.moderation.ticket({ reporterId: 'acc_a', type: 'account', description: 'help' });
  const req = { session: { accountId: 'acc_staff' }, body: { status: 'resolved' } };
  // Cannot skip straight from 'open' to 'resolved' per the real transition
  // table, regardless of what the client requests.
  await assert.rejects(() => handleSetStatus({ platform, req, params: { id: t.id } }), (e) => e.status === 409);
});

test('POST /api/support/tickets/:id/status contract: a requester (not staff) cannot change their own ticket\'s status', async () => {
  const { platform } = setup();
  const t = await platform.moderation.ticket({ reporterId: 'acc_a', type: 'account', description: 'help' });
  const req = { session: { accountId: 'acc_a' }, body: { status: 'closed' } };
  await assert.rejects(() => handleSetStatus({ platform, req, params: { id: t.id } }), (e) => e.status === 403);
});

test('POST /api/support/tickets/:id/escalate contract: actorId always from session', async () => {
  const { platform } = setup();
  const t = await platform.moderation.ticket({ reporterId: 'acc_a', type: 'account', description: 'help' });
  const updated = await handleEscalate({ platform, req: { session: { accountId: 'acc_staff' } }, params: { id: t.id } });
  assert.equal(updated.status, 'escalated');
  assert.equal(updated.history.at(-1).actorId, 'acc_staff');
});

test('POST /api/support/tickets/:id/attachments contract: url comes from req.body.url, ownership enforced from session', async () => {
  const { platform } = setup();
  const t = await platform.moderation.ticket({ reporterId: 'acc_a', type: 'account', description: 'help' });
  const ok = await handleAttach({
    platform,
    req: { session: { accountId: 'acc_a' }, body: { url: 'https://cdn.example.com/x.png' } },
    params: { id: t.id },
  });
  assert.deepEqual(ok.attachments, ['https://cdn.example.com/x.png']);

  await assert.rejects(
    () => handleAttach({
      platform,
      req: { session: { accountId: 'acc_b' }, body: { url: 'https://cdn.example.com/y.png' } },
      params: { id: t.id },
    }),
    (e) => e.status === 403
  );
});

test('GET /api/support/tickets/:id contract: own-only, cross-user access rejected', async () => {
  const { platform } = setup();
  const t = await platform.moderation.ticket({ reporterId: 'acc_a', type: 'account', description: 'help' });
  const mine = await handleGetMine({ platform, req: { session: { accountId: 'acc_a' } }, params: { id: t.id } });
  assert.equal(mine.id, t.id);
  await assert.rejects(
    () => handleGetMine({ platform, req: { session: { accountId: 'acc_b' } }, params: { id: t.id } }),
    (e) => e.status === 403
  );
});

test('GET /api/support/queue contract: staff-only, status query param passthrough', async () => {
  const { platform } = setup();
  await platform.moderation.ticket({ reporterId: 'acc_a', type: 'account', description: 'help' });
  const all = await handleQueue({ platform, req: { session: { accountId: 'acc_staff' }, query: {} } });
  assert.equal(all.length, 1);
  await assert.rejects(
    () => handleQueue({ platform, req: { session: { accountId: 'acc_a' }, query: {} } }),
    (e) => e.status === 403
  );
});
