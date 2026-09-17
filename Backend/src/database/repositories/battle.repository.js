// Stage 18 — Battle repository.
//
// Same dual-implementation pattern as every other dedicated Phase 5+
// domain (gift-wall.repository.js, game-match.repository.js, ...):
//   - InMemoryBattleRepository: ACTIVE today.
//   - PostgresBattleRepository: ready for later, written against
//     src/database/schema/024_create_battles.sql.
//
// Every state transition here (accept/decline/cancel/addScore/end) is
// idempotent at the repository level -- a repeated call never double-
// applies. This is what lets services/battle.service.js call end() both
// from an explicit "end battle" request AND lazily whenever a battle is
// read past its endsAt, without any risk of re-scoring or re-picking a
// winner.

const { generateBattleId } = require('../models/battle.model');

function computeWinnerId(battle) {
  if (battle.hostScore > battle.opponentScore) return battle.hostId;
  if (battle.opponentScore > battle.hostScore) return battle.opponentId;
  return null; // a real tie -- never guessed at
}

class InMemoryBattleRepository {
  constructor() {
    this._battles = new Map();
    this._openByRoom = new Map(); // roomId -> battleId (only while pending/active)
  }

  async create({ roomId, hostId, opponentId, durationMs }) {
    if (this._openByRoom.has(roomId)) {
      throw Object.assign(new Error('this room already has a pending or active battle'), { status: 409 });
    }
    const battle = {
      id: generateBattleId(),
      roomId,
      hostId,
      opponentId,
      status: 'pending',
      hostScore: 0,
      opponentScore: 0,
      winnerId: null,
      durationMs,
      startedAt: null,
      endsAt: null,
      endedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this._battles.set(battle.id, battle);
    this._openByRoom.set(roomId, battle.id);
    return { ...battle };
  }

  async findById(id) {
    const battle = this._battles.get(id);
    return battle ? { ...battle } : null;
  }

  async findOpenByRoom(roomId) {
    const battleId = this._openByRoom.get(roomId);
    if (!battleId) return null;
    const battle = this._battles.get(battleId);
    return battle ? { ...battle } : null;
  }

  async listByAccount(accountId) {
    return Array.from(this._battles.values())
      .filter((b) => b.hostId === accountId || b.opponentId === accountId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((b) => ({ ...b }));
  }

  _closeRoomSlot(battle) {
    if (this._openByRoom.get(battle.roomId) === battle.id) {
      this._openByRoom.delete(battle.roomId);
    }
  }

  async accept(id) {
    const battle = this._battles.get(id);
    if (!battle) return null;
    if (battle.status !== 'pending') return { ...battle }; // idempotent
    const startedAt = new Date();
    battle.status = 'active';
    battle.startedAt = startedAt.toISOString();
    battle.endsAt = new Date(startedAt.getTime() + battle.durationMs).toISOString();
    battle.updatedAt = battle.startedAt;
    return { ...battle };
  }

  async decline(id) {
    const battle = this._battles.get(id);
    if (!battle) return null;
    if (battle.status !== 'pending') return { ...battle }; // idempotent
    battle.status = 'declined';
    battle.updatedAt = new Date().toISOString();
    this._closeRoomSlot(battle);
    return { ...battle };
  }

  async cancel(id) {
    const battle = this._battles.get(id);
    if (!battle) return null;
    if (battle.status !== 'pending') return { ...battle }; // idempotent
    battle.status = 'cancelled';
    battle.updatedAt = new Date().toISOString();
    this._closeRoomSlot(battle);
    return { ...battle };
  }

  // Only ever called from battle.service.js#recordGiftPoints, itself only
  // ever called from services/gifts.service.js AFTER a real, already-
  // committed gift + wallet debit. A no-op once the battle is no longer
  // 'active' (defense in depth -- the service layer already checks this
  // first).
  async addScore(id, side, amount) {
    const battle = this._battles.get(id);
    if (!battle) return null;
    if (battle.status !== 'active') return { ...battle };
    if (side === 'host') battle.hostScore += amount;
    else if (side === 'opponent') battle.opponentScore += amount;
    battle.updatedAt = new Date().toISOString();
    return { ...battle };
  }

  async end(id) {
    const battle = this._battles.get(id);
    if (!battle) return null;
    if (battle.status === 'ended') return { ...battle }; // idempotent
    if (battle.status !== 'active') return { ...battle }; // nothing to end
    battle.status = 'ended';
    battle.winnerId = computeWinnerId(battle);
    battle.endedAt = new Date().toISOString();
    battle.updatedAt = battle.endedAt;
    this._closeRoomSlot(battle);
    return { ...battle };
  }
}

function mapBattleRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    roomId: row.room_id,
    hostId: row.host_id,
    opponentId: row.opponent_id,
    status: row.status,
    hostScore: Number(row.host_score),
    opponentScore: Number(row.opponent_score),
    winnerId: row.winner_id,
    durationMs: Number(row.duration_ms),
    startedAt: row.started_at instanceof Date ? row.started_at.toISOString() : row.started_at,
    endsAt: row.ends_at instanceof Date ? row.ends_at.toISOString() : row.ends_at,
    endedAt: row.ended_at instanceof Date ? row.ended_at.toISOString() : row.ended_at,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

class PostgresBattleRepository {
  constructor(pool) {
    this._pool = pool;
  }

  // Relies on battles_one_open_per_room (see 024_create_battles.sql) as
  // the real race-safety guarantee -- a second concurrent create() for the
  // same room fails at the database, it is never possible for two rows to
  // exist here even under a race.
  async create({ roomId, hostId, opponentId, durationMs }) {
    const id = generateBattleId();
    try {
      const { rows } = await this._pool.query(
        `INSERT INTO battles (id, room_id, host_id, opponent_id, duration_ms)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [id, roomId, hostId, opponentId, durationMs]
      );
      return mapBattleRow(rows[0]);
    } catch (err) {
      if (err && err.code === '23505') {
        throw Object.assign(new Error('this room already has a pending or active battle'), { status: 409 });
      }
      throw err;
    }
  }

  async findById(id) {
    const { rows } = await this._pool.query('SELECT * FROM battles WHERE id = $1', [id]);
    return mapBattleRow(rows[0]);
  }

  async findOpenByRoom(roomId) {
    const { rows } = await this._pool.query(
      `SELECT * FROM battles WHERE room_id = $1 AND status IN ('pending', 'active')`,
      [roomId]
    );
    return mapBattleRow(rows[0]);
  }

  async listByAccount(accountId) {
    const { rows } = await this._pool.query(
      `SELECT * FROM battles WHERE host_id = $1 OR opponent_id = $1 ORDER BY created_at DESC`,
      [accountId]
    );
    return rows.map(mapBattleRow);
  }

  async accept(id) {
    const { rows } = await this._pool.query(
      `UPDATE battles
       SET status = 'active', started_at = now(), ends_at = now() + (duration_ms || ' milliseconds')::interval, updated_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [id]
    );
    if (rows.length) return mapBattleRow(rows[0]);
    return this.findById(id); // idempotent -- already past pending, or not found
  }

  async decline(id) {
    const { rows } = await this._pool.query(
      `UPDATE battles SET status = 'declined', updated_at = now()
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id]
    );
    if (rows.length) return mapBattleRow(rows[0]);
    return this.findById(id);
  }

  async cancel(id) {
    const { rows } = await this._pool.query(
      `UPDATE battles SET status = 'cancelled', updated_at = now()
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id]
    );
    if (rows.length) return mapBattleRow(rows[0]);
    return this.findById(id);
  }

  async addScore(id, side, amount) {
    const column = side === 'host' ? 'host_score' : 'opponent_score';
    const { rows } = await this._pool.query(
      `UPDATE battles SET ${column} = ${column} + $2, updated_at = now()
       WHERE id = $1 AND status = 'active' RETURNING *`,
      [id, amount]
    );
    if (rows.length) return mapBattleRow(rows[0]);
    return this.findById(id);
  }

  async end(id) {
    const { rows } = await this._pool.query(
      `UPDATE battles
       SET status = 'ended',
           winner_id = CASE WHEN host_score > opponent_score THEN host_id
                            WHEN opponent_score > host_score THEN opponent_id
                            ELSE NULL END,
           ended_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'active'
       RETURNING *`,
      [id]
    );
    if (rows.length) return mapBattleRow(rows[0]);
    return this.findById(id); // idempotent -- already ended, or was never active
  }
}

module.exports = { InMemoryBattleRepository, PostgresBattleRepository, computeWinnerId };
