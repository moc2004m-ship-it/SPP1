'use strict';
// Stage 25 (Mobile UI) -- real functional tests for the Recharge / Google
// Play Billing UI added to ../app.js (rechargePackageRow()/rechargeOrderRow()/
// renderRechargePackages()/renderMyRechargeOrders()/bindRechargeActions()
// and the #rechargePackages/#rechargeOrders bindings in wallet()), against
// the real endpoints that already exist server-side
// (Backend/src/routes/recharge.routes.js: GET /api/recharge/packages,
// POST /api/recharge/orders, POST /api/recharge/orders/:orderId/complete,
// GET /api/recharge/orders). Same node:vm technique as
// app.referral.stage23.test.js: load the actual app.js source, mock
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

function setup({ fetchImpl, promptImpl }) {
  const store = { accessToken: 'tok_real_123', accountId: 'acc_wallet_owner' };
  const sessionStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
  };
  const calls = [];
  const promptCalls = [];
  const walletExtra = makeEl();
  const rechargePackagesBtn = makeEl();
  const rechargeOrdersBtn = makeEl();
  // Buttons rendered dynamically inside #walletExtra's innerHTML
  // (data-recharge-buy/data-recharge-complete) are re-parsed on every
  // bindRechargeActions() call via document.querySelectorAll -- these
  // arrays are mutated by the test to simulate whatever the last
  // render produced, the same technique app.battles.stage18.test.js
  // uses for its dynamically-rendered rows.
  let dynamicButtons = [];
  const toasts = [];
  const sandbox = {
    sessionStorage,
    localStorage: { getItem: () => null },
    document: {
      createElement: () => { const el = makeEl(); toasts.push(el); return el; },
      body: { append() {} },
      querySelector: (sel) => {
        if (sel === '#walletExtra') return walletExtra;
        if (sel === '#rechargePackages') return rechargePackagesBtn;
        if (sel === '#rechargeOrders') return rechargeOrdersBtn;
        return makeEl();
      },
      querySelectorAll: (sel) => dynamicButtons.filter((b) => b.matches === sel),
    },
    location: { href: '' },
    window: {},
    prompt: (msg) => { promptCalls.push(msg); return promptImpl ? promptImpl(msg) : null; },
    fetch: async (url, opt) => { calls.push({ url, opt }); return fetchImpl(url, opt); },
    console, setTimeout, Object, JSON, String, Error, Promise, RegExp, Array, encodeURIComponent,
  };
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox, { filename: 'app.js' });
  return {
    sandbox, calls, promptCalls, walletExtra, rechargePackagesBtn, rechargeOrdersBtn, toasts,
    setDynamicButtons(defs) {
      // defs: array of { matches: '[data-recharge-buy]'|'[data-recharge-complete]', dataset: {...} }
      dynamicButtons = defs.map((d) => ({ ...makeEl(), matches: d.matches, dataset: d.dataset, onclick: null }));
      return dynamicButtons;
    },
  };
}

function jsonOk(data) { return { status: 200, json: async () => ({ ok: true, data }) }; }
function jsonErr(error, status = 400) { return { status, json: async () => ({ ok: false, error }) }; }

const PACKAGES = [
  { id: 'pkg_small', coins: 100 },
  { id: 'pkg_medium', coins: 550 },
  { id: 'pkg_large', coins: 1200 },
];

test('renderRechargePackages() calls the real GET /api/recharge/packages and renders the real, server-sorted catalog, not invented values', async () => {
  const { sandbox, walletExtra, calls } = setup({
    fetchImpl: (url) => (url === '/platform/api/recharge/packages' ? jsonOk(PACKAGES) : jsonErr('unexpected ' + url)),
  });
  await vm.runInContext('renderRechargePackages()', sandbox);
  assert.match(walletExtra.innerHTML, /100/);
  assert.match(walletExtra.innerHTML, /550/);
  assert.match(walletExtra.innerHTML, /1200/);
  assert.match(walletExtra.innerHTML, /pkg_small/);
  const call = calls.find((c) => c.url === '/platform/api/recharge/packages');
  assert.ok(call, 'must call the real packages endpoint');
  assert.equal(call.opt.headers.Authorization, 'Bearer tok_real_123');
});

test('clicking "شحن الرصيد (Google Play)" in wallet() is wired to the real packages endpoint', async () => {
  const { sandbox, walletExtra, rechargePackagesBtn } = setup({
    fetchImpl: (url) => {
      if (url.startsWith('/platform/api/wallet/')) {
        return url.endsWith('/balance') ? jsonOk({ coins: 0, diamonds: 0 }) : jsonOk([]);
      }
      if (url === '/platform/api/recharge/packages') return jsonOk(PACKAGES);
      return jsonErr('unexpected ' + url);
    },
  });
  await vm.runInContext('wallet()', sandbox);
  assert.equal(typeof rechargePackagesBtn.onclick, 'function');
  await rechargePackagesBtn.onclick();
  assert.match(walletExtra.innerHTML, /pkg_small/);
});

