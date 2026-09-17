'use strict';

// Stage 35 Part 4/8 — Word Filter word list.
//
// AUDIT NOTE (see STAGE_35_WORD_FILTER_FINAL_REPORT.md section 2): a
// repository-wide search for wordFilter/word-filter/profanity/banned
// words/forbidden words/blocked words/bad words/content filter/
// moderation filter/blacklist/allowlist/profanityFilter turned up no
// pre-existing forbidden-word list anywhere in this codebase -- no
// config entry, no database-backed record, no admin-managed store. This
// file is a genuinely new addition, not a consolidation of something
// that already existed.
//
// Per this stage's own scope ("do NOT fabricate a huge profanity
// dictionary just to make the feature look complete... do NOT embed
// hundreds of arbitrary words... if the actual policy/list is not
// defined by the repository, document that limitation and create the
// infrastructure in a way that the real list can be supplied/configured
// later"): this is a deliberately small, mundane PLACEHOLDER list --
// just enough for ../services/word-filter.service.js's normalization,
// matching, integration, and tests to be exercised end to end. It is
// NOT a real moderation policy and makes no claim to be one.
//
// Swapping in a real policy list (legal/trust-and-safety-reviewed,
// possibly admin-managed or database-backed) requires touching only
// this one array -- word-filter.service.js and every content path that
// calls it are already written against BANNED_WORDS as an opaque list
// of strings, not against these specific entries.

const BANNED_WORDS = Object.freeze([
  'badword',
  'forbiddenword',
]);

module.exports = { BANNED_WORDS };
