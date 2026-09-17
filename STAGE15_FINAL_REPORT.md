# Stage 15 (Room Settings) — Final Report

**No completion percentage is claimed here.** This file documents only what was actually run and
verified this session, to the same standard applied to every other stage in
`STAGES_05_35_STATUS.md` (`node --check` + full `node --test` + zero regression, documented
honestly, environmental blockers named as environmental, not hidden).

## 0. Starting point (confirmed by inspection, before any change)

Per the confirmed spec, Stage 15 = Room Settings, status PARTIAL / NOT CLOSED. Inspection of the
existing codebase confirmed exactly what was missing:

- `Backend/src/feature-platform.js`'s `rooms.setting(roomId, key, value)` was a bare
  `store.add(15, ...)` — the same "audit-only stub, no real effect" shape Stage 16's
  `kick()/muteMember()/unmuteMember()` had already moved past for moderation. Specifically it had:
  - **No ownership/authorization check** at the service level (only the route wrapped it in
    `requireRoomOwner`, so the method itself was unsafe to call any other way).
  - **No key allowlist** — any string at all was accepted as `key`.
  - **No reuse of the create-time validators** (`room.model.js` / `room-catalog.js`) — a value of
    any shape was stored as-is.
  - **No actual effect on the room record.** The stage-12 room a client actually reads
    (`GET /api/rooms`, `GET /api/home`) was never updated — the stage-15 record was an orphan
    nothing ever read back.
  - **No read side at all.** There was no way to fetch a room's current settings — not from
    `rooms.*`, not from any route.
- `Backend/src/routes/platform.routes.js` had one route, `POST /api/rooms/:roomId/settings`, which
  called `requireRoomOwner` (real, correct, already tested in `platform.auth.guards.test.js`) and
  then the no-op `setting()` above. No `GET` route existed.
- `grep` across `src/` and `test/` confirmed **zero existing tests** referenced `rooms.setting()`
  or the settings route in any form — the gap was completely untested, matching the
  PARTIAL/NOT CLOSED status.
- Baseline full-suite run before any change: **828 tests / 824 pass / 4 fail** (the four
  pre-existing environmental `Cannot find module 'express'` failures in
  `accounts/agora/auth/config routes.test.js` — identical to every prior stage's documented
  baseline; re-run 3x to confirm stability before touching anything).

## 1. What was already present (reused, not reinvented)

- The entire Room domain foundation from Stages 12/13/14/16: `rooms.create()`, the stage-12 room
  record shape, `room.model.js`'s validators (`assertValidVisibility`, `assertValidMicSeats`,
  `normalizeTags`, `assertValidImageUrl`, `assertValidAnnouncement`, `assertValidPassword`,
  `sanitizeRoomForClient`), `room-catalog.js`'s resolvers (`resolveTheme`, `resolveCategory`,
  `resolveLanguage`, `resolveAgeRule`), and `security/room-password.js`'s
  `hashRoomPassword`/`verifyRoomPassword`.
- `routes/platform.guards.js`'s `requireRoomOwner()` — already correct, already tested, reused
  unchanged at the route layer.
- The `FeatureStore.update()` real-effect pattern already established for Stage 14 seat
  approve/mute and Stage 16 kick/mute/unmute.
- The stage-15 record type itself as an audit log — kept, not removed, now alongside a real
  effect instead of being the only thing that happens (same shape as Stage 16's `moderation()`
  audit entry existing alongside the real kick/mute effect).

## 2. What was added/fixed this session

**`Backend/src/feature-platform.js`** (additive to the `rooms` namespace; nothing above `seat()`
in the file was touched):
- `rooms.setting(actorId, roomId, key, value)` — rewritten with a real effect:
  - Requires `actorId`/`roomId`/`key`; 404s for an unknown room; 403s if `actorId` is not the
    room's owner (checked here, not just at the route — the same defense-in-depth already used by
    `_requireOwnerOfSeat()`/`kick()`/`muteMember()`).
  - Validates `key` against an explicit allowlist (`name`, `visibility`, `micSeats`, `theme`,
    `category`, `language`, `ageRule`, `tags`, `cover`, `background`, `announcement`, `password`),
    each routed through the exact same validator/resolver `rooms.create()` already uses — no
    parallel/duplicate validation logic.
  - Applies a real, partial patch to the stage-12 room record via `store.update(12, ...)` — only
    the changed field(s) move; every other field on the room is untouched (tested explicitly).
  - `password` is special-cased exactly as at create time: the plaintext is hashed immediately
    (`hashRoomPassword`), only `passwordHash`/`hasPassword` are ever persisted on the room, and the
    plaintext is never written to the stage-15 audit record either — the audit row for a password
    change stores `{ changed: true }`, never the value.
  - Still writes a stage-15 audit record (`{ roomId, actorId, key, value }`) for every change, now
    correctly attributing the acting owner (`actorId` was previously unrecorded — the field didn't
    exist at all in the old stub).
  - Returns the sanitized, updated room (`sanitizeRoomForClient`), so a caller sees the real new
    state immediately.
