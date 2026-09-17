-- Phase 5 — Recharge domain — canonical schema.
--
-- Two-phase, provider-verified flow, never a client-declared credit:
--   1. Client asks the server to open an order for a catalog package
--      (server looks up coinsToCredit from its own catalog -- never from
--      the client). Row is inserted with status='pending'.
--   2. Client (or a provider server-to-server webhook, once one is wired)
--      submits the provider's opaque purchase token/receipt. The server
--      verifies it against the real provider (Google Play / App Store /
--      other) -- see ../../services/recharge-provider-verifier.js -- and
--      only on a real, verified response does it call wallets.credit()
--      and mark this row 'completed'. If the provider is not configured,
--      or verification fails, the order is marked 'failed' -- never
--      silently completed.
--
-- idempotency_key mirrors wallet_transactions.idempotency_key exactly
-- (this order's id is used as that key) so a retried "complete" call can
-- never credit the wallet twice, even across process restarts.
--
-- NOT executed automatically -- same activation switch as every other
-- table here: STAGE3_ENABLE_POSTGRES=true + DATABASE_URL (see ../index.js).

CREATE TABLE IF NOT EXISTS recharge_orders (
    id                    TEXT        PRIMARY KEY,     -- server-generated, e.g. rchg_<uuid>; ALSO used as the wallet idempotency_key on completion
    account_id            TEXT        NOT NULL REFERENCES accounts(id),
    package_id            TEXT        NOT NULL,        -- server-side catalog package identifier
    coins_to_credit       BIGINT      NOT NULL CHECK (coins_to_credit > 0), -- looked up server-side from package_id, never from the client
    provider              TEXT        NOT NULL,        -- e.g. 'google_play', 'app_store'
    provider_purchase_ref TEXT        NULL,             -- opaque purchase token/receipt submitted by the client for verification
    status                TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'verified', 'completed', 'failed')),
    failure_reason        TEXT        NULL,
    wallet_transaction_id TEXT        NULL REFERENCES wallet_transactions(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recharge_orders_account_id_idx ON recharge_orders (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recharge_orders_status_idx ON recharge_orders (status);
