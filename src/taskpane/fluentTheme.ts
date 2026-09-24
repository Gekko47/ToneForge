import { createTheme } from "@fluentui/react";

export function createDefaultTheme(dark = false) {
  return createTheme({
    palette: dark
      ? {
          themePrimary: "#4aaaf0",
          themeLighter: "#12344f",
          themeLight: "#165d8f",
          themeDark: "#268bd2",
          themeDarker: "#4aaaf0",
          neutralPrimary: "#f3f2f1",
          neutralSecondary: "#c8c6c4",
          neutralTertiary: "#797775",
          neutralLighter: "#292827",
          neutralLight: "#323130",
          neutralQuaternary: "#484644",
        }
      : {
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
