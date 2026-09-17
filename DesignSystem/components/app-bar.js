import "../icons/ds-icon.js";

/**
 * <ds-app-bar title="تسجيل الدخول" back></ds-app-bar>
 *   <span slot="actions">...</span>
 * </ds-app-bar>
 *
 * Fires a "ds-back" event (bubbling, composed) when the back button is
 * pressed — the parent screen decides what "back" means (navigate, close).
 *
 * The back chevron flips automatically with direction: it listens to the
 * same "ds-direction-change" event theme.js dispatches, so no per-screen
 * wiring is needed once theme.js is loaded.
 */
class DsAppBar extends HTMLElement {
  static get observedAttributes() {
    return ["title", "back"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._onDirChange = () => this.syncDirection();
  }

  connectedCallback() {
    this.render();
    window.addEventListener("ds-direction-change", this._onDirChange);
  }

  disconnectedCallback() {
    window.removeEventListener("ds-direction-change", this._onDirChange);
  }

  attributeChangedCallback() {
    if (this.shadowRoot.firstChild) this.sync();
    else this.render();
  }

  syncDirection() {
    const chevron = this.shadowRoot.querySelector(".back-icon");
    if (!chevron) return;
    const dir = document.documentElement.getAttribute("dir") || "ltr";
    chevron.style.transform = dir === "rtl" ? "scaleX(-1)" : "scaleX(1)";
  }

  sync() {
    const titleEl = this.shadowRoot.querySelector(".title");
    if (titleEl) titleEl.textContent = this.getAttribute("title") || "";
    const backBtn = this.shadowRoot.querySelector(".back-btn");
    if (backBtn) backBtn.style.display = this.hasAttribute("back") ? "inline-flex" : "none";
    this.syncDirection();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: var(--font-family-base);
        }
        .bar {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          min-height: 56px;
          padding-inline: var(--space-2);
          background: var(--color-background);
          border-block-end: 1px solid var(--color-border);
        }
        button.back-btn {
          all: unset;
          display: none;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          border-radius: var(--radius-full);
          color: var(--color-text-primary);
          cursor: pointer;
          flex: 0 0 auto;
        }
        button.back-btn:hover { background: var(--color-surface); }
        button.back-btn:active { background: var(--color-surface-alt); }
        button.back-btn:focus-visible {
          outline: 2px solid var(--color-focus-ring);
          outline-offset: 2px;
        }
        .back-icon { display: inline-flex; transition: transform var(--motion-fast) var(--motion-easing); }
        .title {
          flex: 1 1 auto;
          font-size: var(--font-size-lg);
          font-weight: var(--font-weight-semibold);
          color: var(--color-text-primary);
          text-align: start;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .actions {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          flex: 0 0 auto;
        }
      </style>
      <div class="bar">
        <button type="button" class="back-btn" aria-label="رجوع">
          <span class="back-icon"><ds-icon name="chevron" size="22"></ds-icon></span>
        </button>
        <span class="title"></span>
        <span class="actions"><slot name="actions"></slot></span>
      </div>
    `;
    this.shadowRoot.querySelector(".back-btn").addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("ds-back", { bubbles: true, composed: true }));
    });
    this.sync();
  }
}

customElements.define("ds-app-bar", DsAppBar);
