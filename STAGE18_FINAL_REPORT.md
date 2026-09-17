# Stage 18 (PK/Battles) — STATUS: PARTIAL (stopped mid-session at user's request)

This report is honest about being incomplete. The user asked to stop
immediately and receive a zip of progress-so-far; this is that snapshot,
not a claim that Stage 18 is done.

## Starting point
`platform.battles.create()` was a bare `store.add(18, {...})` stub:
pending status only, no authorization, no accept/decline, no scoring, no
real effect on anything, no dedicated persistence. `GET /api/battles`
existed (Phase 4) but only filtered the generic stage-18 store slot.

## What was completed and tested this session
- `Backend/src/database/models/battle.model.js` — id generation, state
  enum, duration validation.
- `Backend/src/database/schema/024_create_battles.sql` — dedicated table
  (real CHECK constraints, one pending/active battle per room via a
  partial unique index). Not run against a live Postgres (no network in
  this sandbox, same pre-existing environmental limit every other stage
  in this project documents).
- `Backend/src/database/repositories/battle.repository.js` —
  `InMemoryBattleRepository` (active) + `PostgresBattleRepository`
  (written, unexecuted), idempotent state transitions.
- `Backend/src/services/battle.service.js` — real authorization (only the
  room owner may challenge; only the challenged opponent may
  accept/decline; only the host may cancel a pending challenge; either
  participant may end an active one), lazy auto-end past the round timer,
  and a real (non-fake) winner: score comes only from actual gift coins
  already debited via `services/gifts.service.js`, never a client-declared
  or random result.
- `Backend/src/database/index.js`, `Backend/src/index.js` — repository and
  service wired into the app's real dependency graph (both in-memory and
  Postgres branches).
- `Backend/src/services/gifts.service.js` — `battleService` added as an
  OPTIONAL constructor dependency (same additive pattern as
  `giftWallService`/`coupleService`/`eventService`): a committed gift
  reports its real coin amount into an active battle if one exists in that
  room, else a real no-op.
- `Backend/src/routes/platform.routes.js` — `POST /api/battles` (now
  authorization-checked via `requireRoomOwner`), `GET /api/battles`,
  `GET /api/battles/:battleId`, `POST /api/battles/:battleId/accept`,
  `/decline`, `/cancel`, `/end`.
- Removed the now-dead `myBattles()` helper (`platform.reads.js` + its
  test) and the old `platform.battles` stub (`feature-platform.js` + its
  test), since battles no longer live on the generic store.
- New tests: `test/battle.repository.test.js` (11 tests),
  `test/battle.service.test.js` (18 tests) — all passing. Existing
  `gifts.service.test.js` was **not yet extended** with a battle-scoring
  integration test (planned, not started).

## Verification run this session
- `node --check` passed on every changed/new `.js` file.
- Backend full suite: **876 tests / 872 pass / 4 fail** — the 4 failures
  are the same pre-existing `Cannot find module 'express'` environmental
  cause documented in every prior stage report in this project (no
  network to `npm install` in this sandbox); confirmed by direct
  inspection, not a new regression. (Baseline before this session's start
  was 848/844/4 for the same reason; the net new-test delta reflects the
  29 new battle tests minus 1 removed obsolete `myBattles` test.)
- Mobile full suite: **40/40 pass**, unchanged — no Mobile file was
  touched this session.

## What is NOT done (explicitly out of scope of this snapshot)
- **Mobile UI**: no accept/decline/cancel/end/detail screen exists yet.
  The existing Mobile buttons (`#battles` create, `#battlesList` list)
  still work against the new backend unchanged, but there is no UI for
  the new endpoints.
- **`gifts.service.test.js`** was not extended with a test proving a real
  gift send scores an active battle end-to-end through the full gifts
  service (the underlying `battle.service.test.js` coverage of
  `recordGiftPoints()` exists and passes, but the gifts-side integration
  test was not written).
- **Route-contract tests** for the new `/api/battles/*` endpoints
  (authorization/session-identity proofs at the route layer, same style
  as `platform.room-settings.stage15.routes-contract.test.js`) were not
  written.
- No live Postgres run, no live HTTP/Express run — same permanent
  environmental blockers as every other stage in this project.

## Files touched
**New:**
- `Backend/src/database/models/battle.model.js`
- `Backend/src/database/schema/024_create_battles.sql`
- `Backend/src/database/repositories/battle.repository.js`
- `Backend/src/services/battle.service.js`
- `Backend/test/battle.repository.test.js`
- `Backend/test/battle.service.test.js`
- `STAGE18_FINAL_REPORT.md` (this file)

**Modified:**
- `Backend/src/database/index.js`
- `Backend/src/index.js`
- `Backend/src/services/gifts.service.js`
- `Backend/src/routes/platform.routes.js`
- `Backend/src/routes/platform.reads.js`
- `Backend/src/feature-platform.js`
- `Backend/test/feature-platform.test.js`
- `Backend/test/platform.reads.test.js`

## Conclusion
**Stage 18: PARTIAL.** The backend domain (persistence, authorization,
state machine, real gift-sourced scoring, routes) is real and tested. The
Mobile UI for accept/decline/cancel/end and the two test additions listed
above are not done. This is stopped here at the user's explicit request,
not because the remaining work was judged out of scope.
