// Stage 30 — Family service.
//
// The ONLY code path allowed to change family/membership/invite state.
// ../database/repositories/family.repository.js is a plain data-integrity
// layer with no opinion on who may do what — every authorization/business
// rule below lives here, same split as platform.guards.js vs the generic
// platform.store, or store.service.js vs wallet/inventory repositories.
//
// Rules enforced here (see STAGES_1_35_CONTINUATION_STATE.md's Stage 30
// design notes for the reasoning):
//   1. Rank enforcement: owner > admin > member (../database/models/
//      family.model.js's roleRank()). Acting member must have STRICTLY
//      higher rank than the target to kick/ban them -- a member can never
//      kick/ban anyone (nothing outranks it), an admin can kick/ban a
//      member but not another admin or the owner, only the owner
//      outranks admins.
//   2. One active family per account, enforced at both createFamily()
//      (the new owner) and acceptInvite() (the invitee).
//   3. A 'banned' membership blocks new invites to the same family until
//      unbanMember() flips it back.
//   4. donate() ALWAYS starts with a real wallet debit (real coins, real
//      server-side catalog price from ../domain/family-donations.js) --
//      exactly the same "debit before grant" discipline as
//      store.service.js and gifts.service.js. No wallet debit, no
//      contribution/xp increase.
//   5. The owner cannot leave() directly -- transferOwnership() first, so
//      a family can never end up with zero owner.
//   6. Only the owner may promote/demote/transferOwnership (these change
//      the admin tier itself, not just moderate a member at a lower
//      rank).

