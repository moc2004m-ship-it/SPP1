'use strict';
// Phase 3 — real functional tests for the session/auth wiring between the
// Mobile shell (../app.js) and the real backend session model
// (Backend/src/auth/session-middleware.js, Backend/src/routes/platform.routes.js).
//
// These load the ACTUAL app.js / auth.js source via node:vm with a minimal
// document/fetch/sessionStorage shim -- they exercise the real client code,
// not a re-implementation of its logic. There is no browser and no real
// Express server available in this sandbox (no network to `npm install`
// express -- see ../../../PHASE2_DOMAINS_REPORT.md), so this is the
// strongest verification available here. A true end-to-end HTTP run
// against a live `npm start` backend is still open (see
// PHASE3_MOBILE_BACKEND_REPORT.md).

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const APP_JS = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const AUTH_JS = fs.readFileSync(path.join(__dirname, '../screens/auth/auth.js'), 'utf8');

function makeEl() {
  return {
    className: '', textContent: '', innerHTML: '', style: {},
    addEventListener() {}, append() {}, remove() {},
    querySelectorAll: () => [], querySelector: () => null,
  };
}

function runApp({ token, accountId, fetchImpl }) {
  const store = { accessToken: token, accountId };
  const sessionStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
  };
  const locationObj = { href: '' };
  const calls = [];
  const sandbox = {
    sessionStorage,
    localStorage: { getItem: () => null },
    document: { createElement: () => makeEl(), body: { append() {} }, querySelector: () => makeEl(), querySelectorAll: () => [] },
    location: locationObj,
    window: {},
    fetch: async (url, opt) => { calls.push({ url, opt }); return fetchImpl(url, opt); },
    console, setTimeout, Object, JSON, String, Error, Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox, { filename: 'app.js' });
  return { sandbox, calls, locationObj, sessionStorage };
}

test('unauthenticated load redirects to login without calling the backend', async () => {
  const { calls, locationObj } = runApp({
    token: null, accountId: null,
    fetchImpl: async () => { throw new Error('fetch must not be called with no session'); },
  });
  assert.equal(calls.length, 0);
  assert.equal(locationObj.href, 'screens/auth/index.html');
});

test('authenticated load sends the real Authorization bearer header', async () => {
  const { calls } = runApp({
    token: 'tok_real_123', accountId: 'acc_real_1',
    fetchImpl: async (url) => (url === '/platform/api/home'
      ? { status: 200, json: async () => ({ ok: true, data: { rooms: [], events: [] } }) }
      : { status: 404, json: async () => ({ ok: false, error: 'not found' }) }),
  });
  const homeCall = calls.find((c) => c.url === '/platform/api/home');
  assert.ok(homeCall, 'render() must call /platform/api/home');
  assert.equal(homeCall.opt.headers.Authorization, 'Bearer tok_real_123');
});

test('a 401 from the backend clears the session and redirects to login', async () => {
  const { sessionStorage, locationObj } = runApp({
    token: 'tok_expired', accountId: 'acc_real_1',
    fetchImpl: async (url) => (url === '/platform/api/home'
      ? { status: 401, json: async () => ({ error: 'unauthorized' }) }
      : { status: 404, json: async () => ({}) }),
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sessionStorage.getItem('accessToken'), null);
  assert.equal(locationObj.href, 'screens/auth/index.html');
});

test('wallet tab calls the real, own-account balance and ledger endpoints with the session token', async () => {
  const { calls, sandbox } = runApp({
    token: 'tok_real_123', accountId: 'acc_real_1',
    fetchImpl: async (url) => {
      if (url === '/platform/api/home') return { status: 200, json: async () => ({ ok: true, data: { rooms: [], events: [] } }) };
      if (url === '/platform/api/wallet/acc_real_1/balance') return { status: 200, json: async () => ({ ok: true, data: { accountId: 'acc_real_1', coins: 1500, diamonds: 3 } }) };
      if (url === '/platform/api/wallet/acc_real_1') return { status: 200, json: async () => ({ ok: true, data: [{ userId: 'acc_real_1', currency: 'coins', amount: 1500, referenceId: 'ref_1', status: 'settled' }] }) };
      return { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) };
    },
  });
  vm.runInContext("state.tab='wallet';", sandbox);
  await vm.runInContext('render()', sandbox);
  assert.ok(calls.find((c) => c.url === '/platform/api/wallet/acc_real_1/balance'));
  assert.ok(calls.find((c) => c.url === '/platform/api/wallet/acc_real_1'));
});

