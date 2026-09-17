'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryFamilyRepository } = require('../src/database/repositories/family.repository');
const { InMemoryWalletRepository } = require('../src/database/repositories/wallet.repository');
const { createFamilyService } = require('../src/services/family.service');

function setup() {
  const families = new InMemoryFamilyRepository();
  const wallets = new InMemoryWalletRepository();
  const service = createFamilyService({ families, wallets });
  return { families, wallets, service };
}

// Stage 33 -- a fake notificationService that just records notify() calls,
// same injection technique used across the other Stage 33 integration
// tests (see notification.service.test.js's fakePushProvider()).
function fakeNotificationService() {
  const calls = [];
  return {
    calls,
    async notify(args) {
      calls.push(args);
      return { notification: { id: 'ntf_fake' }, push: { attempted: false, blocked: true, reason: 'fake' } };
    },
  };
}

function setupWithNotifications() {
  const families = new InMemoryFamilyRepository();
  const wallets = new InMemoryWalletRepository();
  const notificationService = fakeNotificationService();
  const service = createFamilyService({ families, wallets, notificationService });
  return { families, wallets, service, notificationService };
}

// ---------------------------------------------------------------------
// createFamily / one-active-family-per-account
// ---------------------------------------------------------------------

test('createFamily makes the caller the real owner', async () => {
  const { service } = setup();
  const family = await service.createFamily({ ownerId: 'usr_owner', name: 'The Royals' });
  assert.equal(family.ownerId, 'usr_owner');
});

test('createFamily rejects an invalid name', async () => {
  const { service } = setup();
  await assert.rejects(() => service.createFamily({ ownerId: 'usr_owner', name: '' }), (e) => e.status === 400);
  await assert.rejects(() => service.createFamily({ ownerId: 'usr_owner', name: 'x'.repeat(101) }), (e) => e.status === 400);
});

test('an account already in an active family cannot create a second one', async () => {
  const { service } = setup();
  await service.createFamily({ ownerId: 'usr_owner', name: 'First' });
  await assert.rejects(
    () => service.createFamily({ ownerId: 'usr_owner', name: 'Second' }),
    (e) => e.status === 409
  );
});

// ---------------------------------------------------------------------
// invite / accept / decline / revoke
// ---------------------------------------------------------------------

test('an admin/owner can invite; a plain member cannot', async () => {
  const { service, families } = setup();
  const family = await service.createFamily({ ownerId: 'usr_owner', name: 'F' });
  const invite = await service.inviteMember({ actingAccountId: 'usr_owner', familyId: family.id, inviteeId: 'usr_a' });
  assert.equal(invite.status, 'pending');

  await service.acceptInvite({ actingAccountId: 'usr_a', inviteId: invite.id });
  await assert.rejects(
    () => service.inviteMember({ actingAccountId: 'usr_a', familyId: family.id, inviteeId: 'usr_b' }),
    (e) => e.status === 403
  );
});

test('cannot invite someone already actively in the family', async () => {
  const { service } = setup();
  const family = await service.createFamily({ ownerId: 'usr_owner', name: 'F' });
  await assert.rejects(
    () => service.inviteMember({ actingAccountId: 'usr_owner', familyId: family.id, inviteeId: 'usr_owner' }),
    (e) => e.status === 400
  );
});

test('cannot send a second pending invite to the same account for the same family', async () => {
  const { service } = setup();
  const family = await service.createFamily({ ownerId: 'usr_owner', name: 'F' });
  await service.inviteMember({ actingAccountId: 'usr_owner', familyId: family.id, inviteeId: 'usr_a' });
  await assert.rejects(
    () => service.inviteMember({ actingAccountId: 'usr_owner', familyId: family.id, inviteeId: 'usr_a' }),
    (e) => e.status === 409
  );
});

test('acceptInvite rejects if the invite is not addressed to the caller', async () => {
  const { service } = setup();
  const family = await service.createFamily({ ownerId: 'usr_owner', name: 'F' });
  const invite = await service.inviteMember({ actingAccountId: 'usr_owner', familyId: family.id, inviteeId: 'usr_a' });
  await assert.rejects(
    () => service.acceptInvite({ actingAccountId: 'usr_wrong', inviteId: invite.id }),
    (e) => e.status === 403
  );
});

