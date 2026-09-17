// Stage 4 — Splash screen logic.
//
// Responsibilities (see Config/CONFIG_DESIGN.md):
//   1. Show app identity while loading.
//   2. Load Config (backend -> Local Safe Config -> embedded emergency
//      config — see Mobile/app/config/config.client.js).
//   3. Load the right language/direction and apply it.
//   4. Decide where to go next: Onboarding (if not completed and enabled
//      by Config) or straight to Login.
//   5. Never crash: Loading / Error / Offline / Retry states are all
//      real, reachable UI states, not just documented intentions.

import "../../../../DesignSystem/icons/ds-icon.js";
import "../../../../DesignSystem/components/button.js";
import "../../../../DesignSystem/components/loading.js";
import { initTheme, toggleTheme, toggleDirection, setDirection } from "../../../../DesignSystem/theme/theme.js";
import { getSupportedLanguages, getLanguageMeta, loadStrings, t } from "../../../../Localization/i18n.js";
import { getAppConfig, isOnline } from "../../config/config.client.js";
import { isOnboardingCompleted } from "../../state/onboarding-state.js";

const brandTitle = document.getElementById("brand-title");
const statusText = document.getElementById("status-text");
const loader = document.getElementById("loader");
const offlineBanner = document.getElementById("offline-banner");
const retryBtn = document.getElementById("retry-btn");

initTheme();
document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
document.getElementById("dir-toggle").addEventListener("click", toggleDirection);

function setLoadingState() {
  loader.hidden = false;
  offlineBanner.hidden = true;
  retryBtn.hidden = true;
}

function setErrorState(strings) {
  loader.hidden = true;
  retryBtn.hidden = false;
  retryBtn.textContent = t(strings, "splash.retry");
  statusText.textContent = t(strings, "splash.error.body");
  brandTitle.textContent = t(strings, "splash.error.title");
}

function setMaintenanceState(strings) {
  loader.hidden = true;
  retryBtn.hidden = false;
  retryBtn.textContent = t(strings, "splash.retry");
  brandTitle.textContent = t(strings, "splash.maintenance.title");
  statusText.textContent = t(strings, "splash.maintenance.body");
}

function showOfflineBanner(strings) {
  offlineBanner.hidden = false;
  offlineBanner.textContent = `${t(strings, "splash.offline.title")} — ${t(strings, "splash.offline.body")}`;
}

function pickInitialLanguageCode(languagesConfig) {
  const supportedCodes = languagesConfig.languages.map((l) => l.code);
  const browserLang = (typeof navigator !== "undefined" && navigator.language ? navigator.language.slice(0, 2) : "");
  if (supportedCodes.includes(browserLang)) return browserLang;
  return languagesConfig.defaultLanguage;
}

function navigateNext({ config, languageCode }) {
  const target =
    config.featureFlags.onboardingEnabled && !isOnboardingCompleted()
      ? `../onboarding/index.html?lang=${encodeURIComponent(languageCode)}`
      : `../auth/index.html`;
  window.location.href = target;
}

async function bootstrap() {
  setLoadingState();

  // 1) Language: pick a reasonable initial guess so the UI is never
  // blank/hardcoded while Config (which carries the authoritative
  // default language) is still loading.
  const languagesConfig = await getSupportedLanguages();
  const languageCode = pickInitialLanguageCode(languagesConfig);
  const languageMeta = getLanguageMeta(languagesConfig, languageCode);
  const strings = await loadStrings(languageCode);

  document.documentElement.setAttribute("lang", languageMeta.code);
  setDirection(languageMeta.direction);
  brandTitle.textContent = t(strings, "app.name");
  statusText.textContent = t(strings, "splash.tagline");

  if (!isOnline()) {
    showOfflineBanner(strings);
  }

  try {
    const { config, source, warnings } = await getAppConfig();
    if (warnings.length) {
      // Visible in devtools only — never surfaced as a crash to the user.
      console.info("[splash] config warnings:", warnings, "source:", source);
    }

    // Re-apply language/direction using Config's authoritative default,
    // in case our initial guess differed and the browser language isn't
    // actually supported by this app's Config.
    const finalLanguageCode = config.languages.supported.includes(languageCode)
      ? languageCode
      : config.languages.default;
    const finalMeta = getLanguageMeta(languagesConfig, finalLanguageCode);
    const finalStrings = finalLanguageCode === languageCode ? strings : await loadStrings(finalLanguageCode);
    document.documentElement.setAttribute("lang", finalMeta.code);
    setDirection(finalMeta.direction);

    if (config.maintenance.enabled) {
      setMaintenanceState(finalStrings);
      retryBtn.onclick = () => bootstrap();
      return;
    }

    // Small, deliberate pause so Splash reads as a real screen rather
    // than a flash — not a network wait, purely presentational.
    setTimeout(() => navigateNext({ config, languageCode: finalLanguageCode }), 700);
  } catch (err) {
    // getAppConfig() is designed to never throw (it always resolves to
    // at least the embedded emergency config) — this catch exists for
    // truly unexpected errors (e.g. a broken import), so Splash still
    // never shows a blank screen or a browser error page.
    console.error("[splash] unexpected bootstrap error:", err);
    setErrorState(strings);
    retryBtn.onclick = () => bootstrap();
  }
}

bootstrap();
