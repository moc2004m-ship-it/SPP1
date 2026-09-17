'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryGameMatchRepository } = require('../src/database/repositories/game-match.repository');
const { createGameMatchService } = require('../src/services/game-match.service');
const { createDominoService } = require('../src/services/domino.service');
const { legalEnds } = require('../src/domain/domino.board');

// Identity "shuffle" -- returns the 28-tile set in createFullSet()'s own
// natural order: (0,0)..(0,6) then (1,1)..(1,6) then (2,2)... This is a
// real, deterministic dependency injection (domino.service.js accepts
// `shuffle` as an optional constructor arg, same pattern as every other
// Stage 19-22 engine in this project); production wiring (src/index.js)
// never passes this and always uses the real crypto-backed default.
// With 2 players (hand size 7) this hands usr_1 all seven "0-x" tiles
// and usr_2 six "1-x" tiles plus the 2-2 double -- verified below.
function identityShuffle(deck) { return deck.slice(); }

async function setup({ shuffle, playerIds } = {}) {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const domino = createDominoService({ gameMatchService, shuffle: shuffle || identityShuffle });
  const match = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'domino', startedBy: (playerIds || ['usr_1', 'usr_2'])[0], playerIds: playerIds || ['usr_1', 'usr_2'] });
  await gameMatchService.startMatch((playerIds || ['usr_1', 'usr_2'])[0], match.id);
  return { gameMatches, gameMatchService, domino, match };
}

test('getState before the match is started reports started:false and no hand', async () => {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const domino = createDominoService({ gameMatchService });
  const match = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'domino', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });
  const state = await domino.getState('usr_1', match.id);
  assert.equal(state.started, false);
  assert.deepEqual(state.hand, []);
  assert.equal(state.turn, null);
});

test('rejects a wrong-game match (e.g. chess) with 400', async () => {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const domino = createDominoService({ gameMatchService });
  const chessMatch = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'chess', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });
  await assert.rejects(() => domino.getState('usr_1', chessMatch.id), (e) => e.status === 400);
});

test('only a participant may view, play, draw, or pass', async () => {
  const { domino, match } = await setup();
  await assert.rejects(() => domino.getState('usr_intruder', match.id), (e) => e.status === 403);
  await assert.rejects(() => domino.playTile('usr_intruder', match.id, { tileIndex: 0 }), (e) => e.status === 403);
  await assert.rejects(() => domino.draw('usr_intruder', match.id), (e) => e.status === 403);
  await assert.rejects(() => domino.pass('usr_intruder', match.id), (e) => e.status === 403);
});

test('hand sizes and boneyard scale correctly for 2, 3, and 4 players (dealt from the real 28-tile set)', async () => {
  {
    const { domino, match } = await setup({ playerIds: ['usr_1', 'usr_2'] });
    const state = await domino.getState('usr_1', match.id);
    assert.equal(state.hand.length, 7);
    assert.deepEqual(state.handSizes, { usr_1: 7, usr_2: 7 });
    assert.equal(state.boneyardCount, 14);
  }
  {
    const { domino, match } = await setup({ playerIds: ['usr_1', 'usr_2', 'usr_3'] });
    const state = await domino.getState('usr_1', match.id);
    assert.equal(state.hand.length, 6);
    assert.deepEqual(state.handSizes, { usr_1: 6, usr_2: 6, usr_3: 6 });
    assert.equal(state.boneyardCount, 10);
  }
  {
    const { domino, match } = await setup({ playerIds: ['usr_1', 'usr_2', 'usr_3', 'usr_4'] });
    const state = await domino.getState('usr_1', match.id);
    assert.equal(state.hand.length, 6);
    assert.deepEqual(state.handSizes, { usr_1: 6, usr_2: 6, usr_3: 6, usr_4: 6 });
    assert.equal(state.boneyardCount, 4);
  }
});

test('the real starting rule picks whoever holds the single highest double across all dealt hands', async () => {
  // Verified by direct execution against the real dealt hands: usr_1 gets
  // (0,0)-(0,6) (only double: 0-0, pips 0); usr_2 gets (1,1)-(1,6) plus
  // (2,2) (doubles: 1-1 pips 2, 2-2 pips 4). 2-2 is the highest double
  // dealt to anyone, so usr_2 -- not usr_1 -- opens.
  const { domino, match } = await setup();
  const state = await domino.getState('usr_1', match.id);
  assert.equal(state.turn, 'usr_2');
});

