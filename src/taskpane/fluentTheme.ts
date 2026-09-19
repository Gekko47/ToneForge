import { createTheme } from "@fluentui/react";

export function createDefaultTheme() {
  return createTheme({
    palette: {
      themePrimary: "#0078d4",
      themeLighter: "#cae5f7",
      themeLight: "#96c5e8",
      themeDark: "#106ebe",
      themeDarker: "#005a9e",
      neutralPrimary: "#1f1f1f",
      neutralSecondary: "#605e5c",
      neutralTertiary: "#c8c6c4",
      neutralLighter: "#f9f9f9",
      neutralLight: "#f3f2f1",
      neutralQuaternary: "#e0e0e0",
    },
  });
}
