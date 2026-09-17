// Stage 29 completion (this session) -- Admin inventory grant service.
//
// This is the one real, trusted server-side path POST /api/inventory/grant
// promised (see ../routes/platform.routes.js's header comment above that
// route) but never actually had: before this pass the route unconditionally
// returned 403 "not yet implemented" for every caller, admin or not.
//
// Authorization: `actorId` (always req.session.accountId at the route --
// see platform.routes.js -- never a client-supplied field) must be in the
// real, server-only INVENTORY_ADMIN_IDS allowlist (../config/admin-staff.js,
// same pattern Stage 35 Part 6 already uses for content-review reviewers).
// A normal authenticated account -- including the account being granted
// to -- is never enough on its own; this is the same "server-side/admin
// path" gate the route's own prior comment already promised, now actually
// enforced instead of a blanket 403.
//
// Traceability: every grant gets a fresh, server-generated referenceId
// (generateAdminGrantId(), never a client-supplied id) used as the
// inventory.grant() `referenceId` with source 'admin' -- the "source
// transaction" every grant in this codebase is required to have, same
// role store.service.js's purchaseId plays for store_purchase grants and
// gifts.service.js's giftId plays for gift grants. Because
// inventory.grant() is idempotent on (referenceId, itemId), a genuine
// retry of the exact same admin action (dropped response, client retry)
// can never double-grant.
'use strict';

const { isAdmin } = require('../config/admin-staff');
// Stage 36 -- central Staff/Roles/Permissions system. Additive/OR'd with
// the legacy INVENTORY_ADMIN_IDS allowlist below, not a replacement --
// see ../security/staff.js's header for the full migration note.
const { hasPermission, PERMISSIONS } = require('../security/staff');
const { generateAdminGrantId, assertValidItemId, assertValidQuantity } = require('../database/models/inventory.model');

function requireString(value, name, maxLen) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLen) {
    throw Object.assign(new Error(`${name} must be a non-empty string up to ${maxLen} characters`), { status: 400 });
  }
  return value.trim();
}

function createInventoryAdminService({ inventory, adminIds, staffRoles, auditService }) {
  async function grant({ actorId, accountId, itemId, quantity }) {
    // Checked FIRST, before any input validation below -- a non-admin
    // caller (this includes a normal user trying to grant themselves
    // items) learns nothing about why a malformed request would also
    // have failed; they just get the same 403 every unauthorized caller
    // of an admin-only action gets.
    //
    // Stage 36 -- OR the legacy allowlist with the central Staff/RBAC
    // system: an account with the 'admin'/'superadmin' role in
    // `staffRoles` is authorized even if it was never added to
    // INVENTORY_ADMIN_IDS. See ../security/staff.js's header.
    if (!isAdmin(adminIds, actorId) && !hasPermission(staffRoles, actorId, PERMISSIONS.INVENTORY_GRANT)) {
      throw Object.assign(new Error('admin authorization required to grant inventory'), { status: 403 });
    }
    const targetAccountId = requireString(accountId, 'accountId', 200);
    // itemId/quantity are re-validated here too (not just inside
    // inventory.grant()) purely so a bad request 400s with a clear
    // message before a referenceId is even generated -- inventory.grant()
    // still re-validates independently, same defense-in-depth as every
    // other service in this file.
    assertValidItemId(itemId);
    assertValidQuantity(quantity);

    const referenceId = generateAdminGrantId();
    const grantedItem = await inventory.grant(targetAccountId, itemId, quantity, 'admin', referenceId);

    if (auditService) await auditService.record({ actorId, action: 'inventory:grant', targetType: 'account', targetId: targetAccountId, metadata: { itemId, quantity, referenceId } });

    return {
      referenceId,
      grantedBy: actorId,
      accountId: targetAccountId,
      itemId: grantedItem.itemId,
      quantity: grantedItem.quantity,
      inventoryItem: grantedItem,
    };
  }

  return { grant };
}

module.exports = { createInventoryAdminService };
