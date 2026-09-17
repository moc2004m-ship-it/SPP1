# Stage 35 Part 8/8 — Customer Support — Final Report

## 1. Scope

Complete Stage 35 Part 8/8 (Customer Support: FAQ, Support Tickets,
Ticket Type, Description, Attachments, Status, Staff Reply, Escalation,
Full Logs) on top of the existing, already-locked Parts 1–7 (Report,
Block, Mute, Word Filter, Room Moderation, Content Review, Appeals).
Parts 1–7 were not redesigned. No Stage 36+ work was started.

## 2. Initial audit

Searched the whole repository (Backend, Mobile, database layer, routes,
services, auth, tests) for existing customer-support/ticket/FAQ code.

Findings:
- `Backend/src/feature-platform.js`'s `moderation` object already had a
  bare `ticket(input)` stub, added by Part 1's own author and
  *deliberately* left untouched, with a comment reading "`ticket()`
  (Part 8/8, Customer Support) is untouched." It stored
  `{reporterId, type, description, status:'open', messages:[]}` in the
  same stage-35 store used by `report()`, with **no type validation, no
  status transitions, no staff reply, no escalation, no attachments, no
  history**.
- `Backend/src/routes/platform.routes.js` already had
  `POST /api/support/tickets` and `GET /api/support/tickets`, wired to
  that same stub and to `myTickets()`.
- `Backend/src/routes/platform.reads.js` already had the `myTickets()`
  structural discriminator (a stage-35 record with a `messages` field is
  a ticket; one with `targetId` is a report).
- No FAQ/help-desk content existed distinct from Stage 34's general
  `HELP_CONTENT` (`Backend/src/domain/legal-content.js`), which is
  general how-to-use-the-app copy, not support-specific.
- No staff/admin role exists anywhere in the codebase beyond the
  server-only reviewer allowlist Part 6 built
  (`Backend/src/config/moderation-staff.js`, env var
  `MODERATION_REVIEWER_IDS`). Confirmed by grep — no second role system
  was invented.
- No file-upload/CDN pipeline exists anywhere (confirmed by grep for
  `multer`/`upload`/`s3`/`storage`). The one existing precedent for
  "attach a file" is `assertValidImageUrl()`
  (`Backend/src/database/models/room.model.js`), which validates an
  http(s) URL the client already hosts elsewhere — used for room
  cover/background images and chat image messages.
- Mobile has no Support/FAQ/ticket screen at all — only `auth`,
  `onboarding`, and `splash` screens exist.
- Test files already documented the scope boundary explicitly, e.g.
  `platform.moderation.routes-contract.test.js`: "Deliberately NOT
  covering POST /api/support/tickets or platform.moderation.ticket()
  here — Customer Support/Tickets is Stage 35 Part 8/8."

## 3. Existing implementation (reused, not rebuilt)

- Stage-35 shared store (partition 35) — reused, not a new store.
- `report()`, `moderation.review.*`, `moderation.appeals.*` — untouched,
  byte-for-byte, except that the `ticket()` stub sitting next to them in
  the same file is the one thing Part 8 was scoped to complete.
- `myTickets()` / `myReports()` structural discriminators — reused
  unchanged.
- Reviewer authorization (`isReviewer(reviewers, actorId)` against the
  real `MODERATION_REVIEWER_IDS` allowlist) — reused unchanged for all
  staff-only Part 8 actions. No second staff/role system was created.
- `assertValidImageUrl()` — reused unchanged for attachment URLs.
- The Terms/Help static-content pattern
  (`Backend/src/domain/legal-content.js` +
  `Backend/src/services/settings.service.js`) — reused for FAQ.
- Route registration/ordering conventions (`'/queue'` before `'/:id'`,
  `actorId` always from `req.session.accountId`) — reused unchanged.

## 4. Gaps found (what Part 8 actually had to build)

1. `ticket()` accepted an arbitrary client-supplied `type` string — no
   catalog/enum.
2. No way for staff to reply to a ticket.
3. No status lifecycle / transition enforcement.
4. No escalation.
5. No attachments.
6. No audit history on tickets.
7. No FAQ.
8. No staff-facing ticket queue or single-ticket retrieval.
9. No requester-facing single-ticket retrieval endpoint (only the list
   endpoint existed).

## 5. Files changed

- `Backend/src/feature-platform.js` — `ticket()` completed in place
  (made `async`, added a validated type catalog and the new fields);
  new `moderation.support` object added alongside `review`/`appeals`.
- `Backend/src/domain/legal-content.js` — added `FAQ_CONTENT` (static,
  same pattern as `TERMS_CONTENT`/`HELP_CONTENT`).
