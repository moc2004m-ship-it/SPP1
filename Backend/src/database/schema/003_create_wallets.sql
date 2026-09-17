-- Phase 2 — Wallet domain — canonical schema.
--
-- This is the first Stage 6-35 domain moved off the in-memory Map in
-- feature-platform.js onto the same real-Postgres pattern as accounts
-- (see Database/STAGE3_TODO.md and src/database/repositories/account.repository.js).
-- It is NOT executed automatically -- same activation switch as accounts:
-- STAGE3_ENABLE_POSTGRES=true + DATABASE_URL set (see src/database/index.js).
--
-- Two tables:
--   wallet_balances     current coins/diamonds per account. NEVER decremented
--                       below 0 -- enforced at the database level, not just
--                       in application code, via the CHECK constraints below.
--   wallet_transactions append-only ledger. (account_id, idempotency_key) is UNIQUE so a
--                       retried request (same key) can never be applied twice
--                       -- the INSERT itself fails/no-ops on a duplicate key,
--                       it is not something application code has to remember
--                       to check.

CREATE TABLE IF NOT EXISTS wallet_balances (
    account_id  TEXT PRIMARY KEY REFERENCES accounts(id),
    coins       BIGINT      NOT NULL DEFAULT 0,
    diamonds    BIGINT      NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT wallet_balances_coins_non_negative    CHECK (coins >= 0),
    CONSTRAINT wallet_balances_diamonds_non_negative CHECK (diamonds >= 0)
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
    id              TEXT PRIMARY KEY,             -- server-generated, e.g. wtx_<uuid>
    account_id      TEXT        NOT NULL REFERENCES accounts(id),
    currency        TEXT        NOT NULL CHECK (currency IN ('coins', 'diamonds')),
    direction       TEXT        NOT NULL CHECK (direction IN ('credit', 'debit')),
    amount          BIGINT      NOT NULL CHECK (amount > 0),
    balance_after   BIGINT      NOT NULL CHECK (balance_after >= 0),
    idempotency_key TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_account_id_idempotency_idx
    ON wallet_transactions (account_id, idempotency_key);
CREATE INDEX IF NOT EXISTS wallet_transactions_account_id_idx ON wallet_transactions (account_id, created_at DESC);
