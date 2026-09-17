'use strict';

// Stage 33 — Push provider service.
//
// Same shape as ../rtc/agora-token.service.js: this is the ONLY code path
// that ever talks to Firebase Cloud Messaging. If push is not configured
// (missing env vars, see ./push-config.js) OR the `firebase-admin`
// package is not installed (see ./firebase-sdk-loader.js), every send
// throws a real 503 -- there is NO fallback fake/placeholder "delivered"
// response. A caller (notification.service.js) is expected to treat a
// failed/unavailable push as "in-app notification still recorded, push
// delivery BLOCKED" rather than as a failure of the whole notify() call
// -- see that file's header for exactly how it handles this.
//
// `sdk` is whatever ./firebase-sdk-loader.js returned (or null). Kept as
// a constructor parameter (not required() inside this file) so tests can
// inject a fake admin object and exercise every branch of this service
// without the real firebase-admin package being installed -- see
// ../../test/push.service.test.js, same technique as
// ../../test/agora.token.service.test.js.

function configError(message) {
  return Object.assign(new Error(message), { status: 503 });
}

function createPushProvider({ projectId, clientEmail, privateKey, sdk }) {
  const isConfigured = () => Boolean(projectId && clientEmail && privateKey);
  const isSdkAvailable = () => Boolean(sdk && sdk.admin);

  let app = null;
  function getApp() {
    if (app) return app;
    // initializeApp() is called lazily (only once actually sending is
    // attempted, not at construction) so building this service with an
    // unconfigured/uninstalled SDK never throws by itself -- only an
    // actual send attempt does, same "fail at the point of use" contract
    // as agora-token.service.js.
    app = sdk.admin.initializeApp({
      credential: sdk.admin.credential.cert({ projectId, clientEmail, privateKey }),
    }, `push-${projectId}-${Date.now()}`);
    return app;
  }

  // tokens: array of real device push tokens (from
  // notification.repository.js's push_tokens table, via
  // notification.service.js). title/body/data: the real notification
  // content already decided by the caller -- this service has no opinion
  // on notification copy, it only ever forwards what it is given.
  //
  // Returns { successCount, failureCount, invalidTokens } -- invalidTokens
  // are token strings FCM reports as no-longer-registered, so the caller
  // can prune them from push_tokens (a token going stale, e.g. app
  // uninstalled, is an expected real-world outcome, not an error).
  async function sendToTokens({ tokens, title, body, data }) {
    if (!isConfigured()) {
      throw configError('Push is not configured on this server (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY missing)');
    }
    if (!isSdkAvailable()) {
      throw configError('Firebase Admin SDK is not installed on this server (run `npm install firebase-admin`)');
    }
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    const currentApp = getApp();
    const messaging = sdk.admin.messaging(currentApp);
    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: data || {},
    });

    const invalidTokens = [];
    (response.responses || []).forEach((r, i) => {
      if (!r.success) {
        const code = r.error && r.error.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
          invalidTokens.push(tokens[i]);
        }
      }
    });

    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
      invalidTokens,
    };
  }

  return { isConfigured, isSdkAvailable, sendToTokens };
}

module.exports = { createPushProvider };