test('buying a package POSTs the real packageId with provider "google_play" to /api/recharge/orders, accountId never sent by the client', async () => {
  const { sandbox, calls, walletExtra, setDynamicButtons } = setup({
    fetchImpl: (url, opt) => {
      if (url === '/platform/api/recharge/orders' && opt.method === 'POST') {
        return jsonOk({ id: 'rchg_1', accountId: 'acc_wallet_owner', packageId: 'pkg_small', coinsToCredit: 100, provider: 'google_play', status: 'pending' });
      }
      return jsonErr('unexpected ' + url);
    },
  });
  await vm.runInContext('typeof bindRechargeActions', sandbox); // ensure loaded
  const [buyBtn] = setDynamicButtons([{ matches: '[data-recharge-buy]', dataset: { rechargeBuy: 'pkg_small' } }]);
  await vm.runInContext('bindRechargeActions()', sandbox);
  await buyBtn.onclick();
  const call = calls.find((c) => c.url === '/platform/api/recharge/orders');
  assert.ok(call, 'must call the real create-order endpoint');
  assert.equal(call.opt.method, 'POST');
  const body = JSON.parse(call.opt.body);
  assert.equal(body.packageId, 'pkg_small');
  assert.equal(body.provider, 'google_play');
  assert.equal('accountId' in body, false, 'accountId must never be sent by the client -- the server takes it from the session');
  assert.equal(call.opt.headers.Authorization, 'Bearer tok_real_123');
  assert.match(walletExtra.innerHTML, /rchg_1/);
  assert.match(walletExtra.innerHTML, /pending/);
});

test('completing a purchase: cancelling the purchase-token prompt makes no API call at all', async () => {
  const { sandbox, calls, setDynamicButtons } = setup({
    fetchImpl: (url) => jsonErr('unexpected ' + url),
    promptImpl: () => null,
  });
  const [completeBtn] = setDynamicButtons([{ matches: '[data-recharge-complete]', dataset: { rechargeComplete: 'rchg_1' } }]);
  await vm.runInContext('bindRechargeActions()', sandbox);
  await completeBtn.onclick();
  assert.ok(!calls.some((c) => c.url.includes('/complete')), 'no complete call should be made when the prompt is cancelled');
});

test('completing a purchase: a submitted purchase token calls the real POST /api/recharge/orders/:orderId/complete with that exact token and renders the real completed order', async () => {
  const { sandbox, calls, walletExtra, toasts, setDynamicButtons } = setup({
    fetchImpl: (url, opt) => {
      if (url === '/platform/api/recharge/orders/rchg_1/complete' && opt.method === 'POST') {
        return jsonOk({ id: 'rchg_1', accountId: 'acc_wallet_owner', coinsToCredit: 100, provider: 'google_play', status: 'completed' });
      }
      return jsonErr('unexpected ' + url);
    },
    promptImpl: () => 'real-google-play-token',
  });
  const [completeBtn] = setDynamicButtons([{ matches: '[data-recharge-complete]', dataset: { rechargeComplete: 'rchg_1' } }]);
  await vm.runInContext('bindRechargeActions()', sandbox);
  await completeBtn.onclick();
  const call = calls.find((c) => c.url === '/platform/api/recharge/orders/rchg_1/complete');
  assert.ok(call, 'must call the real complete endpoint with the orderId in the path');
  const body = JSON.parse(call.opt.body);
  assert.equal(body.providerPurchaseRef, 'real-google-play-token');
  assert.match(walletExtra.innerHTML, /completed/);
  assert.ok(toasts.some((t) => /نجاح/.test(t.textContent)));
});

test('completing a purchase: a real server rejection (e.g. unconfigured provider -> 503, or invalid purchase -> 402) surfaces as a real toast, never a fake success', async () => {
  const { sandbox, toasts, setDynamicButtons } = setup({
    fetchImpl: (url) =>
      url === '/platform/api/recharge/orders/rchg_1/complete'
        ? jsonErr('recharge provider "google_play" is not configured', 503)
        : jsonErr('unexpected ' + url),
    promptImpl: () => 'some-token',
  });
  const [completeBtn] = setDynamicButtons([{ matches: '[data-recharge-complete]', dataset: { rechargeComplete: 'rchg_1' } }]);
  await vm.runInContext('bindRechargeActions()', sandbox);
  await completeBtn.onclick();
  assert.ok(toasts.some((t) => /not configured/.test(t.textContent)), 'the real server error text must reach the toast, not a fabricated success');
});

test('renderMyRechargeOrders() calls the real GET /api/recharge/orders and renders the real orders, including a completed order with no "إكمال الشراء" button', async () => {
  const { sandbox, walletExtra } = setup({
    fetchImpl: (url) =>
      url === '/platform/api/recharge/orders'
        ? jsonOk([
            { id: 'rchg_done', accountId: 'acc_wallet_owner', coinsToCredit: 100, provider: 'google_play', status: 'completed' },
          ])
        : jsonErr('unexpected ' + url),
  });
  await vm.runInContext('renderMyRechargeOrders()', sandbox);
  assert.match(walletExtra.innerHTML, /rchg_done/);
  assert.doesNotMatch(walletExtra.innerHTML, /data-recharge-complete/, 'a completed order must not offer a complete-purchase button');
});

test('clicking "طلبات الشحن السابقة" in wallet() is wired to the real orders endpoint', async () => {
  const { sandbox, walletExtra, rechargeOrdersBtn } = setup({
    fetchImpl: (url) => {
      if (url.startsWith('/platform/api/wallet/')) {
        return url.endsWith('/balance') ? jsonOk({ coins: 0, diamonds: 0 }) : jsonOk([]);
      }
      if (url === '/platform/api/recharge/orders') return jsonOk([]);
      return jsonErr('unexpected ' + url);
    },
  });
  await vm.runInContext('wallet()', sandbox);
  assert.equal(typeof rechargeOrdersBtn.onclick, 'function');
  await rechargeOrdersBtn.onclick();
  assert.match(walletExtra.innerHTML, /لا توجد طلبات شحن بعد/);
});
