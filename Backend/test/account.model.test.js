const test = require('node:test');
const assert = require('node:assert/strict');

const { createAccount, SERVER_OWNED_FIELDS } = require('../src/database/models/account.model');
const { isUserId } = require('../src/database/id-generator');

test('createAccount sets all Stage 3 defaults to 0', () => {
  const account = createAccount();
  assert.equal(account.vip, 0);
  assert.equal(account.svip, 0);
  assert.equal(account.lvl, 0);
  assert.equal(account.coins, 0);
  assert.equal(account.diamonds, 0);
});

test('createAccount sets Stage 27/28 defaults to 0 (xp, lifetimeDiamondsRecharged)', () => {
  const account = createAccount();
  assert.equal(account.xp, 0);
  assert.equal(account.lifetimeDiamondsRecharged, 0);
});

test('createAccount generates a server-side user id', () => {
  const account = createAccount();
  assert.ok(isUserId(account.id));
});

test('createAccount takes no client input and cannot be influenced by one', () => {
  // createAccount() has no parameters at all — this proves that even if
  // a caller tries to pass something in, it is simply not read.
  const malicious = { id: 'attacker-chosen-id', vip: 999, coins: 999999 };
  const account = createAccount(malicious);
  assert.notEqual(account.id, malicious.id);
  assert.equal(account.vip, 0);
  assert.equal(account.coins, 0);
});

test('createAccount returns a frozen (immutable) object', () => {
  const account = createAccount();
  assert.throws(() => {
    'use strict';
    account.coins = 100;
  });
});

test('SERVER_OWNED_FIELDS lists every sensitive field', () => {
  for (const field of ['id', 'vip', 'svip', 'lvl', 'xp', 'coins', 'diamonds', 'lifetimeDiamondsRecharged']) {
    assert.ok(SERVER_OWNED_FIELDS.includes(field), `expected ${field} in SERVER_OWNED_FIELDS`);
  }
});

// --- Stage 34 — deletedAt -----------------------------------------

test('createAccount defaults deletedAt to null (not deleted)', () => {
  const account = createAccount();
  assert.equal(account.deletedAt, null);
});

test('deletedAt is a real server-owned field, not client-settable', () => {
  assert.ok(SERVER_OWNED_FIELDS.includes('deletedAt'));
});
