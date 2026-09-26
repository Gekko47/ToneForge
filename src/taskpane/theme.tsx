import React, { createContext, useContext } from "react";
import { ThemeProvider as FluentThemeProvider } from "@fluentui/react";
import { createDefaultTheme } from "./fluentTheme";

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

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactNode {
  const [reducedMotion, setReducedMotion] = React.useState(false);
  const [themePreference, setThemePreferenceState] =
    React.useState<ThemePreference>(readThemePreference);
  const [systemDark, setSystemDark] = React.useState(false);

  function setThemePreference(preference: ThemePreference): void {
    setThemePreferenceState(preference);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // A session-only preference is safe when storage is unavailable.
    }
  }

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

  // The theme class is applied to the document element, not to an inner
  // wrapper, because the CSS custom properties are consumed by `html` and
  // `body`. A wrapper cannot supply variables to its own ancestors: the page
  // canvas would fall through to the user-agent default of white and the
  // content card would appear to float inside a white frame.
  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("tf-theme-dark", isDark);
    root.classList.toggle("tf-theme-light", !isDark);
  }, [isDark]);

  return (
    <ThemeContext.Provider value={{ reducedMotion, themePreference, setThemePreference }}>
      <FluentThemeProvider theme={createDefaultTheme(isDark)}>
        <div className={isDark ? "tf-theme-dark" : "tf-theme-light"}>{children}</div>
      </FluentThemeProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
