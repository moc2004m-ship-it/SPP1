'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryChatRepository } = require('../src/database/repositories/chat.repository');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');
const { createPlatform, FeatureStore } = require('../src/feature-platform');
const { createChatBus } = require('../src/realtime/chat-bus');
const { createChatService } = require('../src/services/chat.service');

// Same "real platform, real store" precedent as referral.service.test.js
// -- block/friend/privacy are exercised through the actual
// feature-platform.js code, never a stubbed-out fake, so this proves the
// real integration rather than a rewritten mirror of it.
function fakeNotificationService() {
  const calls = [];
  return {
    calls,
    async notify(args) {
      calls.push(args);
      return { notification: { id: 'ntf_fake' } };
    },
  };
}

function setup(now = () => new Date('2026-01-01T00:00:00.000Z')) {
  const chat = new InMemoryChatRepository();
  const platform = createPlatform({ store: new FeatureStore(new InMemoryFeatureRecordRepository()) });
  const notificationService = fakeNotificationService();
  const bus = createChatBus();
  const service = createChatService({ chat, platform, notificationService, bus, now });
  return { chat, platform, notificationService, bus, service };
}

// ---------------------------------------------------------------------
// getOrCreateConversation -- self-chat, block, whoCanMessage
// ---------------------------------------------------------------------

test('getOrCreateConversation rejects self-chat (400)', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.getOrCreateConversation('usr_a', 'usr_a'),
    (e) => e.status === 400
  );
});

test('getOrCreateConversation succeeds between two accounts with default privacy (whoCanMessage: everyone)', async () => {
  const { service } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  assert.deepEqual(conversation.participantIds, ['usr_a', 'usr_b']);
});

test('getOrCreateConversation is blocked (403) when the RECIPIENT has blocked the sender', async () => {
  const { service, platform } = setup();
  await platform.social.block('usr_b', 'usr_a');
  await assert.rejects(
    () => service.getOrCreateConversation('usr_a', 'usr_b'),
    (e) => e.status === 403
  );
});

test('getOrCreateConversation is blocked (403) when the SENDER has blocked the recipient (block enforced both directions)', async () => {
  const { service, platform } = setup();
  await platform.social.block('usr_a', 'usr_b');
  await assert.rejects(
    () => service.getOrCreateConversation('usr_a', 'usr_b'),
    (e) => e.status === 403
  );
});

test('getOrCreateConversation is rejected (403) when the recipient\'s privacy is whoCanMessage: nobody', async () => {
  const { service, platform } = setup();
  await platform.profile.updatePrivacy('usr_b', { whoCanMessage: 'nobody' });
  await assert.rejects(
    () => service.getOrCreateConversation('usr_a', 'usr_b'),
    (e) => e.status === 403
  );
});

test('getOrCreateConversation with whoCanMessage: friends succeeds when a real accepted friend relation exists', async () => {
  const { service, platform } = setup();
  await platform.profile.updatePrivacy('usr_b', { whoCanMessage: 'friends' });
  const request = await platform.social.friend('usr_a', 'usr_b');
  await platform.social.accept('usr_b', request.id);
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  assert.deepEqual(conversation.participantIds, ['usr_a', 'usr_b']);
});

test('getOrCreateConversation with whoCanMessage: friends rejects (403) when there is no accepted friend relation', async () => {
  const { service, platform } = setup();
  await platform.profile.updatePrivacy('usr_b', { whoCanMessage: 'friends' });
  await assert.rejects(
    () => service.getOrCreateConversation('usr_a', 'usr_b'),
    (e) => e.status === 403
  );
});

test('getOrCreateConversation with whoCanMessage: friends rejects (403) while the friend request is still pending (not yet accepted)', async () => {
  const { service, platform } = setup();
  await platform.profile.updatePrivacy('usr_b', { whoCanMessage: 'friends' });
  await platform.social.friend('usr_a', 'usr_b');
  await assert.rejects(
    () => service.getOrCreateConversation('usr_a', 'usr_b'),
    (e) => e.status === 403
  );
});

test('getOrCreateConversation is idempotent through the service too (same conversation regardless of call order)', async () => {
  const { service } = setup();
  const first = await service.getOrCreateConversation('usr_a', 'usr_b');
  const second = await service.getOrCreateConversation('usr_b', 'usr_a');
  assert.equal(first.id, second.id);
});

// ---------------------------------------------------------------------
// sendMessage -- membership, re-checked block, validation, reply, status
// ---------------------------------------------------------------------

test('sendMessage rejects a non-participant (403)', async () => {
  const { service } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  await assert.rejects(
    () => service.sendMessage({ actingAccountId: 'usr_intruder', conversationId: conversation.id, type: 'text', body: 'hi' }),
    (e) => e.status === 403
  );
});

