import { createTheme } from "@fluentui/react";

/**
 * Fluent theme construction.
 *
 * `isInverted` is the load-bearing field, not the palette. Fluent v8 decides
 * whether a component paints itself against light or dark neutrals from
 * `theme.isInverted`; the palette only supplies the values it paints *with*.
 * A dark palette on a non-inverted theme therefore produces light-bodied
 * `Dropdown`, `TextField`, `Toggle`, and `MessageBar` controls sitting on a dark
 * page — which is exactly the mismatch this theme exists to prevent.
 *
 * A dark palette is also written the way Fluent expects an inverted theme to be
 * written: `neutralPrimary` is the light foreground, and the surface ramp runs
 * dark-to-light through `neutralLighterAlt` / `neutralLighter` / `neutralLight`.
 *
 * The page canvas is owned by `taskpane.css`, not by this palette: `IPalette`
 * has no `backgroundColor`, and a shell that paints its own background is the
 * only way the area around the content card stops falling back to UA white.
 */
export function createDefaultTheme(dark = false) {
  return createTheme({
    isInverted: dark,
    palette: dark
      ? {
          themePrimary: "#4aaaf0",
          themeLighter: "#12344f",
          themeLight: "#165d8f",
          themeDark: "#268bd2",
          themeDarker: "#4aaaf0",
          // Foregrounds on a dark surface.
          neutralPrimary: "#f3f2f1",
          neutralPrimaryAlt: "#ffffff",
          neutralSecondary: "#c8c6c4",
          neutralTertiary: "#a19f9d",
          // Surfaces, lightest to darkest.
          neutralLighterAlt: "#201f1e",
          neutralLighter: "#292827",
          neutralLight: "#323130",
          neutralQuaternary: "#484644",
          neutralQuaternaryAlt: "#605e5c",
          neutralDark: "#797775",
        }
      : {
          themePrimary: "#0078d4",
          themeLighter: "#cae5f7",
          themeLight: "#96c5e8",
          themeDark: "#106ebe",
          themeDarker: "#005a9e",
          neutralPrimary: "#1f1f1f",
          neutralPrimaryAlt: "#000000",
          neutralSecondary: "#605e5c",
          neutralTertiary: "#8a8886",
          neutralLighterAlt: "#fafafa",
          neutralLighter: "#f3f2f1",
          neutralLight: "#edebe9",
          neutralQuaternary: "#d2d0ce",
          neutralQuaternaryAlt: "#c8c6c4",
          neutralDark: "#797775",
        },
  });
}
