'use strict';
// Stage 22 — Domino rules engine (pure, no I/O, no randomness).
//
// Standard double-six set (28 tiles, 0-0 through 6-6). This file is pure
// and stateless -- tile-set generation, whether a given tile can
// legally attach to either open end of the current chain, what the
// chain looks like after attaching it, and the real blocked-game
// tiebreak (lowest total pips in hand wins when nobody can move and the
// boneyard is empty) -- the same "fixed data + pure functions, all
// randomness/dealing/turn-state lives in the service" split every other
// domain file in this project (snakes-ladders.board.js, carrom-board.js,
// eight-ball.board.js) already uses.

function createFullSet() {
  const tiles = [];
  for (let a = 0; a <= 6; a++) {
    for (let b = a; b <= 6; b++) {
      tiles.push([a, b]);
    }
  }
  return tiles; // 28 tiles
}

function pipSum(tile) { return tile[0] + tile[1]; }

function handPipTotal(hand) { return hand.reduce((sum, t) => sum + pipSum(t), 0); }

function isDouble(tile) { return tile[0] === tile[1]; }

// Which open end(s) of the chain a tile could legally attach to.
// `chain` is { left: number|null, right: number|null } -- both null
// means the board is empty (any tile may open it).
function legalEnds(tile, chain) {
  if (chain.left === null || chain.right === null) return { left: true, right: true };
  const ends = { left: false, right: false };
  if (tile[0] === chain.left || tile[1] === chain.left) ends.left = true;
  if (tile[0] === chain.right || tile[1] === chain.right) ends.right = true;
  return ends;
}

function hasAnyLegalMove(hand, chain) {
  return hand.some((tile) => {
    const ends = legalEnds(tile, chain);
    return ends.left || ends.right;
  });
}

// Attaches `tile` to the given end of the chain, returning the new
// { left, right } ends. Throws if the tile cannot actually attach there
// -- callers must check legalEnds() first (the service does, before
// ever calling this), so this is the final, authoritative legality
// check, not just the hint layer.
function attach(tile, end, chain) {
  if (chain.left === null || chain.right === null) {
    // Opening move: the tile's two pips become the two new ends,
    // regardless of which `end` was requested.
    return { left: tile[0], right: tile[1] };
  }
  if (end === 'left') {
    if (tile[0] === chain.left) return { left: tile[1], right: chain.right };
    if (tile[1] === chain.left) return { left: tile[0], right: chain.right };
    throw Object.assign(new Error('tile does not match the left end'), { status: 400 });
  }
  if (end === 'right') {
    if (tile[0] === chain.right) return { left: chain.left, right: tile[1] };
    if (tile[1] === chain.right) return { left: chain.left, right: tile[0] };
    throw Object.assign(new Error('tile does not match the right end'), { status: 400 });
  }
  throw Object.assign(new Error('end must be "left" or "right"'), { status: 400 });
}

// Real blocked-game rule: when the boneyard is empty and every player in
// turn has passed with no legal move, whoever holds the lowest total
// pip count in hand wins; equal lowest totals across 2+ players is a
// real draw (never an invented tiebreak beyond the actual rule).
function blockedGameWinner(hands) {
  const totals = Object.entries(hands).map(([playerId, hand]) => [playerId, handPipTotal(hand)]);
  const min = Math.min(...totals.map(([, t]) => t));
  const winners = totals.filter(([, t]) => t === min).map(([p]) => p);
  return { winnerId: winners.length === 1 ? winners[0] : null, totals: Object.fromEntries(totals) };
}

module.exports = { createFullSet, pipSum, handPipTotal, isDouble, legalEnds, hasAnyLegalMove, attach, blockedGameWinner };
