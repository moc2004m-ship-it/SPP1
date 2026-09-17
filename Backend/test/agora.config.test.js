'use strict';
// Dependency-free tests for env-var loading. No express, no network —
// same rationale as platform.auth.guards.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAgoraConfigFromEnv, DEFAULT_TTL_SECONDS, MIN_TTL_SECONDS, MAX_TTL_SECONDS } = require('../src/rtc/agora-config');

test('reports not configured when both env vars are missing', () => {
  const cfg = loadAgoraConfigFromEnv({});
  assert.equal(cfg.configured, false);
  assert.equal(cfg.appId, '');
  assert.equal(cfg.appCertificate, '');
});

test('reports not configured when only one of the two env vars is set', () => {
  assert.equal(loadAgoraConfigFromEnv({ AGORA_APP_ID: 'appid_only' }).configured, false);
  assert.equal(loadAgoraConfigFromEnv({ AGORA_APP_CERTIFICATE: 'cert_only' }).configured, false);
});

test('reports configured when both env vars are set', () => {
  const cfg = loadAgoraConfigFromEnv({ AGORA_APP_ID: 'app_1', AGORA_APP_CERTIFICATE: 'cert_1' });
  assert.equal(cfg.configured, true);
  assert.equal(cfg.appId, 'app_1');
  assert.equal(cfg.appCertificate, 'cert_1');
});

test('defaults token TTL when unset or invalid', () => {
  assert.equal(loadAgoraConfigFromEnv({}).tokenTtlSeconds, DEFAULT_TTL_SECONDS);
  assert.equal(loadAgoraConfigFromEnv({ AGORA_RTC_TOKEN_TTL_SECONDS: 'not-a-number' }).tokenTtlSeconds, DEFAULT_TTL_SECONDS);
  assert.equal(loadAgoraConfigFromEnv({ AGORA_RTC_TOKEN_TTL_SECONDS: '-5' }).tokenTtlSeconds, DEFAULT_TTL_SECONDS);
});

test('clamps an explicit TTL to the [MIN, MAX] range instead of trusting it blindly', () => {
  assert.equal(loadAgoraConfigFromEnv({ AGORA_RTC_TOKEN_TTL_SECONDS: '1' }).tokenTtlSeconds, MIN_TTL_SECONDS);
  assert.equal(loadAgoraConfigFromEnv({ AGORA_RTC_TOKEN_TTL_SECONDS: String(MAX_TTL_SECONDS * 10) }).tokenTtlSeconds, MAX_TTL_SECONDS);
  assert.equal(loadAgoraConfigFromEnv({ AGORA_RTC_TOKEN_TTL_SECONDS: '1800' }).tokenTtlSeconds, 1800);
});

test('never derives appId/appCertificate from anything other than the given env object (no hardcoded fallback secret)', () => {
  const cfg = loadAgoraConfigFromEnv({ SOME_OTHER_VAR: 'x' });
  assert.equal(cfg.appId, '');
  assert.equal(cfg.appCertificate, '');
});