test('sendMessage rejects a nonexistent conversationId (404)', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.sendMessage({ actingAccountId: 'usr_a', conversationId: 'conv_nope', type: 'text', body: 'hi' }),
    (e) => e.status === 404
  );
});

test('sendMessage re-checks the block on every send -- a block applied AFTER the conversation was opened still blocks sending (403)', async () => {
  const { service, platform } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  await platform.social.block('usr_b', 'usr_a'); // block applied after the conversation already exists
  await assert.rejects(
    () => service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: 'hi' }),
    (e) => e.status === 403
  );
});

test('sendMessage validates the payload through chat.model.js -- an invalid text body (empty) is rejected (400) and never reaches the repository', async () => {
  const { service, chat } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  await assert.rejects(
    () => service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: '' }),
    (e) => e.status === 400
  );
  assert.deepEqual(await chat.listMessages(conversation.id), []);
});

test('sendMessage rejects an unknown message type (400)', async () => {
  const { service } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  await assert.rejects(
    () => service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'video', body: 'x' }),
    (e) => e.status === 400
  );
});

test('sendMessage succeeds for all four message types', async () => {
  const { service } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  const text = await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: 'hi' });
  assert.equal(text.type, 'text');
  const emoji = await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'emoji', body: '🔥' });
  assert.equal(emoji.type, 'emoji');
  const sticker = await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'sticker', stickerId: 'sticker_like' });
  assert.equal(sticker.stickerId, 'sticker_like');
  const image = await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'image', imageUrl: 'https://cdn.example.com/x.png' });
  assert.equal(image.imageUrl, 'https://cdn.example.com/x.png');
});

test('sendMessage with a valid replyToMessageId links the reply', async () => {
  const { service } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  const original = await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: 'hi' });
  const reply = await service.sendMessage({ actingAccountId: 'usr_b', conversationId: conversation.id, type: 'text', body: 'hello back', replyToMessageId: original.id });
  assert.equal(reply.replyToMessageId, original.id);
});

test('sendMessage rejects a replyToMessageId that belongs to a DIFFERENT conversation (400)', async () => {
  const { service } = setup();
  const convAB = await service.getOrCreateConversation('usr_a', 'usr_b');
  const convAC = await service.getOrCreateConversation('usr_a', 'usr_c');
  const messageInAC = await service.sendMessage({ actingAccountId: 'usr_a', conversationId: convAC.id, type: 'text', body: 'hi c' });
  await assert.rejects(
    () => service.sendMessage({ actingAccountId: 'usr_a', conversationId: convAB.id, type: 'text', body: 'hi b', replyToMessageId: messageInAC.id }),
    (e) => e.status === 400
  );
});

test('sendMessage rejects a replyToMessageId that does not exist (400)', async () => {
  const { service } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  await assert.rejects(
    () => service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: 'hi', replyToMessageId: 'msg_nope' }),
    (e) => e.status === 400
  );
});

test('sendMessage status is "delivered" when the recipient is REALLY online (real heartbeat-derived presence)', async () => {
  let clock = new Date('2026-01-01T00:00:00.000Z');
  const { service, chat } = setup(() => clock);
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  await chat.heartbeat('usr_b', clock);

  const message = await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: 'hi' });
  assert.equal(message.status, 'delivered');
});

test('sendMessage status is "sent" when the recipient is offline/never seen', async () => {
  const { service } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  const message = await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: 'hi' });
  assert.equal(message.status, 'sent');
});

test('sendMessage status is "sent" (not delivered) once the recipient\'s heartbeat has aged past the online window', async () => {
  let clock = new Date('2026-01-01T00:00:00.000Z');
  const { service, chat } = setup(() => clock);
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  await chat.heartbeat('usr_b', clock);
  clock = new Date(clock.getTime() + 5 * 60 * 1000); // 5 minutes later, past the 60s default window

  const message = await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: 'hi' });
  assert.equal(message.status, 'sent');
});

test('sendMessage publishes to the chat bus and notifies the recipient with PRIVATE_MESSAGE', async () => {
  const { service, bus, notificationService } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');

  const events = [];
  bus.subscribe(conversation.id, (event) => events.push(event));

  const message = await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: 'hi' });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'message');
  assert.equal(events[0].message.id, message.id);

  assert.equal(notificationService.calls.length, 1);
  assert.deepEqual(notificationService.calls[0], {
    recipientId: 'usr_b',
    type: 'PRIVATE_MESSAGE',
    payload: { conversationId: conversation.id },
  });
});

