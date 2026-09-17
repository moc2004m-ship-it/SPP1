'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryCoupleRepository } = require('../src/database/repositories/couple.repository');
const { createCoupleService } = require('../src/services/couple.service');

function setup() {
  const couples = new InMemoryCoupleRepository();
  const service = createCoupleService({ couples });
  return { couples, service };
}

// Stage 33 -- a fake notificationService that just records notify() calls,
// same injection technique as notification.service.test.js's
// fakePushProvider(). Never touches the real notification.service.js/
// notification.repository.js -- this only proves couple.service.js calls
// notify() with the right recipient/type/payload at the right time.
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
  const couples = new InMemoryCoupleRepository();
  const notificationService = fakeNotificationService();
  const service = createCoupleService({ couples, notificationService });
  return { couples, service, notificationService };
}

// ---------------------------------------------------------------------
// sendInvite
// ---------------------------------------------------------------------

test('sendInvite creates a pending invite', async () => {
  const { service } = setup();
  const invite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });
  assert.equal(invite.status, 'pending');
  assert.equal(invite.inviterId, 'usr_a');
  assert.equal(invite.inviteeId, 'usr_b');
});

test('sendInvite requires an inviteeId', async () => {
  const { service } = setup();
  await assert.rejects(() => service.sendInvite({ actingAccountId: 'usr_a', inviteeId: '' }), (e) => e.status === 400);
  await assert.rejects(() => service.sendInvite({ actingAccountId: 'usr_a', inviteeId: undefined }), (e) => e.status === 400);
});

test('sendInvite rejects self-pairing', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_a' }),
    (e) => e.status === 400
  );
});

test('sendInvite rejects when the acting account already has an active couple', async () => {
  const { service } = setup();
  const invite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });
  await service.acceptInvite({ actingAccountId: 'usr_b', inviteId: invite.id });

  await assert.rejects(
    () => service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_c' }),
    (e) => e.status === 409
  );
});

test('sendInvite rejects a duplicate pending invite between the same two accounts, either direction', async () => {
  const { service } = setup();
  await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });
  await assert.rejects(
    () => service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' }),
    (e) => e.status === 409
  );
  await assert.rejects(
    () => service.sendInvite({ actingAccountId: 'usr_b', inviteeId: 'usr_a' }),
    (e) => e.status === 409
  );
});

// ---------------------------------------------------------------------
// acceptInvite
// ---------------------------------------------------------------------

test('acceptInvite creates a real active couple with cpValue/level at 0', async () => {
  const { service } = setup();
  const invite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });
  const couple = await service.acceptInvite({ actingAccountId: 'usr_b', inviteId: invite.id });
  assert.equal(couple.status, 'active');
  assert.equal(couple.cpValue, 0);
  assert.equal(couple.level, 0);
  assert.ok(couple.accountA === 'usr_a' || couple.accountA === 'usr_b');
});

test('acceptInvite marks the invite accepted', async () => {
  const { service, couples } = setup();
  const invite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });
  await service.acceptInvite({ actingAccountId: 'usr_b', inviteId: invite.id });
  const stored = await couples.findInviteById(invite.id);
  assert.equal(stored.status, 'accepted');
});

test('only the invitee may accept an invite', async () => {
  const { service } = setup();
  const invite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });
  await assert.rejects(
    () => service.acceptInvite({ actingAccountId: 'usr_outsider', inviteId: invite.id }),
    (e) => e.status === 403
  );
  // the original inviter also cannot accept their own invite
  await assert.rejects(
    () => service.acceptInvite({ actingAccountId: 'usr_a', inviteId: invite.id }),
    (e) => e.status === 403
  );
});

test('acceptInvite rejects an unknown invite', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.acceptInvite({ actingAccountId: 'usr_b', inviteId: 'cinv_nope' }),
    (e) => e.status === 404
  );
});

test('acceptInvite rejects a non-pending invite', async () => {
  const { service } = setup();
  const invite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });
  await service.declineInvite({ actingAccountId: 'usr_b', inviteId: invite.id });
  await assert.rejects(
    () => service.acceptInvite({ actingAccountId: 'usr_b', inviteId: invite.id }),
    (e) => e.status === 409
  );
});

test('acceptInvite rejects when the invitee already has an active couple (re-checked at accept time)', async () => {
  const { service } = setup();
  const invite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });
  // usr_b pairs with someone else while the above invite is still pending
  const otherInvite = await service.sendInvite({ actingAccountId: 'usr_b', inviteeId: 'usr_c' });
  await service.acceptInvite({ actingAccountId: 'usr_c', inviteId: otherInvite.id });

  await assert.rejects(
    () => service.acceptInvite({ actingAccountId: 'usr_b', inviteId: invite.id }),
    (e) => e.status === 409
  );
});

