'use strict';
// Stage 7 audit fix -- contract tests for two handlers in
// src/routes/platform.routes.js that had real, tested logic behind them
// (platform.profile.getFull / platform.profile.updatePrivacy, see
// feature-platform.test.js) but no test proving the ROUTE itself wires
// req.session/req.params/req.body correctly -- unlike the sibling
// GET /api/friends|followers|following/:userId routes, which already got
// this coverage in platform.social-lists.routes-contract.test.js. Same
// "pure logic, fake req/res, reproduce the handler's own call shape
// verbatim" style as that file -- platform.routes.js itself cannot be
// require()'d in this environment (no express installed, no network
// access; see platform.block.routes-contract.test.js's header for the
// four pre-existing environmental fails this is unrelated to).
//
//   GET  /api/profile/:userId/full -> platform.profile.getFull(req.session.accountId, req.params.userId)
//   POST /api/profile/privacy      -> platform.profile.updatePrivacy(req.session.accountId, req.body || {})
//
// What this proves: the VIEWER for /full always comes from
// req.session.accountId (never spoofable via body/query), the profile
// being viewed always comes from req.params.userId, and /privacy always
// applies to the caller's OWN profile (req.session.accountId) with no
// target id anywhere in the contract -- a caller can never patch someone
// else's privacy settings, even by supplying a userId/targetId in the
// body. The underlying privacy/block gate and merge behavior are
// exhaustively covered in feature-platform.test.js; this file is
// deliberately only about the routing/session-identity contract.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform, FeatureStore } = require('../src/feature-platform');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');

function setup() {
  const platform = createPlatform({ store: new FeatureStore(new InMemoryFeatureRecordRepository()) });
  return { platform };
}

// Reproduces platform.routes.js's handler exactly:
//   router.get('/api/profile/:userId/full', (req, res) => json(res, () => platform.profile.getFull(req.session.accountId, req.params.userId)));
async function handleGetFull({ platform, req }) {
  return platform.profile.getFull(req.session.accountId, req.params.userId);
}
//   router.post('/api/profile/privacy', (req, res) => json(res, () => platform.profile.updatePrivacy(req.session.accountId, req.body || {})));
async function handleUpdatePrivacy({ platform, req }) {
  return platform.profile.updatePrivacy(req.session.accountId, req.body || {});
}

test('GET /api/profile/:userId/full contract: the viewer comes only from req.session.accountId, the profile viewed only from req.params.userId', async () => {
  const { platform } = setup();
  await platform.profile.create({ userId: 'acc_2', name: 'Target', bio: 'hi' });
  const req = { session: { accountId: 'acc_2' }, params: { userId: 'acc_2' }, body: { userId: 'acc_spoofed', viewerId: 'acc_spoofed' } };
  const full = await handleGetFull({ platform, req });
  assert.equal(full.id, 'acc_2');
  assert.equal(full.bio, 'hi');
});

test('GET /api/profile/:userId/full contract: a stranger viewer on a private profile gets the real, honest restricted view (never bio) regardless of any body field -- the route never throws for privacy alone, only for a block', async () => {
  const { platform } = setup();
  await platform.profile.create({ userId: 'acc_2', name: 'Private User', bio: 'secret', privacy: { profileVisibility: 'private' } });
  const req = { session: { accountId: 'acc_stranger' }, params: { userId: 'acc_2' }, body: { viewerId: 'acc_2' } };
  const full = await handleGetFull({ platform, req });
  assert.equal(full.bio, null);
  assert.equal(full.privacyRestricted, true);
});

test('GET /api/profile/:userId/full contract: a blocked viewer gets a 403, never the profile', async () => {
  const { platform } = setup();
  await platform.profile.create({ userId: 'acc_2', name: 'Target' });
  await platform.social.block('acc_2', 'acc_1');
  const req = { session: { accountId: 'acc_1' }, params: { userId: 'acc_2' } };
  await assert.rejects(
    () => handleGetFull({ platform, req }),
    (err) => { assert.equal(err.status, 403); return true; },
  );
});

test('POST /api/profile/privacy contract: always patches the caller\'s OWN profile (req.session.accountId), even if the body names a different userId/targetId', async () => {
  const { platform } = setup();
  await platform.profile.create({ userId: 'acc_1', name: 'Me' });
  await platform.profile.create({ userId: 'acc_2', name: 'Someone Else' });
  const req = { session: { accountId: 'acc_1' }, body: { discoverable: false, userId: 'acc_2', targetId: 'acc_2' } };
  await handleUpdatePrivacy({ platform, req });
  const mine = await platform.profile.get('acc_1');
  const theirs = await platform.profile.get('acc_2');
  assert.equal(mine.privacy.discoverable, false);
  assert.equal(theirs.privacy.discoverable, true); // untouched -- default, never patched
});

test('POST /api/profile/privacy contract: a missing body is treated as an empty patch (creates defaults), not a crash', async () => {
  const { platform } = setup();
  const req = { session: { accountId: 'acc_1' }, body: undefined };
  const result = await handleUpdatePrivacy({ platform, req });
  assert.equal(result.privacy.profileVisibility, 'public');
});

test('POST /api/profile/privacy contract: a partial patch merges into existing privacy without dropping other fields, applied via the route\'s exact call shape', async () => {
  const { platform } = setup();
  await platform.profile.create({ userId: 'acc_1', name: 'Me', privacy: { whoCanMessage: 'friends' } });
  const req = { session: { accountId: 'acc_1' }, body: { discoverable: false } };
  const result = await handleUpdatePrivacy({ platform, req });
  assert.equal(result.privacy.discoverable, false);
  assert.equal(result.privacy.whoCanMessage, 'friends'); // untouched
});

// Stage 7 internal gap fix (this session) -- Mobile #shareProfile now
// wires up GET /api/profile/:userId/share (see app.js), but that route
// itself had no contract test proving it reads the target id only from
// req.params.userId, the same style as the /full and /privacy contract
// tests above. profile.shareLink()'s own business logic (canonical
// deepLink shape, requireId validation) is exhaustively covered in
// feature-platform.test.js; this is deliberately only about the
// routing contract for the newly-wired handler.
//   GET /api/profile/:userId/share -> platform.profile.shareLink(req.params.userId)
async function handleShareLink({ platform, req }) {
  return platform.profile.shareLink(req.params.userId);
}

test('GET /api/profile/:userId/share contract: the target id comes only from req.params.userId, never from session or body -- a share link can be requested for any account id without a session at all', async () => {
  const { platform } = setup();
  const req = { params: { userId: 'acc_2' }, session: {}, body: { userId: 'acc_spoofed' } };
  const result = await handleShareLink({ platform, req });
  assert.deepEqual(result, { deepLink: 'app://profile/acc_2' });
});

test('GET /api/profile/:userId/share contract: does not re-run getFull()\'s privacy/block gate -- the route returns the same static link shape regardless of any privacy state on the target profile', async () => {
  const { platform } = setup();
  await platform.profile.create({ userId: 'acc_2', name: 'Private User', privacy: { profileVisibility: 'private' } });
  await platform.social.block('acc_2', 'acc_1');
  const req = { params: { userId: 'acc_2' }, session: { accountId: 'acc_1' } };
  const result = await handleShareLink({ platform, req });
  assert.deepEqual(result, { deepLink: 'app://profile/acc_2' });
});

test('GET /api/profile/:userId/share contract: a missing/empty userId param rejects the same way every other domain method\'s requireId does', async () => {
  const { platform } = setup();
  const req = { params: { userId: '' }, session: {} };
  await assert.rejects(() => handleShareLink({ platform, req }), /targetUserId/);
});
