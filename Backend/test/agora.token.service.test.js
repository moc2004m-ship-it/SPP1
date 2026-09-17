'use strict';
// Dependency-free tests for ../src/rtc/agora-token.service.js. The real
// `agora-token` package cannot be installed in this sandbox (no network
// egress to npm — same pre-existing constraint documented for `express`
// in PHASE4_SIX_DOMAINS_READ_REPORT.md), so a fake builder is injected
// here to test every branch of THIS service's own logic (config checks,
// role mapping, expiry math, never leaking the certificate). This does
// NOT verify that a real Agora server accepts the resulting token — that
// is recorded as BLOCKED in AGORA_VOICE_REPORT.md, not silently assumed.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgoraTokenService, resolveAgoraRole, FALLBACK_ROLE } = require('../src/rtc/agora-token.service');

function fakeSdk(overrides = {}) {
  const calls = [];
  const RtcTokenBuilder = {
    buildTokenWithUserAccount(appId, appCertificate, channel, account, role, tokenExpire, privilegeExpire) {
      calls.push({ appId, appCertificate, channel, account, role, tokenExpire, privilegeExpire });
      return `FAKE_TOKEN(${channel}:${account}:${role})`;
    },
  };
  return { sdk: { RtcTokenBuilder, RtcRole: null, ...overrides }, calls };
}

test('throws a 503 config error when app id/certificate are missing', () => {
  const { sdk } = fakeSdk();
  const service = createAgoraTokenService({ appId: '', appCertificate: '', tokenTtlSeconds: 3600, sdk });
  assert.equal(service.isConfigured(), false);
  assert.throws(
    () => service.generateRtcToken({ channelName: 'room_1', account: 'acc_1', role: 'host' }),
    (err) => err.status === 503 && /not configured/.test(err.message)
  );
});

test('throws a 503 config error when the Agora SDK package is not installed', () => {
  const service = createAgoraTokenService({ appId: 'app_1', appCertificate: 'cert_1', tokenTtlSeconds: 3600, sdk: null });
  assert.equal(service.isConfigured(), true);
  assert.equal(service.isSdkAvailable(), false);
  assert.throws(
    () => service.generateRtcToken({ channelName: 'room_1', account: 'acc_1', role: 'host' }),
    (err) => err.status === 503 && /not installed/.test(err.message)
  );
});

test('rejects an unknown role instead of silently defaulting a privilege level', () => {
  const { sdk } = fakeSdk();
  const service = createAgoraTokenService({ appId: 'app_1', appCertificate: 'cert_1', tokenTtlSeconds: 3600, sdk });
  assert.throws(
    () => service.generateRtcToken({ channelName: 'room_1', account: 'acc_1', role: 'admin' }),
    (err) => err.status === 400 && /unknown rtc role/.test(err.message)
  );
});

test('maps host -> PUBLISHER and audience -> SUBSCRIBER using the fallback table when RtcRole is unavailable', () => {
  assert.equal(resolveAgoraRole('host', null), FALLBACK_ROLE.PUBLISHER);
  assert.equal(resolveAgoraRole('audience', null), FALLBACK_ROLE.SUBSCRIBER);
});

test('generates a token using the real accountId as the uid, never a client-supplied value', () => {
  const { sdk, calls } = fakeSdk();
  const service = createAgoraTokenService({ appId: 'app_1', appCertificate: 'cert_1', tokenTtlSeconds: 3600, sdk });
  const result = service.generateRtcToken({ channelName: 'room_42', account: 'acc_real_1', role: 'host' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].appId, 'app_1');
  assert.equal(calls[0].channel, 'room_42');
  assert.equal(calls[0].account, 'acc_real_1');
  assert.equal(calls[0].role, FALLBACK_ROLE.PUBLISHER);
  assert.equal(result.token, 'FAKE_TOKEN(room_42:acc_real_1:1)');
  assert.equal(result.uid, 'acc_real_1');
  assert.equal(result.channel, 'room_42');
});

test('never includes the app certificate anywhere in the returned token payload', () => {
  const { sdk } = fakeSdk();
  const service = createAgoraTokenService({ appId: 'app_1', appCertificate: 'super_secret_cert', tokenTtlSeconds: 3600, sdk });
  const result = service.generateRtcToken({ channelName: 'room_1', account: 'acc_1', role: 'audience' });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /super_secret_cert/);
  assert.deepEqual(Object.keys(result).sort(), ['appId', 'channel', 'expiresAt', 'role', 'token', 'ttlSeconds', 'uid'].sort());
});

test('sets a limited, computable expiry based on the configured TTL', () => {
  const { sdk } = fakeSdk();
  const ttlSeconds = 120;
  const service = createAgoraTokenService({ appId: 'app_1', appCertificate: 'cert_1', tokenTtlSeconds: ttlSeconds, sdk });
  const before = Date.now();
  const result = service.generateRtcToken({ channelName: 'room_1', account: 'acc_1', role: 'host' });
  const expiresAtMs = new Date(result.expiresAt).getTime();
  assert.ok(expiresAtMs >= before + ttlSeconds * 1000 - 2000);
  assert.ok(expiresAtMs <= before + ttlSeconds * 1000 + 2000);
  assert.equal(result.ttlSeconds, ttlSeconds);
});

test('validates channelName/account are present, mirroring requireId used everywhere else in this backend', () => {
  const { sdk } = fakeSdk();
  const service = createAgoraTokenService({ appId: 'app_1', appCertificate: 'cert_1', tokenTtlSeconds: 3600, sdk });
  assert.throws(() => service.generateRtcToken({ channelName: '', account: 'acc_1', role: 'host' }), /channelName is invalid/);
  assert.throws(() => service.generateRtcToken({ channelName: 'room_1', account: '', role: 'host' }), /account is invalid/);
});

test('falls back to buildTokenWithAccount (legacy package name) when buildTokenWithUserAccount is absent', () => {
  const calls = [];
  const sdk = {
    RtcRole: null,
    RtcTokenBuilder: {
      buildTokenWithAccount(appId, appCertificate, channel, account, role, tokenExpire, privilegeExpire) {
        calls.push({ appId, channel, account, role });
        return 'LEGACY_TOKEN';
      },
    },
  };
  const service = createAgoraTokenService({ appId: 'app_1', appCertificate: 'cert_1', tokenTtlSeconds: 3600, sdk });
  const result = service.generateRtcToken({ channelName: 'room_1', account: 'acc_1', role: 'audience' });
  assert.equal(result.token, 'LEGACY_TOKEN');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].role, FALLBACK_ROLE.SUBSCRIBER);
});
