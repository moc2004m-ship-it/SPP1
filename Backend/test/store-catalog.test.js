'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { STORE_ITEMS, resolveStoreItem } = require('../src/domain/store-catalog');

test('resolveStoreItem returns the real server-side catalog entry', () => {
  const item = resolveStoreItem('store_frame_gold');
  assert.equal(item.id, 'store_frame_gold');
  assert.equal(item.currency, 'coins');
  assert.equal(item.unitCost, 300);
});

test('rejects an unknown itemId', () => {
  assert.throws(() => resolveStoreItem('store_item_does_not_exist'), (e) => e.status === 400);
});

test('every catalog item has a valid currency (coins or diamonds)', () => {
  for (const item of Object.values(STORE_ITEMS)) {
    assert.ok(['coins', 'diamonds'].includes(item.currency), `${item.id} has an invalid currency`);
  }
});

test('every catalog item has a positive unit cost', () => {
  for (const item of Object.values(STORE_ITEMS)) {
    assert.ok(Number.isInteger(item.unitCost) && item.unitCost > 0, `${item.id} has an invalid unitCost`);
  }
});
