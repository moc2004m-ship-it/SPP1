'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryChatRepository } = require('../src/database/repositories/chat.repository');

// ---------------------------------------------------------------------
// conversations -- idempotent regardless of call order
// ---------------------------------------------------------------------

test('getOrCreateConversation is idempotent regardless of argument order (a,b) vs (b,a)', async () => {
  const chat = new InMemoryChatRepository();
  const first = await chat.getOrCreateConversation('usr_a', 'usr_b');
  const second = await chat.getOrCreateConversation('usr_b', 'usr_a');
  assert.equal(first.id, second.id);
  const all = await chat.listConversationsForAccount('usr_a');
  assert.equal(all.length, 1, 'a second call must not create a second conversation row');
});

test('getOrCreateConversation always stores participantIds sorted', async () => {
  const chat = new InMemoryChatRepository();
  const conversation = await chat.getOrCreateConversation('usr_z', 'usr_a');
  assert.deepEqual(conversation.participantIds, ['usr_a', 'usr_z']);
});

test('getConversationById returns null for an unknown id', async () => {
  const chat = new InMemoryChatRepository();
  assert.equal(await chat.getConversationById('conv_nope'), null);
});

test('listConversationsForAccount is ordered by most-recent-activity first', async () => {
  const chat = new InMemoryChatRepository();
  const convOld = await chat.getOrCreateConversation('usr_x', 'usr_old');
  await chat.addMessage({ conversationId: convOld.id, senderId: 'usr_x', type: 'text', body: 'hi', status: 'sent', now: new Date('2026-01-01T00:00:00.000Z') });

  const convNew = await chat.getOrCreateConversation('usr_x', 'usr_new');
  await chat.addMessage({ conversationId: convNew.id, senderId: 'usr_x', type: 'text', body: 'hi', status: 'sent', now: new Date('2026-01-02T00:00:00.000Z') });

  const list = await chat.listConversationsForAccount('usr_x');
  assert.deepEqual(list.map((c) => c.id), [convNew.id, convOld.id]);
});

test('listConversationsForAccount only returns conversations the account participates in', async () => {
  const chat = new InMemoryChatRepository();
  await chat.getOrCreateConversation('usr_a', 'usr_b');
  await chat.getOrCreateConversation('usr_c', 'usr_d');
  const list = await chat.listConversationsForAccount('usr_a');
  assert.equal(list.length, 1);
});

// ---------------------------------------------------------------------
// messages -- add/list/order
// ---------------------------------------------------------------------

test('addMessage rejects a nonexistent conversationId (404)', async () => {
  const chat = new InMemoryChatRepository();
  await assert.rejects(
    () => chat.addMessage({ conversationId: 'conv_nope', senderId: 'usr_a', type: 'text', body: 'hi', status: 'sent' }),
    (e) => e.status === 404
  );
});

test('addMessage bumps the conversation\'s lastMessageAt', async () => {
  const chat = new InMemoryChatRepository();
  const conversation = await chat.getOrCreateConversation('usr_a', 'usr_b');
  await chat.addMessage({ conversationId: conversation.id, senderId: 'usr_a', type: 'text', body: 'hi', status: 'sent', now: new Date('2026-05-01T00:00:00.000Z') });
  const updated = await chat.getConversationById(conversation.id);
  assert.equal(updated.lastMessageAt, '2026-05-01T00:00:00.000Z');
});

test('listMessages returns messages in chronological (oldest-first) order', async () => {
  const chat = new InMemoryChatRepository();
  const conversation = await chat.getOrCreateConversation('usr_a', 'usr_b');
  const first = await chat.addMessage({ conversationId: conversation.id, senderId: 'usr_a', type: 'text', body: 'one', status: 'sent', now: new Date('2026-01-01T00:00:00.000Z') });
  const second = await chat.addMessage({ conversationId: conversation.id, senderId: 'usr_b', type: 'text', body: 'two', status: 'sent', now: new Date('2026-01-01T00:00:01.000Z') });
  const list = await chat.listMessages(conversation.id);
  assert.deepEqual(list.map((m) => m.id), [first.id, second.id]);
});

test('listMessages with a limit returns the most recent N, still in chronological order', async () => {
  const chat = new InMemoryChatRepository();
  const conversation = await chat.getOrCreateConversation('usr_a', 'usr_b');
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const m = await chat.addMessage({ conversationId: conversation.id, senderId: 'usr_a', type: 'text', body: `m${i}`, status: 'sent', now: new Date(2026, 0, 1, 0, 0, i) });
    ids.push(m.id);
  }
  const list = await chat.listMessages(conversation.id, { limit: 2 });
  assert.deepEqual(list.map((m) => m.id), ids.slice(-2));
});

