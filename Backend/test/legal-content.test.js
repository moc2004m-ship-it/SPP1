'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { TERMS_CONTENT, HELP_CONTENT } = require('../src/domain/legal-content');

test('TERMS_CONTENT is real, non-empty static content with sections', () => {
  assert.equal(typeof TERMS_CONTENT.title, 'string');
  assert.ok(TERMS_CONTENT.sections.length > 0);
  for (const section of TERMS_CONTENT.sections) {
    assert.equal(typeof section.heading, 'string');
    assert.ok(section.heading.length > 0);
    assert.equal(typeof section.body, 'string');
    assert.ok(section.body.length > 0);
  }
});

test('HELP_CONTENT is real, non-empty static content with sections', () => {
  assert.equal(typeof HELP_CONTENT.title, 'string');
  assert.ok(HELP_CONTENT.sections.length > 0);
  for (const section of HELP_CONTENT.sections) {
    assert.equal(typeof section.heading, 'string');
    assert.equal(typeof section.body, 'string');
  }
});

test('TERMS_CONTENT / HELP_CONTENT are deterministic (same reference / value on repeated require)', () => {
  const again = require('../src/domain/legal-content');
  assert.deepEqual(again.TERMS_CONTENT, TERMS_CONTENT);
  assert.deepEqual(again.HELP_CONTENT, HELP_CONTENT);
});

test('TERMS_CONTENT / HELP_CONTENT are frozen -- accidental runtime mutation is not silently accepted', () => {
  assert.ok(Object.isFrozen(TERMS_CONTENT));
  assert.ok(Object.isFrozen(HELP_CONTENT));
  assert.ok(Object.isFrozen(TERMS_CONTENT.sections));
  assert.ok(Object.isFrozen(TERMS_CONTENT.sections[0]));
});

test('TERMS_CONTENT / HELP_CONTENT each carry a real version and updatedAt', () => {
  assert.equal(typeof TERMS_CONTENT.version, 'string');
  assert.equal(typeof TERMS_CONTENT.updatedAt, 'string');
  assert.equal(typeof HELP_CONTENT.version, 'string');
  assert.equal(typeof HELP_CONTENT.updatedAt, 'string');
});