test('acceptInvite rejects when the inviter already has an active couple (re-checked at accept time)', async () => {
  const { service } = setup();
  const invite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });
  // usr_a pairs with someone else while the above invite is still pending
  const otherInvite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_d' });
  await service.acceptInvite({ actingAccountId: 'usr_d', inviteId: otherInvite.id });

  await assert.rejects(
    () => service.acceptInvite({ actingAccountId: 'usr_b', inviteId: invite.id }),
    (e) => e.status === 409
  );
});

// ---------------------------------------------------------------------
// declineInvite / cancelInvite
// ---------------------------------------------------------------------

test('declineInvite lets only the invitee decline', async () => {
  const { service } = setup();
  const invite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });
  await assert.rejects(
    () => service.declineInvite({ actingAccountId: 'usr_a', inviteId: invite.id }),
    (e) => e.status === 403
  );
  const declined = await service.declineInvite({ actingAccountId: 'usr_b', inviteId: invite.id });
  assert.equal(declined.status, 'declined');
});

test('cancelInvite lets only the original inviter cancel', async () => {
  const { service } = setup();
  const invite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });
  await assert.rejects(
    () => service.cancelInvite({ actingAccountId: 'usr_b', inviteId: invite.id }),
    (e) => e.status === 403
  );
  const cancelled = await service.cancelInvite({ actingAccountId: 'usr_a', inviteId: invite.id });
  assert.equal(cancelled.status, 'cancelled');
});

test('cancelInvite rejects an unknown or non-pending invite', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.cancelInvite({ actingAccountId: 'usr_a', inviteId: 'cinv_nope' }),
    (e) => e.status === 404
  );
  const invite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });
  await service.cancelInvite({ actingAccountId: 'usr_a', inviteId: invite.id });
  await assert.rejects(
    () => service.cancelInvite({ actingAccountId: 'usr_a', inviteId: invite.id }),
    (e) => e.status === 409
  );
});

test('listMyInvites returns only pending invites addressed to the caller', async () => {
  const { service } = setup();
  await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_target' });
  await service.sendInvite({ actingAccountId: 'usr_c', inviteeId: 'usr_other' });
  const mine = await service.listMyInvites('usr_target');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].inviteeId, 'usr_target');
});

// ---------------------------------------------------------------------
// unpair
// ---------------------------------------------------------------------

test('unpair lets either partner end the relationship (no owner lock, unlike Family)', async () => {
  const { service } = setup();
  const invite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });
  const couple = await service.acceptInvite({ actingAccountId: 'usr_b', inviteId: invite.id });

  // the invitee (not the original inviter) can end it directly
  const ended = await service.unpair({ actingAccountId: 'usr_b', coupleId: couple.id });
  assert.equal(ended.status, 'ended');
});

test('unpair rejects an account that is not a member of the couple', async () => {
  const { service } = setup();
  const invite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });
  const couple = await service.acceptInvite({ actingAccountId: 'usr_b', inviteId: invite.id });
  await assert.rejects(
    () => service.unpair({ actingAccountId: 'usr_outsider', coupleId: couple.id }),
    (e) => e.status === 403
  );
});

test('unpair rejects an already-ended couple', async () => {
  const { service } = setup();
  const invite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });
  const couple = await service.acceptInvite({ actingAccountId: 'usr_b', inviteId: invite.id });
  await service.unpair({ actingAccountId: 'usr_a', coupleId: couple.id });
  await assert.rejects(
    () => service.unpair({ actingAccountId: 'usr_a', coupleId: couple.id }),
    (e) => e.status === 409
  );
});

test('unpair rejects an unknown couple', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.unpair({ actingAccountId: 'usr_a', coupleId: 'cpl_nope' }),
    (e) => e.status === 404
  );
});

test('after unpair, both accounts are free to form a new couple', async () => {
  const { service } = setup();
  const invite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });
  const couple = await service.acceptInvite({ actingAccountId: 'usr_b', inviteId: invite.id });
  await service.unpair({ actingAccountId: 'usr_a', coupleId: couple.id });

  const newInvite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_c' });
  const newCouple = await service.acceptInvite({ actingAccountId: 'usr_c', inviteId: newInvite.id });
  assert.equal(newCouple.status, 'active');
});

// ---------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------

test('getStatus returns null when the account has no active couple', async () => {
  const { service } = setup();
  assert.equal(await service.getStatus('usr_lonely'), null);
});

