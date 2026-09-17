-- Stage 33 — Notifications + Push domain — canonical schema.
--
-- Three tables, matching ../repositories/notification.repository.js's
-- PostgresNotificationRepository exactly (column-for-column):
--   notifications            — one row per notification ever created.
--                               Never deleted, never edited except
--                               status/read_at -- the durable record of
--                               what was ever sent to this account.
--                               type/category are always resolved
--                               server-side from
--                               ../../domain/notification-catalog.js by
--                               ../../services/notification.service.js
--                               before insert -- never trusted as
--                               free-form strings from a client.
--   notification_preferences — at most one row per account. muted_categories
--                               is the set of categories this account has
--                               chosen not to receive. An account with no
--                               row here has nothing muted (the default).
--                               'security' can never appear in this set --
--                               enforced in
--                               notification.service.js's
--                               updatePreferences(), not here (same split
--                               as every other authorization rule in this
--                               project: schema enforces data integrity,
--                               service enforces the rule).
--   push_tokens               — one row per (account_id, token) pair,
--                               upserted in place on re-registration
--                               (never duplicated) — see registerDevice()
--                               in the repository above.
--
-- ALL authorization/business rules (who may create a notification for
-- whom, ownership check on markRead/removeDevice, security-can-never-be-
-- silenced) live in ../../services/notification.service.js -- this
-- schema only enforces data integrity (foreign keys, valid enum values,
-- one preferences row per account, one push-token row per account+token
-- pair).
--
-- NOT executed automatically -- same activation switch as every other
-- table here: STAGE3_ENABLE_POSTGRES=true + DATABASE_URL (see ../index.js).
-- Reviewed against PostgresNotificationRepository's queries but never run
-- against a live database in this sandbox (no network -- see
-- Database/STAGE3_TODO.md), same status as every other Postgres* schema
-- file in this project.

CREATE TABLE IF NOT EXISTS notifications (
    id           TEXT        PRIMARY KEY,     -- server-generated, e.g. ntf_<uuid>
    recipient_id TEXT        NOT NULL REFERENCES accounts(id),
    type         TEXT        NOT NULL,        -- see ../../domain/notification-catalog.js
    category     TEXT        NOT NULL,
    payload      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    deep_link    TEXT        NOT NULL,
    status       TEXT        NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS notifications_recipient_id_idx ON notifications (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx ON notifications (recipient_id) WHERE status = 'unread';

CREATE TABLE IF NOT EXISTS notification_preferences (
    account_id       TEXT        PRIMARY KEY REFERENCES accounts(id),
    muted_categories JSONB       NOT NULL DEFAULT '[]'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_tokens (
    id         TEXT        PRIMARY KEY,     -- server-generated, e.g. pt_<uuid>
    account_id TEXT        NOT NULL REFERENCES accounts(id),
    token      TEXT        NOT NULL,
    platform   TEXT        NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (account_id, token)
);

CREATE INDEX IF NOT EXISTS push_tokens_account_id_idx ON push_tokens (account_id);
