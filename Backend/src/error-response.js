// Stage 1 — Basic Logs / Error Handling.
//
// Pure, dependency-free helper for turning a thrown/passed error into an
// HTTP status + JSON body. Split out from src/index.js so it can be unit
// tested without needing express installed (see test/error-response.test.js).
'use strict';

/**
 * @param {Error & { status?: number }} err
 * @param {string} env - process.env.NODE_ENV value ('development', 'staging', 'production', ...)
 * @returns {{ status: number, body: { error: string, message: string } }}
 */
function buildErrorResponseBody(err, env) {
  const status = (err && typeof err.status === 'number' && err.status >= 100 && err.status < 600)
    ? err.status
    : 500;

  const message = env === 'development' && err && err.message
    ? err.message
    : 'An unexpected error occurred';

  return {
    status,
    body: {
      error: 'internal_server_error',
      message,
    },
  };
}

module.exports = { buildErrorResponseBody };
