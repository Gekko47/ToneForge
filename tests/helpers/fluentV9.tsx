import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { FluentV9Provider } from "../../src/taskpane/theme";

/**
 * Render a component inside the Fluent v9 provider.
 *
 * A v9 component reads its design tokens from the nearest `FluentProvider`, so
 * rendering one bare in jsdom leaves every `tokens.*` reference unresolved. This
 * wrapper supplies the provider the pane supplies in production, so a test
 * exercises the same token context the add-in does.
 *
 * The theme preference is set in localStorage before rendering, which is how
 * the provider reads it on mount. `dark` defaults to light; pass `dark: true`
 * to render the dark theme.
 *
 * `window.matchMedia` is provided globally by `tests/setup.ts`, so the provider
 * can read `prefers-color-scheme` and `prefers-reduced-motion` on mount.
 */
export function renderWithFluent(
  ui: ReactElement,
  options: RenderOptions & { dark?: boolean } = {},
): RenderResult {
  const { dark = false, ...rest } = options;
  window.localStorage.setItem("ToneForge.ThemePreference", dark ? "dark" : "light");
  const Wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <FluentV9Provider>{children}</FluentV9Provider>
  );
  return render(ui, { wrapper: Wrapper, ...rest });
}

/**
 * Remove the Griffel style elements a render left in the document head.
 *
 * Griffel emits each rule into the document exactly once and caches it, so a
 * style tag written by one test is otherwise visible to the next. jsdom does not
 * compute styles, so this changes no assertion — it keeps the head from growing
 * without bound across a file. The attribute is Griffel's own
 * (`DATA_BUCKET_ATTR` in `@griffel/core`).
 */
export function resetGriffelStyles(): void {
  if (typeof document === "undefined") return;
  document.head.querySelectorAll("style[data-make-styles-bucket]").forEach((el) => el.remove());
}