test('findMessageById returns null for an unknown id', async () => {
  const chat = new InMemoryChatRepository();
  assert.equal(await chat.findMessageById('msg_nope'), null);
});

// ---------------------------------------------------------------------
// markConversationRead -- ignores sender's own messages, idempotent
// ---------------------------------------------------------------------

test('markConversationRead marks only the OTHER participant\'s unread messages as read, returns the real count transitioned', async () => {
  const chat = new InMemoryChatRepository();
  const conversation = await chat.getOrCreateConversation('usr_a', 'usr_b');
  await chat.addMessage({ conversationId: conversation.id, senderId: 'usr_a', type: 'text', body: 'from a', status: 'sent' });
  await chat.addMessage({ conversationId: conversation.id, senderId: 'usr_b', type: 'text', body: 'from b', status: 'sent' });

  const count = await chat.markConversationRead({ conversationId: conversation.id, readerId: 'usr_a' });
  assert.equal(count, 1, 'only usr_b\'s message should transition -- usr_a\'s own message is never marked read by their own call');

  const messages = await chat.listMessages(conversation.id);
  assert.equal(messages.find((m) => m.senderId === 'usr_b').status, 'read');
  assert.equal(messages.find((m) => m.senderId === 'usr_a').status, 'sent');
});

test('markConversationRead is idempotent -- a second call with nothing new returns 0', async () => {
  const chat = new InMemoryChatRepository();
  const conversation = await chat.getOrCreateConversation('usr_a', 'usr_b');
  await chat.addMessage({ conversationId: conversation.id, senderId: 'usr_b', type: 'text', body: 'hi', status: 'sent' });
  await chat.markConversationRead({ conversationId: conversation.id, readerId: 'usr_a' });
  const second = await chat.markConversationRead({ conversationId: conversation.id, readerId: 'usr_a' });
  assert.equal(second, 0);
});

// ---------------------------------------------------------------------
// softDeleteMessage -- idempotent, never a real delete
// ---------------------------------------------------------------------

test('softDeleteMessage zeroes body/stickerId/imageUrl and sets deleted:true, but keeps the row (id/sender/timestamps/reports)', async () => {
  const chat = new InMemoryChatRepository();
  const conversation = await chat.getOrCreateConversation('usr_a', 'usr_b');
  const message = await chat.addMessage({ conversationId: conversation.id, senderId: 'usr_a', type: 'text', body: 'secret', status: 'sent' });

  const deleted = await chat.softDeleteMessage(message.id, 'usr_a');
  assert.equal(deleted.body, null);
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.deletedBy, 'usr_a');
  assert.equal(deleted.id, message.id);
  assert.equal(deleted.senderId, 'usr_a');

  const stillThere = await chat.findMessageById(message.id);
  assert.ok(stillThere, 'the row must still exist -- soft delete is never a real delete');
});

test('softDeleteMessage is idempotent -- deleting an already-deleted message is a no-op, not an error', async () => {
  const chat = new InMemoryChatRepository();
  const conversation = await chat.getOrCreateConversation('usr_a', 'usr_b');
  const message = await chat.addMessage({ conversationId: conversation.id, senderId: 'usr_a', type: 'text', body: 'secret', status: 'sent' });
  await chat.softDeleteMessage(message.id, 'usr_a');
  const second = await chat.softDeleteMessage(message.id, 'usr_a');
  assert.equal(second.deleted, true);
});

test('softDeleteMessage rejects a nonexistent messageId (404)', async () => {
  const chat = new InMemoryChatRepository();
  await assert.rejects(() => chat.softDeleteMessage('msg_nope', 'usr_a'), (e) => e.status === 404);
});

// ---------------------------------------------------------------------
// reportMessage
// ---------------------------------------------------------------------

test('reportMessage appends a real report record with reporterId/reason/createdAt', async () => {
  const chat = new InMemoryChatRepository();
  const conversation = await chat.getOrCreateConversation('usr_a', 'usr_b');
  const message = await chat.addMessage({ conversationId: conversation.id, senderId: 'usr_a', type: 'text', body: 'hi', status: 'sent' });
  const reported = await chat.reportMessage(message.id, 'usr_b', 'spam', new Date('2026-01-01T00:00:00.000Z'));
  assert.equal(reported.reports.length, 1);
  assert.deepEqual(reported.reports[0], { reporterId: 'usr_b', reason: 'spam', createdAt: '2026-01-01T00:00:00.000Z' });
});

test('reportMessage rejects a nonexistent messageId (404)', async () => {
  const chat = new InMemoryChatRepository();
  await assert.rejects(() => chat.reportMessage('msg_nope', 'usr_b', 'spam'), (e) => e.status === 404);
});

