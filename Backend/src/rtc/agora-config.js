'use strict';

// Agora RTC configuration — read ONLY from environment variables. This
// file never contains a real App ID / App Certificate, never logs the
// certificate, and never places it anywhere a client could read it back
// (see ../routes/agora.routes.js, which only ever returns the App ID +
// a generated token to the client, never the certificate).
//
// Required env vars (set on the Backend host only):
//   AGORA_APP_ID            -- Agora project App ID (not secret, but still
//                              only served to an authenticated session).
//   AGORA_APP_CERTIFICATE   -- Agora project App Certificate. SECRET.
//                              Must never be committed, logged, placed in
//                              Mobile code, or returned in any API
//                              response.
// Optional:
//   AGORA_RTC_TOKEN_TTL_SECONDS -- token lifetime in seconds. Defaults to
//                              3600 (1 hour). Kept short on purpose so a
//                              leaked token has a limited blast radius;
//                              the Mobile client is expected to refresh
//                              (see Mobile/app/rtc/agora-voice-client.js).

const DEFAULT_TTL_SECONDS = 3600;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 24 * 60 * 60; // 24h hard ceiling regardless of env input

function parseTtl(raw) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TTL_SECONDS;
  return Math.min(Math.max(n, MIN_TTL_SECONDS), MAX_TTL_SECONDS);
}

// Pure function of its input (defaults to process.env) so it can be unit
// tested without mutating the real process environment.
function loadAgoraConfigFromEnv(env = process.env) {
  const appId = (env.AGORA_APP_ID || '').trim();
  const appCertificate = (env.AGORA_APP_CERTIFICATE || '').trim();
  const tokenTtlSeconds = parseTtl(env.AGORA_RTC_TOKEN_TTL_SECONDS);
  return {
    appId,
    appCertificate,
    tokenTtlSeconds,
    configured: Boolean(appId && appCertificate),
  };
}

module.exports = { loadAgoraConfigFromEnv, DEFAULT_TTL_SECONDS, MIN_TTL_SECONDS, MAX_TTL_SECONDS };