test('acceptInvite rejects if the invitee is already in a different active family', async () => {
  const { service } = setup();
  const familyA = await service.createFamily({ ownerId: 'usr_owner_a', name: 'A' });
  await service.createFamily({ ownerId: 'usr_b', name: 'B' }); // usr_b already owns B
  const invite = await service.inviteMember({ actingAccountId: 'usr_owner_a', familyId: familyA.id, inviteeId: 'usr_b' });
  await assert.rejects(
    () => service.acceptInvite({ actingAccountId: 'usr_b', inviteId: invite.id }),
    (e) => e.status === 409
  );
});

test('declining an invite leaves it declined and unusable for accept', async () => {
  const { service } = setup();
  const family = await service.createFamily({ ownerId: 'usr_owner', name: 'F' });
  const invite = await service.inviteMember({ actingAccountId: 'usr_owner', familyId: family.id, inviteeId: 'usr_a' });
  const declined = await service.declineInvite({ actingAccountId: 'usr_a', inviteId: invite.id });
  assert.equal(declined.status, 'declined');
  await assert.rejects(() => service.acceptInvite({ actingAccountId: 'usr_a', inviteId: invite.id }), (e) => e.status === 409);
});

test('the inviter can revoke their own pending invite', async () => {
  const { service } = setup();
  const family = await service.createFamily({ ownerId: 'usr_owner', name: 'F' });
  const invite = await service.inviteMember({ actingAccountId: 'usr_owner', familyId: family.id, inviteeId: 'usr_a' });
  const revoked = await service.revokeInvite({ actingAccountId: 'usr_owner', inviteId: invite.id });
  assert.equal(revoked.status, 'revoked');
});

test('a random unrelated account cannot revoke someone else\'s invite', async () => {
  const { service } = setup();
  const family = await service.createFamily({ ownerId: 'usr_owner', name: 'F' });
  const invite = await service.inviteMember({ actingAccountId: 'usr_owner', familyId: family.id, inviteeId: 'usr_a' });
  await assert.rejects(
    () => service.revokeInvite({ actingAccountId: 'usr_random', inviteId: invite.id }),
    (e) => e.status === 403
  );
});

test('listMyInvites only returns the caller\'s own pending invites', async () => {
  const { service } = setup();
  const family = await service.createFamily({ ownerId: 'usr_owner', name: 'F' });
  await service.inviteMember({ actingAccountId: 'usr_owner', familyId: family.id, inviteeId: 'usr_a' });
  const mine = await service.listMyInvites('usr_a');
  assert.equal(mine.length, 1);
  const none = await service.listMyInvites('usr_b');
  assert.equal(none.length, 0);
});

// ---------------------------------------------------------------------
// leave / owner cannot leave directly
// ---------------------------------------------------------------------

test('a plain member can leave freely', async () => {
  const { service } = setup();
  const family = await service.createFamily({ ownerId: 'usr_owner', name: 'F' });
  const invite = await service.inviteMember({ actingAccountId: 'usr_owner', familyId: family.id, inviteeId: 'usr_a' });
  await service.acceptInvite({ actingAccountId: 'usr_a', inviteId: invite.id });
  const left = await service.leaveFamily({ actingAccountId: 'usr_a', familyId: family.id });
  assert.equal(left.status, 'left');
});

test('the owner cannot leave directly', async () => {
  const { service } = setup();
  const family = await service.createFamily({ ownerId: 'usr_owner', name: 'F' });
  await assert.rejects(
    () => service.leaveFamily({ actingAccountId: 'usr_owner', familyId: family.id }),
    (e) => e.status === 403
  );
});

// ---------------------------------------------------------------------
// rank enforcement: kick / ban
// ---------------------------------------------------------------------

async function buildFamilyWithMembers(service) {
  const family = await service.createFamily({ ownerId: 'usr_owner', name: 'F' });
  const inviteAdmin = await service.inviteMember({ actingAccountId: 'usr_owner', familyId: family.id, inviteeId: 'usr_admin' });
  await service.acceptInvite({ actingAccountId: 'usr_admin', inviteId: inviteAdmin.id });
  await service.promoteMember({ actingAccountId: 'usr_owner', familyId: family.id, targetAccountId: 'usr_admin' });

  const inviteMember1 = await service.inviteMember({ actingAccountId: 'usr_owner', familyId: family.id, inviteeId: 'usr_member' });
  await service.acceptInvite({ actingAccountId: 'usr_member', inviteId: inviteMember1.id });

  const inviteAdmin2 = await service.inviteMember({ actingAccountId: 'usr_owner', familyId: family.id, inviteeId: 'usr_admin2' });
  await service.acceptInvite({ actingAccountId: 'usr_admin2', inviteId: inviteAdmin2.id });
  await service.promoteMember({ actingAccountId: 'usr_owner', familyId: family.id, targetAccountId: 'usr_admin2' });

  return family;
}

