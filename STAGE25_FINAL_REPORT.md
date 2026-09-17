# Stage 25 (Recharge / Google Play Billing) — FINAL REPORT

## Status: **Stage 25 — COMPLETE**

(Complete to the same standard every other stage in this project is held
to — see §6 for the one permanent, environmental boundary this does not
and cannot close, exactly like Postgres-live/real-Express-HTTP/real-
Firebase-push/real-SMS for every other stage.)

---

## 1. Scope confirmed on inspection

Stage 25 = **"Recharge/Google Play Billing"**, per `Backend/src/feature-platform.js`'s
own `STAGES` map (`25:'Recharge/Google Play Billing'`), and per
`STAGES_1_35_CONTINUATION_STATE.md`'s explicit note that Google Play
Billing (25) is permanently environment-blocked for *live* provider
verification (no network, no Google service-account credentials in this
sandbox).

Before writing anything, I inspected the existing implementation:
- `Backend/src/services/recharge.service.js` — real order→verify→credit
  orchestration, idempotent, already wired to `accounts`
  (lifetimeDiamondsRecharged) and `notificationService` (PAYMENT_COMPLETED).
- `Backend/src/services/recharge-provider-verifier.js` — real,
  fail-closed (503-when-unconfigured) HTTP verification boundary.
- `Backend/src/database/models/recharge.model.js` — server-owned package
  catalog, provider/purchase-ref validation.
- `Backend/src/database/repositories/recharge.repository.js` — In-Memory +
  Postgres, dual implementation, already used elsewhere.
- `Backend/src/routes/recharge.routes.js` — 4 routes, session-gated,
  already wired in `Backend/src/index.js`.
- `Backend/test/recharge.service.test.js` — 17/17 pre-existing tests,
  thorough at the service/business-logic layer.

This confirmed the backend **engine** was already real and well-tested.
Three genuine, previously-undocumented gaps were found and are what this
session closed:
1. No route existed for a client to discover the real package catalog —
   a client would have had to hardcode `packageId` strings.
2. No route-contract test file existed for recharge routes, unlike every
   other stage's routes (referral, room-in-room, notifications, ...).
