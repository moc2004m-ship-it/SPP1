'use strict';
// Stage 9 -- Search. Contract test for the one handler in
// src/routes/platform.routes.js:
//   GET /api/search -> platform.search.query(req.query.q || '', req.session.accountId)
//
// No route-contract test existed for this route before this session (a
// real gap on audit -- every other domain's route had one, this one
// did not). Same "pure logic, fake req/res, reproduce the handler's own
// call shape verbatim" style as platform.block.routes-contract.test.js /
// platform.referral.routes-contract.test.js -- platform.routes.js itself
// cannot be require()'d in this sandbox (no express, no network to
// install it).
//
// What this proves: actingAccountId for the room owner-exception privacy
// rule comes ONLY from req.session.accountId -- a client cannot widen
// their own results by claiming a different accountId in the query
// string (there is no such field read at all). The underlying search
// business rules (discoverability, private-room exclusion, game catalog
// matching, family search) are exhaustively covered separately in
// feature-platform.test.js -- this file is deliberately about the
// routing/session-identity contract, not re-proving that logic.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform, FeatureStore } = require('../src/feature-platform');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');

function setup() {
  const platform = createPlatform({ store: new FeatureStore(new InMemoryFeatureRecordRepository()) });
  return { platform };
}

// Reproduces platform.routes.js's handler exactly:
//   router.get('/api/search', (req, res) => json(res, () => platform.search.query(req.query.q || '', req.session.accountId)));
async function handleSearch({ platform, req }) {
  return platform.search.query(req.query.q || '', req.session.accountId);
}

test('GET /api/search contract: the acting identity for the private-room owner exception comes only from req.session.accountId', async () => {
  const { platform } = setup();
  await platform.rooms.create({ ownerId: 'owner_real', name: 'My Private Room', visibility: 'private' });
  // A client cannot widen their own results by spoofing an accountId
  // anywhere in the query string -- the route never reads one from
  // there, only from the session.
  const spoofedReq = { session: { accountId: 'stranger' }, query: { q: 'private room', accountId: 'owner_real' } };
  const spoofedResults = await handleSearch({ platform, req: spoofedReq });
  assert.ok(!spoofedResults.results.some(r => r.type === 'room'));

  const realOwnerReq = { session: { accountId: 'owner_real' }, query: { q: 'private room' } };
  const realOwnerResults = await handleSearch({ platform, req: realOwnerReq });
  assert.ok(realOwnerResults.results.some(r => r.type === 'room' && r.name === 'My Private Room'));
});

test('GET /api/search contract: a missing q defaults to an empty query (empty results, no throw)', async () => {
  const { platform } = setup();
  const req = { session: { accountId: 'acc_real' }, query: {} };
  const results = await handleSearch({ platform, req });
  assert.deepEqual(results.results, []);
});
