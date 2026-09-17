'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildErrorResponseBody } = require('../src/error-response');

test('defaults to 500 when the error has no status', () => {
  const { status } = buildErrorResponseBody(new Error('boom'), 'production');
  assert.equal(status, 500);
});

test('uses err.status when it is a valid HTTP status code', () => {
  const err = Object.assign(new Error('not found'), { status: 404 });
  const { status } = buildErrorResponseBody(err, 'production');
  assert.equal(status, 404);
});

test('ignores an out-of-range err.status and falls back to 500', () => {
  const err = Object.assign(new Error('weird'), { status: 999 });
  const { status } = buildErrorResponseBody(err, 'production');
  assert.equal(status, 500);
});

test('never leaks the real error message outside development', () => {
  const err = new Error('super secret internal detail');
  const { body } = buildErrorResponseBody(err, 'production');
  assert.equal(body.message, 'An unexpected error occurred');
  assert.ok(!body.message.includes('secret'));
});

test('same: staging also gets the generic message', () => {
  const err = new Error('super secret internal detail');
  const { body } = buildErrorResponseBody(err, 'staging');
  assert.equal(body.message, 'An unexpected error occurred');
});

test('includes the real error message only in development', () => {
  const err = new Error('helpful debug detail');
  const { body } = buildErrorResponseBody(err, 'development');
  assert.equal(body.message, 'helpful debug detail');
});

test('response body always has a stable "error" field for clients to branch on', () => {
  const { body } = buildErrorResponseBody(new Error('x'), 'production');
  assert.equal(body.error, 'internal_server_error');
});

test('does not throw when given a non-Error value', () => {
  assert.doesNotThrow(() => buildErrorResponseBody(undefined, 'production'));
  assert.doesNotThrow(() => buildErrorResponseBody(null, 'production'));
  assert.doesNotThrow(() => buildErrorResponseBody('a string', 'production'));
});
