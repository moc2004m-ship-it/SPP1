'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryGameMatchRepository } = require('../src/database/repositories/game-match.repository');
const { createGameMatchService } = require('../src/services/game-match.service');
const { createQuizService } = require('../src/services/quiz.service');
const { QUESTIONS } = require('../src/domain/quiz-bank');

// A controllable fake clock so tests can assert exact timeout/scoring
// behaviour without sleeping in real time. Production wiring
// (src/index.js) never passes `now`; it always uses the real Date.now.
function fakeClock(start) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

async function setup({ now, questionDurationMs, questionsPerMatch, playerIds } = {}) {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const quiz = createQuizService({ gameMatchService, now, questionDurationMs: questionDurationMs || 10000, questionsPerMatch: questionsPerMatch || 3 });
  const match = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'quiz', startedBy: 'usr_1', playerIds: playerIds || ['usr_1', 'usr_2'] });
  await gameMatchService.startMatch('usr_1', match.id);
  return { gameMatches, gameMatchService, quiz, match };
}

test('getState before the match is started reports started:false', async () => {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const quiz = createQuizService({ gameMatchService });
  const match = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'quiz', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });
  const state = await quiz.getState('usr_1', match.id);
  assert.equal(state.started, false);
});

test('getState never leaks the correct answer for the open question', async () => {
  const { quiz, match } = await setup();
  const state = await quiz.getState('usr_1', match.id);
  assert.ok(state.question.text);
  assert.ok(Array.isArray(state.question.choices));
  assert.equal(state.question.correctIndex, undefined);
  assert.equal(state.question.choices.some((c) => typeof c === 'object'), false);
});

test('only a participant may view or answer', async () => {
  const { quiz, match } = await setup();
  await assert.rejects(() => quiz.getState('usr_intruder', match.id), (e) => e.status === 403);
  await assert.rejects(() => quiz.submitAnswer('usr_intruder', match.id, 0), (e) => e.status === 403);
});

test('rejects a wrong-game match (e.g. ludo) with 400', async () => {
  const gameMatches = new InMemoryGameMatchRepository();
  const gameMatchService = createGameMatchService({ gameMatches });
  const quiz = createQuizService({ gameMatchService });
  const ludoMatch = await gameMatchService.createMatch({ roomId: 'room_1', gameId: 'ludo', startedBy: 'usr_1', playerIds: ['usr_1', 'usr_2'] });
  await assert.rejects(() => quiz.getState('usr_1', ludoMatch.id), (e) => e.status === 400);
});

test('a correct answer scores more than a same-question correct answer that came in later (server-timed speed bonus)', async () => {
  const clock = fakeClock(1000);
  const { quiz, match } = await setup({ now: clock, questionDurationMs: 10000 });
  const state0 = await quiz.getState('usr_1', match.id);
  // Find the real correct index by checking against the bank via id.
  const bankQ = QUESTIONS.find((x) => x.id === state0.question.id);

  clock.advance(1000); // usr_1 answers quickly, 1s in
  const afterFast = await quiz.submitAnswer('usr_1', match.id, bankQ.correctIndex);
  const fastScore = afterFast.scores['usr_1'];

  clock.advance(8000); // usr_2 answers slowly, 9s in (still before the 10s window closes)
  const afterSlow = await quiz.submitAnswer('usr_2', match.id, bankQ.correctIndex);
  const slowScore = afterSlow.scores['usr_2'];

  assert.ok(fastScore > slowScore, `faster correct answer (${fastScore}) should score more than a slower one (${slowScore})`);
  assert.ok(fastScore >= 100 && slowScore >= 100, 'both correct answers still get at least the base score');
});

test('a wrong answer scores zero, and a player cannot answer the same question twice', async () => {
  const { quiz, match } = await setup();
  const state0 = await quiz.getState('usr_1', match.id);
  const bankQ = QUESTIONS.find((x) => x.id === state0.question.id);
  const wrongIndex = bankQ.choices.findIndex((_, i) => i !== bankQ.correctIndex);

  const after = await quiz.submitAnswer('usr_1', match.id, wrongIndex);
  assert.equal(after.scores['usr_1'], 0);

  await assert.rejects(() => quiz.submitAnswer('usr_1', match.id, bankQ.correctIndex), (e) => e.status === 409 && /already answered/.test(e.message));
});

test('once every player has answered, the quiz automatically advances to the next question', async () => {
  const { quiz, match } = await setup({ questionsPerMatch: 3 });
  const first = await quiz.getState('usr_1', match.id);
  await quiz.submitAnswer('usr_1', match.id, 0);
  const stillFirst = await quiz.getState('usr_2', match.id);
  assert.equal(stillFirst.questionIndex, 0, 'should not advance until every player has answered');

  const after = await quiz.submitAnswer('usr_2', match.id, 0);
  assert.equal(after.questionIndex, 1, 'advances once the last player answers');
  assert.equal(after.completedQuestions.length, 1);
  assert.equal(after.completedQuestions[0].questionId, first.question.id);
  assert.ok('correctIndex' in after.completedQuestions[0], 'the answer key is only revealed once the question has closed');
});

