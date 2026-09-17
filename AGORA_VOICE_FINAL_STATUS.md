# Agora Voice — Final Status (this session)

## What "App ID" value was used
`AGORA_APP_ID=782b5a107daf4ced943efdbc997bb2c7` — wired into env only, never into
source code, never into Mobile.

## The second value you pasted ("App Config")
**Not used anywhere.** You labeled it ambiguously and it looked like it could be an
Agora App Certificate or a separate Customer ID/Secret pair. Since mixing it up would
be worse than leaving it out, it was left out entirely and never written to any file,
env, or log in this project.

**Action needed from you regardless of what it is:** if that value was ever meant to be
secret, treat it as burned because it was typed into this chat. Go to Agora Console
(or wherever it came from) and regenerate/rotate it, then set the real value yourself
directly in your real host's env/secrets panel — never paste a secret into a chat again.

## Where AGORA_APP_ID was placed
| File | Change |
|---|---|
| `Backend/.env` (new) | Real value set, for direct `node --env-file=.env src/index.js` / `npm start` runs. `AGORA_APP_CERTIFICATE=` left blank on purpose. |
| `Backend/.env.example` | Documented the three var names (no real values — this file is meant to be committed). |
| `environments/development.env` | Real App ID value added (matches this file's existing convention of holding real dev values). |
| `environments/staging.env` | Real App ID value added; certificate left as a comment pointing to the CI/CD secrets panel, matching the existing `LOG_DRAIN_URL` pattern in this file. |
| `environments/production.env` | Same pattern as staging. |
| `.gitignore` (new, repo root) | Added — this repo had **no `.gitignore` at all** before this session, so nothing stopped `.env` from being committed. Now `.env`, `.env.*.local`, and `node_modules/` are excluded. |

**App Certificate was not placed anywhere** — it isn't in any file above. That's the one
value that has to come from you, entered directly on your real host, per the step below.

## The one step only you can do
1. Open the Agora Console project that owns App ID `782b5a107daf4ced943efdbc997bb2c7`,
   confirm **Authentication mode = "App ID + App Certificate (Secured mode)"**.
2. Copy the **App Certificate** from that page.
3. Set it as `AGORA_APP_CERTIFICATE` directly in whatever your real Backend host uses
   for secrets (hosting provider's env panel, CI/CD secrets store, or a local `.env`
   you keep out of git) — **do not send it to me, do not paste it in any chat.**
4. Restart the Backend process so it picks up the new env var.

Everything else below was already done without needing that value.

## Tests run this session (in this sandbox)

| Suite | Result |
|---|---|
| `Backend/test/agora.config.test.js` | **22/22 PASS** (combined with token-service + room-access, dependency-free, no install needed) |
| `Mobile/app/test/agora-voice-client.test.js` | **10/10 PASS** (dependency-free) |
| `node --check` on `Backend/src/index.js` and the whole `rtc/` tree | **PASS** — no syntax errors after the env wiring |
| Route code review (`agora.routes.js`) | Confirmed: identity always from `req.session.accountId`, role always server-decided, no fake/mock/static token path exists — every failure path (missing config, missing package, unauthorized) returns a real error, never a placeholder token |

## BLOCKED — and why, plainly

| Item | Status | Reason |
|---|---|---|
| `npm install` (to actually get the real `agora-token` package on disk) | **BLOCKED** | This sandbox has **no network egress at all** (confirmed again this session: `npm install` → `403 Forbidden` from `registry.npmjs.org`, and a direct `curl` to any host outside the allowlist is rejected outright). This is an environment limit, not a code problem. |
| `POST /platform/api/rtc/token` HTTP-level tests (need `express` installed) | **BLOCKED** | Same cause — `express` isn't installed here either, for the same reason as every other route test file in this repo. |
| Generating one real Agora token and verifying it against Agora's servers | **BLOCKED** | Needs both the real `AGORA_APP_CERTIFICATE` (which correctly was never given to me) and outbound network access to Agora — neither exists in this sandbox. |
| A live Host-joins / Audience-joins voice test | **BLOCKED** | Needs a running Backend process with the real certificate set, real network, and a real browser — none of which this sandbox has. This has to happen on your actual server/device, not here. |

**Nothing here was faked to look done.** The token-generation logic, the
identity/role/authorization enforcement, and the Mobile wrapper's join/leave/mute logic
are all real code, already exercised by 32 passing dependency-free tests. What's blocked
is strictly the parts that require a real network connection to Agora's infrastructure —
that can only be verified from your real environment.

## To actually verify it end-to-end, from your side
```bash
cd Backend
npm install          # picks up agora-token now that it's declared in package.json
```
Set `AGORA_APP_CERTIFICATE` on the real host (step above), restart the Backend, then:
```bash
curl -X POST https://your-real-host/platform/api/rtc/token \
  -H "Authorization: Bearer <a real session token>" \
  -H "Content-Type: application/json" \
  -d '{"roomId":"<a real room id>"}'
```
A 200 with a real `token` field confirms the token endpoint is alive — do this before
testing the browser SDK, since it isolates "is the endpoint working" from "does the
Agora Web SDK connect." Then open `Mobile/app/index.html` through that same real host
and use "دخول صوتي لغرفة" as host from one session and "audience" from another to do the
real two-party test.
