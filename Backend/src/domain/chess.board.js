'use strict';
// Stage 22 — Chess rules engine (pure, no I/O, no randomness).
//
// This is the actual "legal moves only" engine chess.service.js was
// missing before this stage (see game-match.service.js's file header):
// every rule a real game of chess needs to reject an illegal move is
// implemented here — piece movement patterns, blocking pieces, capturing
// rules, check, pins (a move that leaves your own king in check is never
// legal, even if the piece "could" otherwise move that way), castling
// (both sides, all three preconditions: rights never used, squares
// between empty, king not in/through/into check), en passant, pawn
// promotion, checkmate, stalemate, and basic insufficient-material draws.
//
// Squares are 0..63, a1=0 .. h1=7, a2=8 .. h8=63 (file = idx % 8, rank =
// floor(idx / 8), both 0-based). Algebraic helpers convert to/from
// "e4"-style strings at the edges only; everything internal works on
// plain integer indices so move generation never touches strings.
//
// State shape (immutable — every function that "moves" returns a new
// state, never mutates its input):
//   {
//     board: Array(64) of null | { type: 'p'|'n'|'b'|'r'|'q'|'k', color: 'w'|'b' },
//     turn: 'w' | 'b',
//     castling: { wK: bool, wQ: bool, bK: bool, bQ: bool },
//     enPassant: number | null,   // target square a double-pushed pawn can be captured on
//     halfmove: number,           // moves since last capture/pawn push (50-move rule)
//     fullmove: number,
//   }

const FILES = 'abcdefgh';

function squareToIndex(sq) {
  if (typeof sq !== 'string' || sq.length !== 2) return null;
  const file = FILES.indexOf(sq[0]);
  const rank = Number(sq[1]);
  if (file === -1 || !Number.isInteger(rank) || rank < 1 || rank > 8) return null;
  return (rank - 1) * 8 + file;
}

function indexToSquare(idx) {
  const file = idx % 8;
  const rank = Math.floor(idx / 8) + 1;
  return `${FILES[file]}${rank}`;
}

function fileOf(idx) { return idx % 8; }
function rankOf(idx) { return Math.floor(idx / 8); } // 0-based (0 = rank 1)

function createInitialBoard() {
  const board = new Array(64).fill(null);
  const backRank = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  for (let f = 0; f < 8; f++) {
    board[f] = { type: backRank[f], color: 'w' };
    board[8 + f] = { type: 'p', color: 'w' };
    board[48 + f] = { type: 'p', color: 'b' };
    board[56 + f] = { type: backRank[f], color: 'b' };
  }
  return board;
}

function createInitialState() {
  return {
    board: createInitialBoard(),
    turn: 'w',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null,
    halfmove: 0,
    fullmove: 1,
  };
}

function cloneState(state) {
  return {
    board: state.board.slice(),
    turn: state.turn,
    castling: { ...state.castling },
    enPassant: state.enPassant,
    halfmove: state.halfmove,
    fullmove: state.fullmove,
  };
}

function opponent(color) { return color === 'w' ? 'b' : 'w'; }

const KNIGHT_DELTAS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_DELTAS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function inBounds(f, r) { return f >= 0 && f < 8 && r >= 0 && r < 8; }

