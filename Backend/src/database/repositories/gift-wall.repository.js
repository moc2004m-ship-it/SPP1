// Stage 26 — Gift Wall repository.
//
// Persists which Host Room Session a room's gifts currently belong to,
// plus the running per-gifter contribution totals for that session. This
// is the SOLE server-side source of truth for "who is on the gift wall
// right now, and how much have they given" -- nothing here ever accepts a
// client-supplied total; every amount recorded here is handed in by
// services/gift-wall.service.js, which itself only ever forwards the
// amount already debited (and already committed) by services/gifts.service.js.
//
// Same dual-implementation pattern as every other Phase 5 domain
// (gift.repository.js, wallet.repository.js, ...):
//   - InMemoryGiftWallRepository: ACTIVE today.
//   - PostgresGiftWallRepository: ready for later, written against
//     src/database/schema/022_create_gift_wall_sessions.sql.

const { generateGiftWallSessionId } = require('../models/gift-wall.model');

function sortContributionsDesc(list) {
  return [...list].sort((a, b) => b.totalCoins - a.totalCoins);
}

class InMemoryGiftWallRepository {
  constructor() {
    this._sessions = new Map(); // sessionId -> session
    this._activeByRoom = new Map(); // roomId -> sessionId (only while active)
    this._contributions = new Map(); // sessionId -> Map(gifterId -> totalCoins)
    this._appliedGiftIds = new Set(); // dedupe guard -- never process the same gift twice
  }

  async getActiveSession(roomId) {
    const sessionId = this._activeByRoom.get(roomId);
    if (!sessionId) return null;
    return this._sessions.get(sessionId) || null;
  }

  // Atomic from the caller's point of view (single JS event-loop turn, no
  // await between check and create) -- there can never be two active
  // sessions for the same room out of this method.
  async getOrCreateActiveSession(roomId) {
    const existing = await this.getActiveSession(roomId);
    if (existing) return existing;
    const session = Object.freeze({
      id: generateGiftWallSessionId(),
      roomId,
      status: 'active',
      startedAt: new Date().toISOString(),
      closedAt: null,
    });
    this._sessions.set(session.id, session);
    this._activeByRoom.set(roomId, session.id);
    this._contributions.set(session.id, new Map());
    return session;
  }

  async getSessionById(sessionId) {
    return this._sessions.get(sessionId) || null;
  }

  async closeSession(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) throw Object.assign(new Error('gift wall session not found'), { status: 404 });
    if (session.status === 'closed') return session; // idempotent -- closing twice is a no-op, not an error
    const closed = Object.freeze({ ...session, status: 'closed', closedAt: new Date().toISOString() });
    this._sessions.set(sessionId, closed);
    if (this._activeByRoom.get(session.roomId) === sessionId) {
      this._activeByRoom.delete(session.roomId);
    }
    return closed;
  }

  // Idempotent: applying the same giftId twice never double-counts. This
  // is the double-counting guard required independently of anything
  // gifts.service.js does upstream (defense in depth, not a duplicate of
  // the wallet debit -- no money moves here, ever).
  async addContribution({ sessionId, gifterId, giftId, amount }) {
    if (this._appliedGiftIds.has(giftId)) {
      const totals = this._contributions.get(sessionId);
      return { applied: false, totalCoins: totals ? totals.get(gifterId) || 0 : 0 };
    }
    if (!this._sessions.has(sessionId)) {
      throw Object.assign(new Error('gift wall session not found'), { status: 404 });
    }
    this._appliedGiftIds.add(giftId);
    const totals = this._contributions.get(sessionId);
    const next = (totals.get(gifterId) || 0) + amount;
    totals.set(gifterId, next);
    return { applied: true, totalCoins: next };
  }

  async getContributions(sessionId) {
    const totals = this._contributions.get(sessionId);
    if (!totals) return [];
    return sortContributionsDesc(
      Array.from(totals.entries()).map(([gifterId, totalCoins]) => ({ gifterId, totalCoins }))
    );
  }
}

class PostgresGiftWallRepository {
  constructor(pool) {
    this._pool = pool;
  }