// Stage 35 Part 3/8 -- Mute. sendMessage() suppresses the PRIVATE_MESSAGE
// notification (and only the notification -- the message itself is still
// sent/stored/published, see feature-platform.js's muteUser() header for
// why mute deliberately never behaves like block) when the recipient has
// muted the sender.
test('sendMessage does NOT notify the recipient when the recipient has muted the sender, but the message is still sent and published', async () => {
  const { service, platform, bus, notificationService } = setup();
  await platform.social.muteUser('usr_b', 'usr_a'); // usr_b (recipient) mutes usr_a (sender)
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');

  const events = [];
  bus.subscribe(conversation.id, (event) => events.push(event));

  const message = await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: 'hi' });

  assert.equal(message.body, 'hi');
  assert.equal(events.length, 1); // still published to the bus
  assert.equal(notificationService.calls.length, 0); // but not notified
});

test('sendMessage notifies normally when the recipient has muted someone else (mute is directional/pair-specific)', async () => {
  const { service, platform, notificationService } = setup();
  await platform.social.muteUser('usr_b', 'usr_c'); // usr_b mutes an unrelated third account
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: 'hi' });
  assert.equal(notificationService.calls.length, 1);
  assert.equal(notificationService.calls[0].type, 'PRIVATE_MESSAGE');
});

test('sendMessage notifies normally once the recipient unmutes the sender', async () => {
  const { service, platform, notificationService } = setup();
  await platform.social.muteUser('usr_b', 'usr_a');
  await platform.social.unmuteUser('usr_b', 'usr_a');
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: 'hi' });
  assert.equal(notificationService.calls.length, 1);
});

test('mute never blocks messaging the way block does -- a muted (not blocked) sender can still open a conversation and send', async () => {
  const { service, platform } = setup();
  await platform.social.muteUser('usr_b', 'usr_a');
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  const message = await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: 'still works' });
  assert.equal(message.body, 'still works');
});

test('omitting bus/notificationService leaves sendMessage behavior unchanged (no crash, same return shape)', async () => {
  const chat = new InMemoryChatRepository();
  const platform = createPlatform({ store: new FeatureStore(new InMemoryFeatureRecordRepository()) });
  const service = createChatService({ chat, platform }); // no bus, no notificationService
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  const message = await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: 'hi' });
  assert.equal(message.type, 'text');
});

// ---------------------------------------------------------------------
// listConversations / listMessages
// ---------------------------------------------------------------------

test('listMessages rejects a non-participant (403)', async () => {
  const { service } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  await assert.rejects(
    () => service.listMessages({ actingAccountId: 'usr_intruder', conversationId: conversation.id }),
    (e) => e.status === 403
  );
});

test('listConversations is isolated per account', async () => {
  const { service } = setup();
  await service.getOrCreateConversation('usr_a', 'usr_b');
  const listForC = await service.listConversations({ actingAccountId: 'usr_c' });
  assert.deepEqual(listForC, []);
});

// ---------------------------------------------------------------------
// markConversationRead
// ---------------------------------------------------------------------

test('markConversationRead rejects a non-participant (403)', async () => {
  const { service } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  await assert.rejects(
    () => service.markConversationRead({ actingAccountId: 'usr_intruder', conversationId: conversation.id }),
    (e) => e.status === 403
  );
});

test('markConversationRead marks the real unread count and publishes a read event on the bus only when something actually transitioned', async () => {
  const { service, bus } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  await service.sendMessage({ actingAccountId: 'usr_b', conversationId: conversation.id, type: 'text', body: 'hi' });

  const events = [];
  bus.subscribe(conversation.id, (event) => events.push(event));

  const result = await service.markConversationRead({ actingAccountId: 'usr_a', conversationId: conversation.id });
  assert.equal(result.markedRead, 1);
  assert.equal(events.filter((e) => e.type === 'read').length, 1);

  const second = await service.markConversationRead({ actingAccountId: 'usr_a', conversationId: conversation.id });
  assert.equal(second.markedRead, 0);
  assert.equal(events.filter((e) => e.type === 'read').length, 1, 'no second read event when nothing new was marked');
});

// ---------------------------------------------------------------------
// deleteMessage -- sender-only
// ---------------------------------------------------------------------

test('deleteMessage succeeds for the sender', async () => {
  const { service } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  const message = await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: 'hi' });
  const deleted = await service.deleteMessage({ actingAccountId: 'usr_a', messageId: message.id });
  assert.equal(deleted.deleted, true);
});

test('deleteMessage rejects anyone other than the sender (403), including the other participant', async () => {
  const { service } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  const message = await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: 'hi' });
  await assert.rejects(
    () => service.deleteMessage({ actingAccountId: 'usr_b', messageId: message.id }),
    (e) => e.status === 403
  );
});

