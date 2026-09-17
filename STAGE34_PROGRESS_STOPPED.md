# Stage 34 — Progress Stopped (session halted by explicit user request before verification)

**Status: Stage 34 = IN PROGRESS / STOPPED — NOT DONE.** No tests have been run yet
in this session. Nothing below should be read as verified — it is exactly what was
written, and nothing more.

## Why this file exists
The user explicitly said to stop and save a zip of the latest stage/progress first,
before continuing (same "stop immediately, save progress" pattern documented earlier
in `STAGES_1_35_CONTINUATION_STATE.md`). This session stopped immediately on that
request, mid-implementation, before writing a single test or running the suite.

## What was actually done this session (written, not yet tested)
- `Backend/src/database/models/settings.model.js` — new. Real key catalog
  (`language`, `sound`, `mic`, `network`, `media`), per-key validation (language
  checked against the real `Backend/src/config/config.schema.js` supported list),
  real defaults.
- `Backend/src/database/repositories/settings.repository.js` — new. Real
  upsert-in-place by `(userId, key)`, `InMemorySettingsRepository` +
  `PostgresSettingsRepository`, same dual pattern as `notification.repository.js`.
- `Backend/src/database/schema/025_create_settings.sql` — new table schema.
- `Backend/src/database/schema/026_add_account_soft_delete.sql` — new migration,
  adds `accounts.deleted_at`.
- `Backend/src/database/models/account.model.js` — edited (additive): `deletedAt:
  null` added to `createAccount()`, added to `SERVER_OWNED_FIELDS`.
- `Backend/src/database/repositories/account.repository.js` — edited (additive):
  added `softDelete()` to both `InMemoryAccountRepository` and
  `PostgresAccountRepository` (idempotent no-op if already deleted), added
  `deletedAt` to `mapAccountRow()`.
- `Backend/src/auth/auth.store.js` — edited (additive): added
  `revokeAllSessions(accountId)`. No existing method changed.
- `Backend/src/services/settings.service.js` — new. `get`/`set` (ownership-checked,
  validated, update-in-place), `deleteAccount` (soft-delete + force-logout
  everywhere via `revokeAllSessions`), `getTerms`/`getHelp`.
- `Backend/src/domain/legal-content.js` — new. Static, deterministic Terms/Help
  content (no CMS, no DB-backed CRUD).
- `Backend/src/feature-platform.js` — edited: removed the old primitive
  `settings: { set(input) {...} }` stub (confirmed unreferenced anywhere via grep
  before deletion — same discipline as the earlier battles/notifications removals).
  `STAGES[34]` label ("General Settings") was already correct and untouched.
- `Backend/src/database/index.js` — edited (additive): wired
  `InMemorySettingsRepository`/`PostgresSettingsRepository` in as `db.settings`.
- `Backend/src/index.js` — edited (additive): constructed `settingsService`, passed
  it into `createPlatformRouter(...)`.
- `Backend/src/routes/platform.routes.js` — edited: `createPlatformRouter`'s
  signature now also takes `settingsService`. `POST /api/settings` and
  `GET /api/settings/:userId` now call the real service instead of the old
  `platform.settings`/`platform.store.list(34, ...)`. Added
  `POST /api/settings/account/delete`, `GET /api/settings/terms`,
  `GET /api/settings/help`.

**API response shape change (documented, not hidden):** `GET /api/settings/:userId`
used to return the raw append-only records reduced by `latestSettingsByKey`
(an array). It now returns a single object with exactly the five known keys and
their effective current value (real defaults filled in for anything never set).
Confirmed via grep before this change that nothing in the repository (Backend or
Mobile) depended on the old array shape — the two Mobile UI tests that touch
`/platform/api/settings*` mock `fetch` entirely and never exercise real backend
response parsing beyond a URL match, so they are unaffected either way. This has
**not been re-confirmed by an actual test run this session.**

`Backend/src/routes/platform.reads.js`'s `latestSettingsByKey()` function itself
was **not** modified or removed — it is still directly unit-tested by
`Backend/test/platform.reads.test.js` on raw objects, unrelated to the live route.

## What is explicitly NOT done yet
- **Zero tests written or run this session.** No model/repository/service/route-
  contract/isolation/regression tests exist yet for any of the above.
- Full Backend suite, Mobile suite, and `node --check` have not been run this
  session against these changes.
- `STAGE_34_FINAL_REPORT.md` (the real one, with test results) does not exist yet —
  this file is a stop/checkpoint note, not that report.
- `STAGE_34_FINAL.zip` does not exist yet in the "final, verified" sense — only the
  raw progress zip requested for this stop.
- Terms/Help routes, the delete-account route, and the settings get/set routes have
  never been exercised even once (no manual curl/test call has happened).
- Mobile has not been touched at all this session (no client code reads the five
  new settings keys yet — e.g. the mic preference is not yet wired into
  `Mobile/app/rtc/agora-voice-client.js`'s real `setMuted()` call). This was flagged
  as planned, real-effect wiring in the prior message, but not implemented before
  the stop.

## Do not declare Stage 34 complete from this file
This is a checkpoint of code that has been written but never executed. The correct
next step, when resumed, is exactly what was about to happen before the stop:
write the tests, run focused Stage 34 tests, run the relevant backend route tests,
run the full Backend suite, run the full Mobile suite, run `node --check` on every
changed file, separate real failures from the four known pre-existing environmental
ones (`Cannot find module 'express'`), do the manual verification checklist, and
only then write the real `STAGE_34_FINAL_REPORT.md` and a genuinely final
`STAGE_34_FINAL.zip`.

**Resume Stage 34 exclusively from this exact point — do not restart it, do not
start Stage 35 or any other stage.**
