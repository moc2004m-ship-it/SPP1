'use strict';
// Stage 21 — Quiz rules engine.
//
// The real, server-side per-game rules engine for the quiz game listed in
// ../domain/game-catalog.js. This is the ONLY code path that ever calls
// gameMatchService.finishMatch() for a quiz match, and it only ever does
// so once every question in the match has actually been played out
// server-side (answered or timed out) -- never from a client-declared
// winner or client-declared score.
//
// The question bank (../domain/quiz-bank.js) never sends a client the
// correct answer for a question that is still open -- publicQuestion()
// strips it. The correct answer for a question only ever appears in a
// response once that question itself has closed (via completedQuestions
// below), same "reveal only after it can no longer be gamed" boundary a
// server-authoritative quiz needs.
//
// Timing is server-authoritative: `now` is an optional constructor
// dependency (defaults to Date.now) purely so tests can advance a fake
// clock deterministically instead of sleeping in real time; every real
// caller (src/index.js) uses the default. A client's own clock is never
// consulted for anything -- elapsed/remaining time is always computed
// against this server clock and questionStartedAt, both set here.
//
// State lives in an in-memory Map keyed by matchId -- same posture as
// snakes-ladders.service.js (see that file's header for the reconnect/
// persistence tradeoff, identical here).

const { QUESTIONS, pickQuestionIndices, publicQuestion, isCorrect } = require('../domain/quiz-bank');

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}
function conflict(message) {
  return Object.assign(new Error(message), { status: 409 });
}

const DEFAULT_QUESTION_DURATION_MS = 15000;
const DEFAULT_QUESTIONS_PER_MATCH = 5;
const CORRECT_BASE_SCORE = 100;
const SPEED_BONUS_MAX = 50;

