'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { BOARD_SIZE, LADDERS, SNAKES, rollLandsOn, resolveSquare, applyMove } = require('../src/domain/snakes-ladders.board');

test('rollLandsOn: normal move advances by the die value', () => {
  assert.equal(rollLandsOn(10, 4), 14);
});

test('rollLandsOn: overshooting square 100 does not move the player (exact-finish rule)', () => {
  assert.equal(rollLandsOn(98, 6), 98);
  assert.equal(rollLandsOn(95, 5), 100);
});

test('resolveSquare: a ladder square sends the player up, unresolved squares are unchanged', () => {
  assert.deepEqual(resolveSquare(1), { square: LADDERS[1], type: 'ladder' });
  assert.deepEqual(resolveSquare(2), { square: 2, type: null });
});

test('resolveSquare: a snake square sends the player down', () => {
  assert.deepEqual(resolveSquare(16), { square: SNAKES[16], type: 'snake' });
});

test('applyMove: landing exactly on 100 is a real win', () => {
  const move = applyMove(94, 6);
  assert.equal(move.finalPos, BOARD_SIZE);
  assert.equal(move.won, true);
});

test('applyMove: landing on a ladder/snake square resolves in the same move (single hop)', () => {
  const move = applyMove(0, 1); // lands on square 1, a ladder to 38
  assert.equal(move.landedOn, 1);
  assert.equal(move.finalPos, LADDERS[1]);
  assert.equal(move.hop, 'ladder');
  assert.equal(move.won, false);
});

test('every ladder points strictly upward and every snake points strictly downward', () => {
  for (const [from, to] of Object.entries(LADDERS)) assert.ok(to > Number(from), `ladder ${from}->${to} must go up`);
  for (const [from, to] of Object.entries(SNAKES)) assert.ok(to < Number(from), `snake ${from}->${to} must go down`);
});
