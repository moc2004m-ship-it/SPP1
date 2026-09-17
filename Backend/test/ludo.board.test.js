'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ABS_TRACK_LENGTH,
  HOME_REL_POS,
  BASE,
  START_OFFSETS,
  SAFE_SQUARES,
  isSafeSquare,
  absoluteSquare,
  computeMove,
} = require('../src/domain/ludo.board');

test('computeMove: a token in base needs exactly a 6 to leave', () => {
  const withSix = computeMove(BASE, 6);
  assert.equal(withSix.valid, true);
  assert.equal(withSix.newRelPos, 0);
  assert.equal(withSix.enteredBoard, true);

  const withoutSix = computeMove(BASE, 5);
  assert.equal(withoutSix.valid, false);
});

test('computeMove: a normal move on the track just advances by the die', () => {
  const move = computeMove(10, 4);
  assert.equal(move.valid, true);
  assert.equal(move.newRelPos, 14);
  assert.equal(move.finished, false);
});

test('computeMove: landing exactly on relPos 56 finishes the token', () => {
  const move = computeMove(50, 6);
  assert.equal(move.valid, true);
  assert.equal(move.newRelPos, HOME_REL_POS);
  assert.equal(move.finished, true);
});

test('computeMove: overshooting home is illegal (exact-finish rule, same as Snakes & Ladders)', () => {
  const move = computeMove(53, 5); // 53 + 5 = 58 > 56
  assert.equal(move.valid, false);
});

test('computeMove: a token that has already finished can never move again', () => {
  const move = computeMove(HOME_REL_POS, 3);
  assert.equal(move.valid, false);
});

test('absoluteSquare: base and home-column tokens have no shared board square', () => {
  assert.equal(absoluteSquare(BASE, 0), null);
  assert.equal(absoluteSquare(51, 0), null); // inside home column
  assert.equal(absoluteSquare(HOME_REL_POS, 0), null);
});

test('absoluteSquare: each color starts at its own offset and wraps around the shared 52-square track', () => {
  assert.equal(absoluteSquare(0, 0), START_OFFSETS[0]);
  assert.equal(absoluteSquare(0, 1), START_OFFSETS[1]);
  assert.equal(absoluteSquare(0, 2), START_OFFSETS[2]);
  assert.equal(absoluteSquare(0, 3), START_OFFSETS[3]);
  // color 3 starting at 39, moving 20 wraps past square 51 back to 7.
  assert.equal(absoluteSquare(20, 3), (39 + 20) % ABS_TRACK_LENGTH);
});

test('isSafeSquare: every declared safe square reports true, everything else false', () => {
  for (const sq of SAFE_SQUARES) assert.equal(isSafeSquare(sq), true);
  assert.equal(isSafeSquare(1), false);
  assert.equal(isSafeSquare(50), false);
});
