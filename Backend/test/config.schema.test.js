const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CONFIG, validateConfig, CONFIG_VERSION } = require('../src/config/config.schema');

test('DEFAULT_CONFIG is itself valid', () => {
  const { valid, errors } = validateConfig(DEFAULT_CONFIG);
  assert.equal(valid, true, `expected DEFAULT_CONFIG to be valid, got errors: ${errors.join(', ')}`);
});

test('DEFAULT_CONFIG exposes the current CONFIG_VERSION', () => {
  assert.equal(DEFAULT_CONFIG.configVersion, CONFIG_VERSION);
});

test('rejects a non-object config', () => {
  assert.equal(validateConfig(null).valid, false);
  assert.equal(validateConfig(undefined).valid, false);
  assert.equal(validateConfig('not-an-object').valid, false);
});

test('rejects a default language not present in supported languages', () => {
  const bad = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  bad.languages.default = 'fr';
  const { valid, errors } = validateConfig(bad);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('languages.default')));
});

test('rejects an empty supported-languages array', () => {
  const bad = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  bad.languages.supported = [];
  assert.equal(validateConfig(bad).valid, false);
});

test('rejects a non-semver version string', () => {
  const bad = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  bad.version.minimumSupported = 'v1';
  assert.equal(validateConfig(bad).valid, false);
});

test('rejects a non-boolean maintenance.enabled', () => {
  const bad = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  bad.maintenance.enabled = 'yes';
  assert.equal(validateConfig(bad).valid, false);
});

test('rejects an onboarding slide missing a titleKey/bodyKey', () => {
  const bad = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  bad.onboarding.slides = [{ id: 'slide1' }];
  const { valid, errors } = validateConfig(bad);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('titleKey')));
  assert.ok(errors.some((e) => e.includes('bodyKey')));
});

test('rejects an empty onboarding.slides array', () => {
  const bad = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  bad.onboarding.slides = [];
  assert.equal(validateConfig(bad).valid, false);
});

test('accepts a minimal valid config with a single slide', () => {
  const minimal = {
    configVersion: 1,
    app: { nameKey: 'app.name' },
    languages: { supported: ['en'], default: 'en' },
    maintenance: { enabled: false, messageKey: 'splash.maintenance.body' },
    version: { minimumSupported: '1.0.0', latestRecommended: '1.0.0' },
    featureFlags: { onboardingEnabled: false },
    onboarding: {
      skipEnabled: true,
      slides: [{ id: 's1', titleKey: 'a', bodyKey: 'b' }],
    },
  };
  const { valid, errors } = validateConfig(minimal);
  assert.equal(valid, true, `expected minimal config to be valid, got: ${errors.join(', ')}`);
});
