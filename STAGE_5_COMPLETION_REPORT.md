# Stage 5 — Completion Report (Authentication / Sessions / Recovery)

This report documents an **audit-then-complete** pass over Stage 5 only, per the 40-stage
plan. No Stage 6+ file was touched (verified in §5). Nothing already implemented and tested
was redone from scratch.

## 1. Audit — state found at the start of this session

Stage 5 already had a large amount of real, non-fake implementation from prior sessions
(confirmed by reading the code, not by trusting prior reports):

- Phone OTP: issue/verify, sha256-hashed code storage, 5-minute expiry, 5-attempt limit,
  code never returned in production (`Backend/src/auth/auth.store.js`,
  `Backend/src/routes/auth.routes.js`).
- Server-side Terms/Privacy consent: version + timestamp stored against the account on both
  OTP and social login (`AuthStore#setConsent`), read back via `GET /auth/me`.
- Bearer sessions: random token, sha256-hashed at rest, device id/name/platform metadata,
  `GET /auth/sessions` (list — "Devices" screen), `DELETE /auth/sessions/:id` (remote logout
  of a specific device), `POST /auth/logout` (current device).
- Recovery: `POST /auth/recovery/otp/request` + `/verify`, issues a new session for the
  verified phone.
- Social login: Google/Facebook verified against the real provider's user-info endpoint
  (`Backend/src/auth/provider-verifiers.js`); Apple verified with a genuine ES256 JWT/JWKS
  signature check via `node:crypto` (fails closed, 503, if `apple.audience` is unconfigured —
  never trusts a client-supplied identity).
- `Backend/test/stage5-provider-verification.test.js` (23 tests) already covered Apple/
  Google/Facebook success and failure paths, added in a prior session.

