-- Stage 36 — Central Audit Log.
--
-- ../repositories/audit-log.repository.js reads/writes this table. Not
-- executed automatically (no live Postgres in this sandbox -- see
-- Database/STAGE3_TODO.md), same status as every other file in this
-- directory.
--
-- One append-only row per sensitive admin action, written by
-- ../../services/audit.service.js's record() -- the ONLY writer. Rows
-- are never updated or deleted by application code (see the repository
-- for why: an audit log you can edit after the fact is not an audit
-- log). This is deliberately separate from account.suspended_by (028):
-- that column is only the account's *current* suspension state; this
-- table is the immutable history of every admin action, suspend or
-- otherwise, across every Stage 36 admin surface (users, rooms, economy,
-- recharge, gifts, games, reports, bans, tickets, support, analytics).

CREATE TABLE IF NOT EXISTS audit_log (
    id          TEXT        PRIMARY KEY,             -- generateAuditLogId(), server-only
    actor_id    TEXT        NOT NULL REFERENCES accounts(id), -- the staff account that acted
    action      TEXT        NOT NULL,                -- e.g. 'account:suspend', 'inventory:grant'
    target_type TEXT        NOT NULL,                -- e.g. 'account', 'inventory_item', 'ticket'
    target_id   TEXT        NOT NULL,                -- the id of the thing acted upon
    reason      TEXT,                                 -- optional human-readable reason, if given
    metadata    JSONB       NOT NULL DEFAULT '{}',    -- action-specific extra detail (never PII beyond ids)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The admin panel's audit view (Stage 36 Admin APIs) filters by actor,
-- by action, and by target -- all three get their own index rather than
-- relying on a full scan, same discipline as
-- 028_add_account_suspension.sql's partial index.
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log (target_type, target_id, created_at DESC);
