// Stage 32 — Couple/CP repository.
//
// Same dual-implementation pattern as family.repository.js:
//   - InMemoryCoupleRepository: ACTIVE today (no network in this sandbox
//     -- see Database/STAGE3_TODO.md).
//   - PostgresCoupleRepository: ready for later, matches
//     src/database/schema/019_create_couples.sql. NOT exercised in this
//     sandbox -- reviewed but never run against a live database, same
//     status as every other Postgres* class in this project.
//
// Two related entities live here because an invite is meaningless apart
// from the couple it may create:
//   - couples        : { id, accountA, accountB, status, cpValue, level, createdAt, updatedAt, endedAt }
//     status in ('active','ended')   -- see ../models/couple.model.js COUPLE_STATUSES
//   - couple_invites  : { id, inviterId, inviteeId, status, createdAt, updatedAt }
//     status in ('pending','accepted','declined','cancelled')
//
// ALL authorization/business-rule decisions (one-active-couple-per-account,
// only the invitee may respond, self-pairing blocked, ...) live in
// ../../services/couple.service.js, which is the ONLY caller of this
// repository. This file only guarantees data integrity: real recomputed
// level on every cp change, no double-application of the same
// contribution.
//
// accountA/accountB are stored in a canonical order (accountA is
// whichever of the two ids sorts first lexicographically) purely so that
// findActiveCoupleByAccount()/findCoupleBetween() have one predictable
// place to look, never as a hierarchy between the two partners -- a
// couple is symmetric, neither side outranks the other (see
// couple.service.js's header comment).

const { generateCoupleId, generateInviteId } = require('../models/couple.model');
const { levelForCoupleCp } = require('../../domain/couple-level-curve');

function coupleNotFound() {
  return Object.assign(new Error('couple not found'), { status: 404 });
}

function inviteNotFound() {
  return Object.assign(new Error('invite not found'), { status: 404 });
}

function orderPair(accountA, accountB) {
  return accountA < accountB ? [accountA, accountB] : [accountB, accountA];
}

// ---------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------

class InMemoryCoupleRepository {
  constructor() {
    this._couples = new Map(); // id -> couple
    this._invites = new Map(); // id -> invite
  }

  async createCouple(accountX, accountY) {
    const [accountA, accountB] = orderPair(accountX, accountY);
    const now = new Date().toISOString();
    const couple = Object.freeze({
      id: generateCoupleId(),
      accountA,
      accountB,
      status: 'active',
      cpValue: 0,
      level: 0,
      createdAt: now,
      updatedAt: now,
      endedAt: null,
    });
    this._couples.set(couple.id, couple);
    return couple;
  }

  async findCoupleById(coupleId) {
    return this._couples.get(coupleId) || null;
  }

  // The account's single currently-active couple, or null. Used to
  // enforce "one active relationship at a time" -- same shape as
  // family.repository.js's findActiveMembershipByAccount().
  async findActiveCoupleByAccount(accountId) {
    for (const couple of this._couples.values()) {
      if (couple.status === 'active' && (couple.accountA === accountId || couple.accountB === accountId)) {
        return couple;
      }
    }
    return null;
  }

  async _requireCouple(coupleId) {
    const couple = this._couples.get(coupleId);
    if (!couple) throw coupleNotFound();
    return couple;
  }

  // Atomically adds `amount` to the couple's real cpValue, recomputing
  // level from the new cp in the same operation, so level can never
  // drift out of sync with cp -- same discipline as
  // family.repository.js's addContribution().
  async addCp(coupleId, amount) {
    const couple = await this._requireCouple(coupleId);
    const newCp = couple.cpValue + amount;
    const updated = Object.freeze({
      ...couple,
      cpValue: newCp,
      level: levelForCoupleCp(newCp),
      updatedAt: new Date().toISOString(),
    });
    this._couples.set(coupleId, updated);
    return updated;
  }

  async endCouple(coupleId) {
    const couple = await this._requireCouple(coupleId);
    const now = new Date().toISOString();
    const updated = Object.freeze({ ...couple, status: 'ended', updatedAt: now, endedAt: now });
    this._couples.set(coupleId, updated);
    return updated;
  }

