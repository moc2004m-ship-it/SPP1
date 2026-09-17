'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryFamilyRepository } = require('../src/database/repositories/family.repository');

// NOTE ON SCOPE: these tests exercise InMemoryFamilyRepository, which is
// the repository actually active in this sandbox (no DATABASE_URL/network
// -- see Backend/.env.example and Database/STAGE3_TODO.md).
// PostgresFamilyRepository implements the identical interface against real
// SQL (see src/database/repositories/family.repository.js and
// src/database/schema/017_create_families.sql) but has NOT been run
// against a live database from this environment.

test('createFamily creates the family and an active owner membership together', async () => {
  const families = new InMemoryFamilyRepository();
  const family = await families.createFamily('usr_owner', 'The Royals');
  assert.equal(family.ownerId, 'usr_owner');
  assert.equal(family.name, 'The Royals');
  assert.equal(family.level, 0);
  assert.equal(family.xp, 0);

  const membership = await families.findMembership(family.id, 'usr_owner');
  assert.equal(membership.role, 'owner');
  assert.equal(membership.status, 'active');
  assert.equal(membership.contribution, 0);
});

test('findFamilyById returns null for an unknown id', async () => {
  const families = new InMemoryFamilyRepository();
  assert.equal(await families.findFamilyById('fam_nope'), null);
});

test('listFamilies returns every created family', async () => {
  const families = new InMemoryFamilyRepository();
  await families.createFamily('usr_1', 'A');
  await families.createFamily('usr_2', 'B');
  const all = await families.listFamilies();
  assert.equal(all.length, 2);
});

test('findActiveMembershipByAccount finds the one active membership across all families', async () => {
  const families = new InMemoryFamilyRepository();
  const family = await families.createFamily('usr_owner', 'The Royals');
  const active = await families.findActiveMembershipByAccount('usr_owner');
  assert.equal(active.familyId, family.id);
});

test('findActiveMembershipByAccount returns null once the membership is no longer active', async () => {
  const families = new InMemoryFamilyRepository();
  const family = await families.createFamily('usr_owner', 'The Royals');
  const membership = await families.findMembership(family.id, 'usr_owner');
  await families.updateMembershipStatus(membership.id, 'left');
  assert.equal(await families.findActiveMembershipByAccount('usr_owner'), null);
});

test('listMembers defaults to active-only and excludes kicked/left/banned', async () => {
  const families = new InMemoryFamilyRepository();
  const family = await families.createFamily('usr_owner', 'The Royals');
  const m1 = await families.createMembership({ familyId: family.id, accountId: 'usr_a', role: 'member', status: 'active' });
  await families.createMembership({ familyId: family.id, accountId: 'usr_b', role: 'member', status: 'active' });
  await families.updateMembershipStatus(m1.id, 'kicked');

  const activeMembers = await families.listMembers(family.id, 'active');
  const accountIds = activeMembers.map((m) => m.accountId);
  assert.ok(accountIds.includes('usr_owner'));
  assert.ok(accountIds.includes('usr_b'));
  assert.ok(!accountIds.includes('usr_a'), 'kicked member must not appear in the active list');
});

test('listMembers(familyId, null) returns every membership regardless of status', async () => {
  const families = new InMemoryFamilyRepository();
  const family = await families.createFamily('usr_owner', 'The Royals');
  const m1 = await families.createMembership({ familyId: family.id, accountId: 'usr_a', role: 'member', status: 'active' });
  await families.updateMembershipStatus(m1.id, 'kicked');
  const all = await families.listMembers(family.id, null);
  assert.equal(all.length, 2);
});

test('reactivateMembership preserves the prior contribution total (real history, not erased)', async () => {
  const families = new InMemoryFamilyRepository();
  const family = await families.createFamily('usr_owner', 'The Royals');
  const membership = await families.createMembership({ familyId: family.id, accountId: 'usr_a', role: 'member', status: 'active' });
  await families.addContribution(family.id, membership.id, 500);
  await families.updateMembershipStatus(membership.id, 'left');

  const reactivated = await families.reactivateMembership(membership.id, { role: 'member', status: 'active' });
  assert.equal(reactivated.status, 'active');
  assert.equal(reactivated.contribution, 500, 'past contribution must survive a leave + rejoin');
});

