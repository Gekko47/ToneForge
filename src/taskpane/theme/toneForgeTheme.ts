import { createDarkTheme, createLightTheme, type BrandVariants } from "@fluentui/react-components";

/**
 * ToneForge's Fluent v9 theme.
 *
 * Fluent v9 owns theming through `FluentProvider`, which writes the design-token
 * CSS variables at the provider root. There is no hand-authored global theme
 * file and no parallel `--tf-*` colour ramp after migration (ADR-0130): the
 * brand and the light/dark neutrals are produced here, once, and every component
 * reads them through `tokens.*`.
 *
 * The ramp is anchored on the accent the pane already used (`#0078d4`), so the
 * brand does not move when the theme mechanism changes. `createLightTheme` maps
 * `brand[80]` to `colorBrandBackground` and `createDarkTheme` maps `brand[70]`,
 * which is why the two themes read as the same brand at different lightness
 * rather than as two different colours.
 *
 * This file *is* the palette: a colour literal here is the definition, not a
 * bypass, which is why `eslint.config.mjs` exempts it alongside the retired
 * `fluentTheme.ts`.
 */
export const toneForgeBrandRamp: BrandVariants = {
  10: "#020305",
  20: "#111723",
  30: "#16263D",
  40: "#193253",
  50: "#1B3F6A",
  60: "#1B4C82",
  70: "#18599B",
  80: "#0078D4",
  90: "#106EBE",
  100: "#2B88D8",
  110: "#71AFE5",
  120: "#C7E0F4",
  130: "#DEECF9",
  140: "#EFF6FC",
  150: "#F5F9FD",
  160: "#FFFFFF",
};

export const toneForgeLightTheme = createLightTheme(toneForgeBrandRamp);
export const toneForgeDarkTheme = createDarkTheme(toneForgeBrandRamp);
