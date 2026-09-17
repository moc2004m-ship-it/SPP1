'use strict';
// HTTP-level tests for POST /platform/api/rtc/token. These need express,
// which cannot be installed in this sandbox (no network egress to npm —
// same pre-existing, already-documented cause as accounts.routes.test.js /
// auth.routes.test.js / config.routes.test.js). Expected to fail with
// "Cannot find module 'express'" here; this is BLOCKED, not skipped, and
// is reported honestly in AGORA_VOICE_REPORT.md. Run this for real with
// `npm install` once network access is available.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { AuthStore } = require('../src/auth/auth.store');
const { InMemoryAccountRepository } = require('../src/database/repositories/account.repository');
const { createPlatform } = require('../src/feature-platform');
const { createAgoraRouter } = require('../src/routes/agora.routes');
const { createAgoraTokenService } = require('../src/rtc/agora-token.service');

function fakeSdk() {
  return {
    RtcTokenBuilder: {
      buildTokenWithUserAccount: (appId, cert, channel, account, role) => `FAKE(${channel}:${account}:${role})`,
    },
    RtcRole: null,
  };
}

async function withServer({ tokenService }, fn) {
  const accounts = new InMemoryAccountRepository();
  const authStore = new AuthStore(accounts);
  const platform = createPlatform();
  const app = express();
  app.use(express.json());
  app.use('/platform', createAgoraRouter({ platform, authStore, tokenService }));

  const account = await accounts.create();
  const { token } = authStore.createSession(account.id, { name: 'test-device' });
  const server = app.listen(0);
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`, { platform, accountId: account.id, sessionToken: token });
  } finally {
    server.close();
  }
}

test('POST /platform/api/rtc/token requires a valid session (401 with no Authorization header)', async () => {
  const tokenService = createAgoraTokenService({ appId: 'app_1', appCertificate: 'cert_1', tokenTtlSeconds: 3600, sdk: fakeSdk() });
  await withServer({ tokenService }, async (base) => {
    const res = await fetch(`${base}/platform/api/rtc/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId: 'room_1' }),
    });
    assert.equal(res.status, 401);
  });
});

test('POST /platform/api/rtc/token issues a token for the room owner as host, using the session accountId not a client-supplied id', async () => {
  const tokenService = createAgoraTokenService({ appId: 'app_1', appCertificate: 'cert_1', tokenTtlSeconds: 3600, sdk: fakeSdk() });
  await withServer({ tokenService }, async (base, { platform, accountId, sessionToken }) => {
    const room = await platform.rooms.create({ ownerId: accountId, name: 'Test Room' });
    const res = await fetch(`${base}/platform/api/rtc/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ roomId: room.id, userId: 'someone-else-entirely' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.role, 'host');
    assert.equal(body.data.uid, accountId);
    assert.notEqual(body.data.uid, 'someone-else-entirely');
    assert.ok(!('appCertificate' in body.data));
  });
});

test('POST /platform/api/rtc/token issues an audience token for a non-owner joining a public room', async () => {
  const tokenService = createAgoraTokenService({ appId: 'app_1', appCertificate: 'cert_1', tokenTtlSeconds: 3600, sdk: fakeSdk() });
  await withServer({ tokenService }, async (base, { platform, accountId, sessionToken }) => {
    const room = await platform.rooms.create({ ownerId: 'someone_else', name: 'Public Room', visibility: 'public' });
    const res = await fetch(`${base}/platform/api/rtc/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ roomId: room.id }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.role, 'audience');
    assert.equal(body.data.uid, accountId);
  });
});

test('POST /platform/api/rtc/token 403s a non-owner trying to join a private room', async () => {
  const tokenService = createAgoraTokenService({ appId: 'app_1', appCertificate: 'cert_1', tokenTtlSeconds: 3600, sdk: fakeSdk() });
  await withServer({ tokenService }, async (base, { platform, sessionToken }) => {
    const room = await platform.rooms.create({ ownerId: 'someone_else', name: 'Private Room', visibility: 'private' });
    const res = await fetch(`${base}/platform/api/rtc/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ roomId: room.id }),
    });
    assert.equal(res.status, 403);
  });
});

test('POST /platform/api/rtc/token 404s a non-existent room', async () => {
  const tokenService = createAgoraTokenService({ appId: 'app_1', appCertificate: 'cert_1', tokenTtlSeconds: 3600, sdk: fakeSdk() });
  await withServer({ tokenService }, async (base, { sessionToken }) => {
    const res = await fetch(`${base}/platform/api/rtc/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ roomId: 'no_such_room' }),
    });
    assert.equal(res.status, 404);
  });
});

test('POST /platform/api/rtc/token 503s when Agora is not configured, without ever inventing a fake token', async () => {
  const tokenService = createAgoraTokenService({ appId: '', appCertificate: '', tokenTtlSeconds: 3600, sdk: fakeSdk() });
  await withServer({ tokenService }, async (base, { platform, accountId, sessionToken }) => {
    const room = await platform.rooms.create({ ownerId: accountId, name: 'Test Room' });
    const res = await fetch(`${base}/platform/api/rtc/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ roomId: room.id }),
    });
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(body.ok, false);
  });
});
