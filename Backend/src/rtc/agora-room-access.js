'use strict';

// Pure authorization/role logic for voice-room access. Kept dependency-
// free (no express, no store I/O) exactly like ../routes/platform.guards.js
// and ../routes/platform.reads.js, so it can be unit-tested without
// npm/network access — see ../../test/agora.room-access.test.js.
//
// Room ownership is the only membership concept that exists in this
// codebase today (see feature-platform.js: rooms.create sets ownerId,
// and there is no separate "members" list). Voice authorization is built
// on top of that real concept only — it does not invent a fake
// membership/roster model.

function forbidden(message) {
  return Object.assign(new Error(message), { status: 403 });
}
function notFound(message) {
  return Object.assign(new Error(message), { status: 404 });
}

// Host/audience is server-decided from real room ownership — the client
// cannot request a role, and nothing here trusts a client-supplied role.
function determineRtcRole(room, accountId) {
  return room.ownerId === accountId ? 'host' : 'audience';
}

// A room's real visibility field (set at creation — see
// feature-platform.js rooms.create) is the only access-control signal
// that exists today, since there is no join/membership table yet (the
// same limitation already documented for Family in
// PHASE4_SIX_DOMAINS_READ_REPORT.md). Until a real membership/roster
// system exists:
//   - a 'public' (or unset/default) room's voice channel is reachable by
//     any authenticated session, same visibility level already used for
//     GET /api/rooms itself.
//   - a 'private' room's voice channel is reachable only by its owner,
//     since there is no real way yet to know who else was actually
//     invited/admitted.
// This is a conservative default-deny choice, not a guess at a feature
// that doesn't exist.
function assertCanJoinRoomVoice(room, accountId) {
  if (!room) throw notFound('room not found');
  if (room.visibility === 'private' && room.ownerId !== accountId) {
    throw forbidden('this room is private; only the room owner can start/join its voice channel until membership is implemented');
  }
  return determineRtcRole(room, accountId);
}

module.exports = { determineRtcRole, assertCanJoinRoomVoice, forbidden, notFound };
