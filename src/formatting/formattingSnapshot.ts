/**
 * Formatting snapshot DTO — plain object model consumed by the pure
 * formatting engine. No Office.js types leak out of `src/word/`.
 *
 * Boundary rule: this file lives in `src/formatting/` and may only import
 * from `core/domain` and `shared/utils` (see docs/architecture.md).
 */

import { z } from "zod";

export const ParagraphAlignmentSchema = z
  .enum(["left", "center", "right", "justified"])
  .nullable()
  .default(null);

export type ParagraphAlignment = z.infer<typeof ParagraphAlignmentSchema>;

export const FormattingParagraphSchema = z.object({
  index: z.number().int().nonnegative(),
  text: z.string(),
  styleName: z.string().trim().default("Normal"),
  alignment: ParagraphAlignmentSchema,
  lineSpacing: z.number().min(1).max(3).nullable().default(null),
  spaceAfter: z.number().min(0).max(100).nullable().default(null),
  spaceBefore: z.number().min(0).max(100).nullable().default(null),
  listLevel: z.number().int().min(0).max(8).nullable().default(null),
  fontName: z.string().trim().nullable().default(null),
  fontSize: z.number().nullable().default(null),
  fontColor: z.string().trim().nullable().default(null),
  bold: z.boolean().nullable().default(null),
  italic: z.boolean().nullable().default(null),
  underline: z.boolean().nullable().default(null),
});

export type FormattingParagraph = z.infer<typeof FormattingParagraphSchema>;

export const FormattingSnapshotSchema = z.object({
  id: z.string().trim().min(1),
  text: z.string(),
  paragraphs: z.array(FormattingParagraphSchema),
  capturedAt: z.string().datetime(),
  hash: z.string().trim().optional(),
});

export type FormattingSnapshot = z.infer<typeof FormattingSnapshotSchema>;