test('only the player whose turn it is may play, draw, or pass', async () => {
  const { domino, match } = await setup();
  await assert.rejects(() => domino.playTile('usr_1', match.id, { tileIndex: 0 }), (e) => e.status === 409 && /not your turn/.test(e.message));
  await assert.rejects(() => domino.draw('usr_1', match.id), (e) => e.status === 409 && /not your turn/.test(e.message));
  await assert.rejects(() => domino.pass('usr_1', match.id), (e) => e.status === 409 && /not your turn/.test(e.message));
});

test('playTile re-validates tileIndex server-side: out-of-range or non-integer is rejected', async () => {
  const { domino, match } = await setup();
  await assert.rejects(() => domino.playTile('usr_2', match.id, { tileIndex: 99 }), (e) => e.status === 400);
  await assert.rejects(() => domino.playTile('usr_2', match.id, { tileIndex: -1 }), (e) => e.status === 400);
  await assert.rejects(() => domino.playTile('usr_2', match.id, { tileIndex: 1.5 }), (e) => e.status === 400);
});

test('the opening move ignores whatever `end` was supplied and sets the chain from the tile\'s own two pips', async () => {
  const { domino, match } = await setup();
  const state = await domino.playTile('usr_2', match.id, { tileIndex: 0, end: 'garbage-value' });
  // usr_2's hand (identity shuffle) is [1,1],[1,2],[1,3],[1,4],[1,5],[1,6],[2,2] -- index 0 is [1,1].
  assert.deepEqual(state.chain, { left: 1, right: 1 });
});

test('rejects a tile that does not actually match the requested end, with a 400 naming the end', async () => {
  const { domino, match } = await setup();
  await domino.playTile('usr_2', match.id, { tileIndex: 0 }); // opens with [1,1] -> chain {1,1}
  // usr_1's hand is all "0-x" tiles; [0,2] matches neither end of a 1/1 chain.
  await assert.rejects(
    () => domino.playTile('usr_1', match.id, { tileIndex: 2, end: 'left' }),
    (e) => e.status === 400 && /left end/.test(e.message),
  );
});

test('a legal play removes the tile from hand, updates the chain, and passes the turn', async () => {
  const { domino, match } = await setup();
  await domino.playTile('usr_2', match.id, { tileIndex: 0 }); // [1,1] -> chain {1,1}, turn -> usr_1
  // usr_1's hand is [0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6]; index 1 is [0,1], matches left end (1).
  const state = await domino.playTile('usr_1', match.id, { tileIndex: 1, end: 'left' });
  assert.deepEqual(state.chain, { left: 0, right: 1 });
  assert.equal(state.hand.length, 6);
  assert.ok(!state.hand.some((t) => t[0] === 0 && t[1] === 1), 'played tile is gone from hand');
  assert.equal(state.turn, 'usr_2');
  assert.equal(state.history[state.history.length - 1].action, 'play');
});

test('draw / pass: an actor with no legal move must draw while the boneyard has tiles, and may only pass once it is empty', async () => {
  // Same 6-vs-no-6 fixture: after usr_1 opens with 6-6, usr_2 has zero
  // tiles containing a 6, and the entire 14-tile boneyard also contains
  // no 6-tile (all real, verified by direct execution) -- so usr_2 is
  // genuinely forced to draw the full boneyard dry before being allowed
  // to pass, exactly as real domino rules require.
  const FIXED_DECK = [
    [0, 6], [1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 6],
    [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 1],
    [1, 2], [1, 3], [1, 4], [1, 5], [2, 2], [2, 3], [2, 4], [2, 5], [3, 3], [3, 4], [3, 5], [4, 4], [4, 5], [5, 5],
  ];
  const { domino, match } = await setup({ shuffle: () => FIXED_DECK.map((t) => t.slice()) });
  await domino.playTile('usr_1', match.id, { tileIndex: 6 }); // opens [6,6] -> chain {6,6}, turn -> usr_2

  // usr_2 cannot play (no 6-tile) and cannot pass yet (boneyard not empty).
  await assert.rejects(() => domino.playTile('usr_2', match.id, { tileIndex: 0, end: 'left' }), (e) => e.status === 400);
  await assert.rejects(() => domino.pass('usr_2', match.id), (e) => e.status === 409 && /boneyard is not empty/.test(e.message));

  let state = await domino.draw('usr_2', match.id);
  assert.equal(state.hand.length, 8);
  assert.equal(state.boneyardCount, 13);
  assert.equal(state.turn, 'usr_2', 'drawing never passes the turn');

  for (let i = 0; i < 13; i++) state = await domino.draw('usr_2', match.id);
  assert.equal(state.boneyardCount, 0);
  assert.equal(state.hand.length, 21);

  // Boneyard now empty: draw is rejected, pass is required and accepted.
  await assert.rejects(() => domino.draw('usr_2', match.id), (e) => e.status === 409 && /boneyard is empty/.test(e.message));
  state = await domino.pass('usr_2', match.id);
  assert.equal(state.turn, 'usr_1');
  assert.equal(state.finished, false, 'a single pass with only 2 players is not yet a blocked game');

  // usr_1 now clearly has a legal move (6 remaining 6-tiles) -- draw/pass both rejected.
  await assert.rejects(() => domino.draw('usr_1', match.id), (e) => e.status === 409 && /legal move/.test(e.message));
  await assert.rejects(() => domino.pass('usr_1', match.id), (e) => e.status === 409 && /legal move/.test(e.message));
});

