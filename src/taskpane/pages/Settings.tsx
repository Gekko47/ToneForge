import React from "react";
import { ThemeProvider } from "@fluentui/react";
import { ThemeProvider as LocalThemeProvider } from "../theme";
import { createDefaultTheme } from "../fluentTheme";
import SettingsForm from "../components/SettingsForm";

export default function Settings(): React.ReactNode {
  return (
    <LocalThemeProvider>
      <ThemeProvider theme={createDefaultTheme()}>
        <SettingsForm />
      </ThemeProvider>
    </LocalThemeProvider>
  );
}
