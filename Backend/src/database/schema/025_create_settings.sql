-- Stage 34 — General Settings domain — canonical schema.
--
-- Matches ../repositories/settings.repository.js's
-- PostgresSettingsRepository exactly. One table: one row per (user_id,
-- key), real upsert-in-place (see the repository's ON CONFLICT clause) --
-- replaces the old append-only stage-34 feature_records rows (which had
-- no unique constraint and were never updated in place).
--
-- key is restricted to the five real Stage 34 preference keys (see
-- ../models/settings.model.js's SETTING_KEYS) -- the CHECK constraint is
-- a second, redundant layer of protection under the service-level
-- validation in ../../services/settings.service.js, same
-- "schema enforces data integrity, service enforces the rule" split used
-- throughout this project (e.g. notifications.status above).
--
-- NOT executed automatically -- same activation switch as every other
-- table here: STAGE3_ENABLE_POSTGRES=true + DATABASE_URL (see ../index.js).
-- Reviewed against PostgresSettingsRepository's queries but never run
-- against a live database in this sandbox (no network -- see
-- Database/STAGE3_TODO.md), same status as every other Postgres* schema
-- file in this project.

CREATE TABLE IF NOT EXISTS settings (
    id         TEXT        PRIMARY KEY,     -- server-generated, e.g. set_<uuid>
    user_id    TEXT        NOT NULL REFERENCES accounts(id),
    key        TEXT        NOT NULL CHECK (key IN ('language', 'sound', 'mic', 'network', 'media')),
    value      JSONB       NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (user_id, key)
);

CREATE INDEX IF NOT EXISTS settings_user_id_idx ON settings (user_id);
