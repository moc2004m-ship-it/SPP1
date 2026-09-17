'use strict';
// Stage 21 — Quiz question bank.
//
// Server-only concern: a client is NEVER sent correctIndex, and never
// sent any question at all before its own timed turn -- see
// ../services/quiz.service.js#getCurrentQuestion, the only place a
// question is ever shaped for a client response (via publicQuestion()
// below, which strips correctIndex). Nothing in this file is reachable
// from a client-facing route directly.

const QUESTIONS = Object.freeze([
  Object.freeze({ id: 'q01', text: 'What is the capital of France?', choices: Object.freeze(['Berlin', 'Madrid', 'Paris', 'Rome']), correctIndex: 2 }),
  Object.freeze({ id: 'q02', text: 'How many continents are there on Earth?', choices: Object.freeze(['5', '6', '7', '8']), correctIndex: 2 }),
  Object.freeze({ id: 'q03', text: 'Which planet is known as the Red Planet?', choices: Object.freeze(['Venus', 'Mars', 'Jupiter', 'Saturn']), correctIndex: 1 }),
  Object.freeze({ id: 'q04', text: 'What is the chemical symbol for water?', choices: Object.freeze(['H2O', 'CO2', 'O2', 'NaCl']), correctIndex: 0 }),
  Object.freeze({ id: 'q05', text: 'Who wrote the play "Romeo and Juliet"?', choices: Object.freeze(['Charles Dickens', 'William Shakespeare', 'Mark Twain', 'Leo Tolstoy']), correctIndex: 1 }),
  Object.freeze({ id: 'q06', text: 'What is the largest ocean on Earth?', choices: Object.freeze(['Atlantic', 'Indian', 'Arctic', 'Pacific']), correctIndex: 3 }),
  Object.freeze({ id: 'q07', text: 'How many legs does a spider have?', choices: Object.freeze(['6', '8', '10', '12']), correctIndex: 1 }),
  Object.freeze({ id: 'q08', text: 'What is the smallest prime number?', choices: Object.freeze(['0', '1', '2', '3']), correctIndex: 2 }),
  Object.freeze({ id: 'q09', text: 'Which gas do plants primarily absorb from the air?', choices: Object.freeze(['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen']), correctIndex: 2 }),
  Object.freeze({ id: 'q10', text: 'In which year did the Titanic sink?', choices: Object.freeze(['1905', '1912', '1920', '1931']), correctIndex: 1 }),
  Object.freeze({ id: 'q11', text: 'What is the currency of Japan?', choices: Object.freeze(['Won', 'Yuan', 'Yen', 'Ringgit']), correctIndex: 2 }),
  Object.freeze({ id: 'q12', text: 'How many players are on a standard soccer team on the field?', choices: Object.freeze(['9', '10', '11', '12']), correctIndex: 2 }),
]);

function questionCount() {
  return QUESTIONS.length;
}

// Picks `count` distinct question indices via a server-side crypto
// shuffle (Fisher-Yates) -- never influenced by client input, never
// re-derivable by a client from the matchId, never repeated within the
// same match.
function pickQuestionIndices(count) {
  const crypto = require('node:crypto');
  const indices = QUESTIONS.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, Math.min(count, indices.length));
}

// The ONLY shape of a question ever allowed to leave the server -- no
// correctIndex.
function publicQuestion(index) {
  const q = QUESTIONS[index];
  return { id: q.id, text: q.text, choices: q.choices.slice() };
}

function isCorrect(index, choiceIndex) {
  return QUESTIONS[index].correctIndex === choiceIndex;
}

module.exports = { QUESTIONS, questionCount, pickQuestionIndices, publicQuestion, isCorrect };
