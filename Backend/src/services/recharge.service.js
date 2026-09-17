// Phase 5 — Recharge service.
// Stage 27/28 — `accounts` is an OPTIONAL constructor dependency. When
// provided, a completed order's coinsToCredit is added to
// lifetimeDiamondsRecharged (../database/repositories/account.repository.js's
// addLifetimeRecharge()) -- the counter vip/svip are derived from (see
// ../domain/vip-tiers.js). When omitted, behavior is byte-for-byte
// identical to before this stage -- existing callers/tests that never
// passed `accounts` keep working unchanged (see test/recharge.service.test.js).
//
// Orchestrates: recharge order (persistence) + real provider verification
// + wallet credit. This is the ONLY code path that may credit coins for a
// recharge. No route, no model, nothing else calls wallets.credit() for a
// recharge reason.
//
// Flow:
//   1. createOrder(accountId, packageId, provider): resolves coinsToCredit
//      from the server-side catalog (recharge.model.js), inserts a
//      'pending' order. Nothing is credited yet.
//   2. completeOrder(orderId, accountId, providerPurchaseRef): verifies
//      the purchase against the real provider (verifyPurchase). Only on a
//      real 'valid: true' response does it call wallets.credit() with
//      idempotencyKey = orderId (so a retried complete call, or a
//      duplicated webhook, can never credit twice) and mark the order
//      'completed'. Any verification failure marks the order 'failed' and
//      credits nothing. lifetimeDiamondsRecharged is only ever bumped on
//      THIS fresh-completion path, never on the already-completed
//      idempotent no-op below -- so a retried complete call can't
//      double-count toward VIP/SVIP either.

const { resolvePackage, assertValidProvider, assertValidPurchaseRef } = require('../database/models/recharge.model');
const { verifyPurchase } = require('./recharge-provider-verifier');

// Stage 33 -- `notificationService` is an OPTIONAL constructor dependency,
// same additive pattern as `accounts` above. When provided,
// PAYMENT_COMPLETED is reported AFTER the real wallet credit has already
// committed, and ONLY on the fresh-completion path -- never on the
// already-completed idempotent no-op just above (a retried complete call
// must not re-notify). When omitted, behavior is byte-for-byte identical
// to before this stage.
function createRechargeService({ recharges, wallets, providerConfig = {}, verify = verifyPurchase, accounts, notificationService }) {
  async function createOrder(accountId, packageId, provider) {
    assertValidProvider(provider);
    const pkg = resolvePackage(packageId); // throws 400 on unknown packageId -- never trusts a client-supplied coin amount
    return recharges.create(accountId, pkg.id, pkg.coins, provider);
  }

  async function completeOrder(orderId, accountId, providerPurchaseRef) {
    assertValidPurchaseRef(providerPurchaseRef);
    const order = await recharges.findById(orderId);
    if (!order) throw Object.assign(new Error('recharge order not found'), { status: 404 });
    if (order.accountId !== accountId) {
      throw Object.assign(new Error('this recharge order does not belong to you'), { status: 403 });
    }
    if (order.status === 'completed') return order; // already done -- idempotent no-op, wallet not touched again

    try {
      await verify(
        { provider: order.provider, purchaseRef: providerPurchaseRef, accountId, packageId: order.packageId },
        providerConfig
      );
    } catch (err) {
      await recharges.markFailed(orderId, providerPurchaseRef, err.message);
      throw err; // real error (e.g. 503 not configured, 402 invalid) surfaces to the caller -- never swallowed into a fake success
    }

    // idempotencyKey = orderId: even if this exact call is somehow
    // triggered twice (retry, duplicate webhook), the wallet only ever
    // applies the credit once.
    const walletTransaction = await wallets.credit(accountId, 'coins', order.coinsToCredit, orderId);
    const completedOrder = await recharges.markCompleted(orderId, providerPurchaseRef, walletTransaction.id);
    if (accounts) {
      await accounts.addLifetimeRecharge(accountId, order.coinsToCredit);
    }
    if (notificationService) {
      await notificationService.notify({
        recipientId: accountId,
        type: 'PAYMENT_COMPLETED',
        payload: { orderId },
      });
    }
    return completedOrder;
  }

  return { createOrder, completeOrder };
}

module.exports = { createRechargeService };
