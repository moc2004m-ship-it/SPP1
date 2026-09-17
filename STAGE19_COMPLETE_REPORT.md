# Stage 19 (Room Game Center) — STATUS: COMPLETE

This picks up exactly where the incoming project snapshot described: the
Backend half (catalog, repository, service, guards, routes, and 63 new
Backend tests) was already real, tested, and verified this session by
running it — **not** re-opened or re-implemented — and only the Mobile
half (previously not started at all) was built this session, same
division of labor `STAGE18_COMPLETE_REPORT.md` used for the prior stage.

## Verification of the incoming Backend work (re-run, not re-touched)
- `node --check` passed on every `.js` file under `Backend/src/` and
  `Mobile/app/` (recursive), confirming nothing in either tree was left
  syntactically broken by this session's edits.
- **Backend full suite: 943 tests / 939 pass / 4 fail.** The 4 failures
  are the same pre-existing `Cannot find module 'express'` environmental
  cause documented in every prior stage report in this project
  (`accounts.routes.test.js`, `agora.routes.test.js`,
  `auth.routes.test.js`, `config.routes.test.js` — no network to
  `npm install` in this sandbox); confirmed by direct inspection of the
  failure output, not a new regression. This exactly matches the count
  the incoming snapshot claimed (943/939/4) — nothing under
  `Backend/src/domain/game-catalog.js`,
  `Backend/src/database/repositories/game-match.repository.js`,
  `Backend/src/services/game-match.service.js`,
  `Backend/src/routes/platform.guards.js`, or
  `Backend/src/routes/platform.routes.js` was modified this session; the
  63 Backend game tests it described
  (`Backend/test/game-catalog.test.js`,
  `Backend/test/game-match.repository.test.js`,
  `Backend/test/platform.games.routes-contract.test.js`, plus the
  additions to `Backend/test/game-match.service.test.js` and
  `Backend/test/platform.auth.guards.test.js`) were run as part of this
  full-suite pass and are included in the 939 that pass.

## What was completed this session (Mobile)

### 1. Mobile UI — Room Game Center (`Mobile/app/app.js`)
The old `#games` handler asked **two** free-text `prompt()`s — `roomId`,
then an entirely unvalidated `gameId` string — and POSTed
`/api/games` with whatever the second prompt returned. That is exactly
the gap the task asked to close: the client could send *any* string as a
game id, with no relationship at all to the seven real games the server
actually knows how to host a lobby for.

Added:
- `gameRow(g)` — renders one match as a real card: room, game id, host,
  real player list (`playerIds`, copied verbatim), and a status badge.
  Action buttons are role- and state-aware and only ever show what the
  server would actually allow, mirroring `game-match.service.js`'s own
  authorization exactly:
  - **lobby + I'm not a player** → Join
  - **lobby + I'm a player, not the host** → Leave
  - **lobby + I'm the host** → Start / Cancel
  - always → a Details button (`GET /api/games/:matchId`)
- `gameCatalogRow(game)` — renders one catalog entry (`GET
  /api/games/catalog`) as a real "Start `<game name>`" button showing its
  real `minPlayers`/`maxPlayers` — this **is** the replacement for the
  old free `gameId` prompt(): a match can now only ever be created with a
  `gameId` the server itself listed.
- `renderRoomGameCenter(roomId)` — fetches `GET /api/games?roomId=` (the
  room's own Game Center lobby view, any match in that room regardless of
  who started it) and `GET /api/games/catalog` together, and renders both:
  the room's existing matches via `gameRow()`, and the catalog's "start
  new game" buttons via `gameCatalogRow()`. Called on first open of a
  room's Game Center **and** after every action, so the UI always
  reflects the server's real current state, never a client guess.
- `bindGameActions(roomId)` — wires the join/leave/cancel/start buttons
  to `POST /api/games/:matchId/join|leave|cancel|start`, the catalog
  "start new" buttons to `POST /api/games` with the chosen `roomId` +
  `gameId`, and the Details button to `GET /api/games/:matchId` (with a
  "back to Game Center" control). All errors (e.g. a 409 from starting an
  under-filled lobby, a 403 from a non-member) surface via the existing
  `toast()`, never a fake success.
- `#games`'s handler now only prompts for `roomId`, then calls
  `renderRoomGameCenter(roomId)` — no more free-text `gameId` prompt.

