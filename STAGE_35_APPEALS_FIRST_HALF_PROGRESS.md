# STAGE 35 — PART 7/8 — APPEALS — FIRST HALF PROGRESS

**This is NOT the final Part 7 report. Part 7 is NOT 100% complete.**
Only the first half (foundation + user submission side) is implemented,
per the work package's explicit instruction not to finish all of Part 7.

## 1. First-half scope completed

Implemented, in `moderation.appeals` (`Backend/src/feature-platform.js`):

- `create(actorId, { reviewId, reason })` — submit an appeal against a
  real, resolved Content Review decision.
- `listMine(actorId)` — the caller's own appeals.
- `getMine(actorId, appealId)` — one of the caller's own appeals
  (403 on someone else's, 404 if unknown).

Routes added (`Backend/src/routes/platform.routes.js`), same
session-auth convention as every other route in the file:
```
POST /api/moderation/appeals
GET  /api/moderation/appeals
GET  /api/moderation/appeals/:id
```

## 2. What was explicitly NOT built (by design)

- **Appeals second half** (staff adjudication of an appeal — no
  overturn/uphold-appeal/reverse method exists anywhere in
  `moderation.appeals`).
- **Part 8** (Customer Support / FAQ / Support Tickets) — `ticket()` in
  `feature-platform.js` is unmodified; no FAQ or support-ticket code
  was added anywhere.

## 3. Eligibility / implementation detail

An appeal must reference a REAL, persisted Content Review decision —
never a client-claimed one:
- The referenced `reviewId` must resolve to an actual `kind:'review'`
  record (404 if not).
- The review's `status` must already be `resolved` (409 if still
  `in_review`/`open` — nothing to appeal yet).
- The review's `decision` must be `upheld` (403 if `dismissed` — a
  dismissed report has nothing adverse to appeal).
- The caller (`actorId`, from session) must be the account the decision
  was made **against** (`review.reportedAccountId`) — never the
  original reporter, and never an unrelated account naming someone
  else's review id.
- One appeal per review: a second attempt against the same review is
  rejected with 409 (not silently merged/idempotent-returned — a second
  submission usually carries a materially different `reason`, so
  discarding it in favor of the first would hide real user intent).

## 4. Security

- Appellant identity is always `req.session.accountId` — never taken
  from the request body. A spoofed `reviewerId`/decision value in the
  input cannot fabricate eligibility, because outcome/status/
  reportedAccountId are read only from the persisted review record.
- A user cannot appeal a decision made against a different account
  (including the original reporter of their own report).
- A user cannot view or modify another user's appeal — `getMine`
  returns 403 on a real appeal id that belongs to someone else, and 404
  on an unknown id (no existence leakage).
- Malformed/missing `reviewId` or empty `reason` is rejected (400).

## 5. Persistence

Reuses the same stage-35 `FeatureStore` / repository architecture as
every other Part in this stage — no second appeals-specific database
abstraction. Appeal records are tagged `kind:'appeal'`, using the same
discriminator convention as `kind:'review'`, so appeals, reviews,
reports, and tickets can never be cross-read as one another (verified
by regression tests in both the Content Review and Appeals suites).

## 6. Tests

`Backend/test/appeals-first-half.stage35.test.js` (16 tests) and
`Backend/test/platform.appeals.routes-contract.test.js` (6 tests) cover
every item in instruction §16:

- eligible user creates a valid appeal; ineligible (dismissed / not yet
  resolved) rejected
- unauthenticated rejected
- appeal links to a real review record — unknown reviewId → 404
- appellant identity from session only, never trusted from input
- spoofed reviewer/decision ids cannot fabricate eligibility
- a user cannot appeal a decision made against a different account
- malformed input rejected
- duplicate appeal against the same review rejected (409)
- a user sees their own appeal(s); cannot see another user's
- Part 6 integration: creating an appeal does not alter the underlying
  review record, and the reviewer queue is unaffected by appeal
  submissions
- regression: Report/Block/Mute/Word Filter/Room Moderation all
  unaffected by Appeals

## 7. Results

| Suite | Result |
|---|---|
| `appeals-first-half.stage35.test.js` | 16/16 pass |
| `platform.appeals.routes-contract.test.js` | 6/6 pass |
| Full Backend regression (`node --test test/*.test.js`) | 1289/1293 pass |

The 4 full-suite failures are pre-existing, unrelated to Appeals, and
caused by a network-isolated sandbox missing `express`/`pg`/
`agora-token` (`accounts.routes.test.js`, `agora.routes.test.js`,
`auth.routes.test.js`, `config.routes.test.js` — see the companion
`STAGE_35_CONTENT_REVIEW_FINAL_REPORT.md` §12 for the full breakdown).
Classification: environment/dependency limitation, not a Part 7 defect.

## 8. Remaining second-half Appeals work (not started)

- Staff/reviewer adjudication of a submitted appeal (uphold the
  original decision / overturn it).
- Whatever follow-on effect an overturned decision should have (e.g.
  reversing a triggered moderation action) — not scoped or designed
  yet; needs its own audit once second-half work begins, per
  instruction's "Part 8 is separate, second-half Appeals is separate"
  boundary.
- Any notification/event to the appellant on adjudication.

Part 8 (Customer Support/FAQ/Tickets) was **not started** — confirmed
untouched in this session (§2, and the diff/scope audit in the
companion Content Review report §14).

## 9. Conclusion

Part 7 first half is genuinely complete and tested: real eligibility
tied to a real, resolved review record, real session-derived identity,
real duplicate/security enforcement, real persistence, and a passing
dedicated + route-contract test suite plus full regression. **Part 7 is
NOT 100%** — only the first half described above. Second-half staff
adjudication and Part 8 remain explicitly out of scope for this work
package and were not touched.
