'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { GAMES, resolveGame, listGames } = require('../src/domain/game-catalog');

test('resolveGame resolves every one of the seven catalog games named by this project\'s own Stage 20-22 plan', () => {
  for (const id of ['ludo', 'carrom', 'snakes_ladders', 'quiz', 'chess', 'eight_ball', 'domino']) {
    const game = resolveGame(id);
    assert.equal(game.id, id);
    assert.equal(typeof game.name, 'string');
    assert.ok(game.minPlayers >= 1);
    assert.ok(game.maxPlayers >= game.minPlayers);
  }
});

test('resolveGame rejects an unknown gameId', () => {
  assert.throws(() => resolveGame('not_a_real_game'), (e) => e.status === 400);
});

test('resolveGame rejects a missing/blank gameId', () => {
  assert.throws(() => resolveGame(undefined), (e) => e.status === 400);
  assert.throws(() => resolveGame(''), (e) => e.status === 400);
  assert.throws(() => resolveGame('   '), (e) => e.status === 400);
});

test('chess and eight_ball are exactly 2-player games (their real, standard player count)', () => {
  assert.equal(resolveGame('chess').minPlayers, 2);
  assert.equal(resolveGame('chess').maxPlayers, 2);
  assert.equal(resolveGame('eight_ball').minPlayers, 2);
  assert.equal(resolveGame('eight_ball').maxPlayers, 2);
});

test('listGames returns every catalog entry and nothing extra', () => {
  const list = listGames();
  assert.equal(list.length, Object.keys(GAMES).length);
  const ids = list.map((g) => g.id).sort();
  assert.deepEqual(ids, ['carrom', 'chess', 'domino', 'eight_ball', 'ludo', 'quiz', 'snakes_ladders']);
});

test('the catalog is frozen (cannot be mutated at runtime)', () => {
  assert.throws(() => { GAMES.ludo.maxPlayers = 999; });
});
