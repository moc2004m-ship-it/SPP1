'use strict';

// Stage 36 — Central Staff/Roles/Permissions (RBAC).
//
// AUDIT FINDING (see ../config/admin-staff.js and ../config/
// moderation-staff.js): this codebase grew two separate, hand-rolled
// allowlists for two separate admin surfaces (Stage 29's inventory
// grants, Stage 35's content-review queue), each a bare Set<accountId>
// with no concept of *what* an id is allowed to do beyond the one
// binary check its own file happens to implement. That does not scale
// past two surfaces -- Stage 36 needs authorization for suspend/
// unsuspend, users, rooms, economy, recharge, gifts, games, reports,
// bans, tickets, support, and analytics, and a fresh allowlist file per
// surface would mean twelve near-identical copies of the same eleven
// lines. This file replaces that pattern with one real role -> set-of-
// permissions system that every admin surface (existing and future)
// authorizes against.
//
// Design, kept deliberately as boring/explicit as the rest of this
// codebase's security code (../config/*.js, ../auth/auth.store.js):
//   - A "staff record" is just { accountId, roles: Set<string> }. There
//     is no new session/login type -- a staff member is still an
//     ordinary authenticated account (../auth/auth.store.js), just one
//     this module additionally recognizes as holding one or more roles.
//   - Roles are a fixed, closed set (ROLES below). Permissions are a
//     fixed, closed set (PERMISSIONS below). ROLE_PERMISSIONS maps each
//     role to the permissions it grants. Nothing here is client-
//     configurable -- both maps are hard-coded in this file, not read
//     from a request or a database row a client could influence.
//   - Server-only allowlist source, same "pure function of env,
//     defaults to process.env, unit testable without mutating the real
//     environment" pattern as loadReviewerIdsFromEnv()/
//     loadAdminIdsFromEnv() (../config/moderation-staff.js,
//     ../config/admin-staff.js), loadPushConfigFromEnv()
//     (../push/push-config.js) and loadAgoraConfigFromEnv()
//     (../rtc/agora-config.js): STAFF_ROLES, a comma-separated list of
//     "accountId:role1|role2" pairs, e.g.
//     "acc_1:moderator,acc_2:admin|support". Not set in this sandbox
//     (no staff exist here) -- a real deployment sets this to its actual
//     staff account ids and roles.
//
// Migration note for ../config/admin-staff.js and
// ../config/moderation-staff.js (both Stage 36 explicitly asks to
// migrate "where applicable"): those two files' own isAdmin()/
// isReviewer() functions are left in place and untouched -- they are
// already unit-tested, already wired into ../../services/
// inventory-admin.service.js and ../feature-platform.js, and nothing
// about their existing contract (a pure function over a caller-supplied
// Set) is wrong. What changes is that both call sites now ALSO accept
// central staff authorization: an account with the 'admin' role here is
// authorized for inventory grants even if it is not in
// INVENTORY_ADMIN_IDS, and an account with the 'moderator' role here is
// authorized for content review even if it is not in
// MODERATION_REVIEWER_IDS. See ../services/inventory-admin.service.js
// and ../feature-platform.js for the two call sites, both updated to
// OR the legacy allowlist check with hasPermission(...) from this file.
// This is additive/backward-compatible on purpose: a deployment that
// has only configured the legacy env vars keeps working exactly as
// before; STAFF_ROLES becomes the one place new staff are granted
// access going forward.

const ROLES = Object.freeze({
  SUPPORT: 'support',
  MODERATOR: 'moderator',
  ADMIN: 'admin',
  SUPERADMIN: 'superadmin',
});

const PERMISSIONS = Object.freeze({
  // Users / accounts
  USERS_VIEW: 'users:view',
  ACCOUNT_SUSPEND: 'account:suspend',
  ACCOUNT_UNSUSPEND: 'account:unsuspend',
  // Content / moderation
  CONTENT_REVIEW: 'content:review',
  BANS_MANAGE: 'bans:manage',
  REPORTS_VIEW: 'reports:view',
  REPORTS_RESOLVE: 'reports:resolve',
  // Commerce
  INVENTORY_GRANT: 'inventory:grant',
  ECONOMY_MANAGE: 'economy:manage',
  RECHARGE_VIEW: 'recharge:view',
  GIFTS_MANAGE: 'gifts:manage',
  GAMES_MANAGE: 'games:manage',
  ROOMS_MANAGE: 'rooms:manage',
  // Support / ops
  TICKETS_MANAGE: 'tickets:manage',
  SUPPORT_VIEW: 'support:view',
  ANALYTICS_VIEW: 'analytics:view',
  // Audit
  AUDIT_VIEW: 'audit:view',
  // Staff management itself (superadmin-only, see ROLE_PERMISSIONS)
  STAFF_MANAGE: 'staff:manage',
});

