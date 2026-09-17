// Stage 3 — Account repository.
// Stage 27/28 — added addXp()/addLifetimeRecharge(), the ONLY two ways
// vip/svip/lvl/xp/lifetimeDiamondsRecharged are ever changed after
// creation. Both recompute lvl/vip/svip server-side from the domain
// curves (../../domain/level-curve.js, ../../domain/vip-tiers.js) in the
// SAME operation that applies the increment, so those derived fields can
// never drift out of sync with the counter they are derived from.
//
// Two implementations of the same interface (create/findById/list):
//   - InMemoryAccountRepository: the ACTIVE one right now. No external
//     database is connected in Stage 3, so this is what actually backs
//     the demo account and the /accounts routes today.
//   - PostgresAccountRepository: ready for later. It is not used unless a
//     future stage explicitly enables it (see ../index.js). It is
//     included now so that swapping storage is a one-line config change,
//     not a rewrite of models/routes.
//
// Both implementations are the ONLY code allowed to write an account.
// Callers never construct an account object by hand — they always go
// through create(), which always calls the account model, which always
// generates its own ID and hard-codes VIP/SVIP/LVL/XP/Coins/Diamonds/
// lifetimeDiamondsRecharged to 0.

const { createAccount } = require('../models/account.model');
const { levelForXp } = require('../../domain/level-curve');
const { vipTierForLifetimeDiamonds, svipTierForLifetimeDiamonds } = require('../../domain/vip-tiers');

function assertPositiveIntegerAmount(amount, label) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw Object.assign(new Error(`${label} must be a positive integer`), { status: 400 });
  }
}

function accountNotFound() {
  return Object.assign(new Error('account not found'), { status: 404 });
}

// Stage 36 — shared validation for suspend()/unsuspend() on both
// repository implementations below. A suspension without a recorded
// reason, or without a real acting staff id, is not a valid state in
// this codebase -- see 028_add_account_suspension.sql's header.
function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw Object.assign(new Error(`${label} must be a non-empty string`), { status: 400 });
  }
}

function mapAccountRow(row) {
  if (!row) return null;
  return {
    id: row.id, vip: row.vip, svip: row.svip, lvl: row.lvl,
    xp: row.xp === undefined ? 0 : Number(row.xp),
    coins: row.coins === undefined ? 0 : Number(row.coins),
    diamonds: row.diamonds === undefined ? 0 : Number(row.diamonds),
    lifetimeDiamondsRecharged: row.lifetime_diamonds_recharged === undefined ? 0 : Number(row.lifetime_diamonds_recharged),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    deletedAt: row.deleted_at instanceof Date ? row.deleted_at.toISOString() : (row.deleted_at || null),
  };
}

class InMemoryAccountRepository {
  constructor() {
    this._store = new Map();
  }

  async create() {
    const account = createAccount();
    this._store.set(account.id, account);
    return account;
  }

  async findById(id) {
    return this._store.get(id) || null;
  }

  async list() {
    return Array.from(this._store.values());
  }

  // Adds `amount` XP and recomputes lvl from the new total in one
  // operation (no intermediate state where xp and lvl disagree).
  async addXp(accountId, amount) {
    assertPositiveIntegerAmount(amount, 'amount');
    const account = this._store.get(accountId);
    if (!account) throw accountNotFound();
    const newXp = account.xp + amount;
    const updated = Object.freeze({
      ...account,
      xp: newXp,
      lvl: levelForXp(newXp),
      updatedAt: new Date().toISOString(),
    });
    this._store.set(accountId, updated);
    return updated;
  }

  // Adds `amount` to the lifetime-recharged counter and recomputes
  // vip/svip from the new total in one operation.
  async addLifetimeRecharge(accountId, amount) {
    assertPositiveIntegerAmount(amount, 'amount');
    const account = this._store.get(accountId);
    if (!account) throw accountNotFound();
    const newLifetime = account.lifetimeDiamondsRecharged + amount;
    const updated = Object.freeze({
      ...account,
      lifetimeDiamondsRecharged: newLifetime,
      vip: vipTierForLifetimeDiamonds(newLifetime),
      svip: svipTierForLifetimeDiamonds(newLifetime),
      updatedAt: new Date().toISOString(),
    });
    this._store.set(accountId, updated);
    return updated;
  }

