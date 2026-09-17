# Stage 23 — Part 1: Referral / Invite — COMPLETE

Scope of this part: **Referral / Invite only.** Room-in-Room (the other half
of the legacy "Stage 23" label), Stages 20/21/22, and Stage 25 were
explicitly out of scope and were **not touched**. Stages 1–19 were not
reopened or modified.

## 1. What was already implemented (found on inspection, not redone)

- `Backend/src/database/models/referral.model.js` — code generation
  (8-char, no ambiguous characters), id generation, self-referral guard,
  `REFERRAL_REWARD_COINS` constant. Already covered by
  `Backend/test/referral.model.test.js` (7/7).
- `Backend/src/feature-platform.js` — `platform.referral.{myCode,
  findByCode, hasRedeemed}`, persisted through the same generic
  stage-record store used by every other stage 6–35 domain (no dedicated
  schema/migration needed, consistent with battles/games/family). Already
  covered in `Backend/test/feature-platform.test.js`.
- `Backend/src/services/referral.service.js` — the only code path that
  redeems a code and credits the referrer's real wallet balance, with
  idempotent wallet crediting keyed off the redemption record's own id.
  Already covered by `Backend/test/referral.service.test.js` (6/6).
- Routes `GET /api/referral/my-code` and `POST /api/referral/redeem` in
  `Backend/src/routes/platform.routes.js`, wired in `Backend/src/index.js`,
  and already protected by the router-wide `requireSession` middleware —
  but with **no route-level test coverage**.
- Mobile: **nothing existed** — no UI, no buttons, no state, no test file.

## 2. What I implemented this session

1. **Backend route-contract tests** for the two referral routes — the
   session-only identity contract (no client-supplied `refereeId`/`userId`
   is ever honored), idempotent code issuance, and correct 404 (unknown
   code) / 400 (self-referral) / 409 (already redeemed) propagation. Same
   express-free "pure logic, fake req/res" style already used for every
   other route-contract test in this codebase (express is not installed in
   this sandbox — no network access to install it — matching the four
   pre-existing, already-documented environmental fails).
2. **Mobile Referral/Invite UI**, added to `Mobile/app/app.js`'s `profile()`
   screen:
   - "كود الإحالة الخاص بي" — fetches `GET /api/referral/my-code` and
     renders the real, server-issued code (idempotent: same code on every
     open, never a client-invented one).
   - "استخدام كود إحالة" — prompts for a friend's code (same single-field
     `prompt()` pattern already used for every other write action on this
     screen) and posts it to `POST /api/referral/redeem`; the referee's
     identity is always the session's own account, never sent by the
     client. Any real server rejection (unknown code, self-referral,
     already redeemed) surfaces verbatim via toast — never a fake success.
3. **Mobile tests** for both of the above, using the same `node:vm`
   sandbox technique as the existing `app.battles.stage18.test.js`: load
   the real `app.js`, mock `document`/`fetch`/`sessionStorage`/`prompt`,
   and exercise the real functions.

No parallel architecture was introduced — both additions reuse the
existing `platform.referral.*` / `referralService.redeem()` /
`api()`/`resultCard()`/`toast()` patterns already established by the
surrounding stages.

## 3. Files changed / created

**New:**
- `Backend/test/platform.referral.routes-contract.test.js`
- `Mobile/app/test/app.referral.stage23.test.js`

**Modified:**
- `Mobile/app/app.js` (added `referralCodeCard()`, `renderMyReferralCode()`,
  two new buttons and their click handlers in `profile()`)

**Not touched:** every other file in the project, including all
Room-in-Room code (there is none — it was never implemented and was not
started here), Stages 20/21/22, Stage 25, and all Stage 1–19 code.

## 4. Tests added

- 8 backend route-contract tests (`platform.referral.routes-contract.test.js`)
- 5 mobile functional tests (`app.referral.stage23.test.js`)

## 5. Verified test results

- `node --check`: **clean** on all new/modified files
  (`Mobile/app/app.js`, `Mobile/app/test/app.referral.stage23.test.js`,
  `Backend/test/platform.referral.routes-contract.test.js`)
- Referral route-contract tests: **8/8 pass**
- Referral mobile tests: **5/5 pass**
- Full Mobile suite (`node --test Mobile/app/test/*.test.js`): **63/63 pass**
- Full Backend suite (`node --test Backend/test/*.test.js`): **947/951
  pass**, re-run 3 consecutive times with identical results. The 4
  failures are the same pre-existing, already-documented environmental
  fails (`accounts.routes.test.js`, `agora.routes.test.js`,
  `auth.routes.test.js`, `config.routes.test.js` — all require `express`,
  which is not installed and cannot be installed with no network access in
  this sandbox). No new failures were introduced.

## 6. Honesty note

Room-in-Room, Stage 20/21/22, and Stage 25 were **not implemented, not
designed, and not touched** in this session or this part. Stages 1–19
were not reopened. This report covers Referral/Invite only, as scoped.

## Status

**Stage 23 Part 1 — Referral / Invite: COMPLETE**
