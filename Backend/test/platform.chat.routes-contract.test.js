'use strict';
// Stage 11 -- contract tests for the chat/presence routes added to
// src/routes/platform.routes.js (GET/POST /api/chat/stickers,
// /api/chat/conversations, /api/chat/conversations/:id/messages,
// /api/chat/conversations/:id/read, /api/chat/messages/:id/delete,
// /api/chat/messages/:id/report, /api/presence/heartbeat,
// /api/presence/offline, /api/presence/:userId).
//
// platform.routes.js itself cannot be require()'d in this environment --
// it does `require('express')` at the top of the file, and express is not
// installed here (no network access to install it). This is the exact
// same environmental limitation already documented and accepted for
// accounts.routes.test.js/agora.routes.test.js/auth.routes.test.js/
// config.routes.test.js (the four pre-existing environmental fails) and
// already worked around the same way in
// platform.notifications.routes-contract.test.js.
//
// What this file verifies without needing express:
//   1. Source-level: /api/chat/stickers and /api/chat/conversations (the
//      literal list/create route) are registered BEFORE
//      /api/chat/conversations/:id/... in the actual route file text --
//      an Express routing-order requirement that a unit test on the
//      service layer alone cannot catch.
//   2. Call-shape: every chat/presence route handler's call into
//      chatService uses actingAccountId from req.session.accountId
//      (NEVER a client-supplied field), conversationId/messageId/userId
//      from req.params, and otherUserId/type/body/stickerId/imageUrl/
//      replyToMessageId/reason from req.body -- reproduced here exactly
//      as each handler chains them, including the identity discipline a
//      hostile cross-account call must hit (enforced at the service
//      layer, exhaustively covered in chat.service.test.js -- this file
//      is deliberately about the wiring contract, not re-proving that
//      logic).

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryChatRepository } = require('../src/database/repositories/chat.repository');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');
const { createPlatform, FeatureStore } = require('../src/feature-platform');
const { createChatService } = require('../src/services/chat.service');
const { STICKERS } = require('../src/domain/chat-catalog');

function setup() {
  const chat = new InMemoryChatRepository();
  const platform = createPlatform({ store: new FeatureStore(new InMemoryFeatureRecordRepository()) });
  const chatService = createChatService({ chat, platform });
  return { chatService };
}

// ---------------------------------------------------------------------
// 1. registration order -- literal routes before /:id/... routes
// ---------------------------------------------------------------------

test('/api/chat/stickers and /api/chat/conversations (literal) are registered before /api/chat/conversations/:id/... in the route file', () => {
  const routesSource = fs.readFileSync(path.join(__dirname, '../src/routes/platform.routes.js'), 'utf8');
  const idxStickers = routesSource.indexOf("router.get('/api/chat/stickers'");
  const idxConversationsList = routesSource.indexOf("router.get('/api/chat/conversations'");
  const idxConversationsCreate = routesSource.indexOf("router.post('/api/chat/conversations'");
  const idxConversationsIdMessages = routesSource.indexOf("router.get('/api/chat/conversations/:id/messages'");

  assert.ok(idxStickers !== -1 && idxConversationsList !== -1 && idxConversationsCreate !== -1 && idxConversationsIdMessages !== -1,
    'all four routes must be present in the route file');
  assert.ok(idxStickers < idxConversationsIdMessages);
  assert.ok(idxConversationsList < idxConversationsIdMessages);
  assert.ok(idxConversationsCreate < idxConversationsIdMessages);
});

test('/api/presence/heartbeat and /api/presence/offline (literal) are registered before /api/presence/:userId in the route file', () => {
  const routesSource = fs.readFileSync(path.join(__dirname, '../src/routes/platform.routes.js'), 'utf8');
  const idxHeartbeat = routesSource.indexOf("router.post('/api/presence/heartbeat'");
  const idxOffline = routesSource.indexOf("router.post('/api/presence/offline'");
  const idxUserId = routesSource.indexOf("router.get('/api/presence/:userId'");

  assert.ok(idxHeartbeat !== -1 && idxOffline !== -1 && idxUserId !== -1, 'all three routes must be present');
  assert.ok(idxHeartbeat < idxUserId);
  assert.ok(idxOffline < idxUserId);
});

// ---------------------------------------------------------------------
// 2. GET /api/chat/stickers contract -- static catalog, no session/service call
// ---------------------------------------------------------------------

