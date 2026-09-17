'use strict';
// Dependency-free tests for ../src/push/push.service.js. The real
// `firebase-admin` package cannot be installed in this sandbox (no
// network egress to npm — same pre-existing constraint documented for
// `express`/`agora-token` elsewhere in this test suite), so a fake `sdk`
// is injected here to exercise every branch of THIS service's own logic
// (config checks, SDK-availability checks, empty-tokens short circuit,
// successCount/failureCount passthrough, invalidTokens extraction). This
// does NOT verify that a real Firebase server accepts/delivers the
// resulting message — that remains BLOCKED (see STAGE33_FINAL_REPORT.md),
// same technique and same honesty discipline as
// ../../test/agora.token.service.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPushProvider } = require('../src/push/push.service');

function fakeSdk({ sendImpl } = {}) {
  const initializeAppCalls = [];
  const certCalls = [];
  const messagingCalls = [];
  const admin = {
    initializeApp(config, name) {
      initializeAppCalls.push({ config, name });
      return { name };
    },
    credential: {
      cert(config) {
        certCalls.push(config);
        return { __cert: true, ...config };
      },
    },
    messaging(app) {
      messagingCalls.push(app);
      return {
        async sendEachForMulticast(message) {
          if (sendImpl) return sendImpl(message);
          return {
            successCount: message.tokens.length,
            failureCount: 0,
            responses: message.tokens.map(() => ({ success: true })),
          };
        },
      };
    },
  };
  return { sdk: { admin }, initializeAppCalls, certCalls, messagingCalls };
}

test('isConfigured is false and sendToTokens throws a 503 when projectId/clientEmail/privateKey are missing', async () => {
  const { sdk } = fakeSdk();
  const provider = createPushProvider({ projectId: '', clientEmail: '', privateKey: '', sdk });
  assert.equal(provider.isConfigured(), false);
  await assert.rejects(
    () => provider.sendToTokens({ tokens: ['t1'], title: 'hi', body: 'there' }),
    (err) => err.status === 503 && /not configured/.test(err.message)
  );
});

test('isSdkAvailable is false and sendToTokens throws a 503 when the Firebase Admin SDK package is not installed', async () => {
  const provider = createPushProvider({ projectId: 'p', clientEmail: 'e@x.com', privateKey: 'k', sdk: null });
  assert.equal(provider.isConfigured(), true);
  assert.equal(provider.isSdkAvailable(), false);
  await assert.rejects(
    () => provider.sendToTokens({ tokens: ['t1'], title: 'hi', body: 'there' }),
    (err) => err.status === 503 && /not installed/.test(err.message)
  );
});

test('an empty tokens array returns a zeroed result without ever calling the SDK', async () => {
  const { sdk, messagingCalls } = fakeSdk();
  const provider = createPushProvider({ projectId: 'p', clientEmail: 'e@x.com', privateKey: 'k', sdk });
  const result = await provider.sendToTokens({ tokens: [], title: 'hi', body: 'there' });
  assert.deepEqual(result, { successCount: 0, failureCount: 0, invalidTokens: [] });
  assert.equal(messagingCalls.length, 0);
});

test('a missing tokens field is treated the same as empty (no SDK call, zeroed result)', async () => {
  const { sdk, messagingCalls } = fakeSdk();
  const provider = createPushProvider({ projectId: 'p', clientEmail: 'e@x.com', privateKey: 'k', sdk });
  const result = await provider.sendToTokens({ title: 'hi', body: 'there' });
  assert.deepEqual(result, { successCount: 0, failureCount: 0, invalidTokens: [] });
  assert.equal(messagingCalls.length, 0);
});

test('a successful send returns the real successCount/failureCount from the SDK response', async () => {
  const { sdk } = fakeSdk({
    sendImpl: (message) => ({
      successCount: message.tokens.length,
      failureCount: 0,
      responses: message.tokens.map(() => ({ success: true })),
    }),
  });
  const provider = createPushProvider({ projectId: 'p', clientEmail: 'e@x.com', privateKey: 'k', sdk });
  const result = await provider.sendToTokens({ tokens: ['t1', 't2', 't3'], title: 'Gift', body: 'You got a rose' });
  assert.equal(result.successCount, 3);
  assert.equal(result.failureCount, 0);
  assert.deepEqual(result.invalidTokens, []);
});

test('extracts invalidTokens from messaging/registration-token-not-registered and messaging/invalid-registration-token error codes only', async () => {
  const { sdk } = fakeSdk({
    sendImpl: (message) => ({
      successCount: 1,
      failureCount: 3,
      responses: [
        { success: true },
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
        { success: false, error: { code: 'messaging/invalid-registration-token' } },
        { success: false, error: { code: 'messaging/internal-error' } },
      ],
    }),
  });
  const provider = createPushProvider({ projectId: 'p', clientEmail: 'e@x.com', privateKey: 'k', sdk });
  const result = await provider.sendToTokens({
    tokens: ['good', 'stale_1', 'stale_2', 'transient_fail'],
    title: 'Gift',
    body: 'You got a rose',
  });
  assert.equal(result.successCount, 1);
  assert.equal(result.failureCount, 3);
  // Only the two real "token is gone for good" codes are surfaced for
  // pruning -- a transient/internal error must NOT cause the caller to
  // delete a possibly-still-valid device token.
  assert.deepEqual(result.invalidTokens, ['stale_1', 'stale_2']);
});

test('forwards title/body/data unchanged to the SDK and defaults data to an empty object', async () => {
  const calls = [];
  const { sdk } = fakeSdk({
    sendImpl: (message) => {
      calls.push(message);
      return { successCount: message.tokens.length, failureCount: 0, responses: message.tokens.map(() => ({ success: true })) };
    },
  });
  const provider = createPushProvider({ projectId: 'p', clientEmail: 'e@x.com', privateKey: 'k', sdk });
  await provider.sendToTokens({ tokens: ['t1'], title: 'Title X', body: 'Body Y', data: { notificationId: 'n_1' } });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].notification, { title: 'Title X', body: 'Body Y' });
  assert.deepEqual(calls[0].data, { notificationId: 'n_1' });

  await provider.sendToTokens({ tokens: ['t2'], title: 'No data', body: 'here' });
  assert.deepEqual(calls[1].data, {});
});

test('never leaks the private key anywhere in a returned send result', async () => {
  const { sdk } = fakeSdk();
  const provider = createPushProvider({ projectId: 'p', clientEmail: 'e@x.com', privateKey: 'super_secret_key', sdk });
  const result = await provider.sendToTokens({ tokens: ['t1'], title: 'hi', body: 'there' });
  assert.doesNotMatch(JSON.stringify(result), /super_secret_key/);
});

test('initializeApp is called lazily (only on first actual send), not at provider construction', () => {
  const { sdk, initializeAppCalls } = fakeSdk();
  createPushProvider({ projectId: 'p', clientEmail: 'e@x.com', privateKey: 'k', sdk });
  assert.equal(initializeAppCalls.length, 0);
});

test('reuses the same Firebase app across multiple sendToTokens calls instead of re-initializing each time', async () => {
  const { sdk, initializeAppCalls } = fakeSdk();
  const provider = createPushProvider({ projectId: 'p', clientEmail: 'e@x.com', privateKey: 'k', sdk });
  await provider.sendToTokens({ tokens: ['t1'], title: 'a', body: 'b' });
  await provider.sendToTokens({ tokens: ['t2'], title: 'c', body: 'd' });
  assert.equal(initializeAppCalls.length, 1);
});
