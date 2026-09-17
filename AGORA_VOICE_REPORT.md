# Agora Voice / RTC Integration — Report

**Date:** 2026-09-13
**Scope of this session:** real Agora RTC token endpoint (Backend) + real Agora Web SDK
client wrapper (Mobile) for voice rooms. Nothing else touched — no Family join, games,
payments, gifts, or any other stage.

## 0. Important fact about this repo, stated plainly

`Mobile/app` is a **browser-based web client** (plain HTML/CSS/JS, no bundler, no React
Native/Flutter project exists anywhere in this repo — see `Mobile/app/index.html` and
`Mobile/app/app.js`). So "the real Agora RTC SDK" for this specific codebase is the
**official Agora Web SDK** (`AgoraRTC_N.js`), not a native mobile SDK. This is not a
downgrade of your instruction — it is what actually exists to integrate with. If a
separate native app project exists elsewhere and should also get this, say so and it can be
done as its own task.

## 1. Backend — real RTC token endpoint

New files (`Backend/src/rtc/`):

| File | Purpose |
|---|---|
| `agora-config.js` | Reads `AGORA_APP_ID` / `AGORA_APP_CERTIFICATE` / `AGORA_RTC_TOKEN_TTL_SECONDS` from `process.env` only. Never hardcodes a value, never logs the certificate. TTL is clamped to 60s–24h regardless of what's in the env. |
| `agora-sdk-loader.js` | Lazily `require()`s Agora's own **official** token package (`agora-token`, falling back to the legacy `agora-access-token` name). |
| `agora-token.service.js` | Pure, dependency-injected service that builds the token via the loaded SDK. Maps this backend's own `host`/`audience` vocabulary to Agora's `PUBLISHER`/`SUBSCRIBER`. Returns `{appId, channel, uid, role, token, ttlSeconds, expiresAt}` — **never** the certificate. |
| `agora-room-access.js` | Pure authorization: `determineRtcRole()` (owner → host, else audience) and `assertCanJoinRoomVoice()` (room must exist; a `private` room's voice is owner-only until a real membership system exists — same honest limitation already documented for Family in the previous report). |

New route (`Backend/src/routes/agora.routes.js`), mounted under `/platform` (same
`requireSession` guard as every other platform route):

```
POST /platform/api/rtc/token   body: { roomId }
  -> { ok:true, data:{ appId, channel, uid, role, token, ttlSeconds, expiresAt } }
```

- Identity is **always** `req.session.accountId` from the verified Bearer session. Any
  `userId` the client puts in the body is ignored (tested explicitly).
- Role (`host`/`audience`) is decided server-side from real room ownership — the client
  cannot request a role.
- 404 if the room doesn't exist, 403 if the room is private and the caller isn't the owner,
  503 if Agora isn't configured or the `agora-token` package isn't installed. **No
  placeholder/fake token is ever returned** in any of these cases.

### Why I did not hand-write the Agora signing algorithm

Agora's RTC token format has to match their server's verification byte-for-byte. This
sandbox has no network access (confirmed again this session — same `npm install` → `403
Forbidden` as every prior report), so there is no way to test a hand-rolled implementation
against a real Agora project. Reimplementing binary/crypto packing from memory with zero
way to verify it is exactly the kind of "looks right, silently fails" risk you told me to
avoid. Instead, the token service depends on **Agora's own maintained `agora-token`
package** — declared in `Backend/package.json` — the same pattern already used in this repo
for `pg` (Postgres): real dependency, lazily loaded, reports "not installed" honestly
instead of faking behavior.

## 2. Mobile — real Agora Web SDK integration

- `Mobile/app/index.html` now loads the official Agora Web SDK from Agora's CDN
  (`https://download.agora.io/sdk/release/AgoraRTC_N.js`) before `app.js`.
- New file `Mobile/app/rtc/agora-voice-client.js` — a thin wrapper around the real
  `window.AgoraRTC` client:
  - `join(roomId)` — calls the real backend token endpoint, then
    `AgoraRTC.createClient()` → `setClientRole()` → `client.join()`. Only a `host` publishes
    a real microphone track (`createMicrophoneAudioTrack`); `audience` only subscribes.
  - `leave()` — stops/closes the real local track and calls the real `client.leave()`.
  - `reconnect()` — re-fetches a fresh token (tokens are short-lived by design) and rejoins
    the same room.
  - `setMuted(bool)` — toggles the real local track via `setEnabled()`.
  - Remote participants (`user-published` / `user-left`) are surfaced only from Agora's own
    real events — nothing is invented client-side.
  - If `window.AgoraRTC` is missing, or the backend doesn't return a real token, every
    method **throws a real error** instead of pretending to connect.
- `Mobile/app/app.js` (additive only): profile screen gained two buttons — "دخول صوتي
  لغرفة" (voice join) and "مغادرة الصوت" (leave voice) — wired to the wrapper above and to
  the real `POST /api/rtc/token` call through the existing `api()` helper (same Bearer
  token as every other call). No existing button, screen, or test was changed.

### Architecture prepared for, not built this session (per your scope limits)

- Mic-seat *approval* (stage 14 `rooms.seat()` already records seat **requests**, not
  approvals) — today's host/audience split is the enforceable boundary; per-seat mic grants
  need a real approval endpoint first.
- Kick/remove — real moderation actions already exist
  (`POST /api/rooms/:roomId/moderation`); actually forcing an Agora client off the channel
  needs Agora's server-side "kick user" REST call, not built this session (would need its
  own token/credential handling — flagging it rather than half-building it).