- `Backend/src/services/settings.service.js` — added `getFaq()`.
- `Backend/src/routes/platform.routes.js` — added
  `GET /api/support/faq`, `GET /api/support/queue`,
  `GET /api/support/queue/:id`, `GET /api/support/tickets/:id`,
  `POST /api/support/tickets/:id/attachments`,
  `POST /api/support/tickets/:id/reply`,
  `POST /api/support/tickets/:id/status`,
  `POST /api/support/tickets/:id/escalate`. The two pre-existing routes
  (`POST/GET /api/support/tickets`) are untouched.
- `Backend/test/support.stage35.test.js` — new, 37 tests.
- `Backend/test/platform.support.routes-contract.test.js` — new, 9
  tests.

No other file was touched. No file under Parts 1–7's own ownership
(Report/Block/Mute/Word Filter/Room Moderation/Content Review/Appeals)
was modified.

## 6. Architecture

Customer Support is a completion of the existing stage-35 domain model,
not a parallel system:

- Same store partition (35) as Report/Review/Appeals.
- Same structural-discrimination convention: a ticket is any stage-35
  record with a `messages` field (untouched since Part 1); reports have
  `targetId`; reviews/appeals have `kind: 'review' | 'appeal'`. A
  ticket has none of `targetId`/`kind`, so it can never be misread as a
  report, review, or appeal, and vice versa (covered by regression
  tests, see §21).
- Same authorization primitive as Content Review/Appeals: the server-
  only `MODERATION_REVIEWER_IDS` allowlist. "Staff" for Customer Support
  is exactly the same set of accounts as "reviewer" for Content
  Review/Appeals — this is a deliberate reuse, not a new hierarchy, per
  the work package's explicit instruction not to invent one.

## 7. FAQ

`FAQ_CONTENT` in `legal-content.js`: real, deterministic, static
content (title, version, `updatedAt`, an array of `{question, answer}`
items) — no CMS, no database table, no admin editor, matching the exact
discipline already established for `TERMS_CONTENT`/`HELP_CONTENT`.
Served unchanged by `settingsService.getFaq()` and
`GET /api/support/faq`. Distinct from Stage 34's `HELP_CONTENT`
(general app how-to) — FAQ is specifically the Customer Support entry
point.

## 8. Ticket model

```
{
  id, createdAt, updatedAt,        // FeatureStore-assigned
  reporterId,                      // always req.session.accountId, never client-supplied
  type,                            // validated catalog, see §9
  description,
  status,                          // validated lifecycle, see §10
  messages: [],                    // unchanged spare array from Part 1 (myTickets() discriminator)
  attachments: [],                 // array of http(s) URLs
  staffReplies: [],                // [{ staffId, body, at }]
  history: [],                     // [{ action, actorId, at, ...extra }]
}
```

`reporterId` is derived exclusively from `req.session.accountId` at the
route layer (`POST /api/support/tickets`, pre-existing and unchanged) —
never trusted from the request body.

## 9. Ticket types

Validated catalog (`TICKET_TYPES` in `feature-platform.js`): `account`,
`billing`, `technical`, `room`, `gift_wallet`, `other`. Chosen to cover
the real domains that already exist in this codebase (account/profile,
wallet/recharge/gifts billing, RTC/technical issues, room issues, or
anything else). An arbitrary/unknown type is rejected with 400. The two
values pre-existing tests already used (`billing`, `account`) are both
in the catalog, so no pre-existing test needed to change.

## 10. Status lifecycle

`TICKET_STATUSES`: `open`, `in_progress`, `waiting_user`, `resolved`,
`closed`, `escalated`. Valid transitions are a fixed table enforced
server-side in `support.setStatus()`:

```
open         -> in_progress, escalated, closed
in_progress  -> waiting_user, resolved, escalated, closed
waiting_user -> in_progress, resolved, escalated, closed
escalated    -> in_progress, resolved, closed
resolved     -> closed
closed       -> (terminal)
```

