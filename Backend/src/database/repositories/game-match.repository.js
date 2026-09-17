// Phase 5 — Game match repository.
//
// finish() is idempotent (first call wins, a match cannot be re-finished
// with a different result) and is not called from any mobile-facing route
// today -- see services/game-match.service.js and
// PHASE5_CENTRAL_SYSTEMS_REPORT.md for why a real per-game rules engine is
// required before that becomes reachable.
//
// Stage 19 — Room Game Center framework additions: listByRoom() (a room's
// game-center lobby view), addPlayer()/removePlayer() (join/leave a
// still-open lobby), and cancel()/start() (the two real lobby -> {cancelled,
// active} transitions the framework itself owns). All four of the new
// mutating methods are lobby-only and idempotent-safe the same way finish()
// already is: once a match has left the 'lobby' state, every one of them is
// a no-op that returns the match unchanged rather than erroring, so a
// stale/duplicate client action can never corrupt a match that has already
// moved on. None of them ever touch result/winnerId/resultSource -- those
// remain exclusively finish()'s, per the file header above.

const { generateMatchId } = require('../models/game-match.model');

function mapGameMatchRow(row) {
  if (!row) return null;
  return { id: row.id, roomId: row.room_id, gameId: row.game_id, version: row.version, startedBy: row.started_by, playerIds: Array.isArray(row.player_ids) ? row.player_ids : JSON.parse(row.player_ids || '[]'), state: row.state, result: row.result, resultSource: row.result_source, winnerId: row.winner_id, endedAt: row.ended_at instanceof Date ? row.ended_at.toISOString() : row.ended_at, createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at, updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at };
}

class InMemoryGameMatchRepository {
  constructor() {
    this._matches = new Map();
  }

