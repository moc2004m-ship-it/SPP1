# Phase 3 continuation — six Mobile domain views (Battles/Games/Gifts/Family/Settings/Moderation+Support)

**Date:** 2026-09-13
**Scope of this session:** implement the six previously-missing Mobile domain views listed in
`PHASE3_CONTINUATION_REPORT.md` / `STAGES_05_35_STATUS.md`. No other stage, no Agora/Voice work.

## 0. Starting point (re-verified before touching anything)

- `node --check` on every file in `Backend/src`, `Backend/test`, `Backend/scripts`, and `Mobile/app/**/*.js` — all passed.
- `node --test test/app.auth.test.js` in `Mobile/app` — **6/6 passing**, unchanged.
- `node --test test/*.test.js` in `Backend` — 66 tests, **63 pass / 3 fail**, same pre-existing cause
  (`Cannot find module 'express'` in `accounts.routes.test.js`, `auth.routes.test.js`,
  `config.routes.test.js` — no network in this sandbox to `npm install`). This is the same baseline
  every previous session recorded; it is not something this session could fix (BLOCKED, not a bug).
- The six domain views (Battles/Games/Gifts/Family/Settings/Moderation/Support) did **not** exist
  anywhere in `Mobile/app` before this session. Confirmed by directory listing — this matches what
  `PHASE3_CONTINUATION_REPORT.md` already stated.

## 1. What backend capability actually exists for each domain

Inspected `Backend/src/feature-platform.js` and `Backend/src/routes/platform.routes.js` directly
(source of truth, not assumption). Each of the six domains has a real, working, session-guarded
**write** endpoint, but **no read/list endpoint**:

| Domain | Real endpoint available | Read/list endpoint available |
|---|---|---|
| Battles (stage 18) | `POST /platform/api/battles` (create) | **None** |
| Games (stage 19) | `POST /platform/api/games` (create) | **None** |
| Gifts (stage 26) | `POST /platform/api/gifts/send` | **None** (no gift wall) |
| Family (stage 30) | `POST /platform/api/families` (create) | **None** (no list/join) |
| Settings (stage 34) | `POST /platform/api/settings` | **None** (no read-back) |
| Moderation + Support (stage 35) | `POST /platform/api/moderation/report`, `POST /platform/api/support/tickets` | **None** |

This is the same asymmetry the previous session already documented for other stages: write path
real, read path not built yet. Per your instruction, missing capability is marked BLOCKED rather
than invented.

## 2. What was actually built in `Mobile/app/app.js`

All six views live inside the existing `profile()` screen, as a new "ميزات إضافية" (additional
features) button group — the same pattern the prior session already established for Notifications
(a single action button + inline result rendered into `#profileExtra`), rather than adding new
bottom-nav tabs, since there is nothing to list/browse for any of these six domains yet.

For each domain, the button:
1. Prompts for the real required fields only (matching exactly what the backend's
   `requireId`/`requireString` validation expects — see `feature-platform.js`).
2. Calls the real, already-existing endpoint with the session's real `Authorization: Bearer` token
   (acting-user id is never sent by the client — identity comes from the session server-side, same
   rule as every other route in this app).
3. Renders the **actual server response** (id, status, matchId, etc.) via a new generic
   `resultCard()` helper — nothing hardcoded or fabricated.
4. Displays an explicit, honest note that no history/list view exists for that domain yet, because
   no GET endpoint exists on the backend (BLOCKED) — instead of inventing a fake list.

New helpers added: `genRef()` (a client-minted idempotency reference id required by
`gifts.send`'s `referenceId` field — not fabricated gift data, just a correlation token any real
client would generate) and `kv()`/`resultCard()` (generic real-data-to-HTML rendering, reused by
all six actions).

**No existing code was deleted, rewritten, or restructured.** The diff is additive: two small
helper functions plus new buttons/handlers inside `profile()`.

## 3. Tests

Added 7 new real functional tests to `Mobile/app/test/app.auth.test.js`, using the exact same
`node:vm`-loads-the-real-`app.js` technique as every existing test in that file (no reimplementation
of app logic, no mocked business logic — only `fetch`/`document`/`sessionStorage`/`prompt` are
shimmed):

