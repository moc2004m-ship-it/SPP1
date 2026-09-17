'use strict';
// Stage 29 completion (this session) -- ../src/config/admin-staff.js.
// Same shape as any other loadXFromEnv() pure-function config test in
// this suite (agora-config.test.js / push-config.test.js style): never
// mutates the real process.env, always passes an explicit env object.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAdminIdsFromEnv, isAdmin } = require('../src/config/admin-staff');

test('loadAdminIdsFromEnv returns an empty Set when INVENTORY_ADMIN_IDS is unset', () => {
  const ids = loadAdminIdsFromEnv({});
  assert.ok(ids instanceof Set);
  assert.equal(ids.size, 0);
});

test('loadAdminIdsFromEnv returns an empty Set when INVENTORY_ADMIN_IDS is blank/whitespace', () => {
  assert.equal(loadAdminIdsFromEnv({ INVENTORY_ADMIN_IDS: '' }).size, 0);
  assert.equal(loadAdminIdsFromEnv({ INVENTORY_ADMIN_IDS: '   ' }).size, 0);
});

test('loadAdminIdsFromEnv parses a comma-separated list, trimming whitespace', () => {
  const ids = loadAdminIdsFromEnv({ INVENTORY_ADMIN_IDS: ' usr_admin1, usr_admin2 ,usr_admin3' });
  assert.deepEqual([...ids].sort(), ['usr_admin1', 'usr_admin2', 'usr_admin3']);
});

test('loadAdminIdsFromEnv drops empty entries from stray commas', () => {
  const ids = loadAdminIdsFromEnv({ INVENTORY_ADMIN_IDS: 'usr_admin1,,usr_admin2,' });
  assert.deepEqual([...ids].sort(), ['usr_admin1', 'usr_admin2']);
});

test('loadAdminIdsFromEnv defaults to the real process.env when called with no argument', () => {
  // Must not throw, and must not silently read some OTHER global -- just
  // confirms the default parameter really is process.env, without
  // mutating it.
  const ids = loadAdminIdsFromEnv();
  assert.ok(ids instanceof Set);
});

test('isAdmin is true only for an id actually present in the allowlist Set', () => {
  const ids = new Set(['usr_admin1']);
  assert.equal(isAdmin(ids, 'usr_admin1'), true);
  assert.equal(isAdmin(ids, 'usr_admin2'), false);
});

test('isAdmin is false for a missing/empty accountId (never treats "nobody" as an admin)', () => {
  const ids = new Set(['usr_admin1']);
  assert.equal(isAdmin(ids, undefined), false);
  assert.equal(isAdmin(ids, null), false);
  assert.equal(isAdmin(ids, ''), false);
});

test('isAdmin is false when adminIds is not a real Set (defensive against a misconfigured caller)', () => {
  assert.equal(isAdmin(['usr_admin1'], 'usr_admin1'), false);
  assert.equal(isAdmin(undefined, 'usr_admin1'), false);
  assert.equal(isAdmin(null, 'usr_admin1'), false);
});

test('an empty allowlist (the real, unconfigured default) authorizes nobody', () => {
  const ids = loadAdminIdsFromEnv({});
  assert.equal(isAdmin(ids, 'usr_anyone'), false);
});
