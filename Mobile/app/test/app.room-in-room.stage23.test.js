'use strict';
// Stage 23 -- Part 2 (Mobile UI): real functional tests for the
// Room-in-Room breakout UI added to ../app.js (breakoutRow()/
// renderRoomBreakout()/bindBreakoutActions() and the #breakoutCreate/
// #breakoutView bindings in profile()), against the real endpoints that
// already exist server-side (Backend/src/routes/platform.routes.js:
// POST/GET /api/rooms/:roomId/breakout, POST
// /api/rooms/breakout/:id/{join,leave,end}). Same node:vm
// load-the-real-app.js technique as app.games.stage19.test.js: mock
// document/fetch/sessionStorage/prompt, and exercise the real functions
// -- nothing re-implemented here. Dynamic data-breakout-* buttons are
// resolved with the same innerHTML-parsing querySelectorAll trick
// app.games.stage19.test.js already uses.

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

function breakoutEls(attr, profileExtra, cache) {
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

function setup({ fetchImpl, userId, promptImpl }) {
  const store = { accessToken: 'tok_real_123', accountId: userId || 'acc_host' };
  const sessionStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
  };
  const calls = [];
  const promptCalls = [];
  const toasts = [];
  const profileExtra = makeEl();
  const createBtn = makeEl();
  const viewBtn = makeEl();
  const elCache = new Map();
  const sandbox = {
    sessionStorage,
    localStorage: { getItem: () => null },
    document: {
      createElement: () => { const el = makeEl(); toasts.push(el); return el; },
      body: { append() {} },
      querySelector: (sel) => {
        if (sel === '#profileExtra') return profileExtra;
        if (sel === '#breakoutCreate') return createBtn;
        if (sel === '#breakoutView') return viewBtn;
        return makeEl();
      },
      querySelectorAll: (sel) => {
        const m = sel.match(/^\[data-([\w-]+)\]$/);
        if (m) return breakoutEls(m[1], profileExtra, elCache);
        return [];
      },
    },
    location: { href: '' },
    window: {},
    prompt: (msg) => { promptCalls.push(msg); return promptImpl ? promptImpl(msg) : null; },
    fetch: async (url, opt) => { calls.push({ url, opt }); return fetchImpl(url, opt); },
    console, setTimeout, Object, JSON, String, Error, Promise, RegExp, Array, encodeURIComponent,
  };
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox, { filename: 'app.js' });
  return { sandbox, calls, promptCalls, profileExtra, createBtn, viewBtn, toasts, elCache };
}

function jsonOk(data) { return { status: 200, json: async () => ({ ok: true, data }) }; }
function jsonErr(error, status = 400) { return { status, json: async () => ({ ok: false, error }) }; }

const OPEN_AS_HOST = { id: 'brk_1', type: 'breakout', parentRoomId: 'room_1', hostId: 'acc_host', name: 'Side Chat', capacity: null, status: 'open' };
const OPEN_AS_MEMBER_VIEW = { id: 'brk_1', type: 'breakout', parentRoomId: 'room_1', hostId: 'acc_host', name: 'Side Chat', capacity: null, status: 'open' };
const CLOSED = { id: 'brk_1', type: 'breakout', parentRoomId: 'room_1', hostId: 'acc_host', name: 'Side Chat', capacity: null, status: 'closed' };

test('renderRoomBreakout(): the host sees an End button on their own open breakout, plus Join/Leave', async () => {
  const { sandbox, profileExtra } = setup({
    userId: 'acc_host',
    fetchImpl: (url) => (url === '/platform/api/rooms/room_1/breakout' ? jsonOk([OPEN_AS_HOST]) : jsonErr('unexpected ' + url)),
  });
  await vm.runInContext("renderRoomBreakout('room_1')", sandbox);
  assert.match(profileExtra.innerHTML, /data-breakout-end="brk_1"/);
  assert.match(profileExtra.innerHTML, /data-breakout-join="brk_1"/);
  assert.match(profileExtra.innerHTML, /data-breakout-leave="brk_1"/);
});

test('renderRoomBreakout(): a non-host member never sees an End button, only Join/Leave', async () => {
  const { sandbox, profileExtra } = setup({
    userId: 'acc_member',
    fetchImpl: (url) => (url === '/platform/api/rooms/room_1/breakout' ? jsonOk([OPEN_AS_MEMBER_VIEW]) : jsonErr('unexpected ' + url)),
  });
  await vm.runInContext("renderRoomBreakout('room_1')", sandbox);
  assert.doesNotMatch(profileExtra.innerHTML, /data-breakout-end="brk_1"/);
  assert.match(profileExtra.innerHTML, /data-breakout-join="brk_1"/);
  assert.match(profileExtra.innerHTML, /data-breakout-leave="brk_1"/);
});

test('renderRoomBreakout(): a closed breakout shows no Join/Leave/End actions at all', async () => {
  const { sandbox, profileExtra } = setup({
    userId: 'acc_host',
    fetchImpl: (url) => (url === '/platform/api/rooms/room_1/breakout' ? jsonOk([CLOSED]) : jsonErr('unexpected ' + url)),
  });
  await vm.runInContext("renderRoomBreakout('room_1')", sandbox);
  assert.doesNotMatch(profileExtra.innerHTML, /data-breakout-end="brk_1"/);
  assert.doesNotMatch(profileExtra.innerHTML, /data-breakout-join="brk_1"/);
  assert.doesNotMatch(profileExtra.innerHTML, /data-breakout-leave="brk_1"/);
});

test('renderRoomBreakout(): a room with no open breakout renders the real empty state, not fabricated data', async () => {
  const { sandbox, profileExtra } = setup({
    fetchImpl: (url) => (url === '/platform/api/rooms/room_1/breakout' ? jsonOk([]) : jsonErr('unexpected ' + url)),
  });
  await vm.runInContext("renderRoomBreakout('room_1')", sandbox);
  assert.match(profileExtra.innerHTML, /لا توجد غرفة فرعية مفتوحة/);
});

