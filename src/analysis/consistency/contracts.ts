/**
 * Contracts for the cross-report content-consistency engine (Phase 5).
 *
 * This engine is the **single sanctioned exception** to ToneForge's
 * deterministic-first rule, and that exception is deliberate rather than a
 * slip. Comparing two statements in different parts of a document and deciding
 * whether they contradict each other is interpretation; no rule answers it, and a
 * rule that approximated one would be confidently wrong on exactly the cases that
 * matter. See ADR-0052.
 *
 * Three properties this module exists to make impossible to get wrong:
 *
 * 1. **The engine cannot run without its own consent.** `ConsistencyReviewRequest`
 *    carries `consistencyConsent`, which is a third, separate flag. Spot review
 *    consent, full-document review consent, and semantic opt-in do not imply it,
 *    because a user who agreed to send text for one of those has not agreed to
 *    send it for this. `parseConsistencyReviewRequest` throws without it rather
 *    than defaulting.
 * 2. **A candidate conflict is not a finding.** A candidate is a *structured
 *    comparison* that might be a contradiction. Only adjudication, or a
 *    deterministic resolution, promotes it to a finding. Keeping the two types
 *    distinct is what stops an unverified guess from reaching the planner.
 * 3. **The engine reports its own coverage.** A cross-report check is quadratic in
 *    the number of statements, so it is bounded. The bound is stated in
 *    `ConsistencyCoverage` rather than applied silently, because a silently
 *    truncated review that reads as complete is the failure mode that matters.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Check identities
// ---------------------------------------------------------------------------

/**
 * The ten cross-report checks.
 *
 * Each is a genuinely distinct way two parts of a document can disagree. They
 * are deliberately not stages of a build and not a decomposition of one another:
 * C2 and C6 both look at numbers but disagree for different reasons (a changed
 * value versus the same value in a different unit), and a document can pass one
 * while failing the other.
 */
export const CONSISTENCY_CHECK_IDS = [
  "C1", // terminology drift
  "C2", // numeric contradiction
  "C3", // temporal conflict
  "C4", // entity attribute conflict
  "C5", // definitional conflict
  "C6", // unit inconsistency
  "C7", // status/claim contradiction
  "C8", // reference conflict
  "C9", // section promise mismatch
  "C10", // scope/qualifier contradiction
] as const;

export const ConsistencyCheckIdSchema = z.enum(CONSISTENCY_CHECK_IDS);
export type ConsistencyCheckId = z.infer<typeof ConsistencyCheckIdSchema>;

export interface ConsistencyCheckDescriptor {
  readonly id: ConsistencyCheckId;
  /** Human-readable name used in the task pane and in findings. */
  readonly title: string;
  /** The plain-language question this check asks. */
  readonly question: string;
  /**
   * How much a positive result should worry the user.
   *
   * `warning` is the default for most checks: a possible contradiction in prose
   * is usually a matter of judgment, and overstating it is how an engine like
   * this loses a user's trust.
   */
  readonly severity: "warning" | "error";
  /**
   * Whether the check can be decided by structured comparison alone.
   *
   * `false` means a candidate from this check normally needs model adjudication.
   * `true` means most candidates resolve deterministically and only the residue
   * is escalated. Recorded per check so the coverage report can say how much of
   * the run was model-dependent.
   */
  readonly deterministicFirst: boolean;
}

export const CONSISTENCY_CHECKS: Readonly<Record<ConsistencyCheckId, ConsistencyCheckDescriptor>> =
  Object.freeze({
    C1: {
      id: "C1",
      title: "Terminology drift",
      question: "Is the same concept called by different names in different places?",
      severity: "warning",
      deterministicFirst: true,
    },
    C2: {
      id: "C2",
      title: "Numeric contradiction",
      question: "Is the same quantity given two different values?",
      severity: "error",
      deterministicFirst: true,
    },
    C3: {
      id: "C3",
      title: "Temporal conflict",
      question: "Are events placed on dates that cannot both be true?",
      severity: "error",
      deterministicFirst: true,
    },
    C4: {
      id: "C4",
      title: "Entity attribute conflict",
      question: "Is the same entity described with conflicting attributes?",
      severity: "error",
      deterministicFirst: false,
    },
    C5: {
      id: "C5",
      title: "Definitional conflict",
      question: "Is the same term defined in two incompatible ways?",
      severity: "warning",
      deterministicFirst: false,
    },
    C6: {
      id: "C6",
      title: "Unit inconsistency",
      question: "Is the same measure expressed in units that do not agree?",
      severity: "warning",
      deterministicFirst: true,
    },
    C7: {
      id: "C7",
      title: "Status contradiction",
      question: "Are mutually exclusive claims made about the same subject?",
      severity: "error",
      deterministicFirst: false,
    },
    C8: {
      id: "C8",
      title: "Reference conflict",
      question: "Does a citation contradict the claim it is attached to?",
      severity: "warning",
      deterministicFirst: false,
    },
    C9: {
      id: "C9",
      title: "Section promise mismatch",
      question: "Does a section contain something other than what it says it will?",
      severity: "warning",
      deterministicFirst: true,
    },
    C10: {
      id: "C10",
      title: "Scope contradiction",
      question: "Is a universal qualifier contradicted by an exception elsewhere?",
      severity: "warning",
      deterministicFirst: false,
    },
  });

