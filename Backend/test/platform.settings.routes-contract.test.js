'use strict';
// Stage 34 -- contract tests for the settings routes added to
// src/routes/platform.routes.js (POST /api/settings, GET
// /api/settings/:userId, POST /api/settings/account/delete, GET
// /api/settings/terms, GET /api/settings/help).
//
// platform.routes.js itself cannot be require()'d in this environment --
// it does `require('express')` at the top of the file, and express is
// not installed here (no network access to install it). This is the
// same pre-existing environmental limitation documented in
// platform.notifications.routes-contract.test.js/platform.auth.guards.test.js.
// What this file verifies without needing express: the exact wiring
// each route handler does (actingAccountId always from
// req.session.accountId, target userId from req.params via
// assertOwnAccount, key/value from req.body), reproduced here against
// fake req/res objects and the real settingsService/assertOwnAccount
// functions -- same style as platform.notifications.routes-contract.test.js.
// Correct HTTP status codes and response shapes (ok/data vs ok/error) are
// verified via the same `json()` wrapper shape platform.routes.js itself
// uses.

const test = require('node:test');
const assert = require('node:assert/strict');

const { InMemorySettingsRepository } = require('../src/database/repositories/settings.repository');
const { InMemoryAccountRepository } = require('../src/database/repositories/account.repository');
const { AuthStore } = require('../src/auth/auth.store');
const { createSettingsService } = require('../src/services/settings.service');
const { assertOwnAccount } = require('../src/routes/platform.guards');
const { TERMS_CONTENT, HELP_CONTENT } = require('../src/domain/legal-content');

async function setup() {
  const settings = new InMemorySettingsRepository();
  const accounts = new InMemoryAccountRepository();
  const authStore = new AuthStore(accounts);
  const settingsService = createSettingsService({ settings, accounts, authStore });
  const account = await accounts.create();
  return { settingsService, authStore, accounts, accountId: account.id };
}

// Reproduces platform.routes.js's own `json()` helper exactly, so a test
// failure here means the real route wiring would behave differently too.
function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}
async function json(res, fn) {
  try { res.json({ ok: true, data: await fn() }); }
  catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
}

// --- POST /api/settings ------------------------------------------------
// router.post('/api/settings', (req, res) => json(res, () =>
//   settingsService.set(req.session.accountId, req.session.accountId, req.body?.key, req.body?.value)));

test('POST /api/settings contract: sets a real value scoped to the session, never a client-supplied userId', async () => {
  const { settingsService, accountId } = await setup();
  const req = { session: { accountId }, body: { key: 'sound', value: false } };
  const res = fakeRes();
  await json(res, () => settingsService.set(req.session.accountId, req.session.accountId, req.body?.key, req.body?.value));

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.key, 'sound');
  assert.equal(res.body.data.value, false);
});

test('POST /api/settings contract: invalid value -> real 400 with ok:false', async () => {
  const { settingsService, accountId } = await setup();
  const req = { session: { accountId }, body: { key: 'language', value: 'klingon' } };
  const res = fakeRes();
  await json(res, () => settingsService.set(req.session.accountId, req.session.accountId, req.body?.key, req.body?.value));

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.ok(res.body.error);
});

// --- GET /api/settings/:userId -----------------------------------------
// router.get('/api/settings/:userId', ... assertOwnAccount(req.session, req.params.userId) ... settingsService.get(...))

test('GET /api/settings/:userId contract: returns the effective current settings for the caller', async () => {
  const { settingsService, accountId } = await setup();
  await settingsService.set(accountId, accountId, 'mic', true);

  const req = { session: { accountId }, params: { userId: accountId } };
  const res = fakeRes();
  try {
    const userId = assertOwnAccount(req.session, req.params.userId);
    const data = await settingsService.get(req.session.accountId, userId);
    res.json({ ok: true, data });
  } catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.mic, true);
  assert.equal(res.body.data.sound, true); // real default, never omitted
});

test('GET /api/settings/:userId contract: a cross-account :userId param is rejected with a real 403, never trusted', async () => {
  const { settingsService, accounts, accountId } = await setup();
  const victim = await accounts.create();

  const req = { session: { accountId }, params: { userId: victim.id } };
  const res = fakeRes();
  try {
    const userId = assertOwnAccount(req.session, req.params.userId);
    const data = await settingsService.get(req.session.accountId, userId);
    res.json({ ok: true, data });
  } catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
});

// --- POST /api/settings/account/delete ----------------------------------
// router.post('/api/settings/account/delete', (req, res) => json(res, () =>
//   settingsService.deleteAccount(req.session.accountId)));

test('POST /api/settings/account/delete contract: soft-deletes only the caller\'s own account (no target id accepted at all)', async () => {
  const { settingsService, accounts, accountId } = await setup();
  const req = { session: { accountId }, body: { userId: 'someone-else-entirely' } }; // must be ignored
  const res = fakeRes();
  await json(res, () => settingsService.deleteAccount(req.session.accountId));

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.accountId, accountId);
  const account = await accounts.findById(accountId);
  assert.ok(account.deletedAt);
});

test('POST /api/settings/account/delete contract: unauthenticated -> real 403', async () => {
  const { settingsService } = await setup();
  const req = { session: null };
  const res = fakeRes();
  await json(res, () => settingsService.deleteAccount(req.session && req.session.accountId));

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
});

// --- GET /api/settings/terms / /api/settings/help ------------------------

test('GET /api/settings/terms contract: returns the real static TERMS_CONTENT verbatim', async () => {
  const { settingsService } = await setup();
  const res = fakeRes();
  await json(res, () => settingsService.getTerms());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, TERMS_CONTENT);
});

test('GET /api/settings/help contract: returns the real static HELP_CONTENT verbatim', async () => {
  const { settingsService } = await setup();
  const res = fakeRes();
  await json(res, () => settingsService.getHelp());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, HELP_CONTENT);
});