- Auto-reconnect on drop — `reconnect()` exists and is callable; wiring it automatically to
  `connection-state-change === 'DISCONNECTED'` is a UI/retry-policy decision left to the
  caller (`onConnectionStateChange` callback is already exposed for this).

## 3. Tests

### Backend — dependency-free (no express), run and passing

- `test/agora.config.test.js` (6 tests) — env parsing, missing-var handling, TTL clamping.
- `test/agora.token.service.test.js` (10 tests) — config/SDK-missing errors, role mapping,
  uid is always the real accountId, **certificate never appears in the output**, expiry
  math, legacy `buildTokenWithAccount` fallback.
- `test/agora.room-access.test.js` (7 tests) — role determination, public/private room
  access rules, 404/403 cases.

### Backend — HTTP-level (needs express)

- `test/agora.routes.test.js` (6 tests) — full request/response including the
  "client-supplied userId is ignored" case, 401/403/404/503 paths.

### Mobile — dependency-free, run and passing

- `test/agora-voice-client.test.js` (10 tests) — loads the real
  `rtc/agora-voice-client.js` via `node:vm` with a fake `AgoraRTC` standing in for the real
  browser SDK; covers join-as-host (publishes track), join-as-audience (no publish), leave,
  reconnect, mute/unmute, real remote-event passthrough, and the two "must throw, not fake
  success" cases (SDK missing / backend didn't return a real token).

### Results

```
Backend : node --test test/*.test.js  → 95 tests, 91 PASS / 4 FAIL
                                          (+23 new tests: 6 config + 10 token-service +
                                           7 room-access all PASS; agora.routes.test.js's
                                           6 tests join the pre-existing "Cannot find
                                           module 'express'" failure — same cause as
                                           accounts/auth/config routes tests, now 4 files
                                           instead of 3, re-confirmed via a fresh
                                           `npm install` attempt → 403 Forbidden)

Mobile  : node --test test/*.test.js  → 30/30 PASS (was 20/20; +10 new, 0 changed, 0 removed)
```

`node --check` re-run on every file in `Backend/src`, `Backend/test`, `Backend/scripts`,
and `Mobile/app/**/*.js` — all pass.

## 4. Status — DONE / PARTIAL / BLOCKED

| Item | Status |
|---|---|
| `POST /platform/api/rtc/token` — session-guarded, server-decided identity | **DONE** — real endpoint, real tests |
| Client-supplied `userId` ignored for token identity | **DONE** — tested explicitly |
| Host/audience decided server-side from real room ownership | **DONE** — real tests |
| Room-entry authorization (exists / public-vs-private) | **DONE** — conservative default-deny for private rooms until real membership exists |
| Token has a limited lifetime, configurable via env, clamped to a safe range | **DONE** |
| App Certificate never in Mobile code, git, logs, or API responses | **DONE** — verified by grep across all shipped source, and by a test asserting it's absent from the token response |
| Agora credentials read from Backend env vars only | **DONE** |
| Mobile: real Agora Web SDK wrapper (join/leave/reconnect/mute, real remote events) | **DONE** — this repo's "Mobile" is a browser client; native-SDK equivalent would need a native project that doesn't exist here |
| Mobile UI wired to the real token endpoint (no prompts of business data invented) | **DONE** |
| Mic-seat approval / kick-from-voice / auto-reconnect policy | **NOT STARTED** — architecture points exist (seat requests, moderation endpoint, `reconnect()`/`onConnectionStateChange`), explicitly out of scope this session |
| Dependency-free authorization/config/token-service tests | **DONE** — 23 new, all passing |
| Dependency-free Mobile voice-client structure tests | **DONE** — 10 new, all passing |
| HTTP-level `/api/rtc/token` route tests | **BLOCKED** — needs express, no network to `npm install` in this sandbox (same pre-existing cause as 3 other route test files) |
| Live token verified against a real Agora project | **BLOCKED** — no network egress in this sandbox at all, and no Agora App ID/Certificate were provided to test with |
| Real browser loading the Agora Web SDK from the CDN | **BLOCKED** — same no-network reason; the `<script>` tag is in place but unfetched here |
| Real two-device voice call test | **Not started** — requires your environment (real devices/browsers + a live Backend with real Agora credentials) |
| Family join/games/payments/gifts or any other stage | **Not touched**, as instructed |