test('a question that nobody answers in time is closed automatically once the server clock says it expired', async () => {
  const clock = fakeClock(0);
  const { quiz, match } = await setup({ now: clock, questionDurationMs: 5000, questionsPerMatch: 3 });
  await quiz.getState('usr_1', match.id); // opens question 0

  clock.advance(6000); // past the 5s window, nobody answered
  const state = await quiz.getState('usr_1', match.id);
  assert.equal(state.questionIndex, 1, 'auto-advances past an expired, unanswered question');
  assert.equal(state.completedQuestions[0].answers['usr_1'].scoreDelta, 0);
  assert.equal(state.completedQuestions[0].answers['usr_2'].scoreDelta, 0);
});

test('an expired question is never answerable retroactively: submitting after the window closes lands on whatever question is current now, not the stale one', async () => {
  const clock = fakeClock(0);
  const { quiz, match } = await setup({ now: clock, questionDurationMs: 5000, questionsPerMatch: 3 });
  const q0 = await quiz.getState('usr_1', match.id);
  clock.advance(6000); // question 0's window is now closed, nobody answered it

  const after = await quiz.submitAnswer('usr_1', match.id, 0);
  assert.equal(after.questionIndex, 1, 'the server auto-advanced past the expired question');
  assert.equal(after.completedQuestions[0].questionId, q0.question.id);
  assert.equal(after.completedQuestions[0].answers['usr_1'].scoreDelta, 0, 'usr_1 never actually answered question 0 in time');
});

test('answering once the whole quiz has already finished is rejected, not silently accepted', async () => {
  const clock = fakeClock(0);
  const { quiz, match } = await setup({ now: clock, questionDurationMs: 5000, questionsPerMatch: 1 });
  await quiz.getState('usr_1', match.id);
  clock.advance(6000); // the only question's window closes -> quiz finishes
  const state = await quiz.getState('usr_1', match.id);
  assert.equal(state.finished, true);
  await assert.rejects(() => quiz.submitAnswer('usr_1', match.id, 0), (e) => e.status === 409);
});

test('a full quiz to a real, server-detected finish: the highest scorer across every question wins, and the match is really finished server-side', async () => {
  const clock = fakeClock(0);
  const { gameMatches, quiz, match } = await setup({ now: clock, questionDurationMs: 5000, questionsPerMatch: 3 });

  let state;
  for (let i = 0; i < 3; i++) {
    state = await quiz.getState('usr_1', match.id);
    const bankQ = QUESTIONS.find((x) => x.id === state.question.id);
    // usr_1 always answers correctly and fast; usr_2 always answers wrong.
    await quiz.submitAnswer('usr_1', match.id, bankQ.correctIndex);
    const wrongIndex = bankQ.choices.findIndex((_, idx) => idx !== bankQ.correctIndex);
    state = await quiz.submitAnswer('usr_2', match.id, wrongIndex);
  }

  assert.equal(state.finished, true);
  assert.equal(state.winnerId, 'usr_1');
  assert.ok(state.scores['usr_1'] > state.scores['usr_2']);

  const finishedMatch = await gameMatches.findById(match.id);
  assert.equal(finishedMatch.state, 'finished');
  assert.equal(finishedMatch.winnerId, 'usr_1');
  assert.equal(finishedMatch.resultSource, 'server');
  assert.equal(finishedMatch.result.engine, 'quiz');
  assert.equal(finishedMatch.result.totalQuestions, 3);
});

test('a tied final score is a real, honest draw: no winner is fabricated', async () => {
  const clock = fakeClock(0);
  const { gameMatches, quiz, match } = await setup({ now: clock, questionDurationMs: 5000, questionsPerMatch: 2 });

  let state;
  for (let i = 0; i < 2; i++) {
    state = await quiz.getState('usr_1', match.id);
    const bankQ = QUESTIONS.find((x) => x.id === state.question.id);
    // Both players answer wrong every time -> both finish at score 0, a tie.
    const wrongIndex = bankQ.choices.findIndex((_, idx) => idx !== bankQ.correctIndex);
    await quiz.submitAnswer('usr_1', match.id, wrongIndex);
    state = await quiz.submitAnswer('usr_2', match.id, wrongIndex);
  }

  assert.equal(state.finished, true);
  assert.equal(state.winnerId, null, 'a tie must never fabricate a winner');
  const finishedMatch = await gameMatches.findById(match.id);
  assert.equal(finishedMatch.state, 'finished');
  assert.equal(finishedMatch.winnerId, null);
  assert.equal(finishedMatch.result.draw, true);
});

test('reconnect: getState again mid-quiz returns the same question/scores/history (state lives server-side)', async () => {
  const clock = fakeClock(0);
  const { quiz, match } = await setup({ now: clock, questionDurationMs: 5000, questionsPerMatch: 3 });
  const state0 = await quiz.getState('usr_1', match.id);
  const bankQ = QUESTIONS.find((x) => x.id === state0.question.id);
  await quiz.submitAnswer('usr_1', match.id, bankQ.correctIndex);

  const reconnectView = await quiz.getState('usr_2', match.id);
  assert.equal(reconnectView.question.id, state0.question.id);
  assert.deepEqual(reconnectView.answered, ['usr_1']);
  assert.equal(reconnectView.scores['usr_1'], reconnectView.scores['usr_1']);
});
