/**
 * The Semantic Review contract.
 *
 * One model call returns an assessment _and_ a proposed revision, rather than two
 * calls returning a list of deviations and then a separate rewrite. The reason is
 * not economy: a review that says "this paragraph is more categorical than your
 * style" and a revision that does something else entirely are two unconnected
 * claims about the same paragraph, and the user has no way to check one against
 * the other. One response makes them checkable against each other.
 *
 * **This is not a `Finding`, and it is not presented as one.** A deterministic
 * finding is a machine-verified statement that the document breaks a rule the
 * profile declares. A semantic review is an interpretation, a proposal, and the
 * user's own judgement on both. Forcing it into the finding shape would make a
 * model opinion indistinguishable from a rule breach in the one list the user
 * scans — and would put "the model thought this sentence was odd" beside "this
 * paragraph uses the wrong quote marks", which is the comparison the whole
 * semantic surface exists to avoid.
 *
 * The one thing the two share is the apply path: a reviewed revision still goes
 * through `word/revisionAdapter` with Track Changes, because "it came from a
 * model" is not a reason to write to a document differently.
 *
 * Boundary rule: may import `core/domain`, `ai/providers`, `ai/prompts`,
 * `shared/utils`, and the local preservation modules. Must not import `ui` or
 * `word/revisionAdapter`.
 */

import { z } from "zod";

import { logger } from "../../shared/utils/logger";
import {
  SemanticSampleEvidenceSchema,
  SemanticSelectionAnchorSchema,
  type SemanticSampleEvidence,
  type SemanticSelectionAnchor,
} from "../../core/domain/SemanticReviewSession";
import {
  SEMANTIC_DIMENSIONS,
  type SemanticStyleProfile,
} from "../../core/domain/SemanticStyleProfile";
import type { PreservationReport } from "./preservationValidator";

export {
  SemanticSelectionAnchorSchema,
  SemanticSampleEvidenceSchema,
  SEMANTIC_DIMENSIONS,
  type SemanticSelectionAnchor,
  type SemanticSampleEvidence,
};

export const SemanticDimensionSchema = z.enum(SEMANTIC_DIMENSIONS);
export type SemanticDimension = z.infer<typeof SemanticDimensionSchema>;

/**
 * Normalise a model-written key to the shape the sixteen names share.
 *
 * Case and separators are the two ways a model writes a name that is otherwise
 * the right one — "Tone", "sentence_architecture", "sentence-architecture" — and
 * all of them collapse to the same key, so one lookup covers them.
 */
function normaliseKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Flat names a model reaches for when it describes a dimension rather than
 * reading the key it was given. Mapping them is the difference between a
 * response that parses and one refused for naming the right idea the wrong way.
 */
const DIMENSION_ALIASES: Readonly<Record<string, SemanticDimension>> = {
  sentencelength: "sentenceArchitecture",
  paragraphlength: "paragraphArchitecture",
};

const DIMENSION_BY_KEY = new Map(
  SEMANTIC_DIMENSIONS.map((dimension) => [normaliseKey(dimension), dimension]),
);

/**
 * The dimension as it arrives from a model, coerced to `SemanticDimension`.
 *
 * The schema enforces the sixteen names, so a model that answers "Tone" used to
 * fail the whole response over a difference in case — a refusal the user cannot
 * act on. Coercion normalises the value, matches it against the names and the
 * known flat aliases, and falls back to `tone` for a value that matches nothing,
 * logging what it discarded so a real gap in the prompt stays visible.
 */
const ModelDimensionSchema = z
  .string()
  .transform((value): SemanticDimension => {
    const key = normaliseKey(value);
    const resolved = DIMENSION_BY_KEY.get(key) ?? DIMENSION_ALIASES[key];
    if (resolved !== undefined) return resolved;
    logger.warn("Semantic review reported an unknown dimension", { dimension: value });
    return "tone";
  })
  .pipe(SemanticDimensionSchema);

/**
 * How far one dimension of the selection departs from the learned style.
 *
 * `aligned` is included so the model is obliged to have an opinion about every
 * dimension it reports on. Without it, a model asked about sixteen dimensions
 * returns only the ones it dislikes, and the user cannot tell "aligned" from
 * "not examined" — the same gap `isDefaultSemanticStyle` closes on the learning
 * side.
 */
