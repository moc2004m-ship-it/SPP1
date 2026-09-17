'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountAdminService } = require('../src/services/account-admin.service');
const { InMemoryAccountRepository } = require('../src/database/repositories/account.repository');
const { InMemoryAuditLogRepository } = require('../src/database/repositories/audit-log.repository');
const { createAuditService } = require('../src/services/audit.service');
const { ROLES } = require('../src/security/staff');

function setup() {
  const accounts = new InMemoryAccountRepository();
  const auditLog = new InMemoryAuditLogRepository();
  const auditService = createAuditService({ auditLog, staffRoles: new Map() });
  return { accounts, auditLog, auditService };
}

test('suspend() rejects a caller with no staff role at all', async () => {
  const { accounts, auditService } = setup();
  const account = await accounts.create();
  const staffRoles = new Map(); // nobody has any role
  const service = createAccountAdminService({ accounts, staffRoles, auditService });

  await assert.rejects(
    () => service.suspend({ actorId: 'plain_user', accountId: account.id, reason: 'fraud' }),
    (err) => err.status === 403
  );
});

test('suspend() rejects a "support" role -- support does not hold account:suspend', async () => {
  const { accounts, auditService } = setup();
  const account = await accounts.create();
  const staffRoles = new Map([['staff_1', new Set([ROLES.SUPPORT])]]);
  const service = createAccountAdminService({ accounts, staffRoles, auditService });

  await assert.rejects(
    () => service.suspend({ actorId: 'staff_1', accountId: account.id, reason: 'fraud' }),
    (err) => err.status === 403
  );
});

test('suspend() succeeds for a "moderator" role, and records an audit entry', async () => {
  const { accounts, auditLog, auditService } = setup();
  const account = await accounts.create();
  const staffRoles = new Map([['staff_1', new Set([ROLES.MODERATOR])]]);
  const service = createAccountAdminService({ accounts, staffRoles, auditService });

  const result = await service.suspend({ actorId: 'staff_1', accountId: account.id, reason: 'fraud investigation' });
  assert.equal(result.suspendedReason, 'fraud investigation');
  assert.equal(result.suspendedBy, 'staff_1');

  const entries = await auditLog.list({});
  assert.equal(entries.length, 1);
  assert.equal(entries[0].action, 'account:suspend');
  assert.equal(entries[0].actorId, 'staff_1');
  assert.equal(entries[0].targetType, 'account');
  assert.equal(entries[0].targetId, account.id);
  assert.equal(entries[0].reason, 'fraud investigation');
});

test('suspend() rejects a missing/empty reason with 400, BEFORE it ever reaches the repository', async () => {
  const { accounts, auditLog, auditService } = setup();
  const account = await accounts.create();
  const staffRoles = new Map([['staff_1', new Set([ROLES.ADMIN])]]);
  const service = createAccountAdminService({ accounts, staffRoles, auditService });

  await assert.rejects(
    () => service.suspend({ actorId: 'staff_1', accountId: account.id, reason: '' }),
    (err) => err.status === 400
  );
  // No audit entry should exist for a call that never actually suspended anything.
  assert.equal((await auditLog.list({})).length, 0);
});

test('unsuspend() rejects a caller without account:unsuspend', async () => {
  const { accounts, auditService } = setup();
  const account = await accounts.create();
  const staffRoles = new Map([['staff_1', new Set([ROLES.SUPPORT])]]);
  const service = createAccountAdminService({ accounts, staffRoles, auditService });

  await assert.rejects(
    () => service.unsuspend({ actorId: 'staff_1', accountId: account.id }),
    (err) => err.status === 403
  );
});

test('unsuspend() succeeds for an "admin" role, clears suspension, and records an audit entry', async () => {
  const { accounts, auditLog, auditService } = setup();
  const account = await accounts.create();
  const staffRoles = new Map([['staff_1', new Set([ROLES.ADMIN])]]);
  const service = createAccountAdminService({ accounts, staffRoles, auditService });

  await service.suspend({ actorId: 'staff_1', accountId: account.id, reason: 'fraud' });
  const result = await service.unsuspend({ actorId: 'staff_1', accountId: account.id });
  assert.equal(result.suspendedAt, null);

  const entries = await auditLog.list({});
  assert.equal(entries.length, 2); // suspend then unsuspend
  assert.equal(entries[0].action, 'account:unsuspend'); // newest first
});

test('listSuspended() requires users:view and returns the current suspended set', async () => {
  const { accounts, auditService } = setup();
  const a = await accounts.create();
  const b = await accounts.create();
  const staffRoles = new Map([
    ['staff_1', new Set([ROLES.MODERATOR])], // has users:view (via moderator)
    ['no_role', new Set()],
  ]);
  const service = createAccountAdminService({ accounts, staffRoles, auditService });

  await service.suspend({ actorId: 'staff_1', accountId: a.id, reason: 'x' });

  await assert.rejects(
    () => service.listSuspended({ actorId: 'no_role' }),
    (err) => err.status === 403
  );

  const list = await service.listSuspended({ actorId: 'staff_1' });
  assert.equal(list.length, 1);
  assert.equal(list[0].id, a.id);
  // b was never suspended.
  assert.ok(!list.some((acc) => acc.id === b.id));
});

test('suspend() rejects an unknown target account with 404, after authorization has already passed', async () => {
  const { accounts, auditService } = setup();
  const staffRoles = new Map([['staff_1', new Set([ROLES.ADMIN])]]);
  const service = createAccountAdminService({ accounts, staffRoles, auditService });

  await assert.rejects(
    () => service.suspend({ actorId: 'staff_1', accountId: 'usr_does_not_exist', reason: 'x' }),
    (err) => err.status === 404
  );
});
