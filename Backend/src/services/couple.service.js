// Stage 32 — Couple/CP service.
//
// The ONLY code path allowed to change couple/invite state. Same split as
// family.service.js vs family.repository.js: ../database/repositories/
// couple.repository.js is a plain data-integrity layer with no opinion on
// who may do what -- every rule below lives here.
//
// A couple is symmetric between its two accounts -- unlike Family (which
// has a rank hierarchy: member < admin < owner), neither partner
// outranks the other. There is therefore no promote/demote/kick/ban
// here, only: invite, accept, decline, cancel, and unpair (either
// partner may end the relationship unilaterally, same as either party in
// a real relationship can choose to leave it -- no "owner" lock like
// family's leaveFamily()).
//
// Rules enforced here:
//   1. assertNotSelfPair (../database/models/couple.model.js) -- you
//      cannot invite or pair with yourself.
//   2. One active couple per account, enforced at sendInvite() (the
//      inviter) AND at respondInvite()'s accept path (both the invitee
//      AND the inviter, re-checked at accept time in case either side
//      paired with someone else while this invite was still pending --
//      same "re-check at accept" discipline as family.service.js's
//      acceptInvite()).
//   3. Only the invitee may accept/decline a pending invite. Only the
//      original inviter may cancel a pending invite.
//   4. cpValue only ever increases through a REAL, already-debited gift
//      between the two partners -- recordGift() (called optionally by
//      gifts.service.js, same additive dependency pattern as
//      eventService there) never trusts a client-supplied amount; it is
//      always handed the real coins already spent on an already-sent
//      gift. If the two accounts named are not an active couple,
//      recordGift() is a real no-op -- it never creates or infers a
//      relationship from a gift.

const { assertNotSelfPair } = require('../database/models/couple.model');

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}
function forbidden(message) {
  return Object.assign(new Error(message), { status: 403 });
}
function notFound(message) {
  return Object.assign(new Error(message), { status: 404 });
}
function conflict(message) {
  return Object.assign(new Error(message), { status: 409 });
}

// Stage 33 -- `notificationService` is an OPTIONAL constructor dependency,
// same additive pattern as everywhere else this stage touches (see
// gifts.service.js's Stage 33 comment). When provided, a real completed
// invite/accept reports a real notification via
// ../services/notification.service.js's notify(); when omitted, behavior
// is byte-for-byte identical to before this stage. notify() is always
// called AFTER the real state transition it reports has already
// succeeded/committed.
function createCoupleService({ couples, notificationService }) {
  async function assertNoActiveCouple(accountId, message) {
    const existing = await couples.findActiveCoupleByAccount(accountId);
    if (existing) throw conflict(message);
  }

  async function sendInvite({ actingAccountId, inviteeId }) {
    if (typeof inviteeId !== 'string' || !inviteeId) throw badRequest('inviteeId is required');
    assertNotSelfPair(actingAccountId, inviteeId);
    await assertNoActiveCouple(
      actingAccountId,
      'you are already in an active couple; unpair before sending another invite'
    );

    const existingPending = await couples.findPendingInviteBetween(actingAccountId, inviteeId);
    if (existingPending) throw conflict('there is already a pending invite between you and this account');

    const invite = await couples.createInvite({ inviterId: actingAccountId, inviteeId });
    if (notificationService) {
      await notificationService.notify({
        recipientId: inviteeId,
        type: 'COUPLE_INVITE',
        payload: { inviteId: invite.id },
      });
    }
    return invite;
  }

  async function requirePendingInviteForInvitee(inviteId, accountId) {
    const invite = await couples.findInviteById(inviteId);
    if (!invite) throw notFound('invite not found');
    if (invite.inviteeId !== accountId) throw forbidden('this invite is not addressed to you');
    if (invite.status !== 'pending') throw conflict('this invite is no longer pending');
    return invite;
  }

  async function acceptInvite({ actingAccountId, inviteId }) {
    const invite = await requirePendingInviteForInvitee(inviteId, actingAccountId);

    // Re-checked at accept time (not just at send time) -- either side
    // may have paired with someone else while this invite sat pending.
    await assertNoActiveCouple(
      actingAccountId,
      'you are already in an active couple; unpair before accepting another invite'
    );
    await assertNoActiveCouple(
      invite.inviterId,
      'the account that invited you is already in an active couple'
    );

    const couple = await couples.createCouple(invite.inviterId, actingAccountId);
    await couples.updateInviteStatus(invite.id, 'accepted');
    if (notificationService) {
      await notificationService.notify({
        recipientId: invite.inviterId,
        type: 'COUPLE_INVITE_ACCEPTED',
        payload: { coupleId: couple.id },
      });
    }
    return couple;
  }

  async function declineInvite({ actingAccountId, inviteId }) {
    const invite = await requirePendingInviteForInvitee(inviteId, actingAccountId);
    return couples.updateInviteStatus(invite.id, 'declined');
  }

  async function cancelInvite({ actingAccountId, inviteId }) {
    const invite = await couples.findInviteById(inviteId);
    if (!invite) throw notFound('invite not found');
    if (invite.status !== 'pending') throw conflict('this invite is no longer pending');
    if (invite.inviterId !== actingAccountId) throw forbidden('only the inviter may cancel this invite');
    return couples.updateInviteStatus(invite.id, 'cancelled');
  }

  async function listMyInvites(accountId) {
    return couples.listPendingInvitesForAccount(accountId);
  }

  async function requireActiveCoupleForMember(coupleId, accountId) {
    const couple = await couples.findCoupleById(coupleId);
    if (!couple) throw notFound('couple not found');
    if (couple.status !== 'active') throw conflict('this couple is no longer active');
    if (couple.accountA !== accountId && couple.accountB !== accountId) {
      throw forbidden('you are not a member of this couple');
    }
    return couple;
  }

  async function unpair({ actingAccountId, coupleId }) {
    await requireActiveCoupleForMember(coupleId, actingAccountId);
    return couples.endCouple(coupleId);
  }

  async function getStatus(accountId) {
    return couples.findActiveCoupleByAccount(accountId);
  }

  // Optional integration point for gifts.service.js (see that file's
  // Stage 32 comment) -- called ONLY after a gift has already been
  // debited and recorded for real. amount is always the real coins
  // already spent on the completed gift, 1:1 into cpValue, same
  // discipline as family.service.js's donate(). If senderId/receiverId
  // are not an active couple, this is a real no-op -- it never creates
  // or infers a relationship.
  async function recordGift({ senderId, receiverId, amount }) {
    if (!Number.isInteger(amount) || amount <= 0) return null;
    const couple = await couples.findActiveCoupleByAccount(senderId);
    if (!couple) return null;
    if (couple.accountA !== receiverId && couple.accountB !== receiverId) return null;
    return couples.addCp(couple.id, amount);
  }

  return {
    sendInvite,
    acceptInvite,
    declineInvite,
    cancelInvite,
    listMyInvites,
    unpair,
    getStatus,
    recordGift,
  };
}

module.exports = { createCoupleService };
