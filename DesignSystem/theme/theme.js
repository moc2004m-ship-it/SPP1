/**
 * theme.js — single control point for:
 *   - Dark / Light mode  -> sets [data-theme] on <html>, drives tokens.css
 *   - RTL / LTR direction -> sets [dir] on <html>, drives logical CSS props
 *
 * No localStorage/sessionStorage is used here on purpose (this module also
 * ships inside artifacts previewed in-chat, where browser storage is not
 * supported) — state lives in memory for the lifetime of the page. Wiring
 * this to a real persistence layer (device settings, backend user prefs)
 * is a Stage 3+ concern, not a Design System concern.
 */

const state = {
  theme: "light",
  direction: "ltr",
};

export function setTheme(theme) {
  if (theme !== "light" && theme !== "dark") return;
  state.theme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  window.dispatchEvent(
    new CustomEvent("ds-theme-change", { detail: { theme } })
  );
}

export function toggleTheme() {
  setTheme(state.theme === "light" ? "dark" : "light");
}

export function getTheme() {
  return state.theme;
}

export function setDirection(direction) {
  if (direction !== "ltr" && direction !== "rtl") return;
  state.direction = direction;
  document.documentElement.setAttribute("dir", direction);
  window.dispatchEvent(
    new CustomEvent("ds-direction-change", { detail: { direction } })
  );
}

export function toggleDirection() {
  setDirection(state.direction === "ltr" ? "rtl" : "ltr");
}

export function getDirection() {
  return state.direction;
}

/**
 * Call once on page load to sync state with whatever the HTML document
 * already declared (e.g. <html lang="ar" dir="rtl">), instead of silently
 * overriding it with the module defaults.
 */
export function initTheme() {
  const htmlDir = document.documentElement.getAttribute("dir");
  const htmlTheme = document.documentElement.getAttribute("data-theme");
  if (htmlDir === "rtl" || htmlDir === "ltr") state.direction = htmlDir;
  if (htmlTheme === "light" || htmlTheme === "dark") state.theme = htmlTheme;
  document.documentElement.setAttribute("dir", state.direction);
  document.documentElement.setAttribute("data-theme", state.theme);
}
