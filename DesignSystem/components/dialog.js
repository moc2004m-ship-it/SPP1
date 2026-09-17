import "../icons/ds-icon.js";

/**
 * <ds-dialog open title="عنوان" variant="dialog|sheet">
 *   ...content (slot)...
 * </ds-dialog>
 *
 * States: [open] / closed. Closing via the X button, the overlay (backdrop)
 * click, or Escape all fire a "ds-close" event (bubbling, composed) instead
 * of removing the element — the parent screen owns the [open] attribute,
 * same pattern as native <dialog>.
 */
class DsDialog extends HTMLElement {
  static get observedAttributes() {
    return ["open", "title", "variant"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._onKeydown = (e) => {
      if (e.key === "Escape" && this.hasAttribute("open")) this._requestClose();
    };
  }

  connectedCallback() {
    this.render();
    document.addEventListener("keydown", this._onKeydown);
  }

  disconnectedCallback() {
    document.removeEventListener("keydown", this._onKeydown);
  }

  attributeChangedCallback() {
    if (this.shadowRoot.firstChild) this.sync();
    else this.render();
  }

  _requestClose() {
    this.dispatchEvent(new CustomEvent("ds-close", { bubbles: true, composed: true }));
  }

  sync() {
    const overlay = this.shadowRoot.querySelector(".overlay");
    overlay.classList.toggle("is-open", this.hasAttribute("open"));
    overlay.setAttribute("aria-hidden", String(!this.hasAttribute("open")));
    const titleEl = this.shadowRoot.querySelector(".title");
    if (titleEl) titleEl.textContent = this.getAttribute("title") || "";
    const panel = this.shadowRoot.querySelector(".panel");
    panel.classList.toggle("as-sheet", this.getAttribute("variant") === "sheet");
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { font-family: var(--font-family-base); }

        .overlay {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.45);
          opacity: 0;
          pointer-events: none;
          transition: opacity var(--motion-normal) var(--motion-easing);
          z-index: 1000;
        }
        .overlay.is-open { opacity: 1; pointer-events: auto; }

        .panel {
          background: var(--color-background);
          color: var(--color-text-primary);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-lg);
          width: min(420px, calc(100vw - var(--space-8)));
          max-height: min(80vh, 640px);
          overflow: auto;
          transform: scale(0.96) translateY(8px);
          transition: transform var(--motion-normal) var(--motion-easing);
        }
        .overlay.is-open .panel { transform: scale(1) translateY(0); }

        .panel.as-sheet {
          width: 100%;
          max-width: 480px;
          border-radius: var(--radius-xl) var(--radius-xl) 0 0;
          position: fixed;
          inset-inline: 0;
          inset-block-end: 0;
          margin-inline: auto;
          transform: translateY(16px);
        }
        .overlay.is-open .panel.as-sheet { transform: translateY(0); }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3);
          padding: var(--space-5);
          border-block-end: 1px solid var(--color-border);
        }
        .title { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); margin: 0; }

        button.close-btn {
          all: unset;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: var(--radius-full);
          color: var(--color-text-secondary);
          cursor: pointer;
          flex: 0 0 auto;
        }
        button.close-btn:hover { background: var(--color-surface); }
        button.close-btn:focus-visible {
          outline: 2px solid var(--color-focus-ring);
          outline-offset: 2px;
        }

        .content { padding: var(--space-5); }
      </style>
      <div class="overlay" part="overlay">
        <div class="panel" role="dialog" aria-modal="true">
          <div class="header">
            <h2 class="title"></h2>
            <button type="button" class="close-btn" aria-label="إغلاق">
              <ds-icon name="close" size="18"></ds-icon>
            </button>
          </div>
          <div class="content"><slot></slot></div>
        </div>
      </div>
    `;
    this.shadowRoot.querySelector(".close-btn").addEventListener("click", () => this._requestClose());
    this.shadowRoot.querySelector(".overlay").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) this._requestClose();
    });
    this.sync();
  }
}

customElements.define("ds-dialog", DsDialog);