test('notifications action calls the real, own-account notifications endpoint with the session token', async () => {
  // Built directly with vm (not the runApp() helper above) because this
  // scenario needs a document mock that hands back a *specific* element for
  // '#notifications' (to capture the real onclick handler profile() assigns)
  // and for '#profileExtra' (to inspect the real innerHTML it renders into),
  // and that mock must be in place BEFORE the script's own trailing
  // `render();` call runs on load -- same real app.js file, no logic changes.
  const store = { accessToken: 'tok_real_123', accountId: 'acc_real_1' };
  const sessionStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
  };
  const calls = [];
  const clickHandlers = {};
  const notifEl = makeEl();
  const notifBtn = { set onclick(fn) { clickHandlers.notifications = fn; }, get onclick() { return clickHandlers.notifications; } };
  const sandbox = {
    sessionStorage,
    localStorage: { getItem: () => null },
    document: {
      createElement: () => makeEl(),
      body: { append() {} },
      querySelector: (sel) => (sel === '#notifications' ? notifBtn : sel === '#profileExtra' ? notifEl : makeEl()),
      querySelectorAll: () => [],
    },
    location: { href: '' },
    window: {},
    fetch: async (url, opt) => {
      calls.push({ url, opt });
      if (url === '/platform/api/home') return { status: 200, json: async () => ({ ok: true, data: { rooms: [], events: [] } }) };
      if (url === '/platform/api/profile/acc_real_1') return { status: 200, json: async () => ({ ok: true, data: null }) };
      if (url === '/platform/api/notifications/acc_real_1') {
        return { status: 200, json: async () => ({ ok: true, data: [{ type: 'follow', status: 'queued', createdAt: '2026-09-13T00:00:00.000Z' }] }) };
      }
      return { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) };
    },
    console, setTimeout, Object, JSON, String, Error, Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox, { filename: 'app.js' });
  vm.runInContext("state.tab='profile';", sandbox);
  // render() calls profile() without awaiting it (fire-and-forget, same as
  // it does for home()/rooms()/events()/wallet()), so its own returned
  // promise resolves before profile()'s internal await (the profile fetch)
  // finishes and wires up the button handlers. Same tick-wait pattern the
  // 401 test above already uses for this reason.
  await vm.runInContext('render()', sandbox);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(clickHandlers.notifications, 'profile() must wire an onclick handler for #notifications');
  await clickHandlers.notifications();
  const notifCall = calls.find((c) => c.url === '/platform/api/notifications/acc_real_1');
  assert.ok(notifCall, "clicking notifications must call /platform/api/notifications/:userId for the caller's own account");
  assert.equal(notifCall.opt.headers.Authorization, 'Bearer tok_real_123');
  assert.match(notifEl.innerHTML, /follow/);
});

// Shared harness for the six new write-only domain actions added to the
// profile screen (battles/games/gifts/family/settings/report/ticket). Same
// node:vm technique as the notifications test above: load the real app.js,
// mock document to hand back capturable elements for the specific button
// ids and for '#profileExtra', and script prompt() as a FIFO queue so each
// test can supply exactly the answers app.js's own prompt() calls expect,
// in the order it asks them -- no logic from app.js is reimplemented here.
function setupProfileActions({ fetchImpl, promptAnswers = [], confirmAnswer = true }) {
  const store = { accessToken: 'tok_real_123', accountId: 'acc_real_1' };
  const sessionStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
  };
  const calls = [];
  const clickHandlers = {};
  const buttonIds = [
    'battles', 'games', 'gifts', 'family', 'settingsBtn', 'report', 'ticket', 'block', 'unblock', 'muteUser', 'unmuteUser',
    'battlesList', 'gamesList', 'giftsWall', 'familiesList', 'settingsList', 'reportsList', 'ticketsList',
    'settingsTerms', 'settingsHelp', 'deleteAccount',
  ];
  const extraEl = makeEl();
  const buttons = {};
  for (const id of buttonIds) {
    buttons['#' + id] = { set onclick(fn) { clickHandlers[id] = fn; }, get onclick() { return clickHandlers[id]; } };
  }
  const promptQueue = promptAnswers.slice();
  const sandbox = {
    sessionStorage,
    localStorage: { getItem: () => null },
    document: {
      createElement: () => makeEl(),
      body: { append() {} },
      querySelector: (sel) => (sel === '#profileExtra' ? extraEl : buttons[sel] || makeEl()),
      querySelectorAll: () => [],
      // Stage 34 -- applySettingEffect('language', ...) writes to the
      // real <html lang>/<html dir> attributes (see app.js); a plain
      // object here lets tests assert the real effect happened.
      documentElement: { lang: '', dir: '' },
    },
    location: { href: '' },
    window: {},
    prompt: (..._args) => (promptQueue.length ? promptQueue.shift() : null),
    confirm: (..._args) => confirmAnswer,
    fetch: async (url, opt) => { calls.push({ url, opt }); return fetchImpl(url, opt); },
    console, setTimeout, Object, JSON, String, Error, Promise, Date, Math,
  };
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox, { filename: 'app.js' });
  return { sandbox, calls, clickHandlers, extraEl };
}

const HOME_OK = (url) => (url === '/platform/api/home' ? { status: 200, json: async () => ({ ok: true, data: { rooms: [], events: [] } }) } : null);
const PROFILE_OK = (url) => (url === '/platform/api/profile/acc_real_1' ? { status: 200, json: async () => ({ ok: true, data: null }) } : null);

async function loadProfile(sandbox) {
  vm.runInContext("state.tab='profile';", sandbox);
  await vm.runInContext('render()', sandbox);
  await new Promise((r) => setTimeout(r, 20));
}

