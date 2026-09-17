'use strict';
// Stage 10 audit fix -- Lists (requirement #5). Contract tests for the three
// new List handlers in src/routes/platform.routes.js:
//   GET /api/friends/:userId   -> platform.profile.listFriends(req.session.accountId, req.params.userId)
//   GET /api/followers/:userId -> platform.profile.listFollowers(req.session.accountId, req.params.userId)
//   GET /api/following/:userId -> platform.profile.listFollowing(req.session.accountId, req.params.userId)
//
// These are brand-new routes added by this audit (see feature-platform.js's
// profile.listFriends/listFollowers/listFollowing header for why they were
// missing and what they reuse from getFull()). Same "pure logic, fake
// req/res, reproduce the handler's own call shape verbatim" style as
// platform.block.routes-contract.test.js -- platform.routes.js itself
// cannot be require()'d in this environment (no express installed, no
// network access; see that file's header for the four pre-existing
// environmental fails this is unrelated to).
//
// What this proves: the VIEWER always comes from req.session.accountId, and
// the profile being listed always comes from req.params.userId -- a caller
// can never list a profile's connections on someone else's behalf, and can
// never spoof who is doing the viewing. The underlying privacy/block gate
// and list contents are exhaustively covered in feature-platform.test.js;
// this file is deliberately only about the routing/session-identity
// contract.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform, FeatureStore } = require('../src/feature-platform');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');

function setup() {
  const platform = createPlatform({ store: new FeatureStore(new InMemoryFeatureRecordRepository()) });
  return { platform };
}

// Reproduces platform.routes.js's handlers exactly:
//   router.get('/api/friends/:userId', (req, res) => json(res, () => platform.profile.listFriends(req.session.accountId, req.params.userId)));
async function handleListFriends({ platform, req }) {
  return platform.profile.listFriends(req.session.accountId, req.params.userId);
}
//   router.get('/api/followers/:userId', (req, res) => json(res, () => platform.profile.listFollowers(req.session.accountId, req.params.userId)));
async function handleListFollowers({ platform, req }) {
  return platform.profile.listFollowers(req.session.accountId, req.params.userId);
}
//   router.get('/api/following/:userId', (req, res) => json(res, () => platform.profile.listFollowing(req.session.accountId, req.params.userId)));
async function handleListFollowing({ platform, req }) {
  return platform.profile.listFollowing(req.session.accountId, req.params.userId);
}

test('GET /api/followers/:userId contract: the viewer comes only from req.session.accountId, the listed profile only from req.params.userId', async () => {
  const { platform } = setup();
  await platform.social.follow('acc_1', 'acc_2');
  const req = { session: { accountId: 'acc_2' }, params: { userId: 'acc_2' }, body: { accountId: 'acc_spoofed' } };
  const list = await handleListFollowers({ platform, req });
  assert.deepEqual(list, [{ accountId: 'acc_1' }]);
});

test('GET /api/following/:userId contract: a stranger viewer is rejected with 403 when the target profile is private', async () => {
  const { platform } = setup();
  await platform.profile.create({ userId: 'acc_2', name: 'Private User', privacy: { profileVisibility: 'private' } });
  await platform.social.follow('acc_2', 'acc_9');
  const req = { session: { accountId: 'acc_stranger' }, params: { userId: 'acc_2' } };
  await assert.rejects(
    () => handleListFollowing({ platform, req }),
    (err) => { assert.equal(err.status, 403); return true; },
  );
});

test('GET /api/friends/:userId contract: a blocked viewer gets a 403, never the list', async () => {
  const { platform } = setup();
  const request = await platform.social.friend('acc_2', 'acc_3');
  await platform.social.accept('acc_3', request.id);
  await platform.social.block('acc_2', 'acc_1');
  const req = { session: { accountId: 'acc_1' }, params: { userId: 'acc_2' } };
  await assert.rejects(
    () => handleListFriends({ platform, req }),
    (err) => { assert.equal(err.status, 403); return true; },
  );
});

test('GET /api/friends/:userId contract: the owner viewing their own profile always sees the real list regardless of privacy setting', async () => {
  const { platform } = setup();
  await platform.profile.create({ userId: 'acc_2', name: 'Private User', privacy: { profileVisibility: 'private' } });
  const request = await platform.social.friend('acc_2', 'acc_3');
  await platform.social.accept('acc_3', request.id);
  const req = { session: { accountId: 'acc_2' }, params: { userId: 'acc_2' } };
  const list = await handleListFriends({ platform, req });
  assert.deepEqual(list, [{ accountId: 'acc_3' }]);
});

test('GET /api/friends/:userId contract: a missing userId param is rejected', async () => {
  const { platform } = setup();
  await assert.rejects(
    () => handleListFriends({ platform, req: { session: { accountId: 'acc_1' }, params: {} } }),
    /targetUserId/,
  );
});
