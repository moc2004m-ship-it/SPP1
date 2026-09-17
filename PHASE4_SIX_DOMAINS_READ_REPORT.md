# Phase 4 — GET/read endpoints for the six domains (Battles/Games/Gifts/Family/Settings/Moderation+Support)

**Date:** 2026-09-13
**Scope of this session:** build the previously-missing backend GET/list endpoints for the six
domains that Phase 3 left write-only, wire the Mobile screens to them, and verify both test
suites. No other stage touched. No Agora/Voice work.

## 0. Starting point (re-verified before touching anything)

- Confirmed against the actual code (not assumption) that no GET/read endpoint existed for any of
  the six domains, exactly as `PHASE3_SIX_DOMAINS_REPORT.md` documented.
- Confirmed `games.create` did **not** require `startedBy` and `feature-platform.test.js` does not
  call `games.create` at all — a discrepancy with an earlier task description was flagged and
  resolved with the user before this session's work began.
- Backend baseline: `node --test test/*.test.js` → 66 tests, 63 pass / 3 fail (the pre-existing
  `Cannot find module 'express'` failures — confirmed still BLOCKED by re-attempting
  `npm install`, which fails with `403 Forbidden` from the registry; no network egress in this
  sandbox).
- Mobile baseline: `node --test test/*.test.js` → 13/13 pass.

## 1. Backend: new GET endpoints

All six domains now have a real, session-guarded read path. No fake/demo data anywhere — every
endpoint below reads through the same `platform.store` (real repository, Postgres-ready) already
used by every write endpoint.

| Domain | New endpoint | Scope | Notes |
|---|---|---|---|
| Battles | `GET /api/battles` | "My battles" — caller is host **or** opponent | New `myBattles()` helper |
| Games | `GET /api/games` | "My games" — scoped by new `startedBy` field | See schema change below |
| Gifts / Gift Wall | `GET /api/gifts/wall/:roomId` | Room-scoped, public to any authenticated session (same visibility as `GET /api/rooms`) | New `giftsForRoom()` helper |
| Family | `GET /api/families` | Public browse directory (no join/membership concept exists yet — browse only) | Same visibility pattern as `GET /api/rooms`/`GET /api/events` |
| Settings | `GET /api/settings/:userId` | Self-scoped (`assertOwnAccount`) | `settings.set()` is append-only; the endpoint reduces to the **latest value per key** via new `latestSettingsByKey()` |
| Moderation | `GET /api/moderation/reports` | Self-scoped, "my reports" | Reports and tickets share stage 35 with no discriminator field; told apart structurally (see below) |
| Support | `GET /api/support/tickets` | Self-scoped, "my tickets" | |

### Schema change: `games.create` now requires `startedBy`

`games.create` had no field identifying who started the game, so there was no way to build a "my
games" list without exposing every session's games to every other session. `startedBy` is now a
required field (`requireId`, same validation style as every other identity field), populated from
`req.session.accountId` server-side in `platform.routes.js` — **never** from the client body, same
rule as `battles.hostId`. The client-sent request body for `POST /api/games` is unchanged
(`{roomId, gameId, version}`); the server adds `startedBy` itself, exactly like it already adds
`hostId` for battles.

### Reports vs. tickets discriminator

Both `moderation.report()` and `moderation.ticket()` write into stage 35 with no shared "type"
field distinguishing them. Read side tells them apart structurally: a report always has
`targetId`, a ticket always has `messages` — these are the two fields unique to each shape given
how `feature-platform.js` already constructs them. This is implemented as pure functions
(`myReports()` / `myTickets()`), not string-matching or guessing.

### Design: pure, testable query helpers

All six filters live in a new file, `Backend/src/routes/platform.reads.js` — plain
`array -> array` functions with no express/store/network dependency, mirroring the existing
`platform.guards.js` pattern. `platform.routes.js` fetches raw records via
`platform.store.list(stage)` (already async, already Postgres-ready) and passes them through these
functions. This lets the actual filtering logic be unit-tested without npm/network access.

## 2. Mobile: wiring the six screens to real reads

`Mobile/app/app.js` changes, additive only (no existing write handler removed or restructured):

- Two new generic helpers: `genericRow()` (renders one real record as a card, reusing the existing
  `kv()` formatter) and `listCard()` (renders a titled list or an honest "empty" message — the same
  no-fake-data convention as `resultCard()`).
- A second button row was added to the profile screen: **تحدياتي / ألعابي / جدار الهدايا /
  العائلات / إعداداتي / بلاغاتي / تذاكري** — one per domain, each calling its real new GET
  endpoint with the real session Bearer token and rendering exactly what the server returns.
