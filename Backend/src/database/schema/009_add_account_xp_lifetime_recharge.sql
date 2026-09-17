-- Stage 27/28 — VIP/SVIP + LVL/XP — adds the two counters accounts.model.js
-- and accounts.repository.js now read/write. Not executed automatically
-- (no live Postgres in this sandbox -- see Database/STAGE3_TODO.md), same
-- status as every other file in this directory.
--
-- xp: monotonically increasing (only ../repositories/account.repository.js's
-- addXp() ever changes it). lvl (already in 001_create_accounts.sql) is
-- always recomputed from xp in the same statement/transaction that
-- increments it -- see ../../domain/level-curve.js.
--
-- lifetime_diamonds_recharged: monotonically increasing total of every
-- successfully, provider-verified recharge ever completed for this
-- account (see ../../services/recharge.service.js). Deliberately separate
-- from the spendable coins/diamonds columns, which go DOWN when the user
-- spends -- vip/svip must be based on a counter that never decreases.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS xp BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_diamonds_recharged BIGINT NOT NULL DEFAULT 0;

ALTER TABLE accounts
  ADD CONSTRAINT accounts_xp_non_negative CHECK (xp >= 0),
  ADD CONSTRAINT accounts_lifetime_diamonds_recharged_non_negative CHECK (lifetime_diamonds_recharged >= 0);