  async create({ roomId, gameId, version, startedBy, playerIds }) {
    const match = {
      id: generateMatchId(),
      roomId,
      gameId,
      version,
      startedBy,
      playerIds,
      state: 'lobby',
      result: null,
      resultSource: null,
      winnerId: null,
      endedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this._matches.set(match.id, match);
    return { ...match };
  }

  async findById(id) {
    const match = this._matches.get(id);
    return match ? { ...match } : null;
  }

  async listAll() { return Array.from(this._matches.values()).map((m) => ({ ...m })); }

  async listByStartedBy(startedBy) {
    return Array.from(this._matches.values())
      .filter((m) => m.startedBy === startedBy)
      .map((m) => ({ ...m }));
  }

  // Stage 19 -- a room's own game-center lobby view: every match ever
  // created in that room (any state), most recent first. Distinct from
  // listByStartedBy() above, which only ever showed matches a given
  // account itself started -- this is what lets someone who was invited
  // into a lobby (not the one who created it) actually see it.
  async listByRoom(roomId) {
    return Array.from(this._matches.values())
      .filter((m) => m.roomId === roomId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((m) => ({ ...m }));
  }

  // Stage 19 -- adds a player to a still-open lobby. A no-op (returns the
  // match unchanged) once the match has left 'lobby', and idempotent for
  // a player already in the match -- see service layer for the real
  // catalog max-players enforcement; this repository method only ever
  // does the actual array mutation once the service has decided it's
  // allowed.
  async addPlayer(id, playerId) {
    const match = this._matches.get(id);
    if (!match) return null;
    if (match.state !== 'lobby') return { ...match };
    if (!match.playerIds.includes(playerId)) {
      match.playerIds = [...match.playerIds, playerId];
      match.updatedAt = new Date().toISOString();
    }
    return { ...match };
  }

  // Stage 19 -- removes a player from a still-open lobby (voluntary
  // leave). A no-op once the match has left 'lobby' -- a player cannot
  // retroactively un-join a match that has already started.
  async removePlayer(id, playerId) {
    const match = this._matches.get(id);
    if (!match) return null;
    if (match.state !== 'lobby') return { ...match };
    match.playerIds = match.playerIds.filter((p) => p !== playerId);
    match.updatedAt = new Date().toISOString();
    return { ...match };
  }

  // Stage 19 -- the host withdraws their own still-open lobby, same
  // "only from lobby, first call wins" shape as battle.repository.js's
  // cancel(). Never touches result/winnerId.
  async cancel(id) {
    const match = this._matches.get(id);
    if (!match) return null;
    if (match.state !== 'lobby') return { ...match };
    match.state = 'cancelled';
    match.updatedAt = new Date().toISOString();
    return { ...match };
  }

  // Stage 19 -- the host starts the lobby (lobby -> active). This is the
  // framework's own lifecycle transition; it is NOT a game result and
  // never touches result/winnerId/resultSource -- an active match's
  // actual gameplay (and its eventual real result) is Stage 20/21/22's
  // per-game rules engine, calling finishMatch() -- see file header.
  async start(id) {
    const match = this._matches.get(id);
    if (!match) return null;
    if (match.state !== 'lobby') return { ...match };
    match.state = 'active';
    match.updatedAt = new Date().toISOString();
    return { ...match };
  }

  // Only ever called from a real, server-side game engine (not implemented
  // yet -- see caller). Idempotent: a match that is already 'finished'
  // keeps its original result no matter how many times this is called.
  async finish(id, { winnerId, result }) {
    const match = this._matches.get(id);
    if (!match) return null;
    if (match.state === 'finished') return { ...match };
    match.state = 'finished';
    match.winnerId = winnerId;
    match.result = result;
    match.resultSource = 'server';
    match.endedAt = new Date().toISOString();
    match.updatedAt = match.endedAt;
    return { ...match };
  }
}

class PostgresGameMatchRepository {
  constructor(pool) {
    this._pool = pool;
  }

  async create({ roomId, gameId, version, startedBy, playerIds }) {
    const id = generateMatchId();
    const { rows } = await this._pool.query(
      `INSERT INTO game_matches (id, room_id, game_id, version, started_by, player_ids)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, roomId, gameId, version, startedBy, JSON.stringify(playerIds)]
    );
    return mapGameMatchRow(rows[0]);
  }

  async findById(id) {
    const { rows } = await this._pool.query('SELECT * FROM game_matches WHERE id = $1', [id]);
    return mapGameMatchRow(rows[0]);
  }

  async listAll() { return Array.from(this._matches.values()).map((m) => ({ ...m })); }

  async listAll() {
    const { rows } = await this._pool.query('SELECT * FROM game_matches ORDER BY created_at DESC');
    return rows.map(mapGameMatchRow);
  }

  async listByStartedBy(startedBy) {
    const { rows } = await this._pool.query(
      'SELECT * FROM game_matches WHERE started_by = $1 ORDER BY created_at DESC',
      [startedBy]
    );
    return rows.map(mapGameMatchRow);
  }

  // Stage 19 -- see InMemoryGameMatchRepository#listByRoom above for why
  // this is distinct from listByStartedBy(). Uses the existing
  // game_matches_room_id_idx (see schema/008_create_game_matches.sql) --
  // no schema change needed.
  async listByRoom(roomId) {
    const { rows } = await this._pool.query(
      'SELECT * FROM game_matches WHERE room_id = $1 ORDER BY created_at DESC',
      [roomId]
    );
    return rows.map(mapGameMatchRow);
  }

  // Stage 19 -- lobby-only, idempotent (dedup via `@>` containment check
  // before appending) join. Guarded by `WHERE state = 'lobby'`, same
  // "only from lobby, first call in the wrong state is a safe no-op"
  // shape as finish()'s `WHERE state <> 'finished'` below. Not gated by
  // the server-game-result trigger (that only fires on
  // result/winner_id/result_source changes or state='finished' -- see
  // schema/008_create_game_matches.sql), since this is a normal
  // player-membership change, not a game result.
  async addPlayer(id, playerId) {
    const { rows } = await this._pool.query(
      `UPDATE game_matches
       SET player_ids = CASE WHEN player_ids @> $2::jsonb THEN player_ids ELSE player_ids || $2::jsonb END,
           updated_at = now()
       WHERE id = $1 AND state = 'lobby'
       RETURNING *`,
      [id, JSON.stringify([playerId])]
    );
    if (rows.length) return mapGameMatchRow(rows[0]);
    const { rows: existing } = await this._pool.query('SELECT * FROM game_matches WHERE id = $1', [id]);
    return mapGameMatchRow(existing[0]);
  }

  // Stage 19 -- lobby-only voluntary leave; removes exactly one matching
  // element from the JSONB array.
  async removePlayer(id, playerId) {
    const { rows } = await this._pool.query(
      `UPDATE game_matches
       SET player_ids = (
             SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
             FROM jsonb_array_elements(player_ids) elem
             WHERE elem <> to_jsonb($2::text)
           ),
           updated_at = now()
       WHERE id = $1 AND state = 'lobby'
       RETURNING *`,
      [id, playerId]
    );
    if (rows.length) return mapGameMatchRow(rows[0]);
    const { rows: existing } = await this._pool.query('SELECT * FROM game_matches WHERE id = $1', [id]);
    return mapGameMatchRow(existing[0]);
  }

  // Stage 19 -- host withdraws their own still-open lobby.
  async cancel(id) {
    const { rows } = await this._pool.query(
      `UPDATE game_matches SET state = 'cancelled', updated_at = now() WHERE id = $1 AND state = 'lobby' RETURNING *`,
      [id]
    );
    if (rows.length) return mapGameMatchRow(rows[0]);
    const { rows: existing } = await this._pool.query('SELECT * FROM game_matches WHERE id = $1', [id]);
    return mapGameMatchRow(existing[0]);
  }

  // Stage 19 -- host starts the lobby (lobby -> active). Deliberately NOT
  // 'finished', so the enforce_server_game_result trigger's `state =
  // 'finished'` clause never fires for this transition -- starting a
  // match is a framework lifecycle action, not a game result.
  async start(id) {
    const { rows } = await this._pool.query(
      `UPDATE game_matches SET state = 'active', updated_at = now() WHERE id = $1 AND state = 'lobby' RETURNING *`,
      [id]
    );
    if (rows.length) return mapGameMatchRow(rows[0]);
    const { rows: existing } = await this._pool.query('SELECT * FROM game_matches WHERE id = $1', [id]);
    return mapGameMatchRow(existing[0]);
  }

  async finish(id, { winnerId, result }) {
    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.game_engine','true',true)`);
      const { rows } = await client.query(
        `UPDATE game_matches
         SET state = 'finished', winner_id = $2, result = $3, result_source = 'server', ended_at = now(), updated_at = now()
         WHERE id = $1 AND state <> 'finished'
         RETURNING *`,
        [id, winnerId, JSON.stringify(result)]
      );
      await client.query('COMMIT');
      if (rows.length) return mapGameMatchRow(rows[0]);
      const { rows: existingRows } = await this._pool.query('SELECT * FROM game_matches WHERE id = $1', [id]);
      return mapGameMatchRow(existingRows[0]);
    } catch (err) { try { await client.query('ROLLBACK'); } catch {} throw err; } finally { client.release(); }

  }
}

module.exports = { InMemoryGameMatchRepository, PostgresGameMatchRepository };
