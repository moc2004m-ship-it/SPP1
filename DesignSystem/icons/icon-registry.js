/**
 * icon-registry.js
 * Single source of truth for every icon in the project.
 *
 * Style contract (must hold for every icon added here):
 *   - viewBox="0 0 24 24"
 *   - stroke="currentColor", fill="none" (so color comes from CSS `color`)
 *   - stroke-width="1.8", stroke-linecap="round", stroke-linejoin="round"
 *   - kebab-case name, one visual concept per icon
 *
 * Never inline a duplicate copy of an icon's SVG anywhere else in the
 * project — always add it here once and reference it by name via
 * <ds-icon name="...">.
 */

export const ICONS = {
  logo: `
    <path d="M12 2 L20 7 V17 L12 22 L4 17 V7 Z" />
    <path d="M12 2 V22 M4 7 L20 17 M20 7 L4 17" />
  `,
  mail: `
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 7 L12 13 L21 7" />
  `,
  lock: `
    <rect x="4" y="11" width="16" height="9" rx="2" />
    <path d="M7 11 V7 a5 5 0 0 1 10 0 v4" />
  `,
  eye: `
    <path d="M2 12 C4.5 7 8 5 12 5 C16 5 19.5 7 22 12 C19.5 17 16 19 12 19 C8 19 4.5 17 2 12 Z" />
    <circle cx="12" cy="12" r="3" />
  `,
  "eye-off": `
    <path d="M3 3 L21 21" />
    <path d="M9.9 5.3 C10.6 5.1 11.3 5 12 5 C16 5 19.5 7 22 12 C21.2 13.6 20.2 14.9 19.1 16" />
    <path d="M6.4 6.9 C4.5 8.2 3 9.9 2 12 C4.5 17 8 19 12 19 C13.4 19 14.7 18.7 15.9 18.2" />
    <path d="M9.9 14.1 A3 3 0 0 0 14.1 9.9" />
  `,
  chevron: `
    <path d="M15 5 L8 12 L15 19" />
  `,
  check: `
    <path d="M4 12.5 L9.5 18 L20 6" />
  `,
  close: `
    <path d="M5 5 L19 19 M19 5 L5 19" />
  `,
};

export function getIconMarkup(name) {
  const body = ICONS[name];
  if (!body) {
    // Fail loudly in dev rather than silently rendering nothing —
    // an unknown icon name is a bug in the caller, not a normal state.
    console.warn(`[ds-icon] Unknown icon name: "${name}"`);
    return "";
  }
  return `
    <svg viewBox="0 0 24 24" width="100%" height="100%"
         fill="none" stroke="currentColor" stroke-width="1.8"
         stroke-linecap="round" stroke-linejoin="round"
         aria-hidden="true" focusable="false">
      ${body}
    </svg>
  `;
}

export const ICON_NAMES = Object.keys(ICONS);
