import React, { createContext, useContext } from "react";
import {
  FluentProvider,
  makeStyles,
  PositioningConfigurationProvider,
} from "@fluentui/react-components";
import { toneForgeDarkTheme, toneForgeLightTheme } from "./toneForgeTheme";
import { toneForgeTokens } from "./tokens";

export type ThemePreference = "system" | "light" | "dark";

interface ThemeContextValue {
  reducedMotion: boolean;
  themePreference: ThemePreference;
  setThemePreference: (preference: ThemePreference) => void;
}

const THEME_STORAGE_KEY = "ToneForge.ThemePreference";
const ThemeContext = createContext<ThemeContextValue>({
  reducedMotion: false,
  themePreference: "system",
  setThemePreference: () => undefined,
});

function readThemePreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" || value === "system" ? value : "system";
  } catch {
    return "system";
  }
}

const useStyles = makeStyles({
  root: {
    height: "100%",
    backgroundColor: toneForgeTokens.canvas,
    color: toneForgeTokens.text,
  },
});

/**
 * Disable resize-driven repositioning for every Fluent popup in the pane.
 *
 * Fluent positions a Dropdown/Combobox listbox with a `ResizeObserver` on the
 * popup container. When the popup's own content changes size — a listbox
 * growing to fit, options being filtered — the observer fires, the reposition
 * triggers another layout pass, and the browser reports
 * `ResizeObserver loop completed with undelivered notifications`. Setting this
 * once here covers every positioned component in the pane (the six Dropdowns
 * and the ModelPicker Combobox) instead of repeating the prop at each call
 * site. The popup still positions correctly on open; it simply does not
 * reposition while its content resizes.
 *
 * The type is derived from the re-exported provider rather than imported from
 * `@fluentui/react-positioning`, which is a transitive dependency and not ours
 * to import directly.
 */
const disableResizeRepositioning: React.ComponentProps<
  typeof PositioningConfigurationProvider
>["value"] = ({ options }) => ({ ...options });

export interface FluentV9ProviderProps {
  children: React.ReactNode;
}

/**
 * The Fluent v9 theme provider — the single root of the pane's theme.
 *
 * It owns the design tokens: `FluentProvider` writes them as CSS variables at
 * this element, and every v9 component below reads them. The theme objects are
 * module-level constants, so they are the same reference on every render —
 * passing a new theme identity to `FluentProvider` would invalidate the theme
 * for every Fluent consumer in the pane, and a failing document scan emits a
 * new status on every attempt, so each of those emissions would restyle the
 * whole pane if the theme identity churned.
 *
 * It also owns the theme *preference* (light/dark/system) and the reduced-motion
 * preference. The `tf-theme-dark`/`tf-theme-light` classes are applied to
 * `documentElement` so the stylesheet's `--tf-*` tokens — still used by
 * not-yet-migrated components — flip with the theme.
 *
 * `applyStylesToPortals={false}` is load-bearing. A v9 `Dropdown`/`Combobox`
 * renders its listbox through a `Portal` whose mount node is created in
 * `document.body`; `FluentProvider` copies its root class list onto that node
 * by default, which would drag this provider's `height: 100%` and canvas
 * background into a full-pane grey slab at `z-index: 1000000` covering the
 * task pane every time a dropdown opened. With it off, portals keep only the
 * theme-variable class, and the canvas background and height live on the plain
 * wrapper below instead.
 *
 * Note: the `ResizeObserver loop completed with undelivered notifications`
 * warning that used to appear when opening a dropdown or combobox was not
 * caused by this provider or by the portal mechanism. It came from Fluent's
 * popup positioning (a `ResizeObserver` on the popup container that repositions
 * on every resize, creating a feedback loop when the popup's content changes
 * size). It is fixed at the source by the `PositioningConfigurationProvider`
 * below, which disables resize-driven repositioning for every positioned
 * component in the pane. The filter in `bootstrap.tsx` remains as a safety net
 * for other Fluent components that observe their own reflow.
 */
export function FluentV9Provider({ children }: FluentV9ProviderProps): React.ReactNode {
  const [reducedMotion, setReducedMotion] = React.useState(false);
  const [themePreference, setThemePreferenceState] =
    React.useState<ThemePreference>(readThemePreference);
  const [systemDark, setSystemDark] = React.useState(false);
  const styles = useStyles();

  const setThemePreference = React.useCallback((preference: ThemePreference): void => {
    setThemePreferenceState(preference);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // A session-only preference is safe when storage is unavailable.
    }
  }, []);

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const handler = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const isDark = themePreference === "dark" || (themePreference === "system" && systemDark);

  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("tf-theme-dark", isDark);
    root.classList.toggle("tf-theme-light", !isDark);
  }, [isDark]);

  const contextValue = React.useMemo(
    () => ({ reducedMotion, themePreference, setThemePreference }),
    [reducedMotion, themePreference, setThemePreference],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {/* Height and canvas on a plain wrapper, not on the provider: the
          provider's root class list is copied onto portal mount nodes in
          document.body, and a `height: 100%` there would paint a full-pane grey
          slab over the task pane whenever a dropdown opened. */}
      <div className={styles.root}>
        <FluentProvider
          theme={isDark ? toneForgeDarkTheme : toneForgeLightTheme}
          applyStylesToPortals={false}
        >
          <PositioningConfigurationProvider value={disableResizeRepositioning}>
            {children}
          </PositioningConfigurationProvider>
        </FluentProvider>
      </div>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
