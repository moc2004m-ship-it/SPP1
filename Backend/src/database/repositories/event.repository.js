// Stage 31 — Event repository.
//
// Same dual-implementation pattern as family.repository.js:
//   - InMemoryEventRepository: ACTIVE today (no network in this sandbox
//     -- see Database/STAGE3_TODO.md).
//   - PostgresEventRepository: ready for later, matches
//     src/database/schema/018_create_events.sql. NOT exercised in this
//     sandbox -- reviewed but never run against a live database, same
//     status as every other Postgres* class in this project.
//
// Events and missions themselves are a server-owned catalog in code (see
// ../../domain/events-catalog.js), the same way store items and gift
// catalog entries are -- there is no `events` table. What IS persisted
// here is real, dynamic, per-account state that only exists because a
// real account did something:
//   - event_mission_progress : one row per (event, mission, account) ever
//     started. progress/completed are recomputed by
//     ../../services/event.service.js on every increment; claimed_at is
//     set exactly once, by claimReward(), and NEVER unset.
//   - event_shares            : one row per share action. Never
//     deduplicated -- a real account can share a real event more than
//     once, and every share is a real, timestamped action worth keeping
//     for history.
//
// ALL authorization/business-rule decisions (is the event active, has
// this mission already been completed, was it already claimed) live in
// ../../services/event.service.js, which is the ONLY caller of this
// repository. This file only guarantees data integrity: one progress row
// per (event, mission, account), and claimed_at can never be set twice.

const { generateEventShareId, generateEventProgressId } = require('../models/event.model');

function progressNotFound() {
  return Object.assign(new Error('mission progress not found'), { status: 404 });
}

function alreadyClaimed() {
  return Object.assign(new Error('this mission reward was already claimed'), { status: 409 });
}

// ---------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------

class InMemoryEventRepository {
  constructor() {
    this._progress = new Map(); // id -> row
    this._progressByKey = new Map(); // `${eventId}:${missionKey}:${accountId}` -> id
    this._shares = [];
  }

  _key(eventId, missionKey, accountId) {
    return `${eventId}:${missionKey}:${accountId}`;
  }

  async getProgress(eventId, missionKey, accountId) {
    const id = this._progressByKey.get(this._key(eventId, missionKey, accountId));
    return id ? this._progress.get(id) : null;
  }

  async listProgressForEvent(eventId, accountId) {
    return Array.from(this._progress.values()).filter((p) => p.eventId === eventId && p.accountId === accountId);
  }

