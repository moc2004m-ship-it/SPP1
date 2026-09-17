// Phase 2 — Wallet model.
//
// Mirrors account.model.js's boundary: nothing here accepts a
// client-supplied balance or transaction id. amount/currency/direction are
// the only inputs a caller provides, and they are validated by the
// repository before any write is attempted.

const crypto = require('node:crypto');

const CURRENCIES = Object.freeze(['coins', 'diamonds']);
const DIRECTIONS = Object.freeze(['credit', 'debit']);

function generateTransactionId() {
  return `wtx_${crypto.randomUUID()}`;
}

function assertValidCurrency(currency) {
  if (!CURRENCIES.includes(currency)) {
    throw Object.assign(new Error(`currency must be one of ${CURRENCIES.join(', ')}`), { status: 400 });
  }
}

function assertValidAmount(amount) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw Object.assign(new Error('amount must be a positive integer'), { status: 400 });
  }
}

function assertValidIdempotencyKey(key) {
  if (typeof key !== 'string' || key.length < 8 || key.length > 200) {
    throw Object.assign(new Error('idempotencyKey must be a string between 8 and 200 characters'), { status: 400 });
  }
}

module.exports = {
  CURRENCIES,
  DIRECTIONS,
  generateTransactionId,
  assertValidCurrency,
  assertValidAmount,
  assertValidIdempotencyKey,
};