// Squares attacked BY `byColor`, ignoring whether the attacker is pinned
// (that's exactly what "is this move legal" needs to check separately —
// an attack that exists only because the attacker is itself pinned still
// makes the king's destination square unsafe, e.g. a rook pinned to its
// own king along a file still "covers" that file for this purpose in
// real chess... but implementing that distinction needs full pin
// tracking; we take the standard, slightly-simpler-but-always-correct
// approach of computing raw attack coverage from the actual board, which
// is what every "is square attacked" check in a legal move generator
// needs).
function isSquareAttacked(board, idx, byColor) {
  const f0 = fileOf(idx), r0 = rankOf(idx);

  // Pawns.
  const pawnRankDelta = byColor === 'w' ? -1 : 1; // a white pawn attacking idx sits one rank below it
  for (const df of [-1, 1]) {
    const f = f0 + df, r = r0 + pawnRankDelta;
    if (inBounds(f, r)) {
      const p = board[r * 8 + f];
      if (p && p.color === byColor && p.type === 'p') return true;
    }
  }

  // Knights.
  for (const [df, dr] of KNIGHT_DELTAS) {
    const f = f0 + df, r = r0 + dr;
    if (inBounds(f, r)) {
      const p = board[r * 8 + f];
      if (p && p.color === byColor && p.type === 'n') return true;
    }
  }

  // King (adjacent).
  for (const [df, dr] of KING_DELTAS) {
    const f = f0 + df, r = r0 + dr;
    if (inBounds(f, r)) {
      const p = board[r * 8 + f];
      if (p && p.color === byColor && p.type === 'k') return true;
    }
  }

  // Sliding: bishop/queen diagonals.
  for (const [df, dr] of BISHOP_DIRS) {
    let f = f0 + df, r = r0 + dr;
    while (inBounds(f, r)) {
      const p = board[r * 8 + f];
      if (p) {
        if (p.color === byColor && (p.type === 'b' || p.type === 'q')) return true;
        break;
      }
      f += df; r += dr;
    }
  }

  // Sliding: rook/queen orthogonals.
  for (const [df, dr] of ROOK_DIRS) {
    let f = f0 + df, r = r0 + dr;
    while (inBounds(f, r)) {
      const p = board[r * 8 + f];
      if (p) {
        if (p.color === byColor && (p.type === 'r' || p.type === 'q')) return true;
        break;
      }
      f += df; r += dr;
    }
  }

  return false;
}

function findKing(board, color) {
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (p && p.color === color && p.type === 'k') return i;
  }
  return -1;
}

function inCheck(state, color) {
  const kingIdx = findKing(state.board, color);
  if (kingIdx === -1) return false;
  return isSquareAttacked(state.board, kingIdx, opponent(color));
}