  async getActiveSession(roomId) {
    const { rows } = await this._pool.query(
      `SELECT * FROM gift_wall_sessions WHERE room_id = $1 AND status = 'active'`,
      [roomId]
    );
    return rows[0] ? this._mapSession(rows[0]) : null;
  }

  // Relies on the partial unique index (gift_wall_sessions_one_active_per_room)
  // as the real race-safety guarantee under concurrent requests -- the
  // INSERT ... ON CONFLICT DO NOTHING + re-select below can never end up
  // with two active sessions for the same room, even if two requests race.
  async getOrCreateActiveSession(roomId) {
    const id = generateGiftWallSessionId();
    await this._pool.query(
      `INSERT INTO gift_wall_sessions (id, room_id, status)
       VALUES ($1, $2, 'active')
       ON CONFLICT (room_id) WHERE status = 'active' DO NOTHING`,
      [id, roomId]
    );
    const { rows } = await this._pool.query(
      `SELECT * FROM gift_wall_sessions WHERE room_id = $1 AND status = 'active'`,
      [roomId]
    );
    return this._mapSession(rows[0]);
  }

  async getSessionById(sessionId) {
    const { rows } = await this._pool.query('SELECT * FROM gift_wall_sessions WHERE id = $1', [sessionId]);
    return rows[0] ? this._mapSession(rows[0]) : null;
  }

  async closeSession(sessionId) {
    const { rows } = await this._pool.query(
      `UPDATE gift_wall_sessions SET status = 'closed', closed_at = now()
       WHERE id = $1 AND status = 'active' RETURNING *`,
      [sessionId]
    );
    if (rows.length) return this._mapSession(rows[0]);
    // Already closed (or never existed) -- distinguish the two so the
    // service layer can return a real 404 instead of pretending success.
    const existing = await this.getSessionById(sessionId);
    if (!existing) throw Object.assign(new Error('gift wall session not found'), { status: 404 });
    return existing; // idempotent -- closing twice is a no-op, not an error
  }

  async addContribution({ sessionId, gifterId, giftId, amount }) {
    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO gift_wall_applied_gifts (gift_id, session_id) VALUES ($1, $2)
         ON CONFLICT (gift_id) DO NOTHING RETURNING gift_id`,
        [giftId, sessionId]
      );
      if (!inserted.rows.length) {
        // Already applied -- real double-counting guard, not a race window.
        await client.query('ROLLBACK');
        const { rows } = await this._pool.query(
          `SELECT total_coins FROM gift_wall_contributions WHERE session_id = $1 AND gifter_id = $2`,
          [sessionId, gifterId]
        );
        return { applied: false, totalCoins: rows[0] ? Number(rows[0].total_coins) : 0 };
      }
      const { rows } = await client.query(
        `INSERT INTO gift_wall_contributions (session_id, gifter_id, total_coins)
         VALUES ($1, $2, $3)
         ON CONFLICT (session_id, gifter_id)
         DO UPDATE SET total_coins = gift_wall_contributions.total_coins + EXCLUDED.total_coins
         RETURNING total_coins`,
        [sessionId, gifterId, amount]
      );
      await client.query('COMMIT');
      return { applied: true, totalCoins: Number(rows[0].total_coins) };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw e;
    } finally {
      client.release();
    }
  }

  async getContributions(sessionId) {
    const { rows } = await this._pool.query(
      `SELECT gifter_id, total_coins FROM gift_wall_contributions
       WHERE session_id = $1 ORDER BY total_coins DESC`,
      [sessionId]
    );
    return rows.map((r) => ({ gifterId: r.gifter_id, totalCoins: Number(r.total_coins) }));
  }

  _mapSession(row) {
    if (!row) return null;
    return {
      id: row.id,
      roomId: row.room_id,
      status: row.status,
      startedAt: row.started_at instanceof Date ? row.started_at.toISOString() : row.started_at,
      closedAt: row.closed_at instanceof Date ? row.closed_at.toISOString() : row.closed_at,
    };
  }
}

module.exports = { InMemoryGiftWallRepository, PostgresGiftWallRepository };
