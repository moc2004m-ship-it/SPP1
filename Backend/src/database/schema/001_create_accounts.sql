-- Stage 3 — Basic Account Model — canonical schema.
--
-- This defines the source-of-truth structure for accounts once a real
-- Postgres database is connected. It is NOT executed automatically as
-- part of Stage 3 (no external database is connected yet — see
-- Database/STAGE3_TODO.md). It exists so that connecting a real database
-- later is a configuration step, not a redesign.
--
-- All balance/rank fields default to 0 at the database level as a second
-- line of defense, in addition to the application-level defaults in
-- src/database/models/account.model.js.

CREATE TABLE IF NOT EXISTS accounts (
    id          TEXT PRIMARY KEY,              -- server-generated, e.g. usr_<uuid>
    vip         INTEGER     NOT NULL DEFAULT 0,
    svip        INTEGER     NOT NULL DEFAULT 0,
    lvl         INTEGER     NOT NULL DEFAULT 0,
    coins       BIGINT      NOT NULL DEFAULT 0,
    diamonds    BIGINT      NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT accounts_vip_non_negative      CHECK (vip >= 0),
    CONSTRAINT accounts_svip_non_negative     CHECK (svip >= 0),
    CONSTRAINT accounts_lvl_non_negative      CHECK (lvl >= 0),
    CONSTRAINT accounts_coins_non_negative    CHECK (coins >= 0),
    CONSTRAINT accounts_diamonds_non_negative CHECK (diamonds >= 0)
);
