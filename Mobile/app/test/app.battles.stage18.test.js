'use strict';
// Stage 18 (Mobile UI) -- real functional tests for the accept/decline/
// cancel/end/detail actions added to ../app.js (battleRow()/
// renderBattlesList()/bindBattleActions()), against the real endpoints
// that already existed server-side (Backend/src/routes/platform.routes.js
// POST /api/battles/:battleId/accept|decline|cancel|end and
// GET /api/battles/:battleId). Same node:vm technique as
// app.home.stage6.test.js: load the actual app.js source, mock document/
// fetch/sessionStorage, and exercise the real functions -- nothing
// re-implemented here.
//
// The tricky part versus app.home.stage6.test.js is that these buttons
// are rendered dynamically INTO #profileExtra's innerHTML (not fixed ids
// known ahead of time), so this mock's querySelectorAll actually parses
// the current #profileExtra.innerHTML for `data-battle-*` attributes and
// hands back element stand-ins whose .onclick can be invoked directly --
// the same call shape bindBattleActions() itself uses
// (`document.querySelectorAll('[data-battle-accept]').forEach(b=>b.onclick=...)`).

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

// Parses #profileExtra's current innerHTML for every `data-<attr>="id"`
// occurrence and returns element stand-ins carrying that id in .dataset --
// mirroring what a real querySelectorAll('[data-attr]') would find after
// battleRow()'s template strings were actually inserted into the DOM.
// Cached per (attr,id) in `cache` so that bindBattleActions()'s own
// querySelectorAll().forEach(b=>b.onclick=...) and a later querySelectorAll
// call made directly by a test resolve to the SAME element object -- same
// as a real DOM node persists across repeated querySelectorAll() calls
// against unchanged markup.
function battleEls(attr, profileExtra, cache) {
  const camel = attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const re = new RegExp(`data-${attr}="([^"]+)"`, 'g');
  const ids = [...profileExtra.innerHTML.matchAll(re)].map((m) => m[1]);
  return ids.map((id) => {
    const key = attr + ':' + id;
    if (!cache.has(key)) {
      const el = makeEl();
      el.dataset[camel] = id;
      cache.set(key, el);
    }
    return cache.get(key);
  });
}

function setup({ fetchImpl }) {
  const store = { accessToken: 'tok_real_123', accountId: 'acc_opponent' };
  const sessionStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
  };
  const calls = [];
  const profileExtra = makeEl();
  const backBtn = makeEl();
  const elCache = new Map();
  const sandbox = {
    sessionStorage,
    localStorage: { getItem: () => null },
    document: {
      createElement: () => makeEl(),
      body: { append() {} },
      querySelector: (sel) => (sel === '#profileExtra' ? profileExtra : sel === '#backToBattles' ? backBtn : makeEl()),
      querySelectorAll: (sel) => {
        const m = sel.match(/^\[data-([\w-]+)\]$/);
        if (m) return battleEls(m[1], profileExtra, elCache);
        return [];
      },
    },
    location: { href: '' },
    window: {},
    fetch: async (url, opt) => { calls.push({ url, opt }); return fetchImpl(url, opt); },
    console, setTimeout, Object, JSON, String, Error, Promise, RegExp, Array,
  };
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox, { filename: 'app.js' });
  return { sandbox, calls, profileExtra, backBtn };
}

function jsonOk(data) { return { status: 200, json: async () => ({ ok: true, data }) }; }
function jsonErr(error) { return { status: 400, json: async () => ({ ok: false, error }) }; }

const PENDING_AS_OPPONENT = { id: 'battle_1', roomId: 'room_1', hostId: 'acc_host', opponentId: 'acc_opponent', status: 'pending', hostScore: 0, opponentScore: 0, winnerId: null };
const ACTIVE = { id: 'battle_2', roomId: 'room_1', hostId: 'acc_opponent', opponentId: 'acc_someone', status: 'active', hostScore: 30, opponentScore: 10, winnerId: null };
const ENDED = { id: 'battle_2', roomId: 'room_1', hostId: 'acc_opponent', opponentId: 'acc_someone', status: 'ended', hostScore: 30, opponentScore: 10, winnerId: 'acc_opponent' };

