// Stage 32 — Guard/Fan Club repository.
//
// Same dual-implementation pattern as couple.repository.js/
// family.repository.js:
//   - InMemoryGuardRepository: ACTIVE today (no network in this sandbox
//     -- see Database/STAGE3_TODO.md).
//   - PostgresGuardRepository: ready for later, matches
//     ../schema/020_create_guards.sql. NOT exercised in this sandbox --
//     reviewed but never run against a live database, same status as
//     every other Postgres* class in this project.
//
// One entity lives here:
//   - guards : { id, fanId, hostId, tierKey, totalContributionCoins, expiresAt, createdAt, updatedAt }
//     one row per (fanId, hostId) pair -- a fan has at most one guard
//     subscription per host, upserted (never duplicated) on renewal.
//
// ALL authorization/business-rule decisions (self-guard blocked, wallet
// debit before any grant, tier resolution) live in
// ../../services/guard.service.js, which is the ONLY caller of this
// repository. This file owns exactly one piece of real data-mechanics:
// renewGuard()'s extend-from-current-expiry-if-still-active,
// else-restart-from-now policy, atomically with the contribution total
// bump -- same "one atomic read-modify-write, no double-application"
// discipline as couple.repository.js's addCp()/family.repository.js's
// addContribution(). active/expired status itself is NEVER stored or
// read off a flag here -- guard.service.js always computes it by
// comparing expiresAt to an injected now(), same pattern as
// event.service.js's countdown -- so a status can never go stale between
// requests.

const { generateGuardId } = require('../models/guard.model');

const DAY_MS = 24 * 60 * 60 * 1000;

function guardKey(fanId, hostId) {
  return `${fanId}::${hostId}`;
}

// ---------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------

class InMemoryGuardRepository {
  constructor() {
    this._guards = new Map(); // "fanId::hostId" -> guard
  }

  async findGuard(fanId, hostId) {
    return this._guards.get(guardKey(fanId, hostId)) || null;
  }

  // Atomically upserts the (fanId, hostId) guard: if an active
  // subscription already exists (expiresAt in the future relative to
  // `now`), the new tier's days are appended onto the EXISTING expiresAt;
  // otherwise (no row yet, or the previous one already lapsed) the
  // days are counted from `now`. totalContributionCoins always
  // accumulates -- it is a lifetime total, never reset by renewal or
  // expiry. `now` is always an injected Date, never read from the
  // system clock directly here, so this stays testable and matches
  // event.service.js's discipline.
  async renewGuard({ fanId, hostId, tierKey, coins, days, now }) {
    const key = guardKey(fanId, hostId);
    const existing = this._guards.get(key) || null;
    const nowMs = now.getTime();
    const currentExpiryMs = existing ? Date.parse(existing.expiresAt) : -Infinity;
    const baseMs = currentExpiryMs > nowMs ? currentExpiryMs : nowMs;
    const newExpiresAt = new Date(baseMs + days * DAY_MS).toISOString();
    const updated = Object.freeze({
      id: existing ? existing.id : generateGuardId(),
      fanId,
      hostId,
      tierKey,
      totalContributionCoins: (existing ? existing.totalContributionCoins : 0) + coins,
      expiresAt: newExpiresAt,
      createdAt: existing ? existing.createdAt : now.toISOString(),
      updatedAt: now.toISOString(),
    });
    this._guards.set(key, updated);
    return updated;
  }

  // All of a host's guards, most-contribution-first -- used for the fan
  // club leaderboard. Active/expired is NOT filtered here (that is a
  // now()-relative business decision) -- guard.service.js's
  // listFanClub() annotates each entry with its status computed from an
  // injected now().
  async listGuardsForHost(hostId) {
    return Array.from(this._guards.values())
      .filter((g) => g.hostId === hostId)
      .sort((a, b) => b.totalContributionCoins - a.totalContributionCoins);
  }
}

// ---------------------------------------------------------------------
// Postgres implementation — matches schema/020_create_guards.sql.
// NOT exercised in this sandbox (no network -- see
// Database/STAGE3_TODO.md): reviewed but never run against a live
// database, same status as every other Postgres* repository here.
// ---------------------------------------------------------------------

function mapGuardRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    fanId: row.fan_id,
    hostId: row.host_id,
    tierKey: row.tier_key,
    totalContributionCoins: Number(row.total_contribution_coins),
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

class PostgresGuardRepository {
  constructor(pool) {
    this._pool = pool;
  }

  async findGuard(fanId, hostId) {
    const { rows } = await this._pool.query('SELECT * FROM guards WHERE fan_id = $1 AND host_id = $2', [fanId, hostId]);
    return mapGuardRow(rows[0]);
  }

  // Same atomicity guarantee as couple.repository.js's addCp(): the
  // existing row is read with a row lock inside a transaction, so a
  // concurrent renewal for the same (fanId, hostId) can never read
  // stale expiresAt/totalContributionCoins.
  async renewGuard({ fanId, hostId, tierKey, coins, days, now }) {
    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: existingRows } = await client.query(
        'SELECT * FROM guards WHERE fan_id = $1 AND host_id = $2 FOR UPDATE',
        [fanId, hostId]
      );
      const existing = existingRows[0] || null;
      const nowMs = now.getTime();
      const currentExpiryMs = existing ? Date.parse(existing.expires_at) : -Infinity;
      const baseMs = currentExpiryMs > nowMs ? currentExpiryMs : nowMs;
      const newExpiresAt = new Date(baseMs + days * DAY_MS).toISOString();

      let resultRow;
      if (existing) {
        const newTotal = Number(existing.total_contribution_coins) + coins;
        const { rows } = await client.query(
          `UPDATE guards SET tier_key = $1, total_contribution_coins = $2, expires_at = $3, updated_at = now()
           WHERE id = $4 RETURNING *`,
          [tierKey, newTotal, newExpiresAt, existing.id]
        );
        resultRow = rows[0];
      } else {
        const { rows } = await client.query(
          `INSERT INTO guards (id, fan_id, host_id, tier_key, total_contribution_coins, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [generateGuardId(), fanId, hostId, tierKey, coins, newExpiresAt]
        );
        resultRow = rows[0];
      }

      await client.query('COMMIT');
      return mapGuardRow(resultRow);
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {}
      throw e;
    } finally {
      client.release();
    }
  }

  async listGuardsForHost(hostId) {
    const { rows } = await this._pool.query(
      'SELECT * FROM guards WHERE host_id = $1 ORDER BY total_contribution_coins DESC',
      [hostId]
    );
    return rows.map(mapGuardRow);
  }
}

module.exports = {
  InMemoryGuardRepository,
  PostgresGuardRepository,
};
