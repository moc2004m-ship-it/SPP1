// Same pattern/limitation as accounts.routes.test.js: builds a minimal
// express app instead of requiring src/index.js (which calls
// app.listen() as a side effect). Needs `express` installed — see
// Config/STAGE4_REPORT.md for why this could not actually be executed
// in the current offline sandbox.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const configRouter = require('../src/routes/config.routes');

function buildTestApp() {
  const app = express();
  app.use(configRouter);
  return app;
}

async function withServer(fn) {
  const app = buildTestApp();
  const server = app.listen(0);
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

test('GET /config returns a validated config with meta', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/config`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.config);
    assert.equal(body.meta.apiVersion, 'v1');
    assert.ok(['local-file', 'default-fallback'].includes(body.meta.source));
    assert.ok(body.meta.servedAt);
  });
});

test('GET /config exposes supported languages and default onboarding slides', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/config`);
    const body = await res.json();
    assert.ok(body.config.languages.supported.includes('ar'));
    assert.ok(body.config.languages.supported.includes('en'));
    assert.ok(body.config.onboarding.slides.length > 0);
  });
});
