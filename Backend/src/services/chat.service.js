'use strict';

// Stage 11 — Private Chat service.
//
// The ONLY code path allowed to change conversation/message/presence
// state. Same split as guard.service.js/family.service.js vs their
// repositories: ../database/repositories/chat.repository.js is a plain
// data-integrity layer with no opinion on authorization/privacy -- every
// rule below lives here.
//
// `platform` is injected WHOLE (not just `store`), same precedent as
// referral.service.js: this lets chat.service.js reach
// platform.social.allowed() for the real block check AND read the real
// stage-7 privacy record (via platform.store, which is a public property
// of the object createPlatform() returns -- see ../feature-platform.js)
// for the two privacy fields explicitly documented since session 18 as
// needing Stage 11's structure to enforce: whoCanMessage and
// showLastSeen. Nothing in ../feature-platform.js is modified to make
// this work -- the privacy record is read the exact same way
// profile.getFull() already reads it internally, just from here instead.
//
// Rules enforced here:
//   1. A user can never open a conversation with themselves
//      (assertNotSelfChat below).
//   2. A block in EITHER direction (platform.social.allowed) blocks a
//      new conversation AND blocks sending into an existing one -- the
//      re-check on every sendMessage() matters because a block can be
//      applied to an already-open conversation.
//   3. whoCanMessage ('everyone' | 'friends' | 'nobody') on the
//      RECIPIENT's stage-7 privacy record gates getOrCreateConversation()
//      -- 'friends' requires a real accepted friend relation (computed
//      the same way profile.getFull() computes isFriend), 'nobody' never
//      allows a new conversation regardless of relation.
//   4. Message type/content is ALWAYS validated through
//      ../database/models/chat.model.js's assertValidMessagePayload --
//      never trusted as pre-shaped from the client.
//   5. status on a freshly sent message is 'delivered' only when the
//      OTHER participant is REALLY online right now (real heartbeat-
//      derived presence, see chat.repository.js's getPresence) --
//      otherwise 'sent'. Never assumed, never a hardcoded value.
//   6. deleteMessage is sender-only (403 otherwise); reportMessage
//      rejects reporting your own message (403).
//   7. getPresence() strips lastSeenAt for a non-owner viewer when the
//      target's showLastSeen privacy flag is false -- the effective
//      online/offline status itself is still shown (same "you can see
//      someone is online but not exactly when they were last seen"
//      distinction most chat apps draw), only the timestamp is withheld.

const { assertValidMessageType, assertValidMessagePayload } = require('../database/models/chat.model');
// Stage 35 Part 4/8 -- Word Filter. See ../services/word-filter.service.js
// for the centralized implementation this reuses; see this file's
// sendMessage() below for exactly which message fields it applies to.
const { assertCleanContent } = require('./word-filter.service');

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}
function forbidden(message) {
  return Object.assign(new Error(message), { status: 403 });
}
function notFound(message) {
  return Object.assign(new Error(message), { status: 404 });
}

function requireId(value, name = 'id') {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw badRequest(`${name} is invalid`);
  }
  return value.trim();
}

function assertNotSelfChat(userA, userB) {
  if (userA === userB) {
    throw badRequest('you cannot start a conversation with yourself');
  }
}

const DEFAULT_PRIVACY = Object.freeze({
  profileVisibility: 'public',
  discoverable: true,
  whoCanMessage: 'everyone',
  showLastSeen: true,
  whoCanInviteToRoom: 'everyone',
});