test('getStatus returns the active couple for either partner', async () => {
  const { service } = setup();
  const invite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });
  const couple = await service.acceptInvite({ actingAccountId: 'usr_b', inviteId: invite.id });
  const statusA = await service.getStatus('usr_a');
  const statusB = await service.getStatus('usr_b');
  assert.equal(statusA.id, couple.id);
  assert.equal(statusB.id, couple.id);
});

// ---------------------------------------------------------------------
// recordGift -- the gifts.service.js integration point
// ---------------------------------------------------------------------

test('recordGift is a real no-op when the two accounts are not an active couple', async () => {
  const { service, couples } = setup();
  const result = await service.recordGift({ senderId: 'usr_a', receiverId: 'usr_b', amount: 500 });
  assert.equal(result, null);
  assert.equal(await couples.findActiveCoupleByAccount('usr_a'), null);
});

test('recordGift increases real cp when the two accounts are an active couple', async () => {
  const { service, couples } = setup();
  const invite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });
  const couple = await service.acceptInvite({ actingAccountId: 'usr_b', inviteId: invite.id });

  const updated = await service.recordGift({ senderId: 'usr_a', receiverId: 'usr_b', amount: 500 });
  assert.equal(updated.cpValue, 500);
  assert.equal(updated.level, 1);

  const stored = await couples.findCoupleById(couple.id);
  assert.equal(stored.cpValue, 500);
});

test('recordGift accumulates cp across multiple gifts, either direction', async () => {
  const { service } = setup();
  const invite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });
  await service.acceptInvite({ actingAccountId: 'usr_b', inviteId: invite.id });

  await service.recordGift({ senderId: 'usr_a', receiverId: 'usr_b', amount: 200 });
  const afterSecond = await service.recordGift({ senderId: 'usr_b', receiverId: 'usr_a', amount: 100 });
  assert.equal(afterSecond.cpValue, 300);
});

test('recordGift is a no-op for a gift to/from someone outside the active couple', async () => {
  const { service } = setup();
  const invite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });
  await service.acceptInvite({ actingAccountId: 'usr_b', inviteId: invite.id });

  const result = await service.recordGift({ senderId: 'usr_a', receiverId: 'usr_outsider', amount: 500 });
  assert.equal(result, null);
  const status = await service.getStatus('usr_a');
  assert.equal(status.cpValue, 0);
});

test('recordGift ignores a non-positive or non-integer amount without throwing', async () => {
  const { service } = setup();
  const invite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });
  await service.acceptInvite({ actingAccountId: 'usr_b', inviteId: invite.id });

  assert.equal(await service.recordGift({ senderId: 'usr_a', receiverId: 'usr_b', amount: 0 }), null);
  assert.equal(await service.recordGift({ senderId: 'usr_a', receiverId: 'usr_b', amount: -5 }), null);
  assert.equal(await service.recordGift({ senderId: 'usr_a', receiverId: 'usr_b', amount: 1.5 }), null);
  const status = await service.getStatus('usr_a');
  assert.equal(status.cpValue, 0);
});

// ---------------------------------------------------------------------
// Stage 33 -- notificationService integration (optional dependency)
// ---------------------------------------------------------------------

test('sendInvite notifies the invitee with COUPLE_INVITE when notificationService is provided', async () => {
  const { service, notificationService } = setupWithNotifications();
  const invite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });

  assert.equal(notificationService.calls.length, 1);
  assert.deepEqual(notificationService.calls[0], {
    recipientId: 'usr_b',
    type: 'COUPLE_INVITE',
    payload: { inviteId: invite.id },
  });
});

test('acceptInvite notifies the original inviter with COUPLE_INVITE_ACCEPTED when notificationService is provided', async () => {
  const { service, notificationService } = setupWithNotifications();
  const invite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });
  notificationService.calls.length = 0; // isolate acceptInvite's own notify() call

  const couple = await service.acceptInvite({ actingAccountId: 'usr_b', inviteId: invite.id });

  assert.equal(notificationService.calls.length, 1);
  assert.deepEqual(notificationService.calls[0], {
    recipientId: 'usr_a',
    type: 'COUPLE_INVITE_ACCEPTED',
    payload: { coupleId: couple.id },
  });
});

test('omitting notificationService leaves sendInvite/acceptInvite behavior unchanged (no crash, same return shape)', async () => {
  const { service } = setup(); // no notificationService at all
  const invite = await service.sendInvite({ actingAccountId: 'usr_a', inviteeId: 'usr_b' });
  const couple = await service.acceptInvite({ actingAccountId: 'usr_b', inviteId: invite.id });
  assert.equal(couple.status, 'active');
});
