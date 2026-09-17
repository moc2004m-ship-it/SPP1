'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryWalletRepository } = require('../src/database/repositories/wallet.repository');
const { createPlatform, FeatureStore } = require('../src/feature-platform');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');
const { createReferralService } = require('../src/services/referral.service');
const { REFERRAL_REWARD_COINS } = require('../src/database/models/referral.model');

function setup() {
  const wallets = new InMemoryWalletRepository();
  const platform = createPlatform({ store: new FeatureStore(new InMemoryFeatureRecordRepository()) });
  const service = createReferralService({ platform, wallets });
  return { wallets, platform, service };
}

test('redeem(): a valid code credits the referrer with the real reward amount, not a fake success', async () => {
  const { wallets, platform, service } = setup();
  const codeRecord = await platform.referral.myCode('usr_referrer');
  const redemption = await service.redeem('usr_referee', codeRecord.code);
  assert.equal(redemption.status, 'completed');
  assert.equal(redemption.referrerId, 'usr_referrer');
  assert.equal(redemption.refereeId, 'usr_referee');
  const balance = await wallets.getBalance('usr_referrer');
  assert.equal(balance.coins, REFERRAL_REWARD_COINS);
});

test('redeem(): the redemption record is linked to a real wallet transaction id', async () => {
  const { platform, service } = setup();
  const codeRecord = await platform.referral.myCode('usr_referrer');
  const redemption = await service.redeem('usr_referee', codeRecord.code);
  assert.ok(redemption.walletTransactionId);
  assert.match(redemption.walletTransactionId, /^wtx_/);
});

test('redeem(): rejects an unknown code (404), never invents a referrer', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.redeem('usr_referee', 'NOPE0000'),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});

test('redeem(): rejects self-referral', async () => {
  const { platform, service } = setup();
  const codeRecord = await platform.referral.myCode('usr_1');
  await assert.rejects(
    () => service.redeem('usr_1', codeRecord.code),
    (err) => { assert.equal(err.status, 400); return true; }
  );
});

test('redeem(): the same user cannot redeem twice, even a different referrer\'s code, and the second attempt credits nothing', async () => {
  const { wallets, platform, service } = setup();
  const codeA = await platform.referral.myCode('usr_referrer_a');
  const codeB = await platform.referral.myCode('usr_referrer_b');
  await service.redeem('usr_referee', codeA.code);
  await assert.rejects(
    () => service.redeem('usr_referee', codeB.code),
    (err) => { assert.equal(err.status, 409); return true; }
  );
  // referrer B must NOT have been credited by the rejected second attempt
  const balanceB = await wallets.getBalance('usr_referrer_b');
  assert.equal(balanceB.coins, 0);
});

test('redeem(): two different referees can redeem the same referrer\'s code, and each credit is separate (no double-count, no missed credit)', async () => {
  const { wallets, platform, service } = setup();
  const codeRecord = await platform.referral.myCode('usr_referrer');
  await service.redeem('usr_referee_1', codeRecord.code);
  await service.redeem('usr_referee_2', codeRecord.code);
  const balance = await wallets.getBalance('usr_referrer');
  assert.equal(balance.coins, REFERRAL_REWARD_COINS * 2);
});
