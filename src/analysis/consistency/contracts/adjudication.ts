import { z } from "zod";
import { ConsistencyVerdictSchema } from "./verdict";

/**
 * One adjudicator answer, parsed from the model's response.
 *
 * The model is asked for a verdict and a reason. The reason is free text and is
 * never trusted as a fact — it is shown to the user as the model's own words.
 * The verdict is the only field that can promote a candidate into a finding.
 */
export const ConsistencyAdjudicationSchema = z.object({
  verdict: ConsistencyVerdictSchema,
  reason: z.string().trim().min(1).max(2000),
  /** The id of the statement the adjudicator names as wrong, if it named one. */
  wrongSide: z.union([z.literal("left"), z.literal("right")]).optional(),
});

export type ConsistencyAdjudication = z.infer<typeof ConsistencyAdjudicationSchema>;
