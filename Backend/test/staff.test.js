'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ROLES,
  PERMISSIONS,
  loadStaffFromEnv,
  getRoles,
  hasRole,
  getPermissions,
  hasPermission,
  requirePermission,
} = require('../src/security/staff');

test('loadStaffFromEnv() returns an empty Map when STAFF_ROLES is unset', () => {
  const staff = loadStaffFromEnv({});
  assert.ok(staff instanceof Map);
  assert.equal(staff.size, 0);
});

test('loadStaffFromEnv() parses a single accountId:role pair', () => {
  const staff = loadStaffFromEnv({ STAFF_ROLES: 'acc_1:admin' });
  assert.deepEqual([...getRoles(staff, 'acc_1')], ['admin']);
});

test('loadStaffFromEnv() parses multiple roles for one account, pipe-separated', () => {
  const staff = loadStaffFromEnv({ STAFF_ROLES: 'acc_1:moderator|support' });
  const roles = getRoles(staff, 'acc_1');
  assert.equal(roles.size, 2);
  assert.ok(roles.has('moderator'));
  assert.ok(roles.has('support'));
});

test('loadStaffFromEnv() parses multiple accounts, comma-separated', () => {
  const staff = loadStaffFromEnv({ STAFF_ROLES: 'acc_1:admin,acc_2:support' });
  assert.ok(hasRole(staff, 'acc_1', 'admin'));
  assert.ok(hasRole(staff, 'acc_2', 'support'));
  assert.ok(!hasRole(staff, 'acc_2', 'admin'));
});

test('loadStaffFromEnv() drops unknown roles instead of throwing', () => {
  const staff = loadStaffFromEnv({ STAFF_ROLES: 'acc_1:not_a_real_role' });
  assert.equal(staff.size, 0);
});

test('loadStaffFromEnv() drops a malformed entry but keeps the rest', () => {
  const staff = loadStaffFromEnv({ STAFF_ROLES: 'malformed_no_colon,acc_2:admin' });
  assert.ok(hasRole(staff, 'acc_2', 'admin'));
  assert.equal(getRoles(staff, 'malformed_no_colon').size, 0);
});

test('loadStaffFromEnv() trims whitespace around ids and roles', () => {
  const staff = loadStaffFromEnv({ STAFF_ROLES: ' acc_1 : admin , acc_2 : support ' });
  assert.ok(hasRole(staff, 'acc_1', 'admin'));
  assert.ok(hasRole(staff, 'acc_2', 'support'));
});

test('getRoles() returns an empty Set for an unknown account or non-Map staff', () => {
  const staff = loadStaffFromEnv({ STAFF_ROLES: 'acc_1:admin' });
  assert.equal(getRoles(staff, 'acc_unknown').size, 0);
  assert.equal(getRoles(null, 'acc_1').size, 0);
  assert.equal(getRoles(undefined, 'acc_1').size, 0);
});

test('support role grants exactly its documented permissions, nothing more', () => {
  const staff = new Map([['acc_1', new Set([ROLES.SUPPORT])]]);
  assert.ok(hasPermission(staff, 'acc_1', PERMISSIONS.TICKETS_MANAGE));
  assert.ok(hasPermission(staff, 'acc_1', PERMISSIONS.SUPPORT_VIEW));
  assert.ok(hasPermission(staff, 'acc_1', PERMISSIONS.USERS_VIEW));
  // Support must NOT be able to suspend accounts or grant inventory.
  assert.ok(!hasPermission(staff, 'acc_1', PERMISSIONS.ACCOUNT_SUSPEND));
  assert.ok(!hasPermission(staff, 'acc_1', PERMISSIONS.INVENTORY_GRANT));
  assert.ok(!hasPermission(staff, 'acc_1', PERMISSIONS.STAFF_MANAGE));
});