// Each role's permission set is additive and explicit -- no role
// "inherits" another's set implicitly by name comparison, so adding a
// new role later can never silently widen an existing one's access.
const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.SUPPORT]: Object.freeze([
    PERMISSIONS.USERS_VIEW,
    PERMISSIONS.TICKETS_MANAGE,
    PERMISSIONS.SUPPORT_VIEW,
    PERMISSIONS.REPORTS_VIEW,
  ]),
  [ROLES.MODERATOR]: Object.freeze([
    PERMISSIONS.USERS_VIEW,
    PERMISSIONS.CONTENT_REVIEW,
    PERMISSIONS.BANS_MANAGE,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.REPORTS_RESOLVE,
    PERMISSIONS.ACCOUNT_SUSPEND,
    PERMISSIONS.ACCOUNT_UNSUSPEND,
  ]),
  [ROLES.ADMIN]: Object.freeze([
    PERMISSIONS.USERS_VIEW,
    PERMISSIONS.ACCOUNT_SUSPEND,
    PERMISSIONS.ACCOUNT_UNSUSPEND,
    PERMISSIONS.CONTENT_REVIEW,
    PERMISSIONS.BANS_MANAGE,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.REPORTS_RESOLVE,
    PERMISSIONS.INVENTORY_GRANT,
    PERMISSIONS.ECONOMY_MANAGE,
    PERMISSIONS.RECHARGE_VIEW,
    PERMISSIONS.GIFTS_MANAGE,
    PERMISSIONS.GAMES_MANAGE,
    PERMISSIONS.ROOMS_MANAGE,
    PERMISSIONS.TICKETS_MANAGE,
    PERMISSIONS.SUPPORT_VIEW,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.AUDIT_VIEW,
  ]),
  [ROLES.SUPERADMIN]: Object.freeze(
    // Everything ADMIN has, plus staff management itself.
    Object.values(PERMISSIONS)
  ),
});

function isValidRole(role) {
  return Object.values(ROLES).includes(role);
}

// Parses STAFF_ROLES ("acc_1:moderator,acc_2:admin|support") into
// Map<accountId, Set<role>>. Unknown roles and malformed entries are
// dropped (logged by the caller if it wants), never thrown on startup --
// a typo in one entry should not take down every other, already-correct
// entry, same "fail soft on config, never trust it either" posture as
// ../config/moderation-staff.js.
function loadStaffFromEnv(env = process.env) {
  const raw = (env.STAFF_ROLES || '').trim();
  const staff = new Map();
  if (!raw) return staff;

  for (const entry of raw.split(',')) {
    const trimmedEntry = entry.trim();
    if (!trimmedEntry) continue;
    const separatorIndex = trimmedEntry.indexOf(':');
    if (separatorIndex === -1) continue;

    const accountId = trimmedEntry.slice(0, separatorIndex).trim();
    const rolesPart = trimmedEntry.slice(separatorIndex + 1).trim();
    if (!accountId || !rolesPart) continue;

    const roles = rolesPart
      .split('|')
      .map((r) => r.trim())
      .filter(isValidRole);
    if (roles.length === 0) continue;

    const existing = staff.get(accountId) || new Set();
    for (const role of roles) existing.add(role);
    staff.set(accountId, existing);
  }

  return staff;
}

// Pure check, never trusts anything from a request -- `staff` is always
// the server-loaded Map above (or a test-injected Map), never a client-
// supplied role/permission field.
function getRoles(staff, accountId) {
  if (!accountId || !(staff instanceof Map)) return new Set();
  return staff.get(accountId) || new Set();
}

function hasRole(staff, accountId, role) {
  return getRoles(staff, accountId).has(role);
}

function getPermissions(staff, accountId) {
  const roles = getRoles(staff, accountId);
  const permissions = new Set();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] || []) {
      permissions.add(permission);
    }
  }
  return permissions;
}

function hasPermission(staff, accountId, permission) {
  return getPermissions(staff, accountId).has(permission);
}

// Throws the same shape of error every other authorization check in this
// codebase throws (see accountNotFound()-style helpers in the
// repositories) -- a 403 with no extra detail about which permission was
// missing, so a rejected caller learns nothing more from a well-formed
// request than a malformed one (same principle
// ../services/inventory-admin.service.js's grant() already documents).
function requirePermission(staff, accountId, permission) {
  if (!hasPermission(staff, accountId, permission)) {
    throw Object.assign(new Error('forbidden'), { status: 403 });
  }
}

module.exports = {
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  loadStaffFromEnv,
  getRoles,
  hasRole,
  getPermissions,
  hasPermission,
  requirePermission,
};
