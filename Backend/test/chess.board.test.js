'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cb = require('../src/domain/chess.board');

function applySquares(state, from, to, promotion) {
  const legal = cb.generateLegalMovesFrom(state, cb.squareToIndex(from));
  const move = legal.find((m) => m.to === cb.squareToIndex(to) && (!m.promotion || m.promotion === (promotion || 'q')));
  if (!move) throw new Error(`expected ${from}${to} to be legal but it was not found`);
  return cb.applyMove(state, move);
}

function destinationsFrom(state, from) {
  return cb.generateLegalMovesFrom(state, cb.squareToIndex(from)).map((m) => cb.indexToSquare(m.to)).sort();
}

function emptyBoardState({ turn } = {}) {
  const state = cb.createInitialState();
  state.board = new Array(64).fill(null);
  state.castling = { wK: false, wQ: false, bK: false, bQ: false };
  state.enPassant = null;
  if (turn) state.turn = turn;
  return state;
}

function place(state, sq, type, color) {
  state.board[cb.squareToIndex(sq)] = { type, color };
  return state;
}

// --- Square helpers ---------------------------------------------------
test('squareToIndex/indexToSquare round-trip for every square', () => {
  for (let i = 0; i < 64; i++) {
    assert.equal(cb.squareToIndex(cb.indexToSquare(i)), i);
  }
  assert.equal(cb.squareToIndex('e4'), 28);
  assert.equal(cb.indexToSquare(0), 'a1');
  assert.equal(cb.indexToSquare(63), 'h8');
});

// --- Starting position --------------------------------------------------
test('starting position has exactly 20 legal moves for white and for black', () => {
  const state = cb.createInitialState();
  assert.equal(cb.generateAllLegalMoves(state, 'w').length, 20);
  const afterE4 = applySquares(state, 'e2', 'e4');
  assert.equal(cb.generateAllLegalMoves(afterE4, 'b').length, 20);
});

test('a pawn on its starting square can move one or two squares but not three', () => {
  const state = cb.createInitialState();
  assert.deepEqual(destinationsFrom(state, 'e2'), ['e3', 'e4']);
});

test('a knight on b1 has exactly its two legal opening jumps', () => {
  const state = cb.createInitialState();
  assert.deepEqual(destinationsFrom(state, 'b1'), ['a3', 'c3']);
});

// --- Illegal move rejection (explicit, per Stage 22 requirement) -------
test('rejects moving a piece that is not actually the mover\'s own', () => {
  const state = cb.createInitialState(); // white to move
  // e7 has a black pawn; white may not move it.
  const legal = cb.generateLegalMovesFrom(state, cb.squareToIndex('e7'));
  assert.equal(legal.length, 0);
});

test('rejects a pawn "teleporting" three squares forward', () => {
  const state = cb.createInitialState();
  const dests = destinationsFrom(state, 'e2');
  assert.ok(!dests.includes('e5'));
});

test('rejects a bishop jumping over its own pawn on the opening move', () => {
  const state = cb.createInitialState();
  assert.deepEqual(destinationsFrom(state, 'c1'), []); // blocked by b2/d2 pawns
});

test('rejects a rook moving diagonally', () => {
  const state = emptyBoardState();
  place(state, 'a1', 'r', 'w');
  place(state, 'e1', 'k', 'w');
  place(state, 'e8', 'k', 'b');
  const dests = destinationsFrom(state, 'a1');
  assert.ok(!dests.includes('b2'));
  assert.ok(dests.includes('a8')); // but the full file is open and legal
});

test('rejects capturing your own piece', () => {
  const state = cb.createInitialState();
  const dests = destinationsFrom(state, 'a1'); // rook boxed in by own pawn/knight
  assert.deepEqual(dests, []);
});

test('rejects a move that leaves the mover\'s own king in check (pinned piece)', () => {
  const state = emptyBoardState();
  place(state, 'e1', 'k', 'w');
  place(state, 'e2', 'r', 'w'); // pinned by the black rook on e8
  place(state, 'e8', 'r', 'b');
  place(state, 'a8', 'k', 'b');
  const dests = destinationsFrom(state, 'e2');
  // Only allowed to stay on the e-file (block/capture along the pin).
  assert.deepEqual(dests, ['e3', 'e4', 'e5', 'e6', 'e7', 'e8']);
  assert.ok(!dests.includes('d2') && !dests.includes('f2'));
});

