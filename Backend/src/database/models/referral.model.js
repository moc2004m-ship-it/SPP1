// Stage 23 — Referral model.
//
// A referral code is short and human-typeable (unlike account ids), so it
// gets its own generator instead of reusing crypto.randomUUID() directly.
// Server-generated only -- a client never supplies its own code string.

const crypto = require('node:crypto');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I -- avoids typos
const CODE_LENGTH = 8;
const REFERRAL_REWARD_COINS = 200; // illustrative starting value -- a real product/pricing decision belongs elsewhere, same caveat as gift-catalog.js

function generateReferralCode() {
  let code = '';
  const bytes = crypto.randomBytes(CODE_LENGTH);
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

function generateReferralId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function assertNotSelfReferral(referrerId, refereeId) {
  if (referrerId === refereeId) {
    throw Object.assign(new Error('cannot redeem your own referral code'), { status: 400 });
  }
}

module.exports = {
  CODE_LENGTH,
  REFERRAL_REWARD_COINS,
  generateReferralCode,
  generateReferralId,
  assertNotSelfReferral,
};
