import "../icons/ds-icon.js";

/**
 * <ds-checkbox label="تذكرني" checked disabled name="remember"></ds-checkbox>
 *
 * States implemented: default, hover, :active (pressed), focus-visible,
 * [checked] (= Selected), [disabled]. Toggling is real — click or Space/
 * Enter on the host flips [checked] and fires a "change" event with
 * `event.detail.checked`.
 */
class DsCheckbox extends HTMLElement {
  static get observedAttributes() {
    return ["checked", "disabled", "label"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    if (!this.hasAttribute("tabindex") && !this.hasAttribute("disabled")) {
      this.setAttribute("tabindex", "0");
    }
    this.setAttribute("role", "checkbox");
    this.render();
    this.addEventListener("click", this._onActivate);
    this.addEventListener("keydown", this._onKeydown);
  }

  disconnectedCallback() {
    this.removeEventListener("click", this._onActivate);
    this.removeEventListener("keydown", this._onKeydown);
  }

  attributeChangedCallback() {
    if (!this.shadowRoot.firstChild) return this.render();
    this.sync();
  }

  get checked() {
    return this.hasAttribute("checked");
  }

  set checked(v) {
    if (v) this.setAttribute("checked", "");
    else this.removeAttribute("checked");
  }

  _onActivate = () => {
    if (this.hasAttribute("disabled")) return;
    this.checked = !this.checked;
    this.dispatchEvent(new CustomEvent("change", { detail: { checked: this.checked }, bubbles: true, composed: true }));
  };

  _onKeydown = (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      this._onActivate();
    }
  };

  sync() {
    this.setAttribute("aria-checked", String(this.checked));
    this.setAttribute("aria-disabled", String(this.hasAttribute("disabled")));
    this.tabIndex = this.hasAttribute("disabled") ? -1 : 0;
    const icon = this.shadowRoot.querySelector("ds-icon");
    if (icon) icon.style.opacity = this.checked ? "1" : "0";
    const labelEl = this.shadowRoot.querySelector(".label");
    if (labelEl) labelEl.textContent = this.getAttribute("label") || "";
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-flex;
          align-items: center;
          gap: var(--space-2);
          font-family: var(--font-family-base);
          font-size: var(--font-size-md);
          color: var(--color-text-primary);
          cursor: pointer;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
        }

        .box {
          width: 20px;
          height: 20px;
          flex: 0 0 auto;
          border-radius: var(--radius-sm);
          border: 1.5px solid var(--color-border);
          background: var(--color-surface);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: var(--color-text-on-primary);
          transition: background var(--motion-fast) var(--motion-easing),
                      border-color var(--motion-fast) var(--motion-easing),
                      transform var(--motion-fast) var(--motion-easing);
        }

        :host(:hover) .box { border-color: var(--color-primary); }
        :host(:active) .box { transform: scale(0.92); }

        :host([checked]) .box {
          background: var(--color-primary);
          border-color: var(--color-primary);
        }

        :host(:focus-visible) .box {
          outline: 2px solid var(--color-focus-ring);
          outline-offset: 2px;
        }

        :host([disabled]) {
          opacity: 0.55;
          cursor: not-allowed;
          pointer-events: none;
        }

        ds-icon { transition: opacity var(--motion-fast) var(--motion-easing); }
      </style>
      <span class="box"><ds-icon name="check" size="14"></ds-icon></span>
      <span class="label"></span>
    `;
    this.sync();
  }
}

customElements.define("ds-checkbox", DsCheckbox);