export function consistencyCheck(id: ConsistencyCheckId): ConsistencyCheckDescriptor {
  return CONSISTENCY_CHECKS[id];
}

// ---------------------------------------------------------------------------
// Statements — the unit of comparison
// ---------------------------------------------------------------------------

/**
 * One statement extracted from the document.
 *
 * Statements are produced by the engine's own segmentation pass from a
 * whole-document snapshot. They are deliberately *not* `DocumentNode`s: the
 * engine must never reach into the Word object model, and it must never run on
 * a live document that could change underneath it.
 */
export const ConsistencyStatementSchema = z.object({
  /** Stable within a document revision; used for evidence identity, not identity. */
  id: z.string().trim().min(1),
  /** The section heading this statement sits under, when there is one. */
  section: z.string().trim().default(""),
  text: z.string().trim().min(1),
  /** Character offsets within the snapshot the run was given. */
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

export type ConsistencyStatement = z.infer<typeof ConsistencyStatementSchema>;

// ---------------------------------------------------------------------------
// Candidate conflicts
// ---------------------------------------------------------------------------

/**
 * A structured comparison that *might* be a contradiction.
 *
 * This is deliberately not a finding. It is the output of a check, before any
 * verdict. A candidate carries both statements so a human or the adjudicator can
 * see exactly what was compared, and it carries a `certainty` so the pipeline
 * knows whether the check already decided the answer.
 */
export const ConsistencyCandidateSchema = z.object({
  checkId: ConsistencyCheckIdSchema,
  /** Stable identity for this specific comparison, used to de-duplicate. */
  fingerprint: z.string().trim().min(1),
  /** Human-readable statement of the suspected conflict, without a verdict. */
  suspicion: z.string().trim().min(1),
  /** The two statements compared. Order is stable but carries no meaning. */
  left: ConsistencyStatementSchema,
  right: ConsistencyStatementSchema,
  /**
   * `certain` means the structured comparison alone settles it.
   * `ambiguous` means the candidate must go to the model before it can become a
   * finding.
   */
  certainty: z.enum(["certain", "ambiguous"]),
  /** The extracted values that drove the comparison, for evidence display. */
  evidence: z.record(z.string(), z.string()).default({}),
});

export type ConsistencyCandidate = z.infer<typeof ConsistencyCandidateSchema>;

// ---------------------------------------------------------------------------
// Adjudication
// ---------------------------------------------------------------------------

/** What the adjudicator concluded about a candidate. */
export const ConsistencyVerdictSchema = z.enum([
  /** The two statements genuinely conflict. */
  "contradiction",
  /** They look similar but do not actually conflict. */
  "notAConflict",
  /** The model could not tell. Treated as no finding, never as a conflict. */
  "unclear",
]);

export type ConsistencyVerdict = z.infer<typeof ConsistencyVerdictSchema>;

export const ConsistencyAdjudicationSchema = z.object({
  checkId: ConsistencyCheckIdSchema,
  fingerprint: z.string().trim().min(1),
  verdict: ConsistencyVerdictSchema,
  /** 0-1. Below `CONSISTENCY_ACTIONABLE_CONFIDENCE` the finding is advisory. */
  confidence: z.number().min(0).max(1),
  /** The plain-language reason, shown to the user. */
  rationale: z.string().trim().min(1),
  /**
   * Which statement the engine believes is wrong, when it is willing to say.
   * Absent means the engine is reporting a conflict without prescribing a fix,
   * which is the honest position when it is not confident.
   */
  atFault: z.enum(["left", "right"]).optional(),
});

export type ConsistencyAdjudication = z.infer<typeof ConsistencyAdjudicationSchema>;

/**
 * Confidence below which a finding is reported as advisory rather than
 * actionable.
 *
 * A non-deterministic engine that quietly rewrites prose is worse than one that
 * asks. Below this threshold the finding is still shown, still carries its
 * evidence, and still cannot produce a change without the user acting on it
 * deliberately.
 */
export const CONSISTENCY_ACTIONABLE_CONFIDENCE = 0.7;

// ---------------------------------------------------------------------------
// The request and its consent gate
// ---------------------------------------------------------------------------

export const ConsistencyDocumentSchema = z.object({
  /** Identity of the snapshot. A run against a different revision is stale. */
  revision: z.string().trim().min(1),
  /** Whole-document text. This is the only text the engine may send. */
  text: z.string().min(1),
  /** Optional section headings, in document order. */
  sections: z.array(z.string().trim().min(1)).default([]),
});

export type ConsistencyDocument = z.infer<typeof ConsistencyDocumentSchema>;

/**
 * The default pairwise bound on statements in one run.
 *
 * Exported so the preflight can show the user the same number the engine will
 * apply. A disclosure quoting a different figure from the one in force is worse
 * than no disclosure, because it is trusted.
 */
export const CONSISTENCY_DEFAULT_MAX_STATEMENTS = 400;

/**
 * The default cap on how many candidates one run will send for adjudication.
 *
 * The checks are quadratic in statements and produce candidates in proportion,
 * so a document that trips a loose check can generate far more candidates than a
 * user could review — let alone pay for. The cap bounds the model's work; the
 * candidates past it are reported as unreviewed rather than silently dropped,
 * because a review that stopped early and said nothing reads as a clean one.
 */
export const CONSISTENCY_DEFAULT_MAX_ADJUDICATIONS = 60;

/**
 * The request the engine accepts.
 *
 * The three gates are checked in `parseConsistencyReviewRequest` and none of
 * them has a default: an omitted consent is a refusal, not a permission.
 */
export const ConsistencyReviewRequestSchema = z.object({
  document: ConsistencyDocumentSchema,
  /**
   * The third, separate consent flag. Deliberately not derived from any other
   * consent in the product.
   */
  consistencyConsent: z.literal(true),
  /**
   * Which checks to run. Empty means all ten.
   *
   * An explicitly empty array is normalized to the full set rather than being
   * taken literally. A caller that built its list from a filter and got nothing
   * back has not asked for "no checks" — it has asked for a review and the
   * filter matched none — and running zero checks would report a clean document
   * over a document nothing looked at. The omitted case already meant "all ten",
   * so this makes the two spellings of the same intent agree.
   */
  checks: z
    .array(ConsistencyCheckIdSchema)
    .default([])
    .transform((ids) => (ids.length === 0 ? [...CONSISTENCY_CHECK_IDS] : ids)),
  /**
   * The already-configured provider and model are reused, not re-selected.
   *
   * Optional, and empty by default, because the engine is explicitly allowed to
   * run with no provider at all — in which case only the deterministic
   * comparisons resolve and the rest are reported as unadjudicated. A `min(1)`
   * here would make that degraded mode unconstructible while appearing to
   * describe a model that is in fact never used.
   */
  model: z.string().trim().default(""),
  /**
   * Statements above this count stop being compared pairwise.
   *
   * Cross-report comparison is quadratic, so an unbounded run on a large document
   * would stall the pane. The bound is a parameter and is reported in the
   * coverage rather than being hidden in the implementation.
   */
  maxStatements: z.number().int().positive().max(2000).default(CONSISTENCY_DEFAULT_MAX_STATEMENTS),
  /**
   * How many ambiguous candidates may be sent for adjudication in one run.
   *
   * A bound on the model's work rather than on the review itself. Candidates past
   * the cap are counted as unreviewed in the coverage report, so stopping early
   * is visible rather than being read as a clean result.
   */
  maxAdjudications: z
    .number()
    .int()
    .positive()
    .max(500)
    .default(CONSISTENCY_DEFAULT_MAX_ADJUDICATIONS),
});

export type ConsistencyReviewRequest = z.infer<typeof ConsistencyReviewRequestSchema>;

export const CONSISTENCY_CONSENT_ERROR =
  "runConsistencyReview requires its own explicit consent — raw document text must not leave the add-in for cross-report review without a separate opt-in";

/**
 * Parse and gate a request.
 *
 * Throws rather than returning a partial request. A caller that ignores the
 * error and proceeds would run a non-deterministic engine over a user's
 * document without their agreement, which is the one outcome this gate exists
 * to make impossible.
 */
export function parseConsistencyReviewRequest(raw: unknown): ConsistencyReviewRequest {
  const candidate =
    typeof raw === "object" && raw !== null
      ? (raw as { consistencyConsent?: unknown }).consistencyConsent
      : undefined;
  if (candidate !== true) {
    throw new Error(CONSISTENCY_CONSENT_ERROR);
  }
  return ConsistencyReviewRequestSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

export const ConsistencyCoverageSchema = z.object({
  /** True when every statement was compared against every other. */
  complete: z.boolean(),
  statementsConsidered: z.number().int().nonnegative(),
  /** Total statements the engine saw, including any excluded by the bound. */
  statementsTotal: z.number().int().nonnegative(),
  comparisonsMade: z.number().int().nonnegative(),
  /** Per-check candidate counts, so a check that produced nothing is visible. */
  perCheck: z.record(ConsistencyCheckIdSchema, z.number().int().nonnegative()).default({}),
  /** Why coverage is not complete, in plain language. */
  limitations: z.array(z.string().trim().min(1)).default([]),
  /**
   * Candidates that needed the model. A high proportion is a signal that the
   * deterministic comparison is not doing enough work, and it is reported rather
   * than tuned away.
   */
  modelAdjudicated: z.number().int().nonnegative(),
});

export type ConsistencyCoverage = z.infer<typeof ConsistencyCoverageSchema>;

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/**
 * A confirmed conflict.
 *
 * Emitted only after a verdict. `actionable` is false when confidence is below
 * `CONSISTENCY_ACTIONABLE_CONFIDENCE`, which means the finding is displayed but
 * cannot produce a change until the user acts on it deliberately.
 */
export const ConsistencyIssueSchema = z.object({
  checkId: ConsistencyCheckIdSchema,
  fingerprint: z.string().trim().min(1),
  title: z.string().trim().min(1),
  detail: z.string().trim().min(1),
  severity: z.enum(["info", "warning", "error"]),
  confidence: z.number().min(0).max(1),
  actionable: z.boolean(),
  /** The node ids this conflict touches, for navigation and provenance. */
  nodeIds: z.array(z.string().trim().min(1)).default([]),
  /**
   * Character offsets of both statements within the snapshot the run was given.
   *
   * Carried because a finding has to be able to point at real text. A range
   * reconstructed from the *lengths* of the two statements is a range into
   * whatever happens to sit at those offsets in someone else's document, which
   * is worse than no range at all.
   */
  ranges: z
    .object({
      left: z.object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
      }),
      right: z.object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
      }),
    })
    .optional(),
  /** Both statements, so the user can judge the conflict directly. */
  evidence: z.object({
    left: z.string().trim().min(1),
    right: z.string().trim().min(1),
    sectionLeft: z.string().trim().default(""),
    sectionRight: z.string().trim().default(""),
  }),
  /** Set when the engine believes a specific statement is wrong. */
  suggestedText: z.string().trim().optional(),
  suggestedNodeId: z.string().trim().optional(),
});

export type ConsistencyIssue = z.infer<typeof ConsistencyIssueSchema>;

export const ConsistencyReportSchema = z.object({
  /** Identity of the snapshot this report describes. */
  revision: z.string().trim().min(1),
  issues: z.array(ConsistencyIssueSchema).default([]),
  coverage: ConsistencyCoverageSchema,
  /** Whether the model was consulted at all in this run. */
  usedModel: z.boolean(),
  startedAt: z.string().trim().min(1),
  finishedAt: z.string().trim().min(1),
});

export type ConsistencyReport = z.infer<typeof ConsistencyReportSchema>;

/** Progress the pipeline emits. Surfaced verbatim; never used as a gate. */
export const ConsistencyProgressSchema = z.object({
  phase: z.enum(["segmenting", "comparing", "adjudicating", "consolidating", "done"]),
  /** 0-1. */
  fraction: z.number().min(0).max(1),
  message: z.string().trim().min(1),
});

export type ConsistencyProgress = z.infer<typeof ConsistencyProgressSchema>;