**The one real gap found:** `Backend/src/database/repositories/auth.repository.js` already
contained a correct, schema-matched `PostgresAuthRepository` — but it was **never referenced**
in `Backend/src/database/index.js`'s `buildDatabase()` activation switch, unlike every other
domain (accounts, wallets, gifts, families, chat, settings, etc., all of which get a real
Postgres-backed repository when `STAGE3_ENABLE_POSTGRES=true`). `AuthStore` was always
constructed with its default in-memory repository. This meant OTP/session/consent/device data
would **never actually persist**, even in an environment where Postgres was correctly
activated and every other domain's data was durable — the exact opposite of what
"Terms/Privacy Consent محفوظ فعليًا في السيرفر" requires. This was documented honestly by the
prior session as explicit follow-up work (`Authentication/STAGE5_TODO.md` item 5,
`027_create_auth_tables.sql`'s header) rather than hidden or faked — but it was still an open
gap, so this session closed it.

## 2. Implementation (this session)

**Root cause of why it wasn't wired in:** `PostgresAuthRepository` is necessarily asynchronous
(real network I/O via `pg`), while `AuthStore`'s public methods were synchronous, and several
already-passing tests called them without `await` and asserted on the return value directly.
Wiring in Postgres without changing that would have silently broken at runtime (a session
lookup would return a `Promise` object instead of a session).

**Fix:** made every `AuthStore` method `async`/`await`-based
(`issueOtp`, `verifyOtp`, `findOrCreatePhoneAccount`, `findOrCreateSocialAccount`,
`createSession`, `authenticate`, `revokeSessionById`, `listSessions`, `revokeAllSessions`,
`setConsent`, `getConsent`). This is safe for the in-memory repository: `await` on an
already-resolved synchronous value is a no-op that resolves on the next microtask, so
`InMemoryAuthRepository`'s behavior is unchanged. It is what makes the Postgres repository
usable at all.

Every real call site was then updated to `await` the now-`Promise`-returning calls:

- `Backend/src/auth/session-middleware.js` — `requireSession()` now awaits
  `auth.authenticate(...)` before the existing account-lookup/soft-delete check (which was
  already async).
- `Backend/src/routes/auth.routes.js` — all nine routes updated: OTP request/verify, social
  login, `/auth/me`, `/auth/sessions` (GET + DELETE), recovery request/verify, `/auth/logout`.
  Two handlers (`DELETE /auth/sessions/:sessionId`, `POST /auth/logout`) were converted from
  sync to `async` route handlers to allow the `await`.
- `Backend/src/services/settings.service.js` — `deleteAccount()` (already `async`) now awaits
  `authStore.revokeAllSessions(...)`.
- `Backend/src/database/index.js` — added `InMemoryAuthRepository`/`PostgresAuthRepository`
  import and wired `auth:` into **both** branches of `buildDatabase()` (in-memory and
  Postgres), exactly matching the pattern already used for every other domain.
- `Backend/src/index.js` — `AuthStore` is now constructed as
  `new AuthStore(db.accounts, db.auth)` instead of relying on the constructor's private
  default, so it receives whichever repository `getDatabase()` actually built.

No route behavior, response shape, status code, or business rule changed. This is purely an
activation change: the exact same logic now runs against a real repository interface instead
of being permanently locked to an in-memory one.

## 3. Architecture

Unchanged from the existing project pattern, now fully consistent with every other domain:

```
routes/auth.routes.js  ->  auth/auth.store.js (AuthStore: business rules)
                              -> database/repositories/auth.repository.js
                                   -> InMemoryAuthRepository   (active when Postgres is off)
                                   -> PostgresAuthRepository   (active when Postgres is on)
```

`database/index.js` is still the single place that decides which backend is active — Stage 5
now participates in that decision instead of being a permanent exception to it.

## 4. Integration

- `db.auth` flows through `getDatabase()` exactly like `db.accounts`, `db.wallets`, etc.
- `AuthStore` is the one and only consumer of `db.auth` (checked: `grep` for `db.auth` shows
  exactly the two `database/index.js` definitions and the one `index.js` construction site).
- No other service reaches into `db.auth` directly — `settings.service.js`'s
  `deleteAccount()` goes through `authStore.revokeAllSessions()`, same as before.
- `PostgresAuthRepository`'s SQL was not modified — it already matched
  `schema/027_create_auth_tables.sql` column-for-column from the prior session's review; only
  its activation wiring changed.

## 5. Testing

**Files changed this session (13 total, verified with `diff -rq` against a fresh
re-extraction of the uploaded ZIP — nothing else, including any Stage 6-40 file, was
touched):**

```
Authentication/STAGE5_TODO.md                              (doc update — item 5 marked done)
Backend/src/auth/auth.store.js                              (async conversion)
Backend/src/auth/session-middleware.js                      (await authenticate())
Backend/src/database/index.js                                (wire db.auth, both branches)
Backend/src/database/repositories/auth.repository.js        (header comment — no logic change)
Backend/src/database/schema/027_create_auth_tables.sql       (header comment — no DDL change)
Backend/src/index.js                                          (AuthStore(db.accounts, db.auth))
Backend/src/routes/auth.routes.js                             (await every AuthStore call)
Backend/src/services/settings.service.js                      (await revokeAllSessions)
Backend/test/auth.repository.test.js                          (await AuthStore-level calls)
Backend/test/auth.store.revoke-all-sessions.test.js           (await AuthStore-level calls)
Backend/test/platform.auth.guards.test.js                     (await AuthStore-level calls)
Backend/test/settings.service.test.js                         (await AuthStore-level calls)
```

No test assertion, scenario, or expected value was weakened, removed, or skipped — every
edit only added `await` in front of a call whose return value the test already checked;
`InMemoryAuthRepository`'s own direct unit tests (in `auth.repository.test.js`) were left
untouched since that class's internals did not change.

**`node --check` on every changed `.js` file:** all clean, no syntax errors.

**Full Backend suite** (`node --test test/*.test.js`):
```
tests 1398
pass 1394
fail 4
```
**Full Mobile suite** (`node --test app/test/*.test.js`, run from `Mobile/`):
```
tests 92
pass 92
fail 0
```

**The 4 Backend failures are pre-existing and environmental, not caused by this session:**
`accounts.routes.test.js`, `agora.routes.test.js`, `auth.routes.test.js`,
`config.routes.test.js` all fail with `Error: Cannot find module 'express'`. Confirmed by
running the full suite *before* making any change (baseline: 1398 tests, same 4 files
failing) and again after — same 4 files, same cause, verified by direct inspection of each
failure's stack trace (`Cannot find module 'express'`, not an assertion failure). See §6.

## 6. Verification

- `Backend/node_modules` is empty; `npm install` in `Backend/` was attempted in this session
  and returned `403 Forbidden` from `registry.npmjs.org` for every package (`express`, `pg`,
  `pino`, `agora-token`, etc.) — this sandbox has no network egress, confirmed directly, not
  assumed from a prior report.
- Because of that, the 4 HTTP-level route test files above cannot execute at all (they
  `require('express')` at the top of the file) — this is identical to the state recorded in
  the prior session's `STAGE_5_FINAL_REPORT.md` and `Authentication/STAGE5_REPORT.md`.
- Everything that **can** run without `express`/`pg` was run and passes: all business-logic
  and repository-level tests, including the new/updated auth ones, the full provider-
  verification suite, and the full Mobile suite.
- Scope check: `diff -rq` of this working tree against a fresh re-extraction of the uploaded
  ZIP shows exactly the 13 files listed in §5 changed — no Stage 6-40 file, and no
  unrelated Stage 5 file, was touched.

## 7. External Blockers (real, not fabricated — nothing worked around or faked)

These are unchanged from the prior session's honest accounting and were independently
re-confirmed in this session:

1. **No network egress in this sandbox.** `npm install` returns `403 Forbidden`. This blocks:
   - Installing `express`/`pg`/etc., which blocks the 4 HTTP route-test files from executing
     at all (not "failing" — they cannot even load).
   - Actually connecting a live Postgres database to prove `PostgresAuthRepository` end-to-end
     against real SQL (the wiring is real and code-reviewed against the schema, but has not
     been exercised against a live `DATABASE_URL` in this session).
2. **No real SMS provider credentials.** `Backend/src/auth/sms-config.js`/`otp-sender.js` fail
   closed (real error, no fake "delivered") when unconfigured — unchanged, not addressed
   this session (out of scope: this is a credentials/ops task, not a code gap).
3. **No real Google/Facebook/Apple credentials or live tokens.** The verifiers are real and
   already tested against synthetic-but-cryptographically-valid tokens (Apple) and mocked
   provider responses (Google/Facebook); a live end-to-end run against the real provider
   endpoints requires real app credentials and a real device, neither available here.

None of the above was faked, bypassed, or skipped to force a pass — each is recorded here
instead, per the task's explicit instruction.

## 8. Final Status

**Stage 5 code, including the real gap found and fixed this session (Postgres persistence
wiring for identities/OTP/sessions/consents), is complete and consistent with the rest of the
project's activation pattern.** Every automated test that can run in this sandbox passes
(1394/1398 Backend, 92/92 Mobile; the 4 Backend failures are the pre-existing, environmental,
`express`-not-installable issue, not a Stage 5 defect).

**Stage 5 is NOT — and is not being declared — externally "Done"** until, in an environment
with network/credential access:
- `npm install` succeeds and the 4 currently-blocked HTTP route test files are run for real.
- A live Postgres database is connected (`STAGE3_ENABLE_POSTGRES=true` + `DATABASE_URL` +
  migrations) and `PostgresAuthRepository` is exercised end-to-end, not just code-reviewed.
- Real SMS/Google/Facebook/Apple credentials are configured and the manual verification
  checklist in the prior `STAGE_5_FINAL_REPORT.md` §8 is run against live provider endpoints.

**No other Stage was started or touched.**
