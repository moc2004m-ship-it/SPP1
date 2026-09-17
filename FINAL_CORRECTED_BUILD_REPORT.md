# FINAL CORRECTED BUILD REPORT

## Deliverable
- ZIP: `STAGES_05_35_CORRECTED_FINAL.zip`
- Scope: correction pass over the previously audited Stages 05–35 foundation.

## Fixes included inside the ZIP
1. Removed tracked `Backend/.env` and added secret-safe `.gitignore`.
2. Staging/production now fail closed unless Postgres is explicitly enabled and `DATABASE_URL` exists; no silent in-memory production fallback.
3. Wallet idempotency is scoped to `(account_id, idempotency_key)` and mismatched reuse is rejected.
4. Added migration `016_wallet_idempotency_scope.sql` for existing databases.
5. Search now returns real repository-backed users/rooms/families/games instead of `results: []`.
6. Corrected Splash navigation to the real Mobile Auth screen.
7. Added Postgres game-result trigger protection and trusted transaction-local game-engine setting.
8. Postgres gift sending now atomically performs wallet debit + ledger entry + gift record.
9. Apple Sign-In now performs JWKS lookup, ES256 signature validation, issuer/audience/expiry checks, and fails closed.
10. Added local development Postgres service to Docker Compose.
11. Account lookup is session-protected and no longer exposes wallet balances.
12. Fixed Postgres repository row mapping for accounts, references, gifts and game matches so DB snake_case rows match the application camelCase contract.
13. Added regression tests for wallet idempotency, real search and forged Apple signatures.

## Verification
- JavaScript syntax: **80 files checked, 0 failures** (`node --check` on every file under Backend/src, Backend/test, Backend/scripts, Mobile).
- JSON validation: **all 11 JSON files valid**.
- New correction tests: **3/3 passed** (`Backend/test/final-corrections.test.js`, run directly with `node --test`).
- Full dependency-free suite actually run (Backend non-Express files + Mobile): **148/148 passed** (118 Backend + 30 Mobile). This corrects an earlier, lower count in this report; no failures were hidden or introduced.
- Backend route tests that require `express`/`supertest` (`accounts.routes`, `agora.routes`, `auth.routes`, `config.routes` — 4 files) could not be executed in this sandbox because `node_modules` is absent and there is no network access to install dependencies. This is environment-blocked, not a code failure — see Open Items below.
- `Backend/package-lock.json` is **missing** (only `package.json` is present). This should be generated (`npm install --package-lock-only`) with network access and committed, so installs are reproducible.

## Open items (not fixed in this pass — need real environment access)
- `package-lock.json` — MISSING, needs generating with network access.
- 4 Express-route test files (`accounts.routes.test.js`, `agora.routes.test.js`, `auth.routes.test.js`, `config.routes.test.js`) — BLOCKED_LIVE_TEST, need `npm install` to run.
- No live Postgres connection was available to exercise any `Postgres*Repository` class end-to-end; all Postgres code paths were verified by static/code review only (schema-vs-mapping-function column matching), not by an actual query.
- Game submit-result route explicitly returns "not available yet" — the real server-side game rules engine is still MISSING by design, not a bug.

## What is NOT falsely marked complete
The original 40-stage plan still contains substantial product work that was missing from the audited build: complete Home/Profile/Rooms/Game Center/Game engines, persistent authentication/session storage, real Google Play Billing, Firebase Push, full Store/VIP/LVL/Family/Rankings/Couple/Admin/Analytics/DevOps/Beta work, native Android packaging, and live-provider/device/network verification. Those remain open rather than being represented by fake placeholders.

## Security rule
No fake payment verification, fake game result, fake Agora token, or client-trusted wallet result was introduced.

## Second correction pass (this session)
Found and closed two real, previously-undocumented gaps — no request from the person prompted looking for these; they were found by direct code review of the security-relevant paths (rate limiting, headers) called out in the audit checklist:

1. **No rate limiting anywhere**, most importantly on `/auth/otp/request` and `/auth/recovery/otp/request`. A client could call either endpoint without bound, which is both an SMS-cost abuse vector and a brute-force amplifier. Added `Backend/src/security/rate-limit.js`: a dependency-free sliding-window limiter (5 requests / 10 minutes, keyed by `ip+phone`, shared across both OTP routes) with a `429` + `Retry-After` response when exceeded. Hand-rolled instead of `express-rate-limit` because this sandbox has no network access to `npm install` — this works today and can be swapped for the npm package later without changing the route code.
2. **No security response headers anywhere**. Added `Backend/src/security/headers.js`, applied globally in `src/index.js`: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` (this is a JSON API with authenticated responses — nothing here should be cached), and `Strict-Transport-Security` when the connection is already secure.

Both are in-memory/in-process, same durability limitation as every other `InMemory*` store already documented in this build (does not survive a restart, does not share state across multiple server instances — a real deployment should move the rate-limit counters to Redis).

7 new dependency-free tests added (`Backend/test/rate-limit.test.js`), all passing. Full dependency-free suite re-run after this change: **155/155 passed** (125 Backend + 30 Mobile), confirming no regression from the new middleware. JS syntax re-checked across the whole project: 0 failures.

### Still open after this pass (need real environment access, not fixable here)
- `package-lock.json` — still missing, needs `npm install --package-lock-only` with network access.
- The 4 Express-route test files — still BLOCKED_LIVE_TEST, need `npm install`.
- No live Postgres connection was available — Postgres repository code is still verified by static review only.
- Real server-side game rules engine — still MISSING by design (submit-result stays 403).
- Mobile UI is still a developer shell (Home/Rooms/Events/Wallet/Profile only, `prompt()`-based flows for games/gifts/family). No Inventory, Store, VIP/LVL, Rankings, Family, or Recharge screens exist yet — this was intentionally left for later per the person's own instruction and is not treated as a defect of this pass.
