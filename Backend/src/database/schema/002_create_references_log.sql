-- Stage 3 — Generic Reference / Transaction table — canonical schema.
--
-- Intentionally generic: not a wallet, not a coin/diamond ledger, and not
-- tied to any agency/commission/cash-withdrawal flow (explicitly out of
-- scope for Stage 3). A future financial stage can build on this table
-- without redesigning it — e.g. by adding new `type` values, or a new
-- table with a foreign key to `references_log(id)`.
--
-- Table name is `references_log`, not `references`, because REFERENCES is
-- a reserved SQL keyword.
--
-- NOT executed automatically in Stage 3 (see Database/STAGE3_TODO.md).

CREATE TABLE IF NOT EXISTS references_log (
    id          TEXT PRIMARY KEY,              -- server-generated, e.g. txn_<uuid>
    type        TEXT        NOT NULL,          -- free-form, defined by the stage that uses it
    status      TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'completed', 'failed', 'reversed')),
    user_id     TEXT        NULL REFERENCES accounts(id),
    amount      NUMERIC     NULL,               -- nullable: not every reference is monetary
    currency    TEXT        NULL,
    metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_references_log_user_id ON references_log (user_id);
CREATE INDEX IF NOT EXISTS idx_references_log_type    ON references_log (type);
