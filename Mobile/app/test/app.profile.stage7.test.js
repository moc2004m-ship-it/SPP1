'use strict';
// Stage 7/8 audit fix (Mobile UI) -- real functional tests for the gaps
// found during the Stage 7 completion audit: the profile() screen used to
// fetch only the plain GET /api/profile/:userId (base record: id/name/bio/
// avatarUrl) and render nothing but the name + account id, even though the
// real composed view (LVL/VIP/SVIP + live Followers/Following/Friends
// counts, already implemented and tested server-side in
// platform.profile.getFull(), see Backend/src/feature-platform.js) sat
// unused behind GET /api/profile/:userId/full. There was also no way for a
// user to ever call the already-existing, already-tested
// platform.profile.updatePrivacy() (POST /api/profile/privacy) from this
// app at all.
//
// Same node:vm technique as app.social.stage10.test.js: load the ACTUAL
// app.js source, mock document/fetch/sessionStorage/prompt, and exercise
// the real button handlers -- nothing re-implemented here. The underlying
// business rules (privacy gating, block enforcement, real counts) are
// exhaustively covered in Backend/test/feature-platform.test.js -- this
// file is deliberately only about the Mobile wiring.

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

function setup({ fetchImpl, promptAnswers = [] }) {
  const store = { accessToken: 'tok_real_123', accountId: 'acc_me' };
  const sessionStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
  };
  const calls = [];
  const elCache = new Map();
  const promptQueue = promptAnswers.slice();
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
    // Same fixed-answer-then-cancel convention as setupProfileActions()
    // in app.auth.test.js: once the queue is empty, further prompts are
    // treated as the user cancelling (null), never an infinite string.
    prompt: (..._args) => (promptQueue.length ? promptQueue.shift() : null),
    fetch: async (url, opt) => { calls.push({ url, opt }); return fetchImpl(url, opt); },
    console, setTimeout, Object, JSON, String, Error, Promise, encodeURIComponent,
  };
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox, { filename: 'app.js' });
  return { sandbox, calls, elCache };
}

function jsonOk(data) { return { status: 200, json: async () => ({ ok: true, data }) }; }

const SETTINGS_OK = (url) => (url === '/platform/api/settings/acc_me' ? jsonOk({}) : null);

test('profile(): fetches the real composed GET /api/profile/:userId/full (not just the base record) and renders LVL/VIP/SVIP, bio and real Followers/Following/Friends counts', async () => {
  const { sandbox, elCache } = setup({
    fetchImpl: (url) => {
      if (url === '/platform/api/profile/acc_me/full') {
        return jsonOk({ id: 'acc_me', name: 'Real Name', bio: 'my real bio', avatarUrl: 'https://example.com/a.png', lvl: 7, vip: 2, svip: 0, followersCount: 5, followingCount: 3, friendsCount: 2, privacyRestricted: false });
      }
      return SETTINGS_OK(url) || { status: 404, json: async () => ({ ok: false, error: 'unexpected ' + url }) };
    },
  });
  await vm.runInContext('profile()', sandbox);
  const html = elCache.get('#app').innerHTML;
  assert.match(html, /Real Name/);
  assert.match(html, /my real bio/);
  assert.match(html, /LVL 7/);
  assert.match(html, /VIP 2/);
  assert.match(html, /example\.com\/a\.png/);
  assert.match(html, /5/); // followersCount
  assert.match(html, /3/); // followingCount
});

test("profile(): a private profile viewed as a non-owner would return privacyRestricted -- for the caller's own profile this never happens, but the counts line must still be omitted honestly whenever the server withholds them", async () => {
  const { sandbox, elCache } = setup({
    fetchImpl: (url) => {
      if (url === '/platform/api/profile/acc_me/full') {
        return jsonOk({ id: 'acc_me', name: 'Restricted', bio: null, privacyRestricted: true });
      }
      return SETTINGS_OK(url) || { status: 404, json: async () => ({ ok: false, error: 'unexpected ' + url }) };
    },
  });
  await vm.runInContext('profile()', sandbox);
  const html = elCache.get('#app').innerHTML;
  assert.match(html, /Restricted/);
  assert.doesNotMatch(html, /الأصدقاء: /);
});

test('profile(): falls back to the plain GET /api/profile/:userId when /full fails (e.g. no profile created yet), still rendering the honest "no profile" state', async () => {
  const { sandbox, elCache } = setup({
    fetchImpl: (url) => {
      if (url === '/platform/api/profile/acc_me/full') return { status: 404, json: async () => ({ ok: false, error: 'not found' }) };
      if (url === '/platform/api/profile/acc_me') return jsonOk(null);
      return SETTINGS_OK(url) || { status: 404, json: async () => ({ ok: false, error: 'unexpected ' + url }) };
    },
  });
  await vm.runInContext('profile()', sandbox);
  const html = elCache.get('#app').innerHTML;
  assert.match(html, /حساب بلا ملف بعد/);
});

