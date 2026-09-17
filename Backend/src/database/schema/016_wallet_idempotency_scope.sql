-- Final correction: wallet idempotency is scoped to an account and must not
-- accidentally reuse another account's transaction. Older versions created
-- a global UNIQUE constraint on idempotency_key; remove it if present, then
-- enforce the corrected composite uniqueness contract.
ALTER TABLE wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_idempotency_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_account_id_idempotency_idx
  ON wallet_transactions (account_id, idempotency_key);
