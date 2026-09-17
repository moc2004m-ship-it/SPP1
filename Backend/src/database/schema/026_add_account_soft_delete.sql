-- Stage 34 — Delete Account — adds the soft-delete column
-- ../repositories/account.repository.js's softDelete()/isDeleted() now
-- read/write. Not executed automatically (no live Postgres in this
-- sandbox -- see Database/STAGE3_TODO.md), same status as every other
-- file in this directory.
--
-- deleted_at: NULL means active (the default, unchanged behavior for
-- every existing account). Set exactly once, server-side, by
-- ../../services/settings.service.js's deleteAccount() -- never client-
-- writable. This is a SAFE soft delete only, per explicit instruction:
-- no cascading purge of wallet/room/family/chat/notifications/etc. data.
-- A soft-deleted account's row (and every other stage's data referencing
-- it) is left exactly as it was; only this column changes, plus every
-- one of that account's sessions being revoked (see
-- ../../auth/auth.store.js's revokeAllSessions()).

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
