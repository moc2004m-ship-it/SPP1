/**
 * index.js — barrel import. Screens can either:
 *   import "../../components/index.js";               (everything at once)
 * or import only what they need, e.g.:
 *   import "../../components/button.js";
 *
 * Both patterns are equally supported — this file exists purely for
 * convenience and defines no behavior of its own.
 */
import "../icons/ds-icon.js";
import "./button.js";
import "./text-field.js";
import "./checkbox.js";
import "./card.js";
import "./app-bar.js";
import "./dialog.js";
import "./loading.js";
