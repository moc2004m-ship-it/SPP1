'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MESSAGE_TYPES,
  MESSAGE_STATUSES,
  generateConversationId,
  generateMessageId,
  assertValidMessageType,
  assertValidMessagePayload,
} = require('../src/database/models/chat.model');

// ---------------------------------------------------------------------
// id generation
// ---------------------------------------------------------------------

test('generateConversationId/generateMessageId produce real, distinct, prefixed ids -- never a client-supplied id', () => {
  const conv = generateConversationId();
  const msg = generateMessageId();
  assert.match(conv, /^conv_/);
  assert.match(msg, /^msg_/);
  assert.notEqual(generateConversationId(), generateConversationId());
  assert.notEqual(generateMessageId(), generateMessageId());
});

// ---------------------------------------------------------------------
// assertValidMessageType
// ---------------------------------------------------------------------

test('assertValidMessageType accepts every declared type and rejects anything else', () => {
  for (const type of MESSAGE_TYPES) {
    assert.equal(assertValidMessageType(type), type);
  }
  assert.throws(() => assertValidMessageType('video'), { status: 400 });
  assert.throws(() => assertValidMessageType(undefined), { status: 400 });
});

test('MESSAGE_STATUSES never regresses backwards -- read is a real terminal-ish state, not reversible via this file', () => {
  assert.deepEqual(MESSAGE_STATUSES, ['sent', 'delivered', 'read']);
});

// ---------------------------------------------------------------------
// assertValidMessagePayload -- text
// ---------------------------------------------------------------------

test('a text message requires a non-empty body (<=5000 chars) and normalizes it (trimmed, stickerId/imageUrl nulled)', () => {
  const result = assertValidMessagePayload({ type: 'text', body: '  hello  ' });
  assert.deepEqual(result, { body: 'hello', stickerId: null, imageUrl: null });
});

test('a text message rejects an empty/whitespace-only body', () => {
  assert.throws(() => assertValidMessagePayload({ type: 'text', body: '' }), { status: 400 });
  assert.throws(() => assertValidMessagePayload({ type: 'text', body: '   ' }), { status: 400 });
});

test('a text message rejects a body over 5000 characters', () => {
  assert.throws(() => assertValidMessagePayload({ type: 'text', body: 'x'.repeat(5001) }), { status: 400 });
});

test('a text message accepts a body of exactly 5000 characters', () => {
  const result = assertValidMessagePayload({ type: 'text', body: 'x'.repeat(5000) });
  assert.equal(result.body.length, 5000);
});

// ---------------------------------------------------------------------
// assertValidMessagePayload -- emoji
// ---------------------------------------------------------------------

test('an emoji message requires a non-empty body (<=32 chars)', () => {
  const result = assertValidMessagePayload({ type: 'emoji', body: '🔥' });
  assert.deepEqual(result, { body: '🔥', stickerId: null, imageUrl: null });
});

test('an emoji message rejects a body over 32 characters', () => {
  assert.throws(() => assertValidMessagePayload({ type: 'emoji', body: 'x'.repeat(33) }), { status: 400 });
});

test('an emoji message rejects an empty body', () => {
  assert.throws(() => assertValidMessagePayload({ type: 'emoji', body: '' }), { status: 400 });
});

// ---------------------------------------------------------------------
// assertValidMessagePayload -- sticker
// ---------------------------------------------------------------------

test('a sticker message resolves stickerId through the real catalog, body/imageUrl always null', () => {
  const result = assertValidMessagePayload({ type: 'sticker', stickerId: 'sticker_like' });
  assert.deepEqual(result, { body: null, stickerId: 'sticker_like', imageUrl: null });
});

test('a sticker message rejects an unknown stickerId (never invents a sticker from client input)', () => {
  assert.throws(() => assertValidMessagePayload({ type: 'sticker', stickerId: 'sticker_nope' }), { status: 400 });
});

// ---------------------------------------------------------------------
// assertValidMessagePayload -- image
// ---------------------------------------------------------------------

test('an image message requires a well-formed http(s) imageUrl, body/stickerId always null', () => {
  const result = assertValidMessagePayload({ type: 'image', imageUrl: 'https://cdn.example.com/x.png' });
  assert.deepEqual(result, { body: null, stickerId: null, imageUrl: 'https://cdn.example.com/x.png' });
});

test('an image message rejects a non-http(s) url', () => {
  assert.throws(() => assertValidMessagePayload({ type: 'image', imageUrl: 'ftp://cdn.example.com/x.png' }), { status: 400 });
  assert.throws(() => assertValidMessagePayload({ type: 'image', imageUrl: 'javascript:alert(1)' }), { status: 400 });
});

test('an image message rejects a missing/empty imageUrl', () => {
  assert.throws(() => assertValidMessagePayload({ type: 'image', imageUrl: '' }), { status: 400 });
  assert.throws(() => assertValidMessagePayload({ type: 'image' }), { status: 400 });
});

test('an image message rejects an imageUrl over 2000 characters', () => {
  const longUrl = 'https://cdn.example.com/' + 'x'.repeat(2000);
  assert.throws(() => assertValidMessagePayload({ type: 'image', imageUrl: longUrl }), { status: 400 });
});

// ---------------------------------------------------------------------
// assertValidMessagePayload -- unreachable fallthrough
// ---------------------------------------------------------------------

test('assertValidMessagePayload rejects an unknown type even if called directly without assertValidMessageType first', () => {
  assert.throws(() => assertValidMessagePayload({ type: 'video', body: 'x' }), { status: 400 });
});