// Pseudo-legal moves for the piece sitting on `from` — obeys movement
// pattern, blocking pieces, and "can't capture your own piece", but does
// NOT yet check whether the move leaves the mover's own king in check
// (see generateLegalMovesFrom, which filters these).
function generatePseudoMovesFrom(state, from) {
  const { board } = state;
  const piece = board[from];
  if (!piece) return [];
  const color = piece.color;
  const f0 = fileOf(from), r0 = rankOf(from);
  const moves = [];

  function pushMove(to, extra) {
    moves.push({ from, to, piece: piece.type, color, ...extra });
  }

  if (piece.type === 'p') {
    const dir = color === 'w' ? 1 : -1;
    const startRank = color === 'w' ? 1 : 6;
    const promoRank = color === 'w' ? 7 : 0;
    // Single push.
    const oneR = r0 + dir;
    if (inBounds(f0, oneR) && !board[oneR * 8 + f0]) {
      const to = oneR * 8 + f0;
      if (rankOf(to) === promoRank) {
        for (const promo of ['q', 'r', 'b', 'n']) pushMove(to, { promotion: promo });
      } else {
        pushMove(to, {});
      }
      // Double push from start rank.
      const twoR = r0 + 2 * dir;
      if (r0 === startRank && inBounds(f0, twoR) && !board[twoR * 8 + f0]) {
        pushMove(twoR * 8 + f0, { doublePush: true });
      }
    }
    // Captures (incl. en passant).
    for (const df of [-1, 1]) {
      const f = f0 + df, r = r0 + dir;
      if (!inBounds(f, r)) continue;
      const to = r * 8 + f;
      const target = board[to];
      if (target && target.color !== color) {
        if (rankOf(to) === promoRank) {
          for (const promo of ['q', 'r', 'b', 'n']) pushMove(to, { capture: true, promotion: promo });
        } else {
          pushMove(to, { capture: true });
        }
      } else if (!target && state.enPassant === to) {
        pushMove(to, { capture: true, enPassant: true });
      }
    }
  } else if (piece.type === 'n') {
    for (const [df, dr] of KNIGHT_DELTAS) {
      const f = f0 + df, r = r0 + dr;
      if (!inBounds(f, r)) continue;
      const to = r * 8 + f;
      const target = board[to];
      if (!target) pushMove(to, {});
      else if (target.color !== color) pushMove(to, { capture: true });
    }
  } else if (piece.type === 'k') {
    for (const [df, dr] of KING_DELTAS) {
      const f = f0 + df, r = r0 + dr;
      if (!inBounds(f, r)) continue;
      const to = r * 8 + f;
      const target = board[to];
      if (!target) pushMove(to, {});
      else if (target.color !== color) pushMove(to, { capture: true });
    }
    // Castling.
    const rights = state.castling;
    const opp = opponent(color);
    if (color === 'w' && from === 4) {
      if (rights.wK && !board[5] && !board[6] && board[7] && board[7].type === 'r' && board[7].color === 'w'
          && !isSquareAttacked(board, 4, opp) && !isSquareAttacked(board, 5, opp) && !isSquareAttacked(board, 6, opp)) {
        pushMove(6, { castle: 'K' });
      }
      if (rights.wQ && !board[3] && !board[2] && !board[1] && board[0] && board[0].type === 'r' && board[0].color === 'w'
          && !isSquareAttacked(board, 4, opp) && !isSquareAttacked(board, 3, opp) && !isSquareAttacked(board, 2, opp)) {
        pushMove(2, { castle: 'Q' });
      }
    } else if (color === 'b' && from === 60) {
      if (rights.bK && !board[61] && !board[62] && board[63] && board[63].type === 'r' && board[63].color === 'b'
          && !isSquareAttacked(board, 60, opp) && !isSquareAttacked(board, 61, opp) && !isSquareAttacked(board, 62, opp)) {
        pushMove(62, { castle: 'K' });
      }
      if (rights.bQ && !board[59] && !board[58] && !board[57] && board[56] && board[56].type === 'r' && board[56].color === 'b'
          && !isSquareAttacked(board, 60, opp) && !isSquareAttacked(board, 59, opp) && !isSquareAttacked(board, 58, opp)) {
        pushMove(58, { castle: 'Q' });
      }
    }
  } else {
    // Sliding pieces: bishop, rook, queen.
    const dirs = piece.type === 'b' ? BISHOP_DIRS : piece.type === 'r' ? ROOK_DIRS : [...BISHOP_DIRS, ...ROOK_DIRS];
    for (const [df, dr] of dirs) {
      let f = f0 + df, r = r0 + dr;
      while (inBounds(f, r)) {
        const to = r * 8 + f;
        const target = board[to];
        if (!target) {
          pushMove(to, {});
        } else {
          if (target.color !== color) pushMove(to, { capture: true });
          break;
        }
        f += df; r += dr;
      }
    }
  }

  return moves;
}

