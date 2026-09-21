import React from "react";
import { ThemeProvider } from "@fluentui/react";
import { ThemeProvider as LocalThemeProvider } from "../theme";
import { createDefaultTheme } from "../fluentTheme";
import ProfileEditor from "../components/ProfileEditor";

export default function Profile(): React.ReactNode {
  return (
    <LocalThemeProvider>
      <ThemeProvider theme={createDefaultTheme()}>
        <ProfileEditor />
      </ThemeProvider>
    </LocalThemeProvider>
  );
}