- The stale "لا يوجد GET endpoint... (BLOCKED)" notices on the six write actions were removed,
  since they are no longer true — leaving them in place after this change would have been
  inaccurate, not merely incomplete.
- Gift Wall prompts for a `roomId` (it is room-scoped, not self-scoped) before calling
  `GET /api/gifts/wall/:roomId`.
- Settings list calls `GET /api/settings/:userId` with the caller's own `state.userId`, matching
  the existing wallet/notifications self-scoped-read pattern already in this file.

## 3. Tests

### Backend — new pure-logic tests (`test/platform.reads.test.js`)

Dependency-free (no express), same rationale as `platform.auth.guards.test.js`:

- `myBattles` returns only battles where the account is host or opponent
- `myGames` returns only games started by the given account
- `games.create` requires `startedBy` (throws without it; sets it correctly with it)
- `giftsForRoom` returns only gifts sent in the given room (room-scoped, not user-scoped)
- `latestSettingsByKey` collapses an append-only settings history to one record per key
- `myReports`/`myTickets` are told apart structurally and each is scoped to its own reporter

### Mobile — new functional tests (`test/app.auth.test.js`, +7)

Same `node:vm`-loads-the-real-`app.js` technique as every existing test in this file:

- battles/games/families/reports/tickets list actions call their real GET endpoint and render the
  real server response
- gift-wall action prompts for `roomId` and calls `GET /api/gifts/wall/:roomId` with it
- settings-list action calls `GET /api/settings/:userId` for the caller's own account only

The two existing tests that asserted the now-stale `"BLOCKED"` notice text (battles, settings
write actions) were updated to assert that text's **absence** instead — a corrected assertion, not
a weakened one.

### Results

```
Backend : node --test test/*.test.js  → 72 tests, 69 PASS / 3 FAIL
                                          (+6 new tests, 0 changed pre-existing test,
                                           0 removed; identical 3 pre-existing failures:
                                           accounts.routes.test.js / auth.routes.test.js /
                                           config.routes.test.js — Cannot find module
                                           'express', no network to npm install, confirmed
                                           BLOCKED again by re-attempting `npm install`
                                           → 403 Forbidden from the registry)

Mobile  : node --test test/*.test.js  → 20/20 PASS (was 13/13; +7 new, 2 updated
                                          assertions, 0 removed)
```

`node --check` re-run on every file in `Backend/src`, `Backend/test`, `Backend/scripts`, and
`Mobile/app/**/*.js` after the change — all pass.

## 4. Status table — DONE / PARTIAL / BLOCKED

| Item | Status |
|---|---|
| `GET /api/battles` (my battles) | **DONE** — real endpoint, real test |
| `GET /api/games` (my games, new `startedBy` field) | **DONE** — real endpoint, real test |
| `GET /api/gifts/wall/:roomId` (gift wall) | **DONE** — real endpoint, real test |
| `GET /api/families` (browse directory) | **DONE** — real endpoint, real test |
| `GET /api/settings/:userId` (latest per key) | **DONE** — real endpoint, real test |
| `GET /api/moderation/reports` (my reports) | **DONE** — real endpoint, real test |
| `GET /api/support/tickets` (my tickets) | **DONE** — real endpoint, real test |
| Mobile screens connected to all six new GET endpoints | **DONE** — real fetch, real render, no fake data |
| Regressions from this session's changes | **DONE (none found)** — full existing suites re-run, identical pre-existing failure set, all previously-passing tests still pass |
| Family **join**/membership | **Not started** — no join concept exists yet; `GET /api/families` is browse-only by design (out of scope: this session was read-endpoints-for-existing-writes, not new write capability) |
| Backend `express`-dependent HTTP tests (accounts/auth/config routes) | **BLOCKED** — same pre-existing no-network-to-npm-install cause as every prior session; re-confirmed via a fresh `npm install` attempt (403 Forbidden) |
| Full end-to-end HTTP run against a live Express server | **BLOCKED** — same no-network reason |
| Real device/browser test | **Not started** — requires your environment |
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
```

```bash
cd Mobile/app
node --test test/app.auth.test.js   # 20/20 expected
```

## 6. Next decision needed from you

The six domains now have both real write and real read paths. Reasonable next steps, none started
this session: Family join/membership (would need a new write endpoint, not just a read one),
pagination/filters on the new list endpoints if data volume grows, or moving on to Agora/Voice as
originally planned. Let me know which you'd like next.
