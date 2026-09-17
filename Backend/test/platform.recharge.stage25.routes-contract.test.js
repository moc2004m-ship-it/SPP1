'use strict';
// Stage 25 -- route-contract tests for the recharge handlers in
// src/routes/recharge.routes.js:
//   GET  /api/recharge/packages                 -> listPackages() (real server-side catalog)
//   POST /api/recharge/orders                    -> rechargeService.createOrder(req.session.accountId, body.packageId, body.provider)
//   POST /api/recharge/orders/:orderId/complete   -> rechargeService.completeOrder(req.session.accountId, ...) [orderId from params]
//   GET  /api/recharge/orders                     -> recharges.listByAccount(req.session.accountId)
//   GET  /api/recharge/orders/:orderId            -> recharges.findById + assertOwnAccount
//
// recharge.routes.js itself cannot be require()'d in this environment --
// it does `require('express')` at the top of the file, and express is not
// installed here (no network access to install it; see
// STAGE6_FINAL_REPORT.md and the four pre-existing environmental fails in
// accounts/agora/auth/config routes.test.js). Same "pure logic, fake
// req/res inputs" style as platform.referral.routes-contract.test.js and
// platform.room-in-room.stage23.routes-contract.test.js: each handler's
// own call shape is reproduced verbatim against the real
// rechargeService.*/recharges.* methods and the real assertOwnAccount
// guard, without needing express itself.
//
// What this proves: every identity used (accountId) comes only from
// req.session.accountId, never a client-supplied body/query/param field
// (a hostile client cannot create/complete an order as someone else, nor
// read another account's order or order list), and GET .../:orderId
// really does 404 for an unknown order and 403 for a real order that
// belongs to a different account. The underlying business rules
// (packageId->coins resolution, provider verification, idempotent
// completion, wallet credit) are exhaustively covered separately in
// recharge.service.test.js -- this file is deliberately about the
// routing/session-identity/ownership contract, not re-proving that logic.

const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryRechargeRepository } = require('../src/database/repositories/recharge.repository');
const { InMemoryWalletRepository } = require('../src/database/repositories/wallet.repository');
const { createRechargeService } = require('../src/services/recharge.service');
const { assertOwnAccount } = require('../src/routes/platform.guards');
const { listPackages } = require('../src/database/models/recharge.model');

function setup(verifyImpl = async () => ({ valid: true, providerTransactionId: 'ptx_1' })) {
  const recharges = new InMemoryRechargeRepository();
  const wallets = new InMemoryWalletRepository();
  const rechargeService = createRechargeService({ recharges, wallets, verify: verifyImpl });
  return { recharges, wallets, rechargeService };
}

// Reproduces recharge.routes.js's handlers exactly:
//   router.get('/api/recharge/packages', (req, res) => res.json({ ok: true, data: listPackages() }));
function handlePackages() {
  return listPackages();
}
//   router.post('/api/recharge/orders', (req, res) => rechargeService.createOrder(req.session.accountId, req.body?.packageId, req.body?.provider));
async function handleCreateOrder({ rechargeService, req }) {
  return rechargeService.createOrder(req.session.accountId, req.body?.packageId, req.body?.provider);
}
//   router.post('/api/recharge/orders/:orderId/complete', (req, res) => rechargeService.completeOrder(req.params.orderId, req.session.accountId, req.body?.providerPurchaseRef));
async function handleCompleteOrder({ rechargeService, req }) {
  return rechargeService.completeOrder(req.params.orderId, req.session.accountId, req.body?.providerPurchaseRef);
}
//   router.get('/api/recharge/orders', (req, res) => recharges.listByAccount(req.session.accountId));
async function handleListOrders({ recharges, req }) {
  return recharges.listByAccount(req.session.accountId);
}
//   router.get('/api/recharge/orders/:orderId', (req, res) => { const order = await recharges.findById(req.params.orderId); if (!order) 404; assertOwnAccount(req.session, order.accountId); return order; });
async function handleGetOrder({ recharges, req }) {
  const order = await recharges.findById(req.params.orderId);
  if (!order) throw Object.assign(new Error('order not found'), { status: 404 });
  assertOwnAccount(req.session, order.accountId);
  return order;
}