- `rooms.getSettings(actorId, roomId)` — new. Owner-only read of a room's current settings
  (the sanitized stage-12 room record). 404 for an unknown room, 403 for a non-owner.

**`Backend/src/routes/platform.routes.js`**:
- `POST /api/rooms/:roomId/settings` — fixed to call the new `setting()` signature
  (`platform.rooms.setting(req.session.accountId, req.params.roomId, req.body.key, req.body.value)`);
  `requireRoomOwner` kept at the route layer (redundant with the new service-level check by
  design, same pattern as every other host-gated route in this file).
- `GET /api/rooms/:roomId/settings` — new. Same `requireRoomOwner` guard, calls
  `rooms.getSettings()`.

**No other file was touched.** No Mobile file was touched — consistent with Stages 13/14/16, which
also have no Mobile UI yet (`grep` confirms the Mobile shell only ever calls
`/api/rooms`, `/api/rooms/:id/join`, `/api/rooms/:id/leave`); adding a settings screen would have
been new functionality outside the confirmed Stage 15 scope, not a gap in Stage 15 itself.

### Deliberately not added (out of scope)
- Room open/close (`room.status`) toggling — this is exercised directly via `store.update` in
  existing Stage 13 tests and is not part of the room-settings field set established at
  `rooms.create()` time; adding a new host action here would be inventing functionality the
  original create-time architecture never defined as a "setting."
- Any Mobile UI, for the reason above.
- Batch (multi-key) settings updates in one call — the existing route body shape
  (`{ key, value }`, singular) was already established; changing it would be a new API contract,
  not completing the existing one.

## 3. Tests added, and results

**`Backend/test/rooms.stage15.settings.test.js`** (new, 16 tests, service-level, real
`createPlatform()` integration, no mocks):
1. `setting()`: only the room owner may change a setting
2. `setting()`: 404s for a room that does not exist, before checking ownership
3. `setting()`: rejects an unknown key
4. `setting()`: name — reuses `requireString()`, real effect on the room record
5. `setting()`: visibility — reuses `assertValidVisibility()`, rejects a made-up value, rejects
   null/omitted
6. `setting()`: micSeats — reuses `assertValidMicSeats()` bounds (1–15)
7. `setting()`: theme/category/language/ageRule — reuse the exact `room-catalog.js` resolvers,
   reject unknown values
8. `setting()`: tags — reuses `normalizeTags()` (trim/dedupe/bounds), omitted clears to `[]`
9. `setting()`: cover/background — reuse `assertValidImageUrl()`, null clears an existing value
10. `setting()`: announcement — reuses `assertValidAnnouncement()`, null clears an existing
    announcement
11. `setting()`: password — sets/verifies a real hash via `join()`, never persists or audits the
    plaintext, empty clears it
12. `setting()`: writes a real stage-15 audit record per change, attributing the acting owner
13. `setting()`: changing one field never touches unrelated fields (partial patch, not a full
    overwrite)
14. `getSettings()`: returns the sanitized room (no `passwordHash`) to the owner, real current
    values
15. `getSettings()`: blocked for a non-owner, 404s for an unknown room
16. `setting()`/`getSettings()` never mutate or leak an unrelated room

Result (run alone): **16/16 pass**.

**`Backend/test/platform.room-settings.stage15.routes-contract.test.js`** (new, 4 tests, same
"reconstruct the handler's own call shape without express" style as
`platform.rooms.routes-contract.test.js`, for the same documented no-network reason):
1. `POST .../settings` contract: `requireRoomOwner` runs first and blocks a non-owner before
   `setting()` is ever called
2. `POST .../settings` contract: acting id comes from `req.session.accountId`,
   `req.body.key`/`value` pass straight through
