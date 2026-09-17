const test = require('node:test');
const assert = require('node:assert/strict');

const { generateUserId, generateReferenceId, isUserId, isReferenceId } = require('../src/database/id-generator');

test('generateUserId produces a usr_ prefixed id', () => {
  const id = generateUserId();
  assert.ok(isUserId(id), `expected ${id} to start with usr_`);
});

test('generateReferenceId produces a txn_ prefixed id', () => {
  const id = generateReferenceId();
  assert.ok(isReferenceId(id), `expected ${id} to start with txn_`);
});

test('generated ids are unique across many calls', () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i += 1) {
    ids.add(generateUserId());
  }
  assert.equal(ids.size, 1000);
});
