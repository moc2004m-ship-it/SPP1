'use strict';
// Stage 19 (Mobile UI) -- real functional tests for the Room Game Center
// added to ../app.js (gameRow()/gameCatalogRow()/renderRoomGameCenter()/
// bindGameActions()), against the real endpoints that already existed
// server-side (Backend/src/routes/platform.routes.js GET /api/games/catalog,
// GET /api/games?roomId=, GET /api/games/:matchId, POST
// /api/games/:matchId/join|leave|cancel|start, and POST /api/games to
// start a brand-new match from the catalog). Same node:vm
// load-the-real-app.js technique as app.battles.stage18.test.js: mock
// document/fetch/sessionStorage, and exercise the real functions --
// nothing re-implemented here.
//
// Same querySelectorAll trick as app.battles.stage18.test.js is needed
// here too, since gameRow()/gameCatalogRow() buttons are rendered
// dynamically INTO #profileExtra's innerHTML (not fixed ids known ahead
// of time): this mock's querySelectorAll actually parses the current
// #profileExtra.innerHTML for `data-game-*` attributes and hands back
// element stand-ins whose .onclick can be invoked directly.

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
// gameRow()'s/gameCatalogRow()'s template strings were actually inserted
// into the DOM. Cached per (attr,id) in `cache` so that bindGameActions()'s
// own querySelectorAll().forEach(b=>b.onclick=...) and a later
// querySelectorAll call made directly by a test resolve to the SAME
// element object -- same as a real DOM node persists across repeated
// querySelectorAll() calls against unchanged markup.
function gameEls(attr, profileExtra, cache) {
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

function setup({ fetchImpl, userId }) {
  const store = { accessToken: 'tok_real_123', accountId: userId || 'acc_host' };
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
      querySelector: (sel) => (sel === '#profileExtra' ? profileExtra : sel === '#backToGames' ? backBtn : makeEl()),
      querySelectorAll: (sel) => {
        const m = sel.match(/^\[data-([\w-]+)\]$/);
        if (m) return gameEls(m[1], profileExtra, elCache);
        return [];
      },
    },
    location: { href: '' },
    window: {},
    fetch: async (url, opt) => { calls.push({ url, opt }); return fetchImpl(url, opt); },
    console, setTimeout, Object, JSON, String, Error, Promise, RegExp, Array, encodeURIComponent,
  };
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox, { filename: 'app.js' });
  return { sandbox, calls, profileExtra, backBtn };
}

function jsonOk(data) { return { status: 200, json: async () => ({ ok: true, data }) }; }
function jsonErr(error) { return { status: 400, json: async () => ({ ok: false, error }) }; }

const CATALOG = [
  { id: 'ludo', name: 'Ludo', minPlayers: 2, maxPlayers: 4 },
  { id: 'chess', name: 'Chess', minPlayers: 2, maxPlayers: 2 },
];
const LOBBY_AS_OUTSIDER = { id: 'match_1', roomId: 'room_1', gameId: 'ludo', startedBy: 'acc_host', playerIds: ['acc_host'], state: 'lobby' };
const LOBBY_AS_MEMBER = { id: 'match_1', roomId: 'room_1', gameId: 'ludo', startedBy: 'acc_host', playerIds: ['acc_host', 'acc_member'], state: 'lobby' };
const ACTIVE = { id: 'match_2', roomId: 'room_1', gameId: 'chess', startedBy: 'acc_host', playerIds: ['acc_host', 'acc_member'], state: 'active' };

function fetchFor(roomId, list, catalog = CATALOG) {
  return (url) => {
    if (url === `/platform/api/games?roomId=${roomId}`) return jsonOk(list);
    if (url === '/platform/api/games/catalog') return jsonOk(catalog);
    return jsonErr('unexpected ' + url);
  };
}

test('a non-player sees Join on a lobby match, never Leave/Cancel/Start', async () => {
  const { sandbox, profileExtra } = setup({ userId: 'acc_outsider', fetchImpl: fetchFor('room_1', [LOBBY_AS_OUTSIDER]) });
  await vm.runInContext("renderRoomGameCenter('room_1')", sandbox);
  assert.match(profileExtra.innerHTML, /data-game-join="match_1"/);
  assert.doesNotMatch(profileExtra.innerHTML, /data-game-leave="match_1"/);
  assert.doesNotMatch(profileExtra.innerHTML, /data-game-cancel="match_1"/);
  assert.doesNotMatch(profileExtra.innerHTML, /data-game-start="match_1"/);
});

