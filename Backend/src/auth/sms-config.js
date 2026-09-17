'use strict';

// Stage 5 audit (this session) — real gap found and fixed: this loader
// did not exist, so ../index.js called createAuthRouter() with no
// `smsConfig`, meaning ./otp-sender.js's `cfg.url` was ALWAYS undefined
// in production regardless of what env vars an operator set — every real
// deployment would silently be stuck on the fail-closed 503 path forever,
// with no way to actually turn SMS delivery on. Same "read ONLY from
// environment variables" pattern as ./social-config.js / ../rtc/agora-config.js.
//
// Env vars (all optional — SMS stays fail-closed, per ./otp-sender.js,
// unless SMS_PROVIDER_URL is set):
//   SMS_PROVIDER_URL              -- REQUIRED for real SMS delivery. The
//                                    provider's send endpoint. POSTed
//                                    {to, message} as JSON (see
//                                    ./otp-sender.js).
//   SMS_PROVIDER_AUTH_HEADER      -- optional, e.g. "Bearer xxxx" — sent
//                                    as the `authorization` header.
//   SMS_PROVIDER_MESSAGE_TEMPLATE -- optional override, must contain
//                                    "{code}"; defaults to
//                                    "Your verification code is {code}".
function loadSmsConfigFromEnv(env = process.env) {
  const url = (env.SMS_PROVIDER_URL || '').trim();
  const headers = {};
  if (env.SMS_PROVIDER_AUTH_HEADER) headers.authorization = env.SMS_PROVIDER_AUTH_HEADER.trim();
  const messageTemplate = env.SMS_PROVIDER_MESSAGE_TEMPLATE || undefined;
  return {
    url: url || undefined,
    headers,
    messageTemplate,
    configured: Boolean(url),
  };
}

module.exports = { loadSmsConfigFromEnv };
