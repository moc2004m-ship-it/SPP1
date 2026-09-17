-- Phase 5 — Inventory domain — canonical schema.
--
-- Moved off the generic feature_records table (stage 29) onto its own
-- relational table, following the precedent set for wallet in
-- 003_create_wallets.sql: "If/when a specific domain needs real relational
-- invariants ... that domain should get its own dedicated table" (see
-- 004_create_feature_records.sql). Inventory needs one: every grant must
-- be traceable to the exact server-side event that caused it (a completed
-- recharge, a verified purchase, an admin action) via reference_id, and
-- must never be re-appliable twice for the same reference (UNIQUE below).
--
-- NOT executed automatically -- same activation switch as every other
-- table here: STAGE3_ENABLE_POSTGRES=true + DATABASE_URL (see ../index.js).

CREATE TABLE IF NOT EXISTS inventory_items (
    id            TEXT        PRIMARY KEY,        -- server-generated, e.g. inv_<uuid>
    account_id    TEXT        NOT NULL REFERENCES accounts(id),
    item_id       TEXT        NOT NULL,            -- catalog item identifier (server-defined catalog)
    quantity      INTEGER     NOT NULL DEFAULT 1 CHECK (quantity > 0),
    source        TEXT        NOT NULL,            -- e.g. 'recharge', 'gift', 'admin', 'store_purchase'
    reference_id  TEXT        NOT NULL,            -- the server-side event that caused this grant
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- The same triggering event (a recharge order id, a gift id, ...) can
    -- never grant the same item twice -- this is the idempotency guarantee
    -- for inventory, the same role UNIQUE(idempotency_key) plays for
    -- wallet_transactions.
    CONSTRAINT inventory_items_reference_unique UNIQUE (reference_id, item_id)
);

CREATE INDEX IF NOT EXISTS inventory_items_account_id_idx ON inventory_items (account_id, created_at DESC);
