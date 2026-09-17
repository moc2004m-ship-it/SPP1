'use strict';
// Stage 12 — Create Room: security/room-password.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { hashRoomPassword, verifyRoomPassword } = require('../src/security/room-password');

test('hashRoomPassword(): returns a "salt:hash" hex string, never the plaintext', () => {
  const stored = hashRoomPassword('correct-horse');
  assert.match(stored, /^[0-9a-f]+:[0-9a-f]+$/);
  assert.equal(stored.includes('correct-horse'), false);
});

test('hashRoomPassword(): the same password hashed twice produces two different stored values (random per-call salt)', () => {
  const a = hashRoomPassword('same-password');
  const b = hashRoomPassword('same-password');
  assert.notEqual(a, b);
});

test('verifyRoomPassword(): the correct password against its own hash verifies true', () => {
  const stored = hashRoomPassword('correct-horse');
  assert.equal(verifyRoomPassword('correct-horse', stored), true);
});

test('verifyRoomPassword(): a wrong password verifies false', () => {
  const stored = hashRoomPassword('correct-horse');
  assert.equal(verifyRoomPassword('wrong-password', stored), false);
});

test('verifyRoomPassword(): is case-sensitive and does not trim whitespace', () => {
  const stored = hashRoomPassword('Secret1');
  assert.equal(verifyRoomPassword('secret1', stored), false);
  assert.equal(verifyRoomPassword('Secret1 ', stored), false);
});

test('verifyRoomPassword(): never throws on malformed/corrupt stored input -- reports false instead of crashing the caller', () => {
  assert.equal(verifyRoomPassword('anything', 'not-a-valid-stored-hash'), false);
  assert.equal(verifyRoomPassword('anything', ''), false);
  assert.equal(verifyRoomPassword('anything', 'nosep'), false);
  assert.equal(verifyRoomPassword('anything', ':'), false);
  assert.equal(verifyRoomPassword('anything', 'zz:zz'), false);
  assert.equal(verifyRoomPassword('anything', null), false);
  assert.equal(verifyRoomPassword('anything', undefined), false);
});

test('verifyRoomPassword(): a non-string password (e.g. from a malformed request body) is rejected, not coerced', () => {
  const stored = hashRoomPassword('correct-horse');
  assert.equal(verifyRoomPassword(12345, stored), false);
  assert.equal(verifyRoomPassword(null, stored), false);
  assert.equal(verifyRoomPassword(undefined, stored), false);
});
