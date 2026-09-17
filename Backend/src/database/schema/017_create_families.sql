-- Stage 30 — Family domain — canonical schema.
--
-- Three tables, matching ../repositories/family.repository.js's
-- PostgresFamilyRepository exactly (column-for-column):
--   families            — one row per family, level/xp are the real,
--                          server-recomputed totals (see addContribution()
--                          below and ../../domain/family-level-curve.js).
--   family_memberships  — one row per (family, account) relationship ever
--                          created. A membership row is NEVER deleted, even
--                          after leaving/kicked/banned, so contribution
--                          history and status history stay real and
--                          queryable (see reactivateMembership() in the
--                          repository, which flips status/role on the same
--                          row rather than inserting a new one on rejoin).
--   family_invites       — one row per invite ever sent. Also never
--                          deleted; status transitions (pending -> accepted
--                          / declined / revoked) are the durable record of
--                          what happened.
--
-- ALL authorization/business rules (who may invite/kick/ban, rank
-- enforcement, one-active-family-per-account, banned users blocked from
-- re-invite, donate() always starting with a real wallet debit) live in
-- ../../services/family.service.js — this schema only enforces data
-- integrity (foreign keys, valid enum values, non-negative counters, one
-- active membership per account at the database level as a second line of
-- defense behind the service-level check).
--
-- NOT executed automatically -- same activation switch as every other
-- table here: STAGE3_ENABLE_POSTGRES=true + DATABASE_URL (see ../index.js).
-- Reviewed against PostgresFamilyRepository's queries but never run
-- against a live database in this sandbox (no network -- see
-- Database/STAGE3_TODO.md), same status as every other Postgres* schema
-- file in this project.

CREATE TABLE IF NOT EXISTS families (
    id         TEXT        PRIMARY KEY,     -- server-generated, e.g. fam_<uuid>
    name       TEXT        NOT NULL CHECK (char_length(name) > 0 AND char_length(name) <= 100),
    owner_id   TEXT        NOT NULL REFERENCES accounts(id),
    level      INTEGER     NOT NULL DEFAULT 0 CHECK (level >= 0),
    xp         BIGINT      NOT NULL DEFAULT 0 CHECK (xp >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS families_owner_id_idx ON families (owner_id);

CREATE TABLE IF NOT EXISTS family_memberships (
    id           TEXT        PRIMARY KEY,     -- server-generated, e.g. fmem_<uuid>
    family_id    TEXT        NOT NULL REFERENCES families(id),
    account_id   TEXT        NOT NULL REFERENCES accounts(id),
    role         TEXT        NOT NULL CHECK (role IN ('member', 'admin', 'owner')),
    status       TEXT        NOT NULL CHECK (status IN ('active', 'left', 'kicked', 'banned')),
    contribution BIGINT      NOT NULL DEFAULT 0 CHECK (contribution >= 0),
    joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One relationship row per (family, account) ever — rejoining reuses
    -- the same row via reactivateMembership() rather than inserting a
    -- second one, so contribution history is never split across rows.
    CONSTRAINT family_memberships_family_account_unique UNIQUE (family_id, account_id)
);

CREATE INDEX IF NOT EXISTS family_memberships_family_id_idx ON family_memberships (family_id, status);
CREATE INDEX IF NOT EXISTS family_memberships_account_id_idx ON family_memberships (account_id);

-- Second line of defense (behind family.service.js's own check) for the
-- "one active family per account" rule: at most one row per account_id may
-- have status = 'active' at any time.
CREATE UNIQUE INDEX IF NOT EXISTS family_memberships_one_active_per_account_idx
  ON family_memberships (account_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS family_invites (
    id          TEXT        PRIMARY KEY,     -- server-generated, e.g. finv_<uuid>
    family_id   TEXT        NOT NULL REFERENCES families(id),
    inviter_id  TEXT        NOT NULL REFERENCES accounts(id),
    invitee_id  TEXT        NOT NULL REFERENCES accounts(id),
    status      TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT family_invites_inviter_not_invitee CHECK (inviter_id <> invitee_id)
);

CREATE INDEX IF NOT EXISTS family_invites_invitee_id_idx ON family_invites (invitee_id, status);
CREATE INDEX IF NOT EXISTS family_invites_family_id_idx ON family_invites (family_id, status);

-- Second line of defense for family.service.js's "no second pending invite
-- to the same (family, invitee)" rule.
CREATE UNIQUE INDEX IF NOT EXISTS family_invites_one_pending_per_family_invitee_idx
  ON family_invites (family_id, invitee_id)
  WHERE status = 'pending';
