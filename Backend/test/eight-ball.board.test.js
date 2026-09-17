'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { BALLS_PER_GROUP, determineOutcome } = require('../src/domain/eight-ball.board');

test('BALLS_PER_GROUP matches the real 7-ball solids/stripes count', () => {
  assert.equal(BALLS_PER_GROUP, 7);
});

test('bands cover the full [1,100] range with no gap and no overlap', () => {
  const seen = new Set();
  for (let roll = 1; roll <= 100; roll++) {
    seen.add(determineOutcome(roll));
  }
  // Every roll produces exactly one of these four outcomes.
  for (let roll = 1; roll <= 100; roll++) {
    const outcome = determineOutcome(roll);
    assert.ok(['foul', 'miss', 'pot', 'pot_eight'].includes(outcome));
  }
  assert.deepEqual([...seen].sort(), ['foul', 'miss', 'pot', 'pot_eight']);
});

test('band boundaries are exactly where documented', () => {
  assert.equal(determineOutcome(1), 'foul');
  assert.equal(determineOutcome(15), 'foul');
  assert.equal(determineOutcome(16), 'miss');
  assert.equal(determineOutcome(40), 'miss');
  assert.equal(determineOutcome(41), 'pot');
  assert.equal(determineOutcome(90), 'pot');
  assert.equal(determineOutcome(91), 'pot_eight');
  assert.equal(determineOutcome(100), 'pot_eight');
});

test('rejects a roll outside [1,100] or non-integer', () => {
  assert.throws(() => determineOutcome(0), (e) => e.status === 400);
  assert.throws(() => determineOutcome(101), (e) => e.status === 400);
  assert.throws(() => determineOutcome(50.5), (e) => e.status === 400);
  assert.throws(() => determineOutcome('50'), (e) => e.status === 400);
});
