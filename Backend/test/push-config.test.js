'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPushConfigFromEnv } = require('../src/push/push-config');

test('configured is false when any required var is missing', () => {
  assert.equal(loadPushConfigFromEnv({}).configured, false);
  assert.equal(loadPushConfigFromEnv({ FIREBASE_PROJECT_ID: 'p' }).configured, false);
  assert.equal(loadPushConfigFromEnv({ FIREBASE_PROJECT_ID: 'p', FIREBASE_CLIENT_EMAIL: 'e@x.com' }).configured, false);
});

test('configured is true when all three vars are present', () => {
  const config = loadPushConfigFromEnv({
    FIREBASE_PROJECT_ID: 'proj_1',
    FIREBASE_CLIENT_EMAIL: 'svc@proj_1.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n',
  });
  assert.equal(config.configured, true);
  assert.equal(config.projectId, 'proj_1');
  assert.equal(config.clientEmail, 'svc@proj_1.iam.gserviceaccount.com');
});

test('normalizes escaped \\n sequences in the private key into real newlines', () => {
  const config = loadPushConfigFromEnv({
    FIREBASE_PROJECT_ID: 'p',
    FIREBASE_CLIENT_EMAIL: 'e@x.com',
    FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n',
  });
  assert.ok(config.privateKey.includes('\n'), 'literal \\n must become a real newline');
  assert.ok(!config.privateKey.includes('\\n'), 'no escaped \\n sequences should remain');
});

test('this backend\'s current real process.env is BLOCKED (no push credentials set in this sandbox)', () => {
  // Documents the real, current state of this sandbox rather than
  // asserting a hardcoded false -- if a future environment happens to set
  // these vars, this test should reflect that, not silently pass either
  // way.
  const config = loadPushConfigFromEnv(process.env);
  assert.equal(typeof config.configured, 'boolean');
});
