// Stage 4 — Config service.
//
// getConfig() is the ONE place the rest of the backend (routes, future
// stages) should call to read app config. It never throws and it never
// returns an invalid config: if the local file is missing, malformed, or
// fails schema validation, it logs why and serves DEFAULT_CONFIG instead
// — a config endpoint that crashes or returns garbage is worse than one
// that quietly serves safe defaults.
//
// "لا تجعل الـ client هو مصدر الحقيقة النهائي": today this reads from a
// local JSON file (local-config.json) checked into the repo. A LATER
// stage can point this at a real database/admin panel without changing
// the schema, the route, or any client code — see Config/STAGE4_TODO.md.

const fs = require("fs");
const path = require("path");
const { DEFAULT_CONFIG, validateConfig } = require("./config.schema");

const LOCAL_CONFIG_PATH = path.join(__dirname, "local-config.json");

let cached = null;

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override !== undefined ? override : base;
  }
  if (typeof base === "object" && base !== null && typeof override === "object" && override !== null) {
    const out = { ...base };
    for (const key of Object.keys(override)) {
      out[key] = deepMerge(base[key], override[key]);
    }
    return out;
  }
  return override !== undefined ? override : base;
}

function loadLocalConfigFile() {
  const raw = fs.readFileSync(LOCAL_CONFIG_PATH, "utf8");
  const parsed = JSON.parse(raw);
  delete parsed._note; // documentation-only field, not part of the schema
  return parsed;
}

/**
 * Builds the effective config: DEFAULT_CONFIG merged with whatever is in
 * local-config.json, then validated. Falls back to DEFAULT_CONFIG alone
 * (source: 'default-fallback') if the file is missing/unreadable/invalid
 * JSON, or if the merged result fails schema validation.
 */
function buildConfig() {
  let fileConfig;
  try {
    fileConfig = loadLocalConfigFile();
  } catch (err) {
    return {
      config: DEFAULT_CONFIG,
      source: "default-fallback",
      errors: [`local-config.json unreadable/invalid JSON: ${err.message}`],
    };
  }

  const merged = deepMerge(DEFAULT_CONFIG, fileConfig);
  const { valid, errors } = validateConfig(merged);

  if (!valid) {
    return { config: DEFAULT_CONFIG, source: "default-fallback", errors };
  }

  return { config: merged, source: "local-file", errors: [] };
}

/**
 * Returns the cached, validated config. Pass { forceRefresh: true } to
 * re-read local-config.json from disk (useful for tests / hot reload of
 * the dev file — no server restart needed).
 */
function getConfig({ forceRefresh = false } = {}) {
  if (!cached || forceRefresh) {
    cached = buildConfig();
  }
  return cached;
}

// Test-only: clears the cache so tests don't leak state between runs.
function resetConfigCacheForTests() {
  cached = null;
}

module.exports = { getConfig, resetConfigCacheForTests, LOCAL_CONFIG_PATH };
