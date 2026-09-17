// Phase 5 — Recharge orders repository.
//
// Same dual-implementation pattern as wallet.repository.js. Pure
// persistence only -- provider verification and the wallet credit call
// live in services/recharge.service.js, which orchestrates this
// repository + services/recharge-provider-verifier.js + the wallet
// repository together.

const { generateRechargeOrderId } = require('../models/recharge.model');

// `pg` returns BIGINT columns (coins_to_credit) as STRINGS, not numbers --
// deliberate on the driver's part, since a BIGINT can exceed
// Number.MAX_SAFE_INTEGER and a naive numeric parse would silently corrupt
// the value. InMemoryRechargeRepository stores coinsToCredit as a plain JS
// number (it is always resolved from the server-side catalog in
// recharge.model.js, never client-supplied), so to give callers an
// identical shape/type under either backend we convert here -- but only
// after confirming the BIGINT string round-trips through Number() exactly.
// Same helper/contract as wallet.repository.js's bigintToSafeNumber.
function bigintToSafeNumber(value) {
  if (value === null || value === undefined) return value;
  const asNumber = Number(value);
  if (!Number.isSafeInteger(asNumber) || String(asNumber) !== String(value)) {
    throw Object.assign(
      new Error(`recharge BIGINT value "${value}" exceeds Number.MAX_SAFE_INTEGER and cannot be converted without precision loss`),
      { status: 500 }
    );
  }
  return asNumber;
}

// Maps a raw `recharge_orders` row onto the exact shape
// InMemoryRechargeRepository already returns: { id, accountId, packageId,
// coinsToCredit, provider, providerPurchaseRef, status, failureReason,
// walletTransactionId, createdAt, updatedAt }. created_at/updated_at are
// TIMESTAMPTZ and come back from `pg` as JS Date objects, not ISO strings --
// the in-memory version always uses .toISOString(), so this converts to
// match.
function mapOrderRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    packageId: row.package_id,
    coinsToCredit: bigintToSafeNumber(row.coins_to_credit),
    provider: row.provider,
    providerPurchaseRef: row.provider_purchase_ref,
    status: row.status,
    failureReason: row.failure_reason,
    walletTransactionId: row.wallet_transaction_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

class InMemoryRechargeRepository {
  constructor() {
    this._orders = new Map(); // id -> order
  }

  async create(accountId, packageId, coinsToCredit, provider) {
    const order = {
      id: generateRechargeOrderId(),
      accountId,
      packageId,
      coinsToCredit,
      provider,
      providerPurchaseRef: null,
      status: 'pending',
      failureReason: null,
      walletTransactionId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this._orders.set(order.id, order);
    return { ...order };
  }

  async findById(id) {
    const order = this._orders.get(id);
    return order ? { ...order } : null;
  }

  async markCompleted(id, providerPurchaseRef, walletTransactionId) {
    const order = this._orders.get(id);
    if (!order) return null;
    // Idempotent: once completed, further calls are no-ops that return the
    // same completed order untouched -- a retried "complete" request must
    // never credit the wallet a second time (the wallet layer also
    // enforces this independently via idempotencyKey, this is belt+braces
    // at the order level too).
    if (order.status === 'completed') return { ...order };
    order.providerPurchaseRef = providerPurchaseRef;
    order.status = 'completed';
    order.walletTransactionId = walletTransactionId;
    order.updatedAt = new Date().toISOString();
    return { ...order };
  }

  async markFailed(id, providerPurchaseRef, reason) {
    const order = this._orders.get(id);
    if (!order) return null;
    if (order.status === 'completed') return { ...order }; // never downgrade a completed order
    order.providerPurchaseRef = providerPurchaseRef;
    order.status = 'failed';
    order.failureReason = reason;
    order.updatedAt = new Date().toISOString();
    return { ...order };
  }

  async listAll() { return Array.from(this._orders.values()).map((o) => ({ ...o })); }

  async listByAccount(accountId) {
    return Array.from(this._orders.values())
      .filter((o) => o.accountId === accountId)
      .map((o) => ({ ...o }));
  }
}

class PostgresRechargeRepository {
  constructor(pool) {
    this._pool = pool;
  }

  async create(accountId, packageId, coinsToCredit, provider) {
    const id = generateRechargeOrderId();
    const { rows } = await this._pool.query(
      `INSERT INTO recharge_orders (id, account_id, package_id, coins_to_credit, provider)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, accountId, packageId, coinsToCredit, provider]
    );
    return mapOrderRow(rows[0]);
  }

  async findById(id) {
    const { rows } = await this._pool.query('SELECT * FROM recharge_orders WHERE id = $1', [id]);
    return mapOrderRow(rows[0]) || null;
  }

  async markCompleted(id, providerPurchaseRef, walletTransactionId) {
    const { rows } = await this._pool.query(
      `UPDATE recharge_orders
       SET provider_purchase_ref = $2, status = 'completed', wallet_transaction_id = $3, updated_at = now()
       WHERE id = $1 AND status <> 'completed'
       RETURNING *`,
      [id, providerPurchaseRef, walletTransactionId]
    );
    if (rows.length === 0) {
      const { rows: existingRows } = await this._pool.query('SELECT * FROM recharge_orders WHERE id = $1', [id]);
      return mapOrderRow(existingRows[0]) || null;
    }
    return mapOrderRow(rows[0]);
  }

  async markFailed(id, providerPurchaseRef, reason) {
    const { rows } = await this._pool.query(
      `UPDATE recharge_orders
       SET provider_purchase_ref = $2, status = 'failed', failure_reason = $3, updated_at = now()
       WHERE id = $1 AND status <> 'completed'
       RETURNING *`,
      [id, providerPurchaseRef, reason]
    );
    if (rows.length === 0) {
      const { rows: existingRows } = await this._pool.query('SELECT * FROM recharge_orders WHERE id = $1', [id]);
      return mapOrderRow(existingRows[0]) || null;
    }
    return mapOrderRow(rows[0]);
  }

  async listAll() {
    const { rows } = await this._pool.query('SELECT * FROM recharge_orders ORDER BY created_at DESC');
    return rows.map(mapOrderRow);
  }

  async listByAccount(accountId) {
    const { rows } = await this._pool.query(
      'SELECT * FROM recharge_orders WHERE account_id = $1 ORDER BY created_at DESC',
      [accountId]
    );
    return rows.map(mapOrderRow);
  }
}

module.exports = { InMemoryRechargeRepository, PostgresRechargeRepository };
