import { z } from "zod";

/**
 * The DecisionPlan: what the decision model is asked, and nothing else.
 *
 * The plan compiler projects each unresolved pair down to the facets the
 * deterministic resolver could not settle, so the model sees only the
 * questions it is needed for and only the state relevant to them. A
 * general-model fallback never consumes a DecisionPlan (D4): the plan is
 * typed for the decision role, and feeding it to a general model would be a
 * different review wearing this one's provenance.
 */

/** One typed question: binary, choice, or score. */
export const DecisionQuestionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("binary"),
    id: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    subjectId: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal("choice"),
    id: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    subjectId: z.string().trim().min(1),
    options: z.array(z.string().trim().min(1)).min(2),
  }),
  z.object({
    kind: z.literal("score"),
    id: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    subjectId: z.string().trim().min(1),
    min: z.number(),
    max: z.number(),
  }),
]);

export type DecisionQuestion = z.infer<typeof DecisionQuestionSchema>;

/** The compiled plan for one run. */
export const DecisionPlanSchema = z.object({
  revision: z.string().trim().min(1),
  questions: z.array(DecisionQuestionSchema),
  /** Budgets the run must not exceed. */
  budget: z.object({
    maxQuestions: z.number().int().min(1),
    maxExpansions: z.number().int().min(0),
  }),
  /** Whether exact statement text may be sent (D13 opt-out, per-run). */
  allowUnredacted: z.boolean().default(false),
});

export type DecisionPlan = z.infer<typeof DecisionPlanSchema>;
