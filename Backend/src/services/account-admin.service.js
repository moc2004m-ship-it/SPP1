'use strict';

// Stage 36 — Admin account suspend/unsuspend/list. Same shape as
// ../services/inventory-admin.service.js (Stage 29's admin grant path):
// this is the one real, trusted server-side path that reaches
// ../database/repositories/account.repository.js's suspend()/
// unsuspend()/listSuspended(), gated on
// ../security/staff.js's central Staff/RBAC permissions instead of a
// single-purpose allowlist, and every action is recorded to the central
// Audit Log (../services/audit.service.js) as its last step.
//
// Authorization: `actorId` (always req.session.accountId at the route
// layer -- never a client-supplied field, same rule as every other actor
// in this codebase) must hold the 'account:suspend' (to suspend) or
// 'account:unsuspend' (to unsuspend) permission per
// ../security/staff.js. 'account:suspend'/'account:unsuspend' are both
// granted to the moderator/admin/superadmin roles (see staff.js's
// ROLE_PERMISSIONS) -- a plain authenticated account, including the
// target account itself, is never enough on its own.
//
// Checked FIRST, before any input validation, same "a rejected caller
// learns nothing more from a malformed request than a well-formed one"
// principle ../services/inventory-admin.service.js already documents.

const { hasPermission, PERMISSIONS } = require('../security/staff');

function requireString(value, name, maxLen) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLen) {
    throw Object.assign(new Error(`${name} must be a non-empty string up to ${maxLen} characters`), { status: 400 });
  }
  return value.trim();
}

function createAccountAdminService({ accounts, staffRoles, auditService }) {
  async function suspend({ actorId, accountId, reason }) {
    if (!hasPermission(staffRoles, actorId, PERMISSIONS.ACCOUNT_SUSPEND)) {
      throw Object.assign(new Error('account:suspend permission required'), { status: 403 });
    }
    const targetAccountId = requireString(accountId, 'accountId', 200);
    const trimmedReason = requireString(reason, 'reason', 2000);

    const updated = await accounts.suspend(targetAccountId, { reason: trimmedReason, actorId });

    await auditService.record({
      actorId,
      action: 'account:suspend',
      targetType: 'account',
      targetId: targetAccountId,
      reason: trimmedReason,
    });

    return updated;
  }

  async function unsuspend({ actorId, accountId }) {
    if (!hasPermission(staffRoles, actorId, PERMISSIONS.ACCOUNT_UNSUSPEND)) {
      throw Object.assign(new Error('account:unsuspend permission required'), { status: 403 });
    }
    const targetAccountId = requireString(accountId, 'accountId', 200);

    const updated = await accounts.unsuspend(targetAccountId, { actorId });

    await auditService.record({
      actorId,
      action: 'account:unsuspend',
      targetType: 'account',
      targetId: targetAccountId,
    });

    return updated;
  }

  // Read-only listing for the Stage 36 admin panel's Users/Bans surface.
  // Requires 'users:view' -- narrower than suspend/unsuspend themselves,
  // since browsing the suspended list is a read, not a state change (see
  // ../security/staff.js's ROLE_PERMISSIONS: support/moderator/admin all
  // hold USERS_VIEW).
  async function listSuspended({ actorId }) {
    if (!hasPermission(staffRoles, actorId, PERMISSIONS.USERS_VIEW)) {
      throw Object.assign(new Error('users:view permission required'), { status: 403 });
    }
    return accounts.listSuspended();
  }

  return { suspend, unsuspend, listSuspended };
}

module.exports = { createAccountAdminService };
