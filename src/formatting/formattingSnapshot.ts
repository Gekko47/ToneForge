/**
 * Host-neutral formatting DTO. Effective values, style-derived values, and
 * direct-formatting provenance are separate so the analyzer never infers a
 * safe `Font.reset()` from appearance alone.
 */

import { z } from "zod";

export const ParagraphAlignmentSchema = z
  .enum(["left", "center", "right", "justified"])
  .nullable()
  .default(null);

export type ParagraphAlignment = z.infer<typeof ParagraphAlignmentSchema>;

export const FormattingProvenanceSchema = z.enum(["direct", "style", "unknown", "unsupported"]);
export type FormattingProvenance = z.infer<typeof FormattingProvenanceSchema>;

export const FormattingPropertyProvenanceSchema = z.object({
  alignment: FormattingProvenanceSchema.default("unknown"),
  lineSpacing: FormattingProvenanceSchema.default("unknown"),
  spaceAfter: FormattingProvenanceSchema.default("unknown"),
  spaceBefore: FormattingProvenanceSchema.default("unknown"),
  listLevel: FormattingProvenanceSchema.default("unknown"),
  fontName: FormattingProvenanceSchema.default("unknown"),
  fontSize: FormattingProvenanceSchema.default("unknown"),
  fontColor: FormattingProvenanceSchema.default("unknown"),
  bold: FormattingProvenanceSchema.default("unknown"),
  italic: FormattingProvenanceSchema.default("unknown"),
  underline: FormattingProvenanceSchema.default("unknown"),
});

export type FormattingPropertyProvenance = z.infer<typeof FormattingPropertyProvenanceSchema>;

export const FormattingParagraphSchema = z.object({
  index: z.number().int().nonnegative(),
  nodeId: z.string().trim().min(1).optional(),
  sourcePath: z.string().trim().min(1).optional(),
  text: z.string(),
  styleName: z.string().trim().default("Normal"),
  alignment: ParagraphAlignmentSchema.default(null),
  lineSpacing: z.number().positive().nullable().default(null),
  spaceAfter: z.number().min(0).max(100).nullable().default(null),
  spaceBefore: z.number().min(0).max(100).nullable().default(null),
  listLevel: z.number().int().min(0).max(8).nullable().default(null),
  /**
   * Indentation in points. `null` means "not read", never "zero": a host
   * without `supportsParagraphFormat` is a different claim from a paragraph
   * that genuinely has no indent, and conflating them lets a degraded scan
   * report a clean document.
   */
  leftIndent: z.number().nullable().default(null),
  rightIndent: z.number().nullable().default(null),
  firstLineIndent: z.number().nullable().default(null),
  /** Word paragraph flow controls: keep with next, keep lines together, page break before. */
  keepNext: z.boolean().nullable().default(null),
  keepLines: z.boolean().nullable().default(null),
  pageBreakBefore: z.boolean().nullable().default(null),
  fontName: z.string().trim().nullable().default(null),
  fontSize: z.number().nullable().default(null),
  fontColor: z.string().trim().nullable().default(null),
  bold: z.boolean().nullable().default(null),
  italic: z.boolean().nullable().default(null),
  underline: z.boolean().nullable().default(null),
  provenance: FormattingPropertyProvenanceSchema.optional(),
  styleFormatting: z
    .object({
      fontName: z.string().trim().nullable().default(null),
      fontSize: z.number().nullable().default(null),
      fontColor: z.string().trim().nullable().default(null),
      bold: z.boolean().nullable().default(null),
      italic: z.boolean().nullable().default(null),
      underline: z.boolean().nullable().default(null),
    })
    .optional(),
  unsupportedProperties: z.array(z.string().trim().min(1)).optional(),
});

export type FormattingParagraph = z.input<typeof FormattingParagraphSchema>;

export const TableSnapshotSchema = z.object({
  index: z.number().int().nonnegative(),
  nodeId: z.string().trim().min(1).optional(),
  sourcePath: z.string().trim().min(1).optional(),
  text: z.string().default(""),
  styleName: z.string().trim().nullable().default(null),
  headerRow: z.boolean().nullable().default(null),
  headerRowCount: z.number().int().min(0).max(10).nullable().default(null),
  cellStyleName: z.string().trim().nullable().default(null),
  rowCount: z.number().int().min(0).max(1000).nullable().default(null),
  columnCount: z.number().int().min(0).max(100).nullable().default(null),
});
export type TableSnapshot = z.input<typeof TableSnapshotSchema>;

export const SectionSnapshotSchema = z.object({
  index: z.number().int().nonnegative(),
  nodeId: z.string().trim().min(1).optional(),
  sourcePath: z.string().trim().min(1).optional(),
  text: z.string().default(""),
  orientation: z.enum(["portrait", "landscape"]).nullable().default(null),
  margins: z
    .object({
      top: z.number().nullable().default(null),
      bottom: z.number().nullable().default(null),
      left: z.number().nullable().default(null),
      right: z.number().nullable().default(null),
    })
    .optional(),
  width: z.number().int().positive().nullable().default(null),
  height: z.number().int().positive().nullable().default(null),
});
export type SectionSnapshot = z.input<typeof SectionSnapshotSchema>;

export const HeaderFooterSnapshotSchema = z.object({
  index: z.number().int().nonnegative(),
  nodeId: z.string().trim().min(1).optional(),
  sourcePath: z.string().trim().min(1).optional(),
  kind: z.enum(["header", "footer"]).default("header"),
  text: z.string().default(""),
  styleName: z.string().trim().nullable().default(null),
  required: z.boolean().default(false),
  font: z
    .object({
      name: z.string().trim().nullable().default(null),
      size: z.number().nullable().default(null),
      color: z.string().trim().nullable().default(null),
      bold: z.boolean().nullable().default(null),
      italic: z.boolean().nullable().default(null),
      underline: z.boolean().nullable().default(null),
    })
    .optional(),
});
export type HeaderFooterSnapshot = z.input<typeof HeaderFooterSnapshotSchema>;

export const FormattingSnapshotSchema = z.object({
  id: z.string().trim().min(1),
  text: z.string(),
  fullText: z.string().default(""),
  paragraphs: z.array(FormattingParagraphSchema).default([]),
  tables: z.array(TableSnapshotSchema).default([]),
  sections: z.array(SectionSnapshotSchema).default([]),
  headersFooters: z.array(HeaderFooterSnapshotSchema).default([]),
  capturedAt: z.string().datetime(),
  fullDocumentHash: z.string().trim().optional(),
  hash: z.string().trim().optional(),
  analysisStart: z.number().int().nonnegative().default(0),
  analysisEnd: z.number().int().nonnegative().optional(),
  analysisTruncated: z.boolean().default(false),
  coverage: z
    .object({
      paragraphCollection: z.enum(["complete", "partial", "unsupported"]),
      directFormattingProvenance: z.enum(["complete", "partial", "unsupported"]),
      unsupported: z.array(z.string().trim().min(1)).default([]),
    })
    .optional(),
});

export type FormattingSnapshot = z.input<typeof FormattingSnapshotSchema>;