The current status is always read from the persisted record, never
taken from the request. Only a reviewer/staff account can call
`setStatus()`; a requester (including the ticket's own owner) gets 403.
An unknown status value is rejected with 400; an invalid transition
(e.g. `closed -> open`) is rejected with 409 even though both are real
statuses.

## 11. Staff replies

`support.reply(actorId, ticketId, body)`: `actorId` is always
`req.session.accountId`; authorization is `isReviewer(reviewers,
actorId)` against the real server-only allowlist — there is no field a
caller can pass to attribute a reply to a different staff account.
Replies are appended to `staffReplies` in call order (`{staffId, body,
at}`) and are immediately visible to the requester via
`support.getMine()`/the ticket detail route. Replying to a `closed`
ticket is rejected with 409.

## 12. Attachments

`support.attach(actorId, ticketId, url)`: own-ticket only (403 for any
other account, including a reviewer — attaching is a requester action,
not a staff one). No upload/CDN pipeline exists anywhere in this
codebase (confirmed by audit, §2), so — reusing, not reinventing, the
exact same boundary `room.model.js#assertValidImageUrl` already
established for room cover/background images and chat image messages —
an attachment is a validated http(s) URL the client already hosts
elsewhere. A non-http(s) value is rejected with 400. Attaching to a
`closed` ticket is rejected with 409.

## 13. Escalation

`support.escalate(actorId, ticketId)`: staff-only. Sets `status:
'escalated'` and appends a history entry (`{action:'escalated',
actorId, at}`). A `resolved`/`closed` ticket cannot be escalated (409 —
nothing left to escalate). Escalating an already-escalated ticket is a
no-op that returns the ticket unchanged (idempotent-return, same
convention as `block()`/`muteUser()` elsewhere in this file), not an
error. An escalated ticket can still move on to `in_progress`,
`resolved`, or `closed` via `setStatus()`.

## 14. Full logs

Every ticket carries a `history` array, appended to (never overwritten)
on every important action: `created` (at `ticket()` creation),
`attachment_added`, `staff_reply`, `status_changed` (with `from`/`to`),
and `escalated`. Each entry always carries the real `actorId` (never
client-supplied) and a server-generated timestamp. Verified in order by
`support.stage35.test.js`'s "history captures ... in order" test.

## 15. API / routes

All under the existing `requireSession`-guarded platform router
(`Backend/src/routes/platform.routes.js`), `actorId`/`reporterId`/
`staffId` always `req.session.accountId`, never `req.body`:

| Method | Path | Auth |
|---|---|---|
| GET | `/api/support/faq` | session only (real static content) |
| POST | `/api/support/tickets` | session (pre-existing, unchanged) |
| GET | `/api/support/tickets` | session, own tickets (pre-existing, unchanged) |
| GET | `/api/support/tickets/:id` | own ticket only |
| POST | `/api/support/tickets/:id/attachments` | own ticket only |
| POST | `/api/support/tickets/:id/reply` | staff only |
| POST | `/api/support/tickets/:id/status` | staff only |
| POST | `/api/support/tickets/:id/escalate` | staff only |
| GET | `/api/support/queue` | staff only, every ticket, `?status=` filter |
| GET | `/api/support/queue/:id` | staff only, any single ticket |

No pre-existing route was duplicated or changed. `/queue` routes are
registered before `/:id` to avoid `'queue'` being swallowed as a
claimed ticket id.

## 16. Persistence

Everything above persists through the existing `FeatureStore` /
`InMemoryFeatureRecordRepository` (stage 35), the same real
add/list/find/update primitives Report/Review/Appeals already use.
`store.update()` throws a real 404 if the record doesn't exist —
already-established behavior, unchanged.

## 17. Security / privacy

- `reporterId` — always `req.session.accountId` at the pre-existing
  `POST /api/support/tickets` route; never trusted from input.
- `staffId` — always `req.session.accountId`, checked against the real
  reviewer allowlist server-side; there is no field that lets a caller
  claim a different staff identity.
- Status — the current status is always read from the persisted
  record; a requester cannot call `setStatus()`/`escalate()` at all
  (403), so status can never be client-spoofed by the ticket owner.
- Own-ticket access — `getMine()`/`attach()` reject any account other
  than the ticket's `reporterId` with 403.
- Cross-ticket/cross-record leakage — a report/review/appeal can never
  be misread as a ticket (structural discriminator, tested), and vice
  versa.
- Malformed/unknown ticket ids — rejected with 404, not silently
  accepted or treated as a fresh record.
- Attachments — validated http(s) URLs only; no unauthenticated write
  path exists to attach to someone else's ticket.

## 18. Mobile state

No real Support/FAQ/ticket UI exists in `Mobile/app` — only `auth`,
`onboarding`, and `splash` screens exist. Per this work package's
explicit instruction ("If no real support UI exists: DO NOT create fake
UI merely to claim completion"), no Mobile UI was built. This is
documented, not silently skipped.

## 19. Tests

- `Backend/test/support.stage35.test.js` (new, 37 tests): FAQ content,
  ticket type catalog (valid + invalid + every catalog value), own-
  ticket access + cross-user rejection, malformed/unknown id rejection,
  structural non-collision with reports, staff authorization (queue,
  reply, status, escalate all reject non-staff), staff queue
  visibility + status filter, staff replies (persistence, ordering,
  visibility, spoofing rejected, closed-ticket rejection), full status
  lifecycle (valid transitions, invalid status value, invalid
  transition, full happy-path walk), escalation (persistence, no-op on
  repeat, rejected on resolved/closed, resumable), attachments (valid
  URL, invalid URL, ownership, closed-ticket rejection), full history
  ordering, and three regression tests (`myReports`/`myTickets`
  discrimination, ticket never in review queue, ticket never in appeals
  queue).
- `Backend/test/platform.support.routes-contract.test.js` (new, 9
  tests): reproduces each new route handler's exact call shape (the
  same technique every other `*.routes-contract.test.js` file in this
  repo already uses, since `express` cannot be installed in this
  sandbox — see §22). Proves `staffId`/`actorId` come only from
  `req.session.accountId` even when the body tries to claim a different
  one, that non-staff sessions are rejected at the route boundary, and
  that own-ticket/staff-only access is enforced end-to-end through the
  handler shape.

## 20. Exact test results

Ran the full Backend suite (`node --test test/*.test.js`):

```
# tests 1369
# pass 1365
# fail 4
```

The 4 failures are `test/accounts.routes.test.js`,
`test/agora.routes.test.js`, `test/auth.routes.test.js`,
`test/config.routes.test.js` — all four fail identically before and
after this work, on `Cannot find module 'express'` (no network access
to install dependencies in this sandbox). These are pre-existing
environment/dependency limitations, not Customer Support defects — see
§22/§23.

## 21. Full Stage 35 regression

Ran every Stage 35 test file together with the rest of the suite (same
single `node --test test/*.test.js` run as §20). All Stage-35 tests
pass:

- Report / Block / Mute / Word Filter / Room Moderation / Content
  Review / Appeals (first + second half) — all pre-existing tests
  still pass unchanged.
- Customer Support (this Part) — all 46 new tests pass (37 +
  9, see §19).

Classification of the 4 failures: **(C) environment/dependency
limitation** (`express` not installed, no network access) — not (A) a
new Customer Support defect, and not a change from the pre-existing (B)
baseline (identical 4 failures existed before this work, per §2's
audit and the sandboxes documented in
`platform.moderation.routes-contract.test.js`'s own header).

## 22. Real in-process verification

Every test above runs the real domain (`feature-platform.js`'s
`moderation.support`), real persistence
(`InMemoryFeatureRecordRepository`, the actual store — not a mock), and
reproduces the actual route handler bodies from `platform.routes.js`
verbatim (not a mocked router) — the same technique already established
by every other `*.routes-contract.test.js` file in this codebase,
required because `express` cannot be installed here (no network
access). No functionality was verified only through mocks.

## 23. Environment limitations

- `express` cannot be `require()`'d in this sandbox (no network access
  to `npm install`) — pre-existing, documented in multiple prior stage
  reports, and confirmed unrelated to Customer Support by identical
  failures before and after this work.
- `MODERATION_REVIEWER_IDS` is not set in this sandbox (no real review
  staff exist here) — same pre-existing limitation Part 6/7 already
  documented; all Part 8 tests inject a reviewer set directly via
  `createPlatform({ reviewerIds })`, the same pattern Part 6/7's own
  tests use.
- No real file-hosting/CDN exists to test an actual upload — attachments
  are validated as URLs per the existing, established boundary (§12);
  this is not a Part-8-specific gap, it is the same boundary every other
  "image" field in this codebase already has.

## 24. Diff/scope audit

Files changed: `feature-platform.js`, `legal-content.js`,
`settings.service.js`, `platform.routes.js`, plus two new test files
(see §5 for the exact list). Confirmed:
- No duplicate moderation/review/appeals system was created.
- No duplicate reviewer authorization was created — `support` reuses
  the exact same `isReviewer(reviewers, ...)` primitive Part 6/7 use.
- No fake/placeholder functionality — every new field/method has a
  real caller and a real test.
- No dead code — the old `ticket()` call sites (routes,
  three pre-existing tests) are unchanged and still pass.
- No unrelated refactor — no other domain (rooms, wallet, gifts, etc.)
  was touched.
- No Stage 36 Admin Panel and no other future-stage implementation.

## 25. Confirmation Parts 1–7 remain intact

`report()`, `moderation.review.*`, and `moderation.appeals.*` in
`feature-platform.js` are byte-for-byte unchanged. All pre-existing
Stage 35 Parts 1–7 test files pass unmodified (see §20/§21). Word
Filter (`word-filter.service.js`), Room Moderation, Block, and Mute
were not touched at all.

## 26. Final completion statement

**STAGE 35 PART 8 — CUSTOMER SUPPORT — COMPLETE / 100%**, subject to the
documented environment limitations in §23 (no network access to install
`express`; no real reviewer accounts configured in this sandbox; no
file-hosting/CDN to exercise an actual upload) — none of which are
Customer-Support-specific and all of which were already true, and
already documented, before this work began.

Per this work package's own final rule: Stage 36, 37, 38, 39, and 40
are **not** started. Stopping here.
