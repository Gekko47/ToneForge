import {
  Add24Regular,
  ArrowClockwise24Regular,
  ArrowLeft24Regular,
  ArrowRight24Regular,
  ArrowSync24Regular,
  CheckmarkCircle24Filled,
  CheckmarkCircle24Regular,
  ChevronDown24Regular,
  ChevronRight24Regular,
  DataUsage24Regular,
  Delete24Regular,
  Dismiss24Regular,
  DocumentBulletList24Regular,
  ErrorCircle24Filled,
  Home24Regular,
  Info24Regular,
  Navigation24Regular,
  PaintBrush24Regular,
  Settings24Regular,
  ShieldTask24Regular,
  TextGrammarWand24Regular,
  Warning24Filled,
  Wrench24Regular,
  type FluentIcon,
} from "@fluentui/react-icons";

/**
 * The one place a ToneForge icon is chosen.
 *
 * Fluent v9 icons are SVG components, not the font-icon `iconName` strings v8
 * used, so a stray glyph can no longer be typed as a string and rendered by
 * accident. Routing every icon through this map means the set is reviewable in
 * one place, a rename is a compile error rather than a blank square, and the
 * Unicode/emoji that accumulated under v8 (spec §17) has a single home to be
 * replaced from.
 *
 * The names are semantic — what the icon *means* in ToneForge — not the Fluent
 * glyph name, so the glyph can change without touching a call site.
 */
export const toneForgeIcons = {
  home: Home24Regular,
  deterministicReview: DocumentBulletList24Regular,
  semanticReview: TextGrammarWand24Regular,
  consistencyReview: CheckmarkCircle24Regular,
  styles: PaintBrush24Regular,
  governance: ShieldTask24Regular,
  settings: Settings24Regular,
  troubleshooting: Wrench24Regular,
  success: CheckmarkCircle24Filled,
  warning: Warning24Filled,
  error: ErrorCircle24Filled,
  stale: ArrowSync24Regular,
  coverage: DataUsage24Regular,
  goToText: ArrowRight24Regular,
  back: ArrowLeft24Regular,
  dismiss: Dismiss24Regular,
  expand: ChevronDown24Regular,
  collapse: ChevronRight24Regular,
  add: Add24Regular,
  remove: Delete24Regular,
  refresh: ArrowClockwise24Regular,
  info: Info24Regular,
  navigation: Navigation24Regular,
} satisfies Record<string, FluentIcon>;

export type ToneForgeIconName = keyof typeof toneForgeIcons;
