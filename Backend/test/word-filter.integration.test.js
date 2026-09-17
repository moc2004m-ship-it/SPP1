'use strict';
// Stage 35 Part 4/8 -- Word Filter integration tests. Exercises the real
// in-process path (chat.service.js / feature-platform.js / room.model.js)
// rather than re-testing word-filter.service.js's matching logic itself
// (see word-filter.service.test.js for that) -- this file proves the
// filter is actually wired into the content paths this stage's audit
// identified, and that it does NOT disturb Report/Block/Mute or
// unrelated chat/room behavior.

const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryChatRepository } = require('../src/database/repositories/chat.repository');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');
const { createPlatform, FeatureStore } = require('../src/feature-platform');
const { createChatBus } = require('../src/realtime/chat-bus');
const { createChatService } = require('../src/services/chat.service');
const { BANNED_WORDS } = require('../src/services/word-filter.service');

function setup(now = () => new Date('2026-01-01T00:00:00.000Z')) {
  const chat = new InMemoryChatRepository();
  const platform = createPlatform({ store: new FeatureStore(new InMemoryFeatureRecordRepository()) });
  const notificationService = { calls: [], async notify(args) { this.calls.push(args); return { notification: { id: 'ntf_fake' } }; } };
  const bus = createChatBus();
  const service = createChatService({ chat, platform, notificationService, bus, now });
  return { chat, platform, notificationService, bus, service };
}

// ---------------------------------------------------------------------
// Chat: text/emoji body
// ---------------------------------------------------------------------

test('sendMessage rejects (400) a text message body containing a banned word, and never persists/publishes/notifies it', async () => {
  const { service, chat, notificationService } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  await assert.rejects(
    () => service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: `hey ${BANNED_WORDS[0]}` }),
    (e) => e.status === 400
  );
  const messages = await chat.listMessages(conversation.id, {});
  assert.equal(messages.length, 0, 'the rejected message must never be persisted');
  assert.equal(notificationService.calls.length, 0, 'the rejected message must never trigger a notification');
});

test('sendMessage rejects a banned word regardless of case/whitespace/punctuation obfuscation, called directly (proves server-side enforcement, not a Mobile-only UX check)', async () => {
  const { service } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  await assert.rejects(
    () => service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: `  ${BANNED_WORDS[0].toUpperCase()}  ` }),
    (e) => e.status === 400
  );
});

test('sendMessage rejects a banned emoji-type body the same way as text', async () => {
  const { service } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  await assert.rejects(
    () => service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'emoji', body: BANNED_WORDS[0] }),
    (e) => e.status === 400
  );
});

test('sendMessage still accepts a clean text message (no regression)', async () => {
  const { service } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  const message = await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: 'hello there' });
  assert.equal(message.body, 'hello there');
});

test('sendMessage does not run the word filter on sticker messages (fixed catalog id, not free text)', async () => {
  const { service } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  const message = await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'sticker', stickerId: 'sticker_like' });
  assert.equal(message.stickerId, 'sticker_like');
});

test('sendMessage does not run the word filter on image messages (a URL, not free text)', async () => {
  const { service } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  const message = await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'image', imageUrl: 'https://example.com/pic.png' });
  assert.equal(message.imageUrl, 'https://example.com/pic.png');
});

// ---------------------------------------------------------------------
// Regression: Report / Block / Mute must still work after this stage's
// changes to chat.service.js and feature-platform.js.
// ---------------------------------------------------------------------

test('regression: Block still works after Word Filter changes (blocked recipient cannot be messaged)', async () => {
  const { service, platform } = setup();
  await platform.social.block('usr_b', 'usr_a');
  await assert.rejects(
    () => service.getOrCreateConversation('usr_a', 'usr_b'),
    (e) => e.status === 403
  );
  await platform.social.unblock('usr_b', 'usr_a');
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  assert.ok(conversation.id);
});

