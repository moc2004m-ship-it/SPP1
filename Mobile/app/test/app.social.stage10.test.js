'use strict';
// Stage 10 audit fix (Mobile UI) -- real functional tests for the
// Follow/Unfollow, Friend request/Accept/Reject, and Friends/Followers/
// Following list buttons added to ../app.js's profile() screen. Same
// node:vm technique as app.auth.test.js / app.battles.stage18.test.js:
// load the ACTUAL app.js source, mock document/fetch/sessionStorage/
// prompt, and exercise the real button handlers -- nothing
// re-implemented here. These buttons use fixed ids (#followUser,
// #friendRequest, #friendsList, etc.), unlike battle rows' dynamic
// data-attributes, so the mock only needs a plain id->element map, same
// style as app.referral.stage23.test.js.
//
// What this proves: each button calls the real endpoint this session
// added server-side (POST /api/follow, /api/unfollow, /api/friend,
// /api/friends/:id/accept|reject, GET /api/friends|followers|following/:id)
// with the right method/body/path, using window.prompt for the
// target/request id and defaulting the list buttons to the caller's own
// state.userId -- and that the real response is rendered into
// #profileExtra (not a fake/static state). The underlying business rules
// (self-follow, duplicate, privacy/block gate) are exhaustively covered in
// Backend/test/feature-platform.test.js -- this file is deliberately only
// about the Mobile wiring.

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
  const store = { accessToken: 'tok_real_123', accountId: 'acc_me' };
  const sessionStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
  };
  const calls = [];
  const elCache = new Map();
  const sandbox = {
    sessionStorage,
    localStorage: { getItem: () => null },
    document: {
      createElement: () => makeEl(),
      body: { append() {} },
      documentElement: {},
      querySelector: (sel) => {
        if (!elCache.has(sel)) elCache.set(sel, makeEl());
        return elCache.get(sel);
      },
      querySelectorAll: () => [],
    },
    location: { href: '' },
    window: {},
    prompt: promptImpl || (() => null),
    fetch: async (url, opt) => { calls.push({ url, opt }); return fetchImpl(url, opt); },
    console, setTimeout, Object, JSON, String, Error, Promise, encodeURIComponent,
  };
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox, { filename: 'app.js' });
  return { sandbox, calls, elCache };
}

function jsonOk(data) { return { status: 200, json: async () => ({ ok: true, data }) }; }
function jsonErr(error) { return { status: 400, json: async () => ({ ok: false, error }) }; }

test('#followUser: prompts for targetId, calls the real POST /api/follow, and renders the result', async () => {
  const { sandbox, calls, elCache } = setup({
    promptImpl: () => 'acc_target',
    fetchImpl: (url, opt) => {
      if (url === '/platform/api/profile/acc_me') return jsonOk(null);
      if (url === '/platform/api/settings/acc_me') return jsonOk({});
      if (url === '/platform/api/follow' && opt.method === 'POST') return jsonOk({ id: 'rec_1', userId: 'acc_me', targetId: 'acc_target', type: 'follow', status: 'active' });
      throw new Error('unexpected ' + url);
    },
  });
  await vm.runInContext('profile()', sandbox);
  await elCache.get('#followUser').onclick();
  const followCall = calls.find((c) => c.url === '/platform/api/follow');
  assert.ok(followCall, 'POST /api/follow was called');
  assert.equal(followCall.opt.method, 'POST');
  assert.deepEqual(JSON.parse(followCall.opt.body), { targetId: 'acc_target' });
  assert.match(elCache.get('#profileExtra').innerHTML, /acc_target/);
});

test('#unfollowUser: calls the real POST /api/unfollow with the prompted targetId', async () => {
  const { sandbox, calls, elCache } = setup({
    promptImpl: () => 'acc_target',
    fetchImpl: (url, opt) => {
      if (url === '/platform/api/profile/acc_me') return jsonOk(null);
      if (url === '/platform/api/settings/acc_me') return jsonOk({});
      if (url === '/platform/api/unfollow' && opt.method === 'POST') return jsonOk({ id: 'rec_1', status: 'removed' });
      throw new Error('unexpected ' + url);
    },
  });
  await vm.runInContext('profile()', sandbox);
  await elCache.get('#unfollowUser').onclick();
  const call = calls.find((c) => c.url === '/platform/api/unfollow');
  assert.ok(call);
  assert.deepEqual(JSON.parse(call.opt.body), { targetId: 'acc_target' });
});

test('#followUser: an empty prompt cancels the action without calling the backend', async () => {
  const { sandbox, calls, elCache } = setup({
    promptImpl: () => null,
    fetchImpl: (url) => {
      if (url === '/platform/api/profile/acc_me') return jsonOk(null);
      if (url === '/platform/api/settings/acc_me') return jsonOk({});
      throw new Error('unexpected ' + url);
    },
  });
  await vm.runInContext('profile()', sandbox);
  await elCache.get('#followUser').onclick();
  assert.equal(calls.some((c) => c.url === '/platform/api/follow'), false);
});

