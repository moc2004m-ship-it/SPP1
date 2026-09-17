'use strict';
// Stage 35 Part 4/8 -- Word Filter. Tests the centralized implementation
// in isolation (see also chat.service.test.js and feature-platform's
// profile/room tests for the integration points that reuse this).

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  containsBannedWord,
  assertCleanContent,
  normalizeWord,
  BANNED_WORDS,
} = require('../src/services/word-filter.service');

test('clean text passes: containsBannedWord is false and assertCleanContent returns it unchanged', () => {
  assert.equal(containsBannedWord('have a great day everyone'), false);
  assert.equal(assertCleanContent('have a great day everyone', 'message'), 'have a great day everyone');
});

test('a matching banned word alone is detected', () => {
  assert.equal(containsBannedWord(BANNED_WORDS[0]), true);
});

test('a matching banned word inside a normal sentence is detected', () => {
  assert.equal(containsBannedWord(`you are such a ${BANNED_WORDS[0]} honestly`), true);
});

test('matching is case-insensitive', () => {
  assert.equal(containsBannedWord(BANNED_WORDS[0].toUpperCase()), true);
  assert.equal(containsBannedWord(BANNED_WORDS[0][0].toUpperCase() + BANNED_WORDS[0].slice(1)), true);
});

test('surrounding whitespace variation is handled', () => {
  assert.equal(containsBannedWord(`   ${BANNED_WORDS[0]}   `), true);
  assert.equal(containsBannedWord(`hello\n${BANNED_WORDS[0]}\tworld`), true);
});

test('repeated-character padding is handled', () => {
  const padded = BANNED_WORDS[0][0] + BANNED_WORDS[0][0] + BANNED_WORDS[0][0] + BANNED_WORDS[0].slice(1);
  assert.equal(containsBannedWord(padded), true);
});

test('punctuation attached to or separating the letters of a single word is handled', () => {
  assert.equal(containsBannedWord(`${BANNED_WORDS[0]}!`), true);
  assert.equal(containsBannedWord(`${BANNED_WORDS[0]},`), true);
  const dotted = BANNED_WORDS[0].split('').join('.');
  assert.equal(containsBannedWord(dotted), true);
  const dashed = BANNED_WORDS[0].split('').join('-');
  assert.equal(containsBannedWord(dashed), true);
});

test('a legitimate word that merely CONTAINS a banned word as a substring is NOT censored (word-boundary matching, not substring matching)', () => {
  assert.equal(containsBannedWord(`${BANNED_WORDS[0]}somelegitimateword`), false);
  assert.equal(assertCleanContent(`${BANNED_WORDS[0]}somelegitimateword`, 'message'), `${BANNED_WORDS[0]}somelegitimateword`);
});

test('ordinary doubled letters are not mistaken for repeated-character padding', () => {
  // "committee" has real doubled letters (mm, tt, ee) but never 3+ of
  // the same character in a row, and is not itself a banned word.
  assert.equal(containsBannedWord('committee meeting scheduled'), false);
});

test('empty and whitespace-only content is handled (no match, no throw)', () => {
  assert.equal(containsBannedWord(''), false);
  assert.equal(containsBannedWord('   '), false);
  assert.equal(assertCleanContent('', 'message'), '');
});

test('non-string input does not throw inside the matcher', () => {
  assert.equal(containsBannedWord(null), false);
  assert.equal(containsBannedWord(undefined), false);
});

test('excessively long clean content is still handled without error', () => {
  const long = 'word '.repeat(2000).trim();
  assert.equal(containsBannedWord(long), false);
});

test('excessively long content containing a banned word is still detected', () => {
  const long = `word `.repeat(2000) + BANNED_WORDS[0];
  assert.equal(containsBannedWord(long), true);
});

test('Unicode full-width variants normalize the same as ASCII (NFKC)', () => {
  // Full-width Unicode Latin letters for the first banned word,
  // e.g. \uFF42 = fullwidth "b". Only run this check if the banned
  // word is plain ASCII lowercase letters, which the placeholder list is.
  const fullWidth = BANNED_WORDS[0]
    .split('')
    .map((ch) => String.fromCharCode(ch.charCodeAt(0) + 0xFEE0))
    .join('');
  assert.equal(containsBannedWord(fullWidth), true);
});

test('assertCleanContent throws a 400 with the field name on a match, and does not echo the matched word', () => {
  assert.throws(
    () => assertCleanContent(BANNED_WORDS[0], 'bio'),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /^bio /);
      assert.ok(!err.message.includes(BANNED_WORDS[0]));
      return true;
    }
  );
});

test('documented unsupported bypass: letter-by-letter spacing across separate chunks is NOT caught (honest limitation, not a false claim of coverage)', () => {
  const spaced = BANNED_WORDS[0].split('').join(' ');
  assert.equal(containsBannedWord(spaced), false);
});

test('documented unsupported bypass: leetspeak-style substitution is NOT caught', () => {
  // Not asserted against a specific banned word transformation since the
  // placeholder list may not contain vowels to substitute -- this test
  // instead documents, via normalizeWord, that no digit/letter
  // substitution table is applied.
  assert.equal(normalizeWord('b4d'), 'b4d');
});
