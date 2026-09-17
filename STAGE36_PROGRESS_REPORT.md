# Stage 36 — Progress Report (NOT a "100%" / final report)

## Why this file is named "progress", not "final"

The Stage 36 instruction lists a large set of deliverables:
1. Real `suspend()`/`unsuspend()`/`listSuspended()` — **done**
2. Central Staff/Roles/Permissions RBAC — **done**
3. Migrating scattered Stage 29/35 allowlists — **done, additively**
4. Central Audit Log wired into sensitive admin operations — **done for
   the two operations that exist so far** (account suspend/unsuspend);
   NOT yet wired into inventory grant or content-review actions
5. Admin Panel/Admin APIs for users, rooms, economy, recharge, gifts,
   games, reports, bans, tickets, support, analytics — **only "users"
   (suspend/unsuspend/list) is done; the other nine surfaces are NOT
   built**
6. Real anti-fraud logic — **NOT built**
7. Backup/recovery documentation and verification — **NOT written**
8. Comprehensive Stage 36 tests — **done for everything that was
   actually built (items 1–4 above); nothing exists to test for items
   5–7 since they weren't built**
9. Regression tests for affected previous stages — **the full existing
   suite was re-run and confirmed unaffected (see below); no NEW
   regression tests were written beyond that**
10. Full test suite — **run, results below**
11. `STAGE36_FINAL_REPORT.md` — **not written; this file exists instead,
    on purpose, so nothing here overstates completion**
12. Updated project ZIP — **done, this delivery**

Per the explicit instruction "Do not claim 100% unless the
corresponding code and tests actually exist," this report only claims
what is true right now. Items 5 (nine of ten surfaces), 6, and 7 are
real, substantial pieces of work that were not attempted this session
and should not be assumed complete.

## What was actually built and verified this session

### 1. `Backend/src/database/repositories/account.repository.js`
Real `suspend(accountId, { reason, actorId })`, `unsuspend(accountId,
{ actorId })`, `listSuspended()` for both `InMemoryAccountRepository`
and `PostgresAccountRepository`. Idempotent no-op contract (matches
the existing `softDelete()` pattern): re-suspending an already-
suspended account preserves the original reason/actor; unsuspending an
already-active account is a real no-op. Validates `reason`/`actorId`
as non-empty strings; 404s on an unknown account.

New columns via `028_add_account_suspension.sql`
(`suspended_at`/`suspended_reason`/`suspended_by`, plus a partial index
for `listSuspended()`), and matching fields added to
`account.model.js`.

### 2. `Backend/src/security/staff.js`
Central RBAC: four roles (`support`, `moderator`, `admin`,
`superadmin`), a closed set of granular permissions
(`account:suspend`, `inventory:grant`, `content:review`,
`economy:manage`, `audit:view`, etc.), `ROLE_PERMISSIONS` mapping each
role to its permissions, `loadStaffFromEnv(STAFF_ROLES)` (comma/pipe-
separated env format, same "pure function of env" pattern as the
existing `admin-staff.js`/`moderation-staff.js`), and
`hasPermission`/`hasRole`/`requirePermission`.

### 3. Migration of the two existing allowlists
`inventory-admin.service.js`'s `grant()` and all three
`_requireReviewer()` sites in `feature-platform.js` now OR the legacy
allowlist check with `hasPermission(staffRoles, actorId, ...)` —
additive, non-breaking: a deployment that has only configured the old
env vars keeps working exactly as before; `STAFF_ROLES` is the new,
single source of truth for granting access going forward.

### 4. Central Audit Log
`029_create_audit_log.sql` (append-only table, three indexes),
`audit-log.repository.js` (in-memory + Postgres, `record()`/`list()`
only — no update/delete method exists, verified by test), and
`audit.service.js` (`record()` never throws on its own account so a
logging failure can't masquerade as the real action's failure;
`list()` is gated on the `audit:view` permission).

### 5. `Backend/src/services/account-admin.service.js` + routes
Ties 1–4 together: `suspend()`/`unsuspend()`/`listSuspended()`, each
checking the relevant permission FIRST (before input validation, same
principle as the existing `inventory-admin.service.js`), then calling
the repository, then recording an audit entry. Wired into
`Backend/src/index.js` and exposed as real routes in
`Backend/src/routes/platform.routes.js`:
- `POST /api/admin/accounts/:accountId/suspend`
- `POST /api/admin/accounts/:accountId/unsuspend`
- `GET /api/admin/accounts/suspended`
- `GET /api/admin/audit-log`

## Tests (all new, all passing)

| File | Tests |
|---|---|
| `test/account.repository.suspension.test.js` | 13/13 |
| `test/staff.test.js` | 18/18 |
| `test/audit-log.repository.test.js` | 10/10 |
| `test/account-admin.service.test.js` | 8/8 |

**49/49 new tests passing**, each run individually and confirmed above.

## Full suite: before / after this session

`node --test test/*.test.js`, run 3 consecutive times for stability
(same discipline as the Stage 29 report):

- Before this session's changes: 1738 tests, 1734 pass, 4 fail.
- After this session's changes (49 new tests added, nothing else
  removed): **1787 tests**, all 3 runs: **1783 pass, 4 fail** —
  identical, deterministic every time.

The same 4 failures every run (`accounts.routes.test.js`,
`agora.routes.test.js`, `auth.routes.test.js`, `config.routes.test.js`)
are the pre-existing, sandbox-only `Cannot find module 'express'`
error documented in the Stage 29 report — unrelated to this session's
changes (no express-dependent code was touched). One run during this
session showed a 5th, different failure
(`notifications/:userId` contract test); re-run 3 more times cleanly
at 4 failures — that one instance was a flake, not a real regression,
and is called out here rather than silently omitted.

## Genuinely outstanding work (not started)

- Admin Panel/API surfaces for: rooms, economy, recharge, gifts,
  games, reports, bans, tickets, support, analytics (9 of 10 listed
  domains).
- Wiring the Audit Log into inventory grants and content-review
  actions (only account suspend/unsuspend are wired in so far).
- Real anti-fraud logic.
- Backup/recovery documentation and verification.
- A true `STAGE36_FINAL_REPORT.md` — should only be written once the
  items above are actually built and tested, per the "don't claim 100%"
  instruction.

## Net result of this session

A real, tested, working vertical slice of Stage 36 exists end-to-end:
central RBAC → permission-gated admin service → repository → audit
trail → HTTP routes. Nothing in this slice is a placeholder or a fake
success. The remaining Stage 36 scope (nine more admin domains,
anti-fraud, backup/recovery docs) is substantial and was not attempted
this session — it should not be assumed done.