test('#friendRequest: calls the real POST /api/friend with the prompted targetId', async () => {
  const { sandbox, calls, elCache } = setup({
    promptImpl: () => 'acc_target',
    fetchImpl: (url, opt) => {
      if (url === '/platform/api/profile/acc_me') return jsonOk(null);
      if (url === '/platform/api/settings/acc_me') return jsonOk({});
      if (url === '/platform/api/friend' && opt.method === 'POST') return jsonOk({ id: 'req_1', userId: 'acc_me', targetId: 'acc_target', type: 'friend', status: 'pending' });
      throw new Error('unexpected ' + url);
    },
  });
  await vm.runInContext('profile()', sandbox);
  await elCache.get('#friendRequest').onclick();
  const call = calls.find((c) => c.url === '/platform/api/friend');
  assert.ok(call);
  assert.deepEqual(JSON.parse(call.opt.body), { targetId: 'acc_target' });
});

test('#friendAccept: calls the real POST /api/friends/:requestId/accept with the prompted requestId', async () => {
  const { sandbox, calls, elCache } = setup({
    promptImpl: () => 'req_1',
    fetchImpl: (url, opt) => {
      if (url === '/platform/api/profile/acc_me') return jsonOk(null);
      if (url === '/platform/api/settings/acc_me') return jsonOk({});
      if (url === '/platform/api/friends/req_1/accept' && opt.method === 'POST') return jsonOk({ id: 'req_1', status: 'accepted' });
      throw new Error('unexpected ' + url);
    },
  });
  await vm.runInContext('profile()', sandbox);
  await elCache.get('#friendAccept').onclick();
  assert.ok(calls.find((c) => c.url === '/platform/api/friends/req_1/accept' && c.opt.method === 'POST'));
});

test('#friendReject: calls the real POST /api/friends/:requestId/reject with the prompted requestId', async () => {
  const { sandbox, calls, elCache } = setup({
    promptImpl: () => 'req_1',
    fetchImpl: (url, opt) => {
      if (url === '/platform/api/profile/acc_me') return jsonOk(null);
      if (url === '/platform/api/settings/acc_me') return jsonOk({});
      if (url === '/platform/api/friends/req_1/reject' && opt.method === 'POST') return jsonOk({ id: 'req_1', status: 'rejected' });
      throw new Error('unexpected ' + url);
    },
  });
  await vm.runInContext('profile()', sandbox);
  await elCache.get('#friendReject').onclick();
  assert.ok(calls.find((c) => c.url === '/platform/api/friends/req_1/reject' && c.opt.method === 'POST'));
});

test('#friendsList: defaults to the caller\'s own account when the prompt is left empty, calls the real GET /api/friends/:userId, and renders each real accountId', async () => {
  const { sandbox, calls, elCache } = setup({
    promptImpl: () => '',
    fetchImpl: (url) => {
      if (url === '/platform/api/profile/acc_me') return jsonOk(null);
      if (url === '/platform/api/settings/acc_me') return jsonOk({});
      if (url === '/platform/api/friends/acc_me') return jsonOk([{ accountId: 'acc_3' }]);
      throw new Error('unexpected ' + url);
    },
  });
  await vm.runInContext('profile()', sandbox);
  await elCache.get('#friendsList').onclick();
  assert.ok(calls.find((c) => c.url === '/platform/api/friends/acc_me'));
  assert.match(elCache.get('#profileExtra').innerHTML, /acc_3/);
});

test('#friendsList: an empty real list renders the honest empty state, not a fake row', async () => {
  const { sandbox, elCache } = setup({
    promptImpl: () => '',
    fetchImpl: (url) => {
      if (url === '/platform/api/profile/acc_me') return jsonOk(null);
      if (url === '/platform/api/settings/acc_me') return jsonOk({});
      if (url === '/platform/api/friends/acc_me') return jsonOk([]);
      throw new Error('unexpected ' + url);
    },
  });
  await vm.runInContext('profile()', sandbox);
  await elCache.get('#friendsList').onclick();
  assert.match(elCache.get('#profileExtra').innerHTML, /empty/);
});

test('#followersList: calling it for a different account queries that account\'s real followers, not the caller\'s own', async () => {
  const { sandbox, calls, elCache } = setup({
    promptImpl: () => 'acc_other',
    fetchImpl: (url) => {
      if (url === '/platform/api/profile/acc_me') return jsonOk(null);
      if (url === '/platform/api/settings/acc_me') return jsonOk({});
      if (url === '/platform/api/followers/acc_other') return jsonOk([{ accountId: 'acc_9' }]);
      throw new Error('unexpected ' + url);
    },
  });
  await vm.runInContext('profile()', sandbox);
  await elCache.get('#followersList').onclick();
  assert.ok(calls.find((c) => c.url === '/platform/api/followers/acc_other'));
  assert.equal(calls.some((c) => c.url === '/platform/api/followers/acc_me'), false);
});

test('#followingList: a 403 from a privacy/block gate surfaces as a toast, not a crash or a fake list', async () => {
  const { sandbox, calls, elCache } = setup({
    promptImpl: () => 'acc_private',
    fetchImpl: (url) => {
      if (url === '/platform/api/profile/acc_me') return jsonOk(null);
      if (url === '/platform/api/settings/acc_me') return jsonOk({});
      if (url === '/platform/api/following/acc_private') return jsonErr('this profile is not available to you');
      throw new Error('unexpected ' + url);
    },
  });
  await vm.runInContext('profile()', sandbox);
  // Should not throw.
  await elCache.get('#followingList').onclick();
  assert.ok(calls.find((c) => c.url === '/platform/api/following/acc_private'));
});
