# Stage 34 — Progress Stopped #2 (session halted by explicit user request, mid-Mobile-planning)

**Status: Stage 34 = IN PROGRESS / STOPPED — NOT DONE.** Backend is implemented
and tested. Mobile has NOT been touched yet (only planned). No
`STAGE_34_FINAL_REPORT.md` and no `STAGE_34_FINAL.zip` exist — this file and
this zip are a checkpoint, not the final deliverable.

## Why this file exists
The user said "STOP, send me a zip with the settings saving [work] first" while
I was mid-way through planning the Mobile settings screen (had just re-read
`Mobile/app/test/app.auth.test.js`'s `setupProfileActions()` harness to see
which button ids/tests would need updating, but had not yet edited
`Mobile/app/app.js` at all). Stopping immediately per that request, saving a
real checkpoint of exactly what is done vs not done.

## What is DONE and VERIFIED this session (Backend only)

Resumed from `STAGE_34_PROGRESS_STOPPED.md` (the prior checkpoint, which had
written-but-never-tested backend code). This session:

1. **Reviewed** every file the prior checkpoint listed as written
   (`settings.model.js`, `settings.repository.js`, `settings.service.js`,
   `legal-content.js`, the `account.model.js`/`account.repository.js`
   soft-delete additions, `auth.store.js`'s `revokeAllSessions()`,
   `database/index.js`/`index.js` wiring, `platform.routes.js`'s five new
   routes) against the real Stage 5/7/8/10/33 systems it's supposed to reuse.
   The boundaries were correct — nothing thrown away, nothing duplicated.

2. **Found and fixed a real security gap** explicitly flagged as unresolved
   in the prior checkpoint (Part 4 of the original instructions —
   "do not assume `revokeAllSessions()` alone is enough"): a soft-deleted
   account could still log back in (e.g. via `findOrCreatePhoneAccount()`)
   and be issued a brand-new, non-revoked session that would sail straight
   through `requireSession()`, since `authenticate()` only checks
   `revokedAt`, never account deletion status.
   - **Fix**: `Backend/src/auth/session-middleware.js`'s `requireSession()`
     now also looks up the account via `auth.accounts.findById(...)` and
     rejects (401) if the account is missing or `deletedAt` is set. This is
     the smallest additive change possible — `AuthStore#authenticate()`
     itself is untouched, same signature, same behavior.
   - `requireSession()` now returns a Promise (previously fire-and-forget)
     purely so tests can `await` it deterministically — express itself
     ignores a middleware's return value, so this is safe in production and
     does not change route wiring anywhere.
   - Updated the 4 pre-existing `requireSession` tests in
     `test/platform.auth.guards.test.js` to `await` the now-async call, and
     added 3 new tests proving the deleted-account rejection, including the
     specific "fresh session minted for an already-deleted account" case.

