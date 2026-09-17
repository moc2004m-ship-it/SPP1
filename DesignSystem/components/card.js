/**
 * <ds-card padding="md|sm|none" elevation="sm|md|lg|none">
 *   ...content (slot)...
 * </ds-card>
 *
 * A plain reusable surface container. No interactive states of its own —
 * interactivity belongs to whatever is slotted inside it.
 */
class DsCard extends HTMLElement {
  static get observedAttributes() {
    return ["padding", "elevation"];
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
    const padding = this.getAttribute("padding") || "md";
    const elevation = this.getAttribute("elevation") || "sm";
    const paddingVar = padding === "none" ? "0" : `var(--space-${padding === "sm" ? "4" : padding === "lg" ? "8" : "6"})`;
    const shadowVar = elevation === "none" ? "none" : `var(--shadow-${elevation})`;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          box-shadow: ${shadowVar};
          padding: ${paddingVar};
          font-family: var(--font-family-base);
          color: var(--color-text-primary);
        }
      </style>
      <slot></slot>
    `;
  }
}

customElements.define("ds-card", DsCard);
