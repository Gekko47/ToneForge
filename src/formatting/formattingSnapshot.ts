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

export const FormattingSnapshotSchema = z.object({
  id: z.string().trim().min(1),
  text: z.string(),
  fullText: z.string().default(""),
  paragraphs: z.array(FormattingParagraphSchema),
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