- `battles action posts to the real create-battle endpoint with roomId/opponentId and shows the server response (no fake history)`
- `games action posts to the real create-game endpoint with roomId/gameId`
- `gifts action posts to the real send-gift endpoint with a client-minted referenceId`
- `family action posts to the real create-family endpoint with just a name (ownerId comes from the session)`
- `settings action posts to the real settings endpoint with a key/value pair`
- `report action posts to the real moderation-report endpoint (reporterId comes from the session)`
- `ticket action posts to the real support-tickets endpoint`

Each test asserts: the exact real endpoint URL is called, the real `Authorization: Bearer` header is
sent, the request body matches exactly what was entered (no extra/invented fields), and the real
server response is what ends up rendered in `#profileExtra`.

### Result

```
Mobile/app : node --test test/app.auth.test.js  → 13/13 PASS  (was 6/6; +7 new, 0 changed, 0 removed)
Backend    : node --test test/*.test.js         → 66 tests, 63 PASS / 3 FAIL — identical 3 failures
                                                    as the pre-existing baseline (missing `express`,
                                                    no network) — confirmed NOT a new regression by
                                                    diffing the failing test names against the
                                                    session's starting point.
```

`node --check` re-run on every `Backend/src`, `Backend/test`, `Backend/scripts`, and
`Mobile/app/**/*.js` file after the change — all pass.

## 4. Status table — DONE / PARTIAL / BLOCKED

| Item | Status |
|---|---|
| Mobile domain view — Battles (create/challenge) | **DONE** — real endpoint, real test |
| Mobile domain view — Games (start game) | **DONE** — real endpoint, real test |
| Mobile domain view — Gifts (send gift) | **DONE** — real endpoint, real test |
| Mobile domain view — Family (create family) | **DONE** — real endpoint, real test |
| Mobile domain view — Settings (write a setting) | **DONE** — real endpoint, real test |
| Mobile domain view — Moderation (report user) | **DONE** — real endpoint, real test |
| Mobile domain view — Support (open ticket) | **DONE** — real endpoint, real test |
| History/list view for any of the six domains above | **BLOCKED** — no GET/list endpoint exists on the backend for any of them yet (would require new backend routes, out of scope for a Mobile-only session) |
| Existing Mobile tests (pre-session, auth/wallet/notifications) | **DONE** — re-verified, unchanged, still 6/6 |
| Regressions from the six new views | **DONE (none found)** — full existing suite re-run, identical pass count before/after on both Mobile and Backend |
| Backend `express`-dependent HTTP tests (accounts/auth/config routes) | **BLOCKED** — same pre-existing no-network-to-npm-install cause as every prior session; unrelated to this session's Mobile work |
| Full end-to-end HTTP run against a live Express server | **BLOCKED** — same no-network reason |
| Real device/browser test | **Not started** — requires your environment |
| Per-domain relational constraints (CHECK/UNIQUE, non-Wallet) | **Not started** — unchanged, pending your prior architectural decision |
| Agora/Voice | **Not started** — explicitly out of scope for this session per your instructions |

## 5. To run it yourself

```bash
cd Backend
npm install
export DATABASE_URL="<supabase connection string>"
export STAGE3_ENABLE_POSTGRES=true
export WALLET_INTERNAL_KEY="<a real random secret>"
npm run migrate
npm test
npm start
# open /app from the same origin — profile screen now has the six new
# domain action buttons under "ميزات إضافية"
```

```bash
cd Mobile/app
node --test test/app.auth.test.js   # 13/13 expected
```

## 6. Next decision needed from you

The six views are now functionally complete for their real write capability. The only way to make
them richer (history/lists, a real gift wall, readable settings, a family directory, a "my
tickets" view) is to **add new backend GET routes** for these stages — that's a Backend change, not
Mobile, and wasn't requested this session. Let me know if you want that next, or if you want to move
on to Agora/Voice now that all six Mobile views are done.
