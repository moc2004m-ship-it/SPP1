/**
 * Real purchase verification boundary. Same rule as
 * ../auth/otp-sender.js and ../auth/provider-verifiers.js: the backend
 * never pretends a purchase was verified. Without a configured provider
 * verification endpoint, requests fail closed (503) -- they are never
 * treated as verified, and the wallet is never credited.
 *
 * Real integration (later stage, needs real Google Play / App Store
 * credentials + network access -- see PHASE5_CENTRAL_SYSTEMS_REPORT.md):
 *   - Google Play: Play Developer API purchases.products.get, using a
 *     service account (GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) -- verifies
 *     purchaseToken + productId against Google's servers.
 *   - App Store: App Store Server API / verifyReceipt, using
 *     APP_STORE_SHARED_SECRET -- verifies the receipt against Apple's
 *     servers.
 * Both are real, provider-specific HTTP calls with real credentials --
 * this module intentionally does not fake either one. It exposes one
 * generic, already-real HTTP verification path (cfg.verifyUrl) so any
 * deployment that already has a verification microservice/webhook can
 * plug in today; direct Google/Apple SDK integration is future work,
 * tracked explicitly, not invented here as a stub that pretends to work.
 */
async function verifyPurchase({ provider, purchaseRef, accountId, packageId }, cfg = {}) {
  if (!purchaseRef) {
    throw Object.assign(new Error('providerPurchaseRef is required'), { status: 400 });
  }
  const providerCfg = cfg[provider];
  if (!providerCfg || !providerCfg.verifyUrl) {
    throw Object.assign(new Error(`recharge provider "${provider}" is not configured`), { status: 503 });
  }

  const response = await fetch(providerCfg.verifyUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(providerCfg.headers || {}) },
    body: JSON.stringify({ purchaseRef, accountId, packageId }),
  });

  if (!response.ok) {
    throw Object.assign(new Error(`provider verification failed (${response.status})`), { status: 402 });
  }
  const data = await response.json();
  if (!data || data.valid !== true) {
    throw Object.assign(new Error('provider reported the purchase as invalid'), { status: 402 });
  }
  return { valid: true, providerTransactionId: data.providerTransactionId || null };
}

// Reads provider config from env, following the same pattern as
// ../auth/otp-sender.js / ../auth/provider-verifiers.js (no config -> the
// provider is simply "not configured", never faked).
function loadRechargeProviderConfigFromEnv(env = process.env) {
  const cfg = {};
  if (env.RECHARGE_GOOGLE_PLAY_VERIFY_URL) {
    cfg.google_play = { verifyUrl: env.RECHARGE_GOOGLE_PLAY_VERIFY_URL };
  }
  if (env.RECHARGE_APP_STORE_VERIFY_URL) {
    cfg.app_store = { verifyUrl: env.RECHARGE_APP_STORE_VERIFY_URL };
  }
  return cfg;
}

module.exports = { verifyPurchase, loadRechargeProviderConfigFromEnv };
