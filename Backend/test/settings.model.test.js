'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SETTING_KEYS,
  NETWORK_MODES,
  DEFAULT_SETTINGS,
  validateSettingValue,
  generateSettingId,
} = require('../src/database/models/settings.model');
const { DEFAULT_CONFIG } = require('../src/config/config.schema');

test('SETTING_KEYS is exactly the five real Stage 34 preference keys', () => {
  assert.deepEqual([...SETTING_KEYS].sort(), ['language', 'media', 'mic', 'network', 'sound']);
});

test('generateSettingId produces a unique, prefixed id', () => {
  const a = generateSettingId();
  const b = generateSettingId();
  assert.match(a, /^set_/);
  assert.notEqual(a, b);
});

// --- valid keys / values -----------------------------------------------

test('validateSettingValue accepts a real supported language and returns it unchanged', () => {
  const lang = DEFAULT_CONFIG.languages.supported[0];
  assert.equal(validateSettingValue('language', lang), lang);
});

test('validateSettingValue accepts real booleans for sound/mic/media', () => {
  assert.equal(validateSettingValue('sound', true), true);
  assert.equal(validateSettingValue('sound', false), false);
  assert.equal(validateSettingValue('mic', true), true);
  assert.equal(validateSettingValue('media', false), false);
});

test('validateSettingValue accepts every real NETWORK_MODES value', () => {
  for (const mode of NETWORK_MODES) {
    assert.equal(validateSettingValue('network', mode), mode);
  }
});

// --- invalid keys rejected ----------------------------------------------

test('validateSettingValue rejects an unknown key with a real 400', () => {
  assert.throws(() => validateSettingValue('not_a_real_key', true), (e) => e.status === 400);
});

// --- invalid values rejected ---------------------------------------------

test('validateSettingValue rejects an unsupported language string', () => {
  assert.throws(() => validateSettingValue('language', 'klingon'), (e) => e.status === 400);
});

test('validateSettingValue rejects a non-boolean for sound/mic/media', () => {
  assert.throws(() => validateSettingValue('sound', 'yes'), (e) => e.status === 400);
  assert.throws(() => validateSettingValue('mic', 1), (e) => e.status === 400);
  assert.throws(() => validateSettingValue('media', null), (e) => e.status === 400);
});

test('validateSettingValue rejects an unknown network mode', () => {
  assert.throws(() => validateSettingValue('network', 'satellite'), (e) => e.status === 400);
});

// --- real defaults ---------------------------------------------------------

test('DEFAULT_SETTINGS has an entry for every SETTING_KEYS key', () => {
  for (const key of SETTING_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key), `missing default for ${key}`);
  }
});

test('DEFAULT_SETTINGS.language matches the real Stage 4 default language, not an invented one', () => {
  assert.equal(DEFAULT_SETTINGS.language, DEFAULT_CONFIG.languages.default);
});

test('every DEFAULT_SETTINGS value independently passes validateSettingValue for its own key', () => {
  for (const key of SETTING_KEYS) {
    assert.doesNotThrow(() => validateSettingValue(key, DEFAULT_SETTINGS[key]));
  }
});
