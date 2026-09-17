const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const { validateConfig } = require('../src/config/config.schema');

function freshServiceModule() {
  // Each test gets its own copy of the module cache so `cached` inside
  // config.service.js starts empty and doesn't leak between tests.
  delete require.cache[require.resolve('../src/config/config.service')];
  return require('../src/config/config.service');
}

test('getConfig() returns the real local-config.json, validated, on a clean run', () => {
  const { getConfig } = freshServiceModule();
  const result = getConfig({ forceRefresh: true });
  assert.equal(result.source, 'local-file');
  assert.deepEqual(result.errors, []);
  const { valid } = validateConfig(result.config);
  assert.equal(valid, true);
});

test('getConfig() caches — a second call without forceRefresh returns the same object', () => {
  const { getConfig } = freshServiceModule();
  const first = getConfig({ forceRefresh: true });
  const second = getConfig();
  assert.equal(first, second);
});

test('getConfig() falls back to DEFAULT_CONFIG if local-config.json is missing', (t) => {
  const svc = freshServiceModule();
  const { DEFAULT_CONFIG } = require('../src/config/config.schema');

  // Point LOCAL_CONFIG_PATH-like behavior by temporarily renaming the
  // real file, run against a guaranteed-missing path via a fresh module
  // load with a monkey-patched fs.readFileSync scoped to this test only.
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = (p, ...args) => {
    if (p === svc.LOCAL_CONFIG_PATH) {
      throw Object.assign(new Error('ENOENT: simulated missing file'), { code: 'ENOENT' });
    }
    return originalReadFileSync(p, ...args);
  };

  try {
    const result = svc.getConfig({ forceRefresh: true });
    assert.equal(result.source, 'default-fallback');
    assert.deepEqual(result.config, DEFAULT_CONFIG);
    assert.ok(result.errors[0].includes('unreadable'));
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
});

test('getConfig() falls back to DEFAULT_CONFIG if local-config.json contains invalid JSON', () => {
  const svc = freshServiceModule();
  const { DEFAULT_CONFIG } = require('../src/config/config.schema');

  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = (p, ...args) => {
    if (p === svc.LOCAL_CONFIG_PATH) return '{ not valid json';
    return originalReadFileSync(p, ...args);
  };

  try {
    const result = svc.getConfig({ forceRefresh: true });
    assert.equal(result.source, 'default-fallback');
    assert.deepEqual(result.config, DEFAULT_CONFIG);
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
});

test('getConfig() falls back to DEFAULT_CONFIG if the file fails schema validation', () => {
  const svc = freshServiceModule();
  const { DEFAULT_CONFIG } = require('../src/config/config.schema');

  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = (p, ...args) => {
    if (p === svc.LOCAL_CONFIG_PATH) {
      return JSON.stringify({ languages: { supported: ['ar'], default: 'fr' } });
    }
    return originalReadFileSync(p, ...args);
  };

  try {
    const result = svc.getConfig({ forceRefresh: true });
    assert.equal(result.source, 'default-fallback');
    assert.deepEqual(result.config, DEFAULT_CONFIG);
    assert.ok(result.errors.length > 0);
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
});

test('getConfig() deep-merges a partial override on top of defaults instead of replacing everything', () => {
  const svc = freshServiceModule();

  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = (p, ...args) => {
    if (p === svc.LOCAL_CONFIG_PATH) {
      // Only override maintenance — everything else should still come
      // from DEFAULT_CONFIG after the merge.
      return JSON.stringify({ maintenance: { enabled: true, messageKey: 'splash.maintenance.body' } });
    }
    return originalReadFileSync(p, ...args);
  };

  try {
    const result = svc.getConfig({ forceRefresh: true });
    assert.equal(result.source, 'local-file');
    assert.equal(result.config.maintenance.enabled, true);
    assert.equal(result.config.languages.default, 'ar'); // untouched, from DEFAULT_CONFIG
    assert.ok(Array.isArray(result.config.onboarding.slides));
    assert.ok(result.config.onboarding.slides.length > 0);
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
});