test('a member cannot kick or ban anyone (nothing outranks it)', async () => {
  const { service } = setup();
  const family = await buildFamilyWithMembers(service);
  await assert.rejects(
    () => service.kickMember({ actingAccountId: 'usr_member', familyId: family.id, targetAccountId: 'usr_admin' }),
    (e) => e.status === 403
  );
  await assert.rejects(
    () => service.banMember({ actingAccountId: 'usr_member', familyId: family.id, targetAccountId: 'usr_admin' }),
    (e) => e.status === 403
  );
});

test('an admin can kick a plain member', async () => {
  const { service } = setup();
  const family = await buildFamilyWithMembers(service);
  const kicked = await service.kickMember({ actingAccountId: 'usr_admin', familyId: family.id, targetAccountId: 'usr_member' });
  assert.equal(kicked.status, 'kicked');
});

test('an admin cannot kick or ban another admin', async () => {
  const { service } = setup();
  const family = await buildFamilyWithMembers(service);
  await assert.rejects(
    () => service.kickMember({ actingAccountId: 'usr_admin', familyId: family.id, targetAccountId: 'usr_admin2' }),
    (e) => e.status === 403
  );
  await assert.rejects(
    () => service.banMember({ actingAccountId: 'usr_admin', familyId: family.id, targetAccountId: 'usr_admin2' }),
    (e) => e.status === 403
  );
});

test('an admin cannot kick or ban the owner', async () => {
  const { service } = setup();
  const family = await buildFamilyWithMembers(service);
  await assert.rejects(
    () => service.kickMember({ actingAccountId: 'usr_admin', familyId: family.id, targetAccountId: 'usr_owner' }),
    (e) => e.status === 403
  );
});

test('the owner can kick/ban an admin', async () => {
  const { service } = setup();
  const family = await buildFamilyWithMembers(service);
  const banned = await service.banMember({ actingAccountId: 'usr_owner', familyId: family.id, targetAccountId: 'usr_admin' });
  assert.equal(banned.status, 'banned');
});

test('cannot kick/ban yourself', async () => {
  const { service } = setup();
  const family = await service.createFamily({ ownerId: 'usr_owner', name: 'F' });
  await assert.rejects(
    () => service.kickMember({ actingAccountId: 'usr_owner', familyId: family.id, targetAccountId: 'usr_owner' }),
    (e) => e.status === 400
  );
  await assert.rejects(
    () => service.banMember({ actingAccountId: 'usr_owner', familyId: family.id, targetAccountId: 'usr_owner' }),
    (e) => e.status === 400
  );
});

// ---------------------------------------------------------------------
// ban blocks re-invite until unban
// ---------------------------------------------------------------------

test('a banned account cannot be invited again until unbanned', async () => {
  const { service } = setup();
  const family = await buildFamilyWithMembers(service);
  await service.banMember({ actingAccountId: 'usr_owner', familyId: family.id, targetAccountId: 'usr_member' });

  await assert.rejects(
    () => service.inviteMember({ actingAccountId: 'usr_owner', familyId: family.id, inviteeId: 'usr_member' }),
    (e) => e.status === 403
  );

  await service.unbanMember({ actingAccountId: 'usr_owner', familyId: family.id, targetAccountId: 'usr_member' });
  const invite = await service.inviteMember({ actingAccountId: 'usr_owner', familyId: family.id, inviteeId: 'usr_member' });
  assert.equal(invite.status, 'pending');
});

test('unbanMember requires admin/owner rank', async () => {
  const { service } = setup();
  const family = await buildFamilyWithMembers(service);
  await service.banMember({ actingAccountId: 'usr_owner', familyId: family.id, targetAccountId: 'usr_member' });
  // usr_member itself is now banned/inactive and cannot act at all
  await assert.rejects(
    () => service.unbanMember({ actingAccountId: 'usr_member', familyId: family.id, targetAccountId: 'usr_member' }),
    (e) => e.status === 403
  );
});

// ---------------------------------------------------------------------
// promote / demote / transferOwnership -- owner-only
// ---------------------------------------------------------------------

test('only the owner can promote a member to admin', async () => {
  const { service } = setup();
  const family = await buildFamilyWithMembers(service);
  await assert.rejects(
    () => service.promoteMember({ actingAccountId: 'usr_admin', familyId: family.id, targetAccountId: 'usr_member' }),
    (e) => e.status === 403
  );
  const promoted = await service.promoteMember({ actingAccountId: 'usr_owner', familyId: family.id, targetAccountId: 'usr_member' });
  assert.equal(promoted.role, 'admin');
});

