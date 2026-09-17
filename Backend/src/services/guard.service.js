// Stage 32 — Guard/Fan Club service.
//
// The ONLY code path allowed to change guard state. Same split as
// couple.service.js/family.service.js vs their repositories:
// ../database/repositories/guard.repository.js is a plain data-integrity
// layer with no opinion on pricing/authorization -- every rule below
// lives here.
//
// Rules enforced here:
//   1. assertNotSelfGuard (../database/models/guard.model.js) -- you
//      cannot purchase a guard on yourself.
//   2. Tier price/duration are ALWAYS looked up server-side from
//      ../domain/guard-catalog.js by tierKey -- never trusted from the
//      client (same boundary as family.service.js's donate()).
//   3. purchaseGuard() ALWAYS starts with a real wallet debit (real
//      coins, real catalog price) BEFORE any renewal/grant is recorded --
//      exactly the same "debit before grant" discipline as
//      store.service.js/family.service.js/gifts.service.js. No wallet
//      debit, no extension, no contribution increase. If the debit
//      rejects (insufficient balance), guards.renewGuard() is never
//      reached -- no partial grant.
//   4. Renewal semantics live in guard.repository.js's renewGuard()
//      (extend from the current expiresAt if still active, else restart
//      from now) -- this service only supplies the real, already-priced
//      coins/days and the injected clock, it never recomputes the
//      extend-vs-restart decision itself, so there is exactly one place
//      that logic can go wrong.
//   5. active/expired status is NEVER stored or trusted from a flag --
//      publicGuard() below always recomputes it by comparing expiresAt
//      to an injected now(), same discipline as event.service.js's
//      countdown, so a status can never go stale between requests.
//   6. listFanClub() returns a host's guards ordered by lifetime
//      contribution (guard.repository.js's listGuardsForHost() already
//      sorts, this only re-annotates status/secondsRemaining).

const { assertNotSelfGuard, generateGuardPurchaseId } = require('../database/models/guard.model');
const { resolveGuardTier } = require('../domain/guard-catalog');

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

// Stage 33 -- `notificationService` is an OPTIONAL constructor dependency,
// same additive pattern as couple.service.js/gifts.service.js. When
// provided, a real completed purchase reports GUARD_NEW_FAN to the host
// AFTER the real wallet debit + renewal have already committed. When
// omitted, behavior is byte-for-byte identical to before this stage.
function createGuardService({ guards, wallets, notificationService, now = () => new Date() }) {
  function publicGuard(guard) {
    const nowMs = now().getTime();
    const expiresMs = Date.parse(guard.expiresAt);
    const isActive = expiresMs > nowMs;
    return {
      fanId: guard.fanId,
      hostId: guard.hostId,
      tierKey: guard.tierKey,
      totalContributionCoins: guard.totalContributionCoins,
      expiresAt: guard.expiresAt,
      isActive,
      secondsRemaining: isActive ? Math.max(0, Math.round((expiresMs - nowMs) / 1000)) : 0,
    };
  }

  async function purchaseGuard({ actingAccountId, hostId, tierKey }) {
    if (typeof hostId !== 'string' || !hostId) throw badRequest('hostId is required');
    assertNotSelfGuard(actingAccountId, hostId);
    const tier = resolveGuardTier(tierKey); // throws 400 on unknown tierKey -- never trusts a client-supplied price/duration

    const purchaseId = generateGuardPurchaseId();

    // Real wallet debit BEFORE any extension/grant is recorded -- if
    // this rejects (insufficient balance), renewGuard() below is never
    // reached.
    const walletTransaction = await wallets.debit(actingAccountId, 'coins', tier.coins, purchaseId);

    const guard = await guards.renewGuard({
      fanId: actingAccountId,
      hostId,
      tierKey: tier.id,
      coins: tier.coins,
      days: tier.days,
      now: now(),
    });

    if (notificationService) {
      await notificationService.notify({
        recipientId: hostId,
        type: 'GUARD_NEW_FAN',
        payload: { hostId },
      });
    }

    return {
      purchaseId,
      tierKey: tier.id,
      coins: tier.coins,
      days: tier.days,
      walletTransactionId: walletTransaction.id,
      guard: publicGuard(guard),
    };
  }

  async function getGuardStatus({ actingAccountId, hostId }) {
    if (typeof hostId !== 'string' || !hostId) throw badRequest('hostId is required');
    const guard = await guards.findGuard(actingAccountId, hostId);
    return guard ? publicGuard(guard) : null;
  }

  async function listFanClub({ hostId }) {
    if (typeof hostId !== 'string' || !hostId) throw badRequest('hostId is required');
    const list = await guards.listGuardsForHost(hostId);
    return list.map(publicGuard);
  }

  return {
    purchaseGuard,
    getGuardStatus,
    listFanClub,
  };
}

module.exports = { createGuardService };