export const AlignmentSchema = z.enum(["aligned", "minor_deviation", "material_deviation"]);
export type Alignment = z.infer<typeof AlignmentSchema>;

const ALIGNMENT_ALIASES: Readonly<Record<string, Alignment>> = {
  aligned: "aligned",
  minor: "minor_deviation",
  minordeviation: "minor_deviation",
  material: "material_deviation",
  materialdeviation: "material_deviation",
};

/**
 * The alignment as it arrives from a model, coerced to `Alignment`.
 *
 * Shorthand ("minor", "material") is common and unambiguous; an unrecognised
 * value falls back to `aligned`, which is the state that lists the dimension as
 * examined and in agreement rather than hiding a value the model meant.
 */
const ModelAlignmentSchema = z
  .string()
  .transform((value): Alignment => {
    const resolved = ALIGNMENT_ALIASES[normaliseKey(value)];
    if (resolved !== undefined) return resolved;
    logger.warn("Semantic review reported an unknown alignment", { alignment: value });
    return "aligned";
  })
  .pipe(AlignmentSchema);

const OVERALL_ALIGNMENT_VALUES = ["high", "moderate", "low"] as const;
type OverallAlignment = (typeof OVERALL_ALIGNMENT_VALUES)[number];

const OVERALL_ALIGNMENT_ALIASES: Readonly<Record<string, OverallAlignment>> = {
  high: "high",
  moderate: "moderate",
  medium: "moderate",
  low: "low",
};

/** The overall alignment as it arrives from a model, coerced to the enum. */
const ModelOverallAlignmentSchema = z
  .string()
  .transform((value): OverallAlignment => {
    const resolved = OVERALL_ALIGNMENT_ALIASES[normaliseKey(value)];
    if (resolved !== undefined) return resolved;
    logger.warn("Semantic review reported an unknown overall alignment", {
      overallAlignment: value,
    });
    return "moderate";
  })
  .pipe(z.enum(OVERALL_ALIGNMENT_VALUES));

/** One dimension's verdict, with the model's reason attached. */
export const SemanticObservationSchema = z.object({
  dimension: ModelDimensionSchema,
  alignment: ModelAlignmentSchema,
  /** Why. Bounded, because this is rendered to the user verbatim. */
  explanation: z.string().trim().min(1).max(600),
  /**
   * A span the observation is about, when the model can name one.
   *
   * Optional and honestly so: a model quoting a span it cannot locate produces a
   * quote the user has to search for. The review reports a dimension, not an
   * offset, so an absent quote costs nothing except the ability to jump to it.
   */
  evidenceQuote: z.string().trim().min(1).max(400).optional(),
});
export type SemanticObservation = z.infer<typeof SemanticObservationSchema>;

/** The review as a whole. */
export const SemanticAssessmentSchema = z.object({
  overallAlignment: ModelOverallAlignmentSchema,
  summary: z.string().trim().min(1).max(800),
  /**
   * Bounded, but not minimum-one.
   *
   * A model that lists no observation has still answered, and the engine
   * substitutes a placeholder so the surface never renders an assessment with no
   * rows. Refusing the whole response over an empty list is a refusal the user
   * cannot act on; the substituted observation says plainly that nothing specific
   * was named.
   */
  observations: z.array(SemanticObservationSchema).max(24),
});
export type SemanticAssessment = z.infer<typeof SemanticAssessmentSchema>;

/**
 * The model's own account of what it might have changed.
 *
 * **Evidence, never proof, and stated as such everywhere it is used.** The
 * specification's §17 asks the review model to return this and then says to
 * treat it as model evidence rather than final proof. That is the honest
 * position: the local validator can prove a number moved and cannot prove a
 * causal claim did not, and a model that says `false` has told the user something
 * true about its own reasoning that no deterministic check can recover.
 *
 * A `false` anywhere disables Apply. Not because the model is trusted — because a
 * model that says it may have reversed a causation is reporting a real risk, and
 * the cost of asking the user is one acknowledgement while the cost of ignoring
 * it is a silently wrong document.
 */
