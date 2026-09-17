'use strict';
// Stage 12 — Create Room: database/models/room.model.js.
// Same style as chat.model.test.js: every optional field's documented
// default when omitted, every explicit valid value accepted unchanged,
// and every malformed explicit value rejected with a 400 -- never
// silently coerced.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_VISIBILITY, DEFAULT_MIC_SEATS, MIN_MIC_SEATS, MAX_MIC_SEATS,
  MAX_TAGS, MAX_TAG_LENGTH, MAX_ANNOUNCEMENT_LENGTH,
  MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH,
  assertValidVisibility, assertValidMicSeats, normalizeTags,
  assertValidImageUrl, assertValidAnnouncement, assertValidPassword,
  sanitizeRoomForClient,
} = require('../src/database/models/room.model');

function badRequest(fn) {
  assert.throws(fn, (err) => err.status === 400);
}

// --- visibility -------------------------------------------------------
test('assertValidVisibility(): omitted/null -> DEFAULT_VISIBILITY ("public")', () => {
  assert.equal(assertValidVisibility(undefined), DEFAULT_VISIBILITY);
  assert.equal(assertValidVisibility(null), DEFAULT_VISIBILITY);
});
test('assertValidVisibility(): "public"/"private" pass through unchanged', () => {
  assert.equal(assertValidVisibility('public'), 'public');
  assert.equal(assertValidVisibility('private'), 'private');
});
test('assertValidVisibility(): any other value is rejected (was previously silently accepted)', () => {
  badRequest(() => assertValidVisibility('hidden'));
  badRequest(() => assertValidVisibility(''));
  badRequest(() => assertValidVisibility(123));
});

// --- micSeats -----------------------------------------------------------
test('assertValidMicSeats(): omitted/null -> DEFAULT_MIC_SEATS (8)', () => {
  assert.equal(assertValidMicSeats(undefined), DEFAULT_MIC_SEATS);
  assert.equal(assertValidMicSeats(null), DEFAULT_MIC_SEATS);
});
test('assertValidMicSeats(): accepts the full inclusive [MIN,MAX] range', () => {
  assert.equal(assertValidMicSeats(MIN_MIC_SEATS), MIN_MIC_SEATS);
  assert.equal(assertValidMicSeats(MAX_MIC_SEATS), MAX_MIC_SEATS);
  assert.equal(assertValidMicSeats(10), 10);
});
test('assertValidMicSeats(): rejects 0, negative, non-integer, and above-max (all previously accepted)', () => {
  badRequest(() => assertValidMicSeats(0));
  badRequest(() => assertValidMicSeats(-3));
  badRequest(() => assertValidMicSeats(3.5));
  badRequest(() => assertValidMicSeats(MAX_MIC_SEATS + 1));
  badRequest(() => assertValidMicSeats('8'));
});

// --- tags ---------------------------------------------------------------
test('normalizeTags(): omitted/null -> []', () => {
  assert.deepEqual(normalizeTags(undefined), []);
  assert.deepEqual(normalizeTags(null), []);
});
test('normalizeTags(): trims whitespace and deduplicates case-insensitively, first occurrence wins', () => {
  assert.deepEqual(normalizeTags([' Music ', 'music', 'MUSIC', 'chill']), ['Music', 'chill']);
});
test('normalizeTags(): rejects a non-array, more than MAX_TAGS entries, a non-string entry, an empty/whitespace-only entry, and an over-length entry', () => {
  badRequest(() => normalizeTags('music'));
  badRequest(() => normalizeTags(Array.from({ length: MAX_TAGS + 1 }, (_, i) => `t${i}`)));
  badRequest(() => normalizeTags([123]));
  badRequest(() => normalizeTags(['   ']));
  badRequest(() => normalizeTags(['x'.repeat(MAX_TAG_LENGTH + 1)]));
});
test('normalizeTags(): accepts exactly MAX_TAGS entries of exactly MAX_TAG_LENGTH characters', () => {
  const tags = Array.from({ length: MAX_TAGS }, (_, i) => 'x'.repeat(MAX_TAG_LENGTH - String(i).length) + i);
  const result = normalizeTags(tags);
  assert.equal(result.length, MAX_TAGS);
});

