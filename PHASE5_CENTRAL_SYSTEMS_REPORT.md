# Phase 5 — Central Systems (Account/ID → Wallet/Recharge → Inventory → Games → Gifts)

No live testing was performed this session, per instruction. All verification below
is local, dependency-free logic testing (`node --test`, no network, no real
Postgres/provider) — the same kind of testing this project has always used for
code that isn't installed/connected yet (see every prior `*_REPORT.md`).

## Scope note — what "40-stage plan" this covers

This pass focused on the central systems explicitly requested, in the requested
order: **Account/ID (already existed) → Database (extended) → Wallet/Recharge →
Inventory → Games (creation + boundary) → Gifts.** It does not implement the
remaining stage-specific business/product logic (VIP tier rules, LVL/XP curves,
per-game rule engines, Family features, etc.) — those are separate, large bodies
of work layered on top of what's built here, not central-system plumbing.

---

## DONE — real, tested, no fake data

### 1. Account/ID (already existed — confirmed, unchanged)
- `id` is always `crypto.randomUUID()`-based, generated in `account.model.js`,
  never accepted from a client anywhere in the codebase.
- `vip`/`svip`/`lvl`/`coins`/`diamonds` are `SERVER_OWNED_FIELDS` — client input can
  never set them. Confirmed still true; not touched this session.

### 2. Database — 4 new dedicated tables (Postgres schema + repositories)
Following the exact precedent already set by Wallet (`003_create_wallets.sql`) —
moved off the generic `feature_records` JSONB table onto real relational tables
with real foreign keys, for every domain that needed one:

| Domain | Schema file | Repository | Key invariant enforced at the DB level |
|---|---|---|---|
| Inventory | `005_create_inventory.sql` | `inventory.repository.js` | `UNIQUE(reference_id, item_id)` — a grant can never be double-applied |
| Recharge | `006_create_recharge_orders.sql` | `recharge.repository.js` | `wallet_transaction_id` FK — a completed order always points to a real wallet transaction |
| Gifts | `007_create_gifts.sql` | `gift.repository.js` | `wallet_transaction_id` FK (`NOT NULL`) + `sender_id <> receiver_id` CHECK |
| Games | `008_create_game_matches.sql` | `game-match.repository.js` | `result_source` CHECK constrained to `'server'` only |

All 4 have both `InMemory*` (active in this sandbox) and `Postgres*` (written,
reviewed, **not** run against a live database — same honest boundary every other
Postgres repository in this project already declares). `migrate.js` picks up the
new `.sql` files automatically (it globs the schema directory; no change needed
there).

### 3. Wallet/Recharge — real, provider-verified, idempotent
- `services/recharge.service.js`: `createOrder()` resolves `coinsToCredit` from a
  **server-side catalog** (`recharge.model.js`) — a client can request `pkg_small`
  but can never say "credit me X coins" directly.
- `completeOrder()` calls **real** purchase verification
  (`services/recharge-provider-verifier.js`) before crediting anything. No
  `RECHARGE_*_VERIFY_URL` configured → real `503`, wallet untouched — same
  fail-closed pattern as `auth/otp-sender.js` and `auth/provider-verifiers.js`.
  This is a **real HTTP verification call**, not a mock; it's just not reachable
  from this sandbox (see BLOCKED below).
- Crediting uses `idempotencyKey = orderId`, so a retried/duplicated "complete"
  call can never double-credit — verified by test.
- New routes: `POST /platform/api/recharge/orders`,
  `POST /platform/api/recharge/orders/:id/complete`,
  `GET /platform/api/recharge/orders[/​:id]` — all session-guarded, self-scoped.

### 4. Inventory — real, DB-backed, still correctly gated
- `GET /platform/api/inventory/:userId` now reads from the real repository
  (self-scoped, same pattern as wallet/notifications/settings).
- `POST /platform/api/inventory/grant` **stays blocked (403)** — granting must come
  from a trusted server-side event (a completed recharge, a verified store
  purchase). `inventory.grant()` is real and ready to be called by such a path
  once one exists; none does yet, so it is correctly not wired to any
  mobile-reachable route. This is the same honest choice the project already made
  before this session — confirmed, not weakened.

### 5. Games — real match creation; result stays honestly blocked
- `POST /platform/api/games` creates a **real** `game_matches` row with a real
  `matchId`; `startedBy` and the caller's own presence in `playerIds` are always
  taken from the session, never trusted from the client body.
- `services/game-match.service.js#finishMatch()` is real, idempotent (first result
  wins, verified by test), and validates `winnerId` is an actual match player —
  but it is **not** reachable from any mobile-facing route.
  **Why:** a real result requires a real per-game rules engine (Ludo dice/board
  logic, legal Chess moves, Snakes & Ladders state, ...) actually playing out the
  game server-side. That does not exist yet, and building it is a large, separate
  piece of work *per game*. The only two alternatives — trusting a client-declared
  winner, or inventing a random one — are exactly the fake-result shortcuts you
  said not to take. `POST /api/games/:matchId/finish` now explicitly returns 403
  saying so, instead of silently not existing.

