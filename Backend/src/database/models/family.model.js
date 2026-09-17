// Stage 30 — Family model.
//
// Same boundary as every other model in this project (gift.model.js,
// inventory.model.js, store.model.js): nothing here accepts a
// client-supplied id, role, or status. Ids are always generated here.
// Role/status values are always chosen by family.service.js from the
// fixed enums below, NEVER copied from req.body — a client can send
// `role: "owner"` in a request body and it must be silently ignored by
// every route handler (see platform.routes.js's Stage 30 section).

const crypto = require('node:crypto');

function generateFamilyId() {
  return `fam_${crypto.randomUUID()}`;
}

function generateMembershipId() {
  return `fmem_${crypto.randomUUID()}`;
}

function generateInviteId() {
  return `finv_${crypto.randomUUID()}`;
}

function generateDonationId() {
  return `fdon_${crypto.randomUUID()}`;
}

// Role hierarchy, lowest to highest. Rank comparisons (e.g. "can an admin
// kick another admin?") always go through roleRank() below rather than
// comparing strings, so the ordering lives in exactly one place.
const ROLES = Object.freeze(['member', 'admin', 'owner']);

const MEMBERSHIP_STATUSES = Object.freeze(['active', 'left', 'kicked', 'banned']);

const INVITE_STATUSES = Object.freeze(['pending', 'accepted', 'declined', 'revoked']);

function assertValidFamilyName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 100) {
    throw Object.assign(new Error('name must be a non-empty string up to 100 characters'), { status: 400 });
  }
}

function assertValidRole(role) {
  if (!ROLES.includes(role)) {
    throw Object.assign(new Error(`role must be one of ${ROLES.join(', ')}`), { status: 400 });
  }
}

// Higher number = higher privilege. Used to enforce "you cannot act on
// someone at or above your own rank" (e.g. an admin may kick a member but
// not another admin or the owner; only the owner may promote/demote/ban
// at the admin level).
function roleRank(role) {
  const idx = ROLES.indexOf(role);
  if (idx === -1) throw Object.assign(new Error(`unknown role "${role}"`), { status: 400 });
  return idx;
}

module.exports = {
  ROLES,
  MEMBERSHIP_STATUSES,
  INVITE_STATUSES,
  generateFamilyId,
  generateMembershipId,
  generateInviteId,
  generateDonationId,
  assertValidFamilyName,
  assertValidRole,
  roleRank,
};
