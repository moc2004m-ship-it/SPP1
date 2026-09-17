'use strict';

// Authorization guards for the /platform/api/* routes.
// These are pure functions (no express, no I/O beyond the in-memory store
// passed in) so they can be unit-tested without installing dependencies.

function forbidden(message) {
  return Object.assign(new Error(message), { status: 403 });
}

function notFound(message) {
  return Object.assign(new Error(message), { status: 404 });
}

// Confirms the authenticated session belongs to the account the request is
// trying to act as / read data for. Throws instead of trusting a
// client-supplied userId in the body/query/params.
function assertOwnAccount(session, userId) {
  if (!session || !session.accountId) throw forbidden('authentication required');
  if (session.accountId !== userId) throw forbidden('you may only access your own account');
  return session.accountId;
}

// Confirms the authenticated session is the owner of the given room before
// allowing host/moderator-only actions (settings, moderation).
async function requireRoomOwner(store, roomId, session) {
  if (!session || !session.accountId) throw forbidden('authentication required');
  const room = await store.find(12, (r) => r.id === roomId);
  if (!room) throw notFound('room not found');
  if (room.ownerId !== session.accountId) throw forbidden('only the room owner can perform this action');
  return room;
}

// Stage 19 — Room Game Center authorization. Distinct from
// requireRoomOwner() above (which is "host/moderator-only", e.g. room
// settings, PK/Battle challenges): a room's Game Center is meant for
// anyone actually in the room to use, not just its owner. "In the room"
// means either the room's owner (who never has to separately join their
// own room to use it), or a currently-active ('joined' or
// 'disconnected'/reconnectable) Stage 13 membership record for that
// account+room -- the exact same real membership ledger
// join()/leave()/disconnect()/reconnect() already maintain (store type
// 13), not a new or parallel concept of "membership".
async function isRoomMember(store, roomId, accountId) {
  if (!accountId) return false;
  const room = await store.find(12, (r) => r.id === roomId);
  if (!room) return false;
  if (room.ownerId === accountId) return true;
  const membership = await store.find(
    13,
    (m) => m.roomId === roomId && m.userId === accountId && (m.status === 'joined' || m.status === 'disconnected')
  );
  return !!membership;
}

// Route-layer guard mirroring requireRoomOwner()'s shape: 404s for an
// unknown room, 403s for an authenticated session that is neither the
// room's owner nor a real member of it, otherwise resolves to the room.
async function requireRoomMember(store, roomId, session) {
  if (!session || !session.accountId) throw forbidden('authentication required');
  const room = await store.find(12, (r) => r.id === roomId);
  if (!room) throw notFound('room not found');
  const member = await isRoomMember(store, roomId, session.accountId);
  if (!member) throw forbidden('you must be a member of this room to use its game center');
  return room;
}

module.exports = { forbidden, notFound, assertOwnAccount, requireRoomOwner, isRoomMember, requireRoomMember };
