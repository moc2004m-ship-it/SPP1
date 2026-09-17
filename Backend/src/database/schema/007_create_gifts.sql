-- Phase 5 — Gifts domain — canonical schema.
--
-- Every gift send is a real wallet debit (unit_cost_coins comes from the
-- server-side gift catalog -- see ../../domain/gift-catalog.js -- never
-- from the client) followed by a durable, queryable record linking that
-- debit's wallet_transaction_id to the room/sender/receiver/gift. Moved
-- off the generic feature_records table (stage 26) for the same reason as
-- inventory/wallet: this domain needs a real foreign key to
-- wallet_transactions, which a generic JSONB blob cannot enforce.
--
-- NOT executed automatically -- same activation switch as every other
-- table here: STAGE3_ENABLE_POSTGRES=true + DATABASE_URL (see ../index.js).

CREATE TABLE IF NOT EXISTS gifts_log (
    id                    TEXT        PRIMARY KEY,     -- server-generated, e.g. gift_<uuid>
    room_id               TEXT        NOT NULL,
    sender_id             TEXT        NOT NULL REFERENCES accounts(id),
    receiver_id           TEXT        NOT NULL REFERENCES accounts(id),
    gift_id               TEXT        NOT NULL,        -- catalog gift identifier
    quantity              INTEGER     NOT NULL CHECK (quantity > 0),
    unit_cost_coins       BIGINT      NOT NULL CHECK (unit_cost_coins > 0),
    total_cost_coins      BIGINT      NOT NULL CHECK (total_cost_coins > 0),
    wallet_transaction_id TEXT        NOT NULL REFERENCES wallet_transactions(id), -- the sender's real debit
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT gifts_log_sender_not_receiver CHECK (sender_id <> receiver_id)
);

CREATE INDEX IF NOT EXISTS gifts_log_room_id_idx ON gifts_log (room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gifts_log_receiver_id_idx ON gifts_log (receiver_id, created_at DESC);