test('renderRoomBreakout(): a real server rejection (e.g. not a member) surfaces as a real toast, never fabricated data', async () => {
  const { sandbox, toasts } = setup({
    userId: 'acc_stranger',
    fetchImpl: (url) => (url === '/platform/api/rooms/room_1/breakout' ? jsonErr('only members of the parent room may view its room-in-room breakouts', 403) : jsonErr('unexpected ' + url)),
  });
  await vm.runInContext("renderRoomBreakout('room_1')", sandbox);
  assert.ok(toasts.some((t) => /only members of the parent room/.test(t.textContent)));
});

test('#breakoutCreate: cancelling the roomId prompt makes no API call at all', async () => {
  const { calls, createBtn, sandbox } = setup({
    fetchImpl: (url) => jsonErr('unexpected ' + url),
    promptImpl: () => null,
  });
  await vm.runInContext('profile()', sandbox);
  await createBtn.onclick();
  assert.ok(!calls.some((c) => c.url.includes('/breakout')), 'no breakout call should be made when the roomId prompt is cancelled');
});

test('#breakoutCreate: submits to the real POST /api/rooms/:roomId/breakout with the typed name; hostId is never sent by the client', async () => {
  const prompts = ['room_1', 'Side Chat'];
  const { calls, createBtn, profileExtra, sandbox } = setup({
    fetchImpl: (url, opt) => {
      if (url === '/platform/api/rooms/room_1/breakout' && opt.method === 'POST') return jsonOk(OPEN_AS_HOST);
      return jsonErr('unexpected ' + url);
    },
    promptImpl: () => prompts.shift(),
  });
  await vm.runInContext('profile()', sandbox);
  await createBtn.onclick();
  const call = calls.find((c) => c.url === '/platform/api/rooms/room_1/breakout');
  assert.ok(call, 'must call the real breakout-create endpoint for the typed roomId');
  assert.equal(call.opt.method, 'POST');
  const body = JSON.parse(call.opt.body);
  assert.equal(body.name, 'Side Chat');
  assert.equal('hostId' in body, false, 'hostId must never be sent by the client -- the server takes it from the session');
  assert.equal(call.opt.headers.Authorization, 'Bearer tok_real_123');
  assert.match(profileExtra.innerHTML, /brk_1/);
});

test('#breakoutCreate: a real server 403 for a non-owner session surfaces verbatim via toast, never a fake success', async () => {
  const prompts = ['room_1', 'Side Chat'];
  const { createBtn, toasts, sandbox } = setup({
    userId: 'acc_member',
    fetchImpl: (url) => (url === '/platform/api/rooms/room_1/breakout' ? jsonErr('only the room host/owner may create/start a room-in-room breakout', 403) : jsonErr('unexpected ' + url)),
    promptImpl: () => prompts.shift(),
  });
  await vm.runInContext('profile()', sandbox);
  await createBtn.onclick();
  assert.ok(toasts.some((t) => /only the room host\/owner/.test(t.textContent)));
});

test('#breakoutView: prompts for roomId and renders the real list via renderRoomBreakout()', async () => {
  const { viewBtn, profileExtra, sandbox } = setup({
    userId: 'acc_host',
    fetchImpl: (url) => (url === '/platform/api/rooms/room_1/breakout' ? jsonOk([OPEN_AS_HOST]) : jsonErr('unexpected ' + url)),
    promptImpl: () => 'room_1',
  });
  await vm.runInContext('profile()', sandbox);
  await viewBtn.onclick();
  assert.match(profileExtra.innerHTML, /Side Chat/);
});

test('data-breakout-join / data-breakout-leave / data-breakout-end buttons call the real POST endpoints with no client-supplied identity, then re-render', async () => {
  const { sandbox, profileExtra, calls } = setup({
    userId: 'acc_host',
    fetchImpl: (url, opt) => {
      if (url === '/platform/api/rooms/room_1/breakout') return jsonOk([OPEN_AS_HOST]);
      if (url === '/platform/api/rooms/breakout/brk_1/join' && opt.method === 'POST') return jsonOk({ id: 'mem_1', status: 'joined' });
      if (url === '/platform/api/rooms/breakout/brk_1/leave' && opt.method === 'POST') return jsonOk({ id: 'mem_1', status: 'left' });
      if (url === '/platform/api/rooms/breakout/brk_1/end' && opt.method === 'POST') return jsonOk({ id: 'brk_1', status: 'closed' });
      return jsonErr('unexpected ' + url);
    },
  });
  await vm.runInContext("renderRoomBreakout('room_1')", sandbox);

  const [joinBtn] = sandbox.document.querySelectorAll('[data-breakout-join]');
  await joinBtn.onclick();
  const joinCall = calls.find((c) => c.url === '/platform/api/rooms/breakout/brk_1/join' && c.opt.method === 'POST');
  assert.ok(joinCall);
  assert.deepEqual(JSON.parse(joinCall.opt.body), {});

  const [leaveBtn] = sandbox.document.querySelectorAll('[data-breakout-leave]');
  await leaveBtn.onclick();
  assert.ok(calls.some((c) => c.url === '/platform/api/rooms/breakout/brk_1/leave' && c.opt.method === 'POST'));

  const [endBtn] = sandbox.document.querySelectorAll('[data-breakout-end]');
  await endBtn.onclick();
  assert.ok(calls.some((c) => c.url === '/platform/api/rooms/breakout/brk_1/end' && c.opt.method === 'POST'));

  assert.match(profileExtra.innerHTML, /الغرف الفرعية/);
});
