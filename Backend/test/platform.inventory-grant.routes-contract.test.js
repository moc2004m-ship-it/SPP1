'use strict';
// Stage 29 completion (this session) -- contract test for the new
// POST /api/inventory/grant handler in src/routes/platform.routes.js:
//   router.post('/api/inventory/grant', (req, res) => json(res, () => inventoryAdminService.grant({
//     actorId: req.session.accountId,
//     accountId: req.body?.accountId,
//     itemId: req.body?.itemId,
//     quantity: Number.isInteger(req.body?.quantity) ? req.body.quantity : req.body?.quantity,
//   })));
//
// Same "reproduce the handler verbatim, express unavailable in this
// sandbox" style as platform.appeals-staff.routes-contract.test.js /
// platform.content-review.routes-contract.test.js. This confirms the
// ROUTE-LEVEL wiring (actorId always from req.session, never a
// client-supplied field; accountId/itemId/quantity always from
// req.body, never trusted as authorization) on top of
// inventory-admin.service.test.js's own direct unit coverage of
// inventoryAdminService.grant() itself.

const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryInventoryRepository } = require('../src/database/repositories/inventory.repository');
const { createInventoryAdminService } = require('../src/services/inventory-admin.service');

function setup(adminIds = new Set(['usr_admin'])) {
  const inventory = new InMemoryInventoryRepository();
  const inventoryAdminService = createInventoryAdminService({ inventory, adminIds });
  return { inventory, inventoryAdminService };
}

// Reproduces the handler body exactly, including the Number.isInteger
// guard on req.body.quantity (a non-integer quantity is passed through
// as-is so the service's own assertValidQuantity() rejects it with 400,
// rather than the route silently coercing it into something else).
async function handleGrant({ inventoryAdminService, req }) {
  return inventoryAdminService.grant({
    actorId: req.session.accountId,
    accountId: req.body?.accountId,
    itemId: req.body?.itemId,
    quantity: Number.isInteger(req.body?.quantity) ? req.body.quantity : req.body?.quantity,
  });
}

test('POST /api/inventory/grant contract: an allowlisted admin session can grant to a different target account', async () => {
  const { inventory, inventoryAdminService } = setup();
  const req = { session: { accountId: 'usr_admin' }, body: { accountId: 'usr_target', itemId: 'store_frame_gold', quantity: 3 } };
  const data = await handleGrant({ inventoryAdminService, req });
  assert.equal(data.accountId, 'usr_target');
  assert.equal(data.quantity, 3);
  const items = await inventory.listByAccount('usr_target');
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'admin');
});

test('POST /api/inventory/grant contract: actorId always resolves to the real session, never a spoofed body field', async () => {
  const { inventoryAdminService } = setup();
  const req = { session: { accountId: 'usr_admin' }, body: { actorId: 'usr_someone_else', accountId: 'usr_target', itemId: 'store_frame_gold', quantity: 1 } };
  const data = await handleGrant({ inventoryAdminService, req });
  assert.equal(data.grantedBy, 'usr_admin');
  assert.notEqual(data.grantedBy, 'usr_someone_else');
});

test('POST /api/inventory/grant contract: a normal (non-admin) session is rejected with 403, including granting to itself', async () => {
  const { inventory, inventoryAdminService } = setup();
  const req = { session: { accountId: 'usr_normal' }, body: { accountId: 'usr_normal', itemId: 'store_frame_gold', quantity: 1 } };
  await assert.rejects(() => handleGrant({ inventoryAdminService, req }), (e) => e.status === 403);
  assert.equal((await inventory.listByAccount('usr_normal')).length, 0);
});

test('POST /api/inventory/grant contract: a normal session cannot grant to a third party either', async () => {
  const { inventory, inventoryAdminService } = setup();
  const req = { session: { accountId: 'usr_normal' }, body: { accountId: 'usr_other', itemId: 'store_frame_gold', quantity: 1 } };
  await assert.rejects(() => handleGrant({ inventoryAdminService, req }), (e) => e.status === 403);
  assert.equal((await inventory.listByAccount('usr_other')).length, 0);
});

test('POST /api/inventory/grant contract: unauthenticated (no session) is rejected', async () => {
  const { inventoryAdminService } = setup();
  const req = { session: {}, body: { accountId: 'usr_target', itemId: 'store_frame_gold', quantity: 1 } };
  await assert.rejects(() => handleGrant({ inventoryAdminService, req }));
});

test('POST /api/inventory/grant contract: with the real, unconfigured-in-this-sandbox empty allowlist, even an otherwise-valid admin-shaped request 403s', async () => {
  const { inventory, inventoryAdminService } = setup(new Set());
  const req = { session: { accountId: 'usr_admin' }, body: { accountId: 'usr_target', itemId: 'store_frame_gold', quantity: 1 } };
  await assert.rejects(() => handleGrant({ inventoryAdminService, req }), (e) => e.status === 403);
  assert.equal((await inventory.listByAccount('usr_target')).length, 0);
});

test('POST /api/inventory/grant contract: a non-integer quantity from the body is passed through to the service, which 400s it (never silently coerced)', async () => {
  const { inventoryAdminService } = setup();
  const req = { session: { accountId: 'usr_admin' }, body: { accountId: 'usr_target', itemId: 'store_frame_gold', quantity: '5' } };
  await assert.rejects(() => handleGrant({ inventoryAdminService, req }), (e) => e.status === 400);
});
