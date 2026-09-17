import { getIconMarkup } from "./icon-registry.js";

/**
 * <ds-icon name="mail" size="20"></ds-icon>
 *
 * Attributes:
 *   name  (required) — must exist in icon-registry.js
 *   size  (optional) — px, defaults to 20
 *
 * Color always comes from the surrounding text color (currentColor) —
 * set `color` on the parent or on ds-icon itself to recolor.
 */
class DsIcon extends HTMLElement {
  static get observedAttributes() {
    return ["name", "size"];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const name = this.getAttribute("name");
    const size = this.getAttribute("size") || "20";
    this.style.display = "inline-flex";
    this.style.width = `${size}px`;
    this.style.height = `${size}px`;
    this.style.flex = "0 0 auto";
    this.innerHTML = name ? getIconMarkup(name) : "";
  }
}

customElements.define("ds-icon", DsIcon);
