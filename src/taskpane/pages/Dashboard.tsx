import React from "react";
import { ThemeProvider } from "@fluentui/react";
import { ThemeProvider as LocalThemeProvider } from "../theme";
import { createDefaultTheme } from "../fluentTheme";

export default function Dashboard(): React.ReactNode {
  return (
    <LocalThemeProvider>
      <ThemeProvider theme={createDefaultTheme()}>
        <main className="tf-card" tabIndex={0}>
          <h1 className="tf-title">ToneForge</h1>
          <p>Style consistency checks are coming in the next stage.</p>
        </main>
      </ThemeProvider>
    </LocalThemeProvider>
  );
}
