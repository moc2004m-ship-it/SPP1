// Stage 4 — Config route.
//
// GET /config — the ONLY endpoint this stage requires (see
// Config/CONFIG_DESIGN.md § API structure). Deliberately simple:
//   - No DB, no external service, no auth (public, read-only app config).
//   - Error handling responds with a small, explicit error body rather
//     than a stack trace — the CLIENT owns the "what do I show while
//     this is broken" decision (its Local Safe Config), the server's
//     only job here is to say clearly that it couldn't serve a config.
//
// Versioning: the response is wrapped as { config, meta } instead of
// returning the raw config object, so a `meta.apiVersion` field can be
// bumped later without breaking clients that only read `config`.

const express = require("express");
const { getConfig } = require("../config");

const API_VERSION = "v1";
const router = express.Router();

router.get("/config", (req, res) => {
  try {
    const { config, source, errors } = getConfig();
    res.json({
      config,
      meta: {
        apiVersion: API_VERSION,
        source, // 'local-file' | 'default-fallback'
        servedAt: new Date().toISOString(),
        ...(errors && errors.length ? { warnings: errors } : {}),
      },
    });
  } catch (err) {
    // Should not happen — getConfig() is designed to never throw — but
    // if something truly unexpected occurs, fail loudly and clearly
    // instead of silently returning nothing.
    res.status(503).json({
      error: "config_unavailable",
      message: "Config could not be served. Clients should fall back to their Local Safe Config.",
    });
  }
});

module.exports = router;