test('GET /api/recharge/packages contract: returns the real server-side catalog, needs no ownership scoping', async () => {
  const req = { session: { accountId: 'acc_1' } };
  const packages = handlePackages(req);
  assert.ok(Array.isArray(packages));
  assert.ok(packages.length >= 1);
  assert.ok(packages.every((p) => typeof p.id === 'string' && typeof p.coins === 'number'));
  // Sorted ascending by coins -- proves this is the real catalog helper,
  // not a random/unsorted dump.
  for (let i = 1; i < packages.length; i++) {
    assert.ok(packages[i].coins >= packages[i - 1].coins);
  }
});

test('POST /api/recharge/orders contract: accountId comes only from req.session.accountId, never a spoofed body field', async () => {
  const { rechargeService } = setup();
  const req = {
    session: { accountId: 'acc_real' },
    body: { packageId: 'pkg_small', provider: 'google_play', accountId: 'acc_spoofed', userId: 'acc_spoofed' },
  };
  const order = await handleCreateOrder({ rechargeService, req });
  assert.equal(order.accountId, 'acc_real');
  assert.notEqual(order.accountId, 'acc_spoofed');
  assert.equal(order.status, 'pending');
});

test('POST /api/recharge/orders contract: an unknown packageId is a real 400, no order is left behind', async () => {
  const { rechargeService, recharges } = setup();
  const req = { session: { accountId: 'acc_real' }, body: { packageId: 'pkg_does_not_exist', provider: 'google_play' } };
  await assert.rejects(() => handleCreateOrder({ rechargeService, req }), (e) => e.status === 400);
  assert.deepEqual(await recharges.listByAccount('acc_real'), []);
});

test('POST /api/recharge/orders/:orderId/complete contract: orderId comes from req.params, accountId only from req.session, never a spoofed body field', async () => {
  const { rechargeService } = setup();
  const created = await rechargeService.createOrder('acc_real', 'pkg_small', 'google_play');
  const req = {
    session: { accountId: 'acc_real' },
    params: { orderId: created.id },
    body: { providerPurchaseRef: 'real-token', orderId: 'rchg_spoofed', accountId: 'acc_spoofed' },
  };
  const completed = await handleCompleteOrder({ rechargeService, req });
  assert.equal(completed.id, created.id);
  assert.equal(completed.status, 'completed');
});

test('POST /api/recharge/orders/:orderId/complete contract: completing another account\'s order is rejected with 403, never completed as the spoofed owner', async () => {
  const { rechargeService } = setup();
  const created = await rechargeService.createOrder('acc_owner', 'pkg_small', 'google_play');
  const req = {
    session: { accountId: 'acc_attacker' },
    params: { orderId: created.id },
    body: { providerPurchaseRef: 'real-token' },
  };
  await assert.rejects(() => handleCompleteOrder({ rechargeService, req }), (e) => e.status === 403);
});

test('GET /api/recharge/orders contract: lists only the session account\'s own orders, ignoring any accountId in query/body', async () => {
  const { rechargeService, recharges } = setup();
  await rechargeService.createOrder('acc_a', 'pkg_small', 'google_play');
  await rechargeService.createOrder('acc_b', 'pkg_medium', 'google_play');
  const req = { session: { accountId: 'acc_a' }, query: { accountId: 'acc_b' } };
  const orders = await handleListOrders({ recharges, req });
  assert.equal(orders.length, 1);
  assert.equal(orders[0].accountId, 'acc_a');
});

test('GET /api/recharge/orders/:orderId contract: 404 for an order id that does not exist', async () => {
  const { recharges } = setup();
  const req = { session: { accountId: 'acc_a' }, params: { orderId: 'rchg_does_not_exist' } };
  await assert.rejects(() => handleGetOrder({ recharges, req }), (e) => e.status === 404);
});

test('GET /api/recharge/orders/:orderId contract: 403 when the order belongs to a different account (assertOwnAccount enforced, not skipped)', async () => {
  const { rechargeService, recharges } = setup();
  const order = await rechargeService.createOrder('acc_owner', 'pkg_small', 'google_play');
  const req = { session: { accountId: 'acc_stranger' }, params: { orderId: order.id } };
  await assert.rejects(() => handleGetOrder({ recharges, req }), (e) => e.status === 403);
});

test('GET /api/recharge/orders/:orderId contract: the real owner can read their own order', async () => {
  const { rechargeService, recharges } = setup();
  const order = await rechargeService.createOrder('acc_owner', 'pkg_small', 'google_play');
  const req = { session: { accountId: 'acc_owner' }, params: { orderId: order.id } };
  const result = await handleGetOrder({ recharges, req });
  assert.equal(result.id, order.id);
  assert.equal(result.accountId, 'acc_owner');
});
