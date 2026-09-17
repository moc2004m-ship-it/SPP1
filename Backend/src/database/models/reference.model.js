// Stage 3 — Generic Reference / Transaction Model.
//
// This is deliberately generic. It is NOT a wallet, NOT a coin/diamond
// ledger, and NOT tied to any agency/commission/cash-withdrawal flow —
// those remain explicitly out of scope (see Database/DATABASE_DESIGN.md).
// Its only job is to give any future stage a ready-made, auditable
// "something happened, here is its unique trackable ID" record, so that
// stage doesn't have to invent its own ID/audit scheme from scratch.

const { generateReferenceId } = require('../id-generator');

const VALID_STATUSES = Object.freeze(['pending', 'completed', 'failed', 'reversed']);

function createReference({ type, userId = null, amount = null, currency = null, metadata = {} } = {}) {
  if (typeof type !== 'string' || type.trim().length === 0) {
    throw new Error('createReference: "type" is required and must be a non-empty string');
  }
  if (amount !== null && typeof amount !== 'number') {
    throw new Error('createReference: "amount" must be a number or null');
  }

  const now = new Date().toISOString();
  return Object.freeze({
    id: generateReferenceId(), // server-generated — never accepted from a client
    type, // free-form label, defined by whichever future stage uses this
    status: 'pending',
    userId,
    amount, // nullable — not every reference is monetary
    currency,
    metadata: Object.freeze({ ...metadata }),
    createdAt: now,
    updatedAt: now,
  });
}

function transitionReferenceStatus(reference, nextStatus) {
  if (!VALID_STATUSES.includes(nextStatus)) {
    throw new Error(`transitionReferenceStatus: invalid status "${nextStatus}"`);
  }
  return Object.freeze({
    ...reference,
    status: nextStatus,
    updatedAt: new Date().toISOString(),
  });
}

module.exports = { createReference, transitionReferenceStatus, VALID_STATUSES };
