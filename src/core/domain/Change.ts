/**
 * A single atomic change request within a ChangePlan.
 *
 * Each `ChangeType` has a strictly typed `payload`. Payloads are modelled as
 * a discriminated union keyed on `type` so that consumers can exhaustively
 * handle each variant without runtime surprises. The discriminated union is
 * enforced through `z.discriminatedUnion` plus a `superRefine` fallback that
 * rejects unknown or malformed payloads.
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

/**
 * Range for a change. `start` and `end` are character offsets into the
 * document body. `start` must be less than or equal to `end`.
 */
export const ChangeRangeSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  })
  .refine((r) => r.start <= r.end, {
    message: "Change.range.start must be <= Change.range.end",
    path: ["start"],
  });

export type ChangeRange = z.infer<typeof ChangeRangeSchema>;

const InsertTextPayloadSchema = z.object({
  text: z.string().min(1, "insertText requires a non-empty text payload"),
});

const ReplaceTextPayloadSchema = z.object({
  text: z.string().min(1, "replaceText requires a non-empty text payload"),
});

const DeleteRangePayloadSchema = z.object({}).partial();

const SetParagraphFormatPayloadSchema = z
  .object({
    alignment: z.enum(["left", "center", "right", "justified"]).optional(),
    lineSpacing: z.number().min(1).max(3).optional(),
    spaceAfter: z.number().min(0).max(100).optional(),
    spaceBefore: z.number().min(0).max(100).optional(),
    listLevel: z.number().int().min(0).max(8).optional(),
  })
  .partial();

const SetCharacterFormatPayloadSchema = z
  .object({
    // Font properties that map directly to Word.Range.font.
    // `name` is the font name, `size` is the font size in points, and
    // `color` is the font color as a hex string. These align with the
    // revisionAdapter's setCharacterFormat handler.
    name: z.string().optional(),
    size: z.number().optional(),
    color: z.string().optional(),
    // Boolean formatting flags are also accepted for completeness; the
    // adapter applies them when present.
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
  })
  .partial();

const ApplyStylePayloadSchema = z.object({
  styleName: z.string().trim().min(1, "applyStyle requires a non-empty styleName"),
});

const InsertBreakPayloadSchema = z.object({
  breakType: z.enum(["line", "page", "nextParagraph"]).optional(),
});

const SetListLevelPayloadSchema = z.object({
  level: z.number().int().nonnegative("setListLevel requires a non-negative integer level"),
});

/**
 * Discriminated union of change payloads keyed on `type`. Using a
 * discriminated union instead of `z.record(z.string(), z.unknown())` means
 * the schema validates the exact shape expected for each change type and
 * gives precise error paths.
 */
export const ChangePayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("insertText"), payload: InsertTextPayloadSchema }),
  z.object({ type: z.literal("replaceText"), payload: ReplaceTextPayloadSchema }),
  z.object({ type: z.literal("deleteRange"), payload: DeleteRangePayloadSchema }),
  z.object({ type: z.literal("setParagraphFormat"), payload: SetParagraphFormatPayloadSchema }),
  z.object({ type: z.literal("setCharacterFormat"), payload: SetCharacterFormatPayloadSchema }),
  z.object({ type: z.literal("applyStyle"), payload: ApplyStylePayloadSchema }),
  z.object({ type: z.literal("insertBreak"), payload: InsertBreakPayloadSchema }),
  z.object({ type: z.literal("setListLevel"), payload: SetListLevelPayloadSchema }),
]);

export type ChangePayload = z.infer<typeof ChangePayloadSchema>;

export const ChangeSchema = z
  .object({
    id: z.string().uuid(),
    type: ChangeTypeSchema,
    range: ChangeRangeSchema,
    payload: z.record(z.string(), z.unknown()),
    rationale: z.string().trim().default(""),
    reversible: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    // Validate the payload against the discriminated union for the chosen
    // type. This keeps the public `payload` shape as a plain record while
    // still enforcing strict per-type contracts.
    const result = ChangePayloadSchema.safeParse({
      type: data.type,
      payload: data.payload,
    });
    if (!result.success) {
      for (const issue of result.error.issues) {
        const path = issue.path.length > 0 ? ["payload", ...issue.path] : ["payload"];
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: issue.message,
          path,
        });
      }
    }
  });

export type Change = z.infer<typeof ChangeSchema>;