3. `GET .../settings` contract: owner-only, real current values, `requireRoomOwner` blocks a
   stranger
4. `GET .../settings` contract: 404s for an unknown room via the same `requireRoomOwner` used by
   every other host-only route

Result (run alone): **4/4 pass**.

**Full backend suite**, run 4 times consecutively after these additions:
```
node --test test/*.test.js
→ 848 tests / 844 pass / 4 fail (3 of 4 runs)
→ 848 tests / 844 pass / 5 fail (1 of 4 runs — see flake note below)
```
The 4 stable fails are the exact same four pre-existing environmental
`Cannot find module 'express'` failures (`accounts/agora/auth/config routes.test.js`) present in
the pre-session baseline — zero new failures, zero changed/removed tests, and the difference
828→848 / 824→844 is precisely the 20 new tests added this session (16 + 4).

**Pre-existing flake, not caused by this session:** on 1 of 4 full-suite runs, one unrelated test
(`platform.notifications.routes-contract.test.js`'s "newest first" ordering assertion) failed —
this is the exact timing flake already disclosed in `STAGE6_FINAL_REPORT.md` §2 (millisecond-
resolution timestamp ties under `node:test`'s parallel file execution). Verified before dismissing
it, same as that report did:
- Ran that file alone 5 consecutive times: **8/8 pass every time**, no exceptions.
- Neither `notification.service.js` nor `notification.repository.js` was touched this session.
- Neither of Stage 15's two new test files touches notifications in any way.

**Mobile suite** (unchanged files, run once to confirm zero incidental impact):
```
node --test app/test/*.test.js  → 40/40 pass
```

`node --check` on every touched/added file:
```
node --check Backend/src/feature-platform.js                                          → OK
node --check Backend/src/routes/platform.routes.js                                     → OK
node --check Backend/test/rooms.stage15.settings.test.js                               → OK
node --check Backend/test/platform.room-settings.stage15.routes-contract.test.js       → OK
```

## 4. Remaining environmental blockers (unchanged, not caused by this session)

- **No live Postgres.** `rooms.setting()`/`getSettings()` run against the same in-memory
  `InMemoryFeatureRecordRepository` every other stage uses in this sandbox. The Postgres-backed
  path (`PostgresFeatureRecordRepository`, already generic across every stage-6-35 domain) is
  unchanged by this session and was not exercised against a live database, for the same
  documented no-network reason as every prior stage.
- **No live Express/HTTP server.** `npm install` and direct network access are unavailable in this
  sandbox (previously verified in `PHASE3_CONTINUATION_REPORT.md`); the two new routes were
  verified via the same "reconstruct the handler's real call shape, no express" contract-test
  style as every other route in this router, not via an actual running HTTP server.
- Both are the same, already-documented, permanent sandbox limitations named in
  `STAGES_05_35_STATUS.md` and every stage report since — not new to Stage 15 and not misreported
  here as a Stage 15 failure.

## 5. Files touched this session (and only these)

- `Backend/src/feature-platform.js` — modified (`rooms.setting()` rewritten, `rooms.getSettings()`
  added; nothing else in the file changed).
- `Backend/src/routes/platform.routes.js` — modified (`POST .../settings` call-signature fix,
  `GET .../settings` added; nothing else in the file changed).
- `Backend/test/rooms.stage15.settings.test.js` — new.
- `Backend/test/platform.room-settings.stage15.routes-contract.test.js` — new.
- `STAGES_05_35_STATUS.md` — new section appended (see below), nothing removed.
- `STAGE15_FINAL_REPORT.md` — this file.
- **Not touched:** every Mobile file, every other stage's Backend file, every schema/migration
  file (no new persisted fields were introduced — Stage 15 reuses the stage-12 room record's
  existing columns/JSON shape entirely).

## 6. Conclusion

Stage 15 (Room Settings) is **COMPLETE** to the same verification standard every other stage in
`STAGES_05_35_STATUS.md` is held to: `rooms.setting()` now has a real, owner-gated,
validator-reusing effect on the actual room record (not an orphan audit stub), a symmetric read
side (`getSettings()`) now exists, both routes are wired and contract-tested, 20 new real tests
pass (20/20), the full suite shows zero new failures and zero regressions across repeated runs,
and the two pre-existing environmental limitations (no live Postgres, no live HTTP server) are
named accurately as environmental — not claimed as resolved, not misattributed to this stage.
