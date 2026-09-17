import "../icons/ds-icon.js";

/**
 * <ds-button variant="primary|secondary|danger|ghost" size="md|sm"
 *            disabled loading selected icon="icon-name" icon-position="start|end">
 *   Label text (slot)
 * </ds-button>
 *
 * Real interactive states implemented on the component itself (not just
 * documented): default, hover, :active (pressed), focus-visible,
 * [disabled], [loading], [selected]. All colors/spacing/radius/typography
 * come from tokens.css custom properties, which inherit through the
 * Shadow DOM boundary automatically — no token values are duplicated here.
 *
 * Events:
 *   - Fires a normal "click" event, EXCEPT while [disabled] or [loading]
 *     is set, in which case clicks are swallowed (native <button disabled>
 *     behavior, extended to loading).
 */
class DsButton extends HTMLElement {
  static get observedAttributes() {
    return ["disabled", "loading", "variant", "size", "selected", "icon", "icon-position"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    if (this.shadowRoot.firstChild) this.sync();
    else this.render();
  }

  get isDisabled() {
    return this.hasAttribute("disabled") || this.hasAttribute("loading");
  }

  sync() {
    const btn = this.shadowRoot.querySelector("button");
    btn.disabled = this.isDisabled;
    btn.setAttribute("aria-busy", String(this.hasAttribute("loading")));
    btn.setAttribute("aria-pressed", String(this.hasAttribute("selected")));
    const iconEl = this.shadowRoot.querySelector("ds-icon");
    const name = this.getAttribute("icon");
    if (iconEl) {
      if (name) iconEl.setAttribute("name", name);
      iconEl.style.display = name && !this.hasAttribute("loading") ? "inline-flex" : "none";
    }
    const spinner = this.shadowRoot.querySelector(".spinner");
    if (spinner) spinner.style.display = this.hasAttribute("loading") ? "inline-flex" : "none";
  }

  render() {
    const iconName = this.getAttribute("icon");
    const iconPosition = this.getAttribute("icon-position") === "end" ? "end" : "start";

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-block;
          font-family: var(--font-family-base);
        }
        :host([full-width]) { display: block; }
        :host([full-width]) button { width: 100%; }

        button {
          all: unset;
          box-sizing: border-box;
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: var(--space-2);
          flex-direction: ${iconPosition === "end" ? "row-reverse" : "row"};
          min-height: 44px;
          padding-inline: var(--space-5);
          border-radius: var(--radius-md);
          font-size: var(--font-size-md);
          font-weight: var(--font-weight-semibold);
          cursor: pointer;
          transition: background var(--motion-fast) var(--motion-easing),
                      transform var(--motion-fast) var(--motion-easing),
                      box-shadow var(--motion-fast) var(--motion-easing),
                      opacity var(--motion-fast) var(--motion-easing);
          user-select: none;
          white-space: nowrap;
        }

        :host([size="sm"]) button {
          min-height: 36px;
          padding-inline: var(--space-4);
          font-size: var(--font-size-sm);
        }

        /* ---- Variant: primary (default) ---- */
        button {
          background: var(--color-primary);
          color: var(--color-text-on-primary);
        }
        button:hover { filter: brightness(1.05); }
        button:active { background: var(--color-primary-pressed); transform: scale(0.98); }

        /* ---- Variant: secondary ---- */
        :host([variant="secondary"]) button {
          background: var(--color-surface);
          color: var(--color-text-primary);
          border: 1px solid var(--color-border);
        }
        :host([variant="secondary"]) button:active { background: var(--color-surface-alt); }

        /* ---- Variant: danger ---- */
        :host([variant="danger"]) button {
          background: var(--color-danger);
          color: var(--color-text-on-primary);
        }
        :host([variant="danger"]) button:active { filter: brightness(0.9); }

        /* ---- Variant: ghost ---- */
        :host([variant="ghost"]) button {
          background: transparent;
          color: var(--color-primary);
        }
        :host([variant="ghost"]) button:active { background: var(--color-surface); }

        /* ---- Selected (persistent pressed-like state, e.g. toggle/segmented) ---- */
        :host([selected]) button {
          box-shadow: inset 0 0 0 2px var(--color-primary);
        }

        /* ---- Focus (keyboard only) ---- */
        button:focus-visible {
          outline: 2px solid var(--color-focus-ring);
          outline-offset: 2px;
        }

        /* ---- Loading ---- */
        :host([loading]) button {
          cursor: progress;
          color: transparent;
        }
        .spinner {
          display: none;
          position: absolute;
          width: 18px;
          height: 18px;
          border-radius: var(--radius-full);
          border: 2px solid currentColor;
          border-inline-end-color: transparent;
          animation: ds-spin 700ms linear infinite;
          color: var(--color-text-on-primary);
        }
        :host([variant="secondary"]) .spinner,
        :host([variant="ghost"]) .spinner { color: var(--color-primary); }
        :host([loading]) .spinner { display: inline-flex; }
        @keyframes ds-spin { to { transform: rotate(360deg); } }

        /* ---- Disabled ---- */
        :host([disabled]) button,
        :host([loading]) button {
          opacity: 0.55;
          pointer-events: none;
        }

        ds-icon { flex: 0 0 auto; }
      </style>
      <button type="button" part="button">
        ${iconName ? `<ds-icon name="${iconName}" size="18"></ds-icon>` : ""}
        <span class="spinner"></span>
        <slot></slot>
      </button>
    `;
    this.sync();
  }
}

customElements.define("ds-button", DsButton);
