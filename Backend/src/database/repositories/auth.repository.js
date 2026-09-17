// Stage 5 — Auth storage repository.
//
// Extracted from ../../auth/auth.store.js, which used to keep its four
// `Map`s (identities/otp/sessions/devices/consents) inline. Same
// motivation as every other <domain>.repository.js in this project:
// AuthStore should contain business rules (OTP attempt limits, consent
// version format, session shape) and NOT own the storage mechanics
// directly — this file is the ONLY place that reads/writes
// identity/OTP/session/consent data.
//
// Stage 5 completion (this session) — both implementations are now
// interchangeable behind AuthStore, same as every other repository pair
// in this project:
//   - InMemoryAuthRepository: used when Postgres is not activated
//     (STAGE3_ENABLE_POSTGRES unset/false), same as every other
//     in-memory repository. Still fully synchronous internally.
//   - PostgresAuthRepository: real, reviewed, matches
//     ../schema/027_create_auth_tables.sql column-for-column. Now wired
//     into ../index.js's `buildDatabase()` activation switch as `db.auth`
//     (previously it existed but was never referenced there — see git
//     history / STAGE_5_FINAL_REPORT.md for that prior state), and
//     ../../auth/auth.store.js's AuthStore is constructed with it
//     (`new AuthStore(db.accounts, db.auth)` in ../../index.js). This
//     was possible without breaking anything because AuthStore's public
//     methods were made `async`/`await`-based first (see
//     auth.store.js's header) — `await` on the InMemoryAuthRepository's
//     already-synchronous return values is a no-op, so this activation
//     is additive for every existing caller and test, not a rewrite.

// ---------------------------------------------------------------------
// In-memory implementation — ACTIVE today.
// ---------------------------------------------------------------------

class InMemoryAuthRepository {
  constructor() {
    this._identities = new Map(); // provider:key -> accountId
    this._otp = new Map(); // phone -> {hash, expiresAt, attempts}
    this._sessions = new Map(); // tokenHash -> session
    this._devices = new Map(); // deviceId -> tokenHash
    this._consents = new Map(); // accountId -> consent record
  }

  getIdentityAccountId(key) {
    return this._identities.get(key) || null;
  }

  setIdentity(key, accountId) {
    this._identities.set(key, accountId);
  }

  getOtpChallenge(phone) {
    return this._otp.get(phone) || null;
  }

  setOtpChallenge(phone, record) {
    this._otp.set(phone, record);
  }

  deleteOtpChallenge(phone) {
    this._otp.delete(phone);
  }

  createSession(session, tokenHash) {
    this._sessions.set(tokenHash, session);
  }

  getSessionByTokenHash(tokenHash) {
    return this._sessions.get(tokenHash) || null;
  }

  listAllSessions() { return [...this._sessions.values()].map((s) => ({ ...s })); }

  listActiveSessionsForAccount(accountId) {
    return [...this._sessions.values()].filter((s) => s.accountId === accountId && !s.revokedAt);
  }

  // Finds the (accountId, sessionId) pair regardless of which tokenHash
  // it lives under and stamps revokedAt — same "never delete, only
  // revoke" discipline the original inline Map code used.
  revokeSessionById(accountId, sessionId, revokedAt) {
    for (const [hash, session] of this._sessions) {
      if (session.accountId === accountId && session.id === sessionId && !session.revokedAt) {
        this._sessions.set(hash, Object.freeze({ ...session, revokedAt }));
        return true;
      }
    }
    return false;
  }

  revokeAllSessionsForAccount(accountId, revokedAt) {
    let count = 0;
    for (const [hash, session] of this._sessions) {
      if (session.accountId === accountId && !session.revokedAt) {
        this._sessions.set(hash, Object.freeze({ ...session, revokedAt }));
        count += 1;
      }
    }
    return count;
  }

  registerDevice(deviceId, tokenHash) {
    this._devices.set(deviceId, tokenHash);
  }

  setConsent(accountId, record) {
    this._consents.set(accountId, record);
  }

  getConsent(accountId) {
    return this._consents.get(accountId) || null;
  }
}

// ---------------------------------------------------------------------
// Postgres implementation — matches schema/027_create_auth_tables.sql.
// Reviewed but NOT wired in yet (see file header). Kept async/correct
// so the eventual AuthStore migration is a real activation, not a
// rewrite.
// ---------------------------------------------------------------------

function mapSessionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    deviceId: row.device_id,
    deviceName: row.device_name,
    platform: row.platform,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    lastSeenAt: row.last_seen_at instanceof Date ? row.last_seen_at.toISOString() : row.last_seen_at,
    revokedAt: row.revoked_at instanceof Date ? row.revoked_at.toISOString() : (row.revoked_at || null),
  };
}

