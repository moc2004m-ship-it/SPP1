'use strict';

// Stage 11 — Private Chat model.
//
// Same boundary as notification.model.js/guard.model.js: nothing here
// accepts a client-supplied id -- ids are always generated here.
// `type` and its payload shape are always validated here BEFORE
// services/chat.service.js ever asks the repository to persist a
// message -- a client can never send a message whose declared type does
// not match the field it actually filled in (e.g. type:'image' with no
// imageUrl, or a `sticker` message pointing at an unreviewed URL).

const crypto = require('node:crypto');
const { resolveSticker } = require('../../domain/chat-catalog');

function generateConversationId() {
  return `conv_${crypto.randomUUID()}`;
}

function generateMessageId() {
  return `msg_${crypto.randomUUID()}`;
}

// Stage 11 scope, per the continuation report's explicit gap list:
// text + emoji (both plain text bodies, different length rules) +
// sticker (server-catalog only, see ../../domain/chat-catalog.js) +
// image (a URL the client already has hosted somewhere -- this backend
// has no file-upload/CDN pipeline of its own, so "image message" here
// means "a message that carries a ready-to-render http(s) image URL",
// never a raw file upload).
const MESSAGE_TYPES = Object.freeze(['text', 'emoji', 'sticker', 'image']);

// sent      -- created, recipient not confirmed online at send time.
// delivered -- recipient was online (real heartbeat-derived presence,
//              see ../repositories/chat.repository.js) at send time.
// read      -- recipient has opened the conversation and
//              chat.service.js's markConversationRead() has run.
// Never skips backwards (read -> delivered/sent is not a real
// transition this file exposes).
const MESSAGE_STATUSES = Object.freeze(['sent', 'delivered', 'read']);

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function assertValidMessageType(type) {
  if (!MESSAGE_TYPES.includes(type)) {
    throw badRequest(`type must be one of ${MESSAGE_TYPES.join(', ')}`);
  }
  return type;
}

// Validates the type-specific payload and returns the normalized fields
// that actually belong on the stored message -- e.g. a `sticker` message
// never stores a client-supplied body, only the resolved catalog id.
function assertValidMessagePayload({ type, body, stickerId, imageUrl }) {
  if (type === 'text') {
    if (typeof body !== 'string' || !body.trim() || body.length > 5000) {
      throw badRequest('body is required for a text message (1-5000 characters)');
    }
    return { body: body.trim(), stickerId: null, imageUrl: null };
  }
  if (type === 'emoji') {
    if (typeof body !== 'string' || !body.trim() || body.length > 32) {
      throw badRequest('body is required for an emoji message (1-32 characters)');
    }
    return { body: body.trim(), stickerId: null, imageUrl: null };
  }
  if (type === 'sticker') {
    const sticker = resolveSticker(stickerId); // throws 400 on an unknown stickerId
    return { body: null, stickerId: sticker.id, imageUrl: null };
  }
  if (type === 'image') {
    if (typeof imageUrl !== 'string' || !imageUrl.trim() || imageUrl.length > 2000) {
      throw badRequest('imageUrl is required for an image message');
    }
    const trimmed = imageUrl.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      throw badRequest('imageUrl must be an http(s) URL');
    }
    return { body: null, stickerId: null, imageUrl: trimmed };
  }
  // Unreachable if assertValidMessageType() ran first, but never trust a
  // single call site to always order things correctly.
  throw badRequest(`type must be one of ${MESSAGE_TYPES.join(', ')}`);
}

module.exports = {
  MESSAGE_TYPES,
  MESSAGE_STATUSES,
  generateConversationId,
  generateMessageId,
  assertValidMessageType,
  assertValidMessagePayload,
};