  // Creates the row on first progress, otherwise updates progress/
  // completed in place. Never touches claimedAt -- that is exclusively
  // markClaimed()'s job.
  async upsertProgress({ eventId, missionKey, accountId, progress, completed }) {
    const key = this._key(eventId, missionKey, accountId);
    const existingId = this._progressByKey.get(key);
    const now = new Date().toISOString();

    if (!existingId) {
      const row = Object.freeze({
        id: generateEventProgressId(),
        eventId,
        missionKey,
        accountId,
        progress,
        completed,
        claimedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      this._progress.set(row.id, row);
      this._progressByKey.set(key, row.id);
      return row;
    }

    const current = this._progress.get(existingId);
    const updated = Object.freeze({ ...current, progress, completed, updatedAt: now });
    this._progress.set(existingId, updated);
    return updated;
  }

  // Sets claimedAt exactly once. Throws 409 if already claimed, 404 if no
  // progress row exists yet (nothing to claim).
  async markClaimed(eventId, missionKey, accountId) {
    const id = this._progressByKey.get(this._key(eventId, missionKey, accountId));
    if (!id) throw progressNotFound();
    const current = this._progress.get(id);
    if (current.claimedAt) throw alreadyClaimed();
    const updated = Object.freeze({ ...current, claimedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    this._progress.set(id, updated);
    return updated;
  }

  // Every claimed mission across every event for this account, most
  // recent first -- the real, queryable "history" of rewards actually
  // paid out.
  async listClaimsForAccount(accountId) {
    return Array.from(this._progress.values())
      .filter((p) => p.accountId === accountId && p.claimedAt)
      .sort((a, b) => (a.claimedAt < b.claimedAt ? 1 : -1));
  }

  async recordShare({ eventId, accountId }) {
    const row = Object.freeze({
      id: generateEventShareId(),
      eventId,
      accountId,
      createdAt: new Date().toISOString(),
    });
    this._shares.push(row);
    return row;
  }

  async countShares(eventId, accountId) {
    return this._shares.filter((s) => s.eventId === eventId && s.accountId === accountId).length;
  }
}

// ---------------------------------------------------------------------
// Postgres implementation
// ---------------------------------------------------------------------

function mapProgressRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    missionKey: row.mission_key,
    accountId: row.account_id,
    progress: row.progress,
    completed: row.completed,
    claimedAt: row.claimed_at instanceof Date ? row.claimed_at.toISOString() : row.claimed_at,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function mapShareRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    accountId: row.account_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

class PostgresEventRepository {
  constructor(pool) {
    this._pool = pool;
  }

  async getProgress(eventId, missionKey, accountId) {
    const { rows } = await this._pool.query(
      'SELECT * FROM event_mission_progress WHERE event_id = $1 AND mission_key = $2 AND account_id = $3',
      [eventId, missionKey, accountId]
    );
    return mapProgressRow(rows[0]);
  }

  async listProgressForEvent(eventId, accountId) {
    const { rows } = await this._pool.query(
      'SELECT * FROM event_mission_progress WHERE event_id = $1 AND account_id = $2',
      [eventId, accountId]
    );
    return rows.map(mapProgressRow);
  }

  async upsertProgress({ eventId, missionKey, accountId, progress, completed }) {
    const { rows } = await this._pool.query(
      `INSERT INTO event_mission_progress (id, event_id, mission_key, account_id, progress, completed)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (event_id, mission_key, account_id)
       DO UPDATE SET progress = EXCLUDED.progress, completed = EXCLUDED.completed, updated_at = now()
       RETURNING *`,
      [generateEventProgressId(), eventId, missionKey, accountId, progress, completed]
    );
    return mapProgressRow(rows[0]);
  }

  async markClaimed(eventId, missionKey, accountId) {
    const { rows: existingRows } = await this._pool.query(
      'SELECT * FROM event_mission_progress WHERE event_id = $1 AND mission_key = $2 AND account_id = $3',
      [eventId, missionKey, accountId]
    );
    if (!existingRows.length) throw progressNotFound();
    if (existingRows[0].claimed_at) throw alreadyClaimed();

    const { rows } = await this._pool.query(
      `UPDATE event_mission_progress SET claimed_at = now(), updated_at = now()
       WHERE event_id = $1 AND mission_key = $2 AND account_id = $3 AND claimed_at IS NULL
       RETURNING *`,
      [eventId, missionKey, accountId]
    );
    if (!rows.length) throw alreadyClaimed(); // lost a race with a concurrent claim
    return mapProgressRow(rows[0]);
  }

  async listClaimsForAccount(accountId) {
    const { rows } = await this._pool.query(
      'SELECT * FROM event_mission_progress WHERE account_id = $1 AND claimed_at IS NOT NULL ORDER BY claimed_at DESC',
      [accountId]
    );
    return rows.map(mapProgressRow);
  }

  async recordShare({ eventId, accountId }) {
    const { rows } = await this._pool.query(
      'INSERT INTO event_shares (id, event_id, account_id) VALUES ($1, $2, $3) RETURNING *',
      [generateEventShareId(), eventId, accountId]
    );
    return mapShareRow(rows[0]);
  }

  async countShares(eventId, accountId) {
    const { rows } = await this._pool.query(
      'SELECT COUNT(*)::int AS count FROM event_shares WHERE event_id = $1 AND account_id = $2',
      [eventId, accountId]
    );
    return rows[0].count;
  }
}

module.exports = { InMemoryEventRepository, PostgresEventRepository, progressNotFound, alreadyClaimed };