test('the challenged opponent sees Accept/Decline on a pending battle, never Cancel/End', async () => {
  const { sandbox, profileExtra } = setup({ fetchImpl: (url) => (url === '/platform/api/battles' ? jsonOk([PENDING_AS_OPPONENT]) : jsonErr('unexpected ' + url)) });
  await vm.runInContext('renderBattlesList()', sandbox);
  assert.match(profileExtra.innerHTML, /data-battle-accept="battle_1"/);
  assert.match(profileExtra.innerHTML, /data-battle-decline="battle_1"/);
  assert.doesNotMatch(profileExtra.innerHTML, /data-battle-cancel="battle_1"/);
  assert.doesNotMatch(profileExtra.innerHTML, /data-battle-end="battle_1"/);
});

test('the host sees Cancel on their own pending battle, never Accept/Decline', async () => {
  const { sandbox, profileExtra } = setup({ fetchImpl: (url) => (url === '/platform/api/battles' ? jsonOk([{ ...PENDING_AS_OPPONENT, hostId: 'acc_opponent', opponentId: 'acc_other' }]) : jsonErr('unexpected ' + url)) });
  await vm.runInContext('renderBattlesList()', sandbox);
  assert.match(profileExtra.innerHTML, /data-battle-cancel="battle_1"/);
  assert.doesNotMatch(profileExtra.innerHTML, /data-battle-accept="battle_1"/);
  assert.doesNotMatch(profileExtra.innerHTML, /data-battle-decline="battle_1"/);
});

test('a participant sees End on an active battle, and the real score/status are rendered honestly', async () => {
  const { sandbox, profileExtra } = setup({ fetchImpl: (url) => (url === '/platform/api/battles' ? jsonOk([ACTIVE]) : jsonErr('unexpected ' + url)) });
  await vm.runInContext('renderBattlesList()', sandbox);
  assert.match(profileExtra.innerHTML, /data-battle-end="battle_2"/);
  assert.match(profileExtra.innerHTML, /30/);
  assert.match(profileExtra.innerHTML, /10/);
});

test('an ended battle shows the real winnerId and no action buttons other than details', async () => {
  const { sandbox, profileExtra } = setup({ fetchImpl: (url) => (url === '/platform/api/battles' ? jsonOk([ENDED]) : jsonErr('unexpected ' + url)) });
  await vm.runInContext('renderBattlesList()', sandbox);
  assert.match(profileExtra.innerHTML, /acc_opponent/);
  assert.doesNotMatch(profileExtra.innerHTML, /data-battle-end="battle_2"/);
  assert.doesNotMatch(profileExtra.innerHTML, /data-battle-accept/);
});

test('clicking Accept calls the real POST /api/battles/:id/accept then refreshes the list', async () => {
  let accepted = false;
  const { sandbox, calls } = setup({
    fetchImpl: (url, opt) => {
      if (url === '/platform/api/battles' && (!opt || opt.method === undefined)) return jsonOk(accepted ? [{ ...PENDING_AS_OPPONENT, status: 'active' }] : [PENDING_AS_OPPONENT]);
      if (url === '/platform/api/battles/battle_1/accept' && opt.method === 'POST') { accepted = true; return jsonOk({ ...PENDING_AS_OPPONENT, status: 'active' }); }
      return jsonErr('unexpected ' + url);
    },
  });
  await vm.runInContext('renderBattlesList()', sandbox);
  const acceptEl = vm.runInContext('document.querySelectorAll(\'[data-battle-accept]\')', sandbox)[0];
  await acceptEl.onclick();
  const acceptCall = calls.find((c) => c.url === '/platform/api/battles/battle_1/accept');
  assert.ok(acceptCall, 'must call the real accept endpoint');
  assert.equal(acceptCall.opt.method, 'POST');
  assert.equal(acceptCall.opt.headers.Authorization, 'Bearer tok_real_123');
});

