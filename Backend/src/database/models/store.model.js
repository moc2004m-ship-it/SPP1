// Stage 29 — Store model.
//
// Same boundary as gift.model.js: nothing here accepts a client-supplied
// price/currency (that always comes from ../domain/store-catalog.js,
// looked up server-side by itemId) or a client-supplied purchase id
// (generatePurchaseId() is the only source, same role as
// gift.model.js's generateGiftId()).

const crypto = require('node:crypto');

function generatePurchaseId() {
  return `pur_${crypto.randomUUID()}`;
}

function assertValidQuantity(quantity) {
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 10000) {
    throw Object.assign(new Error('quantity must be a positive integer up to 10000'), { status: 400 });
  }
}

module.exports = { generatePurchaseId, assertValidQuantity };
