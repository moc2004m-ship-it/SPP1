-- Stage 32 — Couple/CP domain — canonical schema.
--
-- Two tables, matching ../repositories/couple.repository.js's
-- PostgresCoupleRepository exactly (column-for-column):
--   couples         — one row per couple relationship ever formed.
--                     account_a/account_b are stored in canonical
--                     (lexicographically sorted) order purely so lookups
--                     have one predictable place to look -- this is NOT a
--                     hierarchy, a couple is symmetric between its two
--                     accounts (see ../../services/couple.service.js's
--                     header comment). cp_value/level are the real,
--                     server-recomputed totals (see addCp() below and
--                     ../../domain/couple-level-curve.js).
--   couple_invites  — one row per invite ever sent. Never deleted;
--                     status transitions (pending -> accepted / declined
--                     / cancelled) are the durable record of what
--                     happened.
--
-- ALL authorization/business rules (one-active-couple-per-account,
-- self-pair blocked, only the invitee may accept/decline, only the
-- inviter may cancel, cp only ever increasing through a real debited
-- gift) live in ../../services/couple.service.js — this schema only
-- enforces data integrity (foreign keys, valid enum values, non-negative
-- counters, one active couple per account at the database level as a
-- second line of defense behind the service-level check).
--
-- NOT executed automatically -- same activation switch as every other
-- table here: STAGE3_ENABLE_POSTGRES=true + DATABASE_URL (see ../index.js).
-- Reviewed against PostgresCoupleRepository's queries but never run
-- against a live database in this sandbox (no network -- see
-- Database/STAGE3_TODO.md), same status as every other Postgres* schema
-- file in this project.

CREATE TABLE IF NOT EXISTS couples (
    id         TEXT        PRIMARY KEY,     -- server-generated, e.g. cpl_<uuid>
    account_a  TEXT        NOT NULL REFERENCES accounts(id),
    account_b  TEXT        NOT NULL REFERENCES accounts(id),
    status     TEXT        NOT NULL CHECK (status IN ('active', 'ended')),
    cp_value   BIGINT      NOT NULL DEFAULT 0 CHECK (cp_value >= 0),
    level      INTEGER     NOT NULL DEFAULT 0 CHECK (level >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at   TIMESTAMPTZ,

    CONSTRAINT couples_distinct_accounts CHECK (account_a <> account_b),
    CONSTRAINT couples_canonical_order CHECK (account_a < account_b)
);

CREATE INDEX IF NOT EXISTS couples_account_a_idx ON couples (account_a);
CREATE INDEX IF NOT EXISTS couples_account_b_idx ON couples (account_b);

-- Second line of defense (behind couple.service.js's own check) for the
-- "one active couple per account" rule: at most one active couple row
-- may reference a given account, on either side.
CREATE UNIQUE INDEX IF NOT EXISTS couples_one_active_per_account_a_idx
  ON couples (account_a)
  WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS couples_one_active_per_account_b_idx
  ON couples (account_b)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS couple_invites (
    id          TEXT        PRIMARY KEY,     -- server-generated, e.g. cinv_<uuid>
    inviter_id  TEXT        NOT NULL REFERENCES accounts(id),
    invitee_id  TEXT        NOT NULL REFERENCES accounts(id),
    status      TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT couple_invites_inviter_not_invitee CHECK (inviter_id <> invitee_id)
);

CREATE INDEX IF NOT EXISTS couple_invites_invitee_id_idx ON couple_invites (invitee_id, status);
CREATE INDEX IF NOT EXISTS couple_invites_inviter_id_idx ON couple_invites (inviter_id, status);
