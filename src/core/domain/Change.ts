/**
 * Atomic change contract. The payload is validated against a runtime
 * discriminated union; the public shape remains compatible with legacy plans
 * while new plans carry typed range units, targets, preconditions, and
 * approval/provenance metadata.
 */

import { z } from "zod";

export const ChangeTypeSchema = z.enum([
  "insertText",
  "replaceText",
  "deleteRange",
  "setParagraphFormat",
  "setCharacterFormat",
  "resetCharacterFormatting",
  "applyStyle",
  "insertBreak",
  "setListLevel",
]);
export type ChangeType = z.infer<typeof ChangeTypeSchema>;

export const ChangeRangeUnitSchema = z.enum(["character", "paragraph", "section"]);
export type ChangeRangeUnit = z.infer<typeof ChangeRangeUnitSchema>;

export const ChangeTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("document") }),
  z.object({
    kind: z.literal("paragraph"),
    index: z.number().int().nonnegative(),
    nodeId: z.string().trim().min(1).optional(),
    structuralPath: z.string().trim().min(1).optional(),
  }),
  z.object({ kind: z.literal("section"), index: z.number().int().nonnegative() }),
]);
export type ChangeTarget = z.infer<typeof ChangeTargetSchema>;

export const ChangeRangeSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    unit: ChangeRangeUnitSchema.optional(),
    target: ChangeTargetSchema.optional(),
  })
  .refine((range) => range.start <= range.end, {
    message: "Change.range.start must be <= Change.range.end",
    path: ["start"],
  });
export type ChangeRange = z.infer<typeof ChangeRangeSchema>;

export const TextPreconditionSchema = z.object({
  kind: z.literal("text"),
  expectedText: z.string(),
});
export const FormattingStateSchema = z.object({
  styleName: z.string().trim().optional(),
  alignment: z.enum(["left", "center", "right", "justified"]).nullable().optional(),
  lineSpacing: z.number().nullable().optional(),
  spaceAfter: z.number().nullable().optional(),
  spaceBefore: z.number().nullable().optional(),
  listLevel: z.number().int().min(0).max(8).nullable().optional(),
  fontName: z.string().nullable().optional(),
  fontSize: z.number().nullable().optional(),
  fontColor: z.string().nullable().optional(),
  bold: z.boolean().nullable().optional(),
  italic: z.boolean().nullable().optional(),
  underline: z.boolean().nullable().optional(),
});
export const FormattingPreconditionSchema = z.object({
  kind: z.literal("formatting"),
  expected: FormattingStateSchema,
});
export const NodePreconditionSchema = z.object({
  kind: z.literal("node"),
  nodeId: z.string().trim().min(1),
  expectedText: z.string().optional(),
  expectedStyleName: z.string().trim().optional(),
  expectedFormatting: FormattingStateSchema.optional(),
});
export const ChangePreconditionSchema = z.discriminatedUnion("kind", [
  TextPreconditionSchema,
  FormattingPreconditionSchema,
  NodePreconditionSchema,
]);
export type ChangePrecondition = z.infer<typeof ChangePreconditionSchema>;

const payloadFor = (type: ChangeType): z.ZodTypeAny => {
  switch (type) {
    case "insertText":
    case "replaceText":
      return z.object({ text: z.string().min(1) });
    case "setParagraphFormat":
      return z.object({
        alignment: z.enum(["left", "center", "right", "justified"]).optional(),
        lineSpacing: z.number().positive().optional(),
        spaceAfter: z.number().min(0).max(100).optional(),
        spaceBefore: z.number().min(0).max(100).optional(),
        listLevel: z.number().int().min(0).max(8).optional(),
      });
    case "setCharacterFormat":
      return z.object({
        name: z.string().optional(),
        size: z.number().optional(),
        color: z.string().optional(),
        bold: z.boolean().optional(),
        italic: z.boolean().optional(),
        underline: z.boolean().optional(),
      });
    case "resetCharacterFormatting":
    case "deleteRange":
      return z.object({}).partial();
    case "applyStyle":
      return z.object({ styleName: z.string().trim().min(1) });
    case "insertBreak":
      return z.object({ breakType: z.enum(["line", "page", "nextParagraph"]).optional() });
    case "setListLevel":
      return z.object({ level: z.number().int().nonnegative() });
  }
};

export const ChangePayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("insertText"), payload: payloadFor("insertText") }),
  z.object({ type: z.literal("replaceText"), payload: payloadFor("replaceText") }),
  z.object({ type: z.literal("deleteRange"), payload: payloadFor("deleteRange") }),
  z.object({ type: z.literal("setParagraphFormat"), payload: payloadFor("setParagraphFormat") }),
  z.object({ type: z.literal("setCharacterFormat"), payload: payloadFor("setCharacterFormat") }),
  z.object({
    type: z.literal("resetCharacterFormatting"),
    payload: payloadFor("resetCharacterFormatting"),
  }),
  z.object({ type: z.literal("applyStyle"), payload: payloadFor("applyStyle") }),
  z.object({ type: z.literal("insertBreak"), payload: payloadFor("insertBreak") }),
  z.object({ type: z.literal("setListLevel"), payload: payloadFor("setListLevel") }),
]);
export type ChangePayload = z.infer<typeof ChangePayloadSchema>;

export const ChangeSourceSchema = z.enum(["deterministic", "ai", "profile", "user"]);
export type ChangeSource = z.infer<typeof ChangeSourceSchema>;

export const ChangeSchema = z
  .object({
    id: z.string().uuid(),
    type: ChangeTypeSchema,
    range: ChangeRangeSchema,
    payload: z.record(z.string(), z.unknown()),
    rationale: z.string().trim().optional(),
    reversible: z.boolean().optional(),
    suggestedChangeId: z.string().optional(),
    findingId: z.string().uuid().optional(),
    ruleId: z.string().trim().min(1).optional(),
    source: ChangeSourceSchema.optional(),
    risk: z.enum(["none", "low", "medium", "high"]).optional(),
    approvalRequired: z.boolean().optional(),
    approvalState: z.enum(["notRequired", "pending", "approved", "rejected"]).optional(),
    dependsOn: z.array(z.string().uuid()).optional(),
    precondition: ChangePreconditionSchema.optional(),
  })
  .superRefine((change, ctx) => {
    const result = ChangePayloadSchema.safeParse({ type: change.type, payload: change.payload });
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: issue.message,
          path: ["payload", ...issue.path],
        });
      }
    }
  });
export type Change = z.infer<typeof ChangeSchema>;
export type ChangeInput = z.input<typeof ChangeSchema>;