// --- cover/background (image URLs) --------------------------------------
test('assertValidImageUrl(): omitted/null -> null', () => {
  assert.equal(assertValidImageUrl(undefined, 'cover'), null);
  assert.equal(assertValidImageUrl(null, 'cover'), null);
});
test('assertValidImageUrl(): a well-formed http(s) URL is trimmed and accepted', () => {
  assert.equal(assertValidImageUrl('  https://cdn.example.com/cover.png  ', 'cover'), 'https://cdn.example.com/cover.png');
  assert.equal(assertValidImageUrl('http://cdn.example.com/bg.png', 'background'), 'http://cdn.example.com/bg.png');
});
test('assertValidImageUrl(): rejects a non-http(s) scheme, an empty string, and an over-length value, naming the field in the error', () => {
  assert.throws(() => assertValidImageUrl('ftp://cdn.example.com/x.png', 'cover'), (err) => err.status === 400 && /cover must be an http\(s\) URL/.test(err.message));
  badRequest(() => assertValidImageUrl('   ', 'cover'));
  badRequest(() => assertValidImageUrl('https://x.com/' + 'a'.repeat(2001), 'cover'));
});

// --- announcement ---------------------------------------------------------
test('assertValidAnnouncement(): omitted/null -> null', () => {
  assert.equal(assertValidAnnouncement(undefined), null);
  assert.equal(assertValidAnnouncement(null), null);
});
test('assertValidAnnouncement(): a real string is trimmed and accepted; empty/whitespace-only and over-length are rejected', () => {
  assert.equal(assertValidAnnouncement('  Welcome!  '), 'Welcome!');
  badRequest(() => assertValidAnnouncement('   '));
  badRequest(() => assertValidAnnouncement('a'.repeat(MAX_ANNOUNCEMENT_LENGTH + 1)));
});

// --- password ---------------------------------------------------------------
test('assertValidPassword(): omitted/null/empty-string -> null (no password, the default)', () => {
  assert.equal(assertValidPassword(undefined), null);
  assert.equal(assertValidPassword(null), null);
  assert.equal(assertValidPassword(''), null);
});
test('assertValidPassword(): a value within [MIN,MAX] length passes through unchanged', () => {
  const pwd = 'a'.repeat(MIN_PASSWORD_LENGTH);
  assert.equal(assertValidPassword(pwd), pwd);
  const maxPwd = 'b'.repeat(MAX_PASSWORD_LENGTH);
  assert.equal(assertValidPassword(maxPwd), maxPwd);
});
test('assertValidPassword(): rejects too-short, too-long, and non-string values', () => {
  badRequest(() => assertValidPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1)));
  badRequest(() => assertValidPassword('a'.repeat(MAX_PASSWORD_LENGTH + 1)));
  badRequest(() => assertValidPassword(12345678));
});

// --- sanitizeRoomForClient ---------------------------------------------------
test('sanitizeRoomForClient(): strips passwordHash unconditionally and preserves every other field, including hasPassword', () => {
  const room = { id: 'room_1', name: 'Test', hasPassword: true, passwordHash: 'deadbeef:cafebabe', ownerId: 'usr_1' };
  const safe = sanitizeRoomForClient(room);
  assert.equal(safe.passwordHash, undefined);
  assert.equal('passwordHash' in safe, false);
  assert.equal(safe.hasPassword, true);
  assert.equal(safe.id, 'room_1');
  assert.equal(safe.name, 'Test');
  assert.equal(safe.ownerId, 'usr_1');
});
test('sanitizeRoomForClient(): a room with no password (passwordHash: null) is unaffected', () => {
  const room = { id: 'room_2', hasPassword: false, passwordHash: null };
  const safe = sanitizeRoomForClient(room);
  assert.equal('passwordHash' in safe, false);
  assert.equal(safe.hasPassword, false);
});
