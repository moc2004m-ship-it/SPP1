'use strict';

// Stage 19 — Room Game Center framework: fixed catalog of the games the
// platform's Game Center knows how to host a lobby for.
//
// Same boundary as room-catalog.js/gift-catalog.js/guard-catalog.js: a
// game's identity and player-count bounds are ALWAYS resolved here,
// server-side, from a fixed key -- never accepted as an arbitrary
// client-supplied string. Before this file existed, POST /api/games
// accepted ANY string as gameId with no validation at all (see
// game-match.service.js's prior createMatch()), which meant the "game
// registry" half of a Room Game Center simply did not exist yet -- this
// is exactly the gap PHASE5_CENTRAL_SYSTEMS_REPORT.md flagged as
// "framework, not gameplay" work still owed to this stage.
//
// IMPORTANT: this catalog is a REGISTRY, not a rules engine. No game
// logic (dice, board state, legal moves, scoring, turn order) lives here
// or anywhere in this stage -- that is Stage 20/21/22's own, separate,
// per-game body of work (see PHASE5_CENTRAL_SYSTEMS_REPORT.md and
// STAGES in ../feature-platform.js). The seven entries below are exactly
// the games already named by this project's own stage plan for Stage
// 20-22 -- no new game is invented here, and minPlayers/maxPlayers are
// each game's real, standard player count (chess and eight-ball are
// always exactly 2; the others are illustrative, easy-to-adjust bounds
// for a room lobby, same "not final tuning" caveat every other catalog
// in this project carries).

const GAMES = Object.freeze({
  ludo: Object.freeze({ id: 'ludo', name: 'Ludo', minPlayers: 2, maxPlayers: 4 }),
  carrom: Object.freeze({ id: 'carrom', name: 'Carrom', minPlayers: 2, maxPlayers: 4 }),
  snakes_ladders: Object.freeze({ id: 'snakes_ladders', name: 'Snakes & Ladders', minPlayers: 2, maxPlayers: 4 }),
  quiz: Object.freeze({ id: 'quiz', name: 'Quiz', minPlayers: 2, maxPlayers: 8 }),
  chess: Object.freeze({ id: 'chess', name: 'Chess', minPlayers: 2, maxPlayers: 2 }),
  eight_ball: Object.freeze({ id: 'eight_ball', name: 'Eight Ball', minPlayers: 2, maxPlayers: 2 }),
  domino: Object.freeze({ id: 'domino', name: 'Domino', minPlayers: 2, maxPlayers: 4 }),
});

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

// Resolves and validates a client-supplied gameId against the fixed
// catalog above -- the ONLY place game-match.service.js ever accepts a
// gameId from. Throws 400 for anything not in the catalog (including
// missing/blank), exactly like room-catalog.js's resolveTheme()/
// resolveCategory() etc. do for rooms.
function resolveGame(gameId) {
  if (typeof gameId !== 'string' || !gameId.trim()) throw badRequest('gameId is required');
  const game = GAMES[gameId];
  if (!game) throw badRequest(`gameId must be one of ${Object.keys(GAMES).join(', ')}`);
  return game;
}

function listGames() {
  return Object.values(GAMES);
}

module.exports = { GAMES, resolveGame, listGames };