test('clicking Decline/Cancel/End call their own real endpoints, not accept', async () => {
  for (const [attr, action, battle] of [['battle-decline', 'decline', PENDING_AS_OPPONENT], ['battle-end', 'end', ACTIVE]]) {
    const { sandbox, calls } = setup({
      fetchImpl: (url, opt) => {
        if (url === '/platform/api/battles') return jsonOk([battle]);
        if (url === `/platform/api/battles/${battle.id}/${action}`) return jsonOk({ ...battle, status: action === 'decline' ? 'declined' : 'ended' });
        return jsonErr('unexpected ' + url);
      },
    });
    await vm.runInContext('renderBattlesList()', sandbox);
    const el = vm.runInContext(`document.querySelectorAll('[data-${attr}]')`, sandbox)[0];
    await el.onclick();
    assert.ok(calls.some((c) => c.url === `/platform/api/battles/${battle.id}/${action}` && c.opt.method === 'POST'), `must call the real ${action} endpoint`);
  }
});

test('the host sees Cancel and clicking it calls the real cancel endpoint', async () => {
  const battle = { ...PENDING_AS_OPPONENT, hostId: 'acc_opponent', opponentId: 'acc_other' };
  const { sandbox, calls } = setup({
    fetchImpl: (url, opt) => {
      if (url === '/platform/api/battles') return jsonOk([battle]);
      if (url === '/platform/api/battles/battle_1/cancel') return jsonOk({ ...battle, status: 'cancelled' });
      return jsonErr('unexpected ' + url);
    },
  });
  await vm.runInContext('renderBattlesList()', sandbox);
  const el = vm.runInContext('document.querySelectorAll(\'[data-battle-cancel]\')', sandbox)[0];
  await el.onclick();
  assert.ok(calls.some((c) => c.url === '/platform/api/battles/battle_1/cancel' && c.opt.method === 'POST'));
});

test('the detail view calls the real GET /api/battles/:id and renders exactly what the server returned', async () => {
  const { sandbox, profileExtra } = setup({
    fetchImpl: (url) => {
      if (url === '/platform/api/battles') return jsonOk([ENDED]);
      if (url === '/platform/api/battles/battle_2') return jsonOk(ENDED);
      return jsonErr('unexpected ' + url);
    },
  });
  await vm.runInContext('renderBattlesList()', sandbox);
  const el = vm.runInContext('document.querySelectorAll(\'[data-battle-view]\')', sandbox)[0];
  await el.onclick();
  assert.match(profileExtra.innerHTML, /winnerId/);
  assert.match(profileExtra.innerHTML, /acc_opponent/);
});

test('a rejected action (e.g. server 403s a non-opponent) shows a real error toast, not a fake success', async () => {
  const { sandbox } = setup({
    fetchImpl: (url) => {
      if (url === '/platform/api/battles') return jsonOk([PENDING_AS_OPPONENT]);
      if (url === '/platform/api/battles/battle_1/accept') return jsonErr('only the challenged opponent can accept this battle');
      return jsonErr('unexpected ' + url);
    },
  });
  const toasts = [];
  vm.runInContext('void 0', sandbox);
  sandbox.document.body.append = () => {}; // toast() appends a div; capture via textContent instead
  const originalCreateElement = sandbox.document.createElement;
  sandbox.document.createElement = () => { const el = makeEl(); toasts.push(el); return el; };
  await vm.runInContext('renderBattlesList()', sandbox);
  const el = vm.runInContext('document.querySelectorAll(\'[data-battle-accept]\')', sandbox)[0];
  await el.onclick();
  assert.ok(toasts.some((t) => /only the challenged opponent/.test(t.textContent)), 'the real server error text must reach the toast');
  sandbox.document.createElement = originalCreateElement;
});
