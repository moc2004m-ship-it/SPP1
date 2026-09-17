# Stage 18 (PK/Battles) — STATUS: COMPLETE

This picks up exactly where `STAGE18_FINAL_REPORT.md` (the prior partial
snapshot) left off, and finishes every item it listed under "What is NOT
done". Nothing described as complete in that report was re-touched or
re-verified beyond running it as part of the full suite below.

## What was completed this session

### 1. Mobile UI — accept/decline/cancel/end/detail
`Mobile/app/app.js` previously had only "create battle" (`#battles`) and a
raw, read-only "my battles" list (`#battlesList`, rendered via the generic
`genericRow()` dump). Neither had any way to act on a battle.

Added:
- `battleRow(b)` — renders one battle as a real card: room, host/opponent
  ids, a status badge, and the real `hostScore`/`opponentScore` (and
  `winnerId` once ended) copied verbatim from the server record. Action
  buttons are role- and status-aware and only ever show what the server
  would actually allow, exactly mirroring `battle.service.js`'s own
  authorization:
  - **pending + I'm the opponent** → Accept / Decline
  - **pending + I'm the host** → Cancel
  - **active + I'm a participant** → End
  - always → a Details button (`GET /api/battles/:id`)
- `renderBattlesList()` — fetches `GET /api/battles` and re-renders the
  list with the row above; called on first open **and** after every
  action, so the UI always reflects the server's real current state.
- `bindBattleActions()` — wires the four action buttons to
  `POST /api/battles/:id/accept|decline|cancel|end` and the Details button
  to `GET /api/battles/:id` (with a "back to list" control). All errors
  (e.g. a 403 from a stale/illegal action) surface via the existing
  `toast()`, never a fake success.
- `#battlesList`'s handler now points at `renderBattlesList()` instead of
  the old generic dump.

No new dependency, no new screen file — this stays inside the existing
single-page `app.js` shell, consistent with the rest of the app.

### 2. Mobile UI tests
New file `Mobile/app/test/app.battles.stage18.test.js` (9 tests, all
passing) using the same `node:vm`-load-the-real-`app.js` technique as
`app.home.stage6.test.js`. Covers: opponent sees accept/decline only, host
sees cancel only, active-battle participant sees end + real score
rendering, ended battle shows the real winner and no stale action buttons,
each action button calls its real endpoint, the detail view renders the
real server response, and a rejected action (403) shows the real error
text via toast rather than pretending to succeed.

Also fixed one **pre-existing** test in `app.auth.test.js`
("battles list action calls the real GET /api/battles endpoint...") whose
fixture asserted on an invented `matchId` field left over from before
Stage 18 was a real domain — a real battle record never has that field.
Updated the fixture to the real shape (`hostScore`/`opponentScore`/
`winnerId`) and its assertions to match the new role-aware rendering. This
is a pure test-fixture correction; no application behavior changed.

### 3. Backend — `gifts.service.js` × `battle.service.js` integration test
New file `Backend/test/gifts-battle-integration.test.js` (11 tests, all
passing), same pattern as the existing
`test/gifts-giftwall-integration.test.js`. Proves the full real call
chain — `sendGift()` → real wallet debit → real gift record →
`battleService.recordGiftPoints()` — end-to-end, not through a fake
`battleService` stub:
- a real gift to the host / to the opponent moves only that side's score,
  by the exact real coins spent (never `quantity`)
- a gift to a bystander who is neither side never scores
- a gift in a room with no battle at all is a normal, unaffected send
- a gift during a still-**pending** (unaccepted) challenge never scores
- an insufficient-balance send (rejected before any gift record exists)
  never touches the score
- repeated real gifts from both sides accumulate correctly and the winner
  computed on `endBattle()` is fully traceable to those real gifts
- a gift sent after the battle already ended never re-opens scoring
- two different rooms' battles never mix scores
- exactly one wallet debit per send (the battle integration adds no
  second debit)
- with `battleService` omitted entirely, `sendGift()` is byte-for-byte
  unchanged (default-safe)

### 4. Backend — route-contract tests for `/api/battles/*`
New file `Backend/test/platform.battles.routes-contract.test.js` (9
tests, all passing), same "pure logic, fake req/res, re-create the
handler's own call shape verbatim" style as
`platform.room-settings.stage15.routes-contract.test.js` (`platform.routes.js`
itself still cannot be `require()`'d here — see Verification section).
Proves, against the real `battleService`/`requireRoomOwner`:
- `POST /api/battles` runs `requireRoomOwner()` **before**
  `createChallenge()` — a non-owner is blocked and no battle is ever
  created
- `hostId` always comes from `req.session.accountId`, never a
  client-supplied `req.body.hostId` (tested by deliberately trying to
  smuggle a different one)
- `GET /api/battles` (`listMine`) is scoped to the session's own account
- `GET /api/battles/:battleId` passes `req.params.battleId` straight
  through, and rejects a non-participant
- `accept`/`decline` are opponent-only, `cancel` is host-only, `end` is
  either-participant-only — each verified against the real session id,
  never the host/opponent id from anywhere else
- `requireRoomOwner` 404s for an unknown room on create, same guard every
  other host-only route already uses

## Verification run this session
- `node --check` passed on every `.js` file under `Backend/src/` and
  `Mobile/app/` (recursive), plus both new Backend test files.
- **Backend full suite: 896 tests / 892 pass / 4 fail.** The 4 failures
  are the same pre-existing `Cannot find module 'express'` environmental
  cause documented in every prior stage report in this project
  (`accounts.routes.test.js`, `agora.routes.test.js`, `auth.routes.test.js`,
  `config.routes.test.js` — no network to `npm install` in this sandbox);
  confirmed by direct inspection, not a new regression. Baseline at the
  start of this session was 876/872/4 for the same reason; the +20 delta
  is exactly the 11 new gifts↔battle integration tests + 9 new
  route-contract tests added this session.
- **Mobile full suite: 49/49 pass** (was 40/40 before this session; +9
  new battle-UI tests, and the 1 pre-existing fixture fix above — no
  count of *tests* changed there, only its assertions).
- No live Postgres run, no live HTTP/Express run — same permanent
  environmental blockers as every other stage in this project
  (`Backend/src/database/schema/024_create_battles.sql` and
  `PostgresBattleRepository` remain written-but-unexecuted, unchanged from
  the prior snapshot).

## Files touched this session
**New:**
- `Backend/test/gifts-battle-integration.test.js`
- `Backend/test/platform.battles.routes-contract.test.js`
- `Mobile/app/test/app.battles.stage18.test.js`
- `STAGE18_COMPLETE_REPORT.md` (this file)

**Modified:**
- `Mobile/app/app.js` (battle list actions: accept/decline/cancel/end/detail)
- `Mobile/app/test/app.auth.test.js` (fixed the stale `matchId` fixture in
  the pre-existing battles-list test, described above)

Nothing under `Backend/src/services/battle.service.js`,
`Backend/src/database/repositories/battle.repository.js`,
`Backend/src/database/models/battle.model.js`,
`Backend/src/routes/platform.routes.js`, or the schema file was modified
this session — all of it was already real and tested per the prior
snapshot, and this session's new tests exercise it as-is rather than
changing it.

## Conclusion
**Stage 18: COMPLETE.** Every item the prior partial report listed as not
done — the Mobile UI for accept/decline/cancel/end/detail, the
gifts→battle integration test, and the `/api/battles/*` route-contract
tests — now exists and passes. The domain's only remaining open items are
the two permanent, previously-documented environmental blockers shared by
every stage in this project (no live Postgres, no live Express/HTTP run,
no `npm install` network access) — not anything specific to Stage 18.