No new dependency, no new screen file — this stays inside the existing
single-page `app.js` shell, consistent with the rest of the app. Nothing
outside the games section of `app.js` was touched; `#gamesList` ("my
games", `GET /api/games` with no query, scoped by `startedBy`) is
unchanged and still works exactly as before.

### 2. Mobile UI tests
New file `Mobile/app/test/app.games.stage19.test.js` (9 tests, all
passing) using the same `node:vm`-load-the-real-`app.js` technique as
`app.battles.stage18.test.js`. Covers: a non-player sees only Join, a
joined non-host player sees only Leave, the host sees Start+Cancel, an
active match shows no lobby actions and renders the real player list, the
real catalog renders as start buttons with real min/max player counts,
clicking a catalog start button POSTs the real create-match endpoint with
the correct `roomId`/`gameId` and refreshes, each of Join/Leave/
Cancel/Start calls its own real endpoint and refreshes the list, the
detail view renders the real server response with a working back button,
and a rejected action (e.g. starting an under-filled lobby) shows the
real error text via toast rather than pretending to succeed.

Also updated the one **pre-existing** test in `app.auth.test.js`
("games action posts to the real create-game endpoint with roomId/
gameId") whose interaction no longer exists: it used to answer two
`prompt()`s (`roomId`, then a free `gameId` string) and assert a direct
`POST /api/games`. Since `#games` now only prompts for `roomId` and
renders the room's Game Center + catalog instead of posting directly,
the test was rewritten (not just tweaked) to assert: only one prompt() is
answered, both `GET /api/games?roomId=` and `GET /api/games/catalog` are
called, the real catalog names render as start buttons, and the caller's
own existing lobby renders with the host's real actions (start/cancel),
never Join. The actual "does clicking a catalog button really POST the
create-match endpoint" assertion moved to the new dedicated test file
above, where the dynamic-button harness needed for it already exists.
This is a pure test-interaction correction driven by the real (and
deliberately changed) client behavior; no Backend behavior changed.

## Verification run this session
- `node --check` passed on every `.js` file under `Backend/src/` and
  `Mobile/app/` (recursive), plus the new Mobile test file — see above.
- **Backend full suite: 943 tests / 939 pass / 4 fail** — unchanged from
  the incoming snapshot, re-run and re-confirmed this session (see
  Verification section above); zero Backend files were modified this
  session.
- **Mobile full suite: 58/58 pass** (was 49/49 before this session; +9
  new Room Game Center tests, and the 1 pre-existing fixture rewrite
  above — no net change in *that* file's test count, only its
  interaction and assertions).
- No live Postgres run, no live HTTP/Express run — same permanent
  environmental blockers as every other stage in this project (the
  Postgres-backed `GameMatchRepository` path and the real Express app
  remain written-but-unexecuted here, unchanged from the incoming
  snapshot).

## Files touched this session
**New:**
- `Mobile/app/test/app.games.stage19.test.js`
- `STAGE19_COMPLETE_REPORT.md` (this file)

**Modified:**
- `Mobile/app/app.js` (Room Game Center: `gameRow()`, `gameCatalogRow()`,
  `renderRoomGameCenter()`, `bindGameActions()`, and the `#games` handler
  rewritten to prompt only for `roomId`)
- `Mobile/app/test/app.auth.test.js` (rewrote the stale two-prompt
  `#games` fixture to match the new one-prompt, catalog-driven
  interaction, described above)

Nothing under `Backend/` was modified this session — every item the task
listed as already done (`game-catalog.js`, the repository, the service,
the guards, the routes, and the 63 Backend tests) was verified by running
it as-is, per the task's explicit instruction not to reopen it.

## Conclusion
**Stage 19: COMPLETE.** The Backend half was already real and is
verified passing (943/939/4, matching the incoming snapshot exactly). The
Mobile half — the Room Game Center UI replacing the free-text `gameId`
prompt with a real catalog-driven interface, plus real
join/leave/start/cancel actions on the room's actual lobby list — is now
built, wired to the real endpoints only, and covered by 9 new passing
tests (Mobile suite: 58/58). The domain's only remaining open items are
the permanent, previously-documented environmental blockers shared by
every stage in this project (no live Postgres, no live Express/HTTP run,
no `npm install` network access) — not anything specific to Stage 19. As
instructed, no work on Stage 20/21/22 or any actual game engine was
started.