  // Stage 34 — Delete Account (SAFE soft delete only, see
  // ../schema/026_add_account_soft_delete.sql). Idempotent: soft-deleting
  // an already-deleted account is a real no-op that returns the existing
  // record unchanged (never throws "already deleted"), same "not found /
  // already-in-target-state is a valid outcome" discipline used elsewhere
  // in this project (e.g. notification.repository.js's markRead()). Does
  // NOT touch any other field on the account and does NOT cascade into
  // any other stage's tables -- that is intentionally out of scope, per
  // the explicit Stage 34 instruction.
  async softDelete(accountId) {
    const account = this._store.get(accountId);
    if (!account) throw accountNotFound();
    if (account.deletedAt) return account; // idempotent no-op
    const updated = Object.freeze({
      ...account,
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    this._store.set(accountId, updated);
    return updated;
  }

  // Stage 36 — Central Staff/RBAC + Admin Panel. Only ever reachable
  // through a caller that has already checked
  // ../../security/staff.js's hasPermission(..., 'account:suspend') --
  // this method itself does not (and cannot) check who is calling; it
  // trusts `actorId` exactly as much as the caller's own authorization
  // check did, same division of responsibility as
  // ../../services/inventory-admin.service.js's grant() trusting
  // isAdmin() before it ever reaches inventory.grant().
  //
  // Idempotent no-op contract, same discipline as softDelete() above and
  // notification.repository.js's markRead(): re-suspending an already-
  // suspended account returns the existing record UNCHANGED (original
  // reason/actor/timestamp preserved) rather than throwing or silently
  // overwriting who-suspended-it-and-why. A caller that genuinely wants
  // to change the recorded reason must unsuspend() then suspend() again.
  async suspend(accountId, { reason, actorId } = {}) {
    assertNonEmptyString(reason, 'reason');
    assertNonEmptyString(actorId, 'actorId');
    const account = this._store.get(accountId);
    if (!account) throw accountNotFound();
    if (account.suspendedAt) return account; // idempotent no-op
    const updated = Object.freeze({
      ...account,
      suspendedAt: new Date().toISOString(),
      suspendedReason: reason.trim(),
      suspendedBy: actorId,
      updatedAt: new Date().toISOString(),
    });
    this._store.set(accountId, updated);
    return updated;
  }

  // Same idempotent-no-op contract as suspend() above: unsuspending an
  // already-active account is a real no-op that returns the existing
  // record unchanged. Clears all three suspension fields together --
  // there is no valid state where one is set and the others are not.
  async unsuspend(accountId, { actorId } = {}) {
    assertNonEmptyString(actorId, 'actorId');
    const account = this._store.get(accountId);
    if (!account) throw accountNotFound();
    if (!account.suspendedAt) return account; // idempotent no-op
    const updated = Object.freeze({
      ...account,
      suspendedAt: null,
      suspendedReason: null,
      suspendedBy: null,
      updatedAt: new Date().toISOString(),
    });
    this._store.set(accountId, updated);
    return updated;
  }

  // Read-only listing for the Stage 36 admin panel (Users/Bans surface).
  // No pagination params yet -- same "list() returns everything, callers
  // page client-side for now" contract this repository's own list()
  // already has above; a real deployment with a large suspended set is
  // exactly the kind of thing that motivates swapping this in-memory
  // implementation for PostgresAccountRepository (see ../index.js).
  async listSuspended() {
    return Array.from(this._store.values()).filter((a) => !!a.suspendedAt);
  }
}

class PostgresAccountRepository {
  // `pool` is a `pg` Pool instance. Not constructed anywhere in Stage 3 —
  // see ../index.js for the (currently disabled) wiring.
  constructor(pool) {
    this._pool = pool;
  }

  async create() {
    const account = createAccount();
    await this._pool.query(
      `INSERT INTO accounts (id, vip, svip, lvl, xp, coins, diamonds, lifetime_diamonds_recharged, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        account.id,
        account.vip,
        account.svip,
        account.lvl,
        account.xp,
        account.coins,
        account.diamonds,
        account.lifetimeDiamondsRecharged,
        account.createdAt,
        account.updatedAt,
      ]
    );
    return account;
  }

  async findById(id) {
    const { rows } = await this._pool.query('SELECT * FROM accounts WHERE id = $1', [id]);
    return mapAccountRow(rows[0]);
  }

  async list() {
    const { rows } = await this._pool.query('SELECT * FROM accounts ORDER BY created_at DESC');
    return rows.map(mapAccountRow);
  }

  // Atomic: SELECT ... FOR UPDATE locks the row for the duration of the
  // transaction so a concurrent addXp() on the same account can never
  // read the pre-increment xp -- the increment and the lvl recompute
  // that depends on it commit together or not at all. Not exercised in
  // this sandbox (no live Postgres -- see Database/STAGE3_TODO.md), same
  // status as PostgresGiftRepository.createWithDebit().
  async addXp(accountId, amount) {
    assertPositiveIntegerAmount(amount, 'amount');
    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT xp FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
      if (!rows.length) { await client.query('ROLLBACK'); throw accountNotFound(); }
      const newXp = Number(rows[0].xp) + amount;
      const newLvl = levelForXp(newXp);
      const { rows: updatedRows } = await client.query(
        'UPDATE accounts SET xp = $1, lvl = $2, updated_at = now() WHERE id = $3 RETURNING *',
        [newXp, newLvl, accountId]
      );
      await client.query('COMMIT');
      return mapAccountRow(updatedRows[0]);
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw e;
    } finally {
      client.release();
    }
  }

  // Same atomicity guarantee as addXp() above, for the lifetime-recharge
  // counter and the vip/svip tiers derived from it.
  async addLifetimeRecharge(accountId, amount) {
    assertPositiveIntegerAmount(amount, 'amount');
    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT lifetime_diamonds_recharged FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
      if (!rows.length) { await client.query('ROLLBACK'); throw accountNotFound(); }
      const newLifetime = Number(rows[0].lifetime_diamonds_recharged) + amount;
      const newVip = vipTierForLifetimeDiamonds(newLifetime);
      const newSvip = svipTierForLifetimeDiamonds(newLifetime);
      const { rows: updatedRows } = await client.query(
        'UPDATE accounts SET lifetime_diamonds_recharged = $1, vip = $2, svip = $3, updated_at = now() WHERE id = $4 RETURNING *',
        [newLifetime, newVip, newSvip, accountId]
      );
      await client.query('COMMIT');
      return mapAccountRow(updatedRows[0]);
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw e;
    } finally {
      client.release();
    }
  }

  // Same idempotent-no-op contract as InMemoryAccountRepository.softDelete()
  // above. WHERE deleted_at IS NULL means an already-deleted account is a
  // real no-op update (0 rows affected) rather than an error or a
  // re-stamped timestamp.
  async softDelete(accountId) {
    const { rows } = await this._pool.query(
      `UPDATE accounts SET deleted_at = now(), updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [accountId]
    );
    if (rows[0]) return mapAccountRow(rows[0]);
    return this.findById(accountId); // already deleted, or truly missing (findById handles both)
  }

  // Stage 36 — same contract as InMemoryAccountRepository.suspend()
  // above: idempotent no-op if already suspended (WHERE suspended_at IS
  // NULL means an already-suspended account is 0 rows affected, not an
  // error or a re-stamped/overwritten reason).
  async suspend(accountId, { reason, actorId } = {}) {
    assertNonEmptyString(reason, 'reason');
    assertNonEmptyString(actorId, 'actorId');
    const { rows } = await this._pool.query(
      `UPDATE accounts
       SET suspended_at = now(), suspended_reason = $2, suspended_by = $3, updated_at = now()
       WHERE id = $1 AND suspended_at IS NULL
       RETURNING *`,
      [accountId, reason.trim(), actorId]
    );
    if (rows[0]) return mapAccountRow(rows[0]);
    const existing = await this.findById(accountId);
    if (!existing) throw accountNotFound();
    return existing; // already suspended -- idempotent no-op
  }

  // Same idempotent-no-op contract as unsuspend() above, mirrored for
  // Postgres: WHERE suspended_at IS NOT NULL means an already-active
  // account is 0 rows affected.
  async unsuspend(accountId, { actorId } = {}) {
    assertNonEmptyString(actorId, 'actorId');
    const { rows } = await this._pool.query(
      `UPDATE accounts
       SET suspended_at = NULL, suspended_reason = NULL, suspended_by = NULL, updated_at = now()
       WHERE id = $1 AND suspended_at IS NOT NULL
       RETURNING *`,
      [accountId]
    );
    if (rows[0]) return mapAccountRow(rows[0]);
    const existing = await this.findById(accountId);
    if (!existing) throw accountNotFound();
    return existing; // already active -- idempotent no-op
  }

  // Uses the partial index from 028_add_account_suspension.sql
  // (idx_accounts_suspended_at) rather than a full-table scan.
  async listSuspended() {
    const { rows } = await this._pool.query(
      'SELECT * FROM accounts WHERE suspended_at IS NOT NULL ORDER BY suspended_at DESC'
    );
    return rows.map(mapAccountRow);
  }
}

module.exports = { InMemoryAccountRepository, PostgresAccountRepository };
