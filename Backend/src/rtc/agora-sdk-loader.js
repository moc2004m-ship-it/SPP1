'use strict';

// Loads Agora's own, officially maintained token-generation library.
//
// IMPORTANT — this project deliberately does NOT hand-roll the Agora
// token signing/packing algorithm. That algorithm has to match Agora's
// server-side verification byte-for-byte; re-implementing it from memory
// without the ability to test against a live Agora project (this sandbox
// has no network egress) risks producing a token that looks correct but
// silently fails to authenticate. The only responsible option is to
// depend on Agora's published package, the same way this backend already
// depends on `pg` for Postgres (see ../database/index.js) instead of
// hand-writing a wire-protocol client.
//
// Package name has changed across Agora SDK generations; try the current
// one first, then the legacy name, so this keeps working either way.
//   npm install agora-token        (current, npmjs.com/package/agora-token)
//   npm install agora-access-token (legacy name, same maintainers)
//
// Returns { RtcTokenBuilder, RtcRole, source } or null if neither package
// is installed. Never throws — callers decide how to report "not
// available" (see ../rtc/agora-token.service.js).
function loadAgoraTokenBuilder() {
  const candidates = ['agora-token', 'agora-access-token'];
  for (const name of candidates) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const mod = require(name);
      if (mod && mod.RtcTokenBuilder) {
        return { RtcTokenBuilder: mod.RtcTokenBuilder, RtcRole: mod.RtcRole || null, source: name };
      }
    } catch (err) {
      // Not installed (or failed to load) — try the next candidate.
    }
  }
  return null;
}

module.exports = { loadAgoraTokenBuilder };
