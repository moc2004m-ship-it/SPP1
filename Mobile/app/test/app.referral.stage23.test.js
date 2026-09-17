'use strict';
// Stage 23 (Mobile UI) -- real functional tests for the Referral/Invite
// UI added to ../app.js (referralCodeCard()/renderMyReferralCode() and the
// #referralCode/#referralRedeem bindings in profile()), against the real
// endpoints that already existed server-side
// (Backend/src/routes/platform.routes.js: GET /api/referral/my-code,
// POST /api/referral/redeem). Same node:vm technique as
// app.battles.stage18.test.js: load the actual app.js source, mock
// document/fetch/sessionStorage/prompt, and exercise the real functions --
// nothing re-implemented here.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const APP_JS = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

function makeEl() {
  return {
    className: '', textContent: '', innerHTML: '', style: {}, value: '',
    dataset: {},
    addEventListener() {}, append() {}, remove() {},
    querySelectorAll: () => [], querySelector: () => null,
  };
}

// #referralCode/#referralRedeem are fixed ids bound once inside profile()
// (unlike the battle/game rows, which are re-parsed from dynamic
// innerHTML) -- so, like '#profileExtra' in the battle/game test files,
// they need to resolve to the SAME element object across repeated
// document.querySelector() calls for their onclick to be capturable and
// then invokable by a test.
function setup({ fetchImpl, promptImpl }) {
  const store = { accessToken: 'tok_real_123', accountId: 'acc_referrer' };
  const sessionStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
  };
  const calls = [];
  const promptCalls = [];
  const profileExtra = makeEl();
  const referralCodeBtn = makeEl();
  const referralRedeemBtn = makeEl();
  const toasts = [];
  const sandbox = {
    sessionStorage,
    localStorage: { getItem: () => null },
    document: {
      createElement: () => { const el = makeEl(); toasts.push(el); return el; },
      body: { append() {} },
      querySelector: (sel) => {
        if (sel === '#profileExtra') return profileExtra;
        if (sel === '#referralCode') return referralCodeBtn;
        if (sel === '#referralRedeem') return referralRedeemBtn;
        return makeEl();
      },
      querySelectorAll: () => [],
    },
    location: { href: '' },
    window: {},
    prompt: (msg) => { promptCalls.push(msg); return promptImpl ? promptImpl(msg) : null; },
    fetch: async (url, opt) => { calls.push({ url, opt }); return fetchImpl(url, opt); },
    console, setTimeout, Object, JSON, String, Error, Promise, RegExp, Array,
  };
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox, { filename: 'app.js' });
  return { sandbox, calls, promptCalls, profileExtra, referralCodeBtn, referralRedeemBtn, toasts };
}

function jsonOk(data) { return { status: 200, json: async () => ({ ok: true, data }) }; }
function jsonErr(error, status = 400) { return { status, json: async () => ({ ok: false, error }) }; }

const MY_CODE = { id: 's23_code_1', type: 'code', ownerId: 'acc_referrer', code: 'ABCD2345' };

test('renderMyReferralCode() calls the real GET /api/referral/my-code and renders the real code, not an invented one', async () => {
  const { sandbox, profileExtra, calls } = setup({
    fetchImpl: (url) => (url === '/platform/api/referral/my-code' ? jsonOk(MY_CODE) : jsonErr('unexpected ' + url)),
  });
  await vm.runInContext('renderMyReferralCode()', sandbox);
  assert.match(profileExtra.innerHTML, /ABCD2345/);
  const call = calls.find((c) => c.url === '/platform/api/referral/my-code');
  assert.ok(call, 'must call the real my-code endpoint');
  assert.equal(call.opt.headers.Authorization, 'Bearer tok_real_123');
});

test('clicking "كود الإحالة الخاص بي" in profile() is wired to the real my-code endpoint and renders the same code on repeat clicks (server idempotency, not a client cache)', async () => {
  const { sandbox, profileExtra, referralCodeBtn } = setup({
    fetchImpl: (url) => {
      if (url === '/platform/api/referral/my-code') return jsonOk(MY_CODE);
      return jsonErr('unexpected ' + url);
    },
  });
  await vm.runInContext('profile()', sandbox);
  assert.equal(typeof referralCodeBtn.onclick, 'function');
  await referralCodeBtn.onclick();
  assert.match(profileExtra.innerHTML, /ABCD2345/);
  // A second click re-fetches from the server rather than reusing a
  // client-side value -- and the server's own idempotency is what keeps
  // the code identical (see referral.service.test.js / feature-platform
  // referral.myCode tests for that guarantee at the service layer).
  profileExtra.innerHTML = '';
  await referralCodeBtn.onclick();
  assert.match(profileExtra.innerHTML, /ABCD2345/);
});

test('redeem: cancelling the code prompt makes no API call at all', async () => {
  const { calls, referralRedeemBtn, sandbox } = setup({
    fetchImpl: (url) => jsonErr('unexpected ' + url),
    promptImpl: () => null,
  });
  await vm.runInContext('profile()', sandbox);
  await referralRedeemBtn.onclick();
  assert.ok(!calls.some((c) => c.url === '/platform/api/referral/redeem'), 'no redeem call should be made when the prompt is cancelled');
});

test('redeem: a submitted code calls the real POST /api/referral/redeem with that exact code, refereeId never sent by the client, and renders the real completed redemption', async () => {
  const { calls, referralRedeemBtn, profileExtra, sandbox } = setup({
    fetchImpl: (url, opt) => {
      if (url === '/platform/api/referral/redeem' && opt.method === 'POST') {
        return jsonOk({ id: 's23_redeem_1', type: 'redemption', referrerId: 'acc_owner', refereeId: 'acc_referrer', code: 'FRIEND01', status: 'completed', walletTransactionId: 'wtx_1' });
      }
      return jsonErr('unexpected ' + url);
    },
    promptImpl: () => 'FRIEND01',
  });
  await vm.runInContext('profile()', sandbox);
  await referralRedeemBtn.onclick();
  const call = calls.find((c) => c.url === '/platform/api/referral/redeem');
  assert.ok(call, 'must call the real redeem endpoint');
  assert.equal(call.opt.method, 'POST');
  const body = JSON.parse(call.opt.body);
  assert.equal(body.code, 'FRIEND01');
  assert.equal('refereeId' in body, false, 'refereeId must never be sent by the client -- the server takes it from the session');
  assert.equal(call.opt.headers.Authorization, 'Bearer tok_real_123');
  assert.match(profileExtra.innerHTML, /completed/);
  assert.match(profileExtra.innerHTML, /wtx_1/);
});

test('redeem: a real server rejection (e.g. already redeemed / self-referral / unknown code) surfaces as a real toast, never a fake success', async () => {
  const { referralRedeemBtn, toasts, sandbox } = setup({
    fetchImpl: (url) => (url === '/platform/api/referral/redeem' ? jsonErr('you have already redeemed a referral code', 409) : jsonErr('unexpected ' + url)),
    promptImpl: () => 'SOMECODE',
  });
  await vm.runInContext('profile()', sandbox);
  await referralRedeemBtn.onclick();
  assert.ok(toasts.some((t) => /already redeemed/.test(t.textContent)), 'the real server error text must reach the toast');
});