test('moderator role can suspend/unsuspend accounts and review content, but cannot grant inventory or manage staff', () => {
  const staff = new Map([['acc_1', new Set([ROLES.MODERATOR])]]);
  assert.ok(hasPermission(staff, 'acc_1', PERMISSIONS.ACCOUNT_SUSPEND));
  assert.ok(hasPermission(staff, 'acc_1', PERMISSIONS.ACCOUNT_UNSUSPEND));
  assert.ok(hasPermission(staff, 'acc_1', PERMISSIONS.CONTENT_REVIEW));
  assert.ok(hasPermission(staff, 'acc_1', PERMISSIONS.BANS_MANAGE));
  assert.ok(!hasPermission(staff, 'acc_1', PERMISSIONS.INVENTORY_GRANT));
  assert.ok(!hasPermission(staff, 'acc_1', PERMISSIONS.ECONOMY_MANAGE));
  assert.ok(!hasPermission(staff, 'acc_1', PERMISSIONS.STAFF_MANAGE));
});

test('admin role holds every operational permission except staff:manage', () => {
  const staff = new Map([['acc_1', new Set([ROLES.ADMIN])]]);
  for (const permission of Object.values(PERMISSIONS)) {
    if (permission === PERMISSIONS.STAFF_MANAGE) continue;
    assert.ok(hasPermission(staff, 'acc_1', permission), `admin should have ${permission}`);
  }
  assert.ok(!hasPermission(staff, 'acc_1', PERMISSIONS.STAFF_MANAGE));
});

test('superadmin role holds every permission, including staff:manage', () => {
  const staff = new Map([['acc_1', new Set([ROLES.SUPERADMIN])]]);
  for (const permission of Object.values(PERMISSIONS)) {
    assert.ok(hasPermission(staff, 'acc_1', permission), `superadmin should have ${permission}`);
  }
});

test('an account with multiple roles gets the union of their permissions', () => {
  const staff = new Map([['acc_1', new Set([ROLES.SUPPORT, ROLES.MODERATOR])]]);
  const permissions = getPermissions(staff, 'acc_1');
  assert.ok(permissions.has(PERMISSIONS.TICKETS_MANAGE)); // from support
  assert.ok(permissions.has(PERMISSIONS.ACCOUNT_SUSPEND)); // from moderator
});

test('hasPermission() is false for an account with no roles at all', () => {
  const staff = new Map();
  assert.ok(!hasPermission(staff, 'acc_1', PERMISSIONS.USERS_VIEW));
});

test('hasPermission() never trusts a falsy/empty accountId', () => {
  const staff = new Map([['', new Set([ROLES.SUPERADMIN])]]);
  assert.ok(!hasPermission(staff, '', PERMISSIONS.USERS_VIEW));
  assert.ok(!hasPermission(staff, undefined, PERMISSIONS.USERS_VIEW));
  assert.ok(!hasPermission(staff, null, PERMISSIONS.USERS_VIEW));
});

test('requirePermission() throws a 403 with no extra detail when the permission is missing', () => {
  const staff = new Map([['acc_1', new Set([ROLES.SUPPORT])]]);
  assert.throws(
    () => requirePermission(staff, 'acc_1', PERMISSIONS.STAFF_MANAGE),
    (err) => err.status === 403 && err.message === 'forbidden'
  );
});

test('requirePermission() does not throw when the permission is present', () => {
  const staff = new Map([['acc_1', new Set([ROLES.ADMIN])]]);
  assert.doesNotThrow(() => requirePermission(staff, 'acc_1', PERMISSIONS.USERS_VIEW));
});

test('ROLE_PERMISSIONS covers every declared ROLES entry', () => {
  const { ROLE_PERMISSIONS } = require('../src/security/staff');
  for (const role of Object.values(ROLES)) {
    assert.ok(Array.isArray(ROLE_PERMISSIONS[role]), `missing ROLE_PERMISSIONS for ${role}`);
    assert.ok(ROLE_PERMISSIONS[role].length > 0, `${role} grants zero permissions`);
  }
});