test('#createProfile: prompts for name, bio and avatarUrl (pre-filled with the real current values) and POSTs all three to the real upsert endpoint', async () => {
  const { sandbox, calls, elCache } = setup({
    promptAnswers: ['Updated Name', 'updated bio', 'https://example.com/new.png'],
    fetchImpl: (url, opt) => {
      if (url === '/platform/api/profile/acc_me/full') {
        return jsonOk({ id: 'acc_me', name: 'Old Name', bio: 'old bio', avatarUrl: 'https://example.com/old.png' });
      }
      if (url === '/platform/api/profile' && opt.method === 'POST') return jsonOk({ id: 'acc_me' });
      return SETTINGS_OK(url) || { status: 404, json: async () => ({ ok: false, error: 'unexpected ' + url }) };
    },
  });
  await vm.runInContext('profile()', sandbox);
  await elCache.get('#createProfile').onclick();
  const call = calls.find((c) => c.url === '/platform/api/profile' && c.opt.method === 'POST');
  assert.ok(call, 'POST /api/profile was called');
  assert.deepEqual(JSON.parse(call.opt.body), { name: 'Updated Name', bio: 'updated bio', avatarUrl: 'https://example.com/new.png' });
});

test("#createProfile: a bio prompt answered with an explicit empty string still saves (clears the bio) -- only a cancelled (null) prompt aborts the action", async () => {
  const { sandbox, calls, elCache } = setup({
    promptAnswers: ['Same Name', '', 'https://example.com/old.png'],
    fetchImpl: (url, opt) => {
      if (url === '/platform/api/profile/acc_me/full') return jsonOk({ id: 'acc_me', name: 'Same Name', bio: 'old bio', avatarUrl: 'https://example.com/old.png' });
      if (url === '/platform/api/profile' && opt.method === 'POST') return jsonOk({ id: 'acc_me' });
      return SETTINGS_OK(url) || { status: 404, json: async () => ({ ok: false, error: 'unexpected ' + url }) };
    },
  });
  await vm.runInContext('profile()', sandbox);
  await elCache.get('#createProfile').onclick();
  const call = calls.find((c) => c.url === '/platform/api/profile' && c.opt.method === 'POST');
  assert.ok(call, 'an explicit empty bio must still save, not be treated as cancel');
  assert.deepEqual(JSON.parse(call.opt.body), { name: 'Same Name', bio: '', avatarUrl: 'https://example.com/old.png' });
});

test('#createProfile: cancelling the name prompt (null) never calls the backend', async () => {
  const { sandbox, calls, elCache } = setup({
    promptAnswers: [null],
    fetchImpl: (url) => {
      if (url === '/platform/api/profile/acc_me/full') return jsonOk({ id: 'acc_me', name: 'X' });
      return SETTINGS_OK(url) || { status: 404, json: async () => ({ ok: false, error: 'unexpected ' + url }) };
    },
  });
  await vm.runInContext('profile()', sandbox);
  await elCache.get('#createProfile').onclick();
  assert.equal(calls.some((c) => c.url === '/platform/api/profile' && c.opt && c.opt.method === 'POST'), false);
});

test('#editPrivacy: prompts for a field then a value, and POSTs only that one field as a partial patch to the real updatePrivacy endpoint', async () => {
  const { sandbox, calls, elCache } = setup({
    promptAnswers: ['profileVisibility', 'friends'],
    fetchImpl: (url, opt) => {
      if (url === '/platform/api/profile/acc_me/full') return jsonOk({ id: 'acc_me', name: 'X' });
      if (url === '/platform/api/profile/privacy' && opt.method === 'POST') return jsonOk({ id: 'acc_me', privacy: { profileVisibility: 'friends' } });
      return SETTINGS_OK(url) || { status: 404, json: async () => ({ ok: false, error: 'unexpected ' + url }) };
    },
  });
  await vm.runInContext('profile()', sandbox);
  await elCache.get('#editPrivacy').onclick();
  const call = calls.find((c) => c.url === '/platform/api/profile/privacy' && c.opt.method === 'POST');
  assert.ok(call, 'POST /api/profile/privacy was called');
  assert.deepEqual(JSON.parse(call.opt.body), { profileVisibility: 'friends' });
  assert.match(elCache.get('#profileExtra').innerHTML, /friends/);
});