export const MeaningPreservationAssessmentSchema = z.object({
  /**
   * Defaulted to `true` individually as well as taken as a whole.
   *
   * A model that omits a flag has not claimed the meaning was lost; refusing the
   * response over a missing key turns a caution into a dead end. Every default
   * fires only for a key that is absent, so a model that reports `false` is
   * still believed.
   */
  qualificationPreserved: z.boolean().default(true),
  attributionPreserved: z.boolean().default(true),
  causationPreserved: z.boolean().default(true),
  responsibilityPreserved: z.boolean().default(true),
  certaintyPreserved: z.boolean().default(true),
});
export type MeaningPreservationAssessment = z.infer<typeof MeaningPreservationAssessmentSchema>;

/** Which of the five flags the model reported as not preserved. */
export function unpreservedFlags(assessment: MeaningPreservationAssessment): string[] {
  return (
    [
      ["qualificationPreserved", "qualification"],
      ["attributionPreserved", "attribution"],
      ["causationPreserved", "causation"],
      ["responsibilityPreserved", "responsibility"],
      ["certaintyPreserved", "certainty"],
    ] as const
  )
    .filter(([flag]) => assessment[flag] === false)
    .map(([, name]) => name);
}

/** What the caller hands the engine. */
export const SemanticReviewRequestSchema = z.object({
  selectedText: z.string().min(1),
  selectionAnchor: SemanticSelectionAnchorSchema,
  profile: z.object({ id: z.string().uuid(), revision: z.number().int().positive() }),
  semantic: z.custom<SemanticStyleProfile>(),
  /**
   * The consent gate, typed as a literal.
   *
   * A literal rather than a boolean so a caller cannot pass a variable that might
   * be false and have the request type-check. The prompt builder checks it again
   * before anything is sent; the type is the first of the two checks.
   */
  includeRawText: z.literal(true),
  /** Which corpus the profile was learned from; changes the prompt's framing. */
  domain: z.enum(["general", "constructionExpert"]).default("constructionExpert"),
});
export type SemanticReviewRequest = z.infer<typeof SemanticReviewRequestSchema>;

/**
 * Which corpus framing the review should use, derived from the profile itself.
 *
 * The profile does not store the corpus it was learned from, so the register is
 * the signal: an `expert` register is the expert construction and engineering
 * reporting the framing describes. Every other register is reviewed as general
 * business writing, because a framing built for a corpus the profile was not
 * learned from changes what the model treats as the substance of a paragraph.
 */
export function reviewDomainFor(semantic: SemanticStyleProfile): SemanticReviewRequest["domain"] {
  return semantic.register.primary === "expert" ? "constructionExpert" : "general";
}

/** Which provider answered, and at what cost. */
export const ProviderMetadataSchema = z.object({
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
  latencyMs: z.number().int().nonnegative(),
  attempt: z.number().int().positive(),
});
export type ProviderMetadata = z.infer<typeof ProviderMetadataSchema>;

/**
 * The whole answer.
 *
 * `actionable` is computed by the engine from the preservation report, the model's
 * own meaning assessment, and the anchor — never read from a confidence score.
 * The old engine gated on `confidence >= 0.7`, and a self-reported number is not
 * evidence that anything factual survived; it is evidence that the model felt
 * confident. The checks below are ones a reader can audit.
 */
/** What the engine returns: the schema's shape plus the computed preservation report. */
export interface SemanticReviewResult {
  reviewSessionId: string;
  profileId: string;
  profileRevision: number;
  assessment: SemanticAssessment;
  /**
   * One sentence from the model on what it changed and why, shown to the user.
   *
   * The model's own account, carried here rather than dropped, so the Change the
   * apply path builds cites what the model said it did — not the assessment
   * summary, which describes the reading rather than the edit.
   */
  rationale: string;
  /** The proposed revision. Absent only when the model proposed nothing. */
  proposedRevision?: string;
  /**
   * The engine's own verdict, computed here rather than taken from the model.
   *
   * A schema cannot express it — the report contains arrays of facts with
   * positions, and it is produced by comparing two texts the model never sees
   * together — so it is typed rather than parsed, and the engine is the only
   * thing that can construct a `SemanticReviewResult`.
   */
  preservation: PreservationReport;
  meaningPreservation: MeaningPreservationAssessment;
  actionable: boolean;
  /** Present whenever the proposal may not be applied, and names which check. */
  refusalReason?: string;
  providerMetadata: ProviderMetadata;
  selectionAnchor: SemanticSelectionAnchor;
}
