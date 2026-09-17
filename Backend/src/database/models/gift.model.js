// Phase 5 — Gift model.

const crypto = require('node:crypto');

function generateGiftId() {
  return `gift_${crypto.randomUUID()}`;
}

function assertValidQuantity(quantity) {
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 10000) {
    throw Object.assign(new Error('quantity must be a positive integer up to 10000'), { status: 400 });
  }
}

function assertDifferentAccounts(senderId, receiverId) {
  if (senderId === receiverId) {
    throw Object.assign(new Error('cannot send a gift to yourself'), { status: 400 });
  }
}

module.exports = { generateGiftId, assertValidQuantity, assertDifferentAccounts };
