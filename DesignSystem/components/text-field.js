import "../icons/ds-icon.js";

/**
 * <ds-text-field
 *    label="Email" placeholder="you@example.com" type="text|email|password"
 *    icon="mail" name="email" value="" required disabled error error-text="...">
 * </ds-text-field>
 *
 * Real states implemented on the component: default, focus (:focus-within),
 * filled (has value), error, disabled. Password fields get a real
 * show/hide toggle wired to the eye / eye-off icons.
 *
 * Property/event contract:
 *   - `.value` getter/setter mirrors the internal <input>.
 *   - Fires "input" and "change" events (bubbling, composed) so a parent
 *     screen can listen the same way it would on a native <input>.
 */
class DsTextField extends HTMLElement {
  static get observedAttributes() {
    return ["label", "placeholder", "type", "icon", "value", "disabled", "error", "error-text", "required", "name"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._revealed = false;
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback(name) {
    if (!this.shadowRoot.firstChild) return this.render();
    if (name === "value") {
      const input = this.shadowRoot.querySelector("input");
      if (input && input.value !== this.getAttribute("value")) {
        input.value = this.getAttribute("value") || "";
      }
    }
    this.sync();
  }

  get value() {
    const input = this.shadowRoot.querySelector("input");
    return input ? input.value : this.getAttribute("value") || "";
  }

  set value(v) {
    this.setAttribute("value", v);
  }

  get isPassword() {
    return this.getAttribute("type") === "password";
  }

  sync() {
    const input = this.shadowRoot.querySelector("input");
    const wrapper = this.shadowRoot.querySelector(".field");
    input.disabled = this.hasAttribute("disabled");
    input.required = this.hasAttribute("required");
    input.type = this.isPassword ? (this._revealed ? "text" : "password") : (this.getAttribute("type") || "text");
    wrapper.classList.toggle("has-value", !!input.value);
    wrapper.classList.toggle("is-error", this.hasAttribute("error"));
    const errorEl = this.shadowRoot.querySelector(".error-text");
    if (errorEl) errorEl.textContent = this.getAttribute("error-text") || "";
    const toggle = this.shadowRoot.querySelector(".reveal-toggle");
    if (toggle) {
      const icon = toggle.querySelector("ds-icon");
      icon.setAttribute("name", this._revealed ? "eye-off" : "eye");
      toggle.setAttribute("aria-label", this._revealed ? "إخفاء كلمة المرور" : "إظهار كلمة المرور");
    }
  }

  render() {
    const label = this.getAttribute("label") || "";
    const placeholder = this.getAttribute("placeholder") || "";
    const iconName = this.getAttribute("icon");
    const isPassword = this.isPassword;
    const id = `ds-input-${Math.random().toString(36).slice(2, 8)}`;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: var(--font-family-base);
        }

        label {
          display: block;
          font-size: var(--font-size-sm);
          font-weight: var(--font-weight-medium);
          color: var(--color-text-primary);
          margin-block-end: var(--space-2);
        }

        .field {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          padding-inline: var(--space-3);
          min-height: 48px;
          transition: border-color var(--motion-fast) var(--motion-easing),
                      box-shadow var(--motion-fast) var(--motion-easing);
        }

        .field:focus-within {
          border-color: var(--color-primary);
          box-shadow: 0 0 0 3px var(--color-focus-ring);
        }

        .field.is-error {
          border-color: var(--color-danger);
        }
        .field.is-error:focus-within {
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-danger) 35%, transparent);
        }

        :host([disabled]) .field {
          opacity: 0.55;
          pointer-events: none;
        }

        ds-icon { flex: 0 0 auto; color: var(--color-text-secondary); }
        .field:focus-within ds-icon { color: var(--color-primary); }

        input {
          all: unset;
          flex: 1 1 auto;
          min-width: 0;
          font-family: var(--font-family-base);
          font-size: var(--font-size-md);
          color: var(--color-text-primary);
          padding-block: var(--space-3);
        }
        input::placeholder { color: var(--color-text-secondary); }

        button.reveal-toggle {
          all: unset;
          flex: 0 0 auto;
          display: inline-flex;
          cursor: pointer;
          color: var(--color-text-secondary);
          border-radius: var(--radius-sm);
        }
        button.reveal-toggle:focus-visible {
          outline: 2px solid var(--color-focus-ring);
          outline-offset: 2px;
        }

        .error-text {
          display: none;
          font-size: var(--font-size-xs);
          color: var(--color-danger);
          margin-block-start: var(--space-1);
        }
        .field.is-error ~ .error-text { display: block; }
      </style>

      ${label ? `<label for="${id}">${label}</label>` : ""}
      <div class="field">
        ${iconName ? `<ds-icon name="${iconName}" size="18"></ds-icon>` : ""}
        <input id="${id}" placeholder="${placeholder}" value="${this.getAttribute("value") || ""}" />
        ${isPassword ? `<button type="button" class="reveal-toggle" aria-label="إظهار كلمة المرور"><ds-icon name="eye" size="18"></ds-icon></button>` : ""}
      </div>
      <div class="error-text"></div>
    `;

    const input = this.shadowRoot.querySelector("input");
    input.addEventListener("input", () => {
      this.setAttribute("value", input.value);
      this.shadowRoot.querySelector(".field").classList.toggle("has-value", !!input.value);
      this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    });
    input.addEventListener("change", () => {
      this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    });

    const toggle = this.shadowRoot.querySelector(".reveal-toggle");
    if (toggle) {
      toggle.addEventListener("click", () => {
        this._revealed = !this._revealed;
        this.sync();
        input.focus();
      });
    }

    this.sync();
  }
}

customElements.define("ds-text-field", DsTextField);
