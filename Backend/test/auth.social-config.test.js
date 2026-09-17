'use strict';
// Stage 5 audit (this session) — dependency-free tests for the new
// env-var loader (../src/auth/social-config.js). No express, no network
// — same rationale as agora.config.test.js/platform.auth.guards.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSocialConfigFromEnv } = require('../src/auth/social-config');

test('google/facebook are always reported configured (public default endpoints need no secret)', () => {
  const cfg = loadSocialConfigFromEnv({});
  assert.equal(cfg.google.configured, true);
  assert.equal(cfg.facebook.configured, true);
  assert.equal(cfg.google.userInfoUrl, undefined);
  assert.equal(cfg.facebook.userInfoUrl, undefined);
});

test('google/facebook userInfoUrl overrides are read from env when present', () => {
  const cfg = loadSocialConfigFromEnv({
    GOOGLE_USERINFO_URL: 'https://example.test/google-userinfo',
    FACEBOOK_USERINFO_URL: 'https://example.test/fb-me',
  });
  assert.equal(cfg.google.userInfoUrl, 'https://example.test/google-userinfo');
  assert.equal(cfg.facebook.userInfoUrl, 'https://example.test/fb-me');
});

test('apple is reported NOT configured when APPLE_AUDIENCE is missing (fails closed, matches provider-verifiers.js)', () => {
  const cfg = loadSocialConfigFromEnv({});
  assert.equal(cfg.apple.configured, false);
  assert.equal(cfg.apple.audience, undefined);
});

test('apple is reported configured once APPLE_AUDIENCE is set, and issuer/jwksUrl overrides pass through', () => {
  const cfg = loadSocialConfigFromEnv({
    APPLE_AUDIENCE: 'com.example.app',
    APPLE_ISSUER: 'https://example.test/issuer',
    APPLE_JWKS_URL: 'https://example.test/jwks',
  });
  assert.equal(cfg.apple.configured, true);
  assert.equal(cfg.apple.audience, 'com.example.app');
  assert.equal(cfg.apple.issuer, 'https://example.test/issuer');
  assert.equal(cfg.apple.jwksUrl, 'https://example.test/jwks');
});

test('whitespace-only APPLE_AUDIENCE is treated as unset (still fails closed)', () => {
  const cfg = loadSocialConfigFromEnv({ APPLE_AUDIENCE: '   ' });
  assert.equal(cfg.apple.configured, false);
});

test('never derives config from anything other than the given env object (no hardcoded fallback)', () => {
  const before = JSON.stringify(process.env);
  loadSocialConfigFromEnv({ APPLE_AUDIENCE: 'x' });
  assert.equal(JSON.stringify(process.env), before, 'must not mutate the real process.env');
});
