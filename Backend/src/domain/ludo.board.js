'use strict';
// Stage 20 — Ludo board layout + pure movement rules.
//
// Same shape as ../domain/snakes-ladders.board.js: zero I/O, zero state,
// no randomness -- the die is always rolled server-side by the stateful
// engine in ../services/ludo.service.js, which is the only real caller
// of computeMove()/absoluteSquare() below. A client never supplies a die
// value, a token's board position, or a capture outcome; it only ever
// supplies *which of its own tokens* it wants to move, and the move's
// legality/effect is always recomputed here from the server's own state.
//
// Layout (documented, standard-shape simplification, same "not final
// tuning" caveat every catalog/rules file in this project already
// carries):
//   - A single shared 52-square outer track (relative position 0..50 as
//     seen from each color's own start, wrapping via ABS_TRACK_LENGTH).
//   - Each color's own private 6-square home column (relative position
//     51..56), never shared with -- and never capturable by -- another
//     color, exactly like a real board's colored home stretch.
//   - relPos 56 means that token has finished (reached home).
//   - relPos -1 means the token is still in its base/yard.
// A token must roll a 6 to leave base. Reaching exactly relPos 56
// finishes a token; overshooting it is an illegal move (must move by the
// exact remaining amount), same "exact finish" honesty rule
// snakes-ladders.board.js already uses for square 100.

const ABS_TRACK_LENGTH = 52;
const HOME_COLUMN_LENGTH = 6;
const HOME_REL_POS = 50 + HOME_COLUMN_LENGTH; // 56 -- "finished"
const TOKENS_PER_PLAYER = 4;
const BASE = -1;

// Up to 4 colors, evenly spaced 52/4 = 13 squares apart -- classic
// layout. Colors are assigned to playerIds in join order (see
// ludo.service.js), never chosen by the client.
const START_OFFSETS = Object.freeze([0, 13, 26, 39]);

// Classic safe squares: each color's own start square plus one star
// square roughly opposite each start. A token sitting on one of these
// can never be captured, exactly like a real board's marked squares.
const SAFE_SQUARES = Object.freeze(new Set([0, 8, 13, 21, 26, 34, 39, 47]));

function isSafeSquare(square) {
  return SAFE_SQUARES.has(square);
}

// The absolute board square a token currently occupies, or null while it
// is in base (-1) or already inside its own private home column (51..56)
// -- neither of those is ever a shared, capturable square.
function absoluteSquare(relPos, colorIndex) {
  if (relPos < 0 || relPos > 50) return null;
  return (relPos + START_OFFSETS[colorIndex]) % ABS_TRACK_LENGTH;
}

// Full legality + resolution check for moving one token by `die` squares.
// Never mutates anything -- the caller (ludo.service.js) applies the
// result and handles capturing (which needs sibling/opponent state this
// pure function intentionally has no access to).
function computeMove(relPos, die) {
  if (relPos === HOME_REL_POS) {
    return { valid: false, reason: 'token has already finished' };
  }
  if (relPos === BASE) {
    if (die !== 6) return { valid: false, reason: 'need a 6 to leave base' };
    return { valid: true, fromPos: BASE, newRelPos: 0, enteredBoard: true, finished: false };
  }
  const target = relPos + die;
  if (target > HOME_REL_POS) {
    return { valid: false, reason: 'move would overshoot home; must finish on an exact roll' };
  }
  return { valid: true, fromPos: relPos, newRelPos: target, enteredBoard: false, finished: target === HOME_REL_POS };
}

module.exports = {
  ABS_TRACK_LENGTH,
  HOME_COLUMN_LENGTH,
  HOME_REL_POS,
  TOKENS_PER_PLAYER,
  BASE,
  START_OFFSETS,
  SAFE_SQUARES,
  isSafeSquare,
  absoluteSquare,
  computeMove,
};
