'use strict';

// Stage 33 — Push (Firebase Cloud Messaging) configuration — read ONLY
// from environment variables. Same shape and same secrecy discipline as
// ../rtc/agora-config.js: this file never contains a real private key,
// never logs it, and never places it anywhere a client could read it
// back (see ../services/notification.service.js and
// ../routes/platform.routes.js, which only ever expose whether push is
// configured, never the credential itself).
//
// Required env vars (set on the Backend host only):
//   FIREBASE_PROJECT_ID    -- Firebase project id (not secret, but still
//                              only ever used server-side here).
//   FIREBASE_CLIENT_EMAIL  -- Firebase service account client email.
//   FIREBASE_PRIVATE_KEY   -- Firebase service account private key.
//                              SECRET. Must never be committed, logged,
//                              placed in Mobile code, or returned in any
//                              API response. Stored in most hosting
//                              providers' env with literal "\n" sequences
//                              instead of real newlines -- normalized
//                              below, same requirement documented by
//                              Firebase Admin SDK's own setup docs.

// Pure function of its input (defaults to process.env) so it can be unit
// tested without mutating the real process environment -- same pattern
// as agora-config.js's loadAgoraConfigFromEnv().
function loadPushConfigFromEnv(env = process.env) {
  const projectId = (env.FIREBASE_PROJECT_ID || '').trim();
  const clientEmail = (env.FIREBASE_CLIENT_EMAIL || '').trim();
  const rawPrivateKey = (env.FIREBASE_PRIVATE_KEY || '').trim();
  // Normalize escaped newlines -- most hosting providers cannot store a
  // literal multi-line env var, so the private key is commonly set with
  // "\n" escape sequences that must become real newlines before Firebase
  // Admin SDK will parse the PEM block correctly.
  const privateKey = rawPrivateKey.replace(/\\n/g, '\n');
  return {
    projectId,
    clientEmail,
    privateKey,
    configured: Boolean(projectId && clientEmail && privateKey),
  };
}

module.exports = { loadPushConfigFromEnv };
