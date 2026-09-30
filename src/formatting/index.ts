export {
  FormattingSnapshotSchema,
  FormattingParagraphSchema,
  ParagraphAlignmentSchema,
  type FormattingSnapshot,
  type FormattingParagraph,
  type ParagraphAlignment,
} from "./formattingSnapshot";
export { findFormattingIssues, type FormattingCheckOptions } from "./analyzer";
export { lookupWordStyle, WORD_STYLE_MAPPING, HEADING_STYLE_NAMES } from "./wordStyles";
