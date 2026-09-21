export {
  FormattingSnapshotSchema,
  FormattingParagraphSchema,
  ParagraphAlignmentSchema,
  type FormattingSnapshot,
  type FormattingParagraph,
  type ParagraphAlignment,
} from "./formattingSnapshot";
export { findFormattingIssues, type FormattingCheckOptions } from "./analyzer";
export { normalizeFormatting, type NormalizeOptions } from "./normalizer";
export { lookupWordStyle, WORD_STYLE_MAPPING, HEADING_STYLE_NAMES } from "./wordStyles";
