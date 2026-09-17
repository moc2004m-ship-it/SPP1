# STAGE 35 — PART 4/8 — WORD FILTER — FINAL REPORT

## 1. Scope

This session implemented ONLY Stage 35 Part 4/8 — Word Filter: a
centralized, deterministic, server-side profanity/forbidden-word
filtering mechanism, integrated into the real user-generated-text
content paths this audit identified as in scope. Parts 1/8 (Report),
2/8 (Block), and 3/8 (Mute) were treated as locked and were not
redesigned. Parts 5/8–8/8 (Room Moderation, Content Review, Appeals,
Customer Support) were not started, scaffolded, or referenced beyond
this document.

## 2. Existing Word Filter audit

A repository-wide search was run for: `wordFilter`, `word-filter`,
`profanity`, banned words, forbidden words, blocked words, bad words,
`content filter`, `sanitize`, moderation filter, filtered words,
`blacklist`, `allowlist`, `profanityFilter`.

Result: **no pre-existing Word Filter implementation of any kind was
found.** The only two string matches across the whole repository were
unrelated uses of the word "allowlist" (one in a `feature-platform.js`
comment about key allowlisting for room settings, one in a
`rooms.stage15.settings.test.js` comment) — neither is a profanity
filter. Word Filter is a genuinely new feature added this session, not
a consolidation of something that already existed.

## 3. Existing related systems discovered

- **Report** (`chat.service.js#reportMessage`, `chat.repository.js`) —
  lets a recipient report a specific message; unrelated to filtering
  content, and untouched except for being exercised in this stage's
  regression tests.
- **Block** (`feature-platform.js`'s `social.block/unblock/allowed`) —
  gates whether two accounts can interact at all; untouched except for
  regression testing.
- **Mute** (`feature-platform.js`'s `social.muteUser/unmuteUser/
  isUserMuted`, wired into `chat.service.js#sendMessage`'s notification
  step) — Stage 35 Part 3/8, the most recent prior change to
  `chat.service.js`. Read carefully before editing that file again (see
  section 16).
- **Room Settings** (`feature-platform.js`'s `rooms.setting()` /
  `_applyRoomSetting()`, Stage 15) — the per-key room settings update
  path, which reuses the same create-time validators
  (`room.model.js`). This meant integrating the filter into
  `room.model.js`'s validators automatically covered both the
  create-time and update-time paths from one edit (see section 5).

No word-list/config/admin-managed moderation infrastructure of any kind
existed prior to this session.

## 4. Missing pieces

Everything: the matching algorithm, the word list/config, and every
integration point had to be built from scratch.

## 5. Final architecture

```
Backend/src/domain/word-filter-catalog.js   -- word list (data only)
Backend/src/services/word-filter.service.js -- matching + rejection logic
```

Three real content paths call into `word-filter.service.js`:

1. `Backend/src/services/chat.service.js` — `sendMessage()`, for
   `text`/`emoji` message bodies.
2. `Backend/src/database/models/room.model.js` — `assertValidAnnouncement()`,
   which `feature-platform.js`'s `rooms.create()` AND `rooms.setting()`
   (via `_applyRoomSetting()`'s `'announcement'` case) both already
   called before this stage — one edit covers both create and update.
3. `Backend/src/feature-platform.js` — `profile.create()` (name + bio)
   and `rooms.create()` / `_applyRoomSetting()`'s `'name'` case (room
   name, at both create and update time).

No new endpoint, no new domain/service object beyond the filter itself,
no duplicate word list, no duplicate matching logic anywhere.

## 6. Filter algorithm / normalization

Implemented in `word-filter.service.js`. For each whitespace-delimited
chunk of the input text:

1. Unicode NFKC normalization (collapses visually-identical code point
   sequences, e.g. full-width Latin letters, to one representation).
2. Lowercasing.
3. Strip every character that is not a Unicode letter or digit — this
   is what makes punctuation *within* a single whitespace chunk
   (`b.a.d.w.o.r.d`, `b-a-d-w-o-r-d`) normalize the same as the plain
   word, while leaving whitespace-separated chunk boundaries alone.
4. Collapse every run of 2+ identical characters down to 1 — catches
   `baaaadword`/`baddword`-style padding. This also collapses ordinary
   doubled letters (`committee` → `comite`), which is harmless: the
   collapsed form is only ever compared against the same-normalized
   banned-word list, never against the original spelling of anything
   else, so it cannot manufacture a false match.

The normalized chunk is compared for **exact equality** against a
`Set` of identically-normalized banned words — not substring matching.
This is the deliberate fix for the exact case this stage's own
instructions warn about: a banned token `BADWORD` must never
auto-censor `BADWORDSOMELEGITIMATEWORD`. Word-boundary/exact-chunk
matching cannot produce that false positive.

**Honestly documented, deliberately unsupported bypasses** (see also
section 17):
- Letter-by-letter spacing across *separate* chunks (`b a d w o r d`)
  is not caught — re-segmenting single-character chunks into candidate
  words would require a much broader engine and risks false positives
  on legitimate short interjections.
- A banned word with extra characters glued on with no separator
  (`badwordxyz`) is not caught — the direct, intentional consequence of
  exact-match-per-chunk, traded off against never censoring legitimate
  words that merely contain a banned substring.
- Leetspeak-style substitution (`b4dw0rd`) is not normalized/caught —
  nothing else in this codebase's validators does character-class
  substitution mapping, and adding one here would be exactly the
  "speculative anti-bypass algorithm" this stage's instructions warn
  against over-engineering.

## 7. Word-list / configuration

`Backend/src/domain/word-filter-catalog.js` exports `BANNED_WORDS`, a
small, deliberately mundane, placeholder array (`['badword',
'forbiddenword']`). No real word list existed anywhere in the
repository to reuse (see section 2), and per this stage's own
instructions a large fabricated profanity dictionary was **not**
created. The file's header documents that a real policy list (legal/
trust-and-safety-reviewed, possibly database-backed or admin-managed
later) can replace this array without touching
`word-filter.service.js` or any of its callers — they are written
against `BANNED_WORDS` as an opaque list of strings.

