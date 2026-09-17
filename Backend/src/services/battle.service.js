// Stage 18 — PK/Battles service.
//
// createChallenge() requires the caller to actually own the room they are
// starting a battle in -- enforced by the route layer via
// ../routes/platform.guards.js#requireRoomOwner, the same pattern
// gift-wall's closeSession() route uses (see ../routes/platform.routes.js).
// This file does not re-implement that check; it trusts hostId exactly as
// much as the route already verified it (hostId is always
// req.session.accountId, never a client-supplied field).
//
// acceptChallenge()/declineChallenge() require the caller to be the
// CHALLENGED opponent -- a battle cannot be accepted or declined by
// anyone else, including the host who created it.
//
// recordGiftPoints() is the ONLY way a battle's score ever changes. It is
// an OPTIONAL dependency of services/gifts.service.js (same additive
// pattern as giftWallService/coupleService/eventService there): when
// wired in, it is called AFTER a real gift record (and the real wallet
// debit behind it) already committed, with the exact coin amount already
// spent -- never a client-supplied score. If no battle is currently
// active in that room, or the gift's receiver is neither side of the
// battle, this is a real no-op -- no error, no fabricated points.
//
// A battle's winner (end()) is computed purely from hostScore/
// opponentScore, which themselves only ever move through
// recordGiftPoints() above -- so a battle result is always traceable back
// to real, already-spent coins. This is the honest alternative to
// game-match.service.js's finishMatch(), which stays blocked precisely
// because games have no equivalent real signal yet (see that file).

const { assertDifferentAccounts, resolveDurationMs } = require('../database/models/battle.model');

function assertId(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw Object.assign(new Error(`${name} is required`), { status: 400 });
  }
  return value;
}

function forbidden(message) {
  return Object.assign(new Error(message), { status: 403 });
}

function notFound(message) {
  return Object.assign(new Error(message), { status: 404 });
}

function createBattleService({ battles }) {
  // A battle past its own endsAt is over even if no one has explicitly
  // ended it yet -- this lazily closes it (real winner computed from
  // whatever real score existed at expiry) the next time anyone reads it,
  // so a client never has to poll a separate "sweep" endpoint and a score
  // can never accrue past the round it was earned in.
  async function _withAutoEnd(battle) {
    if (!battle) return battle;
    if (battle.status === 'active' && battle.endsAt && new Date(battle.endsAt).getTime() <= Date.now()) {
      return battles.end(battle.id);
    }
    return battle;
  }

  async function createChallenge({ roomId, hostId, opponentId, durationMs }) {
    assertId(roomId, 'roomId');
    assertId(hostId, 'hostId');
    assertId(opponentId, 'opponentId');
    assertDifferentAccounts(hostId, opponentId);
    const resolvedDurationMs = resolveDurationMs(durationMs);
    return battles.create({ roomId, hostId, opponentId, durationMs: resolvedDurationMs });
  }

  async function acceptChallenge(actorId, battleId) {
    assertId(actorId, 'actorId');
    assertId(battleId, 'battleId');
    const battle = await battles.findById(battleId);
    if (!battle) throw notFound('battle not found');
    if (battle.opponentId !== actorId) throw forbidden('only the challenged opponent can accept this battle');
    if (battle.status !== 'pending') throw Object.assign(new Error(`battle is already ${battle.status}`), { status: 409 });
    return battles.accept(battleId);
  }

  async function declineChallenge(actorId, battleId) {
    assertId(actorId, 'actorId');
    assertId(battleId, 'battleId');
    const battle = await battles.findById(battleId);
    if (!battle) throw notFound('battle not found');
    if (battle.opponentId !== actorId) throw forbidden('only the challenged opponent can decline this battle');
    if (battle.status !== 'pending') throw Object.assign(new Error(`battle is already ${battle.status}`), { status: 409 });
    return battles.decline(battleId);
  }

  async function cancelChallenge(actorId, battleId) {
    assertId(actorId, 'actorId');
    assertId(battleId, 'battleId');
    const battle = await battles.findById(battleId);
    if (!battle) throw notFound('battle not found');
    if (battle.hostId !== actorId) throw forbidden('only the host can cancel a pending challenge');
    if (battle.status !== 'pending') throw Object.assign(new Error(`battle is already ${battle.status}`), { status: 409 });
    return battles.cancel(battleId);
  }

  // Either side may end an active battle early (e.g. the host closes the
  // room, or both sides agree to stop) -- the winner is still computed
  // honestly from whatever real score exists at that moment, never reset
  // or guessed.
  async function endBattle(actorId, battleId) {
    assertId(actorId, 'actorId');
    assertId(battleId, 'battleId');
    const battle = await battles.findById(battleId);
    if (!battle) throw notFound('battle not found');
    if (battle.hostId !== actorId && battle.opponentId !== actorId) {
      throw forbidden('only a participant of this battle can end it');
    }
    if (battle.status !== 'active') {
      if (battle.status === 'ended') return battle; // idempotent
      throw Object.assign(new Error(`battle is ${battle.status}, not active`), { status: 409 });
    }
    return battles.end(battleId);
  }

  async function getBattle(actorId, battleId) {
    assertId(actorId, 'actorId');
    assertId(battleId, 'battleId');
    const battle = await battles.findById(battleId);
    if (!battle) throw notFound('battle not found');
    if (battle.hostId !== actorId && battle.opponentId !== actorId) {
      throw forbidden('only a participant of this battle can view it');
    }
    return _withAutoEnd(battle);
  }

  async function listMine(actorId) {
    assertId(actorId, 'actorId');
    const mine = await battles.listByAccount(actorId);
    const withAutoEnd = [];
    for (const battle of mine) {
      withAutoEnd.push(await _withAutoEnd(battle));
    }
    return withAutoEnd;
  }

  // See file header. Called only from services/gifts.service.js, after a
  // real gift + wallet debit already committed. Never throws for "no
  // battle here" -- a gift sent in a room with no active battle is a
  // completely normal gift, not an error.
  async function recordGiftPoints({ roomId, receiverId, amount }) {
    if (typeof roomId !== 'string' || !roomId.trim()) return null;
    if (typeof receiverId !== 'string' || !receiverId.trim()) return null;
    if (!Number.isInteger(amount) || amount <= 0) return null;

    const open = await battles.findOpenByRoom(roomId);
    if (!open || open.status !== 'active') return null;
    const settled = await _withAutoEnd(open);
    if (!settled || settled.status !== 'active') return null; // expired the instant this gift landed

    let side = null;
    if (receiverId === settled.hostId) side = 'host';
    else if (receiverId === settled.opponentId) side = 'opponent';
    if (!side) return null; // the gift went to someone not in this battle

    return battles.addScore(settled.id, side, amount);
  }

  return {
    createChallenge,
    acceptChallenge,
    declineChallenge,
    cancelChallenge,
    endBattle,
    getBattle,
    listMine,
    recordGiftPoints,
  };
}

module.exports = { createBattleService };
