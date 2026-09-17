'use strict';
// Stage 22 — Eight Ball strike-resolution rules.
//
// Same "no discrete move a client could legitimately declare" shape as
// carrom (see carrom-board.js's own header): a real shot's outcome
// depends on physical aim/power, so it is always resolved server-side
// against one server-rolled value in [1,100] via determineOutcome()
// below -- never accepted, influenced, or overridden by the client. This
// file is pure and stateless: fixed bands + group/ball counts, the same
// "fixed data + pure functions" shape carrom-board.js/snakes-ladders
// .board.js already use.
//
// Real 8-ball groups (solid balls 1-7, striped balls 9-15, plus the
// black 8-ball) are modeled as two 7-ball groups + the 8-ball, matching
// the real rack. Which physical numbers belong to which player is
// decided the real way: NOT preassigned, only fixed once the first legal
// (non-8-ball) ball is actually potted -- see eight-ball.service.js.
const BALLS_PER_GROUP = 7;

// Bands over a roll in [1,100]. 'pot_eight' can only ever legitimately
// resolve a win/loss once the caller knows whether the actor's own group
// is cleared -- that decision lives in the service (same "resolve
// against real state, never waste or reinterpret the roll" pattern
// carrom.service.js uses for its own 'queen' band).
function determineOutcome(roll) {
  if (!Number.isInteger(roll) || roll < 1 || roll > 100) {
    throw Object.assign(new Error('roll must be an integer in [1,100]'), { status: 400 });
  }
  if (roll <= 15) return 'foul'; // 15% -- a scratch/miscue: cue ball or wrong-group contact
  if (roll <= 40) return 'miss'; // 25% -- shot attempted, nothing potted, turn passes
  if (roll <= 90) return 'pot'; // 50% -- one of the shooter's own-group balls goes in
  return 'pot_eight'; // 10% -- an attempt on the black 8-ball specifically
}

module.exports = { BALLS_PER_GROUP, determineOutcome };