## 8. Content types covered

- Private chat messages: `text` and `emoji` body content
  (`chat.service.js#sendMessage`).
- Room announcement (`room.model.js#assertValidAnnouncement`, reached
  from both `rooms.create()` and `rooms.setting()`).
- Room name (`feature-platform.js`'s `rooms.create()` and
  `_applyRoomSetting()`'s `'name'` case).
- Profile name and profile bio (`feature-platform.js`'s
  `profile.create()`, which also serves as the profile-update upsert).

## 9. Content types intentionally excluded

- **`sticker` messages** — resolve to a fixed server-side catalog id
  (`chat-catalog.js`), never arbitrary text; nothing to filter.
- **`image` messages** — carry only a validated http(s) URL, not prose.
- **Room `tags`** — short discovery keywords (max 24 chars, from a
  free-form but bounded list), not prose. Flagged here as an
  identified-but-not-integrated gap rather than integrated under time
  pressure without a clear "is a tag really 'user-generated text' the
  same way a bio is" architectural call; left for a future session/
  explicit decision rather than guessed at.
- **Room `cover`/`background`** — URLs, not text.
- **Technical/system fields** — ids, tokens, `key` (settings key
  names), `action` strings, sticker ids, image URLs — none of these are
  passed through the filter, consistent with this stage's instruction
  not to filter technical fields, IDs, or URLs.
- **Usernames/display names in Authentication** — the `Authentication/`
  directory documented in this repo is a design-doc-only stage (no
  runtime code was found there); there is no separate "username" field
  distinct from the Stage 7 profile `name` this session already covers.

## 10. Output behavior: reject / mask / replace / etc.

**Reject** (throw a `400` via `assertCleanContent()`) was chosen. No
established Word Filter behavior existed to reuse (see section 2), so
per this stage's instructions the smallest coherent behavior was
picked — and "reject with a 400" is exactly what every other validator
already integrated into these same content paths does on invalid input
(`assertValidMessagePayload`, `assertValidAnnouncement`,
`assertValidPassword`, etc.). Masking/replacement would have been a
new, unprecedented behavior pattern for this codebase; rejection is
consistent with the existing architecture. Behavior is identical across
all four integrated paths.

## 11. API / service contract

No new public route was created. `word-filter.service.js` is an
internal-only module; every integrated caller already had its own
existing route (`POST /api/chat/.../messages`, `POST /api/rooms`,
`POST /api/rooms/:roomId/settings`, `POST /api/profile`, etc. — the
actual routes are in `platform.routes.js`, not modified by this
session). The filter cannot be bypassed by calling any of those
existing routes directly, because it runs inside the service/model
layer those routes already call, not in any client-side or route-level
code.

## 12. Server-side enforcement

All four integration points are pure Node service/model functions with
no client-side counterpart to trust instead. There is no Mobile UI for
chat, rooms, or profile editing in this repository (`find Mobile
-iname "*chat*"` returns nothing), so there was no client-side-only
filtering to demote to "UX assistance only" — enforcement here already
is, and only ever was, server-side.

## 13. Chat integration

`chat.service.js#sendMessage()`: the filter runs immediately after
`assertValidMessagePayload()` normalizes the message and *before*
`chat.addMessage()` (persistence), the bus publish, and the
notification call. A message that fails the filter is never stored,
never published, never notified about. Only `text`/`emoji` types are
checked (see section 9 for why `sticker`/`image` are excluded).

## 14. Room integration

`rooms.create()` (name, announcement) and `rooms.setting()` /
`_applyRoomSetting()` (name, announcement) — both go through the same
two validators (`assertCleanContent` composed directly for `name` at
both call sites; `assertValidAnnouncement()` for announcement, which is
itself the shared choke point). No Room Moderation behavior (bans,
kicks, moderator roles/commands, disciplinary actions) was added — this
stage only ever rejects the write itself.

## 15. Other content integrations

Profile `name`/`bio` via `feature-platform.js#profile.create()`, which
also serves as the profile-update path (documented upsert behavior
predating this stage).

## 16. Mobile integration

None. No Mobile chat, room, or profile-editing UI exists in this
repository to integrate with (search performed, zero matches). Nothing
was scaffolded to fill that gap, per this stage's explicit "do not
redesign unrelated screens" instruction.

## 17. Security / bypass testing

Covered in `Backend/test/word-filter.service.test.js`:

| Case | Result |
|---|---|
| Clean text | passes |
| Exact banned word | detected |
| Case variation (upper/mixed) | detected |
| Surrounding/internal whitespace variation | detected |
| Repeated-character padding | detected |
| Punctuation attached (`badword!`, `badword,`) | detected |
| Punctuation-separated within one chunk (`b.a.d.w.o.r.d`, dashed) | detected |
| Unicode full-width variant (NFKC) | detected |
| Legitimate word containing a banned substring (`badwordsomelegitimateword`) | **NOT** censored (word-boundary matching) |
| Ordinary doubled letters (`committee`) | **NOT** a false positive |
| Empty / whitespace-only input | handled, no throw |
| Non-string input | handled, no throw |
| Excessively long clean input | handled |
| Excessively long input containing a banned word | detected |
| Letter-by-letter spacing across chunks (`b a d w o r d`) | **NOT caught** — documented limitation |
| Leetspeak substitution (`b4d`) | **NOT caught** — documented limitation |

No claim of complete anti-bypass coverage is made anywhere in code or
this report. The two unsupported cases above are named explicitly, not
omitted.

## 18. Tests added

- `Backend/test/word-filter.service.test.js` — 17 tests, the
  centralized filter in isolation.
- `Backend/test/word-filter.integration.test.js` — 18 tests, the real
  chat/profile/room integration points plus Report/Block/Mute
  regression checks.

## 19. Exact test results

- New Word Filter unit tests: **17/17 passing**.
- New Word Filter integration tests: **18/18 passing**.
- Focused regression run (chat, chat-catalog, chat.model,
  chat.repository, block contract, mute contract, moderation contract,
  room.model, rooms create/settings, room-settings contract, rooms
  routes contract, feature-platform, plus both new Word Filter files):
  **308/308 passing**.
- Full Backend suite (`node --test test/*.test.js`), before this
  stage's changes (baseline): **1169 passed / 4 failed / 1173 total**.
- Full Backend suite, after this stage's changes: **1204 passed / 4
  failed / 1208 total** (1173 pre-existing + 35 new from the two Word
  Filter test files; net **+35 passing, 0 new failing, 0 regressed**).
- The same 4 failing test files, byte-identical before and after:
  `test/accounts.routes.test.js`, `test/agora.routes.test.js`,
  `test/auth.routes.test.js`, `test/config.routes.test.js`.

## 20. Manual / in-process verification

Exercised the real path directly (not just mocked unit calls), via
`node --test` against the actual `chat.service.js` + `feature-platform.js`
+ `room.model.js` modules wired together exactly as
`word-filter.integration.test.js` sets up (`createPlatform` with a real
`FeatureStore`, a real `InMemoryChatRepository`, a real
`createChatService`) — the same "real platform, real store" precedent
`chat.service.test.js` already uses. Confirmed: a banned word is
rejected before `chat.addMessage()` ever runs (zero messages persisted
for the rejected call), the bus is never published to, and the
notification service is never called.

## 21. Failure classification

- **Word Filter implementation defects**: 0 remaining. (Two were found
  and fixed during this session: a repeated-character collapse-to-2 bug
  that missed 3-in-a-row padding — fixed by collapsing to 1; and the
  room-settings `'name'` update case initially bypassing the filter
  because it used the bare `requireString()` call instead of composing
  it with `assertCleanContent()` — fixed.)
- **Pre-existing unrelated failures**: 4 (`accounts.routes.test.js`,
  `agora.routes.test.js`, `auth.routes.test.js`,
  `config.routes.test.js`), all `Cannot find module 'express'`.
- **Environmental blockers**: the same missing-`express` issue is the
  root cause of all 4 above; confirmed present in the baseline run
  before any Word Filter code existed, so it is not something this
  session introduced or needs to fix.

## 22. Environmental blockers

`express` is not installed in this environment (`npm`/network
restrictions), matching this stage's own stated known issue. This
blocks exactly the 4 route-level test files that `require('express')`
directly; every service/model-level test (including all Word Filter
tests) runs fine without it.

## 23. Regression verification — Report

`reportMessage()` exercised directly in
`word-filter.integration.test.js` (a clean message is sent, then
reported by the recipient) — passes. `chat.service.test.js`'s own
report tests (unmodified) still pass.

## 24. Regression verification — Block

`social.block()`/`social.unblock()`/`social.allowed()` exercised
directly in `word-filter.integration.test.js` (block → message rejected
403 → unblock → message succeeds) — passes.
`platform.block.routes-contract.test.js` (unmodified) still passes.

## 25. Regression verification — Mute

`social.muteUser()` exercised directly in
`word-filter.integration.test.js`: a muted recipient still receives the
message itself (mute is confirmed to remain distinct from block), only
the notification is suppressed — passes.
`platform.mute.routes-contract.test.js` (unmodified) still passes.
`chat.service.js`'s Mute-related code (Stage 35 Part 3/8, the most
recent prior edit to this file) was read in full before this session's
edit and is untouched except for the new filter check inserted before
it in `sendMessage()`'s control flow — the notify-suppression logic
itself was not touched.

