/**
 * config-shape.js — a deliberately small, dependency-free re-check of
 * the config shape on the client side.
 *
 * This is NOT a full re-implementation of
 * Backend/src/config/config.schema.js's validateConfig() — it only
 * checks the handful of fields the client actually reads before using
 * them (so a malformed response can't crash Splash/Onboarding with a
 * `Cannot read property of undefined`). The backend remains the source
 * of truth for full validation. Documented duplication — see
 * Config/STAGE4_TODO.md for consolidating this once a shared build step
 * exists between Backend and Mobile.
 */
export function validateClientConfigShape(config) {
  if (!config || typeof config !== "object") return false;
  if (!config.languages || !Array.isArray(config.languages.supported) || !config.languages.default) return false;
  if (!config.maintenance || typeof config.maintenance.enabled !== "boolean") return false;
  if (!config.featureFlags || typeof config.featureFlags !== "object") return false;
  if (!config.onboarding || !Array.isArray(config.onboarding.slides)) return false;
  return config.onboarding.slides.every(
    (s) => s && typeof s.titleKey === "string" && typeof s.bodyKey === "string"
  );
}
