'use strict';
// Stage 21 — Snakes & Ladders board layout + pure movement rules.
//
// Server-only concern: a client never supplies a die value or a landing
// square -- both are always computed by the stateful engine in
// ../services/snakes-ladders.service.js (rollDice()), which is the only
// caller of applyMove() below. This file itself has zero I/O and zero
// state -- it is a pure rules layer, the same "fixed data + pure
// functions, no state" shape game-catalog.js already uses for the game
// registry.

const BOARD_SIZE = 100;

// Classic public-domain Snakes & Ladders layout (one of the standard
// 10-ladder/10-snake sets used across most physical boards). Keys are the
// square a player must land ON exactly to trigger the ladder/snake;
// values are where it sends them. Not secret -- unlike the quiz answer
// key, there is nothing to hide here; a client may see this whole layout.
const LADDERS = Object.freeze({ 1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100 });
const SNAKES = Object.freeze({ 16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78 });

// A roll that would overshoot square 100 does not move the player at all
// -- the classic "exact finish" rule most physical sets use. This is a
// documented, intentional simplification (same "not final tuning" caveat
// every other catalog/rules file in this project carries): there is no
// extra roll on a 6 and no bounce-back-from-overshoot variant. Both could
// be added later without changing the public engine API.
function rollLandsOn(fromPos, die) {
  const target = fromPos + die;
  if (target > BOARD_SIZE) return fromPos;
  return target;
}

// Resolves exactly one ladder/snake hop for a freshly-landed square.
// Deliberately never chains (landing on a ladder's own top/bottom square
// again is not re-resolved) -- classic single-hop rule.
function resolveSquare(square) {
  if (LADDERS[square] !== undefined) return { square: LADDERS[square], type: 'ladder' };
  if (SNAKES[square] !== undefined) return { square: SNAKES[square], type: 'snake' };
  return { square, type: null };
}

// Full move resolution for one die roll.
function applyMove(fromPos, die) {
  const landedOn = rollLandsOn(fromPos, die);
  const resolved = resolveSquare(landedOn);
  return {
    fromPos,
    die,
    landedOn,
    finalPos: resolved.square,
    hop: resolved.type, // 'ladder' | 'snake' | null
    won: resolved.square === BOARD_SIZE,
  };
}

module.exports = { BOARD_SIZE, LADDERS, SNAKES, rollLandsOn, resolveSquare, applyMove };
