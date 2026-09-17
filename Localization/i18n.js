/**
 * i18n.js — single, central loading point for supported languages and
 * translated strings. Screens must NEVER hardcode UI text inline; they
 * import `t()` / `loadLanguage()` from here instead.
 *
 * Paths are resolved with `import.meta.url` (relative to THIS file, not
 * to whichever screen imports it), so any screen at any folder depth can
 * `import ... from ".../Localization/i18n.js"` and it will always find
 * `./languages.json` and `./strings/<code>.json` correctly.
 *
 * Offline / file:// safety:
 * Fetching local JSON files can fail depending on how the project is
 * opened (some browsers block `fetch()` of local files under the
 * `file://` protocol). This module NEVER lets that crash a screen — if
 * the fetch fails for any reason, it falls back to a tiny embedded
 * string set (`EMBEDDED_FALLBACK`) covering only the handful of keys a
 * Splash screen needs to stay usable (tagline/error/offline/retry).
 * Full onboarding copy still requires the JSON files to load — this is
 * a deliberate, documented limitation (see Config/STAGE4_TODO.md):
 * serving the project over a simple static server (e.g. the existing
 * Stage 1 `docker-compose` environments, or `npx serve`) instead of
 * double-clicking the HTML file avoids the file:// restriction entirely.
 */

const EMBEDDED_FALLBACK = {
  ar: {
    "app.name": "اسم التطبيق",
    "splash.tagline": "لحظة واحدة…",
    "splash.error.title": "تعذّر التحميل",
    "splash.error.body": "حدث خطأ غير متوقع.",
    "splash.offline.title": "لا يوجد اتصال",
    "splash.offline.body": "سيتم استخدام الإعدادات المحلية.",
    "splash.retry": "إعادة المحاولة",
    "common.retry": "إعادة المحاولة",
  },
  en: {
    "app.name": "App Name",
    "splash.tagline": "One moment…",
    "splash.error.title": "Couldn't load",
    "splash.error.body": "Something went wrong.",
    "splash.offline.title": "You're offline",
    "splash.offline.body": "Using local settings for now.",
    "splash.retry": "Retry",
    "common.retry": "Retry",
  },
};

const EMBEDDED_LANGUAGES = {
  defaultLanguage: "ar",
  languages: [
    { code: "ar", name: "العربية", englishName: "Arabic", direction: "rtl" },
    { code: "en", name: "English", englishName: "English", direction: "ltr" },
  ],
};

function resolveUrl(relativePath) {
  return new URL(relativePath, import.meta.url);
}

async function fetchJson(relativePath) {
  const res = await fetch(resolveUrl(relativePath));
  if (!res.ok) throw new Error(`i18n: failed to fetch ${relativePath} (${res.status})`);
  return res.json();
}

/**
 * Returns the supported-languages metadata (see languages.json). Falls
 * back to EMBEDDED_LANGUAGES if the file can't be loaded.
 */
export async function getSupportedLanguages() {
  try {
    return await fetchJson("./languages.json");
  } catch (err) {
    console.warn("[i18n] languages.json unavailable, using embedded fallback", err);
    return EMBEDDED_LANGUAGES;
  }
}

export function getLanguageMeta(languagesConfig, code) {
  return (
    languagesConfig.languages.find((l) => l.code === code) ||
    languagesConfig.languages.find((l) => l.code === languagesConfig.defaultLanguage) ||
    languagesConfig.languages[0]
  );
}

/**
 * Loads the full string table for a language code. Falls back to a
 * minimal embedded set (splash-critical keys only) if the JSON file
 * can't be loaded, and never throws.
 */
export async function loadStrings(code) {
  try {
    return await fetchJson(`./strings/${code}.json`);
  } catch (err) {
    console.warn(`[i18n] strings/${code}.json unavailable, using embedded fallback`, err);
    return EMBEDDED_FALLBACK[code] || EMBEDDED_FALLBACK[EMBEDDED_LANGUAGES.defaultLanguage];
  }
}

/**
 * Look up `key` in `strings`, with optional {token} interpolation, and a
 * visible-in-dev fallback (the key itself) if the key is missing — this
 * makes a missing translation obvious instead of silently blank.
 */
export function t(strings, key, params) {
  let value = strings && Object.prototype.hasOwnProperty.call(strings, key) ? strings[key] : key;
  if (params) {
    for (const [name, val] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${name}\\}`, "g"), String(val));
    }
  }
  return value;
}
