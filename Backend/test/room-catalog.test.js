'use strict';
// Stage 12 — Create Room: domain/room-catalog.js.
// Same style as chat-catalog.test.js/guard-catalog.test.js: every fixed
// enum resolves to itself when valid, defaults when omitted, and throws
// a 400 for an unknown key -- never silently falls back to a default
// for a value the client actually supplied.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ROOM_THEMES, ROOM_CATEGORIES, ROOM_LANGUAGES, ROOM_AGE_RULES,
  DEFAULT_THEME, DEFAULT_CATEGORY, DEFAULT_LANGUAGE, DEFAULT_AGE_RULE,
  resolveTheme, resolveCategory, resolveLanguage, resolveAgeRule,
} = require('../src/domain/room-catalog');

test('ROOM_THEMES/ROOM_CATEGORIES/ROOM_LANGUAGES/ROOM_AGE_RULES and every entry are frozen', () => {
  assert.ok(Object.isFrozen(ROOM_THEMES));
  assert.ok(Object.isFrozen(ROOM_CATEGORIES));
  assert.ok(Object.isFrozen(ROOM_LANGUAGES));
  assert.ok(Object.isFrozen(ROOM_AGE_RULES));
  for (const theme of Object.values(ROOM_THEMES)) assert.ok(Object.isFrozen(theme));
  for (const category of Object.values(ROOM_CATEGORIES)) assert.ok(Object.isFrozen(category));
  for (const language of Object.values(ROOM_LANGUAGES)) assert.ok(Object.isFrozen(language));
  for (const rule of Object.values(ROOM_AGE_RULES)) assert.ok(Object.isFrozen(rule));
});

test('resolveTheme(): omitted/null -> DEFAULT_THEME; known id -> itself; unknown id -> 400', () => {
  assert.equal(resolveTheme(undefined), DEFAULT_THEME);
  assert.equal(resolveTheme(null), DEFAULT_THEME);
  assert.equal(resolveTheme('ocean'), 'ocean');
  assert.throws(() => resolveTheme('does_not_exist'), (err) => err.status === 400 && /theme must be one of/.test(err.message));
});

test('resolveCategory(): omitted/null -> DEFAULT_CATEGORY; known id -> itself; unknown id -> 400', () => {
  assert.equal(resolveCategory(undefined), DEFAULT_CATEGORY);
  assert.equal(resolveCategory(null), DEFAULT_CATEGORY);
  assert.equal(resolveCategory('gaming'), 'gaming');
  assert.throws(() => resolveCategory('nonsense'), (err) => err.status === 400 && /category must be one of/.test(err.message));
});

test('resolveLanguage(): omitted/null -> DEFAULT_LANGUAGE; known code -> itself; unknown code -> 400', () => {
  assert.equal(resolveLanguage(undefined), DEFAULT_LANGUAGE);
  assert.equal(resolveLanguage(null), DEFAULT_LANGUAGE);
  assert.equal(resolveLanguage('fr'), 'fr');
  assert.throws(() => resolveLanguage('klingon'), (err) => err.status === 400 && /language must be one of/.test(err.message));
});

test('resolveAgeRule(): omitted/null -> DEFAULT_AGE_RULE; known id -> itself (including "18+"); unknown id -> 400', () => {
  assert.equal(resolveAgeRule(undefined), DEFAULT_AGE_RULE);
  assert.equal(resolveAgeRule(null), DEFAULT_AGE_RULE);
  assert.equal(resolveAgeRule('18+'), '18+');
  assert.throws(() => resolveAgeRule('teen'), (err) => err.status === 400 && /ageRule must be one of/.test(err.message));
});