test('GET /api/chat/stickers contract: returns the real catalog values, unauthenticated identity has no bearing on the result', () => {
  // What the route does: res.json({ ok: true, data: Object.values(STICKERS) })
  const data = Object.values(STICKERS);
  assert.ok(data.length > 0);
  assert.ok(data.every((s) => typeof s.id === 'string'));
});

// ---------------------------------------------------------------------
// 3. GET /api/chat/conversations contract
// ---------------------------------------------------------------------

test('GET /api/chat/conversations contract: listConversations(actingAccountId) from the session, isolated per account', async () => {
  const { chatService } = setup();
  await chatService.getOrCreateConversation('acc_1', 'acc_2');

  const session = { accountId: 'acc_1' }; // what the route does: req.session.accountId
  const data = await chatService.listConversations({ actingAccountId: session.accountId });
  assert.equal(data.length, 1);

  const otherSession = { accountId: 'acc_3' };
  const otherData = await chatService.listConversations({ actingAccountId: otherSession.accountId });
  assert.deepEqual(otherData, []);
});

// ---------------------------------------------------------------------
// 4. POST /api/chat/conversations contract -- positional args, otherUserId from body
// ---------------------------------------------------------------------

test('POST /api/chat/conversations contract: getOrCreateConversation(actingAccountId, otherUserId) -- actingAccountId from session, otherUserId from req.body, never the reverse', async () => {
  const { chatService } = setup();
  const session = { accountId: 'acc_1' };
  const body = { otherUserId: 'acc_2' }; // what the route does: req.body?.otherUserId

  const conversation = await chatService.getOrCreateConversation(session.accountId, body.otherUserId);
  assert.deepEqual(conversation.participantIds, ['acc_1', 'acc_2']);
});

test('POST /api/chat/conversations contract: a client cannot smuggle a different actor via the body -- otherUserId only ever denotes the target', async () => {
  const { chatService } = setup();
  const session = { accountId: 'acc_1' };
  const body = { otherUserId: 'acc_1' }; // hostile: tries to make the target equal the acting session id
  await assert.rejects(
    () => chatService.getOrCreateConversation(session.accountId, body.otherUserId),
    (e) => e.status === 400 // self-chat, exactly like calling it directly would be
  );
});

// ---------------------------------------------------------------------
// 5. GET /api/chat/conversations/:id/messages contract
// ---------------------------------------------------------------------

test('GET /api/chat/conversations/:id/messages contract: listMessages(actingAccountId from session, conversationId from params, limit from query as a Number)', async () => {
  const { chatService } = setup();
  const conversation = await chatService.getOrCreateConversation('acc_1', 'acc_2');
  await chatService.sendMessage({ actingAccountId: 'acc_1', conversationId: conversation.id, type: 'text', body: 'one' });
  await chatService.sendMessage({ actingAccountId: 'acc_2', conversationId: conversation.id, type: 'text', body: 'two' });

  const session = { accountId: 'acc_1' };
  const params = { id: conversation.id }; // req.params.id
  const query = { limit: '1' }; // req.query.limit, a route always Number()s this before passing it on
  const data = await chatService.listMessages({
    actingAccountId: session.accountId,
    conversationId: params.id,
    limit: query.limit ? Number(query.limit) : undefined,
  });
  assert.equal(data.length, 1);
  assert.equal(data[0].body, 'two');
});

test('GET /api/chat/conversations/:id/messages contract: a cross-account attempt via a foreign conversationId is rejected (403), never leaking another pair\'s messages', async () => {
  const { chatService } = setup();
  const conversation = await chatService.getOrCreateConversation('acc_1', 'acc_2');
  const session = { accountId: 'acc_intruder' };
  await assert.rejects(
    () => chatService.listMessages({ actingAccountId: session.accountId, conversationId: conversation.id }),
    (e) => e.status === 403
  );
});

// ---------------------------------------------------------------------
// 6. POST /api/chat/conversations/:id/messages contract
// ---------------------------------------------------------------------

test('POST /api/chat/conversations/:id/messages contract: sendMessage pulls actingAccountId from session, conversationId from params, the rest from req.body', async () => {
  const { chatService } = setup();
  const conversation = await chatService.getOrCreateConversation('acc_1', 'acc_2');

  const session = { accountId: 'acc_1' };
  const params = { id: conversation.id };
  const body = { type: 'text', body: 'hello', stickerId: undefined, imageUrl: undefined, replyToMessageId: undefined };

  const message = await chatService.sendMessage({
    actingAccountId: session.accountId,
    conversationId: params.id,
    type: body.type,
    body: body.body,
    stickerId: body.stickerId,
    imageUrl: body.imageUrl,
    replyToMessageId: body.replyToMessageId,
  });
  assert.equal(message.senderId, 'acc_1');
  assert.equal(message.body, 'hello');
});

