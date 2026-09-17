-- Stage 32 — Guard/Fan Club domain — canonical schema.
--
-- One table, matching ../repositories/guard.repository.js's
-- PostgresGuardRepository exactly (column-for-column):
--   guards — one row per (fan_id, host_id) pair, ever renewed in place
--            (never duplicated). total_contribution_coins is the real,
--            lifetime-accumulated total of real coins ever spent by this
--            fan on this host's guard (see guard.repository.js's
--            renewGuard()). expires_at is the real, server-computed
--            expiry -- extended from its own previous value on renewal
--            while still active, or restarted from the purchase time if
--            it had already lapsed. There is NO stored
--            active/expired flag -- status is always recomputed from
--            expires_at against the current time by
--            ../../services/guard.service.js's publicGuard(), same
--            discipline as ../../services/event.service.js's countdown,
--            so it can never go stale between requests.
--
-- ALL authorization/business rules (self-guard blocked, wallet debit
-- before any grant, tier price/duration resolution) live in
-- ../../services/guard.service.js -- this schema only enforces data
-- integrity (foreign keys, one row per fan/host pair, non-negative
-- counters).
--
-- NOT executed automatically -- same activation switch as every other
-- table here: STAGE3_ENABLE_POSTGRES=true + DATABASE_URL (see ../index.js).
-- Reviewed against PostgresGuardRepository's queries but never run
-- against a live database in this sandbox (no network -- see
-- Database/STAGE3_TODO.md), same status as every other Postgres* schema
-- file in this project.

CREATE TABLE IF NOT EXISTS guards (
    id                        TEXT        PRIMARY KEY,     -- server-generated, e.g. grd_<uuid>
    fan_id                    TEXT        NOT NULL REFERENCES accounts(id),
    host_id                   TEXT        NOT NULL REFERENCES accounts(id),
    tier_key                  TEXT        NOT NULL,        -- most-recently-purchased tier, see ../../domain/guard-catalog.js
    total_contribution_coins  BIGINT      NOT NULL DEFAULT 0 CHECK (total_contribution_coins >= 0),
    expires_at                TIMESTAMPTZ NOT NULL,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT guards_no_self_guard CHECK (fan_id <> host_id),
    UNIQUE (fan_id, host_id)
);

CREATE INDEX IF NOT EXISTS guards_host_id_idx ON guards (host_id);
CREATE INDEX IF NOT EXISTS guards_fan_id_idx ON guards (fan_id);
