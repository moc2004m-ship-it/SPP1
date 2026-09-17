// Stage 23 — Referral redemption service.
//
// The ONLY code path that may redeem a referral code. Same shape as
// gifts.service.js: the state-changing side effect that must never be
// faked (crediting a real wallet balance) happens here, not in
// feature-platform.js, which only knows about feature records.
//
// Redemption is one-per-referee, enforced twice: once as a fast
// pre-check (platform.referral.hasRedeemed) and again implicitly by the
// wallet idempotency key being derived from the redemption record's own
// id, so even a racing double-call can't double-credit the same referrer
// for the same referee.

const { REFERRAL_REWARD_COINS, assertNotSelfReferral } = require('../database/models/referral.model');

function createReferralService({ platform, wallets }) {
  async function redeem(refereeId, code) {
    const codeRecord = await platform.referral.findByCode(code);
    if (!codeRecord) throw Object.assign(new Error('invalid referral code'), { status: 404 });

    assertNotSelfReferral(codeRecord.ownerId, refereeId);

    const alreadyRedeemed = await platform.referral.hasRedeemed(refereeId);
    if (alreadyRedeemed) {
      throw Object.assign(new Error('you have already redeemed a referral code'), { status: 409 });
    }

    const redemption = await platform.store.add(23, {
      type: 'redemption',
      referrerId: codeRecord.ownerId,
      refereeId,
      code,
      rewardCoins: REFERRAL_REWARD_COINS,
      status: 'pending',
    });

    // idempotencyKey = the redemption's own id -- this wallet credit can
    // never be replayed under a different id, so it can never apply twice
    // even if this whole function were retried end-to-end.
    const walletTransaction = await wallets.credit(codeRecord.ownerId, 'coins', REFERRAL_REWARD_COINS, redemption.id);

    return platform.store.update(23, redemption.id, {
      status: 'completed',
      walletTransactionId: walletTransaction.id,
    });
  }

  return { redeem };
}

module.exports = { createReferralService };