3. **Wrote 108 new tests, all passing**, across 8 files:
   - `test/settings.model.test.js` (17 tests) — key catalog, validation
     (valid/invalid keys and values), real defaults, defaults are
     independently valid.
   - `test/settings.repository.test.js` (10 tests) — create, real
     update-in-place (no duplicate rows), get, list, user isolation, plus
     Postgres SQL-contract tests (`ON CONFLICT (user_id, key)`, correct
     `WHERE` scoping) against a fake `pool` (no live Postgres in this
     sandbox).
   - `test/settings.service.test.js` (23 tests) — ownership (can read/write
     own, 403 on cross-account), defaults returned for unset keys, update
     persists, validation, `deleteAccount` (soft-delete + session
     revocation + idempotency + does NOT touch unrelated settings rows),
     `getTerms`/`getHelp` determinism.
   - `test/legal-content.test.js` (5 tests) — real non-empty content,
     frozen/immutable, versioned.
   - `test/auth.store.revoke-all-sessions.test.js` (5 tests, new file —
     none existed for `auth.store.js` before) — revokes only the target
     account's sessions, idempotent, returns real counts.
   - `test/account.repository.test.js` (+5 tests appended) — `softDelete()`
     idempotency, persistence, doesn't touch other fields, 404 on unknown id.
   - `test/account.model.test.js` (+2 tests appended) — `deletedAt` defaults
     to `null`, is a real `SERVER_OWNED_FIELD`.
   - `test/platform.settings.routes-contract.test.js` (10 tests, new file,
     same express-free "reproduce the exact route wiring against fake
     req/res" style as `platform.notifications.routes-contract.test.js`) —
     every one of the 5 new routes, correct status codes/response shapes,
     ownership enforcement, delete-account never trusts a client-supplied
     target id.
   - `test/platform.auth.guards.test.js` (+3 tests, 4 tests patched to
     `await`).

4. **Ran the full Backend suite**: `node --test test/*.test.js` →
   **1113/1117 passing.** The 4 failures are `Cannot find module 'express'`
   in `accounts.routes.test.js`/`agora.routes.test.js`/`auth.routes.test.js`/
   `config.routes.test.js` — confirmed by inspecting each error directly.
   These are the exact same 4 pre-existing environmental failures documented
   throughout this repo (no npm/network access in this sandbox) — **not new,
   not caused by Stage 34.**

## What is explicitly NOT done yet

- **Mobile — completely untouched.** No file under `Mobile/` has been
  edited this session. The five settings (language/sound/mic/network/media)
  have **no real client consumption path yet**:
  - `Mobile/app/app.js`'s `#settingsBtn` still does the OLD generic
    free-text `prompt('اسم الإعداد؟')`/`prompt('القيمة؟')` flow against
    `POST /platform/api/settings` — it works (the backend endpoint is real),
    but it is not the real Settings screen the five known keys deserve, and
    it does not read `GET /api/settings/:userId` on open or apply any value
    to real client behavior.
  - `mic` is NOT wired into `Mobile/app/rtc/agora-voice-client.js`'s real
    `setMuted()`.
  - `language` is NOT applied to `document.documentElement.lang`/`dir` (the
    one real, existing "localization mechanism" in this app — a static
    `lang="ar" dir="rtl"` in `index.html`).
  - `sound`/`media`/`network` have no real client effect wired at all yet.
  - Delete Account / Terms / Help have no Mobile UI at all yet (only the
    real backend routes exist).
- **Planned but not written**: a `renderSettingsScreen()` in `app.js` with
  real toggles/selects for the 5 keys, a `loadSettings()`/`applySettings()`
  pair called from `render()`, `saveSetting(key,value)` calling the real
  `POST /api/settings`, Terms/Help sub-views, and a Delete Account button
  with confirmation. This will require updating (not just adding to) two
  existing Mobile tests in `Mobile/app/test/app.auth.test.js` — the
  `'settings action posts...'` and `'settings list action...'` tests — since
  they assert the OLD generic prompt-based `#settingsBtn`/`#settingsList`
  behavior, which this change intentionally replaces. This had been
  identified (I had just re-read `setupProfileActions()`'s button-id list
  to plan the update) but **no Mobile file has been edited.**
- `node --check` has not yet been run across any changed file this session
  (it should pass trivially for the one Backend file changed —
  `session-middleware.js` — since `node --test` already exercised it, but
  this has not been run explicitly and is not yet done for a Mobile change
  that doesn't exist yet).
- Full Mobile test suite has not been run this session (only inspected).
- Manual verification checklist: not started.
- `STAGE_34_FINAL_REPORT.md`: does not exist.
- `STAGE_34_FINAL.zip` (the real, verified-contents final deliverable):
  does not exist — this zip is a progress checkpoint only.

## Do not declare Stage 34 complete from this file

Resume exactly from here: implement the Mobile Settings screen + the five
real client-effect wirings in `app.js`/`agora-voice-client.js`, update the
two stale Mobile tests, run the full Mobile suite, run `node --check` on
every changed file (Backend and Mobile), do the full manual verification
checklist, then write the real `STAGE_34_FINAL_REPORT.md` and a genuinely
final `STAGE_34_FINAL.zip`.

**Do not restart Stage 34. Do not redo the Backend work above — it is done
and verified. Do not start Stage 35 or any other stage.**