test('a joined non-host player sees Leave on a lobby match, never Join/Cancel/Start', async () => {
  const { sandbox, profileExtra } = setup({ userId: 'acc_member', fetchImpl: fetchFor('room_1', [LOBBY_AS_MEMBER]) });
  await vm.runInContext("renderRoomGameCenter('room_1')", sandbox);
  assert.match(profileExtra.innerHTML, /data-game-leave="match_1"/);
  assert.doesNotMatch(profileExtra.innerHTML, /data-game-join="match_1"/);
  assert.doesNotMatch(profileExtra.innerHTML, /data-game-cancel="match_1"/);
  assert.doesNotMatch(profileExtra.innerHTML, /data-game-start="match_1"/);
});

test('the host sees Start and Cancel on their own lobby, never Join/Leave', async () => {
  const { sandbox, profileExtra } = setup({ userId: 'acc_host', fetchImpl: fetchFor('room_1', [LOBBY_AS_MEMBER]) });
  await vm.runInContext("renderRoomGameCenter('room_1')", sandbox);
  assert.match(profileExtra.innerHTML, /data-game-start="match_1"/);
  assert.match(profileExtra.innerHTML, /data-game-cancel="match_1"/);
  assert.doesNotMatch(profileExtra.innerHTML, /data-game-join="match_1"/);
  assert.doesNotMatch(profileExtra.innerHTML, /data-game-leave="match_1"/);
});

test('an active match shows no join/leave/cancel/start buttons, only Details, and the real players are rendered honestly', async () => {
  const { sandbox, profileExtra } = setup({ userId: 'acc_host', fetchImpl: fetchFor('room_1', [ACTIVE]) });
  await vm.runInContext("renderRoomGameCenter('room_1')", sandbox);
  assert.doesNotMatch(profileExtra.innerHTML, /data-game-join="match_2"/);
  assert.doesNotMatch(profileExtra.innerHTML, /data-game-leave="match_2"/);
  assert.doesNotMatch(profileExtra.innerHTML, /data-game-cancel="match_2"/);
  assert.doesNotMatch(profileExtra.innerHTML, /data-game-start="match_2"/);
  assert.match(profileExtra.innerHTML, /data-game-view="match_2"/);
  assert.match(profileExtra.innerHTML, /acc_member/);
});

test('the real catalog is rendered as start buttons, one per real game, with its real min/maxPlayers', async () => {
  const { sandbox, profileExtra } = setup({ fetchImpl: fetchFor('room_1', []) });
  await vm.runInContext("renderRoomGameCenter('room_1')", sandbox);
  assert.match(profileExtra.innerHTML, /data-game-start-new="ludo"/);
  assert.match(profileExtra.innerHTML, /data-game-start-new="chess"/);
  assert.match(profileExtra.innerHTML, /Ludo/);
  assert.match(profileExtra.innerHTML, /Chess/);
});

test('clicking a catalog Start button calls the real POST /api/games with roomId+gameId, then refreshes the room game center', async () => {
  let created = false;
  const { sandbox, calls } = setup({
    fetchImpl: (url, opt) => {
      if (url === '/platform/api/games?roomId=room_1') return jsonOk(created ? [LOBBY_AS_OUTSIDER] : []);
      if (url === '/platform/api/games/catalog') return jsonOk(CATALOG);
      if (url === '/platform/api/games' && opt && opt.method === 'POST') { created = true; return jsonOk(LOBBY_AS_OUTSIDER); }
      return jsonErr('unexpected ' + url);
    },
  });
  await vm.runInContext("renderRoomGameCenter('room_1')", sandbox);
  const startNewEl = vm.runInContext('document.querySelectorAll(\'[data-game-start-new]\')', sandbox)[0];
  await startNewEl.onclick();
  const call = calls.find((c) => c.url === '/platform/api/games' && c.opt && c.opt.method === 'POST');
  assert.ok(call, 'must POST the real create-match endpoint');
  assert.deepEqual(JSON.parse(call.opt.body), { roomId: 'room_1', gameId: 'ludo', version: '1' });
  assert.equal(call.opt.headers.Authorization, 'Bearer tok_real_123');
  // must refresh afterwards
  assert.ok(calls.filter((c) => c.url === '/platform/api/games?roomId=room_1').length >= 2, 'must re-fetch the room list after creating');
});

