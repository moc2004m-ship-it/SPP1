// Phase 2 — Wallet repository.
//
// Same dual-implementation pattern as account.repository.js:
//   - InMemoryWalletRepository: ACTIVE today (see ../index.js -- Stage 3's
//     STAGE3_ENABLE_POSTGRES switch controls this repository too, since it
//     is built from the same getDatabase() factory).
//   - PostgresWalletRepository: ready for later, not exercised in this
//     sandbox (no network -- see Database/STAGE3_TODO.md). Written to the
//     same schema as src/database/schema/003_create_wallets.sql so
//     connecting it later is a config change, not a rewrite.
//
// Both implementations guarantee, for every credit/debit call:
//   1. Idempotency: calling again with the same idempotencyKey returns the
//      SAME result and does NOT apply the amount a second time.
//   2. Non-negative balance: a debit that would take a balance below zero
//      is rejected before any state changes. In Postgres this is enforced
//      twice -- once here, and again by the CHECK constraint on
//      wallet_balances.coins/diamonds as a second line of defense.

const {
  generateTransactionId,
  assertValidCurrency,
  assertValidAmount,
  assertValidIdempotencyKey,
} = require('../models/wallet.model');

function insufficientFunds() {
  return Object.assign(new Error('insufficient balance'), { status: 409 });
}

// `pg` returns BIGINT columns (coins, diamonds, amount, balance_after) as
// STRINGS, not numbers -- this is deliberate on the driver's part, because a
// BIGINT can exceed Number.MAX_SAFE_INTEGER and a naive numeric parse would
// silently corrupt the value. InMemoryWalletRepository stores every balance
// and amount as a plain JS number (wallet.model.assertValidAmount already
// restricts every amount to a positive integer, and a balance is just a sum
// of validated amounts), so to give callers an identical shape/type under
// either backend we convert here -- but only after confirming the BIGINT
// string round-trips through Number() exactly. If it doesn't (a real
// account holding more than ~9 quadrillion units), we throw instead of
// silently returning a corrupted balance.
function bigintToSafeNumber(value) {
  if (value === null || value === undefined) return value;
  const asNumber = Number(value);
  if (!Number.isSafeInteger(asNumber) || String(asNumber) !== String(value)) {
    throw Object.assign(
      new Error(`wallet BIGINT value "${value}" exceeds Number.MAX_SAFE_INTEGER and cannot be converted without precision loss`),
      { status: 500 }
    );
  }
  return asNumber;
}

// Maps a raw `wallet_balances` row onto the exact shape
// InMemoryWalletRepository.getBalance() already returns: { accountId, coins,
// diamonds }. Deliberately excludes updated_at -- the in-memory version has
// no such field, and the goal here is an identical shape, not a superset.
function mapBalanceRow(row) {
  if (!row) return null;
  return {
    accountId: row.account_id,
    coins: bigintToSafeNumber(row.coins),
    diamonds: bigintToSafeNumber(row.diamonds),
  };
}

// Maps a raw `wallet_transactions` row onto the exact shape
// InMemoryWalletRepository._apply() already returns: { id, accountId,
// currency, direction, amount, balanceAfter, idempotencyKey, createdAt }.
// created_at is TIMESTAMPTZ and comes back from `pg` as a JS Date, not an
// ISO string -- the in-memory version always uses .toISOString(), so this
// converts to match.
function mapTransactionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    currency: row.currency,
    direction: row.direction,
    amount: bigintToSafeNumber(row.amount),
    balanceAfter: bigintToSafeNumber(row.balance_after),
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

class InMemoryWalletRepository {
  constructor() {
    this._balances = new Map(); // accountId -> { coins, diamonds }
    this._transactionsByIdempotencyKey = new Map(); // `${accountId}:${idempotencyKey}` -> transaction
  }

  async getBalance(accountId) {
    return this._balances.get(accountId) || { accountId, coins: 0, diamonds: 0 };
  }

  async _apply(accountId, currency, direction, amount, idempotencyKey) {
    assertValidCurrency(currency);
    assertValidAmount(amount);
    assertValidIdempotencyKey(idempotencyKey);

    // Idempotency check FIRST, before touching any balance. A replayed
    // request (network retry, duplicate webhook delivery, etc.) with the
    // same key gets back the original outcome, unapplied a second time.
    const key = `${accountId}:${idempotencyKey}`;
    const existing = this._transactionsByIdempotencyKey.get(key);
    if (existing) {
      if (existing.currency !== currency || existing.direction !== direction || existing.amount !== amount) {
        throw Object.assign(new Error('idempotencyKey was already used for a different wallet operation'), { status: 409 });
      }
      return existing;
    }

    const current = this._balances.get(accountId) || { accountId, coins: 0, diamonds: 0 };
    const delta = direction === 'credit' ? amount : -amount;
    const nextValue = current[currency] + delta;

    if (nextValue < 0) throw insufficientFunds();

    const updated = { ...current, [currency]: nextValue };
    this._balances.set(accountId, updated);

    const transaction = Object.freeze({
      id: generateTransactionId(),
      accountId,
      currency,
      direction,
      amount,
      balanceAfter: nextValue,
      idempotencyKey,
      createdAt: new Date().toISOString(),
    });
    this._transactionsByIdempotencyKey.set(key, transaction);
    return transaction;
  }