test('#editPrivacy: a boolean field ("discoverable") sends a real boolean, not the raw yes/no string', async () => {
  const { sandbox, calls, elCache } = setup({
    promptAnswers: ['discoverable', 'no'],
    fetchImpl: (url, opt) => {
      if (url === '/platform/api/profile/acc_me/full') return jsonOk({ id: 'acc_me', name: 'X' });
      if (url === '/platform/api/profile/privacy' && opt.method === 'POST') return jsonOk({ id: 'acc_me', privacy: { discoverable: false } });
      return SETTINGS_OK(url) || { status: 404, json: async () => ({ ok: false, error: 'unexpected ' + url }) };
    },
  });
  await vm.runInContext('profile()', sandbox);
  await elCache.get('#editPrivacy').onclick();
  const call = calls.find((c) => c.url === '/platform/api/profile/privacy' && c.opt.method === 'POST');
  assert.deepEqual(JSON.parse(call.opt.body), { discoverable: false });
});

test('#editPrivacy: an unrecognized field name is rejected client-side without ever calling the backend', async () => {
  const { sandbox, calls, elCache } = setup({
    promptAnswers: ['notARealField'],
    fetchImpl: (url) => {
      if (url === '/platform/api/profile/acc_me/full') return jsonOk({ id: 'acc_me', name: 'X' });
      return SETTINGS_OK(url) || { status: 404, json: async () => ({ ok: false, error: 'unexpected ' + url }) };
    },
  });
  await vm.runInContext('profile()', sandbox);
  await elCache.get('#editPrivacy').onclick();
  assert.equal(calls.some((c) => c.url === '/platform/api/profile/privacy'), false);
});

// ---------------------------------------------------------------------
// Stage 7 completion (this session) -- Family/Couple/Gifts rendering.
// Backend/src/feature-platform.js's profile.getFull() now composes these
// three real fields onto the SAME /full response this file already
// mocks above; these tests only prove the Mobile rendering wiring
// (profileFamilyCoupleLine()/profileGiftsLine() in app.js), not the
// business rules themselves (privacy gating, contribution thresholds,
// partner resolution) -- those are exhaustively covered in
// Backend/test/feature-platform.test.js's own Stage 7 completion tests.
// ---------------------------------------------------------------------

test('profile(): renders real Family title and Couple status as public standing (same tier as LVL/VIP/SVIP)', async () => {
  const { sandbox, elCache } = setup({
    fetchImpl: (url) => {
      if (url === '/platform/api/profile/acc_me/full') {
        return jsonOk({
          id: 'acc_me', name: 'Real Name', lvl: 7, vip: 2, svip: 0,
          family: { familyId: 'fam_1', title: 'pillar', badges: ['first_500', 'first_1000', 'first_5000'] },
          couple: { coupleId: 'cpl_1', partnerId: 'acc_partner', level: 3 },
          followersCount: 5, followingCount: 3, friendsCount: 2, privacyRestricted: false,
        });
      }
      return SETTINGS_OK(url) || { status: 404, json: async () => ({ ok: false, error: 'unexpected ' + url }) };
    },
  });
  await vm.runInContext('profile()', sandbox);
  const html = elCache.get('#app').innerHTML;
  assert.match(html, /pillar/);
  assert.match(html, /CP LVL 3/);
});

test('profile(): a privacyRestricted response for the caller\'s own profile never happens, but family/couple must still render even when it does (they are not privacy-gated, unlike counts/gifts)', async () => {
  const { sandbox, elCache } = setup({
    fetchImpl: (url) => {
      if (url === '/platform/api/profile/acc_me/full') {
        return jsonOk({
          id: 'acc_me', name: 'Restricted', bio: null, privacyRestricted: true,
          family: { familyId: 'fam_1', title: 'legend', badges: [] },
          couple: { coupleId: 'cpl_1', partnerId: 'acc_partner', level: 1 },
        });
      }
      return SETTINGS_OK(url) || { status: 404, json: async () => ({ ok: false, error: 'unexpected ' + url }) };
    },
  });
  await vm.runInContext('profile()', sandbox);
  const html = elCache.get('#app').innerHTML;
  assert.match(html, /legend/);
  assert.match(html, /CP LVL 1/);
  assert.doesNotMatch(html, /الأصدقاء: /);
});

test('profile(): a user with no family/couple shows neither line (no fake "no family" placeholder)', async () => {
  const { sandbox, elCache } = setup({
    fetchImpl: (url) => {
      if (url === '/platform/api/profile/acc_me/full') {
        return jsonOk({ id: 'acc_me', name: 'Solo', lvl: 1, vip: 0, svip: 0, followersCount: 0, followingCount: 0, friendsCount: 0, privacyRestricted: false });
      }
      return SETTINGS_OK(url) || { status: 404, json: async () => ({ ok: false, error: 'unexpected ' + url }) };
    },
  });
  await vm.runInContext('profile()', sandbox);
  const html = elCache.get('#app').innerHTML;
  assert.doesNotMatch(html, /عائلة:/);
  assert.doesNotMatch(html, /مرتبط/);
});

