'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryCoupleRepository } = require('../src/database/repositories/couple.repository');

// NOTE ON SCOPE: these tests exercise InMemoryCoupleRepository, which is
// the repository actually active in this sandbox (no DATABASE_URL/network
// -- see Backend/.env.example and Database/STAGE3_TODO.md).
// PostgresCoupleRepository implements the identical interface against real
// SQL (see src/database/repositories/couple.repository.js and
// src/database/schema/019_create_couples.sql) but has NOT been run
// against a live database from this environment.

test('createCouple creates an active couple with cpValue/level at 0', async () => {
  const couples = new InMemoryCoupleRepository();
  const couple = await couples.createCouple('usr_a', 'usr_b');
  assert.equal(couple.status, 'active');
  assert.equal(couple.cpValue, 0);
  assert.equal(couple.level, 0);
  assert.equal(couple.endedAt, null);
});

test('createCouple stores accounts in canonical (sorted) order regardless of call order', async () => {
  const couples = new InMemoryCoupleRepository();
  const c1 = await couples.createCouple('usr_z', 'usr_a');
  const c2 = await couples.createCouple('usr_c', 'usr_d');
  assert.equal(c1.accountA, 'usr_a');
  assert.equal(c1.accountB, 'usr_z');
  assert.equal(c2.accountA, 'usr_c');
  assert.equal(c2.accountB, 'usr_d');
});

test('findCoupleById returns null for an unknown id', async () => {
  const couples = new InMemoryCoupleRepository();
  assert.equal(await couples.findCoupleById('cpl_nope'), null);
});

test('findActiveCoupleByAccount finds the couple regardless of which side the account is on', async () => {
  const couples = new InMemoryCoupleRepository();
  const couple = await couples.createCouple('usr_a', 'usr_b');
  const foundA = await couples.findActiveCoupleByAccount('usr_a');
  const foundB = await couples.findActiveCoupleByAccount('usr_b');
  assert.equal(foundA.id, couple.id);
  assert.equal(foundB.id, couple.id);
});

test('findActiveCoupleByAccount returns null once the couple has ended', async () => {
  const couples = new InMemoryCoupleRepository();
  const couple = await couples.createCouple('usr_a', 'usr_b');
  await couples.endCouple(couple.id);
  assert.equal(await couples.findActiveCoupleByAccount('usr_a'), null);
});

test('findActiveCoupleByAccount returns null for an account never paired', async () => {
  const couples = new InMemoryCoupleRepository();
  assert.equal(await couples.findActiveCoupleByAccount('usr_lonely'), null);
});

test('addCp accumulates cpValue and recomputes level atomically together', async () => {
  const couples = new InMemoryCoupleRepository();
  const couple = await couples.createCouple('usr_a', 'usr_b');
  const afterFirst = await couples.addCp(couple.id, 300);
  assert.equal(afterFirst.cpValue, 300);
  assert.equal(afterFirst.level, 0); // level 1 requires 500

  const afterSecond = await couples.addCp(couple.id, 300);
  assert.equal(afterSecond.cpValue, 600);
  assert.equal(afterSecond.level, 1); // 600 >= 500
});

test('addCp on an unknown couple throws 404 and applies nothing', async () => {
  const couples = new InMemoryCoupleRepository();
  await assert.rejects(() => couples.addCp('cpl_nope', 100), (e) => e.status === 404);
});

test('endCouple flips status to ended and stamps endedAt', async () => {
  const couples = new InMemoryCoupleRepository();
  const couple = await couples.createCouple('usr_a', 'usr_b');
  const ended = await couples.endCouple(couple.id);
  assert.equal(ended.status, 'ended');
  assert.ok(ended.endedAt);
});

test('endCouple on an unknown couple throws 404', async () => {
  const couples = new InMemoryCoupleRepository();
  await assert.rejects(() => couples.endCouple('cpl_nope'), (e) => e.status === 404);
});

test('createInvite creates a pending invite', async () => {
  const couples = new InMemoryCoupleRepository();
  const invite = await couples.createInvite({ inviterId: 'usr_a', inviteeId: 'usr_b' });
  assert.equal(invite.status, 'pending');
  assert.equal(invite.inviterId, 'usr_a');
  assert.equal(invite.inviteeId, 'usr_b');
});

test('findInviteById returns null for an unknown id', async () => {
  const couples = new InMemoryCoupleRepository();
  assert.equal(await couples.findInviteById('cinv_nope'), null);
});

test('listPendingInvitesForAccount returns only pending invites addressed to that account', async () => {
  const couples = new InMemoryCoupleRepository();
  const i1 = await couples.createInvite({ inviterId: 'usr_a', inviteeId: 'usr_target' });
  await couples.createInvite({ inviterId: 'usr_c', inviteeId: 'usr_other' });
  const i3 = await couples.createInvite({ inviterId: 'usr_d', inviteeId: 'usr_target' });
  await couples.updateInviteStatus(i3.id, 'declined');

  const pending = await couples.listPendingInvitesForAccount('usr_target');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, i1.id);
});

test('findPendingInviteBetween finds a pending invite in either direction', async () => {
  const couples = new InMemoryCoupleRepository();
  const invite = await couples.createInvite({ inviterId: 'usr_a', inviteeId: 'usr_b' });
  const foundForward = await couples.findPendingInviteBetween('usr_a', 'usr_b');
  const foundReverse = await couples.findPendingInviteBetween('usr_b', 'usr_a');
  assert.equal(foundForward.id, invite.id);
  assert.equal(foundReverse.id, invite.id);
});

test('findPendingInviteBetween ignores a non-pending invite', async () => {
  const couples = new InMemoryCoupleRepository();
  const invite = await couples.createInvite({ inviterId: 'usr_a', inviteeId: 'usr_b' });
  await couples.updateInviteStatus(invite.id, 'declined');
  assert.equal(await couples.findPendingInviteBetween('usr_a', 'usr_b'), null);
});

test('updateInviteStatus updates the status and rejects an unknown invite', async () => {
  const couples = new InMemoryCoupleRepository();
  const invite = await couples.createInvite({ inviterId: 'usr_a', inviteeId: 'usr_b' });
  const updated = await couples.updateInviteStatus(invite.id, 'accepted');
  assert.equal(updated.status, 'accepted');
  await assert.rejects(() => couples.updateInviteStatus('cinv_nope', 'accepted'), (e) => e.status === 404);
});
