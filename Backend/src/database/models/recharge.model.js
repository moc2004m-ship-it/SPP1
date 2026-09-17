// Phase 5 — Recharge model.
//
// coinsToCredit is ALWAYS resolved server-side from packageId via the
// catalog below -- never accepted as a number from the client. A client
// that could say "credit me 999999999 coins" and have the server believe
// it is exactly the fake-recharge shortcut this project must not take.

const crypto = require('node:crypto');

function generateRechargeOrderId() {
  return `rchg_${crypto.randomUUID()}`;
}

// Server-owned recharge package catalog. Real product/pricing decisions
// (what packages exist, exact coin amounts) belong to product/business,
// not to this code -- these are placeholder-free but illustrative
// starting values, clearly not secret, safe to keep in source, and meant
// to be edited by whoever owns pricing before real launch.
const PACKAGES = Object.freeze({
  pkg_small: Object.freeze({ id: 'pkg_small', coins: 100 }),
  pkg_medium: Object.freeze({ id: 'pkg_medium', coins: 550 }),
  pkg_large: Object.freeze({ id: 'pkg_large', coins: 1200 }),
});

const PROVIDERS = Object.freeze(['google_play', 'app_store']);

// Stage 25 -- real, server-owned package catalog exposed to clients (GET
// /api/recharge/packages). Returns a plain array (not the raw frozen
// object) sorted by coins ascending, so the Mobile client can render real
// packages/prices instead of hardcoding packageId strings it has no way
// to otherwise discover. Never includes anything beyond what PACKAGES
// itself already holds -- no invented price/currency field that isn't
// backed by real data.
function listPackages() {
  return Object.values(PACKAGES)
    .map((pkg) => ({ ...pkg }))
    .sort((a, b) => a.coins - b.coins);
}

function resolvePackage(packageId) {
  const pkg = PACKAGES[packageId];
  if (!pkg) {
    throw Object.assign(new Error(`unknown packageId; must be one of ${Object.keys(PACKAGES).join(', ')}`), {
      status: 400,
    });
  }
  return pkg;
}

function assertValidProvider(provider) {
  if (!PROVIDERS.includes(provider)) {
    throw Object.assign(new Error(`provider must be one of ${PROVIDERS.join(', ')}`), { status: 400 });
  }
}

function assertValidPurchaseRef(ref) {
  if (typeof ref !== 'string' || !ref.trim() || ref.length > 4000) {
    throw Object.assign(new Error('providerPurchaseRef must be a non-empty string'), { status: 400 });
  }
}

module.exports = {
  generateRechargeOrderId,
  PACKAGES,
  PROVIDERS,
  listPackages,
  resolvePackage,
  assertValidProvider,
  assertValidPurchaseRef,
};
