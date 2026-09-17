'use strict';

// Stage 17 — Music/DJ model.
//
// Same boundary as room.model.js/chat.model.js: nothing here accepts an
// unvalidated client value for a field that other code (the queue,
// playback control, the mobile client) treats as structured data.
//
// This backend has no file-upload/CDN/streaming pipeline of its own
// (documented precedent: room.model.js's cover/background, chat.model.js's
// image messages) -- a queued track's `url` is, the same way, a
// ready-to-stream http(s) URL the client already has hosted somewhere,
// never a raw file upload or a resolved-server-side catalog id.

const { assertCleanContent } = require('../../services/word-filter.service');

const MAX_TITLE_LENGTH = 160;
const MAX_URL_LENGTH = 2000;
const MIN_DURATION_SECONDS = 1;
const MAX_DURATION_SECONDS = 60 * 60; // 1 hour -- a sane upper bound for a single queued track
const MIN_VOLUME = 0;
const MAX_VOLUME = 100;
const DEFAULT_VOLUME = 70;

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

// title -- required, real (non-empty after trim) text within the length
// bound, word-filtered the same way room announcements/chat text are
// (reuses the centralized word-filter.service.js, never a second
// implementation).
function assertValidTrackTitle(title) {
  if (typeof title !== 'string' || !title.trim() || title.length > MAX_TITLE_LENGTH) {
    throw badRequest(`title must be a non-empty string of at most ${MAX_TITLE_LENGTH} characters`);
  }
  return assertCleanContent(title.trim(), 'title');
}

// url -- required http(s) URL, same shape/bound as room.model.js's
// assertValidImageUrl, just required instead of optional (a queue entry
// with no playable source is meaningless).
function assertValidTrackUrl(url) {
  if (typeof url !== 'string' || !url.trim() || url.length > MAX_URL_LENGTH) {
    throw badRequest('url must be an http(s) URL');
  }
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw badRequest('url must be an http(s) URL');
  }
  return trimmed;
}

// durationSec -- optional. Omitted/null -> null (client may not know the
// duration up front); provided -> must be a real, sane positive integer.
function assertValidDurationSeconds(durationSec) {
  if (durationSec === undefined || durationSec === null) return null;
  if (!Number.isInteger(durationSec) || durationSec < MIN_DURATION_SECONDS || durationSec > MAX_DURATION_SECONDS) {
    throw badRequest(`durationSec must be an integer between ${MIN_DURATION_SECONDS} and ${MAX_DURATION_SECONDS}`);
  }
  return durationSec;
}

// volume -- required on setVolume() (no ambiguous default there), must be
// a real integer 0-100.
function assertValidVolume(volume) {
  if (!Number.isInteger(volume) || volume < MIN_VOLUME || volume > MAX_VOLUME) {
    throw badRequest(`volume must be an integer between ${MIN_VOLUME} and ${MAX_VOLUME}`);
  }
  return volume;
}

module.exports = {
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  MIN_DURATION_SECONDS,
  MAX_DURATION_SECONDS,
  MIN_VOLUME,
  MAX_VOLUME,
  DEFAULT_VOLUME,
  assertValidTrackTitle,
  assertValidTrackUrl,
  assertValidDurationSeconds,
  assertValidVolume,
};