test('only the owner can demote an admin to member', async () => {
  const { service } = setup();
  const family = await buildFamilyWithMembers(service);
  await assert.rejects(
    () => service.demoteMember({ actingAccountId: 'usr_admin2', familyId: family.id, targetAccountId: 'usr_admin' }),
    (e) => e.status === 403
  );
  const demoted = await service.demoteMember({ actingAccountId: 'usr_owner', familyId: family.id, targetAccountId: 'usr_admin' });
  assert.equal(demoted.role, 'member');
});

test('transferOwnership changes both family.ownerId and the membership roles, with no duplicate source of truth', async () => {
  const { service, families } = setup();
  const family = await buildFamilyWithMembers(service);
  const result = await service.transferOwnership({ actingAccountId: 'usr_owner', familyId: family.id, targetAccountId: 'usr_admin' });

  assert.equal(result.family.ownerId, 'usr_admin');
  assert.equal(result.newOwnerMembership.role, 'owner');
  assert.equal(result.previousOwnerMembership.role, 'admin');

  const refreshedFamily = await families.findFamilyById(family.id);
  assert.equal(refreshedFamily.ownerId, 'usr_admin');
  const newOwnerMembership = await families.findMembership(family.id, 'usr_admin');
  assert.equal(newOwnerMembership.role, 'owner', 'family.ownerId and the owner-role membership must always agree');

  // The old owner, now an admin, can leave (no longer blocked by the
  // owner-cannot-leave rule) -- and the new owner cannot leave directly.
  await service.leaveFamily({ actingAccountId: 'usr_owner', familyId: family.id });
  await assert.rejects(
    () => service.leaveFamily({ actingAccountId: 'usr_admin', familyId: family.id }),
    (e) => e.status === 403
  );
});

test('only the owner can transfer ownership', async () => {
  const { service } = setup();
  const family = await buildFamilyWithMembers(service);
  await assert.rejects(
    () => service.transferOwnership({ actingAccountId: 'usr_admin', familyId: family.id, targetAccountId: 'usr_admin2' }),
    (e) => e.status === 403
  );
});

// ---------------------------------------------------------------------
// donate -- real wallet debit before any contribution/xp
// ---------------------------------------------------------------------

test('donate debits the real wallet at the real catalog price before recording any contribution', async () => {
  const { service, wallets } = setup();
  const family = await service.createFamily({ ownerId: 'usr_owner', name: 'F' });
  await wallets.credit('usr_owner', 'coins', 1000, 'seed-00001');

  const result = await service.donate({ actingAccountId: 'usr_owner', familyId: family.id, tierId: 'medium' });
  assert.equal(result.coins, 500);
  assert.ok(result.walletTransactionId);
  assert.match(result.walletTransactionId, /^wtx_/);
  assert.equal(result.membership.contribution, 500);
  assert.equal(result.family.xp, 500);

  const balance = await wallets.getBalance('usr_owner');
  assert.equal(balance.coins, 500);
});

test('donate rejects an unknown tierId and touches nothing', async () => {
  const { service, wallets } = setup();
  const family = await service.createFamily({ ownerId: 'usr_owner', name: 'F' });
  await wallets.credit('usr_owner', 'coins', 1000, 'seed-00001');
  await assert.rejects(
    () => service.donate({ actingAccountId: 'usr_owner', familyId: family.id, tierId: 'huge' }),
    (e) => e.status === 400
  );
  const balance = await wallets.getBalance('usr_owner');
  assert.equal(balance.coins, 1000, 'balance must be untouched by a rejected donate');
});

test('donate with insufficient balance fails the debit and records no contribution', async () => {
  const { service, wallets, families } = setup();
  const family = await service.createFamily({ ownerId: 'usr_owner', name: 'F' });
  await wallets.credit('usr_owner', 'coins', 10, 'seed-00001'); // not enough for even the 'small' tier (100)

  await assert.rejects(
    () => service.donate({ actingAccountId: 'usr_owner', familyId: family.id, tierId: 'small' }),
    (e) => e.status === 409
  );

  const membership = await families.findMembership(family.id, 'usr_owner');
  assert.equal(membership.contribution, 0, 'no contribution must be recorded when the debit failed');
  const refreshedFamily = await families.findFamilyById(family.id);
  assert.equal(refreshedFamily.xp, 0);
});

