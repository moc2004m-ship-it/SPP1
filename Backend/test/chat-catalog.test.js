'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { STICKERS, resolveSticker } = require('../src/domain/chat-catalog');

test('resolveSticker returns the real server-side catalog entry for a known stickerId', () => {
  const sticker = resolveSticker('sticker_love');
  assert.equal(sticker.id, 'sticker_love');
  assert.equal(sticker.name, STICKERS.sticker_love.name);
  assert.equal(sticker.url, STICKERS.sticker_love.url);
});

test('resolveSticker throws 400 for an unknown stickerId', () => {
  assert.throws(() => resolveSticker('sticker_does_not_exist'), (err) => {
    assert.equal(err.status, 400);
    assert.match(err.message, /unknown stickerId/);
    return true;
  });
});

test('resolveSticker throws 400 for a missing/empty stickerId', () => {
  assert.throws(() => resolveSticker(undefined), { status: 400 });
  assert.throws(() => resolveSticker(''), { status: 400 });
});

test('every sticker entry has a real id/name/url, and the key matches the entry\'s own id', () => {
  for (const [key, sticker] of Object.entries(STICKERS)) {
    assert.equal(key, sticker.id);
    assert.ok(sticker.name && sticker.name.length > 0);
    assert.match(sticker.url, /^https?:\/\//);
  }
});

test('STICKERS is frozen (cannot be mutated by a caller), and so is each entry', () => {
  assert.throws(() => {
    STICKERS.sticker_love.name = 'hacked';
  });
  assert.throws(() => {
    STICKERS.sticker_new = { id: 'sticker_new', name: 'New', url: 'https://x' };
  });
});
