'use strict';
// Stage 29 completion (this session) -- ../src/services/inventory-admin.service.js,
// the real trusted server-side/admin path behind POST /api/inventory/grant.
// Same setup shape as store.service.test.js: a real InMemoryInventoryRepository,
// no mocking of inventory.grant()'s own idempotency/validation.

const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryInventoryRepository } = require('../src/database/repositories/inventory.repository');
const { createInventoryAdminService } = require('../src/services/inventory-admin.service');

function setup(adminIds = new Set(['usr_admin'])) {
  const inventory = new InMemoryInventoryRepository();
  const service = createInventoryAdminService({ inventory, adminIds });
  return { inventory, service };
}

test('an allowlisted admin can grant inventory to another account', async () => {
  const { inventory, service } = setup();
  const result = await service.grant({ actorId: 'usr_admin', accountId: 'usr_target', itemId: 'store_frame_gold', quantity: 2 });
  assert.equal(result.accountId, 'usr_target');
  assert.equal(result.itemId, 'store_frame_gold');
  assert.equal(result.quantity, 2);
  assert.equal(result.grantedBy, 'usr_admin');

  const items = await inventory.listByAccount('usr_target');
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'admin');
});

test('the grant is a real, traceable source transaction (server-generated referenceId, never client-supplied)', async () => {
  const { inventory, service } = setup();
  const result = await service.grant({ actorId: 'usr_admin', accountId: 'usr_target', itemId: 'store_frame_gold', quantity: 1 });
  assert.match(result.referenceId, /^admgrant_/);
  const items = await inventory.listByAccount('usr_target');
  assert.equal(items[0].referenceId, result.referenceId);
});

test('a non-admin account is rejected with 403, even one granting to itself', async () => {
  const { inventory, service } = setup();
  await assert.rejects(
    () => service.grant({ actorId: 'usr_normal', accountId: 'usr_normal', itemId: 'store_frame_gold', quantity: 1 }),
    (e) => e.status === 403
  );
  assert.equal((await inventory.listByAccount('usr_normal')).length, 0, 'no grant must be created for a rejected request');
});

test('an unauthenticated/blank actorId is rejected with 403', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.grant({ actorId: undefined, accountId: 'usr_target', itemId: 'store_frame_gold', quantity: 1 }),
    (e) => e.status === 403
  );
});

test('an empty admin allowlist (real unconfigured default) rejects every caller', async () => {
  const { inventory, service } = setup(new Set());
  await assert.rejects(
    () => service.grant({ actorId: 'usr_admin', accountId: 'usr_target', itemId: 'store_frame_gold', quantity: 1 }),
    (e) => e.status === 403
  );
  assert.equal((await inventory.listByAccount('usr_target')).length, 0);
});

test('authorization is checked before input validation -- a non-admin with a malformed body still gets 403, not 400', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.grant({ actorId: 'usr_normal', accountId: '', itemId: '', quantity: -1 }),
    (e) => e.status === 403
  );
});

test('an admin request with an invalid quantity is rejected with 400', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.grant({ actorId: 'usr_admin', accountId: 'usr_target', itemId: 'store_frame_gold', quantity: 0 }),
    (e) => e.status === 400
  );
  await assert.rejects(
    () => service.grant({ actorId: 'usr_admin', accountId: 'usr_target', itemId: 'store_frame_gold', quantity: 1.5 }),
    (e) => e.status === 400
  );
});

test('an admin request with an invalid itemId is rejected with 400', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.grant({ actorId: 'usr_admin', accountId: 'usr_target', itemId: '', quantity: 1 }),
    (e) => e.status === 400
  );
  await assert.rejects(
    () => service.grant({ actorId: 'usr_admin', accountId: 'usr_target', itemId: '   ', quantity: 1 }),
    (e) => e.status === 400
  );
});

test('an admin request with a missing/blank accountId is rejected with 400', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.grant({ actorId: 'usr_admin', accountId: '', itemId: 'store_frame_gold', quantity: 1 }),
    (e) => e.status === 400
  );
  await assert.rejects(
    () => service.grant({ actorId: 'usr_admin', accountId: undefined, itemId: 'store_frame_gold', quantity: 1 }),
    (e) => e.status === 400
  );
});

test('two separate admin grant calls for the same account/item are two separate real transactions (distinct referenceIds, quantities not merged)', async () => {
  const { inventory, service } = setup();
  const first = await service.grant({ actorId: 'usr_admin', accountId: 'usr_target', itemId: 'store_frame_gold', quantity: 1 });
  const second = await service.grant({ actorId: 'usr_admin', accountId: 'usr_target', itemId: 'store_frame_gold', quantity: 1 });
  assert.notEqual(first.referenceId, second.referenceId);
  const items = await inventory.listByAccount('usr_target');
  assert.equal(items.length, 2, 'each real grant call is its own row/transaction, never merged');
});

test('a granted item can be read back via the normal read-only GET /api/inventory/:userId path (inventory.listByAccount)', async () => {
  const { inventory, service } = setup();
  await service.grant({ actorId: 'usr_admin', accountId: 'usr_target', itemId: 'store_entrance_dragon', quantity: 5 });
  const items = await inventory.listByAccount('usr_target');
  assert.equal(items.length, 1);
  assert.equal(items[0].itemId, 'store_entrance_dragon');
  assert.equal(items[0].quantity, 5);
  assert.equal(items[0].source, 'admin');
});
