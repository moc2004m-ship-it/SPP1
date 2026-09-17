/**
 * onboarding-state.js — remembers whether onboarding has been completed,
 * so it isn't shown again on every launch (per Stage 4 requirement).
 *
 * Storage: tries `localStorage` first (works for this static web-based
 * client today) and transparently falls back to an in-memory value if
 * `localStorage` throws or isn't available (private browsing, or a
 * future native-mobile shell with no `localStorage`). In the in-memory
 * fallback case the flag does NOT survive a real app restart — that is
 * a known, documented gap, not a silent bug. TODO for a later stage:
 * back this with real device storage (e.g. AsyncStorage / SharedPreferences
 * equivalent) once this becomes a native mobile shell — see
 * Config/STAGE4_TODO.md.
 */

const STORAGE_KEY = "onboarding_completed_v1";

let memoryFallback = false;

function hasWorkingLocalStorage() {
  try {
    const testKey = "__ds_storage_test__";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return true;
  } catch (err) {
    return false;
  }
}

const storageAvailable = typeof window !== "undefined" && hasWorkingLocalStorage();

export function isOnboardingCompleted() {
  if (storageAvailable) {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  }
  return memoryFallback;
}

export function setOnboardingCompleted(value = true) {
  if (storageAvailable) {
    window.localStorage.setItem(STORAGE_KEY, value ? "true" : "false");
  } else {
    memoryFallback = value;
  }
}

// Dev/testing helper only — not used by any real screen flow.
export function resetOnboardingStateForTesting() {
  setOnboardingCompleted(false);
}