test('rejects a king move into check', () => {
  const state = emptyBoardState();
  place(state, 'e1', 'k', 'w');
  place(state, 'a8', 'k', 'b');
  place(state, 'e8', 'r', 'b'); // controls the whole e-file
  const dests = destinationsFrom(state, 'e1');
  assert.ok(!dests.includes('e2')); // e2 is on the attacked e-file
  assert.ok(dests.includes('d1') || dests.includes('f1'));
});

test('a king already in check must address the check (cannot make an unrelated move)', () => {
  const state = emptyBoardState();
  place(state, 'e1', 'k', 'w');
  place(state, 'e8', 'r', 'b');
  place(state, 'a8', 'k', 'b');
  place(state, 'h2', 'p', 'w');
  // h2 pawn cannot push -- that ignores the check on the e-file.
  assert.deepEqual(destinationsFrom(state, 'h2'), []);
  // The king can step off the e-file.
  const kingDests = destinationsFrom(state, 'e1');
  assert.ok(kingDests.includes('d1') || kingDests.includes('f1'));
});

// --- Check / checkmate / stalemate --------------------------------------
test('detects check', () => {
  const state = emptyBoardState();
  place(state, 'e1', 'k', 'w');
  place(state, 'e8', 'r', 'b');
  place(state, 'a8', 'k', 'b');
  assert.equal(cb.inCheck(state, 'w'), true);
});

test("fool's mate: detects real checkmate in the fewest possible moves", () => {
  let state = cb.createInitialState();
  state = applySquares(state, 'f2', 'f3');
  state = applySquares(state, 'e7', 'e5');
  state = applySquares(state, 'g2', 'g4');
  state = applySquares(state, 'd8', 'h4');
  assert.equal(cb.inCheck(state, 'w'), true);
  assert.equal(cb.isCheckmate(state, 'w'), true);
  assert.equal(cb.generateAllLegalMoves(state, 'w').length, 0);
});

test("scholar's mate: detects real checkmate via a different mating pattern", () => {
  let state = cb.createInitialState();
  state = applySquares(state, 'e2', 'e4');
  state = applySquares(state, 'e7', 'e5');
  state = applySquares(state, 'f1', 'c4');
  state = applySquares(state, 'b8', 'c6');
  state = applySquares(state, 'd1', 'h5');
  state = applySquares(state, 'g8', 'f6');
  state = applySquares(state, 'h5', 'f7');
  assert.equal(cb.isCheckmate(state, 'b'), true);
});

test('detects real stalemate (no check, no legal moves)', () => {
  const state = emptyBoardState({ turn: 'w' });
  place(state, 'a8', 'k', 'w');
  place(state, 'b6', 'q', 'b');
  place(state, 'c7', 'k', 'b');
  assert.equal(cb.inCheck(state, 'w'), false);
  assert.equal(cb.isStalemate(state, 'w'), true);
  assert.equal(cb.isCheckmate(state, 'w'), false);
});

test('a normal mid-game position is neither checkmate nor stalemate', () => {
  const state = cb.createInitialState();
  assert.equal(cb.isCheckmate(state, 'w'), false);
  assert.equal(cb.isStalemate(state, 'w'), false);
});

// --- Castling -------------------------------------------------------------
test('allows kingside castling once the path is clear and safe', () => {
  const state = emptyBoardState({ turn: 'w' });
  place(state, 'e1', 'k', 'w');
  place(state, 'h1', 'r', 'w');
  place(state, 'e8', 'k', 'b');
  state.castling.wK = true;
  const dests = destinationsFrom(state, 'e1');
  assert.ok(dests.includes('g1'));
  const after = applySquares(state, 'e1', 'g1');
  assert.equal(after.board[cb.squareToIndex('g1')].type, 'k');
  assert.equal(after.board[cb.squareToIndex('f1')].type, 'r'); // rook actually hopped over
  assert.equal(after.board[cb.squareToIndex('h1')], null);
});

test('rejects castling if the king has already moved (rights lost)', () => {
  let state = emptyBoardState({ turn: 'w' });
  place(state, 'e1', 'k', 'w');
  place(state, 'h1', 'r', 'w');
  place(state, 'e8', 'k', 'b');
  state.castling.wK = false; // king already moved earlier in the game
  const dests = destinationsFrom(state, 'e1');
  assert.ok(!dests.includes('g1'));
});