// ---------------------------------------------------------------------
// countUnreadForConversation
// ---------------------------------------------------------------------

test('countUnreadForConversation counts only the other participant\'s unread messages', async () => {
  const chat = new InMemoryChatRepository();
  const conversation = await chat.getOrCreateConversation('usr_a', 'usr_b');
  await chat.addMessage({ conversationId: conversation.id, senderId: 'usr_b', type: 'text', body: '1', status: 'sent' });
  await chat.addMessage({ conversationId: conversation.id, senderId: 'usr_b', type: 'text', body: '2', status: 'sent' });
  await chat.addMessage({ conversationId: conversation.id, senderId: 'usr_a', type: 'text', body: '3', status: 'sent' });
  assert.equal(await chat.countUnreadForConversation(conversation.id, 'usr_a'), 2);
  assert.equal(await chat.countUnreadForConversation(conversation.id, 'usr_b'), 1);
});

// ---------------------------------------------------------------------
// presence -- real heartbeat-window derivation, no fake revival
// ---------------------------------------------------------------------

test('heartbeat marks online and sets a real lastSeenAt', async () => {
  const chat = new InMemoryChatRepository();
  const record = await chat.heartbeat('usr_a', new Date('2026-01-01T00:00:00.000Z'));
  assert.equal(record.status, 'online');
  assert.equal(record.lastSeenAt, '2026-01-01T00:00:00.000Z');
});

test('getPresence for an account that has never heartbeat-ed returns offline with a null lastSeenAt', async () => {
  const chat = new InMemoryChatRepository();
  const presence = await chat.getPresence('usr_never_seen');
  assert.deepEqual(presence, { accountId: 'usr_never_seen', status: 'offline', lastSeenAt: null });
});

test('getPresence derives offline once the heartbeat ages past onlineWindowMs, without mutating the stored record', async () => {
  const chat = new InMemoryChatRepository();
  await chat.heartbeat('usr_a', new Date('2026-01-01T00:00:00.000Z'));

  const stillOnline = await chat.getPresence('usr_a', { now: new Date('2026-01-01T00:00:30.000Z'), onlineWindowMs: 60000 });
  assert.equal(stillOnline.status, 'online');

  const nowOffline = await chat.getPresence('usr_a', { now: new Date('2026-01-01T00:02:00.000Z'), onlineWindowMs: 60000 });
  assert.equal(nowOffline.status, 'offline');
  assert.equal(nowOffline.lastSeenAt, '2026-01-01T00:00:00.000Z', 'derivation never rewrites lastSeenAt');

  // Confirm no mutation actually happened by re-heartbeat-ing and
  // checking a fresh read within the window is online again.
  const stillOnlineAgain = await chat.getPresence('usr_a', { now: new Date('2026-01-01T00:00:45.000Z'), onlineWindowMs: 60000 });
  assert.equal(stillOnlineAgain.status, 'online', 'the underlying record must still be the real, unmutated online heartbeat');
});

test('goOffline sets status offline explicitly and preserves the last real lastSeenAt (no fake revival, no fake extension)', async () => {
  const chat = new InMemoryChatRepository();
  await chat.heartbeat('usr_a', new Date('2026-01-01T00:00:00.000Z'));
  const offline = await chat.goOffline('usr_a', new Date('2026-01-01T00:05:00.000Z'));
  assert.equal(offline.status, 'offline');
  assert.equal(offline.lastSeenAt, '2026-01-01T00:00:00.000Z', 'goOffline must not touch lastSeenAt');
});

test('goOffline before any heartbeat records offline with a null lastSeenAt', async () => {
  const chat = new InMemoryChatRepository();
  const offline = await chat.goOffline('usr_never_seen', new Date('2026-01-01T00:00:00.000Z'));
  assert.equal(offline.status, 'offline');
  assert.equal(offline.lastSeenAt, null);
});

test('an explicit offline record stays offline regardless of how recent -- getPresence never re-derives it back to online', async () => {
  const chat = new InMemoryChatRepository();
  await chat.heartbeat('usr_a', new Date('2026-01-01T00:00:00.000Z'));
  await chat.goOffline('usr_a', new Date('2026-01-01T00:00:01.000Z'));
  const presence = await chat.getPresence('usr_a', { now: new Date('2026-01-01T00:00:02.000Z'), onlineWindowMs: 60000 });
  assert.equal(presence.status, 'offline');
});

test('presence is isolated per account', async () => {
  const chat = new InMemoryChatRepository();
  await chat.heartbeat('usr_a', new Date('2026-01-01T00:00:00.000Z'));
  const other = await chat.getPresence('usr_b', { now: new Date('2026-01-01T00:00:00.000Z') });
  assert.equal(other.status, 'offline');
});
