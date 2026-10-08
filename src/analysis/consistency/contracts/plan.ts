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

/** Projected state for one claim in a DecisionPlan. */
export const ProjectedClaimStateSchema = z.object({
  claimId: z.string().trim().min(1),
  predicate: z.string().trim().min(1),
  subjectIds: z.array(z.string()),
  eventIds: z.array(z.string()),
  programmeIds: z.array(z.string()),
  values: z.array(
    z.object({
      raw: z.string(),
      normalized: z.number().optional(),
      unit: z.string().optional(),
    }),
  ),
  dates: z.array(
    z.object({
      role: z.string(),
      date: z.object({ iso: z.string(), raw: z.string(), coarse: z.boolean() }),
    }),
  ),
  scope: z.object({ kind: z.string() }),
  scenario: z.object({ type: z.string() }).optional(),
  attribution: z.string().optional(),
  qualifiers: z.array(z.string()),
  evidence: z.object({ exactText: z.string(), paragraphId: z.string() }).optional(),
  evidenceBasis: z.array(z.object({ anchorId: z.string(), role: z.string() })),
});

export type ProjectedClaimState = z.infer<typeof ProjectedClaimStateSchema>;

/** Projected state for a candidate pair. */
export const ProjectedCandidateStateSchema = z.object({
  candidateId: z.string().trim().min(1),
  checkId: z.string().trim().min(1),
  left: ProjectedClaimStateSchema,
  right: ProjectedClaimStateSchema,
  diff: z.object({
    matches: z.array(z.unknown()),
    differences: z.array(z.unknown()),
    unknowns: z.array(z.unknown()),
  }),
  deterministicAnswers: z.array(
    z.object({ question: z.string(), holds: z.boolean(), reason: z.string() }),
  ),
  unresolvedQuestions: z.array(z.object({ question: z.string(), reason: z.string() })),
});

export type ProjectedCandidateState = z.infer<typeof ProjectedCandidateStateSchema>;

/** The compiled plan for one run. */
export const DecisionPlanSchema = z.object({
  revision: z.string().trim().min(1),
  questions: z.array(DecisionQuestionSchema),
  /** Projected state for each unresolved candidate. */
  projectedStates: z.array(ProjectedCandidateStateSchema),
  /** Budgets the run must not exceed. */
  budget: z.object({
    maxQuestions: z.number().int().min(1),
    maxExpansions: z.number().int().min(0),
  }),
  /** Whether exact statement text may be sent (D13 opt-out, per-run). */
  allowUnredacted: z.boolean().default(false),
});

export type DecisionPlan = z.infer<typeof DecisionPlanSchema>;