function createChatService({ chat, platform, notificationService, bus, now = () => new Date() }) {
  // Reads the same stage-7 record profile.getFull() reads internally --
  // platform.store is a public property of the object createPlatform()
  // returns (see ../feature-platform.js), so this is not reaching into a
  // private implementation detail.
  async function getPrivacy(userId) {
    const rawProfile = await platform.store.find(7, (x) => x.userId === userId);
    return { ...DEFAULT_PRIVACY, ...(rawProfile?.privacy || {}) };
  }

  // Same computation as ../feature-platform.js's profile.getFull()
  // isFriend -- duplicated here (not exported there) rather than
  // touching that file, per this stage's explicit "don't touch other
  // stages' files" scope.
  async function isFriend(userA, userB) {
    const [asA, asB] = await Promise.all([
      platform.store.find(10, (x) => x.type === 'friend' && x.status === 'accepted' && x.userId === userA && x.targetId === userB),
      platform.store.find(10, (x) => x.type === 'friend' && x.status === 'accepted' && x.userId === userB && x.targetId === userA),
    ]);
    return !!asA || !!asB;
  }

  async function assertCanMessage(actingAccountId, otherUserId) {
    const allowed = await platform.social.allowed(actingAccountId, otherUserId, 'message');
    if (!allowed) throw forbidden('you cannot message this account');
  }

  async function getOrCreateConversation(actingAccountId, otherUserId) {
    requireId(actingAccountId, 'actingAccountId');
    requireId(otherUserId, 'otherUserId');
    assertNotSelfChat(actingAccountId, otherUserId);

    await assertCanMessage(actingAccountId, otherUserId);

    const privacy = await getPrivacy(otherUserId);
    if (privacy.whoCanMessage === 'nobody') {
      throw forbidden('this account is not accepting messages');
    }
    if (privacy.whoCanMessage === 'friends') {
      const friends = await isFriend(actingAccountId, otherUserId);
      if (!friends) throw forbidden('this account only accepts messages from friends');
    }

    return chat.getOrCreateConversation(actingAccountId, otherUserId);
  }

  async function requireMembership(conversationId, actingAccountId) {
    const conversation = await chat.getConversationById(conversationId);
    if (!conversation) throw notFound('conversation not found');
    if (!conversation.participantIds.includes(actingAccountId)) {
      throw forbidden('you are not a participant in this conversation');
    }
    return conversation;
  }

  async function listConversations({ actingAccountId }) {
    requireId(actingAccountId, 'actingAccountId');
    return chat.listConversationsForAccount(actingAccountId);
  }

  async function listMessages({ actingAccountId, conversationId, limit }) {
    requireId(conversationId, 'conversationId');
    await requireMembership(conversationId, actingAccountId);
    return chat.listMessages(conversationId, { limit });
  }

  async function sendMessage({ actingAccountId, conversationId, type, body, stickerId, imageUrl, replyToMessageId }) {
    requireId(conversationId, 'conversationId');
    const conversation = await requireMembership(conversationId, actingAccountId);
    const otherUserId = conversation.participantIds.find((id) => id !== actingAccountId);

    // Re-checked on every send -- a block can be applied to an already
    // open conversation, so getOrCreateConversation()'s earlier check is
    // not sufficient on its own.
    await assertCanMessage(actingAccountId, otherUserId);

    assertValidMessageType(type);
    const normalized = assertValidMessagePayload({ type, body, stickerId, imageUrl });

    // Stage 35 Part 4/8 -- Word Filter enforcement point. Runs AFTER
    // assertValidMessagePayload() (so a malformed payload is rejected
    // for that reason first) and BEFORE any persistence/publish/notify
    // call below -- a message that fails this check is never stored,
    // never put on the bus, and never triggers a notification. Only
    // `text`/`emoji` bodies are free-form user text; `sticker` resolves
    // to a fixed server catalog id (../database/models/chat.model.js)
    // and `image` is just a URL -- neither carries arbitrary prose, so
    // neither is passed through the filter. This is also the real
    // server-side enforcement point: it runs here regardless of which
    // client (Mobile or a direct API call) reached sendMessage(), so it
    // cannot be bypassed by skipping Mobile's UI.
    if (normalized.body && (type === 'text' || type === 'emoji')) {
      assertCleanContent(normalized.body, 'message');
    }

    let normalizedReplyToMessageId = null;
    if (replyToMessageId != null) {
      const replyTarget = await chat.findMessageById(requireId(replyToMessageId, 'replyToMessageId'));
      if (!replyTarget || replyTarget.conversationId !== conversationId) {
        throw badRequest('replyToMessageId must belong to this conversation');
      }
      normalizedReplyToMessageId = replyTarget.id;
    }

    const nowValue = now();
    const presence = await chat.getPresence(otherUserId, { now: nowValue });
    const status = presence.status === 'online' ? 'delivered' : 'sent';

    const message = await chat.addMessage({
      conversationId,
      senderId: actingAccountId,
      type,
      body: normalized.body,
      stickerId: normalized.stickerId,
      imageUrl: normalized.imageUrl,
      replyToMessageId: normalizedReplyToMessageId,
      status,
      now: nowValue,
    });

    if (bus) bus.publish(conversationId, { type: 'message', message });

    // Stage 35 Part 3/8 -- Mute effect: the message itself is always sent,
    // stored, and delivered over the bus exactly as before (mute is
    // deliberately NOT block -- see platform.social.muteUser()'s header in
    // feature-platform.js). The only thing mute changes is whether the
    // RECIPIENT is notified about it: if otherUserId currently mutes the
    // sender, the PRIVATE_MESSAGE notification is suppressed the same way
    // a muted category already suppresses notify() elsewhere -- the sender
    // is never told they're muted, and nothing here prevents them sending
    // again.
    if (notificationService && !(await platform.social.isUserMuted(otherUserId, actingAccountId))) {
      await notificationService.notify({
        recipientId: otherUserId,
        type: 'PRIVATE_MESSAGE',
        payload: { conversationId },
      });
    }

    return message;
  }

  async function markConversationRead({ actingAccountId, conversationId }) {
    requireId(conversationId, 'conversationId');
    await requireMembership(conversationId, actingAccountId);
    const nowValue = now();
    const markedRead = await chat.markConversationRead({ conversationId, readerId: actingAccountId, now: nowValue });
    if (bus && markedRead > 0) {
      bus.publish(conversationId, { type: 'read', conversationId, readerId: actingAccountId });
    }
    return { conversationId, markedRead };
  }

  async function deleteMessage({ actingAccountId, messageId }) {
    requireId(messageId, 'messageId');
    const message = await chat.findMessageById(messageId);
    if (!message) throw notFound('message not found');
    if (message.senderId !== actingAccountId) {
      throw forbidden('only the sender may delete this message');
    }
    const updated = await chat.softDeleteMessage(messageId, actingAccountId, now());
    if (bus) bus.publish(message.conversationId, { type: 'delete', messageId, deletedBy: actingAccountId });
    return updated;
  }

  async function reportMessage({ actingAccountId, messageId, reason }) {
    requireId(messageId, 'messageId');
    const message = await chat.findMessageById(messageId);
    if (!message) throw notFound('message not found');
    if (message.senderId === actingAccountId) {
      throw forbidden('you cannot report your own message');
    }
    return chat.reportMessage(messageId, actingAccountId, reason, now());
  }

  async function heartbeat({ actingAccountId }) {
    requireId(actingAccountId, 'actingAccountId');
    return chat.heartbeat(actingAccountId, now());
  }

  async function goOffline({ actingAccountId }) {
    requireId(actingAccountId, 'actingAccountId');
    return chat.goOffline(actingAccountId, now());
  }

  async function getPresence({ actingAccountId, targetUserId }) {
    requireId(targetUserId, 'targetUserId');
    const presence = await chat.getPresence(targetUserId, { now: now() });
    if (targetUserId === actingAccountId) return presence;
    const privacy = await getPrivacy(targetUserId);
    if (privacy.showLastSeen === false) {
      return { ...presence, lastSeenAt: null };
    }
    return presence;
  }

  return {
    getOrCreateConversation,
    listConversations,
    listMessages,
    sendMessage,
    markConversationRead,
    deleteMessage,
    reportMessage,
    heartbeat,
    goOffline,
    getPresence,
  };
}

module.exports = { createChatService };
