// Phase 5 — Gifts service.
// Stage 27/28 — `accounts` is an OPTIONAL constructor dependency. When
// provided, a successful send grants XP to both sender and receiver
// (../database/repositories/account.repository.js's addXp()). When
// omitted, behavior is byte-for-byte identical to before this stage --
// existing callers/tests that never passed `accounts` keep working
// unchanged (see test/gifts.service.test.js).
// Stage 31 — `eventService` is likewise an OPTIONAL constructor
// dependency, same additive pattern as `accounts` above. When provided, a
// successful send reports two real actions to
// ../services/event.service.js's incrementMissionsByType(): one
// 'gift_sent' for the sender, one 'gift_received' for the receiver. That
// service alone decides whether either currently maps to any active
// event's mission progress (most of the time it won't) -- this file has
// no knowledge of the events catalog and never will. `amount` is always 1
// per completed sendGift() call (one real send action), not `quantity` --
// consistent with how event.service.js's own recordShare() counts one
// share action as 1 regardless of anything else, and with a mission like
// "send 10 gifts" reading naturally as 10 separate send actions rather
// than 10 gift items. When `eventService` is omitted, behavior is
// byte-for-byte identical to before this stage.
// Stage 32 — `coupleService` is likewise an OPTIONAL constructor
// dependency, same additive pattern as `accounts`/`eventService` above.
// When provided, a successful send reports the REAL coins already spent
// (totalCostCoins, never `quantity`) to
// ../services/couple.service.js's recordGift(). That service alone
// decides whether sender/receiver are currently an active couple -- this
// file has no knowledge of couple state and never will; if they are not
// paired, recordGift() is a real no-op. When `coupleService` is omitted,
// behavior is byte-for-byte identical to before this stage.
// Stage 33 — `notificationService` is likewise an OPTIONAL constructor
// dependency, same additive pattern as `accounts`/`eventService`/
// `coupleService` above. When provided, a successful send reports
// GIFT_RECEIVED to the receiver AFTER the real debit + gift record have
// already committed. When omitted, behavior is byte-for-byte identical to
// before this stage.
// Stage 26 — `giftWallService` is likewise an OPTIONAL constructor
// dependency, same additive pattern as every dependency above. When
// provided, a successful send reports the REAL coins already spent
// (totalCostCoins, never `quantity` or any other client field) to
// ../services/gift-wall.service.js's recordContribution(), AFTER the real
// debit + gift record have already committed -- same "only reached after
// the send is already committed" guarantee as every block below. That
// service alone decides which Host Room Session the contribution belongs
// to (the room's current active gift wall session) -- this file has no
// knowledge of sessions and never will. When `giftWallService` is
// omitted, behavior is byte-for-byte identical to before this stage.
//
// The ONLY code path that may send a gift. Debits the sender's real wallet
// balance for the real catalog price BEFORE creating the gift record, so a
// gift can never be recorded without a real, non-fake money movement
// behind it. If the debit fails (insufficient balance), no gift record is
// created at all.

const { resolveGift } = require('../domain/gift-catalog');
const { generateGiftId, assertValidQuantity, assertDifferentAccounts } = require('../database/models/gift.model');

// Stage 18 — `battleService` is likewise an OPTIONAL constructor
// dependency, same additive pattern as every dependency above. When
// provided, a successful send reports the REAL coins already spent
// (totalCostCoins, never `quantity`) to
// ../services/battle.service.js's recordGiftPoints(), AFTER the real
// debit + gift record have already committed -- same "only reached after
// the send is already committed" guarantee as every block below. That
// service alone decides whether roomId currently has an active battle and
// whether receiverId is one of its two sides -- this file has no
// knowledge of battle state and never will. When `battleService` is
// omitted, behavior is byte-for-byte identical to before this stage.
function createGiftsService({ wallets, gifts, accounts, eventService, coupleService, notificationService, giftWallService, battleService }) {
  async function sendGift({ roomId, senderId, receiverId, giftId, quantity }) {
    assertDifferentAccounts(senderId, receiverId);
    assertValidQuantity(quantity);
    const catalogGift = resolveGift(giftId); // throws 400 on unknown giftId -- never trusts a client-supplied price
    const totalCostCoins = catalogGift.unitCostCoins * quantity;

    // A fresh idempotency key per send -- this call represents one real
    // user action (one tap of "send"), not a retriable operation with a
    // client-supplied key. A double-tap becomes two real debits, which is
    // correct: two gifts were actually requested.
    let record;
    if (typeof gifts.createWithDebit === 'function') {
      record = await gifts.createWithDebit({ roomId, senderId, receiverId, giftId, quantity, unitCostCoins: catalogGift.unitCostCoins, totalCostCoins });
    } else {
      const idempotencyKey = generateGiftId();
      const walletTransaction = await wallets.debit(senderId, 'coins', totalCostCoins, idempotencyKey);

      record = await gifts.create({
        roomId,
        senderId,
        receiverId,
        giftId,
        quantity,
        unitCostCoins: catalogGift.unitCostCoins,
        totalCostCoins,
        walletTransactionId: walletTransaction.id,
      });
    }

    // Only reached after the gift record (and the real debit behind it)
    // is already committed -- XP is a reward for a completed send, never
    // granted on a failed/rejected one. XP amount = coins actually spent
    // (1:1), an illustrative starting rate like gift-catalog.js's prices.
    if (accounts) {
      await accounts.addXp(senderId, totalCostCoins);
      await accounts.addXp(receiverId, totalCostCoins);
    }

    // Same "only reached after the send is already committed" guarantee
    // as the XP block above -- a failed/rejected send reports nothing.
    if (eventService) {
      await eventService.incrementMissionsByType({ accountId: senderId, type: 'gift_sent', amount: 1 });
      await eventService.incrementMissionsByType({ accountId: receiverId, type: 'gift_received', amount: 1 });
    }

    // Same "only reached after the send is already committed" guarantee
    // as the blocks above -- a failed/rejected send never inflates a
    // couple's cp. recordGift() itself decides whether sender/receiver
    // are an active couple; if not, this is a real no-op.
    if (coupleService) {
      await coupleService.recordGift({ senderId, receiverId, amount: totalCostCoins });
    }

    // Same "only reached after the send is already committed" guarantee
    // as the blocks above.
    if (notificationService) {
      await notificationService.notify({
        recipientId: receiverId,
        type: 'GIFT_RECEIVED',
        payload: { giftId: record.id },
      });
    }

    // Same "only reached after the send is already committed" guarantee
    // as every block above -- a failed/rejected send never touches the
    // gift wall. `amount` is the real, already-debited totalCostCoins
    // (never `quantity`), and `giftId` here is the real gift RECORD id
    // (record.id), not the catalog giftId -- that is what makes the
    // wall's double-counting guard (one wall credit per real gift record)
    // correct.
    if (giftWallService) {
      await giftWallService.recordContribution({
        roomId,
        gifterId: senderId,
        giftId: record.id,
        amount: totalCostCoins,
      });
    }

    // Same "only reached after the send is already committed" guarantee
    // as every block above -- a failed/rejected send never adds battle
    // points. `amount` is the real, already-debited totalCostCoins (never
    // `quantity`). recordGiftPoints() itself decides whether roomId has
    // an active battle and whether receiverId is one of its two sides; if
    // not, this is a real no-op.
    if (battleService) {
      await battleService.recordGiftPoints({ roomId, receiverId, amount: totalCostCoins });
    }

    return record;
  }

  return { sendGift };
}

module.exports = { createGiftsService };
