// These tests build a minimal express app the same way src/index.js wires
// the Stage 3 router in, rather than requiring src/index.js directly —
// that file calls app.listen() as a side effect of being required, which
// would start a real server during `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { createAccountsRouter } = require('../src/routes/accounts.routes');
const { AuthStore } = require('../src/auth/auth.store');
const { resetDatabaseForTests } = require('../src/database');

function buildTestApp() {
  const app = express();
  app.use(express.json());
  const db = require('../src/database').getDatabase();
  const auth = new AuthStore(db.accounts);
  app.use(createAccountsRouter({ authStore: auth }));
  return { app, auth };
}

async function withServer(fn) {
  resetDatabaseForTests();
  const { app, auth } = buildTestApp();
  const server = app.listen(0);
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`, auth);
  } finally {
    server.close();
  }
}

test('POST /accounts creates an account with server-side defaults', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/accounts`, { method: 'POST' });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.account.vip, 0);
    assert.equal(body.account.coins, 0);
    assert.ok(body.account.id.startsWith('usr_'));
    assert.equal(body.backend, 'memory');
  });
});

test('POST /accounts ignores client-supplied sensitive fields', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'hacker-chosen-id', vip: 999, svip: 999, coins: 999999, diamonds: 999999 }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.notEqual(body.account.id, 'hacker-chosen-id');
    assert.equal(body.account.vip, 0);
    assert.equal(body.account.svip, 0);
    assert.equal(body.account.coins, 0);
    assert.equal(body.account.diamonds, 0);
  });
});

test('GET /accounts/:id requires a session and returns only safe account fields', async () => {
  await withServer(async (base, auth) => {
    const createRes = await fetch(`${base}/accounts`, { method: 'POST' });
    const { account } = await createRes.json();
    const session = auth.createSession(account.id, { name:'test', platform:'android' });
    const getRes = await fetch(`${base}/accounts/${account.id}`, { headers:{ authorization:`Bearer ${session.token}` } });
    assert.equal(getRes.status, 200);
    const body = await getRes.json();
    assert.equal(body.account.id, account.id);
    assert.equal('coins' in body.account, false);
    assert.equal('diamonds' in body.account, false);
  });
});

test('GET /accounts/:id blocks access to another account and unauthenticated access', async () => {
  await withServer(async (base, auth) => {
    const a = await (await fetch(`${base}/accounts`, { method:'POST' })).json();
    const b = await (await fetch(`${base}/accounts`, { method:'POST' })).json();
    const unauth = await fetch(`${base}/accounts/${a.account.id}`);
    assert.equal(unauth.status, 401);
    const session = auth.createSession(b.account.id, { name:'test', platform:'android' });
    const forbidden = await fetch(`${base}/accounts/${a.account.id}`, { headers:{ authorization:`Bearer ${session.token}` } });
    assert.equal(forbidden.status, 403);
  });
});
