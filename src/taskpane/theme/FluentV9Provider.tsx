import React, { createContext, useContext } from "react";
import { FluentProvider, makeStyles } from "@fluentui/react-components";
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
 * It also owns the theme *preference* (light/dark/system), the reduced-motion
 * preference, and the canvas background. The `tf-theme-dark`/`tf-theme-light`
 * classes are applied to `documentElement` so the stylesheet's `--tf-*` tokens
 * — still used by not-yet-migrated components — flip with the theme.
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
      <FluentProvider
        theme={isDark ? toneForgeDarkTheme : toneForgeLightTheme}
        className={styles.root}
      >
        {children}
      </FluentProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
