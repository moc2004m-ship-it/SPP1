// Stage 4 — Config schema, defaults, and validation.
//
// This is the single source of truth for the *shape* of app config and
// for what a "safe" config looks like. Nothing else in the project
// should hand-roll a config object — it always starts from
// DEFAULT_CONFIG and/or goes through validateConfig() here.
//
// Design note: config content does NOT contain translated UI text.
// Onboarding slides reference Localization string keys (`titleKey`,
// `bodyKey`) instead of raw strings — the actual Arabic/English copy
// lives in ../../../Localization/strings/*.json. This keeps "what
// content exists / in what order" controllable from Config, while "what
// it says in each language" stays centralized in Localization, per the
// Stage 4 requirement not to scatter language text across screens.

const CONFIG_VERSION = 1;

// Safe, conservative values — used both as the shipped default and as
// the emergency fallback if a loaded config fails validation.
const DEFAULT_CONFIG = Object.freeze({
  configVersion: CONFIG_VERSION,
  app: Object.freeze({
    nameKey: "app.name",
    environmentLabel: "development",
  }),
  languages: Object.freeze({
    supported: Object.freeze(["ar", "en"]),
    default: "ar",
  }),
  maintenance: Object.freeze({
    enabled: false,
    messageKey: "splash.maintenance.body",
  }),
  version: Object.freeze({
    minimumSupported: "1.0.0",
    latestRecommended: "1.0.0",
  }),
  featureFlags: Object.freeze({
    onboardingEnabled: true,
  }),
  onboarding: Object.freeze({
    skipEnabled: true,
    slides: Object.freeze([
      Object.freeze({ id: "slide1", icon: "logo", titleKey: "onboarding.slide1.title", bodyKey: "onboarding.slide1.body" }),
      Object.freeze({ id: "slide2", icon: "check", titleKey: "onboarding.slide2.title", bodyKey: "onboarding.slide2.body" }),
      Object.freeze({ id: "slide3", icon: "chevron", titleKey: "onboarding.slide3.title", bodyKey: "onboarding.slide3.body" }),
    ]),
  }),
});

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}

function isBoolean(v) {
  return typeof v === "boolean";
}

/**
 * Validates a config object against the Stage 4 schema.
 * Returns { valid: boolean, errors: string[] }.
 * Never throws — a malformed config is a validation failure, not an
 * exception, so callers can always decide to fall back safely.
 */
function validateConfig(config) {
  const errors = [];

  if (!config || typeof config !== "object") {
    return { valid: false, errors: ["config must be an object"] };
  }

  if (typeof config.configVersion !== "number") {
    errors.push("configVersion must be a number");
  }

  if (!config.app || !isNonEmptyString(config.app.nameKey)) {
    errors.push("app.nameKey must be a non-empty string");
  }

  if (!config.languages || !Array.isArray(config.languages.supported) || config.languages.supported.length === 0) {
    errors.push("languages.supported must be a non-empty array");
  } else if (!config.languages.supported.every(isNonEmptyString)) {
    errors.push("languages.supported must contain only non-empty strings");
  }

  if (!config.languages || !isNonEmptyString(config.languages.default)) {
    errors.push("languages.default must be a non-empty string");
  } else if (
    Array.isArray(config.languages.supported) &&
    !config.languages.supported.includes(config.languages.default)
  ) {
    errors.push("languages.default must be one of languages.supported");
  }

  if (!config.maintenance || !isBoolean(config.maintenance.enabled)) {
    errors.push("maintenance.enabled must be a boolean");
  }
  if (!config.maintenance || !isNonEmptyString(config.maintenance.messageKey)) {
    errors.push("maintenance.messageKey must be a non-empty string");
  }

  if (!config.version || !SEMVER_RE.test(config.version.minimumSupported || "")) {
    errors.push("version.minimumSupported must be a semver string (e.g. 1.0.0)");
  }
  if (!config.version || !SEMVER_RE.test(config.version.latestRecommended || "")) {
    errors.push("version.latestRecommended must be a semver string (e.g. 1.0.0)");
  }

  if (!config.featureFlags || typeof config.featureFlags !== "object") {
    errors.push("featureFlags must be an object");
  } else if (!isBoolean(config.featureFlags.onboardingEnabled)) {
    errors.push("featureFlags.onboardingEnabled must be a boolean");
  }

  if (!config.onboarding || !isBoolean(config.onboarding.skipEnabled)) {
    errors.push("onboarding.skipEnabled must be a boolean");
  }
  if (!config.onboarding || !Array.isArray(config.onboarding.slides) || config.onboarding.slides.length === 0) {
    errors.push("onboarding.slides must be a non-empty array");
  } else {
    config.onboarding.slides.forEach((slide, i) => {
      if (!slide || !isNonEmptyString(slide.id)) errors.push(`onboarding.slides[${i}].id must be a non-empty string`);
      if (!slide || !isNonEmptyString(slide.titleKey)) errors.push(`onboarding.slides[${i}].titleKey must be a non-empty string`);
      if (!slide || !isNonEmptyString(slide.bodyKey)) errors.push(`onboarding.slides[${i}].bodyKey must be a non-empty string`);
    });
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { CONFIG_VERSION, DEFAULT_CONFIG, validateConfig };
