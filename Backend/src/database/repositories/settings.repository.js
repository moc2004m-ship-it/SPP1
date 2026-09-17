// Stage 34 — General Settings repository.
//
// Same dual-implementation pattern as notification.repository.js/
// guard.repository.js:
//   - InMemorySettingsRepository: ACTIVE today (no network in this
//     sandbox -- see Database/STAGE3_TODO.md).
//   - PostgresSettingsRepository: ready for later, matches
//     ../schema/025_create_settings.sql. NOT exercised in this sandbox --
//     reviewed but never run against a live database, same status as
//     every other Postgres* class in this project.
//
// One entity: one row per (userId, key), REAL update-in-place (upsert),
// replacing the old append-only `store.add(34, ...)` behavior -- there is
// never more than one current row for a given user+key, so "read current
// settings" is a plain lookup, not a reduction over history (see
// STAGE_34_FINAL_REPORT.md §2/§3 for the before/after).
//
// ALL authorization/validation decisions (who may read/write which
// user's settings, key/value validation) live in
// ../../services/settings.service.js, which is the ONLY caller of this
// repository -- same "repository = data-integrity only" split as every
// other Phase 5 repository here.

const { generateSettingId } = require('../models/settings.model');

// ---------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------

class InMemorySettingsRepository {
  constructor() {
    this._rows = new Map(); // "userId::key" -> row
  }

  _key(userId, key) {
    return `${userId}::${key}`;
  }

  // Real upsert: a second call for the same (userId, key) updates the
  // existing row in place (keeping its original id/createdAt) instead of
  // creating a duplicate -- the core fix over the old append-only stub.
  async upsert(userId, key, value, now) {
    const nowIso = now.toISOString();
    const mapKey = this._key(userId, key);
    const existing = this._rows.get(mapKey);
    const updated = Object.freeze({
      id: existing ? existing.id : generateSettingId(),
      userId,
      key,
      value,
      createdAt: existing ? existing.createdAt : nowIso,
      updatedAt: nowIso,
    });
    this._rows.set(mapKey, updated);
    return updated;
  }

  async get(userId, key) {
    return this._rows.get(this._key(userId, key)) || null;
  }

  async listForUser(userId) {
    return Array.from(this._rows.values()).filter((r) => r.userId === userId);
  }
}

// ---------------------------------------------------------------------
// Postgres implementation — matches schema/025_create_settings.sql.
// NOT exercised in this sandbox (no network -- see
// Database/STAGE3_TODO.md): reviewed but never run against a live
// database, same status as every other Postgres* repository here.
// ---------------------------------------------------------------------

function mapSettingRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    key: row.key,
    value: typeof row.value === 'string' ? JSON.parse(row.value) : row.value,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

class PostgresSettingsRepository {
  constructor(pool) {
    this._pool = pool;
  }

  async upsert(userId, key, value, now) {
    const { rows } = await this._pool.query(
      `INSERT INTO settings (id, user_id, key, value, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT (user_id, key) DO UPDATE SET value = $4, updated_at = $5
       RETURNING *`,
      [generateSettingId(), userId, key, JSON.stringify(value), now]
    );
    return mapSettingRow(rows[0]);
  }

  async get(userId, key) {
    const { rows } = await this._pool.query(
      'SELECT * FROM settings WHERE user_id = $1 AND key = $2',
      [userId, key]
    );
    return mapSettingRow(rows[0]);
  }

  async listForUser(userId) {
    const { rows } = await this._pool.query('SELECT * FROM settings WHERE user_id = $1', [userId]);
    return rows.map(mapSettingRow);
  }
}

module.exports = { InMemorySettingsRepository, PostgresSettingsRepository };
