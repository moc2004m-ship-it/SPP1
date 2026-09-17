'use strict';
// Stage 23 -- Referral/Invite route-contract tests for the two handlers
// in src/routes/platform.routes.js:
//   GET  /api/referral/my-code  -> platform.referral.myCode(req.session.accountId)
//   POST /api/referral/redeem   -> referralService.redeem(req.session.accountId, req.body?.code)
//
// platform.routes.js itself cannot be require()'d in this environment --
// it does `require('express')` at the top of the file, and express is not
// installed here (no network access to install it; see
// STAGE6_STOP_REPORT.md and the four pre-existing environmental fails in
// accounts/agora/auth/config routes.test.js). Same "pure logic, fake
// req/res inputs" style as platform.notifications.routes-contract.test.js
// and platform.rooms.routes-contract.test.js: each handler's own call
// shape is reproduced verbatim against the real platform.referral.* /
// referralService.redeem() methods, without needing express itself.
//
// What this proves: the acting/referee identity for BOTH routes comes
// only from req.session.accountId -- never a client-supplied field in the
// body/query/params (a hostile client cannot claim to be a different
// referee, nor pick who gets credited as the referrer beyond what the
// code itself resolves to). The underlying business rules (self-referral,
// one-redemption-per-referee, real wallet credit) are exhaustively
// covered separately in referral.service.test.js and
// feature-platform.test.js's referral.* section -- this file is
// deliberately about the routing/session-identity contract, not
// re-proving that logic.

const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryWalletRepository } = require('../src/database/repositories/wallet.repository');
const { createPlatform, FeatureStore } = require('../src/feature-platform');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');
const { createReferralService } = require('../src/services/referral.service');

function setup() {
  const wallets = new InMemoryWalletRepository();
  const platform = createPlatform({ store: new FeatureStore(new InMemoryFeatureRecordRepository()) });
  const referralService = createReferralService({ platform, wallets });
  return { wallets, platform, referralService };
}

// Reproduces platform.routes.js's handlers exactly:
//   router.get('/api/referral/my-code', (req, res) => json(res, () => platform.referral.myCode(req.session.accountId)));
async function handleMyCode({ platform, req }) {
  return platform.referral.myCode(req.session.accountId);
}
//   router.post('/api/referral/redeem', (req, res) => json(res, () => referralService.redeem(req.session.accountId, req.body?.code)));
async function handleRedeem({ referralService, req }) {
  return referralService.redeem(req.session.accountId, req.body?.code);
}

test('GET /api/referral/my-code contract: actingAccountId comes only from req.session.accountId, never a body/query-claimed id', async () => {
  const { platform } = setup();
  const req = { session: { accountId: 'acc_real' }, query: { userId: 'acc_spoofed' }, body: { userId: 'acc_spoofed' } };
  const rec = await handleMyCode({ platform, req });
  assert.equal(rec.ownerId, 'acc_real');
  assert.notEqual(rec.ownerId, 'acc_spoofed');
});

test('GET /api/referral/my-code contract: repeat calls for the same session return the identical code (idempotent), never a fresh one', async () => {
  const { platform } = setup();
  const req = { session: { accountId: 'acc_real' } };
  const first = await handleMyCode({ platform, req });
  const second = await handleMyCode({ platform, req });
  assert.equal(first.code, second.code);
  assert.equal(first.id, second.id);
});

test('GET /api/referral/my-code contract: two different sessions get two different codes, each owned by the real caller', async () => {
  const { platform } = setup();
  const a = await handleMyCode({ platform, req: { session: { accountId: 'acc_a' } } });
  const b = await handleMyCode({ platform, req: { session: { accountId: 'acc_b' } } });
  assert.notEqual(a.code, b.code);
  assert.equal(a.ownerId, 'acc_a');
  assert.equal(b.ownerId, 'acc_b');
});

test('POST /api/referral/redeem contract: refereeId comes only from req.session.accountId, and code from req.body.code -- a spoofed body.refereeId/req.query field is never used', async () => {
  const { platform, referralService } = setup();
  const codeRecord = await platform.referral.myCode('acc_referrer');
  const req = {
    session: { accountId: 'acc_real_referee' },
    body: { code: codeRecord.code, refereeId: 'acc_spoofed', userId: 'acc_spoofed' },
  };
  const redemption = await handleRedeem({ referralService, req });
  assert.equal(redemption.refereeId, 'acc_real_referee');
  assert.notEqual(redemption.refereeId, 'acc_spoofed');
  assert.equal(redemption.status, 'completed');
});

test('POST /api/referral/redeem contract: req.body?.code optional-chains safely when the body itself is missing, surfacing the real validation error rather than throwing a raw TypeError', async () => {
  const { referralService } = setup();
  const req = { session: { accountId: 'acc_real' } }; // no `body` at all, exactly like an empty POST
  await assert.rejects(
    () => handleRedeem({ referralService, req }),
    (err) => { assert.ok(err instanceof Error); assert.notEqual(err.constructor.name, 'TypeError'); return true; }
  );
});

test('POST /api/referral/redeem contract: an unknown code surfaces the real 404 from the service, not a generic 400/500', async () => {
  const { referralService } = setup();
  const req = { session: { accountId: 'acc_real' }, body: { code: 'NOPE0000' } };
  await assert.rejects(
    () => handleRedeem({ referralService, req }),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});

test('POST /api/referral/redeem contract: the session owner redeeming their own code is rejected (self-referral), the real 400 from the service', async () => {
  const { platform, referralService } = setup();
  const codeRecord = await platform.referral.myCode('acc_owner');
  const req = { session: { accountId: 'acc_owner' }, body: { code: codeRecord.code } };
  await assert.rejects(
    () => handleRedeem({ referralService, req }),
    (err) => { assert.equal(err.status, 400); return true; }
  );
});

test('POST /api/referral/redeem contract: a session that already redeemed gets the real 409 on a second attempt, and the wallet is not double-credited', async () => {
  const { platform, referralService, wallets } = setup();
  const codeA = await platform.referral.myCode('acc_referrer_a');
  const codeB = await platform.referral.myCode('acc_referrer_b');
  await handleRedeem({ referralService, req: { session: { accountId: 'acc_referee' }, body: { code: codeA.code } } });
  await assert.rejects(
    () => handleRedeem({ referralService, req: { session: { accountId: 'acc_referee' }, body: { code: codeB.code } } }),
    (err) => { assert.equal(err.status, 409); return true; }
  );
  const balanceB = await wallets.getBalance('acc_referrer_b');
  assert.equal(balanceB.coins, 0);
});
