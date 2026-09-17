'use strict';
// Stage 6 (Home) -- real functional tests for the tab/category wiring and
// read-only sections added to home() in ../app.js, against the real
// GET /api/home/rooms (Backend/src/routes/platform.routes.js) and the
// enriched GET /api/home. Same node:vm technique as app.auth.test.js:
// load the actual app.js source, mock document/fetch/sessionStorage, and
// exercise the real functions -- nothing re-implemented here. There is no
// browser and no real Express server in this sandbox (see
// STAGE6_STOP_REPORT.md), so this is the strongest verification available.

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

// Chips rendered via document.querySelectorAll('[data-hometab]') /
// [data-homecat] / [data-ranktype] -- capture their onclick so a test can
// simulate the real click, exactly like app.auth.test.js's clickHandlers
// pattern does for single-element ids.
function makeChip(attr, value, registry) {
  const el = makeEl();
  el.dataset[attr] = value;
  Object.defineProperty(el, 'onclick', {
    set(fn) { registry.push({ value, fn }); },
    get() { return (registry.find((r) => r.value === value) || {}).fn; },
  });
  return el;
}

function setup({ fetchImpl }) {
  const store = { accessToken: 'tok_real_123', accountId: 'acc_real_1' };
  const sessionStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
  };
  const calls = [];
  const tabChips = [];
  const catChips = [];
  const rankChips = [];
  const sections = {}; // id -> capturable element, populated lazily by querySelector
  const sectionIds = ['homeRoomsGrid', 'homeGames', 'homeRankings', 'homeFamilies', 'homeNotifications', 'homeSearchResults', 'homeSearchInput', 'homeCats', 'homeEvents', 'notifBell'];
  for (const id of sectionIds) sections[id] = makeEl();
  const sandbox = {
    sessionStorage,
    localStorage: { getItem: () => null },
    document: {
      createElement: () => makeEl(),
      body: { append() {} },
      querySelector: (sel) => {
        const id = sel.startsWith('#') ? sel.slice(1) : null;
        if (id && sections[id]) return sections[id];
        return makeEl();
      },
      querySelectorAll: (sel) => {
        if (sel === '[data-hometab]') return ['live', 'following', 'popular', 'new'].map((v) => makeChip('hometab', v, tabChips));
        if (sel === '[data-homecat]') return ['', 'music'].map((v) => makeChip('homecat', v, catChips));
        if (sel === '[data-ranktype]') return ['wealth', 'charm', 'family'].map((v) => makeChip('ranktype', v, rankChips));
        return [];
      },
    },
    location: { href: '' },
    window: {},
    fetch: async (url, opt) => {
      calls.push({ url, opt });
      return fetchImpl(url, opt);
    },
    console, setTimeout, Object, JSON, String, Error, Promise, URLSearchParams, Array,
  };
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox, { filename: 'app.js' });
  return { sandbox, calls, tabChips, catChips, rankChips, sections };
}

function jsonOk(data) { return { status: 200, json: async () => ({ ok: true, data }) }; }
function jsonErr(error) { return { status: 400, json: async () => ({ ok: false, error }) }; }

function baseFetch(url) {
  if (url === '/platform/api/home') {
    return jsonOk({ rooms: [], events: [], categories: [{ id: 'music', name: 'موسيقى', count: 2 }], unreadNotifications: 3 });
  }
  if (url.startsWith('/platform/api/home/rooms')) return jsonOk([]);
  if (url === '/platform/api/games') return jsonOk([]);
  if (url.startsWith('/platform/api/rankings/')) return jsonOk([]);
  if (url === '/platform/api/families') return jsonOk([]);
  if (url === '/platform/api/notifications/acc_real_1') return jsonOk([]);
  return jsonErr('unexpected url: ' + url);
}

test('home() defaults to the live tab and calls GET /api/home/rooms?tab=live (Stage 6)', async () => {
  const { sandbox, calls } = setup({ fetchImpl: baseFetch });
  vm.runInContext("state.tab='home';", sandbox);
  await vm.runInContext('render()', sandbox);
  await new Promise((r) => setTimeout(r, 20));
  const call = calls.find((c) => c.url.startsWith('/platform/api/home/rooms'));
  assert.ok(call, 'home() must call GET /api/home/rooms');
  assert.equal(new URL('http://x' + call.url).searchParams.get('tab'), 'live');
  assert.equal(call.opt.headers.Authorization, 'Bearer tok_real_123');
});

test('clicking a tab chip re-fetches /api/home/rooms with the new real tab (Stage 6)', async () => {
  const { sandbox, calls, tabChips } = setup({ fetchImpl: baseFetch });
  vm.runInContext("state.tab='home';", sandbox);
  await vm.runInContext('render()', sandbox);
  await new Promise((r) => setTimeout(r, 20));
  const popular = tabChips.find((c) => c.value === 'popular');
  assert.ok(popular, 'a popular tab chip must be bound');
  await popular.fn();
  await new Promise((r) => setTimeout(r, 20));
  const popularCalls = calls.filter((c) => c.url.startsWith('/platform/api/home/rooms') && new URL('http://x' + c.url).searchParams.get('tab') === 'popular');
  assert.ok(popularCalls.length > 0, 'clicking the popular chip must call GET /api/home/rooms?tab=popular');
});