3. **No Mobile UI existed at all.** The wallet screen's own comment said
   *"لا يوجد شحن هنا لأن هذا المسار للقراءة فقط"* ("no top-up here, this
   route is read-only") — stale, predating the recharge engine's build.

## 2. What was implemented this session

### Backend
- **`Backend/src/database/models/recharge.model.js`** — added
  `listPackages()`: returns the real, server-owned catalog as a plain
  array (id + coins), sorted ascending by coins. No new field invented
  beyond what `PACKAGES` already held.
- **`Backend/src/routes/recharge.routes.js`** — added
  `GET /api/recharge/packages`, gated by the same `requireSession`
  middleware as every other route in this router (no new
  public/unauthenticated surface introduced).

### Mobile
- **`Mobile/app/app.js`** — replaced the stale "no top-up here" wallet
  copy with a real Recharge/Google Play Billing flow, following the
  exact conventions already established by Referral/Room-in-Room:
  - `rechargePackageRow()` / `rechargeOrderRow()` — render only real,
    server-returned fields (id, coins, provider, status,
    failureReason); a completed/failed order never shows a "complete"
    button (only `status==='pending'` does — same "only show what the
    server would allow" rule `gameRow()`/`breakoutRow()` already use).
  - `renderRechargePackages()` — `GET /api/recharge/packages`, real
    catalog only.
  - `bindRechargeActions()` — "شراء عبر Google Play" creates a real
    order (`POST /api/recharge/orders`, provider fixed to
    `google_play`); "إكمال الشراء" prompts for the purchase token (this
    shell has no native Google Play Billing library to obtain one
    automatically — same "user supplies the externally-sourced value"
    rule already used for the referral code prompt) and calls
    `POST /api/recharge/orders/:orderId/complete`. Any real server
    response — success, or a real 402/503 — is shown verbatim via
    `resultCard()`/`toast()`; nothing here fabricates a credited
    balance or a fake "verified" state.
  - `renderMyRechargeOrders()` — `GET /api/recharge/orders`.
  - `wallet()` — two new buttons (`#rechargePackages`/`#rechargeOrders`)
    replacing the old static "read-only" text.

No parallel architecture was introduced anywhere — every addition reuses
the existing `api()`/`prompt()`/`toast()`/`resultCard()`/`listCard()`/
`esc()` helpers and the existing `rechargeService`/`recharges` objects
already wired in `src/index.js`.

## 3. Files changed / created

**New:**
- `Backend/test/recharge-provider-verifier.test.js`
- `Backend/test/platform.recharge.stage25.routes-contract.test.js`
- `Mobile/app/test/app.recharge.stage25.test.js`
- `STAGE25_FINAL_REPORT.md` (this file)

**Modified:**
- `Backend/src/database/models/recharge.model.js` (+`listPackages()`)
- `Backend/src/routes/recharge.routes.js` (+`GET /api/recharge/packages`)
- `Mobile/app/app.js` (`wallet()` rewritten with real recharge UI; no
  other function in the file touched)

**Not touched (verified by a full recursive `diff` against the exact
project as originally uploaded in `PROJECT_STAGE23_PART2_COMPLETE.zip`):**
every other file in the project — including all of Stage 23
(Referral/Invite + Room-in-Room, both parts byte-identical to the
uploaded ZIP), Stages 20/21/22, and every Stage 1–19/24/26–35 file.

## 4. Tests added

- 14 tests — `recharge-provider-verifier.test.js` (missing-ref → 400,
  unconfigured provider → 503 with zero real network calls attempted,
  configured happy path with real request-shape assertions,
  `providerTransactionId: null` fallback, non-2xx → 402, `valid:false` →
  402, missing/`null` response body → 402, `loadRechargeProviderConfigFromEnv`
  for both providers together/separately/absent, and a direct sanity
  check that this sandbox's real `process.env` has no recharge provider
  configured — matching the documented permanent BLOCKED boundary).
- 9 tests — `platform.recharge.stage25.routes-contract.test.js`
  (packages route needs no ownership + is really sorted; create/complete
  always take identity from `req.session.accountId`, never a spoofed
  body field; unknown packageId leaves no order behind; completing
  another account's order → 403; list-my-orders never leaks another
  account's orders; get-one-order → 404 unknown / 403 wrong owner / 200
  real owner).
- 8 tests — `app.recharge.stage25.test.js` (real package list rendering;
  wallet-button wiring for both new buttons; buying a package posts the
  real packageId + fixed `provider:'google_play'` with **no**
  client-sent `accountId`; cancelling the purchase-token prompt makes
  zero API calls; a submitted token calls the real complete endpoint and
  renders the real completed order; a real server rejection — e.g. the
  documented 503 "provider not configured" — surfaces verbatim via toast,
  never a fake success; a completed order's row has no "إكمال الشراء"
  button).

**31 new tests total, all passing.**

## 5. Verified test results (exact, run this session)

- `node --check`: **clean** on every `.js` file under `Backend/src/`,
  `Backend/test/`, `Backend/scripts/`, and `Mobile/app/` (full sweep,
  file-by-file, not just the touched ones) — zero syntax errors.
- `recharge-provider-verifier.test.js` run in isolation: **14/14 pass**.
- `platform.recharge.stage25.routes-contract.test.js` run in isolation: **9/9 pass**.
- `app.recharge.stage25.test.js` run in isolation: **8/8 pass**.
- **Full Backend suite** (`node --test test/*.test.js`), re-run 6
  consecutive times:
  ```
  tests 995
  pass  991   (5 out of 6 runs)
  fail  4     (same 4 pre-existing, already-documented environmental
               fails every time: accounts.routes.test.js,
               agora.routes.test.js, auth.routes.test.js,
               config.routes.test.js — all "Cannot find module
               'express'", no network/npm in this sandbox)
  ```
  995 = 972 (pre-existing baseline, per
  `STAGE23_PART2_ROOM_IN_ROOM_REPORT.md`'s own "968/972 pass" figure) + 23
  new Backend tests (14 + 9) = 995 total; 968 pre-existing passes + 23 new
  passes = 991; the same 4 pre-existing fails throughout — arithmetic
  matches exactly, confirming zero tests were lost or silently dropped.
  **One of the 6 runs showed a 5th failure**: a single flaky subtest in
  `platform.notifications.routes-contract.test.js`
  ("`GET /api/notifications/:userId contract: ... newest first, no extra
  reverse needed`") — this is the same pre-existing, already-documented
  ordering/timing flake first noted in
  `STAGE23_PART2_ROOM_IN_ROOM_REPORT.md`'s §6 ("an earlier ad hoc run
  during this session also showed the pre-existing, already-documented
  notifications ordering timing flake pop up once"). It is unrelated to
  recharge/Stage 25 (different file, different domain, pre-dates this
  session's changes), did not reappear in 5 of 6 runs, and no recharge
  test flaked in any of the 6 runs. **Zero new failures caused by Stage
  25 in any run.**
- **Full Mobile suite** (`node --test test/*.test.js`), re-run 3
  consecutive times: **81/81 pass every time** (73 pre-existing + 8 new,
  zero flakes, zero regressions).

## 6. Pre-existing / environmental limitations (not new, not this stage's gap)

- The 4 Backend `express`-missing failures: permanent, pre-existing,
  present since Phase 1 (no network access to `npm install` in this
  sandbox) — unrelated to Stage 25, unchanged in count or identity.
- The 1 flaky `notifications` ordering subtest: permanent, pre-existing,
  already documented in a prior stage's report — unrelated to Stage 25.
- **Live Google Play Billing verification remains, and will permanently
  remain, environmentally BLOCKED** in this sandbox: no network access,
  no Google Play service-account credentials
  (`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`), no way to reach Google's Play
  Developer API. This was true before this session and is unchanged by
  it — `recharge-provider-verifier.js`'s real, generic
  `RECHARGE_GOOGLE_PLAY_VERIFY_URL` webhook path is real and tested (see
  §4/§5 above); a deployment with real credentials/network can plug a
  real verification microservice into it today. This is not a gap left
  in Stage 25's scope — it is the same category of permanent boundary
  already documented for every other external provider in this project
  (real SMS/OTP delivery, real Postgres, real Express HTTP server, real
  Firebase push, real Apple/Google social-login token verification).
  Nothing here fakes, stubs, or pretends to satisfy that boundary.

## 7. Confirmation: Stage 23 and unrelated stages were not modified

A full recursive `diff` between this session's project tree and the
project exactly as uploaded (`PROJECT_STAGE23_PART2_COMPLETE.zip`) shows
**exactly six paths differ**, and nothing else:
```
Backend/src/database/models/recharge.model.js   (modified)
Backend/src/routes/recharge.routes.js           (modified)
Backend/test/recharge-provider-verifier.test.js               (new)
Backend/test/platform.recharge.stage25.routes-contract.test.js (new)
Mobile/app/app.js                               (modified)
Mobile/app/test/app.recharge.stage25.test.js    (new)
```
plus this report and the removed superseded checkpoint note. Every Stage
23 file (`referral.service.js`, `referral.model.js`, `feature-platform.js`,
`platform.routes.js`, `platform.guards.js`,
`rooms.stage23.room-in-room.test.js`, etc.) was diffed individually and
confirmed **byte-identical** to the uploaded ZIP. No other stage (1–22,
24, 26–35) was opened for editing.

## 8. Honesty note

Stage 25's real, tested, production-shaped surface (server-owned catalog
discovery, real order creation, real fail-closed provider verification,
real idempotent wallet credit, real Mobile purchase flow) is complete and
covered by 31 new passing tests on top of the 17 pre-existing
`recharge.service.test.js` tests (48 recharge-specific tests total). The
one thing this report does **not** claim is a live, verified purchase
against Google's real servers — that requires real credentials and
network access this sandbox does not have, exactly like every other
external-provider boundary already documented across this entire
project. Declaring that "live" as done would be exactly the kind of
unverified claim this project's discipline exists to prevent.

## Status

**Stage 25 (Recharge / Google Play Billing) — COMPLETE**, to the same
standard, and with the same class of documented, permanent, non-fakeable
external-provider boundary, as every other completed stage in this
project.