test('deleteMessage rejects a nonexistent messageId (404)', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.deleteMessage({ actingAccountId: 'usr_a', messageId: 'msg_nope' }),
    (e) => e.status === 404
  );
});

// ---------------------------------------------------------------------
// reportMessage -- rejects self-report
// ---------------------------------------------------------------------

test('reportMessage succeeds when reporting someone else\'s message', async () => {
  const { service } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  const message = await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: 'hi' });
  const reported = await service.reportMessage({ actingAccountId: 'usr_b', messageId: message.id, reason: 'spam' });
  assert.equal(reported.reports.length, 1);
});

test('reportMessage rejects reporting your own message (403)', async () => {
  const { service } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  const message = await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: 'hi' });
  await assert.rejects(
    () => service.reportMessage({ actingAccountId: 'usr_a', messageId: message.id, reason: 'spam' }),
    (e) => e.status === 403
  );
});

test('reportMessage rejects a nonexistent messageId (404)', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.reportMessage({ actingAccountId: 'usr_a', messageId: 'msg_nope' }),
    (e) => e.status === 404
  );
});

// ---------------------------------------------------------------------
// heartbeat / goOffline / getPresence -- showLastSeen privacy
// ---------------------------------------------------------------------

test('heartbeat then getPresence (own account) reports online with a real lastSeenAt', async () => {
  const { service } = setup();
  await service.heartbeat({ actingAccountId: 'usr_a' });
  const presence = await service.getPresence({ actingAccountId: 'usr_a', targetUserId: 'usr_a' });
  assert.equal(presence.status, 'online');
  assert.ok(presence.lastSeenAt);
});

test('goOffline then getPresence reports offline', async () => {
  const { service } = setup();
  await service.heartbeat({ actingAccountId: 'usr_a' });
  await service.goOffline({ actingAccountId: 'usr_a' });
  const presence = await service.getPresence({ actingAccountId: 'usr_a', targetUserId: 'usr_a' });
  assert.equal(presence.status, 'offline');
});

test('getPresence hides lastSeenAt from a non-owner viewer when showLastSeen is false, but the online/offline status itself still shows', async () => {
  const { service, platform } = setup();
  await platform.profile.updatePrivacy('usr_b', { showLastSeen: false });
  await service.heartbeat({ actingAccountId: 'usr_b' });

  const viewedByOther = await service.getPresence({ actingAccountId: 'usr_a', targetUserId: 'usr_b' });
  assert.equal(viewedByOther.status, 'online', 'status itself must still be visible');
  assert.equal(viewedByOther.lastSeenAt, null, 'lastSeenAt must be hidden');
});

test('getPresence never hides lastSeenAt from the OWNER themself, even with showLastSeen: false', async () => {
  const { service, platform } = setup();
  await platform.profile.updatePrivacy('usr_b', { showLastSeen: false });
  await service.heartbeat({ actingAccountId: 'usr_b' });

  const viewedByOwner = await service.getPresence({ actingAccountId: 'usr_b', targetUserId: 'usr_b' });
  assert.ok(viewedByOwner.lastSeenAt, 'the owner must always see their own real lastSeenAt');
});

test('getPresence shows lastSeenAt to another viewer when showLastSeen is true (default)', async () => {
  const { service } = setup();
  await service.heartbeat({ actingAccountId: 'usr_b' });
  const viewedByOther = await service.getPresence({ actingAccountId: 'usr_a', targetUserId: 'usr_b' });
  assert.ok(viewedByOther.lastSeenAt);
});

// ---------------------------------------------------------------------
// isolation across conversations/users
// ---------------------------------------------------------------------

test('messages in one conversation never leak into another conversation between different users', async () => {
  const { service } = setup();
  const convAB = await service.getOrCreateConversation('usr_a', 'usr_b');
  const convCD = await service.getOrCreateConversation('usr_c', 'usr_d');
  await service.sendMessage({ actingAccountId: 'usr_a', conversationId: convAB.id, type: 'text', body: 'hi b' });
  await service.sendMessage({ actingAccountId: 'usr_c', conversationId: convCD.id, type: 'text', body: 'hi d' });

  const messagesAB = await service.listMessages({ actingAccountId: 'usr_a', conversationId: convAB.id });
  const messagesCD = await service.listMessages({ actingAccountId: 'usr_c', conversationId: convCD.id });
  assert.equal(messagesAB.length, 1);
  assert.equal(messagesCD.length, 1);
  assert.notEqual(messagesAB[0].id, messagesCD[0].id);
});
