# Final Correction Report — Stages 05–35 Foundation

## Corrections applied inside this ZIP

1. **Secret hygiene** — removed the tracked `Backend/.env` file and added a repository `.gitignore` that blocks `.env`/runtime secrets.
2. **Environment safety** — staging/production explicitly require Postgres; the database factory now fails closed instead of silently falling back to in-memory storage. Development remains explicitly memory-first unless enabled.
3. **Wallet idempotency** — idempotency is now scoped per account and a reused key with a different currency/direction/amount is rejected. The SQL uniqueness constraint matches this contract.
4. **Search** — replaced the unconditional empty search result with real repository-backed search across users, rooms, families and games, while exposing only public-safe account fields.
5. **Splash flow** — corrected the post-splash path to the actual Mobile Auth screen instead of the DesignSystem demo login.
6. **Game result trust boundary** — added a Postgres trigger requiring a transaction-local trusted game-engine setting before a match can be finalized; the repository sets that setting inside its transaction.
7. **Gift transaction integrity** — Postgres gift sending now performs wallet debit + wallet ledger entry + gift record in one database transaction.
8. **Apple Sign-In verification** — added actual Apple JWKS lookup, ES256 signature verification, issuer/audience/expiry validation, with fail-closed behavior.
9. **Local development DB** — added a Postgres service to the development Docker profile and aligned the development DATABASE_URL.
10. **Public account exposure** — the account lookup response no longer returns wallet balances; wallet data remains behind the wallet endpoints.
11. **Postgres row-shape consistency** — account/reference/gift/game-match Postgres repositories now map snake_case database rows to the camelCase domain shape used by the in-memory implementations, including timestamp and JSON fields.

## Verification performed

- JavaScript syntax checks were run over the corrected source tree.
- SQL files were reviewed for statement consistency and the new constraints/triggers.
- Existing test suite remains present. Full HTTP tests still require installing the declared npm dependencies (`express`, `pg`, etc.); the original sandbox had no `node_modules` and npm network access was unavailable.

## Important remaining scope

This correction pass fixes the concrete defects found in the prior audit. It does **not** truthfully mark missing product stages as complete. The full original 40-stage plan still requires real implementation of the missing UI/domain/game/payment/push/admin/DevOps/beta work, including real Google Play Billing, Firebase Push, RTC live validation, native Android packaging, per-game server rules engines, persistent authentication/session storage, and the remaining stages 6–40.

No fake success, fake payment verification, fake game results, or fake live-provider connection was added.

12. **Migration safety** — added migration `016_wallet_idempotency_scope.sql` so an existing database created from the older schema is upgraded from global idempotency uniqueness to account-scoped uniqueness instead of merely changing a future `CREATE TABLE` definition.