test('reconnect and hand privacy: a viewer always sees their own tiles but only hand-size counts for opponents, identically across repeated calls', async () => {
  const { domino, match } = await setup();
  await domino.playTile('usr_2', match.id, { tileIndex: 0 }); // usr_2 opens

  const view1a = await domino.getState('usr_1', match.id);
  const view1b = await domino.getState('usr_1', match.id);
  const view2 = await domino.getState('usr_2', match.id);

  assert.deepEqual(view1a, view1b, 'reconnecting mid-game returns the exact same state (server-side, not lost on disconnect)');
  assert.deepEqual(view1a.hand, [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6]], 'usr_1 sees their own real tiles');
  assert.deepEqual(view1a.handSizes, { usr_1: 7, usr_2: 6 }, 'opponent hand exposed only as a size, never tiles');
  assert.ok(!('hand' in view1a) || view1a.hand.every((t) => Array.isArray(t)), 'no opponent tile ever appears in usr_1\'s own hand field');
  assert.deepEqual(view2.hand, [[1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [2, 2]], 'usr_2 sees their own real remaining tiles');
  assert.deepEqual(view1a.history, view2.history, 'match history (plays/draws/passes) is public and identical for both viewers');
});

// A general bot helper for full-game tests, mirroring ludo.service.test.js's
// walkTokenHome pattern: on the actor's turn it plays the first tile in
// hand that legally attaches to either open end (left preferred), else
// draws from the boneyard until it can play or the boneyard is empty,
// then passes. Every deck fixture below was found via this exact bot
// against the real engine (not hand-invented) and its outcome verified
// by direct execution before being hardcoded here.
async function playBotTurn(domino, matchId, actorId) {
  for (let guard = 0; guard < 200; guard++) {
    const state = await domino.getState(actorId, matchId);
    if (state.finished) return state;
    const { hand, chain } = state;
    for (let i = 0; i < hand.length; i++) {
      const ends = legalEnds(hand[i], chain);
      if (chain.left === null) return domino.playTile(actorId, matchId, { tileIndex: i });
      if (ends.left) return domino.playTile(actorId, matchId, { tileIndex: i, end: 'left' });
      if (ends.right) return domino.playTile(actorId, matchId, { tileIndex: i, end: 'right' });
    }
    if (state.boneyardCount > 0) { await domino.draw(actorId, matchId); continue; }
    return domino.pass(actorId, matchId);
  }
  throw new Error('bot guard exceeded for ' + actorId);
}

async function playFullGame(domino, matchId, playerIds, maxRounds) {
  let state;
  for (let round = 0; round < maxRounds; round++) {
    state = await domino.getState(playerIds[0], matchId);
    if (state.finished) break;
    await playBotTurn(domino, matchId, state.turn);
  }
  return domino.getState(playerIds[0], matchId);
}