test('clicking a category chip adds the real category filter to /api/home/rooms (Stage 6)', async () => {
  const { sandbox, calls, catChips } = setup({ fetchImpl: baseFetch });
  vm.runInContext("state.tab='home';", sandbox);
  await vm.runInContext('render()', sandbox);
  await new Promise((r) => setTimeout(r, 20));
  const music = catChips.find((c) => c.value === 'music');
  assert.ok(music, 'a category chip for the real categoryCounts() entry must be bound');
  await music.fn();
  await new Promise((r) => setTimeout(r, 20));
  const filtered = calls.filter((c) => c.url.startsWith('/platform/api/home/rooms') && new URL('http://x' + c.url).searchParams.get('category') === 'music');
  assert.ok(filtered.length > 0, 'clicking the music chip must call GET /api/home/rooms?...&category=music');
});

test('Home sections call their real read endpoints and render the honest empty state (Stage 6)', async () => {
  const { sandbox, sections } = setup({ fetchImpl: baseFetch });
  vm.runInContext("state.tab='home';", sandbox);
  await vm.runInContext('render()', sandbox);
  await new Promise((r) => setTimeout(r, 20));
  assert.match(sections.homeGames.innerHTML, /لا توجد ألعاب بعد/);
  assert.match(sections.homeRankings.innerHTML, /لا يوجد ترتيب بعد/);
  assert.match(sections.homeFamilies.innerHTML, /لا توجد عائلات بعد/);
  assert.match(sections.homeNotifications.innerHTML, /لا توجد إشعارات بعد/);
});

test('a failed section fetch shows a real error, not a fake success (Stage 6)', async () => {
  const { sandbox, sections } = setup({
    fetchImpl: (url) => (url === '/platform/api/games' ? jsonErr('boom') : baseFetch(url)),
  });
  vm.runInContext("state.tab='home';", sandbox);
  await vm.runInContext('render()', sandbox);
  await new Promise((r) => setTimeout(r, 20));
  assert.match(sections.homeGames.innerHTML, /تعذر التحميل/);
  assert.match(sections.homeGames.innerHTML, /boom/);
});

test('a failed GET /api/home shows real errors in categories/events only -- unrelated sections (games) still load independently (Stage 6)', async () => {
  // render()'s own connectivity check hits GET /api/home once before it will
  // even call home() at all (see app.js render()); that first call must
  // succeed or the whole shell falls back to "server unavailable" and
  // home()/loadHomeSummary() never run. home() then calls GET /api/home a
  // second time via loadHomeSummary() -- that second call is the one this
  // test makes fail, to isolate loadHomeSummary()'s own real error handling.
  let homeCalls = 0;
  const { sandbox, sections } = setup({
    fetchImpl: (url) => {
      if (url === '/platform/api/home') { homeCalls += 1; return homeCalls === 1 ? baseFetch(url) : jsonErr('home summary down'); }
      return baseFetch(url);
    },
  });
  vm.runInContext("state.tab='home';", sandbox);
  await vm.runInContext('render()', sandbox);
  await new Promise((r) => setTimeout(r, 20));
  assert.match(sections.homeCats.innerHTML, /تعذر تحميل الفئات/);
  assert.match(sections.homeCats.innerHTML, /home summary down/);
  assert.match(sections.homeEvents.innerHTML, /تعذر تحميل الفعاليات/);
  // Games/Rankings/etc. are loaded from separate endpoints and must not be
  // dragged down by the unrelated /api/home failure (Stage 6 -- sections
  // are loaded independently, not gated behind one shared fetch).
  assert.match(sections.homeGames.innerHTML, /لا توجد ألعاب بعد/);
});

test('switching tabs shows a real loading state in the rooms grid before the new tab data arrives (Stage 6)', async () => {
  let resolveSlow;
  const slowFetch = (url, opt) => {
    if (url.startsWith('/platform/api/home/rooms') && new URL('http://x' + url).searchParams.get('tab') === 'popular') {
      return new Promise((resolve) => { resolveSlow = () => resolve(jsonOk([])); });
    }
    return baseFetch(url, opt);
  };
  const { sandbox, sections, tabChips } = setup({ fetchImpl: slowFetch });
  vm.runInContext("state.tab='home';", sandbox);
  await vm.runInContext('render()', sandbox);
  await new Promise((r) => setTimeout(r, 20));
  const popular = tabChips.find((c) => c.value === 'popular');
  popular.fn(); // not awaited -- the click handler itself does not await home()
  await new Promise((r) => setTimeout(r, 5));
  assert.match(sections.homeRoomsGrid.innerHTML, /جارِ تحميل الغرف/, 'the grid must show a real loading state while the popular tab request is in flight');
  resolveSlow();
  await new Promise((r) => setTimeout(r, 20));
  assert.doesNotMatch(sections.homeRoomsGrid.innerHTML, /جارِ تحميل الغرف/);
});

test('the unread-notifications badge from GET /api/home is rendered honestly (Stage 6)', async () => {
  const { sandbox } = setup({ fetchImpl: baseFetch });
  vm.runInContext("state.tab='home';", sandbox);
  await vm.runInContext('render()', sandbox);
  await new Promise((r) => setTimeout(r, 20));
  // state.unreadNotifications is set directly from the real response field.
  assert.equal(vm.runInContext('state.unreadNotifications', sandbox), 3);
});
