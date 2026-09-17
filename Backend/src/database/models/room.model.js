'use strict';

// Stage 12 — Create Room model.
//
// Same boundary as chat.model.js: nothing here accepts an unvalidated
// client value for a field that other code (discovery filters, the
// mobile client, moderation) treats as structured data. Every optional
// field below has an explicit, documented default so that every
// pre-Stage-12 caller of rooms.create() -- which only ever passed
// {ownerId, name[, capacity]} -- gets byte-for-byte the same room shape
// it always got, plus the new fields at their defaults.

const ROOM_VISIBILITIES = Object.freeze(['public', 'private']);
const DEFAULT_VISIBILITY = 'public';

const MIN_MIC_SEATS = 1;
const MAX_MIC_SEATS = 15;
const DEFAULT_MIC_SEATS = 8;

const MAX_TAGS = 8;
const MAX_TAG_LENGTH = 24;

const MAX_ANNOUNCEMENT_LENGTH = 300;
const MAX_URL_LENGTH = 2000;

const MIN_PASSWORD_LENGTH = 4;
const MAX_PASSWORD_LENGTH = 100;

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

// Stage 35 Part 4/8 -- Word Filter. See ../../services/word-filter.service.js
// for the centralized implementation. Reused here (not reimplemented)
// so that room announcements are checked with the exact same
// normalization/matching rules as every other integrated content path.
const { assertCleanContent } = require('../../services/word-filter.service');

// visibility -- strictly 'public' or 'private' when provided (the
// pre-Stage-12 code accepted `input.visibility||'public'`, i.e. ANY
// truthy string at all, which meant e.g. visibility:'hidden' silently
// became a third, undocumented state that discovery/RTC access code
// never accounted for). Omitted -> 'public', unchanged default.
function assertValidVisibility(visibility) {
  if (visibility === undefined || visibility === null) return DEFAULT_VISIBILITY;
  if (!ROOM_VISIBILITIES.includes(visibility)) {
    throw badRequest(`visibility must be one of ${ROOM_VISIBILITIES.join(', ')}`);
  }
  return visibility;
}

// micSeats -- the pre-Stage-12 code accepted any integer at all
// (including 0 or negative), with no upper bound either. Omitted ->
// 8, unchanged default; provided -> must be a real, sane seat count.
function assertValidMicSeats(micSeats) {
  if (micSeats === undefined || micSeats === null) return DEFAULT_MIC_SEATS;
  if (!Number.isInteger(micSeats) || micSeats < MIN_MIC_SEATS || micSeats > MAX_MIC_SEATS) {
    throw badRequest(`micSeats must be an integer between ${MIN_MIC_SEATS} and ${MAX_MIC_SEATS}`);
  }
  return micSeats;
}

// tags -- free-form (not a fixed catalog, see room-catalog.js's header),
// but bounded and cleaned: trimmed, deduplicated case-insensitively
// (first occurrence wins), at most MAX_TAGS entries of at most
// MAX_TAG_LENGTH characters each. Omitted -> [], not an error.
function normalizeTags(tags) {
  if (tags === undefined || tags === null) return [];
  if (!Array.isArray(tags)) throw badRequest('tags must be an array of strings');
  if (tags.length > MAX_TAGS) throw badRequest(`tags must contain at most ${MAX_TAGS} entries`);
  const seen = new Set();
  const cleaned = [];
  for (const rawTag of tags) {
    if (typeof rawTag !== 'string' || !rawTag.trim() || rawTag.trim().length > MAX_TAG_LENGTH) {
      throw badRequest(`each tag must be a non-empty string of at most ${MAX_TAG_LENGTH} characters`);
    }
    const trimmed = rawTag.trim();
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      cleaned.push(trimmed);
    }
  }
  return cleaned;
}

// cover/background -- same "a URL the client already has hosted
// somewhere" boundary as chat.model.js's image messages: this backend
// has no CDN/upload pipeline of its own, so these are validated as
// well-formed http(s) URLs, never resolved against a fixed catalog (a
// room's cover art is arbitrary user content, unlike theme/category/
// language/ageRule which are real enums -- see room-catalog.js).
// Omitted/null -> null, not an error.
function assertValidImageUrl(url, fieldName) {
  if (url === undefined || url === null) return null;
  if (typeof url !== 'string' || !url.trim() || url.length > MAX_URL_LENGTH) {
    throw badRequest(`${fieldName} must be an http(s) URL`);
  }
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw badRequest(`${fieldName} must be an http(s) URL`);
  }
  return trimmed;
}

// announcement -- an optional pinned message shown to everyone in the
// room. Omitted/null -> null. Provided -> must be real (non-empty
// after trim) text within the length bound, same "reject garbage
// instead of silently coercing it" discipline as name/body validation
// everywhere else in this codebase.
function assertValidAnnouncement(announcement) {
  if (announcement === undefined || announcement === null) return null;
  if (typeof announcement !== 'string' || !announcement.trim() || announcement.length > MAX_ANNOUNCEMENT_LENGTH) {
    throw badRequest(`announcement must be a non-empty string of at most ${MAX_ANNOUNCEMENT_LENGTH} characters`);
  }
  const trimmed = announcement.trim();
  // Word Filter runs after the structural checks above (so a malformed
  // announcement is rejected for that reason first) and applies
  // regardless of caller: this function is the one place BOTH
  // rooms.create() and the per-key room settings update path (see
  // feature-platform.js's _applyRoomSettingUpdate/'announcement' case)
  // validate an announcement, so both are covered by this single edit.
  return assertCleanContent(trimmed, 'announcement');
}

// password -- an optional room lock (see ../../security/room-password.js
// for the actual hash/verify). Omitted/null/'' -> null (no password,
// the default -- every pre-Stage-12 room/test is completely
// unaffected). Provided -> must be real text within sane bounds; the
// plaintext itself never leaves this function (the caller hashes it
// immediately and only the hash is ever persisted -- see
// feature-platform.js rooms.create()).
function assertValidPassword(password) {
  if (password === undefined || password === null || password === '') return null;
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw badRequest(`password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`);
  }
  return password;
}

// The only place a room record is shaped for a client response.
// Strips passwordHash unconditionally -- a room's password hash must
// never reach any client, host or not (the host already knows their
// own password; they don't need it echoed back, and a hash is not a
// "forgot password" recovery mechanism). `hasPassword` (already stored
// on the record at creation time, see rooms.create()) tells a client
// whether to prompt for a password before joining, without revealing
// anything about the password itself.
function sanitizeRoomForClient(room) {
  const { passwordHash, ...safe } = room;
  return safe;
}

module.exports = {
  ROOM_VISIBILITIES,
  DEFAULT_VISIBILITY,
  MIN_MIC_SEATS,
  MAX_MIC_SEATS,
  DEFAULT_MIC_SEATS,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  MAX_ANNOUNCEMENT_LENGTH,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  assertValidVisibility,
  assertValidMicSeats,
  normalizeTags,
  assertValidImageUrl,
  assertValidAnnouncement,
  assertValidPassword,
  sanitizeRoomForClient,
};
