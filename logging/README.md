# Centralized Logs — Stage 1

# Centralized Logs — Stage 1

The backend already emits structured JSON logs for every request and startup
event (`Backend/src/logger.js`, using `pino`), and **already ships them**
automatically to `LOG_DRAIN_URL` if that variable is set (POST per log line,
non-blocking, never crashes the app if the drain is unreachable). No code
change is needed to activate this — it only needs a real URL.

**[External Setup — Deferred]** To make logs centralized (searchable in one
place across all instances), pick one path:

## Option A — Managed log drain (fastest, recommended for Stage 1)
1. Create a free account with a log ingestion service (e.g. Better Stack,
   Logtail, or your cloud provider's built-in log drain).
2. Get the ingestion token/URL.
3. Set `LOG_DRAIN_URL` as an environment variable / CI secret for Staging
   and Production.
4. Point your process manager or platform's log drain feature at stdout —
   most PaaS providers (Render, Fly.io, Railway) forward container stdout
   to a log drain automatically once configured in their dashboard.

## Option B — Self-hosted stack
Run Grafana Loki + Promtail (or the ELK stack) and have Promtail tail the
container's stdout/stderr. Heavier to operate — usually not worth it for
Stage 1.

## What "Definition of Done" requires
- [x] Backend logs in structured JSON — **done** (`pino`).
- [x] Code that ships logs to a drain when configured — **done**
      (`Backend/src/logger.js`).
- [ ] Logs from Development/Staging/Production reach ONE centralized place —
      **External Setup — Deferred**: requires a real account/URL from
      Option A or B above, which cannot be created from inside the project
      files.