test('addContribution atomically raises both the membership contribution and the family xp/level', async () => {
  const families = new InMemoryFamilyRepository();
  const family = await families.createFamily('usr_owner', 'The Royals');
  const membership = await families.findMembership(family.id, 'usr_owner');

  const { membership: m1, family: f1 } = await families.addContribution(family.id, membership.id, 1000);
  assert.equal(m1.contribution, 1000);
  assert.equal(f1.xp, 1000);
  assert.equal(f1.level, 1, 'xpRequiredForFamilyLevel(1) === 1000, so exactly 1000 xp reaches level 1');

  const { membership: m2, family: f2 } = await families.addContribution(family.id, membership.id, 3000);
  assert.equal(m2.contribution, 4000);
  assert.equal(f2.xp, 4000);
  assert.equal(f2.level, 2, 'xpRequiredForFamilyLevel(2) === 4000');
});

test('addContribution against an unknown family throws 404 and touches nothing', async () => {
  const families = new InMemoryFamilyRepository();
  const family = await families.createFamily('usr_owner', 'The Royals');
  const membership = await families.findMembership(family.id, 'usr_owner');
  await assert.rejects(
    () => families.addContribution('fam_nope', membership.id, 100),
    (e) => e.status === 404
  );
});

test('addContribution against an unknown membership throws 404', async () => {
  const families = new InMemoryFamilyRepository();
  const family = await families.createFamily('usr_owner', 'The Royals');
  await assert.rejects(
    () => families.addContribution(family.id, 'fmem_nope', 100),
    (e) => e.status === 404
  );
});

test('createInvite / findInviteById / findPendingInvite round-trip', async () => {
  const families = new InMemoryFamilyRepository();
  const family = await families.createFamily('usr_owner', 'The Royals');
  const invite = await families.createInvite({ familyId: family.id, inviterId: 'usr_owner', inviteeId: 'usr_new' });
  assert.equal(invite.status, 'pending');

  const found = await families.findInviteById(invite.id);
  assert.deepEqual(found, invite);

  const pending = await families.findPendingInvite(family.id, 'usr_new');
  assert.equal(pending.id, invite.id);
});

test('listPendingInvitesForAccount only returns pending invites addressed to that account', async () => {
  const families = new InMemoryFamilyRepository();
  const family = await families.createFamily('usr_owner', 'The Royals');
  const invite = await families.createInvite({ familyId: family.id, inviterId: 'usr_owner', inviteeId: 'usr_new' });
  await families.createInvite({ familyId: family.id, inviterId: 'usr_owner', inviteeId: 'usr_other' });
  await families.updateInviteStatus(invite.id, 'accepted');

  const forNew = await families.listPendingInvitesForAccount('usr_new');
  assert.equal(forNew.length, 0, 'accepted invite must not still count as pending');

  const forOther = await families.listPendingInvitesForAccount('usr_other');
  assert.equal(forOther.length, 1);
});

test('updateInviteStatus on an unknown invite throws 404', async () => {
  const families = new InMemoryFamilyRepository();
  await assert.rejects(() => families.updateInviteStatus('finv_nope', 'accepted'), (e) => e.status === 404);
});

test('updateMembershipRole and updateMembershipStatus on an unknown membership throw 404', async () => {
  const families = new InMemoryFamilyRepository();
  await assert.rejects(() => families.updateMembershipRole('fmem_nope', 'admin'), (e) => e.status === 404);
  await assert.rejects(() => families.updateMembershipStatus('fmem_nope', 'left'), (e) => e.status === 404);
});

test('updateFamilyOwner changes owner_id and throws 404 for an unknown family', async () => {
  const families = new InMemoryFamilyRepository();
  const family = await families.createFamily('usr_owner', 'The Royals');
  const updated = await families.updateFamilyOwner(family.id, 'usr_new_owner');
  assert.equal(updated.ownerId, 'usr_new_owner');
  await assert.rejects(() => families.updateFamilyOwner('fam_nope', 'usr_x'), (e) => e.status === 404);
});
