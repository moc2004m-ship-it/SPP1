'use strict';

// Stage 35 Part 4/8 — Word Filter.
//
// The ONLY place banned-word matching logic lives. Every integrated
// content path (chat.service.js private messages, room.model.js
// announcements, feature-platform.js profile name/bio and room name --
// see STAGE_35_WORD_FILTER_FINAL_REPORT.md section 8 for the full list
// and rationale) calls assertCleanContent() below rather than
// reimplementing any of this.
//
// ALGORITHM
// ---------
// A message is split into chunks on whitespace only (`text.split(/\s+/)`)
// -- a "chunk" is whatever the user separated with a space. Each chunk is
// normalized (see normalizeWord below) and compared for EXACT equality
// against the same-normalized banned-word list. Matching is therefore
// word-boundary-aware, never substring-based: this is deliberate, not an
// oversight -- see the "BADWORDSOMELEGITIMATEWORD" example in this
// stage's own instructions. Naive substring matching would censor any
// legitimate word that happens to contain a banned token as a
// sub-string; exact-match-per-chunk does not have that failure mode.
//
// normalizeWord() applies, in order:
//   1. Unicode NFKC normalization -- collapses visually-identical
//      Unicode code point sequences (e.g. full-width Latin letters,
//      certain combining-character forms) to the same representation
//      before anything else runs.
//   2. Lowercasing.
//   3. Stripping every character that is not a Unicode letter or digit
//      -- this is what makes punctuation-separated obfuscation WITHIN a
//      single whitespace-delimited chunk collapse to the same key as
//      the plain word: "b.a.d.w.o.r.d", "b-a-d-w-o-r-d", and "badword"
//      all normalize to the same string. (It also means chunk-internal
//      whitespace-free punctuation such as "badword!" or "badword," is
//      handled the same ordinary way as any other trailing punctuation.)
//   4. Collapsing every run of 2+ identical characters down to 1 --
//      "baaaadword" / "baddword" style repeated-character padding
//      normalizes the same as "badword". This also collapses ordinary
//      doubled letters ("committee" -> "comite"), which is harmless
//      here: the collapsed form is only ever compared against the same-
//      normalized banned-word list, never against the original
//      spelling, so it cannot turn an unrelated word into a false
//      match unless the banned list itself collapses to that string.
//
// KNOWN, DELIBERATELY UNSUPPORTED BYPASSES (see final report section 17
// for the honest, non-exhaustive list this mirrors):
//   - Letter-by-letter spacing across SEPARATE whitespace chunks (e.g.
//     "b a d w o r d", one character per chunk) is not caught. Treating
//     every run of single-character chunks as a candidate word would
//     require a much broader re-segmentation pass and risks false
//     positives on legitimate short interjections; out of scope for
//     this stage's word-boundary-safe design.
//   - A banned word with extra characters glued on with no separator
//     ("badwordxyz") is not caught -- this is the direct, intentional
//     consequence of exact-match-per-chunk matching (see above), traded
//     off against never censoring a legitimate word that merely
//     contains a banned substring.
//   - Leetspeak-style character substitution (e.g. "b4dw0rd") is not
//     normalized/caught. Nothing in this codebase's existing validators
//     does this kind of substitution mapping, and building one blindly
//     would be exactly the "speculative anti-bypass algorithm" this
//     stage's instructions say not to over-engineer.
// These are documented, not silently swallowed -- a real policy list
// combined with these gaps is a real limitation, not a hidden one.

const { BANNED_WORDS } = require('../domain/word-filter-catalog');

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function normalizeWord(raw) {
  let value = String(raw).normalize('NFKC').toLowerCase();
  value = value.replace(/[^\p{L}\p{N}]+/gu, '');
  // Collapse every run of 2+ identical characters down to 1. Applied
  // identically to both the configured banned-word list and every
  // incoming chunk (see NORMALIZED_BANNED below), so "baaaadword",
  // "baddword", and "badword" all normalize to the same key -- and an
  // ordinary word with real doubled letters ("committee" -> "comite")
  // is completely unaffected as a false-positive risk, because it is
  // compared only against the same-normalized banned list, never
  // against the un-collapsed original spelling of anything.
  value = value.replace(/(.)\1+/gu, '$1');
  return value;
}

// Normalized once at module load -- every check at request time is a
// single Set.has() per chunk, not a re-normalization of the whole list
// per message.
const NORMALIZED_BANNED = new Set(BANNED_WORDS.map(normalizeWord));

// Returns the offending raw chunk, or null if the text is clean.
// Deliberately not exported as part of the public rejection path (see
// assertCleanContent) so that callers are not tempted to echo the
// matched word back to a client -- that would hand a caller a live
// oracle to iterate against.
function findBannedChunk(text) {
  if (typeof text !== 'string' || !text) return null;
  const chunks = text.split(/\s+/);
  for (const chunk of chunks) {
    if (!chunk) continue;
    const normalized = normalizeWord(chunk);
    if (normalized && NORMALIZED_BANNED.has(normalized)) {
      return chunk;
    }
  }
  return null;
}

function containsBannedWord(text) {
  return findBannedChunk(text) !== null;
}

// The single enforcement entry point. Rejects (throws a 400) rather
// than masking/replacing the content -- see
// STAGE_35_WORD_FILTER_FINAL_REPORT.md section 10 for why rejection was
// chosen as the smallest coherent behavior, consistent with how every
// other validator already integrated into these same content paths
// (assertValidMessagePayload, assertValidAnnouncement, assertValidPassword,
// etc.) already treats invalid input: throw a 400 synchronously, never
// silently rewrite what the caller sent.
//
// Returns the input unchanged when clean, so call sites can compose it
// inline the same way they already compose requireString()/
// assertValid*() calls (e.g. `assertCleanContent(requireString(x), 'x')`).
function assertCleanContent(text, fieldName = 'content') {
  if (containsBannedWord(text)) {
    throw badRequest(`${fieldName} contains language that is not allowed`);
  }
  return text;
}

module.exports = {
  BANNED_WORDS,
  normalizeWord,
  containsBannedWord,
  assertCleanContent,
};
