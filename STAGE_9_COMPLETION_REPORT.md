# STAGE_9_COMPLETION_REPORT.md — Search

**Methodology:** real code read first (not prior report titles), genuine gaps fixed only,
full suite run before and after, regressions checked with `diff -rq` against the pre-session
state. No file outside the five listed in §5 was touched.

---

## 1. Audit before modification

`search.query()` (`Backend/src/feature-platform.js`) already existed and was wired to
`GET /api/search`, with one pre-existing test file (`feature-platform.test.js`, 2 tests) and
one incidental test (`final-corrections.test.js`). Mobile already called the real endpoint
with loading/empty/error states. Instead of trusting that surface-level wiring, every code
path behind it was read directly.

## 2. What was already real and working

- **Discoverability (Stage 8 carryover):** an account with `discoverable:false` correctly
  excluded from user search results. Verified by re-running the two pre-existing tests before
  touching anything.
- **Mobile Search UI** (`Mobile/app/app.js`): calls `GET /api/search` for real, shows a real
  "جارِ البحث..." loading state, a real empty state, a real error message from `e.message`,
  debounced input (350ms). No fake results anywhere. **Not modified** — it already met Step 7's
  requirements and works generically off whatever `results` the backend returns, so it
  benefits from every backend fix below with zero Mobile code changes needed.
- **Basic id/name substring matching** for rooms, families, and live game-match records existed
  and worked at a mechanical level.

## 3. Genuine gaps found (real, verified by reading the code — not assumed)

1. **Family Search was structurally dead.** `search.query()` read `store.list(30)` — the
   generic legacy feature-record store for "stage 30." A repo-wide search confirmed **nothing
   in this codebase ever writes to store 30** — real families are created and persisted
   through a dedicated repository (`database/repositories/family.repository.js`,
   `InMemoryFamilyRepository`/`PostgresFamilyRepository`), the exact one
   `services/family.service.js` is built on. Family Search could not have ever returned a real
   family, for any query, in production. This is a "exists but not connected" gap, not a
   missing feature — the search *code* for families existed, it was just pointed at the wrong
   data source.
2. **"Username" was not searchable.** This architecture has no separate username field —
   accounts only have `id`; the only user-facing name is the Stage-7 profile's `name`. Matching
   only checked account `id`, and the response didn't even return `name`, so a name match
   wouldn't have been visible even if it had matched.
3. **Room Search leaked private rooms.** It read `store.list(12)` with **no visibility
   filter at all** — every other room-listing path in this file (`rooms.listDiscoverable()`)
   excludes a `private` room unless the caller is its owner; this one didn't, so a private
   room's id/name/visibility was returned to any searcher. The route also never passed the
   caller's identity to `search.query()` at all, so there was no way to apply an owner
   exception even if the filter existed.
4. **Game Search missed the catalog.** It only matched live match records (store 19 — an
   active game instance in some room). A game with no active match right now (e.g. searching
   "ludo" when no Ludo match is in progress anywhere) was invisible even though the game
   genuinely exists in the real Stage 19 registry (`domain/game-catalog.js`'s `listGames()`).
5. **No route-contract test existed for `/api/search`** — every other domain route had one
   (block, mute, referral, ...); this one didn't, so the actual routing/session-identity
   contract (does the acting id really come only from the session?) was unverified.

Not a gap: **Family privacy/access restrictions.** A repo-wide search confirmed no
privacy/visibility concept exists for families anywhere in this codebase. There is nothing to
enforce beyond the id/name match already there — building one would be inventing a new Family
privacy system, outside Stage 9's scope.

## 4. Fixes made this session

- **Family Search (real fix, not cosmetic):** `createPlatform()` now accepts an optional
  `families` repository dependency (same additive pattern as the existing `accounts`
  dependency — omitted, family results are empty, exactly the old behavior; provided, real
  families are searchable). `search.query()` now calls `families.listFamilies()` instead of
  `store.list(30)`. Wired in `index.js` with the same `db.families` repository
  `familyService`/`rankingService` already use — not a new repository, not a new instance.
- **Username matching:** user matching now also checks the Stage-7 profile's `name` (in
  addition to account `id`); user results now include `name`.
- **Room Search privacy:** applied the exact rule `rooms.listDiscoverable()` already documents
  on itself (`visibility !== 'private' || ownerId === actingAccountId`), plus the shared
  `sanitizeRoomForClient()` sanitizer every other room response already uses (reused, not
  re-derived). `search.query()` gained an optional second parameter, `actingAccountId`; the
  route now passes `req.session.accountId` — never a client-supplied field. Omitting the
  parameter (every pre-existing caller) keeps the old "no owner exception" behavior, so this
  is backward compatible.