test('profile(): renders real Gifts-received count/total, gated the same as followers/following/friends (absent when privacyRestricted)', async () => {
  const { sandbox, elCache } = setup({
    fetchImpl: (url) => {
      if (url === '/platform/api/profile/acc_me/full') {
        return jsonOk({ id: 'acc_me', name: 'Gifted', gifts: { count: 4, totalCoins: 1500 }, followersCount: 1, followingCount: 1, friendsCount: 0, privacyRestricted: false });
      }
      return SETTINGS_OK(url) || { status: 404, json: async () => ({ ok: false, error: 'unexpected ' + url }) };
    },
  });
  await vm.runInContext('profile()', sandbox);
  const html = elCache.get('#app').innerHTML;
  assert.match(html, /الهدايا المستلمة: 4/);
  assert.match(html, /1500/);
});

test('profile(): a privacyRestricted response never renders the gifts line, even if the field were somehow present', async () => {
  const { sandbox, elCache } = setup({
    fetchImpl: (url) => {
      if (url === '/platform/api/profile/acc_me/full') {
        return jsonOk({ id: 'acc_me', name: 'Restricted', privacyRestricted: true, gifts: { count: 99, totalCoins: 99999 } });
      }
      return SETTINGS_OK(url) || { status: 404, json: async () => ({ ok: false, error: 'unexpected ' + url }) };
    },
  });
  await vm.runInContext('profile()', sandbox);
  const html = elCache.get('#app').innerHTML;
  assert.doesNotMatch(html, /الهدايا المستلمة/);
});

// ---------------------------------------------------------------------
// Stage 7 internal gap fix (this session) -- #shareProfile. Backend's
// profile.shareLink() / GET /api/profile/:userId/share already existed,
// fully tested (feature-platform.test.js), before this session -- the
// only thing missing was Mobile wiring. These tests prove the REAL
// endpoint is called for the real session's own userId and that the
// REAL server-returned deepLink is rendered, never a fabricated local
// link. Same node:vm technique as every other test in this file --
// nothing about shareLink()'s own business logic is re-tested here,
// only the Mobile button -> endpoint -> render wiring.
// ---------------------------------------------------------------------

test('#shareProfile: calls the real GET /api/profile/:userId/share endpoint for the caller\'s own session userId and renders the real deepLink the server returns', async () => {
  const { sandbox, calls, elCache } = setup({
    fetchImpl: (url) => {
      if (url === '/platform/api/profile/acc_me/full') return jsonOk({ id: 'acc_me', name: 'X' });
      if (url === '/platform/api/profile/acc_me/share') return jsonOk({ deepLink: 'app://profile/acc_me' });
      return SETTINGS_OK(url) || { status: 404, json: async () => ({ ok: false, error: 'unexpected ' + url }) };
    },
  });
  await vm.runInContext('profile()', sandbox);
  await elCache.get('#shareProfile').onclick();
  const call = calls.find((c) => c.url === '/platform/api/profile/acc_me/share');
  assert.ok(call, 'GET /api/profile/:userId/share was called');
  assert.equal(call.opt.method, undefined); // default GET, no body sent -- a pure read of the existing link
  assert.match(elCache.get('#profileExtra').innerHTML, /app:\/\/profile\/acc_me/);
});

test('#shareProfile: if the share call fails, shows the real error via toast and never renders a fabricated/local link', async () => {
  const toasts = [];
  const { sandbox, elCache } = setup({
    fetchImpl: (url) => {
      if (url === '/platform/api/profile/acc_me/full') return jsonOk({ id: 'acc_me', name: 'X' });
      if (url === '/platform/api/profile/acc_me/share') return { status: 500, json: async () => ({ ok: false, error: 'targetUserId is required' }) };
      return SETTINGS_OK(url) || { status: 404, json: async () => ({ ok: false, error: 'unexpected ' + url }) };
    },
  });
  sandbox.document.createElement = () => { const el = makeEl(); toasts.push(el); return el; };
  await vm.runInContext('profile()', sandbox);
  await elCache.get('#shareProfile').onclick();
  assert.equal(elCache.has('#profileExtra'), false, 'no fabricated link rendered on failure -- #profileExtra was never even written to');
  assert.ok(toasts.some((t) => t.textContent === 'targetUserId is required'), 'the real server error was surfaced');
});