const { assertValidFamilyName, roleRank, generateDonationId } = require('../database/models/family.model');
const { resolveFamilyDonationTier } = require('../domain/family-donations');
const { titleForContribution, badgesForContribution } = require('../domain/family-titles');

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
// same additive pattern as event.service.js/couple.service.js above. When
// provided, a real completed invite/accept reports a real notification
// AFTER the real state transition has already committed. When omitted,
// behavior is byte-for-byte identical to before this stage.
function createFamilyService({ families, wallets, notificationService }) {
  async function requireFamily(familyId) {
    const family = await families.findFamilyById(familyId);
    if (!family) throw notFound('family not found');
    return family;
  }

  // The acting account's own membership row for this family. Must exist
  // and be 'active' -- a left/kicked/banned membership grants no rights.
  async function requireActiveMembership(familyId, accountId) {
    const membership = await families.findMembership(familyId, accountId);
    if (!membership || membership.status !== 'active') {
      throw forbidden('you are not an active member of this family');
    }
    return membership;
  }

  // Rank check shared by kick/ban: acting must outrank target STRICTLY.
  // (Also implicitly blocks acting on the owner, since nothing outranks
  // 'owner', and blocks a member from acting on anyone, since 'member'
  // is the lowest rank.)
  function assertOutranks(actingMembership, targetMembership, action) {
    if (roleRank(actingMembership.role) <= roleRank(targetMembership.role)) {
      throw forbidden(`you do not have permission to ${action} a member of equal or higher rank`);
    }
  }

  async function createFamily({ ownerId, name }) {
    assertValidFamilyName(name);
    const existingActive = await families.findActiveMembershipByAccount(ownerId);
    if (existingActive) {
      throw conflict('you are already in an active family; leave it (or transfer ownership) before creating another');
    }
    return families.createFamily(ownerId, name.trim());
  }

  async function listFamilies() {
    return families.listFamilies();
  }

  async function listMembers({ actingAccountId, familyId }) {
    await requireFamily(familyId);
    await requireActiveMembership(familyId, actingAccountId); // member list exposes contribution -- members only
    return families.listMembers(familyId, 'active');
  }

  async function listMyInvites(accountId) {
    return families.listPendingInvitesForAccount(accountId);
  }

  async function inviteMember({ actingAccountId, familyId, inviteeId }) {
    if (typeof inviteeId !== 'string' || !inviteeId) throw badRequest('inviteeId is required');
    if (inviteeId === actingAccountId) throw badRequest('you cannot invite yourself');
    await requireFamily(familyId);
    const actingMembership = await requireActiveMembership(familyId, actingAccountId);
    if (roleRank(actingMembership.role) < roleRank('admin')) {
      throw forbidden('only an admin or the owner may invite new members');
    }

    const existingTargetMembership = await families.findMembership(familyId, inviteeId);
    if (existingTargetMembership) {
      if (existingTargetMembership.status === 'active') throw conflict('this account is already a member of this family');
      if (existingTargetMembership.status === 'banned') {
        throw forbidden('this account is banned from this family; unban before inviting again');
      }
    }

    const existingPending = await families.findPendingInvite(familyId, inviteeId);
    if (existingPending) throw conflict('there is already a pending invite for this account to this family');

    const invite = await families.createInvite({ familyId, inviterId: actingAccountId, inviteeId });
    if (notificationService) {
      await notificationService.notify({
        recipientId: inviteeId,
        type: 'FAMILY_INVITE',
        payload: { inviteId: invite.id },
      });
    }
    return invite;
  }

  async function requirePendingInviteForAccount(inviteId, accountId) {
    const invite = await families.findInviteById(inviteId);
    if (!invite) throw notFound('invite not found');
    if (invite.inviteeId !== accountId) throw forbidden('this invite is not addressed to you');
    if (invite.status !== 'pending') throw conflict('this invite is no longer pending');
    return invite;
  }

  async function acceptInvite({ actingAccountId, inviteId }) {
    const invite = await requirePendingInviteForAccount(inviteId, actingAccountId);

    const existingActive = await families.findActiveMembershipByAccount(actingAccountId);
    if (existingActive) throw conflict('you are already in an active family; leave it before accepting another invite');

    const existingMembership = await families.findMembership(invite.familyId, actingAccountId);
    let membership;
    if (existingMembership) {
      if (existingMembership.status === 'banned') {
        throw forbidden('you are banned from this family');
      }
      membership = await families.reactivateMembership(existingMembership.id, { role: 'member', status: 'active' });
    } else {
      membership = await families.createMembership({
        familyId: invite.familyId,
        accountId: actingAccountId,
        role: 'member',
        status: 'active',
      });
    }

    await families.updateInviteStatus(inviteId, 'accepted');
    if (notificationService) {
      await notificationService.notify({
        recipientId: invite.inviterId,
        type: 'FAMILY_INVITE_ACCEPTED',
        payload: { familyId: invite.familyId },
      });
    }
    return membership;
  }

  async function declineInvite({ actingAccountId, inviteId }) {
    const invite = await requirePendingInviteForAccount(inviteId, actingAccountId);
    return families.updateInviteStatus(invite.id, 'declined');
  }

  async function revokeInvite({ actingAccountId, inviteId }) {
    const invite = await families.findInviteById(inviteId);
    if (!invite) throw notFound('invite not found');
    if (invite.status !== 'pending') throw conflict('this invite is no longer pending');

    if (invite.inviterId !== actingAccountId) {
      // Not the original inviter -- still allowed if acting is an
      // admin/owner of the family the invite belongs to.
      const actingMembership = await families.findMembership(invite.familyId, actingAccountId);
      if (!actingMembership || actingMembership.status !== 'active' || roleRank(actingMembership.role) < roleRank('admin')) {
        throw forbidden('only the inviter, or an admin/owner of this family, may revoke this invite');
      }
    }
    return families.updateInviteStatus(invite.id, 'revoked');
  }

  async function leaveFamily({ actingAccountId, familyId }) {
    const membership = await requireActiveMembership(familyId, actingAccountId);
    if (membership.role === 'owner') {
      throw forbidden('the owner cannot leave directly; transfer ownership to another member first');
    }
    return families.updateMembershipStatus(membership.id, 'left');
  }

  async function kickMember({ actingAccountId, familyId, targetAccountId }) {
    if (targetAccountId === actingAccountId) throw badRequest('use leave instead of kicking yourself');
    await requireFamily(familyId);
    const actingMembership = await requireActiveMembership(familyId, actingAccountId);
    const targetMembership = await families.findMembership(familyId, targetAccountId);
    if (!targetMembership || targetMembership.status !== 'active') throw notFound('active member not found');
    assertOutranks(actingMembership, targetMembership, 'kick');
    return families.updateMembershipStatus(targetMembership.id, 'kicked');
  }

  async function banMember({ actingAccountId, familyId, targetAccountId }) {
    if (targetAccountId === actingAccountId) throw badRequest('you cannot ban yourself');
    await requireFamily(familyId);
    const actingMembership = await requireActiveMembership(familyId, actingAccountId);
    const targetMembership = await families.findMembership(familyId, targetAccountId);
    if (!targetMembership) throw notFound('member not found');
    if (targetMembership.status === 'banned') throw conflict('this member is already banned');
    assertOutranks(actingMembership, targetMembership, 'ban');
    return families.updateMembershipStatus(targetMembership.id, 'banned');
  }

  async function unbanMember({ actingAccountId, familyId, targetAccountId }) {
    await requireFamily(familyId);
    const actingMembership = await requireActiveMembership(familyId, actingAccountId);
    if (roleRank(actingMembership.role) < roleRank('admin')) {
      throw forbidden('only an admin or the owner may unban a member');
    }
    const targetMembership = await families.findMembership(familyId, targetAccountId);
    if (!targetMembership || targetMembership.status !== 'banned') throw notFound('banned member not found');
    // Flips back to 'left', not 'active' -- unbanning only lifts the
    // block on future invites, it does not silently readmit them.
    return families.updateMembershipStatus(targetMembership.id, 'left');
  }

  // promote/demote/transferOwnership all change the admin tier itself
  // (not just moderate a lower-ranked member), so all three are
  // owner-only regardless of the acting account's own rank otherwise.
  async function requireOwnerMembership(familyId, actingAccountId) {
    const actingMembership = await requireActiveMembership(familyId, actingAccountId);
    if (actingMembership.role !== 'owner') throw forbidden('only the family owner may perform this action');
    return actingMembership;
  }

  async function promoteMember({ actingAccountId, familyId, targetAccountId }) {
    await requireFamily(familyId);
    await requireOwnerMembership(familyId, actingAccountId);
    const targetMembership = await families.findMembership(familyId, targetAccountId);
    if (!targetMembership || targetMembership.status !== 'active') throw notFound('active member not found');
    if (targetMembership.role !== 'member') throw conflict('only a member may be promoted to admin');
    return families.updateMembershipRole(targetMembership.id, 'admin');
  }

  async function demoteMember({ actingAccountId, familyId, targetAccountId }) {
    await requireFamily(familyId);
    await requireOwnerMembership(familyId, actingAccountId);
    const targetMembership = await families.findMembership(familyId, targetAccountId);
    if (!targetMembership || targetMembership.status !== 'active') throw notFound('active member not found');
    if (targetMembership.role !== 'admin') throw conflict('only an admin may be demoted to member');
    return families.updateMembershipRole(targetMembership.id, 'member');
  }

  async function transferOwnership({ actingAccountId, familyId, targetAccountId }) {
    if (targetAccountId === actingAccountId) throw badRequest('you already own this family');
    await requireFamily(familyId);
    const actingMembership = await requireOwnerMembership(familyId, actingAccountId);
    const targetMembership = await families.findMembership(familyId, targetAccountId);
    if (!targetMembership || targetMembership.status !== 'active') throw notFound('active member not found');

    // family.owner_id and the membership row with role='owner' must
    // never disagree (no duplicate source of truth) -- update both.
    const updatedFamily = await families.updateFamilyOwner(familyId, targetAccountId);
    const newOwnerMembership = await families.updateMembershipRole(targetMembership.id, 'owner');
    const previousOwnerMembership = await families.updateMembershipRole(actingMembership.id, 'admin');
    return { family: updatedFamily, newOwnerMembership, previousOwnerMembership };
  }

  async function donate({ actingAccountId, familyId, tierId }) {
    await requireFamily(familyId);
    const membership = await requireActiveMembership(familyId, actingAccountId);
    const tier = resolveFamilyDonationTier(tierId); // throws 400 on unknown tierId -- never trusts a client-supplied amount

    const donationId = generateDonationId();

    // Real wallet debit BEFORE any contribution/xp is recorded -- same
    // discipline as store.service.js's purchase(). If this rejects
    // (insufficient balance), addContribution() below is never reached.
    const walletTransaction = await wallets.debit(actingAccountId, 'coins', tier.coins, donationId);

    const { membership: updatedMembership, family: updatedFamily } = await families.addContribution(
      familyId,
      membership.id,
      tier.coins
    );

    return {
      donationId,
      tierId: tier.id,
      coins: tier.coins,
      walletTransactionId: walletTransaction.id,
      membership: updatedMembership,
      family: updatedFamily,
      title: titleForContribution(updatedMembership.contribution),
      badges: badgesForContribution(updatedMembership.contribution),
    };
  }

  return {
    createFamily,
    listFamilies,
    listMembers,
    listMyInvites,
    inviteMember,
    acceptInvite,
    declineInvite,
    revokeInvite,
    leaveFamily,
    kickMember,
    banMember,
    unbanMember,
    promoteMember,
    demoteMember,
    transferOwnership,
    donate,
  };
}

module.exports = { createFamilyService };