- **Game Search catalog:** now additionally matches `listGames()` by id or display name
  (`catalog:true` on those results); live match results are unchanged (`catalog:false`).
- **New route-contract test file** for `/api/search`, following the existing
  fake-req/res pattern already used for block/mute/referral (real logic, no `express`
  dependency, so it runs in this sandbox).

`rooms.listDiscoverable()` itself was **not** called directly from `search.query()` — it's a
plain object property assigned later in the same object literal `search` is also defined in,
not a pre-declared closure `const` the way `social` is, so it isn't reachable from inside
`search.query()`. Replicating its one documented filter rule inline (identical rule, not a new
one) was the minimal fix that doesn't restructure the Rooms domain's declaration order, which
would be a Stage 12 change outside this session's authorized scope.

## 5. Files modified this session

- `Backend/src/feature-platform.js` — `search.query()` rewritten (username match, room privacy
  filter, game catalog match, family repository); `createPlatform()` gained the optional
  `families` parameter; `listGames` imported.
- `Backend/src/routes/platform.routes.js` — `GET /api/search` now passes
  `req.session.accountId`.
- `Backend/src/index.js` — `families: db.families` added to the `createPlatform()` call.
- `Backend/test/feature-platform.test.js` — 10 new tests (see §13).
- `Backend/test/platform.search.routes-contract.test.js` — **new file**, 2 tests.

No other file was modified — confirmed with `diff -rq` against the pre-session state (§15).
Mobile was read, not touched.

## 6. User Search verification

- Matches by account `id` (unchanged) **and** by profile `name` (new) — verified directly:
  a user found only by name now appears with that name in the result.
- Discoverability still enforced (pre-existing tests re-run, unchanged, still pass).
- Empty query → empty result set, no throw (test added).
- No profile record yet → still discoverable by default (pre-existing test, still passes).
- A stranger cannot widen results or bypass discoverability by any query-string trick — there
  is no field in the query that ever selects "search as a different viewer"; discoverability is
  computed from the target's own privacy record only, unconditionally.

## 7. Room Search verification

- Private room excluded from a stranger's results (test added).
- Private room included for its own owner via `actingAccountId` (test added).
- Public room visible to any searcher, including with no `actingAccountId` at all (test
  added, also matches the pre-existing `final-corrections.test.js` expectation).
- `passwordHash` never present in a room search result; `hasPassword` boolean is (test added).
- Route-contract test confirms `actingAccountId` comes only from `req.session.accountId`, and
  that spoofing it via the query string has no effect (new route-contract file).

## 8. Family Search verification

- A family created through the real repository (`InMemoryFamilyRepository.createFamily()`,
  the same one `family.service.js` uses) is now actually findable by name (test added) — this
  is the core fix; before this session, this test would have failed because family search was
  reading an always-empty store.
- Without a `families` dependency supplied, family search returns an empty result set rather
  than throwing (test added) — same safe-default discipline as the existing `accounts`
  dependency.
- No privacy/access restriction test was added because none exists to test (§3).

## 9. Game Search verification

- Catalog match by id (`ludo`) and by display name (`eight ball` → `eight_ball`) — both
  return the real Stage 19 registry entry, with no live match required (test added).
- A live match instance still appears alongside its catalog entry when one exists (test
  added) — catalog addition is additive, not a replacement.

## 10. Filters/Tags verification

No filter/tag mechanism is defined for Stage 9 in the architecture beyond the per-type
substring match itself (`q` only) — `rooms.listDiscoverable()`'s own `category`/`language`/
`tag` filters are a Stage 12 discovery convenience on a different endpoint
(`GET /api/rooms`/`GET /api/home/rooms`), not part of `GET /api/search`'s existing contract, and
Stage 9's own requirements don't specify a separate filter parameter for search. Adding new
filters to `/api/search` beyond what already exists would be new scope, not a gap — none were
added. If room/family/game filtering-by-tag inside search specifically is wanted, that is a new
requirement to scope explicitly, not an implicit Stage 9 gap.

## 11. Mobile verification

Read, not modified. `Mobile/app/app.js`'s search already: calls the real backend, shows a real
loading state, a real empty state, a real error message, and renders whatever `results` come
back generically (badge = type, label = name-or-id) — meaning it automatically now shows a
`name` for user results and `catalog`/live distinctions for game results with zero Mobile code
change. No gap found here worth a code change.

## 12. Server-side privacy verification

- Discoverability, room-visibility, and the owner exception are all enforced inside
  `search.query()` itself (Backend), not hidden by Mobile UI — confirmed by reading the method
  body, not the route.
