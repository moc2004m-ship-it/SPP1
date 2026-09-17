// Phase 5 — Inventory model.
//
// Same boundary as wallet.model.js: nothing here accepts a client-supplied
// id. A grant always needs a referenceId naming the real server-side event
// that caused it (a completed recharge order id, a gift id, an admin
// action id) -- there is no "just because" grant.

const crypto = require('node:crypto');

function generateInventoryItemId() {
  return `inv_${crypto.randomUUID()}`;
}

// Stage 29 completion (this session) -- the referenceId an admin grant
// uses as its inventory.grant() `referenceId` (the "source transaction"
// the work package asks for), same role generatePurchaseId() plays for
// store.service.js's store_purchase grants and generateGiftId() plays
// for gifts.service.js. Server-generated only -- never a client-supplied
// id -- so a genuine retry of the same admin action can't double-grant
// (inventory.grant() is idempotent on (referenceId, itemId)) and every
// grant is traceable back to exactly one real admin-grant event.
function generateAdminGrantId() {
  return `admgrant_${crypto.randomUUID()}`;
}

function assertValidItemId(itemId) {
  if (typeof itemId !== 'string' || !itemId.trim() || itemId.length > 120) {
    throw Object.assign(new Error('itemId must be a non-empty string up to 120 characters'), { status: 400 });
  }
}

function assertValidQuantity(quantity) {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw Object.assign(new Error('quantity must be a positive integer'), { status: 400 });
  }
}

function assertValidSource(source) {
  const allowed = ['recharge', 'gift', 'admin', 'store_purchase'];
  if (!allowed.includes(source)) {
    throw Object.assign(new Error(`source must be one of ${allowed.join(', ')}`), { status: 400 });
  }
}

function assertValidReferenceId(referenceId) {
  if (typeof referenceId !== 'string' || !referenceId.trim() || referenceId.length > 200) {
    throw Object.assign(new Error('referenceId must be a non-empty string up to 200 characters'), { status: 400 });
  }
}

module.exports = {
  generateInventoryItemId,
  generateAdminGrantId,
  assertValidItemId,
  assertValidQuantity,
  assertValidSource,
  assertValidReferenceId,
};
