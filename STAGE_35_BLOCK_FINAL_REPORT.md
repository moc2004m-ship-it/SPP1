# Stage 35 — Moderation + Support — Part 2/8 (BLOCK) — FINAL REPORT

**Status: STAGE 35 PART 2/8 (BLOCK) — COMPLETE / 100%**, scoped strictly to
Block. Part 1/8 (Report) remains intact and unmodified in substance; Parts
3/8–8/8 were not started — see §16.

---

## 1. Scope

This session covers only Stage 35 Part 2/8: **Block**. Report (Part 1/8,
already complete) was not rebuilt. Mute, Word Filter, Room Moderation,
Content Review, Appeals, and Customer Support/Tickets (Parts 3–8) were
explicitly out of scope and are untouched.

## 2. Existing implementation (found on audit, before this session)

Block was real, not a stub, and had real downstream integrations already
wired by other stages:

- `platform.social.block(userId, targetId)` (Stage 8, inside the shared
  `social` object in `feature-platform.js`) already format-validated both
  ids and persisted a real record (`{userId, targetId, type:'block',
  status:'active'}`) through the real repository layer (stage 8 storage,
  same `FeatureStore`/`InMemoryFeatureRecordRepository` as everywhere
  else).
- `platform.social.allowed(userId, targetId, action)` already checked
  for a block in **both** directions before permitting `follow()`,
  `friend()`, and `profile.getFull()` (view-profile) — all three already
  reject with 403 when a block exists, and this is already covered by
  existing tests (`feature-platform.test.js`: "blocked accounts cannot
  follow each other", "...cannot send a friend request", "a blocked
  viewer is rejected with 403").
- `chat.service.js` independently already checks the same
  `platform.social.allowed()` on conversation creation *and* re-checks it
  on every message send (a block applied mid-conversation still takes
  effect immediately) — confirmed by its own existing tests.
- `POST /api/block` already existed in `platform.routes.js`, already
  behind the router-wide `requireSession` middleware, and already
  resolved the blocking user only from `req.session.accountId` (never
  `req.body`).
- `Backend/src/domain/legal-content.js`'s real Help content already
  documents Block as user-facing product behavior ("Block a user from
  their profile...").

This matches `STAGE_34_FINAL_REPORT.md`'s own table, which already listed
Block/Security as "Stage 10 `platform.social.block()` / Existing route,
untouched / Real block record / Pre-existing, covered."

## 3. Missing implementation (the actual gaps)

Four real gaps, found by comparing Block against its own data model, its
sibling relationship actions in the same object (`follow`/`unfollow`),
and the Mobile app:

1. **No unblock, anywhere.** `platform.social.unblock()` did not exist.
   No `/api/unblock` route. No Mobile control. Once blocked, a target
   was blocked forever — confirmed by a repo-wide search
   (`grep -rn "unblock"` returned nothing at all before this session).
   The stored record already carried a `status` field (`'active'`),
   exactly the same shape `follow()`/`unfollow()` already use for a
   reversible relationship (`unfollow()` flips `'active'` → `'removed'`
   rather than deleting) — `unblock()` was clearly the intended but
   unbuilt counterpart, not a deliberately-absent feature.
2. **`block()` was not idempotent.** Calling it twice for the same pair
   created two separate `'active'` records. This directly violates this
   stage's own test requirement ("duplicate block behavior is
   deterministic") and, more importantly, would have made unblock
   ineffective once added: unblocking would resolve only the first
   matching record via `store.find()`, leaving the duplicate(s) still
   `'active'`, so the user would remain blocked.
3. **`allowed()` did not filter by `status`.** It matched any record with
   `type:'block'` for the pair regardless of status. This meant that
   once `unblock()` existed and flipped a record to `'removed'`,
   `allowed()` would still see that old record and continue treating the
   pair as blocked forever — unblock would have been a complete no-op in
   its actual effect. This is a correctness bug that only becomes
   observable once unblock exists, so it was not previously caught by
   any test; fixed as a required, minimal, in-scope part of adding
   unblock.
4. **No Mobile Block UI at all.** Confirmed by inspection
   (`grep -n "block" -i Mobile/app/app.js` returned nothing before this
   session) — despite `POST /api/block` already existing server-side and
   Block being documented as real product behavior in the Help content.
   Report/Ticket had real buttons; Block had none.

Persistence, authentication, and the block-check integrations into
follow/friend/profile/chat did **not** need to be built or replaced —
they were already real and are unmodified.

## 4. Final architecture

```
Mobile #block button
  → POST /api/block { targetId }
  → requireSession(authStore)            [existing, untouched]
  → platform.social.block(req.session.accountId, targetId)
      1. requireId(userId)                [existing]
      2. requireId(targetId)              [existing]
      3. NEW: if an active block already exists for this pair, return
         it unchanged (idempotent) instead of creating a duplicate
      4. else store.add(8, { userId, targetId, type:'block', status:'active' })
  → { ok:true, data: <persisted block record> }

Mobile #unblock button
  → POST /api/unblock { targetId }        [NEW route]
  → requireSession(authStore)            [existing, untouched]
  → platform.social.unblock(req.session.accountId, targetId)   [NEW]
      1. requireId(userId); requireId(targetId)
      2. find the caller's own ACTIVE block record for this target
      3. 404 if none exists
      4. else store.update(8, record.id, { status:'removed' })
  → { ok:true, data: <updated record, status:'removed'> }

platform.social.allowed(userId, targetId, action)   [FIXED: now status:'active'-filtered]
  → used unchanged by follow()/friend()/profile.getFull()/chat.service.js
```

## 5. Files changed this session

- **`Backend/src/feature-platform.js`** (edited, additive + one
  correctness fix): `social.block()` is now `async`/idempotent (returns
  the existing active record instead of duplicating); new
  `social.unblock()`, mirroring `unfollow()`'s status-flip-not-delete
  pattern; `social.allowed()`'s two `store.find()` lookups now also
  filter `status==='active'` (previously matched a removed/historical
  block forever — required for `unblock()` to have any real effect).
- **`Backend/src/routes/platform.routes.js`** (edited, additive only):
  new `POST /api/unblock` route, directly symmetric with the existing
  `POST /api/block` (same pattern already used for
  `/api/follow`/`/api/unfollow`).
- **`Backend/test/feature-platform.test.js`** (edited, additive only):
  +10 tests — persisted shape, missing-field rejection, idempotent
  duplicate block, directionality, unblock restoring `allowed()`,
  unblock 404 with nothing active, re-block after unblock, unblock
  isolation between two different blockers of the same target, self-block
  (documented as unrestricted, matching `follow()`/`friend()`'s existing
  convention), and a test documenting that `block()` gates *new*
  follow/friend/view-profile actions rather than retroactively changing
  historical counts.
- **`Backend/test/platform.block.routes-contract.test.js`** (new): +7
  tests reproducing both route handlers verbatim (same "fake req/res, no
  express" technique as `platform.moderation.routes-contract.test.js` /
  `platform.referral.routes-contract.test.js`) — identity-spoofing
  resistance for both block and unblock, missing-field rejection,
  idempotency at the route layer, and proof that one session's unblock
  attempt can never remove a different account's block.
- **`Mobile/app/app.js`** (edited, additive only): new `#block`/
  `#unblock` buttons in the existing profile action row (same row as
  `#report`/`#ticket`), each a real `POST /api/block` / `POST
  /api/unblock` call with no client-supplied identity, following the
  exact `#report` handler pattern (prompt → real API call → real result
  rendered, no fake local-only "blocked" state). No unrelated Mobile
  screen was touched; no new CSS was needed (`.btn.danger` already
  existed from Stage 34).
- **`Mobile/app/test/app.auth.test.js`** (edited, additive only): added
  `block`/`unblock` to the shared button-harness id list, +3 tests
  (block posts to the real endpoint, unblock posts to the real endpoint,
  dismissing the prompt never calls the server).

No file outside this list was modified. Report (Part 1/8) files
(`feature-platform.js`'s `moderation` object, `platform.moderation.
routes-contract.test.js`, the Report section of `feature-platform.test.
js`) were inspected for regression only, never edited this session.

## 6. Database changes

None required. Existing stage-8 storage in the same repository layer
(`FeatureStore` / `InMemoryFeatureRecordRepository`, Postgres-ready) was
already sufficient for both block and unblock (unblock uses the
pre-existing `store.update()` primitive, same one `unfollow()` already
uses).

## 7. API contract (new route added; existing route's behavior refined)

| Method | Path | Auth | Request body | Behavior |
|---|---|---|---|---|
| `POST` | `/api/block` | Bearer session (required) | `{ targetId: string }` | Creates (or, if one is already active, returns) a block from the caller to `targetId`. Idempotent — calling it twice never creates a duplicate. Returns `{ ok:true, data: <record> }` (400 on missing/invalid `targetId`, 401 unauthenticated). |
| `POST` | `/api/unblock` **(new)** | Bearer session (required) | `{ targetId: string }` | Removes the caller's own active block on `targetId` (flips `status` to `'removed'`, never deletes, never affects another account's block). 404 if the caller has no active block on that target. 401 unauthenticated. |

`allowed()`'s directional check (used internally by follow/friend/
profile/chat, no separate route) is unchanged in shape, only now
correctly scoped to *active* blocks.

## 8. Security / authentication

- The blocking/unblocking user is derived exclusively from
  `req.session.accountId` for both routes — never from `req.body`.
  Confirmed by contract test: a client-claimed `body.userId`/
  `body.accountId` is ignored in both directions.
- Unauthenticated requests are already rejected 401 by the router-wide
  `requireSession` middleware (pre-existing, exercised generically;
  not re-tested per-route, matching this repo's existing convention).
- **New this session:** a session can never unblock (or otherwise
  affect) a different account's block record — confirmed by a dedicated
  contract test simulating a hostile caller claiming the same
  `targetId` as the real blocker.
- Malformed/missing `targetId` rejected (400) for both routes.
- Self-block is left unrestricted — matches this codebase's existing,
  established convention for `follow()`/`friend()` (neither has ever
  rejected `userId === targetId`), and `profile.getFull()` already
  skips the block check entirely when the viewer is the owner, so a
  self-block can never lock an account out of its own profile. This was
  a deliberate "preserve existing behavior, don't invent a new rule"
  decision per the scope instructions, not an oversight — documented and
  tested explicitly rather than left silently unverified.

## 9. Block effect (integration with existing systems)

No new integration points were built — the existing ones (`follow()`,
`friend()`, `profile.getFull()`, `chat.service.js`'s conversation
creation and every-send re-check) already call `social.allowed()` and
continue to work unchanged, now correctly respecting unblock too (see
§3.3/§5). No Mute or Room Moderation behavior was implemented or
scaffolded ahead of schedule.

## 10. Mobile integration

New `#block`/`#unblock` buttons added to the existing profile action
row, calling the real `POST /api/block` / `POST /api/unblock` endpoints
with a real server round-trip and displaying the real persisted/updated
record — never a fake local-only "blocked" toggle. No unrelated Mobile
screen was redesigned.

## 11. Tests

- `Backend/test/feature-platform.test.js` — 10 new Block/Unblock tests
  (plus the pre-existing follow/friend/profile block-integration tests,
  unmodified and still passing).
- `Backend/test/platform.block.routes-contract.test.js` — 7 new tests.
- `Mobile/app/test/app.auth.test.js` — 3 new tests (block button,
  unblock button, cancelled-prompt never calls the server).
- All modified/added files pass `node --check`.

## 12. Test results

- **Backend**: `node --test test/*.test.js` → **1142/1146 passing**
  (was 1125/1129 before this session; +17 new tests, all passing, 0
  regressions).
- **Mobile**: `node --test test/*.test.js` → **89/89 passing** (was
  86/86; +3 new tests, all passing, 0 regressions).

## 13. Manual verification

Exercised the real, complete in-process path via the tests themselves
(they call the actual production functions directly, and reproduce the
real route handlers' call shape verbatim against the same `platform`
instance):

| # | Path exercised | Expected | Actual | Result |
|---|---|---|---|---|
| 1 | Valid session → route handler → `social.block()` → real repository | Record persisted, real id/timestamps, `status:'active'` | Confirmed (`s8_...` id) | PASS |
| 2 | Block called twice for the same pair | Same record returned, exactly 1 row in storage | Confirmed | PASS |
| 3 | Spoofed `body.userId`/`body.accountId` on block or unblock | Ignored; real session id used | Confirmed | PASS |
| 4 | `follow()`/`friend()`/`profile.getFull()` against a blocked pair | 403 rejected (pre-existing behavior) | Confirmed, unchanged | PASS |
| 5 | `unblock()` after a block | `status:'removed'`, `allowed()` flips back to `true` | Confirmed | PASS |
| 6 | `unblock()` with nothing active | 404 | Confirmed | PASS |
| 7 | Re-block after unblock | New active record, blocks again | Confirmed | PASS |
| 8 | Account A unblocks; Account B's separate block on the same target | B's block untouched | Confirmed | PASS |
| 9 | Attacker session calling `/api/unblock` with the victim's `targetId` | 404 (attacker has no active block of their own to remove); victim's block still active | Confirmed | PASS |
| 10 | Self-block, then owner viewing their own profile | Never 403's the owner (isOwner short-circuit, pre-existing) | Confirmed | PASS |
| 11 | Mobile `#block`/`#unblock` buttons | Real `POST` with `{targetId}` only, real rendered result | Confirmed | PASS |

All 11 checks: **PASS**.

## 14. Failure classification

| Failure | Classification | Detail |
|---|---|---|
| `test/accounts.routes.test.js`, `test/agora.routes.test.js`, `test/auth.routes.test.js`, `test/config.routes.test.js` — `Cannot find module 'express'` | **Environmental blocker** | No npm/network access in this sandbox (unchanged from every prior stage, including `STAGE_35_REPORT_FINAL_REPORT.md`). Not caused by, and not related to, Block. |

No Block-implementation defects and no pre-existing unrelated failures
were observed in this session's full-suite runs.

## 15. Anything blocked by environment

Only the same 4 environmental `express`-missing failures as every prior
stage. Real HTTP-level end-to-end testing was not possible for the same
reason it never has been in this project; the maximum real in-process
path (route handler's own call shape → service layer → real repository)
was exercised instead, per the session instructions.

## 16. Regression protection — Report (Part 1/8)

Report was explicitly re-verified, not just assumed intact:
`Backend/test/feature-platform.test.js`'s Report tests and
`Backend/test/platform.moderation.routes-contract.test.js` (13 tests
total from the previous session) all still pass unchanged in this
session's full-suite run. `platform.moderation.report()`/`ticket()` in
`feature-platform.js` were not touched by this session's diff (only the
`social` object, a separate property of the same returned platform
object, was edited).

## 17. Confirmation that Parts 3–8 were NOT implemented

Confirmed by inspection of every file touched this session (§5 —
six files total: two Backend source files, two Backend test files, one
Mobile source file, one Mobile test file — none belonging to Mute, Word
Filter, Room Moderation, Content Review, Appeals, or Customer
Support/Tickets). No Part 3–8 route, model, service, or Mobile screen
was created, edited, or scaffolded. `platform.moderation.ticket()`
(Part 8/8) remains byte-for-byte unchanged from the previous session.

## 18. Final Report completion status

**STAGE 35 PART 2/8 (BLOCK) — COMPLETE / 100%**, using this project's
established definition: complete implementation/architecture/
integration/testing/verification inside the project, with real-world
production testing against real external accounts/devices/services left
for later (same caveat every prior stage's final report has carried).

Part 1/8 (Report) remains complete and unmodified in substance. Parts
3/8 through 8/8 remain fully unstarted and untouched, ready for their
own dedicated sessions per the scope-protection instructions.
