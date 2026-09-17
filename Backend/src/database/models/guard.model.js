// Stage 32 — Guard/Fan Club model.
//
// Same boundary as couple.model.js/family.model.js: nothing here accepts
// a client-supplied id. Ids are always generated here.

const crypto = require('node:crypto');

function generateGuardId() {
  return `grd_${crypto.randomUUID()}`;
}

// Idempotency key for the wallet debit behind a guard purchase/renewal --
// same role as family.model.js's generateDonationId(): a fresh id per
// purchase attempt, passed straight into wallets.debit() so a retried
// request can never double-charge.
function generateGuardPurchaseId() {
  return `grdpur_${crypto.randomUUID()}`;
}

function assertNotSelfGuard(fanId, hostId) {
  if (fanId === hostId) {
    throw Object.assign(new Error('you cannot purchase a guard on yourself'), { status: 400 });
  }
}

module.exports = {
  generateGuardId,
  generateGuardPurchaseId,
  assertNotSelfGuard,
};
