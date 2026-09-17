-- Stage 36 — Central Staff/RBAC + Admin Panel — account suspension.
--
-- ../repositories/account.repository.js's suspend()/unsuspend()/
-- listSuspended() now read/write these columns. Not executed
-- automatically (no live Postgres in this sandbox -- see
-- Database/STAGE3_TODO.md), same status as every other file in this
-- directory (026_add_account_soft_delete.sql, 027_create_auth_tables.sql).
--
-- suspended_at: NULL means active/not-suspended (the default, unchanged
-- behavior for every existing account). Set by
-- ../repositories/account.repository.js's suspend(), which is only ever
-- reachable through the Stage 36 admin path once it checks
-- ../../security/staff.js's hasPermission(..., 'account:suspend') --
-- never client-writable, same "server decides, client never sends its
-- own role/flag" rule as deleted_at (026) and every VIP/SVIP/lvl/xp
-- field (009).
--
-- suspended_reason: required, non-empty text set at the same time as
-- suspended_at. A suspension without a recorded reason is not a valid
-- state in this codebase -- see suspend()'s validation.
--
-- suspended_by: the staff account id that performed the suspension.
-- Always a real, server-known accountId -- see suspend()'s actorId
-- parameter -- never a client-supplied field. Kept distinct from (and
-- in addition to) the central audit log
-- (../repositories/audit-log.repository.js), which separately records
-- this same action as an immutable, timestamped audit entry; this
-- column is only the account's *current* suspension state, not its
-- history.
--
-- Suspension is deliberately a SEPARATE state from deleted_at (026):
-- a suspended account is not deleted (its data, wallet, rooms, etc. are
-- all untouched and still exist), it is only blocked from
-- authenticating/acting -- see ../../auth/auth.store.js's session checks
-- for where suspended_at is enforced. A suspended account remains
-- suspended independently of anything happening to deleted_at, and vice
-- versa; the two columns are never coupled.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT,
  ADD COLUMN IF NOT EXISTS suspended_by TEXT;

-- Partial index: listSuspended() only ever needs the (typically small)
-- set of currently-suspended accounts, not a scan of the whole table.
CREATE INDEX IF NOT EXISTS idx_accounts_suspended_at
  ON accounts (suspended_at)
  WHERE suspended_at IS NOT NULL;