class PostgresAuthRepository {
  constructor(pool) {
    this._pool = pool;
  }

  async getIdentityAccountId(key) {
    const { rows } = await this._pool.query('SELECT account_id FROM auth_identities WHERE provider_key = $1', [key]);
    return rows[0] ? rows[0].account_id : null;
  }

  async setIdentity(key, accountId) {
    await this._pool.query(
      'INSERT INTO auth_identities (provider_key, account_id) VALUES ($1, $2) ON CONFLICT (provider_key) DO NOTHING',
      [key, accountId]
    );
  }

  async getOtpChallenge(phone) {
    const { rows } = await this._pool.query('SELECT * FROM auth_otp_challenges WHERE phone = $1', [phone]);
    if (!rows[0]) return null;
    const row = rows[0];
    return {
      hash: row.code_hash,
      expiresAt: Date.parse(row.expires_at),
      attempts: row.attempts,
    };
  }

  async setOtpChallenge(phone, record) {
    await this._pool.query(
      `INSERT INTO auth_otp_challenges (phone, code_hash, expires_at, attempts)
       VALUES ($1, $2, to_timestamp($3 / 1000.0), $4)
       ON CONFLICT (phone) DO UPDATE SET code_hash = $2, expires_at = to_timestamp($3 / 1000.0), attempts = $4`,
      [phone, record.hash, record.expiresAt, record.attempts]
    );
  }

  async deleteOtpChallenge(phone) {
    await this._pool.query('DELETE FROM auth_otp_challenges WHERE phone = $1', [phone]);
  }

  async createSession(session, tokenHash) {
    await this._pool.query(
      `INSERT INTO auth_sessions (id, account_id, device_id, device_name, platform, token_hash, created_at, last_seen_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [session.id, session.accountId, session.deviceId, session.deviceName, session.platform, tokenHash, session.createdAt, session.lastSeenAt, session.revokedAt]
    );
  }

  async getSessionByTokenHash(tokenHash) {
    const { rows } = await this._pool.query('SELECT * FROM auth_sessions WHERE token_hash = $1', [tokenHash]);
    return mapSessionRow(rows[0]);
  }

  async listAllSessions() {
    const { rows } = await this._pool.query('SELECT * FROM auth_sessions ORDER BY created_at DESC');
    return rows.map(mapSessionRow);
  }

  async listActiveSessionsForAccount(accountId) {
    const { rows } = await this._pool.query(
      'SELECT * FROM auth_sessions WHERE account_id = $1 AND revoked_at IS NULL ORDER BY created_at ASC',
      [accountId]
    );
    return rows.map(mapSessionRow);
  }

  async revokeSessionById(accountId, sessionId, revokedAt) {
    const { rows } = await this._pool.query(
      `UPDATE auth_sessions SET revoked_at = $1
       WHERE account_id = $2 AND id = $3 AND revoked_at IS NULL RETURNING id`,
      [revokedAt, accountId, sessionId]
    );
    return rows.length > 0;
  }

  async revokeAllSessionsForAccount(accountId, revokedAt) {
    const { rows } = await this._pool.query(
      `UPDATE auth_sessions SET revoked_at = $1
       WHERE account_id = $2 AND revoked_at IS NULL RETURNING id`,
      [revokedAt, accountId]
    );
    return rows.length;
  }

  async registerDevice() {
    // Device metadata is stored directly on auth_sessions (device_id/
    // device_name/platform columns) for the Postgres implementation —
    // there is no separate devices table to write to, unlike the
    // in-memory implementation's write-only `_devices` map (which the
    // original inline code also never read back from). No-op kept only
    // so both implementations share the same method surface.
  }

  async setConsent(accountId, record) {
    await this._pool.query(
      `INSERT INTO auth_consents (account_id, version, accepted_at) VALUES ($1, $2, $3)
       ON CONFLICT (account_id) DO UPDATE SET version = $2, accepted_at = $3`,
      [accountId, record.version, record.acceptedAt]
    );
  }

  async getConsent(accountId) {
    const { rows } = await this._pool.query('SELECT * FROM auth_consents WHERE account_id = $1', [accountId]);
    if (!rows[0]) return null;
    return {
      accountId: rows[0].account_id,
      version: rows[0].version,
      acceptedAt: rows[0].accepted_at instanceof Date ? rows[0].accepted_at.toISOString() : rows[0].accepted_at,
    };
  }
}

module.exports = { InMemoryAuthRepository, PostgresAuthRepository };
