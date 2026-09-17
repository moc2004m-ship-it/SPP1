// Phase 5 — Inventory repository.
//
// Same dual-implementation pattern as wallet.repository.js:
//   - InMemoryInventoryRepository: ACTIVE today (no network in this
//     sandbox -- see Database/STAGE3_TODO.md).
//   - PostgresInventoryRepository: ready for later, matches
//     src/database/schema/005_create_inventory.sql. NOT exercised in this
//     sandbox -- reviewed but never run against a live database.
//
// Idempotency guarantee: granting with the same (referenceId, itemId)
// pair twice returns the ORIGINAL grant and does not create a second row
// -- the same role wallet_transactions.idempotency_key plays for money.

const {
  generateInventoryItemId,
  assertValidItemId,
  assertValidQuantity,
  assertValidSource,
  assertValidReferenceId,
} = require('../models/inventory.model');

// Maps a raw `inventory_items` row onto the exact shape
// InMemoryInventoryRepository.grant()/listByAccount() already return: { id,
// accountId, itemId, quantity, source, referenceId, createdAt }.
//
// Note on `quantity`: unlike wallet_balances.coins/diamonds and
// wallet_transactions.amount (BIGINT in 003_create_wallets.sql),
// inventory_items.quantity is declared INTEGER in
// 005_create_inventory.sql -- `pg` already parses INTEGER columns into
// native JS numbers, so no bigint-string conversion is needed or applied
// here. `id`, `source` are TEXT and pass through unchanged.
//
// created_at is TIMESTAMPTZ and comes back from `pg` as a JS Date, not an
// ISO string -- the in-memory version always uses .toISOString(), so this
// converts to match.
function mapInventoryItemRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    itemId: row.item_id,
    quantity: row.quantity,
    source: row.source,
    referenceId: row.reference_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

class InMemoryInventoryRepository {
  constructor() {
    this._items = []; // flat list, filtered on read
    this._byReferenceAndItem = new Map(); // `${referenceId}:${itemId}` -> item
  }

  async grant(accountId, itemId, quantity, source, referenceId) {
    assertValidItemId(itemId);
    assertValidQuantity(quantity);
    assertValidSource(source);
    assertValidReferenceId(referenceId);

    const key = `${referenceId}:${itemId}`;
    const existing = this._byReferenceAndItem.get(key);
    if (existing) return existing;

    const item = Object.freeze({
      id: generateInventoryItemId(),
      accountId,
      itemId,
      quantity,
      source,
      referenceId,
      createdAt: new Date().toISOString(),
    });
    this._items.push(item);
    this._byReferenceAndItem.set(key, item);
    return item;
  }

  async listByAccount(accountId) {
    return this._items.filter((i) => i.accountId === accountId);
  }
}

class PostgresInventoryRepository {
  constructor(pool) {
    this._pool = pool;
  }

  async grant(accountId, itemId, quantity, source, referenceId) {
    assertValidItemId(itemId);
    assertValidQuantity(quantity);
    assertValidSource(source);
    assertValidReferenceId(referenceId);

    const id = generateInventoryItemId();
    const { rows } = await this._pool.query(
      `INSERT INTO inventory_items (id, account_id, item_id, quantity, source, reference_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (reference_id, item_id) DO NOTHING
       RETURNING *`,
      [id, accountId, itemId, quantity, source, referenceId]
    );

    if (rows.length === 0) {
      const { rows: existingRows } = await this._pool.query(
        'SELECT * FROM inventory_items WHERE reference_id = $1 AND item_id = $2',
        [referenceId, itemId]
      );
      return mapInventoryItemRow(existingRows[0]);
    }
    return mapInventoryItemRow(rows[0]);
  }

  async listByAccount(accountId) {
    const { rows } = await this._pool.query(
      'SELECT * FROM inventory_items WHERE account_id = $1 ORDER BY created_at DESC',
      [accountId]
    );
    return rows.map(mapInventoryItemRow);
  }
}

module.exports = { InMemoryInventoryRepository, PostgresInventoryRepository };