test('rejects castling through an attacked square', () => {
  const state = emptyBoardState({ turn: 'w' });
  place(state, 'e1', 'k', 'w');
  place(state, 'h1', 'r', 'w');
  place(state, 'f8', 'r', 'b'); // attacks f1, which the king must pass through
  place(state, 'a8', 'k', 'b');
  state.castling.wK = true;
  const dests = destinationsFrom(state, 'e1');
  assert.ok(!dests.includes('g1'));
});

test('rejects castling while currently in check', () => {
  const state = emptyBoardState({ turn: 'w' });
  place(state, 'e1', 'k', 'w');
  place(state, 'h1', 'r', 'w');
  place(state, 'e8', 'r', 'b'); // checks the king right now
  state.castling.wK = true;
  const dests = destinationsFrom(state, 'e1');
  assert.ok(!dests.includes('g1'));
});

test('rejects queenside castling if a square between king and rook is occupied', () => {
  const state = emptyBoardState({ turn: 'w' });
  place(state, 'e1', 'k', 'w');
  place(state, 'a1', 'r', 'w');
  place(state, 'b1', 'n', 'w'); // occupies b1
  place(state, 'e8', 'k', 'b');
  state.castling.wQ = true;
  const dests = destinationsFrom(state, 'e1');
  assert.ok(!dests.includes('c1'));
});

// --- En passant -----------------------------------------------------------
test('allows a real en passant capture only immediately after the double push', () => {
  let state = cb.createInitialState();
  state = applySquares(state, 'e2', 'e4');
  state = applySquares(state, 'a7', 'a6');
  state = applySquares(state, 'e4', 'e5');
  state = applySquares(state, 'd7', 'd5'); // black double push next to the white pawn
  const dests = cb.generateLegalMovesFrom(state, cb.squareToIndex('e5'));
  const ep = dests.find((m) => m.enPassant);
  assert.ok(ep, 'en passant capture should be legal right now');
  assert.equal(cb.indexToSquare(ep.to), 'd6');
  const after = cb.applyMove(state, ep);
  assert.equal(after.board[cb.squareToIndex('d5')], null); // captured pawn removed
  assert.equal(after.board[cb.squareToIndex('d6')].type, 'p');
});

test('rejects en passant one move too late (the window has closed)', () => {
  let state = cb.createInitialState();
  state = applySquares(state, 'e2', 'e4');
  state = applySquares(state, 'a7', 'a6');
  state = applySquares(state, 'e4', 'e5');
  state = applySquares(state, 'd7', 'd5');
  state = applySquares(state, 'b2', 'b3'); // white plays something else instead
  state = applySquares(state, 'a6', 'a5'); // black plays something else
  const dests = cb.generateLegalMovesFrom(state, cb.squareToIndex('e5'));
  assert.ok(!dests.some((m) => m.enPassant));
});

// --- Promotion --------------------------------------------------------
test('a pawn reaching the last rank must promote, and offers all four pieces', () => {
  const state = emptyBoardState({ turn: 'w' });
  place(state, 'a7', 'p', 'w');
  place(state, 'e1', 'k', 'w');
  place(state, 'e8', 'k', 'b');
  const moves = cb.generateLegalMovesFrom(state, cb.squareToIndex('a7'));
  const promotions = moves.filter((m) => m.to === cb.squareToIndex('a8')).map((m) => m.promotion).sort();
  assert.deepEqual(promotions, ['b', 'n', 'q', 'r']);
});

test('promoting to a queen actually changes the piece on the board', () => {
  const state = emptyBoardState({ turn: 'w' });
  place(state, 'a7', 'p', 'w');
  place(state, 'e1', 'k', 'w');
  place(state, 'e8', 'k', 'b');
  const after = applySquares(state, 'a7', 'a8', 'q');
  assert.equal(after.board[cb.squareToIndex('a8')].type, 'q');
  assert.equal(after.board[cb.squareToIndex('a8')].color, 'w');
});

// --- Insufficient material -------------------------------------------------
test('recognizes bare kings as insufficient material', () => {
  const state = emptyBoardState();
  place(state, 'e1', 'k', 'w');
  place(state, 'e8', 'k', 'b');
  assert.equal(cb.isInsufficientMaterial(state.board), true);
});

test('does NOT treat king + rook vs king as insufficient material (real mate is still possible)', () => {
  const state = emptyBoardState();
  place(state, 'e1', 'k', 'w');
  place(state, 'e8', 'k', 'b');
  place(state, 'a1', 'r', 'w');
  assert.equal(cb.isInsufficientMaterial(state.board), false);
});
