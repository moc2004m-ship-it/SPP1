# Stage 23 — Part 2: Room-in-Room breakout — COMPLETE

Scope of this part: **Room-in-Room only**, the other half of the legacy
"Stage 23" label (Part 1 — Referral/Invite — was already COMPLETE, see
`STAGE23_PART1_REFERRAL_INVITE_REPORT.md`). No other stage was touched.
Stages 1–22, 24–35 were not reopened or modified.

## 1. Fixed behavior decision this session implements

**Only the parent room's real host/owner may create/start a room-in-room
breakout.** No member, moderator, or anyone else may create one — this is
enforced twice (defense-in-depth, the same pattern already used
throughout this codebase for every other host-gated action):

- **Route layer** — `POST /api/rooms/:roomId/breakout` is gated by the
  existing `requireRoomOwner()` guard (`Backend/src/routes/platform.guards.js`),
  the exact same guard Room Settings/Moderation already use. A non-owner
  never reaches the service method at all.
- **Service layer** — `platform.roomInRoom.create()` independently
  re-checks `room.ownerId === actorId` itself, so the method stays safe
  even if ever called directly (tests, a future internal caller).

## 2. What was found on inspection

Nothing. Room-in-Room did not exist anywhere in the codebase before this
session — confirmed by grepping the entire tree for `room-in-room`,
`roomInRoom`, and `breakout` before writing anything (only the Stage 23
label comment and Part 1's own "not touched" notes referenced it).

## 3. What was implemented this session

### Backend
- **`Backend/src/feature-platform.js`** — new `platform.roomInRoom`
  domain, persisted through the same generic stage-23 record store
  Referral already uses (distinguished by `type`: `'breakout'` /
  `'breakout-membership'`, the same way Referral distinguishes `'code'` /
  `'redemption'` in that same store slot — no new schema/table needed):
  - `create(actorId, parentRoomId, {name, capacity})` — host/owner-only
    (see §1); at most one **open** breakout per parent room at a time
    (a second attempt while one is open is a real 409, not a silent
    duplicate); a closed breakout can be followed by a fresh one.
  - `end(actorId, breakoutId)` — only the host who actually started it;
    closing has a real effect, not just an audit flag: every
    still-`'joined'` breakout-membership under it is closed out too
    (same "kick/mute actually changes state" discipline
    `rooms.kick()`/`muteMember()` already follow).
  - `listForRoom(actorId, parentRoomId)` — member-only (owner or a real
    active Stage 13 membership of the **parent** room).
  - `join(actorId, breakoutId)` / `leave(actorId, breakoutId)` — real
    parent-room membership required to join a breakout (it is a
    sub-space of a room the caller is already in, not independently
    joinable by a stranger); idempotent join (mirrors `rooms.join()`);
    honest capacity enforcement (real 409 once full).
- **`Backend/src/routes/platform.routes.js`** — 5 new routes:
  - `POST /api/rooms/:roomId/breakout` (owner-only, via `requireRoomOwner`)
  - `GET  /api/rooms/:roomId/breakout` (member-only, via `requireRoomMember`)
  - `POST /api/rooms/breakout/:breakoutId/join`
  - `POST /api/rooms/breakout/:breakoutId/leave`
  - `POST /api/rooms/breakout/:breakoutId/end`
  - `requireRoomMember` added to the existing guard import (it already
    existed in `platform.guards.js` for Stage 19's Game Center — reused,
    not duplicated).
  - Every identity (`actorId`/`hostId`) is always `req.session.accountId`,
    never a client-supplied body field — same discipline as every other
    route in this file.

### Mobile
- **`Mobile/app/app.js`** — added to the `profile()` screen:
  - "بدء غرفة فرعية" (Start a breakout) — prompts for the parent
    `roomId` and an optional name, then `POST`s to
    `/api/rooms/:roomId/breakout`. Deliberately has **no client-side
    ownership check** (same rule the existing `#battles` button already
    follows, which is also host-gated server-side with no client-side
    pre-check): the server's real 403 for a non-owner surfaces verbatim
    via toast, never a fake success.
  - "عرض الغرف الفرعية" (View breakouts) — prompts for `roomId`, calls
    `renderRoomBreakout()`.
  - `breakoutRow()` — renders only the buttons the server would actually
    allow: Join/Leave while `status==='open'`, and an End button *only*
    when `hostId === state.userId` (same "only show what the server
    would allow" rule `gameRow()`/`battleRow()` already use), nothing
    at all once `status==='closed'`.

## 4. Files changed / created

**New:**
- `Backend/test/rooms.stage23.room-in-room.test.js`
- `Backend/test/platform.room-in-room.stage23.routes-contract.test.js`
- `Mobile/app/test/app.room-in-room.stage23.test.js`
- `STAGE23_PART2_ROOM_IN_ROOM_REPORT.md` (this file)

**Modified:**
- `Backend/src/feature-platform.js` (added `roomInRoom` domain)
- `Backend/src/routes/platform.routes.js` (added 5 routes + guard import)
- `Mobile/app/app.js` (added breakout UI + 2 new profile buttons/handlers)

**Not touched:** every other file in the project, including Referral
(Stage 23 Part 1, still complete and unchanged), Stages 20/21/22, Stage
25, and all Stage 1–19/24/26–35 code.

## 5. Tests added

- 14 backend service-level tests (`rooms.stage23.room-in-room.test.js`)
- 7 backend route-contract tests (`platform.room-in-room.stage23.routes-contract.test.js`)
- 10 mobile functional tests (`app.room-in-room.stage23.test.js`)

## 6. Verified test results

- `node --check`: **clean** on all new/modified files
  (`Backend/src/feature-platform.js`, `Backend/src/routes/platform.routes.js`,
  `Backend/test/rooms.stage23.room-in-room.test.js`,
  `Backend/test/platform.room-in-room.stage23.routes-contract.test.js`,
  `Mobile/app/app.js`, `Mobile/app/test/app.room-in-room.stage23.test.js`)
- Room-in-Room service-level tests: **14/14 pass**
- Room-in-Room route-contract tests: **7/7 pass**
- Room-in-Room mobile tests: **10/10 pass**
- Full Mobile suite (`node --test Mobile/app/test/*.test.js`): **73/73
  pass** (63 pre-existing + 10 new)
- Full Backend suite (`node --test Backend/test/*.test.js`): **968/972
  pass**, re-run 3 consecutive times with identical results (972/968/4
  every time). The 4 failures are the same pre-existing, already-documented
  environmental fails (`accounts.routes.test.js`, `agora.routes.test.js`,
  `auth.routes.test.js`, `config.routes.test.js` — all require `express`,
  which is not installed and cannot be installed with no network access in
  this sandbox). No new failures were introduced. (Note: an earlier ad hoc
  run during this session also showed the pre-existing, already-documented
  `notifications` ordering timing flake pop up once — unrelated to this
  stage, confirmed by the fact it does not involve any room-in-room file
  and did not reappear in the final 3 consecutive clean runs above.)

## 7. Honesty note

Referral/Invite (Stage 23 Part 1) was already complete before this
session and was not modified. Stages 20/21/22, 25, and every stage
outside 23 were **not implemented, not designed, and not touched** in
this session. Room-in-Room's scope here is the real, tested
create/end/list/join/leave framework described above — there is no voice
transport of its own (a breakout reuses whatever RTC channel the parent
room already has; no separate Agora channel was created or faked for it,
since that would be new, unverified surface outside this session's real,
tested scope).

## Status

**Stage 23 Part 2 — Room-in-Room: COMPLETE**
**Stage 23 (both parts — Referral/Invite + Room-in-Room): COMPLETE**
