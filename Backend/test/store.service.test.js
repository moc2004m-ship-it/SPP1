'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryWalletRepository } = require('../src/database/repositories/wallet.repository');
const { InMemoryInventoryRepository } = require('../src/database/repositories/inventory.repository');
const { createStoreService } = require('../src/services/store.service');

function setup() {
  const wallets = new InMemoryWalletRepository();
  const inventory = new InMemoryInventoryRepository();
  const service = createStoreService({ wallets, inventory });
  return { wallets, inventory, service };
}

test('purchase debits the buyer at the real server-side catalog price', async () => {
  const { wallets, service } = setup();
  await wallets.credit('usr_buyer', 'coins', 1000, 'seed-0001');
  const result = await service.purchase({ accountId: 'usr_buyer', itemId: 'store_frame_gold', quantity: 2 });
  assert.equal(result.totalCost, 600);
  assert.equal(result.currency, 'coins');
  const balance = await wallets.getBalance('usr_buyer');
  assert.equal(balance.coins, 400);
});

test('purchase debits the correct currency for a diamonds-priced item', async () => {
  const { wallets, service } = setup();
  await wallets.credit('usr_buyer', 'diamonds', 200, 'seed-0001');
  const result = await service.purchase({ accountId: 'usr_buyer', itemId: 'store_entrance_dragon', quantity: 1 });
  assert.equal(result.totalCost, 50);
  const balance = await wallets.getBalance('usr_buyer');
  assert.equal(balance.diamonds, 150);
  assert.equal(balance.coins, 0, 'must never touch the wrong currency');
});

test('a successful purchase grants the item to the buyer\'s real inventory', async () => {
  const { wallets, inventory, service } = setup();
  await wallets.credit('usr_buyer', 'coins', 1000, 'seed-0001');
  await service.purchase({ accountId: 'usr_buyer', itemId: 'store_bubble_neon', quantity: 3 });
  const items = await inventory.listByAccount('usr_buyer');
  assert.equal(items.length, 1);
  assert.equal(items[0].itemId, 'store_bubble_neon');
  assert.equal(items[0].quantity, 3);
  assert.equal(items[0].source, 'store_purchase');
});

test('the granted inventory item is linked to the real wallet transaction id', async () => {
  const { wallets, service } = setup();
  await wallets.credit('usr_buyer', 'coins', 1000, 'seed-0001');
  const result = await service.purchase({ accountId: 'usr_buyer', itemId: 'store_frame_gold', quantity: 1 });
  assert.ok(result.walletTransactionId, 'must reference a real wallet transaction');
  assert.match(result.walletTransactionId, /^wtx_/);
  assert.equal(result.inventoryItem.referenceId, result.purchaseId);
});

test('rejects an unknown itemId (never trusts a client-supplied price)', async () => {
  const { wallets, service } = setup();
  await wallets.credit('usr_buyer', 'coins', 1000, 'seed-0001');
  await assert.rejects(
    () => service.purchase({ accountId: 'usr_buyer', itemId: 'store_item_does_not_exist', quantity: 1 }),
    (e) => e.status === 400
  );
});

test('insufficient balance rejects the purchase and grants nothing', async () => {
  const { wallets, inventory, service } = setup();
  await wallets.credit('usr_buyer', 'coins', 5, 'seed-0001'); // not enough for even one gold frame (300)
  await assert.rejects(
    () => service.purchase({ accountId: 'usr_buyer', itemId: 'store_frame_gold', quantity: 1 }),
    (e) => e.status === 409
  );
  const items = await inventory.listByAccount('usr_buyer');
  assert.equal(items.length, 0, 'no inventory row must exist when the debit failed');
  const balance = await wallets.getBalance('usr_buyer');
  assert.equal(balance.coins, 5, 'balance must be untouched by the failed purchase');
});

test('rejects a non-positive quantity', async () => {
  const { wallets, service } = setup();
  await wallets.credit('usr_buyer', 'coins', 1000, 'seed-0001');
  await assert.rejects(
    () => service.purchase({ accountId: 'usr_buyer', itemId: 'store_frame_gold', quantity: 0 }),
    (e) => e.status === 400
  );
});

test('two separate purchase calls each debit and grant independently (fresh idempotency key per call)', async () => {
  const { wallets, inventory, service } = setup();
  await wallets.credit('usr_buyer', 'coins', 1000, 'seed-0001');
  await service.purchase({ accountId: 'usr_buyer', itemId: 'store_bubble_neon', quantity: 1 });
  await service.purchase({ accountId: 'usr_buyer', itemId: 'store_bubble_neon', quantity: 1 });
  const items = await inventory.listByAccount('usr_buyer');
  assert.equal(items.length, 2, 'two real purchases must create two real inventory rows');
  const balance = await wallets.getBalance('usr_buyer');
  assert.equal(balance.coins, 700, 'both debits must have actually applied (1000 - 150 - 150)');
});
