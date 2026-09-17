'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateRechargeOrderId,
  PACKAGES,
  PROVIDERS,
  listPackages,
  resolvePackage,
  assertValidProvider,
  assertValidPurchaseRef,
} = require('../src/database/models/recharge.model');

// GAP CLOSED (found on inspection while verifying Stage 25): every other
// domain in this project has a dedicated `*.model.test.js` (see
// account.model.test.js, chat.model.test.js, referral.model.test.js,
// room.model.test.js) -- recharge.model.js had none. Its exports were only
// ever exercised indirectly through recharge.service.test.js and
// platform.recharge.stage25.routes-contract.test.js. This file tests the
// model's own exported functions directly, same convention as the other
// domains.

test('generateRechargeOrderId() is prefixed as documented', () => {
  const id = generateRechargeOrderId();
  assert.match(id, /^rchg_/);
});

test('generateRechargeOrderId() calls are not all identical (real randomness, not a fixed string)', () => {
  const ids = new Set();
  for (let i = 0; i < 50; i++) ids.add(generateRechargeOrderId());
  assert.equal(ids.size, 50, 'every generated id must be unique');
});

test('listPackages() returns every package in PACKAGES, sorted ascending by coins', () => {
  const list = listPackages();
  assert.equal(list.length, Object.keys(PACKAGES).length);
  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i].coins >= list[i - 1].coins, 'must be sorted ascending by coins');
  }
  const ids = list.map((p) => p.id).sort();
  assert.deepEqual(ids, Object.keys(PACKAGES).sort());
});

test('listPackages() returns plain, mutation-safe copies (not the frozen PACKAGES objects themselves)', () => {
  const list = listPackages();
  assert.doesNotThrow(() => {
    list[0].coins = 999999; // mutating the returned copy must not throw and must not touch PACKAGES
  });
  assert.notEqual(PACKAGES[list[0].id].coins, 999999, 'the server-owned catalog itself must remain untouched');
});

test('listPackages() exposes only id + coins, no invented fields', () => {
  for (const pkg of listPackages()) {
    assert.deepEqual(Object.keys(pkg).sort(), ['coins', 'id']);
  }
});

test('resolvePackage() returns the real catalog entry for a known packageId', () => {
  const pkg = resolvePackage('pkg_small');
  assert.equal(pkg.id, 'pkg_small');
  assert.equal(pkg.coins, PACKAGES.pkg_small.coins);
});

test('resolvePackage() throws 400 on an unknown packageId (never trusts a client-supplied coin amount)', () => {
  assert.throws(
    () => resolvePackage('pkg_totally_made_up'),
    (err) => { assert.equal(err.status, 400); return true; }
  );
});

test('resolvePackage() throws 400 on undefined/empty packageId', () => {
  assert.throws(() => resolvePackage(undefined), (err) => err.status === 400);
  assert.throws(() => resolvePackage(''), (err) => err.status === 400);
});

test('PROVIDERS lists exactly the providers assertValidProvider accepts', () => {
  for (const p of PROVIDERS) {
    assert.doesNotThrow(() => assertValidProvider(p));
  }
});

test('assertValidProvider() throws 400 on an unknown provider', () => {
  assert.throws(
    () => assertValidProvider('bitcoin'),
    (err) => { assert.equal(err.status, 400); return true; }
  );
});

test('assertValidProvider() throws 400 on undefined provider', () => {
  assert.throws(() => assertValidProvider(undefined), (err) => err.status === 400);
});

test('assertValidPurchaseRef() accepts a real non-empty string', () => {
  assert.doesNotThrow(() => assertValidPurchaseRef('real-purchase-token-abc123'));
});

test('assertValidPurchaseRef() rejects undefined/null/empty/whitespace-only', () => {
  for (const bad of [undefined, null, '', '   ']) {
    assert.throws(() => assertValidPurchaseRef(bad), (err) => err.status === 400, `expected 400 for ${JSON.stringify(bad)}`);
  }
});

test('assertValidPurchaseRef() rejects a non-string value', () => {
  assert.throws(() => assertValidPurchaseRef(12345), (err) => err.status === 400);
  assert.throws(() => assertValidPurchaseRef({ token: 'x' }), (err) => err.status === 400);
});

test('assertValidPurchaseRef() rejects a ref longer than 4000 characters', () => {
  const tooLong = 'a'.repeat(4001);
  assert.throws(() => assertValidPurchaseRef(tooLong), (err) => err.status === 400);
});

test('assertValidPurchaseRef() accepts a ref at exactly the 4000 character boundary', () => {
  const atBoundary = 'a'.repeat(4000);
  assert.doesNotThrow(() => assertValidPurchaseRef(atBoundary));
});
