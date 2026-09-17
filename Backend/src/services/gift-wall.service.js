// Stage 26 — Gift Wall service.
//
// The Gift Wall is scoped to one Host Room Session: a room's wall is
// whatever is recorded against its current ACTIVE gift_wall_sessions row
// (see ../database/repositories/gift-wall.repository.js). Nothing here
// ever trusts a client-supplied amount or sessionId -- `recordContribution`
// is only ever called from services/gifts.service.js, AFTER a real,
// already-committed gift record exists (real wallet debit already done,
// real catalog price already looked up server-side). This service adds no
// second debit and moves no money -- it only tallies, ranks, and resets a
// per-session leaderboard from numbers gifts.service.js has already
// finalized.

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw Object.assign(new Error(`${name} must be a positive integer`), { status: 400 });
  }
  return value;
}

function assertId(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw Object.assign(new Error(`${name} is required`), { status: 400 });
  }
  return value;
}

function createGiftWallService({ giftWall }) {
  // Called exactly once per real, already-committed gift send -- see
  // services/gifts.service.js. `amount` must always be the server-computed
  // totalCostCoins already debited from the sender's wallet, never a raw
  // client field. Idempotent per `giftId`: a retried/duplicate call for a
  // gift that was already applied to a wall is a real no-op (see the
  // repository's applied-gifts dedupe guard), so double counting cannot
  // happen even under a retry.
  async function recordContribution({ roomId, gifterId, giftId, amount }) {
    assertId(roomId, 'roomId');
    assertId(gifterId, 'gifterId');
    assertId(giftId, 'giftId');
    assertPositiveInteger(amount, 'amount');

    const session = await giftWall.getOrCreateActiveSession(roomId);
    const result = await giftWall.addContribution({ sessionId: session.id, gifterId, giftId, amount });
    return { sessionId: session.id, roomId, gifterId, applied: result.applied, totalCoins: result.totalCoins };
  }

  // Real-time read of "the gift wall right now" for a room: the current
  // active session's per-gifter totals, ranked highest-first, with the
  // top 3 broken out explicitly. Returns an honest empty wall (no fake
  // placeholder gifters) when the room has no active session yet -- e.g.
  // no gift has ever been sent there, or the last session was closed and
  // nothing has been sent since.
  async function getWall(roomId) {
    assertId(roomId, 'roomId');
    const session = await giftWall.getActiveSession(roomId);
    if (!session) {
      return { roomId, sessionId: null, status: 'inactive', startedAt: null, totalCoins: 0, gifters: [], topGifters: [] };
    }
    const gifters = await giftWall.getContributions(session.id);
    const totalCoins = gifters.reduce((sum, g) => sum + g.totalCoins, 0);
    return {
      roomId,
      sessionId: session.id,
      status: session.status,
      startedAt: session.startedAt,
      totalCoins,
      gifters,
      topGifters: gifters.slice(0, 3),
    };
  }

  // Ends the room's current Host Room Session gift wall. The next gift
  // sent to this room opens a brand-new session (via
  // getOrCreateActiveSession) with a clean wall -- this session's
  // contributions are never carried over and never mixed with the new
  // one. Authorization (host-only) is enforced by the route layer via
  // ../routes/platform.guards.js#requireRoomOwner, same pattern as every
  // other host-only action (mute/kick/room settings) -- this service has
  // no opinion on identity, only on state.
  async function closeSession(roomId) {
    assertId(roomId, 'roomId');
    const session = await giftWall.getActiveSession(roomId);
    if (!session) {
      throw Object.assign(new Error('no active gift wall session for this room'), { status: 404 });
    }
    const finalGifters = await giftWall.getContributions(session.id);
    const closed = await giftWall.closeSession(session.id);
    const totalCoins = finalGifters.reduce((sum, g) => sum + g.totalCoins, 0);
    return {
      roomId,
      sessionId: closed.id,
      status: closed.status,
      startedAt: closed.startedAt,
      closedAt: closed.closedAt,
      totalCoins,
      finalGifters,
      finalTopGifters: finalGifters.slice(0, 3),
    };
  }

  return { recordContribution, getWall, closeSession };
}

module.exports = { createGiftWallService };
