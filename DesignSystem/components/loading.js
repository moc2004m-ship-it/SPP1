/**
 * <ds-spinner size="24"></ds-spinner>
 *   A small inline spinner for use anywhere (not just inside ds-button).
 *
 * <ds-loading-overlay label="جارٍ التحميل..."></ds-loading-overlay>
 *   A full-bleed loading state for whole-screen loading (e.g. Splash).
 *   Present/remove the element (or toggle its `hidden` attribute) to
 *   show/hide it — it has no internal open/closed state of its own.
 */
class DsSpinner extends HTMLElement {
  static get observedAttributes() {
    return ["size"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    if (this.shadowRoot.firstChild) this.render();
  }

  render() {
    const size = this.getAttribute("size") || "24";
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-flex;
          width: ${size}px;
          height: ${size}px;
        }
        .ring {
          width: 100%;
          height: 100%;
          border-radius: var(--radius-full);
          border: 2.5px solid var(--color-border);
          border-block-start-color: var(--color-primary);
          animation: ds-spin 700ms linear infinite;
        }
        @keyframes ds-spin { to { transform: rotate(360deg); } }
      </style>
      <span class="ring" role="status" aria-label="جارٍ التحميل"></span>
    `;
  }
}

class DsLoadingOverlay extends HTMLElement {
  static get observedAttributes() {
    return ["label"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    if (this.shadowRoot.firstChild) this.render();
  }

  render() {
    const label = this.getAttribute("label") || "";
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: var(--space-3);
          font-family: var(--font-family-base);
        }
        :host([hidden]) { display: none; }
        p {
          margin: 0;
          font-size: var(--font-size-sm);
          color: var(--color-text-secondary);
        }
      </style>
      <ds-spinner size="32"></ds-spinner>
      ${label ? `<p>${label}</p>` : ""}
    `;
  }
}

customElements.define("ds-spinner", DsSpinner);
customElements.define("ds-loading-overlay", DsLoadingOverlay);