function createQuizService({ gameMatchService, now, questionDurationMs, questionsPerMatch }) {
  const nowFn = now || Date.now;
  const duration = questionDurationMs || DEFAULT_QUESTION_DURATION_MS;
  const perMatch = questionsPerMatch || DEFAULT_QUESTIONS_PER_MATCH;
  const quizzes = new Map(); // matchId -> quiz state

  async function _loadActiveMatch(actorId, matchId) {
    const match = await gameMatchService.getMatch(actorId, matchId);
    if (match.gameId !== 'quiz') throw badRequest('this match is not a Quiz match');
    return match;
  }

  function _getOrInitQuiz(match) {
    let state = quizzes.get(match.id);
    if (!state) {
      const order = pickQuestionIndices(Math.min(perMatch, QUESTIONS.length));
      state = {
        matchId: match.id,
        playerIds: match.playerIds.slice(),
        order,
        currentIndex: 0,
        questionStartedAt: nowFn(),
        answers: { 0: {} },
        scores: Object.fromEntries(match.playerIds.map((p) => [p, 0])),
        finished: false,
        winnerId: null,
        completedQuestions: [],
      };
      quizzes.set(match.id, state);
    }
    return state;
  }

  function _scoreFor(correct, elapsedMs) {
    if (!correct) return 0;
    const remaining = Math.max(0, duration - elapsedMs);
    return CORRECT_BASE_SCORE + Math.round((SPEED_BONUS_MAX * remaining) / duration);
  }

  async function _finalizeCurrentAndAdvance(state) {
    const idx = state.currentIndex;
    const qIndex = state.order[idx];
    const q = QUESTIONS[qIndex];
    // Any player who never answered this question in time gets a real,
    // recorded zero -- never silently omitted, so the leaderboard/history
    // always accounts for every player on every question.
    for (const p of state.playerIds) {
      if (!state.answers[idx][p]) {
        state.answers[idx][p] = { choiceIndex: null, correct: false, scoreDelta: 0, answeredAt: null };
      }
    }
    state.completedQuestions.push({
      questionId: q.id,
      text: q.text,
      correctIndex: q.correctIndex,
      answers: { ...state.answers[idx] },
    });

    if (idx === state.order.length - 1) {
      const maxScore = Math.max(...Object.values(state.scores));
      const winners = state.playerIds.filter((p) => state.scores[p] === maxScore);
      const winnerId = winners.length === 1 ? winners[0] : null;
      state.finished = true;
      state.winnerId = winnerId;
      await gameMatchService.finishMatch(state.matchId, {
        winnerId,
        result: { engine: 'quiz', scores: { ...state.scores }, totalQuestions: state.order.length, draw: winners.length !== 1 },
      });
    } else {
      state.currentIndex += 1;
      state.answers[state.currentIndex] = {};
      state.questionStartedAt = nowFn();
    }
  }

  // Advances the quiz past any question whose timer has already expired
  // or which every player has already answered -- called at the top of
  // every read/write below so state is always caught up with the server
  // clock before it is read or mutated, with no background timer needed.
  async function _tick(state) {
    while (!state.finished) {
      const answeredCount = Object.keys(state.answers[state.currentIndex] || {}).length;
      const allAnswered = answeredCount >= state.playerIds.length;
      const expired = nowFn() - state.questionStartedAt >= duration;
      if (!allAnswered && !expired) break;
      await _finalizeCurrentAndAdvance(state);
    }
  }

  function _publicState(state) {
    if (state.finished) {
      return {
        matchId: state.matchId,
        started: true,
        totalQuestions: state.order.length,
        questionIndex: state.order.length - 1,
        finished: true,
        winnerId: state.winnerId,
        scores: { ...state.scores },
        timeRemainingMs: 0,
        question: null,
        answered: [],
        completedQuestions: state.completedQuestions.slice(),
      };
    }
    return {
      matchId: state.matchId,
      started: true,
      totalQuestions: state.order.length,
      questionIndex: state.currentIndex,
      finished: false,
      winnerId: null,
      scores: { ...state.scores },
      timeRemainingMs: Math.max(0, duration - (nowFn() - state.questionStartedAt)),
      question: publicQuestion(state.order[state.currentIndex]),
      answered: Object.keys(state.answers[state.currentIndex] || {}),
      completedQuestions: state.completedQuestions.slice(),
    };
  }

  async function getState(actorId, matchId) {
    const match = await _loadActiveMatch(actorId, matchId);
    if (match.state === 'lobby') {
      return { matchId: match.id, started: false, totalQuestions: null, questionIndex: null, finished: false, winnerId: null, scores: null, timeRemainingMs: null, question: null, answered: [], completedQuestions: [] };
    }
    const state = _getOrInitQuiz(match);
    await _tick(state);
    return _publicState(state);
  }

  async function submitAnswer(actorId, matchId, choiceIndex) {
    const match = await _loadActiveMatch(actorId, matchId);
    if (match.state !== 'active') throw conflict(`match is ${match.state}, not active -- start it first`);
    const state = _getOrInitQuiz(match);
    await _tick(state);
    if (state.finished) throw conflict('this quiz has already finished');

    const qIndex = state.order[state.currentIndex];
    const choices = QUESTIONS[qIndex].choices;
    if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= choices.length) {
      throw badRequest(`choiceIndex must be an integer between 0 and ${choices.length - 1}`);
    }
    if (state.answers[state.currentIndex][actorId]) {
      throw conflict('you already answered this question');
    }
    const elapsed = nowFn() - state.questionStartedAt;
    if (elapsed >= duration) throw conflict('time is up for this question');

    const correct = isCorrect(qIndex, choiceIndex);
    const scoreDelta = _scoreFor(correct, elapsed);
    state.answers[state.currentIndex][actorId] = { choiceIndex, correct, scoreDelta, answeredAt: nowFn() };
    state.scores[actorId] += scoreDelta;

    await _tick(state);
    return _publicState(state);
  }

  return { getState, submitAnswer };
}

module.exports = { createQuizService };