test('donate returns the real, currently-earned title/badges for the new contribution total', async () => {
  const { service, wallets } = setup();
  const family = await service.createFamily({ ownerId: 'usr_owner', name: 'F' });
  await wallets.credit('usr_owner', 'coins', 10000, 'seed-00001');
  await service.donate({ actingAccountId: 'usr_owner', familyId: family.id, tierId: 'large' }); // 2000
  const result = await service.donate({ actingAccountId: 'usr_owner', familyId: family.id, tierId: 'large' }); // total 4000
  assert.equal(result.membership.contribution, 4000);
  assert.equal(result.title, 'contributor'); // >= 1000
  assert.ok(result.badges.includes('first_1000'));
});

test('a non-member cannot donate to a family', async () => {
  const { service, wallets } = setup();
  const family = await service.createFamily({ ownerId: 'usr_owner', name: 'F' });
  await wallets.credit('usr_outsider', 'coins', 1000, 'seed-00001');
  await assert.rejects(
    () => service.donate({ actingAccountId: 'usr_outsider', familyId: family.id, tierId: 'small' }),
    (e) => e.status === 403
  );
});

// ---------------------------------------------------------------------
// listMembers / listFamilies visibility
// ---------------------------------------------------------------------

test('listMembers requires the caller to be an active member', async () => {
  const { service } = setup();
  const family = await service.createFamily({ ownerId: 'usr_owner', name: 'F' });
  await assert.rejects(
    () => service.listMembers({ actingAccountId: 'usr_outsider', familyId: family.id }),
    (e) => e.status === 403
  );
  const members = await service.listMembers({ actingAccountId: 'usr_owner', familyId: family.id });
  assert.equal(members.length, 1);
});

test('listFamilies is a public browse of every family (directory)', async () => {
  const { service } = setup();
  await service.createFamily({ ownerId: 'usr_1', name: 'A' });
  await service.createFamily({ ownerId: 'usr_2', name: 'B' });
  const all = await service.listFamilies();
  assert.equal(all.length, 2);
});

test('actions against an unknown family throw 404', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.inviteMember({ actingAccountId: 'usr_owner', familyId: 'fam_nope', inviteeId: 'usr_a' }),
    (e) => e.status === 404
  );
  await assert.rejects(
    () => service.donate({ actingAccountId: 'usr_owner', familyId: 'fam_nope', tierId: 'small' }),
    (e) => e.status === 404
  );
});

// ---------------------------------------------------------------------
// Stage 33 -- notificationService integration (optional dependency)
// ---------------------------------------------------------------------

test('inviteMember notifies the invitee with FAMILY_INVITE when notificationService is provided', async () => {
  const { service, notificationService } = setupWithNotifications();
  const family = await service.createFamily({ ownerId: 'usr_owner', name: 'The Royals' });
  const invite = await service.inviteMember({ actingAccountId: 'usr_owner', familyId: family.id, inviteeId: 'usr_a' });

  assert.equal(notificationService.calls.length, 1);
  assert.deepEqual(notificationService.calls[0], {
    recipientId: 'usr_a',
    type: 'FAMILY_INVITE',
    payload: { inviteId: invite.id },
  });
});

test('acceptInvite notifies the original inviter with FAMILY_INVITE_ACCEPTED when notificationService is provided', async () => {
  const { service, notificationService } = setupWithNotifications();
  const family = await service.createFamily({ ownerId: 'usr_owner', name: 'The Royals' });
  const invite = await service.inviteMember({ actingAccountId: 'usr_owner', familyId: family.id, inviteeId: 'usr_a' });
  notificationService.calls.length = 0; // isolate acceptInvite's own notify() call

  await service.acceptInvite({ actingAccountId: 'usr_a', inviteId: invite.id });

  assert.equal(notificationService.calls.length, 1);
  assert.deepEqual(notificationService.calls[0], {
    recipientId: 'usr_owner',
    type: 'FAMILY_INVITE_ACCEPTED',
    payload: { familyId: family.id },
  });
});

test('omitting notificationService leaves inviteMember/acceptInvite behavior unchanged (no crash, same return shape)', async () => {
  const { service } = setup(); // no notificationService at all
  const family = await service.createFamily({ ownerId: 'usr_owner', name: 'The Royals' });
  const invite = await service.inviteMember({ actingAccountId: 'usr_owner', familyId: family.id, inviteeId: 'usr_a' });
  const membership = await service.acceptInvite({ actingAccountId: 'usr_a', inviteId: invite.id });
  assert.equal(membership.status, 'active');
});
