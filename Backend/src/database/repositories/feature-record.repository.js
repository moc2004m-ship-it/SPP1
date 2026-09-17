// Phase 2 — Feature-record repository (Rooms, Battles, Games, Gifts,
// Family, Events, Notifications, Settings, Moderation/Support, Profile,
// Social, Chat -- every stage 6-35 domain except Wallet, which has its own
// dedicated repository/schema: see wallet.repository.js).
//
// Same dual-implementation pattern as account.repository.js and
// wallet.repository.js:
//   - InMemoryFeatureRecordRepository: ACTIVE today (no network in this
//     sandbox -- see Database/STAGE3_TODO.md).
//   - PostgresFeatureRecordRepository: ready for later, matches
//     src/database/schema/004_create_feature_records.sql. NOT exercised in
//     this sandbox -- reviewed but never run against a live database.
//
// Interface both implement: add(stage, item) / list(stage). Filtering by an
// arbitrary predicate (used throughout feature-platform.js) stays an
// application-layer concern in FeatureStore (see ../../feature-platform.js)
// rather than being pushed into SQL, since predicates there are plain JS
// functions, not query descriptions.

class InMemoryFeatureRecordRepository {
  constructor() {
    this._byStage = new Map();
  }

  async add(stage, item) {
    const list = this._byStage.get(stage) || [];
    list.push(item);
    this._byStage.set(stage, list);
    return item;
  }

  async list(stage) {
    return (this._byStage.get(stage) || []).slice();
  }

  // Phase 6 -- real state transitions (friend accept/reject, seat
  // approve/mute, room-membership kick, referral redemption, ...) need an
  // actual update-in-place, not another append. `patch` is a plain object
  // merged onto the existing record (shallow); `updatedAt` is always
  // refreshed. Returns the updated record, or null if no record with that
  // id exists on that stage (caller decides whether that's a 404).
  async update(stage, itemId, patch) {
    const list = this._byStage.get(stage) || [];
    const index = list.findIndex((item) => item.id === itemId);
    if (index === -1) return null;
    const updated = { ...list[index], ...patch, id: list[index].id, updatedAt: new Date().toISOString() };
    list[index] = updated;
    this._byStage.set(stage, list);
    return updated;
  }
}

class PostgresFeatureRecordRepository {
  // `pool` is a `pg` Pool instance. Not constructed anywhere until Stage 3's
  // Postgres switch is enabled -- see ../index.js. NOT exercised in this
  // sandbox: no network access, so this code has been reviewed but never
  // run against a live database.
  constructor(pool) {
    this._pool = pool;
  }

  async add(stage, item) {
    await this._pool.query(
      `INSERT INTO feature_records (id, stage, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [item.id, stage, JSON.stringify(item), item.createdAt, item.updatedAt]
    );
    return item;
  }

  async list(stage) {
    const { rows } = await this._pool.query(
      'SELECT data FROM feature_records WHERE stage = $1 ORDER BY created_at ASC',
      [stage]
    );
    // node-postgres parses JSONB columns back into plain JS objects already.
    return rows.map((row) => row.data);
  }

  // Same contract as InMemoryFeatureRecordRepository.update above. Reads
  // the current JSONB row, merges the patch in application code (so the
  // merge semantics are identical between both backends, not reimplemented
  // in SQL), and writes it back. Not run against a live database in this
  // sandbox -- see class comment.
  async update(stage, itemId, patch) {
    const { rows } = await this._pool.query(
      'SELECT data FROM feature_records WHERE stage = $1 AND id = $2',
      [stage, itemId]
    );
    if (!rows.length) return null;
    const updated = { ...rows[0].data, ...patch, id: itemId, updatedAt: new Date().toISOString() };
    await this._pool.query(
      'UPDATE feature_records SET data = $1, updated_at = $2 WHERE stage = $3 AND id = $4',
      [JSON.stringify(updated), updated.updatedAt, stage, itemId]
    );
    return updated;
  }
}

module.exports = { InMemoryFeatureRecordRepository, PostgresFeatureRecordRepository };
