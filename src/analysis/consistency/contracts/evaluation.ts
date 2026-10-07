import { z } from "zod";

/**
 * The sixteen D-outcomes (D8), retained in full.
 *
 * Multi-facet delay-expert claims need all sixteen: a delay claim and a
 * quantum claim about the same programme are not a contradiction, they are a
 * different basis, and collapsing the two into one verdict would report a
 * conflict the document never made. Derivation is mechanical from the E-vector
 * wherever possible; a direct D-choice question is asked only when the
 * E-vector cannot determine the relationship.
 */
export const DOutcomeSchema = z.enum([
  "D-CONSISTENT",
  "D-CONFLICT",
  "D-NOT-COMPARABLE",
  "D-UPDATED-POSITION",
  "D-DIFFERENT-SCOPE",
  "D-DIFFERENT-SCENARIO",
  "D-DIFFERENT-BASIS",
  "D-DIFFERENT-PERIOD",
  "D-DIFFERENT-ATTRIBUTION",
  "D-QUALIFIED-POSITION",
  "D-DIFFERENT-PROGRAMME-BASIS",
  "D-FORECAST-VS-ACTUAL",
  "D-DIFFERENT-VALUATION-BASIS",
  "D-DIFFERENT-MEASUREMENT-BASIS",
  "D-INSUFFICIENT-EVIDENCE",
  "D-AMBIGUOUS",
]);

export type DOutcome = z.infer<typeof DOutcomeSchema>;

/**
 * The E-vector: one boolean per evaluation facet.
 *
 * The deterministic resolver fills in every facet it can prove; the decision
 * model is asked only about the facets left unknown. A conclusive vector
 * derives its D-outcome without any model call.
 */
export const EvaluationVectorSchema = z.object({
  sameSubject: z.boolean(),
  samePeriod: z.boolean().optional(),
  sameScenario: z.boolean().optional(),
  sameBasis: z.boolean().optional(),
  sameAttribution: z.boolean().optional(),
  sameScope: z.boolean().optional(),
  valuesAgree: z.boolean().optional(),
  unitsCompatible: z.boolean().optional(),
  qualifiersCompatible: z.boolean().optional(),
});

export type EvaluationVector = z.infer<typeof EvaluationVectorSchema>;

/**
 * Versioned confidence with an explicit interval (D7).
 *
 * The point estimate is a weighted calibration; the interval comes from
 * E-vector dispersion plus model calibration. The UI renders the interval, not
 * just the point, so a 0.72 with a wide interval reads as the uncertain thing
 * it is. `calibrationVersion` pins which calibration produced the score, so a
 * later recalibration does not silently rewrite what an old report meant.
 */
export const ConfidenceProfileSchema = z.object({
  point: z.number().min(0).max(1),
  lower: z.number().min(0).max(1),
  upper: z.number().min(0).max(1),
  calibrationVersion: z.string().trim().min(1),
  /** Per-check thresholds that gated presentation. */
  reviewThreshold: z.number().min(0).max(1),
  presentationThreshold: z.number().min(0).max(1),
});

/**
 * An answer to an E-question from the decision model.
 *
 * The model answers only the questions the deterministic resolver
 * could not prove. Each answer carries its provenance.
 */
export const EvaluationAnswerSchema = z.object({
  question: z.string().trim().min(1),
  /** The model's answer: true/false for binary, option for choice, number for score. */
  answer: z.union([z.boolean(), z.string(), z.number()]),
  /** Confidence in this answer (0-1). */
  confidence: z.number().min(0).max(1),
  /** Provenance: "deterministic" | "system_one" | "mixed". */
  provenance: z.enum(["deterministic", "system_one", "mixed"]),
  /** The model's reasoning, if provided. */
  reasoning: z.string().optional(),
});

export type EvaluationAnswer = z.infer<typeof EvaluationAnswerSchema>;

export type ConfidenceProfile = z.infer<typeof ConfidenceProfileSchema>;
