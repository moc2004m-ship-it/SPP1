'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { START_REGULAR_PIECES, POINTS, determineOutcome } = require('../src/domain/carrom-board');

test('board constants match the standard carrom setup', () => {
  assert.equal(START_REGULAR_PIECES, 18);
  assert.equal(POINTS.REGULAR, 10);
  assert.equal(POINTS.QUEEN_BONUS, 50);
  assert.equal(POINTS.FOUL_PENALTY, 5);
});

test('determineOutcome: the documented bands over [1,100] are exact and contiguous, with no gaps or overlaps', () => {
  for (let roll = 1; roll <= 15; roll += 1) assert.equal(determineOutcome(roll), 'foul');
  for (let roll = 16; roll <= 40; roll += 1) assert.equal(determineOutcome(roll), 'miss');
  for (let roll = 41; roll <= 85; roll += 1) assert.equal(determineOutcome(roll), 'pocket');
  for (let roll = 86; roll <= 100; roll += 1) assert.equal(determineOutcome(roll), 'queen');
});

test('determineOutcome: boundary values resolve to the correct side of each band', () => {
  assert.equal(determineOutcome(15), 'foul');
  assert.equal(determineOutcome(16), 'miss');
  assert.equal(determineOutcome(40), 'miss');
  assert.equal(determineOutcome(41), 'pocket');
  assert.equal(determineOutcome(85), 'pocket');
  assert.equal(determineOutcome(86), 'queen');
  assert.equal(determineOutcome(100), 'queen');
});

test('determineOutcome: rejects a roll outside [1,100] instead of silently clamping it', () => {
  assert.throws(() => determineOutcome(0), (e) => e.status === 400);
  assert.throws(() => determineOutcome(101), (e) => e.status === 400);
  assert.throws(() => determineOutcome(-5), (e) => e.status === 400);
});

test('determineOutcome: rejects a non-integer roll instead of silently truncating it', () => {
  assert.throws(() => determineOutcome(50.5), (e) => e.status === 400);
  assert.throws(() => determineOutcome(NaN), (e) => e.status === 400);
  assert.throws(() => determineOutcome('50'), (e) => e.status === 400);
});