test('battles action posts to the real create-battle endpoint with roomId/opponentId and shows the server response (no fake history)', async () => {
  const { sandbox, calls, clickHandlers, extraEl } = setupProfileActions({
    promptAnswers: ['room_1', 'acc_opponent_9'],
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/battles' ? { status: 200, json: async () => ({ ok: true, data: { id: 's18_1', roomId: 'room_1', hostId: 'acc_real_1', opponentId: 'acc_opponent_9', status: 'pending', matchId: 'match_1' } }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  assert.ok(clickHandlers.battles, 'profile() must wire an onclick handler for #battles');
  await clickHandlers.battles();
  const call = calls.find((c) => c.url === '/platform/api/battles');
  assert.ok(call, 'clicking the battle button must POST /platform/api/battles');
  assert.equal(call.opt.method, 'POST');
  assert.deepEqual(JSON.parse(call.opt.body), { roomId: 'room_1', opponentId: 'acc_opponent_9' });
  assert.equal(call.opt.headers.Authorization, 'Bearer tok_real_123');
  assert.match(extraEl.innerHTML, /match_1/);
  // Phase 4: GET /api/battles now exists, so the stale "no GET endpoint /
  // BLOCKED" notice must no longer be shown here.
  assert.doesNotMatch(extraEl.innerHTML, /BLOCKED/);
});

// Stage 19 (Mobile UI) -- this fixture was rewritten (not just extended).
// Before Stage 19's mobile work, clicking #games asked TWO free-text
// prompt()s -- roomId, then an unvalidated gameId string -- and directly
// POSTed /api/games with whatever the second prompt() returned. That
// interaction no longer exists: gameId is now chosen from the real server
// catalog (GET /api/games/catalog) via renderRoomGameCenter()'s buttons,
// never typed freehand, and the room's own existing Game Center lobby
// (GET /api/games?roomId=) is fetched and shown alongside it. So this test
// now asserts #games prompts ONLY for roomId, then fetches both real
// endpoints and renders the real catalog as buttons -- and a separate new
// test below (see app.games.stage19.test.js) exercises actually clicking
// one of those catalog buttons through to the real POST /api/games call,
// which the old single test used to check directly.
test('games action prompts only for roomId (no more free-text gameId prompt), then renders the real room game center + real catalog (Stage 19)', async () => {
  const { sandbox, calls, clickHandlers, extraEl } = setupProfileActions({
    promptAnswers: ['room_1'],
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/games?roomId=room_1' ? { status: 200, json: async () => ({ ok: true, data: [{ id: 's19_1', roomId: 'room_1', gameId: 'ludo', startedBy: 'acc_real_1', playerIds: ['acc_real_1'], state: 'lobby' }] }) } : null)
      || (url === '/platform/api/games/catalog' ? { status: 200, json: async () => ({ ok: true, data: [{ id: 'ludo', name: 'Ludo', minPlayers: 2, maxPlayers: 4 }, { id: 'chess', name: 'Chess', minPlayers: 2, maxPlayers: 2 }] }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  assert.ok(clickHandlers.games, 'profile() must wire an onclick handler for #games');
  await clickHandlers.games();
  const roomCall = calls.find((c) => c.url === '/platform/api/games?roomId=room_1');
  assert.ok(roomCall, 'clicking #games must GET the room\'s own real Game Center lobby');
  const catalogCall = calls.find((c) => c.url === '/platform/api/games/catalog');
  assert.ok(catalogCall, 'clicking #games must GET the real server catalog instead of using a free-text gameId prompt()');
  // Only one prompt() (roomId) was consumed -- a second free-text gameId
  // prompt() is never asked anymore.
  assert.match(extraEl.innerHTML, /Ludo/);
  assert.match(extraEl.innerHTML, /Chess/);
  assert.match(extraEl.innerHTML, /data-game-start-new="ludo"/);
  assert.match(extraEl.innerHTML, /data-game-start-new="chess"/);
  // The room's existing lobby (started by the caller) is rendered too,
  // with the host's real actions (start/cancel), never Join (the caller
  // is already the host/a player).
  assert.match(extraEl.innerHTML, /data-game-start="s19_1"/);
  assert.match(extraEl.innerHTML, /data-game-cancel="s19_1"/);
  assert.doesNotMatch(extraEl.innerHTML, /data-game-join="s19_1"/);
});

test('gifts action posts to the real send-gift endpoint with a client-minted referenceId', async () => {
  const { sandbox, calls, clickHandlers, extraEl } = setupProfileActions({
    promptAnswers: ['room_1', 'acc_receiver_2', 'gift_rose', '3'],
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/gifts/send' ? { status: 200, json: async () => ({ ok: true, data: { id: 's26_1', roomId: 'room_1', receiverId: 'acc_receiver_2', giftId: 'gift_rose', quantity: 3, status: 'pending' } }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  assert.ok(clickHandlers.gifts, 'profile() must wire an onclick handler for #gifts');
  await clickHandlers.gifts();
  const call = calls.find((c) => c.url === '/platform/api/gifts/send');
  assert.ok(call, 'clicking the gifts button must POST /platform/api/gifts/send');
  const body = JSON.parse(call.opt.body);
  assert.equal(body.roomId, 'room_1');
  assert.equal(body.receiverId, 'acc_receiver_2');
  assert.equal(body.giftId, 'gift_rose');
  assert.equal(body.quantity, 3);
  assert.ok(body.referenceId && typeof body.referenceId === 'string' && body.referenceId.length > 0, 'must send a non-empty client-minted referenceId');
  assert.match(extraEl.innerHTML, /gift_rose/);
});

test('family action posts to the real create-family endpoint with just a name (ownerId comes from the session)', async () => {
  const { sandbox, calls, clickHandlers, extraEl } = setupProfileActions({
    promptAnswers: ['Night Owls'],
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/families' ? { status: 200, json: async () => ({ ok: true, data: { id: 's30_1', ownerId: 'acc_real_1', name: 'Night Owls', level: 0, xp: 0 } }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  assert.ok(clickHandlers.family, 'profile() must wire an onclick handler for #family');
  await clickHandlers.family();
  const call = calls.find((c) => c.url === '/platform/api/families');
  assert.ok(call, 'clicking the family button must POST /platform/api/families');
  assert.deepEqual(JSON.parse(call.opt.body), { name: 'Night Owls' });
  assert.match(extraEl.innerHTML, /Night Owls/);
});

// Stage 34 -- rewritten (not just extended). The old free-text
// key/value prompt() pair (e.g. an arbitrary 'locale'/'ar') no longer
// matches reality: the real backend key catalog is exactly
// language/sound/mic/network/media (see settings.model.js's
// SETTING_KEYS), and app.js's #settingsBtn handler now prompts a second
// time with a key-appropriate question. This test uses the real
// 'language' key and asserts the real client-side effect
// (document.documentElement.lang/dir) is applied once the server
// confirms the write -- not just that a request was sent.
test('settings action posts a real key from the Stage 34 catalog and applies the real client-side effect (language)', async () => {
  const { sandbox, calls, clickHandlers, extraEl } = setupProfileActions({
    promptAnswers: ['language', 'en'],
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/settings/acc_real_1' ? { status: 200, json: async () => ({ ok: true, data: { language: 'ar', sound: true, mic: false, network: 'wifi_and_cellular', media: true } }) } : null)
      || (url === '/platform/api/settings' ? { status: 200, json: async () => ({ ok: true, data: { key: 'language', value: 'en', updatedAt: '2026-01-01T00:00:00.000Z' } }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  assert.ok(clickHandlers.settingsBtn, 'profile() must wire an onclick handler for #settingsBtn');
  await clickHandlers.settingsBtn();
  const call = calls.find((c) => c.url === '/platform/api/settings' && c.opt && c.opt.method === 'POST');
  assert.ok(call, 'clicking the settings button must POST /platform/api/settings');
  assert.deepEqual(JSON.parse(call.opt.body), { key: 'language', value: 'en' });
  assert.doesNotMatch(extraEl.innerHTML, /BLOCKED/);
  // Real effect: <html lang>/<html dir> actually changed, not just a
  // server round-trip.
  assert.equal(sandbox.document.documentElement.lang, 'en');
  assert.equal(sandbox.document.documentElement.dir, 'ltr');
});

test('settings action rejects an unknown key client-side without ever calling the server', async () => {
  const { sandbox, calls, clickHandlers } = setupProfileActions({
    promptAnswers: ['locale'],
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/settings/acc_real_1' ? { status: 200, json: async () => ({ ok: true, data: { language: 'ar', sound: true, mic: false, network: 'wifi_and_cellular', media: true } }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  await clickHandlers.settingsBtn();
  assert.ok(!calls.some((c) => c.url === '/platform/api/settings' && c.opt && c.opt.method === 'POST'), 'an out-of-catalog key must never reach the real settings endpoint');
});

test('report action posts to the real moderation-report endpoint (reporterId comes from the session)', async () => {
  const { sandbox, calls, clickHandlers, extraEl } = setupProfileActions({
    promptAnswers: ['acc_bad_actor', 'spamming the room'],
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/moderation/report' ? { status: 200, json: async () => ({ ok: true, data: { id: 's35_1', reporterId: 'acc_real_1', targetId: 'acc_bad_actor', reason: 'spamming the room', status: 'open' } }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  assert.ok(clickHandlers.report, 'profile() must wire an onclick handler for #report');
  await clickHandlers.report();
  const call = calls.find((c) => c.url === '/platform/api/moderation/report');
  assert.ok(call, 'clicking the report button must POST /platform/api/moderation/report');
  assert.deepEqual(JSON.parse(call.opt.body), { targetId: 'acc_bad_actor', reason: 'spamming the room' });
  assert.match(extraEl.innerHTML, /open/);
});

test('ticket action posts to the real support-tickets endpoint', async () => {
  const { sandbox, calls, clickHandlers, extraEl } = setupProfileActions({
    promptAnswers: ['billing', 'coins missing after purchase'],
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/support/tickets' ? { status: 200, json: async () => ({ ok: true, data: { id: 's35_2', reporterId: 'acc_real_1', type: 'billing', description: 'coins missing after purchase', status: 'open', messages: [] } }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  assert.ok(clickHandlers.ticket, 'profile() must wire an onclick handler for #ticket');
  await clickHandlers.ticket();
  const call = calls.find((c) => c.url === '/platform/api/support/tickets');
  assert.ok(call, 'clicking the ticket button must POST /platform/api/support/tickets');
  assert.deepEqual(JSON.parse(call.opt.body), { type: 'billing', description: 'coins missing after purchase' });
  assert.match(extraEl.innerHTML, /billing/);
});

// Stage 35 Part 2/8 -- Block/Unblock. Same "real backend round-trip, no
// fake local-only state" pattern as report/ticket above.
test('block action posts to the real block endpoint (blocking user comes from the session)', async () => {
  const { sandbox, calls, clickHandlers, extraEl } = setupProfileActions({
    promptAnswers: ['acc_bad_actor'],
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/block' ? { status: 200, json: async () => ({ ok: true, data: { id: 's8_1', userId: 'acc_real_1', targetId: 'acc_bad_actor', type: 'block', status: 'active' } }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  assert.ok(clickHandlers.block, 'profile() must wire an onclick handler for #block');
  await clickHandlers.block();
  const call = calls.find((c) => c.url === '/platform/api/block');
  assert.ok(call, 'clicking the block button must POST /platform/api/block');
  assert.deepEqual(JSON.parse(call.opt.body), { targetId: 'acc_bad_actor' });
  assert.match(extraEl.innerHTML, /active/);
});

test('unblock action posts to the real unblock endpoint (unblocking user comes from the session)', async () => {
  const { sandbox, calls, clickHandlers, extraEl } = setupProfileActions({
    promptAnswers: ['acc_bad_actor'],
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/unblock' ? { status: 200, json: async () => ({ ok: true, data: { id: 's8_1', userId: 'acc_real_1', targetId: 'acc_bad_actor', type: 'block', status: 'removed' } }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  assert.ok(clickHandlers.unblock, 'profile() must wire an onclick handler for #unblock');
  await clickHandlers.unblock();
  const call = calls.find((c) => c.url === '/platform/api/unblock');
  assert.ok(call, 'clicking the unblock button must POST /platform/api/unblock');
  assert.deepEqual(JSON.parse(call.opt.body), { targetId: 'acc_bad_actor' });
  assert.match(extraEl.innerHTML, /removed/);
});

test('block action is cancelled (never calls the server) if the targetId prompt is dismissed', async () => {
  const { sandbox, calls, clickHandlers } = setupProfileActions({
    promptAnswers: [null],
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url) || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  await clickHandlers.block();
  assert.ok(!calls.some((c) => c.url === '/platform/api/block'), 'dismissing the targetId prompt must never reach the real block endpoint');
});

// Stage 35 Part 3/8 -- Mute/Unmute a user. Same "real backend round-trip,
// no fake local-only state" pattern as block/unblock above, against the
// new (and distinct from block) /api/mute and /api/unmute endpoints.
test('muteUser action posts to the real mute endpoint (muting user comes from the session)', async () => {
  const { sandbox, calls, clickHandlers, extraEl } = setupProfileActions({
    promptAnswers: ['acc_annoying'],
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/mute' ? { status: 200, json: async () => ({ ok: true, data: { id: 's8_1', userId: 'acc_real_1', targetId: 'acc_annoying', type: 'mute', status: 'active' } }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  assert.ok(clickHandlers.muteUser, 'profile() must wire an onclick handler for #muteUser');
  await clickHandlers.muteUser();
  const call = calls.find((c) => c.url === '/platform/api/mute');
  assert.ok(call, 'clicking the mute button must POST /platform/api/mute');
  assert.deepEqual(JSON.parse(call.opt.body), { targetId: 'acc_annoying' });
  assert.match(extraEl.innerHTML, /active/);
});

test('unmuteUser action posts to the real unmute endpoint (unmuting user comes from the session)', async () => {
  const { sandbox, calls, clickHandlers, extraEl } = setupProfileActions({
    promptAnswers: ['acc_annoying'],
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/unmute' ? { status: 200, json: async () => ({ ok: true, data: { id: 's8_1', userId: 'acc_real_1', targetId: 'acc_annoying', type: 'mute', status: 'removed' } }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  assert.ok(clickHandlers.unmuteUser, 'profile() must wire an onclick handler for #unmuteUser');
  await clickHandlers.unmuteUser();
  const call = calls.find((c) => c.url === '/platform/api/unmute');
  assert.ok(call, 'clicking the unmute button must POST /platform/api/unmute');
  assert.deepEqual(JSON.parse(call.opt.body), { targetId: 'acc_annoying' });
  assert.match(extraEl.innerHTML, /removed/);
});

test('muteUser action is cancelled (never calls the server) if the targetId prompt is dismissed', async () => {
  const { sandbox, calls, clickHandlers } = setupProfileActions({
    promptAnswers: [null],
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url) || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  await clickHandlers.muteUser();
  assert.ok(!calls.some((c) => c.url === '/platform/api/mute'), 'dismissing the targetId prompt must never reach the real mute endpoint');
});

// Phase 4 -- read/list actions for the six domains, using the new real
// GET endpoints. Same setupProfileActions()/loadProfile() harness as the
// six write tests above: the real app.js is loaded via node:vm, only
// fetch/document/sessionStorage/prompt are shimmed.

test('battles list action calls the real GET /api/battles endpoint and renders the server response', async () => {
  // Stage 18 (Mobile UI) -- battles are now a real, dedicated domain (see
  // ../../Backend/src/services/battle.service.js), not the old generic
  // stage-18 store stub -- so the fixture here uses the real record shape
  // (hostScore/opponentScore/winnerId, no invented `matchId`) and this
  // asserts against the real role-aware rendering added by battleRow()/
  // renderBattlesList() in ../app.js, not the old generic kv() dump.
  const { sandbox, calls, clickHandlers, extraEl } = setupProfileActions({
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/battles' ? { status: 200, json: async () => ({ ok: true, data: [{ id: 's18_1', roomId: 'room_1', hostId: 'acc_real_1', opponentId: 'acc_opponent_9', status: 'pending', hostScore: 0, opponentScore: 0, winnerId: null }] }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  assert.ok(clickHandlers.battlesList, 'profile() must wire an onclick handler for #battlesList');
  await clickHandlers.battlesList();
  const call = calls.find((c) => c.url === '/platform/api/battles' && (!c.opt.method || c.opt.method === 'GET'));
  assert.ok(call, 'clicking the battles-list button must GET /platform/api/battles');
  assert.equal(call.opt.headers.Authorization, 'Bearer tok_real_123');
  assert.match(extraEl.innerHTML, /room_1/);
  assert.match(extraEl.innerHTML, /acc_opponent_9/);
  // The caller (acc_real_1) is this battle's host, so as host on a pending
  // challenge they should see Cancel, never Accept/Decline (those are for
  // the challenged opponent only).
  assert.match(extraEl.innerHTML, /data-battle-cancel="s18_1"/);
  assert.doesNotMatch(extraEl.innerHTML, /data-battle-accept/);
});

test('games list action calls the real GET /api/games endpoint and renders the server response', async () => {
  const { sandbox, clickHandlers, extraEl } = setupProfileActions({
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/games' ? { status: 200, json: async () => ({ ok: true, data: [{ id: 's19_1', roomId: 'room_1', gameId: 'game_ludo', startedBy: 'acc_real_1', matchId: 'match_2', state: 'lobby' }] }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  assert.ok(clickHandlers.gamesList, 'profile() must wire an onclick handler for #gamesList');
  await clickHandlers.gamesList();
  assert.match(extraEl.innerHTML, /game_ludo/);
  assert.match(extraEl.innerHTML, /lobby/);
});

test('gift wall action prompts for roomId and calls the real GET /api/gifts/wall/:roomId endpoint, rendering the real ranked totals (Stage 26)', async () => {
  const { sandbox, calls, clickHandlers, extraEl } = setupProfileActions({
    promptAnswers: ['room_1'],
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/gifts/wall/room_1' ? { status: 200, json: async () => ({ ok: true, data: { roomId: 'room_1', sessionId: 'gws_1', status: 'active', totalCoins: 130, gifters: [{ gifterId: 'acc_real_1', totalCoins: 100 }, { gifterId: 'acc_real_2', totalCoins: 30 }], topGifters: [{ gifterId: 'acc_real_1', totalCoins: 100 }, { gifterId: 'acc_real_2', totalCoins: 30 }] } }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  assert.ok(clickHandlers.giftsWall, 'profile() must wire an onclick handler for #giftsWall');
  await clickHandlers.giftsWall();
  const call = calls.find((c) => c.url === '/platform/api/gifts/wall/room_1');
  assert.ok(call, 'clicking the gift-wall button must GET /platform/api/gifts/wall/:roomId with the entered roomId');
  assert.match(extraEl.innerHTML, /acc_real_1/);
  assert.match(extraEl.innerHTML, /100/);
  assert.match(extraEl.innerHTML, /130/, 'must render the real server-computed session total, not a client-side sum');
});

test('gift wall action renders an honest empty wall when the room has no active session yet (Stage 26)', async () => {
  const { sandbox, clickHandlers, extraEl } = setupProfileActions({
    promptAnswers: ['room_2'],
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/gifts/wall/room_2' ? { status: 200, json: async () => ({ ok: true, data: { roomId: 'room_2', sessionId: null, status: 'inactive', totalCoins: 0, gifters: [], topGifters: [] } }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  await clickHandlers.giftsWall();
  assert.match(extraEl.innerHTML, /لا توجد هدايا/, 'must show the real empty-state message, never a fake gifter');
});

test('families list action calls the real GET /api/families endpoint and renders the server response', async () => {
  const { sandbox, clickHandlers, extraEl } = setupProfileActions({
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/families' ? { status: 200, json: async () => ({ ok: true, data: [{ id: 's30_1', ownerId: 'acc_real_1', name: 'Night Owls', level: 0, xp: 0 }] }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  assert.ok(clickHandlers.familiesList, 'profile() must wire an onclick handler for #familiesList');
  await clickHandlers.familiesList();
  assert.match(extraEl.innerHTML, /Night Owls/);
});

// Stage 34 -- rewritten: GET /api/settings/:userId now returns a single
// object of effective current values for all five real keys (real
// defaults filled in), not a raw append-only record list -- see
// settings.service.js#get()'s header for the shape change.
test('settings list action calls the real GET /api/settings/:userId endpoint and renders the effective current values for the caller\'s own account', async () => {
  const { sandbox, calls, clickHandlers, extraEl } = setupProfileActions({
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/settings/acc_real_1' ? { status: 200, json: async () => ({ ok: true, data: { language: 'ar', sound: true, mic: false, network: 'wifi_and_cellular', media: true } }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  assert.ok(clickHandlers.settingsList, 'profile() must wire an onclick handler for #settingsList');
  await clickHandlers.settingsList();
  const call = calls.find((c) => c.url === '/platform/api/settings/acc_real_1');
  assert.ok(call, "clicking the settings-list button must GET the caller's own /platform/api/settings/:userId");
  assert.match(extraEl.innerHTML, /language/);
  assert.match(extraEl.innerHTML, /wifi_and_cellular/);
});

test('terms action calls the real GET /api/settings/terms endpoint and renders real content', async () => {
  const { sandbox, clickHandlers, extraEl } = setupProfileActions({
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/settings/acc_real_1' ? { status: 200, json: async () => ({ ok: true, data: { language: 'ar', sound: true, mic: false, network: 'wifi_and_cellular', media: true } }) } : null)
      || (url === '/platform/api/settings/terms' ? { status: 200, json: async () => ({ ok: true, data: { version: 1, effectiveDate: '2026-01-01', title: 'Terms', sections: [{ heading: 'Intro', body: 'Real terms text.' }] } }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  assert.ok(clickHandlers.settingsTerms, 'profile() must wire an onclick handler for #settingsTerms');
  await clickHandlers.settingsTerms();
  assert.match(extraEl.innerHTML, /Terms/);
});

test('help action calls the real GET /api/settings/help endpoint and renders real content', async () => {
  const { sandbox, clickHandlers, extraEl } = setupProfileActions({
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/settings/acc_real_1' ? { status: 200, json: async () => ({ ok: true, data: { language: 'ar', sound: true, mic: false, network: 'wifi_and_cellular', media: true } }) } : null)
      || (url === '/platform/api/settings/help' ? { status: 200, json: async () => ({ ok: true, data: { version: 1, title: 'Help', sections: [{ heading: 'FAQ', body: 'Real help text.' }] } }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  assert.ok(clickHandlers.settingsHelp, 'profile() must wire an onclick handler for #settingsHelp');
  await clickHandlers.settingsHelp();
  assert.match(extraEl.innerHTML, /Help/);
});

// Stage 34 -- Delete Account. Real soft-delete + real force-logout: the
// client must call the real endpoint (no client-supplied target id --
// see settings.service.js#deleteAccount()'s signature), then discard its
// own real session token exactly like the existing #logout handler does.
test('delete account action confirms, posts to the real delete endpoint, and clears the real session', async () => {
  const { sandbox, calls, clickHandlers } = setupProfileActions({
    confirmAnswer: true,
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/settings/acc_real_1' ? { status: 200, json: async () => ({ ok: true, data: { language: 'ar', sound: true, mic: false, network: 'wifi_and_cellular', media: true } }) } : null)
      || (url === '/platform/api/settings/account/delete' ? { status: 200, json: async () => ({ ok: true, data: { accountId: 'acc_real_1', deletedAt: '2026-01-01T00:00:00.000Z', sessionsRevoked: 1 } }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  assert.ok(clickHandlers.deleteAccount, 'profile() must wire an onclick handler for #deleteAccount');
  await clickHandlers.deleteAccount();
  const call = calls.find((c) => c.url === '/platform/api/settings/account/delete');
  assert.ok(call, 'clicking delete account must POST the real /platform/api/settings/account/delete endpoint');
  assert.equal(call.opt.method, 'POST');
  assert.equal(sandbox.sessionStorage.getItem('accessToken'), null, 'the real local session token must be cleared after a real account deletion');
  assert.equal(sandbox.sessionStorage.getItem('accountId'), null);
});

test('delete account action does nothing if the user does not confirm', async () => {
  const { sandbox, calls, clickHandlers } = setupProfileActions({
    confirmAnswer: false,
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/settings/acc_real_1' ? { status: 200, json: async () => ({ ok: true, data: { language: 'ar', sound: true, mic: false, network: 'wifi_and_cellular', media: true } }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  await clickHandlers.deleteAccount();
  assert.ok(!calls.some((c) => c.url === '/platform/api/settings/account/delete'), 'declining the confirmation must never call the real delete endpoint');
  assert.equal(sandbox.sessionStorage.getItem('accessToken'), 'tok_real_123', 'the real session must be untouched when the user declines');
});

test('reports list action calls the real GET /api/moderation/reports endpoint', async () => {
  const { sandbox, clickHandlers, extraEl } = setupProfileActions({
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/moderation/reports' ? { status: 200, json: async () => ({ ok: true, data: [{ id: 's35_1', reporterId: 'acc_real_1', targetId: 'acc_bad_actor', reason: 'spamming the room', status: 'open' }] }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  assert.ok(clickHandlers.reportsList, 'profile() must wire an onclick handler for #reportsList');
  await clickHandlers.reportsList();
  assert.match(extraEl.innerHTML, /spamming the room/);
});

test('tickets list action calls the real GET /api/support/tickets endpoint', async () => {
  const { sandbox, clickHandlers, extraEl } = setupProfileActions({
    fetchImpl: async (url) => HOME_OK(url) || PROFILE_OK(url)
      || (url === '/platform/api/support/tickets' ? { status: 200, json: async () => ({ ok: true, data: [{ id: 's35_2', reporterId: 'acc_real_1', type: 'billing', description: 'coins missing after purchase', status: 'open', messages: [] }] }) } : null)
      || { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) },
  });
  await loadProfile(sandbox);
  assert.ok(clickHandlers.ticketsList, 'profile() must wire an onclick handler for #ticketsList');
  await clickHandlers.ticketsList();
  assert.match(extraEl.innerHTML, /coins missing after purchase/);
});

test('auth.js stores the real server-issued token+accountId and redirects into the app shell', async () => {
  const store = {};
  const sessionStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
  };
  const locationObj = { href: '' };
  const els = {
    phone: { value: '+213555' }, otp: { value: '123456' }, consent: { value: '1.0' },
    status: { textContent: '' }, send: { onclick: null }, verify: { onclick: null },
  };
  const calls = [];
  const sandbox = {
    document: { getElementById: (id) => els[id] },
    sessionStorage,
    location: locationObj,
    window: {},
    navigator: { userAgent: 'test-agent' },
    fetch: async (url, opt) => { calls.push({ url, opt }); return { ok: true, json: async () => ({ account: { id: 'acc_real_1' }, accessToken: 'tok_real_123' }) }; },
    console, Error, JSON, String,
  };
  vm.createContext(sandbox);
  vm.runInContext(AUTH_JS, sandbox, { filename: 'auth.js' });
  await els.verify.onclick();
  assert.ok(calls.find((c) => c.url === '/auth/otp/verify'));
  assert.equal(sessionStorage.getItem('accessToken'), 'tok_real_123');
  assert.equal(sessionStorage.getItem('accountId'), 'acc_real_1');
  assert.equal(locationObj.href, '../../index.html');
});

// --- Stage 13 -- real room-card Leave button (home() -> bindRooms()) ----
// Loads the ACTUAL app.js (same APP_JS source as runApp() above), with a
// document mock that is selector-aware for the two dynamically-rendered
// per-room buttons ([data-join]/[data-leave]) instead of runApp()'s
// always-empty querySelectorAll -- this is the real roomCard()/bindRooms()
// code path, not a re-implementation of it.
async function setupHomeRoomButtons({ room, fetchImpl }) {
  const store = { accessToken: 'tok_real_123', accountId: 'acc_real_1' };
  const sessionStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
  };
  const captured = {};
  const appEl = { innerHTML: '' };
  const joinBtn = { dataset: { join: room.id }, set onclick(fn) { captured.join = fn; }, get onclick() { return captured.join; } };
  const leaveBtn = { dataset: { leave: room.id }, set onclick(fn) { captured.leave = fn; }, get onclick() { return captured.leave; } };
  const calls = [];
  const sandbox = {
    sessionStorage,
    localStorage: { getItem: () => null },
    document: {
      querySelector: (sel) => (sel === '#app' ? appEl : null),
      querySelectorAll: (sel) => (sel === '[data-join]' ? [joinBtn] : sel === '[data-leave]' ? [leaveBtn] : []),
      createElement: () => ({ className: '', textContent: '', innerHTML: '', style: {}, remove() {} }),
      body: { append() {} },
    },
    location: { href: '' },
    window: {},
    fetch: async (url, opt) => { calls.push({ url, opt }); return fetchImpl(url, opt); },
    console, setTimeout, Object, JSON, String, Error, Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox, { filename: 'app.js' });
  // render() -> home() is async (awaits api() -> fetch() -> res.json()),
  // so the [data-join]/[data-leave] onclick handlers aren't wired yet the
  // instant vm.runInContext() returns synchronously. Flush the microtask
  // queue a few times (real setTimeout, not the sandboxed one) so the
  // promise chain inside home()/bindRooms() actually settles before the
  // caller reads `captured`.
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  return { calls, joinClick: captured.join, leaveClick: captured.leave, appEl };
}

test('room card renders a real Leave button (data-leave) alongside Join, wired by bindRooms()', async () => {
  const room = { id: 'room_1', name: 'Test Room', visibility: 'public', micSeats: 8 };
  const { joinClick, leaveClick } = await setupHomeRoomButtons({
    room,
    fetchImpl: async (url) => (url === '/platform/api/home'
      ? { status: 200, json: async () => ({ ok: true, data: { rooms: [room], events: [] } }) }
      : { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) }),
  });
  assert.ok(joinClick, 'bindRooms() must still wire the existing [data-join] button');
  assert.ok(leaveClick, 'bindRooms() must wire a new [data-leave] button (Stage 13)');
});

test('clicking Leave calls the real Stage 13 POST /api/rooms/:roomId/leave endpoint with the session bearer token', async () => {
  const room = { id: 'room_1', name: 'Test Room', visibility: 'public', micSeats: 8 };
  const { calls, leaveClick } = await setupHomeRoomButtons({
    room,
    fetchImpl: async (url) => {
      if (url === '/platform/api/home') return { status: 200, json: async () => ({ ok: true, data: { rooms: [room], events: [] } }) };
      if (url === '/platform/api/rooms/room_1/leave') return { status: 200, json: async () => ({ ok: true, data: { id: 's13_1', roomId: 'room_1', userId: 'acc_real_1', status: 'left' } }) };
      return { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) };
    },
  });
  await leaveClick();
  const call = calls.find((c) => c.url === '/platform/api/rooms/room_1/leave');
  assert.ok(call, 'clicking Leave must POST /platform/api/rooms/:roomId/leave');
  assert.equal(call.opt.method, 'POST');
  assert.equal(call.opt.headers.Authorization, 'Bearer tok_real_123');
});

test('clicking Leave surfaces a real server error via toast instead of pretending it succeeded', async () => {
  const room = { id: 'room_1', name: 'Test Room', visibility: 'public', micSeats: 8 };
  const removed = [];
  const store = { accessToken: 'tok_real_123', accountId: 'acc_real_1' };
  const sessionStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
  };
  const captured = {};
  const appEl = { innerHTML: '' };
  const leaveBtn = { dataset: { leave: room.id }, set onclick(fn) { captured.leave = fn; }, get onclick() { return captured.leave; } };
  const toasts = [];
  const sandbox = {
    sessionStorage,
    localStorage: { getItem: () => null },
    document: {
      querySelector: (sel) => (sel === '#app' ? appEl : null),
      querySelectorAll: (sel) => (sel === '[data-leave]' ? [leaveBtn] : []),
      createElement: () => { const e = { className: '', textContent: '', innerHTML: '', style: {}, remove() { removed.push(e); } }; return e; },
      body: { append: (e) => toasts.push(e) },
    },
    location: { href: '' },
    window: {},
    fetch: async (url) => {
      if (url === '/platform/api/home') return { status: 200, json: async () => ({ ok: true, data: { rooms: [room], events: [] } }) };
      if (url === '/platform/api/rooms/room_1/leave') return { status: 409, json: async () => ({ ok: false, error: 'you are not currently in this room' }) };
      return { status: 404, json: async () => ({ ok: false, error: 'unexpected url: ' + url }) };
    },
    console, setTimeout, Object, JSON, String, Error, Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox, { filename: 'app.js' });
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  await captured.leave();
  assert.ok(toasts.some((t) => t.textContent === 'you are not currently in this room'));
});
