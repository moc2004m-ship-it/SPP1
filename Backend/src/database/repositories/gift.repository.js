// Phase 5 — Gifts repository.
//
// Pure persistence only -- the wallet debit itself happens in
// services/gifts.service.js via the wallet repository BEFORE this
// repository is called, and the resulting walletTransactionId is stored
// here so every gift row is traceable to a real, non-fake money movement.

const crypto = require('node:crypto');

function mapGiftRow(row) {
  if (!row) return null;
  return { id: row.id, roomId: row.room_id, senderId: row.sender_id, receiverId: row.receiver_id, giftId: row.gift_id, quantity: row.quantity, unitCostCoins: Number(row.unit_cost_coins), totalCostCoins: Number(row.total_cost_coins), walletTransactionId: row.wallet_transaction_id, createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at };
}
const { generateGiftId } = require('../models/gift.model');

class InMemoryGiftRepository {
  constructor() {
    this._gifts = [];
  }

  async create({ roomId, senderId, receiverId, giftId, quantity, unitCostCoins, totalCostCoins, walletTransactionId }) {
    const record = Object.freeze({
      id: generateGiftId(),
      roomId,
      senderId,
      receiverId,
      giftId,
      quantity,
      unitCostCoins,
      totalCostCoins,
      walletTransactionId,
      createdAt: new Date().toISOString(),
    });
    this._gifts.push(record);
    return record;
  }

  async listAll() { return this._gifts.map((g) => ({ ...g })); }

  async listByRoom(roomId) {
    return this._gifts.filter((g) => g.roomId === roomId);
  }

  async listByReceiver(receiverId) {
    return this._gifts.filter((g) => g.receiverId === receiverId);
  }

  // Stage 31 -- Rankings. Read-only aggregation, added without touching
  // any existing method/behavior above (listByRoom/listByReceiver/create
  // are unchanged). Sums totalCostCoins per sender across every gift
  // created at or after `since` (or every gift ever, if `since` is
  // null/undefined -- the 'all' period, see
  // ../../domain/ranking-periods.js), sorted highest-spend first. This is
  // the real, server-side source of the "wealth" ranking -- never a
  // client-supplied number.
  async sumBySender({ since } = {}) {
    const totals = new Map(); // accountId -> total
    for (const gift of this._gifts) {
      if (since && gift.createdAt < since.toISOString()) continue;
      totals.set(gift.senderId, (totals.get(gift.senderId) || 0) + gift.totalCostCoins);
    }
    return Array.from(totals.entries())
      .map(([accountId, total]) => ({ accountId, total }))
      .sort((a, b) => b.total - a.total);
  }

  // Same as sumBySender(), grouped by receiver instead -- the real
  // source of the "charm" (most-gifted) ranking.
  async sumByReceiver({ since } = {}) {
    const totals = new Map();
    for (const gift of this._gifts) {
      if (since && gift.createdAt < since.toISOString()) continue;
      totals.set(gift.receiverId, (totals.get(gift.receiverId) || 0) + gift.totalCostCoins);
    }
    return Array.from(totals.entries())
      .map(([accountId, total]) => ({ accountId, total }))
      .sort((a, b) => b.total - a.total);
  }
}

class PostgresGiftRepository {
  constructor(pool) {
    this._pool = pool;
  }