// Applies a pseudo-legal move object (as produced above) to a state and
// returns a brand-new state. Never mutates the input.
function applyMove(state, move) {
  const next = cloneState(state);
  const { board } = next;
  const piece = board[move.from];
  const movingColor = piece.color;
  const isPawn = piece.type === 'p';
  const isCapture = !!move.capture;

  // En passant capture removes the pawn that is NOT on the destination
  // square (it's on the same rank as the mover, same file as `to`).
  if (move.enPassant) {
    const capturedIdx = movingColor === 'w' ? move.to - 8 : move.to + 8;
    board[capturedIdx] = null;
  }

  board[move.to] = move.promotion ? { type: move.promotion, color: movingColor } : piece;
  board[move.from] = null;

  // Castling also moves the rook.
  if (move.castle === 'K') {
    const rookFrom = movingColor === 'w' ? 7 : 63;
    const rookTo = movingColor === 'w' ? 5 : 61;
    board[rookTo] = board[rookFrom];
    board[rookFrom] = null;
  } else if (move.castle === 'Q') {
    const rookFrom = movingColor === 'w' ? 0 : 56;
    const rookTo = movingColor === 'w' ? 3 : 59;
    board[rookTo] = board[rookFrom];
    board[rookFrom] = null;
  }

  // Castling rights: lost when the king moves, a rook moves off its
  // home square, or a rook is captured on its home square.
  if (piece.type === 'k') {
    if (movingColor === 'w') { next.castling.wK = false; next.castling.wQ = false; }
    else { next.castling.bK = false; next.castling.bQ = false; }
  }
  const touchesHome = (sq) => move.from === sq || move.to === sq;
  if (touchesHome(0)) next.castling.wQ = false;
  if (touchesHome(7)) next.castling.wK = false;
  if (touchesHome(56)) next.castling.bQ = false;
  if (touchesHome(63)) next.castling.bK = false;

  // En passant target for the NEXT move only exists right after a
  // double pawn push.
  next.enPassant = move.doublePush ? (movingColor === 'w' ? move.from + 8 : move.from - 8) : null;

  // 50-move rule counter.
  next.halfmove = (isPawn || isCapture) ? 0 : state.halfmove + 1;

  next.turn = opponent(movingColor);
  if (movingColor === 'b') next.fullmove += 1;

  return next;
}

// Legal moves from a single square: pseudo-legal, minus any that leave
// the mover's own king in check.
function generateLegalMovesFrom(state, from) {
  const piece = state.board[from];
  if (!piece || piece.color !== state.turn) return [];
  const pseudo = generatePseudoMovesFrom(state, from);
  return pseudo.filter((move) => {
    const after = applyMove(state, move);
    return !inCheck(after, piece.color);
  });
}

function generateAllLegalMoves(state, color) {
  const moves = [];
  for (let i = 0; i < 64; i++) {
    const p = state.board[i];
    if (p && p.color === color) {
      const pseudo = generatePseudoMovesFrom(state, i);
      for (const move of pseudo) {
        const after = applyMove(state, move);
        if (!inCheck(after, color)) moves.push(move);
      }
    }
  }
  return moves;
}

function isCheckmate(state, color) {
  return inCheck(state, color) && generateAllLegalMoves(state, color).length === 0;
}

function isStalemate(state, color) {
  return !inCheck(state, color) && generateAllLegalMoves(state, color).length === 0;
}

// Basic, well-known insufficient-material draws only: K v K, K+minor v K,
// K+B v K+B with same-colored bishops. Anything else (even if "probably"
// drawn in practice, like K+2N v K) is deliberately left OUT of this —
// it is not an automatic dead position by the rules, so the game keeps
// playing rather than this engine inventing a draw the players didn't
// agree to.
function isInsufficientMaterial(board) {
  const pieces = board.map((p, i) => (p ? { ...p, idx: i } : null)).filter(Boolean);
  const nonKings = pieces.filter((p) => p.type !== 'k');
  if (nonKings.length === 0) return true;
  if (nonKings.length === 1 && (nonKings[0].type === 'b' || nonKings[0].type === 'n')) return true;
  if (nonKings.length === 2 && nonKings.every((p) => p.type === 'b')) {
    const squareColor = (idx) => (fileOf(idx) + rankOf(idx)) % 2;
    if (nonKings[0].color !== nonKings[1].color && squareColor(nonKings[0].idx) === squareColor(nonKings[1].idx)) {
      return true;
    }
  }
  return false;
}

module.exports = {
  squareToIndex,
  indexToSquare,
  fileOf,
  rankOf,
  createInitialBoard,
  createInitialState,
  cloneState,
  opponent,
  isSquareAttacked,
  findKing,
  inCheck,
  generatePseudoMovesFrom,
  generateLegalMovesFrom,
  generateAllLegalMoves,
  applyMove,
  isCheckmate,
  isStalemate,
  isInsufficientMaterial,
};
