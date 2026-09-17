// Phase 5 — Server-owned gift catalog.
//
// unit cost is ALWAYS looked up here, server-side, from giftId -- never
// accepted as a number from the client. Trusting a client-supplied cost
// would let a sender debit themselves (or the receiver's earnings ledger,
// once one exists) any amount they want, including zero.
//
// Real product/pricing decisions belong to whoever owns the gift catalog
// for this app -- these are illustrative starting values, not secret, and
// meant to be edited before real launch.

const GIFTS = Object.freeze({
  gift_rose: Object.freeze({ id: 'gift_rose', name: 'Rose', unitCostCoins: 10 }),
  gift_heart: Object.freeze({ id: 'gift_heart', name: 'Heart', unitCostCoins: 50 }),
  gift_crown: Object.freeze({ id: 'gift_crown', name: 'Crown', unitCostCoins: 500 }),
});

function resolveGift(giftId) {
  const gift = GIFTS[giftId];
  if (!gift) {
    throw Object.assign(new Error(`unknown giftId; must be one of ${Object.keys(GIFTS).join(', ')}`), {
      status: 400,
    });
  }
  return gift;
}

module.exports = { GIFTS, resolveGift };