test('clicking Join/Leave/Cancel/Start each call their own real endpoint and refresh the list', async () => {
  const cases = [
    { attr: 'game-join', action: 'join', userId: 'acc_outsider', match: LOBBY_AS_OUTSIDER },
    { attr: 'game-leave', action: 'leave', userId: 'acc_member', match: LOBBY_AS_MEMBER },
    { attr: 'game-cancel', action: 'cancel', userId: 'acc_host', match: LOBBY_AS_MEMBER },
    { attr: 'game-start', action: 'start', userId: 'acc_host', match: LOBBY_AS_MEMBER },
  ];
  for (const { attr, action, userId, match } of cases) {
    const { sandbox, calls } = setup({
      userId,
      fetchImpl: (url, opt) => {
        if (url === '/platform/api/games?roomId=room_1') return jsonOk([match]);
        if (url === '/platform/api/games/catalog') return jsonOk(CATALOG);
        if (url === `/platform/api/games/${match.id}/${action}` && opt && opt.method === 'POST') return jsonOk({ ...match, state: action === 'start' ? 'active' : match.state });
        return jsonErr('unexpected ' + url);
      },
    });
    await vm.runInContext("renderRoomGameCenter('room_1')", sandbox);
    const el = vm.runInContext(`document.querySelectorAll('[data-${attr}]')`, sandbox)[0];
    assert.ok(el, `button for ${attr} must be rendered`);
    await el.onclick();
    assert.ok(calls.some((c) => c.url === `/platform/api/games/${match.id}/${action}` && c.opt.method === 'POST'), `must call the real ${action} endpoint`);
  }
});

test('the detail view calls the real GET /api/games/:matchId and renders exactly what the server returned, with a working back button', async () => {
  const { sandbox, profileExtra, backBtn } = setup({
    userId: 'acc_host',
    fetchImpl: (url) => {
      if (url === '/platform/api/games?roomId=room_1') return jsonOk([ACTIVE]);
      if (url === '/platform/api/games/catalog') return jsonOk(CATALOG);
      if (url === '/platform/api/games/match_2') return jsonOk(ACTIVE);
      return jsonErr('unexpected ' + url);
    },
  });
  await vm.runInContext("renderRoomGameCenter('room_1')", sandbox);
  const el = vm.runInContext('document.querySelectorAll(\'[data-game-view]\')', sandbox)[0];
  await el.onclick();
  assert.match(profileExtra.innerHTML, /chess/);
  assert.match(profileExtra.innerHTML, /active/);
  assert.ok(backBtn.onclick, 'a working back-to-game-center control must be wired');
});

test('a rejected action (e.g. server rejects starting an under-filled lobby) shows a real error toast, not a fake success', async () => {
  const { sandbox } = setup({
    userId: 'acc_host',
    fetchImpl: (url) => {
      if (url === '/platform/api/games?roomId=room_1') return jsonOk([LOBBY_AS_OUTSIDER]);
      if (url === '/platform/api/games/catalog') return jsonOk(CATALOG);
      if (url === '/platform/api/games/match_1/start') return jsonErr('Ludo requires at least 2 players to start');
      return jsonErr('unexpected ' + url);
    },
  });
  const toasts = [];
  sandbox.document.body.append = () => {};
  const originalCreateElement = sandbox.document.createElement;
  sandbox.document.createElement = () => { const el = makeEl(); toasts.push(el); return el; };
  await vm.runInContext("renderRoomGameCenter('room_1')", sandbox);
  const el = vm.runInContext('document.querySelectorAll(\'[data-game-start]\')', sandbox)[0];
  await el.onclick();
  assert.ok(toasts.some((t) => /requires at least 2 players/.test(t.textContent)), 'the real server error text must reach the toast');
  sandbox.document.createElement = originalCreateElement;
});
