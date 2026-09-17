// Stage 3 — Reference/Transaction repository.
// Same pattern as account.repository.js: an active in-memory implementation
// today, and a Postgres-backed one ready for whichever future stage needs
// it, without changing the model or its callers.

const { createReference, transitionReferenceStatus } = require('../models/reference.model');

function mapReferenceRow(row) {
  if (!row) return null;
  return { ...row, userId: row.user_id, createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at, updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at };
}

class InMemoryReferenceRepository {
  constructor() {
    this._store = new Map();
  }

  async create(input) {
    const reference = createReference(input);
    this._store.set(reference.id, reference);
    return reference;
  }

  async findById(id) {
    return this._store.get(id) || null;
  }

  async updateStatus(id, nextStatus) {
    const existing = this._store.get(id);
    if (!existing) return null;
    const updated = transitionReferenceStatus(existing, nextStatus);
    this._store.set(id, updated);
    return updated;
  }

  async listByUserId(userId) {
    return Array.from(this._store.values()).filter((ref) => ref.userId === userId);
  }
}

class PostgresReferenceRepository {
  constructor(pool) {
    this._pool = pool;
  }

  async create(input) {
    const reference = createReference(input);
    await this._pool.query(
      `INSERT INTO references_log (id, type, status, user_id, amount, currency, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        reference.id,
        reference.type,
        reference.status,
        reference.userId,
        reference.amount,
        reference.currency,
        reference.metadata,
        reference.createdAt,
        reference.updatedAt,
      ]
    );
    return reference;
  }

  async findById(id) {
    const { rows } = await this._pool.query('SELECT * FROM references_log WHERE id = $1', [id]);
    return mapReferenceRow(rows[0]);
  }

  async updateStatus(id, nextStatus) {
    const { rows } = await this._pool.query(
      `UPDATE references_log SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, nextStatus]
    );
    return mapReferenceRow(rows[0]);
  }

  async listByUserId(userId) {
    const { rows } = await this._pool.query(
      'SELECT * FROM references_log WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return rows.map(mapReferenceRow);
  }
}

module.exports = { InMemoryReferenceRepository, PostgresReferenceRepository };
