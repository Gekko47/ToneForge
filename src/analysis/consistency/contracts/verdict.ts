import { z } from "zod";

/**
 * The three verdicts an adjudicator can return.
 *
 * `contradiction` and `notAConflict` are the two that can become findings. A
 * malformed response, a refusal, or any output that does not fit is `unclear`,
 * and `unclear` never becomes a finding — it is counted in coverage as an
 * adjudication that did not resolve, so the report can say so rather than
 * quietly dropping it.
 */
export const ConsistencyVerdictSchema = z.enum(["contradiction", "notAConflict", "unclear"]);

export type ConsistencyVerdict = z.infer<typeof ConsistencyVerdictSchema>;
