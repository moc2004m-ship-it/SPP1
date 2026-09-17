'use strict';

// Stage 5 audit (this session) — real gap found and fixed: this loader
// did not exist at all, so ../index.js called createAuthRouter() with no
// `socialConfig`, meaning `socialConfig[provider]` was ALWAYS undefined
// for google/facebook/apple regardless of what env vars an operator set.
// Apple therefore always failed closed (503, "Apple audience is not
// configured" — see ./provider-verifiers.js) even in an environment with
// real Apple credentials, and Google/Facebook silently fell back to
// their hardcoded default endpoints with no way to override them. Same
// "read ONLY from environment variables, never commit a secret" pattern
// as ../rtc/agora-config.js / ../push/push-config.js.
//
// Env vars (all optional — a provider with none of its vars set is
// simply reported as `configured: false`; ./provider-verifiers.js's
// existing fail-closed behavior for Apple, and the "identity must have a
// real subject" check for Google/Facebook, are UNCHANGED by this file):
//   GOOGLE_USERINFO_URL        -- override for Google's OIDC userinfo endpoint
//   FACEBOOK_USERINFO_URL      -- override for Facebook Graph API /me endpoint
//   APPLE_AUDIENCE             -- REQUIRED for Apple to work at all (your Services ID / bundle ID)
//   APPLE_ISSUER               -- override, defaults to https://appleid.apple.com
//   APPLE_JWKS_URL             -- override, defaults to https://appleid.apple.com/auth/keys
//
// Pure function of its input (defaults to process.env) so it is unit
// testable without mutating the real process environment — same
// discipline as loadAgoraConfigFromEnv().
function loadSocialConfigFromEnv(env = process.env) {
  const google = {};
  if (env.GOOGLE_USERINFO_URL) google.userInfoUrl = env.GOOGLE_USERINFO_URL.trim();

  const facebook = {};
  if (env.FACEBOOK_USERINFO_URL) facebook.userInfoUrl = env.FACEBOOK_USERINFO_URL.trim();

  const apple = {};
  const appleAudience = (env.APPLE_AUDIENCE || '').trim();
  if (appleAudience) apple.audience = appleAudience;
  if (env.APPLE_ISSUER) apple.issuer = env.APPLE_ISSUER.trim();
  if (env.APPLE_JWKS_URL) apple.jwksUrl = env.APPLE_JWKS_URL.trim();

  return {
    google: { ...google, configured: true }, // Google always works via its public default endpoint; "configured" only gates Apple's hard requirement.
    facebook: { ...facebook, configured: true },
    apple: { ...apple, configured: Boolean(appleAudience) },
  };
}

module.exports = { loadSocialConfigFromEnv };