**Bottom line, stated plainly per your instruction: live voice has NOT been tested and I am
not claiming it works.** Every piece that can be verified without network access (identity
enforcement, role logic, room authorization, token-service behavior, certificate never
leaking, Mobile wrapper logic) has been, with passing tests. The parts that require a real
Agora account and real network/device access are marked BLOCKED, not claimed.

## 5. Environment variables required (names only — set the real values yourself)

On the **Backend host only** (never in Mobile, never committed):

| Variable | Required | Notes |
|---|---|---|
| `AGORA_APP_ID` | Yes | From your Agora Console project. Not secret by itself, but still only ever served to an authenticated session, never to Mobile source. |
| `AGORA_APP_CERTIFICATE` | Yes | **Secret.** From the same Agora Console project (must have App Certificate **enabled** — see step 2 below). Never put this in Mobile, git, logs, or any API response. |
| `AGORA_RTC_TOKEN_TTL_SECONDS` | No (default `3600`) | Token lifetime in seconds. Clamped server-side to 60–86400 regardless of what you set. |

Plus, install the real dependency once you have network access:
```bash
cd Backend
npm install          # now also installs agora-token, already added to package.json
```

## 6. Manual steps for you in the Agora dashboard (no passwords/secrets asked of you)

1. Go to the [Agora Console](https://console.agora.io/) and create (or open) a project.
2. In the project's settings, set the **Authentication** mode to **"App ID + App
   Certificate (Secured mode)"** — this is what makes the App Certificate exist/active so
   token-based auth is actually enforced by Agora's servers (if left on "Testing mode / App
   ID only", Agora accepts connections without a real token at all, which is not secure).
3. Copy the **App ID** and **App Certificate** from that project page yourself — I never
   ask for or need these values; just set them as `AGORA_APP_ID` / `AGORA_APP_CERTIFICATE`
   on your Backend host's environment (e.g. your hosting provider's env-var/secrets panel,
   or a local `.env` you keep out of git).
4. Restart the Backend process after setting them so it picks up the new env vars (env vars
   are read once at process start in `Backend/src/index.js`).
5. Run `npm install` in `Backend/` on a machine with real network access, so the real
   `agora-token` package gets installed (it's already declared in `package.json` — nothing
   else to edit).
6. Once that's done, `POST /platform/api/rtc/token` with a valid session Bearer token and a
   real `roomId` should return a real token — verify that first from a REST client (curl/
   Postman) before testing full voice, since that isolates "is the token endpoint alive"
   from "does the browser SDK connect."
7. For a real end-to-end test: open `Mobile/app/index.html` through your running Backend
   (so the Agora Web SDK CDN script and the app itself are same-origin/reachable), log in,
   and use the new "دخول صوتي لغرفة" button on the profile screen.

## 7. To run the tests yourself

```bash
cd Backend
npm install
npm test        # 95 tests; 91 should pass, 4 fail only if express still isn't installed
```

```bash
cd Mobile/app
node --test test/*.test.js   # 30/30 expected
```

## 8. Next decision needed from you

Per your instructions, this session stops here — Agora/Voice only, nothing else started.
Reasonable next steps once you've set the two env vars and run `npm install` for real:
mic-seat approval flow (turning stage 14's seat *requests* into real approvals tied to
voice publish permission), the Agora server-side "kick" REST call wired to the existing
moderation endpoint, or an automatic reconnect policy on `connection-state-change`. Let me
know which — or a different stage entirely.
