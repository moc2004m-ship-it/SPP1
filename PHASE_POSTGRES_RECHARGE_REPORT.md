# Phase — Postgres Recharge Repository Report

Scope of this task: **only**
`Backend/src/database/repositories/recharge.repository.js`.
No other repository, service, route, or Stage was touched. `game-match.repository.js`
and `wallet.repository.js` were inspected only for reference (to reuse their
established pattern) and were **not modified**.

## 1. Schema reviewed

`Backend/src/database/schema/006_create_recharge_orders.sql` — `recharge_orders` table:

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | server-generated `rchg_<uuid>`; also used as the wallet `idempotency_key` |
| `account_id` | TEXT NOT NULL, FK → accounts | snake_case |
| `package_id` | TEXT NOT NULL | server-side catalog id, never client-trusted |
| `coins_to_credit` | **BIGINT** NOT NULL, `CHECK (> 0)` | resolved server-side from the catalog |
| `provider` | TEXT NOT NULL | e.g. `google_play`, `app_store` |
| `provider_purchase_ref` | TEXT NULL | opaque purchase token/receipt |
| `status` | TEXT NOT NULL DEFAULT `pending` | `pending` \| `verified` \| `completed` \| `failed` |
| `failure_reason` | TEXT NULL | |
| `wallet_transaction_id` | TEXT NULL, FK → wallet_transactions | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

Idempotency design (unchanged, verified intact): the order's own `id` is
reused as the wallet's `idempotencyKey` on completion, so a retried
"complete" call can never credit the wallet twice — this is enforced at
both the recharge-order level and independently inside
`wallet.repository.js`.

## 2. Bug found

`InMemoryRechargeRepository` returned camelCase objects
(`accountId`, `packageId`, `coinsToCredit`, `providerPurchaseRef`,
`failureReason`, `walletTransactionId`, `createdAt`, `updatedAt`), exactly
matching what `recharge.service.js` and `recharge.routes.js` read
(`order.accountId`, `order.packageId`, `order.coinsToCredit`, etc.).

`PostgresRechargeRepository`, however, returned the **raw `pg` row**
unmapped — snake_case columns (`account_id`, `package_id`,
`coins_to_credit`, ...) — from every method (`create`, `findById`,
`markCompleted`, `markFailed`, `listByAccount`). Under
`STAGE3_ENABLE_POSTGRES=true` this would silently break the service layer
(`order.accountId` → `undefined`, ownership check in
`completeOrder()` would never match, `order.coinsToCredit` → `undefined`
credited to the wallet) — a correctness bug that would only surface once a
real Postgres/Supabase connection was enabled, not caught by the existing
in-memory-only tests.

In addition, `coins_to_credit` is `BIGINT`, which the `pg` driver returns as
a **string**, not a number, to avoid silently corrupting values beyond
`Number.MAX_SAFE_INTEGER`. The old code passed this string through
untouched, which would also have produced a type mismatch against the
in-memory backend's plain-number `coinsToCredit`.

## 3. Fix applied

Reused the exact pattern already established in `wallet.repository.js`:

- Added `bigintToSafeNumber(value)` — converts a BIGINT string to a JS
  number only after confirming an exact round-trip through `Number()`;
  throws a `500` if the value would lose precision (i.e. a real account
  with an implausibly large `coins_to_credit`, which should never happen
  given the catalog is fixed, but is enforced anyway rather than assumed).
- Added `mapOrderRow(row)` — maps a raw `recharge_orders` row onto the
  identical shape `InMemoryRechargeRepository` already returns:
  `{ id, accountId, packageId, coinsToCredit, provider,
  providerPurchaseRef, status, failureReason, walletTransactionId,
  createdAt, updatedAt }`. `created_at`/`updated_at` (`TIMESTAMPTZ`, which
  `pg` returns as a JS `Date`) are converted to ISO strings to match the
  in-memory backend's `.toISOString()` convention.
- Every `PostgresRechargeRepository` method (`create`, `findById`,
  `markCompleted`, `markFailed`, `listByAccount`) now passes its result(s)
  through `mapOrderRow` before returning, including the "already
  completed/failed, re-fetch existing row" fallback paths inside
  `markCompleted`/`markFailed`.

No SQL, no idempotency logic, and no method signatures were changed — this
was purely a row-shape mapping fix, matching the wallet repository's
already-reviewed approach.

## 4. Idempotency / business logic — unchanged, verified

- `markCompleted`: SQL still guards with `WHERE id = $1 AND status <>
  'completed'`; a second call for an already-completed order returns the
  same completed row (now correctly mapped) instead of re-applying
  anything.
- `markFailed`: same `status <> 'completed'` guard — a completed order can
  never be downgraded to `failed`.
- `recharge.service.js`'s `completeOrder()` orchestration (verify → credit
  wallet with `idempotencyKey = orderId` → `markCompleted`) was not
  touched and needed no changes — it was already reading the (now correct)
  camelCase shape.
- No Fake/Demo data was added anywhere.

## 5. Tests run

```
node --test test/recharge.service.test.js
```
Result: **7/7 passed** (all against `InMemoryRechargeRepository`, per the
existing sandbox test design — no real network available):
- createOrder resolves coinsToCredit from the server-side catalog, never the client
- rejects an unknown packageId
- completeOrder credits the wallet only after real verification succeeds
- a failed verification marks the order failed and credits nothing
- an unconfigured provider fails closed with 503 and credits nothing
- completing the same order twice does not credit the wallet twice (idempotent)
- completing another account's order is rejected

Full backend suite for regression check:
```
node --test 'test/**/*.test.js'
```
Result: **115/119 passed**. The 4 failures (`accounts.routes.test.js`,
`agora.routes.test.js`, `auth.routes.test.js`, `config.routes.test.js`) are
pre-existing and unrelated to this change — they fail with `Cannot find
module 'express'` because `node_modules` is not installed in this sandbox
(no network access to run `npm install`). No recharge, wallet, or
game-match test is among the failures.

Additional targeted verification (since no live Postgres/Supabase is
reachable from this sandbox — see §6): a mock `pg`-shaped pool was used to
confirm `PostgresRechargeRepository` correctly maps a raw row (snake_case
columns, `coins_to_credit` as a BIGINT string, `created_at`/`updated_at` as
`Date` objects) to the camelCase shape the service expects, that the
BIGINT-precision guard throws a `500` on an unsafe value, and that
`listByAccount` maps every row in the returned array. All three checks
passed.

## 6. Syntax check

```
node --check src/database/repositories/recharge.repository.js   → OK
find src -name "*.js" | xargs -n1 node --check                  → all OK, no failures
```

## 7. BLOCKED_LIVE_TEST

**BLOCKED_LIVE_TEST**: This sandbox has no network access and no `pg`
package installed, so `PostgresRechargeRepository` could not be exercised
against a real PostgreSQL/Supabase instance. Verification here is limited
to: (a) static review against the schema, (b) the full in-memory test
suite, and (c) a mock-`pool` unit check that reproduces `pg`'s actual
row shape (snake_case + BIGINT-as-string + `Date` timestamps) to validate
the mapping logic in isolation. A real end-to-end run against a live
database with `STAGE3_ENABLE_POSTGRES=true` and a real `DATABASE_URL` is
still recommended before production use.

## 8. Files changed

- `Backend/src/database/repositories/recharge.repository.js` (only file modified)

`gift`, `inventory`, `game-match.repository.js`, `wallet.repository.js`,
and all other Stages/files were left untouched, per scope.
