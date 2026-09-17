// Stage 36 — Central Audit Log repository.
//
// Same dual-implementation pattern as every Phase 5 repository
// (notification.repository.js, guard.repository.js, etc.):
//   - InMemoryAuditLogRepository: ACTIVE today (no external database in
//     this sandbox -- see Database/STAGE3_TODO.md).
//   - PostgresAuditLogRepository: ready for later, matches
//     ../schema/029_create_audit_log.sql. NOT exercised in this sandbox,
//     same status as every other Postgres* class in this project.
//
// This is an append-only log: `record()` is the only write method either
// implementation exposes. There is deliberately no update()/delete() —
// an audit trail an admin (or a bug) can edit after the fact provides no
// real guarantee to anyone relying on it, and nothing in Stage 36's
// admin-panel requirements asks for one. All authorization for WHO may
// call record() or read the log lives in ../../services/audit.service.js
// and ../../security/staff.js (AUDIT_VIEW permission) — this file owns
// only the storage mechanics, same "repository = data-integrity only"
// split as every other repository here.

const { generateAuditLogId } = require('../id-generator');

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw Object.assign(new Error(`${label} must be a non-empty string`), { status: 400 });
  }
}

function mapAuditRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    actorId: row.actor_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason === undefined ? null : row.reason,
    metadata: row.metadata || {},
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

class InMemoryAuditLogRepository {
  constructor() {
    this._entries = []; // append-only, oldest first
  }

  async record({ actorId, action, targetType, targetId, reason, metadata }) {
    assertNonEmptyString(actorId, 'actorId');
    assertNonEmptyString(action, 'action');
    assertNonEmptyString(targetType, 'targetType');
    assertNonEmptyString(targetId, 'targetId');
    const entry = Object.freeze({
      id: generateAuditLogId(),
      actorId,
      action,
      targetType,
      targetId,
      reason: reason === undefined || reason === null ? null : String(reason),
      metadata: metadata ? Object.freeze({ ...metadata }) : Object.freeze({}),
      createdAt: new Date().toISOString(),
    });
    this._entries.push(entry);
    return entry;
  }

  // Newest-first, optionally filtered — mirrors the query shapes the
  // Stage 36 admin panel's audit view actually needs (by actor, by
  // action, by target), same discipline as the Postgres implementation's
  // three indexes below.
  async list({ actorId, action, targetType, targetId, limit = 100 } = {}) {
    let results = this._entries;
    if (actorId) results = results.filter((e) => e.actorId === actorId);
    if (action) results = results.filter((e) => e.action === action);
    if (targetType) results = results.filter((e) => e.targetType === targetType);
    if (targetId) results = results.filter((e) => e.targetId === targetId);
    return results
      .slice()
      .reverse()
      .slice(0, Math.max(0, Number(limit) || 100));
  }
}

class PostgresAuditLogRepository {
  // `pool` is a `pg` Pool instance. Not constructed anywhere in this
  // sandbox -- see ../index.js for the (currently disabled) wiring.
  constructor(pool) {
    this._pool = pool;
  }

  async record({ actorId, action, targetType, targetId, reason, metadata }) {
    assertNonEmptyString(actorId, 'actorId');
    assertNonEmptyString(action, 'action');
    assertNonEmptyString(targetType, 'targetType');
    assertNonEmptyString(targetId, 'targetId');
    const id = generateAuditLogId();
    const { rows } = await this._pool.query(
      `INSERT INTO audit_log (id, actor_id, action, target_type, target_id, reason, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        id,
        actorId,
        action,
        targetType,
        targetId,
        reason === undefined || reason === null ? null : String(reason),
        JSON.stringify(metadata || {}),
      ]
    );
    return mapAuditRow(rows[0]);
  }

  async list({ actorId, action, targetType, targetId, limit = 100 } = {}) {
    const clauses = [];
    const params = [];
    if (actorId) { params.push(actorId); clauses.push(`actor_id = $${params.length}`); }
    if (action) { params.push(action); clauses.push(`action = $${params.length}`); }
    if (targetType) { params.push(targetType); clauses.push(`target_type = $${params.length}`); }
    if (targetId) { params.push(targetId); clauses.push(`target_id = $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(Math.max(0, Number(limit) || 100));
    const { rows } = await this._pool.query(
      `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    return rows.map(mapAuditRow);
  }
}

module.exports = { InMemoryAuditLogRepository, PostgresAuditLogRepository };
