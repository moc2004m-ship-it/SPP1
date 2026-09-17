'use strict';

// Loads Firebase's own, officially maintained Admin SDK.
//
// IMPORTANT — same reasoning as ../rtc/agora-sdk-loader.js: this project
// deliberately does NOT hand-roll FCM's HTTP v1 request signing/auth
// (a Google OAuth2 service-account JWT flow). Re-implementing it from
// memory without the ability to test against real Firebase infrastructure
// (this sandbox has no network egress) risks producing a request that
// looks correct but silently fails to authenticate. The only responsible
// option is to depend on Firebase's published `firebase-admin` package,
// the same way this backend already depends on `pg` for Postgres and
// `agora-token`/`agora-access-token` for Agora.
//
//   npm install firebase-admin   (npmjs.com/package/firebase-admin)
//
// Returns { admin, source: 'firebase-admin' } or null if the package is
// not installed. Never throws — callers decide how to report "not
// available" (see ./push.service.js).
function loadFirebaseAdmin() {
  try {
    // eslint-disable-next-line global-require
    const admin = require('firebase-admin');
    if (admin && typeof admin.initializeApp === 'function') {
      return { admin, source: 'firebase-admin' };
    }
    return null;
  } catch (err) {
    // Not installed (or failed to load) — this is the expected, documented
    // state in this sandbox (no network egress to npm).
    return null;
  }
}

module.exports = { loadFirebaseAdmin };