### 6. Gifts — real wallet debit, real catalog pricing
- `services/gifts.service.js#sendGift()`: looks up `unitCostCoins` from a
  **server-side catalog** (`domain/gift-catalog.js`) — a client can request
  `gift_rose` but can never declare its own price.
- Debits the sender's **real** wallet balance via the existing, already-tested
  `WalletRepository.debit()` **before** any gift record is written. If the balance
  is insufficient, the debit is rejected (`409`) and **no gift record is created at
  all** — verified by test.
- Every gift row stores the real `walletTransactionId` it came from — a gift can
  never exist without a real, traceable debit behind it.
- `POST /api/gifts/send` and `GET /api/gifts/wall/:roomId` now go through this
  service/repository instead of the old generic, non-money-moving ledger entry.

### Cross-cutting: same User ID everywhere
Rooms/Games/Wallet/Inventory/Gifts/Profile all already keyed off
`req.session.accountId` before this session (confirmed by re-reading
`platform.routes.js`); this session's new routes (Recharge, the rebuilt
Games/Gifts/Inventory routes) follow the exact same rule — never a client-supplied
`userId`. VIP/SVIP/LVL live directly on the `accounts` row, same `id`.

### Tests run this session (local, no network — see scope note above)
| Suite | Result |
|---|---|
| `test/inventory.repository.test.js` (new) | 5/5 pass |
| `test/recharge.service.test.js` (new) | 7/7 pass |
| `test/gifts.service.test.js` (new) | 6/6 pass |
| `test/game-match.service.test.js` (new) | 6/6 pass |
| Full existing suite (`test/*.test.js`, 119 tests total) | **115 pass, 4 fail** |
| `node --check` on every new/edited file | all pass |

The 4 failures are the **same pre-existing cause** documented in every prior
report in this project (`accounts.routes.test.js`, `agora.routes.test.js`,
`auth.routes.test.js`, `config.routes.test.js` — all `Cannot find module
'express'`, because this sandbox cannot `npm install`). Confirmed by direct
inspection this session — nothing newly broken by this pass.

---

## BLOCKED — environment/credentials, not code, and not replaced with Mock

| Item | Blocked by | What exists instead |
|---|---|---|
| Running any of this against a real Postgres database | No network in this sandbox; needs `DATABASE_URL` + `STAGE3_ENABLE_POSTGRES=true` + a real Postgres/Supabase instance | Full schema + `Postgres*Repository` classes written and reviewed for all 4 new domains, same pattern as Wallet's already-accepted Postgres implementation |
| Real recharge provider verification (Google Play / App Store) | No `RECHARGE_GOOGLE_PLAY_VERIFY_URL` / `RECHARGE_APP_STORE_VERIFY_URL` configured, and no network to reach Google/Apple even if there were | Real fail-closed verifier (`recharge-provider-verifier.js`) — 503, credits nothing. Direct Google Play Developer API / App Store Server API SDK integration (service account, shared secret) is separate future work, not started this session, and not faked |
| HTTP-level route tests for the new endpoints (recharge/gifts/games) | `express` not installed (same root cause as the 4 pre-existing failures above) | Full logic tested at the service/repository layer instead (24 new tests), which is what actually contains the money-moving/idempotency logic |
| Real per-game rules engines (Ludo, Chess, Snakes & Ladders, ...) | Separate, large, per-game body of work — not a credentials/network gap, a scope gap | `finishMatch()` exists, is idempotent, and is ready for such an engine to call — but is deliberately not reachable by any client, and no fake/random result was substituted |
| `npm install` (so `pg`/`express` are actually on disk) | No network egress in this sandbox (confirmed again, same as every prior report) | Nothing — this is the one blocker that removes several of the above the moment it's run somewhere with internet |

**Nothing above was replaced with mock/demo data presented as real.** Every
blocked item either returns a real error (503/403) or simply isn't wired to a
route yet — never a fabricated success.

## To finish this from your side
```bash
cd Backend && npm install                    # unblocks express + pg locally
# then, with a real Postgres/Supabase instance:
export DATABASE_URL=postgres://...
export STAGE3_ENABLE_POSTGRES=true
npm run migrate                              # applies 001-008 schema files, in order
```
Then set `RECHARGE_GOOGLE_PLAY_VERIFY_URL` / `RECHARGE_APP_STORE_VERIFY_URL` once a
real verification endpoint exists, and re-run the full suite (`npm test`) — the
119+24 tests above should all pass once `express`/`pg` are present, and the
Postgres repository paths become exercisable for the first time against a real
database.
