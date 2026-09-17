'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cpRequiredForCoupleLevel,
  levelForCoupleCp,
  assertValidCoupleCp,
} = require('../src/domain/couple-level-curve');

test('cpRequiredForCoupleLevel(0) is 0', () => {
  assert.equal(cpRequiredForCoupleLevel(0), 0);
});

test('cpRequiredForCoupleLevel grows quadratically (500 * n^2)', () => {
  assert.equal(cpRequiredForCoupleLevel(1), 500);
  assert.equal(cpRequiredForCoupleLevel(2), 2000);
  assert.equal(cpRequiredForCoupleLevel(10), 50000);
});

test('cpRequiredForCoupleLevel rejects a negative or non-integer level', () => {
  assert.throws(() => cpRequiredForCoupleLevel(-1), (e) => e.status === 400);
  assert.throws(() => cpRequiredForCoupleLevel(1.5), (e) => e.status === 400);
});

test('levelForCoupleCp(0) is 0', () => {
  assert.equal(levelForCoupleCp(0), 0);
});

test('levelForCoupleCp returns the exact level at a threshold boundary', () => {
  assert.equal(levelForCoupleCp(500), 1);
  assert.equal(levelForCoupleCp(499), 0);
  assert.equal(levelForCoupleCp(2000), 2);
  assert.equal(levelForCoupleCp(1999), 1);
});

test('levelForCoupleCp never overshoots for a value between two thresholds', () => {
  assert.equal(levelForCoupleCp(2500), 2); // level 3 requires 4500
  assert.equal(levelForCoupleCp(4499), 2);
  assert.equal(levelForCoupleCp(4500), 3);
});

test('levelForCoupleCp handles a large cp value correctly', () => {
  const cp = 500 * 50 * 50; // exact threshold for level 50
  assert.equal(levelForCoupleCp(cp), 50);
  assert.equal(levelForCoupleCp(cp - 1), 49);
});

test('levelForCoupleCp rejects a negative or non-integer cp', () => {
  assert.throws(() => levelForCoupleCp(-1), (e) => e.status === 400);
  assert.throws(() => levelForCoupleCp(1.5), (e) => e.status === 400);
});

test('assertValidCoupleCp accepts zero and rejects invalid values', () => {
  assert.doesNotThrow(() => assertValidCoupleCp(0));
  assert.throws(() => assertValidCoupleCp(-5), (e) => e.status === 400);
  assert.throws(() => assertValidCoupleCp('5'), (e) => e.status === 400);
});
