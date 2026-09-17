'use strict';

// Stage 12 — Create Room password hashing.
//
// Why scrypt (via node:crypto, zero new dependencies) instead of the
// sha256-of-value approach in ../auth/auth.store.js: that helper hashes
// short-lived, high-entropy, server-generated values (OTP codes, session
// tokens) where a fast hash is fine. A room password is chosen by a
// human and may be low-entropy, so it gets a real per-room random salt
// and a deliberately slow KDF (scrypt) instead -- the same reasoning
// that would apply to an account password, applied here because this
// backend has no bcrypt/argon2 dependency available (no network access
// to `npm install`, same constraint documented in
// ../security/rate-limit.js and ../security/headers.js).
//
// Stored format is a single string: `${saltHex}:${hashHex}`, so the
// salt travels with the hash and nothing else needs to remember it.

const crypto = require('node:crypto');

const SALT_BYTES = 16;
const KEY_LENGTH = 64;

function hashRoomPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

// Constant-time comparison (crypto.timingSafeEqual) so verifying a
// room password does not leak timing information about how much of it
// was correct. Returns false (never throws) for a malformed/corrupt
// stored hash instead of crashing the caller -- verifying against
// unexpected data should behave like "wrong password", not a 500.
function verifyRoomPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const separatorIndex = stored.indexOf(':');
  if (separatorIndex === -1) return false;
  const saltHex = stored.slice(0, separatorIndex);
  const hashHex = stored.slice(separatorIndex + 1);
  let salt;
  let expected;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;
  const actual = crypto.scryptSync(password, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { hashRoomPassword, verifyRoomPassword };