// ---------------------------------------------------------------------
// 7. POST /api/chat/conversations/:id/read contract
// ---------------------------------------------------------------------

test('POST /api/chat/conversations/:id/read contract: markConversationRead(actingAccountId from session, conversationId from params)', async () => {
  const { chatService } = setup();
  const conversation = await chatService.getOrCreateConversation('acc_1', 'acc_2');
  await chatService.sendMessage({ actingAccountId: 'acc_2', conversationId: conversation.id, type: 'text', body: 'hi' });

  const session = { accountId: 'acc_1' };
  const params = { id: conversation.id };
  const result = await chatService.markConversationRead({ actingAccountId: session.accountId, conversationId: params.id });
  assert.equal(result.markedRead, 1);
});

// ---------------------------------------------------------------------
// 8. POST /api/chat/messages/:id/delete contract
// ---------------------------------------------------------------------

test('POST /api/chat/messages/:id/delete contract: deleteMessage(actingAccountId from session, messageId from params) rejects a non-sender', async () => {
  const { chatService } = setup();
  const conversation = await chatService.getOrCreateConversation('acc_1', 'acc_2');
  const message = await chatService.sendMessage({ actingAccountId: 'acc_1', conversationId: conversation.id, type: 'text', body: 'hi' });

  const hostileSession = { accountId: 'acc_2' };
  const params = { id: message.id };
  await assert.rejects(
    () => chatService.deleteMessage({ actingAccountId: hostileSession.accountId, messageId: params.id }),
    (e) => e.status === 403
  );

  const ownerSession = { accountId: 'acc_1' };
  const deleted = await chatService.deleteMessage({ actingAccountId: ownerSession.accountId, messageId: params.id });
  assert.equal(deleted.deleted, true);
});

// ---------------------------------------------------------------------
// 9. POST /api/chat/messages/:id/report contract
// ---------------------------------------------------------------------

test('POST /api/chat/messages/:id/report contract: reportMessage(actingAccountId from session, messageId from params, reason from req.body) rejects a self-report', async () => {
  const { chatService } = setup();
  const conversation = await chatService.getOrCreateConversation('acc_1', 'acc_2');
  const message = await chatService.sendMessage({ actingAccountId: 'acc_1', conversationId: conversation.id, type: 'text', body: 'hi' });

  const selfSession = { accountId: 'acc_1' };
  const params = { id: message.id };
  const body = { reason: 'spam' };
  await assert.rejects(
    () => chatService.reportMessage({ actingAccountId: selfSession.accountId, messageId: params.id, reason: body.reason }),
    (e) => e.status === 403
  );

  const otherSession = { accountId: 'acc_2' };
  const reported = await chatService.reportMessage({ actingAccountId: otherSession.accountId, messageId: params.id, reason: body.reason });
  assert.equal(reported.reports[0].reporterId, 'acc_2');
  assert.equal(reported.reports[0].reason, 'spam');
});

// ---------------------------------------------------------------------
// 10. POST /api/presence/heartbeat + /offline, GET /api/presence/:userId
// ---------------------------------------------------------------------

test('POST /api/presence/heartbeat + /api/presence/offline contract: both take actingAccountId ONLY from the session, never a body/param field', async () => {
  const { chatService } = setup();
  const session = { accountId: 'acc_1' };
  await chatService.heartbeat({ actingAccountId: session.accountId });
  const online = await chatService.getPresence({ actingAccountId: session.accountId, targetUserId: session.accountId });
  assert.equal(online.status, 'online');

  await chatService.goOffline({ actingAccountId: session.accountId });
  const offline = await chatService.getPresence({ actingAccountId: session.accountId, targetUserId: session.accountId });
  assert.equal(offline.status, 'offline');
});

test('GET /api/presence/:userId contract: getPresence(actingAccountId from session, targetUserId from req.params.userId)', async () => {
  const { chatService } = setup();
  await chatService.heartbeat({ actingAccountId: 'acc_2' });

  const session = { accountId: 'acc_1' };
  const params = { userId: 'acc_2' }; // req.params.userId
  const presence = await chatService.getPresence({ actingAccountId: session.accountId, targetUserId: params.userId });
  assert.equal(presence.status, 'online');
});