## 26. Explicit confirmation Parts 5–8 were untouched

No Room Moderation (bans, kicks, moderator roles/commands, disciplinary
actions), Content Review, Appeals, or Customer Support / FAQ / Tickets
functionality was implemented, scaffolded, or placeholder-created in
this session. The only files touched or created are listed below, all
scoped to Word Filter.

**Files created:**
- `Backend/src/domain/word-filter-catalog.js`
- `Backend/src/services/word-filter.service.js`
- `Backend/test/word-filter.service.test.js`
- `Backend/test/word-filter.integration.test.js`
- `STAGE_35_WORD_FILTER_FINAL_REPORT.md` (this file)

**Files edited (each change scoped to adding the Word Filter check —
see this report's sections 5/13/14/15 for exactly what changed in
each):**
- `Backend/src/services/chat.service.js`
- `Backend/src/database/models/room.model.js`
- `Backend/src/feature-platform.js`

No other file in the repository was modified.

## 27. Final completion status

**Stage 35 Part 4/8 — Word Filter: COMPLETE.**

- Centralized, real implementation exists (`word-filter.service.js` +
  `word-filter-catalog.js`).
- Real content paths integrated: private chat text/emoji, room
  name/announcement (create + settings-update), profile name/bio.
- Server-side enforcement confirmed (no client-side-only path exists in
  this repository to worry about).
- Deterministic behavior (pure functions, no randomness/time
  dependence).
- Security/bypass handling tested and honestly documented, including
  named unsupported cases.
- 35 new tests written and executed (17 unit + 18 integration), all
  passing.
- Full regression suite re-run: 0 new failures, the same 4 pre-existing
  environmental failures as baseline.
- Real in-process verification performed (not mocks-only).
- No placeholder/dead code remains.
- This report documents the architecture, decisions, and honest
  limitations in full.

Per this stage's scope lock: **STOPPING here. Part 5/8 (Room
Moderation) was not started.**
