'use strict';
// Stage 25 -- direct unit tests for the real purchase-verification boundary
// (../src/services/recharge-provider-verifier.js). Until now this module
// was only ever exercised indirectly, through a fully-fake `verify`
// function injected in recharge.service.test.js (which proves
// recharge.service.js's ORCHESTRATION around verification, not the
// verifier itself) plus a single real "unconfigured -> 503" case. This
// file proves the real verifyPurchase()/loadRechargeProviderConfigFromEnv()
// functions themselves: fail-closed behavior with no config, the real
// HTTP call shape when configured, both real failure branches (non-2xx,
// `valid:false`), and the real env-var loader.
//
// global.fetch is monkeypatched for the "configured" tests, the same
// technique already used by final-corrections.test.js for the Apple
// provider verifier -- there is no real network access in this sandbox,
// and this project's discipline is to inject a fake transport rather than
// invent a fake "verified" result inside the module under test.

const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyPurchase, loadRechargeProviderConfigFromEnv } = require('../src/services/recharge-provider-verifier');

const realFetch = global.fetch;
test.afterEach(() => {
  global.fetch = realFetch;
});

test('rejects a missing providerPurchaseRef with 400, regardless of config', async () => {
  await assert.rejects(
    () => verifyPurchase({ provider: 'google_play', purchaseRef: '', accountId: 'acc_1', packageId: 'pkg_small' }, {}),
    (e) => e.status === 400
  );
});

test('fails closed with 503 when the provider has no config entry at all', async () => {
  await assert.rejects(
    () => verifyPurchase({ provider: 'google_play', purchaseRef: 'tok', accountId: 'acc_1', packageId: 'pkg_small' }, {}),
    (e) => e.status === 503 && /not configured/.test(e.message)
  );
});

test('fails closed with 503 when the provider entry exists but has no verifyUrl', async () => {
  await assert.rejects(
    () =>
      verifyPurchase(
        { provider: 'google_play', purchaseRef: 'tok', accountId: 'acc_1', packageId: 'pkg_small' },
        { google_play: {} }
      ),
    (e) => e.status === 503
  );
});

test('never calls fetch at all when unconfigured (no accidental real network call)', async () => {
  let called = false;
  global.fetch = async () => {
    called = true;
    return { ok: true, json: async () => ({ valid: true }) };
  };
  await assert.rejects(() =>
    verifyPurchase({ provider: 'app_store', purchaseRef: 'tok', accountId: 'acc_1', packageId: 'pkg_small' }, {})
  );
  assert.equal(called, false);
});

test('when configured, POSTs purchaseRef/accountId/packageId as JSON to the configured verifyUrl with configured headers', async () => {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ valid: true, providerTransactionId: 'gp_txn_1' }) };
  };
  const result = await verifyPurchase(
    { provider: 'google_play', purchaseRef: 'real-token', accountId: 'acc_1', packageId: 'pkg_small' },
    { google_play: { verifyUrl: 'https://verify.example/gp', headers: { 'x-api-key': 'secret' } } }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://verify.example/gp');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.equal(calls[0].init.headers['x-api-key'], 'secret');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    purchaseRef: 'real-token',
    accountId: 'acc_1',
    packageId: 'pkg_small',
  });
  assert.deepEqual(result, { valid: true, providerTransactionId: 'gp_txn_1' });
});

test('returns providerTransactionId: null when the provider response omits it', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({ valid: true }) });
  const result = await verifyPurchase(
    { provider: 'google_play', purchaseRef: 'tok', accountId: 'acc_1', packageId: 'pkg_small' },
    { google_play: { verifyUrl: 'https://verify.example/gp' } }
  );
  assert.deepEqual(result, { valid: true, providerTransactionId: null });
});

test('a non-2xx provider response is a real 402, never treated as valid', async () => {
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(
    () =>
      verifyPurchase(
        { provider: 'google_play', purchaseRef: 'tok', accountId: 'acc_1', packageId: 'pkg_small' },
        { google_play: { verifyUrl: 'https://verify.example/gp' } }
      ),
    (e) => e.status === 402
  );
});

test('a 2xx provider response reporting valid:false is a real 402, never treated as valid', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({ valid: false }) });
  await assert.rejects(
    () =>
      verifyPurchase(
        { provider: 'app_store', purchaseRef: 'tok', accountId: 'acc_1', packageId: 'pkg_small' },
        { app_store: { verifyUrl: 'https://verify.example/as' } }
      ),
    (e) => e.status === 402
  );
});

test('a 2xx provider response with no body/valid field at all is a real 402, never treated as valid', async () => {
  global.fetch = async () => ({ ok: true, json: async () => null });
  await assert.rejects(
    () =>
      verifyPurchase(
        { provider: 'app_store', purchaseRef: 'tok', accountId: 'acc_1', packageId: 'pkg_small' },
        { app_store: { verifyUrl: 'https://verify.example/as' } }
      ),
    (e) => e.status === 402
  );
});

// --- loadRechargeProviderConfigFromEnv -----------------------------------

test('loadRechargeProviderConfigFromEnv returns an empty config when no env vars are set (both providers stay "not configured")', () => {
  const cfg = loadRechargeProviderConfigFromEnv({});
  assert.deepEqual(cfg, {});
});

test('loadRechargeProviderConfigFromEnv reads RECHARGE_GOOGLE_PLAY_VERIFY_URL into google_play.verifyUrl', () => {
  const cfg = loadRechargeProviderConfigFromEnv({ RECHARGE_GOOGLE_PLAY_VERIFY_URL: 'https://gp.example/verify' });
  assert.deepEqual(cfg, { google_play: { verifyUrl: 'https://gp.example/verify' } });
});

test('loadRechargeProviderConfigFromEnv reads RECHARGE_APP_STORE_VERIFY_URL into app_store.verifyUrl', () => {
  const cfg = loadRechargeProviderConfigFromEnv({ RECHARGE_APP_STORE_VERIFY_URL: 'https://as.example/verify' });
  assert.deepEqual(cfg, { app_store: { verifyUrl: 'https://as.example/verify' } });
});

test('loadRechargeProviderConfigFromEnv reads both providers together when both env vars are set', () => {
  const cfg = loadRechargeProviderConfigFromEnv({
    RECHARGE_GOOGLE_PLAY_VERIFY_URL: 'https://gp.example/verify',
    RECHARGE_APP_STORE_VERIFY_URL: 'https://as.example/verify',
  });
  assert.deepEqual(cfg, {
    google_play: { verifyUrl: 'https://gp.example/verify' },
    app_store: { verifyUrl: 'https://as.example/verify' },
  });
});

// --- real env -> real service, end-to-end fail-closed sanity check ------
// (loadRechargeProviderConfigFromEnv(process.env) is exactly what
// src/index.js calls to build the config passed into createRechargeService
// -- this proves that wiring stays fail-closed in THIS sandbox's real,
// unmodified process.env, which has no RECHARGE_*_VERIFY_URL set.)
test('the real process.env in this sandbox has no recharge provider configured (matches the documented BLOCKED boundary)', () => {
  const cfg = loadRechargeProviderConfigFromEnv(process.env);
  assert.deepEqual(cfg, {}, 'if this fails, a real provider URL leaked into the test environment');
});
