// Stage 29 — Store service.
//
// The ONLY code path that may complete a store purchase. Debits the
// buyer's real wallet balance for the real catalog price BEFORE granting
// the item, so an item can never be recorded in inventory without a real,
// non-fake money movement behind it -- same shape as gifts.service.js. If
// the debit fails (insufficient balance), no inventory row is created at
// all.
//
// Idempotency: a fresh purchaseId is generated per call (one real tap of
// "buy" = one real debit + one real grant, same reasoning as
// gifts.service.js's generateGiftId() per send) and used as BOTH the
// wallet idempotencyKey and the inventory referenceId. Reusing the same
// id for both means a genuine retry of this exact purchase() call
// (dropped response, client retry) can never double-debit OR
// double-grant -- wallets.debit() and inventory.grant() each already
// guarantee idempotency on the key/referenceId they're given.

const { resolveStoreItem } = require('../domain/store-catalog');
const { generatePurchaseId, assertValidQuantity } = require('../database/models/store.model');

function createStoreService({ wallets, inventory }) {
  async function purchase({ accountId, itemId, quantity }) {
    assertValidQuantity(quantity);
    const catalogItem = resolveStoreItem(itemId); // throws 400 on unknown itemId -- never trusts a client-supplied price/currency
    const totalCost = catalogItem.unitCost * quantity;
    const purchaseId = generatePurchaseId();

    const walletTransaction = await wallets.debit(accountId, catalogItem.currency, totalCost, purchaseId);

    // Only reached after the debit actually succeeded -- inventory.grant()
    // is idempotent on (referenceId, itemId), same guarantee the wallet
    // debit above already has on idempotencyKey.
    const grantedItem = await inventory.grant(accountId, catalogItem.id, quantity, 'store_purchase', purchaseId);

    return {
      purchaseId,
      itemId: catalogItem.id,
      quantity,
      currency: catalogItem.currency,
      totalCost,
      walletTransactionId: walletTransaction.id,
      inventoryItem: grantedItem,
    };
  }

  return { purchase };
}

module.exports = { createStoreService };