  async createInvite({ inviterId, inviteeId }) {
    const now = new Date().toISOString();
    const invite = Object.freeze({
      id: generateInviteId(),
      inviterId,
      inviteeId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
    this._invites.set(invite.id, invite);
    return invite;
  }

  async findInviteById(inviteId) {
    return this._invites.get(inviteId) || null;
  }

  async listPendingInvitesForAccount(accountId) {
    return Array.from(this._invites.values()).filter((i) => i.inviteeId === accountId && i.status === 'pending');
  }

  // Any pending invite between these two accounts in EITHER direction --
  // used to block a duplicate invite while one is already outstanding,
  // regardless of who sent it.
  async findPendingInviteBetween(accountX, accountY) {
    return (
      Array.from(this._invites.values()).find(
        (i) =>
          i.status === 'pending' &&
          ((i.inviterId === accountX && i.inviteeId === accountY) ||
            (i.inviterId === accountY && i.inviteeId === accountX))
      ) || null
    );
  }

  async updateInviteStatus(inviteId, status) {
    const current = this._invites.get(inviteId);
    if (!current) throw inviteNotFound();
    const updated = Object.freeze({ ...current, status, updatedAt: new Date().toISOString() });
    this._invites.set(inviteId, updated);
    return updated;
  }
}

// ---------------------------------------------------------------------
// Postgres implementation — matches schema/019_create_couples.sql.
// NOT exercised in this sandbox (no network -- see
// Database/STAGE3_TODO.md): reviewed but never run against a live
// database, same status as every other Postgres* repository here.
// ---------------------------------------------------------------------

function mapCoupleRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountA: row.account_a,
    accountB: row.account_b,
    status: row.status,
    cpValue: Number(row.cp_value),
    level: row.level,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    endedAt: row.ended_at instanceof Date ? row.ended_at.toISOString() : row.ended_at,
  };
}

function mapInviteRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    inviterId: row.inviter_id,
    inviteeId: row.invitee_id,
    status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

class PostgresCoupleRepository {
  constructor(pool) {
    this._pool = pool;
  }

  async createCouple(accountX, accountY) {
    const [accountA, accountB] = orderPair(accountX, accountY);
    const { rows } = await this._pool.query(
      `INSERT INTO couples (id, account_a, account_b, status, cp_value, level)
       VALUES ($1, $2, $3, 'active', 0, 0) RETURNING *`,
      [generateCoupleId(), accountA, accountB]
    );
    return mapCoupleRow(rows[0]);
  }

  async findCoupleById(coupleId) {
    const { rows } = await this._pool.query('SELECT * FROM couples WHERE id = $1', [coupleId]);
    return mapCoupleRow(rows[0]);
  }

  async findActiveCoupleByAccount(accountId) {
    const { rows } = await this._pool.query(
      `SELECT * FROM couples WHERE status = 'active' AND (account_a = $1 OR account_b = $1) LIMIT 1`,
      [accountId]
    );
    return mapCoupleRow(rows[0]);
  }

  // Same atomicity guarantee as family.repository.js's addContribution():
  // the cp increment and level recompute happen inside one transaction
  // with a row lock on the couple, so a concurrent gift can never read
  // stale cp.
  async addCp(coupleId, amount) {
    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: coupleRows } = await client.query('SELECT * FROM couples WHERE id = $1 FOR UPDATE', [coupleId]);
      if (!coupleRows.length) {
        await client.query('ROLLBACK');
        throw coupleNotFound();
      }
      const newCp = Number(coupleRows[0].cp_value) + amount;
      const newLevel = levelForCoupleCp(newCp);
      const { rows: updatedRows } = await client.query(
        `UPDATE couples SET cp_value = $1, level = $2, updated_at = now() WHERE id = $3 RETURNING *`,
        [newCp, newLevel, coupleId]
      );
      await client.query('COMMIT');
      return mapCoupleRow(updatedRows[0]);
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {}
      throw e;
    } finally {
      client.release();
    }
  }

  async endCouple(coupleId) {
    const { rows } = await this._pool.query(
      `UPDATE couples SET status = 'ended', updated_at = now(), ended_at = now() WHERE id = $1 RETURNING *`,
      [coupleId]
    );
    if (!rows.length) throw coupleNotFound();
    return mapCoupleRow(rows[0]);
  }

  async createInvite({ inviterId, inviteeId }) {
    const { rows } = await this._pool.query(
      `INSERT INTO couple_invites (id, inviter_id, invitee_id, status)
       VALUES ($1, $2, $3, 'pending') RETURNING *`,
      [generateInviteId(), inviterId, inviteeId]
    );
    return mapInviteRow(rows[0]);
  }

  async findInviteById(inviteId) {
    const { rows } = await this._pool.query('SELECT * FROM couple_invites WHERE id = $1', [inviteId]);
    return mapInviteRow(rows[0]);
  }

  async listPendingInvitesForAccount(accountId) {
    const { rows } = await this._pool.query(
      `SELECT * FROM couple_invites WHERE invitee_id = $1 AND status = 'pending' ORDER BY created_at DESC`,
      [accountId]
    );
    return rows.map(mapInviteRow);
  }

  async findPendingInviteBetween(accountX, accountY) {
    const { rows } = await this._pool.query(
      `SELECT * FROM couple_invites
       WHERE status = 'pending'
         AND ((inviter_id = $1 AND invitee_id = $2) OR (inviter_id = $2 AND invitee_id = $1))
       LIMIT 1`,
      [accountX, accountY]
    );
    return mapInviteRow(rows[0]);
  }

  async updateInviteStatus(inviteId, status) {
    const { rows } = await this._pool.query(
      `UPDATE couple_invites SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [status, inviteId]
    );
    if (!rows.length) throw inviteNotFound();
    return mapInviteRow(rows[0]);
  }
}

module.exports = {
  InMemoryCoupleRepository,
  PostgresCoupleRepository,
  coupleNotFound,
  inviteNotFound,
};
