'use strict';

const { requireId } = require('../feature-platform');

function configError(message) {
  return Object.assign(new Error(message), { status: 503 });
}
function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

// Stable, documented Agora role constants (part of Agora's public API
// surface, not the signing algorithm) — used as a fallback if the loaded
// package does not export RtcRole for some reason.
const FALLBACK_ROLE = { PUBLISHER: 1, SUBSCRIBER: 2 };

// role in this backend's own vocabulary is 'host' | 'audience' (matches
// the room ownership model already in feature-platform.js / platform.guards.js).
// It is translated to Agora's PUBLISHER/SUBSCRIBER here, in one place, so
// nothing else in the codebase needs to know Agora's numeric constants.
function resolveAgoraRole(role, RtcRole) {
  const table = RtcRole || FALLBACK_ROLE;
  if (role === 'host') return table.PUBLISHER;
  if (role === 'audience') return table.SUBSCRIBER;
  throw badRequest(`unknown rtc role "${role}" (expected "host" or "audience")`);
}

// `sdk` is whatever ../rtc/agora-sdk-loader.js returned (or null). Kept as
// a constructor parameter (not required() inside this file) so tests can
// inject a fake builder and exercise every branch of this service without
// the real agora-token package being installed — see
// ../../test/agora.token.service.test.js.
function createAgoraTokenService({ appId, appCertificate, tokenTtlSeconds, sdk }) {
  const isConfigured = () => Boolean(appId && appCertificate);
  const isSdkAvailable = () => Boolean(sdk && sdk.RtcTokenBuilder);

  return {
    isConfigured,
    isSdkAvailable,

    // channelName: the room id, treated as the Agora channel 1:1.
    // account: the caller's OWN accountId, taken from the verified
    //   session by the route layer — this function must never be called
    //   with a client-supplied identity (see ../routes/agora.routes.js).
    // role: 'host' | 'audience', decided server-side by
    //   ../rtc/agora-room-access.js from real room ownership, never
    //   trusted from the client.
    generateRtcToken({ channelName, account, role }) {
      if (!isConfigured()) {
        throw configError('Agora is not configured on this server (AGORA_APP_ID / AGORA_APP_CERTIFICATE missing)');
      }
      if (!isSdkAvailable()) {
        throw configError('Agora token SDK is not installed on this server (run `npm install agora-token`)');
      }
      const channel = requireId(channelName, 'channelName');
      const uidAccount = requireId(account, 'account');
      const agoraRole = resolveAgoraRole(role, sdk.RtcRole);

      const issuedAtSeconds = Math.floor(Date.now() / 1000);
      const privilegeExpiredTs = issuedAtSeconds + tokenTtlSeconds;

      // Agora's official builder supports a string "user account" uid
      // (buildTokenWithUserAccount / the legacy buildTokenWithAccount) so
      // this service never needs to invent a numeric-uid mapping of its
      // own — it reuses the platform's existing real accountId directly.
      const build = sdk.RtcTokenBuilder.buildTokenWithUserAccount || sdk.RtcTokenBuilder.buildTokenWithAccount;
      if (typeof build !== 'function') {
        throw configError('installed Agora token SDK does not expose a user-account token builder');
      }
      const token = build.call(
        sdk.RtcTokenBuilder,
        appId,
        appCertificate,
        channel,
        uidAccount,
        agoraRole,
        privilegeExpiredTs,
        privilegeExpiredTs
      );

      // appCertificate is intentionally excluded from this return value —
      // this object is exactly what ../routes/agora.routes.js sends back
      // to the client.
      return {
        appId,
        channel,
        uid: uidAccount,
        role,
        token,
        ttlSeconds: tokenTtlSeconds,
        expiresAt: new Date(privilegeExpiredTs * 1000).toISOString(),
      };
    },
  };
}

module.exports = { createAgoraTokenService, resolveAgoraRole, FALLBACK_ROLE };
