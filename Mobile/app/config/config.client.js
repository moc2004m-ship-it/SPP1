/**
 * config.client.js — the client's side of the Config system.
 *
 * "لا تجعل الـ client هو مصدر الحقيقة النهائي" / "إذا فشل Backend لاحقًا:
 * يستخدم التطبيق Local Safe Config": this module tries the backend
 * `GET /config` endpoint first, and only falls back to a local, checked-
 * in "safe" config if the backend is unreachable, slow, or returns an
 * invalid shape. It never throws and never lets the caller end up with
 * no config at all — see the 3-level fallback in getAppConfig() below.
 *
 * TODO (later stage, needs a real deployment): `baseUrl` currently
 * defaults to "" (same-origin relative /config). Once the backend has a
 * real address (staging/production), set it explicitly here or from a
 * build-time value — see Config/STAGE4_TODO.md.
 */

import { validateClientConfigShape } from "./config-shape.js";

const DEFAULT_TIMEOUT_MS = 4000;

// Last-resort, hardcoded copy of a safe config. Used ONLY if both the
// backend AND the local-safe-config.json file fail to load (e.g. the
// project was opened as a raw file:// page in a browser that blocks
// local `fetch()`). Keep this in sync with local-safe-config.json by
// hand — see Config/STAGE4_TODO.md for making this a single source
// once a build step exists.
const EMBEDDED_SAFE_CONFIG = {
  configVersion: 1,
  app: { nameKey: "app.name", environmentLabel: "development" },
  languages: { supported: ["ar", "en"], default: "ar" },
  maintenance: { enabled: false, messageKey: "splash.maintenance.body" },
  version: { minimumSupported: "1.0.0", latestRecommended: "1.0.0" },
  featureFlags: { onboardingEnabled: true },
  onboarding: {
    skipEnabled: true,
    slides: [
      { id: "slide1", icon: "logo", titleKey: "onboarding.slide1.title", bodyKey: "onboarding.slide1.body" },
      { id: "slide2", icon: "check", titleKey: "onboarding.slide2.title", bodyKey: "onboarding.slide2.body" },
      { id: "slide3", icon: "chevron", titleKey: "onboarding.slide3.title", bodyKey: "onboarding.slide3.body" },
    ],
  },
};

async function fetchBackendConfig(baseUrl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/config`, { signal: controller.signal });
    if (!res.ok) throw new Error(`backend /config responded ${res.status}`);
    const body = await res.json();
    return body.config;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLocalSafeConfigFile() {
  const url = new URL("./local-safe-config.json", import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`local-safe-config.json responded ${res.status}`);
  const parsed = await res.json();
  delete parsed._note;
  return parsed;
}

/** True/false best-effort connectivity check. Defaults to `true` (assume
 * online) in non-browser contexts where `navigator` doesn't exist, so
 * this never blocks a config attempt on its own. */
export function isOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/**
 * Resolves to { config, source, warnings }.
 * source is one of: 'backend' | 'local-safe-file' | 'embedded-safe'.
 * Never rejects.
 */
export async function getAppConfig({ baseUrl = "", timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const warnings = [];

  if (isOnline()) {
    try {
      const config = await fetchBackendConfig(baseUrl, timeoutMs);
      if (validateClientConfigShape(config)) {
        return { config, source: "backend", warnings };
      }
      warnings.push("backend /config returned an unexpected shape, ignoring it");
    } catch (err) {
      warnings.push(`backend /config unreachable: ${err.message}`);
    }
  } else {
    warnings.push("device is offline, skipping backend /config");
  }

  try {
    const config = await fetchLocalSafeConfigFile();
    if (validateClientConfigShape(config)) {
      return { config, source: "local-safe-file", warnings };
    }
    warnings.push("local-safe-config.json has an unexpected shape, ignoring it");
  } catch (err) {
    warnings.push(`local-safe-config.json unavailable: ${err.message}`);
  }

  warnings.push("using embedded emergency config");
  return { config: EMBEDDED_SAFE_CONFIG, source: "embedded-safe", warnings };
}
