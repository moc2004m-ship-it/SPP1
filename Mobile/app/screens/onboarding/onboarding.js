// Stage 4 — Onboarding screen logic.
//
// Content comes from two places, deliberately kept separate:
//   - Config (Backend/src/config, via config.client.js) decides WHICH
//     slides exist, their order, and their icons.
//   - Localization (Localization/strings/*.json) decides WHAT they say,
//     in whichever language is selected — no raw UI text is hardcoded
//     in this file.
//
// Step 0 is language selection; steps 1..N are the content slides from
// Config. "Skip" (when Config allows it) jumps straight to completion.

import "../../../../DesignSystem/icons/ds-icon.js";
import "../../../../DesignSystem/components/button.js";
import "../../../../DesignSystem/components/card.js";
import { initTheme, toggleTheme, toggleDirection, setDirection } from "../../../../DesignSystem/theme/theme.js";
import { getSupportedLanguages, getLanguageMeta, loadStrings, t } from "../../../../Localization/i18n.js";
import { getAppConfig } from "../../config/config.client.js";
import { setOnboardingCompleted } from "../../state/onboarding-state.js";

const stepLanguageEl = document.getElementById("step-language");
const stepSlideEl = document.getElementById("step-slide");
const langTitleEl = document.getElementById("lang-title");
const langBodyEl = document.getElementById("lang-body");
const langOptionsEl = document.getElementById("lang-options");
const dotsEl = document.getElementById("dots");
const slideIconEl = document.getElementById("slide-icon");
const slideTitleEl = document.getElementById("slide-title");
const slideBodyEl = document.getElementById("slide-body");
const skipBtn = document.getElementById("skip-btn");
const continueBtn = document.getElementById("continue-btn");

initTheme();
document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
document.getElementById("dir-toggle").addEventListener("click", toggleDirection);

function initialLanguageFromUrl(fallback) {
  const params = new URLSearchParams(window.location.search);
  return params.get("lang") || fallback;
}

async function main() {
  const languagesConfig = await getSupportedLanguages();
  const { config } = await getAppConfig();

  const supported = languagesConfig.languages.filter((l) => config.languages.supported.includes(l.code));
  const availableLanguages = supported.length ? supported : languagesConfig.languages;

  let currentLanguage = initialLanguageFromUrl(config.languages.default);
  if (!availableLanguages.some((l) => l.code === currentLanguage)) {
    currentLanguage = config.languages.default;
  }
  let strings = await loadStrings(currentLanguage);

  const slides = config.onboarding.slides;
  const skipEnabled = config.onboarding.skipEnabled;
  let stepIndex = 0; // 0 = language step, 1..slides.length = content slides

  function applyLanguage(meta) {
    document.documentElement.setAttribute("lang", meta.code);
    setDirection(meta.direction);
  }

  function renderLanguageOptions() {
    langOptionsEl.innerHTML = "";
    availableLanguages.forEach((lang) => {
      const btn = document.createElement("ds-button");
      btn.setAttribute("variant", "secondary");
      btn.setAttribute("full-width", "");
      if (lang.code === currentLanguage) btn.setAttribute("selected", "");
      btn.textContent = lang.name;
      btn.addEventListener("click", async () => {
        if (lang.code === currentLanguage) return;
        currentLanguage = lang.code;
        strings = await loadStrings(currentLanguage);
        applyLanguage(lang);
        render();
      });
      langOptionsEl.appendChild(btn);
    });
  }

  function renderDots() {
    dotsEl.innerHTML = "";
    slides.forEach((_, i) => {
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.dataset.active = String(i === stepIndex - 1);
      dotsEl.appendChild(dot);
    });
  }

  function render() {
    langTitleEl.textContent = t(strings, "onboarding.language.title");
    langBodyEl.textContent = t(strings, "onboarding.language.body");
    renderLanguageOptions();

    if (stepIndex === 0) {
      stepLanguageEl.hidden = false;
      stepSlideEl.hidden = true;
      skipBtn.hidden = true;
      continueBtn.textContent = t(strings, "onboarding.continue");
      return;
    }

    stepLanguageEl.hidden = true;
    stepSlideEl.hidden = false;
    const slide = slides[stepIndex - 1];
    slideIconEl.setAttribute("name", slide.icon || "logo");
    slideTitleEl.textContent = t(strings, slide.titleKey);
    slideBodyEl.textContent = t(strings, slide.bodyKey);
    renderDots();

    const isLastSlide = stepIndex === slides.length;
    skipBtn.hidden = !skipEnabled || isLastSlide;
    skipBtn.textContent = t(strings, "onboarding.skip");
    continueBtn.textContent = isLastSlide ? t(strings, "onboarding.getStarted") : t(strings, "onboarding.continue");
  }

  function finish() {
    setOnboardingCompleted(true);
    window.location.href = "../../../../DesignSystem/screens/login/index.html";
  }

  continueBtn.addEventListener("click", () => {
    if (stepIndex >= slides.length) {
      finish();
      return;
    }
    stepIndex += 1;
    render();
  });

  skipBtn.addEventListener("click", finish);

  applyLanguage(getLanguageMeta(languagesConfig, currentLanguage));
  render();
}

main().catch((err) => {
  // Onboarding is not the last line of defense against a broken config
  // (Splash already validated it) — but if something still goes wrong
  // here, fail safe by marking onboarding complete and moving on to
  // Login rather than trapping the user on a broken screen.
  console.error("[onboarding] unexpected error, skipping to login:", err);
  setOnboardingCompleted(true);
  window.location.href = "../../../../DesignSystem/screens/login/index.html";
});
