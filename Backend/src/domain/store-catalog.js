// Stage 29 — Server-owned store catalog.
//
// Same boundary as gift-catalog.js: unit cost AND currency are ALWAYS
// looked up here, server-side, from itemId -- never accepted as a number
// or a currency string from the client. Trusting a client-supplied price
// would let a buyer debit themselves any amount, in any currency,
// including zero.
//
// Real product/pricing/catalog decisions belong to whoever owns the store
// for this app -- these are illustrative starting values, not secret, and
// meant to be edited before real launch. `currency` must be one of
// wallet.model.js's CURRENCIES ('coins' | 'diamonds') -- see
// store.service.js, which passes it straight into wallets.debit().

const STORE_ITEMS = Object.freeze({
  store_frame_gold: Object.freeze({ id: 'store_frame_gold', name: 'Gold Profile Frame', currency: 'coins', unitCost: 300 }),
  store_bubble_neon: Object.freeze({ id: 'store_bubble_neon', name: 'Neon Chat Bubble', currency: 'coins', unitCost: 150 }),
  store_entrance_dragon: Object.freeze({ id: 'store_entrance_dragon', name: 'Dragon Entrance Effect', currency: 'diamonds', unitCost: 50 }),
});

function resolveStoreItem(itemId) {
  const item = STORE_ITEMS[itemId];
  if (!item) {
    throw Object.assign(new Error(`unknown itemId; must be one of ${Object.keys(STORE_ITEMS).join(', ')}`), {
      status: 400,
    });
  }
  return item;
}

module.exports = { STORE_ITEMS, resolveStoreItem };
