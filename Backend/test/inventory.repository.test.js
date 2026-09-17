'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryInventoryRepository } = require('../src/database/repositories/inventory.repository');

// NOTE ON SCOPE: exercises InMemoryInventoryRepository, the one actually
// active in this sandbox (no network -- see Database/STAGE3_TODO.md).
// PostgresInventoryRepository implements the identical contract against
// real SQL (see schema/005_create_inventory.sql) but has not been run
// against a live database from this environment.

test('grant creates a real item tied to the account and reference', async () => {
  const inv = new InMemoryInventoryRepository();
  const item = await inv.grant('usr_1', 'itm_frame_gold', 1, 'recharge', 'rchg_1');
  assert.equal(item.accountId, 'usr_1');
  assert.equal(item.itemId, 'itm_frame_gold');
  assert.equal(item.source, 'recharge');
  assert.equal(item.referenceId, 'rchg_1');
});

test('granting with the same (referenceId, itemId) twice does not double-grant', async () => {
  const inv = new InMemoryInventoryRepository();
  const first = await inv.grant('usr_1', 'itm_frame_gold', 1, 'recharge', 'rchg_1');
  const replay = await inv.grant('usr_1', 'itm_frame_gold', 1, 'recharge', 'rchg_1');
  assert.equal(replay.id, first.id);
  const items = await inv.listByAccount('usr_1');
  assert.equal(items.length, 1, 'must not create a second row for the same reference+item');
});

test('listByAccount only returns that account\'s items', async () => {
  const inv = new InMemoryInventoryRepository();
  await inv.grant('usr_1', 'itm_a', 1, 'admin', 'ref_1');
  await inv.grant('usr_2', 'itm_b', 1, 'admin', 'ref_2');
  const items = await inv.listByAccount('usr_1');
  assert.equal(items.length, 1);
  assert.equal(items[0].itemId, 'itm_a');
});

test('rejects an invalid source', async () => {
  const inv = new InMemoryInventoryRepository();
  await assert.rejects(() => inv.grant('usr_1', 'itm_a', 1, 'not_a_real_source', 'ref_1'), (e) => e.status === 400);
});

test('rejects a non-positive quantity', async () => {
  const inv = new InMemoryInventoryRepository();
  await assert.rejects(() => inv.grant('usr_1', 'itm_a', 0, 'admin', 'ref_1'), (e) => e.status === 400);
});
