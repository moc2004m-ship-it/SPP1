-- Stage 5 — Authentication / Sessions / Recovery — canonical schema.
--
-- Real Postgres DDL for the data AuthStore (../../auth/auth.store.js)
-- keeps either in-memory or in this schema, via
-- ../repositories/auth.repository.js's PostgresAuthRepository.
--
-- Stage 5 completion (this session) — PostgresAuthRepository is now
-- wired into ../index.js's activation switch as `db.auth`, and AuthStore
-- is constructed with it in ../../index.js (`new AuthStore(db.accounts,
-- db.auth)`). Applying this file (via STAGE3_ENABLE_POSTGRES=true +
-- DATABASE_URL + the migration runner) is what actually activates real
-- persistence for OTP/session/consent data — not executed automatically
-- by this task, since no live Postgres connection exists in this
-- sandbox (see the completion report's External Blockers section).
--
-- This was previously blocked because AuthStore's public methods were
-- relied on synchronously by tests outside this file's original scope;
-- that has been resolved by making every AuthStore method `async`/
-- `await`-based (see auth.store.js's header and
-- Authentication/STAGE5_TODO.md item 5, now closed) — a change that also
-- required updating the tests that called those methods synchronously
-- to `await` them (no test assertions or scenarios were weakened; see
-- Backend/test/auth.store.revoke-all-sessions.test.js and the other
-- updated files).

CREATE TABLE IF NOT EXISTS auth_identities (
    provider_key TEXT        PRIMARY KEY,             -- e.g. 'phone:+213555123456' or 'google:118...'
    account_id   TEXT        NOT NULL REFERENCES accounts(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_identities_account_id_idx ON auth_identities (account_id);

CREATE TABLE IF NOT EXISTS auth_otp_challenges (
    phone      TEXT        PRIMARY KEY,               -- E.164, one live challenge per phone at a time
    code_hash  TEXT        NOT NULL,                  -- sha256 of the 6-digit code, code itself never stored
    expires_at TIMESTAMPTZ NOT NULL,
    attempts   INTEGER     NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id            TEXT        PRIMARY KEY,             -- server-generated, e.g. session_<uuid>
    account_id    TEXT        NOT NULL REFERENCES accounts(id),
    device_id     TEXT        NOT NULL,                -- server-generated, e.g. dev_<uuid>, or client-supplied stable id
    device_name   TEXT        NOT NULL DEFAULT 'Unknown device',
    platform      TEXT        NOT NULL DEFAULT 'unknown',
    token_hash    TEXT        NOT NULL UNIQUE,         -- sha256 of the bearer token, token itself never stored
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at    TIMESTAMPTZ NULL                     -- NULL = active; a session row is never deleted, only stamped
);
CREATE INDEX IF NOT EXISTS auth_sessions_account_id_idx ON auth_sessions (account_id);
CREATE INDEX IF NOT EXISTS auth_sessions_token_hash_idx ON auth_sessions (token_hash);

CREATE TABLE IF NOT EXISTS auth_consents (
    account_id  TEXT        PRIMARY KEY REFERENCES accounts(id),
    version     TEXT        NOT NULL,                  -- Terms/Privacy version string, e.g. '1.0'
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