- `actingAccountId` is sourced only from `req.session.accountId` in `platform.routes.js` —
  confirmed by reading the route and by the new route-contract test that explicitly tries to
  spoof it via the query string and shows it has no effect.
- No way to extract a hidden account's discoverability status, a private room's contents, or
  bypass either by manipulating `q` — the filters run on the server's own data before any
  substring match, not the other way around.

## 13. Tests: PASS / FAIL / BLOCKED

New tests added this session — **12 total, all PASS**:

`feature-platform.test.js` (10):
1. User matched by profile name ("username"), not just id — PASS
2. User still matched by id when name doesn't match — PASS
3. Empty query → empty results, no throw — PASS
4. Private room excluded from stranger, included for owner — PASS
5. Public room visible with no `actingAccountId` — PASS
6. Room result never leaks `passwordHash`, includes `hasPassword` — PASS
7. Game catalog match by id and by display name — PASS
8. Live match result coexists with catalog result — PASS
9. Family search against the real repository — PASS
10. Family search safe-empty without a `families` dependency — PASS

`platform.search.routes-contract.test.js` (2, new file):
11. Acting identity for the room owner-exception comes only from session, spoofing via query
    string has no effect — PASS
12. Missing `q` defaults to empty query, no throw — PASS

**BLOCKED:** none. **FAIL:** none among the 12 new tests.

## 14. Full-suite results

Before this session's edits (Stage 8 end state):
```
node --test test/*.test.js
# tests 1402, pass 1398, fail 4
```
After this session's edits:
```
node --test test/*.test.js
# tests 1414, pass 1410, fail 4
```
The same 4 failures as every prior session in this repo: `accounts.routes.test.js`,
`agora.routes.test.js`, `auth.routes.test.js`, `config.routes.test.js` — all
`Cannot find module 'express'` (no `npm install` available, no network in this sandbox).
**+12 tests, all new, all passing. Zero new failures.**

## 15. Regression results

`diff -rq` against the pre-session state shows exactly the 5 changes listed in §5 (4 modified
files + 1 new file) — nothing else in `Backend/`, and nothing at all in `Mobile/`,
`Authentication/`, `Database/`, `Config/`, `DesignSystem/`, `Localization/`, or any other
domain/service file. Syntax-checked with `node --check` on every touched file.

Specifically re-verified unaffected: Authentication (untouched file), Profile/Privacy (Stage
7/8's own tests still pass unchanged — `profile.getFull()`/`updatePrivacy()`/`shareLink()`
logic wasn't touched this session, only `search.query()` and `createPlatform()`'s parameter
list, which is additive), Home (Stage 6, untouched file), existing Rooms creation/join/discovery
(`rooms.create()`/`rooms.listDiscoverable()` bodies untouched — only a new, separate,
inline replica of one of its filter rules was added inside `search.query()`), Notifications
(untouched file), Database (only the dependency-wiring line in `index.js` changed — the
repository classes themselves untouched).

## 16. Environmental limitations

Same as every prior stage in this repo: the 4 route-test failures need `npm install`
(`express`), unavailable in this sandbox (no network access). No real-device/external-service
testing performed (out of scope, not required for this stage).

## 17. Requirement-by-requirement table

| # | Requirement | Status |
|---|---|---|
| 1 | User Search — Username | ✅ Fixed this session — was not searchable at all, now is |
| 1 | User Search — User ID | ✅ Already worked, re-verified |
| 2 | Room Search — name | ✅ Already worked, re-verified |
| 2 | Room Search — Room ID | ✅ Already worked, re-verified |
| — | Room Search — privacy (public/private) | ✅ Fixed this session — was leaking private rooms |
| 3 | Family Search | ✅ Fixed this session — was structurally disconnected from real data, now reads the real repository |
| 4 | Game Search | ✅ Fixed this session — now matches the real catalog, not just live matches |
| 5 | Filters/Tags | ➖ N/A — no filter/tag mechanism is part of this endpoint's existing contract; none invented (see §10) |
| 6 | Real results, no fake/static data | ✅ True for every type now, including Family (previously not) |
| — | Server-side enforcement (not Mobile-only) | ✅ Confirmed for every privacy rule in play (§12) |

## 18. Final status

**Stage 9 (Search) is DONE for every requirement item that has a concrete, testable meaning in
this architecture**, server-side, tested, with zero regressions. Item #5 (Filters/Tags) has no
defined scope beyond the substring match already in place — nothing was skipped there, there
was simply nothing further to build without inventing new, undefined requirements, which is
explicitly out of scope for this session. This is not "100% DONE" as a blanket claim; it is
reported requirement-by-requirement per §17, with the one N/A item explained rather than
silently counted as done.
