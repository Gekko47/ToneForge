import { tokens } from "@fluentui/react-components";

/**
 * The Fluent v9 design tokens ToneForge may use.
 *
 * Re-exported under semantic names rather than reached for as
 * `tokens.colorNeutralBackground1` at each call site, so the allowed set is one
 * list, reviewable in one place, and a component cannot quietly adopt a token
 * outside it. The set is the one the plan names (§3.3): neutrals, brand, the
 * three status families, and the focus stroke. Everything else a component
 * needs is a Fluent component's own styling.
 *
 * These are CSS-variable references, not resolved colours: they follow the
 * `FluentProvider` theme, so a component styled with them re-themes for free.
 */
export const toneForgeTokens = {
  canvas: tokens.colorNeutralBackground1,
  surface: tokens.colorNeutralBackground2,
  text: tokens.colorNeutralForeground1,
  textSecondary: tokens.colorNeutralForeground2,
  textTertiary: tokens.colorNeutralForeground3,
  textDisabled: tokens.colorNeutralForegroundDisabled,
  border: tokens.colorNeutralStroke1,
  borderSubtle: tokens.colorNeutralStroke2,
  brand: tokens.colorBrandBackground,
  brandForeground: tokens.colorBrandForeground1,
  success: tokens.colorStatusSuccessBackground3,
  warning: tokens.colorStatusWarningBackground1,
  danger: tokens.colorStatusDangerBackground1,
  focus: tokens.colorStrokeFocus2,
} as const;
