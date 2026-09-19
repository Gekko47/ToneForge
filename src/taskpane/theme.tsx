import React, { createContext, useContext } from "react";

interface ThemeContextValue {
  reducedMotion: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({ reducedMotion: false });

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactNode {
  const [reducedMotion, setReducedMotion] = React.useState(false);

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return <ThemeContext.Provider value={{ reducedMotion }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