  async credit(accountId, currency, amount, idempotencyKey) {
    return this._apply(accountId, currency, 'credit', amount, idempotencyKey);
  }

  async debit(accountId, currency, amount, idempotencyKey) {
    return this._apply(accountId, currency, 'debit', amount, idempotencyKey);
  }
}

class PostgresWalletRepository {
  // `pool` is a `pg` Pool instance. Not constructed anywhere until Stage 3's
  // Postgres switch is enabled with real Supabase/Postgres credentials --
  // see ../index.js. NOT exercised in this sandbox: no network access, so
  // this code has been reviewed but never run against a live database.
  constructor(pool) {
    this._pool = pool;
  }

  async getBalance(accountId) {
    const { rows } = await this._pool.query('SELECT * FROM wallet_balances WHERE account_id = $1', [accountId]);
    return mapBalanceRow(rows[0]) || { accountId, coins: 0, diamonds: 0 };
  }

  async _apply(accountId, currency, direction, amount, idempotencyKey) {
    assertValidCurrency(currency);
    assertValidAmount(amount);
    assertValidIdempotencyKey(idempotencyKey);

    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');

      const delta = direction === 'credit' ? amount : -amount;
      const transactionId = generateTransactionId();

      // UPSERT the account's balance row so a first-ever transaction for an
      // account doesn't need a separate row-creation step, then move the
      // balance in one atomic statement. The WHERE clause is redundant with
      // the CHECK constraint but turns a would-be constraint violation into
      // a clean "0 rows returned" we can translate to insufficientFunds()
      // without the whole transaction aborting on a Postgres error.
      await client.query(
        `INSERT INTO wallet_balances (account_id, coins, diamonds)
         VALUES ($1, 0, 0)
         ON CONFLICT (account_id) DO NOTHING`,
        [accountId]
      );

      const { rows: balanceRows } = await client.query(
        `UPDATE wallet_balances
         SET ${currency} = ${currency} + $1, updated_at = now()
         WHERE account_id = $2 AND ${currency} + $1 >= 0
         RETURNING ${currency} AS balance_after`,
        [delta, accountId]
      );

      if (balanceRows.length === 0) {
        await client.query('ROLLBACK');
        throw insufficientFunds();
      }

      const balanceAfter = bigintToSafeNumber(balanceRows[0].balance_after);

      let insertedRows;
      try {
        ({ rows: insertedRows } = await client.query(
          `INSERT INTO wallet_transactions
             (id, account_id, currency, direction, amount, balance_after, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (account_id, idempotency_key) DO NOTHING
           RETURNING *`,
          [transactionId, accountId, currency, direction, amount, balanceAfter, idempotencyKey]
        ));
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }

      if (insertedRows.length === 0) {
        // Idempotency key already existed -- another request already
        // applied this exact operation. Roll back the balance change we
        // just made (it must not be double-applied) and return the
        // original transaction untouched.
        await client.query('ROLLBACK');
        const { rows: existingRows } = await this._pool.query(
          'SELECT * FROM wallet_transactions WHERE account_id = $1 AND idempotency_key = $2',
          [accountId, idempotencyKey]
        );
        const existing = mapTransactionRow(existingRows[0]);
        if (!existing) throw Object.assign(new Error('idempotency transaction disappeared'), { status: 500 });
        if (existing.currency !== currency || existing.direction !== direction || existing.amount !== amount) {
          throw Object.assign(new Error('idempotencyKey was already used for a different wallet operation'), { status: 409 });
        }
        return existing;
      }

      await client.query('COMMIT');
      return mapTransactionRow(insertedRows[0]);
    } finally {
      client.release();
    }
  }

  async credit(accountId, currency, amount, idempotencyKey) {
    return this._apply(accountId, currency, 'credit', amount, idempotencyKey);
  }

  async debit(accountId, currency, amount, idempotencyKey) {
    return this._apply(accountId, currency, 'debit', amount, idempotencyKey);
  }
}

module.exports = { InMemoryWalletRepository, PostgresWalletRepository, insufficientFunds };
