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

export const ChangeSchema = z.object({
  id: z.string().uuid(),
  type: ChangeTypeSchema,
  range: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }),
  payload: z.record(z.string(), z.unknown()),
  rationale: z.string().trim().default(""),
  reversible: z.boolean().default(true),
});

export type Change = z.infer<typeof ChangeSchema>;
