// Stage 32 — Couple/CP model.
//
// Same boundary as family.model.js: nothing here accepts a
// client-supplied id or status. Ids are always generated here.
// Status values are always chosen by couple.service.js from the fixed
// enums below, NEVER copied from req.body.

const crypto = require('node:crypto');

function generateCoupleId() {
  return `cpl_${crypto.randomUUID()}`;
}

function generateInviteId() {
  return `cinv_${crypto.randomUUID()}`;
}

const COUPLE_STATUSES = Object.freeze(['active', 'ended']);

const INVITE_STATUSES = Object.freeze(['pending', 'accepted', 'declined', 'cancelled']);

function assertNotSelfPair(accountId, otherAccountId) {
  if (accountId === otherAccountId) {
    throw Object.assign(new Error('you cannot pair with yourself'), { status: 400 });
  }
}

module.exports = {
  COUPLE_STATUSES,
  INVITE_STATUSES,
  generateCoupleId,
  generateInviteId,
  assertNotSelfPair,
};
