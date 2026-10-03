/**
 * The marker class that identifies a control *we* render.
 *
 * **Why this exists, and what it replaces.** The stylesheet used to scope its
 * native-control rules with `:not([class*="ms-"])` — excluding anything whose
 * class contains Fluent's internal prefix. That is a deny-list keyed on another
 * library's private naming, and it fails twice over:
 *
 * 1. The `ms-` prefix is not a public contract. It changes between Fluent
 *    versions, and a rename silently widens these rules onto every Fluent field
 *    in the add-in — which is the reported symptom: profile fields rendering
 *    light-on-dark while the surrounding surface follows the theme.
 * 2. It cannot cover Fluent components whose root is not an `<input>`. A
 *    Dropdown's button, a Switch's internals and a SpinButton's buttons are not
 *    excluded by it, because it only ever asks about three element names.
 *
 * **A deny-list is the wrong shape here.** The question is not "is this one of
 * ours?" but "is this ours?", and only the author of a control can answer that.
 * So our own controls carry a class we own, and the rules are scoped to it. A
 * Fluent component is then excluded by construction — whatever it renders, and
 * whatever it names its classes — rather than by coincidence.
 *
 * This is also what makes the eventual Fluent migration (UX-4) safe: the
 * migration removes controls from this set, and any control it forgets to migrate
 * simply stops being styled rather than starting to fight the theme.
 *
 * A module rather than a literal at 32 call sites, because a literal is 32
 * chances to spell it differently. `nativeFieldMarkers.test.tsx` asserts that
 * every native control in the task pane carries it.
 */

/**
 * The class a ToneForge-rendered native *field* carries.
 *
 * Named `tf-native` rather than `tf-field` because `tf-field` is already on the
 * `<label>` wrappers, and reusing it would put a styling class on two different
 * elements for two different reasons.
 */
export const NATIVE_FIELD_CLASS = "tf-native";

/**
 * The class a ToneForge-rendered `<button>` carries.
 *
 * Separate from `NATIVE_FIELD_CLASS` because the two sets want different
 * defaults: a field is a surface with text on it, a button is a control with a
 * border and a hover state. One class for both would force one of them to be
 * styled as the other.
 */
export const NATIVE_BUTTON_CLASS = "tf-native-button";

/**
 * The props that mark a control as ours.
 *
 * Spread onto the element rather than the class written out, so a control cannot
 * carry the marker in one place and a different spelling in another. An element
 * that already has a `className` merges both.
 */
export function nativeFieldProps(className?: string): { className: string } {
  return { className: withMarker(NATIVE_FIELD_CLASS, className) };
}

/** The same, for a `<button>`. */
export function nativeButtonProps(className?: string): { className: string } {
  return { className: withMarker(NATIVE_BUTTON_CLASS, className) };
}

/**
 * Merges the marker with whatever class the element already declares.
 *
 * A marker goes *first*, so a control's own styling class keeps the later, equal-
 * specificity position in the cascade and can still override the shared defaults.
 */
function withMarker(marker: string, className: string | undefined): string {
  return className === undefined || className === "" ? marker : `${marker} ${className}`;
}
