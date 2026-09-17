'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateReferralCode, generateReferralId, assertNotSelfReferral, CODE_LENGTH, REFERRAL_REWARD_COINS } = require('../src/database/models/referral.model');

test('generateReferralCode() returns a code of the documented length', () => {
  const code = generateReferralCode();
  assert.equal(code.length, CODE_LENGTH);
});

test('generateReferralCode() never contains ambiguous characters (0/O/1/I)', () => {
  for (let i = 0; i < 200; i++) {
    const code = generateReferralCode();
    assert.doesNotMatch(code, /[01OI]/);
  }
});

test('generateReferralCode() calls are not all identical (real randomness, not a fixed string)', () => {
  const codes = new Set();
  for (let i = 0; i < 50; i++) codes.add(generateReferralCode());
  assert.ok(codes.size > 40); // extremely unlikely to collide this much by chance
});

test('generateReferralId() is prefixed as requested', () => {
  const id = generateReferralId('ref');
  assert.match(id, /^ref_/);
});

test('assertNotSelfReferral() throws a 400 when referrer and referee are the same account', () => {
  assert.throws(
    () => assertNotSelfReferral('usr_1', 'usr_1'),
    (err) => { assert.equal(err.status, 400); return true; }
  );
});

test('assertNotSelfReferral() does not throw for two different accounts', () => {
  assert.doesNotThrow(() => assertNotSelfReferral('usr_1', 'usr_2'));
});

test('REFERRAL_REWARD_COINS is a positive integer (sane value, not a placeholder)', () => {
  assert.ok(Number.isInteger(REFERRAL_REWARD_COINS));
  assert.ok(REFERRAL_REWARD_COINS > 0);
});