  async create({ roomId, senderId, receiverId, giftId, quantity, unitCostCoins, totalCostCoins, walletTransactionId }) {
    const id = generateGiftId();
    const { rows } = await this._pool.query(
      `INSERT INTO gifts_log
         (id, room_id, sender_id, receiver_id, gift_id, quantity, unit_cost_coins, total_cost_coins, wallet_transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [id, roomId, senderId, receiverId, giftId, quantity, unitCostCoins, totalCostCoins, walletTransactionId]
    );
    return rows[0];
  }

  async createWithDebit({ roomId, senderId, receiverId, giftId, quantity, unitCostCoins, totalCostCoins }) {
    const client = await this._pool.connect();
    const { generateTransactionId } = require('../models/wallet.model');
    const { generateGiftId } = require('../models/gift.model');
    const idempotencyKey = `gift_${crypto.randomUUID()}`;
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO wallet_balances (account_id, coins, diamonds) VALUES ($1,0,0) ON CONFLICT (account_id) DO NOTHING`, [senderId]);
      const { rows: balanceRows } = await client.query(`UPDATE wallet_balances SET coins = coins - $1, updated_at=now() WHERE account_id=$2 AND coins >= $1 RETURNING coins AS balance_after`, [totalCostCoins, senderId]);
      if (!balanceRows.length) { await client.query('ROLLBACK'); throw Object.assign(new Error('insufficient balance'), { status:409 }); }
      const txId = generateTransactionId();
      await client.query(`INSERT INTO wallet_transactions (id,account_id,currency,direction,amount,balance_after,idempotency_key) VALUES ($1,$2,'coins','debit',$3,$4,$5)`, [txId,senderId,totalCostCoins,balanceRows[0].balance_after,idempotencyKey]);
      const giftRecordId = generateGiftId();
      const { rows } = await client.query(`INSERT INTO gifts_log (id,room_id,sender_id,receiver_id,gift_id,quantity,unit_cost_coins,total_cost_coins,wallet_transaction_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [giftRecordId,roomId,senderId,receiverId,giftId,quantity,unitCostCoins,totalCostCoins,txId]);
      await client.query('COMMIT');
      return rows[0];
    } catch (e) { try { await client.query('ROLLBACK'); } catch {} throw e; } finally { client.release(); }
  }

  async listAll() {
    const { rows } = await this._pool.query('SELECT * FROM gifts_log ORDER BY created_at DESC');
    return rows.map(mapGiftRow);
  }

  async listByRoom(roomId) {
    const { rows } = await this._pool.query(
      'SELECT * FROM gifts_log WHERE room_id = $1 ORDER BY created_at DESC',
      [roomId]
    );
    return rows.map(mapGiftRow);
  }

  async listByReceiver(receiverId) {
    const { rows } = await this._pool.query(
      'SELECT * FROM gifts_log WHERE receiver_id = $1 ORDER BY created_at DESC',
      [receiverId]
    );
    return rows.map(mapGiftRow);
  }

  // Stage 31 -- Rankings. Same aggregation as
  // InMemoryGiftRepository.sumBySender() above, computed in SQL instead
  // of in JS. Added without touching any existing query above.
  async sumBySender({ since } = {}) {
    const { rows } = since
      ? await this._pool.query(
          `SELECT sender_id AS account_id, SUM(total_cost_coins)::bigint AS total
             FROM gifts_log WHERE created_at >= $1
             GROUP BY sender_id ORDER BY total DESC`,
          [since]
        )
      : await this._pool.query(
          `SELECT sender_id AS account_id, SUM(total_cost_coins)::bigint AS total
             FROM gifts_log GROUP BY sender_id ORDER BY total DESC`
        );
    return rows.map((r) => ({ accountId: r.account_id, total: Number(r.total) }));
  }

  async sumByReceiver({ since } = {}) {
    const { rows } = since
      ? await this._pool.query(
          `SELECT receiver_id AS account_id, SUM(total_cost_coins)::bigint AS total
             FROM gifts_log WHERE created_at >= $1
             GROUP BY receiver_id ORDER BY total DESC`,
          [since]
        )
      : await this._pool.query(
          `SELECT receiver_id AS account_id, SUM(total_cost_coins)::bigint AS total
             FROM gifts_log GROUP BY receiver_id ORDER BY total DESC`
        );
    return rows.map((r) => ({ accountId: r.account_id, total: Number(r.total) }));
  }
}

module.exports = { InMemoryGiftRepository, PostgresGiftRepository };