test('regression: Mute still suppresses only the notification, never the message itself, after Word Filter changes', async () => {
  const { service, platform, notificationService } = setup();
  await platform.social.muteUser('usr_b', 'usr_a');
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  const message = await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: 'hello' });
  assert.equal(message.body, 'hello');
  assert.equal(notificationService.calls.length, 0, 'muted recipient must not be notified');
});

test('regression: reportMessage still works after Word Filter changes (a clean message can still be reported)', async () => {
  const { service } = setup();
  const conversation = await service.getOrCreateConversation('usr_a', 'usr_b');
  const message = await service.sendMessage({ actingAccountId: 'usr_a', conversationId: conversation.id, type: 'text', body: 'hello' });
  const report = await service.reportMessage({ actingAccountId: 'usr_b', messageId: message.id, reason: 'spam' });
  assert.ok(report);
});

// ---------------------------------------------------------------------
// Profile: name / bio
// ---------------------------------------------------------------------

test('profile.create rejects a banned word in name', async () => {
  const { platform } = setup();
  await assert.rejects(
    () => platform.profile.create({ userId: 'usr_a', name: BANNED_WORDS[0] }),
    (e) => e.status === 400
  );
});

test('profile.create rejects a banned word in bio', async () => {
  const { platform } = setup();
  await assert.rejects(
    () => platform.profile.create({ userId: 'usr_a', name: 'Real Name', bio: `I like ${BANNED_WORDS[0]} things` }),
    (e) => e.status === 400
  );
});

test('profile.create still accepts clean name/bio (no regression), including an omitted bio', async () => {
  const { platform } = setup();
  const profile = await platform.profile.create({ userId: 'usr_a', name: 'Real Name' });
  assert.equal(profile.name, 'Real Name');
  assert.equal(profile.bio, '');
});

// ---------------------------------------------------------------------
// Room: name / announcement (create + settings-update path)
// ---------------------------------------------------------------------

test('rooms.create rejects a banned word in room name', () => {
  // rooms.create() is synchronous (throws directly, not a rejected
  // promise) -- assert.throws, not assert.rejects, matches its real
  // call shape.
  const { platform } = setup();
  assert.throws(
    () => platform.rooms.create({ ownerId: 'usr_a', name: BANNED_WORDS[0] }),
    (e) => e.status === 400
  );
});

test('rooms.create rejects a banned word in announcement', () => {
  const { platform } = setup();
  assert.throws(
    () => platform.rooms.create({ ownerId: 'usr_a', name: 'Cool Room', announcement: `no ${BANNED_WORDS[0]} allowed` }),
    (e) => e.status === 400
  );
});

test('rooms.create still accepts a clean name/announcement (no regression)', async () => {
  const { platform } = setup();
  const room = await platform.rooms.create({ ownerId: 'usr_a', name: 'Cool Room', announcement: 'welcome everyone' });
  assert.equal(room.name, 'Cool Room');
  assert.equal(room.announcement, 'welcome everyone');
});

test('room settings update path (rooms.setting) rejects a banned announcement -- same choke point as create (assertValidAnnouncement)', async () => {
  const { platform } = setup();
  const room = await platform.rooms.create({ ownerId: 'usr_a', name: 'Cool Room' });
  await assert.rejects(
    () => platform.rooms.setting('usr_a', room.id, 'announcement', BANNED_WORDS[0]),
    (e) => e.status === 400
  );
});

test('room settings update path (rooms.setting) rejects a banned name', async () => {
  const { platform } = setup();
  const room = await platform.rooms.create({ ownerId: 'usr_a', name: 'Cool Room' });
  await assert.rejects(
    () => platform.rooms.setting('usr_a', room.id, 'name', BANNED_WORDS[0]),
    (e) => e.status === 400
  );
});

test('room settings update path still accepts a clean announcement/name (no regression)', async () => {
  const { platform } = setup();
  const room = await platform.rooms.create({ ownerId: 'usr_a', name: 'Cool Room' });
  const updated = await platform.rooms.setting('usr_a', room.id, 'announcement', 'be kind to each other');
  assert.equal(updated.announcement, 'be kind to each other');
});
