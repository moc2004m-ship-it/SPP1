-- Phase 2 — Stages 6-35 domain records — canonical schema.
--
-- Context: `feature-platform.js` (Rooms, Battles, Games, Gifts, Family,
-- Events, Notifications, Settings, Moderation/Support, Profile, Social,
-- Chat, ...) was, before this migration, a single in-memory array per
-- stage number inside `FeatureStore` (see git history / STAGES_05_35_STATUS.md
-- "the stage 6-35 domain store is still in-memory"). That design -- one
-- generic append-only, JSON-shaped record per domain event, keyed by a
-- stage number -- is preserved here exactly, just moved onto a real table
-- instead of a process-local array, so it survives a restart and is a real
-- Postgres/Supabase table instead of an implementation detail of one Node
-- process.
--
-- This intentionally does NOT give each domain (rooms, battles, games, ...)
-- its own bespoke relational table with foreign keys yet -- doing that
-- for nine domains at once, from scratch, in one pass would be exactly the
-- kind of rewrite-from-zero this project has explicitly asked NOT to do.
-- What changes here is real: the JSONB payload is durable, queryable, and
-- survives a process restart; it does not fake persistence.
-- application-level validation (requireId/requireString in
-- feature-platform.js) is unchanged and still the only shape-validation
-- these records get -- there is no per-domain CHECK constraint here the
-- way wallet_balances/wallet_transactions have (see 003_create_wallets.sql),
-- because the generic table has no per-domain columns to constrain. If/when
-- a specific domain needs real relational invariants (e.g. "a room's
-- ownerId must reference an existing account", "a battle's matchId must be
-- unique"), that domain should get its own dedicated table the same way
-- wallet did, rather than trying to encode it generically here.

CREATE TABLE IF NOT EXISTS feature_records (
    id          TEXT        PRIMARY KEY,   -- server-generated, e.g. s12_<uuid>
    stage       INTEGER     NOT NULL,       -- matches the STAGES map in feature-platform.js (6-35)
    data        JSONB       NOT NULL,       -- the full record as feature-platform.js built it
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feature_records_stage_created_idx ON feature_records (stage, created_at ASC);
