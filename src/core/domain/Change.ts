/**
 * A single atomic change request within a ChangePlan.
 */

import { z } from "zod";

export const ChangeTypeSchema = z.enum([
  "insertText",
  "replaceText",
  "deleteRange",
  "setParagraphFormat",
  "setCharacterFormat",
  "applyStyle",
  "insertBreak",
  "setListLevel",
]);

export type ChangeType = z.infer<typeof ChangeTypeSchema>;

export const ChangeSchema = z
  .object({
    id: z.string().uuid(),
    type: ChangeTypeSchema,
    range: z
      .object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
      })
      .refine((r) => r.start <= r.end, {
        message: "Change.range.start must be <= Change.range.end",
        path: ["start"],
      }),
    payload: z.record(z.string(), z.unknown()),
    rationale: z.string().trim().default(""),
    reversible: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    // Types that require text payload.
    const needsText = new Set(["insertText", "replaceText"]);
    if (needsText.has(data.type)) {
      const text = (data.payload as Record<string, unknown>).text;
      if (typeof text !== "string" || text.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Change type "${data.type}" requires a non-empty payload.text string`,
          path: ["payload", "text"],
        });
      }
    }
    // applyStyle requires styleName.
    if (data.type === "applyStyle") {
      const styleName = (data.payload as Record<string, unknown>).styleName;
      if (typeof styleName !== "string" || styleName.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Change type "applyStyle" requires a non-empty payload.styleName string',
          path: ["payload", "styleName"],
        });
      }
    }
    // setListLevel requires numeric level.
    if (data.type === "setListLevel") {
      const level = (data.payload as Record<string, unknown>).level;
      if (typeof level !== "number" || !Number.isInteger(level) || level < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Change type "setListLevel" requires a non-negative integer payload.level',
          path: ["payload", "level"],
        });
      }
    }
  });

export type Change = z.infer<typeof ChangeSchema>;
