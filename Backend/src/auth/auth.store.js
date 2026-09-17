const crypto = require('node:crypto');
const { InMemoryAuthRepository } = require('../database/repositories/auth.repository');

// Stage 5 audit (this session) — storage mechanics (identities/OTP/
// sessions/devices/consents) moved out into
// ../database/repositories/auth.repository.js, same "business logic
// here, storage there" split every other domain in this project already
// uses. `authRepository` defaults to a fresh InMemoryAuthRepository so
// every existing call site (`new AuthStore(db.accounts)`) is unchanged.
// See auth.repository.js's header for exactly why the Postgres
// implementation it also exports is not the default here.
//
// Stage 5 completion (this session) — every method below is now `async`
// and `await`s its repository call, specifically so `db.auth` can be a
// PostgresAuthRepository (real network I/O) when Postgres is activated
// (see ../database/index.js), not just the InMemoryAuthRepository. This
// is a pure widening of the contract: `await someSyncValue` resolves
// immediately on the next microtask, so InMemoryAuthRepository (still
// fully synchronous internally) behaves exactly as before for every
// existing caller, as long as that caller now awaits/returns the
// Promise. See session-middleware.js, routes/auth.routes.js and
// services/settings.service.js for the corresponding call-site updates,
// and Authentication/STAGE5_TODO.md item 5, which this closes.
class AuthStore {
  constructor(accountRepository, authRepository = new InMemoryAuthRepository()) {
    this.accounts = accountRepository;
    this.repo = authRepository;
  }

  static hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
  static token(prefix = 'tok') { return `${prefix}_${crypto.randomBytes(32).toString('base64url')}`; }
  static deviceId() { return `dev_${crypto.randomUUID()}`; }

  async issueOtp(phone, ttlMs = 5 * 60 * 1000) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await this.repo.setOtpChallenge(phone, { hash: AuthStore.hash(code), expiresAt: Date.now() + ttlMs, attempts: 0 });
    return code;
  }

  async verifyOtp(phone, code) {
    const record = await this.repo.getOtpChallenge(phone);
    if (!record || record.expiresAt < Date.now() || record.attempts >= 5) return false;
    record.attempts += 1;
    const ok = AuthStore.hash(code) === record.hash;
    // Persist the incremented attempt count. Harmless no-op for the
    // in-memory repository (the object is already mutated in place by
    // reference) but required for correctness against any repository
    // that returns a copy (e.g. the Postgres one).
    await this.repo.setOtpChallenge(phone, record);
    if (ok) await this.repo.deleteOtpChallenge(phone);
    return ok;
  }

  async findOrCreatePhoneAccount(phone) {
    const key = `phone:${phone}`;
    const existingId = await this.repo.getIdentityAccountId(key);
    if (existingId) return this.accounts.findById(existingId);
    const account = await this.accounts.create();
    await this.repo.setIdentity(key, account.id);
    return account;
  }

  async findOrCreateSocialAccount(provider, subject) {
    const key = `${provider}:${subject}`;
    const existingId = await this.repo.getIdentityAccountId(key);
    if (existingId) return this.accounts.findById(existingId);
    const account = await this.accounts.create();
    await this.repo.setIdentity(key, account.id);
    return account;
  }

  async createSession(accountId, device) {
    const token = AuthStore.token('sess');
    const tokenHash = AuthStore.hash(token);
    const deviceId = device.id || AuthStore.deviceId();
    const session = Object.freeze({
      id: `session_${crypto.randomUUID()}`,
      accountId, deviceId,
      deviceName: device.name || 'Unknown device',
      platform: device.platform || 'unknown',
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      revokedAt: null,
    });
    await this.repo.createSession(session, tokenHash);
    await this.repo.registerDevice(deviceId, tokenHash);
    return { token, session };
  }

  async authenticate(token) {
    if (!token) return null;
    const session = await this.repo.getSessionByTokenHash(AuthStore.hash(token));
    if (!session || session.revokedAt) return null;
    return session;
  }

  async revokeSessionById(accountId, sessionId) {
    return this.repo.revokeSessionById(accountId, sessionId, new Date().toISOString());
  }

  async listSessions(accountId) {
    return this.repo.listActiveSessionsForAccount(accountId);
  }

  // Stage 34 — Delete Account. Revokes every currently-active session for
  // this account in one call, same revocation semantics as
  // revokeSessionById() above (never deletes the session record, just
  // stamps revokedAt so authenticate() rejects it from then on). Returns
  // how many sessions were actually revoked. Idempotent: calling this
  // again with nothing left to revoke is a real no-op that returns 0, not
  // an error.
  async revokeAllSessions(accountId) {
    return this.repo.revokeAllSessionsForAccount(accountId, new Date().toISOString());
  }

  async setConsent(accountId, version, acceptedAt = new Date().toISOString()) {
    const record = Object.freeze({ accountId, version, acceptedAt });
    await this.repo.setConsent(accountId, record);
    return record;
  }

  async getConsent(accountId) {
    const record = await this.repo.getConsent(accountId);
    return record || null;
  }
}

module.exports = { AuthStore };
