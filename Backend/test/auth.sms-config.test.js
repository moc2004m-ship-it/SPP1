'use strict';
// Stage 5 audit (this session) — dependency-free tests for the new
// env-var loader (../src/auth/sms-config.js). No express, no network.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSmsConfigFromEnv } = require('../src/auth/sms-config');

test('reports not configured when SMS_PROVIDER_URL is missing (matches otp-sender.js fail-closed behavior)', () => {
  const cfg = loadSmsConfigFromEnv({});
  assert.equal(cfg.configured, false);
  assert.equal(cfg.url, undefined);
});

test('whitespace-only SMS_PROVIDER_URL is treated as unset', () => {
  const cfg = loadSmsConfigFromEnv({ SMS_PROVIDER_URL: '   ' });
  assert.equal(cfg.configured, false);
});

test('reports configured and passes url through once SMS_PROVIDER_URL is set', () => {
  const cfg = loadSmsConfigFromEnv({ SMS_PROVIDER_URL: 'https://example.test/send-sms' });
  assert.equal(cfg.configured, true);
  assert.equal(cfg.url, 'https://example.test/send-sms');
});

test('auth header is only added when SMS_PROVIDER_AUTH_HEADER is set', () => {
  assert.deepEqual(loadSmsConfigFromEnv({ SMS_PROVIDER_URL: 'https://x' }).headers, {});
  const withAuth = loadSmsConfigFromEnv({ SMS_PROVIDER_URL: 'https://x', SMS_PROVIDER_AUTH_HEADER: 'Bearer abc' });
  assert.equal(withAuth.headers.authorization, 'Bearer abc');
});

test('messageTemplate passes through only when explicitly set, otherwise undefined (otp-sender.js supplies its own default)', () => {
  assert.equal(loadSmsConfigFromEnv({ SMS_PROVIDER_URL: 'https://x' }).messageTemplate, undefined);
  const cfg = loadSmsConfigFromEnv({ SMS_PROVIDER_URL: 'https://x', SMS_PROVIDER_MESSAGE_TEMPLATE: 'Code: {code}' });
  assert.equal(cfg.messageTemplate, 'Code: {code}');
});

test('never mutates the real process.env', () => {
  const before = JSON.stringify(process.env);
  loadSmsConfigFromEnv({ SMS_PROVIDER_URL: 'https://x' });
  assert.equal(JSON.stringify(process.env), before);
});
