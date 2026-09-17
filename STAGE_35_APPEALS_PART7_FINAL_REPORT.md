# STAGE 35 — PART 7/8 — APPEALS — FINAL (100%) REPORT

Part 7 is now genuinely complete: first half (already-complete, unchanged)
+ second half (staff adjudication, this session). Part 8 (Customer
Support/FAQ/Tickets) remains untouched — confirmed below.

## 1. Audit of the first half (confirmed, not redesigned)

Read `STAGE_35_APPEALS_FIRST_HALF_PROGRESS.md` and the live source before
writing anything. Confirmed already implemented and left byte-for-byte
unchanged:
- `moderation.appeals.create/listMine/getMine` in `Backend/src/feature-platform.js`
- Real eligibility (resolved + `upheld` review, caller = `reportedAccountId`, one appeal per review)
- Session-derived appellant identity, own-appeal-only retrieval
- Routes `POST/GET /api/moderation/appeals`, `GET /api/moderation/appeals/:id`
- `appeals-first-half.stage35.test.js` (16) + `platform.appeals.routes-contract.test.js` (6)

Nothing in this list was touched. The diff for this session only **adds**
new methods/routes/tests after the existing ones.

## 2. Second half implemented

New methods on `moderation.appeals` (`Backend/src/feature-platform.js`):
- `queue(actorId, { status })` — reviewer-only, every submitted appeal (not own-scoped)
- `getForReview(actorId, appealId)` — reviewer-only, any single appeal
- `assign(actorId, appealId)` — self-assign, same shape as Part 6's `review.assign()`
- `decision(actorId, appealId, { outcome, notes, evidence })` — `'upheld'` or `'overturned'`

New routes (`Backend/src/routes/platform.routes.js`), registered so
`/queue` is matched before the pre-existing `/:id` user route:
```
GET  /api/moderation/appeals/queue
GET  /api/moderation/appeals/queue/:id
POST /api/moderation/appeals/:id/assign
POST /api/moderation/appeals/:id/decision
```

## 3. Authorization — reused, not reinvented

`actorId` is always `req.session.accountId`; no route or method accepts a
`reviewerId`/`staffId`/`role` field from the client. Reviewer status is
checked with the exact same primitive Part 6 uses — `isReviewer(reviewers, actorId)`
from `./config/moderation-staff.js`, against the identical `reviewers`
allowlist `Set` already loaded once in `createPlatform`'s closure.

This could not be written as `moderation.review._requireReviewer(actorId)`
verbatim: `review` and `appeals` are sibling properties built inside one
object literal (the same reason `social` is hoisted to a `const` earlier
in the file — see that comment), so cross-sibling `this` isn't available.
Calling the identical `isReviewer()` + `reviewers` primitive Part 6's own
`_requireReviewer()` calls is the honest equivalent of reusing that
method — no second role/staff system, no fake staff login, exactly one
real allowlist mechanism used by both Parts.

## 4. Original moderation decision

An appeal's `decision()` always re-fetches the real, persisted review
record by the `reviewId` fixed at `create()` time (never re-taken from
this call's input).

- **`upheld`** (appeal denied): the review's `decision` field is left
  completely untouched — only an audit history entry is appended. The
  original Part 6 outcome stands exactly as recorded.
- **`overturned`** (appeal granted): per Part 6's own audit finding
  (`review.decision()`'s header comment), a Content Review decision never
  triggers any ban/mute/room action a reviewer is separately authorized to
  invoke — there is no sanction anywhere in this codebase for an overturn
  to reverse. The only real, existing state an overturn can honestly
  change is the review's own `decision` field, so that field is updated
  to `'overturned'` via the same `store.update(35, review.id, ...)` model
  Part 6 already uses — not a new reversal/sanction system.
- A review whose decision has become `'overturned'` is no longer eligible
  for a fresh appeal (`create()`'s existing `decision !== 'upheld'` check
  already covers this — no new rule needed).

## 5. Status / state machine

Appeal `status`: `submitted` → (`assign()`) → `under_review` → (`decision()`) → `resolved` (terminal).

Enforced:
- `decision()`/`assign()` on an already-`resolved` appeal → 409
- `assign()`/`decision()` by a reviewer other than the one already
  assigned → 409 / 403 (conflicting/duplicate decisions, impersonation)
- `decision()` on an unassigned appeal implicitly self-assigns to the
  deciding reviewer (same shape as `review.decision()`)
- Invalid `outcome` value → 400 (fixed enum: `upheld` | `overturned`)
- A normal user, including the appellant, gets 403 on every staff method
- Unknown appeal id → 404 on every staff method

## 6. API

Audited existing appeal routes first (see §1). Added only the four
staff-side routes listed in §2 — the three existing first-half user
routes are unmodified. Every new route: requires the router-wide
`requireSession` auth (unchanged, applies to the whole file), enforces
reviewer authorization server-side inside the domain method, derives
identity from `req.session.accountId` only, calls the real domain layer,
and validates input (`outcome` enum, id format) inside `feature-platform.js`.

## 7. Tests

- `Backend/test/appeals-second-half.stage35.test.js` — 22 tests: auth
  (unauthenticated / normal user / appellant / spoofed reviewerId
  rejected, valid reviewer accepted), queue + filter, `getForReview`,
  assign (self-assign, idempotent, conflicting reviewer, already-resolved),
  decision (implicit self-assign, invalid outcome, already-final,
  wrong-reviewer, unknown id), uphold vs overturn effects on the real
  review record, Part 6 + first-half integration, Parts 1–5 regression.
- `Backend/test/platform.appeals-staff.routes-contract.test.js` — 8
  tests covering all four new route handlers, same "reproduce the
  handler verbatim" style as the existing route-contract suites.
- Full existing suites re-run unchanged and still pass: first-half
  Appeals (16), first-half route contract (6), Content Review (28), its
  route contract (30/... exact count per existing file).

| Suite | Result |
|---|---|
| `appeals-second-half.stage35.test.js` (new) | 22/22 pass |
| `platform.appeals-staff.routes-contract.test.js` (new) | 8/8 pass |
| `appeals-first-half.stage35.test.js` (untouched) | 16/16 pass |
| `platform.appeals.routes-contract.test.js` (untouched) | 6/6 pass |
| Full Backend regression (`node --test test/*.test.js`) | 1319/1323 pass |

The 4 full-suite failures are the same pre-existing, environment-only
failures already documented in the first-half report
(`accounts.routes.test.js`, `agora.routes.test.js`, `auth.routes.test.js`,
`config.routes.test.js` — missing `express`/`pg`/`agora-token` in this
network-isolated sandbox), unrelated to Appeals and unchanged in count by
this session's work.

## 8. Confirmed out of scope, untouched

- Part 8 (Customer Support/FAQ/Support Tickets): `ticket()` in
  `feature-platform.js` is byte-for-byte unchanged; no FAQ or
  support-ticket code exists anywhere in this diff.
- No new admin system, no fake staff login/session type, no second role
  concept — see §3.
- No invented sanction/reversal mechanism for overturned appeals — see §4.

## 9. Conclusion

Part 7 is now 100% complete: real staff adjudication reusing the real
Part 6 reviewer authorization, real reference to the real original
Content Review record for both uphold and overturn, a real enforced state
machine preventing invalid/duplicate/unauthorized transitions, real
persistence on the existing store, and a passing dedicated + route-contract
test suite plus full regression with no new failures.