test('a full game to a real, server-detected win: a player legally emptying their hand finishes the match (hand_empty)', async () => {
  // Identity shuffle: usr_1 is dealt all seven "0-x" tiles -- a tile
  // matching every possible value 0-6, so the greedy bot can always play
  // it. Verified by direct execution: usr_1 empties their hand and wins
  // in 13 rounds / 26 history entries, with usr_2 left holding 12 tiles
  // and the boneyard down to 2.
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const domino = createDominoService({ gameMatchService, shuffle: identityShuffle });
  const match = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'domino', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });
  await gameMatchService.startMatch('usr_1', match.id);

  const state = await playFullGame(domino, match.id, ['usr_1', 'usr_2'], 60);

  assert.equal(state.finished, true);
  assert.equal(state.winnerId, 'usr_1');
  assert.equal(state.result, 'hand_empty');
  assert.equal(state.hand.length, 0);
  assert.equal(state.handSizes['usr_2'], 12);

  const finishedMatch = await gameMatches.findById(match.id);
  assert.equal(finishedMatch.state, 'finished');
  assert.equal(finishedMatch.winnerId, 'usr_1');
  assert.equal(finishedMatch.result.engine, 'domino');
  assert.equal(finishedMatch.result.reason, 'hand_empty');

  // Playing, drawing, or passing after the match has finished is rejected.
  await assert.rejects(() => domino.playTile('usr_2', match.id, { tileIndex: 0 }), (e) => e.status === 409);
  await assert.rejects(() => domino.draw('usr_2', match.id), (e) => e.status === 409);
  await assert.rejects(() => domino.pass('usr_1', match.id), (e) => e.status === 409);
});

test('a full game to a real, server-detected blocked game with a decisive lowest-pips winner', async () => {
  // Found via the same greedy bot searching real deck orderings (not
  // invented) and verified by direct execution: this exact 28-tile order
  // reaches a genuine blocked game (both players pass in a row with the
  // boneyard empty and neither able to move) after 44 real history
  // entries, with usr_1 left holding 10 pips and usr_2 holding 4 --
  // usr_2 wins on the real lowest-pips tiebreak.
  const FIXED_DECK = [[4,6],[2,6],[0,0],[1,2],[3,6],[2,4],[6,6],[1,1],[5,6],[0,3],[1,4],[1,3],[0,6],[3,3],[2,2],[2,3],[0,5],[0,1],[0,4],[0,2],[1,6],[3,4],[4,5],[4,4],[5,5],[2,5],[1,5],[3,5]];
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const domino = createDominoService({ gameMatchService, shuffle: () => FIXED_DECK.map((t) => t.slice()) });
  const match = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'domino', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });
  await gameMatchService.startMatch('usr_1', match.id);

  const state = await playFullGame(domino, match.id, ['usr_1', 'usr_2'], 300);

  assert.equal(state.finished, true);
  assert.equal(state.result, 'blocked_game');
  assert.equal(state.winnerId, 'usr_2');

  const finishedMatch = await gameMatches.findById(match.id);
  assert.equal(finishedMatch.result.reason, 'blocked_game');
  assert.deepEqual(finishedMatch.result.pipTotals, { usr_1: 10, usr_2: 4 });
  assert.ok(finishedMatch.result.pipTotals.usr_2 < finishedMatch.result.pipTotals.usr_1, 'the real lower pip total is the winner');
});

test('a full game to a real, server-detected blocked game that ties (equal lowest pips is a genuine draw, never an invented winner)', async () => {
  // Same method as above, a different verified deck ordering that
  // deterministically reaches a blocked game with BOTH players holding
  // exactly 21 pips -- a real tie, so winnerId must be null.
  const FIXED_DECK = [[2,6],[3,4],[2,5],[1,4],[0,5],[2,2],[1,1],[1,5],[4,6],[0,3],[0,6],[1,6],[5,5],[5,6],[0,1],[2,3],[4,4],[4,5],[0,4],[3,6],[3,5],[1,3],[6,6],[2,4],[1,2],[3,3],[0,2],[0,0]];
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const domino = createDominoService({ gameMatchService, shuffle: () => FIXED_DECK.map((t) => t.slice()) });
  const match = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'domino', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });
  await gameMatchService.startMatch('usr_1', match.id);

  const state = await playFullGame(domino, match.id, ['usr_1', 'usr_2'], 300);

  assert.equal(state.finished, true);
  assert.equal(state.result, 'blocked_game');
  assert.equal(state.winnerId, null, 'a real tie must never invent a winner');

  const finishedMatch = await gameMatches.findById(match.id);
  assert.deepEqual(finishedMatch.result.pipTotals, { usr_1: 21, usr_2: 21 });
  assert.equal(finishedMatch.winnerId, null);
  assert.equal(finishedMatch.state, 'finished', 'a draw still finishes the match record, not left dangling active');
});
