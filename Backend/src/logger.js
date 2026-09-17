// Centralized logger — structured JSON logs from day one.
// In dev: pretty-printed to stdout.
// In staging/production: raw JSON to stdout, which your log shipper
// (Grafana Loki agent, Better Stack, Datadog agent, CloudWatch agent, etc.)
// tails and forwards to a centralized log store.
//
// Set LOG_DRAIN_URL to also POST logs directly to a log ingestion endpoint
// (e.g. Better Stack / Logtail source token URL) — useful when you don't
// want to run a separate shipping agent yet.

const pino = require('pino');
const { Writable } = require('stream');

const env = process.env.NODE_ENV || 'development';
const logDrainUrl = process.env.LOG_DRAIN_URL;

// Best-effort shipping to a centralized log drain (Better Stack/Logtail/etc).
// This must NEVER throw or block the app — a drain outage should never take
// the backend down. Failures are swallowed silently on purpose.
function buildDrainStream(url) {
  return new Writable({
    write(chunk, _encoding, callback) {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: chunk,
      }).catch(() => {
        // Intentionally ignored — see comment above.
      });
      callback();
    },
  });
}

function buildStreams() {
  const streams = [];

  if (env === 'development') {
    // pino-pretty is a devDependency — only ever required in development.
    const pretty = require('pino-pretty');
    streams.push({ stream: pretty({ colorize: true }) });
  } else {
    streams.push({ stream: process.stdout });
  }

  if (logDrainUrl) {
    streams.push({ stream: buildDrainStream(logDrainUrl) });
  }

  return streams;
}

const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    base: { service: 'backend', env },
  },
  pino.multistream(buildStreams())
);

module.exports = logger;
