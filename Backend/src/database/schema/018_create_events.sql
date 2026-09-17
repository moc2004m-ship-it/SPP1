-- Stage 31 — Events domain — canonical schema.
--
-- Events and missions are a server-owned CODE catalog (see
-- ../../domain/events-catalog.js), same pattern as store items
-- (005_create_inventory.sql references store items the same way, by
-- plain TEXT id, no FK to a non-existent "store_items" table) -- there is
-- intentionally no `events` table here. What IS persisted is real,
-- per-account state that only exists because a real account did
-- something:
--
--   event_mission_progress — one row per (event, mission, account) ever
--                             started. Never deleted, so a completed/
--                             claimed mission stays real history.
--   event_shares            — one row per real share action. Never
--                             deduplicated -- a real share can happen
--                             more than once and every one is kept.
--
-- ALL business rules (is the event currently active, was this mission
-- already completed, was it already claimed) live in
-- ../../services/event.service.js -- this schema only enforces data
-- integrity (one progress row per event+mission+account, non-negative
-- progress, claimed_at set at most once).
--
-- NOT executed automatically -- same activation switch as every other
-- table here: STAGE3_ENABLE_POSTGRES=true + DATABASE_URL (see ../index.js).
-- Reviewed against PostgresEventRepository's queries but never run
-- against a live database in this sandbox (no network -- see
-- Database/STAGE3_TODO.md), same status as every other Postgres* schema
-- file in this project, including 017_create_families.sql before it.

CREATE TABLE IF NOT EXISTS event_mission_progress (
    id           TEXT        PRIMARY KEY,     -- server-generated, e.g. eprog_<uuid>
    event_id     TEXT        NOT NULL,        -- catalog event id (server-defined catalog, no FK)
    mission_key  TEXT        NOT NULL,        -- catalog mission key within that event
    account_id   TEXT        NOT NULL REFERENCES accounts(id),
    progress     INTEGER     NOT NULL DEFAULT 0 CHECK (progress >= 0),
    completed    BOOLEAN     NOT NULL DEFAULT false,
    claimed_at   TIMESTAMPTZ,                 -- set exactly once, by claimReward(); never unset
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One progress row per (event, mission, account) ever -- repeated
    -- progress increments update this same row rather than inserting a
    -- second one, so a mission can never be "completed" twice over.
    CONSTRAINT event_mission_progress_unique UNIQUE (event_id, mission_key, account_id)
);

CREATE INDEX IF NOT EXISTS event_mission_progress_account_id_idx
  ON event_mission_progress (account_id, claimed_at DESC);

CREATE TABLE IF NOT EXISTS event_shares (
    id         TEXT        PRIMARY KEY,     -- server-generated, e.g. esh_<uuid>
    event_id   TEXT        NOT NULL,        -- catalog event id (server-defined catalog, no FK)
    account_id TEXT        NOT NULL REFERENCES accounts(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_shares_account_id_idx ON event_shares (account_id, event_id);
