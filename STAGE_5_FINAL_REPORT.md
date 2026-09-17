# Stage 5 — Final Report (Authentication)

## 1. Stage 5 requirements (from `Authentication/STAGE5_*.md`)
- Phone OTP auth (request/verify), with server-owned account creation and stored consent.
- Bearer sessions: creation, listing, per-device revocation, `/auth/me`, `/auth/logout`.
- Phone-based account recovery (OTP-based, issues a new session).
- Social login for **Google**, **Facebook**, **Apple**, verified against the real provider
  (no client-supplied identity trusted).
- Apple specifically: real ES256 signature verification against Apple's JWKS, not a stub.
- Automated tests for the above, plus honest documentation of what still needs real-world
  verification with live provider credentials.

## 2. Existing implementation found (before this task)
Already implemented and unchanged by this task:
- `Backend/src/auth/auth.store.js` — OTP issuance/verification, sessions, devices, consent.
- `Backend/src/auth/session-middleware.js` — bearer session guard.
- `Backend/src/auth/otp-sender.js` — SMS delivery boundary (fails closed if unconfigured).
- `Backend/src/routes/auth.routes.js` — all Stage 5 HTTP routes.
- `Backend/src/auth/provider-verifiers.js` — **already contained real logic**:
  - Google/Facebook: calls the real provider user-info endpoint, requires `sub`/`id`.
  - Apple: real JWT parsing, `alg`/`kid` checks, `iss`/`aud`/`exp`/`iat` claim checks, JWKS
    fetch + cache, and genuine ECDSA (ES256) signature verification via `node:crypto`
    (`crypto.createVerify('SHA256').verify(...)` against a real P-256 public key, with a
    raw-signature → DER converter since JOSE uses raw r‖s and Node's verifier wants DER).
  - Fails closed (503) if `apple.audience` isn't configured; never trusts an unsigned payload.

**This confirms the audit's premise: the Apple verifier was real, production-grade code —
the gap was test coverage, not the implementation.**

## 3. What was missing
Test coverage for `provider-verifiers.js` was minimal: only one case existed anywhere in the
suite (`Backend/test/final-corrections.test.js`, "Apple verifier rejects a forged ES256 token
signature"). Missing:
- Apple: successful verification with a genuinely valid signature.
- Apple: expired token rejection.
- Apple: wrong-audience rejection.
- Apple: wrong-issuer rejection.
- Apple: JWKS fetch failure / missing key / malformed JWKS handling.
- Apple: malformed token / unsupported algorithm / bad signature length.
- Apple: fail-closed behavior with no audience configured (with no network call).
- Google: success and failure paths.
- Facebook: success and failure paths.
- `verifyProviderToken` dispatch: missing token, unsupported provider, provider-name casing.

## 4. What was implemented/fixed
No production code defects were found in `provider-verifiers.js` — it was already correct, so
per the task rule, only tests were added (no working auth logic was changed).

Added **23 new unit tests** in one new file, closing every gap listed above, including a real
(not mocked) ECDSA proof: each "successful verification" test generates a genuine EC P-256
key pair with `node:crypto`, signs a real token with it, serves it back through a
`global.fetch` stub standing in for Apple's JWKS endpoint (no network access in this sandbox),
and asserts the verifier's real `crypto.createVerify(...).verify(...)` call accepts it.

During test authoring, two **test-isolation bugs in my own test code** (not production code)
were found and fixed: the module's JWKS cache is a module-level `Map` keyed by URL, and reusing
the same `kid`/URL across tests let one test read another test's cached key. Fixed by giving
each test a unique `kid` and `jwksUrl`.

## 5. Exact files created/modified
- **Created:** `Backend/test/stage5-provider-verification.test.js` (326 lines, 23 tests).
- **Modified:** none. `provider-verifiers.js` and all other Stage 5 source files are
  byte-for-byte unchanged from the uploaded project (verified with `diff -rq` against a fresh
  re-extraction of the original ZIP — see §9).

## 6. Test results

### Focused Stage 5 auth tests
`node --test test/stage5-provider-verification.test.js test/final-corrections.test.js
test/auth.routes.test.js test/platform.auth.guards.test.js`
```
tests 43
pass 42
fail 1   (auth.routes.test.js — pre-existing, see §7)
```

### Full Backend suite
`node --test test/*.test.js`
```
tests 1047   (was 1024 before this task; +23 new)
pass 1043
fail 4       (all 4 pre-existing, see §7 — same 4 as before this task, no new failures)
```

### Full Mobile suite
`node --test app/test/*.test.js` (run from `Mobile/`)
```
tests 81
pass 81
fail 0
```

### `node --check`
`node --check test/stage5-provider-verification.test.js` → **passes, no syntax errors.**

## 7. Environmental / pre-existing failures (not caused by this task)
`Backend/test/accounts.routes.test.js`, `agora.routes.test.js`, `auth.routes.test.js`, and
`config.routes.test.js` all fail with `Error: Cannot find module 'express'`. `Backend/node_modules`
is empty and `npm install` returns `403 Forbidden` from the registry — this sandbox has no
network egress to install dependencies. This is pre-existing (confirmed by running the suite
before adding any new test — same 4 failures, same cause) and affects four different stages'
route tests equally, not just Stage 5. It is documented in the project's own
`STAGE5_REPORT.md`/`AGORA_VOICE_REPORT.md` as a known sandbox limitation. **Run `npm install`
in an environment with registry access, then re-run `npm test` in `Backend/`, to get a real
HTTP-level pass/fail for these four files.**

## 8. Real-world manual verification checklist
Everything below **requires live provider credentials/network** and cannot be executed in this
sandbox. None of it should be read as "passing" until you run it yourself.

**Apple Sign In**
1. Configure `socialConfig.apple.audience` to your real Apple Services ID / bundle ID.
2. From a real device/app, complete Sign in with Apple and capture the real `identityToken`.
3. POST it to `/auth/social/apple` with a valid `consentVersion`.
   - Expect `200` with an `account`/`session`/`accessToken`.
   - Re-run with the token's last character altered → expect `401 invalid Apple token signature`.
   - Wait for the token to expire (or use an old captured one) → expect `401`.
   - Use a token issued for a different Apple app/audience → expect `401`.

**Google**
1. Configure Google OAuth so you can obtain a real `access_token`.
2. POST it to `/auth/social/google`. Expect `200` and a stable `subject` (Google `sub`) across
   repeated logins for the same account.
3. POST an expired/revoked token → expect `401`.

**Facebook**
1. Same shape as Google, via `/auth/social/facebook`, using a real Facebook access token.
2. Confirm a revoked/invalid token → `401`.

**HTTP-level regression (blocked here, see §7)**
Once `npm install` succeeds in a networked environment, run `npm test` in `Backend/` and
confirm `auth.routes.test.js` (and the other 3 currently-blocked files) pass for real over
HTTP, not just via the in-process unit tests added in this task.

## 9. Scope protection confirmation
```
diff -rq <fresh re-extraction of the uploaded ZIP> <working project after this task>
```
Output: **only** `Backend/test/stage5-provider-verification.test.js` is new. Nothing else in
the project — including Stage 25 and Stage 23 files — was touched.

## 10. Final honest status
- Production Apple/Google/Facebook verification code: already real and correct; unchanged.
- Automated unit coverage for that code: was a real gap; now closed (23 new tests, all passing,
  including a test that proves genuine ECDSA signature acceptance, not just rejection).
- Full Backend suite: 1043/1047 passing; the 4 failures are pre-existing, environmental
  (`express` not installable offline), and identical to the pre-task baseline — not Stage 5
  regressions.
- Full Mobile suite: 81/81 passing.
- `node --check`: clean.
- What is **not** verified here, and genuinely can't be from this sandbox: real provider tokens
  against real Apple/Google/Facebook endpoints, and the 4 HTTP route-test files that need
  `express` installed. See the checklist in §8.

**STAGE 5 — COMPLETE**

(Complete for everything achievable inside this environment: the previously-undertested
Apple/Google/Facebook verification boundary now has full, honest automated coverage with no
regressions anywhere in the project. The provider-credential and `express`-install items in
§7/§8 are explicitly flagged as external/manual, per the task's own definition of done — they
were never claimed as automatically verified.)
